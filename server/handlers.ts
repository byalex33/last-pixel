import { MAPS } from '../src/game/maps.js';
import { SIM_VERSION, Sim, mapById, replayInto } from '../src/game/sim.js';
import { getStore, type Store } from './store.js';

/*
 * Leaderboard API. A run is opened with POST /api/run, which hands out the run's random seed.
 * When it ends, the browser uploads the run's command log to POST /api/submit, and the server
 * replays it with the real game rules to work out the score. Whatever score the browser thinks
 * it got is never trusted.
 */

const DAY = 24 * 3600;
const RUN_TTL = 30 * DAY;
const MAX_BODY = 1_000_000;
const TOP = 50;

export interface Ctx {
  store: Store | null;
  ip: string;
  env: Record<string, string | undefined>;
}

export interface Entry {
  rank: number;
  handle: string;
  wave: number;
  kills: number;
  endless: boolean;
  at: number;
}

interface RunRecord {
  map: string;
  seed: number;
  v: number;
  at: number;
}

interface Meta {
  handle: string;
  wave: number;
  kills: number;
  endless: boolean;
  at: number;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

const fail = (status: number, error: string) => json({ error }, status);

const unavailable = () => fail(503, 'The leaderboard is not set up on this server.');

export function context(req: Request): Ctx {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
  return { store: getStore(), ip, env };
}

// Counts requests per IP in fixed windows. Returns true when the caller is over the limit.
async function limited(store: Store, bucket: string, ip: string, max: number, windowSec: number) {
  const slot = Math.floor(Date.now() / 1000 / windowSec);
  return (await store.incr(`rl:${bucket}:${ip}:${slot}`, windowSec)) > max;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// X handles: 1-15 letters, digits or underscores. Returns null if the handle is not valid.
export function cleanHandle(raw: unknown, blocklist: string[] = []): string | null {
  if (typeof raw !== 'string') return null;
  const h = raw.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
  const lower = h.toLowerCase();
  if (blocklist.some((w) => w && lower.includes(w))) return null;
  return h;
}

const blocklistOf = (env: Ctx['env']) => (env.HANDLE_BLOCKLIST ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

// Waves cleared first, kills to break ties. Kills stay well below 1e7.
const scoreOf = (wave: number, kills: number) => wave * 1e7 + Math.min(kills, 1e7 - 1);

/* ------------------------------------------------------------- handlers */

export async function handleRun(req: Request, ctx: Ctx) {
  if (req.method !== 'POST') return fail(405, 'Method not allowed');
  const store = ctx.store;
  if (!store) return unavailable();
  const body = await readJson(req);
  const map = typeof body?.map === 'string' ? mapById(body.map) : undefined;
  if (!map) return fail(400, 'Unknown map.');
  if (await limited(store, 'run', ctx.ip, 120, 3600)) return fail(429, 'Too many runs started. Try again later.');
  const id = crypto.randomUUID();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const rec: RunRecord = { map: map.id, seed, v: SIM_VERSION, at: Date.now() };
  await store.set(`run:${id}`, JSON.stringify(rec), RUN_TTL);
  return json({ id, seed, v: SIM_VERSION });
}

export async function handleSubmit(req: Request, ctx: Ctx) {
  if (req.method !== 'POST') return fail(405, 'Method not allowed');
  const store = ctx.store;
  if (!store) return unavailable();
  const body = await readJson(req);
  if (!body) return fail(400, 'Bad request.');
  const handle = cleanHandle(body.handle, blocklistOf(ctx.env));
  if (!handle) return fail(400, 'Enter a valid X handle: up to 15 letters, numbers or underscores.');
  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail(400, 'Bad run id.');
  if (await limited(store, 'submit', ctx.ip, 30, 600)) return fail(429, 'Too many submissions. Try again in a few minutes.');

  const raw = await store.get(`run:${id}`);
  if (!raw) return fail(404, 'This run has expired or does not exist.');
  const run = JSON.parse(raw) as RunRecord;
  if (run.v !== SIM_VERSION) return fail(409, 'This run was played on an older version of the game, so it can’t be ranked.');
  const map = mapById(run.map);
  if (!map) return fail(404, 'Unknown map.');

  // One handle per run, and a cap on how often a run can be re-submitted as it goes on.
  const owner = handle.toLowerCase();
  if (!(await store.setNx(`runhandle:${id}`, owner, RUN_TTL)) && (await store.get(`runhandle:${id}`)) !== owner) {
    return fail(409, 'This run was already submitted under another handle.');
  }
  if ((await store.incr(`runsubs:${id}`, RUN_TTL)) > 10) return fail(429, 'This run has been submitted too many times.');

  const sim = new Sim(map, run.seed);
  const res = replayInto(sim, body.log, typeof body.endTick === 'number' ? body.endTick : -1);
  if (!res.ok) return fail(422, 'This run could not be verified.');
  const wave = sim.cleared;
  const kills = sim.kills;
  if (wave < 1) return fail(422, 'Clear at least one wave to get on the leaderboard.');

  const board = `lb:${map.id}`;
  const metaKey = `lbmeta:${map.id}`;
  const score = scoreOf(wave, kills);
  const prev = await store.zScore(board, owner);
  const improved = prev === null || score > prev;
  if (improved) {
    const meta: Meta = { handle, wave, kills, endless: sim.endless, at: Date.now() };
    await store.zAdd(board, owner, score);
    await store.hSet(metaKey, owner, JSON.stringify(meta));
  }
  const rank = await store.zRevRank(board, owner);
  const [bestRaw] = await store.hGet(metaKey, [owner]);
  const best = bestRaw ? (JSON.parse(bestRaw) as Meta) : null;
  return json({
    wave, kills, improved,
    rank: rank === null ? null : rank + 1,
    best: best && { wave: best.wave, kills: best.kills },
    // What the browser claimed, echoed for debugging if the two ever disagree.
    claimed: typeof body.claim === 'object' ? body.claim : undefined,
  });
}

export async function handleLeaderboard(req: Request, ctx: Ctx) {
  if (req.method !== 'GET') return fail(405, 'Method not allowed');
  const store = ctx.store;
  if (!store) return unavailable();
  const url = new URL(req.url);
  const map = mapById(url.searchParams.get('map') ?? '');
  if (!map) return fail(400, 'Unknown map.');
  const top = await store.zTop(`lb:${map.id}`, TOP);
  const metas = await store.hGet(`lbmeta:${map.id}`, top.map((t) => t.member));
  const entries: Entry[] = [];
  metas.forEach((raw, i) => {
    if (!raw) return;
    const m = JSON.parse(raw) as Meta;
    entries.push({ rank: i + 1, handle: m.handle, wave: m.wave, kills: m.kills, endless: m.endless, at: m.at });
  });
  return json({ map: map.id, entries }, 200, { 'cache-control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=60' });
}

// DELETE /api/admin?map=gate&handle=someone with "Authorization: Bearer <ADMIN_TOKEN>".
export async function handleAdmin(req: Request, ctx: Ctx) {
  const token = ctx.env.ADMIN_TOKEN;
  if (!token) return fail(404, 'Not found');
  if (req.method !== 'DELETE') return fail(405, 'Method not allowed');
  const store = ctx.store;
  if (!store) return unavailable();
  if (!safeEqual(req.headers.get('authorization') ?? '', `Bearer ${token}`)) return fail(401, 'Unauthorized');
  const url = new URL(req.url);
  const handle = (url.searchParams.get('handle') ?? '').replace(/^@/, '').toLowerCase();
  const maps = url.searchParams.get('map') ? [mapById(url.searchParams.get('map')!)] : MAPS;
  if (!handle || maps.some((m) => !m)) return fail(400, 'Pass ?handle= and optionally ?map=');
  for (const m of maps) {
    await store.zRem(`lb:${m!.id}`, handle);
    await store.hDel(`lbmeta:${m!.id}`, handle);
  }
  return json({ ok: true, removed: handle, maps: maps.map((m) => m!.id) });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const ROUTES: Record<string, (req: Request, ctx: Ctx) => Promise<Response>> = {
  '/api/run': handleRun,
  '/api/submit': handleSubmit,
  '/api/leaderboard': handleLeaderboard,
  '/api/admin': handleAdmin,
};

// Used by the dev server, which has no Vercel functions.
export async function route(req: Request): Promise<Response> {
  const fn = ROUTES[new URL(req.url).pathname];
  return fn ? fn(req, context(req)) : fail(404, 'Not found');
}
