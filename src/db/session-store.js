'use strict';

const session = require('express-session');
const { db } = require('./index');

/**
 * ذخیره‌ی نشست‌ها روی همان دیتابیس better-sqlite3 که بقیه‌ی سایت استفاده
 * می‌کند.
 *
 * چرا نوشته شد و جایگزین connect-sqlite3 شد:
 *
 * ۱) امنیت. connect-sqlite3 به بسته‌ی قدیمی `sqlite3` وابسته است و آن هم به
 *    node-gyp → make-fetch-happen → cacache → tar. همه‌ی آسیب‌پذیری‌های
 *    باقی‌مانده‌ی پروژه (یک مورد بحرانی و چهار مورد high، از جمله
 *    path traversal در tar) از همین زنجیره می‌آمدند و نسخه‌ی اصلاح‌شده‌ای
 *    هم منتشر نشده بود.
 *
 * ۲) دو موتور SQLite برای یک برنامه بی‌معنی بود. برنامه از قبل
 *    better-sqlite3 را باز کرده؛ نشست‌ها هم می‌توانند روی همان بنشینند.
 *    نتیجه: یک باینری بومی کمتر، نصب و دیپلوی سبک‌تر.
 *
 * ۳) عمداً بسته‌ی شخص ثالث جایگزین نکردیم. تنها گزینه‌ی موجود نسخه‌ی ۰٫۱٫۰
 *    بود؛ برای چیزی که کوکی ورود مدیر را نگه می‌دارد، چهل خط کد قابل‌خواندن
 *    و تست‌شده امن‌تر از یک وابستگی نوپاست.
 *
 * ⚠️ با این تغییر، نشست‌های قبلی یک‌بار باطل می‌شوند و باید دوباره وارد پنل
 * شوید. بعد از آن رفتار دقیقاً مثل قبل است.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    expires INTEGER NOT NULL,   -- زمان انقضا بر حسب میلی‌ثانیه (Date.now)
    data    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`);

const SELECT = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
const UPSERT = db.prepare(
  `INSERT INTO sessions (sid, expires, data) VALUES (@sid, @expires, @data)
   ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data`
);
const DELETE = db.prepare('DELETE FROM sessions WHERE sid = ?');
const TOUCH = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
const PURGE = db.prepare('DELETE FROM sessions WHERE expires <= ?');
const COUNT = db.prepare('SELECT COUNT(*) n FROM sessions');
const ALL = db.prepare('SELECT data FROM sessions WHERE expires > ?');
const CLEAR = db.prepare('DELETE FROM sessions');

/** یک روز، اگر کوکی خودش زمان انقضا نداشته باشد */
const FALLBACK_TTL = 24 * 60 * 60 * 1000;

function expiryOf(sess) {
  const c = sess && sess.cookie;
  if (c) {
    if (c.expires) return new Date(c.expires).getTime();
    if (typeof c.maxAge === 'number') return Date.now() + c.maxAge;
  }
  return Date.now() + FALLBACK_TTL;
}

class SqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    // پاک‌سازی دوره‌ای رکوردهای منقضی. unref می‌کنیم تا این تایمر جلوی
    // بسته‌شدن تمیز پردازش را نگیرد.
    const every = options.purgeIntervalMs || 15 * 60 * 1000;
    this._timer = setInterval(() => this.purge(), every);
    if (this._timer.unref) this._timer.unref();
    this.purge();
  }

  purge() {
    try {
      PURGE.run(Date.now());
    } catch (err) {
      // پاک‌سازی نباید هیچ‌وقت باعث سقوط برنامه شود
      console.error('[نشست] پاک‌سازی منقضی‌ها ممکن نشد:', err.message);
    }
  }

  get(sid, cb) {
    try {
      const row = SELECT.get(sid);
      if (!row) return cb(null, null);
      // منقضی شده؟ حذفش کن و طوری رفتار کن که انگار نبوده
      if (row.expires <= Date.now()) {
        DELETE.run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch (err) {
      return cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      UPSERT.run({ sid, expires: expiryOf(sess), data: JSON.stringify(sess) });
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      DELETE.run(sid);
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  /**
   * با هر درخواستِ کاربرِ واردشده صدا زده می‌شود. فقط زمان انقضا را جلو
   * می‌برد و کل داده را دوباره نمی‌نویسد — همین باعث می‌شود هزینه‌ی هر
   * درخواست ناچیز بماند.
   */
  touch(sid, sess, cb) {
    try {
      TOUCH.run(expiryOf(sess), sid);
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  length(cb) {
    try {
      return cb(null, COUNT.get().n);
    } catch (err) {
      return cb(err);
    }
  }

  all(cb) {
    try {
      return cb(null, ALL.all(Date.now()).map((r) => JSON.parse(r.data)));
    } catch (err) {
      return cb(err);
    }
  }

  clear(cb) {
    try {
      CLEAR.run();
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }
}

module.exports = SqliteSessionStore;
