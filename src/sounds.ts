import type { Ambient } from './model';

/**
 * Ambient soundscapes, synthesised in the browser so the app ships no audio files.
 * Each builder wires its nodes into `out` and returns a function that stops it.
 */

type Builder = (ac: AudioContext, out: AudioNode) => () => void;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let stopCurrent: (() => void) | null = null;
let playing: Ambient = 'off';

const buffers = new Map<string, AudioBuffer>();

function noise(ac: AudioContext, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
  const cached = buffers.get(kind);
  if (cached) return cached;
  const length = ac.sampleRate * 8;
  const buffer = ac.createBuffer(2, length, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'white') {
        data[i] = white;
      } else if (kind === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        // Paul Kellet's pink-noise filter
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
  }
  buffers.set(kind, buffer);
  return buffer;
}

function loop(ac: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start();
  return src;
}

function filter(ac: AudioContext, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

function gain(ac: AudioContext, value: number): GainNode {
  const g = ac.createGain();
  g.gain.value = value;
  return g;
}

const brown: Builder = (ac, out) => {
  const src = loop(ac, noise(ac, 'brown'));
  src.connect(filter(ac, 'lowpass', 900)).connect(gain(ac, 0.8)).connect(out);
  return () => src.stop();
};

const rain: Builder = (ac, out) => {
  // A steady wash, plus scattered drops on top
  const wash = loop(ac, noise(ac, 'pink'));
  wash.connect(filter(ac, 'highpass', 500)).connect(filter(ac, 'lowpass', 7000)).connect(gain(ac, 0.55)).connect(out);

  const white = noise(ac, 'white');
  const drops = window.setInterval(() => {
    const count = Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const t = ac.currentTime + Math.random() * 0.08;
      const src = ac.createBufferSource();
      src.buffer = white;
      const env = gain(ac, 0);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.04 + Math.random() * 0.08, t + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      src.connect(filter(ac, 'bandpass', 1800 + Math.random() * 4000, 2.5)).connect(env).connect(out);
      src.start(t, Math.random() * 6, 0.04);
    }
  }, 80);

  return () => {
    clearInterval(drops);
    wash.stop();
  };
};

const forest: Builder = (ac, out) => {
  // Wind that swells and settles, with the occasional bird
  const wind = loop(ac, noise(ac, 'brown'));
  const swell = gain(ac, 0.45);
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.07;
  lfo.connect(gain(ac, 0.25)).connect(swell.gain);
  lfo.start();
  wind.connect(filter(ac, 'lowpass', 420)).connect(swell).connect(out);

  let timer = 0;
  const call = () => {
    const pan = ac.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(out);
    const base = 2400 + Math.random() * 1400;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const t = ac.currentTime + i * (0.14 + Math.random() * 0.06);
      const osc = ac.createOscillator();
      const env = gain(ac, 0);
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.linearRampToValueAtTime(base * 1.35, t + 0.05);
      osc.frequency.linearRampToValueAtTime(base * 1.1, t + 0.1);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.035, t + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(env).connect(pan);
      osc.start(t);
      osc.stop(t + 0.12);
    }
    timer = window.setTimeout(call, 2500 + Math.random() * 6500);
  };
  timer = window.setTimeout(call, 1500);

  return () => {
    clearTimeout(timer);
    lfo.stop();
    wind.stop();
  };
};

const BUILDERS: Record<Exclude<Ambient, 'off'>, Builder> = { rain, forest, brown };

export const AMBIENT_LABELS: Record<Ambient, string> = {
  off: 'Silence',
  rain: 'Rain',
  forest: 'Forest',
  brown: 'Brown noise',
};

export function playAmbient(kind: Ambient, volume: number) {
  if (kind === playing) return setAmbientVolume(volume);
  stopAmbient();
  if (kind === 'off') return;
  ctx ??= new AudioContext();
  void ctx.resume();
  master = gain(ctx, 0);
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(volume * 0.6, ctx.currentTime + 1.5);
  stopCurrent = BUILDERS[kind](ctx, master);
  playing = kind;
}

export function setAmbientVolume(volume: number) {
  if (ctx && master) master.gain.setTargetAtTime(volume * 0.6, ctx.currentTime, 0.1);
}

/** Fades out rather than cutting off. */
export function stopAmbient() {
  if (!ctx || !master || !stopCurrent) return;
  const [node, stop] = [master, stopCurrent];
  node.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
  window.setTimeout(() => {
    stop();
    node.disconnect();
  }, 700);
  master = null;
  stopCurrent = null;
  playing = 'off';
}
