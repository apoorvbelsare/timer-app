import { describe, expect, it } from 'vitest';
import { FOREST_SIZE, GROWN, PLANT_COST, garden, gardenPoints, growGarden, growthNews } from './garden';
import { type BlockStatus, defaultState, emptyDay } from './model';

function withLogs(days: Record<string, BlockStatus[]>) {
  const s = defaultState();
  for (const [key, statuses] of Object.entries(days)) {
    s.days[key] = { ...emptyDay(), log: Object.fromEntries(statuses.map((st, i) => [`b${i}`, st])) };
  }
  return s;
}

describe('garden', () => {
  it('earns 2 for done, 1 for partly, nothing for skipped', () => {
    const s = withLogs({ '2026-11-01': ['done', 'partly', 'skipped'], '2026-11-03': ['done'], '2026-11-04': ['skipped'] });
    expect(gardenPoints(s)).toEqual({ total: 5, lastGrowth: '2026-11-03' });
  });

  it('grows one plant first, through its stages', () => {
    expect(growGarden(0).plants).toMatchObject([{ index: 0, species: 'oak', stage: 0 }]);
    expect(growGarden(6).plants).toMatchObject([{ stage: 2, points: 6 }]);
    expect(growGarden(PLANT_COST - 1).plants).toHaveLength(1);
  });

  it('starts two seedlings once the first plant is fully grown', () => {
    const g = growGarden(PLANT_COST + 3);
    expect(g.plants.map((p) => [p.generation, p.stage])).toEqual([
      [0, GROWN],
      [1, 1],
      [1, 0],
    ]);
    expect(g.plants[1].points).toBe(2);
    expect(g.plants[2].points).toBe(1);
    expect(g.grownCount).toBe(1);
  });

  it('becomes a forest of 31, then wildflowers', () => {
    const forest = growGarden(FOREST_SIZE * PLANT_COST);
    expect(forest.plants).toHaveLength(FOREST_SIZE);
    expect(forest.forestComplete).toBe(true);
    expect(forest.flowers).toHaveLength(0);
    expect(growGarden(FOREST_SIZE * PLANT_COST + 10).flowers).toHaveLength(2);
    expect(growGarden(FOREST_SIZE * PLANT_COST - 1).forestComplete).toBe(false);
  });

  it('places every tree in the scene, the first one centre stage', () => {
    const { plants } = growGarden(FOREST_SIZE * PLANT_COST);
    expect(plants[0].x).toBe(0.5);
    expect(plants.every((p) => p.x > 0 && p.x < 1)).toBe(true);
  });

  it('looks sleepy after a few days without growth, and never shrinks', () => {
    const s = withLogs({ '2026-11-01': ['done', 'done'] });
    const awake = garden(s, new Date(2026, 10, 3).getTime());
    const sleepy = garden(s, new Date(2026, 10, 8).getTime());
    expect(awake.sleepy).toBe(false);
    expect(sleepy.sleepy).toBe(true);
    expect(sleepy.total).toBe(awake.total);
  });

  it('describes growth in words', () => {
    const at = (total: number) => ({ ...growGarden(total), total, sleepy: false, lastGrowth: null });
    expect(growthNews(at(4), at(4))).toBeNull();
    expect(growthNews(at(4), at(5))).toBe('Your oak is now a seedling.');
    expect(growthNews(at(PLANT_COST - 1), at(PLANT_COST + 1))).toMatch(/fully grown\. Two seeds/);
  });
});
