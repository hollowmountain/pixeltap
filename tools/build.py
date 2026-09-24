#!/usr/bin/env python3
"""Сборка сайта в dist/ — только то, что должно лежать на хостинге.

    python3 tools/build.py              сборка для просмотра
    python3 tools/build.py --release    сборка для выкладки: строже проверки
    python3 tools/build.py --serve      собрать и открыть на http://localhost:8420
    python3 tools/build.py --pages      предпросмотр для GitHub Pages в dist-pages/:
                                        адреса с /pixeltap/, закрыт от поисковиков

ПОЧЕМУ СБОРКА, А НЕ «ЗАЛИТЬ ПАПКУ»
  1. На Timeweb nginx сам отдаёт .txt/.js/.css/картинки в обход .htaccess.
     Случайно залитый служебный файл ничем не закрыть — значит, на хостинг
     должен попадать только белый список. Его и собирает этот скрипт.
  2. Там же nginx кеширует статику на год. Каждая ссылка на CSS, JS
     и картинку получает ?v=<хэш содержимого>: поменялся файл — поменялась
     ссылка, старое из кеша не отдастся.
  3. Каталог попадает в HTML уже готовым: поисковики видят товары сразу,
     а без JavaScript страница целиком работает.

Источники: site/ (шаблоны, стили, скрипты, картинки), data/catalog.json
(каталог), tools/site-config.json (настройки). Результат: dist/.
"""
import hashlib
import html
import json
import re
import shutil
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode, urlparse

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
PARTIALS = SITE / "partials"
CONF = json.loads((ROOT / "tools" / "site-config.json").read_text("utf-8"))
CATALOG = json.loads((ROOT / "data" / "catalog.json").read_text("utf-8"))
MANIFEST = json.loads((SITE / "img" / "manifest.json").read_text("utf-8"))

RELEASE = "--release" in sys.argv
# Предпросмотр на GitHub Pages живёт в подпапке (…github.io/pixeltap/),
# поэтому все свои адреса получают приставку BASE. Поисковикам он закрыт:
# настоящий адрес сайта — origin, дублей быть не должно.
PREVIEW = "--pages" in sys.argv
ORIGIN = (CONF["preview"]["origin"] if PREVIEW else CONF["origin"]).rstrip("/")
BASE = urlparse(ORIGIN).path.rstrip("/")
DIST = ROOT / ("dist-pages" if PREVIEW else "dist")
PARTNER = CONF["partner_url"]
EMAIL = CONF.get("email") or ""
METRIKA = CONF.get("metrika_id") or 0

PAGES = {
    # шаблон: (адрес, заголовок, описание, og-заголовок)
    "index.html": ("/", "PixelTap — одна марка на всю ванную · официальный сайт",
                   "Официальный сайт PixelTap: ланолиновые кремы для мам, детская серия, карбокситерапия, уход за лицом, телом, волосами и бровями. Купить в магазинах марки на Ozon и Wildberries.",
                   "PixelTap — одна марка на всю ванную"),
    "lanolin/index.html": ("/lanolin/", "Ланолиновый крем PixelTap — 100% ланолин для мам · официальный сайт",
                           "Ланолиновые кремы PixelTap: 100% очищенный ланолин для ухода за сосками в период кормления, губами и сухой кожей. Тубы 15 и 50 г, баночки 15, 25 и 50 г. Купить на Ozon и Wildberries.",
                           "Ланолиновый крем PixelTap — 100% ланолин"),
    "privacy/index.html": ("/privacy/", "Конфиденциальность · PixelTap",
                           "Что остаётся при посещении сайта PixelTap: без форм, регистрации, cookie и счётчиков.",
                           "Конфиденциальность · PixelTap"),
    "404.html": ("/404.html", "Страница не найдена · PixelTap",
                 "Такой страницы нет. Все средства PixelTap — в каталоге на главной.",
                 "PixelTap"),
}
NOINDEX = {"404.html"}

# Что переносится в dist/ как есть. Всё прочее в site/ — исходники сборки.
STATIC_DIRS = ["css", "js", "fonts", "img"]
STATIC_FILES = ["favicon.ico", "favicon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "site.webmanifest"]
ALLOWED_EXT = {".html", ".css", ".js", ".woff2", ".txt", ".avif", ".webp", ".jpg", ".png", ".ico", ".svg",
               ".webmanifest", ".xml"}
SKIP_IN_STATIC = {"manifest.json"}  # служебный список картинок — сайту не нужен

LINE_TITLES = {l["id"]: l["title"] for l in CATALOG["lines"]}
PRODUCTS = CATALOG["products"]
BY_ID = {p["id"]: p for p in PRODUCTS}

errors, warnings = [], []
ID_RE = re.compile(r"[a-z0-9-]+")


def fail(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def esc(s):
    return html.escape(str(s), quote=True)


NBSP = "\u00a0"


def typo(s):
    """Типографика строк из данных: неразрывный пробел между числом и
    единицей, перед тире; мягкий перенос в длинных словах, которые иначе
    не помещаются в узкую карточку на телефоне."""
    s = str(s)
    s = re.sub(r"(\d) (г|мл|шт|см|°C|×)", lambda m: m.group(1) + NBSP + m.group(2), s)
    s = re.sub(r"(×) (\d)", lambda m: m.group(1) + NBSP + m.group(2), s)
    s = s.replace(" — ", NBSP + "— ")
    # короткие предлоги и союзы не остаются в конце строки
    s = re.sub(r"(?<![\w-])(и|в|с|к|у|о|а|на|по|за|для|от|до|из|без|под|при|не) (?=\S)", lambda m: m.group(1) + NBSP, s, flags=re.I)
    s = re.sub(r"(\d) (в) (\d)", lambda m: m.group(1) + NBSP + m.group(2) + NBSP + m.group(3), s)
    s = s.replace("Карбокситерапия", "Карбокси\u00adтерапия").replace("карбокситерапия", "карбокси\u00adтерапия")
    return s


def etypo(s):
    return esc(typo(s))


# ---------------------------------------------------------------- числа

def plural(n, one, few, many):
    m10, m100 = n % 10, n % 100
    if m10 == 1 and m100 != 11:
        return one
    if 2 <= m10 <= 4 and not 12 <= m100 <= 14:
        return few
    return many


WORDS = {1: "Одна", 2: "Две", 3: "Три", 4: "Четыре", 5: "Пять", 6: "Шесть", 7: "Семь", 8: "Восемь",
         9: "Девять", 10: "Десять", 11: "Одиннадцать", 12: "Двенадцать"}


def count_of(key):
    if key == "products":
        return len(PRODUCTS)
    if key == "lines":
        return len([l for l in CATALOG["lines"] if lines_count(l["id"])])
    if key.startswith("line:"):
        return lines_count(key[5:])
    raise KeyError(key)


def lines_count(line_id):
    return sum(1 for p in PRODUCTS if p["line"] == line_id)


def noun_for(key, n):
    if key == "lines":
        return plural(n, "линейка", "линейки", "линеек")
    return plural(n, "средство", "средства", "средств")


# ---------------------------------------------------------------- ссылки

WB_HOSTS = {"www.wildberries.ru"}
OZON_HOSTS = {"www.ozon.ru"}
PARTNER_HOSTS = {"ctmcosmetics.ru"}  # «Сотрудничество» — наш второй сайт


def market_url(p, market, place):
    """Ссылка на карточку с метками внешнего трафика."""
    u = CONF["utm"]
    line = p["line"]
    if market == "wb":
        w = p.get("wb")
        if not w:
            return None
        supplier = u["wb_supplier"].get(w.get("cabinet"))
        camp = f"{supplier}-id-site_{line}" if supplier else f"site_{line}"
        base = f"https://www.wildberries.ru/catalog/{int(w['nmID'])}/detail.aspx"
    else:
        o = p.get("ozon")
        if not o:
            return None
        org = u["ozon_org"].get(o.get("cabinet"))
        camp = f"vendor_org_{org}_site_{line}" if org else f"site_{line}"
        base = f"https://www.ozon.ru/product/{int(o['sku'])}/"
    q = urlencode({"utm_source": u["source"], "utm_medium": u["medium"], "utm_campaign": camp, "utm_content": place})
    return f"{base}?{q}"


STORE_SUPPLIER = {"wb": 104569, "wb2": 232922}


def store_url(name, place):
    """Ссылка на витрину магазина — тоже с метками, чтобы переходы с кнопок
    «Магазин на …» были видны в отчётах «Внешний трафик»."""
    base = CONF["stores"][name]
    u = CONF["utm"]
    sup = STORE_SUPPLIER.get(name)
    camp = f"{sup}-id-site_store" if sup else "site_store"
    q = urlencode({"utm_source": u["source"], "utm_medium": u["medium"], "utm_campaign": camp, "utm_content": place})
    return f"{base}{'&' if '?' in base else '?'}{q}"


def check_url(url, where):
    pr = urlparse(url)
    if pr.scheme != "https" or pr.netloc not in (WB_HOSTS | OZON_HOSTS):
        fail(f"{where}: ссылка вне белого списка: {url}")


# ---------------------------------------------------------------- картинки

ASSET_HASH = {}


def file_hash(rel):
    """Хэш файла из dist/ (или site/, пока не скопирован)."""
    if rel in ASSET_HASH:
        return ASSET_HASH[rel]
    for base in (DIST, SITE):
        f = base / rel
        if f.is_file():
            h = hashlib.sha256(f.read_bytes()).hexdigest()[:10]
            ASSET_HASH[rel] = h
            return h
    fail(f"нет файла для версии: {rel}")
    return "0"


def srcset(entry, stem, fmt):
    d = entry.get("dir", "img")
    return ", ".join(f"/{d}/{stem}-{w}.{fmt}?v={file_hash(f'{d}/{stem}-{w}.{fmt}')} {w}w" for w in entry["w"])


def picture(name, sizes, alt, loading="lazy", cls="", priority=False):
    e = MANIFEST.get(name)
    if not e:
        fail(f"нет картинки в manifest: {name}")
        return ""
    stem = e.get("stem", name)
    d = e.get("dir", "img")
    rw, rh = e["ratio"]
    mid = e["w"][min(1, len(e["w"]) - 1)]
    w, h = mid, round(mid * rh / rw)
    fallback = f"/{d}/{stem}-{mid}.webp?v={file_hash(f'{d}/{stem}-{mid}.webp')}"
    avif = f'<source type="image/avif" srcset="{srcset(e, stem, "avif")}" sizes="{esc(sizes)}">' if (SITE / d / f"{stem}-{mid}.avif").exists() else ""
    attrs = f'loading="{loading}" decoding="async"'
    if priority:
        attrs = 'loading="eager" fetchpriority="high" decoding="async"'
    cls_attr = f' class="{cls}"' if cls else ""
    return (f'<picture{cls_attr}>{avif}'
            f'<source type="image/webp" srcset="{srcset(e, stem, "webp")}" sizes="{esc(sizes)}">'
            f'<img src="{fallback}" width="{w}" height="{h}" alt="{esc(alt)}" {attrs}></picture>')


def hero_picture():
    """Первый экран: на телефоне вертикальный кадр, на компьютере широкий."""
    tall, wide = MANIFEST["hero-tall"], MANIFEST["hero-wide"]
    parts = ['<picture class="hero-media">']
    for fmt in ("avif", "webp"):
        if fmt == "avif" and not (SITE / "img" / f"hero-tall-{tall['w'][0]}.avif").exists():
            continue
        parts.append(f'<source media="(max-width: 760px)" type="image/{fmt}" srcset="{srcset(tall, "hero-tall", fmt)}" sizes="100vw">')
        parts.append(f'<source type="image/{fmt}" srcset="{srcset(wide, "hero-wide", fmt)}" sizes="(max-width: 1180px) 1450px, 100vw">')
    mid = wide["w"][1]
    rw, rh = wide["ratio"]
    parts.append(f'<img src="/img/hero-wide-{mid}.webp?v={file_hash(f"img/hero-wide-{mid}.webp")}" width="{mid}" height="{round(mid * rh / rw)}" '
                 f'alt="Средства PixelTap на розовом граните в утреннем тумане: ланолиновый крем, набор для карбокситерапии и детский крем" '
                 f'loading="eager" fetchpriority="high" decoding="async">')
    parts.append("</picture>")
    return "".join(parts)


# ---------------------------------------------------------------- карточки

def buy_links(p, place, cls="buy"):
    out = []
    for market, label, mk in (("ozon", "Ozon", "mk-ozon"), ("wb", "Wildberries", "mk-wb")):
        url = market_url(p, market, place)
        if not url:
            continue
        check_url(url, p["id"])
        out.append(
            f'<a class="{cls}" href="{esc(url)}" target="_blank" rel="noopener" '
            f'aria-label="{label}: {esc(p["name"])}{", " + esc(p["volume"]) if p.get("volume") else ""}, откроется в новой вкладке" '
            f'data-goal="buy" data-market="{market}" data-line="{p["line"]}" data-place="{place}">'
            f'<span class="mk {mk}" aria-hidden="true"></span>{label}</a>')
    return out


def card(p, place="catalog", hit=False, heading="h3"):
    links = buy_links(p, place)
    if not links:
        warn(f"{p['id']}: нет ни одной площадки — карточка пропущена")
        return ""
    key = f"hit/{p['id']}" if hit and f"hit/{p['id']}" in MANIFEST else f"p/{p['id']}"
    thumb = MANIFEST.get(key)
    if thumb:
        # alt пустой: название товара — в заголовке карточки рядом,
        # иначе экранный диктор читает его дважды
        media = picture(key, "(max-width: 520px) 50vw, 300px", "", "lazy")
        media_cls = "card-media"
    else:
        media, media_cls = "", "card-media is-empty"
        warn(f"{p['id']}: нет фото")
    tags = "".join(f'<span class="tag{" tag-lanolin" if "ланолин" in t.lower() else ""}">{etypo(t)}</span>' for t in p.get("tags", []))
    vol = f'<span class="tnum">{etypo(p["volume"])}</span>' if p.get("volume") else ""
    search = " ".join([p["name"], p.get("volume", ""), LINE_TITLES.get(p["line"], "").replace("\u00ad", ""), " ".join(p.get("tags", [])), p.get("desc", "")])
    badge = '<span class="card-badge">Хит</span>' if hit else ""
    desc = f'<p class="card-desc">{etypo(p["desc"])}</p>' if p.get("desc") else ""
    return (f'<article class="card" data-line="{p["line"]}" data-search="{esc(search.lower())}">'
            f'<div class="{media_cls}">{media}{badge}</div>'
            f'<div class="card-body"><{heading} class="card-name">{etypo(p["name"])}</{heading}>'
            f'<p class="card-line">{esc(LINE_TITLES.get(p["line"], ""))}</p>'
            f'<div class="card-meta">{vol}{tags}</div>{desc}'
            f'<div class="card-buy{" one" if len(links) == 1 else ""}">{"".join(links)}</div></div></article>')


def sort_key(p):
    return (p.get("rank") or 999, p["name"])


def all_cards():
    order = [l["id"] for l in CATALOG["lines"]]
    items = sorted(PRODUCTS, key=lambda p: (order.index(p["line"]) if p["line"] in order else 99, sort_key(p)))
    return "\n".join(card(p) for p in items)


def sales(p):
    return sum(((p.get(m) or {}).get("sales") or 0) for m in ("wb", "ozon"))


def bestsellers():
    """Хиты: самые заказываемые товары, не больше двух из одной линейки.
    Порядок считается по продажам в data/private/ и приходит сюда флагом
    hit (1…8) — сами продажи в публичный каталог не попадают."""
    picks = sorted((p for p in PRODUCTS if p.get("hit")), key=lambda p: p["hit"])
    return "\n".join(card(p, place="hits", hit=True) for p in picks)


def tiles():
    out = []
    for l in CATALOG["lines"]:
        n = lines_count(l["id"])
        if not n:
            continue
        href = "/lanolin/" if l["id"] == "lanolin" else f"/?line={l['id']}#catalog"
        note = CONF.get("line_notes", {}).get(l["id"], "")
        pic = picture(f"tile-{l['id']}", "(max-width: 1000px) 50vw, (max-width: 1320px) 25vw, 300px", "", "lazy") if f"tile-{l['id']}" in MANIFEST else ""
        out.append(
            f'<a class="tile rise" href="{href}" data-line-link="{l["id"]}">'
            f'<span class="tile-media">{pic}</span>'
            f'<span class="tile-body"><span class="tile-title">{etypo(l["title"])}</span>'
            f'<span class="tile-meta"><span>{etypo(note)}{" · " if note else ""}{n}{NBSP}{noun_for("products", n)}</span>'
            f'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></span></a>')
    return "\n".join(out)


def chips():
    out = [f'<button class="chip" type="button" data-line="all" aria-pressed="true">Все <span class="chip-n tnum">{len(PRODUCTS)}</span></button>']
    for l in CATALOG["lines"]:
        n = lines_count(l["id"])
        if n:
            out.append(f'<button class="chip" type="button" data-line="{l["id"]}" aria-pressed="false">{esc(l["title"])} <span class="chip-n tnum">{n}</span></button>')
    return "\n".join(out)


def checklist():
    rows = []
    for item in CONF.get("mama_checklist", []):
        p = BY_ID.get(item["id"])
        if not p:
            warn(f"список «в роддом»: нет товара {item['id']} в каталоге — строка пропущена")
            continue
        links = buy_links(p, "checklist", cls="chip-link")
        if not links:
            continue
        rows.append(
            f'<li><span class="check" aria-hidden="true"><svg class="ico" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>'
            f'<span class="ck-name">{etypo(p["name"])}{", " + etypo(p["volume"]) if p.get("volume") else ""}'
            f'<span class="ck-note">{esc(item.get("note", ""))}</span></span>'
            f'<span class="ck-go">{"".join(links)}</span></li>')
    return f'<ul class="checklist">{"".join(rows)}</ul>' if rows else ""


# ---------------------------------------------------------------- разметка для поисковиков

def faq_pairs(partial):
    raw = render_text((PARTIALS / partial).read_text("utf-8"), {})
    pairs = []
    for q, a in re.findall(r"<summary>(.*?)</summary>\s*<div class=\"faq-a\">(.*?)</div>", raw, re.S):
        clean = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s)).replace("\xa0", " ").strip()
        pairs.append({"@type": "Question", "name": clean(q),
                      "acceptedAnswer": {"@type": "Answer", "text": clean(a)}})
    return pairs


def jsonld(page):
    org = {
        "@type": "Organization", "@id": ORIGIN + "/#org", "name": "PixelTap",
        "alternateName": "Пиксель Тап", "url": ORIGIN + "/",
        "logo": ORIGIN + "/icon-512.png",
        "sameAs": [CONF["stores"]["wb"], CONF["stores"]["ozon"]],
    }
    if EMAIL:
        org["email"] = EMAIL
    graph = [org, {"@type": "WebSite", "@id": ORIGIN + "/#site", "url": ORIGIN + "/", "name": "PixelTap",
                   "inLanguage": "ru", "publisher": {"@id": ORIGIN + "/#org"}}]
    if page == "index.html":
        graph.append({"@type": "FAQPage", "mainEntity": faq_pairs("faq-home.html")})
    if page == "lanolin/index.html":
        graph.append({"@type": "FAQPage", "mainEntity": faq_pairs("faq-lanolin.html")})
        graph.append({"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Главная", "item": ORIGIN + "/"},
            {"@type": "ListItem", "position": 2, "name": "Ланолин", "item": ORIGIN + "/lanolin/"}]})
    data = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, separators=(",", ":"))
    data = data.replace("</", "<\\/")
    return '<script type="application/ld+json">' + data + '</script>'


# ---------------------------------------------------------------- безопасность

# Домены Метрики — по справке Яндекса «Настройка CSP для счётчика»
# (yandex.ru/support/metrica/code/install-counter-csp.html). Вебвизор выключен,
# поэтому mc.webvisor.* не нужны.
METRIKA_TLDS = ["ru", "by", "kz", "com", "uz", "az", "com.am", "com.ge", "co.il", "kg", "lt", "lv", "md", "tj", "tm", "ee", "fr", "com.tr"]


def csp(for_header=False):
    script = ["'self'"]
    img = ["'self'"]
    connect = ["'self'"]
    if METRIKA:
        mc = [f"https://mc.yandex.{t}" for t in METRIKA_TLDS]
        script += ["https://mc.yandex.ru", "https://yastatic.net"]
        img += mc
        connect += mc + ["wss://mc.yandex.ru"]
    parts = [
        "default-src 'none'", f"script-src {' '.join(script)}", "style-src 'self'", "font-src 'self'",
        f"img-src {' '.join(img)}", f"connect-src {' '.join(connect)}", "manifest-src 'self'",
        "base-uri 'none'", "form-action 'none'",
    ]
    if for_header:
        parts += ["frame-ancestors 'none'", "upgrade-insecure-requests"]
    return "; ".join(parts)


# ---------------------------------------------------------------- шаблоны

COND = re.compile(r"<!--if:(\w+)-->(.*?)<!--endif-->", re.S)


VERIFY = CONF.get("verify") or {}


def flags():
    return {"email": bool(EMAIL), "metrika": bool(METRIKA), "nometrika": not METRIKA,
            "yandex_verify": bool(VERIFY.get("yandex")), "google_verify": bool(VERIFY.get("google"))}


def render_text(text, ctx):
    """Условия, включения, подстановки. Порядок важен: включения могут
    содержать условия и подстановки."""
    for _ in range(3):
        text = re.sub(r"\{\{include:([\w-]+)\}\}", lambda m: include(m.group(1)), text)
    f = flags()
    text = COND.sub(lambda m: m.group(2) if f.get(m.group(1)) else "", text)

    def sub(m):
        key = m.group(1)
        if key in ctx:
            return ctx[key]
        if key.startswith("v:"):
            return file_hash(key[2:])
        if key.startswith("n:"):
            return str(count_of(key[2:]))
        if key.startswith("np:"):
            n = count_of(key[3:]); return f"{n}&nbsp;{noun_for(key[3:], n)}"
        if key.startswith("pw:"):
            n = count_of(key[3:]); return noun_for(key[3:].split(":")[0] if key[3:] == "lines" else "products", n)
        if key.startswith("nw:"):
            n = count_of(key[3:]); return f"{WORDS.get(n, str(n))} {noun_for(key[3:], n)}"
        if key.startswith("pic:"):
            parts = key[4:].split("|")
            name, sizes, alt = parts[0], parts[1], parts[2]
            loading = parts[3] if len(parts) > 3 else "lazy"
            return picture(name, sizes, alt, loading, priority=(loading == "eager"))
        if key.startswith("cards:"):
            line = key[6:]
            items = sorted((p for p in PRODUCTS if p["line"] == line), key=sort_key)
            return "\n".join(card(p, place=f"{line}-page") for p in items)
        if key.startswith("faq:"):
            return render_text((PARTIALS / f"faq-{key[4:]}.html").read_text("utf-8"), ctx)
        if key.startswith("store:"):
            parts = key.split(":")
            return esc(store_url(parts[1], parts[2] if len(parts) > 2 else "site"))
        simple = {
            "year": str(date.today().year), "email": esc(EMAIL), "partner": esc(PARTNER),
            "host": esc(CONF["host"]), "policy_date": esc(CONF["policy_date"]),
            "origin": ORIGIN, "csp": csp(False),
            "yandex_verify": esc(VERIFY.get("yandex") or ""), "google_verify": esc(VERIFY.get("google") or ""),
        }
        if key in simple:
            return simple[key]
        fail(f"неизвестная подстановка {{{{{key}}}}}")
        return ""

    return re.sub(r"\{\{([^{}]+?)\}\}", sub, text)


def include(name):
    if name == "consent" and not METRIKA:
        return ""
    f = PARTIALS / f"{name}.html"
    if not f.exists():
        fail(f"нет частичного шаблона {name}")
        return ""
    return f.read_text("utf-8")


def strip_comments(text):
    """Внутренние заметки из HTML-комментариев на хостинг не попадают."""
    return re.sub(r"<!--(?!\[if).*?-->", "", text, flags=re.S)


def build_page(rel):
    path, title, desc, og_title = PAGES[rel]
    src = (SITE / rel).read_text("utf-8")
    ctx = {
        "title": esc(title), "description": esc(desc), "og_title": esc(og_title),
        "canonical": ORIGIN + path,
        "robots": "noindex, nofollow" if PREVIEW else ("noindex, follow" if rel in NOINDEX else "index, follow"),
        "jsonld": jsonld(rel) if rel in ("index.html", "lanolin/index.html") else "",
        "hero": hero_picture() if rel == "index.html" else "",
        "bestsellers": bestsellers(), "tiles": tiles(), "chips": chips(), "cards": all_cards(),
        "checklist": checklist(),
    }
    out = render_text(src, ctx)
    page = rel.split("/")[0].replace(".html", "")
    # текущий раздел в меню
    out = re.sub(r'(<a href="[^"]*" data-nav="%s")' % re.escape(page), r'\1 aria-current="page"', out)
    if METRIKA:
        out = out.replace("</head>", f'<meta name="pt-metrika" content="{int(METRIKA)}">\n</head>', 1)
    out = strip_comments(out)
    out = re.sub(r"\n\s*\n+", "\n", out)
    out = rebase(out)
    dst = DIST / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(out, "utf-8")
    lint_html(rel, out)


def rebase(text):
    """Свои адреса /… → BASE/… (для предпросмотра в подпапке)."""
    if not BASE:
        return text
    fix = lambda u: BASE + u if u.startswith("/") and not u.startswith("//") else u
    text = re.sub(r'(\s(?:href|src)=")([^"]*)"', lambda m: f'{m.group(1)}{fix(m.group(2))}"', text)
    return re.sub(r'(\ssrcset=")([^"]*)"',
                  lambda m: m.group(1) + ", ".join(fix(x.strip()) for x in m.group(2).split(",")) + '"', text)


def lint_html(rel, out):
    bare = re.sub(r'<script type="application/ld\+json">.*?</script>', "", out, flags=re.S)
    if "{{" in bare or "}}" in bare:
        fail(f"{rel}: остались незаполненные {{{{…}}}}")
    if re.search(r"\sstyle=\"", out):
        fail(f"{rel}: атрибут style= — CSP его запретит")
    for m in re.finditer(r"<img\b[^>]*>", out):
        if " alt=" not in m.group(0):
            fail(f"{rel}: <img> без alt: {m.group(0)[:80]}")
    for m in re.finditer(r'<script\b(?![^>]*type="application/ld\+json")(?![^>]*\bsrc=)[^>]*>', out):
        fail(f"{rel}: встроенный скрипт — CSP его не пропустит")
    if out.count("<h1") != 1:
        fail(f"{rel}: заголовков h1 — {out.count('<h1')}, нужен ровно один")
    own = urlparse(ORIGIN).netloc
    for m in re.finditer(r'\s(href|src|srcset)="([^"]*)"', out):
        for raw in (m.group(2).split(",") if m.group(1) == "srcset" else [m.group(2)]):
            u = html.unescape(raw.strip().split(" ")[0])
            if not u:
                continue
            if u.startswith("/") and not u.startswith("//"):
                continue  # свой путь
            if u.startswith("#") or u.startswith("mailto:"):
                continue
            pr = urlparse(u)
            if pr.scheme == "https" and pr.netloc in WB_HOSTS | OZON_HOSTS | PARTNER_HOSTS | {own}:
                continue
            fail(f"{rel}: недопустимая ссылка в {m.group(1)}: {u}")
    for bad in (r'http-equiv="refresh"', r"<base\b", r"<iframe\b", r"<form\b", r"<object\b", r"<embed\b", r"\son\w+="):
        if re.search(bad, out, re.I):
            fail(f"{rel}: в разметке запрещённое: {bad}")


# ---------------------------------------------------------------- служебные файлы

def version_css_urls():
    """url() внутри CSS тоже получают ?v=<хэш>: статику nginx кеширует на год."""
    css = DIST / "css" / "site.css"
    text = css.read_text("utf-8")

    def rep(m):
        rel = m.group(1)
        target = (css.parent / rel).resolve().relative_to(DIST.resolve()).as_posix()
        return f'url("{rel}?v={file_hash(target)}")'

    text = re.sub(r'url\("(\.\./[^"?]+)"\)', rep, text)
    css.write_text(text, "utf-8")
    ASSET_HASH.pop("css/site.css", None)


def write_meta_files():
    if PREVIEW:
        # На Pages нет .htaccess, а robots.txt в подпапке поисковики не читают:
        # предпросмотр закрыт мета-тегом robots на каждой странице.
        wm = DIST / "site.webmanifest"
        if wm.exists():
            m = json.loads(wm.read_text("utf-8"))
            m["start_url"] = BASE + m["start_url"]
            for icon in m.get("icons", []):
                icon["src"] = BASE + icon["src"]
            wm.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", "utf-8")
        return
    today = date.today().isoformat()
    urls = [p for r, (p, *_rest) in PAGES.items() if r not in NOINDEX]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        sm.append(f"  <url><loc>{ORIGIN}{u}</loc><lastmod>{today}</lastmod></url>")
    sm.append("</urlset>")
    (DIST / "sitemap.xml").write_text("\n".join(sm) + "\n", "utf-8")
    # Clean-param: ссылки вида /?line=carboxy#catalog — та же главная,
    # Яндексу это надо сказать явно, иначе он считает их дублями.
    (DIST / "robots.txt").write_text(f"User-agent: *\nDisallow:\n\nUser-agent: Yandex\nDisallow:\nClean-param: line /\n\nSitemap: {ORIGIN}/sitemap.xml\n", "utf-8")

    if EMAIL:
        exp = (datetime.utcnow() + timedelta(days=360)).strftime("%Y-%m-%dT00:00:00.000Z")
        wk = DIST / ".well-known"
        wk.mkdir(exist_ok=True)
        (wk / "security.txt").write_text(
            f"Contact: mailto:{EMAIL}\nExpires: {exp}\nPreferred-Languages: ru, en\nCanonical: {ORIGIN}/.well-known/security.txt\n", "utf-8")

    tpl = (SITE / "htaccess.tpl").read_text("utf-8")
    host = urlparse(ORIGIN).netloc
    ht = tpl.replace("{{csp_header}}", csp(True)).replace("{{host}}", host).replace("{{host_re}}", re.escape(host))
    (DIST / ".htaccess").write_text(ht, "utf-8")


# Что и откуда уезжает на хостинг. Всё, что не подходит, — ошибка сборки,
# а не молчаливое копирование: nginx на Timeweb отдаёт статику мимо
# .htaccess, закрыть случайный файл там уже нечем.
STATIC_RULES = {
    "css": {".css"},
    "js": {".js"},
    "fonts": {".woff2", ".txt"},
    "img": {".avif", ".webp", ".jpg"},
}


def copy_static():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for d, exts in STATIC_RULES.items():
        for f in (SITE / d).rglob("*"):
            if f.is_dir():
                continue
            rel = f.relative_to(SITE)
            if f.name in SKIP_IN_STATIC and d == "img" and len(rel.parts) == 2:
                continue
            if any(part.startswith(".") for part in rel.parts):
                if f.name == ".DS_Store":
                    continue
                fail(f"скрытый файл в {rel} — в выкладку не пойдёт, уберите его из site/")
                continue
            if f.suffix.lower() not in exts:
                fail(f"{rel}: такому файлу не место в site/{d}/ (разрешено: {', '.join(sorted(exts))})")
                continue
            if d == "fonts" and f.suffix == ".txt" and not f.name.startswith("OFL"):
                fail(f"{rel}: в fonts/ из .txt допустимы только лицензии OFL-*.txt")
                continue
            if d == "js" and f.name == "consent.js" and not METRIKA:
                continue
            dst = DIST / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst)
    for name in STATIC_FILES:
        f = SITE / name
        if f.exists():
            shutil.copy2(f, DIST / name)
        else:
            warn(f"нет {name}")


def audit_dist():
    """Последний рубеж: в dist/ не должно быть ничего, кроме сайта."""
    bad_names = re.compile(r"(^|/)(\.git|\.env|\.DS_Store|env[\w.-]*\.txt|.*\.(md|mjs|py|sh|key|pem|log|bak|map|orig|swp|tpl|json)$)", re.I)
    total = 0
    for f in DIST.rglob("*"):
        if f.is_dir():
            continue
        rel = f.relative_to(DIST).as_posix()
        total += f.stat().st_size
        if rel in (".htaccess", ".well-known/security.txt"):
            continue
        if bad_names.search(rel):
            fail(f"dist: служебный файл попал в выкладку: {rel}")
        if f.suffix.lower() not in ALLOWED_EXT:
            fail(f"dist: неожиданное расширение: {rel}")
        if rel.startswith("img/p/") is False and f.suffix in (".avif", ".webp") and f.stat().st_size > 400_000:
            warn(f"тяжёлая картинка: {rel} ({f.stat().st_size // 1024} КБ)")
    return total


def validate_data():
    """Данные идут в разметку и в имена файлов — проверяем формат заранее."""
    for l in CATALOG["lines"]:
        if not ID_RE.fullmatch(l["id"]):
            fail(f"линейка с недопустимым id: {l['id']!r}")
    for p in PRODUCTS:
        if not ID_RE.fullmatch(p["id"]):
            fail(f"товар с недопустимым id: {p['id']!r}")
        if p["line"] not in LINE_TITLES:
            fail(f"{p['id']}: неизвестная линейка {p['line']!r}")
        for m, key in (("wb", "nmID"), ("ozon", "sku")):
            if p.get(m) and not str(p[m].get(key, "")).isdigit():
                fail(f"{p['id']}: {m}.{key} должен быть числом")
    for name, url in CONF["stores"].items():
        if name.startswith("_"):
            continue
        check_url(url, f"stores.{name}")
    pp = urlparse(PARTNER)
    if pp.scheme != "https" or pp.netloc not in PARTNER_HOSTS:
        fail(f"partner_url вне белого списка: {PARTNER}")
    if PREVIEW and not BASE.startswith("/"):
        fail(f"preview.origin должен быть с подпапкой: {ORIGIN}")
    if EMAIL and not re.fullmatch(r"[^@\s<>\"']+@[^@\s<>\"']+\.[a-z]{2,}", EMAIL, re.I):
        fail(f"email выглядит неверно: {EMAIL!r}")


def main():
    validate_data()
    copy_static()
    version_css_urls()
    for rel in PAGES:
        build_page(rel)
    write_meta_files()
    total = audit_dist()
    n = sum(1 for _ in DIST.rglob("*") if _.is_file())
    print(f"{DIST.name}/: {n} файлов, {total / 1024 / 1024:.1f} МБ; товаров {len(PRODUCTS)}, линеек {count_of('lines')}")
    for w in warnings:
        print("  предупреждение:", w)
    for e in errors:
        print("  ОШИБКА:", e)
    if errors:
        sys.exit(1)
    if "--serve" in sys.argv:
        serve()


def serve():
    """Локальный просмотр dist/ с теми же чистыми адресами, что на хостинге."""
    from functools import partial
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    class H(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", csp(True).replace("; upgrade-insecure-requests", ""))
            super().end_headers()

        def log_message(self, *a):
            pass

        def send_error(self, code, message=None, explain=None):
            if code == 404 and (DIST / "404.html").exists():
                body = (DIST / "404.html").read_bytes()
                self.send_response(404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().send_error(code, message, explain)

    H.extensions_map.update({".avif": "image/avif", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2"})
    port = 8420
    srv = ThreadingHTTPServer(("127.0.0.1", port), partial(H, directory=str(DIST)))
    print(f"сайт на http://localhost:{port}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
