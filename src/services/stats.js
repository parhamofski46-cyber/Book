'use strict';

const crypto = require('crypto');
const { db } = require('../db');

/**
 * آمار بازدید سایت — میزبانی روی خود سرور.
 * ==========================================================================
 *
 * چرا خودمان و نه فقط گوگل آنالیتیکس:
 *  • داشبورد گوگل آنالیتیکس از داخل ایران باز نمی‌شود (تحریم)؛ مالک برای
 *    دیدن آمار خودش باید هر بار فیلترشکن روشن کند.
 *  • اسکریپت گوگل چند صد کیلوبایت است و روی اینترنت موبایل، سرعتی را که
 *    با زحمت بالا برده‌ایم پایین می‌آورد.
 *  • CSP سخت‌گیر سایت باید برایش سوراخ می‌شد.
 * گوگل آنالیتیکس همچنان قابل فعال‌سازی است (تنظیمات پنل)، ولی این آمار
 * محلی بدون هیچ وابستگی به بیرون کار می‌کند.
 *
 * حریم خصوصی: هیچ آی‌پی، نام یا شناسه‌ی پایداری ذخیره نمی‌شود؛ فقط عددهای
 * جمع‌شده‌ی روزانه. برای شمردن «بازدیدکننده‌ی یکتا» یک هش یک‌طرفه ساخته
 * می‌شود که تاریخِ همان روز و یک نمک تصادفی در آن اثر دارند؛ فردا همان
 * بازدیدکننده هش دیگری می‌گیرد، پس ردیابی بین روزها ممکن نیست.
 *
 * کارایی: نوشتن در دیتابیس بافر می‌شود و هر چند ثانیه یک‌بار در یک تراکنش
 * انجام می‌شود. تست بار قبلی نشان داد نوشتن هم‌زمان روی SQLite گلوگاه
 * می‌شود؛ با بافر، هر بازدید فقط چند عمل روی Map در حافظه است و صفحه
 * ذره‌ای دیرتر نمی‌آید.
 */

const FLUSH_MS = 5000;
/** آمار روزانه چند وقت نگه داشته شود (بیش از یک سال، برای مقایسه‌ی فصلی) */
const KEEP_DAYS = 400;
/** هش بازدیدکننده فقط برای یکتاشماری همان روز لازم است */
const KEEP_TOKEN_DAYS = 3;

/**
 * نمک هش بازدیدکننده. در حافظه‌ی همین پردازش ساخته می‌شود و هرگز ذخیره
 * نمی‌شود — یعنی حتی با در دست داشتن دیتابیس هم نمی‌شود هش را به آی‌پی
 * برگرداند. با ری‌استارت عوض می‌شود؛ بدترین اثرش این است که یک
 * بازدیدکننده در آن روز دوبار شمرده شود.
 */
const SALT = crypto.randomBytes(32).toString('hex');

// ------------------------------------------------------------------ بافر

let buf = newBuffer();

function newBuffer() {
  return {
    daily: new Map(), // day → {views, mobile, desktop}
    pages: new Map(), // 'day path' → count
    refs: new Map(), // 'day host' → count
    tokens: new Set(), // 'day token'
    events: new Map(), // 'day kind' → count      (کلیک دکمه‌های تماس)
    searches: new Map(), // 'day term' → {hits, results}
    hours: new Map(), // 'day hour' → count
  };
}

const bump = (map, key, by) => map.set(key, (map.get(key) || 0) + by);

// ------------------------------------------------------------------ ابزار

/**
 * تاریخ امروز به وقت تهران، به شکل YYYY-MM-DD.
 * سرور ممکن است روی UTC باشد؛ بدون این، «امروز» در داشبورد مالک تا ۳.۵
 * ساعت با امروز واقعی فرق می‌کرد و بازدیدهای شب به روز بعد می‌افتاد.
 */
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
}

/** ساعت جاری به وقت تهران (۰ تا ۲۳) */
function currentHour() {
  return Number(
    new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      hour12: false,
    })
  ) % 24;
}

/** n روز قبل، با همان قالب و همان منطقه‌ی زمانی */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
}

/** نشانه‌ی ناشناس بازدیدکننده، فقط برای یکتاشماری همان روز */
function visitorToken(ip, ua, day) {
  return crypto
    .createHash('sha256')
    .update(day + '|' + ip + '|' + ua + '|' + SALT)
    .digest('hex')
    .slice(0, 24);
}

/**
 * دامنه‌ی ارجاع‌دهنده. ارجاع از خود سایت شمرده نمی‌شود، وگرنه پرترافیک‌ترین
 * «منبع بازدید» همیشه خود سایت بود و جدول بی‌معنا می‌شد.
 */
function referrerHost(ref, selfHost) {
  if (!ref) return 'مستقیم';
  try {
    const h = new URL(ref).hostname.replace(/^www\./, '');
    if (!h || h === String(selfHost).replace(/^www\./, '')) return null;
    return h.slice(0, 80);
  } catch (err) {
    return 'مستقیم';
  }
}

/**
 * تشخیص ربات‌ها. بدون این، عدد بازدید عمدتاً خزنده‌ی گوگل و ربات‌های اسکن
 * است و مالک را درباره‌ی مشتری واقعی گمراه می‌کند.
 */
const BOT_RE = new RegExp(
  [
    'bot', 'crawl', 'spider', 'slurp', 'bingpreview', 'facebookexternalhit',
    'whatsapp', 'telegram', 'preview', 'monitor', 'curl', 'wget',
    'python-requests', 'axios', 'headless', 'lighthouse', 'pingdom', 'uptime',
    'semrush', 'ahrefs', 'mj12', 'dotbot', 'petal', 'yandex', 'applebot',
  ].join('|'),
  'i'
);

const isBot = (ua) => !ua || BOT_RE.test(ua);
const isMobile = (ua) => /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua || '');

// ------------------------------------------------------------------ ثبت

/**
 * ثبت یک بازدید صفحه. هرگز خطا پرتاب نمی‌کند — آمار نباید سایت را
 * بخواباند.
 */
function record(info) {
  try {
    const ua = info.ua || '';
    if (isBot(ua)) return;

    const day = today();
    const d = buf.daily.get(day) || { views: 0, mobile: 0, desktop: 0 };
    d.views++;
    if (isMobile(ua)) d.mobile++;
    else d.desktop++;
    buf.daily.set(day, d);

    bump(buf.pages, day + ' ' + String(info.path || '/').slice(0, 200), 1);

    const rh = referrerHost(info.referrer, info.host);
    if (rh) bump(buf.refs, day + ' ' + rh, 1);

    bump(buf.hours, day + ' ' + currentHour(), 1);
    buf.tokens.add(day + ' ' + visitorToken(info.ip || '', ua, day));
  } catch (err) {
    /* آمار هرگز نباید باعث خطای صفحه شود */
  }
}

/**
 * ثبت کلیک روی دکمه‌های تماس.
 * فهرست مجاز بسته است تا کسی نتواند با درخواست ساختگی، جدول را با
 * نوع‌های دلخواه پر کند.
 */
const EVENT_KINDS = ['whatsapp', 'telegram', 'phone', 'quote'];

function recordEvent(kind) {
  try {
    if (EVENT_KINDS.indexOf(kind) === -1) return false;
    bump(buf.events, today() + ' ' + kind, 1);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * ثبت عبارت جست‌وجوشده در سایت.
 * @param {string} term عبارت خام کاربر
 * @param {number} results تعداد نتیجه‌ای که گرفت
 */
function recordSearch(term, results) {
  try {
    const t = String(term || '').trim().slice(0, 60);
    if (!t) return;
    const key = today() + ' ' + t;
    const prev = buf.searches.get(key) || { hits: 0, results: 0 };
    buf.searches.set(key, { hits: prev.hits + 1, results: Number(results) || 0 });
  } catch (err) {
    /* آمار نباید جست‌وجو را بشکند */
  }
}

// ------------------------------------------------------------------ ذخیره

const upDaily = db.prepare(
  `INSERT INTO stats_daily (day, views, mobile, desktop) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET views   = views   + excluded.views,
                                    mobile  = mobile  + excluded.mobile,
                                    desktop = desktop + excluded.desktop`
);
const upPage = db.prepare(
  `INSERT INTO stats_pages (day, path, views) VALUES (?, ?, ?)
     ON CONFLICT(day, path) DO UPDATE SET views = views + excluded.views`
);
const upRef = db.prepare(
  `INSERT INTO stats_referrers (day, host, views) VALUES (?, ?, ?)
     ON CONFLICT(day, host) DO UPDATE SET views = views + excluded.views`
);
const addToken = db.prepare('INSERT OR IGNORE INTO stats_visitors (day, token) VALUES (?, ?)');
const upEvent = db.prepare(
  `INSERT INTO stats_events (day, kind, count) VALUES (?, ?, ?)
     ON CONFLICT(day, kind) DO UPDATE SET count = count + excluded.count`
);
const upSearch = db.prepare(
  `INSERT INTO stats_searches (day, term, hits, results) VALUES (?, ?, ?, ?)
     ON CONFLICT(day, term) DO UPDATE SET hits = hits + excluded.hits,
                                          results = excluded.results`
);
const upHour = db.prepare(
  `INSERT INTO stats_hours (day, hour, views) VALUES (?, ?, ?)
     ON CONFLICT(day, hour) DO UPDATE SET views = views + excluded.views`
);
const syncVisitors = db.prepare(
  `UPDATE stats_daily SET visitors =
     (SELECT COUNT(*) FROM stats_visitors v WHERE v.day = stats_daily.day)
   WHERE day = ?`
);

const splitKey = (key) => {
  const i = key.indexOf(' ');
  return [key.slice(0, i), key.slice(i + 1)];
};

const flushAll = db.transaction((b) => {
  const days = new Set();

  b.daily.forEach((d, day) => {
    upDaily.run(day, d.views, d.mobile, d.desktop);
    days.add(day);
  });
  b.pages.forEach((n, key) => {
    const kv = splitKey(key);
    upPage.run(kv[0], kv[1], n);
  });
  b.refs.forEach((n, key) => {
    const kv = splitKey(key);
    upRef.run(kv[0], kv[1], n);
  });
  b.tokens.forEach((key) => {
    const kv = splitKey(key);
    addToken.run(kv[0], kv[1]);
    days.add(kv[0]);
  });
  b.events.forEach((n, key) => {
    const kv = splitKey(key);
    upEvent.run(kv[0], kv[1], n);
  });
  b.searches.forEach((v, key) => {
    const kv = splitKey(key);
    upSearch.run(kv[0], kv[1], v.hits, v.results);
  });
  b.hours.forEach((n, key) => {
    const kv = splitKey(key);
    upHour.run(kv[0], Number(kv[1]), n);
  });
  days.forEach((day) => syncVisitors.run(day));
});

function flush() {
  if (
    !buf.daily.size && !buf.pages.size && !buf.refs.size && !buf.tokens.size &&
    !buf.events.size && !buf.searches.size && !buf.hours.size
  ) {
    return;
  }
  const b = buf;
  buf = newBuffer();
  try {
    flushAll(b);
  } catch (err) {
    console.error('[stats] ذخیره‌ی آمار ناموفق بود:', err.message);
  }
}

/** پاک‌سازی داده‌ی قدیمی تا دیتابیس بی‌جهت بزرگ نشود */
function purge() {
  try {
    const old = daysAgo(KEEP_DAYS);
    db.prepare('DELETE FROM stats_daily WHERE day < ?').run(old);
    db.prepare('DELETE FROM stats_pages WHERE day < ?').run(old);
    db.prepare('DELETE FROM stats_referrers WHERE day < ?').run(old);
    db.prepare('DELETE FROM stats_events WHERE day < ?').run(old);
    db.prepare('DELETE FROM stats_searches WHERE day < ?').run(old);
    db.prepare('DELETE FROM stats_hours WHERE day < ?').run(old);
    db.prepare('DELETE FROM stats_visitors WHERE day < ?').run(daysAgo(KEEP_TOKEN_DAYS));
  } catch (err) {
    console.error('[stats] پاک‌سازی ناموفق بود:', err.message);
  }
}

// تایمر با unref: اگر برنامه بخواهد بسته شود، این تایمر جلویش را نمی‌گیرد
const timer = setInterval(() => {
  flush();
  // پاک‌سازی روزی یکی‌دو بار کافی است؛ با احتمال کوچک در هر نوبت اجرا می‌شود
  if (Math.random() < 0.002) purge();
}, FLUSH_MS);
if (timer.unref) timer.unref();

// آخرین بافر موقع خاموش‌شدن هم ذخیره شود تا آمار چند ثانیه‌ی آخر گم نشود
['SIGINT', 'SIGTERM', 'beforeExit'].forEach((ev) => process.on(ev, flush));

module.exports = { record, recordEvent, recordSearch, flush, purge, today, daysAgo, isBot, EVENT_KINDS };
