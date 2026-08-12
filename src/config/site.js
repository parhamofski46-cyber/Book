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
  tagline: 'تأمین‌کننده‌ی مصالح فلزی و فرفورژه در علی‌آباد کتول و گرگان',
  description:
    'گروه تولیدی صنعتی فولاد ایمان: تولید ورق گالوانیزه (طرح سفال رنگی و شفاف) و عرضه‌ی ' +
    'قوطی، پروفیل، نبشی، رابیس، شاخ گوزنی، فنس، تور مرغی، ایزوگام، پشم شیشه، فوم، ' +
    'پیچ سرمته، قفل و لولا و بیش از ۱۰۰۰ مدل گل و طرح آماده‌ی فرفورژه — ' +
    'علی‌آباد کتول و گرگان، استان گلستان.',

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

module.exports = { site, inquiryLink, activeChannels };
