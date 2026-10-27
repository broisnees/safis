/* Sound kit (window.Sound): Web Audio voices with smooth parameters, plucked strings,
   noise through filters, ADSR envelopes, and buffers from f(t), all behind a master
   gain cap and limiter; plus real analysis (radix-2 FFT, spectra, spectrograms) and
   the g helpers that draw them. Reference: references/sound.md in the skill.
   Nothing makes a sound until the reader presses something: the AudioContext is
   created on the first user gesture, so a page that is never played stays silent. */
(() => {
  "use strict";
  const TAU = Math.PI * 2, SR = 44100, MASTER = 0.22;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
  const nextPow2 = n => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  const hasDoc = typeof document !== "undefined";

  // Seeded random numbers (mulberry32), so noise is the same on every load.
  function rng(seed = 1) {
    let a = seed >>> 0 || 1;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Analysis ----------
  const plans = new Map();
  function plan(n) {
    let p = plans.get(n);
    if (p) return p;
    if (!isPow2(n)) throw new Error(`Sound.fft needs a power-of-two length, got ${n}`);
    const bits = Math.round(Math.log2(n)), rev = new Uint32Array(n), cos = new Float64Array(n / 2 || 1), sin = new Float64Array(n / 2 || 1);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1); rev[i] = r; }
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((TAU * i) / n); sin[i] = -Math.sin((TAU * i) / n); }
    p = { rev, cos, sin };
    plans.set(n, p);
    return p;
  }
  // In-place iterative radix-2 FFT: X[k] = sum x[n] e^(-2 pi i k n / N). inverse divides by N.
  function fft(re, im, inverse = false) {
    const n = re.length;
    im = im ?? new Float64Array(n);
    const { rev, cos, sin } = plan(n), sg = inverse ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step], wi = sg * sin[k * step], a = i + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    return { re, im };
  }
  const ifft = (re, im) => fft(re, im, true);

  // Window functions (periodic), cached by name and length.
  const wins = new Map();
  function windowOf(name, n) {
    const key = name + n;
    let w = wins.get(key);
    if (w) return w;
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = (TAU * i) / n;
      w[i] = name === "rect" || name === "none" ? 1 : name === "hamming" ? 0.54 - 0.46 * Math.cos(t)
        : name === "blackman" ? 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t) : 0.5 - 0.5 * Math.cos(t);
    }
    wins.set(key, w);
    return w;
  }

  // One-sided amplitude spectrum, scaled so a sine of amplitude A peaks at about A.
  // Returns size / 2 + 1 magnitudes; bin k is k * sampleRate / size Hz.
  function spectrum(x, o = {}) {
    const off = o.offset ?? 0, avail = Math.max(0, x.length - off);
    const size = o.size ?? nextPow2(Math.min(Math.max(avail, 2), 16384));
    if (!isPow2(size)) throw new Error(`Sound.spectrum size must be a power of two, got ${size}`);
    const len = Math.min(size, avail), w = windowOf(o.window ?? "hann", Math.max(1, len));
    const re = new Float64Array(size), im = new Float64Array(size);
    let sw = 0;
    for (let i = 0; i < len; i++) { re[i] = x[off + i] * w[i]; sw += w[i]; }
    fft(re, im);
    const half = size / 2, out = new Float32Array(half + 1), floor = o.floor ?? -120;
    for (let k = 0; k <= half; k++) {
      const m = Math.hypot(re[k], im[k]) / (sw || 1), a = k === 0 || k === half ? m : 2 * m;
      out[k] = o.db ? Math.max(floor, 20 * Math.log10(a + 1e-12)) : a;
    }
    return out;
  }
  const binFreq = (k, size, sampleRate = SR) => (k * sampleRate) / size;

  // The largest local maxima, refined by a parabola through the log magnitudes. With the
  // default Hann window the amplitude is corrected by the window's exact main-lobe shape.
  function peaks(mags, o = {}) {
    const hann = (o.window ?? "hann") === "hann";
    const n = mags.length, size = (n - 1) * 2, sr = o.sampleRate ?? SR;
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, mags[i]);
    const min = o.min ?? max * 1e-3, out = [];
    for (let k = 1; k < n - 1; k++) {
      const m = mags[k];
      if (m <= min || m < mags[k - 1] || m <= mags[k + 1]) continue;
      const a = Math.log(mags[k - 1] + 1e-30), b = Math.log(m + 1e-30), c = Math.log(mags[k + 1] + 1e-30);
      const d = a - 2 * b + c, p = d ? clamp((0.5 * (a - c)) / d, -0.5, 0.5) : 0;
      const lobe = p ? Math.abs(Math.sin(Math.PI * p) / (Math.PI * p)) / (1 - p * p) : 1;
      out.push({ bin: k + p, mag: hann ? m / lobe : Math.exp(b - 0.25 * (a - c) * p), freq: ((k + p) * sr) / size });
    }
    return out.sort((x, y) => y.mag - x.mag).slice(0, o.count ?? 5);
  }

  // Short-time spectra for a spectrogram: one magnitude array per hop.
  function stft(x, o = {}) {
    const size = o.size ?? 1024, hop = o.hop ?? size / 4, frames = [];
    const count = Math.max(1, Math.floor((x.length - size) / hop) + 1);
    for (let i = 0; i < count; i++) frames.push(spectrum(x, { size, offset: i * hop, window: o.window, db: o.db, floor: o.floor }));
    return frames;
  }

  const rms = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length || 1)); };

  // ---------- Synthesis, offline (pure functions, also used to draw what plays) ----------
  const typeOf = p => p.type ?? (p.harmonics ? "additive" : "sine");
  // Fourier amplitudes of the standard shapes, as sine-series coefficients.
  function partials(p, sr = SR) {
    const t = typeOf(p);
    if (p.harmonics) return p.harmonics;
    if (t === "sine") return [1];
    const K = clamp(Math.floor(sr / 2 / (p.freq ?? 220)), 1, 400), a = new Float64Array(K);
    for (let k = 1; k <= K; k++) {
      a[k - 1] = t === "square" ? (k % 2 ? 4 / (Math.PI * k) : 0)
        : t === "sawtooth" ? ((k % 2 ? 2 : -2) / (Math.PI * k))
        : t === "triangle" ? (k % 2 ? (((k - 1) / 2) % 2 ? -8 : 8) / (Math.PI * Math.PI * k * k) : 0) : 0;
    }
    return a;
  }
  // One period as a table, normalized to a peak of 1 (the same scaling the live voice uses).
  const tables = new Map();
  function cycleTable(amps, phases, n = 2048, normalize = true) {
    const key = `${n}|${normalize}|${Array.prototype.join.call(amps, ",")}|${phases ? phases.join(",") : ""}`;
    let tab = tables.get(key);
    if (tab) return tab;
    tab = new Float32Array(n);
    for (let k = 0; k < amps.length; k++) {
      const a = amps[k];
      if (!a) continue;
      const ph = phases?.[k] ?? 0;
      for (let i = 0; i < n; i++) tab[i] += a * Math.sin(((k + 1) * TAU * i) / n + ph);
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(tab[i]));
    const s = normalize ? 1 / (peak || 1) : 1 / Math.max(1, peak);
    for (let i = 0; i < n; i++) tab[i] *= s;
    tab.scale = s;
    if (tables.size > 64) tables.delete(tables.keys().next().value);
    tables.set(key, tab);
    return tab;
  }
  // `cycles` periods of a voice's waveform at n points, for drawing its shape.
  function cycle(p, o = {}) {
    const n = o.n ?? 512, cycles = o.cycles ?? 1, tab = cycleTable(partials(p, o.sampleRate ?? SR), p.phases, 2048, p.normalize !== false);
    const out = new Float32Array(n), g = clamp(p.gain ?? 1, 0, 1);
    for (let i = 0; i < n; i++) {
      const u = ((i / (n - 1 || 1)) * cycles % 1) * 2048, j = Math.floor(u), f = u - j;
      out[i] = g * (tab[j % 2048] * (1 - f) + tab[(j + 1) % 2048] * f);
    }
    return out;
  }

  function noise(n, o = {}) {
    const r = rng(o.seed ?? 7), color = o.color ?? "white", x = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      if (color === "pink") {
        // Paul Kellet's filter: -3 dB per octave within 0.05 dB above 9 Hz.
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else if (color === "brown") { br = (br + 0.02 * w) / 1.02; x[i] = br * 3.5; }
      else x[i] = w;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
    if (peak > 1) for (let i = 0; i < n; i++) x[i] /= peak;
    return x;
  }

  // RBJ cookbook biquad, the same formulas as Web Audio's BiquadFilterNode. q is linear for every type.
  function biquad(f, sr = SR) {
    const type = f.type ?? "lowpass", w = (TAU * clamp(f.freq ?? 1000, 1, sr / 2 - 1)) / sr;
    const cw = Math.cos(w), al = Math.sin(w) / (2 * Math.max(1e-4, f.q ?? Math.SQRT1_2)), A = 10 ** ((f.gain ?? 0) / 40);
    let b = [1, 0, 0], a = [1 + al, -2 * cw, 1 - al];
    if (type === "lowpass") b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
    else if (type === "highpass") b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
    else if (type === "bandpass") b = [al, 0, -al];
    else if (type === "notch") b = [1, -2 * cw, 1];
    else if (type === "allpass") b = [1 - al, -2 * cw, 1 + al];
    else if (type === "peaking") { b = [1 + al * A, -2 * cw, 1 - al * A]; a = [1 + al / A, -2 * cw, 1 - al / A]; }
    else throw new Error(`Sound: unknown filter type "${type}"`);
    return [b[0] / a[0], b[1] / a[0], b[2] / a[0], a[1] / a[0], a[2] / a[0]];
  }
  function filter(x, f, sr = SR) {
    const [b0, b1, b2, a1, a2] = biquad(f, sr), y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  // Magnitude response |H| of a filter at each frequency (Hz).
  function response(f, freqs, sr = SR) {
    const [b0, b1, b2, a1, a2] = biquad(f, sr);
    return Float32Array.from(freqs, hz => {
      const w = (TAU * hz) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
      return Math.hypot(b0 + b1 * c1 + b2 * c2, b1 * s1 + b2 * s2) / Math.hypot(1 + a1 * c1 + a2 * c2, a1 * s1 + a2 * s2);
    });
  }

  // ADSR level at time t (s) for a note held for `held` seconds. Linear segments, like the live voice.
  const ENV = { a: 0.02, d: 0, s: 1, r: 0.08 };
  function adsr(t, env = ENV, held = Infinity) {
    const a = env.a ?? 0.01, d = env.d ?? 0.1, s = env.s ?? 0.8, r = env.r ?? 0.2;
    const level = u => (u <= 0 ? 0 : u < a ? u / a : u < a + d ? 1 - ((1 - s) * (u - a)) / d : s);
    if (t < held) return level(t);
    return r > 0 ? Math.max(0, level(held) * (1 - (t - held) / r)) : 0;
  }

  // Karplus-Strong plucked string: one period of the string's shape circulating in a delay
  // line through a two-point average (the loss that dulls high harmonics first). The shape
  // is the triangle a finger pulls the string into at `pick` (0 to 0.5 of its length),
  // plus filtered noise for `brightness`. An allpass supplies the fractional delay, so the pitch is exact.
  function karplus(o = {}) {
    const sr = o.sampleRate ?? SR, f = clamp(o.freq ?? 220, 20, sr / 4), n = Math.max(1, Math.round((o.duration ?? 2) * sr));
    const P = sr / f, N = Math.max(2, Math.floor(P - 0.6)), eta = P - 0.5 - N, C = (1 - eta) / (1 + eta);
    const rho = 10 ** (-3 / (Math.max(0.05, o.decay ?? 2) * f));   // per-loop gain: -60 dB after `decay` seconds
    const bright = clamp(o.brightness ?? 0.5, 0, 1), beta = clamp(o.pick ?? 0.2, 0.02, 0.5), r = rng(o.seed ?? 3);
    const exc = new Float32Array(N), k = 1 - bright * 0.95;
    let lp = 0, mean = 0, peak = 0;
    for (let i = 0; i < N; i++) {
      const u = i / N, tri = u < beta ? u / beta : (1 - u) / (1 - beta);
      lp += (1 - k) * (r() * 2 - 1 - lp);
      exc[i] = tri + bright * 0.7 * lp;
      mean += exc[i] / N;
    }
    for (let i = 0; i < N; i++) { exc[i] -= mean; peak = Math.max(peak, Math.abs(exc[i])); }   // no DC: it would ring on forever
    const y = new Float32Array(n);
    let apx = 0, apy = 0;
    for (let i = 0; i < n; i++) {
      const u = 0.5 * rho * ((i >= N ? y[i - N] : 0) + (i > N ? y[i - N - 1] : 0));
      const ap = C * u + apx - C * apy;
      apx = u; apy = ap;
      y[i] = (i < N ? exc[i] / (peak || 1) : 0) + ap;
    }
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(y[i]));
    const g = clamp(o.gain ?? 0.9, 0, 1) / (m || 1);
    for (let i = 0; i < n; i++) y[i] *= g;
    return y;
  }

  function fromFunction(fn, o = {}) {
    const sr = o.sampleRate ?? SR, n = Math.max(1, Math.round((o.duration ?? 1) * sr)), x = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = +fn(i / sr); x[i] = Number.isFinite(v) ? clamp(v, -1, 1) : 0; }
    return x;
  }

  // Render a voice spec (the same object Sound.voice takes) to samples.
  function render(p, o = {}) {
    const sr = o.sampleRate ?? SR, n = Math.max(1, Math.round((o.duration ?? 1) * sr)), t = typeOf(p);
    if (t === "pluck") return karplus({ ...p, duration: n / sr, sampleRate: sr });
    let x;
    if (t === "noise") x = noise(n, p);
    else {
      const tab = cycleTable(partials(p, sr), p.phases, 2048, p.normalize !== false), f = p.freq ?? 220;
      x = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = (((f * i) / sr) % 1) * 2048, j = Math.floor(u), fr = u - j;
        x[i] = tab[j] * (1 - fr) + tab[(j + 1) % 2048] * fr;
      }
    }
    if (p.filter) x = filter(x, p.filter, sr);
    const g = clamp(p.gain ?? 1, 0, 1);
    if (p.env || o.env) {
      const env = p.env ?? o.env, held = o.held ?? n / sr - (env.r ?? 0.2);
      for (let i = 0; i < n; i++) x[i] *= g * adsr(i / sr, env, held);
    } else if (g !== 1) for (let i = 0; i < n; i++) x[i] *= g;
    return x;
  }

  // ---------- Live audio ----------
  let ac = null, master = null, volume = 1;
  const allowed = () => { const u = typeof navigator !== "undefined" && navigator.userActivation; return u ? u.hasBeenActive : true; };
  // The AudioContext, created on demand once the page has had a user gesture; null otherwise.
  function audio() {
    if (ac) { if (ac.state === "suspended" && allowed()) ac.resume().catch(() => {}); return ac; }
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC || !allowed()) return null;
    try {
      ac = new AC({ latencyHint: "interactive" });
      master = ac.createGain();
      master.gain.value = MASTER * volume;
      const lim = ac.createDynamicsCompressor();   // a brick-wall-ish limiter after the gain cap
      lim.threshold.value = -12; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
      master.connect(lim).connect(ac.destination);
    } catch { ac = null; }
    return ac;
  }

  const live = new Set();          // everything playing now: voices and one-shots
  const owners = new Map();        // figure element -> { el, fig, buttons }
  let pressing = null;             // the figure whose sound button is being pressed

  function ownerOf(fig) {
    const el = fig?.el ?? (fig && fig.nodeType === 1 ? fig : null);
    if (!el) return null;
    let rec = owners.get(el);
    if (!rec) {
      rec = { el, fig: null, buttons: [] };
      owners.set(el, rec);
      // The runtime says when the figure leaves the screen, resets, or goes away.
      el.addEventListener?.("safis:visibility", e => { if (!e.detail?.visible) stopOwner(el); });
      el.addEventListener?.("safis:reset", () => stopOwner(el));
      el.addEventListener?.("safis:destroy", () => stopOwner(el));
    }
    if (fig.el) rec.fig = fig;
    return el;
  }
  // One figure plays at a time: starting a sound stops what other figures are playing.
  function claim(p, o) {
    const fig = o.fig ?? pressing;
    if (fig) p.owner = ownerOf(fig);
    for (const q of [...live]) if (q !== p && q.owner !== p.owner) q.stop();
  }
  function stopOwner(el) { for (const q of [...live]) if (q.owner === el) q.stop(); }
  function stopAll() { for (const q of [...live]) q.stop(); }
  // Tell the figure to redraw; its buttons relabel themselves from text() and pressed().
  function changed(el) {
    const rec = el && owners.get(el);
    if (!rec) return;
    for (const b of rec.buttons) {
      const on = b.isOn();
      if (b.animate && rec.fig && b.was !== on) rec.fig.play(on);
      b.was = on;
    }
    rec.fig?.redraw?.();
  }
  if (hasDoc) {
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopAll(); });
    addEventListener("pagehide", stopAll);
  }

  const same = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (ArrayBuffer.isView(a) || Array.isArray(a)) return a.length === b.length && Array.prototype.every.call(a, (x, i) => x === b[i]);
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k]);
  };
  const copy = v => (ArrayBuffer.isView(v) || Array.isArray(v) ? Array.from(v) : v && typeof v === "object" ? { ...v } : v);
  const envOf = p => ({ ...ENV, ...(p.env ?? {}) });
  const MAXP = 64;

  function setFilter(node, f, t, tc) {
    if (!f) { node.type = "allpass"; return; }
    if (node.type !== (f.type ?? "lowpass")) node.type = f.type ?? "lowpass";
    const q = Math.max(1e-4, f.q ?? Math.SQRT1_2), lphp = node.type === "lowpass" || node.type === "highpass";
    node.frequency.setTargetAtTime(clamp(f.freq ?? 1000, 10, node.context.sampleRate / 2 - 10), t, tc);
    node.Q.setTargetAtTime(lphp ? 20 * Math.log10(q) : q, t, tc);    // Web Audio takes Q in dB for these two
    node.gain.setTargetAtTime(f.gain ?? 0, t, tc);
  }
  function addPartial(n, k, t) {
    const ctx = n.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g).connect(n.filter);
    osc.start(t);
    n.srcs.push(osc);
    n.bank.push({ osc, g, k, ph: null });
  }
  function applyPartials(n, p, t, tc) {
    const amps = p.harmonics ?? [1], f = p.freq ?? 220, ny = n.ctx.sampleRate / 2;
    while (n.bank.length < Math.min(MAXP, amps.length)) addPartial(n, n.bank.length + 1, n.ctx.currentTime);
    const scale = cycleTable(amps.slice(0, MAXP), p.phases, 512, p.normalize !== false).scale;
    for (const b of n.bank) {
      const a = (amps[b.k - 1] ?? 0) * scale, ph = (p.phases?.[b.k - 1] ?? 0) + (a < 0 ? Math.PI : 0);
      if (ph !== b.ph) {
        // A sine with a phase offset: sin(x + ph) = cos(ph) sin x + sin(ph) cos x.
        b.osc.setPeriodicWave(n.ctx.createPeriodicWave(new Float32Array([0, Math.sin(ph)]), new Float32Array([0, Math.cos(ph)]), { disableNormalization: true }));
        b.ph = ph;
      }
      b.osc.frequency.setTargetAtTime(b.k * f, t, tc);
      b.g.gain.setTargetAtTime(b.k * f < ny ? Math.abs(a) : 0, t, tc);
    }
  }
  function build(ctx, p) {
    const t = ctx.currentTime, type = typeOf(p), env = envOf(p);
    const n = { ctx, type, srcs: [], bank: [], color: p.color };
    n.filter = ctx.createBiquadFilter();
    n.env = ctx.createGain();
    n.out = ctx.createGain();
    n.out.gain.value = clamp(p.gain ?? 1, 0, 1);
    n.filter.connect(n.env).connect(n.out).connect(master);
    setFilter(n.filter, p.filter, t, 0.001);
    n.env.gain.setValueAtTime(0, t);
    n.env.gain.linearRampToValueAtTime(1, t + Math.max(0.003, env.a));
    if (env.d > 0) n.env.gain.linearRampToValueAtTime(env.s, t + Math.max(0.003, env.a) + env.d);
    if (type === "noise") newNoise(n, p, t);
    else if (type === "additive") applyPartials(n, p, t, 0.001);
    else {
      const osc = ctx.createOscillator();
      osc.type = ["square", "sawtooth", "triangle"].includes(type) ? type : "sine";
      osc.frequency.value = p.freq ?? 220;
      osc.connect(n.filter);
      osc.start(t);
      n.srcs.push(osc);
      n.osc = osc;
    }
    return n;
  }
  function newNoise(n, p, t) {
    const ctx = n.ctx, buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    buf.getChannelData(0).set(noise(buf.length, { color: p.color, seed: p.seed }));
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(n.filter);
    src.start(t);
    if (n.noise) { n.noise.stop(t + 0.02); n.srcs = n.srcs.filter(s => s !== n.noise); }
    n.noise = src; n.color = p.color;
    n.srcs.push(src);
  }
  function update(n, p) {
    const t = n.ctx.currentTime, tc = p.glide ?? 0.03;
    n.out.gain.setTargetAtTime(clamp(p.gain ?? 1, 0, 1), t, tc);
    setFilter(n.filter, p.filter, t, tc);
    if (n.type === "noise") { if (p.color !== n.color) newNoise(n, p, t); }
    else if (n.type === "additive") applyPartials(n, p, t, tc);
    else if (n.osc) n.osc.frequency.setTargetAtTime(p.freq ?? 220, t, tc);
  }
  function release(n, p, elapsed) {
    const t = n.ctx.currentTime, env = envOf(p), r = Math.max(0.01, env.r);
    n.env.gain.cancelScheduledValues(t);
    n.env.gain.setValueAtTime(adsr(elapsed, env), t);
    n.env.gain.linearRampToValueAtTime(0, t + r);
    for (const s of n.srcs) { try { s.stop(t + r + 0.05); } catch {} }
    setTimeout(() => { try { n.out.disconnect(); } catch {} }, (r + 0.3) * 1000);
  }

  // A continuous voice. Parameters glide (setTargetAtTime), so calling set() from draw() is cheap and smooth.
  class Voice {
    constructor(o = {}) {
      this.params = {};
      for (const k in o) this.params[k] = copy(o[k]);
      this.params.type = typeOf(o);
      this.playing = false; this.owner = null; this.t0 = 0; this.n = null;
    }
    get elapsed() { return this.playing ? clock() - this.t0 : 0; }
    get audible() { return !!this.n; }
    start(o = {}) {
      if (this.playing) return this;
      claim(this, o);
      this.playing = true; this.t0 = clock();
      live.add(this);
      const ctx = audio();
      if (ctx) this.n = build(ctx, this.params);
      changed(this.owner);
      return this;
    }
    stop() {
      if (!this.playing) return this;
      this.playing = false;
      live.delete(this);
      if (this.n) release(this.n, this.params, clock() - this.t0);
      this.n = null;
      changed(this.owner);
      return this;
    }
    toggle(on = !this.playing, o) { return on ? this.start(o) : this.stop(); }
    set(p) {
      let dirty = false;
      for (const k in p) if (k !== "type" && !same(this.params[k], p[k])) { this.params[k] = copy(p[k]); dirty = true; }
      if (dirty && this.n) update(this.n, this.params);
      return this;
    }
  }
  const voice = o => new Voice(o);

  // Play samples, a function f(t), or a voice spec once. Returns a playback with stop() and progress.
  function play(src, o = {}) {
    const ctx = audio(), rate0 = ctx ? ctx.sampleRate : SR;
    let x = src, rate = o.sampleRate ?? SR;
    if (typeof src === "function") { rate = rate0; x = fromFunction(src, { duration: o.duration ?? 1, sampleRate: rate }); }
    else if (src && !ArrayBuffer.isView(src) && !Array.isArray(src)) { rate = rate0; x = render(src, { duration: o.duration ?? (typeOf(src) === "pluck" ? 2 : 1), sampleRate: rate }); }
    let timer = null, node = null, gain = null;
    const pb = {
      playing: true, owner: null, duration: x.length / rate, t0: clock(),
      get elapsed() { return this.playing ? clock() - this.t0 : 0; },
      get progress() { return this.playing ? clamp((clock() - this.t0) / this.duration, 0, 1) : 0; },
      stop() {
        if (!this.playing) return this;
        if (node) { try { gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01); node.stop(ctx.currentTime + 0.06); } catch {} }
        end();
        return this;
      },
    };
    function end() {
      if (!pb.playing) return;
      pb.playing = false;
      clearTimeout(timer);
      live.delete(pb);
      changed(pb.owner);
      o.onend?.();
    }
    claim(pb, o);
    live.add(pb);
    if (ctx && x.length) {
      const buf = ctx.createBuffer(1, x.length, rate), d = buf.getChannelData(0), fade = Math.min(x.length / 2, Math.round(rate * 0.003));
      let peak = 0;
      for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
      const s = peak > 1 ? 1 / peak : 1;
      for (let i = 0; i < x.length; i++) d[i] = x[i] * s * (o.loop ? 1 : Math.min(1, i / fade, (x.length - 1 - i) / fade));
      node = ctx.createBufferSource();
      node.buffer = buf; node.loop = !!o.loop;
      gain = ctx.createGain();
      gain.gain.value = clamp(o.gain ?? 1, 0, 1);
      node.connect(gain).connect(master);
      node.onended = end;
      node.start();
    } else if (!o.loop) timer = setTimeout(end, pb.duration * 1000);
    return pb;
  }
  const pluck = (o = {}) => play(karplus({ ...o, sampleRate: audio()?.sampleRate ?? SR }), { ...o, sampleRate: audio()?.sampleRate ?? SR, gain: 1 });

  // A play/stop button control for a figure. target: a voice, a list of voices, or
  // fn(s, v, fig) that starts one-shots (Sound.play, Sound.pluck) and returns them.
  function button(target, o = {}) {
    const voices = typeof target === "function" ? null : [].concat(target);
    const label = o.label ?? "Play", stopLabel = o.stopLabel ?? "Stop", toggle = o.toggle ?? !!voices;
    let shots = [];
    const isOn = () => (voices ?? shots).some(x => x.playing);
    const ctl = {
      type: "button", label, primary: o.primary ?? true, color: o.color, hidden: o.hidden,
      text: toggle ? () => (isOn() ? stopLabel : label) : undefined,
      pressed: toggle ? () => isOn() : undefined,
      action(s, v, fig) {
        audio();                              // inside the click, so the browser lets audio start
        const el = ownerOf(fig), rec = owners.get(el);
        if (rec && !rec.buttons.some(b => b.ctl === ctl)) rec.buttons.push({ ctl, isOn, animate: !!o.animate, was: false });
        pressing = fig;
        try {
          if (toggle && isOn()) (voices ?? shots).forEach(x => x.stop());
          else if (voices) voices.forEach(x => x.start());
          else shots = [].concat(target(s, v, fig) ?? []).filter(x => x && typeof x.stop === "function");
        } finally { pressing = null; }
        changed(el);
      },
    };
    return ctl;
  }
  const playingIn = fig => { const el = fig?.el ?? fig; return [...live].some(q => q.owner === el); };

  // ---------- Drawing helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    const C = c => util.color(c);
    const fmtHz = f => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
    const db = (m, floor) => Math.max(floor, 20 * Math.log10(m + 1e-12));

    // Samples as a trace. Long signals draw as a min/max band per pixel column, like an audio editor.
    g.waveform = (x, box = [0, 0, g.w, g.h], o = {}) => {
      const [bx, by, bw, bh] = box, from = o.from ?? 0, to = Math.min(x.length, o.to ?? x.length), n = Math.max(1, to - from);
      const [lo, hi] = o.range ?? [-1, 1], c = o.color ?? "blue";
      const X = i => bx + (bw * (i - from)) / Math.max(1, n - 1), Y = v => by + (bh * (hi - v)) / (hi - lo);
      if (o.zero !== false && lo < 0 && hi > 0) g.line([bx, Y(0)], [bx + bw, Y(0)], { stroke: "grid", width: 1 });
      g.clip([bx - 2, by - 2, bw + 4, bh + 4], () => {
        if (n > bw * 1.5) {
          const cols = Math.max(1, Math.round(bw)), top = [], bot = [];
          for (let c2 = 0; c2 < cols; c2++) {
            const i0 = from + Math.floor((c2 * n) / cols), i1 = Math.max(i0 + 1, from + Math.floor(((c2 + 1) * n) / cols));
            let mn = Infinity, mx = -Infinity;
            for (let i = i0; i < i1 && i < to; i++) { const v = x[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
            const px = bx + ((c2 + 0.5) * bw) / cols;
            top.push([px, Y(mx)]); bot.push([px, Y(mn) + 0.75]);
          }
          g.path(top.concat(bot.reverse()), { fill: c, alpha: o.alpha ?? 0.9, close: true });
        } else {
          const pts = [];
          for (let i = from; i < to; i++) pts.push([X(i), Y(x[i])]);
          if (o.fill) g.path([[X(from), Y(0)], ...pts, [X(to - 1), Y(0)]], { fill: c, alpha: 0.14, close: true });
          if (o.stems) for (const p of pts) { g.line([p[0], Y(0)], p, { stroke: c, width: 1.25, alpha: 0.7 }); g.circle(p, o.dot ?? 2.5, { fill: c }); }
          else g.path(pts, { stroke: c, width: o.width ?? 2 });
        }
      });
      if (o.playhead != null) {
        const px = bx + clamp(o.playhead, 0, 1) * bw;
        g.line([px, by], [px, by + bh], { stroke: "ink", width: 1.5 });
      }
      if (o.label) g.label(o.label, [bx + 6, by + 10], { align: "left", color: c });
      return { box, x: X, y: Y, index: px => clamp(Math.round(from + ((px - bx) / bw) * (n - 1)), from, to - 1) };
    };

    // An amplitude spectrum: mags from Sound.spectrum (linear), or partial amplitudes with o.freqs.
    g.spectrum = (mags, box = [0, 0, g.w, g.h], o = {}) => {
      const sr = o.sampleRate ?? SR, size = (mags.length - 1) * 2, floor = o.floor ?? -80, c = o.color ?? "blue";
      const freqs = o.freqs ?? null, hz = k => (freqs ? freqs[k] : (k * sr) / size);
      const f0 = o.minFreq ?? (o.log ? 20 : 0), f1 = o.maxFreq ?? (freqs ? Math.max(...freqs) * 1.1 : sr / 2);
      const val = m => (o.db ? db(Math.abs(m), floor) : Math.abs(m));
      const yr = o.range ?? (o.db ? [floor, 0] : [0, 1]);
      let P = null;
      if (g.graph && o.axes !== false) {
        P = g.graph({ box, x: [f0, f1], y: yr, axes: "frame", xScale: o.log ? "log" : "linear", grid: o.grid ?? false, xFormat: o.xFormat ?? fmtHz,
          yFormat: o.yFormat, yTicks: o.yTicks ?? (o.db ? undefined : false), xTicks: o.xTicks, xLabel: o.xLabel ?? "", yLabel: o.yLabel ?? (o.db ? "dB" : ""), zeroLine: false, pad: o.pad });
      } else {
        const L = Math.log10;
        const fx = f => box[0] + (box[2] * (o.log ? (L(Math.max(f, 1e-9)) - L(f0)) / (L(f1) - L(f0)) : (f - f0) / (f1 - f0)));
        P = p => [fx(p[0]), box[1] + (box[3] * (yr[1] - p[1])) / (yr[1] - yr[0])];
        P.box = box; P.clip = fn => g.clip(box, fn);
      }
      const base = yr[0], style = o.style ?? (freqs ? "stems" : "line");
      P.clip(() => {
        if (style === "stems" || style === "bars") {
          const bw = style === "bars" ? Math.max(1, (P.box[2] / Math.max(1, (f1 - f0) / (sr / size))) * 0.8) : 0;
          for (let k = 0; k < mags.length; k++) {
            const f = hz(k), v = val(mags[k]);
            if (f < f0 || f > f1 || v <= base) continue;
            const a = P([f, base]), b = P([f, v]), hot = o.highlight === k;
            if (bw) g.rect(b[0] - bw / 2, b[1], bw, a[1] - b[1], { fill: hot ? "ink" : c, alpha: 0.85 });
            else { g.line(a, b, { stroke: hot ? "ink" : c, width: 2.5 }); g.circle(b, 3.5, { fill: hot ? "ink" : c }); }
          }
        } else {
          const pts = [];
          for (let k = 0; k < mags.length; k++) { const f = hz(k); if (f >= f0 && f <= f1 && (!o.log || f > 0)) pts.push(P([f, val(mags[k])])); }
          if (pts.length > 1) {
            const yb = P([f0, base])[1];
            if (o.fill !== false) g.path([[pts[0][0], yb], ...pts, [pts[pts.length - 1][0], yb]], { fill: c, alpha: 0.14, close: true });
            g.path(pts, { stroke: c, width: o.width ?? 1.75 });
          }
        }
      });
      if (o.peaks) {
        const list = freqs ? [...mags].map((m, k) => ({ freq: hz(k), mag: Math.abs(m) })).sort((a, b) => b.mag - a.mag).slice(0, o.peaks) : peaks(mags, { count: o.peaks, sampleRate: sr });
        for (const p of list) if (p.freq >= f0 && p.freq <= f1) { const q = P([p.freq, val(p.mag)]); g.label(fmtHz(p.freq), [q[0], q[1] - 12], { color: c, size: 12 }); }
      }
      return { P, box: P.box, x: f => P([f, base])[0], y: m => P([f0, val(m)])[1] };
    };

    // Short-time spectra as an image: time across, frequency up, loudness as ink.
    const sgCache = new WeakMap();
    g.spectrogram = (frames, box = [0, 0, g.w, g.h], o = {}) => {
      const sr = o.sampleRate ?? SR, bins = frames[0]?.length ?? 0, size = (bins - 1) * 2, floor = o.floor ?? -80, ref = o.ref ?? 1;
      const maxF = Math.min(o.maxFreq ?? sr / 2, sr / 2), nb = Math.max(1, Math.min(bins, Math.round((maxF / (sr / 2)) * (bins - 1)) + 1));
      const hop = o.hop ?? size / 4, dur = (frames.length * hop) / sr;
      let P = null, area = box;
      if (g.graph && o.axes !== false) {
        P = g.graph({ box, x: [0, dur], y: [0, maxF], axes: "frame", grid: false, xFormat: o.xFormat ?? (t => `${+t.toFixed(2)} s`), yFormat: o.yFormat ?? fmtHz, xLabel: o.xLabel ?? "", yLabel: o.yLabel ?? "", zeroLine: false, pad: o.pad });
        area = P.box;
      }
      const key = `${C("panel")}|${C(o.color ?? "ink")}|${floor}|${ref}|${nb}|${o.gamma ?? 1}`;
      let hit = sgCache.get(frames);
      if (!hit || hit.key !== key) {
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, frames.length); cv.height = nb;
        const c2 = cv.getContext("2d"), img = c2.createImageData(cv.width, nb), lo = util.rgb("panel"), hi = util.rgb(o.color ?? "ink");
        for (let i = 0; i < frames.length; i++) for (let k = 0; k < nb; k++) {
          const t = clamp((db(frames[i][k] / ref, floor) - floor) / -floor, 0, 1) ** (o.gamma ?? 1), q = ((nb - 1 - k) * cv.width + i) * 4;
          img.data[q] = lo[0] + (hi[0] - lo[0]) * t; img.data[q + 1] = lo[1] + (hi[1] - lo[1]) * t; img.data[q + 2] = lo[2] + (hi[2] - lo[2]) * t; img.data[q + 3] = 255;
        }
        c2.putImageData(img, 0, 0);
        hit = { key, cv };
        sgCache.set(frames, hit);
      }
      const ctx = g.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = o.smooth !== false;
      ctx.drawImage(hit.cv, area[0], area[1], area[2], area[3]);
      ctx.restore();
      if (o.playhead != null) { const px = area[0] + clamp(o.playhead, 0, 1) * area[2]; g.line([px, area[1]], [px, area[1] + area[3]], { stroke: o.playheadColor ?? "red", width: 1.5 }); }
      return { P, box: area, time: px => ((px - area[0]) / area[2]) * dur, freq: py => (1 - (py - area[1]) / area[3]) * maxF };
    };

    // An ADSR envelope as a shape, with its four phases named.
    g.envelope = (env, box = [0, 0, g.w, g.h], o = {}) => {
      const e = { ...ENV, ...env }, held = o.held ?? e.a + e.d + Math.max(0.25, (e.a + e.d + e.r) * 0.8), T = held + e.r;
      const [bx, by, bw, bh] = box, c = o.color ?? "orange", X = t => bx + (bw * t) / T, Y = v => by + bh * (1 - v);
      g.line([bx, Y(0)], [bx + bw, Y(0)], { stroke: "muted", width: 1 });
      const pts = [0, e.a, e.a + e.d, held, T].map(t => [X(t), Y(adsr(t, e, held))]);
      g.path([...pts, [X(T), Y(0)]], { fill: c, alpha: 0.12, close: true });
      g.path(pts, { stroke: c, width: 2.5 });
      if (o.labels !== false) {
        const names = ["attack", "decay", "sustain", "release"], ts = [0, e.a, e.a + e.d, held, T];
        names.forEach((s, i) => { if (ts[i + 1] - ts[i] > 1e-6 && X(ts[i + 1]) - X(ts[i]) > g.measure(s, { size: 11.5 }) * 0.7) g.text(s, [(X(ts[i]) + X(ts[i + 1])) / 2, Y(0) + 12], { size: 11.5, color: "muted" }); });
      }
      if (o.t != null && o.t >= 0 && o.t <= T) { const p = [X(o.t), Y(adsr(o.t, e, held))]; g.line([p[0], Y(0)], p, { stroke: "ink", width: 1, dash: [3, 3] }); g.circle(p, 4.5, { fill: "ink" }); }
      return { box, x: X, y: Y, held, T };
    };
  });

  window.Sound = {
    voice, play, pluck, button, stopAll, playing: playingIn,
    get ready() { return !!ac && ac.state === "running"; },
    get context() { return ac; },
    get volume() { return volume; },
    set volume(v) { volume = clamp(+v || 0, 0, 1); if (master) master.gain.setTargetAtTime(MASTER * volume, ac.currentTime, 0.05); },
    wake: () => !!audio(),   // create or resume the AudioContext; call only inside a user gesture
    // Offline synthesis
    render, cycle, partials, karplus, noise, fromFunction, adsr, filter, response, biquad,
    // Analysis
    fft, ifft, spectrum, stft, peaks, binFreq, rms, window: windowOf, nextPow2, sampleRate: SR, rng,
  };
})();
