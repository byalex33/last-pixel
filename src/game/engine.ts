import { COLS, H, PAL, ROWS, STEP, TAU, TILE, W } from './constants';
import { MAPS, type MapDef, pathTiles, tileKey } from './maps';
import {
  ENEMIES, SELL_RATE, TARGET_MODES, TOTAL_WAVES, TOWERS, TOWER_KEYS, TOWER_ORDER,
  buffDmg, buffRate, buildWave, hpScale, isBoss, isUnlocked, killGold, waveBonus,
  type EnemyType, type SpawnGroup, type TargetMode, type TowerLevel, type TowerType,
} from './data';
import {
  ENEMY_SPRITES, drawText, drawTowerSprite, fillDisc, pixelCircle, plotLine, textWidth,
} from './sprites';
import { buildBackground } from './background';
import { sfx } from './audio';
import { saveBest, saveProgress, type Snapshot } from './storage';

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
  lockId: number; // Lancer target
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
}

interface Bullet { kind: 'bullet'; x: number; y: number; tx: number; ty: number; target: Enemy; dmg: number; speed: number; src: Tower; dead?: boolean }
interface Shell { kind: 'shell'; sx: number; sy: number; tx: number; ty: number; t: number; dur: number; dmg: number; splash: number; src: Tower; dead?: boolean }
type Proj = Bullet | Shell;
interface Mine { x: number; y: number; sx: number; sy: number; t: number; dur: number; dmg: number; splash: number; src: Tower; dead?: boolean }
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
// Seconds Auto waits before sending the next wave, so there is always time to build.
const AUTO_DELAY = 2.5;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
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
  private buffs = new Map<number, number>();
  private spotCache = new Map<number, { range: number; spots: number[] }>();
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private beams: Beam[] = [];
  private arcs: Arc[] = [];
  private floaters: Floater[] = [];

  gold: number;
  lives: number;
  readonly maxLives: number;
  readonly round: number;
  wave = 0;
  waveActive = false;
  status: GameStatus = 'playing';
  speed = 1;
  paused = false;
  autoWave = false;
  endless = false;
  kills = 0;
  placing: TowerType | null = null;
  selectedId: number | null = null;
  banner: Banner | null = null;
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
    if (snap?.mapId === map.id) this.restore(snap);
    else this.checkpoint();
    const fresh = TOWER_ORDER.filter((t) => TOWERS[t].unlock === this.round).map((t) => TOWERS[t].name);
    this.intro = [
      `Round ${this.round + 1}`,
      this.wave ? `Resuming after wave ${this.wave}` : this.round > 0 && fresh.length ? `Unlocked: ${fresh.join(', ')}` : map.name,
    ];
  }

  /* ------------------------------------------------------------ save data */

  private restore(s: Snapshot) {
    this.wave = s.wave;
    this.gold = s.gold;
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
  }

  // Saves the round between waves. Reloading mid-wave replays that wave from its start.
  private checkpoint() {
    if (this.waveActive || this.status !== 'playing') return;
    saveProgress({
      round: this.round,
      snapshot: {
        mapId: this.map.id, wave: this.wave, gold: this.gold, lives: this.lives, kills: this.kills,
        endless: this.endless, speed: this.speed, autoWave: this.autoWave,
        towers: this.towers.map(({ type, tx, ty, level, mode, spent, kills, dmgDone }) => (
          { type, tx, ty, level, mode, spent, kills, dmgDone }
        )),
      },
    });
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

  level(t: Tower): TowerLevel {
    return TOWERS[t.type].levels[t.level - 1];
  }

  sellValue(t: Tower) {
    return Math.floor(t.spent * SELL_RATE);
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

  toggleBuild(type: TowerType | null) {
    if (this.status !== 'playing') return;
    if (type && !this.unlocked(type)) {
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
    if (this.status !== 'playing') return;
    // On touch, first tap previews the placement and the second tap confirms it.
    const same = this.hover && this.hover.tx === tile.tx && this.hover.ty === tile.ty;
    this.hover = tile;
    if (this.placing) {
      if (e.pointerType === 'touch' && !same) return;
      if (this.tryBuild(this.placing, tile.tx, tile.ty) && !e.shiftKey) this.placing = null;
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
    const k = e.key.toLowerCase();
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
      angle: -Math.PI / 2, mode: type === 'rail' || type === 'lancer' ? 'strong' : 'first', spent: cost,
      recoil: 0, pulse: 0, kills: 0, dmgDone: 0, charge: 0, lockId: 0, firing: 0, jam: 0,
    };
    this.towers.push(t);
    for (let i = 0; i < 10; i++) this.spark(t.x + rand(-6, 6), t.y + 6, pick([PAL.k3, PAL.k4]), 20, -10);
    sfx.play('build');
    this.checkpoint();
    return true;
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
      burn: 0, burnT: 0, stunT: 0, kb: 0, kbGuard: 0, abilT: rand(1, 2.5),
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
      e.dist += spd * dt;
      if (e.burnT > 0) {
        e.burnT -= dt;
        if (Math.random() < dt * 14) {
          this.parts.push({ x: e.x + rand(-3, 3), y: e.y + rand(-3, 2), vx: rand(-4, 4), vy: -18, life: 0.3, max: 0.3, color: pick([PAL.r2, PAL.r3, PAL.k7]), grav: 0 });
        }
        this.hit(e, e.burn * dt, e.burnSrc, true);
        if (!e.alive) continue;
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
          this.explode(p.tx, p.ty, p.dmg, p.splash, p.src);
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
        if (!o.alive || o.hp >= o.maxHp || Math.hypot(o.x - e.x, o.y - e.y) > 24) continue;
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * def.heal);
        for (let i = 0; i < 3; i++) this.parts.push({ x: o.x + rand(-3, 3), y: o.y - 2, vx: 0, vy: -16, life: 0.5, max: 0.5, color: PAL.k7, grav: 0 });
      }
      this.rings.push({ x: e.x, y: e.y, r0: 2, r1: 24, life: 0.4, max: 0.4, color: PAL.k5 });
    } else if (def.blink) {
      e.abilT = 2.6;
      for (let i = 0; i < 6; i++) this.parts.push({ x: e.x + rand(-3, 3), y: e.y + rand(-3, 3), vx: 0, vy: 0, life: 0.25, max: 0.25, color: pick([PAL.r2, PAL.k6]), grav: 0 });
      e.dist = Math.min(this.totalLen - 1, e.dist + def.blink);
      this.placeEnemy(e);
    } else if (def.jam) {
      e.abilT = 5;
      let hit = false;
      for (const t of this.towers) {
        if (Math.hypot(t.x - e.x, t.y - e.y) > 48) continue;
        t.jam = Math.max(t.jam, def.jam);
        hit = true;
      }
      this.rings.push({ x: e.x, y: e.y, r0: 6, r1: 48, life: 0.7, max: 0.7, color: PAL.k5 });
      if (hit) sfx.play('jam');
    }
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
    const dmgMul = buffDmg(buff);
    const rate = L.rate / buffRate(buff);
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

    // The Lancer holds its lock while the target lives and stays in range, so its heat can build.
    const target = (t.type === 'lancer' && this.heldTarget(t, L.range)) || this.pickTarget(t, L.range);
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
    }
  }

  // Every path distance a Minelayer can reach, sampled every few pixels.
  private mineSpots(t: Tower, range: number) {
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
    const free = this.mineSpots(t, L.range).map((d) => this.pointAt(d))
      .filter((p) => this.mines.every((m) => Math.hypot(m.x - p.x, m.y - p.y) > 9));
    if (!free.length) return;
    const p = pick(free);
    const x = Math.round(p.x + rand(-2, 2));
    const y = Math.round(p.y + rand(-2, 2));
    this.mines.push({ x, y, sx: t.x, sy: t.y - 3, t: 0, dur: 0.45, dmg: L.dmg * dmgMul, splash: L.splash ?? 14, src: t });
    t.cd = rate;
    t.recoil = 0.15;
    sfx.play('mine');
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
  private hit(e: Enemy, amount: number, src?: Tower, pierce = false) {
    if (!e.alive || amount <= 0) return;
    const dmg = pierce ? amount : Math.max(amount * 0.25, amount - e.armor);
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

  private leak(e: Enemy) {
    e.alive = false;
    this.lives = Math.max(0, this.lives - e.dmg);
    this.shake = Math.max(this.shake, 3 + e.dmg * 0.5);
    this.hurt = 0.5;
    for (let i = 0; i < 20; i++) this.spark(this.portal.x, this.portal.y, pick([PAL.r2, PAL.r3, PAL.k7]), 80, 0);
    sfx.play('leak');
    if (this.lives <= 0 && this.status === 'playing') {
      this.status = 'lost';
      this.placing = null;
      saveBest(this.map.id, this.wave - 1);
      // Falling in endless still counts the round as beaten.
      saveProgress({ round: this.endless ? this.nextRound : this.round });
      sfx.play('lose');
    }
    this.touch();
  }

  private endWave() {
    this.waveActive = false;
    this.spawns = [];
    let bonus = waveBonus(this.wave);
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
    if (this.wave >= TOTAL_WAVES && !this.endless) {
      this.status = 'won';
      this.placing = null;
      saveProgress({ round: this.nextRound });
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
        g.fillStyle = PAL.k6;
        g.fillRect(Math.round(x) - 1, Math.round(y - lift) - 1, 3, 3);
        g.fillStyle = PAL.r2;
        g.fillRect(Math.round(x), Math.round(y - lift), 1, 1);
      }
    }

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

  private drawRange(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
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
    if (this.placing) {
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
