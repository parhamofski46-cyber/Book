'use strict';

const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const { db, getSetting, setSetting } = require('../db');
const q = require('../db/queries');
const { requireLogin, csrf, loginLimiter } = require('../middleware/auth');
const { processUpload, deleteImageFiles } = require('../services/images');
const captcha = require('../services/captcha');
const stats = require('../services/stats');
const { slugify, uniqueSlug } = require('../utils/slug');

const router = express.Router();

/**
 * هش ساختگی با همان هزینه‌ی هش‌های واقعی (۱۲).
 * فقط برای این است که مسیر «کاربر پیدا نشد» هم دقیقاً همان‌قدر زمان ببرد که
 * مسیر «رمز غلط» می‌برد — جلوگیری از حدس‌زدن نام کاربری از روی زمان پاسخ.
 */
const DUMMY_HASH = bcrypt.hashSync('a-password-that-is-never-valid', 12);

/**
 * پنل مدیریت
 * ------------------------------------------------------------------
 * همه‌ی کارهای مدیر (افزودن محصول، تغییر موجودی، آپلود عکس) از طریق
 * فرم‌های ساده انجام می‌شود. هیچ‌جا نیازی به ویرایش کد یا فایل نیست.
 */

// پنل هرگز نباید در نتایج گوگل بیاید یا کش شود
router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.locals.isAdmin = true;
  // مسیر نسبی داخل پنل (مثلاً /products) برای مشخص‌کردن آیتم فعال منو
  res.locals.currentPath = req.path;
  next();
});

// آپلود عکس در حافظه نگه داشته می‌شود و بلافاصله با sharp پردازش و ذخیره می‌شود
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 8 }, // حداکثر ۱۵ مگابایت برای هر عکس
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.mimetype)) return cb(null, true);
    return cb(new Error('فقط فایل عکس (JPG, PNG, WebP) قابل آپلود است.'));
  },
});

// ============================================================ ورود و خروج

router.get('/login', csrf, (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', {
    title: 'ورود به پنل مدیریت',
    error: null,
    next: req.query.next || '/admin',
    captcha: captcha.issue(req.session),
  });
});

router.post('/login', loginLimiter, express.urlencoded({ extended: false }), csrf, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const nextUrl = String(req.body.next || '/admin');

  // پاسخ ناموفق: همیشه با یک پرسش امنیتی تازه. پرسش قبلی چه درست جواب
  // داده شده باشد چه غلط، مصرف شده و دیگر معتبر نیست.
  const fail = (message) =>
    res.status(401).render('admin/login', {
      title: 'ورود به پنل مدیریت',
      error: message,
      next: nextUrl,
      captcha: captcha.issue(req.session),
    });

  // کپچا قبل از bcrypt سنجیده می‌شود. این ترتیب عمدی است: bcrypt با
  // ۱۲ دور، هر درخواست را حدود ۰.۳ ثانیه از پردازنده می‌گیرد. اگر اول
  // رمز بررسی می‌شد، مهاجم می‌توانست بدون حل کپچا هم سرور را با
  // درخواست‌های پیاپی مشغول کند.
  if (!captcha.verify(req.session, req.body.captcha)) {
    return fail('پاسخ پرسش امنیتی درست نیست. لطفاً دوباره امتحان کنید.');
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

  // اگر کاربر پیدا نشد، باز هم یک مقایسه‌ی bcrypt روی هش ساختگی انجام
  // می‌دهیم. بدون این کار، پاسخِ «نام کاربری وجود ندارد» چند ده برابر
  // سریع‌تر از «رمز غلط» برمی‌گشت (bcrypt عمداً کند است) و مهاجم فقط با
  // اندازه‌گیری زمانِ پاسخ می‌فهمید کدام نام کاربری واقعی است — بعد همه‌ی
  // تلاشش را روی همان یکی متمرکز می‌کرد. پیام خطا از قبل مبهم بود، این
  // زمان‌بندی را هم مبهم می‌کند.
  const ok = admin
    ? bcrypt.compareSync(password, admin.password_hash)
    : (bcrypt.compareSync(password, DUMMY_HASH), false);

  if (!ok) return fail('نام کاربری یا رمز عبور درست نیست.');

  // جلوگیری از session fixation: شناسه‌ی نشست بعد از ورود عوض می‌شود
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.adminId = admin.id;
    req.session.username = admin.username;
    req.session.mustChange = !!admin.must_change;
    // فقط به مسیرهای داخلی سایت اجازه‌ی هدایت می‌دهیم
    const safeNext = nextUrl.startsWith('/') && !nextUrl.startsWith('//') ? nextUrl : '/admin';
    res.redirect(admin.must_change ? '/admin/password?first=1' : safeNext);
  });
});

router.post('/logout', express.urlencoded({ extended: false }), csrf, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// از اینجا به بعد، ورود اجباری است
router.use(requireLogin);
router.use(express.urlencoded({ extended: false, limit: '2mb' }));

// ============================================================ داشبورد

router.get('/', csrf, (req, res) => {
  res.render('admin/dashboard', {
    title: 'پنل مدیریت',
    stats: q.adminStats(),
    recent: q.listProducts({ includeInactive: true, limit: 6 }),
  });
});

// ============================================================ آمار بازدید

router.get('/stats', csrf, (req, res) => {
  // بافر در حافظه را قبل از خواندن خالی می‌کنیم، وگرنه بازدیدهای همین چند
  // ثانیه‌ی اخیر هنوز در دیتابیس نیستند و مالک فکر می‌کند آمار کار نمی‌کند.
  stats.flush();

  const range = {
    today: stats.today(),
    yesterday: stats.daysAgo(1),
    from7: stats.daysAgo(6), // شش روز قبل + امروز = هفت روز
    from30: stats.daysAgo(29),
  };

  res.render('admin/stats', {
    title: 'آمار بازدید سایت',
    range,
    data: q.visitStats(range),
    ga4: getSetting('ga4_id', ''),
  });
});

// ============================================================ محصولات

router.get('/products', csrf, (req, res) => {
  const search = (req.query.q || '').trim();
  res.render('admin/products', {
    title: 'مدیریت محصولات',
    products: q.listProducts({ includeInactive: true, q: search || undefined }),
    categories: q.listCategories(),
    search,
    flash: req.query.ok || null,
  });
});

router.get('/products/new', csrf, (req, res) => {
  res.render('admin/product-form', {
    title: 'افزودن محصول',
    product: null,
    images: [],
    categories: q.listCategories(),
    subcategories: q.listAllSubcategories(),
    error: null,
  });
});

router.get('/products/:id/edit', csrf, (req, res, next) => {
  const product = q.getProductById(Number(req.params.id));
  if (!product) return next();
  res.render('admin/product-form', {
    title: `ویرایش: ${product.name}`,
    product,
    images: q.listProductImages(product.id),
    categories: q.listCategories(),
    subcategories: q.listAllSubcategories(),
    error: null,
    flash: req.query.ok || null,
  });
});

/** خواندن و تمیز کردن مقادیر فرم محصول */
function readProductForm(body) {
  const name = String(body.name || '').trim();
  const categoryId = Number(body.category_id) || null;
  let subcategoryId = body.subcategory_id ? Number(body.subcategory_id) : null;

  // اگر زیردسته به دسته‌ی انتخاب‌شده تعلق ندارد، نادیده گرفته می‌شود
  if (subcategoryId) {
    const sub = db.prepare('SELECT category_id FROM subcategories WHERE id = ?').get(subcategoryId);
    if (!sub || sub.category_id !== categoryId) subcategoryId = null;
  }

  const stockQtyRaw = String(body.stock_qty || '').trim();

  return {
    name,
    category_id: categoryId,
    subcategory_id: subcategoryId,
    summary: String(body.summary || '').trim(),
    description: String(body.description || '').trim(),
    price_text: String(body.price_text || '').trim(),
    unit: String(body.unit || '').trim(),
    in_stock: body.in_stock ? 1 : 0,
    stock_qty: stockQtyRaw === '' ? null : Math.max(0, Number(stockQtyRaw) || 0),
    is_active: body.is_active ? 1 : 0,
    sort_order: Number(body.sort_order) || 0,
  };
}

// --- ساخت محصول جدید (به‌همراه آپلود هم‌زمان چند عکس)
router.post('/products', upload.array('images', 8), csrf, async (req, res, next) => {
  try {
    const data = readProductForm(req.body);

    if (!data.name || !data.category_id) {
      return res.status(400).render('admin/product-form', {
        title: 'افزودن محصول',
        product: { ...data },
        images: [],
        categories: q.listCategories(),
        subcategories: q.listAllSubcategories(),
        error: 'نام محصول و دسته‌بندی الزامی است.',
      });
    }

    const slug = uniqueSlug(
      slugify(data.name),
      (s) => !!db.prepare('SELECT 1 FROM products WHERE slug = ?').get(s)
    );

    const info = db
      .prepare(
        `INSERT INTO products (slug, name, category_id, subcategory_id, summary, description,
                               price_text, unit, in_stock, stock_qty, is_active, sort_order)
         VALUES (@slug, @name, @category_id, @subcategory_id, @summary, @description,
                 @price_text, @unit, @in_stock, @stock_qty, @is_active, @sort_order)`
      )
      .run({ ...data, slug });

    await saveUploadedImages(info.lastInsertRowid, data.name, req.files, req.body.alt);
    res.redirect(`/admin/products/${info.lastInsertRowid}/edit?ok=created`);
  } catch (err) {
    next(err);
  }
});

// --- ویرایش محصول
router.post('/products/:id', upload.array('images', 8), csrf, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = q.getProductById(id);
    if (!existing) return next();

    const data = readProductForm(req.body);
    if (!data.name || !data.category_id) {
      return res.status(400).render('admin/product-form', {
        title: `ویرایش: ${existing.name}`,
        product: { ...existing, ...data },
        images: q.listProductImages(id),
        categories: q.listCategories(),
        subcategories: q.listAllSubcategories(),
        error: 'نام محصول و دسته‌بندی الزامی است.',
      });
    }

    db.prepare(
      `UPDATE products SET name = @name, category_id = @category_id,
              subcategory_id = @subcategory_id, summary = @summary, description = @description,
              price_text = @price_text, unit = @unit, in_stock = @in_stock,
              stock_qty = @stock_qty, is_active = @is_active, sort_order = @sort_order,
              updated_at = datetime('now')
        WHERE id = @id`
    ).run({ ...data, id });

    await saveUploadedImages(id, data.name, req.files, req.body.alt);
    res.redirect(`/admin/products/${id}/edit?ok=saved`);
  } catch (err) {
    next(err);
  }
});

// --- تغییر سریع موجودی از فهرست محصولات (بدون باز کردن فرم)
router.post('/products/:id/stock', csrf, (req, res) => {
  const id = Number(req.params.id);
  const value = req.body.in_stock === '1' ? 1 : 0;
  db.prepare("UPDATE products SET in_stock = ?, updated_at = datetime('now') WHERE id = ?").run(
    value,
    id
  );
  res.redirect(req.get('referer') || '/admin/products');
});

// --- حذف محصول (عکس‌هایش هم از روی دیسک پاک می‌شود)
router.post('/products/:id/delete', csrf, (req, res) => {
  const id = Number(req.params.id);
  for (const img of q.listProductImages(id)) deleteImageFiles(img.basename);
  db.prepare('DELETE FROM products WHERE id = ?').run(id); // عکس‌ها با ON DELETE CASCADE پاک می‌شوند
  res.redirect('/admin/products?ok=deleted');
});

// ============================================================ عکس‌ها

/** ذخیره‌ی عکس‌های آپلودشده برای یک محصول */
async function saveUploadedImages(productId, productName, files, altText) {
  if (!files || !files.length) return;

  const maxRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_images WHERE product_id = ?')
    .get(productId);
  let order = maxRow.m + 1;

  const insert = db.prepare(
    `INSERT INTO product_images (product_id, basename, alt, width, height, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const file of files) {
    const { basename, width, height } = await processUpload(file.buffer, productName);
    const alt =
      String(altText || '').trim() ||
      `${productName} — فولاد ایمان، علی‌آباد کتول و گرگان`;
    insert.run(productId, basename, alt, width, height, order);
    order += 1;
  }
}

// --- حذف یک عکس
router.post('/images/:id/delete', csrf, (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id = ?').get(Number(req.params.id));
  if (img) {
    deleteImageFiles(img.basename);
    db.prepare('DELETE FROM product_images WHERE id = ?').run(img.id);
  }
  res.redirect(req.get('referer') || '/admin/products');
});

// --- انتخاب عکس اصلی (عکسی که در گرید محصولات نشان داده می‌شود)
router.post('/images/:id/primary', csrf, (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id = ?').get(Number(req.params.id));
  if (img) {
    const shift = db.transaction(() => {
      db.prepare('UPDATE product_images SET sort_order = sort_order + 1 WHERE product_id = ?').run(
        img.product_id
      );
      db.prepare('UPDATE product_images SET sort_order = 0 WHERE id = ?').run(img.id);
    });
    shift();
  }
  res.redirect(req.get('referer') || '/admin/products');
});

// ============================================================ دسته‌بندی‌ها

router.get('/categories', csrf, (req, res) => {
  res.render('admin/categories', {
    title: 'دسته‌بندی‌ها',
    categories: q.listCategories().map((c) => ({ ...c, subs: q.listSubcategories(c.id) })),
    flash: req.query.ok || null,
    error: req.query.err || null,
  });
});

router.post('/categories', csrf, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.redirect('/admin/categories?err=' + encodeURIComponent('نام دسته خالی است.'));

  const slug = uniqueSlug(
    slugify(name),
    (s) => !!db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(s)
  );
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM categories').get().m;
  db.prepare(
    'INSERT INTO categories (slug, name, description, sort_order, is_featured) VALUES (?, ?, ?, ?, ?)'
  ).run(slug, name, String(req.body.description || '').trim(), max + 1, req.body.is_featured ? 1 : 0);

  res.redirect('/admin/categories?ok=added');
});

router.post('/categories/:id', csrf, (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  if (!name) return res.redirect('/admin/categories?err=' + encodeURIComponent('نام دسته خالی است.'));

  db.prepare(
    'UPDATE categories SET name = ?, description = ?, sort_order = ?, is_featured = ? WHERE id = ?'
  ).run(
    name,
    String(req.body.description || '').trim(),
    Number(req.body.sort_order) || 0,
    req.body.is_featured ? 1 : 0,
    id
  );
  res.redirect('/admin/categories?ok=saved');
});

router.post('/categories/:id/delete', csrf, (req, res) => {
  const id = Number(req.params.id);
  const count = db.prepare('SELECT COUNT(*) n FROM products WHERE category_id = ?').get(id).n;
  if (count > 0) {
    return res.redirect(
      '/admin/categories?err=' +
        encodeURIComponent(`این دسته ${count} محصول دارد؛ اول محصول‌ها را حذف یا جابه‌جا کنید.`)
    );
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.redirect('/admin/categories?ok=deleted');
});

router.post('/subcategories', csrf, (req, res) => {
  const categoryId = Number(req.body.category_id);
  const name = String(req.body.name || '').trim();
  if (!categoryId || !name) return res.redirect('/admin/categories');

  const slug = uniqueSlug(
    slugify(name),
    (s) => !!db.prepare('SELECT 1 FROM subcategories WHERE category_id = ? AND slug = ?').get(categoryId, s)
  );
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) m FROM subcategories WHERE category_id = ?')
    .get(categoryId).m;
  db.prepare('INSERT INTO subcategories (category_id, slug, name, sort_order) VALUES (?, ?, ?, ?)').run(
    categoryId,
    slug,
    name,
    max + 1
  );
  res.redirect('/admin/categories?ok=added');
});

router.post('/subcategories/:id/delete', csrf, (req, res) => {
  db.prepare('DELETE FROM subcategories WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/categories?ok=deleted');
});

// ======================================================= نظرات مشتریان

router.get('/reviews', csrf, (req, res) => {
  res.render('admin/reviews', {
    title: 'نظرات مشتریان',
    reviews: q.listTestimonials({ includeInactive: true }),
    editing: req.query.edit ? q.getTestimonial(Number(req.query.edit)) : null,
    flash: req.query.ok || null,
  });
});

/** خواندن فیلدهای فرم نظر */
function readReviewForm(body) {
  return {
    name: String(body.name || '').trim().slice(0, 60),
    city: String(body.city || '').trim().slice(0, 40),
    job: String(body.job || '').trim().slice(0, 60),
    text: String(body.text || '').trim().slice(0, 1000),
    rating: Math.max(1, Math.min(5, Number(body.rating) || 5)),
    is_active: body.is_active ? 1 : 0,
    sort_order: Number(body.sort_order) || 0,
  };
}

router.post('/reviews', csrf, (req, res) => {
  const d = readReviewForm(req.body);
  if (!d.name || !d.text) return res.redirect('/admin/reviews');

  db.prepare(
    `INSERT INTO testimonials (name, city, job, text, rating, is_active, sort_order)
     VALUES (@name, @city, @job, @text, @rating, @is_active, @sort_order)`
  ).run(d);
  res.redirect('/admin/reviews?ok=added');
});

router.post('/reviews/:id', csrf, (req, res) => {
  const d = readReviewForm(req.body);
  if (!d.name || !d.text) return res.redirect('/admin/reviews');

  db.prepare(
    `UPDATE testimonials SET name = @name, city = @city, job = @job, text = @text,
            rating = @rating, is_active = @is_active, sort_order = @sort_order
      WHERE id = @id`
  ).run({ ...d, id: Number(req.params.id) });
  res.redirect('/admin/reviews?ok=saved');
});

router.post('/reviews/:id/delete', csrf, (req, res) => {
  db.prepare('DELETE FROM testimonials WHERE id = ?').run(Number(req.params.id));
  res.redirect('/admin/reviews?ok=deleted');
});

/** حذف یک‌جای همه‌ی نظرات نمونه — برای وقتی مدیر نظرات واقعی را وارد کرد */
router.post('/reviews/clear-samples', csrf, (req, res) => {
  db.prepare("DELETE FROM testimonials WHERE name LIKE '%(نمونه)%'").run();
  res.redirect('/admin/reviews?ok=deleted');
});

// ============================================================ متن‌های سایت

// کلیدهایی که از فرم «متن‌های سایت» قابل ویرایش‌اند
const SETTING_KEYS = [
  'hero_title',
  'hero_subtitle',
  'hero_text',
  'about_text',
  'map_embed',
  // آمار اعتمادسازی
  'stat_years',
  'stat_models',
  'stats_note',
  // بخش معرفی مدیر
  'owner_name',
  'owner_title',
  'owner_quote',
  'owner_text',
  // ابزارهای موتور جست‌وجو و آمار
  'ga4_id',
  'google_site_verification',
];

router.get('/settings', csrf, (req, res) => {
  const values = {};
  for (const key of SETTING_KEYS) values[key] = getSetting(key);
  values.owner_image = getSetting('owner_image');

  res.render('admin/settings', {
    title: 'متن‌ها و آمار سایت',
    values,
    flash: req.query.ok || null,
  });
});

router.post('/settings', upload.single('owner_photo'), csrf, async (req, res, next) => {
  try {
    for (const key of SETTING_KEYS) {
      if (key in req.body) setSetting(key, String(req.body[key]).slice(0, 4000));
    }

    // آپلود عکس جدید مدیر (اختیاری) — جایگزین عکس قبلی می‌شود
    if (req.file) {
      const old = getSetting('owner_image');
      const { basename } = await processUpload(req.file.buffer, 'modir');
      setSetting('owner_image', basename);
      if (old) deleteImageFiles(old);
    }

    // بازگشت به عکس پیش‌فرض
    if (req.body.remove_owner_photo) {
      const old = getSetting('owner_image');
      if (old) deleteImageFiles(old);
      setSetting('owner_image', '');
    }

    res.redirect('/admin/settings?ok=saved');
  } catch (err) {
    next(err);
  }
});

// ============================================================ تغییر رمز عبور

router.get('/password', csrf, (req, res) => {
  res.render('admin/password', {
    title: 'تغییر رمز عبور',
    first: req.query.first === '1' || !!req.session.mustChange,
    error: null,
    flash: req.query.ok || null,
  });
});

router.post('/password', csrf, (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  const confirm = String(req.body.confirm || '');

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.session.adminId);
  const view = (error) =>
    res.status(400).render('admin/password', {
      title: 'تغییر رمز عبور',
      first: !!req.session.mustChange,
      error,
      flash: null,
    });

  if (!admin || !bcrypt.compareSync(current, admin.password_hash))
    return view('رمز عبور فعلی درست نیست.');
  if (next.length < 8) return view('رمز جدید باید حداقل ۸ کاراکتر باشد.');
  if (next !== confirm) return view('رمز جدید و تکرار آن یکی نیستند.');
  if (bcrypt.compareSync(next, admin.password_hash))
    return view('رمز جدید باید با رمز فعلی فرق داشته باشد.');

  db.prepare('UPDATE admins SET password_hash = ?, must_change = 0 WHERE id = ?').run(
    bcrypt.hashSync(next, 12),
    admin.id
  );
  req.session.mustChange = false;
  res.redirect('/admin/password?ok=changed');
});

// ============================================================ خطاها

// خطاهای مخصوص آپلود (حجم زیاد، فرمت اشتباه) با پیام فارسی نمایش داده می‌شوند
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  let message = err.message || 'خطای ناشناخته';
  if (err.code === 'LIMIT_FILE_SIZE') message = 'حجم عکس بیش از ۱۵ مگابایت است.';
  if (err.code === 'LIMIT_FILE_COUNT') message = 'حداکثر ۸ عکس در هر بار قابل آپلود است.';
  console.error('[پنل مدیریت]', err);
  res.status(400).render('admin/error', { title: 'خطا', message });
});

module.exports = router;
