"""Макеты сцен с реальным масштабом упаковок.
Размеры (см) — по габаритам в карточках WB и типовым размерам тары:
флакон 150 мл 4×16, туба 15 г ≈3×9.5, банка 50 мл Ø6.5, флакон 460 мл 23 выс.,
туба 250 мл 19 выс., флакон-пипетка 15 мл 9 выс."""
from PIL import Image, ImageDraw, ImageFilter
import random, os
CUT = os.path.join(os.path.dirname(__file__), '..', 'cut')
def load(n):
    im = Image.open(os.path.join(CUT, n + '.png')).convert('RGBA')
    return im.crop(im.split()[-1].getbbox())
# (имя, какой размер задаём, см)
REAL = {'cb1': ('h', 16.0), 'cb2': ('h', 16.0), 'cb3': ('h', 16.0), 'carboxy': ('h', 16.0), 'tube': ('h', 9.5), 'jar': ('w', 6.5), 'kids': ('w', 6.5),
        'geloil': ('h', 23.0), 'tobacco': ('h', 23.0), 'recovery': ('h', 19.0), 'serum': ('h', 9.0)}
def scaled(n, s):
    im = load(n); axis, cm = REAL[n]
    k = (cm * s) / (im.height if axis == 'h' else im.width)
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
def backdrop(W, H, base):
    bg = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(236 - 10 * t), int(206 - 8 * t), int(214 - 6 * t)))
    random.seed(1)
    d.rectangle([0, base - 30, W, H], fill=(158, 142, 145))
    for _ in range(W * (H - base) // 60):
        x = random.randrange(W); y = random.randrange(base - 30, H)
        c = random.choice([(120, 108, 110), (190, 172, 175), (205, 160, 168)])
        d.point((x, y), fill=c)
    return bg.convert('RGBA')
def shadow(canvas, x, y, w):
    sh = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([x - w * 0.05, y - w * 0.06, x + w * 1.05, y + w * 0.06], fill=(40, 20, 30, 120))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(w * 0.05)))
def row(canvas, names, s, x0, base, gap_cm=1.2):
    x = x0
    for n in names:
        im = scaled(n, s)
        shadow(canvas, x, base, im.width)
        canvas.alpha_composite(im, (round(x), round(base - im.height)))
        x += im.width + gap_cm * s
    return x
def row2(canvas, items, s, x0, base):
    x = x0
    for n, gap in items:
        im = scaled(n, s)
        shadow(canvas, x, base, im.width)
        canvas.alpha_composite(im, (round(x), round(base - im.height)))
        x += im.width + gap * s
    return x
def width2(items, s):
    return sum(scaled(n, s).width for n, _ in items) + sum(g for _, g in items[:-1]) * s
def width_of(names, s, gap_cm=1.2):
    return sum(scaled(n, s).width for n in names) + gap_cm * s * (len(names) - 1)
out = os.path.dirname(__file__)
HERO = [('jar', 0.8), ('tube', 1.4), ('cb1', 0.5), ('cb2', 0.5), ('cb3', 1.2), ('kids', 0)]
# 1) главная широкая 21:9: товары в правых ~45%
W, H, base = 2688, 1152, 1010
s = 42.0
c = backdrop(W, H, base); w = width2(HERO, s)
row2(c, HERO, s, W - 110 - w, base); c.convert('RGB').save(os.path.join(out, 'hero-wide-layout.jpg'), quality=92)
print('hero-wide', round(w), 'start', round(W - 110 - w), 'bottle h', round(16 * s))
# 2) главная телефонная 4:5
W, H, base = 1792, 2240, 1930
s = 49.0
c = backdrop(W, H, base); w = width2(HERO, s)
row2(c, HERO, s, (W - w) / 2, base); c.convert('RGB').save(os.path.join(out, 'hero-tall-layout.jpg'), quality=92)
print('hero-tall', round(w))
# 3) полка 21:9
W, H, base = 2688, 1152, 1000
SHELF = [('jar', 1.6), ('tube', 2.2), ('cb1', 0.6), ('cb2', 0.6), ('cb3', 2.4), ('geloil', 2.0), ('tobacco', 2.4), ('recovery', 2.2), ('serum', 0)]
s = 36.0
c = backdrop(W, H, base); w = width2(SHELF, s)
row2(c, SHELF, s, (W - w) / 2, base); c.convert('RGB').save(os.path.join(out, 'shelf-layout.jpg'), quality=92)
print('shelf', round(w))
