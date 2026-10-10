import type { NodeTypeMeta, Run, Workflow, WorkflowDefinition } from './types';

async function j(res: Response): Promise<any> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const b = await res.json();
      msg = b.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  nodeTypes: () => fetch('/api/nodes/types').then(j) as Promise<NodeTypeMeta[]>,
  listWorkflows: () => fetch('/api/workflows').then(j) as Promise<Workflow[]>,
  createWorkflow: (name: string) =>
    fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(j) as Promise<Workflow>,
  getWorkflow: (id: string) => fetch(`/api/workflows/${id}`).then(j) as Promise<Workflow>,
  saveWorkflow: (id: string, patch: { name?: string; definition?: WorkflowDefinition }) =>
    fetch(`/api/workflows/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(j) as Promise<Workflow>,
  deleteWorkflow: (id: string) => fetch(`/api/workflows/${id}`, { method: 'DELETE' }).then(() => undefined),
  duplicateWorkflow: (id: string) =>
    fetch(`/api/workflows/${id}/duplicate`, { method: 'POST' }).then(j) as Promise<Workflow>,
  startRun: (workflowId: string, input: unknown) =>
    fetch(`/api/workflows/${workflowId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    }).then(j) as Promise<{ id: string }>,
  getRun: (id: string) => fetch(`/api/runs/${id}`).then(j) as Promise<Run>,
  listRuns: (workflowId?: string) =>
    fetch(`/api/runs${workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ''}`).then(j) as Promise<Run[]>,
};
