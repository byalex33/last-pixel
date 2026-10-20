import { Game, type Enemy, type Tower } from '../game/engine';
import { MAPS } from '../game/maps';
import { H, STEP, TILE, W } from '../game/constants';
import { sfx } from '../game/audio';
import type { EnemyType, TowerType } from '../game/data';

/*
 * A Game the trailer drives by hand: no input, no React, no save data.
 * The engine keeps these members private, so the trailer reaches them through this view.
 */
interface Inner {
  update(dt: number): void;
  render(): void;
  spawnEnemy(type: EnemyType, dist?: number, hpMul?: number): void;
  tryBuild(type: TowerType, tx: number, ty: number): boolean;
  pointAt(d: number): { x: number; y: number };
  rt: number;
  totalLen: number;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  enemies: Enemy[];
  towers: Tower[];
  gold: number;
  lives: number;
  wave: number;
}

interface Stream {
  types: EnemyType[];
  every: number;
  t: number;
  dist: number;
  hp: number;
  n: number;
}

export class Sim {
  readonly game: Game;
  readonly canvas: HTMLCanvasElement;
  private g: Inner;
  private acc = 0;
  private streams: Stream[] = [];
  speed = 1;

  constructor(map: number) {
    this.game = new Game(MAPS[map]);
    this.g = this.game as unknown as Inner;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    const ctx = this.canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    this.g.canvas = this.canvas;
    this.g.ctx = ctx;
    this.g.wave = 3;
    // Every tower is unlocked in the trailer, whatever map it is filmed on.
    (this.game as unknown as { round: number }).round = MAPS.length - 1;
    this.g.lives = 99999;
  }

  get enemies() {
    return this.g.enemies;
  }

  get towers() {
    return this.g.towers;
  }

  build(type: TowerType, tx: number, ty: number, level = 3, angle?: number) {
    this.g.gold = 1e7;
    if (!this.g.tryBuild(type, tx, ty)) {
      console.warn(`trailer: cannot build ${type} at ${tx},${ty} on ${this.game.map.name}`);
      return this;
    }
    const t = this.g.towers[this.g.towers.length - 1];
    t.level = level;
    if (angle !== undefined) t.angle = angle;
    return this;
  }

  // Path distance closest to a point, so foes can be dropped just before a tower.
  distNear(x: number, y: number) {
    let best = 0;
    let bd = Infinity;
    for (let d = 0; d <= this.g.totalLen; d += 2) {
      const p = this.g.pointAt(d);
      const k = Math.hypot(p.x - x, p.y - y);
      if (k < bd) {
        bd = k;
        best = d;
      }
    }
    return best;
  }

  distNearTile(tx: number, ty: number) {
    return this.distNear(tx * TILE + 8, ty * TILE + 8);
  }

  spawn(type: EnemyType, dist: number, hp = 1) {
    this.g.spawnEnemy(type, Math.max(0, dist), hp);
    return this.g.enemies[this.g.enemies.length - 1];
  }

  // Keeps foes coming from a point on the road, cycling through the given types.
  stream(types: EnemyType[], every: number, hp = 1, dist = 0) {
    this.streams.push({ types, every, t: 0, dist, hp, n: 0 });
    return this;
  }

  // Lines the whole road with foes so a shot opens on a crowd.
  fill(types: EnemyType[], spacing: number, hp = 1, from = 0) {
    let n = 0;
    for (let d = from; d < this.g.totalLen - 12; d += spacing) this.spawn(types[n++ % types.length], d, hp);
    return this;
  }

  step(dt: number) {
    this.acc += dt * this.speed;
    while (this.acc >= STEP) {
      for (const s of this.streams) {
        s.t -= STEP;
        if (s.t <= 0) {
          s.t += s.every;
          this.spawn(s.types[s.n++ % s.types.length], s.dist + Math.random() * 4, s.hp);
        }
      }
      this.g.update(STEP);
      this.acc -= STEP;
    }
    this.g.rt += dt;
  }

  // Runs silently so the shot opens mid-action.
  warm(seconds: number) {
    const was = sfx.muted;
    sfx.muted = true;
    for (let t = 0; t < seconds; t += 1 / 30) this.step(1 / 30);
    sfx.muted = was;
    return this;
  }

  render() {
    this.g.render();
    return this.canvas;
  }
}
