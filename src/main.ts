import './style.css';
import { AudioEngine, effectiveGain, type MixState } from './engine';
import { installAudioUnlock, requestPlaybackAudioSession } from './ios';
import { fetchAudio, loadManifest, TrackLoadError, type Manifest } from './manifest';
import { loadMix, saveMix } from './storage';
import { TrackRow, type ScrubHandlers } from './track-row';
import { getPeaks, type LoopRegion } from './waveform';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const ui = {
  title: $('#title'),
  note: $('#note'),
  loading: $('#loading'),
  loadingFill: $('#loading-fill'),
  loadingText: $('#loading-text'),
  list: $<HTMLOListElement>('#tracks'),
  error: $('#error'),
  play: $<HTMLButtonElement>('#play'),
  restart: $<HTMLButtonElement>('#restart'),
  setA: $<HTMLButtonElement>('#set-a'),
  setB: $<HTMLButtonElement>('#set-b'),
  loop: $<HTMLButtonElement>('#loop'),
  loopInfo: $('#loop-info'),
  loopText: $('#loop-text'),
  loopClear: $<HTMLButtonElement>('#loop-clear'),
  time: $('#time'),
  duration: $('#duration'),
};

const hasPlaybackSession = requestPlaybackAudioSession();
const engine = new AudioEngine();
installAudioUnlock(engine.ctx, hasPlaybackSession);

let rows: TrackRow[] = [];
let scrubTime: number | null = null;
let loop: LoopRegion & { set: boolean } = { a: 0, b: 0, enabled: false, set: false };
let dirty = true;
let playheadColor = '';

function formatTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function refreshPlayheadColor(): void {
  playheadColor = getComputedStyle(document.documentElement).getPropertyValue('--playhead').trim() || '#888';
  dirty = true;
}

function applyMix(): void {
  const anySolo = rows.some((r) => r.ready && r.state.soloed);
  for (const row of rows) {
    engine.setGain(row.def.id, effectiveGain(row.state, anySolo));
    row.update(anySolo);
  }
  saveMix(Object.fromEntries(rows.map((r) => [r.def.id, r.state])));
}

function updateTransport(): void {
  const ready = engine.duration > 0;
  ui.play.disabled = ui.restart.disabled = ui.setA.disabled = ui.setB.disabled = !ready;
  ui.loop.disabled = !ready || !loop.set;
  ui.play.classList.toggle('is-playing', engine.playing);
  ui.play.setAttribute('aria-label', engine.playing ? 'Pause' : 'Play');
  ui.loop.setAttribute('aria-pressed', String(loop.enabled));
  ui.loopInfo.hidden = !loop.set;
  ui.loopText.textContent = `Loop ${formatTime(loop.a)} – ${formatTime(loop.b)}${loop.enabled ? '' : ' (off)'}`;
  ui.duration.textContent = formatTime(engine.duration);
  dirty = true;
}

function setLoopPoint(which: 'a' | 'b'): void {
  const pos = engine.position;
  if (!loop.set) loop = { a: 0, b: engine.duration, enabled: false, set: true };
  loop[which] = pos;
  if (loop.b < loop.a) [loop.a, loop.b] = [loop.b, loop.a];
  if (loop.b - loop.a < 0.25) loop.b = Math.min(engine.duration, loop.a + 0.25);
  engine.setLoop(loop.a, loop.b, loop.enabled);
  updateTransport();
}

function toggleLoop(): void {
  if (!loop.set) return;
  loop.enabled = !loop.enabled;
  engine.setLoop(loop.a, loop.b, loop.enabled);
  const pos = engine.position;
  if (loop.enabled && (pos < loop.a || pos >= loop.b)) engine.seek(loop.a);
  updateTransport();
}

function clearLoop(): void {
  loop = { a: 0, b: 0, enabled: false, set: false };
  engine.setLoop(0, 0, false);
  updateTransport();
}

function restart(): void {
  engine.seek(loop.enabled ? loop.a : 0);
  dirty = true;
}

const scrub: ScrubHandlers = {
  move(f) {
    if (!engine.duration) return;
    scrubTime = f * engine.duration;
    document.documentElement.classList.add('is-scrubbing');
  },
  commit(f) {
    document.documentElement.classList.remove('is-scrubbing');
    scrubTime = null;
    if (engine.duration) engine.seek(f * engine.duration);
    dirty = true;
  },
  cancel() {
    document.documentElement.classList.remove('is-scrubbing');
    scrubTime = null;
    dirty = true;
  },
};

let lastDrawn = -1;
function frame(): void {
  engine.tick();
  const pos = scrubTime ?? engine.position;
  if (dirty || pos !== lastDrawn) {
    const region = loop.set ? loop : null;
    for (const row of rows) row.wave.render(pos, region, playheadColor);
    ui.time.textContent = formatTime(pos);
    lastDrawn = pos;
    dirty = false;
  }
  requestAnimationFrame(frame);
}

function resizeWaves(): void {
  for (const row of rows) row.wave.resize();
  dirty = true;
}

async function loadTrack(row: TrackRow, onProgress: (f: number) => void): Promise<void> {
  try {
    const data = await fetchAudio(row.def.url, (f) => {
      row.setProgress(f, 'download');
      onProgress((f ?? 0) * 0.8);
    });
    row.setProgress(1, 'decode');
    onProgress(0.85);
    let buffer: AudioBuffer;
    try {
      buffer = await engine.ctx.decodeAudioData(data);
    } catch {
      throw new TrackLoadError("Couldn't decode audio");
    }
    engine.setBuffer(row.def.id, buffer);
    row.wave.setData(getPeaks(row.def.url, buffer), buffer.duration);
    row.setReady();
    for (const r of rows) r.wave.setTimeline(engine.duration);
  } catch (err) {
    row.setError(err instanceof TrackLoadError ? err.message : 'Failed to load');
  } finally {
    onProgress(1);
    applyMix();
    updateTransport();
    resizeWaves();
  }
}

function showError(message: string): void {
  ui.error.textContent = message;
  ui.error.hidden = false;
}

async function init(): Promise<void> {
  refreshPlayheadColor();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshPlayheadColor);

  ui.play.addEventListener('click', () => engine.toggle());
  ui.restart.addEventListener('click', restart);
  ui.setA.addEventListener('click', () => setLoopPoint('a'));
  ui.setB.addEventListener('click', () => setLoopPoint('b'));
  ui.loop.addEventListener('click', toggleLoop);
  ui.loopClear.addEventListener('click', clearLoop);
  engine.onStateChange = updateTransport;

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) engine.toggle();
    } else if (e.code === 'Home') {
      e.preventDefault();
      restart();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      if ((e.target as HTMLElement).matches?.('input')) return;
      e.preventDefault();
      engine.seek(engine.position + (e.code === 'ArrowLeft' ? -5 : 5));
      dirty = true;
    }
  });
  // Stop Space from also "clicking" whichever button has focus.
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') e.preventDefault();
  });

  updateTransport();
  requestAnimationFrame(frame);

  let manifest: Manifest;
  try {
    manifest = await loadManifest();
  } catch (err) {
    ui.loading.hidden = true;
    showError(err instanceof Error ? err.message : String(err));
    return;
  }

  document.title = manifest.title;
  ui.title.textContent = manifest.title;
  ui.note.textContent = manifest.note ?? '';
  ui.note.hidden = !manifest.note;

  if (!manifest.tracks.length) {
    ui.loading.hidden = true;
    showError('No tracks listed in tracks.json yet.');
    return;
  }

  const saved = loadMix();
  rows = manifest.tracks.map((def) => {
    engine.addTrack(def.id);
    const s = saved[def.id];
    const state: MixState = {
      volume: typeof s?.volume === 'number' ? s.volume : 1,
      muted: s?.muted === true,
      soloed: s?.soloed === true,
    };
    return new TrackRow(def, state, applyMix, scrub);
  });
  ui.list.append(...rows.map((r) => r.el));
  applyMix();

  new ResizeObserver(resizeWaves).observe(ui.list);
  resizeWaves();

  const progress = rows.map(() => 0);
  const report = () => {
    const total = progress.reduce((a, b) => a + b, 0) / progress.length;
    ui.loadingFill.style.setProperty('--progress', String(total));
    const done = progress.filter((p) => p >= 1).length;
    ui.loadingText.textContent = `Loading tracks… ${done}/${rows.length}`;
  };
  report();
  await Promise.all(
    rows.map((row, i) =>
      loadTrack(row, (f) => {
        progress[i] = f;
        report();
      }),
    ),
  );
  ui.loading.hidden = true;
  if (!engine.duration) showError("None of the tracks could be loaded. Check the files in public/tracks/.");
}

void init();
