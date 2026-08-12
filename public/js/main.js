/*!
 * فولاد ایمان — اسکریپت سبک سایت (بدون هیچ کتابخانه‌ی خارجی)
 * کارها: منوی موبایل، انیمیشن ورود با اسکرول، گالری عکس محصول، لیست استعلام.
 *
 * نکته‌ی مهم درباره‌ی ساختار:
 * این فایل طوری نوشته شده که «چندبار اجرا شدن» امن باشد. در سایت واقعی یک‌بار
 * در هر صفحه اجرا می‌شود، ولی در نسخه‌ی پیش‌نمایش (که همه‌ی صفحات در یک فایل
 * جمع شده‌اند) با هر جابه‌جایی دوباره صدا زده می‌شود. برای همین:
 *   • شنونده‌های سطح document/window فقط یک‌بار وصل می‌شوند (bindOnce)
 *   • آن شنونده‌ها عناصر را «هنگام اجرا» پیدا می‌کنند، نه هنگام وصل‌شدن
 *   • شنونده‌های روی خود عناصر مشکلی ندارند، چون عناصر هر بار تازه‌اند
 */
(function () {
  'use strict';

  /** وصل‌کردن شنونده‌ی سراسری فقط یک‌بار در طول عمر صفحه */
  function bindOnce(target, type, key, handler) {
    var flag = 'fiBound_' + key;
    if (document.documentElement.dataset[flag]) return;
    document.documentElement.dataset[flag] = '1';
    target.addEventListener(type, handler);
  }

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ===================================================== منوی موبایل
  function setMenu(open) {
    var nav = $('main-nav');
    var toggle = document.querySelector('.nav-toggle');
    var backdrop = document.querySelector('.nav-backdrop');
    if (!nav || !toggle) return;

    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.classList.toggle('show', open);
    }
    // وقتی منو باز است، صفحه‌ی پشت آن اسکرول نشود
    document.body.style.overflow = open ? 'hidden' : '';
  }

  (function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = $('main-nav');
    var backdrop = document.querySelector('.nav-backdrop');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      setMenu(!nav.classList.contains('open'));
    });

    // با کلیک روی هر لینک یا روی پرده‌ی تیره، منو بسته شود
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        setMenu(false);
      });
    }

    // با کلید Escape هم بسته شود
    bindOnce(document, 'keydown', 'esc', function (e) {
      var n = $('main-nav');
      if (e.key === 'Escape' && n && n.classList.contains('open')) {
        setMenu(false);
        var t = document.querySelector('.nav-toggle');
        if (t) t.focus();
      }
    });

    // اگر کاربر گوشی را افقی کرد و صفحه بزرگ شد، منو بسته شود
    bindOnce(window, 'resize', 'navresize', function () {
      var n = $('main-nav');
      if (window.innerWidth > 900 && n && n.classList.contains('open')) setMenu(false);
    });
  })();

  // =========================================== انیمیشن ظریف هنگام اسکرول
  (function initReveal() {
    var revealables = document.querySelectorAll('.reveal:not(.in)');
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!revealables.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      // مرورگر قدیمی یا حالت کاهش انیمیشن: محتوا بدون انیمیشن دیده شود
      revealables.forEach(function (el) {
        el.classList.add('in');
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          // شماره‌گذاری فرزندان تا ورودشان پله‌ای باشد (حداکثر ۸ پله،
          // وگرنه آخرین کارت‌های یک گرید بلند خیلی دیر ظاهر می‌شوند)
          var kids = entry.target.children;
          for (var i = 0; i < kids.length; i++) {
            kids[i].style.setProperty('--stagger', Math.min(i, 8));
          }
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
    revealables.forEach(function (el) {
      observer.observe(el);
    });
  })();

  // ------------------- ارسال خودکار فرم فیلتر با تغییر تیک «فقط موجودها»
  document.querySelectorAll('[data-autosubmit]').forEach(function (input) {
    input.addEventListener('change', function () {
      if (input.form) input.form.submit();
    });
  });

  // ===================================================== لیست استعلام
  // مشتری چند کالا را انتخاب می‌کند و همه را در یک پیام واتساپ می‌فرستد.
  // هیچ داده‌ای به سرور نمی‌رود؛ لیست فقط در مرورگر خود کاربر ذخیره می‌شود.
  var KEY = 'fi_quote_list';

  var faDigits = function (n) {
    return String(n).replace(/[0-9]/g, function (d) {
      return '۰۱۲۳۴۵۶۷۸۹'[Number(d)];
    });
  };

  function readList() {
    try {
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeList(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {
      /* حالت مرور ناشناس — بی‌خیال ذخیره می‌شویم */
    }
  }

  /** ساخت متن پیام واتساپ از روی لیست */
  function buildMessage(list) {
    var lines = list.map(function (it, i) {
      return faDigits(i + 1) + '- ' + it.name;
    });
    return 'سلام، قیمت و موجودی این اقلام را می‌خواستم:\n' + lines.join('\n');
  }

  /** به‌روزرسانی پنل و شمارنده — عناصر هر بار تازه پیدا می‌شوند */
  function renderQuote() {
    var panel = $('quote-panel');
    var toggle = $('quote-toggle');
    var itemsEl = $('quote-items');
    var countEl = $('quote-count');
    var sendEl = $('quote-send');
    if (!panel || !toggle || !itemsEl || !countEl) return;

    var list = readList();
    countEl.textContent = faDigits(list.length);
    toggle.hidden = list.length === 0;
    if (list.length === 0) panel.hidden = true;

    itemsEl.innerHTML = '';
    if (!list.length) {
      var note = document.createElement('li');
      note.className = 'empty-note';
      note.textContent = 'لیست خالی است.';
      itemsEl.appendChild(note);
    } else {
      list.forEach(function (it) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.className = 'name';
        name.textContent = it.name;

        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'rm';
        rm.textContent = '✕';
        rm.setAttribute('aria-label', 'حذف ' + it.name);
        rm.addEventListener('click', function () {
          writeList(
            readList().filter(function (x) {
              return x.slug !== it.slug;
            })
          );
          renderQuote();
          syncQuoteButtons();
        });

        li.appendChild(name);
        li.appendChild(rm);
        itemsEl.appendChild(li);
      });
    }

    // به‌روزرسانی لینک واتساپ با متن کامل لیست
    if (sendEl) {
      var base = sendEl.getAttribute('data-base') || '';
      sendEl.href = base ? base + '?text=' + encodeURIComponent(buildMessage(list)) : '#';
    }
  }

  /** هماهنگ‌کردن ظاهر دکمه‌های «+ لیست» با وضعیت فعلی */
  function syncQuoteButtons() {
    var slugs = readList().map(function (x) {
      return x.slug;
    });
    document.querySelectorAll('.add-quote').forEach(function (btn) {
      var inList = slugs.indexOf(btn.getAttribute('data-slug')) > -1;
      btn.classList.toggle('added', inList);
      var big = btn.classList.contains('add-quote-lg');
      var label = big
        ? inList
          ? 'در لیست استعلام است ✓'
          : 'افزودن به لیست استعلام'
        : inList
          ? 'در لیست ✓'
          : 'لیست';

      btn.textContent = '';
      if (!inList) {
        var plus = document.createElement('span');
        plus.className = 'plus';
        plus.textContent = '+';
        btn.appendChild(plus);
        btn.appendChild(document.createTextNode(' '));
      }
      btn.appendChild(document.createTextNode(label));
    });
  }

  /** پیام کوتاه تأیید */
  function toast(text) {
    var el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.classList.remove('show');
    }, 1800);
  }

  // کلیک روی «+ لیست» — یک شنونده‌ی سراسری، حتی برای کارت‌هایی که بعداً ساخته شوند
  bindOnce(document, 'click', 'addquote', function (e) {
    var btn = e.target.closest('.add-quote');
    if (!btn) return;
    e.preventDefault();

    var slug = btn.getAttribute('data-slug');
    var name = btn.getAttribute('data-name');
    var list = readList();
    var exists = list.some(function (x) {
      return x.slug === slug;
    });

    if (exists) {
      writeList(
        list.filter(function (x) {
          return x.slug !== slug;
        })
      );
      toast('از لیست حذف شد');
    } else {
      list.push({ slug: slug, name: name });
      writeList(list);
      toast('به لیست استعلام اضافه شد');
    }
    renderQuote();
    syncQuoteButtons();
  });

  (function initQuotePanel() {
    var panel = $('quote-panel');
    var toggle = $('quote-toggle');
    if (!panel || !toggle) return;

    // پنل باید دقیقاً بالای ستون دکمه‌های شناور بنشیند، نه رویشان.
    var placePanel = function () {
      var cta = document.querySelector('.float-cta');
      if (!cta || window.innerWidth <= 700) {
        panel.style.bottom = ''; // در موبایل مقدار CSS معتبر است
        return;
      }
      panel.style.bottom = cta.offsetHeight + 24 + 'px';
    };

    toggle.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) placePanel();
    });

    var closeBtn = panel.querySelector('.quote-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        panel.hidden = true;
      });
    }

    var clearEl = $('quote-clear');
    if (clearEl) {
      clearEl.addEventListener('click', function () {
        writeList([]);
        renderQuote();
        syncQuoteButtons();
      });
    }

    bindOnce(window, 'resize', 'quoteresize', function () {
      var pn = $('quote-panel');
      if (pn && !pn.hidden) placePanel();
    });

    renderQuote();
    syncQuoteButtons();
  })();

  // ================================================ گالری صفحه‌ی محصول
  (function initGallery() {
    var thumbs = document.querySelectorAll('.gallery-thumbs button');
    var mainImg = $('gallery-img');
    if (!thumbs.length || !mainImg) return;

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
  })();
})();
