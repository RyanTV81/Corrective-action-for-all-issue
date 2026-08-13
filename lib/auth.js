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
const security = require('./security');

const ADMIN_USER = process.env.DASH_USER || 'admin';
let ADMIN_PASSWORD = process.env.DASH_PASSWORD;
const generated = !ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12시간 동안 사용이 없으면 자동 로그아웃
const sessions = new Map(); // token -> { username, role, expiresAt, lastSeen }

/* 만료된 세션을 주기적으로 비운다 (메모리 누수·오래된 토큰 잔존 방지) */
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now > s.expiresAt || now - s.lastSeen > IDLE_TIMEOUT_MS) sessions.delete(token);
  }
}, 30 * 60 * 1000).unref();

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

/** 요청 횟수 제한 (브루트포스·가입폭탄 완화용) — 공용 구현을 사용 */
const tooManyAttempts = security.hit;

/* ------------------------------------------------------------------ */
/* 세션                                                                 */
/* ------------------------------------------------------------------ */

function issueSession(res, username, role) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(token, { username, role, expiresAt: now + SESSION_TTL_MS, lastSeen: now });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `qc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

function clearSession(req, res) {
  const token = parseCookies(req).qc_session;
  if (token) sessions.delete(token);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `qc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

/** 특정 계정의 모든 세션을 즉시 끊는다 (승인 거부·계정 삭제 시 호출) */
function revokeSessions(username) {
  const u = String(username || '').toLowerCase();
  let n = 0;
  for (const [token, s] of sessions) {
    if (String(s.username).toLowerCase() === u) {
      sessions.delete(token);
      n++;
    }
  }
  return n;
}

function sessionOf(req) {
  const token = parseCookies(req).qc_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;

  const now = Date.now();
  if (now > s.expiresAt || now - s.lastSeen > IDLE_TIMEOUT_MS) {
    sessions.delete(token);
    return null;
  }

  // 세션 발급 이후 관리자가 계정을 삭제·거부했을 수 있으므로 매 요청마다 다시 확인한다.
  if (s.role !== 'admin') {
    const u = users.findByUsername(s.username);
    if (!u || u.status !== 'approved') {
      sessions.delete(token);
      return null;
    }
  }

  s.lastSeen = now;
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

/** 활동 이력에서 로그인 항목을 펼쳤을 때 보여줄 접속 정보 */
function loginDetail(req) {
  return { ua: req.headers['user-agent'] || '' };
}

function login(req, res) {
  const { username, password } = req.body || {};
  const name = String(username || '').slice(0, 64);

  // IP 기준 + 계정 기준을 함께 건다. IP 를 바꿔가며 한 계정을 노리는 시도도 계정 쪽 한도에 걸린다.
  const ipKey = 'login-ip:' + req.ip;
  const userKey = 'login-user:' + name.toLowerCase();
  if (tooManyAttempts(ipKey, 10, 5 * 60 * 1000) || tooManyAttempts(userKey, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' });
  }

  const okLogin = (user, role) => {
    security.reset(ipKey);
    security.reset(userKey);
    issueSession(res, user, role);
    activity.log({ username: user, role, action: 'login', label: '로그인', detail: loginDetail(req), ip: req.ip });
    return res.json({ ok: true, role });
  };

  if (safeEqual(name, ADMIN_USER) && safeEqual(password || '', ADMIN_PASSWORD)) {
    return okLogin(ADMIN_USER, 'admin');
  }

  const u = users.verify(name, password || '');
  if (!u) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' });
  }
  if (u.status === 'pending') {
    return res.status(403).json({ error: '아직 관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.', code: 'PENDING' });
  }
  if (u.status === 'rejected') {
    return res.status(403).json({ error: '사용 신청이 거부되었습니다. 관리자에게 문의하세요.', code: 'REJECTED' });
  }

  return okLogin(u.username, 'user');
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
    // 메일 본문의 접속 주소는 Host 헤더(사용자가 조작 가능)를 그대로 쓰지 않고 설정값을 우선 사용한다.
    const appUrl = process.env.APP_URL || `${req.protocol}://${String(req.get('host') || '').replace(/[^\w.:-]/g, '')}`;
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

module.exports = { requireAuth, requireAdmin, login, logout, signup, me, revokeSessions };
