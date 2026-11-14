const PEAK_BUCKETS = 2048;
const peakCache = new Map<string, Float32Array>();

/** Peak amplitude per bucket across all channels, normalized to 0..1. Cached per key. */
export function getPeaks(key: string, buffer: AudioBuffer): Float32Array {
  const cached = peakCache.get(key);
  if (cached) return cached;

  const peaks = new Float32Array(PEAK_BUCKETS);
  const len = buffer.length;
  const per = len / PEAK_BUCKETS;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < PEAK_BUCKETS; b++) {
      const end = Math.min(len, Math.floor((b + 1) * per));
      let max = peaks[b];
      for (let i = Math.floor(b * per); i < end; i++) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > max) max = v;
      }
      peaks[b] = max;
    }
  }
  let overall = 0;
  for (const p of peaks) overall = Math.max(overall, p);
  if (overall > 0) for (let b = 0; b < PEAK_BUCKETS; b++) peaks[b] /= overall;

  peakCache.set(key, peaks);
  return peaks;
}

export interface LoopRegion {
  a: number;
  b: number;
  enabled: boolean;
}

const BAR = 2;
const GAP = 1;

export class WaveformView {
  readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d')!;
  private peaks: Float32Array | null = null;
  private trackDuration = 0;
  private timeline = 0;
  private played: HTMLCanvasElement | null = null;
  private unplayed: HTMLCanvasElement | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(private readonly color: string) {
    this.canvas.className = 'wave-canvas';
  }

  setData(peaks: Float32Array, trackDuration: number): void {
    this.peaks = peaks;
    this.trackDuration = trackDuration;
    this.played = this.unplayed = null;
  }

  setTimeline(duration: number): void {
    if (duration === this.timeline) return;
    this.timeline = duration;
    this.played = this.unplayed = null;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = this.canvas.width = w;
    this.height = this.canvas.height = h;
    this.dpr = dpr;
    this.played = this.unplayed = null;
  }

  /** Positions are in seconds on the shared timeline. */
  render(position: number, loop: LoopRegion | null, playheadColor: string): void {
    const { g, width: w, height: h } = this;
    if (!w || !h) return;
    g.clearRect(0, 0, w, h);
    if (!this.peaks || !this.timeline) return;
    if (!this.played || !this.unplayed) this.buildLayers();

    const x = Math.round((position / this.timeline) * w);
    g.drawImage(this.unplayed!, 0, 0);
    if (x > 0) g.drawImage(this.played!, 0, 0, x, h, 0, 0, x, h);

    if (loop && loop.b > loop.a) {
      const xa = (loop.a / this.timeline) * w;
      const xb = (loop.b / this.timeline) * w;
      g.fillStyle = playheadColor;
      g.globalAlpha = loop.enabled ? 0.14 : 0.06;
      g.fillRect(xa, 0, xb - xa, h);
      g.globalAlpha = loop.enabled ? 0.6 : 0.3;
      g.fillRect(xa, 0, this.dpr, h);
      g.fillRect(xb - this.dpr, 0, this.dpr, h);
      g.globalAlpha = 1;
    }

    g.fillStyle = playheadColor;
    g.fillRect(Math.min(w - 2 * this.dpr, Math.max(0, x - this.dpr)), 0, 2 * this.dpr, h);
  }

  private buildLayers(): void {
    this.unplayed = this.drawBars(0.35);
    this.played = this.drawBars(1);
  }

  private drawBars(alpha: number): HTMLCanvasElement {
    const layer = document.createElement('canvas');
    layer.width = this.width;
    layer.height = this.height;
    const g = layer.getContext('2d')!;
    g.fillStyle = this.color;
    g.globalAlpha = alpha;

    const peaks = this.peaks!;
    const step = (BAR + GAP) * this.dpr;
    const barW = BAR * this.dpr;
    const mid = this.height / 2;
    const trackW = (this.trackDuration / this.timeline) * this.width;
    for (let x = 0; x < trackW; x += step) {
      const from = Math.floor((x / trackW) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((x + step) / trackW) * peaks.length));
      let v = 0;
      for (let i = from; i < to && i < peaks.length; i++) v = Math.max(v, peaks[i]);
      const half = Math.max(this.dpr, v * mid * 0.92);
      g.fillRect(x, mid - half, barW, half * 2);
    }
    return layer;
  }
}
