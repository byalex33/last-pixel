import { MAPS } from './maps';

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
  traps?: TrapSave[]; // missing from saves made before placeables
  perks?: string[];
  startPerks?: string[]; // perks the round started with, for restarting it; missing from older saves
}

export interface TrapSave {
  type: string;
  tx: number;
  ty: number;
  uses: number;
}

export interface Progress {
  round: number; // index into MAPS of the round in progress
  unlocked: number; // index into MAPS of the furthest round reached, never below round
  perks?: string[]; // perks carried into the round in progress from the rounds before it
  snapshot?: Snapshot;
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Progress>) : null;
    if (parsed && typeof parsed.round === 'number') {
      const { round, snapshot } = parsed;
      const perks = Array.isArray(parsed.perks) ? parsed.perks.filter((k) => typeof k === 'string') : [];
      // Older saves only kept the round in progress. Endless is only offered once a round is
      // won, so an Endless checkpoint means the next round was already open.
      const unlocked = typeof parsed.unlocked === 'number'
        ? parsed.unlocked
        : Math.min(round + (snapshot?.endless ? 1 : 0), MAPS.length - 1);
      return { round, unlocked: Math.max(round, unlocked), perks, snapshot };
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return { round: 0, unlocked: 0, perks: [] };
}

// Saves the round in progress. The furthest round reached only ever rises, so restarting,
// replaying or going Endless on an earlier round never locks a later one again.
// Carried perks are kept unless new ones are given: a round won passes on everything owned,
// and a new campaign passes on none. Restarting keeps only what the round started with.
export function saveProgress({ round, snapshot, perks }: { round: number; snapshot?: Snapshot; perks?: string[] }): Progress {
  const prev = loadProgress();
  const progress: Progress = { round, unlocked: Math.max(round, prev.unlocked), perks: perks ?? prev.perks, snapshot };
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* storage unavailable */
  }
  return progress;
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

/* ------------------------------------------------------------------ tip */

const TIP_KEY = 'lastpixel.tip.v1';

export function loadTipClosed(): boolean {
  try {
    return localStorage.getItem(TIP_KEY) === 'closed';
  } catch {
    return false;
  }
}

export function saveTipClosed() {
  try {
    localStorage.setItem(TIP_KEY, 'closed');
  } catch {
    /* storage unavailable */
  }
}

/* --------------------------------------------------------- achievements */

const ACHIEVE_KEY = 'lastpixel.achievements.v1';

export interface AchievementSave {
  unlocked: string[];
  kills: number; // foes destroyed across every game
}

export function loadAchievements(): AchievementSave {
  try {
    const raw = localStorage.getItem(ACHIEVE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AchievementSave>) : null;
    return {
      unlocked: Array.isArray(parsed?.unlocked) ? parsed.unlocked.filter((id) => typeof id === 'string') : [],
      kills: typeof parsed?.kills === 'number' ? parsed.kills : 0,
    };
  } catch {
    return { unlocked: [], kills: 0 };
  }
}

function saveAchievements(save: AchievementSave) {
  try {
    localStorage.setItem(ACHIEVE_KEY, JSON.stringify(save));
  } catch {
    /* storage unavailable */
  }
}

// Returns true only the first time an achievement is unlocked.
export function unlockAchievement(id: string): boolean {
  const save = loadAchievements();
  if (save.unlocked.includes(id)) return false;
  save.unlocked.push(id);
  saveAchievements(save);
  return true;
}

// Adds to the lifetime kill count and returns the new total.
export function addKills(n: number): number {
  const save = loadAchievements();
  save.kills += Math.max(0, n);
  saveAchievements(save);
  return save.kills;
}
