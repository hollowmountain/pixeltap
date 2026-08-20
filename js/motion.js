/* Движение страницы.
   Три вещи, и каждая привязана к смыслу, а не к «оживить»:
   1) первый экран собирается из строк, пока грузится полотно;
   2) сетка курса заполняется по мере прокрутки — курс копится на глазах;
   3) секции проявляются один раз при первом показе.
   При prefers-reduced-motion всё это выключается, а состояние остаётся
   конечным: текст виден, сетка заполнена. */
(() => {
  'use strict';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io = 'IntersectionObserver' in window;

  /* ---------- 1. сбор первого экрана ---------- */

  function revealHero() {
    const lines = document.querySelectorAll('.claim-line');
    if (reduced) { lines.forEach(l => l.classList.add('in')); document.body.classList.add('lit'); return; }
    lines.forEach((l, i) => setTimeout(() => l.classList.add('in'), 90 + i * 105));
    setTimeout(() => document.body.classList.add('lit'), 90 + lines.length * 105);
  }

  /* ---------- 2. сетка заполняется по прокрутке ---------- */

  // Клетки зажигаются не разом, а по мере того, как блок проходит экран:
  // прокрутка буквально отсчитывает дни курса.
  function bindGridToScroll() {
    const grid = document.getElementById('grid');
    if (!grid) return;
    const cells = [...grid.querySelectorAll('.cell')];
    if (!cells.length) return;

    const marked = cells.filter(c => c.dataset.state === 'done' || c.dataset.state === 'today');

    if (reduced || !io) { marked.forEach(c => c.classList.add('lit')); return; }

    let ticking = false;
    function update() {
      ticking = false;
      const r = grid.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 — блок только показался снизу, 1 — дошёл до верхней трети
      const p = Math.min(1, Math.max(0, (vh - r.top - vh * 0.18) / (vh * 0.62)));
      const n = Math.round(p * marked.length);
      marked.forEach((c, i) => c.classList.toggle('lit', i < n));
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    update();
  }

  /* ---------- 3. проявление секций ---------- */

  function bindReveals() {
    const items = document.querySelectorAll('[data-rise]');
    if (reduced || !io) { items.forEach(el => el.classList.add('in')); return; }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const d = Number(el.dataset.rise) || 0;
        setTimeout(() => el.classList.add('in'), d);
        obs.unobserve(el);
      });
    /* Порог именно нулевой. Доля площади здесь не годится: каталог выше
       экрана в двадцать раз, и «показалось 5% блока» для него недостижимо
       в принципе — блок не проявился бы никогда. Достаточно, что край
       вошёл в кадр. */
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    items.forEach(el => obs.observe(el));
  }

  /* ---------- 4. параллакс первого экрана ---------- */

  // Полотно уходит вниз медленнее текста — экран расслаивается по глубине.
  function bindParallax() {
    const hero = document.querySelector('.hero');
    const layer = document.querySelector('.hero-canvas');
    if (reduced || !hero || !layer) return;
    let ticking = false;
    function update() {
      ticking = false;
      const y = window.scrollY;
      if (y > window.innerHeight * 1.2) return;
      layer.style.transform = `translate3d(0, ${y * 0.22}px, 0)`;
      const say = hero.querySelector('.hero-say');
      if (say) {
        say.style.transform = `translate3d(0, ${y * -0.06}px, 0)`;
        say.style.opacity = String(Math.max(0, 1 - y / (window.innerHeight * 0.75)));
      }
    }
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* ---------- 5. заголовки секций собираются по словам ---------- */

  // Разбиваем на слова здесь, а не в разметке: текст остаётся цельным
  // для копирования, поиска и скринридера, а маски получает только показ.
  function splitHeadings() {
    document.querySelectorAll('[data-split]').forEach(h => {
      if (h.dataset.splitDone) return;
      const words = h.textContent.trim().split(/\s+/);
      h.textContent = '';
      words.forEach((w, i) => {
        const mask = document.createElement('span');
        mask.className = 'word';
        const inner = document.createElement('span');
        inner.textContent = w;
        inner.style.transitionDelay = (i * 55) + 'ms';
        mask.appendChild(inner);
        h.appendChild(mask);
        if (i < words.length - 1) h.appendChild(document.createTextNode(' '));
      });
      h.dataset.splitDone = '1';
    });

    const heads = document.querySelectorAll('[data-split]');
    if (reduced || !io) { heads.forEach(h => h.classList.add('in')); return; }
    const obs = new IntersectionObserver((es) => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0 });
    heads.forEach(h => obs.observe(h));
  }

  /* ---------- 6. счётчик дней ---------- */

  // Число досчитывает до 28, когда секция показалась: длительность курса
  // должна ощущаться сроком, а не просто стоять цифрой.
  function bindCounter() {
    const el = document.querySelector('[data-count]');
    if (!el) return;
    const to = Number(el.dataset.count) || 28;
    if (reduced || !io) { el.textContent = String(to); return; }
    const obs = new IntersectionObserver((es) => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        obs.unobserve(e.target);
        const dur = 900, t0 = performance.now();
        (function step(now) {
          const p = Math.min(1, (now - t0) / dur);
          // ease-out-quart: быстрый старт, мягкая остановка на числе
          el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 4))));
          if (p < 1) requestAnimationFrame(step);
        })(t0);
      });
    }, { threshold: 0.4 });
    obs.observe(el);
  }

  /* ---------- 7. каскад строк каталога и шагов ---------- */

  // Списки строятся скриптом и перестраиваются при смене фазы или фильтра,
  // поэтому задержки назначаем после каждой перестройки.
  function stagger(container, sel) {
    const box = document.querySelector(container);
    if (!box) return;
    const items = box.querySelectorAll(sel);
    if (reduced || !io) { items.forEach(i => i.classList.add('in')); return; }
    items.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i * 45, 320) + 'ms';
      el.classList.remove('in');
    });
    const obs = new IntersectionObserver((es) => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    items.forEach(el => obs.observe(el));
  }

  function bindLists() {
    // #rows намеренно не анимируем — см. пояснение в site.css.
    stagger('#steps', '.step');
  }

  /* ---------- 8. отклик кнопки ---------- */

  // Магнит (кнопка тянется к курсору) здесь был ошибкой: элементы выезжали
  // за свои рамки и наезжали друг на друга — особенно в переключателе,
  // где два сегмента стоят в общей рамке вплотную. Да и сам эффект чужой
  // этому миру: у бланка прямые углы и жёсткая разлиновка, ничего не плавает.
  // Отклик оставлен там, где он ничего не смещает, — в CSS.

  /* ---------- 9. ботанический слой ---------- */

  // Цветы проявляются, когда доходят до экрана, качаются каждый в своём
  // темпе и уходят вверх медленнее страницы. Темпы намеренно не кратны
  // друг другу: с кратными периодами слой начинает «дышать» строем.
  function bindDeco() {
    const items = [...document.querySelectorAll('.dec')];
    if (!items.length) return;

    const DUR = [8.5, 11, 9.4, 12.5, 10.2, 13, 9, 11.8];
    items.forEach((el, i) => {
      el.style.setProperty('--dur', DUR[i % DUR.length] + 's');
      el.style.setProperty('--delay', (-i * 1.7).toFixed(1) + 's');
    });

    if (reduced) { items.forEach(el => el.classList.add('in')); return; }
    items.forEach(el => el.classList.add('live'));

    if (io) {
      const obs = new IntersectionObserver((es) => {
        es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -5% 0px', threshold: 0 });
      items.forEach(el => obs.observe(el));
    } else {
      items.forEach(el => el.classList.add('in'));
    }

    // Параллакс: у каждого свой коэффициент, иначе слой едет плитой.
    const RATE = [0.06, -0.05, 0.09, -0.07, 0.05, -0.09, 0.07, -0.06];
    let ticking = false;
    function update() {
      ticking = false;
      const y = window.scrollY;
      items.forEach((el, i) => {
        el.style.setProperty('--dy', (y * RATE[i % RATE.length]).toFixed(1) + 'px');
      });
    }
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* ---------- запуск ---------- */

  function start() {
    bindDeco();
    revealHero();
    bindGridToScroll();
    bindReveals();
    bindParallax();
    splitHeadings();
    bindCounter();
    bindLists();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  // Сетка строится в site.js; если она появилась позже, перепривязываемся.
  window.addEventListener('grid:ready', bindGridToScroll);
  // Списки перестраиваются при смене фазы и фильтра — каскад назначаем заново.
  window.addEventListener('lists:ready', bindLists);
})();
