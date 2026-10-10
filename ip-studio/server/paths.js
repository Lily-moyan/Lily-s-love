/* 项目根目录：以源码位置为准，避免受启动时的工作目录影响 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const fromRoot = (...p) => resolve(ROOT, ...p);
