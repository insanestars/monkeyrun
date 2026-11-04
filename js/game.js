import * as THREE from 'three';
import { DIRS, dirYaw, clamp, lerp, damp, dampAngle, angleDiff, easeInOutCubic, smoothstep } from './utils.js';
import { LANE, HALF, speedAt, jumpDistance, slideDistance, BIOMES, POWERUPS } from './config.js';
import { createTextures } from './textures.js';
import { Monkey, SKINS } from './monkey.js';
import { Jaguar } from './jaguar.js';
import { Track } from './world.js';
import { Environment } from './environment.js';
import { Particles } from './particles.js';
import { AudioEngine } from './audio.js';
import { Save, Missions } from './save.js';
import { Input } from './input.js';
import { UI } from './ui.js';

const LANES_X = [-LANE, 0, LANE];
const JUMP_H = 2.2;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const DEATH_TEXT = {
  trip: ['TRIPPED!', 'Face-first into the jungle floor.'],
  smack: ['SMACK!', 'Stone is harder than monkey skull.'],
  spikes: ['OUCH!', 'Those spikes were not decorative.'],
  burn: ['TOASTED!', 'Roasted banana, anyone?'],
  fall: ['AAAAAH!', 'The chasm swallowed you whole.'],
  wall: ['DEAD END!', 'You forgot to turn.'],
  caught: ['CAUGHT!', 'The Guardian takes back the Sun Banana.'],
};

export class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.params = new URLSearchParams(location.search);
    this.autopilot = this.params.has('autopilot');
    this.state = 'loading';
    this.time = 0;
    window.__game = this;
  }

  async init(progress) {
    const step = async (pct, text) => {
      progress(pct, text);
      await new Promise((r) => setTimeout(r, 16));
    };
    this.save = Save;
    Save.load();
    this.missions = new Missions(Save);
    const quality = Save.data.settings.quality;
    this.quality = quality;

    await step(5, 'Waking the jungle…');
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = quality !== 'low';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.camera.position.set(4, 2, -6);

    await step(15, 'Carving stone and painting fur…');
    this.tex = createTextures();
    await step(45, 'Raising the temple…');
    this.env = new Environment(this.scene, r, this.tex, quality);
    this.track = new Track(this.scene, this.tex, quality);
    this.particles = new Particles(this.scene, this.tex, quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1);

    await step(60, 'Teaching the monkey to run…');
    this.monkey = new Monkey(this.tex);
    this.scene.add(this.monkey.group);
    const skin = SKINS.find((s) => s.id === Save.data.skin) || SKINS[0];
    this.monkey.setSkin(skin);
    this.monkey.stepCallback = () => this.onFootstep();
    this.jaguar = new Jaguar(this.tex);
    this.scene.add(this.jaguar.group);

    await step(75, 'Growing a few thousand trees…');
    this.track.reset(this.newSeed());
    await step(90, 'Tuning the marimbas…');
    this.audio = new AudioEngine();
    this.audio.musicOn = Save.data.settings.music;
    this.audio.sfxOn = Save.data.settings.sfx;

    this.input = new Input(document.getElementById('ui'));
    this.input.on((a) => this.onAction(a));
    this.ui = new UI(this);

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.pause();
    });
    const unlock = () => {
      this.audio.init();
      this.audio.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);

    this.resize();
    this.resetPlayer();
    // warm up shaders so the first frames don't hitch
    this.renderer.compile(this.scene, this.camera);
    await step(100, 'Ready!');
    this.toTitle();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  newSeed() {
    return (Math.random() * 2 ** 31) | 0;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep a decent horizontal view in portrait
    this.baseFov = w / h < 0.8 ? 74 : 62;
    this.camera.updateProjectionMatrix();
    this.ui && this.ui.resizeFx();
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------
  resetPlayer() {
    const st = this.track.current;
    this.p = {
      st, s: 0, prevS: 0, x: 0, lane: 1, y: 0, vy: 0, g: 30,
      air: false, airT: 0, airDur: 1, sliding: false, slideT: 0,
      speed: speedAt(0), dist: 0, stumbleT: 0, invuln: 0, spin: 0,
      pendingTurn: null, slideQueued: false,
      yaw: dirYaw(st.dir), visOff: new THREE.Vector3(), pos: new THREE.Vector3(),
      cause: null, deathT: 0,
    };
    this.stats = { score: 0, bananas: 0, golden: 0, jumps: 0, slides: 0, turns: 0, powerups: 0, noBanana: 0, noStumble: 0, smashes: 0, revives: 0 };
    this.pu = { magnet: 0, double: 0, boost: 0, shield: 0 };
    this.puMax = { magnet: 1, double: 1, boost: 1, shield: 1 };
    this.chase = { gap: 17, timer: 0, armed: false };
    this.trail = [];
    // pre-fill the trail back into the temple doorway so the jaguar can emerge from it
    for (let s = -20; s <= 0; s += 0.5) this.trail.push({ d: s, pos: this.track.point(st, s, 0, 0), yaw: dirYaw(st.dir) });
    this.camYaw = dirYaw(st.dir);
    this.shake = 0;
    this.bananaChain = 0;
    this.bananaChainT = 0;
    this.hinted = {};
    this.junctionHints = 0;
    this.bestFlashed = false;
    this.lastBiome = 0;
    this.monkey.shield.visible = false;
    this.monkey.group.visible = true;
    this.jaguarMode = 'idle';
  }

  toTitle() {
    if (this.state === 'over') this.finalizeRun();
    this.state = 'title';
    this.track.reset(this.newSeed());
    this.particles.clear();
    this.resetPlayer();
    this.titleT = 0;
    this.audio.setMode('menu');
    this.ui.showTitle();
  }

  startRun() {
    if (this.state === 'over') this.finalizeRun();
    if (this.state !== 'title') {
      this.track.reset(this.newSeed());
      this.particles.clear();
      this.resetPlayer();
    }
    this.missions.startRun();
    this.state = 'intro';
    this.introT = 0;
    this.camBlend = 0;
    this.titleCam = { pos: this.camera.position.clone(), look: this.lookTarget ? this.lookTarget.clone() : new THREE.Vector3(0, 1, 0) };
    this.audio.init();
    this.audio.resume();
    this.audio.setMode('run');
    this.ui.showHud();
    this.mult = this.missions.multiplier;
    this.tutorial = Save.data.tutorialRuns < 2 || this.params.has('tutorial');
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.audio.setMode('silent');
    this.ui.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.hidePause();
    this.countdown(() => this.audio.setMode('run'));
  }

  countdown(done) {
    this.state = 'countdown';
    let n = 3;
    this.ui.countdown(n);
    this.audio.play('countdown');
    const tick = () => {
      n--;
      if (n > 0) {
        this.ui.countdown(n);
        this.audio.play('countdown');
        this.cdTimer = setTimeout(tick, 650);
      } else {
        this.ui.countdown('GO!');
        this.audio.play('countdown', { go: true });
        this.state = 'play';
        done && done();
        this.cdTimer = setTimeout(() => this.ui.countdown(null), 500);
      }
    };
    this.cdTimer = setTimeout(tick, 650);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  onAction(a) {
    if (this.state === 'title') {
      if ((a === 'confirm' || a === 'up') && !this.ui.modalOpen()) this.startRun();
      return;
    }
    if (this.state === 'intro' && (a === 'up' || a === 'confirm' || a === 'tap')) {
      this.introT = Math.max(this.introT, 1.15);
      return;
    }
    if (this.state === 'paused') {
      if (a === 'pause' || a === 'confirm') this.resume();
      return;
    }
    if (this.state === 'over') {
      if (a === 'confirm') this.startRun();
      return;
    }
    if (this.state !== 'play') return;
    if (this.autopilot && a !== 'pause') return;
    this.act(a);
  }

  act(a) {
    if (a === 'pause') return this.pause();
    if (a === 'left' || a === 'right') this.leftRight(a);
    else if (a === 'up') this.jump();
    else if (a === 'down') this.slide();
  }

  leftRight(side) {
    const p = this.p;
    const st = p.st;
    if (st.children[side] && p.s > st.length - 11) {
      p.pendingTurn = side;
      this.tryTurn();
      return;
    }
    const nl = clamp(p.lane + (side === 'left' ? -1 : 1), 0, 2);
    if (nl !== p.lane) {
      p.lane = nl;
      this.audio.play('lane');
    }
  }

  jump() {
    const p = this.p;
    if (p.air) return;
    if (p.sliding) p.sliding = false;
    const jd = jumpDistance(p.speed);
    const T = jd / p.speed;
    p.g = (8 * JUMP_H) / (T * T);
    p.vy = (4 * JUMP_H) / T;
    p.air = true;
    p.airT = 0;
    p.airDur = T;
    p.spin = Math.random() < 0.15 ? (Math.random() < 0.5 ? 1 : -1) : 0;
    this.stats.jumps++;
    this.audio.play('jump');
    this.particles.dust(p.pos, this.dustColor(), 6, 1.2);
  }

  slide() {
    const p = this.p;
    if (p.air) {
      // slam down, then slide on landing
      p.vy = Math.min(p.vy, -28);
      p.slideQueued = true;
      return;
    }
    if (!p.sliding) {
      this.stats.slides++;
      this.audio.play('slide');
    }
    p.sliding = true;
    p.slideT = slideDistance(p.speed) / p.speed;
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  frame() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.fpsAcc = (this.fpsAcc || 0) + dt;
    this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }

    switch (this.state) {
      case 'title': this.updateTitle(dt); break;
      case 'intro': this.updateIntro(dt); break;
      case 'play': this.updatePlay(dt); break;
      case 'dying': this.updateDying(dt); break;
      case 'over': this.updateDying(dt); break;
      case 'countdown':
      case 'paused':
        this.updateCamera(0);
        break;
    }
    if (this.state !== 'paused' && this.state !== 'countdown') {
      this.track.processQueue();
      this.track.update(dt, this.time);
      this.particles.update(dt);
    }
    const focus = this.p.pos;
    this.env.update(dt, this.time, this.camera, focus, this.p.dist, this.track);
    const scale = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.particles.setScale(scale);
    this.track.glowMat.uniforms.uScale.value = scale;
    this.ui.frame(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // ---- title screen: monkey idles in front of the temple -------------------
  updateTitle(dt) {
    this.titleT += dt;
    const p = this.p;
    this.placePlayer(dt);
    this.monkey.update(dt, { mode: this.ui.currentModal === 'shop' ? 'cheer' : 'idle', stumble: 0 });
    this.updateJaguar(dt, 'lurk');
    const st = p.st;
    const a = 0.55 + Math.sin(this.titleT * 0.25) * 0.35;
    const shop = this.ui.currentModal === 'shop';
    const r = shop ? 3.4 : 5.8;
    const local = new THREE.Vector3(Math.sin(a) * r + (shop ? -0.9 : 0), shop ? 1.4 : 1.9, -Math.cos(a) * r);
    const rot = new THREE.Matrix4().makeRotationY(dirYaw(st.dir));
    local.applyMatrix4(rot);
    const target = p.pos.clone().add(new THREE.Vector3(0, shop ? 0.9 : 1.4, 0));
    if (shop) target.add(new THREE.Vector3(1, 0, 0).applyMatrix4(rot).multiplyScalar(-0.9));
    const desired = p.pos.clone().add(local);
    this.camera.position.lerp(desired, 1 - Math.exp(-3 * dt));
    this.lookTarget = this.lookTarget || target.clone();
    this.lookTarget.lerp(target, 1 - Math.exp(-3 * dt));
    this.camera.fov = damp(this.camera.fov, this.baseFov, 4, dt);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.lookTarget);
    this.particles.ambient(dt, p.pos, DIRS[st.dir], this.env.firefliesAmount, this.env.leafColor());
  }

  // ---- intro: the guardian wakes ---------------------------------------------
  updateIntro(dt) {
    this.introT += dt;
    const t = this.introT;
    const p = this.p;
    if (t > 0.15 && !this.roared) {
      this.roared = true;
      this.jaguar.roar();
      this.audio.play('roar');
      this.shake = 0.5;
    }
    // guardian prowls out of the doorway
    this.chase.gap = lerp(20, 9, smoothstep(0.1, 1.2, t));
    this.updateJaguar(dt, t > 0.3 ? 'run' : 'idle', 6);
    if (t > 0.85) {
      const sp = p.speed * smoothstep(0.85, 1.3, t);
      p.s += sp * dt;
      p.dist += sp * dt;
    }
    this.placePlayer(dt);
    this.monkey.update(dt, { mode: t < 0.9 ? 'lookback' : 'run', speed: 0, stumble: 0 });
    // camera swings from the front of the monkey to behind it
    const k = easeInOutCubic(clamp(t / 1.3, 0, 1));
    const st = p.st;
    const a = lerp(2.5, 0, k);
    const r = lerp(6.0, 7.0, k);
    const h = lerp(1.9, 3.7, k);
    const rot = new THREE.Matrix4().makeRotationY(dirYaw(st.dir));
    const local = new THREE.Vector3(Math.sin(a) * r, h, Math.cos(a) * r).applyMatrix4(rot);
    this.camera.position.copy(p.pos).add(local);
    const look = p.pos.clone().add(new THREE.Vector3(0, lerp(1.4, 1.3, k), 0)).addScaledVector(DIRS[st.dir], lerp(0, 6, k));
    this.camera.lookAt(look);
    this.applyShake(dt);
    if (t >= 1.3) {
      this.roared = false;
      this.state = 'play';
      this.ui.banner(BIOMES[0].name, BIOMES[0].sub);
      this.chase.timer = 2.5;
      this.chase.gap = 9;
    }
  }

  // ---- gameplay ----------------------------------------------------------------
  updatePlay(dt) {
    const p = this.p;
    const pu = this.pu;
    for (const k in pu) pu[k] = Math.max(0, pu[k] - dt);
    this.monkey.shield.visible = pu.shield > 0;
    p.invuln = Math.max(0, p.invuln - dt);
    p.stumbleT = Math.max(0, p.stumbleT - dt);

    // speed
    let target = speedAt(p.dist);
    if (pu.boost > 0) target *= 1.6;
    if (p.stumbleT > 0) target *= 0.8;
    p.speed = damp(p.speed, target, pu.boost > 0 ? 4 : 2.5, dt);
    const ds = p.speed * dt;
    p.prevS = p.s;
    p.s += ds;
    p.dist += ds;
    this.stats.noBanana += ds;
    this.stats.noStumble += ds;
    this.stats.score += ds * this.mult * (pu.double > 0 ? 2 : 1);

    if (this.autopilot || pu.boost > 0) this.autoDrive();

    // lateral
    p.x = damp(p.x, LANES_X[p.lane], 13, dt);

    // vertical
    const st = p.st;
    const overGap = this.gapAt(st, p.s, p.x);
    if (p.air) {
      p.vy -= p.g * dt;
      p.y += p.vy * dt;
      p.airT += dt;
      if (p.y <= 0) {
        if (overGap && pu.boost <= 0) {
          // landed in a hole
          if (pu.shield > 0) this.shieldHop();
          else return this.die('fall');
        } else {
          p.y = 0;
          p.vy = 0;
          p.air = false;
          p.spin = 0;
          this.audio.play('land');
          this.particles.dust(p.pos, this.dustColor(), 8, 1.4);
          if (p.slideQueued) {
            p.slideQueued = false;
            this.slide();
          }
        }
      }
    } else if (overGap) {
      if (pu.boost > 0) {
        // the rush carries you over holes
        this.jump();
      } else if (pu.shield > 0) this.shieldHop();
      else return this.die('fall');
    }
    if (p.sliding) {
      p.slideT -= dt;
      if (p.slideT <= 0) p.sliding = false;
    }

    // turning
    this.tryTurn();
    const L = p.st.length;
    if (p.s > L + HALF - 0.45) {
      if (pu.shield > 0 || pu.boost > 0) {
        this.breakShield();
        this.doTurn(p.st.children.left ? 'left' : 'right');
      } else return this.die('wall');
    }
    if (this.track.previous && p.s > 24) this.track.dropPrevious();

    // collisions
    this.collide();
    if (this.state !== 'play') return;

    // pickups
    this.pickups(dt);

    // chase
    this.chase.timer = Math.max(0, this.chase.timer - dt);
    if (this.chase.timer <= 0) this.chase.armed = false;
    const cg = this.chase.timer > 0 ? 3.3 : 28;
    this.chase.gap = damp(this.chase.gap, cg, this.chase.timer > 0 ? 3 : 0.35, dt);

    this.placePlayer(dt);
    const mode = p.air ? 'jump' : p.sliding ? 'slide' : 'run';
    this.monkey.update(dt, {
      mode, speed: p.speed, air: p.airT / p.airDur, spin: p.spin,
      lean: (LANES_X[p.lane] - p.x) / LANE, stumble: p.stumbleT / 0.6,
    });
    // invulnerability blink after revive
    this.monkey.group.visible = p.invuln > 0 ? Math.floor(this.time * 14) % 2 === 0 : true;
    this.updateJaguar(dt, 'run');
    this.updateCamera(dt);

    // effects
    if (pu.boost > 0) {
      this.particles.trail(p.pos, [0.7, 0.45, 1]);
      this.particles.trail(p.pos, [1, 0.8, 0.3]);
    }
    if (pu.magnet > 0 && Math.random() < 0.4) this.particles.trail(tmp.copy(p.pos).add(UP), [1, 0.35, 0.35]);
    this.particles.ambient(dt, p.pos, DIRS[p.st.dir], this.env.firefliesAmount, this.env.leafColor());
    for (const o of p.st.obstacles) {
      if (o.fireGlow && !o.dead && Math.abs(o.s - p.s) < 50 && Math.random() < 0.5) this.particles.embers(o.fireGlow, 1);
    }

    this.audio.setIntensity(clamp((p.speed - 14) / 21, 0, 1));
    this.updateMissions();
    this.updateTutorial();
    this.checkBiome();
    if (!this.bestFlashed && Save.data.best > 0 && this.stats.score > Save.data.best) {
      this.bestFlashed = true;
      this.ui.newBest();
      this.audio.play('record');
    }
  }

  gapAt(st, s, x) {
    const lane = clamp(Math.round(x / LANE) + 1, 0, 2);
    for (const g of st.gaps) {
      if (s > g.s0 + 0.3 && s < g.s1 - 0.3 && g.lanes[lane]) return g;
    }
    return null;
  }

  tryTurn() {
    const p = this.p;
    if (!p.pendingTurn) return;
    const L = p.st.length;
    if (p.s >= L - HALF - 0.6) this.doTurn(p.pendingTurn);
  }

  doTurn(side) {
    const p = this.p;
    const st = p.st;
    if (!st.children[side]) return;
    const P = this.track.point(st, p.s, p.x, 0, new THREE.Vector3());
    const next = this.track.turn(side);
    const rel = P.clone().sub(next.start);
    p.s = rel.dot(next.F);
    p.prevS = p.s;
    const xr = rel.dot(next.R);
    p.lane = clamp(Math.round(xr / LANE) + 1, 0, 2);
    p.x = clamp(xr, -LANE - 0.4, LANE + 0.4);
    p.st = next;
    p.pendingTurn = null;
    // carry the visual discontinuity and let it melt away
    const P2 = this.track.point(next, p.s, p.x, 0, new THREE.Vector3());
    p.visOff.add(P.sub(P2));
    this.stats.turns++;
    this.audio.play('swoosh');
    this.particles.dust(p.pos, this.dustColor(), 10, 1.8);
  }

  autoDrive() {
    const p = this.p;
    const st = p.st;
    const L = st.length;
    // turns
    if (!p.pendingTurn && p.s > L - HALF - 2) {
      const opts = ['left', 'right'].filter((k) => st.children[k]);
      p.pendingTurn = opts[Math.floor(Math.random() * opts.length)];
    }
    if (this.pu.boost > 0 && !this.autopilot) return;
    // obstacle avoidance for the autopilot
    const jd = jumpDistance(p.speed);
    const look = p.speed * 0.9 + 6;
    const ahead = st.obstacles.filter((o) => !o.dead && o.s1 > p.s - 0.3 && o.s0 < p.s + look).sort((a, b) => a.s0 - b.s0);
    const laneBlocked = (lane, from, to) => st.obstacles.some((o) => !o.dead && o.lanes[lane] && (o.kind === 'block' || (o.kind === 'gap' && o.type === 'bridge')) && o.s1 > from && o.s0 < to);
    for (const o of ahead) {
      const dist = o.s0 - p.s;
      const inLane = o.lanes[p.lane];
      if (o.kind === 'lowblock') {
        if (inLane && !p.air && dist < jd * 0.42 && dist > -0.3) {
          this.jump();
          return;
        }
        if (inLane) return;
        continue;
      }
      if ((o.kind === 'block' || (o.kind === 'gap' && o.type === 'bridge')) && inLane) {
        let best = null;
        for (const l of [p.lane - 1, p.lane + 1, p.lane - 2, p.lane + 2]) {
          if (l < 0 || l > 2) continue;
          if (!laneBlocked(l, p.s - 1, o.s1 + 6) && (Math.abs(l - p.lane) === 1 || !laneBlocked(1, p.s - 1, o.s0 - 0.5))) {
            best = l;
            break;
          }
        }
        if (best !== null) {
          p.lane = best > p.lane ? p.lane + 1 : p.lane - 1;
          return;
        }
        return;
      }
      if ((o.kind === 'low' || o.kind === 'roots') && !p.air && dist < jd * 0.42 && dist > -0.2) {
        this.jump();
        return;
      }
      if (o.kind === 'gap' && o.type === 'gap' && !p.air) {
        const c = (o.s0 + o.s1) / 2;
        if (c - p.s < jd * 0.5) this.jump();
        return;
      }
      if (o.kind === 'high' && dist < 4 && dist > -1) {
        if (!p.sliding || p.slideT < 0.25) this.slide();
        return;
      }
    }
  }

  collide() {
    const p = this.p;
    const st = p.st;
    const a = Math.min(p.prevS, p.s) - 0.35, b = p.s + 0.35;
    for (const o of st.obstacles) {
      if (o.dead || o.hit || o.s1 < a || o.s0 > b) continue;
      switch (o.kind) {
        case 'low':
          if (p.y < o.top - 0.05) this.deadly(o);
          break;
        case 'roots':
          if (p.y < o.top) {
            o.hit = true;
            this.stumble();
          }
          break;
        case 'high':
          if (!(p.sliding && p.y < 0.25)) this.deadly(o);
          break;
        case 'block':
        case 'lowblock': {
          if (o.kind === 'lowblock' && p.y >= o.top - 0.05) break;
          const li = o.lanes.indexOf(true);
          const d = Math.abs(p.x - LANES_X[li]);
          if (d < 1.25) {
            if (d < 0.8) this.deadly(o);
            else {
              o.hit = true;
              p.lane = clamp(p.x < LANES_X[li] ? li - 1 : li + 1, 0, 2);
              this.stumble();
            }
          }
          break;
        }
      }
      if (this.state !== 'play') return;
    }
  }

  deadly(o) {
    const p = this.p;
    if (this.pu.boost > 0) return this.smash(o);
    if (p.invuln > 0) return;
    if (this.pu.shield > 0) {
      this.breakShield();
      this.smash(o);
      return;
    }
    this.die(o.cause);
  }

  smash(o, quiet = false) {
    const st = this.p.st;
    this.track.smash(st, o);
    if (quiet) return;
    this.stats.smashes++;
    const c = this.track.point(st, o.s, o.lanes.every(Boolean) ? this.p.x : LANES_X[o.lanes.indexOf(true)], 0.8);
    this.particles.debris(c, 20);
    this.audio.play('smash');
    this.shake = Math.max(this.shake, 0.35);
  }

  breakShield() {
    if (this.pu.shield <= 0) return;
    this.pu.shield = 0;
    this.monkey.shield.visible = false;
    this.p.invuln = Math.max(this.p.invuln, 1.0);
    this.particles.burst(tmp.copy(this.p.pos).add(UP), [0.4, 0.8, 1], 40, 7);
    this.audio.play('shieldBreak');
  }

  shieldHop() {
    this.breakShield();
    const p = this.p;
    p.air = false;
    p.y = 0.01;
    this.jump();
    p.vy *= 1.2;
  }

  stumble() {
    const p = this.p;
    if (p.invuln > 0 || this.pu.boost > 0) return;
    if (this.chase.armed && this.chase.timer > 0 && this.chase.gap < 10) return this.die('caught');
    p.stumbleT = 0.6;
    this.chase.timer = 5.5;
    this.chase.armed = true;
    this.stats.noStumble = 0;
    this.shake = Math.max(this.shake, 0.4);
    this.audio.play('stumble');
    this.jaguar.roar();
    this.audio.play('roar', { vol: 0.6 });
    this.particles.dust(p.pos, this.dustColor(), 12, 2);
  }

  pickups(dt) {
    const p = this.p;
    const center = tmp2.copy(p.pos).setY(p.pos.y + 0.8);
    const lists = [p.st];
    if (this.track.previous) lists.push(this.track.previous);
    if (p.s > p.st.length - 10) for (const c of this.track.childList(p.st)) lists.push(c);
    const magnet = this.pu.magnet > 0;
    this.bananaChainT -= dt;
    if (this.bananaChainT < 0) this.bananaChain = 0;
    const top = p.sliding ? 1.0 : 1.9;
    for (const st of lists) {
      for (const b of st.bananas) {
        if (b.taken) continue;
        if (magnet && !b.fly && b.pos.distanceToSquared(center) < 100) b.fly = true;
        if (b.fly) {
          const d = b.pos.distanceTo(center);
          const step = Math.min(d, (25 + p.speed) * dt);
          b.pos.addScaledVector(tmp.copy(center).sub(b.pos).normalize(), step);
          if (d < 0.8) this.collectBanana(b);
          continue;
        }
        const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
        if (dx * dx + dz * dz < 1.2 && b.pos.y > p.y - 0.4 && b.pos.y < p.y + top) this.collectBanana(b);
      }
      for (const u of st.powerups) {
        if (u.taken) continue;
        const dx = u.pos.x - p.pos.x, dz = u.pos.z - p.pos.z;
        if (dx * dx + dz * dz < 2.0 && u.pos.y > p.y - 0.5 && u.pos.y < p.y + top + 0.3) {
          u.taken = true;
          this.activatePowerup(u.type, u.pos);
        }
      }
    }
  }

  collectBanana(b) {
    b.taken = true;
    const n = b.golden ? 5 : 1;
    this.stats.bananas += n;
    if (b.golden) this.stats.golden++;
    this.stats.noBanana = 0;
    this.stats.score += (b.golden ? 50 : 10) * this.mult * (this.pu.double > 0 ? 2 : 1);
    this.bananaChain++;
    this.bananaChainT = 0.45;
    if (b.golden) {
      this.audio.play('golden');
      this.particles.burst(b.pos, [1, 0.8, 0.2], 24, 5);
    } else {
      this.audio.play('banana', { pitch: Math.min(this.bananaChain, 14) });
      this.particles.sparkle(b.pos, [1, 0.88, 0.3], 6);
    }
    this.ui.bumpBananas();
  }

  activatePowerup(type, pos) {
    const lvl = Save.data.upgrades[type] || 0;
    const def = POWERUPS[type];
    const dur = def.base + def.perLevel * lvl;
    this.pu[type] = dur;
    this.puMax[type] = dur;
    this.stats.powerups++;
    if (type === 'shield') this.monkey.shield.visible = true;
    if (type === 'boost') {
      this.p.invuln = 0;
      this.chase.timer = 0;
      this.shake = 0.3;
    }
    const col = new THREE.Color(def.color);
    this.particles.burst(pos, [col.r, col.g, col.b], 36, 6);
    this.audio.play('powerup');
    this.ui.toast(def.name + '!', 'power', def.color);
  }

  // ---- death ---------------------------------------------------------------------
  die(cause) {
    const p = this.p;
    this.state = 'dying';
    p.cause = cause;
    p.deathT = 0;
    p.sliding = false;
    this.shake = cause === 'fall' ? 0.3 : 0.8;
    const snd = cause === 'fall' ? 'fall' : cause === 'burn' ? 'burn' : 'crash';
    this.audio.play(snd);
    if (cause === 'caught') {
      this.audio.play('roar');
      this.jaguar.roar();
    }
    if (cause === 'fall') {
      p.air = true;
      p.vy = Math.max(p.vy, 1.5);
    }
    if (cause === 'burn') this.particles.burst(tmp.copy(p.pos).add(UP), [1, 0.5, 0.1], 40, 5);
    if (cause !== 'fall') this.particles.dust(p.pos, this.dustColor(), 20, 2.5);
    this.audio.setMode('menu');
  }

  updateDying(dt) {
    const p = this.p;
    p.deathT += dt;
    const t = p.deathT;
    if (p.cause === 'fall') {
      p.vy -= 30 * dt;
      p.y += p.vy * dt;
      p.s += p.speed * dt * Math.max(0, 1 - t * 1.2);
      this.monkey.update(dt, { mode: 'fall', stumble: 0 });
    } else {
      // knocked back
      if (t < 0.3) p.s -= dt * 6 * (1 - t / 0.3);
      if (p.y > 0) {
        p.vy -= 30 * dt;
        p.y = Math.max(0, p.y + p.vy * dt);
      }
      this.monkey.update(dt, { mode: p.cause === 'caught' ? 'caught' : 'crash', stumble: 0 });
    }
    this.monkey.group.visible = true;
    this.placePlayer(dt);
    if (p.cause === 'caught') {
      this.chase.gap = damp(this.chase.gap, 1.2, 6, dt);
      this.updateJaguar(dt, 'pounce');
    } else {
      this.chase.gap = damp(this.chase.gap, p.cause === 'fall' ? 6 : 4.5, 2, dt);
      this.updateJaguar(dt, this.chase.gap < 6 ? 'idle' : 'run');
    }
    // death camera, framed per cause
    const st = p.st;
    const F = DIRS[st.dir], R = st.R;
    const ground = st.start.y;
    const camTarget = tmp.copy(p.pos);
    const desired = tmp2.copy(p.pos);
    if (p.cause === 'caught') {
      // swing round in front to watch the pounce
      camTarget.addScaledVector(F, -1.2).setY(ground + 0.8);
      desired.addScaledVector(F, 5.5).addScaledVector(R, 2.2).setY(ground + 2.6);
    } else if (p.cause === 'fall') {
      camTarget.setY(p.pos.y - 1);
      desired.addScaledVector(F, -5).setY(ground + 4.5);
    } else {
      camTarget.setY(ground + 0.5);
      desired.addScaledVector(F, -4.2).addScaledVector(R, 1.6).setY(ground + 3.2);
    }
    this.camera.position.lerp(desired, 1 - Math.exp(-2.5 * dt));
    this.camera.lookAt(camTarget);
    this.applyShake(dt);
    if (this.state === 'dying' && t > 1.7) this.gameOver();
  }

  gameOver() {
    this.state = 'over';
    const d = Save.data;
    const s = this.stats;
    const score = Math.floor(s.score);
    const newBest = score > d.best;
    if (!this.runBanked) {
      d.bananas += s.bananas;
      d.totalBananas += s.bananas;
      d.totalGolden += s.golden;
      d.totalDistance += this.p.dist;
      d.runs++;
      this.runBanked = { bananas: s.bananas, golden: s.golden, dist: this.p.dist };
    } else {
      // after a revive only bank what was gained since the last bank
      const nb = s.bananas - this.runBanked.bananas;
      const ng = s.golden - this.runBanked.golden;
      d.bananas += nb;
      d.totalBananas += nb;
      d.totalGolden += ng;
      d.totalDistance += this.p.dist - this.runBanked.dist;
      this.runBanked = { bananas: s.bananas, golden: s.golden, dist: this.p.dist };
    }
    if (newBest) d.best = score;
    d.bestDistance = Math.max(d.bestDistance, Math.floor(this.p.dist));
    this.updateMissions();
    Save.save();
    const [title, sub] = DEATH_TEXT[this.p.cause] || DEATH_TEXT.smack;
    const cost = 150 * Math.pow(2, s.revives);
    this.ui.showGameOver({
      title, sub, score, newBest, dist: Math.floor(this.p.dist), bananas: s.bananas, mult: this.mult, best: d.best,
      reviveCost: cost, canRevive: d.bananas >= cost && s.revives < 3,
    });
  }

  // quitting or restarting from the pause menu still pays out what you collected
  abandonRun() {
    clearTimeout(this.cdTimer);
    this.ui.countdown(null);
    if (this.state === 'paused' || this.state === 'countdown' || this.state === 'play') {
      const d = Save.data, s = this.stats;
      const base = this.runBanked || { bananas: 0, golden: 0, dist: 0 };
      d.bananas += s.bananas - base.bananas;
      d.totalBananas += s.bananas - base.bananas;
      d.totalGolden += s.golden - base.golden;
      d.totalDistance += this.p.dist - base.dist;
      if (!this.runBanked) d.runs++;
      d.best = Math.max(d.best, Math.floor(s.score));
      d.bestDistance = Math.max(d.bestDistance, Math.floor(this.p.dist));
      this.runBanked = { bananas: s.bananas, golden: s.golden, dist: this.p.dist };
      this.state = 'over';
    }
  }

  finalizeRun() {
    if (this.state !== 'over' && this.state !== 'dying') return;
    Save.data.tutorialRuns++;
    this.missions.refresh();
    this.runBanked = null;
    Save.save();
  }

  revive() {
    if (this.state !== 'over') return;
    const d = Save.data;
    const cost = 150 * Math.pow(2, this.stats.revives);
    if (d.bananas < cost) return;
    d.bananas -= cost;
    Save.save();
    this.stats.revives++;
    const p = this.p;
    const st = p.st;
    if (p.cause === 'fall') {
      const g = st.gaps.find((g) => p.s > g.s0 - 2 && p.s < g.s1 + 2);
      if (g) {
        p.s = g.s1 + 1.2;
        if (!g.lanes.every(Boolean)) {
          p.lane = g.lanes.indexOf(false);
          p.x = LANES_X[p.lane];
        }
      }
    }
    if (p.cause === 'wall') {
      p.s = st.length - 1;
      this.doTurn(st.children.left ? 'left' : 'right');
    }
    p.y = 0;
    p.vy = 0;
    p.air = false;
    p.sliding = false;
    p.stumbleT = 0;
    p.invuln = 3;
    p.prevS = p.s;
    for (const o of p.st.obstacles) {
      if (o.kind !== 'gap' && o.s1 > p.s - 3 && o.s0 < p.s + 30) this.smash(o, true);
    }
    this.chase.gap = 28;
    this.chase.timer = 0;
    this.ui.showHud();
    this.monkey.update(0.016, { mode: 'run', speed: p.speed, stumble: 0 });
    this.countdown(() => this.audio.setMode('run'));
  }

  // ---- placing things in the world -------------------------------------------------
  placePlayer(dt) {
    const p = this.p;
    const st = p.st;
    p.visOff.multiplyScalar(Math.exp(-8 * dt));
    this.track.point(st, p.s, p.x, p.y, p.pos).add(p.visOff);
    this.monkey.group.position.copy(p.pos);
    const targetYaw = dirYaw(st.dir);
    p.yaw = dampAngle(p.yaw, targetYaw, 14, dt);
    // lean into lane changes by turning the body a little
    const steer = (LANES_X[p.lane] - p.x) / LANE;
    this.monkey.group.rotation.y = p.yaw - steer * 0.35;
    // record trail for the pursuer
    if (this.state === 'play' || this.state === 'intro' || this.state === 'dying') {
      const last = this.trail[this.trail.length - 1];
      if (!last || p.dist - last.d > 0.25) this.trail.push({ d: p.dist, pos: tmp.copy(p.pos).sub(p.visOff).setY(st.start.y).clone(), yaw: targetYaw });
      while (this.trail.length > 2 && this.trail[1].d < p.dist - 40) this.trail.shift();
    }
  }

  updateJaguar(dt, mode, speedOverride) {
    const J = this.jaguar;
    if (mode === 'lurk') {
      // hide in the dark doorway, eyes glowing
      const st = this.track.current;
      this.track.point(st, -19.6, 0, 0, J.group.position);
      J.group.rotation.y = dirYaw(st.dir);
      J.group.visible = true;
      J.update(dt, 'idle', 0);
      return;
    }
    const want = this.p.dist - this.chase.gap;
    const tr = this.trail;
    if (!tr.length || this.chase.gap > 26) {
      J.group.visible = false;
      return;
    }
    J.group.visible = true;
    let i = 0;
    while (i < tr.length - 2 && tr[i + 1].d < want) i++;
    const a = tr[i], b = tr[Math.min(i + 1, tr.length - 1)];
    const k = b.d > a.d ? clamp((want - a.d) / (b.d - a.d), 0, 1) : 0;
    J.group.position.lerpVectors(a.pos, b.pos, k);
    const yaw = Math.abs(angleDiff(a.yaw, b.yaw)) > 0.01 ? (k < 0.5 ? a.yaw : b.yaw) : a.yaw;
    J.group.rotation.y = dampAngle(J.group.rotation.y, yaw, 10, dt);
    if (mode === 'pounce') {
      J.group.position.y += Math.sin(Math.min(1, this.p.deathT * 2) * Math.PI) * 1.2;
    }
    J.update(dt, mode, speedOverride ?? this.p.speed);
  }

  updateCamera(dt) {
    const p = this.p;
    if (dt > 0) {
      const targetYaw = dirYaw(p.st.dir);
      this.camYaw = dampAngle(this.camYaw, targetYaw, 8, dt);
    }
    const F = tmp.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const boost = this.pu.boost > 0 ? 1 : 0;
    // pull back while the guardian is on your heels so both stay in frame
    const chaseTarget = this.chase.timer > 0 ? clamp(1 - (this.chase.gap - 3.4) / 10, 0, 1) : 0;
    this.camChase = dt > 0 ? damp(this.camChase || 0, chaseTarget, 5, dt) : this.camChase || 0;
    const dist = 6.6 + boost * 1.2 + this.camChase * 2.6;
    const height = 3.6 - (p.sliding ? 0.5 : 0) + p.y * 0.35 + this.camChase * 1.3;
    const base = tmp2.copy(p.pos).sub(p.visOff.clone().multiplyScalar(0.5));
    const desired = base.clone().addScaledVector(F, -dist);
    desired.y = p.pos.y - p.y + height;
    if (dt > 0) {
      this.camera.position.lerp(desired, 1 - Math.exp(-12 * dt));
      this.camera.position.y = damp(this.camera.position.y, desired.y, 8, dt);
    }
    const look = base.clone().addScaledVector(F, 6).setY(p.pos.y - p.y * 0.6 + 1.2);
    this.camera.lookAt(look);
    if (dt > 0) {
      const sf = clamp((p.speed - 14) / 21, 0, 1);
      this.camera.fov = damp(this.camera.fov, this.baseFov + sf * 9 + boost * 12, 3, dt);
      this.camera.updateProjectionMatrix();
      this.applyShake(dt);
    }
  }

  applyShake(dt) {
    if (this.shake > 0 && Save.data.settings.shake) {
      const s = this.shake * this.shake * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.1;
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
  }

  onFootstep() {
    if (this.state !== 'play' && this.state !== 'intro') return;
    this.audio.play('step');
    if (Math.random() < 0.6) this.particles.dust(this.p.pos, this.dustColor(), 2, 0.6);
  }

  dustColor() {
    const b = this.env.blend.index;
    return b === 2 ? [0.35, 0.38, 0.5] : b === 1 ? [0.8, 0.62, 0.45] : [0.72, 0.68, 0.56];
  }

  // ---- missions, tutorial, biome ----------------------------------------------------
  updateMissions() {
    const s = this.stats, m = this.missions, d = Save.data;
    const done = [
      ...m.report('distance', this.p.dist),
      ...m.report('bananas', s.bananas),
      ...m.report('jumps', s.jumps),
      ...m.report('slides', s.slides),
      ...m.report('turns', s.turns),
      ...m.report('score', s.score),
      ...m.report('powerups', s.powerups),
      ...m.report('nobanana', s.noBanana),
      ...m.report('noStumble', s.noStumble),
      ...m.report('smash', s.smashes),
      ...m.report('golden', d.totalGolden + (this.runBanked ? 0 : s.golden)),
      ...m.report('totalBananas', d.totalBananas + (this.runBanked ? 0 : s.bananas)),
    ];
    for (const ms of done) {
      this.mult = m.multiplier;
      this.ui.toast('Mission complete: ' + m.text(ms), 'mission');
      this.ui.toast('Multiplier x' + this.mult + '!', 'mult');
      this.audio.play('mission');
      Save.save();
    }
  }

  updateTutorial() {
    if (!this.tutorial) return;
    const p = this.p;
    const st = p.st;
    const L = st.length;
    if (p.s > L - 16 && p.s < L - HALF && !this.hinted['j' + st.id] && this.junctionHints < 4) {
      this.hinted['j' + st.id] = true;
      this.junctionHints++;
      const txt = st.junction === 'T' ? 'TURN ← OR →' : st.junction === 'L' ? 'TURN LEFT ←' : 'TURN RIGHT →';
      this.ui.tutorial(txt + '<small>press ← → or swipe at the corner</small>');
      return;
    }
    const look = p.speed * 1.4;
    for (const o of st.obstacles) {
      if (o.dead || o.s0 < p.s || o.s0 > p.s + look) continue;
      const key = o.kind === 'gap' && o.type === 'bridge' ? 'bridge' : o.kind;
      if (this.hinted[key]) return;
      this.hinted[key] = true;
      const text = {
        low: 'JUMP! ↑<small>Space / ↑ / swipe up</small>',
        roots: 'JUMP the roots ↑<small>tripping wakes the Guardian</small>',
        gap: 'JUMP the gap! ↑',
        bridge: 'STAY ON THE BRIDGE<small>← → to change lanes</small>',
        high: 'SLIDE! ↓<small>↓ / S / swipe down</small>',
        block: 'DODGE ← →<small>change lanes</small>',
        lowblock: 'DODGE or JUMP<small>rubble can be hopped</small>',
      }[key];
      this.ui.tutorial(text);
      return;
    }
  }

  checkBiome() {
    const b = this.env.biomeState(this.p.dist).index;
    if (b !== this.lastBiome) {
      this.lastBiome = b;
      this.ui.banner(BIOMES[b].name, BIOMES[b].sub);
    }
  }

  setSkin(id) {
    const skin = SKINS.find((s) => s.id === id);
    if (skin) this.monkey.setSkin(skin);
  }
}
