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
const MAX_TEXT = 1000;

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

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 값이 비어있는 항목은 버리고, 문자열은 너무 길지 않게 잘라 저장한다. */
function tidy(obj, maxLen) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = typeof v === 'string' ? v.slice(0, maxLen) : v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * @param {object} entry {username, role, action, label, ip, ref, detail}
 *  - ref    : 이 활동이 가리키는 대상 — 목록에서 클릭했을 때 실제 내용을 열기 위한 정보
 *             {type:'record'|'defect'|'item'|'feedback', id, ...}
 *  - detail : 행을 펼쳤을 때 보여줄 부가 정보 (키=필드명, 표시 이름은 화면에서 붙인다)
 */
function log(entry) {
  try {
    const { ref, detail, ...rest } = entry || {};
    const rec = { id: newId(), at: new Date().toISOString(), ...rest };
    if (typeof rec.label === 'string') rec.label = rec.label.slice(0, MAX_TEXT);
    const r = tidy(ref, MAX_TEXT);
    const d = tidy(detail, MAX_TEXT);
    if (r) rec.ref = r;
    if (d) rec.detail = d;

    const list = load();
    list.unshift(rec);
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
