#!/usr/bin/env node
/* Сборка products.json из кабинетов Ozon и Wildberries.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ЗАПРОС ИЗ БРАУЗЕРА
 * Ключи продавца — это доступ к кабинету: ими можно менять цены, править
 * и удалять карточки, читать заказы. Всё, что попало в JS на сайте,
 * посетитель читает в две секунды через инструменты разработчика. Поэтому
 * ключи живут только здесь, скрипт запускается у вас на машине (или в CI),
 * а сайт получает готовый статичный products.json. Ни один ключ на сайт
 * не попадает.
 *
 * ЗАПУСК
 *   set WB_TOKEN=...            (PowerShell: $env:WB_TOKEN="...")
 *   set OZON_CLIENT_ID=...
 *   set OZON_API_KEY=...
 *   node tools/fetch-catalog.mjs
 *
 * Можно взять только одну площадку — вторая просто пропустится.
 * Флаги:
 *   --dry     ничего не писать, показать что получилось
 *   --out F   путь к файлу (по умолчанию products.json)
 */

import { writeFile, readFile } from 'node:fs/promises';
import { argv, env, exit } from 'node:process';

const OUT = argFlag('--out') || 'products.json';
const DRY = argv.includes('--dry');

function argFlag(name) {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : null;
}

/* ---------- ключи ---------- */
/* Читаются либо из переменных окружения, либо из файла ключей рядом
   с проектом. Файл держим ВНЕ папки сайта: всё, что лежит внутри неё,
   веб-сервер отдаёт наружу по обычной ссылке. */

async function loadCabinets() {
  const cab = { wb: [], ozon: [] };

  if (env.WB_TOKEN) cab.wb.push({ name: 'WB_TOKEN', token: env.WB_TOKEN });
  if (env.OZON_CLIENT_ID && env.OZON_API_KEY)
    cab.ozon.push({ name: 'OZON', id: env.OZON_CLIENT_ID, key: env.OZON_API_KEY });

  const path = argFlag('--env') || '../env.txt';
  let raw = '';
  try { raw = await readFile(path, 'utf8'); } catch { return cab; }

  const rows = raw.split(/\r?\n/).filter(Boolean).map(line => {
    const i = line.search(/[=:]/);
    return i < 0 ? null : { name: line.slice(0, i).trim(), val: line.slice(i + 1).trim() };
  }).filter(Boolean);

  // Ozon: ключ и идентификатор кабинета идут парой. Имена в файле могут
  // повторяться (частая опечатка), поэтому пары собираем по порядку
  // следования, а не по названию строки.
  const ozKeys = rows.filter(r => /cabinet_ozon/i.test(r.name));
  const ozIds  = rows.filter(r => /id_ozon/i.test(r.name));
  ozKeys.forEach((k, i) => {
    if (ozIds[i]) cab.ozon.push({ name: `ozon-${i + 1}`, id: ozIds[i].val, key: k.val });
  });

  rows.filter(r => /wb/i.test(r.name))
      .forEach((t, i) => cab.wb.push({ name: `wb-${i + 1}`, token: t.val }));

  return cab;
}

/* ---------- сеть ---------- */

// Площадки отвечают не мгновенно и иногда рвут соединение, поэтому
// каждый запрос повторяется. Пауза растёт, чтобы не долбить лимиты.
async function post(url, headers, body, tries = 8) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
      });

      if (res.status === 429) {                    // упёрлись в лимит
        const wait = 2000 * attempt;
        warn(`лимит запросов, жду ${wait / 1000} с`);
        await sleep(wait);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        // Тело ошибки печатаем: в нём площадка объясняет причину.
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
      }
      return text ? JSON.parse(text) : {};
    } catch (e) {
      // «fetch failed» само по себе не объясняет ничего. Достаём код
      // причины: по нему видно, это сеть или всё-таки ответ площадки.
      const code = e.cause?.code;
      if (attempt === tries) {
        if (code) {
          const hint = {
            ECONNRESET:  'соединение разорвано на полпути',
            ENOTFOUND:   'домен не разрешается — проверьте DNS',
            ETIMEDOUT:   'площадка не ответила вовремя',
            ECONNREFUSED:'соединение отклонено'
          }[code] || 'сетевая ошибка';
          throw new Error(`${hint} (${code}). Это проблема связи, а не ключей.`);
        }
        throw e;
      }
      await sleep(1200 * attempt);
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const warn = m => console.warn('  ! ' + m);
const say  = m => console.log(m);

/* ---------- Wildberries ---------- */
/* Карточки: POST /content/v2/get/cards/list
   Авторизация — заголовок Authorization с токеном категории «Контент».
   Постранично: из cursor ответа берём updatedAt и nmID и кладём
   в следующий запрос, пока total не станет меньше limit. */

async function fetchWB(cab) {
  say(`WB ${cab.name}: забираю карточки…`);

  const URL = 'https://content-api.wildberries.ru/content/v2/get/cards/list';
  const LIMIT = 100;
  const out = [];
  let cursor = { limit: LIMIT };

  for (let page = 1; page <= 100; page++) {
    const data = await post(URL, { Authorization: cab.token }, {
      settings: { cursor, filter: { withPhoto: -1 } }
    });

    const cards = data?.cards || [];
    out.push(...cards);

    const c = data?.cursor || {};
    const got = typeof c.total === 'number' ? c.total : cards.length;
    say(`  страница ${page}: ${cards.length} (всего ${out.length})`);

    if (got < LIMIT || !cards.length) break;
    cursor = { limit: LIMIT, updatedAt: c.updatedAt, nmID: c.nmID };
    await sleep(700);                      // бережём лимит запросов
  }

  return out.map(card => ({
    source: 'wb',
    cabinet: cab.name,
    brand: String(card.brand || '').trim(),
    article: String(card.vendorCode || '').trim(),
    name: String(card.title || card.subjectName || '').trim(),
    img: card.photos?.[0]?.big || card.photos?.[0]?.c516x688 || '',
    wb: card.nmID ? `https://www.wildberries.ru/catalog/${card.nmID}/detail.aspx` : '',
    volume: pickVolume(card)
  }));
}

// Объём лежит в характеристиках под разными названиями — ищем по смыслу.
// Площадка отдаёт голое число, поэтому единицу подставляем сами: без неё
// «150» рядом с названием читается как цена или артикул.
function pickVolume(card) {
  const ch = card.characteristics || [];
  const hit = ch.find(c => /объ[её]м/i.test(String(c.name || '')))
           || ch.find(c => /вес|нетто/i.test(String(c.name || '')));
  if (!hit) return '';
  const raw = Array.isArray(hit.value) ? hit.value[0] : hit.value;
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (/[а-яa-z]/i.test(v)) return v;                  // единица уже есть
  const weight = /вес|нетто/i.test(String(hit.name));
  return v + (weight ? ' г' : ' мл');
}

/* ---------- Ozon ---------- */
/* Два шага: /v3/product/list отдаёт идентификаторы,
   /v3/product/info/list — карточки с названиями и картинками.
   Авторизация — заголовки Client-Id и Api-Key. */

async function fetchOzon(cab) {
  say(`Ozon ${cab.name}: забираю товары…`);

  const H = { 'Client-Id': cab.id, 'Api-Key': cab.key };
  const ids = [];
  let last_id = '';

  for (let page = 1; page <= 100; page++) {
    const data = await post('https://api-seller.ozon.ru/v3/product/list', H, {
      filter: { visibility: 'ALL' }, last_id, limit: 1000
    });
    const items = data?.result?.items || [];
    ids.push(...items);
    say(`  страница ${page}: ${items.length} (всего ${ids.length})`);
    last_id = data?.result?.last_id || '';
    if (!last_id || !items.length) break;
    await sleep(500);
  }

  /* Бренд Ozon в карточке не отдаёт — он лежит в атрибутах, под номером 85.
     Без него марку не отличить: у крем-бустера PixelTap написан только на
     самой баночке, а в названии карточки его нет. Поэтому тянем атрибуты
     отдельным проходом и складываем бренд по product_id. */
  const brandById = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const at = await post('https://api-seller.ozon.ru/v4/product/info/attributes', H, {
        filter: { product_id: chunk.map(x => String(x.product_id)), visibility: 'ALL' },
        limit: 100, sort_dir: 'ASC', last_id: ''
      });
      (at.result || at.items || []).forEach(row => {
        const b = (row.attributes || []).find(a => a.id === 85);
        const v = b?.values?.[0]?.value;
        if (v) brandById.set(String(row.id ?? row.product_id), String(v).trim());
      });
    } catch (e) {
      warn(`Ozon ${cab.name}: атрибуты не получены (${e.message.slice(0, 60)})`);
    }
    await sleep(400);
  }

  // Карточки запрашиваем пачками: длинный список одним запросом не примут.
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const data = await post('https://api-seller.ozon.ru/v3/product/info/list', H, {
      product_id: chunk.map(x => x.product_id).filter(Boolean)
    });
    const items = data?.items || data?.result?.items || [];
    out.push(...items);
    await sleep(500);
  }

  return out.map(p => {
    // Ссылка собирается по SKU; в разных версиях ответа он лежит по-разному.
    const sku = p.sku || p.sources?.find(s => s.sku)?.sku || '';
    return {
      source: 'ozon',
      cabinet: cab.name,
      brand: brandById.get(String(p.id ?? p.product_id)) || '',
      article: String(p.offer_id || '').trim(),
      name: String(p.name || '').trim(),
      img: p.primary_image || p.images?.[0]?.file_name || p.images?.[0] || '',
      ozon: sku ? `https://www.ozon.ru/product/${sku}/` : '',
      volume: ''
    };
  });
}

/* ---------- марка ---------- */

/* Одну и ту же марку в кабинетах пишут по-разному: Pixeltap, Pixel Tap,
   PixelTap Beauty, PixelTap ic. Хуже того — попадаются написания
   с русскими буквами внутри латинского слова: «PixelТap» через русскую Т
   и «PixelTaр» через русскую р. На вид не отличить, а сравнение строк
   их не ловит. Поэтому сначала подменяем похожие кириллические буквы
   латинскими, затем убираем всё, кроме букв, и уже потом сравниваем. */
const LOOKALIKE = { 'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y',
                    'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O',
                    'Р':'P','С':'C','Т':'T','Х':'X','У':'Y' };

function brandKey(raw) {
  const s = String(raw || '').replace(/[а-яёА-ЯЁ]/g, ch => LOOKALIKE[ch] || ch);
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Что считаем своей маркой. Всё остальное — чужие товары в том же кабинете.
const OWN = ['pixeltap'];

function isOwnBrand(raw) {
  const k = brandKey(raw);
  return OWN.some(o => k.startsWith(o));
}

/* ---------- раскладка по ритуалу ---------- */

// Шаг и время определяем по названию. Это догадка, а не истина:
// правки закрепляются в tools/catalog-overrides.json и переживают
// следующую выгрузку.
const RULES = [
  [/интимн/i,                                          'Интимная гигиена'],
  [/подгузник|детск|малыш|для купания/i,               'Детская серия'],
  [/ланолин|для сосков/i,                              'Ланолин'],
  [/бров|ресниц|ламинир|перманент|тату|хна/i,          'Брови и ресницы'],
  [/ногт|кутикул/i,                                    'Ногти'],
  [/волос|бород|шампун|термозащит|локон|кожи головы/i, 'Волосы'],
  [/карбокситерап/i,                                   'Карбокситерапия'],
  [/пилинг|энзимн|скраб|чистки лица|пудра для умыв/i,  'Пилинги'],
  [/сыворотк|ретинол|пептид|витамин\s*c/i,             'Сыворотки'],
  [/умыван|гидрофильн|мицелляр|пенк/i,                 'Умывание'],
  [/душа|для тела|массаж|молочко|для ног|мочевин|дезодор/i, 'Тело'],
  [/крем|бальзам|маск|патч|тоник|увлажн|губ/i,         'Лицо и губы']
];

// Время суток по названию больше не угадываем: в каталоге и гели для душа,
// и детская серия, и ламинирование бровей — «утро/вечер» к ним не применимо.
function classify(name) {
  for (const [re, step] of RULES) if (re.test(name)) return { step, phase: 'both' };
  return { step: 'Разное', phase: 'both' };
}



/* ---------- сборка ---------- */

function merge(wb, ozon) {
  const map = new Map();

  const put = (item) => {
    // Один товар на двух площадках — это одна строка на сайте.
    // Склеиваем по артикулу продавца: vendorCode у WB, offer_id у Ozon.
    const key = item.article ? 'a:' + item.article.toLowerCase()
                             : 'n:' + item.name.toLowerCase();
    const cur = map.get(key) || { name: '', volume: '', img: '', ozon: '', wb: '', brand: '', cabinet: '' };
    map.set(key, {
      brand:  cur.brand  || item.brand || '',
      cabinet: cur.cabinet || item.cabinet || '',
      name:   cur.name   || item.name,
      volume: cur.volume || item.volume || '',
      img:    cur.img    || item.img || '',
      ozon:   cur.ozon   || item.ozon || '',
      wb:     cur.wb     || item.wb || '',
      article: item.article || cur.article || ''
    });
  };

  wb.forEach(put);
  ozon.forEach(put);

  return [...map.values()]
    .filter(p => p.name)
    .map(p => {
      const { step, phase } = classify(p.name);
      return {
        step, phase,
        brand: p.brand || '',
        own: isOwnBrand(p.brand),
        cabinet: p.cabinet || '',
        name: p.name,
        volume: p.volume,
        desc: '',                 // описание пишется руками, см. ниже
        ozon: p.ozon,
        wb: p.wb,
        img: p.img,
        article: p.article
      };
    });
}

// Ручные правки важнее автоматики: описания, порядок, исправленный шаг.
async function applyOverrides(list) {
  let ov = {};
  try {
    ov = JSON.parse(await readFile('tools/catalog-overrides.json', 'utf8'));
  } catch { return list; }

  const byArticle = ov.byArticle || {};
  list.forEach(p => {
    const patch = byArticle[p.article];
    if (patch) Object.assign(p, patch);
  });

  if (Array.isArray(ov.order) && ov.order.length) {
    const rank = a => { const i = ov.order.indexOf(a); return i < 0 ? 999 : i; };
    list.sort((a, b) => rank(a.article) - rank(b.article));
  }
  return list;
}

/* ---------- запуск ---------- */

async function main() {
  const cab = await loadCabinets();
  if (!cab.wb.length && !cab.ozon.length) {
    console.error('Ключей не найдено. Положите env.txt рядом с папкой сайта');
    console.error('или задайте WB_TOKEN / OZON_CLIENT_ID + OZON_API_KEY.');
    exit(1);
  }
  say(`Кабинетов: Ozon ${cab.ozon.length}, WB ${cab.wb.length}\n`);

  // Кабинеты обходим по очереди и по отдельности: упавший не должен
  // утаскивать за собой те, что ответили. Связь здесь рвётся регулярно.
  const wb = [], ozon = [];
  for (const c of cab.ozon) {
    try { ozon.push(...await fetchOzon(c)); }
    catch (e) { warn(`Ozon ${c.name}: ${e.message}`); }
  }
  for (const c of cab.wb) {
    try { wb.push(...await fetchWB(c)); }
    catch (e) { warn(`WB ${c.name}: ${e.message}`); }
  }

  if (!wb.length && !ozon.length) {
    console.error('\nНи один кабинет ничего не отдал. products.json не тронут.');
    exit(2);
  }

  let list = await applyOverrides(merge(wb, ozon));

  /* Связь рвётся, и часть кабинетов может не ответить. Если бы мы просто
     перезаписывали файл, каждый неудачный запуск стирал бы товары, которые
     удалось получить в прошлый раз. Поэтому свежая выгрузка накладывается
     на прежнюю: новое побеждает, недостающее сохраняется. */
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    if (Array.isArray(prev) && prev.length && !prev.some(x => x.placeholder)) {
      const key = x => (x.article || x.name || '').toLowerCase();
      const byKey = new Map(prev.map(x => [key(x), x]));
      list.forEach(x => byKey.set(key(x), x));
      const merged = [...byKey.values()];
      if (merged.length > list.length)
        say(`Из прошлой выгрузки сохранено ещё ${merged.length - list.length}`);
      list = merged;
    }
  } catch { /* прошлой выгрузки нет — пишем как есть */ }

  say(`\nWB: ${wb.length} · Ozon: ${ozon.length} · после склейки: ${list.length}`);
  const noDesc = list.filter(p => !p.desc).length;
  if (noDesc) say(`Без описания: ${noDesc} — допишите в tools/catalog-overrides.json`);
  const noImg = list.filter(p => !p.img).length;
  if (noImg) say(`Без фото: ${noImg}`);

  const own = list.filter(p => p.own).length;
  const alien = list.filter(p => p.brand && !p.own);
  say(`Своя марка: ${own} · чужих: ${alien.length} · марка не указана: ${list.filter(p => !p.brand).length}`);
  if (alien.length) {
    const names = [...new Set(alien.map(p => p.brand))];
    say(`Чужие марки в кабинетах: ${names.join(', ')}`);
  }

  if (DRY) {
    say('\n--dry: файл не тронут. Первые три позиции:');
    say(JSON.stringify(list.slice(0, 3), null, 2));
    return;
  }

  await writeFile(OUT, JSON.stringify(list, null, 2) + '\n', 'utf8');
  say(`\nЗаписано: ${OUT} (${list.length} позиций)`);
  say('Плашка «каталог в наполнении» исчезнет сама: в выгрузке нет placeholder.');
}

main().catch(e => { console.error('\nОшибка:', e.message); exit(1); });
