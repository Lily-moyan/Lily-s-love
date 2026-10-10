import crypto from 'node:crypto';
import { db } from './db.js';

const DEMO_DEFINITION = {
  version: 1,
  nodes: [
    { id: 'start', type: 'start', name: '开始', config: {}, position: { x: 40, y: 280 } },
    {
      id: 'http',
      type: 'http',
      name: '获取待办',
      config: { method: 'GET', url: 'https://jsonplaceholder.typicode.com/todos/1', headers: '', body: '' },
      position: { x: 260, y: 280 },
    },
    {
      id: 'code',
      type: 'code',
      name: '提取字段',
      config: { code: 'return { completed: inputs.http.data.completed, title: inputs.http.data.title };' },
      position: { x: 480, y: 280 },
    },
    {
      id: 'condition',
      type: 'condition',
      name: '已完成?',
      config: { expression: 'inputs.code.completed === true' },
      position: { x: 700, y: 280 },
    },
    {
      id: 'text',
      type: 'text',
      name: '完成文案',
      config: { content: '✅ 待办已完成：{{inputs.code.title}}' },
      position: { x: 940, y: 120 },
    },
    {
      id: 'llm',
      type: 'llm',
      name: 'AI 点评',
      config: { system: '你是效率教练', prompt: '用一句话点评这条待办：{{inputs.code.title}}', model: '', temperature: 0.7 },
      position: { x: 940, y: 440 },
    },
    { id: 'end', type: 'end', name: '结束', config: {}, position: { x: 1180, y: 280 } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'http' },
    { id: 'e2', source: 'http', target: 'code' },
    { id: 'e3', source: 'code', target: 'condition' },
    { id: 'e4', source: 'condition', sourceHandle: 'true', target: 'text' },
    { id: 'e5', source: 'condition', sourceHandle: 'false', target: 'llm' },
    { id: 'e6', source: 'text', target: 'end' },
    { id: 'e7', source: 'llm', target: 'end' },
  ],
};

export function seedDemo() {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM workflows').get();
  if (c > 0) return;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workflows (id, name, definition, created_at, updated_at) VALUES (?,?,?,?,?)').run(
    id,
    '示例：待办分析与点评',
    JSON.stringify(DEMO_DEFINITION),
    now,
    now,
  );
  console.log('[wf-server] 已创建示例工作流「示例：待办分析与点评」');
}
