# SPIN_UP

Static, mobile-first multitrack harmony player for practicing "It Is Well".
Vite + vanilla TypeScript, no backend. Deployed to Vercel as a static site.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install deps (Vite, TypeScript) |
| `npm run dev` | Dev server (generates placeholder audio first) |
| `npm run build` | Type-check + build static site into `dist/` |
| `npm run preview` | Serve `dist/` locally |

## Map

```
index.html               Page shell: header, track list, sticky transport
public/tracks/
  tracks.json            Track manifest (id, label, file, color) - edit this to add/rename tracks
  *.mp3 / *.wav          Audio files, served as-is at /tracks/...
scripts/
  gen-placeholders.mjs   Writes placeholder-*.wav if the manifest references them (runs on predev/prebuild)
src/
  main.ts                Bootstrap: load manifest, load/decode tracks, transport, render loop, keyboard
  engine.ts              Web Audio engine: one AudioContext, per-track GainNodes, synced sources, A-B loop, mute/solo math
  track-row.ts           One track row: mute/solo/volume controls, waveform scrubbing
  waveform.ts            Peak computation (cached) + canvas waveform rendering
  manifest.ts            Manifest parsing, audio fetch with progress, missing-file detection
  ios.ts                 iOS audio unlock + silent-switch workaround
  storage.ts             localStorage persistence of volume/mute/solo
  style.css              All styles (light/dark via prefers-color-scheme)
vercel.json              Vercel build settings (framework vite, output dist)
```

## Invariants

- All tracks play through a single `AudioContext`; every play/seek/loop starts all
  sources at the same context time. Don't switch to `<audio>` elements (they drift).
- Mute/solo: if any track is soloed only soloed tracks are audible; mute always wins.
- Placeholder WAVs are generated, not committed (`.gitignore`).
