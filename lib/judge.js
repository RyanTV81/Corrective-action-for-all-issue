'use strict';
/**
 * 공정 이상 판정
 *
 * 분석 결과(analyze.js 출력)를 받아 "이게 공정 문제인가, 그렇다면 어느 수준인가"를 판정한다.
 * 심각도 · 판정 신뢰도 · 재발 이력 · 원인의 4M1E 분포를 종합해 리스크 점수(0~100)를 낸다.
 */
const store = require('./store');

const SEV_SCORE = { critical: 52, high: 40, medium: 24, low: 10 };

const CAT_MEANING = {
  Machine: {
    label: '설비·공정조건',
    labelEn: 'Equipment/Process Conditions',
    fault: '공정',
    faultEn: 'process',
    hint: '설비 상태와 공정 파라미터가 관리범위를 벗어났을 가능성이 큽니다.',
    hintEn: 'Equipment condition and process parameters are likely out of control range.'
  },
  Method: {
    label: '작업방법·표준',
    labelEn: 'Work Method/Standard',
    fault: '공정',
    faultEn: 'process',
    hint: '작업표준(SOP)과 실제 작업 방법의 불일치를 우선 확인하세요.',
    hintEn: 'First check for mismatches between the SOP and actual work practice.'
  },
  Material: {
    label: '소재·부품',
    labelEn: 'Material/Part',
    fault: '입고',
    faultEn: 'incoming material',
    hint: '자사 공정보다 소재/부품 입고 품질을 먼저 확인해야 합니다.',
    hintEn: 'Check incoming material/part quality before suspecting your own process.'
  },
  Man: {
    label: '작업자',
    labelEn: 'Operator',
    fault: '인적',
    faultEn: 'human',
    hint: '교육·자격 인증과 교대/신규 투입 이력을 확인하세요.',
    hintEn: 'Check training/certification records and any shift changes or new operator assignments.'
  },
  Measurement: {
    label: '측정·검사',
    labelEn: 'Measurement/Inspection',
    fault: '검출',
    faultEn: 'detection',
    hint: '측정시스템(MSA)과 검사 기준의 신뢰성을 먼저 검증하세요.',
    hintEn: 'First verify the reliability of the measurement system (MSA) and inspection criteria.'
  },
  Environment: {
    label: '작업환경',
    labelEn: 'Work Environment',
    fault: '환경',
    faultEn: 'environment',
    hint: '온·습도, 청정도 등 환경 관리기준 설정 여부를 확인하세요.',
    hintEn: 'Check whether environmental control standards (temperature, humidity, cleanliness, etc.) are established.'
  }
};

const LEVELS = {
  critical: {
    label: '공정 이상 — 즉시 조치 필요',
    labelEn: 'Process Anomaly — Immediate Action Required',
    action: '해당 로트 격리 후 생산 중단 여부를 검토하고, 공정 조건을 즉시 점검하세요.',
    actionEn: 'Contain the affected lot, evaluate whether to halt production, and inspect process conditions immediately.',
    color: 'high'
  },
  warning: {
    label: '공정 이상 의심 — 점검 필요',
    labelEn: 'Suspected Process Anomaly — Inspection Required',
    action: '초·중·종물 검사를 강화하고 관련 공정 파라미터를 실측해 관리범위와 대조하세요.',
    actionEn: 'Strengthen first/mid/last-piece inspection and measure process parameters against control limits.',
    color: 'medium'
  },
  watch: {
    label: '경향 관리 — 모니터링',
    labelEn: 'Trend Watch — Monitoring',
    action: '공정능력(Cpk)과 발생 추이를 관찰하고, 재발 시 즉시 상위 조치로 전환하세요.',
    actionEn: 'Monitor process capability (Cpk) and occurrence trends; escalate immediately if it recurs.',
    color: 'low'
  },
  ok: {
    label: '산발 불량 — 표준 대응',
    labelEn: 'Sporadic Defect — Standard Response',
    action: '표준 시정조치 절차로 처리하고 이력에 기록해 추이를 관리하세요.',
    actionEn: 'Handle via the standard corrective action procedure and log it to track trends.',
    color: 'ok'
  }
};

/** 매칭 점수·사진 신뢰도를 0~1 로 합성 */
function confidenceOf(result) {
  const match = result.candidates && result.candidates.length ? result.candidates[0].score : 0;
  const matchNorm = Math.min(1, match / 60);
  const vis = result.vision && typeof result.vision.confidence === 'number' ? result.vision.confidence : null;

  if (vis === null) return matchNorm;
  if (!match) return vis;
  return Math.min(1, matchNorm * 0.55 + vis * 0.45);
}

function categoryMix(causes) {
  const mix = {};
  for (const c of causes || []) {
    const cat = c.cat || 'Method';
    mix[cat] = (mix[cat] || 0) + 1;
  }
  return mix;
}

/** 원인 텍스트에서 공정 관리 파라미터를 뽑아 점검 항목으로 제시 */
function checkParams(result) {
  const params = (result.process && result.process.keyParams) || [];
  if (!params.length) return [];

  const blob = (result.causes || [])
    .map((c) => c.text)
    .join(' ')
    .toLowerCase();

  const hit = params.filter((p) => {
    const head = String(p).split(/[(（]/)[0].trim().toLowerCase();
    return head.length >= 2 && blob.includes(head);
  });

  return (hit.length ? hit : params).slice(0, 6);
}

/**
 * @param {object} result analyze() 결과
 * @param {string} lang 'ko'(기본) | 'en'
 * @returns 판정 객체
 */
function judge(result, lang) {
  const en = lang === 'en';
  const reasons = [];
  let score = 0;

  /* 1) 심각도 */
  const severity =
    (result.defect && result.defect.severity) || (result.vision && result.vision.severity) || 'medium';
  score += SEV_SCORE[severity] || 24;
  if (severity === 'critical') {
    reasons.push(
      en
        ? 'Critical defect — directly tied to safety, regulatory, or field-claim risk. Consider halting shipment.'
        : '치명 불량(critical) — 안전·법규·필드 클레임에 직결되는 항목입니다. 출하 정지 검토가 필요합니다.'
    );
  } else if (severity === 'high') {
    reasons.push(en ? 'Classified as a high-severity defect.' : '중대 불량(high)으로 분류되는 항목입니다.');
  }

  /* 2) 판정 신뢰도 */
  const confidence = confidenceOf(result);
  if (confidence >= 0.7) {
    score += 12;
    reasons.push(
      en ? `High judgement confidence (${Math.round(confidence * 100)}%).` : `불량 판정 신뢰도가 높습니다(${Math.round(confidence * 100)}%).`
    );
  } else if (confidence < 0.35) {
    score -= 6;
    reasons.push(
      en
        ? `Low judgement confidence (${Math.round(confidence * 100)}%). Re-verify with additional photos or measurements.`
        : `판정 신뢰도가 낮습니다(${Math.round(confidence * 100)}%). 추가 사진·측정 데이터로 재확인이 필요합니다.`
    );
  }

  /* 3) 재발 이력 (최근 30일) */
  let recurrence = { count: 0, days: 30, lastAt: null };
  try {
    const same = store.recentSame(
      {
        processId: result.process ? result.process.id : null,
        defectId: result.defect ? result.defect.id : null,
        defectName: result.defect ? result.defect.name : result.vision ? result.vision.defectName : null
      },
      30
    );
    recurrence = { count: same.length, days: 30, lastAt: same.length ? same[0].at : null };

    if (same.length >= 3) {
      score += 25;
      reasons.push(
        en
          ? `Same defect recurred ${same.length} times in the last 30 days — treated as a process issue, not sporadic.`
          : `최근 30일 내 동일 불량이 ${same.length}건 반복되었습니다 — 산발이 아닌 공정 문제로 판단합니다.`
      );
    } else if (same.length >= 1) {
      score += 10;
      reasons.push(
        en
          ? `${same.length} case(s) of the same defect already recorded in the last 30 days.`
          : `최근 30일 내 동일 불량 ${same.length}건이 이미 기록되어 있습니다.`
      );
    }
  } catch (e) {
    /* 이력 조회 실패는 판정을 막지 않는다 */
  }

  /* 4) 원인의 4M1E 분포 */
  const mix = categoryMix(result.causes);
  const total = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  const dominantCat = sorted.length ? sorted[0][0] : 'Method';
  const dominantRatio = sorted.length ? sorted[0][1] / total : 0;
  const meaning = CAT_MEANING[dominantCat] || CAT_MEANING.Method;
  const meaningLabel = en ? meaning.labelEn : meaning.label;

  if (['Machine', 'Method'].includes(dominantCat) && dominantRatio >= 0.4) {
    score += 12;
    reasons.push(
      en
        ? `Estimated causes are concentrated in ${meaningLabel} (${Math.round(dominantRatio * 100)}%), suggesting the process itself is likely at fault.`
        : `추정 원인이 ${meaningLabel}에 집중(${Math.round(dominantRatio * 100)}%)되어 공정 자체의 문제일 가능성이 높습니다.`
    );
  } else if (dominantCat === 'Material' && dominantRatio >= 0.4) {
    reasons.push(
      en
        ? `Estimated causes are concentrated in ${meaningLabel} — check incoming material quality before your own process.`
        : `추정 원인이 ${meaningLabel}에 집중되어 있어, 자사 공정보다 입고 품질을 먼저 확인해야 합니다.`
    );
  }

  /* 5) 공정 미확정 */
  if (!result.process) {
    score -= 8;
    reasons.push(
      en
        ? 'Process not determined. Specifying the process improves judgement accuracy.'
        : '공정이 확정되지 않았습니다. 공정을 지정하면 판정 정확도가 올라갑니다.'
    );
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  /* 등급 */
  let level = 'ok';
  if (score >= 70) level = 'critical';
  else if (score >= 45) level = 'warning';
  else if (score >= 25) level = 'watch';

  const immediate = (result.actions || []).slice(0, 3).map((a) => a.text);

  return {
    level,
    label: en ? LEVELS[level].labelEn : LEVELS[level].label,
    guidance: en ? LEVELS[level].actionEn : LEVELS[level].action,
    color: LEVELS[level].color,
    score,
    confidence: Math.round(confidence * 100) / 100,
    severity,
    processFault: ['Machine', 'Method'].includes(dominantCat),
    faultDomain: en ? meaning.faultEn : meaning.fault,
    dominantCause: { cat: dominantCat, label: meaningLabel, ratio: Math.round(dominantRatio * 100), hint: en ? meaning.hintEn : meaning.hint },
    causeMix: mix,
    recurrence,
    reasons,
    immediate,
    checkParams: checkParams(result),
    needsContainment: level === 'critical' || severity === 'high',
    escalate: level === 'critical' || recurrence.count >= 3
  };
}

module.exports = { judge, LEVELS, CAT_MEANING };
