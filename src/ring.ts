import type { Snapshot } from './engine';

/** Shared by the widget's small ring and the focus window's big one. */

export const RING_R = 42;
export const CIRCUMFERENCE = 2 * Math.PI * RING_R;

export function ringText(ms: number): [string, string] {
  if (ms < 60_000) return [String(Math.max(0, Math.ceil(ms / 1000))), 'sec'];
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return [String(minutes), 'min'];
  return [`${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`, 'left'];
}

/** The ring warms up as the end gets close: block colour, then ochre, then clay. */
export function ringColor(s: Snapshot): string {
  if (!s.current) return 'var(--ring-idle)';
  if (s.remainingMs <= 60_000) return 'var(--coral)';
  if (s.remainingMs <= 5 * 60_000) return 'var(--amber)';
  return s.current.color;
}

/** Fraction of the ring still showing. */
export function ringRemaining(s: Snapshot): number {
  return s.current || s.next ? 1 - s.progress : 0;
}
