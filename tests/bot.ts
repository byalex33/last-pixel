import { STEP } from '../src/game/constants.js';
import { TOWERS, type TowerType } from '../src/game/data.js';
import { Sim } from '../src/game/sim.js';

// Path coverage of a tile for a tower type: how much road it can reach.
function coverage(sim: Sim, type: TowerType, tx: number, ty: number) {
  const s = sim as unknown as { pointAt(d: number): { x: number; y: number }; totalLen: number };
  const r = TOWERS[type].levels[0].range;
  const x = tx * 16 + 8;
  const y = ty * 16 + 8;
  let n = 0;
  for (let d = 0; d < s.totalLen; d += 4) {
    const p = s.pointAt(d);
    if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r) n++;
  }
  return n;
}

const PLAN: TowerType[] = ['blaster', 'mortar', 'frost', 'blaster', 'tesla', 'mines', 'flamer', 'rail', 'lancer', 'quake', 'beacon', 'harvester'];

// A simple, fully deterministic player: between waves it upgrades or builds on the best tile,
// then sends the next wave. Plays through act(), so every move is recorded in sim.log.
export function playBot(sim: Sim, opts: { waves: number; endless?: boolean; auto?: boolean }) {
  if (opts.auto) sim.act({ c: 'auto', on: true });
  let guard = 0;
  while (sim.status !== 'lost' && sim.cleared < opts.waves && guard++ < 5_000_000) {
    if (sim.status === 'won') {
      if (!opts.endless || !sim.act({ c: 'endless' })) break;
      continue;
    }
    if (!sim.waveActive) {
      spend(sim);
      if (!opts.auto) sim.act({ c: 'wave' });
    }
    sim.update(STEP);
  }
}

function spend(sim: Sim) {
  for (let i = 0; i < 40; i++) {
    const up = sim.towers.find((t) => t.level < 3 && sim.gold >= TOWERS[t.type].levels[t.level].cost);
    if (up && sim.towers.length >= 6) {
      sim.act({ c: 'upgrade', tx: up.tx, ty: up.ty });
      continue;
    }
    const type = PLAN.filter((t) => sim.unlocked(t))[sim.towers.length % PLAN.filter((t) => sim.unlocked(t)).length];
    if (sim.gold < TOWERS[type].levels[0].cost) {
      if (up) {
        sim.act({ c: 'upgrade', tx: up.tx, ty: up.ty });
        continue;
      }
      return;
    }
    let best: [number, number] | null = null;
    let score = -1;
    for (let ty = 0; ty < 12; ty++) {
      for (let tx = 0; tx < 20; tx++) {
        if (!sim.canBuild(tx, ty)) continue;
        const s = coverage(sim, type === 'beacon' || type === 'harvester' ? 'blaster' : type, tx, ty);
        if (s > score) {
          score = s;
          best = [tx, ty];
        }
      }
    }
    if (!best || !sim.act({ c: 'build', type, tx: best[0], ty: best[1] })) return;
    if (type === 'rail' || type === 'lancer') sim.act({ c: 'mode', tx: best[0], ty: best[1], mode: 'first' });
  }
}

// Everything that should match between a live run and its replay.
export function fingerprint(sim: Sim) {
  return {
    tick: sim.tick,
    status: sim.status,
    wave: sim.wave,
    cleared: sim.cleared,
    gold: sim.gold,
    lives: sim.lives,
    kills: sim.kills,
    enemies: sim.enemies.map((e) => [e.type, e.hp, e.dist]),
    towers: sim.towers.map((t) => [t.type, t.tx, t.ty, t.level, t.kills, t.dmgDone]),
  };
}
