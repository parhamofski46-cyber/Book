'use strict';

const { imageUrl, imageSrcset } = require('../services/images');
const { toFaDigits } = require('./slug');
const { categoryArtUrl, productArtUrl } = require('./icons');

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
 * اگر محصول هنوز عکس واقعی ندارد، به‌جای یک placeholder خاکستری یکسان،
 * تصویرسازی خطی اختصاصی دسته‌ی خودش نمایش داده می‌شود — هم گرید
 * «طراحی‌شده» به‌نظر می‌رسد، هم مشتری از روی تصویر می‌فهمد با چه دسته‌ای طرف است.
 */
function productImage(product, size = 'medium') {
  if (!product || !product.image) {
    return {
      src: product
        ? productArtUrl(product.slug) || categoryArtUrl(product.category_name)
        : '/img/cat/default.svg',
      srcset: '',
      alt: product
        ? `${product.name} — ${product.category_name || ''} در فولاد ایمان، علی‌آباد کتول`
        : 'تصویر محصول',
      isPlaceholder: true,
      isArt: true, // تصویرسازی است، نه عکس واقعی
    };
  }
  return {
    src: imageUrl(product.image, size),
    srcset: imageSrcset(product.image),
    alt: product.image_alt || `${product.name} — فولاد ایمان، علی‌آباد کتول و گرگان`,
    isPlaceholder: false,
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
