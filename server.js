'use strict';
/**
 * 품질관리 불량분석 대시보드 서버
 *   node server.js        → http://localhost:3000
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const kb = require('./lib/kb');
const ai = require('./lib/ai');
const analyzer = require('./lib/analyze');
const updater = require('./lib/update');
const config = require('./lib/config');
const { judge } = require('./lib/judge');
const store = require('./lib/store');
const auth = require('./lib/auth');
const users = require('./lib/users');
const activity = require('./lib/activity');
const feedback = require('./lib/feedback');
const security = require('./lib/security');

const PORT = Number(process.env.PORT) || 3000;
// 기본값은 루프백 — 외부에서는 반드시 Caddy(HTTPS)를 거치게 해서, 프록시를 우회한 직접 접속으로
// X-Forwarded-For 를 위조(=요청 제한 우회·접속 IP 조작)하는 것을 막는다.
const HOST = process.env.HOST || '127.0.0.1';
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by'); // 서버 종류·버전 노출 제거
app.set('trust proxy', 1); // 리버스 프록시(Caddy 등) 뒤에서 실제 클라이언트 IP·프로토콜을 신뢰
app.use(security.securityHeaders);
app.use(security.sameOriginOnly); // 다른 사이트에서 몰래 보내는 요청(CSRF) 차단
app.use(express.json({ limit: '1mb' }));

/* 로그인 · 사용 신청 (인증 미들웨어보다 먼저 등록해 예외 처리) */
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.post('/api/signup', auth.signup);
for (const f of ['login.html', 'login.js', 'login.css']) {
  app.get('/' + f, (req, res) => res.sendFile(path.join(__dirname, 'public', f)));
}

app.use(auth.requireAuth);

app.get('/api/me', auth.me);

/* 사용자 승인 관리 (배포자·관리자 전용) */
app.get('/api/admin/users', auth.requireAdmin, (req, res) => {
  res.json({ users: users.listUsers() });
});
app.post('/api/admin/users/:id/decide', auth.requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const u = users.decide(req.params.id, status, req.authUser);
  if (!u) return res.status(400).json({ error: '처리할 수 없는 요청입니다' });
  // 승인이 취소(거부)되면 이미 발급된 로그인 세션도 그 자리에서 끊는다
  if (status !== 'approved') auth.revokeSessions(u.username);
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', auth.requireAdmin, (req, res) => {
  const u = users.findById(req.params.id);
  const ok = users.remove(req.params.id);
  if (ok && u) auth.revokeSessions(u.username);
  res.json({ ok });
});

/* 사용자 활동(조회) 이력 (배포자·관리자 전용) */
app.get('/api/admin/activity', auth.requireAdmin, (req, res) => {
  res.json(activity.list(req.query));
});

app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: ['index.html'] }));
// 업로드 사진: 브라우저가 내용을 넘겨짚어 HTML 로 실행하지 못하도록 nosniff 를 강제한다
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    }
  })
);

/* ------------------------------------------------------------------ */
/* 업로드 설정                                                          */
/* ------------------------------------------------------------------ */

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // 파일명은 서버가 직접 만든다 — 사용자가 보낸 이름(경로 문자·확장자 포함)은 쓰지 않는다
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${EXT_BY_MIME[file.mimetype] || '.bin'}`)
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 6, fields: 20, parts: 30 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('지원하지 않는 형식입니다 (JPG/PNG/GIF/WebP 만 가능)'));
    }
    cb(null, true);
  }
});

/** 업로드된 내용이 정말 이미지인지 파일 앞부분(매직 넘버)으로 확인한다 — 확장자·MIME 은 위조할 수 있다 */
function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  const hex = buf.subarray(0, 12);
  if (hex[0] === 0xff && hex[1] === 0xd8 && hex[2] === 0xff) return true; // JPEG
  if (hex.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return true; // PNG
  if (hex.subarray(0, 6).toString('latin1').startsWith('GIF8')) return true; // GIF
  if (hex.subarray(0, 4).toString('latin1') === 'RIFF' && hex.subarray(8, 12).toString('latin1') === 'WEBP') return true;
  return false;
}

/** 검증에 실패했거나 처리 중 오류가 난 업로드 파일은 디스크에 남기지 않는다 */
function discardFiles(files) {
  for (const f of files || []) {
    try {
      fs.unlinkSync(f.path);
    } catch (e) {
      /* 이미 지워졌으면 무시 */
    }
  }
}

/* ------------------------------------------------------------------ */
/* 헬퍼                                                                 */
/* ------------------------------------------------------------------ */

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** 목록 입력 파싱 — 문자열만, 개수·길이 상한을 둔다 (AI 프롬프트로 들어가는 값이라 무한정 받지 않는다) */
function parseArray(v) {
  const clip = (arr) =>
    arr.filter((s) => typeof s === 'string').slice(0, 40).map((s) => s.slice(0, 200)).filter(Boolean);

  if (!v) return [];
  if (Array.isArray(v)) return clip(v);
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? clip(p) : [];
  } catch (e) {
    return clip(
      String(v)
        .split(',')
        .map((s) => s.trim())
    );
  }
}

const truthy = (v) => v === true || v === 'true' || v === '1' || v === 'on';

/* ------------------------------------------------------------------ */
/* 기본 데이터                                                          */
/* ------------------------------------------------------------------ */

app.get(
  '/api/bootstrap',
  wrap(async (req, res) => {
    const data = kb.load();
    res.json({
      app: { version: updater.APP_VERSION },
      kb: { version: data.version, counts: data.counts },
      settings: config.publicView({ isAdmin: req.authRole === 'admin' }),
      aiEnabled: ai.enabled(),
      processes: data.processes.map((p) => ({
        id: p.id,
        name: p.name,
        nameEn: p.nameEn,
        icon: p.icon,
        defectCount: data.processMap[p.id].defects.length,
        standards: p.standards,
        keyParams: p.keyParams
      }))
    });
  })
);

app.get(
  '/api/cues',
  wrap(async (req, res) => {
    res.json({ cues: kb.visualCueList(req.query.processId || null) });
  })
);

app.get(
  '/api/process/:id',
  wrap(async (req, res) => {
    const p = kb.getProcess(req.params.id);
    if (!p) return res.status(404).json({ error: '공정을 찾을 수 없습니다' });
    res.json({
      ...p,
      defects: p.defects.map((d) => ({
        id: d.id,
        name: d.name,
        nameEn: d.nameEn,
        severity: d.severity,
        description: d.description,
        images: d.images || []
      }))
    });
  })
);

app.get(
  '/api/defect/:id',
  wrap(async (req, res) => {
    const d = kb.getDefect(req.params.id);
    if (!d) return res.status(404).json({ error: '불량 항목을 찾을 수 없습니다' });
    const proc = kb.getProcess(d.process);
    activity.log({
      username: req.authUser,
      role: req.authRole,
      action: 'kb_view',
      label: d.name,
      ref: { type: 'defect', id: d.id },
      detail: {
        defectId: d.id,
        defectName: d.name,
        processName: proc ? proc.name : '',
        severity: d.severity,
        description: d.description
      },
      ip: req.ip
    });
    res.json({
      defect: d,
      process: proc ? { id: proc.id, name: proc.name, keyParams: proc.keyParams, standards: proc.standards } : null,
      report: analyzer.localReport({ defect: d, process: proc })
    });
  })
);

/* ------------------------------------------------------------------ */
/* 분석                                                                 */
/* ------------------------------------------------------------------ */

app.post(
  '/api/analyze',
  // AI 호출은 비용·시간이 큰 작업이라 계정당 횟수를 제한한다 (자동화된 반복 호출 방지)
  security.rateLimit({ name: 'analyze', max: 40, windowMs: 10 * 60 * 1000, message: '분석 요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }),
  upload.array('images', 6),
  wrap(async (req, res) => {
    const files = req.files || [];
    const text = (req.body.text || '').trim().slice(0, 5000);

    if (!text && files.length === 0) {
      discardFiles(files);
      return res.status(400).json({ error: '불량 설명을 입력하거나 사진을 업로드하세요.' });
    }

    const images = [];
    for (const f of files) {
      const buf = fs.readFileSync(f.path);
      if (!looksLikeImage(buf)) {
        discardFiles(files);
        return res.status(400).json({ error: '이미지 파일이 아닙니다. JPG/PNG/GIF/WebP 사진만 올릴 수 있습니다.' });
      }
      images.push({
        data: buf.toString('base64'),
        mediaType: f.mimetype,
        url: `/uploads/${f.filename}`,
        name: path.basename(f.originalname || '').slice(0, 120),
        bytes: f.size
      });
    }

    const cfg = config.get();
    const useAI = (req.body.useAI === undefined ? cfg.useAI : truthy(req.body.useAI)) && ai.enabled();
    const useWeb = req.body.useWeb === undefined ? cfg.useWeb : truthy(req.body.useWeb);
    const lang = req.body.lang === 'en' ? 'en' : 'ko';

    const result = await analyzer.analyze({
      text,
      processId: req.body.processId || null,
      cues: parseArray(req.body.cues),
      images: images.map((i) => ({ data: i.data, mediaType: i.mediaType })),
      useAI,
      useWeb,
      lang
    });

    result.images = images.map((i) => ({ url: i.url, name: i.name, bytes: i.bytes }));

    // 공정 문제 여부 판정
    result.judgement = judge(result, lang);

    // 이력 저장 (대시보드 통계·추적용)
    if (req.body.save !== 'false') {
      try {
        const rec = store.addFromResult(result, { username: req.authUser, inspector: cfg.inspector, line: cfg.line });
        result.recordId = rec.id;
      } catch (e) {
        result.warnings.push(`이력 저장 실패: ${e.message}`);
      }
    }

    activity.log({
      username: req.authUser,
      role: req.authRole,
      action: 'analyze',
      label: (result.defect && result.defect.name) || (result.vision && result.vision.defectName) || (text || '(사진만 분석)'),
      ref: result.recordId ? { type: 'record', id: result.recordId } : null,
      detail: {
        text: text || '(사진만 분석)',
        processName: result.process ? result.process.name : '',
        defectName: (result.defect && result.defect.name) || (result.vision && result.vision.defectName) || '',
        severity: (result.defect && result.defect.severity) || (result.vision && result.vision.severity) || '',
        judgeLabel: result.judgement ? result.judgement.label : '',
        imageCount: images.length,
        aiUsed: Boolean(result.usedAI),
        elapsedMs: result.elapsedMs || 0,
        recordId: result.recordId || ''
      },
      ip: req.ip
    });

    res.json(result);
  })
);

/** 불량명만으로 인터넷 조사 (사진/설명 없이) */
app.post(
  '/api/research',
  security.rateLimit({ name: 'research', max: 40, windowMs: 10 * 60 * 1000, message: '조사 요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }),
  wrap(async (req, res) => {
    if (!ai.enabled()) {
      return res.status(400).json({ error: 'API 키가 없어 인터넷 조사를 사용할 수 없습니다. [설정]에서 등록하세요.' });
    }
    const { defectName, processId, note, lang } = req.body || {};
    if (!defectName || typeof defectName !== 'string') return res.status(400).json({ error: 'defectName 이 필요합니다' });

    const proc = processId ? kb.getProcess(processId) : null;
    const out = await ai.research({
      defectName: defectName.slice(0, 200),
      processName: proc ? proc.name : '',
      description: '',
      note: String(note || '').slice(0, 2000),
      lang: lang === 'en' ? 'en' : 'ko'
    });
    res.json({ ok: true, ...out });
  })
);

/** 원인·조치·대책 개별 항목의 상세 설명 + 유사 사례 */
app.post(
  '/api/item-detail',
  security.rateLimit({ name: 'item-detail', max: 60, windowMs: 10 * 60 * 1000, message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }),
  wrap(async (req, res) => {
    const b = req.body || {};
    const text = String(b.text || '').trim().slice(0, 1000);
    const kind = b.kind;
    if (!text || !['cause', 'action', 'measure'].includes(kind)) {
      return res.status(400).json({ error: 'text, kind(cause|action|measure) 가 필요합니다' });
    }

    const local = {
      kb: kb.findRelated({ text, kind, excludeDefectId: b.defectId || null }),
      history: store.findRelated({ text, kind, excludeId: b.recordId || null })
    };

    let aiResult = null;
    let aiError = null;
    const cfg = config.get();
    const useAI = (b.useAI === undefined ? cfg.useAI : truthy(b.useAI)) && ai.enabled();
    if (useAI) {
      try {
        aiResult = await ai.explainItem({
          text,
          kind,
          rationale: b.rationale || '',
          defectName: b.defectName || '',
          processName: b.processName || '',
          lang: b.lang === 'en' ? 'en' : 'ko'
        });
      } catch (e) {
        aiError = e.message;
      }
    }

    activity.log({
      username: req.authUser,
      role: req.authRole,
      action: 'item_detail',
      label: `[${kind}] ${text.slice(0, 60)}`,
      // 상세정보는 저장하지 않고, 다시 열 수 있는 재조회 정보를 남긴다.
      ref: {
        type: 'item',
        kind,
        text,
        rationale: b.rationale || '',
        defectName: b.defectName || '',
        defectId: b.defectId || '',
        processName: b.processName || '',
        processId: b.processId || '',
        recordId: b.recordId || ''
      },
      detail: {
        kind,
        text,
        defectName: b.defectName || '',
        processName: b.processName || '',
        aiUsed: Boolean(aiResult),
        recordId: b.recordId || ''
      },
      ip: req.ip
    });

    res.json({ ok: true, local, ai: aiResult, aiError });
  })
);

/* ------------------------------------------------------------------ */
/* 이력 · 통계                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/stats', (req, res) => res.json(store.stats()));

app.get('/api/history', (req, res) => res.json(store.list(req.query)));

app.get(
  '/api/history/:id',
  wrap(async (req, res) => {
    const r = store.get(req.params.id);
    if (!r) return res.status(404).json({ error: '이력을 찾을 수 없습니다' });
    activity.log({
      username: req.authUser,
      role: req.authRole,
      action: 'history_view',
      label: r.defectName,
      ref: { type: 'record', id: r.id },
      detail: {
        recordId: r.id,
        defectName: r.defectName,
        processName: r.processName,
        severity: r.severity,
        status: r.status,
        at: r.at,
        text: r.text || ''
      },
      ip: req.ip
    });
    res.json(r);
  })
);

app.post(
  '/api/history/:id',
  wrap(async (req, res) => {
    const r = store.update(req.params.id, req.body || {});
    if (!r) return res.status(404).json({ error: '이력을 찾을 수 없습니다' });
    res.json({ ok: true, item: { id: r.id, status: r.status, memo: r.memo } });
  })
);

/* 이력 삭제는 되돌릴 수 없으므로 관리자만 */
app.delete(
  '/api/history/:id',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const ok = store.remove(req.params.id);
    if (ok) {
      activity.log({
        username: req.authUser,
        role: req.authRole,
        action: 'history_delete',
        label: `이력 삭제: ${req.params.id}`,
        detail: { recordId: req.params.id },
        ip: req.ip
      });
    }
    res.json({ ok });
  })
);

app.get('/api/export.csv', (req, res) => {
  const stamp = store.kstDayKey(new Date());
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="qc_defect_history_${stamp}.csv"`);
  res.send(store.toCsv());
});

/* ------------------------------------------------------------------ */
/* 학습 피드백 (판정 교정) — 촬영 각도·조명 오판정 학습용                  */
/* ------------------------------------------------------------------ */

/** 사용자가 AI/KB 판정을 확인·수정하거나 신규 불량을 제안 */
app.post(
  '/api/feedback',
  wrap(async (req, res) => {
    const b = req.body || {};
    if (!['confirm', 'correct', 'new_defect'].includes(b.kind)) {
      return res.status(400).json({ error: 'kind(confirm|correct|new_defect) 가 필요합니다' });
    }
    const rec = feedback.submit({ ...b, submittedBy: req.authUser });
    activity.log({
      username: req.authUser,
      role: req.authRole,
      action: 'feedback',
      label:
        b.kind === 'confirm'
          ? '판정 확인'
          : b.kind === 'correct'
            ? `판정 수정 → ${b.correctedDefectName || ''}`
            : `신규 불량 제안: ${b.newDefectName || ''}`,
      ref: { type: 'feedback', id: rec.id, recordId: b.recordId || '' },
      detail: {
        kind: b.kind,
        originalDefectName: b.originalDefectName || '',
        correctedDefectName: b.correctedDefectName || '',
        newDefectName: b.newDefectName || '',
        description: b.newDefectDescription || '',
        processName: b.processName || '',
        note: b.note || '',
        recordId: b.recordId || ''
      },
      ip: req.ip
    });
    res.json({ ok: true, id: rec.id });
  })
);

/* 관리자 검토 (배포자 전용) */
app.get('/api/admin/feedback', auth.requireAdmin, (req, res) => {
  res.json(feedback.list(req.query));
});

app.post('/api/admin/feedback/:id/decide', auth.requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const rec = feedback.decide(req.params.id, status, req.authUser);
  if (!rec) return res.status(400).json({ error: '처리할 수 없는 요청입니다' });
  res.json({ ok: true });
});

/** 신규 불량 제안을 실제 지식베이스에 추가 (관리자가 원인/조치/대책을 정리해서 등록) */
app.post(
  '/api/admin/feedback/:id/add-to-kb',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const rec = feedback.get(req.params.id);
    if (!rec) return res.status(404).json({ error: '피드백을 찾을 수 없습니다' });
    const b = req.body || {};
    if (!b.process || !b.name) return res.status(400).json({ error: 'process, name 이 필요합니다' });

    const defect = kb.addLearnedDefect({
      process: b.process,
      name: b.name,
      nameEn: b.nameEn || '',
      severity: b.severity || 'medium',
      keywords: b.keywords || [],
      visualCues: b.visualCues || rec.visualCues || [],
      description: b.description || rec.newDefectDescription || '',
      detect: b.detect || '',
      causes: b.causes || [],
      actions: b.actions || [],
      measures: b.measures || [],
      images: rec.imageUrls || []
    });
    feedback.markAddedToKb(rec.id, defect.id);
    res.json({ ok: true, defect });
  })
);

/* ------------------------------------------------------------------ */
/* 설정                                                                 */
/* ------------------------------------------------------------------ */

const isAdmin = (req) => ({ isAdmin: req.authRole === 'admin' });

app.get('/api/settings', (req, res) => res.json(config.publicView(isAdmin(req))));

app.post(
  '/api/settings',
  wrap(async (req, res) => {
    // API 키·모델·업데이트 주소 등 민감 항목은 config 안에서 관리자만 반영된다
    config.set(req.body || {}, isAdmin(req));
    res.json({ ok: true, settings: config.publicView(isAdmin(req)), aiEnabled: ai.enabled() });
  })
);

/* ------------------------------------------------------------------ */
/* KB 업데이트 (펌웨어) — 지식베이스 전체를 갈아끼우는 작업이므로 관리자 전용   */
/* ------------------------------------------------------------------ */

app.get('/api/kb/status', auth.requireAdmin, (req, res) => res.json(updater.currentStatus()));

app.post(
  '/api/kb/check',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const info = await updater.check();
    delete info.manifest; // 원본 매니페스트는 응답에서 제외
    res.json({ ok: true, ...info });
  })
);

app.post(
  '/api/kb/apply',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const out = await updater.apply();
    activity.log({
      username: req.authUser,
      role: req.authRole,
      action: 'kb_update',
      label: `지식베이스 업데이트: ${out.fromVersion || ''} → ${out.toVersion || ''}`,
      detail: { fromVersion: out.fromVersion || '', toVersion: out.toVersion || '', applied: Boolean(out.applied) },
      ip: req.ip
    });
    res.json({ ok: true, ...out });
  })
);

app.get('/api/kb/backups', auth.requireAdmin, (req, res) => res.json({ backups: updater.listBackups() }));

app.post(
  '/api/kb/restore',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const { backupId } = req.body || {};
    if (!backupId || typeof backupId !== 'string') return res.status(400).json({ error: 'backupId 가 필요합니다' });
    res.json({ ok: true, ...updater.restore(backupId) });
  })
);

app.post(
  '/api/kb/reload',
  auth.requireAdmin,
  wrap(async (req, res) => {
    const d = kb.reload();
    res.json({ ok: true, version: d.version, counts: d.counts });
  })
);

/* ------------------------------------------------------------------ */
/* 오류 처리                                                            */
/* ------------------------------------------------------------------ */

app.use((err, req, res, next) => {
  discardFiles(req.files); // 처리 도중 실패한 업로드 파일은 남기지 않는다
  const status = err instanceof multer.MulterError ? 400 : err.status || 500;
  if (status >= 500) console.error('[ERROR]', req.method, req.path, err);
  // 서버 내부 오류의 상세 내용(파일 경로·스택 등)은 화면에 내보내지 않는다
  const message = status >= 500 ? '서버 오류가 발생했습니다. 잠시 후 다시 시도하세요.' : err.message || '요청을 처리할 수 없습니다';
  res.status(status).json({ error: message, code: err.code || null });
});

app.listen(PORT, HOST, () => {
  const d = kb.load();
  console.log('');
  console.log(`  (바인딩: ${HOST}:${PORT} — 외부 공개는 Caddy HTTPS 프록시를 통해서만)`);
  console.log('  품질관리 불량분석 대시보드');
  console.log(`  http://localhost:${PORT}`);
  console.log('');
  console.log(`  KB v${d.version.kbVersion} — 공정 ${d.counts.processes}종 / 불량 ${d.counts.defects}건`);
  console.log(`  AI 분석: ${ai.enabled() ? '활성 (' + config.get().model + ')' : '비활성 — 대시보드 [설정]에서 API 키 등록'}`);
  console.log('');
});
