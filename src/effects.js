/* Effects kit: g.fx and window.Fx draw fire, exhaust, smoke, steam, dust, glow, water, ripples,
   caustics, sparks, arcs, shimmer, airflow, and wind around bodies, each a pure function of time
   t and a seed. Shaders share one WebGL2 context, with 2D versions without it.
   Reference: references/effects.md. */
(() => {
  "use strict";
  const TAU = Math.PI * 2, PI = Math.PI;
  const { exp, sin, cos, sqrt, hypot, min, max, floor, abs } = Math;
  const clamp = (x, lo, hi) => min(hi, max(lo, x)), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const cn = (v, d, lo, hi) => clamp(num(v, d), lo, hi);

  // ---------- seeded numbers ----------
  function hash(a, b = 0, c = 0) {
    let h = Math.imul(a | 0, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return h >>> 0;
  }
  const rnd = (a, b, c) => hash(a, b, c) / 4294967296;
  // Smooth value noise in [-1, 1].
  const noise1 = (x, seed = 1) => { const i = floor(x), f = x - i; return lerp(rnd(seed, i), rnd(seed, i + 1), f * f * (3 - 2 * f)) * 2 - 1; };

  // ---------- physics ----------
  // Black-body color at T kelvin, [r, g, b] 0-255 (a Planckian-locus fit).
  function blackbody(T) {
    const t = cn(T, 1500, 500, 40000) / 100;
    const r = t <= 66 ? 255 : 329.6987 * (t - 60) ** -0.1332048;
    const g = t <= 66 ? 99.4708 * Math.log(t) - 161.1196 : 288.1222 * (t - 60) ** -0.0755148;
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448;
    return [r, g, b].map(v => Math.round(clamp(v, 0, 255)));
  }
  // How bright a hot body looks, 0 to 1: dark below the Draper point (798 K), then rising with
  // the log of its visible radiance (Wien), full by 1600 K.
  const glowLevel = T => clamp((1 / 798 - 1 / max(num(T, 0), 1)) / (1 / 798 - 1 / 1600), 0, 1);
  // Pool fires puff at about 1.5 / sqrt(D) Hz, D the fire's diameter in meters.
  const puff = D => 1.5 / sqrt(clamp(D, 0.005, 50));
  // Eases cur toward target (time constant tau, s) so nothing pops.
  const follow = (cur, target, dt, tau = 0.3) => (num(cur, null) === null ? target : target + (cur - target) * exp(-max(0, dt) / max(1e-6, tau)));

  // ---------- round parts in parallel projection ----------
  // A round part's rim is a screen ellipse { center, rx, ry, angle }. In a parallel view its axis
  // runs along the minor axis at sqrt(major² - minor²) px per rim radius, so the ellipse fixes
  // the map from part coordinates [s, y, z] (rim radii) to the screen: C + s A + y E1 + z E2.
  function frame(e, axis, along) {
    const c = cos(e.angle || 0), s = sin(e.angle || 0), rx = abs(num(e.rx, 10)), ry = abs(num(e.ry, 10)), big = max(rx, ry, 1e-6), small = min(rx, ry);
    let d = axis ? [axis[0], axis[1]] : rx <= ry ? [c, s] : [-s, c];
    const l = hypot(d[0], d[1]) || 1;
    d = [d[0] / l, d[1] / l];
    if (!axis && d[0] < -1e-9) d = [-d[0], -d[1]];
    const L = num(along, max(sqrt(big * big - small * small), 0.2 * big));
    return { C: [e.center[0], e.center[1]], A: [d[0] * L, d[1] * L], E1: [rx * c, rx * s], E2: [-ry * s, ry * c], R: big, dir: d, along: L };
  }
  const onScreen = (F, x) => [0, 1].map(i => F.C[i] + x[0] * F.A[i] + x[1] * F.E1[i] + x[2] * F.E2[i]);
  // The rim ellipse of a 3D circle under a projector (g.view3d's P, an E3 view's project).
  function ellipse(project, center, normal, r) {
    const unit = v => { const l = hypot(...v) || 1; return v.map(x => x / l); };
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const n = unit(normal), u = unit(cr(abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n)), w = cr(n, u), p0 = project(center);
    const d = v => { const p = project(center.map((c, i) => c + v[i] * r)); return [p[0] - p0[0], p[1] - p0[1]]; };
    const a = d(u), b = d(w), A = d(n), LA = hypot(...A);
    const P = a[0] ** 2 + b[0] ** 2, Q = a[0] * a[1] + b[0] * b[1], S = a[1] ** 2 + b[1] ** 2, m = (P + S) / 2, q = hypot((P - S) / 2, Q);
    return { center: [p0[0], p0[1]], rx: sqrt(m + q), ry: sqrt(max(0, m - q)), angle: 0.5 * Math.atan2(2 * Q, P - S), axis: LA > 1e-9 ? [A[0] / LA, A[1] / LA] : [1, 0], along: LA };
  }

  // ---------- color ramps, cool to hot, for dark (d) and light (l) pages ----------
  const FIRE = { d: [[.7, .12, .02], [1, .38, .04], [1, .68, .2], [1, .93, .72]], l: [[.8, .2, .06], [.96, .4, .06], [1, .64, .12], [1, .86, .42]] };
  const BLUE = { d: [[.12, .16, .6], [.2, .36, 1], [.45, .66, 1], [.82, .9, 1]], l: [[.3, .32, .8], [.22, .4, .95], [.4, .6, 1], [.72, .84, 1]] };
  // Exhaust by propellant: kerosene burns sooty orange, methane blue, hydrogen nearly clear.
  const FUELS = {
    kerosene: { body: 1, d: [[.75, .18, .04], [1, .45, .08], [1, .75, .3], [1, .95, .82]], l: [[.8, .2, .06], [.95, .4, .06], [1, .62, .08], [1, .82, .2]] },
    methane: { body: .7, d: [[.35, .2, .75], [.3, .45, 1], [.6, .76, 1], [.92, .95, 1]], l: [[.45, .28, .82], [.3, .42, .95], [.5, .64, 1], [.8, .86, 1]] },
    hydrogen: { body: .25, d: [[.55, .3, .75], [.75, .5, .9], [1, .75, .85], [1, .96, .95]], l: [[.62, .3, .78], [.82, .42, .8], [1, .58, .7], [1, .82, .84]] },
  };
  const ramp = (st, x) => { x = clamp(x, 0, 1) * 3; const i = min(floor(x), 2); return [0, 1, 2].map(k => lerp(st[i][k], st[i + 1][k], x - i)); };
  const css = (c, a = 1) => `rgba(${c.map(v => Math.round(v * 255)).join(", ")}, ${clamp(a, 0, 1).toFixed(3)})`;
  const hue = c => { const m = max(...c, 1); return c.map(v => v / m); };
  const W1 = [1, 1, 1], mixc = (a, b, t) => a.map((v, i) => lerp(v, b[i], clamp(t, 0, 1)));

  // ---------- colormaps for fields: 16 even stops, read by the shaders and the 2D versions ----------
  const hexc = s => { s = String(s).trim(); if (/^#[0-9a-f]{3}$/i.test(s)) s = "#" + [...s.slice(1)].map(c => c + c).join(""); return /^#[0-9a-f]{6}$/i.test(s) ? [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255) : null; };
  const CMAPS = {};
  function defineColormap(name, stops) {
    const where = `Fx.colormap.define(${JSON.stringify(name)}, stops)`;
    if (typeof name !== "string" || !/^[a-z][\w-]*$/i.test(name)) throw new Error(`${where}: name it with a word, such as "ocean"`);
    if (!Array.isArray(stops) || stops.length < 2 || stops.length > 64) throw new Error(`${where}: give 2 to 64 stops, low to high`);
    const placed = stops.every(s => Array.isArray(s) && s.length === 2 && typeof s[0] === "number"), list = placed ? stops.map(s => s[1]) : stops;
    const big = list.some(c => Array.isArray(c) && c.some(v => v > 1));
    const cols = list.map((c, i) => {
      const v = typeof c === "string" ? hexc(c) : Array.isArray(c) && c.length === 3 && c.every(x => typeof x === "number" && x >= 0 && x <= 255) ? c.map(x => (big ? x / 255 : x)) : null;
      if (!v) throw new Error(`${where}: stop ${i} is ${JSON.stringify(c)}; use "#rrggbb" or [r, g, b] (all 0-1 or all 0-255)`);
      return v;
    });
    const ts = placed ? stops.map(s => s[0]) : cols.map((_, i) => i / (cols.length - 1));
    if (placed && (ts[0] !== 0 || ts[ts.length - 1] !== 1 || ts.some((t, i) => i && t <= ts[i - 1]))) throw new Error(`${where}: [position, color] stops must rise from 0 to 1`);
    CMAPS[name] = Array.from({ length: 16 }, (_, k) => { const t = k / 15; let i = 0; while (i < ts.length - 2 && t > ts[i + 1]) i++; return mixc(cols[i], cols[i + 1], (t - ts[i]) / (ts[i + 1] - ts[i])); });
    return name;
  }
  defineColormap("magma", ["#000004", "#1c1044", "#4f127b", "#812581", "#b5367a", "#e55064", "#fb8761", "#fec287", "#fcfdbf"]);
  defineColormap("viridis", ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21918c", "#28ae80", "#5ec962", "#addc30", "#fde725"]);
  defineColormap("coolwarm", [[59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249], [221, 221, 221], [245, 196, 173], [244, 154, 123], [222, 96, 77], [180, 4, 38]]);
  const cmapStops = name => CMAPS[name] ?? CMAPS.magma;
  const cmap = (name, t) => { const s = cmapStops(name); t = clamp(num(t, 0), 0, 1) * 15; const i = min(floor(t), 14); return mixc(s[i], s[i + 1], t - i); };

  // ---------- what particles are made of (the same SI numbers as E3.particles) ----------
  // vt: terminal speed falling in still air (m/s); rise: bubbles; drag (1/s) for gases, which get
  // lift g (T - Ta) / T at their birth temperature; eddy: [speed m/s, size m, change rate] of the
  // air's swirl; size [start, end] m; pile: settles and stays, building a heap at its angle of
  // repose (degrees); splash: drops that break into droplets when they hit.
  const MATTER = {
    smoke: { gas: true, style: "puff", temperature: [600, 300], drag: 1.6, eddy: [0.9, 0.8, 0.35], life: [5, 9], size: [0.3, 2.4], opacity: 0.3, bounce: 0, friction: 0.05 },
    exhaust: { gas: true, style: "puff", temperature: [1100, 320], drag: 0.9, eddy: [2.2, 3, 0.25], life: [6, 12], size: [1, 8], opacity: 0.26, bounce: 0, friction: 0.05 },
    steam: { gas: true, style: "puff", temperature: [373, 295], drag: 2.5, eddy: [0.4, 0.3, 0.5], life: [1.5, 3.5], size: [0.04, 0.5], opacity: 0.35, color: "#f3f5f7", fade: [0.12, 0.65], bounce: 0, friction: 0.05 },
    fire: { gas: true, style: "glow", temperature: [1300, 700], drag: 3.5, eddy: [1, 0.15, 1.4], life: [0.4, 0.9], size: [0.08, 0.3], opacity: 0.55, bounce: 0, friction: 0.05 },
    dust: { vt: 0.3, style: "mote", eddy: [0.6, 0.6, 0.3], life: [3, 7], size: [0.004, 0.004], opacity: 0.85, color: "#a8916f", bounce: 0, friction: 1, pile: 40 },
    mist: { vt: 0.25, style: "puff", eddy: [0.4, 0.5, 0.4], life: [1.5, 3], size: [0.05, 0.4], opacity: 0.18, color: "#eef4f8", fade: [0.1, 0.6], bounce: 0, friction: 1 },
    sand: { vt: 2.5, style: "dot", eddy: [0.2, 0.3, 0.3], life: [1.2, 2.5], size: [0.006, 0.006], opacity: 1, color: "#c4a26a", bounce: 0.15, friction: 0.85, pile: 34 },
    water: { vt: 5.5, style: "streak", eddy: [0.05, 0.3, 0.3], life: [0.8, 2], size: [0.012, 0.012], opacity: 0.9, color: "#d4e9f7", bounce: 0.1, friction: 0.6, splash: true },
    rain: { vt: 8.5, style: "streak", life: [1.5, 3], size: [0.006, 0.006], opacity: 0.8, color: "#bcd3e6", bounce: 0.02, friction: 0.95, splash: true },
    snow: { vt: 1, style: "dot", eddy: [0.8, 0.6, 0.5], life: [4, 8], size: [0.012, 0.012], opacity: 1, color: "#ffffff", bounce: 0, friction: 1 },
    spark: { vt: 7, style: "spark", temperature: [2100, 900], life: [0.5, 1.4], size: [0.01, 0.006], opacity: 1, bounce: 0.35, friction: 0.25 },
    ember: { vt: 1.5, lift: 1.8, style: "spark", temperature: [1250, 750], eddy: [0.5, 0.3, 0.6], life: [1.5, 3.5], size: [0.012, 0.008], opacity: 1, bounce: 0.2, friction: 0.6 },
    bubble: { rise: 0.25, style: "bubble", eddy: [0.06, 0.02, 1], life: [2, 5], size: [0.004, 0.005], opacity: 0.9, color: "#dff1fb", bounce: 0, friction: 0 },
    air: { drag: 20, style: "streak", eddy: [0.3, 1, 0.3], life: [1, 2], size: [0.004, 0.004], opacity: 0.8, color: "#9fc3dd", bounce: 0.5, friction: 0 },
    pollen: { vt: 0.03, style: "mote", eddy: [0.3, 0.5, 0.3], life: [6, 12], size: [0.003, 0.003], opacity: 0.9, color: "#e2bd3c", bounce: 0, friction: 1 },
    "grass-seed": { vt: 1.2, style: "dot", eddy: [0.4, 0.5, 0.4], life: [3, 6], size: [0.01, 0.01], opacity: 1, color: "#b39a5c", bounce: 0.1, friction: 0.9 },
    leaf: { vt: 1, style: "leaf", flutter: [1.4, 0.5], eddy: [0.6, 1, 0.3], life: [6, 10], size: [0.05, 0.05], opacity: 1, color: "#8f9b3a", bounce: 0, friction: 1 },
  };
  const STYLES = ["puff", "glow", "mote", "dot", "streak", "spark", "bubble", "leaf"], SALIAS = { smoke: "puff", fire: "glow", sphere: "bubble" };
  const pair = (v, ok) => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === "number" && Number.isFinite(x)) && ok(v);
  const MCHECK = {
    base: [v => !!MATTER[v], "the name of a matter to start from"], like: [v => !!MATTER[v], "the name of a matter to start from"], vt: [v => v > 0, "terminal speed in still air, m/s, above 0"], rise: [v => v > 0, "rise speed, m/s, above 0"],
    drag: [v => v >= 0, "drag rate, 1/s, 0 or more"], gas: [v => typeof v === "boolean", "true or false"], lift: [v => typeof v === "number", "a lift, m/s² over g"],
    temperature: [v => pair(v, ([a, b]) => a > 0 && b > 0), "[at birth, at death] in kelvin"], eddy: [v => Array.isArray(v) && v.length === 3 && v.every(x => x >= 0), "[speed m/s, size m, change rate 1/s]"],
    life: [v => pair(v, ([a, b]) => a > 0 && b >= a), "[shortest, longest] in seconds"], size: [v => pair(v, ([a, b]) => a >= 0 && b >= 0), "[at birth, at death] in m"],
    opacity: [v => v >= 0 && v <= 1, "0 to 1"], bounce: [v => v >= 0 && v <= 1, "0 to 1"], friction: [v => v >= 0 && v <= 1, "0 to 1"], fade: [v => pair(v, ([a, b]) => a >= 0 && b <= 1), "[fade in, fade out] as shares of life"],
    color: [v => typeof v === "string", "a CSS color or a palette name"], style: [v => STYLES.includes(v) || !!SALIAS[v], STYLES.join(", ")], pile: [v => v > 0 && v < 90, "the angle of repose in degrees"],
    splash: [v => typeof v === "boolean", "true or false"], flutter: [v => pair(v, ([a, b]) => a >= 0 && b >= 0), "[sway Hz, sway m/s]"],
  };
  function defineMatter(name, o) {
    const where = `Fx.matter.define(${JSON.stringify(name)}, …)`;
    if (typeof name !== "string" || !/^[a-z][\w-]*$/i.test(name)) throw new Error(`${where}: name it with a word, such as "ash"`);
    if (!o || typeof o !== "object") throw new Error(`${where}: give the numbers as an object, such as { vt: 0.5, style: "dot" }`);
    for (const [k, v] of Object.entries(o)) {
      if (!MCHECK[k]) throw new Error(`${where}: unknown key "${k}"; use ${Object.keys(MCHECK).join(", ")}`);
      if (!MCHECK[k][0](v)) throw new Error(`${where}: ${k} is ${JSON.stringify(v)}; it should be ${MCHECK[k][1]}`);
    }
    const from = o.base ?? o.like, m = { ...(from ? MATTER[from] : { style: "dot", life: [2, 4], size: [0.01, 0.01], opacity: 1, bounce: 0.2, friction: 0.5 }), ...o };
    delete m.like; delete m.base;
    if (SALIAS[m.style]) m.style = SALIAS[m.style];
    if (o.vt != null || o.rise != null || o.drag != null) for (const k of ["vt", "rise", "drag"]) if (o[k] == null) delete m[k];
    if (m.vt == null && m.rise == null && m.drag == null) throw new Error(`${where}: say how it moves: vt (m/s, things that fall), rise (m/s, bubbles), or drag (1/s, gases and tracers)`);
    MATTER[name] = m;
    return name;
  }

  // ---------- parameters: options resolved against the box ----------
  const common = o => ({ t: num(o.t, 0), seed: num(o.seed, 1) | 0 }), bp = (b, x, y) => [b[0] + b[2] * x, b[1] + b[3] * y];
  // A source oscillates from its start time on; with dur it rings for about dur seconds and dies
  // away, sending out a packet of rings (a dropped pebble) instead of a steady train.
  const sources = (list, b) => (list?.length ? list : [bp(b, 0.5, 0.5)]).slice(0, 8).map(s =>
    Array.isArray(s) ? { x: s[0], y: s[1], phase: 0, amp: 1, start: -1e6, dur: 1e9 } : { x: s.at[0], y: s.at[1], phase: num(s.phase, 0), amp: num(s.amp, 1), start: num(s.start, -1e6), dur: max(0.05, num(s.dur, 1e9)) });
  function water(b, o, lam, c) {
    const f = o.frame, X = f?.x ?? [1, 0], Y = f?.y ?? [0, 1], org = f?.origin ?? [0, 0], det = X[0] * Y[1] - Y[0] * X[1] || 1;
    return { k: TAU / lam, om: TAU * c / lam, c, damp: max(0, num(o.damping, 0)), A: 0.04 * lam * num(o.amp, 1), src: sources(o.sources, b),
      inv: [Y[1] / det, -X[1] / det, -Y[0] / det, X[0] / det], org: [org[0] - b[0], org[1] - b[1]], box: b, waves: [] };
  }
  const DEF = {
    fire: (b, o) => {
      const power = cn(o.power, 0.7, 0, 1);   // flame height grows as heat release to the 2/5 power
      return { ...common(o), base: o.base ?? bp(b, 0.5, 0.99), width: num(o.width, min(b[2] * 0.42, b[3] * 0.45)),
        height: num(o.height, b[3] * 0.9) * power ** 0.4, power, wind: cn(o.wind, 0, -1, 1), soot: cn(o.soot, 1, 0, 1), size: cn(o.size, 0.3, 0.005, 50),
        embers: cn(o.embers, 0, 0, 1), smoke: cn(o.smoke, 0, 0, 1) };
    },
    plume: (b, o) => {
      const thr = cn(o.throttle, 0.8, 0, 1), amb = cn(o.ambient, 1, 0, 1), a = num(o.angle, PI / 2), r = num(o.width, min(b[2], b[3]) * 0.16) / 2;
      const F = o.nozzle ? frame(o.nozzle, o.axis, o.along) : frame({ center: o.at ?? [b[0] + b[2] / 2, b[1] + r * 0.5], rx: r, ry: 0, angle: a + PI / 2 }, [cos(a), sin(a)], r);
      // Shock cells repeat every 1.3 D sqrt(M² - 1); thin air stretches them and balloons the plume.
      const M = 1.4 + 1.2 * thr;
      return { ...common(o), F, throttle: thr, ambient: amb, fuel: FUELS[o.fuel] ? o.fuel : "kerosene", length: 6 + 16 * thr,
        spacing: 2.62 * sqrt(M * M - 1) * sqrt(1.2 / (amb + 0.2)), spread: 0.05 + 0.5 * (1 - amb) ** 2,
        diamonds: o.diamonds === false ? 0 : smooth(0.05, 0.5, amb) * (0.3 + 0.7 * thr) * smooth(0, 0.12, thr) };
    },
    smoke: (b, o) => {
      const steam = o.kind === "steam";
      // Light comes from o.light (canvas radians toward the light; upper left by default), and the
      // smoke shades itself: puffs are bright on the lit side and dark under their own density.
      const la = num(o.light, -2.16);
      return { ...common(o), steam, at: o.at ?? bp(b, 0.5, 0.995), width: num(o.width, b[2] * 0.1), rise: num(o.rise, 0.35) * b[3],
        wind: cn(o.wind, 0, -3, 3), density: cn(o.density, 0.7, 0, 1), spread: cn(o.spread, 0.12, 0, 1), fade: (steam ? 4 : 0.3) / b[3], H: b[3],
        light: [cos(la), sin(la)], shadow: cn(o.shadow, steam ? 0.45 : 1, 0, 2), billows: cn(o.billows, steam ? 0.6 : 1, 0, 1) };
    },
    // Dust thrown up from a ground line by a footstep or an impact (a burst) or by a jet blowing
    // down on it (a wall jet that spreads both ways and rolls up at its front).
    dust: (b, o) => {
      const ground = num(o.ground, b[1] + b[3] * 0.92), la = num(o.light, -2.16), scale = max(4, num(o.scale, b[3] * 0.24));
      const list = (o.sources?.length ? o.sources : [{ at: [b[0] + b[2] / 2, ground] }]).slice(0, 4).map(q => ({
        x: Array.isArray(q) ? q[0] : num(q.at?.[0], b[0] + b[2] / 2), kind: (q.kind ?? "burst") === "jet" ? 1 : 0,
        start: num(q.start, 0), strength: cn(q.strength, 1, 0, 3), angle: num(q.angle, 0) }));
      return { ...common(o), ground, scale, src: list, light: [cos(la), sin(la)], shadow: cn(o.shadow, 1, 0, 2), density: cn(o.density, 1, 0, 1.5),
        grains: cn(o.grains, 1, 0, 3), color: o.color ?? "brass", settle: max(0.3, num(o.settle, 2.6)) };
    },
    // A body of water: seen from above (a pool, its floor through the surface) or in section.
    water: (b, o) => {
      const view = o.view === "side" ? "side" : "top", scale = max(4, num(o.scale, 80)), s = num(o.seed, 1) | 0;
      const w = water(b, o, max(2, num(o.wavelength, 32)), num(o.speed, 48));
      if (!o.sources) w.src = [];
      const G = (TAU / 1.6) ** 2 * scale / TAU, n = o.calm ? 0 : 6, waves1 = [];
      for (let j = 0; j < n; j++) {
        const k = TAU / (scale * (0.55 + 0.9 * rnd(s, j, 1))), th = num(o.wind, 0.6) + (j + 0.7 * rnd(s, j, 2)) * PI / n;
        w.waves.push({ kx: k * cos(th), ky: k * sin(th), om: sqrt(G * k), ph: TAU * rnd(s, j, 3), A: 0.09 * num(o.amp, 1) / k });
      }
      // In section the waves run along the surface: amplitude in px, deep-water dispersion.
      for (let j = 0; j < 5; j++) {
        const k = TAU / (scale * (0.45 + 1.1 * rnd(s, j, 7))) * (rnd(s, j, 8) < 0.5 ? 1 : -1);
        waves1.push({ k, om: sqrt(G * abs(k)) * Math.sign(k), ph: TAU * rnd(s, j, 9), A: num(o.amp, 1) * 0.11 * scale / (1 + j * 0.6) * (0.6 + 0.8 * rnd(s, j, 10)) / TAU * 2.2 });
      }
      return { ...common(o), ...w, view, scale, waves1, depth: max(0, num(o.depth, view === "top" ? scale * 2 : b[3] * 0.6)),
        level: num(o.level, b[1] + b[3] * 0.28), bottom: num(o.bottom, b[1] + b[3] * 0.97), clarity: max(1, num(o.clarity, view === "top" ? scale * 3 : b[3] * 0.55)),
        floor: ["tiles", "sand", "plain"].includes(o.floor) ? o.floor : view === "top" ? "tiles" : "sand", tile: max(4, num(o.tile, scale * 0.55)),
        tilt: cn(o.tilt, 0.35, 0, 1.3), foam: cn(o.foam, view === "top" ? 0 : 0.6, 0, 1), color: o.color ?? "blue", n: cn(o.n, 1.333, 1, 2.5), specks: o.specks !== false };
    },
    // Wind past bodies: uniform flow, each round body a doublet with optional circulation, and a
    // street of vortices it sheds, convected downstream. Streaks are particles followed for trail s.
    wind: (b, o) => {
      const a = num(o.angle, 0), U = max(1, num(o.speed, b[2] * 0.22));
      const bodies = (o.bodies ?? []).slice(0, 4).map(q => ({ c: q.at ?? [q[0], q[1]], r: max(1, num(q.r ?? q[2], 20)), spin: cn(q.spin, 0, -2, 2), shed: q.shed !== false }));
      return { ...common(o), box: b, U, dir: [cos(a), sin(a)], bodies, density: cn(o.density, 1, 0, 4), trail: cn(o.trail, 0.8, 0.05, 3),
        width: num(o.width, 1.1), turbulence: cn(o.turbulence, 0.25, 0, 2), color: o.color ?? "blue", colorBy: o.colorBy === "none" ? "none" : "speed",
        spacing: max(3, num(o.spacing, 10)), shedding: cn(o.shedding, 1, 0, 2), dye: o.dye !== false, dyeColor: o.dyeColor ?? null };
    },
    glow: (b, o) => {
      const T = num(o.temp, 2700);
      return { ...common(o), T, intensity: cn(o.intensity, glowLevel(T), 0, 2), at: o.path ? null : o.at ?? bp(b, 0.5, 0.5), r: num(o.r, 6),
        path: o.path ?? null, close: !!o.close, width: num(o.width, 2.5), spread: max(1, num(o.spread, 22)), core: o.core !== false };
    },
    ripples: (b, o) => ({ ...common(o), ...water(b, o, max(2, num(o.wavelength, 32)), num(o.speed, 48)), style: o.style === "height" ? 1 : 0,
      color: o.color ?? "blue", low: o.low ?? "blue", high: o.high ?? "red" }),
    caustics: (b, o) => {
      const scale = max(4, num(o.scale, 80)), w = water(b, o, max(2, num(o.wavelength, 32)), num(o.speed, 48)), s = num(o.seed, 1) | 0;
      if (!o.sources) w.src = [];
      // Wind waves from all round, with deep-water dispersion (long waves run faster).
      const G = (TAU / 1.6) ** 2 * scale / TAU, n = o.calm ? 0 : 6;
      for (let j = 0; j < n; j++) {
        const k = TAU / (scale * (0.55 + 0.9 * rnd(s, j, 1))), th = num(o.wind, 0.6) + (j + 0.7 * rnd(s, j, 2)) * PI / n;
        w.waves.push({ kx: k * cos(th), ky: k * sin(th), om: sqrt(G * k), ph: TAU * rnd(s, j, 3), A: 0.09 * num(o.amp, 1) / k });
      }
      return { ...common(o), ...w, depth: max(0, num(o.depth, scale * 2)), color: o.color ?? "blue" };
    },
    sparks: (b, o) => {
      const life = cn(o.life, 1.1, 0.05, 10);
      return { ...common(o), at: o.at ?? bp(b, 0.5, 0.85), angle: num(o.angle, -PI / 2), spread: num(o.spread, 0.55), speed: num(o.speed, b[3] * 1.5),
        rate: min(cn(o.rate, 50, 0, 2000), 1500 / life), life, gravity: num(o.gravity, b[3] * 2.2), drag: max(0, num(o.drag, 1.2)), temp: num(o.temp, 2000),
        width: num(o.width, 1.5), trail: cn(o.trail, 1 / 30, 0, 0.5) };
    },
    arc: (b, o) => ({ ...common(o), from: o.from ?? bp(b, 0.12, 0.5), to: o.to ?? bp(b, 0.88, 0.5),
      jitter: cn(o.jitter, 0.16, 0, 1), rate: max(0, num(o.rate, 7)), branches: cn(o.branches, 2, 0, 4) | 0, width: num(o.width, 1.6),
      spread: max(1, num(o.spread, 14)), intensity: cn(o.intensity, 1, 0, 2) }),
    shimmer: (b, o) => ({ ...common(o), strength: cn(o.strength, 2.5, 0, 40), scale: max(2, num(o.scale, 16)), rise: num(o.rise, 40) }),
    flow: (b, o) => {
      const inlet = o.inlet ?? { center: bp(b, 0.3, 0.45), rx: b[3] * 0.06, ry: b[3] * 0.2 }, nz = o.nozzle;
      const F = frame(inlet, o.axis ?? (nz ? [nz.center[0] - inlet.center[0], nz.center[1] - inlet.center[1]] : null), o.along);
      const sN = nz ? ((nz.center[0] - F.C[0]) * F.A[0] + (nz.center[1] - F.C[1]) * F.A[1]) / (F.A[0] ** 2 + F.A[1] ** 2 || 1) : 4;
      return { ...common(o), F, sN, throttle: cn(o.throttle, 0.7, 0, 1), temperature: num(o.temperature, 900), speed: cn(o.speed, 0.1, 0, 1),
        rN: nz ? max(abs(nz.rx), abs(nz.ry)) / F.R : 0.75, ground: num(o.ground, null), density: cn(o.density, 1, 0, 4), trail: cn(o.trail, 0.45, 0.05, 1),
        width: num(o.width, 1.1), intake: o.intake !== false, exhaust: o.exhaust !== false && sN > 0 };
    },
  };
  const params = (name, box, o = {}) => DEF[name](box, o);

  // ---------- models (shared by shaders, 2D, tests) ----------
  // Water at p: [h, h_x, h_y, h_xx, h_xy, h_yy]. Rings from each source fall as 1/sqrt(r) (their
  // energy spreads round a growing circle); a source with a start time sends out a front.
  function surf(p, w, t) {
    const o = [0, 0, 0, 0, 0, 0];
    for (const s of w.src) {
      const dx = p[0] - s.x, dy = p[1] - s.y, r = max(hypot(dx, dy), 1e-3), ex = dx / r, ey = dy / r;
      const f = s.amp * w.A / sqrt(1 + r * w.k / TAU) * exp(-w.damp * r) * (1 - smooth(-TAU / w.k, 0, r - w.c * (t - s.start))) * exp(-max(0, t - s.start - r / w.c) / s.dur);
      const ph = w.k * r - w.om * t + s.phase, C = cos(ph), u1 = -f * w.k * sin(ph), u2 = -f * w.k * w.k * C, q = u1 / max(r, 0.3 / w.k);
      o[0] += f * C; o[1] += u1 * ex; o[2] += u1 * ey;
      o[3] += u2 * ex * ex + q * (1 - ex * ex); o[4] += (u2 - q) * ex * ey; o[5] += u2 * ey * ey + q * (1 - ey * ey);
    }
    for (const v of w.waves) {
      const ph = v.kx * p[0] + v.ky * p[1] - v.om * t + v.ph, C = v.A * cos(ph), S = v.A * sin(ph);
      o[0] += S; o[1] += C * v.kx; o[2] += C * v.ky; o[3] -= S * v.kx * v.kx; o[4] -= S * v.kx * v.ky; o[5] -= S * v.ky * v.ky;
    }
    return o;
  }
  // Floor light, 1 = flat water: refraction moves light from q to q + D grad h(q), D = (1 - 1/n)
  // depth, so a beam's area scales by det(I + D H) and its brightness by the inverse.
  function focus(p, w, t, depth) {
    const D = depth * (1 - 1 / 1.33), a = surf(p, w, t), b = surf([p[0] - D * a[1], p[1] - D * a[2]], w, t);
    return 1 / max(abs((1 + D * b[3]) * (1 + D * b[5]) - D * D * b[4] * b[4]), 0.12);
  }
  const toSurface = (w, q) => { const x = q[0] - w.box[0] - w.org[0], y = q[1] - w.box[1] - w.org[1]; return [w.inv[0] * x + w.inv[2] * y, w.inv[1] * x + w.inv[3] * y]; };

  // Spark k is born at k / rate with seeded speed, angle, and life, flies under gravity and
  // linear drag (solved exactly), and cools.
  function sparks(p) {
    const out = [], c = p.drag, G = p.gravity;
    for (let k = Math.ceil((p.t - p.life) * p.rate); p.rate > 0 && k <= floor(p.t * p.rate); k++) {
      const age = p.t - k / p.rate, life = p.life * (0.5 + 0.5 * rnd(p.seed, k, 2));
      if (age < 0 || age > life) continue;
      const a = p.angle + (rnd(p.seed, k, 0) * 2 - 1) * p.spread, v = p.speed * (0.4 + 0.6 * rnd(p.seed, k, 1));
      const pos = s => {
        s = max(0, s);
        const f = c > 1e-6 ? (1 - exp(-c * s)) / c : s;
        return [p.at[0] + cos(a) * v * f, p.at[1] + sin(a) * v * f + (c > 1e-6 ? (G / c) * (s - f) : 0.5 * G * s * s)];
      };
      const T = p.temp * (1 - 0.55 * age / life);
      out.push({ k, p: pos(age), tail: pos(age - p.trail), T, age, life, level: glowLevel(T) * smooth(0, 0.04, age) });
    }
    return out;
  }

  // Embers: flecks lofted from a fire's base by its plume, wandering on the turbulence more the
  // higher they climb, and cooling from yellow to dull red before they go dark.
  function embers(p) {
    const rate = 16 * p.embers * (0.35 + p.power), out = [], hz = puff(p.size), q = p.seed + 3;
    for (let k = Math.ceil((p.t - 2.2) * rate); rate > 0 && k <= floor(p.t * rate); k++) {
      const age = p.t - k / rate, L = 2.2 * (0.45 + 0.55 * rnd(q, k, 2));
      if (age < 0 || age > L) continue;
      const x0 = p.base[0] + (rnd(q, k, 0) - 0.5) * p.width * 0.7, y0 = p.base[1] - p.height * (0.1 + 0.25 * rnd(q, k, 1));
      const up = p.height * (0.8 + 1.1 * rnd(q, k, 3)), drift = p.wind * p.width * 1.4;
      const pos = s => {
        s = clamp(s, 0, L);
        const f = (1 - exp(-1.5 * s)) / (1 - exp(-1.5 * L)), wob = p.width * 0.55 * f * noise1(k * 1.37 + s * hz * 0.7, q);
        return [x0 + drift * f + wob, y0 - up * f];
      };
      const T = 1700 * (1 - 0.5 * age / L), level = glowLevel(T) * smooth(0, 0.1, age) * (1 - smooth(0.75, 1, age / L));
      out.push({ k, p: pos(age), tail: pos(age - 0.02), T, age, life: L, level });
    }
    return out;
  }

  // Grains thrown out of a dust cloud: ballistic from a burst (a footstep, an impact) at its start
  // time, or a steady spray low along the ground from a jet. They land and stop.
  function grains(p) {
    const out = [], G = p.scale * 11;
    p.src.forEach((s, si) => {
      const throwOne = (k, age, a, v, x0, salt) => {
        const sy = sin(a), tl = sy < 0 ? (-2 * sy * v) / G : 0, pos = t => { t = min(t, tl); return [x0 + cos(a) * v * t, p.ground + sy * v * t + 0.5 * G * t * t]; };
        if (age > tl + 0.35) return;
        const r = rnd(p.seed + salt, k, 9);
        out.push({ p: pos(age), tail: pos(max(0, age - 0.025)), size: 0.7 + 1.3 * r, alpha: age > tl ? 1 - (age - tl) / 0.35 : 1, landed: age > tl });
      };
      if (s.kind === 0) {
        const age = p.t - s.start;
        if (age <= 0 || age > 3) return;
        const n = Math.round(46 * p.grains * s.strength);
        for (let k = 0; k < n; k++) {
          const r = j => rnd(p.seed + 11 + si * 97, k, j);
          throwOne(k, age, -PI / 2 + (r(0) - 0.5) * 2.5 + s.angle, p.scale * (1.4 + 3.4 * r(1)) * sqrt(s.strength), s.x + (r(2) - 0.5) * p.scale * 0.4, 11 + si * 97);
        }
      } else {
        const rate = 34 * p.grains * s.strength, life = 1.6;
        for (let k = Math.ceil((p.t - s.start - life) * rate); k <= floor((p.t - s.start) * rate); k++) {
          const age = p.t - s.start - k / rate;
          if (age < 0) continue;
          const r = j => rnd(p.seed + 23 + si * 97, k, j), side = r(0) < 0.5 ? -1 : 1, el = 0.12 + 0.5 * r(1);
          throwOne(k, age, side > 0 ? -el : PI + el, p.scale * (2 + 3.5 * r(2)) * sqrt(s.strength), s.x + side * p.scale * (0.15 + 0.4 * r(3)), 23 + si * 97);
        }
      }
    });
    return out;
  }

  // Wind past round bodies: a uniform stream, each body a doublet (potential flow round a
  // cylinder) with circulation from its spin, shedding a von Karman street of vortices of
  // alternating sign at a Strouhal number of 0.2, which drift downstream at 0.85 U and spread.
  // Time runs on a fixed grid of WH seconds, so the street at step i is the same however the
  // figure got there, and particle paths can be cached between frames without changing them.
  const WH = 1 / 30;
  function windField(p) {
    const U = p.U, d = p.dir, memo = new Map();
    const street = i => {
      let v = memo.get(i);
      if (v) return v;
      const t = i * WH;
      v = [];
      for (const B of p.bodies) {
        if (!B.shed || !p.shedding) continue;
        const D = 2 * B.r, f = (0.2 * U) / D, Gm = 3.2 * U * B.r * p.shedding, reach = max(p.box[2], p.box[3]) * 1.5, t0 = floor(t * 2 * f);
        for (let k = t0; k > t0 - 14; k--) {
          const age = t - k / (2 * f), sg = k & 1 ? 1 : -1, along = B.r * 1.5 + 0.85 * U * age, side = sg * B.r * 0.45 * (1 + 0.2 * min(age * f, 4));
          if (age < 0 || along > reach) continue;
          v.push({ x: B.c[0] + d[0] * along - d[1] * side, y: B.c[1] + d[1] * along + d[0] * side,
            G: sg * Gm * min(1, age * f * 2.5) * exp(-age * f * 0.1), rc: B.r * (0.28 + 0.06 * age * f) });
        }
      }
      if (memo.size > 600) memo.clear();
      memo.set(i, v);
      return v;
    };
    const tu = p.turbulence * U * 0.12, ph = [0, 1, 2, 3].map(j => TAU * rnd(p.seed, 77, j));
    // Velocity at (x, y) at grid step i (fractional i is fine: the street uses its step).
    return (x, y, i) => {
      let u = U * d[0], v = U * d[1];
      for (const B of p.bodies) {
        const rx = x - B.c[0], ry = y - B.c[1], X = rx * d[0] + ry * d[1], Y = -rx * d[1] + ry * d[0], r2 = X * X + Y * Y, R2 = B.r * B.r;
        if (r2 < R2) return null;
        // u - iv = U (1 - R²/z²) + iΓ/(2πz), the perturbation in the body's frame, turned back.
        // Real flow separates: behind the body the doublet weakens, so the stream doesn't close in.
        const r4 = r2 * r2, Gam = B.spin * 4 * PI * U * B.r, kd = X > 0 ? 1 - 0.6 * smooth(0, 1.4 * B.r, X) * exp(-(Y * Y) / (2.2 * R2)) : 1;
        const du = (-kd * U * R2 * (X * X - Y * Y)) / r4 + (Gam * Y) / (TAU * r2), dv = -((2 * kd * U * R2 * X * Y) / r4 + (Gam * X) / (TAU * r2));
        u += du * d[0] - dv * d[1]; v += du * d[1] + dv * d[0];
      }
      for (const w of street(floor(i))) { const dx = x - w.x, dy = y - w.y, q = w.G / (TAU * (dx * dx + dy * dy + w.rc * w.rc)); u -= dy * q; v += dx * q; }
      if (tu) { const t = i * WH; u += tu * sin(y * 0.031 + t * 1.3 + ph[0]) * cos(x * 0.017 - t * 0.7 + ph[1]); v += tu * sin(x * 0.027 - t * 1.1 + ph[2]) * cos(y * 0.021 + t * 0.9 + ph[3]); }
      return [u, v];
    };
  }
  // Streaks: particles released along the upstream edge at seeded steps, followed on the grid,
  // keeping the last trail seconds of path and speed. Each particle's state is cached between
  // frames (cleared when any setting changes, recomputed when time runs backward).
  const WIND = { key: "", parts: new Map() };
  function wind(p) {
    const F = windField(p), n = Math.ceil(p.trail / WH), b = p.box, d = p.dir, nm = [-d[1], d[0]], out = [];
    const key = JSON.stringify([b, p.U, p.dir, p.bodies, p.density, p.trail, p.turbulence, p.spacing, p.shedding, p.seed, p.dye]);
    if (WIND.key !== key) { WIND.key = key; WIND.parts.clear(); }
    const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2, half = hypot(b[2], b[3]) / 2, x0 = cx - d[0] * half, y0 = cy - d[1] * half;
    const lanes = Math.ceil((2 * half) / p.spacing), life = ((2 * half) / p.U) * 1.25, rate = p.density / (p.trail * 2.4), pad = 30;
    const inBox = (x, y) => x > b[0] - pad && x < b[0] + b[2] + pad && y > b[1] - pad && y < b[1] + b[3] + pad;
    const it = p.t / WH, iNow = floor(it), frac = it - iNow, seen = new Set();
    const rk = (x, y, i, h) => {
      const v1 = F(x, y, i);
      if (!v1) return null;
      const v2 = F(x + (v1[0] * h) / 2, y + (v1[1] * h) / 2, i) ?? v1;
      return [x + v2[0] * h, y + v2[1] * h, hypot(v2[0], v2[1]) / p.U];
    };
    for (let lane = 0; lane < lanes; lane++) {
      const off = (lane + 0.5) * p.spacing - half;
      for (let k = Math.ceil((p.t - life) * rate); k <= floor(p.t * rate); k++) {
        const u = j => rnd(p.seed + 17, lane * 7919 + k, j), b0 = Math.round((k + 0.85 * u(0)) / rate / WH);
        if (b0 > iNow || (iNow - b0) * WH > life) continue;
        const id = lane * 1e6 + k;
        let e = WIND.parts.get(id);
        if (!e || e.i > iNow) {
          const o2 = off + (u(1) - 0.5) * p.spacing * 0.7, x = x0 + nm[0] * o2, y = y0 + nm[1] * o2;
          e = { i: b0, x, y, pts: [[x, y]], sp: [1], idx: [b0], entered: inBox(x, y), done: false };
          WIND.parts.set(id, e);
        }
        seen.add(id);
        while (e.i < iNow && !e.done) {
          const q = rk(e.x, e.y, e.i, WH);
          e.i++;
          if (!q) { e.done = true; break; }
          [e.x, e.y] = q;
          e.pts.push([q[0], q[1]]); e.sp.push(q[2]); e.idx.push(e.i);
          const inside = inBox(q[0], q[1]);
          if (inside) e.entered = true; else if (e.entered) e.done = true;   // it left the box: let its trail run out of view
          if (e.pts.length > n + 1) { e.pts.shift(); e.sp.shift(); e.idx.shift(); }
        }
        let pts = [], sp = [];
        for (let j = 0; j < e.pts.length; j++) if (e.idx[j] > iNow - n) { pts.push(e.pts[j]); sp.push(e.sp[j]); }
        if (!e.done && frac > 0) { const q = rk(e.x, e.y, iNow, frac * WH); if (q) { pts.push([q[0], q[1]]); sp.push(q[2]); } }
        if (pts.length < 2 || !e.entered) continue;
        out.push({ points: pts, speed: sp, alpha: smooth(0, 0.3, (iNow - b0) * WH) });
      }
    }
    // Dye from each body's separation points (just behind its shoulders): it traces the wake.
    if (p.dye) p.bodies.forEach((B, bi) => {
      const rateD = 14 * p.density, lifeD = life * 0.8;
      for (const side of [-1, 1]) {
        const ang = Math.atan2(d[1], d[0]) + side * 1.62, sx = B.c[0] + Math.cos(ang) * B.r * 1.06, sy = B.c[1] + Math.sin(ang) * B.r * 1.06;
        for (let k = Math.ceil((p.t - lifeD) * rateD); k <= floor(p.t * rateD); k++) {
          const b0 = Math.round(k / rateD / WH);
          if (b0 > iNow || (iNow - b0) * WH > lifeD) continue;
          const id = -(bi * 2 + (side + 1) / 2 + 1) * 1e7 - k;
          let e = WIND.parts.get(id);
          if (!e || e.i > iNow) { e = { i: b0, x: sx, y: sy, pts: [[sx, sy]], sp: [1], idx: [b0], entered: true, done: false }; WIND.parts.set(id, e); }
          seen.add(id);
          while (e.i < iNow && !e.done) {
            const q = rk(e.x, e.y, e.i, WH);
            e.i++;
            if (!q) { e.done = true; break; }
            [e.x, e.y] = q;
            e.pts.push([q[0], q[1]]); e.sp.push(q[2]); e.idx.push(e.i);
            if (!inBox(q[0], q[1])) e.done = true;
            if (e.pts.length > 2 * n + 1) { e.pts.shift(); e.sp.shift(); e.idx.shift(); }
          }
          let pts = [], sp = [];
          for (let j = 0; j < e.pts.length; j++) if (e.idx[j] > iNow - 2 * n) { pts.push(e.pts[j]); sp.push(e.sp[j]); }
          if (!e.done && frac > 0) { const q = rk(e.x, e.y, iNow, frac * WH); if (q) { pts.push([q[0], q[1]]); sp.push(q[2]); } }
          if (pts.length >= 2) out.push({ points: pts, speed: sp, alpha: smooth(0, 0.3, (iNow - b0) * WH), dye: true });
        }
      }
    });
    for (const id of WIND.parts.keys()) if (!seen.has(id)) WIND.parts.delete(id);
    return out;
  }
  // Water in section: the surface height (px, up) and its first two derivatives along x.
  const surf1 = (x, p, t) => {
    let h = 0, d1 = 0, d2 = 0;
    for (const w of p.waves1) { const ph = w.k * x - w.om * t + w.ph, S = sin(ph), C = cos(ph); h += w.A * S; d1 += w.A * w.k * C; d2 -= w.A * w.k * w.k * S; }
    return [h, d1, d2];
  };

  // A midpoint-displaced path whose kinks drift in time, plus branches that strike and fade.
  function arc(p) {
    const n = 64, A = p.from, B = p.to, L = hypot(B[0] - A[0], B[1] - A[1]) || 1, nx = (A[1] - B[1]) / L, ny = (B[0] - A[0]) / L, off = new Float64Array(n + 1);
    for (let step = n / 2, lv = 0; step >= 1; step /= 2, lv++) {
      for (let i = step; i < n; i += 2 * step) {
        const wob = noise1(p.t * p.rate * (1 + lv * 0.35) + i * 1.7, p.seed + lv) + 0.35 * noise1(p.t * p.rate * 4 + i, p.seed + 17);
        off[i] = (off[i - step] + off[i + step]) / 2 + wob * p.jitter * L * 0.5 ** (lv * 0.85) * 0.5;
      }
    }
    const path = Array.from(off, (o, i) => [lerp(A[0], B[0], i / n) + nx * o, lerp(A[1], B[1], i / n) + ny * o]);
    const strike = floor(p.t * p.rate * 0.6), phase = p.t * p.rate * 0.6 - strike, branches = [];
    for (let j = 0; j < p.branches; j++) {
      const r = q => rnd(p.seed + 31, strike * 8 + j, q), i0 = 6 + floor(r(0) * (n - 12)), a = path[i0], b = path[i0 + 1], len = L * (0.08 + 0.14 * r(3)) / 8, pts = [a];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + (r(1) < 0.5 ? -1 : 1) * (0.35 + 0.5 * r(2));
      for (let i = 1; i <= 8; i++) { const q = pts[i - 1], t = ang + (r(4 + i) - 0.5) * 0.9; pts.push([q[0] + cos(t) * len, q[1] + sin(t) * len]); }
      branches.push({ path: pts, level: (1 - phase) * smooth(0, 0.08, phase) });
    }
    return { path, branches, level: p.intensity * (0.85 + 0.15 * noise1(p.t * p.rate * 3, p.seed + 5)) };
  }

  // Airflow in part coordinates (inlet radii): intake into a sink over the inlet face, a jet that
  // slows, spreads, and cools, and curl noise. Particles born at fixed times are integrated from
  // birth on a fixed step, so each trail is a function of t.
  const TA = 288, H = 1 / 40;
  function flow(p) {
    const thr = p.throttle, U = p.speed * 4, W = 2.5 * thr, Vj = 3 + 11 * thr, out = [], ph = [0, 1, 2, 3, 4, 5].map(j => TAU * rnd(p.seed, 99, j));
    // Curl noise (an ABC flow): swirls without sources or sinks.
    const curl = (x, t, k, a, o) => {
      const X = x[0] * k + ph[o] + t * 0.8, Y = x[1] * k + ph[o + 1] - t * 0.6, Z = x[2] * k + ph[o + 2] + t * 0.7;
      return [a * (sin(Z) + cos(Y)), a * (sin(X) + cos(Z)), a * (sin(Y) + cos(X))];
    };
    // Intake paths ignore the settings; throttle (swirl) and speed (narrower capture) bend them
    // afterward, so a change can't re-time whole histories.
    const intake = (x, t) => {
      const [s, y, z] = x, rho = hypot(y, z) + 1e-9, k = min(rho, 0.85) / rho, dy = y - y * k, dz = z - z * k, d = hypot(s, dy, dz) + 0.3, m = 12 / (d * d * d), c = curl(x, t, 0.8, 0.2, 0);
      return [c[0] - m * s, c[1] - m * dy, c[2] - m * dz];
    };
    const twist = q => { const e = min(q[0], 0), a = W * exp(e * 0.7), m = 1 - 0.45 * p.speed * (1 - exp(e * 0.5)), c = cos(a) * m, s = sin(a) * m; return [q[0], q[1] * c - q[2] * s, q[1] * s + q[2] * c]; };
    const jet = (x, t) => {
      const ds = max(x[0] - p.sN, 0), vs = Vj / (1 + ds / 4), e = 0.14 * vs / (p.rN + 0.14 * ds);
      const a = curl(x, t, 0.9, 0.22 * vs * smooth(0, 2, ds), 3), b = curl(x, t * 1.7, 2.1, 0.12 * vs * smooth(0, 1, ds), 0);
      return [vs + U + a[0] + b[0], x[1] * e + a[1] + b[1], x[2] * e + a[2] + b[2]];
    };
    const disk = (s0, r) => u => { const a = TAU * u(3), q = r * sqrt(u(2)); return [s0(u), q * cos(a), q * sin(a)]; };
    const n = Math.ceil(p.trail / H) + 1, dens = 0.25 + 0.75 * thr, streams = [];
    if (p.intake) streams.push({ id: 1, rate: 45, life: 3.2, vel: intake, end: x => x[0] > -0.03, fadeIn: 0.7, temp: () => TA - 8, map: twist,
      spawn: disk(u => -(1.8 + 2.4 * u(1)), 2.2) });
    if (p.exhaust) streams.push({ id: 2, rate: 70, life: 1.4, vel: jet, end: x => x[0] > p.sN + 18, fadeIn: 0.1, spawn: disk(() => p.sN + 0.02, p.rN * 0.95), map: q => q,
      temp: (x, u) => TA + ((u(2) < 0.6 ? p.temperature : TA + 50) - TA) * exp(-max(x[0] - p.sN, 0) / 12) });
    for (const st of streams) {
      const rate = st.rate * p.density;
      for (let k = Math.ceil((p.t - st.life - p.trail) * rate); k <= floor(p.t * rate); k++) {
        const born = k / rate, age = p.t - born, u = j => rnd(p.seed + st.id * 7919, k, j);
        if (age < 0 || u(0) > dens + 0.25) continue;
        let x = st.spawn(u), tt = born, end = -1;
        const pts = [x], steps = floor(age / H + 1e-9);
        for (let i = 0; i <= steps; i++) {
          const v1 = st.vel(x, tt), v2 = st.vel(x.map((c, j) => c + v1[j] * H / 2), tt + H / 2), nx = x.map((c, j) => c + v2[j] * H);
          if (i === steps) { pts.push(x.map((c, j) => lerp(c, nx[j], age / H - steps))); break; }
          x = nx; tt += H; pts.push(x);
          if (pts.length > n + 2) pts.shift();
          if (st.end(x) || tt - born > st.life) { end = tt; break; }
        }
        // One that has gone in keeps its trail until the tail catches up.
        const keep = end < 0 ? n + 1 : Math.ceil((end - (p.t - p.trail)) / H);
        if (keep < 2) continue;
        const local = pts.slice(-keep);
        out.push({ stream: st.id === 1 ? "intake" : "exhaust", points: local.map(q => onScreen(p.F, st.map(q))), T: local.map(q => st.temp(q, u)),
          alpha: clamp((dens + 0.25 - u(0)) / 0.25, 0, 1) * smooth(0, st.fadeIn, age) * (end < 0 ? 1 : clamp((end - p.t + p.trail) / p.trail, 0, 1)) });
      }
    }
    // The ground vortex: strongest at high power, low forward speed, an inlet near the ground.
    if (p.intake && p.ground != null) {
      const F = p.F, top = onScreen(F, [-0.3, 0, 0]), foot = [onScreen(F, [-1.2, 0, 0])[0], p.ground], life = 1.3;
      const str = thr * thr * (1 - p.speed) ** 2 * (1 - smooth(1, 2.4, (p.ground - F.C[1]) / (2 * F.R)));
      for (let k = Math.ceil((p.t - life) * 22); k <= floor(p.t * 22); k++) {
        const u = j => rnd(p.seed + 5, k, j), age = p.t - k / 22, pts = [];
        if (age < 0 || u(0) > str) continue;
        for (let j = n; j >= 0; j--) {
          const a = clamp((age - j * H) / life, 0, 1), rad = F.R * 0.5 * (1 - 0.8 * a) * (0.6 + 0.4 * u(1)), th = TAU * (u(2) + 2.5 * a);
          pts.push([lerp(foot[0], top[0], a * a) + rad * cos(th), lerp(foot[1], top[1], a) + rad * 0.4 * sin(th)]);
        }
        out.push({ stream: "ground", points: pts, T: pts.map(() => TA - 8), alpha: smooth(0, 0.15, age) * (1 - smooth(0.85, 1, age / life)) * clamp((str - u(0)) / 0.25, 0, 1) });
      }
    }
    return out;
  }

  // ---------- GPU: one shared WebGL2 context, programs compiled once ----------
  const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  // Shared: the pixel in box px, seeded gradient noise, ramps. Samplers are declared highp:
  // left at GLSL's lowp default, some drivers (Mesa on AMD, phones) read the float state of a
  // simulation back at 16 bits.
  const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform vec2 uSize; uniform float uK, uT; uniform uint uSeed; uniform vec3 uRamp[4];
out vec4 o;
vec2 px() { return vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uK; }
float sq(float x) { return x * x; }
uint hs(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
vec2 gr(ivec2 c) { uvec2 u = uvec2(c & 0x7fffffff); float a = float(hs(u.x * 0x9e3779b1u ^ hs(u.y + uSeed))) * 1.4629181e-9; return vec2(cos(a), sin(a)); }
float nz(vec2 p) {
  vec2 f = fract(p), u = f * f * (3.0 - 2.0 * f); ivec2 i = ivec2(floor(p)), e = ivec2(1, 0);
  return mix(mix(dot(gr(i), f), dot(gr(i + e), f - vec2(1, 0)), u.x), mix(dot(gr(i + e.yx), f - vec2(0, 1)), dot(gr(i + 1), f - 1.0), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * nz(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.1; a *= 0.5; } return s; }
vec3 rampOf(vec3 r[4], float x) { x = clamp(x, 0.0, 1.0) * 3.0; int i = min(int(x), 2); return mix(r[i], r[i + 1], x - float(i)); }
vec4 emit(vec3 c, float a) { a = clamp(a, 0.0, 1.0); return vec4(c * a, a); }
// 3D gradient noise in about [-0.7, 0.7]; the third axis is time, so a pattern evolves instead of sliding.
vec3 gr3(ivec3 c) {
  uvec3 u = uvec3(c & 0x7fffffff);
  uint h = hs(u.x * 0x9e3779b1u ^ hs(u.y * 0x85ebca6bu ^ hs(u.z + uSeed)));
  float a = float(h & 0xffffu) * 9.5873799e-5, z = float(h >> 16) * 3.0518044e-5 - 1.0, r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(a), r * sin(a), z);
}
float nz3(vec3 p) {
  ivec3 i = ivec3(floor(p)); vec3 f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float n000 = dot(gr3(i), f), n100 = dot(gr3(i + ivec3(1, 0, 0)), f - vec3(1, 0, 0));
  float n010 = dot(gr3(i + ivec3(0, 1, 0)), f - vec3(0, 1, 0)), n110 = dot(gr3(i + ivec3(1, 1, 0)), f - vec3(1, 1, 0));
  float n001 = dot(gr3(i + ivec3(0, 0, 1)), f - vec3(0, 0, 1)), n101 = dot(gr3(i + ivec3(1, 0, 1)), f - vec3(1, 0, 1));
  float n011 = dot(gr3(i + ivec3(0, 1, 1)), f - vec3(0, 1, 1)), n111 = dot(gr3(i + ivec3(1, 1, 1)), f - 1.0);
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
// Billows: folded noise, so puffs have rounded tops and creases between them, like cauliflower.
float billow(vec3 p, int oct) {
  float s = 0.0, a = 0.5, w = 0.0;
  for (int k = 0; k < 5; k++) { if (k >= oct) break; s += a * (1.0 - 1.5 * abs(nz3(p))); w += a; p = p * 2.07 + vec3(1.7, 9.2, 3.1); a *= 0.52; }
  return s / w;
}
// Black-body color at T kelvin, brightest channel 1 (the Planckian-locus fit Fx.blackbody uses).
vec3 bbc(float T) {
  float t = clamp(T, 800.0, 12000.0) / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp(1.29293618 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
  float g = t <= 66.0 ? clamp(0.39008157 * log(t) - 0.63184144, 0.0, 1.0) : clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
  float b = t >= 66.0 ? 1.0 : t <= 19.0 ? 0.0 : clamp(0.54320678 * log(t - 10.0) - 1.19625408, 0.0, 1.0);
  return vec3(r, g, b);
}
`;
  const SURF = `
uniform vec4 uSrc[8], uWv[6]; uniform float uStart[8], uDur[8], uWa[6]; uniform int uN, uNw; uniform float uKk, uOm, uCs, uDamp, uAmp; uniform mat2 uInv; uniform vec2 uOrg;
void surf(vec2 p, out vec3 a, out vec3 b) {
  a = vec3(0.0); b = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uN) break;
    vec2 d = p - uSrc[i].xy; float r = max(length(d), 1e-3); vec2 e = d / r;
    float f = uSrc[i].w * uAmp * inversesqrt(1.0 + r * uKk * 0.1591549) * exp(-uDamp * r) * (1.0 - smoothstep(-6.2831853 / uKk, 0.0, r - uCs * (uT - uStart[i]))) * exp(-max(0.0, uT - uStart[i] - r / uCs) / uDur[i]);
    float ph = uKk * r - uOm * uT + uSrc[i].z, c = cos(ph), u1 = -f * uKk * sin(ph), u2 = -f * uKk * uKk * c, q = u1 / max(r, 0.3 / uKk);
    a += vec3(f * c, u1 * e);
    b += vec3(u2 * e.x * e.x + q * (1.0 - e.x * e.x), (u2 - q) * e.x * e.y, u2 * e.y * e.y + q * (1.0 - e.y * e.y));
  }
  for (int j = 0; j < 6; j++) {
    if (j >= uNw) break;
    vec4 w = uWv[j]; float ph = dot(w.xy, p) - w.z * uT + w.w, s = uWa[j] * sin(ph);
    a += vec3(s, uWa[j] * cos(ph) * w.xy);
    b -= s * vec3(w.x * w.x, w.x * w.y, w.y * w.y);
  }
}
vec2 sp() { return uInv * (px() - uOrg); }
`;
  const FS = {
    // Layered flame. A temperature field from the flame's shape and its rising turbulence colors
    // the sooty part by black-body light (dull red at the edges to yellow-white in the core); the
    // premixed base burns blue (CH and C2 emission) in a thin cone. The flame puffs at its
    // flicker frequency and its tip breaks into licks.
    fire: `uniform vec2 uBase; uniform float uW, uH, uWind, uSoot, uPow, uHz, uDk; uniform vec3 uBlue[4];
void main() {
  vec2 p = px();
  float flick = 1.0 + 0.09 * sin(6.2831853 * uT * uHz) + 0.07 * nz(vec2(uT * uHz * 0.7, 3.1));
  float y = (uBase.y - p.y) / (uH * flick), x = (p.x - uBase.x) / uW - uWind * y * y * 0.9;
  o = vec4(0.0);
  if (y < -0.08 || y > 1.5) return;
  vec2 q = vec2(x * 2.2, y * 2.0 - uT * uHz * 1.25);
  vec2 w = vec2(fbm(q * 1.3 + vec2(0.0, -uT * uHz * 0.6)), fbm(q * 1.3 + vec2(4.1, -uT * uHz * 0.8)));
  float n = fbm(q + 0.55 * w);
  float wid = 0.5 * pow(clamp(1.0 - y * 0.85, 0.0, 1.0), 0.62) + 0.02;
  float d = abs(x + 0.42 * y * (w.x + 0.5 * n)) / wid;
  float body = (1.0 - d * d) * smoothstep(-0.04, 0.05, y);
  float f = (body + n * (0.25 + 0.9 * y) - smoothstep(0.55, 1.15, y + 0.35 * n) * 1.2) * (0.6 + 0.5 * uPow);
  if (f <= 0.0) return;
  float T = mix(950.0, 2000.0, clamp(f * 1.15, 0.0, 1.0)) * (1.0 - 0.12 * y) * (uDk > 0.5 ? 1.0 : 0.9);
  // Radiance climbs steeply with temperature; an exposure curve takes the core to yellow-white.
  vec3 lum = bbc(T) * pow(T / 1500.0, 4.0) * (0.45 + 0.8 * smoothstep(0.0, 0.9, f));
  float baseZ = 1.0 - smoothstep(0.03, 0.22, y), cone = exp(-sq(d - 0.72) * 10.0) * (1.0 - smoothstep(0.0, 0.38, y));
  vec3 blue = rampOf(uBlue, 0.55 + 0.45 * clamp(body, 0.0, 1.0)) * (0.65 * baseZ + 0.85 * cone + 0.35 * (1.0 - uSoot) * body);
  float soot = uSoot * smoothstep(0.02, 0.2, y);
  if (uDk < 0.5) lum = rampOf(uRamp, clamp((T - 950.0) / 1000.0, 0.0, 1.0)) * (0.9 + 0.1 * smoothstep(0.0, 0.9, f));
  vec3 c = mix(blue * 1.25, lum, soot) + blue * baseZ * 0.5 * soot;
  c = uDk > 0.5 ? 1.0 - exp(-c * 1.5) : clamp(c, 0.0, 1.0);
  o = emit(c, smoothstep(0.0, 0.22, f) * mix(0.78, 1.0, soot));
}`,
    // Ray-marched: the inverse of the drawing's projection gives each pixel's line of sight.
    plume: `uniform vec2 uC, uA, uE1, uE2; uniform float uThr, uL, uSp, uSpr, uBody, uDia, uInk;
void main() {
  vec2 d = px() - uC;
  vec3 r1 = vec3(uA.x, uE1.x, uE2.x), r2 = vec3(uA.y, uE1.y, uE2.y), v = normalize(cross(r1, r2));
  float a = dot(r1, r1), b = dot(r1, r2), c = dot(r2, r2);
  vec3 x0 = (r1 * (c * d.x - b * d.y) + r2 * (a * d.y - b * d.x)) / (a * c - b * b);
  float smax = 2.5 * uL, vr = dot(v.yz, v.yz), lo = -1e4, hi = 1e4;
  o = vec4(0.0);
  if (vr > 1e-5) x0 += v * (-dot(x0.yz, v.yz) / vr);
  // Clip the line of sight to the cone rho < 1.6 R(s), where the light is.
  float a0 = 1.0 + uSpr * x0.x, b0 = uSpr * v.x, A = vr - 2.56 * b0 * b0, B = -5.12 * a0 * b0, C = dot(x0.yz, x0.yz) - 2.56 * a0 * a0;
  if (A > 1e-6) { float D = B * B - 4.0 * A * C; if (D <= 0.0) return; D = sqrt(D); lo = (-B - D) / (2.0 * A); hi = (-B + D) / (2.0 * A); }
  if (abs(v.x) > 1e-5) { float s0 = -x0.x / v.x, s1 = (smax - x0.x) / v.x; lo = max(lo, min(s0, s1)); hi = min(hi, max(s0, s1)); }
  else if (x0.x < 0.0 || x0.x > smax) return;
  if (hi <= lo) return;
  float st = (hi - lo) / 24.0, body = 0.0, hot = 0.0, dia = 0.0;
  for (int i = 0; i < 24; i++) {
    vec3 x = x0 + (lo + (float(i) + 0.5) * st) * v;
    float s = x.x, rho = length(x.yz), R = 1.0 + s * uSpr, e = rho / R, cr = 0.9 * max(0.0, 1.0 - s / (0.75 * uSp));
    body += exp(-2.0 * e * e - s / uL) / (R * R);
    hot += cr > 0.0 ? 1.0 - smoothstep(cr * 0.3, cr * 1.2, rho) : 0.0;
    // Shock cells: a bright Mach disk in each, cone-shaped shocks between.
    float ph = s / uSp, cell = fract(ph), rs = cell < 0.62 ? 1.0 - 0.55 * cell / 0.62 : 0.45 + 0.55 * (cell - 0.62) / 0.38;
    dia += (2.6 * exp(-sq((cell - 0.62) * uSp / 0.35) - 4.0 * rho * rho) + 0.25 * exp(-sq((rho - rs * 0.95) / 0.1))) * exp(-0.45 * floor(ph));
  }
  float n = fbm(vec2(x0.x * 0.3 - uT * (3.0 + 6.0 * uThr), (x0.y + x0.z) * 0.9));
  body *= st * uBody * 0.45 * (1.0 + 0.9 * n * smoothstep(0.0, 6.0, x0.x)) * (0.4 + uThr);
  hot *= st * 0.35 * (0.3 + 0.7 * uThr); dia *= st * uDia * 1.3;
  float E = max(body, 0.0) + hot + dia;
  o = emit(rampOf(uRamp, (body * 0.4 + hot * 0.75 + dia) / max(E, 1e-4)), (1.0 - exp(-E * uInk)) * smoothstep(0.0, 0.12, uThr));
}`,
    // A rising column as a lit volume. Density is the plume's profile (wider and thinner with
    // height) times folded noise that billows: domain-warped by a swirl that grows as the column
    // rises, and evolving in time rather than sliding. Each pixel looks toward the light through
    // the column's own density, so puffs are bright on the lit side and dark under the rest.
    smoke: `uniform vec2 uSrc, uL; uniform float uR0, uRise, uDrift, uDen, uSpr, uFade, uH, uShadow, uBill; uniform vec3 uCol, uCol2;
float dens(vec2 p, int oct) {
  float z = uSrc.y - p.y, zp = max(z, 0.0), x = p.x - uSrc.x - uDrift * zp, b = uR0 + uSpr * zp, e = x / b;
  float prof = exp(-0.75 * e * e) * smoothstep(-uR0 * 0.5, uR0 * 0.8, z) * exp(-zp * uFade);
  if (prof < 0.01) return 0.0;
  // Billows grow with the column; the swirl that folds them grows as it rises.
  float sc = uR0 * 1.4 + 0.04 * uH + 0.26 * b;
  vec3 q = vec3(x / sc, (z - uT * uRise * 0.9) / sc, uT * 0.18);
  q.xy += vec2(nz3(q * 0.5 + vec3(0.0, 0.0, 3.1)), nz3(q * 0.5 + vec3(5.2, 1.3, 7.7))) * (0.6 + 1.4 * smoothstep(0.0, uH * 0.45, zp));
  float n = billow(q, oct);
  float c = prof * (0.35 + 0.95 * n) - 0.42;
  float puffs = smoothstep(0.0, 0.32, c) * (0.35 + 0.9 * n * n);
  return mix(prof * (0.6 + 0.6 * n), puffs, uBill) * pow(uR0 / b, 0.6) * 1.15;
}
void main() {
  vec2 p = px();
  float d = dens(p, 4);
  if (d < 0.003) { o = vec4(0.0); return; }

  // Shading: the density is treated as relief, so each billow has a face toward the light and
  // one away from it; the shadow is the density between the pixel and the light.
  float e1 = 4.0, dx = dens(p + vec2(e1, 0.0), 3) - dens(p - vec2(e1, 0.0), 3), dy = dens(p + vec2(0.0, e1), 3) - dens(p - vec2(0.0, e1), 3);
  vec3 nrm = normalize(vec3(-dx, -dy, 0.22));
  float face = clamp(dot(nrm, normalize(vec3(uL, 0.75))), 0.0, 1.0);
  float tau = dens(p + uL * 9.0, 2) + dens(p + uL * 22.0, 2);
  float lit = clamp((0.25 + 0.95 * face) * exp(-tau * uShadow * 0.55), 0.0, 1.0);
  float a = 1.0 - exp(-d * 2.6 * uDen);
  vec3 c = mix(uCol2, uCol, lit);
  o = vec4(c * a, a);
}`,
    // Dust raised from a ground line. A burst is a cloud that spreads fast, slows, piles up at its
    // rim (the rolling front), and settles; a jet feeds a layer that runs outward both ways,
    // thickening as it goes. Billows advect away from each source; light shades it like smoke.
    dust: `uniform vec4 uDs[4]; uniform int uNd; uniform float uGr, uSc, uSettle, uShadow, uDen; uniform vec2 uL; uniform vec3 uCol, uCol2;
float dens(vec2 p, int oct) {
  float h = uGr - p.y;
  if (h < -2.0) return 0.0;
  float d = 0.0, near = 1e9, dir = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uNd) break;
    vec4 s = uDs[i];
    float dx = p.x - s.x, age = uT - s.y;
    if (age <= 0.0) continue;
    if (abs(dx) < near) { near = abs(dx); dir = sign(dx); }
    if (s.w < 0.5) {
      float g = sqrt(s.z), R = uSc * (0.3 + 1.6 * (1.0 - exp(-age / 0.7))) * g, Hc = uSc * (0.3 + 0.9 * (1.0 - exp(-age / 1.4))) * g;
      float rim = exp(-sq((abs(dx) - R * 0.72) / (R * 0.3))) * exp(-max(h, 0.0) / (Hc * 1.25)), body = exp(-sq(dx / R)) * exp(-max(h, 0.0) / Hc);
      d += s.z * (0.6 * body + 0.85 * rim) * exp(-age / uSettle) * smoothstep(0.0, 0.06, age);
    } else {
      float ax = abs(dx), reach = uSc * 3.2 * s.z, th = uSc * (0.12 + 0.16 * ax / uSc);
      float front = exp(-sq((ax - reach * 0.85) / (uSc * 0.5))) * exp(-max(h, 0.0) / (uSc * 0.45));
      d += s.z * (0.8 * exp(-max(h, 0.0) / th) * exp(-ax / reach) + 0.6 * front) * smoothstep(0.0, 1.0, age * 2.0) * smoothstep(-uSc * 0.25, uSc * 0.3, ax);
    }
  }
  if (d < 0.01) return 0.0;
  vec3 q = vec3((p.x - dir * uT * uSc * 0.35) / uSc, (h - uT * uSc * 0.08) / uSc, uT * 0.15);
  q.xy += vec2(nz3(q * 0.45 + 2.0), nz3(q * 0.45 + vec3(5.2, 1.3, 7.7))) * 0.55;
  float n = billow(q, oct), c = min(d, 1.4) * (0.3 + 0.95 * n) - 0.32;
  return smoothstep(0.0, 0.4, c) * (0.4 + 0.8 * n * n) * 1.3 * smoothstep(-2.0, 2.0, h);
}
void main() {
  vec2 p = px();
  float d = dens(p, 4);
  if (d < 0.003) { o = vec4(0.0); return; }

  // Shading: the density is treated as relief, so each billow has a face toward the light and
  // one away from it; the shadow is the density between the pixel and the light.
  float e1 = 4.0, dx = dens(p + vec2(e1, 0.0), 3) - dens(p - vec2(e1, 0.0), 3), dy = dens(p + vec2(0.0, e1), 3) - dens(p - vec2(0.0, e1), 3);
  vec3 nrm = normalize(vec3(-dx, -dy, 0.22));
  float face = clamp(dot(nrm, normalize(vec3(uL, 0.75))), 0.0, 1.0);
  float tau = dens(p + uL * 9.0, 2) + dens(p + uL * 22.0, 2);
  float lit = clamp((0.25 + 0.95 * face) * exp(-tau * uShadow * 0.55), 0.0, 1.0);
  float a = (1.0 - exp(-d * 1.6 * uDen)) * 0.88;
  o = vec4(mix(uCol2, uCol, lit) * a, a);
}`,
    // Bloom: a core, a near exponential falloff, a far tail that ends smoothly.
    glow: `uniform vec4 uSeg[96]; uniform float uSegW[96]; uniform int uNs; uniform float uW, uSpr, uI, uCore; uniform vec3 uHue, uHalo;
void main() {
  vec2 p = px(); float d = 1e9;
  for (int i = 0; i < 96; i++) {
    if (i >= uNs) break;
    vec2 pa = p - uSeg[i].xy, ba = uSeg[i].zw - uSeg[i].xy;
    d = min(d, length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0)) + (1.0 - uSegW[i]) * uSpr * 1.5);
  }
  float core = (1.0 - smoothstep(uW - 0.7, uW + 0.7, d)) * uCore, x = max(d - uW, 0.0) / uSpr;
  float a = clamp(core + uI * (0.55 * exp(-2.5 * x) + 0.45 / (1.0 + 3.0 * x * x) * (1.0 - smoothstep(2.5, 6.0, x))), 0.0, 1.0);
  o = vec4(mix(uHalo, uHue, clamp(core, 0.0, 1.0)) * a, a);
}`,
    ripples: SURF + `uniform int uStyle; uniform vec3 uLo, uMid, uHi; uniform vec2 uSun;
void main() {
  vec3 a, b; surf(sp(), a, b);
  if (uStyle == 1) { float h = clamp(a.x / (uAmp * 1.5), -1.0, 1.0); o = vec4(mix(uMid, h > 0.0 ? uHi : uLo, abs(h)), 1.0); return; }
  float sh = dot(a.yz, uSun);
  o = vec4(mix(mix(uMid, sh > 0.0 ? uHi : uLo, clamp(abs(sh), 0.0, 1.0)), uHi, pow(clamp(sh * 1.4, 0.0, 1.0), 4.0) * 0.6), 1.0);
}`,
    caustics: SURF + `uniform float uD; uniform vec3 uFloor, uShadow, uLight;
void main() {
  vec2 p = sp(); vec3 a, b; surf(p, a, b); surf(p - uD * a.yz, a, b);
  float I = 1.0 / max(abs((1.0 + uD * b.x) * (1.0 + uD * b.z) - uD * uD * b.y * b.y), 0.12);
  o = vec4(min(mix(uShadow, uFloor, min(I, 1.0)) + uLight * max(I - 1.2, 0.0) * 0.22, vec3(1.0)), 1.0);
}`,
    // A pool seen from above. The floor is seen through the surface, shifted by refraction; it is
    // lit by the caustics the same surface focuses; red is absorbed first on the way down and
    // back, so depth turns it blue-green; the surface reflects the sky by Fresnel (more at a
    // grazing view, set by tilt) and the sun as glints; crests whiter than foam break.
    water: SURF + `uniform float uD, uDepth, uClar, uTile, uTilt, uFoam, uFloorK, uIor; uniform vec3 uWater, uFlA, uFlB, uSky, uSkyH; uniform vec3 uSunD;
vec3 floorAt(vec2 q) {
  if (uFloorK < 0.5) {
    vec2 g = fract(q / uTile), e = min(g, 1.0 - g) * uTile;
    float grout = 1.0 - smoothstep(0.5, 1.6, min(e.x, e.y));
    return mix(uFlA, uFlB, grout) * (0.95 + 0.05 * nz(q / uTile * 2.7));
  }
  if (uFloorK < 1.5) { float r = 0.5 + 0.5 * sin(q.x * 0.11 + 2.0 * fbm(q * 0.02)); return mix(uFlA, uFlB, 0.35 * r + 0.25 * fbm(q * 0.05)); }
  return uFlA;
}
void main() {
  vec2 p = sp(); vec3 a, b; surf(p, a, b);
  vec2 fp = p - uD * a.yz;
  vec3 a2, b2; surf(fp, a2, b2);
  float I = 1.0 / max(abs((1.0 + uD * b2.x) * (1.0 + uD * b2.z) - uD * uD * b2.y * b2.y), 0.12);
  vec3 fl = floorAt(fp) * (0.5 + 0.55 * min(I, 2.6));
  vec3 Tr = exp(-vec3(1.7, 0.55, 0.38) * (2.0 * uDepth) / uClar);
  vec3 under = fl * Tr + uWater * (1.0 - Tr);
  vec3 nrm = normalize(vec3(-a.y, -a.z, 1.0)), v = normalize(vec3(0.0, -sin(uTilt), cos(uTilt)));
  float c = max(dot(nrm, v), 0.0), F = 0.02 + 0.98 * pow(1.0 - c, 5.0);
  vec3 r = reflect(-v, nrm);
  vec3 col = mix(under, mix(uSkyH, uSky, clamp(r.z, 0.0, 1.0)), F);
  col += vec3(1.0) * pow(max(dot(r, uSunD), 0.0), 260.0) * 2.2;
  float foam = uFoam > 0.0 ? smoothstep(1.0 - uFoam * 0.55, 1.15 - uFoam * 0.5, a.x / max(uAmp * 1.6, 1e-4)) * smoothstep(-0.1, 0.3, fbm(p * 0.09 + uT * 0.25)) : 0.0;
  o = vec4(mix(col, vec3(0.97), foam * 0.85), 1.0);
}`,
    // Water in section: waves on the surface, light shafts below it (each crest is a lens that
    // focuses the light into a bright sheet), color deepening with depth, a sandy floor lit by
    // the same focusing, and drifting specks that catch the light.
    waterSide: `uniform vec4 uW1[5]; uniform float uLevel, uBot, uClar, uFoam, uIor, uAmpS, uSpecks; uniform vec3 uTop, uDeep, uLight, uSand, uSurf;
vec3 s1(float x) { vec3 r = vec3(0.0); for (int j = 0; j < 5; j++) { vec4 w = uW1[j]; float ph = w.x * x - w.y * uT + w.z, S = sin(ph), C = cos(ph); r += w.w * vec3(S, w.x * C, -w.x * w.x * S); } return r; }
void main() {
  vec2 p = px();
  vec3 h = s1(p.x);
  float ys = uLevel - h.x, z = p.y - ys;
  o = vec4(0.0);
  if (z < -1.2) return;
  float edge = 1.0 - smoothstep(0.0, 1.3, abs(z));
  float k = 1.0 - 1.0 / uIor;
  float x0 = p.x;
  for (int it = 0; it < 2; it++) x0 = p.x + z * k * s1(x0).y;
  vec3 h0 = s1(x0);
  float I = 1.0 / max(abs(1.0 - z * k * h0.z), 0.12);
  I = 1.0 + (I - 1.0) * exp(-max(z, 0.0) / (uClar * 1.5));   // farther down, the sheets blur out
  float fade = exp(-max(z, 0.0) / uClar);
  vec3 col = mix(uDeep, uTop, fade);
  float shaft = clamp(I - 1.0, -0.6, 3.0) * fade * (0.55 + 0.45 * nz(vec2(x0 * 0.05, uT * 0.3)));
  col += uLight * shaft * 0.3;
  if (p.y > uBot) {
    float sand = 0.85 + 0.15 * fbm(p * 0.06) + 0.08 * sin(p.x * 0.18 + fbm(p * 0.03) * 3.0);
    vec3 fl = uSand * sand * (0.6 + 0.4 * min(I, 2.2)) * (0.35 + 0.65 * fade);
    col = mix(col, fl, smoothstep(uBot, uBot + 2.0, p.y));
  }
  if (uSpecks > 0.5 && z > 2.0) {
    vec2 cell = floor(vec2(p.x, p.y + uT * 3.0) / 26.0), f = fract(vec2(p.x, p.y + uT * 3.0) / 26.0);
    uvec2 u = uvec2(ivec2(cell) & 0x7fffffff); uint hh = hs(u.x * 0x9e3779b1u ^ hs(u.y + uSeed));
    vec2 c = vec2(float(hh & 0xffu), float((hh >> 8) & 0xffu)) / 255.0;
    c += 0.08 * vec2(sin(uT * 0.7 + float(hh & 63u)), cos(uT * 0.5 + float(hh & 31u)));
    float sp = 1.0 - smoothstep(0.02, 0.05, length(f - c));
    col += uLight * sp * 0.35 * fade * float((hh >> 16) & 1u);
  }
  col += uLight * (1.0 - smoothstep(0.0, 7.0, z)) * 0.12;
  float cap = uFoam > 0.0 ? smoothstep(uAmpS * (1.3 - uFoam * 0.6), uAmpS * (1.6 - uFoam * 0.6), h.x) * (1.0 - smoothstep(0.0, 5.0, z)) * smoothstep(-0.2, 0.3, fbm(vec2(p.x * 0.08, uT))) : 0.0;
  col = mix(col, vec3(0.96), cap);
  col = mix(col, uSurf, edge * 0.85);
  float al = smoothstep(-1.2, 0.4, z);
  o = vec4(col * al, al);
}`,
    shimmer: `uniform sampler2D uTex; uniform vec4 uBx; uniform vec2 uCv; uniform float uDpr, uStr, uNs, uRise;
void main() {
  vec2 p = px(), q = vec2(p.x, p.y + uT * uRise) / uNs;
  vec2 dp = clamp(p + vec2(fbm(q), fbm(q + vec2(4.7, 1.3))) * uStr * (0.5 + 1.5 * smoothstep(0.0, uBx.w, p.y)), vec2(0.5), uBx.zw - 0.5);
  o = texture(uTex, (uBx.xy + dp * uDpr) / uCv);
}`,
  };

  let R = null, noGPU = false;
  const errors = [];
  function context() {
    if (R && !R.gl.isContextLost()) return R;
    R = null;
    if (noGPU || typeof document === "undefined") return null;
    try {
      const off = typeof OffscreenCanvas !== "undefined", canvas = off ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
      const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: !off, depth: false, stencil: false });
      if (!gl) { noGPU = true; return null; }
      R = { canvas, gl, off, w: 1, h: 1, progs: {}, vao: gl.createVertexArray() };
      canvas.addEventListener?.("webglcontextlost", e => {
        e.preventDefault(); R = null;
        setTimeout(() => window.dispatchEvent(new Event("safis:redraw")), 250);
      });
    } catch (e) { noGPU = true; errors.push(String(e.message || e)); }
    return R;
  }
  function program(name) {
    if (name in R.progs) return R.progs[name];
    const gl = R.gl;
    let P = null;
    try {
      // Compile both and link before asking how it went, so the driver needn't finish each in turn.
      const p = gl.createProgram(), shaders = [];
      for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, HEAD + FS[name]]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        gl.attachShader(p, s); shaders.push(s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        for (const s of shaders) if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        throw new Error(gl.getProgramInfoLog(p));
      }
      P = { p, u: {} };
      for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
        const a = gl.getActiveUniform(p, i);
        P.u[a.name.replace(/\[0\]$/, "")] = { loc: gl.getUniformLocation(p, a.name), type: a.type };
      }
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      console.warn(`[Fx] ${name} shader failed; using 2D.`, e.message);
    }
    return (R.progs[name] = P);
  }
  function uniforms(P, u) {
    const gl = R.gl, FN = { [gl.FLOAT]: "uniform1fv", [gl.FLOAT_VEC2]: "uniform2fv", [gl.FLOAT_VEC3]: "uniform3fv", [gl.FLOAT_VEC4]: "uniform4fv", [gl.INT_VEC2]: "uniform2iv" };
    let unit = 1;
    for (const [name, v] of Object.entries(u)) {
      const i = P.u[name], a = typeof v === "number" ? [v] : v;
      if (!i) continue;
      if (v?.tex) {   // a simulation's float texture, on units 1 and up
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.tex);
        gl.uniform1i(i.loc, unit++);
      } else if (v?.width !== undefined) {   // a canvas: the texture
        R.tex ??= gl.createTexture();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.uniform1i(i.loc, 0);
      } else if (FN[i.type]) gl[FN[i.type]](i.loc, a);
      else if (i.type === gl.FLOAT_MAT2) gl.uniformMatrix2fv(i.loc, false, a);
      else if (i.type === gl.UNSIGNED_INT) gl.uniform1ui(i.loc, a[0] >>> 0);
      else gl.uniform1i(i.loc, a[0] | 0);
    }
  }
  // Renders a shader over the box at figure size (density capped at 2).
  function render(g, box, name, u, o) {
    if (o.gpu === false || Fx.force2d || !context() || !program(name)) return null;
    const gl = R.gl, P = R.progs[name], k = min(g.dpr || 1, 2) * cn(o.res, 1, 0.25, 1), W = max(1, Math.round(box[2] * k)), Hh = max(1, Math.round(box[3] * k));
    if (W > R.w || Hh > R.h) { R.w = max(W, R.w); R.h = max(Hh, R.h); R.canvas.width = R.w; R.canvas.height = R.h; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, Hh);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(P.p);
    uniforms(P, { uSize: [W, Hh], uK: k, ...u });
    gl.bindVertexArray(R.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { img: R.off ? R.canvas.transferToImageBitmap() : R.canvas, sy: R.h - Hh, W, H: Hh };
  }

  // ---------- webgpu ----------
  // WebGPU compute for the simulations. With a hardware WebGPU adapter, the fluid's solver, the
  // wave equation, and 2D particles step as compute shaders on its queue (the same steps, in the
  // same order, as the WebGL2 and CPU versions); the WebGL2 shaders still draw them, from a copy
  // of the state that comes back without stalling. So while a simulation runs, what g.fx draws
  // (and velocity(), heights(), alive()) is the newest state back from the GPU, a frame or so
  // behind its clock; when nothing has stepped since a copy landed, a redraw is asked for, so a
  // still frame settles on exactly time t. sim.sync() resolves once the copy has caught up.
  // Detection runs once per page and is shared with E3 (window.__safisGPU). Fx.backend says what
  // simulations step on: "webgpu", "webgl2", or "cpu"; setting it forces one ("auto" undoes it),
  // as do ?backend=webgl2 in the page URL, window.SAFIS_BACKEND set before the scripts, and a
  // simulation's own `backend` option. A software adapter (SwiftShader) is skipped unless forced.
  const WG = (window.__safisGPU ||= (() => {
    const S = { device: null, soft: false, state: "none", error: null, epoch: 0, force: null, errors: [], name: "", ready: Promise.resolve() };
    try {
      const m = /[?&]backend=(webgpu|webgl2|cpu)\b/.exec((typeof location !== "undefined" && location.search) || "");
      S.force = (m && m[1]) || (["webgpu", "webgl2", "cpu"].includes(window.SAFIS_BACKEND) ? window.SAFIS_BACKEND : null);
    } catch {}
    const gpu = typeof navigator !== "undefined" ? navigator.gpu : null;
    const redraw = () => { try { window.dispatchEvent(new Event("safis:redraw")); } catch {} };
    S.start = () => {
      if (!gpu || S.state === "pending" || S.state === "ready") return S.ready;
      S.state = "pending";
      return (S.ready = (async () => {
        try {
          const a = await gpu.requestAdapter({ powerPreference: "high-performance" });
          if (!a) throw new Error("no WebGPU adapter");
          const i = a.info || {};
          S.name = [i.vendor, i.architecture, i.description].filter(Boolean).join(" ");
          S.soft = !!a.isFallbackAdapter || /swiftshader|llvmpipe|software|basic render/i.test(S.name);
          const L = a.limits, d = await a.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxBufferSize: L.maxBufferSize } });
          d.lost.then(r => { if (S.device === d) { S.device = null; S.state = "lost"; S.error = r.message; S.epoch++; redraw(); } });
          d.addEventListener?.("uncapturederror", e => { if (S.errors.length < 20) S.errors.push(String(e.error?.message ?? e)); });
          S.device = d; S.state = "ready"; S.epoch++;
        } catch (e) { S.state = "failed"; S.error = String((e && e.message) || e); }
        redraw();
      })());
    };
    // The device to step on: a hardware adapter's, or any adapter's when "webgpu" is forced.
    S.use = force => (S.device && (force === "webgpu" || !S.soft) ? S.device : null);
    // Copies that land while nothing steps (a paused figure) ask for one redraw.
    S.steps = 0;
    S.settle = (get = () => S.steps) => { const at = get(), raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : f => setTimeout(f, 16); raf(() => raf(() => { if (get() === at) redraw(); })); };
    if (S.force !== "webgl2" && S.force !== "cpu") S.start();
    return S;
  })());
  let fxForce = null;
  const forced = o => o.backend ?? (o.gpu === false ? "cpu" : null) ?? fxForce ?? WG.force;
  // What a simulation steps on now: "webgpu", "webgl2" (or the CPU when there's no float WebGL2), or "cpu".
  function pick(o) {
    const f = forced(o);
    if (f === "cpu") return "cpu";
    return f !== "webgl2" && WG.use(f) ? "webgpu" : "webgl2";
  }
  const gpuForced = o => o.gpu === true || ["webgpu", "webgl2"].includes(forced(o));

  // One device's kit: a bind group layout shared by every kernel (0: a uniform slot at a dynamic
  // offset, 1 to 4: read-only storage, 5: read-write storage), pipelines made on first use.
  const XK = new WeakMap(), XSL = 512, XBAD = {};
  let xid = 0;
  function xKit(d) {
    let K = XK.get(d);
    if (K) return K;
    const C = GPUShaderStage.COMPUTE;
    const bgl = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: C, buffer: { type: "uniform", hasDynamicOffset: true } },
      ...[1, 2, 3, 4].map(binding => ({ binding, visibility: C, buffer: { type: "read-only-storage" } })), { binding: 5, visibility: C, buffer: { type: "storage" } }] });
    K = { d, bgl, layout: d.createPipelineLayout({ bindGroupLayouts: [bgl] }), mods: {}, pipes: {}, dummy: xBuf(d, 16, GPUBufferUsage.STORAGE) };
    XK.set(d, K);
    return K;
  }
  function xBuf(d, size, usage, data) {
    const b = d.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    b._xid = ++xid;
    if (data) d.queue.writeBuffer(b, 0, data);
    return b;
  }
  // A compute pipeline; a shader that fails to compile marks its kind bad, and simulations of
  // that kind go back to WebGL2 or the CPU.
  function xPipe(K, kind, code, entry) {
    const key = kind + ":" + entry;
    if (K.pipes[key]) return K.pipes[key];
    let m = K.mods[kind];
    if (!m) {
      m = K.mods[kind] = K.d.createShaderModule({ code });
      m.getCompilationInfo?.().then(info => { const e = info.messages.filter(x => x.type === "error"); if (e.length) { XBAD[kind] = true; errors.push(`webgpu ${kind}: ${e[0].message} (line ${e[0].lineNum})`); } }).catch(() => {});
    }
    return (K.pipes[key] = K.d.createComputePipeline({ layout: K.layout, compute: { module: m, entryPoint: entry } }));
  }
  // Records dispatches for one simulation. Each dispatch gets a 512-byte uniform slot, filled on
  // the CPU and written to the GPU just before the commands that read it are submitted.
  function xQueue(d, slots = 192) {
    const ab = new ArrayBuffer(XSL * slots), K = xKit(d);
    const Q = { d, K, f: new Float32Array(ab), i: new Int32Array(ab), u32: new Uint32Array(ab), n: 0, enc: null, pass: null, groups: new Map(), ubuf: d.createBuffer({ size: XSL * slots, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) };
    Q.group = bufs => {
      const key = bufs.map(b => (b ? b._xid : 0)).join(",");
      let g = Q.groups.get(key);
      if (!g) {
        g = d.createBindGroup({ layout: K.bgl, entries: [{ binding: 0, resource: { buffer: Q.ubuf, size: XSL } }, ...bufs.map((b, j) => ({ binding: j + 1, resource: { buffer: b || K.dummy } }))] });
        if (Q.groups.size > 256) Q.groups.clear();
        Q.groups.set(key, g);
      }
      return g;
    };
    // run(pipeline, fill(f32 index of the slot, i32 view, f32 view), [S, X0, X1, X2, O], groups x, y)
    Q.run = (pipe, fill, bufs, wx, wy = 1) => {
      if (Q.n >= slots) Q.flush();
      const s = Q.n++;
      Q.f.fill(0, s * XSL / 4, (s + 1) * XSL / 4);
      fill(s * XSL / 4);
      if (!Q.pass) { Q.enc = d.createCommandEncoder(); Q.pass = Q.enc.beginComputePass(); }
      Q.pass.setPipeline(pipe);
      Q.pass.setBindGroup(0, Q.group(bufs), [s * XSL]);
      Q.pass.dispatchWorkgroups(wx, wy);
      WG.steps++; Q.runs = (Q.runs || 0) + 1;
    };
    Q.flush = () => {
      if (!Q.pass) return;
      Q.pass.end();
      d.queue.writeBuffer(Q.ubuf, 0, ab, 0, Q.n * XSL);
      d.queue.submit([Q.enc.finish()]);
      Q.pass = Q.enc = null; Q.n = 0;
    };
    Q.copy = (pairs) => { Q.flush(); const e = d.createCommandEncoder(); for (const [a, b] of pairs) e.copyBufferToBuffer(a, 0, b, 0, Math.min(a.size, b.size)); d.queue.submit([e.finish()]); };
    return Q;
  }
  // The copy back to the CPU: one in flight at a time; srcs() names the buffers holding the
  // state now (ping-pong) and when() its time. land(bytes as Float32Array views, time) mirrors it.
  function xMirror(Q, sizes, land) {
    const total = sizes.reduce((a, b) => a + b, 0), st = Q.d.createBuffer({ size: total, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const M = { busy: false, again: null, at: -1, done: [] };
    M.request = (srcs, when) => {
      Q.flush();
      if (M.busy) { M.again = [srcs, when]; return; }
      M.busy = true;
      const e = Q.d.createCommandEncoder(), list = srcs(), t = when();
      let off = 0;
      list.forEach((b, j) => { e.copyBufferToBuffer(b, 0, st, off, sizes[j]); off += sizes[j]; });
      Q.d.queue.submit([e.finish()]);
      st.mapAsync(GPUMapMode.READ).then(() => {
        const all = new Float32Array(st.getMappedRange().slice(0));
        st.unmap();
        let o = 0;
        land(sizes.map(n => { const v = all.subarray(o / 4, (o + n) / 4); o += n; return v; }), t);
        M.at = t; M.busy = false;
        if (M.again) { const [a, b] = M.again; M.again = null; M.request(a, b); }
        else { WG.settle(() => Q.runs); const w = M.done; M.done = []; w.forEach(f => f()); }
      }).catch(() => { M.busy = false; const w = M.done; M.done = []; w.forEach(f => f()); });
    };
    M.sync = () => (M.busy ? new Promise(r => M.done.push(r)) : Promise.resolve());
    M.destroy = () => { try { st.destroy(); } catch {} };
    return M;
  }

  // Fluid kernels: the flDye1 ... flProj shaders above as compute, over storage buffers laid out
  // like their textures (texel (i, j) at i + j * width). The pressure sweep updates in place, which
  // red-black ordering allows. X0 is always the velocity the step traces through.
  const XFL_HEAD = `
struct U { n: vec2<i32>, ws: f32, dt: f32, open: i32, mode: i32, color: i32, ns: i32, al: f32, uin: f32, eps: f32, uc: f32, stk: f32, fade: f32, om: f32, f0: f32, sp: array<vec4<f32>, 8>, sv: array<vec4<f32>, 8> }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> S: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> X0: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> X1: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> X2: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> O: array<vec4<f32>>;
fn iF(c: vec2<i32>) -> i32 { return c.x + c.y * (u.n.x + 1); }
fn iC(c: vec2<i32>) -> i32 { return c.x + c.y * u.n.x; }
fn sol(c: vec2<i32>) -> bool { return c.x >= 0 && c.y >= 0 && c.x < u.n.x && c.y < u.n.y && S[iC(c)].x > 0.5; }
`;
  const xflFetch = b => `
fn fu_${b}(c0: vec2<i32>) -> f32 { var c = c0; c.x = clamp(c.x, 0, u.n.x); var s = 1.0; if (c.y < 0 || c.y >= u.n.y) { s = u.ws; c.y = clamp(c.y, 0, u.n.y - 1); } return s * ${b}[iF(c)].x; }
fn fv_${b}(c0: vec2<i32>) -> f32 { var c = c0; c.y = clamp(c.y, 0, u.n.y); var s = 1.0; if (c.x < 0) { s = -1.0; c.x = 0; } c.x = min(c.x, u.n.x - 1); return s * ${b}[iF(c)].y; }
fn fd_${b}(c: vec2<i32>) -> vec4<f32> { return ${b}[iC(clamp(c, vec2<i32>(0), u.n - 1))]; }
fn bu_${b}(q: vec2<f32>, m: ptr<function, vec2<f32>>) -> f32 { let p = q - vec2<f32>(0.0, 0.5); let i = vec2<i32>(floor(p)); let f = p - vec2<f32>(i);
  let a = fu_${b}(i); let b2 = fu_${b}(i + vec2<i32>(1, 0)); let c = fu_${b}(i + vec2<i32>(0, 1)); let d = fu_${b}(i + vec2<i32>(1, 1));
  *m = vec2<f32>(min(min(a, b2), min(c, d)), max(max(a, b2), max(c, d))); return mix(mix(a, b2, f.x), mix(c, d, f.x), f.y); }
fn bv_${b}(q: vec2<f32>, m: ptr<function, vec2<f32>>) -> f32 { let p = q - vec2<f32>(0.5, 0.0); let i = vec2<i32>(floor(p)); let f = p - vec2<f32>(i);
  let a = fv_${b}(i); let b2 = fv_${b}(i + vec2<i32>(1, 0)); let c = fv_${b}(i + vec2<i32>(0, 1)); let d = fv_${b}(i + vec2<i32>(1, 1));
  *m = vec2<f32>(min(min(a, b2), min(c, d)), max(max(a, b2), max(c, d))); return mix(mix(a, b2, f.x), mix(c, d, f.x), f.y); }
fn bd_${b}(q: vec2<f32>, lo: ptr<function, vec4<f32>>, hi: ptr<function, vec4<f32>>) -> vec4<f32> { let p = q - 0.5; let i = vec2<i32>(floor(p)); let f = p - vec2<f32>(i);
  let a = fd_${b}(i); let b2 = fd_${b}(i + vec2<i32>(1, 0)); let c = fd_${b}(i + vec2<i32>(0, 1)); let d = fd_${b}(i + vec2<i32>(1, 1));
  *lo = min(min(a, b2), min(c, d)); *hi = max(max(a, b2), max(c, d)); return mix(mix(a, b2, f.x), mix(c, d, f.x), f.y); }
`;
  const XFL = XFL_HEAD + xflFetch("X0") + xflFetch("X1") + xflFetch("X2") + `
fn vel(p: vec2<f32>) -> vec2<f32> { var m: vec2<f32>; return vec2<f32>(bu_X0(p, &m), bv_X0(p, &m)); }
fn trace(p: vec2<f32>, s: f32) -> vec2<f32> { return p - s * vel(p - 0.5 * s * vel(p)); }
fn stir(x: vec2<f32>, w0: f32, k0: i32) -> f32 { var w = w0; for (var k = 0; k < u.ns; k++) { let d = x - u.sp[k].xy; let q = exp(-dot(d, d) / (u.sp[k].z * u.sp[k].z)) * u.sp[k].w; let t = select(u.sv[k].y, u.sv[k].x, k0 == 0); if (u.sv[k].w > 0.5) { w = w + q * t; } else { w = mix(w, t, q); } } return w; }
fn wa(c: vec2<i32>) -> f32 { return X2[iF(clamp(c, vec2<i32>(0), u.n))].x; }
fn conf(c: vec2<i32>, k: i32) -> f32 {
  let e = vec2<i32>(1, 0); let f = vec2<i32>(0, 1); var w: f32; var gx: f32; var gy: f32;
  if (k == 0) { w = 0.5 * (wa(c) + wa(c + f)); gx = 0.25 * (abs(wa(c + e)) + abs(wa(c + e + f)) - abs(wa(c - e)) - abs(wa(c - e + f))); gy = abs(wa(c + f)) - abs(wa(c)); }
  else { w = 0.5 * (wa(c) + wa(c + e)); gx = abs(wa(c + e)) - abs(wa(c)); gy = 0.25 * (abs(wa(c + f)) + abs(wa(c + e + f)) - abs(wa(c - f)) - abs(wa(c + e - f))); }
  return u.eps * u.uc * w * select(-gx, gy, k == 0) / (length(vec2<f32>(gx, gy)) + 1e-5);
}
fn fluU(c: vec2<i32>) -> bool { return c.y >= 0 && c.y < u.n.y && c.x > 0 && c.x <= u.n.x && !sol(c - vec2<i32>(1, 0)) && (c.x == u.n.x || !sol(c)); }
fn fluV(c: vec2<i32>) -> bool { return c.x >= 0 && c.x < u.n.x && c.y > 0 && c.y < u.n.y && !sol(c - vec2<i32>(0, 1)) && !sol(c); }
@compute @workgroup_size(8, 8) fn curlk(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x > u.n.x || c.y > u.n.y) { return; }
  O[iF(c)] = vec4<f32>(fv_X0(c) - fv_X0(c - vec2<i32>(1, 0)) - fu_X0(c) + fu_X0(c - vec2<i32>(0, 1)), 0.0, 0.0, 0.0);
}
@compute @workgroup_size(8, 8) fn dye1(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x >= u.n.x || c.y >= u.n.y) { return; }
  var lo: vec4<f32>; var hi: vec4<f32>;
  O[iC(c)] = bd_X1(trace(vec2<f32>(c) + 0.5, u.dt), &lo, &hi);
}
@compute @workgroup_size(8, 8) fn dye2(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x >= u.n.x || c.y >= u.n.y) { return; }
  let x = vec2<f32>(c) + 0.5; var lo: vec4<f32>; var hi: vec4<f32>; var l2: vec4<f32>; var h2: vec4<f32>;
  let b = bd_X2(trace(x, -u.dt), &l2, &h2); _ = bd_X1(trace(x, u.dt), &lo, &hi);
  var o = clamp(X2[iC(c)] + 0.5 * (X1[iC(c)] - b), lo, hi) * u.fade;
  for (var k = 0; k < u.ns; k++) { let d = x - u.sp[k].xy; o.x += u.sv[k].z * exp(-dot(d, d) / (u.sp[k].z * u.sp[k].z)); }
  if (u.stk > 0.0 && c.x < 2) { o.y = 1.0 - smoothstep(0.35, 1.1, abs(fract(x.y / u.stk) - 0.5) * u.stk); }
  if (sol(c)) { o = vec4<f32>(0.0); }
  O[iC(c)] = o;
}
@compute @workgroup_size(8, 8) fn adv1(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x > u.n.x || c.y > u.n.y) { return; }
  var m: vec2<f32>; var o = X0[iF(c)];
  if (c.y < u.n.y) { o.x = bu_X0(trace(vec2<f32>(c) + vec2<f32>(0.0, 0.5), u.dt), &m); }
  if (c.x < u.n.x) { o.y = bv_X0(trace(vec2<f32>(c) + vec2<f32>(0.5, 0.0), u.dt), &m); }
  O[iF(c)] = o;
}
@compute @workgroup_size(8, 8) fn adv2(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x > u.n.x || c.y > u.n.y) { return; }
  var m: vec2<f32>; var m2: vec2<f32>; let w = X0[iF(c)]; let h = X1[iF(c)]; var o = w;
  if (c.y < u.n.y) { let x = vec2<f32>(c) + vec2<f32>(0.0, 0.5); let b = bu_X1(trace(x, -u.dt), &m2); _ = bu_X0(trace(x, u.dt), &m); o.x = stir(x, clamp(h.x + 0.5 * (w.x - b), m.x, m.y), 0); if (u.eps > 0.0) { o.x += u.dt * conf(c, 0); } }
  if (c.x < u.n.x) { let x = vec2<f32>(c) + vec2<f32>(0.5, 0.0); let b = bv_X1(trace(x, -u.dt), &m2); _ = bv_X0(trace(x, u.dt), &m); o.y = stir(x, clamp(h.y + 0.5 * (w.y - b), m.x, m.y), 1); if (u.eps > 0.0) { o.y += u.dt * conf(c, 1); } }
  O[iF(c)] = o;
}
@compute @workgroup_size(8, 8) fn bnd(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x > u.n.x || c.y > u.n.y) { return; }
  let e = vec2<i32>(1, 0); let f = vec2<i32>(0, 1); let w = X0[iF(c)]; var o = w;
  if (c.y < u.n.y) {
    let l = c.x > 0 && sol(c - e); let r = c.x < u.n.x && sol(c);
    if (c.x == 0) { o.x = select(u.uin, 0.0, r); }
    else if (l && r) {
      let A = S[iC(c - e)]; let B = S[iC(c)]; let vo = 0.5 * (A.y + B.y); let sg = select(-1.0, 1.0, A.w > 0.5); var s = 0.0; var n = 0.0;
      if (fluU(c - f)) { s += X0[iF(c - f)].x; n += 1.0; }
      if (fluU(c + f)) { s += X0[iF(c + f)].x; n += 1.0; }
      if (n > 0.0) { o.x = vo + sg * (s / n - vo); } else { o.x = vo; }
    } else if (l || r) { o.x = S[iC(select(c, c - e, l))].y; }
    else if (u.mode > 0) { let s = fu_X0(c - e) + fu_X0(c + e) + fu_X0(c - f) + fu_X0(c + f); if (u.mode == 1) { o.x = w.x + u.al * (s - 4.0 * w.x); } else { o.x = (X1[iF(c)].x + u.al * s) / (1.0 + 4.0 * u.al); } }
  }
  if (c.x < u.n.x) {
    let t = c.y > 0 && sol(c - f); let b = c.y < u.n.y && sol(c);
    if ((c.y == 0 || c.y == u.n.y) && u.open == 0) { o.y = 0.0; }
    else if (t && b) {
      let A = S[iC(c - f)]; let B = S[iC(c)]; let vo = 0.5 * (A.z + B.z); let sg = select(-1.0, 1.0, A.w > 0.5); var s = 0.0; var n = 0.0;
      if (fluV(c - e)) { s += X0[iF(c - e)].y; n += 1.0; }
      if (fluV(c + e)) { s += X0[iF(c + e)].y; n += 1.0; }
      if (n > 0.0) { o.y = vo + sg * (s / n - vo); } else { o.y = vo; }
    } else if (t || b) { o.y = S[iC(select(c, c - f, t))].z; }
    else if (u.mode > 0) { let s = fv_X0(c - e) + fv_X0(c + e) + fv_X0(c - f) + fv_X0(c + f); if (u.mode == 1) { o.y = w.y + u.al * (s - 4.0 * w.y); } else { o.y = (X1[iF(c)].y + u.al * s) / (1.0 + 4.0 * u.al); } }
  }
  O[iF(c)] = o;
}
@compute @workgroup_size(8, 8) fn divk(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x >= u.n.x || c.y >= u.n.y) { return; }
  let w = X0[iF(c)]; var o = vec4<f32>(0.0);
  if (!sol(c)) { o.x = X0[iF(c + vec2<i32>(1, 0))].x - w.x + X0[iF(c + vec2<i32>(0, 1))].y - w.y; }
  O[iC(c)] = o;
}
fn Pp(c: vec2<i32>) -> f32 { return O[iC(c)].x; }
@compute @workgroup_size(8, 8) fn sor(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x >= u.n.x || c.y >= u.n.y || ((c.x + c.y) & 1) != u.color) { return; }
  let e = vec2<i32>(1, 0); let f = vec2<i32>(0, 1); let p = Pp(c); var s = 0.0; var n = 0.0;
  if (sol(c)) {
    if (c.x > 0 && !sol(c - e)) { s += Pp(c - e); n += 1.0; } if (c.x < u.n.x - 1 && !sol(c + e)) { s += Pp(c + e); n += 1.0; }
    if (c.y > 0 && !sol(c - f)) { s += Pp(c - f); n += 1.0; } if (c.y < u.n.y - 1 && !sol(c + f)) { s += Pp(c + f); n += 1.0; }
    O[iC(c)] = vec4<f32>(select(0.0, s / max(n, 1.0), n > 0.0), 0.0, 0.0, 1.0); return;
  }
  if (c.x > 0 && !sol(c - e)) { s += Pp(c - e); n += 1.0; }
  if (c.x < u.n.x - 1) { if (!sol(c + e)) { s += Pp(c + e); n += 1.0; } } else { n += 1.0; }
  if (c.y > 0) { if (!sol(c - f)) { s += Pp(c - f); n += 1.0; } } else if (u.open == 1) { n += 1.0; }
  if (c.y < u.n.y - 1) { if (!sol(c + f)) { s += Pp(c + f); n += 1.0; } } else if (u.open == 1) { n += 1.0; }
  var q = p;
  if (n > 0.0) { q = p + u.om * ((s - X0[iC(c)].x) / n - p); }
  O[iC(c)] = vec4<f32>(q, 0.0, 0.0, 1.0);
}
fn Pq(c: vec2<i32>) -> f32 { return X1[iC(c)].x; }
@compute @workgroup_size(8, 8) fn proj(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x > u.n.x || c.y > u.n.y) { return; }
  let e = vec2<i32>(1, 0); let f = vec2<i32>(0, 1); var o = X0[iF(c)];
  if (c.y < u.n.y && c.x > 0 && !sol(c - e)) { if (c.x == u.n.x) { o.x += Pq(c - e); } else if (!sol(c)) { o.x -= Pq(c) - Pq(c - e); } }
  if (c.x < u.n.x) {
    if (c.y > 0 && c.y < u.n.y) { if (!sol(c - f) && !sol(c)) { o.y -= Pq(c) - Pq(c - f); } }
    else if (u.open == 1) { if (c.y == 0 && !sol(c)) { o.y -= Pq(c); } else if (c.y == u.n.y && !sol(c - f)) { o.y += Pq(c - f); } }
  }
  O[iF(c)] = o;
}`;

  // The wave equation: waLap and waStep as compute. S is the mask (wall, damping, sponge).
  const XWA = `
struct U { dt: f32, c2: f32, s4: f32, t0: f32, n: vec2<i32>, nsrc: i32, nd: i32, sa: array<vec4<f32>, 8>, sb: array<vec4<f32>, 8>, sc: array<vec4<f32>, 8>, dr: array<vec4<f32>, 4> }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> S: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> X0: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> X1: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> X2: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> O: array<vec4<f32>>;
fn iC(c: vec2<i32>) -> i32 { return c.x + c.y * u.n.x; }
fn hn(c: vec2<i32>, h0: f32, k: i32) -> f32 { if (c.x < 0 || c.y < 0 || c.x >= u.n.x || c.y >= u.n.y) { return h0; } if (S[iC(c)].x > 0.5) { return h0; } return X0[iC(c)][k]; }
fn lap(c: vec2<i32>, k: i32) -> f32 { let h0 = X0[iC(c)][k]; return hn(c + vec2<i32>(1, 0), h0, k) + hn(c - vec2<i32>(1, 0), h0, k) + hn(c + vec2<i32>(0, 1), h0, k) + hn(c - vec2<i32>(0, 1), h0, k) - 4.0 * h0; }
@compute @workgroup_size(8, 8) fn lapk(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x >= u.n.x || c.y >= u.n.y) { return; }
  let w = X0[iC(c)]; O[iC(c)] = vec4<f32>(w.xy, lap(c, 0), 0.0);
}
@compute @workgroup_size(8, 8) fn stepk(@builtin(global_invocation_id) g: vec3<u32>) {
  let c = vec2<i32>(g.xy); if (c.x >= u.n.x || c.y >= u.n.y) { return; }
  let w = X0[iC(c)]; let m = S[iC(c)]; let x = vec2<f32>(c) + 0.5;
  if (m.x > 0.5) { O[iC(c)] = vec4<f32>(0.0); return; }
  var a = u.c2 * lap(c, 0);
  if (u.s4 > 0.0) { a -= u.s4 * lap(c, 2); }
  for (var k = 0; k < u.nsrc; k++) {
    let A = u.sa[k].xy; let B = u.sa[k].zw; let d = x - A; let e = B - A; let t = clamp(dot(d, e) / max(dot(e, e), 1e-6), 0.0, 1.0); let r2 = dot(d - e * t, d - e * t); let age = u.t0 - u.sc[k].x;
    if (age > 0.0) { a += u.sb[k].x * exp(-r2 / (u.sb[k].w * u.sb[k].w)) * sin(u.sb[k].y * u.t0 + u.sb[k].z) * smoothstep(0.0, u.sc[k].z, age) * exp(-age / u.sc[k].y); }
  }
  let v = (w.y + u.dt * a) * exp(-m.y * u.dt); var h = (w.x + u.dt * v) * exp(-m.z * u.dt);
  for (var k = 0; k < u.nd; k++) { let d = x - u.dr[k].xy; h -= u.dr[k].w * exp(-dot(d, d) / (u.dr[k].z * u.dr[k].z)); }
  O[iC(c)] = vec4<f32>(h, v, w.z, 0.0);
}`;

  // 2D particles: one thread per slot runs a run of steps (slots don't interact), the same
  // physics as stepOnce below: rebirth on the seeded schedule, gravity, exact drag, lift, curl
  // eddies, flutter, wind, segment / circle / polygon colliders, the ground, sticking. S holds each
  // slot's phase, X0 the steps' end times, X1 the colliders (two vec4 each), X2 polygon points.
  const XPA = `
struct U { n: i32, steps: i32, emitting: i32, ncol: i32, hh: f32, period: f32, life0: f32, life1: f32,
  seed: u32, shape: i32, density: f32, un: f32, gy: f32, lift: f32, kk: f32, ground: f32,
  turb: vec4<f32>, wind: vec4<f32>, em0: vec4<f32>, em1: vec4<f32>, em2: vec4<f32>, dom: vec4<f32>, modes: array<vec4<f32>, 4>, ms: vec4<f32> }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> S: array<f32>;
@group(0) @binding(2) var<storage, read> T: array<f32>;
@group(0) @binding(3) var<storage, read> C: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> Pt: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> O: array<vec4<f32>>;
const TAU = 6.283185307179586;
fn hsh(a: u32, b: u32, c: u32) -> u32 {
  var h = (a * 0x85ebca6bu) ^ ((b + 0x632be5abu) * 0xc2b2ae35u) ^ ((c + 0x27d4eb2fu) * 0x165667b1u);
  h ^= h >> 15u; h *= 0x2c1b3c6du; h ^= h >> 12u; h *= 0x297a2d39u; h ^= h >> 15u; return h;
}
fn rr(i: i32, k: i32, c: u32) -> f32 { return f32(hsh(u.seed, u32(i * 7919 + k * 104729), c) >> 8u) / 16777216.0; }
fn curl2(x: f32, y: f32, t: f32) -> vec2<f32> {
  var cx = 0.0; var cy = 0.0;
  for (var j = 0; j < 4; j++) { let M = u.modes[j]; let c2 = cos(M.x * x + M.y * y + M.z + M.w * t * TAU) * u.ms[j]; cx += c2 * M.y; cy -= c2 * M.x; }
  return vec2<f32>(cx * 0.7, cy * 0.7);
}
fn emit(i: i32, k: i32) -> vec4<f32> {
  var x = u.em0.x; var y = u.em0.y;
  if (u.shape == 1) { let a = TAU * rr(i, k, 10u); let q = u.em0.z * sqrt(rr(i, k, 11u)); x += q * cos(a); y += q * sin(a); }
  else if (u.shape == 2) { let t = rr(i, k, 10u); x = mix(u.em2.x, u.em2.z, t); y = mix(u.em2.y, u.em2.w, t); }
  else if (u.shape == 3) { x = u.em0.x + (rr(i, k, 10u) - 0.5) * u.em2.x; y = u.em0.y + (rr(i, k, 11u) - 0.5) * u.em2.y; }
  let a = u.em0.w + (rr(i, k, 13u) * 2.0 - 1.0) * u.em1.x;
  let s0 = mix(u.em1.y, u.em1.z, rr(i, k, 15u));
  return vec4<f32>(x, y, cos(a) * s0 * u.un, sin(a) * s0 * u.un);
}
fn meet(v: ptr<function, vec2<f32>>, flag: ptr<function, f32>, n: vec2<f32>, e: f32, fr: f32) {
  let vn = dot(*v, n); if (vn >= 0.0) { return; }
  *v -= (1.0 + e) * vn * n;
  let vt = (*v).x * -n.y + (*v).y * n.x; (*v).x -= vt * fr * -n.y; (*v).y -= vt * fr * n.x;
  if (fr >= 0.99 && e <= 0.01) { *flag = 1.0; *v = vec2<f32>(0.0); }
}
fn inPoly(o: i32, n: i32, x: f32, y: f32) -> bool {
  var k = false; var j = n - 1;
  for (var i = 0; i < n; i++) { let a = Pt[o + i]; let b = Pt[o + j]; if ((a.y > y) != (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) { k = !k; } j = i; }
  return k;
}
// Signed distance from a body and the outward normal: [d, nx, ny].
fn surf(c0: vec4<f32>, c1: vec4<f32>, x: f32, y: f32) -> vec3<f32> {
  if (c0.x < 1.5) { let dx = x - c1.x; let dy = y - c1.y; var d = length(vec2<f32>(dx, dy)); if (d == 0.0) { d = 1e-9; } return vec3<f32>(d - c0.w, dx / d, dy / d); }
  let o = i32(c1.x); let n = i32(c0.w); var best = 1e18; var nx = 0.0; var ny = -1.0; var j = n - 1;
  for (var i = 0; i < n; i++) {
    let a = Pt[o + j]; let b = Pt[o + i]; let ex = b.x - a.x; let ey = b.y - a.y; var l2 = ex * ex + ey * ey; if (l2 == 0.0) { l2 = 1e-18; }
    let t = clamp(((x - a.x) * ex + (y - a.y) * ey) / l2, 0.0, 1.0); let qx = x - a.x - ex * t; let qy = y - a.y - ey * t; let d = length(vec2<f32>(qx, qy));
    if (d < best) { best = d; if (d > 1e-12) { nx = qx / d; ny = qy / d; } else { nx = ey; ny = -ex; } }
    j = i;
  }
  if (inPoly(o, n, x, y)) { return vec3<f32>(-best, -nx, -ny); }
  return vec3<f32>(best, nx, ny);
}
@compute @workgroup_size(64) fn pstep(@builtin(global_invocation_id) g: vec3<u32>) {
  let i = i32(g.x); if (i >= u.n) { return; }
  var A = O[i * 2]; var B = O[i * 2 + 1];
  let ph = S[i]; let P = u.period;
  for (var s = 0; s < u.steps; s++) {
    let t1 = T[s]; let kf = floor((t1 - ph) / P); let age = t1 - ph - kf * P; let k = i32(kf);
    let life = u.life0 + (u.life1 - u.life0) * rr(i, k, 1u);
    var dtl = u.hh;
    if (B.x != kf) {
      if (age > u.hh + 1e-9) { B.x = kf; B.y = 2.0; continue; }
      B.x = kf;
      if (u.emitting == 0 || rr(i, k, 2u) >= u.density) { B.y = 2.0; continue; }
      A = emit(i, k); B.y = 0.0; B.z = TAU * rr(i, k, 5u);
      dtl = clamp(age, 0.0, u.hh);
    }
    if (B.y != 0.0 || age > life) { continue; }
    var x = A.x; var y = A.y; var v = A.zw; let x0 = x; let y0 = y; var flag = 0.0;
    var ax = 0.0; var ay = u.gy - u.lift * max(0.0, 1.0 - age / life);
    if (u.turb.w > 0.0) { let c2 = curl2(x * u.turb.y, y * u.turb.y, t1 * u.turb.z); ax += c2.x * u.turb.x; ay += c2.y * u.turb.x; }
    if (u.wind.w != 0.0) { ax += u.kk * u.wind.w * sin(TAU * u.wind.z * t1 + B.z); }
    let wx = u.wind.x; let wy = u.wind.y;
    if (u.kk > 0.0) {
      let e = exp(-u.kk * dtl); let f = (1.0 - e) / u.kk; let Tx = wx + ax / u.kk; let Ty = wy + ay / u.kk;
      x += Tx * dtl + (v.x - Tx) * f; y += Ty * dtl + (v.y - Ty) * f; v = vec2<f32>(Tx + (v.x - Tx) * e, Ty + (v.y - Ty) * e);
    } else { v += vec2<f32>(ax, ay) * dtl; x += v.x * dtl; y += v.y * dtl; }
    for (var c = 0; c < u.ncol; c++) {
      let c0 = C[c * 2]; let c1 = C[c * 2 + 1];
      if (c0.x < 0.5) {
        let ex = c1.z - c1.x; let ey = c1.w - c1.y; let s0 = (x0 - c1.x) * ey - (y0 - c1.y) * ex; let s1 = (x - c1.x) * ey - (y - c1.y) * ex;
        if ((s0 > 0.0) != (s1 > 0.0) && s0 != s1) {
          let t = s0 / (s0 - s1); let qx = x0 + (x - x0) * t; let qy = y0 + (y - y0) * t; var l2 = ex * ex + ey * ey; if (l2 == 0.0) { l2 = 1e-18; }
          let along = ((qx - c1.x) * ex + (qy - c1.y) * ey) / l2;
          if (along >= 0.0 && along <= 1.0) {
            var L = length(vec2<f32>(ex, ey)); if (L == 0.0) { L = 1.0; } let sg = select(-1.0, 1.0, s0 > 0.0); let n = vec2<f32>(sg * ey / L, -sg * ex / L);
            x = qx + n.x * 1e-4 * u.un; y = qy + n.y * 1e-4 * u.un; meet(&v, &flag, n, c0.y, c0.z);
          }
        }
      } else {
        let s = surf(c0, c1, x, y);
        if (s.x < 0.0) { x -= s.y * (s.x - 1e-4 * u.un); y -= s.z * (s.x - 1e-4 * u.un); meet(&v, &flag, s.yz, c0.y, c0.z); }
      }
      if (flag != 0.0) { break; }
    }
    if (u.em1.w > 0.5 && flag == 0.0) { if (y > u.ground) { y = u.ground; meet(&v, &flag, vec2<f32>(0.0, -1.0), u.dom.z, u.dom.w); } }
    if (x < -0.05 * u.dom.x || x > 1.05 * u.dom.x || y < -0.5 * u.dom.y || y > 1.05 * u.dom.y) { flag = 2.0; }
    B.y = flag; A = vec4<f32>(x, y, v.x, v.y);
  }
  O[i * 2] = A; O[i * 2 + 1] = B;
}`;
  const xWg = (n, k = 8) => Math.ceil(n / k);
  // Wraps a simulation's clock: before stepping, move it onto the backend it should be on; after,
  // ask for a copy of its state back. Returns the unwrapped reset (start again from rest).
  function xClock(S, before, after) {
    const adv = S.advance, warm = S.warm, reset = S.reset;
    S.advance = t => { before(); adv(t); after(); return S; };
    S.warm = t => { before(); warm(t); after(); return S; };
    S.reset = () => { before(); reset(); after(); return S; };
    return reset;
  }

  // ---------- simulations: fluid, waves, particles ----------
  // Each is made once per figure, stepped in fixed steps up to the figure's time (advance(t)),
  // and drawn by g.fx. Going back in time reloads the checkpoint warm(t) saved, or starts over,
  // so the same time shows the same picture. On the GPU the state lives in float textures on the
  // shared context; without float render targets the same steps run on the CPU on a coarser grid.
  const padTo = (a, n) => a.concat(Array(max(0, n - a.length)).fill(0)).slice(0, n);
  // A software WebGL (SwiftShader, llvmpipe) is slower at this than the CPU solver, so it counts as none.
  function floatGL(force) {
    if (Fx.force2d || !context()) return null;
    const gl = R.gl;
    if (R.float === undefined) {
      R.float = !!gl.getExtension("EXT_color_buffer_float");
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      R.soft = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
    }
    return R.float && (force || !R.soft) ? R : null;
  }
  function ftex(w, h, data = null) {
    const gl = R.gl, tex = gl.createTexture(), fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error("float render target incomplete");
    return { tex, fb, w, h };
  }
  const upload = (T, data) => { const gl = R.gl; gl.bindTexture(gl.TEXTURE_2D, T.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, T.w, T.h, gl.RGBA, gl.FLOAT, data); };
  function pass(name, T, u) {
    const gl = R.gl, P = program(name);
    if (!P) throw new Error(`${name}: shader failed`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.viewport(0, 0, T.w, T.h); gl.useProgram(P.p);
    uniforms(P, u); gl.bindVertexArray(R.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function readTex(T, out) { const gl = R.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb); gl.readPixels(0, 0, T.w, T.h, gl.RGBA, gl.FLOAT, out); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return out; }
  function copyTex(A, B) {
    const gl = R.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, A.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, B.fb);
    gl.blitFramebuffer(0, 0, A.w, A.h, 0, 0, B.w, B.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }
  // Inside a figure's frame (the runtime sets __safisFrame), a big jump (a warm-up to t = 9 s, or
  // catching up after the tab was hidden) shares a budget of about 10 ms a frame across every sim
  // on the page, so it runs over several frames instead of freezing the page; the sim reports
  // `behind` until it gets there. A frame's ordinary steps (under 0.1 s of sim time) always run in
  // full, so a playing sim never drifts. Called from anywhere else, or while the page checker
  // runs, advance(t) gets all the way to t at once.
  const STEP_BUDGET = 8;
  let budgetFrom = -1e9;
  // Sims that are behind keep catching up a slice a frame on their own, drawn or not, and the
  // figures redraw when one gets there.
  const lagging = new Set();
  let pumping = false;
  const pump = () => {
    pumping = false;
    const outer = window.__safisFrame;
    window.__safisFrame = true;
    let done = false;
    try { for (const S of lagging) { S.advance(S.target); if (!S.behind) { lagging.delete(S); done = true; } } }
    finally { window.__safisFrame = outer; }
    if (done) window.dispatchEvent(new Event("safis:redraw"));
    if (lagging.size) { pumping = true; requestAnimationFrame(pump); }
  };
  const lag = S => { lagging.add(S); if (!pumping && typeof requestAnimationFrame === "function") { pumping = true; requestAnimationFrame(pump); } };
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const stepDeadline = () => {
    if (typeof window === "undefined" || !window.__safisFrame || document.documentElement.classList.contains("safis-checking")) return Infinity;
    const now = nowMs();
    if (now - budgetFrom > 3 * STEP_BUDGET) budgetFrom = now;
    return budgetFrom + STEP_BUDGET;
  };
  // A sim's clock: fixed steps of S.dt, a checkpoint from warm(t), and going back in time.
  function clock(S, stepOnce, save, load, init) {
    const restart = () => { init(); S.time = 0; };
    // The checkpoint warm(t) asked for, taken when the clock passes t.
    const mark = () => { if (S.warmTo != null && S.time + S.dt > S.warmTo + 1e-9) { S.chk = { ...save(), time: S.time, at: S.warmTo }; S.warmTo = null; } };
    Object.assign(S, {
      time: 0, chk: null, warmTo: null, behind: false,
      reset() { restart(); S.chk = null; S.warmTo = null; return S; },
      advance(t) {
        t = num(t, 0);
        if (t < S.time - 1e-9) { if (S.chk && t >= S.chk.time - 1e-9) { load(S.chk); S.time = S.chk.time; } else restart(); }
        const end = t - S.time > 0.1 ? stepDeadline() : Infinity;
        S.target = t;
        for (let n = 0; S.time + S.dt <= t + 1e-9 && n < 1e5; n++) {
          mark();
          stepOnce(S.dt); S.time += S.dt;
          if ((n & 3) === 3 && nowMs() > end) break;
        }
        mark();
        S.behind = S.time + S.dt <= t + 1e-9;
        if (S.behind) lag(S);
        return S;
      },
      warm(t) {
        t = num(t, 0);
        if (S.chk?.at === t) { load(S.chk); S.time = S.chk.time; S.warmTo = null; S.behind = false; return S; }
        if (S.warmTo === t && S.time <= t + 1e-9) return S.advance(t);   // still on its way there
        if (t < S.time - 1e-9 || S.chk || S.warmTo != null) { restart(); S.chk = null; }
        S.warmTo = t;
        return S.advance(t);
      },
    });
    restart();
  }
  const toWorld = (S, p) => { const b = S.view ?? [0, 0, S.domain[0], S.domain[1]]; return [(p[0] - b[0]) / b[2] * S.domain[0], (p[1] - b[1]) / b[3] * S.domain[1]]; };
  const toScreen = (S, q) => { const b = S.view ?? [0, 0, S.domain[0], S.domain[1]]; return [b[0] + q[0] / S.domain[0] * b[2], b[1] + q[1] / S.domain[1] * b[3]]; };

  // Solid bodies in m (y down): circle { at, r }, rect { at, size, angle }, polygon { points, at? },
  // airfoil { at (mid-chord), chord, thickness, camber, alpha (nose up) }: a NACA 4-digit section.
  function naca(c, t, m, n = 36) {
    const P = 0.4, up = [], lo = [];
    for (let k = 0; k <= n; k++) {
      const x = (1 - cos(PI * k / n)) / 2, yt = 5 * t * (0.2969 * sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
      const yc = x < P ? m / P / P * (2 * P * x - x * x) : m / (1 - P) ** 2 * (1 - 2 * P + 2 * P * x - x * x), th = Math.atan(x < P ? 2 * m / P / P * (P - x) : 2 * m / (1 - P) ** 2 * (P - x));
      up.push([(x - yt * sin(th)) * c, -(yc + yt * cos(th)) * c]); lo.push([(x + yt * sin(th)) * c, -(yc - yt * cos(th)) * c]);
    }
    return up.concat(lo.reverse().slice(1, -1));
  }
  function solidOf(q) {
    const at = q.at ?? [0, 0], a = num(q.alpha ?? q.angle, 0), ca = cos(a), sa = sin(a), rot = p => [at[0] + p[0] * ca - p[1] * sa, at[1] + p[0] * sa + p[1] * ca];
    const shape = q.shape ?? (q.r != null ? "circle" : q.points ? "polygon" : q.chord != null ? "airfoil" : "rect");
    if (shape === "circle") { const r = max(1e-9, num(q.r, 0.05)); return { kind: 0, c: at, r, box: [at[0] - r, at[1] - r, at[0] + r, at[1] + r], D: 2 * r }; }
    let pts;
    if (shape === "rect") { const s = q.size ?? [0.1, 0.1], w = s[0] / 2, h = s[1] / 2; pts = [[-w, -h], [w, -h], [w, h], [-w, h]].map(rot); }
    else if (shape === "airfoil") { const c = max(1e-6, num(q.chord, 0.3)); pts = naca(c, cn(q.thickness, 0.12, 0.01, 0.4), cn(q.camber, 0, -0.1, 0.1)).map(p => rot([p[0] - c / 2, p[1]])); }
    else if (shape === "polygon" && q.points?.length > 2) pts = q.points.map(p => (q.at ? rot(p) : [p[0], p[1]]));
    else throw new Error(`Fx.fluid: obstacle shape ${JSON.stringify(shape)} isn't one of "circle", "rect", "polygon", "airfoil" (a polygon needs 3 or more points)`);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), box = [min(...xs), min(...ys), max(...xs), max(...ys)];
    return { kind: 1, pts, box, D: shape === "airfoil" ? num(q.chord, 0.3) : box[3] - box[1] };
  }
  const inPoly = (pts, x, y) => { let k = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) k = !k; } return k; };
  const inSolid = (s, x, y) => (s.kind ? x >= s.box[0] && x <= s.box[2] && y >= s.box[1] && y <= s.box[3] && inPoly(s.pts, x, y) : (x - s.c[0]) ** 2 + (y - s.c[1]) ** 2 < s.r * s.r);
  // Signed distance from a body's surface and the outward normal there: [d, nx, ny].
  function surfaceOf(s, x, y) {
    if (!s.kind) { const dx = x - s.c[0], dy = y - s.c[1], d = hypot(dx, dy) || 1e-9; return [d - s.r, dx / d, dy / d]; }
    let best = 1e18, nx = 0, ny = -1;
    for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
      const a = s.pts[j], b = s.pts[i], ex = b[0] - a[0], ey = b[1] - a[1], t = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1e-18), 0, 1);
      const qx = x - a[0] - ex * t, qy = y - a[1] - ey * t, d = hypot(qx, qy);
      if (d < best) { best = d; nx = d > 1e-12 ? qx / d : ey; ny = d > 1e-12 ? qy / d : -ex; }
    }
    return inPoly(s.pts, x, y) ? [-best, -nx, -ny] : [best, nx, ny];
  }
  const bodyPath = s => (s.kind ? s.pts : Array.from({ length: 48 }, (_, i) => [s.c[0] + s.r * cos(i / 48 * TAU), s.c[1] + s.r * sin(i / 48 * TAU)]));

  // ---------- fluid: incompressible Navier-Stokes on a staggered (MAC) grid ----------
  // Texel (i, j) holds u on cell (i, j)'s left face and v on its top face, so velocity is an
  // (nx + 1) x (ny + 1) grid; pressure and dye sit at cell centers. A step: MacCormack advection
  // (forward, back, half the round-trip error put back, clamped to the cell it came from), forces,
  // viscosity (explicit when mild, implicit Jacobi when viscous), then projection: red-black SOR on
  // the 5-point Laplacian, which on this grid is exactly div grad, so the divergence left is the
  // solver's residual. Solids are cells; faces into a solid carry its velocity, faces inside it
  // hold ghosts that mirror the flow (no-slip) or copy it (free-slip). Inflow at the left edge,
  // p = 0 outflow at the right, walls (or open air) at the top and bottom.
  const FLU = `
uniform sampler2D uV, uS; uniform ivec2 uN; uniform float uWs, uDt; uniform int uOpen;
float fu(sampler2D t, ivec2 c) { c.x = clamp(c.x, 0, uN.x); float s = 1.0; if (c.y < 0 || c.y >= uN.y) { s = uWs; c.y = clamp(c.y, 0, uN.y - 1); } return s * texelFetch(t, c, 0).x; }
float fv(sampler2D t, ivec2 c) { c.y = clamp(c.y, 0, uN.y); float s = 1.0; if (c.x < 0) { s = -1.0; c.x = 0; } c.x = min(c.x, uN.x - 1); return s * texelFetch(t, c, 0).y; }
vec4 fd(sampler2D t, ivec2 c) { return texelFetch(t, clamp(c, ivec2(0), uN - 1), 0); }
float bu(sampler2D t, vec2 p, out vec2 m) { p.y -= 0.5; ivec2 i = ivec2(floor(p)); vec2 f = p - vec2(i); float a = fu(t, i), b = fu(t, i + ivec2(1, 0)), c = fu(t, i + ivec2(0, 1)), d = fu(t, i + 1); m = vec2(min(min(a, b), min(c, d)), max(max(a, b), max(c, d))); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float bv(sampler2D t, vec2 p, out vec2 m) { p.x -= 0.5; ivec2 i = ivec2(floor(p)); vec2 f = p - vec2(i); float a = fv(t, i), b = fv(t, i + ivec2(1, 0)), c = fv(t, i + ivec2(0, 1)), d = fv(t, i + 1); m = vec2(min(min(a, b), min(c, d)), max(max(a, b), max(c, d))); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
vec4 bd(sampler2D t, vec2 p, out vec4 lo, out vec4 hi) { p -= 0.5; ivec2 i = ivec2(floor(p)); vec2 f = p - vec2(i); vec4 a = fd(t, i), b = fd(t, i + ivec2(1, 0)), c = fd(t, i + ivec2(0, 1)), d = fd(t, i + 1); lo = min(min(a, b), min(c, d)); hi = max(max(a, b), max(c, d)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
vec2 vel(vec2 p) { vec2 m; return vec2(bu(uV, p, m), bv(uV, p, m)); }
vec2 trace(vec2 p, float s) { return p - s * vel(p - 0.5 * s * vel(p)); }
bool sol(ivec2 c) { return c.x >= 0 && c.y >= 0 && c.x < uN.x && c.y < uN.y && texelFetch(uS, c, 0).x > 0.5; }
`;
  const SPLAT = `uniform vec4 uSp[8], uSv[8]; uniform int uNs;
float stir(vec2 x, float w, int k0) { for (int k = 0; k < 8; k++) { if (k >= uNs) break; vec2 d = x - uSp[k].xy; float q = exp(-dot(d, d) / (uSp[k].z * uSp[k].z)) * uSp[k].w, t = k0 == 0 ? uSv[k].x : uSv[k].y; w = uSv[k].w > 0.5 ? w + q * t : mix(w, t, q); } return w; }
`;
  Object.assign(FS, {
    flDye1: FLU + `uniform sampler2D uD;
void main() { vec4 lo, hi; o = bd(uD, trace(vec2(ivec2(gl_FragCoord.xy)) + 0.5, uDt), lo, hi); }`,
    flDye2: FLU + SPLAT + `uniform sampler2D uD, uH; uniform float uStk, uFade;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); vec2 x = vec2(c) + 0.5; vec4 lo, hi, l2, h2;
  vec4 b = bd(uH, trace(x, -uDt), l2, h2); bd(uD, trace(x, uDt), lo, hi);
  o = clamp(texelFetch(uH, c, 0) + 0.5 * (texelFetch(uD, c, 0) - b), lo, hi) * uFade;
  for (int k = 0; k < 8; k++) { if (k >= uNs) break; vec2 d = x - uSp[k].xy; o.x += uSv[k].z * exp(-dot(d, d) / (uSp[k].z * uSp[k].z)); }
  if (uStk > 0.0 && c.x < 2) o.y = 1.0 - smoothstep(0.35, 1.1, abs(fract(x.y / uStk) - 0.5) * uStk);
  if (sol(c)) o = vec4(0.0);
}`,
    flAdv1: FLU + `void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); vec2 m; o = texelFetch(uV, c, 0);
  if (c.y < uN.y) o.x = bu(uV, trace(vec2(c) + vec2(0.0, 0.5), uDt), m);
  if (c.x < uN.x) o.y = bv(uV, trace(vec2(c) + vec2(0.5, 0.0), uDt), m);
}`,
    // The correction, the reader's stirring, and (if asked) vorticity confinement.
    flAdv2: FLU + SPLAT + `uniform sampler2D uH, uW; uniform float uEps, uUc;
float wa(ivec2 c) { return texelFetch(uW, clamp(c, ivec2(0), uN), 0).x; }
float conf(ivec2 c, int k) {
  ivec2 e = ivec2(1, 0), f = ivec2(0, 1); float w, gx, gy;
  if (k == 0) { w = 0.5 * (wa(c) + wa(c + f)); gx = 0.25 * (abs(wa(c + e)) + abs(wa(c + e + f)) - abs(wa(c - e)) - abs(wa(c - e + f))); gy = abs(wa(c + f)) - abs(wa(c)); }
  else { w = 0.5 * (wa(c) + wa(c + e)); gx = abs(wa(c + e)) - abs(wa(c)); gy = 0.25 * (abs(wa(c + f)) + abs(wa(c + e + f)) - abs(wa(c - f)) - abs(wa(c + e - f))); }
  return uEps * uUc * w * (k == 0 ? gy : -gx) / (length(vec2(gx, gy)) + 1e-5);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); vec2 m, m2; vec4 w = texelFetch(uV, c, 0), h = texelFetch(uH, c, 0); o = w;
  if (c.y < uN.y) { vec2 x = vec2(c) + vec2(0.0, 0.5); float b = bu(uH, trace(x, -uDt), m2); bu(uV, trace(x, uDt), m); o.x = stir(x, clamp(h.x + 0.5 * (w.x - b), m.x, m.y), 0); if (uEps > 0.0) o.x += uDt * conf(c, 0); }
  if (c.x < uN.x) { vec2 x = vec2(c) + vec2(0.5, 0.0); float b = bv(uH, trace(x, -uDt), m2); bv(uV, trace(x, uDt), m); o.y = stir(x, clamp(h.y + 0.5 * (w.y - b), m.x, m.y), 1); if (uEps > 0.0) o.y += uDt * conf(c, 1); }
}`,
    flCurl: FLU + `void main() { ivec2 c = ivec2(gl_FragCoord.xy); o = vec4(fv(uV, c) - fv(uV, c - ivec2(1, 0)) - fu(uV, c) + fu(uV, c - ivec2(0, 1)), 0.0, 0.0, 0.0); }`,
    // Boundary faces, ghosts, and viscosity (uMode 0: boundaries only, 1: explicit, 2: one Jacobi sweep of the implicit step).
    flBnd: FLU + `uniform sampler2D uA; uniform float uAl, uIn; uniform int uMode;
bool fluU(ivec2 c) { return c.y >= 0 && c.y < uN.y && c.x > 0 && c.x <= uN.x && !sol(c - ivec2(1, 0)) && (c.x == uN.x || !sol(c)); }
bool fluV(ivec2 c) { return c.x >= 0 && c.x < uN.x && c.y > 0 && c.y < uN.y && !sol(c - ivec2(0, 1)) && !sol(c); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), e = ivec2(1, 0), f = ivec2(0, 1); vec4 w = texelFetch(uV, c, 0); o = w;
  if (c.y < uN.y) {
    bool l = c.x > 0 && sol(c - e), r = c.x < uN.x && sol(c);
    if (c.x == 0) o.x = r ? 0.0 : uIn;
    else if (l && r) {
      vec4 A = texelFetch(uS, c - e, 0), B = texelFetch(uS, c, 0); float vo = 0.5 * (A.y + B.y), sg = A.w > 0.5 ? 1.0 : -1.0, s = 0.0, n = 0.0;
      if (fluU(c - f)) { s += texelFetch(uV, c - f, 0).x; n++; }
      if (fluU(c + f)) { s += texelFetch(uV, c + f, 0).x; n++; }
      o.x = n > 0.0 ? vo + sg * (s / n - vo) : vo;
    } else if (l || r) o.x = texelFetch(uS, l ? c - e : c, 0).y;
    else if (uMode > 0) { float s = fu(uV, c - e) + fu(uV, c + e) + fu(uV, c - f) + fu(uV, c + f); o.x = uMode == 1 ? w.x + uAl * (s - 4.0 * w.x) : (texelFetch(uA, c, 0).x + uAl * s) / (1.0 + 4.0 * uAl); }
  }
  if (c.x < uN.x) {
    bool t = c.y > 0 && sol(c - f), b = c.y < uN.y && sol(c);
    if ((c.y == 0 || c.y == uN.y) && uOpen == 0) o.y = 0.0;
    else if (t && b) {
      vec4 A = texelFetch(uS, c - f, 0), B = texelFetch(uS, c, 0); float vo = 0.5 * (A.z + B.z), sg = A.w > 0.5 ? 1.0 : -1.0, s = 0.0, n = 0.0;
      if (fluV(c - e)) { s += texelFetch(uV, c - e, 0).y; n++; }
      if (fluV(c + e)) { s += texelFetch(uV, c + e, 0).y; n++; }
      o.y = n > 0.0 ? vo + sg * (s / n - vo) : vo;
    } else if (t || b) o.y = texelFetch(uS, t ? c - f : c, 0).z;
    else if (uMode > 0) { float s = fv(uV, c - e) + fv(uV, c + e) + fv(uV, c - f) + fv(uV, c + f); o.y = uMode == 1 ? w.y + uAl * (s - 4.0 * w.y) : (texelFetch(uA, c, 0).y + uAl * s) / (1.0 + 4.0 * uAl); }
  }
}`,
    flDiv: FLU + `void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec4 w = texelFetch(uV, c, 0); o = vec4(0.0); if (!sol(c)) o.x = texelFetch(uV, c + ivec2(1, 0), 0).x - w.x + texelFetch(uV, c + ivec2(0, 1), 0).y - w.y; }`,
    // One color of red-black SOR. A solid cell takes the mean of its fluid neighbours (for drawing only).
    flSor: FLU + `uniform sampler2D uP, uDv; uniform int uColor; uniform float uOm;
float P(ivec2 c) { return texelFetch(uP, c, 0).x; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), e = ivec2(1, 0), f = ivec2(0, 1); float p = P(c), s = 0.0, n = 0.0; o = vec4(p, 0.0, 0.0, 1.0);
  if (((c.x + c.y) & 1) != uColor) return;
  if (sol(c)) {
    if (c.x > 0 && !sol(c - e)) { s += P(c - e); n++; } if (c.x < uN.x - 1 && !sol(c + e)) { s += P(c + e); n++; }
    if (c.y > 0 && !sol(c - f)) { s += P(c - f); n++; } if (c.y < uN.y - 1 && !sol(c + f)) { s += P(c + f); n++; }
    o.x = n > 0.0 ? s / n : 0.0; return;
  }
  if (c.x > 0 && !sol(c - e)) { s += P(c - e); n++; }
  if (c.x < uN.x - 1) { if (!sol(c + e)) { s += P(c + e); n++; } } else n++;
  if (c.y > 0) { if (!sol(c - f)) { s += P(c - f); n++; } } else if (uOpen == 1) n++;
  if (c.y < uN.y - 1) { if (!sol(c + f)) { s += P(c + f); n++; } } else if (uOpen == 1) n++;
  if (n > 0.0) o.x = p + uOm * ((s - texelFetch(uDv, c, 0).x) / n - p);
}`,
    flProj: FLU + `uniform sampler2D uP;
float P(ivec2 c) { return texelFetch(uP, c, 0).x; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), e = ivec2(1, 0), f = ivec2(0, 1); o = texelFetch(uV, c, 0);
  if (c.y < uN.y && c.x > 0 && !sol(c - e)) { if (c.x == uN.x) o.x += P(c - e); else if (!sol(c)) o.x -= P(c) - P(c - e); }
  if (c.x < uN.x) {
    if (c.y > 0 && c.y < uN.y) { if (!sol(c - f) && !sol(c)) o.y -= P(c) - P(c - f); }
    else if (uOpen == 1) { if (c.y == 0 && !sol(c)) o.y -= P(c); else if (c.y == uN.y && !sol(c - f)) o.y += P(c - f); }
  }
}`,
    // A small grid for the CPU: velocity (m/s) at block centers, solid, pressure.
    flRead: FLU + `uniform sampler2D uP; uniform float uF, uHm;
void main() { vec2 x = (floor(gl_FragCoord.xy) + 0.5) * uF; ivec2 c = clamp(ivec2(x), ivec2(0), uN - 1); o = vec4(vel(x) * uHm, sol(c) ? 1.0 : 0.0, texelFetch(uP, c, 0).x); }`,
    // The picture: speed, pressure coefficient, or vorticity through a colormap, with dye on top.
    flShow: FLU + `uniform sampler2D uP, uD; uniform vec2 uBox; uniform int uMode; uniform float uLo, uHi, uHm, uCpK, uWk, uDyeK, uStkK; uniform vec3 uCm[16], uDye, uStkC, uBody, uPaper;
vec3 cmap(float t) { t = clamp(t, 0.0, 1.0) * 15.0; int i = min(int(t), 14); return mix(uCm[i], uCm[i + 1], t - float(i)); }
float sc(sampler2D t, vec2 p, int k) { p -= 0.5; ivec2 i = ivec2(floor(p)); vec2 f = p - vec2(i); ivec2 m = uN - 1;
  float a = texelFetch(t, clamp(i, ivec2(0), m), 0)[k], b = texelFetch(t, clamp(i + ivec2(1, 0), ivec2(0), m), 0)[k], c = texelFetch(t, clamp(i + ivec2(0, 1), ivec2(0), m), 0)[k], d = texelFetch(t, clamp(i + 1, ivec2(0), m), 0)[k];
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
void main() {
  vec2 x = px() / uBox * vec2(uN), m; float val = 0.0;
  if (uMode == 0) val = length(vel(x)) * uHm;
  else if (uMode == 1) { float ref = (sc(uP, vec2(1.5, 0.25 * float(uN.y)), 0) + sc(uP, vec2(1.5, 0.5 * float(uN.y)), 0) + sc(uP, vec2(1.5, 0.75 * float(uN.y)), 0)) / 3.0; val = (sc(uP, x, 0) - ref) * uCpK; }
  else if (uMode == 2) val = ((bv(uV, x + vec2(0.5, 0.0), m) - bv(uV, x - vec2(0.5, 0.0), m)) - (bu(uV, x + vec2(0.0, 0.5), m) - bu(uV, x - vec2(0.0, 0.5), m))) * uWk;
  vec3 col = uMode == 3 ? uPaper : cmap((val - uLo) / (uHi - uLo));
  vec4 lo, hi, d = bd(uD, x, lo, hi);
  col = mix(col, uDye, (1.0 - exp(-max(d.x, 0.0) * uDyeK)) * 0.92);
  col = mix(col, uStkC, clamp(d.y, 0.0, 1.0) * uStkK);
  col = mix(col, uBody, smoothstep(0.3, 0.7, sc(uS, x, 0)));
  o = vec4(col, 1.0);
}`,
  });

  function fluid(o = {}) {
    const dom = o.domain ?? [2.4, 0.9];
    if (!(dom[0] > 0 && dom[1] > 0)) throw new Error("Fx.fluid: domain should be [width, height] in m, such as [2.4, 0.9]");
    let G = null, X = null;
    const want = pick(o) !== "cpu" && !!floatGL(gpuForced(o));
    const ny = max(8, Math.round(num(want ? o.cells : o.cpuCells, want ? 96 : 40))), h = dom[1] / ny, nx = max(8, Math.round(dom[0] / h)), W = nx + 1, NF = W * (ny + 1), NC = nx * ny;
    const S = { isFluid: true, domain: dom, grid: [nx, ny], h, view: null, walls: ["slip", "no-slip", "open"].includes(o.walls) ? o.walls : "slip", obstacles: (o.obstacles ?? []).map(q => ({ ...q })) };
    const solid = new Uint8Array(NC), sv = new Float32Array(NC * 4), paint = new Uint8Array(NC);
    let bodies = [], U = 0.5, nu = 1e-3, re = null, L = 1, eps = 0, iters = 24, omega = 1.85, vsp = [], dsp = [], sources = [], streaks = 0, fade = 0, maskDirty = true, serial = 0, kicked = false, probe = null, hist = [];
    const rasterize = () => {
      bodies = S.obstacles.map(solidOf);
      solid.set(paint); sv.fill(0);
      for (let k = 0; k < NC; k++) sv[k * 4] = paint[k];
      bodies.forEach((b, bi) => {
        const q = S.obstacles[bi], v = q._v ?? [0, 0], slip = q.slip === "free" ? 1 : 0;
        const i0 = max(0, floor(b.box[0] / h - 1)), i1 = min(nx - 1, Math.ceil(b.box[2] / h)), j0 = max(0, floor(b.box[1] / h - 1)), j1 = min(ny - 1, Math.ceil(b.box[3] / h));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inSolid(b, (i + 0.5) * h, (j + 0.5) * h)) { const k = i + j * nx; solid[k] = 1; sv[k * 4] = 1; sv[k * 4 + 1] = v[0] / h; sv[k * 4 + 2] = v[1] / h; sv[k * 4 + 3] = slip; }
      });
      maskDirty = false;
      if (G) upload(G.S, sv);
      if (X) { X.Q.flush(); X.d.queue.writeBuffer(X.S, 0, sv); }
    };
    rasterize();
    L = max(1e-6, num(o.length, bodies[0]?.D ?? dom[1] / 8));
    S.set = (p = {}) => {
      if (p.speed != null) U = max(0, num(p.speed, U));
      if (p.length != null) L = max(1e-6, num(p.length, L));
      if (p.nu != null) { nu = max(0, num(p.nu, nu)); re = null; }
      if (p.re != null) re = max(1e-3, num(p.re, 100));
      if (re != null) nu = U * L / re;
      if (p.vorticity != null) eps = cn(p.vorticity, 0, 0, 2);
      if (p.iterations != null) iters = cn(p.iterations, 24, 1, 400) | 0;
      if (p.dye) sources = p.dye.map(d => ({ x: d.at[0] / h, y: d.at[1] / h, r: max(0.7, num(d.r, 2 * h) / h), rate: num(d.rate, 4) }));
      if (p.streaks != null) streaks = p.streaks ? max(4, num(p.streaks, 0.05) / h) : 0;
      if (p.fade != null) fade = max(0, num(p.fade, 0));
      // Fixed sub-steps: the fastest air (about 2.2 U) moves at most 1.3 cells a step.
      S.dt = 1 / (60 * clamp(Math.ceil((2.2 * U / h) / 60 / 1.3), 1, 16));
      Object.assign(S, { speed: U, nu, length: L, re: U * L / max(nu, 1e-12), vorticity: eps, iterations: iters });
      return S;
    };
    S.set({ speed: num(o.speed, 0.5), re: o.nu == null ? num(o.re, 100) : null, nu: o.nu, vorticity: o.vorticity, iterations: o.iterations, dye: o.dye ?? [], streaks: o.streaks ?? 0, fade: o.fade });

    // ----- the CPU solver (and the readback grid it shares with the GPU) -----
    const ws = () => (S.walls === "no-slip" ? -1 : 1), open = () => S.walls === "open";
    const A = n => new Float32Array(n);
    let C = null, lo = 0, hi = 0, tx = 0, ty = 0, WS = 1;
    const fu = (a, i, j) => { i = i < 0 ? 0 : i > nx ? nx : i; return j < 0 ? WS * a[i] : j >= ny ? WS * a[i + (ny - 1) * W] : a[i + j * W]; };
    const fv = (a, i, j) => { j = j < 0 ? 0 : j > ny ? ny : j; return i < 0 ? -a[j * W] : a[(i >= nx ? nx - 1 : i) + j * W]; };
    const fd = (a, i, j) => a[(i < 0 ? 0 : i >= nx ? nx - 1 : i) + (j < 0 ? 0 : j >= ny ? ny - 1 : j) * nx];
    const bil = (f, a, x, y) => { const i = floor(x), j = floor(y), fx = x - i, fy = y - j, a0 = f(a, i, j), a1 = f(a, i + 1, j), a2 = f(a, i, j + 1), a3 = f(a, i + 1, j + 1); lo = min(a0, a1, a2, a3); hi = max(a0, a1, a2, a3); return (a0 + (a1 - a0) * fx) * (1 - fy) + (a2 + (a3 - a2) * fx) * fy; };
    const su = (a, x, y) => bil(fu, a, x, y - 0.5), svv = (a, x, y) => bil(fv, a, x - 0.5, y), sd = (a, x, y) => bil(fd, a, x - 0.5, y - 0.5);
    const trace = (x, y, s) => { const mx = x - 0.5 * s * su(C.u, x, y), my = y - 0.5 * s * svv(C.v, x, y); tx = x - s * su(C.u, mx, my); ty = y - s * svv(C.v, mx, my); };
    const sol = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && solid[i + j * nx] === 1;
    const fluU = (i, j) => j >= 0 && j < ny && i > 0 && i <= nx && !sol(i - 1, j) && (i === nx || !sol(i, j));
    const fluV = (i, j) => i >= 0 && i < nx && j > 0 && j < ny && !sol(i, j - 1) && !sol(i, j);
    const stir = (w, x, y, k) => { for (const s of vsp) { const q = exp(-((x - s[0]) ** 2 + (y - s[1]) ** 2) / (s[2] * s[2])) * s[3], t = k ? s[5] : s[4]; w = s[7] ? w + q * t : w + (t - w) * q; } return w; };
    // Boundary faces, ghosts, and viscosity, the same as the flBnd shader.
    function fix(iu, iv, ou, ov, mode, al = 0, au = iu, av = iv) {
      const Uc = U / h, op = open();
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const k = i + j * W;
        if (j < ny) {
          const l = i > 0 && sol(i - 1, j), r = i < nx && sol(i, j);
          let w = iu[k];
          if (i === 0) w = r ? 0 : Uc;
          else if (l && r) { const a = (i - 1 + j * nx) * 4, vo = 0.5 * (sv[a + 1] + sv[a + 5]), sg = sv[a + 3] > 0.5 ? 1 : -1; let s = 0, n = 0; if (fluU(i, j - 1)) { s += iu[k - W]; n++; } if (fluU(i, j + 1)) { s += iu[k + W]; n++; } w = n ? vo + sg * (s / n - vo) : vo; }
          else if (l || r) w = sv[((l ? i - 1 : i) + j * nx) * 4 + 1];
          else if (mode) { const s = fu(iu, i - 1, j) + fu(iu, i + 1, j) + fu(iu, i, j - 1) + fu(iu, i, j + 1); w = mode === 1 ? w + al * (s - 4 * w) : (au[k] + al * s) / (1 + 4 * al); }
          ou[k] = w;
        }
        if (i < nx) {
          const t = j > 0 && sol(i, j - 1), b = j < ny && sol(i, j);
          let w = iv[k];
          if ((j === 0 || j === ny) && !op) w = 0;
          else if (t && b) { const a = (i + (j - 1) * nx) * 4, c2 = (i + j * nx) * 4, vo = 0.5 * (sv[a + 2] + sv[c2 + 2]), sg = sv[a + 3] > 0.5 ? 1 : -1; let s = 0, n = 0; if (fluV(i - 1, j)) { s += iv[k - 1]; n++; } if (fluV(i + 1, j)) { s += iv[k + 1]; n++; } w = n ? vo + sg * (s / n - vo) : vo; }
          else if (t || b) w = sv[(i + (t ? j - 1 : j) * nx) * 4 + 2];
          else if (mode) { const s = fv(iv, i - 1, j) + fv(iv, i + 1, j) + fv(iv, i, j - 1) + fv(iv, i, j + 1); w = mode === 1 ? w + al * (s - 4 * w) : (av[k] + al * s) / (1 + 4 * al); }
          ov[k] = w;
        }
      }
    }
    const swapV = () => { [C.u, C.un] = [C.un, C.u]; [C.v, C.vn] = [C.vn, C.v]; };
    // Projection on the CPU: divergence, red-black SOR, subtract the gradient. Returns max |div| before.
    function project() {
      const p = C.p, op = open();
      let worst = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = i + j * nx, q = i + j * W; C.dv[k] = solid[k] ? 0 : C.u[q + 1] - C.u[q] + C.v[q + W] - C.v[q]; worst = max(worst, abs(C.dv[k])); }
      for (let it = 0; it < 2 * iters; it++) for (let j = 0; j < ny; j++) for (let i = (j + it) & 1; i < nx; i += 2) {
        const k = i + j * nx;
        let s = 0, n = 0;
        if (solid[k]) {
          if (i > 0 && !solid[k - 1]) { s += p[k - 1]; n++; } if (i < nx - 1 && !solid[k + 1]) { s += p[k + 1]; n++; }
          if (j > 0 && !solid[k - nx]) { s += p[k - nx]; n++; } if (j < ny - 1 && !solid[k + nx]) { s += p[k + nx]; n++; }
          p[k] = n ? s / n : 0; continue;
        }
        if (i > 0 && !solid[k - 1]) { s += p[k - 1]; n++; }
        if (i < nx - 1) { if (!solid[k + 1]) { s += p[k + 1]; n++; } } else n++;
        if (j > 0) { if (!solid[k - nx]) { s += p[k - nx]; n++; } } else if (op) n++;
        if (j < ny - 1) { if (!solid[k + nx]) { s += p[k + nx]; n++; } } else if (op) n++;
        if (n) p[k] += omega * ((s - C.dv[k]) / n - p[k]);
      }
      for (let j = 0; j < ny; j++) for (let i = 1; i <= nx; i++) { if (sol(i - 1, j)) continue; const k = i + j * W; if (i === nx) C.u[k] += p[nx - 1 + j * nx]; else if (!sol(i, j)) C.u[k] -= p[i + j * nx] - p[i - 1 + j * nx]; }
      for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
        const k = i + j * W;
        if (j > 0 && j < ny) { if (!sol(i, j - 1) && !sol(i, j)) C.v[k] -= p[i + j * nx] - p[i + (j - 1) * nx]; }
        else if (op) { if (j === 0 && !sol(i, 0)) C.v[k] -= p[i]; else if (j === ny && !sol(i, ny - 1)) C.v[k] += p[i + (ny - 1) * nx]; }
      }
      fix(C.u, C.v, C.un, C.vn, 0); swapV();
      return worst;
    }
    const divergence = () => { let m = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = i + j * W; if (!solid[i + j * nx]) m = max(m, abs(C.u[q + 1] - C.u[q] + C.v[q + W] - C.v[q])); } return m; };
    function cpuStep(dt) {
      WS = ws();
      const Uc = U / h;
      // Dye, carried by the old velocity.
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = i + j * nx; trace(i + 0.5, j + 0.5, dt); for (let ch = 0; ch < 2; ch++) { C.dh[ch][k] = sd(C.d[ch], tx, ty); C.dl[ch][k] = lo; C.dH[ch][k] = hi; } }
      const fk = exp(-fade * dt);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = i + j * nx, x = i + 0.5, y = j + 0.5;
        if (solid[k]) { C.dn[0][k] = C.dn[1][k] = 0; continue; }
        trace(x, y, -dt);
        for (let ch = 0; ch < 2; ch++) C.dn[ch][k] = clamp(C.dh[ch][k] + 0.5 * (C.d[ch][k] - sd(C.dh[ch], tx, ty)), C.dl[ch][k], C.dH[ch][k]) * fk;
        for (const s of dsp) C.dn[0][k] += s[3] * exp(-((x - s[0]) ** 2 + (y - s[1]) ** 2) / (s[2] * s[2]));
        if (streaks && i < 2) C.dn[1][k] = 1 - smooth(0.35, 1.1, abs(((y / streaks) % 1) - 0.5) * streaks);
      }
      for (let ch = 0; ch < 2; ch++) [C.d[ch], C.dn[ch]] = [C.dn[ch], C.d[ch]];
      // Velocity: forward, then the corrected and clamped value, stirring, confinement.
      let wa = null;
      if (eps) { wa = A(NF); for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) wa[i + j * W] = fv(C.v, i, j) - fv(C.v, i - 1, j) - fu(C.u, i, j) + fu(C.u, i, j - 1); }
      const wn = (i, j) => wa[clamp(i, 0, nx) + clamp(j, 0, ny) * W];
      const conf = (i, j, k) => {
        let w, gx, gy;
        if (!k) { w = 0.5 * (wn(i, j) + wn(i, j + 1)); gx = 0.25 * (abs(wn(i + 1, j)) + abs(wn(i + 1, j + 1)) - abs(wn(i - 1, j)) - abs(wn(i - 1, j + 1))); gy = abs(wn(i, j + 1)) - abs(wn(i, j)); }
        else { w = 0.5 * (wn(i, j) + wn(i + 1, j)); gx = abs(wn(i + 1, j)) - abs(wn(i, j)); gy = 0.25 * (abs(wn(i, j + 1)) + abs(wn(i + 1, j + 1)) - abs(wn(i, j - 1)) - abs(wn(i + 1, j - 1))); }
        return eps * Uc * w * (k ? -gx : gy) / (hypot(gx, gy) + 1e-5);
      };
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const k = i + j * W; if (j < ny) { trace(i, j + 0.5, dt); C.uh[k] = su(C.u, tx, ty); C.ul[k] = lo; C.uH[k] = hi; } if (i < nx) { trace(i + 0.5, j, dt); C.vh[k] = svv(C.v, tx, ty); C.vl[k] = lo; C.vH[k] = hi; } }
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const k = i + j * W;
        if (j < ny) { const x = i, y = j + 0.5; trace(x, y, -dt); C.un[k] = stir(clamp(C.uh[k] + 0.5 * (C.u[k] - su(C.uh, tx, ty)), C.ul[k], C.uH[k]), x, y, 0) + (eps ? dt * conf(i, j, 0) : 0); }
        if (i < nx) { const x = i + 0.5, y = j; trace(x, y, -dt); C.vn[k] = stir(clamp(C.vh[k] + 0.5 * (C.v[k] - svv(C.vh, tx, ty)), C.vl[k], C.vH[k]), x, y, 1) + (eps ? dt * conf(i, j, 1) : 0); }
      }
      swapV();
      const al = nu / (h * h) * dt;
      if (al <= 0.2) { fix(C.u, C.v, C.un, C.vn, al > 0 ? 1 : 0, al); swapV(); }
      else {
        const n = clamp(Math.ceil(6 + 10 * sqrt(al)), 6, 40), su0 = C.u, sv0 = C.v;
        let cu = C.u, cv = C.v;
        const tu = [C.un, C.uh], tv = [C.vn, C.vh];
        for (let k = 0; k < n; k++) { fix(cu, cv, tu[k & 1], tv[k & 1], 2, al, su0, sv0); cu = tu[k & 1]; cv = tv[k & 1]; }
        const ru = [su0, C.un, C.uh].filter(a => a !== cu), rv = [sv0, C.vn, C.vh].filter(a => a !== cv);
        C.u = cu; C.v = cv; [C.un, C.uh] = ru; [C.vn, C.vh] = rv;
      }
      S.lastDiv = project();
    }

    // ----- the GPU solver -----
    const RF = 2, rx = Math.ceil(nx / RF), ry = Math.ceil(ny / RF), rb = new Float32Array(rx * ry * 4);
    let rbAt = -1;
    function gpuInit() {
      const T = (w, hh) => ftex(w, hh);
      G = { V: T(W, ny + 1), V1: T(W, ny + 1), V2: T(W, ny + 1), Wn: T(W, ny + 1), P: T(nx, ny), P1: T(nx, ny), Dv: T(nx, ny), D: T(nx, ny), D1: T(nx, ny), D2: T(nx, ny), S: T(nx, ny), RB: T(rx, ry), gl: R.gl };
      for (const n of ["flDye1", "flDye2", "flAdv1", "flAdv2", "flBnd", "flDiv", "flSor", "flProj", "flRead", "flShow"]) if (!program(n)) throw new Error(`${n} shader failed`);
      upload(G.S, sv);
    }
    const packSplats = list => ({ uSp: padTo(list.flatMap(s => [s[0], s[1], s[2], s[3]]), 32), uSv: padTo(list.flatMap(s => [s[4], s[5], s[6], s[7]]), 32), uNs: min(8, list.length) });
    function gpuStep(dt) {
      const base = { uS: G.S, uN: [nx, ny], uWs: ws(), uDt: dt, uOpen: open() ? 1 : 0 };
      if (eps) pass("flCurl", G.Wn, { ...base, uV: G.V });
      pass("flDye1", G.D2, { ...base, uV: G.V, uD: G.D });
      pass("flDye2", G.D1, { ...base, uV: G.V, uD: G.D, uH: G.D2, ...packSplats(dsp.map(s => [s[0], s[1], s[2], 0, 0, 0, s[3], 0])), uStk: streaks, uFade: exp(-fade * dt) });
      [G.D, G.D1] = [G.D1, G.D];
      pass("flAdv1", G.V2, { ...base, uV: G.V });
      pass("flAdv2", G.V1, { ...base, uV: G.V, uH: G.V2, uW: G.Wn, uEps: eps, uUc: U / h, ...packSplats(vsp) });
      [G.V, G.V1] = [G.V1, G.V];
      const al = nu / (h * h) * dt, bu = { ...base, uIn: U / h, uAl: al };
      if (al <= 0.2) { pass("flBnd", G.V1, { ...bu, uV: G.V, uA: G.V, uMode: al > 0 ? 1 : 0 }); [G.V, G.V1] = [G.V1, G.V]; }
      else {
        const n = clamp(Math.ceil(6 + 10 * sqrt(al)), 6, 40), star = G.V, tg = [G.V1, G.V2];
        let cur = G.V;
        for (let k = 0; k < n; k++) { pass("flBnd", tg[k & 1], { ...bu, uV: cur, uA: star, uMode: 2 }); cur = tg[k & 1]; }
        [G.V1, G.V2] = [star, G.V1, G.V2].filter(T => T !== cur); G.V = cur;
      }
      pass("flDiv", G.Dv, { ...base, uV: G.V });
      for (let k = 0; k < 2 * iters; k++) { pass("flSor", G.P1, { ...base, uP: G.P, uDv: G.Dv, uColor: k & 1, uOm: omega }); [G.P, G.P1] = [G.P1, G.P]; }
      pass("flProj", G.V1, { ...base, uV: G.V, uP: G.P }); [G.V, G.V1] = [G.V1, G.V];
      pass("flBnd", G.V1, { ...bu, uV: G.V, uA: G.V, uMode: 0 }); [G.V, G.V1] = [G.V1, G.V];
    }
    // The velocity grid the CPU reads (arrows, particles, probes): GPU readback or the CPU arrays.
    // Without WebGPU the readback goes through a pixel buffer and a fence, so the CPU picks it up
    // when the GPU is done instead of waiting on every queued step; the field is then about a
    // frame old, which arrows, probes and the picture don't show. It stays exact while the page
    // checker runs and when particles ride the fluid.
    let rbq = null;
    function readAsync() {
      const gl = R.gl;
      if (rbq && rbq.gl !== gl) rbq = null;
      if (rbq?.fence) {
        const st = gl.clientWaitSync(rbq.fence, 0, 0);
        if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
          if (rbq.at > rbAt) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, rbq.pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, rb); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); rbAt = rbq.at; }
          gl.deleteSync(rbq.fence); rbq.fence = null;
        }
      }
      if (rbAt === serial) return true;
      if (!rbq?.fence) {
        if (!rbq) { rbq = { gl, pbo: gl.createBuffer(), fence: null, at: -1 }; gl.bindBuffer(gl.PIXEL_PACK_BUFFER, rbq.pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, rb.byteLength, gl.STREAM_READ); }
        pass("flRead", G.RB, { uS: G.S, uN: [nx, ny], uWs: ws(), uV: G.V, uP: G.P, uF: RF, uHm: h });
        gl.bindFramebuffer(gl.FRAMEBUFFER, G.RB.fb); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, rbq.pbo);
        gl.readPixels(0, 0, G.RB.w, G.RB.h, gl.RGBA, gl.FLOAT, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        rbq.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); rbq.at = serial; gl.flush();
      }
      return rbAt >= 0;
    }
    function field() {
      if (rbAt === serial) return rb;
      if (G && !S._sync && !document.documentElement.classList.contains("safis-checking") && readAsync()) return rb;
      if (G) { pass("flRead", G.RB, { uS: G.S, uN: [nx, ny], uWs: ws(), uV: G.V, uP: G.P, uF: RF, uHm: h }); readTex(G.RB, rb); }
      else { WS = ws(); for (let J = 0; J < ry; J++) for (let I = 0; I < rx; I++) { const x = (I + 0.5) * RF, y = (J + 0.5) * RF, k = (I + J * rx) * 4, c = min(nx - 1, floor(x)) + min(ny - 1, floor(y)) * nx; rb[k] = su(C.u, x, y) * h; rb[k + 1] = svv(C.v, x, y) * h; rb[k + 2] = solid[c]; rb[k + 3] = C.p[c]; } }
      rbAt = serial;
      return rb;
    }
    const sample = (x, y) => {
      const f = field(), X = clamp(x / (h * RF) - 0.5, 0, rx - 1), Y = clamp(y / (h * RF) - 0.5, 0, ry - 1), i = min(floor(X), rx - 2), j = min(floor(Y), ry - 2), fx = X - i, fy = Y - j, out = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) { const a = f[(i + j * rx) * 4 + c], b = f[(i + 1 + j * rx) * 4 + c], d = f[(i + (j + 1) * rx) * 4 + c], e = f[(i + 1 + (j + 1) * rx) * 4 + c]; out[c] = (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy; }
      return out;
    };

    function init() {
      if (maskDirty) rasterize();
      const u0 = A(NF), v0 = A(NF), Uc = U / h;
      for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) u0[i + j * W] = Uc;
      WS = ws();
      if (G) {
        const d = A(NF * 4);
        C = { u: u0, v: v0, un: A(NF), vn: A(NF) };
        fix(u0, v0, C.un, C.vn, 0);
        for (let k = 0; k < NF; k++) { d[k * 4] = C.un[k]; d[k * 4 + 1] = C.vn[k]; }
        upload(G.V, d);
        for (const T of [G.P, G.D]) upload(T, A(NC * 4));
        if (X) { X.Q.flush(); X.d.queue.writeBuffer(X.V, 0, d); X.d.queue.writeBuffer(X.P, 0, A(NC * 4)); X.d.queue.writeBuffer(X.D, 0, A(NC * 4)); X.at = 0; }
        C = null;
      } else {
        C = { u: u0, v: v0, uh: A(NF), vh: A(NF), un: A(NF), vn: A(NF), ul: A(NF), uH: A(NF), vl: A(NF), vH: A(NF), p: A(NC), dv: A(NC), d: [A(NC), A(NC)], dh: [A(NC), A(NC)], dn: [A(NC), A(NC)], dl: [A(NC), A(NC)], dH: [A(NC), A(NC)] };
        fix(C.u, C.v, C.un, C.vn, 0); swapV();
      }
      kicked = false; hist = []; serial++;
    }
    const save = () => X ? (X.chk ??= { V: xBuf(X.d, NF * 16, GPUBufferUsage.STORAGE), P: xBuf(X.d, NC * 16, GPUBufferUsage.STORAGE), D: xBuf(X.d, NC * 16, GPUBufferUsage.STORAGE) }, X.Q.copy([[X.V, X.chk.V], [X.P, X.chk.P], [X.D, X.chk.D]]), { kicked, hist: hist.slice() })
      : G ? (G.chk ??= { V: ftex(W, ny + 1), P: ftex(nx, ny), D: ftex(nx, ny) }, copyTex(G.V, G.chk.V), copyTex(G.P, G.chk.P), copyTex(G.D, G.chk.D), { kicked, hist: hist.slice() })
      : { kicked, hist: hist.slice(), u: C.u.slice(), v: C.v.slice(), p: C.p.slice(), d: C.d.map(a => a.slice()) };
    const load = k => { if (X) X.Q.copy([[X.chk.V, X.V], [X.chk.P, X.P], [X.chk.D, X.D]]); else if (G) { copyTex(k.V ?? G.chk.V, G.V); copyTex(G.chk.P, G.P); copyTex(G.chk.D, G.D); } else { C.u.set(k.u); C.v.set(k.v); C.p.set(k.p); C.d.forEach((a, i) => a.set(k.d[i])); } kicked = k.kicked; hist = k.hist.slice(); serial++; };
    function stepOnce(dt) {
      if (G && G.gl !== context()?.gl) { gpuInit(); init(); }   // the context was lost and came back: start again from rest
      for (const q of S.obstacles) if (q._v && S.time - q._mt > 0.06) { q._v = null; maskDirty = true; }
      if (maskDirty) rasterize();
      // A nudge across the wake early on, so a symmetric body sheds as a real one does (from noise).
      if (!kicked && S.time >= 0.3 && bodies[0] && o.kick !== false) {
        kicked = true; const b = bodies[0].box, D = (b[3] - b[1]) / h;
        vsp.push([b[2] / h + 0.6 * D, (b[1] + b[3]) / 2 / h, 0.5 * D, 1, 0, 0.35 * U / h, 0, 1]);
      }
      dsp = sources.map(s => [s.x, s.y, s.r, s.rate * dt]).concat(dsp.filter(s => s[4]).map(s => [s[0], s[1], s[2], s[3]]));
      if (X) xStep(dt); else if (G) gpuStep(dt); else cpuStep(dt);
      vsp = []; dsp = []; serial++;
      if (probe && (hist.length === 0 || S.time + dt - hist[hist.length - 1][0] > 1 / 61)) { hist.push([S.time + dt, sample(probe[0], probe[1])[1]]); if (hist.length > 900) hist.shift(); }
    }
    // ----- the WebGPU solver: the GPU passes as compute (webgpu section). The WebGL2 textures
    // become a mirror of its state, which g.fx draws and the readback grid reads. A fluid that
    // something reads every step (tracked shedding, particles it carries) stays on WebGL2. -----
    function xStep(dt) {
      const { Q, p } = X, ws0 = ws(), op = open() ? 1 : 0, fw = xWg(nx + 1), fh = xWg(ny + 1), cw = xWg(nx), ch = xWg(ny);
      const base = b => { Q.i[b] = nx; Q.i[b + 1] = ny; Q.f[b + 2] = ws0; Q.f[b + 3] = dt; Q.i[b + 4] = op; };
      const splats = (b, list) => { const n = min(8, list.length); Q.i[b + 7] = n; for (let k = 0; k < n; k++) { Q.f.set(list[k].slice(0, 4), b + 16 + k * 4); Q.f.set(list[k].slice(4, 8), b + 48 + k * 4); } };
      if (eps) Q.run(p.curlk, base, [X.S, X.V, null, null, X.Wn], fw, fh);
      Q.run(p.dye1, base, [X.S, X.V, X.D, null, X.D2], cw, ch);
      Q.run(p.dye2, b => { base(b); splats(b, dsp.map(s => [s[0], s[1], s[2], 0, 0, 0, s[3], 0])); Q.f[b + 12] = streaks; Q.f[b + 13] = exp(-fade * dt); }, [X.S, X.V, X.D, X.D2, X.D1], cw, ch);
      [X.D, X.D1] = [X.D1, X.D];
      Q.run(p.adv1, base, [X.S, X.V, null, null, X.V2], fw, fh);
      Q.run(p.adv2, b => { base(b); splats(b, vsp); Q.f[b + 10] = eps; Q.f[b + 11] = U / h; }, [X.S, X.V, X.V2, X.Wn, X.V1], fw, fh);
      [X.V, X.V1] = [X.V1, X.V];
      const al = nu / (h * h) * dt, bu = (b, mode) => { base(b); Q.i[b + 5] = mode; Q.f[b + 8] = al; Q.f[b + 9] = U / h; };
      if (al <= 0.2) { Q.run(p.bnd, b => bu(b, al > 0 ? 1 : 0), [X.S, X.V, X.V, null, X.V1], fw, fh); [X.V, X.V1] = [X.V1, X.V]; }
      else {
        const n = clamp(Math.ceil(6 + 10 * sqrt(al)), 6, 40), star = X.V, tg = [X.V1, X.V2];
        let cur = X.V;
        for (let k = 0; k < n; k++) { Q.run(p.bnd, b => bu(b, 2), [X.S, cur, star, null, tg[k & 1]], fw, fh); cur = tg[k & 1]; }
        [X.V1, X.V2] = [star, X.V1, X.V2].filter(T => T !== cur); X.V = cur;
      }
      Q.run(p.divk, base, [X.S, X.V, null, null, X.Dv], cw, ch);
      for (let k = 0; k < 2 * iters; k++) Q.run(p.sor, b => { base(b); Q.i[b + 6] = k & 1; Q.f[b + 14] = omega; }, [X.S, X.Dv, null, null, X.P], cw, ch);
      Q.run(p.proj, base, [X.S, X.V, X.P, null, X.V1], fw, fh); [X.V, X.V1] = [X.V1, X.V];
      Q.run(p.bnd, b => bu(b, 0), [X.S, X.V, X.V, null, X.V1], fw, fh); [X.V, X.V1] = [X.V1, X.V];
    }
    // Before stepping: onto WebGPU (the current state copied over from the WebGL2 textures), or
    // back off it (start again, which gives the same frames).
    function xCheck() {
      const d = G && !probe && !S._sync && !XBAD.fluid && pick(o) === "webgpu" ? WG.use(forced(o)) : null;
      if (X && X.d === d) return;
      if (X) { const old = X; X = null; old.destroy(); rawReset(); }
      if (!d) return;
      const Q = xQueue(d, 512), B = n => xBuf(d, n * 16, GPUBufferUsage.STORAGE), from = T => readTex(T, new Float32Array(T.w * T.h * 4));
      const p = Object.fromEntries(["curlk", "dye1", "dye2", "adv1", "adv2", "bnd", "divk", "sor", "proj"].map(e => [e, xPipe(Q.K, "fluid", XFL, e)]));
      X = { d, Q, p, V: B(NF), V1: B(NF), V2: B(NF), Wn: B(NF), P: B(NC), Dv: B(NC), D: B(NC), D1: B(NC), D2: B(NC), S: B(NC), chk: null, at: S.time, req: -1 };
      d.queue.writeBuffer(X.S, 0, sv);
      d.queue.writeBuffer(X.V, 0, from(G.V)); d.queue.writeBuffer(X.P, 0, from(G.P)); d.queue.writeBuffer(X.D, 0, from(G.D));
      if (G.chk && S.chk) { X.chk = { V: B(NF), P: B(NC), D: B(NC) }; for (const k of ["V", "P", "D"]) d.queue.writeBuffer(X.chk[k], 0, from(G.chk[k])); }
      const me = X;
      X.M = xMirror(Q, [NF * 16, NC * 16, NC * 16], ([v, pp, dd], t) => { if (X !== me || !G) return; upload(G.V, v); upload(G.P, pp); upload(G.D, dd); X.at = t; rbAt = -1; });
      X.destroy = () => { me.Q.flush(); me.M.destroy(); for (const b of [me.V, me.V1, me.V2, me.Wn, me.P, me.Dv, me.D, me.D1, me.D2, me.S, ...Object.values(me.chk || {})]) b.destroy(); };
    }
    const xAfter = () => { if (X && X.req !== serial) { X.req = serial; X.M.request(() => [X.V, X.P, X.D], () => S.time); } };
    try { if (want) gpuInit(); } catch (e) { G = null; errors.push(`fluid: ${e.message}`); }
    S.gpu = !!G;
    clock(S, stepOnce, save, load, init);
    const rawReset = xClock(S, xCheck, xAfter);
    S.sync = () => (X ? (xAfter(), X.M.sync()) : Promise.resolve());
    Object.defineProperty(S, "backend", { get: () => (X ? "webgpu" : G ? "webgl2" : "cpu"), enumerable: true });

    // ----- what figures call -----
    S.velocity = q => { const s = sample(q[0], q[1]); return [s[0], s[1]]; };
    S.sample = q => { const s = sample(q[0], q[1]); return { u: s[0], v: s[1], speed: hypot(s[0], s[1]), solid: s[2] > 0.5, p: s[3] }; };
    S.solidAt = q => { const i = floor(q[0] / h), j = floor(q[1] / h); return i >= 0 && j >= 0 && i < nx && j < ny && solid[i + j * nx] === 1; };
    S.bodies = () => { if (maskDirty) rasterize(); return bodies; };
    S.update = () => { maskDirty = true; return S; };
    S.move = (i, at) => {
      const q = S.obstacles[i];
      if (!q) return S;
      const t = S.time;
      if (q._mt != null && t > q._mt + 1e-9) q._v = [(at[0] - q.at[0]) / (t - q._mt), (at[1] - q.at[1]) / (t - q._mt)].map(v => clamp(v, -4 * U - 1, 4 * U + 1));
      q.at = [at[0], at[1]]; q._mt = t; maskDirty = true;
      return S;
    };
    // Stir along a stroke from a to b (m): the air there takes the stroke's speed and gets dye.
    S.stir = (a, b, k = {}) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], r = num(k.radius, max(3 * h, 0.04 * dom[1])) / h, n = clamp(Math.ceil(hypot(dx, dy) / h / max(r, 1)), 1, 4), sp = num(k.speed, 60);
      const vx = clamp(dx * sp, -6 * U - 1, 6 * U + 1) / h, vy = clamp(dy * sp, -6 * U - 1, 6 * U + 1) / h;
      for (let i = 1; i <= n && vsp.length < 8; i++) { const x = (a[0] + dx * i / n) / h, y = (a[1] + dy * i / n) / h; vsp.push([x, y, r, cn(k.strength, 0.8, 0, 1), vx, vy, 0, 0]); if (k.dye !== false) dsp.push([x, y, r * 0.8, num(k.dye, 1.5) / n, 1]); }
      return S;
    };
    S.inject = (at, k = {}) => { dsp.push([at[0] / h, at[1] / h, num(k.radius, 2 * h) / h, num(k.amount, 1.5), 1]); return S; };
    S.paint = (at, r, on = true) => {
      const R0 = r / h, ci = at[0] / h, cj = at[1] / h;
      for (let j = max(0, floor(cj - R0)); j <= min(ny - 1, Math.ceil(cj + R0)); j++) for (let i = max(0, floor(ci - R0)); i <= min(nx - 1, Math.ceil(ci + R0)); i++) if ((i + 0.5 - ci) ** 2 + (j + 0.5 - cj) ** 2 <= R0 * R0) paint[i + j * nx] = on ? 1 : 0;
      maskDirty = true;
      return S;
    };
    S.clearPaint = () => { paint.fill(0); maskDirty = true; return S; };
    S.toWorld = p => toWorld(S, p);
    S.toScreen = q => toScreen(S, q);
    S.hit = (p, pad0 = 8) => { const q = toWorld(S, p), m = S.view ? pad0 / S.view[2] * dom[0] : 0; return S.bodies().findIndex((b, i) => S.obstacles[i].fixed !== true && surfaceOf(b, q[0], q[1])[0] < m); };
    // A drag spec for demo(): drag a body to move it, or anywhere else to stir.
    let grab = -1, last = null, off = [0, 0];
    S.interact = {
      live: true,
      start(p) { grab = S.hit(p); const q = toWorld(S, p); last = q; if (grab >= 0) { const at = S.obstacles[grab].at ?? [0, 0]; off = [at[0] - q[0], at[1] - q[1]]; } },
      move(p) { const q = toWorld(S, p); if (grab >= 0) S.move(grab, [clamp(q[0] + off[0], 0, dom[0]), clamp(q[1] + off[1], 0, dom[1])]); else if (last) S.stir(last, q); last = q; },
      end() { grab = -1; last = null; },
    };
    S.track = (at) => {
      const b = bodies[0]?.box;
      probe = at ?? (b ? [min(dom[0] - h, b[2] + (b[3] - b[1])), (b[1] + b[3]) / 2] : [dom[0] * 0.6, dom[1] / 2]);
      return S;
    };
    // Shedding: the frequency of the cross-stream velocity behind the body (rising zero crossings).
    S.shedding = () => {
      if (!probe) S.track();
      const H = hist.filter(q => q[0] > S.time - 12);
      if (H.length < 30) return { frequency: 0, strouhal: 0, samples: H.length };
      const mean = H.reduce((s, q) => s + q[1], 0) / H.length, amp = max(...H.map(q => abs(q[1] - mean))), ups = [];
      for (let i = 1; i < H.length; i++) if (H[i - 1][1] - mean < 0 && H[i][1] - mean >= 0) { const a = H[i - 1], b = H[i], f = (mean - a[1]) / (b[1] - a[1]); ups.push(a[0] + f * (b[0] - a[0])); }
      const f = ups.length > 2 && amp > 0.02 * U ? (ups.length - 1) / (ups[ups.length - 1] - ups[0]) : 0;
      return { frequency: f, strouhal: f * L / max(U, 1e-9), amplitude: amp, samples: H.length };
    };
    S.divergence = () => (C ? divergence() : null);
    S.project = () => { if (!C) return null; WS = ws(); fix(C.u, C.v, C.un, C.vn, 0); swapV(); return project(); };
    if (o.track) S.track();
    S._cpu = () => C;
    S.showUniforms = (box, k) => ({ uV: G.V, uS: G.S, uP: G.P, uD: G.D, uN: [nx, ny], uWs: ws(), uOpen: open() ? 1 : 0, uBox: [box[2], box[3]], uHm: h, uCpK: 2 / (S.dt * (U / h) ** 2 || 1), uWk: L / max(U, 1e-9), ...k });
    // Without a GPU: the same picture from the CPU arrays, on a grid twice as fine.
    S.paintCPU = (c, box, k) => {
      if (G) field();
      const cw = nx * 2, ch = ny * 2, img = new ImageData(cw, ch), Uc = U / h, cpK = 2 / (S.dt * Uc * Uc || 1), stops = k.map ? cmapStops(k.map) : null;
      WS = ws();
      let pref = 0;
      if (C) { for (let j = 0; j < ny; j++) pref += C.p[1 + j * nx]; pref /= ny; }
      for (let b = 0; b < ch; b++) for (let a = 0; a < cw; a++) {
        const x = (a + 0.5) / 2, y = (b + 0.5) / 2, ci = min(nx - 1, floor(x)) + min(ny - 1, floor(y)) * nx;
        let val = 0, col;
        if (C) {
          if (k.mode === 0) val = hypot(su(C.u, x, y), svv(C.v, x, y)) * h;
          else if (k.mode === 1) val = (sd(C.p, x, y) - pref) * cpK;
          else if (k.mode === 2) val = (svv(C.v, x + 0.5, y) - svv(C.v, x - 0.5, y) - su(C.u, x, y + 0.5) + su(C.u, x, y - 0.5)) * k.wk;
        } else { const s = sample(x * h, y * h); val = k.mode === 0 ? hypot(s[0], s[1]) : k.mode === 1 ? (s[3] - field()[3]) * cpK : 0; }
        if (k.mode === 3 || !stops) col = k.paper; else { const t = clamp((val - k.lo) / (k.hi - k.lo), 0, 1) * 15, i = min(floor(t), 14); col = mixc(stops[i], stops[i + 1], t - i); }
        if (C) { col = mixc(col, k.dye, (1 - exp(-max(sd(C.d[0], x, y), 0) * k.dyeK)) * 0.92); col = mixc(col, k.stk, clamp(sd(C.d[1], x, y), 0, 1) * k.stkK); }
        if (solid[ci]) col = k.body;
        img.data.set([col[0] * 255, col[1] * 255, col[2] * 255, 255], (a + b * cw) * 4);
      }
      gridCanvas ??= document.createElement("canvas");
      gridCanvas.width = cw; gridCanvas.height = ch;
      gridCanvas.getContext("2d").putImageData(img, 0, 0);
      c.imageSmoothingEnabled = true;
      c.drawImage(gridCanvas, box[0], box[1], box[2], box[3]);
    };
    return S;
  }

  // ---------- waves: the surface of water, simulated ----------
  // Height h and its rate v on a grid, stepped symplectically: v += dt (c² ∇²h - s ∇⁴h - γ v + forcing),
  // h += dt v. c is the wave speed (sqrt(g depth) for shallow water); s = (σ/ρ) depth adds the
  // capillary term, so short ripples outrun long ones and a pebble's packet spreads into a train
  // of rings. Walls are cells with no flux through them (they reflect); a sponge layer along the
  // edges soaks up what reaches it. Heights are kept in cells.
  const WAV = `
uniform sampler2D uHt, uM; uniform ivec2 uN;
float hn(ivec2 c, float h0, int k) { if (c.x < 0 || c.y < 0 || c.x >= uN.x || c.y >= uN.y || texelFetch(uM, c, 0).x > 0.5) return h0; return texelFetch(uHt, c, 0)[k]; }
float lap(ivec2 c, int k) { float h0 = texelFetch(uHt, c, 0)[k]; return hn(c + ivec2(1, 0), h0, k) + hn(c - ivec2(1, 0), h0, k) + hn(c + ivec2(0, 1), h0, k) + hn(c - ivec2(0, 1), h0, k) - 4.0 * h0; }
vec4 bl(sampler2D t, vec2 p) { p -= 0.5; ivec2 i = ivec2(floor(p)); vec2 f = p - vec2(i); ivec2 m = uN - 1;
  return mix(mix(texelFetch(t, clamp(i, ivec2(0), m), 0), texelFetch(t, clamp(i + ivec2(1, 0), ivec2(0), m), 0), f.x), mix(texelFetch(t, clamp(i + ivec2(0, 1), ivec2(0), m), 0), texelFetch(t, clamp(i + 1, ivec2(0), m), 0), f.x), f.y); }
`;
  // The water surface for the pool and caustics shaders, from the simulated heights.
  const WSURF = WAV + `uniform sampler2D uG1, uG2; uniform float uPx, uAmp;
void surf(vec2 p, out vec3 a, out vec3 b) { vec2 q = p / uPx; vec4 g = bl(uG1, q), k = bl(uG2, q); a = vec3(g.x * uPx, g.y, g.z); b = k.xyz / uPx; }
vec2 sp() { return px(); }
`;
  Object.assign(FS, {
    waLap: WAV + `void main() { ivec2 c = ivec2(gl_FragCoord.xy); vec4 w = texelFetch(uHt, c, 0); o = vec4(w.xy, lap(c, 0), 0.0); }`,
    waStep: WAV + `uniform float uDt, uC2, uS4, uT0; uniform vec4 uSa[8], uSb[8], uSc[8], uDr[4]; uniform int uNsrc, uNd;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); vec4 w = texelFetch(uHt, c, 0), m = texelFetch(uM, c, 0); vec2 x = vec2(c) + 0.5;
  if (m.x > 0.5) { o = vec4(0.0); return; }
  float a = uC2 * lap(c, 0);
  if (uS4 > 0.0) a -= uS4 * lap(c, 2);
  for (int k = 0; k < 8; k++) {
    if (k >= uNsrc) break;
    vec2 A = uSa[k].xy, B = uSa[k].zw, d = x - A, e = B - A; float t = clamp(dot(d, e) / max(dot(e, e), 1e-6), 0.0, 1.0), r2 = dot(d - e * t, d - e * t), age = uT0 - uSc[k].x;
    if (age > 0.0) a += uSb[k].x * exp(-r2 / (uSb[k].w * uSb[k].w)) * sin(uSb[k].y * uT0 + uSb[k].z) * smoothstep(0.0, uSc[k].z, age) * exp(-age / uSc[k].y);
  }
  float v = (w.y + uDt * a) * exp(-m.y * uDt), h = (w.x + uDt * v) * exp(-m.z * uDt);
  for (int k = 0; k < 4; k++) { if (k >= uNd) break; vec2 d = x - uDr[k].xy; h -= uDr[k].w * exp(-dot(d, d) / (uDr[k].z * uDr[k].z)); }
  o = vec4(h, v, w.z, 0.0);
}`,
    waG1: WAV + `void main() { ivec2 c = ivec2(gl_FragCoord.xy); float h = texelFetch(uHt, c, 0).x; o = vec4(h, 0.5 * (hn(c + ivec2(1, 0), h, 0) - hn(c - ivec2(1, 0), h, 0)), 0.5 * (hn(c + ivec2(0, 1), h, 0) - hn(c - ivec2(0, 1), h, 0)), 0.0); }`,
    waG2: WAV + `void main() { ivec2 c = ivec2(gl_FragCoord.xy), e = ivec2(1, 0), f = ivec2(0, 1); float h = texelFetch(uHt, c, 0).x;
  o = vec4(hn(c + e, h, 0) + hn(c - e, h, 0) - 2.0 * h, 0.25 * (hn(c + e + f, h, 0) - hn(c + e - f, h, 0) - hn(c - e + f, h, 0) + hn(c - e - f, h, 0)), hn(c + f, h, 0) + hn(c - f, h, 0) - 2.0 * h, 0.0); }`,
    // Height through a diverging map (paper at rest), walls in ink.
    waHeight: WAV + `uniform vec2 uBox; uniform float uRange; uniform vec3 uLo, uMid, uHi, uWall; uniform vec3 uCm[16]; uniform int uUseCm;
void main() {
  vec2 x = px() / uBox * vec2(uN); vec4 g = bl(uHt, x); float t = clamp(g.x / uRange, -1.0, 1.0);
  vec3 col;
  if (uUseCm == 1) { float s = (t * 0.5 + 0.5) * 15.0; int i = min(int(s), 14); col = mix(uCm[i], uCm[i + 1], s - float(i)); }
  else col = mix(uMid, t > 0.0 ? uHi : uLo, pow(abs(t), 0.8) * 0.9);
  o = vec4(mix(col, uWall, smoothstep(0.3, 0.7, bl(uM, x).x)), 1.0);
}`,
  });
  // The pool and its floor light reuse the water and caustics shaders over the simulated surface.
  FS.wavePool = WSURF + FS.water.slice(SURF.length);
  FS.waveFloor = WSURF + FS.caustics.slice(SURF.length);

  function waves(o = {}) {
    const dom = o.domain ?? [1.6, 1];
    if (!(dom[0] > 0 && dom[1] > 0)) throw new Error("Fx.waves: domain should be [width, height] in m, such as [1.6, 1]");
    const want = pick(o) !== "cpu" && !!floatGL(gpuForced(o));
    const ny = max(8, Math.round(num(want ? o.cells : o.cpuCells, want ? 160 : 72))), h = dom[1] / ny, nx = max(8, Math.round(dom[0] / h)), NC = nx * ny;
    const S = { isWaves: true, domain: dom, grid: [nx, ny], h, view: null, walls: [], sources: [] };
    const wall = new Uint8Array(NC), M = new Float32Array(NC * 4);
    let G = null, X = null, c = 0.3, s4 = 0, damp = 0.15, edges = "absorb", sponge = 0, drops = [], pre = [], serial = 0, dirty = true, depth = null;
    let tension = 0;
    S.set = (p = {}) => {
      const g = num(o.gravity, 9.81);
      if (p.tension != null) tension = max(0, num(p.tension, 0));
      if (p.speed != null) { c = max(1e-4, num(p.speed, 0.3)); depth = null; }
      else if (p.depth != null) { depth = max(1e-5, num(p.depth, 0.01)); c = sqrt(g * depth); }
      s4 = tension * (depth ?? c * c / g);
      if (p.damping != null) { damp = max(0, num(p.damping, 0.15)); dirty = true; }
      if (p.edges != null) { edges = p.edges === "reflect" ? "reflect" : "absorb"; dirty = true; }
      if (p.sponge != null) { sponge = max(0, num(p.sponge, 0)); dirty = true; }
      if (p.walls) { S.walls = p.walls; dirty = true; }
      if (p.sources) S.sources = p.sources;
      // Stable for ω_max dt < 2 (symplectic Euler); ω_max² = 8 c²/h² + 64 s/h⁴.
      const cc = c / h, sc = s4 / h ** 4, wm = sqrt(8 * cc * cc + 64 * sc);
      S.dt = 1 / (60 * clamp(Math.ceil(wm / 1.6 / 60), 1, 64));
      Object.assign(S, { speed: c, depth, tension, damping: damp, edges });
      return S;
    };
    S.set({ speed: o.speed, depth: o.speed == null ? num(o.depth, 0.01) : null, tension: num(o.tension, 0), damping: o.damping ?? 0.15, edges: o.edges ?? "absorb", sponge: o.sponge ?? 0.1 * min(dom[0], dom[1]), walls: o.walls ?? [], sources: o.sources ?? [] });
    // Walls: segments { from, to, width }, polylines { points, width }, or solid { polygon }.
    function rasterize() {
      wall.fill(0);
      const segs = [], polys = [];
      for (const q of S.walls) {
        if (q.polygon) polys.push(q.polygon);
        else { const pts = q.points ?? [q.from, q.to], w = max(num(q.width, 0), 1.2 * h) / 2; for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i], w]); if (q.close && pts.length > 2) segs.push([pts[pts.length - 1], pts[0], w]); }
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * h, y = (j + 0.5) * h;
        let on = polys.some(p => inPoly(p, x, y));
        for (const [a, b, w] of segs) { if (on) break; const ex = b[0] - a[0], ey = b[1] - a[1], t = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1e-18), 0, 1); on = hypot(x - a[0] - ex * t, y - a[1] - ey * t) <= w; }
        wall[i + j * nx] = on ? 1 : 0;
      }
      // The sponge: damping rising as the square of depth into the edge band, strong enough to
      // soak up a wave crossing it once.
      const Wd = max(2, sponge / h), gmax = edges === "absorb" ? 3.2 * (c / h) / Wd : 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = i + j * nx, d = min(i, j, nx - 1 - i, ny - 1 - j), s = d < Wd ? gmax * ((Wd - d) / Wd) ** 2 : 0;
        M[k * 4] = wall[k]; M[k * 4 + 1] = damp + s; M[k * 4 + 2] = s * 0.5; M[k * 4 + 3] = 0;
      }
      dirty = false;
      if (G) upload(G.M, M);
      if (X) { X.Q.flush(); X.d.queue.writeBuffer(X.M, 0, M); }
    }
    // A source's strength so its waves are `amp` high one wavelength out (2D Green's function), or
    // `amp` high everywhere for a line source (1D).
    const srcU = t => {
      const list = S.sources.slice(0, 8).map(q => {
        const f = max(0.01, num(q.freq, 4)), w = TAU * f, k = w / c * h, r = max(0.8, num(q.r, 1.5 * h) / h), a = num(q.amp, 0.002) / h, cc = (c / h) ** 2;
        const A0 = q.at, B0 = q.to ?? q.at, len = hypot(B0[0] - A0[0], B0[1] - A0[1]) / h, g = exp(min(k * k * r * r / 4, 8));
        const F = len > 2 * PI / k ? 2 * k * a * cc / (r * sqrt(PI)) * g : 4 * a * cc / (r * r) * g;
        return [[A0[0] / h, A0[1] / h, B0[0] / h, B0[1] / h], [F, w, num(q.phase, PI / 2), r], [num(q.start, 0), max(1e-3, num(q.dur, 1e9)), 1 / f, 0]];
      });
      return { uSa: padTo(list.flatMap(q => q[0]), 32), uSb: padTo(list.flatMap(q => q[1]), 32), uSc: padTo(list.flatMap(q => q[2]), 32), uNsrc: list.length, uT0: t };
    };
    let C = null;
    function cpuStep(dt) {
      const { uSa, uSb, uSc, uNsrc } = srcU(S.time + dt), cc = (c / h) ** 2, sc = s4 / h ** 4, hh = C.h, v = C.v, Lh = C.L;
      const nb = (a, i, j, a0) => (i < 0 || j < 0 || i >= nx || j >= ny || wall[i + j * nx] ? a0 : a[i + j * nx]);
      const lap = (a, i, j) => { const a0 = a[i + j * nx]; return nb(a, i + 1, j, a0) + nb(a, i - 1, j, a0) + nb(a, i, j + 1, a0) + nb(a, i, j - 1, a0) - 4 * a0; };
      if (sc) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) Lh[i + j * nx] = lap(hh, i, j);
      const T0 = S.time + dt;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = i + j * nx;
        if (wall[k]) { C.hn[k] = C.vn[k] = 0; continue; }
        let a = cc * lap(hh, i, j) - (sc ? sc * lap(Lh, i, j) : 0);
        const x = i + 0.5, y = j + 0.5;
        for (let q = 0; q < uNsrc; q++) {
          const ax = uSa[q * 4], ay = uSa[q * 4 + 1], ex = uSa[q * 4 + 2] - ax, ey = uSa[q * 4 + 3] - ay, t = clamp(((x - ax) * ex + (y - ay) * ey) / max(ex * ex + ey * ey, 1e-6), 0, 1), r2 = (x - ax - ex * t) ** 2 + (y - ay - ey * t) ** 2, age = T0 - uSc[q * 4];
          if (age > 0) a += uSb[q * 4] * exp(-r2 / uSb[q * 4 + 3] ** 2) * sin(uSb[q * 4 + 1] * T0 + uSb[q * 4 + 2]) * smooth(0, uSc[q * 4 + 2], age) * exp(-age / uSc[q * 4 + 1]);
        }
        const vv = (v[k] + dt * a) * exp(-M[k * 4 + 1] * dt);
        let hv = (hh[k] + dt * vv) * exp(-M[k * 4 + 2] * dt);
        for (const d of drops) hv -= d[3] * exp(-((x - d[0]) ** 2 + (y - d[1]) ** 2) / (d[2] * d[2]));
        C.vn[k] = vv; C.hn[k] = hv;
      }
      [C.h, C.hn] = [C.hn, C.h]; [C.v, C.vn] = [C.vn, C.v];
    }
    function gpuInit() {
      G = { H: ftex(nx, ny), H1: ftex(nx, ny), M: ftex(nx, ny), G1: ftex(nx, ny), G2: ftex(nx, ny), gl: R.gl, row: null };
      for (const n of ["waLap", "waStep", "waG1", "waG2", "waHeight", "wavePool", "waveFloor"]) if (!program(n)) throw new Error(`${n} shader failed`);
    }
    function gpuStep(dt) {
      const base = { uM: G.M, uN: [nx, ny] };
      if (s4) { pass("waLap", G.H1, { ...base, uHt: G.H }); [G.H, G.H1] = [G.H1, G.H]; }
      pass("waStep", G.H1, { ...base, uHt: G.H, uDt: dt, uC2: (c / h) ** 2, uS4: s4 / h ** 4, ...srcU(S.time + dt), uDr: padTo(drops.flat(), 16), uNd: min(4, drops.length) });
      [G.H, G.H1] = [G.H1, G.H];
    }
    function init() {
      if (dirty) rasterize();
      if (G) { upload(G.H, new Float32Array(NC * 4)); C = null; }
      else C = { h: new Float32Array(NC), v: new Float32Array(NC), L: new Float32Array(NC), hn: new Float32Array(NC), vn: new Float32Array(NC) };
      if (X) { X.Q.flush(); X.d.queue.writeBuffer(X.H, 0, new Float32Array(NC * 4)); X.at = 0; }
      // Pebbles dropped at time 0 (before warm-up) belong to the start, so every restart drops them again.
      drops = pre.slice(); serial++;
    }
    const save = () => (X ? (X.chk ??= xBuf(X.d, NC * 16, GPUBufferUsage.STORAGE), X.Q.copy([[X.H, X.chk]]), {}) : G ? (G.chk ??= ftex(nx, ny), copyTex(G.H, G.chk), {}) : { h: C.h.slice(), v: C.v.slice() });
    const load = k => { if (X) X.Q.copy([[X.chk, X.H]]); else if (G) copyTex(G.chk, G.H); else { C.h.set(k.h); C.v.set(k.v); } serial++; };
    function stepOnce(dt) {
      if (G && G.gl !== context()?.gl) { gpuInit(); dirty = true; init(); }
      if (dirty) rasterize();
      if (X) xStep(dt); else if (G) gpuStep(dt); else cpuStep(dt);
      drops = []; serial++;
    }
    // ----- WebGPU: waLap and waStep as compute (webgpu section); the WebGL2 height texture
    // becomes a mirror of the state, for drawing and heights(). -----
    function xStep(dt) {
      const { Q } = X, u = srcU(S.time + dt), nd = min(4, drops.length);
      const fill = b => {
        Q.f[b] = dt; Q.f[b + 1] = (c / h) ** 2; Q.f[b + 2] = s4 / h ** 4; Q.f[b + 3] = u.uT0; Q.i[b + 4] = nx; Q.i[b + 5] = ny; Q.i[b + 6] = u.uNsrc; Q.i[b + 7] = nd;
        Q.f.set(u.uSa, b + 8); Q.f.set(u.uSb, b + 40); Q.f.set(u.uSc, b + 72); Q.f.set(padTo(drops.flat(), 16), b + 104);
      };
      if (s4) { Q.run(X.lap, fill, [X.M, X.H, null, null, X.H1], xWg(nx), xWg(ny)); [X.H, X.H1] = [X.H1, X.H]; }
      Q.run(X.step, fill, [X.M, X.H, null, null, X.H1], xWg(nx), xWg(ny)); [X.H, X.H1] = [X.H1, X.H];
    }
    function xCheck() {
      const d = G && !XBAD.waves && pick(o) === "webgpu" ? WG.use(forced(o)) : null;
      if (X && X.d === d) return;
      if (X) { const old = X; X = null; old.destroy(); rawReset(); }
      if (!d) return;
      const Q = xQueue(d), B = () => xBuf(d, NC * 16, GPUBufferUsage.STORAGE);
      X = { d, Q, H: B(), H1: B(), M: B(), chk: null, at: S.time, req: -1, lap: xPipe(Q.K, "waves", XWA, "lapk"), step: xPipe(Q.K, "waves", XWA, "stepk") };
      d.queue.writeBuffer(X.M, 0, M); d.queue.writeBuffer(X.H, 0, readTex(G.H, new Float32Array(NC * 4)));
      if (G.chk && S.chk) { X.chk = B(); d.queue.writeBuffer(X.chk, 0, readTex(G.chk, new Float32Array(NC * 4))); }
      const me = X;
      X.Mi = xMirror(Q, [NC * 16], ([hh], t) => { if (X !== me || !G) return; upload(G.H, hh); X.at = t; hbAt = -1; });
      X.destroy = () => { me.Q.flush(); me.Mi.destroy(); for (const b of [me.H, me.H1, me.M, me.chk]) b?.destroy(); };
    }
    const xAfter = () => { if (X && X.req !== serial) { X.req = serial; X.Mi.request(() => [X.H], () => S.time); } };
    try { if (want) { gpuInit(); upload(G.M, M); } } catch (e) { G = null; errors.push(`waves: ${e.message}`); }
    S.gpu = !!G;
    clock(S, stepOnce, save, load, init);
    const rawReset = xClock(S, xCheck, xAfter);
    S.sync = () => (X ? (xAfter(), X.Mi.sync()) : Promise.resolve());
    Object.defineProperty(S, "backend", { get: () => (X ? "webgpu" : G ? "webgl2" : "cpu"), enumerable: true });
    // A pebble: a dent of depth amp (m) and radius r (m) that springs back and spreads as rings.
    S.drop = (at, k = {}) => {
      const d = [at[0] / h, at[1] / h, max(0.8, num(k.r, max(1.5 * h, 0.012)) / h), num(k.amp, 0.003) / h];
      if (drops.length < 4) drops.push(d);
      if (S.time === 0 && pre.length < 4) pre.push(d);
      return S;
    };
    S.update = () => { dirty = true; return S; };
    S.toWorld = p => toWorld(S, p);
    S.toScreen = q => toScreen(S, q);
    S.interact = { live: true, start(p) { S.drop(toWorld(S, p)); }, move() {}, end() {} };
    // Heights (m) over the grid; on the GPU one readback per change.
    let hb = null, hbAt = -1;
    S.heights = () => {
      if (hbAt === serial && hb) return hb;
      if (G) { const raw = readTex(G.H, new Float32Array(NC * 4)); hb = new Float32Array(NC); for (let k = 0; k < NC; k++) hb[k] = raw[k * 4] * h; }
      else { hb = new Float32Array(NC); for (let k = 0; k < NC; k++) hb[k] = C.h[k] * h; }
      hbAt = serial;
      return hb;
    };
    S.height = q => { const H = S.heights(), X = clamp(q[0] / h - 0.5, 0, nx - 1.001), Y = clamp(q[1] / h - 0.5, 0, ny - 1.001), i = floor(X), j = floor(Y), fx = X - i, fy = Y - j, I = min(i + 1, nx - 1), J = min(j + 1, ny - 1);
      return (H[i + j * nx] * (1 - fx) + H[I + j * nx] * fx) * (1 - fy) + (H[i + J * nx] * (1 - fx) + H[I + J * nx] * fx) * fy; };
    S.wall = q => { const i = floor(q[0] / h), j = floor(q[1] / h); return i >= 0 && j >= 0 && i < nx && j < ny && wall[i + j * nx] === 1; };
    S.range = () => max(1e-5, ...S.sources.map(q => num(q.amp, 0.002)), 0.6 * num(o.dropAmp, 0.003));
    S.surfaceUniforms = () => { pass("waG1", G.G1, { uHt: G.H, uM: G.M, uN: [nx, ny] }); pass("waG2", G.G2, { uHt: G.H, uM: G.M, uN: [nx, ny] }); return { uG1: G.G1, uG2: G.G2, uHt: G.H, uM: G.M, uN: [nx, ny] }; };
    S._cpu = () => C;
    S._wall = wall;
    return S;
  }
  // Slits in a straight barrier from a to b: gaps given as [center, width] along it, in m.
  waves.slits = (a, b, gaps = [], width = 0) => {
    const L = hypot(b[0] - a[0], b[1] - a[1]) || 1, d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], cuts = gaps.map(([s, w]) => [s - w / 2, s + w / 2]).sort((p, q) => p[0] - q[0]), out = [];
    let s0 = 0;
    for (const [s1, s2] of cuts.concat([[L, L]])) { if (s1 > s0) out.push({ from: [a[0] + d[0] * s0, a[1] + d[1] * s0], to: [a[0] + d[0] * s1, a[1] + d[1] * s1], width }); s0 = max(s0, s2); }
    return out;
  };

  // ---------- particles: things moving by the physics of what they are ----------
  // Slot i is reborn every life[1] seconds at a fixed phase (golden-ratio spacing); where and how
  // fast comes from a hash of (seed, slot, generation). Forces from the matter: gravity and the
  // drag that gives the terminal speed (solved exactly over a step, so stiff drag stays stable),
  // hot gas's lift g (T - Ta) / T fading as it mixes, curl-noise eddies, wind or a simulated
  // fluid's velocity. Colliders: the ground, segments, circles, polygons, and a fluid's bodies.
  const UNITS = { m: 1, cm: 100, mm: 1000 };
  function particles(o = {}) {
    const name = o.matter ?? "dust", Mt = MATTER[name];
    if (!Mt) throw new Error(`Fx.particles: unknown matter ${JSON.stringify(name)}; use one of ${Object.keys(MATTER).join(", ")}, or Fx.matter.define a new one`);
    const F = o.fluid?.isFluid ? o.fluid : null, u = F ? 1 : typeof o.units === "number" ? o.units : UNITS[o.units ?? "m"] ?? 1, g0 = 9.81 * u;
    const dom = F ? F.domain : o.domain ?? [4 * u, 2.25 * u];
    const P = { ...Mt, ...Object.fromEntries(["style", "life", "opacity", "color", "temperature", "fade", "flutter"].filter(k => o[k] != null).map(k => [k, o[k]])) };
    const lifeR = Array.isArray(P.life) ? P.life : [P.life, P.life], size = (o.size ?? P.size).map(s => s * u), Tr = P.temperature ? (Array.isArray(P.temperature) ? P.temperature : [P.temperature, P.temperature]) : null;
    const fo = o.forces ?? {};
    let gy = 0, k0 = 0, lift = 0;
    if (P.vt != null) { gy = g0; k0 = 9.81 / P.vt; } else if (P.rise != null) { gy = -g0; k0 = 9.81 / P.rise; } else k0 = P.drag ?? 0;
    if (P.gas && Tr) lift = g0 * max(0, (Tr[0] - num(o.ambient, 293)) / Tr[0]);
    if (P.lift) lift = g0 * P.lift;
    if (fo.gravity != null) gy = num(fo.gravity, 9.81) * u;
    if (fo.drag != null) k0 = max(0, num(fo.drag, k0));
    if (fo.buoyancy != null) lift = num(fo.buoyancy, 0) * u;
    // Coupled to a fluid, a gas parcel is the air itself: it can't lag the flow by more than a moment.
    const kk = F && P.gas ? max(k0, 8) : k0;
    const ed = fo.turbulence ?? (P.eddy ? { strength: P.eddy[0], scale: P.eddy[1], speed: P.eddy[2] } : null);
    const turb = ed ? [num(ed.strength, 0.5) * u * max(1, kk) * (F ? 0.5 : 1), 1 / (max(1e-6, num(ed.scale, 0.5)) * u), num(ed.speed, 0.3)] : null;
    const wind = (fo.wind ?? [0, 0]).map(v => v * u);
    // Up to a million slots on WebGPU; the CPU steps (and shows) the first 20,000.
    const N = clamp(num(o.count, 400), 1, 1e6) | 0, NCPU = min(N, 20000), seed = num(o.seed, 1) | 0, period = lifeR[1];
    const E = { shape: "point", at: [dom[0] / 2, dom[1] * 0.9], radius: 0.05 * u, dir: P.gas || P.rise ? -PI / 2 : 0, spread: 0.3, speed: 0, ...(o.emitter ?? {}) };
    const bounce = num(o.bounce, P.bounce ?? 0.2), friction = num(o.friction, P.friction ?? 0.5);
    const S = { isParticles: true, domain: dom, units: u, matter: name, style: P.style, count: N, view: null, fluid: F, light: o.light ?? null, density: cn(o.density, 1, 0, 1), dt: 1 / 60, emitting: true, ground: o.ground ?? null };
    const colliders = () => {
      const list = [];
      for (const c of o.colliders ?? []) {
        const e = num(c.bounce, bounce), fr = num(c.friction, friction);
        if (c.segment || c.from) { const [a, b] = c.segment ?? [c.from, c.to]; list.push({ seg: [a, b], e, fr }); }
        else if (c.circle || c.r != null) { const q = c.circle ?? [c.at[0], c.at[1], c.r]; list.push({ body: { kind: 0, c: [q[0], q[1]], r: q[2] }, e, fr }); }
        else if (c.points || c.polygon) { const pts = c.points ?? c.polygon, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); list.push({ body: { kind: 1, pts, box: [min(...xs), min(...ys), max(...xs), max(...ys)] }, e, fr }); }
      }
      if (F) for (const b of F.bodies()) list.push({ body: b, e: bounce, fr: friction });
      return list;
    };
    // Piles: heights on bins along the ground, slumping to the angle of repose.
    const NB = 240, bw = dom[0] / NB, pileOn = (o.pile ?? !!P.pile) && o.ground != null, repose = Math.tan(num(P.pile, 35) * PI / 180), heap = num(o.heap, 1);
    let pile = new Float32Array(NB);
    const pileAt = x => { const X = clamp(x / bw - 0.5, 0, NB - 1.001), i = floor(X), f = X - i; return pile[i] * (1 - f) + pile[i + 1] * f; };
    // A grain that lands rolls down the face of the heap until it rests where neither side is
    // steeper than the angle of repose (deposited in small parts, so the heap stays smooth).
    const deposit = (x, a) => {
      const lim = repose * bw, n = Math.ceil(a / (0.5 * lim)), d = a / n;
      for (let c = 0; c < n; c++) {
        let b = clamp(floor(x / bw), 0, NB - 1);
        for (let s = 0; s < NB && b >= 0; s++) {
          const top = pile[b] + d, l = b > 0 ? top - pile[b - 1] : Infinity, r = b < NB - 1 ? top - pile[b + 1] : Infinity;
          if (l <= lim && r <= lim) break;
          b = l > r ? b - 1 : b + 1;
          if (b >= NB) b = -1;
        }
        if (b >= 0) pile[b] += d;
      }
    };
    // State: x, y, vx, vy, generation, flag (0 flying, 1 landed, 2 gone), spin phase, spare.
    let st = new Float64Array(N * 8);
    const SPN = max(16, N >> 2), sp = new Float64Array(SPN * 6);
    let spi = 0;
    const slot = (i, t) => { const ph = ((i * 0.6180339887) % 1) * period, k = floor((t - ph) / period); return [k, t - ph - k * period]; };
    const rr = (i, k, c) => rnd(seed, i * 7919 + k * 104729, c);
    const lifeOf = (i, k) => lifeR[0] + (lifeR[1] - lifeR[0]) * rr(i, k, 1);
    function emit(i, k) {
      const r = c => rr(i, k, c), at = E.at;
      let x = at[0], y = at[1];
      if (E.shape === "disk") { const a = TAU * r(10), q = E.radius * sqrt(r(11)); x += q * cos(a); y += q * sin(a); }
      else if (E.shape === "line") { const a = E.from ?? at, b = E.to ?? at, t = r(10); x = lerp(a[0], b[0], t); y = lerp(a[1], b[1], t); }
      else if (E.shape === "box") { const s = E.size ?? [dom[0], dom[1]], c0 = E.at ?? [dom[0] / 2, dom[1] / 2]; x = c0[0] + (r(10) - 0.5) * s[0]; y = c0[1] + (r(11) - 0.5) * s[1]; }
      const a = (Array.isArray(E.dir) ? Math.atan2(E.dir[1], E.dir[0]) : num(E.dir, 0)) + (r(13) * 2 - 1) * num(E.spread, 0);
      const s0 = Array.isArray(E.speed) ? lerp(E.speed[0], E.speed[1], r(15)) : num(E.speed, 0);
      return [x, y, cos(a) * s0 * u, sin(a) * s0 * u];
    }
    // 2D curl noise: the curl of a sum of drifting plane waves, so the eddies have no sources or sinks.
    const modes = Array.from({ length: 4 }, (_, j) => { const a = TAU * rnd(seed, 501, j), m = 0.7 + 0.7 * rnd(seed, 502, j); return [cos(a) * m, sin(a) * m, TAU * rnd(seed, 503, j), (0.6 + 0.8 * rnd(seed, 504, j)) * (j & 1 ? 1 : -1), 1 / m]; });
    const curl = (x, y, t) => { let cx = 0, cy = 0; for (const [kx, ky, ph, w, s] of modes) { const c2 = cos(kx * x + ky * y + ph + w * t * TAU) * s; cx += c2 * ky; cy -= c2 * kx; } return [cx * 0.7, cy * 0.7]; };
    function hitSeg(x0, y0, x1, y1, a, b) {
      const ex = b[0] - a[0], ey = b[1] - a[1], s0 = (x0 - a[0]) * ey - (y0 - a[1]) * ex, s1 = (x1 - a[0]) * ey - (y1 - a[1]) * ex;
      if ((s0 > 0) === (s1 > 0) || s0 === s1) return null;
      const t = s0 / (s0 - s1), qx = x0 + (x1 - x0) * t, qy = y0 + (y1 - y0) * t, along = ((qx - a[0]) * ex + (qy - a[1]) * ey) / (ex * ex + ey * ey || 1e-18);
      if (along < 0 || along > 1) return null;
      const L = hypot(ex, ey) || 1, sg = s0 > 0 ? 1 : -1;
      return [qx, qy, sg * ey / L, -sg * ex / L];
    }
    const splash = (x, y, v) => {
      const n = 2 + (hash(seed, floor(x * 977), floor(y * 613)) % 3);
      for (let j = 0; j < n; j++) { const r = c => rnd(seed + 77, spi * 31 + j, c), a = -PI / 2 + (r(0) - 0.5) * 2.2, s = v * (0.18 + 0.22 * r(1)), q = (spi % SPN) * 6; sp.set([x, y - 0.002 * u, cos(a) * s, sin(a) * s, S.time, 1], q); spi++; }
    };
    let cols = [];
    function stepOnce(hh) {
      const t1 = S.time + hh, cl = cols = colliders(), ground = o.ground;
      for (let i = 0; i < NCPU; i++) {
        const q = i * 8, [k, age] = slot(i, t1), life = lifeOf(i, k);
        let dtl = hh;
        if (st[q + 4] !== k) {
          if (age > hh + 1e-9) { st[q + 4] = k; st[q + 5] = 2; continue; }
          st[q + 4] = k;
          if (!S.emitting || rr(i, k, 2) >= S.density) { st[q + 5] = 2; continue; }
          const e = emit(i, k);
          st[q] = e[0]; st[q + 1] = e[1]; st[q + 2] = e[2]; st[q + 3] = e[3]; st[q + 5] = 0; st[q + 6] = TAU * rr(i, k, 5);
          dtl = clamp(age, 0, hh);
        }
        if (st[q + 5] !== 0 || age > life) continue;
        let x = st[q], y = st[q + 1], vx = st[q + 2], vy = st[q + 3];
        const x0 = x, y0 = y;
        let ax = 0, ay = gy - lift * max(0, 1 - age / life);
        if (turb) { const c2 = curl(x * turb[1], y * turb[1], t1 * turb[2]); ax += c2[0] * turb[0]; ay += c2[1] * turb[0]; }
        if (P.flutter) ax += kk * P.flutter[1] * u * sin(TAU * P.flutter[0] * t1 + st[q + 6]);
        let wx = wind[0], wy = wind[1];
        if (F) { const w = F.velocity([x / u, y / u]); wx = w[0] * u; wy = w[1] * u; }
        if (kk > 0) {
          const e = exp(-kk * dtl), f = (1 - e) / kk, Tx = wx + ax / kk, Ty = wy + ay / kk;
          x += Tx * dtl + (vx - Tx) * f; y += Ty * dtl + (vy - Ty) * f; vx = Tx + (vx - Tx) * e; vy = Ty + (vy - Ty) * e;
        } else { vx += ax * dtl; vy += ay * dtl; x += vx * dtl; y += vy * dtl; }
        // Colliders: reflect the normal velocity by the bounce, take friction off the tangential.
        const meet = (nx, ny, e, fr, onGround) => {
          const vn = vx * nx + vy * ny;
          if (vn >= 0) return;
          if (P.splash && -vn > 1.5 * u) { splash(x, y, -vn); st[q + 5] = 2; return; }
          vx -= (1 + e) * vn * nx; vy -= (1 + e) * vn * ny;
          const vt = vx * -ny + vy * nx; vx -= vt * fr * -ny; vy -= vt * fr * nx;
          // Grains that come to rest on the ground join the heap; things that stick stay where they land.
          if (onGround && pileOn && hypot(vx, vy) < 0.4 * u) { deposit(x, heap * size[0] * size[0] * 0.9 / bw); st[q + 5] = 2; vx = vy = 0; }
          else if (fr >= 0.99 && e <= 0.01) { st[q + 5] = 1; vx = vy = 0; }
        };
        for (const c of cl) {
          if (c.seg) { const H = hitSeg(x0, y0, x, y, c.seg[0], c.seg[1]); if (H) { x = H[0] + H[2] * 1e-4 * u; y = H[1] + H[3] * 1e-4 * u; meet(H[2], H[3], c.e, c.fr, false); } }
          else { const s = surfaceOf(c.body, x, y); if (s[0] < 0) { x -= s[1] * (s[0] - 1e-4 * u); y -= s[2] * (s[0] - 1e-4 * u); meet(s[1], s[2], c.e, c.fr, false); } }
          if (st[q + 5]) break;
        }
        if (ground != null && st[q + 5] === 0) { const gl = ground - (pileOn ? pileAt(x) : 0); if (y > gl) { y = gl; meet(0, -1, bounce, friction, true); } }
        if (x < -0.05 * dom[0] || x > 1.05 * dom[0] || y < -0.5 * dom[1] || y > 1.05 * dom[1]) st[q + 5] = 2;
        st[q] = x; st[q + 1] = y; st[q + 2] = vx; st[q + 3] = vy;
      }
      // Splash droplets: short ballistic flights.
      for (let j = 0; j < SPN; j++) {
        const q = j * 6;
        if (!sp[q + 5]) continue;
        sp[q + 3] += g0 * hh; sp[q] += sp[q + 2] * hh; sp[q + 1] += sp[q + 3] * hh;
        if (t1 - sp[q + 4] > 0.6 || (ground != null && sp[q + 1] > ground - (pileOn ? pileAt(sp[q]) : 0) && sp[q + 3] > 0)) sp[q + 5] = 0;
      }
    }
    // Prewarm a full life so the system starts full, unless it's driven by a fluid (which starts from rest).
    function init() {
      st = new Float64Array(N * 8); for (let i = 0; i < N; i++) st[i * 8 + 4] = -1e9;
      sp.fill(0); spi = 0; pile = new Float32Array(NB);
      if (X) X.reset();
      // While WebGPU may still take the system, the warm-up waits for the first step (xCheck).
      pre0 = !X && !F && !pileOn && !P.splash && forced(o) !== "cpu" && forced(o) !== "webgl2" && (WG.state === "pending" || (WG.state === "ready" && pick(o) === "webgpu"));
      if (!pre0) prewarm();
    }
    function prewarm() {
      pre0 = false;
      const pre = o.prewarm ?? !F;
      if (pre && period > 0) { const n = Math.ceil(period / S.dt), t0 = S.time; for (let i = 0; i < n; i++) { S.time = (i - n) * S.dt; if (X) X.pend.push(S.time + S.dt); else stepOnce(S.dt); } S.time = t0; }
    }
    const save = () => (X && X.save(), { st: st.slice(), sp: sp.slice(), spi, pile: pile.slice() });
    const load = k => { st.set(k.st); sp.set(k.sp); spi = k.spi; pile.set(k.pile); if (X) X.load(); };
    const step = dt => { if (F) F.advance(S.time + dt); if (X) X.pend.push(S.time + dt); else stepOnce(dt); };
    // ----- WebGPU: every slot steps in its own thread through a run of steps (webgpu section);
    // the state comes back to `st` for alive(). Heaps, splashes, and particles carried by a
    // fluid need the CPU (they share state between particles, or read the fluid every step). -----
    let X = null, pre0 = false;
    if (F) F._sync = true;
    function xCheck() { xMove(); if (pre0) { if (X) X.reset(); prewarm(); } }
    function xMove() {
      const d = !F && !pileOn && !P.splash && !XBAD.particles && pick(o) === "webgpu" ? WG.use(forced(o)) : null;
      if (X && X.d === d) return;
      if (X) { const old = X; X = null; old.destroy(); rawReset(); }
      if (!d) return;
      const Q = xQueue(d, 64), cl = cols = colliders(), cbuf = [], pts = [];
      for (const c of cl) {
        if (c.seg) cbuf.push(0, c.e, c.fr, 0, c.seg[0][0], c.seg[0][1], c.seg[1][0], c.seg[1][1]);
        else if (!c.body.kind) cbuf.push(1, c.e, c.fr, c.body.r, c.body.c[0], c.body.c[1], 0, 0);
        else { cbuf.push(2, c.e, c.fr, c.body.pts.length, pts.length / 2, 0, 0, 0); for (const p of c.body.pts) pts.push(p[0], p[1]); }
      }
      const B = (n, data) => xBuf(d, n, GPUBufferUsage.STORAGE, data), TC = 1024;
      const me = X = { d, Q, pend: [], at: S.time, req: -1, chk: null, pipe: xPipe(Q.K, "particles", XPA, "pstep"), state: B(N * 32, new Float32Array(st)), T: B(TC * 4),
        ph: B(N * 4, Float32Array.from({ length: N }, (_, i) => ((i * 0.6180339887) % 1) * period)), C: B(max(1, cbuf.length) * 4, new Float32Array(cbuf.length ? cbuf : [0])), Pt: B(max(2, pts.length) * 4, new Float32Array(pts.length ? pts : [0, 0])) };
      if (S.chk) { me.chk = B(N * 32, new Float32Array(S.chk.st)); }
      me.flush = () => {
        const E0 = E, at = E0.at, sh = { disk: 1, line: 2, box: 3 }[E0.shape] ?? 0, spd = Array.isArray(E0.speed) ? E0.speed : [num(E0.speed, 0), num(E0.speed, 0)];
        const em2 = sh === 2 ? [...(E0.from ?? at), ...(E0.to ?? at)] : sh === 3 ? [...(E0.size ?? dom), 0, 0] : [0, 0, 0, 0];
        while (me.pend.length) {
          const run = me.pend.splice(0, TC);
          Q.flush(); d.queue.writeBuffer(me.T, 0, new Float32Array(run));
          Q.run(me.pipe, b => {
            Q.i.set([N, run.length, S.emitting ? 1 : 0, cl.length], b); Q.f.set([S.dt, period, lifeR[0], lifeR[1]], b + 4);
            Q.u32[b + 8] = seed >>> 0; Q.i[b + 9] = sh; Q.f.set([S.density, u, gy, lift, kk, num(o.ground, 0)], b + 10);
            Q.f.set(turb ? [turb[0], turb[1], turb[2], 1] : [0, 1, 0, 0], b + 16); Q.f.set([wind[0], wind[1], P.flutter ? P.flutter[0] : 0, P.flutter ? P.flutter[1] * u : 0], b + 20);
            Q.f.set([at[0], at[1], num(E0.radius, 0), Array.isArray(E0.dir) ? Math.atan2(E0.dir[1], E0.dir[0]) : num(E0.dir, 0)], b + 24);
            Q.f.set([num(E0.spread, 0), spd[0], spd[1], o.ground != null ? 1 : 0], b + 28); Q.f.set(em2, b + 32); Q.f.set([dom[0], dom[1], bounce, friction], b + 36);
            modes.forEach((m, j) => { Q.f.set(m.slice(0, 4), b + 40 + j * 4); Q.f[b + 56 + j] = m[4]; });
          }, [me.ph, me.T, me.C, me.Pt, me.state], xWg(N, 64));
          Q.flush();
        }
      };
      me.reset = () => { me.pend = []; Q.flush(); const s0 = new Float32Array(N * 8); for (let i = 0; i < N; i++) s0[i * 8 + 4] = -1e9; d.queue.writeBuffer(me.state, 0, s0); me.at = S.time; };
      me.save = () => { me.flush(); me.chk ??= B(N * 32); Q.copy([[me.state, me.chk]]); };
      me.load = () => { me.pend = []; Q.copy([[me.chk, me.state]]); };
      me.M = xMirror(Q, [N * 32], ([s], t) => { if (X !== me) return; st.set(s); me.at = t; });
      me.destroy = () => { me.M.destroy(); for (const b of [me.state, me.T, me.ph, me.C, me.Pt, me.chk]) b?.destroy(); };
    }
    let xn = 0;
    const xAfter = () => { if (!X) return; if (X.pend.length) { X.flush(); xn++; } if (X.req !== xn) { X.req = xn; X.M.request(() => [X.state], () => S.time); } };
    clock(S, step, save, load, init);
    const rawReset = xClock(S, xCheck, xAfter);
    S.sync = () => (X ? (xAfter(), X.M.sync()) : Promise.resolve());
    Object.defineProperty(S, "backend", { get: () => (X ? "webgpu" : "cpu"), enumerable: true });
    if (F) {   // the fluid comes back in step with the particles
      const adv = S.advance, warm = S.warm;
      S.advance = t => { if (t < S.time - 1e-9) { adv(t); F.advance(S.time); return S; } return adv(t); };
      S.warm = t => { if (S.chk?.at === t && F.chk?.at === t) { F.warm(t); return warm(t); } if (S.warmTo === t && S.time <= t + 1e-9) return S.advance(t); F.reset(); S.reset(); adv(t); F.warm(t); return warm(t); };
    }
    S.set = (k = {}) => { if (k.density != null) S.density = cn(k.density, 1, 0, 1); if (k.wind) { wind[0] = k.wind[0] * u; wind[1] = k.wind[1] * u; } if (k.emitter) Object.assign(E, k.emitter); if (k.light !== undefined) S.light = k.light; if (k.emitting != null) S.emitting = !!k.emitting; return S; };
    // The live particles: { p, v, age, life, k (0-1 through its life), spin }.
    S.alive = () => {
      const out = [];
      if (pre0) xCheck();
      for (let i = 0, n = X ? N : NCPU; i < n; i++) {
        const q = i * 8, [k, age] = slot(i, X ? X.at : S.time), life = lifeOf(i, k);
        if (st[q + 4] !== k || st[q + 5] === 2 || age > life || age < 0) continue;
        out.push({ i, p: [st[q], st[q + 1]], v: [st[q + 2], st[q + 3]], age, life, k: age / life, spin: st[q + 6], landed: st[q + 5] === 1 });
      }
      return out;
    };
    S.droplets = () => { const out = []; for (let j = 0; j < SPN; j++) if (sp[j * 6 + 5]) out.push({ p: [sp[j * 6], sp[j * 6 + 1]], v: [sp[j * 6 + 2], sp[j * 6 + 3]] }); return out; };
    S.pile = () => (pileOn ? Array.from(pile, (v, i) => [(i + 0.5) * bw, o.ground - v]) : null);
    S.terminal = () => (kk > 0 ? abs(gy - lift) / kk / u : Infinity);
    S.params = { gravity: gy / u, drag: kk, lift: lift / u, size: size.map(v => v / u), turbulence: turb, bounce, friction };
    S.colliders = () => cols;
    S.toWorld = p => toWorld(S, p);
    S.toScreen = q => toScreen(S, q);
    return S;
  }

  // ---------- 2D versions (no WebGL2, or gpu: false) ----------
  const trace = (c, pts) => { c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); };
  const stroke = (c, pts, close) => { trace(c, pts); if (close) c.closePath(); c.stroke(); };
  function fire2d(c, p, F, B) {   // a flickering teardrop, blue at the base
    const { width: w0, base: [x0, y0] } = p, hz = puff(p.size), h = p.height * (1 + 0.1 * noise1(p.t * hz * 1.3, p.seed)), w = w0 / 2;
    const tx = x0 + p.wind * 0.9 * w0 + 0.1 * noise1(p.t * hz * 0.8 + 7, p.seed) * h, gr = c.createLinearGradient(x0, y0, tx, y0 - h);
    [[0, 0.9, 0], [0.2, 0.9, 1], [0.6, 0.55, 1], [1, 0.25, 1]].forEach(([at, heat, k]) => gr.addColorStop(at, css(mixc(ramp(B, heat), ramp(F, heat), p.soot * k), 0.9 - at * 0.6)));
    c.beginPath(); c.moveTo(x0 - w, y0);
    c.bezierCurveTo(x0 - w, y0 - h * 0.5, tx - w * 0.15, y0 - h * 0.78, tx, y0 - h);
    c.bezierCurveTo(tx + w * 0.15, y0 - h * 0.78, x0 + w, y0 - h * 0.5, x0 + w, y0);
    c.fillStyle = gr; c.fill();
  }
  function plume2d(c, p, st, F = p.F) {   // the plume's outline, shaded hot to cool
    const n = [-F.dir[1], F.dir[0]], half = hypot(F.E1[0] * n[0] + F.E1[1] * n[1], F.E2[0] * n[0] + F.E2[1] * n[1]), S = p.length * 1.6, side = [];
    for (let i = 0; i <= 12; i++) {
      const s = S * i / 12, r = (1 + s * p.spread) * half, m = onScreen(F, [s, 0, 0]);
      side.push([m[0] + n[0] * r, m[1] + n[1] * r]); side.unshift([m[0] - n[0] * r, m[1] - n[1] * r]);
    }
    const end = onScreen(F, [S, 0, 0]), gr = c.createLinearGradient(F.C[0], F.C[1], end[0], end[1]), a = smooth(0, 0.12, p.throttle);
    [[0, 0.9, 0.95], [0.3, 0.45, 0.6 * FUELS[p.fuel].body * (0.4 + p.throttle)], [1, 0.2, 0]].forEach(([at, h, k]) => gr.addColorStop(at, css(ramp(st, h), a * k)));
    c.fillStyle = gr; trace(c, side); c.fill();
  }
  function smoke2d(c, p, col) {
    const life = min(6, (p.H * 0.95) / max(p.rise, 1));
    for (let k = Math.ceil((p.t - life) * 9); k <= floor(p.t * 9); k++) {
      const age = p.t - k / 9, z = age * p.rise, b = max(1, p.width / 2 + p.spread * z), x = p.at[0] + p.wind * z + (rnd(p.seed, k, 0) - 0.5) * b, y = p.at[1] - z;
      const a = p.density * 0.35 * smooth(0, 0.3, age) * (1 - age / life) * exp(-z * p.fade) * (p.width / 2 / b) ** 0.6, gr = c.createRadialGradient(x, y, 0, x, y, b * 1.3);
      gr.addColorStop(0, css(col, a)); gr.addColorStop(1, css(col, 0));
      c.fillStyle = gr; c.fillRect(x - b * 1.3, y - b * 1.3, b * 2.6, b * 2.6);
    }
  }
  function glow2d(c, p, core, halo, lines) {
    c.lineCap = c.lineJoin = "round";
    for (const L of lines) {
      for (let i = 6; i >= 1; i--) { c.strokeStyle = css(halo, p.intensity * L.level * 0.09); c.lineWidth = p.width + p.spread * i * 0.5; stroke(c, L.path, L.close); }
      if (p.core) { c.strokeStyle = css(core, L.level); c.lineWidth = p.width; stroke(c, L.path, L.close); }
    }
  }
  // fn(x, y) on a coarse grid, smoothed up to the box.
  let gridCanvas = null;
  function grid(c, box, fn) {
    const cell = max(2, sqrt(box[2] * box[3] / 9000)), nx = max(2, Math.ceil(box[2] / cell)), ny = max(2, Math.ceil(box[3] / cell));
    gridCanvas ??= document.createElement("canvas");
    gridCanvas.width = nx; gridCanvas.height = ny;
    const c2 = gridCanvas.getContext("2d"), img = c2.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const col = fn(box[0] + (i + 0.5) * box[2] / nx, box[1] + (j + 0.5) * box[3] / ny);
      img.data.set([col[0] * 255, col[1] * 255, col[2] * 255, 255], (j * nx + i) * 4);
    }
    c2.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(gridCanvas, box[0], box[1], box[2], box[3]);
  }

  // ---------- helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    const pal = n => util.rgb(n).map(v => v / 255);
    const isDark = () => { const c = util.rgb("panel"); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 128; };
    const boxOf = b => (Array.isArray(b) && b.length === 4 ? b.map(Number) : [0, 0, g.w, g.h]);
    const local = (q, box) => [q[0] - box[0], q[1] - box[1]];
    // Composites into the box (or o.clip). Light adds on a dark page and multiplies on a light
    // one, tinting the paper like ink (added light washes out on white). Paint covers.
    function layer(box, o, light, fn) {
      const c = g.ctx;
      c.save();
      if (o.clip?.length > 2) trace(c, o.clip); else { c.beginPath(); c.rect(...box); }
      c.clip();
      c.globalCompositeOperation = { add: "lighter", multiply: "multiply", over: "source-over" }[o.blend] ?? (light ? (isDark() ? "lighter" : "multiply") : "source-over");
      c.globalAlpha = cn(o.alpha, 1, 0, 1);
      fn(c);
      c.restore();
    }
    function draw(box, o, p, light, name, u, fallback) {
      const r = u && render(g, box, name, { uT: p.t, uSeed: hash(p.seed), ...u }, o);
      layer(box, o, light, c => { if (!r) return fallback(c); c.imageSmoothingEnabled = true; c.drawImage(r.img, 0, r.sy, r.W, r.H, ...box); });
      r?.img.close?.();
      return !!r;
    }
    const pad = (a, n) => a.concat(Array(max(0, n - a.length)).fill(0)).slice(0, n);
    const waterU = p => ({
      uN: p.src.length, uNw: p.waves.length, uKk: p.k, uOm: p.om, uCs: p.c, uDamp: p.damp, uAmp: p.A, uInv: p.inv, uOrg: p.org,
      uSrc: pad(p.src.flatMap(s => [s.x, s.y, s.phase, s.amp]), 32), uStart: pad(p.src.map(s => s.start), 8), uDur: pad(p.src.map(s => s.dur), 8).map(v => v || 1e9),
      uWv: pad(p.waves.flatMap(w => [w.kx, w.ky, w.om, w.ph]), 24), uWa: pad(p.waves.map(w => w.A), 6),
    });
    // Glow shader input: segments in box px, each with a weight.
    const glowU = (lines, box, core, halo, I, width, spread, on = true) => {
      const s = [], w = [];
      for (const ln of lines) {
        const pts = ln.close ? [...ln.path, ln.path[0]] : ln.path;
        for (let i = 1; i < pts.length && w.length < 96; i++) { s.push(...local(pts[i - 1], box), ...local(pts[i], box)); w.push(ln.level); }
      }
      return { uSeg: pad(s, 384), uSegW: pad(w, 96), uNs: w.length, uW: width / 2, uSpr: spread, uI: I, uCore: on ? 1 : 0, uHue: core, uHalo: halo };
    };
    // A sim that hasn't reached its time yet (a warm-up spread over frames) keeps catching up
    // while it is drawn, even on a paused figure, and the figure says so.
    const catchUp = S => {
      if (!S || !S.behind || typeof S.advance !== "function") return;
      S.advance(S.target);
      if (S.behind) { g.wantsFrame = true; g.busy = "Simulating"; }
    };
    const fx = {}, def = (name, fn) => { fx[name] = (b, o = {}) => { catchUp(o.sim ?? o.sys); const box = boxOf(b); return { box, ...fn(box, DEF[name](box, o), o, isDark()) }; }; };

    // Hot specks with a glowing streak (sparks and embers share the look).
    const flecks = (c, list, width, dk) => {
      c.lineCap = "round";
      for (const s of list) {
        const col = hue(blackbody(s.T)).map(v => (dk ? v : v ** 1.6));
        c.strokeStyle = css(col, s.level * 0.25); c.lineWidth = width * 3.5; stroke(c, [s.tail, s.p]);
        c.strokeStyle = css(dk ? mixc(col, W1, 0.4 * s.level) : col, s.level); c.lineWidth = width; stroke(c, [s.tail, s.p]);
      }
    };
    def("fire", (box, p, o, dk) => {
      const F = FIRE[dk ? "d" : "l"], B = BLUE[dk ? "d" : "l"], tip = [p.base[0] + p.wind * 0.9 * p.width, p.base[1] - p.height];
      // Soot that leaves the tip as smoke: drawn first, so the flame shines over its root.
      if (p.smoke > 0 && p.soot > 0.05 && p.height > 4) fx.smoke(box, { t: p.t, seed: p.seed + 9, at: [tip[0], tip[1] + p.height * 0.18], width: p.width * 0.55,
        rise: 0.5, density: 0.75 * p.smoke * p.soot * (0.4 + 0.6 * p.power), wind: p.wind * 0.8, spread: 0.16, res: 0.5, color: o.smokeColor, alpha: o.alpha });
      const gpu = p.height >= 1 && draw(box, o, p, true, "fire", { uRamp: F.flat(), uBlue: B.flat(), uBase: local(p.base, box), uW: p.width, uH: p.height,
        uWind: p.wind, uSoot: p.soot, uPow: p.power, uHz: puff(p.size), uDk: dk ? 1 : 0 }, c => fire2d(c, p, F, B));
      const em = p.embers > 0 ? embers(p) : [];
      if (em.length) draw(box, o, p, true, "", null, c => flecks(c, em, 1.1, dk));
      return { gpu, height: p.height, tip, embers: em };
    });

    def("plume", (box, p, o, dk) => {
      const F = p.F, st = FUELS[p.fuel][dk ? "d" : "l"], diamonds = [];
      for (let k = 0; p.diamonds > 0.05 && (k + 0.62) * p.spacing < p.length * 1.2; k++) diamonds.push(onScreen(F, [(k + 0.62) * p.spacing, 0, 0]));
      return { gpu: draw(box, o, p, true, "plume", { uRamp: st.flat(), uC: local(F.C, box), uA: F.A, uE1: F.E1, uE2: F.E2, uThr: p.throttle, uL: p.length, uSp: p.spacing,
        uSpr: p.spread, uBody: FUELS[p.fuel].body, uDia: p.diamonds, uInk: dk ? 1.8 : 2.8 }, c => plume2d(c, p, st)), length: p.length * F.along, end: onScreen(F, [p.length, 0, 0]), diamonds };
    });

    def("smoke", (box, p, o, dk) => {
      // Lit and shadowed tones: smoke is grey, lighter on the lit side; steam is white with cool blue shadows.
      const col = o.color ? pal(o.color) : p.steam ? (dk ? [0.9, 0.92, 0.95] : [0.66, 0.7, 0.77]) : dk ? [0.66, 0.65, 0.64] : [0.42, 0.41, 0.4];
      const lit = mixc(col, W1, p.steam ? 0.35 : dk ? 0.22 : 0.3), shade = p.steam ? mixc(col, [0.35, 0.42, 0.55], dk ? 0.45 : 0.3) : mixc(col, [0.06, 0.06, 0.07], dk ? 0.6 : 0.5);
      return { gpu: draw(box, { res: 0.5, ...o }, p, false, "smoke", { uSrc: local(p.at, box), uR0: max(1, p.width / 2), uRise: p.rise, uDrift: p.wind, uDen: p.density, uSpr: p.spread,
        uFade: p.fade, uH: p.H, uCol: lit, uCol2: shade, uL: p.light, uShadow: p.shadow, uBill: p.billows }, c => smoke2d(c, p, col)) };
    });
    fx.steam = (b, o = {}) => fx.smoke(b, { ...o, kind: "steam" });

    def("glow", (box, p, o, dk) => {
      const tint = o.color ? pal(o.color) : hue(blackbody(p.T)).map(v => (dk ? v : v ** 1.4)), core = dk ? mixc(tint, W1, p.intensity - 0.5) : tint;
      const lines = [{ path: p.path ?? [p.at, p.at], close: p.close, level: 1 }], w = p.path ? p.width : p.r * 2;
      return { gpu: draw(box, o, p, true, "glow", glowU(lines, box, core, tint, p.intensity, w, p.spread, p.core), c => glow2d(c, { ...p, width: w }, core, tint, lines)), color: css(tint), level: p.intensity };
    });

    def("ripples", (box, p, o, dk) => {
      const paper = pal("panel"), tint = pal(p.color), sun = [-2.65, -2.98];
      const c3 = p.style ? [mixc(paper, pal(p.low), 0.85), paper, mixc(paper, pal(p.high), 0.85)]
        : [mixc(paper, tint, dk ? 0.06 : 0.6), mixc(paper, tint, dk ? 0.26 : 0.2), dk ? mixc(tint, W1, 0.55) : W1];
      const gpu = draw(box, o, p, false, "ripples", { ...waterU(p), uStyle: p.style, uLo: c3[0], uMid: c3[1], uHi: c3[2], uSun: sun }, c => grid(c, box, (x, y) => {
        const a = surf(toSurface(p, [x, y]), p, p.t), sh = p.style ? clamp(a[0] / (p.A * 1.5), -1, 1) : a[1] * sun[0] + a[2] * sun[1], col = mixc(c3[1], sh > 0 ? c3[2] : c3[0], abs(sh));
        return p.style ? col : mixc(col, c3[2], clamp(sh * 1.4, 0, 1) ** 4 * 0.6);
      }));
      return { gpu, wavelength: TAU / p.k, period: TAU / p.om, height: q => surf(toSurface(p, q), p, p.t)[0] / p.A };
    });

    def("caustics", (box, p, o, dk) => {
      const paper = pal("panel"), tint = pal(p.color), fl = mixc(paper, tint, dk ? 0.34 : 0.3), sh = mixc(paper, tint, dk ? 0.16 : 0.5), lt = dk ? mixc(tint, W1, 0.7) : W1;
      const gpu = draw(box, o, p, false, "caustics", { ...waterU(p), uD: p.depth * (1 - 1 / 1.33), uFloor: fl, uShadow: sh, uLight: lt }, c => grid(c, box, (x, y) => {
        const I = focus(toSurface(p, [x, y]), p, p.t, p.depth);
        return fl.map((v, i) => min(1, lerp(sh[i], v, min(I, 1)) + lt[i] * max(I - 1.2, 0) * 0.22));
      }));
      return { gpu, intensity: q => focus(toSurface(p, q), p, p.t, p.depth) };
    });

    def("dust", (box, p, o, dk) => {
      const base = pal(p.color), col = dk ? mixc(base, [0.75, 0.68, 0.55], 0.4) : mixc(base, [0.62, 0.52, 0.38], 0.45);
      const lit = mixc(col, W1, dk ? 0.18 : 0.28), shade = mixc(col, [0.08, 0.06, 0.04], dk ? 0.62 : 0.5);
      const gpu = draw(box, { res: 0.5, ...o }, p, false, "dust", { uDs: pad(p.src.flatMap(q => [q.x - box[0], q.start, q.strength, q.kind]), 16), uNd: p.src.length,
        uGr: p.ground - box[1], uSc: p.scale, uSettle: p.settle, uShadow: p.shadow, uDen: p.density, uL: p.light, uCol: lit, uCol2: shade }, c => {
        for (const q of p.src) {   // without WebGL2: a soft dome per source
          const age = p.t - q.start, R = p.scale * (0.35 + 2.3 * (1 - exp(-age / 0.8))) * sqrt(q.strength);
          if (age <= 0) continue;
          const gr = c.createRadialGradient(q.x, p.ground, 0, q.x, p.ground, R * 1.2), a = p.density * 0.55 * exp(-age / p.settle);
          gr.addColorStop(0, css(col, a)); gr.addColorStop(1, css(col, 0));
          c.fillStyle = gr; c.fillRect(q.x - R * 1.2, p.ground - R * 1.2, R * 2.4, R * 1.2);
        }
      });
      const gs = p.grains > 0 ? grains(p) : [];
      if (gs.length) draw(box, o, p, false, "", null, c => {
        const gcol = mixc(col, [0.1, 0.08, 0.05], 0.55);
        c.lineCap = "round";
        for (const q of gs) { c.strokeStyle = css(gcol, 0.85 * q.alpha); c.lineWidth = q.size; stroke(c, [q.tail, q.p]); }
      });
      return { gpu, ground: p.ground, grains: gs };
    });

    def("water", (box, p, o, dk) => {
      const tint = pal(p.color), deep = mixc(tint, [0.05, 0.55, 0.6], 0.5).map(v => v * (dk ? 0.34 : 0.72));
      if (p.view === "side") {
        const top = mixc(tint, [0.3, 0.8, 0.82], 0.55).map(v => v * (dk ? 0.6 : 0.98)), sand = dk ? [0.42, 0.38, 0.3] : [0.86, 0.79, 0.62];
        const surfCol = dk ? mixc(top, W1, 0.55) : mixc(tint, [0.05, 0.15, 0.25], 0.35), ampS = p.waves1.reduce((a, w) => a + abs(w.A), 0) * 0.55;
        const gpu = draw(box, o, p, false, "waterSide", { uW1: pad(p.waves1.flatMap(w => [w.k, w.om, w.ph, w.A]), 20), uLevel: p.level - box[1], uBot: p.bottom - box[1],
          uClar: p.clarity, uFoam: p.foam, uIor: p.n, uAmpS: ampS, uSpecks: p.specks ? 1 : 0, uTop: top, uDeep: deep.map(v => v * 0.8), uLight: dk ? [0.75, 0.92, 1] : [1, 1, 0.94], uSand: sand, uSurf: surfCol }, c => {
          const pts = [];
          for (let x = box[0]; x <= box[0] + box[2] + 2; x += 3) pts.push([x, p.level - surf1(x - box[0], p, p.t)[0]]);
          const gr = c.createLinearGradient(0, p.level, 0, box[1] + box[3]);
          gr.addColorStop(0, css(top, 1)); gr.addColorStop(1, css(deep, 1));
          trace(c, [...pts, [box[0] + box[2], box[1] + box[3]], [box[0], box[1] + box[3]]]); c.fillStyle = gr; c.fill();
          c.strokeStyle = css(surfCol, 1); c.lineWidth = 1.5; stroke(c, pts);
        });
        return { gpu, level: x => p.level - surf1(x - box[0], p, p.t)[0] };
      }
      const fA = p.floor === "sand" ? (dk ? [0.48, 0.44, 0.36] : [0.9, 0.84, 0.68]) : dk ? [0.58, 0.64, 0.68] : [0.95, 0.97, 0.97];
      const fB = p.floor === "sand" ? (dk ? [0.36, 0.33, 0.27] : [0.78, 0.7, 0.54]) : dk ? [0.3, 0.36, 0.42] : [0.62, 0.7, 0.75];
      const sky = dk ? [0.16, 0.2, 0.3] : [0.82, 0.9, 1], skyH = dk ? [0.42, 0.48, 0.58] : [1, 1, 1], sun = [0.35, -0.55, 0.76];
      const gpu = draw(box, o, p, false, "water", { ...waterU(p), uD: p.depth * (1 - 1 / p.n), uDepth: p.depth, uClar: p.clarity, uTile: p.tile, uTilt: p.tilt, uFoam: p.foam,
        uFloorK: { tiles: 0, sand: 1, plain: 2 }[p.floor], uIor: p.n, uWater: deep, uFlA: fA, uFlB: fB, uSky: sky, uSkyH: skyH, uSunD: sun.map(v => v / hypot(...sun)) }, c => grid(c, box, (x, y) => {
        const I = focus(toSurface(p, [x, y]), p, p.t, p.depth), Tr = [1.7, 0.55, 0.38].map(k => exp((-k * 2 * p.depth) / p.clarity));
        return fA.map((v, i) => v * (0.5 + 0.55 * min(I, 2.6)) * Tr[i] + deep[i] * (1 - Tr[i]));
      }));
      return { gpu, height: q => surf(toSurface(p, q), p, p.t)[0] / p.A, intensity: q => focus(toSurface(p, q), p, p.t, p.depth) };
    });

    def("wind", (box, p, o, dk) => {
      const trails = wind(p), base = pal(p.color), fast = dk ? mixc(base, W1, 0.7) : mixc(base, [0.02, 0.05, 0.25], 0.45), dye = pal(p.dyeColor ?? (dk ? "orange" : "red"));
      draw(box, o, p, false, "", null, c => {
        c.lineCap = "butt"; c.lineJoin = "round";
        // Each streak is one path: a gradient from its tail (clear) to its head, and the front
        // half drawn again a little wider, so it tapers without the beads overlapping caps make.
        for (const tr of trails) {
          const pts = tr.points, n = pts.length - 1, a = pts[0], h = pts[n];
          const sp = clamp((tr.speed[n] - 0.6) / 1.2, 0, 1), col = tr.dye ? dye : p.colorBy === "speed" ? mixc(base, fast, sp) : base;
          const k = tr.dye ? tr.alpha * 0.26 : tr.alpha * (dk ? 0.85 : 0.75), gr = c.createLinearGradient(a[0], a[1], h[0], h[1]);
          gr.addColorStop(0, css(col, 0)); gr.addColorStop(0.55, css(col, k * 0.45)); gr.addColorStop(1, css(col, k));
          c.strokeStyle = gr;
          c.lineCap = tr.dye ? "round" : "butt";
          c.lineWidth = tr.dye ? p.width * 2.4 : p.width * 0.55;
          stroke(c, pts);
          if (!tr.dye && n > 3) { c.lineWidth = p.width; stroke(c, pts.slice(floor(n / 2))); }
        }
      });
      const F = windField(p);
      return { gpu: false, count: trails.length, velocity: q => F(q[0], q[1], p.t / WH) };
    });

    def("sparks", (box, p, o, dk) => {
      const list = sparks(p);
      draw(box, o, p, true, "", null, c => flecks(c, list, p.width, dk));
      return { gpu: false, sparks: list };
    });

    def("arc", (box, p, o, dk) => {
      const A = arc(p), I = A.level * 0.8, lines = [{ path: A.path, level: 1 }, ...A.branches];
      // Air in an arc glows blue-violet (nitrogen's emission lines) around a white-hot core.
      const halo = o.color ? pal(o.color) : dk ? [0.55, 0.55, 1] : [0.45, 0.32, 0.95], core = dk ? W1 : mixc(halo, [0.15, 0.05, 0.5], 0.5);
      return { gpu: draw(box, o, p, true, "glow", glowU(lines, box, core, halo, I, p.width, p.spread), c => glow2d(c, { spread: p.spread, core: true, intensity: I, width: p.width }, core, halo, lines)),
        path: A.path, branches: A.branches.map(q => q.path) };
    });

    def("shimmer", (box, p, o) => {
      const cv = g.ctx.canvas, dpr = cv.width / max(1, g.w);
      return { gpu: p.strength > 0 && draw(box, o, p, false, "shimmer", { uTex: cv, uBx: [box[0] * dpr, box[1] * dpr, box[2], box[3]], uCv: [cv.width, cv.height], uDpr: dpr,
        uStr: p.strength, uNs: p.scale, uRise: p.rise }, c => {   // without WebGL2, rows slide sideways
        for (let r = 0; r < box[3]; r += 2) c.drawImage(cv, box[0] * dpr, (box[1] + r) * dpr, box[2] * dpr, 2 * dpr, box[0] + noise1((r - p.t * p.rise) / p.scale, p.seed) * p.strength * (0.25 + 0.75 * r / box[3]), box[1] + r, box[2], 2);
      }) };
    });

    def("flow", (box, p, o, dk) => {
      const trails = flow(p), stops = ["blue", "purple", "red", "orange"].map(pal);
      draw(box, o, p, false, "", null, c => {
        c.lineCap = c.lineJoin = "round";
        // Each streak tapers from a full-width head to a hairline tail and fades with it.
        for (const tr of trails) {
          const pts = tr.points, n = pts.length - 1, k = tr.alpha * (tr.stream === "ground" ? 0.7 : dk ? 0.85 : 1), w = p.width * (tr.stream === "exhaust" ? 1.15 : 1);
          for (let i = 1; i <= n; i++) {
            const f = i / n;
            c.strokeStyle = css(ramp(stops, clamp((tr.T[i] - TA) / (900 - TA), 0, 1) ** 0.75), k * f ** 1.4);
            c.lineWidth = w * (0.3 + 0.7 * f);
            stroke(c, [pts[i - 1], pts[i]]);
          }
        }
      });
      return { gpu: false, count: trails.length, frame: p.F };
    });

    // ---------- simulations ----------
    const colorOf = c => (Array.isArray(c) ? c : hexc(c) ?? pal(c));
    // Light paint vanishes on a light page: pale colors are deepened there.
    const onPage = (col, dk) => (!dk && 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2] > 0.7 ? mixc(col, [0.36, 0.43, 0.52], 0.55) : col);
    const fmt = v => { const a = abs(v); return a === 0 ? "0" : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1).replace(/\.0$/, "") : a >= 1 ? v.toFixed(2).replace(/0$/, "").replace(/\.0$/, "") : v.toFixed(2); };
    const LEG = { speed: "speed (m/s)", pressure: "pressure coefficient Cp", vorticity: "vorticity ωD/U", dye: "", none: "" };
    const arrow = (c, a, b, head) => { const d = hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d; c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.moveTo(b[0] - ux * head - uy * head * 0.55, b[1] - uy * head + ux * head * 0.55); c.lineTo(b[0], b[1]); c.lineTo(b[0] - ux * head + uy * head * 0.55, b[1] - uy * head - ux * head * 0.55); };

    fx.fluid = (b, o = {}) => {
      const box = boxOf(b), S = o.sim;
      if (!S?.isFluid) throw new Error("g.fx.fluid: pass { sim }, a simulation made once with Fx.fluid({ ... })");
      S.view = box;
      const dk = isDark(), show = ["speed", "pressure", "vorticity", "dye", "none"].includes(o.show) ? o.show : "speed", mode = { speed: 0, pressure: 1, vorticity: 2, dye: 3, none: 3 }[show];
      const map = mode === 3 ? null : CMAPS[o.map] ? o.map : mode === 0 ? "magma" : "coolwarm";
      const range = o.range ?? (mode === 0 ? [0, 1.6 * S.speed] : mode === 1 ? [-1, 1] : [-6, 6]);
      const paper = pal("panel"), ink = pal("ink"), dye = o.dyeColor ? colorOf(o.dyeColor) : mode === 3 ? pal(dk ? "orange" : "red") : [0.97, 0.97, 0.95];
      const stk = mode === 3 ? mixc(paper, ink, 0.75) : [1, 1, 1], body = o.bodyColor ? colorOf(o.bodyColor) : mixc(paper, ink, 0.1);
      const k = { mode, map, lo: range[0], hi: range[1], paper, dye, stk, body, dyeK: num(o.dyeDensity, 1.2), stkK: 0.85 * cn(o.streakAlpha, 1, 0, 1), wk: S.length / max(S.speed, 1e-9) };
      const u = S.gpu ? S.showUniforms(box, { uMode: mode, uLo: range[0], uHi: range[1], uCm: cmapStops(map ?? "magma").flat(), uDye: dye, uStkC: stk, uBody: body, uPaper: paper, uDyeK: k.dyeK, uStkK: k.stkK }) : null;
      const gpu = draw(box, { res: 1, ...o }, { t: 0, seed: 1 }, false, "flShow", u, c => S.paintCPU(c, box, k));
      const P = q => S.toScreen(q), white = mode === 3 ? ink : [1, 1, 1];
      draw(box, o, { t: 0 }, false, "", null, c => {
        c.lineCap = c.lineJoin = "round";
        // Streamlines: the instantaneous field followed from the inflow edge (RK2 in arc length).
        const nS = o.streamlines | 0;
        if (nS > 0) {
          const ds = S.h * 0.7, steps = Math.ceil(2.5 * (S.grid[0] + S.grid[1]) / 0.7);
          c.strokeStyle = css(white, mode === 3 ? 0.55 : 0.5); c.lineWidth = 1;
          for (let s = 0; s < nS; s++) {
            let q = [S.h * 0.5, S.domain[1] * (s + 0.5) / nS];
            c.beginPath(); c.moveTo(...P(q));
            for (let i = 0; i < steps; i++) {
              const v1 = S.velocity(q), l1 = hypot(...v1); if (l1 < 1e-6) break;
              const m = [q[0] + v1[0] / l1 * ds / 2, q[1] + v1[1] / l1 * ds / 2], v2 = S.velocity(m), l2 = hypot(...v2) || 1;
              q = [q[0] + v2[0] / l2 * ds, q[1] + v2[1] / l2 * ds];
              if (q[0] < 0 || q[0] > S.domain[0] || q[1] < 0 || q[1] > S.domain[1] || S.solidAt(q)) break;
              c.lineTo(...P(q));
            }
            c.stroke();
          }
        }
        if (o.bodies !== false) for (const s of S.bodies()) { trace(c, bodyPath(s).map(P)); c.closePath(); c.fillStyle = css(body); c.fill(); c.strokeStyle = css(ink, 0.85); c.lineWidth = 1.3; c.stroke(); }
        // Arrows on a grid, length by speed (clamped), from the small readback grid.
        if (o.arrows) {
          const A = o.arrows === true ? {} : o.arrows, sp = max(8, num(A.spacing, 26)), ref = num(A.scale, 1.5 * S.speed) || 1;
          const nx = max(1, floor(box[2] / sp)), ny = max(1, floor(box[3] / sp)), ox = box[0] + (box[2] - (nx - 1) * sp) / 2, oy = box[1] + (box[3] - (ny - 1) * sp) / 2, list = [];
          for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const p = [ox + i * sp, oy + j * sp], q = S.toWorld(p);
            if (S.solidAt(q) || S.bodies().some(s => surfaceOf(s, q[0], q[1])[0] < S.h)) continue;
            const v = S.velocity(q), L = min(1, hypot(...v) / ref) * sp * 0.82;
            if (L < 3) continue;
            const d = hypot(...v), e = [v[0] / d * L / 2, v[1] / d * L / 2];
            list.push([[p[0] - e[0], p[1] - e[1]], [p[0] + e[0], p[1] + e[1]], min(5, 1.5 + 0.28 * L)]);
          }
          const col = A.color ? colorOf(A.color) : white, w = num(A.width, 1.3);
          if (mode !== 3) { c.beginPath(); for (const a of list) arrow(c, ...a); c.strokeStyle = "rgba(0, 0, 0, 0.35)"; c.lineWidth = w + 1.6; c.stroke(); }
          c.beginPath(); for (const a of list) arrow(c, ...a); c.strokeStyle = css(col, 0.92); c.lineWidth = w; c.stroke();
        }
      });
      return { gpu, legend: map ? { map, range, label: o.label ?? LEG[show] } : null, toWorld: S.toWorld, toScreen: S.toScreen };
    };

    // A horizontal bar for a colormap, with end and middle values.
    fx.colorbar = (b, o = {}) => {
      const box = boxOf(b), map = o.map ?? "magma", [lo, hi] = o.range ?? [0, 1], st = cmapStops(map), c = g.ctx, gr = c.createLinearGradient(box[0], 0, box[0] + box[2], 0);
      st.forEach((s, i) => gr.addColorStop(i / 15, css(s)));
      c.save(); c.fillStyle = gr; c.fillRect(...box); c.restore();
      g.rect(...box, { stroke: "faint", width: 1 });
      const n = max(2, num(o.ticks, 3) | 0), ty = box[1] + box[3] + 10;
      for (let i = 0; i < n; i++) { const t = i / (n - 1), x = box[0] + t * box[2]; g.text(o.format ? o.format(lerp(lo, hi, t)) : fmt(lerp(lo, hi, t)), [x, ty], { size: 11, color: "muted", align: i === 0 ? "left" : i === n - 1 ? "right" : "center" }); }
      if (o.label) g.text(o.label, [box[0], box[1] - 9], { size: 12, weight: 500, color: "muted", align: "left" });
      return { box };
    };

    fx.waves = (b, o = {}) => {
      const box = boxOf(b), S = o.sim;
      if (!S?.isWaves) throw new Error("g.fx.waves: pass { sim }, a simulation made once with Fx.waves({ ... })");
      S.view = box;
      const dk = isDark(), look = ["pool", "height", "caustics", "section"].includes(o.look) ? o.look : "pool", k = box[2] / S.domain[0], h = S.h;
      const [nx, ny] = S.grid, ink = pal("ink"), paper = pal("panel"), tint = pal(o.color ?? "blue");
      let gpu = false;
      if (look === "section") {
        // Water in section along the row at y = at: the surface, exaggerated to be seen.
        const H = S.heights(), j = clamp(floor(num(o.at, S.domain[1] / 2) / h), 0, ny - 1), lvl = box[1] + box[3] * 0.35, ex = num(o.exaggerate, box[3] * 0.12 / S.range()) ;
        const pts = Array.from({ length: nx }, (_, i) => [box[0] + (i + 0.5) / nx * box[2], lvl - H[i + j * nx] * ex]);
        draw(box, o, { t: 0 }, false, "", null, c => {
          const top = mixc(tint, [0.3, 0.8, 0.82], 0.55).map(v => v * (dk ? 0.6 : 0.98)), deep = mixc(tint, [0.05, 0.55, 0.6], 0.5).map(v => v * (dk ? 0.3 : 0.7)), gr = c.createLinearGradient(0, lvl, 0, box[1] + box[3]);
          gr.addColorStop(0, css(top)); gr.addColorStop(1, css(deep));
          trace(c, [[box[0], pts[0][1]], ...pts, [box[0] + box[2], pts[nx - 1][1]], [box[0] + box[2], box[1] + box[3]], [box[0], box[1] + box[3]]]); c.fillStyle = gr; c.fill();
          c.strokeStyle = css(dk ? mixc(top, W1, 0.5) : mixc(tint, [0.05, 0.15, 0.25], 0.4)); c.lineWidth = 1.5; stroke(c, pts);
        });
        return { gpu: false, level: x => lvl - S.height([(x - box[0]) / k, num(o.at, S.domain[1] / 2)]) * ex };
      }
      const range = num(o.range, S.range());
      if (look === "height") {
        const lo = pal(o.low ?? "blue"), hi = pal(o.high ?? "red"), c3 = [mixc(paper, lo, 0.9), paper, mixc(paper, hi, 0.9)], useCm = !!(o.map && CMAPS[o.map]);
        const u = S.gpu ? { ...S.surfaceUniforms(), uBox: [box[2], box[3]], uRange: range / h, uLo: c3[0], uMid: c3[1], uHi: c3[2], uWall: ink, uCm: cmapStops(o.map ?? "coolwarm").flat(), uUseCm: useCm ? 1 : 0 } : null;
        gpu = draw(box, o, { t: 0 }, false, "waHeight", u, c => paintWaves(c, box, S, (H, i, j, x, y) => {
          if (S._wall[i + j * nx]) return ink;
          const t = clamp(H(x, y) / range, -1, 1);
          return useCm ? cmap(o.map, t * 0.5 + 0.5) : mixc(c3[1], t > 0 ? c3[2] : c3[0], abs(t) ** 0.8 * 0.9);
        }));
      } else {
        // The pool from above (or just its floor light): the water shaders over the simulated surface.
        const depth = num(o.depth, max(S.depth ?? 0, 0.3)), n = cn(o.n, 1.333, 1, 2.5), D = depth * (1 - 1 / n) * k, clar = num(o.clarity, 3 * depth) * k, tile = num(o.tile, 0.06) * k;
        const deep = mixc(tint, [0.05, 0.55, 0.6], 0.5).map(v => v * (dk ? 0.34 : 0.72)), floorK = { tiles: 0, sand: 1, plain: 2 }[o.floor ?? "tiles"] ?? 0;
        const fA = floorK === 1 ? (dk ? [0.48, 0.44, 0.36] : [0.9, 0.84, 0.68]) : dk ? [0.58, 0.64, 0.68] : [0.95, 0.97, 0.97], fB = floorK === 1 ? (dk ? [0.36, 0.33, 0.27] : [0.78, 0.7, 0.54]) : dk ? [0.3, 0.36, 0.42] : [0.62, 0.7, 0.75];
        const sky = dk ? [0.16, 0.2, 0.3] : [0.82, 0.9, 1], skyH = dk ? [0.42, 0.48, 0.58] : [1, 1, 1], sun = [0.35, -0.55, 0.76].map(v => v / hypot(0.35, 0.55, 0.76));
        const fl = mixc(paper, tint, dk ? 0.34 : 0.3), sh = mixc(paper, tint, dk ? 0.16 : 0.5), lt = dk ? mixc(tint, W1, 0.7) : W1;
        const name = look === "pool" ? "wavePool" : "waveFloor";
        const u = S.gpu ? { ...S.surfaceUniforms(), uPx: box[2] / nx, uAmp: range / h * box[2] / nx, uD: D, uDepth: depth * k, uClar: clar, uTile: tile, uTilt: cn(o.tilt, 0.35, 0, 1.3), uFoam: 0, uFloorK: floorK, uIor: n,
          uWater: deep, uFlA: fA, uFlB: fB, uSky: sky, uSkyH: skyH, uSunD: sun, uFloor: fl, uShadow: sh, uLight: lt } : null;
        gpu = draw(box, o, { t: 0 }, false, name, u, c => paintWaves(c, box, S, (H, i, j, x, y) => {
          // Without a GPU: floor light from the curvature, refraction of the tiles, depth tint.
          const e = 1, hx = (H(x + e, y) - H(x - e, y)) / (2 * e), hy = (H(x, y + e) - H(x, y - e)) / (2 * e), Dc = D / (box[2] / nx);
          const fx2 = x - Dc * hx, fy2 = y - Dc * hy, hxx = H(fx2 + e, fy2) + H(fx2 - e, fy2) - 2 * H(fx2, fy2), hyy = H(fx2, fy2 + e) + H(fx2, fy2 - e) - 2 * H(fx2, fy2);
          const hxy = (H(fx2 + e, fy2 + e) - H(fx2 + e, fy2 - e) - H(fx2 - e, fy2 + e) + H(fx2 - e, fy2 - e)) / 4, I = 1 / max(abs((1 + Dc * hxx) * (1 + Dc * hyy) - Dc * Dc * hxy * hxy), 0.12);
          if (S._wall[i + j * nx]) return ink;
          if (look === "caustics") return fl.map((v, q) => min(1, lerp(sh[q], v, min(I, 1)) + lt[q] * max(I - 1.2, 0) * 0.22));
          const tc = tile / (box[2] / nx), gx = ((fx2 / tc) % 1 + 1) % 1, gy = ((fy2 / tc) % 1 + 1) % 1, grout = 1 - smooth(0.15, 0.55, min(gx, 1 - gx, gy, 1 - gy) * tc * (box[2] / nx)), base = floorK === 0 ? mixc(fA, fB, grout) : fA;
          const Tr = [1.7, 0.55, 0.38].map(a => exp(-a * 2 * depth * k / clar));
          return base.map((v, q) => v * (0.5 + 0.55 * min(I, 2.6)) * Tr[q] + deep[q] * (1 - Tr[q]));
        }));
      }
      if (o.walls !== false) draw(box, o, { t: 0 }, false, "", null, c => {
        c.lineCap = "butt"; c.strokeStyle = c.fillStyle = css(ink, 0.9);
        for (const q of S.walls) {
          if (q.polygon) { trace(c, q.polygon.map(S.toScreen)); c.closePath(); c.fill(); continue; }
          const pts = (q.points ?? [q.from, q.to]).map(S.toScreen);
          c.lineWidth = max(2, num(q.width, 0) * k, 1.2 * h * k); stroke(c, q.close ? [...pts, pts[0]] : pts);
        }
      });
      return { gpu, range, height: p => S.height(S.toWorld(p)), toWorld: S.toWorld, toScreen: S.toScreen };
    };
    // Waves without a GPU: a color per cell from the heights (in cells), smoothed up to the box.
    // Painted at twice the grid, from bilinear heights, so tiles and light lines stay smooth.
    function paintWaves(c, box, S, fn) {
      const [nx, ny] = S.grid, Hm = S.heights(), h = S.h, cw = nx * 2, ch = ny * 2, img = new ImageData(cw, ch);
      const H = (x, y) => { const X = clamp(x - 0.5, 0, nx - 1.001), Y = clamp(y - 0.5, 0, ny - 1.001), i = floor(X), j = floor(Y), fx = X - i, fy = Y - j, k = i + j * nx; return ((Hm[k] * (1 - fx) + Hm[k + 1] * fx) * (1 - fy) + (Hm[k + nx] * (1 - fx) + Hm[k + nx + 1] * fx) * fy) / h; };
      for (let b = 0; b < ch; b++) for (let a = 0; a < cw; a++) { const col = fn(H, a >> 1, b >> 1, (a + 0.5) / 2, (b + 0.5) / 2); img.data.set([col[0] * 255, col[1] * 255, col[2] * 255, 255], (a + b * cw) * 4); }
      gridCanvas ??= document.createElement("canvas");
      gridCanvas.width = cw; gridCanvas.height = ch;
      gridCanvas.getContext("2d").putImageData(img, 0, 0);
      c.imageSmoothingEnabled = true;
      c.drawImage(gridCanvas, box[0], box[1], box[2], box[3]);
    }

    // Soft round sprites, one per color, for puffs and glows.
    const sprites = new Map();
    const sprite = (col, soft) => {
      const key = col.map(v => Math.round(v * 40)).join() + soft;
      let s = sprites.get(key);
      if (!s) {
        s = document.createElement("canvas"); s.width = s.height = 64;
        const c = s.getContext("2d"), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, css(col, 1)); gr.addColorStop(soft ? 0.35 : 0.55, css(col, soft ? 0.55 : 0.8)); gr.addColorStop(1, css(col, 0));
        c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
        if (sprites.size > 400) sprites.clear();
        sprites.set(key, s);
      }
      return s;
    };
    fx.particles = (b, o = {}) => {
      const box = boxOf(b), S = o.sys ?? o.sim;
      if (!S?.isParticles) throw new Error("g.fx.particles: pass { sys }, a system made once with Fx.particles({ ... })");
      S.view = box;
      const dk = isDark(), M = MATTER[S.matter], style = STYLES.includes(o.style) ? o.style : S.style, sx = box[2] / S.domain[0], sy = box[3] / S.domain[1], u = S.units;
      const P = q => [box[0] + q[0] * sx, box[1] + q[1] * sy], list = S.alive(), [fi, fo] = M.fade ?? [0.08, 0.3], op = num(o.opacity, M.opacity ?? 1);
      const fade = q => op * smooth(0, max(1e-3, fi), q.k) * (1 - smooth(1 - fo, 1, q.k));
      const size = q => lerp(S.params.size[0], S.params.size[1], q.k) * u * sx;
      const base = o.color ? colorOf(o.color) : style === "puff" && !M.color ? (dk ? [0.66, 0.65, 0.64] : [0.42, 0.41, 0.4]) : M.color ? onPage(hexc(M.color) ?? pal(M.color), dk) : pal("ink");
      // A beam of light (a sunbeam through a window): particles in it scatter it toward the eye.
      const Lt = o.light !== undefined ? o.light : S.light;
      let beam = null;
      if (Lt) {
        const a = P(Lt.from), d0 = Array.isArray(Lt.dir) ? Lt.dir : [cos(num(Lt.dir, 1)), sin(num(Lt.dir, 1))], dl = hypot(...d0) || 1, d = [d0[0] / dl, d0[1] / dl], w = num(Lt.width, 0.3 * u) * sx / 2;
        beam = { a, d, w, n: [-d[1], d[0]] };
        const far = hypot(box[2], box[3]) * 1.5, e = [a[0] + d[0] * far, a[1] + d[1] * far], warm = dk ? [1, 0.93, 0.76] : [1, 0.86, 0.5];
        layer(box, o, dk, c => {
          const gr = c.createLinearGradient(a[0], a[1], e[0], e[1]); gr.addColorStop(0, css(warm, dk ? 0.13 : 0.22)); gr.addColorStop(0.5, css(warm, dk ? 0.06 : 0.12)); gr.addColorStop(1, css(warm, 0));
          trace(c, [[a[0] + beam.n[0] * w, a[1] + beam.n[1] * w], [e[0] + beam.n[0] * w * 1.2, e[1] + beam.n[1] * w * 1.2], [e[0] - beam.n[0] * w * 1.2, e[1] - beam.n[1] * w * 1.2], [a[0] - beam.n[0] * w, a[1] - beam.n[1] * w]]); c.closePath();
          if (!dk) c.globalCompositeOperation = "multiply";
          c.fillStyle = gr; c.fill();
        });
      }
      const inBeam = p => { if (!beam) return 0; const rx = p[0] - beam.a[0], ry = p[1] - beam.a[1], s = rx * beam.d[0] + ry * beam.d[1], dn = abs(rx * beam.n[0] + ry * beam.n[1]); return s > 0 ? 1 - smooth(beam.w * 0.7, beam.w * 1.05, dn) : 0; };
      const pile = S.pile();
      if (pile && pile.some(q => q[1] < S.ground - 1e-9)) draw(box, o, { t: 0 }, false, "", null, c => {
        const pts = pile.map((q, i) => P([q[0], (pile[max(0, i - 1)][1] + 2 * q[1] + pile[min(pile.length - 1, i + 1)][1]) / 4])), gnd = box[1] + S.ground * sy;
        trace(c, [[pts[0][0], gnd], ...pts, [pts[pts.length - 1][0], gnd]]); c.closePath();
        c.fillStyle = css(mixc(base, [0.1, 0.08, 0.05], dk ? 0.25 : 0.35), 0.95); c.fill();
      });
      const light = style === "glow" || style === "spark";
      draw(box, o, { t: 0 }, light, "", null, c => {
        c.lineCap = "round";
        if (style === "puff") {
          // Lit puffs that shade themselves: the density between each puff and the light dims it.
          const la = num(o.lightAngle, -2.16), ld = [cos(la), sin(la)], gw = 40, gh = max(4, Math.round(gw * box[3] / box[2])), cw = box[2] / gw, grid = new Float32Array(gw * gh);
          const at = (x, y) => { const i = floor((x - box[0]) / cw), j = floor((y - box[1]) / cw); return i >= 0 && j >= 0 && i < gw && j < gh ? grid[i + j * gw] : 0; };
          for (const q of list) { const p = P(q.p), i = floor((p[0] - box[0]) / cw), j = floor((p[1] - box[1]) / cw); if (i >= 0 && j >= 0 && i < gw && j < gh) grid[i + j * gw] += fade(q) * min(4, (size(q) / cw) ** 2) * 0.6; }
          const lit = mixc(base, W1, dk ? 0.25 : 0.32), shade = mixc(base, [0.06, 0.06, 0.07], dk ? 0.6 : 0.5), sh = num(o.shadow, 1);
          for (const q of list) {
            const p = P(q.p), r = max(1.5, size(q) / 2), a = fade(q);
            let tau = 0;
            for (let s = 1; s <= 4; s++) tau += at(p[0] + ld[0] * cw * s * 1.2, p[1] + ld[1] * cw * s * 1.2);
            const L = exp(-tau * 0.5 * sh), col = mixc(shade, lit, L);
            c.globalAlpha = clamp(a, 0, 1); c.drawImage(sprite(col, true), p[0] - r, p[1] - r, 2 * r, 2 * r);
          }
          c.globalAlpha = 1;
        } else if (style === "glow") {
          const T = M.temperature ?? [1300, 700];
          for (const q of list) {
            const Tk = lerp(T[0], T[1], q.k), col = hue(blackbody(Tk)).map(v => (dk ? v : v ** 1.6)), p = P(q.p), r = max(2, size(q) / 2);
            c.globalAlpha = clamp(fade(q) * (0.4 + 0.6 * glowLevel(Tk)), 0, 1); c.drawImage(sprite(col, false), p[0] - r, p[1] - r, 2 * r, 2 * r);
          }
          c.globalAlpha = 1;
        } else if (style === "spark") {
          const T = M.temperature ?? [2000, 900], tr = num(o.trail, 1 / 30);
          flecks(c, list.map(q => { const Tk = lerp(T[0], T[1], q.k), p = P(q.p); return { p, tail: [p[0] - q.v[0] * sx * tr, p[1] - q.v[1] * sy * tr], T: Tk, level: glowLevel(Tk) * fade(q) }; }), num(o.width, 1.4), dk);
        } else if (style === "streak") {
          const tr = num(o.trail, S.matter === "air" ? 0.08 : 1 / 30), w = num(o.width, max(1, S.params.size[0] * u * sx));
          c.strokeStyle = css(base); c.lineWidth = w;
          for (const q of list) { const p = P(q.p); c.globalAlpha = clamp(fade(q), 0, 1); c.beginPath(); c.moveTo(p[0] - q.v[0] * sx * tr, p[1] - q.v[1] * sy * tr); c.lineTo(p[0], p[1]); c.stroke(); }
          c.globalAlpha = 1;
        } else if (style === "mote") {
          // Dust in a beam: each mote scatters the light toward the eye and glints as it tumbles.
          const glint = dk ? [1, 0.95, 0.8] : mixc(base, [0.35, 0.2, 0.04], 0.55), t = S.time;
          for (const q of list) {
            const p = P(q.p), L = inBeam(p), r = max(0.8, size(q) / 2) * (1 + (dk ? 0.6 : 0.9) * L), tw = 0.55 + 0.45 * sin(q.spin * 7 + t * (2 + (q.spin % 1) * 5)) ** 2;
            const a = fade(q) * (beam ? 0.18 + 0.82 * L * tw : 0.8);
            if (a < 0.02) continue;
            c.fillStyle = css(L > 0.05 ? mixc(base, glint, L) : base, a);
            c.beginPath(); c.arc(p[0], p[1], r, 0, TAU); c.fill();
            if (L > 0.3 && dk) { c.fillStyle = css(glint, a * 0.18); c.beginPath(); c.arc(p[0], p[1], r * 3, 0, TAU); c.fill(); }
          }
        } else if (style === "bubble") {
          c.lineWidth = 1;
          for (const q of list) { const p = P(q.p), r = max(1.5, size(q) / 2), a = fade(q); c.strokeStyle = css(base, a); c.fillStyle = css(base, a * 0.15); c.beginPath(); c.arc(p[0], p[1], r, 0, TAU); c.fill(); c.stroke(); c.fillStyle = css(W1, a * 0.8); c.beginPath(); c.arc(p[0] - r * 0.35, p[1] - r * 0.35, r * 0.25, 0, TAU); c.fill(); }
        } else if (style === "leaf") {
          for (const q of list) { const p = P(q.p), r = max(2, size(q) / 2), a = q.spin + q.age * 2.2; c.fillStyle = css(base, fade(q)); c.beginPath(); c.ellipse(p[0], p[1], r, r * 0.45 * (0.35 + 0.65 * abs(cos(a))), a * 0.6, 0, TAU); c.fill(); }
        } else {
          for (const q of list) { const p = P(q.p), r = max(0.9, size(q) / 2); c.fillStyle = css(base, fade(q)); c.beginPath(); c.arc(p[0], p[1], r, 0, TAU); c.fill(); }
        }
        const drops = S.droplets();
        if (drops.length) { c.fillStyle = css(base, 0.85); for (const q of drops) { const p = P(q.p); c.beginPath(); c.arc(p[0], p[1], max(0.8, S.params.size[0] * u * sx * 0.35), 0, TAU); c.fill(); } }
      });
      return { gpu: false, count: list.length, toWorld: S.toWorld, toScreen: S.toScreen };
    };
    // The water effects take a simulated surface too.
    for (const [name, look] of [["water", null], ["ripples", "height"], ["caustics", "caustics"]]) {
      const own = fx[name];
      fx[name] = (b, o = {}) => (o.sim?.isWaves ? fx.waves(b, { ...o, look: look ?? (o.view === "side" ? "section" : "pool") }) : own(b, o));
    }
    g.fx = fx;
  });

  // The bare models, for labels and tests.
  const model = (name, fn) => (box, o = {}, q) => { const p = params(name, box, o); return fn(p, q && toSurface(p, q)); };
  const Fx = {
    hash, noise: noise1, blackbody, glowLevel, puff, follow, frame, ellipse, project: onScreen, params,
    surface: model("caustics", (p, q) => surf(q, p, p.t)), focus: model("caustics", (p, q) => focus(q, p, p.t, p.depth)),
    sparks: model("sparks", sparks), arc: model("arc", arc), flow: model("flow", flow),
    embers: model("fire", embers), grains: model("dust", grains), wind: model("wind", wind),
    windVelocity: (box, o, q) => { const p = params("wind", box, o); return windField(p)(q[0], q[1], p.t / WH); },
    waterLevel: (box, o, x) => { const p = params("water", box, { ...o, view: "side" }); return p.level - surf1(x - box[0], p, p.t)[0]; },
    fluid, waves, particles,
    matter: Object.defineProperties(name => (MATTER[name] ? JSON.parse(JSON.stringify(MATTER[name])) : null), { define: { value: defineMatter }, names: { get: () => Object.keys(MATTER) } }),
    colormap: Object.defineProperties((name, t) => cmap(name, t), { define: { value: defineColormap }, names: { get: () => Object.keys(CMAPS) }, stops: { value: name => cmapStops(name).map(c => c.slice()) } }),
    force2d: false,
    get gpu() { return !this.force2d && !!context(); },
    // What simulations step on: "webgpu", "webgl2", or "cpu". Set it to force one ("auto" undoes it).
    get backend() { const b = pick({}); return b === "cpu" || !floatGL(gpuForced({})) ? "cpu" : b; },
    set backend(v) { fxForce = ["webgpu", "webgl2", "cpu"].includes(v) ? v : null; if (fxForce === "webgpu") WG.start(); },
    // The WebGPU device: { state: "none" | "pending" | "ready" | "failed" | "lost", name, soft, error, errors, ready (a promise) }.
    get webgpu() { return { state: WG.state, name: WG.name, soft: WG.soft, error: WG.error, errors: WG.errors, ready: WG.ready }; },
    get still() { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; },
    errors,
  };
  window.Fx = Fx;
})();
