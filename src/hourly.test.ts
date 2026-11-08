import { describe, expect, it } from 'vitest';
import { dayPart, hourLabel, hourTune, inQuietHours } from './hourly';

const at = (h: number, m = 0) => new Date(2026, 10, 8, h, m);

describe('hourly ping', () => {
  it('gives every hour of the day its own tune', () => {
    const tunes = Array.from({ length: 24 }, (_, h) => hourTune(h).notes.map((n) => n.toFixed(2)).join(','));
    expect(new Set(tunes).size).toBe(24);
  });

  it('rises in the morning and falls in the evening', () => {
    const rising = (notes: number[]) => notes.every((n, i) => i === 0 || n > notes[i - 1]);
    const falling = (notes: number[]) => notes.every((n, i) => i === 0 || n < notes[i - 1]);
    for (const h of [5, 8, 11]) expect(rising(hourTune(h).notes)).toBe(true);
    for (const h of [17, 20, 23, 2]) expect(falling(hourTune(h).notes)).toBe(true);
  });

  it('sits higher in the morning than in the evening', () => {
    const lowest = (h: number) => Math.min(...hourTune(h).notes);
    expect(lowest(9)).toBeGreaterThan(lowest(15));
    expect(lowest(15)).toBeGreaterThan(lowest(19));
    expect(dayPart(4)).toBe('night');
    expect(dayPart(12)).toBe('afternoon');
  });

  it('respects quiet hours, including ones that wrap past midnight', () => {
    expect(inQuietHours(at(23), '22:00', '07:00')).toBe(true);
    expect(inQuietHours(at(6, 59), '22:00', '07:00')).toBe(true);
    expect(inQuietHours(at(7), '22:00', '07:00')).toBe(false);
    expect(inQuietHours(at(13), '12:00', '14:00')).toBe(true);
    expect(inQuietHours(at(15), '12:00', '14:00')).toBe(false);
    expect(inQuietHours(at(3), '00:00', '00:00')).toBe(false);
  });

  it('names hours the way people say them', () => {
    expect([0, 9, 12, 15].map(hourLabel)).toEqual(['midnight', '9 am', 'noon', '3 pm']);
  });
});
