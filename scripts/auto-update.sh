#!/usr/bin/env bash
# ============================================================================
#  به‌روزرسانی خودکار سایت از روی گیت‌هاب
#
#  این اسکریپت را یک تایمر systemd هر چند دقیقه یک‌بار اجرا می‌کند. کارش:
#    ۱) نگاه می‌کند روی گیت‌هاب نسخه‌ی جدیدی هست یا نه
#    ۲) اگر نبود، بی‌سروصدا تمام می‌شود (هیچ ری‌استارتی نمی‌دهد)
#    ۳) اگر بود: کد را می‌گیرد، وابستگی‌ها را نصب می‌کند، سرویس را ری‌استارت
#       می‌کند و بعد سلامت سایت را چک می‌کند
#    ۴) اگر سایت بعد از به‌روزرسانی بالا نیامد، **خودکار به نسخه‌ی قبلی
#       برمی‌گردد** تا سایت مشتری هیچ‌وقت خراب نماند
#
#  یعنی برای تغییر سایت کافی است کد روی گیت‌هاب عوض شود؛ سرور خودش
#  چند دقیقه بعد آن را برمی‌دارد.
#
#  اجرای دستی (بدون منتظر ماندن برای تایمر):  bash scripts/auto-update.sh
#  خاموش‌کردن به‌روزرسانی خودکار: systemctl disable --now fooladiman-update.timer
# ============================================================================
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

SERVICE="${SERVICE_NAME:-fooladiman}"
LOG_DIR="$APP_DIR/logs"
LOG="$LOG_DIR/auto-update.log"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG"; }

# پورت را از .env می‌خوانیم تا بررسی سلامت به آدرس درست بزند
PORT="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-3000}"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || { log "این پوشه مخزن گیت نیست"; exit 0; }

# اگر شبکه قطع بود، فقط رد شو — دفعه‌ی بعد دوباره امتحان می‌شود
if ! git fetch --quiet origin "$BRANCH" 2>>"$LOG"; then
  log "گرفتن تغییرات از گیت‌هاب ناموفق بود (شبکه؟) — این دور رد شد"
  exit 0
fi

OLD="$(git rev-parse HEAD)"
NEW="$(git rev-parse "origin/$BRANCH")"

# چیزی عوض نشده: بدون هیچ کاری تمام. سایت ری‌استارت نمی‌شود.
[ "$OLD" = "$NEW" ] && exit 0

log "نسخه‌ی جدید پیدا شد: ${OLD:0:8} → ${NEW:0:8} (شاخه‌ی $BRANCH)"

# نکته: reset --hard فقط فایل‌های تحت گیت را عوض می‌کند. دیتابیس (data/) و
# عکس‌های آپلودی مدیر (public/uploads/) در .gitignore هستند، پس دست‌نخورده
# می‌مانند — همین دلیل مهمِ gitignore بودنشان است.
if ! git reset --hard "$NEW" >>"$LOG" 2>&1; then
  log "❌ اعمال نسخه‌ی جدید ناموفق بود"
  exit 1
fi

npm ci --omit=dev >>"$LOG" 2>&1 || npm install --omit=dev >>"$LOG" 2>&1

# مالکیت فایل‌ها به کاربر سرویس برگردد (این اسکریپت با root اجرا می‌شود)
APP_USER="$(stat -c '%U' "$APP_DIR/package.json" 2>/dev/null || echo root)"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" 2>/dev/null || true

systemctl restart "$SERVICE"

# به سرویس فرصت بالا آمدن بدهیم، بعد سلامتش را بسنجیم
healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    healthy=1
    break
  fi
done

if [ "$healthy" = "1" ]; then
  log "✅ به‌روزرسانی موفق — سایت سالم است (${NEW:0:8})"
  exit 0
fi

# --------------------------------------------------------------- بازگشت خودکار
log "⚠️ سایت بعد از به‌روزرسانی بالا نیامد — بازگشت به نسخه‌ی قبلی ${OLD:0:8}"
git reset --hard "$OLD" >>"$LOG" 2>&1
npm ci --omit=dev >>"$LOG" 2>&1 || npm install --omit=dev >>"$LOG" 2>&1
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" 2>/dev/null || true
systemctl restart "$SERVICE"

sleep 4
if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
  log "↩️ بازگشت انجام شد — سایت با نسخه‌ی قبلی سالم بالا آمد"
else
  log "❌ سایت حتی با نسخه‌ی قبلی هم بالا نیامد — نیاز به بررسی دستی: journalctl -u $SERVICE -n 50"
fi
exit 1
