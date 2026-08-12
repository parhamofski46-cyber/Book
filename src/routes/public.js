'use strict';

const express = require('express');
const { site } = require('../config/site');
const { getSetting } = require('../db');
const q = require('../db/queries');
const { truncate } = require('../utils/view-helpers');

const router = express.Router();

/**
 * صفحات عمومی سایت.
 * همه‌ی صفحات روی سرور رندر می‌شوند (server-side rendering) و داده را
 * مستقیم از SQLite می‌خوانند؛ چیزی در مرورگر بارگذاری نمی‌شود که سرعت را بگیرد.
 */

// کش کوتاه سمت مرورگر + ETag ⇒ بازدید دوم تقریباً آنی باز می‌شود
function cachePublic(res, seconds = 300) {
  res.set('Cache-Control', `public, max-age=0, s-maxage=${seconds}, must-revalidate`);
}

// --------------------------------------------------------------- صفحه‌ی اصلی
router.get('/', (req, res) => {
  cachePublic(res);

  const categories = q.listCategories();
  const featured = categories.find((c) => c.is_featured) || null;
  // دسته‌ی شاخص اول گرید بیاید — هم اولویت بصری درست می‌شود و هم
  // کارت دو-ستونه‌اش وسط ردیف حفره ایجاد نمی‌کند
  const gridCategories = [...categories].sort((a, b) => b.is_featured - a.is_featured);

  res.render('public/home', {
    title: `${site.name} | آهن‌آلات و فرفورژه در علی‌آباد کتول و گرگان`,
    metaDescription: truncate(site.description),
    categories,
    gridCategories,
    featuredCategory: featured,
    latest: q.listProducts({ limit: 6 }),
    forgeProducts: featured ? q.listProducts({ category: featured.slug, limit: 4 }) : [],
    hero: {
      title: getSetting('hero_title', site.name),
      subtitle: getSetting('hero_subtitle', site.tagline),
      text: getSetting('hero_text', ''),
    },
    aboutText: getSetting('about_text', ''),
    mapEmbed: getSetting('map_embed', ''),
    reviews: q.listTestimonials({ limit: 6 }),
    reviewSummary: q.testimonialSummary(),
    statCategoryCount: categories.length, // برای نوار آمار — عدد واقعی از دیتابیس
    isHome: true,
  });
});

// ----------------------------------------------------------- کاتالوگ محصولات
/**
 * رندر فهرست محصولات — هم برای /products و هم برای آدرس تمیز دسته.
 * آدرس تمیز (/category/قوطی) برای سئو خیلی بهتر از پارامتر پرس‌وجو
 * (/products?cat=قوطی) است؛ گوگل آن را یک صفحه‌ی مستقل با موضوع مشخص می‌بیند.
 */
function renderProductList(req, res, category) {
  cachePublic(res);

  const categories = q.listCategories();
  const subcategories = category ? q.listSubcategories(category.id) : [];
  const search = (req.query.q || '').trim().slice(0, 60);
  const onlyInStock = req.query.stock === '1';

  const products = q.listProducts({
    category: category ? category.slug : undefined,
    subcategory: req.query.sub || undefined,
    q: search || undefined,
    onlyInStock,
  });

  const cityLine = 'علی‌آباد کتول و گرگان';
  const title = category
    ? `${category.name} | قیمت و خرید در ${cityLine} — ${site.shortName}`
    : `همه‌ی محصولات | آهن‌آلات، ورق گالوانیزه و فرفورژه در ${cityLine}`;

  res.render('public/products', {
    title,
    metaDescription: category
      ? truncate(
          `خرید ${category.name} در ${cityLine}. ${category.description} ` +
            `موجودی به‌روز، قیمت روز و ارسال به سراسر استان گلستان — ${site.name}.`
        )
      : truncate(site.description),
    categories,
    category,
    subcategories,
    activeSub: req.query.sub || '',
    products,
    search,
    onlyInStock,
  });
}

// آدرس تمیز هر دسته — نسخه‌ی اصلی و canonical
router.get('/category/:slug', (req, res, next) => {
  const category = q.getCategoryBySlug(req.params.slug);
  if (!category) return next();
  renderProductList(req, res, category);
});

// فهرست کامل محصولات
router.get('/products', (req, res) => {
  // آدرس قدیمی با پارامتر ?cat= به آدرس تمیز منتقل می‌شود تا اعتبار سئویی
  // بین دو آدرس تقسیم نشود (redirect دائمی ۳۰۱)
  if (req.query.cat && !req.query.sub && !req.query.q && !req.query.stock) {
    const c = q.getCategoryBySlug(req.query.cat);
    if (c) return res.redirect(301, '/category/' + encodeURIComponent(c.slug));
  }
  const category = req.query.cat ? q.getCategoryBySlug(req.query.cat) : null;
  renderProductList(req, res, category);
});

// ------------------------------------------------- بخش ویژه‌ی گل‌های فرفورژه
router.get('/forge', (req, res, next) => {
  const featured = q.listCategories().find((c) => c.is_featured);
  if (!featured) return next();

  cachePublic(res);
  const subs = q.listSubcategories(featured.id);

  res.render('public/forge', {
    title: `بیش از ۱۰۰۰ مدل گل و طرح فرفورژه | درب، پنجره و نرده — علی‌آباد کتول و گرگان`,
    metaDescription: truncate(
      'گالری گل و طرح‌های آماده‌ی فرفورژه فولاد ایمان برای نرده، درب حیاط و حفاظ پنجره؛ ' +
        'بیش از ۱۰۰۰ مدل موجود در انبار علی‌آباد کتول، آماده‌ی تحویل و ارسال به گرگان.'
    ),
    category: featured,
    subcategories: subs.map((s) => ({
      ...s,
      products: q.listProducts({ category: featured.slug, subcategory: s.slug }),
    })),
    others: q.listProducts({ category: featured.slug }).filter((p) => !p.subcategory_id),
  });
});

// ------------------------------------------------------ صفحه‌ی جزئیات محصول
router.get('/product/:slug', (req, res, next) => {
  const product = q.getProductBySlug(req.params.slug);
  if (!product || !product.is_active) return next();

  cachePublic(res);
  const images = q.listProductImages(product.id);

  res.render('public/product', {
    title: `${product.name} | قیمت و خرید در علی‌آباد کتول و گرگان — ${site.shortName}`,
    metaDescription: truncate(
      `${product.name} — ${product.summary || product.description} | فروش در علی‌آباد کتول و گرگان، ${site.name}.`
    ),
    product,
    images,
    related: q.relatedProducts(product),
  });
});

// ------------------------------------------------------- درباره‌ی ما
/**
 * صفحه‌ی «درباره‌ی ما».
 * قبلاً این محتوا ته صفحه‌ی اصلی بود و آن را خیلی بلند می‌کرد. حالا صفحه‌ی
 * مستقل خودش را دارد: هم صفحه‌ی اصلی سبک شد، هم این صفحه آدرس ثابتی گرفت که
 * می‌شود در منو، فوتر و گوگل به آن لینک داد (لینک لنگری «/#about» روی گوشی و
 * داخل قاب پیش‌نمایش گاهی کار نمی‌کرد).
 */
router.get('/about', (req, res) => {
  cachePublic(res);
  res.render('public/about', {
    title: `درباره‌ی ${site.name} | آهن‌آلات و فرفورژه در علی‌آباد کتول`,
    metaDescription: truncate(
      `${site.name} در علی‌آباد کتول: تولید ورق گالوانیزه، بیش از ۱۰۰۰ مدل گل فرفورژه‌ی آماده ` +
        `و عرضه‌ی آهن‌آلات ساختمانی با ارسال به گرگان و سراسر گلستان. آدرس: ${site.address.full}.`
    ),
    aboutText: getSetting('about_text', ''),
    mapEmbed: getSetting('map_embed', ''),
    statCategoryCount: q.listCategories().length,
  });
});

// ------------------------------------------------------- نظر مشتریان
/**
 * صفحه‌ی نظرات مشتریان با داده‌ی ساختاریافته‌ی Review.
 * داشتن آدرس مستقل باعث می‌شود گوگل بتواند ستاره‌ها را در نتایج نشان دهد.
 */
router.get('/reviews', (req, res) => {
  cachePublic(res);
  res.render('public/reviews', {
    title: `نظر مشتریان ${site.name} | تجربه‌ی خرید در علی‌آباد کتول و گرگان`,
    metaDescription: truncate(
      `نظر پیمانکارها و مشتری‌های ${site.name} درباره‌ی کیفیت جنس، قیمت و تحویل بار ` +
        `در علی‌آباد کتول، گرگان و شهرهای اطراف.`
    ),
    reviews: q.listTestimonials({}),
  });
});

// ------------------------------------------------------------ تماس با ما
router.get('/contact', (req, res) => {
  cachePublic(res);
  res.render('public/contact', {
    title: `تماس با ${site.name} | علی‌آباد کتول و گرگان`,
    metaDescription: truncate(
      `شماره تماس و واتساپ ${site.name} برای استعلام قیمت آهن‌آلات و سفارش فرفورژه در علی‌آباد کتول و گرگان.`
    ),
    mapEmbed: getSetting('map_embed', ''),
  });
});

// ----------------------------------------------------------- سئو: sitemap
router.get('/sitemap.xml', (req, res) => {
  const urls = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/products', priority: '0.9', changefreq: 'weekly' },
    { loc: '/forge', priority: '0.9', changefreq: 'weekly' },
    { loc: '/about', priority: '0.7', changefreq: 'monthly' },
    { loc: '/reviews', priority: '0.7', changefreq: 'monthly' },
    { loc: '/contact', priority: '0.6', changefreq: 'monthly' },
  ];

  for (const c of q.listCategories()) {
    urls.push({
      loc: `/category/${encodeURIComponent(c.slug)}`,
      priority: '0.8',
      changefreq: 'weekly',
    });
  }
  for (const p of q.listProducts()) {
    urls.push({
      loc: `/product/${encodeURIComponent(p.slug)}`,
      priority: '0.7',
      changefreq: 'weekly',
      lastmod: (p.updated_at || '').slice(0, 10) || undefined,
    });
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${site.url}${u.loc}</loc>` +
          (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
          `<changefreq>${u.changefreq}</changefreq>` +
          `<priority>${u.priority}</priority></url>`
      )
      .join('\n') +
    `\n</urlset>\n`;

  res.type('application/xml').send(xml);
});

router.get('/robots.txt', (req, res) => {
  res
    .type('text/plain')
    .send(`User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${site.url}/sitemap.xml\n`);
});

module.exports = router;
