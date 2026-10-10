/* 计费单价表
 *
 * 这些是各家官网公示的价格，**只用来估算**——真实账单以服务商控制台为准。
 * 单价会调、会有阶梯、会有免费额度，所以界面上一律标成"估算"，
 * 并把免费额度也列出来，免得看到一个数字就当成真花了这么多。
 *
 * 想改价格不用动代码：PRICING_JSON 环境变量给一份覆盖就行。
 */

const BASE = {
  // 阿里云百炼（通义万相出图）
  'wan2.2-t2i-flash': { unit: '张', per: 1, price: 0.14, free: '500 张' },
  'wanx2.1-t2i-turbo': { unit: '张', per: 1, price: 0.14, free: '500 张' },

  // 大模型按 token（输入/输出分开，这里取一个折中的估值，只为看量级）
  'deepseek-chat': { unit: 'token', per: 1e6, price: 4, free: '—', note: '输入/输出单价不同，这里取中间值估算' },
};

/* 找不到精确型号就按族猜一个——总比完全不计强，界面上会标出来是猜的。 */
const FAMILY = [
  [/^wanx?[\d.]*-t2i/i, 'wan2.2-t2i-flash'],
  [/^deepseek/i, 'deepseek-chat'],
];

export function priceOf(model) {
  const m = String(model || '');
  if (BASE[m]) return { ...BASE[m], exact: true };
  const hit = FAMILY.find(([re]) => re.test(m));
  return hit && BASE[hit[1]] ? { ...BASE[hit[1]], exact: false } : null;
}

export function loadPricing() {
  try {
    const over = JSON.parse(process.env.PRICING_JSON || '{}');
    Object.assign(BASE, over);
  } catch { /* 配错了就用内置的，不因为一个环境变量把服务搞挂 */ }
  return BASE;
}

export const PRICING = () => BASE;

/* 一条用量记录值多少钱。算不出来返回 null——宁可显示"未计价"，也不要编一个数字 */
export function costOf(row) {
  // 演示模式没调外部服务，不该出现在账上——它照样会记模型名（环境变量里配着）
  if (String(row.provider || '').toLowerCase() === 'mock') return null;
  const p = priceOf(row.model);
  if (!p) return null;
  const units = p.unit === 'token'
    ? (row.input_tokens || 0) + (row.output_tokens || 0)
    : Number(row.units) || 0;
  if (!units) return null;
  return { yuan: (units / p.per) * p.price, units, unit: p.unit, exact: p.exact };
}
