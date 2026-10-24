import { COLS, H, PAL, ROWS, STEP, TAU, TILE, W } from './constants';
import { MAPS, type MapDef, pathTiles, tileKey } from './maps';
import {
  ENEMIES, PERKS, PERK_DMG, PERK_LIVES, PERK_ORDER, PERK_RANGE, PERK_RATE, SALVAGE_RATE, SELL_RATE, TARGET_MODES,
  TOTAL_WAVES, TOWERS, TOWER_KEYS, TOWER_ORDER, TRAPS, TRAP_BOSS, TRAP_ORDER,
  buffDmg, buffRate, buildWave, hpScale, interest, isBoss, isTrap, isUnlocked, killGold, waveBonus,
  type Buildable, type EnemyType, type PerkType, type SpawnGroup, type TargetMode, type TowerLevel, type TowerType,
  type TrapType,
} from './data';
import {
  ENEMY_SPRITES, drawText, drawTowerSprite, drawTrapSprite, fillDisc, pixelCircle, plotLine, textWidth,
} from './sprites';
import { buildBackground } from './background';
import { sfx } from './audio';
import { addKills, loadAchievements, loadProgress, saveBest, saveProgress, unlockAchievement, type Snapshot } from './storage';
import { ENDLESS_GOAL, KILLS_GOAL, ROUND_CLEAR, type AchievementId } from './achievements';

export interface Tower {
  id: number;
  type: TowerType;
  tx: number;
  ty: number;
  x: number;
  y: number;
  level: number;
  cd: number;
  angle: number;
  mode: TargetMode;
  spent: number;
  recoil: number;
  pulse: number;
  kills: number;
  dmgDone: number;
  charge: number; // Lancer heat, 0..1
  lockId: number; // Lancer target, or the foe in The James's sights
  firing: number; // time left to draw a continuous beam
  jam: number; // seconds left shut down by the Eraser
}

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  dist: number;
  hp: number;
  maxHp: number;
  speed: number;
  armor: number;
  gold: number;
  dmg: number;
  slow: number;
  slowT: number;
  flash: number;
  anim: number;
  face: number;
  off: number;
  alive: boolean;
  w: number;
  h: number;
  burn: number; // damage per second
  burnT: number;
  burnSrc?: Tower;
  stunT: number;
  kb: number; // knockback still to apply, in pixels
  kbGuard: number; // distance to walk past before Quake can knock back or stun again
  abilT: number; // countdown to the next heal, blink or jam pulse
  corrode: number; // extra damage taken while corroded
  corrodeT: number;
}

interface Bullet { kind: 'bullet'; x: number; y: number; tx: number; ty: number; target: Enemy; dmg: number; speed: number; src: Tower; dead?: boolean }
// A Blight shell carries acid and splashes it instead of exploding.
interface Shell {
  kind: 'shell'; sx: number; sy: number; tx: number; ty: number; t: number; dur: number; dmg: number; splash: number; src: Tower;
  acid?: number; acidDur?: number; dead?: boolean;
}
type Proj = Bullet | Shell;
interface Mine { x: number; y: number; sx: number; sy: number; t: number; dur: number; dmg: number; splash: number; src: Tower; dead?: boolean }
// A Ripper saw rolls back up the road from d to end, cutting each foe once.
interface Saw { d: number; end: number; x: number; y: number; dmg: number; cut: Set<number>; src: Tower; dead?: boolean }
interface Snipe { x0: number; y0: number; x1: number; y1: number; life: number; max: number; hue: number }
// A placeable on a road tile. d is its distance along the path; cut holds the foes it has already worked on.
interface Trap { type: TrapType; tx: number; ty: number; x: number; y: number; d: number; uses: number; cd: number; cut: Set<number>; dead?: boolean }
interface Strike { x: number; y: number; t: number; dur: number; dmg: number; splash: number; src: Tower; dead?: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; grav: number }
interface Ring { x: number; y: number; r0: number; r1: number; life: number; max: number; color: string }
interface Beam { x0: number; y0: number; x1: number; y1: number; life: number; max: number }
interface Arc { pts: { x: number; y: number }[]; life: number; max: number }
interface Floater { x: number; y: number; text: string; life: number; max: number; color: string }

export type GameStatus = 'playing' | 'won' | 'lost';
export interface Banner { id: number; text: string; sub?: string; danger?: boolean }

let uid = 0;
// Ground a foe must gain past its last Quake hit before the next slam can push it back again.
const KNOCK_MARGIN = 8;
const SAW_SPEED = 120;
// Seconds between an Orbital locking on and the strike landing.
const STRIKE_DELAY = 0.7;
// Seconds Auto waits before sending the next wave, so there is always time to build.
const AUTO_DELAY = 2.5;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
// The James is the one thing in the game drawn in full colour.
const hsl = (h: number, l = 60) => `hsl(${Math.round(((h % 360) + 360) % 360)} 100% ${l}%)`;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

function turnToward(a: number, b: number, max: number) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + Math.max(-max, Math.min(max, d));
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export class Game {
  readonly map: MapDef;
  readonly pathSet = new Set<number>();
  readonly portal: { x: number; y: number; tx: number; ty: number };
  private pts: { x: number; y: number }[];
  private cum: number[] = [0];
  private totalLen = 0;
  private bg: HTMLCanvasElement;
  private decals: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;

  towers: Tower[] = [];
  enemies: Enemy[] = [];
  private projs: Proj[] = [];
  private mines: Mine[] = [];
  private saws: Saw[] = [];
  private strikes: Strike[] = [];
  private traps: Trap[] = [];
  readonly perks = new Set<PerkType>();
  private snipes: Snipe[] = [];
  private flashT = 0;
  private buffs = new Map<number, number>();
  private spotCache = new Map<number, { range: number; spots: number[] }>();
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private beams: Beam[] = [];
  private arcs: Arc[] = [];
  private floaters: Floater[] = [];

  gold: number;
  lives: number;
  maxLives: number;
  readonly round: number;
  wave = 0;
  waveActive = false;
  status: GameStatus = 'playing';
  speed = 1;
  paused = false;
  autoWave = false;
  endless = false;
  kills = 0;
  placing: Buildable | null = null;
  selectedId: number | null = null;
  banner: Banner | null = null;
  // The boss that reached the portal, if that is how the run ended.
  killedBy: EnemyType | null = null;
  // Achievements unlocked this game and not yet dismissed, oldest first.
  awards: { id: AchievementId; key: number }[] = [];
  // Kills already added to the lifetime total, and placeables put down this round.
  private tallied = 0;
  private placed = 0;
  // Already earned, so checks on every kill never touch storage.
  private earned = new Set(loadAchievements().unlocked);
  version = 0;

  private hover: { tx: number; ty: number } | null = null;
  private mouse: { x: number; y: number } | null = null;
  // Enemy shown in the info card: hovered with a mouse, or tapped (pinned) on touch.
  inspectId = 0;
  private inspectPinned = false;
  private spawns: (SpawnGroup & { spawned: number })[] = [];
  private waveT = 0;
  private autoT = 0;
  private rt = 0;
  private shake = 0;
  private hurt = 0;
  private acc = 0;
  private lastT = 0;
  private raf = 0;
  private portalT = 0;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private listeners = new Set<() => void>();
  private dirty = true;
  private intro: [string, string] | null = null;
  // Furthest round reached in the campaign, kept in step with the save.
  private reached = 0;

  constructor(map: MapDef, snap?: Snapshot) {
    this.map = map;
    this.round = Math.max(0, MAPS.indexOf(map));
    this.gold = map.startGold;
    this.lives = this.maxLives = map.lives;
    this.pts = map.path.map(([x, y]) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }));
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.totalLen = this.cum[this.cum.length - 1];
    for (const k of pathTiles(map)) this.pathSet.add(k);
    const [ex, ey] = map.path[map.path.length - 1];
    this.portal = { tx: ex, ty: ey, x: ex * TILE + 8, y: ey * TILE + 8 };
    this.bg = buildBackground(map, this.pathSet);
    this.decals = document.createElement('canvas');
    this.decals.width = W;
    this.decals.height = H;
    this.dctx = this.decals.getContext('2d')!;
    this.reached = loadProgress().unlocked;
    if (snap?.mapId === map.id) this.restore(snap);
    else {
      // A fresh round starts with every perk carried over from the rounds before it.
      this.addPerks(loadProgress().perks ?? []);
      this.lives = this.maxLives;
      this.checkpoint();
    }
    this.tallied = this.kills;
    if (this.perks.size >= 3) this.award('perked_up');
    const fresh = [
      ...TOWER_ORDER.filter((t) => TOWERS[t].unlock === this.round).map((t) => TOWERS[t].name),
      ...TRAP_ORDER.filter((t) => TRAPS[t].unlock === this.round).map((t) => TRAPS[t].name),
      ...PERK_ORDER.filter((k) => PERKS[k].unlock === this.round).map((k) => PERKS[k].name),
    ];
    this.intro = [
      `Round ${this.round + 1}`,
      this.wave ? `Resuming after wave ${this.wave}` : this.round > 0 && fresh.length ? `Unlocked: ${fresh.join(', ')}` : map.name,
    ];
  }

  /* ------------------------------------------------------------ save data */

  private restore(s: Snapshot) {
    this.wave = s.wave;
    this.gold = s.gold;
    this.addPerks(s.perks ?? []);
    this.lives = Math.min(this.maxLives, s.lives);
    this.kills = s.kills;
    this.endless = s.endless;
    this.speed = s.speed;
    this.autoWave = s.autoWave;
    this.autoT = AUTO_DELAY;
    for (const o of s.towers) {
      const type = o.type as TowerType;
      if (!TOWERS[type] || !isUnlocked(type, this.round) || !this.canBuild(o.tx, o.ty)) continue;
      this.towers.push({
        id: ++uid, type, tx: o.tx, ty: o.ty, x: o.tx * TILE + 8, y: o.ty * TILE + 8,
        level: Math.min(3, Math.max(1, o.level)), cd: 0.2, angle: -Math.PI / 2,
        mode: TARGET_MODES.includes(o.mode as TargetMode) ? (o.mode as TargetMode) : 'first',
        spent: o.spent, recoil: 0, pulse: 0, kills: o.kills, dmgDone: o.dmgDone, charge: 0, lockId: 0, firing: 0, jam: 0,
      });
    }
    // Mines come back already landed; any whose Minelayer did not come back are dropped.
    for (const m of s.mines ?? []) {
      const src = this.towers.find((t) => t.type === 'mines' && t.tx === m.tx && t.ty === m.ty);
      if (!src) continue;
      this.mines.push({ x: m.x, y: m.y, sx: m.x, sy: m.y, t: 0.45, dur: 0.45, dmg: m.dmg, splash: m.splash, src });
    }
    for (const o of s.traps ?? []) {
      const type = o.type as TrapType;
      if (!TRAPS[type] || !this.trapUnlocked(type) || !this.canPlaceTrap(o.tx, o.ty)) continue;
      this.addTrap(type, o.tx, o.ty, Math.min(TRAPS[type].uses, o.uses));
    }
  }

  private addPerks(list: string[]) {
    for (const k of list) {
      if (k in PERKS && this.perkUnlocked(k as PerkType)) this.perks.add(k as PerkType);
    }
    if (this.perks.has('plating')) this.maxLives += PERK_LIVES;
  }

  // Saves the round between waves. Reloading mid-wave replays that wave from its start.
  private checkpoint() {
    if (this.waveActive || this.status !== 'playing') return;
    this.save(this.round, {
      mapId: this.map.id, wave: this.wave, gold: this.gold, lives: this.lives, kills: this.kills,
      endless: this.endless, speed: this.speed, autoWave: this.autoWave,
      towers: this.towers.map(({ type, tx, ty, level, mode, spent, kills, dmgDone }) => (
        { type, tx, ty, level, mode, spent, kills, dmgDone }
      )),
      mines: this.mines.map(({ x, y, dmg, splash, src }) => ({ tx: src.tx, ty: src.ty, x, y, dmg, splash })),
      traps: this.traps.map(({ type, tx, ty, uses }) => ({ type, tx, ty, uses })),
      perks: [...this.perks],
    });
  }

  // Saving never lowers the furthest round reached; see saveProgress.
  private save(round: number, snapshot?: Snapshot, perks?: string[]) {
    this.reached = Math.max(this.reached, saveProgress({ round, snapshot, perks }).unlocked);
  }

  get hasNextRound() {
    return this.round < MAPS.length - 1;
  }

  unlocked(type: TowerType) {
    return isUnlocked(type, this.round);
  }

  buffOf(t: Tower) {
    return this.buffs.get(t.id) ?? 0;
  }

  get nextRound() {
    return Math.min(this.round + 1, MAPS.length - 1);
  }

  // The next round is open: beaten this time, or on an earlier run of this round.
  get nextUnlocked() {
    return this.hasNextRound && this.reached > this.round;
  }

  /* ------------------------------------------------------------ lifecycle */

  attach(canvas: HTMLCanvasElement) {
    this.detach();
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKey);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    if (this.intro) {
      this.showBanner(...this.intro);
      this.intro = null;
    }
  }

  detach() {
    cancelAnimationFrame(this.raf);
    const c = this.canvas;
    if (c) {
      c.removeEventListener('pointermove', this.onMove);
      c.removeEventListener('pointerdown', this.onDown);
      c.removeEventListener('pointerleave', this.onLeave);
      c.removeEventListener('contextmenu', this.onContext);
    }
    window.removeEventListener('keydown', this.onKey);
    this.canvas = null;
    this.ctx = null;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private touch() {
    this.dirty = true;
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.25, (now - this.lastT) / 1000);
    this.lastT = now;
    this.rt += dt;
    if (!this.paused && this.status === 'playing') {
      this.acc += dt * this.speed;
      // Stop as soon as the game ends, so later steps in the same frame cannot rewrite the result.
      while (this.acc >= STEP && this.status === 'playing') {
        this.update(STEP);
        this.acc -= STEP;
      }
    } else {
      this.acc = 0;
    }
    this.trackHover();
    this.render();
    if (this.dirty) {
      this.dirty = false;
      this.version++;
      this.listeners.forEach((fn) => fn());
    }
  };

  /* --------------------------------------------------------------- public */

  get inspected(): Enemy | undefined {
    return this.inspectId ? this.enemies.find((e) => e.id === this.inspectId && e.alive) : undefined;
  }

  get selected(): Tower | undefined {
    return this.towers.find((t) => t.id === this.selectedId);
  }

  // A tower's stats as they stand this round, with Long Sight's reach added.
  level(t: Tower): TowerLevel {
    const L = TOWERS[t.type].levels[t.level - 1];
    return this.perks.has('scope') ? { ...L, range: L.range * PERK_RANGE } : L;
  }

  sellValue(t: Tower) {
    return Math.floor(t.spent * (this.perks.has('salvage') ? SALVAGE_RATE : SELL_RATE));
  }

  trapUnlocked(type: TrapType) {
    return TRAPS[type].unlock <= this.round;
  }

  perkUnlocked(k: PerkType) {
    return PERKS[k].unlock <= this.round;
  }

  buyPerk(k: PerkType) {
    if (this.status !== 'playing' || this.perks.has(k) || !this.perkUnlocked(k) || this.gold < PERKS[k].cost) {
      sfx.play('error');
      return;
    }
    this.gold -= PERKS[k].cost;
    this.perks.add(k);
    if (this.perks.size >= 3) this.award('perked_up');
    if (k === 'plating') {
      this.maxLives += PERK_LIVES;
      this.lives += PERK_LIVES;
      for (let i = 0; i < 24; i++) this.spark(this.portal.x, this.portal.y, pick([PAL.k6, PAL.k7, PAL.r3]), 70, 0);
    }
    for (const t of this.towers) this.rings.push({ x: t.x, y: t.y, r0: 2, r1: 10, life: 0.4, max: 0.4, color: PAL.k7 });
    this.showBanner(PERKS[k].name, PERKS[k].blurb);
    sfx.play('upgrade');
    this.checkpoint();
    this.touch();
  }

  remaining() {
    let n = this.enemies.length;
    for (const s of this.spawns) n += s.count - s.spawned;
    return n;
  }

  nextWavePreview(): { type: EnemyType; count: number }[] {
    const groups = this.waveActive ? this.spawns : buildWave(this.wave + 1, this.round);
    const counts = new Map<EnemyType, number>();
    for (const g of groups) counts.set(g.type, (counts.get(g.type) ?? 0) + g.count);
    return [...counts.entries()].map(([type, count]) => ({ type, count }));
  }

  toggleBuild(type: Buildable | null) {
    if (this.status !== 'playing') return;
    if (type && !(isTrap(type) ? this.trapUnlocked(type) : this.unlocked(type))) {
      sfx.play('error');
      return;
    }
    this.placing = this.placing === type ? null : type;
    if (this.placing) this.selectedId = null;
    sfx.play('click');
    this.touch();
  }

  select(id: number | null) {
    this.selectedId = id;
    this.touch();
  }

  sendWave() {
    if (this.waveActive || this.status !== 'playing') return;
    this.wave++;
    this.spawns = buildWave(this.wave, this.round).map((g) => ({ ...g, spawned: 0 }));
    this.waveT = 0;
    this.waveActive = true;
    const boss = this.spawns.some((s) => isBoss(s.type));
    if (this.spawns.some((s) => s.type === 'eraser')) this.showBanner('The Eraser', 'It has come for the Last Pixel', true);
    else this.showBanner(`Wave ${this.wave}`, boss ? 'A Colossus approaches' : undefined, boss);
    sfx.play(boss ? 'boss' : 'wave');
    this.touch();
  }

  togglePause() {
    if (this.status !== 'playing') return;
    this.paused = !this.paused;
    this.touch();
  }

  // For overlays that hold the game still, then hand back the pause state it had before.
  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.touch();
  }

  cycleSpeed() {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
    this.checkpoint();
    this.touch();
  }

  toggleAuto() {
    this.autoWave = !this.autoWave;
    this.autoT = 1.2;
    this.checkpoint();
    this.touch();
  }

  continueEndless() {
    this.endless = true;
    this.status = 'playing';
    this.autoT = AUTO_DELAY;
    this.showBanner('Endless', 'How long can you hold?', true);
    this.checkpoint();
    this.touch();
  }

  upgradeSelected() {
    const t = this.selected;
    if (!t || t.level >= 3 || this.status !== 'playing') return;
    const cost = TOWERS[t.type].levels[t.level].cost;
    if (this.gold < cost) {
      sfx.play('error');
      return;
    }
    this.gold -= cost;
    t.spent += cost;
    t.level++;
    if (t.level >= 3) this.award('maxed');
    this.rings.push({ x: t.x, y: t.y, r0: 3, r1: 12, life: 0.35, max: 0.35, color: PAL.k7 });
    for (let i = 0; i < 14; i++) this.spark(t.x, t.y, i % 3 === 0 ? PAL.r2 : PAL.k7, 40, -20);
    sfx.play('upgrade');
    this.checkpoint();
    this.touch();
  }

  sellSelected() {
    const t = this.selected;
    if (!t || this.status !== 'playing') return;
    const value = this.sellValue(t);
    this.gold += value;
    this.towers = this.towers.filter((o) => o !== t);
    this.mines = this.mines.filter((m) => m.src !== t);
    this.selectedId = null;
    this.floaters.push({ x: t.x, y: t.y - 6, text: `+${value}`, life: 0.9, max: 0.9, color: PAL.k6 });
    for (let i = 0; i < 16; i++) this.spark(t.x, t.y, pick([PAL.k3, PAL.k4, PAL.k5]), 50, 40);
    sfx.play('sell');
    this.checkpoint();
    this.touch();
  }

  setMode(mode: TargetMode) {
    const t = this.selected;
    if (!t || !TOWERS[t.type].aims) return;
    t.mode = mode;
    if (t.type === 'lancer') {
      // Re-aim under the new mode; keep the heat if it settles on the same foe.
      const next = this.pickTarget(t, this.level(t).range);
      if ((next?.id ?? 0) !== t.lockId) {
        t.lockId = next?.id ?? 0;
        t.charge = 0;
      }
    }
    sfx.play('click');
    this.checkpoint();
    this.touch();
  }

  // Unlocks an achievement the first time it is earned and queues its pop-up.
  private award(id: AchievementId) {
    if (this.earned.has(id)) return;
    this.earned.add(id);
    if (!unlockAchievement(id)) return;
    this.awards.push({ id, key: ++uid });
    sfx.play('achieve');
    this.touch();
  }

  dismissAward(key: number) {
    this.awards = this.awards.filter((a) => a.key !== key);
    this.touch();
  }

  // Adds this game's new kills to the lifetime total.
  private tallyKills() {
    const total = addKills(this.kills - this.tallied);
    this.tallied = this.kills;
    if (total >= KILLS_GOAL) this.award('thousand_cuts');
  }

  private showBanner(text: string, sub?: string, danger = false) {
    this.banner = { id: ++uid, text, sub, danger };
  }

  /* --------------------------------------------------------------- input */

  private toPoint(e: PointerEvent) {
    const r = this.canvas!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  private toTile(e: PointerEvent) {
    const { x, y } = this.toPoint(e);
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return null;
    return { tx, ty };
  }

  private enemyAt(x: number, y: number, pad: number) {
    let best: Enemy | undefined;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.x < 0) continue;
      if (Math.abs(e.x - x) > e.w / 2 + pad || Math.abs(e.y - y) > e.h / 2 + pad) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  private setInspect(id: number, pinned: boolean) {
    this.inspectPinned = pinned && id !== 0;
    if (id === this.inspectId) return;
    this.inspectId = id;
    this.touch();
  }

  // Keeps the hover target in sync as enemies walk under (or away from) a still cursor.
  private trackHover() {
    const cur = this.inspected;
    if (this.inspectId && !cur) this.setInspect(0, false);
    if (this.inspectPinned || !this.mouse) return;
    const { x, y } = this.mouse;
    if (cur && Math.hypot(cur.x - x, cur.y - y) <= Math.max(cur.w, cur.h) / 2 + 5) return;
    this.setInspect(this.enemyAt(x, y, 2)?.id ?? 0, false);
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.hover = this.toTile(e);
    this.mouse = this.toPoint(e);
  };

  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.hover = null;
    this.mouse = null;
    if (!this.inspectPinned) this.setInspect(0, false);
  };

  private onContext = (e: Event) => e.preventDefault();

  private onDown = (e: PointerEvent) => {
    sfx.unlock();
    const tile = this.toTile(e);
    if (!tile) return;
    if (e.button === 2) {
      this.placing = null;
      this.selectedId = null;
      this.touch();
      return;
    }
    // Middle and other buttons do nothing; only the primary button builds or selects.
    if (e.button !== 0 || this.status !== 'playing') return;
    // On touch, first tap previews the placement and the second tap confirms it.
    const same = this.hover && this.hover.tx === tile.tx && this.hover.ty === tile.ty;
    this.hover = tile;
    if (this.placing) {
      if (e.pointerType === 'touch' && !same) return;
      const built = isTrap(this.placing) ? this.tryPlace(this.placing, tile.tx, tile.ty) : this.tryBuild(this.placing, tile.tx, tile.ty);
      if (built && !e.shiftKey) this.placing = null;
      this.touch();
      return;
    }
    const t = this.towerAt(tile.tx, tile.ty);
    this.selectedId = t ? t.id : null;
    if (t) sfx.play('click');
    if (e.pointerType === 'touch') {
      // No hover on touch screens, so a tap pins the enemy card instead.
      const { x, y } = this.toPoint(e);
      const foe = t ? undefined : this.enemyAt(x, y, 5);
      this.setInspect(foe?.id ?? 0, true);
    }
    this.touch();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    // Leave browser shortcuts (Ctrl+S, Ctrl+F, Ctrl+0...) alone, and don't flicker build mode on key repeat.
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const k = e.key.toLowerCase();
    // Behind the Pause menu only the pause and escape keys still work.
    if (this.paused && k !== 'p' && k !== 'escape') return;
    const idx = TOWER_KEYS.indexOf(k);
    if (idx >= 0 && idx < TOWER_ORDER.length) {
      this.toggleBuild(TOWER_ORDER[idx]);
      return;
    }
    switch (k) {
      case 'escape':
        this.placing = null;
        this.selectedId = null;
        this.setInspect(0, false);
        this.touch();
        break;
      case ' ':
        e.preventDefault();
        sfx.unlock();
        this.sendWave();
        break;
      case 'p':
        this.togglePause();
        break;
      case 'f':
        this.cycleSpeed();
        break;
      case 'u':
        this.upgradeSelected();
        break;
      case 's':
      case 'delete':
        this.sellSelected();
        break;
      case 't': {
        const t = this.selected;
        if (t && TOWERS[t.type].aims) this.setMode(TARGET_MODES[(TARGET_MODES.indexOf(t.mode) + 1) % TARGET_MODES.length]);
        break;
      }
    }
  };

  private towerAt(tx: number, ty: number) {
    return this.towers.find((t) => t.tx === tx && t.ty === ty);
  }

  canBuild(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && !this.pathSet.has(tileKey(tx, ty)) && !this.towerAt(tx, ty);
  }

  private tryBuild(type: TowerType, tx: number, ty: number) {
    const cost = TOWERS[type].levels[0].cost;
    if (!this.unlocked(type) || !this.canBuild(tx, ty) || this.gold < cost) {
      sfx.play('error');
      return false;
    }
    this.gold -= cost;
    const t: Tower = {
      id: ++uid, type, tx, ty, x: tx * TILE + 8, y: ty * TILE + 8, level: 1, cd: 0.2,
      angle: -Math.PI / 2, mode: type === 'rail' || type === 'lancer' || type === 'orbital' ? 'strong' : 'first', spent: cost,
      recoil: 0, pulse: 0, kills: 0, dmgDone: 0, charge: 0, lockId: 0, firing: 0, jam: 0,
    };
    this.towers.push(t);
    if (this.towers.length >= 12) this.award('arsenal');
    if (type === 'james') this.award('legendary');
    for (let i = 0; i < 10; i++) this.spark(t.x + rand(-6, 6), t.y + 6, pick([PAL.k3, PAL.k4]), 20, -10);
    sfx.play('build');
    this.checkpoint();
    return true;
  }

  // Placeables go on any road tile except the portal's, one per tile.
  canPlaceTrap(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && this.pathSet.has(tileKey(tx, ty))
      && !(tx === this.portal.tx && ty === this.portal.ty) && !this.traps.some((p) => p.tx === tx && p.ty === ty);
  }

  private tryPlace(type: TrapType, tx: number, ty: number) {
    const cost = TRAPS[type].cost;
    if (!this.trapUnlocked(type) || !this.canPlaceTrap(tx, ty) || this.gold < cost) {
      sfx.play('error');
      return false;
    }
    this.gold -= cost;
    const p = this.addTrap(type, tx, ty, TRAPS[type].uses);
    if (++this.placed >= 10) this.award('road_works');
    for (let i = 0; i < 8; i++) this.spark(p.x + rand(-5, 5), p.y + 5, pick([PAL.k3, PAL.k4]), 20, -10);
    sfx.play('mine');
    this.checkpoint();
    return true;
  }

  private addTrap(type: TrapType, tx: number, ty: number, uses: number) {
    // Where the road passes through this tile, measured along the path.
    const on: number[] = [];
    for (let d = 0; d <= this.totalLen; d += 1) {
      const p = this.pointAt(d);
      if (Math.floor(p.x / TILE) === tx && Math.floor(p.y / TILE) === ty) on.push(d);
    }
    const d = on.length ? (on[0] + on[on.length - 1]) / 2 : 0;
    const trap: Trap = { type, tx, ty, x: tx * TILE + 8, y: ty * TILE + 8, d, uses, cd: 0, cut: new Set() };
    this.traps.push(trap);
    return trap;
  }

  /* -------------------------------------------------------------- update */

  private pointAt(d: number) {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1];
    const b = this.pts[i];
    const L = this.cum[i] - this.cum[i - 1];
    const t = Math.min(1, (d - this.cum[i - 1]) / L);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / L, dy: (b.y - a.y) / L };
  }

  private placeEnemy(e: Enemy) {
    const p = this.pointAt(e.dist);
    e.x = p.x - p.dy * e.off;
    e.y = p.y + p.dx * e.off;
    if (Math.abs(p.dx) > 0.1) e.face = p.dx < 0 ? -1 : 1;
  }

  private spawnEnemy(type: EnemyType, dist = 0, hpMul?: number) {
    const def = ENEMIES[type];
    const spr = ENEMY_SPRITES[type];
    const hp = Math.round(def.hp * (hpMul ?? hpScale(this.wave, this.map.difficulty)));
    const e: Enemy = {
      id: ++uid, type, x: -20, y: -20, dist: Math.max(0, dist), hp, maxHp: hp,
      speed: def.speed * rand(0.95, 1.05), armor: def.armor, gold: killGold(def.gold, this.wave),
      dmg: def.dmg, slow: 0, slowT: 0, flash: 0, anim: Math.random() * 2, face: 1,
      off: isBoss(type) ? 0 : rand(-2.5, 2.5), alive: true, w: spr.w, h: spr.h,
      burn: 0, burnT: 0, stunT: 0, kb: 0, kbGuard: 0, abilT: rand(1, 2.5), corrode: 0, corrodeT: 0,
    };
    this.placeEnemy(e);
    this.enemies.push(e);
  }

  private update(dt: number) {
    if (this.status !== 'playing') return;
    // spawning
    if (this.waveActive) {
      this.waveT += dt;
      let pending = false;
      for (const s of this.spawns) {
        while (s.spawned < s.count && this.waveT >= s.delay + s.spawned * s.interval) {
          this.spawnEnemy(s.type);
          s.spawned++;
        }
        if (s.spawned < s.count) pending = true;
      }
      if (!pending && this.enemies.length === 0) this.endWave();
    } else if (this.autoWave && this.status === 'playing') {
      this.autoT -= dt;
      if (this.autoT <= 0) this.sendWave();
    }

    // enemies
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.slowT > 0) e.slowT -= dt;
      let spd = e.speed * (e.slowT > 0 ? 1 - e.slow : 1);
      if (e.stunT > 0) {
        e.stunT -= dt;
        spd = 0;
      }
      if (e.kb > 0) {
        const k = Math.min(e.kb, 160 * dt);
        e.dist = Math.max(0, e.dist - k);
        e.kb -= k;
        spd = 0;
      }
      const wall = this.wallAhead(e, spd * dt);
      if (wall) {
        // Held at the Barricade, battering it down.
        e.dist = wall.d - 7;
        wall.uses -= e.dmg * dt;
        spd = 0;
        if (Math.random() < dt * 4) this.spark(wall.x, wall.y, pick([PAL.k4, PAL.k5]), 30, 40);
      }
      e.dist += spd * dt;
      if (e.burnT > 0) {
        e.burnT -= dt;
        if (Math.random() < dt * 14) {
          this.parts.push({ x: e.x + rand(-3, 3), y: e.y + rand(-3, 2), vx: rand(-4, 4), vy: -18, life: 0.3, max: 0.3, color: pick([PAL.r2, PAL.r3, PAL.k7]), grav: 0 });
        }
        this.hit(e, e.burn * dt, e.burnSrc, true);
        if (!e.alive) continue;
      }
      if (e.corrodeT > 0) {
        e.corrodeT -= dt;
        if (Math.random() < dt * 6) {
          this.parts.push({ x: e.x + rand(-3, 3), y: e.y + rand(-2, 2), vx: 0, vy: 4, life: 0.45, max: 0.45, color: pick([PAL.r1, PAL.r0, PAL.k4]), grav: 50 });
        }
      }
      e.anim += dt * spd * 0.22;
      e.flash = Math.max(0, e.flash - dt);
      if (e.dist >= this.totalLen) {
        this.leak(e);
        if (this.status !== 'playing') return;
        continue;
      }
      this.placeEnemy(e);
      this.enemyAbility(e, dt);
      if (isBoss(e.type) && Math.random() < dt * 20) {
        this.parts.push({ x: e.x + rand(-7, 7), y: e.y + rand(-6, 6), vx: 0, vy: -12, life: 0.5, max: 0.5, color: pick([PAL.r1, PAL.r2]), grav: 0 });
      }
      if (e.slowT > 0 && Math.random() < dt * 8) {
        this.parts.push({ x: e.x + rand(-4, 4), y: e.y + rand(-4, 4), vx: 0, vy: 6, life: 0.35, max: 0.35, color: PAL.k7, grav: 0 });
      }
    }

    // towers
    this.buffs.clear();
    for (const b of this.towers) {
      if (b.type !== 'beacon' || b.jam > 0) continue;
      const L = this.level(b);
      for (const t of this.towers) {
        if (t === b || t.type === 'beacon' || t.type === 'harvester') continue;
        if (Math.hypot(t.x - b.x, t.y - b.y) <= L.range) this.buffs.set(t.id, Math.max(this.buffOf(t), L.buff ?? 0));
      }
    }
    for (const t of this.towers) this.updateTower(t, dt);

    // mines
    for (const m of this.mines) {
      if (m.t < m.dur) {
        m.t += dt;
        continue;
      }
      for (const e of this.enemies) {
        if (e.alive && e.x >= 0 && Math.hypot(e.x - m.x, e.y - m.y) <= 4 + e.w * 0.3) {
          this.explode(m.x, m.y, m.dmg, m.splash, m.src);
          m.dead = true;
          break;
        }
      }
    }
    this.mines = this.mines.filter((m) => !m.dead);

    this.updateTraps(dt);

    // saws
    for (const s of this.saws) {
      s.d -= SAW_SPEED * dt;
      const p = this.pointAt(Math.max(0, s.d));
      s.x = p.x;
      s.y = p.y;
      for (const e of this.enemies) {
        if (!e.alive || e.x < 0 || s.cut.has(e.id) || Math.hypot(e.x - s.x, e.y - s.y) > 4 + e.w * 0.4) continue;
        s.cut.add(e.id);
        this.hit(e, s.dmg, s.src);
        for (let i = 0; i < 4; i++) this.spark(e.x, e.y, pick([PAL.k7, PAL.r2, PAL.r3]), 50, 20);
      }
      if (Math.random() < dt * 30) this.parts.push({ x: s.x + rand(-1, 1), y: s.y + 2, vx: rand(-10, 10), vy: rand(-14, -4), life: 0.25, max: 0.25, color: pick([PAL.k6, PAL.r3]), grav: 40 });
      if (s.d <= s.end) {
        s.dead = true;
        for (let i = 0; i < 6; i++) this.spark(s.x, s.y, pick([PAL.k4, PAL.k6]), 30, 30);
      }
    }
    this.saws = this.saws.filter((s) => !s.dead);

    // orbital strikes
    for (const s of this.strikes) {
      s.t += dt;
      if (s.t < s.dur) continue;
      this.beams.push({ x0: s.x, y0: -2, x1: s.x, y1: s.y, life: 0.35, max: 0.35 });
      this.explode(s.x, s.y, s.dmg, s.splash, s.src);
      this.shake = Math.max(this.shake, 3);
      sfx.play('strike');
      s.dead = true;
    }
    this.strikes = this.strikes.filter((s) => !s.dead);

    // projectiles
    for (const p of this.projs) {
      if (p.kind === 'bullet') {
        if (p.target.alive) {
          p.tx = p.target.x;
          p.ty = p.target.y;
        }
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const d = Math.hypot(dx, dy);
        const step = p.speed * dt;
        if (d <= step + 1) {
          if (p.target.alive) {
            this.hit(p.target, p.dmg, p.src);
            for (let i = 0; i < 3; i++) this.spark(p.tx, p.ty, pick([PAL.k7, PAL.r3]), 40, 0);
          }
          p.dead = true;
        } else {
          p.x += (dx / d) * step;
          p.y += (dy / d) * step;
        }
      } else {
        p.t += dt;
        if (p.t >= p.dur) {
          if (p.acid) this.splash(p);
          else this.explode(p.tx, p.ty, p.dmg, p.splash, p.src);
          p.dead = true;
        }
      }
    }
    this.projs = this.projs.filter((p) => !p.dead);
    this.enemies = this.enemies.filter((e) => e.alive);

    // portal ambience
    this.portalT -= dt;
    if (this.portalT <= 0) {
      this.portalT = 0.06;
      const a = rand(0, TAU);
      const r = rand(10, 14);
      this.parts.push({
        x: this.portal.x + Math.cos(a) * r, y: this.portal.y + Math.sin(a) * r,
        vx: -Math.cos(a) * r * 2.2, vy: -Math.sin(a) * r * 2.2, life: 0.4, max: 0.4,
        color: pick([PAL.r1, PAL.r2, PAL.r3]), grav: 0,
      });
    }

    // effects
    for (const p of this.parts) {
      p.vy += p.grav * dt;
      p.vx *= 1 - 2.5 * dt;
      p.vy *= 1 - 2.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const b of this.snipes) b.life -= dt;
    this.snipes = this.snipes.filter((b) => b.life > 0);
    this.flashT = Math.max(0, this.flashT - dt);
    for (const a of this.arcs) a.life -= dt;
    this.arcs = this.arcs.filter((a) => a.life > 0);
    for (const f of this.floaters) {
      f.life -= dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    this.shake = Math.max(0, this.shake - dt * 12);
    this.hurt = Math.max(0, this.hurt - dt);
  }

  // Mender heals, Glitch blinks forward, Eraser jams towers.
  private enemyAbility(e: Enemy, dt: number) {
    const def = ENEMIES[e.type];
    if (!def.heal && !def.blink && !def.jam) return;
    if (e.stunT > 0) return;
    e.abilT -= dt;
    if (e.abilT > 0) return;
    if (def.heal) {
      e.abilT = 2.5;
      for (const o of this.enemies) {
        if (!o.alive || o.hp >= o.maxHp || o.corrodeT > 0 || Math.hypot(o.x - e.x, o.y - e.y) > 24) continue;
        o.hp = Math.min(o.maxHp, o.hp + Math.min(o.maxHp * def.heal, def.healCap ?? Infinity));
        for (let i = 0; i < 3; i++) this.parts.push({ x: o.x + rand(-3, 3), y: o.y - 2, vx: 0, vy: -16, life: 0.5, max: 0.5, color: PAL.k7, grav: 0 });
      }
      this.rings.push({ x: e.x, y: e.y, r0: 2, r1: 24, life: 0.4, max: 0.4, color: PAL.k5 });
    } else if (def.blink) {
      e.abilT = 2.6;
      if (this.warded(e.x, e.y, e.w * 0.4)) {
        // A Warden's field holds it in place: the blink fizzles.
        for (let i = 0; i < 5; i++) this.spark(e.x, e.y, pick([PAL.k6, PAL.k4]), 25, 0);
        this.award('not_so_fast');
        return;
      }
      for (let i = 0; i < 6; i++) this.parts.push({ x: e.x + rand(-3, 3), y: e.y + rand(-3, 3), vx: 0, vy: 0, life: 0.25, max: 0.25, color: pick([PAL.r2, PAL.k6]), grav: 0 });
      e.dist = Math.min(this.totalLen - 1, e.dist + def.blink);
      this.placeEnemy(e);
    } else if (def.jam) {
      e.abilT = 5;
      let hit = false;
      for (const t of this.towers) {
        if (Math.hypot(t.x - e.x, t.y - e.y) > 48) continue;
        if (this.warded(t.x, t.y)) {
          this.rings.push({ x: t.x, y: t.y, r0: 5, r1: 10, life: 0.35, max: 0.35, color: PAL.k7 });
          continue;
        }
        t.jam = Math.max(t.jam, def.jam);
        hit = true;
      }
      this.rings.push({ x: e.x, y: e.y, r0: 6, r1: 48, life: 0.7, max: 0.7, color: PAL.k5 });
      if (hit) sfx.play('jam');
    }
  }

  private wallAhead(e: Enemy, step: number) {
    for (const p of this.traps) {
      if (p.type === 'barricade' && !p.dead && e.dist <= p.d - 7 && e.dist + step > p.d - 7 - 1e-6) return p;
    }
    return null;
  }

  private updateTraps(dt: number) {
    for (const p of this.traps) {
      const def = TRAPS[p.type];
      p.cd = Math.max(0, p.cd - dt);
      if (p.type !== 'barricade') {
        const on = this.enemies.filter((e) => e.alive && e.x >= 0 && Math.abs(e.dist - p.d) <= 7);
        if (p.type === 'shock') {
          if (p.cd <= 0 && on.length) {
            const pts = [{ x: p.x, y: p.y }];
            for (const e of on) {
              if (!isBoss(e.type)) e.stunT = Math.max(e.stunT, def.stun ?? 1);
              pts.push({ x: e.x, y: e.y }, { x: p.x, y: p.y });
            }
            this.arcs.push({ pts: jagged(pts), life: 0.2, max: 0.2 });
            this.rings.push({ x: p.x, y: p.y, r0: 2, r1: 12, life: 0.3, max: 0.3, color: PAL.r3 });
            p.uses--;
            p.cd = def.recharge ?? 4;
            sfx.play('zap');
          }
        } else {
          for (const e of on) {
            if (p.type === 'tar' && !ENEMIES[e.type].slowImmune) {
              e.slow = Math.max(e.slowT > 0 ? e.slow : 0, (def.slow ?? 0.5) * (isBoss(e.type) ? 0.5 : 1));
              e.slowT = Math.max(e.slowT, 0.5);
            }
            if (p.cut.has(e.id) || p.uses <= 0) continue;
            p.cut.add(e.id);
            p.uses--;
            if (p.type === 'spikes') {
              this.hit(e, e.maxHp * (def.cut ?? 0.1) * (isBoss(e.type) ? TRAP_BOSS : 1), undefined, true);
              for (let i = 0; i < 4; i++) this.spark(e.x, e.y + 2, pick([PAL.r1, PAL.r2, PAL.k6]), 40, 60);
            }
          }
        }
      }
      if (p.uses <= 0) {
        p.dead = true;
        for (let i = 0; i < 12; i++) this.spark(p.x, p.y, pick([PAL.k3, PAL.k4, PAL.k5]), 50, 50);
        sfx.play('sell');
      }
    }
    if (this.traps.some((p) => p.dead)) {
      this.traps = this.traps.filter((p) => !p.dead);
      this.touch();
    }
  }

  // Inside a Warden's field: towers cannot be jammed and foes cannot blink.
  private warded(x: number, y: number, pad = 0) {
    return this.towers.some((w) => w.type === 'warden' && Math.hypot(w.x - x, w.y - y) <= this.level(w).range + pad);
  }

  private inRange(t: Tower, e: Enemy, range: number) {
    const r = range + e.w * 0.4;
    const dx = e.x - t.x;
    const dy = e.y - t.y;
    return dx * dx + dy * dy <= r * r;
  }

  private pickTarget(t: Tower, range: number): Enemy | null {
    let best: Enemy | null = null;
    let score = -Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.x < 0 || !this.inRange(t, e, range)) continue;
      let s: number;
      switch (t.mode) {
        case 'first': s = e.dist; break;
        case 'last': s = -e.dist; break;
        case 'strong': s = e.hp * 1000 + e.dist; break;
        case 'close': s = -Math.hypot(e.x - t.x, e.y - t.y); break;
      }
      if (s > score) {
        score = s;
        best = e;
      }
    }
    return best;
  }

  private heldTarget(t: Tower, range: number): Enemy | null {
    if (!t.lockId) return null;
    const e = this.enemies.find((o) => o.id === t.lockId);
    return e && e.alive && e.x >= 0 && this.inRange(t, e, range) ? e : null;
  }

  private updateTower(t: Tower, dt: number) {
    const L = this.level(t);
    const buff = this.buffOf(t);
    const dmgMul = buffDmg(buff) * (this.perks.has('sharp') ? PERK_DMG : 1);
    const rate = L.rate / buffRate(buff) / (this.perks.has('overclock') ? PERK_RATE : 1);
    t.cd -= dt;
    t.recoil = Math.max(0, t.recoil - dt);
    t.pulse = Math.max(0, t.pulse - dt);
    t.firing = Math.max(0, t.firing - dt);
    if (t.jam > 0) {
      t.jam -= dt;
      t.charge = 0;
      return;
    }

    switch (t.type) {
      case 'harvester':
        return;
      case 'beacon':
        if (t.cd <= 0) {
          t.cd = 1.8;
          t.pulse = 0.3;
          this.rings.push({ x: t.x, y: t.y, r0: 3, r1: L.range, life: 0.7, max: 0.7, color: PAL.r1 });
        }
        return;
      case 'mines':
        this.layMine(t, L, dmgMul, rate);
        return;
      case 'quake':
        this.slam(t, L, dmgMul, rate);
        return;
      case 'ripper':
        this.throwSaw(t, L, dmgMul, rate);
        return;
      case 'warden':
        this.wardPulse(t, L, dmgMul, rate);
        return;
    }

    if (t.type === 'frost') {
      if (t.cd > 0) return;
      const hits = this.enemies.filter((e) => e.alive && e.x >= 0 && this.inRange(t, e, L.range));
      if (!hits.length) return;
      for (const e of hits) {
        if (!ENEMIES[e.type].slowImmune) {
          e.slow = Math.max(e.slowT > 0 ? e.slow : 0, L.slow ?? 0);
          e.slowT = Math.max(e.slowT, L.slowDur ?? 0);
        }
        this.hit(e, L.dmg * dmgMul, t);
      }
      this.rings.push({ x: t.x, y: t.y, r0: 4, r1: L.range, life: 0.4, max: 0.4, color: PAL.k6 });
      t.cd = rate;
      t.pulse = 0.25;
      sfx.play('frost');
      return;
    }

    if (t.type === 'james') this.jamesAura(t, rate);
    const range = TOWERS[t.type].global ? Infinity : L.range;
    // The Lancer holds its lock while the target lives and stays in range, so its heat can build.
    const target = (t.type === 'lancer' && this.heldTarget(t, range)) || this.pickTarget(t, range);
    if (t.type === 'lancer' && (target?.id ?? 0) !== t.lockId) {
      // Switching targets cools the lens back down.
      t.lockId = target?.id ?? 0;
      t.charge = 0;
    }
    if (!target) return;
    const want = Math.atan2(target.y - t.y, target.x - t.x);
    t.angle = turnToward(t.angle, want, 16 * dt);
    if (t.type === 'lancer') {
      t.charge = Math.min(1, t.charge + dt / (L.rampTime ?? 2));
      t.firing = 0.12;
    }
    if (t.type === 'james') {
      t.lockId = target.id;
      t.firing = 0.12;
    }
    if (t.cd > 0) return;
    t.cd = rate;
    if (t.type !== 'lancer' && t.type !== 'flamer') t.recoil = 0.09;
    const ca = Math.cos(want);
    const sa = Math.sin(want);

    switch (t.type) {
      case 'blaster': {
        const mx = t.x + ca * 9;
        const my = t.y + sa * 9;
        this.projs.push({ kind: 'bullet', x: mx, y: my, tx: target.x, ty: target.y, target, dmg: L.dmg * dmgMul, speed: 230, src: t });
        this.parts.push({ x: mx, y: my, vx: 0, vy: 0, life: 0.05, max: 0.05, color: PAL.k7, grav: 0 });
        sfx.play('shoot');
        break;
      }
      case 'mortar': {
        const mx = t.x + ca * 8;
        const my = t.y + sa * 8;
        const d = Math.hypot(target.x - t.x, target.y - t.y);
        const dur = Math.max(0.35, Math.min(0.9, d / 110));
        const spd = target.speed * (target.slowT > 0 ? 1 - target.slow : 1);
        const fp = this.pointAt(Math.min(this.totalLen, target.dist + spd * dur));
        this.projs.push({ kind: 'shell', sx: mx, sy: my, tx: fp.x, ty: fp.y, t: 0, dur, dmg: L.dmg * dmgMul, splash: L.splash ?? 16, src: t });
        for (let i = 0; i < 4; i++) this.spark(mx, my, pick([PAL.k4, PAL.k5]), 20, -10);
        sfx.play('thump');
        break;
      }
      case 'rail': {
        const x0 = t.x + ca * 11;
        const y0 = t.y + sa * 11;
        const x1 = t.x + ca * (L.range + 12);
        const y1 = t.y + sa * (L.range + 12);
        for (const e of this.enemies) {
          if (e.alive && distToSegment(e.x, e.y, x0, y0, x1, y1) <= Math.max(e.w, e.h) / 2 + 1) this.hit(e, L.dmg * dmgMul, t);
        }
        this.beams.push({ x0, y0, x1, y1, life: 0.3, max: 0.3 });
        for (let i = 0; i < 10; i++) {
          const k = Math.random();
          this.parts.push({
            x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, vx: rand(-8, 8), vy: rand(-8, 8),
            life: rand(0.2, 0.5), max: 0.5, color: pick([PAL.k6, PAL.r2]), grav: 0,
          });
        }
        this.shake = Math.max(this.shake, 1.2);
        sfx.play('rail');
        break;
      }
      case 'tesla': {
        const hitIds = new Set<number>();
        const pts = [{ x: t.x, y: t.y - 5 }];
        let cur: Enemy | null = target;
        let dmg = L.dmg * dmgMul;
        for (let i = 0; i < (L.chains ?? 1) && cur; i++) {
          pts.push({ x: cur.x, y: cur.y });
          hitIds.add(cur.id);
          this.hit(cur, dmg, t);
          dmg *= 0.85;
          let next: Enemy | null = null;
          let best = 40 * 40;
          for (const e of this.enemies) {
            if (!e.alive || hitIds.has(e.id)) continue;
            const d2 = (e.x - cur.x) ** 2 + (e.y - cur.y) ** 2;
            if (d2 < best) {
              best = d2;
              next = e;
            }
          }
          cur = next;
        }
        this.arcs.push({ pts: jagged(pts), life: 0.16, max: 0.16 });
        sfx.play('zap');
        break;
      }
      case 'flamer': {
        const cone = L.cone ?? 0.5;
        for (const e of this.enemies) {
          if (!e.alive || e.x < 0 || !this.inRange(t, e, L.range)) continue;
          let d = Math.atan2(e.y - t.y, e.x - t.x) - t.angle;
          while (d > Math.PI) d -= TAU;
          while (d < -Math.PI) d += TAU;
          if (Math.abs(d) > cone + 0.15) continue;
          this.hit(e, L.dmg * dmgMul, t);
          const burn = (L.burn ?? 0) * dmgMul;
          if (e.burnT <= 0 || burn >= e.burn) {
            e.burn = burn;
            e.burnSrc = t;
          }
          e.burnT = Math.max(e.burnT, L.burnDur ?? 2);
        }
        const nx = t.x + Math.cos(t.angle) * 8;
        const ny = t.y + Math.sin(t.angle) * 8;
        for (let i = 0; i < 5; i++) {
          const a = t.angle + rand(-cone, cone) * 0.85;
          const sp = rand(70, 120) * (L.range / 26);
          const life = rand(0.18, 0.32);
          this.parts.push({
            x: nx, y: ny, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life,
            color: pick([PAL.k7, PAL.r3, PAL.r3, PAL.r2, PAL.r2, PAL.r1]), grav: -20,
          });
        }
        sfx.play('flame');
        break;
      }
      case 'lancer': {
        const heat = 1 + ((L.ramp ?? 4) - 1) * t.charge;
        this.hit(target, L.dmg * heat * dmgMul, t, true);
        if (Math.random() < 0.35 + t.charge * 0.4) this.spark(target.x, target.y, pick([PAL.k7, PAL.r3, PAL.r2]), 30 + t.charge * 40, 0);
        sfx.play('laser');
        break;
      }
      case 'blight': {
        const mx = t.x + ca * 8;
        const my = t.y + sa * 8;
        const d = Math.hypot(target.x - t.x, target.y - t.y);
        const dur = Math.max(0.3, Math.min(0.7, d / 140));
        const spd = target.speed * (target.slowT > 0 ? 1 - target.slow : 1);
        const fp = this.pointAt(Math.min(this.totalLen, target.dist + spd * dur));
        this.projs.push({
          kind: 'shell', sx: mx, sy: my, tx: fp.x, ty: fp.y, t: 0, dur, dmg: L.dmg * dmgMul, splash: L.splash ?? 12, src: t,
          acid: L.corrode ?? 0.15, acidDur: L.corrodeDur ?? 3,
        });
        for (let i = 0; i < 3; i++) this.spark(mx, my, pick([PAL.r1, PAL.r2]), 20, -10);
        sfx.play('spit');
        break;
      }
      case 'james': {
        this.snipe(t, target, L.dmg * dmgMul, ca, sa);
        break;
      }
      case 'orbital': {
        // Lead the target so the strike lands where it will be, not where it was.
        const spd = target.stunT > 0 ? 0 : target.speed * (target.slowT > 0 ? 1 - target.slow : 1);
        const fp = this.pointAt(Math.min(this.totalLen, target.dist + spd * STRIKE_DELAY));
        this.strikes.push({ x: fp.x, y: fp.y, t: 0, dur: STRIKE_DELAY, dmg: L.dmg * dmgMul, splash: L.splash ?? 10, src: t });
        t.pulse = 0.4;
        sfx.play('lock');
        break;
      }
    }
  }

  // Rainbow sparks drift off The James at all times, and gather in as the next shot comes up.
  private jamesAura(t: Tower, rate: number) {
    if (Math.random() < 0.35) {
      this.parts.push({ x: t.x + rand(-6, 6), y: t.y + rand(-4, 6), vx: rand(-4, 4), vy: rand(-22, -10), life: 0.7, max: 0.7, color: hsl(this.rt * 160 + rand(0, 120)), grav: -6 });
    }
    if (t.cd > 0 && t.cd < rate * 0.35 && Math.random() < 0.6) {
      const a = rand(0, TAU);
      const r = rand(10, 16);
      this.parts.push({ x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r, vx: -Math.cos(a) * r * 3.5, vy: -Math.sin(a) * r * 3.5, life: 0.28, max: 0.28, color: hsl(a * 57 + this.rt * 300), grav: 0 });
    }
  }

  private snipe(t: Tower, target: Enemy, dmg: number, ca: number, sa: number) {
    const x0 = t.x + ca * 13;
    const y0 = t.y + sa * 13;
    const { x: x1, y: y1 } = target;
    const hue = this.rt * 240;
    this.hit(target, dmg, t, true);
    this.snipes.push({ x0, y0, x1, y1, life: 0.55, max: 0.55, hue });
    // Rainbow dust hangs along the shot's path.
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let i = 0; i < Math.min(60, len / 3); i++) {
      const k = Math.random();
      const life = rand(0.3, 0.8);
      this.parts.push({ x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, vx: rand(-10, 10), vy: rand(-10, 10), life, max: life, color: hsl(hue + k * 360), grav: -8 });
    }
    // Muzzle blast and a spent casing.
    this.rings.push({ x: x0, y: y0, r0: 1, r1: 9, life: 0.25, max: 0.25, color: PAL.k7 });
    for (let i = 0; i < 10; i++) this.spark(x0, y0, hsl(hue + i * 36), 70, 0);
    this.parts.push({ x: t.x, y: t.y - 2, vx: -sa * 40 + rand(-8, 8), vy: -50, life: 0.6, max: 0.6, color: PAL.k6, grav: 220 });
    // Impact: shockwave rings and a burst of every colour.
    this.rings.push({ x: x1, y: y1, r0: 2, r1: 20, life: 0.45, max: 0.45, color: hsl(hue) });
    this.rings.push({ x: x1, y: y1, r0: 1, r1: 11, life: 0.3, max: 0.3, color: PAL.k7 });
    const n = target.alive ? 24 : 48;
    for (let i = 0; i < n; i++) this.spark(x1, y1, hsl(hue + (i / n) * 360), target.alive ? 90 : 140, 20);
    if (!target.alive) this.rings.push({ x: x1, y: y1, r0: 4, r1: 32, life: 0.6, max: 0.6, color: hsl(hue + 180) });
    t.recoil = 0.25;
    t.pulse = 0.3;
    this.shake = Math.max(this.shake, 3.5);
    this.flashT = 0.07;
    sfx.play('snipe');
  }

  private throwSaw(t: Tower, L: TowerLevel, dmgMul: number, rate: number) {
    if (t.cd > 0) return;
    // The saw starts from the furthest stretch of road in range and rolls back toward the entry.
    const spots = this.roadSpots(t, L.range);
    if (!spots.length) return;
    const start = spots[spots.length - 1];
    const end = Math.max(0, start - (L.saw ?? 80));
    if (!this.enemies.some((e) => e.alive && e.x >= 0 && e.dist <= start + 4 && e.dist >= end)) return;
    const p = this.pointAt(start);
    this.saws.push({ d: start, end, x: p.x, y: p.y, dmg: L.dmg * dmgMul, cut: new Set(), src: t });
    for (let i = 0; i < 4; i++) this.spark(t.x, t.y - 2, pick([PAL.k6, PAL.r3]), 30, 0);
    t.cd = rate;
    t.recoil = Math.min(0.5, rate * 0.4);
    sfx.play('saw');
  }

  private wardPulse(t: Tower, L: TowerLevel, dmgMul: number, rate: number) {
    if (t.cd > 0) return;
    const hits = this.enemies.filter((e) => e.alive && e.x >= 0 && this.inRange(t, e, L.range));
    if (!hits.length) return;
    for (const e of hits) this.hit(e, L.dmg * dmgMul, t);
    this.rings.push({ x: t.x, y: t.y, r0: 4, r1: L.range, life: 0.5, max: 0.5, color: PAL.k5 });
    this.rings.push({ x: t.x, y: t.y, r0: L.range - 2, r1: L.range, life: 0.5, max: 0.5, color: PAL.r1 });
    t.cd = rate;
    t.pulse = 0.3;
    sfx.play('ward');
  }

  // Blight acid: light damage, then the foe corrodes. Corroding first lets the splash itself bite through armor.
  private splash(p: Shell) {
    for (const e of this.enemies) {
      if (!e.alive || Math.hypot(e.x - p.tx, e.y - p.ty) > p.splash + e.w * 0.3) continue;
      e.corrode = Math.max(e.corrodeT > 0 ? e.corrode : 0, p.acid ?? 0);
      e.corrodeT = Math.max(e.corrodeT, p.acidDur ?? 3);
      this.hit(e, p.dmg, p.src);
    }
    this.rings.push({ x: p.tx, y: p.ty, r0: 2, r1: p.splash, life: 0.35, max: 0.35, color: PAL.r1 });
    for (let i = 0; i < 12; i++) this.spark(p.tx, p.ty, pick([PAL.r0, PAL.r1, PAL.r2, PAL.k5]), 60, 60);
    this.dctx.fillStyle = PAL.r0;
    for (let i = 0; i < 8; i++) this.dctx.fillRect(Math.round(p.tx + rand(-5, 5)), Math.round(p.ty + rand(-4, 4)), 1, 1);
    sfx.play('acid');
  }

  // Every path distance a Minelayer or Ripper can reach, sampled every few pixels, in road order.
  private roadSpots(t: Tower, range: number) {
    const hit = this.spotCache.get(t.id);
    if (hit && hit.range === range) return hit.spots;
    const spots: number[] = [];
    for (let d = 0; d <= this.totalLen; d += 3) {
      const p = this.pointAt(d);
      if (p.x >= 2 && p.x <= W - 2 && Math.hypot(p.x - t.x, p.y - t.y) <= range) spots.push(d);
    }
    this.spotCache.set(t.id, { range, spots });
    return spots;
  }

  private layMine(t: Tower, L: TowerLevel, dmgMul: number, rate: number) {
    if (t.cd > 0) return;
    if (this.mines.filter((m) => m.src === t).length >= (L.mines ?? 3)) return;
    const free = this.roadSpots(t, L.range).map((d) => this.pointAt(d))
      .filter((p) => this.mines.every((m) => Math.hypot(m.x - p.x, m.y - p.y) > 9));
    if (!free.length) return;
    const p = pick(free);
    const x = Math.round(p.x + rand(-2, 2));
    const y = Math.round(p.y + rand(-2, 2));
    this.mines.push({ x, y, sx: t.x, sy: t.y - 3, t: 0, dur: 0.45, dmg: L.dmg * dmgMul, splash: L.splash ?? 14, src: t });
    t.cd = rate;
    t.recoil = 0.15;
    sfx.play('mine');
    // Mines laid between waves are kept too; during a wave this waits for the wave to end.
    this.checkpoint();
  }

  private slam(t: Tower, L: TowerLevel, dmgMul: number, rate: number) {
    if (t.cd > 0) return;
    const hits = this.enemies.filter((e) => e.alive && e.x >= 0 && this.inRange(t, e, L.range));
    if (!hits.length) return;
    for (const e of hits) {
      // A foe is never knocked back over the same ground twice: until it walks a little past
      // where the last slam caught it, further slams only hurt. Without this, slow or chilled
      // foes lose more ground per slam than they gain between slams and are pinned forever.
      if (e.dist >= e.kbGuard) {
        const boss = isBoss(e.type);
        e.kb = Math.max(e.kb, (L.knock ?? 0) * (boss ? 0.25 : 1));
        if (!boss) e.stunT = Math.max(e.stunT, L.stun ?? 0);
        e.kbGuard = e.dist + KNOCK_MARGIN;
      }
      this.hit(e, L.dmg * dmgMul, t);
    }
    this.rings.push({ x: t.x, y: t.y, r0: 5, r1: L.range, life: 0.45, max: 0.45, color: PAL.k7 });
    this.rings.push({ x: t.x, y: t.y, r0: 3, r1: L.range * 0.65, life: 0.6, max: 0.6, color: PAL.k4 });
    for (let i = 0; i < 24; i++) {
      const a = rand(0, TAU);
      const r = rand(6, L.range);
      this.parts.push({ x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r, vx: rand(-6, 6), vy: rand(-30, -10), life: 0.4, max: 0.4, color: pick([PAL.k3, PAL.k4, PAL.k5]), grav: 80 });
    }
    t.cd = rate;
    t.pulse = 0.35;
    this.shake = Math.max(this.shake, 2);
    sfx.play('quake');
  }

  // pierce ignores armor (burns and lasers); small steady ticks skip the hit flash.
  // Corroded foes take extra damage and lose their armor.
  private hit(e: Enemy, amount: number, src?: Tower, pierce = false) {
    if (!e.alive || amount <= 0) return;
    const sour = e.corrodeT > 0;
    if (sour) amount *= 1 + e.corrode;
    const dmg = pierce || sour ? amount : Math.max(amount * 0.25, amount - e.armor);
    const dealt = Math.min(dmg, e.hp);
    e.hp -= dmg;
    if (!pierce || amount >= 3) e.flash = 0.07;
    if (src) src.dmgDone += dealt;
    if (e.hp <= 0) this.kill(e, src);
  }

  private explode(x: number, y: number, dmg: number, splash: number, src: Tower) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= splash + e.w * 0.3) this.hit(e, dmg * (1 - 0.5 * Math.min(1, d / splash)), src);
    }
    this.rings.push({ x, y, r0: 2, r1: splash, life: 0.28, max: 0.28, color: PAL.k6 });
    for (let i = 0; i < 16; i++) this.spark(x, y, pick([PAL.k5, PAL.k6, PAL.k7, PAL.r2, PAL.r3]), 90, 30);
    this.dctx.fillStyle = PAL.k1;
    for (let i = 0; i < 10; i++) this.dctx.fillRect(Math.round(x + rand(-5, 5)), Math.round(y + rand(-5, 5)), 1, 1);
    this.shake = Math.max(this.shake, 1.5);
    sfx.play('boom');
  }

  private kill(e: Enemy, src?: Tower) {
    if (!e.alive) return;
    e.alive = false;
    this.kills++;
    let bounty = 0;
    for (const h of this.towers) {
      if (h.type === 'harvester' && this.inRange(h, e, this.level(h).range)) bounty = Math.max(bounty, this.level(h).bounty ?? 0);
    }
    const gold = e.gold + Math.round(e.gold * bounty);
    this.gold += gold;
    this.award('first_blood');
    if (e.type === 'boss') this.award('giant_slayer');
    if (this.gold >= 2000) this.award('hoarder');
    if (src) src.kills++;
    this.touch();
    const boss = isBoss(e.type);
    this.floaters.push({ x: e.x, y: e.y - e.h / 2 - 3, text: `+${gold}`, life: 0.8, max: 0.8, color: bounty ? PAL.k7 : PAL.k5 });
    for (let i = 0; i < (boss ? 70 : 12); i++) {
      this.spark(e.x, e.y, pick([PAL.r1, PAL.r2, PAL.r2, PAL.r3, PAL.k5, PAL.k0]), boss ? 120 : 60, 60);
    }
    const spread = boss ? 10 : 4;
    for (let i = 0; i < (boss ? 60 : 7); i++) {
      this.dctx.fillStyle = pick([PAL.r0, PAL.r1, PAL.r1, PAL.r2]);
      this.dctx.fillRect(Math.round(e.x + rand(-spread, spread)), Math.round(e.y + rand(-spread, spread)), 1, 1);
    }
    const splits = ENEMIES[e.type].splits;
    if (splits) {
      for (let i = 0; i < splits; i++) this.spawnEnemy('runner', e.dist - i * 6, hpScale(this.wave, this.map.difficulty) * 0.7);
    }
    if (boss) {
      this.shake = 8;
      this.rings.push({ x: e.x, y: e.y, r0: 4, r1: 40, life: 0.6, max: 0.6, color: PAL.r2 });
      this.showBanner(`${ENEMIES[e.type].name} slain`, `+${gold} gold`);
      sfx.play('bigdie');
    } else {
      sfx.play('die');
    }
  }

  // A boss that reaches the portal takes every life left with it.
  private leak(e: Enemy) {
    e.alive = false;
    const boss = isBoss(e.type);
    if (boss && this.lives > 0) this.killedBy = e.type;
    this.lives = boss ? 0 : Math.max(0, this.lives - e.dmg);
    this.shake = Math.max(this.shake, boss ? 10 : 3 + e.dmg * 0.5);
    this.hurt = 0.5;
    for (let i = 0; i < 20; i++) this.spark(this.portal.x, this.portal.y, pick([PAL.r2, PAL.r3, PAL.k7]), 80, 0);
    sfx.play('leak');
    if (this.lives <= 0 && this.status === 'playing') {
      this.status = 'lost';
      this.placing = null;
      saveBest(this.map.id, this.wave - 1);
      this.tallyKills();
      // Falling in endless still counts the round as beaten.
      if (this.endless) this.save(this.nextRound, undefined, [...this.perks]);
      else this.save(this.round);
      sfx.play('lose');
    }
    this.touch();
  }

  private endWave() {
    this.waveActive = false;
    this.spawns = [];
    let bonus = waveBonus(this.wave);
    if (this.perks.has('interest')) {
      const paid = interest(this.gold);
      bonus += paid;
      if (paid) this.floaters.push({ x: this.portal.x, y: this.portal.y - 14, text: `+${paid}`, life: 1.2, max: 1.2, color: PAL.k7 });
    }
    for (const h of this.towers) {
      const income = h.type === 'harvester' ? this.level(h).income ?? 0 : 0;
      if (!income) continue;
      bonus += income;
      h.pulse = 0.6;
      this.floaters.push({ x: h.x, y: h.y - 10, text: `+${income}`, life: 1.2, max: 1.2, color: PAL.k7 });
      for (let i = 0; i < 10; i++) this.spark(h.x, h.y - 4, pick([PAL.k6, PAL.k7, PAL.r3]), 40, 60);
    }
    if (bonus > waveBonus(this.wave)) sfx.play('coin');
    this.gold += bonus;
    saveBest(this.map.id, this.wave);
    this.tallyKills();
    if (this.gold >= 2000) this.award('hoarder');
    if (this.endless && this.wave >= ENDLESS_GOAL) this.award('endless_40');
    if (this.wave >= TOTAL_WAVES && !this.endless) {
      this.status = 'won';
      this.placing = null;
      const clear = ROUND_CLEAR[this.map.id];
      if (clear) this.award(clear);
      if (this.lives >= this.maxLives) this.award('flawless');
      if (this.lives === 1) this.award('by_a_thread');
      // Everything owned now goes on to the next round.
      this.save(this.nextRound, undefined, [...this.perks]);
      sfx.play('win');
    } else {
      this.showBanner('Wave clear', `+${bonus} gold`);
      sfx.play('clear');
      this.autoT = AUTO_DELAY;
      this.checkpoint();
    }
    this.touch();
  }

  private spark(x: number, y: number, color: string, speed: number, grav: number) {
    const a = rand(0, TAU);
    const s = rand(0.3, 1) * speed;
    const life = rand(0.25, 0.7);
    this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, grav });
  }

  /* -------------------------------------------------------------- render */

  private render() {
    const g = this.ctx;
    if (!g) return;
    g.save();
    if (this.shake > 0.2) g.translate(Math.round(rand(-this.shake, this.shake)), Math.round(rand(-this.shake, this.shake)));
    g.drawImage(this.bg, 0, 0);
    g.drawImage(this.decals, 0, 0);

    if (this.placing) {
      g.fillStyle = PAL.k2;
      for (let y = 1; y < ROWS; y++) for (let x = 1; x < COLS; x++) g.fillRect(x * TILE, y * TILE, 1, 1);
    }

    this.drawEntry(g);
    this.drawPortal(g);

    const sel = this.selected;
    if (sel) this.drawRange(g, sel.x, sel.y, this.level(sel).range, PAL.k6);

    this.drawMines(g);
    for (const p of this.traps) {
      drawTrapSprite(g, p.type, p.tx * TILE, p.ty * TILE, this.rt, p.uses / TRAPS[p.type].uses, p.cd <= 0);
    }

    for (const t of this.towers) {
      const pulse = t.type === 'lancer' ? (t.firing > 0 ? Math.max(0.01, t.charge) : 0) : t.pulse;
      drawTowerSprite(g, t.type, t.level, t.tx * TILE, t.ty * TILE, t.angle, t.recoil, this.rt, pulse);
      if (t.jam > 0) {
        // Erased: grey static over the tower.
        for (let i = 0; i < 18; i++) {
          g.fillStyle = pick([PAL.k2, PAL.k4, PAL.k6]);
          g.fillRect(t.tx * TILE + 1 + Math.floor(Math.random() * 14), t.ty * TILE + 1 + Math.floor(Math.random() * 14), 1 + (i % 2), 1);
        }
      } else if (this.buffOf(t) > 0) {
        // Beacon boost: a small red chevron in the corner.
        g.fillStyle = Math.sin(this.rt * 6 + t.id) > -0.3 ? PAL.r2 : PAL.r1;
        g.fillRect(t.tx * TILE + 12, t.ty * TILE + 2, 2, 1);
        g.fillRect(t.tx * TILE + 13, t.ty * TILE + 3, 1, 1);
      }
    }
    if (sel) this.drawBrackets(g, sel.tx, sel.ty, PAL.k7);

    const sorted = [...this.enemies].sort((a, b) => a.y - b.y);
    for (const e of sorted) this.drawEnemy(g, e);
    const ins = this.inspected;
    if (ins) {
      const x0 = Math.round(ins.x - ins.w / 2) - 2;
      const y0 = Math.round(ins.y - ins.h / 2) - 2;
      const x1 = x0 + ins.w + 3;
      const y1 = y0 + ins.h + 3;
      g.fillStyle = PAL.r3;
      for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
        g.fillRect(x, y, 1, 1);
        g.fillRect(x + dx, y, 1, 1);
        g.fillRect(x, y + dy, 1, 1);
      }
    }

    for (const p of this.projs) {
      if (p.kind === 'bullet') {
        g.fillStyle = PAL.k7;
        g.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
      } else {
        const k = p.t / p.dur;
        const x = p.sx + (p.tx - p.sx) * k;
        const y = p.sy + (p.ty - p.sy) * k;
        const lift = Math.sin(Math.PI * k) * 14;
        g.fillStyle = PAL.k1;
        g.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
        g.fillStyle = p.acid ? PAL.r1 : PAL.k6;
        g.fillRect(Math.round(x) - 1, Math.round(y - lift) - 1, 3, 3);
        g.fillStyle = p.acid ? PAL.r3 : PAL.r2;
        g.fillRect(Math.round(x), Math.round(y - lift), 1, 1);
      }
    }

    this.drawSaws(g);
    this.drawStrikes(g);

    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      g.globalAlpha = Math.max(0, 1 - k);
      g.fillStyle = r.color;
      pixelCircle(g, r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k)));
    }
    g.globalAlpha = 1;

    for (const b of this.beams) {
      const k = 1 - b.life / b.max;
      if (k < 0.25) {
        g.fillStyle = PAL.k7;
        plotLine(g, b.x0, b.y0, b.x1, b.y1, 3);
      } else {
        g.fillStyle = k < 0.6 ? PAL.r3 : PAL.r1;
        plotLine(g, b.x0, b.y0, b.x1, b.y1, 1);
      }
    }

    for (const t of this.towers) {
      if (t.type !== 'lancer' || t.firing <= 0) continue;
      const e = this.enemies.find((o) => o.id === t.lockId && o.alive);
      if (!e) continue;
      const x0 = t.x + Math.cos(t.angle) * 12;
      const y0 = t.y + Math.sin(t.angle) * 12;
      const width = t.charge > 0.75 ? 3 : t.charge > 0.35 ? 2 : 1;
      if (width > 1) {
        g.fillStyle = t.charge > 0.75 ? PAL.r2 : PAL.r1;
        plotLine(g, x0, y0, e.x, e.y, width);
      }
      g.fillStyle = t.charge > 0.75 || Math.random() < 0.3 ? PAL.k7 : PAL.r3;
      plotLine(g, x0, y0, e.x, e.y, 1);
    }

    this.drawSnipes(g);

    for (const a of this.arcs) {
      g.fillStyle = Math.random() < 0.5 ? PAL.k7 : PAL.r3;
      for (let i = 1; i < a.pts.length; i++) plotLine(g, a.pts[i - 1].x, a.pts[i - 1].y, a.pts[i].x, a.pts[i].y);
    }

    for (const p of this.parts) {
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }

    for (const f of this.floaters) {
      const k = 1 - f.life / f.max;
      drawText(g, f.text, f.x - textWidth(f.text) / 2, f.y - k * 8, f.color);
    }

    this.drawHover(g);
    g.restore();

    if (this.flashT > 0) {
      g.globalAlpha = this.flashT * 2;
      g.fillStyle = PAL.k7;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }

    if (this.hurt > 0) {
      g.globalAlpha = Math.min(1, this.hurt * 1.6);
      g.fillStyle = PAL.r2;
      g.fillRect(0, 0, W, 2);
      g.fillRect(0, H - 2, W, 2);
      g.fillRect(0, 0, 2, H);
      g.fillRect(W - 2, 0, 2, H);
      g.fillStyle = PAL.r1;
      g.fillRect(2, 2, W - 4, 1);
      g.fillRect(2, H - 3, W - 4, 1);
      g.fillRect(2, 2, 1, H - 4);
      g.fillRect(W - 3, 2, 1, H - 4);
      g.globalAlpha = 1;
    }
  }

  private drawMines(g: CanvasRenderingContext2D) {
    for (const m of this.mines) {
      if (m.t < m.dur) {
        const k = m.t / m.dur;
        const lift = Math.sin(Math.PI * k) * 10;
        g.fillStyle = PAL.k5;
        g.fillRect(Math.round(m.sx + (m.x - m.sx) * k) - 1, Math.round(m.sy + (m.y - m.sy) * k - lift) - 1, 2, 2);
        continue;
      }
      const x = Math.round(m.x);
      const y = Math.round(m.y);
      g.fillStyle = PAL.k1;
      g.fillRect(x - 2, y - 1, 5, 3);
      g.fillRect(x - 1, y - 2, 3, 5);
      g.fillStyle = PAL.k4;
      g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = Math.sin(this.rt * 8 + x) > 0 ? PAL.r3 : PAL.r1;
      g.fillRect(x, y, 1, 1);
    }
  }

  private drawSaws(g: CanvasRenderingContext2D) {
    for (const s of this.saws) {
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      g.fillStyle = PAL.k1;
      g.fillRect(x - 2, y + 3, 5, 1);
      g.fillStyle = PAL.k5;
      fillDisc(g, x, y, 2);
      g.fillStyle = PAL.k7;
      g.fillRect(x, y, 1, 1);
      const spin = -this.rt * 22;
      for (let i = 0; i < 6; i++) {
        const a = spin + (i / 6) * TAU;
        g.fillStyle = i % 2 ? PAL.k6 : PAL.r2;
        g.fillRect(Math.round(x + Math.cos(a) * 3.5), Math.round(y + Math.sin(a) * 3.5), 1, 1);
      }
    }
  }

  // Orbital lock: brackets close in on the spot until the strike lands.
  private drawStrikes(g: CanvasRenderingContext2D) {
    for (const s of this.strikes) {
      const k = s.t / s.dur;
      const r = Math.round(3 + s.splash * (1 - k));
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      g.fillStyle = Math.sin(this.rt * 30) > 0 ? PAL.r3 : PAL.r2;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.fillRect(x + dx * r - (dx > 0 ? 2 : 0), y + dy * r, 3, 1);
        g.fillRect(x + dx * r, y + dy * r - (dy > 0 ? 2 : 0), 1, 3);
      }
      g.fillRect(x, y, 1, 1);
      g.globalAlpha = 0.25 + k * 0.5;
      g.fillStyle = PAL.r1;
      g.fillRect(x, 0, 1, y - r);
      g.globalAlpha = 1;
    }
  }

  private drawSnipes(g: CanvasRenderingContext2D) {
    // Laser sights: a thin dotted line from every James to the foe it is tracking.
    for (const t of this.towers) {
      if (t.type !== 'james' || t.firing <= 0) continue;
      const e = this.enemies.find((o) => o.id === t.lockId && o.alive);
      if (!e) continue;
      const x0 = t.x + Math.cos(t.angle) * 13;
      const y0 = t.y + Math.sin(t.angle) * 13;
      const n = Math.floor(Math.hypot(e.x - x0, e.y - y0) / 4);
      g.globalAlpha = 0.55;
      for (let i = 0; i <= n; i++) {
        if ((i + Math.floor(this.rt * 20)) % 3 === 0) continue;
        g.fillStyle = hsl(this.rt * 200 - i * 12);
        g.fillRect(Math.round(x0 + ((e.x - x0) * i) / n), Math.round(y0 + ((e.y - y0) * i) / n), 1, 1);
      }
      g.globalAlpha = 1;
      g.fillStyle = hsl(this.rt * 200);
      const ex = Math.round(e.x);
      const ey = Math.round(e.y);
      g.fillRect(ex - 4, ey, 2, 1);
      g.fillRect(ex + 3, ey, 2, 1);
      g.fillRect(ex, ey - 4, 1, 2);
      g.fillRect(ex, ey + 3, 1, 2);
    }
    // The shot: a white-hot core inside a band of shifting colour that thins as it fades.
    for (const b of this.snipes) {
      const k = 1 - b.life / b.max;
      const hue = b.hue + k * 500;
      if (k < 0.5) {
        g.fillStyle = hsl(hue, 55);
        plotLine(g, b.x0, b.y0, b.x1, b.y1, k < 0.15 ? 5 : 3);
      }
      g.globalAlpha = 1 - k;
      g.fillStyle = k < 0.3 ? PAL.k7 : hsl(hue + 120, 70);
      plotLine(g, b.x0, b.y0, b.x1, b.y1, 1);
      g.globalAlpha = 1;
    }
  }

  private drawRange(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    // Map-wide towers have no circle to draw.
    if (r <= 0) return;
    g.globalAlpha = 0.07;
    g.fillStyle = color;
    fillDisc(g, x, y, Math.round(r));
    g.globalAlpha = 0.8;
    pixelCircle(g, x, y, r, true);
    g.globalAlpha = 1;
  }

  private drawBrackets(g: CanvasRenderingContext2D, tx: number, ty: number, color: string) {
    const x = tx * TILE;
    const y = ty * TILE;
    g.fillStyle = color;
    const L = 4;
    g.fillRect(x - 1, y - 1, L, 1); g.fillRect(x - 1, y - 1, 1, L);
    g.fillRect(x + 17 - L, y - 1, L, 1); g.fillRect(x + 16, y - 1, 1, L);
    g.fillRect(x - 1, y + 16, L, 1); g.fillRect(x - 1, y + 17 - L, 1, L);
    g.fillRect(x + 17 - L, y + 16, L, 1); g.fillRect(x + 16, y + 17 - L, 1, L);
  }

  private drawHover(g: CanvasRenderingContext2D) {
    const h = this.hover;
    if (!h || this.status !== 'playing') return;
    if (this.placing && isTrap(this.placing)) {
      const ok = this.canPlaceTrap(h.tx, h.ty) && this.gold >= TRAPS[this.placing].cost;
      g.globalAlpha = ok ? 0.8 : 0.35;
      drawTrapSprite(g, this.placing, h.tx * TILE, h.ty * TILE, this.rt);
      g.globalAlpha = 1;
      this.drawBrackets(g, h.tx, h.ty, ok ? PAL.k7 : PAL.r2);
    } else if (this.placing) {
      const ok = this.canBuild(h.tx, h.ty) && this.gold >= TOWERS[this.placing].levels[0].cost;
      const cx = h.tx * TILE + 8;
      const cy = h.ty * TILE + 8;
      this.drawRange(g, cx, cy, TOWERS[this.placing].levels[0].range, ok ? PAL.k6 : PAL.r2);
      g.globalAlpha = ok ? 0.75 : 0.35;
      drawTowerSprite(g, this.placing, 1, h.tx * TILE, h.ty * TILE, -Math.PI / 2, 0, this.rt);
      g.globalAlpha = 1;
      this.drawBrackets(g, h.tx, h.ty, ok ? PAL.k7 : PAL.r2);
      if (!ok) {
        g.fillStyle = PAL.r2;
        plotLine(g, h.tx * TILE + 4, h.ty * TILE + 4, h.tx * TILE + 11, h.ty * TILE + 11, 1);
        plotLine(g, h.tx * TILE + 11, h.ty * TILE + 4, h.tx * TILE + 4, h.ty * TILE + 11, 1);
      }
    } else if (this.towerAt(h.tx, h.ty) && this.towerAt(h.tx, h.ty)!.id !== this.selectedId) {
      this.drawBrackets(g, h.tx, h.ty, PAL.k5);
    }
  }

  private drawEnemy(g: CanvasRenderingContext2D, e: Enemy) {
    const spr = ENEMY_SPRITES[e.type];
    const frame = Math.floor(e.anim) % 2;
    const x = Math.round(e.x - spr.w / 2);
    const y = Math.round(e.y - spr.h / 2);
    if (x + spr.w < 0) return;
    // shadow
    g.fillStyle = PAL.k1;
    g.fillRect(x + 1, y + spr.h, spr.w - 2, 1);

    const wisp = e.type === 'wisp';
    if (wisp) g.globalAlpha = 0.55 + Math.sin(this.rt * 9 + e.id) * 0.25;
    const img = e.flash > 0 ? spr.flash[frame] : spr.frames[frame];
    if (e.face < 0) {
      g.save();
      g.translate(x + spr.w, y);
      g.scale(-1, 1);
      g.drawImage(img, 0, 0);
      if (e.slowT > 0 && e.flash <= 0) {
        g.globalAlpha = 0.35;
        g.drawImage(spr.flash[frame], 0, 0);
      }
      g.restore();
    } else {
      g.drawImage(img, x, y);
      if (e.slowT > 0 && e.flash <= 0) {
        g.globalAlpha = 0.35;
        g.drawImage(spr.flash[frame], x, y);
      }
    }
    g.globalAlpha = 1;

    if (e.stunT > 0) {
      // Two stars circling above a stunned foe.
      g.fillStyle = PAL.k7;
      for (let i = 0; i < 2; i++) {
        const a = this.rt * 9 + i * Math.PI;
        g.fillRect(Math.round(e.x + Math.cos(a) * 4), Math.round(y - 2 + Math.sin(a) * 1.5), 1, 1);
      }
    }

    if (e.hp < e.maxHp) {
      const bw = Math.max(6, spr.w);
      const bx = Math.round(e.x - bw / 2);
      const by = y - 3;
      g.fillStyle = PAL.k0;
      g.fillRect(bx - 1, by - 1, bw + 2, 3);
      g.fillStyle = PAL.k3;
      g.fillRect(bx, by, bw, 1);
      g.fillStyle = isBoss(e.type) ? PAL.r3 : PAL.r2;
      g.fillRect(bx, by, Math.max(1, Math.round((bw * e.hp) / e.maxHp)), 1);
    }
  }

  private drawEntry(g: CanvasRenderingContext2D) {
    const y0 = this.pts[0].y - 8;
    for (let y = 1; y < 15; y++) {
      const w = 1 + Math.floor((Math.sin(this.rt * 6 + y * 1.7) + 1) * 1.6);
      g.fillStyle = y % 3 === 0 ? PAL.r2 : PAL.r1;
      g.fillRect(0, y0 + y, w, 1);
    }
  }

  private drawPortal(g: CanvasRenderingContext2D) {
    const { x, y } = this.portal;
    const t = this.rt;
    const danger = this.lives / this.maxLives < 0.34;
    if (danger && Math.sin(t * 18) > 0.7) return;
    g.globalAlpha = 0.18 + Math.sin(t * 2) * 0.06;
    g.fillStyle = PAL.r1;
    fillDisc(g, x, y, 10);
    g.globalAlpha = 1;
    g.fillStyle = PAL.r0;
    fillDisc(g, x, y, 5);
    const ring = (r: number, n: number, dir: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const v = (Math.sin(a * 3 + t * speed * dir) + 1) / 2;
        g.fillStyle = v > 0.75 ? PAL.r3 : v > 0.35 ? PAL.r2 : PAL.r1;
        g.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1);
      }
    };
    ring(6.5, 44, 1, 4);
    ring(3.5, 24, -1, 6);
    g.fillStyle = Math.sin(t * 7) > 0 ? PAL.k7 : PAL.r3;
    g.fillRect(x - 1, y - 1, 2, 2);
  }
}

function jagged(pts: { x: number; y: number }[]) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.floor(d / 5));
    const nx = -(b.y - a.y) / (d || 1);
    const ny = (b.x - a.x) / (d || 1);
    for (let k = 1; k < n; k++) {
      const j = rand(-2.5, 2.5);
      out.push({ x: a.x + ((b.x - a.x) * k) / n + nx * j, y: a.y + ((b.y - a.y) * k) / n + ny * j });
    }
    out.push(b);
  }
  return out;
}
