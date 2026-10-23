(() => {
'use strict';
/* AETHER — real-time hand-tracking magic studio. Vanilla JS ES module. */
const $ = s => document.querySelector(s);
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];

/* ---------- External assets (public CDNs) ---------- */
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/* ---------- Config ---------- */
const EFFECTS = [
  { id: 'hearts', name: 'Hearts', icon: '💗' }, { id: 'flowers', name: 'Flowers', icon: '🌸' },
  { id: 'butterflies', name: 'Butterflies', icon: '🦋' }, { id: 'stars', name: 'Stars', icon: '⭐' },
  { id: 'galaxy', name: 'Galaxy', icon: '🌌' }, { id: 'fire', name: 'Fire', icon: '🔥' },
  { id: 'bubbles', name: 'Bubbles', icon: '🫧' }, { id: 'dust', name: 'Magic Dust', icon: '✨' },
  { id: 'ribbon', name: 'Neon Ribbon', icon: '〰️' }, { id: 'confetti', name: 'Confetti', icon: '🎊' },
  { id: 'lightning', name: 'Lightning', icon: '⚡' }, { id: 'draw', name: 'Air Drawing', icon: '✍️' }
];
const COLORS = [
  { n: 'Violet', v: '#C084FC' }, { n: 'Cyan', v: '#55D6FF' }, { n: 'Pink', v: '#FF77CF' },
  { n: 'Gold', v: '#FFD166' }, { n: 'Lime', v: '#A7FF83' }
];
const DEFAULTS = { size: 100, trail: 60, intensity: 60, color: '#C084FC' };
const settings = { ...DEFAULTS };
const RATE = { hearts: 12, flowers: 9, butterflies: 6, stars: 16, galaxy: 55, fire: 75, bubbles: 11, dust: 70, confetti: 45 };
const PHYS = { // g = gravity (px/s²), d = drag
  hearts: { g: -10, d: .6 }, flowers: { g: 8, d: .5 }, butterflies: { g: -8, d: .4 }, stars: { g: 6, d: .8 },
  galaxy: { g: 0, d: 1.2 }, fire: { g: -120, d: .8 }, bubbles: { g: -35, d: .3 }, dust: { g: 12, d: 1.2 }, confetti: { g: 420, d: .9 }
};
const MOBILE = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && matchMedia('(pointer:coarse)').matches);
const GLOWQ = MOBILE ? .35 : 1;          // lighter glow on phones
const DET_MIN_MS = MOBILE ? 30 : 0;      // cap detection to ~30 fps on phones
const STALE_MS = 160, LOST_MS = 420;     // dropout grace: pause effects, then drop the hand
const GLOW_TYPES = new Set(['galaxy', 'fire', 'dust']); // drawn with additive blending

/* ---------- DOM ---------- */
const stage = $('#stage'), video = $('#video'), drawCv = $('#drawCanvas'), fxCv = $('#fxCanvas');
const fx = fxCv.getContext('2d'), dctx = drawCv.getContext('2d');
const overlay = $('#overlay'), ovTitle = $('#ovTitle'), ovText = $('#ovText'), enableBtn = $('#enableBtn');
const camBtn = $('#camBtn'), pauseBtn = $('#pauseBtn'), clearBtn = $('#clearBtn');
const stageStatus = $('#stageStatus'), navStatus = $('#navStatus'), privChip = $('#privChip');

/* ---------- State ---------- */
const S = { effect: 'hearts', camOn: false, starting: false, error: null, paused: false, tracked: false,
  landmarker: null, stream: null, lastVT: -1, token: 0, simT: 0, w: 0, h: 0, dpr: 1, acc: 0, boltCd: 0,
  facing: 'user', frameReady: false, lastFrameAt: 0, useRvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
  lastTs: 0, lastDet: 0, errCount: 0, cpu: false, swapping: false, unit: 1, wake: null, pseudoFS: false };
const tip = { x: 0, y: 0, tx: 0, ty: 0, ex: null, ey: 0, speed: 0, has: false, stale: false, t: 0 };

/* ---------- Canvas sizing (video uses object-fit: cover, so we map with the same math) ---------- */
let inkExists = false;
function resize() {
  const r = stage.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (w === S.w && h === S.h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 2);
  let snap = null;
  if (S.w && inkExists) { snap = document.createElement('canvas'); snap.width = drawCv.width; snap.height = drawCv.height; snap.getContext('2d').drawImage(drawCv, 0, 0); }
  S.w = w; S.h = h; S.dpr = dpr; S.unit = Math.max(.65, Math.min(1.15, w / 820));
  for (const c of [fxCv, drawCv]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  fx.setTransform(dpr, 0, 0, dpr, 0, 0); dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (snap) { dctx.save(); dctx.setTransform(1, 0, 0, 1, 0, 0); dctx.drawImage(snap, 0, 0, snap.width, snap.height, 0, 0, drawCv.width, drawCv.height); dctx.restore(); }
  st.on = false; R.brk = true;
}
function toStage(nx, ny) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(S.w / vw, S.h / vh);
  const ox = (S.w - vw * s) / 2, oy = (S.h - vh * s) / 2;
  const px = nx * vw * s + ox;
  return [S.facing === 'user' ? S.w - px : px, ny * vh * s + oy]; // front camera preview is mirrored, so X is mirrored too
}

/* ---------- Particle pool (fixed size, no per-frame allocation) ---------- */
const MAX = 800;
const P = Array.from({ length: MAX }, () => ({ a: false, t: '', x: 0, y: 0, vx: 0, vy: 0, s: 1, r: 0, vr: 0, l: 0, m: 1, c: '#fff', c2: '#fff', k: 0, u: 0, v: 0, w: 0, e: 1, ox: 0, oy: 0 }));
let pHint = 0;
function spawn() {
  for (let i = 0; i < MAX; i++) { const j = (pHint + i) % MAX; if (!P[j].a) { pHint = (j + 1) % MAX; return P[j]; } }
  return null; // pool full: drop the particle instead of growing memory
}
function emit(type, x, y) {
  const p = spawn(); if (!p) return;
  const z = settings.size / 100 * S.unit, L = settings.trail / 60, C = settings.color;
  p.a = true; p.t = type; p.x = x; p.y = y; p.vx = p.vy = 0; p.r = rnd(0, TAU); p.vr = 0; p.k = rnd(0, 100);
  p.c = C; p.c2 = '#fff'; p.u = p.v = p.w = p.ox = p.oy = 0; p.e = 1;
  const ang = rnd(0, TAU);
  switch (type) {
    case 'hearts': { const sp = rnd(25, 80); p.s = rnd(9, 18) * z; p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp - 20; p.m = rnd(1, 1.8) * L; p.c = pick(['#FF77CF', '#C084FC', C]); p.r = rnd(-.4, .4); p.vr = rnd(-.8, .8); break; }
    case 'flowers': p.s = rnd(9, 17) * z; p.vx = rnd(-30, 30); p.vy = rnd(-45, -5); p.m = rnd(1.2, 2.2) * L; p.c = pick(['#FF77CF', '#D8B4FE', '#FFF1FB', C]); p.c2 = p.c === '#FFD166' ? '#FF77CF' : '#FFD166'; p.vr = rnd(-1, 1); break;
    case 'butterflies': p.s = rnd(8, 14) * z; p.vx = rnd(-60, 60); p.vy = rnd(-60, 0); p.m = rnd(1.6, 2.8) * L; p.c = pick(['#55D6FF', '#C084FC', '#FF77CF', C]); p.c2 = pick(['#FF77CF', '#FFD166', '#D8B4FE']); break;
    case 'stars': p.s = rnd(6, 15) * z; p.vx = rnd(-35, 35); p.vy = rnd(-45, 15); p.m = rnd(.9, 1.7) * L; p.c = pick(['#FFD166', '#C084FC', '#FFFFFF', C]); p.vr = rnd(-2, 2); break;
    case 'galaxy': p.s = rnd(.8, 2.6) * z; p.u = rnd(0, TAU); p.v = rnd(2, 5); p.w = rnd(4, 26) * z; p.e = rnd(.35, 1); p.vx = rnd(-15, 15); p.vy = rnd(-15, 15); p.m = rnd(.9, 2) * L; p.c = pick(['#C084FC', '#55D6FF', '#FF77CF', '#FFFFFF', C]); break;
    case 'fire': p.s = rnd(5, 13) * z; p.vx = rnd(-25, 25); p.vy = rnd(-110, -40); p.m = rnd(.45, 1) * L; p.c = p.k > 92 ? '#FF77CF' : p.k > 85 ? C : ''; break;
    case 'bubbles': p.s = rnd(8, 24) * z; p.vx = rnd(-12, 12); p.vy = rnd(-45, -15); p.m = rnd(1.5, 3) * L; p.c = pick(['#55D6FF', '#D8B4FE', '#FF77CF', C]); break;
    case 'dust': p.w = Math.random() < .4 ? 1 : 0; p.s = (p.w ? rnd(4, 9) : rnd(1, 3.2)) * z; p.vx = rnd(-25, 25); p.vy = rnd(-25, 25); p.m = rnd(.7, 1.5) * L; p.c = pick(['#C084FC', '#55D6FF', '#FF77CF', '#FFFFFF', C]); break;
    case 'confetti': { const sp = rnd(60, 220); p.s = rnd(4, 8) * z; p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp - 120; p.m = rnd(1.4, 2.4) * L; p.u = rnd(0, TAU); p.v = rnd(5, 12); p.w = Math.random() < .35 ? 1 : 0; p.c = pick(['#55D6FF', '#FF77CF', '#C084FC', '#FFD166', '#A7FF83', C]); p.vr = rnd(-6, 6); break; }
  }
  p.l = p.m;
}
function stepParticles(dt) {
  const t = S.simT;
  for (let i = 0; i < MAX; i++) {
    const p = P[i]; if (!p.a) continue;
    p.l -= dt; if (p.l <= 0) { p.a = false; continue; }
    const ph = PHYS[p.t], damp = Math.max(0, 1 - ph.d * dt);
    p.vx *= damp; p.vy = (p.vy + ph.g * dt) * damp;
    switch (p.t) {
      case 'butterflies': p.vx += Math.sin(t * 2.7 + p.k) * 90 * dt; p.vy += Math.cos(t * 2.1 + p.k) * 60 * dt; p.r = Math.sin(t * 1.7 + p.k) * .5; break;
      case 'flowers': p.vx += Math.sin(t * 2 + p.k) * 40 * dt; break;
      case 'bubbles': p.vx += Math.sin(t * 2.2 + p.k) * 45 * dt; break;
      case 'fire': p.vx += Math.sin(t * 9 + p.k) * 60 * dt; break;
      case 'confetti': p.u += p.v * dt; p.vx += Math.sin(t * 3 + p.k) * 40 * dt; break;
      case 'galaxy': p.u += p.v * dt; p.w += 14 * dt; p.ox = Math.cos(p.u) * p.w; p.oy = Math.sin(p.u) * p.w * p.e; break;
    }
    p.x += p.vx * dt; p.y += p.vy * dt; if (p.t !== 'butterflies') p.r += p.vr * dt;
  }
}

/* ---------- Shapes ---------- */
function heart(c, s) {
  c.beginPath(); c.moveTo(0, .9 * s);
  c.bezierCurveTo(-1.3 * s, .1 * s, -.9 * s, -.9 * s, 0, -.3 * s);
  c.bezierCurveTo(.9 * s, -.9 * s, 1.3 * s, .1 * s, 0, .9 * s); c.closePath();
}
function star5(c, s) {
  c.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? s * .45 : s, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  c.closePath();
}
function sparkle4(c, s) {
  c.beginPath(); c.moveTo(0, -s); c.quadraticCurveTo(0, 0, s, 0); c.quadraticCurveTo(0, 0, 0, s);
  c.quadraticCurveTo(0, 0, -s, 0); c.quadraticCurveTo(0, 0, 0, -s); c.closePath();
}
const FIRE = (() => { // pre-built palette: yellow → orange → red → dark ember
  const stops = [[255, 236, 120], [255, 170, 40], [255, 95, 25], [200, 30, 30], [90, 15, 30]], out = [], n = 24;
  for (let i = 0; i < n; i++) { const f = i / (n - 1) * (stops.length - 1), a = stops[Math.floor(f)], b = stops[Math.min(stops.length - 1, Math.floor(f) + 1)], m = f % 1;
    out.push(`rgb(${(a[0] + (b[0] - a[0]) * m) | 0},${(a[1] + (b[1] - a[1]) * m) | 0},${(a[2] + (b[2] - a[2]) * m) | 0})`); }
  return out;
})();

function drawParticles() {
  const IA = .6 + settings.intensity / 250;
  let comp = 'source-over';
  for (let i = 0; i < MAX; i++) {
    const p = P[i]; if (!p.a) continue;
    const f = p.l / p.m, q = 1 - f, a = Math.min(1, f * 2.4) * Math.min(1, q * 10 + .15) * IA;
    const want = GLOW_TYPES.has(p.t) ? 'lighter' : 'source-over';
    if (want !== comp) { fx.globalCompositeOperation = want; comp = want; }
    fx.globalAlpha = a;
    const X = p.x + p.ox, Y = p.y + p.oy, s = p.s;
    switch (p.t) {
      case 'hearts':
        fx.save(); fx.translate(X, Y); fx.rotate(p.r); fx.shadowColor = p.c; fx.shadowBlur = 14 * GLOWQ; fx.fillStyle = p.c; heart(fx, s); fx.fill();
        fx.shadowBlur = 0; fx.globalAlpha = a * .55; fx.fillStyle = '#fff'; fx.beginPath(); fx.ellipse(-s * .45, -s * .35, s * .22, s * .13, -.6, 0, TAU); fx.fill(); fx.restore(); break;
      case 'flowers':
        fx.save(); fx.translate(X, Y); fx.rotate(p.r); fx.shadowColor = p.c; fx.shadowBlur = 8 * GLOWQ; fx.fillStyle = p.c; fx.globalAlpha = a * .92;
        for (let k = 0; k < 6; k++) { fx.rotate(Math.PI / 3); fx.beginPath(); fx.ellipse(0, -s * .55, s * .3, s * .55, 0, 0, TAU); fx.fill(); }
        fx.shadowBlur = 0; fx.globalAlpha = a; fx.fillStyle = p.c2; fx.beginPath(); fx.arc(0, 0, s * .28, 0, TAU); fx.fill(); fx.restore(); break;
      case 'butterflies': {
        const flap = .25 + .75 * Math.abs(Math.sin(S.simT * 14 + p.k));
        fx.save(); fx.translate(X, Y); fx.rotate(p.r); fx.shadowColor = p.c; fx.shadowBlur = 10 * GLOWQ;
        for (const sd of [-1, 1]) {
          fx.save(); fx.scale(sd * flap, 1);
          fx.fillStyle = p.c; fx.beginPath(); fx.ellipse(s * .6, -s * .35, s * .65, s * .4, -.5, 0, TAU); fx.fill();
          fx.fillStyle = p.c2; fx.beginPath(); fx.ellipse(s * .42, s * .4, s * .42, s * .3, .5, 0, TAU); fx.fill(); fx.restore();
        }
        fx.shadowBlur = 0; fx.fillStyle = '#F6F1FF'; fx.beginPath(); fx.ellipse(0, 0, s * .09, s * .55, 0, 0, TAU); fx.fill();
        fx.strokeStyle = '#F6F1FF'; fx.lineWidth = 1; fx.beginPath(); fx.moveTo(0, -s * .5); fx.quadraticCurveTo(-s * .2, -s * .9, -s * .35, -s * .95);
        fx.moveTo(0, -s * .5); fx.quadraticCurveTo(s * .2, -s * .9, s * .35, -s * .95); fx.stroke(); fx.restore(); break; }
      case 'stars':
        fx.save(); fx.translate(X, Y); fx.rotate(p.r); fx.shadowColor = p.c; fx.shadowBlur = 12 * GLOWQ; fx.fillStyle = p.c; star5(fx, s); fx.fill(); fx.restore(); break;
      case 'galaxy':
        fx.fillStyle = p.c; fx.beginPath(); fx.arc(X, Y, s, 0, TAU); fx.fill();
        if (s > 1.8) { fx.globalAlpha = a * .25; fx.beginPath(); fx.arc(X, Y, s * 3, 0, TAU); fx.fill(); } break;
      case 'fire': {
        const col = p.c || FIRE[Math.min(FIRE.length - 1, (q * FIRE.length) | 0)], r = s * (1 - q * .6);
        fx.fillStyle = col; fx.globalAlpha = a * .22; fx.beginPath(); fx.arc(X, Y, r * 2.2, 0, TAU); fx.fill();
        fx.globalAlpha = a * .9; fx.beginPath(); fx.arc(X, Y, r, 0, TAU); fx.fill(); break; }
      case 'bubbles':
        fx.lineWidth = 1.5; fx.strokeStyle = p.c; fx.fillStyle = p.c;
        fx.globalAlpha = a * .12; fx.beginPath(); fx.arc(X, Y, s, 0, TAU); fx.fill();
        fx.globalAlpha = a * .85; fx.stroke();
        fx.globalAlpha = a * .8; fx.strokeStyle = '#fff'; fx.lineWidth = 1.8; fx.beginPath(); fx.arc(X, Y, s * .68, 3.5, 4.4); fx.stroke();
        fx.fillStyle = '#fff'; fx.beginPath(); fx.arc(X - s * .35, Y - s * .38, Math.max(1, s * .1), 0, TAU); fx.fill(); break;
      case 'dust': {
        const fl = .6 + .4 * Math.sin(S.simT * 22 + p.k); fx.fillStyle = p.c;
        if (p.w) { fx.save(); fx.translate(X, Y); fx.rotate(p.r * .3); fx.globalAlpha = a * fl; sparkle4(fx, s); fx.fill();
          fx.globalAlpha = a * fl * .3; fx.beginPath(); fx.arc(0, 0, s * .8, 0, TAU); fx.fill(); fx.restore(); }
        else { fx.globalAlpha = a * fl * .25; fx.beginPath(); fx.arc(X, Y, s * 3, 0, TAU); fx.fill(); fx.globalAlpha = a * fl; fx.beginPath(); fx.arc(X, Y, s, 0, TAU); fx.fill(); }
        break; }
      case 'confetti':
        fx.save(); fx.translate(X, Y); fx.rotate(p.r); fx.scale(1, Math.cos(p.u)); fx.fillStyle = p.c;
        if (p.w) { fx.beginPath(); fx.moveTo(0, -s); fx.lineTo(s, s * .8); fx.lineTo(-s, s * .8); fx.closePath(); fx.fill(); }
        else fx.fillRect(-s, -s * .55, s * 2, s * 1.1);
        fx.restore(); break;
    }
  }
  fx.globalAlpha = 1; fx.globalCompositeOperation = 'source-over'; fx.shadowBlur = 0;
}

/* ---------- Neon ribbon (ring buffer of recent fingertip points) ---------- */
const RN = 160;
const R = { x: new Float32Array(RN), y: new Float32Array(RN), t: new Float32Array(RN), b: new Uint8Array(RN), n: 0, h: 0, brk: true };
const TX = new Float32Array(RN), TY = new Float32Array(RN), TA = new Float32Array(RN), TB = new Uint8Array(RN);
function ribbonAdd(x, y) {
  if (R.n && !R.brk) { const j = (R.h - 1 + RN) % RN; if (Math.hypot(R.x[j] - x, R.y[j] - y) < 1.5) return; }
  const i = R.h; R.x[i] = x; R.y[i] = y; R.t[i] = S.simT; R.b[i] = R.brk ? 1 : 0; R.brk = false;
  R.h = (i + 1) % RN; R.n = Math.min(RN, R.n + 1);
}
function drawRibbon() {
  if (!R.n) return;
  const life = .2 + settings.trail * .013, base = 5 * settings.size / 100 * S.unit;
  let m = 0;
  for (let k = 0; k < R.n; k++) {
    const i = (R.h - R.n + k + RN) % RN, age = S.simT - R.t[i];
    if (age <= life) { TX[m] = R.x[i]; TY[m] = R.y[i]; TA[m] = age; TB[m] = R.b[i]; m++; }
  }
  if (m < 3) return;
  fx.lineCap = 'round'; fx.lineJoin = 'round'; fx.strokeStyle = settings.color;
  const passes = [[3.4, .28, settings.color, 'lighter'], [1.1, .9, settings.color, 'lighter'], [.4, .95, '#ffffff', 'source-over']];
  for (const [mul, pa, col, comp] of passes) {
    fx.globalCompositeOperation = comp; fx.strokeStyle = col;
    for (let i = 1; i < m - 1; i++) {
      if (TB[i] || TB[i + 1]) continue;
      const al = 1 - TA[i] / life;
      fx.globalAlpha = pa * al; fx.lineWidth = base * mul * (.35 + .65 * al);
      fx.beginPath(); fx.moveTo((TX[i - 1] + TX[i]) / 2, (TY[i - 1] + TY[i]) / 2);
      fx.quadraticCurveTo(TX[i], TY[i], (TX[i] + TX[i + 1]) / 2, (TY[i] + TY[i + 1]) / 2); fx.stroke();
    }
  }
  fx.globalAlpha = 1; fx.globalCompositeOperation = 'source-over';
}

/* ---------- Lightning (short-lived pooled bolts) ---------- */
const bolts = Array.from({ length: 14 }, () => ({ a: false, l: 0, m: 1, n: 0, z: 1, c: '#fff', p: new Float32Array(24) }));
function spawnBolt(x, y, len, ang) {
  const b = bolts.find(o => !o.a); if (!b) return;
  const n = 7 + ((Math.random() * 4) | 0), dx = Math.cos(ang), dy = Math.sin(ang);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), j = (i === 0 || i === n - 1) ? 0 : rnd(-1, 1) * len * .14;
    b.p[2 * i] = x + dx * len * t - dy * j; b.p[2 * i + 1] = y + dy * len * t + dx * j;
  }
  b.n = n; b.l = b.m = rnd(.1, .18); b.a = true; b.c = settings.color; b.z = settings.size / 100 * S.unit;
}
function drawBolts() {
  fx.lineCap = 'round'; fx.lineJoin = 'round'; fx.globalCompositeOperation = 'lighter';
  for (const b of bolts) {
    if (!b.a) continue;
    const al = (b.l / b.m) * (.6 + .4 * Math.random());
    fx.beginPath(); fx.moveTo(b.p[0], b.p[1]);
    for (let i = 1; i < b.n; i++) fx.lineTo(b.p[2 * i], b.p[2 * i + 1]);
    fx.strokeStyle = b.c; fx.globalAlpha = al * .3; fx.lineWidth = 8 * b.z; fx.stroke();
    fx.globalAlpha = al * .8; fx.lineWidth = 3 * b.z; fx.stroke();
    fx.strokeStyle = '#fff'; fx.globalAlpha = al; fx.lineWidth = 1.4 * b.z; fx.stroke();
  }
  fx.globalAlpha = 1; fx.globalCompositeOperation = 'source-over';
}

/* ---------- Air drawing (persistent layer, smoothed quadratic strokes) ---------- */
const st = { on: false, lx: 0, ly: 0, mx: 0, my: 0 };
function inkStyle() {
  dctx.lineCap = dctx.lineJoin = 'round'; dctx.strokeStyle = dctx.fillStyle = settings.color;
  dctx.lineWidth = Math.max(2, 6 * settings.size / 100 * S.unit); dctx.shadowColor = settings.color; dctx.shadowBlur = 8 * GLOWQ;
}
function drawTo(x, y) {
  inkStyle();
  if (!st.on) { st.on = true; st.lx = st.mx = x; st.ly = st.my = y; dctx.beginPath(); dctx.arc(x, y, dctx.lineWidth / 2, 0, TAU); dctx.fill(); inkExists = true; return; }
  if (Math.hypot(x - st.lx, y - st.ly) < .4) return;
  const mx = (st.lx + x) / 2, my = (st.ly + y) / 2;
  dctx.beginPath(); dctx.moveTo(st.mx, st.my); dctx.quadraticCurveTo(st.lx, st.ly, mx, my); dctx.stroke();
  st.lx = x; st.ly = y; st.mx = mx; st.my = my;
}
function endStroke() {
  if (st.on) { inkStyle(); dctx.beginPath(); dctx.moveTo(st.mx, st.my); dctx.lineTo(st.lx, st.ly); dctx.stroke(); }
  st.on = false;
}

/* ---------- Tracking ---------- */
// Detection updates a *target*; every rendered frame the visible fingertip glides to it (time-based),
// so motion stays smooth even when detection runs slower than the screen (phones) or drops a frame.
function onTip(nx, ny) {
  const [rx, ry] = toStage(nx, ny), now = performance.now();
  if (!tip.has) {
    tip.x = tip.tx = rx; tip.y = tip.ty = ry; tip.has = true; tip.stale = false; tip.ex = null; tip.speed = 0; R.brk = true; st.on = false;
    if (!S.tracked) { S.tracked = true; refresh(); }
  } else {
    const dtm = Math.max(.008, (now - tip.t) / 1000), d = Math.hypot(rx - tip.tx, ry - tip.ty);
    tip.speed += (d / dtm - tip.speed) * .4; tip.tx = rx; tip.ty = ry; tip.stale = false;
  }
  tip.t = now;
}
function updateTip(dt, now) {
  if (!tip.has) return;
  const age = now - tip.t;
  if (age > LOST_MS) { loseTip(); return; }       // hand really gone
  tip.stale = age > STALE_MS;                     // brief dropout: keep the stroke, stop emitting
  const k = 1 - Math.exp(-dt * (14 + Math.min(30, tip.speed / 45)));
  tip.x += (tip.tx - tip.x) * k; tip.y += (tip.ty - tip.y) * k;
  if (!S.paused && !tip.stale) { if (S.effect === 'ribbon') ribbonAdd(tip.x, tip.y); else if (S.effect === 'draw') drawTo(tip.x, tip.y); }
}
function loseTip() {
  tip.has = false; tip.stale = false; tip.ex = null; endStroke(); R.brk = true;
  if (S.tracked) { S.tracked = false; refresh(); }
}
function armFrames(token) { // fires once per *new* camera frame
  if (!S.useRvfc) return;
  const cb = () => { if (token !== S.token || !S.camOn) return; S.frameReady = true; S.lastFrameAt = performance.now(); video.requestVideoFrameCallback(cb); };
  video.requestVideoFrameCallback(cb);
}
function detect(now) {
  if (!S.landmarker || !S.camOn || S.swapping || video.readyState < 2) return;
  if (S.useRvfc) { if (now - S.lastFrameAt > 1500) S.useRvfc = false; else if (!S.frameReady) return; }   // watchdog → polling fallback
  else if (video.currentTime === S.lastVT) return;
  if (DET_MIN_MS && now - S.lastDet < DET_MIN_MS) return;
  S.frameReady = false; S.lastVT = video.currentTime; S.lastDet = now;
  let res;
  try { const ts = Math.max(performance.now(), S.lastTs + 1); S.lastTs = ts; res = S.landmarker.detectForVideo(video, ts); S.errCount = 0; }
  catch (e) { if (++S.errCount >= 5) fallbackToCpu(); return; }
  const lm = res && res.landmarks && res.landmarks[0];
  if (lm) onTip(lm[8].x, lm[8].y); // landmark 8 = index fingertip
}
async function fallbackToCpu() { // some phones/GPUs initialise but then fail while detecting
  if (S.swapping || S.cpu) return; S.swapping = true; const token = S.token;
  try {
    const lm = await createLandmarker(true);
    if (token !== S.token) { try { lm.close(); } catch { } return; }
    const old = S.landmarker; S.landmarker = lm; try { old && old.close(); } catch { } toast('Switched to compatibility mode');
  } catch (e) { console.error(e); } finally { S.swapping = false; S.errCount = 0; }
}

/* ---------- Emission ---------- */
function emitLoop(dt) {
  if (!tip.has || tip.stale) { tip.ex = null; return; }
  if (tip.ex == null) { tip.ex = tip.x; tip.ey = tip.y; }
  const eff = S.effect, mult = settings.intensity / 60 * (MOBILE ? .75 : 1);
  if (RATE[eff]) {
    S.acc += RATE[eff] * mult * (.4 + Math.min(1.6, tip.speed / 450)) * dt;
    let n = 0;
    while (S.acc >= 1 && n < 12) { S.acc -= 1; n++; const t = Math.random();
      emit(eff, tip.ex + (tip.x - tip.ex) * t + rnd(-4, 4), tip.ey + (tip.y - tip.ey) * t + rnd(-4, 4)); }
    if (S.acc >= 1) S.acc = 0;
  } else if (eff === 'lightning') {
    S.boltCd -= dt;
    if (S.boltCd <= 0 && tip.speed > 25) {
      S.boltCd = .07 / mult * rnd(.8, 1.4);
      const z = settings.size / 100 * S.unit, n = Math.random() < .3 * mult ? 2 : 1;
      for (let i = 0; i < n; i++) spawnBolt(tip.x, tip.y, rnd(45, 120) * z, rnd(0, TAU));
    }
  }
  tip.ex = tip.x; tip.ey = tip.y;
}

/* ---------- Main loop (single rAF loop for the whole page lifetime) ---------- */
let last = performance.now(), fpsN = 0, fpsT = last;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (++fpsN && now - fpsT >= 500) { $('#fpsVal').textContent = S.camOn ? Math.round(fpsN * 1000 / (now - fpsT)) : '--'; fpsN = 0; fpsT = now; }
  const pnow = performance.now();
  detect(pnow); updateTip(dt, pnow);
  if (!S.paused) {
    S.simT += dt; emitLoop(dt); stepParticles(dt);
    for (const b of bolts) if (b.a && (b.l -= dt) <= 0) b.a = false;
  }
  fx.clearRect(0, 0, S.w, S.h);
  drawParticles(); drawRibbon(); drawBolts(); drawHalo();
}
function drawHalo() {
  if (!tip.has) return;
  const pulse = .5 + .5 * Math.sin(performance.now() / 260), r = (12 + pulse * 5) * (.7 + settings.size / 300) * S.unit;
  fx.save(); fx.globalCompositeOperation = 'lighter'; fx.strokeStyle = settings.color; fx.lineWidth = 2; fx.globalAlpha = .9;
  fx.shadowColor = settings.color; fx.shadowBlur = 16 * GLOWQ; fx.beginPath(); fx.arc(tip.x, tip.y, r, 0, TAU); fx.stroke();
  fx.fillStyle = '#fff'; fx.beginPath(); fx.arc(tip.x, tip.y, 3, 0, TAU); fx.fill(); fx.restore();
}

/* ---------- Status & overlay ---------- */
function setPill(el, code, text) { el.dataset.state = code; el.querySelector('span').textContent = text; }
function refresh() {
  const [code, text] = S.error ? ['err', 'CAMERA ERROR'] : S.starting ? ['warn', 'STARTING CAMERA'] : !S.camOn ? ['off', 'CAMERA OFF']
    : S.paused ? ['warn', 'EFFECTS PAUSED'] : S.tracked ? ['ok', 'HAND TRACKED'] : ['warn', 'SHOW ONE HAND'];
  setPill(stageStatus, code, text);
  setPill(navStatus, ...(S.error ? ['err', 'CAMERA ERROR'] : S.starting ? ['warn', 'STARTING CAMERA'] : S.camOn ? ['ok', 'CAMERA LIVE'] : ['off', 'CAMERA OFF']));
  setPill(privChip, S.camOn ? 'ok' : 'off', S.camOn ? 'Camera on · stays local' : 'Camera off');
  camBtn.textContent = S.camOn ? 'Turn camera off' : S.starting ? 'Cancel' : 'Enable camera';
  pauseBtn.textContent = S.paused ? 'Resume effects' : 'Pause effects'; pauseBtn.setAttribute('aria-pressed', S.paused);
  stage.classList.toggle('live', S.camOn); $('#flipBtn').disabled = !S.camOn;
}
function showOverlay(mode, msg) {
  overlay.hidden = false; overlay.dataset.mode = mode; enableBtn.hidden = mode === 'loading';
  if (mode === 'loading') { ovTitle.textContent = 'Summoning the magic…'; ovText.textContent = msg; }
  else if (mode === 'error') { ovTitle.textContent = 'Camera problem'; ovText.textContent = msg; enableBtn.textContent = 'Try again'; }
  else { ovTitle.textContent = 'Enable your camera'; ovText.textContent = 'AETHER asks for camera access only after you click. Video stays in your browser. Nothing is recorded or uploaded.'; enableBtn.textContent = 'Enable camera'; }
}
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }
function explain(e) {
  const n = e && (e.name || e.code);
  if (n === 'insecure') return location.protocol === 'file:' ? 'Open this page through VS Code Live Server (http://127.0.0.1:5500), not by double-clicking the file.' : 'Phones only allow the camera on HTTPS pages. Put the folder on Netlify Drop or GitHub Pages and open the https:// link (see the README, “Using AETHER on your phone”).';
  if (n === 'unsupported') return 'This browser does not support camera access. Use a current version of Chrome or Edge.';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'Camera permission was blocked. Click the camera icon in the address bar, allow access, then press Try again.';
  if (n === 'SecurityError') return 'The browser blocked camera access. Make sure the page is on localhost or HTTPS and not inside a restricted frame.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return 'No camera was found. Connect a webcam and press Try again.';
  if (n === 'NotReadableError' || n === 'TrackStartError') return 'The camera is busy. Close other apps or tabs that use it, then press Try again.';
  if (n === 'model') return 'The hand-tracking model could not load. Check your internet connection (it downloads from jsDelivr and Google storage) and press Try again.';
  return 'Something went wrong starting the camera: ' + ((e && e.message) || 'unknown error') + '.';
}

/* ---------- Camera lifecycle ---------- */
let visionMod = null, fileset = null;
async function createLandmarker(forceCpu) {
  if (!visionMod) visionMod = await import(`${MP}/vision_bundle.mjs`);
  const { HandLandmarker, FilesetResolver } = visionMod;
  if (!fileset) fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const opts = d => ({ baseOptions: { modelAssetPath: MODEL, delegate: d }, runningMode: 'VIDEO', numHands: 1,
    minHandDetectionConfidence: .5, minHandPresenceConfidence: .4, minTrackingConfidence: .4 });
  if (!forceCpu) { try { return await HandLandmarker.createFromOptions(fileset, opts('GPU')); } catch (e) { console.warn('GPU delegate unavailable, using CPU.', e); } }
  S.cpu = true; return await HandLandmarker.createFromOptions(fileset, opts('CPU'));
}
function constraints() {
  const portrait = innerHeight > innerWidth;
  const dims = MOBILE ? (portrait ? { width: { ideal: 480 }, height: { ideal: 640 } } : { width: { ideal: 640 }, height: { ideal: 480 } }) : { width: { ideal: 960 }, height: { ideal: 540 } };
  return { video: { facingMode: S.facing, frameRate: { ideal: 30, max: 30 }, ...dims }, audio: false };
}
async function lockScreen() { try { if ('wakeLock' in navigator && !S.wake) S.wake = await navigator.wakeLock.request('screen'); } catch { } }
function unlockScreen() { try { S.wake && S.wake.release(); } catch { } S.wake = null; }
async function startCamera() {
  if (S.starting || S.camOn) return;
  S.error = null; S.starting = true; const token = ++S.token; refresh(); showOverlay('loading', 'Requesting camera access…');
  try {
    if (!window.isSecureContext) throw { name: 'insecure' };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw { name: 'unsupported' };
    const stream = await navigator.mediaDevices.getUserMedia(constraints());
    if (token !== S.token) { stream.getTracks().forEach(t => t.stop()); return; }
    S.stream = stream; video.srcObject = stream; stage.classList.toggle('back', S.facing !== 'user'); await video.play();
    showOverlay('loading', 'Loading the hand-tracking model…');
    let lm; try { lm = await createLandmarker(); } catch (e) { console.error(e); throw { name: 'model' }; }
    if (token !== S.token) { try { lm.close(); } catch { } return; }
    S.landmarker = lm; S.camOn = true; S.starting = false; S.lastVT = -1; S.errCount = 0; S.frameReady = false; S.lastFrameAt = performance.now();
    armFrames(token); lockScreen(); overlay.hidden = true; refresh();
  } catch (e) {
    if (token !== S.token) return;
    console.error(e); stopCamera(true); S.error = explain(e); refresh(); showOverlay('error', S.error);
  }
}
function stopCamera(keepError) {
  S.token++;
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  video.pause(); video.srcObject = null;
  if (S.landmarker) { try { S.landmarker.close(); } catch { } S.landmarker = null; }
  unlockScreen(); S.camOn = false; S.starting = false; S.swapping = false; if (!keepError) S.error = null;
  loseTip(); refresh(); if (!keepError) showOverlay('idle');
}

/* ---------- Controls ---------- */
const grid = $('#effectGrid');
for (const e of EFFECTS) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'fx'; b.dataset.id = e.id; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<span class="ic" aria-hidden="true">${e.icon}</span><span>${e.name}</span>`; b.addEventListener('click', () => setEffect(e.id)); grid.append(b);
}
const sw = $('#swatches');
for (const c of COLORS) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'sw'; b.style.setProperty('--c', c.v); b.dataset.v = c.v;
  b.setAttribute('aria-label', c.n); b.title = c.n; b.addEventListener('click', () => { settings.color = c.v; syncUI(); }); sw.append(b);
}
function setEffect(id) {
  S.effect = id; S.acc = 0; endStroke(); R.brk = true;
  const e = EFFECTS.find(x => x.id === id); $('#fxName').textContent = `${e.name} ${e.icon}`;
  grid.querySelectorAll('.fx').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
}
function syncUI() {
  for (const k of ['size', 'trail', 'intensity']) { $(`#${k}Range`).value = settings[k]; $(`#${k}Out`).textContent = settings[k] + '%'; }
  sw.querySelectorAll('.sw').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === settings.color));
  document.documentElement.style.setProperty('--glow', settings.color);
}
for (const k of ['size', 'trail', 'intensity']) $(`#${k}Range`).addEventListener('input', e => { settings[k] = +e.target.value; $(`#${k}Out`).textContent = settings[k] + '%'; });
$('#resetBtn').addEventListener('click', () => { Object.assign(settings, DEFAULTS); syncUI(); toast('Settings reset'); });
camBtn.addEventListener('click', () => (S.camOn || S.starting) ? stopCamera() : startCamera());
enableBtn.addEventListener('click', startCamera);
pauseBtn.addEventListener('click', () => { S.paused = !S.paused; endStroke(); R.brk = true; refresh(); });
clearBtn.addEventListener('click', () => {
  for (const p of P) p.a = false; for (const b of bolts) b.a = false;
  R.n = 0; R.brk = true; st.on = false; inkExists = false; S.acc = 0;
  dctx.save(); dctx.setTransform(1, 0, 0, 1, 0, 0); dctx.clearRect(0, 0, drawCv.width, drawCv.height); dctx.restore();
});
async function flipCamera() {
  if (!S.camOn || S.swapping) return;
  S.swapping = true; const prev = S.facing; S.facing = prev === 'user' ? 'environment' : 'user';
  S.stream.getTracks().forEach(t => t.stop()); // release first: many phones can't open two cameras at once
  try {
    S.stream = await navigator.mediaDevices.getUserMedia(constraints());
  } catch (e) {
    S.facing = prev; toast('Could not switch camera.');
    try { S.stream = await navigator.mediaDevices.getUserMedia(constraints()); } catch (e2) { S.swapping = false; stopCamera(true); S.error = explain(e2); refresh(); showOverlay('error', S.error); return; }
  }
  video.srcObject = S.stream; stage.classList.toggle('back', S.facing !== 'user');
  try { await video.play(); } catch { }
  loseTip(); S.lastFrameAt = performance.now(); S.swapping = false;
}
const fsReq = () => stage.requestFullscreen || stage.webkitRequestFullscreen;
function updateFs() {
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement || S.pseudoFS);
  document.querySelectorAll('.fs-label').forEach(l => l.textContent = on ? 'Exit fullscreen' : 'Fullscreen');
}
function setPseudo(on) { S.pseudoFS = on; stage.classList.toggle('pseudo-fs', on); document.body.classList.toggle('noscroll', on); updateFs(); resize(); }
async function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) { try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch { } return; }
  if (S.pseudoFS) return setPseudo(false);
  const req = fsReq();
  if (req) { try { await req.call(stage); return; } catch { } }
  setPseudo(true); // iPhone Safari has no element fullscreen: use an in-page full-window mode
}
document.querySelectorAll('.js-fs').forEach(b => b.addEventListener('click', toggleFullscreen));
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { updateFs(); resize(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.pseudoFS) setPseudo(false); });
$('#flipBtn').addEventListener('click', flipCamera);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.camOn) return;
  const t = S.stream && S.stream.getVideoTracks()[0];
  if (!t || t.readyState === 'ended') { stopCamera(); startCamera(); } else { lockScreen(); video.play().catch(() => { }); }
});
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
window.addEventListener('pagehide', () => stopCamera());
new ResizeObserver(resize).observe(stage);

/* ---------- Init ---------- */
syncUI(); setEffect('hearts'); resize(); refresh(); showOverlay('idle');
requestAnimationFrame(frame);

})();
