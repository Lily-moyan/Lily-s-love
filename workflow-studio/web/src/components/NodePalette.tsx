import { useMemo } from 'react';
import type { NodeTypeMeta } from '../types';

export function NodePalette({ types, onAdd }: { types: NodeTypeMeta[]; onAdd: (type: string) => void }) {
  const categories = useMemo(() => Array.from(new Set(types.map((t) => t.category))), [types]);
  return (
    <aside className="palette">
      <div className="panel-title">节点</div>
      {categories.map((cat) => (
        <div key={cat} className="palette-cat">
          <div className="palette-cat-title">{cat}</div>
          {types
            .filter((t) => t.category === cat)
            .map((t) => (
              <div
                key={t.type}
                className="palette-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/wf-node', t.type);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => onAdd(t.type)}
                title="拖拽到画布，或点击添加"
              >
                <span className="palette-dot" style={{ background: t.color }} />
                <div>
                  <div className="palette-label">{t.label}</div>
                  <div className="palette-desc">{t.description}</div>
                </div>
              </div>
            ))}
        </div>
      ))}
    </aside>
  );
}
