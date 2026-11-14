// Writes short synthesized WAVs for any `placeholder-*.wav` file referenced by
// public/tracks/tracks.json that doesn't exist yet. No-op once the manifest
// only points at real recordings.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const tracksDir = new URL('../public/tracks/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('tracks.json', tracksDir), 'utf8'));

const SAMPLE_RATE = 16000;
const BEAT = 60 / 84;
const BAR = BEAT * 4;

// C  Am  F  G  C  F  G  C
const CHORDS = [
  [60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62],
  [60, 64, 67], [53, 57, 60], [55, 59, 62], [60, 64, 67],
];
const LAST = CHORDS.length - 1;

function voiceNotes(voice) {
  const notes = [];
  CHORDS.forEach((chord, bar) => {
    const t0 = bar * BAR;
    if (bar === LAST) {
      const midi = { high: chord[2] + 12, mid: chord[1], low: chord[0] - 12 }[voice];
      notes.push({ start: t0, dur: BAR * 1.5, midi });
      return;
    }
    if (voice === 'high') {
      [1, 2, 1, 0].forEach((idx, beat) => notes.push({ start: t0 + beat * BEAT, dur: BEAT, midi: chord[idx] + 12 }));
    } else if (voice === 'mid') {
      notes.push({ start: t0, dur: BEAT * 2, midi: chord[2] });
      notes.push({ start: t0 + BEAT * 2, dur: BEAT * 2, midi: chord[1] });
    } else {
      notes.push({ start: t0, dur: BAR, midi: chord[0] - 12 });
    }
  });
  return notes;
}

const totalSeconds = LAST * BAR + BAR * 1.5 + 0.5;
const totalSamples = Math.ceil(totalSeconds * SAMPLE_RATE);

function render(voice) {
  const out = new Float32Array(totalSamples);
  for (const { start, dur, midi } of voiceNotes(voice)) {
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const s0 = Math.floor(start * SAMPLE_RATE);
    const n = Math.floor(dur * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < n && s0 + i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.05);
      const release = Math.min(1, (dur - t) / 0.12);
      const env = Math.max(0, Math.min(attack, release)) * (0.85 + 0.15 * Math.exp(-t * 3));
      const vibrato = t > 0.25 ? 1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t) : 1;
      phase += (2 * Math.PI * freq * vibrato) / SAMPLE_RATE;
      const tone = Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase);
      out[s0 + i] += 0.32 * env * tone;
    }
  }
  return out;
}

function toWav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return buf;
}

const rendered = {};
const voice = (name) => (rendered[name] ??= render(name));
const generators = {
  'placeholder-high.wav': () => voice('high'),
  'placeholder-mid.wav': () => voice('mid'),
  'placeholder-low.wav': () => voice('low'),
  'placeholder-mix.wav': () => {
    const [h, m, l] = [voice('high'), voice('mid'), voice('low')];
    return h.map((v, i) => 0.7 * (v + m[i] + l[i]));
  },
};

for (const { file } of manifest.tracks ?? []) {
  const make = generators[file];
  const target = new URL(file, tracksDir);
  if (!make || existsSync(target)) continue;
  writeFileSync(target, toWav(make()));
  console.log(`placeholders: wrote public/tracks/${file}`);
}
