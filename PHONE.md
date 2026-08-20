# راه‌اندازی از روی گوشی اندروید

دو مرحله دارد. اول روی گوشی تست می‌کنیم (رایگان، همین امروز)، بعد می‌بریمش روی سرور.

> ⚠️ **ربات نباید برای همیشه روی گوشی بماند.** گوشی می‌خوابد، شبکه قطع می‌شود، ری‌استارت می‌خورد — یعنی مشتری پول می‌دهد و ربات آفلاین است. گوشی فقط برای تست است.

---

# مرحله ۱ — تست روی گوشی (۱۵ دقیقه)

## ۱. نصب Termux

Termux یک ترمینال واقعی لینوکس روی اندروید است.

**از Google Play نصب نکنید** — نسخه‌ی آنجا قدیمی و خراب است. از یکی از این دو:

- [F-Droid](https://f-droid.org/packages/com.termux/) ← توصیه‌شده
- [GitHub Releases](https://github.com/termux/termux-app/releases) ← فایل `termux-app_...universal.apk` را بگیرید

## ۲. آماده‌سازی Termux

بازش کنید و این‌ها را بزنید (هر خط، بعد Enter):

```bash
pkg update -y && pkg upgrade -y
pkg install -y python git
```

اگر پرسید چیزی را جایگزین کند، `y` بزنید.

بررسی کنید نصب شده:

```bash
python --version
```

باید چیزی مثل `Python 3.12.x` ببینید.

## ۳. گرفتن کد

```bash
git clone <آدرس-مخزن-شما>
cd Book
```

> آدرس مخزن را از صفحه‌ی گیت‌هاب پروژه بردارید (دکمه‌ی سبز Code → HTTPS).

## ۴. اجرای نصب‌کننده

```bash
bash install.sh
```

توکن و شناسه‌ی عددی‌تان را می‌پرسد. **پیست کردن در Termux:** انگشتتان را روی صفحه نگه دارید → Paste.

اسکریپت بقیه‌اش را خودش انجام می‌دهد و در آخر توکن را به تلگرام می‌زند تا مطمئن شوید کار می‌کند.

### اگر گفت به تلگرام وصل نشد

طبیعی است — `api.telegram.org` در ایران فیلتر است. **VPN گوشی‌تان را روشن کنید** و دوباره بزنید:

```bash
bash install.sh
```

## ۵. اجرا

```bash
bash run.sh
```

باید ببینید:

```
INFO  starting bot @نام_ربات_شما
INFO  sweep scheduled hourly
```

حالا در تلگرام به ربات خودتان `/start` بدهید. جواب می‌دهد.

> 📌 **Termux را نبندید** — تا وقتی باز است ربات کار می‌کند. برای توقف: `Ctrl+C` (کلید Ctrl در نوار پایین Termux هست).

## ۶. تست کامل

در چت خصوصی با ربات:

```
/setup       → یک پیام از کانال خصوصی‌تان را فوروارد کنید
/provider    → روش پرداخت
/addplan     → مثلاً ماهانه، ۳۰ روز، ۵۰۰,۰۰۰ تومان
```

قبلش یادتان باشد ربات را در کانال **ادمین** کنید با این دو دسترسی:

| دسترسی | بدونش |
|---|---|
| ✅ Invite Users via Link | خریدار پول می‌دهد ولی وارد نمی‌شود |
| ✅ Ban Users | منقضی‌شده‌ها هیچ‌وقت حذف نمی‌شوند |

بعد **با یک اکانت تلگرام دوم** یک خرید کامل بزنید، و با اکانت اصلی `/claims` را بزنید و تأییدش کنید. اگر لینک عضویت به اکانت دوم رسید — **همه‌چیز سالم است.**

---

# مرحله ۲ — انتقال به سرور ایرانی

وقتی تست موفق بود، وقت سرور است.

## ۱. تهیه‌ی سرور

یک VPS لینوکس از هر ارائه‌دهنده‌ی ایرانی. مشخصات لازم خیلی کم است:

- **۱ گیگ رم و ۱ هسته کافی است** (ارزان‌ترین پلن)
- سیستم‌عامل: **Ubuntu 22.04** یا **24.04**

بعد از خرید، سه چیز به شما می‌دهند: **IP**، **یوزرنیم** (معمولاً `root`)، و **رمز**.

## ۲. اتصال از گوشی

در همان Termux:

```bash
pkg install -y openssh
ssh root@IP_سرور_شما
```

رمز را می‌پرسد (موقع تایپ چیزی نشان داده نمی‌شود، طبیعی است).

## ۳. نصب روی سرور

```bash
apt update && apt install -y python3 python3-venv python3-pip git
git clone <آدرس-مخزن-شما>
cd Book
bash install.sh
```

## ۴. تنظیم پروکسی — این مرحله الزامی است

سرور ایرانی به `api.telegram.org` دسترسی ندارد. بدون این کار ربات بالا نمی‌آید.

ساده‌ترین راه، نصب یک پروکسی روی خود سرور:

```bash
apt install -y tor
systemctl enable --now tor
```

بعد فایل تنظیمات را باز کنید:

```bash
nano .env
```

این خط را پیدا و پر کنید:

```ini
TELEGRAM_PROXY=socks5://127.0.0.1:9050
```

ذخیره: `Ctrl+O` → Enter → `Ctrl+X`

تست کنید:

```bash
bash install.sh
```

باید بگوید `✓ connected to Telegram as @نام_ربات`.

> اگر Tor کند بود یا کار نکرد، هر پروکسی SOCKS5 دیگری که دارید بگذارید. مهم این است که سرور بتواند به تلگرام برسد.

## ۵. همیشه‌روشن کردن

تا اینجا اگر SSH را ببندید ربات می‌خوابد. برای دائمی شدن:

```bash
nano /etc/systemd/system/chansub.service
```

این را داخلش بگذارید (مسیر را با مسیر واقعی خودتان عوض کنید — با `pwd` می‌بینیدش):

```ini
[Unit]
Description=ChanSub bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/Book
ExecStart=/root/Book/.venv/bin/python -m app.bot.main
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

ذخیره و فعال کردن:

```bash
systemctl daemon-reload
systemctl enable --now chansub
systemctl status chansub
```

باید `active (running)` ببینید. حالا می‌توانید Termux را ببندید، گوشی را خاموش کنید — ربات کار می‌کند.

**دیدن لاگ زنده:**

```bash
journalctl -u chansub -f
```

## ۶. پشتیبان‌گیری — جدی بگیرید

دیتابیس یعنی همه‌ی مشتری‌ها و اشتراک‌ها. اگر برود، نمی‌دانید چه کسی تا کی عضو است.

```bash
crontab -e
```

این خط را آخرش اضافه کنید (هر شب ساعت ۳):

```
0 3 * * * cd /root/Book && sqlite3 chansub.db ".backup /root/backup-$(date +\%F).db"
```

هر چند وقت یک بار یکی از این فایل‌ها را روی گوشی یا فضای ابری‌تان کپی کنید — نگه داشتنشان فقط روی همان سرور، پشتیبان حساب نمی‌شود.

---

## مشکلات رایج

| مشکل | راه‌حل |
|---|---|
| `pkg: command not found` | Termux را از F-Droid نصب کنید، نه Google Play |
| `Unauthorized` | توکن اشتباه است — در BotFather دوباره چک کنید |
| `Could not reach Telegram` روی گوشی | VPN را روشن کنید |
| `Could not reach Telegram` روی سرور | `TELEGRAM_PROXY` را در `.env` تنظیم کنید |
| `Database is not initialised` | `alembic upgrade head` بزنید |
| با بستن Termux ربات می‌خوابد | طبیعی است — مرحله‌ی ۲ را انجام دهید |
| لینک عضویت ساخته نمی‌شود | دسترسی Invite Users در کانال داده نشده |
