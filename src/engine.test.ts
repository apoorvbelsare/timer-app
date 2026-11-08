import { describe, expect, it } from 'vitest';
import { carryover, escalation, objectiveProgress, planFor, planOverlap, routineOverlap, shutdownDue, snapshot, workload } from './engine';
import { type AppState, type Block, type Task, defaultState, emptyDay, normalizeState, weekKey } from './model';

// Wednesday 4 November 2026
const WED = new Date(2026, 10, 4);
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 10, 4, h, m).getTime();
};
const KEY = '2026-11-04';

function block(id: string, start: string, end: string, extra: Partial<Block> = {}): Block {
  return { id, name: id, color: '#000', start, end, days: [0, 1, 2, 3, 4, 5, 6], optional: false, steps: [], ...extra };
}

function stateWith(routine: Block[], tweak?: (s: AppState) => void): AppState {
  const s = defaultState();
  s.routine = routine;
  tweak?.(s);
  return s;
}

describe('planFor', () => {
  it('keeps only blocks for that weekday, sorted by start', () => {
    const s = stateWith([block('b', '10:00', '11:00'), block('a', '08:00', '09:00'), block('sat', '08:00', '09:00', { days: [6] })]);
    expect(planFor(s, WED).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('applies today-only skips, moved times and one-offs without touching the routine', () => {
    const s = stateWith([block('a', '08:00', '09:00'), block('b', '10:00', '11:00')], (st) => {
      const day = emptyDay();
      day.override.skip = ['a'];
      day.override.times.b = { start: '14:00', end: '15:00' };
      day.override.extra = [block('x', '12:00', '12:30')];
      st.days[KEY] = day;
    });
    const plan = planFor(s, WED);
    expect(plan.map((p) => [p.id, p.start])).toEqual([['x', '12:00'], ['b', '14:00']]);
    expect(plan[0].oneOff).toBe(true);
    expect(plan[1].movedToday).toBe(true);
    expect(s.routine[1].start).toBe('10:00');
    expect(planFor(s, WED, true).find((p) => p.id === 'a')?.skippedToday).toBe(true);
  });
});

describe('snapshot', () => {
  const s = stateWith([block('a', '08:00', '09:00'), block('b', '10:00', '11:00')]);

  it('finds the current block, time left and what comes next', () => {
    const snap = snapshot(s, at('08:15'));
    expect(snap.current?.id).toBe('a');
    expect(snap.next?.id).toBe('b');
    expect(snap.remainingMs).toBe(45 * 60_000);
    expect(snap.progress).toBeCloseTo(0.25);
  });

  it('counts down free time from the end of the previous block', () => {
    const snap = snapshot(stateWith(s.routine, (st) => (st.days[KEY] = { ...emptyDay(), log: { a: 'done' } })), at('09:30'));
    expect(snap.current).toBeNull();
    expect(snap.remainingMs).toBe(30 * 60_000);
    expect(snap.progress).toBeCloseTo(0.5);
  });

  it('runs steps back to back and stops when they are used up', () => {
    const withSteps = stateWith([
      block('a', '08:00', '09:00', {
        steps: [
          { id: 's1', name: 'Shower', minutes: 15 },
          { id: 's2', name: 'Dress', minutes: 10 },
        ],
      }),
    ]);
    expect(snapshot(withSteps, at('08:05')).step?.step.name).toBe('Shower');
    expect(snapshot(withSteps, at('08:20')).step).toMatchObject({ index: 1, remainingMs: 5 * 60_000 });
    expect(snapshot(withSteps, at('08:30')).step).toBeNull();
  });
});

describe('prompts', () => {
  it('asks to review a block once it ends, until it is logged', () => {
    const s = stateWith([block('a', '08:00', '09:00'), block('b', '09:00', '10:00')]);
    const snap = snapshot(s, at('09:02'));
    expect(snap.prompt).toMatchObject({ kind: 'review', sinceMs: at('09:00') });
    expect(snap.prompt?.block.id).toBe('a');

    s.days[KEY] = { ...emptyDay(), log: { a: 'done' } };
    expect(snapshot(s, at('09:02')).prompt).toMatchObject({ kind: 'intention', block: { id: 'b' } });
  });

  it('asks for an intention once per block, only with time left, and never escalates it', () => {
    const s = stateWith([block('a', '08:00', '09:00')]);
    const asked = snapshot(s, at('08:10')).prompt;
    expect(asked?.kind).toBe('intention');
    expect(escalation(asked, emptyDay(), s.settings, at('08:50'))).toBe('none');
    expect(snapshot(s, at('08:57')).prompt).toBeNull();

    s.days[KEY] = { ...emptyDay(), intentions: { a: { text: '', dismissed: true } } };
    expect(snapshot(s, at('08:10')).prompt).toBeNull();

    const off = stateWith(s.routine, (st) => (st.settings.askIntention = false));
    expect(snapshot(off, at('08:10')).prompt).toBeNull();
  });

  it('asks to start an optional block, and never reviews one nobody started', () => {
    const s = stateWith([block('study', '20:00', '21:00', { optional: true })]);
    const during = snapshot(s, at('20:10'));
    expect(during.awaitingStart).toBe(true);
    expect(during.prompt?.kind).toBe('start');
    expect(during.step).toBeNull();
    expect(snapshot(s, at('21:05')).prompt).toBeNull();

    s.days[KEY] = { ...emptyDay(), startedAt: { study: at('20:20') } };
    const started = snapshot(s, at('20:30'));
    expect(started.awaitingStart).toBe(false);
    expect(started.totalMs).toBe(40 * 60_000);
    expect(snapshot(s, at('21:05')).prompt?.kind).toBe('review');
  });

  it('leaves blocks that ended hours ago to the planner', () => {
    const s = stateWith([block('a', '08:00', '09:00')]);
    expect(snapshot(s, at('12:30')).prompt).toBeNull();
  });
});

describe('escalation', () => {
  const s = stateWith([block('a', '08:00', '09:00')]);
  const level = (time: string, st = s) => {
    const snap = snapshot(st, at(time));
    return escalation(snap.prompt, st.days[KEY] ?? emptyDay(), st.settings, at(time));
  };

  it('goes card → toast → overlay as the block runs over (5 min steps)', () => {
    expect(level('09:02')).toBe('none');
    expect(level('09:06')).toBe('notify');
    expect(level('09:11')).toBe('overlay');
    expect(level('10:30')).toBe('notify');
  });

  it('holds off while snoozed, then resumes at the toast stage', () => {
    const snoozed = stateWith(s.routine, (st) => (st.days[KEY] = { ...emptyDay(), snoozedUntil: { a: at('09:20') } }));
    expect(level('09:15', snoozed)).toBe('none');
    expect(level('09:21', snoozed)).toBe('notify');
    expect(level('09:26', snoozed)).toBe('overlay');
  });
});

describe('overlap checks', () => {
  it('only counts routine blocks that share a weekday', () => {
    const routine = [block('gym', '07:00', '08:00', { days: [1, 3, 5] })];
    expect(routineOverlap(routine, block('run', '07:30', '08:30', { days: [2, 4] }))).toBeNull();
    expect(routineOverlap(routine, block('run', '07:30', '08:30', { days: [3] }))).toMatchObject({ day: 3 });
    expect(routineOverlap(routine, block('next', '08:00', '09:00', { days: [3] }))).toBeNull();
  });

  it('checks a moved block against the rest of the day', () => {
    const plan = planFor(stateWith([block('a', '08:00', '09:00'), block('b', '10:00', '11:00')]), WED);
    expect(planOverlap(plan, { id: 'b', start: '08:30', end: '09:30' })?.id).toBe('a');
    expect(planOverlap(plan, { id: 'b', start: '09:00', end: '10:30' })).toBeNull();
  });
});

function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, title: id, date: KEY, estimateMin: 30, blockId: null, objectiveId: null, done: false, dropped: false, ...extra };
}

describe('tasks and rituals', () => {
  it('adds up the day against capacity and against each block', () => {
    const s = stateWith([block('a', '08:00', '09:00')], (st) => {
      st.settings.capacityMin = 60;
      st.tasks = [task('t1', { blockId: 'a', estimateMin: 45 }), task('t2', { blockId: 'a', estimateMin: 30 }), task('t3'), task('gone', { dropped: true })];
    });
    const load = workload(s, WED);
    expect(load.taskMin).toBe(105);
    expect(load.blocks[0]).toMatchObject({ taskMin: 75, blockMin: 60 });
    expect(load.unscheduledMin).toBe(30);
  });

  it('carries over unfinished tasks from earlier days only', () => {
    const s = stateWith([], (st) => {
      st.tasks = [
        task('old', { date: '2026-11-02' }),
        task('done', { date: '2026-11-02', done: true }),
        task('let-go', { date: '2026-11-03', dropped: true }),
        task('today'),
      ];
    });
    expect(carryover(s, KEY).map((t) => t.id)).toEqual(['old']);
  });

  it('offers the shutdown once its time comes, until the day is closed', () => {
    const s = stateWith([], (st) => (st.settings.shutdownTime = '21:30'));
    expect(shutdownDue(s, at('21:00'))).toBe(false);
    expect(shutdownDue(s, at('21:45'))).toBe(true);
    s.days[KEY] = { ...emptyDay(), shutdown: { at: at('21:50'), reflection: '' } };
    expect(shutdownDue(s, at('22:00'))).toBe(false);
  });

  it('counts linked tasks towards a weekly objective', () => {
    const s = stateWith([], (st) => (st.tasks = [task('a', { objectiveId: 'o', done: true }), task('b', { objectiveId: 'o' }), task('c')]));
    expect(objectiveProgress(s, { id: 'o', week: weekKey(KEY), title: 'Ship it', done: false })).toEqual({ done: 1, total: 2 });
    expect(weekKey(KEY)).toBe('2026-11-02');
    expect(weekKey('2026-11-08')).toBe('2026-11-02');
  });

  it('turns old block to-dos into tasks when loading a saved state', () => {
    const migrated = normalizeState({
      days: { [KEY]: { ...emptyDay(), intentions: { a: { text: 'Draft', dismissed: false, todos: [{ id: 'x', text: 'Outline', done: true }] } as never } as never } },
    });
    expect(migrated.tasks).toMatchObject([{ id: 'x', title: 'Outline', blockId: 'a', date: KEY, done: true }]);
    expect(migrated.days[KEY].intentions.a).toEqual({ text: 'Draft', dismissed: false });
  });
});
