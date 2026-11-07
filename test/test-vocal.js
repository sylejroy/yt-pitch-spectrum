require('../dsp/pitch-shifter.js');
require('../dsp/vocal.js');
const { VocalFilter, FFT } = globalThis.YTPS;
const sr = 48000, len = sr * 3;
// centre "vocal" 440 Hz, centre bass 80 Hz, guitar 330 Hz panned 80% left, pad 523 Hz wide (decorrelated phase)
const L = new Float32Array(len), R = new Float32Array(len);
for (let i = 0; i < len; i++) {
  const t = i / sr;
  const voc = 0.3 * Math.sin(2 * Math.PI * 440 * t), bass = 0.3 * Math.sin(2 * Math.PI * 80 * t);
  const gtr = 0.2 * Math.sin(2 * Math.PI * 330 * t);
  L[i] = voc + bass + gtr * 0.9 + 0.15 * Math.sin(2 * Math.PI * 523 * t);
  R[i] = voc + bass + gtr * 0.2 + 0.15 * Math.cos(2 * Math.PI * 523 * t);
}
function level(buf, f) { // amplitude at f via Goertzel-ish projection over last second
  let re = 0, im = 0; const n = sr;
  for (let i = len - n; i < len; i++) { re += buf[i] * Math.cos(2 * Math.PI * f * i / sr); im += buf[i] * Math.sin(2 * Math.PI * f * i / sr); }
  return 2 * Math.hypot(re, im) / n;
}
const run = (mode, s = 1) => {
  const vf = new VocalFilter(sr); vf.setParams({ mode, strength: s, lowHz: 150, highHz: 8000 });
  const oL = new Float32Array(len), oR = new Float32Array(len);
  for (let i = 0; i < len; i += 128) vf.process(L.subarray(i, i + 128), R.subarray(i, i + 128), oL.subarray(i, i + 128), oR.subarray(i, i + 128), 128);
  const row = {};
  for (const [n, f] of [['vocal440', 440], ['bass80', 80], ['gtr330', 330], ['pad523', 523]]) row[n] = `${level(oL, f).toFixed(3)}/${level(oR, f).toFixed(3)}`;
  console.log(['off', 'remove', 'isolate'][mode].padEnd(8), JSON.stringify(row), vf.takeStats());
};
console.log('input   ', JSON.stringify({ vocal440: '0.300/0.300', bass80: '0.300/0.300', gtr330: '0.180/0.040', pad523: '0.150/0.150' }));
run(0); run(1); run(2);
