'use strict';

require('dotenv').config();

const cluster = require('cluster');
const os = require('os');

/**
 * راه‌انداز چند-پردازشی برای تولید (production).
 *
 * چرا لازم است: Node.js تک‌رشته‌ای است و better-sqlite3 هم‌زمان (synchronous)
 * است، پس هر درخواست تا رندر کامل EJS و پرس‌وجوهای دیتابیس، رشته‌ی اصلی را
 * می‌گیرد. تست بار نشان داد یک پردازش تنها حدود ۴۶۰ درخواست بر ثانیه جواب
 * می‌دهد و از آن به بعد صف تشکیل می‌شود؛ روی VPS چندهسته‌ای این یعنی سه‌چهارم
 * پردازنده بی‌کار می‌ماند. اینجا به تعداد هسته‌ها (حداکثر ۴) پردازش فرزند
 * می‌سازیم؛ ماژول cluster به‌صورت خودکار درخواست‌های ورودی روی همان پورت را
 * بین آن‌ها پخش می‌کند — به کد server.js هیچ تغییری لازم نیست.
 *
 * چرا فقط یک پردازش دیتابیس را می‌سازد: seedAll() الگوی «چک کن، بعد درج کن»
 * دارد (نه atomic) — اگر چند پردازش هم‌زمان روی یک دیتابیس خالی بالا بیایند،
 * می‌توانند هم‌زمان تشخیص دهند «هنوز خالی است» و هر دو تلاش کنند رکورد یکسان
 * بسازند، که با خطای UNIQUE برخورد می‌کند. برای همین، پردازش اصلی قبل از
 * ساختن فرزندان، یک‌بار seedAll را کامل اجرا می‌کند و بعد آن‌ها را می‌سازد؛
 * تا آن موقع هیچ فرزندی وجود ندارد که مسابقه بدهد.
 *
 * استفاده: PORT=3000 node cluster.js
 * برای اجرای تک‌پردازشی (توسعه، یا وقتی سرور فقط یک هسته دارد) همان
 * `node server.js` قبلی را بزنید — دست‌نخورده ماند.
 */

const MAX_WORKERS = 4;
const requested = parseInt(process.env.WEB_CONCURRENCY || '', 10);
const numWorkers = Number.isFinite(requested) && requested > 0
  ? requested
  : Math.min(os.cpus().length, MAX_WORKERS);

if (cluster.isPrimary) {
  // دیتابیس را همین‌جا، قبل از ساختن فرزندان، یک‌بار آماده می‌کنیم.
  const { seedAll } = require('./src/db/seed');
  const seedResult = seedAll();

  console.log(`\n🔨 گروه تولیدی صنعتی فولاد ایمان — حالت چندپردازشی`);
  console.log(`   ${numWorkers} پردازش روی پورت ${process.env.PORT || 3000} بالا می‌آید`);

  if (seedResult.admin) {
    console.log('\n   ── کاربر مدیر ساخته شد ──');
    console.log(`   نام کاربری: ${seedResult.admin.username}`);
    console.log(`   رمز عبور  : ${seedResult.admin.password}`);
    if (seedResult.admin.mustChange) {
      console.log('   ⚠️  در اولین ورود، سایت شما را مجبور به تغییر رمز می‌کند.');
    }
  }
  console.log('');

  for (let i = 0; i < numWorkers; i++) cluster.fork();

  // اگر پردازشی کرش کرد، به‌جایش یکی تازه بالا می‌آید تا کل سایت پایین نیاید.
  // محافظ حلقه‌ی کرش: اگر در یک دقیقه بیش از حد کرش شد، دیگر رفورک نمی‌کنیم
  // چون احتمالاً خرابی از کد است، نه یک اتفاق موقت.
  const restarts = [];
  cluster.on('exit', (worker, code, signal) => {
    console.error(`[هشدار] پردازش ${worker.process.pid} متوقف شد (کد ${code}, سیگنال ${signal})`);
    const now = Date.now();
    restarts.push(now);
    while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
    if (restarts.length > numWorkers * 4) {
      console.error('[خطا] پردازش‌ها پشت‌سرهم کرش می‌کنند — از رفورک خودکار صرف‌نظر شد.');
      return;
    }
    cluster.fork();
  });
} else {
  // هر پردازش فرزند دقیقاً همان اپ تک‌پردازشی را بالا می‌آورد. seedAll() در
  // server.js دوباره صدا زده می‌شود ولی چون دیتابیس از قبل پر است، بی‌اثر و
  // آنی برمی‌گردد (نگاه کن به src/db/seed.js).
  require('./server');
}
