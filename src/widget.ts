import '@fontsource-variable/fraunces';
import '@fontsource-variable/nunito';
import { enable as enableAutostart } from '@tauri-apps/plugin-autostart';
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { emit, listen } from '@tauri-apps/api/event';
import { Window, currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { dismissIntention, logBlock, setIntention, skipToday, snooze, startBlock } from './actions';
import { chime, notify, playTune, unlockAudioOnClick } from './alerts';
import { h } from './dom';
import { type Snapshot, dayRecord, escalation, snapshot } from './engine';
import { type Garden, garden, growthNews } from './garden';
import { hourLabel, hourTune, inQuietHours } from './hourly';
import type { FocusMode } from './focus';
import { formatDuration, minuteOfDay } from './model';
import { CIRCUMFERENCE, ringColor, ringRemaining, ringText } from './ring';
import { getState, inTauri, initStore, subscribe, update, wasFirstRun } from './store';
import './styles/widget.css';

const WIDTH = 320;
/** Tallest the widget gets: with the intention or review card open */
const MAX_HEIGHT = 260;
/** The docked bar: wide enough for everything the card shows, on one line */
const DOCK_WIDTH = 800;

const $ = (id: string) => document.getElementById(id)!;
const app = $('app');
const arc = $('arc') as unknown as SVGCircleElement;
const promptEl = $('prompt');
const extrasEl = $('extras');

const win = inTauri ? getCurrentWindow() : null;

async function openPlanner(view?: 'garden' | 'parking') {
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
  // The whole card takes on the block's colour, so the zone you're in reads at a glance
  app.classList.toggle('zoned', !!s.current);
  if (s.current) app.style.setProperty('--zone', s.current.color);

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
    // A running step wins; otherwise remind them what they meant to do
    const intention = dayRecord(state, s.key).intentions[s.current.id]?.text;
    const step = s.step
      ? `${s.step.step.name} · ${formatDuration(s.step.remainingMs)} (${s.step.index + 1}/${s.current.steps.length})`
      : intention
        ? `→ ${intention}`
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
 * A passing note under the strip for a few seconds: the garden growing, or the
 * hour changing. Tapping it opens the matching page.
 */
interface Flash {
  icon: string;
  text: string;
  until: number;
  open?: 'garden';
}
let flash: Flash | null = null;
const showFlash = (f: Omit<Flash, 'until'>) => (flash = { ...f, until: Date.now() + 8000 });
let lastGarden: Garden | null = null;

function watchGarden() {
  const now = garden(getState());
  const news = lastGarden && growthNews(lastGarden, now);
  if (news) {
    showFlash({ icon: '🌱', text: news, open: 'garden' });
    if (now.grownCount > lastGarden!.grownCount) notify('Your garden grew', news);
  }
  lastGarden = now;
}

/**
 * One line under the strip, most important first: garden news, then in free
 * time a recharge break and any parked thoughts waiting for attention.
 */
let extrasKey = '';
function renderExtras(s: Snapshot) {
  if (flash && Date.now() > flash.until) flash = null;
  const parked = getState().parked.filter((p) => !p.done).length;
  const free = !s.current && !!s.next && s.remainingMs > 3 * 60_000;
  const kind = s.prompt ? '' : flash ? `news:${flash.text}` : free ? `free:${parked}` : !s.current && parked ? `parked:${parked}` : '';
  if (kind === extrasKey) return;
  extrasKey = kind;
  extrasEl.hidden = !kind;
  const parkedChip = parked > 0 && h('button', { class: 'chip', title: 'Thoughts you parked', onClick: () => openPlanner('parking') }, `Parked · ${parked}`);
  const content = kind.startsWith('news')
    ? [h('button', { class: 'news', onClick: () => flash?.open && openPlanner(flash.open) }, h('span', { 'aria-hidden': 'true' }, flash!.icon), flash!.text)]
    : kind.startsWith('free')
      ? [
          h('span', {}, 'Recharge'),
          h('button', { class: 'chip', onClick: () => openFocus('breathe') }, 'Breathe'),
          h('button', { class: 'chip', onClick: () => openFocus('stretch') }, 'Stretch'),
          parkedChip,
        ]
      : kind
        ? [h('span', {}, 'Later'), parkedChip]
        : [];
  extrasEl.replaceChildren(...content.filter((c): c is HTMLElement => !!c));
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

// ── Window placement ─────────────────────────────────────────────────────────

let mode: 'float' | 'dock' = 'float';
let fitted = '';
let placedDockX: number | null = null;
/** Our own moves fire onMoved too; those mustn't count as the person dragging */
let placingUntil = 0;

async function moveTo(x: number, y: number) {
  placingUntil = Date.now() + 500;
  await win?.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
}

interface Taskbar {
  top: number;
  bottom: number;
  left: number;
  width: number;
  scale: number;
}

/** The strip below the work area, in physical pixels. */
async function taskbar(): Promise<Taskbar | null> {
  const monitor = await currentMonitor();
  if (!monitor) return null;
  const scale = monitor.scaleFactor;
  const bottom = monitor.position.y + monitor.size.height;
  const workBottom = monitor.workArea.position.y + monitor.workArea.size.height;
  // An auto-hiding or side taskbar leaves no strip at the bottom: borrow the usual 48px
  const top = workBottom < bottom ? workBottom : bottom - Math.round(48 * scale);
  return { top, bottom, left: monitor.position.x, width: monitor.size.width, scale };
}

/**
 * The window follows the card's height, so the widget never clips or leaves a gap.
 * Docked, the bar fills the taskbar's height and any prompt card grows upward from it.
 */
async function fitWindow() {
  if (!win) return;
  if (mode === 'float') {
    const height = Math.min(MAX_HEIGHT, Math.ceil(app.getBoundingClientRect().height) + 8);
    if (fitted === `float:${height}`) return;
    fitted = `float:${height}`;
    return win.setSize(new LogicalSize(WIDTH, height));
  }
  const tb = await taskbar();
  if (!tb) return;
  app.style.setProperty('--bar-h', `${(tb.bottom - tb.top) / tb.scale}px`);
  const height = Math.ceil(app.getBoundingClientRect().height);
  const dockX = getState().settings.dockX;
  const key = `dock:${height}:${dockX}:${tb.top}`;
  if (fitted === key) return;
  fitted = key;
  placedDockX = dockX;
  const width = Math.round(DOCK_WIDTH * tb.scale);
  const x = Math.min(Math.max(dockX ?? tb.left + (tb.width - width) / 2, tb.left), tb.left + tb.width - width);
  const y = tb.bottom - Math.round(height * tb.scale);
  // Growing: move up first, so the window never hangs below the screen for a frame
  await moveTo(x, y);
  await win.setSize(new LogicalSize(DOCK_WIDTH, height));
}

async function placeWidget() {
  if (!win) return;
  if (mode === 'dock') return fitWindow();
  const saved = getState().settings.widgetPos;
  if (saved) return moveTo(saved.x, saved.y);
  // Bottom-right, with room above the taskbar for the tallest card
  const monitor = await currentMonitor();
  if (!monitor) return;
  const scale = monitor.scaleFactor;
  const x = monitor.position.x + monitor.size.width - Math.round((WIDTH + 24) * scale);
  const y = monitor.position.y + monitor.size.height - Math.round((MAX_HEIGHT + 72) * scale);
  await moveTo(x, y);
}

/** Switch between the floating card and the taskbar bar to match settings. */
async function applyMode() {
  mode = getState().settings.widgetMode;
  fitted = '';
  app.classList.toggle('docked', mode === 'dock');
  const toggle = $('toggle-dock');
  toggle.title = toggle.ariaLabel = mode === 'dock' ? 'Float the widget' : 'Dock to taskbar';
  if (inTauri) void invoke('set_docked', { docked: mode === 'dock' }).catch(() => {});
  await fitWindow();
  await placeWidget();
}

const setMode = (next: 'float' | 'dock') => update((d) => void (d.settings.widgetMode = next));

/**
 * Where a drag ends decides the mode: pull the bar up off the taskbar and it
 * floats; drop the card onto the taskbar and it docks. Anything else stays put.
 */
async function settle(x: number, y: number) {
  if (!win) return;
  const tb = await taskbar();
  const size = await win.outerSize();
  const bottom = y + size.height;
  if (!tb) return update((d) => void (d.settings.widgetPos = { x, y }));
  const offset = Math.round(((DOCK_WIDTH - WIDTH) / 2) * tb.scale);
  if (mode === 'dock') {
    if (bottom < tb.top) {
      return update((d) => {
        d.settings.widgetMode = 'float';
        d.settings.widgetPos = { x: x + offset, y: bottom - Math.round(140 * tb.scale) };
      });
    }
    // Slid along the taskbar: keep the new spot and snap back down onto it
    fitted = '';
    await update((d) => void (d.settings.dockX = x));
    return fitWindow();
  }
  if (bottom > tb.top + Math.round(12 * tb.scale)) {
    return update((d) => {
      d.settings.widgetMode = 'dock';
      d.settings.dockX = x - offset;
    });
  }
  await update((d) => void (d.settings.widgetPos = { x, y }));
}

function rememberPosition() {
  let timer: number | undefined;
  void win?.onMoved(({ payload }) => {
    if (Date.now() < placingUntil) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void settle(payload.x, payload.y), 500);
  });
}

// ── Alerts ───────────────────────────────────────────────────────────────────

const fired = new Set<string>();
let booted = false;
let lastCurrent = '';
let lastStep = '';
let overlayShownFor = '';

/** When the last chime played, so the hourly tune never lands on top of one. */
let lastSoundAt = 0;

/** The hourly ping: a tune of its own for every hour, a pulse, and a line of context. */
function ringHour(hour: number) {
  const { settings } = getState();
  playTune(hourTune(hour), settings.pingVolume);
  lastSoundAt = Date.now();
  app.classList.add('hour-pulse');
  window.setTimeout(() => app.classList.remove('hour-pulse'), 2400);
  const s = snapshot(getState(), Date.now());
  const label = hourLabel(hour);
  const context =
    s.current && !s.awaitingStart
      ? ` · ${formatDuration(s.remainingMs)} left in ${s.current.name}`
      : s.next
        ? ` · ${s.next.name} at ${s.next.start}`
        : '';
  showFlash({ icon: '🕰️', text: `${label[0].toUpperCase()}${label.slice(1)}${context}` });
  render(s);
}

function alerts(s: Snapshot) {
  const state = getState();
  const { settings } = state;
  const sound = () => {
    if (!settings.chime) return;
    chime();
    lastSoundAt = Date.now();
  };
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
  if (booted && stepKey && stepKey !== lastStep && s.step!.index > 0 && settings.chime) {
    chime('step');
    lastSoundAt = Date.now();
  }
  lastStep = stepKey;

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

  // Once in the first two minutes of each hour, never in quiet hours, and a few
  // seconds after any chime that just played so the sounds don't pile up
  const date = new Date(s.now);
  const hourKey = `${s.key}:hour:${date.getHours()}`;
  if (booted && settings.hourlyPing && date.getMinutes() < 2 && !fired.has(hourKey) && !inQuietHours(date, settings.quietStart, settings.quietEnd)) {
    fired.add(hourKey);
    window.setTimeout(() => ringHour(date.getHours()), Math.max(0, lastSoundAt + 3500 - Date.now()));
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

// ── Start up ─────────────────────────────────────────────────────────────────

function tick() {
  const s = snapshot(getState(), Date.now());
  render(s);
  alerts(s);
}

async function main() {
  await initStore();
  await applyMode();
  rememberPosition();
  new ResizeObserver(() => void fitWindow()).observe(app);
  unlockAudioOnClick();

  app.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !(e.target as HTMLElement).closest('button, input')) void win?.startDragging();
  });
  app.addEventListener('dblclick', (e) => {
    if (!(e.target as HTMLElement).closest('button, input')) void openPlanner();
  });
  $('open-planner').addEventListener('click', () => void openPlanner());
  $('open-focus').addEventListener('click', () => void openFocus());
  $('toggle-dock').addEventListener('click', () => void setMode(mode === 'dock' ? 'float' : 'dock'));
  if (inTauri) void listen('toggle-dock', () => void setMode(mode === 'dock' ? 'float' : 'dock'));

  watchGarden();
  subscribe((state) => {
    watchGarden();
    const { widgetMode, widgetPos, dockX } = state.settings;
    if (widgetMode !== mode) void applyMode();
    else if (mode === 'float' && widgetPos === null) void placeWidget();
    else if (mode === 'dock' && dockX !== placedDockX) void fitWindow();
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
