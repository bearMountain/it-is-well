export interface MixState {
  volume: number;
  muted: boolean;
  soloed: boolean;
}

export function isAudible(track: MixState, anySolo: boolean): boolean {
  return !track.muted && (!anySolo || track.soloed);
}

/** Slider value (0..1) to linear gain, squared for a more natural-feeling fader. */
export function effectiveGain(track: MixState, anySolo: boolean): number {
  if (!isAudible(track, anySolo)) return 0;
  const v = Math.min(1, Math.max(0, track.volume));
  return v * v;
}

interface EngineTrack {
  gain: GainNode;
  buffer: AudioBuffer | null;
}

interface PendingLoop {
  at: number;
  offset: number;
  sources: AudioBufferSourceNode[];
}

const START_DELAY = 0.04;
const LOOP_LOOKAHEAD = 0.3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Every track plays from its own AudioBufferSourceNode, but all sources for a
 * play/seek/loop are started with the same AudioContext timestamp, so they are
 * sample-locked to one clock.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  duration = 0;
  onStateChange: (() => void) | null = null;

  private readonly output: AudioNode;
  private readonly tracks = new Map<string, EngineTrack>();
  private sources: AudioBufferSourceNode[] = [];
  private pending: PendingLoop | null = null;
  private startCtxTime = 0;
  private startOffset = 0;
  private _playing = false;
  private loop = { a: 0, b: 0, enabled: false };

  constructor() {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'playback' });

    // Safety limiter: several hot tracks summed together would otherwise clip.
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(this.ctx.destination);
    this.output = limiter;

    // iOS moves the context to "interrupted" for calls, Siri, other apps, etc.
    this.ctx.addEventListener('statechange', () => {
      if (this._playing && this.ctx.state !== 'running') this.pause();
    });
  }

  get playing(): boolean {
    return this._playing;
  }

  get position(): number {
    if (!this._playing) return this.startOffset;
    this.commitPendingLoop();
    return clamp(this.startOffset + Math.max(0, this.ctx.currentTime - this.startCtxTime), 0, this.duration);
  }

  addTrack(id: string): void {
    const gain = this.ctx.createGain();
    gain.connect(this.output);
    this.tracks.set(id, { gain, buffer: null });
  }

  setBuffer(id: string, buffer: AudioBuffer): void {
    const track = this.tracks.get(id);
    if (!track) return;
    track.buffer = buffer;
    this.duration = Math.max(this.duration, buffer.duration);
  }

  setGain(id: string, value: number): void {
    const param = this.tracks.get(id)?.gain.gain;
    if (!param) return;
    if (this._playing) {
      param.setTargetAtTime(value, this.ctx.currentTime, 0.015);
    } else {
      param.cancelScheduledValues(0);
      param.value = value;
    }
  }

  async play(): Promise<void> {
    if (this._playing || this.duration <= 0) return;
    // resume() must be called synchronously inside the user gesture on iOS.
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this._playing) return;
    const offset = this.startOffset >= this.duration - 0.05 ? 0 : this.startOffset;
    this.startAt(offset);
    this.onStateChange?.();
  }

  pause(): void {
    if (!this._playing) return;
    const pos = this.position;
    this.stopSources();
    this._playing = false;
    this.startOffset = pos;
    this.onStateChange?.();
  }

  toggle(): void {
    if (this._playing) this.pause();
    else void this.play();
  }

  seek(time: number): void {
    const t = clamp(time, 0, this.duration);
    if (this._playing) {
      this.stopSources();
      this.startAt(t);
    } else {
      this.startOffset = t;
    }
  }

  setLoop(a: number, b: number, enabled: boolean): void {
    this.loop = { a, b, enabled };
    if (this.pending) this.seek(this.position);
  }

  /** Call once per animation frame: schedules loop wrap-arounds and detects the end. */
  tick(): void {
    if (!this._playing) return;
    const pos = this.position;
    const { a, b, enabled } = this.loop;

    if (enabled && b > a && !this.pending && pos < b) {
      const wrapAt = this.startCtxTime + (b - this.startOffset);
      const now = this.ctx.currentTime;
      if (wrapAt - now <= LOOP_LOOKAHEAD) {
        if (wrapAt <= now + 0.005) {
          this.seek(a);
        } else {
          for (const s of this.sources) s.stop(wrapAt);
          this.pending = { at: wrapAt, offset: a, sources: this.createSources(a, wrapAt) };
        }
      }
    }

    if (this.position >= this.duration) {
      this.stopSources();
      this._playing = false;
      this.startOffset = 0;
      this.onStateChange?.();
    }
  }

  private startAt(offset: number): void {
    const when = this.ctx.currentTime + START_DELAY;
    this.sources = this.createSources(offset, when);
    this.startCtxTime = when;
    this.startOffset = offset;
    this._playing = true;
  }

  private createSources(offset: number, when: number): AudioBufferSourceNode[] {
    const out: AudioBufferSourceNode[] = [];
    for (const track of this.tracks.values()) {
      if (!track.buffer || offset >= track.buffer.duration) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = track.buffer;
      src.connect(track.gain);
      src.onended = () => src.disconnect();
      src.start(when, offset);
      out.push(src);
    }
    return out;
  }

  private commitPendingLoop(): void {
    const p = this.pending;
    if (!p || this.ctx.currentTime < p.at) return;
    this.sources = p.sources;
    this.startCtxTime = p.at;
    this.startOffset = p.offset;
    this.pending = null;
  }

  private stopSources(): void {
    for (const src of [...this.sources, ...(this.pending?.sources ?? [])]) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
    }
    this.sources = [];
    this.pending = null;
  }
}
