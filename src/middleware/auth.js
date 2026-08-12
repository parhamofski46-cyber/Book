'use strict';

const crypto = require('crypto');

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

module.exports = { requireLogin, csrf };
