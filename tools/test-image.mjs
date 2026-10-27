#!/usr/bin/env node
// Tests for src/image.js (window.Img) that run in Node: convolution, resampling,
// dithering, the DCT, histograms, speed at 256x256, and a smoke test of the g helpers.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(await readFile(path.join(root, "src/image.js"), "utf8"))();
const I = window.Img;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };
const meanOf = im => I.stats(im).mean;
const maxAbs = im => im.data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// Test images
{
  const s = I.scene(96);
  check("scene is RGB in 0..1", s.w === 96 && s.h === 96 && s.data.length === 96 * 96 * 3 && s.data.every(v => v >= 0 && v <= 1));
  check("scene is cached by its parameters", I.scene(96) === s && I.scene(96, 64) !== s);
  const st = I.stats(s);
  check("scene has a range of tones", st.min < 0.12 && st.max > 0.9, `${st.min.toFixed(2)} to ${st.max.toFixed(2)}`);
  check("scene is in color", !I.isGray(s));
  const c = I.checker(16, 16, 4);
  check("checker", I.get(c, 0, 0)[0] === 1 && I.get(c, 4, 0)[0] === 0 && I.get(c, 4, 4)[0] === 1);
  const z = I.zonePlate(64);
  check("zone plate starts white at the center", I.get(z, 32, 32)[0] > 0.99);
  const gr = I.gradient(256, 4);
  check("gradient runs from black to white", I.get(gr, 0, 0)[0] === 0 && I.get(gr, 255, 0)[0] === 1);
  const gl = I.glyph("A", 18);
  check("glyph falls back to the bitmap font without a canvas", gl.w === 14 && gl.h === 18 && gl.data.some(v => v === 0) && gl.data.some(v => v === 1));
}

// Convolution
{
  const s = I.scene(64), m0 = meanOf(s);
  const b = I.convolve(s, I.kernels.box(5), { edge: "wrap" }), m1 = meanOf(b);
  check("box blur preserves the mean (wrapped edges, exactly)", m0.every((v, c) => Math.abs(v - m1[c]) < 1e-6), m1.map(v => v.toFixed(6)).join(" "));
  const bc = meanOf(I.convolve(s, I.kernels.box(3)));
  check("box blur nearly preserves the mean (clamped edges)", m0.every((v, c) => Math.abs(v - bc[c]) < 0.01));
  const gs = meanOf(I.blur(s, 2, { edge: "wrap" }));
  check("Gaussian blur preserves the mean", m0.every((v, c) => Math.abs(v - gs[c]) < 1e-5));
  const flat = I.make(32, 32, () => 0.37);
  check("Sobel x is zero on a flat image", maxAbs(I.convolve(flat, I.kernels.sobelX())) === 0);
  check("Sobel y is zero on a flat image", maxAbs(I.convolve(flat, I.kernels.sobelY())) === 0);
  check("Sobel magnitude is zero on a flat image", maxAbs(I.sobel(flat).mag) === 0);
  check("Laplacian is zero on a flat image", maxAbs(I.convolve(flat, I.kernels.laplacian())) < 1e-6);
  const step = I.make(32, 32, x => (x < 16 ? 0 : 1)), e = I.sobel(step);
  check("Sobel finds a vertical edge at full strength", Math.abs(I.get(e.mag, 15, 10)[0] - 1) < 1e-6 && I.get(e.mag, 5, 10)[0] === 0 && I.get(e.gy, 15, 10)[0] === 0);
  const id = I.convolve(s, I.kernels.identity(3));
  check("identity kernel changes nothing", id.data.every((v, i) => Math.abs(v - s.data[i]) < 1e-7));
  // The separable path and the direct path agree (gaussian is separable; this tweak isn't).
  const k = I.kernels.binomial(3), k2 = k.map(r => r.slice());
  k2[0][0] += 1e-3;
  const a = I.convolve(s, k), b2 = I.convolve(s, k2);
  check("separable and direct convolution agree", a.data.every((v, i) => Math.abs(v - b2.data[i]) < 2e-3));
  // Convolution flips the kernel: a kernel with a single 1 to the right of center moves the image right.
  const shift = I.convolve(step, [[0, 0, 0], [0, 0, 1], [0, 0, 0]]);
  check("convolution flips the kernel (a 1 right of center moves the image right)", I.get(shift, 16, 5)[0] === 0 && I.get(shift, 17, 5)[0] === 1);
  check("binomial kernel is [1 2 1] x [1 2 1] / 16", JSON.stringify(I.kernels.binomial(3).map(r => r.map(v => v * 16))) === "[[1,2,1],[2,4,2],[1,2,1]]");
}

// Resampling
{
  const z = I.zonePlate(128), n = I.resize(z, 32, 32, "nearest"), a = I.resize(z, 32, 32, "area");
  const sd = im => { const L = I.luma(im); let m = 0, v = 0; for (const x of L) m += x / L.length; for (const x of L) v += (x - m) ** 2 / L.length; return Math.sqrt(v); };
  check("nearest keeps aliased contrast; area averages it away", sd(n) > 0.3 && sd(a) < 0.25, `${sd(n).toFixed(2)} vs ${sd(a).toFixed(2)}`);
  check("area downsampling preserves the mean", Math.abs(I.stats(a).luma - I.stats(z).luma) < 1e-3);
  const g = I.gradient(16, 1), up = I.resize(g, 64, 1, "bilinear");
  check("bilinear upsampling stays between neighbors and is monotonic", up.data.every((v, i) => i < 3 || v >= up.data[i - 3] - 1e-7));
  const c = I.checker(8, 8, 1), cn = I.resize(c, 32, 32, "nearest");
  check("nearest upsampling copies whole pixels", I.get(cn, 0, 0)[0] === 1 && I.get(cn, 3, 3)[0] === 1 && I.get(cn, 4, 0)[0] === 0);
}

// Quantization and dithering
{
  const g = I.gradient(256, 64), q = I.quantize(g, 4);
  check("quantize to 4 levels", new Set(Array.from(q.data, v => v.toFixed(4))).size === 4);
  for (const method of ["floyd", "ordered", "random"]) {
    const d = I.dither(g, 2, { method }), vals = new Set(d.data);
    const err = Math.abs(I.stats(d).luma - I.stats(g).luma);
    check(`${method} dithering to black and white preserves the mean tone`, vals.size === 2 && err < 0.01, `error ${err.toFixed(4)}`);
  }
  const s = I.scene(64), d = I.dither(s, 2, { gray: true });
  check("dithering a photo in gray preserves its mean tone", Math.abs(I.stats(d).luma - I.stats(s).luma) < 0.01);
  // Locally too: blurred dither looks like the original, blurred threshold doesn't.
  const bd = I.blur(I.dither(g, 2), 3), bq = I.blur(I.quantize(g, 2), 3), eD = I.mse(bd, I.blur(g, 3)), eQ = I.mse(bq, I.blur(g, 3));
  check("seen from afar, dithering looks like the original and thresholding doesn't", eD < eQ / 10, `${eD.toExponential(1)} vs ${eQ.toExponential(1)}`);
}

// DCT and JPEG
{
  const r = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const blk = Float64Array.from({ length: 64 }, () => r() * 255 - 128);
  const back = I.idct8(I.dct8(blk));
  const err = blk.reduce((m, v, i) => Math.max(m, Math.abs(v - back[i])), 0);
  check("DCT round trip is exact without quantization", err < 1e-10, err.toExponential(1));
  const e0 = blk.reduce((s, v) => s + v * v, 0), e1 = I.dct8(blk).reduce((s, v) => s + v * v, 0);
  check("the DCT is orthonormal (energy is kept)", Math.abs(e0 - e1) / e0 < 1e-12);
  const flat = I.dct8(new Float64Array(64).fill(10));
  check("a flat block is all DC", Math.abs(flat[0] - 80) < 1e-9 && flat.slice(1).every(v => Math.abs(v) < 1e-9));
  const b = I.dct8(Float64Array.from({ length: 64 }, (_, i) => Math.cos(((2 * (i % 8) + 1) * 3 * Math.PI) / 16)));
  check("a basis pattern lands on one coefficient", b.every((v, i) => (i === 3 ? Math.abs(v) > 1 : Math.abs(v) < 1e-9)));
  check("zigzag order", I.ZIGZAG.slice(0, 10).join(",") === "0,1,8,16,9,2,3,10,17,24" && new Set(I.ZIGZAG).size === 64 && I.ZIGZAG[63] === 63);
  check("quality 50 is the standard table", I.quantTable(50).join(",") === I.QUANT_LUMA.join(","));
  check("quality 100 is all ones", I.quantTable(100).every(v => v === 1));
  check("chroma table", I.QUANT_CHROMA[0] === 17 && I.QUANT_CHROMA[27] === 99 && I.QUANT_CHROMA[24] === 47);
  const s = I.scene(64), hi = I.jpeg(s, { quality: 90 }), lo = I.jpeg(s, { quality: 10 });
  check("lower quality keeps fewer coefficients and loses more", lo.nonzero < hi.nonzero && lo.psnr < hi.psnr, `${hi.nonzero} vs ${lo.nonzero}, ${hi.psnr.toFixed(1)} vs ${lo.psnr.toFixed(1)} dB`);
  const g90 = I.jpeg(I.gray(s), { quality: 90 }), full = I.jpeg(s, { quality: 90, subsample: false });
  check("quality 90 in gray is close to the original", g90.psnr > 35, `${g90.psnr.toFixed(1)} dB`);
  check("halving the chroma costs some fidelity", full.psnr > hi.psnr, `${full.psnr.toFixed(1)} vs ${hi.psnr.toFixed(1)} dB`);
  const all = I.jpeg(I.gray(s), { keep: 64 });
  check("keeping every coefficient reproduces a gray image", all.psnr > 100, `${all.psnr.toFixed(1)} dB`);
  const dc = I.jpeg(I.gray(s), { keep: 1 });
  check("keeping only DC gives flat 8x8 blocks", I.get(dc.img, 0, 0)[0] === I.get(dc.img, 7, 7)[0] && I.get(dc.img, 0, 0)[0] !== I.get(dc.img, 8, 0)[0]);
}

// Histograms
{
  const g = I.gradient(256, 10), h = I.histogram(g);
  check("histogram of a ramp is flat", h.length === 256 && h.every(v => v === 10));
  const n = I.histogram(I.scene(64), { normalize: true });
  check("normalized histogram sums to 1", Math.abs(n.reduce((a, b) => a + b, 0) - 1) < 1e-5);
  const rgb = I.histogram(I.scene(64), { channel: "rgb", bins: 32 });
  check("rgb histogram", rgb.r.length === 32 && rgb.b.reduce((a, b) => a + b, 0) === 64 * 64);
  const dim = I.map(I.scene(64), (r, g, b) => [r * 0.4, g * 0.4, b * 0.4]), eq = I.histogram(I.equalize(dim), { bins: 4, normalize: true });
  check("equalizing spreads the tones", eq.every(v => v > 0.15 && v < 0.35), Array.from(eq, v => v.toFixed(2)).join(" "));
}

// Speed at 256x256 (cold, then cached)
{
  const s = I.scene(256);
  const time = (name, fn, budget) => { const t = performance.now(); fn(); const ms = performance.now() - t; check(`${name} on 256x256 in ${budget} ms`, ms < budget, `${ms.toFixed(1)} ms`); };
  time("3x3 convolution", () => I.convolve(s, I.kernels.sharpen(1)), 25);
  time("Gaussian blur, sigma 3", () => I.blur(s, 3), 25);
  time("Sobel", () => I.sobel(s), 25);
  time("resize to 64", () => I.resize(s, 64, 64, "area"), 15);
  time("Floyd-Steinberg dither", () => I.dither(s, 2), 15);
  time("JPEG round trip", () => I.jpeg(s, { quality: 50 }), 40);
  time("histogram", () => I.histogram(s), 10);
  const t = performance.now();
  I.blur(s, 3);
  check("a repeated operation comes from the cache", performance.now() - t < 0.5);
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
  const util = { color: c => c, rgb: c => (c === "ink" ? [17, 17, 17] : [250, 250, 250]), clamp: (x, a, b) => Math.min(b, Math.max(a, x)) };
  check("one extension registered", window.__safisG.length === 1);
  window.__safisG[0](g, util);
  const R = g.pixels(I.scene(64), [0, 0, 320, 320], { mark: [8, 8, 8, 8] });
  check("pixels fit with whole-pixel cells", R.cell === 5 && R.box[2] === 320);
  check("pixels map screen points to pixels and back", JSON.stringify(R.at([12, 7])) === "[2,1]" && R.at([-1, 5]) === null && JSON.stringify(R.center(2, 1)) === "[12.5,7.5]");
  const n0 = calls.length;
  const Z = g.pixels(I.gray(I.scene(64)), [0, 0, 320, 320], { src: [10, 10, 8, 8] });
  check("zoomed-in gray pixels get a grid and their values", Z.cell === 40 && calls.slice(n0).filter(c => c === "text").length === 64);
  const K = g.kernel(I.kernels.binomial(3), [0, 0, 200, 200]);
  check("kernel shows whole numbers over a denominator", K.denominator === 16 && JSON.stringify(K.hit(K.center(2, 1))) === "[2,1]");
  check("decimal kernels stay decimal", g.kernel(I.kernels.gaussian(1), [0, 0, 200, 200]).denominator === 1);
  const H = g.histogram(I.histogram(I.scene(64)), [0, 0, 300, 120], { mark: 0.5 });
  check("histogram maps tone to px", H.x(0) === 0 && H.x(1) === 300 && H.tone(150) === 0.5);
  g.histogram(I.histogram(I.scene(64), { channel: "rgb" }), [0, 0, 300, 120], { log: true });
  check("helpers drew", calls.length > 200, `${calls.length} calls`);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
