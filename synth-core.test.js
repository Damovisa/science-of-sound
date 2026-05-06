import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SC = require('./synth-core.js');

// ═══════════════════════════════════════════════════════════════════════════════
// Music Theory
// ═══════════════════════════════════════════════════════════════════════════════

describe('noteFreq', () => {
  it('returns 440 for A4', () => {
    expect(SC.noteFreq('A', 4)).toBeCloseTo(440, 2);
  });

  it('returns ~261.63 for C4 (middle C)', () => {
    expect(SC.noteFreq('C', 4)).toBeCloseTo(261.63, 1);
  });

  it('returns ~880 for A5', () => {
    expect(SC.noteFreq('A', 5)).toBeCloseTo(880, 1);
  });

  it('returns null for invalid note name', () => {
    expect(SC.noteFreq('X', 4)).toBeNull();
    expect(SC.noteFreq('', 4)).toBeNull();
  });

  it('doubles frequency per octave', () => {
    const a3 = SC.noteFreq('A', 3);
    const a4 = SC.noteFreq('A', 4);
    expect(a4 / a3).toBeCloseTo(2, 5);
  });
});

describe('freqToNoteInfo', () => {
  it('identifies 440 Hz as A4 with 0 cents', () => {
    const info = SC.freqToNoteInfo(440);
    expect(info.name).toBe('A');
    expect(info.octave).toBe(4);
    expect(info.cents).toBe(0);
    expect(info.label).toBe('A4');
  });

  it('identifies 880 Hz as A5', () => {
    const info = SC.freqToNoteInfo(880);
    expect(info.name).toBe('A');
    expect(info.octave).toBe(5);
  });

  it('returns non-zero cents for detuned frequency', () => {
    const info = SC.freqToNoteInfo(445);
    expect(info.name).toBe('A');
    expect(info.cents).toBeGreaterThan(0);
  });

  it('returns null for invalid inputs', () => {
    expect(SC.freqToNoteInfo(0)).toBeNull();
    expect(SC.freqToNoteInfo(-100)).toBeNull();
    expect(SC.freqToNoteInfo(null)).toBeNull();
    expect(SC.freqToNoteInfo(undefined)).toBeNull();
  });

  it('round-trips with noteFreq', () => {
    const freq = SC.noteFreq('E', 3);
    const info = SC.freqToNoteInfo(freq);
    expect(info.name).toBe('E');
    expect(info.octave).toBe(3);
    expect(info.cents).toBe(0);
  });
});

describe('freqDisplay', () => {
  it('formats exact note frequency', () => {
    const result = SC.freqDisplay(440);
    expect(result).toContain('440 Hz');
    expect(result).toContain('A4');
  });

  it('includes cents for detuned frequency', () => {
    const result = SC.freqDisplay(445);
    expect(result).toContain('445 Hz');
    expect(result).toMatch(/A4[+\-]\d+/);
  });

  it('handles non-note frequency gracefully', () => {
    const result = SC.freqDisplay(21.5);
    expect(result).toContain('22 Hz');
  });
});

describe('ALL_NOTES', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(SC.ALL_NOTES)).toBe(true);
    expect(SC.ALL_NOTES.length).toBeGreaterThan(0);
  });

  it('each entry has label and freq', () => {
    SC.ALL_NOTES.forEach(n => {
      expect(typeof n.label).toBe('string');
      expect(n.label.length).toBeGreaterThanOrEqual(2);
      expect(typeof n.freq).toBe('number');
      expect(n.freq).toBeGreaterThanOrEqual(20);
      expect(n.freq).toBeLessThanOrEqual(8000);
    });
  });

  it('includes A4 at 440 Hz', () => {
    const a4 = SC.ALL_NOTES.find(n => n.label === 'A4');
    expect(a4).toBeDefined();
    expect(a4.freq).toBeCloseTo(440, 1);
  });

  it('is sorted ascending by frequency', () => {
    for (let i = 1; i < SC.ALL_NOTES.length; i++) {
      expect(SC.ALL_NOTES[i].freq).toBeGreaterThanOrEqual(SC.ALL_NOTES[i - 1].freq);
    }
  });
});

describe('inRange', () => {
  it('returns true for frequencies within 20-8000', () => {
    expect(SC.inRange(20)).toBe(true);
    expect(SC.inRange(440)).toBe(true);
    expect(SC.inRange(8000)).toBe(true);
  });

  it('returns false for frequencies outside range', () => {
    expect(SC.inRange(19)).toBe(false);
    expect(SC.inRange(8001)).toBe(false);
    expect(SC.inRange(0)).toBe(false);
    expect(SC.inRange(-100)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Instruments
// ═══════════════════════════════════════════════════════════════════════════════

describe('INSTRUMENTS', () => {
  it('has all expected instruments', () => {
    const expected = ['piano', 'violin', 'guitar', 'clarinet', 'flute', 'trumpet'];
    expected.forEach(key => {
      expect(SC.INSTRUMENTS[key]).toBeDefined();
    });
  });

  it('each instrument has a display name and 7 harmonics', () => {
    Object.entries(SC.INSTRUMENTS).forEach(([key, inst]) => {
      expect(typeof inst.name).toBe('string');
      expect(inst.name.length).toBeGreaterThan(0);
      expect(Array.isArray(inst.harmonics)).toBe(true);
      expect(inst.harmonics).toHaveLength(7);
    });
  });

  it('harmonic ratios are finite numbers in [0, 1]', () => {
    Object.values(SC.INSTRUMENTS).forEach(inst => {
      inst.harmonics.forEach(ratio => {
        expect(typeof ratio).toBe('number');
        expect(isFinite(ratio)).toBe(true);
        expect(ratio).toBeGreaterThanOrEqual(0);
        expect(ratio).toBeLessThanOrEqual(1);
      });
    });
  });
});

describe('computeHarmonics', () => {
  it('returns harmonics for piano at A4', () => {
    const harmonics = SC.computeHarmonics(440, 0.5, 'piano');
    expect(harmonics.length).toBeGreaterThan(0);
    // 2nd harmonic = 880 Hz
    expect(harmonics[0].freq).toBe(880);
    // gain = 0.5 * 0.50 = 0.25
    expect(harmonics[0].gain).toBeCloseTo(0.25, 5);
  });

  it('skips harmonics outside frequency range', () => {
    // High fundamental - most harmonics will exceed 8000
    const harmonics = SC.computeHarmonics(5000, 0.5, 'piano');
    harmonics.forEach(h => {
      expect(h.freq).toBeLessThanOrEqual(8000);
    });
  });

  it('skips zero-gain harmonics', () => {
    // Flute has 0.00 for 7th and 8th harmonics
    const harmonics = SC.computeHarmonics(440, 0.5, 'flute');
    harmonics.forEach(h => {
      expect(h.gain).toBeGreaterThan(0);
    });
  });

  it('returns empty array for invalid instrument', () => {
    const harmonics = SC.computeHarmonics(440, 0.5, 'nonexistent');
    expect(harmonics).toEqual([]);
  });

  it('scales gain relative to fundamental gain', () => {
    const h1 = SC.computeHarmonics(440, 1.0, 'trumpet');
    const h2 = SC.computeHarmonics(440, 0.5, 'trumpet');
    // Same number of harmonics
    expect(h1.length).toBe(h2.length);
    // Gains are proportional
    for (let i = 0; i < h1.length; i++) {
      expect(h1[i].gain).toBeCloseTo(h2[i].gain * 2, 5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Oscillator Normalization
// ═══════════════════════════════════════════════════════════════════════════════

describe('normalizeOscillator', () => {
  it('passes through valid oscillator data', () => {
    const result = SC.normalizeOscillator({ type: 'square', freq: 220, gain: 0.7 });
    expect(result.type).toBe('square');
    expect(result.freq).toBe(220);
    expect(result.gain).toBe(0.7);
  });

  it('defaults invalid type to sine', () => {
    expect(SC.normalizeOscillator({ type: 'invalid', freq: 440, gain: 0.5 }).type).toBe('sine');
    expect(SC.normalizeOscillator({ type: '', freq: 440, gain: 0.5 }).type).toBe('sine');
    expect(SC.normalizeOscillator({ type: null, freq: 440, gain: 0.5 }).type).toBe('sine');
  });

  it('clamps frequency to [20, 8000]', () => {
    expect(SC.normalizeOscillator({ type: 'sine', freq: 5, gain: 0.5 }).freq).toBe(20);
    expect(SC.normalizeOscillator({ type: 'sine', freq: 10000, gain: 0.5 }).freq).toBe(8000);
  });

  it('clamps gain to [0, 1]', () => {
    expect(SC.normalizeOscillator({ type: 'sine', freq: 440, gain: -0.5 }).gain).toBe(0);
    expect(SC.normalizeOscillator({ type: 'sine', freq: 440, gain: 2.0 }).gain).toBe(1);
  });

  it('handles NaN and Infinity values', () => {
    const result = SC.normalizeOscillator({ type: 'sine', freq: NaN, gain: Infinity });
    expect(result.freq).toBe(440); // fallback
    expect(result.gain).toBe(0.5); // fallback
  });

  it('handles null/undefined input', () => {
    const r1 = SC.normalizeOscillator(null);
    expect(r1.type).toBe('sine');
    expect(r1.freq).toBe(220);
    expect(r1.gain).toBe(0.5);
    expect(SC.isValidColor(r1.color)).toBe(true);

    const r2 = SC.normalizeOscillator(undefined);
    expect(r2.type).toBe('sine');
    expect(r2.freq).toBe(220);
    expect(r2.gain).toBe(0.5);
    expect(SC.isValidColor(r2.color)).toBe(true);
  });

  it('rounds frequency to integer', () => {
    expect(SC.normalizeOscillator({ type: 'sine', freq: 440.7, gain: 0.5 }).freq).toBe(441);
  });
});

describe('validatePreset', () => {
  it('validates a well-formed preset', () => {
    const preset = { name: 'Test', oscillators: [{ type: 'sine', freq: 440, gain: 0.5 }] };
    const result = SC.validatePreset(preset);
    expect(result.name).toBe('Test');
    expect(result.oscillators).toHaveLength(1);
    expect(result.oscillators[0].type).toBe('sine');
  });

  it('trims preset name', () => {
    const preset = { name: '  Padded  ', oscillators: [{ type: 'sine', freq: 440, gain: 0.5 }] };
    expect(SC.validatePreset(preset).name).toBe('Padded');
  });

  it('returns null for empty name', () => {
    expect(SC.validatePreset({ name: '', oscillators: [{ type: 'sine', freq: 440, gain: 0.5 }] })).toBeNull();
    expect(SC.validatePreset({ name: '   ', oscillators: [{ type: 'sine', freq: 440, gain: 0.5 }] })).toBeNull();
  });

  it('returns null for empty oscillators array', () => {
    expect(SC.validatePreset({ name: 'Empty', oscillators: [] })).toBeNull();
  });

  it('returns null for missing oscillators', () => {
    expect(SC.validatePreset({ name: 'NoOsc' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(SC.validatePreset(null)).toBeNull();
    expect(SC.validatePreset('string')).toBeNull();
    expect(SC.validatePreset(42)).toBeNull();
  });

  it('normalizes invalid oscillator data within preset', () => {
    const preset = { name: 'Bad', oscillators: [{ type: 'bad', freq: -100, gain: 5 }] };
    const result = SC.validatePreset(preset);
    expect(result.oscillators[0].type).toBe('sine');
    expect(result.oscillators[0].freq).toBe(20);
    expect(result.oscillators[0].gain).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('escHtml', () => {
  it('escapes HTML special characters', () => {
    expect(SC.escHtml('<script>')).toBe('&lt;script&gt;');
    expect(SC.escHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(SC.escHtml("it's")).toBe("it&#39;s");
    expect(SC.escHtml('a & b')).toBe('a &amp; b');
  });

  it('handles empty string', () => {
    expect(SC.escHtml('')).toBe('');
  });

  it('handles non-string input', () => {
    expect(SC.escHtml(123)).toBe('123');
    expect(SC.escHtml(null)).toBe('null');
  });
});

describe('waveShortName', () => {
  it('returns Saw for sawtooth', () => {
    expect(SC.waveShortName('sawtooth')).toBe('Saw');
  });

  it('capitalizes sine and square', () => {
    expect(SC.waveShortName('sine')).toBe('Sine');
    expect(SC.waveShortName('square')).toBe('Square');
  });
});

describe('clampNumber', () => {
  it('clamps within range', () => {
    expect(SC.clampNumber(50, 0, 100, 0)).toBe(50);
    expect(SC.clampNumber(-5, 0, 100, 0)).toBe(0);
    expect(SC.clampNumber(200, 0, 100, 0)).toBe(100);
  });

  it('returns fallback for NaN/Infinity', () => {
    expect(SC.clampNumber(NaN, 0, 100, 42)).toBe(42);
    expect(SC.clampNumber(Infinity, 0, 100, 42)).toBe(42);
    expect(SC.clampNumber(-Infinity, 0, 100, 42)).toBe(42);
  });

  it('coerces string numbers', () => {
    expect(SC.clampNumber('50', 0, 100, 0)).toBe(50);
  });

  it('returns fallback for non-numeric strings', () => {
    expect(SC.clampNumber('abc', 0, 100, 42)).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Color Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('TONE_PALETTE', () => {
  it('is a non-empty array of valid hex colors', () => {
    expect(SC.TONE_PALETTE.length).toBeGreaterThan(0);
    SC.TONE_PALETTE.forEach(c => {
      expect(SC.isValidColor(c)).toBe(true);
    });
  });
});

describe('isValidColor', () => {
  it('accepts valid 6-digit hex colors', () => {
    expect(SC.isValidColor('#ff0000')).toBe(true);
    expect(SC.isValidColor('#4da6ff')).toBe(true);
    expect(SC.isValidColor('#000000')).toBe(true);
  });

  it('rejects invalid colors', () => {
    expect(SC.isValidColor('#fff')).toBe(false);   // 3-digit
    expect(SC.isValidColor('red')).toBe(false);    // named
    expect(SC.isValidColor('')).toBe(false);
    expect(SC.isValidColor(null)).toBe(false);
    expect(SC.isValidColor(123)).toBe(false);
    expect(SC.isValidColor('#gggggg')).toBe(false);
  });
});

describe('nextColor / resetPaletteIndex', () => {
  it('cycles through the palette', () => {
    SC.resetPaletteIndex();
    const first = SC.nextColor();
    expect(first).toBe(SC.TONE_PALETTE[0]);
    const second = SC.nextColor();
    expect(second).toBe(SC.TONE_PALETTE[1]);
  });

  it('wraps around when palette is exhausted', () => {
    SC.resetPaletteIndex();
    for (let i = 0; i < SC.TONE_PALETTE.length; i++) SC.nextColor();
    const wrapped = SC.nextColor();
    expect(wrapped).toBe(SC.TONE_PALETTE[0]);
  });

  it('resetPaletteIndex resets to start', () => {
    SC.nextColor(); SC.nextColor();
    SC.resetPaletteIndex();
    expect(SC.nextColor()).toBe(SC.TONE_PALETTE[0]);
  });
});

describe('normalizeOscillator color handling', () => {
  it('preserves valid color from input', () => {
    SC.resetPaletteIndex();
    const result = SC.normalizeOscillator({ type: 'sine', freq: 440, gain: 0.5, color: '#ff5500' });
    expect(result.color).toBe('#ff5500');
  });

  it('assigns palette color when no color provided', () => {
    SC.resetPaletteIndex();
    const result = SC.normalizeOscillator({ type: 'sine', freq: 440, gain: 0.5 });
    expect(SC.isValidColor(result.color)).toBe(true);
    expect(result.color).toBe(SC.TONE_PALETTE[0]);
  });

  it('assigns palette color for invalid color input', () => {
    SC.resetPaletteIndex();
    const result = SC.normalizeOscillator({ type: 'sine', freq: 440, gain: 0.5, color: 'not-a-color' });
    expect(SC.isValidColor(result.color)).toBe(true);
  });
});
