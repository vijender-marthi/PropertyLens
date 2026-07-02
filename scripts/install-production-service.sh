#!/usr/bin/env bash
# Install/update PropertyLens as a systemd service on an Ubuntu droplet.
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-propertylens}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_USER="${APP_USER:-${SUDO_USER:-$(id -un)}}"
APP_GROUP="${APP_GROUP:-$(id -gn "$APP_USER")}"
PROPERTYLENS_HOST="${PROPERTYLENS_HOST:-127.0.0.1}"
PROPERTYLENS_PORT="${PROPERTYLENS_PORT:-8100}"
DB_DIR="${DB_DIR:-/var/lib/propertylens}"
PROPERTYLENS_DB_PATH="${PROPERTYLENS_DB_PATH:-$DB_DIR/propertylens.db}"
ENV_FILE="${ENV_FILE:-/etc/propertylens.env}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

echo "Installing PropertyLens from $APP_DIR"
echo "Service: $SERVICE_NAME"
echo "User: $APP_USER"
echo "Port: $PROPERTYLENS_PORT"
echo "Database: $PROPERTYLENS_DB_PATH"

apt-get update
apt-get install -y \
  git \
  nginx \
  nodejs \
  npm \
  python3 \
  python3-pip \
  python3-venv \
  tesseract-ocr

mkdir -p "$DB_DIR" "$APP_DIR/backend/uploads"
chown -R "$APP_USER:$APP_GROUP" "$DB_DIR" "$APP_DIR/backend/uploads"

if [ ! -f "$ENV_FILE" ]; then
  SECRET="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
PROPERTYLENS_DB_PATH=$PROPERTYLENS_DB_PATH
PROPERTYLENS_SECRET_KEY=$SECRET
PROPERTYLENS_HOST=$PROPERTYLENS_HOST
PROPERTYLENS_PORT=$PROPERTYLENS_PORT
EOF
  chmod 600 "$ENV_FILE"
else
  if ! grep -q '^PROPERTYLENS_DB_PATH=' "$ENV_FILE"; then
    echo "PROPERTYLENS_DB_PATH=$PROPERTYLENS_DB_PATH" >> "$ENV_FILE"
  fi
  if ! grep -q '^PROPERTYLENS_SECRET_KEY=' "$ENV_FILE"; then
    echo "PROPERTYLENS_SECRET_KEY=$(openssl rand -hex 32)" >> "$ENV_FILE"
  fi
  if ! grep -q '^PROPERTYLENS_HOST=' "$ENV_FILE"; then
    echo "PROPERTYLENS_HOST=$PROPERTYLENS_HOST" >> "$ENV_FILE"
  fi
  if ! grep -q '^PROPERTYLENS_PORT=' "$ENV_FILE"; then
    echo "PROPERTYLENS_PORT=$PROPERTYLENS_PORT" >> "$ENV_FILE"
  fi
fi

cd "$APP_DIR/frontend"
npm install
npm run build

cd "$APP_DIR/backend"
if [ ! -d venv ]; then
  python3 -m venv venv
fi
"$APP_DIR/backend/venv/bin/pip" install -r requirements.txt

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=PropertyLens FastAPI App
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/start.prod.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo ""
echo "PropertyLens service installed and started."
systemctl status "$SERVICE_NAME" --no-pager

echo ""
echo "Waiting for PropertyLens health check..."
for attempt in $(seq 1 30); do
  if curl -fsS "http://${PROPERTYLENS_HOST}:${PROPERTYLENS_PORT}/api/health" >/dev/null; then
    echo "PropertyLens is healthy on http://${PROPERTYLENS_HOST}:${PROPERTYLENS_PORT}"
    exit 0
  fi
  sleep 2
done

echo "PropertyLens did not become healthy on http://${PROPERTYLENS_HOST}:${PROPERTYLENS_PORT}" >&2
journalctl -u "$SERVICE_NAME" -n 80 --no-pager >&2 || true
exit 1
