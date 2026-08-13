  const I18N_EN = {
    '로그인 · 품질관리 대시보드': 'Login · Quality Management Dashboard',
    '공정 불량 분석 대시보드': 'Defect Analysis Dashboard',
    '사내 전용 — 로그인이 필요합니다': 'Internal use only — Login required',
    '아이디': 'Username',
    '비밀번호': 'Password',
    '로그인': 'Log In',
    '계정이 없으신가요? 사용 신청': "Don't have an account? Request access",
    '사용 신청 — 관리자 승인 후 로그인할 수 있습니다': 'Request Access — you can log in after admin approval',
    '(영문·숫자 3~32자)': '(letters/numbers, 3-32 chars)',
    '(8자 이상)': '(8+ characters)',
    '비밀번호 확인': 'Confirm Password',
    '소속·이름': 'Department/Name',
    '(선택, 승인 시 참고용)': '(optional, for reference at approval)',
    '예) 사출팀 정준상': 'e.g. Injection Team, Jane Doe',
    '사용 신청': 'Request Access',
    '이미 계정이 있으신가요? 로그인': 'Already have an account? Log in',
    '확인 중…': 'Checking…',
    '로그인 실패': 'Login failed',
    '비밀번호가 서로 다릅니다': 'Passwords do not match',
    '신청 중…': 'Submitting…',
    '신청 실패': 'Request failed'
  };

  let LANG = localStorage.getItem('qc_lang') || 'ko';
  function t(ko) {
    if (LANG !== 'en') return ko;
    return I18N_EN[ko] !== undefined ? I18N_EN[ko] : ko;
  }
  function applyI18n() {
    document.documentElement.lang = LANG;
    document.getElementById('btnLang').textContent = LANG === 'en' ? '한국어' : 'EN';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      if (el.dataset.i18nOrig === undefined) el.dataset.i18nOrig = el.textContent;
      el.textContent = t(el.dataset.i18nOrig);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPh);
    });
  }
  document.getElementById('btnLang').addEventListener('click', () => {
    LANG = LANG === 'en' ? 'ko' : 'en';
    localStorage.setItem('qc_lang', LANG);
    applyI18n();
  });
  applyI18n();

  const fLogin = document.getElementById('fLogin');
  const fSignup = document.getElementById('fSignup');

  document.getElementById('toSignup').addEventListener('click', () => {
    fLogin.hidden = true;
    fSignup.hidden = false;
  });
  document.getElementById('toLogin').addEventListener('click', () => {
    fSignup.hidden = true;
    fLogin.hidden = false;
  });

  fLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('loginErr');
    const btn = document.getElementById('btnLogin');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = t('확인 중…');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('u').value, password: document.getElementById('p').value })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || t('로그인 실패'));
      location.href = '/';
    } catch (e2) {
      err.textContent = e2.message;
      btn.disabled = false;
      btn.textContent = t('로그인');
    }
  });

  fSignup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('signupErr');
    const ok = document.getElementById('signupOk');
    const btn = document.getElementById('btnSignup');
    err.textContent = '';
    ok.hidden = true;
    const password = document.getElementById('sp').value;
    const password2 = document.getElementById('sp2').value;
    if (password !== password2) {
      err.textContent = t('비밀번호가 서로 다릅니다');
      return;
    }
    btn.disabled = true;
    btn.textContent = t('신청 중…');
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('su').value, password, note: document.getElementById('sn').value, lang: LANG })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || t('신청 실패'));
      ok.hidden = false;
      ok.textContent = body.message;
      fSignup.reset();
    } catch (e2) {
      err.textContent = e2.message;
    } finally {
      btn.disabled = false;
      btn.textContent = t('사용 신청');
    }
  });
