'use strict';

const express = require('express');
const { site, mapEmbedFrom, mapDirectionsUrl, mapPlaceUrl } = require('../config/site');
const { getSetting } = require('../db');
const q = require('../db/queries');
const { truncate, categoryCover } = require('../utils/view-helpers');
const h = require('../utils/view-helpers');
const articles = require('../content/articles');
const faq = require('../content/faq');
const cities = require('../content/cities');

const router = express.Router();

/**
 * صفحات عمومی سایت.
 * همه‌ی صفحات روی سرور رندر می‌شوند (server-side rendering) و داده را
 * مستقیم از SQLite می‌خوانند؛ چیزی در مرورگر بارگذاری نمی‌شود که سرعت را بگیرد.
 */

/**
 * آدرس‌های قدیمی با املای «رابیس» → «رابیتس» (انتقال دائمی ۳۰۱).
 *
 * املای محصول و دسته به خواست مالک عوض شد و چون اسلاگ‌ها فارسی‌اند، آدرس
 * دسته و همه‌ی محصولاتش هم عوض شد. بدون این قانون، هر لینکی که مشتری
 * ذخیره کرده یا گوگل ایندکس کرده بود ۴۰۴ می‌شد.
 *
 * ۳۰۱ (نه ۳۰۲) عمدی است: به گوگل می‌گوید آدرس برای همیشه جابه‌جا شده و
 * اعتبار سئوی صفحه‌ی قدیمی به صفحه‌ی جدید منتقل شود.
 */
router.use(function (req, res, next) {
  let decoded;
  try {
    decoded = decodeURIComponent(req.path);
  } catch (err) {
    return next(); // آدرس خراب — بگذار مسیر عادی ۴۰۴ بدهد
  }
  // پارامتر قدیمی ?cat=رابیس هم اصلاح می‌شود تا مسیر /products خودش دسته را
  // پیدا کند و ۳۰۱ همیشگی‌اش را به آدرس تمیز بدهد.
  if (typeof req.query.cat === 'string' && req.query.cat.indexOf('رابیس') !== -1) {
    req.query.cat = req.query.cat.replace(/رابیس/g, 'رابیتس');
  }
  if (decoded.indexOf('رابیس') === -1) return next();

  const target = decoded
    .replace(/رابیس/g, 'رابیتس')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const qs = req.originalUrl.slice(req.path.length); // رشته‌ی پرس‌وجو، اگر بود
  res.redirect(301, target + qs);
});

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
    title: `آهن‌فروشی گرگان و علی‌آباد کتول | ${site.shortName}`,
    metaDescription: truncate(site.description),
    categories,
    gridCategories,
    // عکس کارت هر دسته از محصولات همان دسته می‌آید (پایین را ببین)
    catCovers: categoryCover(q.categoryCoverCandidates()),
    featuredCategory: featured,
    latest: q.listProducts({ limit: 6 }),
    forgeProducts: featured ? q.listProducts({ category: featured.slug, limit: 4 }) : [],
    hero: {
      title: getSetting('hero_title', site.name),
      subtitle: getSetting('hero_subtitle', site.tagline),
      text: getSetting('hero_text', ''),
    },
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
/**
 * منوی «انتخاب سایز قوطی».
 *
 * قوطی تنها دسته‌ای است که مشتری معمولاً با یک سایز مشخص در ذهنش سراغش
 * می‌آید («قوطی ۴۰×۴۰ داری؟»). به‌جای اینکه مجبور شود بین ۱۶ کارت بگردد،
 * یک منوی جمع‌وجور می‌گیرد که مستقیم به صفحه‌ی همان سایز می‌رود.
 *
 * دسته با اسلاگ پیدا می‌شود؛ اگر مدیر دسته را حذف یا تغییرنام داده باشد،
 * منو به‌جای خطا فقط نمایش داده نمی‌شود.
 */
function ghoutiSizeGroups() {
  const cat = q.getCategoryBySlug('قوطی');
  if (!cat) return null;

  const products = q.listProducts({ category: cat.slug });
  if (products.length < 2) return null;

  const groups = q
    .listSubcategories(cat.id)
    .map((s) => ({ name: s.name, items: products.filter((p) => p.subcategory_id === s.id) }))
    .filter((g) => g.items.length);

  const loose = products.filter((p) => !p.subcategory_id);
  if (loose.length) groups.push({ name: 'سایر سایزها', items: loose });

  return { category: cat, groups, total: products.length };
}

function renderProductList(req, res, category) {
  cachePublic(res);

  const categories = q.listCategories();
  const subcategories = category ? q.listSubcategories(category.id) : [];
  const search = (req.query.q || '').trim().slice(0, 60);
  const onlyInStock = req.query.stock === '1';

  // صفحه‌بندی. دسته‌ی فرفورژه صدها مدل دارد؛ بدون این، صفحه ده‌ها هزار پیکسل
  // بلند می‌شد و روی گوشی نه باز می‌شد نه قابل پیمایش بود.
  const PER_PAGE = 48;
  const filters = {
    category: category ? category.slug : undefined,
    subcategory: req.query.sub || undefined,
    q: search || undefined,
    onlyInStock,
  };
  const total = q.countProducts(filters);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);

  const products = q.listProducts({
    ...filters,
    limit: PER_PAGE,
    offset: (page - 1) * PER_PAGE,
  });

  const cityLine = 'علی‌آباد کتول و گرگان';
  const title = category
    ? `${category.name} | قیمت و خرید در ${cityLine} — ${site.shortName}`
    : `همه‌ی محصولات | آهن‌آلات، ورق گالوانیزه و فرفورژه در ${cityLine}`;

  res.render('public/products', {
    title,
    // نتیجه‌ی جست‌وجو و فیلتر موجودی ایندکس نمی‌شوند (بالای head.ejs توضیح
    // داده شده). خودِ دسته و صفحه‌های بعدی‌اش ایندکس می‌شوند.
    robotsMeta: search || onlyInStock || req.query.sub ? 'noindex, follow' : null,
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
    page,
    pages,
    total,
    perPage: PER_PAGE,
    // منوی سایز فقط جایی نشان داده می‌شود که به کار می‌آید: فهرست کل
    // محصولات و خود دسته‌ی قوطی. روی دسته‌های دیگر فقط شلوغی است.
    ghouti: (() => {
      const g = ghoutiSizeGroups();
      if (!g) return null;
      const relevant = !category || category.slug === g.category.slug;
      return relevant ? g : null;
    })(),
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

// ------------------------------------------------------------ صفحه‌های شهری
/**
 * صفحه‌ی اختصاصی هر شهرِ منطقه‌ی خدمات.
 *
 * هدف: عبارت‌هایی مثل «آهن فروشی گرگان» یا «ورق گالوانیزه رامیان». آدرس
 * صفحه هم عمداً همان عبارت است (`/آهن-فروشی-گرگان`).
 *
 * ⚠️ این صفحه‌ها فقط وقتی ارزش دارند که متنشان واقعاً متفاوت باشد؛ اگر
 * روزی خواستی شهر جدیدی اضافه کنی، در `src/content/cities.js` برایش متن
 * اختصاصی بنویس — کپی کردن متن شهر دیگر، از نظر گوگل صفحه‌ی دروازه‌ای است
 * و به کل سایت ضرر می‌زند.
 */
router.get('/:slug', (req, res, next) => {
  const city = cities.bySlug(req.params.slug);
  if (!city) return next();

  cachePublic(res, 3600);

  const all = q.listCategories();
  // دسته‌های پرتقاضای همان شهر، به همان ترتیبی که در محتوا آمده
  const popular = city.popular
    .map((name) => all.find((c) => c.name.indexOf(name) === 0 || name.indexOf(c.name) === 0))
    .filter(Boolean);

  const serviceSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: 'فروش آهن‌آلات، ورق گالوانیزه و گل و طرح فرفورژه',
    provider: { '@type': 'LocalBusiness', name: site.name, telephone: '+' + site.phoneIntl, url: site.url },
    areaServed: { '@type': 'City', name: city.name, containedInPlace: { '@type': 'State', name: 'استان گلستان' } },
    url: site.url + encodeURI(city.url),
  };

  res.render('public/city', {
    title: `آهن‌فروشی ${city.name} | خرید قوطی، ورق گالوانیزه و فرفورژه — ${site.shortName}`,
    metaDescription: truncate(
      `خرید آهن‌آلات در ${city.name}: قوطی و پروفیل، نبشی، رابیتس، فنس و ایزوگام، ` +
        `ورق گالوانیزه‌ی تولید خودمان و بیش از ۶۰۰ مدل گل و طرح فرفورژه. ` +
        `${city.home ? 'انبار ما در همین شهر است.' : `ارسال به ${city.name} با قیمت روز.`} ` +
        `استعلام قیمت در واتساپ: ${site.phone}`
    ),
    city,
    popular,
    others: cities.cities.filter((c) => c.slug !== city.slug),
    serviceSchema,
  });
});

// --------------------------------------------------------- سؤال‌های متداول
/**
 * صفحه‌ی مستقل سؤال‌های متداول.
 *
 * چرا صفحه‌ی جدا و نه فقط یک بخش در «تماس با ما»: هر پرسش یک جست‌وجوی
 * واقعی مردم است («ورق گالوانیزه چند میل است؟»، «فرفورژه نصب هم می‌کنید؟»).
 * وقتی همه در یک صفحه‌ی موضوعی جمع باشند، گوگل آن صفحه را برای همان
 * پرسش‌ها بالا می‌آورد و با داده‌ی ساختاریافته‌ی FAQPage می‌تواند پاسخ را
 * مستقیم زیر نتیجه نشان بدهد.
 */
router.get('/faq', (req, res) => {
  cachePublic(res, 3600);
  res.render('public/faq', {
    title: `سؤال‌های متداول | ${site.shortName} — آهن‌آلات و ورق گالوانیزه گرگان و علی‌آباد کتول`,
    metaDescription: truncate(
      'پاسخ سؤال‌های پرتکرار درباره‌ی خرید آهن‌آلات در گرگان و علی‌آباد کتول: ' +
        'استعلام قیمت، هزینه و زمان ارسال، ضخامت و طرح ورق گالوانیزه، ' +
        'گل و طرح‌های فرفورژه، و آدرس و ساعات کاری فولاد ایمان.'
    ),
    GROUPS: faq.GROUPS,
    faqSchema: faq.faqSchema(faq.allItems()),
  });
});

// ------------------------------------------------- بخش ویژه‌ی گل‌های فرفورژه
router.get('/forge', (req, res, next) => {
  const featured = q.listCategories().find((c) => c.is_featured);
  if (!featured) return next();

  cachePublic(res);
  const subs = q.listSubcategories(featured.id);

  // گالری هم صفحه‌بندی می‌شود: کاتالوگ صدها مدل دارد و نمایش یک‌جا، هم صفحه
  // را غیرقابل استفاده می‌کرد هم صدها تصویر را به مرورگر تحمیل می‌کرد.
  const PER_PAGE = 60;
  const totalForge = q.countProducts({ category: featured.slug });
  const forgePages = Math.max(1, Math.ceil(totalForge / PER_PAGE));
  const forgePage = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), forgePages);

  res.render('public/forge', {
    page: forgePage,
    pages: forgePages,
    total: totalForge,
    title: `فرفورژه گرگان و علی‌آباد کتول | بیش از ۶۰۰ مدل گل و طرح — درب، پنجره و نرده`,
    metaDescription: truncate(
      'گالری فرفورژه گرگان و علی‌آباد کتول: گل و طرح‌های آماده‌ی فولاد ایمان برای نرده، درب ' +
        'حیاط و حفاظ پنجره؛ بیش از ۶۰۰ مدل موجود در انبار، آماده‌ی تحویل و ارسال به گرگان.'
    ),
    category: featured,
    subcategories: subs.map((s) => ({
      ...s,
      products: q.listProducts({ category: featured.slug, subcategory: s.slug }),
    })),
    others: q.listProducts({
      category: featured.slug,
      limit: PER_PAGE,
      offset: (forgePage - 1) * PER_PAGE,
    }).filter((p) => !p.subcategory_id),
  });
});

// ------------------------------------------------- محاسبه‌گر وزن آهن
/**
 * صفحه‌ی محاسبه‌ی وزن مقاطع فولادی.
 *
 * کاملاً سمت مرورگر حساب می‌شود (public/js/calc.js) و هیچ داده‌ای از سرور
 * نمی‌خواهد، پس اینجا فقط قالب رندر می‌شود. برای سئو ارزش زیادی دارد:
 * «وزن قوطی»، «محاسبه وزن آهن» و مانند آن‌ها جست‌وجوی پرحجم‌اند و مشتری را
 * درست سر بزنگاهِ تصمیم خرید به سایت می‌آورند.
 */
router.get('/calculator', (req, res) => {
  cachePublic(res);
  res.render('public/calculator', {
    title: 'محاسبه‌گر وزن آهن | وزن قوطی، نبشی، لوله، میلگرد و ورق — فولاد ایمان',
    metaDescription: truncate(
      'محاسبه‌ی آنلاین وزن آهن: قوطی، نبشی، لوله، میلگرد، تسمه و ورق. ابعاد را وارد کنید ' +
        'تا وزن هر شاخه و وزن کل بار را ببینید. فولاد ایمان، علی‌آباد کتول و گرگان.'
    ),
  });
});

// ------------------------------------------------------------------ مقالات
/**
 * مقاله‌ها از فایل خوانده می‌شوند (src/content/articles.js)، نه از دیتابیس.
 * دلیلش در همان فایل توضیح داده شده: متن‌های بلندِ کم‌تغییر که باید زیر گیت
 * بمانند و با هر دیپلوی همراه بروند.
 */
router.get('/blog', (req, res) => {
  cachePublic(res, 900);
  res.render('public/blog', {
    title: 'مقالات آهن‌آلات و مصالح | راهنمای خرید و اجرا — فولاد ایمان',
    metaDescription: truncate(
      'راهنمای خرید و اجرا: وزن و سایز قوطی و پروفیل، رابیتس و سقف کاذب، ورق گالوانیزه ' +
        'و شیروانی، عایق، ایزوگام، فنس و فرفورژه. نوشته‌ی فولاد ایمان، علی‌آباد کتول.'
    ),
    articles: articles.listArticles(),
  });
});

router.get('/blog/:slug', (req, res, next) => {
  const article = articles.getArticle(req.params.slug);
  if (!article) return next();

  cachePublic(res, 900);

  // محصولات مرتبط از روی دسته‌هایی که مقاله به آن‌ها اشاره کرده
  const relatedProducts = [];
  (article.related || []).forEach((slug) => {
    const cat = q.getCategoryBySlug(slug);
    if (cat) relatedProducts.push(...q.listProducts({ category: cat.slug, limit: 3 }));
  });

  res.render('public/article', {
    title: `${article.title} — ${site.shortName}`,
    metaDescription: truncate(article.excerpt),
    article,
    related: articles.relatedArticles(article),
    relatedProducts: relatedProducts.slice(0, 6),
  });
});

// ------------------------------------------------------ صفحه‌ی جزئیات محصول
router.get('/product/:slug', (req, res, next) => {
  const product = q.getProductBySlug(req.params.slug);
  if (!product || !product.is_active) return next();

  cachePublic(res);
  const images = q.listProductImages(product.id);

  // نام دسته وقتی به عنوان صفحه اضافه می‌شود که خودِ نام محصول آن را نداشته
  // باشد. مثلاً «قوطی ۴۰×۴۰» خودش گویاست، ولی گل‌های فرفورژه فقط کد دارند
  // («کد ۱۰۱») و بدون نام دسته، نه مشتری می‌فهمد چیست نه گوگل.
  // ⚠️ فقط با فاصله و ویرگول جدا می‌کنیم. یک‌بار «و» را هم جداکننده گذاشتیم
  // و چون «و» داخل خودِ کلمه‌ها هم هست، «قوطی» به «ق» و «طی» تکه شد، هیچ‌کدام
  // مطابقت نکردند و عنوان «قوطی قوطی ۴۰×۴۰» درآمد.
  const catWords = String(product.category_name || '')
    .split(/[\s،]+/)
    .filter((w) => w.length > 2 && w !== 'و');
  const nameHasCat = catWords.some((w) => product.name.includes(w));
  const label = nameHasCat ? product.name : `${product.category_name} ${product.name}`;

  res.render('public/product', {
    title: `${label} | قیمت و خرید در علی‌آباد کتول و گرگان — ${site.shortName}`,
    metaDescription: truncate(
      `${label} — ${product.summary || product.description} | فروش در علی‌آباد کتول و گرگان، ${site.name}.`
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
      `${site.name} در علی‌آباد کتول: تولید ورق گالوانیزه، بیش از ۶۰۰ مدل گل فرفورژه‌ی آماده ` +
        `و عرضه‌ی آهن‌آلات ساختمانی با ارسال به گرگان و سراسر گلستان. آدرس: ${site.address.full}.`
    ),
    aboutText: getSetting('about_text', ''),
    mapEmbed: mapEmbedFrom(getSetting('map_embed', '')),
    mapDirections: mapDirectionsUrl(getSetting('map_embed', '')),
    mapPlace: mapPlaceUrl(getSetting('map_embed', '')),
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
    mapEmbed: mapEmbedFrom(getSetting('map_embed', '')),
    mapDirections: mapDirectionsUrl(getSetting('map_embed', '')),
    mapPlace: mapPlaceUrl(getSetting('map_embed', '')),
  });
});

// --------------------------------------------------------------- خوراک RSS
/**
 * خوراک RSS مقاله‌ها.
 *
 * دو فایده دارد: خزنده‌ها مقاله‌ی تازه را زودتر پیدا می‌کنند، و سایت‌های
 * تجمیع‌کننده و خبرخوان‌ها می‌توانند مقاله‌ها را بازنشر کنند — که یعنی
 * لینک ورودی، و لینک ورودی همچنان مهم‌ترین عامل رتبه در گوگل است.
 */
router.get('/rss.xml', (req, res) => {
  cachePublic(res, 3600);

  const esc = (t) =>
    String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const items = articles
    .listArticles()
    .map((a) => {
      const url = `${site.url}/blog/${encodeURIComponent(a.slug)}`;
      return (
        `    <item>\n` +
        `      <title>${esc(a.title)}</title>\n` +
        `      <link>${url}</link>\n` +
        `      <guid isPermaLink="true">${url}</guid>\n` +
        `      <description>${esc(a.excerpt)}</description>\n` +
        `    </item>`
      );
    })
    .join('\n');

  res
    .type('application/rss+xml; charset=utf-8')
    .send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
        `  <channel>\n` +
        `    <title>${esc(site.name)} — مقالات و راهنمای خرید</title>\n` +
        `    <link>${site.url}/blog</link>\n` +
        `    <atom:link href="${site.url}/rss.xml" rel="self" type="application/rss+xml"/>\n` +
        `    <description>${esc('راهنمای خرید آهن‌آلات، ورق گالوانیزه و فرفورژه در گرگان و علی‌آباد کتول')}</description>\n` +
        `    <language>fa-IR</language>\n` +
        `${items}\n` +
        `  </channel>\n</rss>\n`
    );
});

// ----------------------------------------------------------- سئو: sitemap
router.get('/sitemap.xml', (req, res) => {
  const urls = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/products', priority: '0.9', changefreq: 'weekly' },
    { loc: '/forge', priority: '0.9', changefreq: 'weekly' },
    { loc: '/calculator', priority: '0.8', changefreq: 'monthly' },
    { loc: '/blog', priority: '0.8', changefreq: 'weekly' },
    { loc: '/about', priority: '0.7', changefreq: 'monthly' },
    { loc: '/reviews', priority: '0.7', changefreq: 'monthly' },
    { loc: '/contact', priority: '0.6', changefreq: 'monthly' },
    { loc: '/faq', priority: '0.7', changefreq: 'monthly' },
  ];

  // صفحه‌های شهری — هدفشان جست‌وجوهای محلی است، پس اولویت بالا می‌گیرند
  for (const c of cities.cities) {
    urls.push({ loc: encodeURI(c.url), priority: '0.8', changefreq: 'monthly' });
  }

  for (const a of articles.listArticles()) {
    urls.push({
      loc: `/blog/${encodeURIComponent(a.slug)}`,
      priority: '0.7',
      changefreq: 'monthly',
    });
  }
  for (const c of q.listCategories()) {
    urls.push({
      loc: `/category/${encodeURIComponent(c.slug)}`,
      priority: '0.8',
      changefreq: 'weekly',
    });
  }
  for (const p of q.listProducts()) {
    // عکس هر محصول هم اعلام می‌شود. گوگل تصاویر، منبع ترافیک جدی برای
    // کالاهایی مثل «طرح فرفورژه» است که مردم اول با چشم انتخاب می‌کنند.
    const img = h.productImage(p, 'large');
    urls.push({
      loc: `/product/${encodeURIComponent(p.slug)}`,
      priority: '0.7',
      changefreq: 'weekly',
      lastmod: (p.updated_at || '').slice(0, 10) || undefined,
      image: img && !img.isPlaceholder ? { url: site.url + img.src, title: p.name } : null,
    });
  }

  // نویسه‌های ویژه‌ی XML در عنوان عکس باید escape شوند، وگرنه یک نام محصول
  // با علامت & کل نقشه‌ی سایت را برای گوگل نامعتبر می‌کند.
  const xmlEsc = (t) =>
    String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
    `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${site.url}${u.loc}</loc>` +
          (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
          `<changefreq>${u.changefreq}</changefreq>` +
          `<priority>${u.priority}</priority>` +
          (u.image
            ? `<image:image><image:loc>${xmlEsc(u.image.url)}</image:loc>` +
              `<image:title>${xmlEsc(u.image.title)}</image:title></image:image>`
            : '') +
          `</url>`
      )
      .join('\n') +
    `\n</urlset>\n`;

  res.type('application/xml').send(xml);
});

router.get('/robots.txt', (req, res) => {
  res
    .type('text/plain')
    .send(
      `User-agent: *\n` +
        `Allow: /\n` +
        `Disallow: /admin\n` +
        // آدرس‌های فیلتر و جست‌وجو محتوای تازه‌ای نمی‌سازند؛ خزیدنشان فقط
        // سهمیه‌ی خزش سایت را می‌سوزاند (متای noindex هم روی خودشان هست).
        `Disallow: /*?q=\n` +
        `Disallow: /*?stock=\n` +
        `\n` +
        `Sitemap: ${site.url}/sitemap.xml\n`
    );
});

module.exports = router;
