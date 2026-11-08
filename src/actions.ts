import { type AppState, type BlockStatus, type DayRecord, type Intention, type Task, SNOOZE_MS, emptyDay, newId } from './model';
import { update } from './store';

/** Changes shared by the widget, planner, overlay and focus windows. */

export function ensureDay(draft: AppState, key: string): DayRecord {
  return (draft.days[key] ??= emptyDay());
}

/** Log how a block went, with an optional one-line note. */
export function logBlock(key: string, id: string, status: BlockStatus | null, note?: string) {
  return update((d) => {
    const day = ensureDay(d, key);
    if (status) day.log[id] = status;
    else delete day.log[id];
    if (note?.trim()) day.notes[id] = note.trim();
  });
}

export function setNote(key: string, id: string, note: string) {
  return update((d) => {
    const day = ensureDay(d, key);
    if (note.trim()) day.notes[id] = note.trim();
    else delete day.notes[id];
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

function ensureIntention(day: DayRecord, id: string): Intention {
  return (day.intentions[id] ??= { text: '', dismissed: false });
}

export function setIntention(key: string, id: string, text: string) {
  return update((d) => {
    ensureIntention(ensureDay(d, key), id).text = text.trim();
  });
}

export function dismissIntention(key: string, id: string) {
  return update((d) => {
    ensureIntention(ensureDay(d, key), id).dismissed = true;
  });
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export function addTask(date: string, title: string, fields: Partial<Omit<Task, 'id' | 'title' | 'date'>> = {}) {
  if (!title.trim()) return Promise.resolve();
  return update((d) => {
    d.tasks.push({
      id: newId(),
      title: title.trim(),
      date,
      estimateMin: 0,
      blockId: null,
      objectiveId: null,
      done: false,
      dropped: false,
      ...fields,
    });
  });
}

export function editTask(id: string, fields: Partial<Omit<Task, 'id'>>) {
  return update((d) => {
    const task = d.tasks.find((t) => t.id === id);
    if (task) Object.assign(task, fields);
  });
}

export function toggleTask(id: string) {
  return update((d) => {
    const task = d.tasks.find((t) => t.id === id);
    if (task) task.done = !task.done;
  });
}

export function removeTask(id: string) {
  return update((d) => void (d.tasks = d.tasks.filter((t) => t.id !== id)));
}

/** Bring unfinished tasks to another day, unscheduled: blocks differ day to day. */
export function moveTasks(ids: string[], date: string) {
  return update((d) => {
    for (const task of d.tasks) if (ids.includes(task.id)) Object.assign(task, { date, blockId: null });
  });
}

/** Let go: no guilt, no carry-over, but still in the record. */
export function dropTasks(ids: string[]) {
  return update((d) => {
    for (const task of d.tasks) if (ids.includes(task.id)) task.dropped = true;
  });
}

// ── Rituals ──────────────────────────────────────────────────────────────────

export function finishPlanning(key: string) {
  return update((d) => void (ensureDay(d, key).planned = true));
}

export function closeDay(key: string, reflection: string) {
  return update((d) => void (ensureDay(d, key).shutdown = { at: Date.now(), reflection: reflection.trim() }));
}

export function reopenDay(key: string) {
  return update((d) => void (ensureDay(d, key).shutdown = null));
}
