'use strict';
/* 공정 불량 분석 대시보드 — 프론트엔드 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  boot: null,
  processes: [],
  procId: null,
  cues: new Set(),
  files: [],
  result: null,
  settings: null,
  role: null
};

/* ------------------------------------------------------------------ */
/* 공통                                                                 */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SEV = {
  critical: { ko: '치명', cls: 'high' },
  high: { ko: '중대', cls: 'high' },
  medium: { ko: '경미', cls: 'medium' },
  low: { ko: '관찰', cls: 'low' }
};
const sev = (s) => SEV[s] || SEV.medium;

const LEVEL_KO = { critical: '공정 이상', warning: '이상 의심', watch: '경향 관리', ok: '산발 불량' };

const CAT_KO = {
  Man: '사람(Man)',
  Machine: '설비(Machine)',
  Material: '재료(Material)',
  Method: '방법(Method)',
  Measurement: '측정(Measurement)',
  Environment: '환경(Environment)'
};

function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isErr ? 6000 : 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error('로그인이 필요합니다');
  }
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || `요청 실패 (${res.status})`);
  return body;
}

const fmtDate = (iso) => (iso || '').replace('T', ' ').slice(0, 16);

/* ------------------------------------------------------------------ */
/* 초기화                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  bindStaticEvents();
  try {
    const [boot, me] = await Promise.all([api('/api/bootstrap'), api('/api/me')]);
    state.boot = boot;
    state.processes = boot.processes;
    state.settings = boot.settings;
    state.role = me.role;

    $('#chipKb').textContent = `KB v${boot.kb.version.kbVersion} · 불량 ${boot.kb.counts.defects}건`;
    $('#stProc').textContent = boot.kb.counts.processes;
    $('#stDef').textContent = boot.kb.counts.defects;
    setAiChip(boot.aiEnabled);

    renderProcGrid();
    fillProcFilter();
    applySettingsToForm();
    loadCues();
    loadStats();
    loadHistory();
    renderKbList();

    if (me.role === 'admin') {
      $('#btnUsers').hidden = false;
      refreshPendingCount();
    }
  } catch (e) {
    toast('초기화 실패: ' + e.message, true);
  }
}

function setAiChip(on) {
  const c = $('#chipAi');
  c.className = 'chip ' + (on ? 'ok' : 'off');
  c.textContent = on ? `AI 활성 · ${state.settings ? state.settings.model : ''}` : 'AI 비활성 (내장 KB만)';
  $('#aiNote').textContent = on
    ? 'AI 판독이 활성화되어 사진 분석과 인터넷 조사를 사용할 수 있습니다.'
    : 'API 키가 없어 내장 지식베이스로만 분석합니다(오프라인 동작). 이 경우에도 원인·개선조치·개선대책은 각 10가지가 제공됩니다.';
}

/* ------------------------------------------------------------------ */
/* 공정 · 시각특징                                                       */
/* ------------------------------------------------------------------ */

function renderProcGrid() {
  $('#procGrid').innerHTML = state.processes
    .map(
      (p) => `<button type="button" class="proc" data-id="${p.id}" title="${esc(p.nameEn)} · 불량 ${p.defectCount}건">
        <span class="ic">${p.icon}</span><span class="n">${esc(p.name)}</span><span class="c">${p.defectCount}</span>
      </button>`
    )
    .join('');
  $$('#procGrid .proc').forEach((b) =>
    b.addEventListener('click', () => {
      state.procId = state.procId === b.dataset.id ? null : b.dataset.id;
      state.cues.clear();
      $$('#procGrid .proc').forEach((x) => x.classList.toggle('on', x.dataset.id === state.procId));
      loadCues();
    })
  );
}

function fillProcFilter() {
  $('#fProc').innerHTML =
    '<option value="">전체 공정</option>' +
    state.processes.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}

async function loadCues() {
  const box = $('#cues');
  box.innerHTML = '<small>불러오는 중…</small>';
  try {
    const { cues } = await api('/api/cues' + (state.procId ? `?processId=${state.procId}` : ''));
    if (!cues.length) return (box.innerHTML = '<small>표시할 항목이 없습니다.</small>');
    box.innerHTML = cues.map((c) => `<button type="button" class="cue">${esc(c)}</button>`).join('');
    $$('#cues .cue', box).forEach((b) =>
      b.addEventListener('click', () => {
        const v = b.textContent;
        if (state.cues.has(v)) state.cues.delete(v);
        else state.cues.add(v);
        b.classList.toggle('on');
      })
    );
  } catch (e) {
    box.innerHTML = `<small>불러오지 못했습니다: ${esc(e.message)}</small>`;
  }
}

/* ------------------------------------------------------------------ */
/* 사진 업로드                                                          */
/* ------------------------------------------------------------------ */

function addFiles(list) {
  for (const f of list) {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) {
      toast(`${f.name}: 지원하지 않는 형식입니다.`, true);
      continue;
    }
    if (f.size > 12 * 1024 * 1024) {
      toast(`${f.name}: 12MB를 초과합니다.`, true);
      continue;
    }
    if (state.files.length >= 6) {
      toast('사진은 최대 6장까지 첨부할 수 있습니다.', true);
      break;
    }
    state.files.push(f);
  }
  renderThumbs();
}

function renderThumbs() {
  const box = $('#thumbs');
  box.innerHTML = '';
  state.files.forEach((f, i) => {
    const url = URL.createObjectURL(f);
    const d = document.createElement('div');
    d.className = 'thumb';
    d.innerHTML = `<img src="${url}" alt="${esc(f.name)}"><button type="button" title="삭제">&times;</button>`;
    d.querySelector('button').addEventListener('click', () => {
      URL.revokeObjectURL(url);
      state.files.splice(i, 1);
      renderThumbs();
    });
    box.appendChild(d);
  });
}

/* ------------------------------------------------------------------ */
/* 분석 실행                                                            */
/* ------------------------------------------------------------------ */

async function analyze() {
  const text = $('#text').value.trim();
  if (!text && state.files.length === 0) {
    toast('불량 설명을 입력하거나 사진을 첨부하세요.', true);
    return;
  }

  const btn = $('#btnAnalyze');
  btn.disabled = true;
  btn.textContent = '분석 중…';
  showView('analyze');
  $('#resultBox').innerHTML = `<div class="loading"><div class="spinner"></div>
    <h3>불량을 분석하고 있습니다</h3>
    <p>${state.files.length ? '사진 판독 → ' : ''}지식베이스 매칭 → 원인·조치·대책 도출${
      $('#useWeb').checked ? ' → 인터넷 조사' : ''
    }<br><small>AI 사용 시 최대 2~3분이 걸릴 수 있습니다.</small></p></div>`;

  const fd = new FormData();
  fd.append('text', text);
  if (state.procId) fd.append('processId', state.procId);
  fd.append('cues', JSON.stringify([...state.cues]));
  fd.append('useAI', $('#useAI').checked ? 'true' : 'false');
  fd.append('useWeb', $('#useWeb').checked ? 'true' : 'false');
  state.files.forEach((f) => fd.append('images', f));

  try {
    const r = await api('/api/analyze', { method: 'POST', body: fd });
    state.result = r;
    renderResult(r);
    loadStats();
    loadHistory();
  } catch (e) {
    $('#resultBox').innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>
      <h3>분석에 실패했습니다</h3><p>${esc(e.message)}</p></div>`;
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 불량 분석 시작';
  }
}

/* ------------------------------------------------------------------ */
/* 결과 렌더링                                                          */
/* ------------------------------------------------------------------ */

function itemHtml(it, kind, idx) {
  const cat = it.cat ? `<span class="badge ${it.cat}">${CAT_KO[it.cat] || it.cat}</span>` : '';
  const origin = it.origin
    ? `<span class="badge ${/AI|웹/.test(it.origin) ? 'ai' : 'origin'}">${esc(it.origin)}</span>`
    : '';

  let sub = '';
  if (kind === 'cause' && it.rationale) sub = esc(it.rationale);
  if (kind === 'action') {
    const bits = [];
    if (it.when) bits.push(`시점: ${it.when}`);
    if (it.owner) bits.push(`담당: ${it.owner}`);
    sub = esc(bits.join(' · '));
  }
  if (kind === 'measure') {
    const bits = [];
    if (it.type) bits.push(`유형: ${it.type}`);
    if (it.kpi) bits.push(`효과확인 KPI: ${it.kpi}`);
    sub = esc(bits.join(' · '));
  }

  return `<div class="item clickable" data-kind="${kind}" data-idx="${idx}" role="button" tabindex="0">
    <div class="item-no"></div>
    <div class="item-main">
      <div class="item-text">${esc(it.text)}</div>
      ${sub ? `<div class="item-sub">${sub}</div>` : ''}
      <div class="item-meta">${cat}${origin}</div>
    </div>
    <div class="item-more">자세히 ›</div>
  </div>`;
}

function listHtml(arr, kind) {
  if (!arr || !arr.length) return '<p class="note">항목이 없습니다.</p>';
  return `<div class="item-list">${arr.map((i, idx) => itemHtml(i, kind, idx)).join('')}</div>`;
}

function renderResult(r) {
  const d = r.defect;
  const v = r.vision;
  const j = r.judgement || {};
  const name = (d && d.name) || (v && v.defectName) || '미분류 불량';
  const nameEn = (d && d.nameEn) || (v && v.defectNameEn) || '';
  const s = sev(j.severity || (d && d.severity));

  const warn = (r.warnings || []).length
    ? `<div class="warn">⚠ ${r.warnings.map(esc).join('<br>⚠ ')}</div>`
    : '';

  const tags = [
    r.process ? `<span class="tag proc">${r.process.icon} ${esc(r.process.name)}${r.process.guessed ? ' (자동추정)' : ''}</span>` : '',
    `<span class="tag ${s.cls}">심각도 ${s.ko}</span>`,
    `<span class="tag">판정 신뢰도 ${Math.round((j.confidence || 0) * 100)}%</span>`,
    r.usedAI ? '<span class="tag ai">AI 판독</span>' : '',
    r.web ? '<span class="tag ai">인터넷 조사</span>' : '',
    d ? '' : '<span class="tag medium">KB 직접 매칭 실패</span>'
  ].join('');

  const verdict = `
    <div class="verdict sev-${j.color === 'ok' ? 'low' : j.color || s.cls}">
      <div class="v-head">
        <h2>${esc(name)}</h2>
        ${nameEn ? `<span class="v-en">${esc(nameEn)}</span>` : ''}
      </div>
      <p class="v-desc">${esc((d && d.description) || (v && v.observation) || '등록된 불량 항목과 직접 매칭되지 않았습니다. 아래는 해당 공정에서 빈도가 높은 원인·조치·대책입니다.')}</p>
      <div class="v-tags">${tags}</div>
    </div>`;

  const tabs = `
    <div class="tabs" id="resTabs">
      <button class="tab active" data-t="cause">발생 원인 <span class="cnt">${(r.causes || []).length}</span></button>
      <button class="tab" data-t="action">개선 조치 <span class="cnt">${(r.actions || []).length}</span></button>
      <button class="tab" data-t="measure">개선 대책 <span class="cnt">${(r.measures || []).length}</span></button>
      <button class="tab" data-t="judge">공정 판정</button>
      <button class="tab" data-t="ref">근거 · 출처</button>
    </div>`;

  const bodies = `
    <div class="tab-body" data-t="cause" data-print-title="발생 원인 ${(r.causes || []).length}가지">${listHtml(r.causes, 'cause')}</div>
    <div class="tab-body" data-t="action" data-print-title="개선 조치 ${(r.actions || []).length}가지 (즉시 대응)" hidden>${listHtml(r.actions, 'action')}</div>
    <div class="tab-body" data-t="measure" data-print-title="개선 대책 ${(r.measures || []).length}가지 (재발방지)" hidden>${listHtml(r.measures, 'measure')}</div>
    <div class="tab-body" data-t="judge" data-print-title="공정 이상 판정" hidden>${judgeHtml(r, j)}</div>
    <div class="tab-body" data-t="ref" data-print-title="판정 근거 및 출처" hidden>${refHtml(r)}</div>`;

  const actions = `
    <div class="result-actions">
      <button class="btn" onclick="window.print()">🖨 보고서 인쇄 / PDF 저장</button>
      <a class="btn" href="/api/export.csv">⭳ 이력 CSV</a>
      ${r.recordId ? `<span class="tag">관리번호 ${esc(r.recordId)}</span>` : ''}
      <span class="meta">분석 소요 ${((r.elapsedMs || 0) / 1000).toFixed(1)}초${r.web && r.web.model ? ' · ' + esc(r.web.model) : ''}</span>
    </div>`;

  $('#resultBox').innerHTML = warn + verdict + tabs + bodies + actions;

  $$('#resTabs .tab').forEach((b) =>
    b.addEventListener('click', () => {
      $$('#resTabs .tab').forEach((x) => x.classList.toggle('active', x === b));
      $$('#resultBox .tab-body').forEach((x) => (x.hidden = x.dataset.t !== b.dataset.t));
    })
  );

  $$('#resultBox .item.clickable').forEach((el) => {
    const go = () => openItemDetail(el.dataset.kind, Number(el.dataset.idx));
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* 항목 상세정보 (KB·이력 유사 사례 + AI 상세설명 · 5-Why · 유사사례)         */
/* ------------------------------------------------------------------ */

const ITEM_KIND_KO = { cause: '발생 원인', action: '개선 조치', measure: '개선 대책' };

async function openItemDetail(kind, idx) {
  const r = state.result;
  if (!r) return;
  const arr = { cause: r.causes, action: r.actions, measure: r.measures }[kind] || [];
  const it = arr[idx];
  if (!it) return;

  openModal('mdDetail');
  $('#detailTitle').textContent = `${ITEM_KIND_KO[kind] || ''} — ${it.text}`;
  $('#detailBody').innerHTML = '<div class="loading"><div class="spinner"></div><p>상세 정보를 불러오는 중…</p></div>';

  const defectName = (r.defect && r.defect.name) || (r.vision && r.vision.defectName) || '';
  const processName = r.process ? r.process.name : '';

  try {
    const data = await api('/api/item-detail', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: it.text,
        kind,
        rationale: it.rationale || '',
        cat: it.cat,
        when: it.when,
        owner: it.owner,
        type: it.type,
        kpi: it.kpi,
        defectName,
        defectId: r.defect ? r.defect.id : null,
        processId: r.process ? r.process.id : null,
        processName,
        recordId: r.recordId || null,
        useAI: $('#useAI').checked
      })
    });
    renderItemDetail(data);
  } catch (e) {
    $('#detailBody').innerHTML = `<div class="empty"><div class="empty-icon">⚠</div><h3>불러오지 못했습니다</h3><p>${esc(e.message)}</p></div>`;
  }
}

function relatedListHtml(items, kind, labelFn) {
  if (!items || !items.length) return '';
  return `<ul class="related-list">${items.map((x) => `<li>${labelFn(x)}</li>`).join('')}</ul>`;
}

function renderItemDetail(data) {
  const local = data.local || { kb: { inDefects: [], inProcessCommon: [], inUniversal: false }, history: [] };
  const ai = data.ai;

  const kbRelated = local.kb || {};
  const kbParts = [];
  if ((kbRelated.inDefects || []).length) {
    kbParts.push(relatedListHtml(kbRelated.inDefects, 'kb', (d) => `<b>${esc(d.name)}</b> <span class="hint">(${esc(d.processName)})</span> 불량에도 등록되어 있습니다`));
  }
  if ((kbRelated.inProcessCommon || []).length) {
    kbParts.push(relatedListHtml(kbRelated.inProcessCommon, 'kb', (p) => `<b>${esc(p.processName)}</b> 공정 공통 항목에 등록되어 있습니다`));
  }
  if (kbRelated.inUniversal) kbParts.push('<p class="note">전 공정 공통(4M1E) 항목입니다.</p>');
  const kbCard = kbParts.length
    ? `<div class="card"><h4>지식베이스 내 유사 사례</h4>${kbParts.join('')}</div>`
    : '<div class="card"><h4>지식베이스 내 유사 사례</h4><p class="note">동일 문구가 등록된 다른 항목이 없습니다 — 이 불량에 특화된 항목입니다.</p></div>';

  const hist = local.history || [];
  const histCard = hist.length
    ? `<div class="card"><h4>우리 현장 이력 중 동일 항목 사용 사례 ${hist.length}건</h4>
        <ul class="related-list">${hist
          .map((h) => `<li><b>${esc(h.defectName)}</b> <span class="hint">${esc(h.processName || '')} · ${fmtDate(h.at)} · ${esc(h.status)}</span></li>`)
          .join('')}</ul>
      </div>`
    : '<div class="card"><h4>우리 현장 이력</h4><p class="note">과거 이력 중 동일 항목이 사용된 기록이 없습니다.</p></div>';

  let aiCard = '';
  if (ai) {
    const fiveWhys = ai.fiveWhys || [];
    const whyChain = fiveWhys.length
      ? `<div class="card"><h4>5-Why 근본원인 분석</h4>
          <ol class="five-why">${fiveWhys
            .map((w, i) => `<li><div class="why-q">Why ${i + 1}. ${esc(w.why)}</div><div class="why-a">→ ${esc(w.because)}</div></li>`)
            .join('')}</ol>
          ${ai.rootCause ? `<p class="hint" style="margin-top:10px"><b>근본원인:</b> ${esc(ai.rootCause)}</p>` : ''}
        </div>`
      : '';

    aiCard = `
      <div class="card"><h4>상세 설명 ${ai._grounded === false ? '<span class="badge">대체 웹검색</span>' : ''}</h4>
        <p>${esc(ai.detail || '')}</p>
        ${ai.mechanism ? `<p class="hint" style="margin-top:8px"><b>원리:</b> ${esc(ai.mechanism)}</p>` : ''}
      </div>
      ${(ai.howTo || []).length ? `<div class="card"><h4>실행 절차</h4><ol style="margin:0;padding-left:20px">${ai.howTo.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
      ${whyChain}
      ${(ai.pitfalls || []).length ? `<div class="card"><h4>흔한 실수 · 주의사항</h4><ul style="margin:0;padding-left:20px">${ai.pitfalls.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${(ai.similarCases || []).length ? `<div class="card"><h4>유사 산업 사례</h4><div class="candidates">${ai.similarCases.map((c) => `<div class="cand"><b>${esc(c.title)}</b><span>${esc(c.summary)}</span></div>`).join('')}</div></div>` : ''}
      ${(ai.sources || []).length ? `<div class="sources"><h5>참고 출처 ${ai.sources.length}건</h5>${ai.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>`).join('')}</div>` : ''}`;
  } else {
    aiCard = `<div class="card"><h4>AI 상세 설명 · 5-Why · 유사 산업 사례</h4>
      <p class="note">${data.aiError ? esc(data.aiError) : 'AI가 꺼져 있어 제공되지 않습니다. [설정]에서 Gemini API 키를 등록하고 AI 판독을 켜면, 이 항목에 대한 5-Why 근본원인 분석과 실행 절차·유사 사례를 볼 수 있습니다.'}</p>
    </div>`;
  }

  $('#detailBody').innerHTML = kbCard + histCard + aiCard;
}

function judgeHtml(r, j) {
  const rec = j.recurrence || {};
  const mix = j.causeMix || {};
  const total = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
  const mixRows = Object.entries(mix)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => {
      const pct = Math.round((n / total) * 100);
      return `<div class="bar-row"><div class="nm">${CAT_KO[cat] || cat}</div>
        <div class="bar-track"><div class="bar-fill ${cat === 'Machine' || cat === 'Method' ? 'high' : ''}" style="width:${pct}%"></div></div>
        <div class="n">${pct}%</div></div>`;
    })
    .join('');

  return `
    <div class="verdict sev-${j.color === 'ok' ? 'low' : j.color || 'medium'}">
      <div class="v-head"><h2>${esc(j.label || '판정 없음')}</h2><span class="v-en">리스크 점수 ${j.score != null ? j.score : '—'} / 100</span></div>
      <p class="v-desc">${esc(j.guidance || '')}</p>
      <div class="v-tags">
        <span class="tag ${j.processFault ? 'high' : 'proc'}">${j.processFault ? '사내 공정 기인 가능성 높음' : '공정 외부(' + esc(j.faultDomain || '') + ') 기인 가능성'}</span>
        ${j.needsContainment ? '<span class="tag high">로트 격리 필요</span>' : ''}
        ${j.escalate ? '<span class="tag high">상위 보고 대상</span>' : ''}
      </div>
    </div>

    <div class="card">
      <h4>판정 근거</h4>
      ${(j.reasons || []).length ? `<ul style="margin:0;padding-left:18px">${j.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="note">특이 근거 없음</p>'}
    </div>

    <div class="card">
      <h4>추정 원인 4M1E 분포</h4>
      ${mixRows ? `<div class="bars">${mixRows}</div>` : '<p class="note">분류 정보가 없습니다.</p>'}
      ${j.dominantCause ? `<p class="hint" style="margin-top:10px">주요 원인군: <b>${esc(j.dominantCause.label)}</b> (${j.dominantCause.ratio}%) — ${esc(j.dominantCause.hint)}</p>` : ''}
    </div>

    <div class="card">
      <h4>재발 이력</h4>
      <div class="row"><b>최근 ${rec.days || 30}일</b><span>동일 불량 ${rec.count || 0}건${rec.lastAt ? ` (최근 ${fmtDate(rec.lastAt)})` : ''}</span></div>
      <p class="hint">${(rec.count || 0) >= 3 ? '반복 발생 — 산발 불량이 아니라 공정 고질 문제로 다루어야 합니다.' : '반복 발생 기준(30일 3건) 미만입니다.'}</p>
    </div>

    <div class="card">
      <h4>즉시 확인할 공정 파라미터</h4>
      ${(j.checkParams || []).length ? `<div class="kv">${j.checkParams.map((p) => `<span>${esc(p)}</span>`).join('')}</div>
        <p class="hint">각 항목을 표준조건서 설정값과 실측값으로 대조하고, 최근 4M(사람·설비·재료·방법) 변경 이력을 확인하십시오.</p>`
        : '<p class="note">공정이 확정되지 않아 점검 항목을 제시할 수 없습니다.</p>'}
    </div>

    <div class="card">
      <h4>지금 바로 취할 조치 (TOP 3)</h4>
      ${(j.immediate || []).length ? `<ol style="margin:0;padding-left:20px">${j.immediate.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="note">항목 없음</p>'}
    </div>

    ${r.process && r.process.standards ? `<div class="card"><h4>관련 규격 · 평가체계</h4>
      <div class="kv">${r.process.standards.map((x) => `<span>${esc(x)}</span>`).join('')}</div></div>` : ''}`;
}

function refHtml(r) {
  const v = r.vision;
  const cands = r.candidates || [];
  const web = r.web;

  const shots = (r.images || []).length
    ? `<div class="card"><h4>업로드 사진</h4><div class="shots">${r.images
        .map((i) => `<a href="${i.url}" target="_blank"><img src="${i.url}" alt="${esc(i.name)}"></a>`)
        .join('')}</div></div>`
    : '';

  const vision = v
    ? `<div class="card"><h4>AI 사진 판독</h4>
        <div class="row"><b>관찰 사실</b><span>${esc(v.observation || '')}</span></div>
        <div class="row"><b>공정 판단</b><span>${esc(v.processReason || '')}</span></div>
        <div class="row"><b>확신도</b><span>${Math.round((v.confidence || 0) * 100)}%</span></div>
        ${(v.visualCues || []).length ? `<div class="row"><b>관찰 특징</b><span>${v.visualCues.map(esc).join(' · ')}</span></div>` : ''}
        ${(v.checkPoints || []).length ? `<div class="row"><b>추가 확인</b><span>${v.checkPoints.map(esc).join(' / ')}</span></div>` : ''}
        ${(v.candidates || []).length ? `<div class="candidates" style="margin-top:10px">${v.candidates
            .map((c) => `<div class="cand"><b>${esc(c.name)}</b><span>${Math.round((c.confidence || 0) * 100)}% · ${esc(c.reason)}</span></div>`)
            .join('')}</div>` : ''}
      </div>`
    : '';

  const kbCands = cands.length
    ? `<div class="card"><h4>지식베이스 매칭 후보</h4><div class="candidates">${cands
        .map(
          (c) => `<div class="cand"><b>${esc(c.name)}</b><span>${esc(c.processName)} · ${sev(c.severity).ko} · 점수 ${c.score}</span></div>`
        )
        .join('')}</div>
        ${cands[0] && cands[0].reasons ? `<p class="hint">1순위 매칭 근거: ${cands[0].reasons.map(esc).join(', ')}</p>` : ''}</div>`
    : '';

  const guesses = (r.processGuesses || []).length
    ? `<div class="card"><h4>공정 자동 추정</h4><div class="candidates">${r.processGuesses
        .map((g) => `<div class="cand"><b>${esc(g.name)}</b><span>점수 ${g.score}${g.hits ? ' · ' + g.hits.map(esc).join(', ') : ''}</span></div>`)
        .join('')}</div></div>`
    : '';

  const webCard = web
    ? `<div class="card"><h4>인터넷 조사 요약</h4>
        <p>${esc(web.summary || '')}</p>
        ${web.mechanism ? `<p class="hint" style="margin-top:8px"><b>발생 메커니즘:</b> ${esc(web.mechanism)}</p>` : ''}
        ${(web.sources || []).length ? `<div class="sources"><h5>참고 자료 ${web.sources.length}건</h5>${web.sources
            .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>`)
            .join('')}</div>` : ''}
      </div>`
    : `<div class="card"><h4>인터넷 조사</h4><p class="note">${
        r.aiEnabled ? '이번 분석에서는 인터넷 조사를 사용하지 않았습니다.' : 'API 키가 없어 인터넷 조사를 사용할 수 없습니다. [설정]에서 등록하면 최신 기술자료를 종합해 원인·조치·대책에 반영합니다.'
      }</p></div>`;

  const detect = r.defect && r.defect.detect
    ? `<div class="card"><h4>이 불량의 검출 방법</h4><p>${esc(r.defect.detect)}</p></div>`
    : '';

  return shots + vision + kbCands + guesses + detect + webCard;
}

/* ------------------------------------------------------------------ */
/* 뷰 전환                                                              */
/* ------------------------------------------------------------------ */

function showView(v) {
  $$('#viewTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#viewAnalyze').hidden = v !== 'analyze';
  $('#viewDash').hidden = v !== 'dash';
  $('#viewHist').hidden = v !== 'hist';
  $('#viewKb').hidden = v !== 'kb';
  if (v === 'dash') loadStats();
  if (v === 'hist') loadHistory();
}

/* ------------------------------------------------------------------ */
/* 대시보드                                                             */
/* ------------------------------------------------------------------ */

function barList(rows, max, colorFn) {
  if (!rows.length) return '<small>데이터가 없습니다.</small>';
  const top = max || Math.max(...rows.map((r) => r.n), 1);
  return rows
    .map(
      (r) => `<div class="bar-row"><div class="nm" title="${esc(r.name)}">${esc(r.name)}</div>
        <div class="bar-track"><div class="bar-fill ${colorFn ? colorFn(r) : ''}" style="width:${Math.round((r.n / top) * 100)}%"></div></div>
        <div class="n">${r.n}</div></div>`
    )
    .join('');
}

async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('#cntHist').textContent = s.total;

    $('#kpis').innerHTML = `
      <div class="kpi"><b>${s.total}</b><small>누적 분석 건수</small></div>
      <div class="kpi warn"><b>${s.open}</b><small>미완료 (조치중·검증중)</small></div>
      <div class="kpi danger"><b>${s.critical}</b><small>공정 이상 판정</small></div>
      <div class="kpi ok"><b>${s.last7d}</b><small>최근 7일 신규</small></div>`;

    const tr = (s.trend || []).slice(-14);
    const max = Math.max(...tr.map((t) => t.count), 1);
    $('#spark').innerHTML = tr
      .map((t) => `<i style="height:${Math.max(2, Math.round((t.count / max) * 100))}%" title="${t.date}: ${t.count}건"></i>`)
      .join('');
    $('#sparkX').innerHTML = tr.map((t) => `<span>${t.date.slice(8)}</span>`).join('');

    $('#barProc').innerHTML = barList(
      (s.byProcess || []).map((p) => ({ name: p.name, n: p.count, high: p.high })),
      null,
      (r) => (r.high > 0 ? 'high' : '')
    );

    const lv = s.byLevel || {};
    $('#barCat').innerHTML = barList(
      Object.entries(lv).map(([k, n]) => ({ name: LEVEL_KO[k] || k, n })),
      null,
      (r) => (r.name === '공정 이상' ? 'high' : r.name === '이상 의심' ? 'mid' : 'ok')
    );

    $('#barDefect').innerHTML = barList((s.topDefects || []).map((d) => ({ name: d.name, n: d.count })));
  } catch (e) {
    toast('통계를 불러오지 못했습니다: ' + e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 이력                                                                 */
/* ------------------------------------------------------------------ */

async function loadHistory() {
  const q = new URLSearchParams();
  if ($('#fProc').value) q.set('processId', $('#fProc').value);
  if ($('#fSev').value) q.set('severity', $('#fSev').value);
  if ($('#fLevel').value) q.set('level', $('#fLevel').value);
  if ($('#fStatus').value) q.set('status', $('#fStatus').value);
  if ($('#fQ').value.trim()) q.set('q', $('#fQ').value.trim());
  q.set('limit', '100');

  try {
    const res = await api('/api/history?' + q.toString());
    $('#cntHist').textContent = res.total;
    const tb = $('#histBody');
    if (!res.items.length) {
      tb.innerHTML = '<tr><td colspan="9"><small>조건에 맞는 이력이 없습니다.</small></td></tr>';
      return;
    }
    tb.innerHTML = res.items
      .map((r) => {
        const s = sev(r.severity);
        return `<tr data-id="${r.id}">
          <td class="nowrap">${fmtDate(r.at)}<br><small>${esc(r.id)}</small></td>
          <td>${r.thumb ? `<a href="${r.thumb}" target="_blank"><img src="${r.thumb}" alt=""></a>` : ''}</td>
          <td>${esc(r.processName || '-')}</td>
          <td><b>${esc(r.defectName)}</b>${r.aiUsed ? ' <span class="badge ai">AI</span>' : ''}</td>
          <td><span class="tag ${s.cls}">${s.ko}</span></td>
          <td>${r.judgeLevel ? `<span class="tag ${r.judgeLevel === 'critical' ? 'high' : r.judgeLevel === 'warning' ? 'medium' : 'low'}">${LEVEL_KO[r.judgeLevel]}</span>` : '-'}</td>
          <td>${r.judgeScore != null ? r.judgeScore : '-'}</td>
          <td><select class="hStatus" data-id="${r.id}">${['조치중', '검증중', '완료', '보류']
            .map((s2) => `<option${s2 === r.status ? ' selected' : ''}>${s2}</option>`)
            .join('')}</select></td>
          <td><button class="btn small hDel" data-id="${r.id}" style="margin:0;width:auto;padding:4px 9px">삭제</button></td>
        </tr>`;
      })
      .join('');

    $$('.hStatus', tb).forEach((sel) =>
      sel.addEventListener('change', async () => {
        try {
          await api('/api/history/' + sel.dataset.id, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: sel.value })
          });
          toast('상태를 변경했습니다.');
          loadStats();
        } catch (e) {
          toast(e.message, true);
        }
      })
    );

    $$('.hDel', tb).forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('이 이력을 삭제할까요?')) return;
        try {
          await api('/api/history/' + b.dataset.id, { method: 'DELETE' });
          loadHistory();
          loadStats();
        } catch (e) {
          toast(e.message, true);
        }
      })
    );
  } catch (e) {
    toast('이력을 불러오지 못했습니다: ' + e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 지식베이스 목록                                                       */
/* ------------------------------------------------------------------ */

async function renderKbList() {
  const box = $('#kbList');
  box.innerHTML = '<small>불러오는 중…</small>';
  try {
    const details = await Promise.all(state.processes.map((p) => api('/api/process/' + p.id)));
    box.innerHTML = details
      .map(
        (p) => `<details class="kb-proc">
          <summary>${p.icon} ${esc(p.name)} <small>${esc(p.nameEn)} · ${p.defects.length}건</small></summary>
          ${p.defects
            .map(
              (d) => `<div class="kb-def">
                <b>${esc(d.name)} <span class="tag ${sev(d.severity).cls}">${sev(d.severity).ko}</span></b>
                <p>${esc(d.description)}</p>
                <button class="btn small kbGo" data-id="${d.id}" style="width:auto;padding:4px 10px;margin-top:6px">이 불량의 원인·조치·대책 보기</button>
              </div>`
            )
            .join('')}
        </details>`
      )
      .join('');

    $$('.kbGo', box).forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const r = await api('/api/defect/' + b.dataset.id);
          const pseudo = {
            defect: r.defect,
            process: r.process ? { ...r.process, icon: '🔎', guessed: false } : null,
            vision: null,
            web: null,
            warnings: [],
            candidates: [],
            processGuesses: [],
            images: [],
            elapsedMs: 0,
            aiEnabled: state.boot.aiEnabled,
            usedAI: false,
            causes: r.report.causes,
            actions: r.report.actions,
            measures: r.report.measures,
            judgement: {
              label: 'KB 참조 — 실제 발생 판정 아님',
              guidance: '실제 불량 발생 시 [분석]에서 현상·사진을 입력하면 재발 이력까지 반영한 공정 판정을 받을 수 있습니다.',
              color: 'low',
              score: null,
              confidence: 1,
              severity: r.defect.severity,
              causeMix: {},
              recurrence: {},
              reasons: [],
              immediate: r.report.actions.slice(0, 3).map((a) => a.text),
              checkParams: (r.process && r.process.keyParams) || []
            }
          };
          showView('analyze');
          renderResult(pseudo);
        } catch (e) {
          toast(e.message, true);
        }
      })
    );
  } catch (e) {
    box.innerHTML = `<small>불러오지 못했습니다: ${esc(e.message)}</small>`;
  }
}

/* ------------------------------------------------------------------ */
/* 설정                                                                 */
/* ------------------------------------------------------------------ */

function applySettingsToForm() {
  const s = state.settings;
  if (!s) return;
  $('#cfgModel').innerHTML = s.models.map((m) => `<option value="${m.id}"${m.id === s.model ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
  $('#cfgEffort').innerHTML = s.efforts.map((e) => `<option value="${e.id}"${e.id === s.effort ? ' selected' : ''}>${esc(e.name)}</option>`).join('');
  $('#cfgKey').value = '';
  $('#cfgKey').placeholder = s.hasApiKey ? s.apiKeyMasked + (s.keyFromEnv ? '  (환경변수)' : '') : 'AIzaSy...';
  $('#cfgUseAI').checked = s.useAI;
  $('#cfgUseWeb').checked = s.useWeb;
  $('#cfgLine').value = s.line || '';
  $('#cfgInspector').value = s.inspector || '';
  $('#cfgUpdUrl').value = s.updateManifestUrl || '';
  $('#useAI').checked = s.useAI;
  $('#useWeb').checked = s.useWeb;

  $('#fldNotify').hidden = state.role !== 'admin';
  $('#cfgSmtpUser').value = s.smtpUser || '';
  $('#cfgSmtpPass').value = '';
  $('#cfgSmtpPass').placeholder = s.hasSmtp ? s.smtpPassMasked + (s.smtpFromEnv ? '  (환경변수)' : '') : '16자리 앱 비밀번호';
  $('#cfgNotifyEmail').value = s.notifyEmail || '';
}

async function saveSettings() {
  const body = {
    model: $('#cfgModel').value,
    effort: $('#cfgEffort').value,
    useAI: $('#cfgUseAI').checked,
    useWeb: $('#cfgUseWeb').checked,
    line: $('#cfgLine').value,
    inspector: $('#cfgInspector').value,
    updateManifestUrl: $('#cfgUpdUrl').value
  };
  const key = $('#cfgKey').value.trim();
  if (key) body.apiKey = key;

  if (state.role === 'admin') {
    body.smtpUser = $('#cfgSmtpUser').value.trim();
    body.notifyEmail = $('#cfgNotifyEmail').value.trim();
    const smtpPass = $('#cfgSmtpPass').value.trim();
    if (smtpPass) body.smtpPass = smtpPass;
  }

  try {
    const res = await api('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    state.settings = res.settings;
    state.boot.aiEnabled = res.aiEnabled;
    applySettingsToForm();
    setAiChip(res.aiEnabled);
    closeModal('mdSettings');
    toast('설정을 저장했습니다.');
  } catch (e) {
    toast(e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 사용자 관리 (관리자 전용)                                             */
/* ------------------------------------------------------------------ */

const USER_STATUS_KO = { pending: '승인 대기', approved: '승인됨', rejected: '거부됨' };

async function refreshPendingCount() {
  try {
    const { users } = await api('/api/admin/users');
    const n = users.filter((u) => u.status === 'pending').length;
    const badge = $('#cntPending');
    badge.hidden = n === 0;
    badge.textContent = n;
  } catch (e) {
    /* 관리자가 아니면 조용히 무시 */
  }
}

async function loadUsers() {
  const box = $('#usersBody');
  box.innerHTML = '<small>불러오는 중…</small>';
  try {
    const { users } = await api('/api/admin/users');
    renderUsers(users);
  } catch (e) {
    box.innerHTML = `<small>불러오지 못했습니다: ${esc(e.message)}</small>`;
  }
}

function renderUsers(list) {
  const box = $('#usersBody');
  if (!list.length) {
    box.innerHTML = '<p class="note">신청된 계정이 없습니다.</p>';
    return;
  }
  const order = { pending: 0, approved: 1, rejected: 2 };
  const sorted = [...list].sort((a, b) => order[a.status] - order[b.status] || (a.requestedAt < b.requestedAt ? 1 : -1));

  box.innerHTML = `<table class="tbl">
    <thead><tr><th>아이디</th><th>소속·메모</th><th>신청일시</th><th>상태</th><th></th></tr></thead>
    <tbody>${sorted
      .map(
        (u) => `<tr data-id="${esc(u.id)}">
          <td><b>${esc(u.username)}</b></td>
          <td><small>${esc(u.note || '-')}</small></td>
          <td class="nowrap"><small>${fmtDate(u.requestedAt)}</small></td>
          <td><span class="tag ${u.status === 'approved' ? 'proc' : u.status === 'rejected' ? 'high' : 'medium'}">${USER_STATUS_KO[u.status]}</span></td>
          <td class="nowrap">
            ${u.status !== 'approved' ? `<button class="btn small uApprove" style="width:auto;padding:4px 9px;margin:0 4px 0 0">승인</button>` : ''}
            ${u.status !== 'rejected' ? `<button class="btn small uReject" style="width:auto;padding:4px 9px;margin:0 4px 0 0">거부</button>` : ''}
            <button class="btn small uDelete" style="width:auto;padding:4px 9px;margin:0">삭제</button>
          </td>
        </tr>`
      )
      .join('')}</tbody>
  </table>`;

  $$('.uApprove', box).forEach((b) => b.addEventListener('click', (e) => decideUser(e.target.closest('tr').dataset.id, 'approved')));
  $$('.uReject', box).forEach((b) => b.addEventListener('click', (e) => decideUser(e.target.closest('tr').dataset.id, 'rejected')));
  $$('.uDelete', box).forEach((b) =>
    b.addEventListener('click', (e) => {
      if (confirm('이 계정 신청 기록을 삭제할까요?')) deleteUser(e.target.closest('tr').dataset.id);
    })
  );
}

async function decideUser(id, status) {
  try {
    await api(`/api/admin/users/${id}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status })
    });
    toast(status === 'approved' ? '승인했습니다.' : '거부했습니다.');
    loadUsers();
    refreshPendingCount();
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteUser(id) {
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    loadUsers();
    refreshPendingCount();
  } catch (e) {
    toast(e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 활동 이력 (관리자 전용) — 누가 무엇을 조회했는지                        */
/* ------------------------------------------------------------------ */

const ACTIVITY_ACTION_KO = {
  login: '로그인',
  analyze: '불량 분석',
  history_view: '이력 조회',
  item_detail: '상세정보 조회',
  kb_view: '지식베이스 조회'
};

let usersTab = 'signup';

function switchUsersTab(tab) {
  usersTab = tab;
  $$('#usersTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.utab === tab));
  $$('#mdUsers [data-utab-body]').forEach((el) => (el.hidden = el.dataset.utabBody !== tab));
  if (tab === 'signup') loadUsers();
  else loadActivity();
}

async function loadActivity() {
  const box = $('#activityResults');
  box.innerHTML = '<small>불러오는 중…</small>';
  try {
    const q = new URLSearchParams();
    if ($('#fActUser').value) q.set('username', $('#fActUser').value);
    if ($('#fActAction').value) q.set('action', $('#fActAction').value);
    q.set('limit', '200');
    const { items, total } = await api('/api/admin/activity?' + q.toString());
    fillActivityUserFilter(items);
    renderActivity(items, total);
  } catch (e) {
    box.innerHTML = `<small>불러오지 못했습니다: ${esc(e.message)}</small>`;
  }
}

function fillActivityUserFilter(items) {
  const sel = $('#fActUser');
  if (sel.dataset.filled) return;
  const names = [...new Set(items.map((x) => x.username).filter(Boolean))].sort();
  const cur = sel.value;
  sel.innerHTML = '<option value="">전체 사용자</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = cur;
  if (names.length) sel.dataset.filled = '1';
}

function renderActivity(items, total) {
  const box = $('#activityResults');
  if (!items.length) {
    box.innerHTML = '<p class="note">활동 이력이 없습니다.</p>';
    return;
  }
  box.innerHTML = `<p class="note" style="margin-bottom:10px">최근 ${items.length}건 (전체 ${total}건 중)</p>
    <table class="tbl">
      <thead><tr><th>시각</th><th>사용자</th><th>활동</th><th>내용</th></tr></thead>
      <tbody>${items
        .map(
          (x) => `<tr>
            <td class="nowrap"><small>${fmtDate(x.at)}</small></td>
            <td><b>${esc(x.username || '-')}</b>${x.role === 'admin' ? ' <span class="badge">관리자</span>' : ''}</td>
            <td><span class="tag">${esc(ACTIVITY_ACTION_KO[x.action] || x.action)}</span></td>
            <td><small>${esc(x.label || '-')}</small></td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;
}

/* ------------------------------------------------------------------ */
/* 업데이트                                                             */
/* ------------------------------------------------------------------ */

async function loadUpdateStatus(extra) {
  try {
    const s = await api('/api/kb/status');
    $('#updBody').innerHTML = `
      <div class="upd-row"><b>프로그램 버전</b><span>v${esc(s.appVersion)} (Node ${esc(s.nodeVersion)})</span></div>
      <div class="upd-row"><b>지식베이스 버전</b><span>v${esc(s.kbVersion)}</span></div>
      <div class="upd-row"><b>최종 갱신</b><span>${s.updatedAt ? fmtDate(s.updatedAt) : '기본 내장'}</span></div>
      <div class="upd-row"><b>수록 내용</b><span>공정 ${s.counts.processes}종 / 불량 ${s.counts.defects}건</span></div>
      <div class="upd-row"><b>업데이트 서버</b><span>${s.manifestUrl ? esc(s.manifestUrl) : '<i>미설정</i>'}</span></div>
      <div class="upd-row"><b>보관 백업</b><span>${s.backups}개</span></div>
      ${extra || ''}
      ${!s.manifestUrl ? '<p class="note" style="margin-top:12px">업데이트 서버가 설정되지 않았습니다. [설정]에서 매니페스트 URL을 등록하면 인터넷을 통해 지식베이스를 자동으로 갱신할 수 있습니다.</p>' : ''}`;
  } catch (e) {
    $('#updBody').innerHTML = `<p class="note">${esc(e.message)}</p>`;
  }
}

async function checkUpdate() {
  $('#updBody').innerHTML = '<div class="loading"><div class="spinner"></div><p>업데이트 서버 확인 중…</p></div>';
  try {
    const r = await api('/api/kb/check', { method: 'POST' });
    const box = r.updateAvailable
      ? `<p class="note" style="margin-top:12px;background:#e7f1ea;color:#16785a">
          ✅ 새 버전 v${esc(r.latestVersion)} 이 있습니다 (현재 v${esc(r.currentVersion)}) · 파일 ${r.fileCount}개<br>${esc(r.notes || '')}
         </p>`
      : `<p class="note" style="margin-top:12px">최신 버전을 사용 중입니다 (v${esc(r.currentVersion)}).</p>`;
    $('#btnUpdApply').disabled = !r.updateAvailable;
    await loadUpdateStatus(box);
  } catch (e) {
    await loadUpdateStatus(`<p class="note" style="margin-top:12px;background:#fdeceb;color:#c8322c">${esc(e.message)}</p>`);
  }
}

async function applyUpdate() {
  if (!confirm('지식베이스를 업데이트할까요? 기존 파일은 자동으로 백업됩니다.')) return;
  $('#updBody').innerHTML = '<div class="loading"><div class="spinner"></div><p>내려받아 검증하는 중…</p></div>';
  try {
    const r = await api('/api/kb/apply', { method: 'POST' });
    toast(`업데이트 완료: v${r.fromVersion} → v${r.toVersion}`);
    $('#btnUpdApply').disabled = true;
    const boot = await api('/api/bootstrap');
    state.boot = boot;
    state.processes = boot.processes;
    $('#chipKb').textContent = `KB v${boot.kb.version.kbVersion} · 불량 ${boot.kb.counts.defects}건`;
    renderProcGrid();
    fillProcFilter();
    renderKbList();
    await loadUpdateStatus(`<p class="note" style="margin-top:12px;background:#e7f1ea;color:#16785a">갱신 파일 ${r.files.length}개 · 백업 ${esc(r.backupId)}</p>`);
  } catch (e) {
    await loadUpdateStatus(`<p class="note" style="margin-top:12px;background:#fdeceb;color:#c8322c">${esc(e.message)}</p>`);
    toast(e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 모달 · 이벤트                                                        */
/* ------------------------------------------------------------------ */

const openModal = (id) => ($(`#${id}`).hidden = false);
const closeModal = (id) => ($(`#${id}`).hidden = true);

function bindStaticEvents() {
  $('#btnAnalyze').addEventListener('click', analyze);
  $('#btnClearProc').addEventListener('click', () => {
    state.procId = null;
    state.cues.clear();
    $$('#procGrid .proc').forEach((x) => x.classList.remove('on'));
    loadCues();
  });

  const dz = $('#dropzone');
  const fi = $('#fileInput');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fi.click();
    }
  });
  fi.addEventListener('change', () => {
    addFiles(fi.files);
    fi.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('over');
    })
  );
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $$('#viewTabs .tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  $('#btnRefreshDash').addEventListener('click', loadStats);
  $('#btnHistSearch').addEventListener('click', loadHistory);
  $('#fQ').addEventListener('keydown', (e) => e.key === 'Enter' && loadHistory());
  ['#fProc', '#fSev', '#fLevel', '#fStatus'].forEach((s) => $(s).addEventListener('change', loadHistory));

  $('#btnSettings').addEventListener('click', () => openModal('mdSettings'));
  $('#btnSaveCfg').addEventListener('click', saveSettings);
  $('#btnUpdate').addEventListener('click', () => {
    openModal('mdUpdate');
    loadUpdateStatus();
  });
  $('#btnUpdCheck').addEventListener('click', checkUpdate);
  $('#btnUpdApply').addEventListener('click', applyUpdate);
  $('#btnUsers').addEventListener('click', () => {
    openModal('mdUsers');
    switchUsersTab('signup');
  });
  $$('#usersTabs .tab').forEach((b) => b.addEventListener('click', () => switchUsersTab(b.dataset.utab)));
  $('#btnActFilter').addEventListener('click', loadActivity);
  $('#btnUsersRefresh').addEventListener('click', () => (usersTab === 'signup' ? loadUsers() : loadActivity()));
  $('#btnLogout').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } finally {
      location.href = '/login.html';
    }
  });

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
  $$('.modal').forEach((m) =>
    m.addEventListener('click', (e) => {
      if (e.target === m) m.hidden = true;
    })
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal').forEach((m) => (m.hidden = true));
  });
}

init();
