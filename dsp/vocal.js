// Frequency-domain centre-channel extraction (similarity masking, after Avendano & Jot).
// For every STFT bin, the part that is identical in L and R (same level AND phase) is
// treated as "centre" – where lead vocals usually live – and removed or isolated.
(function (g) {
  'use strict';
  const YTPS = (g.YTPS = g.YTPS || {});

  class VocalFilter {
    constructor(sampleRate = 48000, fftSize = 2048, osamp = 4) {
      const N = (this.N = fftSize);
      this.sr = sampleRate;
      this.step = N / osamp;
      this.latency = N - this.step;
      this.half = N / 2;
      this.fft = new YTPS.FFT(N);
      this.win = new Float64Array(N);
      for (let k = 0; k < N; k++) this.win[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N);
      this.scale = 1 / (N * 1.5); // IFFT normalisation × Hann² overlap-add gain (osamp 4)
      this.inL = new Float32Array(N); this.inR = new Float32Array(N);
      this.outL = new Float32Array(N); this.outR = new Float32Array(N);
      this.accL = new Float64Array(2 * N); this.accR = new Float64Array(2 * N);
      this.lr = new Float64Array(N); this.li = new Float64Array(N);
      this.rr = new Float64Array(N); this.ri = new Float64Array(N);
      this.mask = new Float64Array(this.half + 1);
      this.rover = this.latency;
      this.mode = 0; // 0 off, 1 remove, 2 isolate
      this.strength = 1;
      this.setBand(150, 8000);
      this.stats = { centre: 0, total: 0, corr: 0, frames: 0 };
    }
    setParams({ mode, strength, lowHz, highHz }) {
      if (mode != null) this.mode = mode;
      if (strength != null) this.strength = Math.max(0, Math.min(1, strength));
      if (lowHz != null || highHz != null) this.setBand(lowHz != null ? lowHz : this.lowHz, highHz != null ? highHz : this.highHz);
    }
    setBand(lowHz, highHz) {
      this.lowHz = lowHz; this.highHz = highHz;
      const bw = (this.band = new Float64Array(this.half + 1));
      const ss = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
      for (let k = 0; k <= this.half; k++) {
        const f = (k * this.sr) / this.N;
        const lo = lowHz <= 0 ? 1 : ss((f - lowHz * 0.6) / (lowHz * 0.4));
        const hi = 1 - ss((f - highHz) / (highHz * 0.5));
        bw[k] = lo * hi;
      }
    }
    reset() {
      for (const a of [this.inL, this.inR, this.outL, this.outR, this.accL, this.accR, this.mask]) a.fill(0);
      this.rover = this.latency;
    }
    // Returns and clears stats: centre/total energy ratio and energy-weighted L/R correlation.
    takeStats() {
      const s = this.stats;
      const out = {
        centreDb: s.total > 0 ? 10 * Math.log10(Math.max(1e-9, s.centre / s.total)) : -Infinity,
        corr: s.total > 0 ? s.corr / s.total : 0,
        level: s.frames ? s.total / s.frames : 0,
      };
      this.stats = { centre: 0, total: 0, corr: 0, frames: 0 };
      return out;
    }
    process(inL, inR, outL, outR, n) {
      const lat = this.latency, N = this.N;
      for (let i = 0; i < n; i++) {
        let a = inL[i], b = inR[i];
        if (!(a === a) || !isFinite(a)) a = 0;
        if (!(b === b) || !isFinite(b)) b = 0;
        this.inL[this.rover] = a; this.inR[this.rover] = b;
        outL[i] = this.outL[this.rover - lat];
        outR[i] = this.outR[this.rover - lat];
        if (++this.rover >= N) { this.rover = lat; this._frame(); }
      }
    }
    _frame() {
      const { N, half, win, lr, li, rr, ri, mask, band, step } = this;
      for (let k = 0; k < N; k++) { lr[k] = this.inL[k] * win[k]; li[k] = 0; rr[k] = this.inR[k] * win[k]; ri[k] = 0; }
      this.fft.transform(lr, li, -1);
      this.fft.transform(rr, ri, -1);
      const mode = this.mode, s = this.strength, st = this.stats;
      let eC = 0, eT = 0, eX = 0;
      for (let k = 0; k <= half; k++) {
        const Lr = lr[k], Li = li[k], Rr = rr[k], Ri = ri[k];
        const pL = Lr * Lr + Li * Li, pR = Rr * Rr + Ri * Ri, cross = Lr * Rr + Li * Ri;
        const tot = pL + pR + 1e-20;
        const psi = (2 * cross) / tot; // 1 only when L == R exactly
        let m = psi > 0 ? psi * psi * psi * psi * psi : 0;
        m = 0.35 * mask[k] + 0.65 * m; // temporal smoothing → less "musical noise"
        mask[k] = m;
        const mm = m * band[k];
        const Cr = 0.5 * mm * (Lr + Rr), Ci = 0.5 * mm * (Li + Ri);
        eC += 2 * (Cr * Cr + Ci * Ci); eT += tot; eX += cross;
        let oLr, oLi, oRr, oRi;
        if (mode === 1) {
          oLr = Lr - s * Cr; oLi = Li - s * Ci; oRr = Rr - s * Cr; oRi = Ri - s * Ci;
        } else if (mode === 2) {
          const t = 1 - s;
          oLr = t * Lr + s * Cr; oLi = t * Li + s * Ci; oRr = t * Rr + s * Cr; oRi = t * Ri + s * Ci;
        } else {
          oLr = Lr; oLi = Li; oRr = Rr; oRi = Ri;
        }
        lr[k] = oLr; li[k] = oLi; rr[k] = oRr; ri[k] = oRi;
        if (k > 0 && k < half) {
          lr[N - k] = oLr; li[N - k] = -oLi; rr[N - k] = oRr; ri[N - k] = -oRi;
        }
      }
      li[0] = ri[0] = li[half] = ri[half] = 0;
      st.centre += eC; st.total += eT; st.corr += 2 * eX; st.frames++;

      this.fft.transform(lr, li, 1);
      this.fft.transform(rr, ri, 1);
      const sc = this.scale, aL = this.accL, aR = this.accR;
      for (let k = 0; k < N; k++) { aL[k] += lr[k] * win[k] * sc; aR[k] += rr[k] * win[k] * sc; }
      for (let k = 0; k < step; k++) { this.outL[k] = aL[k]; this.outR[k] = aR[k]; }
      aL.copyWithin(0, step, step + N); aR.copyWithin(0, step, step + N);
      for (let k = N; k < N + step; k++) { aL[k] = 0; aR[k] = 0; }
      this.inL.copyWithin(0, step, N); this.inR.copyWithin(0, step, N);
    }
  }

  YTPS.VocalFilter = VocalFilter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
