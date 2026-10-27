/* Image kit (window.Img): procedural test images, pixel operations (convolution, resampling,
   quantization, dithering, the 8x8 DCT behind JPEG, histograms), and crisp pixel drawing
   on g. An image is { w, h, data: Float32Array RGB, row by row, values 0 to 1 }.
   Operations never change their input; they return new images, cached by their parameters.
   Reference: references/images.md in the skill. */
(() => {
  "use strict";
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hasDoc = typeof document !== "undefined";

  // ---------- Images, ids, and the cache ----------
  let nextId = 1;
  const anon = new WeakMap();
  const idOf = im => im.id ?? anon.get(im) ?? (anon.set(im, `a${nextId++}`), anon.get(im));
  function image(w, h, data) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    return { w, h, data: data ?? new Float32Array(w * h * 3), id: nextId++ };
  }
  // Least recently used results, kept under a memory budget (about 24 MB of pixels).
  const cache = new Map();
  let cached = 0;
  const BUDGET = 6e6;
  const sizeOf = v => (v?.data?.length ?? 0) + (v?.img?.data?.length ?? 0) + (v?.length ?? 0);
  function memo(key, fn) {
    if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
    const v = fn();
    cache.set(key, v); cached += sizeOf(v);
    while ((cached > BUDGET || cache.size > 120) && cache.size > 1) {
      const k = cache.keys().next().value;
      cached -= sizeOf(cache.get(k)); cache.delete(k);
    }
    return v;
  }
  const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;   // BT.601, the weights JPEG uses

  function make(w, h, fn) {
    const im = image(w, h), d = im.data;
    for (let y = 0, i = 0; y < im.h; y++) for (let x = 0; x < im.w; x++, i += 3) {
      const v = fn(x, y, (x + 0.5) / im.w, (y + 0.5) / im.h);
      if (typeof v === "number") d[i] = d[i + 1] = d[i + 2] = v;
      else { d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; }
    }
    return im;
  }
  const get = (im, x, y) => { const i = (clamp(Math.round(y), 0, im.h - 1) * im.w + clamp(Math.round(x), 0, im.w - 1)) * 3; return [im.data[i], im.data[i + 1], im.data[i + 2]]; };
  const isGray = im => { const d = im.data; for (let i = 0; i < d.length; i += 3) if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) return false; return true; };

  // ---------- Test images ----------
  function rng(seed = 1) {
    let a = seed >>> 0 || 1;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function valueNoise(seed) {
    const N = 64, r = rng(seed), grid = new Float32Array(N * N);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const i0 = ((xi % N) + N) % N, j0 = ((yi % N) + N) % N, i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
      const a = grid[j0 * N + i0], b = grid[j0 * N + i1], c = grid[j1 * N + i0], d = grid[j1 * N + i1];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }
  // A country scene with what a photo has: smooth sky, texture, hard edges, fine repeats (the
  // fence aliases when shrunk), saturated colors, and tones from shadow to highlight.
  function scene(w = 128, h = w, o = {}) {
    return memo(`scene|${w}|${h}|${o.seed ?? 1}`, () => {
      const N = valueNoise(o.seed ?? 1), fbm = (x, y) => (N(x, y) * 4 + N(x * 2.03, y * 2.03) * 2 + N(x * 4.1, y * 4.1)) / 7;
      const col = (u, v) => {
        const mount = 0.4 + 0.07 * Math.sin(u * 7 + 1) + 0.045 * Math.sin(u * 17 + 2) + 0.05 * (N(u * 9, 3.3) - 0.5);
        const hill = 0.6 + 0.035 * Math.sin(u * 5 + 0.5) + 0.018 * Math.sin(u * 13);
        let r, g, b;
        if (v < mount) {
          const t = Math.pow(v / mount, 1.3), d = Math.hypot(u - 0.76, v - 0.17), glow = 0.4 * Math.exp(-((d / 0.13) ** 2));
          r = 0.2 + 0.52 * t + glow; g = 0.42 + 0.42 * t + glow * 0.85; b = 0.78 + 0.16 * t + glow * 0.4;
          const cl = smooth(0.5, 0.72, fbm(u * 5, v * 11)) * Math.exp(-(((v - 0.25) / 0.09) ** 2)) * 0.9;
          r += (0.97 - r) * cl; g += (0.97 - g) * cl; b += (0.98 - b) * cl;
          const sun = smooth(0.056, 0.05, d);
          r += (1 - r) * sun; g += (0.95 - g) * sun; b += (0.78 - b) * sun;
        } else if (v < hill) {
          const tex = N(u * 34, v * 34) - 0.5, k = 0.92 + 0.3 * tex - 0.25 * (v - mount);
          r = 0.4 * k + 0.12; g = 0.45 * k + 0.12; b = 0.56 * k + 0.13;
          if (mount < 0.38 && v < mount + (0.38 - mount) * 0.85 + 0.01 * tex) { r = 0.9 + 0.08 * tex; g = 0.92 + 0.08 * tex; b = 0.97 + 0.04 * tex; }
        } else {
          const tex = fbm(u * 40, v * 70), dark = 1 - 0.35 * (v - hill) / (1 - hill);
          r = (0.2 + 0.18 * tex) * dark; g = (0.42 + 0.28 * tex) * dark; b = (0.14 + 0.12 * tex) * dark;
          const pc = 0.64 - (v - hill) * 0.3, pw = 0.008 + (v - hill) * 0.42;
          if (Math.abs(u - pc) < pw) { const k = 0.82 + 0.3 * tex; r = 0.8 * k; g = 0.69 * k; b = 0.5 * k; }
        }
        // A tree in front of the hills.
        const dt = Math.hypot((u - 0.12) * 1.1, v - 0.55);
        if (u > 0.108 && u < 0.134 && v > 0.58 && v < 0.7) { r = 0.33; g = 0.21; b = 0.12; }
        if (dt < 0.085 + 0.022 * (N(u * 30, v * 30) - 0.5)) { const k = 0.6 + 0.8 * fbm(u * 26, v * 26) - (v - 0.5) * 1.2; r = 0.1 * k; g = 0.3 * k; b = 0.12 * k; }
        // A house: white wall, red roof with shingle lines, window, door, chimney.
        if (u > 0.41 && u < 0.44 && v > 0.45 && v < 0.52) { r = 0.55; g = 0.22; b = 0.16; }
        if (v > 0.44 && v < 0.552 && Math.abs(u - 0.36) < ((v - 0.44) / 0.112) * 0.125) {
          const s = (v - 0.44) % 0.0125 < 0.002 ? 0.7 : 1; r = 0.74 * s; g = 0.17 * s; b = 0.12 * s;
        }
        if (u > 0.26 && u < 0.46 && v >= 0.552 && v < 0.71) {
          r = 0.94 - 0.15 * (u - 0.26); g = 0.91 - 0.15 * (u - 0.26); b = 0.84 - 0.12 * (u - 0.26);
          if (u > 0.285 && u < 0.345 && v > 0.578 && v < 0.64) {
            const bar = Math.abs(u - 0.315) < 0.003 || Math.abs(v - 0.609) < 0.003;
            r = bar ? 0.95 : 0.16; g = bar ? 0.95 : 0.22; b = bar ? 0.93 : 0.34;
          }
          if (u > 0.375 && u < 0.43 && v > 0.6) { r = 0.43; g = 0.25; b = 0.13; }
        }
        // A picket fence across the front: thin, regular, and close together.
        if (v > 0.76 && v < 0.87) {
          const p = (u % 0.03) / 0.03, top = 0.765 + Math.abs(p - 0.27) * 0.04;
          const picket = p < 0.54 && v > top, rail = Math.abs(v - 0.79) < 0.005 || Math.abs(v - 0.845) < 0.005;
          if (picket || rail) { const k = picket ? 1 - 0.18 * p : 0.88; r = 0.93 * k; g = 0.91 * k; b = 0.87 * k; }
        }
        return [r, g, b];
      };
      const aa = o.aa ?? (w * h > 40000 ? 1 : 2);
      return make(w, h, (x, y) => {
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < aa; j++) for (let i = 0; i < aa; i++) {
          const c = col((x + (i + 0.5) / aa) / w, (y + (j + 0.5) / aa) / h);
          r += c[0]; g += c[1]; b += c[2];
        }
        const n = aa * aa;
        return [clamp(r / n, 0, 1), clamp(g / n, 0, 1), clamp(b / n, 0, 1)];
      });
    });
  }
  function checker(w = 64, h = w, cell = 8, o = {}) {
    const [a, b] = o.colors ?? [[1, 1, 1], [0, 0, 0]];
    return memo(`checker|${w}|${h}|${cell}|${a}|${b}`, () => make(w, h, (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? b : a)));
  }
  // Rings whose frequency rises with radius, reaching the Nyquist limit (half a cycle per
  // pixel) at the edge when scale is 1: every frequency at once, the classic aliasing test.
  function zonePlate(w = 128, h = w, o = {}) {
    const k = o.scale ?? 1;
    return memo(`zone|${w}|${h}|${k}`, () => make(w, h, (x, y) => {
      const dx = x + 0.5 - w / 2, dy = y + 0.5 - h / 2;
      return 0.5 + 0.5 * Math.cos((Math.PI * k * (dx * dx + dy * dy)) / Math.min(w, h));
    }));
  }
  function gradient(w = 256, h = 32, o = {}) {
    const a = o.from ?? [0, 0, 0], b = o.to ?? [1, 1, 1], dir = o.dir ?? "x";
    return memo(`grad|${w}|${h}|${a}|${b}|${dir}`, () => make(w, h, (x, y, u, v) => {
      const t = dir === "y" ? (y / Math.max(1, h - 1)) : dir === "radial" ? clamp(Math.hypot(u - 0.5, v - 0.5) * 2, 0, 1) : x / Math.max(1, w - 1);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }));
  }
  // A 5x7 bitmap font (rows as base-32 digits) for pixel glyphs and for Node, where there is no canvas.
  const FONT = {};
  "ehhvhhh uhhuhhu ehggghe sihhhis vgguggv vgguggg ehgnhhf hhhvhhh e44444e 72222ic hikokih ggggggv hrllhhh hpljhhh ehhhhhe uhhuggg ehhhlid uhhukih fgge11u v444444 hhhhhhe hhhhha4 hhhllla hha4ahh hha4444 v1248gv ehjlphe 4c4444e eh1248v v2421he 26aiv22 vgu11he 68guhhe v124888 ehhehhe ehhf12c eh12404"
    .split(" ").forEach((s, i) => { FONT["ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?"[i]] = [...s].map(c => parseInt(c, 32)); });
  function glyph(ch = "A", size = 64, o = {}) {
    const ink = o.invert ? 1 : 0, paper = 1 - ink;
    return memo(`glyph|${ch}|${size}|${o.pixel ? 1 : 0}|${o.invert ? 1 : 0}|${o.font ?? ""}|${o.weight ?? ""}`, () => {
      if (o.pixel || !hasDoc) {
        const rows = FONT[String(ch).toUpperCase()] ?? FONT["?"], s = Math.max(1, Math.round(size / 9));
        return make(7 * s, 9 * s, (x, y) => {
          const cx = Math.floor(x / s) - 1, cy = Math.floor(y / s) - 1;
          return cx >= 0 && cx < 5 && cy >= 0 && cy < 7 && (rows[cy] >> (4 - cx)) & 1 ? ink : paper;
        });
      }
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const c2 = cv.getContext("2d"), css = getComputedStyle(document.documentElement);
      const family = o.font ?? (css.getPropertyValue("--font-serif").trim() || "Georgia, serif");
      c2.fillStyle = "#fff"; c2.fillRect(0, 0, size, size);
      c2.fillStyle = "#000"; c2.textAlign = "center"; c2.textBaseline = "alphabetic";
      c2.font = `${o.weight ?? 500} ${Math.round(size * 0.78)}px ${family}`;
      const m = c2.measureText(ch), asc = m.actualBoundingBoxAscent ?? size * 0.55, desc = m.actualBoundingBoxDescent ?? 0;
      c2.fillText(ch, size / 2, size / 2 + (asc - desc) / 2);
      const px = c2.getImageData(0, 0, size, size).data;
      return make(size, size, (x, y) => { const v = px[(y * size + x) * 4] / 255; return o.invert ? 1 - v : v; });
    });
  }

  // Embedded images (a data: URL in the page), decoded once and shrunk to fit maxSize.
  const loads = new Map(), loaded = new Map();
  function fromDataURL(url, o = {}) {
    const key = `${o.maxSize ?? 256}|${url}`;
    if (!loads.has(key)) {
      loads.set(key, new Promise((resolve, reject) => {
        if (!hasDoc) return reject(new Error("Img.fromDataURL needs a browser"));
        const el = new Image();
        el.onload = () => {
          const max = o.maxSize ?? 256, k = Math.min(1, max / Math.max(el.naturalWidth, el.naturalHeight));
          const w = Math.max(1, Math.round(el.naturalWidth * k)), h = Math.max(1, Math.round(el.naturalHeight * k));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const c2 = cv.getContext("2d");
          c2.imageSmoothingQuality = "high";
          c2.drawImage(el, 0, 0, w, h);
          const px = c2.getImageData(0, 0, w, h).data, im = image(w, h);
          for (let i = 0, j = 0; i < w * h; i++, j += 3) { im.data[j] = px[i * 4] / 255; im.data[j + 1] = px[i * 4 + 1] / 255; im.data[j + 2] = px[i * 4 + 2] / 255; }
          loaded.set(key, im);
          resolve(im);
        };
        el.onerror = () => reject(new Error("Img.fromDataURL couldn't decode the image"));
        el.src = url;
      }));
    }
    return loads.get(key);
  }
  const peek = (url, o = {}) => loaded.get(`${o.maxSize ?? 256}|${url}`) ?? null;

  // ---------- Point operations ----------
  function luma(im) {
    return memo(`luma|${idOf(im)}`, () => {
      const d = im.data, out = new Float32Array(im.w * im.h);
      for (let i = 0, j = 0; i < out.length; i++, j += 3) out[i] = lumaOf(d[j], d[j + 1], d[j + 2]);
      return out;
    });
  }
  const fromPlane = (w, h, p) => { const im = image(w, h); for (let i = 0, j = 0; i < p.length; i++, j += 3) im.data[j] = im.data[j + 1] = im.data[j + 2] = p[i]; return im; };
  const gray = im => memo(`gray|${idOf(im)}`, () => fromPlane(im.w, im.h, luma(im)));
  const CH = { r: 0, g: 1, b: 2, red: 0, green: 1, blue: 2 };
  function channel(im, c, o = {}) {
    const k = CH[c] ?? c;
    return memo(`chan|${idOf(im)}|${k}|${o.tint ? 1 : 0}`, () => {
      const out = image(im.w, im.h), d = im.data, e = out.data;
      for (let j = 0; j < d.length; j += 3) { if (o.tint) e[j + k] = d[j + k]; else e[j] = e[j + 1] = e[j + 2] = d[j + k]; }
      return out;
    });
  }
  function map(im, fn) {
    const out = image(im.w, im.h), d = im.data, e = out.data;
    for (let i = 0, j = 0; j < d.length; i++, j += 3) {
      const v = fn(d[j], d[j + 1], d[j + 2], i % im.w, Math.floor(i / im.w));
      if (typeof v === "number") e[j] = e[j + 1] = e[j + 2] = v; else { e[j] = v[0]; e[j + 1] = v[1]; e[j + 2] = v[2]; }
    }
    return out;
  }
  const invert = im => memo(`inv|${idOf(im)}`, () => map(im, (r, g, b) => [1 - r, 1 - g, 1 - b]));
  function crop(im, x, y, w, h) {
    return memo(`crop|${idOf(im)}|${x}|${y}|${w}|${h}`, () => make(w, h, (i, j) => get(im, x + i, y + j)));
  }
  function diff(a, b, o = {}) {
    const k = o.gain ?? 1;
    return memo(`diff|${idOf(a)}|${idOf(b)}|${k}`, () => { const out = image(a.w, a.h); for (let i = 0; i < out.data.length; i++) out.data[i] = Math.abs(a.data[i] - b.data[i]) * k; return out; });
  }
  function stats(im) {
    const d = im.data, n = im.w * im.h, mean = [0, 0, 0];
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < d.length; j += 3) for (let c = 0; c < 3; c++) { mean[c] += d[j + c]; min = Math.min(min, d[j + c]); max = Math.max(max, d[j + c]); }
    for (let c = 0; c < 3; c++) mean[c] /= n;
    return { mean, luma: lumaOf(...mean), min, max };
  }
  function mse(a, b) { let s = 0; for (let i = 0; i < a.data.length; i++) { const e = a.data[i] - b.data[i]; s += e * e; } return s / a.data.length; }
  const psnr = (a, b) => { const m = mse(a, b); return m ? 10 * Math.log10(1 / m) : Infinity; };

  // ---------- Convolution ----------
  const kernels = {
    identity: (n = 3) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j && i === (n - 1) / 2 ? 1 : 0))),
    box: (n = 3) => Array.from({ length: n }, () => Array(n).fill(1 / (n * n))),
    gaussian(sigma = 1, n = 2 * Math.ceil(3 * sigma) + 1) {
      const c = (n - 1) / 2, row = Array.from({ length: n }, (_, i) => Math.exp(-((i - c) ** 2) / (2 * sigma * sigma))), s = row.reduce((a, b) => a + b, 0);
      return row.map(a => row.map(b => (a * b) / (s * s)));
    },
    // Pascal's triangle: [1 2 1] x [1 2 1] / 16, the integer kernel that approximates a Gaussian.
    binomial(n = 3) {
      let row = [1];
      for (let i = 1; i < n; i++) row = [...row, 0].map((v, j) => v + (row[j - 1] ?? 0));
      const s = row.reduce((a, b) => a + b, 0);
      return row.map(a => row.map(b => (a * b) / (s * s)));
    },
    sharpen: (a = 1) => [[0, -a, 0], [-a, 1 + 4 * a, -a], [0, -a, 0]],
    sobelX: () => [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
    sobelY: () => [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
    laplacian: () => [[0, 1, 0], [1, -4, 1], [0, 1, 0]],
    edge: () => [[-1, -1, -1], [-1, 8, -1], [-1, -1, -1]],
    emboss: () => [[-2, -1, 0], [-1, 1, 1], [0, 1, 2]],
  };
  // A kernel that is an outer product col x row runs as two 1D passes (n + n instead of n * n).
  function separate(k) {
    let pi = 0, pj = 0, max = 0;
    k.forEach((r, i) => r.forEach((v, j) => { if (Math.abs(v) > max) { max = Math.abs(v); pi = i; pj = j; } }));
    if (!max) return null;
    const col = k.map(r => r[pj]), row = k[pi].map(v => v / k[pi][pj]);
    return k.every((r, i) => r.every((v, j) => Math.abs(v - col[i] * row[j]) <= 1e-12 * max)) ? { col, row } : null;
  }
  // Source index for each padded position, for the edge rule: clamp (repeat the border), wrap, or zero (-1).
  function indexes(n, r, edge) {
    const out = new Int32Array(n + 2 * r);
    for (let i = -r; i < n + r; i++) out[i + r] = edge === "wrap" ? ((i % n) + n) % n : edge === "zero" ? (i < 0 || i >= n ? -1 : i) : clamp(i, 0, n - 1);
    return out;
  }
  // planes: arrays of Float32Array (one per channel), each w * h. Every pass works a whole
  // row at a time, tap by tap, so memory is read in order; only border pixels use the edge tables.
  function rowTap(acc, p, rowp, c, shift, w, r, ix, i) {
    const lo = Math.min(r, w), hi = Math.max(r, w - r);
    for (let x = lo; x < hi; x++) acc[x] += c * p[rowp + x + shift];
    for (let x = 0; x < lo; x++) { const sx = ix[x + i]; if (sx >= 0) acc[x] += c * p[rowp + sx]; }
    for (let x = hi; x < w; x++) { const sx = ix[x + i]; if (sx >= 0) acc[x] += c * p[rowp + sx]; }
  }
  function pass1d(planes, w, h, taps, horizontal, edge) {
    const L = taps.length, r = (L - 1) / 2, f = Float64Array.from(taps).reverse(), idx = indexes(horizontal ? w : h, r, edge);
    return planes.map(p => {
      const out = new Float32Array(w * h), acc = new Float64Array(w);
      for (let y = 0; y < h; y++) {
        acc.fill(0);
        for (let t = 0; t < L; t++) {
          const c = f[t];
          if (!c) continue;
          if (horizontal) rowTap(acc, p, y * w, c, t - r, w, r, idx, t);
          else { const q = idx[y + t]; if (q < 0) continue; const b = q * w; for (let x = 0; x < w; x++) acc[x] += c * p[b + x]; }
        }
        out.set(acc, y * w);
      }
      return out;
    });
  }
  function conv2d(planes, w, h, k, edge) {
    const kh = k.length, kw = k[0].length, ry = (kh - 1) / 2, rx = (kw - 1) / 2, ix = indexes(w, rx, edge), iy = indexes(h, ry, edge);
    return planes.map(p => {
      const out = new Float32Array(w * h), acc = new Float64Array(w);
      for (let y = 0; y < h; y++) {
        acc.fill(0);
        for (let j = 0; j < kh; j++) {
          const sy = iy[y + j];
          if (sy < 0) continue;
          for (let i = 0; i < kw; i++) { const c = k[kh - 1 - j][kw - 1 - i]; if (c) rowTap(acc, p, sy * w, c, i - rx, w, rx, ix, i); }   // flipped
        }
        out.set(acc, y * w);
      }
      return out;
    });
  }
  const planesOf = (im, grayOnly) => {
    if (grayOnly) return [luma(im)];
    const n = im.w * im.h, ps = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0, j = 0; i < n; i++, j += 3) { ps[0][i] = im.data[j]; ps[1][i] = im.data[j + 1]; ps[2][i] = im.data[j + 2]; }
    return ps;
  };
  function fromPlanes(w, h, ps, o = {}) {
    const im = image(w, h), d = im.data, off = o.offset ?? 0, sc = o.scale ?? 1;
    for (let i = 0, j = 0; i < w * h; i++, j += 3) for (let c = 0; c < 3; c++) {
      let v = ps[ps.length === 1 ? 0 : c][i] * sc;
      if (o.abs) v = Math.abs(v);
      d[j + c] = v + off;
    }
    return im;
  }
  // True convolution (the kernel is flipped), odd-sized kernels. Results are not clamped:
  // an edge kernel gives negative numbers; draw them with o.abs or o.offset: 0.5.
  function convolve(im, k, o = {}) {
    if (k.length % 2 === 0 || k[0].length % 2 === 0) throw new Error("Img.convolve needs a kernel with odd width and height");
    const edge = o.edge ?? "clamp";
    return memo(`conv|${idOf(im)}|${k.map(r => r.join(",")).join(";")}|${edge}|${o.abs ? 1 : 0}|${o.offset ?? 0}|${o.scale ?? 1}|${o.gray ? 1 : 0}`, () => {
      const ps = planesOf(im, o.gray), sep = separate(k);
      const out = sep ? pass1d(pass1d(ps, im.w, im.h, sep.row, true, edge), im.w, im.h, sep.col, false, edge) : conv2d(ps, im.w, im.h, k, edge);
      return fromPlanes(im.w, im.h, out, o);
    });
  }
  function blur(im, sigma = 1, o = {}) {
    if (sigma <= 0) return im;
    return memo(`blur|${idOf(im)}|${sigma}|${o.edge ?? "clamp"}`, () => {
      const g = kernels.gaussian(sigma), row = g[(g.length - 1) / 2].map(v => v / g[(g.length - 1) / 2][(g.length - 1) / 2]);
      const s = row.reduce((a, b) => a + b, 0), taps = row.map(v => v / s), edge = o.edge ?? "clamp";
      return fromPlanes(im.w, im.h, pass1d(pass1d(planesOf(im), im.w, im.h, taps, true, edge), im.w, im.h, taps, false, edge));
    });
  }
  // Sobel gradients of the luma: gx, gy (signed) and the edge strength mag, as gray images.
  function sobel(im, o = {}) {
    return memo(`sobel|${idOf(im)}|${o.edge ?? "clamp"}`, () => {
      const gx = convolve(im, kernels.sobelX(), { gray: true, edge: o.edge }), gy = convolve(im, kernels.sobelY(), { gray: true, edge: o.edge });
      const mag = image(im.w, im.h);
      for (let j = 0; j < mag.data.length; j += 3) mag.data[j] = mag.data[j + 1] = mag.data[j + 2] = Math.hypot(gx.data[j], gy.data[j]) / 4;
      return { gx, gy, mag };
    });
  }

  // ---------- Resampling ----------
  // For each of m outputs along an axis of n pixels: the first source pixel and its weights.
  function axisWeights(n, m, method) {
    const k = n / m, start = new Int32Array(m), count = new Int32Array(m), off = new Int32Array(m), wts = [];
    for (let i = 0; i < m; i++) {
      let s, ws;
      if (method === "nearest") { s = Math.min(n - 1, Math.floor((i + 0.5) * k)); ws = [1]; }
      else if (method === "area" && k > 1) {
        const a = i * k, b = (i + 1) * k;
        s = Math.floor(a); ws = [];
        for (let j = s; j < Math.min(n, Math.ceil(b)); j++) ws.push((Math.min(b, j + 1) - Math.max(a, j)) / k);
      } else if (n === 1) { s = 0; ws = [1]; }
      else { const x = clamp((i + 0.5) * k - 0.5, 0, n - 1), j = Math.min(Math.floor(x), n - 2), f = x - j; s = j; ws = [1 - f, f]; }
      start[i] = s; count[i] = ws.length; off[i] = wts.length; wts.push(...ws);
    }
    return { start, count, off, w: Float64Array.from(wts) };
  }
  // "nearest" copies the closest pixel, "bilinear" blends the four around, "area" averages
  // every pixel a target pixel covers (the antialiased way to shrink; bilinear when enlarging).
  function resize(im, w, h, method = "bilinear") {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    return memo(`resize|${idOf(im)}|${w}|${h}|${method}`, () => {
      const X = axisWeights(im.w, w, method), Y = axisWeights(im.h, h, method), d = im.data, W = im.w;
      const tmp = new Float32Array(w * im.h * 3), out = image(w, h), e = out.data;
      for (let y = 0; y < im.h; y++) for (let x = 0; x < w; x++) {
        const s = X.start[x], c = X.count[x], o = X.off[x];
        let r = 0, g = 0, b = 0;
        for (let t = 0; t < c; t++) { const q = (y * W + s + t) * 3, wt = X.w[o + t]; r += wt * d[q]; g += wt * d[q + 1]; b += wt * d[q + 2]; }
        const k = (y * w + x) * 3;
        tmp[k] = r; tmp[k + 1] = g; tmp[k + 2] = b;
      }
      for (let y = 0; y < h; y++) {
        const s = Y.start[y], c = Y.count[y], o = Y.off[y], row = y * w * 3;
        for (let t = 0; t < c; t++) {
          const wt = Y.w[o + t], src = (s + t) * w * 3;
          for (let i = 0; i < w * 3; i++) e[row + i] += wt * tmp[src + i];
        }
      }
      return out;
    });
  }

  // ---------- Quantization and dithering ----------
  const q = (v, L) => Math.round(clamp(v, 0, 1) * (L - 1)) / (L - 1);
  function quantize(im, levels = 4) {
    const L = Math.max(2, Math.round(levels));
    return memo(`quant|${idOf(im)}|${L}`, () => map(im, (r, g, b) => [q(r, L), q(g, L), q(b, L)]));
  }
  const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  // levels per channel; method "floyd" (error diffusion, default), "ordered" (8x8 Bayer), or "random".
  function dither(im, levels = 2, o = {}) {
    const L = Math.max(2, Math.round(levels)), method = o.method ?? "floyd";
    return memo(`dither|${idOf(im)}|${L}|${method}|${o.gray ? 1 : 0}|${o.serpentine ? 1 : 0}`, () => {
      const { w, h } = im, ps = planesOf(im, o.gray), step = 1 / (L - 1), r = rng(o.seed ?? 9);
      const out = ps.map(p => {
        if (method !== "floyd") {
          return p.map((v, i) => {
            const t = method === "random" ? r() - 0.5 : (BAYER[((Math.floor(i / w) & 7) << 3) | (i % w & 7)] + 0.5) / 64 - 0.5;
            return q(v + t * step, L);
          });
        }
        const e = Float32Array.from(p), res = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
          const back = o.serpentine && y % 2, dx = back ? -1 : 1;
          for (let k = 0; k < w; k++) {
            const x = back ? w - 1 - k : k, i = y * w + x, v = e[i], nv = q(v, L), err = v - nv;
            res[i] = nv;
            // Floyd and Steinberg (1976): 7/16 ahead, 3/16 behind below, 5/16 below, 1/16 ahead below.
            if (x + dx >= 0 && x + dx < w) e[i + dx] += (err * 7) / 16;
            if (y + 1 < h) {
              if (x - dx >= 0 && x - dx < w) e[i + w - dx] += (err * 3) / 16;
              e[i + w] += (err * 5) / 16;
              if (x + dx >= 0 && x + dx < w) e[i + w + dx] += err / 16;
            }
          }
        }
        return res;
      });
      return fromPlanes(w, h, out);
    });
  }

  // ---------- The JPEG idea: 8x8 DCT and quantization ----------
  const COS = new Float64Array(64);
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = (u ? 0.5 : Math.SQRT1_2 / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  // Orthonormal 2D DCT-II of 64 values, row by row (index y * 8 + x). Coefficient (u, v) is at v * 8 + u.
  const T64 = new Float64Array(64);
  function dct8(b, out = new Float64Array(64)) {
    const t = T64;
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += b[y * 8 + x] * COS[x * 8 + u]; t[y * 8 + u] = s; }
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let y = 0; y < 8; y++) s += t[y * 8 + u] * COS[y * 8 + v]; out[v * 8 + u] = s; }
    return out;
  }
  function idct8(c, out = new Float64Array(64)) {
    const t = T64;
    for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += c[v * 8 + u] * COS[x * 8 + u]; t[v * 8 + x] = s; }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let s = 0; for (let v = 0; v < 8; v++) s += t[v * 8 + x] * COS[y * 8 + v]; out[y * 8 + x] = s; }
    return out;
  }
  // The example tables from the JPEG standard (ITU T.81, Annex K).
  const QUANT_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const QUANT_CHROMA = Array.from({ length: 64 }, (_, i) => [17, 18, 24, 47, 18, 21, 26, 66, 24, 26, 56, 99, 47, 66, 99, 99][(i >> 3) < 4 && (i & 7) < 4 ? (i >> 3) * 4 + (i & 7) : 15] ?? 99);
  // Quality 1-100 scales the table the way libjpeg does.
  function quantTable(quality = 50, chroma = false) {
    const qq = clamp(Math.round(quality), 1, 100), s = qq < 50 ? 5000 / qq : 200 - 2 * qq;
    return (chroma ? QUANT_CHROMA : QUANT_LUMA).map(v => clamp(Math.floor((v * s + 50) / 100), 1, 255));
  }
  const ZIGZAG = (() => {
    const out = [];
    for (let s = 0; s < 15; s++) for (let i = 0; i <= s; i++) { const a = s % 2 ? s - i : i, b = s - a; if (a < 8 && b < 8) out.push(b * 8 + a); }
    return out;
  })();
  // One 8x8 block of luma, 0-255, at block column bx, block row by.
  function block(im, bx, by) {
    const L = luma(im), out = new Float64Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = 255 * L[clamp(by * 8 + y, 0, im.h - 1) * im.w + clamp(bx * 8 + x, 0, im.w - 1)];
    return out;
  }
  const fromBlock = (vals, scale = 255) => fromPlane(8, 8, Float32Array.from(vals, v => clamp(v / scale, 0, 1)));
  function dctBasis(u, v, n = 8) {
    return memo(`basis|${u}|${v}|${n}`, () => make(n, n, (x, y) => 0.5 + 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)) * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * n))));
  }
  // Compress and decompress: YCbCr, optional 4:2:0 chroma, 8x8 DCT, quantize, and back.
  // o.quality (50), o.keep (keep only the first n zigzag coefficients instead of quantizing),
  // o.subsample (true for color), o.gray. Returns { img, nonzero, total, ratio, psnr }.
  function jpeg(im, o = {}) {
    const color = !(o.gray ?? isGray(im)), sub = color && o.subsample !== false;
    return memo(`jpeg|${idOf(im)}|${o.quality ?? 50}|${o.keep ?? ""}|${color}|${sub}`, () => {
      const { w, h } = im, d = im.data, n = w * h, Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const r = d[j] * 255, g = d[j + 1] * 255, b = d[j + 2] * 255;
        Y[i] = lumaOf(r, g, b); Cb[i] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b; Cr[i] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      }
      let nonzero = 0, total = 0;
      const code = (p, pw, ph, table) => {
        const out = new Float32Array(pw * ph), blk = new Float64Array(64), c = new Float64Array(64), r = new Float64Array(64);
        for (let by = 0; by < ph; by += 8) for (let bx = 0; bx < pw; bx += 8) {
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = p[Math.min(by + y, ph - 1) * pw + Math.min(bx + x, pw - 1)] - 128;
          dct8(blk, c);
          for (let z = 0; z < 64; z++) {
            const k = ZIGZAG[z];
            if (o.keep != null) { if (z >= o.keep) c[k] = 0; }
            else c[k] = Math.round(c[k] / table[k]) * table[k];
            if (c[k]) nonzero++;
          }
          total += 64;
          idct8(c, r);
          for (let y = 0; y < 8 && by + y < ph; y++) for (let x = 0; x < 8 && bx + x < pw; x++) out[(by + y) * pw + bx + x] = r[y * 8 + x] + 128;
        }
        return out;
      };
      const half = p => {
        const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2), out = new Float32Array(hw * hh);
        for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
          let s = 0;
          for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) s += p[Math.min(2 * y + j, h - 1) * w + Math.min(2 * x + i, w - 1)];
          out[y * hw + x] = s / 4;
        }
        return [out, hw, hh];
      };
      const tl = quantTable(o.quality ?? 50), tc = quantTable(o.quality ?? 50, true);
      const y2 = code(Y, w, h, tl);
      let cb2 = Cb, cr2 = Cr, cw = w;
      if (color) {
        if (sub) { const [a, hw, hh] = half(Cb), [b] = half(Cr); cb2 = code(a, hw, hh, tc); cr2 = code(b, hw, hh, tc); cw = hw; }
        else { cb2 = code(Cb, w, h, tc); cr2 = code(Cr, w, h, tc); }
      }
      const out = image(w, h), e = out.data;
      for (let y = 0, j = 0; y < h; y++) for (let x = 0; x < w; x++, j += 3) {
        const Yv = y2[y * w + x];
        if (!color) { e[j] = e[j + 1] = e[j + 2] = clamp(Yv / 255, 0, 1); continue; }
        const ci = sub ? (y >> 1) * cw + (x >> 1) : y * w + x, cb = cb2[ci] - 128, cr = cr2[ci] - 128;
        e[j] = clamp((Yv + 1.402 * cr) / 255, 0, 1); e[j + 1] = clamp((Yv - 0.344136 * cb - 0.714136 * cr) / 255, 0, 1); e[j + 2] = clamp((Yv + 1.772 * cb) / 255, 0, 1);
      }
      return { img: out, nonzero, total, ratio: nonzero / total, psnr: psnr(im, out) };
    });
  }

  // ---------- Histograms ----------
  // Counts per bin of tone 0-1: o.channel "luma" (default), "r", "g", "b", or "rgb" for { r, g, b }.
  function histogram(im, o = {}) {
    const bins = o.bins ?? 256, ch = o.channel ?? "luma";
    if (ch === "rgb") return { r: histogram(im, { ...o, channel: "r" }), g: histogram(im, { ...o, channel: "g" }), b: histogram(im, { ...o, channel: "b" }) };
    return memo(`hist|${idOf(im)}|${bins}|${ch}|${o.normalize ? 1 : 0}`, () => {
      const out = new Float32Array(bins), n = im.w * im.h, L = ch === "luma" ? luma(im) : null, k = CH[ch] ?? 0;
      for (let i = 0; i < n; i++) out[clamp(Math.floor((L ? L[i] : im.data[i * 3 + k]) * bins), 0, bins - 1)]++;
      if (o.normalize) for (let i = 0; i < bins; i++) out[i] /= n;
      return out;
    });
  }
  // Spread the tones so each luma level is used about equally; colors keep their hue.
  function equalize(im) {
    return memo(`eq|${idOf(im)}`, () => {
      const h = histogram(im, { bins: 256 }), cdf = new Float32Array(256), n = im.w * im.h, L = luma(im);
      let s = 0;
      for (let i = 0; i < 256; i++) { s += h[i]; cdf[i] = s / n; }
      const c0 = cdf.find(v => v > 0) ?? 0;
      return map(im, (r, g, b, x, y) => {
        const l = L[y * im.w + x], t = (cdf[clamp(Math.floor(l * 256), 0, 255)] - c0) / (1 - c0 || 1), k = l > 1e-4 ? t / l : 0;
        return l > 1e-4 ? [r * k, g * k, b * k] : t;
      });
    });
  }

  // ---------- Drawing helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    const canvases = new Map();
    function canvasOf(im) {
      const key = idOf(im);
      let cv = canvases.get(key);
      if (cv && cv.width === im.w && cv.height === im.h) { canvases.delete(key); canvases.set(key, cv); return cv; }
      cv = document.createElement("canvas");
      cv.width = im.w; cv.height = im.h;
      const c2 = cv.getContext("2d"), px = c2.createImageData(im.w, im.h), d = im.data;
      for (let i = 0, j = 0; i < im.w * im.h; i++, j += 3) { const k = i * 4; px.data[k] = d[j] * 255; px.data[k + 1] = d[j + 1] * 255; px.data[k + 2] = d[j + 2] * 255; px.data[k + 3] = 255; }
      c2.putImageData(px, 0, 0);
      canvases.set(key, cv);
      if (canvases.size > 32) canvases.delete(canvases.keys().next().value);
      return cv;
    }
    const lum = c => { const p = util.rgb(c); return lumaOf(p[0], p[1], p[2]) / 255; };

    // Crisp pixels: each image pixel becomes a cell of whole screen pixels. Zoomed in far
    // enough, a grid separates the cells and each shows its value (0-255).
    g.pixels = (im, box = [0, 0, g.w, g.h], o = {}) => {
      const [sx, sy, sw, sh] = o.src ?? [0, 0, im.w, im.h], labelH = o.label ? 20 : 0;
      let cw = box[2] / sw, chh = (box[3] - labelH) / sh;
      if (o.fit !== "fill") cw = chh = Math.min(cw, chh);
      if (o.cell) cw = chh = o.cell;
      if (o.fit !== "fill" && cw >= 2 && o.snap !== false) cw = chh = Math.floor(cw);
      const W = cw * sw, H = chh * sh;
      const x0 = Math.round(o.align === "left" ? box[0] : o.align === "right" ? box[0] + box[2] - W : box[0] + (box[2] - W) / 2);
      const y0 = Math.round(o.valign === "top" ? box[1] : box[1] + (box[3] - labelH - H) / 2);
      const ctx = g.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = !!o.smooth;
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      ctx.drawImage(canvasOf(im), sx, sy, sw, sh, x0, y0, W, H);
      ctx.restore();
      const grid = o.grid ?? "auto", values = o.values ?? "auto", ink = lum("ink"), paper = lum("panel");
      if (grid === true || (grid === "auto" && cw >= 12)) {
        const lw = cw >= 24 ? 1.5 : 1;
        for (let i = 1; i < sw; i++) g.line([x0 + i * cw, y0], [x0 + i * cw, y0 + H], { stroke: "panel", width: lw, alpha: 0.9 });
        for (let j = 1; j < sh; j++) g.line([x0, y0 + j * chh], [x0 + W, y0 + j * chh], { stroke: "panel", width: lw, alpha: 0.9 });
      }
      const mono = values !== false && cw >= 20 && (o.channel != null || isGray(im)), need = mono ? 30 : 46;
      if (values === true || (values === "auto" && cw >= need)) {
        const fmt = o.format ?? (v => String(Math.round(clamp(v, 0, 1) * 255)));
        const size = Math.min(13, cw * (mono ? 0.32 : 0.24));
        for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
          const p = get(im, sx + i, sy + j), l = lumaOf(...p), c = Math.abs(l - ink) > Math.abs(l - paper) ? "ink" : "panel";
          const cx = x0 + (i + 0.5) * cw, cy = y0 + (j + 0.5) * chh;
          if (mono) g.text(fmt(o.channel != null ? p[CH[o.channel] ?? o.channel] : p[0]), [cx, cy], { size, weight: 600, color: c, font: "mono" });
          else p.forEach((v, k) => g.text(fmt(v), [cx, cy + (k - 1) * size * 1.15], { size, weight: 600, color: c, font: "mono" }));
        }
      }
      if (o.frame !== false) g.rect(x0 - 0.5, y0 - 0.5, W + 1, H + 1, { stroke: "faint", width: 1 });
      for (const m of o.mark ? (Array.isArray(o.mark[0]) ? o.mark : [o.mark]) : []) {
        g.rect(x0 + (m[0] - sx) * cw, y0 + (m[1] - sy) * chh, (m[2] ?? 1) * cw, (m[3] ?? 1) * chh, { stroke: o.markColor ?? "orange", width: 2 });
      }
      if (o.label) g.text(o.label, [x0 + W / 2, y0 + H + 13], { size: 12.5, weight: 500, color: "muted" });
      return {
        box: [x0, y0, W, H], cell: cw,
        at(p) { const i = Math.floor((p[0] - x0) / cw), j = Math.floor((p[1] - y0) / chh); return i >= 0 && j >= 0 && i < sw && j < sh ? [sx + i, sy + j] : null; },
        rect: (i, j, w = 1, h = 1) => [x0 + (i - sx) * cw, y0 + (j - sy) * chh, w * cw, h * chh],
        center: (i, j) => [x0 + (i - sx + 0.5) * cw, y0 + (j - sy + 0.5) * chh],
      };
    };

    // A kernel as a grid of its weights. When every weight is a whole number over a common
    // denominator (box 1/9, binomial 1/16), the grid shows the whole numbers and "× 1/16".
    g.kernel = (k, box = [0, 0, g.w, g.h], o = {}) => {
      const rows = k.length, cols = k[0].length, flat = k.flat(), max = Math.max(...flat.map(Math.abs)) || 1;
      let den = o.denominator ?? 1;
      if (o.denominator == null) for (let d = 1; d <= 1024; d++) if (flat.every(v => Math.abs(v * d - Math.round(v * d)) < 1e-6)) { den = d; break; }
      if (o.denominator == null && !flat.every(v => Math.abs(v * den - Math.round(v * den)) < 1e-6)) den = 1;
      const exact = flat.every(v => Math.abs(v * den - Math.round(v * den)) < 1e-6), noteH = den > 1 && o.note !== false ? 20 : 0;
      const cell = Math.floor(Math.min(o.cell ?? Infinity, box[2] / cols, (box[3] - noteH) / rows)), W = cell * cols, H = cell * rows;
      const x0 = Math.round(box[0] + (box[2] - W) / 2), y0 = Math.round(o.valign === "top" ? box[1] : box[1] + (box[3] - noteH - H) / 2);
      const show = v => (exact ? String(Math.round(v * den)) : Math.abs(v) < 0.005 ? "0" : v.toFixed(cell > 44 ? 3 : 2).replace(/^(-?)0\./, "$1.")).replace("-", "−");
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const v = k[i][j], x = x0 + j * cell, y = y0 + i * cell;
        g.rect(x, y, cell, cell, { fill: "panel" });
        if (v) g.rect(x, y, cell, cell, { fill: v > 0 ? o.positive ?? "blue" : o.negative ?? "red", alpha: 0.08 + 0.32 * (Math.abs(v) / max) });
        g.rect(x + 0.5, y + 0.5, cell - 1, cell - 1, { stroke: "grid", width: 1 });
        if (o.values !== false) g.text(show(v), [x + cell / 2, y + cell / 2 + 0.5], { size: Math.min(15, cell * 0.36), weight: 600, color: v ? "ink" : "muted", font: "mono" });
      }
      if (o.highlight) { const [i, j] = o.highlight; g.rect(x0 + j * cell, y0 + i * cell, cell, cell, { stroke: "ink", width: 2 }); }
      g.rect(x0, y0, W, H, { stroke: "muted", width: 1.25 });
      if (noteH) g.text(`× 1/${den}`, [x0 + W / 2, y0 + H + 13], { size: 12.5, weight: 500, color: "muted" });
      if (o.label) g.text(o.label, [x0 + W / 2, y0 - 12], { size: 12.5, weight: 600, color: "ink" });
      return {
        box: [x0, y0, W, H], cell, denominator: den,
        hit(p) { const j = Math.floor((p[0] - x0) / cell), i = Math.floor((p[1] - y0) / cell); return i >= 0 && j >= 0 && i < rows && j < cols ? [i, j] : null; },
        center: (i, j) => [x0 + (j + 0.5) * cell, y0 + (i + 0.5) * cell],
      };
    };

    // A histogram of tones (from Img.histogram), dark on the left and light on the right.
    g.histogram = (hist, box = [0, 0, g.w, g.h], o = {}) => {
      const sets = hist.r ? [[hist.r, "red"], [hist.g, "green"], [hist.b, "blue"]] : [[hist, o.color ?? "ink"]];
      const n = sets[0][0].length, axisH = o.axis !== false ? 18 : 0, [bx, by, bw] = box, bh = box[3] - axisH;
      const f = v => (o.log ? Math.log1p(v) : v);
      let top = o.max != null ? f(o.max) : 0;
      if (o.max == null) for (const [a] of sets) for (let i = 0; i < n; i++) top = Math.max(top, f(a[i]));
      top = top || 1;
      const X = t => bx + t * bw, Y = c => by + bh - (Math.min(f(c), top) / top) * bh;
      for (const [a, c] of sets) {
        const pts = [[bx, by + bh]];
        for (let i = 0; i < n; i++) { const y = Y(a[i]); pts.push([X(i / n), y], [X((i + 1) / n), y]); }
        pts.push([bx + bw, by + bh]);
        g.path(pts, { fill: c, alpha: sets.length > 1 ? 0.28 : 0.75, close: true });
        if (sets.length > 1) g.path(pts.slice(1, -1), { stroke: c, width: 1.25 });
      }
      g.line([bx, by + bh], [bx + bw, by + bh], { stroke: "muted", width: 1 });
      for (const t of [].concat(o.mark ?? [])) g.line([X(t), by], [X(t), by + bh], { stroke: o.markColor ?? "orange", width: 1.5, dash: [4, 3] });
      if (axisH) {
        const [a, b] = o.ends ?? ["0", "255"];
        g.text(a, [bx, by + bh + 11], { size: 11.5, color: "muted", align: "left" });
        g.text(b, [bx + bw, by + bh + 11], { size: 11.5, color: "muted", align: "right" });
        if (o.label) g.text(o.label, [bx + bw / 2, by + bh + 11], { size: 12, color: "muted" });
      }
      return { box: [bx, by, bw, bh], x: X, y: Y, tone: px => clamp((px - bx) / bw, 0, 1) };
    };
  });

  window.Img = {
    image, make, get, isGray, idOf,
    scene, checker, zonePlate, gradient, glyph, fromDataURL, peek,
    luma, gray, channel, map, invert, crop, diff, stats, mse, psnr,
    kernels, convolve, blur, sobel, resize, quantize, dither,
    dct8, idct8, quantTable, QUANT_LUMA, QUANT_CHROMA, ZIGZAG, block, fromBlock, dctBasis, jpeg,
    histogram, equalize,
  };
})();
