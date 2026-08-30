'use strict';

const fs = require('fs');
const path = require('path');

/**
 * عکس واقعی محصولات
 * ==========================================================================
 * عکس‌ها در public/img/photos/ با الگوی «<کلید>-<عرض>.webp» ذخیره شده‌اند
 * (با scripts/import-photos.js ساخته می‌شوند). چند محصول می‌توانند یک عکس
 * مشترک داشته باشند — مثلاً همه‌ی سایزهای قوطی یک عکس دارند — برای همین
 * به‌جای «یک فایل برای هر محصول»، «یک کلید برای هر نوع کالا» داریم.
 *
 * فهرست فایل‌ها فقط یک‌بار هنگام بالا آمدن سرور از دیسک خوانده می‌شود.
 */

const PHOTO_DIR = path.join(__dirname, '..', '..', 'public', 'img', 'photos');

/** { کلید: [عرض‌های موجود به ترتیب صعودی] } */
const PHOTOS = Object.create(null);

try {
  for (const file of fs.readdirSync(PHOTO_DIR)) {
    const m = /^([a-z0-9-]+)-(\d+)\.webp$/.exec(file);
    if (!m) continue;
    const key = m[1];
    (PHOTOS[key] || (PHOTOS[key] = [])).push(Number(m[2]));
  }
  for (const key of Object.keys(PHOTOS)) PHOTOS[key].sort((a, b) => a - b);
} catch (err) {
  /* پوشه هنوز ساخته نشده — همه‌ی محصولات از تصویرسازی خطی استفاده می‌کنند */
}

/**
 * تشخیص اینکه هر محصول کدام عکس را باید نشان دهد.
 *
 * ⚠️ ترتیب قانون‌ها مهم است و اولین تطابق برنده می‌شود. چند نکته‌ی ظریف:
 *  • «ایزوگام پشم‌شیشه» یک ایزوگام است، نه پشم شیشه — پس قانون ایزوگام
 *    باید قبل از پشم شیشه بیاید.
 *  • «ورق نما» در دسته‌ی ورق گالوانیزه است، پس قانونش باید قبل از قانون
 *    عمومی ورق گالوانیزه بیاید وگرنه عکس اشتباه می‌گیرد.
 *  • «ورق گالوانیزه طرح سفال» هم «سفال» دارد هم «گالوانیزه» — سفال اول.
 *  • محصولات فرفورژه عمداً عکس نمی‌گیرند: تصویرسازی خطی اختصاصی‌شان،
 *    پیچ‌وخم طرح را واضح‌تر از یک عکس عمومی نشان می‌دهد.
 */
const RULES = [
  { key: null, test: (name, cat) => /فرفورژه/.test(cat) },
  { key: 'sim-rabis', test: (name) => /سیم/.test(name) && /رابیتس|رابیتس/.test(name) },
  { key: 'rabis', test: (name, cat) => /رابیتس|رابیتس/.test(cat) || /رابیتس|رابیتس/.test(name) },
  { key: 'shakh-gozni', test: (name, cat) => /شاخ\s*گوزنی/.test(cat) || /شاخ\s*گوزنی/.test(name) },
  { key: 'pich-sarmateh', test: (name) => /پیچ\s*سرمته/.test(name) },
  { key: 'izogam', test: (name) => /ایزوگام/.test(name) },
  { key: 'pashm-shishe', test: (name) => /پشم/.test(name) },
  { key: 'varagh-nama', test: (name) => /ورق\s*نما/.test(name) },
  { key: 'varagh-sofal', test: (name) => /سفال/.test(name) },
  { key: 'varagh-galvanize', test: (name, cat) => /ورق/.test(name) && /گالوانیزه/.test(cat + name) },
  { key: 'ghouti', test: (name, cat) => /قوطی/.test(cat) },
];

/** کلید عکس مناسب یک محصول، یا null اگر عکسی برایش نداریم */
function photoKey(product) {
  if (!product) return null;
  const name = String(product.name || '');
  const cat = String(product.category_name || '');
  for (const rule of RULES) {
    if (rule.test(name, cat)) return rule.key;
  }
  return null;
}

/**
 * عکس محصول به‌همراه srcset با عرض‌های واقعی.
 *
 * نکته‌ی مهم: عرض‌هایی که در srcset اعلام می‌شوند دقیقاً عرض واقعی فایل‌اند،
 * نه یک عدد قراردادی. اگر عدد اشتباه اعلام شود مرورگر ممکن است فایل کوچک را
 * برای جای بزرگ انتخاب کند و عکس تار دیده شود.
 */
function productPhoto(product) {
  const key = photoKey(product);
  if (!key) return null;
  const widths = PHOTOS[key];
  if (!widths || !widths.length) return null;

  const url = (w) => `/img/photos/${key}-${w}.webp`;
  return {
    key,
    src: url(widths[widths.length - 1]),
    srcset: widths.map((w) => `${url(w)} ${w}w`).join(', '),
    maxWidth: widths[widths.length - 1],
  };
}

module.exports = { productPhoto, photoKey, PHOTOS };
