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

function save(patch, opt = {}) {
  const cur = get();
  const next = { ...cur };
  delete next._keyFromEnv;
  delete next._smtpFromEnv;

  for (const k of ['model', 'updateManifestUrl', 'company', 'line', 'inspector']) {
    if (typeof patch[k] === 'string') next[k] = patch[k].trim();
  }
  for (const k of ['useAI', 'useWeb']) {
    if (typeof patch[k] === 'boolean') next[k] = patch[k];
  }
  if (typeof patch.effort === 'string' && EFFORT_IDS.includes(patch.effort)) next.effort = patch.effort;
  if (typeof patch.apiKey === 'string') {
    const v = patch.apiKey.trim();
    if (!v.includes('•')) next.apiKey = v; // 마스킹된 값이 되돌아온 경우 무시
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

/** 화면 노출용 상태 (API 키·앱 비밀번호는 마스킹) */
function status() {
  const c = get();
  return {
    hasApiKey: Boolean(c.apiKey),
    apiKeyMasked: c.apiKey ? `${c.apiKey.slice(0, 8)}${'•'.repeat(10)}${c.apiKey.slice(-4)}` : '',
    keyFromEnv: Boolean(c._keyFromEnv),
    model: c.model,
    effort: c.effort,
    useAI: c.useAI,
    useWeb: c.useWeb,
    updateManifestUrl: c.updateManifestUrl,
    company: c.company,
    line: c.line,
    inspector: c.inspector,
    hasSmtp: Boolean(c.smtpUser && c.smtpPass),
    smtpUser: c.smtpUser || '',
    smtpPassMasked: c.smtpPass ? '•'.repeat(12) : '',
    smtpFromEnv: Boolean(c._smtpFromEnv),
    notifyEmail: c.notifyEmail || c.smtpUser || '',
    models: MODELS,
    efforts: EFFORTS
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
