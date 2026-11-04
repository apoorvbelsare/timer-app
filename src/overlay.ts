import { getCurrentWindow } from '@tauri-apps/api/window';
import { logBlock, snooze } from './actions';
import { h } from './dom';
import { type Snapshot, snapshot } from './engine';
import { formatDuration } from './model';
import { getState, inTauri, initStore, subscribe } from './store';
import './styles/overlay.css';

/**
 * The last step of the hyperfocus guard. The widget shows this window; it hides
 * itself once the review is answered or snoozed, from here or anywhere else.
 */

const card = document.getElementById('card')!;
const win = inTauri ? getCurrentWindow() : null;
let shownKey = '';

async function hide() {
  shownKey = '';
  await win?.hide();
}

function render(s: Snapshot) {
  const p = s.prompt;
  if (!p || p.kind !== 'review') {
    if (shownKey) void hide();
    return;
  }
  const key = `${s.key}:${p.block.id}`;
  if (key === shownKey) return;
  shownKey = key;

  const answer = (fn: () => Promise<void>) => async () => {
    await fn();
    await hide();
  };
  const now = s.current
    ? h('p', {}, 'You’re now in ', h('strong', {}, s.current.name), ` until ${s.current.end}.`)
    : s.next
      ? h('p', {}, 'Next up: ', h('strong', {}, s.next.name), ` at ${s.next.start}.`)
      : h('p', {}, 'That was the last block today.');

  card.replaceChildren(
    h('div', { class: 'dot', style: `background:${p.block.color}` }),
    h('h1', {}, 'Time to switch'),
    h('p', { class: 'lead' }, h('strong', {}, p.block.name), ` ended ${formatDuration(s.now - p.block.endMs)} ago.`),
    now,
    h('h2', {}, `How did ${p.block.name} go?`),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'primary', onClick: answer(() => logBlock(s.key, p.block.id, 'done')) }, 'Done'),
      h('button', { onClick: answer(() => logBlock(s.key, p.block.id, 'partly')) }, 'Partly'),
      h('button', { onClick: answer(() => logBlock(s.key, p.block.id, 'skipped')) }, 'Skipped'),
    ),
    h('button', { class: 'snooze', onClick: answer(() => snooze(s.key, p.block.id)) }, 'I’m still on it — 10 more minutes'),
    h('p', { class: 'hint' }, 'Esc also gives you 10 more minutes'),
  );
  (card.querySelector('button.primary') as HTMLButtonElement | null)?.focus();
}

async function main() {
  await initStore();
  const tick = () => render(snapshot(getState(), Date.now()));
  subscribe(tick);
  document.addEventListener('keydown', (e) => {
    const s = snapshot(getState(), Date.now());
    if (e.key === 'Escape' && s.prompt?.kind === 'review') void snooze(s.key, s.prompt.block.id).then(hide);
  });
  tick();
  setInterval(tick, 1000);
}

void main();
