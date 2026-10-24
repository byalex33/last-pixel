export type TowerType =
  | 'blaster' | 'mortar' | 'frost' | 'rail' | 'tesla'
  | 'flamer' | 'mines' | 'harvester' | 'beacon' | 'lancer' | 'quake'
  | 'ripper' | 'blight' | 'warden' | 'orbital' | 'james';
export type EnemyType =
  | 'crawler' | 'runner' | 'brute' | 'armor' | 'splitter' | 'wisp' | 'boss'
  | 'mender' | 'glitch' | 'eraser';
export type TargetMode = 'first' | 'last' | 'strong' | 'close';

export const TARGET_MODES: TargetMode[] = ['first', 'last', 'strong', 'close'];

export interface TowerLevel {
  cost: number;
  dmg: number;
  range: number; // pixels
  rate: number; // seconds between attacks
  splash?: number;
  slow?: number; // 0..1 fraction of speed removed
  slowDur?: number;
  chains?: number;
  cone?: number; // half angle in radians
  burn?: number; // damage per second, ignores armor
  burnDur?: number;
  ramp?: number; // damage multiplier reached at full charge
  rampTime?: number;
  mines?: number; // most mines on the field at once
  knock?: number; // pixels pushed back along the path
  stun?: number;
  buff?: number; // damage bonus given to nearby towers
  income?: number; // gold paid at the end of each wave
  bounty?: number; // extra kill gold in range
  saw?: number; // pixels a saw rolls back up the road
  corrode?: number; // extra damage taken while corroded; corroded foes also lose their armor and cannot be healed
  corrodeDur?: number;
}

export interface TowerDef {
  name: string;
  blurb: string;
  unlock: number; // round index that unlocks it
  aims: boolean; // has targeting modes
  global?: boolean; // reaches the whole map
  legendary?: boolean; // drawn in full colour, the only thing in the game that is
  levels: TowerLevel[];
}

export const TOWER_ORDER: TowerType[] = [
  'blaster', 'mortar', 'frost', 'rail', 'tesla',
  'flamer', 'mines', 'harvester',
  'beacon', 'lancer', 'quake',
  'ripper', 'blight',
  'warden', 'orbital', 'james',
];

export const TOWER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', 'q', 'w', 'e', 'r', 'j'];

export const isUnlocked = (type: TowerType, round: number) => TOWERS[type].unlock <= round;

// Damage and fire-rate multipliers a Beacon's buff gives.
export const buffDmg = (b: number) => 1 + b;
export const buffRate = (b: number) => 1 + b / 2;

export const TOWERS: Record<TowerType, TowerDef> = {
  blaster: {
    name: 'Blaster',
    blurb: 'Rapid single-target shots. Weak against armor.',
    unlock: 0,
    aims: true,
    levels: [
      { cost: 50, dmg: 5, range: 42, rate: 0.45 },
      { cost: 65, dmg: 9, range: 46, rate: 0.38 },
      { cost: 120, dmg: 15, range: 52, rate: 0.3 },
    ],
  },
  mortar: {
    name: 'Mortar',
    blurb: 'Lobs shells that damage everything in a blast radius.',
    unlock: 0,
    aims: true,
    levels: [
      { cost: 90, dmg: 16, range: 44, rate: 1.4, splash: 18 },
      { cost: 100, dmg: 28, range: 48, rate: 1.3, splash: 21 },
      { cost: 175, dmg: 46, range: 54, rate: 1.15, splash: 25 },
    ],
  },
  frost: {
    name: 'Frost',
    blurb: 'Pulses cold that slows every foe in range.',
    unlock: 0,
    aims: false,
    levels: [
      { cost: 70, dmg: 1, range: 30, rate: 1.0, slow: 0.4, slowDur: 1.4 },
      { cost: 75, dmg: 2, range: 34, rate: 0.9, slow: 0.5, slowDur: 1.6 },
      { cost: 125, dmg: 4, range: 40, rate: 0.8, slow: 0.6, slowDur: 1.8 },
    ],
  },
  rail: {
    name: 'Railgun',
    blurb: 'Long range beam that pierces every foe in a line.',
    unlock: 0,
    aims: true,
    levels: [
      { cost: 140, dmg: 55, range: 90, rate: 2.2 },
      { cost: 135, dmg: 95, range: 100, rate: 2.0 },
      { cost: 225, dmg: 170, range: 115, rate: 1.8 },
    ],
  },
  tesla: {
    name: 'Tesla',
    blurb: 'Lightning that arcs between nearby foes.',
    unlock: 0,
    aims: true,
    levels: [
      { cost: 150, dmg: 10, range: 40, rate: 0.9, chains: 3 },
      { cost: 145, dmg: 16, range: 44, rate: 0.8, chains: 4 },
      { cost: 225, dmg: 26, range: 48, rate: 0.7, chains: 6 },
    ],
  },
  flamer: {
    name: 'Flamer',
    blurb: 'Short cone of fire. Burning ignores armor.',
    unlock: 1,
    aims: true,
    levels: [
      { cost: 85, dmg: 1, range: 26, rate: 0.15, cone: 0.45, burn: 4, burnDur: 2 },
      { cost: 80, dmg: 1.5, range: 29, rate: 0.14, cone: 0.5, burn: 7, burnDur: 2.5 },
      { cost: 150, dmg: 2, range: 33, rate: 0.12, cone: 0.55, burn: 12, burnDur: 3 },
    ],
  },
  mines: {
    name: 'Minelayer',
    blurb: 'Seeds the nearby road with mines that blow on contact.',
    unlock: 1,
    aims: false,
    levels: [
      { cost: 100, dmg: 30, range: 36, rate: 2.5, splash: 14, mines: 3 },
      { cost: 95, dmg: 55, range: 40, rate: 2.1, splash: 16, mines: 4 },
      { cost: 170, dmg: 95, range: 46, rate: 1.7, splash: 18, mines: 5 },
    ],
  },
  harvester: {
    name: 'Harvester',
    blurb: 'No attack. Pays gold each wave and boosts kill gold nearby.',
    unlock: 1,
    aims: false,
    levels: [
      { cost: 120, dmg: 0, range: 40, rate: 0, income: 15, bounty: 0.25 },
      { cost: 110, dmg: 0, range: 44, rate: 0, income: 25, bounty: 0.4 },
      { cost: 190, dmg: 0, range: 50, rate: 0, income: 40, bounty: 0.6 },
    ],
  },
  beacon: {
    name: 'Beacon',
    blurb: 'No attack. Boosts damage and fire rate of towers around it.',
    unlock: 2,
    aims: false,
    levels: [
      { cost: 110, dmg: 0, range: 24, rate: 0, buff: 0.15 },
      { cost: 110, dmg: 0, range: 24, rate: 0, buff: 0.25 },
      { cost: 180, dmg: 0, range: 36, rate: 0, buff: 0.35 },
    ],
  },
  lancer: {
    name: 'Lancer',
    blurb: 'Steady laser that heats up the longer it holds a target.',
    unlock: 2,
    aims: true,
    levels: [
      { cost: 160, dmg: 2, range: 50, rate: 0.1, ramp: 4, rampTime: 2.5 },
      { cost: 150, dmg: 3.2, range: 56, rate: 0.1, ramp: 4, rampTime: 2.2 },
      { cost: 240, dmg: 5, range: 62, rate: 0.1, ramp: 4.5, rampTime: 1.9 },
    ],
  },
  quake: {
    name: 'Quake',
    blurb: 'Slams the ground, knocking foes back and stunning them.',
    unlock: 2,
    aims: false,
    levels: [
      { cost: 175, dmg: 8, range: 30, rate: 3.2, knock: 14, stun: 0.5 },
      { cost: 160, dmg: 14, range: 34, rate: 2.9, knock: 18, stun: 0.7 },
      { cost: 260, dmg: 24, range: 38, rate: 2.6, knock: 24, stun: 0.9 },
    ],
  },
  ripper: {
    name: 'Ripper',
    blurb: 'Hurls a sawblade back up the road that cuts every foe it passes.',
    unlock: 3,
    aims: false,
    levels: [
      { cost: 150, dmg: 14, range: 34, rate: 2.0, saw: 80 },
      { cost: 140, dmg: 24, range: 38, rate: 1.8, saw: 100 },
      { cost: 230, dmg: 40, range: 42, rate: 1.5, saw: 130 },
    ],
  },
  blight: {
    name: 'Blight',
    blurb: 'Lobs acid that eats armor. Corroded foes take more damage and cannot be healed.',
    unlock: 3,
    aims: true,
    levels: [
      { cost: 130, dmg: 6, range: 44, rate: 1.6, splash: 12, corrode: 0.15, corrodeDur: 3 },
      { cost: 120, dmg: 10, range: 48, rate: 1.4, splash: 14, corrode: 0.25, corrodeDur: 3.5 },
      { cost: 200, dmg: 16, range: 54, rate: 1.2, splash: 16, corrode: 0.35, corrodeDur: 4 },
    ],
  },
  warden: {
    name: 'Warden',
    blurb: 'Pulses a field that stops foes blinking and shields towers from being jammed.',
    unlock: 4,
    aims: false,
    levels: [
      { cost: 160, dmg: 6, range: 32, rate: 1.2 },
      { cost: 150, dmg: 11, range: 36, rate: 1.1 },
      { cost: 240, dmg: 18, range: 42, rate: 1.0 },
    ],
  },
  orbital: {
    name: 'Orbital',
    blurb: 'Calls a strike from orbit on a foe anywhere on the map.',
    unlock: 4,
    aims: true,
    global: true,
    levels: [
      { cost: 220, dmg: 120, range: 0, rate: 4.0, splash: 10 },
      { cost: 200, dmg: 210, range: 0, rate: 3.6, splash: 12 },
      { cost: 320, dmg: 380, range: 0, rate: 3.2, splash: 14 },
    ],
  },
  // A sniper with no range limit. Its rounds ignore armor.
  james: {
    name: 'The James',
    blurb: 'Added by my best pal, James',
    unlock: 4,
    aims: true,
    global: true,
    legendary: true,
    levels: [
      { cost: 300, dmg: 260, range: 0, rate: 2.5 },
      { cost: 280, dmg: 450, range: 0, rate: 2.2 },
      { cost: 420, dmg: 800, range: 0, rate: 1.9 },
    ],
  },
};

/* ------------------------------------------------------------ placeables */

// Placeables go on the road itself, where towers cannot, and wear out with use.
export type TrapType = 'spikes' | 'tar' | 'barricade' | 'shock';

export interface TrapDef {
  name: string;
  blurb: string;
  unlock: number;
  cost: number;
  uses: number; // foes it works on before it wears out; for a Barricade, how much battering it takes
  cut?: number; // fraction of a foe's max health taken by each pass
  slow?: number;
  stun?: number;
  recharge?: number;
}

export const TRAP_ORDER: TrapType[] = ['spikes', 'tar', 'barricade', 'shock'];

export const TRAPS: Record<TrapType, TrapDef> = {
  spikes: {
    name: 'Spikes',
    blurb: 'Cut every foe that walks over them. Wear out after 25 foes.',
    unlock: 0,
    cost: 40,
    uses: 25,
    cut: 0.1,
  },
  tar: {
    name: 'Tar Pit',
    blurb: 'Foes wading through are slowed to a crawl. Dries up after 40 foes.',
    unlock: 1,
    cost: 35,
    uses: 40,
    slow: 0.55,
  },
  barricade: {
    name: 'Barricade',
    blurb: 'Blocks the road. The horde has to smash through it before moving on.',
    unlock: 2,
    cost: 80,
    uses: 60,
  },
  shock: {
    name: 'Shock Trap',
    blurb: 'Stuns every foe on it, then recharges. Burns out after 8 shocks.',
    unlock: 3,
    cost: 70,
    uses: 8,
    stun: 1.2,
    recharge: 4,
  },
};

// Bosses shrug off most of what a placeable does to them.
export const TRAP_BOSS = 0.2;

// Anything picked from the Build menu and put on the map.
export type Buildable = TowerType | TrapType;
export const isTrap = (b: Buildable): b is TrapType => b in TRAPS;

/* ---------------------------------------------------------------- perks */

// One-off upgrades bought for the rest of the round.
export type PerkType = 'sharp' | 'plating' | 'salvage' | 'interest' | 'overclock' | 'scope';

export interface PerkDef {
  name: string;
  blurb: string;
  unlock: number;
  cost: number;
}

export const PERK_ORDER: PerkType[] = ['sharp', 'plating', 'salvage', 'interest', 'overclock', 'scope'];

export const PERKS: Record<PerkType, PerkDef> = {
  sharp: { name: 'Hollow Points', blurb: 'Every tower deals 15% more damage.', unlock: 0, cost: 300 },
  plating: { name: 'Plating', blurb: 'The portal gains 5 lives, and 5 more maximum.', unlock: 0, cost: 200 },
  salvage: { name: 'Salvage', blurb: 'Towers sell back for 90% of what you spent, up from 70%.', unlock: 0, cost: 150 },
  interest: { name: 'Interest', blurb: 'Each wave cleared pays 10% of your unspent gold, up to 60.', unlock: 1, cost: 250 },
  overclock: { name: 'Overclock', blurb: 'Every tower attacks 15% faster.', unlock: 2, cost: 350 },
  scope: { name: 'Long Sight', blurb: 'Every tower reaches 15% further.', unlock: 3, cost: 300 },
};

export const PERK_DMG = 1.15;
export const PERK_RATE = 1.15;
export const PERK_RANGE = 1.15;
export const PERK_LIVES = 5;
export const SALVAGE_RATE = 0.9;
export const interest = (gold: number) => Math.min(60, Math.floor(gold * 0.1));

export interface EnemyDef {
  name: string;
  trait: string;
  desc: string;
  hp: number;
  speed: number; // px per second
  gold: number;
  dmg: number; // lives lost on leak
  armor: number; // flat reduction per hit
  slowImmune?: boolean;
  splits?: number;
  boss?: boolean; // resists knockback, cannot be stunned
  heal?: number; // fraction of max health restored to nearby foes each pulse
  healCap?: number; // most health one pulse restores to a single foe, so bosses and late Brutes cannot outheal towers
  blink?: number; // pixels skipped forward each blink
  jam?: number; // seconds nearby towers are shut down by each pulse
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  crawler: { name: 'Crawler', trait: 'Basic', desc: 'The bulk of the horde. Slow and steady.', hp: 22, speed: 20, gold: 4, dmg: 1, armor: 0 },
  runner: { name: 'Runner', trait: 'Fast, fragile', desc: 'Darts down the road. Dies to almost anything.', hp: 13, speed: 40, gold: 3, dmg: 1, armor: 0 },
  brute: { name: 'Brute', trait: 'Huge health', desc: 'A slow wall of flesh that soaks up damage.', hp: 110, speed: 12, gold: 12, dmg: 3, armor: 0 },
  armor: { name: 'Husk', trait: 'Armored', desc: 'A plated shell that shrugs off small hits.', hp: 60, speed: 16, gold: 9, dmg: 2, armor: 5 },
  splitter: { name: 'Splitter', trait: 'Splits into runners', desc: 'Bursts into three Runners when killed.', hp: 50, speed: 17, gold: 6, dmg: 2, armor: 0, splits: 3 },
  wisp: { name: 'Wisp', trait: 'Immune to slow', desc: 'A flickering spirit that cold cannot touch.', hp: 34, speed: 27, gold: 6, dmg: 1, armor: 0, slowImmune: true },
  boss: { name: 'Colossus', trait: 'Boss', desc: 'Arrives every 10 waves. Tough, armored and hits the portal hard.', hp: 650, speed: 9, gold: 120, dmg: 6, armor: 3, boss: true },
  mender: { name: 'Mender', trait: 'Heals the horde', desc: 'Stitches torn Static back together, up to 200 health a pulse. Kill it first, or corrode its patients.', hp: 45, speed: 15, gold: 9, dmg: 2, armor: 0, heal: 0.1, healCap: 200 },
  glitch: { name: 'Glitch', trait: 'Blinks ahead', desc: 'Skips frames, jumping forward through your lines.', hp: 32, speed: 22, gold: 8, dmg: 2, armor: 0, blink: 22 },
  eraser: { name: 'The Eraser', trait: 'Final boss', desc: 'What the Static saved for last. Everything it passes goes quiet.', hp: 2000, speed: 6, gold: 600, dmg: 20, armor: 6, boss: true, jam: 2.5 },
};

export const isBoss = (type: EnemyType) => !!ENEMIES[type].boss;

export const TOTAL_WAVES = 30;

export interface SpawnGroup {
  type: EnemyType;
  count: number;
  interval: number;
  delay: number;
}

// round is the campaign round index; later rounds bring new foes.
export function buildWave(n: number, round = 0): SpawnGroup[] {
  const groups: SpawnGroup[] = [];
  let t = 0;
  const add = (type: EnemyType, count: number, interval: number) => {
    groups.push({ type, count, interval, delay: t });
    t += count * interval * 0.6 + 1;
  };
  add('crawler', 5 + Math.floor(n * 1.2), Math.max(0.35, 1 - n * 0.02));
  if (n >= 3) add('runner', 3 + Math.floor(n * 0.9), 0.4);
  if (n >= 5 && n % 2 === 1) add('armor', 2 + Math.floor((n - 5) * 0.6), 1.1);
  if (n >= 7 && n % 3 !== 0) add('brute', 1 + Math.floor((n - 7) / 3), 2.2);
  if (n >= 9 && n % 2 === 0) add('splitter', 2 + Math.floor((n - 9) / 2), 1.3);
  if (n >= 12) add('wisp', 3 + Math.floor((n - 12) * 0.7), 0.6);
  if (round >= 3 && n >= 6) add('mender', 1 + Math.floor((n - 6) / 5), 2.4);
  if (round >= 4 && n >= 4) add('glitch', 2 + Math.floor((n - 4) * 0.5), 0.9);
  if (round >= 4 && n === TOTAL_WAVES) {
    // One Colossus escorts the Eraser. A pair of them broke through even a strong late-game defence.
    add('boss', 1, 6);
    add('eraser', 1, 1);
  } else if (n % 10 === 0) {
    add('boss', n / 10, 6);
  }
  return groups;
}

export function hpScale(n: number, difficulty: number) {
  const k = Math.max(0, n - 1);
  // By wave 30 the curve already climbs about 10% a wave, so Endless only adds a gentle 3% on top.
  const endless = n > TOTAL_WAVES ? Math.pow(1.03, n - TOTAL_WAVES) : 1;
  const late = k > 12 ? 0.08 * (k - 12) ** 2 : 0;
  return (1 + 0.16 * k + 0.012 * k * k + late) * difficulty * endless;
}

export const killGold = (base: number, wave: number) => Math.round(base * (1 + (wave - 1) * 0.005));
export const waveBonus = (n: number) => 15 + n * 2;
export const SELL_RATE = 0.7;
