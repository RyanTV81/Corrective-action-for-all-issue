#!/usr/bin/env bash
# Google Cloud Always-Free VM(e2-micro, Debian 12) 1회 설치 스크립트.
#
# 사용법 (VM에 SSH로 접속한 뒤):
#   curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/master/deploy/setup.sh -o setup.sh
#   sudo bash setup.sh https://github.com/<user>/<repo>.git
#
# 또는 이미 저장소를 받아둔 상태라면 그 안에서: sudo bash deploy/setup.sh <git-repo-url>
#
# 하는 일:
#   - Node.js 20, Caddy(자동 HTTPS 리버스 프록시) 설치
#   - git 저장소를 /opt/qc-dashboard 에 clone (이후 deploy/auto-update.sh 가 git pull 로 최신 유지)
#   - 지식베이스(kb/) 는 git 추적 대상이 아니므로 최초 1회만 deploy/kb-seed 에서 복사
#   - 전용 시스템 계정(qcapp)으로 구동, 로그인 비밀번호를 물어보고 .env 에 저장
#   - systemd 서비스 등록(재부팅·비정상종료 시 자동 재시작)
#   - 5분마다 git 새 커밋을 확인해 자동 반영하는 타이머 등록
#   - VM의 외부 IP 기반 sslip.io 도메인으로 무료 HTTPS 인증서 자동 발급
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "root 권한이 필요합니다: sudo bash deploy/setup.sh <git-repo-url>" >&2
  exit 1
fi

REPO_URL="${1:-}"
APP_DIR="/opt/qc-dashboard"
SERVICE_USER="qcapp"

if [ -z "$REPO_URL" ] && [ ! -d "$APP_DIR/.git" ]; then
  echo "git 저장소 URL이 필요합니다: sudo bash deploy/setup.sh https://github.com/<user>/<repo>.git" >&2
  exit 1
fi

echo "==> [1/7] 패키지 목록 갱신"
apt-get update -y
apt-get install -y curl git gnupg

echo "==> [2/7] Node.js 20 설치 확인"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "    이미 설치됨: $(node -v)"
fi

echo "==> [3/7] Caddy(자동 HTTPS) 설치 확인"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
else
  echo "    이미 설치됨: $(caddy version)"
fi

echo "==> [4/7] 앱 배치 ($APP_DIR)"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"

if [ -d "$APP_DIR/.git" ]; then
  echo "    이미 git 저장소가 있습니다 — 최신으로 갱신합니다."
  git config --global --add safe.directory "$APP_DIR"
  git -C "$APP_DIR" fetch --quiet origin
  git -C "$APP_DIR" reset --hard --quiet "$(git -C "$APP_DIR" rev-parse origin/HEAD 2>/dev/null || git -C "$APP_DIR" rev-parse origin/master)"
elif [ -d "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  echo "    기존(구버전 tar 업로드 방식) 설치가 있습니다 — git 저장소로 전환합니다."
  echo "    (data/ · kb/ · .env 는 그대로 보존됩니다)"
  BACKUP_DIR="${APP_DIR}.bak-$(date +%s)"
  mv "$APP_DIR" "$BACKUP_DIR"
  git clone --quiet "$REPO_URL" "$APP_DIR"
  git config --global --add safe.directory "$APP_DIR"
  for d in data kb; do
    if [ -d "$BACKUP_DIR/$d" ]; then
      rm -rf "$APP_DIR/$d"
      cp -r "$BACKUP_DIR/$d" "$APP_DIR/$d"
    fi
  done
  [ -f "$BACKUP_DIR/.env" ] && cp "$BACKUP_DIR/.env" "$APP_DIR/.env"
  echo "    이전 설치는 백업으로 남겨두었습니다: $BACKUP_DIR (문제 없으면 나중에 삭제하셔도 됩니다)"
else
  mkdir -p "$APP_DIR"
  git clone --quiet "$REPO_URL" "$APP_DIR"
  git config --global --add safe.directory "$APP_DIR"
fi

cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

if [ ! -d "$APP_DIR/kb" ] || [ -z "$(ls -A "$APP_DIR/kb" 2>/dev/null)" ]; then
  echo "    지식베이스 최초 배치 (deploy/kb-seed → kb/)"
  mkdir -p "$APP_DIR/kb"
  cp -r "$APP_DIR/deploy/kb-seed/"* "$APP_DIR/kb/"
fi
mkdir -p "$APP_DIR/data/uploads"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

echo "==> [5/7] 로그인 비밀번호 설정"
ENV_FILE="$APP_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  echo "    기존 $ENV_FILE 를 유지합니다 (비밀번호를 바꾸려면 이 파일을 직접 수정하세요)."
else
  read -r -p "    대시보드 로그인 아이디 [admin]: " DASH_USER_INPUT
  DASH_USER_INPUT=${DASH_USER_INPUT:-admin}
  read -r -s -p "    대시보드 로그인 비밀번호 (직접 입력, 8자 이상 권장): " DASH_PASS_INPUT
  echo
  if [ -z "$DASH_PASS_INPUT" ]; then
    DASH_PASS_INPUT=$(node -e "console.log(require('crypto').randomBytes(9).toString('base64url'))")
    echo "    비밀번호를 입력하지 않아 임의로 생성했습니다: $DASH_PASS_INPUT"
  fi
  cat > "$ENV_FILE" <<EOF
PORT=3000
NODE_ENV=production
DASH_USER=$DASH_USER_INPUT
DASH_PASSWORD=$DASH_PASS_INPUT
EOF
  chmod 600 "$ENV_FILE"
  chown "$SERVICE_USER":"$SERVICE_USER" "$ENV_FILE"
fi

cat > /etc/systemd/system/qc-dashboard.service <<EOF
[Unit]
Description=QC Defect Analysis Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) server.js
EnvironmentFile=$ENV_FILE
Restart=always
RestartSec=5
User=$SERVICE_USER
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR/data $APP_DIR/kb

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now qc-dashboard

echo "==> [6/7] 자동 업데이트 타이머 등록 (5분마다 git 새 버전 확인)"
cp "$APP_DIR/deploy/qc-autoupdate.service" /etc/systemd/system/qc-autoupdate.service
cp "$APP_DIR/deploy/qc-autoupdate.timer" /etc/systemd/system/qc-autoupdate.timer
systemctl daemon-reload
systemctl enable --now qc-autoupdate.timer

echo "==> [7/7] Caddy 리버스 프록시 + 자동 HTTPS 설정"
EXT_IP=$(curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip")
DOMAIN="${EXT_IP//./-}.sslip.io"

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	reverse_proxy localhost:3000
}
EOF

systemctl enable --now caddy
systemctl restart caddy

echo ""
echo "======================================================"
echo " 설치 완료"
echo "   접속 주소: https://$DOMAIN"
echo "   (인증서 발급까지 1~2분 정도 걸릴 수 있습니다)"
echo " 상태 확인:      systemctl status qc-dashboard"
echo " 로그 확인:      journalctl -u qc-dashboard -f"
echo " 자동업데이트 로그: journalctl -u qc-autoupdate -f"
echo " 지금 바로 업데이트 확인: sudo systemctl start qc-autoupdate"
echo "======================================================"
