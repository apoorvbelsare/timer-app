import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { HourTune } from './hourly';
import { inTauri } from './store';

let granted: boolean | null = null;

export async function notify(title: string, body: string) {
  if (!inTauri) {
    console.info(`[notify] ${title}: ${body}`);
    return;
  }
  if (granted === null) {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
  }
  if (granted) sendNotification({ title, body });
}

let audio: AudioContext | null = null;

/** A soft two-note chime, synthesised so there are no sound files to ship. */
export function chime(kind: 'soft' | 'step' = 'soft') {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume();
  const notes = kind === 'step' ? [659.25] : [523.25, 783.99];
  notes.forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    const t = audio!.currentTime + i * 0.18;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 1.3);
  });
}

/** Plays an hour's tune: music-box notes with a longer last note, about two seconds. */
export function playTune(tune: HourTune, volume: number) {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume();
  const peak = 0.22 * volume * tune.level;
  const spacing = tune.part === 'morning' ? 0.2 : 0.26;
  tune.notes.forEach((freq, i) => {
    const last = i === tune.notes.length - 1;
    const t = audio!.currentTime + 0.05 + i * spacing;
    const length = last ? 1.4 : 0.6;
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = tune.wave;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + length + 0.05);
    // A quiet octave above gives each note a bell-like shimmer
    const shimmer = audio!.createOscillator();
    const shimmerGain = audio!.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.value = freq * 2;
    shimmerGain.gain.setValueAtTime(0, t);
    shimmerGain.gain.linearRampToValueAtTime(peak * 0.25, t + 0.01);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, t + length * 0.6);
    shimmer.connect(shimmerGain).connect(audio!.destination);
    shimmer.start(t);
    shimmer.stop(t + length);
  });
}

/** Browsers keep audio locked until the page has been clicked once. */
export function unlockAudioOnClick() {
  window.addEventListener('pointerdown', () => {
    audio ??= new AudioContext();
    void audio.resume();
  });
}
