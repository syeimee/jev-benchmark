export type Rng = () => number;

/** Deterministic PRNG (mulberry32) so runs can be reproduced from a seed. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Samples a key from a probability map; falls through to the last key on rounding error. */
export function sampleKey(probabilities: Record<string, number>, rng: Rng): string {
  const entries = Object.entries(probabilities);
  if (entries.length === 0) throw new Error('Cannot sample from an empty distribution');
  let r = rng();
  for (const [key, p] of entries) {
    r -= p;
    if (r < 0) return key;
  }
  return entries[entries.length - 1]![0];
}
