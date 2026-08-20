'use strict';

/**
 * ساخت پوستر چاپی مغازه با کد QR.
 * ==========================================================================
 *
 * چرا این ابزار: مشتری‌ای که پایش به مغازه باز شده، سخت‌ترین قسمت کار را
 * انجام داده. یک تابلوی کوچک روی پیشخوان با کد QR، همان مشتری را به
 * بازدیدکننده‌ی سایت تبدیل می‌کند — و مهم‌تر، لینک را برای دوستش می‌فرستد.
 *
 * برای فرفورژه این از هر تبلیغی مؤثرتر است: به‌جای ورق‌زدن کاتالوگ کاغذی،
 * مشتری ۴۹۴ مدل را روی گوشی خودش می‌بیند و کد مدل را همان‌جا می‌فرستد.
 *
 * کد QR آفلاین ساخته می‌شود (کتابخانه‌ی qrcode، فقط devDependency) و
 * خروجی یک فایل HTML آماده‌ی چاپ است — نه عکس، تا روی هر اندازه کاغذی
 * تیز چاپ شود.
 *
 * اجرا:
 *   node scripts/gen-poster.js                     # آدرس پیش‌فرض سایت
 *   node scripts/gen-poster.js https://example.ir  # آدرس دلخواه
 *
 * خروجی: public/poster/tabloo.html
 * بازکردن آن در مرورگر و زدن Ctrl+P کافی است.
 */

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { site } = require('../src/config/site');

const url = (process.argv[2] || site.url).replace(/\/+$/, '');
const outDir = path.join(__dirname, '..', 'public', 'poster');
const outFile = path.join(outDir, 'tabloo.html');

/** آدرس بدون https:// برای نمایش — کوتاه‌تر و خواناتر روی تابلو */
const pretty = url.replace(/^https?:\/\//, '');

async function main() {
  // سطح تصحیح خطای بالا (H): اگر گوشه‌ی برچسب خط بخورد یا کثیف شود،
  // کد همچنان خوانده می‌شود. برای چیزی که قرار است ماه‌ها روی پیشخوان
  // بماند، این تفاوت مهمی است.
  const qr = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 1,
    color: { dark: '#1c1c1e', light: '#ffffff' },
  });

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>تابلوی مغازه — ${site.shortName}</title>
<style>
  /* چاپ روی A5 ایستاده؛ حاشیه کم تا تابلو بزرگ دربیاید */
  @page { size: A5 portrait; margin: 8mm; }

  @font-face {
    font-family: 'Vazirmatn';
    src: url('../fonts/Vazirmatn-Bold.woff2') format('woff2');
    font-weight: 700;
  }
  @font-face {
    font-family: 'Vazirmatn';
    src: url('../fonts/Vazirmatn-Regular.woff2') format('woff2');
    font-weight: 400;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Vazirmatn', Tahoma, sans-serif;
    background: #f2ede8;
    display: flex;
    justify-content: center;
    padding: 20px;
  }
  .sheet {
    width: 128mm;
    min-height: 190mm;
    background: #fff;
    border: 2px solid #1c1c1e;
    border-radius: 14px;
    padding: 12mm 10mm;
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .brand { font-weight: 700; font-size: 20pt; color: #1c1c1e; margin: 0; }
  .tag { color: #a8431a; font-size: 11pt; margin: 3mm 0 0; font-weight: 700; }
  .pitch { font-size: 13pt; line-height: 1.9; color: #33333a; margin: 7mm 0 0; }
  .pitch b { color: #a8431a; }
  .qr { margin: 6mm auto 0; width: 62mm; }
  .qr svg { width: 100%; height: auto; display: block; }
  .scan { font-size: 10.5pt; color: #55555c; margin: 3mm 0 0; }
  .url {
    direction: ltr;
    font-size: 15pt;
    font-weight: 700;
    letter-spacing: .4px;
    color: #1c1c1e;
    margin: 4mm 0 0;
    padding: 2.5mm;
    border: 1.5px dashed #a8431a;
    border-radius: 8px;
  }
  .foot { font-size: 10pt; color: #55555c; margin: 6mm 0 0; line-height: 1.9; }
  .phone { direction: ltr; font-weight: 700; font-size: 12pt; color: #1c1c1e; }

  /* موقع چاپ، زمینه‌ی خاکستری و سایه‌ها حذف شوند */
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border-width: 1.5px; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div>
      <h1 class="brand">${site.name}</h1>
      <p class="tag">${site.tagline}</p>

      <p class="pitch">
        <b>بیش از ۶۰۰ مدل</b> گل و طرح فرفورژه<br>
        را روی گوشی خودتان ببینید
      </p>

      <div class="qr">${qr}</div>
      <p class="scan">دوربین گوشی را روی کد بگیرید</p>

      <div class="url">${pretty}</div>
    </div>

    <p class="foot">
      کاتالوگ کامل · محاسبه‌گر وزن آهن · استعلام قیمت روز<br>
      <span class="phone">${site.phone}</span> — تلفن و واتساپ
    </p>
  </div>
</body>
</html>
`;

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');

  console.log('✅ تابلو ساخته شد:', path.relative(process.cwd(), outFile));
  console.log('   آدرس داخل کد QR:', url);
  console.log('   بازکردن در مرورگر و زدن Ctrl+P برای چاپ (A5).');
}

main().catch((err) => {
  console.error('ساخت تابلو ناموفق بود:', err.message);
  process.exit(1);
});
