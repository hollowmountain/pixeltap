#!/usr/bin/env node
/* Обрезка PNG по прозрачности + отчёт о том, есть ли она вообще.
 *
 * ЗАЧЕМ
 * Генераторы отдают прямоугольный кадр. Чтобы объект встал на страницу
 * не «фотографией в рамке», а вещью на поле, нужны две вещи:
 *   1) прозрачный фон вокруг объекта (это заказывается при генерации);
 *   2) снятые пустые поля, иначе объект болтается в середине кадра
 *      и его нельзя прижать к краю или посадить в сетку.
 * Второе делает этот скрипт.
 *
 * Работает на чистом Node: PNG распаковывается встроенным zlib, никаких
 * зависимостей ставить не нужно.
 *
 *   node tools/img-trim.mjs вход.png [--out выход.png] [--pad 12] [--check]
 *
 *   --check   только сказать, есть ли прозрачность, ничего не писать
 *   --pad N   оставить N пикселей поля вокруг объекта
 *   --alpha N порог прозрачности 0..255 (по умолчанию 8)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { argv, exit } from 'node:process';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function arg(name, def = null) {
  const i = argv.indexOf('--' + name);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const has = name => argv.includes('--' + name);

/* ---------- разбор PNG ---------- */

function readPNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('это не PNG');

  let pos = 8, ihdr = null;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);

    if (type === 'IHDR') {
      ihdr = {
        width:  data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth:  data[8],
        color:  data[9],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;

    pos += 12 + len;                       // длина + тип + данные + CRC
  }

  if (!ihdr) throw new Error('нет заголовка IHDR');
  if (ihdr.depth !== 8) throw new Error(`поддерживается только 8 бит на канал (здесь ${ihdr.depth})`);
  if (ihdr.interlace) throw new Error('чересстрочный PNG не поддерживается');

  // 6 = RGBA, 2 = RGB, 4 = серый с альфой, 0 = серый
  const CH = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.color];
  if (!CH) throw new Error(`палитровый PNG не поддерживается (тип ${ihdr.color})`);

  const raw = inflateSync(Buffer.concat(idat));
  const { width: W, height: H } = ihdr;
  const stride = W * CH;
  const out = Buffer.alloc(H * stride);

  // Снятие построчных фильтров PNG. Каждая строка начинается байтом фильтра.
  let src = 0;
  for (let y = 0; y < H; y++) {
    const ft = raw[src++];
    const line = raw.subarray(src, src + stride); src += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= CH ? cur[x - CH] : 0;          // левый
      const b = prev ? prev[x] : 0;                 // верхний
      const c = (prev && x >= CH) ? prev[x - CH] : 0; // верхний левый
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {                          // Paeth
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }

  return { ...ihdr, channels: CH, pixels: out };
}

/* ---------- сборка PNG ---------- */

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function writePNG(W, H, CH, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[CH];
  const stride = W * CH;

  // Пишем без предсказания (фильтр 0): и проще, и для картинок
  // с большими прозрачными полями почти не проигрывает в размере.
  const raw = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- обрезка ---------- */

function alphaBounds(img, threshold) {
  const { width: W, height: H, channels: CH, pixels } = img;
  if (CH !== 4 && CH !== 2) return null;          // альфы нет вовсе
  const aOff = CH - 1;

  let minX = W, minY = H, maxX = -1, maxY = -1, opaque = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (pixels[(y * W + x) * CH + aOff] > threshold) {
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;                      // всё прозрачное
  return { minX, minY, maxX, maxY, opaque, total: W * H };
}

function crop(img, box) {
  const { channels: CH, pixels, width: W } = img;
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const out = Buffer.alloc(w * h * CH);
  for (let y = 0; y < h; y++) {
    const from = ((box.minY + y) * W + box.minX) * CH;
    pixels.copy(out, y * w * CH, from, from + w * CH);
  }
  return { width: w, height: h, channels: CH, pixels: out };
}

/* ---------- запуск ---------- */

const file = argv.slice(2).find(a => !a.startsWith('--'));
if (!file) {
  console.error('Укажите файл: node tools/img-trim.mjs картинка.png');
  exit(1);
}

let img;
try { img = readPNG(readFileSync(file)); }
catch (e) { console.error('Не читается: ' + e.message); exit(1); }

const CHNAME = { 1: 'серый', 2: 'серый+альфа', 3: 'RGB', 4: 'RGBA' }[img.channels];
console.log(`${file}: ${img.width}×${img.height}, ${CHNAME}`);

const threshold = Number(arg('alpha', '8'));
const box = alphaBounds(img, threshold);

if (!box) {
  console.log('Прозрачности нет — обрезать не по чему.');
  console.log('Заказывайте генерацию с прозрачным фоном, иначе объект');
  console.log('приедет в прямоугольнике и его придётся резать маской в CSS.');
  exit(has('check') ? 0 : 3);
}

const fill = (100 * box.opaque / box.total).toFixed(1);
console.log(`Прозрачность есть. Объект занимает ${fill}% кадра.`);
console.log(`Границы объекта: x ${box.minX}…${box.maxX}, y ${box.minY}…${box.maxY}`);

if (has('check')) exit(0);

// Поле вокруг объекта — чтобы тень или свечение не срезало по живому.
const pad = Number(arg('pad', '0'));
if (pad) {
  box.minX = Math.max(0, box.minX - pad);
  box.minY = Math.max(0, box.minY - pad);
  box.maxX = Math.min(img.width - 1, box.maxX + pad);
  box.maxY = Math.min(img.height - 1, box.maxY + pad);
}

const cropped = crop(img, box);
const out = arg('out') || file.replace(/\.png$/i, '') + '.trim.png';
writeFileSync(out, writePNG(cropped.width, cropped.height, cropped.channels, cropped.pixels));

const saved = 100 - (100 * cropped.width * cropped.height) / (img.width * img.height);
console.log(`Обрезано: ${out} — ${cropped.width}×${cropped.height} (площадь меньше на ${saved.toFixed(0)}%)`);
