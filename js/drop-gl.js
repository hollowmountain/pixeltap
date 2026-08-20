/* Капля сыворотки — настоящая трёхмерная сцена, посчитанная рейтрейсингом
   по знаковому полю расстояний (SDF). Ни одной библиотеки и ни одной
   модели: форма задана математикой, стекло — преломлением луча.

   Почему так, а не Three.js: сцена здесь одна и простая, а вся её
   ценность — в стекле. Тащить 600 КБ библиотеки ради одного объекта
   дороже, чем написать сам объект.

   Капля поворачивается прокруткой: страница листается — вещь
   поворачивается в руке. */
(() => {
  'use strict';

  const cv = document.getElementById('drop');
  if (!cv) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const gl = cv.getContext('webgl', { alpha: true, antialias: false, depth: false });
  if (!gl) { cv.closest('.drop-stage')?.setAttribute('data-failed', '1'); return; }

  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.0,1.0); }';

  const FRAG = `
  precision highp float;
  uniform vec2  uRes;
  uniform float uT;      // время
  uniform float uSpin;   // поворот от прокрутки
  uniform vec3  uTint;   // цвет жидкости внутри
  uniform vec3  uGlow;   // цвет подсветки
  uniform vec3  uBack;   // фон секции, сквозь который видно стекло

  mat2 rot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }

  // Мягкое объединение: две формы сливаются, как две капли жидкости.
  float smin(float a, float b, float k){
    float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
    return mix(b, a, h) - k*h*(1.0-h);
  }

  float sphere(vec3 p, float r){ return length(p) - r; }

  // Форма: основная капля, подтянутая книзу, плюс догоняющая её вторая —
  // момент, когда сыворотка вот-вот сорвётся.
  float map(vec3 p){
    vec3 q = p;
    q.xz *= rot(uSpin);
    q.yz *= rot(0.22);

    // лёгкое дыхание поверхности
    float breathe = sin(uT*0.6)*0.02;

    vec3 a = q - vec3(0.0, -0.05 + breathe, 0.0);
    float d1 = sphere(a, 0.62);
    // вытянутый носик капли
    vec3 b = q - vec3(0.0, 0.52 + breathe*1.4, 0.0);
    b.y *= 0.62;
    float d2 = sphere(b, 0.20);

    float d = smin(d1, d2, 0.34);

    // рябь по поверхности — стекло не идеально гладкое
    d += sin(q.x*9.0 + uT*0.5) * sin(q.y*8.0) * sin(q.z*9.0 + uT*0.3) * 0.008;
    return d;
  }

  vec3 normal(vec3 p){
    vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(
      map(p+e.xyy) - map(p-e.xyy),
      map(p+e.yxy) - map(p-e.yxy),
      map(p+e.yyx) - map(p-e.yyx)));
  }

  /* Возвращаем не только точку попадания, но и то, насколько близко луч
     прошёл от поверхности: по этому зазору считается покрытие пикселя,
     иначе силуэт получается лесенкой. Шаг укорочен, потому что рябь
     делает поле не строго дистанционным и полный шаг проскакивает
     поверхность — это и давало «пиксели» по краю. */
  float march(vec3 ro, vec3 rd, float side, out float dmin){
    float t = 0.0;
    dmin = 1e9;
    for (int i = 0; i < 84; i++){
      vec3 p = ro + rd*t;
      float d = map(p) * side;
      dmin = min(dmin, d);
      if (abs(d) < 0.0009 || t > 6.0) break;
      t += d * 0.72;
    }
    return t;
  }

  float march(vec3 ro, vec3 rd, float side){
    float dm;
    return march(ro, rd, side, dm);
  }

  // Фон, который видно сквозь стекло: мягкие полосы света в цвете секции.
  vec3 backdrop(vec3 rd){
    float band = 0.5 + 0.5*sin(rd.y*5.0 + rd.x*2.0 + uT*0.25);
    vec3 c = mix(uBack, uGlow, smoothstep(0.35, 1.0, band)*0.55);
    c = mix(c, uTint, smoothstep(0.6, 1.0, rd.y)*0.25);
    return c;
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*uRes.xy) / uRes.y;

    /* Камера отодвинута так, чтобы капля помещалась целиком: при 2.5
       кадр показывал ±0.806 по высоте, а капля тянется до 0.85 — верх
       срезало. Теперь в кадре ±1.13, есть поле по краям. */
    vec3 ro = vec3(0.0, 0.0, 3.5);
    vec3 rd = normalize(vec3(uv, -1.55));

    float dmin;
    float t = march(ro, rd, 1.0, dmin);

    // Размер пикселя в мировых единицах — мера, по которой сглаживаем кромку.
    float px = 1.55 / uRes.y * t;

    if (t > 6.0) {
      // Луч прошёл мимо, но вплотную: пиксель покрыт стеклом частично.
      float cov = 1.0 - smoothstep(0.0, px * 2.5, dmin);
      if (cov < 0.004) { gl_FragColor = vec4(0.0); return; }
      /* Цвет краевого пикселя — то, что за каплей, а не подсветка:
         подмешаешь сюда свечение — и по силуэту пойдёт яркое кольцо
         вместо сглаживания. Гасим только непрозрачностью. */
      gl_FragColor = vec4(backdrop(rd), cov * 0.75);
      return;
    }

    vec3 p = ro + rd*t;
    vec3 n = normal(p);

    float ior = 1.42;                       // показатель преломления стекла
    vec3 refr = refract(rd, n, 1.0/ior);

    // Луч идёт насквозь: входит, пересекает объём, выходит наружу.
    vec3 pIn = p + refr*0.02;
    float tIn = march(pIn, refr, -1.0);
    vec3 pOut = pIn + refr*tIn;
    vec3 nOut = -normal(pOut);
    vec3 refr2 = refract(refr, nOut, ior/1.0);
    if (dot(refr2, refr2) == 0.0) refr2 = reflect(refr, nOut);  // полное отражение

    vec3 through = backdrop(normalize(refr2));

    // Толщина стекла красит проходящий свет — так работает цветная жидкость.
    float thick = clamp(tIn, 0.0, 2.0);
    through *= exp(-thick * (1.0 - uTint) * 2.30);

    vec3 refl = backdrop(reflect(rd, n));

    // Френель: у края стекло почти зеркало, в центре прозрачно.
    float fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
    vec3 col = mix(through, refl, clamp(fres, 0.0, 0.92));

    // Блик от источника сверху-слева.
    vec3 L = normalize(vec3(-0.55, 0.85, 0.55));
    float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 42.0);
    col += spec * 0.85;

    /* Кромка по силуэту. Чистое жёлтое свечение на розовом поле читается
       грязной зеленоватой каймой, поэтому берём его пополам с цветом
       жидкости и держим слабым. */
    float rim = pow(1.0 - max(dot(-rd, n), 0.0), 2.2);
    col += mix(uGlow, uTint, 0.5) * rim * 0.13;

    float alpha = clamp(0.30 + fres*0.85 + spec, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }`;

  function compile(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('drop shader:', gl.getShaderInfoLog(s)); return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { cv.closest('.drop-stage')?.setAttribute('data-failed','1'); return; }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.closest('.drop-stage')?.setAttribute('data-failed','1'); return; }
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
    spin: gl.getUniformLocation(prog, 'uSpin'),
    tint: gl.getUniformLocation(prog, 'uTint'),
    glow: gl.getUniformLocation(prog, 'uGlow'),
    back: gl.getUniformLocation(prog, 'uBack')
  };

  const PALETTE = {
    morning: { tint: [1.00,0.42,0.66], glow: [1.00,0.77,0.24], back: [1.00,0.945,0.961] },
    evening: { tint: [1.00,0.50,0.69], glow: [1.00,0.79,0.48], back: [0.169,0.047,0.149] }
  };
  let cur = null, target = null;

  function setPhase(ph){
    const t = PALETTE[ph] || PALETTE.morning;
    target = { tint: t.tint.slice(), glow: t.glow.slice(), back: t.back.slice() };
    if (!cur) cur = { tint: t.tint.slice(), glow: t.glow.slice(), back: t.back.slice() };
  }
  window.dropSetPhase = setPhase;
  setPhase(document.documentElement.dataset.phase || 'morning');

  let dpr = 1, W = 0, H = 0;
  function resize(){
    // Рейтрейсинг дороже заливки — разрешение держим скромнее.
    // Зажим на 1.4 давал видимую лесенку на экранах Retina.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr));
    H = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
    gl.viewport(0,0,W,H);
  }
  resize();
  addEventListener('resize', resize);

  let visible = false;
  if ('IntersectionObserver' in window){
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(cv);
  } else visible = true;

  // Поворот берётся из положения секции на экране: прокрутка вращает вещь.
  let spin = 0, spinTarget = 0;
  function readSpin(){
    const r = cv.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    const p = (vh - r.top) / (vh + r.height);   // 0 → 1 за проход секции
    spinTarget = (p - 0.5) * 2.6;
  }
  addEventListener('scroll', readSpin, { passive: true });
  readSpin();

  let t0 = null;
  function frame(ts){
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    if (t0 === null) t0 = ts;

    spin += (spinTarget - spin) * 0.08;
    if (target){
      for (const k of ['tint','glow','back'])
        for (let i=0;i<3;i++) cur[k][i] += (target[k][i] - cur[k][i]) * 0.055;
    }

    gl.uniform2f(U.res, W, H);
    gl.uniform1f(U.t, reduced ? 4.0 : (ts - t0)/1000);
    gl.uniform1f(U.spin, reduced ? 0.4 : spin);
    gl.uniform3fv(U.tint, cur.tint);
    gl.uniform3fv(U.glow, cur.glow);
    gl.uniform3fv(U.back, cur.back);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);
})();
