'use strict';
/**
 * 로그인 세션 저장소 (data/sessions.json)
 *
 * 세션을 서버 메모리에만 두면 앱이 재시작될 때마다(자동 배포가 5분마다 돌기 때문에 자주 일어난다)
 * 모두가 다시 로그인해야 한다. 그래서 파일에 남겨 재시작 후에도 로그인 상태가 이어지게 한다.
 *
 * 보안상 지키는 것:
 *  - 파일에는 세션 토큰 원본이 아니라 SHA-256 해시만 저장한다. 파일이 새어나가도 그 값으로는 로그인할 수 없다.
 *    (토큰은 32바이트 난수라 해시를 거꾸로 풀 방법이 없으므로 비밀번호와 달리 빠른 해시로 충분하다)
 *  - 파일 권한은 0600 — 앱 계정 외에는 읽지 못한다.
 *  - 관리자 비밀번호가 바뀌면 기존 관리자 세션은 전부 무효가 된다(authEpoch 비교).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'sessions.json');

const MAX_SESSIONS = 500; // 파일이 무한정 커지지 않게 상한을 둔다
const FLUSH_INTERVAL_MS = 60 * 1000; // 마지막 사용시각 갱신은 모아서 1분에 한 번만 기록

/** tokenHash -> { username, role, expiresAt, lastSeen } */
let map = new Map();
let epoch = ''; // 현재 관리자 자격증명의 지문
let dirty = false;
let ready = false;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function persist() {
  if (!ready) return;
  try {
    ensureDir();
    const out = { epoch, sessions: Object.fromEntries(map) };
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600); // 이전에 남은 임시파일이 있었더라도 권한을 확실히 좁힌다 (윈도우에서는 무시됨)
    } catch (e) {
      /* 파일시스템이 권한을 지원하지 않으면 무시 */
    }
    fs.renameSync(tmp, FILE);
    dirty = false;
  } catch (e) {
    console.error('[sessions] 저장 실패:', e.message);
  }
}

/**
 * 기동 시 저장된 세션을 읽어온다.
 * @param {object} opt {authEpoch, idleTimeoutMs} authEpoch 가 달라지면(=관리자 비밀번호 변경) 관리자 세션은 버린다
 */
function init({ authEpoch, idleTimeoutMs }) {
  ready = true;
  epoch = authEpoch;

  let saved = null;
  try {
    if (fs.existsSync(FILE)) {
      const t = fs.readFileSync(FILE, 'utf8').trim();
      saved = t ? JSON.parse(t) : null;
    }
  } catch (e) {
    console.error('[sessions] 읽기 실패, 새로 시작합니다:', e.message);
  }

  const now = Date.now();
  let dropped = 0;
  if (saved && saved.sessions && typeof saved.sessions === 'object') {
    for (const [h, s] of Object.entries(saved.sessions)) {
      if (!s || typeof s !== 'object' || !s.username || !s.role) continue;
      if (!(now < s.expiresAt) || now - (s.lastSeen || 0) > idleTimeoutMs) {
        dropped++;
        continue;
      }
      // 관리자 아이디·비밀번호가 바뀌었으면 예전 관리자 세션은 인정하지 않는다
      if (s.role === 'admin' && saved.epoch !== authEpoch) {
        dropped++;
        continue;
      }
      map.set(h, { username: s.username, role: s.role, expiresAt: s.expiresAt, lastSeen: s.lastSeen || now });
    }
  }

  persist(); // 정리된 상태와 현재 epoch 로 다시 기록
  return { restored: map.size, dropped };
}

function create(token, rec) {
  // 상한을 넘으면 가장 오래 쓰지 않은 세션부터 정리한다
  if (map.size >= MAX_SESSIONS) {
    const oldest = [...map.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, map.size - MAX_SESSIONS + 1);
    for (const [h] of oldest) map.delete(h);
  }
  map.set(hashToken(token), rec);
  persist();
}

function get(token) {
  return map.get(hashToken(token)) || null;
}

function remove(token) {
  if (map.delete(hashToken(token))) persist();
}

/** 마지막 사용시각 갱신 — 매 요청마다 파일을 쓰지 않고 표시만 해뒀다가 주기적으로 기록한다 */
function touch(rec, at) {
  rec.lastSeen = at;
  dirty = true;
}

/** 특정 계정의 모든 세션을 끊는다 (승인 거부·계정 삭제 시) */
function revokeUser(username) {
  const u = String(username || '').toLowerCase();
  let n = 0;
  for (const [h, s] of map) {
    if (String(s.username).toLowerCase() === u) {
      map.delete(h);
      n++;
    }
  }
  if (n) persist();
  return n;
}

/** 만료·장기 미사용 세션 정리 */
function sweep(idleTimeoutMs) {
  const now = Date.now();
  let n = 0;
  for (const [h, s] of map) {
    if (now > s.expiresAt || now - s.lastSeen > idleTimeoutMs) {
      map.delete(h);
      n++;
    }
  }
  if (n || dirty) persist();
  return n;
}

/** 종료 신호를 받으면 마지막 사용시각까지 기록하고 나간다 */
function flushOnExit() {
  const done = (signal) => () => {
    if (dirty) persist();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGTERM', done('SIGTERM'));
  process.on('SIGINT', done('SIGINT'));
}

setInterval(() => {
  if (dirty) persist();
}, FLUSH_INTERVAL_MS).unref();

module.exports = { init, create, get, remove, touch, revokeUser, sweep, flushOnExit, hashToken, FILE };
