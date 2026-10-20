// Trigonometry and distance built only from + - * / and sqrt.
//
// Math.sin, Math.atan2 and Math.hypot are approximations each JS engine implements its own way,
// so Chrome, Firefox and Safari can disagree in the last digit. Basic arithmetic and sqrt are
// exactly rounded by IEEE 754 everywhere, so these give identical results in every browser and
// on the server. The simulation uses them for anything that can change the outcome of a run.

const HALF_PI = Math.PI / 2;
const SIXTH_PI = Math.PI / 6;
const SQRT3 = Math.sqrt(3);

// Taylor series on [-pi/4, pi/4], carried far enough to reach full double precision.
function sinCore(x: number) {
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800
    + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
}

function cosCore(x: number) {
  const x2 = x * x;
  return 1 + x2 * (-1 / 2 + x2 * (1 / 24 + x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800
    + x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 / 20922789888000)))))));
}

// Splits x into a quarter-turn count and a remainder in [-pi/4, pi/4].
function quarter(x: number) {
  const k = Math.round(x / HALF_PI);
  return { q: ((k % 4) + 4) % 4, r: x - k * HALF_PI };
}

export function dsin(x: number) {
  const { q, r } = quarter(x);
  return q === 0 ? sinCore(r) : q === 1 ? cosCore(r) : q === 2 ? -sinCore(r) : -cosCore(r);
}

export function dcos(x: number) {
  const { q, r } = quarter(x);
  return q === 0 ? cosCore(r) : q === 1 ? -sinCore(r) : q === 2 ? -cosCore(r) : sinCore(r);
}

// atan for |t| <= 2 - sqrt(3), where the series converges fast.
function atanCore(t: number) {
  const t2 = t * t;
  let s = 0;
  for (let n = 29; n >= 1; n -= 2) s = 1 / n - t2 * s;
  return t * s;
}

function atanPos(z: number) {
  const invert = z > 1;
  if (invert) z = 1 / z;
  // atan(z) = pi/6 + atan((sqrt3 z - 1) / (sqrt3 + z)) brings z in [0, 1] down to |t| <= 0.268.
  const a = z > 2 - SQRT3 ? SIXTH_PI + atanCore((SQRT3 * z - 1) / (SQRT3 + z)) : atanCore(z);
  return invert ? HALF_PI - a : a;
}

export function datan2(y: number, x: number) {
  if (x === 0) return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
  const z = y / x;
  const a = z < 0 ? -atanPos(-z) : atanPos(z);
  if (x > 0) return a;
  return y >= 0 ? a + Math.PI : a - Math.PI;
}

export function dist(dx: number, dy: number) {
  return Math.sqrt(dx * dx + dy * dy);
}
