# -*- coding: utf-8 -*-
"""
استخراج شکل برداری ارقام فارسی از فونت خود سایت (Vazirmatn Black).

چرا: کپچا اگر رقم‌ها را با تگ <text> بنویسد، هر ربات ساده‌ای می‌تواند
عددها را مستقیم از سورس صفحه بخواند و کپچا بی‌فایده می‌شود. با تبدیل
هر رقم به مسیر برداری (<path>)، در سورس صفحه فقط یک مشت مختصات دیده
می‌شود، نه عدد.

خروجی: src/content/captcha-glyphs.json — یک‌بار ساخته و در گیت نگه
داشته می‌شود تا سرور به پایتون و fontTools نیاز نداشته باشد.

اجرا:  python3 scripts/gen-captcha-glyphs.py
"""
import json
import os

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, 'public', 'fonts', 'Vazirmatn-Black.woff2')
OUT = os.path.join(ROOT, 'src', 'content', 'captcha-glyphs.json')

# ارقام فارسی: U+06F0 تا U+06F9
DIGITS = [chr(0x06F0 + i) for i in range(10)]


def main():
    font = TTFont(FONT)
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    upem = font['head'].unitsPerEm

    out = {}
    for i, ch in enumerate(DIGITS):
        name = cmap.get(ord(ch))
        if name is None:
            raise SystemExit('رقم %s در فونت نیست' % ch)
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        d = pen.getCommands()
        if not d:
            raise SystemExit('مسیر خالی برای رقم %s' % ch)
        out[str(i)] = {'d': d, 'adv': glyphs[name].width}

    data = {'unitsPerEm': upem, 'glyphs': out}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('نوشته شد:', OUT)
    print('unitsPerEm =', upem, '| ارقام:', len(out))


if __name__ == '__main__':
    main()
