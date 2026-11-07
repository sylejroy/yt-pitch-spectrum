// Phase-vocoder pitch shifter (after S. M. Bernsee's smbPitchShift).
// Plain script: works as a content script (fallback engine) and as a
// side-effect import inside the AudioWorklet module.
(function (g) {
  'use strict';
  const YTPS = (g.YTPS = g.YTPS || {});

  class FFT {
    constructor(n) {
      this.n = n;
      const bits = Math.round(Math.log2(n));
      this.rev = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        let r = 0;
        for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
        this.rev[i] = r;
      }
      this.cos = new Float64Array(n / 2);
      this.sin = new Float64Array(n / 2);
      for (let i = 0; i < n / 2; i++) {
        this.cos[i] = Math.cos((2 * Math.PI * i) / n);
        this.sin[i] = Math.sin((2 * Math.PI * i) / n);
      }
    }
    // In place, unnormalised. sign = -1 forward, +1 inverse.
    transform(re, im, sign) {
      const n = this.n, rev = this.rev, C = this.cos, S = this.sin;
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const wr = C[k], wi = sign * S[k];
            const a = i + j, b = a + half;
            const tr = re[b] * wr - im[b] * wi;
            const ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
    }
  }

  class PitchShifter {
    constructor(fftSize = 2048, osamp = 4, sampleRate = 48000) {
      const N = (this.N = fftSize);
      this.osamp = osamp;
      this.step = N / osamp;
      this.latency = N - this.step;
      this.half = N / 2;
      this.freqPerBin = sampleRate / N;
      this.expct = (2 * Math.PI * this.step) / N;
      this.ratio = 1;
      this.fft = new FFT(N);
      this.win = new Float64Array(N);
      for (let k = 0; k < N; k++) this.win[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N);
      this.inFifo = new Float32Array(N);
      this.outFifo = new Float32Array(N);
      this.re = new Float64Array(N);
      this.im = new Float64Array(N);
      this.accum = new Float64Array(2 * N);
      const H = this.half + 1;
      this.lastPhase = new Float64Array(H);
      this.sumPhase = new Float64Array(H);
      this.anaMag = new Float64Array(H);
      this.anaFreq = new Float64Array(H);
      this.synMag = new Float64Array(H);
      this.synFreq = new Float64Array(H);
      this.anaPhase = new Float64Array(H);
      this.peaks = new Int32Array(H);
      this.rover = this.latency;
      this.outScale = 2 / (this.half * osamp * 1.5); // 1.5 = Hann^2 overlap-add gain
    }
    setRatio(r) { this.ratio = r > 0 && isFinite(r) ? r : 1; }
    reset() {
      for (const a of [this.inFifo, this.outFifo, this.accum, this.lastPhase, this.sumPhase]) a.fill(0);
      this.rover = this.latency;
    }
    process(input, output, n) {
      const inF = this.inFifo, outF = this.outFifo, lat = this.latency, N = this.N;
      for (let i = 0; i < n; i++) {
        const x = input[i];
        inF[this.rover] = x === x && x !== Infinity && x !== -Infinity ? x : 0;
        output[i] = outF[this.rover - lat];
        if (++this.rover >= N) {
          this.rover = lat;
          this._frame();
        }
      }
    }
    _frame() {
      const { N, half, win, re, im, step, osamp, freqPerBin, expct, ratio } = this;
      const { lastPhase, sumPhase, anaMag, anaFreq, synMag, synFreq, accum, inFifo, outFifo } = this;
      const PI = Math.PI, TWO_PI = 2 * Math.PI;

      for (let k = 0; k < N; k++) { re[k] = inFifo[k] * win[k]; im[k] = 0; }
      this.fft.transform(re, im, -1);

      // analysis: magnitude, phase and true frequency (in bins) of each bin
      const ph = this.anaPhase, omega = anaFreq;
      for (let k = 0; k <= half; k++) {
        const r = re[k], i = im[k];
        const phase = Math.atan2(i, r);
        let tmp = phase - lastPhase[k];
        lastPhase[k] = phase;
        tmp -= k * expct;
        let qpd = Math.trunc(tmp / PI);
        if (qpd >= 0) qpd += qpd & 1; else qpd -= qpd & 1;
        tmp -= PI * qpd;
        anaMag[k] = 2 * Math.sqrt(r * r + i * i);
        ph[k] = phase;
        omega[k] = k + (osamp * tmp) / TWO_PI;
      }

      // peak picking
      const peaks = this.peaks;
      let np = 0;
      for (let k = 2; k <= half - 2; k++) {
        const m = anaMag[k];
        if (m > 1e-9 && m > anaMag[k - 1] && m >= anaMag[k + 1] && m > anaMag[k - 2] && m >= anaMag[k + 2]) peaks[np++] = k;
      }

      // identity phase locking: move each peak's region of influence as a block,
      // advance the peak phase at the shifted frequency, keep relative phases.
      synMag.fill(0);
      const outPh = synFreq; // reused as output phase buffer
      outPh.fill(0);
      const prev = sumPhase;
      for (let n = 0; n < np; n++) {
        const p = peaks[n];
        const q = Math.round(p * ratio);
        if (q > half) break;
        const lo = n === 0 ? 0 : ((peaks[n - 1] + p) >> 1) + 1;
        const hi = n === np - 1 ? half : (p + peaks[n + 1]) >> 1;
        const shift = q - p;
        const phq = prev[q] + omega[p] * ratio * expct;
        for (let k = lo; k <= hi; k++) {
          const nk = k + shift;
          if (nk < 0 || nk > half) continue;
          const m = anaMag[k];
          if (m > synMag[nk]) { synMag[nk] = m; outPh[nk] = phq + ph[k] - ph[p]; }
        }
      }

      // synthesis
      for (let k = 0; k <= half; k++) {
        let p = outPh[k];
        if (p > 1e6 || p < -1e6) p %= TWO_PI;
        prev[k] = p;
        const m = synMag[k];
        re[k] = m * Math.cos(p);
        im[k] = m * Math.sin(p);
      }
      for (let k = half + 1; k < N; k++) { re[k] = 0; im[k] = 0; }
      this.fft.transform(re, im, 1);

      const sc = this.outScale;
      for (let k = 0; k < N; k++) accum[k] += win[k] * re[k] * sc;
      for (let k = 0; k < step; k++) outFifo[k] = accum[k];
      accum.copyWithin(0, step, step + N);
      for (let k = N; k < N + step; k++) accum[k] = 0;
      inFifo.copyWithin(0, step, N);
    }
  }

  YTPS.FFT = FFT;
  YTPS.PitchShifter = PitchShifter;
  YTPS.QUALITY = {
    fast: { fftSize: 1024, osamp: 4 },
    normal: { fftSize: 2048, osamp: 4 },
    high: { fftSize: 4096, osamp: 8 },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
