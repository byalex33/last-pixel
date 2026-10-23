import { COLS, ROWS, STEP, TAU, TILE, W } from './constants.js';
import { MAPS, type MapDef, pathTiles, tileKey } from './maps.js';
import {
  ENEMIES, SELL_RATE, TARGET_MODES, TOTAL_WAVES, TOWERS, TOWER_ORDER,
  buffDmg, buffRate, buildWave, hpScale, isBoss, isUnlocked, killGold, waveBonus,
  type EnemyType, type SpawnGroup, type TargetMode, type TowerLevel, type TowerType,
} from './data.js';
import { ENEMY_SIZE } from './enemyArt.js';
import { datan2, dcos, dist, dsin } from './detmath.js';
import { Rng } from './rng.js';

/*
 * The rules of the game, with no canvas, sound, input or storage, so the exact same code runs
 * in the browser and on the server.
 *
 * A run is fully decided by its map, its seed and the player's commands, each stamped with the
 * simulation step it happened on. The browser records those commands while you play; the server
 * replays them here to verify a leaderboard score. Anything that can change the outcome must
 * therefore be deterministic: seeded randomness (this.rng), fixed steps, and the exactly rounded
 * maths in detmath.ts. Cosmetic effects are reported through emit() and never feed back in.
 *
 * Bump SIM_VERSION whenever a change alters how a run plays out, so runs recorded on an older
 * version are not replayed against the new rules.
 */
export const SIM_VERSION = 1;

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
export type Proj = Bullet | Shell;
export interface Mine { x: number; y: number; sx: number; sy: number; t: number; dur: number; dmg: number; splash: number; src: Tower; dead?: boolean }

export type GameStatus = 'playing' | 'won' | 'lost';

// What happened, for the browser to turn into particles, sounds and banners.
export type SimEvent =
  | { k: 'build'; t: Tower }
  | { k: 'upgrade'; t: Tower }
  | { k: 'sell'; t: Tower; value: number }
  | { k: 'wave'; boss: boolean; eraser: boolean }
  | { k: 'endless' }
  | { k: 'heal'; e: Enemy; healed: Enemy[] }
  | { k: 'blink'; e: Enemy }
  | { k: 'jam'; e: Enemy; hit: boolean }
  | { k: 'beacon'; t: Tower; range: number }
  | { k: 'frost'; t: Tower; range: number }
  | { k: 'shoot'; x: number; y: number }
  | { k: 'mortar'; x: number; y: number }
  | { k: 'rail'; x0: number; y0: number; x1: number; y1: number }
  | { k: 'tesla'; pts: { x: number; y: number }[] }
  | { k: 'flame'; t: Tower; range: number; cone: number }
  | { k: 'laser'; t: Tower; target: Enemy }
  | { k: 'mine'; t: Tower }
  | { k: 'slam'; t: Tower; range: number }
  | { k: 'bulletHit'; x: number; y: number }
  | { k: 'explode'; x: number; y: number; splash: number }
  | { k: 'kill'; e: Enemy; gold: number; bounty: number }
  | { k: 'leak'; e: Enemy }
  | { k: 'waveEnd'; bonus: number; earners: Tower[] }
  | { k: 'end'; status: 'won' | 'lost' };

/* ------------------------------------------------------------- commands */

export type Command =
  | { c: 'build'; type: TowerType; tx: number; ty: number }
  | { c: 'upgrade'; tx: number; ty: number }
  | { c: 'sell'; tx: number; ty: number }
  | { c: 'mode'; tx: number; ty: number; mode: TargetMode }
  | { c: 'wave' }
  | { c: 'auto'; on: boolean }
  | { c: 'endless' };

// A recorded command, kept compact for saving and uploading: [step, code, ...args].
export type LogEntry = number[];

const CODES = ['build', 'upgrade', 'sell', 'mode', 'wave', 'auto', 'endless'] as const;

export function encode(tick: number, cmd: Command): LogEntry {
  const code = CODES.indexOf(cmd.c);
  switch (cmd.c) {
    case 'build': return [tick, code, TOWER_ORDER.indexOf(cmd.type), cmd.tx, cmd.ty];
    case 'upgrade':
    case 'sell': return [tick, code, cmd.tx, cmd.ty];
    case 'mode': return [tick, code, cmd.tx, cmd.ty, TARGET_MODES.indexOf(cmd.mode)];
    case 'auto': return [tick, code, cmd.on ? 1 : 0];
    default: return [tick, code];
  }
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

// Turns a recorded entry back into a command, or null if it is malformed.
export function decode(entry: unknown): Command | null {
  if (!Array.isArray(entry) || !entry.every(isInt)) return null;
  const [, code, a, b, c] = entry as number[];
  const tile = (n: number) => entry.length === n && a >= 0 && a < COLS && b >= 0 && b < ROWS;
  switch (CODES[code]) {
    case 'build': {
      const type = TOWER_ORDER[a];
      return type && entry.length === 5 && b >= 0 && b < COLS && c >= 0 && c < ROWS ? { c: 'build', type, tx: b, ty: c } : null;
    }
    case 'upgrade': return tile(4) ? { c: 'upgrade', tx: a, ty: b } : null;
    case 'sell': return tile(4) ? { c: 'sell', tx: a, ty: b } : null;
    case 'mode': return tile(5) && TARGET_MODES[c] ? { c: 'mode', tx: a, ty: b, mode: TARGET_MODES[c] } : null;
    case 'wave': return entry.length === 2 ? { c: 'wave' } : null;
    case 'auto': return entry.length === 3 && (a === 0 || a === 1) ? { c: 'auto', on: a === 1 } : null;
    case 'endless': return entry.length === 2 ? { c: 'endless' } : null;
    default: return null;
  }
}

/* --------------------------------------------------------------- helpers */

// Ground a foe must gain past its last Quake hit before the next slam can push it back again.
const KNOCK_MARGIN = 8;
// Seconds Auto waits before sending the next wave, so there is always time to build.
export const AUTO_DELAY = 2.5;

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
  return dist(px - (ax + dx * t), py - (ay + dy * t));
}

/* ------------------------------------------------------------------- sim */

export class Sim {
  readonly map: MapDef;
  readonly round: number;
  readonly pathSet = new Set<number>();
  readonly portal: { x: number; y: number; tx: number; ty: number };
  protected pts: { x: number; y: number }[];
  protected cum: number[] = [0];
  protected totalLen = 0;

  rng!: Rng;
  // Simulation steps taken so far. Commands are stamped with it.
  tick = 0;
  // Every command that changed the game, in order. This is what gets uploaded for verification.
  log: LogEntry[] = [];
  // Events are only built while this is on: the browser turns it on, replays leave it off.
  protected live = false;
  private uid = 0;

  towers: Tower[] = [];
  enemies: Enemy[] = [];
  protected projs: Proj[] = [];
  protected mines: Mine[] = [];
  private buffs = new Map<number, number>();
  private spotCache = new Map<number, { range: number; spots: number[] }>();

  gold = 0;
  lives = 0;
  readonly maxLives: number;
  wave = 0;
  waveActive = false;
  status: GameStatus = 'playing';
  autoWave = false;
  endless = false;
  kills = 0;

  protected spawns: (SpawnGroup & { spawned: number })[] = [];
  protected waveT = 0;
  protected autoT = 0;

  constructor(map: MapDef, seed: number) {
    this.map = map;
    this.round = Math.max(0, MAPS.indexOf(map));
    this.maxLives = map.lives;
    this.reset(seed);
    this.pts = map.path.map(([x, y]) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }));
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      this.cum.push(this.cum[i - 1] + dist(b.x - a.x, b.y - a.y));
    }
    this.totalLen = this.cum[this.cum.length - 1];
    for (const k of pathTiles(map)) this.pathSet.add(k);
    const [ex, ey] = map.path[map.path.length - 1];
    this.portal = { tx: ex, ty: ey, x: ex * TILE + 8, y: ey * TILE + 8 };
  }

  // Puts the round back to its very start with a new seed.
  protected reset(seed: number) {
    this.rng = new Rng(seed);
    this.tick = 0;
    this.log = [];
    this.uid = 0;
    this.towers = [];
    this.enemies = [];
    this.projs = [];
    this.mines = [];
    this.buffs.clear();
    this.spotCache.clear();
    this.gold = this.map.startGold;
    this.lives = this.maxLives;
    this.wave = 0;
    this.waveActive = false;
    this.status = 'playing';
    this.autoWave = false;
    this.endless = false;
    this.kills = 0;
    this.spawns = [];
    this.waveT = 0;
    this.autoT = 0;
  }

  // Overridden by the browser game to draw effects and play sounds.
  protected emit(_e: SimEvent) {}

  // Overridden by the browser game to refresh the UI.
  protected changed() {}

  protected nextId() {
    return ++this.uid;
  }

  /* --------------------------------------------------------------- queries */

  get hasNextRound() {
    return this.round < MAPS.length - 1;
  }

  get nextRound() {
    return Math.min(this.round + 1, MAPS.length - 1);
  }

  // Waves fully survived. This is the leaderboard score.
  get cleared() {
    return this.waveActive ? this.wave - 1 : this.wave;
  }

  unlocked(type: TowerType) {
    return isUnlocked(type, this.round);
  }

  buffOf(t: Tower) {
    return this.buffs.get(t.id) ?? 0;
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

  protected towerAt(tx: number, ty: number) {
    return this.towers.find((t) => t.tx === tx && t.ty === ty);
  }

  canBuild(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && !this.pathSet.has(tileKey(tx, ty)) && !this.towerAt(tx, ty);
  }

  /* -------------------------------------------------------------- commands */

  // Runs a player command and records it if it changed anything.
  act(cmd: Command): boolean {
    const ok = this.apply(cmd);
    if (ok) this.log.push(encode(this.tick, cmd));
    return ok;
  }

  private apply(cmd: Command): boolean {
    if (cmd.c === 'auto') return this.setAuto(cmd.on);
    if (cmd.c === 'endless') return this.goEndless();
    if (this.status !== 'playing') return false;
    switch (cmd.c) {
      case 'build': return this.tryBuild(cmd.type, cmd.tx, cmd.ty);
      case 'upgrade': return this.upgradeAt(cmd.tx, cmd.ty);
      case 'sell': return this.sellAt(cmd.tx, cmd.ty);
      case 'mode': return this.modeAt(cmd.tx, cmd.ty, cmd.mode);
      case 'wave': return this.startWave();
    }
  }

  private tryBuild(type: TowerType, tx: number, ty: number) {
    const cost = TOWERS[type].levels[0].cost;
    if (!this.unlocked(type) || !this.canBuild(tx, ty) || this.gold < cost) return false;
    this.gold -= cost;
    const t: Tower = {
      id: this.nextId(), type, tx, ty, x: tx * TILE + 8, y: ty * TILE + 8, level: 1, cd: 0.2,
      angle: -Math.PI / 2, mode: type === 'rail' || type === 'lancer' ? 'strong' : 'first', spent: cost,
      recoil: 0, pulse: 0, kills: 0, dmgDone: 0, charge: 0, lockId: 0, firing: 0, jam: 0,
    };
    this.towers.push(t);
    if (this.live) this.emit({ k: 'build', t });
    this.changed();
    return true;
  }

  private upgradeAt(tx: number, ty: number) {
    const t = this.towerAt(tx, ty);
    if (!t || t.level >= 3) return false;
    const cost = TOWERS[t.type].levels[t.level].cost;
    if (this.gold < cost) return false;
    this.gold -= cost;
    t.spent += cost;
    t.level++;
    if (this.live) this.emit({ k: 'upgrade', t });
    this.changed();
    return true;
  }

  private sellAt(tx: number, ty: number) {
    const t = this.towerAt(tx, ty);
    if (!t) return false;
    const value = this.sellValue(t);
    this.gold += value;
    this.towers = this.towers.filter((o) => o !== t);
    this.mines = this.mines.filter((m) => m.src !== t);
    if (this.live) this.emit({ k: 'sell', t, value });
    this.changed();
    return true;
  }

  private modeAt(tx: number, ty: number, mode: TargetMode) {
    const t = this.towerAt(tx, ty);
    if (!t || !TOWERS[t.type].aims || t.mode === mode) return false;
    t.mode = mode;
    if (t.type === 'lancer') {
      // Re-aim under the new mode; keep the heat if it settles on the same foe.
      const next = this.pickTarget(t, this.level(t).range);
      if ((next?.id ?? 0) !== t.lockId) {
        t.lockId = next?.id ?? 0;
        t.charge = 0;
      }
    }
    this.changed();
    return true;
  }

  private startWave() {
    if (this.waveActive || this.status !== 'playing') return false;
    this.wave++;
    this.spawns = buildWave(this.wave, this.round).map((g) => ({ ...g, spawned: 0 }));
    this.waveT = 0;
    this.waveActive = true;
    if (this.live) {
      this.emit({ k: 'wave', boss: this.spawns.some((s) => isBoss(s.type)), eraser: this.spawns.some((s) => s.type === 'eraser') });
    }
    this.changed();
    return true;
  }

  private setAuto(on: boolean) {
    if (this.autoWave === on) return false;
    this.autoWave = on;
    this.autoT = 1.2;
    this.changed();
    return true;
  }

  private goEndless() {
    if (this.status !== 'won') return false;
    this.endless = true;
    this.status = 'playing';
    // Give the player a moment before Auto sends the first endless wave.
    this.autoT = AUTO_DELAY;
    if (this.live) this.emit({ k: 'endless' });
    this.changed();
    return true;
  }

  /* ---------------------------------------------------------------- update */

  protected pointAt(d: number) {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1];
    const b = this.pts[i];
    const L = this.cum[i] - this.cum[i - 1];
    const t = Math.min(1, (d - this.cum[i - 1]) / L);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / L, dy: (b.y - a.y) / L };
  }

  protected placeEnemy(e: Enemy) {
    const p = this.pointAt(e.dist);
    e.x = p.x - p.dy * e.off;
    e.y = p.y + p.dx * e.off;
    if (Math.abs(p.dx) > 0.1) e.face = p.dx < 0 ? -1 : 1;
  }

  protected spawnEnemy(type: EnemyType, dist = 0, hpMul?: number) {
    const def = ENEMIES[type];
    const size = ENEMY_SIZE[type];
    const hp = Math.round(def.hp * (hpMul ?? hpScale(this.wave, this.map.difficulty)));
    const id = this.nextId();
    const e: Enemy = {
      id, type, x: -20, y: -20, dist: Math.max(0, dist), hp, maxHp: hp,
      speed: def.speed * this.rng.range(0.95, 1.05), armor: def.armor, gold: killGold(def.gold, this.wave),
      dmg: def.dmg, slow: 0, slowT: 0, flash: 0, anim: (id % 7) * 0.3, face: 1,
      off: isBoss(type) ? 0 : this.rng.range(-2.5, 2.5), alive: true, w: size.w, h: size.h,
      burn: 0, burnT: 0, stunT: 0, kb: 0, kbGuard: 0, abilT: this.rng.range(1, 2.5),
    };
    this.placeEnemy(e);
    this.enemies.push(e);
  }

  // One fixed step of STEP seconds. The browser and the server must call it the same way.
  update(dt: number) {
    if (this.status !== 'playing') return;
    this.tick++;
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
      if (this.autoT <= 0) this.startWave();
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
    }

    // towers
    this.buffs.clear();
    for (const b of this.towers) {
      if (b.type !== 'beacon' || b.jam > 0) continue;
      const L = this.level(b);
      for (const t of this.towers) {
        if (t === b || t.type === 'beacon' || t.type === 'harvester') continue;
        if (dist(t.x - b.x, t.y - b.y) <= L.range) this.buffs.set(t.id, Math.max(this.buffOf(t), L.buff ?? 0));
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
        if (e.alive && e.x >= 0 && dist(e.x - m.x, e.y - m.y) <= 4 + e.w * 0.3) {
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
        const d = dist(dx, dy);
        const step = p.speed * dt;
        if (d <= step + 1) {
          if (p.target.alive) {
            this.hit(p.target, p.dmg, p.src);
            if (this.live) this.emit({ k: 'bulletHit', x: p.tx, y: p.ty });
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
  }

  // Mender heals, Glitch blinks forward, Eraser jams towers.
  protected enemyAbility(e: Enemy, dt: number) {
    const def = ENEMIES[e.type];
    if (!def.heal && !def.blink && !def.jam) return;
    if (e.stunT > 0) return;
    e.abilT -= dt;
    if (e.abilT > 0) return;
    if (def.heal) {
      e.abilT = 2.5;
      const healed: Enemy[] = [];
      for (const o of this.enemies) {
        if (!o.alive || o.hp >= o.maxHp || dist(o.x - e.x, o.y - e.y) > 24) continue;
        o.hp = Math.min(o.maxHp, o.hp + Math.min(o.maxHp * def.heal, def.healCap ?? Infinity));
        healed.push(o);
      }
      if (this.live) this.emit({ k: 'heal', e, healed });
    } else if (def.blink) {
      e.abilT = 2.6;
      if (this.live) this.emit({ k: 'blink', e });
      e.dist = Math.min(this.totalLen - 1, e.dist + def.blink);
      this.placeEnemy(e);
    } else if (def.jam) {
      e.abilT = 5;
      let hit = false;
      for (const t of this.towers) {
        if (dist(t.x - e.x, t.y - e.y) > 48) continue;
        t.jam = Math.max(t.jam, def.jam);
        hit = true;
      }
      if (this.live) this.emit({ k: 'jam', e, hit });
    }
  }

  protected inRange(t: Tower, e: Enemy, range: number) {
    const r = range + e.w * 0.4;
    const dx = e.x - t.x;
    const dy = e.y - t.y;
    return dx * dx + dy * dy <= r * r;
  }

  protected pickTarget(t: Tower, range: number): Enemy | null {
    let best: Enemy | null = null;
    let score = -Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.x < 0 || !this.inRange(t, e, range)) continue;
      let s: number;
      switch (t.mode) {
        case 'first': s = e.dist; break;
        case 'last': s = -e.dist; break;
        case 'strong': s = e.hp * 1000 + e.dist; break;
        case 'close': s = -dist(e.x - t.x, e.y - t.y); break;
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
          if (this.live) this.emit({ k: 'beacon', t, range: L.range });
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
      t.cd = rate;
      t.pulse = 0.25;
      if (this.live) this.emit({ k: 'frost', t, range: L.range });
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
    const want = datan2(target.y - t.y, target.x - t.x);
    t.angle = turnToward(t.angle, want, 16 * dt);
    if (t.type === 'lancer') {
      t.charge = Math.min(1, t.charge + dt / (L.rampTime ?? 2));
      t.firing = 0.12;
    }
    if (t.cd > 0) return;
    t.cd = rate;
    if (t.type !== 'lancer' && t.type !== 'flamer') t.recoil = 0.09;
    const ca = dcos(want);
    const sa = dsin(want);

    switch (t.type) {
      case 'blaster': {
        const mx = t.x + ca * 9;
        const my = t.y + sa * 9;
        this.projs.push({ kind: 'bullet', x: mx, y: my, tx: target.x, ty: target.y, target, dmg: L.dmg * dmgMul, speed: 230, src: t });
        if (this.live) this.emit({ k: 'shoot', x: mx, y: my });
        break;
      }
      case 'mortar': {
        const d = dist(target.x - t.x, target.y - t.y);
        const dur = Math.max(0.35, Math.min(0.9, d / 110));
        const spd = target.speed * (target.slowT > 0 ? 1 - target.slow : 1);
        const fp = this.pointAt(Math.min(this.totalLen, target.dist + spd * dur));
        const mx = t.x + ca * 8;
        const my = t.y + sa * 8;
        this.projs.push({ kind: 'shell', sx: mx, sy: my, tx: fp.x, ty: fp.y, t: 0, dur, dmg: L.dmg * dmgMul, splash: L.splash ?? 16, src: t });
        if (this.live) this.emit({ k: 'mortar', x: mx, y: my });
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
        if (this.live) this.emit({ k: 'rail', x0, y0, x1, y1 });
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
            const d2 = (e.x - cur.x) * (e.x - cur.x) + (e.y - cur.y) * (e.y - cur.y);
            if (d2 < best) {
              best = d2;
              next = e;
            }
          }
          cur = next;
        }
        if (this.live) this.emit({ k: 'tesla', pts });
        break;
      }
      case 'flamer': {
        const cone = L.cone ?? 0.5;
        for (const e of this.enemies) {
          if (!e.alive || e.x < 0 || !this.inRange(t, e, L.range)) continue;
          let d = datan2(e.y - t.y, e.x - t.x) - t.angle;
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
        if (this.live) this.emit({ k: 'flame', t, range: L.range, cone });
        break;
      }
      case 'lancer': {
        const heat = 1 + ((L.ramp ?? 4) - 1) * t.charge;
        this.hit(target, L.dmg * heat * dmgMul, t, true);
        if (this.live) this.emit({ k: 'laser', t, target });
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
      if (p.x >= 2 && p.x <= W - 2 && dist(p.x - t.x, p.y - t.y) <= range) spots.push(d);
    }
    this.spotCache.set(t.id, { range, spots });
    return spots;
  }

  private layMine(t: Tower, L: TowerLevel, dmgMul: number, rate: number) {
    if (t.cd > 0) return;
    if (this.mines.filter((m) => m.src === t).length >= (L.mines ?? 3)) return;
    const free = this.mineSpots(t, L.range).map((d) => this.pointAt(d))
      .filter((p) => this.mines.every((m) => dist(m.x - p.x, m.y - p.y) > 9));
    if (!free.length) return;
    const p = this.rng.pick(free);
    const x = Math.round(p.x + this.rng.range(-2, 2));
    const y = Math.round(p.y + this.rng.range(-2, 2));
    this.mines.push({ x, y, sx: t.x, sy: t.y - 3, t: 0, dur: 0.45, dmg: L.dmg * dmgMul, splash: L.splash ?? 14, src: t });
    t.cd = rate;
    t.recoil = 0.15;
    if (this.live) this.emit({ k: 'mine', t });
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
    t.cd = rate;
    t.pulse = 0.35;
    if (this.live) this.emit({ k: 'slam', t, range: L.range });
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
      const d = dist(e.x - x, e.y - y);
      if (d <= splash + e.w * 0.3) this.hit(e, dmg * (1 - 0.5 * Math.min(1, d / splash)), src);
    }
    if (this.live) this.emit({ k: 'explode', x, y, splash });
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
    if (this.live) this.emit({ k: 'kill', e, gold, bounty });
    const splits = ENEMIES[e.type].splits;
    if (splits) {
      for (let i = 0; i < splits; i++) this.spawnEnemy('runner', e.dist - i * 6, hpScale(this.wave, this.map.difficulty) * 0.7);
    }
    this.changed();
  }

  private leak(e: Enemy) {
    e.alive = false;
    this.lives = Math.max(0, this.lives - e.dmg);
    if (this.live) this.emit({ k: 'leak', e });
    if (this.lives <= 0 && this.status === 'playing') {
      this.status = 'lost';
      if (this.live) this.emit({ k: 'end', status: 'lost' });
    }
    this.changed();
  }

  private endWave() {
    this.waveActive = false;
    this.spawns = [];
    let bonus = waveBonus(this.wave);
    const earners: Tower[] = [];
    for (const h of this.towers) {
      const income = h.type === 'harvester' ? this.level(h).income ?? 0 : 0;
      if (!income) continue;
      bonus += income;
      earners.push(h);
    }
    this.gold += bonus;
    if (this.wave >= TOTAL_WAVES && !this.endless) {
      this.status = 'won';
    } else {
      this.autoT = AUTO_DELAY;
    }
    if (this.live) {
      this.emit({ k: 'waveEnd', bonus, earners });
      if (this.status === 'won') this.emit({ k: 'end', status: 'won' });
    }
    this.changed();
  }
}

/* ---------------------------------------------------------------- replay */

// Longest run the server will replay: six hours of game time.
export const MAX_TICKS = Math.round(6 * 3600 / STEP);
export const MAX_LOG = 20000;

export type ReplayResult = { ok: true } | { ok: false; error: string };

// Feeds a recorded log into a fresh sim, then runs it on to endTick. Fails if the log is
// malformed or any command no longer applies, which means it was not recorded by this version
// of the game. The sim keeps re-recording, so a resumed run carries on with the same log.
export function replayInto(sim: Sim, log: unknown, endTick: number): ReplayResult {
  if (!Array.isArray(log) || log.length > MAX_LOG) return { ok: false, error: 'bad log' };
  if (!isInt(endTick) || endTick < 0 || endTick > MAX_TICKS) return { ok: false, error: 'bad end' };
  for (const entry of log) {
    const cmd = decode(entry);
    const at = (entry as number[])?.[0];
    if (!cmd || at < sim.tick || at > endTick) return { ok: false, error: 'bad entry' };
    while (sim.tick < at) {
      // A command stamped after the game stopped ticking could not have been recorded.
      if (sim.status !== 'playing') return { ok: false, error: 'entry after end' };
      sim.update(STEP);
    }
    if (!sim.act(cmd)) return { ok: false, error: 'command rejected' };
  }
  while (sim.tick < endTick && sim.status === 'playing') sim.update(STEP);
  return { ok: true };
}

export function mapById(id: string) {
  return MAPS.find((m) => m.id === id);
}
