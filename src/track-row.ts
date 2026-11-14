import { isAudible, type MixState } from './engine';
import type { TrackDef } from './manifest';
import { WaveformView } from './waveform';

export interface ScrubHandlers {
  /** Fraction 0..1 of the shared timeline while a finger/mouse is down. */
  move(fraction: number): void;
  commit(fraction: number): void;
  cancel(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class TrackRow {
  readonly el = el('li', 'track is-loading');
  readonly wave: WaveformView;
  ready = false;

  private readonly muteBtn = el('button', 'pill mute', 'Mute');
  private readonly soloBtn = el('button', 'pill solo', 'Solo');
  private readonly slider = el('input', 'vol-slider');
  private readonly volOut = el('output', 'vol-value');
  private readonly status = el('span', 'track-status');
  private readonly msg = el('div', 'wave-msg', 'Waiting…');
  private readonly bar = el('div', 'wave-progress');

  constructor(
    readonly def: TrackDef,
    readonly state: MixState,
    private readonly onMixChange: () => void,
    scrub: ScrubHandlers,
  ) {
    this.wave = new WaveformView(def.color);
    this.el.style.setProperty('--track-color', def.color);

    const head = el('div', 'track-head');
    const name = el('div', 'track-name');
    name.append(el('span', 'swatch'), el('span', 'track-label', def.label), this.status);
    for (const [btn, label] of [
      [this.muteBtn, `Mute ${def.label}`],
      [this.soloBtn, `Solo ${def.label}`],
    ] as const) {
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
    }
    head.append(name, this.muteBtn, this.soloBtn);

    const waveBox = el('div', 'wave');
    this.bar.append(el('div', 'wave-progress-fill'));
    waveBox.append(this.wave.canvas, this.msg, this.bar);

    const vol = el('label', 'vol');
    vol.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '100';
    this.slider.step = '1';
    this.slider.setAttribute('aria-label', `${def.label} volume`);
    vol.append(this.slider, this.volOut);

    this.el.append(head, waveBox, vol);

    this.muteBtn.addEventListener('click', () => {
      this.state.muted = !this.state.muted;
      this.onMixChange();
    });
    this.soloBtn.addEventListener('click', () => {
      this.state.soloed = !this.state.soloed;
      this.onMixChange();
    });
    this.slider.addEventListener('input', () => {
      this.state.volume = Number(this.slider.value) / 100;
      this.onMixChange();
    });

    this.setControlsEnabled(false);
    this.attachScrub(waveBox, scrub);
  }

  setProgress(fraction: number | null, phase: 'download' | 'decode'): void {
    this.msg.textContent =
      phase === 'decode' ? 'Decoding…' : fraction === null ? 'Downloading…' : `Downloading ${Math.round(fraction * 100)}%`;
    this.bar.style.setProperty('--progress', String(phase === 'decode' ? 1 : (fraction ?? 0.15)));
  }

  setReady(): void {
    this.ready = true;
    this.el.classList.remove('is-loading');
    this.msg.textContent = '';
    this.setControlsEnabled(true);
  }

  setError(message: string): void {
    this.el.classList.remove('is-loading');
    this.el.classList.add('is-error');
    this.msg.textContent = `${message}: ${this.def.file}`;
    this.status.textContent = 'Unavailable';
  }

  update(anySolo: boolean): void {
    const { muted, soloed, volume } = this.state;
    const pct = Math.round(volume * 100);
    this.slider.value = String(pct);
    this.volOut.textContent = `${pct}%`;
    this.muteBtn.setAttribute('aria-pressed', String(muted));
    this.soloBtn.setAttribute('aria-pressed', String(soloed));
    if (!this.ready) return;

    const silencedBySolo = !muted && anySolo && !soloed;
    this.el.classList.toggle('is-muted', muted);
    this.el.classList.toggle('is-soloed', soloed);
    this.el.classList.toggle('is-silent', !isAudible(this.state, anySolo));
    this.status.textContent = muted ? 'Muted' : silencedBySolo ? 'Not soloed' : soloed ? 'Solo' : '';
  }

  private setControlsEnabled(enabled: boolean): void {
    this.muteBtn.disabled = this.soloBtn.disabled = this.slider.disabled = !enabled;
  }

  private attachScrub(target: HTMLElement, scrub: ScrubHandlers): void {
    let pointerId: number | null = null;
    const fraction = (e: PointerEvent) => {
      const r = target.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };

    target.addEventListener('pointerdown', (e) => {
      if (pointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      pointerId = e.pointerId;
      target.setPointerCapture(e.pointerId);
      scrub.move(fraction(e));
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointerId) scrub.move(fraction(e));
    });
    target.addEventListener('pointerup', (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      scrub.commit(fraction(e));
    });
    // Fired when the browser takes over the gesture (vertical page scroll).
    target.addEventListener('pointercancel', (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      scrub.cancel();
    });
  }
}
