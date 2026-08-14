'use strict';
/**
 * 분석 오케스트레이터
 * - 로컬 KB 엔진으로 항상 10/10/10 을 구성하고
 * - API 키가 있으면 Gemini 사진분석 / 인터넷 조사 결과를 병합한다.
 */
const kb = require('./kb');
const ai = require('./ai');
const feedback = require('./feedback');
const insights = require('./insights');

const TARGET = 10;

/* ------------------------------------------------------------------ */
/* 풀 구성 (중복 제거 + 출처 표시)                                       */
/* ------------------------------------------------------------------ */

function collect(sources, target) {
  const out = [];
  const seen = new Set();
  for (const { items, origin } of sources) {
    for (const it of items || []) {
      const text = typeof it === 'string' ? it : it.text;
      if (!text) continue;
      const key = kb.squash(text).slice(0, 40);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const base = typeof it === 'string' ? { text: it } : it;
      out.push({ ...base, origin: origin || base.origin || '' });
      if (out.length >= target) return out;
    }
  }
  return out;
}

/**
 * 원인·조치·대책 10개씩을 구성한다. 있는 자료를 모두 끌어와 순서대로 채우고 중복은 걸러낸다.
 *   1) 이번 인터넷 조사 (가장 구체적)
 *   2) 지식베이스 불량항목 — 관리자가 [KB 등록]한 항목이면 '학습 등록' 으로 구분 표시
 *   3) 지난 조사에서 쌓인 내용 (lib/insights.js)
 *   4) 공정 공통 → 5) 4M 공통
 */
function report({ defect, process: proc, web, memory }) {
  const uni = kb.load().universal;

  const build = (key, procKey) =>
    collect(
      [
        { items: web ? web[key] : [], origin: 'AI·웹조사' },
        { items: defect ? defect[key] : [], origin: defect && defect.learned ? '학습 등록' : '불량항목' },
        { items: memory ? memory[key] : [], origin: '축적 웹조사' },
        { items: proc ? proc[procKey] : [], origin: '공정공통' },
        { items: uni[key], origin: '공통(4M)' }
      ],
      TARGET
    );

  return {
    causes: build('causes', 'commonCauses'),
    actions: build('actions', 'commonActions'),
    measures: build('measures', 'commonMeasures')
  };
}

/** 로컬 KB만으로 리포트 구성 (지식베이스 화면에서 항목 하나를 펼쳐볼 때 쓴다) */
function localReport({ defect, process: proc }) {
  return report({ defect, process: proc, web: null, memory: null });
}

/* ------------------------------------------------------------------ */
/* 메인 진입점                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {object} opt
 *   text       설명 텍스트
 *   processId  지정 공정 (없으면 추정)
 *   cues       선택한 시각 특징 배열
 *   images     [{data, mediaType}]  base64
 *   useAI      AI 사용 여부
 *   useWeb     인터넷 조사 여부
 */
async function analyze(opt) {
  const data = kb.load();
  const warnings = [];
  const started = Date.now();

  let processId = opt.processId || null;
  let vision = null;

  /* 1) 사진 분석 (AI) — 현장에서 확인된 과거 교정 사례를 참고자료로 함께 전달 */
  if (opt.images && opt.images.length && opt.useAI) {
    try {
      const learningExamples = feedback.confirmedExamplesFor({ processId, limit: 5 });
      vision = await ai.analyzeImage({
        images: opt.images,
        note: opt.text,
        processId,
        learningExamples,
        lang: opt.lang
      });
      if (!processId && vision.processId && vision.processId !== 'unknown') {
        processId = vision.processId;
      }
    } catch (e) {
      warnings.push(`사진 분석 실패: ${e.message}`);
    }
  } else if (opt.images && opt.images.length && !opt.useAI) {
    warnings.push('AI 가 꺼져 있어 사진은 분석되지 않았습니다. 설명·시각특징만으로 매칭합니다.');
  }

  /* 2) 공정 추정 */
  const searchText = [opt.text, vision ? vision.defectName : '', vision ? vision.observation : '']
    .filter(Boolean)
    .join(' ');

  const processGuesses = kb.guessProcess(searchText);
  if (!processId && processGuesses.length) processId = processGuesses[0].id;

  const proc = processId ? kb.getProcess(processId) : null;

  /* 3) 불량 매칭 */
  const cues = [...(opt.cues || []), ...(vision ? vision.visualCues || [] : [])];
  const matches = kb.matchDefects({
    text: [searchText, cues.join(' ')].join(' '),
    cues,
    processId
  });

  const top = matches.slice(0, 5).map((m) => ({
    id: m.defect.id,
    name: m.defect.name,
    nameEn: m.defect.nameEn,
    process: m.defect.process,
    processName: data.processMap[m.defect.process] ? data.processMap[m.defect.process].name : '',
    severity: m.defect.severity,
    score: m.score,
    learned: Boolean(m.defect.learned),
    reasons: m.reasons
  }));

  const primary = matches.length ? matches[0].defect : null;

  /* 4) 인터넷 조사 */
  let web = null;
  const defectLabel = (primary && primary.name) || (vision && vision.defectName) || opt.text;
  const memoryKey = {
    defectId: primary ? primary.id : null,
    defectName: defectLabel,
    processId,
    processName: proc ? proc.name : ''
  };

  if (opt.useAI && opt.useWeb && defectLabel) {
    try {
      web = await ai.research({
        defectName: defectLabel,
        processName: proc ? proc.name : '',
        description: primary ? primary.description : '',
        note: [opt.text, vision ? vision.observation : ''].filter(Boolean).join(' / '),
        // 지난 조사에서 이미 얻은 내용 — 같은 답을 반복하지 말고 새로운 것을 찾게 한다
        known: insights.find(memoryKey),
        lang: opt.lang
      });
      // 이번에 찾은 내용을 쌓아두고 다음 조회에서 다시 쓴다
      insights.remember({ ...memoryKey, research: web });
    } catch (e) {
      warnings.push(`인터넷 조사 실패: ${e.message}`);
    }
  }

  /* 5) 지금까지 쌓인 조사 내용 — 인터넷 조사를 켜지 않아도 함께 반영한다 */
  const memory = defectLabel ? insights.find(memoryKey) : null;

  const merged = report({ defect: primary, process: proc, web, memory });

  return {
    ok: true,
    elapsedMs: Date.now() - started,
    aiEnabled: ai.enabled(),
    usedAI: Boolean(vision || web),
    warnings,
    input: {
      text: opt.text || '',
      cues: opt.cues || [],
      imageCount: (opt.images || []).length,
      requestedProcess: opt.processId || null
    },
    process: proc
      ? {
          id: proc.id,
          name: proc.name,
          nameEn: proc.nameEn,
          icon: proc.icon,
          standards: proc.standards,
          keyParams: proc.keyParams,
          guessed: !opt.processId
        }
      : null,
    processGuesses: processGuesses.slice(0, 3),
    vision,
    defect: primary
      ? {
          id: primary.id,
          name: primary.name,
          nameEn: primary.nameEn,
          severity: primary.severity,
          description: primary.description,
          detect: primary.detect,
          visualCues: primary.visualCues,
          learned: Boolean(primary.learned)
        }
      : null,
    candidates: top,
    causes: merged.causes,
    actions: merged.actions,
    measures: merged.measures,
    web: web
      ? {
          summary: web.summary,
          mechanism: web.mechanism,
          sources: web.sources || [],
          model: web._model
        }
      : null,
    // 지난 조사에서 쌓아둔 내용 (이번에 조사하지 않았어도 붙는다)
    knowledge: memory
      ? {
          defectName: memory.defectName,
          summary: memory.summary || '',
          mechanism: memory.mechanism || '',
          sources: memory.sources || [],
          runs: memory.runs || 0,
          updatedAt: memory.updatedAt || null,
          counts: {
            causes: (memory.causes || []).length,
            actions: (memory.actions || []).length,
            measures: (memory.measures || []).length
          },
          // 이번 조사 결과와 같은 내용이면 화면에서 중복 안내하지 않도록 표시
          freshRun: Boolean(web)
        }
      : null,
    counts: {
      causes: merged.causes.length,
      actions: merged.actions.length,
      measures: merged.measures.length
    }
  };
}

module.exports = { analyze, localReport, TARGET };
