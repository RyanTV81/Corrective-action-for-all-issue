'use strict';
/**
 * 로그인 · 세션 · 사용자 승인 흐름.
 *
 * 계정은 두 종류다:
 *  - 배포자(관리자) 계정: DASH_USER / DASH_PASSWORD 환경변수로 지정. 승인 절차 없이 항상 로그인 가능하며,
 *    다른 사용자의 가입 신청을 승인/거부할 수 있는 유일한 계정이다.
 *  - 일반 사용자 계정: /api/signup 으로 신청(pending) → 관리자가 승인(approved)해야 로그인할 수 있다.
 *
 * DASH_PASSWORD 를 지정하지 않으면 기동 시마다 임의 비밀번호를 생성해 콘솔에 출력한다(로컬 테스트용).
 */
const crypto = require('crypto');
const users = require('./users');
const mailer = require('./mailer');
const activity = require('./activity');

const ADMIN_USER = process.env.DASH_USER || 'admin';
let ADMIN_PASSWORD = process.env.DASH_PASSWORD;
const generated = !ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일
const sessions = new Map(); // token -> { username, role, expiresAt }

/* ------------------------------------------------------------------ */
/* 공통 헬퍼                                                            */
/* ------------------------------------------------------------------ */

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** 아주 단순한 메모리 내 요청 횟수 제한 (브루트포스·가입폭탄 완화용) */
const buckets = new Map(); // key -> { count, resetAt }
function tooManyAttempts(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count++;
  return b.count > max;
}

/* ------------------------------------------------------------------ */
/* 세션                                                                 */
/* ------------------------------------------------------------------ */

function issueSession(res, username, role) {
  const token = crypto.randomBytes(24).toString('base64url');
  sessions.set(token, { username, role, expiresAt: Date.now() + SESSION_TTL_MS });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `qc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

function clearSession(req, res) {
  const token = parseCookies(req).qc_session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'qc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function sessionOf(req) {
  const token = parseCookies(req).qc_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* 미들웨어 · 라우트 핸들러                                              */
/* ------------------------------------------------------------------ */

function requireAuth(req, res, next) {
  const s = sessionOf(req);
  if (!s) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: '로그인이 필요합니다', code: 'AUTH_REQUIRED' });
    return res.redirect('/login.html');
  }
  req.authUser = s.username;
  req.authRole = s.role;
  next();
}

function requireAdmin(req, res, next) {
  if (req.authRole !== 'admin') return res.status(403).json({ error: '관리자만 사용할 수 있습니다' });
  next();
}

function login(req, res) {
  const key = 'login:' + req.ip;
  if (tooManyAttempts(key, 10, 5 * 60 * 1000)) {
    return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 5분 후 다시 시도하세요.' });
  }

  const { username, password } = req.body || {};

  if (username === ADMIN_USER && safeEqual(password || '', ADMIN_PASSWORD)) {
    issueSession(res, ADMIN_USER, 'admin');
    activity.log({ username: ADMIN_USER, role: 'admin', action: 'login', label: '로그인', ip: req.ip });
    return res.json({ ok: true, role: 'admin' });
  }

  const u = users.verify(username, password || '');
  if (!u) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' });
  }
  if (u.status === 'pending') {
    return res.status(403).json({ error: '아직 관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.', code: 'PENDING' });
  }
  if (u.status === 'rejected') {
    return res.status(403).json({ error: '사용 신청이 거부되었습니다. 관리자에게 문의하세요.', code: 'REJECTED' });
  }

  issueSession(res, u.username, 'user');
  activity.log({ username: u.username, role: 'user', action: 'login', label: '로그인', ip: req.ip });
  res.json({ ok: true, role: 'user' });
}

function logout(req, res) {
  clearSession(req, res);
  res.json({ ok: true });
}

function signup(req, res) {
  const key = 'signup:' + req.ip;
  if (tooManyAttempts(key, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: '신청이 너무 많습니다. 잠시 후 다시 시도하세요.' });
  }
  try {
    const rec = users.requestSignup(req.body || {});
    const appUrl = `${req.protocol}://${req.get('host')}`;
    mailer
      .notifySignupRequest({ username: rec.username, note: rec.note, requestedAt: rec.requestedAt, appUrl })
      .catch((e) => console.error('[mailer] 승인요청 알림 발송 실패:', e.message));
    const message =
      (req.body || {}).lang === 'en'
        ? `"${rec.username}" request submitted. You can log in after admin approval.`
        : `"${rec.username}" 사용 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.`;
    res.json({ ok: true, message });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

function me(req, res) {
  res.json({ username: req.authUser, role: req.authRole });
}

if (generated) {
  console.log('');
  console.log('  ⚠ DASH_PASSWORD 환경변수가 없어 관리자 임시 비밀번호를 생성했습니다 (재기동 시 바뀝니다)');
  console.log(`     관리자 아이디: ${ADMIN_USER}`);
  console.log(`     관리자 비밀번호: ${ADMIN_PASSWORD}`);
  console.log('  실제 배포 시에는 반드시 DASH_USER / DASH_PASSWORD 환경변수를 지정하세요.');
  console.log('');
}

module.exports = { requireAuth, requireAdmin, login, logout, signup, me };
