'use strict';

/**
 * ساخت «اسلاگ» (نشانی صفحه) از روی متن فارسی یا انگلیسی.
 * حروف فارسی حفظ می‌شوند چون گوگل آدرس‌های فارسی را می‌فهمد و برای
 * سئوی فارسی هم مفید است. فاصله‌ها به خط تیره تبدیل می‌شوند.
 */
function slugify(input) {
  return String(input || '')
    .trim()
    .replace(/[ىي]/g, 'ی') // یکسان‌سازی ی عربی
    .replace(/[ك]/g, 'ک') // یکسان‌سازی ک عربی
    .replace(/[ً-ٰٟ]/g, '') // حذف اعراب
    .replace(/[^\p{L}\p{N}]+/gu, '-') // هر چیزی جز حرف و عدد → خط تیره
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

/**
 * اگر اسلاگ تکراری بود، عدد به انتهایش اضافه می‌کند تا یکتا شود.
 * @param {string} base اسلاگ اولیه
 * @param {(s: string) => boolean} exists تابعی که می‌گوید این اسلاگ قبلاً هست یا نه
 */
function uniqueSlug(base, exists) {
  let slug = base || 'mahsool';
  let n = 2;
  while (exists(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

/** تبدیل ارقام انگلیسی به فارسی برای نمایش زیباتر اعداد */
const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
function toFaDigits(input) {
  return String(input ?? '').replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

module.exports = { slugify, uniqueSlug, toFaDigits };
