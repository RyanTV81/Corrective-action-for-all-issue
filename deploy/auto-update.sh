#!/usr/bin/env bash
# systemd 타이머가 주기적으로 실행한다 (deploy/qc-autoupdate.timer 참고).
# git 원격에 새 커밋이 있으면 받아서 npm install → 서비스 재시작까지 자동으로 한다.
# data/ 와 kb/ 는 git 추적 대상이 아니므로 git reset --hard 에도 영향받지 않는다.
set -euo pipefail

APP_DIR="/opt/qc-dashboard"
SERVICE_USER="qcapp"
LOG_TAG="[qc-autoupdate]"

cd "$APP_DIR"

BEFORE=$(git rev-parse HEAD)
git fetch --quiet origin
AFTER_REMOTE=$(git rev-parse origin/HEAD 2>/dev/null || git rev-parse origin/master)

if [ "$BEFORE" = "$AFTER_REMOTE" ]; then
  exit 0  # 새 버전 없음 — 조용히 종료
fi

echo "$LOG_TAG 새 버전 감지: ${BEFORE:0:7} -> ${AFTER_REMOTE:0:7}"
git reset --hard "$AFTER_REMOTE" --quiet

if git diff --name-only "$BEFORE" "$AFTER_REMOTE" | grep -qE '^package(-lock)?\.json$'; then
  echo "$LOG_TAG package.json 변경 감지 — npm install 실행"
  npm install --omit=dev --no-audit --no-fund
fi

chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"
chmod 700 "$APP_DIR/data" 2>/dev/null || true  # API 키·계정 정보가 든 폴더 권한 유지
systemctl restart qc-dashboard
echo "$LOG_TAG 적용 및 재시작 완료 (커밋 ${AFTER_REMOTE:0:7})"
