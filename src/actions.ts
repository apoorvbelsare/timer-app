import { type AppState, type BlockStatus, type DayRecord, SNOOZE_MS, emptyDay } from './model';
import { update } from './store';

/** Changes shared by the widget, planner and overlay. */

export function ensureDay(draft: AppState, key: string): DayRecord {
  return (draft.days[key] ??= emptyDay());
}

export function logBlock(key: string, id: string, status: BlockStatus | null) {
  return update((d) => {
    const day = ensureDay(d, key);
    if (status) day.log[id] = status;
    else delete day.log[id];
  });
}

export function startBlock(key: string, id: string) {
  return update((d) => {
    const day = ensureDay(d, key);
    day.startedAt[id] = Date.now();
    day.override.skip = day.override.skip.filter((s) => s !== id);
  });
}

export function skipToday(key: string, id: string) {
  return update((d) => {
    const day = ensureDay(d, key);
    if (!day.override.skip.includes(id)) day.override.skip.push(id);
    day.log[id] = 'skipped';
  });
}

export function restoreToday(key: string, id: string) {
  return update((d) => {
    const day = ensureDay(d, key);
    day.override.skip = day.override.skip.filter((s) => s !== id);
    if (day.log[id] === 'skipped') delete day.log[id];
  });
}

export function snooze(key: string, id: string) {
  return update((d) => {
    ensureDay(d, key).snoozedUntil[id] = Date.now() + SNOOZE_MS;
  });
}
