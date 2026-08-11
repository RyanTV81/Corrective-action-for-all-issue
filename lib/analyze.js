'use strict';
/**
 * 분석 오케스트레이터
 * - 로컬 KB 엔진으로 항상 10/10/10 을 구성하고
 * - API 키가 있으면 Gemini 사진분석 / 인터넷 조사 결과를 병합한다.
 */
const kb = require('./kb');
const ai = require('./ai');
const feedback = require('./feedback');

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

/** 로컬 KB만으로 리포트 구성 */
function localReport({ defect, process: proc }) {
  const data = kb.load();
  const uni = data.universal;

  const causes = collect(
    [
      { items: defect ? defect.causes : [], origin: '불량항목' },
      { items: proc ? proc.commonCauses : [], origin: '공정공통' },
      { items: uni.causes, origin: '공통(4M)' }
    ],
    TARGET
  );

  const actions = collect(
    [
      { items: defect ? defect.actions : [], origin: '불량항목' },
      { items: proc ? proc.commonActions : [], origin: '공정공통' },
      { items: uni.actions, origin: '공통(4M)' }
    ],
    TARGET
  );

  const measures = collect(
    [
      { items: defect ? defect.measures : [], origin: '불량항목' },
      { items: proc ? proc.commonMeasures : [], origin: '공정공통' },
      { items: uni.measures, origin: '공통(4M)' }
    ],
    TARGET
  );

  return { causes, actions, measures };
}

/** 로컬 결과 + AI 결과 병합 (AI 항목을 앞에 두고 10개로 맞춤) */
function merge(local, aiRes) {
  if (!aiRes) return local;
  const pair = (aiItems, localItems) =>
    collect(
      [
        { items: aiItems, origin: 'AI·웹조사' },
        { items: localItems, origin: null } // null → 로컬 항목의 origin 유지
      ],
      TARGET
    );
  return {
    causes: pair(aiRes.causes, local.causes),
    actions: pair(aiRes.actions, local.actions),
    measures: pair(aiRes.measures, local.measures)
  };
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
    reasons: m.reasons
  }));

  const primary = matches.length ? matches[0].defect : null;

  /* 4) 로컬 리포트 */
  const local = localReport({ defect: primary, process: proc });

  /* 5) 인터넷 조사 */
  let web = null;
  const defectLabel = (primary && primary.name) || (vision && vision.defectName) || opt.text;
  if (opt.useAI && opt.useWeb && defectLabel) {
    try {
      web = await ai.research({
        defectName: defectLabel,
        processName: proc ? proc.name : '',
        description: primary ? primary.description : '',
        note: [opt.text, vision ? vision.observation : ''].filter(Boolean).join(' / '),
        lang: opt.lang
      });
    } catch (e) {
      warnings.push(`인터넷 조사 실패: ${e.message}`);
    }
  }

  const merged = merge(local, web);

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
          visualCues: primary.visualCues
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
    counts: {
      causes: merged.causes.length,
      actions: merged.actions.length,
      measures: merged.measures.length
    }
  };
}

module.exports = { analyze, localReport, TARGET };
