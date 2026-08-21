'use strict';
/**
 * 분석 이력 저장소 (data/history.json)
 * - 분석할 때마다 1건씩 누적하여 공정별 불량 추이·재발 여부를 추적한다.
 * - 재발 판정(judge)과 대시보드 통계의 원천 데이터.
 */
const fs = require('fs');
const path = require('path');
const kb = require('./kb');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'history.json');
const MAX_RECORDS = 5000;

const STATUSES = ['조치중', '검증중', '완료', '보류'];

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
    console.error('[store] 이력 읽기 실패, 새로 시작합니다:', e.message);
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

/** UTC 타임스탬프(Date 또는 ISO 문자열) → 한국 시간(KST) 기준 날짜 키 "YYYY-MM-DD". */
function kstDayKey(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** UTC 타임스탬프(ISO 문자열) → 한국 시간(KST) "YYYY-MM-DD HH:mm:ss" (CSV 출력용). */
function kstDateTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function newId() {
  const d = new Date();
  const stamp =
    d.getFullYear().toString().slice(2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  return `QC${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/* ------------------------------------------------------------------ */
/* 쓰기                                                                 */
/* ------------------------------------------------------------------ */

/** 분석 결과(analyze.js 출력) → 이력 레코드 */
function addFromResult(result, meta = {}) {
  const list = load();

  const rec = {
    id: newId(),
    at: new Date().toISOString(),
    username: meta.username || '',
    inspector: meta.inspector || '',
    line: meta.line || '',
    status: '조치중',
    memo: '',

    processId: result.process ? result.process.id : null,
    processName: result.process ? result.process.name : '',
    processGuessed: result.process ? Boolean(result.process.guessed) : false,

    defectId: result.defect ? result.defect.id : null,
    defectName: (result.defect && result.defect.name) || (result.vision && result.vision.defectName) || '(미판정)',
    severity: (result.defect && result.defect.severity) || (result.vision && result.vision.severity) || 'medium',

    matchScore: result.candidates && result.candidates.length ? result.candidates[0].score : 0,
    visionConfidence: result.vision ? Number(result.vision.confidence) || 0 : null,

    judgeLevel: result.judgement ? result.judgement.level : null,
    judgeScore: result.judgement ? result.judgement.score : null,

    aiUsed: Boolean(result.usedAI),
    webUsed: Boolean(result.web),
    elapsedMs: result.elapsedMs || 0,

    text: result.input ? result.input.text : '',
    cues: result.input ? result.input.cues : [],
    images: (result.images || []).map((i) => i.url),

    report: {
      causes: result.causes || [],
      actions: result.actions || [],
      measures: result.measures || [],
      candidates: result.candidates || [],
      vision: result.vision || null,
      web: result.web || null,
      knowledge: result.knowledge || null,
      judgement: result.judgement || null,
      defect: result.defect || null,
      process: result.process || null
    }
  };

  list.unshift(rec);
  if (list.length > MAX_RECORDS) list.length = MAX_RECORDS;
  persist();
  return rec;
}

function update(id, patch) {
  const list = load();
  const rec = list.find((r) => r.id === id);
  if (!rec) return null;
  if (typeof patch.memo === 'string') rec.memo = patch.memo.slice(0, 2000);
  if (typeof patch.status === 'string' && STATUSES.includes(patch.status)) rec.status = patch.status;
  if (typeof patch.inspector === 'string') rec.inspector = patch.inspector.slice(0, 100);
  rec.updatedAt = new Date().toISOString();
  persist();
  return rec;
}

function remove(id) {
  const list = load();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  persist();
  return true;
}

/* ------------------------------------------------------------------ */
/* 읽기                                                                 */
/* ------------------------------------------------------------------ */

/** 불량 사진은 관리자, 또는 그 이력을 직접 올린 본인만 볼 수 있다 */
function canSeePhotos(r, opt = {}) {
  return Boolean(opt.isAdmin || (opt.username && r.username && r.username === opt.username));
}

function summarize(r, opt = {}) {
  return {
    id: r.id,
    at: r.at,
    processId: r.processId,
    processName: r.processName,
    defectId: r.defectId,
    defectName: r.defectName,
    severity: r.severity,
    judgeLevel: r.judgeLevel,
    judgeScore: r.judgeScore,
    status: r.status,
    username: r.username || '',
    inspector: r.inspector,
    line: r.line,
    memo: r.memo,
    imageCount: (r.images || []).length,
    // 화면에서 감추는 게 아니라 목록 응답 자체에서 뺀다
    thumb: canSeePhotos(r, opt) ? (r.images || [])[0] || null : null,
    aiUsed: r.aiUsed
  };
}

function list(query = {}, opt = {}) {
  let items = load();

  if (query.processId) items = items.filter((r) => r.processId === query.processId);
  if (query.defectId) items = items.filter((r) => r.defectId === query.defectId);
  if (query.status) items = items.filter((r) => r.status === query.status);
  if (query.level) items = items.filter((r) => r.judgeLevel === query.level);
  if (query.severity) items = items.filter((r) => r.severity === query.severity);
  if (query.from) items = items.filter((r) => r.at >= query.from);
  if (query.to) items = items.filter((r) => r.at <= query.to);
  if (query.q) {
    const q = String(query.q).toLowerCase();
    items = items.filter(
      (r) =>
        (r.defectName || '').toLowerCase().includes(q) ||
        (r.processName || '').toLowerCase().includes(q) ||
        (r.text || '').toLowerCase().includes(q) ||
        (r.id || '').toLowerCase().includes(q)
    );
  }

  const total = items.length;
  const offset = Math.max(0, Number(query.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));

  return { total, offset, limit, items: items.slice(offset, offset + limit).map((r) => summarize(r, opt)) };
}

/** 관리자·업로드 본인이 아니면 원본 레코드에서 images 를 빼고 내려준다 */
function get(id, opt = {}) {
  const r = load().find((r) => r.id === id) || null;
  if (!r) return null;
  if (!canSeePhotos(r, opt) && (r.images || []).length) return { ...r, images: [] };
  return r;
}

/**
 * 같은 불량의 최근 재발 이력 조회 (judge 에서 사용)
 * @param {number} days 조회 기간(일)
 */
function recentSame({ processId, defectId, defectName }, days = 30) {
  if (!defectId && !defectName) return [];
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return load().filter(
    (r) =>
      r.at >= since &&
      (processId ? r.processId === processId : true) &&
      (defectId ? r.defectId === defectId : r.defectName === defectName)
  );
}

/**
 * 과거 이력 중 동일한 원인/조치/대책 문구가 등장한 건을 찾는다 — AI 없이도 보여줄 수 있는 "우리 현장 유사 사례".
 * @param {object} opt {text, kind:'cause'|'action'|'measure', excludeId}
 */
function findRelated({ text, kind, excludeId }, limit = 6) {
  const key = kb.squash(text || '');
  if (!key) return [];
  const field = kind + 's';
  const out = [];
  for (const r of load()) {
    if (r.id === excludeId) continue;
    const items = (r.report && r.report[field]) || [];
    if (items.some((it) => kb.squash(it.text) === key)) {
      out.push({ id: r.id, at: r.at, processName: r.processName, defectName: r.defectName, status: r.status });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 통계                                                                 */
/* ------------------------------------------------------------------ */

function stats() {
  const items = load();
  const byProcess = {};
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byLevel = { critical: 0, warning: 0, watch: 0, ok: 0 };
  const byDefect = {};
  const byCategory = {};
  const byDay = {};

  const since = new Date(Date.now() - 29 * 86400000);
  for (let i = 0; i < 30; i++) {
    const d = new Date(since.getTime() + i * 86400000);
    byDay[kstDayKey(d)] = 0;
  }

  for (const r of items) {
    if (r.processId) {
      byProcess[r.processId] = byProcess[r.processId] || { id: r.processId, name: r.processName, count: 0, high: 0 };
      byProcess[r.processId].count++;
      if (r.severity === 'high') byProcess[r.processId].high++;
    }
    if (bySeverity[r.severity] !== undefined) bySeverity[r.severity]++;
    if (r.judgeLevel && byLevel[r.judgeLevel] !== undefined) byLevel[r.judgeLevel]++;

    // 근본원인 4M1E 분포
    for (const c of (r.report && r.report.causes) || []) {
      const cat = c.cat || 'Method';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    const key = r.defectName || '(미판정)';
    byDefect[key] = byDefect[key] || { name: key, processName: r.processName, count: 0 };
    byDefect[key].count++;

    const day = r.at ? kstDayKey(r.at) : '';
    if (byDay[day] !== undefined) byDay[day]++;
  }

  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = items.filter((r) => r.status === s).length;

  return {
    total: items.length,
    byStatus,
    open: byStatus['조치중'] + byStatus['검증중'],
    closed: byStatus['완료'],
    last7d: items.filter((r) => r.at >= new Date(Date.now() - 7 * 86400000).toISOString()).length,
    critical: items.filter((r) => r.judgeLevel === 'critical').length,
    bySeverity,
    byLevel,
    byCategory,
    byProcess: Object.values(byProcess).sort((a, b) => b.count - a.count),
    topDefects: Object.values(byDefect).sort((a, b) => b.count - a.count).slice(0, 10),
    trend: Object.entries(byDay).map(([date, count]) => ({ date, count }))
  };
}

/* ------------------------------------------------------------------ */
/* 내보내기                                                             */
/* ------------------------------------------------------------------ */

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // Excel/스프레드시트는 = + - @ 로 시작하는 칸을 수식으로 실행한다.
  // 사용자가 적은 메모가 수식으로 돌아가지 않도록 앞에 작은따옴표를 붙여 무력화한다(CSV 수식 인젝션 방지).
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv() {
  const head = [
    '관리번호', '일시', '공정', '불량명', '심각도', '공정판정', '리스크점수',
    '상태', '담당자', '라인', '사진수', 'AI사용', '현상설명',
    '주요원인1', '주요원인2', '주요원인3',
    '즉시조치1', '즉시조치2', '즉시조치3',
    '재발대책1', '재발대책2', '재발대책3', '비고'
  ];

  const pick = (arr, i) => (arr && arr[i] ? arr[i].text : '');

  const rows = load().map((r) => {
    const rep = r.report || {};
    return [
      r.id,
      r.at ? kstDateTime(r.at) : '',
      r.processName,
      r.defectName,
      { critical: '치명', high: '중대', medium: '경미', low: '관찰' }[r.severity] || r.severity,
      { critical: '공정이상', warning: '이상의심', watch: '경향관리', ok: '산발' }[r.judgeLevel] || r.judgeLevel || '',
      r.judgeScore === null || r.judgeScore === undefined ? '' : r.judgeScore,
      r.status,
      r.inspector,
      r.line,
      (r.images || []).length,
      r.aiUsed ? 'Y' : 'N',
      r.text,
      pick(rep.causes, 0), pick(rep.causes, 1), pick(rep.causes, 2),
      pick(rep.actions, 0), pick(rep.actions, 1), pick(rep.actions, 2),
      pick(rep.measures, 0), pick(rep.measures, 1), pick(rep.measures, 2),
      r.memo
    ].map(csvCell).join(',');
  });

  // Excel 한글 깨짐 방지용 BOM
  return '﻿' + [head.join(','), ...rows].join('\r\n');
}

module.exports = { addFromResult, update, remove, list, get, stats, toCsv, recentSame, findRelated, kstDayKey, STATUSES, FILE };
