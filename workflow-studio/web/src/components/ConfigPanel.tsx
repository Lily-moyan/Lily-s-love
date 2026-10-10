import type { NodeTypeMeta } from '../types';
import type { FlowNodeData } from './FlowNode';
import type { Node } from '@xyflow/react';

type FNode = Node<FlowNodeData, 'custom'>;

export function ConfigPanel({
  node,
  meta,
  onChange,
}: {
  node: FNode | null;
  meta: NodeTypeMeta | undefined;
  onChange: (config: Record<string, unknown>, name: string) => void;
}) {
  if (!node) {
    return (
      <aside className="config-panel">
        <div className="panel-title">配置</div>
        <div className="panel-empty">点击画布中的节点进行配置</div>
      </aside>
    );
  }
  const schema = meta?.schema || [];
  const config = node.data.config || {};
  return (
    <aside className="config-panel">
      <div className="panel-title">
        配置节点 <span className="panel-type-badge" style={{ background: node.data.color }}>{node.data.label}</span>
      </div>
      <label className="field">
        <span>名称</span>
        <input value={node.data.name} onChange={(e) => onChange(config, e.target.value)} />
      </label>
      {schema.map((f) => {
        const val = config[f.key] ?? f.default ?? '';
        return (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            {f.type === 'textarea' ? (
              <textarea
                rows={f.rows || 4}
                placeholder={f.placeholder}
                value={String(val)}
                onChange={(e) => onChange({ ...config, [f.key]: e.target.value }, node.data.name)}
              />
            ) : f.type === 'select' ? (
              <select
                value={String(val)}
                onChange={(e) => onChange({ ...config, [f.key]: e.target.value }, node.data.name)}
              >
                {(f.options || []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === 'number' ? 'number' : 'text'}
                step="0.1"
                placeholder={f.placeholder}
                value={String(val)}
                onChange={(e) =>
                  onChange(
                    { ...config, [f.key]: f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value },
                    node.data.name,
                  )
                }
              />
            )}
          </label>
        );
      })}
      <div className="panel-hint">节点 ID：{node.id}</div>
      <div className="panel-hint">提示：配置项支持 {'{{inputs.xxx}}'} 模板，引用上游节点输出。</div>
    </aside>
  );
}
