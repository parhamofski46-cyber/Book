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

  res.render('public/home', {
    title: `${site.name} | آهن‌آلات و فرفورژه در علی‌آباد کتول و گرگان`,
    metaDescription: truncate(site.description),
    categories,
    featuredCategory: featured,
    latest: q.listProducts({ limit: 8 }),
    forgeProducts: featured ? q.listProducts({ category: featured.slug, limit: 6 }) : [],
    hero: {
      title: getSetting('hero_title', site.name),
      subtitle: getSetting('hero_subtitle', site.tagline),
      text: getSetting('hero_text', ''),
    },
    aboutText: getSetting('about_text', ''),
    mapEmbed: getSetting('map_embed', ''),
    reviews: q.listTestimonials({ limit: 6 }),
    reviewSummary: q.testimonialSummary(),
    isHome: true,
  });
});

// ----------------------------------------------------------- کاتالوگ محصولات
router.get('/products', (req, res) => {
  cachePublic(res);

  const categories = q.listCategories();
  const category = req.query.cat ? q.getCategoryBySlug(req.query.cat) : null;
  const subcategories = category ? q.listSubcategories(category.id) : [];
  const search = (req.query.q || '').trim().slice(0, 60);
  const onlyInStock = req.query.stock === '1';

  const products = q.listProducts({
    category: category ? category.slug : undefined,
    subcategory: req.query.sub || undefined,
    q: search || undefined,
    onlyInStock,
  });

  const title = category
    ? `${category.name} | خرید در علی‌آباد کتول و گرگان — ${site.shortName}`
    : `محصولات | آهن‌آلات و فرفورژه در علی‌آباد کتول و گرگان — ${site.shortName}`;

  res.render('public/products', {
    title,
    metaDescription: category
      ? truncate(`${category.name} — ${category.description} | ${site.name}، علی‌آباد کتول و گرگان.`)
      : truncate(site.description),
    categories,
    category,
    subcategories,
    activeSub: req.query.sub || '',
    products,
    search,
    onlyInStock,
  });
});

// ------------------------------------------------- بخش ویژه‌ی گل‌های فرفورژه
router.get('/forge', (req, res, next) => {
  const featured = q.listCategories().find((c) => c.is_featured);
  if (!featured) return next();

  cachePublic(res);
  const subs = q.listSubcategories(featured.id);

  res.render('public/forge', {
    title: `گل و طرح‌های فرفورژه | نرده، درب و حفاظ پنجره در گرگان و علی‌آباد کتول`,
    metaDescription: truncate(
      'گالری گل و طرح‌های فرفورژه دست‌ساز فولاد ایمان برای نرده، درب حیاط و حفاظ پنجره — ' +
        'ساخت و نصب در علی‌آباد کتول و گرگان.'
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
    { loc: '/contact', priority: '0.6', changefreq: 'monthly' },
  ];

  for (const c of q.listCategories()) {
    urls.push({
      loc: `/products?cat=${encodeURIComponent(c.slug)}`,
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
