#!/usr/bin/env python3
"""
بیرون کشیدن تصویر هر مدل از کاتالوگ، با کانال شفافیت.

تصویرهای کاتالوگ smask (ماسک شفافیت) دارند؛ یعنی طرح‌ها بریده‌شده و بدون
پس‌زمینه‌اند. اگر بدون ماسک بیرون بکشیم، پشتشان سیاه می‌شود. اینجا تصویر و
ماسکش با هم ترکیب می‌شوند تا PNG شفاف بگیریم — روی کارت‌های کرم‌رنگ سایت
تمیز می‌نشیند.
"""
import json
import os
import sys
import pymupdf

PDF = sys.argv[1]
SRC = sys.argv[2]
OUTDIR = sys.argv[3]

os.makedirs(OUTDIR, exist_ok=True)
doc = pymupdf.open(PDF)
recs = json.load(open(SRC))['records']

# نقشه‌ی xref → smask برای هر صفحه
smask_of = {}
for pno in range(len(doc)):
    for info in doc[pno].get_images(full=True):
        smask_of[info[0]] = info[1]

kept, skipped_small, failed = [], 0, 0
seen = set()

for r in recs:
    code = r['code']
    if code in seen:            # اگر کدی دوبار بیاید، اولی می‌ماند
        continue
    xref = r['xref']
    try:
        pix = pymupdf.Pixmap(doc, xref)
        # ⚠️ فیلتر نباید «هر دو بُعد» را شرط کند: مدل‌های باریک و بلند
        # (مثلاً کد ۵۸۱۹ با ۵۹×۴۳۸ پیکسل، یعنی پنل ۱۴×۱۶۰ سانتی) قربانی
        # همین شرط شدند و ۱۲۴ مدل واقعی حذف شد. ملاک درست، مساحت و بُعد
        # بزرگ‌تر است.
        if max(pix.width, pix.height) < 80 or pix.width * pix.height < 3000:
            skipped_small += 1
            continue
        sm = smask_of.get(xref)
        if sm:
            mask = pymupdf.Pixmap(doc, sm)
            pix = pymupdf.Pixmap(pix, mask)      # ترکیب رنگ + شفافیت
        if pix.colorspace and pix.colorspace.n > 3:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        path = os.path.join(OUTDIR, f'{code}.png')
        pix.save(path)
        seen.add(code)
        kept.append({
            'code': code,
            'w': pix.width, 'h': pix.height,
            'size': r.get('size'), 'weight': r.get('weight'),
            'page': r['page'],
        })
    except Exception as e:
        failed += 1

json.dump(kept, open(os.path.join(OUTDIR, '_index.json'), 'w'), ensure_ascii=False, indent=1)
print(f'  ذخیره‌شده  : {len(kept)}')
print(f'  خیلی کوچک : {skipped_small}')
print(f'  ناموفق    : {failed}')
if kept:
    ws = sorted(k['w'] for k in kept)
    print(f'  عرض: کمینه {ws[0]} · میانه {ws[len(ws)//2]} · بیشینه {ws[-1]}')
    print(f'  دارای اندازه: {len([k for k in kept if k["size"]])} · دارای وزن: {len([k for k in kept if k["weight"]])}')
