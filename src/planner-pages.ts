import { parkThought, parkedToTodo, removeParked, setParkedDone } from './actions';
import { h } from './dom';
import { planFor } from './engine';
import { FOREST_SIZE, PLANT_COST, POINTS, SPECIES_NAMES, STAGE_AT, STAGE_NAMES, garden } from './garden';
import { renderGarden } from './garden-view';
import { type Parked, dayKey } from './model';
import { getState } from './store';

/** The planner's Garden and Parking lot pages. */

// ── Garden ───────────────────────────────────────────────────────────────────

export function renderGardenPage(): HTMLElement {
  const g = garden(getState());
  const growing = g.growing;
  const next = growing.length ? Math.min(...growing.map((p) => (STAGE_AT[p.stage + 1] ?? PLANT_COST) - p.points)) : 0;
  const lead = growing[0];

  const status = g.forestComplete
    ? h('p', {}, h('strong', {}, 'Your forest is complete.'), ` Wildflowers keep appearing as you show up: ${g.flowers.length} so far.`)
    : lead
      ? h(
          'p',
          {},
          growing.length === 1
            ? [`Your ${SPECIES_NAMES[lead.species]} is a `, h('strong', {}, STAGE_NAMES[lead.stage].toLowerCase()), '.']
            : [h('strong', {}, `${growing.length} young plants`), ' are growing side by side.'],
          ` About ${next} more point${next === 1 ? '' : 's'} until the next one grows.`,
        )
      : null;

  return h(
    'section',
    { class: 'page garden-page' },
    h(
      'header',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Your garden'), h('p', { class: 'sub' }, 'It grows every time you show up for a block. Nothing here ever shrinks.')),
    ),
    h('div', { class: 'garden-card' }, renderGarden(g, { backdrop: true })),
    g.sleepy && h('p', { class: 'sleepy-note' }, 'Your garden missed you. One block brings it back to life. It hasn’t lost a single leaf.'),
    h(
      'div',
      { class: 'garden-stats' },
      stat(String(g.grownCount), `of ${FOREST_SIZE} trees grown`),
      stat(String(g.total), 'growth points'),
      stat(g.forestComplete ? 'Forest' : `${growing.length}`, g.forestComplete ? 'complete' : growing.length === 1 ? 'plant growing' : 'plants growing'),
    ),
    status,
    h(
      'div',
      { class: 'garden-how' },
      h('h3', {}, 'How it grows'),
      h(
        'ul',
        {},
        h('li', {}, `A block marked `, h('strong', {}, 'Done'), ` gives ${POINTS.done} points, `, h('strong', {}, 'Partly'), ` gives ${POINTS.partly}. Skipping is free; it just doesn’t grow anything.`),
        h('li', {}, `Each plant goes seed → sprout → seedling → sapling → young tree → fully grown (${PLANT_COST} points).`),
        h('li', {}, 'When a plant is fully grown, two new seedlings start beside it. Then each of those makes two more.'),
        h('li', {}, `${FOREST_SIZE} grown trees make a full forest. After that, wildflowers.`),
        h('li', {}, 'Away for a few days? It looks a little sleepy until you’re back. It never loses anything.'),
      ),
    ),
  );
}

function stat(value: string, label: string) {
  return h('div', { class: 'stat' }, h('strong', {}, value), h('span', {}, label));
}

// ── Parking lot ──────────────────────────────────────────────────────────────

let showDone = false;

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function parkedRow(item: Parked, rerender: () => void) {
  const now = Date.now();
  const key = dayKey(new Date(now));
  const blocks = planFor(getState(), new Date(now)).filter((b) => b.endMs > now);
  return h(
    'li',
    { class: `parked${item.done ? ' done' : ''}` },
    h('input', { type: 'checkbox', checked: item.done, title: item.done ? 'Bring it back' : 'Dealt with', onChange: () => setParkedDone(item.id, !item.done) }),
    h('div', { class: 'parked-text' }, h('span', {}, item.text), h('span', { class: 'sub small' }, ago(item.at))),
    !item.done &&
      blocks.length > 0 &&
      h(
        'select',
        {
          class: 'to-block',
          title: 'Make it a to-do in one of today’s blocks',
          onChange: (e: Event) => {
            const blockId = (e.target as HTMLSelectElement).value;
            if (blockId) void parkedToTodo(item.id, key, blockId).then(rerender);
          },
        },
        h('option', { value: '' }, 'Make it a to-do…'),
        blocks.map((b) => h('option', { value: b.id }, `${b.start} ${b.name}`)),
      ),
    h('button', { class: 'icon', title: 'Delete', onClick: () => removeParked(item.id) }, '×'),
  );
}

export function renderParkingPage(rerender: () => void): HTMLElement {
  const { parked } = getState();
  const open = parked.filter((p) => !p.done).sort((a, b) => b.at - a.at);
  const done = parked.filter((p) => p.done).sort((a, b) => b.at - a.at);

  const input = h('input', { placeholder: 'Park a thought…', 'data-autofocus': '' });
  const add = () => {
    const text = input.value;
    if (!text.trim()) return;
    void parkThought(text).then(() => document.querySelector<HTMLInputElement>('[data-autofocus]')?.focus());
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());

  return h(
    'section',
    { class: 'page parking-page' },
    h(
      'header',
      { class: 'page-head' },
      h(
        'div',
        {},
        h('h1', {}, 'Parking lot'),
        h('p', { class: 'sub' }, 'Thoughts you caught mid-focus, waiting for when you have room. Press ', h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'Shift'), '+', h('kbd', {}, 'Space'), ' anywhere to park one.'),
      ),
    ),
    h('div', { class: 'park-add' }, input, h('button', { class: 'btn', onClick: add }, 'Park')),
    open.length
      ? h('ul', { class: 'parked-list' }, open.map((item) => parkedRow(item, rerender)))
      : h('div', { class: 'empty-lot' }, h('p', {}, 'Nothing parked. Your head is clear, or at least this list is.')),
    done.length > 0 &&
      h(
        'div',
        { class: 'parked-done' },
        h('button', { class: 'btn ghost small', onClick: () => ((showDone = !showDone), rerender()) }, `${showDone ? 'Hide' : 'Show'} dealt with (${done.length})`),
        showDone && h('ul', { class: 'parked-list' }, done.map((item) => parkedRow(item, rerender))),
      ),
  );
}

