#!/usr/bin/env node
/* Вырезание фона у готового изображения через ComfyUI (BiRefNet).
 *
 * Зачем отдельно от генератора: снимки товаров у нас настоящие, их не
 * надо рисовать — надо снять с них фон, чтобы предмет можно было
 * положить на любую сцену. Модель отдаёт маску «что убрать», поэтому
 * её обязательно инвертируем — иначе получается прозрачный предмет
 * в непрозрачной рамке.
 *
 *   node tools/cutout.mjs вход.png --out выход.png
 */

import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { argv, exit } from 'node:process';
import { basename, join } from 'node:path';

const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const SRC = argv.slice(2).find(a => !a.startsWith('--'));
const OUT = arg('out') || (SRC || '').replace(/\.(png|jpg|jpeg|webp)$/i, '') + '.cut.png';
const HOST = arg('host', '127.0.0.1:8188');
const COMFY = arg('comfy', 'C:/Users/User/ComfyUI');

if (!SRC) { console.error('Укажите файл: node tools/cutout.mjs фото.png'); exit(1); }

const base = `http://${HOST}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(base + path, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(600 * (i + 1));
    }
  }
}

// ComfyUI читает картинки только из своей папки input.
const name = 'cut-' + basename(SRC).replace(/\.[^.]+$/, '') + '.png';
await mkdir(join(COMFY, 'input'), { recursive: true });
await copyFile(SRC, join(COMFY, 'input', name));

const wf = {
  '1': { class_type: 'LoadImage', inputs: { image: name, upload: 'image' } },
  '2': { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: arg('bg', 'birefnet.safetensors') } },
  '3': { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['2', 0], image: ['1', 0] } },
  // Маска приходит в смысле «что убрать»: единица стоит на фоне.
  '4': { class_type: 'InvertMask', inputs: { mask: ['3', 0] } },
  '5': { class_type: 'JoinImageWithAlpha', inputs: { image: ['1', 0], alpha: ['4', 0] } },
  '6': { class_type: 'SaveImage', inputs: { filename_prefix: 'cut', images: ['5', 0] } }
};

try { await api('/system_stats'); }
catch { console.error(`ComfyUI не отвечает на ${base}`); exit(2); }

const res = await api('/prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: wf, client_id: 'cutout-' + Date.now() })
});
const { prompt_id } = await res.json();

let entry = null;
for (let i = 0; i < 180; i++) {
  await sleep(900);
  const h = await (await api('/history/' + prompt_id)).json();
  if (h[prompt_id]) { entry = h[prompt_id]; break; }
}
if (!entry) { console.error('не дождался результата'); exit(3); }

const img = Object.values(entry.outputs || {}).flatMap(o => o.images || [])[0];
if (!img) { console.error('ComfyUI не вернул изображение: ' + JSON.stringify(entry.status || {}).slice(0, 200)); exit(4); }

const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
const bin = Buffer.from(await (await api('/view?' + q)).arrayBuffer());
await writeFile(OUT, bin);
console.log(`вырезано: ${OUT} — ${Math.round(bin.length / 1024)} КБ`);
