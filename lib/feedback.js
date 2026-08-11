'use strict';
/**
 * 판정 교정(학습 피드백) 저장소 (data/feedback.json)
 *
 * 촬영 각도·조명에 따라 외관 불량은 AI/KB가 오판정할 수 있다. 사용자가 실제 정답을
 * 알려주면(확인/수정/신규불량), 관리자 확인을 거쳐 다음 두 가지로 "학습"에 반영한다.
 *  1) 이후 사진판독 시 확정된 사례를 few-shot 참고자료로 프롬프트에 주입 (lib/ai.js)
 *  2) 신규 불량이면 관리자가 지식베이스에 직접 추가 가능 (lib/kb.js addLearnedDefect)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'feedback.json');
const MAX_RECORDS = 3000;

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
    console.error('[feedback] 읽기 실패, 새로 시작합니다:', e.message);
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
  const d = new Date();
  const stamp =
    d.getFullYear().toString().slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return `FB${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/**
 * @param {object} opt {recordId, submittedBy, kind:'confirm'|'correct'|'new_defect', processId, processName,
 *   originalDefectId, originalDefectName, correctedDefectId, correctedDefectName,
 *   newDefectName, newDefectDescription, newDefectCauses, newDefectActions, newDefectMeasures,
 *   visualCues, note, imageUrls}
 */
function submit(opt) {
  const list = load();
  const isConfirm = opt.kind === 'confirm';
  const rec = {
    id: newId(),
    at: new Date().toISOString(),
    submittedBy: opt.submittedBy || '',
    recordId: opt.recordId || null,
    kind: opt.kind,
    processId: opt.processId || null,
    processName: opt.processName || '',
    originalDefectId: opt.originalDefectId || null,
    originalDefectName: opt.originalDefectName || '',
    correctedDefectId: opt.correctedDefectId || null,
    correctedDefectName: opt.correctedDefectName || '',
    newDefectName: opt.newDefectName || '',
    newDefectDescription: opt.newDefectDescription || '',
    newDefectCauses: opt.newDefectCauses || [],
    newDefectActions: opt.newDefectActions || [],
    newDefectMeasures: opt.newDefectMeasures || [],
    visualCues: opt.visualCues || [],
    note: String(opt.note || '').slice(0, 500),
    imageUrls: (Array.isArray(opt.imageUrls) ? opt.imageUrls : [])
      .filter((u) => typeof u === 'string' && u.startsWith('/uploads/'))
      .slice(0, 6),
    // 단순 '판정 정확함' 확인은 즉시 신뢰하고, 수정·신규불량은 관리자 확인 후에만 학습에 반영한다
    status: isConfirm ? 'confirmed' : 'pending',
    reviewedAt: isConfirm ? new Date().toISOString() : null,
    reviewedBy: isConfirm ? opt.submittedBy || '' : null,
    addedToKb: false
  };
  list.unshift(rec);
  if (list.length > MAX_RECORDS) list.length = MAX_RECORDS;
  persist();
  return rec;
}

function listAll(query = {}) {
  let items = load();
  if (query.status) items = items.filter((x) => x.status === query.status);
  if (query.kind) items = items.filter((x) => x.kind === query.kind);
  const total = items.length;
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 200));
  return { total, items: items.slice(0, limit) };
}

function get(id) {
  return load().find((x) => x.id === id) || null;
}

function decide(id, status, reviewer) {
  if (!['confirmed', 'rejected'].includes(status)) return null;
  const list = load();
  const rec = list.find((x) => x.id === id);
  if (!rec) return null;
  rec.status = status;
  rec.reviewedAt = new Date().toISOString();
  rec.reviewedBy = reviewer || '';
  persist();
  return rec;
}

function markAddedToKb(id, defectId) {
  const list = load();
  const rec = list.find((x) => x.id === id);
  if (!rec) return null;
  rec.addedToKb = true;
  rec.kbDefectId = defectId;
  persist();
  return rec;
}

/** 최근 확인된(confirmed) 교정 사례 — Vision 프롬프트에 few-shot 참고자료로 주입할 형태 */
function confirmedExamplesFor({ processId, limit = 5 }) {
  const items = load().filter((x) => x.status === 'confirmed' && x.kind !== 'confirm');
  const scoped = processId ? items.filter((x) => x.processId === processId) : items;
  const pool = scoped.length ? scoped : items;
  return pool.slice(0, limit).map((x) => ({
    defectName: x.kind === 'new_defect' ? x.newDefectName : x.correctedDefectName,
    visualCues: x.visualCues,
    note: x.note,
    imageUrls: x.imageUrls || []
  }));
}

module.exports = { submit, list: listAll, get, decide, markAddedToKb, confirmedExamplesFor };
