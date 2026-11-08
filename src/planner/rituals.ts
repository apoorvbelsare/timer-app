import { closeDay, dropTasks, finishPlanning, moveTasks, reopenDay } from '../actions';
import { h } from '../dom';
import { carryover, dayRecord, planFor, tasksOn, workload } from '../engine';
import { type BlockStatus, addDays, dayKey, fromDayKey, weekKey } from '../model';
import { getState } from '../store';
import { addTaskRow, blockFill, dropZone, taskRow, workloadBar } from './ui';

/**
 * The two daily rituals, borrowed from Sunsama: a short morning plan and an
 * evening shutdown. Each is a few small steps, never a form to fill in.
 */

export interface RitualContext {
  rerender: () => void;
  done: () => void;
  openWeek: () => void;
}

const longDate = (key: string) => fromDayKey(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (key: string) => fromDayKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function stepper(steps: string[], current: number) {
  return h(
    'ol',
    { class: 'stepper' },
    steps.map((label, i) => h('li', { class: i === current ? 'on' : i < current ? 'past' : '' }, h('span', {}, String(i + 1)), label)),
  );
}

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// ── Morning: plan the day ────────────────────────────────────────────────────

const PLAN_STEPS = ['Yesterday', 'Today’s tasks', 'Timebox'];
let planStep = 0;

export function resetPlan() {
  planStep = 0;
}

export function renderPlan(ctx: RitualContext): HTMLElement {
  const state = getState();
  const now = new Date();
  const key = dayKey(now);
  const leftovers = carryover(state, key);
  // Nothing to carry over: start at today's tasks
  if (planStep === 0 && leftovers.length === 0) planStep = 1;

  const next = () => ((planStep += 1), ctx.rerender());
  const back = () => ((planStep -= 1), ctx.rerender());
  const objectives = state.objectives.filter((o) => o.week === weekKey(key) && !o.done);

  let body: HTMLElement;
  if (planStep === 0) {
    const byDay = new Map<string, typeof leftovers>();
    for (const t of leftovers) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
    body = h(
      'div',
      { class: 'ritual-body' },
      h('h2', {}, 'Left over from before'),
      h('p', { class: 'sub' }, 'Bring what still matters into today. Letting something go is a decision too, not a failure.'),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', onClick: () => moveTasks(leftovers.map((t) => t.id), key) }, 'Bring all to today'),
        h('button', { class: 'btn ghost', onClick: () => dropTasks(leftovers.map((t) => t.id)) }, 'Let go of all'),
      ),
      [...byDay].map(([date, tasks]) =>
        h(
          'div',
          { class: 'carry-group' },
          h('h3', {}, shortDate(date)),
          tasks.map((t) =>
            h(
              'div',
              { class: 'carry-row' },
              h('span', { class: 'task-title' }, t.title),
              h('button', { class: 'btn small', onClick: () => moveTasks([t.id], key) }, 'Today'),
              h('button', { class: 'btn ghost small', onClick: () => dropTasks([t.id]) }, 'Let go'),
            ),
          ),
        ),
      ),
    );
  } else if (planStep === 1) {
    body = h(
      'div',
      { class: 'ritual-body' },
      h('h2', {}, 'What do you want to get done today?'),
      h('p', { class: 'sub' }, 'Add tasks with a rough guess at how long each takes. Guesses are fine; you’ll get better at them.'),
      objectives.length
        ? h('p', { class: 'objectives-hint' }, 'This week: ', objectives.map((o, i) => [i ? ' · ' : '', h('strong', {}, o.title)]).flat())
        : h('p', { class: 'objectives-hint' }, 'No objectives for this week yet. ', h('button', { class: 'link', onClick: ctx.openWeek }, 'Set some')),
      addTaskRow(key, 'plan-add', {}, objectives),
      h('ul', { class: 'task-list' }, tasksOn(state, key).map((t) => taskRow(t, { objectives }))),
      workloadBar(workload(state, now)),
    );
  } else {
    const blocks = planFor(state, now).filter((b) => b.endMs > now.getTime());
    const load = workload(state, now);
    const tasks = tasksOn(state, key);
    const unscheduled = tasks.filter((t) => !t.blockId || !blocks.some((b) => b.id === t.blockId));
    body = h(
      'div',
      { class: 'ritual-body wide' },
      h('h2', {}, 'Give each task a home'),
      h('p', { class: 'sub' }, 'Drag tasks into the blocks where you’ll do them. They’ll show up as that block’s to-dos in the widget and in focus mode.'),
      h(
        'div',
        { class: 'timebox' },
        dropZone(
          h(
            'div',
            { class: 'timebox-inbox' },
            h('h3', {}, 'Not scheduled'),
            unscheduled.length
              ? h('ul', { class: 'task-list' }, unscheduled.map((t) => taskRow(t, { blocks, draggable: true })))
              : h('p', { class: 'sub' }, 'Everything has a home.'),
          ),
          null,
        ),
        h(
          'div',
          { class: 'timebox-blocks' },
          blocks.length
            ? load.blocks
                .filter((b) => blocks.some((x) => x.id === b.block.id))
                .map(({ block, taskMin, blockMin }) =>
                  dropZone(
                    h(
                      'div',
                      { class: 'timebox-block', style: `--c:${block.color}` },
                      h('div', { class: 'tb-head' }, h('strong', {}, block.name), h('span', { class: 'sub' }, `${block.start}–${block.end}`), blockFill(taskMin, blockMin)),
                      h('ul', { class: 'task-list' }, tasks.filter((t) => t.blockId === block.id).map((t) => taskRow(t, { draggable: true }))),
                    ),
                    block.id,
                  ),
                )
            : h('p', { class: 'sub' }, 'No blocks left today. Tasks can stay unscheduled.'),
        ),
      ),
      workloadBar(load),
    );
  }

  const last = planStep === PLAN_STEPS.length - 1;
  return h(
    'section',
    { class: 'page ritual' },
    h('header', { class: 'ritual-head' }, h('p', { class: 'eyebrow' }, longDate(key)), h('h1', {}, `${greeting(now)}. Let’s plan your day.`), stepper(PLAN_STEPS, planStep)),
    body,
    h(
      'footer',
      { class: 'ritual-foot' },
      planStep > (leftovers.length ? 0 : 1) && h('button', { class: 'btn ghost', onClick: back }, 'Back'),
      h('button', { class: 'btn ghost push', onClick: ctx.done }, 'Skip for today'),
      last
        ? h('button', { class: 'btn primary', onClick: () => void finishPlanning(key).then(() => ((planStep = 0), ctx.done())) }, 'Start the day')
        : h('button', { class: 'btn primary', onClick: next }, 'Next'),
    ),
  );
}

// ── Evening: shut the day down ───────────────────────────────────────────────

const SHUTDOWN_STEPS = ['What you did', 'What’s left', 'Reflect'];
let shutdownStep = 0;
let reflectionDraft = '';

export function resetShutdown() {
  shutdownStep = 0;
}

const STATUS_WORD: Record<BlockStatus, string> = { done: 'Done', partly: 'Partly', skipped: 'Skipped' };

export function renderShutdown(ctx: RitualContext): HTMLElement {
  const state = getState();
  const now = new Date();
  const key = dayKey(now);
  const rec = dayRecord(state, key);
  const tasks = tasksOn(state, key);

  if (rec.shutdown) {
    return h(
      'section',
      { class: 'page ritual closed' },
      h(
        'div',
        { class: 'closed-card' },
        h('div', { class: 'sunset', 'aria-hidden': 'true' }),
        h('h1', {}, 'Day closed'),
        h('p', { class: 'sub' }, `Closed at ${new Date(rec.shutdown.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}. The rest of the evening is yours.`),
        rec.shutdown.reflection && h('blockquote', {}, rec.shutdown.reflection),
        h('div', { class: 'row center' }, h('button', { class: 'btn primary', onClick: ctx.done }, 'Back to today'), h('button', { class: 'btn ghost', onClick: () => reopenDay(key) }, 'Reopen the day')),
      ),
    );
  }

  const done = tasks.filter((t) => t.done);
  const open = tasks.filter((t) => !t.done);
  const logged = planFor(state, now).filter((b) => rec.log[b.id]);
  const tomorrow = addDays(key, 1);

  let body: HTMLElement;
  if (shutdownStep === 0) {
    body = h(
      'div',
      { class: 'ritual-body' },
      h('h2', {}, done.length || logged.length ? 'Look at what you did' : 'Some days are like that'),
      h('p', { class: 'sub' }, done.length || logged.length ? 'Take a second with this before moving on.' : 'Showing up to close the day still counts.'),
      done.length > 0 && h('ul', { class: 'done-list' }, done.map((t) => h('li', {}, h('span', { class: 'tick', 'aria-hidden': 'true' }, '✓'), t.title))),
      logged.length > 0 &&
        h(
          'div',
          { class: 'logged' },
          h('h3', {}, 'Blocks'),
          logged.map((b) => h('div', { class: 'logged-row', style: `--c:${b.color}` }, h('span', {}, b.name), h('span', { class: `tag status-${rec.log[b.id]}` }, STATUS_WORD[rec.log[b.id]]))),
        ),
    );
  } else if (shutdownStep === 1) {
    body = h(
      'div',
      { class: 'ritual-body' },
      h('h2', {}, open.length ? 'What’s still open' : 'Nothing left open'),
      h('p', { class: 'sub' }, open.length ? 'Move each one to tomorrow, or let it go. Tomorrow’s plan starts from here.' : 'A clean slate for tomorrow.'),
      open.length > 0 &&
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', onClick: () => moveTasks(open.map((t) => t.id), tomorrow) }, 'Move all to tomorrow'),
          h('button', { class: 'btn ghost', onClick: () => dropTasks(open.map((t) => t.id)) }, 'Let go of all'),
        ),
      open.map((t) =>
        h(
          'div',
          { class: 'carry-row' },
          h('span', { class: 'task-title' }, t.title),
          h('button', { class: 'btn small', onClick: () => moveTasks([t.id], tomorrow) }, 'Tomorrow'),
          h('button', { class: 'btn ghost small', onClick: () => dropTasks([t.id]) }, 'Let go'),
        ),
      ),
    );
  } else {
    const box = h('textarea', {
      rows: 3,
      placeholder: 'What went well? What got in the way? One line is plenty.',
      value: reflectionDraft,
      onInput: (e: Event) => (reflectionDraft = (e.target as HTMLTextAreaElement).value),
    });
    body = h('div', { class: 'ritual-body' }, h('h2', {}, 'One line about today'), h('p', { class: 'sub' }, 'Optional. It shows up in your weekly review.'), box);
  }

  const last = shutdownStep === SHUTDOWN_STEPS.length - 1;
  return h(
    'section',
    { class: 'page ritual evening' },
    h('header', { class: 'ritual-head' }, h('p', { class: 'eyebrow' }, longDate(key)), h('h1', {}, 'Time to close the day'), stepper(SHUTDOWN_STEPS, shutdownStep)),
    body,
    h(
      'footer',
      { class: 'ritual-foot' },
      shutdownStep > 0 && h('button', { class: 'btn ghost', onClick: () => ((shutdownStep -= 1), ctx.rerender()) }, 'Back'),
      h('button', { class: 'btn ghost push', onClick: ctx.done }, 'Not yet'),
      last
        ? h(
            'button',
            {
              class: 'btn primary',
              onClick: () => {
                const text = reflectionDraft;
                reflectionDraft = '';
                shutdownStep = 0;
                void closeDay(key, text);
              },
            },
            'Close the day',
          )
        : h('button', { class: 'btn primary', onClick: () => ((shutdownStep += 1), ctx.rerender()) }, 'Next'),
    ),
  );
}
