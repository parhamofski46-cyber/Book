'use strict';

/**
 * تنظیمات مرکزی سایت
 * ------------------------------------------------------------------
 * هرچیزی که ممکن است در آینده تغییر کند (شماره تماس، آدرس، شبکه‌های
 * اجتماعی، متن‌های سئو) اینجا جمع شده است تا برای تغییر آن نیازی به
 * گشتن در بین فایل‌های مختلف نباشد.
 */

// دامنه‌ی نهایی سایت. بعد از ثبت دامنه‌ی .ir فقط همین یک مقدار
// (یا متغیر محیطی SITE_URL در فایل .env) را عوض کنید.
const SITE_URL = (process.env.SITE_URL || 'https://fooladiman.ir').replace(/\/+$/, '');

// شماره‌ی تماس اصلی — بدون صفر و با کد کشور برای واتساپ (98 + شماره بدون صفر اول)
const PHONE_LOCAL = '09112710321';
const PHONE_INTL = '989112710321';

const site = {
  // ---------- هویت کسب‌وکار ----------
  name: 'گروه تولیدی صنعتی فولاد ایمان',
  shortName: 'فولاد ایمان',
  tagline: 'آهن‌فروشی و تولیدکننده‌ی ورق گالوانیزه در علی‌آباد کتول و گرگان',
  description:
    'گروه تولیدی صنعتی فولاد ایمان، آهن‌فروشی گرگان و علی‌آباد کتول: فروش قوطی و پروفیل، ' +
    'نبشی، رابیتس، شاخ گوزنی، فنس، تور مرغی، ایزوگام، پشم شیشه، فوم، پیچ سرمته، قفل و لولا؛ ' +
    'تولید ورق گالوانیزه (طرح سفال رنگی و شفاف) و بیش از ۶۰۰ مدل گل و طرح آماده‌ی ' +
    'فرفورژه — علی‌آباد کتول و گرگان، استان گلستان.',

  url: SITE_URL,

  // ---------- تماس ----------
  phone: PHONE_LOCAL,
  phoneIntl: PHONE_INTL,
  phoneHref: `tel:+${PHONE_INTL}`,

  // ---------- آدرس و منطقه‌ی خدمات (برای سئوی محلی) ----------
  address: {
    city: 'علی‌آباد کتول',
    province: 'استان گلستان',
    country: 'ایران',
    // نشانی مراجعه‌ی حضوری
    street: 'خیابان مزرعه، روبه‌روی آهن‌فروشی دیلمی',
    full: 'علی‌آباد کتول، خیابان مزرعه، روبه‌روی آهن‌فروشی دیلمی',
    landmark: 'روبه‌روی آهن‌فروشی دیلمی',
  },
  areaServed: ['علی‌آباد کتول', 'گرگان', 'استان گلستان', 'کردکوی', 'رامیان', 'آزادشهر', 'فاضل‌آباد'],
  geo: { lat: 36.9061, lng: 54.8514 }, // مختصات تقریبی علی‌آباد کتول
  // مختصات دقیق درِ مغازه. اگر پرش کنید، هم نقشه و هم دکمه‌ی مسیریابی
  // مستقیم به همین نقطه می‌روند. خالی بودنش یعنی از آدرس متنی استفاده شود.
  mapPoint: '',

  openingHours: 'شنبه تا پنجشنبه، ۸ صبح تا ۸ شب',

  /**
   * شبکه‌های ارتباطی
   * ------------------------------------------------------------------
   * برای اضافه کردن تلگرام در آینده کافی است `enabled` را true کنید و
   * یوزرنیم را در `username` بگذارید. دکمه‌ی تلگرام به‌صورت خودکار در
   * کنار دکمه‌ی واتساپ (صفحه‌ی محصول، فوتر و دکمه‌ی شناور) ظاهر می‌شود.
   * هیچ تغییر دیگری در کد لازم نیست.
   */
  channels: {
    whatsapp: {
      enabled: true,
      label: 'واتساپ',
      number: PHONE_INTL,
      base: `https://wa.me/${PHONE_INTL}`,
    },
    telegram: {
      enabled: true,
      label: 'تلگرام',
      username: 'parham_plg', // بدون @ — برای تغییر، فقط همین را عوض کنید
      base: '', // به‌صورت خودکار از username ساخته می‌شود (پایین‌تر)
    },
    eitaa: {
      enabled: false,
      label: 'ایتا',
      username: '',
      base: '',
    },
  },
};

// ساخت خودکار آدرس پایه‌ی تلگرام/ایتا از روی یوزرنیم
if (site.channels.telegram.username) {
  site.channels.telegram.base = `https://t.me/${site.channels.telegram.username}`;
}
if (site.channels.eitaa.username) {
  site.channels.eitaa.base = `https://eitaa.com/${site.channels.eitaa.username}`;
}

/**
 * ساخت لینک پیام آماده برای هر کانال ارتباطی.
 * @param {string} channelKey - کلید کانال ('whatsapp' | 'telegram' | ...)
 * @param {string} productName - نام محصول (اختیاری)
 * @returns {string|null} آدرس کامل یا null اگر کانال فعال نباشد
 */
function inquiryLink(channelKey, productName) {
  const ch = site.channels[channelKey];
  if (!ch || !ch.enabled || !ch.base) return null;

  const text = productName
    ? `سلام، می‌خواستم قیمت ${productName} رو بپرسم.`
    : 'سلام، می‌خواستم درباره‌ی محصولات فولاد ایمان سؤال بپرسم.';

  // تلگرام از پارامتر text در لینک پروفایل پشتیبانی نمی‌کند،
  // پس فقط برای واتساپ پیام از پیش نوشته اضافه می‌شود.
  if (channelKey === 'whatsapp') {
    return `${ch.base}?text=${encodeURIComponent(text)}`;
  }
  return ch.base;
}

/** فهرست کانال‌های فعال به همراه لینک آماده — برای رندر دکمه‌ها در قالب‌ها */
function activeChannels(productName) {
  return Object.entries(site.channels)
    .filter(([, ch]) => ch.enabled)
    .map(([key, ch]) => ({ key, label: ch.label, href: inquiryLink(key, productName) }))
    .filter((c) => c.href);
}

/**
 * نقشه‌ی فروشگاه.
 *
 * ⚠️ مقداری که مدیر در پنل وارد می‌کند می‌تواند هر شکلی باشد و قبلاً فقط
 * «کد iframe» پذیرفته می‌شد. کاربر مختصات را وارد کرد و چون قالب مقدار را
 * خام چاپ می‌کرد، به‌جای نقشه دو عدد وسط صفحه نوشته شد.
 *
 * حالا هر چهار حالت پذیرفته می‌شود:
 *   • کد کامل <iframe…> از گوگل مپ یا نشان
 *   • لینک گوگل مپ (هر شکلی که مختصات در آن باشد)
 *   • مختصات خام: «36.9061, 54.8514»
 *   • هر متن دیگر → به‌عنوان عبارت جست‌وجوی آدرس
 */

/** استخراج مختصات از هر متنی که کاربر داده باشد */
function parseCoords(text) {
  const t = String(text || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  // الگوی @lat,lng در لینک گوگل، یا q=lat,lng، یا خودِ «lat, lng»
  const m =
    t.match(/@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/) ||
    t.match(/[?&]q=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/) ||
    t.match(/^\s*(-?\d{1,3}\.\d+)\s*[,،]\s*(-?\d{1,3}\.\d+)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** عبارت جست‌وجوی آدرس کامل فروشگاه */
function addressQuery() {
  return `${site.address.full}، ${site.address.province}`;
}

/**
 * لینک «مسیریابی» — با کلیک، گوگل مپ مسیر را از موقعیت فعلی کاربر تا
 * فروشگاه نشان می‌دهد. اگر مختصات دقیق داشته باشیم از آن استفاده می‌کنیم،
 * وگرنه از آدرس متنی.
 */
function mapDirectionsUrl(raw) {
  const c = parseCoords(raw) || parseCoords(site.mapPoint) || null;
  const dest = c ? `${c.lat},${c.lng}` : addressQuery();
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

/** آدرس باز کردن نقشه در گوگل مپ (نه مسیریابی، فقط نمایش محل) */
function mapPlaceUrl(raw) {
  const c = parseCoords(raw) || parseCoords(site.mapPoint) || null;
  const q = c ? `${c.lat},${c.lng}` : addressQuery();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * کد iframe نقشه بر اساس چیزی که مدیر وارد کرده.
 * اگر چیزی وارد نشده باشد، مختصات ثابت site.mapPoint و در نبودش آدرس متنی
 * استفاده می‌شود — یعنی سایت همیشه نقشه دارد.
 */
function mapEmbedFrom(raw) {
  const text = String(raw || '').trim();

  // ۱) کد iframe آماده — فقط از میزبان‌های نقشه‌ی مجاز، تا هر HTML دلخواهی
  // وارد صفحه نشود
  if (/^<iframe/i.test(text)) {
    const src = (text.match(/src=["']([^"']+)["']/i) || [])[1] || '';
    if (/^https:\/\/(www\.)?(google\.com|maps\.google\.com|neshan\.org|www\.neshan\.org)\//i.test(src)) {
      return text;
    }
    // میزبان ناشناس: به‌جای چاپ HTML خام، به حالت پیش‌فرض برمی‌گردیم
  }

  const c = parseCoords(text) || parseCoords(site.mapPoint);
  const src = c
    ? `https://www.google.com/maps?q=${c.lat},${c.lng}&z=17&hl=fa&output=embed`
    : `https://www.google.com/maps?q=${encodeURIComponent(addressQuery())}&z=15&hl=fa&output=embed`;

  return (
    `<iframe src="${src}" width="100%" height="320" style="border:0" ` +
    `loading="lazy" referrerpolicy="no-referrer-when-downgrade" ` +
    `title="نقشه‌ی ${site.name} — ${site.address.full}"></iframe>`
  );
}

/** سازگاری با کد قبلی */
function defaultMapEmbed() {
  return mapEmbedFrom('');
}

module.exports = {
  site,
  inquiryLink,
  activeChannels,
  defaultMapEmbed,
  mapEmbedFrom,
  mapDirectionsUrl,
  mapPlaceUrl,
  parseCoords,
};
