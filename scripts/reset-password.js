'use strict';

/**
 * بازنشانی رمز عبور پنل مدیریت
 * ------------------------------------------------------------------
 * اگر رمز پنل را فراموش کردید، روی سرور این دستور را اجرا کنید:
 *
 *     npm run reset-password
 *
 * یک رمز تصادفی امن ساخته و در ترمینال چاپ می‌شود.
 * می‌توانید رمز دلخواه خودتان را هم بدهید:
 *
 *     npm run reset-password -- "رمز-دلخواه-من"
 */

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

const admin = db.prepare('SELECT * FROM admins ORDER BY id LIMIT 1').get();

if (!admin) {
  console.error('❌ هیچ کاربر مدیری در دیتابیس نیست. یک‌بار سرور را اجرا کنید تا ساخته شود.');
  process.exit(1);
}

// رمز داده‌شده در خط فرمان، یا یک رمز تصادفی ۱۲ کاراکتری
const newPassword =
  process.argv[2] || crypto.randomBytes(9).toString('base64url').slice(0, 12);

db.prepare('UPDATE admins SET password_hash = ?, must_change = 0 WHERE id = ?').run(
  bcrypt.hashSync(newPassword, 12),
  admin.id
);

console.log('\n✅ رمز عبور عوض شد.');
console.log(`   نام کاربری: ${admin.username}`);
console.log(`   رمز جدید  : ${newPassword}`);
console.log('   بعد از ورود، از بخش «رمز عبور» آن را به چیزی که یادتان می‌ماند تغییر دهید.\n');
