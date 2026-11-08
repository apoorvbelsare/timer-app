import { type AppState, type BlockStatus, type DayRecord, type Intention, SNOOZE_MS, emptyDay, newId } from './model';
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

function ensureIntention(day: DayRecord, id: string): Intention {
  return (day.intentions[id] ??= { text: '', todos: [], dismissed: false });
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

export function addTodo(key: string, id: string, text: string) {
  if (!text.trim()) return Promise.resolve();
  return update((d) => {
    ensureIntention(ensureDay(d, key), id).todos.push({ id: newId(), text: text.trim(), done: false });
  });
}

export function toggleTodo(key: string, id: string, todoId: string) {
  return update((d) => {
    const todo = ensureIntention(ensureDay(d, key), id).todos.find((t) => t.id === todoId);
    if (todo) todo.done = !todo.done;
  });
}

export function removeTodo(key: string, id: string, todoId: string) {
  return update((d) => {
    const intention = ensureIntention(ensureDay(d, key), id);
    intention.todos = intention.todos.filter((t) => t.id !== todoId);
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

// ── Parking lot ──────────────────────────────────────────────────────────────

export function parkThought(text: string) {
  if (!text.trim()) return Promise.resolve();
  return update((d) => void d.parked.push({ id: newId(), text: text.trim(), at: Date.now(), done: false }));
}

export function setParkedDone(id: string, done: boolean) {
  return update((d) => {
    const item = d.parked.find((p) => p.id === id);
    if (item) item.done = done;
  });
}

export function removeParked(id: string) {
  return update((d) => void (d.parked = d.parked.filter((p) => p.id !== id)));
}

/** Turn a parked thought into a to-do in one of today's blocks, and clear it from the lot. */
export function parkedToTodo(id: string, key: string, blockId: string) {
  return update((d) => {
    const item = d.parked.find((p) => p.id === id);
    if (!item) return;
    const day = ensureDay(d, key);
    const intention = (day.intentions[blockId] ??= { text: '', todos: [], dismissed: false });
    intention.todos.push({ id: newId(), text: item.text, done: false });
    item.done = true;
  });
}
