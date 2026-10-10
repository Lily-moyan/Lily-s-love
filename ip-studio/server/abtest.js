/* 提示词 A/B 与 eval 打分
 *
 * 一条设计上的取舍先说在前面：**不用大模型给自己的输出打分。**
 * 这个项目一路的结论是模型在"给点评价"的压力下一定会顺着说
 *（成稿检查那里实测过：不加代码过滤就会凑一堆"符合…但…"）。
 * 让它当裁判，得到的是一堆和气的分数，不是信号。
 *
 * 所以打分分两层：
 *   1. 确定性指标——字数、格式痕迹、护栏命中数。客观、可复现、不花钱。
 *   2. 盲测人工对比——两栏并排、隐去变体名，人选一个。慢，但这是唯一可信的主观判断。
 */

import { Variants } from './db.js';
import { PLATFORMS } from './prompts.js';

/* 按权重挑一个生效变体；没有生效变体就用代码里内置的那份 */
export function pickVariant(feature, builtin) {
  const list = Variants.active(feature);
  if (!list.length) return { system: builtin, name: '内置', id: null };

  // 内置那份也参与分流，否则一开 A/B 就等于全量换新提示词
  const pool = [{ id: null, name: '内置', system: builtin, weight: 1 }, ...list];
  const total = pool.reduce((n, v) => n + Math.max(0, v.weight), 0);
  let r = Math.random() * total;
  for (const v of pool) {
    r -= Math.max(0, v.weight);
    if (r <= 0) return { system: v.system, name: v.name, id: v.id };
  }
  return { system: builtin, name: '内置', id: null };
}

/* ---------------- 确定性指标 ---------------- */

/* 原平台的格式痕迹被带到别处，是多平台改写里最常见的错。
   这些正则本来就用在成稿检查那条链路上，这里复用同一套判断。 */
const TRACES = [
  [/【(口播|画面|字幕|转场)】/g, '口播脚本的分栏标注'],
  [/#[^\s#]{2,20}/g, '话题标签'],
  [/^\s*(以下是|这是一篇|好的[，,])/m, '交付前言'],
];

export function scoreText(text, { platform } = {}) {
  const t = String(text || '');
  const spec = PLATFORMS[platform];
  const traces = TRACES.flatMap(([re, label]) => {
    const hit = t.match(re);
    return hit ? [{ label, count: hit.length }] : [];
  });

  return {
    chars: t.length,
    // 目标字数的偏离比例——负数是没写够，正数是超了
    lengthOff: spec ? +(((t.length - spec.length) / spec.length) * 100).toFixed(0) : null,
    target: spec?.length ?? null,
    traces,
    traceCount: traces.reduce((n, x) => n + x.count, 0),
    paragraphs: t.split(/\n{2,}/).filter((s) => s.trim()).length,
    // 平均段长：太长说明没分段，太短说明碎
    avgPara: t.trim() ? Math.round(t.replace(/\n/g, '').length
      / Math.max(1, t.split(/\n{2,}/).filter((s) => s.trim()).length)) : 0,
  };
}

/* 选题方向这类结构化输出，看的是"约束有没有被满足"，不是文字本身 */
export function scoreTopics(data) {
  const list = Array.isArray(data?.topics) ? data.topics : [];
  const labels = list.map((t) => String(t?.label || '').trim()).filter(Boolean);
  const angles = list.map((t) => String(t?.angle || ''));
  return {
    count: list.length,
    // 标签必须互不相同，重了等于没分类
    labelsUnique: labels.length === new Set(labels).size,
    labelsFilled: labels.length,
    // 差异说明里有没有真的做对照
    contrastive: angles.filter((a) => /而不是|不同于|区别于|相比/.test(a)).length,
    avgOutline: list.length
      ? +(list.reduce((n, t) => n + (t.outline?.length || 0), 0) / list.length).toFixed(1) : 0,
    emptyFields: list.reduce((n, t) =>
      n + ['label', 'title', 'angle', 'hook'].filter((k) => !String(t?.[k] || '').trim()).length, 0),
  };
}

/* 汇总一批结果：每个变体的各项指标取中位数。
   和复盘那边同一个理由——一条离谱的样本会把平均值带偏。 */
export function summarize(runs) {
  const median = (nums) => {
    const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
    if (!a.length) return null;
    const i = Math.floor(a.length / 2);
    return a.length % 2 ? a[i] : +((a[i - 1] + a[i]) / 2).toFixed(1);
  };

  const byVariant = new Map();
  for (const r of runs) {
    if (!byVariant.has(r.variant_name)) byVariant.set(r.variant_name, []);
    byVariant.get(r.variant_name).push(r);
  }

  return [...byVariant.entries()].map(([name, list]) => {
    const scores = list.map((r) => { try { return JSON.parse(r.scores_json); } catch { return {}; } });
    const pick = (k) => median(scores.map((s) => s[k]));
    return {
      name,
      runs: list.length,
      failed: list.filter((r) => r.error).length,
      ms: median(list.map((r) => r.ms)),
      chars: pick('chars'),
      lengthOff: pick('lengthOff'),
      traceCount: pick('traceCount'),
      // 结构化输出那几项
      labelsUnique: scores.filter((s) => s.labelsUnique).length,
      contrastive: pick('contrastive'),
      emptyFields: pick('emptyFields'),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
