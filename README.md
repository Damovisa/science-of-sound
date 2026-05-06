# Science of Sound

A browser-based additive wave synthesizer built with the Web Audio API. No build step required — open `synth.html` directly in any modern browser.

## Features

- **Three wave types** — sine, square, and sawtooth oscillators
- **Additive synthesis** — layer as many oscillators as you like, all playing simultaneously
- **Per-oscillator controls** — frequency (20–8000 Hz), volume, wave type, and mute/solo
- **Note picker** — select notes by name (e.g. A3, C#4) instead of typing a raw Hz value
- **Instrument harmonics** — instantly add overtones modelled on real instruments: Piano, Violin, Guitar, Clarinet, Flute, Trumpet, Oboe, Cello
- **Per-oscillator color** — assign any color to a tone; reflected in the waveform and spectrum graphs
- **Waveform display** — real-time colored waveform per oscillator; also renders mathematically when not playing
  - Mouse-wheel or pinch to zoom; click-drag or touch-drag to pan; double-click to reset
- **Spectrum display** — frequency-domain bar chart with per-oscillator colors
- **Preset system** — save, load, or merge named combinations of oscillators (stored in `localStorage`)
- **Sticky transport bar** — Play/Stop, Reset, and Unmute All always visible at the top of the page

## Usage

1. Open `synth.html` in a browser (no server needed; works from `file://`)
2. Click **+ Add Tone** to add an oscillator (defaults to A3, 220 Hz, sine wave)
3. Adjust frequency, volume, and wave type with the sliders and dropdown
4. Click the color swatch to assign a color to the tone
5. Use the **Harmonics** row on any oscillator to add instrument-modelled overtones
6. Press **▶ Play** to start audio; **■ Stop** to stop
7. Save the current set of oscillators as a named preset with the **Save Preset** button

## File Structure

| File | Purpose |
|---|---|
| `synth.html` | App entry point — layout and markup |
| `synth.css` | Styles |
| `synth.js` | UI, audio engine, rendering, event handling |
| `synth-core.js` | Pure domain logic (music theory, normalization, color palette, instruments) |
| `synth-core.test.js` | Unit tests (59 tests, run with Vitest) |
| `instrument-harmonics.md` | Reference document for harmonic profiles |

## Running Tests

```bash
npm install
npm test
```

Tests cover all pure functions in `synth-core.js` using [Vitest](https://vitest.dev/). No browser required.

## Browser Compatibility

Requires the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — supported in all modern browsers (Chrome, Firefox, Safari, Edge).
