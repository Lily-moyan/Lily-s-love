import { NODE_TYPES } from './nodes.js';

export function validateDefinition(definition) {
  if (!definition || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    throw new Error('定义缺少 nodes/edges');
  }
  const ids = new Set(definition.nodes.map((n) => n.id));
  if (ids.size !== definition.nodes.length) throw new Error('节点 ID 重复');
  for (const e of definition.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      throw new Error(`边引用了不存在的节点: ${e.source} -> ${e.target}`);
    }
  }
  for (const n of definition.nodes) {
    if (!NODE_TYPES[n.type]) throw new Error(`未知节点类型: ${n.type}`);
  }
}

const NODE_TIMEOUT_MS = 120000;
function timeout(ms, msg) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms));
}

/**
 * 执行工作流定义。基于 DAG 逐波调度：
 * - 无入边的节点（开始节点）先运行；
 * - 节点在所有入边「settled」且至少一条入边 active 时才 ready，同一波并行执行；
 * - 条件节点只激活与其布尔输出匹配的 sourceHandle 出边；
 * - 未激活路径上的节点标记为 skipped；节点报错则下游被跳过。
 */
export async function executeWorkflow(definition, runInput, { onNodeEvent } = {}) {
  const nodes = definition.nodes;
  const edges = definition.edges || [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) incoming.get(e.target)?.push(e);

  const results = new Map(); // nodeId -> {status, output, error, startedAt, endedAt}
  const started = new Set();

  const settled = (nid) => {
    const r = results.get(nid);
    return r && (r.status === 'success' || r.status === 'error' || r.status === 'skipped');
  };

  const edgeActive = (e) => {
    const src = results.get(e.source);
    if (!src || src.status !== 'success') return false;
    const srcNode = nodeById.get(e.source);
    if (srcNode && srcNode.type === 'condition') {
      const wantTrue = e.sourceHandle === 'true';
      return Boolean(src.output) === wantTrue;
    }
    return true;
  };

  const ready = (nid) => {
    const ins = incoming.get(nid) || [];
    if (!ins.every((e) => settled(e.source))) return false;
    if (started.has(nid) || results.has(nid)) return false;
    if (ins.length === 0) return true;
    return ins.some(edgeActive);
  };

  // 数据可见性：所有已成功完成的节点输出按节点 id 聚合（可引用任意上游节点）
  const buildInputs = () => {
    const ins = {};
    for (const [nid, r] of results) {
      if (r.status === 'success' && r.output !== undefined) ins[nid] = r.output;
    }
    return ins;
  };

  const markEvent = (nodeId) => onNodeEvent?.({ nodeId, ...results.get(nodeId) });

  let wave = 0;
  for (;;) {
    wave++;
    const readyNodes = nodes.filter((n) => !started.has(n.id) && !results.has(n.id) && ready(n.id));
    if (!readyNodes.length) break;
    if (wave > 1000) break; // 安全阀
    await Promise.all(
      readyNodes.map(async (n) => {
        started.add(n.id);
        const startedAt = new Date().toISOString();
        results.set(n.id, { status: 'running', startedAt });
        markEvent(n.id);
        try {
          const inputs = buildInputs();
          const type = NODE_TYPES[n.type];
          const output = await Promise.race([
            type.run({ config: n.config || {}, inputs, runInput }),
            timeout(NODE_TIMEOUT_MS, '节点执行超时 (120s)'),
          ]);
          results.set(n.id, {
            status: 'success',
            output: output === undefined ? null : output,
            startedAt,
            endedAt: new Date().toISOString(),
          });
        } catch (err) {
          results.set(n.id, {
            status: 'error',
            error: String(err?.message || err),
            startedAt,
            endedAt: new Date().toISOString(),
          });
        }
        markEvent(n.id);
      }),
    );
    // 传播跳过：入边已全部 settled 且无激活入边的节点，立即标记 skipped，让下游能够继续
    for (const n of nodes) {
      if (results.has(n.id)) continue;
      const ins = incoming.get(n.id) || [];
      if (ins.length > 0 && ins.every((e) => settled(e.source)) && !ins.some(edgeActive)) {
        results.set(n.id, { status: 'skipped' });
        markEvent(n.id);
      }
    }
  }

  // 剩余未运行的节点视为跳过（循环依赖等）
  for (const n of nodes) {
    if (!results.has(n.id)) {
      results.set(n.id, { status: 'skipped' });
      markEvent(n.id);
    }
  }

  const nodeOutputs = {};
  for (const [id, r] of results) nodeOutputs[id] = r;
  const failed = Object.values(nodeOutputs).find((r) => r.status === 'error');
  return { status: failed ? 'error' : 'success', nodeOutputs, error: failed ? failed.error : undefined };
}
