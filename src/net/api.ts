import type { Entry } from '../../server/handlers';

export type { Entry };

export interface SubmitResult {
  wave: number;
  kills: number;
  rank: number | null;
  improved: boolean;
  best: { wave: number; kills: number } | null;
}

// Empty on the main site, where the API lives on the same origin. Builds hosted elsewhere
// (itch.io) set VITE_API_BASE to the site that runs the API, e.g. https://lastpixel.alex.codes.
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new Error('Could not reach the leaderboard. Check your connection.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? 'The leaderboard is unavailable right now.');
  return body as T;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// A leaderboard ticket for a new run: its id and the seed it must be played with.
export const openRun = (map: string) => call<{ id: string; seed: number }>('/api/run', post({ map }));

export const submitRun = (body: { id: string; handle: string; log: number[][]; endTick: number; claim: { wave: number; kills: number } }) =>
  call<SubmitResult>('/api/submit', post(body));

export const fetchBoard = (map: string) => call<{ map: string; entries: Entry[] }>(`/api/leaderboard?map=${encodeURIComponent(map)}`);
