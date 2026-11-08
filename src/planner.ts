import '@fontsource-variable/fraunces';
import '@fontsource-variable/nunito';
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from '@tauri-apps/plugin-autostart';
import { emit, listen } from '@tauri-apps/api/event';
import { Window } from '@tauri-apps/api/window';
import { addTodo, ensureDay, logBlock, removeTodo, restoreToday, setIntention, setNote, skipToday, startBlock, toggleTodo } from './actions';
import { chime, unlockAudioOnClick } from './alerts';
import { h } from './dom';
import { type Planned, dayRecord, planFor, planOverlap, routineOverlap, snapshot } from './engine';
import {
  type Block,
  type BlockStatus,
  DAY_NAMES,
  PALETTE,
  daysLabel,
  dayKey,
  formatDuration,
  fromMinutes,
  minuteOfDay,
  newId,
  sampleRoutine,
  toMinutes,
} from './model';
import { renderGardenPage, renderParkingPage } from './planner-pages';
import { getState, inTauri, initStore, subscribe, update } from './store';
import './styles/planner.css';

type View = 'today' | 'routine' | 'garden' | 'parking' | 'settings';

const viewEl = document.getElementById('view')!;
let view: View = 'today';
let selectedToday: string | null = null;
let oneOffDraft: Block | null = null;
let routineDraft: Block | null = null;
let error = '';

function go(next: View) {
  view = next;
  error = '';
  render();
}

function render() {
  document.querySelectorAll<HTMLButtonElement>('.nav button[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  const scroll = viewEl.querySelector('.timeline-scroll')?.scrollTop;
  const pages: Record<View, () => HTMLElement> = {
    today: renderToday,
    routine: renderRoutine,
    garden: renderGardenPage,
    parking: () => renderParkingPage(render),
    settings: renderSettings,
  };
  viewEl.replaceChildren(pages[view]());
  const open = getState().parked.filter((p) => !p.done).length;
  const badge = document.getElementById('parked-count')!;
  badge.hidden = open === 0;
  badge.textContent = String(open);
  viewEl.querySelector<HTMLInputElement>('[data-autofocus]')?.focus();
  const timeline = viewEl.querySelector('.timeline-scroll');
  if (timeline && scroll !== undefined) timeline.scrollTop = scroll;
}

const field = (label: string, ...control: (Node | string)[]) => h('label', { class: 'field' }, h('span', {}, label), ...control);

function timeInput(value: string, onChange: (v: string) => void) {
  return h('input', { type: 'time', value, onChange: (e: Event) => onChange((e.target as HTMLInputElement).value) });
}

function swatches(current: string, onPick: (c: string) => void) {
  return h(
    'div',
    { class: 'swatches' },
    PALETTE.map((c) =>
      h('button', {
        type: 'button',
        class: `swatch${c === current ? ' on' : ''}`,
        style: `background:${c}`,
        title: c,
        onClick: () => onPick(c),
      }),
    ),
  );
}

const errorBox = () => (error ? h('p', { class: 'error' }, error) : null);

// ── Today ────────────────────────────────────────────────────────────────────

const PX_PER_MIN = 1.1;
const STATUS_LABEL: Record<BlockStatus, string> = { done: 'Done', partly: 'Partly', skipped: 'Skipped' };

function renderToday(): HTMLElement {
  const state = getState();
  const now = Date.now();
  const date = new Date(now);
  const key = dayKey(date);
  const rec = dayRecord(state, key);
  const plan = planFor(state, date, true);
  const live = snapshot(state, now);
  const plannedMs = plan.filter((p) => !p.skippedToday).reduce((sum, p) => sum + (p.endMs - p.startMs), 0);

  const blockEl = (p: Planned) => {
    const status = rec.log[p.id];
    const top = toMinutes(p.start) * PX_PER_MIN;
    const height = Math.max(22, (toMinutes(p.end) - toMinutes(p.start)) * PX_PER_MIN);
    const classes = ['tl-block'];
    if (p.skippedToday) classes.push('skipped');
    if (p.id === selectedToday) classes.push('selected');
    if (live.current?.id === p.id) classes.push('current');
    return h(
      'button',
      {
        class: classes.join(' '),
        style: `top:${top}px;height:${height}px;--c:${p.color}`,
        onClick: () => {
          selectedToday = p.id;
          oneOffDraft = null;
          error = '';
          render();
        },
      },
      h('span', { class: 'tl-name' }, p.name),
      h('span', { class: 'tl-time' }, `${p.start}–${p.end}`),
      h(
        'span',
        { class: 'tags' },
        p.optional && h('span', { class: 'tag' }, 'optional'),
        p.oneOff && h('span', { class: 'tag' }, 'today only'),
        p.movedToday && h('span', { class: 'tag' }, 'moved'),
        status && h('span', { class: `tag status-${status}` }, STATUS_LABEL[status]),
      ),
    );
  };

  const timeline = h(
    'div',
    { class: 'timeline', style: `height:${24 * 60 * PX_PER_MIN}px` },
    Array.from({ length: 24 }, (_, hr) =>
      h('div', { class: 'hour', style: `top:${hr * 60 * PX_PER_MIN}px` }, h('span', {}, `${String(hr).padStart(2, '0')}:00`)),
    ),
    plan.map(blockEl),
    h('div', { class: 'now-line', style: `top:${minuteOfDay(now) * PX_PER_MIN}px` }),
  );

  const scroller = h('div', { class: 'timeline-scroll' }, timeline);
  requestAnimationFrame(() => {
    if (!scroller.dataset.placed) {
      scroller.dataset.placed = '1';
      scroller.scrollTop = Math.max(0, (minuteOfDay(now) - 120) * PX_PER_MIN);
    }
  });

  const selected = plan.find((p) => p.id === selectedToday) ?? null;
  const side = oneOffDraft ? renderOneOffForm(key) : selected ? renderTodayDetail(selected, key, now) : renderTodayHint(plan.length);

  return h(
    'section',
    { class: 'page today' },
    h(
      'header',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Today'), h('p', { class: 'sub' }, `${date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${formatDuration(plannedMs)} planned`)),
      h(
        'button',
        {
          class: 'btn',
          onClick: () => {
            const start = Math.ceil(minuteOfDay(now) / 5) * 5;
            oneOffDraft = {
              id: newId(),
              name: '',
              color: PALETTE[4],
              start: fromMinutes(Math.min(start, 23 * 60)),
              end: fromMinutes(Math.min(start + 30, 23 * 60 + 59)),
              days: [],
              optional: false,
              steps: [],
            };
            selectedToday = null;
            error = '';
            render();
          },
        },
        '+ Just for today',
      ),
    ),
    h('div', { class: 'split' }, scroller, h('aside', { class: 'panel' }, side)),
  );
}

function renderTodayHint(count: number) {
  return h(
    'div',
    { class: 'hint' },
    count
      ? h('p', {}, 'Pick a block to log it, skip it, or move it. Changes here only affect today; your routine stays as it is.')
      : h('div', {}, h('p', {}, 'Nothing planned today.'), h('button', { class: 'btn', onClick: () => go('routine') }, 'Set up your routine')),
  );
}

/** The session ritual for one block: intention and to-dos before, a note after. */
function ritualGroup(p: Planned, key: string, ended: boolean) {
  const rec = dayRecord(getState(), key);
  const intention = rec.intentions[p.id];
  return h(
    'div',
    { class: 'group' },
    h('h3', {}, 'Intention'),
    h('input', {
      value: intention?.text ?? '',
      placeholder: 'What do you want to get done?',
      onChange: (e: Event) => setIntention(key, p.id, (e.target as HTMLInputElement).value),
    }),
    intention?.todos.length
      ? h(
          'ul',
          { class: 'todo-list' },
          intention.todos.map((t) =>
            h(
              'li',
              {},
              h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.done, onChange: () => toggleTodo(key, p.id, t.id) }), h('span', { class: t.done ? 'struck' : '' }, t.text)),
              h('button', { class: 'icon', title: 'Remove', onClick: () => removeTodo(key, p.id, t.id) }, '×'),
            ),
          ),
        )
      : null,
    h('input', {
      placeholder: '+ Add a to-do and press Enter',
      onKeydown: (e: KeyboardEvent) => e.key === 'Enter' && addTodo(key, p.id, (e.target as HTMLInputElement).value),
    }),
    ended &&
      h(
        'div',
        { class: 'field' },
        h('span', {}, 'Note'),
        h('input', {
          value: rec.notes[p.id] ?? '',
          placeholder: 'A line on how it went',
          onChange: (e: Event) => setNote(key, p.id, (e.target as HTMLInputElement).value),
        }),
      ),
  );
}

function renderTodayDetail(p: Planned, key: string, now: number) {
  const status = dayRecord(getState(), key).log[p.id];
  const ended = p.endMs <= now;
  const running = p.startMs <= now && now < p.endMs;
  let start = p.start;
  let end = p.end;

  const moveToday = () => {
    if (toMinutes(end) <= toMinutes(start)) return fail('The end needs to be after the start.');
    const clash = planOverlap(
      planFor(getState(), new Date(now)),
      { id: p.id, start, end },
    );
    if (clash) return fail(`That overlaps ${clash.name} (${clash.start}–${clash.end}).`);
    error = '';
    void update((d) => {
      const day = ensureDay(d, key);
      const oneOff = day.override.extra.find((b) => b.id === p.id);
      if (oneOff) Object.assign(oneOff, { start, end });
      else day.override.times[p.id] = { start, end };
    });
  };

  return h(
    'div',
    { class: 'detail' },
    h('div', { class: 'detail-head', style: `--c:${p.color}` }, h('h2', {}, p.name), h('p', { class: 'sub' }, `${p.start}–${p.end}`)),
    p.skippedToday
      ? h('div', { class: 'group' }, h('p', {}, 'Skipped for today.'), h('button', { class: 'btn', onClick: () => restoreToday(key, p.id) }, 'Bring it back'))
      : [
          running && p.optional && !dayRecord(getState(), key).startedAt[p.id]
            ? h('div', { class: 'group' }, h('button', { class: 'btn primary', onClick: () => startBlock(key, p.id) }, 'Start now'))
            : null,
          ended || running
            ? h(
                'div',
                { class: 'group' },
                h('h3', {}, 'How did it go?'),
                h(
                  'div',
                  { class: 'seg-buttons' },
                  (['done', 'partly', 'skipped'] as BlockStatus[]).map((s) =>
                    h('button', { class: status === s ? 'on' : '', onClick: () => logBlock(key, p.id, status === s ? null : s) }, STATUS_LABEL[s]),
                  ),
                ),
              )
            : null,
          ritualGroup(p, key, ended),
          h(
            'div',
            { class: 'group' },
            h('h3', {}, 'Just for today'),
            h('div', { class: 'row' }, field('Start', timeInput(start, (v) => (start = v))), field('End', timeInput(end, (v) => (end = v)))),
            errorBox(),
            h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn', onClick: moveToday }, 'Move'),
              p.movedToday &&
                h(
                  'button',
                  {
                    class: 'btn ghost',
                    onClick: () => update((d) => void delete ensureDay(d, key).override.times[p.id]),
                  },
                  'Back to routine time',
                ),
              !ended && h('button', { class: 'btn ghost', onClick: () => skipToday(key, p.id) }, 'Skip today'),
            ),
          ),
          p.oneOff &&
            h(
              'div',
              { class: 'group' },
              h(
                'button',
                {
                  class: 'btn danger',
                  onClick: () => {
                    selectedToday = null;
                    void update((d) => {
                      const day = ensureDay(d, key);
                      day.override.extra = day.override.extra.filter((b) => b.id !== p.id);
                      delete day.log[p.id];
                    });
                  },
                },
                'Remove this one-off',
              ),
            ),
        ],
  );
}

function renderOneOffForm(key: string) {
  const draft = oneOffDraft!;
  const save = () => {
    if (!draft.name.trim()) return fail('Give it a name.');
    if (toMinutes(draft.end) <= toMinutes(draft.start)) return fail('The end needs to be after the start.');
    const clash = planOverlap(planFor(getState(), new Date()), draft);
    if (clash) return fail(`That overlaps ${clash.name} (${clash.start}–${clash.end}).`);
    const block = { ...draft, name: draft.name.trim() };
    oneOffDraft = null;
    selectedToday = block.id;
    error = '';
    void update((d) => void ensureDay(d, key).override.extra.push(block));
  };
  return h(
    'div',
    { class: 'detail' },
    h('h2', {}, 'Just for today'),
    h('p', { class: 'sub' }, 'A one-off block. It won’t become part of your routine.'),
    field('Name', h('input', { value: draft.name, placeholder: 'Dentist, call mum…', onInput: (e: Event) => (draft.name = (e.target as HTMLInputElement).value) })),
    h('div', { class: 'row' }, field('Start', timeInput(draft.start, (v) => (draft.start = v))), field('End', timeInput(draft.end, (v) => (draft.end = v)))),
    field('Colour', swatches(draft.color, (c) => ((draft.color = c), render()))),
    errorBox(),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn primary', onClick: save }, 'Add to today'),
      h('button', { class: 'btn ghost', onClick: () => ((oneOffDraft = null), (error = ''), render()) }, 'Cancel'),
    ),
  );
}

// ── Routine ──────────────────────────────────────────────────────────────────

function renderRoutine(): HTMLElement {
  const { routine } = getState();
  const sorted = [...routine].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  const list = sorted.length
    ? h(
        'div',
        { class: 'routine-list' },
        sorted.map((b) =>
          h(
            'button',
            {
              class: `routine-item${routineDraft?.id === b.id ? ' selected' : ''}`,
              style: `--c:${b.color}`,
              onClick: () => {
                routineDraft = structuredClone(b);
                error = '';
                render();
              },
            },
            h('span', { class: 'ri-time' }, `${b.start}–${b.end}`),
            h('span', { class: 'ri-name' }, b.name),
            h(
              'span',
              { class: 'ri-meta' },
              daysLabel(b.days),
              b.optional ? ' · optional' : '',
              b.steps.length ? ` · ${b.steps.length} steps` : '',
            ),
          ),
        ),
      )
    : h(
        'div',
        { class: 'empty' },
        h('h2', {}, 'Let’s build your day'),
        h('p', {}, 'Add the blocks you want to follow: waking up, work, meals, study, winding down. Mark the ones you don’t do every day as optional, and they’ll ask before starting.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: newBlock }, 'Add a block'), h('button', { class: 'btn', onClick: () => update((d) => void (d.routine = sampleRoutine())) }, 'Start from a sample')),
      );

  return h(
    'section',
    { class: 'page routine' },
    h(
      'header',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Routine'), h('p', { class: 'sub' }, 'Your usual day. Edit it any time; changes apply straight away.')),
      sorted.length > 0 && h('button', { class: 'btn', onClick: newBlock }, '+ Add block'),
    ),
    h('div', { class: 'split' }, list, h('aside', { class: 'panel' }, routineDraft ? renderBlockEditor(routineDraft) : h('div', { class: 'hint' }, h('p', {}, 'Pick a block to edit it.')))),
  );
}

function newBlock() {
  const { routine } = getState();
  const lastEnd = routine.reduce((m, b) => Math.max(m, toMinutes(b.end)), 8 * 60);
  const start = Math.min(lastEnd, 23 * 60);
  routineDraft = {
    id: newId(),
    name: '',
    color: PALETTE[routine.length % PALETTE.length],
    start: fromMinutes(start),
    end: fromMinutes(Math.min(start + 60, 23 * 60 + 59)),
    days: [0, 1, 2, 3, 4, 5, 6],
    optional: false,
    steps: [],
  };
  error = '';
  render();
}

function renderBlockEditor(draft: Block): HTMLElement {
  const isNew = !getState().routine.some((b) => b.id === draft.id);
  const duration = toMinutes(draft.end) - toMinutes(draft.start);
  const stepsTotal = draft.steps.reduce((sum, s) => sum + (s.minutes || 0), 0);

  const save = () => {
    const name = draft.name.trim();
    if (!name) return fail('Give the block a name.');
    if (draft.days.length === 0) return fail('Pick at least one day.');
    if (toMinutes(draft.end) <= toMinutes(draft.start)) return fail('The end needs to be after the start. (Blocks can’t cross midnight yet.)');
    const clash = routineOverlap(getState().routine, draft);
    if (clash) return fail(`That overlaps ${clash.block.name} (${clash.block.start}–${clash.block.end}) on ${DAY_NAMES[clash.day]}.`);
    const block: Block = {
      ...draft,
      name,
      steps: draft.steps.filter((s) => s.name.trim() && s.minutes > 0).map((s) => ({ ...s, name: s.name.trim() })),
    };
    routineDraft = block;
    error = '';
    void update((d) => {
      const i = d.routine.findIndex((b) => b.id === block.id);
      if (i >= 0) d.routine[i] = block;
      else d.routine.push(block);
    });
  };

  // Re-rendering mid-edit would steal focus from the time inputs, so only the label updates
  const durationEl = h('span', { class: 'duration' });
  const showDuration = () => {
    const minutes = toMinutes(draft.end) - toMinutes(draft.start);
    durationEl.textContent = minutes > 0 ? formatDuration(minutes * 60_000) : '';
  };
  showDuration();

  const setDays = (days: number[]) => ((draft.days = days), render());
  const toggleDay = (day: number) => setDays(draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day]);

  return h(
    'div',
    { class: 'detail editor' },
    h('h2', {}, isNew ? 'New block' : 'Edit block'),
    field('Name', h('input', { value: draft.name, placeholder: 'Gym, deep work, study…', onInput: (e: Event) => (draft.name = (e.target as HTMLInputElement).value) })),
    h(
      'div',
      { class: 'row' },
      field('Start', timeInput(draft.start, (v) => ((draft.start = v), showDuration()))),
      field('End', timeInput(draft.end, (v) => ((draft.end = v), showDuration()))),
      durationEl,
    ),
    field('Colour', swatches(draft.color, (c) => ((draft.color = c), render()))),
    h(
      'div',
      { class: 'field' },
      h('span', {}, 'Days'),
      h('div', { class: 'days' }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('button', { type: 'button', class: draft.days.includes(d) ? 'on' : '', onClick: () => toggleDay(d) }, DAY_NAMES[d]))),
      h(
        'div',
        { class: 'quick' },
        h('button', { type: 'button', onClick: () => setDays([0, 1, 2, 3, 4, 5, 6]) }, 'Every day'),
        h('button', { type: 'button', onClick: () => setDays([1, 2, 3, 4, 5]) }, 'Weekdays'),
        h('button', { type: 'button', onClick: () => setDays([0, 6]) }, 'Weekends'),
      ),
    ),
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', checked: draft.optional, onChange: (e: Event) => (draft.optional = (e.target as HTMLInputElement).checked) }),
      h('span', {}, h('strong', {}, 'Optional'), ' — asks “start or skip?” instead of starting on its own. For things you don’t do every day.'),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', {}, 'Steps (optional)'),
      h('p', { class: 'sub small' }, 'Timed steps that move on by themselves: shower 15 min → get dressed 10 min.'),
      draft.steps.map((s, i) =>
        h(
          'div',
          { class: 'step-row' },
          h('input', { value: s.name, placeholder: `Step ${i + 1}`, onInput: (e: Event) => (s.name = (e.target as HTMLInputElement).value) }),
          h('input', {
            type: 'number',
            min: '1',
            value: String(s.minutes),
            class: 'minutes',
            onChange: (e: Event) => ((s.minutes = Number((e.target as HTMLInputElement).value)), render()),
          }),
          h('span', { class: 'unit' }, 'min'),
          h('button', { type: 'button', class: 'icon', title: 'Remove step', onClick: () => ((draft.steps = draft.steps.filter((x) => x !== s)), render()) }, '×'),
        ),
      ),
      h('button', { type: 'button', class: 'btn ghost small', onClick: () => (draft.steps.push({ id: newId(), name: '', minutes: 5 }), render()) }, '+ Add step'),
      draft.steps.length > 0 &&
        h('p', { class: `sub small${stepsTotal > duration ? ' warn' : ''}` }, `Steps add up to ${stepsTotal} of ${Math.max(0, duration)} min${stepsTotal > duration ? '. The block ends before the last steps.' : ''}`),
    ),
    errorBox(),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn primary', onClick: save }, isNew ? 'Add to routine' : 'Save'),
      h('button', { class: 'btn ghost', onClick: () => ((routineDraft = null), (error = ''), render()) }, 'Cancel'),
      !isNew &&
        h(
          'button',
          {
            class: 'btn danger push',
            onClick: () => {
              if (!confirm(`Delete “${draft.name}” from your routine?`)) return;
              routineDraft = null;
              void update((d) => void (d.routine = d.routine.filter((b) => b.id !== draft.id)));
            },
          },
          'Delete',
        ),
    ),
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

function renderSettings(): HTMLElement {
  const { settings } = getState();
  const autostart = h('input', { type: 'checkbox', disabled: !inTauri });
  if (inTauri) void autostartEnabled().then((on) => (autostart.checked = on));
  autostart.addEventListener('change', () => void (autostart.checked ? enableAutostart() : disableAutostart()));

  return h(
    'section',
    { class: 'page settings' },
    h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'))),
    h(
      'div',
      { class: 'settings-list' },
      h(
        'div',
        { class: 'setting' },
        h('div', {}, h('h3', {}, 'Heads-up before a block ends'), h('p', { class: 'sub' }, 'Minutes before the end (or before the next block during free time). Separate with commas.')),
        h('input', {
          value: settings.warnMinutes.join(', '),
          class: 'narrow',
          onChange: (e: Event) => {
            const minutes = [...new Set((e.target as HTMLInputElement).value.split(',').map((v) => Math.round(Number(v.trim()))))].filter((n) => n > 0 && n <= 120);
            void update((d) => void (d.settings.warnMinutes = minutes));
          },
        }),
      ),
      h(
        'div',
        { class: 'setting' },
        h('div', {}, h('h3', {}, 'Chime'), h('p', { class: 'sub' }, 'A soft sound with each heads-up and when a block starts.')),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn ghost small', onClick: () => chime() }, 'Play'),
          h('input', { type: 'checkbox', checked: settings.chime, onChange: (e: Event) => update((d) => void (d.settings.chime = (e.target as HTMLInputElement).checked)) }),
        ),
      ),
      h(
        'div',
        { class: 'setting' },
        h(
          'div',
          {},
          h('h3', {}, 'Hyperfocus guard'),
          h('p', { class: 'sub' }, `When a block ends and you haven’t switched, you get a notification after this many minutes and a full-screen reminder after ${settings.escalateAfterMin * 2}.`),
        ),
        h('input', {
          type: 'number',
          min: '1',
          max: '60',
          class: 'narrow',
          value: String(settings.escalateAfterMin),
          onChange: (e: Event) => {
            const n = Math.min(60, Math.max(1, Math.round(Number((e.target as HTMLInputElement).value)) || 5));
            void update((d) => void (d.settings.escalateAfterMin = n));
          },
        }),
      ),
      h(
        'div',
        { class: 'setting' },
        h('div', {}, h('h3', {}, 'Ask for an intention'), h('p', { class: 'sub' }, 'When a block starts, the widget asks what you want to get done. You can always say “not now”.')),
        h('input', { type: 'checkbox', checked: settings.askIntention, onChange: (e: Event) => update((d) => void (d.settings.askIntention = (e.target as HTMLInputElement).checked)) }),
      ),
      h(
        'div',
        { class: 'setting' },
        h('div', {}, h('h3', {}, 'Start with Windows'), h('p', { class: 'sub' }, inTauri ? 'Open the widget when you sign in.' : 'Available in the desktop app.')),
        autostart,
      ),
      h(
        'div',
        { class: 'setting' },
        h('div', {}, h('h3', {}, 'Widget position'), h('p', { class: 'sub' }, 'Drag the widget anywhere. This puts it back in the bottom-right corner.')),
        h('button', { class: 'btn ghost small', onClick: () => update((d) => void (d.settings.widgetPos = null)) }, 'Reset'),
      ),
    ),
  );
}

// ── Start up ─────────────────────────────────────────────────────────────────

function fail(message: string) {
  error = message;
  render();
}

async function main() {
  await initStore();
  unlockAudioOnClick();
  view = getState().routine.length ? 'today' : 'routine';
  document.querySelectorAll<HTMLButtonElement>('.nav button[data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view as View)));
  document.getElementById('open-focus')!.addEventListener('click', async () => {
    if (!inTauri) return void window.open('/focus.html', 'focus');
    const focus = await Window.getByLabel('focus');
    await focus?.show();
    await focus?.setFocus();
    await emit('focus-mode', 'focus');
  });
  subscribe(() => render());
  // The widget and tray open the planner on a specific page
  if (inTauri) await listen<View>('planner-view', (e) => go(e.payload));
  if (location.hash === '#parking' || location.hash === '#garden') view = location.hash.slice(1) as View;
  render();

  // Keep the "now" line and the ended-block buttons fresh, without wiping a half-typed form
  setInterval(() => {
    if (view === 'today' && !document.activeElement?.matches('input, textarea, select')) render();
  }, 60_000);
}

void main();
