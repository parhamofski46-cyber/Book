#!/usr/bin/env python3
"""
استخراج مدل‌های فرفورژه از کاتالوگ PDF با PyMuPDF.

هر مدل در کاتالوگ یک تصویر است با یک «برچسب» زیرش که کد، اندازه و وزن را
نشان می‌دهد. اینجا موقعیت دقیق تصویرها و کلمه‌ها خوانده می‌شود و هر تصویر
به کدی که درست زیرش نشسته نسبت داده می‌شود.

⚠️ نسبت‌دادن بر اساس «ترتیب» جواب نمی‌دهد: ترتیب تصویرها در فایل با ترتیب
دیداری صفحه یکی نیست و کد به عکس اشتباه می‌چسبد. برای همین تطبیق هندسی است.
"""
import json
import re
import sys
import pymupdf

PDF = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else 'models.json'

doc = pymupdf.open(PDF)
records = []
unmatched_imgs = 0
unmatched_codes = 0

for pno in range(len(doc)):
    page = doc[pno]
    ph = page.rect.height

    # ---- تصویرها با موقعیت واقعی‌شان روی صفحه
    imgs = []
    for info in page.get_images(full=True):
        xref = info[0]
        try:
            rects = page.get_image_rects(xref)
        except Exception:
            continue
        for r in rects:
            if r.width < 12 or r.height < 12:      # لوگو و آیکون‌های ریز
                continue
            imgs.append({'xref': xref, 'r': r})

    # ---- کدها (عدد ۴ رقمی) با جعبه‌شان
    words = page.get_text('words')     # x0,y0,x1,y1,word,block,line,word_no
    codes = [
        {'code': w[4], 'x0': w[0], 'y0': w[1], 'x1': w[2], 'y1': w[3]}
        for w in words if re.fullmatch(r'[0-9]{4}', w[4])
    ]
    if not imgs or not codes:
        continue

    # ---- اندازه و وزن، هر کدام با موقعیت خودشان تا به کد درست بچسبند
    txt = page.get_text()
    spec_by_pos = []
    for m in re.finditer(r'size:\s*([0-9]+x[0-9]+)\s*cm\s*weight:\s*([0-9.]+)\s*kg', txt):
        spec_by_pos.append((m.group(1), m.group(2)))

    # هر کد را به نزدیک‌ترین «size:» سمت راستش وصل می‌کنیم
    size_words = [w for w in words if w[4].startswith('size')]
    specs = {}
    for m in re.finditer(r'([0-9]+x[0-9]+)\s*cm', txt):
        pass  # فقط برای اطمینان از وجود الگو

    used_codes = set()
    for im in imgs:
        r = im['r']
        best, bestd = None, None
        for c in codes:
            if c['code'] in used_codes:
                continue
            # کد باید زیر تصویر باشد (y بزرگ‌تر یعنی پایین‌تر در PyMuPDF)
            if c['y0'] < r.y1 - 15:
                continue
            # و افقی با تصویر هم‌پوشانی داشته باشد
            if c['x1'] < r.x0 - 25 or c['x0'] > r.x1 + 25:
                continue
            dy = c['y0'] - r.y1
            dx = ((c['x0'] + c['x1']) / 2) - ((r.x0 + r.x1) / 2)
            d = dy * dy + dx * dx * 0.4
            if bestd is None or d < bestd:
                best, bestd = c, d
        if best is None:
            unmatched_imgs += 1
            continue
        used_codes.add(best['code'])
        records.append({
            'page': pno + 1,
            'code': best['code'],
            'xref': im['xref'],
            'rect': [r.x0, r.y0, r.x1, r.y1],
            'code_y': best['y0'],
            'code_x': best['x0'],
        })
    unmatched_codes += len([c for c in codes if c['code'] not in used_codes])

# ---- اندازه و وزن: مثل کدها، بر اساس موقعیت.
# ⚠️ روی متن جاری regex نزدیم: ترتیب متن به‌هم‌ریخته است و مثلاً در صفحه‌ی ۵
# وزنِ مدل ۵۸۱۷ قبل از خود کدش می‌آید. تطبیق مکانی این مشکل را ندارد.
by_page = {}
for r in records:
    by_page.setdefault(r['page'], []).append(r)

for pno, recs in by_page.items():
    words = doc[pno - 1].get_text('words')
    sizes = [w for w in words if re.fullmatch(r'[0-9]+x[0-9]+', w[4])]
    nums = []
    for i, w in enumerate(words):
        if re.fullmatch(r'[0-9]+(\.[0-9]+)?', w[4]) and i + 1 < len(words) and words[i + 1][4] == 'kg':
            nums.append(w)

    for rec in recs:
        cx, cy = rec['code_x'], rec['code_y']
        # اندازه: هم‌ارتفاع با کد، سمت راستش، در فاصله‌ی برچسب
        cand = [w for w in sizes if abs(w[1] - cy) < 7 and 0 < w[0] - cx < 170]
        if cand:
            rec['size'] = min(cand, key=lambda w: w[0] - cx)[4]
        # وزن: یک خط پایین‌تر از کد
        cand = [w for w in nums if 3 < w[1] - cy < 22 and -10 < w[0] - cx < 190]
        if cand:
            rec['weight'] = min(cand, key=lambda w: (w[1] - cy, w[0] - cx))[4]

json.dump({'records': records}, open(OUT, 'w'), ensure_ascii=False, indent=1)
codes = {r['code'] for r in records}
print(f'  تصویر نسبت‌داده‌شده : {len(records)}')
print(f'  کد یکتا            : {len(codes)}')
print(f'  تصویر بی‌کد         : {unmatched_imgs}')
print(f'  دارای اندازه        : {len([r for r in records if r.get("size")])}')
