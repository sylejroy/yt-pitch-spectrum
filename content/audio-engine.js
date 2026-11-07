// Web Audio graph:
//  <video> → input → [vocal filter] → [pitch shifter] → 10-band EQ → eqOut ─┬→ spectrum analyser
//                                                         ├→ loudness meter (pre-gain, drives auto-level)
//                                                         └→ user gain → auto gain → [compressor] → limiter → speakers
//                                                                                                     └→ loudness meter (output)
(function () {
  'use strict';
  const YTPS = globalThis.YTPS;
  const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const EQ_Q = 1.4;
  const dbToLin = (db) => Math.pow(10, db / 20);
  const lufs = (ms) => (ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

  class LoudnessMeter {
    // BS.1770-style K-weighting, per-channel energy summed (≈ LUFS).
    constructor(ctx, src) {
      const hs = ctx.createBiquadFilter();
      hs.type = 'highshelf'; hs.frequency.value = 1500; hs.gain.value = 4;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
      const split = ctx.createChannelSplitter(2);
      this.an = [0, 1].map(() => {
        const a = ctx.createAnalyser();
        a.fftSize = 8192;
        return a;
      });
      src.connect(hs); hs.connect(hp); hp.connect(split);
      split.connect(this.an[0], 0); split.connect(this.an[1], 1);
      this.buf = new Float32Array(8192);
      this.hist = [];
      this.momentary = -Infinity;
      this.shortTerm = -Infinity;
    }
    sample(now) {
      let sum = 0;
      for (const a of this.an) {
        a.getFloatTimeDomainData(this.buf);
        let s = 0;
        const b = this.buf;
        for (let i = 0; i < b.length; i++) s += b[i] * b[i];
        sum += s / b.length;
      }
      const h = this.hist;
      h.push({ t: now, ms: sum });
      while (h.length && h[0].t < now - 3000) h.shift();
      let st = 0, mo = 0, nm = 0;
      for (const e of h) { st += e.ms; if (e.t >= now - 400) { mo += e.ms; nm++; } }
      this.shortTerm = lufs(st / h.length);
      this.momentary = lufs(nm ? mo / nm : 0);
    }
  }

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.ready = null;
      this.captured = new WeakSet();
      this.capturedCount = 0;
      this.s = null;
      this.autoDb = 0;
      this.kind = '';
      this.error = '';
      this._routeKey = '';
    }

    get running() { return !!this.ctx && this.ctx.state === 'running'; }

    init() {
      if (!this.ready) this.ready = this._init();
      return this.ready;
    }

    async _init() {
      const ctx = (this.ctx = new AudioContext({ latencyHint: 'playback' }));
      this.input = ctx.createGain();
      this.shifter = await this._makeShifter(ctx);
      this.vocal = this._makeVocal(ctx);
      this.vocalStats = null;

      this.eq = BANDS.map((f) => {
        const b = ctx.createBiquadFilter();
        b.type = 'peaking'; b.frequency.value = f; b.Q.value = EQ_Q; b.gain.value = 0;
        return b;
      });
      for (let i = 0; i < this.eq.length - 1; i++) this.eq[i].connect(this.eq[i + 1]);
      this.eqOut = ctx.createGain();
      this.eq[this.eq.length - 1].connect(this.eqOut);

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 16384;
      this.analyser.smoothingTimeConstant = 0.55;
      this.analyser.minDecibels = -110;
      this.analyser.maxDecibels = -10;
      this.eqOut.connect(this.analyser);
      this.preMeter = new LoudnessMeter(ctx, this.eqOut);

      this.userGain = ctx.createGain();
      this.autoGain = ctx.createGain();
      this.eqOut.connect(this.userGain);
      this.userGain.connect(this.autoGain);

      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -26; this.comp.knee.value = 12; this.comp.ratio.value = 4;
      this.comp.attack.value = 0.01; this.comp.release.value = 0.3;

      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
      this.limiter.connect(ctx.destination);
      this.outMeter = new LoudnessMeter(ctx, this.limiter);

      const resume = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); };
      window.addEventListener('pointerdown', resume, true);
      window.addEventListener('keydown', resume, true);
      ctx.addEventListener('statechange', () => { if (this.running) this._capturePending(); });
      resume();

      if (this.s) this.apply(this.s, true);
      setInterval(() => this._tick(), 100);
    }

    async _makeShifter(ctx) {
      try {
        if (!ctx.audioWorklet) throw new Error('AudioWorklet unavailable');
        await ctx.audioWorklet.addModule(browser.runtime.getURL('dsp/worklet.js'));
        const node = new AudioWorkletNode(ctx, 'yt-pitch-shifter', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        });
        this.kind = 'AudioWorklet';
        return { node, set: (o) => node.port.postMessage(o) };
      } catch (e) {
        // Fallback: ScriptProcessor on the main thread, same DSP code.
        const node = ctx.createScriptProcessor(2048, 2, 2);
        let cfg = YTPS.QUALITY.normal, ratio = 1, sh = [];
        const make = () => {
          sh = [0, 1].map(() => {
            const s = new YTPS.PitchShifter(cfg.fftSize, cfg.osamp, ctx.sampleRate);
            s.setRatio(ratio);
            return s;
          });
        };
        make();
        const inBuf = new Float32Array(2048), outBuf = new Float32Array(2048);
        node.onaudioprocess = (ev) => {
          const ib = ev.inputBuffer, ob = ev.outputBuffer;
          for (let c = 0; c < 2; c++) {
            ib.copyFromChannel(inBuf, Math.min(c, ib.numberOfChannels - 1));
            sh[c].process(inBuf, outBuf, inBuf.length);
            ob.copyToChannel(outBuf, c);
          }
        };
        this.kind = 'ScriptProcessor (fallback)';
        return {
          node,
          set: (o) => {
            if (o.fftSize) { cfg = { fftSize: o.fftSize, osamp: o.osamp }; make(); }
            if (typeof o.ratio === 'number') { ratio = o.ratio; sh.forEach((s) => s.setRatio(ratio)); }
            if (o.reset) sh.forEach((s) => s.reset());
          },
        };
      }
    }

    _makeVocal(ctx) {
      if (this.kind === 'AudioWorklet') {
        const node = new AudioWorkletNode(ctx, 'yt-vocal-filter', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
          channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        });
        node.port.onmessage = (e) => {
          const d = e.data;
          this.vocalStats = { centreDb: d.centreDb, corr: d.corr, level: d.level };
        };
        return { node, set: (o) => node.port.postMessage(o) };
      }
      const node = ctx.createScriptProcessor(2048, 2, 2);
      const vf = new YTPS.VocalFilter(ctx.sampleRate);
      const bufs = [0, 1, 2, 3].map(() => new Float32Array(2048));
      let n = 0;
      node.onaudioprocess = (ev) => {
        const ib = ev.inputBuffer, ob = ev.outputBuffer;
        ib.copyFromChannel(bufs[0], 0);
        ib.copyFromChannel(bufs[1], Math.min(1, ib.numberOfChannels - 1));
        vf.process(bufs[0], bufs[1], bufs[2], bufs[3], 2048);
        ob.copyToChannel(bufs[2], 0); ob.copyToChannel(bufs[3], 1);
        if (++n >= 10) { n = 0; this.vocalStats = vf.takeStats(); }
      };
      return { node, set: (o) => { if (o.reset) vf.reset(); vf.setParams(o); } };
    }

    // Capture <video> elements. Only done once the context is running, otherwise
    // the video would go silent until the user clicks.
    attach(videos) {
      this._pending = videos;
      if (this.running) this._capturePending();
    }
    _capturePending() {
      for (const v of this._pending || []) {
        if (this.captured.has(v)) continue;
        this.captured.add(v);
        try {
          this.ctx.createMediaElementSource(v).connect(this.input);
          this.capturedCount++;
        } catch (e) {
          this.error = 'Could not capture video audio: ' + e.message;
        }
      }
    }

    ratioOf(s) { return Math.pow(2, (s.semitones + s.cents / 100) / 12); }

    apply(s, force) {
      const prev = this.s;
      this.s = JSON.parse(JSON.stringify(s));
      if (!this.ctx || !this.eq) return;
      const t = this.ctx.currentTime;
      const ratio = this.ratioOf(s);
      if (force || !prev || prev.quality !== s.quality) this.shifter.set(YTPS.QUALITY[s.quality] || YTPS.QUALITY.normal);
      this.shifter.set({ ratio });
      this.vocal.set({
        mode: { off: 0, remove: 1, isolate: 2 }[s.vocalMode] || 0,
        strength: s.vocalStrength, lowHz: s.vocalLowHz, highHz: s.vocalHighHz,
      });
      s.eq.forEach((g, i) => this.eq[i].gain.setTargetAtTime(g, t, 0.02));
      this.userGain.gain.setTargetAtTime(dbToLin(s.gainDb), t, 0.02);
      this._route(force);
    }

    _route(force) {
      const s = this.s;
      const pitchOn = Math.abs(s.semitones * 100 + s.cents) > 0.01;
      const vocalOn = s.vocalMode === 'remove' || s.vocalMode === 'isolate';
      const key = [s.bypass, pitchOn, s.compressor, vocalOn].join();
      if (!force && key === this._routeKey) return;
      const wasPitch = this._routeKey.split(',')[1] === 'true';
      const wasVocal = this._routeKey.split(',')[3] === 'true';
      this._routeKey = key;
      for (const n of [this.input, this.vocal.node, this.shifter.node, this.autoGain, this.comp]) {
        try { n.disconnect(); } catch (e) { /* not connected */ }
      }
      if (s.bypass) {
        this.input.connect(this.ctx.destination);
        this.input.connect(this.analyser);
        return;
      }
      let head = this.input;
      if (vocalOn) {
        if (!wasVocal) this.vocal.set({ reset: true });
        head.connect(this.vocal.node);
        head = this.vocal.node;
      } else this.vocalStats = null;
      if (pitchOn) {
        if (!wasPitch) this.shifter.set({ reset: true });
        head.connect(this.shifter.node);
        head = this.shifter.node;
      }
      head.connect(this.eq[0]);
      if (s.compressor) { this.autoGain.connect(this.comp); this.comp.connect(this.limiter); }
      else this.autoGain.connect(this.limiter);
    }

    _tick() {
      if (!this.running || !this.s) return;
      const now = performance.now();
      this.preMeter.sample(now);
      this.outMeter.sample(now);
      let want = 0;
      if (this.s.autoLevel && !this.s.bypass) {
        const pre = this.preMeter.shortTerm;
        // hold gain during silence / pauses
        want = pre > -55 ? Math.max(-18, Math.min(18, this.s.targetLufs - pre)) : this.autoDb;
      }
      this.autoDb += (want - this.autoDb) * 0.06;
      this.autoGain.gain.setTargetAtTime(dbToLin(this.autoDb), this.ctx.currentTime, 0.1);
    }

    status() {
      if (!this.ctx) return { state: 'idle' };
      return {
        state: this.ctx.state,
        kind: this.kind,
        captured: this.capturedCount,
        sampleRate: this.ctx.sampleRate,
        error: this.error,
        autoDb: this.autoDb,
        out: this.outMeter ? this.outMeter : null,
        pre: this.preMeter ? this.preMeter : null,
        vocal: this.vocalStats,
        compReduction: this.s && this.s.compressor ? this.comp.reduction : 0,
        limReduction: this.limiter ? this.limiter.reduction : 0,
      };
    }
  }

  YTPS.BANDS = BANDS;
  YTPS.EQ_Q = EQ_Q;
  YTPS.AudioEngine = AudioEngine;
})();
