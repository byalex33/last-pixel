export type TowerType =
  | 'blaster' | 'mortar' | 'frost' | 'rail' | 'tesla'
  | 'flamer' | 'mines' | 'harvester' | 'beacon' | 'lancer' | 'quake';
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
}

export interface TowerDef {
  name: string;
  blurb: string;
  unlock: number; // round index that unlocks it
  aims: boolean; // has targeting modes
  levels: TowerLevel[];
}

export const TOWER_ORDER: TowerType[] = [
  'blaster', 'mortar', 'frost', 'rail', 'tesla',
  'flamer', 'mines', 'harvester',
  'beacon', 'lancer', 'quake',
];

export const TOWER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];

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
};

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
  mender: { name: 'Mender', trait: 'Heals the horde', desc: 'Stitches torn Static back together, up to 200 health a pulse. Kill it first.', hp: 45, speed: 15, gold: 9, dmg: 2, armor: 0, heal: 0.1, healCap: 200 },
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
    add('boss', 2, 6);
    add('eraser', 1, 1);
  } else if (n % 10 === 0) {
    add('boss', n / 10, 6);
  }
  return groups;
}

export function hpScale(n: number, difficulty: number) {
  const k = Math.max(0, n - 1);
  const endless = n > TOTAL_WAVES ? Math.pow(1.07, n - TOTAL_WAVES) : 1;
  const late = k > 12 ? 0.08 * (k - 12) ** 2 : 0;
  return (1 + 0.16 * k + 0.012 * k * k + late) * difficulty * endless;
}

export const killGold = (base: number, wave: number) => Math.round(base * (1 + (wave - 1) * 0.005));
export const waveBonus = (n: number) => 15 + n * 2;
export const SELL_RATE = 0.7;
