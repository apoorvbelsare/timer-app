import { toMinutes } from './model';

/**
 * The hourly ping: a short tune on the hour, different for every hour of the day.
 * The register and shape follow the day, so even an unfamiliar tune says roughly
 * when you are: mornings rise bright and high, afternoons arc in the middle,
 * evenings fall low and soft, nights are quietest of all.
 */

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export interface HourTune {
  hour: number;
  part: DayPart;
  /** Frequencies in Hz, in the order they play */
  notes: number[];
  wave: OscillatorType;
  /** Loudness relative to the chosen volume */
  level: number;
}

/** A major pentatonic scale, two octaves: no note in it can clash with another. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19];

/** One shape per position on the clock face; the time of day decides its register and direction. */
const MOTIFS = [
  [0, 4, 7],
  [0, 1, 2],
  [1, 3, 5],
  [0, 2, 3, 5],
  [2, 4, 6],
  [1, 2, 4],
  [0, 3, 4],
  [2, 3, 5, 7],
  [1, 4, 6],
  [0, 1, 3, 4],
  [3, 5, 6],
  [0, 2, 5, 7],
];

const PARTS: Record<DayPart, { root: number; wave: OscillatorType; level: number }> = {
  // MIDI note numbers for the bottom of the scale
  morning: { root: 74, wave: 'triangle', level: 1 },
  afternoon: { root: 67, wave: 'triangle', level: 0.9 },
  evening: { root: 60, wave: 'sine', level: 0.8 },
  night: { root: 55, wave: 'sine', level: 0.6 },
};

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export function hourTune(hour: number): HourTune {
  const part = dayPart(hour);
  const { root, wave, level } = PARTS[part];
  const steps = [...MOTIFS[hour % 12]];
  if (part === 'morning') steps.sort((a, b) => a - b);
  else if (part === 'afternoon') {
    // An arc: up to the highest note, then back down
    steps.sort((a, b) => a - b);
    const top = steps.pop()!;
    steps.splice(Math.ceil(steps.length / 2), 0, top);
  } else steps.sort((a, b) => b - a);
  return { hour, part, notes: steps.map((s) => midiToHz(root + SCALE[s])), wave, level };
}

/** Quiet hours may wrap past midnight (22:00 → 07:00). */
export function inQuietHours(date: Date, start: string, end: string): boolean {
  const now = date.getHours() * 60 + date.getMinutes();
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** "3 pm", "9 am", "noon", "midnight" */
export function hourLabel(hour: number): string {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return `${hour % 12} ${hour < 12 ? 'am' : 'pm'}`;
}
