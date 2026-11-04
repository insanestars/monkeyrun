import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GPU point-sprite particle systems (dust, sparkles, embers, leaves, debris)
// ---------------------------------------------------------------------------
class PointSystem {
  constructor(scene, texture, capacity, blending, rotate = false) {
    this.cap = capacity;
    this.n = 0;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    // simulation
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uScale: { value: 600 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aRot;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha; varying float vRot;
        void main(){
          vColor = aColor; vAlpha = aAlpha; vRot = aRot;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec3 vColor; varying float vAlpha; varying float vRot;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          ${rotate ? 'float s = sin(vRot), co = cos(vRot); c = vec2(co*c.x - s*c.y, s*c.x + co*c.y);' : ''}
          vec4 t = texture2D(uMap, c + 0.5);
          ${blending === THREE.AdditiveBlending ? 'gl_FragColor = vec4(vColor * t.a * vAlpha, t.a * vAlpha);' : 'if (t.a * vAlpha < 0.05) discard; gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);'}
        }`,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size0, size1, r, g, b, opts = {}) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = 0;
    this.max[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.size[i] = size0;
    this.grav[i] = opts.gravity ?? 0;
    this.drag[i] = opts.drag ?? 0;
    this.spin[i] = opts.spin ?? 0;
    this.rot[i] = opts.rot ?? Math.random() * 6.28;
    this.a0[i] = opts.alpha ?? 1;
    this.alpha[i] = this.a0[i];
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) {
        // swap-remove
        const last = --this.n;
        if (i !== last) this.copy(last, i);
        continue;
      }
      const t = this.life[i] / this.max[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alpha[i] = this.a0[i] * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.n);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aRot']) g.attributes[k].needsUpdate = true;
  }

  copy(from, to) {
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
      this.col[to * 3 + k] = this.col[from * 3 + k];
    }
    this.life[to] = this.life[from];
    this.max[to] = this.max[from];
    this.size[to] = this.size[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
    this.spin[to] = this.spin[from];
    this.rot[to] = this.rot[from];
    this.a0[to] = this.a0[from];
    this.alpha[to] = this.alpha[from];
  }

  clear() {
    this.n = 0;
  }
}

export class Particles {
  constructor(scene, textures, density = 1) {
    this.density = density;
    this.add = new PointSystem(scene, textures.dot, 2500, THREE.AdditiveBlending);
    this.sparks = new PointSystem(scene, textures.sparkle, 800, THREE.AdditiveBlending, true);
    this.soft = new PointSystem(scene, textures.dot, 1500, THREE.NormalBlending);
    this.leaves = new PointSystem(scene, textures.leaf, 500, THREE.NormalBlending, true);
    this.systems = [this.add, this.sparks, this.soft, this.leaves];
    this.leafTimer = 0;
    this.fireflyTimer = 0;
  }

  setScale(s) {
    for (const sys of this.systems) sys.mat.uniforms.uScale.value = s;
  }

  clear() {
    for (const s of this.systems) s.clear();
  }

  dust(p, color = [0.75, 0.68, 0.55], n = 3, power = 1) {
    n = Math.ceil(n * this.density);
    for (let i = 0; i < n; i++) {
      this.soft.emit(p.x + (Math.random() - 0.5) * 0.4, p.y + 0.05, p.z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 1.5 * power, Math.random() * 1.2 * power, (Math.random() - 0.5) * 1.5 * power,
        0.5 + Math.random() * 0.4, 0.25, 0.9 * power, color[0], color[1], color[2], { drag: 2.5, alpha: 0.45, gravity: -0.3 });
    }
  }

  sparkle(p, color = [1, 0.85, 0.3], n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
      const sp = 2 + Math.random() * 3;
      this.sparks.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1.5, Math.sin(a) * Math.cos(e) * sp,
        0.35 + Math.random() * 0.3, 0.35, 0.05, color[0], color[1], color[2], { drag: 4, spin: 6 });
    }
    this.add.emit(p.x, p.y, p.z, 0, 0, 0, 0.25, 0.6, 1.8, color[0] * 0.6, color[1] * 0.6, color[2] * 0.6, {});
  }

  burst(p, color, n = 30, speed = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.sparks.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp,
        0.5 + Math.random() * 0.5, 0.5, 0.05, color[0], color[1], color[2], { drag: 3, spin: 8 });
    }
    this.add.emit(p.x, p.y, p.z, 0, 0, 0, 0.4, 1, 5, color[0] * 0.5, color[1] * 0.5, color[2] * 0.5, {});
  }

  debris(p, n = 18) {
    for (let i = 0; i < n; i++) {
      const g = 0.4 + Math.random() * 0.3;
      this.soft.emit(p.x + (Math.random() - 0.5) * 2, p.y + Math.random() * 1.5, p.z + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 8, Math.random() * 7 + 2, (Math.random() - 0.5) * 8,
        0.9 + Math.random() * 0.5, 0.35, 0.25, g, g * 0.95, g * 0.85, { gravity: 18, drag: 0.5, alpha: 1 });
    }
    this.dust(p, [0.7, 0.66, 0.6], 14, 2.5);
  }

  embers(p, n = 1) {
    for (let i = 0; i < n; i++) {
      this.add.emit(p.x + (Math.random() - 0.5) * 0.6, p.y, p.z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8,
        0.8 + Math.random() * 0.6, 0.18, 0.05, 1, 0.5 + Math.random() * 0.3, 0.1, { drag: 0.5 });
    }
  }

  trail(p, color) {
    this.add.emit(p.x + (Math.random() - 0.5) * 0.5, p.y + Math.random() * 1.2, p.z + (Math.random() - 0.5) * 0.5,
      0, 0.3, 0, 0.45, 0.6, 0.1, color[0], color[1], color[2], {});
  }

  // ambient: falling leaves and fireflies around the camera/player
  ambient(dt, center, forward, fireflies, leafColor) {
    this.leafTimer += dt * this.density;
    while (this.leafTimer > 0.09) {
      this.leafTimer -= 0.09;
      const ahead = 10 + Math.random() * 40;
      const side = (Math.random() - 0.5) * 30;
      const x = center.x + forward.x * ahead + forward.z * side;
      const z = center.z + forward.z * ahead - forward.x * side;
      const c = leafColor;
      const k = 0.7 + Math.random() * 0.5;
      this.leaves.emit(x, center.y + 8 + Math.random() * 6, z, (Math.random() - 0.5) * 1.5, -1.2 - Math.random(), (Math.random() - 0.5) * 1.5,
        5 + Math.random() * 2, 0.35, 0.35, c.r * k, c.g * k, c.b * k, { spin: (Math.random() - 0.5) * 6, alpha: 1 });
    }
    if (fireflies > 0.05) {
      this.fireflyTimer += dt * fireflies * this.density;
      while (this.fireflyTimer > 0.04) {
        this.fireflyTimer -= 0.04;
        const ahead = Math.random() * 45;
        const side = (Math.random() - 0.5) * 24;
        const x = center.x + forward.x * ahead + forward.z * side;
        const z = center.z + forward.z * ahead - forward.x * side;
        this.add.emit(x, center.y + Math.random() * 6 - 1, z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6,
          2.5 + Math.random() * 2, 0.22, 0.22, 0.75, 1.0, 0.35, { alpha: 1 });
      }
    }
  }

  update(dt) {
    for (const s of this.systems) s.update(dt);
  }
}
