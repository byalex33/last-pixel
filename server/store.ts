import { Redis } from '@upstash/redis';

// The few storage operations the leaderboard needs. Upstash Redis in production, an in-memory
// stand-in for local development and tests.
export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  // Sets the key only if it does not exist. Returns false if it already did.
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  // Increments a counter, starting its expiry when it is created.
  incr(key: string, ttlSec: number): Promise<number>;
  zScore(key: string, member: string): Promise<number | null>;
  zAdd(key: string, member: string, score: number): Promise<void>;
  zRevRank(key: string, member: string): Promise<number | null>;
  zTop(key: string, n: number): Promise<{ member: string; score: number }[]>;
  zRem(key: string, member: string): Promise<void>;
  hSet(key: string, field: string, value: string): Promise<void>;
  hGet(key: string, fields: string[]): Promise<(string | null)[]>;
  hDel(key: string, field: string): Promise<void>;
}

class UpstashStore implements Store {
  constructor(private r: Redis) {}

  async get(key: string) {
    return (await this.r.get<string>(key)) ?? null;
  }

  async set(key: string, value: string, ttlSec: number) {
    await this.r.set(key, value, { ex: ttlSec });
  }

  async setNx(key: string, value: string, ttlSec: number) {
    return (await this.r.set(key, value, { ex: ttlSec, nx: true })) !== null;
  }

  async incr(key: string, ttlSec: number) {
    const n = await this.r.incr(key);
    if (n === 1) await this.r.expire(key, ttlSec);
    return n;
  }

  async zScore(key: string, member: string) {
    const s = await this.r.zscore(key, member);
    return s === null || s === undefined ? null : Number(s);
  }

  async zAdd(key: string, member: string, score: number) {
    await this.r.zadd(key, { score, member });
  }

  async zRevRank(key: string, member: string) {
    const r = await this.r.zrevrank(key, member);
    return r === null || r === undefined ? null : Number(r);
  }

  async zTop(key: string, n: number) {
    const flat = await this.r.zrange<string[]>(key, 0, n - 1, { rev: true, withScores: true });
    const out: { member: string; score: number }[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ member: String(flat[i]), score: Number(flat[i + 1]) });
    return out;
  }

  async zRem(key: string, member: string) {
    await this.r.zrem(key, member);
  }

  async hSet(key: string, field: string, value: string) {
    await this.r.hset(key, { [field]: value });
  }

  async hGet(key: string, fields: string[]) {
    if (!fields.length) return [];
    const res = await this.r.hmget<Record<string, string | null>>(key, ...fields);
    return fields.map((f) => (res?.[f] ?? null) as string | null);
  }

  async hDel(key: string, field: string) {
    await this.r.hdel(key, field);
  }
}

export class MemoryStore implements Store {
  private kv = new Map<string, { v: string; exp: number }>();
  private z = new Map<string, Map<string, number>>();
  private h = new Map<string, Map<string, string>>();

  private live(key: string) {
    const e = this.kv.get(key);
    if (e && e.exp < Date.now()) this.kv.delete(key);
    return this.kv.get(key);
  }

  async get(key: string) {
    return this.live(key)?.v ?? null;
  }

  async set(key: string, value: string, ttlSec: number) {
    this.kv.set(key, { v: value, exp: Date.now() + ttlSec * 1000 });
  }

  async setNx(key: string, value: string, ttlSec: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSec);
    return true;
  }

  async incr(key: string, ttlSec: number) {
    const e = this.live(key);
    const n = (e ? Number(e.v) : 0) + 1;
    this.kv.set(key, { v: String(n), exp: e?.exp ?? Date.now() + ttlSec * 1000 });
    return n;
  }

  private zset(key: string) {
    let s = this.z.get(key);
    if (!s) this.z.set(key, (s = new Map()));
    return s;
  }

  // Highest score first; ties in reverse name order, as Redis orders them.
  private sorted(key: string) {
    return [...this.zset(key).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
  }

  async zScore(key: string, member: string) {
    return this.zset(key).get(member) ?? null;
  }

  async zAdd(key: string, member: string, score: number) {
    this.zset(key).set(member, score);
  }

  async zRevRank(key: string, member: string) {
    const i = this.sorted(key).findIndex(([m]) => m === member);
    return i < 0 ? null : i;
  }

  async zTop(key: string, n: number) {
    return this.sorted(key).slice(0, n).map(([member, score]) => ({ member, score }));
  }

  async zRem(key: string, member: string) {
    this.zset(key).delete(member);
  }

  private hash(key: string) {
    let s = this.h.get(key);
    if (!s) this.h.set(key, (s = new Map()));
    return s;
  }

  async hSet(key: string, field: string, value: string) {
    this.hash(key).set(field, value);
  }

  async hGet(key: string, fields: string[]) {
    const s = this.hash(key);
    return fields.map((f) => s.get(f) ?? null);
  }

  async hDel(key: string, field: string) {
    this.hash(key).delete(field);
  }
}

const env = () => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

// Upstash when its credentials are set (the Vercel integration adds KV_REST_API_*), an in-memory
// store when running locally, and nothing on a deployment that has not been set up yet.
export function getStore(): Store | null {
  const e = env();
  const url = e.KV_REST_API_URL ?? e.UPSTASH_REDIS_REST_URL;
  const token = e.KV_REST_API_TOKEN ?? e.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashStore(new Redis({ url, token, automaticDeserialization: false }));
  if (e.VERCEL) return null;
  const g = globalThis as { __lastPixelStore?: MemoryStore };
  return (g.__lastPixelStore ??= new MemoryStore());
}
