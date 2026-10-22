// Tiny WebAudio synth so the game needs no asset files.
let ctx = null, master = null, noiseBuf = null;
export let muted = false;
export function setMuted(v) { muted = v; if (master) master.gain.value = v ? 0 : 0.5; }

export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}

function tone(freq, freq2, dur, type = 'sine', vol = 0.3) {
  if (!ctx) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur);
}
function noise(dur, freq, vol = 0.3, q = 1, type = 'bandpass') {
  if (!ctx) return;
  const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur);
}

export const sfx = {
  jump: () => tone(300, 600, 0.12, 'triangle', 0.15),
  jump2: () => tone(420, 820, 0.12, 'triangle', 0.13),
  land: () => noise(0.08, 300, 0.12),
  swing: heavy => noise(heavy ? 0.22 : 0.12, heavy ? 900 : 1800, heavy ? 0.22 : 0.14, 2),
  hit: dmg => { const s = Math.min(1, dmg / 16); noise(0.12 + s * 0.15, 600 - s * 300, 0.35 + s * 0.3, 0.8); tone(180 - s * 80, 50, 0.15 + s * 0.15, 'square', 0.18 + s * 0.12); },
  ko: () => { noise(0.9, 200, 0.6, 0.5, 'lowpass'); tone(120, 30, 0.8, 'sawtooth', 0.3); },
  dodge: () => noise(0.15, 3000, 0.1, 3, 'highpass'),
  pickup: () => { tone(600, 900, 0.08, 'square', 0.1); setTimeout(() => tone(900, 1300, 0.1, 'square', 0.1), 70); },
  throw: () => noise(0.18, 1200, 0.18, 1.5),
  shot: () => { tone(900, 200, 0.12, 'square', 0.12); noise(0.06, 2500, 0.12); },
  pound: () => { noise(0.3, 150, 0.5, 0.7, 'lowpass'); tone(90, 40, 0.25, 'sine', 0.35); },
  spawn: () => tone(300, 1200, 0.35, 'sine', 0.15),
  beep: () => tone(660, 660, 0.15, 'square', 0.15),
  go: () => { tone(880, 880, 0.35, 'square', 0.18); tone(440, 440, 0.35, 'square', 0.12); },
  game: () => { tone(523, 523, 0.2, 'square', 0.15); setTimeout(() => tone(659, 659, 0.2, 'square', 0.15), 180); setTimeout(() => tone(784, 784, 0.5, 'square', 0.15), 360); },
  click: () => tone(500, 700, 0.05, 'triangle', 0.1),
};
