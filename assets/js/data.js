/* =============================================================
   زرّین | Zarrin Fine Jewelry
   data.js — منبع داده‌ی محصولات، دسته‌ها و تنظیمات فروشگاه
   ============================================================= */

export const SHOP = {
  name: 'زرّین',
  nameEn: 'ZARRIN',
  tagline: 'گالری طلا و جواهر',
  since: 1347,
  phone: '۰۲۱ ۸۸ ۷۷ ۶۶ ۵۵',
  phoneRaw: '+982188776655',
  whatsapp: '989120000000',
  instagram: 'zarrin.gallery',
  email: 'info@zarrin.gallery',
  address: 'تهران، خیابان ولیعصر، بالاتر از پارک ساعی، برج زرّین، طبقه همکف',
  hours: 'شنبه تا پنجشنبه ۱۰:۰۰ تا ۲۱:۰۰',
  branches: [
    { city: 'تهران', title: 'شعبه مرکزی ولیعصر', addr: 'ولیعصر، بالاتر از پارک ساعی، برج زرّین', tel: '۰۲۱-۸۸۷۷۶۶۵۵' },
    { city: 'تهران', title: 'بوتیک سعادت‌آباد', addr: 'سعادت‌آباد، میدان کاج، مجتمع الماس', tel: '۰۲۱-۲۲۳۳۴۴۵۵' },
    { city: 'اصفهان', title: 'بوتیک چهارباغ', addr: 'چهارباغ بالا، مجتمع پارک', tel: '۰۳۱-۳۶۶۵۵۴۴۳' },
    { city: 'مشهد', title: 'بوتیک احمدآباد', addr: 'احمدآباد، نبش عارف ۴', tel: '۰۵۱-۳۸۴۴۳۳۲۲' },
  ],
};

/* نرخ پایه‌ی نمایشی — با اتصال به API واقعی جایگزین می‌شود (README را ببینید) */
export const RATES = {
  gram18: 7_450_000,      // هر گرم طلای ۱۸ عیار (تومان)
  gram24: 9_930_000,      // هر گرم طلای ۲۴ عیار
  mesghal: 32_280_000,    // مثقال طلا
  coinEmami: 82_500_000,  // سکه امامی
  coinHalf: 44_900_000,   // نیم سکه
  coinQuarter: 27_600_000,// ربع سکه
  ounce: 3_412,           // انس جهانی (دلار)
  usd: 91_500,            // دلار (تومان)
};

export const CATEGORIES = [
  { id: 'ring',     title: 'انگشتر',   sub: 'Rings',     icon: 'ring',     desc: 'از حلقه‌های نامزدی تک‌نگین تا انگشترهای طرح‌دار روزمره' },
  { id: 'necklace', title: 'گردنبند',  sub: 'Necklaces', icon: 'necklace', desc: 'زنجیرهای ایتالیایی و آویزهای دست‌ساز با نگین‌های اصل' },
  { id: 'earring',  title: 'گوشواره',  sub: 'Earrings',  icon: 'earring',  desc: 'میخی، آویز و حلقه‌ای؛ سبک‌وزن و مناسب استفاده روزانه' },
  { id: 'bracelet', title: 'دستبند',   sub: 'Bracelets', icon: 'bracelet', desc: 'دستبندهای رشته‌ای، کارتیه و بافت‌های کلاسیک' },
  { id: 'bangle',   title: 'النگو',    sub: 'Bangles',   icon: 'bangle',   desc: 'النگوهای حصیری، توپی و طرح‌های سنتی ایرانی' },
  { id: 'set',      title: 'نیم‌ست',   sub: 'Sets',      icon: 'set',      desc: 'ست‌های هماهنگ گردنبند، گوشواره و انگشتر' },
  { id: 'coin',     title: 'سکه و شمش', sub: 'Bullion',  icon: 'coin',     desc: 'سکه امامی، گرمی و شمش با اصالت تضمین‌شده' },
  { id: 'pendant',  title: 'آویز',     sub: 'Pendants',  icon: 'pendant',  desc: 'آویزهای تک، پلاک اسم و طرح‌های مینیمال' },
];

export const GEMS = {
  diamond:  { fa: 'الماس',        color: '#f4f7ff', ior: 2.42 },
  ruby:     { fa: 'یاقوت سرخ',    color: '#c0143c', ior: 1.77 },
  emerald:  { fa: 'زمرد',         color: '#0f8a58', ior: 1.58 },
  sapphire: { fa: 'یاقوت کبود',   color: '#1f4fd8', ior: 1.77 },
  amethyst: { fa: 'آمتیست',       color: '#8b4fd6', ior: 1.54 },
  citrine:  { fa: 'سیترین',       color: '#e0a11a', ior: 1.55 },
};

export const METALS = {
  yellow: { fa: 'طلای زرد',  color: '#d9a441', hex: '#d9a441' },
  rose:   { fa: 'طلای رز',   color: '#d98a72', hex: '#d98a72' },
  white:  { fa: 'طلای سفید', color: '#dfe3ea', hex: '#dfe3ea' },
};

/* -------------------------------------------------------------
   محاسبه‌ی قیمت به روش رایج بازار ایران:
   قیمت = (وزن × نرخ گرم) + اجرت + سود + مالیات بر ارزش افزوده
   ------------------------------------------------------------- */
export function priceBreakdown({ weight, karat = 18, wagePct = 12, profitPct = 7, vatPct = 9, rates = RATES }) {
  const gram = karat === 24 ? rates.gram24 : rates.gram18;
  const gold = weight * gram;
  const wage = gold * (wagePct / 100);
  const profit = (gold + wage) * (profitPct / 100);
  const vat = (wage + profit) * (vatPct / 100);
  const total = gold + wage + profit + vat;
  return { gold, wage, profit, vat, total: Math.round(total) };
}

const P = (w, wage = 12) => priceBreakdown({ weight: w, wagePct: wage }).total;

/* ------------------------------- محصولات ------------------------------- */
export const PRODUCTS = [
  { id: 'zr-101', title: 'حلقه تک‌نگین «ستاره»', en: 'Etoile Solitaire', cat: 'ring', art: 'ring',
    weight: 3.2, karat: 18, wage: 18, gem: 'diamond', metal: 'white', carat: 0.42, badge: 'پرفروش',
    rating: 4.9, reviews: 128, stock: 4, colors: ['white', 'yellow', 'rose'],
    desc: 'حلقه‌ی تک‌نگین با تراش برلیان ۵۷ فاست و پایه‌ی شش‌چنگه‌ی کلاسیک. نور از تمام زوایا به مرکز نگین هدایت می‌شود.' },

  { id: 'zr-102', title: 'انگشتر «رواق»', en: 'Ravagh Band', cat: 'ring', art: 'ring',
    weight: 4.6, karat: 18, wage: 14, gem: null, metal: 'yellow', badge: null,
    rating: 4.7, reviews: 63, stock: 9, colors: ['yellow', 'rose'],
    desc: 'حلقه‌ی پهن با بافت مات و لبه‌های پولیش‌خورده، الهام‌گرفته از قوس‌های معماری ایرانی.' },

  { id: 'zr-103', title: 'انگشتر «یاقوت شاه‌عباسی»', en: 'Shah Abbasi Ruby', cat: 'ring', art: 'ring',
    weight: 5.1, karat: 18, wage: 22, gem: 'ruby', metal: 'yellow', carat: 1.15, badge: 'محدود',
    rating: 5.0, reviews: 41, stock: 2, colors: ['yellow'],
    desc: 'یاقوت سرخ برمه‌ای در نشان طلای زرد با قاب اسلیمی دست‌کنده. هر قطعه منحصربه‌فرد است.' },

  { id: 'zr-104', title: 'گردنبند «قطره نور»', en: 'Lumière Drop', cat: 'necklace', art: 'necklace',
    weight: 6.8, karat: 18, wage: 16, gem: 'diamond', metal: 'white', carat: 0.30, badge: 'جدید',
    rating: 4.8, reviews: 77, stock: 6, colors: ['white', 'yellow'],
    desc: 'آویز قطره‌ای با هاله‌ای از الماس‌های ریز روی زنجیر ونیزی ۴۵ سانتی‌متری.' },

  { id: 'zr-105', title: 'گردنبند «زنجیر فیگارو»', en: 'Figaro Chain', cat: 'necklace', art: 'necklace',
    weight: 9.4, karat: 18, wage: 10, gem: null, metal: 'yellow', badge: null,
    rating: 4.6, reviews: 152, stock: 12, colors: ['yellow', 'white'],
    desc: 'زنجیر فیگارو ساخت ایتالیا با قفل جهنمی و ضخامت ۳ میلی‌متر؛ مناسب استفاده‌ی روزمره.' },

  { id: 'zr-106', title: 'گوشواره «شبنم»', en: 'Dewdrop Studs', cat: 'earring', art: 'earring',
    weight: 2.1, karat: 18, wage: 20, gem: 'diamond', metal: 'white', carat: 0.24, badge: 'پرفروش',
    rating: 4.9, reviews: 210, stock: 15, colors: ['white', 'rose'],
    desc: 'گوشواره‌ی میخی با دو الماس گرد و بست پروانه‌ای؛ سبک‌ترین انتخاب برای هر روز.' },

  { id: 'zr-107', title: 'گوشواره «آویز مروارید»', en: 'Pearl Cascade', cat: 'earring', art: 'earring',
    weight: 3.9, karat: 18, wage: 17, gem: 'diamond', metal: 'yellow', carat: 0.12, badge: null,
    rating: 4.7, reviews: 58, stock: 7, colors: ['yellow', 'white'],
    desc: 'ترکیب مروارید آب‌شیرین و طلای زرد در آویزی سبک با حرکت روان.' },

  { id: 'zr-108', title: 'دستبند «کارتیه»', en: 'Carthage Cuff', cat: 'bracelet', art: 'bracelet',
    weight: 11.2, karat: 18, wage: 13, gem: null, metal: 'rose', badge: 'محبوب',
    rating: 4.8, reviews: 96, stock: 5, colors: ['rose', 'yellow', 'white'],
    desc: 'دستبند کاف با مقطع بیضی و پولیش آینه‌ای؛ فرم ارگونومیک برای راحتی مچ.' },

  { id: 'zr-109', title: 'دستبند «رشته‌ای زمرد»', en: 'Emerald Line', cat: 'bracelet', art: 'bracelet',
    weight: 7.6, karat: 18, wage: 24, gem: 'emerald', metal: 'white', carat: 1.80, badge: 'محدود',
    rating: 5.0, reviews: 33, stock: 2, colors: ['white'],
    desc: 'ردیفی از زمردهای تراش زمرّدی در قاب طلای سفید با قفل ایمنی دوقفله.' },

  { id: 'zr-110', title: 'النگو «حصیری»', en: 'Woven Bangle', cat: 'bangle', art: 'bangle',
    weight: 8.3, karat: 18, wage: 15, gem: null, metal: 'yellow', badge: null,
    rating: 4.6, reviews: 88, stock: 10, colors: ['yellow'],
    desc: 'النگوی بافت حصیری با ضخامت ۶ میلی‌متر؛ طرحی که هرگز از مد نمی‌افتد.' },

  { id: 'zr-111', title: 'النگو «توپی»', en: 'Bead Bangle', cat: 'bangle', art: 'bangle',
    weight: 12.5, karat: 18, wage: 12, gem: null, metal: 'yellow', badge: null,
    rating: 4.5, reviews: 47, stock: 8, colors: ['yellow', 'rose'],
    desc: 'النگوی توپی توخالی با وزن سبک و درخشش بالا، مناسب ست‌های چندتایی.' },

  { id: 'zr-112', title: 'نیم‌ست «باغ ایرانی»', en: 'Persian Garden Set', cat: 'set', art: 'set',
    weight: 14.8, karat: 18, wage: 21, gem: 'emerald', metal: 'yellow', carat: 0.95, badge: 'ویژه',
    rating: 4.9, reviews: 25, stock: 3, colors: ['yellow', 'white'],
    desc: 'گردنبند و گوشواره‌ی هماهنگ با نقش‌مایه‌ی گل و مرغ و نگین‌های زمرد؛ کار دست استادکاران زرّین.' },

  { id: 'zr-113', title: 'نیم‌ست «نور و آینه»', en: 'Mirror & Light Set', cat: 'set', art: 'set',
    weight: 16.2, karat: 18, wage: 19, gem: 'diamond', metal: 'white', carat: 1.10, badge: null,
    rating: 4.8, reviews: 31, stock: 3, colors: ['white'],
    desc: 'ست کامل عروس با ریزنگین‌های پاوه؛ درخشش یکدست از گردن تا گوش.' },

  { id: 'zr-114', title: 'سکه تمام امامی', en: 'Emami Full Coin', cat: 'coin', art: 'coin',
    weight: 8.133, karat: 24, wage: 0, gem: null, metal: 'yellow', badge: 'اصالت تضمینی',
    rating: 5.0, reviews: 302, stock: 20, colors: ['yellow'], fixed: RATES.coinEmami,
    desc: 'سکه‌ی تمام بهار آزادی طرح جدید، همراه با بسته‌بندی پلمب و گواهی اصالت.' },

  { id: 'zr-115', title: 'شمش طلای ۵ گرمی', en: '5g Gold Bar', cat: 'coin', art: 'coin',
    weight: 5, karat: 24, wage: 3, gem: null, metal: 'yellow', badge: null,
    rating: 4.9, reviews: 140, stock: 25, colors: ['yellow'],
    desc: 'شمش ۹۹۹.۹ با کد رهگیری و کارت اصالت بین‌المللی؛ گزینه‌ی مطمئن سرمایه‌گذاری.' },

  { id: 'zr-116', title: 'آویز «پلاک اسم»', en: 'Name Plate', cat: 'pendant', art: 'pendant',
    weight: 2.8, karat: 18, wage: 25, gem: null, metal: 'yellow', badge: 'سفارشی',
    rating: 4.7, reviews: 190, stock: 30, colors: ['yellow', 'rose', 'white'],
    desc: 'پلاک اسم سفارشی با خط نستعلیق یا لاتین؛ آماده‌سازی ۳ تا ۵ روز کاری.' },

  { id: 'zr-117', title: 'آویز «چشم‌نظر»', en: 'Evil Eye Pendant', cat: 'pendant', art: 'pendant',
    weight: 1.9, karat: 18, wage: 23, gem: 'sapphire', metal: 'white', carat: 0.18, badge: null,
    rating: 4.8, reviews: 118, stock: 14, colors: ['white', 'yellow'],
    desc: 'آویز چشم‌نظر با یاقوت کبود و مینای دست‌ساز؛ هدیه‌ای با معنا.' },

  { id: 'zr-118', title: 'انگشتر «آمتیست شب»', en: 'Nocturne Amethyst', cat: 'ring', art: 'ring',
    weight: 4.4, karat: 18, wage: 20, gem: 'amethyst', metal: 'rose', carat: 2.10, badge: 'جدید',
    rating: 4.6, reviews: 52, stock: 6, colors: ['rose', 'yellow'],
    desc: 'آمتیست تراش کوسنی در بستر طلای رز با حاشیه‌ی ریزنگین.' },
].map((p) => {
  const bd = priceBreakdown({ weight: p.weight, karat: p.karat, wagePct: p.wage });
  return { ...p, breakdown: bd, price: p.fixed ?? bd.total };
});

export const COLLECTIONS = [
  { id: 'bridal',  title: 'مجموعه‌ی عروس',   en: 'Bridal',  desc: 'حلقه، نیم‌ست و آویزهایی برای مهم‌ترین روز زندگی', tone: '#e8c9a0', cat: 'set' },
  { id: 'daily',   title: 'روزمره‌ی سبک',    en: 'Everyday',desc: 'قطعات کم‌وزن و بادوام برای همراهی هر روز',        tone: '#cfd6e2', cat: 'earring' },
  { id: 'heritage',title: 'میراث ایرانی',    en: 'Heritage',desc: 'نقش‌مایه‌های اسلیمی و ختایی در فرم‌های امروزی',   tone: '#d9b26a', cat: 'necklace' },
  { id: 'invest',  title: 'سرمایه‌گذاری',    en: 'Bullion', desc: 'سکه و شمش با اصالت تضمین‌شده و قیمت شفاف',        tone: '#bfa46a', cat: 'coin' },
];

export const TESTIMONIALS = [
  { name: 'مریم رستگاری', city: 'تهران', text: 'حلقه‌ی نامزدی‌مان را از زرّین گرفتیم. کیفیت تراش نگین واقعاً در حد کاتالوگ‌های اروپایی بود و مشاوره‌شان بدون فشار فروش.', rate: 5 },
  { name: 'سهیل کاویانی', city: 'اصفهان', text: 'برای خرید شمش سراغشان رفتم. فاکتور رسمی، کد رهگیری و بسته‌بندی پلمب؛ دقیقاً همان چیزی که انتظار داشتم.', rate: 5 },
  { name: 'نگار شریفی', city: 'شیراز', text: 'سرویس عروسم را سفارشی ساختند. سه بار طرح را اصلاح کردیم و ذره‌ای بی‌حوصلگی ندیدم. نتیجه فوق‌العاده شد.', rate: 5 },
  { name: 'آرش بهرامی', city: 'مشهد', text: 'ارسال به مشهد فقط دو روز طول کشید و بیمه‌ی کامل داشت. سایت هم دقیقاً همان چیزی را نشان می‌دهد که تحویل می‌گیری.', rate: 4 },
  { name: 'الهه موسوی', city: 'تبریز', text: 'خدمات پس از فروش‌شان عالی است؛ آبکاری مجدد و تنظیم سایز را رایگان انجام دادند.', rate: 5 },
];

export const FAQ = [
  { q: 'قیمت‌ها چطور محاسبه می‌شوند؟', a: 'قیمت هر قطعه از رابطه‌ی «وزن × نرخ روز گرم طلا + اجرت ساخت + سود فروشنده + مالیات بر ارزش افزوده» به دست می‌آید. تفکیک کامل این چهار بخش در صفحه‌ی هر محصول نمایش داده می‌شود تا هیچ رقمی مبهم نماند.' },
  { q: 'آیا امکان بازگشت کالا وجود دارد؟', a: 'بله. تا ۷ روز پس از تحویل، در صورت سالم بودن پلمب و کارت اصالت، کالا با کسر اجرت ساخت بازخرید می‌شود. سکه و شمش با نرخ روز و بدون کسر اجرت بازخرید می‌گردند.' },
  { q: 'گواهی اصالت چه چیزهایی را پوشش می‌دهد؟', a: 'عیار طلا، وزن دقیق، مشخصات نگین (وزن قیراطی، رنگ و پاکی) و کد رهگیری قطعه. برای الماس‌های بالای یک قیراط، گواهی آزمایشگاه بین‌المللی نیز ارائه می‌شود.' },
  { q: 'ارسال چقدر طول می‌کشد؟', a: 'تهران بین ۴ تا ۲۴ ساعت با پیک اختصاصی و بیمه‌ی کامل؛ سایر شهرها ۲ تا ۴ روز کاری با پست پیشتاز بیمه‌شده. ارسال برای سفارش‌های بالای ۵۰ میلیون تومان رایگان است.' },
  { q: 'سفارش ساخت اختصاصی می‌پذیرید؟', a: 'بله. فرآیند از جلسه‌ی مشاوره شروع می‌شود، سپس طرح سه‌بعدی برای تأیید ارسال می‌گردد و پس از آن ساخت آغاز می‌شود. زمان تحویل معمولاً ۱۰ تا ۲۱ روز کاری است.' },
  { q: 'سایز انگشتم را نمی‌دانم، چه کنم؟', a: 'از راهنمای سایز همین سایت استفاده کنید: محیط انگشت را با نخ اندازه بگیرید و عدد را در جدول وارد کنید. تنظیم سایز تا دو نمره، تا شش ماه پس از خرید رایگان است.' },
];

export const RING_SIZES = [
  { ir: 50, mm: 50.0, us: 5.25, uk: 'K' }, { ir: 51, mm: 51.2, us: 5.75, uk: 'L' },
  { ir: 52, mm: 52.5, us: 6.0,  uk: 'L½' }, { ir: 53, mm: 53.1, us: 6.25, uk: 'M' },
  { ir: 54, mm: 54.4, us: 6.75, uk: 'N' }, { ir: 55, mm: 55.7, us: 7.25, uk: 'O' },
  { ir: 56, mm: 56.3, us: 7.5,  uk: 'O½' }, { ir: 57, mm: 57.0, us: 7.75, uk: 'P' },
  { ir: 58, mm: 58.3, us: 8.25, uk: 'Q' }, { ir: 59, mm: 59.5, us: 8.75, uk: 'R' },
  { ir: 60, mm: 60.2, us: 9.0,  uk: 'R½' }, { ir: 61, mm: 61.4, us: 9.5,  uk: 'S' },
  { ir: 62, mm: 62.7, us: 10.0, uk: 'T' }, { ir: 63, mm: 63.4, us: 10.25,uk: 'T½' },
];

export const JOURNAL = [
  { t: 'چگونه پاکی و رنگ الماس را بخوانیم؟', c: 'راهنما', d: '۱۴۰۵/۰۴/۱۲', s: 'چهار C معیار جهانی ارزش‌گذاری الماس است؛ در این مقاله هر کدام را با مثال تصویری توضیح می‌دهیم.' },
  { t: 'نگهداری طلا در خانه؛ ۷ اشتباه رایج', c: 'مراقبت', d: '۱۴۰۵/۰۳/۲۸', s: 'از تماس با عطر و مواد شوینده تا نگهداری در جعبه‌ی مشترک؛ چیزهایی که درخشش طلای شما را می‌گیرد.' },
  { t: 'طلای ۱۸ یا ۲۴ عیار؛ کدام برای شما؟', c: 'سرمایه', d: '۱۴۰۵/۰۳/۰۵', s: 'مقایسه‌ی دوام، رنگ، قیمت و نقدشوندگی دو عیار پرکاربرد بازار ایران.' },
];

/* --------------------------- ابزارهای عمومی --------------------------- */
const FA_DIGITS = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
export const toFa = (n) => String(n).replace(/\d/g, (d) => FA_DIGITS[+d]);
export const toman = (n) => toFa(Math.round(n).toLocaleString('en-US')) + ' تومان';
export const tomanShort = (n) => toFa(Math.round(n).toLocaleString('en-US'));
export const byId = (id) => PRODUCTS.find((p) => p.id === id);
export const catTitle = (id) => (CATEGORIES.find((c) => c.id === id) || {}).title || id;
