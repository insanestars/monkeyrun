import * as THREE from 'three';
import { damp, clamp, lerp } from './utils.js';
import { bananaGeometry } from './shapes.js';

// ---------------------------------------------------------------------------
// Playable monkeys. Every skin is the same rig with different fur, face and
// accessories.
// ---------------------------------------------------------------------------
export const SKINS = [
  { id: 'classic', name: 'Coco', species: 'Capuchin', price: 0, fur: 0x6b4226, belly: 0xb07d4f, face: 0xeac4a0, ear: 0xd9a77e, eye: 0x4a2a12, acc: [], desc: 'The original temple thief.' },
  { id: 'golden', name: 'Sunny', species: 'Golden Tamarin', price: 1500, fur: 0xe38b1c, belly: 0xf5b955, face: 0x3b2618, ear: 0x2a1a10, eye: 0x6a3a10, acc: ['mane'], desc: 'A blazing mane, blazing feet.' },
  { id: 'snow', name: 'Yuki', species: 'Snow Macaque', price: 2500, fur: 0xbdb7ae, belly: 0xdcd8d0, face: 0xe57f7f, ear: 0xd56b6b, eye: 0x3a2a1a, acc: ['scarf'], desc: 'Came down from the hot springs.' },
  { id: 'explorer', name: 'Bongo', species: 'Explorer Chimp', price: 3500, fur: 0x4a3426, belly: 0x7a5a42, face: 0xd8b48e, ear: 0xc49a76, eye: 0x2a1a0a, acc: ['fedora', 'satchel'], desc: 'Never leaves camp without the hat.' },
  { id: 'ninja', name: 'Kage', species: 'Shadow Langur', price: 5000, fur: 0x26262c, belly: 0x44444e, face: 0xcaa88a, ear: 0xa88870, eye: 0x111111, acc: ['headband'], desc: 'Silent paws, fast tail.' },
  { id: 'mandrill', name: 'Mandro', species: 'Mandrill', price: 7000, fur: 0x55583e, belly: 0x9a9a72, face: 0x2c5fd0, ear: 0x3a3a2a, eye: 0x6a4a10, acc: ['mandrill'], desc: 'The loudest face in the jungle.' },
  { id: 'royal', name: 'Rufus', species: 'Royal Gorilla', price: 12000, fur: 0x3a3a3e, belly: 0x5e5e66, face: 0x2a2a2e, ear: 0x2a2a2e, eye: 0x3a2010, acc: ['crown', 'cape'], desc: 'Rules the canopy. Runs anyway.', bulk: 1.12 },
];

const SPHERE = new THREE.SphereGeometry(1, 22, 16);
const SPHERE_LO = new THREE.SphereGeometry(1, 12, 8);

function capsule(r, len) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 12);
  g.translate(0, -len / 2, 0); // pivot at top
  return g;
}

export class Monkey {
  constructor(textures) {
    this.tex = textures;
    this.group = new THREE.Group(); // positioned by the game
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.mats = {
      fur: new THREE.MeshStandardMaterial({ color: 0x6b4226, map: textures.fur, roughness: 0.95 }),
      belly: new THREE.MeshStandardMaterial({ color: 0xb07d4f, map: textures.fur, roughness: 0.95 }),
      face: new THREE.MeshStandardMaterial({ color: 0xeac4a0, roughness: 0.6 }),
      ear: new THREE.MeshStandardMaterial({ color: 0xd9a77e, roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1a0f08, roughness: 0.4 }),
      eyeWhite: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15 }),
      iris: new THREE.MeshStandardMaterial({ color: 0x4a2a12, roughness: 0.2 }),
      shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      mouth: new THREE.MeshStandardMaterial({ color: 0x3a0d0d, roughness: 0.5 }),
      tongue: new THREE.MeshStandardMaterial({ color: 0xd8506a, roughness: 0.5 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xffc534, metalness: 0.85, roughness: 0.25, emissive: 0x7a4a00, emissiveIntensity: 0.5 }),
    };
    this.j = {}; // joints
    this.build();
    this.phase = 0;
    this.time = 0;
    this.blinkT = 2;
    this.spin = 0;
    this.stepCallback = null;
    this.lastStepSign = 1;
    this.setSkin(SKINS[0]);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
  }

  mesh(geo, mat, parent, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  }

  joint(name, parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    this.j[name] = g;
    g.userData.rest = new THREE.Euler();
    return g;
  }

  build() {
    const M = this.mats;
    const j = this.j;
    const hips = this.joint('hips', this.body, 0, 0.62, 0);

    // --- torso ---------------------------------------------------------
    this.mesh(SPHERE, M.fur, hips, 0, 0.18, 0.02, 0.27, 0.3, 0.24);
    this.mesh(SPHERE, M.belly, hips, 0, 0.14, -0.12, 0.19, 0.24, 0.13);
    const chest = this.joint('chest', hips, 0, 0.3, 0);
    this.mesh(SPHERE, M.fur, chest, 0, 0.04, 0.02, 0.3, 0.24, 0.25);
    this.mesh(SPHERE, M.belly, chest, 0, 0.02, -0.13, 0.2, 0.17, 0.12);

    // --- head ----------------------------------------------------------
    const neck = this.joint('neck', chest, 0, 0.2, -0.02);
    const head = this.joint('head', neck, 0, 0.17, 0);
    this.headMesh = this.mesh(SPHERE, M.fur, head, 0, 0.02, 0, 0.27, 0.26, 0.26);
    // hair tuft
    const tuftGeo = new THREE.ConeGeometry(0.045, 0.16, 8);
    this.tufts = [];
    for (let i = -1; i <= 1; i++) {
      const t = this.mesh(tuftGeo, M.fur, head, i * 0.05, 0.27, 0.02 + Math.abs(i) * 0.02);
      t.rotation.set(-0.3, 0, -i * 0.5);
      this.tufts.push(t);
    }
    // face mask: two eye lobes + muzzle (heart-shaped)
    this.faceParts = [];
    this.faceParts.push(this.mesh(SPHERE, M.face, head, -0.085, 0.045, -0.165, 0.12, 0.12, 0.1));
    this.faceParts.push(this.mesh(SPHERE, M.face, head, 0.085, 0.045, -0.165, 0.12, 0.12, 0.1));
    this.muzzle = this.mesh(SPHERE, M.face, head, 0, -0.075, -0.2, 0.15, 0.11, 0.12);
    this.faceParts.push(this.muzzle);
    // brow ridge
    this.brow = this.mesh(SPHERE, M.fur, head, 0, 0.13, -0.17, 0.2, 0.05, 0.08);
    // nose
    this.mesh(SPHERE_LO, M.dark, head, -0.025, -0.045, -0.31, 0.022, 0.016, 0.016);
    this.mesh(SPHERE_LO, M.dark, head, 0.025, -0.045, -0.31, 0.022, 0.016, 0.016);
    // mouth: smile + open mouth
    const smileGeo = new THREE.TorusGeometry(0.06, 0.011, 6, 16, Math.PI * 0.8);
    this.smile = this.mesh(smileGeo, M.dark, head, 0, -0.08, -0.305);
    this.smile.rotation.set(0.2, 0, Math.PI + Math.PI * 0.1);
    this.mouthOpen = this.mesh(SPHERE, M.mouth, head, 0, -0.11, -0.29, 0.055, 0.045, 0.03);
    this.tongue = this.mesh(SPHERE_LO, M.tongue, this.mouthOpen, 0, -0.4, -0.2, 0.6, 0.4, 0.6);
    this.mouthOpen.visible = false;
    // eyes
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.085, 0.05, -0.235);
      head.add(eye);
      this.mesh(SPHERE, M.eyeWhite, eye, 0, 0, 0, 0.058, 0.064, 0.04);
      const iris = this.mesh(SPHERE, M.iris, eye, s * -0.006, -0.004, -0.028, 0.036, 0.04, 0.02);
      this.mesh(SPHERE_LO, M.dark, iris, 0, 0, -0.5, 0.55, 0.55, 0.5);
      this.mesh(SPHERE_LO, M.shine, iris, 0.3, 0.35, -0.9, 0.25, 0.25, 0.2);
      // eyelid (fur coloured shell that closes for blinks)
      const lid = this.mesh(SPHERE, M.face, eye, 0, 0.0, 0.004, 0.064, 0.07, 0.046);
      lid.scale.y = 0.001;
      lid.position.y = 0.06;
      eye.userData.lid = lid;
      eye.userData.iris = iris;
      this.eyes.push(eye);
    }
    // eyebrows
    this.brows = [];
    const browGeo = new THREE.CapsuleGeometry(0.012, 0.06, 4, 6);
    for (const s of [-1, 1]) {
      const b = this.mesh(browGeo, M.dark, head, s * 0.085, 0.13, -0.235);
      b.rotation.z = Math.PI / 2 + s * 0.15;
      this.brows.push(b);
    }
    // ears
    this.ears = [];
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(s * 0.26, 0.03, 0.0);
      head.add(ear);
      this.mesh(SPHERE, M.fur, ear, 0, 0, 0, 0.05, 0.1, 0.09);
      this.mesh(SPHERE, M.ear, ear, s * 0.02, 0, -0.01, 0.03, 0.07, 0.065);
      this.ears.push(ear);
    }
    // mandrill nose ridges (only visible on the mandrill skin)
    this.mandrillParts = [];
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0xd81e2a, roughness: 0.4 });
    this.mandrillParts.push(this.mesh(SPHERE, ridgeMat, head, 0, -0.02, -0.29, 0.035, 0.08, 0.04));
    for (const s of [-1, 1]) {
      const p = this.mesh(SPHERE, this.mats.face, head, s * 0.07, -0.05, -0.24, 0.05, 0.08, 0.06);
      this.mandrillParts.push(p);
    }

    // --- arms ----------------------------------------------------------
    const upperArm = capsule(0.058, 0.22);
    const foreArm = capsule(0.05, 0.2);
    for (const [s, n] of [[-1, 'L'], [1, 'R']]) {
      const sh = this.joint('shoulder' + n, chest, s * 0.25, 0.1, 0.01);
      this.mesh(upperArm, M.fur, sh);
      const el = this.joint('elbow' + n, sh, 0, -0.3, 0);
      this.mesh(foreArm, M.fur, el);
      const hand = this.joint('hand' + n, el, 0, -0.28, 0);
      this.mesh(SPHERE, M.face, hand, 0, -0.02, -0.01, 0.055, 0.065, 0.04);
      const thumb = this.mesh(new THREE.CapsuleGeometry(0.016, 0.04, 3, 6), M.face, hand, -s * 0.04, -0.015, -0.03);
      thumb.rotation.z = s * 0.8;
      for (let f = 0; f < 3; f++) {
        const fing = this.mesh(new THREE.CapsuleGeometry(0.014, 0.05, 3, 6), M.face, hand, (f - 1) * 0.024, -0.075, -0.01);
        fing.rotation.x = 0.3;
      }
    }

    // --- legs ----------------------------------------------------------
    const thighGeo = capsule(0.075, 0.18);
    const shinGeo = capsule(0.06, 0.18);
    for (const [s, n] of [[-1, 'L'], [1, 'R']]) {
      const hip = this.joint('hip' + n, hips, s * 0.13, 0.02, 0);
      this.mesh(thighGeo, M.fur, hip);
      const knee = this.joint('knee' + n, hip, 0, -0.27, 0);
      this.mesh(shinGeo, M.fur, knee);
      const ankle = this.joint('ankle' + n, knee, 0, -0.26, 0);
      this.mesh(SPHERE, M.face, ankle, 0, -0.035, -0.06, 0.065, 0.04, 0.13);
      for (let f = 0; f < 3; f++) {
        this.mesh(SPHERE_LO, M.face, ankle, (f - 1) * 0.035, -0.04, -0.185, 0.022, 0.022, 0.03);
      }
    }

    // --- tail (holds the Sun Banana) -------------------------------------
    this.tail = [];
    let parent = this.joint('tailBase', hips, 0, 0.04, 0.2);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, 0, i === 0 ? 0 : 0.085);
      parent.add(seg);
      const r = lerp(0.045, 0.022, i / n);
      this.mesh(SPHERE_LO, M.fur, seg, 0, 0, 0.04, r, r, 0.06);
      this.tail.push(seg);
      parent = seg;
    }
    // The golden idol clutched at the tip of the tail
    this.idol = new THREE.Group();
    const idolMesh = new THREE.Mesh(bananaGeometry(), this.mats.gold);
    idolMesh.scale.setScalar(0.42);
    idolMesh.rotation.set(0, 0, 0.4);
    this.idol.add(idolMesh);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.dot, color: 0xffc040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
    glow.scale.setScalar(0.7);
    this.idolGlow = glow;
    this.idol.add(glow);
    this.idol.position.set(0, 0.05, 0.08);
    parent.add(this.idol);

    // --- dizzy stars (crash) ---------------------------------------------
    this.stars = new THREE.Group();
    const starMat = new THREE.SpriteMaterial({ map: this.tex.sparkle, color: 0xffee66, transparent: true, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(starMat);
      s.scale.setScalar(0.18);
      this.stars.add(s);
    }
    this.stars.position.set(0, 0.42, 0);
    this.stars.visible = false;
    head.add(this.stars);

    // --- shield bubble ----------------------------------------------------
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 32, 20),
      new THREE.MeshStandardMaterial({ color: 0x66ccff, transparent: true, opacity: 0.22, emissive: 0x2288ff, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide })
    );
    this.shield.position.y = 0.8;
    this.shield.visible = false;
    this.shield.castShadow = false;
    this.group.add(this.shield);

    this.acc = new THREE.Group();
    head.add(this.acc);
    this.bodyAcc = new THREE.Group();
    chest.add(this.bodyAcc);
  }

  setSkin(skin) {
    this.skin = skin;
    const M = this.mats;
    M.fur.color.setHex(skin.fur);
    M.belly.color.setHex(skin.belly);
    M.face.color.setHex(skin.face);
    M.ear.color.setHex(skin.ear);
    M.iris.color.setHex(skin.eye);
    const bulk = skin.bulk || 1;
    this.body.scale.set(bulk, bulk, bulk);
    for (const p of this.mandrillParts) p.visible = skin.acc.includes('mandrill');
    // remove old accessories
    for (const g of [this.acc, this.bodyAcc]) {
      while (g.children.length) {
        const c = g.children.pop();
        c.traverse((o) => o.geometry && o.geometry.dispose());
      }
    }
    const A = this.acc, B = this.bodyAcc;
    const add = (geo, color, parent, x, y, z, rx = 0, ry = 0, rz = 0, opts = {}) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0, emissive: opts.emissive ?? 0x000000, side: opts.side ?? THREE.FrontSide }));
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    if (skin.acc.includes('fedora')) {
      add(new THREE.CylinderGeometry(0.34, 0.36, 0.025, 28), 0x6b4a2a, A, 0, 0.19, 0.01, -0.12);
      add(new THREE.CylinderGeometry(0.19, 0.22, 0.17, 24), 0x6b4a2a, A, 0, 0.28, 0.01, -0.12);
      add(new THREE.CylinderGeometry(0.225, 0.225, 0.045, 24), 0x2a1a10, A, 0, 0.225, 0.01, -0.12);
    }
    if (skin.acc.includes('satchel')) {
      add(new THREE.BoxGeometry(0.2, 0.16, 0.08), 0x7a5230, B, 0.2, -0.32, 0.12);
      const strap = add(new THREE.TorusGeometry(0.31, 0.015, 6, 30), 0x5a3a20, B, 0, -0.05, 0, 0, 0, 0.6);
      strap.scale.set(1, 1.15, 0.85);
    }
    if (skin.acc.includes('headband')) {
      add(new THREE.TorusGeometry(0.262, 0.03, 8, 32), 0xd81e1e, A, 0, 0.1, 0, Math.PI / 2 - 0.12);
      const tail1 = add(new THREE.BoxGeometry(0.04, 0.22, 0.02), 0xd81e1e, A, 0.04, 0.02, 0.29, 0.6, 0, 0.3);
      const tail2 = add(new THREE.BoxGeometry(0.04, 0.2, 0.02), 0xd81e1e, A, -0.04, 0.03, 0.29, 0.5, 0, -0.25);
      this.headbandTails = [tail1, tail2];
    } else {
      this.headbandTails = null;
    }
    if (skin.acc.includes('scarf')) {
      add(new THREE.TorusGeometry(0.17, 0.05, 8, 24), 0xc8202a, B, 0, 0.17, -0.01, Math.PI / 2);
      const end = add(new THREE.BoxGeometry(0.09, 0.3, 0.025), 0xc8202a, B, 0.08, 0.04, 0.2, 0.7, 0, 0.1);
      this.scarfEnd = end;
    } else {
      this.scarfEnd = null;
    }
    if (skin.acc.includes('mane')) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const m = add(new THREE.ConeGeometry(0.07, 0.22, 6), skin.fur, A, Math.cos(a) * 0.24, 0.02 + Math.sin(a) * 0.22, 0.06);
        m.lookAt(Math.cos(a) * 2, Math.sin(a) * 2 + 0.02, 0.4);
        m.rotateX(Math.PI / 2);
        m.material.map = this.tex.fur;
      }
    }
    if (skin.acc.includes('crown')) {
      const crownMat = { metal: 0.9, rough: 0.25, emissive: 0x553300 };
      add(new THREE.CylinderGeometry(0.15, 0.14, 0.08, 16, 1, true), 0xffc534, A, 0, 0.28, 0.02, 0, 0, 0, { ...crownMat, side: THREE.DoubleSide });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.03, 0.08, 4), 0xffc534, A, Math.cos(a) * 0.14, 0.355, 0.02 + Math.sin(a) * 0.14, 0, 0, 0, crownMat);
      }
      add(new THREE.OctahedronGeometry(0.03), 0xe0204a, A, 0, 0.29, -0.13, 0, 0, 0, { metal: 0.3, rough: 0.1, emissive: 0x440010 });
    }
    if (skin.acc.includes('cape')) {
      const capeGeo = new THREE.PlaneGeometry(0.5, 0.65, 4, 6);
      capeGeo.translate(0, -0.32, 0);
      const cape = add(capeGeo, 0x8a1020, B, 0, 0.14, 0.24, 0.2, 0, 0, { side: THREE.DoubleSide });
      this.cape = cape;
    } else {
      this.cape = null;
    }
    this.group.traverse((o) => {
      if (o.isMesh && o !== this.shield) o.castShadow = true;
    });
  }

  // -------------------------------------------------------------------------
  // Procedural animation. `s` is the state from the game:
  //   { mode, speed, air (0..1), vy, lean, stumble (0..1), spin, time }
  // modes: idle | run | jump | slide | crash | fall | caught | lookback | cheer
  // -------------------------------------------------------------------------
  update(dt, s) {
    this.time += dt;
    const t = this.time;
    const J = this.j;
    const P = {}; // target pose: joint -> [x,y,z]
    const set = (n, x = 0, y = 0, z = 0) => (P[n] = [x, y, z]);
    let bodyY = 0, bodyRX = 0, bodyRZ = 0, bodyRY = 0;
    let mouth = 'smile';
    let rate = 18;
    let browRaise = 0;
    const mode = s.mode;
    this.stars.visible = false;

    // default neutral pose
    for (const n of ['hips', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']) set(n);

    if (mode === 'run' || mode === 'lookback') {
      this.phase += dt * (s.speed || 14) * 0.6;
      const p = this.phase;
      const sp = Math.sin(p), cp = Math.cos(p);
      const stride = 0.95;
      set('hipR', sp * stride, 0, 0.04);
      set('hipL', -sp * stride, 0, -0.04);
      set('kneeR', -(0.25 + 1.35 * Math.max(0, cp)), 0, 0);
      set('kneeL', -(0.25 + 1.35 * Math.max(0, -cp)), 0, 0);
      set('ankleR', 0.25 + Math.max(0, -cp) * 0.5, 0, 0);
      set('ankleL', 0.25 + Math.max(0, cp) * 0.5, 0, 0);
      set('shoulderR', -sp * 1.15 + 0.15, 0, 0.18);
      set('shoulderL', sp * 1.15 + 0.15, 0, -0.18);
      set('elbowR', 0.9 + Math.max(0, -sp) * 0.6, 0, 0);
      set('elbowL', 0.9 + Math.max(0, sp) * 0.6, 0, 0);
      set('hips', -0.08, sp * 0.12, 0);
      set('chest', -0.3, -sp * 0.22, 0);
      set('neck', 0.15, sp * 0.1, 0);
      set('head', 0.12 + Math.abs(sp) * 0.06, 0, 0);
      bodyY = Math.abs(sp) * 0.075 - 0.02;
      bodyRZ = -(s.lean || 0) * 0.35;
      rate = 30;
      // footstep events
      const sign = Math.sign(sp);
      if (sign !== this.lastStepSign) {
        this.lastStepSign = sign;
        if (this.stepCallback) this.stepCallback(sign);
      }
      if (mode === 'lookback') {
        set('neck', 0.1, 1.0, 0);
        set('head', 0.1, 0.9, 0);
        browRaise = 1;
        mouth = 'open';
      }
    } else if (mode === 'jump') {
      const a = clamp(s.air || 0, 0, 1);
      const tuck = Math.sin(a * Math.PI);
      set('hipR', 0.6 + tuck * 0.9, 0, 0.1);
      set('hipL', 0.3 + tuck * 1.1, 0, -0.1);
      set('kneeR', -0.6 - tuck * 1.4);
      set('kneeL', -0.9 - tuck * 1.3);
      set('ankleR', 0.4);
      set('ankleL', 0.4);
      set('shoulderR', 2.4 - tuck * 0.4, 0, 0.5);
      set('shoulderL', 2.4 - tuck * 0.4, 0, -0.5);
      set('elbowR', 0.4);
      set('elbowL', 0.4);
      set('chest', -0.15 - tuck * 0.2);
      set('head', -0.1);
      bodyRX = 0;
      mouth = a < 0.6 ? 'open' : 'smile';
      browRaise = 0.6;
      bodyRY = (s.spin || 0) * Math.PI * 2 * a;
      rate = 16;
    } else if (mode === 'slide') {
      bodyY = -0.38;
      set('hips', 1.05, 0, 0);
      set('chest', -0.15);
      set('neck', -0.45);
      set('head', -0.35);
      set('hipR', 0.45, 0, 0.08);
      set('hipL', 0.3, 0, -0.08);
      set('kneeR', -0.25);
      set('kneeL', -0.6);
      set('ankleR', -0.3);
      set('ankleL', -0.2);
      set('shoulderR', -0.6, 0, 0.9);
      set('shoulderL', -0.6, 0, -0.9);
      set('elbowR', 0.5);
      set('elbowL', 0.5);
      mouth = 'grit';
      rate = 20;
    } else if (mode === 'crash' || mode === 'caught') {
      const dir = mode === 'crash' ? 1 : -1;
      bodyRX = dir * 1.45;
      bodyY = 0.2;
      set('shoulderR', 1.8, 0, 1.2);
      set('shoulderL', 1.8, 0, -1.2);
      set('elbowR', 0.3);
      set('elbowL', 0.3);
      set('hipR', 1.3, 0, 0.3);
      set('hipL', 0.9, 0, -0.3);
      set('kneeR', -0.5);
      set('kneeL', -1.0);
      set('head', Math.sin(t * 9) * 0.12, Math.sin(t * 6) * 0.4, 0);
      mouth = 'open';
      browRaise = -0.5;
      rate = 9;
      this.stars.visible = mode === 'crash';
    } else if (mode === 'fall') {
      set('shoulderR', 2.8 + Math.sin(t * 22) * 0.5, 0, 0.6);
      set('shoulderL', 2.8 + Math.cos(t * 22) * 0.5, 0, -0.6);
      set('elbowR', 0.3);
      set('elbowL', 0.3);
      set('hipR', Math.sin(t * 18) * 0.9, 0, 0.2);
      set('hipL', -Math.sin(t * 18) * 0.9, 0, -0.2);
      set('kneeR', -0.8);
      set('kneeL', -0.8);
      set('head', -0.5);
      mouth = 'open';
      browRaise = 1;
      rate = 20;
    } else if (mode === 'cheer') {
      const b = Math.abs(Math.sin(t * 5));
      bodyY = b * 0.18;
      set('shoulderR', 2.7 + Math.sin(t * 10) * 0.2, 0, 0.4);
      set('shoulderL', 2.7 - Math.sin(t * 10) * 0.2, 0, -0.4);
      set('elbowR', 0.3);
      set('elbowL', 0.3);
      set('hipR', 0.3 * b);
      set('hipL', 0.3 * b);
      set('kneeR', -0.5 * b);
      set('kneeL', -0.5 * b);
      mouth = 'open';
      browRaise = 1;
    } else {
      // idle: crouched, breathing, looking around
      const br = Math.sin(t * 2.2);
      bodyY = -0.06 + br * 0.008;
      set('hips', 0.05);
      set('chest', -0.12 + br * 0.03);
      set('neck', 0.05, Math.sin(t * 0.6) * 0.5, 0);
      set('head', 0.1 + Math.sin(t * 0.9) * 0.05, Math.sin(t * 0.6 + 0.4) * 0.3, Math.sin(t * 0.7) * 0.08);
      set('hipR', 0.35, 0, 0.12);
      set('hipL', 0.35, 0, -0.12);
      set('kneeR', -0.55);
      set('kneeL', -0.55);
      set('ankleR', 0.2);
      set('ankleL', 0.2);
      // one hand scratches its head every few seconds
      const scratch = (t % 7) > 5.2;
      if (scratch) {
        set('shoulderR', 2.6, 0.2, 0.9);
        set('elbowR', 2.0 + Math.sin(t * 25) * 0.15);
        browRaise = 0.5;
      } else {
        set('shoulderR', 0.25, 0, 0.12);
        set('elbowR', 0.5);
      }
      set('shoulderL', 0.25, 0, -0.12);
      set('elbowL', 0.5);
      rate = 6;
    }

    // stumble overlay: flailing arms, wobble
    if (s.stumble > 0) {
      const k = s.stumble;
      P.shoulderR[0] += Math.sin(t * 30) * 1.2 * k;
      P.shoulderL[0] += Math.cos(t * 30) * 1.2 * k;
      P.shoulderR[2] += 0.9 * k;
      P.shoulderL[2] -= 0.9 * k;
      P.chest[0] += 0.4 * k;
      bodyRZ += Math.sin(t * 25) * 0.25 * k;
      mouth = 'open';
      browRaise = 1;
    }

    // apply with damping
    for (const n in P) {
      const g = J[n];
      const p = P[n];
      g.rotation.x = damp(g.rotation.x, p[0], rate, dt);
      g.rotation.y = damp(g.rotation.y, p[1], rate, dt);
      g.rotation.z = damp(g.rotation.z, p[2], rate, dt);
    }
    const bodyRate = mode === 'crash' || mode === 'caught' ? 8 : 16;
    this.body.position.y = damp(this.body.position.y, bodyY, bodyRate, dt);
    this.body.rotation.x = damp(this.body.rotation.x, bodyRX, bodyRate, dt);
    this.body.rotation.z = damp(this.body.rotation.z, bodyRZ, 10, dt);
    if (mode === 'jump') this.body.rotation.y = bodyRY;
    else this.body.rotation.y = damp(this.body.rotation.y, 0, 12, dt);

    // tail: wave, curling at the tip around the idol
    const tailSpeed = mode === 'run' ? 9 : 3;
    const amp = mode === 'run' ? 0.12 : mode === 'fall' ? 0.4 : 0.08;
    for (let i = 0; i < this.tail.length; i++) {
      const seg = this.tail[i];
      const k = i / this.tail.length;
      let rx = i === 0 ? (mode === 'slide' ? -0.9 : -0.5) : 0.08 + k * 0.12;
      if (i > 8) rx = 0.55;
      rx += Math.sin(t * tailSpeed - i * 0.55) * amp;
      seg.rotation.x = rx;
      seg.rotation.y = Math.sin(t * tailSpeed * 0.6 - i * 0.45) * amp * 1.3;
    }
    this.idol.rotation.y += dt * 1.5;
    this.idolGlow.material.opacity = 0.55 + Math.sin(t * 4) * 0.2;

    // mouth & face
    this.smile.visible = mouth === 'smile';
    this.mouthOpen.visible = mouth === 'open' || mouth === 'grit';
    if (mouth === 'grit') this.mouthOpen.scale.set(0.06, 0.02, 0.03);
    else this.mouthOpen.scale.set(0.05, 0.045 + Math.sin(t * 12) * 0.006, 0.03);
    for (let i = 0; i < 2; i++) {
      const b = this.brows[i];
      const sgn = i === 0 ? -1 : 1;
      b.position.y = damp(b.position.y, 0.13 + browRaise * 0.025, 12, dt);
      b.rotation.z = Math.PI / 2 + sgn * (0.15 - browRaise * 0.25);
    }
    // ears twitch
    for (let i = 0; i < 2; i++) this.ears[i].rotation.z = Math.sin(t * 3 + i * 2) * 0.05 + (mode === 'run' ? (i ? -0.2 : 0.2) : 0);

    // blinking
    this.blinkT -= dt;
    let lid = 0.001;
    if (this.blinkT < 0) {
      lid = 1;
      if (this.blinkT < -0.12) this.blinkT = 1.5 + Math.random() * 4;
    }
    if (mode === 'crash' || mode === 'caught') lid = 0.5 + Math.sin(t * 3) * 0.1;
    for (const e of this.eyes) {
      const l = e.userData.lid;
      l.scale.y = damp(l.scale.y, lid > 0.5 ? 0.07 : 0.001, 40, dt);
      l.position.y = lid > 0.5 ? 0.0 : 0.06;
      // eyes dart left and right when idle
      e.userData.iris.position.x = mode === 'idle' ? Math.sin(t * 0.6 + 0.4) * 0.008 : 0;
    }

    // dizzy stars orbit
    if (this.stars.visible) {
      this.stars.children.forEach((st, i) => {
        const a = t * 4 + (i / 5) * Math.PI * 2;
        st.position.set(Math.cos(a) * 0.3, Math.sin(t * 6 + i) * 0.04, Math.sin(a) * 0.3);
      });
    }

    // cloth bits flutter
    if (this.headbandTails) {
      this.headbandTails[0].rotation.x = 0.9 + Math.sin(t * 20) * 0.25;
      this.headbandTails[1].rotation.x = 0.8 + Math.cos(t * 18) * 0.25;
    }
    if (this.scarfEnd) this.scarfEnd.rotation.x = (mode === 'run' ? 1.2 : 0.4) + Math.sin(t * 16) * 0.15;
    if (this.cape) this.cape.rotation.x = (mode === 'run' ? 0.9 : 0.15) + Math.sin(t * 12) * 0.1;

    // shield bubble shimmer
    if (this.shield.visible) {
      this.shield.material.opacity = 0.16 + Math.sin(t * 8) * 0.06;
      this.shield.rotation.y += dt;
      this.shield.scale.setScalar(1 + Math.sin(t * 5) * 0.03);
    }
  }
}
