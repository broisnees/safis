/* Plot kit for explainer figures. g.graph(o) draws axes and returns a plot that
   draws curves, areas, fields, and markers in data coordinates; window.Num holds
   the numerics a figure shares with its model; the other helpers added to g draw
   springs, charges, atoms, bars, heatmaps, networks, and tokens in the house style.
   Reference: references/plots.md in the skill. */
(() => {
  "use strict";
  const TAU = Math.PI * 2;
  const MINUS = "−", NBSP = " ", THIN = " ";
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- Num: numerics shared by models and figures ----------
  const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻", "+": "⁺" };
  const sup = s => String(s).replace(/[0-9+-]/g, ch => SUP[ch]);
  // Digits after the decimal point that a step like 0.25 or 5e-4 needs.
  const decimals = x => {
    const m = String(+Number(x).toPrecision(10)).match(/^-?\d*(?:\.(\d+))?(?:e([+-]\d+))?$/);
    return m ? Math.max(0, (m[1]?.length ?? 0) - (m[2] ? +m[2] : 0)) : 0;
  };
  const group = i => (i.length > 4 ? i.replace(/\B(?=(\d{3})+(?!\d))/g, THIN) : i);

  // Number for display: true minus sign, thin-space thousands, 1.2×10⁻⁴ for tiny and huge values.
  // o: digits [3] significant, fixed (decimals), trim (drop trailing zeros), sign ("+" on positives), unit, sci [true].
  function fmt(x, o = {}) {
    if (typeof o === "number") o = { digits: o };
    if (x == null || Number.isNaN(x)) return "–";
    let s;
    if (!Number.isFinite(x)) s = "∞";
    else {
      const ax = Math.abs(x);
      if (o.fixed != null) {
        s = ax.toFixed(o.fixed);
        if (o.trim && s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
      } else if (ax !== 0 && o.sci !== false && (ax >= 1e6 || ax < 1e-3)) {
        let e = Math.floor(Math.log10(ax)), m = +(ax / 10 ** e).toPrecision(o.digits ?? 3);
        if (m >= 10) { m = +(m / 10).toPrecision(o.digits ?? 3); e++; }
        s = (m === 1 ? "" : m + "×") + "10" + sup(e);
      } else s = String(+ax.toPrecision(o.digits ?? 3));
      if (!s.includes("×") && !s.includes("10⁻") && !/e/.test(s)) { const [i, f] = s.split("."); s = group(i) + (f ? "." + f : ""); }
    }
    if (x < 0 && /[1-9∞]/.test(s)) s = MINUS + s;
    else if (o.sign && x > 0) s = "+" + s;
    if (o.unit) s += /^[°%′″]/.test(o.unit) ? o.unit : NBSP + o.unit;
    return s;
  }

  const SI = { "-15": "f", "-12": "p", "-9": "n", "-6": "µ", "-3": "m", 0: "", 3: "k", 6: "M", 9: "G", 12: "T" };
  // 0.0042 s -> "4.2 ms", 15300 N -> "15.3 kN".
  function si(x, unit = "", o = {}) {
    const digits = o.digits ?? 3;
    if (!Number.isFinite(x) || x === 0) return fmt(x, { unit: unit || undefined });
    let e = clamp(Math.floor(Math.log10(Math.abs(x)) / 3) * 3, -15, 12);
    if (Math.abs(+(x / 10 ** e).toPrecision(digits)) >= 1000 && e < 12) e += 3;
    const s = fmt(x / 10 ** e, { digits, sci: false }), u = SI[e] + unit;
    return u ? s + NBSP + u : s;
  }

  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  // Multiples of π as text: π/2, 3π/4, −2π. Other values fall back to fmt.
  function piFmt(x, o = {}) {
    const k = x / Math.PI;
    for (const d of o.denoms ?? [1, 2, 3, 4, 6, 8, 12]) {
      const n = Math.round(k * d);
      if (Math.abs(k * d - n) < 1e-9 * Math.max(1, Math.abs(n))) {
        if (n === 0) return "0";
        const c = gcd(Math.abs(n), d), an = Math.abs(n) / c, dd = d / c;
        return (n < 0 ? MINUS : "") + (an === 1 ? "" : an) + "π" + (dd === 1 ? "" : "/" + dd);
      }
    }
    return fmt(x, o);
  }

  // A round step (1, 2, or 5 times a power of ten) giving about n intervals over span.
  function niceStep(span, n = 5) {
    const raw = Math.abs(span) / Math.max(1, n);
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  }
  function ticks(a, b, n = 5, step) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    step = step ?? niceStep(hi - lo, n);
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step, i = 0; v <= hi + step * 1e-9 && i < 2000; v += step, i++) {
      const r = +(Math.round(v / step) * step).toPrecision(12);
      out.push(Math.abs(r) < step * 1e-9 ? 0 : r);
    }
    return out;
  }

  function linspace(a, b, n) {
    if (n < 2) return [a];
    return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
  }
  function range(a, b, step = 1) {
    if (b === undefined) { b = a; a = 0; }
    const n = Math.max(0, Math.ceil((b - a) / step - 1e-9));
    return Array.from({ length: n }, (_, i) => a + i * step);
  }

  // ODEs. f(t, y) returns dy/dt; y is a number or an array of numbers.
  const asVec = (f, y) => (typeof y === "number" ? [(t, Y) => [f(t, Y[0])], [y], true] : [f, y, false]);
  function rk4(f, y, t, dt) {
    const [F, Y, scalar] = asVec(f, y);
    const add = (a, k, s) => a.map((v, i) => v + k[i] * s);
    const k1 = F(t, Y), k2 = F(t + dt / 2, add(Y, k1, dt / 2)), k3 = F(t + dt / 2, add(Y, k2, dt / 2)), k4 = F(t + dt, add(Y, k3, dt));
    const out = Y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    return scalar ? out[0] : out;
  }
  function euler(f, y, t, dt) {
    const [F, Y, scalar] = asVec(f, y);
    const k = F(t, Y), out = Y.map((v, i) => v + k[i] * dt);
    return scalar ? out[0] : out;
  }
  // Advances y by dt in RK4 substeps no longer than maxStep: for step(dt) in live figures.
  function advance(f, y, t, dt, maxStep = 1 / 240) {
    const n = Math.max(1, Math.ceil(Math.abs(dt) / maxStep)), h = dt / n;
    for (let i = 0; i < n; i++) y = rk4(f, y, t + i * h, h);
    return y;
  }
  // Integrates from t0 to t1; returns { t: [...], y: [...] } at every step.
  function ode(f, y0, [t0, t1], o = {}) {
    const n = o.steps ?? Math.max(1, Math.ceil(Math.abs(t1 - t0) / (o.dt ?? (t1 - t0) / 1000)));
    const h = (t1 - t0) / n, T = [t0], Y = [y0];
    let y = y0;
    for (let i = 0; i < n; i++) { y = (o.method === "euler" ? euler : rk4)(f, y, t0 + i * h, h); T.push(t0 + (i + 1) * h); Y.push(y); }
    return { t: T, y: Y };
  }

  // Roots and calculus.
  function bisect(f, a, b, o = {}) {
    let fa = f(a), fb = f(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    if (!(fa * fb < 0)) return NaN;
    const tol = o.tol ?? 1e-12;
    for (let i = 0; i < (o.maxIter ?? 200) && Math.abs(b - a) > tol * Math.max(1, Math.abs(a)); i++) {
      const m = (a + b) / 2, fm = f(m);
      if (fm === 0) return m;
      if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
    }
    return (a + b) / 2;
  }
  function deriv(f, x, h) {
    h = h ?? 1e-5 * Math.max(1, Math.abs(x));
    return (f(x + h) - f(x - h)) / (2 * h);
  }
  function deriv2(f, x, h) {
    h = h ?? 1e-4 * Math.max(1, Math.abs(x));
    return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
  }
  function newton(f, x0, o = {}) {
    const df = o.df ?? (x => deriv(f, x));
    let x = x0;
    for (let i = 0; i < (o.maxIter ?? 60); i++) {
      const fx = f(x), d = df(x);
      if (!Number.isFinite(fx) || !d) return NaN;
      const nx = x - fx / d;
      if (Math.abs(nx - x) <= (o.tol ?? 1e-12) * Math.max(1, Math.abs(nx))) return nx;
      x = nx;
    }
    return Math.abs(f(x)) < 1e-9 ? x : NaN;
  }
  // solve(f, a, b) brackets a root in [a, b]; solve(f, x0) starts Newton's method at x0.
  const solve = (f, a, b, o) => (b == null ? newton(f, a, o) : bisect(f, a, b, o));
  // Every root in [a, b], found from sign changes on n samples.
  function roots(f, a, b, n = 400) {
    const out = [];
    let x0 = a, f0 = f(a);
    for (let i = 1; i <= n; i++) {
      const x1 = a + ((b - a) * i) / n, f1 = f(x1);
      if (f0 === 0) out.push(x0);
      else if (f0 * f1 < 0) out.push(bisect(f, x0, x1));
      x0 = x1; f0 = f1;
    }
    if (f0 === 0) out.push(x0);
    return out.filter((r, i) => Number.isFinite(r) && (i === 0 || Math.abs(r - out[i - 1]) > 1e-9));
  }
  // Simpson's rule with n (even) intervals.
  function integrate(f, a, b, n = 256) {
    n += n % 2;
    const h = (b - a) / n;
    let s = f(a) + f(b);
    for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
    return (s * h) / 3;
  }
  // Piecewise-linear lookup in a table; xs ascending; clamps at the ends.
  function interp(xs, ys, x) {
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    return lerp(ys[lo], ys[hi], (x - xs[lo]) / (xs[hi] - xs[lo]));
  }
  const table = (xs, ys) => x => interp(xs, ys, x);

  // Seeded random numbers (mulberry32), so a figure shows the same "random" data on every load.
  function rng(seed = 1) {
    let a = seed >>> 0;
    const r = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.gauss = (mu = 0, sigma = 1) => mu + sigma * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
    r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    r.pick = arr => arr[Math.floor(r() * arr.length)];
    r.shuffle = arr => { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    return r;
  }

  // Statistics.
  const sum = xs => xs.reduce((s, x) => s + x, 0);
  const mean = xs => sum(xs) / xs.length;
  const variance = (xs, sample = false) => { const m = mean(xs); return sum(xs.map(x => (x - m) ** 2)) / (xs.length - (sample ? 1 : 0)); };
  const std = (xs, sample) => Math.sqrt(variance(xs, sample));
  // Abramowitz and Stegun 7.1.26, error below 1.5e-7.
  function erf(x) {
    const s = Math.sign(x), t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const normalPdf = (x, mu = 0, sigma = 1) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(TAU));
  const normalCdf = (x, mu = 0, sigma = 1) => 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
  function histogram(xs, o = {}) {
    const bins = o.bins ?? 20;
    const [lo, hi] = o.range ?? [Math.min(...xs), Math.max(...xs)];
    const w = (hi - lo) / bins || 1, counts = new Array(bins).fill(0);
    for (const x of xs) { if (x < lo || x > hi) continue; counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++; }
    return { edges: linspace(lo, hi, bins + 1), counts, width: w };
  }

  // Vectors.
  const v2 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
    scale: (a, s) => [a[0] * s, a[1] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1],
    cross: (a, b) => a[0] * b[1] - a[1] * b[0],
    len: a => Math.hypot(a[0], a[1]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    norm: a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
    perp: a => [-a[1], a[0]],
    rot: (a, t) => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)],
    angle: a => Math.atan2(a[1], a[0]),
    lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)],
    polar: (r, t) => [r * Math.cos(t), r * Math.sin(t)],
  };
  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
  };
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  // Small matrices as arrays of rows.
  const mat = {
    identity: n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j))),
    // Matrix times matrix, or matrix times vector when b is a flat array.
    mul(a, b) {
      if (!Array.isArray(b[0])) return a.map(r => dot(r, b));
      return a.map(r => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
    },
    transpose: a => a[0].map((_, j) => a.map(r => r[j])),
    add: (a, b) => a.map((r, i) => r.map((x, j) => x + b[i][j])),
    scale: (a, s) => a.map(r => r.map(x => x * s)),
    det(a) {
      const n = a.length;
      if (n === 1) return a[0][0];
      if (n === 2) return a[0][0] * a[1][1] - a[0][1] * a[1][0];
      if (n === 3) return a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
      const m = a.map(r => r.slice());
      let d = 1;
      for (let k = 0; k < n; k++) {
        let p = k;
        for (let i = k + 1; i < n; i++) if (Math.abs(m[i][k]) > Math.abs(m[p][k])) p = i;
        if (m[p][k] === 0) return 0;
        if (p !== k) { [m[p], m[k]] = [m[k], m[p]]; d = -d; }
        d *= m[k][k];
        for (let i = k + 1; i < n; i++) { const f = m[i][k] / m[k][k]; for (let j = k; j < n; j++) m[i][j] -= f * m[k][j]; }
      }
      return d;
    },
    // Inverse by Gauss-Jordan elimination; null when the matrix is singular.
    inv(a) {
      const n = a.length, m = a.map((r, i) => [...r, ...mat.identity(n)[i]]);
      for (let k = 0; k < n; k++) {
        let p = k;
        for (let i = k + 1; i < n; i++) if (Math.abs(m[i][k]) > Math.abs(m[p][k])) p = i;
        if (Math.abs(m[p][k]) < 1e-12) return null;
        [m[p], m[k]] = [m[k], m[p]];
        const piv = m[k][k];
        for (let j = 0; j < 2 * n; j++) m[k][j] /= piv;
        for (let i = 0; i < n; i++) {
          if (i === k) continue;
          const f = m[i][k];
          for (let j = 0; j < 2 * n; j++) m[i][j] -= f * m[k][j];
        }
      }
      return m.map(r => r.slice(n));
    },
    // Eigenvalues of a 2x2 matrix, larger first, with unit eigenvectors when they are real.
    eigen2(a) {
      const [[p, q], [r, s]] = a, tr = p + s, det = p * s - q * r, disc = (tr * tr) / 4 - det;
      if (disc < -1e-12) {
        const im = Math.sqrt(-disc);
        return { complex: true, values: [{ re: tr / 2, im }, { re: tr / 2, im: -im }], vectors: null };
      }
      const d = Math.sqrt(Math.max(0, disc)), values = [tr / 2 + d, tr / 2 - d];
      const vec = l => {
        if (Math.abs(q) > 1e-12) return v2.norm([q, l - p]);
        if (Math.abs(r) > 1e-12) return v2.norm([l - s, r]);
        return Math.abs(l - p) < Math.abs(l - s) ? [1, 0] : [0, 1];
      };
      return { complex: false, values, vectors: values.map(vec) };
    },
    rotation: t => [[Math.cos(t), -Math.sin(t)], [Math.sin(t), Math.cos(t)]],
  };

  // Complex numbers as { re, im }.
  const C = {
    of: (re, im = 0) => ({ re, im }),
    polar: (r, t) => ({ re: r * Math.cos(t), im: r * Math.sin(t) }),
    add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
    sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
    mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
    div: (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; },
    scale: (a, s) => ({ re: a.re * s, im: a.im * s }),
    conj: a => ({ re: a.re, im: -a.im }),
    abs: a => Math.hypot(a.re, a.im),
    arg: a => Math.atan2(a.im, a.re),
    exp: a => { const e = Math.exp(a.re); return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) }; },
    fmt: (a, o) => (a.im === 0 ? fmt(a.re, o) : `${a.re === 0 ? "" : fmt(a.re, o) + (a.im < 0 ? ` ${MINUS} ` : " + ")}${a.re === 0 && a.im < 0 ? MINUS : ""}${fmt(Math.abs(a.im), o)}i`),
  };

  // Neural-network and language-model pieces.
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const relu = x => Math.max(0, x);
  const gelu = x => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
  const argmax = xs => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0);
  const logsumexp = xs => { const m = Math.max(...xs); return m + Math.log(sum(xs.map(x => Math.exp(x - m)))); };
  // Softmax with temperature T; T near 0 gives all weight to the largest.
  function softmax(xs, T = 1) {
    if (T <= 1e-6) { const k = argmax(xs); return xs.map((_, i) => +(i === k)); }
    const m = Math.max(...xs), e = xs.map(x => Math.exp((x - m) / T)), z = sum(e);
    return e.map(x => x / z);
  }
  const normalize = xs => { const z = sum(xs) || 1; return xs.map(x => x / z); };
  const topK = (xs, k) => xs.map((x, i) => i).sort((a, b) => xs[b] - xs[a]).slice(0, k);
  // Index drawn from a probability list; r is a random number in [0, 1).
  function sample(probs, r = Math.random()) {
    let acc = 0;
    for (let i = 0; i < probs.length; i++) { acc += probs[i]; if (r < acc) return i; }
    return probs.length - 1;
  }
  const entropy = (ps, base = Math.E) => -sum(ps.map(p => (p > 0 ? p * Math.log(p) : 0))) / Math.log(base);
  const crossEntropy = (ps, target) => -Math.log(Math.max(1e-300, ps[target]));

  const Num = {
    fmt, si, piFmt, sup, decimals, niceStep, ticks,
    linspace, range, clamp, lerp,
    rk4, euler, advance, ode,
    bisect, newton, solve, roots, deriv, deriv2, integrate, interp, table,
    rng, sum, mean, variance, std, erf, normalPdf, normalCdf, histogram,
    v2, v3, dot, mat, matmul: mat.mul, C,
    sigmoid, tanh: Math.tanh, relu, gelu, softmax, normalize, argmax, topK, sample, entropy, crossEntropy, logsumexp,
  };

  // ---------- TeX-ish fallback for canvas labels when src/tex.js is absent ----------
  const SYM = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
    iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ",
    chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    cdot: "·", times: "×", pm: "±", infty: "∞", to: "→", approx: "≈", le: "≤", ge: "≥", leq: "≤", geq: "≥", ne: "≠", neq: "≠",
    partial: "∂", nabla: "∇", degree: "°", circ: "°", sum: "Σ", int: "∫", sqrt: "√", propto: "∝", ell: "ℓ", hbar: "ħ",
  };
  const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
    a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ", i: "ᵢ", j: "ⱼ", r: "ᵣ", u: "ᵤ", v: "ᵥ" };
  const SUPX = { ...SUP, n: "ⁿ", i: "ⁱ", "(": "⁽", ")": "⁾", "=": "⁼" };
  function texToUnicode(s) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2").replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1")
      .replace(/\\(?:left|right)/g, "").replace(/\\[,;:! ]/g, THIN)
      .replace(/\\([A-Za-z]+)/g, (m, c) => SYM[c] ?? c);
    const script = (map, body) => [...body].every(ch => map[ch]) ? [...body].map(ch => map[ch]).join("") : null;
    s = s.replace(/([_^])(\{([^{}]*)\}|(.))/g, (m, op, _, braced, single) => {
      const body = braced ?? single;
      return script(op === "_" ? SUB : SUPX, body) ?? (op === "_" ? "_" : "^") + body;
    });
    return s.replace(/[{}]/g, "");
  }

  // ---------- Helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    const ATOM = {
      H: ["panel", 0.7], C: ["ink", 1], N: ["blue", 1], O: ["red", 1], F: ["green", 0.95], Cl: ["green", 1.1], Br: ["orange", 1.2], I: ["purple", 1.3],
      S: ["brass", 1.1], P: ["orange", 1.1], Na: ["purple", 1.15], K: ["purple", 1.25], Li: ["purple", 1], Mg: ["green", 1.1], Ca: ["green", 1.2],
      Fe: ["orange", 1.1], Cu: ["orange", 1.1], Zn: ["muted", 1.1], He: ["muted", 0.8], Ne: ["muted", 0.85], Ar: ["muted", 1], B: ["orange", 0.95], Si: ["brass", 1.15],
    };
    const italicSize = o => (o.size ?? 14) + 1.5;

    // Text that understands two conventions: "$...$" is math (g.tex when present), and a single letter is a variable in italic serif.
    function txt(str, p, o = {}) {
      if (str == null || str === "") return 0;
      const s = String(str), m = s.match(/^\$([\s\S]+)\$$/);
      if (m && g.tex) { const r = g.tex(m[1], p, o); return r?.w ?? 0; }
      if (m || /^[A-Za-zα-ωΑ-Ωϑφϕℓ]$/.test(s)) {
        const u = m ? texToUnicode(m[1]) : s, oo = { ...o, font: "serif", italic: true, size: italicSize(o), weight: o.weight ?? 500 };
        g.text(u, p, oo);
        return g.measure(u, oo);
      }
      g.text(s, p, o);
      return g.measure(s, o);
    }
    function txtWidth(str, o = {}) {
      if (str == null || str === "") return 0;
      const s = String(str), m = s.match(/^\$([\s\S]+)\$$/);
      if (m && g.measureTex) return g.measureTex(m[1], o)?.w ?? 0;
      if (m || /^[A-Za-zα-ωΑ-Ωϑφϕℓ]$/.test(s)) return g.measure(m ? texToUnicode(m[1]) : s, { ...o, font: "serif", italic: true, size: italicSize(o) });
      return g.measure(s, o);
    }
    // A shape filled with the paper color, then a palette tint over it: works with any palette color format.
    const tinted = (draw, c, a) => { draw({ fill: "panel" }); if (c && a > 0) draw({ fill: c, alpha: a }); };
    const head = (tip, dir, size, color) => {
      const [ux, uy] = v2.norm(dir), b = [tip[0] - ux * size, tip[1] - uy * size], w = size * 0.42;
      g.path([tip, [b[0] - uy * w, b[1] + ux * w], [b[0] + uy * w, b[1] - ux * w]], { fill: color, close: true });
    };

    // ----- g.graph -----
    g.graph = (o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h];
      const style = o.axes ?? "cross";
      const logX = o.xScale === "log", logY = o.yScale === "log";
      const fx = logX ? Math.log10 : v => v, fy = logY ? Math.log10 : v => v;
      const gx = logX ? t => 10 ** t : t => t, gy = logY ? t => 10 ** t : t => t;
      const xr = o.x ?? [-1, 1], yr = o.y ?? [-1, 1];
      let X0 = fx(xr[0]), X1 = fx(xr[1]), Y0 = fy(yr[0]), Y1 = fy(yr[1]);
      const pad = o.pad ?? 10, TL = 4;
      const TICK = { size: o.tickSize ?? 11.5, color: "muted", weight: 500 };
      const TICKH = { ...TICK, halo: true, haloWidth: 5 };
      const AXL = { size: o.labelSize ?? 13, color: "ink", weight: 500 };

      // Major and minor ticks for one axis (lo, hi in transformed units, len in px).
      function axisTicks(spec, lo, hi, log, len, spacing, format) {
        const out = { major: [], minor: [], label: v => fmt(v) };
        if (spec === false || spec === null) return out;
        const a = log ? 10 ** lo : lo, b = log ? 10 ** hi : hi, mn = Math.min(a, b), mx = Math.max(a, b);
        const target = Math.max(2, Math.round(len / spacing));
        const obj = spec && typeof spec === "object" && !Array.isArray(spec) ? spec : {};
        const kind = Array.isArray(spec) ? "list" : spec === "pi" || obj.pi ? "pi" : typeof spec === "number" || obj.step ? "step" : log ? "log" : "auto";
        const inside = v => v >= mn - Math.abs(mx - mn) * 1e-9 && v <= mx + Math.abs(mx - mn) * 1e-9;
        if (kind === "list") {
          out.major = spec.filter(inside);
          const dec = Math.max(0, ...out.major.map(decimals));
          out.label = v => fmt(v, { fixed: dec });
        } else if (kind === "pi") {
          const steps = [1 / 12, 1 / 6, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32].map(k => k * Math.PI);
          const step = obj.step ?? steps.find(s => (mx - mn) / s <= target) ?? steps[steps.length - 1];
          out.major = ticks(mn, mx, 0, step);
          out.minor = ticks(mn, mx, 0, step / 2).filter(v => !out.major.some(m => Math.abs(m - v) < step * 1e-6));
          out.label = v => piFmt(v);
        } else if (kind === "log") {
          const k0 = Math.ceil(Math.min(lo, hi) - 1e-9), k1 = Math.floor(Math.max(lo, hi) + 1e-9);
          const every = Math.max(1, Math.ceil((k1 - k0 + 1) / target));
          for (let k = k0; k <= k1; k++) {
            if ((k - k0) % every === 0) out.major.push(10 ** k);
            for (let m = 2; m <= 9 && every === 1; m++) { const v = m * 10 ** k; if (inside(v)) out.minor.push(v); }
          }
          if (every === 1 && k0 - 1 >= Math.floor(Math.min(lo, hi))) for (let m = 2; m <= 9; m++) { const v = m * 10 ** (k0 - 1); if (inside(v)) out.minor.push(v); }
          out.label = v => (v >= 1e-3 && v <= 1e4 ? fmt(v) : "10" + sup(Math.round(Math.log10(v))));
        } else {
          const step = typeof spec === "number" ? spec : obj.step ?? niceStep(mx - mn, target);
          out.major = ticks(mn, mx, 0, step);
          const lead = Math.round(step / 10 ** Math.floor(Math.log10(step)));
          out.minor = ticks(mn, mx, 0, step / (lead === 2 ? 4 : 5)).filter(v => !out.major.some(m => Math.abs(m - v) < step * 1e-6));
          const dec = decimals(step), big = Math.max(Math.abs(mn), Math.abs(mx));
          out.label = big >= 1e6 || (step < 1e-3 && big < 1e-2) ? v => fmt(v) : v => fmt(v, { fixed: dec });
        }
        if (Array.isArray(obj.values)) out.major = obj.values.filter(inside);
        if (obj.minor === false) out.minor = [];
        const f = obj.format ?? format;
        if (f) out.label = f;
        return out;
      }
      const XS = o.xTickSpacing ?? 80, YS = o.yTickSpacing ?? 46;
      let xt = axisTicks(o.xTicks, X0, X1, logX, box[2], XS, o.xFormat);
      let yt = axisTicks(o.yTicks, Y0, Y1, logY, box[3], YS, o.yFormat);
      const yLabW = () => Math.max(0, ...yt.major.map(v => g.measure(yt.label(v), TICK)));
      let ml = pad, mr = pad, mt = pad, mb = pad;
      const wl = yLabW();
      if (style === "frame") {
        ml += wl + TL + 6;
        mb += TL + 15 + (o.xLabel ? 20 : 0);
        mt += o.yLabel ? 22 : 7;
        mr += 12;
      } else if (style === "cross") {
        const xl = logX || Math.min(X0, X1) >= 0, xr2 = !logX && Math.max(X0, X1) <= 0;
        const yb = logY || Math.min(Y0, Y1) >= 0, yt2 = !logY && Math.max(Y0, Y1) <= 0;
        if (xl) ml += wl + TL + 6;
        if (xr2) mr += wl + TL + 6;
        if (yb) mb += TL + 15;
        if (yt2) mt += TL + 15;
        mt += 6; mr += 6;
      }
      let L = box[0] + ml, R = box[0] + box[2] - mr, T = box[1] + mt, B = box[1] + box[3] - mb;
      if (R - L < 8) { L = box[0]; R = box[0] + box[2]; }
      if (B - T < 8) { T = box[1]; B = box[1] + box[3]; }
      let sx = (R - L) / (X1 - X0 || 1), sy = (B - T) / (Y1 - Y0 || 1);
      if (o.equal && !logX && !logY) {
        const s = Math.min(Math.abs(sx), Math.abs(sy)), cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
        const hx = (R - L) / s / 2, hy = (B - T) / s / 2;
        [X0, X1] = X1 > X0 ? [cx - hx, cx + hx] : [cx + hx, cx - hx];
        [Y0, Y1] = Y1 > Y0 ? [cy - hy, cy + hy] : [cy + hy, cy - hy];
        sx = (R - L) / (X1 - X0); sy = (B - T) / (Y1 - Y0);
      }
      xt = axisTicks(o.xTicks, X0, X1, logX, R - L, XS, o.xFormat);
      yt = axisTicks(o.yTicks, Y0, Y1, logY, B - T, YS, o.yFormat);

      const xpx = x => L + (fx(x) - X0) * sx, ypx = y => B - (fy(y) - Y0) * sy;
      const toPx = q => [xpx(q[0]), ypx(q[1])];
      const P = q => toPx(q);
      P.inv = p => [gx(X0 + (p[0] - L) / sx), gy(Y0 + (B - p[1]) / sy)];
      P.xpx = xpx; P.ypx = ypx;
      P.box = [L, T, R - L, B - T];
      P.x = [gx(X0), gx(X1)]; P.y = [gy(Y0), gy(Y1)];
      P.sx = sx; P.sy = sy;
      const zx = logX ? X0 : clamp(0, Math.min(X0, X1), Math.max(X0, X1));
      const zy = logY ? Y0 : clamp(0, Math.min(Y0, Y1), Math.max(Y0, Y1));
      const axX = style === "frame" ? L : L + (zx - X0) * sx, axY = style === "frame" ? B : B - (zy - Y0) * sy;
      P.axis = { x: axX, y: axY };
      P.contains = q => { const p = toPx(q); return p[0] >= L - 0.5 && p[0] <= R + 0.5 && p[1] >= T - 0.5 && p[1] <= B + 0.5; };
      P.near = (p, q, r = 14) => { const c = toPx(q); return Math.hypot(p[0] - c[0], p[1] - c[1]) <= r; };
      const H = B - T, W = R - L, diag = Math.hypot(W, H);
      const lim = p => [clamp(p[0], L - 4 * W, R + 4 * W), clamp(p[1], T - 4 * H, B + 4 * H)];
      const clipped = (so, fn) => (so.clip === false || o.clip === false ? fn() : g.clip([L - 2, T - 2, W + 4, H + 4], fn));
      P.clip = fn => g.clip([L, T, W, H], fn);

      function drawGrid() {
        if (o.grid === false || style === "none" && !o.grid) return;
        const minor = o.grid === "minor" || o.grid === "both";
        const vline = (v, w, a) => { const x = xpx(v); g.line([x, T], [x, B], { stroke: "grid", width: w, alpha: a }); };
        const hline = (v, w, a) => { const y = ypx(v); g.line([L, y], [R, y], { stroke: "grid", width: w, alpha: a }); };
        if (minor) { xt.minor.forEach(v => vline(v, 0.75, 0.7)); yt.minor.forEach(v => hline(v, 0.75, 0.7)); }
        xt.major.forEach(v => vline(v, 1, 1));
        yt.major.forEach(v => hline(v, 1, 1));
      }
      function drawAxes() {
        const ax = { stroke: "muted", width: 1.2 }, tk = { stroke: "muted", width: 1 };
        if (style === "frame") {
          if (o.zeroLine !== false) {
            if (!logY && Math.min(Y0, Y1) < 0 && Math.max(Y0, Y1) > 0) g.line([L, ypx(0)], [R, ypx(0)], { stroke: "muted", width: 0.9, alpha: 0.8 });
            if (!logX && Math.min(X0, X1) < 0 && Math.max(X0, X1) > 0) g.line([xpx(0), T], [xpx(0), B], { stroke: "muted", width: 0.9, alpha: 0.8 });
          }
          g.line([L, T], [L, B], ax);
          g.line([L, B], [R, B], ax);
          for (const v of xt.major) { const x = xpx(v); g.line([x, B], [x, B + TL], tk); g.text(xt.label(v), [x, B + TL + 9], TICK); }
          for (const v of yt.major) { const y = ypx(v); g.line([L - TL, y], [L, y], tk); g.text(yt.label(v), [L - TL - 4, y], { ...TICK, align: "right" }); }
          if (o.xLabel) txt(o.xLabel, [(L + R) / 2, B + TL + 29], { ...AXL, align: "center" });
          if (o.yLabel) txt(o.yLabel, [L - 2, T - 15], { ...AXL, align: "left" });
          return;
        }
        if (style !== "cross") return;
        const tipX = R + 5, tipY = T - 5, arrows = o.arrows !== false;
        g.line([L, axY], [arrows ? tipX - 3 : R, axY], ax);
        g.line([axX, B], [axX, arrows ? tipY + 3 : T], ax);
        if (arrows) { head([tipX, axY], [1, 0], 7, "muted"); head([axX, tipY], [0, -1], 7, "muted"); }
        const zeroX = !logX && zx === 0 && axX > L + 1 && axX < R - 1, zeroY = !logY && zy === 0 && axY > T + 1 && axY < B - 1;
        const below = axY + 24 <= box[1] + box[3];
        for (const v of xt.major) {
          const x = xpx(v);
          if (zeroY && Math.abs(v) < 1e-12 && zeroX) continue;
          g.line([x, axY - 3], [x, axY + 3], tk);
          if (arrows && x > tipX - 16) continue;
          if (zeroX && Math.abs(x - axX) < 1) continue;
          g.text(xt.label(v), [x, below ? axY + TL + 10 : axY - TL - 10], TICKH);
        }
        const lw = yLabW(), leftOK = axX - TL - 6 - lw >= box[0];
        for (const v of yt.major) {
          const y = ypx(v);
          g.line([axX - 3, y], [axX + 3, y], tk);
          if (arrows && y < tipY + 14) continue;
          if (zeroY && Math.abs(y - axY) < 1) continue;
          g.text(yt.label(v), leftOK ? [axX - TL - 4, y] : [axX + TL + 4, y], { ...TICKH, align: leftOK ? "right" : "left" });
        }
        if (zeroX && zeroY && o.origin !== false && xt.major.length && yt.major.length) g.text("0", [axX - 5, axY + TL + 10], { ...TICKH, align: "right" });
        if (o.xLabel) txt(o.xLabel, [tipX - 2, axY - 12], { ...AXL, align: "right" });
        if (o.yLabel) txt(o.yLabel, [axX + 10, tipY + 4], { ...AXL, align: "left" });
      }
      if (o.draw !== false) { drawGrid(); drawAxes(); }
      // Draws the axes and tick labels again, on top of curves that crossed them.
      P.axesOnTop = drawAxes;

      // f(x) with adaptive sampling; jumps the sampling can't resolve (tan, 1/x) break the line.
      P.fn = (f, so = {}) => {
        const dom = so.domain ?? [gx(X0), gx(X1)];
        const t0 = fx(Math.max(Math.min(dom[0], dom[1]), Math.min(gx(X0), gx(X1)))), t1 = fx(Math.min(Math.max(dom[0], dom[1]), Math.max(gx(X0), gx(X1))));
        if (!(t1 > t0)) return [];
        const n = so.samples ?? Math.max(24, Math.round(((t1 - t0) * Math.abs(sx)) / 4));
        let budget = so.budget ?? 40000;
        const at = t => {
          const x = gx(t);
          let y;
          try { y = f(x); } catch { y = NaN; }
          budget--;
          return { t, p: Number.isFinite(y) && (!logY || y > 0) ? [L + (t - X0) * sx, B - (fy(y) - Y0) * sy] : null };
        };
        const pts = [];
        const refine = (A, Bp, depth) => {
          if (depth < 11 && budget > 0) {
            const M = at((A.t + Bp.t) / 2);
            let split;
            if (!A.p || !Bp.p) split = !!(A.p || Bp.p || M.p);
            else if (!M.p) split = true;
            else split = Math.abs(M.p[1] - (A.p[1] + Bp.p[1]) / 2) > 0.4 || Math.abs(A.p[1] - Bp.p[1]) > H * 0.5;
            if (split) { refine(A, M, depth + 1); refine(M, Bp, depth + 1); return; }
          }
          pts.push(Bp);
        };
        let prev = at(t0);
        pts.push(prev);
        for (let i = 1; i <= n; i++) { const nx = at(t0 + ((t1 - t0) * i) / n); refine(prev, nx, 0); prev = nx; }
        const lines = [];
        let cur = [];
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i];
          if (!q.p) { if (cur.length > 1) lines.push(cur); cur = []; continue; }
          const pr = pts[i - 1];
          if (pr && pr.p && Math.abs(q.p[1] - pr.p[1]) > H * 0.5) { if (cur.length > 1) lines.push(cur); cur = []; }
          cur.push(lim(q.p));
        }
        if (cur.length > 1) lines.push(cur);
        const color = so.color ?? "blue";
        clipped(so, () => { for (const line of lines) g.path(line, { stroke: color, width: so.width ?? 2, dash: so.dash, alpha: so.alpha }); });
        if (so.label) {
          const lx = so.labelAt ?? gx(t1 - (t1 - t0) * 0.04);
          let ly;
          try { ly = f(lx); } catch { ly = NaN; }
          if (Number.isFinite(ly) && P.contains([lx, ly])) {
            const p = toPx([lx, ly]), [dx, dy] = so.labelOffset ?? [0, -12];
            const w = txtWidth(so.label, { size: 13 });
            txt(so.label, [clamp(p[0] + dx, L + w / 2 + 2, R - w / 2 - 2), clamp(p[1] + dy, T + 8, B - 8)], { size: 13, color, halo: true, weight: 600 });
          }
        }
        return lines;
      };
      // A curve t -> [x, y] over [t0, t1].
      P.parametric = (fn, [t0, t1] = [0, 1], so = {}) => {
        let budget = so.budget ?? 40000;
        const n = so.samples ?? 160;
        const at = t => {
          let q;
          try { q = fn(t); } catch { q = null; }
          budget--;
          return { t, p: q && Number.isFinite(q[0]) && Number.isFinite(q[1]) ? toPx(q) : null };
        };
        const pts = [];
        const refine = (A, Bp, depth) => {
          if (depth < 10 && budget > 0) {
            const M = at((A.t + Bp.t) / 2);
            let split;
            if (!A.p || !Bp.p) split = !!(A.p || Bp.p || M.p);
            else if (!M.p) split = true;
            else {
              const dev = Math.hypot(M.p[0] - (A.p[0] + Bp.p[0]) / 2, M.p[1] - (A.p[1] + Bp.p[1]) / 2);
              split = dev > 0.4 || Math.hypot(A.p[0] - Bp.p[0], A.p[1] - Bp.p[1]) > diag * 0.25;
            }
            if (split) { refine(A, M, depth + 1); refine(M, Bp, depth + 1); return; }
          }
          pts.push(Bp);
        };
        let prev = at(t0);
        pts.push(prev);
        for (let i = 1; i <= n; i++) { const nx = at(t0 + ((t1 - t0) * i) / n); refine(prev, nx, 0); prev = nx; }
        const lines = [];
        let cur = [];
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i], pr = pts[i - 1];
          if (!q.p) { if (cur.length > 1) lines.push(cur); cur = []; continue; }
          if (pr && pr.p && Math.hypot(q.p[0] - pr.p[0], q.p[1] - pr.p[1]) > diag * 0.25) { if (cur.length > 1) lines.push(cur); cur = []; }
          cur.push(lim(q.p));
        }
        if (cur.length > 1) lines.push(cur);
        clipped(so, () => { for (const line of lines) g.path(line, { stroke: so.color ?? "blue", width: so.width ?? 2, dash: so.dash, alpha: so.alpha, fill: so.fill, close: !!so.fill }); });
        return lines;
      };
      // r(θ) in polar coordinates.
      P.polar = (r, range = [0, TAU], so = {}) => P.parametric(t => { const rr = r(t); return [rr * Math.cos(t), rr * Math.sin(t)]; }, range, so);

      P.points = (list, so = {}) => {
        const out = list.map(q => toPx(q));
        clipped(so, () => out.forEach((p, i) => {
          const c = Array.isArray(so.color) ? so.color[i] : so.color ?? "ink";
          g.circle(p, so.r ?? 3.5, { fill: c, stroke: "panel", width: 1.2, alpha: so.alpha });
          if (so.labels?.[i]) txt(so.labels[i], [p[0] + 8, p[1] - 9], { size: 12, color: c, align: "left", halo: true });
        }));
        return out;
      };
      P.scatter = P.points;
      P.polyline = (list, so = {}) => { const pts = list.map(toPx); clipped(so, () => g.path(pts.map(lim), { stroke: so.color ?? "ink", width: so.width ?? 2, dash: so.dash, alpha: so.alpha, close: so.close, fill: so.fill })); return pts; };
      P.segment = (a, b, so = {}) => { const A = toPx(a), Bp = toPx(b); clipped(so, () => g.line(A, Bp, { stroke: so.color ?? "ink", width: so.width ?? 2, dash: so.dash, alpha: so.alpha })); return [A, Bp]; };
      const extend = (a, b, back) => {
        const A = toPx(a), Bp = toPx(b), d = v2.norm(v2.sub(Bp, A)), k = diag * 2;
        return [back ? v2.add(A, v2.scale(d, -k)) : A, v2.add(A, v2.scale(d, k))];
      };
      // The whole line through a and b, clipped to the plot.
      P.line = (a, b, so = {}) => { const [A, Bp] = extend(a, b, true); clipped(so, () => g.line(A, Bp, { stroke: so.color ?? "ink", width: so.width ?? 1.5, dash: so.dash, alpha: so.alpha })); };
      P.ray = (a, b, so = {}) => { const [A, Bp] = extend(a, b, false); clipped(so, () => g.line(A, Bp, { stroke: so.color ?? "ink", width: so.width ?? 1.5, dash: so.dash, alpha: so.alpha })); };
      P.vector = (from, to, so = {}) => {
        const A = toPx(from), Bp = toPx(to), c = so.color ?? "ink";
        g.arrow(A, Bp, { stroke: c, width: so.width ?? 2, head: so.head, alpha: so.alpha });
        if (so.label) {
          const d = v2.norm(v2.sub(Bp, A)), off = so.labelOffset ?? 13;
          txt(so.label, [Bp[0] + d[0] * off, Bp[1] + d[1] * off], { size: 14, color: c, halo: true, weight: 600 });
        }
        return [A, Bp];
      };
      // Shaded region between f and o.to (a number or function, default 0) over [a, b]; returns the integral.
      P.area = (f, a, b, so = {}) => {
        const base = typeof so.to === "function" ? so.to : () => so.to ?? 0;
        const lo = Math.max(Math.min(a, b), Math.min(gx(X0), gx(X1))), hi = Math.min(Math.max(a, b), Math.max(gx(X0), gx(X1)));
        if (hi > lo) {
          const xs = linspace(lo, hi, (so.samples ?? 160) + 1);
          const tops = xs.map(x => f(x)), bots = xs.map(x => base(x));
          const fill = (pick, c) => {
            const poly = [...xs.map((x, i) => lim(toPx([x, pick(tops[i], bots[i])]))), ...xs.map((x, i) => lim(toPx([x, bots[i]]))).reverse()];
            g.path(poly, { fill: c, alpha: so.alpha ?? 0.2, close: true });
            if (so.hatch) g.path(poly, { hatch: c, hatchGap: 6, close: true, alpha: 0.55 });
          };
          const color = so.color ?? "blue";
          clipped(so, () => {
            if (so.neg) { fill((y, b0) => Math.max(y, b0), color); fill((y, b0) => Math.min(y, b0), so.neg); }
            else fill(y => y, color);
            if (so.edge) g.path(xs.map((x, i) => lim(toPx([x, tops[i]]))), { stroke: color, width: 2 });
          });
        }
        return integrate(x => f(x) - base(x), a, b);
      };
      P.between = (f, f2, a, b, so = {}) => P.area(f, a, b, { ...so, to: f2 });
      // Tangent to f at x0; returns { x, y, slope }.
      P.tangent = (f, x0, so = {}) => {
        const y0 = f(x0), m = so.slope ?? deriv(f, x0), c = so.color ?? "orange";
        if (so.span) P.segment([x0 - so.span, y0 - m * so.span], [x0 + so.span, y0 + m * so.span], { color: c, width: so.width ?? 1.6, dash: so.dash });
        else P.line([x0, y0], [x0 + 1, y0 + m], { color: c, width: so.width ?? 1.6, dash: so.dash });
        if (so.point !== false) P.marker(x0, y0, { color: c });
        return { x: x0, y: y0, slope: m };
      };
      // Riemann rectangles (rule: "left", "right", "mid", or "trap"); returns the sum.
      P.riemann = (f, a, b, n, so = {}) => {
        const w = (b - a) / n, rule = so.rule ?? "mid", c = so.color ?? "blue", y0 = so.to ?? 0;
        let total = 0;
        clipped(so, () => {
          for (let i = 0; i < n; i++) {
            const xl = a + i * w, xr = xl + w;
            if (rule === "trap") {
              const yl = f(xl), yr = f(xr);
              total += ((yl + yr) / 2 - y0) * w;
              const poly = [toPx([xl, y0]), toPx([xl, yl]), toPx([xr, yr]), toPx([xr, y0])].map(lim);
              g.path(poly, { fill: c, alpha: so.alpha ?? 0.18, close: true });
              g.path(poly, { stroke: c, width: 1, close: true });
              continue;
            }
            const y = f(rule === "left" ? xl : rule === "right" ? xr : xl + w / 2);
            total += (y - y0) * w;
            const p = lim(toPx([xl, y])), q = lim(toPx([xr, y0]));
            const rx = Math.min(p[0], q[0]), ry = Math.min(p[1], q[1]), rw = Math.abs(q[0] - p[0]), rh = Math.abs(q[1] - p[1]);
            g.rect(rx, ry, rw, rh, { fill: c, alpha: so.alpha ?? 0.18 });
            g.rect(rx, ry, rw, rh, { stroke: c, width: 1 });
          }
        });
        return total;
      };
      P.hline = (y, so = {}) => {
        const py = ypx(y), c = so.color ?? "muted";
        clipped(so, () => g.line([L, py], [R, py], { stroke: c, width: so.width ?? 1, dash: so.dash ?? [4, 4] }));
        if (so.label) txt(so.label, [R - 4, py - 9], { size: 12, color: c, align: "right", halo: true });
        return py;
      };
      P.vline = (x, so = {}) => {
        const px = xpx(x), c = so.color ?? "muted";
        clipped(so, () => g.line([px, T], [px, B], { stroke: c, width: so.width ?? 1, dash: so.dash ?? [4, 4] }));
        if (so.label) txt(so.label, [px + 6, T + 9], { size: 12, color: c, align: "left", halo: true });
        return px;
      };
      const OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };
      // A point with an optional label and dashed drop lines to the axes.
      P.marker = (x, y, so = {}) => {
        const p = toPx([x, y]), c = so.color ?? "ink";
        if (so.drop) {
          const d = { stroke: c, width: 1, dash: [3, 3], alpha: 0.8 };
          g.line(p, [p[0], axY], d);
          g.line(p, [axX, p[1]], d);
        }
        g.circle(p, so.r ?? 4.5, { fill: c, stroke: "panel", width: 1.5 });
        if (so.label) {
          const dir = OFF[so.pos ?? "ne"], k = 10;
          txt(so.label, [p[0] + dir[0] * k, p[1] + dir[1] * k], { size: 13, color: c, weight: 600, halo: true, align: dir[0] > 0 ? "left" : dir[0] < 0 ? "right" : "center" });
        }
        return p;
      };
      P.label = (text, q, so = {}) => {
        const p = toPx(q);
        return txt(text, [p[0] + (so.dx ?? 0), p[1] + (so.dy ?? 0)], { size: so.size ?? 13, color: so.color ?? "ink", align: so.align ?? "center", halo: true, weight: so.weight ?? 500 });
      };
      // items: [{ label, color, dash, fill }]; o.at: "top-left" (default), "top-right", "bottom-left", "bottom-right", or [x, y].
      P.legend = (items, so = {}) => {
        const rowH = 19, sw = 20, w = Math.max(0, ...items.map(it => txtWidth(it.label, { size: 12.5 }))) + sw + 8;
        const at = so.at ?? "top-left", h = items.length * rowH;
        const [x, y] = Array.isArray(at) ? at : [at.endsWith("right") ? R - 10 - w : L + 10, at.startsWith("bottom") ? B - 8 - h : T + 8];
        items.forEach((it, i) => {
          const cy = y + i * rowH + rowH / 2, c = it.color ?? "ink";
          if (it.fill) { g.rect(x, cy - 5, sw - 4, 10, { fill: c, alpha: 0.25 }); g.rect(x, cy - 5, sw - 4, 10, { stroke: c, width: 1 }); }
          else g.line([x, cy], [x + sw - 4, cy], { stroke: c, width: it.width ?? 2, dash: it.dash });
          txt(it.label, [x + sw + 2, cy], { size: 12.5, color: "ink", align: "left", halo: true });
        });
        return [x, y, w, h];
      };

      // ---------- Measured data ----------
      // y at x on a list of [x, y] pairs sorted by x, by straight lines between them.
      const interp = (data, x) => {
        if (!data.length || x < data[0][0] || x > data[data.length - 1][0]) return NaN;
        let i = 1;
        while (i < data.length - 1 && data[i][0] < x) i++;
        const [x0, y0] = data[i - 1], [x1, y1] = data[i];
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      };
      P.interp = interp;
      // A line through [x, y] pairs: o.dots, o.fill (a soft area down to o.to, default 0),
      // o.smooth, o.label at the last point. Returns the px points.
      P.series = (data, so = {}) => {
        const pts = data.filter(q => q && Number.isFinite(q[0]) && Number.isFinite(q[1])).map(q => lim(toPx(q)));
        if (pts.length < 2) return pts;
        const c = so.color ?? "blue";
        clipped(so, () => {
          if (so.fill) {
            const base = ypx(so.to ?? 0);
            g.path([[pts[0][0], base], ...pts, [pts[pts.length - 1][0], base]], { fill: c, alpha: so.fillAlpha ?? 0.12, close: true });
          }
          (so.smooth ? g.spline : g.path)(pts, { stroke: c, width: so.width ?? 2, dash: so.dash, alpha: so.alpha });
          if (so.dots) for (const p of pts) g.circle(p, so.r ?? 3, { fill: c, stroke: "panel", width: 1.2, alpha: so.alpha });
        });
        if (so.label) {
          const end = pts[pts.length - 1], right = end[0] > R - 60;
          txt(so.label, [end[0] + (right ? -8 : 8), end[1] - (right ? 12 : 0)], { size: 12.5, color: c, weight: 600, halo: true, align: right ? "right" : "left" });
        }
        return pts;
      };
      // A band between lo and hi over xs (arrays the length of xs, or functions of x):
      // confidence intervals, ranges, envelopes.
      P.band = (xs, lo, hi, so = {}) => {
        const at = (v, x, i) => (typeof v === "function" ? v(x) : Array.isArray(v) ? v[i] : v);
        const top = xs.map((x, i) => lim(toPx([x, at(hi, x, i)]))), bot = xs.map((x, i) => lim(toPx([x, at(lo, x, i)])));
        clipped(so, () => {
          g.path([...top, ...bot.reverse()], { fill: so.color ?? "blue", alpha: so.alpha ?? 0.15, close: true });
          if (so.edges) { g.path(top, { stroke: so.color ?? "blue", width: 1, alpha: 0.5 }); g.path(bot, { stroke: so.color ?? "blue", width: 1, alpha: 0.5 }); }
        });
      };
      // Error bars: [x, y, err] or [x, y, below, above]; a dot with capped whiskers.
      P.errorbars = (list, so = {}) => {
        const c = so.color ?? "ink", cap = so.cap ?? 4;
        clipped(so, () => {
          for (const [x, y, e1, e2 = e1] of list) {
            const p = toPx([x, y]), lo = toPx([x, y - e1]), hi = toPx([x, y + e2]);
            g.line(lo, hi, { stroke: c, width: 1.2 });
            g.line([lo[0] - cap, lo[1]], [lo[0] + cap, lo[1]], { stroke: c, width: 1.2 });
            g.line([hi[0] - cap, hi[1]], [hi[0] + cap, hi[1]], { stroke: c, width: 1.2 });
            g.circle(p, so.r ?? 3.5, { fill: c, stroke: "panel", width: 1.2 });
          }
        });
      };
      // A histogram of raw samples (binned with Num.histogram) or of { edges, counts }.
      // o.bins, o.range, o.density (area 1, to compare with a pdf), o.color. Returns the bins.
      P.histogram = (samples, so = {}) => {
        const h = Array.isArray(samples) || ArrayBuffer.isView(samples) ? histogram(samples, { bins: so.bins ?? 20, range: so.range }) : samples;
        const total = h.counts.reduce((a, b) => a + b, 0) || 1;
        const k = so.density ? 1 / (total * h.width) : 1, c = so.color ?? "blue";
        clipped(so, () => h.counts.forEach((n, i) => {
          const a = lim(toPx([h.edges[i], n * k])), b = lim(toPx([h.edges[i + 1], 0]));
          const x = Math.min(a[0], b[0]) + 0.5, w = Math.max(0, Math.abs(b[0] - a[0]) - 1), y = Math.min(a[1], b[1]), hh = Math.abs(b[1] - a[1]);
          g.rect(x, y, w, hh, { fill: c, alpha: so.alpha ?? 0.22 });
          g.line([x, y], [x + w, y], { stroke: c, width: 1.5 });
        }));
        return { ...h, scale: k };
      };
      // A hover readout at data x: a guide line, a dot where each curve crosses it, and
      // value tags that keep clear of each other. curves: [{ f } or { data }, with color,
      // label, format]. Feed x from the figure's hover: s.hx = P.inv(p)[0].
      P.crosshair = (x, curves, so = {}) => {
        if (x == null || !Number.isFinite(x)) return [];
        const px = xpx(x);
        if (px < L - 0.5 || px > R + 0.5) return [];
        g.line([px, T], [px, B], { stroke: "muted", width: 1, dash: [3, 3] });
        const hits = curves.map(c => ({ c, y: c.f ? c.f(x) : interp(c.data, x) })).filter(h => Number.isFinite(h.y));
        hits.forEach(h => { h.p = toPx([x, h.y]); g.circle(h.p, 4, { fill: h.c.color ?? "blue", stroke: "panel", width: 1.6 }); });
        const left = px > R - 110, gap = 17;
        const ys = hits.map(h => clamp(h.p[1], T + 8, B - 8)).sort((a, b) => a - b);
        const order = [...hits].sort((a, b) => a.p[1] - b.p[1]);
        for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + gap);
        order.forEach((h, i) => {
          const v = h.c.format ? h.c.format(h.y) : fmt(h.y);
          txt(h.c.label ? `${h.c.label} ${v}` : v, [px + (left ? -9 : 9), ys[i]], { size: 12.5, weight: 600, color: h.c.color ?? "blue", halo: true, align: left ? "right" : "left" });
        });
        if (so.xLabel !== false) {
          const xs = so.xFormat ? so.xFormat(x) : fmt(x);
          txt(xs, [px, B + 14], { size: 11.5, weight: 600, color: "ink", halo: true });
        }
        return hits;
      };
      // Arrows of F(x, y) -> [u, v] on a grid; o.scale "linear" (length by magnitude) or "normalize" (same length, fade by magnitude).
      P.vectorField = (F, so = {}) => {
        const sp = so.spacing ?? 32, cols = Math.max(1, Math.floor(W / sp)), rows = Math.max(1, Math.floor(H / sp));
        const x0 = L + (W - (cols - 1) * sp) / 2, y0 = T + (H - (rows - 1) * sp) / 2;
        const samples = [];
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const p = [x0 + i * sp, y0 + j * sp], q = P.inv(p), v = F(q[0], q[1]);
          if (!v || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) continue;
          samples.push({ p, d: [v[0] * sx, -v[1] * sy], m: Math.hypot(v[0], v[1]) });
        }
        const max = so.max ?? Math.max(1e-12, ...samples.map(s => s.m));
        const c = so.color ?? "muted";
        for (const s of samples) {
          const r = clamp(s.m / max, 0, 1), dl = Math.hypot(s.d[0], s.d[1]);
          if (!dl) continue;
          const len = so.scale === "normalize" ? sp * 0.62 : sp * 0.85 * r;
          if (len < 3) { g.circle(s.p, 1.2, { fill: c, alpha: 0.6 }); continue; }
          const u = [s.d[0] / dl, s.d[1] / dl], a = [s.p[0] - (u[0] * len) / 2, s.p[1] - (u[1] * len) / 2], b = [s.p[0] + (u[0] * len) / 2, s.p[1] + (u[1] * len) / 2];
          g.arrow(a, b, { stroke: c, width: so.width ?? 1.2, head: Math.min(7, len * 0.45), alpha: so.scale === "normalize" ? 0.3 + 0.7 * r : so.alpha });
        }
        return samples.length;
      };
      // Curves that follow F from each seed (data points; default a grid), traced with RK4 in screen space.
      P.streamlines = (F, seeds, so = {}) => {
        const dir = p => {
          const q = P.inv(p), v = F(q[0], q[1]);
          if (!v) return null;
          const d = [v[0] * sx, -v[1] * sy], m = Math.hypot(d[0], d[1]);
          return m > 1e-12 && Number.isFinite(m) ? [d[0] / m, d[1] / m] : null;
        };
        const h = so.step ?? 3, maxSteps = so.maxSteps ?? 500, inside = p => p[0] >= L && p[0] <= R && p[1] >= T && p[1] <= B;
        const trace = (p0, sgn) => {
          const pts = [p0];
          let p = p0;
          for (let i = 0; i < maxSteps; i++) {
            const k1 = dir(p); if (!k1) break;
            const k2 = dir([p[0] + (sgn * h * k1[0]) / 2, p[1] + (sgn * h * k1[1]) / 2]); if (!k2) break;
            const k3 = dir([p[0] + (sgn * h * k2[0]) / 2, p[1] + (sgn * h * k2[1]) / 2]); if (!k3) break;
            const k4 = dir([p[0] + sgn * h * k3[0], p[1] + sgn * h * k3[1]]); if (!k4) break;
            p = [p[0] + (sgn * h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])) / 6, p[1] + (sgn * h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])) / 6];
            if (!inside(p)) break;
            pts.push(p);
            if (i > 20 && Math.hypot(p[0] - p0[0], p[1] - p0[1]) < h) { pts.push(p0); break; }
          }
          return pts;
        };
        if (!seeds) {
          seeds = [];
          const n = so.count ?? [7, 5];
          for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) seeds.push(P.inv([L + ((i + 0.5) / n[0]) * W, T + ((j + 0.5) / n[1]) * H]));
        }
        const c = so.color ?? "blue", lines = [];
        clipped(so, () => {
          for (const s of seeds) {
            const p0 = toPx(s), fwd = trace(p0, 1), back = so.both === false ? [] : trace(p0, -1).reverse().slice(0, -1);
            const line = [...back, ...fwd];
            if (line.length < 3) continue;
            lines.push(line);
            g.path(line, { stroke: c, width: so.width ?? 1.4, alpha: so.alpha ?? 0.9 });
            const m = Math.floor(line.length / 2);
            if (so.arrows !== false && m > 1) head(line[m], v2.sub(line[m], line[m - 2]), 7, c);
          }
        });
        return lines;
      };
      // Level curves of f(x, y) by marching squares; levels is a list or a count.
      P.contour = (f, levels = 8, so = {}) => {
        const res = so.res ?? 6, nx = Math.max(2, Math.ceil(W / res)), ny = Math.max(2, Math.ceil(H / res));
        const V = [];
        let mn = Infinity, mx = -Infinity;
        for (let j = 0; j <= ny; j++) {
          const row = [];
          for (let i = 0; i <= nx; i++) {
            const q = P.inv([L + (i / nx) * W, T + (j / ny) * H]), v = f(q[0], q[1]);
            row.push(v);
            if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
          }
          V.push(row);
        }
        const lv = Array.isArray(levels) ? levels : linspace(mn, mx, levels + 2).slice(1, -1);
        const X = i => L + (i / nx) * W, Y = j => T + (j / ny) * H;
        const EDGES = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[0, 1], [3, 2]], [[0, 2]], [[3, 0]], [[3, 0]], [[0, 2]], [[3, 0], [2, 1]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
        clipped(so, () => lv.forEach((c, k) => {
          const ctx = g.ctx;
          ctx.save();
          ctx.beginPath();
          for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const a = V[j][i], b = V[j][i + 1], d = V[j + 1][i + 1], e = V[j + 1][i];
            if (![a, b, d, e].every(Number.isFinite)) continue;
            const idx = (a > c ? 8 : 0) | (b > c ? 4 : 0) | (d > c ? 2 : 0) | (e > c ? 1 : 0);
            const t = (u, w) => (c - u) / (w - u || 1e-12);
            const pt = edge => edge === 0 ? [lerp(X(i), X(i + 1), t(a, b)), Y(j)] : edge === 1 ? [X(i + 1), lerp(Y(j), Y(j + 1), t(b, d))]
              : edge === 2 ? [lerp(X(i), X(i + 1), t(e, d)), Y(j + 1)] : [X(i), lerp(Y(j), Y(j + 1), t(a, e))];
            for (const [e1, e2] of EDGES[idx]) { const p = pt(e1), q = pt(e2); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
          }
          ctx.strokeStyle = util.color(Array.isArray(so.colors) ? so.colors[k % so.colors.length] : so.color ?? "muted");
          ctx.lineWidth = so.width ?? 1.2;
          ctx.lineCap = ctx.lineJoin = "round";
          if (so.dash) ctx.setLineDash(so.dash);
          ctx.stroke();
          ctx.restore();
        }));
        return { levels: lv, min: mn, max: mx };
      };
      // f(x, y) as color under the axes; o.map "diverging" (default) or "sequential", o.range, o.low, o.high.
      P.heat = (f, so = {}) => {
        let rng2 = so.range;
        if (!rng2) {
          let mn = Infinity, mx = -Infinity;
          for (let j = 0; j <= 24; j++) for (let i = 0; i <= 24; i++) { const q = P.inv([L + (i / 24) * W, T + (j / 24) * H]), v = f(q[0], q[1]); if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }
          const m = Math.max(Math.abs(mn), Math.abs(mx)) || 1;
          rng2 = (so.map ?? "diverging") === "diverging" ? [-m, m] : [mn, mx];
        }
        g.field((px, py) => { const q = P.inv([px, py]); return f(q[0], q[1]); }, { box: [L, T, W, H], res: so.res ?? 3, range: rng2, map: so.map, low: so.low, high: so.high, alpha: so.alpha });
        drawAxes();
        return rng2;
      };
      return P;
    };

    // ----- Mechanics -----
    // A coil spring from a to b (px). o.coils [8], o.radius [7], o.lead [10] straight ends, o.style "coil" | "zigzag".
    g.spring = (a, b, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], n = [-u[1], u[0]];
      const coils = o.coils ?? 8, r = o.radius ?? 7, lead = Math.min(o.lead ?? 10, len / 4), body = Math.max(0, len - 2 * lead);
      const at = (s, off) => [a[0] + u[0] * s + n[0] * off, a[1] + u[1] * s + n[1] * off];
      const pts = [a, at(lead, 0)];
      if (o.style === "zigzag") {
        for (let i = 0; i < 2 * coils; i++) pts.push(at(lead + ((i + 0.5) / (2 * coils)) * body, i % 2 ? -r : r));
      } else {
        // A helix seen slightly from the side: each turn leans back by tilt, so a squeezed spring shows loops.
        const N = coils * 28, pitch = body / coils, tilt = Math.min(1.2 * r, Math.max((o.tilt ?? 0.5) * r, (1.7 * pitch) / TAU));
        for (let i = 1; i < N; i++) {
          const t = i / N, th = TAU * coils * t;
          pts.push(at(lead + t * body + tilt * (Math.cos(th) - 1), r * Math.sin(th)));
        }
      }
      pts.push(at(lead + body, 0), b);
      g.path(pts, { stroke: o.color ?? "ink", width: o.width ?? 1.5 });
      return { a, b, length: len };
    };
    // A surface from a to b with hatching on one side (side 1: to the right of a->b, which is below for left-to-right).
    g.ground = (a, b, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], side = o.side ?? 1, n = [-u[1] * side, u[0] * side];
      const gap = o.gap ?? 8, depth = o.depth ?? 8, c = o.color ?? "muted";
      for (let s = gap / 2; s < len; s += gap) {
        const p = [a[0] + u[0] * s, a[1] + u[1] * s];
        g.line(p, [p[0] + n[0] * depth - u[0] * depth * 0.7, p[1] + n[1] * depth - u[1] * depth * 0.7], { stroke: c, width: 1 });
      }
      g.line(a, b, { stroke: o.line ?? "ink", width: o.width ?? 1.6 });
      return { a, b, normal: [-n[0], -n[1]] };
    };
    g.wall = (a, b, o = {}) => g.ground(a, b, o);
    // A labeled block centered at c; o.color tints it, o.label ("m", "$m_1$", "2 kg") sits in the middle.
    g.block = (c, w, h, o = {}) => {
      const x = c[0] - w / 2, y = c[1] - h / 2;
      tinted(s => g.rect(x, y, w, h, { ...s, r: o.r ?? 3 }), o.color ?? "grid", o.color ? 0.3 : 1);
      g.rect(x, y, w, h, { stroke: "ink", width: o.width ?? 1.5, r: o.r ?? 3 });
      if (o.label) txt(o.label, c, { size: o.size ?? 14, color: "ink", weight: 600 });
      return { x, y, w, h, c, top: [c[0], y], bottom: [c[0], y + h], left: [x, c[1]], right: [x + w, c[1]], hit: p => p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h };
    };
    g.mass = g.block;
    // A pulley wheel; o.angle turns three spoke marks so rotation shows.
    g.pulley = (c, r, o = {}) => {
      tinted(s => g.circle(c, r, s), o.color, 0.25);
      g.circle(c, r, { stroke: "ink", width: 1.5 });
      g.circle(c, r - 3.5, { stroke: "muted", width: 1 });
      const a = o.angle ?? 0;
      for (let k = 0; k < 3; k++) { const t = a + (k * TAU) / 3; g.line([c[0] + Math.cos(t) * r * 0.25, c[1] + Math.sin(t) * r * 0.25], [c[0] + Math.cos(t) * (r - 6), c[1] + Math.sin(t) * (r - 6)], { stroke: "muted", width: 1.2 }); }
      g.circle(c, 2.6, { fill: "ink" });
      if (o.mount) { g.line(c, o.mount, { stroke: "ink", width: 2 }); }
      return { c, r };
    };
    // A wave along a->b: f(s) gives the sideways displacement in px at distance s (px) from a.
    g.wave = (a, b, f, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], n = [-u[1], u[0]], N = o.samples ?? Math.max(24, Math.round(len / 2));
      const pts = [];
      for (let i = 0; i <= N; i++) { const s = (i / N) * len, y = f(s); pts.push([a[0] + u[0] * s + n[0] * y, a[1] + u[1] * s + n[1] * y]); }
      g.path(pts, { stroke: o.color ?? "blue", width: o.width ?? 2, dash: o.dash, alpha: o.alpha });
      return pts;
    };
    // An angle mark at corner c from angle a0 to a1 (canvas radians, y down); o.right draws the square right-angle mark.
    g.angleMark = (c, a0, a1, r = 22, o = {}) => {
      const col = o.color ?? "ink";
      if (o.right) {
        const s = r * 0.5, p1 = [c[0] + Math.cos(a0) * s, c[1] + Math.sin(a0) * s], p2 = [c[0] + Math.cos(a1) * s, c[1] + Math.sin(a1) * s];
        g.path([p1, [p1[0] + p2[0] - c[0], p1[1] + p2[1] - c[1]], p2], { stroke: col, width: 1.2 });
        return;
      }
      const n = 24, pts = [];
      for (let i = 0; i <= n; i++) { const t = lerp(a0, a1, i / n); pts.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]); }
      if (o.fill !== false) g.path([c, ...pts], { fill: col, alpha: 0.12, close: true });
      g.path(pts, { stroke: col, width: 1.5 });
      if (o.label) { const t = (a0 + a1) / 2, k = r + (o.labelGap ?? 12); txt(o.label, [c[0] + Math.cos(t) * k, c[1] + Math.sin(t) * k], { size: 14, color: col, halo: true }); }
    };
    // A curly brace from a to b, bulging to the right of a->b, with a label past its tip.
    g.brace = (a, b, label, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], side = o.side ?? 1, n = [-u[1] * side, u[0] * side], k = o.depth ?? 8;
      const P2 = (s, off) => [a[0] + u[0] * s + n[0] * off, a[1] + u[1] * s + n[1] * off];
      const ctx = g.ctx, m = len / 2, c = o.color ?? "muted";
      ctx.save();
      ctx.beginPath();
      const q = (p1, p2) => ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
      let p = P2(0, 0); ctx.moveTo(p[0], p[1]);
      q(P2(0, k / 2), P2(Math.min(k, m / 2), k / 2));
      p = P2(m - Math.min(k, m / 2), k / 2); ctx.lineTo(p[0], p[1]);
      q(P2(m, k / 2), P2(m, k));
      q(P2(m, k / 2), P2(m + Math.min(k, m / 2), k / 2));
      p = P2(len - Math.min(k, m / 2), k / 2); ctx.lineTo(p[0], p[1]);
      q(P2(len, k / 2), P2(len, 0));
      ctx.strokeStyle = util.color(c); ctx.lineWidth = o.width ?? 1.2; ctx.stroke();
      ctx.restore();
      if (label) {
        const t = P2(m, k + 12), horizontal = Math.abs(n[0]) < 0.5;
        txt(label, t, { size: o.size ?? 13, color: o.textColor ?? c, align: horizontal ? "center" : n[0] > 0 ? "left" : "right", halo: true });
      }
    };

    // ----- Electricity -----
    g.charge = (p, sign, o = {}) => {
      const r = o.r ?? 11, c = o.color ?? (sign > 0 ? "red" : sign < 0 ? "blue" : "muted");
      tinted(s => g.circle(p, r, s), c, 0.22);
      g.circle(p, r, { stroke: c, width: 1.5 });
      const k = r * 0.45;
      if (sign !== 0) g.line([p[0] - k, p[1]], [p[0] + k, p[1]], { stroke: c, width: 2 });
      if (sign > 0) g.line([p[0], p[1] - k], [p[0], p[1] + k], { stroke: c, width: 2 });
      if (o.label) txt(o.label, [p[0], p[1] + r + 12], { size: 12.5, color: c, halo: true });
      return { p, r, hit: q => Math.hypot(q[0] - p[0], q[1] - p[1]) <= r + 4 };
    };
    // Field lines of point charges [{ p: [px, py], q }] traced from the positive charges (or into the negative ones).
    g.fieldLines = (charges, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], c = o.color ?? "muted", step = o.step ?? 3, perUnit = o.density ?? 8;
      const E = p => {
        let ex = 0, ey = 0;
        for (const ch of charges) { const dx = p[0] - ch.p[0], dy = p[1] - ch.p[1], r2 = dx * dx + dy * dy, r3 = r2 * Math.sqrt(r2) || 1e-9; ex += (ch.q * dx) / r3; ey += (ch.q * dy) / r3; }
        return [ex, ey];
      };
      const pos = charges.some(ch => ch.q > 0), sources = charges.filter(ch => (pos ? ch.q > 0 : ch.q < 0)), sgn = pos ? 1 : -1;
      const inside = p => p[0] >= box[0] - 20 && p[0] <= box[0] + box[2] + 20 && p[1] >= box[1] - 20 && p[1] <= box[1] + box[3] + 20;
      const lines = [];
      for (const src of sources) {
        const n = Math.max(4, Math.round(Math.abs(src.q) * perUnit)), r0 = (o.r ?? 11) + 2;
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) * TAU) / n;
          let p = [src.p[0] + Math.cos(t) * r0, src.p[1] + Math.sin(t) * r0];
          const pts = [p];
          for (let i = 0; i < (o.maxSteps ?? 1500); i++) {
            const e = E(p), m = Math.hypot(e[0], e[1]);
            if (!(m > 0)) break;
            const mid = [p[0] + (sgn * step * e[0]) / m / 2, p[1] + (sgn * step * e[1]) / m / 2], e2 = E(mid), m2 = Math.hypot(e2[0], e2[1]) || 1;
            p = [p[0] + (sgn * step * e2[0]) / m2, p[1] + (sgn * step * e2[1]) / m2];
            pts.push(p);
            if (!inside(p) || charges.some(ch => ch !== src && Math.hypot(p[0] - ch.p[0], p[1] - ch.p[1]) < r0 - 1)) break;
          }
          lines.push(pts);
        }
      }
      g.clip(box, () => {
        for (const pts of lines) {
          g.path(pts, { stroke: c, width: o.width ?? 1.1 });
          const m = Math.min(pts.length - 1, Math.floor(pts.length * 0.4));
          if (m > 2) head(pts[m], sgn > 0 ? v2.sub(pts[m], pts[m - 2]) : v2.sub(pts[m - 2], pts[m]), 6.5, c);
        }
      });
      return lines;
    };

    // ----- Chemistry -----
    // An atom as a tinted disc with its symbol; o.r, o.scale, o.charge ("+", "δ−"), o.label below.
    g.atom = (p, el, o = {}) => {
      const [c, size] = ATOM[el] ?? ["muted", 1];
      const r = o.r ?? 13 * size * (o.scale ?? 1), dark = c === "ink";
      if (dark) { g.circle(p, r, { fill: "panel" }); g.circle(p, r, { fill: "ink", alpha: 0.78 }); }
      else tinted(s => g.circle(p, r, s), c === "panel" ? null : c, 0.32);
      g.circle(p, r, { stroke: "ink", width: o.width ?? 1.3, alpha: o.alpha });
      if (o.symbol !== false && r >= 6) g.text(el, [p[0], p[1] + 0.5], { size: Math.max(9, r * 0.92), weight: 600, color: dark ? "panel" : "ink" });
      if (o.charge) txt(o.charge, [p[0] + r * 0.85, p[1] - r * 0.85], { size: 12, color: o.chargeColor ?? "ink", align: "left", halo: true, weight: 600 });
      if (o.label) txt(o.label, [p[0], p[1] + r + 12], { size: 12, color: "muted", halo: true });
      return { p, r, hit: q => Math.hypot(q[0] - p[0], q[1] - p[1]) <= r };
    };
    // A bond from a to b; o.order 1, 2, 3, or 1.5; o.r1/o.r2 trim it at the atoms' edges; o.style "dashed" for hydrogen bonds.
    g.bond = (a, b, o = {}) => {
      const d = v2.sub(b, a), len = v2.len(d) || 1, u = [d[0] / len, d[1] / len], n = [-u[1], u[0]];
      const A = [a[0] + u[0] * (o.r1 ?? 0), a[1] + u[1] * (o.r1 ?? 0)], Bp = [b[0] - u[0] * (o.r2 ?? 0), b[1] - u[1] * (o.r2 ?? 0)];
      const c = o.color ?? "ink", w = o.width ?? 2, gap = o.gap ?? 4.5, order = o.order ?? 1;
      const seg = (off, dash) => g.line([A[0] + n[0] * off, A[1] + n[1] * off], [Bp[0] + n[0] * off, Bp[1] + n[1] * off], { stroke: c, width: w, dash });
      const dashed = o.style === "dashed" ? [2, 4] : undefined;
      if (order === 2) { seg(-gap / 2, dashed); seg(gap / 2, dashed); }
      else if (order === 3) { seg(-gap, dashed); seg(0, dashed); seg(gap, dashed); }
      else if (order === 1.5) { seg(-gap / 2, dashed); seg(gap / 2, [4, 3]); }
      else seg(0, dashed);
      return { a: A, b: Bp };
    };
    // Energy levels: items [{ E, label, color }] as bars in o.box, on an energy axis o.range; o.transitions [{ from, to, color, label }] are arrows between them.
    g.levels = (items, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], [x, y, w, h] = box;
      const Es = items.map(it => it.E), [lo, hi] = o.range ?? [Math.min(...Es), Math.max(...Es)];
      const top = o.axis === false ? 14 : 30, Y = E => y + h - 14 - ((E - lo) / (hi - lo || 1)) * (h - 14 - top);
      const lx = x + (o.axis === false ? 0 : 28), barW = o.barWidth ?? Math.min(150, (w - lx + x) * 0.45);
      if (o.axis !== false) {
        g.arrow([x + 12, y + h - 6], [x + 12, y + 4], { stroke: "muted", width: 1.2, head: 7 });
        txt(o.axisLabel ?? "Energy", [x + 18, y + 8], { size: 12, color: "muted", align: "left" });
      }
      const out = items.map((it, i) => {
        const col = it.column ?? 0, bx = lx + 10 + col * (barW + 40), by = Y(it.E), c = it.color ?? "ink";
        g.line([bx, by], [bx + barW, by], { stroke: c, width: it.width ?? 2.5 });
        if (it.label) txt(it.label, [bx + barW + 8, by], { size: 12.5, color: c, align: "left", halo: true });
        return { ...it, y: by, x0: bx, x1: bx + barW, i };
      });
      for (const tr of o.transitions ?? []) {
        const a = out[tr.from], b = out[tr.to], tx = (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2 + (tr.dx ?? 0);
        g.arrow([tx, a.y], [tx, b.y], { stroke: tr.color ?? "orange", width: 1.8, head: 8 });
        if (tr.label) txt(tr.label, [tx + 8, (a.y + b.y) / 2], { size: 12.5, color: tr.color ?? "orange", align: "left", halo: true });
      }
      return { levels: out, y: Y };
    };
    // Reaction-coordinate diagram: o.energies [reactants, transition state, products], o.catalyzed (a lower peak, dashed),
    // o.show { ea, dh } for the barrier and ΔH arrows, o.labels { reactants, products, ts }.
    g.reaction = (o = {}) => {
      const [er, ets, ep] = o.energies ?? [0, 1, -0.4];
      const all = [er, ets, ep, o.catalyzed ?? ets], lo = Math.min(...all), hi = Math.max(...all), pad2 = (hi - lo) * 0.18 || 1;
      const P = g.graph({ box: o.box, x: [0, 1], y: [lo - pad2, hi + pad2], axes: "frame", grid: false, xTicks: false, yTicks: false, xLabel: o.xLabel ?? "Reaction progress", yLabel: o.yLabel ?? "Energy", zeroLine: false });
      const keys = top => [[0, er], [0.18, er], [0.5, top], [0.82, ep], [1, ep]];
      const curve = top => t => {
        const k = keys(top);
        for (let i = 0; i < k.length - 1; i++) if (t <= k[i + 1][0]) { const s = (t - k[i][0]) / (k[i + 1][0] - k[i][0] || 1); return lerp(k[i][1], k[i + 1][1], (1 - Math.cos(Math.PI * s)) / 2); }
        return ep;
      };
      const E = curve(ets);
      if (o.catalyzed != null) P.fn(curve(o.catalyzed), { color: o.catalyzedColor ?? "green", dash: [5, 4], width: 1.8 });
      P.fn(E, { color: o.color ?? "ink", width: 2.2 });
      const lab = o.labels ?? {};
      if (lab.reactants) P.label(lab.reactants, [0.02, er], { dy: -13, color: "ink", align: "left" });
      if (lab.products) P.label(lab.products, [0.9, ep], { dy: -13, color: "ink" });
      if (lab.ts) P.label(lab.ts, [0.5, ets], { dy: -14, color: "ink" });
      const show = o.show ?? {};
      if (show.ea) {
        P.segment([0.18, er], [0.56, er], { color: "muted", width: 1, dash: [3, 3] });
        P.vector([0.5, er], [0.5, ets], { color: "orange", width: 1.6 });
        P.label(show.eaLabel ?? "$E_a$", [0.5, (er + ets) / 2], { dx: 9, color: "orange", align: "left" });
      }
      if (show.dh) {
        P.segment([0.62, er], [1, er], { color: "muted", width: 1, dash: [3, 3] });
        P.vector([0.985, er], [0.985, ep], { color: "blue", width: 1.6 });
        P.label(show.dhLabel ?? "ΔH", [0.985, (er + ep) / 2], { dx: -8, color: "blue", align: "right" });
      }
      return { ...P, P, E };
    };

    // ----- Data -----
    // Bars for a list of values in o.box; o.labels, o.highlight (index or list), o.colors, o.range, o.values (show numbers), o.format,
    // o.horizontal (labels on the left, good for ranked probabilities). Returns { bars, hit(p) -> index | -1 }.
    g.bars = (values, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], [bx, by, bw, bh] = box, n = values.length;
      const lo = o.range?.[0] ?? Math.min(0, ...values), hi = o.range?.[1] ?? Math.max(0, ...values);
      const hl = o.highlight == null ? null : new Set([].concat(o.highlight));
      const colorOf = i => (Array.isArray(o.colors) ? o.colors[i] : o.color ?? "blue");
      const fmtv = o.format ?? (v => fmt(v));
      const bars = [];
      if (o.horizontal) {
        const labW = o.labels ? Math.max(0, ...o.labels.map(s => txtWidth(s, { size: 12.5, font: o.labelFont }))) + 10 : 0;
        const valW = o.values ? Math.max(...values.map(v => g.measure(fmtv(v), { size: 12 }))) + 8 : 0;
        const x0 = bx + labW, W2 = bw - labW - valW, rowH = bh / n, barH = Math.min(rowH * 0.7, o.barHeight ?? 22);
        const X = v => x0 + ((v - lo) / (hi - lo || 1)) * W2;
        values.forEach((v, i) => {
          const cy = by + rowH * (i + 0.5), a = X(Math.max(lo, Math.min(0, v))), b = X(Math.min(hi, Math.max(0, v)));
          const on = !hl || hl.has(i), c = colorOf(i);
          g.rect(a, cy - barH / 2, Math.max(1, b - a), barH, { fill: on ? c : "faint", alpha: on ? (hl ? 0.85 : 0.7) : 1, r: 2 });
          if (o.labels) txt(o.labels[i], [x0 - 8, cy], { size: 12.5, color: on ? "ink" : "muted", align: "right", font: o.labelFont });
          if (o.values) g.text(fmtv(v), [b + 6, cy], { size: 12, color: on ? "ink" : "muted", align: "left" });
          bars.push({ i, x: a, y: cy - barH / 2, w: b - a, h: barH, value: v });
        });
        g.line([X(0), by], [X(0), by + bh], { stroke: "muted", width: 1 });
      } else {
        const labH = o.labels ? 18 : 0, valH = o.values ? 16 : 0, H2 = bh - labH - valH, y0 = by + valH;
        const Y = v => y0 + H2 - ((v - lo) / (hi - lo || 1)) * H2;
        const slot = bw / n, barW = Math.min(slot * (1 - (o.gap ?? 0.28)), o.barWidth ?? 60);
        // Labels shrink to fit their slot, then get cut short with an ellipsis.
        let labSize = 12;
        const fit = s => {
          s = String(s);
          if (txtWidth(s, { size: labSize, font: o.labelFont }) <= slot - 4 || s.startsWith("$")) return s;
          while (s.length > 1 && txtWidth(s + "…", { size: labSize, font: o.labelFont }) > slot - 4) s = s.slice(0, -1);
          return s + "…";
        };
        if (o.labels) {
          const widest = Math.max(...o.labels.map(s => txtWidth(s, { size: 12, font: o.labelFont })));
          if (widest > slot - 4) labSize = Math.max(9.5, (12 * (slot - 4)) / widest);
        }
        values.forEach((v, i) => {
          const cx = bx + slot * (i + 0.5), top = Y(Math.max(0, v)), bot = Y(Math.min(0, v)), on = !hl || hl.has(i), c = colorOf(i);
          g.rect(cx - barW / 2, top, barW, Math.max(1, bot - top), { fill: on ? c : "faint", alpha: on ? (hl ? 0.85 : 0.7) : 1, r: 2 });
          if (o.labels) txt(fit(o.labels[i]), [cx, by + bh - 8], { size: labSize, color: on ? "ink" : "muted", font: o.labelFont });
          if (o.values) g.text(fmtv(v), [cx, (v >= 0 ? top : bot) + (v >= 0 ? -9 : 9)], { size: 11.5, color: on ? "ink" : "muted" });
          bars.push({ i, x: cx - barW / 2, y: top, w: barW, h: bot - top, value: v });
        });
        g.line([bx, Y(0)], [bx + bw, Y(0)], { stroke: "muted", width: 1 });
      }
      const hit = p => { const b = bars.find(r => p[0] >= r.x - 2 && p[0] <= r.x + Math.max(r.w, 4) + 2 && p[1] >= r.y - 2 && p[1] <= r.y + Math.max(r.h, 4) + 2); return b ? b.i : -1; };
      return { bars, hit };
    };
    // A matrix as colored cells (attention weights, confusion matrices); o.rowLabels, o.colLabels, o.range,
    // o.color (sequential) or o.diverging: true (o.low, o.high), o.values to print numbers, o.highlight { row, col }.
    g.heatmap = (M, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], rows = M.length, cols = M[0]?.length ?? 0;
      const flat = M.flat().filter(Number.isFinite);
      const [lo, hi] = o.range ?? (o.diverging ? [-Math.max(...flat.map(Math.abs)), Math.max(...flat.map(Math.abs))] : [Math.min(0, ...flat), Math.max(...flat)]);
      const LS = { size: o.labelSize ?? 12, color: "muted", font: o.labelFont };
      const left = o.rowLabels ? Math.max(0, ...o.rowLabels.map(s => txtWidth(s, LS))) + 8 : 0;
      const colW = o.colLabels ? Math.max(0, ...o.colLabels.map(s => txtWidth(s, LS))) : 0;
      let cell = Math.min((box[2] - left) / cols, (box[3] - (o.colLabels ? 18 : 0)) / rows);
      const rotate = o.colLabels && colW > cell - 4;
      const top = o.colLabels ? (rotate ? Math.min(colW * 0.72 + 8, box[3] * 0.35) : 18) : 0;
      cell = Math.min((box[2] - left) / cols, (box[3] - top) / rows);
      if (o.square === false) cell = null;
      const cw = cell ?? (box[2] - left) / cols, ch = cell ?? (box[3] - top) / rows;
      const x0 = box[0] + left + (o.align === "left" || !cell ? 0 : (box[2] - left - cw * cols) / 2), y0 = box[1] + top;
      const cellAt = (i, j) => [x0 + j * cw, y0 + i * ch, cw, ch];
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const v = M[i][j], [x, y] = cellAt(i, j);
        g.rect(x + 0.5, y + 0.5, cw - 1, ch - 1, { fill: "panel" });
        if (!Number.isFinite(v)) continue;
        let c, a;
        if (o.diverging) { const t = clamp(v / Math.max(Math.abs(lo), Math.abs(hi), 1e-12), -1, 1); c = t < 0 ? o.low ?? "blue" : o.high ?? "red"; a = Math.abs(t) * 0.9; }
        else { const t = clamp((v - lo) / (hi - lo || 1), 0, 1); c = o.color ?? "blue"; a = 0.05 + t * 0.88; }
        g.rect(x + 0.5, y + 0.5, cw - 1, ch - 1, { fill: c, alpha: a });
        if (o.values && cw > 26 && ch > 14) g.text((o.format ?? (u => fmt(u, { fixed: 2 })))(v), [x + cw / 2, y + ch / 2], { size: Math.min(12, ch * 0.42), color: a > 0.6 ? "panel" : "ink" });
      }
      g.rect(x0, y0, cw * cols, ch * rows, { stroke: "faint", width: 1 });
      if (o.rowLabels) o.rowLabels.forEach((s, i) => txt(s, [x0 - 7, y0 + ch * (i + 0.5)], { ...LS, align: "right", color: o.highlight?.row === i ? "ink" : "muted" }));
      if (o.colLabels) o.colLabels.forEach((s, j) => {
        const p = [x0 + cw * (j + 0.5), y0 - 7], c = o.highlight?.col === j ? "ink" : "muted";
        if (!rotate) { txt(s, [p[0], y0 - 9], { ...LS, color: c }); return; }
        const ctx = g.ctx;
        ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(-Math.PI / 4);
        txt(s, [0, 0], { ...LS, color: c, align: "left" });
        ctx.restore();
      });
      const hlt = o.highlight;
      if (hlt) {
        if (hlt.row != null && hlt.col != null) { const [x, y] = cellAt(hlt.row, hlt.col); g.rect(x, y, cw, ch, { stroke: "ink", width: 2 }); }
        else if (hlt.row != null) g.rect(x0, y0 + hlt.row * ch, cw * cols, ch, { stroke: "ink", width: 2 });
        else if (hlt.col != null) g.rect(x0 + hlt.col * cw, y0, cw, ch * rows, { stroke: "ink", width: 2 });
      }
      const hit = p => { const j = Math.floor((p[0] - x0) / cw), i = Math.floor((p[1] - y0) / ch); return i >= 0 && i < rows && j >= 0 && j < cols ? { i, j } : null; };
      return { cell: cellAt, hit, box: [x0, y0, cw * cols, ch * rows], range: [lo, hi] };
    };
    // A neural network as nodes and edges. layers: counts ([2, 3, 1]) or label lists. o.weights[l][j][i] is the weight from
    // node i of layer l to node j of layer l + 1 (signed: blue positive, red negative); o.activations[l][i] in [0, 1] fills nodes.
    g.network = (layers, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], counts = layers.map(l => (Array.isArray(l) ? l.length : l));
      const labH = o.labels ? 20 : 0, n = counts.length, maxN = Math.max(...counts);
      const colGap = box[2] / n, rowGap = (box[3] - labH) / maxN;
      const r = o.r ?? clamp(Math.min(colGap, rowGap) * 0.24, 5, 17);
      const nodes = counts.map((k, l) => Array.from({ length: k }, (_, i) => ({ p: [box[0] + colGap * (l + 0.5), box[1] + (box[3] - labH) / 2 + (i - (k - 1) / 2) * rowGap], r, layer: l, i })));
      const W = o.weights;
      let maxW = 0;
      if (W) for (const m of W) for (const row of m) for (const w of row) maxW = Math.max(maxW, Math.abs(w));
      for (let l = 0; l < n - 1; l++) for (let j = 0; j < counts[l + 1]; j++) for (let i = 0; i < counts[l]; i++) {
        const a = nodes[l][i].p, b = nodes[l + 1][j].p, w = W?.[l]?.[j]?.[i];
        const hot = o.highlight && ((o.highlight.layer === l && o.highlight.i === i) || (o.highlight.layer === l + 1 && o.highlight.i === j));
        if (w == null) g.line(a, b, { stroke: hot ? "ink" : "faint", width: hot ? 1.5 : 1 });
        else { const t = Math.abs(w) / (maxW || 1); g.line(a, b, { stroke: w >= 0 ? o.posColor ?? "blue" : o.negColor ?? "red", width: 0.5 + 3 * t, alpha: hot ? 1 : 0.2 + 0.6 * t }); }
      }
      nodes.forEach((col, l) => col.forEach((nd, i) => {
        const act = o.activations?.[l]?.[i];
        tinted(s => g.circle(nd.p, r, s), act == null ? null : o.color ?? "brass", act == null ? 0 : clamp(act, 0, 1) * 0.85);
        const hot = o.highlight && o.highlight.layer === l && o.highlight.i === i;
        g.circle(nd.p, r, { stroke: "ink", width: hot ? 2.5 : 1.3 });
        const lab = Array.isArray(layers[l]) ? layers[l][i] : o.nodeLabels?.[l]?.[i];
        if (lab != null && lab !== "") txt(lab, nd.p, { size: Math.max(9, r * 0.85), color: act > 0.6 ? "panel" : "ink", weight: 600 });
        else if (o.showValues && act != null) g.text(fmt(act, { fixed: 2 }), nd.p, { size: Math.max(8, r * 0.62), color: act > 0.6 ? "panel" : "ink" });
      }));
      if (o.labels) o.labels.forEach((s, l) => txt(s, [box[0] + colGap * (l + 0.5), box[1] + box[3] - 8], { size: 12, color: "muted" }));
      const hit = p => { for (const col of nodes) for (const nd of col) if (Math.hypot(p[0] - nd.p[0], p[1] - nd.p[1]) <= r + 3) return { layer: nd.layer, i: nd.i }; return null; };
      return { nodes, hit, r };
    };
    // A row of token chips that wraps inside o.width, starting at o.at (top-left). o.highlight (index), o.colors ("cycle", a palette
    // name, or a list), o.values (a small number under each chip, like a probability), o.showSpaces (leading spaces as ·).
    g.tokens = (list, o = {}) => {
      const [x0, y0] = o.at ?? [12, 12], maxW = o.width ?? g.w - 2 * x0, size = o.size ?? 13, padX = 6, gap = o.gap ?? 4;
      const font = o.font ?? "mono", chipH = size + 10, rowH = chipH + (o.values ? 18 : 0) + gap + 2;
      const CYCLE = ["blue", "green", "orange", "purple", "red", "brass"];
      const rects = [];
      let x = x0, y = y0;
      list.forEach((tok, i) => {
        const shown = o.showSpaces === false ? tok : String(tok).replace(/ /g, "·").replace(/\n/g, "↵");
        const w = Math.max(chipH * 0.8, g.measure(shown, { size, font }) + padX * 2);
        if (x + w > x0 + maxW && x > x0) { x = x0; y += rowH; }
        const c = Array.isArray(o.colors) ? o.colors[i] : o.colors === "cycle" || o.colors == null ? CYCLE[i % CYCLE.length] : o.colors;
        const on = o.highlight == null || o.highlight === i || (Array.isArray(o.highlight) && o.highlight.includes(i));
        tinted(s => g.rect(x, y, w, chipH, { ...s, r: 4 }), c, on ? (o.highlight === i ? 0.5 : 0.22) : 0.08);
        g.rect(x, y, w, chipH, { stroke: o.highlight === i ? "ink" : c, width: o.highlight === i ? 1.8 : 1, r: 4, alpha: on ? 1 : 0.5 });
        g.text(shown, [x + w / 2, y + chipH / 2 + 0.5], { size, font, color: on ? "ink" : "muted" });
        if (o.values) g.text((o.format ?? (v => fmt(v, { fixed: 2 })))(o.values[i]), [x + w / 2, y + chipH + 9], { size: 11, color: "muted" });
        rects.push({ i, x, y, w, h: chipH });
        x += w + gap;
      });
      const hit = p => { const r = rects.find(q => p[0] >= q.x && p[0] <= q.x + q.w && p[1] >= q.y && p[1] <= q.y + q.h); return r ? r.i : -1; };
      return { rects, hit, height: list.length ? y + rowH - y0 : 0 };
    };
  });

  window.Num = Num;
})();
