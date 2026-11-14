interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/**
 * Ask for the "playback" audio session so the iOS ring/silent switch doesn't
 * mute Web Audio. Must run before the AudioContext is created.
 * Returns false when the API is unavailable (iOS < 16.4, other browsers).
 */
export function requestPlaybackAudioSession(): boolean {
  const session = (navigator as AudioSessionNavigator).audioSession;
  if (!session) return false;
  try {
    session.type = 'playback';
    return true;
  } catch {
    return false;
  }
}

function silentWavUrl(): string {
  const sampleRate = 8000;
  const samples = sampleRate / 2;
  const view = new DataView(new ArrayBuffer(44 + samples));
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }));
}

/**
 * Resume the AudioContext on the first user gesture (required by iOS/Safari
 * and Chrome autoplay policy). On older iOS without the audioSession API, a
 * looping silent <audio> element is started in the same gesture, which
 * switches the page into the media playback category so the silent switch
 * doesn't kill Web Audio output.
 */
export function installAudioUnlock(ctx: AudioContext, hasPlaybackSession: boolean): void {
  const events = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
  let silentAudio: HTMLAudioElement | null = null;

  const unlock = () => {
    if (!hasPlaybackSession && !silentAudio) {
      silentAudio = new Audio(silentWavUrl());
      silentAudio.loop = true;
      silentAudio.setAttribute('playsinline', '');
      silentAudio.setAttribute('x-webkit-airplay', 'deny');
      silentAudio.play().catch(() => {
        silentAudio = null;
      });
    }

    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
      // A one-sample buffer played inside the gesture fully unlocks older WebKit.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start();
    }

    if (ctx.state === 'running') events.forEach((e) => window.removeEventListener(e, unlock, true));
  };

  events.forEach((e) => window.addEventListener(e, unlock, true));
  ctx.addEventListener('statechange', () => {
    if (ctx.state === 'running') events.forEach((e) => window.removeEventListener(e, unlock, true));
  });
}
