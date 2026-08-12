/*!
 * فولاد ایمان — اسکریپت سبک سایت (بدون هیچ کتابخانه‌ی خارجی)
 * سه کار انجام می‌دهد: منوی موبایل، انیمیشن ورود با اسکرول، و گالری عکس محصول.
 */
(function () {
  'use strict';

  // ----------------------------------------------------- منوی موبایل
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('main-nav');
  var backdrop = document.querySelector('.nav-backdrop');

  if (toggle && nav) {
    var setMenu = function (open) {
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (backdrop) {
        backdrop.hidden = false;
        backdrop.classList.toggle('show', open);
      }
      // وقتی منو باز است، صفحه‌ی پشت آن اسکرول نشود
      document.body.style.overflow = open ? 'hidden' : '';
    };

    toggle.addEventListener('click', function () {
      setMenu(!nav.classList.contains('open'));
    });

    // با کلیک روی هر لینک یا روی پرده‌ی تیره، منو بسته شود
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    if (backdrop) backdrop.addEventListener('click', function () { setMenu(false); });

    // با کلید Escape هم بسته شود
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setMenu(false);
        toggle.focus();
      }
    });

    // اگر کاربر گوشی را افقی کرد و صفحه بزرگ شد، منو بسته شود
    window.addEventListener('resize', function () {
      if (window.innerWidth > 900 && nav.classList.contains('open')) setMenu(false);
    });
  }

  // -------------------------------------------- انیمیشن ظریف هنگام اسکرول
  var revealables = document.querySelectorAll('.reveal');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (revealables.length && !reduceMotion && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
    revealables.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    // مرورگر قدیمی یا حالت کاهش انیمیشن: محتوا بدون انیمیشن دیده شود
    revealables.forEach(function (el) {
      el.classList.add('in');
    });
  }

  // ------------------- ارسال خودکار فرم فیلتر با تغییر تیک «فقط موجودها»
  var autoInputs = document.querySelectorAll('[data-autosubmit]');
  autoInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      if (input.form) input.form.submit();
    });
  });

  // ------------------------------------------------- گالری صفحه‌ی محصول
  var thumbs = document.querySelectorAll('.gallery-thumbs button');
  var mainImg = document.getElementById('gallery-img');

  if (thumbs.length && mainImg) {
    thumbs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var full = btn.getAttribute('data-full');
        var srcset = btn.getAttribute('data-srcset');
        if (!full) return;

        mainImg.src = full;
        if (srcset) mainImg.srcset = srcset;

        var inner = btn.querySelector('img');
        if (inner && inner.alt) mainImg.alt = inner.alt;

        thumbs.forEach(function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
      });
    });
  }
})();
