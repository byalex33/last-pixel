export const TILE = 16;
export const COLS = 20;
export const ROWS = 12;
export const W = COLS * TILE;
export const H = ROWS * TILE;
export const STEP = 1 / 60;
export const TAU = Math.PI * 2;

// Strict monochrome ramp plus a single red accent ramp.
export const PAL = {
  k0: '#080808',
  k1: '#131313',
  k2: '#202020',
  k3: '#343434',
  k4: '#585858',
  k5: '#8e8e8e',
  k6: '#cfcfcf',
  k7: '#f4f4f4',
  r0: '#3a0710',
  r1: '#7a0f1d',
  r2: '#d11d32',
  r3: '#ff5a6c',
} as const;
