/*!
 * پنل مدیریت — اسکریپت کمکی
 * به‌جای نوشتن onclick داخل HTML (که سیاست امنیتی سایت اجازه نمی‌دهد)،
 * رفتارها اینجا به عناصر وصل می‌شوند.
 */
(function () {
  'use strict';

  // ------------------------------------------- تأییدیه پیش از کارهای حذفی
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var question = form.getAttribute('data-confirm');
    if (question && !window.confirm(question)) {
      e.preventDefault();
    }
  });

  // ---------------------------- فیلتر زیردسته‌ها بر اساس دسته‌ی انتخاب‌شده
  var category = document.getElementById('category_id');
  var subcategory = document.getElementById('subcategory_id');

  if (category && subcategory) {
    var allOptions = Array.prototype.slice.call(subcategory.options);

    var sync = function () {
      var selected = category.value;
      subcategory.innerHTML = '';
      allOptions.forEach(function (opt) {
        var belongs = !opt.value || opt.getAttribute('data-category') === selected;
        if (belongs) subcategory.appendChild(opt);
      });
      // اگر زیردسته‌ی انتخاب‌شده به این دسته تعلق ندارد، پاک شود
      if (subcategory.selectedIndex < 0) subcategory.selectedIndex = 0;
    };

    category.addEventListener('change', sync);
    sync();
  }

  // ------------------------- پیش‌نمایش سریع عکس‌هایی که تازه انتخاب شده‌اند
  var fileInput = document.getElementById('images');
  if (fileInput) {
    var preview = document.createElement('div');
    preview.className = 'img-grid';
    preview.style.marginTop = '0.8rem';
    fileInput.parentNode.appendChild(preview);

    fileInput.addEventListener('change', function () {
      preview.innerHTML = '';
      Array.prototype.slice.call(fileInput.files, 0, 8).forEach(function (file) {
        var url = URL.createObjectURL(file);
        var box = document.createElement('div');
        box.className = 'img-item';

        var img = document.createElement('img');
        img.src = url;
        img.alt = file.name;
        img.onload = function () {
          URL.revokeObjectURL(url);
        };

        var bar = document.createElement('div');
        bar.className = 'bar';
        var size = document.createElement('span');
        size.className = 'main-tag';
        size.textContent = 'آماده‌ی آپلود · ' + Math.round(file.size / 1024) + ' کیلوبایت';
        bar.appendChild(size);

        box.appendChild(img);
        box.appendChild(bar);
        preview.appendChild(box);
      });
    });
  }
})();
