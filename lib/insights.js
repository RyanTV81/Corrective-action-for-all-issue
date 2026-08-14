'use strict';
/**
 * 축적 지식 저장소 (data/insights.json)
 *
 * 인터넷 조사(ai.research)는 매번 새로 검색·정리하느라 시간과 비용이 들고, 결과는 그때
 * 화면에만 보이고 사라졌다. 같은 불량을 다시 조회하면 처음부터 다시 찾는 셈이다.
 *
 * 그래서 조사 결과를 불량별로 모아 둔다. 다음에 같은 불량이 나오면
 *  - 인터넷 조사를 켜지 않아도 지난 조사에서 얻은 원인·조치·대책이 함께 나오고
 *  - 참고 자료 링크도 그대로 다시 볼 수 있다.
 * 조사를 다시 하면 새로 얻은 내용만 덧붙여 쌓인다(중복은 걸러낸다).
 *
 * 지식베이스(kb/)와는 성격이 다르다. kb/ 는 검증된 표준 지식이고, 여기는 "찾아본 것"의
 * 누적이다. 그래서 화면에서도 출처를 [축적 웹조사] 로 따로 표시한다.
 */
const fs = require('fs');
const path = require('path');
const kb = require('./kb');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'insights.json');

const MAX_RECORDS = 500; // 불량 종류 기준
const MAX_ITEMS = 20; // 원인·조치·대책 각각
const MAX_SOURCES = 12;

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const t = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').trim() : '';
    cache = t ? JSON.parse(t) : [];
  } catch (e) {
    console.error('[insights] 읽기 실패, 새로 시작합니다:', e.message);
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

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * 저장된 원본이 아니라 사본을 내보낸다.
 * 원본을 그대로 넘기면 받은 쪽에서 손대거나, 뒤이어 이 모듈이 내용을 덧붙일 때
 * 이미 넘어간 값까지 같이 바뀌어 버린다(같은 객체를 보고 있으므로).
 */
const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** 같은 내용인지 판단하는 키 — 표현이 조금 달라도 앞부분이 같으면 같은 것으로 본다 */
const itemKey = (text) => kb.squash(text).slice(0, 40);

/** AI 응답 항목을 저장 형태로 정리 (텍스트 없는 항목은 버린다) */
function tidyItems(list) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(list) ? list : []) {
    const text = str(typeof it === 'string' ? it : it && it.text, 300);
    if (!text) continue;
    const key = itemKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const rec = { text };
    if (it && typeof it === 'object') {
      if (it.cat) rec.cat = str(it.cat, 20);
      if (it.when) rec.when = str(it.when, 20);
      if (it.owner) rec.owner = str(it.owner, 40);
      if (it.type) rec.type = str(it.type, 20);
      if (it.kpi) rec.kpi = str(it.kpi, 120);
    }
    out.push(rec);
  }
  return out;
}

/** 화면의 링크로 쓰이는 값이라 http(s) 주소만 남긴다 */
function tidySources(list) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    const url = str(s && s.url, 500);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: str(s.title, 200) || url, url });
  }
  return out;
}

/** 불량 1건을 가리키는 키 — 지식베이스 코드가 있으면 그것을, 없으면 공정+이름을 쓴다 */
function keyOf({ defectId, defectName, processId }) {
  const p = str(processId, 60) || '-';
  const id = str(defectId, 60);
  if (id) return `${p}:${id}`;
  const nm = kb.squash(defectName || '').slice(0, 60);
  return nm ? `${p}:name:${nm}` : '';
}

/** 이미 쌓여 있는 목록 뒤에 새 항목만 덧붙인다 */
function appendNew(oldList, newList, max) {
  const out = Array.isArray(oldList) ? oldList.slice() : [];
  const seen = new Set(out.map((x) => itemKey(x.text)));
  for (const it of newList) {
    const k = itemKey(it.text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

/**
 * 인터넷 조사 결과를 쌓는다.
 * @param {object} opt {defectId, defectName, processId, processName, research}
 * @returns 저장된 기록 (저장할 게 없으면 null)
 */
function remember(opt) {
  const research = opt && opt.research;
  if (!research) return null;
  const key = keyOf(opt);
  if (!key) return null;

  const causes = tidyItems(research.causes);
  const actions = tidyItems(research.actions);
  const measures = tidyItems(research.measures);
  const sources = tidySources(research.sources);
  const summary = str(research.summary, 2000);
  if (!causes.length && !actions.length && !measures.length && !summary) return null;

  const list = load();
  const now = new Date().toISOString();
  let rec = list.find((x) => x.key === key);
  if (!rec) {
    rec = {
      key,
      defectId: str(opt.defectId, 60) || null,
      defectName: str(opt.defectName, 120),
      processId: str(opt.processId, 60) || null,
      processName: str(opt.processName, 100),
      causes: [],
      actions: [],
      measures: [],
      sources: [],
      runs: 0,
      firstAt: now
    };
    list.unshift(rec);
    if (list.length > MAX_RECORDS) list.length = MAX_RECORDS;
  }

  // 요약·메커니즘은 가장 최근 조사 내용으로 바꾸고, 항목과 자료는 쌓는다
  if (summary) rec.summary = summary;
  if (research.mechanism) rec.mechanism = str(research.mechanism, 1000);
  rec.causes = appendNew(rec.causes, causes, MAX_ITEMS);
  rec.actions = appendNew(rec.actions, actions, MAX_ITEMS);
  rec.measures = appendNew(rec.measures, measures, MAX_ITEMS);
  const haveUrl = new Set((rec.sources || []).map((s) => s.url));
  for (const s of sources) {
    if (haveUrl.has(s.url) || rec.sources.length >= MAX_SOURCES) continue;
    haveUrl.add(s.url);
    rec.sources.push(s);
  }
  rec.runs += 1;
  rec.updatedAt = now;
  if (!rec.defectId && opt.defectId) rec.defectId = str(opt.defectId, 60);
  if (!rec.defectName && opt.defectName) rec.defectName = str(opt.defectName, 120);

  persist();
  return rec;
}

/** 이 불량에 대해 쌓아둔 조사 내용 (없으면 null) */
function find(opt) {
  const list = load();
  const byId = keyOf(opt);
  let rec = byId ? list.find((x) => x.key === byId) : null;
  // 예전에 지식베이스 코드 없이(이름으로만) 쌓아둔 기록도 찾아본다
  if (!rec && opt.defectName) {
    const byName = keyOf({ defectName: opt.defectName, processId: opt.processId });
    if (byName) rec = list.find((x) => x.key === byName);
  }
  // 반대로, 코드 없이 조회했는데 예전에 코드로 쌓아둔 기록이 있는 경우 — 같은 공정의 같은 이름이면 같은 불량으로 본다
  if (!rec && opt.defectName) {
    const nm = kb.squash(opt.defectName).slice(0, 60);
    const pid = str(opt.processId, 60);
    if (nm) {
      rec = list.find(
        (x) => kb.squash(x.defectName || '').slice(0, 60) === nm && (!pid || !x.processId || x.processId === pid)
      );
    }
  }
  return rec ? copy(rec) : null;
}

function stats() {
  const list = load();
  return {
    defects: list.length,
    runs: list.reduce((n, x) => n + (x.runs || 0), 0),
    sources: list.reduce((n, x) => n + (x.sources || []).length, 0)
  };
}

/* ------------------------------------------------------------------ */
/* 관리 (관리자 화면)                                                    */
/* ------------------------------------------------------------------ */

/**
 * 쌓인 내용 전체 목록 — 최근에 갱신된 것부터.
 * 웹에서 가져온 내용이라 잘못된 것이 섞일 수 있으므로 관리자가 눈으로 보고 지울 수 있어야 한다.
 */
function listAll(query = {}) {
  const items = load()
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const limit = Math.min(300, Math.max(1, Number(query.limit) || 100));
  return { total: items.length, items: copy(items.slice(0, limit)), stats: stats() };
}

/** 불량 1건에 쌓인 내용을 통째로 삭제 */
function remove(key) {
  const list = load();
  const i = list.findIndex((x) => x.key === key);
  if (i < 0) return null;
  const [rec] = list.splice(i, 1);
  persist();
  return rec;
}

/** 쌓인 항목 중 한 줄만 삭제 (원인·조치·대책 또는 참고 자료) */
function removeItem(key, listName, text) {
  const allowed = ['causes', 'actions', 'measures', 'sources'];
  if (!allowed.includes(listName)) return null;
  const rec = load().find((x) => x.key === key);
  if (!rec || !Array.isArray(rec[listName])) return null;

  const before = rec[listName].length;
  if (listName === 'sources') {
    rec[listName] = rec[listName].filter((x) => x.url !== text);
  } else {
    const target = itemKey(text);
    rec[listName] = rec[listName].filter((x) => itemKey(x.text) !== target);
  }
  if (rec[listName].length === before) return null;
  persist();
  return rec;
}

module.exports = { remember, find, stats, list: listAll, remove, removeItem };
