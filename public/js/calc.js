/*!
 * فولاد ایمان — محاسبه‌گر وزن آهن
 *
 * عمداً کاملاً سمت مرورگر است: هیچ درخواستی به سرور نمی‌رود، پس نتیجه آنی
 * است و روی اینترنت ضعیف هم کار می‌کند.
 *
 * مثل main.js با ES5 نوشته شده (بدون arrow function و optional chaining) تا
 * روی سافاری قدیمی و مرورگرهای اندرویدی قدیمی هم اجرا شود، و هیچ رویدادی
 * به‌صورت onclick درون HTML نیست چون CSP سایت script-src-attr 'none' دارد.
 */
(function () {
  'use strict';

  /* چگالی فولاد: ۷۸۵۰ کیلوگرم بر متر مکعب.
     سطح مقطع را به میلی‌متر مربع حساب می‌کنیم، پس:
     kg/m = سطح(mm²) × 1e-6 (m²) × 7850 = سطح × 0.00785 */
  var DENSITY = 0.00785;

  /**
   * هر مقطع، سطح مقطعش را بر حسب میلی‌متر مربع برمی‌گرداند.
   * «sheet» استثناست: ورق بر اساس طول×عرض×ضخامت حساب می‌شود، نه طول شاخه.
   */
  var PROFILES = {
    ghouti_square: {
      label: 'قوطی مربع',
      hint: 'مثل قوطی ۴۰×۴۰',
      fields: [
        { key: 'a', label: 'ضلع', unit: 'میلی‌متر', def: 40 },
        { key: 't', label: 'ضخامت', unit: 'میلی‌متر', def: 2 }
      ],
      area: function (v) { return 4 * v.t * (v.a - v.t); }
    },
    ghouti_rect: {
      label: 'قوطی مستطیل',
      hint: 'مثل قوطی ۶۰×۴۰',
      fields: [
        { key: 'a', label: 'ضلع بزرگ', unit: 'میلی‌متر', def: 60 },
        { key: 'b', label: 'ضلع کوچک', unit: 'میلی‌متر', def: 40 },
        { key: 't', label: 'ضخامت', unit: 'میلی‌متر', def: 2 }
      ],
      area: function (v) { return 2 * v.t * (v.a + v.b - 2 * v.t); }
    },
    nabshi: {
      label: 'نبشی (بال مساوی)',
      hint: 'مثل نبشی ۴',
      fields: [
        { key: 'a', label: 'بال', unit: 'میلی‌متر', def: 40 },
        { key: 't', label: 'ضخامت', unit: 'میلی‌متر', def: 4 }
      ],
      area: function (v) { return v.t * (2 * v.a - v.t); }
    },
    milgerd: {
      label: 'میلگرد / گرد',
      hint: 'مقطع دایره‌ی توپر',
      fields: [{ key: 'd', label: 'قطر', unit: 'میلی‌متر', def: 12 }],
      area: function (v) { return Math.PI * v.d * v.d / 4; }
    },
    tasmeh: {
      label: 'تسمه',
      hint: 'مقطع مستطیل توپر',
      fields: [
        { key: 'w', label: 'عرض', unit: 'میلی‌متر', def: 30 },
        { key: 't', label: 'ضخامت', unit: 'میلی‌متر', def: 4 }
      ],
      area: function (v) { return v.w * v.t; }
    },
    loole: {
      label: 'لوله (گرد)',
      hint: 'قطر بیرونی را وارد کنید',
      fields: [
        { key: 'd', label: 'قطر بیرونی', unit: 'میلی‌متر', def: 42 },
        { key: 't', label: 'ضخامت', unit: 'میلی‌متر', def: 2 }
      ],
      area: function (v) { return Math.PI * v.t * (v.d - v.t); }
    },
    varagh: {
      label: 'ورق',
      hint: 'ورق گالوانیزه‌ی ما ضخامت ۰.۵ است',
      sheet: true,
      fields: [
        { key: 'l', label: 'طول', unit: 'متر', def: 2, step: '0.01' },
        { key: 'w', label: 'عرض', unit: 'متر', def: 1, step: '0.01' },
        { key: 't', label: 'ضخامت', unit: 'میلی‌متر', def: 0.5, step: '0.1' }
      ]
    }
  };

  /* ---------------------------------------------------------- کمکی‌ها */

  var FA = '۰۱۲۳۴۵۶۷۸۹';
  var AR = '٠١٢٣٤٥٦٧٨٩';

  /** ارقام فارسی/عربی را به لاتین تبدیل می‌کند تا parseFloat بفهمد */
  function toLatin(s) {
    var out = String(s);
    var i;
    for (i = 0; i < 10; i++) {
      out = out.split(FA.charAt(i)).join(String(i));
      out = out.split(AR.charAt(i)).join(String(i));
    }
    return out.replace(/٫/g, '.').replace(/,/g, '');
  }

  /** عدد را با ارقام فارسی و جداکننده‌ی هزارگان نشان می‌دهد */
  function faNum(n, digits) {
    if (!isFinite(n)) return '—';
    var fixed = Number(n).toFixed(typeof digits === 'number' ? digits : 2);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
    var out = parts.join('.');
    return out.replace(/\d/g, function (d) { return FA.charAt(+d); });
  }

  /** مثل faNum ولی صفرهای بی‌فایده‌ی اعشار را برمی‌دارد: «۶۰.۰۰» → «۶۰» */
  function faTrim(n) {
    var out = faNum(n, 2);
    if (out.indexOf('.') === -1) return out;
    out = out.replace(/۰+$/, '');
    return out.replace(/\.$/, '');
  }

  function num(el) {
    if (!el) return NaN;
    return parseFloat(toLatin(el.value));
  }

  /* ---------------------------------------------------------- ساخت فرم */

  var root = document.getElementById('calc');
  if (!root) return;

  var typeSel = document.getElementById('calc-type');
  var dimsBox = document.getElementById('calc-dims');
  var lenBox = document.getElementById('calc-length-box');
  var lenInput = document.getElementById('calc-length');
  var qtyInput = document.getElementById('calc-qty');
  var hintEl = document.getElementById('calc-hint');
  var errEl = document.getElementById('calc-error');

  var outPer = document.getElementById('out-per');
  var outTotal = document.getElementById('out-total');
  var outMeter = document.getElementById('out-meter');
  var outMeterRow = document.getElementById('out-meter-row');
  var waBtn = document.getElementById('calc-wa');

  /** ورودی‌های مربوط به مقطع انتخاب‌شده را از نو می‌سازد */
  function buildFields() {
    var p = PROFILES[typeSel.value];
    dimsBox.innerHTML = '';
    hintEl.textContent = p.hint || '';

    for (var i = 0; i < p.fields.length; i++) {
      var f = p.fields[i];
      var wrap = document.createElement('div');
      wrap.className = 'calc-field';

      var lab = document.createElement('label');
      lab.setAttribute('for', 'dim-' + f.key);
      lab.textContent = f.label + ' (' + f.unit + ')';

      // ⚠️ عمداً type="text" است، نه "number".
      // ورودی عددی مرورگر ارقام فارسی («۶۰») را اصلاً قبول نمی‌کند و کادر
      // خالی می‌ماند — برای سایتی که مخاطبش با کیبورد فارسی تایپ می‌کند
      // یعنی محاسبه‌گر برای خیلی‌ها کار نمی‌کند. با text + inputmode
      // «decimal» هم صفحه‌کلید عددی موبایل باز می‌شود، هم toLatin() ارقام
      // فارسی و عربی را تبدیل می‌کند.
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.id = 'dim-' + f.key;
      inp.className = 'calc-input';
      inp.setAttribute('data-key', f.key);
      inp.value = f.def;
      inp.setAttribute('inputmode', 'decimal');
      inp.setAttribute('autocomplete', 'off');

      wrap.appendChild(lab);
      wrap.appendChild(inp);
      dimsBox.appendChild(wrap);
    }

    // ورق طول شاخه ندارد؛ طول و عرضش را خودش می‌گیرد
    lenBox.hidden = !!p.sheet;
    outMeterRow.hidden = !!p.sheet;
    calc();
  }

  /* ------------------------------------------------------------ محاسبه */

  var last = null;

  function calc() {
    var p = PROFILES[typeSel.value];
    var vals = {};
    var inputs = dimsBox.querySelectorAll('input');
    var bad = false;
    var i;

    for (i = 0; i < inputs.length; i++) {
      var v = parseFloat(toLatin(inputs[i].value));
      if (!isFinite(v) || v <= 0) bad = true;
      vals[inputs[i].getAttribute('data-key')] = v;
    }

    var qty = num(qtyInput);
    if (!isFinite(qty) || qty <= 0) qty = 1;

    var perPiece, perMeter = NaN;

    if (p.sheet) {
      // ورق: طول(m) × عرض(m) × ضخامت(mm) × ۷.۸۵ = کیلوگرم
      perPiece = vals.l * vals.w * vals.t * 7.85;
    } else {
      var len = num(lenInput);
      if (!isFinite(len) || len <= 0) bad = true;
      // ضخامت نباید از نصف ضلع بیشتر باشد، وگرنه مقطع بی‌معنی می‌شود
      if (vals.t && vals.a && vals.t * 2 >= vals.a) bad = true;
      if (vals.t && vals.b && vals.t * 2 >= vals.b) bad = true;
      if (vals.t && vals.d && vals.t * 2 >= vals.d) bad = true;
      perMeter = p.area(vals) * DENSITY;
      perPiece = perMeter * len;
    }

    if (bad || !isFinite(perPiece) || perPiece <= 0) {
      errEl.hidden = false;
      outPer.textContent = '—';
      outTotal.textContent = '—';
      outMeter.textContent = '—';
      if (waBtn) waBtn.hidden = true;
      last = null;
      return;
    }

    errEl.hidden = true;
    var total = perPiece * qty;

    outPer.textContent = faNum(perPiece) + ' کیلوگرم';
    outTotal.textContent = faNum(total) + ' کیلوگرم';
    outMeter.textContent = isFinite(perMeter) ? faNum(perMeter) + ' کیلوگرم' : '—';

    // متن آماده برای واتساپ
    var desc = p.label + ' — ';
    var parts = [];
    for (i = 0; i < p.fields.length; i++) {
      var f = p.fields[i];
      parts.push(f.label + ' ' + faTrim(vals[f.key]) + ' ' + f.unit);
    }
    desc += parts.join('، ');
    if (!p.sheet) desc += '، طول ' + faTrim(num(lenInput)) + ' متر';
    desc += '، تعداد ' + faNum(qty, 0);
    last = desc + '\nوزن تقریبی: ' + faNum(total) + ' کیلوگرم';

    if (waBtn) {
      waBtn.hidden = false;
      var base = waBtn.getAttribute('data-base') || '';
      waBtn.href = base + encodeURIComponent('سلام، استعلام قیمت:\n' + last);
    }
  }

  /* ---------------------------------------------------------- شنونده‌ها */

  typeSel.addEventListener('change', buildFields);
  dimsBox.addEventListener('input', calc);
  if (lenInput) lenInput.addEventListener('input', calc);
  if (qtyInput) qtyInput.addEventListener('input', calc);

  // دکمه‌های میان‌بر طول شاخه (۶ متری و ۱۲ متری)
  var quick = document.querySelectorAll('[data-len]');
  for (var k = 0; k < quick.length; k++) {
    quick[k].addEventListener('click', function (e) {
      e.preventDefault();
      lenInput.value = this.getAttribute('data-len');
      calc();
    });
  }

  buildFields();
})();
