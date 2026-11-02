// Synthesised sound effects (WebAudio, no files).
let ctx = null, on = true;
export const setSound = v => { on = v; };
function ac() { if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; }
function tone(freq, dur, { type = 'sine', vol = 0.18, at = 0, slide = 0, attack = 0.005 } = {}) {
  const a = on && ac(); if (!a) return;
  const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, { vol = 0.2, at = 0, hp = 800 } = {}) {
  const a = on && ac(); if (!a) return;
  const b = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + at;
  f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol; s.buffer = b;
  s.connect(f).connect(g).connect(a.destination); s.start(t);
}
const RAR = { common: 330, uncommon: 392, rare: 466, epic: 554, legendary: 659 };
export const sfx = {
  move() { tone(220, 0.07, { type: 'triangle', vol: 0.22 }); noise(0.04, { vol: 0.08, hp: 2500 }); },
  capture() { tone(140, 0.16, { type: 'square', vol: 0.12, slide: -80 }); noise(0.12, { vol: 0.2, hp: 600 }); },
  check() { tone(880, 0.09, { type: 'square', vol: 0.09 }); tone(660, 0.12, { type: 'square', vol: 0.09, at: 0.1 }); },
  card(r = 'common') { const f = RAR[r] || 330; noise(0.18, { vol: 0.12, hp: 1500 }); tone(f, 0.18, { type: 'triangle', vol: 0.16, slide: f }); if (r === 'epic' || r === 'legendary') { tone(f * 1.25, 0.5, { vol: 0.1, at: 0.08 }); tone(f * 1.5, 0.6, { vol: 0.1, at: 0.14 }); } if (r === 'legendary') tone(f * 2, 0.8, { vol: 0.08, at: 0.22 }); },
  freeze() { for (let i = 0; i < 4; i++) tone(1400 + i * 260, 0.12, { vol: 0.05, at: i * 0.04 }); },
  shield() { tone(520, 0.22, { type: 'sine', vol: 0.16, slide: 260 }); },
  boom() { tone(90, 0.4, { type: 'sawtooth', vol: 0.14, slide: -50 }); noise(0.35, { vol: 0.25, hp: 200 }); },
  draw() { tone(700, 0.06, { vol: 0.12 }); tone(940, 0.08, { vol: 0.12, at: 0.06 }); },
  ui() { tone(520, 0.04, { type: 'triangle', vol: 0.1 }); },
  bad() { tone(160, 0.12, { type: 'square', vol: 0.08 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, { type: 'triangle', vol: 0.14, at: i * 0.11 })); },
  draw2() { tone(440, 0.3, { vol: 0.1 }); tone(440, 0.3, { vol: 0.1, at: 0.25 }); },
  round() { tone(196, 0.3, { type: 'square', vol: 0.1 }); tone(294, 0.4, { type: 'square', vol: 0.1, at: 0.16 }); },
};
