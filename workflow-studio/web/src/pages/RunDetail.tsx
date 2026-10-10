import { useEffect, useState } from 'react';
import { api } from '../api';
import { STATUS_TEXT, type NodeRunResult, type Run, type Workflow, type WFNode } from '../types';

function fmt(iso?: string) {
  return iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour12: false }) : '-';
}

function durationMs(r?: NodeRunResult) {
  if (!r?.startedAt || !r?.endedAt) return null;
  const d = new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
  return d >= 1000 ? `${(d / 1000).toFixed(1)}s` : `${d}ms`;
}

function NodeResultCard({ node, result }: { node: WFNode; result?: NodeRunResult }) {
  const status = result?.status || 'pending';
  return (
    <div className={`node-result st-${status}`}>
      <div className="node-result-head">
        <span className="status-pill">{STATUS_TEXT[status] || status}</span>
        <span className="node-result-name">{node.name}</span>
        <span className="node-result-type">{node.type}</span>
        <span className="spacer" />
        <span className="node-result-time">
          {fmt(result?.startedAt)} → {fmt(result?.endedAt)}
          {durationMs(result) ? ` (${durationMs(result)})` : ''}
        </span>
      </div>
      {result?.error && <div className="node-result-error">{result.error}</div>}
      {result?.output !== undefined && result.status !== 'running' && result.status !== 'pending' && (
        <details className="node-result-output">
          <summary>输出</summary>
          <pre>{typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export default function RunDetail({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [wf, setWf] = useState<Workflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.getRun(runId);
        if (!alive) return;
        setRun(r);
        const w = await api.getWorkflow(r.workflowId);
        if (alive) setWf(w);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId]);

  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.type === 'node') {
        setRun((r) =>
          r
            ? {
                ...r,
                nodeOutputs: {
                  ...r.nodeOutputs,
                  [e.nodeId]: {
                    status: e.status,
                    output: e.output,
                    error: e.error,
                    startedAt: e.startedAt,
                    endedAt: e.endedAt,
                  },
                },
              }
            : r,
        );
      } else if (e.type === 'done') {
        setRun((r) => (r ? { ...r, status: e.status, error: e.error, endedAt: new Date().toISOString() } : r));
        es.close();
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [run?.status, runId]);

  if (error) {
    return (
      <div className="page">
        <div className="page-error">加载失败：{error} <a href="#/">返回列表</a></div>
      </div>
    );
  }
  if (!run || !wf) return <div className="page"><div className="page-body">加载中…</div></div>;

  return (
    <div className="page">
      <header className="topbar">
        <a href={`#/edit/${run.workflowId}`} className="btn btn-ghost">← 回到画布</a>
        <div className="page-title">运行详情</div>
        <span className={`status-pill st-${run.status}`}>{STATUS_TEXT[run.status] || run.status}</span>
        <div className="spacer" />
        <span className="muted">{new Date(run.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
      </header>
      <div className="page-body">
        <div className="run-meta-card">
          <div className="run-meta-line">工作流：{wf.name}</div>
          <details>
            <summary>输入参数</summary>
            <pre>{JSON.stringify(run.input, null, 2)}</pre>
          </details>
          {run.error && <div className="node-result-error">工作流错误：{run.error}</div>}
        </div>
        <div className="node-results">
          {wf.definition.nodes.map((n) => (
            <NodeResultCard key={n.id} node={n} result={run.nodeOutputs[n.id]} />
          ))}
        </div>
      </div>
    </div>
  );
}
