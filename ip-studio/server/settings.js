/* 配置读取：环境变量优先，数据库兜底。
 *
 * 为什么 env 优先：生产环境应该能完全锁死在环境变量里——
 * 那样即使后台被攻破，也改不动收款配置。后台管理只负责填 env 没配的那部分，
 * 界面上会标出哪些来自 env（因而在后台不可改）。
 */

import { Settings } from './db.js';
import { decrypt, encrypt, mask } from './secrets.js';

/* 可在后台管理的项。secret 的永远不回原文。 */
export const FIELDS = [
  { group: '支付', key: 'PAY_PROVIDER', label: '支付通道', hint: 'mock / wechat / alipay' },
  { group: '支付', key: 'PAY_NOTIFY_BASE', label: '回调地址前缀', hint: 'https://你的域名，必须公网可达' },
  { group: '微信支付', key: 'WX_MCHID', label: '商户号' },
  { group: '微信支付', key: 'WX_APPID', label: 'AppID' },
  { group: '微信支付', key: 'WX_CERT_SERIAL', label: '证书序列号' },
  { group: '微信支付', key: 'WX_API_V3_KEY', label: 'APIv3 密钥', secret: true, hint: '32 位' },
  { group: '微信支付', key: 'WX_PRIVATE_KEY', label: '商户私钥', secret: true, multiline: true, hint: 'PEM 全文' },
  { group: '支付宝', key: 'ALI_APP_ID', label: 'AppID' },
  { group: '支付宝', key: 'ALI_PRIVATE_KEY', label: '应用私钥', secret: true, multiline: true, hint: 'PEM 全文' },
  { group: '支付宝', key: 'ALI_PUBLIC_KEY', label: '支付宝公钥', secret: true, multiline: true, hint: '验签用，别填成自己的公钥' },
];

const BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

/* 取一个配置。env 有就用 env，否则读库（secret 的解密）。 */
export function conf(key) {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  const row = Settings.get(key);
  if (!row) return '';
  return row.secret ? decrypt(row.v) : row.v;
}

/* 给后台看的状态。**不回原文**，只回来源和预览。 */
export function status() {
  return FIELDS.map((f) => {
    const env = Boolean(process.env[f.key]);
    const row = env ? null : Settings.get(f.key);
    const val = env ? process.env[f.key] : (row ? (row.secret ? decrypt(row.v) : row.v) : '');
    return {
      ...f,
      source: env ? 'env' : (row ? 'db' : ''),
      configured: Boolean(val),
      // 非敏感项可以直接看（回调地址这种本来就是公开的），敏感项只给预览
      preview: f.secret ? mask(val) : val,
      locked: env,          // env 配了的，后台不给改
      updatedAt: row?.updated_at || '',
    };
  });
}

export function save(key, value, by) {
  const f = BY_KEY[key];
  if (!f) throw new Error('不认识这个配置项');
  if (process.env[key]) throw new Error(`${f.label} 由环境变量提供，请在服务器上改`);
  const v = String(value ?? '');
  if (!v) { Settings.remove(key); return; }
  Settings.set(key, f.secret ? encrypt(v) : v, f.secret, by);
}
