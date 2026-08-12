'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { site, activeChannels, inquiryLink } = require('./src/config/site');
const { DATA_DIR, getSetting } = require('./src/db');
const queries = require('./src/db/queries');
const { seedAll } = require('./src/db/seed');
const helpers = require('./src/utils/view-helpers');
const { icon, categoryIcon } = require('./src/utils/icons');

// ---------------------------------------------------------------- راه‌اندازی
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// در اولین اجرا: ساخت دسته‌بندی‌ها، محصولات نمونه و کاربر مدیر
const seedResult = seedAll();

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

// فایل‌های استاتیک — عکس‌ها و فونت‌ها با کش طولانی، چون نامشان یکتاست
const staticOpts = { maxAge: isProd ? '365d' : 0, immutable: isProd };
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), staticOpts));
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), staticOpts));
app.use('/img', express.static(path.join(__dirname, 'public', 'img'), { maxAge: isProd ? '30d' : 0 }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));

app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// نشست (session) برای ورود به پنل مدیریت — در فایل SQLite ذخیره می‌شود
// تا با ری‌استارت شدن سرور، کاربر از پنل بیرون نیفتد.
app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || 'change-me-in-env-file',
    resave: false,
    saveUninitialized: false,
    name: 'fi.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd, // روی HTTPS فقط کوکی امن
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
  res.locals.setting = getSetting;
  // خلاصه‌ی امتیاز مشتریان — در داده‌ی ساختاریافته‌ی همه‌ی صفحات استفاده می‌شود
  res.locals.reviewSummary = queries.testimonialSummary();
  res.locals.currentPath = req.path;
  res.locals.canonical = site.url + req.originalUrl.split('?')[0];
  next();
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
app.listen(PORT, () => {
  console.log(`\n🔨 ${site.name}`);
  console.log(`   سایت روی http://localhost:${PORT} اجرا شد`);
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
