# YT Pitch & Spectrum (Firefox)

Transpose YouTube audio up/down by semitones **without changing speed**, see the notes being played, and shape the sound.

## Features
- **Pitch**: ±12 semitones plus ±50 cents fine tune. Phase-vocoder with identity phase-locking, run in an AudioWorklet (falls back to a ScriptProcessor if needed). Three quality levels (larger FFT gives a smoother tone but a little more A/V delay).
- **Vocals**: *Remove* or *Isolate* lead vocals in real time. A frequency-domain filter compares the two channels and removes or keeps what is identical in left and right, which is where lead vocals usually sit. A strength slider and *keep below / keep above* frequency limits protect the bass, kick and cymbals. It works on studio stereo mixes, not on mono recordings (the panel warns you), and it combines with pitch shift for karaoke in any key.
- **Spectrum & notes**: live log-frequency spectrum (A0–C8) aligned to a piano-roll strip. The strongest partials are labelled with note name and cents. A chroma bar chart shows the 12 pitch classes, and a running **key estimate** is given (with the original key when pitch-shifted).
- **EQ**: 10-band graphic EQ (31 Hz–16 kHz, ±12 dB) with presets and a live response curve. Double-click a band to zero it.
- **Loudness**: gain ±24 dB, gentle compressor, **auto-level** to a target LUFS (−23…−9), a always-on −1 dBFS safety limiter, and a K-weighted output meter (≈LUFS).
- Bypass button, draggable panel, works in fullscreen, settings are remembered and synced across YouTube tabs.

## Install
**Try it now (temporary until Firefox restarts):**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and pick `manifest.json` (or the `.xpi`/`.zip`).

**Keep it permanently:** Release Firefox only installs signed add-ons. Either
- sign it for free as an *unlisted* add-on at https://addons.mozilla.org/developers/ (or `web-ext sign`), or
- use Firefox Developer Edition / Nightly with `xpinstall.signatures.required = false` in `about:config`, then install the `.xpi`.

## Use
Click the toolbar icon (or **Alt+Shift+Y**) on a YouTube page to open the panel.

| Shortcut | Action |
|---|---|
| Alt+Shift+Y | Show / hide panel |
| Alt+Shift+↑ / ↓ | Pitch ±1 semitone |
| Alt+Shift+0 | Reset pitch |
| Alt+Shift+V | Toggle vocal removal |

Shortcuts can be changed in `about:addons` → ⚙ → *Manage Extension Shortcuts*.

## Notes
- Audio routing only starts when you open the panel or change a setting, so YouTube is untouched otherwise. If Firefox hasn't allowed audio yet, the panel asks you to click once.
- Once a video's audio is routed through Web Audio it stays routed until the page reloads. With *Bypass* on, it's passed straight through.
- The spectrum/notes show what you hear (after pitch and EQ). The detected notes are the strongest partials, so harmonics appear too. The chroma and key display is the better "what notes are in this" view.

## Development
No build step: plain JS. `dsp/` holds the DSP (pitch shifter, vocal filter) shared by the AudioWorklet and the ScriptProcessor fallback. `content/` holds the Web Audio graph, the panel UI and the glue. Lint with `npx web-ext lint`, and package with `npx web-ext build`.
