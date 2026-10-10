export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select';
  options?: string[];
  placeholder?: string;
  rows?: number;
  default?: string | number;
}

export interface NodeTypeMeta {
  type: string;
  label: string;
  category: string;
  color: string;
  description: string;
  schema: ConfigField[];
}

export interface WFNode {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface WFEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowDefinition {
  version: number;
  nodes: WFNode[];
  edges: WFEdge[];
}

export interface Workflow {
  id: string;
  name: string;
  definition: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
  runCount?: number;
  nodeCount?: number;
  edgeCount?: number;
}

export type NodeRunStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface NodeRunResult {
  status: NodeRunStatus;
  output?: unknown;
  error?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface Run {
  id: string;
  workflowId: string;
  status: 'running' | 'success' | 'error';
  input: unknown;
  nodeOutputs: Record<string, NodeRunResult>;
  error?: string;
  createdAt: string;
  endedAt?: string;
  workflowName?: string;
}

export const STATUS_TEXT: Record<string, string> = {
  pending: '等待',
  running: '运行中',
  success: '成功',
  error: '失败',
  skipped: '跳过',
};
