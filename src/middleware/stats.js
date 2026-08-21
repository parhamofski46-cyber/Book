'use strict';

const stats = require('../services/stats');

/**
 * ثبت بازدید صفحه‌ها.
 *
 * فقط صفحه‌های واقعیِ سایت شمرده می‌شوند. این چهار شرط عمدی‌اند:
 *  • فقط GET — درخواست فرم و POST بازدید نیست.
 *  • فقط وضعیت ۲۰۰ — ۴۰۴ و ۳۰۱ بازدید حساب نمی‌شوند، وگرنه ربات‌هایی که
 *    آدرس‌های تصادفی می‌زنند آمار را باد می‌کردند.
 *  • فقط HTML — عکس، CSS و فونت نباید در «تعداد بازدید صفحه» بیایند.
 *  • بدون /admin — کار خود مالک، بازدید مشتری نیست.
 *
 * روی `res.on('finish')` سوار می‌شود، یعنی بعد از اینکه پاسخ کامل برای
 * کاربر فرستاده شد. پس حتی اگر این کار زمان‌بر بود (که نیست، فقط چند
 * عمل روی حافظه است) یک میلی‌ثانیه هم به زمان بارگذاری صفحه اضافه
 * نمی‌کند.
 */
/**
 * نام کوکی «مرا نشمار».
 * وقتی مالک وارد پنل می‌شود این کوکی روی مرورگرش گذاشته می‌شود و از آن
 * به بعد بازدیدهای خودش شمرده نمی‌شود.
 *
 * چرا لازم است: مالک روزی ده‌ها بار سایت خودش را باز می‌کند تا محصول و
 * عکس را چک کند. بدون این، بخش بزرگی از «بازدیدکننده‌ها» خودِ اوست و
 * عدد داشبورد دروغ می‌شود — دقیقاً همان چیزی که آمار قرار بود جلویش را
 * بگیرد.
 */
const NO_TRACK_COOKIE = 'fi_notrack';

function trackPageView(req, res, next) {
  if (req.method !== 'GET' || req.path.startsWith('/admin')) return next();
  // بازدید خودِ مالک شمرده نمی‌شود
  if (req.headers.cookie && req.headers.cookie.indexOf(NO_TRACK_COOKIE + '=1') !== -1) {
    return next();
  }

  res.on('finish', function () {
    try {
      if (res.statusCode !== 200) return;
      const type = res.getHeader('Content-Type');
      if (!type || String(type).indexOf('text/html') === -1) return;

      stats.record({
        path: req.path,
        referrer: req.get('referer') || '',
        ua: req.get('user-agent') || '',
        ip: req.ip || '',
        host: req.hostname || '',
      });
    } catch (err) {
      /* آمار هرگز نباید سایت را بخواباند */
    }
  });

  next();
}

module.exports = { trackPageView, NO_TRACK_COOKIE };
