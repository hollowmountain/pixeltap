#!/usr/bin/env python3
"""Готовит картинки сайта: сцены из art/ и превью товаров из каталога.

    python3 tools/images.py            всё, что ещё не готово
    python3 tools/images.py --force    пересобрать заново

ОТКУДА И КУДА
  art/*.png            исходники сцен (генерация Higgsfield, 5–8 МБ каждый).
                       В репозиторий не попадают — см. .gitignore.
  site/img/*.avif|webp готовые варианты нескольких ширин. Их сайт и отдаёт.
  site/img/p/          превью товаров. Берутся с CDN Wildberries один раз
                       при сборке и дальше живут у нас: сайт не зависит от
                       чужого CDN и не отдаёт ему IP посетителей.
  site/img/manifest.json  какие ширины есть у каждой картинки и её пропорции;
                       по нему build.py пишет <picture> со srcset.

Нужен только Pillow (с AVIF — Pillow 11.2+). Сети нужен только CDN WB.
"""
import hashlib
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps, features

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "art"
OUT = ROOT / "site" / "img"
THUMBS = OUT / "p"
CATALOG = ROOT / "data" / "catalog.json"
MANIFEST = OUT / "manifest.json"
FORCE = "--force" in sys.argv

HAS_AVIF = features.check("avif")

# Сцены: имя исходника -> ширины вариантов. Ширины подобраны под места
# на странице с запасом на плотные экраны, но без 4K: на первом экране
# телефона снимок шире 1280 пикселей не нужен никому.
SCENES = {
    "hero-wide":      [1280, 1920, 2560],
    "hero-tall":      [640, 960, 1280],
    "tile-lanolin":   [480, 800, 1200],
    "tile-mama":      [480, 800, 1200],
    "tile-carboxy":   [480, 800, 1200],
    "tile-face":      [480, 800, 1200],
    "tile-brows":     [480, 800, 1200],
    "tile-hair":      [480, 800, 1200],
    "tile-body":      [480, 800, 1200],
    "tile-nails":     [480, 800, 1200],
    "lanolin-origin": [800, 1200, 1800],
    "lanolin-hero":   [640, 960, 1400],
    "maternity":      [800, 1200, 1800],
    "shelf":          [1200, 1800, 2600],
}

# Качество подобрано на глаз по самым сложным местам (туман, лепестки):
# ниже начинают ползти полосы в градиентах.
AVIF_Q = 52
WEBP_Q = 80

UA = "Mozilla/5.0 (compatible; pixeltapi-build/1.0)"


def save_variants(im, stem, widths, dest):
    """Пишет stem-<w>.avif/.webp; возвращает список реально записанных ширин."""
    dest.mkdir(parents=True, exist_ok=True)
    im = ImageOps.exif_transpose(im).convert("RGB")
    done = []
    for w in widths:
        if w > im.width:
            continue
        h = round(im.height * w / im.width)
        v = im.resize((w, h), Image.LANCZOS) if w != im.width else im
        webp = dest / f"{stem}-{w}.webp"
        avif = dest / f"{stem}-{w}.avif"
        if FORCE or not webp.exists():
            v.save(webp, "WEBP", quality=WEBP_Q, method=6)
        if HAS_AVIF and (FORCE or not avif.exists()):
            v.save(avif, "AVIF", quality=AVIF_Q, speed=4)
        done.append(w)
    if not done:  # исходник уже меньше самой узкой ширины
        w = im.width
        im.save(dest / f"{stem}-{w}.webp", "WEBP", quality=WEBP_Q, method=6)
        if HAS_AVIF:
            im.save(dest / f"{stem}-{w}.avif", "AVIF", quality=AVIF_Q, speed=4)
        done.append(w)
    return done


def scenes(manifest):
    for stem, widths in SCENES.items():
        src = ART / f"{stem}.png"
        if not src.exists():
            known = manifest.get(stem)
            if known:
                continue  # исходника нет, но варианты уже лежат в site/img
            print(f"  нет исходника {src.name} — пропускаю")
            continue
        with Image.open(src) as im:
            ws = save_variants(im, stem, widths, OUT)
            manifest[stem] = {"w": ws, "ratio": [im.width, im.height], "dir": "img"}
        print(f"  {stem}: {ws}")


def og_image():
    """Картинка для превью ссылки в соцсетях: 1200×630, JPEG.

    Берём широкую сцену и обрезаем по правой части, где стоят товары.
    Надпись не рисуем: VK и Telegram кладут заголовок страницы рядом сами,
    а текст внутри картинки на телефоне превращается в мелкую кашу."""
    src = ART / "hero-wide.png"
    dst = OUT / "og.jpg"
    if not src.exists() or (dst.exists() and not FORCE):
        return
    with Image.open(src) as im:
        im = im.convert("RGB")
        target = 1200 / 630
        w, h = im.size
        cw = min(w, round(h * target))
        ch = round(cw / target)
        # сдвиг вправо: левая треть сцены — пустой туман под заголовок
        left = max(0, min(w - cw, round(w * 0.20)))
        top = max(0, (h - ch) // 2)
        im.crop((left, top, left + cw, top + ch)).resize((1200, 630), Image.LANCZOS).save(
            dst, "JPEG", quality=84, optimize=True, progressive=True)
    print("  og.jpg")


import re
from urllib.parse import urlparse

ALLOWED_IMG_HOST = re.compile(r"basket-\d{2}\.wbbasket\.ru|ir\.ozone\.ru|cdn1\.ozone\.ru")
MAX_BYTES = 10 * 1024 * 1024


def fetch(url):
    """Только https и только CDN площадок: адрес приходит из данных, а данные
    могут быть испорчены. Проверяем и итоговый адрес после редиректов."""
    pr = urlparse(url)
    if pr.scheme != "https" or not ALLOWED_IMG_HOST.fullmatch(pr.netloc):
        raise ValueError(f"адрес вне белого списка: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        final = urlparse(r.geturl())
        if final.scheme != "https" or not ALLOWED_IMG_HOST.fullmatch(final.netloc):
            raise ValueError(f"редирект вне белого списка: {r.geturl()}")
        if not (r.headers.get("Content-Type") or "").startswith("image/"):
            raise ValueError(f"не картинка: {r.headers.get('Content-Type')}")
        data = r.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("файл больше 10 МБ")
        return data


def edge_color(im):
    """Цвет фона по краям кадра — им подкладываем обрезанный товар."""
    w, h = im.size
    px = [im.getpixel((x, y)) for x in range(0, w, max(1, w // 20)) for y in (0, h - 1)]
    px += [im.getpixel((x, y)) for y in range(0, h, max(1, h // 20)) for x in (0, w - 1)]
    return tuple(sorted(c[i] for c in px)[len(px) // 2] for i in range(3))


def to_card(im, crop=None, bg=None):
    """Кадр 3:4 для карточки. С crop — вырезаем товар без надписей
    и кладём по центру на подложку цвета его же фона."""
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        # прозрачный фон (такие кадры бывают у WB) — кладём на светлую
        # подложку; иначе прозрачное станет чёрным или полосами
        im = im.convert("RGBA")
        base = Image.new("RGBA", im.size, (255, 255, 255, 255) if not bg else
                         tuple(int(bg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)) + (255,))
        base.alpha_composite(im)
        im = base
    im = im.convert("RGB")
    if crop:
        w, h = im.size
        x0, y0, x1, y1 = crop
        part = im.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
        color = tuple(int(bg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)) if bg else edge_color(part)
        cw = max(part.width, round(part.height * 0.75))
        cw = round(max(cw, part.width / 0.88))
        ch = round(cw / 0.75)
        if part.height / ch > 0.9:
            ch = round(part.height / 0.9); cw = round(ch * 0.75)
        canvas = Image.new("RGB", (cw, ch), color)
        canvas.paste(part, ((cw - part.width) // 2, (ch - part.height) // 2))
        return canvas
    w, h = im.size
    if abs(w / h - 0.75) > 0.01:
        if w / h > 0.75:
            nw = round(h * 0.75); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = round(w / 0.75); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return im


CUTOUTS = ROOT / "art" / "cutouts"
STUDIO_TOP = (252, 243, 246)     # фон карточки: сверху почти белый
STUDIO_BOTTOM = (243, 226, 233)  # к низу — розовее, как пол студии


def studio(cut):
    """Единая студия для всех товаров: вырезанная упаковка по центру,
    мягкая тень, одинаковые поля. Фото с площадок сняты на разных фонах —
    без этого витрина выглядит сборной солянкой."""
    W, H = 900, 1200
    bg = Image.new("RGB", (W, H))
    top, bot = STUDIO_TOP, STUDIO_BOTTOM
    for y in range(H):
        t = y / (H - 1)
        bg.paste(tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)), (0, y, W, y + 1))
    cut = cut.convert("RGBA")
    box = cut.split()[-1].getbbox()
    if box:
        cut = cut.crop(box)
    # вписываем в 72% ширины и 76% высоты
    k = min(W * 0.72 / cut.width, H * 0.76 / cut.height)
    cut = cut.resize((max(1, round(cut.width * k)), max(1, round(cut.height * k))), Image.LANCZOS)
    x = (W - cut.width) // 2
    floor = round(H * 0.885)
    y = floor - cut.height
    # тень: сплюснутый эллипс под основанием и лёгкая тень от силуэта
    from PIL import ImageDraw, ImageFilter
    sh = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(sh)
    sw = cut.width * 0.95
    d.ellipse([W / 2 - sw / 2, floor - 16, W / 2 + sw / 2, floor + 16], fill=120)
    sh = sh.filter(ImageFilter.GaussianBlur(18))
    shadow = Image.new("RGB", (W, H), (120, 70, 90))
    bg = Image.composite(shadow, bg, sh.point(lambda v: int(v * 0.55)))
    bg = bg.convert("RGBA")
    bg.alpha_composite(cut, (x, y))
    return bg.convert("RGB")


def thumbs(manifest):
    """Превью товаров 3:4 — 300 и 600 пикселей по ширине."""
    if not CATALOG.exists():
        print("  нет data/catalog.json — превью товаров пропущены")
        return
    data = json.loads(CATALOG.read_text("utf-8"))
    THUMBS.mkdir(parents=True, exist_ok=True)
    keep = set()
    for p in data.get("products", []):
        url = p.get("img")
        if not url:
            continue
        crop = p.get("img_crop")
        # Имя зависит от адреса и рамки: сменилось фото — сменится файл,
        # и годовой кеш nginx не отдаст старое.
        tag = hashlib.sha1((url + json.dumps(crop)).encode()).hexdigest()[:8]
        stem = f"{p['id']}-{tag}"
        keep.add(stem)
        have = sorted(THUMBS.glob(f"{stem}-*.webp"))
        if have and not FORCE:
            manifest[f"p/{p['id']}"] = {"stem": stem, "w": sorted(int(x.stem.rsplit("-", 1)[1]) for x in have), "ratio": [3, 4], "dir": "img/p"}
            continue
        try:
            raw = fetch(url)
        except Exception as e:
            # Сеть или CDN подвели — оставляем прежнее превью, если оно было,
            # чтобы сборка не упала из-за удалённого файла.
            print(f"  ! {p['id']}: {e}")
            prev = manifest.get(f"p/{p['id']}")
            if prev:
                keep.add(prev["stem"])
            continue
        with Image.open(io.BytesIO(raw)) as im:
            card = to_card(im, crop, p.get("img_bg"))
            ws = save_variants(card, stem, [300, 600], THUMBS)
        manifest[f"p/{p['id']}"] = {"stem": stem, "w": ws, "ratio": [3, 4], "dir": "img/p"}
        print(f"  p/{stem}: {ws}")
    # старые превью, на которые больше никто не ссылается, — удаляем
    for f in THUMBS.glob("*"):
        if f.stem.rsplit("-", 1)[0] not in keep:
            f.unlink()
    for k in [k for k in manifest if k.startswith("p/") and k[2:] not in {p["id"] for p in data.get("products", [])}]:
        manifest.pop(k)


HITS = ROOT / "art" / "hits"


def hits(manifest):
    """Студийные кадры для блока «Хиты» (Higgsfield, по фото упаковки).
    Каталог их не использует — там фото карточек с площадок."""
    if not HITS.exists():
        return
    dest = OUT / "hit"
    for src in sorted(HITS.glob("*.png")):
        pid = src.stem
        tag = hashlib.sha1(src.read_bytes()).hexdigest()[:8]
        stem = f"{pid}-{tag}"
        with Image.open(src) as im:
            card = to_card(im)
            ws = save_variants(card, stem, [300, 600], dest)
        for old in dest.glob(f"{pid}-*"):
            if not old.stem.startswith(stem):
                old.unlink()
        manifest[f"hit/{pid}"] = {"stem": stem, "w": ws, "ratio": [3, 4], "dir": "img/hit"}
        print(f"  hit/{stem}: {ws}")


def main():
    manifest = json.loads(MANIFEST.read_text("utf-8")) if MANIFEST.exists() else {}
    print("сцены:")
    scenes(manifest)
    og_image()
    print("товары:")
    thumbs(manifest)
    print("хиты:")
    hits(manifest)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True), "utf-8")
    if not HAS_AVIF:
        print("внимание: Pillow без AVIF — будут только WebP")


if __name__ == "__main__":
    main()
