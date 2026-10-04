import * as THREE from 'three';

const { gsap, ScrollTrigger, Lenis } = window;
gsap.registerPlugin(ScrollTrigger);

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const caps = [...document.querySelectorAll('.cap')];
const rooms = caps.map((c) => ({ src: c.dataset.bg, name: c.dataset.room }));
const N = rooms.length;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ---------------- Smooth scroll ---------------- */
const lenis = reduced ? null : new Lenis({ lerp: 0.08 });
if (lenis) {
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop();
}
document.body.classList.add('is-loading');

document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const el = document.querySelector(a.getAttribute('href'));
  if (!el) return;
  e.preventDefault();
  closeMenu();
  lenis ? lenis.scrollTo(el, { duration: 1.8 }) : el.scrollIntoView();
}));

/* ---------------- Menu ---------------- */
const burger = document.querySelector('.nav__burger');
const menu = document.querySelector('.menu');
function closeMenu() { menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); burger.setAttribute('aria-expanded', 'false'); }
burger.addEventListener('click', () => {
  const open = !menu.classList.contains('is-open');
  menu.classList.toggle('is-open', open);
  menu.setAttribute('aria-hidden', String(!open));
  burger.setAttribute('aria-expanded', String(open));
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

/* ---------------- Walk progress ---------------- */
const walk = document.querySelector('.walk');
let target = 0, prog = 0, vel = 0, walkActive = true;
ScrollTrigger.create({ trigger: walk, start: 'top top', end: 'bottom bottom', onUpdate: (s) => { target = s.progress * (N - 1); } });

const hud = document.querySelector('.walk__hud');
const hudBar = hud.querySelector('.hud__progress span');
const hudCur = hud.querySelector('.hud__cur');
const hudRoom = hud.querySelector('.hud__room');
let lastIdx = -1;

function updateDom(p) {
  caps.forEach((c, i) => {
    const local = p - i;
    const o = i === 0 ? clamp(1 - p * 2.4) : clamp(1 - Math.abs(local) * 2.4);
    c.style.opacity = o;
    c.style.visibility = o > 0.001 ? 'visible' : 'hidden';
    c.style.transform = i === 0
      ? `translate3d(0, calc(-50% - ${p * 120}px), 0)`
      : `translate3d(0, ${local * -70}px, 0)`;
  });
  const idx = Math.round(p);
  if (idx !== lastIdx) {
    lastIdx = idx;
    hudCur.textContent = String(idx).padStart(2, '0');
    hudRoom.textContent = rooms[idx].name;
  }
  hudBar.style.transform = `scaleY(${p / (N - 1)})`;
  hud.classList.toggle('is-hidden', !walkActive);
}

/* ---------------- Loader ---------------- */
const loaderBar = document.querySelector('.loader__bar span');
const loaderCount = document.querySelector('.loader__count');
function setLoad(r) {
  loaderBar.style.transform = `scaleX(${r})`;
  loaderCount.textContent = String(Math.round(r * 100)).padStart(3, '0');
}

/* ---------------- WebGL stage ---------------- */
const canvas = document.querySelector('.stage');
let renderer = null;
if (!reduced) {
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { renderer = null; }
}

const intro = { z: 0 };
let stage = null;
if (renderer) stage = createStage();
else createFallback();

function createStage() {
  const D = 10;            // distance between rooms
  const FOV = 50;
  const OVERSIZE = 1.08;   // headroom for mouse parallax
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b0c);
  const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 200);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));

  const vert = /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const frag = /* glsl */`
    uniform sampler2D uTex;
    uniform float uImgAspect, uPlaneAspect, uOpen, uDim, uVel, uSide;
    uniform vec2 uMouse;
    varying vec2 vUv;
    vec2 cover(vec2 uv) {
      float r = uPlaneAspect / uImgAspect;
      vec2 s = r > 1.0 ? vec2(1.0, 1.0 / r) : vec2(r, 1.0);
      return (uv - 0.5) * s + 0.5;
    }
    void main() {
      vec2 full = vec2(vUv.x * 0.5 + uSide * 0.5, vUv.y);   // each door shows its half of the room
      vec2 uv = cover(full);
      uv = (uv - 0.5) * (0.95 - uOpen * 0.05) + 0.5 + uMouse * 0.01;
      float k = clamp(uVel, -1.5, 1.5) * 0.0025;   // subtle chroma split while moving
      vec3 col;
      col.r = texture2D(uTex, uv + vec2(k, 0.0)).r;
      col.g = texture2D(uTex, uv).g;
      col.b = texture2D(uTex, uv - vec2(k, 0.0)).b;
      // shared grade so every room reads as one shoot: soft desaturation,
      // shadows pulled to the brand ink, highlights warmed toward travertine
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 0.88);
      col = mix(vec3(0.043, 0.043, 0.047), col, smoothstep(-0.02, 0.18, l) * 0.8 + 0.2);
      col *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), smoothstep(0.35, 1.0, l));
      col = col * col * (3.0 - 2.0 * col) * 0.2 + col * 0.8 * 1.06;   // gentle filmic S-curve, slight lift
      // the line: a warm seam of light where the doors part
      float d = abs(full.x - 0.5);
      float start = smoothstep(0.0, 0.08, uOpen);
      vec3 warm = vec3(1.0, 0.8, 0.56);
      col += warm * exp(-d * 420.0) * start * 1.2;
      col += warm * exp(-d * 18.0) * start * 0.18 * (1.0 - uOpen);
      // vignette, door shading as it swings, distance dimming
      float v = 1.0 - 0.32 * pow(length(full - 0.5) * 1.25, 2.0);
      col *= v * uDim * (1.0 - uOpen * 0.45);
      gl_FragColor = vec4(col, 1.0);
    }`;

  const unit = new THREE.PlaneGeometry(1, 1);
  const leftGeo = unit.clone().translate(0.5, 0, 0);   // hinge on the left edge
  const rightGeo = unit.clone().translate(-0.5, 0, 0); // hinge on the right edge
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_, loaded, total) => setLoad(loaded / total);
  const loader = new THREE.TextureLoader(manager);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const doors = rooms.map((r, i) => {
    const group = new THREE.Group();
    group.position.z = -(i + 1) * D;
    const halves = [];
    const tex = loader.load(r.src, (t) => {
      halves.forEach((h) => { h.u.uImgAspect.value = t.image.width / t.image.height; });
    });
    tex.anisotropy = maxAniso;
    for (const [geo, side] of [[leftGeo, 0], [rightGeo, 1]]) {
      const u = {
        uTex: { value: tex }, uImgAspect: { value: 16 / 9 }, uPlaneAspect: { value: 1 },
        uOpen: { value: 0 }, uDim: { value: 1 }, uVel: { value: 0 }, uSide: { value: side },
        uMouse: { value: new THREE.Vector2() },
      };
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide }));
      const pivot = new THREE.Group();
      pivot.add(mesh);
      group.add(pivot);
      halves.push({ pivot, mesh, u });
    }
    scene.add(group);
    return { group, left: halves[0], right: halves[1] };
  });

  /* Linear light guides between rooms — the "linea" running through the house */
  const box = new THREE.BoxGeometry(1, 1, D * 0.98);
  const LINES = [[0, 0.44, 0.03], [-0.2, -0.44, 0.015], [0.2, -0.44, 0.015], [-0.46, 0, 0.008], [0.46, 0, 0.008]];
  const segments = rooms.slice(0, -1).map((_, i) => {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd6a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const lines = LINES.map(([x, y, t]) => {
      const m = new THREE.Mesh(box, mat);
      m.userData = { x, y, t };
      g.add(m);
      return m;
    });
    g.position.z = -(i + 1.5) * D;
    scene.add(g);
    return { mat, lines };
  });

  /* Dust motes drifting in the light */
  const COUNT = innerWidth < 768 ? 350 : 900;
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 14;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
    pos[i * 3 + 2] = -Math.random() * D * (N + 1) + 4;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffe2b8, size: 0.022, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(dust);

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    const H = 2 * D * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * OVERSIZE;
    const W = H * camera.aspect;
    doors.forEach(({ left, right }) => {
      left.mesh.scale.set(W / 2, H, 1); left.pivot.position.x = -W / 2;
      right.mesh.scale.set(W / 2, H, 1); right.pivot.position.x = W / 2;
      left.u.uPlaneAspect.value = right.u.uPlaneAspect.value = W / H;
    });
    segments.forEach(({ lines }) => lines.forEach((m) => {
      const { x, y, t } = m.userData;
      m.position.set(x * W, y * H, 0);
      m.scale.set(t, t, 1);
    }));
  }
  resize();
  addEventListener('resize', resize);

  const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
  addEventListener('pointermove', (e) => { mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight * 2 - 1)); });

  const clock = new THREE.Clock();
  function render(p) {
    const t = clock.getElapsedTime();
    mouseS.lerp(mouse, 0.05);
    camera.position.set(mouseS.x * 0.35, mouseS.y * 0.2, -p * D + intro.z);
    camera.lookAt(mouseS.x * 0.1, mouseS.y * 0.05, camera.position.z - D);

    doors.forEach(({ group, left, right }, i) => {
      const local = p - i;
      const dist = camera.position.z - group.position.z;
      const visible = local < 1.02 && dist < D * 3.2;
      group.visible = visible;
      if (!visible) return;
      const open = smooth(0.22, 0.88, local);
      left.pivot.rotation.y = open * 1.5;
      right.pivot.rotation.y = -open * 1.5;
      const dim = clamp(1 - (dist / D - 1) * 0.3);   // next room glows through the doorway
      for (const s of [left, right]) {
        s.u.uOpen.value = open;
        s.u.uDim.value = dim;
        s.u.uVel.value = vel;
        s.u.uMouse.value.copy(mouseS);
      }
    });

    segments.forEach(({ mat }, i) => {
      const local = p - i;
      mat.opacity = smooth(0.15, 0.55, local) * (1 - smooth(0.75, 1.0, local)) * 0.9;
    });

    dust.rotation.z = t * 0.01;
    dust.position.y = Math.sin(t * 0.2) * 0.15;
    renderer.render(scene, camera);
  }

  return { manager, render };
}

function createFallback() {
  canvas.remove();
  const wrap = document.createElement('div');
  wrap.className = 'fallback';
  wrap.setAttribute('aria-hidden', 'true');
  let loaded = 0;
  const imgs = rooms.map((r) => {
    const img = new Image();
    img.alt = '';
    img.onload = img.onerror = () => { setLoad(++loaded / N); if (loaded === N) start(); };
    img.src = r.src;
    wrap.appendChild(img);
    return img;
  });
  document.body.prepend(wrap);
  stage = { fallback: imgs, wrap };
}

/* ---------------- Main loop ---------------- */
let lastFallback = -1;
function tick() {
  walkActive = walk.getBoundingClientRect().bottom > 0;
  const prev = prog;
  // ease toward target, but never trail more than ~1.5 rooms behind (anchor jumps)
  prog += (target - prog) * (reduced ? 1 : 0.075);
  if (Math.abs(target - prog) > 1.5) prog = target - Math.sign(target - prog) * 1.5;
  vel += ((prog - prev) * 60 - vel) * 0.1;
  updateDom(prog);
  if (stage?.render) {
    canvas.style.visibility = walkActive ? 'visible' : 'hidden';
    if (walkActive) stage.render(prog);
  }
  if (stage?.fallback) {
    const idx = Math.round(prog);
    if (idx !== lastFallback) {
      stage.fallback.forEach((im, i) => im.classList.toggle('on', i === idx));
      lastFallback = idx;
    }
    stage.wrap.style.visibility = walkActive ? 'visible' : 'hidden';
  }
}
gsap.ticker.add(tick);

/* ---------------- Start / intro ---------------- */
let started = false;
function start() {
  if (started) return;
  started = true;
  setLoad(1);
  setTimeout(() => {
    document.querySelector('.loader').classList.add('is-done');
    document.body.classList.remove('is-loading');
    lenis?.start();
    ScrollTrigger.refresh();
    if (!reduced) {
      intro.z = 6;
      gsap.to(intro, { z: 0, duration: 2.6, ease: 'expo.out' });
      gsap.to('.hero__title .line > span', { y: 0, duration: 1.6, ease: 'expo.out', stagger: 0.12, delay: 0.25 });
      gsap.from(['.cap--hero .eyebrow', '.hero__sub', '.scroll-hint'], { opacity: 0, y: 24, duration: 1.2, ease: 'expo.out', stagger: 0.1, delay: 0.6 });
    } else {
      gsap.set('.hero__title .line > span', { y: 0 });
    }
  }, 350);
}
if (stage?.manager) stage.manager.onLoad = start;
setTimeout(start, 8000); // never trap the visitor behind a slow network

/* ---------------- Section animations ---------------- */
// Manifesto: words light up as you read
const mt = document.querySelector('[data-split]');
mt.innerHTML = mt.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ');
if (!reduced) {
  gsap.to(mt.querySelectorAll('.w'), {
    opacity: 1, stagger: 0.08, ease: 'none',
    scrollTrigger: { trigger: mt, start: 'top 80%', end: 'bottom 45%', scrub: 1 },
  });
}

document.querySelectorAll('[data-count]').forEach((el) => {
  const end = +el.dataset.count;
  if (reduced) { el.textContent = end; return; }
  const o = { v: 0 };
  gsap.to(o, {
    v: end, duration: 2.2, ease: 'expo.out',
    onUpdate: () => { el.textContent = Math.round(o.v); },
    scrollTrigger: { trigger: el, start: 'top 85%', once: true },
  });
});

const mm = gsap.matchMedia();
mm.add('(min-width: 769px) and (prefers-reduced-motion: no-preference)', () => {
  const track = document.querySelector('.projects__track');
  const st = { trigger: '.projects', start: 'top top', end: 'bottom bottom', scrub: 1, invalidateOnRefresh: true };
  gsap.to(track, { x: () => -(track.scrollWidth - innerWidth), ease: 'none', scrollTrigger: st });
  gsap.utils.toArray('.proj__img img').forEach((img) => {
    gsap.fromTo(img, { xPercent: -5 }, { xPercent: 5, ease: 'none', scrollTrigger: { ...st, scrub: true } });
  });
});

mm.add('(prefers-reduced-motion: no-preference)', () => {
  gsap.utils.toArray('.materials__img img').forEach((img) => {
    gsap.fromTo(img, { yPercent: -16 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
  });
  gsap.fromTo('.atelier__img', { clipPath: 'inset(18% 18% 18% 18%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', scrollTrigger: { trigger: '.atelier', start: 'top 85%', end: 'center center', scrub: 1 } });
  gsap.fromTo('.atelier__img img', { scale: 1.35 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.atelier', start: 'top 85%', end: 'bottom top', scrub: 1 } });

  gsap.utils.toArray('.h-display, .contact__title, .svc li, .stat, .swatches li, .atelier__copy p, .proj__meta, .value').forEach((el) => {
    gsap.from(el, { opacity: 0, y: 50, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
  });
  gsap.fromTo('.foot__big', { yPercent: 40 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.foot', start: 'top bottom', end: 'bottom bottom', scrub: true } });
});

/* ---------------- "Where" rotation ---------------- */
const whereLines = gsap.utils.toArray('.where__line');
const whereImgs = gsap.utils.toArray('.where__stack img');
const whereCur = document.querySelector('.where__cur');
let whereIdx = 0;
const whereTl = gsap.timeline({
  scrollTrigger: {
    trigger: '.where', start: 'top top', end: 'bottom bottom', scrub: reduced ? true : 1,
    onUpdate: (s) => {
      const i = Math.min(whereLines.length - 1, Math.floor(s.progress * whereLines.length));
      if (i === whereIdx) return;
      whereLines[whereIdx].classList.remove('is-on');
      whereLines[i].classList.add('is-on');
      whereCur.textContent = String(i + 1).padStart(2, '0');
      whereIdx = i;
    },
  },
});
whereImgs.forEach((img, i) => {
  if (i === 0) return;
  // each image wipes up over the previous one, while the previous drifts and scales back
  whereTl.to(img, { clipPath: 'inset(0% 0 0 0)', ease: 'power2.inOut', duration: 1 }, i - 0.5)
    .to(whereImgs[i - 1], { scale: 0.92, filter: 'brightness(.5)', ease: 'power2.inOut', duration: 1 }, i - 0.5);
});
whereTl.to({}, { duration: 0.5 });

/* ---------------- Contact form (demo) ---------------- */
const form = document.querySelector('.form');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const note = form.querySelector('.form__note');
  const name = form.elements.name, email = form.elements.email;
  const okName = name.value.trim().length > 1;
  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
  name.setAttribute('aria-invalid', String(!okName));
  email.setAttribute('aria-invalid', String(!okEmail));
  if (!okName || !okEmail) {
    note.textContent = !okName ? 'Please tell us your name.' : 'Please enter a valid email address.';
    (!okName ? name : email).focus();
    return;
  }
  note.textContent = 'Thank you. This is a demo, so no message was sent.';
  form.reset();
});
