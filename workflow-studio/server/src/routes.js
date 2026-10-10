import { Router } from 'express';
import crypto from 'node:crypto';
import { db, parseWorkflow, parseRun } from './db.js';
import { executeWorkflow, validateDefinition } from './engine.js';
import { nodeTypeMeta } from './nodes.js';
import { createBus, getBus, closeBus, publish } from './bus.js';

export const api = Router();

const getWorkflowRow = (id) => db.prepare('SELECT * FROM workflows WHERE id=?').get(id);

function defaultDefinition() {
  return {
    version: 1,
    nodes: [{ id: 'start', type: 'start', name: '开始', config: {}, position: { x: 120, y: 260 } }],
    edges: [],
  };
}

// ---------- 节点类型元数据（画布调色板） ----------
api.get('/nodes/types', (_req, res) => res.json(nodeTypeMeta()));

// ---------- 工作流 CRUD ----------
api.get('/workflows', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT w.*, (SELECT COUNT(*) FROM runs r WHERE r.workflow_id = w.id) AS run_count
       FROM workflows w ORDER BY updated_at DESC`,
    )
    .all();
  res.json(
    rows.map((r) => {
      const w = parseWorkflow(r);
      return {
        ...w,
        runCount: r.run_count,
        nodeCount: w.definition.nodes.length,
        edgeCount: w.definition.edges.length,
      };
    }),
  );
});

api.post('/workflows', (req, res) => {
  const name = String(req.body?.name || '未命名工作流').slice(0, 80);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workflows (id, name, definition, created_at, updated_at) VALUES (?,?,?,?,?)').run(
    id,
    name,
    JSON.stringify(defaultDefinition()),
    now,
    now,
  );
  res.status(201).json(parseWorkflow(getWorkflowRow(id)));
});

api.get('/workflows/:id', (req, res) => {
  const w = parseWorkflow(getWorkflowRow(req.params.id));
  if (!w) return res.status(404).json({ error: '工作流不存在' });
  res.json(w);
});

api.put('/workflows/:id', (req, res) => {
  const row = getWorkflowRow(req.params.id);
  if (!row) return res.status(404).json({ error: '工作流不存在' });
  const next = { name: row.name, definition: row.definition };
  if (req.body.name !== undefined) next.name = String(req.body.name).slice(0, 80);
  if (req.body.definition !== undefined) {
    try {
      validateDefinition(req.body.definition);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    next.definition = JSON.stringify(req.body.definition);
  }
  db.prepare('UPDATE workflows SET name=?, definition=?, updated_at=? WHERE id=?').run(
    next.name,
    next.definition,
    new Date().toISOString(),
    req.params.id,
  );
  res.json(parseWorkflow(getWorkflowRow(req.params.id)));
});

api.delete('/workflows/:id', (req, res) => {
  db.prepare('DELETE FROM runs WHERE workflow_id=?').run(req.params.id);
  db.prepare('DELETE FROM workflows WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

api.post('/workflows/:id/duplicate', (req, res) => {
  const row = getWorkflowRow(req.params.id);
  if (!row) return res.status(404).json({ error: '工作流不存在' });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workflows (id, name, definition, created_at, updated_at) VALUES (?,?,?,?,?)').run(
    id,
    `${row.name} 副本`,
    row.definition,
    now,
    now,
  );
  res.status(201).json(parseWorkflow(getWorkflowRow(id)));
});

// ---------- 运行 ----------
api.post('/workflows/:id/runs', (req, res) => {
  const w = parseWorkflow(getWorkflowRow(req.params.id));
  if (!w) return res.status(404).json({ error: '工作流不存在' });
  try {
    validateDefinition(w.definition);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const input = req.body?.input ?? {};
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO runs (id, workflow_id, status, input, node_outputs, created_at) VALUES (?,?,?,?,?,?)').run(
    runId,
    w.id,
    'running',
    JSON.stringify(input),
    '{}',
    now,
  );
  res.status(201).json({ id: runId });

  createBus(runId);
  executeWorkflow(w.definition, input, {
    onNodeEvent: ({ nodeId, ...rest }) => {
      const row = db.prepare('SELECT node_outputs FROM runs WHERE id=?').get(runId);
      const outputs = JSON.parse(row.node_outputs);
      outputs[nodeId] = { ...outputs[nodeId], ...rest };
      db.prepare('UPDATE runs SET node_outputs=? WHERE id=?').run(JSON.stringify(outputs), runId);
      publish(runId, { type: 'node', nodeId, ...rest });
    },
  })
    .then((result) => {
      db.prepare('UPDATE runs SET status=?, error=?, ended_at=? WHERE id=?').run(
        result.status,
        result.error ?? null,
        new Date().toISOString(),
        runId,
      );
      publish(runId, { type: 'done', status: result.status, error: result.error });
      closeBus(runId);
    })
    .catch((err) => {
      db.prepare("UPDATE runs SET status='error', error=?, ended_at=? WHERE id=?").run(
        String(err?.message || err),
        new Date().toISOString(),
        runId,
      );
      publish(runId, { type: 'done', status: 'error', error: String(err?.message || err) });
      closeBus(runId);
    });
});

api.get('/runs', (req, res) => {
  const workflowId = req.query.workflowId;
  const rows = workflowId
    ? db
        .prepare(
          `SELECT r.*, w.name AS workflow_name FROM runs r
           LEFT JOIN workflows w ON w.id = r.workflow_id
           WHERE r.workflow_id = ? ORDER BY r.created_at DESC`,
        )
        .all(String(workflowId))
    : db
        .prepare(
          `SELECT r.*, w.name AS workflow_name FROM runs r
           LEFT JOIN workflows w ON w.id = r.workflow_id
           ORDER BY r.created_at DESC LIMIT 100`,
        )
        .all();
  res.json(rows.map((r) => ({ ...parseRun(r), workflowName: r.workflow_name })));
});

api.get('/runs/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT r.*, w.name AS workflow_name FROM runs r
       LEFT JOIN workflows w ON w.id = r.workflow_id WHERE r.id = ?`,
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: '运行记录不存在' });
  res.json({ ...parseRun(row), workflowName: row.workflow_name });
});

// SSE：实时节点状态推送
api.get('/runs/:id/events', (req, res) => {
  const run = parseRun(db.prepare('SELECT * FROM runs WHERE id=?').get(req.params.id));
  if (!run) return res.status(404).json({ error: '运行记录不存在' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (ev) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (ev.type === 'done') res.end();
  };

  const bus = getBus(run.id);
  if (bus) {
    for (const ev of bus.events) send(ev);
    if (!res.writableEnded) bus.waiters.push(send);
    req.on('close', () => {
      const i = bus.waiters.indexOf(send);
      if (i >= 0) bus.waiters.splice(i, 1);
    });
    return;
  }

  // 总线已关闭：从数据库回放（进程重启后或已结束的运行）
  if (run.status === 'running') {
    send({ type: 'done', status: 'error', error: '服务重启，运行中断' });
    return;
  }
  const wfRow = db.prepare('SELECT definition FROM workflows WHERE id=?').get(run.workflowId);
  if (wfRow) {
    let def;
    try { def = JSON.parse(wfRow.definition); } catch { def = { nodes: [] }; }
    for (const n of def.nodes) {
      const o = run.nodeOutputs[n.id];
      if (o) send({ type: 'node', nodeId: n.id, ...o });
    }
  }
  send({ type: 'done', status: run.status, error: run.error });
});
