import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/game/maps.js';
import { datan2, dcos, dist, dsin } from '../src/game/detmath.js';
import { SIM_VERSION, Sim, decode, encode, replayInto } from '../src/game/sim.js';
import { fingerprint, playBot } from './bot.js';

const map = (id: string) => MAPS.find((m) => m.id === id)!;

describe('detmath', () => {
  it('matches Math to within 1e-12', () => {
    for (let i = -4000; i <= 4000; i++) {
      const x = i * 0.0031;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-12);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-12);
    }
    for (let i = -60; i <= 60; i++) {
      for (let j = -60; j <= 60; j++) {
        const y = i * 0.37;
        const x = j * 0.41;
        expect(Math.abs(datan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-12);
        expect(dist(x, y)).toBeCloseTo(Math.hypot(x, y), 12);
      }
    }
  });
});

describe('command log', () => {
  it('round-trips every command', () => {
    const cmds = [
      { c: 'build', type: 'quake', tx: 19, ty: 11 },
      { c: 'upgrade', tx: 3, ty: 4 },
      { c: 'sell', tx: 0, ty: 0 },
      { c: 'mode', tx: 5, ty: 6, mode: 'close' },
      { c: 'wave' },
      { c: 'auto', on: true },
      { c: 'endless' },
    ] as const;
    for (const cmd of cmds) expect(decode(encode(42, cmd))).toEqual(cmd);
  });

  it('rejects malformed entries', () => {
    for (const bad of [null, 'x', [], [1], [1, 99], [1, 0, 99, 1, 1], [1, 0, 0, 20, 1], [1, 1, 1.5, 2], [1, 5, 2], [1, 4, 0]]) {
      expect(decode(bad)).toBeNull();
    }
  });
});

describe('replay', () => {
  for (const id of ['gate', 'coil', 'rift', 'hollow', 'core']) {
    it(`reproduces a bot run on ${id} exactly`, () => {
      const live = new Sim(map(id), 1234);
      playBot(live, { waves: 30 });
      expect(live.log.length).toBeGreaterThan(10);

      const again = new Sim(map(id), 1234);
      const res = replayInto(again, live.log, live.tick);
      expect(res).toEqual({ ok: true });
      expect(fingerprint(again)).toEqual(fingerprint(live));
    }, 120_000);
  }

  it('reproduces an endless run with Auto on', () => {
    const live = new Sim(map('gate'), 99);
    playBot(live, { waves: 34, endless: true, auto: true });
    expect(live.endless).toBe(true);
    const again = new Sim(map('gate'), 99);
    expect(replayInto(again, live.log, live.tick)).toEqual({ ok: true });
    expect(fingerprint(again)).toEqual(fingerprint(live));
  }, 120_000);

  it('only reproduces a run with its own seed', () => {
    const a = new Sim(map('rift'), 1);
    playBot(a, { waves: 12 });
    const b = new Sim(map('rift'), 2);
    // Under another seed the run drifts: either a recorded purchase becomes unaffordable and the
    // log is rejected, or it plays out to a different result.
    const res = replayInto(b, a.log, a.tick);
    if (res.ok) expect(fingerprint(b)).not.toEqual(fingerprint(a));
    else expect(res.error).toBe('command rejected');
  }, 60_000);

  it('rejects logs that could not have been played', () => {
    const fresh = () => new Sim(map('gate'), 7);
    // Building on the road.
    expect(replayInto(fresh(), [[0, 0, 0, 0, 2]], 10).ok).toBe(false);
    // Spending gold the player does not have: 4 Railguns at 140 each from 160 gold.
    expect(replayInto(fresh(), [[0, 0, 3, 1, 1], [0, 0, 3, 2, 0], [0, 0, 3, 4, 4], [0, 0, 3, 5, 5]], 10).ok).toBe(false);
    // Out-of-order steps.
    expect(replayInto(fresh(), [[50, 4], [10, 0, 0, 1, 1]], 100).ok).toBe(false);
    // Commands after the end tick, and absurd end ticks.
    expect(replayInto(fresh(), [[200, 4]], 100).ok).toBe(false);
    expect(replayInto(fresh(), [], 1e12).ok).toBe(false);
  });

  it('ignores the claimed score: the result is whatever the replay produces', () => {
    const sim = new Sim(map('gate'), 5);
    expect(replayInto(sim, [[0, 4]], 60 * 120).ok).toBe(true);
    // One wave sent with no towers: it can never be cleared without losing lives.
    expect(sim.cleared).toBeLessThanOrEqual(1);
    expect(sim.lives).toBeLessThan(20);
  });

  it('stamps the version', () => {
    expect(SIM_VERSION).toBeGreaterThan(0);
  });
});
