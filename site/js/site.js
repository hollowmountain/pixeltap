/* PixelTap — поведение страницы.
   Всё содержимое уже лежит в HTML (каталог собирается при сборке),
   скрипт только помогает: меню, фильтры и поиск, «показать ещё»,
   мягкое проявление блоков. Если он не загрузился, страница целиком
   видна и работает — просто без удобств. */
(() => {
  'use strict';

  const doc = document;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- шапка ---------- */

  const bar = doc.getElementById('bar');
  if (bar) {
    const onScroll = () => bar.classList.toggle('is-stuck', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const btn = bar.querySelector('.menu-btn');
    const nav = doc.getElementById('nav');
    if (btn && nav) {
      const setOpen = (open) => {
        bar.classList.toggle('menu-open', open);
        btn.setAttribute('aria-expanded', String(open));
        // При открытии фокус — на первый пункт: иначе Tab уводит под меню.
        if (open) { const first = nav.querySelector('a'); if (first) first.focus(); }
      };
      btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));
      // Фокус ушёл за пределы шапки — меню закрываем, чтобы не висело поверх.
      bar.addEventListener('focusout', (e) => {
        if (bar.classList.contains('menu-open') && e.relatedTarget && !bar.contains(e.relatedTarget)) setOpen(false);
      });
      nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
      doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && bar.classList.contains('menu-open')) { setOpen(false); btn.focus(); }
      });
      doc.addEventListener('click', (e) => {
        if (bar.classList.contains('menu-open') && !bar.contains(e.target)) setOpen(false);
      });
      matchMedia('(min-width: 961px)').addEventListener('change', (m) => { if (m.matches) setOpen(false); });
    }
  }

  /* ---------- каталог ---------- */

  const PAGE = 15;  // делится на 5 и на 3 — последний ряд не полупустой
  const grid = doc.getElementById('cards');
  const chipsBox = doc.querySelector('.chips');
  const q = doc.getElementById('q');
  const more = doc.getElementById('more');
  const moreN = doc.getElementById('more-n');
  const empty = doc.getElementById('cat-empty');
  const status = doc.getElementById('cat-status');

  // «ё» и «е» для поиска одно и то же; регистр не важен.
  const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  if (grid && chipsBox) {
    const cards = [...grid.querySelectorAll('.card')];
    const chips = [...chipsBox.querySelectorAll('.chip')];
    const hay = cards.map((c) => norm(c.dataset.search || c.textContent));
    let line = 'all';
    let shown = PAGE;

    const plural = (n, one, few, many) => {
      const m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return one;
      if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
      return many;
    };

    let announce;
    function say(text, now) {
      if (!status) return;
      clearTimeout(announce);
      // Диктору — итог, а не каждую букву поиска.
      announce = setTimeout(() => { status.textContent = text; }, now ? 0 : 600);
    }

    function render(keepFocus, quiet) {
      const words = norm(q && q.value).split(' ').filter(Boolean);
      const match = cards.map((c, i) =>
        (line === 'all' || c.dataset.line === line) &&
        words.every((w) => hay[i].includes(w)));
      const total = match.filter(Boolean).length;
      // Всю ленту режем только в общем виде: внутри линейки и при поиске
      // совпадений немного, прятать их незачем.
      const limit = (line === 'all' && !words.length) ? shown : Infinity;
      let seen = 0;
      cards.forEach((c, i) => {
        const on = match[i] && seen < limit;
        if (match[i]) seen++;
        c.hidden = !on;
      });
      const visible = Math.min(total, limit);
      if (more) {
        const left = total - visible;
        more.hidden = left <= 0;
        if (moreN) moreN.textContent = left > 0 ? `(${left})` : '';
      }
      if (empty) empty.hidden = total > 0;
      if (!quiet) {
        say(total
          ? `Показано ${visible} из ${total} ${plural(total, 'средства', 'средств', 'средств')}`
          : 'Ничего не найдено');
      }
      if (keepFocus && keepFocus.focus) keepFocus.focus({ preventScroll: true });
    }

    function setLine(value, opts = {}) {
      line = chips.some((c) => c.dataset.line === value) ? value : 'all';
      shown = PAGE;
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.line === line)));
      const on = chips.find((c) => c.dataset.line === line);
      // Выбранный фильтр прокручиваем в видимую часть ленты — но только
      // саму ленту, страницу не трогаем.
      if (on && chipsBox.scrollWidth > chipsBox.clientWidth) {
        chipsBox.scrollTo({ left: Math.max(0, on.offsetLeft - chipsBox.offsetLeft - 16), behavior: reduced || opts.reveal === false ? 'auto' : 'smooth' });
      }
      if (opts.url !== false) {
        const u = new URL(location.href);
        if (line === 'all') u.searchParams.delete('line'); else u.searchParams.set('line', line);
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
      render(null, opts.quiet);
    }

    chips.forEach((c) => c.addEventListener('click', () => setLine(c.dataset.line)));

    if (q) {
      let t;
      q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => render(), 120); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); render(); } });
    }

    if (more) {
      more.addEventListener('click', () => {
        // Фокус переносим на первую из новых карточек: иначе клавиатура
        // и экранный диктор теряют место, где человек остановился.
        const before = cards.filter((c) => !c.hidden).length;
        shown += PAGE;
        render();
        const next = cards.filter((c) => !c.hidden)[before];
        const link = next && next.querySelector('a');
        if (link) link.focus({ preventScroll: false });
      });
    }

    // Ссылки вида /?line=carboxy#catalog: на главной не перезагружаем
    // страницу, а сразу включаем нужную линейку.
    doc.addEventListener('click', (e) => {
      const a = e.target.closest('a[href*="line="]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const u = new URL(a.href, location.href);
      if (u.pathname !== location.pathname) return;
      e.preventDefault();
      setLine(u.searchParams.get('line') || 'all', { reveal: false });
      const target = doc.getElementById('catalog');
      if (target) target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      // Фокус — туда же, куда ушла страница: как при обычном переходе по якорю.
      const head = doc.getElementById('catalog-h');
      if (head) head.focus({ preventScroll: true });
    });

    const start = new URL(location.href).searchParams.get('line');
    if (start) setLine(start, { url: false, reveal: false, quiet: true }); else render(null, true);
  }

  /* ---------- цели аналитики ----------
     Сам счётчик здесь не живёт: если он включён и посетитель согласился,
     его подключает consent.js и слушает это событие. */
  doc.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goal]');
    if (!a) return;
    doc.dispatchEvent(new CustomEvent('pt:goal', {
      detail: { goal: a.dataset.goal, market: a.dataset.market || '', line: a.dataset.line || '', place: a.dataset.place || '' },
    }));
  });

  /* ---------- проявление ----------
     Прячем только то, что сейчас ниже экрана: верх страницы никогда
     не мигает, а без скрипта не прячется ничего. */
  const rise = [...doc.querySelectorAll('.rise')];
  if (rise.length && !reduced && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    const vh = innerHeight;
    rise.forEach((el) => {
      if (el.getBoundingClientRect().top > vh) { el.classList.add('pre'); io.observe(el); }
    });
    // Страховка: если наблюдатель по какой-то причине молчит,
    // через пару секунд после прокрутки всё равно показываем.
    addEventListener('scroll', () => {
      rise.forEach((el) => { if (el.classList.contains('pre') && el.getBoundingClientRect().top < innerHeight) el.classList.add('in'); });
    }, { passive: true });
  }
})();
