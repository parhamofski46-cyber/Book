'use strict';

const { imageUrl, imageSrcset } = require('../services/images');
const { toFaDigits } = require('./slug');
const { categoryArtUrl, productArtUrl } = require('./icons');
const { productPhoto } = require('./photos');

/**
 * توابع کمکی که در قالب‌ها (EJS) استفاده می‌شوند.
 */

/** تبدیل کاراکترهای خطرناک HTML — برای درج امن متن کاربر داخل صفحه */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** کوتاه کردن متن طولانی برای توضیحات متا و کارت‌ها */
function truncate(str, len = 155) {
  const s = String(str ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= len ? s : `${s.slice(0, len - 1).trim()}…`;
}

/**
 * اطلاعات عکس یک محصول برای نمایش در قالب.
 *
 * ترتیب اولویت (اولین چیزی که موجود باشد استفاده می‌شود):
 *   ۱) عکسی که مدیر از پنل برای همین محصول آپلود کرده — همیشه اولویت اول
 *   ۲) عکس واقعی کالا از public/img/photos (همراه کد روی سرور می‌رود)
 *   ۳) تصویرسازی خطی اختصاصی خود محصول
 *   ۴) تصویرسازی خطی دسته
 *
 * یعنی مدیر هر وقت از انبار خودش عکس بهتری گرفت و آپلود کرد، بدون هیچ
 * تغییری در کد جای عکس فعلی را می‌گیرد.
 */
function productImage(product, size = 'medium') {
  if (!product) {
    return { src: '/img/cat/default.svg', srcset: '', alt: 'تصویر محصول', isPlaceholder: true, isArt: true };
  }

  // ۱) عکس آپلودی مدیر
  if (product.image) {
    return {
      src: imageUrl(product.image, size),
      srcset: imageSrcset(product.image, product.image_width),
      alt: product.image_alt || `${product.name} — فولاد ایمان، علی‌آباد کتول و گرگان`,
      isPlaceholder: false,
      isArt: false,
    };
  }

  // ۲) عکس واقعی کالا
  const photo = productPhoto(product);
  if (photo) {
    return {
      src: photo.src,
      srcset: photo.srcset,
      alt: `${product.name} — ${product.category_name || ''} در فولاد ایمان، علی‌آباد کتول و گرگان`,
      isPlaceholder: false,
      isArt: false,
      isPhoto: true,
    };
  }

  // ۳ و ۴) تصویرسازی خطی
  return {
    src: productArtUrl(product.slug) || categoryArtUrl(product.category_name),
    srcset: '',
    alt: `${product.name} — ${product.category_name || ''} در فولاد ایمان، علی‌آباد کتول`,
    isPlaceholder: true,
    isArt: true, // تصویرسازی است، نه عکس واقعی
  };
}

/** متن وضعیت موجودی برای نمایش روی کارت و صفحه‌ی محصول */
function stockLabel(product) {
  if (!product.in_stock) return { text: 'ناموجود', cls: 'out' };
  if (product.stock_qty != null && product.stock_qty > 0) {
    return { text: `موجود (${toFaDigits(product.stock_qty)} عدد)`, cls: 'in' };
  }
  return { text: 'موجود', cls: 'in' };
}

/**
 * JSON برای گذاشتن داخل تگ <script type="application/ld+json"> — امن در برابر
 * خروج زودهنگام از اسکریپت.
 *
 * چرا لازم است: اگر متنی که مدیر از پنل وارد کرده (مثلاً توضیح محصول یا متن
 * نظر) به‌طور اتفاقی رشته‌ی «</script>» را داشته باشد، JSON.stringify ساده
 * آن را عوض نمی‌کند و مرورگر همان‌جا تگ اسکریپت را می‌بندد — باقی صفحه به‌عنوان
 * HTML خوانده می‌شود. با تبدیل «<» به «<» این حمله ممکن نیست، بدون اینکه
 * به معنای JSON خللی وارد شود.
 */
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

module.exports = { esc, truncate, productImage, stockLabel, imageUrl, imageSrcset, toFaDigits, jsonLd };
