#!/usr/bin/env node
/* Генерация изображения на локальной видеокарте через ComfyUI.
 *
 * ПОЧЕМУ ЛОКАЛЬНО, А НЕ ОБЛАКО
 * Ни ключей, ни карты, ни гео-ограничений, ни счёта за каждый кадр.
 * Можно прогнать тридцать вариантов и выбрать один — с облаком так
 * не поэкспериментируешь. Всё считается на RTX 4060 прямо здесь.
 *
 *   node tools/gen-image.mjs --prompt "..." --out img/hero.png
 *
 * Флаги:
 *   --neg "..."      чего не должно быть в кадре
 *   --size 832x1216  размер (кратный 64; по умолчанию 1024x1024)
 *   --steps 25       число шагов
 *   --seed 12345     повторяемость; без него берётся случайное
 *   --model FILE     имя checkpoint-файла, если моделей несколько
 *   --trim           сразу обрезать пустые поля по прозрачности
 *   --host           адрес ComfyUI (по умолчанию 127.0.0.1:8188)
 */

import { writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';
import { spawnSync } from 'node:child_process';

const arg = (n, d = null) => {
  const i = argv.indexOf('--' + n);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = n => argv.includes('--' + n);

const HOST   = arg('host', '127.0.0.1:8188');
const PROMPT = arg('prompt');
const OUT    = arg('out');
const NEG    = arg('neg', 'text, watermark, logo, signature, blurry, lowres, jpeg artifacts, extra limbs, deformed');
const STEPS  = Number(arg('steps', '25'));
const CFG    = Number(arg('cfg', '6.5'));
const SEED   = Number(arg('seed', String(Math.floor(Math.random() * 2 ** 31))));

const [W, H] = (arg('size', '1024x1024').match(/^(\d+)x(\d+)$/) || []).slice(1).map(Number);

if (!PROMPT || !OUT || !W || !H) {
  console.error('Нужны --prompt и --out. Размер вида 1024x1024.');
  exit(1);
}

const base = `http://${HOST}`;

async function api(path, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(base + path, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(z => setTimeout(z, 700 * (i + 1)));
    }
  }
}

// Какая модель загружена — узнаём у самого ComfyUI, а не угадываем.
async function pickModel() {
  const want = arg('model');
  const info = await (await api('/object_info/CheckpointLoaderSimple')).json();
  const list = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
  if (!list.length) throw new Error('в ComfyUI нет ни одной модели — положите файл в models/checkpoints');
  if (want) {
    const hit = list.find(n => n === want || n.includes(want));
    if (!hit) throw new Error(`модель «${want}» не найдена. Есть: ${list.join(', ')}`);
    return hit;
  }
  return list[0];
}

// Граф в том виде, в каком его принимает API: узлы с номерами и связями.
function workflow(model) {
  const g = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: PROMPT, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: NEG,    clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: W, height: H, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: {
             seed: SEED, steps: STEPS, cfg: CFG,
             sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
             model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } }
  };

  if (!has('cutout')) {
    g['7'] = { class_type: 'SaveImage', inputs: { filename_prefix: 'gen', images: ['6', 0] } };
    return g;
  }

  /* Вырезание фона: BiRefNet строит маску объекта, маска становится
     альфа-каналом. На выходе PNG, где вокруг предмета не белый
     прямоугольник, а настоящая прозрачность — только так объект можно
     положить на цветное поле страницы, а не «фотографией в рамке». */
  g['8']  = { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: arg('bg', 'birefnet.safetensors') } };
  g['9']  = { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['8', 0], image: ['6', 0] } };
  /* Маску обязательно перевернуть: RemoveBackground отдаёт её в смысле
     «что убрать», то есть единица стоит на фоне. Подашь как есть —
     получишь ровно наоборот: прозрачный предмет в непрозрачной рамке. */
  g['11'] = { class_type: 'InvertMask', inputs: { mask: ['9', 0] } };
  g['10'] = { class_type: 'JoinImageWithAlpha', inputs: { image: ['6', 0], alpha: ['11', 0] } };
  g['7']  = { class_type: 'SaveImage', inputs: { filename_prefix: 'gen', images: ['10', 0] } };
  return g;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // Проверяем, что сервер вообще поднят: иначе ошибка была бы невнятной.
  try { await api('/system_stats'); }
  catch {
    console.error(`ComfyUI не отвечает на ${base}.`);
    console.error('Запустите его: ComfyUI\\venv\\Scripts\\python.exe main.py');
    exit(2);
  }

  const model = await pickModel();
  console.log(`модель: ${model}`);
  console.log(`кадр: ${W}×${H}, шагов ${STEPS}, seed ${SEED}`);

  const client_id = 'pixeltap-' + SEED;
  const res = await api('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow(model), client_id })
  });
  const { prompt_id } = await res.json();

  // Ждём готовности, опрашивая историю. Прогресс печатаем, чтобы
  // было видно, что счёт идёт, а не всё зависло.
  const t0 = Date.now();
  let entry = null;
  for (let i = 0; i < 600; i++) {
    await sleep(1000);
    const hist = await (await api('/history/' + prompt_id)).json();
    if (hist[prompt_id]) { entry = hist[prompt_id]; break; }
    if (i % 5 === 4) process.stdout.write(`  считаю… ${Math.round((Date.now() - t0) / 1000)} с\r`);
  }
  if (!entry) { console.error('\nне дождался результата'); exit(3); }

  const imgs = Object.values(entry.outputs || {}).flatMap(o => o.images || []);
  if (!imgs.length) { console.error('\nComfyUI не вернул изображение'); exit(4); }

  const im = imgs[0];
  const q = new URLSearchParams({ filename: im.filename, subfolder: im.subfolder || '', type: im.type || 'output' });
  const bin = Buffer.from(await (await api('/view?' + q)).arrayBuffer());
  await writeFile(OUT, bin);

  console.log(`\nготово: ${OUT} — ${Math.round(bin.length / 1024)} КБ, ${Math.round((Date.now() - t0) / 1000)} с`);

  if (has('trim')) {
    const r = spawnSync(process.execPath, ['tools/img-trim.mjs', OUT, '--out', OUT], { encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
  }
}

main().catch(e => { console.error('\nОшибка: ' + e.message); exit(1); });
