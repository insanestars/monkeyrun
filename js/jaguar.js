import * as THREE from 'three';
import { damp, lerp } from './utils.js';

// ---------------------------------------------------------------------------
// The temple guardian: a gold-collared jaguar with glowing eyes that chases
// the monkey whenever it stumbles.
// ---------------------------------------------------------------------------
const SPHERE = new THREE.SphereGeometry(1, 24, 16);

export class Jaguar {
  constructor(textures) {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    const coat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.jaguar, roughness: 0.85 });
    const belly = new THREE.MeshStandardMaterial({ color: 0xf0dcb0, map: textures.fur, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15100a, roughness: 0.5 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc534, metalness: 0.9, roughness: 0.25, emissive: 0x442200 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc8ff3a });
    const teeth = new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 0.3 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x5a1010, roughness: 0.6 });
    this.eyeMat = eyeMat;
    const add = (geo, m, parent, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const S = 1.15; // overall scale
    this.body.scale.setScalar(S);

    // spine: rear and front halves flex independently
    this.rear = new THREE.Group();
    this.rear.position.set(0, 0.72, 0.35);
    this.body.add(this.rear);
    add(SPHERE, coat, this.rear, 0, 0, 0.05, 0.36, 0.34, 0.55);
    this.front = new THREE.Group();
    this.front.position.set(0, 0.76, -0.25);
    this.body.add(this.front);
    add(SPHERE, coat, this.front, 0, 0.02, -0.08, 0.38, 0.38, 0.55);
    add(SPHERE, belly, this.front, 0, -0.16, -0.22, 0.26, 0.24, 0.38);

    // golden collar with a jade gem
    add(new THREE.TorusGeometry(0.3, 0.05, 8, 24), gold, this.front, 0, 0.06, -0.45, 1, 1, 1, 0.3);
    add(new THREE.OctahedronGeometry(0.07), new THREE.MeshStandardMaterial({ color: 0x20c080, emissive: 0x0a5030, metalness: 0.4, roughness: 0.15 }), this.front, 0, -0.2, -0.56, 1, 1.3, 1);

    // head
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.12, -0.55);
    this.front.add(this.neck);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.12, -0.2);
    this.neck.add(this.head);
    add(SPHERE, coat, this.head, 0, 0, 0, 0.27, 0.24, 0.28);
    add(SPHERE, belly, this.head, 0, -0.07, -0.2, 0.15, 0.11, 0.14);
    add(SPHERE, dark, this.head, 0, -0.01, -0.33, 0.05, 0.035, 0.03);
    for (const s of [-1, 1]) {
      add(SPHERE, coat, this.head, s * 0.17, 0.2, 0.02, 0.07, 0.08, 0.04);
      add(SPHERE, dark, this.head, s * 0.17, 0.2, 0.0, 0.045, 0.055, 0.03);
      add(SPHERE, eyeMat, this.head, s * 0.1, 0.06, -0.22, 0.045, 0.03, 0.03);
      add(SPHERE, dark, this.head, s * 0.1, 0.06, -0.245, 0.012, 0.025, 0.012);
      // brow plate (stone guardian mask)
      add(new THREE.BoxGeometry(0.12, 0.03, 0.06), gold, this.head, s * 0.09, 0.115, -0.21, 1, 1, 1, 0, 0, s * -0.3);
    }
    // jaw
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.1, -0.08);
    this.head.add(this.jaw);
    add(SPHERE, belly, this.jaw, 0, -0.03, -0.14, 0.12, 0.05, 0.12);
    add(SPHERE, mouthMat, this.jaw, 0, 0.0, -0.13, 0.1, 0.03, 0.1);
    for (const s of [-1, 1]) {
      add(new THREE.ConeGeometry(0.018, 0.07, 6), teeth, this.head, s * 0.06, -0.13, -0.28, 1, 1, 1, Math.PI);
      add(new THREE.ConeGeometry(0.016, 0.06, 6), teeth, this.jaw, s * 0.055, 0.03, -0.22, 1, 1, 1, 0);
    }

    // legs: [name, parent, x, y, z]
    this.legs = {};
    const legDefs = [
      ['FL', this.front, -0.2, -0.1, -0.25],
      ['FR', this.front, 0.2, -0.1, -0.25],
      ['BL', this.rear, -0.2, -0.05, 0.2],
      ['BR', this.rear, 0.2, -0.05, 0.2],
    ];
    const upper = new THREE.CapsuleGeometry(0.1, 0.28, 4, 10);
    upper.translate(0, -0.18, 0);
    const lower = new THREE.CapsuleGeometry(0.07, 0.26, 4, 10);
    lower.translate(0, -0.15, 0);
    for (const [n, parent, x, y, z] of legDefs) {
      const top = new THREE.Group();
      top.position.set(x, y, z);
      parent.add(top);
      add(upper, coat, top, 0, 0, 0, 1, 1, 1);
      const mid = new THREE.Group();
      mid.position.set(0, -0.36, 0);
      top.add(mid);
      add(lower, coat, mid, 0, 0, 0, 1, 1, 1);
      add(SPHERE, belly, mid, 0, -0.33, -0.04, 0.09, 0.05, 0.12);
      this.legs[n] = { top, mid };
    }
    // tail
    this.tail = [];
    let p = new THREE.Group();
    p.position.set(0, 0.12, 0.55);
    this.rear.add(p);
    for (let i = 0; i < 10; i++) {
      const seg = new THREE.Group();
      seg.position.z = i === 0 ? 0 : 0.11;
      p.add(seg);
      const r = lerp(0.06, 0.035, i / 10);
      add(SPHERE, i > 7 ? dark : coat, seg, 0, 0, 0.05, r, r, 0.08);
      this.tail.push(seg);
      p = seg;
    }
    // ghostly eye glow sprites
    this.glows = [];
    for (const s of [-1, 1]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.dot, color: 0xb8ff40, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 }));
      sp.position.set(s * 0.1, 0.06, -0.26);
      sp.scale.setScalar(0.22);
      this.head.add(sp);
      this.glows.push(sp);
    }
    this.phase = 0;
    this.time = 0;
    this.roarT = 0;
    this.pounce = 0;
  }

  roar() {
    this.roarT = 1.2;
  }

  update(dt, mode, speed) {
    this.time += dt;
    const t = this.time;
    this.roarT = Math.max(0, this.roarT - dt);
    const L = this.legs;
    if (mode === 'run' || mode === 'pounce') {
      this.phase += dt * Math.max(6, speed * 0.55);
      const p = this.phase;
      // rotary gallop
      const legPhase = { FL: 0, FR: 0.35, BL: Math.PI, BR: Math.PI + 0.35 };
      for (const n in L) {
        const ph = p + legPhase[n];
        const front = n[0] === 'F';
        L[n].top.rotation.x = Math.sin(ph) * (front ? 0.9 : 0.85);
        L[n].mid.rotation.x = front ? -Math.max(0, Math.cos(ph)) * 1.2 : Math.max(0, -Math.cos(ph)) * 1.1;
      }
      // spine flex and bound
      this.front.rotation.x = Math.sin(p) * 0.12;
      this.rear.rotation.x = -Math.sin(p) * 0.12;
      this.body.position.y = Math.abs(Math.sin(p)) * 0.12;
      this.neck.rotation.x = -Math.sin(p) * 0.1 + 0.05;
      this.head.rotation.x = Math.sin(p) * 0.08;
    } else {
      // prowling idle
      for (const n in L) {
        L[n].top.rotation.x = damp(L[n].top.rotation.x, 0, 8, dt);
        L[n].mid.rotation.x = damp(L[n].mid.rotation.x, 0, 8, dt);
      }
      this.body.position.y = Math.sin(t * 2) * 0.01;
      this.head.rotation.y = Math.sin(t * 0.7) * 0.3;
    }
    if (mode === 'pounce') {
      this.pounce = Math.min(1, this.pounce + dt * 3);
      this.body.rotation.x = -0.5 * Math.sin(this.pounce * Math.PI);
      for (const n of ['FL', 'FR']) L[n].top.rotation.x = 1.6;
    } else {
      this.pounce = 0;
      this.body.rotation.x = damp(this.body.rotation.x, 0, 8, dt);
    }
    const jawOpen = this.roarT > 0 ? 0.6 * Math.min(1, this.roarT * 3) : mode === 'run' ? 0.15 + Math.sin(t * 9) * 0.08 : 0.05;
    this.jaw.rotation.x = damp(this.jaw.rotation.x, jawOpen, 20, dt);
    if (this.roarT > 0) this.head.rotation.z = Math.sin(t * 40) * 0.05;
    for (let i = 0; i < this.tail.length; i++) {
      this.tail[i].rotation.x = (i === 0 ? 0.5 : i > 6 ? -0.22 : -0.05) + Math.sin(t * 6 - i * 0.6) * 0.1;
      this.tail[i].rotation.y = Math.sin(t * 4 - i * 0.5) * 0.15;
    }
    const g = 0.6 + Math.sin(t * 7) * 0.2;
    for (const s of this.glows) s.material.opacity = g;
  }
}
