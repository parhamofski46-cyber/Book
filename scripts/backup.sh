#!/usr/bin/env bash
# ============================================================
#  پشتیبان‌گیری از سایت فولاد ایمان
#  استفاده:  bash scripts/backup.sh [پوشه‌ی مقصد]
#  پیش‌فرض مقصد: ./backups
#
#  فقط دو چیز ارزش پشتیبان‌گیری دارد:
#    data/shop.db      همه‌ی محصولات، دسته‌ها، نظرات و تنظیمات
#    public/uploads/   عکس‌هایی که از پنل آپلود شده‌اند
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:-./backups}"
mkdir -p "$DEST"
STAMP=$(date +%Y-%m-%d_%H%M)
FILE="$DEST/fooladiman-$STAMP.tar.gz"

# دیتابیس در حالت WAL است؛ با دستور .backup یک کپی سالم می‌گیریم
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 data/shop.db ".backup '/tmp/shop-backup.db'"
  SRC_DB=/tmp/shop-backup.db
else
  SRC_DB=data/shop.db   # اگر sqlite3 نصب نیست، کپی مستقیم
fi

tar -czf "$FILE" -C . public/uploads --transform 's|^|fooladiman/|' 2>/dev/null || \
  tar -czf "$FILE" public/uploads
tar -rzf "$FILE" "$SRC_DB" 2>/dev/null || true
# روش ساده‌تر و مطمئن‌تر:
rm -f "$FILE"
TMP=$(mktemp -d)
mkdir -p "$TMP/fooladiman"
cp "$SRC_DB" "$TMP/fooladiman/shop.db"
cp -r public/uploads "$TMP/fooladiman/uploads"
tar -czf "$FILE" -C "$TMP" fooladiman
rm -rf "$TMP" /tmp/shop-backup.db

SIZE=$(du -h "$FILE" | cut -f1)
echo "✅ پشتیبان ساخته شد: $FILE  ($SIZE)"

# نگه‌داشتن فقط ۱۴ پشتیبان آخر
ls -1t "$DEST"/fooladiman-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "   (فقط ۱۴ پشتیبان آخر نگه داشته می‌شود)"
