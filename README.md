# it-is-well

It Is Well - harmony practice player (mobile web multitrack mixer).

Every track (each singer's part plus the full mix) plays in sample-locked sync.
Each track has its own volume, Mute and Solo, and you can tap or drag any waveform
to seek. A/B set a loop region for drilling one phrase.

```sh
npm install
npm run dev      # local dev server
npm run build    # static site in dist/ (deploy to Vercel as-is)
```

## Adding or renaming tracks

1. Drop the audio files (MP3 recommended) into `public/tracks/`.
2. Edit `public/tracks/tracks.json`:

```json
{
  "title": "It Is Well",
  "note": "Optional subtitle shown under the title",
  "tracks": [
    { "id": "soprano", "label": "Soprano", "file": "soprano.mp3", "color": "#f97316" },
    { "id": "alto", "label": "Alto", "file": "alto.mp3", "color": "#22c55e" },
    { "id": "tenor", "label": "Tenor", "file": "tenor.mp3", "color": "#3b82f6" },
    { "id": "full-mix", "label": "Full mix", "file": "full-mix.mp3", "color": "#a855f7" }
  ]
}
```

- `file` is relative to `public/tracks/`.
- `id` must be unique and stable, because saved volume/mute/solo settings are keyed by it.
- `color` is optional; a default palette is used if it's omitted.
- Rows appear in manifest order. Any number of tracks works.
- A missing or undecodable file shows as an "unavailable" row. The other tracks still play.

The `placeholder-*.wav` files are generated automatically on `dev`/`build` for as long as
the manifest references them. Once the manifest points only at real recordings, nothing is generated.

See [SPIN_UP.md](SPIN_UP.md) for a map of the code.
