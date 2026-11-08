import { addTask, editTask, removeTask, toggleTask } from '../actions';
import { h } from '../dom';
import type { Planned, Workload } from '../engine';
import { type Objective, type Task, PALETTE, formatDuration } from '../model';

/** Building blocks shared by the planner's views. */

export const field = (label: string, ...control: (Node | string)[]) => h('label', { class: 'field' }, h('span', {}, label), ...control);

export function timeInput(value: string, onChange: (v: string) => void) {
  return h('input', { type: 'time', value, onChange: (e: Event) => onChange((e.target as HTMLInputElement).value) });
}

export function swatches(current: string, onPick: (c: string) => void) {
  return h(
    'div',
    { class: 'swatches' },
    PALETTE.map((c) =>
      h('button', { type: 'button', class: `swatch${c === current ? ' on' : ''}`, style: `background:${c}`, title: c, onClick: () => onPick(c) }),
    ),
  );
}

/** A re-render replaces the DOM; this puts the cursor back where the person was typing. */
let pendingFocus: string | null = null;
export const keepFocus = (key: string) => (pendingFocus = key);
export function restoreFocus(root: HTMLElement) {
  if (!pendingFocus) return;
  root.querySelector<HTMLElement>(`[data-focus="${pendingFocus}"]`)?.focus();
  pendingFocus = null;
}

const minutes = (m: number) => (m ? formatDuration(m * 60_000) : '');
const ESTIMATES = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180];

function estimateSelect(value: number, onPick: (m: number) => void) {
  const options = ESTIMATES.includes(value) ? ESTIMATES : [...ESTIMATES, value].sort((a, b) => a - b);
  return h(
    'select',
    { class: 'estimate', title: 'How long it might take', onChange: (e: Event) => onPick(Number((e.target as HTMLSelectElement).value)) },
    options.map((m) => h('option', { value: String(m), selected: m === value }, m ? minutes(m) : '–')),
  );
}

function objectiveSelect(value: string | null, objectives: Objective[], onPick: (id: string | null) => void) {
  return h(
    'select',
    { class: 'objective', title: 'Counts towards a weekly objective', onChange: (e: Event) => onPick((e.target as HTMLSelectElement).value || null) },
    h('option', { value: '' }, 'No objective'),
    objectives.map((o) => h('option', { value: o.id, selected: o.id === value }, o.title)),
  );
}

export interface TaskRowOptions {
  /** Offer a "put in block" picker, for people who'd rather not drag */
  blocks?: Planned[];
  objectives?: Objective[];
  /** Show the objective picker; narrow columns show only the tag */
  objectivePicker?: boolean;
  draggable?: boolean;
}

export function taskRow(t: Task, opts: TaskRowOptions = {}) {
  const objective = opts.objectives?.find((o) => o.id === t.objectiveId);
  const row = h(
    'li',
    { class: `task${t.done ? ' done' : ''}`, draggable: opts.draggable ? 'true' : undefined },
    h('input', { type: 'checkbox', checked: t.done, title: t.done ? 'Mark not done' : 'Mark done', onChange: () => toggleTask(t.id) }),
    h('span', { class: 'task-title' }, t.title, objective && h('span', { class: 'objective-tag' }, objective.title)),
    opts.objectives?.length && opts.objectivePicker !== false ? objectiveSelect(t.objectiveId, opts.objectives, (id) => editTask(t.id, { objectiveId: id })) : null,
    opts.blocks
      ? h(
          'select',
          { class: 'block-pick', onChange: (e: Event) => editTask(t.id, { blockId: (e.target as HTMLSelectElement).value || null }) },
          h('option', { value: '' }, 'Not scheduled'),
          opts.blocks.map((b) => h('option', { value: b.id, selected: b.id === t.blockId }, `${b.start} ${b.name}`)),
        )
      : null,
    estimateSelect(t.estimateMin, (m) => editTask(t.id, { estimateMin: m })),
    h('button', { class: 'icon', title: 'Delete task', onClick: () => removeTask(t.id) }, '×'),
  );
  if (opts.draggable) {
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('text/task-id', t.id);
      e.dataTransfer!.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
  }
  return row;
}

/** Makes an element accept dropped tasks, which then move into `blockId`. */
export function dropZone<T extends HTMLElement>(el: T, blockId: string | null): T {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('text/task-id')) return;
    e.preventDefault();
    el.classList.add('drop-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-over');
    const id = e.dataTransfer?.getData('text/task-id');
    if (id) void editTask(id, { blockId });
  });
  return el;
}

export function addTaskRow(date: string, focusKey: string, defaults: Partial<Task> = {}, objectives: Objective[] = []) {
  let estimate = 30;
  let objectiveId: string | null = null;
  const title = h('input', { class: 'add-title', placeholder: 'Add a task…', 'data-focus': focusKey });
  const add = () => {
    if (!title.value.trim()) return;
    keepFocus(focusKey);
    void addTask(date, title.value, { estimateMin: estimate, objectiveId, ...defaults });
  };
  title.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  return h(
    'div',
    { class: 'add-task' },
    title,
    objectives.length ? objectiveSelect(null, objectives, (id) => (objectiveId = id)) : null,
    estimateSelect(estimate, (m) => (estimate = m)),
    h('button', { class: 'btn small', onClick: add }, 'Add'),
  );
}

/**
 * Planned task time against a full day, and any block packed past its length.
 * Overplanning is the trap; this makes it visible while there's still time to move things.
 */
export function workloadBar(load: Workload, compact = false) {
  const ratio = load.capacityMin ? load.taskMin / load.capacityMin : 0;
  const level = ratio > 1 ? 'over' : ratio > 0.85 ? 'full' : 'ok';
  const packed = load.blocks.filter((b) => b.taskMin > b.blockMin);
  return h(
    'div',
    { class: `workload ${level}${compact ? ' compact' : ''}` },
    h(
      'div',
      { class: 'workload-head' },
      h('span', {}, h('strong', {}, minutes(load.taskMin) || '0m'), ` of ${minutes(load.capacityMin)} planned`),
      level === 'over' && h('span', { class: 'workload-flag' }, `${minutes(load.taskMin - load.capacityMin)} over`),
    ),
    h('div', { class: 'workload-track' }, h('div', { class: 'workload-fill', style: `width:${Math.min(100, ratio * 100)}%` })),
    !compact && level === 'over' && h('p', { class: 'workload-note' }, 'That’s more than a full day. What could move to tomorrow?'),
    !compact &&
      packed.map((b) =>
        h('p', { class: 'workload-note' }, h('strong', {}, b.block.name), ` has ${minutes(b.taskMin)} of tasks in ${minutes(b.blockMin)}.`),
      ),
  );
}

/** Task time against a block's length, as a thin bar. */
export function blockFill(taskMin: number, blockMin: number) {
  const ratio = blockMin ? taskMin / blockMin : 0;
  return h(
    'span',
    { class: `block-fill${ratio > 1 ? ' over' : ''}`, title: `${minutes(taskMin) || '0m'} of tasks in ${minutes(blockMin)}` },
    h('span', { style: `width:${Math.min(100, ratio * 100)}%` }),
  );
}

export { minutes as formatMinutes };
