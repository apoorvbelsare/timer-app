import '@fontsource-variable/fraunces';
import '@fontsource-variable/nunito';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { addTodo, removeTodo, setIntention, toggleTodo } from './actions';
import { chime, unlockAudioOnClick } from './alerts';
import { startFlock } from './birds';
import { h } from './dom';
import { type Snapshot, dayRecord, snapshot } from './engine';
import { type Ambient, formatClock, formatDuration } from './model';
import { CIRCUMFERENCE, RING_R, ringColor, ringRemaining, ringText } from './ring';
import { AMBIENT_LABELS, playAmbient, setAmbientVolume, stopAmbient } from './sounds';
import { getState, inTauri, initStore, subscribe, update } from './store';
import './styles/focus.css';

/**
 * Focus mode: the "during" of the session ritual. A big ring, your intention and
 * to-dos, a drifting flock for company, ambient sound, and recharge breaks.
 */

export type FocusMode = 'focus' | 'breathe' | 'stretch';

const stage = document.getElementById('stage')!;
const win = inTauri ? getCurrentWindow() : null;
let mode: FocusMode = 'focus';
let structureKey = '';
let refocusAdd = false;
let recharge: { stop: () => void } | null = null;

// ── Focus stage ──────────────────────────────────────────────────────────────

let ringArc: SVGCircleElement | null = null;
let ringValue: HTMLElement | null = null;
let ringUnit: HTMLElement | null = null;
let untilEl: HTMLElement | null = null;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function bigRing() {
  const root = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  root.append(svg('circle', { class: 'track', cx: '50', cy: '50', r: String(RING_R) }));
  ringArc = svg('circle', { class: 'arc', cx: '50', cy: '50', r: String(RING_R), transform: 'rotate(-90 50 50)' });
  root.append(ringArc);
  ringValue = h('span', { class: 'ring-value' });
  ringUnit = h('span', { class: 'ring-unit' });
  return h('div', { class: 'big-ring' }, root, h('div', { class: 'ring-label' }, ringValue, ringUnit));
}

function renderFocusStage(s: Snapshot) {
  const rec = dayRecord(getState(), s.key);
  const block = s.current && !s.awaitingStart ? s.current : null;
  const intention = block ? rec.intentions[block.id] : undefined;
  const key = `${s.key}:${s.current?.id ?? ''}:${s.awaitingStart}:${s.next?.id ?? ''}:${JSON.stringify(intention ?? null)}`;
  if (key !== structureKey) {
    // Fade in on arrival only, not every time a to-do is ticked
    const arriving = structureKey === '';
    structureKey = key;
    untilEl = h('p', { class: 'until' });
    stage.replaceChildren(
      h(
        'div',
        { class: `focus-stage${arriving ? ' arriving' : ''}` },
        h('p', { class: 'eyebrow' }, block ? 'Now' : s.current ? 'Optional · not started' : s.next ? 'Free time' : 'Day done'),
        h('h1', {}, s.current?.name ?? (s.next ? 'A breather' : 'All done for today')),
        bigRing(),
        untilEl,
        block ? intentionEditor(s.key, block.id, intention?.text ?? '', intention?.todos ?? []) : freeTimeNote(s),
      ),
    );
    if (refocusAdd) {
      refocusAdd = false;
      stage.querySelector<HTMLInputElement>('.todo-add')?.focus();
    }
  }
  updateRing(s);
}

function updateRing(s: Snapshot) {
  if (!ringArc || !ringValue || !ringUnit || !untilEl) return;
  ringArc.style.strokeDasharray = `${CIRCUMFERENCE * ringRemaining(s)} ${CIRCUMFERENCE}`;
  ringArc.style.stroke = ringColor(s);
  const [value, unit] = s.current || s.next ? ringText(s.remainingMs) : ['✓', ''];
  ringValue.textContent = value;
  ringUnit.textContent = unit;
  if (s.current) {
    const step = s.step ? `${s.step.step.name} · ${formatDuration(s.step.remainingMs)} · ` : '';
    untilEl.textContent = `${step}until ${s.current.end}${s.next ? ` · then ${s.next.name}` : ''}`;
  } else {
    untilEl.textContent = s.next ? `${s.next.name} at ${s.next.start}` : '';
  }
}

function intentionEditor(key: string, id: string, text: string, todos: { id: string; text: string; done: boolean }[]) {
  const add = h('input', {
    class: 'todo-add',
    placeholder: '+ Add a to-do and press Enter',
    onKeydown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const input = e.target as HTMLInputElement;
      refocusAdd = true;
      void addTodo(key, id, input.value);
    },
  });
  return h(
    'div',
    { class: 'intention' },
    h('input', {
      class: 'intention-text',
      value: text,
      placeholder: 'What’s your intention for this block?',
      onChange: (e: Event) => setIntention(key, id, (e.target as HTMLInputElement).value),
      onKeydown: (e: KeyboardEvent) => e.key === 'Enter' && (e.target as HTMLInputElement).blur(),
    }),
    h(
      'ul',
      { class: 'todos' },
      todos.map((t) =>
        h(
          'li',
          { class: t.done ? 'done' : '' },
          h('label', {}, h('input', { type: 'checkbox', checked: t.done, onChange: () => toggleTodo(key, id, t.id) }), h('span', {}, t.text)),
          h('button', { class: 'remove', title: 'Remove', onClick: () => removeTodo(key, id, t.id) }, '×'),
        ),
      ),
    ),
    add,
  );
}

function freeTimeNote(s: Snapshot) {
  if (!s.next) return h('p', { class: 'soft' }, 'Nothing else planned. Rest is part of the routine too.');
  if (s.current) return h('p', { class: 'soft' }, 'Start it from the widget when you’re ready, or let it pass.');
  return h('p', { class: 'soft' }, s.remainingMs > 3 * 60_000 ? 'A good moment for a breather before what’s next.' : `${s.next.name} is about to start.`);
}

// ── Recharge: breathing ──────────────────────────────────────────────────────

const BREATHE_MS = 2 * 60_000;
const INHALE_MS = 4000;
const EXHALE_MS = 6000;

function startBreathe() {
  const circle = h('div', { class: 'breath' });
  const label = h('p', { class: 'breath-label' }, 'Get comfortable');
  const left = h('p', { class: 'soft' });
  stage.replaceChildren(
    h('div', { class: 'recharge-stage' }, h('p', { class: 'eyebrow' }, 'Recharge'), h('h1', {}, 'Breathe'), h('div', { class: 'breath-wrap' }, circle), label, left, backButton()),
  );

  const began = Date.now() + 1500;
  let phase = '';
  const timer = window.setInterval(() => {
    const elapsed = Date.now() - began;
    if (elapsed < 0) return;
    if (elapsed >= BREATHE_MS) {
      finish('Nicely done.', 'Two minutes of slow breathing. Ready when you are.');
      return;
    }
    const inCycle = elapsed % (INHALE_MS + EXHALE_MS);
    const next = inCycle < INHALE_MS ? 'in' : 'out';
    if (next !== phase) {
      phase = next;
      label.textContent = next === 'in' ? 'Breathe in…' : 'and out…';
      circle.style.transitionDuration = `${next === 'in' ? INHALE_MS : EXHALE_MS}ms`;
      circle.classList.toggle('full', next === 'in');
    }
    left.textContent = `${formatDuration(BREATHE_MS - elapsed)} left`;
  }, 200);
  recharge = { stop: () => clearInterval(timer) };
}

// ── Recharge: stretching ─────────────────────────────────────────────────────

const STRETCHES = [
  ['Roll your shoulders', 'Slow circles backwards, then forwards.'],
  ['Neck release', 'Ear towards one shoulder, breathe, then the other side.'],
  ['Reach up', 'Stand up and reach for the ceiling. Let your back lengthen.'],
  ['Wrists and hands', 'Gentle circles, then spread your fingers wide.'],
  ['Look far away', 'Find something distant and let your eyes soften.'],
  ['Shake it out', 'Loosen your hands, arms and legs. Feel a bit silly. Good.'],
] as const;
const STRETCH_MS = 30_000;

function startStretch() {
  const title = h('h2', {});
  const detail = h('p', { class: 'soft' });
  const counter = h('p', { class: 'eyebrow' });
  const bar = h('div', { class: 'bar-fill' });
  let index = -1;
  let stepStart = 0;

  const show = (i: number) => {
    index = i;
    stepStart = Date.now();
    if (i >= STRETCHES.length) {
      finish('All loosened up.', 'Your body will thank you. Back to it?');
      return;
    }
    if (i > 0 && getState().settings.chime) chime('step');
    counter.textContent = `Stretch ${i + 1} of ${STRETCHES.length}`;
    title.textContent = STRETCHES[i][0];
    detail.textContent = STRETCHES[i][1];
  };

  stage.replaceChildren(
    h(
      'div',
      { class: 'recharge-stage' },
      counter,
      h('h1', {}, 'Stretch'),
      title,
      detail,
      h('div', { class: 'bar' }, bar),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onClick: () => show(index + 1) }, 'Next'), backButton()),
    ),
  );
  show(0);

  const timer = window.setInterval(() => {
    const elapsed = Date.now() - stepStart;
    bar.style.width = `${Math.min(100, (elapsed / STRETCH_MS) * 100)}%`;
    if (elapsed >= STRETCH_MS) show(index + 1);
  }, 200);
  recharge = { stop: () => clearInterval(timer) };
}

function finish(title: string, body: string) {
  recharge?.stop();
  recharge = null;
  if (getState().settings.chime) chime();
  stage.replaceChildren(
    h('div', { class: 'recharge-stage' }, h('p', { class: 'eyebrow' }, 'Recharge'), h('h1', {}, title), h('p', { class: 'soft' }, body), h('button', { class: 'btn primary', onClick: () => setMode('focus') }, 'Back to focus')),
  );
}

function backButton() {
  return h('button', { class: 'btn ghost', onClick: () => setMode('focus') }, 'Back to focus');
}

// ── Modes, dock and window ───────────────────────────────────────────────────

function setMode(next: FocusMode) {
  recharge?.stop();
  recharge = null;
  mode = next;
  structureKey = '';
  document.body.dataset.mode = next;
  if (next === 'breathe') startBreathe();
  else if (next === 'stretch') startStretch();
  else tick();
}

function tick() {
  const s = snapshot(getState(), Date.now());
  if (mode === 'focus') renderFocusStage(s);
  const companion = document.getElementById('companion')!;
  companion.textContent = s.current && !s.awaitingStart
    ? `Focus session · since ${formatClock(Math.max(s.current.startMs, dayRecord(getState(), s.key).startedAt[s.current.id] ?? 0))}`
    : 'The flock is here with you';
}

function renderDock() {
  const { ambient, ambientVolume } = getState().settings;
  const choose = (kind: Ambient) => {
    playAmbient(kind, getState().settings.ambientVolume);
    void update((d) => void (d.settings.ambient = kind));
  };
  document.getElementById('sounds')!.replaceChildren(
    ...(Object.keys(AMBIENT_LABELS) as Ambient[]).map((kind) =>
      h('button', { class: kind === ambient ? 'on' : '', 'aria-pressed': String(kind === ambient), onClick: () => choose(kind) }, AMBIENT_LABELS[kind]),
    ),
  );
  const volume = document.getElementById('volume') as HTMLInputElement;
  volume.value = String(ambientVolume);
}

async function hideWindow() {
  setMode('focus');
  stopAmbient();
  if (inTauri) await win!.hide();
  else window.close();
}

async function main() {
  await initStore();
  unlockAudioOnClick();
  startFlock(document.getElementById('sky') as HTMLCanvasElement, getComputedStyle(document.body).getPropertyValue('--bird').trim() || '#f3ead8');

  document.querySelectorAll<HTMLButtonElement>('.recharge button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as FocusMode)));
  const volume = document.getElementById('volume') as HTMLInputElement;
  volume.addEventListener('input', () => setAmbientVolume(Number(volume.value)));
  volume.addEventListener('change', () => update((d) => void (d.settings.ambientVolume = Number(volume.value))));
  document.getElementById('close')!.addEventListener('click', () => void hideWindow());

  const toggleFullscreen = async () => {
    if (inTauri) await win!.setFullscreen(!(await win!.isFullscreen()));
    else if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };
  document.getElementById('fullscreen')!.addEventListener('click', () => void toggleFullscreen());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      void toggleFullscreen();
    }
  });

  // Closing only hides the window; the sound has to stop with it
  if (win) {
    await win.onCloseRequested((e) => {
      e.preventDefault();
      void hideWindow();
    });
    // The widget and tray open this window with a mode in mind
    await listen<FocusMode>('focus-mode', (e) => {
      setMode(e.payload);
      const { ambient, ambientVolume } = getState().settings;
      playAmbient(ambient, ambientVolume);
    });
  }

  subscribe(() => {
    renderDock();
    if (mode === 'focus') tick();
  });
  renderDock();
  const fromHash = location.hash.slice(1) as FocusMode;
  setMode(['breathe', 'stretch'].includes(fromHash) ? fromHash : 'focus');
  setInterval(tick, 1000);
}

void main();
