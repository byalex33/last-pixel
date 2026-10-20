const BEST_KEY = 'lastpixel.best.v1';
const MUTE_KEY = 'lastpixel.muted.v1';

export function loadBest(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveBest(mapId: string, wave: number) {
  try {
    const best = loadBest();
    if ((best[mapId] ?? 0) < wave) {
      best[mapId] = wave;
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
    }
  } catch {
    /* storage unavailable */
  }
}

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------- campaign */

const PROGRESS_KEY = 'lastpixel.progress.v1';

export interface TowerSave {
  type: string;
  tx: number;
  ty: number;
  level: number;
  mode: string;
  spent: number;
  kills: number;
  dmgDone: number;
}

// A laid mine, tied to its Minelayer by the tower's tile.
export interface MineSave {
  tx: number;
  ty: number;
  x: number;
  y: number;
  dmg: number;
  splash: number;
}

// A between-waves checkpoint of the round in progress.
export interface Snapshot {
  mapId: string;
  wave: number;
  gold: number;
  lives: number;
  kills: number;
  endless: boolean;
  speed: number;
  autoWave: boolean;
  towers: TowerSave[];
  mines?: MineSave[]; // missing from saves made before mines were kept
}

export interface Progress {
  round: number; // index into MAPS
  snapshot?: Snapshot;
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Progress>) : null;
    if (parsed && typeof parsed.round === 'number') return { round: parsed.round, snapshot: parsed.snapshot };
  } catch {
    /* storage unavailable or corrupt */
  }
  return { round: 0 };
}

export function saveProgress(progress: Progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* storage unavailable */
  }
}

/* ---------------------------------------------------------------- story */

const STORY_KEY = 'lastpixel.story.v1';

// Highest round whose story intro has been read, or -1.
export function loadStorySeen(): number {
  try {
    const n = Number(localStorage.getItem(STORY_KEY));
    return localStorage.getItem(STORY_KEY) === null || Number.isNaN(n) ? -1 : n;
  } catch {
    return -1;
  }
}

export function saveStorySeen(round: number) {
  try {
    localStorage.setItem(STORY_KEY, String(round));
  } catch {
    /* storage unavailable */
  }
}
