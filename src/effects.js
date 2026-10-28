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
  // Shared: the pixel in box px, seeded gradient noise, ramps.
  const HEAD = `#version 300 es
precision highp float; precision highp int;
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
      canvas.addEventListener?.("webglcontextlost", e => { e.preventDefault(); R = null; });
    } catch (e) { noGPU = true; errors.push(String(e.message || e)); }
    return R;
  }
  function program(name) {
    if (name in R.progs) return R.progs[name];
    const gl = R.gl;
    let P = null;
    try {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, HEAD + FS[name]]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
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
    const gl = R.gl, FN = { [gl.FLOAT]: "uniform1fv", [gl.FLOAT_VEC2]: "uniform2fv", [gl.FLOAT_VEC3]: "uniform3fv", [gl.FLOAT_VEC4]: "uniform4fv" };
    for (const [name, v] of Object.entries(u)) {
      const i = P.u[name], a = typeof v === "number" ? [v] : v;
      if (!i) continue;
      if (v?.width !== undefined) {   // a canvas: the texture
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
    gl.viewport(0, 0, W, Hh);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(P.p);
    uniforms(P, { uSize: [W, Hh], uK: k, ...u });
    gl.bindVertexArray(R.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { img: R.off ? R.canvas.transferToImageBitmap() : R.canvas, sy: R.h - Hh, W, H: Hh };
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
    const fx = {}, def = (name, fn) => { fx[name] = (b, o = {}) => { const box = boxOf(b); return { box, ...fn(box, DEF[name](box, o), o, isDark()) }; }; };

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
    force2d: false,
    get gpu() { return !this.force2d && !!context(); },
    get still() { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; },
    errors,
  };
  window.Fx = Fx;
})();
