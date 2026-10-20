import { COLS, H, PAL, ROWS, STEP, TAU, TILE, W } from './constants';
import type { MapDef } from './maps';
import {
  ENEMIES, TARGET_MODES, TOWERS, TOWER_KEYS, TOWER_ORDER, isBoss, isUnlocked,
  type TargetMode, type TowerType,
} from './data';
import {
  ENEMY_SPRITES, drawText, drawTowerSprite, fillDisc, pixelCircle, plotLine, textWidth,
} from './sprites';
import { buildBackground } from './background';
import { sfx } from './audio';
import { loadProgress, saveBest, saveProgress, type Snapshot } from './storage';
import { Rng, randomSeed } from './rng';
import { AUTO_DELAY, SIM_VERSION, Sim, replayInto, type Command, type Enemy, type SimEvent } from './sim';

export type { Enemy, GameStatus, Tower } from './sim';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; grav: number }
interface Ring { x: number; y: number; r0: number; r1: number; life: number; max: number; color: string }
interface Beam { x0: number; y0: number; x1: number; y1: number; life: number; max: number }
interface Arc { pts: { x: number; y: number }[]; life: number; max: number }
interface Floater { x: number; y: number; text: string; life: number; max: number; color: string }

export interface Banner { id: number; text: string; sub?: string; danger?: boolean }

let bannerId = 0;
// Cosmetic randomness only. Anything that changes the outcome uses the sim's seeded rng.
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

/*
 * The playable game: the simulation plus everything a person sees, hears and touches. Input
 * goes through act() so it is recorded for leaderboard verification, and the sim's events are
 * turned into particles, sounds, banners and saves here.
 */
export class Game extends Sim {
  private bg: HTMLCanvasElement;
  private decals: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;

  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private beams: Beam[] = [];
  private arcs: Arc[] = [];
  private floaters: Floater[] = [];

  speed = 1;
  paused = false;
  placing: TowerType | null = null;
  selectedId: number | null = null;
  banner: Banner | null = null;
  version = 0;

  // Leaderboard run id from the server. Null until a ticket arrives, or for good if it can't be ranked.
  runId: string | null = null;
  // Why this run can't go on the leaderboard, if it can't.
  unranked: string | null = null;
  // False once the round no longer matches its log (restored from an old save), so it can't be replayed.
  private replayable = true;

  private hover: { tx: number; ty: number } | null = null;
  private mouse: { x: number; y: number } | null = null;
  // Enemy shown in the info card: hovered with a mouse, or tapped (pinned) on touch.
  inspectId = 0;
  private inspectPinned = false;
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
    const save = snap?.mapId === map.id ? snap : undefined;
    const run = save?.run?.v === SIM_VERSION ? save.run : undefined;
    super(map, run?.seed ?? randomSeed());
    this.bg = buildBackground(map, this.pathSet);
    this.decals = document.createElement('canvas');
    this.decals.width = W;
    this.decals.height = H;
    this.dctx = this.decals.getContext('2d')!;
    this.reached = loadProgress().unlocked;
    if (save) this.resume(save);
    this.live = true;
    this.checkpoint();
    const fresh = TOWER_ORDER.filter((t) => TOWERS[t].unlock === this.round).map((t) => TOWERS[t].name);
    this.intro = [
      `Round ${this.round + 1}`,
      this.wave ? `Resuming after wave ${this.wave}` : this.round > 0 && fresh.length ? `Unlocked: ${fresh.join(', ')}` : map.name,
    ];
  }

  /* ------------------------------------------------------------ save data */

  // Rebuilds a saved round by replaying its log, which keeps it verifiable. Older saves (or a
  // log that no longer replays to the saved state) fall back to restoring the towers directly.
  private resume(s: Snapshot) {
    const run = s.run;
    if (run?.v === SIM_VERSION) {
      const res = replayInto(this, run.log, run.tick);
      if (res.ok && this.wave === s.wave && this.gold === s.gold && this.lives === s.lives && this.kills === s.kills) {
        this.runId = run.id;
        if (!run.id) this.unranked = 'This run started offline, so it can’t be ranked.';
        this.speed = s.speed;
        this.autoT = AUTO_DELAY;
        return;
      }
    }
    this.reset(randomSeed());
    this.replayable = false;
    this.unranked = 'This run was saved by an older version of the game, so it can’t be ranked.';
    this.wave = s.wave;
    this.gold = s.gold;
    this.lives = Math.min(this.maxLives, s.lives);
    this.kills = s.kills;
    this.endless = s.endless;
    this.speed = s.speed;
    this.autoWave = s.autoWave;
    // Give the player a moment before Auto sends the next wave.
    this.autoT = AUTO_DELAY;
    for (const o of s.towers) {
      const type = o.type as TowerType;
      if (!TOWERS[type] || !isUnlocked(type, this.round) || !this.canBuild(o.tx, o.ty)) continue;
      this.towers.push({
        id: this.nextId(), type, tx: o.tx, ty: o.ty, x: o.tx * TILE + 8, y: o.ty * TILE + 8,
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
  }

  // Saves the round between waves. Reloading mid-wave replays that wave from its start.
  private checkpoint() {
    if (!this.live || this.waveActive || this.status !== 'playing') return;
    this.save(this.round, {
      mapId: this.map.id, wave: this.wave, gold: this.gold, lives: this.lives, kills: this.kills,
      endless: this.endless, speed: this.speed, autoWave: this.autoWave,
      towers: this.towers.map(({ type, tx, ty, level, mode, spent, kills, dmgDone }) => (
        { type, tx, ty, level, mode, spent, kills, dmgDone }
      )),
      mines: this.mines.map(({ x, y, dmg, splash, src }) => ({ tx: src.tx, ty: src.ty, x, y, dmg, splash })),
      // Replaying the log rebuilds everything above exactly, mines included. The plain lists
      // are kept for saves that can no longer be replayed.
      run: this.replayable
        ? { v: SIM_VERSION, id: this.runId, seed: this.rng.seed, log: this.log, tick: this.tick }
        : undefined,
    });
  }

  // Saving never lowers the furthest round reached; see saveProgress.
  private save(round: number, snapshot?: Snapshot) {
    this.reached = Math.max(this.reached, saveProgress({ round, snapshot }).unlocked);
  }

  // The next round is open: beaten this time, or on an earlier run of this round.
  get nextUnlocked() {
    return this.hasNextRound && this.reached > this.round;
  }

  // True while the run is still waiting for a leaderboard ticket it could use.
  get wantsTicket() {
    return this.replayable && !this.runId && !this.unranked;
  }

  // Takes the server's seed for this run. Only possible before the first random draw: until
  // then the seed has had no effect, so the run plays out exactly as if it started with it.
  adoptTicket(id: string, seed: number) {
    if (!this.wantsTicket) return false;
    if (this.rng.draws > 0) {
      this.unranked = 'The leaderboard was unreachable when this run started, so it can’t be ranked.';
      this.touch();
      return false;
    }
    this.rng = new Rng(seed);
    this.runId = id;
    this.checkpoint();
    this.touch();
    return true;
  }

  // No ticket is coming (offline, or the leaderboard is down).
  noTicket() {
    if (!this.wantsTicket) return;
    this.unranked = 'The leaderboard was unreachable when this run started, so it can’t be ranked.';
    this.touch();
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

  protected changed() {
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

  update(dt: number) {
    if (this.status !== 'playing') return;
    super.update(dt);
    // Skipped while a saved run is fast-forwarded on load.
    if (this.live) this.updateFx(dt);
  }

  /* --------------------------------------------------------------- public */

  get inspected(): Enemy | undefined {
    return this.inspectId ? this.enemies.find((e) => e.id === this.inspectId && e.alive) : undefined;
  }

  get selected() {
    return this.towers.find((t) => t.id === this.selectedId);
  }

  // Every player command goes through here: recorded by the sim, then saved.
  act(cmd: Command) {
    const ok = super.act(cmd);
    if (ok) {
      this.checkpoint();
      this.touch();
    }
    return ok;
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
    this.act({ c: 'wave' });
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
    this.act({ c: 'auto', on: !this.autoWave });
  }

  continueEndless() {
    this.act({ c: 'endless' });
  }

  upgradeSelected() {
    const t = this.selected;
    if (!t || t.level >= 3 || this.status !== 'playing') return;
    if (!this.act({ c: 'upgrade', tx: t.tx, ty: t.ty })) sfx.play('error');
  }

  sellSelected() {
    const t = this.selected;
    if (!t || this.status !== 'playing') return;
    if (this.act({ c: 'sell', tx: t.tx, ty: t.ty })) this.selectedId = null;
  }

  setMode(mode: TargetMode) {
    const t = this.selected;
    if (!t || !TOWERS[t.type].aims) return;
    this.act({ c: 'mode', tx: t.tx, ty: t.ty, mode });
    sfx.play('click');
  }

  private showBanner(text: string, sub?: string, danger = false) {
    this.banner = { id: ++bannerId, text, sub, danger };
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
      if (this.act({ c: 'build', type: this.placing, tx: tile.tx, ty: tile.ty })) {
        if (!e.shiftKey) this.placing = null;
      } else {
        sfx.play('error');
      }
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

  /* ------------------------------------------------------------- effects */

  protected emit(ev: SimEvent) {
    switch (ev.k) {
      case 'build': {
        const t = ev.t;
        for (let i = 0; i < 10; i++) this.spark(t.x + rand(-6, 6), t.y + 6, pick([PAL.k3, PAL.k4]), 20, -10);
        sfx.play('build');
        break;
      }
      case 'upgrade': {
        const t = ev.t;
        this.rings.push({ x: t.x, y: t.y, r0: 3, r1: 12, life: 0.35, max: 0.35, color: PAL.k7 });
        for (let i = 0; i < 14; i++) this.spark(t.x, t.y, i % 3 === 0 ? PAL.r2 : PAL.k7, 40, -20);
        sfx.play('upgrade');
        break;
      }
      case 'sell': {
        const t = ev.t;
        this.floaters.push({ x: t.x, y: t.y - 6, text: `+${ev.value}`, life: 0.9, max: 0.9, color: PAL.k6 });
        for (let i = 0; i < 16; i++) this.spark(t.x, t.y, pick([PAL.k3, PAL.k4, PAL.k5]), 50, 40);
        sfx.play('sell');
        break;
      }
      case 'wave':
        if (ev.eraser) this.showBanner('The Eraser', 'It has come for the Last Pixel', true);
        else this.showBanner(`Wave ${this.wave}`, ev.boss ? 'A Colossus approaches' : undefined, ev.boss);
        sfx.play(ev.boss ? 'boss' : 'wave');
        break;
      case 'endless':
        this.showBanner('Endless', 'How long can you hold?', true);
        break;
      case 'heal':
        for (const o of ev.healed) {
          for (let i = 0; i < 3; i++) this.parts.push({ x: o.x + rand(-3, 3), y: o.y - 2, vx: 0, vy: -16, life: 0.5, max: 0.5, color: PAL.k7, grav: 0 });
        }
        this.rings.push({ x: ev.e.x, y: ev.e.y, r0: 2, r1: 24, life: 0.4, max: 0.4, color: PAL.k5 });
        break;
      case 'blink': {
        const e = ev.e;
        for (let i = 0; i < 6; i++) this.parts.push({ x: e.x + rand(-3, 3), y: e.y + rand(-3, 3), vx: 0, vy: 0, life: 0.25, max: 0.25, color: pick([PAL.r2, PAL.k6]), grav: 0 });
        break;
      }
      case 'jam':
        this.rings.push({ x: ev.e.x, y: ev.e.y, r0: 6, r1: 48, life: 0.7, max: 0.7, color: PAL.k5 });
        if (ev.hit) sfx.play('jam');
        break;
      case 'beacon':
        this.rings.push({ x: ev.t.x, y: ev.t.y, r0: 3, r1: ev.range, life: 0.7, max: 0.7, color: PAL.r1 });
        break;
      case 'frost':
        this.rings.push({ x: ev.t.x, y: ev.t.y, r0: 4, r1: ev.range, life: 0.4, max: 0.4, color: PAL.k6 });
        sfx.play('frost');
        break;
      case 'shoot':
        this.parts.push({ x: ev.x, y: ev.y, vx: 0, vy: 0, life: 0.05, max: 0.05, color: PAL.k7, grav: 0 });
        sfx.play('shoot');
        break;
      case 'mortar':
        for (let i = 0; i < 4; i++) this.spark(ev.x, ev.y, pick([PAL.k4, PAL.k5]), 20, -10);
        sfx.play('thump');
        break;
      case 'rail': {
        const { x0, y0, x1, y1 } = ev;
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
      case 'tesla':
        this.arcs.push({ pts: jagged(ev.pts), life: 0.16, max: 0.16 });
        sfx.play('zap');
        break;
      case 'flame': {
        const { t, range, cone } = ev;
        const nx = t.x + Math.cos(t.angle) * 8;
        const ny = t.y + Math.sin(t.angle) * 8;
        for (let i = 0; i < 5; i++) {
          const a = t.angle + rand(-cone, cone) * 0.85;
          const sp = rand(70, 120) * (range / 26);
          const life = rand(0.18, 0.32);
          this.parts.push({
            x: nx, y: ny, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life,
            color: pick([PAL.k7, PAL.r3, PAL.r3, PAL.r2, PAL.r2, PAL.r1]), grav: -20,
          });
        }
        sfx.play('flame');
        break;
      }
      case 'laser': {
        const { t, target } = ev;
        if (Math.random() < 0.35 + t.charge * 0.4) this.spark(target.x, target.y, pick([PAL.k7, PAL.r3, PAL.r2]), 30 + t.charge * 40, 0);
        sfx.play('laser');
        break;
      }
      case 'mine':
        sfx.play('mine');
        break;
      case 'slam': {
        const { t, range } = ev;
        this.rings.push({ x: t.x, y: t.y, r0: 5, r1: range, life: 0.45, max: 0.45, color: PAL.k7 });
        this.rings.push({ x: t.x, y: t.y, r0: 3, r1: range * 0.65, life: 0.6, max: 0.6, color: PAL.k4 });
        for (let i = 0; i < 24; i++) {
          const a = rand(0, TAU);
          const r = rand(6, range);
          this.parts.push({ x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r, vx: rand(-6, 6), vy: rand(-30, -10), life: 0.4, max: 0.4, color: pick([PAL.k3, PAL.k4, PAL.k5]), grav: 80 });
        }
        this.shake = Math.max(this.shake, 2);
        sfx.play('quake');
        break;
      }
      case 'bulletHit':
        for (let i = 0; i < 3; i++) this.spark(ev.x, ev.y, pick([PAL.k7, PAL.r3]), 40, 0);
        break;
      case 'explode': {
        const { x, y, splash } = ev;
        this.rings.push({ x, y, r0: 2, r1: splash, life: 0.28, max: 0.28, color: PAL.k6 });
        for (let i = 0; i < 16; i++) this.spark(x, y, pick([PAL.k5, PAL.k6, PAL.k7, PAL.r2, PAL.r3]), 90, 30);
        this.dctx.fillStyle = PAL.k1;
        for (let i = 0; i < 10; i++) this.dctx.fillRect(Math.round(x + rand(-5, 5)), Math.round(y + rand(-5, 5)), 1, 1);
        this.shake = Math.max(this.shake, 1.5);
        sfx.play('boom');
        break;
      }
      case 'kill': {
        const { e, gold, bounty } = ev;
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
        if (boss) {
          this.shake = 8;
          this.rings.push({ x: e.x, y: e.y, r0: 4, r1: 40, life: 0.6, max: 0.6, color: PAL.r2 });
          this.showBanner(`${ENEMIES[e.type].name} slain`, `+${gold} gold`);
          sfx.play('bigdie');
        } else {
          sfx.play('die');
        }
        break;
      }
      case 'leak':
        this.shake = Math.max(this.shake, 3 + ev.e.dmg * 0.5);
        this.hurt = 0.5;
        for (let i = 0; i < 20; i++) this.spark(this.portal.x, this.portal.y, pick([PAL.r2, PAL.r3, PAL.k7]), 80, 0);
        sfx.play('leak');
        break;
      case 'waveEnd': {
        for (const h of ev.earners) {
          const income = this.level(h).income ?? 0;
          h.pulse = 0.6;
          this.floaters.push({ x: h.x, y: h.y - 10, text: `+${income}`, life: 1.2, max: 1.2, color: PAL.k7 });
          for (let i = 0; i < 10; i++) this.spark(h.x, h.y - 4, pick([PAL.k6, PAL.k7, PAL.r3]), 40, 60);
        }
        if (ev.earners.length) sfx.play('coin');
        saveBest(this.map.id, this.wave);
        if (this.status === 'playing') {
          this.showBanner('Wave clear', `+${ev.bonus} gold`);
          sfx.play('clear');
          this.checkpoint();
        }
        break;
      }
      case 'end':
        this.placing = null;
        if (ev.status === 'won') {
          this.save(this.nextRound);
          sfx.play('win');
        } else {
          saveBest(this.map.id, this.wave - 1);
          // Falling in endless still counts the round as beaten.
          this.save(this.endless ? this.nextRound : this.round);
          sfx.play('lose');
        }
        break;
    }
  }

  private spark(x: number, y: number, color: string, speed: number, grav: number) {
    const a = rand(0, TAU);
    const s = rand(0.3, 1) * speed;
    const life = rand(0.25, 0.7);
    this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, grav });
  }

  private updateFx(dt: number) {
    for (const e of this.enemies) {
      if (e.burnT > 0 && Math.random() < dt * 14) {
        this.parts.push({ x: e.x + rand(-3, 3), y: e.y + rand(-3, 2), vx: rand(-4, 4), vy: -18, life: 0.3, max: 0.3, color: pick([PAL.r2, PAL.r3, PAL.k7]), grav: 0 });
      }
      if (isBoss(e.type) && Math.random() < dt * 20) {
        this.parts.push({ x: e.x + rand(-7, 7), y: e.y + rand(-6, 6), vx: 0, vy: -12, life: 0.5, max: 0.5, color: pick([PAL.r1, PAL.r2]), grav: 0 });
      }
      if (e.slowT > 0 && Math.random() < dt * 8) {
        this.parts.push({ x: e.x + rand(-4, 4), y: e.y + rand(-4, 4), vx: 0, vy: 6, life: 0.35, max: 0.35, color: PAL.k7, grav: 0 });
      }
    }

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
