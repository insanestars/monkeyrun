// ---------------------------------------------------------------------------
// Fully synthesized audio: a tribal marimba/drum groove that speeds up with
// the run, plus every sound effect. No audio files.
// ---------------------------------------------------------------------------
const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.sfxOn = true;
    this.mode = 'menu';
    this.tempo = 104;
    this.step = 0;
    this.nextTime = 0;
    this.intensity = 0;
    this.bar = 0;
    this.chord = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.music = c.createGain();
    this.music.gain.value = this.musicOn ? 0.42 : 0;
    this.music.connect(this.master);
    this.sfx = c.createGain();
    this.sfx.gain.value = this.sfxOn ? 0.8 : 0;
    this.sfx.connect(this.master);
    // shared noise buffer
    const len = c.sampleRate * 1.5;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // simple reverb for the music
    this.reverb = c.createConvolver();
    const ir = c.createBuffer(2, c.sampleRate * 1.8, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
    this.reverb.buffer = ir;
    const rv = c.createGain();
    rv.gain.value = 0.22;
    this.reverb.connect(rv).connect(this.master);
    this.nextTime = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.music) this.music.gain.setTargetAtTime(on ? 0.42 : 0, this.ctx.currentTime, 0.1);
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  setMode(mode) {
    this.mode = mode;
  }

  setIntensity(speedFrac) {
    this.intensity = speedFrac;
  }

  duck(amount = 0.2, time = 0.6) {
    if (!this.ctx || !this.musicOn) return;
    const g = this.music.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.42 * amount, t + 0.05);
    g.linearRampToValueAtTime(0.42, t + time);
  }

  // ---- music sequencer ----------------------------------------------------
  schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    if (this.mode === 'silent') {
      this.nextTime = c.currentTime + 0.05;
      return;
    }
    const playing = this.mode === 'run';
    this.tempo = playing ? 112 + this.intensity * 26 : 92;
    const stepDur = 60 / this.tempo / 4;
    while (this.nextTime < c.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, playing);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar++;
        this.chord = [0, 0, 8, 10, 0, 0, 5, 7][this.bar % 8];
      }
    }
  }

  playStep(s, t, playing) {
    const root = 45 + this.chord; // A2 based
    if (playing) {
      if ([0, 6, 8, 11].includes(s) || (this.intensity > 0.6 && s === 14)) this.kick(t);
      if ([4, 12].includes(s)) this.snareRim(t);
      if ([2, 3, 7, 10, 13, 15].includes(s)) this.bongo(t, s % 3 === 0 ? 1 : 0);
      this.shaker(t, s % 4 === 0 ? 0.08 : s % 2 === 0 ? 0.05 : 0.03);
      if ([0, 3, 8, 11, 14].includes(s)) this.bass(t, midi(root), s === 0 ? 0.32 : 0.2);
      // marimba melody: generative pentatonic phrase that repeats per 2 bars
      const seed = (this.bar >> 1) * 16 + s;
      const r = Math.abs(Math.sin(seed * 12.9898 + this.chord) * 43758.5453) % 1;
      if (r < 0.42 || s === 0) {
        const deg = Math.floor(r * 100) % PENTA.length;
        const oct = r < 0.12 ? 24 : 12;
        this.marimba(t, midi(57 + this.chord + PENTA[deg] + oct), 0.14);
      }
      if (s === 0 && this.bar % 2 === 0) this.pad(t, root + 12, 60 / this.tempo * 8);
    } else {
      // menu: gentle marimba arpeggio and soft drums
      if (s === 0 || s === 10) this.bongo(t, 0, 0.5);
      if (s % 4 === 2) this.shaker(t, 0.025);
      if (s % 2 === 0) {
        const arp = [0, 7, 12, 15, 19, 15, 12, 7];
        this.marimba(t, midi(57 + this.chord + arp[(s / 2) % 8]), 0.1);
      }
      if (s === 0) this.bass(t, midi(root), 0.18, 1.2);
      if (s === 0 && this.bar % 2 === 0) this.pad(t, root + 12, 60 / this.tempo * 8);
    }
  }

  osc(type, freq, t, dur, gain, dest, attack = 0.005) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noiseHit(t, dur, gain, filterType, freq, dest, q = 1) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
    return { src, f, g };
  }

  kick(t) {
    const o = this.osc('sine', 120, t, 0.32, 0.9, this.music);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  }
  snareRim(t) {
    this.noiseHit(t, 0.12, 0.3, 'bandpass', 2400, this.music, 0.8);
    this.osc('triangle', 330, t, 0.05, 0.2, this.music);
  }
  bongo(t, hi, vol = 1) {
    const f = hi ? 420 : 280;
    const o = this.osc('sine', f * 1.4, t, 0.18, 0.4 * vol, this.music);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    this.noiseHit(t, 0.03, 0.08 * vol, 'highpass', 3000, this.music);
  }
  shaker(t, vol) {
    this.noiseHit(t, 0.05, vol, 'highpass', 7000, this.music);
  }
  bass(t, f, vol, dur = 0.35) {
    const c = this.ctx;
    const o = this.osc('triangle', f, t, dur, vol, this.music, 0.01);
    const o2 = this.osc('sine', f / 2, t, dur, vol * 0.6, this.music, 0.01);
    return [o, o2, c];
  }
  marimba(t, f, vol) {
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.music);
    g.connect(this.reverb);
    this.osc('sine', f, t, 0.5, vol, g, 0.002);
    if (f * 4 < 16000) this.osc('sine', f * 4, t, 0.08, vol * 0.35, g, 0.001);
    if (f * 9.2 < 16000) this.osc('sine', f * 9.2, t, 0.03, vol * 0.12, g, 0.001);
  }
  pad(t, note, dur) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.reverb);
    for (const [n, det] of [[note, -6], [note + 7, 5], [note + 12, 0], [note + 3, 3]]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  // ---- sound effects ------------------------------------------------------
  play(name, opts = {}) {
    const c = this.ctx;
    if (!c || !this.sfxOn || c.state !== 'running') return;
    const t = c.currentTime + 0.005;
    const S = this.sfx;
    switch (name) {
      case 'banana': {
        const p = opts.pitch || 0;
        const base = midi(76 + PENTA[p % 5] + 12 * Math.floor(p / 5) * 0);
        this.osc('square', base, t, 0.08, 0.08, S);
        this.osc('sine', base * 1.5, t + 0.04, 0.14, 0.14, S);
        break;
      }
      case 'golden': {
        [0, 4, 7, 12, 16].forEach((n, i) => this.osc('triangle', midi(79 + n), t + i * 0.04, 0.25, 0.14, S));
        break;
      }
      case 'jump': {
        const o = this.osc('sine', 260, t, 0.22, 0.25, S);
        o.frequency.exponentialRampToValueAtTime(620, t + 0.15);
        const n = this.noiseHit(t, 0.2, 0.15, 'bandpass', 900, S, 1.5);
        n.f.frequency.exponentialRampToValueAtTime(3000, t + 0.18);
        if (Math.random() < 0.3) this.ook(t + 0.02, 1.15);
        break;
      }
      case 'land': {
        this.noiseHit(t, 0.1, 0.25, 'lowpass', 600, S);
        this.osc('sine', 90, t, 0.1, 0.3, S);
        break;
      }
      case 'slide': {
        const n = this.noiseHit(t, 0.45, 0.22, 'bandpass', 1800, S, 0.7);
        n.f.frequency.exponentialRampToValueAtTime(500, t + 0.4);
        break;
      }
      case 'swoosh': {
        const n = this.noiseHit(t, 0.28, 0.25, 'bandpass', 600, S, 2);
        n.f.frequency.exponentialRampToValueAtTime(2600, t + 0.25);
        break;
      }
      case 'lane': {
        const n = this.noiseHit(t, 0.12, 0.1, 'bandpass', 1500, S, 2);
        n.f.frequency.exponentialRampToValueAtTime(2800, t + 0.1);
        break;
      }
      case 'step': {
        this.noiseHit(t, 0.05, 0.06, 'lowpass', 500 + Math.random() * 300, S);
        break;
      }
      case 'stumble': {
        this.noiseHit(t, 0.2, 0.4, 'lowpass', 400, S);
        this.osc('sine', 110, t, 0.15, 0.4, S);
        this.ook(t + 0.05, 1.4);
        break;
      }
      case 'crash': {
        this.noiseHit(t, 0.5, 0.7, 'lowpass', 900, S);
        const o = this.osc('sine', 160, t, 0.4, 0.6, S);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
        this.ook(t + 0.1, 0.8, 0.5);
        this.duck(0.15, 1.5);
        break;
      }
      case 'fall': {
        const o = this.osc('sine', 900, t, 1.4, 0.18, S, 0.02);
        o.frequency.exponentialRampToValueAtTime(120, t + 1.3);
        this.ook(t, 1.6, 0.9);
        this.duck(0.15, 2);
        break;
      }
      case 'burn': {
        this.noiseHit(t, 0.8, 0.5, 'bandpass', 1200, S, 0.6);
        this.ook(t, 1.8, 0.6);
        this.duck(0.15, 1.5);
        break;
      }
      case 'roar': {
        this.roar(t, opts.vol || 1);
        break;
      }
      case 'powerup': {
        [0, 5, 7, 12, 17, 19, 24].forEach((n, i) => this.osc('triangle', midi(72 + n), t + i * 0.035, 0.22, 0.13, S));
        break;
      }
      case 'shieldBreak': {
        this.noiseHit(t, 0.4, 0.4, 'highpass', 2500, S);
        [12, 7, 3, 0].forEach((n, i) => this.osc('triangle', midi(84 + n), t + i * 0.05, 0.18, 0.12, S));
        break;
      }
      case 'smash': {
        this.noiseHit(t, 0.35, 0.6, 'lowpass', 1500, S);
        this.osc('sine', 80, t, 0.3, 0.5, S);
        break;
      }
      case 'mission': {
        [0, 4, 7, 12, 7, 12, 16, 19].forEach((n, i) => this.osc('square', midi(72 + n), t + i * 0.07, 0.12, 0.06, S));
        break;
      }
      case 'click': {
        this.osc('sine', 800, t, 0.05, 0.12, S);
        break;
      }
      case 'buy': {
        [0, 7, 12, 19].forEach((n, i) => this.osc('triangle', midi(76 + n), t + i * 0.05, 0.2, 0.15, S));
        this.noiseHit(t, 0.2, 0.05, 'highpass', 6000, S);
        break;
      }
      case 'error': {
        this.osc('square', 140, t, 0.18, 0.08, S);
        this.osc('square', 110, t + 0.1, 0.2, 0.08, S);
        break;
      }
      case 'countdown': {
        this.osc('sine', opts.go ? 880 : 520, t, opts.go ? 0.4 : 0.15, 0.2, S);
        break;
      }
      case 'record': {
        [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.osc('triangle', midi(67 + n), t + i * 0.06, 0.35, 0.12, S));
        break;
      }
    }
  }

  // a little formant-synth monkey "ook!"
  ook(t, pitch = 1, len = 0.18) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(380 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(620 * pitch, t + len * 0.3);
    o.frequency.exponentialRampToValueAtTime(300 * pitch, t + len);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(700, t);
    f1.frequency.linearRampToValueAtTime(1100, t + len * 0.4);
    f1.Q.value = 5;
    const f2 = c.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 2300;
    f2.Q.value = 6;
    o.connect(f1).connect(g);
    o.connect(f2).connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  roar(t, vol = 1) {
    const c = this.ctx;
    const n = this.noiseHit(t, 1.3, 0.55 * vol, 'lowpass', 300, this.sfx, 2);
    n.f.frequency.linearRampToValueAtTime(900, t + 0.3);
    n.f.frequency.linearRampToValueAtTime(200, t + 1.2);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(110, t + 0.3);
    o.frequency.linearRampToValueAtTime(55, t + 1.2);
    const lfo = c.createOscillator();
    lfo.frequency.value = 28;
    const lg = c.createGain();
    lg.gain.value = 15;
    lfo.connect(lg).connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * vol, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.4);
    lfo.stop(t + 1.4);
  }
}
