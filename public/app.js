'use strict';
/* 공정 불량 분석 대시보드 — 프론트엔드 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------------------------------------------------------------ */
/* 다국어(i18n) — 한국어 원문을 키로 삼아 영어로 치환한다.                   */
/* 사전에 없는 문자열은 원문(한국어) 그대로 반환(안전한 폴백).                */
/* ------------------------------------------------------------------ */

let LANG = localStorage.getItem('qc_lang') || 'ko';

const I18N_EN = {
  // 페이지/헤더
  '공정 불량 분석 대시보드 · 품질관리': 'Defect Analysis Dashboard · Quality Management',
  '공정 불량 분석 · 개선대책 대시보드': 'Defect Analysis · Corrective Action Dashboard',
  '자동차부품 품질관리 — 17개 공정 불량 진단 / 원인·개선조치·개선대책 각 10가지':
    'Automotive Parts QC — Diagnostics across 17 processes / 10 each of causes, actions, and measures',
  'AI 비활성': 'AI Inactive',
  '⚙ 설정': '⚙ Settings',
  '⭳ 업데이트': '⭳ Update',
  '👤 사용자 관리': '👤 User Management',
  '로그아웃': 'Logout',

  // 입력 패널
  '불량 현상 입력': 'Defect Input',
  '1. 공정 선택': '1. Select Process',
  '(미선택 시 설명·사진으로 자동 추정)': '(auto-detected from description/photo if not selected)',
  '공정 선택 해제': 'Clear Selection',
  '2. 불량 현상 설명': '2. Defect Description',
  '예) 사출 제품 게이트 주변에 은백색 줄무늬가 방사형으로 발생. 로트 교체 후부터 발생률 12% 수준. 표면은 매끈하고 손톱에 걸리지 않음.':
    'e.g. Silvery-white radial streaks near the gate of an injection-molded part. Occurrence rate ~12% since the lot change. Surface is smooth, not catching on a fingernail.',
  '발생 위치 · 형태 · 크기 · 발생률 · 발생 시점을 함께 적으면 정확도가 크게 올라갑니다.':
    'Including location, shape, size, occurrence rate, and timing greatly improves accuracy.',
  '3. 불량 사진': '3. Defect Photos',
  '(선택 · 최대 6장 · 12MB/장)': '(optional · up to 6 photos · 12MB each)',
  '사진 업로드': 'Upload photos',
  '<b>사진을 끌어다 놓거나 클릭</b>해서 선택<br>JPG · PNG · GIF · WebP': '<b>Drag &amp; drop or click</b> to select<br>JPG · PNG · GIF · WebP',
  '4. 관찰된 시각 특징': '4. Observed Visual Features',
  '(해당 항목 클릭)': '(click applicable items)',
  '공정을 먼저 선택하세요.': 'Select a process first.',
  '5. 분석 옵션': '5. Analysis Options',
  'AI 사진·현상 판독 (Gemini)': 'AI Photo/Symptom Analysis (Gemini)',
  '인터넷 최신 기술자료 조사': 'Web Research (Latest Technical References)',
  'API 키가 없으면 내장 지식베이스만으로 분석합니다(오프라인 동작). 이 경우에도 원인·개선조치·개선대책은 각 10가지가 제공됩니다.':
    'Without an API key, analysis uses only the built-in knowledge base (offline). Even then, 10 each of causes, actions, and measures are provided.',
  '🔍 불량 분석 시작': '🔍 Start Analysis',

  // 결과 패널 탭
  '분석 결과': 'Analysis Result',
  '대시보드': 'Dashboard',
  '이력': 'History',
  '지식베이스': 'Knowledge Base',

  // 빈 상태
  '불량 현상을 입력하고 분석을 시작하세요': 'Enter a defect description and start the analysis',
  '공정별 불량 지식베이스가 불량명을 판정하고,<br>원인 · 개선조치 · 개선대책을 각 10가지씩 정리합니다.':
    'The per-process defect knowledge base identifies the defect,<br>and compiles 10 each of causes, actions, and measures.',
  '관리 공정': 'Processes Covered',
  '등록 불량항목': 'Registered Defects',
  '원인 / 조치 / 대책': 'Causes / Actions / Measures',

  // 대시보드
  '누적 분석 건수': 'Total Analyses',
  '미완료 (조치중·검증중)': 'Open (In Progress · Verifying)',
  '최근 7일 신규': 'New in Last 7 Days',
  '최근 14일 분석 건수': 'Analyses in Last 14 Days',
  '공정별 발생 현황': 'Occurrences by Process',
  '근본원인 4M1E 분포': 'Root Cause 4M1E Distribution',
  '다발 불량 TOP 10': 'Top 10 Frequent Defects',
  '↻ 새로고침': '↻ Refresh',
  '⭳ 전체 이력 CSV': '⭳ Export All History (CSV)',
  '데이터가 없습니다.': 'No data.',
  '통계를 불러오지 못했습니다: ': 'Failed to load statistics: ',

  // 이력
  '전체 공정': 'All Processes',
  '전체 심각도': 'All Severities',
  '치명': 'Critical',
  '중대': 'High',
  '경미': 'Medium',
  '관찰': 'Low',
  '전체 판정': 'All Judgements',
  '공정 이상': 'Process Anomaly',
  '이상 의심': 'Suspected Anomaly',
  '경향 관리': 'Trend Watch',
  '산발 불량': 'Sporadic',
  '전체 상태': 'All Statuses',
  '조치중': 'In Progress',
  '검증중': 'Verifying',
  '완료': 'Done',
  '보류': 'On Hold',
  '불량명 · 내용 검색': 'Search defect name/content',
  '검색': 'Search',
  '⭳ CSV': '⭳ CSV',
  '일시': 'Date/Time',
  '사진': 'Photo',
  '공정': 'Process',
  '불량명': 'Defect',
  '심각도': 'Severity',
  '판정': 'Judgement',
  '신뢰도': 'Confidence',
  '상태': 'Status',
  '이력이 없습니다.': 'No history.',
  '조건에 맞는 이력이 없습니다.': 'No matching history.',
  '상태를 변경했습니다.': 'Status updated.',
  '이 이력을 삭제할까요?': 'Delete this record?',
  '이력을 불러오지 못했습니다: ': 'Failed to load history: ',
  '결과 보기': 'View Result',

  // 지식베이스
  '내장 지식베이스에 등록된 공정별 불량 항목입니다. 항목을 클릭하면 해당 불량의 원인 10 · 개선조치 10 · 개선대책 10을 바로 확인할 수 있습니다.':
    'These are defects registered in the built-in knowledge base by process. Click an item to see its 10 causes, 10 actions, and 10 measures. (Note: this KB content was authored in Korean and is shown as-is.)',
  '이 불량의 원인·조치·대책 보기': 'View Causes/Actions/Measures',

  // 설정 모달
  '설정': 'Settings',
  'Gemini API 키': 'Gemini API Key',
  '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>에서 신용카드 없이 무료로 발급받을 수 있습니다. 한 번만 등록해두면 그 다음부터는 인터넷 연결만으로 사진 판독·인터넷 조사가 자동 동작합니다. 비워두면 내장 지식베이스로만 분석합니다. 키는 이 PC의 <code>data/config.json</code> 에만 저장됩니다.':
    'Get a free key with no credit card at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>. Once registered, photo analysis and web research work automatically as long as you\'re online. Leave it blank to analyze using only the built-in knowledge base. The key is stored only in this PC\'s <code>data/config.json</code>.',
  '추가 API 키': 'Additional API Keys',
  '(선택 · 한 줄에 하나씩 · 무료 한도 확장용)': '(optional · one per line · extends free quota)',
  '서로 다른 Google 계정에서 발급받은 무료 키를 한 줄에 하나씩 추가하면, 요청이 모든 키에 번갈아 분산되어 무료 사용량 한도(분당 요청 수)에 걸릴 확률이 줄어듭니다. 개수 제한 없이 원하는 만큼 추가할 수 있습니다. 이미 등록된 키는 점(•)으로 표시되며, 그 줄을 그대로 두면 유지되고 지우면 삭제됩니다.':
    'Add free keys issued from separate Google accounts, one per line, and requests will be spread across all of them, reducing the chance of hitting the free-tier rate limit (requests per minute). Add as many as you like. Already-saved keys show as dots (•) — leave a line as-is to keep it, or delete the line to remove that key.',
  '현재 총 ': 'Currently ',
  '개 키가 등록되어 있습니다.': ' key(s) registered.',
  '분석 모델': 'Analysis Model',
  '분석 심도': 'Analysis Depth',
  'Gemini 3.5 Flash — 최고 정확도': 'Gemini 3.5 Flash — Highest Accuracy',
  'Gemini 3.6 Flash — 빠르고 무료 한도 넉넉 (권장)': 'Gemini 3.6 Flash — Fast, generous free tier (recommended)',
  'Gemini 3.5 Flash-Lite — 초고속': 'Gemini 3.5 Flash-Lite — Fastest',
  'low — 가장 빠름': 'low — fastest',
  'medium — 균형': 'medium — balanced',
  'high — 기본값': 'high — default',
  'xhigh — 정밀 분석': 'xhigh — precise analysis',
  'max — 최대 추론': 'max — maximum reasoning',
  '기본 동작': 'Default Behavior',
  'AI 판독 기본 사용': 'Use AI Analysis by Default',
  '인터넷 조사 기본 사용': 'Use Web Research by Default',
  '라인 / 공장': 'Line / Plant',
  '담당자': 'Inspector',
  '업데이트 매니페스트 URL': 'Update Manifest URL',
  '(지식베이스 자동 갱신)': '(auto-update knowledge base)',
  '가입 승인요청 알림 이메일': 'Signup Approval Notification Email',
  '(관리자 전용)': '(admin only)',
  '발신 Gmail 주소': 'Sender Gmail Address',
  'Gmail 앱 비밀번호': 'Gmail App Password',
  '알림 받을 이메일': 'Notification Recipient Email',
  'Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호에서 발급받은 값을 입력하세요(로그인 비밀번호 아님). 설정해두면 새 사용 신청이 들어올 때마다 이메일로 알려드립니다.':
    'Enter the value issued from Google Account → Security → 2-Step Verification → App Passwords (not your login password). Once set, you’ll be emailed whenever a new signup request comes in.',
  '취소': 'Cancel',
  '저장': 'Save',
  '설정을 저장했습니다.': 'Settings saved.',

  // 업데이트 모달
  '지식베이스 업데이트': 'Knowledge Base Update',
  '🌐 새 버전 확인': '🌐 Check for New Version',
  '⭳ 업데이트 적용': '⭳ Apply Update',
  '닫기': 'Close',
  '프로그램 버전': 'Program Version',
  '지식베이스 버전': 'Knowledge Base Version',
  '최종 갱신': 'Last Updated',
  '기본 내장': 'Built-in default',
  '수록 내용': 'Contents',
  '업데이트 서버': 'Update Server',
  '미설정': 'Not configured',
  '보관 백업': 'Stored Backups',
  '업데이트 서버가 설정되지 않았습니다. [설정]에서 매니페스트 URL을 등록하면 인터넷을 통해 지식베이스를 자동으로 갱신할 수 있습니다.':
    'No update server configured. Register a manifest URL in [Settings] to auto-update the knowledge base over the internet.',
  '업데이트 서버 확인 중…': 'Checking update server…',
  '최신 버전을 사용 중입니다': 'You are using the latest version',
  '지식베이스를 업데이트할까요? 기존 파일은 자동으로 백업됩니다.': 'Update the knowledge base? Existing files will be backed up automatically.',
  '내려받아 검증하는 중…': 'Downloading and verifying…',

  // 사용자 관리
  '사용자 관리': 'User Management',
  '가입 승인': 'Signup Approval',
  '활동 이력': 'Activity Log',
  '학습 피드백': 'Learning Feedback',
  '전체 사용자': 'All Users',
  '전체 활동': 'All Activities',
  '로그인': 'Login',
  '불량 분석': 'Defect Analysis',
  '이력 조회': 'History View',
  '상세정보 조회': 'Detail View',
  '지식베이스 조회': 'KB View',
  '사용자가 확인·수정·제안한 판정입니다. 확정하면 다음 사진판독 시 참고자료로 자동 활용됩니다.':
    'Judgements confirmed, corrected, or proposed by users. Once confirmed, they’re automatically used as reference for future photo analysis.',
  '불러오는 중…': 'Loading…',
  '불러오지 못했습니다: ': 'Failed to load: ',
  '신청된 계정이 없습니다.': 'No account requests.',
  '아이디': 'Username',
  '소속·메모': 'Department/Note',
  '신청일시': 'Requested At',
  '승인': 'Approve',
  '거부': 'Reject',
  '삭제': 'Delete',
  '이 계정 신청 기록을 삭제할까요?': 'Delete this account request?',
  '승인했습니다.': 'Approved.',
  '거부했습니다.': 'Rejected.',
  '승인 대기': 'Pending',
  '승인됨': 'Approved',
  '거부됨': 'Rejected',
  '활동 이력이 없습니다.': 'No activity history.',
  '시각': 'Time',
  '사용자': 'User',
  '활동': 'Activity',
  '내용': 'Details',
  '관리자': 'Admin',

  // 학습 피드백 (결과화면)
  '판정이 정확한가요?': 'Is this judgement accurate?',
  '촬영 각도·조명 때문에 AI가 다르게 볼 수 있습니다. 확인해주시면 다음 분석부터 참고합니다.':
    'Shooting angle or lighting may cause the AI to see things differently. Confirming helps refine future analyses.',
  '👍 정확함': '👍 Accurate',
  '✏️ 다릅니다 — 수정하기': '✏️ It’s different — Correct it',
  '판정 수정 · 학습 데이터 제공': 'Correct Judgement · Provide Training Data',
  '실제 불량은 무엇인가요?': 'What is the actual defect?',
  '목록에서 선택': 'Select from list',
  '목록에 없음 (신규 불량 제안)': 'Not in list (propose new defect)',
  '실제 불량 선택': 'Select Actual Defect',
  '신규 불량명': 'New Defect Name',
  '예) OO 자국': 'e.g. OO mark',
  '설명': 'Description',
  '(선택)': '(optional)',
  '어떤 형태·위치의 불량인지 설명': 'Describe the shape/location of the defect',
  '촬영 조건 메모': 'Shooting Condition Notes',
  '(각도·조명 등 — 오판정 원인 파악에 중요)': '(angle, lighting, etc. — important for diagnosing misjudgments)',
  '예) 역광 촬영, 형광등 아래 저각도 촬영 등': 'e.g. shot against backlight, low angle under fluorescent light, etc.',
  '제출': 'Submit',
  '저장된 이력이 없어 피드백을 남길 수 없습니다.': 'Cannot leave feedback — no saved record.',
  '감사합니다! 판정 확인이 기록되었습니다.': 'Thank you! Your confirmation has been recorded.',
  '불러오지 못함': 'Failed to load',
  '(공정 미판정 — 신규 불량으로 제안하세요)': '(Process not determined — please propose as a new defect)',
  '신규 불량명을 입력하세요.': 'Please enter the new defect name.',
  '실제 불량을 선택하세요.': 'Please select the actual defect.',
  '감사합니다! 관리자 확인 후 학습에 반영됩니다.': 'Thank you! This will be applied after admin review.',

  // 학습 피드백 (관리자)
  '[확인]': '[Confirm]',
  '[수정]': '[Correct]',
  '[신규 제안]': '[New Proposal]',
  '(확인만)': '(confirmation only)',
  '검토 대기': 'Pending Review',
  '확정됨': 'Confirmed',
  'KB 등록됨': 'Added to KB',
  '확정': 'Confirm',
  'KB 등록': 'Add to KB',
  '피드백이 없습니다.': 'No feedback.',
  '확정했습니다.': 'Confirmed.',
  '메모: ': 'Note: ',

  // KB 신규 등록 모달
  '지식베이스에 새 불량 등록': 'Register New Defect in Knowledge Base',
  '불량명(국문)': 'Defect Name (Korean)',
  '불량명(영문)': 'Defect Name (English)',
  '검색 키워드': 'Search Keywords',
  '(쉼표로 구분)': '(comma-separated)',
  '시각 특징': 'Visual Features',
  '검출 방법': 'Detection Method',
  '발생 원인': 'Causes',
  '(한 줄에 하나씩)': '(one per line)',
  '개선 조치': 'Actions',
  '개선 대책': 'Measures',
  '지식베이스에 추가': 'Add to Knowledge Base',
  '불량명을 입력하세요.': 'Please enter the defect name.',
  '지식베이스에 추가했습니다.': 'Added to the knowledge base.',

  // 항목 상세정보
  '상세 정보': 'Details',
  '상세 정보를 불러오는 중…': 'Loading details…',
  '지식베이스 내 유사 사례': 'Similar Cases in Knowledge Base',
  '불량에도 등록되어 있습니다': 'is also registered under this defect',
  '공정 공통 항목에 등록되어 있습니다': 'process common item',
  '전 공정 공통(4M1E) 항목입니다.': 'This is a common item across all processes (4M1E).',
  '동일 문구가 등록된 다른 항목이 없습니다 — 이 불량에 특화된 항목입니다.':
    'No other entries share this exact wording — this item is specific to this defect.',
  '우리 현장 이력 중 동일 항목 사용 사례 ': 'Cases from our site history using the same item: ',
  '우리 현장 이력': 'Our Site History',
  '과거 이력 중 동일 항목이 사용된 기록이 없습니다.': 'No past records use this same item.',
  '5-Why 근본원인 분석': '5-Why Root Cause Analysis',
  '근본원인:': 'Root cause:',
  '상세 설명': 'Detailed Explanation',
  '대체 웹검색': 'Fallback Web Search',
  '원리:': 'Principle:',
  '실행 절차': 'Execution Steps',
  '흔한 실수 · 주의사항': 'Common Mistakes · Cautions',
  '유사 산업 사례': 'Similar Industry Cases',
  '참고 출처 ': 'References ',
  'AI 상세 설명 · 5-Why · 유사 산업 사례': 'AI Detailed Explanation · 5-Why · Similar Cases',
  'AI가 꺼져 있어 제공되지 않습니다. [설정]에서 Gemini API 키를 등록하고 AI 판독을 켜면, 이 항목에 대한 5-Why 근본원인 분석과 실행 절차·유사 사례를 볼 수 있습니다.':
    'Not available because AI is off. Register a Gemini API key in [Settings] and enable AI analysis to see 5-Why root cause analysis, execution steps, and similar cases for this item.',

  // 결과 화면 공통
  '미분류 불량': 'Unclassified Defect',
  '(자동추정)': ' (auto-detected)',
  '심각도 ': 'Severity ',
  '판정 신뢰도 ': 'Confidence ',
  '인터넷 조사': 'Web Research',
  'KB 직접 매칭 실패': 'No Direct KB Match',
  '등록된 불량 항목과 직접 매칭되지 않았습니다. 아래는 해당 공정에서 빈도가 높은 원인·조치·대책입니다.':
    'Did not directly match a registered defect. Below are the most common causes, actions, and measures for this process.',
  '개선 조치 ': 'Actions ',
  '개선 대책 ': 'Measures ',
  '발생 원인 ': 'Causes ',
  '공정 판정': 'Process Judgement',
  '근거 · 출처': 'Basis · Sources',
  '가지 (즉시 대응)': ' items (immediate response)',
  '가지 (재발방지)': ' items (recurrence prevention)',
  '가지': ' items',
  '공정 이상 판정': 'Process Anomaly Judgement',
  '판정 근거 및 출처': 'Judgement Basis & Sources',
  '🖨 보고서 인쇄 / PDF 저장': '🖨 Print Report / Save PDF',
  '⭳ 이력 CSV': '⭳ History CSV',
  '관리번호 ': 'Record No. ',
  '분석 소요 ': 'Analysis time ',
  '항목이 없습니다.': 'No items.',
  '불량항목': 'Defect-specific',
  '공정공통': 'Process common',
  '공통(4M)': 'Common (4M)',
  'AI·웹조사': 'AI · Web research',
  '자세히 ›': 'Details ›',
  '시점: ': 'When: ',
  '담당: ': 'Owner: ',
  '유형: ': 'Type: ',
  '효과확인 KPI: ': 'Effect KPI: ',

  // judgeHtml
  '판정 없음': 'No judgement',
  '리스크 점수 ': 'Risk score ',
  '사내 공정 기인 가능성 높음': 'Likely caused by our internal process',
  '공정 외부(': 'Likely caused outside the process (',
  ') 기인 가능성': ')',
  '로트 격리 필요': 'Lot containment required',
  '상위 보고 대상': 'Escalation required',
  '판정 근거': 'Judgement Basis',
  '특이 근거 없음': 'No notable basis',
  '추정 원인 4M1E 분포': 'Estimated 4M1E Cause Distribution',
  '분류 정보가 없습니다.': 'No classification data.',
  '주요 원인군: ': 'Dominant cause group: ',
  '재발 이력': 'Recurrence History',
  '최근 ': 'Last ',
  '일': ' days',
  '동일 불량 ': 'same defect(s): ',
  '건': '',
  '(최근 ': '(most recent: ',
  '반복 발생 — 산발 불량이 아니라 공정 고질 문제로 다루어야 합니다.':
    'Recurring — should be treated as a chronic process issue, not a sporadic defect.',
  '반복 발생 기준(30일 3건) 미만입니다.': 'Below the recurrence threshold (3 cases in 30 days).',
  '즉시 확인할 공정 파라미터': 'Process Parameters to Check Immediately',
  '각 항목을 표준조건서 설정값과 실측값으로 대조하고, 최근 4M(사람·설비·재료·방법) 변경 이력을 확인하십시오.':
    'Compare each item against standard setpoints and measured values, and review recent 4M (Man/Machine/Material/Method) changes.',
  '공정이 확정되지 않아 점검 항목을 제시할 수 없습니다.': 'Cannot suggest check items because the process is not determined.',
  '지금 바로 취할 조치 (TOP 3)': 'Immediate Actions to Take (Top 3)',
  '항목 없음': 'No items',
  '관련 규격 · 평가체계': 'Related Standards · Evaluation System',

  // refHtml
  '업로드 사진': 'Uploaded Photos',
  'AI 사진 판독': 'AI Photo Analysis',
  '관찰 사실': 'Observation',
  '공정 판단': 'Process Reasoning',
  '확신도': 'Confidence',
  '관찰 특징': 'Observed Features',
  '추가 확인': 'Additional Checks',
  '지식베이스 매칭 후보': 'KB Matching Candidates',
  '점수 ': 'Score ',
  '1순위 매칭 근거: ': 'Top match basis: ',
  '공정 자동 추정': 'Auto-Detected Process',
  '인터넷 조사 요약': 'Web Research Summary',
  '발생 메커니즘:': 'Mechanism:',
  '참고 자료 ': 'References ',
  '이번 분석에서는 인터넷 조사를 사용하지 않았습니다.': 'Web research was not used for this analysis.',
  'API 키가 없어 인터넷 조사를 사용할 수 없습니다. [설정]에서 등록하면 최신 기술자료를 종합해 원인·조치·대책에 반영합니다.':
    'Web research is unavailable without an API key. Register one in [Settings] to incorporate the latest technical references into causes, actions, and measures.',
  '이 불량의 검출 방법': 'How This Defect Is Detected',

  // 초기화/업로드/분석 진행
  '초기화 실패: ': 'Initialization failed: ',
  '지원하지 않는 형식입니다.': 'Unsupported file format.',
  '12MB를 초과합니다.': 'Exceeds 12MB.',
  '사진은 최대 6장까지 첨부할 수 있습니다.': 'You can attach up to 6 photos.',
  '불량 설명을 입력하거나 사진을 첨부하세요.': 'Enter a defect description or attach a photo.',
  '분석 중…': 'Analyzing…',
  '불량을 분석하고 있습니다': 'Analyzing the defect',
  '사진 판독 → ': 'Photo analysis → ',
  '지식베이스 매칭 → 원인·조치·대책 도출': 'KB matching → deriving causes, actions, and measures',
  ' → 인터넷 조사': ' → web research',
  'AI 사용 시 최대 2~3분이 걸릴 수 있습니다.': 'May take up to 2-3 minutes when using AI.',
  '분석에 실패했습니다': 'Analysis failed'
};

function t(ko) {
  if (LANG !== 'en') return ko;
  return I18N_EN[ko] !== undefined ? I18N_EN[ko] : ko;
}

function setLang(lang) {
  localStorage.setItem('qc_lang', lang);
  location.reload();
}

function applyStaticI18n() {
  document.documentElement.lang = LANG;
  $('#btnLang').textContent = LANG === 'en' ? '한국어' : 'EN';
  $$('[data-i18n]').forEach((el) => {
    if (el.dataset.i18nOrig === undefined) el.dataset.i18nOrig = el.textContent;
    el.textContent = t(el.dataset.i18nOrig);
  });
  $$('[data-i18n-ph]').forEach((el) => {
    const orig = el.dataset.i18nPh;
    el.placeholder = t(orig);
  });
  $$('[data-i18n-aria]').forEach((el) => {
    const orig = el.dataset.i18nAria;
    el.setAttribute('aria-label', t(orig));
  });
  $$('[data-i18n-html]').forEach((el) => {
    if (el.dataset.i18nOrigHtml === undefined) el.dataset.i18nOrigHtml = el.innerHTML;
    el.innerHTML = t(el.dataset.i18nOrigHtml);
  });
}

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
const CAT_EN = {
  Man: 'Man',
  Machine: 'Machine',
  Material: 'Material',
  Method: 'Method',
  Measurement: 'Measurement',
  Environment: 'Environment'
};
const catLabel = (cat) => (LANG === 'en' ? CAT_EN[cat] || cat : CAT_KO[cat] || cat);

function toast(msg, isErr) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isErr ? 6000 : 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error(t('로그인이 필요합니다'));
  }
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || `${t('요청 실패')} (${res.status})`);
  return body;
}

const fmtDate = (iso) => (iso || '').replace('T', ' ').slice(0, 16);

/* ------------------------------------------------------------------ */
/* 초기화                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  applyStaticI18n();
  bindStaticEvents();
  try {
    const [boot, me] = await Promise.all([api('/api/bootstrap'), api('/api/me')]);
    state.boot = boot;
    state.processes = boot.processes;
    state.settings = boot.settings;
    state.role = me.role;

    $('#chipKb').textContent = `KB v${boot.kb.version.kbVersion} · ${t('불량')} ${boot.kb.counts.defects}${t('건')}`;
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
      refreshFbPendingCount();
    }
  } catch (e) {
    toast(t('초기화 실패: ') + e.message, true);
  }
}

function setAiChip(on) {
  const c = $('#chipAi');
  c.className = 'chip ' + (on ? 'ok' : 'off');
  c.textContent = on ? `${t('AI 활성')} · ${state.settings ? state.settings.model : ''}` : t('AI 비활성 (내장 KB만)');
  $('#aiNote').textContent = on
    ? t('AI 판독이 활성화되어 사진 분석과 인터넷 조사를 사용할 수 있습니다.')
    : t('API 키가 없어 내장 지식베이스로만 분석합니다(오프라인 동작). 이 경우에도 원인·개선조치·개선대책은 각 10가지가 제공됩니다.');
}

/* ------------------------------------------------------------------ */
/* 공정 · 시각특징                                                       */
/* ------------------------------------------------------------------ */

function renderProcGrid() {
  $('#procGrid').innerHTML = state.processes
    .map(
      (p) => `<button type="button" class="proc" data-id="${p.id}" title="${esc(p.nameEn)} · ${t('불량')} ${p.defectCount}${t('건')}">
        <span class="ic">${p.icon}</span><span class="n">${esc(LANG === 'en' && p.nameEn ? p.nameEn : p.name)}</span><span class="c">${p.defectCount}</span>
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
    `<option value="">${t('전체 공정')}</option>` +
    state.processes.map((p) => `<option value="${p.id}">${esc(LANG === 'en' && p.nameEn ? p.nameEn : p.name)}</option>`).join('');
}

async function loadCues() {
  const box = $('#cues');
  box.innerHTML = `<small>${t('불러오는 중…')}</small>`;
  try {
    const { cues } = await api('/api/cues' + (state.procId ? `?processId=${state.procId}` : ''));
    if (!cues.length) return (box.innerHTML = `<small>${t('표시할 항목이 없습니다.')}</small>`);
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
    box.innerHTML = `<small>${t('불러오지 못했습니다: ')}${esc(e.message)}</small>`;
  }
}

/* ------------------------------------------------------------------ */
/* 사진 업로드                                                          */
/* ------------------------------------------------------------------ */

function addFiles(list) {
  for (const f of list) {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) {
      toast(`${f.name}: ${t('지원하지 않는 형식입니다.')}`, true);
      continue;
    }
    if (f.size > 12 * 1024 * 1024) {
      toast(`${f.name}: ${t('12MB를 초과합니다.')}`, true);
      continue;
    }
    if (state.files.length >= 6) {
      toast(t('사진은 최대 6장까지 첨부할 수 있습니다.'), true);
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
    d.innerHTML = `<img src="${url}" alt="${esc(f.name)}"><button type="button" title="${t('삭제')}">&times;</button>`;
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
    toast(t('불량 설명을 입력하거나 사진을 첨부하세요.'), true);
    return;
  }

  const btn = $('#btnAnalyze');
  btn.disabled = true;
  btn.textContent = t('분석 중…');
  showView('analyze');
  $('#resultBox').innerHTML = `<div class="loading"><div class="spinner"></div>
    <h3>${t('불량을 분석하고 있습니다')}</h3>
    <p>${state.files.length ? t('사진 판독 → ') : ''}${t('지식베이스 매칭 → 원인·조치·대책 도출')}${
      $('#useWeb').checked ? t(' → 인터넷 조사') : ''
    }<br><small>${t('AI 사용 시 최대 2~3분이 걸릴 수 있습니다.')}</small></p></div>`;

  const fd = new FormData();
  fd.append('text', text);
  if (state.procId) fd.append('processId', state.procId);
  fd.append('cues', JSON.stringify([...state.cues]));
  fd.append('useAI', $('#useAI').checked ? 'true' : 'false');
  fd.append('useWeb', $('#useWeb').checked ? 'true' : 'false');
  fd.append('lang', LANG);
  state.files.forEach((f) => fd.append('images', f));

  try {
    const r = await api('/api/analyze', { method: 'POST', body: fd });
    state.result = r;
    renderResult(r);
    loadStats();
    loadHistory();
  } catch (e) {
    $('#resultBox').innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>
      <h3>${t('분석에 실패했습니다')}</h3><p>${esc(e.message)}</p></div>`;
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = t('🔍 불량 분석 시작');
  }
}

/* ------------------------------------------------------------------ */
/* 결과 렌더링                                                          */
/* ------------------------------------------------------------------ */

function itemHtml(it, kind, idx) {
  const cat = it.cat ? `<span class="badge ${it.cat}">${catLabel(it.cat)}</span>` : '';
  const origin = it.origin
    ? `<span class="badge ${/AI|웹/.test(it.origin) ? 'ai' : 'origin'}">${esc(t(it.origin))}</span>`
    : '';

  let sub = '';
  if (kind === 'cause' && it.rationale) sub = esc(it.rationale);
  if (kind === 'action') {
    const bits = [];
    if (it.when) bits.push(`${t('시점: ')}${it.when}`);
    if (it.owner) bits.push(`${t('담당: ')}${it.owner}`);
    sub = esc(bits.join(' · '));
  }
  if (kind === 'measure') {
    const bits = [];
    if (it.type) bits.push(`${t('유형: ')}${it.type}`);
    if (it.kpi) bits.push(`${t('효과확인 KPI: ')}${it.kpi}`);
    sub = esc(bits.join(' · '));
  }

  return `<div class="item clickable" data-kind="${kind}" data-idx="${idx}" role="button" tabindex="0">
    <div class="item-no"></div>
    <div class="item-main">
      <div class="item-text">${esc(it.text)}</div>
      ${sub ? `<div class="item-sub">${sub}</div>` : ''}
      <div class="item-meta">${cat}${origin}</div>
    </div>
    <div class="item-more">${t('자세히 ›')}</div>
  </div>`;
}

function listHtml(arr, kind) {
  if (!arr || !arr.length) return `<p class="note">${t('항목이 없습니다.')}</p>`;
  return `<div class="item-list">${arr.map((i, idx) => itemHtml(i, kind, idx)).join('')}</div>`;
}

function renderResult(r) {
  const d = r.defect;
  const v = r.vision;
  const j = r.judgement || {};
  const name = (d && d.name) || (v && v.defectName) || t('미분류 불량');
  const nameEn = (d && d.nameEn) || (v && v.defectNameEn) || '';
  const s = sev(j.severity || (d && d.severity));

  const warn = (r.warnings || []).length
    ? `<div class="warn">⚠ ${r.warnings.map(esc).join('<br>⚠ ')}</div>`
    : '';

  const tags = [
    r.process ? `<span class="tag proc">${r.process.icon} ${esc(LANG === 'en' && r.process.nameEn ? r.process.nameEn : r.process.name)}${r.process.guessed ? t('(자동추정)') : ''}</span>` : '',
    `<span class="tag ${s.cls}">${t('심각도 ')}${t(s.ko)}</span>`,
    `<span class="tag">${t('판정 신뢰도 ')}${Math.round((j.confidence || 0) * 100)}%</span>`,
    r.usedAI ? `<span class="tag ai">${t('AI 판독')}</span>` : '',
    r.web ? `<span class="tag ai">${t('인터넷 조사')}</span>` : '',
    d ? '' : `<span class="tag medium">${t('KB 직접 매칭 실패')}</span>`
  ].join('');

  // LANG=en 이면서 defect 가 KB 원문(한국어)만 갖고 있으면, 이름은 nameEn 을 우선 사용(있는 경우)
  const displayName = LANG === 'en' && d && d.nameEn ? d.nameEn : name;

  const verdict = `
    <div class="verdict sev-${j.color === 'ok' ? 'low' : j.color || s.cls}">
      <div class="v-head">
        <h2>${esc(displayName)}</h2>
        ${nameEn && displayName !== nameEn ? `<span class="v-en">${esc(nameEn)}</span>` : ''}
      </div>
      <p class="v-desc">${esc((d && d.description) || (v && v.observation) || t('등록된 불량 항목과 직접 매칭되지 않았습니다. 아래는 해당 공정에서 빈도가 높은 원인·조치·대책입니다.'))}</p>
      <div class="v-tags">${tags}</div>
    </div>`;

  const tabs = `
    <div class="tabs" id="resTabs">
      <button class="tab active" data-t="cause">${t('발생 원인 ')}<span class="cnt">${(r.causes || []).length}</span></button>
      <button class="tab" data-t="action">${t('개선 조치 ')}<span class="cnt">${(r.actions || []).length}</span></button>
      <button class="tab" data-t="measure">${t('개선 대책 ')}<span class="cnt">${(r.measures || []).length}</span></button>
      <button class="tab" data-t="judge">${t('공정 판정')}</button>
      <button class="tab" data-t="ref">${t('근거 · 출처')}</button>
    </div>`;

  const bodies = `
    <div class="tab-body" data-t="cause" data-print-title="${t('발생 원인 ')}${(r.causes || []).length}${t('가지')}">${listHtml(r.causes, 'cause')}</div>
    <div class="tab-body" data-t="action" data-print-title="${t('개선 조치 ')}${(r.actions || []).length}${t('가지 (즉시 대응)')}" hidden>${listHtml(r.actions, 'action')}</div>
    <div class="tab-body" data-t="measure" data-print-title="${t('개선 대책 ')}${(r.measures || []).length}${t('가지 (재발방지)')}" hidden>${listHtml(r.measures, 'measure')}</div>
    <div class="tab-body" data-t="judge" data-print-title="${t('공정 이상 판정')}" hidden>${judgeHtml(r, j)}</div>
    <div class="tab-body" data-t="ref" data-print-title="${t('판정 근거 및 출처')}" hidden>${refHtml(r)}</div>`;

  const actions = `
    <div class="result-actions">
      <button class="btn" onclick="window.print()">${t('🖨 보고서 인쇄 / PDF 저장')}</button>
      <a class="btn" href="/api/export.csv">${t('⭳ 이력 CSV')}</a>
      ${r.recordId ? `<span class="tag">${t('관리번호 ')}${esc(r.recordId)}</span>` : ''}
      <span class="meta">${t('분석 소요 ')}${((r.elapsedMs || 0) / 1000).toFixed(1)}${LANG === 'en' ? 's' : '초'}${r.web && r.web.model ? ' · ' + esc(r.web.model) : ''}</span>
    </div>`;

  const fbCard = r.recordId
    ? `<div class="card" id="fbPrompt">
        <h4>${t('판정이 정확한가요?')}</h4>
        <p class="note" style="margin-bottom:10px">${t('촬영 각도·조명 때문에 AI가 다르게 볼 수 있습니다. 확인해주시면 다음 분석부터 참고합니다.')}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="btnFbConfirm">${t('👍 정확함')}</button>
          <button class="btn" id="btnFbCorrect">${t('✏️ 다릅니다 — 수정하기')}</button>
        </div>
      </div>`
    : '';

  $('#resultBox').innerHTML = warn + verdict + fbCard + actions + tabs + bodies;

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

  if (r.recordId) {
    $('#btnFbConfirm').addEventListener('click', submitFeedbackConfirm);
    $('#btnFbCorrect').addEventListener('click', openFeedbackCorrect);
  }
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
  $('#detailTitle').textContent = `${t(ITEM_KIND_KO[kind]) || ''} — ${it.text}`;
  $('#detailBody').innerHTML = `<div class="loading"><div class="spinner"></div><p>${t('상세 정보를 불러오는 중…')}</p></div>`;

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
        useAI: $('#useAI').checked,
        lang: LANG
      })
    });
    renderItemDetail(data);
  } catch (e) {
    $('#detailBody').innerHTML = `<div class="empty"><div class="empty-icon">⚠</div><h3>${t('불러오지 못했습니다')}</h3><p>${esc(e.message)}</p></div>`;
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
    kbParts.push(relatedListHtml(kbRelated.inDefects, 'kb', (d) => `<b>${esc(d.name)}</b> <span class="hint">(${esc(d.processName)})</span> ${t('불량에도 등록되어 있습니다')}`));
  }
  if ((kbRelated.inProcessCommon || []).length) {
    kbParts.push(relatedListHtml(kbRelated.inProcessCommon, 'kb', (p) => `<b>${esc(p.processName)}</b> ${t('공정 공통 항목에 등록되어 있습니다')}`));
  }
  if (kbRelated.inUniversal) kbParts.push(`<p class="note">${t('전 공정 공통(4M1E) 항목입니다.')}</p>`);
  const kbCard = kbParts.length
    ? `<div class="card"><h4>${t('지식베이스 내 유사 사례')}</h4>${kbParts.join('')}</div>`
    : `<div class="card"><h4>${t('지식베이스 내 유사 사례')}</h4><p class="note">${t('동일 문구가 등록된 다른 항목이 없습니다 — 이 불량에 특화된 항목입니다.')}</p></div>`;

  const hist = local.history || [];
  const histCard = hist.length
    ? `<div class="card"><h4>${t('우리 현장 이력 중 동일 항목 사용 사례 ')}${hist.length}${t('건')}</h4>
        <ul class="related-list">${hist
          .map((h) => `<li><b>${esc(h.defectName)}</b> <span class="hint">${esc(h.processName || '')} · ${fmtDate(h.at)} · ${esc(t(h.status))}</span></li>`)
          .join('')}</ul>
      </div>`
    : `<div class="card"><h4>${t('우리 현장 이력')}</h4><p class="note">${t('과거 이력 중 동일 항목이 사용된 기록이 없습니다.')}</p></div>`;

  let aiCard = '';
  if (ai) {
    const fiveWhys = ai.fiveWhys || [];
    const whyChain = fiveWhys.length
      ? `<div class="card"><h4>${t('5-Why 근본원인 분석')}</h4>
          <ol class="five-why">${fiveWhys
            .map((w, i) => `<li><div class="why-q">Why ${i + 1}. ${esc(w.why)}</div><div class="why-a">→ ${esc(w.because)}</div></li>`)
            .join('')}</ol>
          ${ai.rootCause ? `<p class="hint" style="margin-top:10px"><b>${t('근본원인:')}</b> ${esc(ai.rootCause)}</p>` : ''}
        </div>`
      : '';

    aiCard = `
      <div class="card"><h4>${t('상세 설명')} ${ai._grounded === false ? `<span class="badge">${t('대체 웹검색')}</span>` : ''}</h4>
        <p>${esc(ai.detail || '')}</p>
        ${ai.mechanism ? `<p class="hint" style="margin-top:8px"><b>${t('원리:')}</b> ${esc(ai.mechanism)}</p>` : ''}
      </div>
      ${(ai.howTo || []).length ? `<div class="card"><h4>${t('실행 절차')}</h4><ol style="margin:0;padding-left:20px">${ai.howTo.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
      ${whyChain}
      ${(ai.pitfalls || []).length ? `<div class="card"><h4>${t('흔한 실수 · 주의사항')}</h4><ul style="margin:0;padding-left:20px">${ai.pitfalls.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${(ai.similarCases || []).length ? `<div class="card"><h4>${t('유사 산업 사례')}</h4><div class="candidates">${ai.similarCases.map((c) => `<div class="cand"><b>${esc(c.title)}</b><span>${esc(c.summary)}</span></div>`).join('')}</div></div>` : ''}
      ${(ai.sources || []).length ? `<div class="sources"><h5>${t('참고 출처 ')}${ai.sources.length}${t('건')}</h5>${ai.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>`).join('')}</div>` : ''}`;
  } else {
    aiCard = `<div class="card"><h4>${t('AI 상세 설명 · 5-Why · 유사 산업 사례')}</h4>
      <p class="note">${data.aiError ? esc(data.aiError) : t('AI가 꺼져 있어 제공되지 않습니다. [설정]에서 Gemini API 키를 등록하고 AI 판독을 켜면, 이 항목에 대한 5-Why 근본원인 분석과 실행 절차·유사 사례를 볼 수 있습니다.')}</p>
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
      return `<div class="bar-row"><div class="nm">${catLabel(cat)}</div>
        <div class="bar-track"><div class="bar-fill ${cat === 'Machine' || cat === 'Method' ? 'high' : ''}" style="width:${pct}%"></div></div>
        <div class="n">${pct}%</div></div>`;
    })
    .join('');

  return `
    <div class="verdict sev-${j.color === 'ok' ? 'low' : j.color || 'medium'}">
      <div class="v-head"><h2>${esc(j.label ? t(j.label) : t('판정 없음'))}</h2><span class="v-en">${t('리스크 점수 ')}${j.score != null ? j.score : '—'} / 100</span></div>
      <p class="v-desc">${esc(j.guidance ? t(j.guidance) : '')}</p>
      <div class="v-tags">
        <span class="tag ${j.processFault ? 'high' : 'proc'}">${j.processFault ? t('사내 공정 기인 가능성 높음') : t('공정 외부(') + esc(j.faultDomain || '') + t(') 기인 가능성')}</span>
        ${j.needsContainment ? `<span class="tag high">${t('로트 격리 필요')}</span>` : ''}
        ${j.escalate ? `<span class="tag high">${t('상위 보고 대상')}</span>` : ''}
      </div>
    </div>

    <div class="card">
      <h4>${t('판정 근거')}</h4>
      ${(j.reasons || []).length ? `<ul style="margin:0;padding-left:18px">${j.reasons.map((x) => `<li>${esc(t(x))}</li>`).join('')}</ul>` : `<p class="note">${t('특이 근거 없음')}</p>`}
    </div>

    <div class="card">
      <h4>${t('추정 원인 4M1E 분포')}</h4>
      ${mixRows ? `<div class="bars">${mixRows}</div>` : `<p class="note">${t('분류 정보가 없습니다.')}</p>`}
      ${j.dominantCause ? `<p class="hint" style="margin-top:10px">${t('주요 원인군: ')}<b>${esc(t(j.dominantCause.label))}</b> (${j.dominantCause.ratio}%) — ${esc(t(j.dominantCause.hint))}</p>` : ''}
    </div>

    <div class="card">
      <h4>${t('재발 이력')}</h4>
      <div class="row"><b>${t('최근 ')}${rec.days || 30}${t('일')}</b><span>${t('동일 불량 ')}${rec.count || 0}${t('건')}${rec.lastAt ? ` ${t('(최근 ')}${fmtDate(rec.lastAt)})` : ''}</span></div>
      <p class="hint">${(rec.count || 0) >= 3 ? t('반복 발생 — 산발 불량이 아니라 공정 고질 문제로 다루어야 합니다.') : t('반복 발생 기준(30일 3건) 미만입니다.')}</p>
    </div>

    <div class="card">
      <h4>${t('즉시 확인할 공정 파라미터')}</h4>
      ${(j.checkParams || []).length ? `<div class="kv">${j.checkParams.map((p) => `<span>${esc(p)}</span>`).join('')}</div>
        <p class="hint">${t('각 항목을 표준조건서 설정값과 실측값으로 대조하고, 최근 4M(사람·설비·재료·방법) 변경 이력을 확인하십시오.')}</p>`
        : `<p class="note">${t('공정이 확정되지 않아 점검 항목을 제시할 수 없습니다.')}</p>`}
    </div>

    <div class="card">
      <h4>${t('지금 바로 취할 조치 (TOP 3)')}</h4>
      ${(j.immediate || []).length ? `<ol style="margin:0;padding-left:20px">${j.immediate.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : `<p class="note">${t('항목 없음')}</p>`}
    </div>

    ${r.process && r.process.standards ? `<div class="card"><h4>${t('관련 규격 · 평가체계')}</h4>
      <div class="kv">${r.process.standards.map((x) => `<span>${esc(x)}</span>`).join('')}</div></div>` : ''}`;
}

function refHtml(r) {
  const v = r.vision;
  const cands = r.candidates || [];
  const web = r.web;

  const shots = (r.images || []).length
    ? `<div class="card"><h4>${t('업로드 사진')}</h4><div class="shots">${r.images
        .map((i) => `<a href="${i.url}" target="_blank"><img src="${i.url}" alt="${esc(i.name)}"></a>`)
        .join('')}</div></div>`
    : '';

  const vision = v
    ? `<div class="card"><h4>${t('AI 사진 판독')}</h4>
        <div class="row"><b>${t('관찰 사실')}</b><span>${esc(v.observation || '')}</span></div>
        <div class="row"><b>${t('공정 판단')}</b><span>${esc(v.processReason || '')}</span></div>
        <div class="row"><b>${t('확신도')}</b><span>${Math.round((v.confidence || 0) * 100)}%</span></div>
        ${(v.visualCues || []).length ? `<div class="row"><b>${t('관찰 특징')}</b><span>${v.visualCues.map(esc).join(' · ')}</span></div>` : ''}
        ${(v.checkPoints || []).length ? `<div class="row"><b>${t('추가 확인')}</b><span>${v.checkPoints.map(esc).join(' / ')}</span></div>` : ''}
        ${(v.candidates || []).length ? `<div class="candidates" style="margin-top:10px">${v.candidates
            .map((c) => `<div class="cand"><b>${esc(c.name)}</b><span>${Math.round((c.confidence || 0) * 100)}% · ${esc(c.reason)}</span></div>`)
            .join('')}</div>` : ''}
      </div>`
    : '';

  const kbCands = cands.length
    ? `<div class="card"><h4>${t('지식베이스 매칭 후보')}</h4><div class="candidates">${cands
        .map(
          (c) => `<div class="cand"><b>${esc(c.name)}</b><span>${esc(c.processName)} · ${t(sev(c.severity).ko)} · ${t('점수 ')}${c.score}</span></div>`
        )
        .join('')}</div>
        ${cands[0] && cands[0].reasons ? `<p class="hint">${t('1순위 매칭 근거: ')}${cands[0].reasons.map(esc).join(', ')}</p>` : ''}</div>`
    : '';

  const guesses = (r.processGuesses || []).length
    ? `<div class="card"><h4>${t('공정 자동 추정')}</h4><div class="candidates">${r.processGuesses
        .map((g) => `<div class="cand"><b>${esc(g.name)}</b><span>${t('점수 ')}${g.score}${g.hits ? ' · ' + g.hits.map(esc).join(', ') : ''}</span></div>`)
        .join('')}</div></div>`
    : '';

  const webCard = web
    ? `<div class="card"><h4>${t('인터넷 조사 요약')}</h4>
        <p>${esc(web.summary || '')}</p>
        ${web.mechanism ? `<p class="hint" style="margin-top:8px"><b>${t('발생 메커니즘:')}</b> ${esc(web.mechanism)}</p>` : ''}
        ${(web.sources || []).length ? `<div class="sources"><h5>${t('참고 자료 ')}${web.sources.length}${t('건')}</h5>${web.sources
            .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>`)
            .join('')}</div>` : ''}
      </div>`
    : `<div class="card"><h4>${t('인터넷 조사')}</h4><p class="note">${
        r.aiEnabled ? t('이번 분석에서는 인터넷 조사를 사용하지 않았습니다.') : t('API 키가 없어 인터넷 조사를 사용할 수 없습니다. [설정]에서 등록하면 최신 기술자료를 종합해 원인·조치·대책에 반영합니다.')
      }</p></div>`;

  const detect = r.defect && r.defect.detect
    ? `<div class="card"><h4>${t('이 불량의 검출 방법')}</h4><p>${esc(r.defect.detect)}</p></div>`
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
  if (!rows.length) return `<small>${t('데이터가 없습니다.')}</small>`;
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
      <div class="kpi"><b>${s.total}</b><small>${t('누적 분석 건수')}</small></div>
      <div class="kpi warn"><b>${s.open}</b><small>${t('미완료 (조치중·검증중)')}</small></div>
      <div class="kpi danger"><b>${s.critical}</b><small>${t('공정 이상 판정')}</small></div>
      <div class="kpi ok"><b>${s.last7d}</b><small>${t('최근 7일 신규')}</small></div>`;

    const tr = (s.trend || []).slice(-14);
    const max = Math.max(...tr.map((t2) => t2.count), 1);
    $('#spark').innerHTML = tr
      .map((t2) => `<i style="height:${Math.max(2, Math.round((t2.count / max) * 100))}%" title="${t2.date}: ${t2.count}${t('건')}"></i>`)
      .join('');
    $('#sparkX').innerHTML = tr.map((t2) => `<span>${t2.date.slice(8)}</span>`).join('');

    $('#barProc').innerHTML = barList(
      (s.byProcess || []).map((p) => ({ name: p.name, n: p.count, high: p.high })),
      null,
      (r) => (r.high > 0 ? 'high' : '')
    );

    const lv = s.byLevel || {};
    $('#barCat').innerHTML = barList(
      Object.entries(lv).map(([k, n]) => ({ name: t(LEVEL_KO[k] || k), n, key: k })),
      null,
      (r) => (r.key === 'critical' ? 'high' : r.key === 'warning' ? 'mid' : 'ok')
    );

    $('#barDefect').innerHTML = barList((s.topDefects || []).map((d) => ({ name: d.name, n: d.count })));
  } catch (e) {
    toast(t('통계를 불러오지 못했습니다: ') + e.message, true);
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
      tb.innerHTML = `<tr><td colspan="9"><small>${t('조건에 맞는 이력이 없습니다.')}</small></td></tr>`;
      return;
    }
    tb.innerHTML = res.items
      .map((r) => {
        const s = sev(r.severity);
        return `<tr class="hRow" data-id="${r.id}" tabindex="0" role="button" aria-label="${esc(t('결과 보기'))}">
          <td class="nowrap">${fmtDate(r.at)}<br><small>${esc(r.id)}</small></td>
          <td>${r.thumb ? `<a href="${r.thumb}" target="_blank"><img src="${r.thumb}" alt=""></a>` : ''}</td>
          <td>${esc(r.processName || '-')}</td>
          <td><b>${esc(r.defectName)}</b>${r.aiUsed ? ' <span class="badge ai">AI</span>' : ''}</td>
          <td><span class="tag ${s.cls}">${t(s.ko)}</span></td>
          <td>${r.judgeLevel ? `<span class="tag ${r.judgeLevel === 'critical' ? 'high' : r.judgeLevel === 'warning' ? 'medium' : 'low'}">${t(LEVEL_KO[r.judgeLevel])}</span>` : '-'}</td>
          <td>${r.judgeScore != null ? r.judgeScore : '-'}</td>
          <td><select class="hStatus" data-id="${r.id}">${['조치중', '검증중', '완료', '보류']
            .map((s2) => `<option value="${s2}"${s2 === r.status ? ' selected' : ''}>${t(s2)}</option>`)
            .join('')}</select></td>
          <td><button class="btn small hDel" data-id="${r.id}" style="margin:0;width:auto;padding:4px 9px">${t('삭제')}</button></td>
        </tr>`;
      })
      .join('');

    $$('tr.hRow', tb).forEach((tr) => {
      const go = () => openHistoryDetail(tr.dataset.id);
      tr.addEventListener('click', (e) => {
        if (e.target.closest('select, button, a')) return;
        go();
      });
      tr.addEventListener('keydown', (e) => {
        if (e.target.closest('select, button, a')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });

    $$('.hStatus', tb).forEach((sel) =>
      sel.addEventListener('change', async () => {
        try {
          await api('/api/history/' + sel.dataset.id, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: sel.value })
          });
          toast(t('상태를 변경했습니다.'));
          loadStats();
        } catch (e) {
          toast(e.message, true);
        }
      })
    );

    $$('.hDel', tb).forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm(t('이 이력을 삭제할까요?'))) return;
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
    toast(t('이력을 불러오지 못했습니다: ') + e.message, true);
  }
}

/** 이력 목록에서 한 건을 선택하면, 저장 당시의 원인·조치·대책·판정을 [분석 결과] 화면 그대로 다시 보여준다. */
async function openHistoryDetail(id) {
  try {
    const rec = await api('/api/history/' + id);
    const rep = rec.report || {};
    const pseudo = {
      recordId: rec.id,
      process: rep.process || null,
      defect: rep.defect || null,
      vision: rep.vision || null,
      web: rep.web || null,
      judgement: rep.judgement || null,
      candidates: rep.candidates || [],
      causes: rep.causes || [],
      actions: rep.actions || [],
      measures: rep.measures || [],
      warnings: [],
      processGuesses: [],
      images: (rec.images || []).map((url) => ({ url })),
      elapsedMs: rec.elapsedMs || 0,
      aiEnabled: state.boot.aiEnabled,
      usedAI: rec.aiUsed
    };
    state.result = pseudo;
    showView('analyze');
    renderResult(pseudo);
  } catch (e) {
    toast(t('이력을 불러오지 못했습니다: ') + e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 지식베이스 목록                                                       */
/* ------------------------------------------------------------------ */

async function renderKbList() {
  const box = $('#kbList');
  box.innerHTML = `<small>${t('불러오는 중…')}</small>`;
  try {
    const details = await Promise.all(state.processes.map((p) => api('/api/process/' + p.id)));
    box.innerHTML = details
      .map(
        (p) => `<details class="kb-proc">
          <summary>${p.icon} ${esc(LANG === 'en' && p.nameEn ? p.nameEn : p.name)} <small>${esc(p.nameEn)} · ${p.defects.length}${t('건')}</small></summary>
          ${p.defects
            .map(
              (d) => `<div class="kb-def">
                <b>${esc(LANG === 'en' && d.nameEn ? d.nameEn : d.name)} <span class="tag ${sev(d.severity).cls}">${t(sev(d.severity).ko)}</span></b>
                <p>${esc(d.description)}</p>
                ${(d.images || []).length ? `<div class="shots fb-shots">${d.images.map((u) => `<a href="${u}" target="_blank"><img src="${u}" alt=""></a>`).join('')}</div>` : ''}
                <button class="btn small kbGo" data-id="${d.id}" style="width:auto;padding:4px 10px;margin-top:6px">${t('이 불량의 원인·조치·대책 보기')}</button>
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
    box.innerHTML = `<small>${t('불러오지 못했습니다: ')}${esc(e.message)}</small>`;
  }
}

/* ------------------------------------------------------------------ */
/* 설정                                                                 */
/* ------------------------------------------------------------------ */

function applySettingsToForm() {
  const s = state.settings;
  if (!s) return;
  $('#cfgModel').innerHTML = s.models.map((m) => `<option value="${m.id}"${m.id === s.model ? ' selected' : ''}>${esc(t(m.name))}</option>`).join('');
  $('#cfgEffort').innerHTML = s.efforts.map((e) => `<option value="${e.id}"${e.id === s.effort ? ' selected' : ''}>${esc(t(e.name))}</option>`).join('');
  $('#cfgKey').value = '';
  $('#cfgKey').placeholder = s.hasApiKey ? s.apiKeyMasked + (s.keyFromEnv ? `  (${t('환경변수')})` : '') : 'AIzaSy...';
  $('#cfgKeysExtra').value = (s.apiKeysExtra || []).join('\n');
  $('#cfgKeyCountHint').textContent = `${t('현재 총 ')}${s.totalKeyCount || 0}${t('개 키가 등록되어 있습니다.')}`;
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
  $('#cfgSmtpPass').placeholder = s.hasSmtp ? s.smtpPassMasked + (s.smtpFromEnv ? `  (${t('환경변수')})` : '') : t('16자리 앱 비밀번호');
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
  body.apiKeysExtra = $('#cfgKeysExtra')
    .value.split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

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
    toast(t('설정을 저장했습니다.'));
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
  box.innerHTML = `<small>${t('불러오는 중…')}</small>`;
  try {
    const { users } = await api('/api/admin/users');
    renderUsers(users);
  } catch (e) {
    box.innerHTML = `<small>${t('불러오지 못했습니다: ')}${esc(e.message)}</small>`;
  }
}

function renderUsers(list) {
  const box = $('#usersBody');
  if (!list.length) {
    box.innerHTML = `<p class="note">${t('신청된 계정이 없습니다.')}</p>`;
    return;
  }
  const order = { pending: 0, approved: 1, rejected: 2 };
  const sorted = [...list].sort((a, b) => order[a.status] - order[b.status] || (a.requestedAt < b.requestedAt ? 1 : -1));

  box.innerHTML = `<table class="tbl">
    <thead><tr><th>${t('아이디')}</th><th>${t('소속·메모')}</th><th>${t('신청일시')}</th><th>${t('상태')}</th><th></th></tr></thead>
    <tbody>${sorted
      .map(
        (u) => `<tr data-id="${esc(u.id)}">
          <td><b>${esc(u.username)}</b></td>
          <td><small>${esc(u.note || '-')}</small></td>
          <td class="nowrap"><small>${fmtDate(u.requestedAt)}</small></td>
          <td><span class="tag ${u.status === 'approved' ? 'proc' : u.status === 'rejected' ? 'high' : 'medium'}">${t(USER_STATUS_KO[u.status])}</span></td>
          <td class="nowrap">
            ${u.status !== 'approved' ? `<button class="btn small uApprove" style="width:auto;padding:4px 9px;margin:0 4px 0 0">${t('승인')}</button>` : ''}
            ${u.status !== 'rejected' ? `<button class="btn small uReject" style="width:auto;padding:4px 9px;margin:0 4px 0 0">${t('거부')}</button>` : ''}
            <button class="btn small uDelete" style="width:auto;padding:4px 9px;margin:0">${t('삭제')}</button>
          </td>
        </tr>`
      )
      .join('')}</tbody>
  </table>`;

  $$('.uApprove', box).forEach((b) => b.addEventListener('click', (e) => decideUser(e.target.closest('tr').dataset.id, 'approved')));
  $$('.uReject', box).forEach((b) => b.addEventListener('click', (e) => decideUser(e.target.closest('tr').dataset.id, 'rejected')));
  $$('.uDelete', box).forEach((b) =>
    b.addEventListener('click', (e) => {
      if (confirm(t('이 계정 신청 기록을 삭제할까요?'))) deleteUser(e.target.closest('tr').dataset.id);
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
    toast(status === 'approved' ? t('승인했습니다.') : t('거부했습니다.'));
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
  else if (tab === 'activity') loadActivity();
  else loadFeedback();
}

async function loadActivity() {
  const box = $('#activityResults');
  box.innerHTML = `<small>${t('불러오는 중…')}</small>`;
  try {
    const q = new URLSearchParams();
    if ($('#fActUser').value) q.set('username', $('#fActUser').value);
    if ($('#fActAction').value) q.set('action', $('#fActAction').value);
    q.set('limit', '200');
    const { items, total } = await api('/api/admin/activity?' + q.toString());
    fillActivityUserFilter(items);
    renderActivity(items, total);
  } catch (e) {
    box.innerHTML = `<small>${t('불러오지 못했습니다: ')}${esc(e.message)}</small>`;
  }
}

function fillActivityUserFilter(items) {
  const sel = $('#fActUser');
  if (sel.dataset.filled) return;
  const names = [...new Set(items.map((x) => x.username).filter(Boolean))].sort();
  const cur = sel.value;
  sel.innerHTML = `<option value="">${t('전체 사용자')}</option>` + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = cur;
  if (names.length) sel.dataset.filled = '1';
}

function renderActivity(items, total) {
  const box = $('#activityResults');
  if (!items.length) {
    box.innerHTML = `<p class="note">${t('활동 이력이 없습니다.')}</p>`;
    return;
  }
  box.innerHTML = `<p class="note" style="margin-bottom:10px">${
    LANG === 'en' ? `Showing ${items.length} of ${total}` : `최근 ${items.length}건 (전체 ${total}건 중)`
  }</p>
    <table class="tbl">
      <thead><tr><th>${t('시각')}</th><th>${t('사용자')}</th><th>${t('활동')}</th><th>${t('내용')}</th></tr></thead>
      <tbody>${items
        .map(
          (x) => `<tr>
            <td class="nowrap"><small>${fmtDate(x.at)}</small></td>
            <td><b>${esc(x.username || '-')}</b>${x.role === 'admin' ? ` <span class="badge">${t('관리자')}</span>` : ''}</td>
            <td><span class="tag">${esc(t(ACTIVITY_ACTION_KO[x.action]) || x.action)}</span></td>
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
      <div class="upd-row"><b>${t('프로그램 버전')}</b><span>v${esc(s.appVersion)} (Node ${esc(s.nodeVersion)})</span></div>
      <div class="upd-row"><b>${t('지식베이스 버전')}</b><span>v${esc(s.kbVersion)}</span></div>
      <div class="upd-row"><b>${t('최종 갱신')}</b><span>${s.updatedAt ? fmtDate(s.updatedAt) : t('기본 내장')}</span></div>
      <div class="upd-row"><b>${t('수록 내용')}</b><span>${LANG === 'en' ? `${s.counts.processes} processes / ${s.counts.defects} defects` : `공정 ${s.counts.processes}종 / 불량 ${s.counts.defects}건`}</span></div>
      <div class="upd-row"><b>${t('업데이트 서버')}</b><span>${s.manifestUrl ? esc(s.manifestUrl) : `<i>${t('미설정')}</i>`}</span></div>
      <div class="upd-row"><b>${t('보관 백업')}</b><span>${s.backups}${LANG === 'en' ? '' : '개'}</span></div>
      ${extra || ''}
      ${!s.manifestUrl ? `<p class="note" style="margin-top:12px">${t('업데이트 서버가 설정되지 않았습니다. [설정]에서 매니페스트 URL을 등록하면 인터넷을 통해 지식베이스를 자동으로 갱신할 수 있습니다.')}</p>` : ''}`;
  } catch (e) {
    $('#updBody').innerHTML = `<p class="note">${esc(e.message)}</p>`;
  }
}

async function checkUpdate() {
  $('#updBody').innerHTML = `<div class="loading"><div class="spinner"></div><p>${t('업데이트 서버 확인 중…')}</p></div>`;
  try {
    const r = await api('/api/kb/check', { method: 'POST' });
    const box = r.updateAvailable
      ? `<p class="note" style="margin-top:12px;background:#e7f1ea;color:#16785a">
          ✅ ${LANG === 'en' ? `New version v${esc(r.latestVersion)} available (current v${esc(r.currentVersion)}) · ${r.fileCount} files` : `새 버전 v${esc(r.latestVersion)} 이 있습니다 (현재 v${esc(r.currentVersion)}) · 파일 ${r.fileCount}개`}<br>${esc(r.notes || '')}
         </p>`
      : `<p class="note" style="margin-top:12px">${t('최신 버전을 사용 중입니다')} (v${esc(r.currentVersion)}).</p>`;
    $('#btnUpdApply').disabled = !r.updateAvailable;
    await loadUpdateStatus(box);
  } catch (e) {
    await loadUpdateStatus(`<p class="note" style="margin-top:12px;background:#fdeceb;color:#c8322c">${esc(e.message)}</p>`);
  }
}

async function applyUpdate() {
  if (!confirm(t('지식베이스를 업데이트할까요? 기존 파일은 자동으로 백업됩니다.'))) return;
  $('#updBody').innerHTML = `<div class="loading"><div class="spinner"></div><p>${t('내려받아 검증하는 중…')}</p></div>`;
  try {
    const r = await api('/api/kb/apply', { method: 'POST' });
    toast(`${LANG === 'en' ? 'Update complete' : '업데이트 완료'}: v${r.fromVersion} → v${r.toVersion}`);
    $('#btnUpdApply').disabled = true;
    const boot = await api('/api/bootstrap');
    state.boot = boot;
    state.processes = boot.processes;
    $('#chipKb').textContent = `KB v${boot.kb.version.kbVersion} · ${t('불량')} ${boot.kb.counts.defects}${t('건')}`;
    renderProcGrid();
    fillProcFilter();
    renderKbList();
    await loadUpdateStatus(`<p class="note" style="margin-top:12px;background:#e7f1ea;color:#16785a">${
      LANG === 'en' ? `${r.files.length} files updated · backup ${esc(r.backupId)}` : `갱신 파일 ${r.files.length}개 · 백업 ${esc(r.backupId)}`
    }</p>`);
  } catch (e) {
    await loadUpdateStatus(`<p class="note" style="margin-top:12px;background:#fdeceb;color:#c8322c">${esc(e.message)}</p>`);
    toast(e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 판정 교정(학습 피드백) — 분석결과 화면                                 */
/* ------------------------------------------------------------------ */

async function submitFeedbackConfirm() {
  const r = state.result;
  if (!r || !r.recordId) {
    toast(t('저장된 이력이 없어 피드백을 남길 수 없습니다.'), true);
    return;
  }
  try {
    await api('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recordId: r.recordId,
        kind: 'confirm',
        processId: r.process ? r.process.id : null,
        processName: r.process ? r.process.name : '',
        originalDefectId: r.defect ? r.defect.id : null,
        originalDefectName: (r.defect && r.defect.name) || (r.vision && r.vision.defectName) || '',
        imageUrls: (r.images || []).map((i) => i.url)
      })
    });
    toast(t('감사합니다! 판정 확인이 기록되었습니다.'));
  } catch (e) {
    toast(e.message, true);
  }
}

function toggleFbKind() {
  const isNew = $('#fbKindNew').checked;
  $('#fbCorrectField').hidden = isNew;
  $('#fbNewField').hidden = !isNew;
}

async function openFeedbackCorrect() {
  const r = state.result;
  if (!r || !r.recordId) {
    toast(t('저장된 이력이 없어 피드백을 남길 수 없습니다.'), true);
    return;
  }
  openModal('mdFeedback');
  $('#fbNote').value = '';
  $('#fbNewName').value = '';
  $('#fbNewDesc').value = '';

  const procId = r.process ? r.process.id : null;
  $('#fbKindCorrect').disabled = !procId;
  if (!procId) $('#fbKindNew').checked = true;
  else $('#fbKindCorrect').checked = true;
  toggleFbKind();

  const sel = $('#fbDefectSelect');
  if (procId) {
    sel.innerHTML = `<option value="">${t('불러오는 중…')}</option>`;
    try {
      const p = await api('/api/process/' + procId);
      sel.innerHTML = p.defects.map((d) => `<option value="${d.id}" data-name="${esc(d.name)}">${esc(d.name)}</option>`).join('');
    } catch (e) {
      sel.innerHTML = `<option value="">${t('불러오지 못함')}</option>`;
    }
  } else {
    sel.innerHTML = `<option value="">${t('(공정 미판정 — 신규 불량으로 제안하세요)')}</option>`;
  }
}

async function submitFeedbackCorrection() {
  const r = state.result;
  const isNew = $('#fbKindNew').checked;
  const body = {
    recordId: r.recordId,
    kind: isNew ? 'new_defect' : 'correct',
    processId: r.process ? r.process.id : null,
    processName: r.process ? r.process.name : '',
    originalDefectId: r.defect ? r.defect.id : null,
    originalDefectName: (r.defect && r.defect.name) || (r.vision && r.vision.defectName) || '',
    note: $('#fbNote').value.trim(),
    visualCues: r.vision ? r.vision.visualCues || [] : [],
    imageUrls: (r.images || []).map((i) => i.url)
  };
  if (isNew) {
    const name = $('#fbNewName').value.trim();
    if (!name) {
      toast(t('신규 불량명을 입력하세요.'), true);
      return;
    }
    body.newDefectName = name;
    body.newDefectDescription = $('#fbNewDesc').value.trim();
  } else {
    const opt = $('#fbDefectSelect').selectedOptions[0];
    if (!opt || !opt.value) {
      toast(t('실제 불량을 선택하세요.'), true);
      return;
    }
    body.correctedDefectId = opt.value;
    body.correctedDefectName = opt.dataset.name;
  }
  try {
    await api('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    toast(t('감사합니다! 관리자 확인 후 학습에 반영됩니다.'));
    closeModal('mdFeedback');
  } catch (e) {
    toast(e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 학습 피드백 검토 (관리자 전용)                                        */
/* ------------------------------------------------------------------ */

const FB_KIND_KO = { confirm: '[확인]', correct: '[수정]', new_defect: '[신규 제안]' };
const FB_STATUS_KO = { pending: '검토 대기', confirmed: '확정됨', rejected: '거부됨' };

async function refreshFbPendingCount() {
  try {
    const { items } = await api('/api/admin/feedback?status=pending');
    const badge = $('#cntFbPending');
    badge.hidden = items.length === 0;
    badge.textContent = items.length;
  } catch (e) {
    /* 관리자가 아니면 조용히 무시 */
  }
}

async function loadFeedback() {
  const box = $('#feedbackResults');
  box.innerHTML = `<small>${t('불러오는 중…')}</small>`;
  try {
    const { items, total } = await api('/api/admin/feedback?limit=200');
    renderFeedback(items, total);
  } catch (e) {
    box.innerHTML = `<small>${t('불러오지 못했습니다: ')}${esc(e.message)}</small>`;
  }
}

function renderFeedback(items, total) {
  const box = $('#feedbackResults');
  if (!items.length) {
    box.innerHTML = `<p class="note">${t('피드백이 없습니다.')}</p>`;
    return;
  }
  const order = { pending: 0, confirmed: 1, rejected: 2 };
  const sorted = [...items].sort((a, b) => order[a.status] - order[b.status] || (a.at < b.at ? 1 : -1));

  box.innerHTML = `<div class="item-list">${sorted
    .map((x) => {
      const target = x.kind === 'new_defect' ? x.newDefectName : x.kind === 'correct' ? x.correctedDefectName : t('(확인만)');
      return `<div class="item" data-id="${esc(x.id)}" style="align-items:flex-start">
        <div class="item-main">
          <div class="item-text">${t(FB_KIND_KO[x.kind])} ${esc(x.originalDefectName || '?')} → ${esc(target)}</div>
          <div class="item-sub">${esc(x.submittedBy)} · ${esc(x.processName || '-')} · ${fmtDate(x.at)}${x.note ? ' · ' + t('메모: ') + esc(x.note) : ''}</div>
          ${(x.imageUrls || []).length ? `<div class="shots fb-shots">${x.imageUrls.map((u) => `<a href="${u}" target="_blank"><img src="${u}" alt=""></a>`).join('')}</div>` : ''}
          <div class="item-meta">
            <span class="tag ${x.status === 'confirmed' ? 'proc' : x.status === 'rejected' ? 'high' : 'medium'}">${t(FB_STATUS_KO[x.status])}</span>
            ${x.addedToKb ? `<span class="badge ai">${t('KB 등록됨')}</span>` : ''}
          </div>
        </div>
        <div class="nowrap" style="display:flex;flex-direction:column;gap:4px">
          ${x.status !== 'confirmed' ? `<button class="btn small fbConfirm" style="width:auto;padding:4px 9px">${t('확정')}</button>` : ''}
          ${x.status !== 'rejected' ? `<button class="btn small fbReject" style="width:auto;padding:4px 9px">${t('거부')}</button>` : ''}
          ${x.kind === 'new_defect' && !x.addedToKb ? `<button class="btn small primary fbAddKb" style="width:auto;padding:4px 9px">${t('KB 등록')}</button>` : ''}
        </div>
      </div>`;
    })
    .join('')}</div>
    <p class="note" style="margin-top:10px">${LANG === 'en' ? `Showing ${items.length} of ${total}` : `최근 ${items.length}건 (전체 ${total}건 중)`}</p>`;

  $$('.fbConfirm', box).forEach((b) => b.addEventListener('click', (e) => decideFeedback(e.target.closest('[data-id]').dataset.id, 'confirmed')));
  $$('.fbReject', box).forEach((b) => b.addEventListener('click', (e) => decideFeedback(e.target.closest('[data-id]').dataset.id, 'rejected')));
  $$('.fbAddKb', box).forEach((b) => b.addEventListener('click', (e) => openKbAdd(e.target.closest('[data-id]').dataset.id, items)));
}

async function decideFeedback(id, status) {
  try {
    await api(`/api/admin/feedback/${id}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status })
    });
    toast(status === 'confirmed' ? t('확정했습니다.') : t('거부했습니다.'));
    loadFeedback();
    refreshFbPendingCount();
  } catch (e) {
    toast(e.message, true);
  }
}

let kbAddFeedbackId = null;

function openKbAdd(id, items) {
  const rec = items.find((x) => x.id === id);
  if (!rec) return;
  kbAddFeedbackId = id;
  closeModal('mdUsers');
  openModal('mdKbAdd');
  $('#kaProcess').innerHTML = state.processes.map((p) => `<option value="${p.id}"${p.id === rec.processId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#kaSeverity').value = 'medium';
  $('#kaName').value = rec.newDefectName || '';
  $('#kaNameEn').value = '';
  $('#kaDesc').value = rec.newDefectDescription || '';
  $('#kaKeywords').value = '';
  $('#kaCues').value = (rec.visualCues || []).join(', ');
  $('#kaDetect').value = '';
  $('#kaCauses').value = '';
  $('#kaActions').value = '';
  $('#kaMeasures').value = '';
}

async function submitKbAdd() {
  if (!kbAddFeedbackId) return;
  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const name = $('#kaName').value.trim();
  if (!name) {
    toast(t('불량명을 입력하세요.'), true);
    return;
  }
  const body = {
    process: $('#kaProcess').value,
    name,
    nameEn: $('#kaNameEn').value.trim(),
    severity: $('#kaSeverity').value,
    description: $('#kaDesc').value.trim(),
    keywords: csv($('#kaKeywords').value),
    visualCues: csv($('#kaCues').value),
    detect: $('#kaDetect').value.trim(),
    causes: lines($('#kaCauses').value).map((text) => ({ text, cat: 'Method' })),
    actions: lines($('#kaActions').value).map((text) => ({ text })),
    measures: lines($('#kaMeasures').value).map((text) => ({ text }))
  };
  try {
    await api(`/api/admin/feedback/${kbAddFeedbackId}/add-to-kb`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    toast(t('지식베이스에 추가했습니다.'));
    closeModal('mdKbAdd');
    kbAddFeedbackId = null;
    const boot = await api('/api/bootstrap');
    state.boot = boot;
    state.processes = boot.processes;
    $('#chipKb').textContent = `KB v${boot.kb.version.kbVersion} · ${t('불량')} ${boot.kb.counts.defects}${t('건')}`;
    renderProcGrid();
    fillProcFilter();
    renderKbList();
    openModal('mdUsers');
    switchUsersTab('feedback');
  } catch (e) {
    toast(e.message, true);
  }
}

/* ------------------------------------------------------------------ */
/* 모달 · 이벤트                                                        */
/* ------------------------------------------------------------------ */

const openModal = (id) => ($(`#${id}`).hidden = false);
const closeModal = (id) => ($(`#${id}`).hidden = true);

function bindStaticEvents() {
  $('#btnLang').addEventListener('click', () => setLang(LANG === 'en' ? 'ko' : 'en'));
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
  $('#btnUsersRefresh').addEventListener('click', () => {
    if (usersTab === 'signup') loadUsers();
    else if (usersTab === 'activity') loadActivity();
    else loadFeedback();
  });
  $('#fbKindCorrect').addEventListener('change', toggleFbKind);
  $('#fbKindNew').addEventListener('change', toggleFbKind);
  $('#btnFbSubmit').addEventListener('click', submitFeedbackCorrection);
  $('#btnKaSubmit').addEventListener('click', submitKbAdd);
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
