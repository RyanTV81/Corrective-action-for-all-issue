'use strict';
/**
 * 품질관리 불량분석 대시보드 서버
 *   node server.js        → http://localhost:3000
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

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

const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1); // 리버스 프록시(Caddy 등) 뒤에서 실제 클라이언트 IP·프로토콜을 신뢰
app.use(express.json({ limit: '2mb' }));

/* 로그인 · 사용 신청 (인증 미들웨어보다 먼저 등록해 예외 처리) */
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.post('/api/signup', auth.signup);
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

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
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', auth.requireAdmin, (req, res) => {
  res.json({ ok: users.remove(req.params.id) });
});

/* 사용자 활동(조회) 이력 (배포자·관리자 전용) */
app.get('/api/admin/activity', auth.requireAdmin, (req, res) => {
  res.json(activity.list(req.query));
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

/* ------------------------------------------------------------------ */
/* 업로드 설정                                                          */
/* ------------------------------------------------------------------ */

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[
        file.mimetype
      ] || '.bin';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error(`지원하지 않는 형식입니다: ${file.mimetype} (JPG/PNG/GIF/WebP 만 가능)`));
    }
    cb(null, true);
  }
});

/* ------------------------------------------------------------------ */
/* 헬퍼                                                                 */
/* ------------------------------------------------------------------ */

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch (e) {
    return String(v)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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
      app: { version: updater.APP_VERSION, node: process.version },
      kb: { version: data.version, counts: data.counts },
      settings: config.publicView(),
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
  upload.array('images', 6),
  wrap(async (req, res) => {
    const files = req.files || [];
    const text = (req.body.text || '').trim();

    if (!text && files.length === 0) {
      return res.status(400).json({ error: '불량 설명을 입력하거나 사진을 업로드하세요.' });
    }

    const images = files.map((f) => ({
      data: fs.readFileSync(f.path).toString('base64'),
      mediaType: f.mimetype,
      url: `/uploads/${f.filename}`,
      name: f.originalname,
      bytes: f.size
    }));

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
  wrap(async (req, res) => {
    if (!ai.enabled()) {
      return res.status(400).json({ error: 'API 키가 없어 인터넷 조사를 사용할 수 없습니다. [설정]에서 등록하세요.' });
    }
    const { defectName, processId, note, lang } = req.body || {};
    if (!defectName) return res.status(400).json({ error: 'defectName 이 필요합니다' });

    const proc = processId ? kb.getProcess(processId) : null;
    const out = await ai.research({
      defectName,
      processName: proc ? proc.name : '',
      description: '',
      note: note || '',
      lang: lang === 'en' ? 'en' : 'ko'
    });
    res.json({ ok: true, ...out });
  })
);

/** 원인·조치·대책 개별 항목의 상세 설명 + 유사 사례 */
app.post(
  '/api/item-detail',
  wrap(async (req, res) => {
    const b = req.body || {};
    const text = (b.text || '').trim();
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

app.delete(
  '/api/history/:id',
  wrap(async (req, res) => {
    res.json({ ok: store.remove(req.params.id) });
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

app.get('/api/settings', (req, res) => res.json(config.publicView()));

app.post(
  '/api/settings',
  wrap(async (req, res) => {
    config.set(req.body || {}, { isAdmin: req.authRole === 'admin' });
    res.json({ ok: true, settings: config.publicView(), aiEnabled: ai.enabled() });
  })
);

/* ------------------------------------------------------------------ */
/* KB 업데이트 (펌웨어)                                                  */
/* ------------------------------------------------------------------ */

app.get('/api/kb/status', (req, res) => res.json(updater.currentStatus()));

app.post(
  '/api/kb/check',
  wrap(async (req, res) => {
    const info = await updater.check();
    delete info.manifest; // 원본 매니페스트는 응답에서 제외
    res.json({ ok: true, ...info });
  })
);

app.post(
  '/api/kb/apply',
  wrap(async (req, res) => {
    const out = await updater.apply();
    res.json({ ok: true, ...out });
  })
);

app.get('/api/kb/backups', (req, res) => res.json({ backups: updater.listBackups() }));

app.post(
  '/api/kb/restore',
  wrap(async (req, res) => {
    const { backupId } = req.body || {};
    if (!backupId) return res.status(400).json({ error: 'backupId 가 필요합니다' });
    res.json({ ok: true, ...updater.restore(backupId) });
  })
);

app.post(
  '/api/kb/reload',
  wrap(async (req, res) => {
    const d = kb.reload();
    res.json({ ok: true, version: d.version, counts: d.counts });
  })
);

/* ------------------------------------------------------------------ */
/* 오류 처리                                                            */
/* ------------------------------------------------------------------ */

app.use((err, req, res, next) => {
  const status = err instanceof multer.MulterError ? 400 : err.status || 500;
  if (status >= 500) console.error('[ERROR]', err);
  res.status(status).json({ error: err.message || '서버 오류', code: err.code || null });
});

app.listen(PORT, () => {
  const d = kb.load();
  console.log('');
  console.log('  품질관리 불량분석 대시보드');
  console.log(`  http://localhost:${PORT}`);
  console.log('');
  console.log(`  KB v${d.version.kbVersion} — 공정 ${d.counts.processes}종 / 불량 ${d.counts.defects}건`);
  console.log(`  AI 분석: ${ai.enabled() ? '활성 (' + config.get().model + ')' : '비활성 — 대시보드 [설정]에서 API 키 등록'}`);
  console.log('');
});
