'use strict';
/**
 * 사용자 활동 이력 (data/activity.json)
 * - 로그인, 분석 실행, 이력·상세정보·지식베이스 조회 등 "누가 무엇을 언제 봤는지"를 기록한다.
 * - 배포자(관리자)가 [사용자 관리] → [활동 이력] 탭에서 조회한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'activity.json');
const MAX_RECORDS = 5000;

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
    console.error('[activity] 읽기 실패, 새로 시작합니다:', e.message);
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

/**
 * @param {object} entry {username, role, action, label, ip}
 */
function log(entry) {
  try {
    const list = load();
    list.unshift({ at: new Date().toISOString(), ...entry });
    if (list.length > MAX_RECORDS) list.length = MAX_RECORDS;
    persist();
  } catch (e) {
    console.error('[activity] 기록 실패:', e.message);
  }
}

function list_(query = {}) {
  let items = load();
  if (query.username) items = items.filter((x) => x.username === query.username);
  if (query.action) items = items.filter((x) => x.action === query.action);
  const total = items.length;
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 200));
  return { total, items: items.slice(0, limit) };
}

module.exports = { log, list: list_ };
