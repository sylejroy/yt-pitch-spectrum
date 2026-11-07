// Verifies the pitch shifter: sine in -> shifted sine out, amplitude preserved.
require('../dsp/pitch-shifter.js');
const { PitchShifter, FFT, QUALITY } = globalThis.YTPS;

const sr = 48000;
function dominantFreq(buf) {
  const n = 1 << 15, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = buf[buf.length - n + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  new FFT(n).transform(re, im, -1);
  let best = 0, bi = 0;
  for (let k = 1; k < n / 2; k++) { const m = re[k] ** 2 + im[k] ** 2; if (m > best) { best = m; bi = k; } }
  return (bi * sr) / n;
}
let fail = 0;
for (const [q, cfg] of Object.entries(QUALITY)) {
  for (const semi of [-12, -5, 0.5, 3, 7, 12]) {
    const f0 = 330, ratio = 2 ** (semi / 12), len = sr * 2;
    const inp = new Float32Array(len), out = new Float32Array(len);
    for (let i = 0; i < len; i++) inp[i] = 0.5 * Math.sin((2 * Math.PI * f0 * i) / sr);
    const ps = new PitchShifter(cfg.fftSize, cfg.osamp, sr);
    ps.setRatio(ratio);
    for (let i = 0; i < len; i += 128) ps.process(inp.subarray(i, i + 128), out.subarray(i, i + 128), 128);
    const f = dominantFreq(out);
    let rms = 0; for (let i = len / 2; i < len; i++) rms += out[i] ** 2; rms = Math.sqrt(rms / (len / 2));
    const errCents = 1200 * Math.log2(f / (f0 * ratio));
    const ok = Math.abs(errCents) < 15 && rms > 0.31 && rms < 0.4;
    if (!ok) fail++;
    console.log(`${q.padEnd(6)} ${String(semi).padStart(5)} st  expect ${(f0 * ratio).toFixed(1)}Hz got ${f.toFixed(1)}Hz (${errCents.toFixed(1)}¢)  rms ${rms.toFixed(3)} ${ok ? 'OK' : 'FAIL'}`);
  }
}
// throughput
const ps = new PitchShifter(4096, 8, sr); ps.setRatio(1.3);
const b = new Float32Array(128).map(() => Math.random() - 0.5), o = new Float32Array(128);
const t = Date.now(); for (let i = 0; i < sr * 10 / 128; i++) ps.process(b, o, 128);
console.log(`high quality: 10 s of audio in ${Date.now() - t} ms (one channel)`);
process.exit(fail ? 1 : 0);
