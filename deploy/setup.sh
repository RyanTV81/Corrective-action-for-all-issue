#!/usr/bin/env bash
# Google Cloud Always-Free VM(e2-micro, Debian 12) 1회 설치 스크립트.
#
# 사용법:
#   1) 이 프로젝트 폴더를 zip으로 압축해 VM에 업로드하고 압축을 푼다.
#   2) 압축 푼 폴더 안에서 실행: sudo bash deploy/setup.sh
#
# 하는 일:
#   - Node.js 20, Caddy(자동 HTTPS 리버스 프록시) 설치
#   - 앱을 /opt/qc-dashboard 에 배치하고 전용 시스템 계정(qcapp)으로 구동
#   - 로그인 비밀번호를 물어보고 .env 에 저장
#   - systemd 서비스 등록(재부팅·비정상종료 시 자동 재시작)
#   - VM의 외부 IP 기반 sslip.io 도메인으로 무료 HTTPS 인증서 자동 발급
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "root 권한이 필요합니다: sudo bash deploy/setup.sh" >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="/opt/qc-dashboard"
SERVICE_USER="qcapp"

echo "==> [1/6] 패키지 목록 갱신"
apt-get update -y
apt-get install -y curl rsync gnupg

echo "==> [2/6] Node.js 20 설치 확인"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "    이미 설치됨: $(node -v)"
fi

echo "==> [3/6] Caddy(자동 HTTPS) 설치 확인"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
else
  echo "    이미 설치됨: $(caddy version)"
fi

echo "==> [4/6] 앱 파일 배치 ($APP_DIR)"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude data --exclude .git --exclude .env "$SRC_DIR"/ "$APP_DIR"/
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund
mkdir -p "$APP_DIR/data/uploads"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

echo "==> [5/6] 로그인 비밀번호 설정"
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

echo "==> [6/6] Caddy 리버스 프록시 + 자동 HTTPS 설정"
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
echo " 상태 확인:  systemctl status qc-dashboard"
echo " 로그 확인:  journalctl -u qc-dashboard -f"
echo "======================================================"
