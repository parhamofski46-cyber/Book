'use strict';

const { db } = require('./index');

/**
 * همه‌ی پرس‌وجوهای دیتابیس در یک جا.
 * صفحات عمومی سایت مستقیماً از این توابع می‌خوانند؛ چون SQLite روی همان
 * سرور است، خواندن در حد میکروثانیه طول می‌کشد و صفحه سریع رندر می‌شود.
 */

/**
 * هم‌ارزسازی املای «رابیس» و «رابیتس» در جست‌وجو.
 *
 * نام محصولات در دیتابیس «رابیتس» است، ولی خیلی از مشتری‌ها «رابیس»
 * می‌نویسند. بدون این، جست‌وجوی «رابیس» هیچ نتیجه‌ای برنمی‌گرداند و مشتری
 * فکر می‌کند جنس را نداریم. آنچه در کادر جست‌وجو نوشته شده دست‌نخورده
 * می‌ماند؛ فقط عبارتی که به دیتابیس می‌رود عوض می‌شود.
 */
const normalizeQuery = (q) => String(q).replace(/رابیس/g, 'رابیتس');

// ---------------------------------------------------------------- دسته‌ها

const listCategories = () =>
  db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM products p
                WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
         FROM categories c
        ORDER BY c.sort_order, c.id`
    )
    .all();

/**
 * نامزدهای «عکس روی کارت دسته».
 *
 * کارت هر دسته باید عکس واقعی نشان بدهد، نه تصویرسازی خطی. به‌جای اینکه
 * برای هر دسته یک فایل جدا دستی بسازیم، از عکس محصولات همان دسته استفاده
 * می‌کنیم — پس وقتی مالک از پنل برای یک محصول عکس آپلود کرد، کارت دسته هم
 * خودش عکس‌دار می‌شود و هیچ کدی لازم نیست عوض شود.
 *
 * برای هر دسته حداکثر ۴۰ نامزد برمی‌گردد؛ محصولاتی که عکس آپلودی دارند اول
 * می‌آیند. انتخاب نهایی در `categoryCover()` انجام می‌شود، چون آنجاست که
 * می‌دانیم کدام محصول واقعاً عکس دارد (آپلود، عکس کاتالوگ، یا عکس کالا).
 *
 * چرا ۴۰ و نه یک عدد کوچک‌تر؟ با سقف ۸، کارت «پیچ و یراق‌آلات» بی‌عکس
 * می‌ماند: تنها محصول عکس‌دارِ آن دسته «پیچ سرمته» است و با sort_order ۱۰
 * بیرون از پنجره می‌افتاد. ۴۰ از بزرگ‌ترین دسته‌ی غیرفرفورژه هم بیشتر است.
 * سقف لازم است چون دسته‌ی فرفورژه صدها محصول دارد و پیمایش همه‌شان برای
 * پیدا کردن یک عکس، هر بار بارگذاری صفحه‌ی اصلی را بی‌دلیل سنگین می‌کند.
 */
const categoryCoverCandidates = () =>
  db
    .prepare(
      `WITH ranked AS (
         SELECT p.id, p.category_id, p.name, p.slug,
                ROW_NUMBER() OVER (PARTITION BY p.category_id
                                   ORDER BY p.sort_order, p.id) AS rn
           FROM products p
          WHERE p.is_active = 1
       )
       SELECT r.category_id, r.name, r.slug, c.name AS category_name,
              (SELECT basename FROM product_images i
                WHERE i.product_id = r.id ORDER BY i.sort_order, i.id LIMIT 1) AS image,
              (SELECT alt FROM product_images i
                WHERE i.product_id = r.id ORDER BY i.sort_order, i.id LIMIT 1) AS image_alt,
              (SELECT width FROM product_images i
                WHERE i.product_id = r.id ORDER BY i.sort_order, i.id LIMIT 1) AS image_width
         FROM ranked r
         JOIN categories c ON c.id = r.category_id
        WHERE r.rn <= 40
        ORDER BY r.category_id, r.rn`
    )
    .all();

const getCategoryBySlug = (slug) =>
  db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug);

const getCategoryById = (id) => db.prepare('SELECT * FROM categories WHERE id = ?').get(id);

const listSubcategories = (categoryId) =>
  db
    .prepare('SELECT * FROM subcategories WHERE category_id = ? ORDER BY sort_order, id')
    .all(categoryId);

const listAllSubcategories = () =>
  db
    .prepare(
      `SELECT s.*, c.slug AS category_slug, c.name AS category_name
         FROM subcategories s JOIN categories c ON c.id = s.category_id
        ORDER BY c.sort_order, s.sort_order`
    )
    .all();

// -------------------------------------------------------------- محصولات

// ستون‌های مشترک + عکس اصلی محصول (کم‌ترین sort_order)
const PRODUCT_SELECT = `
  SELECT p.*,
         c.name AS category_name,
         c.slug AS category_slug,
         s.name AS subcategory_name,
         s.slug AS subcategory_slug,
         (SELECT basename FROM product_images i
           WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS image,
         (SELECT alt FROM product_images i
           WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS image_alt,
         -- عرض عکس اصلی: برای ساختن srcset با عرض‌های واقعی لازم است
         (SELECT width FROM product_images i
           WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS image_width
    FROM products p
    JOIN categories c    ON c.id = p.category_id
    LEFT JOIN subcategories s ON s.id = p.subcategory_id
`;

/**
 * فهرست محصولات با فیلترهای اختیاری.
 * @param {{category?: string, subcategory?: string, q?: string, onlyInStock?: boolean,
 *          includeInactive?: boolean, limit?: number}} opts
 */
function listProducts(opts = {}) {
  const where = [];
  const params = {};

  if (!opts.includeInactive) where.push('p.is_active = 1');
  if (opts.category) {
    where.push('c.slug = @category');
    params.category = opts.category;
  }
  if (opts.subcategory) {
    where.push('s.slug = @subcategory');
    params.subcategory = opts.subcategory;
  }
  if (opts.onlyInStock) where.push('p.in_stock = 1');
  if (opts.q) {
    where.push('(p.name LIKE @q OR p.summary LIKE @q OR p.description LIKE @q)');
    params.q = `%${normalizeQuery(opts.q)}%`;
  }

  const sql = `${PRODUCT_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.in_stock DESC, p.sort_order, p.id DESC
    ${opts.limit ? 'LIMIT @limit' : ''}
    ${opts.limit && opts.offset ? 'OFFSET @offset' : ''}`;

  if (opts.limit) params.limit = opts.limit;
  if (opts.limit && opts.offset) params.offset = opts.offset;
  return db.prepare(sql).all(params);
}

/**
 * شمارش محصولات با همان فیلترهای listProducts.
 *
 * برای صفحه‌بندی لازم است: دسته‌ی فرفورژه صدها مدل دارد و نمایش همه در یک
 * صفحه، صفحه‌ای چند ده هزار پیکسلی می‌سازد که روی گوشی عملاً غیرقابل استفاده
 * است. برای اینکه شرط‌ها دو جا از هم دور نیفتند، همان‌ها اینجا تکرار شده‌اند.
 */
function countProducts(opts = {}) {
  const where = [];
  const params = {};

  if (!opts.includeInactive) where.push('p.is_active = 1');
  if (opts.category) {
    where.push('c.slug = @category');
    params.category = opts.category;
  }
  if (opts.subcategory) {
    where.push('s.slug = @subcategory');
    params.subcategory = opts.subcategory;
  }
  if (opts.onlyInStock) where.push('p.in_stock = 1');
  if (opts.q) {
    where.push('(p.name LIKE @q OR p.summary LIKE @q OR p.description LIKE @q)');
    params.q = `%${normalizeQuery(opts.q)}%`;
  }

  const sql = `SELECT COUNT(*) n FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN subcategories s ON s.id = p.subcategory_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  return db.prepare(sql).get(params).n;
}

const getProductBySlug = (slug) =>
  db.prepare(`${PRODUCT_SELECT} WHERE p.slug = @slug`).get({ slug });

const getProductById = (id) => db.prepare(`${PRODUCT_SELECT} WHERE p.id = @id`).get({ id });

const listProductImages = (productId) =>
  db
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id')
    .all(productId);

/** محصولات مرتبط (هم‌دسته) برای پایین صفحه‌ی محصول */
const relatedProducts = (product, limit = 4) =>
  db
    .prepare(
      `${PRODUCT_SELECT} WHERE p.is_active = 1 AND p.category_id = @cat AND p.id <> @id
        ORDER BY p.in_stock DESC, p.sort_order LIMIT @limit`
    )
    .all({ cat: product.category_id, id: product.id, limit });

// -------------------------------------------------- نظرات مشتریان

const listTestimonials = (opts = {}) =>
  db
    .prepare(
      `SELECT * FROM testimonials
        ${opts.includeInactive ? '' : 'WHERE is_active = 1'}
        ORDER BY sort_order, id
        ${opts.limit ? 'LIMIT @limit' : ''}`
    )
    .all(opts.limit ? { limit: opts.limit } : {});

const getTestimonial = (id) => db.prepare('SELECT * FROM testimonials WHERE id = ?').get(id);

/**
 * میانگین امتیاز و تعداد نظرات — برای نمایش ستاره‌ها و داده‌ی ساختاریافته‌ی گوگل.
 *
 * ⚠️ نظرهای نمونه (که نامشان با «(نمونه)» علامت خورده) عمداً شمرده نمی‌شوند.
 * فرستادن امتیاز ساختگی به گوگل هم خلاف قوانین نتایج غنی است و می‌تواند باعث
 * حذف سایت از آن نتایج شود، هم به اعتماد مشتری واقعی ضربه می‌زند. تا وقتی
 * صاحب مغازه از پنل نظر واقعی ثبت نکند، هیچ ستاره‌ای نمایش داده نمی‌شود.
 */
const testimonialSummary = () => {
  const row = db
    .prepare(
      `SELECT COUNT(*) n, AVG(rating) avg FROM testimonials
        WHERE is_active = 1 AND name NOT LIKE '%(نمونه)%'`
    )
    .get();
  return { count: row.n, average: row.n ? Math.round(row.avg * 10) / 10 : 0 };
};

// ------------------------------------------------------- آمار پنل مدیریت

const adminStats = () => ({
  products: db.prepare('SELECT COUNT(*) n FROM products').get().n,
  active: db.prepare('SELECT COUNT(*) n FROM products WHERE is_active = 1').get().n,
  outOfStock: db.prepare('SELECT COUNT(*) n FROM products WHERE in_stock = 0').get().n,
  noImage: db
    .prepare(
      'SELECT COUNT(*) n FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)'
    )
    .get().n,
  categories: db.prepare('SELECT COUNT(*) n FROM categories').get().n,
});

// ------------------------------------------------------------ آمار بازدید

/**
 * گزارش آمار بازدید برای پنل مدیریت.
 *
 * همه‌ی عددها از جدول‌های جمع‌شده‌ی `stats_*` می‌آیند، پس این پرس‌وجو حتی
 * با سال‌ها داده هم سریع است (چند هزار سطر، نه چند میلیون).
 *
 * @param {{today: string, from30: string, from7: string, yesterday: string}} range
 *        تاریخ‌ها به وقت تهران از `services/stats` می‌آیند، نه از SQLite —
 *        سرور ممکن است روی UTC باشد و «امروز»ش با امروزِ مالک فرق کند.
 */
function visitStats(range) {
  const sum = (from, to) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(visitors), 0) AS visitors
           FROM stats_daily WHERE day >= ? AND day <= ?`
      )
      .get(from, to);

  return {
    today: sum(range.today, range.today),
    yesterday: sum(range.yesterday, range.yesterday),
    week: sum(range.from7, range.today),
    month: sum(range.from30, range.today),
    total: db
      .prepare('SELECT COALESCE(SUM(views), 0) AS views, COUNT(*) AS days FROM stats_daily')
      .get(),

    // نمودار ۳۰ روز اخیر. روزهای بدون بازدید در دیتابیس سطری ندارند؛
    // پرکردن جای خالی‌شان در قالب انجام می‌شود تا نمودار پیوسته بماند.
    series: db
      .prepare(
        `SELECT day, views, visitors FROM stats_daily
          WHERE day >= ? AND day <= ? ORDER BY day`
      )
      .all(range.from30, range.today),

    topPages: db
      .prepare(
        `SELECT path, SUM(views) AS views FROM stats_pages
          WHERE day >= ? AND day <= ?
          GROUP BY path ORDER BY views DESC LIMIT 15`
      )
      .all(range.from30, range.today),

    topReferrers: db
      .prepare(
        `SELECT host, SUM(views) AS views FROM stats_referrers
          WHERE day >= ? AND day <= ?
          GROUP BY host ORDER BY views DESC LIMIT 12`
      )
      .all(range.from30, range.today),

    devices: db
      .prepare(
        `SELECT COALESCE(SUM(mobile), 0) AS mobile, COALESCE(SUM(desktop), 0) AS desktop
           FROM stats_daily WHERE day >= ? AND day <= ?`
      )
      .get(range.from30, range.today),

    // ── تماس‌ها: مهم‌ترین عدد سایت ───────────────────────────────────
    // بازدید یعنی کسی نگاه کرد؛ این یعنی کسی واقعاً سراغ مغازه آمد.
    contacts: {
      today: db
        .prepare('SELECT kind, count FROM stats_events WHERE day = ?')
        .all(range.today),
      month: db
        .prepare(
          `SELECT kind, SUM(count) AS count FROM stats_events
            WHERE day >= ? AND day <= ? GROUP BY kind ORDER BY count DESC`
        )
        .all(range.from30, range.today),
      monthTotal: db
        .prepare(
          `SELECT COALESCE(SUM(count), 0) AS n FROM stats_events
            WHERE day >= ? AND day <= ?`
        )
        .get(range.from30, range.today).n,
    },

    // ── جست‌وجوهای داخل سایت ────────────────────────────────────────
    // ترتیب بر اساس «بی‌نتیجه بودن» است، نه صرفاً تعداد: عبارتی که نتیجه
    // نداشته، یعنی مشتری چیزی خواسته که نداریم یا در سایت ثبت نشده.
    searches: db
      .prepare(
        `SELECT term, SUM(hits) AS hits, MIN(results) AS results
           FROM stats_searches WHERE day >= ? AND day <= ?
          GROUP BY term
          ORDER BY (MIN(results) = 0) DESC, hits DESC
          LIMIT 20`
      )
      .all(range.from30, range.today),

    // ── توزیع ساعتی ────────────────────────────────────────────────
    hours: db
      .prepare(
        `SELECT hour, SUM(views) AS views FROM stats_hours
          WHERE day >= ? AND day <= ? GROUP BY hour ORDER BY hour`
      )
      .all(range.from30, range.today),
  };
}

module.exports = {
  listCategories,
  categoryCoverCandidates,
  getCategoryBySlug,
  getCategoryById,
  listSubcategories,
  listAllSubcategories,
  listProducts,
  countProducts,
  getProductBySlug,
  getProductById,
  listProductImages,
  relatedProducts,
  listTestimonials,
  getTestimonial,
  testimonialSummary,
  adminStats,
  visitStats,
};
