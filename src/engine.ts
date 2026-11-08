import {
  type AppState,
  type Block,
  type DayRecord,
  type Objective,
  type Settings,
  type Step,
  type Task,
  atMinutes,
  dayKey,
  emptyDay,
  toMinutes,
} from './model';

/** A block placed on a concrete date, with today's changes applied. */
export interface Planned extends Block {
  startMs: number;
  endMs: number;
  oneOff: boolean;
  skippedToday: boolean;
  movedToday: boolean;
}

export interface StepInfo {
  step: Step;
  index: number;
  remainingMs: number;
}

/**
 * Something the person needs to answer.
 * `review`: a block ended and hasn't been logged yet, which doubles as the
 * "did you actually switch?" check against hyperfocus.
 * `start`: an optional block is on and waiting for Start or Skip.
 * `intention`: a block has begun; what do you mean to get done? Never nags.
 */
export interface Prompt {
  kind: 'start' | 'review' | 'intention';
  block: Planned;
  sinceMs: number;
}

export interface Snapshot {
  now: number;
  key: string;
  plan: Planned[];
  current: Planned | null;
  awaitingStart: boolean;
  next: Planned | null;
  /** Time left in the current block, or until the next one during free time */
  remainingMs: number;
  totalMs: number;
  /** 0 → just started, 1 → over */
  progress: number;
  step: StepInfo | null;
  prompt: Prompt | null;
}

export type Escalation = 'none' | 'notify' | 'overlay';

/** Blocks that ended longer ago than this are left for the planner, not prompted. */
export const REVIEW_WINDOW_MS = 3 * 60 * 60_000;
/** Past this the person was probably away; a full-screen interruption on return helps nobody. */
export const OVERLAY_WINDOW_MS = 60 * 60_000;

export function dayRecord(state: AppState, key: string): DayRecord {
  return state.days[key] ?? emptyDay();
}

export function planFor(state: AppState, date: Date, includeSkipped = false): Planned[] {
  const rec = dayRecord(state, dayKey(date));
  const weekday = date.getDay();
  const fromRoutine = state.routine.filter((b) => b.days.includes(weekday)).map((b) => ({ block: b, oneOff: false }));
  const oneOffs = rec.override.extra.map((b) => ({ block: b, oneOff: true }));

  return [...fromRoutine, ...oneOffs]
    .map(({ block, oneOff }): Planned => {
      const moved = rec.override.times[block.id];
      const start = moved?.start ?? block.start;
      const end = moved?.end ?? block.end;
      return {
        ...block,
        start,
        end,
        startMs: atMinutes(date, toMinutes(start)),
        endMs: atMinutes(date, toMinutes(end)),
        oneOff,
        skippedToday: rec.override.skip.includes(block.id),
        movedToday: moved !== undefined,
      };
    })
    .filter((p) => includeSkipped || !p.skippedToday)
    .sort((a, b) => a.startMs - b.startMs);
}

/** Steps run back to back from when the block started; null once they're all used up. */
export function currentStep(block: Block, elapsedMs: number): StepInfo | null {
  let elapsedSteps = 0;
  for (const [index, step] of block.steps.entries()) {
    elapsedSteps += step.minutes * 60_000;
    if (elapsedMs < elapsedSteps) return { step, index, remainingMs: elapsedSteps - elapsedMs };
  }
  return null;
}

export function snapshot(state: AppState, now: number): Snapshot {
  const date = new Date(now);
  const key = dayKey(date);
  const rec = dayRecord(state, key);
  const plan = planFor(state, date);
  const current = plan.find((p) => p.startMs <= now && now < p.endMs) ?? null;
  const next = plan.find((p) => p.startMs > now) ?? null;

  let awaitingStart = false;
  let remainingMs = 0;
  let totalMs = 0;
  let step: StepInfo | null = null;

  if (current) {
    const started = rec.startedAt[current.id];
    awaitingStart = current.optional && started === undefined;
    // An optional block started late gets a ring sized to the time that was actually left
    const anchor = Math.min(Math.max(started ?? current.startMs, current.startMs), now);
    totalMs = current.endMs - anchor;
    remainingMs = current.endMs - now;
    if (!awaitingStart) step = currentStep(current, now - anchor);
  } else if (next) {
    const previousEnd = plan
      .filter((p) => p.endMs <= now)
      .reduce((latest, p) => Math.max(latest, p.endMs), atMinutes(date, 0));
    totalMs = next.startMs - previousEnd;
    remainingMs = next.startMs - now;
  }

  const progress = totalMs > 0 ? Math.min(1, Math.max(0, 1 - remainingMs / totalMs)) : 0;
  return {
    now,
    key,
    plan,
    current,
    awaitingStart,
    next,
    remainingMs,
    totalMs,
    progress,
    step,
    prompt: pickPrompt(plan, rec, state.settings, current, awaitingStart, now),
  };
}

/** Not worth asking for an intention with less than this left in the block. */
export const INTENTION_MIN_LEFT_MS = 5 * 60_000;

function pickPrompt(
  plan: Planned[],
  rec: DayRecord,
  settings: Settings,
  current: Planned | null,
  awaitingStart: boolean,
  now: number,
): Prompt | null {
  // Oldest first, so a backlog gets answered in the order it happened.
  // Optional blocks nobody started have nothing to review.
  const review = plan.find(
    (p) =>
      p.endMs <= now &&
      now - p.endMs < REVIEW_WINDOW_MS &&
      rec.log[p.id] === undefined &&
      (!p.optional || rec.startedAt[p.id] !== undefined),
  );
  if (review) return { kind: 'review', block: review, sinceMs: review.endMs };
  if (current && awaitingStart) return { kind: 'start', block: current, sinceMs: current.startMs };
  if (
    current &&
    settings.askIntention &&
    rec.intentions[current.id] === undefined &&
    current.endMs - now > INTENTION_MIN_LEFT_MS
  ) {
    return { kind: 'intention', block: current, sinceMs: rec.startedAt[current.id] ?? current.startMs };
  }
  return null;
}

/**
 * The hyperfocus guard. When a block ends unanswered, the widget card shows at once,
 * a toast follows after `escalateAfterMin`, and the full-screen overlay after twice that.
 * Optional blocks only ever get the toast.
 */
export function escalation(prompt: Prompt | null, rec: DayRecord, settings: Settings, now: number): Escalation {
  if (!prompt || prompt.kind === 'intention') return 'none';
  if (prompt.kind === 'start') return 'notify';

  const step = settings.escalateAfterMin * 60_000;
  const snooze = rec.snoozedUntil[prompt.block.id];
  if (snooze !== undefined && now < snooze) return 'none';
  // A snooze picks back up at the toast stage rather than starting over
  const from = snooze !== undefined ? snooze - step : prompt.sinceMs;
  const age = now - from;
  if (age >= 2 * step && age < 2 * step + OVERLAY_WINDOW_MS) return 'overlay';
  if (age >= step) return 'notify';
  return 'none';
}

interface Span {
  id: string;
  start: string;
  end: string;
}

function overlaps(a: Span, b: Span): boolean {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** First routine block sharing a weekday and a time range with `candidate`. */
export function routineOverlap(routine: Block[], candidate: Block): { block: Block; day: number } | null {
  for (const other of routine) {
    if (other.id === candidate.id) continue;
    const day = candidate.days.find((d) => other.days.includes(d));
    if (day !== undefined && overlaps(candidate, other)) return { block: other, day };
  }
  return null;
}

/** First block in a day's plan that `candidate` would collide with. */
export function planOverlap(plan: Planned[], candidate: Span): Planned | null {
  return plan.find((p) => p.id !== candidate.id && overlaps(candidate, p)) ?? null;
}

// ── Tasks, workload and rituals ──────────────────────────────────────────────

/** The day's tasks, in the order they were added. Let-go tasks are left out. */
export function tasksOn(state: AppState, key: string): Task[] {
  return state.tasks.filter((t) => t.date === key && !t.dropped);
}

export function blockTasks(state: AppState, key: string, blockId: string): Task[] {
  return tasksOn(state, key).filter((t) => t.blockId === blockId);
}

export interface BlockLoad {
  block: Planned;
  taskMin: number;
  blockMin: number;
}

export interface Workload {
  /** Estimated minutes of every task planned for the day */
  taskMin: number;
  capacityMin: number;
  blocks: BlockLoad[];
  unscheduledMin: number;
}

/**
 * How much is planned against how much fits. People with ADHD tend to overplan,
 * so the planner shows this wherever tasks are added.
 */
export function workload(state: AppState, date: Date): Workload {
  const key = dayKey(date);
  const tasks = tasksOn(state, key);
  const sum = (list: Task[]) => list.reduce((total, t) => total + t.estimateMin, 0);
  const blocks = planFor(state, date).map((block) => ({
    block,
    taskMin: sum(tasks.filter((t) => t.blockId === block.id)),
    blockMin: (block.endMs - block.startMs) / 60_000,
  }));
  const placed = new Set(blocks.map((b) => b.block.id));
  return {
    taskMin: sum(tasks),
    capacityMin: state.settings.capacityMin,
    blocks,
    unscheduledMin: sum(tasks.filter((t) => !t.blockId || !placed.has(t.blockId))),
  };
}

/** Unfinished tasks from earlier days that haven't been brought forward or let go. */
export function carryover(state: AppState, key: string): Task[] {
  return state.tasks.filter((t) => t.date < key && !t.done && !t.dropped);
}

export function shutdownDue(state: AppState, now: number): boolean {
  const date = new Date(now);
  const rec = dayRecord(state, dayKey(date));
  return rec.shutdown === null && now >= atMinutes(date, toMinutes(state.settings.shutdownTime));
}

export function objectiveProgress(state: AppState, objective: Objective): { done: number; total: number } {
  const linked = state.tasks.filter((t) => t.objectiveId === objective.id && !t.dropped);
  return { done: linked.filter((t) => t.done).length, total: linked.length };
}
