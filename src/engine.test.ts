import { describe, expect, it } from 'vitest';
import { escalation, planFor, planOverlap, routineOverlap, snapshot } from './engine';
import { type AppState, type Block, defaultState, emptyDay } from './model';

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
    expect(snapshot(s, at('09:02')).prompt).toBeNull();
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
