import * as THREE from 'three';
import { RNG, clamp, lerp, smoothstep } from './utils.js';

// ---------------------------------------------------------------------------
// Every texture in the game is painted procedurally on a canvas at load time.
// No image assets are needed.
// ---------------------------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

// Tileable value noise
class TileNoise {
  constructor(rng, period) {
    this.p = period;
    this.v = new Float32Array(period * period);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rng.next();
  }
  sample(x, y) {
    const p = this.p;
    const xi = Math.floor(x), yi = Math.floor(y);
    let xf = x - xi, yf = y - yi;
    xf = xf * xf * (3 - 2 * xf);
    yf = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = this.v[y0 * p + x0], b = this.v[y0 * p + x1];
    const c = this.v[y1 * p + x0], d = this.v[y1 * p + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
}

class FBM {
  constructor(rng, periods = [4, 8, 16, 32, 64]) {
    this.oct = periods.map((p) => new TileNoise(rng, p));
  }
  // u,v in [0,1)
  get(u, v, sx = 1, sy = 1) {
    let sum = 0, amp = 0.5, norm = 0;
    for (const n of this.oct) {
      sum += n.sample(u * n.p * sx, v * n.p * sy) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  }
}

function toTexture(canvas, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function hsl(h, s, l) {
  return `hsl(${h},${s}%,${l}%)`;
}

// Draw a function at the 9 wrapped positions so shapes tile seamlessly
function wrapDraw(w, h, x, y, fn) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) fn(x + ox * w, y + oy * h);
}

// Apply per-pixel noise grain, moss and darkening to an existing canvas
function grain(ctx, w, h, fbm, { amount = 0.35, moss = 0, mossColor = [70, 110, 40], mossScale = 1, dark = null } = {}) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const i = (y * w + x) * 4;
      const n = fbm.get(u, v, 2, 2);
      const fine = fbm.oct[4].sample(u * 64 * 4, v * 64 * 4);
      let k = 1 - amount * 0.5 + amount * (n * 0.7 + fine * 0.3);
      if (dark) k *= dark(u, v);
      let r = d[i] * k, g = d[i + 1] * k, b = d[i + 2] * k;
      if (moss > 0) {
        const m = smoothstep(1 - moss, 1 - moss + 0.12, fbm.get(u + 0.37, v + 0.71, mossScale, mossScale));
        if (m > 0) {
          const mk = 0.75 + fine * 0.5;
          r = lerp(r, mossColor[0] * mk, m);
          g = lerp(g, mossColor[1] * mk, m);
          b = lerp(b, mossColor[2] * mk, m);
        }
      }
      d[i] = clamp(r, 0, 255);
      d[i + 1] = clamp(g, 0, 255);
      d[i + 2] = clamp(b, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

function crack(ctx, rng, x, y, len, width) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = rng.range(0, Math.PI * 2);
  for (let i = 0; i < len; i++) {
    a += rng.range(-0.7, 0.7);
    x += Math.cos(a) * rng.range(3, 8);
    y += Math.sin(a) * rng.range(3, 8);
    ctx.lineTo(x, y);
    if (rng.chance(0.12)) crack(ctx, rng, x, y, Math.floor(len / 3), width * 0.6);
  }
  ctx.lineWidth = width;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Flagstone floor of the causeway (covers 5x5 world units)
// ---------------------------------------------------------------------------
function stoneFloor(rng) {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  const fbm = new FBM(rng);
  ctx.fillStyle = '#2e2a22';
  ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#000';
  bctx.fillRect(0, 0, S, S);

  // rows
  const rows = [];
  let y = 0;
  while (y < S) {
    let hgt = rng.pick([96, 128, 128, 160]);
    if (S - y - hgt < 80) hgt = S - y;
    rows.push([y, hgt]);
    y += hgt;
  }
  for (const [ry, rh] of rows) {
    let x = rng.range(0, 120);
    const start = x;
    while (x < start + S) {
      let w = rng.range(90, 210);
      if (start + S - x - w < 70) w = start + S - x;
      const hue = rng.range(30, 48);
      const sat = rng.range(8, 20);
      const lit = rng.range(42, 60);
      const gap = 4;
      wrapDraw(S, S, x, ry, (px, py) => {
        // stone body
        ctx.fillStyle = hsl(hue, sat, lit);
        roundRect(ctx, px + gap, py + gap, w - gap * 2, rh - gap * 2, 10);
        ctx.fill();
        // bevel highlights
        const gr = ctx.createLinearGradient(px, py, px + w, py + rh);
        gr.addColorStop(0, 'rgba(255,245,220,0.18)');
        gr.addColorStop(0.5, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(0,0,0,0.28)');
        ctx.fillStyle = gr;
        roundRect(ctx, px + gap, py + gap, w - gap * 2, rh - gap * 2, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 3;
        roundRect(ctx, px + gap + 1.5, py + gap + 1.5, w - gap * 2 - 3, rh - gap * 2 - 3, 9);
        ctx.stroke();
        // bump
        bctx.fillStyle = '#9a9a9a';
        roundRect(bctx, px + gap, py + gap, w - gap * 2, rh - gap * 2, 10);
        bctx.fill();
        bctx.fillStyle = '#d0d0d0';
        roundRect(bctx, px + gap + 6, py + gap + 6, w - gap * 2 - 12, rh - gap * 2 - 12, 8);
        bctx.fill();
      });
      // cracks
      if (rng.chance(0.35)) {
        const cx = x + rng.range(10, w - 10), cy = ry + rng.range(10, rh - 10);
        const seed = rng.int(1, 1e6);
        wrapDraw(S, S, cx, cy, (px, py) => {
          const r2 = new RNG(seed);
          ctx.strokeStyle = 'rgba(20,16,10,0.75)';
          crack(ctx, r2, px, py, 10, 1.6);
          const r3 = new RNG(seed);
          bctx.strokeStyle = '#303030';
          crack(bctx, r3, px, py, 10, 2.5);
        });
      }
      x += w;
    }
  }
  grain(ctx, S, S, fbm, { amount: 0.55, moss: 0.22, mossColor: [72, 104, 38], mossScale: 1.4 });
  grain(bctx, S, S, fbm, { amount: 0.3 });
  return { map: toTexture(c), bump: toTexture(bc, { srgb: false }) };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Temple masonry (walls, curbs, ruins) - running bond blocks with stains
// ---------------------------------------------------------------------------
function templeWall(rng) {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  const fbm = new FBM(rng);
  ctx.fillStyle = '#26221b';
  ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#000';
  bctx.fillRect(0, 0, S, S);
  const rowH = 64;
  for (let r = 0; r < S / rowH; r++) {
    const blockW = 128;
    const off = (r % 2) * 64;
    const glyphRow = r === 3;
    for (let i = -1; i < S / blockW + 1; i++) {
      const x = i * blockW + off, y = r * rowH;
      const lit = rng.range(34, 50);
      ctx.fillStyle = hsl(rng.range(28, 44), rng.range(8, 18), lit);
      ctx.fillRect(x + 3, y + 3, blockW - 6, rowH - 6);
      const gr = ctx.createLinearGradient(0, y, 0, y + rowH);
      gr.addColorStop(0, 'rgba(255,240,210,0.16)');
      gr.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = gr;
      ctx.fillRect(x + 3, y + 3, blockW - 6, rowH - 6);
      bctx.fillStyle = '#aaa';
      bctx.fillRect(x + 3, y + 3, blockW - 6, rowH - 6);
      if (glyphRow) {
        // carved glyph band
        const cx = x + blockW / 2, cy = y + rowH / 2;
        carve(ctx, bctx, null, (g) => {
          g.beginPath();
          g.arc(cx, cy, 18, 0, Math.PI * 2);
          g.moveTo(cx + 9, cy);
          g.arc(cx, cy, 9, 0, Math.PI * 2);
          g.moveTo(cx - 40, cy - 20); g.lineTo(cx - 28, cy); g.lineTo(cx - 40, cy + 20);
          g.moveTo(cx + 40, cy - 20); g.lineTo(cx + 28, cy); g.lineTo(cx + 40, cy + 20);
        });
      }
    }
  }
  // water stains
  for (let i = 0; i < 14; i++) {
    const x = rng.range(0, S), w = rng.range(8, 30);
    const gr = ctx.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, 'rgba(10,20,5,0.35)');
    gr.addColorStop(1, 'rgba(10,20,5,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(x, 0, w, rng.range(100, S));
  }
  grain(ctx, S, S, fbm, { amount: 0.6, moss: 0.3, mossColor: [60, 92, 34], mossScale: 1.2 });
  grain(bctx, S, S, fbm, { amount: 0.35 });
  return { map: toTexture(c), bump: toTexture(bc, { srgb: false }) };
}

function carve(ctx, bctx, _unused, pathFn) {
  // shadow / highlight offset gives a chiselled look
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,240,200,0.25)';
  ctx.lineWidth = 6;
  ctx.translate(1.5, 1.5);
  pathFn(ctx);
  ctx.stroke();
  ctx.translate(-3, -3);
  ctx.strokeStyle = 'rgba(15,10,5,0.8)';
  ctx.lineWidth = 5;
  pathFn(ctx);
  ctx.stroke();
  ctx.restore();
  bctx.save();
  bctx.lineCap = 'round';
  bctx.strokeStyle = '#222';
  bctx.lineWidth = 6;
  pathFn(bctx);
  bctx.stroke();
  bctx.restore();
}

// ---------------------------------------------------------------------------
// Big carved panel for dead-end walls, gateways and the temple facade
// ---------------------------------------------------------------------------
function glyphPanel(rng) {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  const fbm = new FBM(rng);
  ctx.fillStyle = '#6d6250';
  ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#999';
  bctx.fillRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  // frame
  carve(ctx, bctx, null, (g) => {
    g.beginPath();
    g.rect(18, 18, S - 36, S - 36);
    g.rect(40, 40, S - 80, S - 80);
  });
  // stepped meander border
  carve(ctx, bctx, null, (g) => {
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const x = 52 + i * 34;
      g.moveTo(x, 60); g.lineTo(x, 80); g.lineTo(x + 17, 80); g.lineTo(x + 17, 68); g.lineTo(x + 8, 68);
      g.moveTo(x, S - 60); g.lineTo(x, S - 80); g.lineTo(x + 17, S - 80); g.lineTo(x + 17, S - 68); g.lineTo(x + 8, S - 68);
    }
  });
  // sun disk with rays
  carve(ctx, bctx, null, (g) => {
    g.beginPath();
    g.arc(cx, cy, 120, 0, Math.PI * 2);
    g.moveTo(cx + 95, cy);
    g.arc(cx, cy, 95, 0, Math.PI * 2);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.moveTo(cx + Math.cos(a) * 125, cy + Math.sin(a) * 125);
      g.lineTo(cx + Math.cos(a + 0.1) * 160, cy + Math.sin(a + 0.1) * 160);
      g.lineTo(cx + Math.cos(a + 0.2) * 125, cy + Math.sin(a + 0.2) * 125);
    }
  });
  // monkey face glyph in the middle
  carve(ctx, bctx, null, (g) => {
    g.beginPath();
    g.arc(cx, cy, 55, 0, Math.PI * 2); // head
    g.moveTo(cx - 55, cy - 5); g.arc(cx - 66, cy - 5, 14, 0, Math.PI * 2); // ears
    g.moveTo(cx + 80, cy - 5); g.arc(cx + 66, cy - 5, 14, 0, Math.PI * 2);
    g.moveTo(cx - 10, cy - 12); g.arc(cx - 20, cy - 12, 10, 0, Math.PI * 2); // eyes
    g.moveTo(cx + 30, cy - 12); g.arc(cx + 20, cy - 12, 10, 0, Math.PI * 2);
    g.moveTo(cx + 30, cy + 22); g.ellipse(cx, cy + 22, 30, 18, 0, 0, Math.PI * 2); // muzzle
    g.moveTo(cx - 14, cy + 28); g.quadraticCurveTo(cx, cy + 36, cx + 14, cy + 28); // smile
  });
  // corner spirals
  for (const [sx, sy] of [[100, 100], [S - 100, 100], [100, S - 100], [S - 100, S - 100]]) {
    carve(ctx, bctx, null, (g) => {
      g.beginPath();
      for (let t = 0; t < 14; t += 0.2) {
        const r = t * 2.1;
        const x = sx + Math.cos(t) * r, y = sy + Math.sin(t) * r;
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    });
  }
  grain(ctx, S, S, fbm, { amount: 0.6, moss: 0.2, mossColor: [64, 96, 40], mossScale: 1.6 });
  return { map: toTexture(c), bump: toTexture(bc, { srgb: false }) };
}

// ---------------------------------------------------------------------------
// Bark
// ---------------------------------------------------------------------------
function bark(rng) {
  const W = 256, H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const fbm = new FBM(rng, [4, 8, 16, 32, 64]);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const ridges = fbm.get(u, v, 4, 0.5);
      const fine = fbm.get(u + 0.3, v, 8, 1);
      let k = 0.45 + ridges * 0.8;
      const groove = Math.pow(Math.abs(Math.sin((u * 12 + ridges * 2.5) * Math.PI)), 0.35);
      k *= 0.55 + groove * 0.45 + fine * 0.15;
      const i = (y * W + x) * 4;
      d[i] = clamp(112 * k, 0, 255);
      d[i + 1] = clamp(84 * k, 0, 255);
      d[i + 2] = clamp(58 * k, 0, 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  grain(ctx, W, H, fbm, { amount: 0.2, moss: 0.25, mossColor: [70, 100, 40], mossScale: 1 });
  return toTexture(c);
}

// ---------------------------------------------------------------------------
// Palm frond (alpha)
// ---------------------------------------------------------------------------
function palmFrond(rng) {
  const W = 256, H = 512;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2;
  // leaflets
  for (let y = 20; y < H - 10; y += 7) {
    const t = y / H;
    const len = Math.sin(t * Math.PI) * (W * 0.48) * (0.85 + rng.next() * 0.2);
    for (const side of [-1, 1]) {
      const g = 90 + rng.range(-20, 30);
      ctx.strokeStyle = `rgb(${40 + rng.range(-10, 20)},${g + 40},${30 + rng.range(-10, 10)})`;
      ctx.lineWidth = 5 + (1 - t) * 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(cx + side * len * 0.5, y - 12, cx + side * len, y + 18 + t * 20);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#6b7a2a';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, H);
  ctx.stroke();
  const t = toTexture(c, { repeat: false });
  return t;
}

// ---------------------------------------------------------------------------
// Fur (near-white, multiplied by the skin colour)
// ---------------------------------------------------------------------------
function fur(rng) {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4500; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    const l = rng.range(4, 12);
    const a = Math.PI / 2 + rng.range(-0.35, 0.35);
    const v = rng.range(170, 255);
    ctx.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    ctx.lineWidth = rng.range(0.6, 1.6);
    wrapDraw(S, S, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
      ctx.stroke();
    });
  }
  const t = toTexture(c);
  return t;
}

// ---------------------------------------------------------------------------
// Jaguar coat with rosettes
// ---------------------------------------------------------------------------
function jaguarCoat(rng) {
  const W = 512, H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const gr = ctx.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#f2dfb0');
  gr.addColorStop(0.25, '#d99a3c');
  gr.addColorStop(0.5, '#c97f22');
  gr.addColorStop(0.75, '#d99a3c');
  gr.addColorStop(1, '#f2dfb0');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, W), y = rng.range(40, H - 40);
    const r = rng.range(12, 22);
    wrapDraw(W, H, x, y, (px, py) => {
      ctx.fillStyle = 'rgba(150,80,20,0.55)';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.75, 0, Math.PI * 2);
      ctx.fill();
      const n = rng.int(4, 6);
      ctx.fillStyle = '#1b120a';
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
        ctx.beginPath();
        ctx.ellipse(px + Math.cos(a) * r, py + Math.sin(a) * r, rng.range(3, 7), rng.range(2.5, 5), a, 0, Math.PI * 2);
        ctx.fill();
      }
      if (rng.chance(0.4)) {
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  for (let i = 0; i < 160; i++) {
    const x = rng.range(0, W), y = rng.range(0, H);
    ctx.fillStyle = '#20150b';
    ctx.beginPath();
    ctx.arc(x, y, rng.range(1.5, 4), 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

// ---------------------------------------------------------------------------
// Top-down jungle canopy used for the floor far below the causeway
// ---------------------------------------------------------------------------
function canopy(rng) {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#1d3314';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    const r = rng.range(8, 34);
    const h = rng.range(80, 120), l = rng.range(14, 32);
    wrapDraw(S, S, x, y, (px, py) => {
      const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.1, px, py, r);
      g.addColorStop(0, hsl(h, 45, l + 14));
      g.addColorStop(0.7, hsl(h, 45, l));
      g.addColorStop(1, 'rgba(10,25,8,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return toTexture(c);
}

// ---------------------------------------------------------------------------
// Mist (alpha noise)
// ---------------------------------------------------------------------------
function mist(rng) {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const fbm = new FBM(rng, [2, 4, 8, 16, 32]);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm.get(x / S, y / S);
      const a = smoothstep(0.35, 0.75, n);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

// ---------------------------------------------------------------------------
// Small sprite textures
// ---------------------------------------------------------------------------
function softDot() {
  const S = 64;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { repeat: false });
}

function sparkle() {
  const S = 64;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? cx : cx * 0.18;
    ctx.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  return toTexture(c, { repeat: false });
}

function leafSprite() {
  const S = 64;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(S / 2, 4);
  ctx.quadraticCurveTo(S - 6, S / 2, S / 2, S - 4);
  ctx.quadraticCurveTo(6, S / 2, S / 2, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(S / 2, 6);
  ctx.lineTo(S / 2, S - 6);
  ctx.stroke();
  return toTexture(c, { repeat: false });
}

// ---------------------------------------------------------------------------
// Power-up icons
// ---------------------------------------------------------------------------
function icon(kind) {
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  const cx = S / 2;
  const colors = {
    magnet: ['#ff5a5a', '#8a0f0f'],
    shield: ['#5ad1ff', '#0b4f8a'],
    double: ['#ffd84a', '#a8610a'],
    boost: ['#b98bff', '#4b1a9a'],
  }[kind];
  const g = ctx.createRadialGradient(cx - 14, cx - 14, 6, cx, cx, cx);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cx, cx - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'magnet') {
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(cx, cx - 4, 24, Math.PI, 0, false);
    ctx.lineTo(cx + 24, cx + 26);
    ctx.moveTo(cx - 24, cx - 4);
    ctx.lineTo(cx - 24, cx + 26);
    ctx.stroke();
    ctx.fillStyle = '#ddd';
    ctx.fillRect(cx - 32, cx + 18, 16, 14);
    ctx.fillRect(cx + 16, cx + 18, 16, 14);
  } else if (kind === 'shield') {
    ctx.beginPath();
    ctx.moveTo(cx, cx - 36);
    ctx.lineTo(cx + 30, cx - 24);
    ctx.quadraticCurveTo(cx + 28, cx + 18, cx, cx + 38);
    ctx.quadraticCurveTo(cx - 28, cx + 18, cx - 30, cx - 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = colors[1];
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', cx, cx + 2);
  } else if (kind === 'double') {
    ctx.font = '900 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = colors[1];
    ctx.strokeText('2X', cx, cx + 4);
    ctx.fillText('2X', cx, cx + 4);
  } else if (kind === 'boost') {
    ctx.beginPath();
    ctx.moveTo(cx + 8, cx - 40);
    ctx.lineTo(cx - 22, cx + 6);
    ctx.lineTo(cx - 2, cx + 6);
    ctx.lineTo(cx - 10, cx + 40);
    ctx.lineTo(cx + 24, cx - 8);
    ctx.lineTo(cx + 4, cx - 8);
    ctx.closePath();
    ctx.fill();
  }
  return toTexture(c, { repeat: false });
}

export function createTextures() {
  const rng = new RNG(1337);
  const floor = stoneFloor(rng);
  const wall = templeWall(rng);
  const glyph = glyphPanel(rng);
  return {
    floor: floor.map,
    floorBump: floor.bump,
    wall: wall.map,
    wallBump: wall.bump,
    glyph: glyph.map,
    glyphBump: glyph.bump,
    bark: bark(rng),
    palm: palmFrond(rng),
    fur: fur(rng),
    jaguar: jaguarCoat(rng),
    canopy: canopy(rng),
    mist: mist(rng),
    dot: softDot(),
    sparkle: sparkle(),
    leaf: leafSprite(),
    icons: {
      magnet: icon('magnet'),
      shield: icon('shield'),
      double: icon('double'),
      boost: icon('boost'),
    },
  };
}
