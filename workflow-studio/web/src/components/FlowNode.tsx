import { Handle, Position, type NodeProps } from '@xyflow/react';
import { STATUS_TEXT } from '../types';

export interface FlowNodeData extends Record<string, unknown> {
  nodeType: string;
  name: string;
  config: Record<string, unknown>;
  color: string;
  label: string;
  cond?: boolean;
  status?: string;
}

export default function FlowNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <div
      className={`flow-node${selected ? ' selected' : ''}${d.status ? ` st-${d.status}` : ''}`}
      style={{ borderColor: d.color }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="node-head" style={{ background: d.color }}>
        <span className="node-name">{d.name}</span>
        {d.status && <span className="node-status">{STATUS_TEXT[d.status] || d.status}</span>}
      </div>
      <div className="node-type">{d.label}</div>
      {d.cond ? (
        <>
          <div className="cond-label" style={{ top: '34%' }}>是</div>
          <div className="cond-label" style={{ top: '72%' }}>否</div>
          <Handle type="source" position={Position.Right} id="true" style={{ top: '34%' }} className="handle-src" />
          <Handle type="source" position={Position.Right} id="false" style={{ top: '72%' }} className="handle-src" />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="handle-src" />
      )}
    </div>
  );
}
