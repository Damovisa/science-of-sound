// synth.js — UI, audio, and rendering (depends on SynthCore from synth-core.js)
'use strict';

var SC = (typeof SynthCore !== 'undefined') ? SynthCore : require('./synth-core.js');

// ── State ─────────────────────────────────────────────────────────────────────
var audioCtx       = null;
var masterGainNode = null;
var masterAnalyser = null;
var animFrame      = null;
var vizMode        = 'waveform';
var isPlaying      = false;
var oscillators    = [];  // { id, type, freq, gain, muted, origin }
var liveNodes      = [];  // { id, osc, gainNode }
var nextId         = 1;
var STORAGE_KEY    = 'waveSynth_presets_v2';

// ── Waveform view state ───────────────────────────────────────────────────────
var waveZoom      = 1.0;   // >1 = zoomed in (fewer cycles), <1 = more cycles
var wavePanSecs   = 0.0;   // pan offset in seconds

// ── Audio context ─────────────────────────────────────────────────────────────
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function ensureMasterNodes() {
  var ctx = getAudioCtx();
  if (!masterGainNode) {
    masterGainNode = ctx.createGain();
    masterGainNode.gain.value = 1;
    masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 8192;
    masterAnalyser.minDecibels = -80;
    masterAnalyser.maxDecibels = 0;
    masterAnalyser.smoothingTimeConstant = 0.6;
    masterGainNode.connect(masterAnalyser);
    masterAnalyser.connect(ctx.destination);
  }
  return { masterGainNode: masterGainNode, masterAnalyser: masterAnalyser };
}

function startPlayback() {
  var ctx = getAudioCtx();
  if (ctx.state === 'suspended') ctx.resume();
  var nodes = ensureMasterNodes();
  liveNodes = oscillators.map(function (o) {
    var osc = ctx.createOscillator();
    var gainNode = ctx.createGain();
    osc.type = o.type;
    osc.frequency.value = o.freq;
    gainNode.gain.value = o.muted ? 0 : o.gain;
    osc.connect(gainNode);
    gainNode.connect(nodes.masterGainNode);
    osc.start();
    return { id: o.id, osc: osc, gainNode: gainNode };
  });
  startAnimation();
}

function stopPlayback() {
  liveNodes.forEach(function (n) { try { n.osc.stop(); } catch (e) {} });
  liveNodes = [];
  stopAnimation();
}

function restartPlayback() { stopPlayback(); startPlayback(); }

function togglePlay() {
  if (!oscillators.length) return;
  isPlaying = !isPlaying;
  isPlaying ? startPlayback() : stopPlayback();
  updateTransportUI();
}

function updateTransportUI() {
  var btn = document.getElementById('playBtn');
  var ind = document.getElementById('indicator');
  btn.textContent = isPlaying ? '\u23F9 Stop' : '\u25B6 Play';
  btn.className   = isPlaying ? 'btn-danger' : 'btn-primary';
  btn.disabled    = oscillators.length === 0;
  ind.classList.toggle('active', isPlaying);
}

// ── Oscillator data ───────────────────────────────────────────────────────────
function addOscillator(type, freq, gain, color) {
  type   = type   || 'sine';
  freq   = freq   || 220;
  gain   = gain != null ? gain : 0.5;
  color  = color  || SC.nextColor();
  var normalized = SC.normalizeOscillator({ type: type, freq: freq, gain: gain, color: color });
  oscillators.push({
    id: nextId++,
    type: normalized.type,
    freq: normalized.freq,
    gain: normalized.gain,
    color: normalized.color,
    muted: false
  });
  if (isPlaying) restartPlayback();
  renderOscList();
}

function removeOscillator(id) {
  oscillators = oscillators.filter(function (o) { return o.id !== id; });
  if (isPlaying) {
    if (!oscillators.length) { stopPlayback(); isPlaying = false; updateTransportUI(); }
    else restartPlayback();
  }
  renderOscList();
}

function updateOscProp(id, prop, value) {
  var osc = oscillators.find(function (o) { return o.id === id; });
  if (!osc) return;
  osc[prop] = value;

  if (isPlaying) {
    var live = liveNodes.find(function (n) { return n.id === id; });
    if (!live) return;
    var ctx = getAudioCtx();
    if (prop === 'gain' && !osc.muted) {
      live.gainNode.gain.setTargetAtTime(value, ctx.currentTime, 0.01);
    } else if (prop === 'freq') {
      live.osc.frequency.setTargetAtTime(value, ctx.currentTime, 0.01);
    } else if (prop === 'type') {
      live.osc.type = value;
    }
  }
}

// ── Mute controls ─────────────────────────────────────────────────────────────
function setMute(id, muted) {
  var osc = oscillators.find(function (o) { return o.id === id; });
  if (!osc) return;
  osc.muted = muted;
  if (isPlaying) {
    var live = liveNodes.find(function (n) { return n.id === id; });
    if (live) live.gainNode.gain.setTargetAtTime(muted ? 0 : osc.gain, getAudioCtx().currentTime, 0.02);
  }
  updateCardMute(id);
  updateVizMute(id);
}

function updateCardMute(id) {
  var osc = oscillators.find(function (o) { return o.id === id; });
  if (!osc) return;
  var card = document.querySelector('.osc-card[data-id="' + id + '"]');
  if (!card) return;
  card.classList.toggle('is-muted', osc.muted);
  var btn = card.querySelector('[data-action="toggle-mute"]');
  if (btn) {
    btn.textContent = osc.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    btn.className = 'icon-btn' + (osc.muted ? ' is-muted' : '');
    btn.title = osc.muted ? 'Unmute' : 'Mute';
  }
}

function toggleMute(id) {
  var osc = oscillators.find(function (o) { return o.id === id; });
  if (osc) setMute(id, !osc.muted);
}

function muteOthers(id) {
  oscillators.forEach(function (o) { setMute(o.id, o.id !== id); });
}

function unmuteAll() {
  oscillators.forEach(function (o) { setMute(o.id, false); });
}

// ── Harmonics ─────────────────────────────────────────────────────────────────
function addHarmonics(id) {
  var osc = oscillators.find(function (o) { return o.id === id; });
  if (!osc) return;
  var card = document.querySelector('.osc-card[data-id="' + id + '"]');
  var sel = card ? card.querySelector('[data-role="harmonics-select"]') : null;
  var instrument = sel ? sel.value : 'piano';
  var harmonics = SC.computeHarmonics(osc.freq, osc.gain, instrument);
  harmonics.forEach(function (h) { addOscillator(osc.type, h.freq, h.gain, osc.color); });
}

function addWithHarmonics() {
  var type = document.getElementById('addWave').value;
  var freq = getAddFreq();
  var inst = document.getElementById('addInstrument').value;
  var baseGain = 0.5;
  var color = SC.nextColor();
  addOscillator(type, freq, baseGain, color);
  var harmonics = SC.computeHarmonics(freq, baseGain, inst);
  harmonics.forEach(function (h) { addOscillator(type, h.freq, h.gain, color); });
}

// ── Wave rendering helpers ────────────────────────────────────────────────────
var wavePaths = {
  sine:     'M2,10 C5,1 9,1 12,10 C15,19 19,19 22,10 C25,1 29,1 32,10 C35,19 38,19 38,10',
  square:   'M2,15 L2,5 L13,5 L13,15 L13,5 L24,5 L24,15 L38,15',
  sawtooth: 'M2,15 L13,4 L13,15 L24,4 L24,15 L36,4',
};

function waveIcon(type) {
  return '<svg class="wave-icon" viewBox="0 0 40 20" fill="none" ' +
    'stroke="var(--cp-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="' + wavePaths[type] + '"/></svg>';
}

// ── Canvas utilities ──────────────────────────────────────────────────────────
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function waveTypeColor(o) {
  return o.color || '#e06090';
}

function drawOscWaveCanvas(o, canvas) {
  var W = 360, H = 64;
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');

  ctx.fillStyle = cssVar('--cp-bg-elevated');
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = cssVar('--cp-border');
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

  var amplitude = Math.max(o.gain, 0.05) * (H/2 - 5);
  var cycles = 6;
  var color = o.muted ? cssVar('--cp-border-strong') : waveTypeColor(o);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.beginPath();

  for (var px = 0; px <= W; px++) {
    var t = (px / W) * cycles;
    var v = 0;
    if      (o.type === 'sine')     v = Math.sin(2 * Math.PI * t);
    else if (o.type === 'square')   v = Math.sin(2 * Math.PI * t) >= 0 ? 1 : -1;
    else                            v = 2 * (t % 1) - 1;
    var y = H/2 - v * amplitude;
    px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
  }
  ctx.stroke();
}

// ── Master canvas animation ───────────────────────────────────────────────────
function startAnimation() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  if (!masterAnalyser) return;
  var canvas = document.getElementById('masterCanvas');
  if (!canvas) return;

  var dpr  = window.devicePixelRatio || 1;
  var cssW = canvas.clientWidth  || 600;
  var cssH = canvas.clientHeight || 180;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  var ctx2d = canvas.getContext('2d');
  ctx2d.scale(dpr, dpr);

  var sr = audioCtx ? audioCtx.sampleRate : 44100;
  var bufLen   = masterAnalyser.frequencyBinCount;
  var waveData = new Uint8Array(bufLen);
  var freqData = new Uint8Array(bufLen);

  function frame() {
    animFrame = requestAnimationFrame(frame);

    if (masterAnalyser.frequencyBinCount !== bufLen) {
      bufLen   = masterAnalyser.frequencyBinCount;
      waveData = new Uint8Array(bufLen);
      freqData = new Uint8Array(bufLen);
    }

    var bg        = cssVar('--cp-bg');
    var border    = cssVar('--cp-border');
    var accent    = cssVar('--cp-accent');
    var textMuted = cssVar('--cp-text-muted');

    ctx2d.clearRect(0, 0, cssW, cssH);
    ctx2d.fillStyle = bg;
    ctx2d.fillRect(0, 0, cssW, cssH);

    ctx2d.strokeStyle = border;
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(0, cssH/2); ctx2d.lineTo(cssW, cssH/2);
    ctx2d.stroke();
    ctx2d.globalAlpha = 0.35;
    ctx2d.beginPath();
    ctx2d.moveTo(0, cssH*0.25); ctx2d.lineTo(cssW, cssH*0.25);
    ctx2d.moveTo(0, cssH*0.75); ctx2d.lineTo(cssW, cssH*0.75);
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;

    if (vizMode === 'waveform') {
      // Compute base time window from lowest oscillator
      var activeOscs = oscillators.filter(function (o) { return !o.muted; });
      var drawOscs = activeOscs.length ? activeOscs : oscillators;
      var lowestFreq = drawOscs.length
        ? Math.min.apply(null, drawOscs.map(function (o) { return o.freq; }))
        : 440;
      var baseCycles  = 4;
      var baseTimeSpan = (baseCycles / lowestFreq);
      var timeSpan = baseTimeSpan / waveZoom;
      // Clamp pan so we never go negative or past a reasonable window
      var maxPan = Math.max(0, baseTimeSpan * 8 - timeSpan);
      wavePanSecs = Math.min(Math.max(wavePanSecs, 0), maxPan);
      var timeStart = wavePanSecs;

      // Draw each oscillator's mathematical waveform in its own color
      drawOscs.forEach(function (o) {
        var color = waveTypeColor(o);
        var amp = o.gain * (cssH / 2 - 8);
        ctx2d.strokeStyle = color;
        ctx2d.lineWidth = 1.6;
        ctx2d.globalAlpha = 0.75;
        ctx2d.lineJoin = 'round';
        ctx2d.beginPath();
        for (var px = 0; px <= cssW; px++) {
          var t = timeStart + (px / cssW) * timeSpan;
          var phase = t * o.freq;
          var v = 0;
          if      (o.type === 'sine')     v = Math.sin(2 * Math.PI * phase);
          else if (o.type === 'square')   v = Math.sin(2 * Math.PI * phase) >= 0 ? 1 : -1;
          else                            v = 2 * (phase % 1) - 1;
          var y = cssH / 2 - v * amp;
          px === 0 ? ctx2d.moveTo(px, y) : ctx2d.lineTo(px, y);
        }
        ctx2d.stroke();
      });
      ctx2d.globalAlpha = 1;

      // Combined analyser overlay (only when playing and no pan — buffer is live)
      if (wavePanSecs < timeSpan * 0.5) {
        masterAnalyser.smoothingTimeConstant = 0;
        masterAnalyser.getByteTimeDomainData(waveData);
        var samplesToShow = Math.min(Math.ceil(timeSpan * sr), bufLen);
        ctx2d.strokeStyle = cssVar('--cp-text');
        ctx2d.lineWidth = 1.2;
        ctx2d.globalAlpha = 0.25;
        ctx2d.beginPath();
        for (var i = 0; i < samplesToShow; i++) {
          var yw = (waveData[i] / 128.0) * cssH / 2;
          var xw = (i / samplesToShow) * cssW;
          i === 0 ? ctx2d.moveTo(xw, yw) : ctx2d.lineTo(xw, yw);
        }
        ctx2d.stroke();
        ctx2d.globalAlpha = 1;
      }

      // Zoom/pan indicator (shown when not at default view)
      var isDefaultView = Math.abs(waveZoom - 1) < 0.01 && wavePanSecs < 0.0001;
      if (!isDefaultView) {
        ctx2d.fillStyle = cssVar('--cp-text-muted');
        ctx2d.font = '9px Consolas,"Courier New",monospace';
        ctx2d.textAlign = 'right';
        var zoomLabel = waveZoom >= 1
          ? (Math.round(waveZoom * 10) / 10) + 'x'
          : (Math.round(1 / waveZoom * 10) / 10) + 'x out';
        ctx2d.fillText('\u00D7' + zoomLabel + '  ' + (wavePanSecs * 1000).toFixed(1) + 'ms', cssW - 6, 14);
        ctx2d.textAlign = 'left';
      }

    } else {
      // Spectrum (log-scale, dynamic range) — bars colored by nearest oscillator
      masterAnalyser.smoothingTimeConstant = 0.75;
      masterAnalyser.getByteFrequencyData(freqData);

      var refOscs = oscillators.filter(function (o) { return !o.muted; }).length
        ? oscillators.filter(function (o) { return !o.muted; })
        : oscillators;
      var specMinF, specMaxF;
      if (refOscs.length) {
        var loF = Math.min.apply(null, refOscs.map(function (o) { return o.freq; }));
        var hiF = Math.max.apply(null, refOscs.map(function (o) { return o.freq; }));
        specMinF = Math.max(20, loF / Math.SQRT2);
        specMaxF = Math.min(8000, hiF * Math.SQRT2);
        if (specMaxF / specMinF < 8) {
          var logMid = (Math.log2(specMinF) + Math.log2(specMaxF)) / 2;
          specMinF = Math.max(20, Math.pow(2, logMid - 1.5));
          specMaxF = Math.min(8000, Math.pow(2, logMid + 1.5));
        }
      } else {
        specMinF = 80; specMaxF = 2000;
      }

      var logMin = Math.log2(specMinF);
      var logMax = Math.log2(specMaxF);
      var chartTop    = 4;
      var chartBottom = cssH - 20;
      var chartH      = chartBottom - chartTop;
      var freqPerBin  = sr / masterAnalyser.fftSize;

      function fToX(f) { return (Math.log2(f) - logMin) / (logMax - logMin) * cssW; }

      // Pre-compute oscillator colors and log-frequencies for nearest-match
      var oscColors = refOscs.map(function (o) {
        return { logFreq: Math.log2(o.freq), color: waveTypeColor(o) };
      });

      function nearestOscColor(logF) {
        if (!oscColors.length) return accent;
        var best = oscColors[0];
        var bestDist = Math.abs(logF - best.logFreq);
        for (var k = 1; k < oscColors.length; k++) {
          var d = Math.abs(logF - oscColors[k].logFreq);
          if (d < bestDist) { best = oscColors[k]; bestDist = d; }
        }
        return best.color;
      }

      for (var j = 1; j < bufLen; j++) {
        var f = j * freqPerBin;
        if (f < specMinF || f > specMaxF) continue;
        var x1 = fToX(f);
        var x2 = fToX(Math.min((j + 1) * freqPerBin, specMaxF));
        var bw = Math.max(x2 - x1, 0.5);
        var tVal = freqData[j] / 255;
        if (tVal < 0.01) continue;
        ctx2d.globalAlpha = 0.25 + 0.75 * tVal;
        ctx2d.fillStyle = nearestOscColor(Math.log2(f));
        ctx2d.fillRect(x1, chartBottom - tVal * chartH, bw, tVal * chartH);
      }
      ctx2d.globalAlpha = 1;

      ctx2d.fillStyle = textMuted;
      ctx2d.font = '9px Consolas,"Courier New",monospace';
      ctx2d.textAlign = 'center';
      [32, 50, 65, 130, 220, 440, 880, 1760, 3520]
        .filter(function (f) { return f > specMinF && f < specMaxF; })
        .forEach(function (f) {
          var xp = fToX(f);
          var info = SC.freqToNoteInfo(f);
          var label = info && Math.abs(info.cents) < 5 ? info.label : (f < 1000 ? '' + f : f/1000 + 'k');
          ctx2d.fillText(label, xp, chartBottom + 13);
        });
      ctx2d.textAlign = 'left';
    }
  }
  frame();
}

function stopAnimation() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  drawIdleMasterCanvas();
}

function drawIdleMasterCanvas() {
  var canvas = document.getElementById('masterCanvas');
  if (!canvas) return;
  var cssW = canvas.clientWidth;
  if (!cssW) { requestAnimationFrame(drawIdleMasterCanvas); return; }

  var dpr  = window.devicePixelRatio || 1;
  var cssH = canvas.clientHeight || 150;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = cssVar('--cp-bg');
  ctx.fillRect(0, 0, cssW, cssH);

  // Grid lines
  ctx.strokeStyle = cssVar('--cp-border');
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, cssH/2); ctx.lineTo(cssW, cssH/2); ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(0, cssH*0.25); ctx.lineTo(cssW, cssH*0.25);
  ctx.moveTo(0, cssH*0.75); ctx.lineTo(cssW, cssH*0.75);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (!oscillators.length) {
    ctx.fillStyle  = cssVar('--cp-text-muted');
    ctx.font       = '13px "Segoe UI",Aptos,sans-serif';
    ctx.textAlign  = 'center';
    ctx.fillText('Add oscillators to see the waveform', cssW / 2, cssH / 2 + 5);
    ctx.textAlign  = 'left';
    return;
  }

  // Draw mathematical waveforms (same as animation loop, minus analyser overlay)
  var drawOscs = oscillators.filter(function (o) { return !o.muted; });
  if (!drawOscs.length) drawOscs = oscillators;
  var lowestFreq = Math.min.apply(null, drawOscs.map(function (o) { return o.freq; }));
  var baseTimeSpan = 4 / lowestFreq;
  var timeSpan = baseTimeSpan / waveZoom;
  var maxPan = Math.max(0, baseTimeSpan * 8 - timeSpan);
  wavePanSecs = Math.min(Math.max(wavePanSecs, 0), maxPan);
  var timeStart = wavePanSecs;

  drawOscs.forEach(function (o) {
    var amp = o.gain * (cssH / 2 - 8);
    ctx.strokeStyle = waveTypeColor(o);
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.75;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var px = 0; px <= cssW; px++) {
      var t = timeStart + (px / cssW) * timeSpan;
      var phase = t * o.freq;
      var v = 0;
      if      (o.type === 'sine')     v = Math.sin(2 * Math.PI * phase);
      else if (o.type === 'square')   v = Math.sin(2 * Math.PI * phase) >= 0 ? 1 : -1;
      else                            v = 2 * (phase % 1) - 1;
      ctx.lineTo(px, cssH / 2 - v * amp);
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // Zoom/pan indicator
  var isDefaultView = Math.abs(waveZoom - 1) < 0.01 && wavePanSecs < 0.0001;
  if (!isDefaultView) {
    ctx.fillStyle = cssVar('--cp-text-muted');
    ctx.font = '9px Consolas,"Courier New",monospace';
    ctx.textAlign = 'right';
    var zoomLabel = waveZoom >= 1
      ? (Math.round(waveZoom * 10) / 10) + 'x'
      : (Math.round(1 / waveZoom * 10) / 10) + 'x out';
    ctx.fillText('\u00D7' + zoomLabel + '  ' + (wavePanSecs * 1000).toFixed(1) + 'ms', cssW - 6, 14);
    ctx.textAlign = 'left';
  }
}

// ── Waveform zoom/pan interaction ─────────────────────────────────────────────
(function () {
  var canvas = document.getElementById('masterCanvas');
  var isDragging = false;
  var dragStartX = 0;
  var dragStartPan = 0;

  function getLowestFreq() {
    var active = oscillators.filter(function (o) { return !o.muted; });
    var pool = active.length ? active : oscillators;
    return pool.length ? Math.min.apply(null, pool.map(function (o) { return o.freq; })) : 440;
  }

  canvas.style.cursor = 'ew-resize';

  canvas.addEventListener('wheel', function (e) {
    if (vizMode !== 'waveform') return;
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mouseRatio = (e.clientX - rect.left) / rect.width; // 0..1
    var lowestFreq = getLowestFreq();
    var baseTimeSpan = 4 / lowestFreq;
    var oldTimeSpan = baseTimeSpan / waveZoom;
    var factor = Math.pow(1.12, -e.deltaY / 40);
    waveZoom = Math.min(Math.max(waveZoom * factor, 0.08), 64);
    var newTimeSpan = baseTimeSpan / waveZoom;
    // Keep the time at cursor position stationary
    var timeAtCursor = wavePanSecs + mouseRatio * oldTimeSpan;
    wavePanSecs = timeAtCursor - mouseRatio * newTimeSpan;
    if (!isPlaying) drawIdleMasterCanvas();
  }, { passive: false });

  canvas.addEventListener('mousedown', function (e) {
    if (vizMode !== 'waveform') return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartPan = wavePanSecs;
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', function (e) {
    if (!isDragging) return;
    var rect = canvas.getBoundingClientRect();
    var lowestFreq = getLowestFreq();
    var baseTimeSpan = 4 / lowestFreq;
    var timeSpan = baseTimeSpan / waveZoom;
    var dx = (e.clientX - dragStartX) / rect.width;
    wavePanSecs = dragStartPan - dx * timeSpan;
    if (!isPlaying) drawIdleMasterCanvas();
  });

  window.addEventListener('mouseup', function () {
    if (isDragging) { isDragging = false; canvas.style.cursor = 'ew-resize'; }
  });

  canvas.addEventListener('dblclick', function () {
    if (vizMode !== 'waveform') return;
    waveZoom = 1.0; wavePanSecs = 0.0;
    if (!isPlaying) drawIdleMasterCanvas();
  });

  // Touch support
  var touchStartX = 0, touchStartPan = 0, touchStartDist = 0, touchStartZoom = 1;
  canvas.addEventListener('touchstart', function (e) {
    if (vizMode !== 'waveform') return;
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartPan = wavePanSecs;
    } else if (e.touches.length === 2) {
      touchStartDist = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
      touchStartZoom = waveZoom;
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', function (e) {
    if (vizMode !== 'waveform') return;
    var rect = canvas.getBoundingClientRect();
    var lowestFreq = getLowestFreq();
    var baseTimeSpan = 4 / lowestFreq;
    if (e.touches.length === 1) {
      var dx = (e.touches[0].clientX - touchStartX) / rect.width;
      var timeSpan = baseTimeSpan / waveZoom;
      wavePanSecs = touchStartPan - dx * timeSpan;
    } else if (e.touches.length === 2) {
      var dist = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
      if (touchStartDist > 0) waveZoom = Math.min(Math.max(touchStartZoom * (dist / touchStartDist), 0.08), 64);
    }
    if (!isPlaying) drawIdleMasterCanvas();
    e.preventDefault();
  }, { passive: false });
})();

// ── Viz panel ─────────────────────────────────────────────────────────────────
function renderVizPanel() {
  var list = document.getElementById('oscVizList');
  if (!oscillators.length) {
    list.innerHTML = '<div class="no-osc-viz">Add oscillators to see their waveforms.</div>';
    return;
  }
  list.innerHTML = oscillators.map(function (o) {
    return '<div class="osc-viz-strip' + (o.muted ? ' is-muted' : '') + '" data-id="' + o.id + '" style="border-color:' + o.color + '">' +
      '<div class="osc-viz-dot" style="background:' + (o.muted ? '' : o.color) + '"></div>' +
      '<div class="osc-viz-info">' +
        '<div class="osc-viz-name">' + SC.waveShortName(o.type) + '</div>' +
        '<div class="osc-viz-label" id="vfreq-' + o.id + '">' + SC.freqDisplay(o.freq) + '</div>' +
      '</div>' +
      '<canvas class="osc-viz-canvas" id="viz-' + o.id + '"></canvas>' +
      '<div class="osc-gain-col" id="vgain-' + o.id + '">' + Math.round(o.gain * 100) + '%</div>' +
    '</div>';
  }).join('');

  oscillators.forEach(function (o) {
    var c = document.getElementById('viz-' + o.id);
    if (c) drawOscWaveCanvas(o, c);
  });
}

function updateVizStrip(id) {
  var osc = oscillators.find(function (o) { return o.id === id; });
  if (!osc) return;
  var fEl = document.getElementById('vfreq-' + id);
  var gEl = document.getElementById('vgain-' + id);
  if (fEl) fEl.textContent = SC.freqDisplay(osc.freq);
  if (gEl) gEl.textContent = Math.round(osc.gain * 100) + '%';
  var strip = document.querySelector('#oscVizList [data-id="' + id + '"]');
  if (strip) {
    strip.style.borderColor = osc.color;
    var dot = strip.querySelector('.osc-viz-dot');
    if (dot) dot.style.background = osc.muted ? '' : osc.color;
    var c = document.getElementById('viz-' + id);
    if (c) drawOscWaveCanvas(osc, c);
  }
}

function updateVizMute(id) {
  var osc = oscillators.find(function (o) { return o.id === id; });
  if (!osc) return;
  var strip = document.querySelector('#oscVizList [data-id="' + id + '"]');
  if (!strip) return;
  strip.classList.toggle('is-muted', osc.muted);
  var c = document.getElementById('viz-' + id);
  if (c) drawOscWaveCanvas(osc, c);
}

// ── Render oscillator list (left panel) ───────────────────────────────────────
function renderOscList() {
  var list  = document.getElementById('oscList');
  var label = document.getElementById('oscCountLabel');

  label.textContent = oscillators.length
    ? oscillators.length + ' oscillator' + (oscillators.length !== 1 ? 's' : '') : '';
  updateTransportUI();

  if (!oscillators.length) {
    list.innerHTML = '<div class="empty-state">No oscillators yet \u2014 add one above.</div>';
    renderVizPanel();
    return;
  }

  list.innerHTML = oscillators.map(function (o) {
    return '<div class="osc-card' + (o.muted ? ' is-muted' : '') + '" data-id="' + o.id + '" style="border-color:' + o.color + '">' +
      '<div class="osc-card-header">' +
        '<input type="color" class="osc-color-pick" data-action="change-color" data-id="' + o.id + '" value="' + o.color + '" title="Tone color" />' +
        '<div class="wave-badge">' + waveIcon(o.type) + '<span class="wave-label">' + SC.waveShortName(o.type) + '</span></div>' +
        '<select data-action="change-type" data-id="' + o.id + '">' +
          '<option value="sine"' + (o.type === 'sine' ? ' selected' : '') + '>Sine</option>' +
          '<option value="square"' + (o.type === 'square' ? ' selected' : '') + '>Square</option>' +
          '<option value="sawtooth"' + (o.type === 'sawtooth' ? ' selected' : '') + '>Saw</option>' +
        '</select>' +
        '<div class="osc-icon-btns">' +
          '<button class="icon-btn' + (o.muted ? ' is-muted' : '') + '" data-action="toggle-mute" data-id="' + o.id + '" title="' + (o.muted ? 'Unmute' : 'Mute') + '">' + (o.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A') + '</button>' +
          '<button class="icon-btn" data-action="solo" data-id="' + o.id + '" title="Solo (mute others)">S</button>' +
          '<button class="icon-btn is-danger" data-action="remove" data-id="' + o.id + '" title="Remove">\u2715</button>' +
        '</div>' +
      '</div>' +
      '<div class="osc-controls">' +
        '<div class="control-row">' +
          '<label>Freq</label>' +
          '<input type="range" min="20" max="8000" step="1" value="' + o.freq + '" data-action="slider" data-id="' + o.id + '" data-prop="freq" />' +
          '<span class="ctrl-val" id="freq-' + o.id + '">' + SC.freqDisplay(o.freq) + '</span>' +
        '</div>' +
        '<div class="control-row">' +
          '<label>Vol</label>' +
          '<input type="range" min="0" max="1" step="0.01" value="' + o.gain + '" data-action="slider" data-id="' + o.id + '" data-prop="gain" />' +
          '<span class="ctrl-val" id="gain-' + o.id + '">' + Math.round(o.gain * 100) + '%</span>' +
        '</div>' +
      '</div>' +
      '<div class="osc-harmonics-row">' +
        '<span>Harmonics:</span>' +
        '<select data-role="harmonics-select">' + instrumentOptions() + '</select>' +
        '<button class="btn-ghost" data-action="add-harmonics" data-id="' + o.id + '">+ Add</button>' +
      '</div>' +
    '</div>';
  }).join('');

  renderVizPanel();
  if (!isPlaying) drawIdleMasterCanvas();
}

// ── Event delegation on oscillator list ───────────────────────────────────────
(function () {
  var list = document.getElementById('oscList');

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = parseInt(btn.dataset.id);
    if (!isFinite(id)) return;
    var action = btn.dataset.action;
    if (action === 'toggle-mute')   toggleMute(id);
    else if (action === 'solo')     muteOthers(id);
    else if (action === 'remove')   removeOscillator(id);
    else if (action === 'add-harmonics') addHarmonics(id);
  });

  list.addEventListener('input', function (e) {
    var el = e.target;
    var action = el.dataset.action;
    var id = parseInt(el.dataset.id);
    if (!isFinite(id)) return;

    if (action === 'slider') {
      var prop = el.dataset.prop;
      var value = parseFloat(el.value);
      if (!prop) return;
      updateOscProp(id, prop, value);
      if (prop === 'freq') {
        var label = document.getElementById('freq-' + id);
        if (label) label.textContent = SC.freqDisplay(value);
      } else if (prop === 'gain') {
        var label = document.getElementById('gain-' + id);
        if (label) label.textContent = Math.round(value * 100) + '%';
      }
      updateVizStrip(id);
    } else if (action === 'change-color') {
      var color = el.value;
      var osc = oscillators.find(function (o) { return o.id === id; });
      if (osc) {
        osc.color = color;
        var card = el.closest('.osc-card');
        if (card) card.style.borderColor = color;
        updateVizStrip(id);
      }
    }
  });

  list.addEventListener('change', function (e) {
    var el = e.target;
    var action = el.dataset.action;
    var id = parseInt(el.dataset.id);
    if (!isFinite(id)) return;

    if (action === 'change-type') {
      var type = el.value;
      updateOscProp(id, 'type', type);
      var card = el.closest('.osc-card');
      if (card) {
        card.querySelector('.wave-badge').innerHTML =
          waveIcon(type) + '<span class="wave-label">' + SC.waveShortName(type) + '</span>';
      }
      updateVizStrip(id);
    } else if (action === 'change-color') {
      var color = el.value;
      var osc = oscillators.find(function (o) { return o.id === id; });
      if (osc) {
        osc.color = color;
        var card = el.closest('.osc-card');
        if (card) card.style.borderColor = color;
        updateVizStrip(id);
      }
    }
  });
})();

// ── Add form ──────────────────────────────────────────────────────────────────
function instrumentOptions() {
  return Object.keys(SC.INSTRUMENTS).map(function (k) {
    return '<option value="' + k + '">' + SC.INSTRUMENTS[k].name + '</option>';
  }).join('');
}

function buildNoteSelect() {
  var sel = document.getElementById('addNote');
  var groups = {};
  SC.ALL_NOTES.forEach(function (n) {
    var oct = n.label.replace(/[^0-9]/g, '');
    (groups[oct] = groups[oct] || []).push(n);
  });
  var html = '<option value="">\u2014 custom \u2014</option>';
  Object.keys(groups).sort().forEach(function (oct) {
    html += '<optgroup label="Octave ' + oct + '">';
    groups[oct].forEach(function (n) {
      var selected = n.label === 'A4' ? ' selected' : '';
      html += '<option value="' + n.freq.toFixed(3) + '"' + selected + '>' + n.label + ' (' + Math.round(n.freq) + ' Hz)</option>';
    });
    html += '</optgroup>';
  });
  sel.innerHTML = html;
  document.getElementById('customFreqInput').value = Math.round(SC.noteFreq('A', 4));
}

function syncNoteToFreq() {
  var v = document.getElementById('addNote').value;
  if (v) document.getElementById('customFreqInput').value = Math.round(parseFloat(v));
}

function syncFreqToNote() {
  var hz    = parseFloat(document.getElementById('customFreqInput').value);
  var sel   = document.getElementById('addNote');
  var match = SC.ALL_NOTES.find(function (n) { return Math.abs(n.freq - hz) < 0.5; });
  sel.value = match ? match.freq.toFixed(3) : '';
}

function getAddFreq() {
  var v = document.getElementById('addNote').value;
  if (v) return parseFloat(v);
  var n = parseFloat(document.getElementById('customFreqInput').value);
  return isNaN(n) ? 440 : n;
}

// ── Presets ───────────────────────────────────────────────────────────────────
function loadPresets() {
  try {
    var raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    return raw.map(SC.validatePreset).filter(Boolean);
  } catch (e) { return []; }
}

function savePresetsToStorage(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function savePreset() {
  var nameEl = document.getElementById('presetNameInput');
  var name   = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  if (!oscillators.length) { alert('Add at least one oscillator first.'); return; }
  var presets = loadPresets();
  var idx = presets.findIndex(function (p) { return p.name === name; });
  var entry = { name: name, oscillators: oscillators.map(function (o) { return { type: o.type, freq: o.freq, gain: o.gain, color: o.color }; }) };
  if (idx >= 0) presets[idx] = entry; else presets.unshift(entry);
  savePresetsToStorage(presets);
  nameEl.value = '';
  renderPresets();
}

function loadPreset(name) {
  var p = loadPresets().find(function (pr) { return pr.name === name; });
  if (!p) return;
  if (isPlaying) { stopPlayback(); isPlaying = false; updateTransportUI(); }
  oscillators = []; nextId = 1;
  SC.resetPaletteIndex();
  p.oscillators.forEach(function (o) { addOscillator(o.type, o.freq, o.gain, o.color); });
}

function addPreset(name) {
  var p = loadPresets().find(function (pr) { return pr.name === name; });
  if (!p) return;
  p.oscillators.forEach(function (o) { addOscillator(o.type, o.freq, o.gain, o.color); });
}

function deletePreset(name) {
  savePresetsToStorage(loadPresets().filter(function (p) { return p.name !== name; }));
  renderPresets();
}

function renderPresets() {
  var list    = document.getElementById('presetList');
  var presets = loadPresets();
  if (!presets.length) { list.innerHTML = '<div class="no-presets">No saved presets.</div>'; return; }
  list.innerHTML = presets.map(function (p, i) {
    return '<div class="preset-row">' +
      '<span class="preset-name">' + SC.escHtml(p.name) + '</span>' +
      '<span class="preset-meta">' + p.oscillators.length + ' osc</span>' +
      '<button class="btn-ghost" data-action="load" data-idx="' + i + '">Load</button>' +
      '<button class="btn-add" data-action="add" data-idx="' + i + '">Add</button>' +
      '<button class="btn-danger" data-action="delete" data-idx="' + i + '">Delete</button>' +
    '</div>';
  }).join('');
}

document.getElementById('presetList').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var presets = loadPresets();
  var preset  = presets[parseInt(btn.dataset.idx)];
  if (!preset) return;
  if (btn.dataset.action === 'load')   loadPreset(preset.name);
  if (btn.dataset.action === 'add')    addPreset(preset.name);
  if (btn.dataset.action === 'delete') deletePreset(preset.name);
});

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetAll() {
  if (!oscillators.length) return;
  if (!confirm('Remove all oscillators?')) return;
  if (isPlaying) { stopPlayback(); isPlaying = false; updateTransportUI(); }
  oscillators = []; nextId = 1;
  SC.resetPaletteIndex();
  renderOscList();
}

// ── Viz mode tabs ─────────────────────────────────────────────────────────────
document.querySelectorAll('.viz-tab').forEach(function (btn) {
  btn.addEventListener('click', function () {
    vizMode = btn.dataset.mode;
    document.querySelectorAll('.viz-tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
    if (!isPlaying) drawIdleMasterCanvas();
  });
});

// ── Wire top-level events ─────────────────────────────────────────────────────
document.getElementById('playBtn').addEventListener('click', togglePlay);
document.getElementById('addWithHarmonicsBtn').addEventListener('click', addWithHarmonics);
document.getElementById('addOscBtn').addEventListener('click', function () {
  addOscillator(document.getElementById('addWave').value, getAddFreq(), 0.5);
});
document.getElementById('addNote').addEventListener('change', syncNoteToFreq);
document.getElementById('customFreqInput').addEventListener('input', syncFreqToNote);
document.getElementById('resetBtn').addEventListener('click', resetAll);
document.getElementById('unmuteAllBtn').addEventListener('click', unmuteAll);
document.getElementById('savePresetBtn').addEventListener('click', savePreset);
document.getElementById('presetNameInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') savePreset(); });

window.addEventListener('resize', function () { if (!isPlaying) drawIdleMasterCanvas(); });

// ── Init ──────────────────────────────────────────────────────────────────────
buildNoteSelect();
renderOscList();
renderPresets();
requestAnimationFrame(function () { drawIdleMasterCanvas(); renderVizPanel(); });
