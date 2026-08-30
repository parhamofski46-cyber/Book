'use strict';

/**
 * تعیین نام کاربری و رمز عبور پنل مدیریت
 * ==========================================================================
 * روی سرور (یا روی کامپیوتر خودتان) اجرا کنید:
 *
 *     npm run set-admin -- <نام‌کاربری> <رمز‌عبور>
 *
 * مثال:
 *     npm run set-admin -- parham 'رمز-قوی-من'
 *
 * اگر کاربری وجود نداشته باشد ساخته می‌شود، وگرنه همان کاربر به‌روزرسانی
 * می‌گردد. رمز با bcrypt (هزینه‌ی ۱۲) هش می‌شود؛ خود رمز هیچ‌جا ذخیره
 * نمی‌شود، پس حتی با دسترسی به فایل دیتابیس هم قابل خواندن نیست.
 *
 * ⚠️ رمز را در فایل‌های پروژه ننویسید. این مخزن روی گیت‌هاب است و هر چیزی
 * که در آن commit شود، برای همیشه در تاریخچه‌ی گیت می‌ماند — حتی اگر بعداً
 * پاک شود. رمز را فقط با همین دستور و مستقیم روی سرور بدهید.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error('استفاده: npm run set-admin -- <نام‌کاربری> <رمز‌عبور>');
  process.exit(1);
}

if (username.length < 3) {
  console.error('❌ نام کاربری باید حداقل ۳ کاراکتر باشد.');
  process.exit(1);
}

if (password.length < 8) {
  console.error('❌ رمز عبور باید حداقل ۸ کاراکتر باشد.');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM admins ORDER BY id LIMIT 1').get();
const hash = bcrypt.hashSync(password, 12);

if (existing) {
  // must_change = 0 یعنی سایت موقع ورود، اجبار به تغییر رمز نمی‌کند؛
  // رمز همین الان توسط خود صاحب سایت انتخاب شده است.
  db.prepare('UPDATE admins SET username = ?, password_hash = ?, must_change = 0 WHERE id = ?').run(
    username,
    hash,
    existing.id
  );
  console.log(`\n✅ کاربر مدیر به‌روزرسانی شد: ${username}`);
} else {
  db.prepare('INSERT INTO admins (username, password_hash, must_change) VALUES (?, ?, 0)').run(
    username,
    hash
  );
  console.log(`\n✅ کاربر مدیر ساخته شد: ${username}`);
}

// اگر کاربر مدیر دیگری (مثلاً admin پیش‌فرض) مانده باشد، حذفش می‌کنیم تا
// راه ورود اضافه‌ای باز نماند.
const others = db.prepare('SELECT id, username FROM admins WHERE username != ?').all(username);
if (others.length) {
  db.prepare('DELETE FROM admins WHERE username != ?').run(username);
  console.log(`   ${others.length} کاربر قدیمی حذف شد: ${others.map((o) => o.username).join('، ')}`);
}

console.log('   رمز به‌صورت هش‌شده ذخیره شد (قابل بازیابی نیست).\n');
