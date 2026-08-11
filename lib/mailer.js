'use strict';
/**
 * 가입 승인요청 알림 메일 (Gmail SMTP)
 * 발신 계정(smtpUser/smtpPass)이 설정되지 않았으면 조용히 건너뛴다 — 필수 기능이 아니다.
 */
const nodemailer = require('nodemailer');
const config = require('./config');

function enabled() {
  const c = config.get();
  return Boolean(c.smtpUser && c.smtpPass);
}

function transporter() {
  const c = config.get();
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: c.smtpUser, pass: c.smtpPass }
  });
}

/**
 * @param {object} opt {username, note, requestedAt, appUrl}
 */
async function notifySignupRequest(opt) {
  if (!enabled()) return { sent: false, reason: 'SMTP 미설정' };

  const c = config.get();
  const to = c.notifyEmail || c.smtpUser;
  const when = new Date(opt.requestedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const link = opt.appUrl ? `\n\n대시보드에 로그인해 [사용자 관리]에서 승인·거부하세요: ${opt.appUrl}` : '';

  await transporter().sendMail({
    from: `"품질관리 대시보드" <${c.smtpUser}>`,
    to,
    subject: `[대시보드] 새 사용 신청: ${opt.username}`,
    text: `새 사용 신청이 접수되었습니다.\n\n아이디: ${opt.username}\n소속·메모: ${opt.note || '-'}\n신청일시: ${when}${link}`
  });
  return { sent: true, to };
}

module.exports = { enabled, notifySignupRequest };
