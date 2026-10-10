import { useEffect, useState } from 'react';
import { api } from '../api';
import { STATUS_TEXT, type Run } from '../types';

function fmt(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export default function RunsList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const workflowId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('workflowId');

  useEffect(() => {
    (async () => {
      try {
        setRuns(await api.listRuns(workflowId || undefined));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [workflowId]);

  return (
    <div className="page">
      <header className="topbar">
        <a href={workflowId ? `#/edit/${workflowId}` : '#/'} className="btn btn-ghost">← 返回</a>
        <div className="page-title">运行记录</div>
      </header>
      {error && <div className="page-error">{error}</div>}
      <div className="page-body">
        {runs.length === 0 && !error && <div className="empty-state"><div className="empty-title">暂无运行记录</div></div>}
        <div className="runs-list">
          {runs.map((r) => (
            <a key={r.id} href={`#/runs/${r.id}`} className="run-row">
              <span className={`status-pill st-${r.status}`}>{STATUS_TEXT[r.status] || r.status}</span>
              <span className="run-name">{r.workflowName || '未知工作流'}</span>
              <span className="run-time">{fmt(r.createdAt)}</span>
              {r.error && <span className="run-error-text" title={r.error}>{r.error.slice(0, 60)}</span>}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
