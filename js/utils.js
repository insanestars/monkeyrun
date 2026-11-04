import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Direction helpers. The track only ever runs along the four cardinal axes.
//   0 = north (-Z), 1 = east (+X), 2 = south (+Z), 3 = west (-X)
// "right" of direction d is direction d+1.
// ---------------------------------------------------------------------------
export const DIRS = [
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(-1, 0, 0),
];
export const dirYaw = (d) => -d * Math.PI / 2;
export const rightOf = (d) => (d + 1) % 4;
export const leftOf = (d) => (d + 3) % 4;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

// ---------------------------------------------------------------------------
// Seeded random number generator (mulberry32)
// ---------------------------------------------------------------------------
export class RNG {
  constructor(seed = 1) {
    this.s = seed >>> 0;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  weighted(items) {
    // items: [[value, weight], ...]
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r <= 0) return v;
    }
    return items[items.length - 1][0];
  }
}

// ---------------------------------------------------------------------------
// Geometry merging. Every static piece of a track segment (floor, walls,
// trees, obstacles...) is baked into one mesh per material so a whole
// segment of jungle costs only a handful of draw calls.
//
// entries: [{ geo, matrix, color?, uv?: 'world'|'keep', uvScale?, tag? }]
// returns { geometry, ranges: Map(tag -> [[start, count], ...]) }
// ---------------------------------------------------------------------------
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _white = new THREE.Color(1, 1, 1);

function nonIndexed(geo) {
  if (!geo.userData._ni) geo.userData._ni = geo.index ? geo.toNonIndexed() : geo;
  return geo.userData._ni;
}

export function mergeEntries(entries) {
  let total = 0;
  for (const e of entries) total += nonIndexed(e.geo).attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  const ranges = new Map();
  let o = 0;
  for (const e of entries) {
    const g = nonIndexed(e.geo);
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const U = g.attributes.uv;
    const C = g.attributes.color;
    const m = e.matrix;
    _nm.getNormalMatrix(m);
    const c = e.color || _white;
    const world = e.uv === 'world';
    const sc = 1 / (e.uvScale || 4);
    const cnt = P.count;
    for (let i = 0; i < cnt; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(m);
      if (N) _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      else _n.set(0, 1, 0);
      const k = (o + i) * 3;
      pos[k] = _v.x; pos[k + 1] = _v.y; pos[k + 2] = _v.z;
      nor[k] = _n.x; nor[k + 1] = _n.y; nor[k + 2] = _n.z;
      const j = (o + i) * 2;
      if (world) {
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) { uvs[j] = _v.x * sc; uvs[j + 1] = _v.z * sc; }
        else if (ax >= az) { uvs[j] = _v.z * sc; uvs[j + 1] = _v.y * sc; }
        else { uvs[j] = _v.x * sc; uvs[j + 1] = _v.y * sc; }
      } else if (U) {
        uvs[j] = U.getX(i) * (e.uvRepeatX || 1);
        uvs[j + 1] = U.getY(i) * (e.uvRepeatY || 1);
      }
      if (C) {
        col[k] = C.getX(i) * c.r; col[k + 1] = C.getY(i) * c.g; col[k + 2] = C.getZ(i) * c.b;
      } else {
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
    if (e.tag !== undefined) {
      if (!ranges.has(e.tag)) ranges.set(e.tag, []);
      ranges.get(e.tag).push([o, cnt]);
    }
    o += cnt;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.computeBoundingSphere();
  return { geometry, ranges };
}

// Collapse a tagged range in a merged geometry (used to "smash" baked obstacles)
export function collapseRanges(geometry, list) {
  const P = geometry.attributes.position;
  for (const [start, count] of list) {
    for (let i = start; i < start + count; i++) P.setXYZ(i, 0, -9999, 0);
    P.addUpdateRange(start * 3, count * 3);
  }
  P.needsUpdate = true;
}

// Displace vertices of a geometry with a function (for organic shapes)
export function displace(geo, fn) {
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    _v.fromBufferAttribute(P, i);
    fn(_v, i);
    P.setXYZ(i, _v.x, _v.y, _v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Matrix builder
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export function formatNumber(n) {
  return Math.floor(n).toLocaleString('en-US');
}
