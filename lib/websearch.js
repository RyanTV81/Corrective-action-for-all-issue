'use strict';
/**
 * 무키(無 API Key) 웹 검색 폴백
 * DuckDuckGo HTML 엔드포인트에서 참고 자료 링크만 수집한다.
 * (LLM이 없으므로 본문 종합은 하지 않고 링크·요약문만 제공)
 */

const ENDPOINTS = ['https://html.duckduckgo.com/html/?q=', 'https://lite.duckduckgo.com/lite/?q='];

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function unwrapUrl(href) {
  try {
    if (href.startsWith('//')) href = 'https:' + href;
    const u = new URL(href, 'https://duckduckgo.com');
    const inner = u.searchParams.get('uddg');
    if (inner) return decodeURIComponent(inner);
    return u.href;
  } catch (e) {
    return href;
  }
}

async function fetchHtml(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8'
      },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function parseResults(html, limit) {
  const out = [];
  const seen = new Set();

  // html.duckduckgo.com 형식
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const url = unwrapUrl(decodeEntities(m[1]));
    if (seen.has(url) || /duckduckgo\.com/.test(url)) continue;
    seen.add(url);
    out.push({ url, title: stripTags(m[2]), snippet: '' });
  }

  // 스니펫 매칭
  const sre = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let i = 0;
  let sm;
  while ((sm = sre.exec(html)) && i < out.length) {
    out[i].snippet = stripTags(sm[1]).slice(0, 260);
    i++;
  }

  // lite 형식 폴백
  if (!out.length) {
    const lre = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = lre.exec(html)) && out.length < limit) {
      const url = unwrapUrl(decodeEntities(m[1]));
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title: stripTags(m[2]), snippet: '' });
    }
  }

  return out;
}

/**
 * @param {string[]} queries 여러 검색어
 * @param {number} perQuery 검색어당 수집 링크 수
 */
async function search(queries, perQuery) {
  const limit = perQuery || 6;
  const all = [];
  const seen = new Set();
  const errors = [];

  for (const q of queries) {
    let got = false;
    for (const ep of ENDPOINTS) {
      try {
        const html = await fetchHtml(ep + encodeURIComponent(q), 20000);
        const res = parseResults(html, limit);
        for (const r of res) {
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          all.push({ ...r, query: q });
        }
        if (res.length) {
          got = true;
          break;
        }
      } catch (e) {
        errors.push(`${q}: ${e.message}`);
      }
    }
    if (!got && !errors.some((e) => e.startsWith(q))) errors.push(`${q}: 결과 없음`);
  }

  return { results: all, errors };
}

module.exports = { search };
