// ---------------------------------------------------------------------------
// Persistent progress: wallet, records, upgrades, skins, missions, settings.
// ---------------------------------------------------------------------------
const KEY = 'monkeyrun.save.v1';

const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

function defaults() {
  return {
    bananas: 0,
    best: 0,
    bestDistance: 0,
    totalBananas: 0,
    totalGolden: 0,
    totalDistance: 0,
    runs: 0,
    upgrades: { magnet: 0, shield: 0, double: 0, boost: 0 },
    skins: ['classic'],
    skin: 'classic',
    missionLevel: 0,
    missions: null,
    tutorialRuns: 0,
    settings: { music: true, sfx: true, quality: isMobile ? 'medium' : 'high', fps: false, shake: true },
  };
}

export const Save = {
  data: defaults(),
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const def = defaults();
        this.data = { ...def, ...d, upgrades: { ...def.upgrades, ...(d.upgrades || {}) }, settings: { ...def.settings, ...(d.settings || {}) } };
      }
    } catch (e) {
      this.data = defaults();
    }
    return this.data;
  },
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      /* storage unavailable: progress lives for this session only */
    }
  },
  reset() {
    this.data = defaults();
    this.save();
  },
};

// ---------------------------------------------------------------------------
// Missions: three active objectives. Each completion raises the permanent
// score multiplier by 1.
// ---------------------------------------------------------------------------
const MISSION_TYPES = {
  distance: { scope: 'run', tiers: [500, 1000, 1800, 2500, 3500, 5000, 7500, 10000], text: (n) => `Run ${n.toLocaleString()} m in one run` },
  bananas: { scope: 'run', tiers: [40, 100, 175, 250, 400, 600, 900], text: (n) => `Collect ${n} bananas in one run` },
  jumps: { scope: 'run', tiers: [10, 25, 40, 60, 90], text: (n) => `Jump ${n} times in one run` },
  slides: { scope: 'run', tiers: [8, 20, 35, 50, 80], text: (n) => `Slide ${n} times in one run` },
  turns: { scope: 'run', tiers: [8, 16, 25, 40, 60], text: (n) => `Take ${n} turns in one run` },
  score: { scope: 'run', tiers: [5000, 15000, 40000, 80000, 150000, 300000, 600000], text: (n) => `Score ${n.toLocaleString()} points in one run` },
  powerups: { scope: 'run', tiers: [1, 2, 3, 5, 7], text: (n) => `Grab ${n} power-up${n > 1 ? 's' : ''} in one run` },
  nobanana: { scope: 'run', tiers: [300, 600, 1000, 1500], text: (n) => `Run ${n} m without collecting a banana` },
  golden: { scope: 'total', tiers: [3, 10, 25, 50, 100], text: (n) => `Collect ${n} golden bananas (total)` },
  totalBananas: { scope: 'total', tiers: [500, 1500, 4000, 10000, 25000], text: (n) => `Collect ${n.toLocaleString()} bananas (total)` },
  noStumble: { scope: 'run', tiers: [500, 1000, 2000, 3000], text: (n) => `Run ${n} m without stumbling` },
  smash: { scope: 'run', tiers: [1, 3, 6, 10], text: (n) => `Smash ${n} obstacle${n > 1 ? 's' : ''} with a shield or rush` },
};

export class Missions {
  constructor(save) {
    this.save = save;
    const d = save.data;
    if (!d.missions || !Array.isArray(d.missions.active) || d.missions.active.length !== 3) {
      d.missions = { active: [], tiers: {} };
      for (const t of ['distance', 'bananas', 'jumps']) d.missions.active.push(this.make(t));
    }
    this.justCompleted = [];
  }

  make(type) {
    const d = this.save.data;
    const tiers = d.missions?.tiers || {};
    const tier = tiers[type] || 0;
    const def = MISSION_TYPES[type];
    const target = def.tiers[Math.min(tier, def.tiers.length - 1)] * (tier >= def.tiers.length ? 1 + (tier - def.tiers.length + 1) * 0.5 : 1);
    return { type, target: Math.round(target), progress: def.scope === 'total' ? this.totalProgress(type) : 0, done: false };
  }

  totalProgress(type) {
    const d = this.save.data;
    if (type === 'golden') return d.totalGolden;
    if (type === 'totalBananas') return d.totalBananas;
    return 0;
  }

  text(m) {
    return MISSION_TYPES[m.type].text(m.target);
  }

  get active() {
    return this.save.data.missions.active;
  }

  startRun() {
    for (const m of this.active) if (MISSION_TYPES[m.type].scope === 'run' && !m.done) m.progress = 0;
    this.justCompleted = [];
  }

  // set or add progress; returns array of newly completed missions
  report(type, value, mode = 'set') {
    const out = [];
    for (const m of this.active) {
      if (m.type !== type || m.done) continue;
      m.progress = mode === 'add' ? m.progress + value : Math.max(m.progress, value);
      if (m.progress >= m.target) {
        m.done = true;
        m.progress = m.target;
        this.save.data.missionLevel++;
        const tiers = this.save.data.missions.tiers;
        tiers[m.type] = (tiers[m.type] || 0) + 1;
        out.push(m);
        this.justCompleted.push(m);
      }
    }
    return out;
  }

  // after a run, replace completed missions with new ones
  refresh() {
    const act = this.active;
    for (let i = 0; i < act.length; i++) {
      if (act[i].done) {
        const used = new Set(act.map((m) => m.type));
        const pool = Object.keys(MISSION_TYPES).filter((t) => !used.has(t));
        const type = pool[Math.floor(Math.random() * pool.length)];
        act[i] = this.make(type);
      } else if (MISSION_TYPES[act[i].type].scope === 'run') {
        act[i].progress = 0;
      }
    }
    this.save.save();
  }

  get multiplier() {
    return 1 + this.save.data.missionLevel;
  }
}
