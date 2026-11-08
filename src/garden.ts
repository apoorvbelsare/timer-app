import { type AppState, type BlockStatus, dayKey } from './model';

/**
 * The garden grows from showing up. Every block logged Done or Partly adds
 * growth; skipping costs nothing and nothing ever shrinks.
 *
 * One plant grows from seed to full tree. When it's fully grown, two seedlings
 * start beside it; when those are grown, each makes two more, until 31 trees
 * make a forest. Everything is worked out from the block logs, so the garden
 * always matches the history and needs no state of its own.
 */

export const POINTS: Record<BlockStatus, number> = { done: 2, partly: 1, skipped: 0 };

/** Growth needed to reach each stage: seed, sprout, seedling, sapling, young tree, grown. */
export const STAGE_AT = [0, 2, 5, 10, 16, 24];
export const STAGE_NAMES = ['Seed', 'Sprout', 'Seedling', 'Sapling', 'Young tree', 'Fully grown'];
export const GROWN = STAGE_AT.length - 1;
export const PLANT_COST = STAGE_AT[GROWN];
/** 1 + 2 + 4 + 8 + 16 = 31 trees */
export const GENERATIONS = 5;
export const FOREST_SIZE = 2 ** GENERATIONS - 1;
/** After the forest is complete, every this many points adds a wildflower. */
export const POINTS_PER_FLOWER = 4;
export const MAX_FLOWERS = 60;
/** Days without growth before the garden looks sleepy (it never loses anything). */
export const SLEEPY_AFTER_DAYS = 3;

export type Species = 'oak' | 'pine' | 'birch' | 'cherry' | 'bush';
export const SPECIES_NAMES: Record<Species, string> = { oak: 'oak', pine: 'pine', birch: 'birch', cherry: 'cherry tree', bush: 'berry bush' };

export interface Plant {
  index: number;
  generation: number;
  species: Species;
  points: number;
  stage: number;
  /** Horizontal place in the scene, 0–1 */
  x: number;
}

export interface Flower {
  x: number;
  hue: number;
}

export interface Garden {
  total: number;
  plants: Plant[];
  grownCount: number;
  /** The plants still growing, if any */
  growing: Plant[];
  forestComplete: boolean;
  flowers: Flower[];
  sleepy: boolean;
  lastGrowth: string | null;
}

/** Small deterministic random numbers, so the same garden always looks the same. */
function seeded(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VARIETY: Species[] = ['pine', 'birch', 'oak', 'cherry', 'bush'];

function speciesFor(index: number): Species {
  if (index === 0) return 'oak';
  return VARIETY[Math.floor(seeded(index * 7)() * VARIETY.length)];
}

/**
 * Where each tree stands. The first is centre stage; each generation fills the
 * gaps either side of the one before, with a little jitter so it looks planted
 * by hand rather than by ruler.
 */
function placeFor(index: number, generation: number): number {
  if (generation === 0) return 0.5;
  const slots = 2 ** generation;
  const slot = index - (slots - 1);
  const base = (slot + 0.5) / slots;
  const jitter = (seeded(index * 13)() - 0.5) * (0.6 / slots);
  return Math.min(0.96, Math.max(0.04, base + jitter));
}

function stageFor(points: number): number {
  let stage = 0;
  STAGE_AT.forEach((at, i) => points >= at && (stage = i));
  return stage;
}

/** Total growth and the last day anything grew. */
export function gardenPoints(state: AppState): { total: number; lastGrowth: string | null } {
  let total = 0;
  let lastGrowth: string | null = null;
  for (const [key, rec] of Object.entries(state.days)) {
    const earned = Object.values(rec.log).reduce((sum, status) => sum + POINTS[status], 0);
    total += earned;
    if (earned > 0 && (!lastGrowth || key > lastGrowth)) lastGrowth = key;
  }
  return { total, lastGrowth };
}

/** Lay out the garden for a given amount of growth. */
export function growGarden(total: number): Pick<Garden, 'plants' | 'grownCount' | 'growing' | 'forestComplete' | 'flowers'> {
  const plants: Plant[] = [];
  let remaining = total;

  for (let generation = 0; generation < GENERATIONS; generation++) {
    const count = 2 ** generation;
    const cost = count * PLANT_COST;
    // A generation only starts once the one before is fully grown
    const share = Math.min(remaining, cost);
    for (let i = 0; i < count; i++) {
      const index = count - 1 + i;
      // Growth is shared round-robin, so siblings grow up together
      const points = Math.min(PLANT_COST, Math.floor(share / count) + (i < share % count ? 1 : 0));
      plants.push({ index, generation, species: speciesFor(index), points, stage: stageFor(points), x: placeFor(index, generation) });
    }
    remaining -= share;
    if (share < cost) break;
  }

  const grownCount = plants.filter((p) => p.stage === GROWN).length;
  const forestComplete = grownCount === FOREST_SIZE;
  const random = seeded(99);
  const flowers = forestComplete
    ? Array.from({ length: Math.min(MAX_FLOWERS, Math.floor(remaining / POINTS_PER_FLOWER)) }, () => ({ x: 0.02 + random() * 0.96, hue: random() }))
    : [];
  return { plants, grownCount, growing: plants.filter((p) => p.stage < GROWN), forestComplete, flowers };
}

export function garden(state: AppState, now = Date.now()): Garden {
  const { total, lastGrowth } = gardenPoints(state);
  const today = new Date(now);
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - SLEEPY_AFTER_DAYS);
  return {
    total,
    lastGrowth,
    sleepy: lastGrowth !== null && lastGrowth < dayKey(cutoff),
    ...growGarden(total),
  };
}

/** What changed between two gardens, in words: for the widget's little celebration. */
export function growthNews(before: Garden, after: Garden): string | null {
  if (after.total <= before.total) return null;
  if (after.forestComplete && !before.forestComplete) return 'Your forest is complete. Every tree grew from showing up.';
  const newlyGrown = after.plants.filter((p) => p.stage === GROWN && before.plants[p.index]?.stage !== GROWN);
  if (newlyGrown.length) {
    const name = SPECIES_NAMES[newlyGrown[0].species];
    return after.grownCount === 1 ? `Your ${name} is fully grown. Two seeds have landed beside it.` : `A ${name} is fully grown.`;
  }
  const changed = after.plants.find((p) => p.stage > (before.plants[p.index]?.stage ?? -1) && p.stage > 0);
  if (changed) return `Your ${SPECIES_NAMES[changed.species]} is now a ${STAGE_NAMES[changed.stage].toLowerCase()}.`;
  return 'Your garden grew a little.';
}
