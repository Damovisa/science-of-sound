// synth-core.js — Pure domain logic (browser + Node compatible)
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SynthCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── Music theory ──────────────────────────────────────────────────────────
  var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  function noteFreq(name, octave) {
    var semi = NOTE_NAMES.indexOf(name);
    if (semi === -1) return null;
    return 440 * Math.pow(2, (12 * (octave + 1) + semi - 69) / 12);
  }

  function freqToNoteInfo(hz) {
    if (!hz || hz <= 0) return null;
    var midi = 12 * Math.log2(hz / 440) + 69;
    var midiRound = Math.round(midi);
    var cents = Math.round((midi - midiRound) * 100);
    var octave = Math.floor(midiRound / 12) - 1;
    var semi = ((midiRound % 12) + 12) % 12;
    return { name: NOTE_NAMES[semi], octave: octave, cents: cents, label: NOTE_NAMES[semi] + octave };
  }

  function freqDisplay(hz) {
    var info = freqToNoteInfo(hz);
    var noteStr = info
      ? ' (' + info.label + (info.cents !== 0 ? (info.cents > 0 ? '+' + info.cents + '\u00A2' : info.cents + '\u00A2') : '') + ')'
      : '';
    return Math.round(hz) + ' Hz' + noteStr;
  }

  var ALL_NOTES = (function () {
    var out = [];
    for (var oct = 1; oct <= 7; oct++) {
      for (var i = 0; i < NOTE_NAMES.length; i++) {
        var freq = noteFreq(NOTE_NAMES[i], oct);
        if (freq >= 20 && freq <= 8000) out.push({ label: NOTE_NAMES[i] + oct, freq: freq });
      }
    }
    return out;
  })();

  var MIN_FREQ = 20;
  var MAX_FREQ = 8000;
  var VALID_TYPES = ['sine', 'square', 'sawtooth'];

  function inRange(hz) { return hz >= MIN_FREQ && hz <= MAX_FREQ; }

  // ── Instrument harmonic profiles ──────────────────────────────────────────
  var INSTRUMENTS = {
    piano:    { name: 'Piano',    harmonics: [0.50, 0.33, 0.20, 0.15, 0.10, 0.08, 0.05] },
    violin:   { name: 'Violin',   harmonics: [0.50, 0.33, 0.25, 0.20, 0.17, 0.14, 0.12] },
    guitar:   { name: 'Guitar',   harmonics: [0.50, 0.30, 0.20, 0.12, 0.08, 0.05, 0.03] },
    clarinet: { name: 'Clarinet', harmonics: [0.04, 0.75, 0.03, 0.50, 0.02, 0.14, 0.01] },
    flute:    { name: 'Flute',    harmonics: [0.30, 0.12, 0.05, 0.02, 0.01, 0.00, 0.00] },
    trumpet:  { name: 'Trumpet',  harmonics: [0.70, 0.60, 0.50, 0.35, 0.25, 0.15, 0.10] },
    oboe:     { name: 'Oboe',     harmonics: [0.65, 0.35, 0.48, 0.22, 0.28, 0.10, 0.16] },
    cello:    { name: 'Cello',    harmonics: [0.60, 0.45, 0.35, 0.28, 0.22, 0.18, 0.14] },
  };

  // ── Oscillator state helpers ──────────────────────────────────────────────
  function clampNumber(val, min, max, fallback) {
    var n = Number(val);
    if (!isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
  }

  function normalizeOscillator(input) {
    if (!input || typeof input !== 'object') {
      return { type: 'sine', freq: 220, gain: 0.5, color: nextColor() };
    }
    var type = VALID_TYPES.indexOf(input.type) >= 0 ? input.type : 'sine';
    var freq = clampNumber(input.freq, MIN_FREQ, MAX_FREQ, 440);
    var gain = clampNumber(input.gain, 0, 1, 0.5);
    var color = isValidColor(input.color) ? input.color : nextColor();
    return { type: type, freq: Math.round(freq), gain: gain, color: color };
  }

  function validatePreset(preset) {
    if (!preset || typeof preset !== 'object') return null;
    if (typeof preset.name !== 'string' || !preset.name.trim()) return null;
    if (!Array.isArray(preset.oscillators) || preset.oscillators.length === 0) return null;
    return {
      name: preset.name.trim(),
      oscillators: preset.oscillators.map(normalizeOscillator)
    };
  }

  function computeHarmonics(fundamentalFreq, fundamentalGain, instrumentKey) {
    var profile = INSTRUMENTS[instrumentKey];
    if (!profile) return [];
    var results = [];
    for (var i = 0; i < profile.harmonics.length; i++) {
      var ratio = profile.harmonics[i];
      var freq = fundamentalFreq * (i + 2);
      if (inRange(freq) && ratio > 0) {
        results.push({ freq: freq, gain: fundamentalGain * ratio });
      }
    }
    return results;
  }

  // ── Tone color palette ──────────────────────────────────────────────────
  var TONE_PALETTE = [
    '#e06090', // rose
    '#4da6ff', // blue
    '#4ade80', // green
    '#fbbf24', // amber
    '#a78bfa', // violet
    '#f97316', // orange
    '#06b6d4', // cyan
    '#f472b6', // pink
    '#84cc16', // lime
    '#fb7185', // coral
  ];

  var paletteIndex = 0;
  function nextColor() {
    var c = TONE_PALETTE[paletteIndex % TONE_PALETTE.length];
    paletteIndex++;
    return c;
  }
  function resetPaletteIndex() { paletteIndex = 0; }

  function isValidColor(c) {
    return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  }

  // ── String utilities ──────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function waveShortName(t) {
    return t === 'sawtooth' ? 'Saw' : t.charAt(0).toUpperCase() + t.slice(1);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    NOTE_NAMES: NOTE_NAMES,
    ALL_NOTES: ALL_NOTES,
    INSTRUMENTS: INSTRUMENTS,
    VALID_TYPES: VALID_TYPES,
    TONE_PALETTE: TONE_PALETTE,
    MIN_FREQ: MIN_FREQ,
    MAX_FREQ: MAX_FREQ,
    noteFreq: noteFreq,
    freqToNoteInfo: freqToNoteInfo,
    freqDisplay: freqDisplay,
    inRange: inRange,
    clampNumber: clampNumber,
    isValidColor: isValidColor,
    normalizeOscillator: normalizeOscillator,
    validatePreset: validatePreset,
    computeHarmonics: computeHarmonics,
    nextColor: nextColor,
    resetPaletteIndex: resetPaletteIndex,
    escHtml: escHtml,
    waveShortName: waveShortName,
  };
});
