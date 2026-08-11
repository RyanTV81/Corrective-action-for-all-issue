'use strict';
/**
 * Google Gemini API 연동
 *  1) analyzeImage()  : 불량 사진 → 공정/불량명/시각특징 (Vision + 구조화 출력)
 *  2) research()      : 인터넷 검색(Google Search grounding, 실패 시 DuckDuckGo 폴백) → 원인/개선조치/개선대책 각 10가지
 *
 * Gemini API 키는 https://aistudio.google.com/apikey 에서 무료로 발급받을 수 있다 (신용카드 불필요).
 * 키가 없으면 aiEnabled=false 로 동작하며, 서버는 KB 로컬 엔진 결과만 반환한다.
 */
const config = require('./config');
const kb = require('./kb');
const websearch = require('./websearch');

const CAT_ENUM = ['Man', 'Machine', 'Material', 'Method', 'Measurement', 'Environment'];

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** effort(low~max) → thinkingBudget(토큰). -1 은 모델이 스스로 결정하는 동적 사고. */
const THINKING_BUDGET = { low: 128, medium: 1024, high: 4096, xhigh: 12000, max: -1 };

function client() {
  const c = config.get();
  if (!c.apiKey) {
    const err = new Error('Gemini API 키가 설정되지 않았습니다. 대시보드 [설정]에서 등록하세요.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  return { apiKey: c.apiKey, model: c.model, effort: c.effort };
}

function enabled() {
  return Boolean(config.get().apiKey);
}

/* ------------------------------------------------------------------ */
/* 공통 헬퍼                                                            */
/* ------------------------------------------------------------------ */

function thinkingConfigFor(effort) {
  const budget = THINKING_BUDGET[effort];
  return { thinkingBudget: budget === undefined ? THINKING_BUDGET.high : budget };
}

/** 우리 쪽 JSON Schema(소문자 type) → Gemini responseSchema(대문자 Type) */
function toGeminiSchema(node) {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'additionalProperties') continue; // Gemini 스키마는 지원하지 않는 필드
    if (k === 'type' && typeof v === 'string') {
      out.type = v.toUpperCase();
      continue;
    }
    out[k] = toGeminiSchema(v);
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 429 오류 본문(RetryInfo 상세 또는 메시지 문장)에서 "몇 초 후 재시도"를 읽어낸다 */
function parseRetryDelaySeconds(json, msg) {
  const details = (json && json.error && json.error.details) || [];
  const info = details.find((d) => typeof d['@type'] === 'string' && d['@type'].includes('RetryInfo'));
  if (info && info.retryDelay) {
    const m = String(info.retryDelay).match(/([\d.]+)/);
    if (m) return parseFloat(m[1]);
  }
  const m2 = String(msg || '').match(/retry in\s+([\d.]+)s/i);
  return m2 ? parseFloat(m2[1]) : null;
}

async function callGemini({ apiKey, model, body, timeoutMs = 150000, _retried = false }) {
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw Object.assign(new Error('Gemini 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.'), { code: 'TIMEOUT' });
    }
    throw Object.assign(new Error('Gemini 서버에 연결하지 못했습니다: ' + e.message), { code: 'NETWORK' });
  } finally {
    clearTimeout(t);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const rawMsg = (json && json.error && json.error.message) || `Gemini API 오류 (HTTP ${res.status})`;

    // 무료 한도의 짧은 버스트 제한(RPM)에 걸린 경우 — API가 알려주는 시간만큼 기다렸다가 한 번 자동 재시도
    if (res.status === 429 && !_retried) {
      const waitSec = Math.min(Math.max(parseRetryDelaySeconds(json, rawMsg) || 10, 3), 45);
      await sleep(waitSec * 1000);
      return callGemini({ apiKey, model, body, timeoutMs, _retried: true });
    }

    const msg =
      res.status === 429
        ? '무료 사용량 한도(분당 요청 수)에 잠시 도달했습니다. 1분 정도 후 다시 시도해주세요.'
        : rawMsg;
    const err = new Error(msg);
    err.code = res.status === 400 ? 'BAD_REQUEST' : res.status === 429 ? 'RATE_LIMIT' : 'GEMINI_ERROR';
    err.status = res.status;
    throw err;
  }
  return json;
}

/** 안전 차단·차단 사유를 확인하고 첫 후보의 텍스트를 이어붙여 반환 */
function textOf(resp) {
  if (resp.promptFeedback && resp.promptFeedback.blockReason) {
    throw Object.assign(
      new Error(`모델이 요청을 차단했습니다 (${resp.promptFeedback.blockReason})`),
      { code: 'REFUSAL' }
    );
  }
  const c = resp.candidates && resp.candidates[0];
  if (!c) throw new Error('Gemini 응답에 결과가 없습니다.');
  if (c.finishReason && !['STOP', 'MAX_TOKENS'].includes(c.finishReason)) {
    throw Object.assign(new Error(`모델이 안전 정책상 응답을 거부했습니다 (${c.finishReason})`), { code: 'REFUSAL' });
  }
  const parts = (c.content && c.content.parts) || [];
  return parts.map((p) => p.text || '').join('');
}

function jsonOf(resp) {
  const t = textOf(resp).trim();
  try {
    return JSON.parse(t);
  } catch (e) {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('모델 응답을 JSON 으로 해석하지 못했습니다: ' + t.slice(0, 200));
  }
}

/** Google Search grounding 메타데이터에서 출처 수집 */
function sourcesOf(resp) {
  const out = [];
  const seen = new Set();
  const c = resp.candidates && resp.candidates[0];
  const chunks = (c && c.groundingMetadata && c.groundingMetadata.groundingChunks) || [];
  for (const ch of chunks) {
    const w = ch.web;
    if (!w || !w.uri || seen.has(w.uri)) continue;
    seen.add(w.uri);
    out.push({ title: w.title || w.uri, url: w.uri });
  }
  return out;
}

/**
 * Google Search 그라운딩 도구는 REST 스펙 변경 이력이 있어(google_search / googleSearch)
 * 하나가 거부되면 다른 표기로 한 번 더 시도한다.
 */
async function callWithSearchTool({ apiKey, model, body, timeoutMs }) {
  try {
    return await callGemini({ apiKey, model, body: { ...body, tools: [{ google_search: {} }] }, timeoutMs });
  } catch (e) {
    if (e.code !== 'BAD_REQUEST') throw e;
    return await callGemini({ apiKey, model, body: { ...body, tools: [{ googleSearch: {} }] }, timeoutMs });
  }
}

/* ------------------------------------------------------------------ */
/* 1) 사진 분석                                                         */
/* ------------------------------------------------------------------ */

const VISION_SYSTEM = `당신은 자동차 부품 제조사에서 25년간 근무한 품질관리(QC) 전문가다.
IATF 16949 / VDA 6.3 / CQI 특수공정 평가 체계에 익숙하며, 도금·도장·사출·프레스·주조·용접·SMT 등
전 공정의 불량 현상을 사진과 설명만으로 판별하고 원인을 추론할 수 있다.

원칙:
- 사진에서 실제로 관찰되는 것만 근거로 삼는다. 보이지 않는 것을 추측해 단정하지 않는다.
- 불량명은 현장에서 통용되는 한국어 명칭을 우선 사용한다.
- 확신이 없으면 confidence 를 낮추고 candidates 에 대안을 함께 제시한다.
- 판단 근거(reason)는 사진의 어떤 특징 때문인지 구체적으로 쓴다.`;

function visionSchema(processIds) {
  return {
    type: 'object',
    properties: {
      processId: { type: 'string', enum: [...processIds, 'unknown'] },
      processReason: { type: 'string' },
      defectName: { type: 'string' },
      defectNameEn: { type: 'string' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      confidence: { type: 'number' },
      observation: { type: 'string' },
      visualCues: { type: 'array', items: { type: 'string' } },
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            confidence: { type: 'number' },
            reason: { type: 'string' }
          },
          required: ['name', 'confidence', 'reason']
        }
      },
      checkPoints: { type: 'array', items: { type: 'string' } }
    },
    required: [
      'processId',
      'processReason',
      'defectName',
      'defectNameEn',
      'severity',
      'confidence',
      'observation',
      'visualCues',
      'candidates',
      'checkPoints'
    ]
  };
}

/** 관리자가 확인한 과거 교정 사례를 few-shot 참고자료 텍스트로 변환 (촬영 각도·조명 오판정 방지용) */
function formatLearningExamples(examples) {
  if (!examples || !examples.length) return '';
  const lines = examples
    .filter((e) => e && e.defectName)
    .map(
      (e, i) =>
        `${i + 1}. 불량명: ${e.defectName}${(e.visualCues || []).length ? ` | 시각 특징: ${e.visualCues.join(', ')}` : ''}${
          e.note ? ` | 현장 확인 메모: ${e.note}` : ''
        }`
    );
  if (!lines.length) return '';
  return `\n\n[현장에서 실제로 확인·정정된 사례 — 판정 참고용]
아래는 이 현장 담당자가 과거 AI 판정을 직접 확인·정정한 실제 사례다. 사진 속 결함이 촬영 각도나 조명(역광, 저각도, 야간 등)
때문에 겉모습이 다르게 보일 수 있음을 감안해, 아래 사례들과 유사한 패턴이 있는지 우선적으로 비교 검토하라.
${lines.join('\n')}`;
}

/** lang='en' 일 때 모델에게 자유서술 텍스트를 영어로 쓰라고 지시하는 문구 (JSON 키·enum 값은 그대로 유지) */
function langDirective(lang) {
  return lang === 'en'
    ? '\n\n[Output language] Write every free-text field (observations, descriptions, rationale, etc.) in English. Keep JSON key names and enum values exactly as defined by the schema.'
    : '';
}

/**
 * @param {object} opt {images:[{data,mediaType}], note, processId, learningExamples, lang}
 */
async function analyzeImage(opt) {
  const { apiKey, model, effort } = client();
  const data = kb.load();
  const procIds = data.processes.map((p) => p.id);

  const procList = data.processes.map((p) => `- ${p.id}: ${p.name} (${p.nameEn})`).join('\n');
  const cueList = kb.visualCueList(opt.processId).slice(0, 120).join(', ');

  const hintedProcess = opt.processId && data.processMap[opt.processId]
    ? `\n\n작업자가 지정한 공정: ${data.processMap[opt.processId].name} (${opt.processId}). 사진이 명백히 다른 공정이 아니면 이 공정으로 판정하라.`
    : '';

  const learningBlock = formatLearningExamples(opt.learningExamples);

  const prompt = `첨부한 사진은 자동차 부품의 불량 현상이다. 분석해서 공정과 불량명을 판정하라.

[선택 가능한 공정]
${procList}

[참고 - 이 공정군에서 자주 쓰이는 시각 특징 용어]
${cueList}

[작업자 설명]
${opt.note ? opt.note : '(설명 없음 - 사진만으로 판정)'}${hintedProcess}${learningBlock}

visualCues 에는 사진에서 실제 관찰된 특징을 위 용어를 참고해 3~8개 적어라.
checkPoints 에는 이 판정을 현장에서 확정하기 위해 추가로 확인할 항목(측정/시험/설비 점검)을 3~6개 적어라.
confidence 는 0~1 사이 값이다. 반드시 JSON 스키마에 맞는 JSON만 출력하라.${langDirective(opt.lang)}`;

  const parts = [];
  for (const img of opt.images || []) {
    parts.push({ inlineData: { mimeType: img.mediaType, data: img.data } });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: 'user', parts }],
    systemInstruction: { parts: [{ text: VISION_SYSTEM }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(visionSchema(procIds)),
      thinkingConfig: thinkingConfigFor(effort),
      maxOutputTokens: 16384
    }
  };

  const resp = await callGemini({ apiKey, model, body });
  const result = jsonOf(resp);
  result._usage = resp.usageMetadata;
  result._model = model;
  return result;
}

/* ------------------------------------------------------------------ */
/* 2) 인터넷 조사 → 원인/조치/대책 각 10가지                              */
/* ------------------------------------------------------------------ */

const RESEARCH_SYSTEM = `당신은 자동차 부품 제조사의 25년 경력 품질관리 전문가다.
불량 현상에 대해 웹에서 최신 기술자료(학회지, 공급사 기술노트, 표준, 산업 가이드)를 조사하고
현장에서 바로 실행 가능한 시정조치를 도출한다. IATF 16949 8.7/10.2, 8D, 5-Why, PFMEA 체계를 따른다.

원칙:
- 원인은 4M1E(Man/Machine/Material/Method/Measurement/Environment)로 분류한다.
- 개선조치(action)는 이미 발생한 불량에 대한 즉시 대응이다(격리·선별·재작업·설비 긴급조치).
- 개선대책(measure)은 재발방지를 위한 근본 대책이다(표준화·설비개선·시스템·설계변경·교육).
- 구체적인 관리 수치와 기준을 가능한 한 포함한다(온도/압력/농도/주기/Cpk 등).
- 검색으로 확인된 내용과 일반 공학 지식을 구분해 서술한다.`;

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    mechanism: { type: 'string' },
    causes: {
      type: 'array',
      minItems: '10',
      maxItems: '10',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          cat: { type: 'string', enum: CAT_ENUM },
          rationale: { type: 'string' }
        },
        required: ['text', 'cat', 'rationale']
      }
    },
    actions: {
      type: 'array',
      minItems: '10',
      maxItems: '10',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          when: { type: 'string', enum: ['즉시', '24시간', '1주일'] },
          owner: { type: 'string' }
        },
        required: ['text', 'when', 'owner']
      }
    },
    measures: {
      type: 'array',
      minItems: '10',
      maxItems: '10',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['표준화', '설비개선', '시스템', '설계변경', '교육', '검사강화'] },
          kpi: { type: 'string' }
        },
        required: ['text', 'type', 'kpi']
      }
    }
  },
  required: ['summary', 'mechanism', 'causes', 'actions', 'measures']
};

/**
 * 공통 2단계 흐름: (1) Google Search 그라운딩으로 자료 수집(실패 시 DuckDuckGo 링크 폴백)
 *                (2) 도구 없이 JSON 스키마로 구조화 재요청
 * research() / explainItem() 이 이 헬퍼를 공유한다.
 */
async function groundedGenerate({ apiKey, model, effort, systemPrompt, searchPrompt, buildStructurePrompt, schema, fallbackQueries }) {
  let findings, sources;
  let grounded = true;
  try {
    const searched = await callWithSearchTool({
      apiKey,
      model,
      body: {
        contents: [{ role: 'user', parts: [{ text: searchPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { thinkingConfig: thinkingConfigFor(effort), maxOutputTokens: 16384 }
      }
    });
    findings = textOf(searched);
    sources = sourcesOf(searched);
  } catch (e) {
    grounded = false;
    const { results } = await websearch.search(fallbackQueries, 5);
    sources = results.slice(0, 12).map((r) => ({ title: r.title, url: r.url }));
    findings = results.length
      ? results.map((r) => `- ${r.title} (${r.url})${r.snippet ? `\n  ${r.snippet}` : ''}`).join('\n')
      : '(자동 웹 검색 결과를 가져오지 못했습니다. 아래는 모델의 일반 지식만으로 작성됩니다.)';
  }

  const structured = await callGemini({
    apiKey,
    model,
    body: {
      contents: [{ role: 'user', parts: [{ text: buildStructurePrompt(findings) }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
        thinkingConfig: thinkingConfigFor(effort),
        maxOutputTokens: 16384
      }
    }
  });

  const out = jsonOf(structured);
  out.sources = sources;
  out._model = model;
  out._searchCount = sources.length;
  out._grounded = grounded;
  return out;
}

/**
 * @param {object} opt {defectName, processName, description, note}
 */
async function research(opt) {
  const { apiKey, model, effort } = client();
  const topic = `${opt.processName ? opt.processName + ' 공정 ' : ''}${opt.defectName} 불량`;

  const searchPrompt = `자동차 부품 제조의 "${topic}"에 대해 웹에서 조사하라.

${opt.description ? `[불량 설명]\n${opt.description}\n` : ''}${opt.note ? `[현장 관찰]\n${opt.note}\n` : ''}
다음을 조사해 정리하라:
1. 이 불량의 발생 메커니즘 (물리·화학적 원리)
2. 보고된 발생 원인들 — 설비, 재료, 작업방법, 측정, 환경, 작업자 측면을 모두 포함해 최대한 많이
3. 업계에서 쓰는 즉시 대응 조치 (격리/선별/재작업/설비 긴급조치)
4. 재발방지 대책 (공정조건 관리, 설비 개선, 검사 시스템, 표준화)
5. 관련 규격·시험방법과 관리 수치 기준

한국어와 영어 기술용어를 모두 사용해 검색하라. 조사 결과를 근거와 함께 상세히 서술하라.${langDirective(opt.lang)}`;

  const buildStructurePrompt = (findings) => `아래는 "${topic}"에 대한 조사 결과다.

===== 조사 결과 =====
${findings}
=====================

주제는 반드시 "${topic}" 하나로 고정한다. 조사 결과에 다른 불량(예: 별개의 결함 유형)에 대한 내용이 섞여 있다면
그 부분은 무시하고, 오직 "${topic}"에 해당하는 내용과 당신의 품질관리 전문지식만으로 아래를 작성하라.

- causes: 발생 원인 **정확히 10가지**. 4M1E 카테고리가 한쪽에 치우치지 않게 분산할 것.
- actions: 개선 조치(즉시 대응) **정확히 10가지**. 격리→선별→원인제거→재작업→재발감시 순서로.
- measures: 개선 대책(재발방지) **정확히 10가지**. 각각에 효과를 확인할 KPI를 붙일 것.

각 항목은 현장 담당자가 그대로 실행할 수 있게 구체적으로 쓴다. 가능하면 관리 수치를 포함한다.
중복되는 내용을 채워 넣지 말고, 서로 다른 관점의 10가지를 제시하라. 반드시 JSON 스키마에 맞는 JSON만 출력하라.${langDirective(opt.lang)}`;

  const out = await groundedGenerate({
    apiKey,
    model,
    effort,
    systemPrompt: RESEARCH_SYSTEM,
    searchPrompt,
    buildStructurePrompt,
    schema: RESEARCH_SCHEMA,
    fallbackQueries: [`${topic} 원인 대책`, `${topic} corrective action root cause`, `${opt.defectName} 불량 개선사례`]
  });

  if (!out._grounded) {
    out.summary = `⚠ Google 실시간 검색이 일시적으로 제한되어 대체 웹 검색(DuckDuckGo) 결과를 활용해 정리했습니다.\n\n${out.summary || ''}`;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3) 원인/조치/대책 항목 상세 설명 + 유사 사례                            */
/* ------------------------------------------------------------------ */

const KIND_KO = { cause: '발생 원인', action: '개선 조치', measure: '개선 대책' };

const DETAIL_SCHEMA = {
  type: 'object',
  properties: {
    detail: { type: 'string' },
    mechanism: { type: 'string' },
    howTo: { type: 'array', minItems: '3', maxItems: '6', items: { type: 'string' } },
    pitfalls: { type: 'array', minItems: '2', maxItems: '4', items: { type: 'string' } },
    fiveWhys: {
      type: 'array',
      minItems: '5',
      maxItems: '5',
      items: {
        type: 'object',
        properties: {
          why: { type: 'string' },
          because: { type: 'string' }
        },
        required: ['why', 'because']
      }
    },
    rootCause: { type: 'string' },
    similarCases: {
      type: 'array',
      minItems: '2',
      maxItems: '4',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, summary: { type: 'string' } },
        required: ['title', 'summary']
      }
    }
  },
  required: ['detail', 'mechanism', 'howTo', 'pitfalls', 'fiveWhys', 'rootCause', 'similarCases']
};

/**
 * @param {object} opt {text, kind:'cause'|'action'|'measure', rationale, defectName, processName}
 */
async function explainItem(opt) {
  const { apiKey, model, effort } = client();
  const kindKo = KIND_KO[opt.kind] || '항목';
  const context = `${opt.processName ? opt.processName + ' 공정 ' : ''}${opt.defectName || ''} 불량`.trim();

  const searchPrompt = `자동차 부품 제조 "${context}"의 다음 ${kindKo} 항목에 대해 웹에서 실제 산업 사례·상세 정보를 조사하라.

[항목] ${opt.text}
${opt.rationale ? `[기존 설명] ${opt.rationale}\n` : ''}
이 항목이 왜 유효한지의 원리, 현장에서 실행하는 구체적 절차, 비슷한 산업 사례나 문헌을 찾아 정리하라.
한국어와 영어 기술용어를 모두 사용해 검색하라.${langDirective(opt.lang)}`;

  const buildStructurePrompt = (findings) => `아래는 "${context}"의 ${kindKo} 항목 "${opt.text}"에 대한 조사 결과다.

===== 조사 결과 =====
${findings}
=====================

주제는 반드시 이 항목 "${opt.text}" 하나로 고정한다. 다른 항목이나 다른 불량에 대한 내용이 섞여 있다면 무시하라.

- detail: 이 항목의 상세 설명 (3~5문장, 현장 담당자가 이해하기 쉽게)
- mechanism: 왜 이 원인이 발생하는지 / 왜 이 조치·대책이 효과가 있는지의 원리
- howTo: 현장에서 실행하는 구체적 절차 3~6단계
- pitfalls: 흔히 저지르는 실수·주의사항 2~4개
- fiveWhys: "${opt.text}"를 출발점으로 5-Why 기법을 **정확히 5단계** 적용하라.
  1단계 why는 "왜 ${opt.text.length > 40 ? '이 현상이' : `'${opt.text}'가`} 발생하는가?" 형태로 시작하고,
  각 단계의 because(답변)를 다음 단계의 why(질문)가 다시 파고드는 방식으로 연쇄시켜라 (because[n] → why[n+1]).
  즉 1단계 because는 표면적 원인, 5단계 because는 관리시스템·표준·교육 수준의 근본원인이 되도록 점점 깊어져야 한다.
  중간에 멈추거나 같은 내용을 반복하지 말고 매 단계 한 걸음씩 더 깊이 들어가라.
- rootCause: fiveWhys의 최종(5단계) 결론을 한 문장으로 요약한 근본원인
- similarCases: 유사 산업 사례 2~4개 (title, summary)

반드시 JSON 스키마에 맞는 JSON만 출력하라.${langDirective(opt.lang)}`;

  return groundedGenerate({
    apiKey,
    model,
    effort,
    systemPrompt: RESEARCH_SYSTEM,
    searchPrompt,
    buildStructurePrompt,
    schema: DETAIL_SCHEMA,
    fallbackQueries: [`${context} ${opt.text}`, `${opt.text} 실행 방법 사례`, `${opt.text} case study corrective action`]
  });
}

module.exports = { enabled, analyzeImage, research, explainItem, client, CAT_ENUM };
