import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { type AppState, defaultState, normalizeState } from './model';

/**
 * One copy of the state lives in each window. Every write goes to disk through
 * the Rust side and is broadcast so the other windows pick it up.
 *
 * Outside Tauri (plain `npm run dev` in a browser) it falls back to
 * localStorage and a BroadcastChannel, so the UI can be worked on without the shell.
 */
export const inTauri = '__TAURI_INTERNALS__' in window;

const LOCAL_KEY = 'timer-state';
const channel = inTauri ? null : new BroadcastChannel('timer-state');
const source = inTauri ? getCurrentWindow().label : `tab-${Math.random()}`;

let state: AppState = defaultState();
let firstRun = false;
const subscribers = new Set<(s: AppState) => void>();

interface Change {
  source: string;
  state: AppState;
}

function receive(change: Change) {
  if (change.source === source) return;
  state = change.state;
  subscribers.forEach((fn) => fn(state));
}

export async function initStore(): Promise<AppState> {
  const raw = inTauri ? await invoke<string | null>('load_state') : localStorage.getItem(LOCAL_KEY);
  firstRun = raw === null;
  state = raw ? normalizeState(JSON.parse(raw)) : defaultState();
  if (inTauri) await listen<Change>('state-changed', (e) => receive(e.payload));
  else channel!.onmessage = (e: MessageEvent<Change>) => receive(e.data);
  return state;
}

export const getState = () => state;
export const wasFirstRun = () => firstRun;

export function subscribe(fn: (s: AppState) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Apply a change to a copy of the state, then save and broadcast it. */
export async function update(change: (draft: AppState) => void): Promise<void> {
  const draft = structuredClone(state);
  change(draft);
  state = draft;
  subscribers.forEach((fn) => fn(state));

  const json = JSON.stringify(state);
  const message: Change = { source, state };
  if (inTauri) {
    await invoke('save_state', { json });
    await emit('state-changed', message);
  } else {
    localStorage.setItem(LOCAL_KEY, json);
    channel!.postMessage(message);
  }
}
