/* 敏感配置的加密存储
 *
 * 商户私钥能以你的名义签名收款，泄露的后果比 API key 严重得多。
 * 所以不明文入库：用 AES-256-GCM 加密，**密钥留在环境变量里**——
 * 这样只拿到数据库文件（备份、开发副本、误传的 dump）是解不开的。
 *
 * 这不是万能的：能读到进程环境的人照样能解。它挡的是"数据库泄露"这一类，
 * 而那恰好是最常见的一类。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

let warned = false;

function key() {
  const s = process.env.SECRET_KEY || '';
  if (!s) {
    // 没配就用一个从数据库路径派生的弱密钥——能跑，但等于没加密，所以要吵
    if (!warned) {
      warned = true;
      console.warn('[secrets] 没有设置 SECRET_KEY，敏感配置的加密形同虚设。'
        + '生产环境务必设置一个随机的 32 位以上字符串，并且**不要**跟数据库放在一起备份。');
    }
    return createHash('sha256').update('cw-insecure-default').digest();
  }
  return createHash('sha256').update(s).digest();
}

export const hasKey = () => Boolean(process.env.SECRET_KEY);

export function encrypt(plain) {
  if (!plain) return '';
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(blob) {
  if (!blob) return '';
  try {
    const [v, iv, tag, data] = String(blob).split(':');
    if (v !== 'v1') return '';
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    // 换过 SECRET_KEY 之后旧数据解不开——返回空而不是抛，
    // 让"这项没配置"的路径接住它，而不是把整个服务打挂
    return '';
  }
}

/* 给界面看的预览。永远不回原文——回了就等于没有"只写不读"。 */
export function mask(plain) {
  const s = String(plain || '');
  if (!s) return '';
  if (s.includes('BEGIN') && s.includes('KEY')) return `PEM 私钥 · ${s.length} 字符`;
  if (s.length <= 8) return '****';
  return `****${s.slice(-4)}`;
}
