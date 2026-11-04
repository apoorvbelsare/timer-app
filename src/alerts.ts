import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
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

/** Browsers keep audio locked until the page has been clicked once. */
export function unlockAudioOnClick() {
  window.addEventListener('pointerdown', () => {
    audio ??= new AudioContext();
    void audio.resume();
  });
}
