// audio.js — sound effects synthesised with the Web Audio API (no audio files),
// German text-to-speech (Web Speech API) and haptic feedback.
let ctx = null, master = null;
const prefs = { sound: true, haptics: true, tts: true };
export function setAudioPrefs(p) { Object.assign(prefs, p); }

function ac() {
  if (!prefs.sound) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
/** must be called from a user gesture once (mobile browsers start the audio context suspended) */
export function unlockAudio() { ac(); }

function tone({ f = 440, to = null, type = 'sine', dur = 0.15, vol = 0.3, at = 0, attack = 0.005 }) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise({ dur = 0.2, vol = 0.3, at = 0, freq = 1200, q = 0.8, type = 'bandpass', to = null }) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(freq, t0); flt.Q.value = q;
  if (to) flt.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt); flt.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

export const sfx = {
  click() { tone({ f: 520, type: 'triangle', dur: 0.05, vol: 0.12 }); },
  tile() { noise({ dur: 0.05, vol: 0.18, freq: 2600, q: 2 }); tone({ f: 700, type: 'triangle', dur: 0.04, vol: 0.08 }); },
  untile() { tone({ f: 380, type: 'triangle', dur: 0.05, vol: 0.08 }); },
  hit() { noise({ dur: 0.12, vol: 0.35, freq: 900, to: 300 }); tone({ f: 660, to: 880, type: 'square', dur: 0.09, vol: 0.12 }); },
  crit() {
    noise({ dur: 0.28, vol: 0.5, freq: 1800, to: 200, q: 0.5 });
    tone({ f: 523, type: 'square', dur: 0.09, vol: 0.14 }); tone({ f: 784, type: 'square', dur: 0.09, vol: 0.14, at: 0.07 });
    tone({ f: 1047, type: 'square', dur: 0.2, vol: 0.16, at: 0.14 }); tone({ f: 90, to: 40, type: 'sine', dur: 0.3, vol: 0.5 });
  },
  wrong() { tone({ f: 220, to: 110, type: 'sawtooth', dur: 0.3, vol: 0.2 }); tone({ f: 233, to: 116, type: 'sawtooth', dur: 0.3, vol: 0.15 }); },
  bossHit() { tone({ f: 120, to: 35, type: 'sine', dur: 0.45, vol: 0.7 }); noise({ dur: 0.35, vol: 0.4, freq: 300, to: 80, type: 'lowpass' }); },
  heal() { [523, 659, 784, 1047].forEach((f, i) => tone({ f, type: 'sine', dur: 0.14, vol: 0.16, at: i * 0.06 })); },
  tick() { tone({ f: 1000, type: 'square', dur: 0.03, vol: 0.06 }); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone({ f, type: 'square', dur: 0.16, vol: 0.14, at: i * 0.11 }));
    tone({ f: 262, type: 'triangle', dur: 0.9, vol: 0.2, at: 0.1 }); noise({ dur: 0.6, vol: 0.2, freq: 5000, q: 0.3, at: 0.7 }); },
  lose() { [392, 349, 311, 262, 196].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.26, vol: 0.2, at: i * 0.2 })); },
  levelup() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, type: 'triangle', dur: 0.2, vol: 0.2, at: i * 0.08 })); },
  badge() { tone({ f: 880, type: 'sine', dur: 0.25, vol: 0.2 }); tone({ f: 1320, type: 'sine', dur: 0.4, vol: 0.2, at: 0.12 }); },
  erase() { noise({ dur: 0.9, vol: 0.3, freq: 3000, to: 600, q: 0.4 }); }
};

export function vibrate(pattern) {
  if (!prefs.haptics || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (e) { /* not allowed */ }
}

let germanVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  germanVoice = voices.find(v => /^de[-_]DE/i.test(v.lang) && v.localService) || voices.find(v => /^de[-_]DE/i.test(v.lang)) || voices.find(v => /^de/i.test(v.lang)) || null;
  return germanVoice;
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}
export const ttsAvailable = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
/** Speak German text. `force` ignores the TTS setting (used by the speaker buttons). */
export function speak(text, { force = false, rate = 0.92 } = {}) {
  if ((!prefs.tts && !force) || !ttsAvailable() || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\b(jdm|jdn|jmdn)\b\.?/gi, 'jemand').replace(/\betw\b\.?/gi, 'etwas').replace(/[…_]/g, ' '));
    u.lang = 'de-DE'; u.rate = rate;
    const v = germanVoice || pickVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) { /* speech not available */ }
}
