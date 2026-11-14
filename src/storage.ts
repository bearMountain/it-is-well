import type { MixState } from './engine';

const KEY = 'it-is-well:mix:v1';

export function loadMix(): Record<string, MixState> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, MixState>) : {};
  } catch {
    return {};
  }
}

export function saveMix(mix: Record<string, MixState>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mix));
  } catch {
    // private mode / quota: persistence is best-effort
  }
}
