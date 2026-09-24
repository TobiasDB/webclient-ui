/** Human-like mouse paths -- the TypeScript port of `webclient/dom/mouse.py`, point for
 * point: the same xorshift32 PRNG, the same seed from the endpoints, the same Bézier and
 * easing. The live driver moves the real pointer along it; the Player draws it. */

export function pathSeed(x1: number, y1: number, x2: number, y2: number): number {
  let h = 2166136261 >>> 0;
  for (const v of [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]) {
    h = (h ^ ((v + 0x7fff) >>> 0)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

function xorshift32(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= (s << 13) >>> 0; s >>>= 0;
    s ^= s >>> 17; s >>>= 0;
    s ^= (s << 5) >>> 0; s >>>= 0;
    return s / 4294967296;
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function humanMousePath(x1: number, y1: number, x2: number, y2: number, resolution?: number, seed?: number): [number, number][] {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const n = resolution ?? Math.max(8, Math.min(48, Math.floor(dist / 14) + 8));
  if (dist < 1e-6) return [[x1, y1], [x1, y1]];
  const rnd = xorshift32(seed ?? pathSeed(x1, y1, x2, y2));
  const side = rnd() < 0.5 ? 1 : -1;
  const bow = dist * (0.10 + 0.15 * rnd()) * side;
  const nx = -dy / dist, ny = dx / dist;
  const c1: [number, number] = [x1 + dx * (0.25 + 0.15 * rnd()) + nx * bow, y1 + dy * 0.3 + ny * bow];
  const c2: [number, number] = [x1 + dx * (0.65 + 0.15 * rnd()) + nx * bow * 0.6, y1 + dy * 0.7 + ny * bow * 0.6];
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1); const t = u * u * (3 - 2 * u); const mt = 1 - t;
    let bx = mt ** 3 * x1 + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * x2;
    let by = mt ** 3 * y1 + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * y2;
    if (i > 0 && i < n - 1) { bx += (rnd() - 0.5) * 1.2; by += (rnd() - 0.5) * 1.2; }
    pts.push([round2(bx), round2(by)]);
  }
  pts[0] = [x1, y1]; pts[n - 1] = [x2, y2];
  return pts;
}

export function mouseDurationMs(distance: number): number {
  return Math.min(700, 120 + 90 * Math.log2(1 + Math.max(0, distance) / 50));
}

export function pathTimingsMs(n: number, durationMs: number): number[] {
  if (n <= 1) return [0];
  return Array.from({ length: n }, (_, i) => { const u = i / (n - 1); return Math.round(durationMs * (u * u * (3 - 2 * u)) * 10) / 10; });
}
