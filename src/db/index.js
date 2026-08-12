'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/**
 * اتصال به دیتابیس SQLite و ساخت جدول‌ها در اولین اجرا.
 * فایل دیتابیس در پوشه‌ی data/ ساخته می‌شود؛ برای پشتیبان‌گیری کافی است
 * همین یک فایل را کپی کنید (به‌همراه پوشه‌ی public/uploads برای عکس‌ها).
 */

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'shop.db');
const db = new Database(DB_PATH);

// WAL برای سرعت بیشتر خواندن هم‌زمان
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- دسته‌بندی اصلی محصولات
  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_featured INTEGER NOT NULL DEFAULT 0   -- دسته‌ی شاخص (فرفورژه) در صفحه‌ی اصلی بزرگ‌تر نمایش داده می‌شود
  );

  -- زیردسته (مثلاً برای فرفورژه: طرح نرده / طرح درب / طرح پنجره)
  CREATE TABLE IF NOT EXISTS subcategories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    slug        TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (category_id, slug)
  );

  -- محصولات
  CREATE TABLE IF NOT EXISTS products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slug           TEXT    NOT NULL UNIQUE,
    name           TEXT    NOT NULL,
    category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
    summary        TEXT    NOT NULL DEFAULT '',   -- توضیح کوتاه (زیر عنوان در گرید)
    description    TEXT    NOT NULL DEFAULT '',   -- توضیح کامل صفحه‌ی محصول
    price_text     TEXT    NOT NULL DEFAULT '',   -- مثلاً «تماس بگیرید» یا «۴۵,۰۰۰ تومان / کیلوگرم»
    unit           TEXT    NOT NULL DEFAULT '',   -- واحد فروش: شاخه، کیلوگرم، متر، رول ...
    in_stock       INTEGER NOT NULL DEFAULT 1,    -- 1 = موجود ، 0 = ناموجود
    stock_qty      INTEGER,                       -- تعداد (اختیاری — خالی یعنی اعلام نشده)
    is_active      INTEGER NOT NULL DEFAULT 1,    -- 0 یعنی در سایت نمایش داده نشود
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
  CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active);

  -- عکس‌های محصول (هر محصول می‌تواند چند عکس داشته باشد)
  CREATE TABLE IF NOT EXISTS product_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    -- نام پایه‌ی فایل بدون پسوند و بدون سایز؛ نسخه‌های مختلف با الگوی
    -- {basename}-{size}.webp در پوشه‌ی public/uploads ذخیره می‌شوند.
    basename   TEXT    NOT NULL,
    alt        TEXT    NOT NULL DEFAULT '',
    width      INTEGER,
    height     INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id);

  -- کاربران پنل مدیریت (رمز عبور به‌صورت هش bcrypt ذخیره می‌شود)
  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    must_change    INTEGER NOT NULL DEFAULT 0,  -- 1 = رمز پیش‌فرض هنوز عوض نشده
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- تنظیمات متنی قابل ویرایش از پنل (متن هیرو، متن «چرا ما» و ...)
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`);

/** خواندن یک تنظیم با مقدار پیش‌فرض */
function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

/** ذخیره‌ی یک تنظیم */
function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value ?? ''));
}

module.exports = { db, DB_PATH, DATA_DIR, getSetting, setSetting };
