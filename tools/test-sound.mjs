#!/usr/bin/env node
// Tests for src/sound.js (window.Sound) that run in Node: the FFT, spectra, the
// plucked string's pitch, filters, envelopes, and a smoke test of the g helpers.
// No audio device is touched; the kit stays silent without a browser.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/sound.js"), "utf8"))();
const S = window.Sound;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const TAU = Math.PI * 2;

// FFT
{
  const n = 1024, k0 = 37, re = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((TAU * k0 * i) / n);
  const { re: R, im: I } = S.fft(re.slice(), new Float64Array(n));
  let best = 0;
  for (let k = 1; k < n / 2; k++) if (Math.hypot(R[k], I[k]) > Math.hypot(R[best], I[best])) best = k;
  check("FFT of a pure sine peaks at its bin", best === k0, `bin ${best}`);
  check("that peak holds N/2 of the energy", Math.abs(Math.hypot(R[k0], I[k0]) - n / 2) < 1e-6);
  let leak = 0;
  for (let k = 0; k < n / 2; k++) if (k !== k0) leak = Math.max(leak, Math.hypot(R[k], I[k]));
  check("a whole number of cycles leaks nowhere", leak < 1e-8, leak.toExponential(1));
}
{
  // Against a direct DFT on random data.
  const n = 64, r = S.rng(11), x = Float64Array.from({ length: n }, () => r() * 2 - 1), y = Float64Array.from({ length: n }, () => r() * 2 - 1);
  const { re, im } = S.fft(x.slice(), y.slice());
  let err = 0;
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) { const a = (-TAU * k * t) / n; sr += x[t] * Math.cos(a) - y[t] * Math.sin(a); si += x[t] * Math.sin(a) + y[t] * Math.cos(a); }
    err = Math.max(err, Math.abs(sr - re[k]), Math.abs(si - im[k]));
  }
  check("FFT matches a direct DFT", err < 1e-10, err.toExponential(1));
  const back = S.ifft(re, im);
  let rt = 0;
  for (let i = 0; i < n; i++) rt = Math.max(rt, Math.abs(back.re[i] - x[i]), Math.abs(back.im[i] - y[i]));
  check("inverse FFT round trip", rt < 1e-12, rt.toExponential(1));
}
{
  // Parseval: sum |x|^2 = (1/N) sum |X|^2.
  const n = 4096, r = S.rng(5), x = Float64Array.from({ length: n }, () => r() * 2 - 1);
  const time = x.reduce((s, v) => s + v * v, 0);
  const { re, im } = S.fft(x.slice(), new Float64Array(n));
  let freq = 0;
  for (let k = 0; k < n; k++) freq += re[k] * re[k] + im[k] * im[k];
  freq /= n;
  check("Parseval's theorem holds", Math.abs(time - freq) / time < 1e-12, `${time.toFixed(6)} vs ${freq.toFixed(6)}`);
}
{
  let threw = false;
  try { S.fft(new Float64Array(100)); } catch { threw = true; }
  check("non-power-of-two length is refused", threw);
}

// Spectrum scaling and peak finding
{
  const sr = 44100, x = S.fromFunction(t => 0.5 * Math.sin(TAU * 1000 * t) + 0.25 * Math.sin(TAU * 3000 * t), { duration: 0.5, sampleRate: sr });
  const m = S.spectrum(x, { size: 8192, sampleRate: sr });
  check("spectrum length is size/2 + 1", m.length === 4097);
  const p = S.peaks(m, { count: 2, sampleRate: sr });
  check("peaks at 1000 and 3000 Hz", Math.abs(p[0].freq - 1000) < 1 && Math.abs(p[1].freq - 3000) < 1, p.map(q => q.freq.toFixed(2)).join(", "));
  check("peak heights read the amplitudes", Math.abs(p[0].mag - 0.5) < 0.01 && Math.abs(p[1].mag - 0.25) < 0.006, p.map(q => q.mag.toFixed(4)).join(", "));
  const d = S.spectrum(x, { size: 8192, db: true });
  check("dB spectrum is 20 log10 of the amplitudes", d.every((v, k) => Math.abs(v - Math.max(-120, 20 * Math.log10(m[k] + 1e-12))) < 1e-3));
  const frames = S.stft(x, { size: 512, hop: 256 });
  check("stft frame count", frames.length === Math.floor((x.length - 512) / 256) + 1 && frames[0].length === 257);
}

// Karplus-Strong pitch
for (const f of [82.41, 196, 440, 987.77]) {
  const sr = 44100, x = S.karplus({ freq: f, duration: 1.5, sampleRate: sr });
  const p = S.peaks(S.spectrum(x, { size: 65536 }), { count: 8, sampleRate: sr });
  // The fundamental is the lowest clear peak (a low string's second harmonic can be louder).
  const strong = p.filter(q => q.freq > 20 && q.mag > p[0].mag * 0.05).sort((a, b) => a.freq - b.freq)[0];
  const cents = 1200 * Math.log2(strong.freq / f);
  check(`plucked string at ${f} Hz is in tune`, Math.abs(cents) < 3, `${strong.freq.toFixed(2)} Hz, ${cents.toFixed(2)} cents`);
  // Every clear partial sits on a whole multiple of the fundamental (a string, not a bell).
  const off = Math.max(...p.filter(q => q.mag > p[0].mag * 0.05).map(q => Math.abs(q.freq / f - Math.round(q.freq / f))));
  if (f === 196) check("its partials are harmonics", off < 0.01, `worst ${off.toFixed(4)} of a harmonic`);
}
{
  const x = S.karplus({ freq: 220, duration: 2, decay: 1 }), sr = 44100;
  const early = S.rms(x.subarray(0, sr * 0.1)), late = S.rms(x.subarray(sr, sr * 1.1));
  const dropDb = 20 * Math.log10(early / late);
  check("plucked string decays about 60 dB per `decay` second", dropDb > 45 && dropDb < 75, `${dropDb.toFixed(1)} dB in 1 s`);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  check("plucked string stays within ±1", peak <= 1);
}

// Synthesis matches its spec
{
  const sr = 44100, x = S.render({ harmonics: [1, 0, 0.5], freq: 441 }, { duration: 1, sampleRate: sr });
  const p = S.peaks(S.spectrum(x, { size: 16384 }), { count: 3, sampleRate: sr }).sort((a, b) => a.freq - b.freq);
  check("additive tone has its partials", Math.abs(p[0].freq - 441) < 0.5 && Math.abs(p[1].freq - 1323) < 0.5, p.map(q => q.freq.toFixed(1)).join(", "));
  check("partial amplitudes keep their ratio", Math.abs(p[1].mag / p[0].mag - 0.5) < 0.01);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  check("additive tone is normalized to peak 1", Math.abs(peak - 1) < 0.01, peak.toFixed(4));
  const sq = S.partials({ type: "square", freq: 1000 });
  check("square wave has only odd harmonics", sq[1] === 0 && Math.abs(sq[2] / sq[0] - 1 / 3) < 1e-12 && sq.length === 22);
  const c = S.cycle({ type: "sawtooth" }, { n: 101 });
  check("cycle draws one period", c.length === 101 && Math.abs(c[0] - c[100]) < 1e-6);
}

// Noise and filters
{
  const sr = 44100, w = S.noise(1 << 16), p = S.noise(1 << 16, { color: "pink" });
  const band = (m, f0, f1) => { const k0 = Math.round((f0 / sr) * 8192), k1 = Math.round((f1 / sr) * 8192); let s = 0; for (let k = k0; k < k1; k++) s += m[k] * m[k]; return s / (k1 - k0); };
  const avg = x => { const acc = new Float64Array(4097); for (let i = 0; i + 8192 <= x.length; i += 4096) S.spectrum(x, { size: 8192, offset: i }).forEach((v, k) => (acc[k] += v * v)); return acc.map(Math.sqrt); };
  const W = avg(w), Pk = avg(p);
  const wSlope = 10 * Math.log10(band(W, 4000, 8000) / band(W, 500, 1000)) / 3, pSlope = 10 * Math.log10(band(Pk, 4000, 8000) / band(Pk, 500, 1000)) / 3;
  check("white noise is flat", Math.abs(wSlope) < 0.6, `${wSlope.toFixed(2)} dB/octave`);
  check("pink noise falls 3 dB per octave", Math.abs(pSlope + 3) < 0.6, `${pSlope.toFixed(2)} dB/octave`);
  check("noise is seeded", S.noise(8)[3] === S.noise(8)[3] && S.noise(8, { seed: 2 })[3] !== S.noise(8)[3]);
  const lp = { type: "lowpass", freq: 1000 };
  const r = S.response(lp, [10, 1000, 8000], sr);
  check("lowpass response: flat, -3 dB at the cutoff, falling", Math.abs(r[0] - 1) < 1e-3 && Math.abs(20 * Math.log10(r[1]) + 3.01) < 0.05 && r[2] < 0.02, Array.from(r, v => v.toFixed(3)).join(", "));
  const bp = S.response({ type: "bandpass", freq: 2000, q: 5 }, [2000], sr);
  check("bandpass has 0 dB at its center", Math.abs(bp[0] - 1) < 1e-6);
  const y = S.filter(S.fromFunction(t => Math.sin(TAU * 6000 * t), { duration: 0.2 }), lp, sr);
  const amp = S.rms(y.subarray(2000)) * Math.SQRT2, want = S.response(lp, [6000], sr)[0];
  check("filtering a sine scales it by |H|", Math.abs(amp - want) < 0.002, `${amp.toFixed(4)} vs ${want.toFixed(4)}`);
}

// Envelopes
{
  const env = { a: 0.1, d: 0.2, s: 0.5, r: 0.4 };
  check("ADSR attack", Math.abs(S.adsr(0.05, env) - 0.5) < 1e-12);
  check("ADSR decay", Math.abs(S.adsr(0.2, env) - 0.75) < 1e-12);
  check("ADSR sustain", S.adsr(5, env) === 0.5);
  check("ADSR release", Math.abs(S.adsr(1.2, env, 1) - 0.25) < 1e-12 && S.adsr(1.5, env, 1) === 0);
  check("release from mid-attack starts where the attack was", Math.abs(S.adsr(0.05, env, 0.05) - 0.5) < 1e-12);
}

// Voices and buttons work silently without an audio device.
{
  const v = S.voice({ harmonics: [1, 0.5], freq: 220 });
  v.set({ freq: 330, harmonics: [1, 0.25] });
  check("voice keeps its parameters", v.params.freq === 330 && v.params.harmonics[1] === 0.25 && v.params.type === "additive");
  v.start();
  check("voice plays silently without audio", v.playing && !v.audible);
  const w = S.voice({ type: "noise", color: "pink" });
  w.start();
  check("starting another voice with no figure leaves both (same owner)", v.playing && w.playing);
  S.stopAll();
  check("stopAll", !v.playing && !w.playing);
  const b = S.button(v, { label: "Listen" });
  check("button is a runtime button control", b.type === "button" && b.label === "Listen" && typeof b.action === "function");
  const pb = S.play(t => Math.sin(TAU * 440 * t), { duration: 0.05 });
  check("one-shot plays silently and reports its length", pb.playing && Math.abs(pb.duration - 0.05) < 1e-9);
  pb.stop();
  check("one-shot stops", !pb.playing);
  S.volume = 7;
  check("volume is capped at 1", S.volume === 1);
}

// Canvas helpers register and run against a recording g.
{
  const calls = [];
  const rec = name => (...args) => { calls.push(name); return name === "measure" ? String(args[0]).length * 7 : undefined; };
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => {} }) }) };
  const g = { w: 640, h: 400, ctx };
  for (const k of ["line", "path", "circle", "rect", "arrow", "text", "label", "measure"]) g[k] = rec(k);
  g.clip = (box, fn) => fn(g);
  const util = { color: c => c, rgb: () => [10, 20, 30], clamp: (x, a, b) => Math.min(b, Math.max(a, x)) };
  check("one extension registered", window.__safisG.length === 1);
  window.__safisG[0](g, util);
  const x = S.karplus({ freq: 196, duration: 0.5 });
  const W = g.waveform(x, [0, 0, 600, 100], { playhead: 0.3 });
  check("waveform maps samples to px", Math.abs(W.y(0) - 50) < 1e-9 && W.x(0) === 0 && W.index(600) === x.length - 1);
  g.waveform(x.subarray(0, 60), [0, 0, 600, 100], { stems: true, fill: true });
  const sp = g.spectrum(S.spectrum(x), [0, 120, 600, 120], { maxFreq: 4000, peaks: 3 });
  check("spectrum maps frequency to px", Math.abs(sp.x(4000) - 600) < 1e-9 && Math.abs(sp.x(0)) < 1e-9);
  g.spectrum([1, 0.5, 0.33], [0, 0, 300, 100], { freqs: [220, 440, 660], peaks: 2, db: true });
  const sg = g.spectrogram(S.stft(x, { size: 256 }), [0, 250, 600, 140], { maxFreq: 5000 });
  check("spectrogram maps px back to time and frequency", Math.abs(sg.freq(250) - 5000) < 1e-9 && sg.time(0) === 0);
  g.envelope({ a: 0.05, d: 0.2, s: 0.6, r: 0.5 }, [0, 0, 300, 100], { t: 0.1 });
  check("helpers drew", calls.length > 40, `${calls.length} calls`);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
