'use strict';
/**
 * 항목 상세 설명 보관함 (data/item-notes.json)
 *
 * 원인·조치·대책 한 줄을 눌러 [자세히]를 보면 그때마다 AI 가 웹을 뒤져 설명을 만든다.
 * 같은 항목을 다시 눌러도 또 부른다 — 내용은 거의 같은데 사용량만 쌓인다.
 *
 * 그래서 한 번 만든 설명을 항목별로 보관해 두고, 같은 항목을 다시 열면 그것을 그대로 준다.
 * 지식베이스·이력에서 찾아 붙이는 유사 사례는 지금 자료로 매번 새로 만든다(여기 보관하지 않는다).
 */
const fs = require('fs');
const path = require('path');
const kb = require('./kb');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'item-notes.json');
const MAX_ENTRIES = 1000;

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const t = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').trim() : '';
    cache = t ? JSON.parse(t) : [];
  } catch (e) {
    console.error('[itemcache] 읽기 실패, 새로 시작합니다:', e.message);
    cache = [];
  }
  if (!Array.isArray(cache)) cache = [];
  return cache;
}

function persist() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 1), 'utf8');
  fs.renameSync(tmp, FILE);
}

const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** 같은 항목인지 판단하는 키 — 항목 종류·문구·어느 불량의 항목인지·표시 언어까지 같아야 같은 것으로 본다 */
function keyOf({ kind, text, defectName, lang }) {
  const t = kb.squash(text || '').slice(0, 80);
  if (!t) return '';
  return [kind || '-', t, kb.squash(defectName || '').slice(0, 40), lang === 'en' ? 'en' : 'ko'].join('|');
}

/** 보관해둔 설명 (없으면 null) */
function get(opt) {
  const key = keyOf(opt);
  if (!key) return null;
  const rec = load().find((x) => x.key === key);
  if (!rec) return null;
  rec.hits = (rec.hits || 0) + 1;
  rec.lastUsedAt = new Date().toISOString();
  persist();
  return { value: copy(rec.value), savedAt: rec.savedAt, hits: rec.hits };
}

/** 새로 만든 설명을 보관 */
function put(opt, value) {
  const key = keyOf(opt);
  if (!key || !value) return null;
  const list = load();
  const now = new Date().toISOString();
  const i = list.findIndex((x) => x.key === key);
  const rec = {
    key,
    kind: String(opt.kind || ''),
    text: String(opt.text || '').slice(0, 300),
    defectName: String(opt.defectName || '').slice(0, 120),
    value: copy(value),
    savedAt: now,
    lastUsedAt: now,
    hits: i < 0 ? 0 : list[i].hits || 0
  };
  if (i < 0) list.unshift(rec);
  else list[i] = rec;

  // 오래 안 쓴 것부터 버린다
  if (list.length > MAX_ENTRIES) {
    list.sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
    list.length = MAX_ENTRIES;
  }
  persist();
  return rec;
}

function stats() {
  const list = load();
  return { entries: list.length, hits: list.reduce((n, x) => n + (x.hits || 0), 0) };
}

/** 보관함 비우기 (설명이 낡았다고 판단될 때 관리자가 실행) */
function clear() {
  const n = load().length;
  cache = [];
  persist();
  return n;
}

module.exports = { get, put, stats, clear };
