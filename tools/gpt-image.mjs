#!/usr/bin/env node
/* Сцена через OpenAI. Отличие от локального генератора: сюда можно
 * приложить фотографии настоящих товаров, и модель впишет их в кадр
 * узнаваемыми, а не выдумает похожие. Ключ читается из env.txt рядом
 * с папкой сайта и в саму папку не попадает.
 *
 *   node tools/gpt-image.mjs --prompt "..." --out img/scene.png --ref img/prod/a.png
 */

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const refs = argv.reduce((a, v, i) => (v === '--ref' && argv[i + 1] ? [...a, argv[i + 1]] : a), []);

const PROMPT = arg('prompt') || (arg('prompt-file') ? await readFile(arg('prompt-file'), 'utf8') : null);
const OUT    = arg('out');
const SIZE   = arg('size', '1536x1024');
const MODEL  = arg('model', 'gpt-image-1');
/* Качество по умолчанию у модели не максимальное — без этого параметра
   кадр приходит мягким, детали предметов и надписи на этикетках
   расплываются. Для сцены с узнаваемым товаром это критично. */
const QUALITY = arg('quality', 'high');
/* Насколько точно держаться приложенных образцов. При low модель
   считает их «вдохновением» и рисует похожие, но свои предметы;
   при high переносит форму и этикетку почти буквально. */
const FIDELITY = arg('fidelity', 'high');

if (!PROMPT || !OUT) { console.error('Нужны --prompt (или --prompt-file) и --out'); exit(1); }

async function key() {
  for (const p of ['../env.txt', 'env.txt', '../../env.txt']) {
    try {
      const row = (await readFile(p, 'utf8')).split(/\r?\n/).find(l => /^\s*openai\s*[=:]/i.test(l));
      if (row) return row.slice(row.search(/[=:]/) + 1).trim();
    } catch {}
  }
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  throw new Error('ключ не найден: положите строку openai=sk-... в env.txt рядом с папкой сайта');
}

// Связь до OpenAI здесь рвётся через раз, поэтому повторяем настойчиво.
async function send(url, opts, tries = 8) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      const txt = await r.text();
      if (!r.ok) {
        // Ошибку разбора запроса повторять бессмысленно — она не про связь.
        if (r.status >= 400 && r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
        throw new Error(`HTTP ${r.status}`);
      }
      return JSON.parse(txt);
    } catch (e) {
      last = e;
      if (/HTTP 4\d\d:/.test(e.message)) throw e;
      console.log(`  попытка ${i + 1} не прошла (${(e.cause?.code || e.message).slice(0, 40)})`);
      await new Promise(z => setTimeout(z, 1500 * (i + 1)));
    }
  }
  throw last;
}

const K = await key();
const t0 = Date.now();
let json;

if (refs.length) {
  console.log(`образцов: ${refs.length}, качество ${QUALITY}, точность образца ${FIDELITY}`);
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', PROMPT);
  form.append('size', SIZE);
  form.append('quality', QUALITY);
  form.append('input_fidelity', FIDELITY);
  form.append('n', '1');
  for (const r of refs) {
    const b = await readFile(r);
    form.append('image[]', new Blob([b], { type: 'image/png' }), r.split(/[\\/]/).pop());
  }
  json = await send('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${K}` }, body: form
  });
} else {
  json = await send('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${K}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: PROMPT, size: SIZE, quality: QUALITY, n: 1 })
  });
}

const b64 = json?.data?.[0]?.b64_json;
if (!b64) { console.error('модель не вернула изображение: ' + JSON.stringify(json).slice(0, 300)); exit(2); }

await writeFile(OUT, Buffer.from(b64, 'base64'));
console.log(`готово: ${OUT} — ${Math.round(Buffer.from(b64, 'base64').length / 1024)} КБ за ${Math.round((Date.now() - t0) / 1000)} с`);
