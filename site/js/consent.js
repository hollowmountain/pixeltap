/* Яндекс Метрика — только после согласия.
   Файл подключается сборкой, лишь когда в tools/site-config.json задан
   номер счётчика. До «Разрешить» на страницу не уходит ни одного запроса
   к mc.yandex.ru; «Отказаться» запоминается, и окно больше не мешает.
   Передумать можно по кнопке «Настройки cookie» в подвале. */
(() => {
  'use strict';

  const meta = document.querySelector('meta[name="pt-metrika"]');
  const ID = meta ? Number(meta.content) : 0;
  if (!ID) return;

  const KEY = 'pt-consent';
  const box = document.getElementById('consent');

  const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { /* приватный режим */ } };

  let loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.appendChild(s);
    window.ym(ID, 'init', { clickmap: false, trackLinks: true, accurateTrackBounce: true, webvisor: false });
  }

  // Удаляем cookie Метрики при отказе: согласие отозвано — следов не оставляем.
  function forget() {
    const names = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n.startsWith('_ym'));
    const host = location.hostname;
    names.forEach((n) => {
      document.cookie = `${n}=; Max-Age=0; path=/`;
      document.cookie = `${n}=; Max-Age=0; path=/; domain=.${host}`;
    });
  }

  function show() { if (box) box.hidden = false; }
  function hide() { if (box) box.hidden = true; }

  if (box) {
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-consent]');
      if (!b) return;
      const yes = b.dataset.consent === 'yes';
      const was = read();
      write(yes ? 'yes' : 'no');
      hide();
      if (yes) load();
      else if (was === 'yes') { forget(); location.reload(); }
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-consent-open]')) show();
  });

  // Цели: клики по кнопкам площадок. site.js шлёт событие, мы передаём
  // его в счётчик, только если счётчик разрешён и загружен.
  document.addEventListener('pt:goal', (e) => {
    if (!loaded || !window.ym) return;
    const d = e.detail || {};
    window.ym(ID, 'reachGoal', d.goal === 'buy' ? 'buy_click' : 'store_click', { market: d.market, line: d.line, place: d.place });
  });

  const state = read();
  if (state === 'yes') load();
  else if (state !== 'no') show();
})();
