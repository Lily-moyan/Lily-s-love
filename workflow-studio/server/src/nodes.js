import vm from 'node:vm';

// ---------- 模板渲染 ----------
export function renderTemplate(tpl, inputs, fallback = '') {
  if (typeof tpl !== 'string') return tpl;
  return tpl.replace(/\{\{\s*([\w.$[\]]+)\s*\}\}/g, (_m, key) => {
    const val = resolvePath(key.trim(), inputs);
    return val === undefined || val === null ? fallback : formatVal(val);
  });
}

function resolvePath(pathStr, obj) {
  let p = pathStr.replace(/^inputs\./, '');
  if (p === '' || p === 'inputs') return obj;
  const segs = p.split(/[.[]/).map((s) => s.replace(/[\]]/g, ''));
  let cur = obj;
  for (const s of segs) {
    if (s === '') continue;
    if (cur == null) return undefined;
    cur = cur[s];
  }
  return cur;
}

function formatVal(v) {
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// ---------- JS 沙箱 ----------
async function runJs(code, inputs, timeoutMs) {
  const sandbox = {
    inputs,
    JSON,
    Math,
    Date,
    fetch,
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    setTimeout,
    clearTimeout,
  };
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: 'workflow-code.js' });
  return script.runInContext(ctx, { timeout: timeoutMs });
}

// ---------- HTTP ----------
async function httpRequest(config) {
  const { method = 'GET', url = '', headers = '', body = '' } = config;
  if (!url) throw new Error('缺少 URL');
  let headerObj = {};
  if (String(headers).trim()) {
    try { headerObj = JSON.parse(headers); } catch { throw new Error('headers 不是合法 JSON'); }
  }
  const res = await fetch(url, {
    method,
    headers: headerObj,
    body: ['GET', 'HEAD'].includes(method) ? undefined : body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return {
    status: res.status,
    statusText: res.statusText,
    data,
    headers: Object.fromEntries(res.headers.entries()),
  };
}

// ---------- LLM（OpenAI 兼容接口，默认 DeepSeek） ----------
async function llmCall(config, inputs) {
  const base = (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const key = process.env.LLM_API_KEY || '';
  const model = config.model || process.env.LLM_MODEL || 'deepseek-chat';
  const system = renderTemplate(config.system || '', inputs);
  const prompt = renderTemplate(config.prompt || '', inputs);
  const temperature =
    config.temperature === undefined || config.temperature === '' || Number.isNaN(Number(config.temperature))
      ? 0.7
      : Number(config.temperature);
  if (!key) {
    return {
      content: `[mock] 未配置 LLM_API_KEY，此处为模拟输出。\nsystem: ${system || '(空)'}\nprompt: ${prompt || '(空)'}`,
      usage: null,
      mock: true,
    };
  }
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      temperature,
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (content === undefined) throw new Error('LLM 返回格式异常: ' + JSON.stringify(json).slice(0, 300));
  return { content, usage: json.usage || null, model: json.model || model, mock: false };
}

// ---------- 节点注册表 ----------
export const NODE_TYPES = {
  start: {
    label: '开始',
    category: '基础',
    color: '#10b981',
    description: '工作流入口，输出运行时的输入数据',
    schema: [],
    async run({ runInput }) { return runInput; },
  },
  text: {
    label: '文本',
    category: '基础',
    color: '#0ea5e9',
    description: '输出一段静态/模板文本',
    schema: [
      { key: 'content', label: '内容', type: 'textarea', rows: 4, placeholder: '支持 {{xxx}} 或 {{inputs.xxx}} 模板语法' },
    ],
    async run({ config, inputs }) { return renderTemplate(config.content || '', inputs); },
  },
  http: {
    label: 'HTTP 请求',
    category: '集成',
    color: '#8b5cf6',
    description: '调用外部 HTTP 接口，输出 {status, data, headers}',
    schema: [
      { key: 'method', label: '方法', type: 'select', options: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://api.example.com/...（支持模板）' },
      { key: 'headers', label: 'Headers (JSON)', type: 'textarea', rows: 3, placeholder: '{"Authorization":"Bearer ..."}' },
      { key: 'body', label: 'Body', type: 'textarea', rows: 4, placeholder: 'POST/PUT 时的请求体（支持模板）' },
    ],
    async run({ config, inputs }) {
      return httpRequest({
        ...config,
        url: renderTemplate(config.url || '', inputs),
        body: renderTemplate(config.body || '', inputs),
      });
    },
  },
  code: {
    label: '代码',
    category: '逻辑',
    color: '#f59e0b',
    description: '执行一段 JavaScript（沙箱内，可 await，return 的值作为输出）',
    schema: [
      { key: 'code', label: '代码', type: 'textarea', rows: 12, placeholder: 'const a = inputs.http.data;\nreturn { ok: a && a.title };' },
    ],
    async run({ config, inputs }) { return runJs(config.code || '', inputs, 5000); },
  },
  condition: {
    label: '条件分支',
    category: '逻辑',
    color: '#ef4444',
    description: '求值表达式，为真走「是」分支，否则走「否」分支',
    schema: [
      { key: 'expression', label: '表达式', type: 'text', placeholder: '例如 inputs.code.ok === true' },
    ],
    async run({ config, inputs }) {
      return Boolean(await runJs(`return (${config.expression || 'true'})`, inputs, 3000));
    },
  },
  llm: {
    label: '大模型',
    category: 'AI',
    color: '#6366f1',
    description: '调用 OpenAI 兼容接口（默认 DeepSeek，可用环境变量配置）',
    schema: [
      { key: 'system', label: 'System 提示词', type: 'textarea', rows: 3 },
      { key: 'prompt', label: '用户提示词', type: 'textarea', rows: 5, placeholder: '支持 {{inputs.xxx}} 模板' },
      { key: 'model', label: '模型', type: 'text', placeholder: '默认 LLM_MODEL / deepseek-chat' },
      { key: 'temperature', label: 'temperature', type: 'number', default: 0.7 },
    ],
    async run({ config, inputs }) { return llmCall(config, inputs); },
  },
  end: {
    label: '结束',
    category: '基础',
    color: '#64748b',
    description: '汇聚上游输出，作为工作流最终结果',
    schema: [],
    async run({ inputs }) {
      const keys = Object.keys(inputs);
      if (keys.length === 0) return '完成';
      if (keys.length === 1) return inputs[keys[0]];
      return inputs;
    },
  },
};

export function nodeTypeMeta() {
  return Object.entries(NODE_TYPES).map(([type, t]) => ({
    type,
    label: t.label,
    category: t.category,
    color: t.color,
    description: t.description,
    schema: t.schema,
  }));
}
