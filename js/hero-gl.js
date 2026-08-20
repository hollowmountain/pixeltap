/* Живое полотно первого экрана.
   Вместо фотографии — текучая поверхность: домен-варп по фрактальному
   шуму, который читается как разлив сыворотки по коже. Считается на GPU,
   поэтому стоит дёшево и не зависит ни от каких внешних картинок.

   Падать некуда: если WebGL недоступен, canvas просто остаётся пустым,
   а под ним лежит CSS-градиент того же настроения. */
(() => {
  'use strict';

  const cv = document.getElementById('gl');
  if (!cv) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const gl = cv.getContext('webgl', {
    alpha: true, antialias: false, depth: false, stencil: false,
    powerPreference: 'low-power'
  });
  if (!gl) { cv.dataset.failed = '1'; return; }

  const VERT = `
    attribute vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }
  `;

  /* Домен-варп: шум, аргумент которого сам смещён шумом. Даёт мягкие
     текучие складки вместо равномерной ряби — то, что нужно для жидкости. */
  const FRAG = `
    precision highp float;
    uniform vec2  uRes;
    uniform float uT;
    uniform vec3  uC1, uC2, uC3, uC4;
    uniform float uMix;
    uniform vec2  uPtr;    // курсор в координатах полотна
    uniform float uPtrAmt; // сила присутствия: 0 — курсора нет

    vec2 hash(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(dot(hash(i + vec2(0.0,0.0)), f - vec2(0.0,0.0)),
                     dot(hash(i + vec2(1.0,0.0)), f - vec2(1.0,0.0)), u.x),
                 mix(dot(hash(i + vec2(0.0,1.0)), f - vec2(0.0,1.0)),
                     dot(hash(i + vec2(1.0,1.0)), f - vec2(1.0,1.0)), u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uRes.xy;
      float ar = uRes.x / uRes.y;
      vec2 q = vec2(uv.x * ar, uv.y) * 1.6;

      float t = uT * 0.045;

      // Курсор расталкивает жидкость: чем ближе, тем сильнее сдвиг складок.
      // Смещаем не цвет, а сам аргумент шума — поверхность прогибается,
      // а не подсвечивается пятном.
      vec2 pd = vec2(uv.x * ar, uv.y) - vec2(uPtr.x * ar, uPtr.y);
      float pl = length(pd);
      // Радиус вдвое меньше: пятно под рукой должно быть компактным.
      float push = uPtrAmt * exp(-pl * 8.4);
      q -= normalize(pd + 1e-5) * push * 0.42;

      vec2 w1 = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, 1.3 - t)));
      vec2 w2 = vec2(fbm(q + 3.4 * w1 + vec2(1.7, 9.2) + t * 0.7),
                     fbm(q + 3.4 * w1 + vec2(8.3, 2.8) - t * 0.5));
      float f = fbm(q + 3.0 * w2);

      float d = clamp(f * 1.9 + 0.5, 0.0, 1.0);
      float s = clamp(length(w2) * 0.9, 0.0, 1.0);

      vec3 col = mix(uC1, uC2, smoothstep(0.10, 0.82, d));
      col = mix(col, uC3, smoothstep(0.42, 1.0, s) * 0.70);
      col = mix(col, uC4, smoothstep(0.58, 1.0, d) * 0.78);

      // Блик вдоль складки: без него жидкость выглядит матовой заливкой.
      float sheen = smoothstep(0.62, 0.98, fbm(q * 1.7 + w2 * 2.2 - t * 0.9));
      col += sheen * 0.10;

      // След курсора: лёгкое уплотнение цвета там, где жидкость смялась.
      col = mix(col, uC4, push * 0.30);

      // Плёнка зерна: убирает полосы на плавных переходах.
      float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.022;

      // К низу полотно уходит в фон страницы, чтобы стык не читался швом.
      float fade = smoothstep(0.0, 0.42, uv.y);
      gl_FragColor = vec4(col, uMix * fade);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { cv.dataset.failed = '1'; return; }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.dataset.failed = '1'; return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const U = {
    res:  gl.getUniformLocation(prog, 'uRes'),
    t:    gl.getUniformLocation(prog, 'uT'),
    mix:  gl.getUniformLocation(prog, 'uMix'),
    ptr:  gl.getUniformLocation(prog, 'uPtr'),
    ptrAmt: gl.getUniformLocation(prog, 'uPtrAmt'),
    c1:   gl.getUniformLocation(prog, 'uC1'),
    c2:   gl.getUniformLocation(prog, 'uC2'),
    c3:   gl.getUniformLocation(prog, 'uC3'),
    c4:   gl.getUniformLocation(prog, 'uC4')
  };

  // Полотно живёт в палитре страницы: цвета читаются из тех же токенов,
  // что и весь остальной интерфейс, поэтому фаза меняет и его.
  const PALETTE = {
    // Утро держится на светлом поле, но насыщенность нужна настоящая:
    // иначе полотно читается как выцветшая заливка, а не как жидкость.
    morning: [[1.000,0.945,0.961], [1.000,0.620,0.769], [1.000,0.773,0.239], [0.910,0.122,0.420]],
    evening: [[0.169,0.047,0.149], [0.420,0.090,0.310], [1.000,0.498,0.690], [1.000,0.788,0.478]]
  };

  let cur = PALETTE.morning.map(c => c.slice());
  let target = cur.map(c => c.slice());

  function setPhase(ph) {
    target = (PALETTE[ph] || PALETTE.morning).map(c => c.slice());
  }
  window.heroSetPhase = setPhase;
  setPhase(document.documentElement.dataset.phase || 'morning');
  cur = target.map(c => c.slice());

  let dpr = 1, W = 0, H = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const r = cv.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    gl.viewport(0, 0, W, H);
  }
  resize();
  addEventListener('resize', resize);

  // Считать полотно, когда его не видно, незачем — это чистый расход батареи.
  let visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 })
      .observe(cv);
  }

  /* Курсор. Держим отдельно «куда целимся» и «где сейчас»: жидкость
     обязана догонять руку с запаздыванием, иначе это не жидкость. */
  const ptr = { tx: 0.5, ty: 0.5, x: 0.5, y: 0.5, tAmt: 0, amt: 0 };
  const fine = matchMedia('(pointer: fine)').matches;

  if (fine && !reduced) {
    addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      ptr.tx = (e.clientX - r.left) / r.width;
      ptr.ty = 1 - (e.clientY - r.top) / r.height;
      // За пределами полотна присутствие гаснет само.
      const inside = ptr.tx > -0.15 && ptr.tx < 1.15 && ptr.ty > -0.15 && ptr.ty < 1.15;
      ptr.tAmt = inside ? 1 : 0;
    }, { passive: true });
    addEventListener('pointerdown', () => { ptr.tAmt = 1.7; }, { passive: true });
    addEventListener('pointerup',   () => { ptr.tAmt = 1; },   { passive: true });
    document.addEventListener('pointerleave', () => { ptr.tAmt = 0; });
  }

  let t0 = null, raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (t0 === null) t0 = ts;
    if (!visible || document.hidden) return;

    // Цвета догоняют цель плавно — переключение фазы перетекает, а не мигает.
    for (let i = 0; i < 4; i++)
      for (let k = 0; k < 3; k++)
        cur[i][k] += (target[i][k] - cur[i][k]) * 0.055;

    // Рука ведёт, жидкость догоняет.
    ptr.x   += (ptr.tx   - ptr.x)   * 0.085;
    ptr.y   += (ptr.ty   - ptr.y)   * 0.085;
    ptr.amt += (ptr.tAmt - ptr.amt) * 0.06;

    gl.uniform2f(U.res, W, H);
    gl.uniform1f(U.t, reduced ? 8.0 : (ts - t0) / 1000);
    gl.uniform1f(U.mix, 1.0);
    gl.uniform2f(U.ptr, ptr.x, ptr.y);
    gl.uniform1f(U.ptrAmt, ptr.amt);
    gl.uniform3fv(U.c1, cur[0]);
    gl.uniform3fv(U.c2, cur[1]);
    gl.uniform3fv(U.c3, cur[2]);
    gl.uniform3fv(U.c4, cur[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  cv.dataset.ready = '1';

  if (reduced) {
    // Неподвижный, но полноценный кадр: движение убрано, картина осталась.
    requestAnimationFrame(ts => { t0 = ts; frame(ts); cancelAnimationFrame(raf); });
  } else {
    raf = requestAnimationFrame(frame);
  }
})();
