import { describe, expect, it } from 'vitest';
import { escalation, lanes, planFor, snapshot } from './engine';
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

  it('goes through steps in order, only moving on when one is ticked off', () => {
    const withSteps = (done: number[]) =>
      stateWith(
        [
          block('a', '08:00', '09:00', {
            steps: [
              { id: 's1', name: 'Shower', minutes: 15 },
              { id: 's2', name: 'Dress', minutes: 0 },
              { id: 's3', name: 'Breakfast', minutes: 20 },
            ],
          }),
        ],
        (st) => (st.days[KEY] = { ...emptyDay(), stepsDone: { a: done } }),
      );
    expect(snapshot(withSteps([]), at('08:05')).step).toMatchObject({ index: 0, total: 3, remainingMs: 10 * 60_000 });
    // Past its guide time it stays on the step, counting how far over
    expect(snapshot(withSteps([]), at('08:40')).step).toMatchObject({ index: 0, remainingMs: -25 * 60_000 });
    expect(snapshot(withSteps([at('08:10')]), at('08:12')).step).toMatchObject({ index: 1, sinceMs: at('08:10'), remainingMs: null });
    expect(snapshot(withSteps([at('08:10'), at('08:15')]), at('08:20')).step).toMatchObject({ index: 2, remainingMs: 15 * 60_000 });
    expect(snapshot(withSteps([at('08:10'), at('08:15'), at('08:30')]), at('08:31')).step).toBeNull();
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

    s.days[KEY] = { ...emptyDay(), intentions: { a: { text: '', todos: [], dismissed: true } } };
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

describe('chained blocks', () => {
  const morning = block('morning', '07:00', '07:45');
  const work = block('work', '09:00', '12:00', { after: { kind: 'block', id: 'morning' } });

  it('waits at its planned slot until the block before it is finished', () => {
    const s = snapshot(stateWith([morning, work]), at('09:30'));
    const planned = s.plan.find((p) => p.id === 'work')!;
    expect(planned.waiting).toBe(true);
    expect(planned.start).toBe('09:00');
    expect(s.current).toBeNull();
    expect(s.next?.id).toBe('work');
    expect(s.prompt?.block.id).toBe('morning');
  });

  it('starts when the block before is marked done, keeping its length and its planned slot', () => {
    const s = stateWith([morning, work], (st) => (st.days[KEY] = { ...emptyDay(), log: { morning: 'done' }, finishedAt: { morning: at('08:10') } }));
    const snap = snapshot(s, at('08:30'));
    expect(snap.current?.id).toBe('work');
    expect(snap.current).toMatchObject({ start: '08:10', end: '11:10', planStart: '09:00', planEnd: '12:00', waiting: false });
  });

  it('ends a running block early when it is marked done', () => {
    const s = stateWith([morning], (st) => (st.days[KEY] = { ...emptyDay(), log: { morning: 'done' }, finishedAt: { morning: at('07:20') } }));
    expect(planFor(s, WED)[0].end).toBe('07:20');
    expect(snapshot(s, at('07:30')).current).toBeNull();
  });

  it('falls back to its latest start when nothing happens', () => {
    const late = { ...work, latestStart: '10:00' };
    expect(snapshot(stateWith([morning, late]), at('10:05')).current).toMatchObject({ id: 'work', start: '10:00', end: '13:00' });
  });

  it('starts after one of your events', () => {
    const study = block('study', '20:00', '21:00', { after: { kind: 'event', id: 'kids' } });
    const s = stateWith([study], (st) => {
      st.events = [{ id: 'kids', name: 'Kids in bed', hotkey: '' }];
      st.days[KEY] = { ...emptyDay(), events: { kids: [at('20:40')] } };
    });
    expect(snapshot(s, at('20:30')).current).toBeNull();
    expect(snapshot(s, at('20:45')).current).toMatchObject({ id: 'study', start: '20:40', end: '21:40' });
  });

  it('never runs once skipped, even if skipped while still waiting', () => {
    const s = stateWith([morning, work], (st) => {
      st.days[KEY] = { ...emptyDay(), log: { work: 'skipped', morning: 'done' }, finishedAt: { work: at('07:10'), morning: at('07:40') } };
    });
    const snap = snapshot(s, at('09:30'));
    expect(snap.plan.find((p) => p.id === 'work')).toMatchObject({ waiting: false, start: '09:00' });
    expect(snap.current).toBeNull();
    expect(snap.next).toBeNull();
    // A plain block skipped ahead of its time doesn't run either
    const plain = stateWith([block('a', '10:00', '11:00')], (st) => (st.days[KEY] = { ...emptyDay(), log: { a: 'skipped' }, finishedAt: { a: at('08:00') } }));
    expect(snapshot(plain, at('10:30')).current).toBeNull();
  });

  it('goes back to the clock when its anchor isn’t on today', () => {
    const s = stateWith([block('work', '09:00', '12:00', { after: { kind: 'block', id: 'gone' } })]);
    expect(snapshot(s, at('09:30')).current?.id).toBe('work');
  });
});

describe('overlapping blocks', () => {
  const s = stateWith([block('deep', '09:00', '12:00'), block('call', '10:00', '10:30'), block('lunch', '12:00', '13:00')]);

  it('puts the latest-started block in front and the rest underneath', () => {
    const during = snapshot(s, at('10:15'));
    expect(during.current?.id).toBe('call');
    expect(during.alsoRunning.map((p) => p.id)).toEqual(['deep']);
    expect(during.remainingMs).toBe(15 * 60_000);
  });

  it('hands back to the outer block once the inner one ends', () => {
    const after = snapshot(s, at('10:45'));
    expect(after.current?.id).toBe('deep');
    expect(after.alsoRunning).toEqual([]);
  });

  it('lays overlapping blocks out side by side, and lone blocks full width', () => {
    const cols = lanes(planFor(s, WED));
    expect(cols.get('deep')).toEqual({ lane: 0, of: 2 });
    expect(cols.get('call')).toEqual({ lane: 1, of: 2 });
    expect(cols.get('lunch')).toEqual({ lane: 0, of: 1 });
  });

  it('reuses a column once it frees up', () => {
    const cols = lanes(planFor(stateWith([block('a', '09:00', '12:00'), block('b', '09:00', '10:00'), block('c', '10:00', '11:00')]), WED));
    expect(cols.get('c')).toEqual({ lane: 1, of: 2 });
  });
});
