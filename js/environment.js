import * as THREE from 'three';
import { BIOMES, BIOME_LENGTH, BIOME_BLEND } from './config.js';
import { RNG, smoothstep } from './utils.js';

// ---------------------------------------------------------------------------
// Sky dome, sun/moon, fog, distant mountains, misty canopy far below and
// biome-driven lighting that cross-fades as you run.
// ---------------------------------------------------------------------------
const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function lerpHex(a, b, t, out) {
  tmpA.setHex(a);
  tmpB.setHex(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

export class Environment {
  constructor(scene, renderer, textures, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.tex = textures;
    this.quality = quality;
    this.cur = {}; // current blended light values

    scene.fog = new THREE.FogExp2(0x9fc0a2, 0.011);
    scene.background = new THREE.Color(0x9fc0a2);

    // --- lights ---------------------------------------------------------
    this.hemi = new THREE.HemisphereLight(0xcfe7ff, 0x3d5a2a, 0.9);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sun.castShadow = quality !== 'low';
    const sz = quality === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sz, sz);
    const sc = this.sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // pool of torch point lights that hop to the nearest torches
    this.torchLights = [];
    const nLights = quality === 'low' ? 2 : 4;
    for (let i = 0; i < nLights; i++) {
      const l = new THREE.PointLight(0xff8a30, 0, 14, 1.6);
      scene.add(l);
      this.torchLights.push(l);
    }
    this.torchList = [];

    // --- sky dome -------------------------------------------------------
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uBottom: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uStars: { value: 0 },
        uTime: { value: 0 },
        uMoon: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
        uniform vec3 uTop, uHorizon, uBottom, uSunColor; uniform vec3 uSunDir;
        uniform float uStars, uTime, uMoon;
        varying vec3 vDir;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
          float a=hash(vec3(i,0.)), b=hash(vec3(i+vec2(1,0),0.)), c=hash(vec3(i+vec2(0,1),0.)), d=hash(vec3(i+vec2(1,1),0.));
          return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
        }
        float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=noise(p)*a; p*=2.03; a*=.5;} return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.65, h), 0.8)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.25, h));
          // sun / moon disc + halo
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          float disc = smoothstep(0.9975 - uMoon*0.001, 0.9988, sd);
          col += uSunColor * (pow(sd, 400.0) * 1.5 + pow(sd, 18.0) * 0.35 * (1.0 - uMoon*0.6) + disc * 2.5);
          // clouds
          if (h > 0.0) {
            vec2 uv = d.xz / (h + 0.18) * 1.6 + vec2(uTime * 0.01, uTime*0.004);
            float c = smoothstep(0.5, 0.85, fbm(uv));
            vec3 cloudCol = mix(uHorizon, vec3(1.0), 0.55) * (0.75 + 0.35*sd);
            col = mix(col, cloudCol, c * smoothstep(0.0, 0.25, h) * 0.75);
          }
          // stars
          if (uStars > 0.01 && h > 0.0) {
            vec3 sp = floor(d * 380.0);
            float st = step(0.9975, hash(sp));
            float tw = 0.6 + 0.4 * sin(uTime * 3.0 + hash(sp+1.0) * 50.0);
            col += vec3(st * tw * uStars * smoothstep(0.05, 0.4, h));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // --- distant mountains (two silhouette rings) --------------------------
    this.mountains = [];
    const rng = new RNG(99);
    for (let layer = 0; layer < 2; layer++) {
      const R = layer === 0 ? 520 : 380;
      const seg = 160;
      const pos = [];
      const idx = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const hgt = 40 + Math.abs(Math.sin(a * 3 + layer) * 60) + Math.abs(Math.sin(a * 7.3 + layer * 2)) * 30 + rng.next() * 18 + (layer === 0 ? 40 : 0);
        pos.push(Math.cos(a) * R, -60, Math.sin(a) * R);
        pos.push(Math.cos(a) * R, hgt - 40, Math.sin(a) * R);
      }
      for (let i = 0; i < seg; i++) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial({ color: 0x6f9a86, fog: false, side: THREE.DoubleSide, transparent: true, opacity: 1, depthWrite: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = -9 + layer;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.mountains.push(mesh);
    }
    // distant step pyramid with a glowing beacon
    const pyr = new THREE.Group();
    const pm = new THREE.MeshBasicMaterial({ color: 0x4a6a5a, fog: false, transparent: true, depthWrite: false });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(80 - i * 12, 10, 80 - i * 12), pm);
      b.position.y = i * 10;
      pyr.add(b);
    }
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.dot, color: 0xffc040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    beacon.scale.setScalar(40);
    beacon.position.y = 62;
    pyr.add(beacon);
    this.beacon = beacon;
    pyr.children.forEach((c) => (c.renderOrder = -8));
    this.pyramid = pyr;
    this.pyramidMat = pm;
    pyr.position.set(-260, -20, -300);
    scene.add(pyr);

    // --- canopy far below + mist layers --------------------------------------
    const cTex = textures.canopy.clone();
    cTex.needsUpdate = true;
    cTex.repeat.set(30, 30);
    this.canopyTex = cTex;
    this.canopy = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ map: cTex, color: 0x4a6a3a }));
    this.canopy.rotation.x = -Math.PI / 2;
    this.canopy.position.y = -34;
    scene.add(this.canopy);

    this.mists = [];
    for (let i = 0; i < 2; i++) {
      const t = textures.mist.clone();
      t.needsUpdate = true;
      t.repeat.set(8 + i * 4, 8 + i * 4);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55 - i * 0.15, depthWrite: false, color: 0xffffff }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = -12 - i * 9;
      m.renderOrder = 1;
      scene.add(m);
      this.mists.push(m);
    }

    this.blend = { index: 0, next: 1, t: 0 };
    this.applyBiome(0, 1, 0);
  }

  applyBiome(a, b, t) {
    const A = BIOMES[a].light, B = BIOMES[b].light;
    const c = this.cur;
    const col = (k) => lerpHex(A[k], B[k], t, c[k] || (c[k] = new THREE.Color()));
    const num = (k) => (c[k] = A[k] + (B[k] - A[k]) * t);
    ['skyTop', 'skyHorizon', 'skyBottom', 'fog', 'sun', 'hemiSky', 'hemiGround', 'canopy', 'mist', 'mountains'].forEach(col);
    ['fogDensity', 'sunIntensity', 'sunElev', 'sunAzim', 'hemiIntensity', 'ambient', 'torch', 'fireflies', 'stars', 'exposure'].forEach(num);
    this.skyMat.uniforms.uTop.value.copy(c.skyTop);
    this.skyMat.uniforms.uHorizon.value.copy(c.skyHorizon);
    this.skyMat.uniforms.uBottom.value.copy(c.skyBottom);
    this.skyMat.uniforms.uSunColor.value.copy(c.sun);
    this.skyMat.uniforms.uStars.value = c.stars;
    this.skyMat.uniforms.uMoon.value = c.stars;
    this.scene.fog.color.copy(c.fog);
    this.scene.fog.density = c.fogDensity;
    this.scene.background.copy(c.fog);
    this.sun.color.copy(c.sun);
    this.sun.intensity = c.sunIntensity;
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemiIntensity;
    this.ambient.intensity = c.ambient;
    this.canopy.material.color.copy(c.canopy);
    for (const m of this.mists) m.material.color.copy(c.mist);
    // mountains fade toward the horizon colour
    this.mountains[0].material.color.copy(c.mountains).lerp(c.skyHorizon, 0.55);
    this.mountains[1].material.color.copy(c.mountains).lerp(c.fog, 0.25);
    this.pyramidMat.color.copy(c.mountains).lerp(c.skyHorizon, 0.4);
    this.renderer.toneMappingExposure = c.exposure;
    const el = c.sunElev, az = c.sunAzim;
    this.sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    this.skyMat.uniforms.uSunDir.value.copy(this.sunDir);
  }

  // distance-driven biome blend
  biomeState(distance) {
    const L = BIOME_LENGTH;
    const idx = Math.floor(distance / L);
    const into = distance - idx * L;
    const a = idx % BIOMES.length;
    const b = (idx + 1) % BIOMES.length;
    const t = smoothstep(L - BIOME_BLEND, L, into);
    return { a, b, t, index: t > 0.5 ? b : a };
  }

  update(dt, time, camera, focus, distance, track) {
    const bs = this.biomeState(distance);
    if (bs.a !== this.blend.index || bs.b !== this.blend.next || Math.abs(bs.t - this.blend.t) > 0.001) {
      this.blend = { index: bs.a, next: bs.b, t: bs.t };
      this.applyBiome(bs.a, bs.b, bs.t);
    }
    this.skyMat.uniforms.uTime.value = time;
    this.sky.position.copy(camera.position);
    for (const m of this.mountains) m.position.set(camera.position.x, 0, camera.position.z);
    this.pyramid.position.set(camera.position.x - 260, -20, camera.position.z - 300);
    this.beacon.material.opacity = 0.6 + Math.sin(time * 2) * 0.25;

    // sun follows the player so the shadow map stays sharp around them
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 70);
    this.sun.target.position.copy(focus);
    // snap shadow camera to texels to prevent shimmering
    this.sun.target.updateMatrixWorld();

    // canopy & mist follow the camera with world-locked texture scroll
    const cx = camera.position.x, cz = camera.position.z;
    this.canopy.position.set(cx, -34, cz);
    this.canopyTex.offset.set((cx / 1200) * 30, (-cz / 1200) * 30);
    this.mists.forEach((m, i) => {
      m.position.set(cx, m.position.y, cz);
      const r = m.material.map.repeat.x;
      m.material.map.offset.set((cx / 700) * r + time * 0.004 * (i + 1), (-cz / 700) * r + time * 0.002);
    });

    // torch lights hop to the nearest torches
    track.nearestTorches(focus, this.torchLights.length, this.torchList);
    this.torchLights.forEach((l, i) => {
      const t = this.torchList[i];
      if (t) {
        l.position.copy(t);
        l.intensity = this.cur.torch * 5 * (0.85 + Math.sin(time * 13 + i * 2.1) * 0.1 + Math.sin(time * 27 + i) * 0.05);
      } else l.intensity = 0;
    });
  }

  get firefliesAmount() {
    return this.cur.fireflies || 0;
  }

  leafColor() {
    this._leaf = this._leaf || new THREE.Color();
    return this._leaf.setHex(BIOMES[this.blend.index].leaves[1]);
  }
}
