/**
 * ساخت پیش‌نمایش کامل و خودکفا از سایت فولاد ایمان.
 *
 * سایت واقعی سرور Node لازم دارد و روی این محیط ابری از بیرون قابل دسترس نیست.
 * این اسکریپت همه‌ی صفحات عمومی را از سرور محلی می‌گیرد، فونت‌ها/عکس‌ها/CSS/JS
 * را به‌صورت data-URI داخل یک فایل HTML جاسازی می‌کند و یک مسیریاب کوچک
 * (hash router) می‌گذارد تا لینک‌های داخلی واقعاً کار کنند.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = '/home/user/Book';
const B = { host: 'localhost', port: 3111 };

const get = (p) =>
  new Promise((res, rej) => {
    http
      .get({ ...B, path: p, headers: { 'accept-encoding': 'identity' } }, (r) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      })
      .on('error', rej);
  });

const dataUri = (file, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.join(ROOT, 'public', file)).toString('base64')}`;

(async () => {
  // ───────────────────────────── ۱) فهرست صفحات
  const { db } = require(path.join(ROOT, 'src/db'));
  const cats = db.prepare('SELECT slug FROM categories ORDER BY sort_order').all();
  const prods = db.prepare('SELECT slug FROM products WHERE is_active = 1').all();

  const routes = ['/', '/products', '/forge', '/contact'];
  cats.forEach((c) => routes.push('/category/' + encodeURIComponent(c.slug)));
  prods.forEach((p) => routes.push('/product/' + encodeURIComponent(p.slug)));

  console.log(`دریافت ${routes.length} صفحه…`);

  // ───────────────────────────── ۲) نگاشت دارایی‌ها به data-URI
  const assets = new Map();
  assets.set('/img/favicon.svg', dataUri('img/favicon.svg', 'image/svg+xml'));
  fs.readdirSync(path.join(ROOT, 'public/img/cat')).forEach((f) => {
    assets.set('/img/cat/' + f, dataUri('img/cat/' + f, 'image/svg+xml'));
  });
  // تصویرسازی اختصاصی هر محصول — نام فایل فارسی است، پس آدرس در HTML
  // به‌صورت encode شده می‌آید و باید همان شکل را جایگزین کنیم
  fs.readdirSync(path.join(ROOT, 'public/img/prod')).forEach((f) => {
    const uri = dataUri('img/prod/' + f, 'image/svg+xml');
    assets.set('/img/prod/' + encodeURIComponent(f.slice(0, -4)) + '.svg', uri);
    assets.set('/img/prod/' + f, uri);
  });
  assets.set('/img/og-cover.jpg', dataUri('img/og-cover.jpg', 'image/jpeg'));
  ['owner-480.webp', 'owner-800.webp', 'owner-1200.webp'].forEach((f) => {
    assets.set('/img/' + f, dataUri('img/' + f, 'image/webp'));
  });
  fs.readdirSync(path.join(ROOT, 'public/uploads'))
    .filter((f) => f.endsWith('.webp'))
    .forEach((f) => assets.set('/uploads/' + f, dataUri('uploads/' + f, 'image/webp')));

  // ───────────────────────────── ۳) CSS با فونت‌های جاسازی‌شده
  let css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
  ['Regular', 'Bold', 'Black'].forEach((w) => {
    css = css.replace(
      `url('/fonts/Vazirmatn-${w}.woff2')`,
      `url('${dataUri('fonts/Vazirmatn-' + w + '.woff2', 'font/woff2')}')`
    );
  });

  // ───────────────────────────── ۴) پاک‌سازی HTML هر صفحه
  const rewrite = (html) => {
    // دارایی‌ها → data-URI
    for (const [url, uri] of assets) {
      html = html.split('"' + url + '"').join('"' + uri + '"');
      html = html.split(url + ' 4').join(uri + ' 4'); // داخل srcset
      html = html.split(url + ' 8').join(uri + ' 8');
      html = html.split(url + ' 1').join(uri + ' 1');
    }
    // لینک‌های داخلی → مسیریاب هش
    html = html.replace(/href="\/(?!\/)([^"]*)"/g, (m, p) => `href="#!/${p}"`);
    return html;
  };

  const pages = {};
  for (const r of routes) {
    const { status, body } = await get(r);
    if (status !== 200) {
      console.log('  رد شد', status, r);
      continue;
    }
    const title = (body.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
    let inner = body.slice(body.indexOf('<body>') + 6, body.lastIndexOf('</body>'));
    // اسکریپت‌های صفحه لازم نیست؛ خودمان init را صدا می‌زنیم
    inner = inner.replace(/<script[\s\S]*?<\/script>/g, '');
    // کلید را دیکودشده ذخیره می‌کنیم تا با چیزی که مرورگر از hash می‌دهد یکی باشد
    pages[decodeURIComponent(r)] = { t: title, h: rewrite(inner) };
  }

  // صفحه‌ی ۴۰۴
  {
    const { body } = await get('/__no_such_page__');
    let inner = body.slice(body.indexOf('<body>') + 6, body.lastIndexOf('</body>'));
    inner = inner.replace(/<script[\s\S]*?<\/script>/g, '');
    pages['404'] = { t: 'صفحه پیدا نشد', h: rewrite(inner) };
  }

  // ───────────────────────────── ۵) اسکریپت سایت، قابل اجرای دوباره
  let js = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  js = js.slice(js.indexOf('(function () {') + '(function () {'.length);
  js = js.slice(0, js.lastIndexOf('})();'));
  const initSite = `function initSite() {${js}}`;

  // ───────────────────────────── ۶) سرهم‌بندی
  const out = `<title>فولاد ایمان</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
html { direction: rtl; }
body { direction: rtl; text-align: right; }
</style>
<style>
${css}
/* ---- فقط مخصوص این پیش‌نمایش ---- */
.preview-bar{position:fixed;inset-inline-start:0;bottom:0;z-index:9999;background:#1c1c1e;color:#fff;
  font:700 12px/1.6 Vazirmatn,Tahoma,sans-serif;padding:.45rem .9rem;border-start-end-radius:10px;
  display:flex;gap:.6rem;align-items:center;opacity:.92}
.preview-bar b{color:#d08a50}
.preview-bar button{background:none;border:0;color:#fff;opacity:.6;cursor:pointer;font:inherit;padding:0 .3rem}
@media(max-width:700px){.preview-bar{bottom:78px;font-size:11px;padding:.35rem .7rem}}
.pv-linkbox{position:fixed;inset-inline:1rem;bottom:6rem;z-index:10000;background:#1c1c1e;color:#fff;
  border-radius:14px;padding:1rem;font:400 13px/1.9 Vazirmatn,Tahoma,sans-serif;
  box-shadow:0 16px 40px rgba(0,0,0,.35);max-width:520px;margin-inline:auto;text-align:center}
.pv-linkbox b{display:block;margin-bottom:.5rem;color:#d08a50}
.pv-linkbox code{display:block;direction:ltr;background:rgba(255,255,255,.1);padding:.5rem .7rem;
  border-radius:8px;word-break:break-all;font-size:12px;margin-bottom:.7rem}
.pv-linkbox button{background:#a8431a;color:#fff;border:0;border-radius:999px;padding:.5rem 1.4rem;
  font:700 13px Vazirmatn,Tahoma,sans-serif;cursor:pointer}
</style>
<div id="app"></div>
<div class="preview-bar" id="pv">
  <b>پیش‌نمایش</b><span>همه‌ی صفحات و لینک‌ها کار می‌کنند — پنل مدیریت به سرور نیاز دارد</span>
  <button type="button" id="pv-close" aria-label="بستن پیام">✕</button>
</div>
<script>
var PAGES = ${JSON.stringify(pages)};
${initSite}

/* ── مهم ──
   میزبان artifact محتوای این فایل را داخل <body> قرار می‌دهد، پس تگ‌های
   <style> هم داخل body می‌افتند. اگر محتوای body را جایگزین کنیم، استایل‌ها
   هم پاک می‌شوند و صفحه بدون CSS رندر می‌شود. برای همین:
   ۱) استایل‌ها را همان اول به <head> منتقل می‌کنیم
   ۲) صفحات را داخل #app رندر می‌کنیم، نه مستقیم در body            */
(function moveStylesToHead() {
  document.querySelectorAll('body style').forEach(function (s) {
    document.head.appendChild(s);
  });
  var m = document.querySelector('body meta[name="viewport"]');
  if (m) document.head.appendChild(m);
})();

var APP = document.getElementById('app');

function render(route, anchor) {
  var pg = PAGES[route];
  // اگر مسیر دقیق نبود، نسخه‌ی بدون پارامتر را امتحان کن، بعد ۴۰۴
  if (!pg) pg = PAGES[route.replace(/\\?.*$/, '')];
  if (!pg) pg = PAGES['404'];
  document.title = pg.t;
  APP.innerHTML = pg.h;
  initSite();

  // اگر لنگر داشت، بعد از رندر به همان بخش برو
  if (anchor) {
    var el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
  window.scrollTo(0, 0);
}

var pvClose = document.getElementById('pv-close');
if (pvClose) {
  pvClose.addEventListener('click', function () {
    document.getElementById('pv').remove();
  });
}

/** هش را به {route, anchor} تجزیه می‌کند: «#!/#why» یا «#!/products» */
function parseHash() {
  var h = location.hash;
  if (h.indexOf('#!') !== 0) return { route: '/', anchor: h.slice(1) || '' };
  var raw = h.slice(2) || '/';
  var i = raw.indexOf('#');
  var path = i > -1 ? raw.slice(0, i) : raw;
  var anchor = i > -1 ? raw.slice(i + 1) : '';
  try { path = decodeURIComponent(path); } catch (e) {}
  try { anchor = decodeURIComponent(anchor); } catch (e) {}
  return { route: path || '/', anchor: anchor };
}

var lastRoute = null;
window.addEventListener('hashchange', function () {
  var p = parseHash();
  if (p.route === lastRoute) {
    // همان صفحه، فقط لنگر عوض شده
    var el = p.anchor && document.getElementById(p.anchor);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  lastRoute = p.route;
  render(p.route, p.anchor);
});

/* ── لینک‌های بیرونی (واتساپ، تلگرام، تماس) ──
   این صفحه داخل iframe محدود میزبان اجرا می‌شود و باز کردن پنجره‌ی جدید
   ممکن است بلاک شود. اول تلاش می‌کنیم واقعاً باز شود؛ اگر نشد، آدرس را
   نشان می‌دهیم تا کاربر ببیند لینک درست است و بتواند کپی کند. */
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  var href = a.getAttribute('href') || '';
  var isExternal = /^(https?:|tel:|mailto:)/.test(href);
  if (!isExternal) return;

  e.preventDefault();
  var win = null;
  try { win = window.open(href, '_blank', 'noopener'); } catch (err) { win = null; }
  if (win) return;

  try { window.top.location.href = href; return; } catch (err) {}

  var box = document.getElementById('pv-link');
  if (!box) {
    box = document.createElement('div');
    box.id = 'pv-link';
    box.className = 'pv-linkbox';
    document.body.appendChild(box);
  }
  box.innerHTML = '';
  var t = document.createElement('b');
  t.textContent = 'در سایت واقعی این دکمه باز می‌شود:';
  var u = document.createElement('code');
  u.textContent = decodeURIComponent(href);
  var c = document.createElement('button');
  c.type = 'button';
  c.textContent = 'بستن';
  c.addEventListener('click', function () { box.remove(); });
  box.appendChild(t); box.appendChild(u); box.appendChild(c);
});

lastRoute = parseHash().route;
render(parseHash().route, parseHash().anchor);
</script>
`;

  const outPath = path.join(
    '/tmp/claude-0/-home-user-Book/9391613c-041e-58ae-a699-c5bf7ad23fec/scratchpad',
    'foolad-iman-preview.html'
  );
  fs.writeFileSync(outPath, out);
  console.log(
    `\n✅ ساخته شد: ${Object.keys(pages).length} صفحه، ` +
      `${Math.round(Buffer.byteLength(out) / 1024 / 102.4) / 10} مگابایت`
  );
  console.log('   ' + outPath);
})();
