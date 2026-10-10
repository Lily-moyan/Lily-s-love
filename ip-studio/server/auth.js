/* 账号与会话：scrypt 存密码，随机 token 存 httpOnly cookie */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Users, Sessions, Admins, AdminSessions } from './db.js';

const SESSION_TTL = 1000 * 60 * 60 * 24 * 14; // 14 天
export const COOKIE_NAME = 'cw_session';

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${key}`;
}

function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const a = Buffer.from(key, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return '用户名和密码不能为空';
  if (!/^[\w一-龥.-]{2,24}$/.test(username)) return '用户名 2-24 位，支持中英文、数字、_ . -';
  if (password.length < 6 || password.length > 128) return '密码至少 6 位';
  return null;
}

export function register(username, password) {
  if (Users.byName(username)) throw new HttpError(409, '该用户名已被注册');
  return Users.create(username, hashPassword(password));
}

export function login(username, password) {
  const user = Users.byName(username);
  if (!user || !verifyPassword(password, user.pass_hash)) {
    throw new HttpError(401, '用户名或密码错误');
  }
  return user;
}

export function startSession(user) {
  const token = randomBytes(32).toString('hex');
  Sessions.create(token, user.id, SESSION_TTL);
  return token;
}

export function sessionCookie(token) {
  const maxAge = Math.floor(SESSION_TTL / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export const clearCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

export function currentUser(req) {
  return Sessions.user(readCookie(req, COOKIE_NAME));
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const publicUser = (u) => ({ id: u.id, username: u.username, created_at: u.created_at });

/* ------------------------------------------------------------------ *
 * 管理员：完全独立的账号体系和会话
 * 业务用户的 cookie 进不了后台，管理员的 cookie 也进不了业务接口
 * ------------------------------------------------------------------ */
const ADMIN_COOKIE = 'cw_admin';
const ADMIN_TTL = 1000 * 60 * 60 * 12;   // 后台会话短一些，12 小时

export const adminSetupNeeded = () => Admins.count() === 0;

export function createAdmin(username, password) {
  if (Admins.byName(username)) throw new HttpError(409, '该管理员用户名已存在');
  return Admins.create(username, hashPassword(password));
}

export function adminLogin(username, password) {
  const admin = Admins.byName(username);
  if (!admin || !verifyPassword(password, admin.pass_hash)) {
    throw new HttpError(401, '管理员用户名或密码错误');
  }
  Admins.touch(admin.id);
  return admin;
}

export function startAdminSession(admin) {
  const token = randomBytes(32).toString('hex');
  AdminSessions.create(token, admin.id, ADMIN_TTL);
  return token;
}

export const adminCookie = (token) =>
  `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ADMIN_TTL / 1000)}`;

export const clearAdminCookie = () => `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function currentAdmin(req) {
  return AdminSessions.admin(readCookie(req, ADMIN_COOKIE));
}

export const publicAdmin = (a) => ({ id: a.id, username: a.username, last_login: a.last_login });

setInterval(() => { Sessions.sweep(); AdminSessions.sweep(); }, 1000 * 60 * 60).unref();
