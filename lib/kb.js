'use strict';
/**
 * 지식베이스(KB) 로더 및 매칭 엔진
 * - kb/processes.json : 공정 메타 + 공통 원인/조치/대책 풀
 * - kb/defects/*.json : 공정별 불량 항목
 */
const fs = require('fs');
const path = require('path');

const KB_DIR = path.join(__dirname, '..', 'kb');
const DEFECT_DIR = path.join(KB_DIR, 'defects');

let _cache = null;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function load(force) {
  if (_cache && !force) return _cache;

  const procFile = readJson(path.join(KB_DIR, 'processes.json'));
  const processes = procFile.processes;
  const universal = procFile.universal;

  const defects = [];
  if (fs.existsSync(DEFECT_DIR)) {
    for (const f of fs.readdirSync(DEFECT_DIR).filter((n) => n.endsWith('.json')).sort()) {
      try {
        const d = readJson(path.join(DEFECT_DIR, f));
        if (Array.isArray(d.defects)) defects.push(...d.defects);
      } catch (e) {
        console.error('[KB] 로드 실패:', f, e.message);
      }
    }
  }

  const byProcess = {};
  for (const p of processes) byProcess[p.id] = { ...p, defects: [] };
  for (const d of defects) {
    if (byProcess[d.process]) byProcess[d.process].defects.push(d);
  }

  _cache = {
    version: readVersion(),
    processes,
    processMap: byProcess,
    defects,
    universal,
    counts: { processes: processes.length, defects: defects.length }
  };
  return _cache;
}

function readVersion() {
  try {
    const v = readJson(path.join(KB_DIR, 'version.json'));
    return v;
  } catch (e) {
    return { kbVersion: '1.0.0', updatedAt: null, source: 'built-in' };
  }
}

function writeVersion(v) {
  fs.writeFileSync(path.join(KB_DIR, 'version.json'), JSON.stringify(v, null, 2), 'utf8');
  _cache = null;
}

const LEARNED_FILE = path.join(DEFECT_DIR, 'learned.json');

/**
 * 관리자가 승인한 사용자 교정 피드백을 지식베이스에 새 불량 항목으로 추가한다.
 * 기존 kb/defects/*.json(펌웨어 업데이트 대상)과 분리된 kb/defects/learned.json 에 누적된다.
 * @param {object} entry {process, name, nameEn, severity, keywords, visualCues, description, detect, causes, actions, measures}
 */
function addLearnedDefect(entry) {
  fs.mkdirSync(DEFECT_DIR, { recursive: true });
  let data;
  try {
    data = fs.existsSync(LEARNED_FILE) ? readJson(LEARNED_FILE) : null;
  } catch (e) {
    data = null;
  }
  if (!data || !Array.isArray(data.defects)) data = { schema: 'qms-defect-kb/1.0', source: 'learned', defects: [] };

  const id = `learned-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const defect = {
    id,
    process: entry.process,
    name: entry.name,
    nameEn: entry.nameEn || '',
    severity: ['critical', 'high', 'medium', 'low'].includes(entry.severity) ? entry.severity : 'medium',
    keywords: entry.keywords || [],
    visualCues: entry.visualCues || [],
    description: entry.description || '',
    detect: entry.detect || '',
    causes: entry.causes || [],
    actions: entry.actions || [],
    measures: entry.measures || []
  };
  data.defects.push(defect);
  fs.writeFileSync(LEARNED_FILE, JSON.stringify(data, null, 2), 'utf8');
  _cache = null;
  return defect;
}

/* ------------------------------------------------------------------ */
/* 텍스트 정규화 & 매칭                                                 */
/* ------------------------------------------------------------------ */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s ]+/g, ' ')
    .replace(/[·・_\-/\\(),.:;'"!?\[\]{}]/g, ' ')
    .trim();
}

/** 공백 제거 압축형 (한국어 띄어쓰기 편차 흡수용) */
function squash(s) {
  return norm(s).replace(/ /g, '');
}

/**
 * 입력 텍스트에서 공정 추정
 * @returns [{id, name, score}]
 */
function guessProcess(text) {
  const kb = load();
  const t = squash(text);
  if (!t) return [];
  const out = [];
  for (const p of kb.processes) {
    let score = 0;
    const hits = [];
    for (const k of p.keywords) {
      const kk = squash(k);
      if (kk && t.includes(kk)) {
        score += Math.min(kk.length, 6) * 2;
        hits.push(k);
      }
    }
    // 공정명 직접 언급 가중
    if (t.includes(squash(p.name))) score += 8;
    if (score > 0) out.push({ id: p.id, name: p.name, score, hits });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * 불량 매칭
 * @param {object} opt {text, processId, cues:[]}
 * @returns [{defect, score, reasons:[]}]
 */
function matchDefects(opt) {
  const kb = load();
  const text = squash(opt.text || '');
  const cues = (opt.cues || []).map(squash).filter(Boolean);
  const pid = opt.processId || null;

  const pool = pid && kb.processMap[pid] ? kb.processMap[pid].defects : kb.defects;
  const results = [];

  for (const d of pool) {
    let score = 0;
    const reasons = [];

    // 1) 불량명 직접 언급 (최고 가중)
    const nm = squash(d.name.replace(/\(.*?\)/g, ''));
    if (nm && text.includes(nm)) {
      score += 40;
      reasons.push(`불량명 일치: ${d.name}`);
    }
    if (d.nameEn && text.includes(squash(d.nameEn))) {
      score += 25;
      reasons.push(`영문명 일치: ${d.nameEn}`);
    }

    // 2) 키워드 매칭
    let kwHit = 0;
    for (const k of d.keywords || []) {
      const kk = squash(k);
      if (kk.length >= 2 && text.includes(kk)) {
        score += Math.min(kk.length, 8) * 3;
        kwHit++;
        if (reasons.length < 6) reasons.push(`키워드: ${k}`);
      }
    }
    if (kwHit >= 3) score += 10; // 다중 키워드 보너스

    // 3) 시각 특징 체크리스트 매칭 (사진 분석 모드)
    let cueHit = 0;
    for (const c of cues) {
      for (const v of d.visualCues || []) {
        const vv = squash(v);
        if (vv === c || (c.length >= 4 && vv.includes(c)) || (vv.length >= 4 && c.includes(vv))) {
          cueHit++;
          break;
        }
      }
    }
    if (cueHit) {
      score += cueHit * 22;
      reasons.push(`시각특징 ${cueHit}개 일치`);
    }

    // 4) 설명문 내 부분 일치 (약한 가중)
    if (text.length >= 4) {
      const desc = squash(d.description + ' ' + (d.visualCues || []).join(' '));
      const frags = (opt.text || '').split(/[\s,./]+/).filter((w) => w.length >= 2);
      let df = 0;
      for (const f of frags) {
        const ff = squash(f);
        if (ff.length >= 2 && desc.includes(ff)) df++;
      }
      if (df) score += Math.min(df * 2, 12);
    }

    // 5) 공정 일치 보너스
    if (pid && d.process === pid) score += 6;

    if (score > 0) results.push({ defect: d, score, reasons });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function getProcess(id) {
  const kb = load();
  return kb.processMap[id] || null;
}

function getDefect(id) {
  const kb = load();
  return kb.defects.find((d) => d.id === id) || null;
}

/**
 * 원인/조치/대책 항목의 텍스트가 KB 내 다른 곳(다른 불량, 공정 공통, 전체 공통)에도
 * 등록되어 있는지 찾는다 — AI 없이도 보여줄 수 있는 "유사 사례".
 * @param {object} opt {text, kind:'cause'|'action'|'measure', excludeDefectId}
 */
function findRelated(opt) {
  const kbData = load();
  const field = opt.kind + 's'; // cause->causes, action->actions, measure->measures
  const key = squash(opt.text);
  if (!key) return { inDefects: [], inProcessCommon: [], inUniversal: false };

  const inDefects = [];
  for (const d of kbData.defects) {
    if (d.id === opt.excludeDefectId) continue;
    const hit = (d[field] || []).some((it) => squash(it.text) === key);
    if (hit) {
      const proc = kbData.processMap[d.process];
      inDefects.push({ id: d.id, name: d.name, processId: d.process, processName: proc ? proc.name : '' });
      if (inDefects.length >= 8) break;
    }
  }

  const commonField = 'common' + opt.kind[0].toUpperCase() + opt.kind.slice(1) + 's';
  const inProcessCommon = [];
  for (const p of kbData.processes) {
    const hit = (p[commonField] || []).some((it) => squash(it.text) === key);
    if (hit) inProcessCommon.push({ processId: p.id, processName: p.name });
  }

  const inUniversal = (kbData.universal[field] || []).some((it) => squash(it.text) === key);

  return { inDefects, inProcessCommon, inUniversal };
}

/** 공정별 시각 특징 체크리스트 (사진 분석 보조) */
function visualCueList(processId) {
  const kb = load();
  const set = new Map();
  const add = (c) => {
    const k = squash(c);
    if (k && !set.has(k)) set.set(k, c);
  };
  if (processId && kb.processMap[processId]) {
    (kb.processMap[processId].visualCues || []).forEach(add);
    kb.processMap[processId].defects.forEach((d) => (d.visualCues || []).forEach(add));
  } else {
    kb.processes.forEach((p) => (p.visualCues || []).forEach(add));
  }
  return [...set.values()];
}

module.exports = {
  load,
  reload: () => load(true),
  readVersion,
  writeVersion,
  guessProcess,
  matchDefects,
  getProcess,
  getDefect,
  findRelated,
  addLearnedDefect,
  visualCueList,
  norm,
  squash,
  KB_DIR,
  DEFECT_DIR
};
