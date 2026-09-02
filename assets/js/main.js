/* =============================================================
   main.js — منطق کل سایت زرّین
   ============================================================= */
import { SHOP, RATES, CATEGORIES, GEMS, METALS, PRODUCTS, COLLECTIONS, TESTIMONIALS,
         FAQ, RING_SIZES, JOURNAL, priceBreakdown, toFa, toman, tomanShort, byId, catTitle } from './data.js';
import { GRADIENT_DEFS, ICONS, LOGO_MARK, jewelSVG, stars } from './art.js';
import { mountJewel, METAL_PBR, GEM_PBR } from './jewel3d.js';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const on = (el, ev, fn, o) => el && el.addEventListener(ev, fn, o);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------- ذخیره‌سازی ---------------------------- */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('zarrin.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('zarrin.' + k, JSON.stringify(v)); } catch {} },
};

/* ------------------------------ اعلان ------------------------------ */
function toast(msg, icon = 'check') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<i>${ICONS[icon] || ICONS.check}</i><span>${msg}</span>`;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, 2800);
}

/* =========================== سبد خرید =========================== */
const Cart = {
  items: store.get('cart', []),
  save() { store.set('cart', this.items); this.render(); },
  add(id, metal, qty = 1) {
    const p = byId(id); if (!p) return;
    const m = metal || p.metal;
    const hit = this.items.find((i) => i.id === id && i.metal === m);
    if (hit) hit.qty = Math.min(hit.qty + qty, p.stock || 99);
    else this.items.push({ id, metal: m, qty });
    this.save();
    toast(`«${p.title}» به سبد اضافه شد`, 'cart');
    bump();
  },
  remove(i) { this.items.splice(i, 1); this.save(); },
  setQty(i, q) {
    const it = this.items[i]; const p = byId(it.id);
    it.qty = Math.max(1, Math.min(q, p?.stock || 99));
    this.save();
  },
  get count() { return this.items.reduce((a, i) => a + i.qty, 0); },
  get total() { return this.items.reduce((a, i) => a + (byId(i.id)?.price || 0) * i.qty, 0); },

  render() {
    const badge = $('#cartBadge');
    if (badge) { badge.textContent = toFa(this.count); badge.classList.toggle('on', this.count > 0); }
    const body = $('#cartBody'), foot = $('#cartFoot');
    if (!body) return;
    if (!this.items.length) {
      body.innerHTML = `<div class="cart-empty">${ICONS.cart}<p>سبد خرید شما هنوز خالی است.</p>
        <a class="btn btn--ghost btn--sm" href="products.html">مشاهده‌ی محصولات</a></div>`;
      if (foot) foot.classList.add('hide');
      return;
    }
    if (foot) foot.classList.remove('hide');
    body.innerHTML = this.items.map((it, i) => {
      const p = byId(it.id); if (!p) return '';
      return `<div class="cart-item">
        <div class="cart-item__art">${jewelSVG(p.art, { metal: it.metal, gem: p.gem })}</div>
        <div class="cart-item__b">
          <span class="cart-item__t">${p.title}</span>
          <span class="cart-item__m">${METALS[it.metal]?.fa || ''} · ${toFa(p.weight)} گرم · عیار ${toFa(p.karat)}</span>
          <div class="cart-item__f">
            <div class="qty">
              <button data-q="-1" data-i="${i}" aria-label="کاهش">${ICONS.minus}</button>
              <span>${toFa(it.qty)}</span>
              <button data-q="1" data-i="${i}" aria-label="افزایش">${ICONS.plus}</button>
            </div>
            <b style="font-size:.88rem">${toman(p.price * it.qty)}</b>
          </div>
          <button class="cart-remove" data-rm="${i}">حذف از سبد</button>
        </div>
      </div>`;
    }).join('');
    const tot = $('#cartTotal'); if (tot) tot.textContent = toman(this.total);
    const ship = $('#cartShip');
    if (ship) ship.textContent = this.total >= 50_000_000 ? 'رایگان' : toman(450_000);
  },
};

function bump() {
  const b = $('#cartBtn'); if (!b) return;
  b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
    { duration: 460, easing: 'cubic-bezier(.16,1,.3,1)' });
}

/* =========================== علاقه‌مندی =========================== */
const Fav = {
  ids: store.get('fav', []),
  has(id) { return this.ids.includes(id); },
  toggle(id) {
    const i = this.ids.indexOf(id);
    if (i > -1) { this.ids.splice(i, 1); toast('از علاقه‌مندی‌ها حذف شد', 'heart'); }
    else { this.ids.push(id); toast('به علاقه‌مندی‌ها اضافه شد', 'heart'); }
    store.set('fav', this.ids); this.paint();
  },
  paint() {
    $$('.card__fav').forEach((b) => b.classList.toggle('on', this.has(b.dataset.fav)));
    const badge = $('#favBadge');
    if (badge) { badge.textContent = toFa(this.ids.length); badge.classList.toggle('on', this.ids.length > 0); }
  },
};

/* ============================ کارت محصول ============================ */
export function cardHTML(p) {
  const low = p.stock <= 3;
  return `<article class="card" data-tilt data-id="${p.id}">
    <div class="card__media">
      ${p.badge ? `<span class="card__badge">${p.badge}</span>` : ''}
      ${low && !p.badge ? `<span class="card__badge card__badge--stock">تنها ${toFa(p.stock)} عدد</span>` : ''}
      <button class="card__fav" data-fav="${p.id}" aria-label="افزودن به علاقه‌مندی">${ICONS.heart}</button>
      <div class="card__art">${jewelSVG(p.art, { metal: p.metal, gem: p.gem, alt: p.title })}</div>
      <div class="card__sheen"></div>
      <div class="card__quick">
        <button class="btn btn--gold" data-add="${p.id}">${ICONS.cart}<span>افزودن</span></button>
        <button class="btn btn--ghost" data-quick="${p.id}" aria-label="نمایش سریع">${ICONS.eye}</button>
      </div>
    </div>
    <div class="card__body">
      <span class="card__cat">${catTitle(p.cat)}</span>
      <h3 class="card__title"><a href="product.html?id=${p.id}">${p.title}</a></h3>
      <div class="card__meta">
        ${stars(p.rating)}
        <span>${toFa(p.reviews)} دیدگاه</span>
        <span>${ICONS.scale}${toFa(p.weight)} گرم</span>
      </div>
      <div class="card__foot">
        <div class="card__price">
          <b>${tomanShort(p.price)}</b>
          <small>تومان · عیار ${toFa(p.karat)}</small>
        </div>
        <div class="card__swatches">
          ${(p.colors || []).map((c) => `<i class="card__sw" style="background:${METALS[c]?.hex}" title="${METALS[c]?.fa}"></i>`).join('')}
        </div>
      </div>
    </div>
  </article>`;
}

/* ======================= واکنش‌های سراسری روی کارت‌ها ======================= */
function bindProductActions(root = document) {
  on(root, 'click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { e.preventDefault(); Cart.add(add.dataset.add); return; }
    const fav = e.target.closest('[data-fav]');
    if (fav) { e.preventDefault(); Fav.toggle(fav.dataset.fav); return; }
    const q = e.target.closest('[data-quick]');
    if (q) { e.preventDefault(); openQuick(q.dataset.quick); }
  });
}

/* ============================ افکت سه‌بعدی کارت ============================ */
function tilt(el) {
  if (reduceMotion || matchMedia('(pointer:coarse)').matches) return;
  let raf = 0;
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      el.style.transform = `perspective(900px) rotateX(${-y * 9}deg) rotateY(${x * 11}deg) translateY(-6px)`;
    });
  };
  const out = () => { cancelAnimationFrame(raf); el.style.transform = ''; };
  on(el, 'pointermove', move); on(el, 'pointerleave', out);
}

/* ============================== نمایش سریع ============================== */
function openQuick(id) {
  const p = byId(id); if (!p) return;
  let m = $('#quick');
  if (!m) {
    m = document.createElement('div');
    m.id = 'quick'; m.className = 'modal';
    m.innerHTML = `<div class="scrim on" data-close></div><div class="modal__card">
      <button class="modal__close" data-close aria-label="بستن">${ICONS.close}</button>
      <div class="modal__media" id="qMedia"></div>
      <div class="modal__body" id="qBody"></div></div>`;
    document.body.appendChild(m);
    on(m, 'click', (e) => { if (e.target.closest('[data-close]')) closeQuick(); });
  }
  const bd = p.breakdown;
  $('#qMedia', m).innerHTML = jewelSVG(p.art, { metal: p.metal, gem: p.gem, alt: p.title });
  $('#qBody', m).innerHTML = `
    <span class="card__cat">${catTitle(p.cat)}</span>
    <h3 class="h2">${p.title}</h3>
    <div class="row gap-12">${stars(p.rating)}<span class="tiny">${toFa(p.reviews)} دیدگاه</span></div>
    <p class="lead" style="font-size:.92rem">${p.desc}</p>
    <div class="hairline"></div>
    <div class="calc__row"><span>وزن</span><b>${toFa(p.weight)} گرم</b></div>
    <div class="calc__row"><span>عیار</span><b>${toFa(p.karat)}</b></div>
    ${p.gem ? `<div class="calc__row"><span>نگین</span><b>${GEMS[p.gem].fa} · ${toFa(p.carat)} قیراط</b></div>` : ''}
    <div class="calc__row"><span>اجرت ساخت</span><b>${toFa(p.wage)}٪</b></div>
    <div class="calc__row calc__row--total"><span>قیمت نهایی</span><b>${toman(p.price)}</b></div>
    <div class="row gap-12 mt-16">
      <button class="btn btn--gold" data-add="${p.id}">${ICONS.cart}افزودن به سبد</button>
      <a class="btn btn--ghost" href="product.html?id=${p.id}">جزئیات کامل</a>
    </div>`;
  m.classList.add('on'); document.body.classList.add('no-scroll');
}
function closeQuick() {
  $('#quick')?.classList.remove('on');
  document.body.classList.remove('no-scroll');
}

/* ============================== جست‌وجو ============================== */
function initSearch() {
  const ov = $('#search'), inp = $('#searchInput'), res = $('#searchRes');
  if (!ov) return;
  const open = () => { ov.classList.add('on'); document.body.classList.add('no-scroll'); setTimeout(() => inp.focus(), 260); };
  const close = () => { ov.classList.remove('on'); document.body.classList.remove('no-scroll'); };
  $$('[data-search-open]').forEach((b) => on(b, 'click', open));
  $$('[data-search-close]').forEach((b) => on(b, 'click', close));
  on(document, 'keydown', (e) => {
    if (e.key === 'Escape') { close(); closeQuick(); closeDrawer(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); open(); }
  });

  const run = (q) => {
    q = q.trim().toLowerCase();
    if (!q) { res.innerHTML = ''; return; }
    const hits = PRODUCTS.filter((p) =>
      (p.title + ' ' + p.en + ' ' + catTitle(p.cat) + ' ' + (GEMS[p.gem]?.fa || '') + ' ' + p.desc)
        .toLowerCase().includes(q)).slice(0, 7);
    res.innerHTML = hits.length ? hits.map((p) => `
      <a class="search-res__item" href="product.html?id=${p.id}">
        <div class="search-res__art">${jewelSVG(p.art, { metal: p.metal, gem: p.gem })}</div>
        <div class="search-res__b"><b>${p.title}</b><span>${catTitle(p.cat)} · ${toman(p.price)}</span></div>
      </a>`).join('')
      : `<p class="tiny" style="padding:16px">نتیجه‌ای برای «${q}» پیدا نشد. عبارت دیگری را امتحان کنید.</p>`;
  };
  on(inp, 'input', (e) => run(e.target.value));
  $$('[data-sq]').forEach((c) => on(c, 'click', () => { inp.value = c.dataset.sq; run(c.dataset.sq); }));
}

/* ============================== کشوی سبد ============================== */
function openDrawer() { $('#cartDrawer')?.classList.add('on'); $('#scrim')?.classList.add('on'); document.body.classList.add('no-scroll'); }
function closeDrawer() { $('#cartDrawer')?.classList.remove('on'); $('#scrim')?.classList.remove('on'); document.body.classList.remove('no-scroll'); }

function initCartUI() {
  on($('#cartBtn'), 'click', openDrawer);
  $$('[data-cart-close]').forEach((b) => on(b, 'click', closeDrawer));
  on($('#scrim'), 'click', closeDrawer);
  on($('#cartBody'), 'click', (e) => {
    const q = e.target.closest('[data-q]');
    if (q) { const i = +q.dataset.i; Cart.setQty(i, Cart.items[i].qty + (+q.dataset.q)); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) Cart.remove(+rm.dataset.rm);
  });
  on($('#checkout'), 'click', () => {
    if (!Cart.items.length) return;
    toast('سفارش ثبت شد؛ همکاران ما برای هماهنگی تماس می‌گیرند.', 'check');
  });
  Cart.render();
}

/* ============================== رابط کلی ============================== */
function initChrome() {
  // تزریق گرادیان‌های مشترک SVG
  document.body.insertAdjacentHTML('afterbegin', GRADIENT_DEFS);
  $$('[data-logo]').forEach((el) => { el.innerHTML = LOGO_MARK + el.innerHTML; });
  // آیکون را به ابتدای عنصر می‌افزاییم تا فرزندان موجود (مثل نشان تعداد سبد) پاک نشوند
  $$('[data-ico]').forEach((el) => el.insertAdjacentHTML('afterbegin', ICONS[el.dataset.ico] || ''));

  // پوسته‌ی روشن/تاریک
  const root = document.documentElement;
  const saved = store.get('theme', null);
  if (saved) root.setAttribute('data-theme', saved);
  const paintTheme = () => {
    const dark = root.getAttribute('data-theme') !== 'light';
    $$('[data-theme-toggle]').forEach((b) => { b.innerHTML = dark ? ICONS.sun : ICONS.moon; b.setAttribute('aria-label', dark ? 'پوسته‌ی روشن' : 'پوسته‌ی تاریک'); });
  };
  paintTheme();
  $$('[data-theme-toggle]').forEach((b) => on(b, 'click', () => {
    const light = root.getAttribute('data-theme') === 'light';
    root.setAttribute('data-theme', light ? 'dark' : 'light');
    store.set('theme', light ? 'dark' : 'light'); paintTheme();
  }));

  // هدر چسبان + نوار پیشرفت + دکمه‌ی بالا
  const header = $('.header'), prog = $('#progress'), top = $('#toTop');
  let tick = false;
  const scroll = () => {
    const y = scrollY;
    header?.classList.toggle('is-stuck', y > 20);
    top?.classList.toggle('on', y > 700);
    if (prog) {
      const max = document.body.scrollHeight - innerHeight;
      prog.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
    }
    tick = false;
  };
  on(window, 'scroll', () => { if (!tick) { tick = true; requestAnimationFrame(scroll); } }, { passive: true });
  scroll();
  on(top, 'click', () => scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  // منوی موبایل
  const mnav = $('#mnav');
  $$('[data-mnav]').forEach((b) => on(b, 'click', () => {
    const open = mnav.classList.toggle('on');
    document.body.classList.toggle('no-scroll', open);
    b.innerHTML = open ? ICONS.close : ICONS.menu;
  }));
  $$('#mnav a').forEach((a) => on(a, 'click', () => {
    mnav.classList.remove('on'); document.body.classList.remove('no-scroll');
    $$('[data-mnav]').forEach((b) => (b.innerHTML = ICONS.menu));
  }));

  // مگامنو
  $$('.nav__item').forEach((item) => {
    const link = $('.nav__link', item);
    if (!$('.mega', item)) return;
    let t;
    on(item, 'mouseenter', () => { clearTimeout(t); item.classList.add('is-open'); link?.setAttribute('aria-expanded', 'true'); });
    on(item, 'mouseleave', () => { t = setTimeout(() => { item.classList.remove('is-open'); link?.setAttribute('aria-expanded', 'false'); }, 130); });
    on(link, 'click', (e) => { e.preventDefault(); item.classList.toggle('is-open'); });
  });

  // نشانگر سفارشی
  if (!reduceMotion && matchMedia('(hover:hover) and (pointer:fine)').matches) {
    const dot = document.createElement('div'), ring = document.createElement('div');
    dot.className = 'cursor'; ring.className = 'cursor-ring';
    document.body.append(dot, ring);
    let rx = 0, ry = 0, tx = 0, ty = 0;
    on(window, 'pointermove', (e) => {
      tx = e.clientX; ty = e.clientY;
      dot.style.transform = `translate(${tx}px,${ty}px)`;
      const hit = e.target.closest('a,button,.card,[data-tilt],input,select');
      ring.classList.toggle('grow', !!hit);
    });
    (function loop() { rx += (tx - rx) * 0.16; ry += (ty - ry) * 0.16; ring.style.transform = `translate(${rx}px,${ry}px)`; requestAnimationFrame(loop); })();
  }

  // ظهور تدریجی هنگام اسکرول
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  $$('[data-reveal],[data-stagger]').forEach((el) => io.observe(el));
  // شبکه‌ی ایمنی: اگر به هر دلیلی ناظر اجرا نشد، محتوا پنهان نمی‌ماند
  setTimeout(() => $$('[data-reveal],[data-stagger]').forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight) el.classList.add('in');
  }), 1200);

  // شمارنده‌ها
  const cio = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target, to = +el.dataset.count, dur = 1500;
    let t0 = null;
    const step = (t) => {
      if (!t0) t0 = t;
      const k = Math.min((t - t0) / dur, 1), e2 = 1 - Math.pow(1 - k, 3);
      el.textContent = toFa(Math.round(to * e2).toLocaleString('en-US'));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step); cio.unobserve(el);
  }), { threshold: 0.5 });
  $$('[data-count]').forEach((el) => cio.observe(el));

  // پیوندهای لنگری
  $$('a[href^="#"]').forEach((a) => on(a, 'click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const t = $(id); if (!t) return;
    e.preventDefault();
    scrollTo({ top: t.getBoundingClientRect().top + scrollY - 90, behavior: reduceMotion ? 'auto' : 'smooth' });
  }));

  // آکاردئون — با واگذاری رویداد، تا برای محتوای ساخته‌شده پس از این هم کار کند
  on(document, 'click', (e) => {
    const head = e.target.closest('.acc__head'); if (!head) return;
    const acc = head.closest('.acc'); if (!acc) return;
    const body = $('.acc__body', acc), open = acc.classList.contains('is-open');
    $$('.acc.is-open').forEach((o) => {
      if (o !== acc) { o.classList.remove('is-open'); const ob = $('.acc__body', o); if (ob) ob.style.maxHeight = 0; }
    });
    acc.classList.toggle('is-open', !open);
    if (body) body.style.maxHeight = open ? 0 : body.scrollHeight + 'px';
  });

  $$('[data-tilt]').forEach(tilt);
}

/* ============================ پیش‌بارگذار ============================ */
function initPreloader() {
  const pre = $('#preloader'); if (!pre) return;
  const bar = $('#preBar');
  let v = 0;
  const t = setInterval(() => { v = Math.min(v + Math.random() * 22, 92); if (bar) bar.style.width = v + '%'; }, 130);
  const done = () => {
    clearInterval(t); if (bar) bar.style.width = '100%';
    setTimeout(() => { pre.classList.add('off'); setTimeout(() => pre.remove(), 800); }, 260);
  };
  if (document.readyState === 'complete') setTimeout(done, 320);
  else on(window, 'load', () => setTimeout(done, 320));
  setTimeout(done, 4500);   // ایمنی در برابر منابع کند
}

/* =========================== نرخ لحظه‌ای طلا =========================== */
/* نرخ‌ها نمایشی‌اند. برای اتصال به سرویس واقعی، آدرس API را در ZARRIN_RATES_API
   قرار دهید؛ پاسخ باید شکل { gram18, gram24, coinEmami, ... } داشته باشد. */
const RATES_API = window.ZARRIN_RATES_API || null;
const live = { ...RATES };

async function fetchRates() {
  if (!RATES_API) return false;
  try {
    const r = await fetch(RATES_API, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status);
    Object.assign(live, await r.json());
    return true;
  } catch { return false; }
}

function drift() {
  // نوسان کوچک و تصادفی فقط برای حالت نمایشی
  for (const k of ['gram18', 'gram24', 'mesghal', 'coinEmami', 'coinHalf', 'coinQuarter']) {
    const base = RATES[k];
    live[k] = Math.round(base * (1 + (Math.random() - 0.5) * 0.004));
  }
}

function paintRates() {
  const rows = [
    ['هر گرم طلای ۱۸ عیار', 'gram18'], ['هر گرم طلای ۲۴ عیار', 'gram24'],
    ['مثقال طلا', 'mesghal'], ['سکه امامی', 'coinEmami'],
    ['نیم سکه', 'coinHalf'], ['ربع سکه', 'coinQuarter'],
  ];
  const track = $('#ticker');
  if (track) {
    const items = rows.map(([t, k]) => {
      const d = live[k] - RATES[k], up = d >= 0;
      return `<span class="ticker__item">${t} <b>${tomanShort(live[k])}</b>
        <em class="${up ? 'ticker__up' : 'ticker__dn'}" style="font-style:normal">${up ? '▲' : '▼'} ${toFa(Math.abs(Math.round(d / 1000)))}k</em></span>`;
    }).join('');
    track.innerHTML = items + items;   // دو نسخه برای پیوستگی حرکت نوار
  }
  $$('[data-rate]').forEach((el) => { el.textContent = tomanShort(live[el.dataset.rate]); });
  $$('[data-rate-delta]').forEach((el) => {
    const k = el.dataset.rateDelta, d = live[k] - RATES[k], up = d >= 0;
    el.className = 'rate__d ' + (up ? 'ticker__up' : 'ticker__dn');
    el.textContent = `${up ? '▲' : '▼'} ${toFa((Math.abs(d) / RATES[k] * 100).toFixed(2))}٪ امروز`;
  });
  const stamp = $('#rateStamp');
  if (stamp) stamp.textContent = 'آخرین به‌روزرسانی: ' + new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}

async function initRates() {
  if (!$('#ticker') && !$('[data-rate]')) return;
  const real = await fetchRates();
  if (!real) drift();
  paintRates();
  setInterval(async () => { if (!(await fetchRates())) drift(); paintRates(); }, 45000);
}

/* ========================== ماشین‌حساب قیمت ========================== */
function initCalc() {
  const form = $('#calc'); if (!form) return;
  const out = $('#calcOut');
  const run = () => {
    const weight = Math.max(0, +$('#cWeight').value || 0);
    const karat = +$('#cKarat').value;
    const wagePct = Math.max(0, +$('#cWage').value || 0);
    const profitPct = Math.max(0, +$('#cProfit').value || 0);
    const b = priceBreakdown({ weight, karat, wagePct, profitPct, rates: live });
    const pct = (v) => (b.total ? (v / b.total) * 100 : 0);
    out.innerHTML = `
      <div class="calc__row"><span>ارزش طلای خام</span><b>${toman(b.gold)}</b></div>
      <div class="calc__row"><span>اجرت ساخت (${toFa(wagePct)}٪)</span><b>${toman(b.wage)}</b></div>
      <div class="calc__row"><span>سود فروشنده (${toFa(profitPct)}٪)</span><b>${toman(b.profit)}</b></div>
      <div class="calc__row"><span>مالیات بر ارزش افزوده (۹٪)</span><b>${toman(b.vat)}</b></div>
      <div class="calc__bar">
        <i style="width:${pct(b.gold)}%;background:linear-gradient(90deg,#d4af37,#f7e9b6)"></i>
        <i style="width:${pct(b.wage)}%;background:#8b6fd6"></i>
        <i style="width:${pct(b.profit)}%;background:#4ec98a"></i>
        <i style="width:${pct(b.vat)}%;background:#e2607a"></i>
      </div>
      <div class="calc__row calc__row--total"><span>مبلغ قابل پرداخت</span><b class="gold-text">${toman(b.total)}</b></div>
      <p class="tiny mt-8">محاسبه بر پایه‌ی نرخ ${toman(karat === 24 ? live.gram24 : live.gram18)} برای هر گرم انجام شده است.</p>`;
  };
  $$('input,select', form).forEach((i) => { on(i, 'input', run); on(i, 'change', run); });
  run();
}

/* =========================== راهنمای سایز =========================== */
function initSize() {
  const tb = $('#sizeTable'); if (!tb) return;
  tb.innerHTML = RING_SIZES.map((s) => `<tr data-mm="${s.mm}">
    <td><b>${toFa(s.ir)}</b></td><td>${toFa(s.mm)}</td><td>${toFa(s.us)}</td><td>${s.uk}</td>
    <td>${toFa((s.mm / Math.PI).toFixed(1))}</td></tr>`).join('');
  const inp = $('#sizeInput'), res = $('#sizeResult');
  on(inp, 'input', () => {
    const mm = +inp.value;
    $$('#sizeTable tr').forEach((r) => r.classList.remove('hit'));
    if (!mm || mm < 40 || mm > 80) { res.textContent = 'محیط انگشت را بین ۴۰ تا ۸۰ میلی‌متر وارد کنید.'; res.className = 'form-msg'; return; }
    let best = RING_SIZES[0];
    for (const s of RING_SIZES) if (Math.abs(s.mm - mm) < Math.abs(best.mm - mm)) best = s;
    const row = $(`#sizeTable tr[data-mm="${best.mm}"]`);
    row?.classList.add('hit'); row?.scrollIntoView({ block: 'nearest' });
    res.innerHTML = `سایز پیشنهادی شما: <b class="gold-text">${toFa(best.ir)}</b> (معادل US ${toFa(best.us)} و UK ${best.uk})`;
    res.className = 'form-msg ok';
  });
}

/* ============================ اسلایدر نظرات ============================ */
function initSlider() {
  const s = $('#quotes'); if (!s) return;
  const track = $('.slider__track', s), nav = $('#quoteNav');
  track.innerHTML = TESTIMONIALS.map((t) => `<div class="slider__slide"><figure class="quote">
    <div class="quote__mark">”</div>
    <blockquote class="quote__txt">${t.text}</blockquote>
    ${stars(t.rate)}
    <figcaption class="quote__who"><b>${t.name}</b><span>${t.city}</span></figcaption>
  </figure></div>`).join('');
  nav.innerHTML = TESTIMONIALS.map((_, i) => `<button class="slider__dot${i ? '' : ' on'}" data-i="${i}" aria-label="نظر ${toFa(i + 1)}"></button>`).join('');
  let i = 0, timer;
  const go = (n) => {
    i = (n + TESTIMONIALS.length) % TESTIMONIALS.length;
    track.style.transform = `translateX(${i * 100}%)`;   // چیدمان راست‌به‌چپ
    $$('.slider__dot', nav).forEach((d, k) => d.classList.toggle('on', k === i));
  };
  on(nav, 'click', (e) => { const b = e.target.closest('[data-i]'); if (b) { go(+b.dataset.i); restart(); } });
  on($('#qPrev'), 'click', () => { go(i - 1); restart(); });
  on($('#qNext'), 'click', () => { go(i + 1); restart(); });
  const restart = () => { clearInterval(timer); if (!reduceMotion) timer = setInterval(() => go(i + 1), 6500); };
  restart();
  on(s, 'mouseenter', () => clearInterval(timer));
  on(s, 'mouseleave', restart);
}

/* =============================== فرم‌ها =============================== */
function initForms() {
  $$('form[data-validate]').forEach((f) => on(f, 'submit', (e) => {
    e.preventDefault();
    const msg = $('.form-msg', f) || f.appendChild(Object.assign(document.createElement('p'), { className: 'form-msg' }));
    const email = $('input[type="email"]', f);
    const tel = $('input[type="tel"]', f);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value)) {
      msg.textContent = 'نشانی ایمیل معتبر نیست.'; msg.className = 'form-msg err'; email.focus(); return;
    }
    if (tel && !/^0?9\d{9}$/.test(tel.value.replace(/[\s-]/g, ''))) {
      msg.textContent = 'شماره‌ی موبایل باید ۱۱ رقم و با ۰۹ شروع شود.'; msg.className = 'form-msg err'; tel.focus(); return;
    }
    for (const req of $$('[required]', f)) if (!req.value.trim()) {
      msg.textContent = 'لطفاً همه‌ی فیلدهای الزامی را پر کنید.'; msg.className = 'form-msg err'; req.focus(); return;
    }
    msg.textContent = f.dataset.ok || 'پیام شما ثبت شد. به‌زودی پاسخ می‌دهیم.';
    msg.className = 'form-msg ok'; f.reset();
  }));
}

/* ============================ صحنه‌های سه‌بعدی ============================ */
function initStages() {
  $$('[data-jewel]').forEach((stage) => {
    const canvas = $('canvas', stage);
    const loader = $('.stage__loader', stage);
    if (!canvas) return;
    const opts = {
      metal: stage.dataset.metal || 'yellow',
      gem: stage.dataset.gem || 'diamond',
      halo: stage.dataset.halo === 'true',
      autoRotate: stage.dataset.rotate !== 'false' && !reduceMotion,
      band: +(stage.dataset.band || 0.115),
    };
    const view = mountJewel(canvas, opts);
    if (!view) {
      // نسخه‌ی جایگزین برای مرورگرهای بدون WebGL2
      stage.classList.add('stage--fallback');
      canvas.remove();
      loader?.remove();
      stage.insertAdjacentHTML('beforeend',
        `<div class="stage__fallback">${jewelSVG('ring', { metal: opts.metal, gem: opts.gem, alt: 'انگشتر' })}</div>`);
      $('.stage__hint', stage)?.remove();
      return;
    }
    stage._jewel = view;
    setTimeout(() => loader?.classList.add('off'), 420);
    on(canvas, 'jewel:lost', () => { loader?.classList.remove('off'); if (loader) loader.textContent = 'بازیابی نمایشگر…'; });
  });
}

function initConfigurator() {
  const wrap = $('#configurator'); if (!wrap) return;
  const stage = $('[data-jewel]', wrap), view = stage?._jewel;
  const state = { metal: 'yellow', gem: 'diamond', band: 0.115, halo: false };

  const priceOf = () => {
    // وزن تقریبی بر پایه‌ی ضخامت رینگ و اندازه‌ی نگین
    const weight = 2.4 + (state.band - 0.06) * 26 + (state.halo ? 1.1 : 0);
    const wagePct = 16 + (state.halo ? 6 : 0) + (state.gem === 'diamond' ? 4 : 0);
    return { weight: +weight.toFixed(2), ...priceBreakdown({ weight, wagePct }) };
  };
  const paint = () => {
    const p = priceOf();
    $('#cfgPrice').textContent = toman(p.total);
    const nameEl = $('#cfgMetalName'); if (nameEl) nameEl.textContent = METALS[state.metal].fa;
    $('#cfgSpec').textContent =
      `${METALS[state.metal].fa} · نگین ${GEMS[state.gem].fa} · وزن تقریبی ${toFa(p.weight)} گرم${state.halo ? ' · با هاله‌ی ریزنگین' : ''}`;
  };

  $$('[data-cfg-metal]', wrap).forEach((b) => on(b, 'click', () => {
    state.metal = b.dataset.cfgMetal;
    $$('[data-cfg-metal]', wrap).forEach((x) => x.classList.toggle('on', x === b));
    view?.setMetal(state.metal); paint();
  }));
  $$('[data-cfg-gem]', wrap).forEach((b) => on(b, 'click', () => {
    state.gem = b.dataset.cfgGem;
    $$('[data-cfg-gem]', wrap).forEach((x) => x.classList.toggle('on', x === b));
    view?.setGem(state.gem); paint();
  }));
  on($('#cfgBand'), 'input', (e) => {
    state.band = +e.target.value;
    $('#cfgBandVal').textContent = toFa((state.band * 26).toFixed(1)) + ' میلی‌متر';
    view?.setBand(state.band); paint();
  });
  on($('#cfgHalo'), 'click', (e) => {
    state.halo = !state.halo;
    e.currentTarget.classList.toggle('on', state.halo);
    e.currentTarget.textContent = state.halo ? 'با هاله' : 'بدون هاله';
    view?.setHalo(state.halo); paint();
  });
  on($('#cfgSpin'), 'click', (e) => {
    const on_ = !view?.opts.autoRotate;
    view?.setAutoRotate(on_);
    e.currentTarget.classList.toggle('on', on_);
  });
  on($('#cfgOrder'), 'click', () => toast('درخواست ساخت اختصاصی ثبت شد؛ کارشناس ما تماس می‌گیرد.', 'sparkles'));
  paint();
}

/* ============================= صفحه‌ی فروشگاه ============================= */
function initShop() {
  const grid = $('#shopGrid'); if (!grid) return;
  const state = {
    cat: new URLSearchParams(location.search).get('cat') || 'all',
    gem: 'all', metal: 'all', sort: 'featured', max: 200_000_000, q: '',
  };
  const chips = $('#shopCats');
  if (chips) {
    chips.innerHTML = `<button class="chip is-on" data-c="all">همه</button>` +
      CATEGORIES.map((c) => `<button class="chip" data-c="${c.id}">${c.title}</button>`).join('');
    $$('.chip', chips).forEach((b) => b.classList.toggle('is-on', b.dataset.c === state.cat));
    on(chips, 'click', (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      state.cat = b.dataset.c;
      $$('.chip', chips).forEach((x) => x.classList.toggle('is-on', x === b));
      render();
    });
  }
  on($('#fGem'), 'change', (e) => { state.gem = e.target.value; render(); });
  on($('#fMetal'), 'change', (e) => { state.metal = e.target.value; render(); });
  on($('#fSort'), 'change', (e) => { state.sort = e.target.value; render(); });
  on($('#fQ'), 'input', (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
  on($('#fMax'), 'input', (e) => {
    state.max = +e.target.value;
    $('#fMaxVal').textContent = tomanShort(state.max) + ' تومان';
    render();
  });

  function render() {
    let list = PRODUCTS.filter((p) =>
      (state.cat === 'all' || p.cat === state.cat) &&
      (state.gem === 'all' || (state.gem === 'none' ? !p.gem : p.gem === state.gem)) &&
      (state.metal === 'all' || (p.colors || []).includes(state.metal)) &&
      p.price <= state.max &&
      (!state.q || (p.title + p.en + p.desc + catTitle(p.cat)).toLowerCase().includes(state.q)));

    const sorters = {
      featured: (a, b) => (b.rating * 10 + b.reviews / 50) - (a.rating * 10 + a.reviews / 50),
      cheap: (a, b) => a.price - b.price,
      pricey: (a, b) => b.price - a.price,
      light: (a, b) => a.weight - b.weight,
      rating: (a, b) => b.rating - a.rating,
    };
    list.sort(sorters[state.sort] || sorters.featured);

    $('#shopCount').textContent = `${toFa(list.length)} قطعه`;
    grid.innerHTML = list.length ? list.map(cardHTML).join('')
      : `<p class="lead" style="grid-column:1/-1;text-align:center;padding:60px 0">
           قطعه‌ای با این فیلترها پیدا نشد. محدوده‌ی قیمت یا دسته را تغییر دهید.</p>`;
    $$('[data-tilt]', grid).forEach(tilt);
    Fav.paint();
  }
  render();
}

/* ============================ صفحه‌ی محصول ============================ */
function initProduct() {
  const root = $('#productPage'); if (!root) return;
  const id = new URLSearchParams(location.search).get('id');
  const p = byId(id) || PRODUCTS[0];
  const b = p.breakdown;
  let metal = p.metal;

  document.title = `${p.title} | ${SHOP.name}`;
  $('#pCrumb').textContent = p.title;
  $('#pCat').textContent = catTitle(p.cat);
  $('#pTitle').textContent = p.title;
  $('#pEn').textContent = p.en;
  $('#pDesc').textContent = p.desc;
  $('#pRate').innerHTML = stars(p.rating) + `<span class="tiny">${toFa(p.reviews)} دیدگاه ثبت‌شده</span>`;
  $('#pPrice').textContent = toman(p.price);
  $('#pStock').textContent = p.stock > 3 ? 'موجود در انبار' : `تنها ${toFa(p.stock)} عدد باقی مانده`;
  $('#pStock').className = p.stock > 3 ? 'ticker__up tiny' : 'ticker__dn tiny';

  const stage = $('[data-jewel]', root);
  if (stage) {
    const halo = p.cat === 'set' || p.carat > 1;
    stage.dataset.metal = p.metal;
    stage.dataset.gem = p.gem || 'diamond';
    stage.dataset.halo = String(halo);
    // نمایشگر پیش‌تر با مقادیر پیش‌فرض سوار شده، پس همین‌جا به‌روزش می‌کنیم
    const v = stage._jewel;
    if (v) { v.setMetal(p.metal); v.setGem(p.gem || 'diamond'); v.setHalo(halo); }
  }

  $('#pSpecs').innerHTML = [
    ['دسته‌بندی', catTitle(p.cat)],
    ['وزن', `${toFa(p.weight)} گرم`],
    ['عیار طلا', toFa(p.karat)],
    p.gem ? ['نگین', `${GEMS[p.gem].fa} · ${toFa(p.carat)} قیراط`] : ['نگین', 'بدون نگین'],
    ['رنگ طلا', (p.colors || []).map((c) => METALS[c].fa).join('، ')],
    ['کد کالا', p.id.toUpperCase()],
  ].map(([k, v]) => `<div class="calc__row"><span>${k}</span><b>${v}</b></div>`).join('');

  $('#pBreak').innerHTML = `
    <div class="calc__row"><span>ارزش طلای خام</span><b>${toman(b.gold)}</b></div>
    <div class="calc__row"><span>اجرت ساخت (${toFa(p.wage)}٪)</span><b>${toman(b.wage)}</b></div>
    <div class="calc__row"><span>سود فروشنده (۷٪)</span><b>${toman(b.profit)}</b></div>
    <div class="calc__row"><span>مالیات بر ارزش افزوده (۹٪)</span><b>${toman(b.vat)}</b></div>
    <div class="calc__row calc__row--total"><span>قیمت نهایی</span><b class="gold-text">${toman(p.price)}</b></div>`;

  const sw = $('#pMetals');
  sw.innerHTML = (p.colors || [p.metal]).map((c, i) =>
    `<button class="sw${i ? '' : ' on'}" data-m="${c}" style="--sw:${METALS[c].hex}" aria-label="${METALS[c].fa}">
      <span class="sw__tip">${METALS[c].fa}</span></button>`).join('');
  on(sw, 'click', (e) => {
    const t = e.target.closest('[data-m]'); if (!t) return;
    metal = t.dataset.m;
    $$('.sw', sw).forEach((x) => x.classList.toggle('on', x === t));
    stage?._jewel?.setMetal(metal);
  });

  if (p.cat === 'ring') {
    const sel = $('#pSize');
    sel.innerHTML = RING_SIZES.map((s) => `<option value="${s.ir}"${s.ir === 56 ? ' selected' : ''}>سایز ${toFa(s.ir)} (${toFa(s.mm)} میلی‌متر)</option>`).join('');
  } else { $('#pSizeWrap')?.remove(); }

  on($('#pAdd'), 'click', () => Cart.add(p.id, metal));
  const favBtn = $('#pFav');
  const paintFav = () => { favBtn.classList.toggle('on', Fav.has(p.id)); favBtn.innerHTML = ICONS.heart + (Fav.has(p.id) ? '<span>در علاقه‌مندی‌ها</span>' : '<span>افزودن به علاقه‌مندی</span>'); };
  on(favBtn, 'click', () => { Fav.toggle(p.id); paintFav(); });
  paintFav();

  const rel = PRODUCTS.filter((x) => x.cat === p.cat && x.id !== p.id).slice(0, 4);
  const pool = rel.length >= 4 ? rel : rel.concat(PRODUCTS.filter((x) => x.id !== p.id && !rel.includes(x)).slice(0, 4 - rel.length));
  $('#pRelated').innerHTML = pool.map(cardHTML).join('');
  $$('#pRelated [data-tilt]').forEach(tilt);

  // داده‌ی ساختاریافته برای موتور جست‌وجو
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: p.title, sku: p.id.toUpperCase(), description: p.desc,
    brand: { '@type': 'Brand', name: SHOP.name },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviews },
    offers: { '@type': 'Offer', price: p.price, priceCurrency: 'IRR',
      availability: p.stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' },
  });
  document.head.appendChild(ld);
}

/* =========================== رندر بخش‌های ثابت =========================== */
function initHomeSections() {
  const coll = $('#collections');
  if (coll) coll.innerHTML = COLLECTIONS.map((c, i) => `
    <a class="coll" data-tilt href="products.html?cat=${c.cat}">
      <span class="coll__num">${toFa(String(i + 1).padStart(2, '0'))}</span>
      <div class="coll__glow" style="background:radial-gradient(circle,${c.tone}66,transparent 70%)"></div>
      <div class="coll__art">${jewelSVG(CATEGORIES.find((x) => x.id === c.cat)?.icon || 'ring', { metal: i % 2 ? 'white' : 'yellow', gem: ['diamond', 'emerald', 'ruby', 'sapphire'][i % 4] })}</div>
      <div class="coll__body">
        <span class="coll__en">${c.en}</span>
        <h3 class="coll__t">${c.title}</h3>
        <p class="coll__d">${c.desc}</p>
      </div>
    </a>`).join('');

  const feat = $('#featured');
  if (feat) {
    const list = PRODUCTS.filter((p) => p.badge).slice(0, 8);
    feat.innerHTML = (list.length >= 8 ? list : PRODUCTS.slice(0, 8)).map(cardHTML).join('');
  }

  const cats = $('#catGrid');
  if (cats) cats.innerHTML = CATEGORIES.map((c) => `
    <a class="mega__link" href="products.html?cat=${c.id}">
      <i>${ICONS.gem}</i><span><b>${c.title}</b><span>${c.sub}</span></span>
    </a>`).join('');

  const faq = $('#faq');
  if (faq) faq.innerHTML = FAQ.map((f) => `
    <div class="acc">
      <button class="acc__head">${f.q}<span class="acc__ico">${ICONS.plus}</span></button>
      <div class="acc__body"><p>${f.a}</p></div>
    </div>`).join('');

  const jr = $('#journal');
  if (jr) jr.innerHTML = JOURNAL.map((j, i) => `
    <article class="post">
      <div class="post__media">${jewelSVG(['necklace', 'bangle', 'coin'][i % 3], { metal: ['yellow', 'white', 'rose'][i % 3], gem: 'diamond' })}</div>
      <div class="post__body">
        <span class="post__c">${j.c}</span>
        <h3 class="post__t">${j.t}</h3>
        <p class="post__s">${j.s}</p>
        <span class="tiny mt-8">${j.d}</span>
      </div>
    </article>`).join('');

  const br = $('#branches');
  if (br) br.innerHTML = SHOP.branches.map((b) => `
    <div class="value">
      <i>${ICONS.map}</i>
      <b>${b.title}</b>
      <p>${b.addr}</p>
      <a class="link-underline" href="tel:${b.tel.replace(/\D/g, '')}">${b.tel}</a>
    </div>`).join('');
}

/* ================================ راه‌اندازی ================================ */
function boot() {
  // بخش‌های ساخته‌شده با جاوااسکریپت باید پیش از تزریق آیکون‌ها در DOM باشند
  initHomeSections();
  initChrome();
  initPreloader();
  bindProductActions();
  initCartUI();
  initSearch();
  initStages();
  initConfigurator();
  initShop();
  initProduct();
  initCalc();
  initSize();
  initSlider();
  initForms();
  initRates();
  $$('[data-tilt]').forEach(tilt);
  Fav.paint();
  document.body.classList.add('ready');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
