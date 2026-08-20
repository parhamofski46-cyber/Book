# راه‌اندازی ربات — از کد تا ربات زنده

راهنمای گام‌به‌گام. از اول تا آخر حدود ۲۰ دقیقه طول می‌کشد.

---

## گام ۱ — ساخت ربات در تلگرام

۱. در تلگرام به [@BotFather](https://t.me/BotFather) پیام بدهید
۲. دستور `/newbot` را بفرستید
۳. یک نام نمایشی بدهید (مثلاً `My Subs`)
۴. یک یوزرنیم بدهید که حتماً به `bot` ختم شود (مثلاً `mysubs_manager_bot`)
۵. BotFather یک توکن می‌دهد، چیزی شبیه:

```
7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
```

⚠️ **این توکن مثل رمز عبور است.** هرکس آن را داشته باشد کنترل کامل ربات را دارد. در گروه نگذارید، در گیت کامیت نکنید.

سپس دو تنظیم دیگر در BotFather:

```
/setprivacy   → ربات را انتخاب کنید → Disable
/setcommands  → ربات را انتخاب کنید → متن زیر را بفرستید
```

```
setup - افزودن کانال
addplan - ساخت پلن جدید
channels - کانال‌ها و پلن‌های من
provider - انتخاب روش پرداخت
claims - بررسی پرداخت‌های اعلام‌شده
billing - وضعیت اشتراک من
referral - لینک معرفی من
```

> این فهرست دقیقاً همان دستورهایی است که ربات پاسخ می‌دهد.
> `/start` را در فهرست نیاورید — تلگرام خودش آن را دارد.
> `/admin` و `/invoices` مخصوص شماست و عمداً در فهرست عمومی نیست.

---

## گام ۲ — گرفتن شناسه‌ی عددی خودتان

ربات باید بداند مدیر کیست. به [@userinfobot](https://t.me/userinfobot) پیام بدهید؛ یک عدد به شما می‌دهد مثل `123456789`. این `ADMIN_IDS` شماست.

---

## گام ۳ — آماده‌سازی پروژه

```bash
git clone <آدرس-مخزن-شما>
cd Book

python3 -m venv .venv
source .venv/bin/activate          # ویندوز: .venv\Scripts\activate

pip install -e ".[dev]"
```

---

## گام ۴ — تنظیمات

```bash
cp .env.example .env
```

حالا `.env` را باز کنید و پر کنید:

```ini
BOT_TOKEN=7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
ADMIN_IDS=123456789

DATABASE_URL=sqlite+aiosqlite:///./chansub.db

# کارت خودتان، برای اشتراکی که صاحبان کانال به شما می‌دهند
PLATFORM_CARD_NUMBER=6037-9911-xxxx-xxxx
PLATFORM_CARD_HOLDER=نام روی کارت
PLATFORM_MONTHLY_PRICE=5000000
PLATFORM_TRIAL_DAYS=14

# برای مشتریان خارجی
PLATFORM_PAYPAL_ACCOUNT=parhambamarame@gmail.com
```

⚠️ فایل `.env` در `.gitignore` هست و کامیت نمی‌شود. همین‌طور بماند.

---

## گام ۵ — ساخت جدول‌های دیتابیس

```bash
alembic upgrade head
```

باید ببینید: `Running upgrade -> b5aac762889a, initial schema`

اگر این گام را رد کنید، ربات بالا نمی‌آید و پیام واضح می‌دهد که چه کار کنید.

---

## گام ۶ — اجرا

```bash
python -m app.bot.main
```

اگر همه‌چیز درست باشد:

```
INFO  starting bot @mysubs_manager_bot
INFO  sweep scheduled hourly
```

حالا در تلگرام به ربات خودتان `/start` بدهید. باید جواب بدهد.

---

## گام ۷ — افزودن ربات به کانال

۱. یک **کانال خصوصی** بسازید (یا کانال موجود)
۲. Manage Channel → Administrators → Add Admin → ربات خودتان را انتخاب کنید
۳. این دو دسترسی **الزامی** است:
   - ✅ **Invite Users via Link** — بدون این نمی‌تواند لینک عضویت بسازد
   - ✅ **Ban Users** — بدون این نمی‌تواند منقضی‌شده‌ها را حذف کند

بقیه‌ی دسترسی‌ها لازم نیست. هرچه کمتر، بهتر.

---

## گام ۸ — تست کامل

در چت خصوصی با ربات:

```
/setup          → ربات راهنمایی می‌کند که یک پیام از کانال فوروارد کنید
/provider       → روش پرداخت را انتخاب کنید
/addplan        → مثلاً «ماهانه، ۳۰ روز، ۵۰۰,۰۰۰ تومان»
/channels       → بررسی اینکه کانال و پلن درست ثبت شده‌اند
```

حالا **با یک اکانت تلگرام دیگر** (نه اکانت خودتان) ربات را استارت کنید و مسیر خرید را طی کنید. با اکانت اصلی `/claims` بزنید و پرداخت را تأیید کنید. باید لینک عضویت به آن اکانت برسد.

اگر این کار کرد، همه‌چیز سالم است.

---

## نکته‌ی مهم برای اجرا از داخل ایران

`api.telegram.org` در ایران فیلتر است. اگر ربات را روی سرور ایرانی اجرا می‌کنید، به تلگرام وصل نمی‌شود. در `.env`:

```ini
TELEGRAM_PROXY=socks5://127.0.0.1:1080
```

**یا** ربات را روی یک سرور خارجی اجرا کنید (Hetzner، Contabo و مشابه‌شان از ۴ یورو در ماه). اگر بعداً درگاه ایرانی وصل کردید، ممکن است برعکسش مشکل شود — از پشتیبانی درگاه بپرسید که API را با IP خارجی قبول می‌کند یا نه.

---

## اجرای دائمی (وقتی تست تمام شد)

با بستن ترمینال، ربات هم می‌خوابد. برای اینکه همیشه بالا بماند، روی لینوکس:

```bash
sudo tee /etc/systemd/system/chansub.service > /dev/null <<'EOF'
[Unit]
Description=ChanSub bot
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/Book
ExecStart=/path/to/Book/.venv/bin/python -m app.bot.main
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now chansub
sudo systemctl status chansub        # وضعیت
journalctl -u chansub -f             # لاگ زنده
```

`Restart=always` یعنی اگر ربات به هر دلیلی کرش کرد، ۱۰ ثانیه بعد خودش بالا می‌آید.

---

## وقتی بعداً کد را تغییر دادید

```bash
git pull
pip install -e ".[dev]"
alembic upgrade head          # اگر ساختار دیتابیس عوض شده
sudo systemctl restart chansub
```

## وقتی به مدل‌ها ستون جدید اضافه کردید

```bash
alembic revision --autogenerate -m "توضیح تغییر"
# فایل ساخته‌شده در migrations/versions/ را بخوانید — کورکورانه اجرا نکنید
alembic upgrade head
```

---

## پشتیبان‌گیری — این را جدی بگیرید

دیتابیس شما یعنی همه‌ی مشتریان و اشتراک‌ها. اگر از بین برود، نمی‌دانید چه کسی تا کی عضو است.

```bash
# SQLite
sqlite3 chansub.db ".backup backup-$(date +%F).db"

# PostgreSQL
pg_dump chansub > backup-$(date +%F).sql
```

هر شب یک بار، خودکار، روی جایی غیر از همان سرور.

---

## اگر مشکلی پیش آمد

| علامت | علت معمول |
|---|---|
| `Unauthorized` | توکن اشتباه است یا فاصله‌ی اضافه دارد |
| ربات جواب نمی‌دهد | فیلترینگ — پروکسی تنظیم نشده |
| `Database is not initialised` | `alembic upgrade head` را نزده‌اید |
| لینک عضویت ساخته نمی‌شود | دسترسی Invite Users در کانال داده نشده |
| منقضی‌ها حذف نمی‌شوند | دسترسی Ban Users داده نشده |
| پنل ادمین باز نمی‌شود | `ADMIN_IDS` با شناسه‌ی عددی شما یکی نیست |

لاگ‌ها اولین جایی است که باید نگاه کنید: `journalctl -u chansub -n 100`
