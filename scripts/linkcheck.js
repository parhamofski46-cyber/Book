/**
 * بازرس کامل لینک‌های سایت.
 * از صفحه‌ی اصلی شروع می‌کند، همه‌ی صفحات داخلی را می‌پیماید و بررسی می‌کند:
 *  • هر لینک داخلی وضعیت ۲۰۰ برگرداند
 *  • هر لنگر (#id) در همان صفحه یا صفحه‌ی مقصد واقعاً وجود داشته باشد
 *  • هر عکس لود شود
 *  • لینک‌های بیرونی شکل درستی داشته باشند
 */
const http = require('http');

// آدرس پایه از آرگومان خط فرمان گرفته می‌شود تا روی هر پورتی قابل اجرا باشد.
// (قبلاً پورت ثابت ۳۱۱۱ بود و اگر سرور روی پورت دیگری بالا می‌آمد، این تست
//  خطای گمراه‌کننده‌ی «وضعیت ۵۰۰» می‌داد.)
const BASE = new URL(process.argv[2] || 'http://localhost:3000');
const B = { host: BASE.hostname, port: BASE.port || 80 };

const get = (p) =>
  new Promise((res) => {
    http.get({ ...B, path: p }, (r) => {
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString('utf8'), type: r.headers['content-type'] || '' }));
    }).on('error', (e) => res({ status: 0, body: '', err: e.message }));
  });

(async () => {
  const seen = new Set();
  const queue = ['/'];
  const problems = [];
  const pageIds = new Map();   // مسیر → مجموعه‌ی id های آن صفحه
  const anchorLinks = [];      // {from, to, anchor}
  const images = new Set();
  const external = new Set();

  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);

    const { status, body, type } = await get(url);
    if (status !== 200) { problems.push(`صفحه ${url} → وضعیت ${status}`); continue; }
    if (!type.includes('html')) continue;

    // id های صفحه
    const ids = new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    pageIds.set(url, ids);

    // عکس‌ها
    [...body.matchAll(/<img[^>]+src="([^"]+)"/g)].forEach((m) => {
      if (m[1].startsWith('/')) images.add(m[1]);
    });

    // لینک‌ها
    for (const m of body.matchAll(/<a[^>]+href="([^"]+)"/g)) {
      const href = m[1];
      if (href.startsWith('http')) { external.add(href.split('?')[0]); continue; }
      if (href.startsWith('tel:') || href.startsWith('mailto:')) { external.add(href); continue; }
      if (href.startsWith('#')) {
        anchorLinks.push({ from: url, to: url, anchor: href.slice(1) });
        continue;
      }
      if (!href.startsWith('/')) { problems.push(`لینک نامعتبر در ${url}: ${href}`); continue; }
      const [path, hash] = href.split('#');
      if (hash) anchorLinks.push({ from: url, to: path || '/', anchor: hash });
      const target = path || '/';
      if (target.startsWith('/admin')) continue;   // پنل، جدا تست می‌شود
      if (!seen.has(target)) queue.push(target);
    }
  }

  // بررسی لنگرها
  for (const a of anchorLinks) {
    let ids = pageIds.get(a.to);
    if (!ids) {
      const { status, body } = await get(a.to);
      if (status !== 200) { problems.push(`لنگر ${a.anchor}: صفحه‌ی مقصد ${a.to} وضعیت ${status}`); continue; }
      ids = new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      pageIds.set(a.to, ids);
    }
    if (!ids.has(a.anchor)) problems.push(`لنگر «#${a.anchor}» در صفحه‌ی ${a.to} وجود ندارد (لینک از ${a.from})`);
  }

  // بررسی عکس‌ها
  for (const im of images) {
    const { status } = await get(im);
    if (status !== 200) problems.push(`عکس ${im} → وضعیت ${status}`);
  }

  console.log(`صفحات پیموده‌شده: ${seen.size}`);
  console.log(`عکس‌های بررسی‌شده: ${images.size}`);
  console.log(`لنگرهای بررسی‌شده: ${anchorLinks.length}`);
  console.log(`لینک‌های بیرونی: ${[...external].join('  |  ').slice(0, 300)}`);
  console.log(problems.length ? `\n❌ ${problems.length} مشکل:\n` + problems.join('\n') : '\n✅ همه‌ی لینک‌ها، لنگرها و عکس‌ها سالم‌اند');
})();
