'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const fs = require('fs');

const { site, activeChannels, inquiryLink } = require('./src/config/site');
const { DATA_DIR, STORAGE_WARNING, getSetting } = require('./src/db');
const { resolveSessionSecret, describeSecretSource } = require('./src/config/session-secret');
const queries = require('./src/db/queries');
const { seedAll } = require('./src/db/seed');
const helpers = require('./src/utils/view-helpers');
const { icon, categoryIcon, categoryArtUrl } = require('./src/utils/icons');
const { UPLOAD_DIR, UPLOAD_WARNING } = require('./src/services/images');

// ---------------------------------------------------------------- راه‌اندازی
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// در اولین اجرا: ساخت دسته‌بندی‌ها، محصولات نمونه و کاربر مدیر
const seedResult = seedAll();

// ---------------------------------------------------------- امنیت راه‌اندازی
// کلید امضای کوکی نشست. اگر در متغیرهای محیطی نباشد، یک کلید تصادفی امن ساخته
// و در پوشه‌ی داده ذخیره می‌شود. جزئیات و دلیلش در src/config/session-secret.js
const secretInfo = resolveSessionSecret(DATA_DIR);
const secretNote = describeSecretSource(secretInfo);

/**
 * نسخه‌ی فایل‌های استاتیک بر اساس محتوایشان.
 *
 * چرا مهم است: CSS و JS با کش یک‌هفته‌ای سرو می‌شوند. اگر آدرسشان ثابت بماند،
 * بعد از هر اصلاحی مرورگرِ مشتری تا یک هفته نسخه‌ی قدیمی را نشان می‌دهد و
 * به نظر می‌رسد باگ رفع نشده. با گذاشتن هش محتوا در آدرس، به‌محض تغییر فایل
 * آدرس عوض می‌شود و همه بلافاصله نسخه‌ی تازه را می‌گیرند.
 */
function assetHash(rel) {
  try {
    const buf = fs.readFileSync(path.join(__dirname, 'public', rel));
    return crypto.createHash('md5').update(buf).digest('hex').slice(0, 8);
  } catch (err) {
    return String(Date.now());
  }
}
const ASSET_VERSION = {
  css: assetHash('css/style.css'),
  js: assetHash('js/main.js'),
  admin: assetHash('css/admin.css'),
};

// وقتی پشت nginx / لیارا / آروان و ... اجرا می‌شود، آی‌پی و https درست تشخیص داده شود
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(compression());

// امنیت هدرها + CSP با nonce (بدون نیاز به unsafe-inline برای اسکریپت‌ها)
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
        styleSrc: ["'self'", "'unsafe-inline'"], // برای استایل‌های کوچک درون‌خطی مثل نسبت ابعاد عکس
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        // اجازه‌ی جاسازی نقشه‌ی نشان/گوگل در بخش «منطقه‌ی خدمات»
        frameSrc: ["'self'", 'https://maps.google.com', 'https://www.google.com', 'https://neshan.org', 'https://www.neshan.org'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    // اجازه‌ی نمایش عکس‌های سایت در نتایج جست‌وجو و شبکه‌های اجتماعی
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// دسترسی‌هایی که این سایت هرگز لازم ندارد را از ریشه می‌بندیم؛ اگر روزی
// اسکریپتی به صفحه راه پیدا کرد، نتواند به دوربین/میکروفون/موقعیت دست بزند.
app.use((req, res, next) => {
  res.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );
  next();
});

// فایل‌های استاتیک — عکس‌ها و فونت‌ها با کش طولانی، چون نامشان یکتاست
const staticOpts = { maxAge: isProd ? '365d' : 0, immutable: isProd };
app.use('/uploads', express.static(UPLOAD_DIR, staticOpts));
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), staticOpts));
app.use('/img', express.static(path.join(__dirname, 'public', 'img'), { maxAge: isProd ? '30d' : 0 }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));

app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// نشست (session) برای ورود به پنل مدیریت — در فایل SQLite ذخیره می‌شود
// تا با ری‌استارت شدن سرور، کاربر از پنل بیرون نیفتد.
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
    secret: secretInfo.secret,
    resave: false,
    saveUninitialized: false,
    name: 'fi.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // 'auto' یعنی express-session بر اساس req.secure تصمیم می‌گیرد (که با
      // trust proxy بالا، از هدر X-Forwarded-Proto نگینکس درست خوانده می‌شود)
      // نه یک true/false ثابت روی NODE_ENV.
      //
      // چرا این فرق مهم است: با secure:true ثابت (بر اساس isProd)، اگر سایت
      // در حالت production ولی هنوز بدون HTTPS واقعی بالا بیاید (مثلاً
      // certbot هنوز موفق نشده یا در حال تست اولیه‌ی سرور هستید)، مرورگر
      // کوکی امن را روی HTTP ساده اصلاً نگه نمی‌دارد — نتیجه: هر بار ورود
      // به پنل با خطای مبهم «فرم منقضی شده» شکست می‌خورد و هیچ سرنخی از
      // علت واقعی (نبود HTTPS) نمی‌دهد. 'auto' این حالت را هم درست مدیریت
      // می‌کند، و وقتی HTTPS واقعی برقرار شد همچنان کاملاً امن می‌ماند.
      secure: 'auto',
      maxAge: 1000 * 60 * 60 * 24 * 14, // دو هفته
    },
  })
);

// متغیرهای مشترک همه‌ی قالب‌ها
app.use((req, res, next) => {
  res.locals.site = site;
  res.locals.channels = activeChannels();
  res.locals.inquiryLink = inquiryLink;
  res.locals.activeChannels = activeChannels;
  res.locals.h = helpers;
  res.locals.icon = icon;
  res.locals.categoryIcon = categoryIcon;
  res.locals.categoryArtUrl = categoryArtUrl;
  res.locals.setting = getSetting;
  // خلاصه‌ی امتیاز مشتریان — در داده‌ی ساختاریافته‌ی همه‌ی صفحات استفاده می‌شود
  res.locals.reviewSummary = queries.testimonialSummary();
  res.locals.assetVersion = ASSET_VERSION;
  // هشدار ذخیره‌سازی موقت — فقط پنل مدیریت آن را نشان می‌دهد (نوار قرمز بالای
  // صفحه)؛ در سایت عمومی نمایش داده نمی‌شود چون به مشتری ربطی ندارد.
  res.locals.storageWarning = STORAGE_WARNING;
  res.locals.uploadWarning = UPLOAD_WARNING;
  res.locals.currentPath = req.path;
  res.locals.canonical = site.url + req.originalUrl.split('?')[0];
  next();
});

// ---------------------------------------------------------------- سلامت سرور
/**
 * /healthz — بررسی سریع اینکه سایت و دیتابیس سالم‌اند.
 * برای مانیتورینگ هاست و برای عیب‌یابی از راه دور استفاده می‌شود؛
 * هیچ اطلاعات محرمانه‌ای برنمی‌گرداند.
 */
app.get('/healthz', (req, res) => {
  try {
    const stats = queries.adminStats();
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      env: process.env.NODE_ENV || 'development',
      db: { products: stats.products, categories: stats.categories, ok: true },
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      // اگر ذخیره‌سازی روی حافظه‌ی موقت افتاده باشد، اینجا هم اعلام می‌شود تا
      // بدون ورود به پنل هم بشود از راه دور فهمید دیسک وصل نیست.
      storage: {
        persistent: !STORAGE_WARNING,
        uploadsPersistent: !UPLOAD_WARNING,
        ...(STORAGE_WARNING ? { warning: STORAGE_WARNING } : {}),
        ...(UPLOAD_WARNING ? { uploadWarning: UPLOAD_WARNING } : {}),
      },
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------- مسیرها
app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/public'));

// صفحه‌ی ۴۰۴ برندشده
app.use((req, res) => {
  res.status(404).render('public/404', { title: 'صفحه پیدا نشد' });
});

// مدیریت خطاهای پیش‌بینی‌نشده
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[خطای سرور]', err);
  const status = err.status || 500;
  res.status(status);
  if (req.path.startsWith('/admin')) {
    return res.render('admin/error', {
      title: 'خطا',
      message: err.message || 'مشکلی پیش آمد. دوباره تلاش کنید.',
    });
  }
  return res.render('public/404', { title: 'خطا', serverError: true });
});

// ---------------------------------------------------------------- اجرا
// وقتی از cluster.js بالا می‌آید، هر پردازش فرزند خودش را اینجا معرفی نمی‌کند
// چون بنر خوش‌آمد و پیام رمز مدیر را cluster.js یک‌بار (نه به تعداد پردازش‌ها)
// چاپ کرده است؛ اجرای مستقیم `node server.js` مثل قبل پیام کامل را می‌بیند.
const isClusterWorker = require('cluster').isWorker;
app.listen(PORT, () => {
  if (isClusterWorker) return;
  console.log(`\n🔨 ${site.name}`);
  console.log(`   سایت روی http://localhost:${PORT} اجرا شد`);
  if (secretNote) console.log('\n' + secretNote);
  console.log(`   پنل مدیریت: http://localhost:${PORT}/admin`);

  if (seedResult.admin) {
    console.log('\n   ── کاربر مدیر ساخته شد ──');
    console.log(`   نام کاربری: ${seedResult.admin.username}`);
    console.log(`   رمز عبور  : ${seedResult.admin.password}`);
    if (seedResult.admin.mustChange) {
      console.log('   ⚠️  در اولین ورود، سایت شما را مجبور به تغییر رمز می‌کند.');
    }
  }
  console.log('');
});

module.exports = app;
