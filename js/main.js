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
  // scroll speed bends the page a little: cards tilt and skew in perspective, then settle
  const root = document.documentElement.style;
  lenis.on('scroll', (e) => { root.setProperty('--v', clamp(e.velocity / 40, -1, 1).toFixed(3)); });
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

const intro = { open: 0 };   // the line that opens onto the façade
let stage = null;
if (renderer) stage = createStage();
else createFallback();

function createStage() {
  /*
   * Each photograph is projected back onto a 3D room (a box seen from the inside)
   * from the exact point it was "shot" from. At rest the camera sits on that point,
   * so you see the untouched photo; as you scroll it walks forward and the floor,
   * walls and ceiling slide past with real parallax. Rooms are joined by the brand
   * line: a vertical seam of light that parts like pocket doors onto the next room.
   */
  const IMG_ASPECT = 16 / 9;
  const FOVY = 50;                                    // assumed lens of the photographs
  const ty = Math.tan(THREE.MathUtils.degToRad(FOVY / 2));
  const tx = ty * IMG_ASPECT;
  // per room: [depth of the photographed space (back wall distance), how far we walk in]
  const SHAPE = [[4, 0.38], [4.5, 0.72], [5, 0.8], [2.6, 0.5], [2.6, 0.45], [2.6, 0.45], [2.3, 0.4], [2.6, 0.45], [2.3, 0.4], [4, 0.38]];

  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOVY, innerWidth / innerHeight, 0.01, 50);
  camera.rotation.order = 'YXZ';

  const projector = new THREE.PerspectiveCamera(FOVY, IMG_ASPECT, 0.01, 100);
  projector.updateMatrixWorld();
  const projMat = new THREE.Matrix4().multiplyMatrices(projector.projectionMatrix, projector.matrixWorldInverse);

  const roomVert = /* glsl */`
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const roomFrag = /* glsl */`
    uniform sampler2D uTex;
    uniform mat4 uProj;
    uniform float uImgAspect;
    varying vec3 vWorld;
    void main() {
      vec4 p = uProj * vec4(vWorld, 1.0);
      vec2 uv = p.xy / p.w * 0.5 + 0.5;
      float r = ${IMG_ASPECT.toFixed(5)} / uImgAspect;           // cover-fit non 16:9 photos
      uv = r > 1.0 ? vec2(uv.x, (uv.y - 0.5) / r + 0.5) : vec2((uv.x - 0.5) * r + 0.5, uv.y);
      vec3 col = texture2D(uTex, clamp(uv, 0.001, 0.999)).rgb;
      // shared grade so every room reads as one shoot
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 0.88);
      col = mix(vec3(0.043, 0.043, 0.047), col, smoothstep(-0.02, 0.18, l) * 0.8 + 0.2);
      col *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), smoothstep(0.35, 1.0, l));
      col = col * col * (3.0 - 2.0 * col) * 0.2 + col * 0.8 * 1.06;
      // atmospheric depth: what is far sinks gently into the dusk
      float dist = length(vWorld - cameraPosition);
      col *= mix(1.0, 0.8, smoothstep(1.2, 4.5, dist));
      gl_FragColor = vec4(col, 1.0);
    }`;

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_, loaded, total) => setLoad(loaded / total);
  const loader = new THREE.TextureLoader(manager);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const stageRooms = rooms.map((r, i) => {
    const [L, push] = SHAPE[i] || [3, 0.45];
    const u = { uTex: { value: null }, uProj: { value: projMat }, uImgAspect: { value: IMG_ASPECT } };
    u.uTex.value = loader.load(r.src, (t) => { u.uImgAspect.value = t.image.width / t.image.height; });
    u.uTex.value.anisotropy = maxAniso;
    // box from just behind the lens (z = +1) to the back wall (z = -L); walls sit on the photo's frustum at z = -1
    const geo = new THREE.BoxGeometry(2 * tx, 2 * ty, L + 1, 1, 1, 8).translate(0, 0, (1 - L) / 2);
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: roomVert, fragmentShader: roomFrag, side: THREE.BackSide }));
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, push };
  });

  /* Dust motes hanging in the light, shared by every room */
  const COUNT = innerWidth < 768 ? 260 : 700;
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * tx * 1.8;
    pos[i * 3 + 1] = (Math.random() - 0.5) * ty * 1.8;
    pos[i * 3 + 2] = -0.3 - Math.random() * 2.6;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffd9a8, size: 0.0045, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(dust);

  /* Two render targets (current room, next room) composited through the line */
  const rtA = new THREE.WebGLRenderTarget(1, 1);
  const rtB = new THREE.WebGLRenderTarget(1, 1);
  const post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: {
      tA: { value: rtA.texture }, tB: { value: rtB.texture },
      uMix: { value: 0 }, uLine: { value: 0 }, uVel: { value: 0 }, uIntro: { value: 1 }, uHasB: { value: 0 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tA, tB;
      uniform float uMix, uLine, uVel, uIntro, uHasB;
      varying vec2 vUv;
      vec3 rgbSplit(sampler2D t, vec2 uv, vec2 d) {
        return vec3(texture2D(t, uv + d).r, texture2D(t, uv).g, texture2D(t, uv - d).b);
      }
      void main() {
        vec2 uv = vUv;
        vec2 c = uv - 0.5;
        float dx = c.x, ady = abs(c.y);
        vec3 warm = vec3(1.0, 0.8, 0.55);
        vec2 k = c * clamp(abs(uVel), 0.0, 2.0) * 0.012;           // lens split while moving

        // current room slides apart from the seam, like pocket doors
        float hw = uMix * 0.5;
        vec2 ua = vec2(uv.x - sign(dx) * hw, uv.y);
        vec3 a = rgbSplit(tA, ua, k);
        // next room settles in from a slight zoom
        vec2 ub = c / mix(1.22, 1.0, uMix) + 0.5;
        vec3 b = rgbSplit(tB, ub, k) * (0.55 + 0.45 * uMix);
        float m = smoothstep(hw + 0.002, hw - 0.002, abs(dx)) * step(0.0005, uMix) * uHasB;
        vec3 col = mix(a, b, m);

        // the line: grows from the centre, flares, then parts
        float len = smoothstep(0.0, 1.0, uLine) * 0.56;
        float vmask = smoothstep(len, len - 0.06, ady);
        float glow = uLine * (1.0 - uMix * 0.8);
        col += warm * exp(-abs(abs(dx) - hw) * 420.0) * vmask * glow * 1.6;
        col += warm * exp(-abs(dx) * 16.0) * vmask * uLine * (1.0 - uMix) * 0.22;
        col += warm * exp(-ady * 110.0) * exp(-abs(dx) * 2.2) * uLine * (1.0 - uMix) * 0.4;   // anamorphic flare
        col *= 1.0 - 0.32 * pow(length(c * vec2(1.0, 0.9)) * 1.3, 2.0);

        // intro: the same line opens onto the façade
        float ih = uIntro * 0.5;
        float im = smoothstep(ih + 0.002, ih - 0.002, abs(dx));
        float il = exp(-abs(abs(dx) - ih) * 420.0) * (1.0 - uIntro) * smoothstep(0.0, 0.08, uIntro + 0.02);
        col = mix(vec3(0.043, 0.043, 0.047), col, im) + warm * il * 1.4;
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  }));
  const postScene = new THREE.Scene();
  postScene.add(post);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const U = post.material.uniforms;

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    rtA.setSize(size.x, size.y);
    rtB.setSize(size.x, size.y);
    camera.aspect = innerWidth / innerHeight;
    // cover the photo: never see past its frame, with a little headroom for looking around
    const t = Math.min(ty, tx / camera.aspect) * 0.92;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(t));
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
  addEventListener('pointermove', (e) => { mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight * 2 - 1)); });
  const clock = new THREE.Clock();

  function shoot(i, z, t, target) {
    stageRooms.forEach((r, k) => { r.mesh.visible = k === i; });
    const breathe = Math.sin(t * 0.35) * 0.012 + 0.012;   // never drifts behind the lens
    camera.position.set(mouseS.x * 0.035, mouseS.y * 0.02 + Math.sin(t * 0.5) * 0.004, -(z + breathe));
    camera.rotation.set(mouseS.y * 0.03, -mouseS.x * 0.05, Math.sin(t * 0.27) * 0.002);
    dust.position.z = -z * 0.15;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  }

  function render(p) {
    const t = clock.getElapsedTime();
    mouseS.lerp(mouse, 0.04);
    const i = Math.min(N - 1, Math.floor(p));
    const local = i === N - 1 ? 0 : p - i;
    dust.rotation.y = t * 0.01;

    // walk into the current room for the whole segment
    shoot(i, stageRooms[i].push * local, t, rtA);
    const hasB = i < N - 1 && local > 0.3;
    if (hasB) shoot(i + 1, 0, t, rtB);

    U.uLine.value = i < N - 1 ? smooth(0.3, 0.55, local) : 0;
    U.uMix.value = i < N - 1 ? smooth(0.52, 1.0, local) : 0;
    U.uHasB.value = hasB ? 1 : 0;
    U.uVel.value = vel;
    U.uIntro.value = intro.open;
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
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
      gsap.to(intro, { open: 1, duration: 2.4, ease: 'expo.inOut', delay: 0.15 });
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
