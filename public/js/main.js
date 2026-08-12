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
            // شماره‌گذاری فرزندان تا ورودشان پله‌ای باشد (حداکثر ۸ پله،
            // وگرنه آخرین کارت‌های یک گرید بلند خیلی دیر ظاهر می‌شوند)
            var kids = entry.target.children;
            for (var i = 0; i < kids.length; i++) {
              kids[i].style.setProperty('--stagger', Math.min(i, 8));
            }
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

  // ==================================================== لیست استعلام
  // مشتری چند کالا را انتخاب می‌کند و همه را در یک پیام واتساپ می‌فرستد.
  // هیچ داده‌ای به سرور نمی‌رود؛ لیست فقط در مرورگر خود کاربر ذخیره می‌شود.
  (function quoteList() {
    var KEY = 'fi_quote_list';
    var panel = document.getElementById('quote-panel');
    var toggle = document.getElementById('quote-toggle');
    var itemsEl = document.getElementById('quote-items');
    var countEl = document.getElementById('quote-count');
    var sendEl = document.getElementById('quote-send');
    var clearEl = document.getElementById('quote-clear');
    if (!panel || !toggle || !itemsEl) return;

    var faDigits = function (n) {
      return String(n).replace(/[0-9]/g, function (d) {
        return '۰۱۲۳۴۵۶۷۸۹'[Number(d)];
      });
    };

    var read = function () {
      try {
        var raw = localStorage.getItem(KEY);
        var list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    };

    var write = function (list) {
      try {
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch (e) {
        /* حالت مرور ناشناس — بی‌خیال ذخیره می‌شویم */
      }
    };

    // ساخت متن پیام واتساپ از روی لیست
    var buildMessage = function (list) {
      var lines = list.map(function (it, i) {
        return faDigits(i + 1) + '- ' + it.name;
      });
      return 'سلام، قیمت و موجودی این اقلام را می‌خواستم:\n' + lines.join('\n');
    };

    var render = function () {
      var list = read();

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
            write(
              read().filter(function (x) {
                return x.slug !== it.slug;
              })
            );
            render();
            syncButtons();
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
    };

    // دکمه‌های «+ لیست» را با وضعیت فعلی لیست هماهنگ می‌کند
    var syncButtons = function () {
      var slugs = read().map(function (x) {
        return x.slug;
      });
      document.querySelectorAll('.add-quote').forEach(function (btn) {
        var inList = slugs.indexOf(btn.getAttribute('data-slug')) > -1;
        btn.classList.toggle('added', inList);
        var label = btn.classList.contains('add-quote-lg')
          ? inList
            ? 'در لیست استعلام است ✓'
            : 'افزودن به لیست استعلام'
          : inList
            ? 'در لیست ✓'
            : 'لیست';
        var plus = btn.querySelector('.plus');
        btn.textContent = '';
        if (!inList && plus) {
          var p = document.createElement('span');
          p.className = 'plus';
          p.textContent = '+';
          btn.appendChild(p);
          btn.appendChild(document.createTextNode(' '));
        }
        btn.appendChild(document.createTextNode(label));
      });
    };

    // پیام کوتاه تأیید
    var toastEl = null;
    var toast = function (text) {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'toast';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = text;
      toastEl.classList.add('show');
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(function () {
        toastEl.classList.remove('show');
      }, 1800);
    };

    // کلیک روی «+ لیست» (با event delegation تا کارت‌های جدید هم کار کنند)
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.add-quote');
      if (!btn) return;
      e.preventDefault();

      var slug = btn.getAttribute('data-slug');
      var name = btn.getAttribute('data-name');
      var list = read();
      var exists = list.some(function (x) {
        return x.slug === slug;
      });

      if (exists) {
        write(
          list.filter(function (x) {
            return x.slug !== slug;
          })
        );
        toast('از لیست حذف شد');
      } else {
        list.push({ slug: slug, name: name });
        write(list);
        toast('به لیست استعلام اضافه شد');
      }
      render();
      syncButtons();
    });

    // پنل باید دقیقاً بالای ستون دکمه‌های شناور بنشیند، نه رویشان.
    // ارتفاع ستون بسته به تعداد کانال‌های فعال فرق می‌کند، پس محاسبه‌اش می‌کنیم.
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
    window.addEventListener('resize', function () {
      if (!panel.hidden) placePanel();
    });
    var closeBtn = panel.querySelector('.quote-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { panel.hidden = true; });
    if (clearEl) {
      clearEl.addEventListener('click', function () {
        write([]);
        render();
        syncButtons();
      });
    }

    render();
    syncButtons();
  })();

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
