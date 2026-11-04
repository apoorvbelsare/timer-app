export type BlockStatus = 'done' | 'partly' | 'skipped';

export interface Step {
  id: string;
  name: string;
  minutes: number;
}

export interface Block {
  id: string;
  name: string;
  color: string;
  /** "HH:MM", local time */
  start: string;
  end: string;
  /** Weekdays the block runs on, 0 = Sunday … 6 = Saturday */
  days: number[];
  /** Optional blocks ask "start or skip?" instead of starting on their own */
  optional: boolean;
  steps: Step[];
}

/** Changes that apply to one date only; the routine itself stays untouched. */
export interface DayOverride {
  skip: string[];
  times: Record<string, { start: string; end: string }>;
  extra: Block[];
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

/** What the person means to do in a block: the "before" of the session ritual. */
export interface Intention {
  text: string;
  todos: Todo[];
  /** Skipped the question; don't ask again for this block today */
  dismissed: boolean;
}

export interface DayRecord {
  override: DayOverride;
  /** When an optional block was actually started */
  startedAt: Record<string, number>;
  log: Record<string, BlockStatus>;
  /** "Still on it": hold the hyperfocus escalation until this time */
  snoozedUntil: Record<string, number>;
  intentions: Record<string, Intention>;
  /** One line on how a block went: the "after" of the ritual */
  notes: Record<string, string>;
}

export type Ambient = 'off' | 'rain' | 'forest' | 'brown';

export interface Settings {
  warnMinutes: number[];
  chime: boolean;
  /** Minutes after a block ends before a toast; twice this before the overlay */
  escalateAfterMin: number;
  widgetPos: { x: number; y: number } | null;
  /** Ask for an intention when a block starts */
  askIntention: boolean;
  ambient: Ambient;
  ambientVolume: number;
}

export interface AppState {
  version: 1;
  routine: Block[];
  settings: Settings;
  days: Record<string, DayRecord>;
}

/** Earthy tones: sage, clay, ochre, dusk, heather, lake, rose, moss */
export const PALETTE = ['#7fa88b', '#d08a5f', '#e2b25c', '#8f9fd1', '#b08cc0', '#6fb3b8', '#d9879a', '#a3b86c'];

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const SNOOZE_MS = 10 * 60_000;

export function defaultSettings(): Settings {
  return {
    warnMinutes: [10, 5, 1],
    chime: true,
    escalateAfterMin: 5,
    widgetPos: null,
    askIntention: true,
    ambient: 'off',
    ambientVolume: 0.5,
  };
}

export function defaultState(): AppState {
  return { version: 1, routine: [], settings: defaultSettings(), days: {} };
}

export function emptyDay(): DayRecord {
  return {
    override: { skip: [], times: {}, extra: [] },
    startedAt: {},
    log: {},
    snoozedUntil: {},
    intentions: {},
    notes: {},
  };
}

/** Fills in anything an older or hand-edited state file is missing. */
export function normalizeState(raw: Partial<AppState>): AppState {
  const days: Record<string, DayRecord> = {};
  for (const [key, rec] of Object.entries(raw.days ?? {})) {
    const empty = emptyDay();
    days[key] = { ...empty, ...rec, override: { ...empty.override, ...rec?.override } };
  }
  return {
    version: 1,
    routine: raw.routine ?? [],
    settings: { ...defaultSettings(), ...raw.settings },
    days,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number): string {
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Epoch ms for a minute of the day on the given date, in local time. */
export function atMinutes(date: Date, minutes: number): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minutes).getTime();
}

export function minuteOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "1h 12m", "12m", "45s": rounded up, so "1m" never means "already over". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.ceil(ms / 1000))}s`;
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function daysLabel(days: number[]): string {
  const set = [...days].sort().join(',');
  if (set === '0,1,2,3,4,5,6') return 'Every day';
  if (set === '1,2,3,4,5') return 'Weekdays';
  if (set === '0,6') return 'Weekends';
  return [...days].sort().map((d) => DAY_NAMES[d]).join(' ');
}

export function newId(): string {
  return crypto.randomUUID();
}

export function sampleRoutine(): Block[] {
  const everyDay = [0, 1, 2, 3, 4, 5, 6];
  const weekdays = [1, 2, 3, 4, 5];
  const block = (
    name: string,
    start: string,
    end: string,
    color: string,
    days: number[],
    optional = false,
    steps: [string, number][] = [],
  ): Block => ({
    id: newId(),
    name,
    color,
    start,
    end,
    days,
    optional,
    steps: steps.map(([stepName, minutes]) => ({ id: newId(), name: stepName, minutes })),
  });
  return [
    block('Morning routine', '07:00', '07:45', PALETTE[0], everyDay, false, [
      ['Water & meds', 5],
      ['Shower', 15],
      ['Get dressed', 10],
      ['Breakfast', 15],
    ]),
    block('Deep work', '09:00', '12:00', PALETTE[3], weekdays, false, [
      ['Focus', 50],
      ['Break', 10],
      ['Focus', 50],
      ['Break', 10],
      ['Focus', 60],
    ]),
    block('Lunch', '13:00', '13:45', PALETTE[1], everyDay),
    block('Study', '20:00', '21:00', PALETTE[4], everyDay, true),
    block('Wind down', '22:30', '23:00', PALETTE[5], everyDay, false, [
      ['Tidy up', 10],
      ['Plan tomorrow', 5],
      ['Screens off', 15],
    ]),
  ];
}
