import {
  type AppState,
  type Block,
  type DayRecord,
  type Settings,
  type Step,
  atMinutes,
  dayKey,
  emptyDay,
  formatClock,
  formatDuration,
  toMinutes,
} from './model';

/**
 * A block placed on a concrete date, with today's changes applied.
 * `start`/`end` and their ms are when it actually runs; `planStart`/`planEnd`
 * are its slot on the clock. They differ when a chained block starts early or late.
 */
export interface Planned extends Block {
  startMs: number;
  endMs: number;
  planStart: string;
  planEnd: string;
  planStartMs: number;
  planEndMs: number;
  /** Chained and its anchor hasn't happened yet: it sits at its planned slot as an estimate */
  waiting: boolean;
  oneOff: boolean;
  skippedToday: boolean;
  movedToday: boolean;
}

/** The step you're on: the first one not yet ticked off. */
export interface StepInfo {
  step: Step;
  index: number;
  total: number;
  /** When this step began: the block's start, or when the one before was ticked */
  sinceMs: number;
  /** Left on the step's guide time, negative once over; null when it has none */
  remainingMs: number | null;
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
  /** Other blocks running at the same time as `current`, which is the latest to start */
  alsoRunning: Planned[];
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

  const all = [...fromRoutine, ...oneOffs];
  const onToday = new Set(all.map(({ block }) => block.id));

  return all
    .map(({ block, oneOff }): Planned => {
      const moved = rec.override.times[block.id];
      const planStart = moved?.start ?? block.start;
      const planEnd = moved?.end ?? block.end;
      const planStartMs = atMinutes(date, toMinutes(planStart));
      const planEndMs = atMinutes(date, toMinutes(planEnd));

      let startMs = planStartMs;
      let endMs = planEndMs;
      let waiting = false;
      // An anchor that isn't on today (a block that doesn't run on this weekday,
      // a deleted event) falls back to the clock
      const anchor = block.after;
      const anchored = anchor && (anchor.kind === 'event' ? state.events.some((e) => e.id === anchor.id) : onToday.has(anchor.id));
      if (anchor && anchored) {
        const fired = anchor.kind === 'block' ? rec.finishedAt[anchor.id] : rec.events[anchor.id]?.[0];
        const latest = block.latestStart ? atMinutes(date, toMinutes(block.latestStart)) : undefined;
        const trigger = rec.startedAt[block.id] ?? fired ?? latest;
        if (trigger === undefined) waiting = true;
        else {
          startMs = trigger;
          endMs = trigger + (planEndMs - planStartMs);
        }
      }
      // Marked done while still running: it ends there
      const finished = rec.finishedAt[block.id];
      if (!waiting && finished !== undefined && finished >= startMs && finished < endMs) endMs = finished;

      return {
        ...block,
        start: formatClock(startMs),
        end: formatClock(endMs),
        startMs,
        endMs,
        planStart,
        planEnd,
        planStartMs,
        planEndMs,
        waiting,
        oneOff,
        skippedToday: rec.override.skip.includes(block.id),
        movedToday: moved !== undefined,
      };
    })
    .filter((p) => includeSkipped || !p.skippedToday)
    .sort((a, b) => a.startMs - b.startMs);
}

/** "after Morning routine", "after Ate lunch": what a chained block is waiting for. */
export function anchorLabel(state: AppState, block: Block): string {
  const a = block.after;
  if (!a) return '';
  const name = a.kind === 'block' ? state.routine.find((b) => b.id === a.id)?.name : state.events.find((e) => e.id === a.id)?.name;
  return name ? `after ${name}` : '';
}

/** A chained block that ran or is running off its planned slot. */
export const shifted = (p: Planned) => !p.waiting && Math.abs(p.startMs - p.planStartMs) >= 60_000;

/**
 * Steps go in order and only move on when you tick one off; the clock never
 * skips you ahead. Null once they're all done (or the block has none).
 */
export function currentStep(block: Block, done: number[], startMs: number, now: number): StepInfo | null {
  const index = done.length;
  const step = block.steps[index];
  if (!step) return null;
  const sinceMs = Math.max(done[index - 1] ?? startMs, startMs);
  return { step, index, total: block.steps.length, sinceMs, remainingMs: step.minutes > 0 ? sinceMs + step.minutes * 60_000 - now : null };
}

/** "4m left" or "2m over" on a step's guide time; empty when it has none. */
export function stepGuide(info: StepInfo): string {
  if (info.remainingMs === null) return '';
  return info.remainingMs > 0 ? `${formatDuration(info.remainingMs)} left` : `${formatDuration(-info.remainingMs)} over`;
}

export function snapshot(state: AppState, now: number): Snapshot {
  const date = new Date(now);
  const key = dayKey(date);
  const rec = dayRecord(state, key);
  const plan = planFor(state, date);
  // Blocks may overlap. The one that started last is the one in front: a call
  // inside a deep-work block takes over for its length, then deep work returns.
  const running = plan.filter((p) => !p.waiting && p.startMs <= now && now < p.endMs);
  const current = running[running.length - 1] ?? null;
  const alsoRunning = running.slice(0, -1).reverse();
  // A waiting block is "next" even once its planned time has passed: it's still to come
  const next = plan.find((p) => p.waiting || p.startMs > now) ?? null;

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
    if (!awaitingStart) step = currentStep(current, rec.stepsDone[current.id] ?? [], anchor, now);
  } else if (next) {
    const previousEnd = plan
      .filter((p) => !p.waiting && p.endMs <= now)
      .reduce((latest, p) => Math.max(latest, p.endMs), atMinutes(date, 0));
    totalMs = next.startMs - previousEnd;
    remainingMs = Math.max(0, next.startMs - now);
  }

  const progress = totalMs > 0 ? Math.min(1, Math.max(0, 1 - remainingMs / totalMs)) : 0;
  return {
    now,
    key,
    plan,
    current,
    alsoRunning,
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
      !p.waiting &&
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

export interface Lane {
  lane: number;
  /** Columns in this block's group of overlapping blocks */
  of: number;
}

/**
 * Side-by-side columns for a day's timeline, so overlapping blocks don't hide
 * each other. Each block takes the first column free at its start; a group of
 * blocks that chain into each other shares one column count.
 */
export function lanes(plan: Planned[]): Map<string, Lane> {
  const result = new Map<string, Lane>();
  const sorted = [...plan].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  let group: Planned[] = [];
  let groupEnd = -Infinity;
  let laneEnds: number[] = [];

  const close = () => {
    for (const p of group) result.get(p.id)!.of = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const p of sorted) {
    if (p.startMs >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= p.startMs);
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = p.endMs;
    result.set(p.id, { lane, of: 1 });
    group.push(p);
    groupEnd = Math.max(groupEnd, p.endMs);
  }
  close();
  return result;
}
