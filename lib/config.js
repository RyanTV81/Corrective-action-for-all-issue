'use strict';
/**
 * 설정 관리 (data/config.json)
 * API 키는 설정 파일 또는 환경변수 GEMINI_API_KEY(또는 GOOGLE_API_KEY) 에서 읽는다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  apiKey: '',
  apiKeysExtra: [], // 선택: 추가 무료 키 목록(개수 제한 없음) — 등록된 키 전체를 라운드로빈으로 분산 사용해 무료 한도(RPM)를 늘린다
  model: 'gemini-3.6-flash',
  effort: 'high', // low | medium | high | xhigh | max
  useAI: true,
  useWeb: true,
  updateManifestUrl: 'https://gist.githubusercontent.com/RyanTV81/78f59350149ffc542b4c9b3e4b297c5e/raw/manifest.json',
  company: '',
  line: '',
  inspector: '',
  smtpUser: '', // 알림 메일 발신 Gmail 계정
  smtpPass: '', // Gmail 앱 비밀번호
  notifyEmail: 'c-junsang@hanmail.net' // 가입 승인요청 수신 이메일
};

const MODELS = [
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash — 최고 정확도' },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash — 빠르고 무료 한도 넉넉 (권장)' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite — 초고속' }
];

const EFFORTS = [
  { id: 'low', name: 'low — 가장 빠름' },
  { id: 'medium', name: 'medium — 균형' },
  { id: 'high', name: 'high — 기본값' },
  { id: 'xhigh', name: 'xhigh — 정밀 분석' },
  { id: 'max', name: 'max — 최대 추론' }
];

const EFFORT_IDS = EFFORTS.map((e) => e.id);

let cache = null;

/** 화면 표시용 마스킹: 앞 8자 + 점 10개 + 뒤 4자 */
function maskKey(k) {
  return k ? `${k.slice(0, 8)}${'•'.repeat(10)}${k.slice(-4)}` : '';
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readFileSafe() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const t = fs.readFileSync(FILE, 'utf8').trim();
    return t ? JSON.parse(t) : {};
  } catch (e) {
    console.error('[config] 읽기 실패:', e.message);
    return {};
  }
}

function get() {
  if (cache) return cache;
  const saved = readFileSafe();
  cache = { ...DEFAULTS, ...saved };
  if (!Array.isArray(cache.apiKeysExtra)) cache.apiKeysExtra = [];
  // 예전 버전(고정된 "키 2" 필드 1개)에서 저장된 값을 새 목록으로 이관
  if (typeof cache.apiKey2 === 'string' && cache.apiKey2 && !cache.apiKeysExtra.includes(cache.apiKey2)) {
    cache.apiKeysExtra = [...cache.apiKeysExtra, cache.apiKey2];
  }
  delete cache.apiKey2;
  cache._keyFromEnv = false;
  const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!cache.apiKey && envKey) {
    cache.apiKey = envKey.trim();
    cache._keyFromEnv = true;
  }
  cache._smtpFromEnv = false;
  if (!cache.smtpUser && process.env.SMTP_USER) {
    cache.smtpUser = process.env.SMTP_USER.trim();
    cache.smtpPass = (process.env.SMTP_PASS || '').trim();
    cache._smtpFromEnv = true;
  }
  if (!cache.notifyEmail && process.env.NOTIFY_EMAIL) cache.notifyEmail = process.env.NOTIFY_EMAIL.trim();
  if (!EFFORT_IDS.includes(cache.effort)) cache.effort = 'high';
  if (!MODELS.some((m) => m.id === cache.model)) cache.model = DEFAULTS.model;
  if (!cache.updateManifestUrl) cache.updateManifestUrl = DEFAULTS.updateManifestUrl;
  return cache;
}

/**
 * 설정 저장.
 * 비용·보안에 직결되는 항목(API 키, 모델, 분석 심도, 업데이트 주소, 메일 계정)은 관리자만 바꿀 수 있다.
 * 일반 사용자는 현장 정보(라인·담당자·회사)와 기본 동작 토글만 변경할 수 있다.
 * @param {object} opt {isAdmin}
 */
function save(patch, opt = {}) {
  const cur = get();
  const next = { ...cur };
  delete next._keyFromEnv;
  delete next._smtpFromEnv;

  for (const k of ['company', 'line', 'inspector']) {
    if (typeof patch[k] === 'string') next[k] = patch[k].trim().slice(0, 100);
  }
  for (const k of ['useAI', 'useWeb']) {
    if (typeof patch[k] === 'boolean') next[k] = patch[k];
  }

  if (opt.isAdmin) {
    if (typeof patch.model === 'string') next.model = patch.model.trim();
    if (typeof patch.updateManifestUrl === 'string') next.updateManifestUrl = patch.updateManifestUrl.trim();
    if (typeof patch.effort === 'string' && EFFORT_IDS.includes(patch.effort)) next.effort = patch.effort;
    if (typeof patch.apiKey === 'string') {
      const v = patch.apiKey.trim();
      if (!v.includes('•')) next.apiKey = v; // 마스킹된 값이 되돌아온 경우 무시
    }
    if (Array.isArray(patch.apiKeysExtra)) {
      // 화면은 기존 키를 마스킹된 값(점 포함)으로 보여준다 — 그 줄이 그대로 돌아오면 원래 키로 복원하고,
      // 점이 없는 새 문자열이면 새로 추가된 키로 저장한다. 목록에서 지워진 줄은 그대로 사라진다.
      const seen = new Set();
      const resolved = [];
      for (const raw of patch.apiKeysExtra) {
        if (typeof raw !== 'string') continue;
        const v = raw.trim();
        if (!v) continue;
        const key = v.includes('•') ? cur.apiKeysExtra.find((k) => maskKey(k) === v) : v;
        if (key && !seen.has(key)) {
          seen.add(key);
          resolved.push(key);
        }
      }
      next.apiKeysExtra = resolved;
    }
  }
  if (!MODELS.some((m) => m.id === next.model)) next.model = DEFAULTS.model;

  // 승인요청 알림 메일 설정 — 관리자만 변경 가능(호출부에서 opt.isAdmin 로 통제)
  if (opt.isAdmin) {
    if (typeof patch.smtpUser === 'string') next.smtpUser = patch.smtpUser.trim();
    if (typeof patch.smtpPass === 'string') {
      const v = patch.smtpPass.trim();
      if (!v.includes('•')) next.smtpPass = v; // 마스킹된 값이 되돌아온 경우 무시
    }
    if (typeof patch.notifyEmail === 'string') next.notifyEmail = patch.notifyEmail.trim();
  }

  // 환경변수에서 온 키는 파일에 저장하지 않는다
  const toWrite = { ...next };
  if (cur._keyFromEnv && next.apiKey === cur.apiKey) toWrite.apiKey = '';
  if (cur._smtpFromEnv && next.smtpUser === cur.smtpUser) {
    toWrite.smtpUser = '';
    toWrite.smtpPass = '';
  }

  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(toWrite, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);

  cache = null;
  return get();
}

/**
 * 화면 노출용 상태.
 * API 키·앱 비밀번호는 항상 마스킹하고, 관리자에게만 의미 있는 값(키 일부·메일 계정·업데이트 주소)은
 * 일반 사용자 응답에서 아예 빼버린다 — 화면에 안 그린다고 끝이 아니라 서버가 보내지 않아야 한다.
 * @param {object} opt {isAdmin}
 */
function status(opt = {}) {
  const c = get();
  const base = {
    hasApiKey: Boolean(c.apiKey),
    model: c.model,
    effort: c.effort,
    useAI: c.useAI,
    useWeb: c.useWeb,
    company: c.company,
    line: c.line,
    inspector: c.inspector,
    isAdmin: Boolean(opt.isAdmin),
    models: MODELS,
    efforts: EFFORTS
  };
  if (!opt.isAdmin) return base;

  return {
    ...base,
    apiKeyMasked: maskKey(c.apiKey),
    keyFromEnv: Boolean(c._keyFromEnv),
    apiKeysExtra: c.apiKeysExtra.map(maskKey),
    totalKeyCount: (c.apiKey ? 1 : 0) + c.apiKeysExtra.length,
    updateManifestUrl: c.updateManifestUrl,
    hasSmtp: Boolean(c.smtpUser && c.smtpPass),
    smtpUser: c.smtpUser || '',
    smtpPassMasked: c.smtpPass ? '•'.repeat(12) : '',
    smtpFromEnv: Boolean(c._smtpFromEnv),
    notifyEmail: c.notifyEmail || c.smtpUser || ''
  };
}

module.exports = {
  get,
  save,
  status,
  // 별칭 (호출부 호환)
  set: save,
  publicView: status,
  DEFAULTS,
  MODELS,
  EFFORTS,
  FILE
};
