import '@fontsource-variable/inter';
import { enable as enableAutostart } from '@tauri-apps/plugin-autostart';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { emit } from '@tauri-apps/api/event';
import { Window, currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { dismissIntention, logBlock, setIntention, skipToday, snooze, startBlock } from './actions';
import { chime, notify, unlockAudioOnClick } from './alerts';
import { h } from './dom';
import { type Snapshot, blockTasks, dayRecord, escalation, shutdownDue, snapshot } from './engine';
import type { FocusMode } from './focus';
import { formatDuration, minuteOfDay } from './model';
import { CIRCUMFERENCE, ringColor, ringRemaining, ringText } from './ring';
import { getState, inTauri, initStore, subscribe, update, wasFirstRun } from './store';
import './styles/widget.css';

const WIDTH = 320;
/** Tallest the widget gets: with the intention or review card open */
const MAX_HEIGHT = 260;

const $ = (id: string) => document.getElementById(id)!;
const app = $('app');
const arc = $('arc') as unknown as SVGCircleElement;
const promptEl = $('prompt');
const extrasEl = $('extras');

const win = inTauri ? getCurrentWindow() : null;

type PlannerView = 'today' | 'plan' | 'shutdown';

async function openPlanner(view?: PlannerView) {
  if (!inTauri) {
    window.open(`/planner.html${view ? `#${view}` : ''}`, 'planner');
    return;
  }
  const planner = await Window.getByLabel('planner');
  await planner?.show();
  await planner?.unminimize();
  await planner?.setFocus();
  if (view) await emit('planner-view', view);
}

async function openFocus(mode: FocusMode = 'focus') {
  if (!inTauri) {
    window.open(`/focus.html#${mode}`, 'focus');
    return;
  }
  const focus = await Window.getByLabel('focus');
  await focus?.show();
  await focus?.unminimize();
  await focus?.setFocus();
  await emit('focus-mode', mode);
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render(s: Snapshot) {
  const state = getState();
  arc.style.strokeDasharray = `${CIRCUMFERENCE * ringRemaining(s)} ${CIRCUMFERENCE}`;
  arc.style.stroke = ringColor(s);
  app.classList.toggle('waiting', s.awaitingStart);
  app.classList.toggle('closing', !!s.current && s.remainingMs <= 60_000);

  const [value, unit] = s.current || s.next ? ringText(s.remainingMs) : ['✓', ''];
  $('ring-value').textContent = value;
  $('ring-unit').textContent = unit;

  const nextLine = s.next ? `Next · ${s.next.name} ${s.next.start}` : '';
  if (state.routine.length === 0 && s.plan.length === 0) {
    setText('No routine yet', '', 'Open the planner to build your day', '');
    $('ring-value').textContent = '+';
  } else if (s.current && s.awaitingStart) {
    setText(s.current.name, 'Optional · start when you’re ready', `until ${s.current.end}`, nextLine);
  } else if (s.current) {
    // A running step wins, then what they meant to do, then the next open task
    const intention = dayRecord(state, s.key).intentions[s.current.id]?.text;
    const nextTask = blockTasks(state, s.key, s.current.id).find((t) => !t.done)?.title;
    const step = s.step
      ? `${s.step.step.name} · ${formatDuration(s.step.remainingMs)} (${s.step.index + 1}/${s.current.steps.length})`
      : intention || nextTask
        ? `→ ${intention || nextTask}`
        : '';
    setText(s.current.name, step, `${formatDuration(s.remainingMs)} left · until ${s.current.end}`, nextLine);
  } else if (s.next) {
    setText('Free time', '', `until ${s.next.start}`, nextLine);
  } else {
    setText('Done for today', '', 'Nothing else planned', '');
  }

  renderStrip(s);
  renderExtras(s);
  renderPrompt(s);
}

function setText(title: string, step: string, until: string, next: string) {
  $('title').textContent = title;
  $('step').textContent = step;
  $('step').hidden = !step;
  $('until').textContent = until;
  $('next').textContent = next;
}

/** A thin bar of the whole day, so "now" always has a place among the rest. */
function renderStrip(s: Snapshot) {
  const strip = $('strip');
  if (s.plan.length === 0) {
    strip.replaceChildren();
    return;
  }
  const nowMin = minuteOfDay(s.now);
  const first = Math.min(nowMin, ...s.plan.map((p) => minuteOfDay(p.startMs)));
  const last = Math.max(nowMin, ...s.plan.map((p) => minuteOfDay(p.endMs) || 24 * 60));
  const from = Math.floor(first / 60) * 60;
  const span = Math.max(60, Math.ceil(last / 60) * 60 - from);
  const pct = (min: number) => `${((min - from) / span) * 100}%`;

  strip.replaceChildren(
    ...s.plan.map((p) => {
      const start = minuteOfDay(p.startMs);
      const width = (p.endMs - p.startMs) / 60_000;
      return h('div', {
        class: `seg${p.endMs <= s.now ? ' past' : ''}`,
        style: `left:${pct(start)};width:${(width / span) * 100}%;background:${p.color}`,
        title: `${p.name} ${p.start}–${p.end}`,
      });
    }),
    h('div', { class: 'now', style: `left:${pct(nowMin)}` }),
  );
}

/**
 * One gentle nudge at a time, under the strip: close the day, plan it, or take
 * a recharge break when free time has room to spare.
 */
let extrasShown = '';
function renderExtras(s: Snapshot) {
  const state = getState();
  const rec = dayRecord(state, s.key);
  const kind = s.prompt
    ? ''
    : shutdownDue(state, s.now)
      ? 'shutdown'
      : state.settings.morningPlanning && !rec.planned && rec.shutdown === null && s.plan.length > 0
        ? 'plan'
        : !s.current && s.next && s.remainingMs > 3 * 60_000
          ? 'recharge'
          : '';
  if (kind === extrasShown) return;
  extrasShown = kind;
  extrasEl.hidden = !kind;
  const content = {
    '': [],
    shutdown: [h('span', {}, 'Evening'), h('button', { class: 'chip accent', onClick: () => openPlanner('shutdown') }, 'Close the day')],
    plan: [h('span', {}, 'Morning'), h('button', { class: 'chip accent', onClick: () => openPlanner('plan') }, 'Plan your day · 3 min')],
    recharge: [
      h('span', {}, 'Recharge'),
      h('button', { class: 'chip', onClick: () => openFocus('breathe') }, 'Breathe · 2 min'),
      h('button', { class: 'chip', onClick: () => openFocus('stretch') }, 'Stretch · 3 min'),
    ],
  }[kind];
  extrasEl.replaceChildren(...content);
}

let promptKey = '';

function renderPrompt(s: Snapshot) {
  const p = s.prompt;
  const key = p ? `${s.key}:${p.kind}:${p.block.id}` : '';
  if (key === promptKey) return;
  promptKey = key;
  promptEl.hidden = !p;
  if (!p) return promptEl.replaceChildren();

  if (p.kind === 'start') {
    promptEl.replaceChildren(
      h('p', {}, h('strong', {}, p.block.name), ' is on now. Start it?'),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'primary', onClick: () => startBlock(s.key, p.block.id) }, 'Start'),
        h('button', { onClick: () => skipToday(s.key, p.block.id) }, 'Skip today'),
      ),
    );
  } else if (p.kind === 'intention') {
    const input = h('input', {
      placeholder: 'One thing you want to get done…',
      onKeydown: (e: KeyboardEvent) => e.key === 'Enter' && save(),
    });
    const save = () => (input.value.trim() ? setIntention(s.key, p.block.id, input.value) : dismissIntention(s.key, p.block.id));
    promptEl.replaceChildren(
      h('p', {}, 'Starting ', h('strong', {}, p.block.name), '. What’s your intention?'),
      input,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'primary', onClick: save }, 'Set'),
        h('button', { onClick: () => dismissIntention(s.key, p.block.id) }, 'Not now'),
        h('button', { class: 'quiet', title: 'Open focus mode', onClick: () => void openFocus() }, 'Focus'),
      ),
    );
  } else {
    const note = h('input', { placeholder: 'A line on how it went (optional)' });
    const answer = (status: 'done' | 'partly' | 'skipped') => () => logBlock(s.key, p.block.id, status, note.value);
    promptEl.replaceChildren(
      h('p', {}, h('strong', {}, p.block.name), ' ended. How did it go?'),
      note,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'primary', onClick: answer('done') }, 'Done'),
        h('button', { onClick: answer('partly') }, 'Partly'),
        h('button', { onClick: answer('skipped') }, 'Skipped'),
        h('button', { class: 'quiet', title: 'Hold reminders for 10 minutes', onClick: () => snooze(s.key, p.block.id) }, '+10'),
      ),
    );
  }
}

/** The window follows the card's height, so the widget never clips or leaves a gap. */
function fitWindow() {
  let height = 0;
  new ResizeObserver(() => {
    const next = Math.min(MAX_HEIGHT, Math.ceil(app.getBoundingClientRect().height) + 8);
    if (next === height) return;
    height = next;
    void win?.setSize(new LogicalSize(WIDTH, next));
  }).observe(app);
}

// ── Alerts ───────────────────────────────────────────────────────────────────

const fired = new Set<string>();
let booted = false;
let lastCurrent = '';
let lastStep = '';
let overlayShownFor = '';

function alerts(s: Snapshot) {
  const state = getState();
  const { settings } = state;
  const sound = () => settings.chime && chime();
  const thresholds = [...settings.warnMinutes].sort((a, b) => a - b);

  // Heads-up before the current block ends, or before the next one starts during free time
  const target = s.current && !s.awaitingStart ? s.current : !s.current ? s.next : null;
  if (target) {
    const crossed = thresholds.filter((t) => s.remainingMs <= t * 60_000);
    const keyFor = (t: number) => `${s.key}:${target.id}:${s.current ? 'end' : 'start'}:${t}`;
    if (crossed.length && !fired.has(keyFor(crossed[0]))) {
      crossed.forEach((t) => fired.add(keyFor(t)));
      const left = formatDuration(s.remainingMs);
      if (s.current) {
        notify(`${target.name} ends in ${left}`, s.next ? `Next: ${s.next.name} at ${s.next.start}` : 'Nothing after this today');
      } else {
        notify(`${target.name} starts in ${left}`, `At ${target.start}. Time to wrap up what you’re doing.`);
      }
      sound();
    }
  }

  // A block begins, or a step inside it changes. Skipped on launch, mid-block.
  const currentKey = s.current ? `${s.key}:${s.current.id}` : '';
  if (booted && currentKey && currentKey !== lastCurrent && !s.awaitingStart) {
    notify(`Now: ${s.current!.name}`, `Until ${s.current!.end}`);
    sound();
  }
  lastCurrent = currentKey;

  const stepKey = s.step ? `${currentKey}:${s.step.index}` : '';
  if (booted && stepKey && stepKey !== lastStep && s.step!.index > 0 && settings.chime) chime('step');
  lastStep = stepKey;

  if (shutdownDue(state, s.now) && !fired.has(`${s.key}:shutdown`)) {
    fired.add(`${s.key}:shutdown`);
    notify('Time to close the day', 'A few minutes to see what got done and set tomorrow up.');
    sound();
  }

  // The hyperfocus guard: card → toast → overlay
  const p = s.prompt;
  if (p) {
    const rec = dayRecord(state, s.key);
    const level = escalation(p, rec, settings, s.now);
    const promptId = `${s.key}:${p.kind}:${p.block.id}:${rec.snoozedUntil[p.block.id] ?? ''}`;
    if (level !== 'none' && !fired.has(`${promptId}:notify`)) {
      fired.add(`${promptId}:notify`);
      if (p.kind === 'start') notify(`${p.block.name} is on now`, 'Start it or skip it. Either is fine.');
      else notify('Time to switch', `${p.block.name} ended ${formatDuration(s.now - p.block.endMs)} ago.`);
    }
    if (level === 'overlay' && overlayShownFor !== promptId) {
      overlayShownFor = promptId;
      void showOverlay();
    }
  }
  booted = true;
}

async function showOverlay() {
  if (!inTauri) return console.info('[overlay] would show now');
  const overlay = await Window.getByLabel('overlay');
  await overlay?.show();
  await overlay?.maximize();
  await overlay?.setFocus();
}

// ── Window placement ─────────────────────────────────────────────────────────

async function placeWidget() {
  if (!win) return;
  const saved = getState().settings.widgetPos;
  if (saved) return win.setPosition(new PhysicalPosition(saved.x, saved.y));
  // Bottom-right, with room above the taskbar for the tallest card
  const monitor = await currentMonitor();
  if (!monitor) return;
  const scale = monitor.scaleFactor;
  const x = monitor.position.x + monitor.size.width - Math.round((WIDTH + 24) * scale);
  const y = monitor.position.y + monitor.size.height - Math.round((MAX_HEIGHT + 72) * scale);
  await win.setPosition(new PhysicalPosition(x, y));
}

function rememberPosition() {
  let timer: number | undefined;
  void win?.onMoved(({ payload }) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => update((d) => (d.settings.widgetPos = { x: payload.x, y: payload.y })), 600);
  });
}

// ── Start up ─────────────────────────────────────────────────────────────────

function tick() {
  const s = snapshot(getState(), Date.now());
  render(s);
  alerts(s);
}

async function main() {
  await initStore();
  await placeWidget();
  rememberPosition();
  fitWindow();
  unlockAudioOnClick();

  app.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !(e.target as HTMLElement).closest('button, input')) void win?.startDragging();
  });
  app.addEventListener('dblclick', (e) => {
    if (!(e.target as HTMLElement).closest('button, input')) void openPlanner();
  });
  $('open-planner').addEventListener('click', () => void openPlanner());
  $('open-focus').addEventListener('click', () => void openFocus());

  subscribe((state) => {
    if (state.settings.widgetPos === null) void placeWidget();
    tick();
  });

  // The first installed run turns on "start with Windows", even if dev runs already
  // created the state file. Dev builds never register: they'd point at a throwaway exe.
  if (inTauri && import.meta.env.PROD && !getState().settings.autostartConfigured) {
    await enableAutostart().catch(() => {});
    await update((d) => void (d.settings.autostartConfigured = true));
  }
  if (wasFirstRun()) {
    await update(() => {}); // write the first state file
    void openPlanner();
  }

  tick();
  setInterval(tick, 1000);
}

void main();
