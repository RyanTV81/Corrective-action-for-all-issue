'use strict';
/**
 * 지식베이스(KB) 온라인 업데이트 — "펌웨어 업데이트"
 *
 * 매니페스트(JSON)를 인터넷에서 받아 로컬 KB 버전과 비교하고,
 * 새 버전이면 파일을 내려받아 SHA-256 검증 후 교체한다. 교체 전 자동 백업하며 롤백할 수 있다.
 *
 * 매니페스트 형식:
 * {
 *   "kbVersion": "1.1.0",
 *   "releasedAt": "2026-09-01T00:00:00Z",
 *   "notes": "용접 불량 12건 추가",
 *   "minAppVersion": "1.0.0",
 *   "files": [
 *     { "path": "defects/group4.json", "url": "https://.../group4.json", "sha256": "…", "bytes": 12345 }
 *   ]
 * }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const kb = require('./kb');
const config = require('./config');
const security = require('./security');

const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');
const APP_VERSION = require('../package.json').version;
const TIMEOUT_MS = 20000;
const MAX_BYTES = 20 * 1024 * 1024; // 파일당 20MB 상한

/* ------------------------------------------------------------------ */

function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 매니페스트의 path 가 kb/ 밖으로 나가지 못하게 검증 */
function safeKbPath(rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('파일 경로가 비어 있습니다');
  if (path.isAbsolute(rel)) throw new Error(`절대 경로는 허용되지 않습니다: ${rel}`);
  const abs = path.resolve(kb.KB_DIR, rel);
  const root = path.resolve(kb.KB_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`kb 폴더를 벗어나는 경로입니다: ${rel}`);
  }
  if (!abs.toLowerCase().endsWith('.json')) throw new Error(`.json 파일만 허용됩니다: ${rel}`);
  return abs;
}

/**
 * 업데이트 파일 내려받기.
 * - https 공인 주소만 허용하고 사설망·메타데이터 주소는 거부한다(SSRF 방어, lib/security.js)
 * - 리다이렉트를 따라가면 검증을 우회할 수 있으므로 따라가지 않는다
 * - 응답 크기를 미리 확인하고, 실제로 받으면서도 상한을 넘으면 중단한다
 */
async function fetchWithLimit(url, asText) {
  let target = await security.assertPublicHttpsUrl(url);
  let res;

  // 리다이렉트를 자동으로 따라가면 검증을 통과한 주소가 사설망으로 넘어갈 수 있다.
  // 직접 한 단계씩 따라가면서 매번 다시 검증한다 (최대 3회).
  for (let hop = 0; ; hop++) {
    res = await fetch(target, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': `find-corrective-action/${APP_VERSION}`, accept: 'application/json, text/plain' },
      redirect: 'manual'
    });
    if (res.status < 300 || res.status >= 400) break;

    const loc = res.headers.get('location');
    if (!loc) break;
    if (hop >= 3) throw new Error(`주소 전달(리다이렉트)이 너무 많습니다: ${url}`);
    target = await security.assertPublicHttpsUrl(new URL(loc, target).href);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${target}`);

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error(`파일이 너무 큽니다(${declared} bytes): ${target}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`파일이 너무 큽니다(${buf.length} bytes): ${target}`);
  return asText ? buf.toString('utf8') : buf;
}

/* ------------------------------------------------------------------ */
/* 상태 / 확인                                                          */
/* ------------------------------------------------------------------ */

function currentStatus() {
  const data = kb.load();
  return {
    appVersion: APP_VERSION,
    nodeVersion: process.version,
    kbVersion: data.version.kbVersion,
    updatedAt: data.version.updatedAt,
    source: data.version.source,
    counts: data.counts,
    manifestUrl: config.get().updateManifestUrl || '',
    backups: listBackups().length
  };
}

async function check() {
  const url = (config.get().updateManifestUrl || '').trim();
  if (!url) {
    const e = new Error('업데이트 서버 주소가 설정되지 않았습니다. [설정]에서 매니페스트 URL을 등록하세요.');
    e.code = 'NO_MANIFEST_URL';
    throw e;
  }

  const manifest = JSON.parse(await fetchWithLimit(url, true));
  if (!manifest.kbVersion || !Array.isArray(manifest.files)) {
    throw new Error('매니페스트 형식이 올바르지 않습니다 (kbVersion / files 필요)');
  }
  manifest.files.forEach((f) => safeKbPath(f.path)); // 사전 검증

  const cur = kb.readVersion().kbVersion;
  const diff = cmpVersion(manifest.kbVersion, cur);

  if (manifest.minAppVersion && cmpVersion(APP_VERSION, manifest.minAppVersion) < 0) {
    throw new Error(
      `이 업데이트는 앱 ${manifest.minAppVersion} 이상이 필요합니다 (현재 ${APP_VERSION})`
    );
  }

  return {
    currentVersion: cur,
    latestVersion: manifest.kbVersion,
    updateAvailable: diff > 0,
    releasedAt: manifest.releasedAt || null,
    notes: manifest.notes || '',
    fileCount: manifest.files.length,
    files: manifest.files.map((f) => ({ path: f.path, bytes: f.bytes || null })),
    manifest
  };
}

/* ------------------------------------------------------------------ */
/* 백업 / 적용 / 롤백                                                    */
/* ------------------------------------------------------------------ */

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const p = path.join(BACKUP_DIR, d.name);
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(path.join(p, '_backup.json'), 'utf8'));
      } catch (e) {
        /* 메타 없음 */
      }
      return { id: d.name, path: p, ...meta };
    })
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function backup(reason) {
  const v = kb.readVersion().kbVersion;
  const id = `kb-${v}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const dst = path.join(BACKUP_DIR, id);
  copyDir(kb.KB_DIR, dst);
  fs.writeFileSync(
    path.join(dst, '_backup.json'),
    JSON.stringify({ id, kbVersion: v, reason: reason || '', createdAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  return { id, path: dst, kbVersion: v };
}

async function apply() {
  const info = await check();
  if (!info.updateAvailable) {
    return { applied: false, reason: '이미 최신 버전입니다', ...info };
  }

  /* 1) 전부 내려받고 검증 (하나라도 실패하면 아무것도 쓰지 않음) */
  const staged = [];
  for (const f of info.manifest.files) {
    const abs = safeKbPath(f.path);
    const buf = await fetchWithLimit(f.url, false);

    if (f.sha256) {
      const got = sha256(buf);
      if (got.toLowerCase() !== String(f.sha256).toLowerCase()) {
        throw new Error(`체크섬 불일치: ${f.path}\n  기대 ${f.sha256}\n  실제 ${got}`);
      }
    }
    // JSON 파싱 가능 여부까지 확인
    try {
      JSON.parse(buf.toString('utf8'));
    } catch (e) {
      throw new Error(`JSON 파싱 실패: ${f.path} — ${e.message}`);
    }
    staged.push({ abs, buf, rel: f.path });
  }

  /* 2) 백업 후 일괄 반영 */
  const bk = backup(`업데이트 ${info.currentVersion} → ${info.latestVersion}`);
  const written = [];
  try {
    for (const s of staged) {
      fs.mkdirSync(path.dirname(s.abs), { recursive: true });
      fs.writeFileSync(s.abs, s.buf);
      written.push(s.rel);
    }
    kb.writeVersion({
      kbVersion: info.latestVersion,
      updatedAt: new Date().toISOString(),
      source: config.get().updateManifestUrl,
      channel: 'online',
      notes: info.notes
    });
  } catch (e) {
    restore(bk.id); // 쓰기 도중 실패 시 즉시 복구
    throw new Error(`적용 실패로 롤백했습니다: ${e.message}`);
  }

  const reloaded = kb.reload();
  return {
    applied: true,
    fromVersion: info.currentVersion,
    toVersion: info.latestVersion,
    notes: info.notes,
    files: written,
    backupId: bk.id,
    counts: reloaded.counts
  };
}

function restore(backupId) {
  const bk = listBackups().find((b) => b.id === backupId);
  if (!bk) throw new Error(`백업을 찾을 수 없습니다: ${backupId}`);

  for (const e of fs.readdirSync(bk.path, { withFileTypes: true })) {
    if (e.name === '_backup.json') continue;
    const s = path.join(bk.path, e.name);
    const d = path.join(kb.KB_DIR, e.name);
    if (e.isDirectory()) {
      fs.rmSync(d, { recursive: true, force: true });
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
  const reloaded = kb.reload();
  return { restored: true, backupId, kbVersion: reloaded.version.kbVersion, counts: reloaded.counts };
}

module.exports = { check, apply, restore, backup, listBackups, currentStatus, cmpVersion, APP_VERSION };
