/* 配图生成接入层
 *   dashscope —— 阿里云百炼 通义万相（异步任务：提交 → 轮询 → 拿图片地址）
 *   openai    —— 任意 OpenAI 兼容的 /v1/images/generations
 *   mock      —— 本地画一张带文字的 SVG，没密钥也能把整条链路和视频合成跑通
 *
 * 和 llm.js 一个套路：一个函数一个 provider。
 */

const IMG_TIMEOUT = 120000;      // 文生图不快，万相 turbo 实测十几秒起
const POLL_EVERY = 2000;

const cfg = () => ({
  // 出图按张计费，**必须显式开**——配了 DASHSCOPE_API_KEY 不代表想让它去画图。
  provider: (process.env.IMAGE_PROVIDER || 'mock').toLowerCase(),
  dashKey: process.env.DASHSCOPE_API_KEY || '',
  dashModel: process.env.DASHSCOPE_IMAGE_MODEL || 'wan2.2-t2i-flash',
  openaiKey: process.env.IMAGE_API_KEY || '',
  openaiBase: (process.env.IMAGE_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  openaiModel: process.env.IMAGE_MODEL || 'gpt-image-1',
});

/* 竖屏是自媒体的默认形态；横屏留给做长视频的 */
export const RATIOS = {
  portrait: { label: '竖屏 9:16', w: 720, h: 1280, dash: '720*1280', openai: '1024x1536' },
  landscape: { label: '横屏 16:9', w: 1280, h: 720, dash: '1280*720', openai: '1536x1024' },
  square: { label: '方图 1:1', w: 1024, h: 1024, dash: '1024*1024', openai: '1024x1024' },
};

export function imageInfo() {
  const c = cfg();
  const live = c.provider !== 'mock';
  return {
    provider: c.provider,
    model: c.provider === 'dashscope' ? c.dashModel : c.provider === 'openai' ? c.openaiModel : '本地占位图',
    label: c.provider === 'dashscope' ? `阿里云百炼 · ${c.dashModel}`
      : c.provider === 'openai' ? `OpenAI 兼容 · ${c.openaiModel}` : '演示模式（不调外部服务）',
    live,
    ratios: Object.entries(RATIOS).map(([key, v]) => ({ key, label: v.label })),
  };
}

export async function generate({ prompt, ratio = 'portrait', negative = '' }) {
  const c = cfg();
  const text = String(prompt || '').trim();
  if (!text) throw new Error('没有画面提示词');
  const size = RATIOS[ratio] ? ratio : 'portrait';

  switch (c.provider) {
    case 'dashscope': return wanx(c, { prompt: text, size, negative });
    case 'openai': return openaiImage(c, { prompt: text, size });
    default: return placeholder(text, size);
  }
}

/* ------------------------------------------------------------------ *
 * 通义万相：异步任务制，提交拿 task_id，再轮询
 * ------------------------------------------------------------------ */
async function wanx(c, { prompt, size, negative }) {
  if (!c.dashKey) throw new Error('缺少 DASHSCOPE_API_KEY');

  const submit = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
    method: 'POST',
    signal: AbortSignal.timeout(IMG_TIMEOUT),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${c.dashKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: c.dashModel,
      input: { prompt, ...(negative ? { negative_prompt: negative } : {}) },
      parameters: { size: RATIOS[size].dash, n: 1, prompt_extend: true },
    }),
  });
  const started = await submit.json().catch(() => ({}));
  if (!submit.ok) throw new Error(`万相返回 ${submit.status}${started?.message ? `：${started.message}` : ''}`);
  const taskId = started?.output?.task_id;
  if (!taskId) throw new Error(started?.message || '万相没有返回任务号');

  const deadline = Date.now() + IMG_TIMEOUT;
  for (;;) {
    await new Promise((r) => { setTimeout(r, POLL_EVERY); });
    const res = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${c.dashKey}` },
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json().catch(() => ({}));
    const status = data?.output?.task_status;

    if (status === 'SUCCEEDED') {
      const hit = data.output.results?.[0];
      // 万相会单独驳回违规的提示词，这条要原样透出来，不然用户不知道改哪
      if (!hit?.url) throw new Error(hit?.message || hit?.code || '万相没有返回图片地址');
      return download(hit.url);
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new Error(data?.output?.message || data?.message || `万相任务${status}`);
    }
    if (Date.now() > deadline) throw new Error('万相出图超时，稍后重试或换 turbo 模型');
  }
}

async function openaiImage(c, { prompt, size }) {
  if (!c.openaiKey) throw new Error('缺少 IMAGE_API_KEY');
  const res = await fetch(`${c.openaiBase}/images/generations`, {
    method: 'POST',
    signal: AbortSignal.timeout(IMG_TIMEOUT),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.openaiKey}` },
    body: JSON.stringify({ model: c.openaiModel, prompt, n: 1, size: RATIOS[size].openai }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`出图返回 ${res.status}${data?.error?.message ? `：${data.error.message}` : ''}`);
  const hit = data?.data?.[0];
  if (hit?.b64_json) return { buffer: Buffer.from(hit.b64_json, 'base64'), mime: 'image/png', ext: 'png' };
  if (hit?.url) return download(hit.url);
  throw new Error('出图接口没有返回图片');
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(IMG_TIMEOUT) });
  if (!res.ok) throw new Error(`下载图片失败 ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const png = buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG';
  const webp = buffer.toString('ascii', 8, 12) === 'WEBP';
  return {
    buffer,
    mime: png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg',
    ext: png ? 'png' : webp ? 'webp' : 'jpg',
  };
}

/* 演示模式：画一张带提示词的渐变图。
   不是为了好看，是为了没密钥的时候整条配图链路都能跑通验证。 */
function placeholder(prompt, size) {
  const { w, h } = RATIOS[size];
  const esc = (t) => String(t).replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m]));
  const hue = [...prompt].reduce((n, ch) => (n * 31 + ch.codePointAt(0)) % 360, 7);
  const lines = [];
  for (let i = 0; i < prompt.length && lines.length < 6; i += 12) lines.push(prompt.slice(i, i + 12));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 62% 32%)"/><stop offset="1" stop-color="hsl(${(hue + 48) % 360} 58% 16%)"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <text x="${w / 2}" y="${h / 2 - lines.length * 26}" fill="rgba(255,255,255,.45)"
        font-size="26" font-family="sans-serif" text-anchor="middle">演示模式配图</text>
  ${lines.map((l, i) => `<text x="${w / 2}" y="${h / 2 + i * 52}" fill="#fff" font-size="40"
        font-family="sans-serif" text-anchor="middle">${esc(l)}</text>`).join('\n  ')}
</svg>`;
  return { buffer: Buffer.from(svg, 'utf8'), mime: 'image/svg+xml', ext: 'svg' };
}
