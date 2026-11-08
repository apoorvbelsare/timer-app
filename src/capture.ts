import '@fontsource-variable/nunito';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { parkThought } from './actions';
import { getState, inTauri, initStore, subscribe } from './store';
import './styles/capture.css';

/**
 * The parking lot's quick-capture box. Ctrl+Shift+Space opens it from anywhere;
 * type the thought, press Enter, and it gets out of the way so focus isn't lost.
 */

const form = document.getElementById('capture') as HTMLFormElement;
const input = document.getElementById('thought') as HTMLInputElement;
const hint = document.getElementById('hint')!;
const win = inTauri ? getCurrentWindow() : null;
let closing = false;

function showHint() {
  const open = getState().parked.filter((p) => !p.done).length;
  hint.textContent = open ? `${open} parked · Enter to park · Esc to close` : 'Enter to park · Esc to close';
}

async function close() {
  input.value = '';
  form.classList.remove('saved');
  await win?.hide();
}

function open() {
  closing = false;
  input.value = '';
  form.classList.remove('saved');
  showHint();
  input.focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!input.value.trim()) return void close();
  await parkThought(input.value);
  // A brief "got it" so the person trusts it was saved, then out of the way
  closing = true;
  form.classList.add('saved');
  hint.textContent = 'Parked. Back to it.';
  window.setTimeout(() => closing && void close(), 650);
});

document.addEventListener('keydown', (e) => e.key === 'Escape' && void close());

async function main() {
  await initStore();
  subscribe(showHint);
  if (win) {
    await listen('capture-open', open);
    // Clicking anywhere else dismisses it, like a launcher
    await win.onFocusChanged(({ payload: focused }) => !focused && !closing && void close());
  }
  open();
}

void main();
