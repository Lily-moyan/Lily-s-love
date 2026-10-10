/* 套餐与点数
 *
 * 为什么用统一点数而不是分项配额（「每月 100 张图」）：
 * 产品有两种成本单位（token / 张），单价差几十倍。
 * 分项限额看着直观，但用户不用的那项就浪费了，而且每次调价都要重设。
 * 点数按成本折算成一个池子，界面上再换算成"≈ 多少篇稿子 / 多少张图"给人看。
 *
 * 1 点 ≈ 0.01 元成本。定价时在成本上加毛利，这里只负责计量。
 */

export const CREDIT_YUAN = 0.01;

/* 各功能每单位消耗多少点。按 pricing.js 里的成本单价折算，取整到便于理解的数。 */
export const COST = {
  // 大模型：按千 token。一篇成稿来回大概 6-10k token
  文案: { per: 1000, unit: 'token', credits: 0.4 },
  // 出图：按张
  图文配图: { per: 1, unit: '张', credits: 14 },
};

/* 文案类功能共用一档计价——它们都是大模型调用，区别只在提示词 */
const TEXT_FEATURES = new Set([
  '选题方向', '选题方向·换一批', '成稿', '成稿检查', '题材推荐', '语气档案',
  '划词改写', '编辑器续写', '热点比对', '原文概要', '口播提示',
  '多平台适配', '图文配图方案',
]);

export const costOf = (feature) => (TEXT_FEATURES.has(feature) ? COST.文案 : COST[feature] || null);

/* 折算：某个功能用了多少单位 = 多少点。算不出来返回 0（不计费也不拦） */
export function creditsFor(feature, units) {
  const c = costOf(feature);
  if (!c || !units) return 0;
  return Math.ceil((units / c.per) * c.credits);
}

/* 套餐。写在代码里不入库——套餐是产品决策，改它应该走发布流程，不该在后台点两下就变。
 *
 * free 刻意不开放出图：那是真金白银，免费送必被薅。
 * 文案额度足够让人试出价值，出图是付费的钩子。 */
export const PLANS = {
  free: {
    key: 'free', label: '免费', price: 0,
    credits: 150,
    blocked: ['图文配图'],
    note: '够试出价值：写几十篇稿子。出图要升级。',
  },
  pro: {
    key: 'pro', label: 'Pro', price: 49,
    credits: 2000,
    blocked: [],
    note: '主力档。写稿、配图管够。',
  },
  max: {
    key: 'max', label: 'Max', price: 199,
    credits: 9000,
    blocked: [],
    note: '重度使用。',
  },
};

/* 加购包。当前没有在售的包；结构保留，以后要按量加购某个功能时在这里加。 */
export const PACKS = {};

export const planOf = (key) => PLANS[key] || PLANS.free;

/* 把点数换算回人话——用户看不懂"还剩 1200 点"，得告诉他这还能干什么。
   注意每一项都是"**全部**用来做这个"，不是可以同时都做。 */
export function explain(credits, plan) {
  const blocked = new Set(plan?.blocked || []);
  return [
    { what: '篇成稿', n: Math.floor(credits / creditsFor('成稿', 8000)), key: '成稿' },
    { what: '张配图', n: Math.floor(credits / COST.图文配图.credits), key: '图文配图' },
  ].filter((x) => x.n > 0 && !blocked.has(x.key));
}

/* 这个套餐一个月的封顶成本——定价时看的是这个数，不是点数 */
export const costCeiling = (plan) => +(plan.credits * CREDIT_YUAN).toFixed(2);

/* 计费周期：自然月。用注册日算周期会让"这个月还剩多少"变得没法沟通 */
export const periodOf = (d = new Date()) => d.toISOString().slice(0, 7);
