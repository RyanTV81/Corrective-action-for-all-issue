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
const security = require('./security');

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
/** 사용자가 보낸 값은 문자열만, 길이도 제한해서 저장한다 (관리자 화면으로 들어가는 값이라 특히 엄격하게) */
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const strList = (v, max = 20, len = 200) =>
  (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string').slice(0, max).map((x) => x.slice(0, len));

function submit(opt) {
  const list = load();
  const isConfirm = opt.kind === 'confirm';
  const rec = {
    id: newId(),
    at: new Date().toISOString(),
    submittedBy: str(opt.submittedBy, 64),
    recordId: str(opt.recordId, 40) || null,
    kind: opt.kind,
    processId: str(opt.processId, 60) || null,
    processName: str(opt.processName, 100),
    originalDefectId: str(opt.originalDefectId, 60) || null,
    originalDefectName: str(opt.originalDefectName, 100),
    correctedDefectId: str(opt.correctedDefectId, 60) || null,
    correctedDefectName: str(opt.correctedDefectName, 100),
    newDefectName: str(opt.newDefectName, 100),
    newDefectDescription: str(opt.newDefectDescription, 1000),
    newDefectCauses: strList(opt.newDefectCauses),
    newDefectActions: strList(opt.newDefectActions),
    newDefectMeasures: strList(opt.newDefectMeasures),
    visualCues: strList(opt.visualCues, 20, 100),
    note: str(opt.note, 500),
    // 서버가 만든 업로드 경로 형식(/uploads/파일명.jpg)에 정확히 맞는 값만 남긴다.
    // 이 값은 관리자 화면에서 <img src>로 쓰이므로, 형식을 안 지키면 화면 조작(XSS)에 악용될 수 있다.
    imageUrls: (Array.isArray(opt.imageUrls) ? opt.imageUrls : []).filter(security.isUploadUrl).slice(0, 6),
    // 단순 '판정 정확함' 확인은 즉시 신뢰하고, 수정·신규불량은 관리자 확인 후에만 학습에 반영한다
    status: isConfirm ? 'confirmed' : 'pending',
    reviewedAt: isConfirm ? new Date().toISOString() : null,
    reviewedBy: isConfirm ? str(opt.submittedBy, 64) : null,
    addedToKb: false
  };
  list.unshift(rec);
  if (list.length > MAX_RECORDS) list.length = MAX_RECORDS;
  persist();
  return rec;
}

function listAll(query = {}) {
  const all = load();
  // 관리자 화면이 상태별 탭(대기·확정·거부)을 그리므로, 걸러내기 전의 상태별 건수도 함께 넘긴다.
  const counts = { pending: 0, confirmed: 0, rejected: 0 };
  for (const x of all) if (counts[x.status] !== undefined) counts[x.status] += 1;
  counts.all = all.length;

  let items = all;
  if (query.status) items = items.filter((x) => x.status === query.status);
  if (query.kind) items = items.filter((x) => x.kind === query.kind);
  const total = items.length;
  const limit = Math.min(500, Math.max(1, Number(query.limit) || 200));
  return { total, counts, items: items.slice(0, limit) };
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

/** 피드백 기록 1건 삭제 — 지식베이스에 이미 등록한 불량 항목은 건드리지 않는다 */
function remove(id) {
  const list = load();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [rec] = list.splice(i, 1);
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

module.exports = { submit, list: listAll, get, decide, remove, markAddedToKb, confirmedExamplesFor };
