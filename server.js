'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const SqliteSessionStore = require('./src/db/session-store');

const fs = require('fs');

const { site, activeChannels, inquiryLink } = require('./src/config/site');
const { DATA_DIR, STORAGE_WARNING, getSetting } = require('./src/db');
const { resolveSessionSecret, describeSecretSource } = require('./src/config/session-secret');
const queries = require('./src/db/queries');
const { seedAll } = require('./src/db/seed');
const helpers = require('./src/utils/view-helpers');
const { icon, categoryIcon, categoryArtUrl, categoryPhoto } = require('./src/utils/icons');
const { UPLOAD_DIR, UPLOAD_WARNING } = require('./src/services/images');
const { trackPageView } = require('./src/middleware/stats');

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
  calc: assetHash('js/calc.js'),
};

// وقتی پشت nginx / لیارا / آروان و ... اجرا می‌شود، آی‌پی و https درست تشخیص داده شود
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/**
 * آیا گوگل آنالیتیکس روشن است؟
 *
 * مقدار از دیتابیس می‌آید و مالک می‌تواند هر لحظه از پنل عوضش کند، ولی
 * CSP روی هر درخواست ساخته می‌شود — پس نمی‌شود هر بار به دیتابیس زد.
 * چند ثانیه کش می‌کنیم: هم هزینه‌ی خواندن حذف می‌شود، هم تغییرِ تنظیم
 * خیلی زود اثر می‌کند.
 */
let ga4Cache = { at: 0, on: false };
function ga4Enabled() {
  const now = Date.now();
  if (now - ga4Cache.at > 10000) {
    ga4Cache = { at: now, on: /^G-[A-Za-z0-9_-]+$/.test(getSetting('ga4_id', '')) };
  }
  return ga4Cache.on;
}

/**
 * تور ایمنی برای خطاهای مدیریت‌نشده.
 * ==========================================================================
 *
 * یک خطای غیرمنتظره در کدی که خارج از چرخه‌ی درخواست اجرا می‌شود (تایمر
 * آمار، پاک‌سازی نشست، یا هر Promise که catch نشده) کل پردازش را
 * می‌کشد. روی سرور واقعی `cluster.js` پردازش تازه می‌سازد و سایت بالا
 * می‌ماند، ولی اگر علت پابرجا باشد این چرخه تکرار می‌شود و کسی خبردار
 * نمی‌شود.
 *
 * اینجا خطا **لاگ** می‌شود تا در لاگ سرور دیده شود، و پردازش با کد
 * خطا بسته می‌شود تا ناظر (cluster یا systemd) جایگزینش کند. عمداً
 * ادامه نمی‌دهیم: پردازشی که در وضعیت نامعلوم مانده، از پردازشی که
 * تازه بالا آمده خطرناک‌تر است.
 */
process.on('uncaughtException', (err) => {
  console.error('\n❌ خطای مدیریت‌نشده — پردازش بسته می‌شود تا تازه‌اش بالا بیاید:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n❌ Promise رد‌شده و بدون catch:');
  console.error(reason && reason.stack ? reason.stack : reason);
  process.exit(1);
});

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
        // دامنه‌های گوگل آنالیتیکس فقط وقتی مجاز می‌شوند که مالک شناسه‌ی
        // GA4 را در تنظیمات گذاشته باشد. تا آن موقع CSP دقیقاً به همان
        // سخت‌گیری قبل می‌ماند — برای قابلیتی که استفاده نمی‌شود، در
        // امنیت باز نمی‌کنیم.
        scriptSrc: [
          "'self'",
          (req, res) => `'nonce-${res.locals.nonce}'`,
          () => (ga4Enabled() ? 'https://www.googletagmanager.com' : "'self'"),
        ],
        connectSrc: [
          "'self'",
          () => (ga4Enabled() ? 'https://www.google-analytics.com' : "'self'"),
          () => (ga4Enabled() ? 'https://region1.google-analytics.com' : "'self'"),
        ],
        imgSrc: [
          "'self'",
          'data:',
          () => (ga4Enabled() ? 'https://www.google-analytics.com' : "'self'"),
        ],
        styleSrc: ["'self'", "'unsafe-inline'"], // برای استایل‌های کوچک درون‌خطی مثل نسبت ابعاد عکس
        fontSrc: ["'self'", 'data:'],
        // اجازه‌ی جاسازی نقشه‌ی نشان/گوگل در بخش «منطقه‌ی خدمات»
        frameSrc: ["'self'", 'https://maps.google.com', 'https://www.google.com', 'https://neshan.org', 'https://www.neshan.org'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        // ⚠️ عمداً همیشه خاموش است و پایین‌تر، فقط برای درخواست‌هایی که
        // واقعاً با HTTPS آمده‌اند، دستی اضافه می‌شود. توضیح کامل کنار
        // همان میان‌افزار.
        upgradeInsecureRequests: null,
      },
    },
    // HSTS هم به همان دلیل اینجا خاموش است و پایین‌تر مشروط ست می‌شود.
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
    // اجازه‌ی نمایش عکس‌های سایت در نتایج جست‌وجو و شبکه‌های اجتماعی
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

/**
 * هشدار ناهماهنگی دامنه.
 * ==========================================================================
 *
 * `SITE_URL` تعیین می‌کند آدرس canonical، نقشه‌ی سایت و تگ‌های اشتراک‌گذاری
 * چه دامنه‌ای را اعلام کنند. اگر سایت در عمل روی دامنه‌ی دیگری بالا بیاید
 * (مثلاً `www.fooladiman.ir` ولی `SITE_URL` روی `fooladiman.ir` مانده
 * باشد)، هیچ خطایی رخ نمی‌دهد و سایت سالم به نظر می‌رسد — ولی هر
 * canonical به آدرسی اشاره می‌کند که بلافاصله ۳۰۱ می‌خورد. گوگل گیج
 * می‌شود، سهم خزش هدر می‌رود و رتبه بین دو آدرس تقسیم می‌شود.
 *
 * چون این خطا بی‌صدا است، همان‌جایی اعلامش می‌کنیم که هشدار دیسک را:
 * لاگ سرور (یک‌بار) و کلید `canonicalHost` در `/healthz`.
 * `www` عمداً نادیده گرفته نمی‌شود — دقیقاً همان تفاوتی است که مشکل‌ساز است.
 */
const CANONICAL_HOST = (() => {
  try {
    return new URL(site.url).hostname;
  } catch (err) {
    return '';
  }
})();
let hostMismatch = null;

app.use((req, res, next) => {
  const host = req.hostname;
  if (
    !hostMismatch &&
    CANONICAL_HOST &&
    host &&
    host !== CANONICAL_HOST &&
    host !== 'localhost' &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    hostMismatch = `سایت روی «${host}» سرو می‌شود ولی SITE_URL روی «${CANONICAL_HOST}» تنظیم است.`;
    console.warn(
      `\n⚠️  ناهماهنگی دامنه: ${hostMismatch}\n` +
        `   آدرس‌های canonical و نقشه‌ی سایت «${CANONICAL_HOST}» را اعلام می‌کنند،\n` +
        `   یعنی گوگل به آدرسی هدایت می‌شود که خودش ۳۰۱ می‌خورد.\n` +
        `   راه‌حل: متغیر محیطی SITE_URL را روی آدرس واقعی سایت بگذارید.\n`
    );
  }
  next();
});

/**
 * دو محافظ مخصوص HTTPS که فقط روی خودِ HTTPS فرستاده می‌شوند.
 * ==========================================================================
 *
 * چرا مشروط و نه همیشه (این یک‌بار باعث شد سایت روی دامنه‌ی تازه بالا نیاید):
 *
 *  • `upgrade-insecure-requests` به مرورگر می‌گوید هر آدرس http داخل صفحه را
 *    به https تبدیل کن. روی دامنه‌ای که هنوز گواهی SSL نگرفته، نتیجه‌اش این
 *    است که خودِ HTML می‌آید ولی CSS و JS و همه‌ی عکس‌ها شکست می‌خورند —
 *    یعنی صفحه‌ای بی‌قالب و به‌ظاهر خراب. کاربر می‌گوید «سایت بالا نمیاد».
 *
 *  • `Strict-Transport-Security` بدتر است: به مرورگر می‌گوید «یک سال آینده
 *    این دامنه را فقط با https باز کن». اگر این هدر روی http فرستاده شود و
 *    گواهی هنوز صادر نشده باشد، مرورگرِ خود مالک تا یک سال روی همان دامنه
 *    قفل می‌شود و حتی بعد از درست‌شدن همه‌چیز هم خطای گواهی می‌بیند. پاک
 *    کردنش دستی و از تنظیمات مرورگر است.
 *
 * با شرط `req.secure` (که به‌لطف `trust proxy` هدر X-Forwarded-Proto لیارا
 * را درست می‌خواند) هر دو محافظ سر جایشان می‌مانند — ولی فقط وقتی که واقعاً
 * HTTPS برقرار است. یعنی دامنه‌ی تازه قبل از صدور گواهی هم بالا می‌آید، و
 * لحظه‌ای که گواهی صادر شد، بدون هیچ تغییری در کد، محافظت کامل فعال می‌شود.
 */
app.use((req, res, next) => {
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const csp = res.getHeader('Content-Security-Policy');
    if (csp) res.setHeader('Content-Security-Policy', csp + ';upgrade-insecure-requests');
  }
  next();
});

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
    store: new SqliteSessionStore(),
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
  res.locals.categoryPhoto = categoryPhoto;
  res.locals.setting = getSetting;
  // محتوای سؤال‌های متداول — هم صفحه‌ی /faq و هم «تماس با ما» از آن می‌خوانند
  res.locals.faqContent = require('./src/content/faq');
  // شهرهای منطقه‌ی خدمات — فوتر همه‌ی صفحه‌ها به صفحه‌ی هرکدام لینک می‌دهد
  res.locals.serviceCities = require('./src/content/cities').cities;
  // خلاصه‌ی امتیاز مشتریان — در داده‌ی ساختاریافته‌ی همه‌ی صفحات استفاده می‌شود
  res.locals.reviewSummary = queries.testimonialSummary();
  res.locals.assetVersion = ASSET_VERSION;
  // هشدار ذخیره‌سازی موقت — فقط پنل مدیریت آن را نشان می‌دهد (نوار قرمز بالای
  // صفحه)؛ در سایت عمومی نمایش داده نمی‌شود چون به مشتری ربطی ندارد.
  res.locals.storageWarning = STORAGE_WARNING;
  res.locals.uploadWarning = UPLOAD_WARNING;
  res.locals.currentPath = req.path;
  /* آدرس canonical.
     شماره‌ی صفحه عمداً نگه داشته می‌شود: اگر صفحه‌ی ۲ گالری به صفحه‌ی ۱
     canonical بخورد، گوگل محصولاتی را که فقط در صفحه‌ی ۲ دیده می‌شوند
     ایندکس نمی‌کند — با ۴۹۴ مدل فرفورژه یعنی صدها محصول از نتایج بیرون
     می‌مانند. بقیه‌ی پارامترها (جست‌وجو، فیلتر) حذف می‌شوند چون محتوای
     تازه‌ای نمی‌سازند. */
  const pageNo = parseInt(req.query.page, 10);
  res.locals.canonical =
    site.url + req.path + (pageNo > 1 ? '?page=' + pageNo : '');
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
      // اگر دامنه‌ی واقعی با SITE_URL نخواند، اینجا هم دیده می‌شود
      canonicalHost: {
        expected: CANONICAL_HOST,
        ok: !hostMismatch,
        ...(hostMismatch ? { warning: hostMismatch } : {}),
      },
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

// شمارش بازدید صفحه‌ها. بعد از فایل‌های ثابت و قبل از مسیرها می‌نشیند تا
// نه عکس و CSS شمرده شود و نه چیزی از صفحه‌های واقعی از قلم بیفتد.
app.use(trackPageView);

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
