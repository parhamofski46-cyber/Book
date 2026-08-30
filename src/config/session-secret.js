'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * تعیین کلید رمزنگاری نشست (session)
 * ==========================================================================
 * این کلید است که کوکی ورود مدیر را امضا می‌کند. اگر قابل حدس باشد، هر کسی
 * می‌تواند کوکی جعل کند و بدون رمز وارد پنل شود — پس هرگز نباید مقدار ثابتِ
 * داخل کد باشد.
 *
 * ترتیب اولویت:
 *   ۱) متغیر محیطی SESSION_SECRET (بهترین حالت — روی VPS و لیارا همین را بدهید)
 *   ۲) کلید تصادفیِ ساخته‌شده در اولین اجرا که در پوشه‌ی داده ذخیره می‌شود
 *   ۳) کلید تصادفی فقط در حافظه (اگر دیسک قابل نوشتن نبود)
 *
 * ⚠️ چرا حالت ۲ اضافه شد: قبلاً اگر SESSION_SECRET تعریف نشده بود و
 * NODE_ENV=production بود، برنامه با process.exit(1) بسته می‌شد. روی سرور
 * معمولی این درست است (اسکریپت نصب خودش کلید می‌سازد)، ولی روی سرویس‌های
 * ابری مثل لیارا که خودشان NODE_ENV=production را ست می‌کنند، برنامه در
 * کمتر از یک ثانیه می‌مرد و چون فرصت نمی‌کرد چیزی لاگ کند، کاربر فقط
 * «Failure» بدون هیچ لاگی می‌دید. حالا به‌جای مرگ، یک کلید تصادفی امن
 * می‌سازد و ادامه می‌دهد.
 *
 * حالت ۲ به‌اندازه‌ی حالت ۱ امن است (۳۲ بایت تصادفی)، فقط اگر پوشه‌ی داده
 * پایدار نباشد با هر بار دیپلوی عوض می‌شود و مدیر باید دوباره وارد شود.
 */

const MIN_LENGTH = 24;

function resolveSessionSecret(dataDir) {
  const fromEnv = process.env.SESSION_SECRET;

  if (fromEnv && fromEnv.length >= MIN_LENGTH) {
    return { secret: fromEnv, source: 'env' };
  }
  if (fromEnv && fromEnv.length > 0) {
    console.warn(
      `\n⚠️  SESSION_SECRET داده شده ولی خیلی کوتاه است (${fromEnv.length} کاراکتر، حداقل ${MIN_LENGTH}).` +
        '\n   نادیده گرفته شد و به‌جایش کلید تصادفی ساخته می‌شود.\n'
    );
  }

  const file = path.join(dataDir, 'session-secret');
  const generated = crypto.randomBytes(32).toString('hex');

  // اگر از قبل ساخته شده، همان را استفاده کن تا با ری‌استارت، مدیر از پنل
  // بیرون نیفتد.
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= MIN_LENGTH) return { secret: existing, source: 'file' };
  } catch (err) {
    /* هنوز ساخته نشده — پایین می‌سازیمش */
  }

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    // mode 0600 = فقط کاربری که سرویس با آن اجرا می‌شود بتواند بخواند
    fs.writeFileSync(file, generated, { mode: 0o600 });
    return { secret: generated, source: 'generated', file };
  } catch (err) {
    // دیسک فقط-خواندنی. سایت کار می‌کند ولی با هر ری‌استارت باید دوباره وارد شد.
    return { secret: generated, source: 'memory', error: err.message };
  }
}

/** پیام راهنما برای چاپ در لاگ راه‌اندازی */
function describeSecretSource(result) {
  switch (result.source) {
    case 'env':
      return null; // حالت ایده‌آل، چیزی لازم نیست گفته شود
    case 'file':
      return null; // کلید پایدار از قبل ساخته شده
    case 'generated':
      return (
        '🔑 SESSION_SECRET تعریف نشده بود، یک کلید تصادفی ساخته و ذخیره شد.\n' +
        `   محل: ${result.file}\n` +
        '   برای اینکه با هر دیپلوی عوض نشود، بهتر است SESSION_SECRET را در\n' +
        '   تنظیمات محیطی سرویس (لیارا: بخش «متغیرهای محیطی») تعریف کنید.'
      );
    case 'memory':
      return (
        '⚠️  کلید نشست فقط در حافظه ساخته شد (پوشه‌ی داده قابل نوشتن نیست).\n' +
        `   دلیل: ${result.error}\n` +
        '   سایت کار می‌کند، ولی با هر ری‌استارت باید دوباره وارد پنل شوید.\n' +
        '   راه‌حل: SESSION_SECRET را در متغیرهای محیطی تعریف کنید.'
      );
    default:
      return null;
  }
}

module.exports = { resolveSessionSecret, describeSecretSource };
