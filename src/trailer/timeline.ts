// Song and picture share one clock, in seconds. 120 BPM: a beat is 0.5s, a bar is 2s.
export const BEAT = 0.5;
export const BAR = 2;
export const END = 94;

export const T = {
  logo: 12,
  impact: 14,
  drop: 16,
  montage: 20,
  lineup: 36,
  roster: 38,
  horde: 42,
  maps: 46,
  mapLen: 1.5,
  tapeStop: 53.5,
  everyTen: 54,
  boss: 56,
  atTheEnd: 62,
  eraser: 64,
  finale: 68,
  cut: 80,
  outro: 86,
} as const;

export interface TypeCue {
  at: number;
  out: number;
  lines: string[];
  size: number;
  rate: number; // seconds per character
  red?: number[]; // lines drawn in red
  y?: number;
  gap?: number; // seconds between lines
}

// Typed captions on black. The music adds a key click for every character.
export const TYPED: TypeCue[] = [
  { at: 1.6, out: 4.5, lines: ['JAMES.'], size: 150, rate: 0.13 },
  { at: 4.9, out: 8.3, lines: ['ALEX HAS STARTED MAKING', 'A NEW GAME.'], size: 66, rate: 0.045, red: [1], gap: 0.3 },
  { at: 8.6, out: 11.7, lines: ["AND YOU'RE GETTING", 'THE FIRST LOOK.'], size: 58, rate: 0.04, gap: 0.25, red: [1] },
  { at: 54.15, out: 55.9, lines: ['EVERY TEN WAVES...'], size: 64, rate: 0.05 },
  { at: 62.15, out: 63.9, lines: ['AND AT THE VERY END...'], size: 64, rate: 0.05 },
  { at: 80.9, out: 82.4, lines: ['JAMES,'], size: 150, rate: 0.12 },
  { at: 82.6, out: 85.8, lines: ['ARE YOU READY', 'TO PLAY IT SOON?'], size: 84, rate: 0.05, red: [1], gap: 0.35 },
];

// When each character of a cue appears, for both the captions and the key clicks.
export function charTimes(c: TypeCue): number[][] {
  let t = c.at;
  return c.lines.map((line, i) => {
    if (i > 0) t += c.gap ?? 0.2;
    return [...line].map(() => {
      const at = t;
      t += c.rate;
      return at;
    });
  });
}

// Sections where the drums play straight fours; the picture pulses with them.
export const GROOVE: [number, number][] = [
  [T.drop, T.tapeStop],
  [T.finale, T.cut],
];

export function inGroove(t: number) {
  return GROOVE.some(([a, b]) => t >= a && t < b);
}
