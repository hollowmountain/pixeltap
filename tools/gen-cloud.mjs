#!/usr/bin/env node
/* Генерация крупных сцен через gpt-image (OpenAI).
 *
 * ЗАЧЕМ ДВА ГЕНЕРАТОРА
 * gen-image.mjs считает на своей видеокарте: бесплатно и быстро, годится
 * для мелочи, которой нужно много. Этот ходит в облако: дороже и медленнее,
 * зато точнее держит сложный замысел — «баночка на камне, вокруг цветы,
 * свет сбоку» он соберёт как просили, а локальная модель разложит по-своему.
 * Поэтому: крупные сцены сюда, мелкий декор — туда.
 *
 *   node tools/gen-cloud.mjs --prompt "..." --out img/hero.png
 *
 * Флаги:
 *   --size 1536x1024   размер (1024x1024 | 1536x1024 | 1024x1536)
 *   --quality high     low | medium | high
 *   --clear            прозрачный фон вместо залитого
 *   --trim             сразу обрезать пустые поля
 *   --ref FILE         снимок-образец; можно повторить несколько раз —
 *                      тогда модель собирает сцену из ваших предметов,
 *                      а не выдумывает похожие
 *
 * Ключ берётся из env.txt рядом с папкой сайта или из OPENAI_API_KEY.
 * Каждый кадр стоит денег на счету владельца ключа — печатаем это перед
 * запросом, чтобы трата никогда не была неожиданной.
 */

import { writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argv, env, exit } from 'node:process';
import { spawnSync } from 'node:child_process';

const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = n => argv.includes('--' + n);

const PROMPT  = arg('prompt');
const OUT     = arg('out');
const SIZE    = arg('size', '1024x1024');
const QUALITY = arg('quality', 'high');
const MODEL   = arg('model', 'gpt-image-2');

if (!PROMPT || !OUT) {
  console.error('Нужны --prompt и --out.');
  exit(1);
}

/* Файл ключей важнее переменной окружения — и это не вкусовщина.
   В окружении уже лежит чужой OPENAI_API_KEY, который приехал вместе
   со сторонним скиллом и давно мёртв; если читать окружение первым,
   запрос уходит с ним и возвращается 401 при полностью рабочем ключе
   в env.txt. Поэтому сначала файл, окружение — только как запасной путь. */
async function loadKey() {
  for (const path of [arg('env', '../env.txt'), 'env.txt', '../../env.txt']) {
    try {
      const raw = await readFile(path, 'utf8');
      const row = raw.split(/\r?\n/).find(l => /^\s*openai/i.test(l));
      if (row) {
        const val = row.slice(row.indexOf('=') + 1).trim();
        if (val) return val;
      }
    } catch { /* ищем дальше */ }
  }
  return env.OPENAI_API_KEY || null;
}

const key = await loadKey();
if (!key) {
  console.error('Ключ OpenAI не найден: положите строку openai=sk-... в env.txt рядом с папкой сайта.');
  exit(1);
}

const body = {
  model: MODEL,
  prompt: PROMPT,
  size: SIZE,
  quality: QUALITY,
  n: 1
};
// Прозрачный фон поддерживает только PNG: с jpeg альфа-канал теряется.
if (has('clear')) { body.background = 'transparent'; body.output_format = 'png'; }

console.log(`модель: ${MODEL}, кадр ${SIZE}, качество ${QUALITY}${has('clear') ? ', прозрачный фон' : ''}`);
console.log('это платный запрос — списывается со счёта владельца ключа');

const t0 = Date.now();

/* Запрос уходит через curl, а не через fetch.
   Генерация занимает десятки секунд, и на таком долгом соединении
   встроенный fetch здесь стабильно рвётся с ECONNRESET — проверено:
   лёгкий запрос к /v1/models проходит, а генерация падала пять раз
   подряд. curl то же самое делает с первой попытки: он умеет держать
   соединение и повторять сам. */
const reqFile = join(tmpdir(), `gen-req-${process.pid}.json`);
const resFile = join(tmpdir(), `gen-res-${process.pid}.json`);
await writeFile(reqFile, JSON.stringify(body), 'utf8');

/* Образцы. Если они заданы, идём в ветку редактирования: модель берёт
   наши настоящие флаконы и вписывает их в сцену со своим светом и
   тенями. Без образцов она нарисует похожие, но чужие предметы —
   для витрины бренда это не годится. */
const refs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--ref' && argv[i + 1] && !argv[i + 1].startsWith('--')) refs.push(argv[i + 1]);
}

const curlArgs = refs.length
  ? [
      '-sS', '--max-time', '900', '--connect-timeout', '30',
      '--retry', '5', '--retry-delay', '4', '--retry-all-errors',
      '-X', 'POST', 'https://api.openai.com/v1/images/edits',
      '-H', `Authorization: Bearer ${key}`,
      '-F', `model=${MODEL}`,
      '-F', `prompt=${PROMPT}`,
      '-F', `size=${SIZE}`,
      '-F', `quality=${QUALITY}`,
      '-F', 'n=1',
      ...refs.flatMap(f => ['-F', `image[]=@${f}`]),
      '-o', resFile,
      '-w', '%{http_code}'
    ]
  : [
      '-sS', '--max-time', '900', '--connect-timeout', '30',
      '--retry', '5', '--retry-delay', '4', '--retry-all-errors',
      '-X', 'POST', 'https://api.openai.com/v1/images/generations',
      '-H', `Authorization: Bearer ${key}`,
      '-H', 'Content-Type: application/json',
      '-d', `@${reqFile}`,
      '-o', resFile,
      '-w', '%{http_code}'
    ];

if (refs.length) console.log(`образцов: ${refs.length} — сцена собирается из них`);
const curl = spawnSync('curl', curlArgs, { encoding: 'utf8' });

await rm(reqFile, { force: true });

if (curl.error) { console.error('curl не запустился: ' + curl.error.message); exit(2); }
const code = (curl.stdout || '').trim();
if (code !== '200') {
  let detail = '';
  try { detail = (await readFile(resFile, 'utf8')).slice(0, 300); } catch {}
  await rm(resFile, { force: true });
  console.error(`API ${code || '—'}: ${detail || curl.stderr || 'ответ пустой'}`);
  exit(3);
}

let json;
try { json = JSON.parse(await readFile(resFile, 'utf8')); }
catch (e) { console.error('ответ не разобрался: ' + e.message); exit(3); }
await rm(resFile, { force: true });


const b64 = json?.data?.[0]?.b64_json;
if (!b64) { console.error('в ответе нет изображения'); exit(4); }

const bin = Buffer.from(b64, 'base64');
await writeFile(OUT, bin);
console.log(`готово: ${OUT} — ${Math.round(bin.length / 1024)} КБ, ${Math.round((Date.now() - t0) / 1000)} с`);

// Замысел остаётся рядом с файлом: через месяц будет видно, чем он сделан.
await writeFile(OUT + '.json', JSON.stringify({
  prompt: PROMPT, model: MODEL, size: SIZE, quality: QUALITY,
  transparent: has('clear'), createdAt: new Date().toISOString()
}, null, 2));

if (has('trim')) {
  const r = spawnSync(process.execPath, ['tools/img-trim.mjs', OUT, '--out', OUT], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
}
