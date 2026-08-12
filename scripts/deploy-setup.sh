#!/usr/bin/env bash
# ============================================================================
#  نصب خودکار سایت فولاد ایمان روی سرور اوبونتو (VPS)
#
#  استفاده — روی سرور تازه، به‌عنوان root:
#      bash scripts/deploy-setup.sh fooladiman.ir
#
#  این اسکریپت انجام می‌دهد:
#    ۱) نصب Node.js 20 و nginx و certbot
#    ۲) نصب وابستگی‌های پروژه و ساخت فایل .env با کلید تصادفی
#    ۳) راه‌اندازی سرویس systemd تا سایت همیشه روشن بماند
#    ۴) تنظیم nginx به‌عنوان واسط و گرفتن گواهی HTTPS رایگان
#    ۵) تنظیم پشتیبان‌گیری خودکار شبانه
# ============================================================================
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "استفاده: bash scripts/deploy-setup.sh دامنه-شما.ir"; exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${SUDO_USER:-$USER}"
PORT=3000

echo "▸ نصب پیش‌نیازها…"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg sqlite3 nginx >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "  Node: $(node -v)"

echo "▸ نصب وابستگی‌های پروژه…"
cd "$APP_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

echo "▸ ساخت فایل تنظیمات…"
if [ ! -f .env ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env <<ENV
PORT=$PORT
NODE_ENV=production
SITE_URL=https://$DOMAIN
SESSION_SECRET=$SECRET
ENV
  echo "  .env ساخته شد (کلید امنیتی تصادفی)"
else
  echo "  .env از قبل وجود دارد — دست نخورد"
fi
mkdir -p data public/uploads backups
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "▸ ساخت سرویس systemd…"
cat > /etc/systemd/system/fooladiman.service <<SVC
[Unit]
Description=Foolad Iman website
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/cluster.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=append:$APP_DIR/logs/app.log
StandardError=append:$APP_DIR/logs/error.log

[Install]
WantedBy=multi-user.target
SVC
mkdir -p "$APP_DIR/logs"; chown -R "$APP_USER":"$APP_USER" "$APP_DIR/logs"
systemctl daemon-reload
systemctl enable --now fooladiman
sleep 3
systemctl is-active --quiet fooladiman && echo "  سرویس روشن است ✓" || { echo "  ✗ سرویس بالا نیامد"; journalctl -u fooladiman -n 30 --no-pager; exit 1; }

echo "▸ تنظیم nginx…"
cat > /etc/nginx/sites-available/fooladiman <<NGX
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    client_max_body_size 20M;      # برای آپلود عکس‌های بزرگ
    gzip on;
    gzip_types text/css application/javascript image/svg+xml application/json;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # فایل‌های ثابت با کش طولانی
    location ~* \.(webp|svg|woff2|jpg|png|css|js)\$ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        expires 30d;
        add_header Cache-Control "public";
    }
}
NGX
ln -sf /etc/nginx/sites-available/fooladiman /etc/nginx/sites-enabled/fooladiman
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "  nginx تنظیم شد ✓"

echo "▸ گرفتن گواهی HTTPS…"
apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos \
        --register-unsafely-without-email --redirect || \
  echo "  ⚠ certbot موفق نشد — احتمالاً دامنه هنوز به این سرور اشاره نمی‌کند. بعداً دستی اجرا کنید:
     certbot --nginx -d $DOMAIN -d www.$DOMAIN"

echo "▸ پشتیبان‌گیری خودکار شبانه…"
CRON="0 3 * * * cd $APP_DIR && bash scripts/backup.sh >> logs/backup.log 2>&1"
( crontab -u "$APP_USER" -l 2>/dev/null | grep -v 'scripts/backup.sh' ; echo "$CRON" ) | crontab -u "$APP_USER" -

echo
echo "════════════════════════════════════════════"
echo " ✅ نصب تمام شد"
echo "   سایت:        https://$DOMAIN"
echo "   پنل مدیریت:  https://$DOMAIN/admin"
echo "   کاربر پیش‌فرض: admin / foolad1234"
echo "   ⚠️  در اولین ورود، سایت رمز را از شما عوض می‌کند."
echo
echo " دستورهای مفید:"
echo "   systemctl status fooladiman     وضعیت سایت"
echo "   systemctl restart fooladiman    ری‌استارت"
echo "   journalctl -u fooladiman -f     دیدن لاگ زنده"
echo "   curl localhost:$PORT/healthz    بررسی سلامت"
echo "════════════════════════════════════════════"
