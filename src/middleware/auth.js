'use strict';

const crypto = require('crypto');
const { db } = require('../db');
const { toFaDigits } = require('../utils/slug');

/**
 * محافظت از پنل مدیریت
 * ------------------------------------------------------------------
 * هیچ آدرسی زیر /admin بدون ورود در دسترس نیست. اگر کاربر وارد نشده باشد
 * به صفحه‌ی ورود هدایت می‌شود و بعد از ورود به همان صفحه برمی‌گردد.
 */
function requireLogin(req, res, next) {
  if (req.session && req.session.adminId) {
    // اگر هنوز رمز پیش‌فرض عوض نشده، کاربر را مجبور به تغییر رمز می‌کنیم
    if (req.session.mustChange && req.path !== '/password' && req.path !== '/logout') {
      return res.redirect('/admin/password?first=1');
    }
    return next();
  }
  const back = encodeURIComponent(req.originalUrl || '/admin');
  return res.redirect(`/admin/login?next=${back}`);
}

/**
 * محافظت CSRF ساده و بدون وابستگی خارجی.
 * یک توکن تصادفی در session ذخیره می‌شود و در همه‌ی فرم‌ها به‌صورت
 * فیلد مخفی می‌آید؛ درخواست‌های POST بدون توکن معتبر رد می‌شوند.
 */
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
    const expected = req.session.csrfToken;
    const ok =
      typeof sent === 'string' &&
      sent.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
    if (!ok) {
      return res.status(403).render('admin/error', {
        title: 'درخواست نامعتبر',
        message:
          'اعتبار این فرم منقضی شده است. لطفاً صفحه را دوباره باز کنید و مجدداً تلاش کنید.',
      });
    }
  }
  return next();
}

/**
 * محدودسازی تلاش ورود به پنل مدیریت (rate limit) — بدون کتابخانه‌ی بیرونی.
 *
 * چرا در دیتابیس، نه در حافظه‌ی پردازش (مثل express-rate-limit پیش‌فرض):
 * روی سرور واقعی سایت با cluster.js چند پردازش موازی اجرا می‌شود و هرکدام
 * حافظه‌ی جدای خودشان را دارند. با شمارنده‌ی در-حافظه، هر پردازش جدا تا
 * سقف مجاز می‌شمرد — یعنی به‌جای ۱۰ تلاش واقعی، مهاجم عملاً «۱۰ ضرب‌در
 * تعداد پردازش‌ها» فرصت می‌گرفت (در تست با ۴ پردازش، محدودیت تا تلاش ۴۱ ام
 * اعمال نمی‌شد). با یک جدول مشترک در همان دیتابیسی که همه‌ی پردازش‌ها به آن
 * وصل‌اند، شمارش واقعاً سراسری و درست می‌ماند.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

const getAttempt = db.prepare('SELECT count, window_start FROM login_attempts WHERE ip = ?');
const upsertAttempt = db.prepare(`
  INSERT INTO login_attempts (ip, count, window_start) VALUES (?, ?, ?)
  ON CONFLICT(ip) DO UPDATE SET count = excluded.count, window_start = excluded.window_start
`);

function loginLimiter(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const row = getAttempt.get(ip);

  if (!row || now - row.window_start > LOGIN_WINDOW_MS) {
    // پنجره‌ی زمانی تازه (یا اولین تلاش این آی‌پی)
    upsertAttempt.run(ip, 1, now);
    return next();
  }

  if (row.count >= LOGIN_MAX_ATTEMPTS) {
    const waitMin = Math.ceil((LOGIN_WINDOW_MS - (now - row.window_start)) / 60000);
    return res.status(429).render('admin/error', {
      title: 'تعداد تلاش زیاد',
      message: `تعداد تلاش‌های ناموفق زیاد بود. حدود ${toFaDigits(waitMin)} دقیقه‌ی دیگر دوباره امتحان کنید.`,
    });
  }

  upsertAttempt.run(ip, row.count + 1, row.window_start);
  return next();
}

module.exports = { requireLogin, csrf, loginLimiter };
