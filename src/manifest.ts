export interface TrackDef {
  id: string;
  label: string;
  /** Resolved absolute URL of the audio file. */
  url: string;
  /** Path as written in the manifest, for error messages. */
  file: string;
  color: string;
}

export interface Manifest {
  title: string;
  note?: string;
  tracks: TrackDef[];
}

const FALLBACK_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#eab308', '#14b8a6'];

export const MANIFEST_URL = `${import.meta.env.BASE_URL}tracks/tracks.json`;

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Couldn't load ${MANIFEST_URL} (HTTP ${res.status})`);
  const raw = (await res.json()) as {
    title?: unknown;
    note?: unknown;
    tracks?: Array<Record<string, unknown>>;
  };
  if (!Array.isArray(raw.tracks)) throw new Error('tracks.json needs a "tracks" array');

  const base = new URL(MANIFEST_URL, location.href);
  const seen = new Set<string>();
  const tracks = raw.tracks.map((t, i): TrackDef => {
    if (typeof t.file !== 'string' || !t.file) throw new Error(`Track #${i + 1} in tracks.json has no "file"`);
    let id = typeof t.id === 'string' && t.id ? t.id : `track-${i + 1}`;
    while (seen.has(id)) id += '-dup';
    seen.add(id);
    return {
      id,
      label: typeof t.label === 'string' && t.label ? t.label : id,
      file: t.file,
      url: new URL(t.file, base).href,
      color: typeof t.color === 'string' && t.color ? t.color : FALLBACK_COLORS[i % FALLBACK_COLORS.length],
    };
  });

  return {
    title: typeof raw.title === 'string' ? raw.title : 'It Is Well',
    note: typeof raw.note === 'string' ? raw.note : undefined,
    tracks,
  };
}

export class TrackLoadError extends Error {}

/** Fetches with download progress (0..1, or null when the size is unknown). */
export async function fetchAudio(url: string, onProgress: (fraction: number | null) => void): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new TrackLoadError('Network error');
  }
  // Dev servers with SPA fallback answer missing files with index.html.
  if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) {
    throw new TrackLoadError('File not found');
  }
  if (!res.ok) throw new TrackLoadError(`HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) {
    onProgress(null);
    return res.arrayBuffer();
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}
