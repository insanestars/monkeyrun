import * as THREE from 'three';
import { clamp, lerp, displace, RNG } from './utils.js';

// ---------------------------------------------------------------------------
// Reusable procedural geometry
// ---------------------------------------------------------------------------

// Curved, ridged banana with vertex colours (yellow body, brown tips, green stem)
export function bananaGeometry() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 14, true);
  const P = g.attributes.position;
  const col = new Float32Array(P.count * 3);
  const span = 1.5;
  const Rb = 1 / span;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const t = y + 0.5;
    let r = Math.pow(Math.sin(Math.PI * clamp(t, 0.015, 0.985)), 0.5) * 0.15;
    if (t > 0.86) r = lerp(r, 0.035, clamp((t - 0.86) / 0.1, 0, 1));
    const lx = x * r, lz = z * r;
    const ang = (t - 0.5) * span;
    const cx = Rb - Rb * Math.cos(ang), cy = Rb * Math.sin(ang);
    const nx = Math.cos(ang), ny = -Math.sin(ang);
    P.setXYZ(i, cx + nx * lx, cy + ny * lx, lz);
    let c;
    if (t < 0.04) c = [0.25, 0.16, 0.06];
    else if (t > 0.93) c = [0.35, 0.42, 0.12];
    else if (t > 0.86) c = [0.75, 0.72, 0.25];
    else c = [1.0, 0.86, 0.22];
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.translate(-0.12, 0, 0);
  return g;
}

// Fluted temple column (unit height, radius 1, centred)
export function flutedColumn(flutes = 14) {
  const g = new THREE.CylinderGeometry(1, 1, 1, flutes * 3, 1, false);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), z = P.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.01) continue;
    const a = Math.atan2(z, x);
    const k = 1 - 0.08 * Math.pow(Math.abs(Math.sin(a * flutes / 2)), 2);
    P.setX(i, (x / r) * k);
    P.setZ(i, (z / r) * k);
  }
  g.computeVertexNormals();
  return g;
}

// Lumpy foliage blob
// deterministic per-position hash so shared corners of a non-indexed mesh move together
function posHash(v, seed) {
  const x = Math.round(v.x * 1000), y = Math.round(v.y * 1000), z = Math.round(v.z * 1000);
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.618) * 43758.5453;
  return h - Math.floor(h);
}

export function foliageBlob(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1); // non-indexed: flat-shaded facets
  const n = new THREE.Vector3();
  displace(g, (v) => {
    n.copy(v).normalize();
    const k = 0.82 + posHash(v, seed) * 0.3 + Math.sin(n.x * 5 + seed) * 0.06;
    v.multiplyScalar(k);
    v.y *= 0.8;
  });
  return g;
}

// Organic trunk: tapered, wavy cylinder (unit height, base at 0)
export function trunkGeometry(seed, radial = 9) {
  const rng = new RNG(seed);
  const g = new THREE.CylinderGeometry(0.62, 1, 1, radial, 8, true);
  g.translate(0, 0.5, 0);
  const ph = rng.range(0, 6.28);
  displace(g, (v) => {
    const t = v.y;
    const a = Math.atan2(v.z, v.x);
    const bump = 1 + Math.sin(a * 3 + t * 4 + ph) * 0.08 + Math.sin(a * 7 + ph) * 0.04;
    v.x *= bump;
    v.z *= bump;
    v.x += Math.sin(t * 3 + ph) * 0.15;
    v.z += Math.cos(t * 2.3 + ph) * 0.15;
  });
  return g;
}

// Rough boulder
export function rockGeometry(seed) {
  const g = new THREE.DodecahedronGeometry(1, 1);
  displace(g, (v) => {
    v.multiplyScalar(0.8 + posHash(v, seed) * 0.35);
  });
  return g;
}

// Bent palm frond plane (length 1 along +Z, base at origin)
export function frondGeometry() {
  const g = new THREE.PlaneGeometry(0.55, 1, 2, 8);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.5);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const z = -P.getZ(i);
    const x = P.getX(i);
    P.setY(i, -z * z * 0.55 + Math.abs(x) * 0.25);
    P.setZ(i, -z);
  }
  g.computeVertexNormals();
  return g;
}

// Tapered curved horn/claw/root segment along a quadratic curve
export function curvedTube(points, radius, tubular = 12, radial = 6, taper = 0.3) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  // taper towards the end
  const P = g.attributes.position;
  const v = new THREE.Vector3();
  const segs = tubular + 1;
  for (let i = 0; i < P.count; i++) {
    const seg = Math.floor(i / (radial + 1));
    const t = seg / (segs - 1);
    const c = curve.getPointAt(t);
    v.fromBufferAttribute(P, i).sub(c).multiplyScalar(lerp(1, taper, t)).add(c);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
