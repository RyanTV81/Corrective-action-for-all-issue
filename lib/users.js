'use strict';
/**
 * 사용자 계정 저장소 (data/users.json)
 * - 신청(pending) → 배포자(관리자) 승인(approved) 전까지는 로그인할 수 없다.
 * - 비밀번호는 scrypt 해시로만 저장한다(평문 저장 금지).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'users.json');

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

let cache = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(FILE)) {
      const t = fs.readFileSync(FILE, 'utf8').trim();
      cache = t ? JSON.parse(t) : [];
    } else {
      cache = [];
    }
  } catch (e) {
    console.error('[users] 읽기 실패, 새로 시작합니다:', e.message);
    cache = [];
  }
  if (!Array.isArray(cache)) cache = [];
  return cache;
}

function persist() {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 1), 'utf8');
  fs.renameSync(tmp, FILE);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function safeEqualHex(a, b) {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function newId() {
  return 'u_' + crypto.randomBytes(6).toString('hex');
}

function findByUsername(username) {
  const u = String(username || '').toLowerCase();
  return load().find((x) => x.username.toLowerCase() === u) || null;
}

function findById(id) {
  return load().find((x) => x.id === id) || null;
}

/** 사용 신청 등록 — 즉시 로그인되지 않고 status='pending' 으로 저장된다 */
function requestSignup({ username, password, note }) {
  username = String(username || '').trim();
  if (!USERNAME_RE.test(username)) {
    throw Object.assign(new Error('아이디는 영문·숫자·._- 로 3~32자여야 합니다'), { code: 'BAD_USERNAME' });
  }
  if (!password || String(password).length < 8) {
    throw Object.assign(new Error('비밀번호는 8자 이상이어야 합니다'), { code: 'BAD_PASSWORD' });
  }
  if (findByUsername(username)) {
    throw Object.assign(new Error('이미 신청되었거나 사용 중인 아이디입니다'), { code: 'DUP_USERNAME' });
  }
  const list = load();
  const salt = crypto.randomBytes(16).toString('hex');
  const rec = {
    id: newId(),
    username,
    passwordHash: hashPassword(password, salt),
    salt,
    status: 'pending', // pending | approved | rejected
    note: String(note || '').slice(0, 200),
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null
  };
  list.push(rec);
  persist();
  return rec;
}

/** 아이디·비밀번호가 일치하는 계정을 찾는다(승인 여부는 호출부에서 판단) */
function verify(username, password) {
  const u = findByUsername(username);
  if (!u) return null;
  return safeEqualHex(hashPassword(password, u.salt), u.passwordHash) ? u : null;
}

function listUsers() {
  return load()
    .slice()
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1))
    .map((u) => ({
      id: u.id,
      username: u.username,
      status: u.status,
      note: u.note,
      requestedAt: u.requestedAt,
      decidedAt: u.decidedAt,
      decidedBy: u.decidedBy
    }));
}

function decide(id, status, decidedBy) {
  if (!['approved', 'rejected'].includes(status)) return null;
  const list = load();
  const u = list.find((x) => x.id === id);
  if (!u) return null;
  u.status = status;
  u.decidedAt = new Date().toISOString();
  u.decidedBy = decidedBy || '';
  persist();
  return u;
}

function remove(id) {
  const list = load();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  persist();
  return true;
}

module.exports = { requestSignup, verify, listUsers, decide, remove, findByUsername, findById };
