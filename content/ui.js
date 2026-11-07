(function () {
  'use strict';
  const YTPS = globalThis.YTPS;

  const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const W = 448, SPEC_H = 180, PIANO_H = 24, CHROMA_H = 56, EQ_H = 64;
  const DB_MIN = -100, DB_MAX = -20;
  const MIDI_LO = 20.5, MIDI_SPAN = 88; // A0..C8, one column per key
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const PRESETS = {
    Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    'Bass cut': [-12, -10, -7, -4, -1, 0, 0, 0, 0, 0],
    'Treble boost': [0, 0, 0, 0, 0, 0, 1, 3, 5, 6],
    Vocal: [-3, -3, -2, 0, 2, 3, 3, 2, 0, -1],
    Smile: [5, 4, 2, 0, -1, -2, -1, 1, 3, 5],
    'Karaoke-ish (cut mids)': [0, 0, 0, -2, -6, -8, -6, -2, 0, 0],
  };

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
  const noteName = (m) => NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const fmtSemi = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
  const fmtDb = (d) => (d > 0 ? '+' : '') + d.toFixed(1) + ' dB';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel { position: fixed; width: ${W + 24}px; max-height: calc(100vh - 16px); overflow: auto;
    background: rgba(18,18,20,.97); color: #e8e8ea; border: 1px solid #333; border-radius: 12px;
    font: 12px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 12px 40px rgba(0,0,0,.55); user-select: none; scrollbar-width: thin; }
  .hdr { display:flex; align-items:center; gap:8px; padding:8px 10px; cursor: grab; border-bottom:1px solid #2a2a2e;
    position: sticky; top: 0; background: rgba(18,18,20,.98); z-index: 2; border-radius: 12px 12px 0 0; }
  .hdr:active { cursor: grabbing; }
  .title { font-weight: 600; font-size: 13px; flex: 1; white-space: nowrap; }
  .title b { color: #ff5470; }
  .dot { width:8px; height:8px; border-radius:50%; background:#666; flex: none; }
  .dot.running { background:#3ddc84; } .dot.suspended { background:#f5a623; }
  button, select { font: inherit; color: inherit; background:#26262b; border:1px solid #3a3a40; border-radius:6px; padding:3px 8px; cursor:pointer; }
  button:hover, select:hover { background:#303036; }
  button.on { background:#ff5470; border-color:#ff5470; color:#fff; }
  button.icon { width:26px; padding:3px 0; }
  .body { padding: 4px 12px 12px; }
  .sec { margin-top: 10px; }
  .sec > .st { display:flex; align-items:center; gap:6px; font-size:11px; text-transform:uppercase; letter-spacing:.08em;
    color:#9a9aa3; margin-bottom:6px; cursor:pointer; }
  .sec > .st::before { content:'▾'; font-size:10px; }
  .sec.closed > .st::before { content:'▸'; }
  .sec.closed > .sc { display:none; }
  .st .sp { flex:1; }
  .row { display:flex; align-items:center; gap:8px; margin: 4px 0; }
  .grow { flex: 1; }
  input[type=range] { accent-color: #ff5470; min-width: 0; }
  .big { font-size: 22px; font-weight: 700; min-width: 74px; text-align:center; font-variant-numeric: tabular-nums; }
  .muted { color:#8d8d96; font-size: 11px; }
  .lbl { min-width: 64px; color:#b8b8c0; }
  .val { min-width: 58px; text-align:right; font-variant-numeric: tabular-nums; }
  canvas { display:block; border-radius:6px; background:#0c0c0e; }
  .chips { display:flex; flex-wrap:wrap; gap:4px; min-height: 22px; }
  .chip { background:#26262b; border-radius: 10px; padding: 2px 8px; font-variant-numeric: tabular-nums; }
  .chip.top { background:#ff5470; color:#fff; }
  .eqbands { display:flex; justify-content:space-between; margin-top:4px; }
  .band { display:flex; flex-direction:column; align-items:center; width: 40px; gap:2px; }
  .band input { writing-mode: vertical-lr; direction: rtl; height: 96px; width: 22px; }
  .band span { font-size: 10px; color:#9a9aa3; font-variant-numeric: tabular-nums; }
  .meter { position:relative; height: 12px; background:#0c0c0e; border-radius: 6px; overflow:hidden; flex:1; }
  .meter > div { position:absolute; top:0; bottom:0; left:0; background: linear-gradient(90deg,#3ddc84,#f5d623 75%,#ff5470); }
  .meter > i { position:absolute; top:-2px; bottom:-2px; width:2px; background:#fff; }
  .warn { background:#3a2c10; border:1px solid #f5a623; color:#ffd58a; border-radius:8px; padding:6px 8px; margin-top:8px; display:flex; gap:8px; align-items:center; }
  .hidden { display:none !important; }
  label.ck { display:flex; align-items:center; gap:5px; cursor:pointer; }
  .toast { position: fixed; left: 50%; top: 72px; transform: translateX(-50%); background: rgba(18,18,20,.92);
    color:#fff; font: 600 18px system-ui, sans-serif; padding: 10px 18px; border-radius: 10px; pointer-events:none;
    opacity: 0; transition: opacity .25s; }
  .toast.show { opacity: 1; }
  .collapsed .body { display:none; }
  `;

  class Panel {
    constructor({ settings, engine, update, onShow }) {
      this.s = settings;
      this.engine = engine;
      this.update = update;
      this.onShow = onShow;
      this.visible = false;
      this.frozen = false;
      this.dpr = Math.max(1, window.devicePixelRatio || 1);
      this.chromaDisp = new Float64Array(12);
      this.keyAcc = new Float64Array(12);
      this._build();
    }

    // ---------- construction ----------
    _build() {
      this.host = h('div', { id: 'ytps-host', style: 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;' });
      const root = (this.root = this.host.attachShadow({ mode: 'closed' }));
      const style = document.createElement('style');
      style.textContent = CSS;
      root.append(style);
      // keep YouTube's keyboard shortcuts away from our sliders
      for (const ev of ['keydown', 'keyup', 'keypress']) this.host.addEventListener(ev, (e) => e.stopPropagation());

      const s = this.s;
      const r = (this.refs = {});

      // header
      r.dot = h('span', { class: 'dot', title: 'Audio engine status' });
      r.hdrPitch = h('span', { class: 'muted' });
      r.bypass = h('button', { class: 'icon', title: 'Bypass all processing', onclick: () => this.update({ bypass: !this.s.bypass }) }, '⏻');
      r.min = h('button', { class: 'icon', title: 'Collapse', onclick: () => this.panel.classList.toggle('collapsed') }, '–');
      const close = h('button', { class: 'icon', title: 'Close (Alt+Shift+Y)', onclick: () => this.hide() }, '×');
      const hdr = h('div', { class: 'hdr' }, r.dot, h('span', { class: 'title' }, h('b', {}, '♪ '), 'YT Pitch & Spectrum'), r.hdrPitch, r.bypass, r.min, close);
      this._drag(hdr);

      // activation warning
      r.warn = h('div', { class: 'warn hidden' },
        h('span', { class: 'grow' }, 'Firefox is holding audio until you interact with the page.'),
        h('button', { onclick: () => this.engine.ctx && this.engine.ctx.resume() }, 'Start audio'));
      r.err = h('div', { class: 'warn hidden' });

      // ---- pitch
      r.semi = h('input', { type: 'range', min: -12, max: 12, step: 1, class: 'grow', oninput: (e) => this.update({ semitones: +e.target.value }) });
      r.semiVal = h('div', { class: 'big' });
      r.cents = h('input', { type: 'range', min: -50, max: 50, step: 1, class: 'grow', oninput: (e) => this.update({ cents: +e.target.value }) });
      r.centsVal = h('span', { class: 'val' });
      r.quality = h('select', { onchange: (e) => this.update({ quality: e.target.value }), title: 'Larger FFT = smoother tone, more latency' },
        h('option', { value: 'fast' }, 'Fast (~21 ms)'), h('option', { value: 'normal' }, 'Normal (~43 ms)'), h('option', { value: 'high' }, 'High (~85 ms)'));
      r.engineInfo = h('span', { class: 'muted grow' });
      const step = (d) => this.update({ semitones: Math.max(-12, Math.min(12, this.s.semitones + d)) });
      const pitchSec = this._section('pitch', 'Pitch', [
        h('div', { class: 'row' },
          h('button', { onclick: () => step(-1), title: 'Alt+Shift+Down' }, '− 1'),
          r.semiVal,
          h('button', { onclick: () => step(1), title: 'Alt+Shift+Up' }, '+ 1'),
          r.semi),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Fine tune'), r.cents, r.centsVal),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Quality'), r.quality, r.engineInfo,
          h('button', { onclick: () => this.update({ semitones: 0, cents: 0 }) }, 'Reset')),
      ]);

      // ---- vocals
      r.vmodes = ['off', 'remove', 'isolate'].map((m) => h('button', { onclick: () => this.update({ vocalMode: m }) },
        { off: 'Off', remove: 'Remove vocals', isolate: 'Isolate vocals' }[m]));
      r.vStrength = h('input', { type: 'range', min: 0, max: 100, step: 1, class: 'grow', oninput: (e) => this.update({ vocalStrength: +e.target.value / 100 }) });
      r.vStrengthVal = h('span', { class: 'val' });
      r.vLow = h('input', { type: 'range', min: 0, max: 400, step: 10, class: 'grow', oninput: (e) => this.update({ vocalLowHz: +e.target.value }) });
      r.vLowVal = h('span', { class: 'val' });
      r.vHigh = h('input', { type: 'range', min: 2000, max: 16000, step: 500, class: 'grow', oninput: (e) => this.update({ vocalHighHz: +e.target.value }) });
      r.vHighVal = h('span', { class: 'val' });
      r.vInfo = h('div', { class: 'muted' });
      const vocalSec = this._section('vocal', 'Vocals', [
        h('div', { class: 'row' }, r.vmodes, h('span', { class: 'muted grow', style: 'text-align:right' }, 'Alt+Shift+V')),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Strength'), r.vStrength, r.vStrengthVal),
        h('div', { class: 'row', title: 'Bass and kick are usually centred too – leave everything below this alone' },
          h('span', { class: 'lbl' }, 'Keep below'), r.vLow, r.vLowVal),
        h('div', { class: 'row', title: 'Leave cymbals / air above this alone' }, h('span', { class: 'lbl' }, 'Keep above'), r.vHigh, r.vHighVal),
        r.vInfo,
      ]);

      // ---- spectrum
      r.spec = this._canvas(W, SPEC_H + PIANO_H);
      r.chroma = this._canvas(W, CHROMA_H);
      r.chips = h('div', { class: 'chips grow' });
      r.key = h('div', { class: 'muted' });
      r.freeze = h('button', { onclick: () => { this.frozen = !this.frozen; r.freeze.classList.toggle('on', this.frozen); } }, 'Freeze');
      const specSec = this._section('spectrum', 'Spectrum & notes', [
        r.spec.el,
        h('div', { class: 'row' }, r.chips, r.freeze),
        r.chroma.el,
        h('div', { class: 'row' }, r.key),
      ]);

      // ---- EQ
      r.eqCurve = this._canvas(W, EQ_H);
      r.bands = YTPS.BANDS.map((f, i) => {
        const inp = h('input', { type: 'range', min: -12, max: 12, step: 0.5, oninput: (e) => {
          const eq = this.s.eq.slice(); eq[i] = +e.target.value; this.update({ eq });
        }, ondblclick: () => { const eq = this.s.eq.slice(); eq[i] = 0; this.update({ eq }); } });
        const val = h('span', {});
        const el = h('div', { class: 'band', title: 'Double-click to reset' }, val, inp, h('span', {}, f >= 1000 ? f / 1000 + 'k' : f));
        return { inp, val, el };
      });
      r.preset = h('select', { onchange: (e) => { if (PRESETS[e.target.value]) this.update({ eq: PRESETS[e.target.value].slice() }); } },
        h('option', { value: '' }, 'Preset…'), Object.keys(PRESETS).map((k) => h('option', { value: k }, k)));
      const eqSec = this._section('eq', 'Equaliser', [
        r.eqCurve.el,
        h('div', { class: 'eqbands' }, r.bands.map((b) => b.el)),
        h('div', { class: 'row' }, r.preset, h('span', { class: 'grow' }), h('button', { onclick: () => this.update({ eq: PRESETS.Flat.slice() }) }, 'Flat')),
      ]);

      // ---- loudness
      r.gain = h('input', { type: 'range', min: -24, max: 24, step: 0.5, class: 'grow', oninput: (e) => this.update({ gainDb: +e.target.value }), ondblclick: () => this.update({ gainDb: 0 }) });
      r.gainVal = h('span', { class: 'val' });
      r.comp = h('input', { type: 'checkbox', onchange: (e) => this.update({ compressor: e.target.checked }) });
      r.auto = h('input', { type: 'checkbox', onchange: (e) => this.update({ autoLevel: e.target.checked }) });
      r.target = h('select', { onchange: (e) => this.update({ targetLufs: +e.target.value }) },
        [-23, -18, -16, -14, -11, -9].map((v) => h('option', { value: v }, v + ' LUFS')));
      r.meterFill = h('div', {});
      r.meterTick = h('i', {});
      r.meterText = h('span', { class: 'val', style: 'min-width:92px' });
      r.loudInfo = h('div', { class: 'muted' });
      const loudSec = this._section('loud', 'Loudness', [
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Gain'), r.gain, r.gainVal),
        h('div', { class: 'row' },
          h('label', { class: 'ck', title: 'Gentle 4:1 compressor – evens out quiet and loud parts' }, r.comp, 'Compressor'),
          h('label', { class: 'ck', style: 'margin-left:10px', title: 'Slowly adjusts gain so every video plays at the same loudness' }, r.auto, 'Auto-level to'),
          r.target),
        h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Output'),
          h('div', { class: 'meter', title: 'Momentary loudness (bar) and short-term peak (tick), −40…0 LUFS' }, r.meterFill, r.meterTick), r.meterText),
        r.loudInfo,
      ]);

      this.panel = h('div', { class: 'panel' }, hdr, h('div', { class: 'body' }, r.warn, r.err, pitchSec, vocalSec, specSec, eqSec, loudSec));
      this.toastEl = h('div', { class: 'toast' });
      root.append(this.panel, this.toastEl);
      this._place();
      this.sync();
    }

    _section(id, title, kids) {
      const collapsed = (this.s.collapsed || {})[id];
      const sec = h('div', { class: 'sec' + (collapsed ? ' closed' : '') });
      const head = h('div', { class: 'st', onclick: () => {
        sec.classList.toggle('closed');
        this.update({ collapsed: Object.assign({}, this.s.collapsed, { [id]: sec.classList.contains('closed') }) });
      } }, title, h('span', { class: 'sp' }));
      sec.append(head, h('div', { class: 'sc' }, kids));
      return sec;
    }

    _canvas(w, hgt) {
      const el = h('canvas', { width: w * this.dpr, height: hgt * this.dpr, style: `width:${w}px;height:${hgt}px` });
      const c = el.getContext('2d');
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      return { el, c, w, h: hgt };
    }

    _drag(handle) {
      let sx, sy, ox, oy, on = false;
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        on = true; sx = e.clientX; sy = e.clientY;
        const r = this.panel.getBoundingClientRect(); ox = r.left; oy = r.top;
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener('pointermove', (e) => {
        if (!on) return;
        this._setPos(ox + e.clientX - sx, oy + e.clientY - sy);
      });
      handle.addEventListener('pointerup', () => {
        if (!on) return;
        on = false;
        const r = this.panel.getBoundingClientRect();
        this.update({ panelPos: { x: Math.round(r.left), y: Math.round(r.top) } });
      });
    }
    _setPos(x, y) {
      const pw = W + 24;
      x = Math.max(0, Math.min(window.innerWidth - pw, x));
      y = Math.max(0, Math.min(window.innerHeight - 40, y));
      this.panel.style.left = x + 'px';
      this.panel.style.top = y + 'px';
    }
    _place() {
      const p = this.s.panelPos;
      if (p && typeof p.x === 'number') this._setPos(p.x, p.y);
      else this._setPos(window.innerWidth - (W + 24) - 16, 72);
    }

    // ---------- visibility ----------
    mount() {
      const parent = document.fullscreenElement || document.documentElement;
      if (this.host.parentNode !== parent) parent.appendChild(this.host);
    }
    show() {
      this.mount();
      this.panel.classList.remove('hidden');
      this.visible = true;
      this._place();
      this.onShow && this.onShow();
      if (!this.raf) this.raf = requestAnimationFrame(() => this._loop());
    }
    hide() { this.visible = false; this.panel.classList.add('hidden'); }
    toggle() { this.visible ? this.hide() : this.show(); }

    toast(text) {
      this.mount();
      this.toastEl.textContent = text;
      this.toastEl.classList.add('show');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => this.toastEl.classList.remove('show'), 1100);
    }

    // ---------- state → controls ----------
    sync() {
      const s = this.s, r = this.refs;
      r.semi.value = s.semitones;
      r.semiVal.textContent = fmtSemi(s.semitones) + ' st';
      r.cents.value = s.cents;
      r.centsVal.textContent = (s.cents > 0 ? '+' : '') + s.cents + ' ¢';
      r.quality.value = s.quality;
      r.hdrPitch.textContent = s.semitones || s.cents ? `${fmtSemi(s.semitones)} st${s.cents ? ` ${s.cents > 0 ? '+' : ''}${s.cents}¢` : ''}` : '';
      r.bypass.classList.toggle('on', !!s.bypass);
      r.bypass.title = s.bypass ? 'Processing bypassed – click to enable' : 'Bypass all processing';
      r.vmodes.forEach((b, i) => b.classList.toggle('on', ['off', 'remove', 'isolate'][i] === s.vocalMode && i > 0));
      r.vStrength.value = Math.round(s.vocalStrength * 100);
      r.vStrengthVal.textContent = Math.round(s.vocalStrength * 100) + ' %';
      r.vLow.value = s.vocalLowHz;
      r.vLowVal.textContent = s.vocalLowHz ? s.vocalLowHz + ' Hz' : 'off';
      r.vHigh.value = s.vocalHighHz;
      r.vHighVal.textContent = (s.vocalHighHz / 1000).toFixed(1) + ' kHz';
      if (r.hdrPitch.textContent || s.vocalMode !== 'off') {
        r.hdrPitch.textContent = [r.hdrPitch.textContent, { remove: 'no vox', isolate: 'vox only' }[s.vocalMode]].filter(Boolean).join(' · ');
      }
      r.bands.forEach((b, i) => { b.inp.value = s.eq[i]; b.val.textContent = (s.eq[i] > 0 ? '+' : '') + s.eq[i]; });
      r.gain.value = s.gainDb;
      r.gainVal.textContent = fmtDb(s.gainDb);
      r.comp.checked = s.compressor;
      r.auto.checked = s.autoLevel;
      r.target.value = s.targetLufs;
      r.preset.value = '';
      this._drawEq();
    }

    // ---------- drawing ----------
    _loop() {
      if (!this.visible) { this.raf = 0; return; }
      try { this._frame(); } catch (e) { /* keep animating */ }
      this.raf = requestAnimationFrame(() => this._loop());
    }

    _frame() {
      const st = this.engine.status();
      const r = this.refs;
      r.dot.className = 'dot ' + st.state;
      r.warn.classList.toggle('hidden', st.state !== 'suspended');
      r.err.classList.toggle('hidden', !st.error);
      if (st.error) r.err.textContent = st.error;
      r.engineInfo.textContent = st.kind ? st.kind : '';
      if (this.panel.classList.contains('collapsed')) return;
      const an = this.engine.analyser;
      if (an && st.state === 'running') this._drawSpectrum(an, st.sampleRate);
      this._drawLoudness(st);
      this._drawVocalInfo(st);
    }

    _drawVocalInfo(st) {
      const now = performance.now();
      if (now - (this._vocT || 0) < 400) return;
      this._vocT = now;
      const v = st.vocal, el = this.refs.vInfo;
      if (this.s.vocalMode === 'off') { el.textContent = 'Removes what is identical in both speakers (where lead vocals usually sit). Works best on studio stereo mixes.'; el.style.color = ''; return; }
      if (!v || !(v.level > 1e-3)) { el.textContent = 'Waiting for audio…'; el.style.color = ''; return; }
      if (v.corr > 0.97) {
        el.textContent = '⚠ This audio is (nearly) mono – there is no stereo difference to separate the voice from the band.';
        el.style.color = '#ffd58a';
        return;
      }
      el.style.color = '';
      const pct = Math.round(Math.pow(10, v.centreDb / 10) * 100);
      el.textContent = `Centre content found: ~${pct}% of the energy · stereo correlation ${v.corr.toFixed(2)}`;
    }

    _drawSpectrum(an, sr) {
      const n = an.frequencyBinCount;
      if (!this.freq || this.freq.length !== n || this._sr !== sr) {
        this.freq = new Float32Array(n);
        this._sr = sr;
        const binHz = sr / an.fftSize;
        this.binHz = binHz;
        this.col = new Float32Array(W + 1);
        for (let x = 0; x <= W; x++) this.col[x] = midiToFreq(MIDI_LO + (MIDI_SPAN * x) / W) / binHz;
        this.hold = new Float32Array(W).fill(-200);
        this.binPc = new Int8Array(n).fill(-1);
        for (let k = 1; k < n; k++) {
          const f = k * binHz;
          if (f < 50 || f > 4200) continue;
          const m = freqToMidi(f), rm = Math.round(m);
          if (Math.abs(m - rm) < 0.35) this.binPc[k] = ((rm % 12) + 12) % 12;
        }
      }
      if (!this.frozen) an.getFloatFrequencyData(this.freq);
      const fr = this.freq, { c } = this.refs.spec;
      const yOf = (v) => SPEC_H * (1 - (Math.max(DB_MIN, Math.min(DB_MAX, v)) - DB_MIN) / (DB_MAX - DB_MIN));

      c.clearRect(0, 0, W, SPEC_H + PIANO_H);
      // grid
      c.font = '10px system-ui, sans-serif';
      c.lineWidth = 1;
      for (let db = DB_MIN + 20; db < DB_MAX; db += 20) {
        const y = Math.round(yOf(db)) + 0.5;
        c.strokeStyle = '#1d1d22'; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
        c.fillStyle = '#4a4a52'; c.fillText(db + ' dB', W - 40, y - 2);
      }
      for (let oct = 1; oct <= 8; oct++) {
        const m = 12 * (oct + 1);
        const x = Math.round(((m - MIDI_LO) / MIDI_SPAN) * W) + 0.5;
        c.strokeStyle = '#26262c'; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, SPEC_H); c.stroke();
        c.fillStyle = '#5a5a63'; c.fillText('C' + oct, x + 2, 11);
      }

      // spectrum curve: max over bins per column (interpolated where columns are narrower than a bin)
      const ys = new Float32Array(W);
      for (let x = 0; x < W; x++) {
        const b0 = this.col[x], b1 = this.col[x + 1];
        let v;
        if (b1 - b0 < 1) {
          const b = (b0 + b1) / 2, i = Math.floor(b), t = b - i;
          v = fr[i] * (1 - t) + fr[Math.min(n - 1, i + 1)] * t;
        } else {
          v = -Infinity;
          for (let i = Math.floor(b0), e = Math.min(n - 1, Math.ceil(b1)); i <= e; i++) if (fr[i] > v) v = fr[i];
        }
        if (!isFinite(v)) v = DB_MIN;
        ys[x] = v;
        this.hold[x] = Math.max(v, this.hold[x] - 0.35);
      }
      const grad = c.createLinearGradient(0, 0, 0, SPEC_H);
      grad.addColorStop(0, 'rgba(255,84,112,.85)');
      grad.addColorStop(1, 'rgba(120,60,255,.25)');
      c.beginPath(); c.moveTo(0, SPEC_H);
      for (let x = 0; x < W; x++) c.lineTo(x + 0.5, yOf(ys[x]));
      c.lineTo(W, SPEC_H); c.closePath();
      c.fillStyle = grad; c.fill();
      c.beginPath();
      for (let x = 0; x < W; x++) (x ? c.lineTo : c.moveTo).call(c, x + 0.5, yOf(this.hold[x]));
      c.strokeStyle = 'rgba(255,255,255,.35)'; c.stroke();

      // peaks → notes
      const peaks = this._peaks(fr);
      const kw = W / MIDI_SPAN, py = SPEC_H;
      for (let i = 0; i < 88; i++) {
        const pc = (21 + i) % 12;
        c.fillStyle = BLACK.has(pc) ? '#1b1b20' : '#d9d9de';
        c.fillRect(i * kw + 0.5, py + 1, kw - 1, BLACK.has(pc) ? PIANO_H * 0.62 : PIANO_H - 1);
      }
      const top = peaks.length ? peaks[0].db : 0;
      for (const p of peaks) {
        const i = p.note - 21;
        if (i < 0 || i >= 88) continue;
        const a = Math.max(0.25, 1 - (top - p.db) / 30);
        c.fillStyle = `rgba(255,84,112,${a})`;
        c.fillRect(i * kw, py, kw, PIANO_H);
        const x = ((p.midi - MIDI_LO) / MIDI_SPAN) * W;
        c.fillStyle = '#fff';
        c.fillText(noteName(p.note), Math.min(W - 26, x - 8), Math.max(22, yOf(p.db) - 4));
      }

      // chips (throttled so they're readable)
      const now = performance.now();
      if (!this.frozen && now - (this._chipT || 0) > 150) {
        this._chipT = now;
        const chips = this.refs.chips;
        chips.textContent = '';
        if (!peaks.length) chips.append(h('span', { class: 'muted' }, 'No clear tones'));
        peaks.forEach((p, i) => chips.append(h('span', { class: 'chip' + (i === 0 ? ' top' : ''), title: p.f.toFixed(1) + ' Hz' },
          `${noteName(p.note)} ${p.cents >= 0 ? '+' : ''}${p.cents}¢`)));
      }

      this._chroma(fr, peaks.length > 0);
    }

    _peaks(fr) {
      const binHz = this.binHz, n = fr.length;
      const lo = Math.max(3, Math.floor(40 / binHz)), hi = Math.min(n - 3, Math.ceil(4300 / binHz));
      let max = -Infinity;
      for (let i = lo; i <= hi; i++) if (fr[i] > max) max = fr[i];
      const thr = Math.max(max - 30, -85);
      const pk = [];
      for (let i = lo; i <= hi; i++) {
        const v = fr[i];
        if (v < thr || !(v > fr[i - 1] && v >= fr[i + 1] && v > fr[i - 2] && v >= fr[i + 2])) continue;
        const a = fr[i - 1], c = fr[i + 1], d = a - 2 * v + c;
        const p = d !== 0 ? (0.5 * (a - c)) / d : 0;
        pk.push({ f: (i + p) * binHz, db: v - 0.25 * (a - c) * p });
      }
      pk.sort((x, y) => y.db - x.db);
      const seen = new Set(), out = [];
      for (const p of pk) {
        const m = freqToMidi(p.f), r = Math.round(m);
        if (seen.has(r)) continue;
        seen.add(r);
        out.push({ ...p, midi: m, note: r, cents: Math.round((m - r) * 100) });
        if (out.length >= 7) break;
      }
      return out;
    }

    _chroma(fr, hasSignal) {
      const ch = new Float64Array(12), pcs = this.binPc;
      for (let k = 0; k < fr.length; k++) {
        const pc = pcs[k];
        if (pc < 0) continue;
        const v = fr[k];
        if (v > -95) ch[pc] += Math.pow(10, v / 20);
      }
      let mx = 0, sum = 0;
      for (const v of ch) { mx = Math.max(mx, v); sum += v; }
      if (!this.frozen) {
        for (let i = 0; i < 12; i++) {
          this.chromaDisp[i] = this.chromaDisp[i] * 0.7 + (mx > 0 ? ch[i] / mx : 0) * 0.3;
          if (hasSignal && sum > 0) this.keyAcc[i] = this.keyAcc[i] * 0.996 + (ch[i] / sum) * 0.004;
        }
      }
      const key = this._key();
      const { c } = this.refs.chroma;
      c.clearRect(0, 0, W, CHROMA_H);
      const bw = W / 12;
      c.font = '10px system-ui, sans-serif';
      c.textAlign = 'center';
      const scale = key ? new Set((key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]).map((d) => (d + key.t) % 12)) : null;
      for (let i = 0; i < 12; i++) {
        const v = this.chromaDisp[i], bh = (CHROMA_H - 14) * v;
        c.fillStyle = scale && scale.has(i) ? 'rgba(255,84,112,.9)' : 'rgba(150,150,170,.55)';
        c.fillRect(i * bw + 3, CHROMA_H - 14 - bh, bw - 6, bh);
        if (key && i === key.t) { c.strokeStyle = '#fff'; c.strokeRect(i * bw + 2.5, 1.5, bw - 5, CHROMA_H - 16); }
        c.fillStyle = '#9a9aa3';
        c.fillText(NOTE[i], i * bw + bw / 2, CHROMA_H - 3);
      }
      c.textAlign = 'start';

      const now = performance.now();
      if (now - (this._keyT || 0) > 500) {
        this._keyT = now;
        const s = this.s;
        if (!key) this.refs.key.textContent = 'Key: listening…  (pitch-class energy above, scale tones highlighted once a key is found)';
        else {
          const name = (t, m) => NOTE[((t % 12) + 12) % 12] + ' ' + m;
          let txt = `Key ≈ ${name(key.t, key.mode)}  (confidence ${(key.r * 100) | 0}%)`;
          if (s.semitones && !s.bypass) txt += `  ·  original ≈ ${name(key.t - s.semitones, key.mode)}`;
          this.refs.key.textContent = txt;
        }
      }
    }

    _key() {
      const x = this.keyAcc;
      let tot = 0;
      for (const v of x) tot += v;
      if (tot < 0.2) return null;
      const corr = (prof, t) => {
        let mx = 0, my = 0;
        for (let i = 0; i < 12; i++) { mx += x[i]; my += prof[(i - t + 12) % 12]; }
        mx /= 12; my /= 12;
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < 12; i++) {
          const a = x[i] - mx, b = prof[(i - t + 12) % 12] - my;
          sxy += a * b; sxx += a * a; syy += b * b;
        }
        return sxy / Math.sqrt(sxx * syy || 1);
      };
      let best = null;
      for (let t = 0; t < 12; t++) {
        for (const [mode, prof] of [['major', MAJ], ['minor', MIN]]) {
          const r = corr(prof, t);
          if (!best || r > best.r) best = { t, mode, r };
        }
      }
      return best && best.r > 0.45 ? best : null;
    }

    _drawEq() {
      const { c } = this.refs.eqCurve;
      const sr = (this.engine.ctx && this.engine.ctx.sampleRate) || 48000;
      c.clearRect(0, 0, W, EQ_H);
      const fMin = 20, fMax = 20000, range = 15;
      const yOf = (db) => EQ_H / 2 - (db / range) * (EQ_H / 2 - 4);
      c.strokeStyle = '#26262c';
      c.beginPath(); c.moveTo(0, yOf(0) + 0.5); c.lineTo(W, yOf(0) + 0.5); c.stroke();
      c.fillStyle = '#4a4a52'; c.font = '10px system-ui, sans-serif';
      c.fillText('+' + range, 2, 10); c.fillText('−' + range, 2, EQ_H - 3);
      const coefs = YTPS.BANDS.map((f, i) => peakingCoefs(f, YTPS.EQ_Q, this.s.eq[i], sr));
      c.beginPath();
      for (let x = 0; x <= W; x++) {
        const f = fMin * Math.pow(fMax / fMin, x / W);
        const w = (2 * Math.PI * f) / sr;
        let db = 0;
        for (const k of coefs) db += biquadDb(k, w);
        (x ? c.lineTo : c.moveTo).call(c, x, yOf(db));
      }
      c.strokeStyle = '#ff5470'; c.lineWidth = 2; c.stroke(); c.lineWidth = 1;
    }

    _drawLoudness(st) {
      const r = this.refs;
      const out = st.out;
      const pos = (l) => Math.max(0, Math.min(100, ((l + 40) / 40) * 100));
      if (!out || !isFinite(out.momentary)) {
        r.meterFill.style.width = '0%'; r.meterTick.style.left = '0%';
        r.meterText.textContent = '— LUFS';
      } else {
        r.meterFill.style.width = pos(out.momentary) + '%';
        r.meterTick.style.left = pos(out.shortTerm) + '%';
        r.meterText.textContent = (isFinite(out.shortTerm) ? out.shortTerm.toFixed(1) : '—') + ' LUFS';
      }
      const now = performance.now();
      if (now - (this._loudT || 0) < 250) return;
      this._loudT = now;
      const bits = [];
      if (st.pre && isFinite(st.pre.shortTerm)) bits.push(`source ≈ ${st.pre.shortTerm.toFixed(1)} LUFS`);
      if (this.s.autoLevel) bits.push(`auto ${fmtDb(st.autoDb)}`);
      if (this.s.compressor) bits.push(`comp ${(st.compReduction || 0).toFixed(1)} dB`);
      if (st.limReduction < -0.5) bits.push(`limiter ${st.limReduction.toFixed(1)} dB`);
      r.loudInfo.textContent = bits.join('  ·  ') || (st.state === 'idle' ? 'Audio engine starts when you change a setting.' : '');
    }
  }

  // Web Audio "peaking" biquad (Audio EQ Cookbook) and its magnitude response.
  function peakingCoefs(f0, Q, gain, sr) {
    const A = Math.pow(10, gain / 40), w0 = (2 * Math.PI * f0) / sr, al = Math.sin(w0) / (2 * Q), cs = Math.cos(w0);
    return [1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A];
  }
  function biquadDb([b0, b1, b2, a0, a1, a2], w) {
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
    const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }

  YTPS.Panel = Panel;
})();
