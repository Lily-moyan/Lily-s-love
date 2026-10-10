import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Workflow } from '../types';

function fmt(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export default function WorkflowList() {
  const [list, setList] = useState<Workflow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await api.listWorkflows());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    try {
      const w = await api.createWorkflow(newName.trim() || '未命名工作流');
      setCreating(false);
      setNewName('');
      window.location.hash = `#/edit/${w.id}`;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const del = async (w: Workflow) => {
    if (!window.confirm(`删除「${w.name}」及其全部运行记录？`)) return;
    try {
      await api.deleteWorkflow(w.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const dup = async (w: Workflow) => {
    try {
      await api.duplicateWorkflow(w.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">⚡</span> 工作流平台
        </div>
        <div className="spacer" />
        <a className="btn btn-ghost" href="#/runs">运行记录</a>
        {creating ? (
          <span className="create-row">
            <input
              autoFocus
              value={newName}
              placeholder="工作流名称"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <button className="btn btn-primary" onClick={create}>创建</button>
            <button className="btn btn-ghost" onClick={() => setCreating(false)}>取消</button>
          </span>
        ) : (
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ 新建工作流</button>
        )}
      </header>
      {error && <div className="page-error">{error}</div>}
      <div className="page-body">
        {list.length === 0 && !error && (
          <div className="empty-state">
            <div className="empty-title">还没有工作流</div>
            <div className="empty-desc">点击右上角「新建工作流」，在画布上拖拽节点连线，组成你的自动化流程。</div>
          </div>
        )}
        <div className="wf-grid">
          {list.map((w) => (
            <div key={w.id} className="wf-card">
              <div className="wf-card-main" onClick={() => (window.location.hash = `#/edit/${w.id}`)}>
                <div className="wf-card-name">{w.name}</div>
                <div className="wf-card-meta">
                  {w.nodeCount ?? w.definition.nodes.length} 节点 · {w.edgeCount ?? w.definition.edges.length} 连线 ·{' '}
                  {w.runCount ?? 0} 次运行
                </div>
                <div className="wf-card-meta muted">更新于 {fmt(w.updatedAt)}</div>
              </div>
              <div className="wf-card-actions">
                <button className="btn btn-ghost" onClick={() => dup(w)}>复制</button>
                <button className="btn btn-danger" onClick={() => del(w)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
