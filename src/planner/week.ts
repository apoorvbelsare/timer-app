import { h } from '../dom';
import { objectiveProgress } from '../engine';
import { type Objective, addDays, dayKey, fromDayKey, newId, weekKey } from '../model';
import { getState, update } from '../store';
import { keepFocus, taskRow } from './ui';

/**
 * Weekly objectives: one to three things that would make this week a good one,
 * with tasks counting towards them, and a short review once the week is through.
 */

const range = (week: string) => {
  const fmt = (key: string) => fromDayKey(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(week)} – ${fmt(addDays(week, 6))}`;
};

function objectiveCard(o: Objective, editable: boolean) {
  const state = getState();
  const progress = objectiveProgress(state, o);
  const tasks = state.tasks.filter((t) => t.objectiveId === o.id && !t.dropped);
  return h(
    'div',
    { class: `objective-card${o.done ? ' done' : ''}` },
    h(
      'div',
      { class: 'objective-head' },
      h('input', {
        type: 'checkbox',
        checked: o.done,
        disabled: !editable,
        title: o.done ? 'Mark not done' : 'Mark done',
        onChange: () => update((d) => void (d.objectives.find((x) => x.id === o.id)!.done = !o.done)),
      }),
      h('strong', {}, o.title),
      h('span', { class: 'sub' }, progress.total ? `${progress.done} of ${progress.total} tasks` : 'No tasks linked yet'),
      editable && h('button', { class: 'icon', title: 'Remove objective', onClick: () => update((d) => void (d.objectives = d.objectives.filter((x) => x.id !== o.id))) }, '×'),
    ),
    progress.total > 0 && h('div', { class: 'objective-track' }, h('span', { style: `width:${(progress.done / progress.total) * 100}%` })),
    editable && tasks.length > 0 && h('ul', { class: 'task-list compact' }, tasks.map((t) => taskRow(t))),
  );
}

function reviewBox(week: string, label: string) {
  return h(
    'div',
    { class: 'review' },
    h('h3', {}, label),
    h('textarea', {
      rows: 3,
      placeholder: 'What moved forward? What would you do differently next week?',
      value: getState().weekNotes[week] ?? '',
      onChange: (e: Event) => update((d) => void (d.weekNotes[week] = (e.target as HTMLTextAreaElement).value.trim())),
    }),
  );
}

export function renderWeek(): HTMLElement {
  const state = getState();
  const today = dayKey(new Date());
  const week = weekKey(today);
  const lastWeek = addDays(week, -7);
  const current = state.objectives.filter((o) => o.week === week);
  const previous = state.objectives.filter((o) => o.week === lastWeek);
  // Daily reflections from the shutdown ritual feed the review
  const reflections = Array.from({ length: 7 }, (_, i) => addDays(week, i))
    .map((key) => [key, state.days[key]?.shutdown?.reflection] as const)
    .filter(([, text]) => text);
  const weekEnding = new Date().getDay() === 0 || new Date().getDay() >= 5;

  const input = h('input', { placeholder: 'Add an objective for this week…', 'data-focus': 'objective-add' });
  const add = () => {
    const title = input.value.trim();
    if (!title) return;
    keepFocus('objective-add');
    void update((d) => void d.objectives.push({ id: newId(), week, title, done: false }));
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());

  return h(
    'section',
    { class: 'page week' },
    h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'This week'), h('p', { class: 'sub' }, range(week)))),
    h(
      'div',
      { class: 'week-grid' },
      h(
        'div',
        { class: 'week-main' },
        h('h2', {}, 'Objectives'),
        h('p', { class: 'sub' }, 'What would make this a good week? Keep it to three or fewer. Link tasks to them while planning your day.'),
        current.map((o) => objectiveCard(o, true)),
        current.length < 5 && h('div', { class: 'add-task' }, input, h('button', { class: 'btn small', onClick: add }, 'Add')),
        current.length > 3 && h('p', { class: 'sub warn' }, 'That’s a lot for one week. Which ones matter most?'),
        weekEnding && reviewBox(week, 'Weekly review'),
      ),
      h(
        'aside',
        { class: 'week-side' },
        reflections.length > 0 &&
          h(
            'div',
            { class: 'panel-card' },
            h('h3', {}, 'Your days this week'),
            reflections.map(([key, text]) =>
              h('p', { class: 'reflection' }, h('span', { class: 'sub' }, fromDayKey(key).toLocaleDateString(undefined, { weekday: 'short' })), ' ', text),
            ),
          ),
        previous.length > 0 &&
          h('div', { class: 'panel-card' }, h('h3', {}, `Last week · ${range(lastWeek)}`), previous.map((o) => objectiveCard(o, false)), reviewBox(lastWeek, 'Looking back')),
        !weekEnding && h('div', { class: 'panel-card' }, h('h3', {}, 'Weekly review'), h('p', { class: 'sub' }, 'Opens here from Friday, to look back on the week.')),
      ),
    ),
  );
}
