// 集中配置。所有魔法数字只在这里出现一次，方便以后调。
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const DATA_DIR = join(ROOT, 'data')
export const KNOWLEDGE_DIR = join(ROOT, 'knowledge')
mkdirSync(DATA_DIR, { recursive: true })

export const PORT = Number(process.env.PORT || 8787)
export const HOST = process.env.HOST || '0.0.0.0'

// 每单最多追问轮数：低于 3 轮信息不够，高于 5 轮客户会当成问卷而流失。
export const MIN_ROUNDS = 3
export const MAX_ROUNDS = 5

// 模型路由：任何 OpenAI 兼容端点都能用，换供应商只改这几个环境变量。
export const LLM = {
  baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
  model: process.env.LLM_MODEL || 'deepseek-chat',
  apiKeyEnv: process.env.LLM_API_KEY_ENV || 'DEEPSEEK_API_KEY',
  // 收尾的盖章稿用于对比草稿；不配就退化成单稿 + 审校。
  judgeModel: process.env.LLM_JUDGE_MODEL || '',
}

// 自己没配 key 时，回落到 DSH 凭据库 —— 本地 vibe coding 阶段用，上线前请换成专属 key。
export const DSH_HOME = process.env.DSH_HOME || join(homedir(), 'AppData', 'Roaming', 'dsh-desktop', 'harness')

export const COPY = {
  productName: '情感策略卡',
  // 下面这几项是给客户的承诺，改这里就等于改你对外的口径。
  turnaround: '24 小时内',
  price: '¥39',
  // 承接人自称（会出现在策略卡的「我的判断」署名里）
  consultant: process.env.CONSULTANT_NAME || '我',
}

export const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'app.db')
export const ARCHIVE_PATH = join(DATA_DIR, 'archive.jsonl')

// 公开访问地址：部署后设 PUBLIC_BASE_URL，生成的链接才带对的域名。
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '')
