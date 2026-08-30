'use strict';
/**
 * تست کلیکی همه‌ی لینک‌های هدایتی سایت.
 *
 * چرا این تست وجود دارد: قبلاً چند بار پیش آمد که لینکی «سالم» بود (آدرسش ۲۰۰
 * برمی‌گرداند) ولی وقتی کاربر روی آن کلیک می‌کرد هیچ اتفاقی نمی‌افتاد — مثل
 * لینک‌های لنگری «/#about» داخل منوی موبایل. تست لینک ساده چنین باگی را
 * نمی‌گیرد؛ باید واقعاً کلیک کرد و دید صفحه عوض شد یا نه.
 *
 * اجرا:  node scripts/clickcheck.js [آدرس پایه]
 */
// Playwright فقط ابزار توسعه است و لازم نیست روی سرور نصب باشد.
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error(
    'برای اجرای این تست باید playwright نصب باشد:\n' +
      '  npm i -D playwright\n' +
      'یا اگر به‌صورت سراسری نصب است، با NODE_PATH اجرا کنید.'
  );
  process.exit(2);
}

const BASE = process.argv[2] || 'http://localhost:3000';
const PAGES = ['/', '/products', '/forge', '/about', '/reviews', '/contact'];
const CHROME =
  process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const VIEWPORTS = [
  { name: 'موبایل', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'دسکتاپ', width: 1280, height: 900, isMobile: false, hasTouch: false },
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const problems = [];
  let checked = 0;

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
    });
    page.on('pageerror', (e) => problems.push(`[${vp.name}] خطای جاوااسکریپت: ${e.message}`));

    for (const from of PAGES) {
      await page.goto(BASE + from, { waitUntil: 'domcontentloaded' });

      // در موبایل منو بسته است؛ اول بازش کن
      if (vp.isMobile) {
        await page.click('.nav-toggle');
        await page.waitForTimeout(350);
      }

      // همه‌ی لینک‌های داخلی منو و فوتر، با این که در کدامشان هستند.
      //
      // ⚠️ جداکردن منو از فوتر لازم است: در موبایل وقتی منو باز است یک
      // پرده‌ی تمام‌صفحه (.nav-backdrop) روی بقیه‌ی صفحه می‌افتد و جلوی
      // کلیک روی فوتر را می‌گیرد — همان‌طور که برای کاربر واقعی هم
      // می‌گیرد. پس لینک منو با منوی باز آزمایش می‌شود و لینک فوتر با
      // منوی بسته. قبلاً هر دو با منوی باز کلیک می‌شدند و فقط به این
      // دلیل خطا نمی‌داد که همان آدرس‌ها در خود منو هم بودند.
      const links = await page.$$eval('#main-nav a, .footer-links a', (els) =>
        els
          .map((a) => ({
            href: a.getAttribute('href'),
            text: a.textContent.trim(),
            inNav: !!a.closest('#main-nav'),
          }))
          .filter((l) => l.href && l.href.startsWith('/') && !l.href.startsWith('//'))
      );

      for (const link of links) {
        await page.goto(BASE + from, { waitUntil: 'domcontentloaded' });
        const needMenu = vp.isMobile && link.inNav;
        if (needMenu) {
          await page.click('.nav-toggle');
          await page.waitForTimeout(300);
        }
        const scope = link.inNav ? '#main-nav ' : '.footer-links ';
        const el = page.locator(`${scope}a[href="${link.href}"]`).first();
        if (!(await el.isVisible())) {
          problems.push(`[${vp.name}] از «${from}» لینک «${link.text}» دیده نمی‌شود`);
          continue;
        }
        const before = page.url();
        await el.click({ timeout: 4000 }).catch((e) => {
          problems.push(`[${vp.name}] از «${from}» کلیک روی «${link.text}» شکست خورد: ${e.message.split('\n')[0]}`);
        });
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(250);
        const after = page.url();
        const expected = BASE + link.href;
        checked++;

        // اگر مقصد همان صفحه‌ی فعلی است، تغییرنکردن آدرس ایراد نیست
        const sameTarget = decodeURIComponent(before).replace(/\/$/, '') ===
          decodeURIComponent(expected).replace(/\/$/, '');
        if (!sameTarget && decodeURIComponent(after).replace(/\/$/, '') !== decodeURIComponent(expected).replace(/\/$/, '')) {
          problems.push(
            `[${vp.name}] از «${from}» کلیک روی «${link.text}» → انتظار ${link.href} ولی رفت به ${after}`
          );
        }
        // صفحه‌ی مقصد باید محتوا داشته باشد، نه ۴۰۴
        const is404 = await page.locator('h1', { hasText: 'پیدا نشد' }).count();
        if (is404) problems.push(`[${vp.name}] «${link.text}» به صفحه‌ی ۴۰۴ رسید`);
      }
    }

    // ---- بررسی اینکه انیمیشن ورود بخش‌ها گیر نکرده باشد
    for (const p of PAGES) {
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 30));
        }
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(900);
      const stuck = await page.$$eval('.reveal', (els) =>
        els.filter((e) => getComputedStyle(e).opacity === '0').length
      );
      if (stuck) problems.push(`[${vp.name}] در «${p}» تعداد ${stuck} بخش نامرئی ماند (انیمیشن گیر کرد)`);
    }

    await page.close();
  }

  await browser.close();

  console.log(`\n${checked} کلیک بررسی شد.`);
  if (problems.length) {
    console.log(`\n❌ ${problems.length} ایراد:`);
    problems.forEach((p) => console.log('  • ' + p));
    process.exit(1);
  }
  console.log('✅ همه‌ی لینک‌های هدایتی درست کار می‌کنند و هیچ بخشی نامرئی نماند.');
})();
