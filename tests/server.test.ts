import { beforeEach, describe, expect, it } from 'vitest';
import { MAPS } from '../src/game/maps.js';
import { Sim } from '../src/game/sim.js';
import { cleanHandle, handleAdmin, handleLeaderboard, handleOptions, handleRun, handleSubmit, route, type Ctx } from '../server/handlers.js';
import { MemoryStore } from '../server/store.js';
import { playBot } from './bot.js';

let ctx: Ctx;
beforeEach(() => {
  ctx = { store: new MemoryStore(), ip: '1.2.3.4', env: {} };
});

const post = (path: string, body: unknown) =>
  new Request(`http://x${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

async function openRun(map = 'gate') {
  const res = await handleRun(post('/api/run', { map }), ctx);
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; seed: number };
}

async function playRun(mapId: string, waves: number) {
  const { id, seed } = await openRun(mapId);
  const sim = new Sim(MAPS.find((m) => m.id === mapId)!, seed);
  playBot(sim, { waves });
  return { id, sim };
}

const submit = (body: Record<string, unknown>) => handleSubmit(post('/api/submit', body), ctx);

describe('leaderboard API', () => {
  it('verifies a run by replaying it and ranks it', async () => {
    const { id, sim } = await playRun('gate', 8);
    const res = await submit({ id, handle: '@Pixel_Keeper', log: sim.log, endTick: sim.tick });
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out).toMatchObject({ wave: sim.cleared, kills: sim.kills, rank: 1, improved: true });

    const board = await (await handleLeaderboard(new Request('http://x/api/leaderboard?map=gate'), ctx)).json();
    expect(board.entries).toEqual([expect.objectContaining({ rank: 1, handle: 'Pixel_Keeper', wave: sim.cleared, kills: sim.kills })]);
  }, 60_000);

  it('scores the replay, not the claim', async () => {
    const { id, sim } = await playRun('gate', 5);
    const res = await submit({ id, handle: 'cheater', log: sim.log, endTick: sim.tick, claim: { wave: 500, kills: 99999 } });
    const out = await res.json();
    expect(out.wave).toBe(sim.cleared);
    expect(out.wave).toBeLessThan(500);
  }, 60_000);

  it('rejects a tampered log', async () => {
    const { id, sim } = await playRun('gate', 5);
    // Swap the first build for a Railgun the player could not afford at that point.
    const log = sim.log.map((e) => [...e]);
    const first = log.findIndex((e) => e[1] === 0);
    log.splice(first, 0, [log[first][0], 0, 3, 0, 0], [log[first][0], 0, 3, 1, 1]);
    const res = await submit({ id, handle: 'cheater', log, endTick: sim.tick });
    expect(res.status).toBe(422);
  }, 60_000);

  it('keeps each handle’s best and orders by waves, then kills', async () => {
    const a = await playRun('gate', 10);
    const b = await playRun('gate', 6);
    expect((await submit({ id: a.id, handle: 'alpha', log: a.sim.log, endTick: a.sim.tick })).status).toBe(200);
    expect((await submit({ id: b.id, handle: 'beta', log: b.sim.log, endTick: b.sim.tick })).status).toBe(200);
    // A worse run for alpha does not replace the better one.
    const c = await playRun('gate', 3);
    const worse = await (await submit({ id: c.id, handle: 'ALPHA', log: c.sim.log, endTick: c.sim.tick })).json();
    expect(worse.improved).toBe(false);
    expect(worse.best.wave).toBe(a.sim.cleared);

    const board = await (await handleLeaderboard(new Request('http://x/api/leaderboard?map=gate'), ctx)).json();
    expect(board.entries.map((e: { handle: string }) => e.handle)).toEqual(['alpha', 'beta']);
  }, 120_000);

  it('binds a run to the first handle that submits it', async () => {
    const { id, sim } = await playRun('gate', 3);
    expect((await submit({ id, handle: 'first', log: sim.log, endTick: sim.tick })).status).toBe(200);
    expect((await submit({ id, handle: 'second', log: sim.log, endTick: sim.tick })).status).toBe(409);
    expect((await submit({ id, handle: 'FIRST', log: sim.log, endTick: sim.tick })).status).toBe(200);
  }, 60_000);

  it('refuses unknown runs, bad handles and runs with no cleared waves', async () => {
    expect((await submit({ id: crypto.randomUUID(), handle: 'x', log: [], endTick: 0 })).status).toBe(404);
    const { id } = await openRun();
    expect((await submit({ id, handle: 'not a handle!', log: [], endTick: 0 })).status).toBe(400);
    expect((await submit({ id, handle: 'nobody', log: [], endTick: 60 })).status).toBe(422);
  });

  it('validates handles', () => {
    expect(cleanHandle('@jack')).toBe('jack');
    expect(cleanHandle('  Some_One_123 ')).toBe('Some_One_123');
    expect(cleanHandle('sixteen_chars_xx')).toBeNull();
    expect(cleanHandle('bad-handle')).toBeNull();
    expect(cleanHandle('')).toBeNull();
    expect(cleanHandle(42)).toBeNull();
    expect(cleanHandle('xXbadwordXx', ['badword'])).toBeNull();
  });

  it('rate limits run creation per IP', async () => {
    for (let i = 0; i < 120; i++) await handleRun(post('/api/run', { map: 'gate' }), ctx);
    expect((await handleRun(post('/api/run', { map: 'gate' }), ctx)).status).toBe(429);
  });

  it('lets an admin remove an entry', async () => {
    const { id, sim } = await playRun('gate', 3);
    await submit({ id, handle: 'spam', log: sim.log, endTick: sim.tick });
    ctx.env.ADMIN_TOKEN = 'secret';
    const del = (auth: string) => handleAdmin(new Request('http://x/api/admin?handle=spam&map=gate', { method: 'DELETE', headers: { authorization: auth } }), ctx);
    expect((await del('Bearer wrong')).status).toBe(401);
    expect((await del('Bearer secret')).status).toBe(200);
    const board = await (await handleLeaderboard(new Request('http://x/api/leaderboard?map=gate'), ctx)).json();
    expect(board.entries).toEqual([]);
  }, 60_000);

  it('can be called from other origins, such as an itch.io build', async () => {
    const res = await handleLeaderboard(new Request('http://x/api/leaderboard?map=gate'), ctx);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const pre = handleOptions();
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect(pre.headers.get('access-control-allow-headers')).toContain('content-type');
    // The dev server answers preflights the same way, but not for the admin endpoint.
    expect((await route(new Request('http://x/api/submit', { method: 'OPTIONS' }))).status).toBe(204);
    expect((await route(new Request('http://x/api/admin', { method: 'OPTIONS' }))).status).not.toBe(204);
  });

  it('answers 503 when no store is configured', async () => {
    ctx.store = null;
    expect((await handleRun(post('/api/run', { map: 'gate' }), ctx)).status).toBe(503);
  });
});
