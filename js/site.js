/* PixelTap — поведение страницы.
   Три вещи: сетка курса, переключение фазы (утро/вечер) и каталог,
   который читается из products.json, чтобы товары обновлялись без
   правки разметки. */
(() => {
  'use strict';

  const COURSE_DAYS = 28;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Времени суток на сайте больше нет: страница всегда утренняя.
     Переключатель и вечерняя ветка сняты по правке заказчика — вместе
     с ними ушли сетка курса и блок ритуала, которые от них зависели. */

  /* ---------- каталог ---------- */

  let products = [];
  let filter = 'all';

  function marketLink(href, label) {
    const a = document.createElement('a');
    a.className = 'buy';
    a.textContent = label;
    if (href) {
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ico');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M7 17 17 7M9.6 7H17v7.4');
      svg.appendChild(p);
      a.appendChild(svg);
    } else {
      // Ссылки ещё нет — кнопка честно недоступна, а не ведёт в никуда.
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('role', 'link');
      a.title = 'Ссылка появится, когда товар выйдет на площадке';
    }
    return a;
  }

  // Фильтры строятся по тому, что реально пришло из кабинетов: список
  // групп в разметке не зашит, иначе он разъедется с каталогом при первой
  // же новой категории. Рядом с названием — количество: посетитель видит
  // размер группы до нажатия.
  function buildFilters() {
    const box = document.querySelector('.filters');
    if (!box) return;

    const counts = new Map();
    products.forEach(p => counts.set(p.step, (counts.get(p.step) || 0) + 1));
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    box.innerHTML = '';
    const make = (value, label, n, on) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter' + (on ? ' is-on' : '');
      b.dataset.filter = value;
      b.setAttribute('aria-pressed', String(on));
      b.textContent = label;
      const c = document.createElement('span');
      c.className = 'filter-n tnum';
      c.textContent = String(n);
      b.appendChild(c);
      b.addEventListener('click', () => {
        filter = value;
        shown = PAGE;
        box.querySelectorAll('.filter').forEach(x => {
          const isOn = x === b;
          x.classList.toggle('is-on', isOn);
          x.setAttribute('aria-pressed', String(isOn));
        });
        renderRows();
      });
      return b;
    };

    box.appendChild(make('all', 'Все', products.length, true));
    groups.forEach(([name, n]) => box.appendChild(make(name, name, n, false)));
  }

  // Сколько карточек показываем сразу. Каталог на сотню с лишним позиций
  // нельзя вываливать целиком: это и полотно из картинок, и лишний трафик.
  const PAGE = 14;
  let shown = PAGE;

  function renderRows() {
    const box = document.getElementById('rows');
    if (!box) return;
    const list = products.filter(p => filter === 'all' || p.step === filter);

    box.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'notice';
      empty.textContent = 'В этой группе пока нет средств.';
      box.appendChild(empty);
      window.dispatchEvent(new Event('lists:ready'));
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'cards';

    list.slice(0, shown).forEach(p => {
      const card = document.createElement('article');
      card.className = 'card';

      // Снимок с витрины площадки. Кадр всегда 3:4 — под этот формат
      // сняты все карточки, поэтому место под фото резервируется заранее
      // и сетка не прыгает, пока картинки долетают.
      const media = document.createElement('div');
      media.className = 'card-media';
      if (p.img) {
        const im = document.createElement('img');
        im.src = p.img;
        im.alt = p.name;
        im.loading = 'lazy';
        im.decoding = 'async';
        im.width = 900; im.height = 1200;
        im.addEventListener('error', () => { media.dataset.empty = '1'; im.remove(); });
        media.appendChild(im);
      } else {
        media.dataset.empty = '1';
      }

      const body = document.createElement('div');
      body.className = 'card-body';

      const step = document.createElement('div');
      step.className = 'card-step';
      step.textContent = p.step || '';

      const name = document.createElement('h3');
      name.className = 'card-name';
      name.textContent = p.name;

      body.append(step, name);

      if (p.volume) {
        const vol = document.createElement('div');
        vol.className = 'card-vol tnum';
        vol.textContent = p.volume;
        body.appendChild(vol);
      }
      if (p.desc) {
        const d = document.createElement('p');
        d.className = 'card-desc';
        d.textContent = p.desc;
        body.appendChild(d);
      }

      const buy = document.createElement('div');
      buy.className = 'card-buy';
      buy.append(marketLink(p.ozon, 'Ozon'), marketLink(p.wb, 'WB'));
      body.appendChild(buy);

      card.append(media, body);
      grid.appendChild(card);
    });

    box.appendChild(grid);

    // Кнопка догрузки честно говорит, сколько осталось.
    if (list.length > shown) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'more';
      // Текст в отдельном элементе: поверх кнопки лежит затемнение
      // камня, и без обёртки надпись оказалась бы под ним.
      const label = document.createElement('span');
      label.textContent = 'Показать ещё';
      const left = document.createElement('span');
      left.className = 'more-dot';
      left.textContent = '◆';
      const n = document.createElement('span');
      n.className = 'more-n tnum';
      n.textContent = String(list.length - shown);
      more.append(label, left, n);
      more.addEventListener('click', () => { shown += PAGE; renderRows(); });
      box.appendChild(more);
    }

    window.dispatchEvent(new Event('lists:ready'));
  }

  async function loadProducts() {
    try {
      const res = await fetch('products.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('products.json: ожидался массив');
      /* На сайте — только своя марка. В кабинетах лежат и чужие товары:
         в том же кабинете, где основной ассортимент PixelTap, нашлись
         позиции HARBEZ. Признак own проставляет выгрузка, сверяя поле
         бренда с площадки, а не название карточки: у крем-бустера марка
         написана только на самой баночке. */
      products = data.filter(p => p.own !== false);
    } catch (e) {
      products = [];
      const box = document.getElementById('rows');
      if (box) {
        const err = document.createElement('p');
        err.className = 'notice';
        err.textContent = 'Каталог не загрузился. Обновите страницу.';
        box.appendChild(err);
      }
      return;
    }

    // Пока в каталоге стоят демонстрационные позиции — говорим об этом прямо.
    const notice = document.getElementById('notice');
    if (notice && products.some(p => p.placeholder)) notice.hidden = false;

    buildFilters();
    renderRows();
    buildStrip();
  }

  /* ---------- лента товаров справа ---------- */

  // Карточки идут сверху вниз вдоль правого края. Лента бесконечная:
  // ушедшая вниз карточка возвращается наверх, поэтому пустот не бывает.
  function buildStrip() {
    const track = document.getElementById('strip');
    if (!track) return;

    const pool = products.filter(p => p.img && (p.wb || p.ozon));
    if (!pool.length) return;

    const N = Math.min(10, pool.length);
    track.innerHTML = '';
    const cards = [];
    for (let i = 0; i < N; i++) {
      const p = pool[Math.floor(i * pool.length / N)];
      const a = document.createElement('a');
      a.className = 'strip-card';
      a.href = p.wb || p.ozon;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = p.name;

      const im = document.createElement('img');
      im.src = p.img;
      im.alt = p.name;
      im.loading = 'lazy';
      im.decoding = 'async';
      a.appendChild(im);
      track.appendChild(a);
      cards.push(a);
    }

    // Шаг между карточками считаем от их настоящей высоты, а не на глаз:
    // ширина ленты подвижная, и при другом экране зазор поехал бы.
    let step = 0, span = 0;
    function measure() {
      const w = track.clientWidth || 1;
      step = w * (4 / 3) + 14;          // высота карточки плюс зазор
      span = step * cards.length;       // длина полного круга
    }
    measure();

    const offs = cards.map((_, i) => i * step);
    const put = () => cards.forEach((c, i) => c.style.setProperty('--y', offs[i].toFixed(1) + 'px'));
    put();

    if (reduced) return;

    let last = performance.now(), visible = true;
    const SPEED = 22;                   // пикселей в секунду — спокойно

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!visible || document.hidden) return;
      const h = track.clientHeight;
      for (let i = 0; i < cards.length; i++) {
        offs[i] += SPEED * dt;
        // Ушла ниже видимой части — возвращаем наверх, за край ленты.
        if (offs[i] > h + step) offs[i] -= span;
      }
      put();
    }
    requestAnimationFrame(frame);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(track);
    }
    addEventListener('resize', () => { measure(); put(); });
  }

  /* ---------- появление секций ---------- */

  function watchReveal() {
    if (reduced || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.classList.add('will-rise');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    document.querySelectorAll('.lan-say, .catalog-head, .brand-body').forEach(el => io.observe(el));
  }

  /* ---------- запуск ---------- */

  /* Ссылки, которые открывают каталог сразу на нужной группе. Просто
     якорь на #catalog приводил в общий список: человек нажимал «средства
     с ланолином» и попадал в каталог из ста тридцати позиций. */
  document.querySelectorAll('[data-open-group]').forEach(link => {
    link.addEventListener('click', () => {
      const group = link.dataset.openGroup;
      const btn = [...document.querySelectorAll('.filter')]
        .find(b => b.dataset.filter === group);
      if (btn) btn.click();
    });
  });

  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      shown = PAGE;
      document.querySelectorAll('[data-filter]').forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      renderRows();
    });
  });

  loadProducts();
  watchReveal();
})();
