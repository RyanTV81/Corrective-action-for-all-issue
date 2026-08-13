'use strict';
/**
 * 공통 보안 장치 — 보안 헤더 · CSRF(Origin) 검사 · 요청 횟수 제한 · URL 검증
 *
 * 이 파일 하나만 봐도 "어떤 공격을 무엇으로 막고 있는지" 알 수 있도록 모아두었다.
 */
const dns = require('dns').promises;
const net = require('net');

/* ------------------------------------------------------------------ */
/* 1) 보안 헤더                                                          */
/* ------------------------------------------------------------------ */

/**
 * CSP: 스크립트는 우리 서버(self)에서 온 .js 파일만 실행한다.
 * 혹시 화면 어딘가에 XSS 구멍이 남아 있어도 <script>alert()</script> 같은 인라인 코드가 실행되지 않는다.
 * (style 은 화면 코드가 style="..." 속성을 많이 쓰므로 unsafe-inline 을 허용 — 스크립트가 아니라 위험도가 낮다)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'", // 다른 사이트가 iframe 으로 감싸 클릭재킹하는 것을 차단
  "base-uri 'none'",
  "object-src 'none'"
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff'); // 업로드 파일을 브라우저가 HTML 로 넘겨짚지 못하게
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // HTTPS 로 접속한 경우에만 HSTS — 이후 1년간 이 도메인은 항상 HTTPS 로만 접속하게 강제한다
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // 로그인 상태에서 본 내용이 중간 캐시에 남지 않도록
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

/* ------------------------------------------------------------------ */
/* 2) CSRF — 다른 사이트에서 몰래 보내는 요청 차단                          */
/* ------------------------------------------------------------------ */

/**
 * 세션 쿠키가 SameSite=Lax 라 대부분 막히지만, 한 겹 더 확인한다.
 * 브라우저는 POST/DELETE 요청에 Origin 헤더를 반드시 붙이므로, 그 값이 우리 주소와 다르면 거부한다.
 * (curl 등 브라우저가 아닌 도구는 Origin 이 없으므로 그대로 통과 — 서버 간 연동을 막지 않는다)
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameOriginOnly(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin || origin === 'null') return next();

  let host;
  try {
    host = new URL(origin).host;
  } catch (e) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다', code: 'BAD_ORIGIN' });
  }
  if (host !== req.headers.host) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다', code: 'BAD_ORIGIN' });
  }
  next();
}

/* ------------------------------------------------------------------ */
/* 3) 요청 횟수 제한                                                     */
/* ------------------------------------------------------------------ */

const buckets = new Map(); // key -> { count, resetAt }

// 오래된 항목을 주기적으로 비워 메모리가 계속 늘지 않게 한다
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
}, 10 * 60 * 1000).unref();

/** @returns {boolean} true 면 한도 초과 */
function hit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count++;
  return b.count > max;
}

function reset(key) {
  buckets.delete(key);
}

/**
 * 로그인한 사용자 기준으로 요청 수를 제한하는 미들웨어를 만든다.
 * (IP 는 공유·위조될 수 있으므로 계정 기준이 더 정확하다)
 */
function rateLimit({ name, max, windowMs, message }) {
  return (req, res, next) => {
    const who = req.authUser || req.ip;
    if (hit(`${name}:${who}`, max, windowMs)) {
      const min = Math.ceil(windowMs / 60000);
      return res.status(429).json({
        error: message || `요청이 너무 많습니다. ${min}분 후 다시 시도하세요.`,
        code: 'RATE_LIMIT'
      });
    }
    next();
  };
}

/* ------------------------------------------------------------------ */
/* 4) URL 검증 (SSRF 방어)                                               */
/* ------------------------------------------------------------------ */

/** 사설망·루프백·클라우드 메타데이터 등 "인터넷 바깥" 주소인지 */
function isPrivateAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // 링크로컬 — GCP/AWS 메타데이터 서버(169.254.169.254)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4 매핑 주소
    if (m) return isPrivateAddress(m[1]);
    return false;
  }
  return true; // 해석할 수 없는 값은 안전하게 거부
}

/**
 * 외부에서 내려받을 URL이 안전한지 확인한다.
 * https 만 허용하고, 서버 내부망(사설 IP)을 향하는 주소는 거부한다 —
 * 이렇게 하지 않으면 이 서버를 발판 삼아 내부 시스템을 훑는 SSRF 공격에 쓰일 수 있다.
 */
async function assertPublicHttpsUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch (e) {
    throw Object.assign(new Error('올바른 주소(URL)가 아닙니다'), { status: 400 });
  }
  if (u.protocol !== 'https:') {
    throw Object.assign(new Error('https:// 주소만 사용할 수 있습니다'), { status: 400 });
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  if (net.isIP(host)) {
    addrs = [{ address: host }];
  } else {
    try {
      addrs = await dns.lookup(host, { all: true });
    } catch (e) {
      throw Object.assign(new Error(`주소를 찾을 수 없습니다: ${host}`), { status: 400 });
    }
  }
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw Object.assign(new Error('내부망(사설 IP) 주소는 사용할 수 없습니다'), { status: 400 });
  }
  return u.href;
}

/* ------------------------------------------------------------------ */
/* 5) 업로드 URL 검증                                                    */
/* ------------------------------------------------------------------ */

/** 서버가 만든 업로드 경로(/uploads/파일명.jpg) 형식만 통과 — 그 외 문자열은 버린다 */
const UPLOAD_URL_RE = /^\/uploads\/[A-Za-z0-9._-]{1,80}\.(jpg|jpeg|png|gif|webp)$/;

function isUploadUrl(u) {
  return typeof u === 'string' && UPLOAD_URL_RE.test(u);
}

module.exports = {
  securityHeaders,
  sameOriginOnly,
  rateLimit,
  hit,
  reset,
  assertPublicHttpsUrl,
  isPrivateAddress,
  isUploadUrl,
  CSP
};
