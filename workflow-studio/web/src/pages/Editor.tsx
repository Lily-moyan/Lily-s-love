import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import { api } from '../api';
import type { NodeTypeMeta, Workflow, WorkflowDefinition, WFNode } from '../types';
import FlowNode, { type FlowNodeData } from '../components/FlowNode';
import { NodePalette } from '../components/NodePalette';
import { ConfigPanel } from '../components/ConfigPanel';

type FNode = Node<FlowNodeData, 'custom'>;
const nodeTypes: NodeTypes = { custom: FlowNode };

function metaById(types: NodeTypeMeta[]) {
  const m = new Map<string, NodeTypeMeta>();
  for (const t of types) m.set(t.type, t);
  return m;
}

function toRfNode(n: WFNode, meta: NodeTypeMeta, status: string): FNode {
  return {
    id: n.id,
    type: 'custom',
    position: n.position,
    data: {
      nodeType: n.type,
      name: n.name,
      config: n.config || {},
      color: meta.color,
      label: meta.label,
      cond: n.type === 'condition',
      status,
    },
  };
}

function EditorInner({ workflowId }: { workflowId: string }) {
  const [meta, setMeta] = useState<NodeTypeMeta[]>([]);
  const [wfName, setWfName] = useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState<FNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [toast, setToast] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runDone, setRunDone] = useState<{ status: string; error?: string } | null>(null);
  const [runInput, setRunInput] = useState('{}');
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const { screenToFlowPosition } = useReactFlow();
  const rfRef = useRef<{ fitView: (opts?: object) => void } | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const metaMap = useMemo(() => metaById(meta), [meta]);
  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  // 加载工作流与节点类型
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [types, workflow] = await Promise.all([api.nodeTypes(), api.getWorkflow(workflowId)]);
        if (!alive) return;
        const m = metaById(types);
        setMeta(types);
        setWfName(workflow.name);
        setNodes(workflow.definition.nodes.map((n) => toRfNode(n, m.get(n.type)!, '')));
        setEdges(
          workflow.definition.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle || null,
            targetHandle: e.targetHandle || null,
          })),
        );
        setTimeout(() => rfRef.current?.fitView({ padding: 0.25 }), 60);
      } catch (err) {
        setToast('加载失败：' + (err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  useEffect(() => () => esRef.current?.close(), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const buildDefinition = useCallback(
    (): WorkflowDefinition => ({
      version: 1,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType,
        name: n.data.name,
        config: n.data.config,
        position: { x: n.position.x, y: n.position.y },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        targetHandle: e.targetHandle || undefined,
      })),
    }),
    [nodes, edges],
  );

  const persist = useCallback(async () => {
    await api.saveWorkflow(workflowId, { name: wfName, definition: buildDefinition() });
  }, [workflowId, wfName, buildDefinition]);

  const save = useCallback(async () => {
    setSaveState('saving');
    try {
      await persist();
      setSaveState('saved');
      setToast('已保存 ' + new Date().toLocaleTimeString());
    } catch (err) {
      setSaveState('dirty');
      setToast('保存失败：' + (err as Error).message);
    }
  }, [persist]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (saveState !== 'saving') save();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [save, saveState]);

  const addNode = useCallback(
    (type: string, pos?: { x: number; y: number }) => {
      const m = metaMap.get(type);
      if (!m) return;
      const id = 'n_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const position = pos ?? { x: 220 + Math.random() * 160, y: 180 + Math.random() * 120 };
      const config: Record<string, unknown> = {};
      for (const f of m.schema) if (f.default !== undefined) config[f.key] = f.default;
      setNodes((nds) => [...nds, toRfNode({ id, type, name: m.label, config, position }, m, '')]);
      setSaveState('dirty');
      setSelectedId(id);
    },
    [metaMap, setNodes],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/wf-node');
      if (!type) return;
      addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addNode, screenToFlowPosition],
  );
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => addEdge({ ...c, id: 'e_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12) }, eds));
      setSaveState('dirty');
    },
    [setEdges],
  );

  const onConfigChange = useCallback(
    (config: Record<string, unknown>, name: string) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, config, name } } : n)),
      );
      setSaveState('dirty');
    },
    [selectedId, setNodes],
  );

  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, status: runStatus[n.id] || '' } })),
    [nodes, runStatus],
  );
  const displayEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        label: e.sourceHandle === 'true' ? '是' : e.sourceHandle === 'false' ? '否' : undefined,
        animated: runStatus[e.source] === 'running',
      })),
    [edges, runStatus],
  );

  const startRun = async () => {
    let input: unknown;
    try {
      input = runInput.trim() === '' ? {} : JSON.parse(runInput);
    } catch {
      setRunError('输入不是合法 JSON');
      return;
    }
    setRunError(null);
    setRunDone(null);
    try {
      setSaveState('saving');
      await persist();
      setSaveState('saved');
      const { id } = await api.startRun(workflowId, input);
      setLastRunId(id);
      setRunStatus({});
      setRunning(true);
      setRunPanelOpen(true);
      esRef.current?.close();
      const es = new EventSource(`/api/runs/${id}/events`);
      esRef.current = es;
      es.onmessage = (ev) => {
        const e = JSON.parse(ev.data);
        if (e.type === 'node') {
          setRunStatus((prev) => ({ ...prev, [e.nodeId]: e.status }));
        } else if (e.type === 'done') {
          setRunning(false);
          setRunDone({ status: e.status, error: e.error });
          es.close();
        }
      };
      es.onerror = () => {
        es.close();
        setRunning(false);
        if (!runDone) setRunError('连接运行进度流失败');
      };
    } catch (err) {
      setRunError((err as Error).message);
      setRunning(false);
    }
  };

  return (
    <div className="editor">
      <header className="topbar">
        <a href="#/" className="btn btn-ghost">← 列表</a>
        <input
          className="wf-name"
          value={wfName}
          onChange={(e) => {
            setWfName(e.target.value);
            setSaveState('dirty');
          }}
        />
        <span className={`save-badge ${saveState}`}>
          {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '未保存'}
        </span>
        <div className="spacer" />
        <a className="btn btn-ghost" href={`#/runs?workflowId=${workflowId}`}>历史</a>
        <button className="btn btn-ghost" onClick={() => setRunPanelOpen((v) => !v)}>▶ 运行</button>
        <button className="btn btn-primary" onClick={save} disabled={saveState === 'saving'}>保存 (Ctrl+S)</button>
      </header>
      <div className="editor-body">
        <NodePalette types={meta} onAdd={(t) => addNode(t)} />
        <div className="canvas-wrap" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodesDelete={() => {
              setSelectedId(null);
              setSaveState('dirty');
            }}
            onEdgesDelete={() => setSaveState('dirty')}
            deleteKeyCode={['Backspace', 'Delete']}
            onInit={(rf) => {
              rfRef.current = rf;
            }}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls />
            <MiniMap pannable zoomable nodeColor={(n) => (n.data as FlowNodeData).color} />
          </ReactFlow>
          {runPanelOpen && (
            <div className="run-panel">
              <div className="run-panel-head">
                <span>运行工作流</span>
                <button className="btn-close" onClick={() => setRunPanelOpen(false)}>×</button>
              </div>
              <label className="field">
                <span>输入参数 (JSON)</span>
                <textarea rows={5} value={runInput} onChange={(e) => setRunInput(e.target.value)} placeholder='{"key": "value"}' />
              </label>
              {runError && <div className="run-error">{runError}</div>}
              <div className="run-actions">
                <button className="btn btn-primary" disabled={running} onClick={startRun}>
                  {running ? '运行中…' : '开始运行'}
                </button>
                {lastRunId && (
                  <a className="btn btn-ghost" href={`#/runs/${lastRunId}`}>查看详情 →</a>
                )}
              </div>
              {Object.keys(runStatus).length > 0 && (
                <div className="run-summary">
                  {Object.entries(runStatus).map(([nid, st]) => {
                    const n = nodes.find((x) => x.id === nid);
                    return (
                      <div key={nid} className={`run-summary-item st-${st}`}>
                        <span className="dot" />
                        {(n ? n.data.name : nid)} · {st === 'running' ? '运行中' : st === 'success' ? '成功' : st === 'error' ? '失败' : '跳过'}
                      </div>
                    );
                  })}
                </div>
              )}
              {runDone && (
                <div className={`run-done ${runDone.status}`}>
                  {runDone.status === 'success' ? '✅ 运行成功' : '❌ 运行失败'}
                  {runDone.error ? '：' + runDone.error : ''}
                </div>
              )}
            </div>
          )}
        </div>
        <ConfigPanel
          node={selectedNode}
          meta={selectedNode ? metaMap.get(selectedNode.data.nodeType) : undefined}
          onChange={onConfigChange}
        />
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default function Editor({ workflowId }: { workflowId: string }) {
  return (
    <ReactFlowProvider>
      <EditorInner workflowId={workflowId} />
    </ReactFlowProvider>
  );
}
