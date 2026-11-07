import './pitch-shifter.js';
import './vocal.js';

const { PitchShifter, QUALITY, VocalFilter } = globalThis.YTPS;

class YTPitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = 1;
    this.cfg = QUALITY.normal;
    this.shifters = [];
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.fftSize) { this.cfg = { fftSize: d.fftSize, osamp: d.osamp }; this.shifters = []; }
      if (typeof d.ratio === 'number') this.ratio = d.ratio;
      if (d.reset) this.shifters.forEach((s) => s.reset());
      this.shifters.forEach((s) => s.setRatio(this.ratio));
    };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    for (let c = 0; c < out.length; c++) {
      const src = inp[c] || inp[0];
      if (!src) { out[c].fill(0); continue; }
      let s = this.shifters[c];
      if (!s) {
        s = this.shifters[c] = new PitchShifter(this.cfg.fftSize, this.cfg.osamp, sampleRate);
        s.setRatio(this.ratio);
      }
      s.process(src, out[c], src.length);
    }
    return true;
  }
}

registerProcessor('yt-pitch-shifter', YTPitchProcessor);

class YTVocalProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.vf = new VocalFilter(sampleRate);
    this.n = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.reset) this.vf.reset();
      this.vf.setParams(d);
    };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) { out.forEach((c) => c.fill(0)); return true; }
    const L = inp[0], R = inp[1] || inp[0];
    this.vf.process(L, R, out[0], out[1] || out[0], L.length);
    if (++this.n >= 150) { this.n = 0; this.port.postMessage(this.vf.takeStats()); }
    return true;
  }
}

registerProcessor('yt-vocal-filter', YTVocalProcessor);
