// 存储层：node:sqlite（Node 22+ 内置，零依赖）。
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, createHash } from 'node:crypto'
import { DB_PATH } from './config.mjs'

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  stage         TEXT NOT NULL DEFAULT 'chat',   -- chat | blocked | card
  risk_category TEXT,                            -- domestic_violence | self_harm | legal | minor | null
  messages      TEXT NOT NULL,                   -- JSON: [{role,content}]
  card          TEXT,                            -- JSON: 卡片草稿
  consent_archive INTEGER NOT NULL DEFAULT 0,    -- 客户是否同意脱敏入库
  client_label  TEXT                             -- 你自己认人的备注，例如「小A-同事」
);

CREATE TABLE IF NOT EXISTS cards (
  id               TEXT PRIMARY KEY,             -- 公开访问 token
  session_id       TEXT NOT NULL REFERENCES sessions(id),
  admin_token      TEXT NOT NULL,                -- 只有你能进的批注页 token
  status           TEXT NOT NULL DEFAULT 'draft',-- draft | ready(done) | archived
  card             TEXT NOT NULL,                -- JSON: 真人盖章后的最终卡片
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_admin ON cards(admin_token);

CREATE TABLE IF NOT EXISTS archives (
  id             TEXT PRIMARY KEY,
  source_card_id TEXT,                           -- 来源卡片，可追溯
  summary        TEXT NOT NULL,                  -- 你确认过的脱敏摘要（唯一进入检索的内容）
  tags           TEXT NOT NULL,                  -- JSON: {stage, conflict, behavior, move}
  result         TEXT,                           -- 结果如何，用于以后回访补全
  created_at     TEXT NOT NULL
);
`)

export const now = () => new Date().toISOString()
export const newId = (bytes = 16) => randomBytes(bytes).toString('base64url')

// 客户看到的展示编号。不暴露数据库 id。
export const ticket = (id) => createHash('sha256').update(id).digest('hex').slice(0, 4).toUpperCase()

export function createSession(label = '') {
  const id = newId()
  const ts = now()
  db.prepare(
    `INSERT INTO sessions (id, created_at, updated_at, stage, messages, client_label)
     VALUES (?, ?, ?, 'chat', '[]', ?)`,
  ).run(id, ts, ts, label)
  return getSession(id)
}

export function getSession(id) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!row) return null
  return {
    ...row,
    messages: JSON.parse(row.messages || '[]'),
    card: row.card ? JSON.parse(row.card) : null,
    consent_archive: Number(row.consent_archive) || 0,
  }
}

export function updateSession(id, patch) {
  const current = getSession(id)
  if (!current) return null
  const next = {
    stage: patch.stage ?? current.stage,
    risk_category: patch.risk_category ?? current.risk_category,
    messages: JSON.stringify(patch.messages ?? current.messages),
    card: patch.card === undefined ? (current.card ? JSON.stringify(current.card) : null) : JSON.stringify(patch.card),
    consent_archive: patch.consent_archive ?? current.consent_archive,
    client_label: patch.client_label ?? current.client_label,
  }
  db.prepare(
    `UPDATE sessions SET updated_at = ?, stage = ?, risk_category = ?, messages = ?, card = ?, consent_archive = ?, client_label = ?
     WHERE id = ?`,
  ).run(now(), next.stage, next.risk_category, next.messages, next.card, next.consent_archive, next.client_label, id)
  return getSession(id)
}

export function createCard(sessionId, card) {
  const id = newId(12)
  const adminToken = newId(18)
  const ts = now()
  db.prepare(
    `INSERT INTO cards (id, session_id, admin_token, status, card, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
  ).run(id, sessionId, adminToken, JSON.stringify(card), ts, ts)
  return { id, adminToken }
}

export function getCard(id) {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id)
  if (!row) return null
  return { ...row, card: JSON.parse(row.card) }
}

export function getCardByAdminToken(adminToken) {
  const row = db.prepare('SELECT * FROM cards WHERE admin_token = ?').get(adminToken)
  if (!row) return null
  return { ...row, card: JSON.parse(row.card) }
}

export function updateCard(id, card, status) {
  const current = getCard(id)
  if (!current) return null
  db.prepare('UPDATE cards SET card = ?, status = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(card ?? current.card),
    status ?? current.status,
    now(),
    id,
  )
  return getCard(id)
}

export function addArchive({ sourceCardId, summary, tags, result }) {
  const id = newId(10)
  db.prepare(
    `INSERT INTO archives (id, source_card_id, summary, tags, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, sourceCardId ?? null, summary, JSON.stringify(tags || {}), result ?? null, now())
  return id
}

export function listArchives(limit = 50) {
  return db
    .prepare('SELECT * FROM archives ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map((row) => ({ ...row, tags: JSON.parse(row.tags || '{}') }))
}

// 只取结构化字段喂给检索层，绝不返回原始对话。
// 并且只喂"客户已同意 + 已交付"的条目：没同意过的案例不进提示词。
export function archiveContext(limit = 8) {
  const rows = db
    .prepare(
      `SELECT a.* FROM archives a
       LEFT JOIN cards c ON c.id = a.source_card_id
       LEFT JOIN sessions s ON s.id = c.session_id
       WHERE (a.source_card_id IS NULL OR (s.consent_archive = 1 AND c.status IN ('ready','archived')))
       ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(limit)
  if (!rows.length) return ''
  return rows
    .map((r, i) => {
      const t = JSON.parse(r.tags || '{}')
      return [
        `案例${i + 1}｜阶段:${t.stage || '未标'}｜冲突:${t.conflict || '未标'}`,
        `关键行为:${t.behavior || '未标'}`,
        `有效打法:${t.move || '未标'}`,
        `摘要:${r.summary}`,
        r.result ? `结果:${r.result}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}

export function stats() {
  const one = (sql) => Object.values(db.prepare(sql).get() || {})[0] ?? 0
  return {
    sessions: one('SELECT COUNT(*) FROM sessions'),
    cards: one('SELECT COUNT(*) FROM cards'),
    ready: one("SELECT COUNT(*) FROM cards WHERE status = 'ready'"),
    blocked: one("SELECT COUNT(*) FROM sessions WHERE stage = 'blocked'"),
    archives: one('SELECT COUNT(*) FROM archives'),
  }
}

// 最近生成的卡片，附带客户备注和阶段，用于「今日队列」。
export function recentCards(limit = 10) {
  return db
    .prepare(
      `SELECT c.id, c.admin_token, c.status, c.created_at, c.card, s.client_label, s.stage, s.risk_category
       FROM cards c JOIN sessions s ON s.id = c.session_id
       ORDER BY c.created_at DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({ ...row, card: JSON.parse(row.card || '{}') }))
}

export default db
