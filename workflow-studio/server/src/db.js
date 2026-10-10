import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.WF_DATA_DIR || path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'workflow.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  input TEXT NOT NULL DEFAULT '{}',
  node_outputs TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_wf ON runs(workflow_id, created_at DESC);
`);

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export function parseWorkflow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    definition: safeJson(row.definition),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status,
    input: safeJson(row.input),
    nodeOutputs: safeJson(row.node_outputs),
    error: row.error || undefined,
    createdAt: row.created_at,
    endedAt: row.ended_at || undefined,
  };
}
