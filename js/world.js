import * as THREE from 'three';
import { DIRS, dirYaw, rightOf, leftOf, RNG, mat, mergeEntries, collapseRanges, clamp, lerp } from './utils.js';
import { LANE, HALF, CURB, speedAt, jumpDistance, slideDistance, tierAt, BIOMES, biomeIndexAt } from './config.js';
import { bananaGeometry, flutedColumn, foliageBlob, trunkGeometry, rockGeometry, frondGeometry, curvedTube } from './shapes.js';

const LANES_X = [-LANE, 0, LANE];
const ALL = [true, true, true];
const C = (hex) => new THREE.Color(hex);

// ---------------------------------------------------------------------------
// Shaders for baked fire and glow sprites
// ---------------------------------------------------------------------------
const NOISE_GLSL = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}`;

function flameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv; varying float vSeed;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position,1.0);
        vSeed = floor(wp.x*0.5)*1.7 + floor(wp.z*0.5)*3.1;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vUv; varying float vSeed;
      ${NOISE_GLSL}
      void main(){
        float t = uTime*2.6 + vSeed;
        float h = vUv.y;
        float n = noise(vec2(vUv.x*5.0 + vSeed, h*4.0 - t*2.2));
        float n2 = noise(vec2(vUv.x*11.0 - vSeed, h*9.0 - t*3.7));
        float x = (vUv.x - 0.5) * 2.0 + (n - 0.5) * 0.7 * h;
        float width = mix(0.95, 0.08, pow(h, 0.8));
        float shape = 1.0 - smoothstep(width*0.45, width, abs(x));
        shape *= smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.45 + n*0.35, 0.98, h + n2*0.15));
        vec3 core = vec3(1.0, 0.95, 0.7);
        vec3 mid = vec3(1.0, 0.55, 0.12);
        vec3 edge = vec3(0.85, 0.15, 0.02);
        vec3 col = mix(core, mid, smoothstep(0.0, 0.5, h + (1.0-shape)*0.6));
        col = mix(col, edge, smoothstep(0.45, 1.0, h + (1.0-shape)*0.4));
        gl_FragColor = vec4(col * shape * 1.7, shape);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function glowMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uMap: { value: tex } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize;
      uniform float uTime; uniform float uScale;
      varying vec3 vColor; varying float vFade;
      void main(){
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float flick = 0.85 + 0.15*sin(uTime*11.0 + position.x*3.1 + position.z*1.7) + 0.08*sin(uTime*23.0 + position.z);
        gl_PointSize = aSize * flick * uScale / -mv.z;
        vFade = clamp(1.0 - (-mv.z - 90.0) / 70.0, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; varying vec3 vColor; varying float vFade;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vColor * t.a * vFade, t.a * vFade);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function createMaterials(tex) {
  return {
    floor: new THREE.MeshStandardMaterial({ map: tex.floor, bumpMap: tex.floorBump, bumpScale: 1.4, roughness: 0.88, vertexColors: true }),
    wall: new THREE.MeshStandardMaterial({ map: tex.wall, bumpMap: tex.wallBump, bumpScale: 1.4, roughness: 0.93, vertexColors: true }),
    glyph: new THREE.MeshStandardMaterial({ map: tex.glyph, bumpMap: tex.glyphBump, bumpScale: 2.0, roughness: 0.9, vertexColors: true }),
    bark: new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.95, vertexColors: true }),
    leaves: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82 }),
    palm: new THREE.MeshStandardMaterial({ map: tex.palm, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.8 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc534, metalness: 0.88, roughness: 0.28, emissive: 0x3a2400, vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8a8a90, metalness: 0.8, roughness: 0.35, vertexColors: true }),
    rock: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, bumpMap: tex.wallBump, bumpScale: 0.6 }),
    plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    shroom: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0x3ad8ff, emissiveIntensity: 0.9 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x050302 }),
    flame: flameMaterial(),
  };
}

const SHADOW = {
  floor: [false, true], wall: [true, true], glyph: [true, true], bark: [true, true], leaves: [true, true],
  palm: [true, true], gold: [true, false], metal: [true, false], rock: [true, true], plain: [true, true],
  shroom: [false, false], dark: [false, false], flame: [false, false],
};

// ---------------------------------------------------------------------------
// The Track: an ever-growing tree of straight causeway segments joined by
// 90 degree junctions. Only the segment the player is on, plus two levels of
// look-ahead, exist at any time.
// ---------------------------------------------------------------------------
export class Track {
  constructor(scene, textures, quality = 'high') {
    this.scene = scene;
    this.tex = textures;
    this.mats = createMaterials(textures);
    this.glowMat = glowMaterial(textures.dot);
    this.density = quality === 'low' ? 0.55 : quality === 'medium' ? 0.8 : 1;
    this.quality = quality;
    this.live = new Set();
    this.queue = [];
    this.sinking = [];
    this.G = this.makeGeometries();

    // instanced bananas
    const bGeo = bananaGeometry();
    this.bananaMesh = new THREE.InstancedMesh(bGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0x403000, emissiveIntensity: 0.6 }), 1600);
    this.bananaMesh.castShadow = true;
    this.bananaMesh.frustumCulled = false;
    this.bananaMesh.count = 0;
    scene.add(this.bananaMesh);
    this.goldMesh = new THREE.InstancedMesh(bGeo, new THREE.MeshStandardMaterial({ color: 0xffd040, metalness: 0.9, roughness: 0.2, emissive: 0xaa6600, emissiveIntensity: 0.8 }), 200);
    this.goldMesh.frustumCulled = false;
    this.goldMesh.count = 0;
    this.goldMesh.castShadow = true;
    scene.add(this.goldMesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();

    // power-up visuals
    this.puRing = new THREE.TorusGeometry(0.55, 0.06, 8, 32);
    this.puRingMat = new THREE.MeshStandardMaterial({ color: 0xffd040, metalness: 0.9, roughness: 0.2, emissive: 0x664400 });
  }

  makeGeometries() {
    const G = {};
    G.box = new THREE.BoxGeometry(1, 1, 1);
    G.cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
    G.cyl6 = new THREE.CylinderGeometry(1, 1, 1, 6);
    G.cone = new THREE.ConeGeometry(1, 1, 8);
    G.sphere = new THREE.SphereGeometry(1, 12, 9);
    G.hemi = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    G.column = flutedColumn();
    G.trunks = [1, 2, 3, 4].map((s) => trunkGeometry(s * 17));
    G.blobs = [1, 2, 3, 4, 5].map((s) => foliageBlob(s * 31));
    G.rocks = [1, 2, 3, 4].map((s) => rockGeometry(s * 13));
    G.frond = frondGeometry();
    G.torus = new THREE.TorusGeometry(1, 0.15, 6, 16);
    const fp = new THREE.PlaneGeometry(1, 1);
    fp.translate(0, 0.5, 0);
    G.flamePlane = fp;
    G.vine = new THREE.CylinderGeometry(0.045, 0.045, 1, 5);
    G.vine.translate(0, -0.5, 0);
    // bamboo stalk with darker nodes
    const bb = new THREE.CylinderGeometry(1, 1, 1, 7, 10, true);
    bb.translate(0, 0.5, 0);
    const P = bb.attributes.position;
    const col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i);
      const node = Math.abs((y * 10) % 1) < 0.02 || Math.abs((y * 10) % 1) > 0.98;
      const k = node ? 0.6 : 1.0;
      if (node) {
        P.setX(i, P.getX(i) * 1.15);
        P.setZ(i, P.getZ(i) * 1.15);
      }
      col[i * 3] = 0.55 * k; col[i * 3 + 1] = 0.7 * k; col[i * 3 + 2] = 0.28 * k;
    }
    bb.setAttribute('color', new THREE.BufferAttribute(col, 3));
    bb.computeVertexNormals();
    G.bamboo = bb;
    return G;
  }

  // -------------------------------------------------------------------------
  reset(seed) {
    for (const st of [...this.live]) this.dispose(st);
    this.live.clear();
    this.queue.length = 0;
    this.rng = new RNG(seed);
    this.nextId = 1;
    this.lastPowerupDist = 0;
    this.current = this.createStraight(null, 0, new THREE.Vector3(0, 0, 0), null);
    this.previous = null;
    this.ensure(true);
  }

  createStraight(parent, dir, start, side) {
    const rng = new RNG(this.rng.int(1, 2 ** 30));
    const dist = parent ? parent.dist + parent.length : 0;
    const first = !parent;
    const length = first ? 140 : Math.round(rng.range(85, 150));
    const junction = first ? rng.pick(['L', 'R']) : rng.weighted([['L', 37], ['R', 37], ['T', 26]]);
    const st = {
      id: this.nextId++, parent, dir, start: start.clone(), length, junction, side, dist, first, rng,
      biome: biomeIndexAt(dist + length * 0.5), children: {}, expanded: false,
      obstacles: [], bananas: [], powerups: [], torches: [], gaps: [], built: false, group: null, merged: [],
      F: DIRS[dir], R: DIRS[rightOf(dir)],
    };
    st.base = new THREE.Matrix4().makeRotationY(dirYaw(dir)).setPosition(st.start);
    this.layout(st);
    return st;
  }

  junctionCenter(st) {
    return st.start.clone().addScaledVector(st.F, st.length);
  }

  childList(st) {
    const out = [];
    if (st.children.left) out.push(st.children.left);
    if (st.children.right) out.push(st.children.right);
    return out;
  }

  expand(st) {
    if (st.expanded) return;
    st.expanded = true;
    const end = this.junctionCenter(st);
    if (st.junction !== 'R') st.children.left = this.createStraight(st, leftOf(st.dir), end, 'left');
    if (st.junction !== 'L') st.children.right = this.createStraight(st, rightOf(st.dir), end, 'right');
  }

  ensure(sync = false) {
    const cur = this.current;
    this.expand(cur);
    if (!cur.built) this.build(cur);
    for (const c of this.childList(cur)) {
      this.expand(c);
      if (!c.built) {
        if (sync) this.build(c);
        else this.queue.unshift(c);
      }
      for (const g of this.childList(c)) if (!g.built) {
        if (sync) this.build(g);
        else this.queue.push(g);
      }
    }
  }

  processQueue() {
    while (this.queue.length) {
      const st = this.queue.shift();
      if (!st.built && !st.disposed) {
        this.build(st);
        return;
      }
    }
  }

  // Called by the game when the player takes a turn onto `side`.
  turn(side) {
    const old = this.current;
    const next = old.children[side];
    const other = old.children[side === 'left' ? 'right' : 'left'];
    if (other) this.disposeTree(other);
    if (this.previous) this.dispose(this.previous);
    old.children = { [side]: next };
    this.previous = old;
    this.current = next;
    if (!next.built) this.build(next);
    this.ensure(false);
    // make sure immediate children exist right away
    for (const c of this.childList(next)) if (!c.built) this.build(c);
    return next;
  }

  dropPrevious() {
    if (this.previous) {
      this.dispose(this.previous);
      this.previous = null;
    }
  }

  disposeTree(st) {
    for (const c of this.childList(st)) this.disposeTree(c);
    this.dispose(st);
  }

  dispose(st) {
    st.disposed = true;
    this.live.delete(st);
    if (st.group) {
      this.scene.remove(st.group);
      st.group.traverse((o) => {
        if (o.geometry && o.userData.own) o.geometry.dispose();
      });
      st.group = null;
    }
  }

  // local (s, x, y) -> world
  point(st, s, x = 0, y = 0, target = new THREE.Vector3()) {
    return target.copy(st.start).addScaledVector(st.F, s).addScaledVector(st.R, x).setY(st.start.y + y);
  }

  M(st, x, y, s, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
    return new THREE.Matrix4().multiplyMatrices(st.base, mat(x, y, -s, rx, ry, rz, sx, sy, sz));
  }

  // =========================================================================
  // LAYOUT: decide where obstacles, gaps, bananas and power-ups go
  // =========================================================================
  layout(st) {
    const rng = st.rng;
    const L = st.length;
    let s = st.first ? 62 : 30;
    const end = L - 20;
    const free = []; // free stretches [a, b]
    let prevEnd = st.first ? 6 : 6;
    let guideLane = rng.int(0, 2);
    let tag = 0;
    while (true) {
      const d = st.dist + s;
      const tier = tierAt(d);
      const speed = speedAt(d);
      const pat = this.makePattern(rng, tier, s, speed);
      if (s + pat.span > end) break;
      for (const o of pat.obs) {
        o.tag = tag++;
        st.obstacles.push(o);
        if (o.kind === 'gap') st.gaps.push(o);
      }
      // bananas in the run-up, leading to a safe lane
      const runStart = prevEnd + 3, runEnd = s - 3;
      if (runEnd - runStart > 6) free.push([runStart, runEnd]);
      if (runEnd - runStart > 8 && rng.chance(0.72)) {
        this.bananaLine(st, runStart, runEnd, guideLane, pat.safeLane ?? guideLane, rng);
      }
      for (const b of pat.bananas) this.addBanana(st, b.s, b.x, b.y, rng);
      guideLane = pat.safeLane ?? rng.int(0, 2);
      prevEnd = s + pat.span;
      const tFrac = tier / 3;
      const spacing = jumpDistance(speed) + speed * lerp(0.78, 0.5, tFrac) + rng.range(0, 12 - tier * 2.5);
      s = prevEnd + spacing;
    }
    if (end - prevEnd > 8) free.push([prevEnd + 3, end + 8]);
    if (end - prevEnd > 10 && rng.chance(0.6)) this.bananaLine(st, prevEnd + 3, Math.min(end + 6, L - 12), guideLane, rng.int(0, 2), rng);

    // power-up
    const since = st.dist - this.lastPowerupDist;
    if (!st.first && free.length && since > 170 && rng.chance(clamp((since - 120) / 260, 0.3, 0.95))) {
      const [a, b] = rng.pick(free);
      const ps = (a + b) / 2;
      const lane = rng.int(0, 2);
      const type = rng.weighted([['magnet', 3], ['double', 2.4], ['shield', 2], ['boost', 1.6]]);
      st.bananas = st.bananas.filter((bn) => !(Math.abs(bn.s - ps) < 3 && Math.abs(bn.x - LANES_X[lane]) < 1));
      st.powerups.push({ type, s: ps, x: LANES_X[lane], pos: this.point(st, ps, LANES_X[lane], 1.1), taken: false });
      this.lastPowerupDist = st.dist;
    }
  }

  addBanana(st, s, x, y, rng) {
    const golden = rng.chance(0.035);
    st.bananas.push({ s, x, y, golden, taken: false, pos: this.point(st, s, x, y), phase: rng.range(0, 6.28) });
  }

  bananaLine(st, a, b, laneA, laneB, rng) {
    const n = Math.min(12, Math.floor((b - a) / 2.2));
    if (n < 3) return;
    const sStart = a + ((b - a) - (n - 1) * 2.2) / 2;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const k = clamp((t - 0.35) / 0.3, 0, 1);
      const sm = k * k * (3 - 2 * k);
      const x = lerp(LANES_X[laneA], LANES_X[laneB], sm);
      this.addBanana(st, sStart + i * 2.2, x, 0.75, rng);
    }
  }

  arc(cs, x, speed) {
    const jd = jumpDistance(speed) * 0.9;
    const out = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6 - 0.5;
      out.push({ s: cs + u * jd, x, y: 0.75 + 2.0 * (1 - 4 * u * u) });
    }
    return out;
  }

  makePattern(rng, tier, s, speed) {
    const choices = [
      ['log', 3], ['roots', 2], ['arch', 3], ['gap', 1.3], ['block1', 3.2], ['rubble1', 1.2],
    ];
    if (tier >= 1) choices.push(['branch', 2], ['fire', 1.6], ['spikes', 1.5], ['block2', 2.6], ['bridge', 1.5], ['gap', 1.2], ['rubble2', 1.2]);
    if (tier >= 2) choices.push(['combo', 2], ['slalom', 2], ['gapblock', 1.2], ['bridge', 1]);
    if (tier >= 3) choices.push(['slalom', 1.5], ['combo', 1.5], ['fire', 1]);
    const type = rng.weighted(choices);
    const obs = [];
    let bananas = [];
    let span = 2;
    let safeLane = null;
    const lane = rng.int(0, 2);
    const O = (o) => obs.push(Object.assign({ lanes: ALL, hit: false, dead: false }, o));
    switch (type) {
      case 'log': {
        O({ type: 'log', kind: 'low', s: s + 0.5, s0: s + 0.05, s1: s + 0.95, top: 0.85, cause: 'trip' });
        bananas = rng.chance(0.7) ? this.arc(s + 0.5, LANES_X[lane], speed) : [];
        span = 1;
        break;
      }
      case 'roots': {
        O({ type: 'roots', kind: 'roots', s: s + 0.6, s0: s, s1: s + 1.2, top: 0.4, cause: 'trip' });
        span = 1.2;
        break;
      }
      case 'spikes': {
        O({ type: 'spikes', kind: 'low', s: s + 0.4, s0: s + 0.05, s1: s + 0.75, top: 1.0, cause: 'spikes' });
        bananas = this.arc(s + 0.4, LANES_X[lane], speed);
        span = 0.8;
        break;
      }
      case 'arch':
      case 'branch':
      case 'fire': {
        const depth = type === 'arch' ? 1.0 : type === 'fire' ? 0.9 : 0.7;
        const bottom = type === 'arch' ? 1.08 : type === 'fire' ? 0.98 : 1.1;
        O({ type, kind: 'high', s: s + depth / 2, s0: s, s1: s + depth, bottom, cause: type === 'fire' ? 'burn' : 'smack' });
        if (rng.chance(0.75)) {
          for (let i = -2; i <= 2; i++) bananas.push({ s: s + depth / 2 + i * 1.8, x: LANES_X[lane], y: 0.45 });
        }
        span = depth;
        break;
      }
      case 'gap': {
        const gl = tier === 0 ? rng.range(3.0, 3.8) : rng.range(3.5, Math.min(6, 3.5 + speed * 0.08));
        O({ type: 'gap', kind: 'gap', s: s + gl / 2, s0: s, s1: s + gl, cause: 'fall' });
        bananas = this.arc(s + gl / 2, LANES_X[lane], speed);
        span = gl;
        break;
      }
      case 'bridge': {
        const len = rng.range(10, 14 + tier * 3);
        safeLane = lane;
        const lanes = [0, 1, 2].map((i) => i !== lane);
        O({ type: 'bridge', kind: 'gap', s: s + len / 2, s0: s, s1: s + len, lanes, cause: 'fall' });
        for (let k = 1.5; k < len - 1; k += 2.2) bananas.push({ s: s + k, x: LANES_X[lane], y: 0.75 });
        span = len;
        break;
      }
      case 'block1': {
        const kindType = rng.pick(['pillar', 'boulder', 'statue', 'pillar']);
        O({ type: kindType, kind: 'block', s: s + 0.9, s0: s, s1: s + 1.8, lanes: [0, 1, 2].map((i) => i === lane), cause: 'smack' });
        safeLane = (lane + rng.int(1, 2)) % 3;
        for (let i = -2; i <= 2; i++) bananas.push({ s: s + 0.9 + i * 2.2, x: LANES_X[safeLane], y: 0.75 });
        span = 1.8;
        break;
      }
      case 'block2': {
        safeLane = lane;
        const kindType = rng.pick(['pillar', 'boulder', 'statue']);
        for (let i = 0; i < 3; i++) if (i !== lane) {
          const lanes = [0, 1, 2].map((k) => k === i);
          O({ type: rng.chance(0.5) ? kindType : rng.pick(['pillar', 'boulder', 'statue']), kind: 'block', s: s + 0.9, s0: s, s1: s + 1.8, lanes, cause: 'smack' });
        }
        for (let i = -2; i <= 2; i++) bananas.push({ s: s + 0.9 + i * 2.2, x: LANES_X[safeLane], y: 0.75 });
        span = 1.8;
        break;
      }
      case 'rubble1':
      case 'rubble2': {
        const n = type === 'rubble1' ? 1 : 2;
        const blocked = n === 1 ? [lane] : [0, 1, 2].filter((i) => i !== lane);
        for (const i of blocked) {
          O({ type: 'rubble', kind: 'lowblock', s: s + 0.6, s0: s, s1: s + 1.2, top: 0.9, lanes: [0, 1, 2].map((k) => k === i), cause: 'trip' });
        }
        safeLane = n === 1 ? (lane + 1) % 3 : lane;
        if (rng.chance(0.5)) bananas = this.arc(s + 0.6, LANES_X[blocked[0]], speed);
        span = 1.2;
        break;
      }
      case 'combo': {
        // two lanes blocked by pillars, the third has rubble you must jump
        const kindType = rng.pick(['pillar', 'statue', 'boulder']);
        for (let i = 0; i < 3; i++) {
          if (i === lane) O({ type: 'rubble', kind: 'lowblock', s: s + 0.9, s0: s + 0.3, s1: s + 1.5, top: 0.9, lanes: [0, 1, 2].map((k) => k === i), cause: 'trip' });
          else O({ type: kindType, kind: 'block', s: s + 0.9, s0: s, s1: s + 1.8, lanes: [0, 1, 2].map((k) => k === i), cause: 'smack' });
        }
        safeLane = lane;
        bananas = this.arc(s + 0.9, LANES_X[lane], speed);
        span = 1.8;
        break;
      }
      case 'slalom': {
        const a = lane;
        const b = (a + rng.int(1, 2)) % 3;
        const d2 = Math.max(9, speed * 0.62);
        // first: block everything except a; second: block everything except b
        for (let i = 0; i < 3; i++) if (i !== a) O({ type: rng.pick(['pillar', 'boulder']), kind: 'block', s: s + 0.9, s0: s, s1: s + 1.8, lanes: [0, 1, 2].map((k) => k === i), cause: 'smack' });
        for (let i = 0; i < 3; i++) if (i !== b) O({ type: rng.pick(['pillar', 'statue']), kind: 'block', s: s + d2 + 0.9, s0: s + d2, s1: s + d2 + 1.8, lanes: [0, 1, 2].map((k) => k === i), cause: 'smack' });
        for (let k = 0; k < 5; k++) {
          const t = k / 4;
          bananas.push({ s: s + 0.9 + t * d2, x: lerp(LANES_X[a], LANES_X[b], t * t * (3 - 2 * t)), y: 0.75 });
        }
        safeLane = a;
        span = d2 + 1.8;
        break;
      }
      case 'gapblock': {
        const gl = rng.range(3.2, 4.5);
        O({ type: 'gap', kind: 'gap', s: s + gl / 2, s0: s, s1: s + gl, cause: 'fall' });
        const d2 = jumpDistance(speed) + speed * 0.45;
        const bl = rng.int(0, 2);
        O({ type: rng.pick(['pillar', 'boulder', 'statue']), kind: 'block', s: s + d2 + 0.9, s0: s + d2, s1: s + d2 + 1.8, lanes: [0, 1, 2].map((k) => k === bl), cause: 'smack' });
        bananas = this.arc(s + gl / 2, LANES_X[(bl + 1) % 3], speed);
        safeLane = (bl + 1) % 3;
        span = d2 + 1.8;
        break;
      }
    }
    return { type, obs, span, bananas, safeLane };
  }

  // =========================================================================
  // BUILD: bake meshes for a straight
  // =========================================================================
  build(st) {
    if (st.built || st.disposed) return;
    st.built = true;
    this.live.add(st);
    const B = {}; // material -> entries
    const glows = []; // [x,y,z,r,g,b,size]
    const push = (matKey, e) => {
      (B[matKey] || (B[matKey] = [])).push(e);
    };
    const ctx = { st, push, glows, rng: new RNG(st.id * 7919 + 13), biome: BIOMES[st.biome] };

    this.buildFloor(ctx);
    this.buildJunction(ctx);
    if (st.first) this.buildTemple(ctx);
    for (const o of st.obstacles) this.buildObstacle(ctx, o);
    this.buildDecor(ctx);

    const group = new THREE.Group();
    group.name = 'straight-' + st.id;
    for (const key in B) {
      const { geometry, ranges } = mergeEntries(B[key]);
      const mesh = new THREE.Mesh(geometry, this.mats[key]);
      mesh.userData.own = true;
      const [cast, recv] = SHADOW[key] || [true, true];
      mesh.castShadow = cast && this.quality !== 'low';
      mesh.receiveShadow = recv;
      mesh.matrixAutoUpdate = false;
      if (key === 'flame') mesh.renderOrder = 2;
      group.add(mesh);
      st.merged.push({ mesh, ranges });
    }
    if (glows.length) {
      const n = glows.length;
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
      glows.forEach((g, i) => {
        pos.set([g[0], g[1], g[2]], i * 3);
        col.set([g[3], g[4], g[5]], i * 3);
        size[i] = g[6];
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.computeBoundingSphere();
      const pts = new THREE.Points(geo, this.glowMat);
      pts.userData.own = true;
      pts.renderOrder = 3;
      group.add(pts);
    }
    // power-ups
    for (const pu of st.powerups) {
      const g = new THREE.Group();
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.icons[pu.type], transparent: true, depthWrite: false }));
      sp.scale.setScalar(0.95);
      g.add(sp);
      const ring = new THREE.Mesh(this.puRing, this.puRingMat);
      g.add(ring);
      const ring2 = new THREE.Mesh(this.puRing, this.puRingMat);
      ring2.rotation.y = Math.PI / 2;
      ring2.scale.setScalar(0.85);
      g.add(ring2);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.dot, color: 0xfff0a0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }));
      glow.scale.setScalar(2.4);
      g.add(glow);
      g.position.copy(pu.pos);
      pu.mesh = g;
      pu.rings = [ring, ring2];
      group.add(g);
    }
    st.group = group;
    this.scene.add(group);
  }

  // ---- floor, curbs, causeway body --------------------------------------
  buildFloor({ st, push, rng }) {
    const L = st.length;
    const s0 = st.first ? -16 : HALF;
    const s1 = L - HALF;
    const G = this.G;
    // per-lane intervals minus gaps
    for (let lane = 0; lane < 3; lane++) {
      let segs = [[s0, s1]];
      for (const g of st.gaps) {
        if (!g.lanes[lane]) continue;
        const next = [];
        for (const [a, b] of segs) {
          if (g.s1 <= a || g.s0 >= b) next.push([a, b]);
          else {
            if (g.s0 > a) next.push([a, g.s0]);
            if (g.s1 < b) next.push([g.s1, b]);
          }
        }
        segs = next;
      }
      const x = LANES_X[lane];
      const tone = new THREE.Color().setHSL(0.09, 0.08, 0.92 + rng.range(-0.04, 0.04));
      for (const [a, b] of segs) {
        const len = b - a;
        if (len < 0.05) continue;
        const mid = (a + b) / 2;
        push('floor', { geo: G.box, matrix: this.M(st, x, -0.4, mid, 0, LANE, 0.8, len), uv: 'world', uvScale: 4, color: tone });
        // causeway body (outer lanes include the curb width)
        let bx = x, bw = LANE;
        if (lane === 0) { bx = x - CURB / 2; bw = LANE + CURB; }
        if (lane === 2) { bx = x + CURB / 2; bw = LANE + CURB; }
        push('wall', { geo: G.box, matrix: this.M(st, bx, -8.4, mid, 0, bw, 15.2, len), uv: 'world', uvScale: 4, color: C(0xb8b0a0) });
        // curbs on outer lanes
        if (lane === 0 || lane === 2) {
          const side = lane === 0 ? -1 : 1;
          let cs = a;
          // on open sides near the junction the curb stops short
          const open = (side < 0 && st.junction !== 'R') || (side > 0 && st.junction !== 'L');
          const cEnd = open ? Math.min(b, L - HALF - 0.1) : b;
          while (cs < cEnd - 0.2) {
            const cl = Math.min(rng.range(1.6, 2.6), cEnd - cs);
            if (!rng.chance(0.04)) {
              const h = 0.38 + rng.range(-0.05, 0.06);
              const tilt = rng.range(-0.03, 0.03);
              push('wall', { geo: G.box, matrix: this.M(st, side * (HALF + CURB / 2), (h - 0.8) / 2, cs + cl / 2, tilt, CURB, h + 0.8, cl - 0.08), uv: 'world', uvScale: 2.5, color: C(0xd0c8b8) });
            } else {
              // broken curb: rubble
              push('rock', { geo: rng.pick(G.rocks), matrix: this.M(st, side * (HALF + CURB / 2), 0.1, cs + cl / 2, rng.range(0, 6), 0.3, 0.2, 0.3), color: C(0x7a7468) });
            }
            cs += cl;
          }
        }
      }
      // broken edges around gaps in this lane
      for (const g of st.gaps) {
        if (!g.lanes[lane]) continue;
        for (const es of [g.s0, g.s1]) {
          for (let k = 0; k < 3; k++) {
            const off = es === g.s0 ? -rng.range(0.1, 0.5) : rng.range(0.1, 0.5);
            push('rock', { geo: rng.pick(G.rocks), matrix: this.M(st, x + rng.range(-1, 1), -0.1, es + off, rng.range(0, 6), rng.range(0.2, 0.42), rng.range(0.15, 0.3), rng.range(0.2, 0.4)), color: C(0x8a8274) });
          }
          // jagged lip hanging down into the gap
          push('wall', { geo: G.box, matrix: this.M(st, x + rng.range(-0.4, 0.4), -1.2, es + (es === g.s0 ? 0.25 : -0.25), rng.range(-0.2, 0.2), rng.range(0.6, 1.4), 1.0, 0.5, rng.range(-0.3, 0.3), rng.range(-0.2, 0.2)), uv: 'world', uvScale: 4, color: C(0xa09888) });
        }
      }
    }
    // piers under the causeway
    for (let s = (st.first ? -10 : 8) + rng.range(0, 6); s < L - 6; s += rng.range(18, 26)) {
      if (st.gaps.some((g) => s > g.s0 - 2 && s < g.s1 + 2 && g.lanes.every(Boolean))) continue;
      push('wall', { geo: G.box, matrix: this.M(st, 0, -31, s, 0, 2 * HALF + 2 * CURB + 1.4, 30, 3.2), uv: 'world', uvScale: 4, color: C(0x9a9284) });
      push('wall', { geo: G.box, matrix: this.M(st, 0, -16.5, s, 0, 2 * HALF + 2 * CURB + 2.0, 1.0, 3.8), uv: 'world', uvScale: 2.5, color: C(0xb0a898) });
      // hanging roots/vines off the side of the causeway
      for (const side of [-1, 1]) {
        if (rng.chance(0.6)) {
          const len = rng.range(3, 9);
          push('plain', { geo: this.G.vine, matrix: this.M(st, side * (HALF + CURB + 0.05), 0.1, s + rng.range(-6, 6), 0, 1, len, 1), color: C(0x3a6a28) });
        }
      }
    }
  }

  // ---- junction: corner slab, dead-end wall --------------------------------
  buildJunction({ st, push, glows, rng }) {
    const L = st.length;
    const G = this.G;
    push('floor', { geo: G.box, matrix: this.M(st, 0, -0.4, L, 0, 2 * HALF, 0.8, 2 * HALF), uv: 'world', uvScale: 5, color: C(0xeae6e0) });
    push('wall', { geo: G.box, matrix: this.M(st, 0, -8.4, L, 0, 2 * HALF, 15.2, 2 * HALF), uv: 'world', uvScale: 4, color: C(0xb8b0a0) });
    // a decorative mosaic sun inlaid in the corner
    push('gold', { geo: G.cyl, matrix: this.M(st, 0, 0.005, L, 0, 1.0, 0.02, 1.0), color: C(0xffffff) });
    push('gold', { geo: G.torus, matrix: this.M(st, 0, 0.01, L, 0, 1.6, 1.6, 0.6, Math.PI / 2), color: C(0xffffff) });
    // closed sides get a curb + pillar
    for (const side of [-1, 1]) {
      const closed = (side < 0 && st.junction === 'R') || (side > 0 && st.junction === 'L');
      if (closed) {
        push('wall', { geo: G.box, matrix: this.M(st, side * (HALF + CURB / 2), -0.21, L, 0, CURB, 1.18, 2 * HALF), uv: 'world', uvScale: 2.5, color: C(0xd0c8b8) });
        push('wall', { geo: G.box, matrix: this.M(st, side * (HALF + CURB / 2), -8.4, L, 0, CURB, 15.2, 2 * HALF), uv: 'world', uvScale: 4, color: C(0xb8b0a0) });
        // a toppled column lies just past the edge
        push('wall', { geo: G.column, matrix: this.M(st, side * (HALF + 1.3), 0.0, L, 0, 0.42, 2 * HALF - 1, 0.42, Math.PI / 2), uv: 'world', uvScale: 3, color: C(0xc8c0b0) });
        push('wall', { geo: G.box, matrix: this.M(st, side * (HALF + 1.3), -0.7, L, 0, 1.2, 0.8, 2 * HALF), uv: 'world', uvScale: 2.5, color: C(0xb8b0a0) });
      }
    }
    // dead-end wall ahead: a carved temple panel flanked by columns and torches
    const wS = L + HALF + 1.0;
    const wW = 2 * HALF + 4;
    push('wall', { geo: G.box, matrix: this.M(st, 0, -6, wS, 0, wW, 14, 2), uv: 'world', uvScale: 4, color: C(0xb0a898) });
    push('glyph', { geo: G.box, matrix: this.M(st, 0, 4.0, wS - 0.05, 0, 7.0, 7.0, 2.0) });
    push('wall', { geo: G.box, matrix: this.M(st, 0, 8.2, wS, 0, wW + 0.6, 1.4, 2.6), uv: 'world', uvScale: 3, color: C(0xc8c0b0) });
    push('wall', { geo: G.box, matrix: this.M(st, 0, 9.4, wS, 0, wW - 3, 1.0, 2.0), uv: 'world', uvScale: 3, color: C(0xc0b8a8) });
    for (const side of [-1, 1]) {
      const x = side * (wW / 2 - 1.2);
      push('wall', { geo: G.column, matrix: this.M(st, x, 3.8, wS - 1.2, 0, 0.75, 7.6, 0.75), uv: 'world', uvScale: 3, color: C(0xd8d0c0) });
      push('wall', { geo: G.box, matrix: this.M(st, x, 0.3, wS - 1.2, 0, 1.8, 0.6, 1.8), uv: 'world', uvScale: 2.5, color: C(0xc8c0b0) });
      push('wall', { geo: G.box, matrix: this.M(st, x, 7.4, wS - 1.2, 0, 1.8, 0.5, 1.8), uv: 'world', uvScale: 2.5, color: C(0xc8c0b0) });
      this.torch(st, push, glows, side * 4.6, wS - 1.8, 2.2);
      // vines spilling over the wall
      for (let k = 0; k < 4; k++) {
        push('plain', { geo: G.vine, matrix: this.M(st, side * rng.range(1, wW / 2), 9.8, wS - 1.05, 0, 1.2, rng.range(2, 7), 1.2), color: C(0x2f5f22) });
      }
    }
    // leafy crown on top of the wall
    for (let k = 0; k < 6; k++) {
      push('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, rng.range(-wW / 2, wW / 2), 10 + rng.range(0, 1), wS + rng.range(-0.5, 1), rng.range(0, 6), rng.range(1.2, 2.2)), color: C(rng.pick(BIOMES[st.biome].leaves)) });
    }
  }

  // ---- starting temple ----------------------------------------------------
  buildTemple({ st, push, glows, rng }) {
    const G = this.G;
    const fs = -18; // facade position (s)
    const W = 34;
    // facade blocks around the doorway (4 wide, 5.5 tall)
    push('wall', { geo: G.box, matrix: this.M(st, -(W / 4 + 1), 6, fs, 0, W / 2 - 2, 14, 3), uv: 'world', uvScale: 4, color: C(0xc0b8a8) });
    push('wall', { geo: G.box, matrix: this.M(st, W / 4 + 1, 6, fs, 0, W / 2 - 2, 14, 3), uv: 'world', uvScale: 4, color: C(0xc0b8a8) });
    push('wall', { geo: G.box, matrix: this.M(st, 0, 9.25, fs, 0, 4, 7.5, 3), uv: 'world', uvScale: 4, color: C(0xc0b8a8) });
    push('dark', { geo: G.box, matrix: this.M(st, 0, 2.75, fs - 2.5, 0, 4, 5.5, 2) });
    // stepped pyramid tiers
    for (let i = 0; i < 4; i++) {
      push('wall', { geo: G.box, matrix: this.M(st, 0, 13 + i * 2.4, fs - 4 - i * 2, 0, W - i * 7, 2.4, 10 - i * 1.5), uv: 'world', uvScale: 4, color: C(0xb8b0a0) });
    }
    // shrine on top
    push('glyph', { geo: G.box, matrix: this.M(st, 0, 24.5, fs - 10, 0, 6, 5, 4) });
    // door frame + jaguar head carving above the door
    push('glyph', { geo: G.box, matrix: this.M(st, 0, 7.0, fs + 1.6, 0, 6.5, 3.0, 0.4) });
    for (const side of [-1, 1]) {
      push('wall', { geo: G.column, matrix: this.M(st, side * 2.8, 2.9, fs + 1.7, 0, 0.55, 5.8, 0.55), uv: 'world', uvScale: 3, color: C(0xd8d0c0) });
      glows.push([...this.point(st, fs + 1.9, side * 0.9, 7.3).toArray(), 0.7, 1.0, 0.25, 1.4]);
      this.torch(st, push, glows, side * 4.5, fs + 2.2, 2.4);
      this.monkeyStatue(st, push, glows, side * 8, 0, fs + 3, 0, 1.6);
      // big side columns
      for (let k = 0; k < 2; k++) {
        const x = side * (7 + k * 5.5);
        push('wall', { geo: G.column, matrix: this.M(st, x, 5.5, fs + 2, 0, 0.9, 11, 0.9), uv: 'world', uvScale: 3, color: C(0xd0c8b8) });
      }
    }
    // gold eyes of the carving
    for (const side of [-1, 1]) push('gold', { geo: G.sphere, matrix: this.M(st, side * 0.9, 7.3, fs + 1.85, 0, 0.25), color: C(0xffffff) });
    // empty altar the monkey stole from
    push('wall', { geo: G.box, matrix: this.M(st, 0, 0.5, -7, 0, 1.6, 1.0, 1.6), uv: 'world', uvScale: 2, color: C(0xd8d0c0) });
    push('glyph', { geo: G.box, matrix: this.M(st, 0, 1.1, -7, 0, 1.9, 0.25, 1.9) });
    push('gold', { geo: G.torus, matrix: this.M(st, 0, 1.27, -7, 0, 0.5, 0.5, 0.5, Math.PI / 2), color: C(0xffffff) });
    // wide plaza in front of the temple
    push('floor', { geo: G.box, matrix: this.M(st, 0, -0.42, -10, 0, 24, 0.8, 18), uv: 'world', uvScale: 5, color: C(0xd8d4cc) });
    push('wall', { geo: G.box, matrix: this.M(st, 0, -8.4, -10, 0, 24, 15.2, 18), uv: 'world', uvScale: 4, color: C(0xb0a898) });
    for (const side of [-1, 1]) {
      push('wall', { geo: G.box, matrix: this.M(st, side * 12.3, 0.2, -10, 0, 0.6, 0.8, 18), uv: 'world', uvScale: 2.5, color: C(0xd0c8b8) });
      this.torch(st, push, glows, side * 11.5, -3, 0.4);
      // jungle hugging the temple
      for (let k = 0; k < 6; k++) {
        const x = side * rng.range(16, 34);
        this.jungleTree(st, push, x, fs + rng.range(-12, 8), rng, BIOMES[st.biome], rng.range(14, 24));
      }
    }
  }

  // ---- obstacles ------------------------------------------------------------
  buildObstacle({ st, push, glows, rng }, o) {
    const G = this.G;
    const tag = o.tag;
    const P = (key, e) => push(key, Object.assign(e, { tag }));
    const s = o.s;
    const W = 2 * HALF + 2 * CURB;
    switch (o.type) {
      case 'log': {
        P('bark', { geo: rng.pick(G.trunks), matrix: this.M(st, -W / 2 - 0.6, 0.45, s, 0, 0.45, W + 1.2, 0.45, 0, -Math.PI / 2), uvRepeatX: 2, uvRepeatY: 3, color: C(0xc8b090) });
        P('plain', { geo: G.cyl, matrix: this.M(st, W / 2 + 0.62, 0.46, s, 0, 0.3, 0.04, 0.3, 0, Math.PI / 2), color: C(0xc8a070) });
        for (let k = 0; k < 4; k++) {
          const x = rng.range(-HALF, HALF);
          P('bark', { geo: G.cyl6, matrix: this.M(st, x, 0.75, s, rng.range(-1, 1), 0.07, 0.6, 0.07, rng.range(-0.6, 0.6), rng.range(-0.6, 0.6)), color: C(0xa08060) });
        }
        for (let k = 0; k < 5; k++) {
          P('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, rng.range(-HALF, HALF), 0.82, s + rng.range(-0.15, 0.15), 0, rng.range(0.22, 0.4), 0.18, 0.3), color: C(0x4a7a2a) });
        }
        break;
      }
      case 'roots': {
        for (let k = 0; k < 4; k++) {
          const pts = [];
          const dz = rng.range(-0.5, 0.5);
          for (let i = 0; i <= 6; i++) {
            const t = i / 6;
            pts.push(new THREE.Vector3(lerp(-W / 2 - 0.4, W / 2 + 0.4, t), Math.abs(Math.sin(t * Math.PI * rng.range(2, 4))) * 0.32 + 0.05, -(s + dz + Math.sin(t * 7 + k) * 0.25)));
          }
          const geo = curvedTube(pts, rng.range(0.08, 0.13), 24, 6, 0.6);
          P('bark', { geo, matrix: st.base.clone(), color: C(0x9a7a5a) });
        }
        break;
      }
      case 'spikes': {
        P('wall', { geo: G.box, matrix: this.M(st, 0, 0.3, s, 0, 2 * HALF, 0.6, 0.6), uv: 'world', uvScale: 2.5, color: C(0xb0a090) });
        for (let x = -HALF + 0.25; x <= HALF - 0.2; x += 0.42) {
          P('metal', { geo: G.cone, matrix: this.M(st, x, 0.8, s, 0, 0.13, 0.42, 0.13), color: C(0xffffff) });
        }
        P('gold', { geo: G.box, matrix: this.M(st, 0, 0.62, s, 0, 2 * HALF, 0.05, 0.64), color: C(0xffffff) });
        break;
      }
      case 'arch': {
        for (const side of [-1, 1]) {
          P('wall', { geo: G.column, matrix: this.M(st, side * (HALF + 0.35), 1.6, s, 0, 0.42, 3.2, 0.42), uv: 'world', uvScale: 3, color: C(0xd8d0c0) });
          P('wall', { geo: G.box, matrix: this.M(st, side * (HALF + 0.35), 0.15, s, 0, 1.0, 0.3, 1.0), uv: 'world', uvScale: 2, color: C(0xc0b8a8) });
        }
        P('glyph', { geo: G.box, matrix: this.M(st, 0, 1.58, s, 0, W + 1.4, 1.0, 1.0), uvRepeatX: 1, color: C(0xe0d8c8) });
        P('wall', { geo: G.box, matrix: this.M(st, 0, 2.25, s, 0, W + 2.0, 0.35, 1.25), uv: 'world', uvScale: 2.5, color: C(0xc8c0b0) });
        for (let k = 0; k < 6; k++) P('plain', { geo: G.vine, matrix: this.M(st, rng.range(-HALF, HALF), 1.1, s + rng.range(-0.4, 0.4), 0, 1, rng.range(0.15, 0.4), 1), color: C(0x3a6a28) });
        for (let k = 0; k < 3; k++) P('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, rng.range(-HALF, HALF), 2.5, s, 0, rng.range(0.4, 0.7), 0.3, 0.5), color: C(0x3f7a2a) });
        break;
      }
      case 'branch': {
        P('bark', { geo: rng.pick(G.trunks), matrix: this.M(st, -W / 2 - 3, 1.5, s, 0, 0.32, W + 6, 0.32, 0, -Math.PI / 2 + 0.03), uvRepeatX: 2, uvRepeatY: 4, color: C(0xb8a080) });
        for (let k = 0; k < 7; k++) {
          const x = rng.range(-HALF - 1, HALF + 1);
          P('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, x, 1.85 + rng.range(0, 0.3), s + rng.range(-0.3, 0.3), rng.range(0, 6), rng.range(0.5, 0.9), rng.range(0.35, 0.6), rng.range(0.5, 0.8)), color: C(rng.pick(BIOMES[st.biome].leaves)) });
        }
        for (let k = 0; k < 9; k++) P('plain', { geo: G.vine, matrix: this.M(st, rng.range(-HALF, HALF), 1.35, s + rng.range(-0.2, 0.2), 0, 1, rng.range(0.1, 0.25), 1), color: C(0x2f5f22) });
        break;
      }
      case 'fire': {
        for (const side of [-1, 1]) {
          // serpent-head emitter
          const x = side * (HALF + 0.55);
          P('wall', { geo: G.box, matrix: this.M(st, x, 0.9, s, 0, 0.9, 1.8, 1.1), uv: 'world', uvScale: 2, color: C(0xb8b0a0) });
          P('glyph', { geo: G.box, matrix: this.M(st, x - side * 0.1, 1.45, s, 0, 0.9, 0.8, 1.0) });
          P('gold', { geo: G.sphere, matrix: this.M(st, x - side * 0.5, 1.7, s - 0.25, 0, 0.08), color: C(0xffffff) });
          P('gold', { geo: G.sphere, matrix: this.M(st, x - side * 0.5, 1.7, s + 0.25, 0, 0.08), color: C(0xffffff) });
          P('dark', { geo: G.cyl, matrix: this.M(st, x - side * 0.46, 1.4, s, 0, 0.18, 0.05, 0.18, 0, Math.PI / 2) });
          // flame jet: plane whose +Y (uv.y) runs along the jet direction
          const len = HALF + 0.3;
          for (const roll of [0, Math.PI / 2]) {
            const m = this.M(st, x - side * 0.48, 1.4, s, 0, 1, 1, 1);
            const local = new THREE.Matrix4().makeRotationZ(side * Math.PI / 2);
            local.multiply(new THREE.Matrix4().makeRotationY(roll));
            local.multiply(new THREE.Matrix4().makeScale(0.95, len, 1));
            m.multiply(local);
            P('flame', { geo: G.flamePlane, matrix: m });
          }
          for (let k = 0; k < 4; k++) {
            glows.push([...this.point(st, s, x - side * (0.8 + k * 0.9), 1.4).toArray(), 1.0, 0.45, 0.1, 2.6 - k * 0.3]);
          }
        }
        o.fireGlow = this.point(st, s, 0, 1.4);
        break;
      }
      case 'gap':
      case 'bridge':
        break; // the floor builder already carved the hole
      case 'pillar': {
        const lane = o.lanes.indexOf(true);
        const x = LANES_X[lane];
        const h = rng.range(2.6, 3.4);
        P('wall', { geo: G.box, matrix: this.M(st, x, 0.25, s, rng.range(-0.2, 0.2), 1.9, 0.5, 1.9), uv: 'world', uvScale: 2.5, color: C(0xc8c0b0) });
        P('wall', { geo: G.column, matrix: this.M(st, x, 0.5 + h / 2, s, rng.range(0, 3), 0.75, h, 0.75, rng.range(-0.04, 0.04), rng.range(-0.04, 0.04)), uv: 'world', uvScale: 3, color: C(0xd8d0c0) });
        P('rock', { geo: rng.pick(G.rocks), matrix: this.M(st, x, 0.5 + h, s, rng.range(0, 6), 0.72, 0.35, 0.72), color: C(0xa8a090) });
        P('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, x + 0.3, 0.5 + h + 0.2, s, 0, 0.45, 0.3, 0.45), color: C(0x4a7a2a) });
        if (rng.chance(0.5)) P('plain', { geo: G.vine, matrix: this.M(st, x + 0.6, 0.5 + h, s - 0.4, 0, 1.3, h * 0.7, 1.3), color: C(0x3a6a28) });
        break;
      }
      case 'boulder': {
        const lane = o.lanes.indexOf(true);
        const x = LANES_X[lane];
        P('rock', { geo: rng.pick(G.rocks), matrix: this.M(st, x, 1.05, s, rng.range(0, 6), 1.15, 1.25, 1.05), color: C(0x8a857a) });
        P('rock', { geo: rng.pick(G.rocks), matrix: this.M(st, x + rng.range(-0.6, 0.6), 0.25, s + rng.range(-0.8, 0.8), rng.range(0, 6), 0.35), color: C(0x7a7568) });
        P('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, x, 2.15, s, 0, 0.55, 0.22, 0.5), color: C(0x4a6a2a) });
        break;
      }
      case 'statue': {
        const lane = o.lanes.indexOf(true);
        this.monkeyStatue(st, P, glows, LANES_X[lane], 0, s, 0, 1.15, tag);
        break;
      }
      case 'rubble': {
        const lane = o.lanes.indexOf(true);
        const x = LANES_X[lane];
        for (let k = 0; k < 4; k++) {
          P('wall', { geo: G.box, matrix: this.M(st, x + rng.range(-0.6, 0.6), 0.3 + (k > 1 ? 0.45 : 0), s + rng.range(-0.3, 0.3), rng.range(-0.5, 0.5), rng.range(0.7, 1.1), 0.55, rng.range(0.5, 0.8), rng.range(-0.15, 0.15), rng.range(-0.15, 0.15)), uv: 'world', uvScale: 2, color: C(0xc0b8a8) });
        }
        P('rock', { geo: rng.pick(G.rocks), matrix: this.M(st, x + 0.7, 0.2, s + 0.5, 0, 0.3), color: C(0x8a857a) });
        break;
      }
    }
  }

  // ---- reusable props ---------------------------------------------------------
  torch(st, push, glows, x, s, y = 0.38) {
    const G = this.G;
    push('plain', { geo: G.cyl6, matrix: this.M(st, x, y + 0.75, s, 0, 0.09, 1.5, 0.09), color: C(0x3a2616) });
    push('metal', { geo: G.cyl, matrix: this.M(st, x, y + 1.55, s, 0, 0.24, 0.2, 0.24), color: C(0x8a6a40) });
    push('gold', { geo: G.torus, matrix: this.M(st, x, y + 1.62, s, 0, 0.24, 0.24, 0.24, Math.PI / 2), color: C(0xffffff) });
    for (const r of [0, Math.PI / 2]) {
      push('flame', { geo: G.flamePlane, matrix: this.M(st, x, y + 1.6, s, r, 0.55, 0.95, 1) });
    }
    const p = this.point(st, s, x, y + 1.95);
    glows.push([p.x, p.y, p.z, 1.0, 0.55, 0.18, 3.2]);
    st.torches.push(p);
  }

  monkeyStatue(st, push, glows, x, y, s, ry, sc, tag) {
    const G = this.G;
    const P = (k, e) => push(k, tag !== undefined ? Object.assign(e, { tag }) : e);
    const rc = C(0x9a9888);
    const m = (lx, ly, lz, rx, ryy, rz, sx, sy, sz) => {
      const base = this.M(st, x, y, s, ry, sc);
      return base.multiply(mat(lx, ly, lz, rx, ryy, rz, sx, sy, sz));
    };
    P('wall', { geo: G.box, matrix: m(0, 0.4, 0, 0, 0, 0, 1.5, 0.8, 1.5), uv: 'world', uvScale: 2, color: C(0xc8c0b0) });
    P('rock', { geo: G.sphere, matrix: m(0, 1.3, 0, 0, 0, 0, 0.62, 0.7, 0.55), color: rc });
    P('rock', { geo: G.sphere, matrix: m(0, 2.15, 0, 0, 0, 0, 0.48, 0.45, 0.45), color: rc });
    P('rock', { geo: G.sphere, matrix: m(0, 2.05, -0.36, 0, 0, 0, 0.3, 0.22, 0.2), color: C(0xb0ae9e) });
    for (const side of [-1, 1]) {
      P('rock', { geo: G.sphere, matrix: m(side * 0.48, 2.2, 0, 0, 0, 0, 0.14, 0.18, 0.08), color: rc });
      P('rock', { geo: G.sphere, matrix: m(side * 0.45, 1.25, -0.25, 0.6, 0, side * 0.4, 0.17, 0.45, 0.17), color: rc });
      P('rock', { geo: G.sphere, matrix: m(side * 0.32, 0.9, -0.3, 0, 0, 0, 0.22, 0.18, 0.4), color: rc });
      P('gold', { geo: G.sphere, matrix: m(side * 0.16, 2.24, -0.4, 0, 0, 0, 0.08, 0.08, 0.05), color: C(0xffffff) });
      const ep = new THREE.Vector3(side * 0.16, 2.24, -0.45).applyMatrix4(this.M(st, x, y, s, ry, sc));
      glows.push([ep.x, ep.y, ep.z, 1.0, 0.75, 0.2, 0.5 * sc]);
    }
    // golden banana offering in its hands
    P('gold', { geo: G.sphere, matrix: m(0, 1.2, -0.55, 0, 0, 0.5, 0.1, 0.32, 0.1), color: C(0xffffff) });
    P('leaves', { geo: G.blobs[0], matrix: m(0.2, 2.5, 0.1, 0, 0, 0, 0.3, 0.12, 0.3), color: C(0x4a7a2a) });
  }

  jungleTree(st, push, x, s, rng, biome, top = rng.range(7, 17), lowDetail = false) {
    const G = this.G;
    const base = -32;
    const r = rng.range(0.5, 1.1) * (lowDetail ? 1.3 : 1);
    const h = top - base;
    const lean = rng.range(-0.06, 0.06);
    push('bark', { geo: rng.pick(G.trunks), matrix: this.M(st, x, base, s, rng.range(0, 6), r, h, r, lean, rng.range(-0.05, 0.05)), uvRepeatX: 2, uvRepeatY: Math.round(h / 6), color: C(0xffffff).multiplyScalar(rng.range(0.75, 1.05)) });
    const blobs = lowDetail ? 2 : rng.int(3, 6);
    const leaf = biome.leaves;
    for (let i = 0; i < blobs; i++) {
      const a = (i / blobs) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const d = i === 0 ? 0 : rng.range(1.2, 3.0);
      const sc = rng.range(2.2, 4.0) * (lowDetail ? 1.4 : 1);
      const col = C(rng.pick(leaf)).multiplyScalar(rng.range(0.8, 1.15));
      push('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, x + Math.cos(a) * d, top + rng.range(-1.2, 1.5), s + Math.sin(a) * d, rng.range(0, 6), sc, sc * rng.range(0.55, 0.8), sc), color: col });
      if (!lowDetail && i > 0) {
        // branch to the blob
        const bx = x + Math.cos(a) * d * 0.5, bs = s + Math.sin(a) * d * 0.5;
        push('bark', { geo: G.cyl6, matrix: this.M(st, bx, top - 1.4, bs, -a + Math.PI / 2, r * 0.25, d * 1.3, r * 0.25, 0.9), color: C(0xbbbbbb) });
      }
    }
    if (!lowDetail && rng.chance(0.55)) {
      // hanging lianas
      for (let k = 0; k < rng.int(1, 3); k++) {
        push('plain', { geo: G.vine, matrix: this.M(st, x + rng.range(-2.5, 2.5), top - 0.5, s + rng.range(-2.5, 2.5), 0, rng.range(1, 1.6), rng.range(4, 10), 1), color: C(0x2f5a20) });
      }
    }
  }

  palmTree(st, push, x, s, rng, biome) {
    const G = this.G;
    let px = x, py = -20, pz = s;
    const segs = 8;
    const totalH = rng.range(24, 32);
    const bendA = rng.range(0, Math.PI * 2);
    const bend = rng.range(0.02, 0.06);
    let tilt = 0;
    const sh = totalH / segs;
    for (let i = 0; i < segs; i++) {
      tilt += bend;
      const r = lerp(0.42, 0.28, i / segs);
      // trunk axis after yaw(bendA) * pitch(tilt), in the straight's local frame
      const ax = Math.sin(tilt) * Math.sin(bendA), ay = Math.cos(tilt), az = Math.sin(tilt) * Math.cos(bendA);
      push('bark', { geo: G.cyl, matrix: this.M(st, px + ax * sh / 2, py + ay * sh / 2, pz - az * sh / 2, bendA, r, sh * 1.05, r, tilt, 0), uvRepeatY: 2, color: C(0xc8b090) });
      px += ax * sh;
      py += ay * sh;
      pz -= az * sh;
    }
    // crown
    const leaf = biome.leaves;
    const n = rng.int(7, 10);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
      push('palm', { geo: G.frond, matrix: this.M(st, px, py, pz, a, rng.range(4, 5.5), rng.range(3, 4.5), rng.range(4, 5.5), rng.range(-0.35, 0.15)), color: C(rng.pick(leaf)).lerp(C(0xffffff), 0.35) });
    }
    for (let i = 0; i < 3; i++) push('plain', { geo: G.sphere, matrix: this.M(st, px + rng.range(-0.3, 0.3), py - 0.3, pz + rng.range(-0.3, 0.3), 0, 0.22), color: C(0x5a3a1a) });
  }

  bambooCluster(st, push, x, s, rng, biome) {
    const G = this.G;
    const n = rng.int(5, 11);
    for (let i = 0; i < n; i++) {
      const bx = x + rng.range(-1.6, 1.6), bs = s + rng.range(-1.6, 1.6);
      const h = rng.range(20, 34);
      const r = rng.range(0.1, 0.19);
      const lx = rng.range(-0.08, 0.08), lz = rng.range(-0.08, 0.08);
      push('plain', { geo: G.bamboo, matrix: this.M(st, bx, -16, bs, rng.range(0, 6), r, h, r, lx, lz), color: C(0xffffff).multiplyScalar(rng.range(0.8, 1.15)) });
      const topY = -16 + h * 0.97;
      for (let k = 0; k < 3; k++) {
        push('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, bx + lz * -h * 0.9 + rng.range(-0.8, 0.8), topY - k * 1.8, bs + lx * h * 0.9 + rng.range(-0.8, 0.8), rng.range(0, 6), rng.range(0.8, 1.4), 0.25, rng.range(0.8, 1.4)), color: C(rng.pick(biome.leaves)) });
      }
    }
  }

  fern(st, push, x, y, s, side, rng, biome) {
    const n = rng.int(4, 7);
    for (let i = 0; i < n; i++) {
      const a = (side > 0 ? -Math.PI / 2 : Math.PI / 2) + rng.range(-1.2, 1.2);
      push('palm', { geo: this.G.frond, matrix: this.M(st, x, y, s, a, rng.range(0.8, 1.4), rng.range(0.6, 1.0), rng.range(0.9, 1.6), rng.range(-0.6, -0.2)), color: C(rng.pick(biome.leaves)).lerp(C(0xffffff), 0.3) });
    }
  }

  ruinPlatform(st, push, glows, side, s, rng, biome) {
    const G = this.G;
    const x = side * (HALF + CURB + 3.0);
    push('wall', { geo: G.box, matrix: this.M(st, x, -1.3, s, rng.range(-0.1, 0.1), 4.6, 1.6, rng.range(4, 6)), uv: 'world', uvScale: 3, color: C(0xb8b0a0) });
    push('wall', { geo: G.box, matrix: this.M(st, x, -10, s, 0, 3.4, 16, 3.4), uv: 'world', uvScale: 4, color: C(0x9a9284) });
    const kind = rng.int(0, 3);
    if (kind === 0) {
      // broken colonnade
      for (let k = -1; k <= 1; k += 2) {
        const h = rng.range(1.5, 6);
        push('wall', { geo: G.column, matrix: this.M(st, x, -0.5 + h / 2, s + k * 1.6, rng.range(0, 3), 0.48, h, 0.48), uv: 'world', uvScale: 3, color: C(0xd8d0c0) });
        push('rock', { geo: rng.pick(G.rocks), matrix: this.M(st, x, -0.5 + h, s + k * 1.6, rng.range(0, 6), 0.45, 0.25, 0.45), color: C(0xa8a090) });
      }
      push('wall', { geo: G.column, matrix: this.M(st, x + side * 0.6, 0.0, s, rng.range(-0.3, 0.3), 0.45, 3.2, 0.45, 0, Math.PI / 2), uv: 'world', uvScale: 3, color: C(0xc8c0b0) });
    } else if (kind === 1) {
      // monkey idol shrine
      this.monkeyStatue(st, push, glows, x, -0.5, s, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1.3);
    } else if (kind === 2) {
      // intact gate fragment with lintel
      for (const k of [-1, 1]) push('wall', { geo: G.column, matrix: this.M(st, x, 2, s + k * 1.5, 0, 0.42, 5, 0.42), uv: 'world', uvScale: 3, color: C(0xd8d0c0) });
      push('glyph', { geo: G.box, matrix: this.M(st, x, 4.9, s, Math.PI / 2, 4.2, 1.0, 1.0) });
    } else {
      // tumbled blocks and a big rock
      for (let k = 0; k < 4; k++) push('wall', { geo: G.box, matrix: this.M(st, x + rng.range(-1.4, 1.4), -0.1 + rng.range(0, 0.6), s + rng.range(-2, 2), rng.range(0, 3), rng.range(0.7, 1.3), rng.range(0.5, 0.9), rng.range(0.7, 1.3), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)), uv: 'world', uvScale: 2, color: C(0xc0b8a8) });
      push('rock', { geo: rng.pick(G.rocks), matrix: this.M(st, x, 0.4, s, rng.range(0, 6), 1.2, 1.0, 1.1), color: C(0x8a857a) });
    }
    for (let k = 0; k < 2; k++) push('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, x + rng.range(-1.8, 1.8), -0.4, s + rng.range(-2, 2), rng.range(0, 6), rng.range(0.5, 0.9)), color: C(rng.pick(biome.leaves)) });
  }

  gateway(st, push, glows, s, rng) {
    const G = this.G;
    const W = 2 * HALF + 2.6;
    for (const side of [-1, 1]) {
      const x = side * (HALF + 0.55);
      push('wall', { geo: G.box, matrix: this.M(st, x, 0.55, s, 0, 1.2, 0.5, 1.2), uv: 'world', uvScale: 2, color: C(0xc8c0b0) });
      push('wall', { geo: G.column, matrix: this.M(st, x, 3.8, s, 0, 0.45, 6.2, 0.45), uv: 'world', uvScale: 3, color: C(0xd8d0c0) });
      push('wall', { geo: G.box, matrix: this.M(st, x, 7.0, s, 0, 1.1, 0.35, 1.1), uv: 'world', uvScale: 2, color: C(0xc8c0b0) });
    }
    push('glyph', { geo: G.box, matrix: this.M(st, 0, 7.7, s, 0, W, 1.2, 1.1) });
    push('wall', { geo: G.box, matrix: this.M(st, 0, 8.5, s, 0, W + 0.8, 0.4, 1.4), uv: 'world', uvScale: 2.5, color: C(0xc8c0b0) });
    push('wall', { geo: G.box, matrix: this.M(st, 0, 9.1, s, 0, 2.2, 0.8, 1.0), uv: 'world', uvScale: 2.5, color: C(0xc8c0b0) });
    push('gold', { geo: G.sphere, matrix: this.M(st, 0, 9.1, s - 0.5, 0, 0.3, 0.3, 0.12), color: C(0xffffff) });
    for (let k = 0; k < 7; k++) push('plain', { geo: G.vine, matrix: this.M(st, rng.range(-W / 2, W / 2), 7.1, s + rng.range(-0.5, 0.5), 0, 1, rng.range(0.8, 3.2), 1), color: C(0x2f5f22) });
    for (let k = 0; k < 4; k++) push('leaves', { geo: rng.pick(G.blobs), matrix: this.M(st, rng.range(-W / 2, W / 2), 8.9, s, rng.range(0, 6), rng.range(0.6, 1.1), 0.5, 0.8), color: C(0x3f7a2a) });
  }

  // ---- decoration pass ---------------------------------------------------------
  decorBlocked(st, sign, s) {
    const openLeft = st.junction !== 'R', openRight = st.junction !== 'L';
    if (s > st.length - 14 && ((sign < 0 && openLeft) || (sign > 0 && openRight))) return true;
    // the chase camera swings over the closed side while turning: keep it clear
    if (s > st.length - 11) return true;
    if (!st.first) {
      const back = st.side === 'right' ? 1 : -1;
      if (sign === back && s < 14) return true;
      if (sign !== back && s < 10) return true;
    } else if (s < -2) return true;
    return false;
  }

  buildDecor(ctx) {
    const { st, push, glows, rng, biome } = ctx;
    const D = biome.decor;
    const L = st.length;
    const dens = this.density;
    const nearObstacle = (s, r) => st.obstacles.some((o) => s > o.s0 - r && s < o.s1 + r);
    for (const side of [-1, 1]) {
      // big trees
      if (D.trees > 0) {
        for (let s = rng.range(0, 6); s < L; s += rng.range(6, 11) / (D.trees * dens)) {
          if (this.decorBlocked(st, side, s)) continue;
          const lat = HALF + CURB + rng.range(4, 18);
          this.jungleTree(st, push, side * lat, s, rng, biome);
        }
      }
      // far layer for density on the horizon
      for (let s = rng.range(0, 10); s < L; s += rng.range(9, 16) / dens) {
        if (this.decorBlocked(st, side, s)) continue;
        const lat = HALF + CURB + rng.range(22, 45);
        if (D.bamboo > 0.5 && rng.chance(0.6)) this.bambooCluster(st, push, side * lat, s, rng, biome);
        else this.jungleTree(st, push, side * lat, s, rng, biome, rng.range(4, 14), true);
      }
      if (D.palms > 0) {
        for (let s = rng.range(0, 20); s < L; s += rng.range(14, 26) / (D.palms * dens)) {
          if (this.decorBlocked(st, side, s)) continue;
          this.palmTree(st, push, side * (HALF + CURB + rng.range(5, 14)), s, rng, biome);
        }
      }
      if (D.bamboo > 0) {
        for (let s = rng.range(0, 6); s < L; s += rng.range(5, 9) / (D.bamboo * dens)) {
          if (this.decorBlocked(st, side, s)) continue;
          this.bambooCluster(st, push, side * (HALF + CURB + rng.range(3.5, 16)), s, rng, biome);
        }
      }
      // ruins platforms
      for (let s = rng.range(10, 30); s < L - 6; s += rng.range(22, 40) / D.ruins) {
        if (this.decorBlocked(st, side, s) || this.decorBlocked(st, side, s + 3) || this.decorBlocked(st, side, s - 3)) continue;
        this.ruinPlatform(st, push, glows, side, s, rng, biome);
      }
      // ferns & bushes spilling over the curb
      for (let s = rng.range(0, 4); s < L - HALF; s += rng.range(3, 7) / (D.ferns * dens)) {
        if (this.decorBlocked(st, side, s) && (s > L - 14 || s < 14)) continue;
        if (st.gaps.some((g) => s > g.s0 - 1 && s < g.s1 + 1)) continue;
        if (rng.chance(0.55)) this.fern(st, push, side * (HALF + CURB + 0.1), 0.1, s, side, rng, biome);
        else push('leaves', { geo: rng.pick(this.G.blobs), matrix: this.M(st, side * (HALF + CURB + 0.5), 0.0, s, rng.range(0, 6), rng.range(0.6, 1.2), rng.range(0.4, 0.8), rng.range(0.7, 1.3)), color: C(rng.pick(biome.leaves)) });
      }
      // glowing mushrooms
      if (D.mushrooms > 0) {
        for (let s = rng.range(2, 8); s < L - HALF; s += rng.range(5, 10)) {
          if (st.gaps.some((g) => s > g.s0 - 1 && s < g.s1 + 1)) continue;
          const x = side * (HALF + CURB + rng.range(0.1, 0.5));
          for (let k = 0; k < rng.int(2, 4); k++) {
            const ms = s + rng.range(-0.6, 0.6), mx = x + side * rng.range(0, 0.4);
            const h = rng.range(0.15, 0.45), r = rng.range(0.1, 0.24);
            push('plain', { geo: this.G.cyl6, matrix: this.M(st, mx, h / 2, ms, 0, 0.035, h, 0.035), color: C(0xd8d0c0) });
            const hue = rng.pick([0x40e0ff, 0x60ffb0, 0xa070ff]);
            push('shroom', { geo: this.G.hemi, matrix: this.M(st, mx, h, ms, 0, r, r * 0.6, r), color: C(hue) });
            const p = this.point(st, ms, mx, h + 0.1);
            const c = C(hue);
            glows.push([p.x, p.y, p.z, c.r * 0.6, c.g * 0.6, c.b * 0.6, 1.0]);
          }
        }
      }
      // hanging vines from the canopy near the path edges
      for (let s = rng.range(0, 10); s < L; s += rng.range(9, 18) / dens) {
        if (this.decorBlocked(st, side, s)) continue;
        const x = side * (HALF + rng.range(0.3, 2.8));
        const bottom = rng.range(4.2, 8);
        const top = rng.range(11, 14);
        push('leaves', { geo: rng.pick(this.G.blobs), matrix: this.M(st, x + side * 1.2, top + 0.6, s, rng.range(0, 6), rng.range(1.8, 2.8), rng.range(0.9, 1.3), rng.range(1.8, 2.8)), color: C(rng.pick(biome.leaves)) });
        push('plain', { geo: this.G.vine, matrix: this.M(st, x, top, s, 0, rng.range(1.2, 2), top - bottom, 1.2), color: C(0x2f5f22).multiplyScalar(rng.range(0.8, 1.2)) });
        for (let k = 0; k < 3; k++) {
          push('leaves', { geo: this.G.blobs[k], matrix: this.M(st, x, bottom + k * rng.range(1, 2.5), s, rng.range(0, 6), 0.18, 0.28, 0.12), color: C(0x3f7a2a) });
        }
      }
    }
    // torches along the curbs
    const te = D.torchEvery;
    for (let s = rng.range(4, te); s < L - HALF - 2; s += te * rng.range(0.85, 1.15)) {
      if (st.gaps.some((g) => s > g.s0 - 1 && s < g.s1 + 1)) continue;
      if (nearObstacle(s, 1.5)) continue;
      for (const side of [-1, 1]) {
        if (this.decorBlocked(st, side, s)) continue;
        this.torch(st, push, glows, side * (HALF + CURB / 2), s);
      }
    }
    // decorative gateways over the path
    for (let s = rng.range(25, 50); s < L - 20; s += rng.range(55, 90)) {
      if (nearObstacle(s, 4)) continue;
      if (st.gaps.some((g) => s > g.s0 - 2 && s < g.s1 + 2)) continue;
      this.gateway(st, push, glows, s, rng);
    }
    // trees behind the dead-end wall close the view
    for (let k = 0; k < 6; k++) {
      this.jungleTree(st, push, rng.range(-10, 10), L + HALF + rng.range(5, 20), rng, biome, rng.range(10, 18));
    }
  }

  // =========================================================================
  // Per-frame
  // =========================================================================
  // Lane obstacles the player has passed sink into the causeway so they never
  // fill the chase camera's view as it goes by.
  sink(st, o) {
    if (o.dead || o.sunk) return;
    o.sunk = true;
    const parts = [];
    for (const { mesh, ranges } of st.merged) {
      const list = ranges.get(o.tag);
      if (!list) continue;
      const P = mesh.geometry.attributes.position;
      for (const [start, count] of list) {
        const ys = new Float32Array(count);
        for (let i = 0; i < count; i++) ys[i] = P.getY(start + i);
        parts.push({ P, start, count, ys });
      }
    }
    if (parts.length) this.sinking.push({ st, parts, t: 0 });
  }

  updateSinking(dt) {
    for (let k = this.sinking.length - 1; k >= 0; k--) {
      const e = this.sinking[k];
      if (e.st.disposed) {
        this.sinking.splice(k, 1);
        continue;
      }
      e.t += dt;
      const f = Math.min(1, e.t / 0.4);
      const off = -f * f * 4.0;
      for (const { P, start, count, ys } of e.parts) {
        for (let i = 0; i < count; i++) P.setY(start + i, ys[i] + off);
        P.addUpdateRange(start * 3, count * 3);
        P.needsUpdate = true;
      }
      if (f >= 1) this.sinking.splice(k, 1);
    }
  }

  smash(st, o) {
    if (o.dead) return;
    o.dead = true;
    for (const { mesh, ranges } of st.merged) {
      const list = ranges.get(o.tag);
      if (list) collapseRanges(mesh.geometry, list);
    }
  }

  update(dt, t) {
    this.updateSinking(dt);
    this.mats.flame.uniforms.uTime.value = t;
    this.glowMat.uniforms.uTime.value = t;
    let n = 0, g = 0;
    const m = this._m, q = this._q, e = this._e, sc = this._s, p = this._p;
    for (const st of this.live) {
      for (const b of st.bananas) {
        if (b.taken) continue;
        const spin = t * 2.6 + b.phase;
        e.set(0.25, spin, 0.5);
        q.setFromEuler(e);
        p.copy(b.pos);
        if (!b.fly) p.y += Math.sin(t * 3 + b.phase) * 0.08;
        const k = b.golden ? 1.3 : 1.0;
        sc.set(k, k, k);
        m.compose(p, q, sc);
        if (b.golden) {
          if (g < 200) this.goldMesh.setMatrixAt(g++, m);
        } else if (n < 1600) this.bananaMesh.setMatrixAt(n++, m);
      }
      for (const pu of st.powerups) {
        if (!pu.mesh) continue;
        pu.mesh.visible = !pu.taken;
        pu.mesh.position.y = pu.pos.y + Math.sin(t * 2.5) * 0.15;
        pu.rings[0].rotation.y = t * 2;
        pu.rings[1].rotation.x = t * 2.4;
      }
    }
    this.bananaMesh.count = n;
    this.goldMesh.count = g;
    this.bananaMesh.instanceMatrix.needsUpdate = true;
    this.goldMesh.instanceMatrix.needsUpdate = true;
  }

  // nearest torch positions to a point, for dynamic lights
  nearestTorches(p, count, out) {
    out.length = 0;
    for (const st of this.live) for (const t of st.torches) out.push(t);
    out.sort((a, b) => a.distanceToSquared(p) - b.distanceToSquared(p));
    out.length = Math.min(out.length, count);
    return out;
  }
}
