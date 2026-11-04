// ---------------------------------------------------------------------------
// Tuning constants shared by the world generator and the game loop.
// ---------------------------------------------------------------------------
export const LANE = 2.5; // lane spacing
export const HALF = 3.75; // half width of the walkable path
export const CURB = 0.55; // width of the raised curb stones

export const BIOME_LENGTH = 1000; // metres per biome
export const BIOME_BLEND = 140; // metres to cross-fade lighting

export const speedAt = (d) => 14 + 21 * (1 - Math.exp(-d / 3200));
export const jumpDistance = (speed) => 10 + speed * 0.13;
export const slideDistance = (speed) => 9 + speed * 0.12;
export const tierAt = (d) => (d < 300 ? 0 : d < 1100 ? 1 : d < 2400 ? 2 : 3);

export const BIOMES = [
  {
    name: 'Emerald Jungle',
    sub: 'The canopy remembers every thief',
    decor: { trees: 1.0, palms: 0.25, bamboo: 0, ruins: 0.55, torchEvery: 34, mushrooms: 0, ferns: 1 },
    leaves: [0x2f6b22, 0x3f8a2c, 0x4f9a34, 0x2a5a1e, 0x5aa040],
    light: {
      skyTop: 0x2f78c8, skyHorizon: 0xcde6d6, skyBottom: 0x5f8a6a,
      fog: 0x9fc0a2, fogDensity: 0.0105,
      sun: 0xfff1d6, sunIntensity: 2.7, sunElev: 0.95, sunAzim: 0.6,
      hemiSky: 0xcfe7ff, hemiGround: 0x3d5a2a, hemiIntensity: 0.95,
      ambient: 0.15, torch: 0.6, canopy: 0x4a6a3a, mist: 0xe6f2e6, mountains: 0x6f9a86,
      fireflies: 0, stars: 0, exposure: 1.0,
    },
  },
  {
    name: 'Sunset Ruins',
    sub: 'Gold light on broken gods',
    decor: { trees: 0.45, palms: 0.85, bamboo: 0, ruins: 1.25, torchEvery: 24, mushrooms: 0, ferns: 0.6 },
    leaves: [0x6b7a22, 0x8a7a2a, 0x9a6a20, 0x5a6a1e, 0xa0802a],
    light: {
      skyTop: 0x2c2f6e, skyHorizon: 0xff9a58, skyBottom: 0x9a5a4a,
      fog: 0xd88a68, fogDensity: 0.0115,
      sun: 0xffa860, sunIntensity: 2.4, sunElev: 0.22, sunAzim: 2.2,
      hemiSky: 0xffc8a0, hemiGround: 0x5a3a2a, hemiIntensity: 0.8,
      ambient: 0.15, torch: 1.0, canopy: 0x6a5a3a, mist: 0xffd0b0, mountains: 0x8a5a6a,
      fireflies: 0.2, stars: 0.1, exposure: 1.05,
    },
  },
  {
    name: 'Moonlit Temple',
    sub: 'Where the guardian never sleeps',
    decor: { trees: 0.9, palms: 0.2, bamboo: 0, ruins: 0.85, torchEvery: 13, mushrooms: 1, ferns: 0.8 },
    leaves: [0x1e3a3a, 0x24483a, 0x1a3a2e, 0x2a4a44, 0x1e4430],
    light: {
      skyTop: 0x03061a, skyHorizon: 0x1d3a66, skyBottom: 0x0a1428,
      fog: 0x13223e, fogDensity: 0.0135,
      sun: 0x9fb8ff, sunIntensity: 0.9, sunElev: 0.75, sunAzim: -0.8,
      hemiSky: 0x5a78c0, hemiGround: 0x101a20, hemiIntensity: 0.7,
      ambient: 0.12, torch: 2.2, canopy: 0x0f1e22, mist: 0x4a6aa0, mountains: 0x18284a,
      fireflies: 1, stars: 1, exposure: 1.15,
    },
  },
  {
    name: 'Bamboo Mists',
    sub: 'Ten thousand stalks, one way out',
    decor: { trees: 0.3, palms: 0, bamboo: 1.0, ruins: 0.5, torchEvery: 30, mushrooms: 0, ferns: 0.7 },
    leaves: [0x7a9a3a, 0x8aaa44, 0x6a8a30, 0x9aba50, 0x5a7a2a],
    light: {
      skyTop: 0x6f88a8, skyHorizon: 0xdde6ea, skyBottom: 0x9aa8a8,
      fog: 0xc4ced4, fogDensity: 0.017,
      sun: 0xfff6e8, sunIntensity: 1.9, sunElev: 0.7, sunAzim: 1.2,
      hemiSky: 0xe6eef6, hemiGround: 0x5a6a4a, hemiIntensity: 1.1,
      ambient: 0.2, torch: 0.6, canopy: 0x7a8a6a, mist: 0xf2f6f8, mountains: 0x9aaab6,
      fireflies: 0, stars: 0, exposure: 1.0,
    },
  },
];

export const biomeIndexAt = (d) => Math.floor(Math.max(0, d) / BIOME_LENGTH) % BIOMES.length;

export const POWERUPS = {
  magnet: { name: 'Banana Magnet', color: '#ff5a5a', base: 8, perLevel: 2, desc: 'Pulls nearby bananas to you.' },
  shield: { name: 'Jade Shield', color: '#5ad1ff', base: 10, perLevel: 2.5, desc: 'Absorbs one crash or fall.' },
  double: { name: 'Double Score', color: '#ffd84a', base: 10, perLevel: 2.5, desc: 'All points are doubled.' },
  boost: { name: 'Jungle Rush', color: '#b98bff', base: 4, perLevel: 1, desc: 'Blast forward, invincible, auto-turning.' },
};
export const UPGRADE_COSTS = [300, 750, 1500, 3000, 6000];
export const MAX_UPGRADE = 5;
