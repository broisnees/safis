/* Effects kit: g.fx and window.Fx draw fire, exhaust, smoke, steam, glow, ripples, caustics,
   sparks, arcs, shimmer, and airflow, each a pure function of time t and a seed. Shaders share
   one WebGL2 context, with 2D versions without it. Reference: references/effects.md. */
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
  const sources = (list, b) => (list?.length ? list : [bp(b, 0.5, 0.5)]).slice(0, 8).map(s =>
    Array.isArray(s) ? { x: s[0], y: s[1], phase: 0, amp: 1, start: -1e6 } : { x: s.at[0], y: s.at[1], phase: num(s.phase, 0), amp: num(s.amp, 1), start: num(s.start, -1e6) });
  function water(b, o, lam, c) {
    const f = o.frame, X = f?.x ?? [1, 0], Y = f?.y ?? [0, 1], org = f?.origin ?? [0, 0], det = X[0] * Y[1] - Y[0] * X[1] || 1;
    return { k: TAU / lam, om: TAU * c / lam, c, damp: max(0, num(o.damping, 0)), A: 0.04 * lam * num(o.amp, 1), src: sources(o.sources, b),
      inv: [Y[1] / det, -X[1] / det, -Y[0] / det, X[0] / det], org: [org[0] - b[0], org[1] - b[1]], box: b, waves: [] };
  }
  const DEF = {
    fire: (b, o) => {
      const power = cn(o.power, 0.7, 0, 1);   // flame height grows as heat release to the 2/5 power
      return { ...common(o), base: o.base ?? bp(b, 0.5, 0.99), width: num(o.width, min(b[2] * 0.42, b[3] * 0.45)),
        height: num(o.height, b[3] * 0.9) * power ** 0.4, power, wind: cn(o.wind, 0, -1, 1), soot: cn(o.soot, 1, 0, 1), size: cn(o.size, 0.3, 0.005, 50) };
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
      return { ...common(o), steam, at: o.at ?? bp(b, 0.5, 0.995), width: num(o.width, b[2] * 0.1), rise: num(o.rise, 0.35) * b[3],
        wind: cn(o.wind, 0, -3, 3), density: cn(o.density, 0.7, 0, 1), spread: cn(o.spread, 0.12, 0, 1), fade: (steam ? 4 : 0.3) / b[3], H: b[3] };
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
        rN: nz ? max(abs(nz.rx), abs(nz.ry)) / F.R : 0.75, ground: num(o.ground, null), density: cn(o.density, 1, 0, 4), trail: cn(o.trail, 0.35, 0.05, 1),
        width: num(o.width, 1.2), intake: o.intake !== false, exhaust: o.exhaust !== false && sN > 0 };
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
      const f = s.amp * w.A / sqrt(1 + r * w.k / TAU) * exp(-w.damp * r) * (1 - smooth(-TAU / w.k, 0, r - w.c * (t - s.start)));
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
`;
  const SURF = `
uniform vec4 uSrc[8], uWv[6]; uniform float uStart[8], uWa[6]; uniform int uN, uNw; uniform float uKk, uOm, uCs, uDamp, uAmp; uniform mat2 uInv; uniform vec2 uOrg;
void surf(vec2 p, out vec3 a, out vec3 b) {
  a = vec3(0.0); b = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uN) break;
    vec2 d = p - uSrc[i].xy; float r = max(length(d), 1e-3); vec2 e = d / r;
    float f = uSrc[i].w * uAmp * inversesqrt(1.0 + r * uKk * 0.1591549) * exp(-uDamp * r) * (1.0 - smoothstep(-6.2831853 / uKk, 0.0, r - uCs * (uT - uStart[i])));
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
    fire: `uniform vec2 uBase; uniform float uW, uH, uWind, uSoot, uPow, uHz; uniform vec3 uBlue[4];
void main() {
  vec2 p = px();
  float y = (uBase.y - p.y) / (uH * (1.0 + 0.08 * sin(6.2831853 * uT * uHz))), x = (p.x - uBase.x) / uW - uWind * y * y * 0.9;
  vec2 q = vec2(x * 2.4, y * 2.2 - uT * uHz * 1.2);
  float n = fbm(q + 0.4 * vec2(fbm(q * 1.7 + vec2(0.0, -uT * uHz)), 0.0)), d = abs(x + 0.45 * y * n) / (0.5 * pow(clamp(1.0 - y, 0.0, 1.0), 0.65) + 0.015);
  float heat = ((1.0 - d * d) * (1.05 - 0.55 * y) + n * (0.3 + 1.1 * y)) * smoothstep(-0.05, 0.04, y) * (1.0 - smoothstep(0.75, 1.2, y)) * (0.55 + 0.55 * uPow);
  float sm = uSoot * smoothstep(0.02, 0.22, y);   // soot forms only above the blue base
  o = emit(mix(rampOf(uBlue, heat), rampOf(uRamp, heat), sm), smoothstep(0.06, 0.4, heat) * mix(0.75, 1.0, sm));
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
    smoke: `uniform vec2 uSrc; uniform float uR0, uRise, uDrift, uDen, uSpr, uFade, uH; uniform vec3 uCol, uCol2;
void main() {
  vec2 p = px(); float z = uSrc.y - p.y, zp = max(z, 0.0), x = p.x - uSrc.x - uDrift * zp, b = uR0 + uSpr * zp, e = x / b;
  vec2 q = vec2(x, z - uT * uRise) / (uR0 * 1.5 + 0.12 * uH);
  float n = fbm(q + 1.2 * vec2(fbm(q * 0.7 + vec2(0.0, uT * 0.15)), fbm(q * 0.7 + vec2(5.2, -uT * 0.1))));
  float rho = exp(-1.4 * e * e) * pow(uR0 / b, 0.6) * smoothstep(-uR0, uR0 * 0.5, z) * exp(-zp * uFade) * clamp(0.55 + 1.6 * n, 0.0, 1.5);
  float a = 1.0 - exp(-rho * 2.5 * uDen);
  o = vec4(mix(uCol, uCol2, clamp(0.5 + n, 0.0, 1.0)) * a, a);
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
      uSrc: pad(p.src.flatMap(s => [s.x, s.y, s.phase, s.amp]), 32), uStart: pad(p.src.map(s => s.start), 8),
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

    def("fire", (box, p, o, dk) => {
      const F = FIRE[dk ? "d" : "l"], B = BLUE[dk ? "d" : "l"];
      return { gpu: p.height >= 1 && draw(box, o, p, true, "fire", { uRamp: F.flat(), uBlue: B.flat(), uBase: local(p.base, box), uW: p.width, uH: p.height,
        uWind: p.wind, uSoot: p.soot, uPow: p.power, uHz: puff(p.size) }, c => fire2d(c, p, F, B)), height: p.height, tip: [p.base[0] + p.wind * 0.9 * p.width, p.base[1] - p.height] };
    });

    def("plume", (box, p, o, dk) => {
      const F = p.F, st = FUELS[p.fuel][dk ? "d" : "l"], diamonds = [];
      for (let k = 0; p.diamonds > 0.05 && (k + 0.62) * p.spacing < p.length * 1.2; k++) diamonds.push(onScreen(F, [(k + 0.62) * p.spacing, 0, 0]));
      return { gpu: draw(box, o, p, true, "plume", { uRamp: st.flat(), uC: local(F.C, box), uA: F.A, uE1: F.E1, uE2: F.E2, uThr: p.throttle, uL: p.length, uSp: p.spacing,
        uSpr: p.spread, uBody: FUELS[p.fuel].body, uDia: p.diamonds, uInk: dk ? 1.8 : 2.8 }, c => plume2d(c, p, st)), length: p.length * F.along, end: onScreen(F, [p.length, 0, 0]), diamonds };
    });

    def("smoke", (box, p, o, dk) => {
      const col = o.color ? pal(o.color) : p.steam ? (dk ? [0.9, 0.92, 0.95] : [0.6, 0.65, 0.72]) : dk ? [0.6, 0.6, 0.62] : [0.3, 0.3, 0.32];
      return { gpu: draw(box, o, p, false, "smoke", { uSrc: local(p.at, box), uR0: max(1, p.width / 2), uRise: p.rise, uDrift: p.wind, uDen: p.density, uSpr: p.spread,
        uFade: p.fade, uH: p.H, uCol: col, uCol2: mixc(col, dk ? W1 : [0, 0, 0], p.steam ? 0.12 : 0.18) }, c => smoke2d(c, p, col)) };
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

    def("sparks", (box, p, o, dk) => {
      const list = sparks(p);
      draw(box, o, p, true, "", null, c => {
        c.lineCap = "round";
        for (const s of list) {
          const col = hue(blackbody(s.T)).map(v => (dk ? v : v ** 1.6));
          c.strokeStyle = css(col, s.level * 0.25); c.lineWidth = p.width * 3.5; stroke(c, [s.tail, s.p]);
          c.strokeStyle = css(dk ? mixc(col, W1, 0.4 * s.level) : col, s.level); c.lineWidth = p.width; stroke(c, [s.tail, s.p]);
        }
      });
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
        for (const tr of trails) {
          const pts = tr.points, n = pts.length - 1;
          c.lineWidth = p.width * (tr.stream === "exhaust" ? 1.15 : 1);
          for (let j = 0, i0 = 0, i1; j < 3; j++, i0 = i1) {
            i1 = floor((j + 1) * n / 3);
            if (i1 <= i0) continue;
            c.strokeStyle = css(ramp(stops, clamp((tr.T[i1] - TA) / (900 - TA), 0, 1) ** 0.75), tr.alpha * [0.2, 0.5, 0.9][j] * (tr.stream === "ground" ? 0.7 : dk ? 0.85 : 1));
            stroke(c, pts.slice(i0, i1 + 1));
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
    force2d: false,
    get gpu() { return !this.force2d && !!context(); },
    get still() { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; },
    errors,
  };
  window.Fx = Fx;
})();
