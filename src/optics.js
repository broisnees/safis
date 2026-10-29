/* Optics kit for explainer figures. window.Optics traces light through a 2D scene:
   flat and curved mirrors, ideal thin lenses, glass bodies whose index depends on
   wavelength (prisms, slabs, thick lenses, raindrops), absorbing walls and screens,
   and sensors, with Snell refraction, Fresnel splitting, and total internal
   reflection. Optics.eye builds a schematic eye that accommodates and wears glasses.
   g.optics(scene, o) traces and draws a scene and returns the hits.
   Reference: references/optics.md in the skill. */
(() => {
  "use strict";
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hypot = Math.hypot;
  const D_LINE = 587.56; // nm: catalogs quote indices at the helium d line
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const dist = (a, b) => hypot(a[0] - b[0], a[1] - b[1]);
  const unit = v => { const l = hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const rotate = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
  const pt = p => [+p[0], +p[1]];

  // ---------- Materials ----------
  // Cauchy fits n(λ) = A + B/λ² (λ in µm), matched to each material's index at the
  // d line and its Abbe number, so the spread of colors is the real one.
  const MATERIALS = {
    vacuum: 1, air: 1,
    water: { A: 1.3242, B: 0.003066 },     // 1.333 at 589 nm, 1.343 at 400 nm, 1.330 at 700 nm
    ice: { A: 1.3006, B: 0.00289 },        // 1.309
    acrylic: { A: 1.4787, B: 0.004484 },   // PMMA, 1.492
    bk7: { A: 1.5046, B: 0.0042 },         // crown glass, 1.517, Abbe 64
    flint: { A: 1.5942, B: 0.00893 },      // F2, 1.620, Abbe 36
    denseFlint: { A: 1.7384, B: 0.016 },   // SF11, 1.785, Abbe 26
    diamond: { A: 2.3786, B: 0.01342 },    // 2.417, Abbe 55
  };
  MATERIALS.crown = MATERIALS.glass = MATERIALS.bk7;

  function material(m) {
    if (m == null) return 1;
    if (typeof m === "string") {
      if (!(m in MATERIALS)) throw new Error(`Optics: unknown material "${m}" (try ${Object.keys(MATERIALS).join(", ")})`);
      return MATERIALS[m];
    }
    return m;
  }
  // Refractive index of a material (a number, a name, or { A, B, C }) at a wavelength in nm.
  function index(m, wl) {
    const c = material(m);
    if (typeof c === "number") return c;
    const l2 = ((wl ?? D_LINE) / 1000) ** 2;
    return c.A + (c.B ?? 0) / l2 + (c.C ?? 0) / (l2 * l2);
  }
  const dispersive = m => { const c = material(m); return typeof c === "object" && !!(c.B || c.C); };
  const abbe = m => (index(m, D_LINE) - 1) / (index(m, 486.13) - index(m, 656.27));

  // ---------- Wavelength to color ----------
  // CIE 1931 2° color matching functions x̄, ȳ, z̄ from 380 to 780 nm in 10 nm steps, then
  // XYZ to linear sRGB with negative parts clipped, scaled so the largest channel is 1
  // and dimmed a little toward the ends of the visible range.
  const CMF = [
    [0.001368, 0.000039, 0.00645], [0.004243, 0.00012, 0.02005], [0.01431, 0.000396, 0.06785], [0.04351, 0.00121, 0.2074], [0.13438, 0.004, 0.6456],
    [0.2839, 0.0116, 1.3856], [0.34828, 0.023, 1.74706], [0.3362, 0.038, 1.77211], [0.2908, 0.06, 1.6692], [0.19536, 0.09098, 1.28764],
    [0.09564, 0.13902, 0.81295], [0.03201, 0.20802, 0.46518], [0.0049, 0.323, 0.272], [0.0093, 0.503, 0.1582], [0.06327, 0.71, 0.07825],
    [0.1655, 0.862, 0.04216], [0.2904, 0.954, 0.0203], [0.43345, 0.99495, 0.00875], [0.5945, 0.995, 0.0039], [0.7621, 0.952, 0.0021],
    [0.9163, 0.87, 0.00165], [1.0263, 0.757, 0.0011], [1.0622, 0.631, 0.0008], [1.0026, 0.503, 0.00034], [0.85445, 0.381, 0.00019],
    [0.6424, 0.265, 0.00005], [0.4479, 0.175, 0.00002], [0.2835, 0.107, 0], [0.1649, 0.061, 0], [0.0874, 0.032, 0], [0.04677, 0.017, 0],
    [0.0227, 0.00821, 0], [0.011359, 0.004102, 0], [0.00579, 0.002091, 0], [0.002899, 0.001047, 0], [0.00144, 0.00052, 0],
    [0.00069, 0.000249, 0], [0.000332, 0.00012, 0], [0.000166, 0.00006, 0], [0.000083, 0.00003, 0], [0.000042, 0.000015, 0],
  ];
  function linearRGB(nm) {
    const f = clamp((nm - 380) / 10, 0, 40), i = Math.min(39, Math.floor(f)), t = f - i;
    const [X, Y, Z] = [0, 1, 2].map(k => lerp(CMF[i][k], CMF[i + 1][k], t));
    const c = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z].map(v => Math.max(0, v));
    const m = Math.max(...c) || 1;
    const edge = nm < 420 ? lerp(0.6, 1, clamp((nm - 380) / 40, 0, 1)) : nm > 680 ? lerp(1, 0.6, clamp((nm - 680) / 100, 0, 1)) : 1;
    return c.map(v => (v / m) * edge);
  }
  const encode = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  // [r, g, b] in 0-255. o.on = "light" darkens bright hues (yellow, green) so a thin
  // line still reads on a light page.
  function wavelengthRGB(nm, o = {}) {
    let c = linearRGB(nm);
    if (o.on === "light") {
      const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], k = Math.min(1, (o.luminance ?? 0.2) / Math.max(Y, 1e-6));
      c = c.map(v => v * k);
    }
    return c.map(v => Math.round(clamp(encode(v), 0, 255)));
  }
  const wavelengthColor = (nm, o) => { const [r, g, b] = wavelengthRGB(nm, o); return `rgb(${r}, ${g}, ${b})`; };
  // The color of a glowing body at T kelvin, normalized so the brightest channel is 255 (a fit to
  // the Planck spectrum seen through sRGB, good from 1000 to 40000 K): 1900 a candle, 2700 a
  // household bulb, 3200 a halogen lamp, 5800 sunlight, 6500 overcast daylight.
  function blackbodyRGB(T) {
    const t = clamp(T, 1000, 40000) / 100;
    const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return [r, g, b].map(v => Math.round(clamp(v, 0, 255)));
  }
  // White light as seven lines, red to violet; Optics.spectrum(n) gives finer ones.
  const WHITE = [650, 605, 578, 540, 500, 465, 415];
  const spectrum = (n = 7, lo = 415, hi = 650) => Array.from({ length: n }, (_, i) => +(n === 1 ? (lo + hi) / 2 : hi - ((hi - lo) * i) / (n - 1)).toFixed(1));

  // ---------- Physics ----------
  // Fresnel reflectance for unpolarized light from index n1 into n2, given cos of the incidence angle.
  function fres(n1, n2, ci) {
    ci = clamp(ci, 0, 1);
    const st = (n1 / n2) * Math.sqrt(1 - ci * ci);
    if (st >= 1) return { R: 1, T: 0, Rs: 1, Rp: 1, tir: true, ct: 0 };
    const ct = Math.sqrt(1 - st * st);
    const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct), rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
    const Rs = rs * rs, Rp = rp * rp, R = (Rs + Rp) / 2;
    return { R, T: 1 - R, Rs, Rp, tir: false, ct };
  }
  const snell = (n1, n2, i) => { const s = (n1 * Math.sin(i * DEG)) / n2; return Math.abs(s) > 1 ? NaN : Math.asin(s) / DEG; };
  const critical = (n1, n2 = 1) => (n1 > n2 ? Math.asin(n2 / n1) / DEG : NaN);
  const brewster = (n1, n2) => Math.atan(n2 / n1) / DEG;
  function fresnel(n1, n2, i) {
    const f = fres(n1, n2, Math.cos(i * DEG));
    return { R: f.R, T: f.T, Rs: f.Rs, Rp: f.Rp, tir: f.tir, t: f.tir ? NaN : Math.acos(f.ct) / DEG };
  }
  // Thin lens or mirror: object at distance d (real objects positive), focal length f.
  function image(f, d) {
    if (!Number.isFinite(d)) return { d: f, m: 0 };
    const inv = 1 / f - 1 / d;
    const di = Math.abs(inv) < 1e-15 ? Infinity : 1 / inv;
    return { d: di, m: Number.isFinite(di) ? -di / d : Infinity };
  }
  // A thick lens of index n, radii R1, R2 (center of curvature to the right is positive), center thickness d.
  function thick(n, R1, R2, d = 0) {
    const c1 = 1 / R1, c2 = 1 / R2;
    const P = (n - 1) * (c1 - c2 + ((n - 1) * d * c1 * c2) / n), f = 1 / P;
    return { f, bfd: f * (1 - ((n - 1) * d * c1) / n), ffd: f * (1 + ((n - 1) * d * c2) / n) };
  }
  const lensmaker = (n, R1, R2, d = 0) => thick(n, R1, R2, d).f;
  // The rainbow after k internal reflections in a drop of index n: the incidence angle of
  // minimum deviation, cos²i = (n² − 1) / (k(k + 2)), and the bow's angle from the antisolar point.
  function rainbow(n, k = 1) {
    const i = Math.acos(Math.sqrt((n * n - 1) / (k * (k + 2)))), r = Math.asin(Math.sin(i) / n);
    const D = 2 * (i - r) + k * (Math.PI - 2 * r), w = ((D % TAU) + TAU) % TAU;
    return { i: i / DEG, r: r / DEG, deviation: D / DEG, angle: Math.abs(Math.PI - w) / DEG };
  }

  // ---------- Geometry ----------
  // A piece of boundary is a segment { k: "seg", a, b } or an arc { k: "arc", c, r, a0, a1 }
  // running counterclockwise from a0 to a1 (radians, world y up).
  const segment = (a, b) => ({ k: "seg", a: pt(a), b: pt(b) });
  // u0, u1 are the unit vectors to the ends, kept so the in-arc test needs no trigonometry.
  function arcR(c, r, a0, a1) {
    if (a1 < a0) a1 += TAU;
    return { k: "arc", c: pt(c), r: Math.abs(r), a0, a1, u0: [Math.cos(a0), Math.sin(a0)], u1: [Math.cos(a1), Math.sin(a1)] };
  }
  const arc = (c, r, from, to) => arcR(c, r, from * DEG, to * DEG);
  const dirOf = a => (typeof a === "number" ? [Math.cos(a * DEG), Math.sin(a * DEG)] : unit(a));
  const place = (pc, c, a) => (pc.k === "seg" ? segment(add(rotate(pc.a, a), c), add(rotate(pc.b, a), c)) : arcR(add(rotate(pc.c, a), c), pc.r, pc.a0 + a, pc.a1 + a));
  function inArc(pc, x, y) {
    const sw = pc.a1 - pc.a0;
    if (sw >= TAU - 1e-12) return true;
    if (!pc.u0) { pc.u0 = [Math.cos(pc.a0), Math.sin(pc.a0)]; pc.u1 = [Math.cos(pc.a1), Math.sin(pc.a1)]; }
    const vx = x - pc.c[0], vy = y - pc.c[1], u0 = pc.u0, u1 = pc.u1, e = -1e-12 * pc.r;
    const after0 = u0[0] * vy - u0[1] * vx >= e, before1 = vx * u1[1] - vy * u1[0] >= e;
    return sw <= Math.PI ? after0 && before1 : after0 || before1;
  }
  // Distance along the unit ray (px, py) + t (dx, dy) to the piece, for t > eps; Infinity on a miss.
  function cast(pc, px, py, dx, dy, eps) {
    if (pc.k === "seg") {
      const ex = pc.b[0] - pc.a[0], ey = pc.b[1] - pc.a[1], den = dx * ey - dy * ex;
      if (den === 0) return Infinity;
      const wx = pc.a[0] - px, wy = pc.a[1] - py, t = (wx * ey - wy * ex) / den;
      if (!(t > eps)) return Infinity;
      const s = (wx * dy - wy * dx) / den;
      return s >= -1e-9 && s <= 1 + 1e-9 ? t : Infinity;
    }
    const fx = px - pc.c[0], fy = py - pc.c[1], b = fx * dx + fy * dy, disc = b * b - (fx * fx + fy * fy - pc.r * pc.r);
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t > eps && inArc(pc, px + t * dx, py + t * dy)) return t;
    t = -b + sq;
    return t > eps && inArc(pc, px + t * dx, py + t * dy) ? t : Infinity;
  }
  // Unit normal of a piece at a point on it: left of a->b for segments, away from the center for arcs.
  function normalAt(pc, x, y) {
    if (pc.k === "seg") { const e = unit(sub(pc.b, pc.a)); return [-e[1], e[0]]; }
    return [(x - pc.c[0]) / pc.r, (y - pc.c[1]) / pc.r];
  }
  function midOf(pc) {
    if (pc.k === "seg") { const e = unit(sub(pc.b, pc.a)); return [mul(add(pc.a, pc.b), 0.5), [-e[1], e[0]]]; }
    const a = (pc.a0 + pc.a1) / 2, u = [Math.cos(a), Math.sin(a)];
    return [add(pc.c, mul(u, pc.r)), u];
  }
  function bbox(shape) {
    const b = [Infinity, Infinity, -Infinity, -Infinity], grow = p => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); };
    for (const pc of shape) {
      if (pc.k === "seg") { grow(pc.a); grow(pc.b); continue; }
      grow([pc.c[0] + pc.r * Math.cos(pc.a0), pc.c[1] + pc.r * Math.sin(pc.a0)]);
      grow([pc.c[0] + pc.r * Math.cos(pc.a1), pc.c[1] + pc.r * Math.sin(pc.a1)]);
      for (let k = Math.ceil(pc.a0 / (Math.PI / 2)); k * (Math.PI / 2) <= pc.a1; k++) grow(add(pc.c, mul([Math.cos(k * Math.PI / 2), Math.sin(k * Math.PI / 2)], pc.r)));
    }
    return b;
  }
  // Inside test by counting crossings along a ray in an awkward direction (so it doesn't graze corners).
  const PROBE = [Math.cos(1), Math.sin(1)];
  function inside(el, x, y) {
    const b = el.box;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    let n = 0;
    for (const pc of el.shape) {
      if (pc.k === "seg") {
        const ex = pc.b[0] - pc.a[0], ey = pc.b[1] - pc.a[1], den = PROBE[0] * ey - PROBE[1] * ex;
        if (!den) continue;
        const wx = pc.a[0] - x, wy = pc.a[1] - y, t = (wx * ey - wy * ex) / den, s = (wx * PROBE[1] - wy * PROBE[0]) / den;
        if (t > 0 && s >= 0 && s < 1) n++;
      } else {
        const fx = x - pc.c[0], fy = y - pc.c[1], bb = fx * PROBE[0] + fy * PROBE[1], disc = bb * bb - (fx * fx + fy * fy - pc.r * pc.r);
        if (disc <= 0) continue;
        const sq = Math.sqrt(disc);
        for (const t of [-bb - sq, -bb + sq]) if (t > 0 && inArc(pc, x + t * PROBE[0], y + t * PROBE[1])) n++;
      }
    }
    return n % 2 === 1;
  }
  // Distance from a world point to an element's outline, for drag hit tests.
  function distance(el, q) {
    let best = Infinity;
    for (const pc of el.shape ?? []) {
      if (pc.k === "seg") {
        const e = sub(pc.b, pc.a), l2 = e[0] * e[0] + e[1] * e[1] || 1, t = clamp(((q[0] - pc.a[0]) * e[0] + (q[1] - pc.a[1]) * e[1]) / l2, 0, 1);
        best = Math.min(best, dist(q, add(pc.a, mul(e, t))));
      } else if (inArc(pc, q[0], q[1])) best = Math.min(best, Math.abs(dist(q, pc.c) - pc.r));
      else for (const a of [pc.a0, pc.a1]) best = Math.min(best, dist(q, add(pc.c, mul([Math.cos(a), Math.sin(a)], pc.r))));
    }
    return best;
  }

  // ---------- Elements ----------
  // Every element is plain data: { type, shape: [pieces], name, label, ... }.
  const common = (el, o) => Object.assign(el, {
    name: o.name ?? el.name ?? null, label: o.label ?? null, labelAt: o.labelAt ? pt(o.labelAt) : null,
    color: o.color ?? el.color ?? null, hidden: !!o.hidden,
  });
  function body(shape, o = {}, extra = {}) {
    const el = common({ type: "body", shape: [].concat(shape).map(pc => ({ ...pc })), n: o.n ?? "bk7", tint: o.tint ?? "blue", ...extra }, o);
    material(el.n);
    el.box = bbox(el.shape);
    // Which way is out: probe just off each piece's middle.
    const h = hypot(el.box[2] - el.box[0], el.box[3] - el.box[1]) * 1e-5;
    for (const pc of el.shape) { const [m, u] = midOf(pc); pc.out = inside(el, m[0] + u[0] * h, m[1] + u[1] * h) ? -1 : 1; }
    return el;
  }
  const polygon = (points, o = {}) => body(points.map((p, i) => segment(p, points[(i + 1) % points.length])), o);
  function slab(c, w, h, o = {}) {
    const a = (o.angle ?? 0) * DEG;
    return polygon([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(p => add(rotate(p, a), c)), o);
  }
  // Isosceles prism with its apex up (before o.angle turns it), size = the length of its two equal sides.
  function prism(c, size, o = {}) {
    const A = ((o.apex ?? 60) * DEG) / 2, b = size * Math.sin(A), H = size * Math.cos(A), a = (o.angle ?? 0) * DEG;
    return polygon([[0, (2 * H) / 3], [-b, -H / 3], [b, -H / 3]].map(p => add(rotate(p, a), c)), o);
  }
  const circle = (c, r, o = {}) => body([arcR(c, r, 0, TAU)], o);
  const drop = (c, r, o = {}) => circle(c, r, { n: "water", ...o });
  // Half disc: the curved side faces o.angle (degrees), the flat side goes through c.
  function semicircle(c, r, o = {}) {
    const a = (o.angle ?? 0) * DEG, e0 = add(c, rotate([0, -r], a)), e1 = add(c, rotate([0, r], a));
    return body([arcR(c, r, a - Math.PI / 2, a + Math.PI / 2), segment(e1, e0)], o);
  }
  // Two spherical faces in local coordinates (axis +x, vertices at -d/2 and d/2), cut at half height h.
  function lensShape(R1, R2, d, h) {
    const x1 = -d / 2, x2 = d / 2;
    const sag = (xv, R, y) => (Number.isFinite(R) ? xv + R - Math.sign(R) * Math.sqrt(Math.max(0, R * R - y * y)) : xv);
    h = Math.min(h, Math.min(Number.isFinite(R1) ? Math.abs(R1) : Infinity, Number.isFinite(R2) ? Math.abs(R2) : Infinity) * 0.999);
    const edge = y => sag(x2, R2, y) - sag(x1, R1, y);
    if (edge(h) < 0) { let lo = 0, hi = h; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (edge(m) > 0) lo = m; else hi = m; } h = lo; }
    const face = (xv, R) => {
      if (!Number.isFinite(R)) return segment([xv, -h], [xv, h]);
      const al = Math.asin(h / Math.abs(R)), mid = R > 0 ? Math.PI : 0;
      return arcR([xv + R, 0], R, mid - al, mid + al);
    };
    const rim = edge(h) > 1e-9 * Math.max(d, 1e-9);
    const shape = [face(x1, R1)];
    if (rim) shape.push(segment([sag(x1, R1, h), h], [sag(x2, R2, h), h]));
    shape.push(face(x2, R2));
    if (rim) shape.push(segment([sag(x2, R2, -h), -h], [sag(x1, R1, -h), -h]));
    return { shape, h };
  }
  // A real lens: { f } (equal radii, solved from the thick-lens equation) or { R1, R2 }, with thickness and aperture.
  // Without o.thickness the center is made thick enough to leave a thin rim at the full aperture.
  function lens(c, o = {}) {
    const n = o.n ?? "bk7", nd = index(n);
    let R1 = o.R1 ?? Infinity, R2 = o.R2 ?? Infinity;
    const ap = o.aperture ?? (o.f != null ? Math.abs(o.f) * 0.5 : Math.min(Math.abs(R1), Math.abs(R2), 2) * 0.8), h = ap / 2;
    const bulge = R => (Number.isFinite(R) ? Math.sign(R) * (Math.abs(R) - Math.sqrt(Math.max(0, R * R - h * h))) : 0);
    const radii = d => { if (o.f == null) return; const k = 1 - d / (nd * o.f), R = k >= 0 ? o.f * (nd - 1) * (1 + Math.sqrt(k)) : 2 * o.f * (nd - 1); R1 = R; R2 = -R; };
    let d = o.thickness ?? ap * 0.1;
    radii(d);
    if (o.thickness == null) for (let i = 0; i < 30; i++) { d = (d + Math.max(ap * 0.1, bulge(R1) - bulge(R2) + ap * 0.04)) / 2; radii(d); }
    const a = (o.angle ?? 0) * DEG, { shape } = lensShape(R1, R2, d, ap / 2);
    return body(shape.map(pc => place(pc, pt(c), a)), o, { optic: { kind: "thick", c: pt(c), axis: dirOf(o.angle ?? 0), R1, R2, d, n } });
  }
  // A mirror segment. The silvered face is on the left going from a to b (world y up); the back absorbs.
  const mirror = (a, b, o = {}) => common({ type: "mirror", shape: [segment(a, b)], face: o.twoSided ? 0 : o.flip ? -1 : 1, reflectance: o.reflectance ?? 1 }, o);
  // A spherical mirror with its vertex at `vertex`, facing o.facing (degrees). R > 0 is concave, R < 0 convex; f = R / 2.
  function curvedMirror(vertex, R, o = {}) {
    const u = dirOf(o.facing ?? 180), r = Math.abs(R), ap = Math.min(o.aperture ?? r * 0.9, 2 * r * 0.999), al = Math.asin(ap / (2 * r));
    const c = add(vertex, mul(u, R)), toV = Math.atan2(vertex[1] - c[1], vertex[0] - c[0]);
    return common({ type: "mirror", shape: [arcR(c, r, toV - al, toV + al)], face: R > 0 ? -1 : 1, reflectance: o.reflectance ?? 1, optic: { kind: "mirror", vertex: pt(vertex), axis: u, R } }, o);
  }
  // An ideal thin lens: every ray through height h leaves with its slope changed by -h/f. No aberration, no color.
  function thinLens(c, f, o = {}) {
    const ax = dirOf(o.angle ?? 0), v = [-ax[1], ax[0]], h = (o.aperture ?? Math.abs(f) * 0.8) / 2;
    return common({ type: "lens", shape: [segment(sub(c, mul(v, h)), add(c, mul(v, h)))], f, c: pt(c), axis: ax, v, optic: { kind: "thin", c: pt(c), axis: ax, f } }, o);
  }
  // Absorbers: walls stop light, screens and sensors also record where it lands.
  function absorber(style, a, b, o) {
    let shape;
    if (a && (a.k || (Array.isArray(a) && a[0] && a[0].k))) { shape = [].concat(a).map(pc => ({ ...pc })); o = b; }
    else shape = [segment(a, b)];
    o = o ?? {};
    return common({ type: "absorber", style, shape, record: style !== "wall", width: o.width ?? null }, o);
  }
  const wall = (a, b, o) => absorber("wall", a, b, o);
  const screen = (a, b, o) => absorber("screen", a, b, o);
  const sensor = (a, b, o) => absorber("sensor", a, b, o);

  // ---------- Sources ----------
  // A source is plain data: { type: "source", rays: [[x, y, dx, dy], ...], wl, I, color, temperature }.
  // wl: undefined (one color, index at the d line), a wavelength in nm, a list, or "white".
  // temperature: the color of a hot source in kelvin (a lamp, a candle, the Sun) when there's no wl or color.
  const wlOf = w => (w == null ? null : w === "white" ? WHITE.slice() : Array.isArray(w) ? w.slice() : +w);
  const source = (kind, rays, o, at) => ({ type: "source", kind, at: at ? pt(at) : null, rays, wl: wlOf(o.wl), I: o.I ?? 1, color: o.color ?? null, temperature: o.temperature ?? null, name: o.name ?? null, marker: o.marker ?? kind !== "beam" });
  const ray = (p, dir, o = {}) => { const d = dirOf(dir); return source("ray", [[p[0], p[1], d[0], d[1]]], o, p); };
  function beam(p, dir, width, o = {}) {
    const d = dirOf(dir), v = [-d[1], d[0]], n = Math.max(1, o.n ?? 9), rays = [];
    for (let k = 0; k < n; k++) { const s = n === 1 ? 0 : (k / (n - 1) - 0.5) * width; rays.push([p[0] + v[0] * s, p[1] + v[1] * s, d[0], d[1]]); }
    return source("beam", rays, o, p);
  }
  function fan(p, dir, spread, o = {}) {
    const n = Math.max(1, o.n ?? 9), a0 = typeof dir === "number" ? dir : Math.atan2(dir[1], dir[0]) / DEG, full = spread >= 360, rays = [];
    for (let k = 0; k < n; k++) {
      const a = full ? a0 + (360 * k) / n : n === 1 ? a0 : a0 + (k / (n - 1) - 0.5) * spread, d = dirOf(a);
      rays.push([p[0], p[1], d[0], d[1]]);
    }
    return source("fan", rays, o, p);
  }
  // Rays from p through n evenly spaced points from a to b: a point source filling an aperture.
  function fanTo(p, a, b, o = {}) {
    const n = Math.max(1, o.n ?? 9), rays = [];
    for (let k = 0; k < n; k++) { const t = n === 1 ? 0.5 : k / (n - 1), d = unit(sub([lerp(a[0], b[0], t), lerp(a[1], b[1], t)], p)); rays.push([p[0], p[1], d[0], d[1]]); }
    return source("fan", rays, o, p);
  }

  // ---------- Tracing ----------
  function flatten(scene, out = []) {
    for (const it of [].concat(scene ?? [])) {
      if (!it) continue;
      if (Array.isArray(it)) flatten(it, out);
      else if (it.type === "eye") flatten(it.items, out);
      else out.push(it);
    }
    return out;
  }
  function split(scene) {
    const items = flatten(scene);
    return { els: items.filter(e => e.type !== "source" && e.shape), srcs: items.filter(e => e.type === "source") };
  }
  const keyOf = (el, ei) => el.name ?? String(ei);

  // o: depth [24] interactions per path, minI [0.01] intensity below which a ray is dropped,
  // fresnel [true] (false: no partial reflections, only total internal reflection),
  // n0 [1] the surrounding medium, far (how far escaping rays run), maxSegments [6000].
  function trace(scene, o = {}) {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const { els, srcs } = split(scene);
    const maxDepth = o.depth ?? 24, minI = o.minI ?? 0.01, maxSeg = o.maxSegments ?? 6000, useFresnel = o.fresnel !== false, n0 = o.n0 ?? 1;
    const B = [Infinity, Infinity, -Infinity, -Infinity];
    for (const el of els) { const b = el.box ?? bbox(el.shape); B[0] = Math.min(B[0], b[0]); B[1] = Math.min(B[1], b[1]); B[2] = Math.max(B[2], b[2]); B[3] = Math.max(B[3], b[3]); }
    for (const s of srcs) for (const r of s.rays) { B[0] = Math.min(B[0], r[0]); B[1] = Math.min(B[1], r[1]); B[2] = Math.max(B[2], r[0]); B[3] = Math.max(B[3], r[1]); }
    const ext = Math.max(1e-6, Number.isFinite(B[0]) ? hypot(B[2] - B[0], B[3] - B[1]) : 1), eps = ext * 1e-9, far = o.far ?? ext * 20;
    const pieces = [];
    els.forEach((el, ei) => { if (!el.box) el = els[ei] = { ...el, box: bbox(el.shape) }; for (const pc of el.shape) pieces.push(pc, ei); });
    const bodies = [];
    els.forEach((el, ei) => { if (el.type === "body") bodies.push(ei); });
    const mediumAt = (x, y, skip) => { for (let k = bodies.length - 1; k >= 0; k--) { const ei = bodies[k]; if (ei !== skip && inside(els[ei], x, y)) return ei; } return -1; };
    const matOf = med => (med < 0 ? n0 : els[med].n);
    const names = els.map(keyOf);
    const segments = [], hits = [], sensors = {}, energy = { escaped: 0, absorbed: 0, lost: 0 };
    els.forEach((el, ei) => { if (el.record) sensors[names[ei]] = []; });
    const stack = [];
    srcs.forEach((s, si) => s.rays.forEach((r, ri) => {
      const band = Array.isArray(s.wl) ? s.wl : null, d = unit([r[2], r[3]]);
      stack.push({ x: r[0], y: r[1], dx: d[0], dy: d[1], I: s.I, wl: band ? null : s.wl, band, med: mediumAt(r[0], r[1], -1), depth: 0, via: "", src: si, ray: ri, color: s.color, L: 0 });
    }));
    stack.reverse();
    // Each ray carries the optical path length from its source (geometric length times index),
    // so equal values across neighboring rays are a wavefront.
    const spawn = (r, x, y, d, I, wl, band, med, ch, dL = 0) => {
      if (I < minI) { energy.lost += I; return; }
      d = unit(d);
      stack.push({ x, y, dx: d[0], dy: d[1], I, wl, band, med, depth: r.depth + 1, via: r.via + ch, src: r.src, ray: r.ray, color: r.color, L: r.Lend + dL });
    };
    const record = (kind, r, x, y, ei, nn) => {
      const h = { p: [x, y], kind, el: ei, name: names[ei], normal: nn, din: [r.dx, r.dy], i: Math.acos(clamp(-(r.dx * nn[0] + r.dy * nn[1]), -1, 1)) / DEG,
        t: null, dout: null, dr: null, R: null, n1: null, n2: null, I: r.I, wl: r.wl, band: r.band, depth: r.depth, via: r.via, src: r.src, ray: r.ray };
      hits.push(h);
      return h;
    };
    const refl = (r, nn) => { const ci = -(r.dx * nn[0] + r.dy * nn[1]); return [r.dx + 2 * ci * nn[0], r.dy + 2 * ci * nn[1]]; };
    const refr = (r, nn, n1, n2, ct) => { const ci = -(r.dx * nn[0] + r.dy * nn[1]), k = n1 / n2, m = k * ci - ct; return [k * r.dx + m * nn[0], k * r.dy + m * nn[1]]; };

    let truncated = false;
    while (stack.length) {
      if (segments.length >= maxSeg) { truncated = true; for (const r of stack) energy.lost += r.I; break; }
      const r = stack.pop();
      let best = far, bi = -1;
      for (let k = 0; k < pieces.length; k += 2) { const t = cast(pieces[k], r.x, r.y, r.dx, r.dy, eps); if (t < best) { best = t; bi = k; } }
      const x = r.x + r.dx * best, y = r.y + r.dy * best;
      r.Lend = r.L + best * index(matOf(r.med), r.wl ?? D_LINE);
      const sg = { a: [r.x, r.y], b: [x, y], I: r.I, wl: r.wl, band: r.band, depth: r.depth, via: r.via, src: r.src, ray: r.ray, med: r.med, color: r.color, end: "escape", opl: [r.L, r.Lend] };
      segments.push(sg);
      if (bi < 0) { energy.escaped += r.I; continue; }
      const pc = pieces[bi], ei = pieces[bi + 1], el = els[ei];
      sg.end = el.type;
      if (r.depth >= maxDepth) { sg.end = "depth"; energy.lost += r.I; continue; }
      const N = normalAt(pc, x, y), cosN = r.dx * N[0] + r.dy * N[1], nn = cosN < 0 ? N : [-N[0], -N[1]];

      if (el.type === "body") {
        const entering = cosN * (pc.out ?? 1) < 0;
        const medOut = entering ? ei : mediumAt(x + r.dx * eps * 50, y + r.dy * eps * 50, ei);
        const m1 = matOf(r.med), m2 = matOf(medOut), ci = -(r.dx * nn[0] + r.dy * nn[1]);
        if (r.band && (dispersive(m1) || dispersive(m2))) {
          // White light splits into its colors here; the reflected part stays white.
          let Rsum = 0;
          const parts = r.band.map(wl => { const n1 = index(m1, wl), n2 = index(m2, wl), f = fres(n1, n2, ci); Rsum += useFresnel || f.tir ? f.R : 0; return { wl, n1, n2, f }; });
          const R = Rsum / parts.length, mid = parts[parts.length >> 1];
          const h = Object.assign(record("refract", r, x, y, ei, nn), { n1: mid.n1, n2: mid.n2, R, t: mid.f.tir ? null : Math.acos(mid.f.ct) / DEG, dr: refl(r, nn) });
          if (parts.every(q => q.f.tir)) { h.kind = "tir"; h.dout = h.dr; }
          else h.dout = unit(refr(r, nn, mid.n1, mid.n2, mid.f.ct));
          spawn(r, x, y, h.dr, r.I * R, null, r.band, r.med, "R");
          for (const q of parts) if (!q.f.tir) spawn(r, x, y, refr(r, nn, q.n1, q.n2, q.f.ct), r.I * (useFresnel ? q.f.T : 1), q.wl, null, medOut, "T");
        } else {
          const wl = r.wl ?? (r.band ? r.band[r.band.length >> 1] : null), n1 = index(m1, wl), n2 = index(m2, wl), f = fres(n1, n2, ci);
          const R = useFresnel || f.tir ? f.R : 0, dr = refl(r, nn);
          const h = record(f.tir ? "tir" : "refract", r, x, y, ei, nn);
          h.n1 = n1; h.n2 = n2; h.R = R; h.dr = dr; h.t = f.tir ? null : Math.acos(f.ct) / DEG;
          if (f.tir) h.dout = dr;
          spawn(r, x, y, dr, r.I * R, r.wl, r.band, r.med, "R");
          if (!f.tir) { h.dout = unit(refr(r, nn, n1, n2, f.ct)); spawn(r, x, y, h.dout, r.I * (1 - R), r.wl, r.band, medOut, "T"); }
        }
      } else if (el.type === "mirror") {
        const F = el.face ? mul(N, el.face) : null;
        if (F && r.dx * F[0] + r.dy * F[1] > 0) { record("absorb", r, x, y, ei, nn); energy.absorbed += r.I; sg.end = "absorber"; continue; }
        const dr = refl(r, nn), R = el.reflectance ?? 1;
        const h = record("mirror", r, x, y, ei, nn);
        h.dout = h.dr = dr; h.R = R;
        spawn(r, x, y, dr, r.I * R, r.wl, r.band, r.med, "M");
        if (R < 1) spawn(r, x, y, [r.dx, r.dy], r.I * (1 - R), r.wl, r.band, r.med, "P");
      } else if (el.type === "lens") {
        const du = r.dx * el.axis[0] + r.dy * el.axis[1], dv = r.dx * el.v[0] + r.dy * el.v[1];
        const h = (x - el.c[0]) * el.v[0] + (y - el.c[1]) * el.v[1];
        let d = [r.dx, r.dy];
        if (Math.abs(du) > 1e-12) { const sgn = Math.sign(du), s2 = dv / Math.abs(du) - h / el.f; d = unit(add(mul(el.axis, sgn), mul(el.v, s2))); }
        record("lens", r, x, y, ei, nn).dout = d;
        spawn(r, x, y, d, r.I, r.wl, r.band, r.med, "L", (-h * h) / (2 * el.f));   // an ideal lens delays the center by h²/2f
      } else {
        record(el.record ? "sensor" : "absorb", r, x, y, ei, nn);
        energy.absorbed += r.I;
        if (el.record) {
          const at = el.shape.indexOf(pc);
          let s;
          if (pc.k === "seg") { const e = sub(pc.b, pc.a); s = ((x - pc.a[0]) * e[0] + (y - pc.a[1]) * e[1]) / (e[0] * e[0] + e[1] * e[1]); }
          else { let d = (Math.atan2(y - pc.c[1], x - pc.c[0]) - pc.a0) % TAU; if (d < 0) d += TAU; s = d / (pc.a1 - pc.a0); }
          sensors[names[ei]].push({ p: [x, y], t: (at + clamp(s, 0, 1)) / el.shape.length, I: r.I, wl: r.wl, band: r.band, dir: [r.dx, r.dy], src: r.src, ray: r.ray, via: r.via });
        }
      }
    }
    return { segments, hits, sensors, energy, truncated, ms: typeof performance !== "undefined" ? performance.now() - t0 : 0 };
  }

  // Where a bundle of rays comes closest to meeting: the least-squares point of the lines.
  // lines: segments ({ a, b }), hits or sensor records ({ p, din | dir }), or { p, d }.
  function focus(lines) {
    let sxx = 0, sxy = 0, syy = 0, bx = 0, by = 0, n = 0;
    const L = [];
    for (const l of lines ?? []) {
      const p = l.a ?? l.p, d = unit(l.b ? sub(l.b, l.a) : l.d ?? l.din ?? l.dir);
      if (!p || !Number.isFinite(d[0])) continue;
      const m11 = 1 - d[0] * d[0], m12 = -d[0] * d[1], m22 = 1 - d[1] * d[1];
      sxx += m11; sxy += m12; syy += m22; bx += m11 * p[0] + m12 * p[1]; by += m12 * p[0] + m22 * p[1]; n++;
      L.push([p, d]);
    }
    const det = sxx * syy - sxy * sxy;
    if (n < 2 || Math.abs(det) < 1e-9 * (sxx + syy) ** 2) return null;
    const q = [(syy * bx - sxy * by) / det, (sxx * by - sxy * bx) / det];
    let e = 0;
    for (const [p, d] of L) { const w = sub(q, p), c = w[0] * d[1] - w[1] * d[0]; e += c * c; }
    return { p: q, rms: Math.sqrt(e / n), n };
  }
  // Centroid and size of a set of landing points (sensor records or [x, y]).
  function spot(points) {
    const ps = (points ?? []).map(q => q.p ?? q);
    if (!ps.length) return null;
    const c = [ps.reduce((s, q) => s + q[0], 0) / ps.length, ps.reduce((s, q) => s + q[1], 0) / ps.length];
    let e = 0, w = 0;
    for (const q of ps) { const r = dist(q, c); e += r * r; w = Math.max(w, r); }
    return { center: c, rms: Math.sqrt(e / ps.length), width: 2 * w, n: ps.length };
  }

  // ---------- Eye ----------
  // The Gullstrand-Emsley simplified schematic eye, in mm, cornea vertex at the origin, light along +x:
  // one corneal surface (r 7.8) into aqueous of 1.333, a lens of 1.416, vitreous of 1.333, retina at 23.9.
  // Accommodating, the lens front moves from 3.6 to 3.2 mm and its radii go from 10 / −6 to 5 / −5 mm.
  const EYE = { rc: 7.8, nAq: 1.3333, nLens: 1.416, nGlass: 1.498, length: 23.896, globe: 11.5, iris: 2.9,
    relaxed: [3.6, 1 / 10, 7.2, -1 / 6], near: [3.2, 1 / 5, 7.2, -1 / 5] };
  function eyeSurfaces(t, gl) {
    const [x1a, c1a, x2a, c2a] = EYE.relaxed, [x1b, c1b, x2b, c2b] = EYE.near, s = [];
    if (gl) s.push({ x: -gl.vertex - gl.d, c: 1 / gl.R1, n: EYE.nGlass }, { x: -gl.vertex, c: 1 / gl.R2, n: 1 });
    s.push({ x: 0, c: 1 / EYE.rc, n: EYE.nAq }, { x: lerp(x1a, x1b, t), c: lerp(c1a, c1b, t), n: EYE.nLens }, { x: lerp(x2a, x2b, t), c: lerp(c2a, c2b, t), n: EYE.nAq });
    return s;
  }
  // Paraxial system matrix in (height, n × angle) from the first surface to the plane x = xEnd.
  function system(surfs, xEnd) {
    let A = 1, B = 0, C = 0, D = 1, n = 1, x = surfs[0].x;
    for (const s of surfs) {
      const t = (s.x - x) / n; A += t * C; B += t * D;
      const P = (s.n - n) * s.c; C -= P * A; D -= P * B;
      n = s.n; x = s.x;
    }
    const t = (xEnd - x) / n; A += t * C; B += t * D;
    return { A, B, C, D, n };
  }
  // The object distance in front of the cornea (mm) that is sharp on a retina at x = L. Negative: virtual, behind the eye.
  function focusDistance(surfs, L) {
    const M = system(surfs, L);
    return Math.abs(M.A) < 1e-12 ? Infinity : -M.B / M.A - surfs[0].x;
  }
  // Where the image of an object s mm in front of the first surface forms (x, mm).
  function imageX(surfs, s) {
    const last = surfs[surfs.length - 1].x, M = system(surfs, last);
    const y = Number.isFinite(s) ? M.A * s + M.B : M.A, nu = Number.isFinite(s) ? M.C * s + M.D : M.C;
    return Math.abs(nu) < 1e-15 ? Infinity : last - (y * M.n) / nu;
  }
  const vergence = d => (Number.isFinite(d) ? 1000 / d : 0);
  function glassesGeom(g) {
    if (g == null || g === false) return null;
    const power = typeof g === "number" ? g : g.power ?? 0, vertex = typeof g === "number" ? 12 : g.vertex ?? 12;
    if (!power) return { power: 0, vertex, d: 1.5, R1: Infinity, R2: Infinity };
    const f = 1000 / power, d = power > 0 ? 1.5 + Math.min(4, power * 0.25) : 1.2, k = 1 - d / (EYE.nGlass * f);
    const R = k >= 0 ? f * (EYE.nGlass - 1) * (1 + Math.sqrt(k)) : 2 * f * (EYE.nGlass - 1);
    return { power, vertex, d, R1: R, R2: -R };
  }
  // o: at [0, 0] (cornea vertex, mm), accommodation [0] diopters, amplitude (the most this eye can
  // accommodate, D), error [0] (refractive error at the cornea in D, −3 = 3 D nearsighted; sets the
  // eye's length) or length (mm), pupil [3] mm, glasses (power in D, or { power, vertex [12] }).
  function eye(o = {}) {
    const at = pt(o.at ?? [0, 0]), gl = glassesGeom(o.glasses), pupil = o.pupil ?? 3, rx = o.error ?? 0;
    const L = o.length ?? (rx ? imageX(eyeSurfaces(0, null), -1000 / rx) : imageX(eyeSurfaces(0, null), Infinity));
    const K = t => vergence(focusDistance(eyeSurfaces(t, null), L)), K0 = K(0);
    const amplitude = clamp(o.amplitude ?? Infinity, 0, K(1) - K0);
    const solve = A => { if (A <= 0) return 0; let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (K(m) - K0 < A) lo = m; else hi = m; } return (lo + hi) / 2; };
    const accommodation = clamp(o.accommodation ?? 0, 0, amplitude), t = solve(accommodation);
    const surfaces = eyeSurfaces(t, gl);
    const farPoint = focusDistance(eyeSurfaces(0, gl), L), nearPoint = focusDistance(eyeSurfaces(solve(amplitude), gl), L);
    const bare = system(eyeSurfaces(t, null), surfaces[surfaces.length - 1].x);

    // Geometry. The globe is the cornea's sphere joined to a sphere for the sclera that ends at the retina.
    const W = p => add(at, p), rc = EYE.rc, rg = EYE.globe + (L - EYE.length) * 0.5, cg = L - rg;
    const xj = (cg * cg - rg * rg) / (2 * (cg - rc)), yj = Math.sqrt(Math.max(0, rc * rc - (xj - rc) ** 2));
    const al = Math.atan2(yj, rc - xj), be = Math.atan2(yj, xj - cg), rIn = rg - 0.06;
    const half = x => Math.max(x > xj ? Math.sqrt(Math.max(0, rg * rg - (x - cg) ** 2)) : 0, Math.sqrt(Math.max(0, rc * rc - (x - rc) ** 2)));
    const items = [];
    items.push(body([arcR(W([rc, 0]), rc, Math.PI - al, Math.PI + al), arcR(W([cg, 0]), rg, -be, be)], { n: EYE.nAq, tint: "blue", name: "eye", label: o.labels === false ? null : "cornea", labelAt: W([-2.2, 6.2]) }));
    const [x1, c1, x2, c2] = [surfaces[surfaces.length - 2].x, surfaces[surfaces.length - 2].c, surfaces[surfaces.length - 1].x, surfaces[surfaces.length - 1].c];
    const ls = lensShape(1 / c1, 1 / c2, x2 - x1, 4.3);
    items.push(body(ls.shape.map(pc => place(pc, W([(x1 + x2) / 2, 0]), 0)), { n: EYE.nLens, tint: "blue", name: "lens", label: o.labels === false ? null : "lens", labelAt: W([(x1 + x2) / 2, -ls.h - 1.6]) }));
    const yi = half(EYE.iris) - 0.03;
    for (const s of [1, -1]) items.push(absorber("wall", W([EYE.iris, (s * pupil) / 2]), W([EYE.iris, s * yi]), { name: "iris", width: 4 }));
    const ret = Math.min(70 * DEG, be - 0.2);
    items.push(absorber("sensor", arcR(W([cg, 0]), rIn, -ret, ret), { name: "retina", color: "red", label: o.labels === false ? null : "retina", labelAt: W([L + 1.5, rg * 0.62]) }));
    items.push(absorber("wall", [arcR(W([cg, 0]), rIn, ret, be - 0.04), arcR(W([cg, 0]), rIn, -be + 0.04, -ret)], { name: "sclera", hidden: true }));
    if (gl) {
      const shape = lensShape(gl.R1, gl.R2, gl.d, 10).shape.map(pc => place(pc, W([-gl.vertex - gl.d / 2, 0]), 0));
      items.push(body(shape, { n: EYE.nGlass, tint: "blue", name: "glasses", label: o.labels === false ? null : "glasses", labelAt: W([-gl.vertex - gl.d / 2, 12]) }));
    }
    return {
      type: "eye", at, length: L, retina: W([L, 0]), pupil, accommodation, amplitude, t, error: -vergence(focusDistance(eyeSurfaces(0, null), L)) || 0,
      glasses: gl ? { power: gl.power, vertex: gl.vertex } : null, power: -bare.C * 1000,
      farPoint, nearPoint, surfaces, items,
    };
  }
  // Light from an object `distance` mm in front of the cornea (Infinity: a parallel beam), filling the pupil.
  function eyeLight(E, distance = Infinity, o = {}) {
    const half = (E.pupil / 2) * (o.fill ?? 1.12), [x0, y0] = E.at, n = o.n ?? 9;
    if (!Number.isFinite(distance)) return beam([x0 - (o.from ?? (E.glasses ? E.glasses.vertex + 10 : 12)), y0 + (o.height ?? 0)], 0, 2 * half, { ...o, n });
    return fanTo([x0 - distance, y0 + (o.height ?? 0)], [x0, y0 - half], [x0, y0 + half], { ...o, n });
  }
  // Is an object at `distance` mm sharp? Paraxial, through the eye as it is now (lens, glasses).
  // diopters > 0: the focus falls behind the retina (needs more power); < 0: in front of it.
  function eyeFocus(E, distance = Infinity) {
    const s = E.surfaces, sFirst = Number.isFinite(distance) ? distance + s[0].x : Infinity;
    const img = imageX(s, sFirst), D = vergence(distance) - vergence(focusDistance(s, E.length));
    return { image: E.at[0] + img, retina: E.at[0] + E.length, defocus: img - E.length, diopters: D, sharp: Math.abs(D) <= 0.25,
      where: Math.abs(D) <= 0.25 ? "on" : D < 0 ? "front" : "behind", focusDistance: focusDistance(s, E.length) };
  }
  // Spectacle power (D) at `vertex` mm that moves the naked eye's far point to infinity.
  function correction(E, vertex = 12) {
    const F = focusDistance(eyeSurfaces(0, null), E.length);
    return Number.isFinite(F) ? 1000 / (vertex - F) : 0;
  }

  // ---------- Drawing helpers on g ----------
  (window.__safisG ||= []).push((g, util) => {
    let lastP = null;
    const dark = () => { const [r, gg, b] = util.rgb("panel"); return 0.2126 * r + 0.7152 * gg + 0.0722 * b < 110; };
    const cache = new Map();
    const spectral = (nm, dk) => { const k = `${nm}|${dk}`; let c = cache.get(k); if (!c) { c = wavelengthColor(nm, { on: dk ? "dark" : "light" }); cache.set(k, c); } return c; };
    g.wavelengthColor = nm => spectral(nm, dark());
    const ident = q => q, ORIGIN = [0, 0], ONE = [1, 1];
    const scaleOf = P => P.sx ?? (dist(P([1, 0]), P([0, 0])) || 1);
    const dirPx = (P, p, d) => unit(sub(P(add(p, d)), P(p)));
    function piecePx(pc, P, sc) {
      if (pc.k === "seg") return [P(pc.a), P(pc.b)];
      const sweep = pc.a1 - pc.a0, n = clamp(Math.ceil((sweep * pc.r * sc) / 3), 6, 240), out = [];
      for (let i = 0; i <= n; i++) { const t = pc.a0 + (sweep * i) / n; out.push(P([pc.c[0] + pc.r * Math.cos(t), pc.c[1] + pc.r * Math.sin(t)])); }
      return out;
    }
    // The outline of a body as one closed polyline, joining pieces end to end.
    function outline(el, P, sc) {
      const parts = el.shape.map(pc => piecePx(pc, P, sc));
      if (parts.length > 1) {
        const a = parts[0], b = parts[1], ends = [b[0], b[b.length - 1]];
        if (Math.min(...ends.map(q => dist(a[0], q))) < Math.min(...ends.map(q => dist(a[a.length - 1], q)))) a.reverse();
      }
      const pts = [];
      for (const q of parts) { if (pts.length && dist(pts[pts.length - 1], q[q.length - 1]) < dist(pts[pts.length - 1], q[0])) q.reverse(); pts.push(...q); }
      return pts;
    }
    // A strip w px wide along a polyline, for walls, screens, and sensors.
    function strip(pts, w) {
      const L = [], R = [];
      pts.forEach((p, i) => {
        const t = unit(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
        L.push([p[0] - (t[1] * w) / 2, p[1] + (t[0] * w) / 2]); R.push([p[0] + (t[1] * w) / 2, p[1] - (t[0] * w) / 2]);
      });
      return [...L, ...R.reverse()];
    }
    function clipSeg(a, b, box) {
      let t0 = 0, t1 = 1;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      for (const [p, q] of [[-dx, a[0] - box[0]], [dx, box[0] + box[2] - a[0]], [-dy, a[1] - box[1]], [dy, box[1] + box[3] - a[1]]]) {
        if (p === 0) { if (q < 0) return null; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return null; t0 = Math.max(t0, r); } else { if (r < t0) return null; t1 = Math.min(t1, r); }
      }
      return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
    }
    const tri = (tip, u, size) => {
      const b = sub(tip, mul(u, size)), w = size * 0.45;
      g.ctx.beginPath(); g.ctx.moveTo(tip[0], tip[1]); g.ctx.lineTo(b[0] - u[1] * w, b[1] + u[0] * w); g.ctx.lineTo(b[0] + u[1] * w, b[1] - u[0] * w); g.ctx.closePath(); g.ctx.fill();
    };
    const fillAlpha = (el, dk) => clamp(0.05 + 0.12 * (index(el.n) - 1), 0.07, 0.22) * (dk ? 1.5 : 1);

    // ---------- Light ----------
    // Rays draw as light. On dark pages each one is added to what's under it as a wide faint
    // bloom, a glow, and a thin core whitened from its color, so rays that cross brighten and a
    // focus or a caustic burns white. On light pages the glow deepens the paper (multiply) under
    // a saturated core. Photons ride the traced paths, slowing to c/n in glass.
    const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
    const checkingNow = () => typeof document !== "undefined" && document.documentElement.classList.contains("safis-checking");
    const css = c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    const lights = new Map();
    // A light's colors: glow, core, and a sprite for photons and sources, made once per color and page tone.
    function lightOf(c, dk) {
      const key = `${c[0]},${c[1]},${c[2]}|${dk ? 1 : 0}`;
      let L = lights.get(key);
      if (L) return L;
      let glow, core;
      if (dk) { glow = c; core = c.map(v => Math.round(v + (255 - v) * 0.6)); }
      else {
        // White light can't show on white paper: it draws as a warm neutral instead. Pale colors
        // deepen so they read on paper; the palette's own colors are already made for it.
        const base = Math.min(c[0], c[1], c[2]) > 190 ? [190, 148, 56] : c;
        const lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2], k = 1 + 0.45 * clamp((lum - 110) / 110, 0, 1);
        glow = base.map(v => Math.round(clamp(255 - (255 - v) * Math.max(1, k * 0.85), 0, 255)));
        core = base.map(v => Math.round(clamp(255 - (255 - v) * k, 0, 255)));
      }
      L = { glow: css(glow), core: css(core), g3: glow, c3: core, dk, sprite: null, tr: [], hd: [] };
      lights.set(key, L);
      return L;
    }
    function spriteOf(L) {
      if (L.sprite !== null) return L.sprite;
      const S = 48, cv = typeof document !== "undefined" ? document.createElement("canvas") : null;
      if (!cv) return (L.sprite = false);
      cv.width = cv.height = S;
      const c = cv.getContext("2d"), gr = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      const [r, gg, b] = L.g3, [cr, cg, cb] = L.c3;
      if (L.dk) {
        gr.addColorStop(0, "rgba(255, 255, 255, 1)"); gr.addColorStop(0.1, `rgba(${cr}, ${cg}, ${cb}, 0.95)`);
        gr.addColorStop(0.3, `rgba(${r}, ${gg}, ${b}, 0.4)`); gr.addColorStop(0.6, `rgba(${r}, ${gg}, ${b}, 0.1)`); gr.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
      } else {
        gr.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 1)`); gr.addColorStop(0.18, `rgba(${cr}, ${cg}, ${cb}, 0.85)`);
        gr.addColorStop(0.45, `rgba(${r}, ${gg}, ${b}, 0.22)`); gr.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
      }
      c.fillStyle = gr; c.fillRect(0, 0, S, S);
      return (L.sprite = cv);
    }
    // A fixed pseudo-random number in [0, 1) for three integers: which photons a ray carries,
    // where along it they sit, and which way each one goes at a split.
    const hash = (a, b, c) => {
      let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
      return (h >>> 0) / 4294967296;
    };
    // A few recent traces by scene, so a figure redrawn every frame for its photons doesn't
    // retrace a scene that hasn't changed.
    const traces = [];
    const layers = [];
    let frameAt = -1, calls = 0, idleTimer = 0, traceIds = 0;
    function traceOf(scene, o) {
      let key;
      try { key = JSON.stringify([scene, o.depth, o.minI, o.fresnel, o.n0, o.far, o.maxSegments]); } catch { return trace(scene, o); }
      for (const c of traces) if (c.key === key) return c.T;
      const T = trace(scene, o);
      traces.unshift({ key, T });
      if (traces.length > 4) traces.pop();
      return T;
    }

    // Glass: a tint that deepens toward the bottom (the thickness light crosses), edges that
    // brighten (Fresnel reflection grows at grazing angles), and a highlight inset along the
    // edges that face the light (upper left).
    function drawGlass(el, P, sc, dk, lit, k) {
      const pts = outline(el, P, sc), ctx = g.ctx;
      if (pts.length < 3) return;
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), y0 = Math.min(...ys), y1 = Math.max(...ys), x0 = Math.min(...xs);
      const a = fillAlpha(el, dk) * (lit ? 1.7 : 1) * k, tint = el.tint ?? "blue";
      ctx.save();
      ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath();
      const gr = ctx.createLinearGradient(x0, y0, x0, y1);
      gr.addColorStop(0, util.rgba(tint, a * 0.7)); gr.addColorStop(1, util.rgba(tint, a * 1.35));
      ctx.fillStyle = gr; ctx.fill();
      ctx.clip();
      ctx.lineJoin = "round";
      ctx.strokeStyle = util.rgba(tint, a * (dk ? 1.6 : 1.3)); ctx.lineWidth = 9; ctx.stroke();
      ctx.strokeStyle = dk ? "rgba(255, 255, 255, 0.10)" : "rgba(255, 255, 255, 0.55)"; ctx.lineWidth = 3.5; ctx.stroke();
      // The highlight: edges whose outward normal faces the light, inset a few px.
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const p0 = pts[i], p1 = pts[(i + 1) % pts.length]; area += p0[0] * p1[1] - p1[0] * p0[1]; }
      const sgn = area > 0 ? 1 : -1, L = [-0.6, -0.8];
      ctx.lineCap = "round";
      ctx.lineWidth = 2;
      // Four brightness steps, one path each, so a round drop is four strokes, not a hundred.
      for (let q = 1; q <= 4; q++) {
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i], p1 = pts[(i + 1) % pts.length], dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = hypot(dx, dy);
          if (len < 0.5) continue;
          const nx = (sgn * dy) / len, ny = (-sgn * dx) / len, f = nx * L[0] + ny * L[1];
          if (f < 0.35 || Math.min(4, 1 + Math.floor(((f - 0.35) / 0.65) * 4)) !== q) continue;
          ctx.moveTo(p0[0] - nx * 4, p0[1] - ny * 4); ctx.lineTo(p1[0] - nx * 4, p1[1] - ny * 4);
          any = true;
        }
        if (!any) continue;
        ctx.strokeStyle = `rgba(255, 255, 255, ${((dk ? 0.34 : 0.7) * (q - 0.5)) / 4})`;
        ctx.stroke();
      }
      ctx.restore();
    }
    function drawMirror(el, P, sc, lit) {
      for (const pc of el.shape) {
        const pts = piecePx(pc, P, sc);
        if (el.reflectance < 1) { g.path(pts, { stroke: "ink", width: lit ? 2.5 : 1.5, dash: [5, 3] }); continue; }
        if (el.face) {
          // Hatching on the back, a tick every 7 px.
          const len = pc.k === "seg" ? dist(pts[0], pts[1]) : (pc.a1 - pc.a0) * pc.r * sc, n = Math.max(1, Math.floor(len / 7));
          for (let i = 0; i < n; i++) {
            const s = (i + 0.5) / n;
            const q = pc.k === "seg" ? add(pc.a, mul(sub(pc.b, pc.a), s)) : add(pc.c, mul([Math.cos(pc.a0 + (pc.a1 - pc.a0) * s), Math.sin(pc.a0 + (pc.a1 - pc.a0) * s)], pc.r));
            const nb = mul(normalAt(pc, q[0], q[1]), -el.face), Q = P(q), b = dirPx(P, q, nb), t = [-b[1], b[0]];
            g.line(add(Q, mul(b, 1.5)), add(add(Q, mul(b, 7)), mul(t, 4)), { stroke: "muted", width: 1 });
          }
        }
        g.path(pts, { stroke: "ink", width: lit ? 3.5 : 2.5 });
      }
    }
    function drawThinLens(el, P, dk, lit) {
      const a = P(el.shape[0].a), b = P(el.shape[0].b), len = dist(a, b), u = unit(sub(b, a)), nv = [-u[1], u[0]], m = mul(add(a, b), 0.5), k = len * 0.06;
      const ctx = g.ctx;
      ctx.save();
      ctx.beginPath();
      if (el.f > 0) {
        ctx.moveTo(a[0], a[1]);
        ctx.quadraticCurveTo(m[0] + nv[0] * 2 * k, m[1] + nv[1] * 2 * k, b[0], b[1]);
        ctx.quadraticCurveTo(m[0] - nv[0] * 2 * k, m[1] - nv[1] * 2 * k, a[0], a[1]);
      } else {
        const A1 = add(a, mul(nv, k)), A2 = sub(a, mul(nv, k)), B1 = add(b, mul(nv, k)), B2 = sub(b, mul(nv, k));
        ctx.moveTo(A1[0], A1[1]);
        ctx.quadraticCurveTo(m[0] - nv[0] * k * 0.6, m[1] - nv[1] * k * 0.6, B1[0], B1[1]);
        ctx.lineTo(B2[0], B2[1]);
        ctx.quadraticCurveTo(m[0] + nv[0] * k * 0.6, m[1] + nv[1] * k * 0.6, A2[0], A2[1]);
        ctx.closePath();
      }
      ctx.fillStyle = util.rgba(el.color ?? "blue", (dk ? 0.24 : 0.14) * (lit ? 1.6 : 1));
      ctx.fill();
      ctx.strokeStyle = util.color("ink");
      ctx.lineWidth = lit ? 2.25 : 1.25;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    }
    function drawAbsorber(el, P, sc, lit) {
      const w = el.width ?? (el.style === "wall" ? 7 : el.style === "screen" ? 6 : 4);
      for (const pc of el.shape) {
        const band = strip(piecePx(pc, P, sc), w);
        if (el.style === "wall") g.path(band, { fill: "panel", hatch: g.rgba("muted", 0.7), stroke: "ink", width: lit ? 2 : 1, close: true });
        else if (el.style === "screen") g.path(band, { fill: "grid", stroke: lit ? "ink" : "muted", width: lit ? 2 : 1, close: true });
        else g.path(band, { fill: g.rgba(el.color ?? "muted", 0.3), stroke: el.color ?? "muted", width: lit ? 2 : 1.2, close: true });
      }
    }
    function marks(el, P, dk) {
      const op = el.optic, out = [];
      if (!op) return;
      if (op.kind === "thin") out.push([add(op.c, mul(op.axis, op.f)), "F′"], [sub(op.c, mul(op.axis, op.f)), "F"]);
      else if (op.kind === "mirror") out.push([add(op.vertex, mul(op.axis, op.R / 2)), "F"], [add(op.vertex, mul(op.axis, op.R)), "C"]);
      else {
        const t = thick(index(op.n), op.R1, op.R2, op.d);
        if (!Number.isFinite(t.f)) return;
        out.push([add(add(op.c, mul(op.axis, op.d / 2)), mul(op.axis, t.bfd)), "F′"], [sub(sub(op.c, mul(op.axis, op.d / 2)), mul(op.axis, t.ffd)), "F"]);
      }
      for (const [q, name] of out) {
        const p = P(q);
        if (p[0] < -20 || p[0] > g.w + 20 || p[1] < -20 || p[1] > g.h + 20) continue;
        g.circle(p, 3.2, { fill: "ink", stroke: "panel", width: 1.5 });
        g.text(name, [p[0], p[1] + 15], { font: "serif", italic: true, size: 15, color: "ink", halo: true });
      }
    }

    // Traces the scene and draws it. Returns the trace, with hit.px (canvas position) on every hit and sensor record.
    g.optics = (scene, o = {}) => {
      const P = o.P ?? ident, sc = scaleOf(P), dk = dark();
      lastP = P;
      const { els, srcs } = split(scene);
      const T = o.trace ?? traceOf(scene, o);
      const show = o.elements !== false;
      const lit = el => !!el.name && g.lit(el.name);
      const additive = o.blend === "add" || (o.blend !== "normal" && dk);
      // The color of a ray, hit, or record: its wavelength's; white light; its source's color or
      // temperature; o.color; o.temperature; else a 3000 K lamp.
      const colorMemo = new Map();
      const lightFor = s => {
        const k = s.wl != null ? s.wl : s.band ? -1 : -2 - (s.src ?? 0);
        let L = colorMemo.get(k);
        if (L) return L;
        const src = srcs[s.src] ?? {};
        const c = s.wl != null ? wavelengthRGB(s.wl, { on: dk ? "dark" : "light" })
          : s.band ? (o.white ? util.rgb(o.white) : blackbodyRGB(6000))
          : src.color ? util.rgb(src.color) : src.temperature ? blackbodyRGB(src.temperature)
          : o.color ? util.rgb(o.color) : blackbodyRGB(o.temperature ?? 3000);
        colorMemo.set(k, (L = lightOf(c, dk)));
        return L;
      };
      // Optical axes, then glass fills, so rays draw over them.
      if (o.axis) {
        const far = (4 * Math.max(g.w, g.h)) / sc;
        for (const el of els) {
          if (!el.optic || el.hidden) continue;
          const c = el.optic.c ?? el.optic.vertex, ax = el.optic.axis;
          g.line(P(sub(c, mul(ax, far))), P(add(c, mul(ax, far))), { stroke: "muted", width: 1, dash: [6, 5], alpha: 0.6 });
        }
      }
      if (show) for (const el of els) {
        if (el.type !== "body" || el.hidden) continue;
        if (o.glass === "flat") g.path(outline(el, P, sc), { fill: el.tint ?? "blue", alpha: fillAlpha(el, dk) * (lit(el) ? 1.7 : 1), close: true });
        else drawGlass(el, P, sc, dk, lit(el), 1);
      }
      // Rays, drawn as light (see "Light" above). Each ray's segments are batched by brightness,
      // so a fan is a few dozen strokes and separate rays still add up where they cross.
      if (o.rays !== false) {
        const ctx = g.ctx, w = o.width ?? 1.75, base = o.alpha ?? 1, minA = o.minAlpha ?? 0.12, gain = o.gain ?? 1;
        const segs = o.filter ? T.segments.filter(o.filter) : T.segments;
        const level = s => clamp(Math.sqrt(s.I * gain), minA, 1), alphaOf = s => level(s) * base;
        // On light pages everything paints normally (overlapping glows still deepen), which also
        // lets the still layers be cached exactly, as normal painting composites in any grouping.
        const comp = additive ? "lighter" : "source-over", soft = comp;
        // A source's light is shared among its rays, so the soft layers of a fan of 21 rays are
        // fainter than a lone ray's and the fan doesn't burn white; with wavefronts the rays step
        // back and the crests lead.
        const dens = si => clamp(Math.sqrt(5 / Math.max(1, srcs[si]?.rays.length ?? 1)), 0.3, 1), back = o.wavefronts ? 0.4 : 1;
        // Canvas positions, the part inside the canvas (as fractions c0 to c1 along the segment), and
        // which way a photon chooses at each split; kept on the segment while the mapping holds.
        const sig = `${g.w}|${g.h}|${P(ORIGIN)}|${P(ONE)}`, box = [-40, -40, g.w + 80, g.h + 80];
        for (const s of segs) {
          if (s.pxSig === sig) continue;
          s.pxSig = sig; s.pa = P(s.a); s.pb = P(s.b);
          const v = clipSeg(s.pa, s.pb, box), len = dist(s.pa, s.pb) || 1;
          s.qa = v ? v[0] : null; s.qb = v ? v[1] : null;
          s.c0 = v ? dist(s.pa, v[0]) / len : 0; s.c1 = v ? dist(s.pa, v[1]) / len : 0;
          let flips = 0;
          for (const ch of s.via) if (ch === "R" || ch === "P") flips++;
          s.flip = flips & 1;
        }
        const groups = new Map();
        for (const s of segs) {
          const a = alphaOf(s);
          if (!s.qa || a < 0.004) continue;
          const sl = srcs[s.src]?.name && g.lit(srcs[s.src].name) ? 1 : 0, qa = Math.max(1, Math.round(a * 24));
          const k = `${s.src}|${s.ray}|${s.wl ?? (s.band ? "w" : "")}|${qa}|${sl}`;
          let G = groups.get(k);
          if (!G) groups.set(k, (G = { L: lightFor(s), a: qa / 24, d: dens(s.src), lit: sl, segs: [] }));
          G.segs.push(s);
        }
        const list = [...groups.values()];
        // The still part of the light: beam, glow inside glass, spectrum, the rays, source glows.
        const paint = ctx => {
          const stroke = (width, k, key) => {
            for (const G of list) {
              ctx.strokeStyle = G.L[key]; ctx.globalAlpha = Math.min(1, G.a * k * back * (key === "core" ? (o.wavefronts ? 0.6 : 0.35 + 0.65 * G.d) : G.d)); ctx.lineWidth = G.lit ? width * 1.6 : width;
              ctx.beginPath();
              for (const s of G.segs) { ctx.moveTo(s.qa[0], s.qa[1]); ctx.lineTo(s.qb[0], s.qb[1]); }
              ctx.stroke();
            }
          };
          ctx.save();
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          // The beam: the light between neighboring rays of one source on the same path, brighter
          // where they crowd together, so a fan reads as a cone of light and a focus as a pinch of it.
          if (o.fill !== false) {
            const at = new Map(), fills = new Map();
            for (const s of segs) if (s.qa && (srcs[s.src]?.rays.length ?? 0) >= 5) at.set(`${s.src}|${s.ray}|${s.via}|${s.wl}`, s);
            for (const s of at.values()) {
              const n = at.get(`${s.src}|${s.ray + 1}|${s.via}|${s.wl}`);
              if (!n || n.end !== s.end) continue;
              const len = dist(s.pa, s.pb), wa = dist(s.pa, n.pa);
              if (wa > 0.25 * len + 10 || dist(s.pb, n.pb) > 0.6 * len + 40) continue;
              const f = s.c1, wb = hypot(s.pa[0] + (s.pb[0] - s.pa[0]) * f - n.pa[0] - (n.pb[0] - n.pa[0]) * f, s.pa[1] + (s.pb[1] - s.pa[1]) * f - n.pa[1] - (n.pb[1] - n.pa[1]) * f);
              const a = (dk ? 0.075 : 0.06) * dens(s.src) * Math.min(level(s), level(n)) * clamp(16 / Math.max(3, (wa + wb) / 2), 0.3, 1.5), qa = Math.max(1, Math.round(a * 200));
              const L = lightFor(s), k = `${L.glow}|${qa}`;
              let F = fills.get(k);
              if (!F) fills.set(k, (F = { L, a: qa / 200, quads: [] }));
              F.quads.push(s, n);
            }
            ctx.globalCompositeOperation = soft;
            for (const F of fills.values()) {
              ctx.fillStyle = F.L.glow; ctx.globalAlpha = F.a;
              ctx.beginPath();
              for (let i = 0; i < F.quads.length; i += 2) {
                const s = F.quads[i], n = F.quads[i + 1];
                ctx.moveTo(s.pa[0], s.pa[1]); ctx.lineTo(s.pb[0], s.pb[1]); ctx.lineTo(n.pb[0], n.pb[1]); ctx.lineTo(n.pa[0], n.pa[1]); ctx.closePath();
              }
              ctx.fill();
            }
          }
          // Light scattered inside the glass along each path, so a lit rod or block glows from within.
          if (o.scatter !== false && dk && show) {
            const inside = new Map();
            for (const G of list) for (const s of G.segs) if (s.med >= 0 && els[s.med] && !els[s.med].hidden) (inside.get(s.med) ?? inside.set(s.med, []).get(s.med)).push(s, G);
            ctx.globalCompositeOperation = comp;
            for (const [mi, items] of inside) {
              const pts = outline(els[mi], P, sc);
              if (pts.length < 3) continue;
              ctx.save();
              ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.clip();
              ctx.lineWidth = w * 13;
              for (let i = 0; i < items.length; i += 2) {
                const s = items[i], G = items[i + 1];
                ctx.strokeStyle = G.L.glow; ctx.globalAlpha = G.a * G.d * 0.06;
                ctx.beginPath(); ctx.moveTo(s.qa[0], s.qa[1]); ctx.lineTo(s.qb[0], s.qb[1]); ctx.stroke();
              }
              ctx.restore();
            }
          }
          // Dispersed light as a continuous fan: between neighboring wavelengths of one ray on the
          // same path, a band shaded from one color to the next, so the spectrum is smooth.
          ctx.globalCompositeOperation = comp;
          if (o.spectrum !== "lines") {
            const fans = new Map();
            for (const s of segs) if (s.wl != null && s.band == null) { const k = `${s.src}|${s.ray}|${s.via}|${s.depth}`; (fans.get(k) ?? fans.set(k, []).get(k)).push(s); }
            for (const list of fans.values()) {
              if (list.length < 2) continue;
              list.sort((p, q) => p.wl - q.wl);
              for (let i = 1; i < list.length; i++) {
                const s1 = list[i - 1], s2 = list[i];
                if (s1.end !== s2.end) continue;
                const a1 = s1.pa, b1 = s1.pb, a2 = s2.pa, b2 = s2.pb, L1 = dist(a1, b1);
                if (dist(a1, a2) > 0.25 * L1 + 6 || dist(b1, b2) > 0.6 * L1 + 40) continue;
                const m1 = mul(add(a1, b1), 0.5), m2 = mul(add(a2, b2), 0.5), gr = ctx.createLinearGradient(m1[0], m1[1], m2[0], m2[1]);
                gr.addColorStop(0, spectral(s1.wl, dk)); gr.addColorStop(1, spectral(s2.wl, dk));
                ctx.fillStyle = gr;
                ctx.globalAlpha = Math.min(alphaOf(s1), alphaOf(s2)) * (dk ? 0.55 : 0.4);
                ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(a2[0], a2[1]); ctx.closePath(); ctx.fill();
              }
            }
          }
          // Each ray: a wide faint bloom and a glow in its color, then a thin core whitened toward it.
          ctx.globalCompositeOperation = soft;
          if (o.glow !== false) { if (dk) { stroke(w * 7, 0.05, "glow"); stroke(w * 2.8, 0.2, "glow"); } else stroke(w * 3.6, 0.3, "glow"); }
          ctx.globalCompositeOperation = comp;
          stroke(dk ? w * 0.85 : w, 1, "core");
          // A source glows where its light starts.
          if (dk && o.sources !== false) {
            ctx.globalCompositeOperation = comp;
            srcs.forEach((s, si) => {
              if (!s.at || s.kind === "beam") return;
              const q = P(s.at), L = lightFor({ wl: Array.isArray(s.wl) ? null : s.wl, band: Array.isArray(s.wl) ? s.wl : null, src: si }), R = 15;
              ctx.globalAlpha = 0.9 * Math.min(1, Math.sqrt(s.I));
              const spr = spriteOf(L);
              if (spr) ctx.drawImage(spr, q[0] - R, q[1] - R, 2 * R, 2 * R);
            });
          }
          ctx.restore();
        };
        // The still layers are drawn once into a layer the size of the canvas and laid on each
        // frame, so a figure whose photons move every frame repaints only them. The layer goes
        // when the figure has been idle for 3 s, so only figures on screen hold one.
        if (typeof document !== "undefined") {
          if (g.time !== frameAt) { frameAt = g.time; calls = 0; }
          const slot = layers[calls] ?? (layers[calls] = { cv: document.createElement("canvas"), key: "" });
          calls++;
          const tf = ctx.getTransform(), cv = ctx.canvas;
          if (T._id == null) { T._id = ++traceIds; T.segments.forEach((s, i) => (s._i = i)); }
          // A filter is a new function each frame; what it kept is the same segments.
          const kept = o.filter ? segs.map(s => s._i).join(",") : "";
          const key = [T._id, kept, sig, tf.a, tf.b, tf.c, tf.d, tf.e, tf.f, cv.width, cv.height, w, base, minA, gain, o.fill, o.glow, o.scatter, o.spectrum, o.color, o.temperature, o.white, o.blend, !!o.wavefronts, show, o.sources,
            srcs.map(q => (q.name && g.lit(q.name) ? 1 : 0)).join(""), util.color("panel")].join("|");
          if (slot.cv.width !== cv.width || slot.cv.height !== cv.height) { slot.cv.width = cv.width; slot.cv.height = cv.height; slot.key = ""; }
          if (slot.key !== key) {
            const lc = slot.cv.getContext("2d");
            lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, slot.cv.width, slot.cv.height); lc.setTransform(tf);
            paint(lc);
            slot.key = key;
          }
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = comp;
          ctx.drawImage(slot.cv, 0, 0);
          ctx.restore();
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => { for (const l of layers) { l.cv.width = l.cv.height = 0; l.key = ""; } }, 3000);
        } else paint(ctx);
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        // Wavefronts: points of equal optical path length on each ray, joined across neighboring
        // rays of the same source and path, drawn as glowing crests. o.wavefronts is the spacing in
        // world units, or { spacing, phase, alpha, width }; advancing phase makes them travel.
        if (o.wavefronts) {
          const wf = typeof o.wavefronts === "number" ? { spacing: o.wavefronts } : o.wavefronts, sp = Math.max(1e-6, wf.spacing ?? 1), ph = wf.phase ?? 0;
          const buckets = new Map();
          for (const s of segs) {
            if (!s.opl) continue;
            const [L0, L1] = s.opl, span = L1 - L0;
            if (span <= 0) continue;
            const m0 = Math.ceil((L0 - ph) / sp), m1 = Math.floor((Math.min(L1, L0 + 200 * sp) - ph) / sp);
            for (let m = m0; m <= m1; m++) {
              const f = (m * sp + ph - L0) / span;
              const k = `${s.src}|${s.via}|${s.wl}|${m}`;
              (buckets.get(k) ?? buckets.set(k, []).get(k)).push({ ray: s.ray, p: [s.pa[0] + (s.pb[0] - s.pa[0]) * f, s.pa[1] + (s.pb[1] - s.pa[1]) * f], s });
            }
          }
          const lines = [], maxGap = 0.18 * Math.max(g.w, g.h), A = wf.alpha ?? 0.85, ww = wf.width ?? 1.6;
          for (const pts of buckets.values()) if (pts.length >= 2) { pts.sort((p, q) => p.ray - q.ray); lines.push(pts); }
          const crests = (key, width, k) => {
            ctx.lineWidth = width;
            for (const pts of lines) {
              ctx.strokeStyle = lightFor(pts[0].s)[key];
              ctx.globalAlpha = Math.min(1, A * level(pts[0].s) * k);
              ctx.beginPath();
              for (let i = 0; i < pts.length; i++) {
                const jump = i === 0 || pts[i].ray !== pts[i - 1].ray + 1 || dist(pts[i].p, pts[i - 1].p) > maxGap;
                if (jump) ctx.moveTo(pts[i].p[0], pts[i].p[1]); else ctx.lineTo(pts[i].p[0], pts[i].p[1]);
              }
              ctx.stroke();
            }
          };
          ctx.globalCompositeOperation = soft;
          crests("glow", ww * 4.5, dk ? 0.22 : 0.3);
          ctx.globalCompositeOperation = comp;
          crests("core", ww, 1);
        }
        // Photons: small bright packets that ride every traced path at a steady speed, slowing to
        // c/n in glass (their place is set by optical path length, like the wavefronts). Where a
        // ray splits, each photon goes one way, as often as the intensities say; white light that
        // splits into colors sends each photon down one color. On by default without wavefronts.
        const ph = o.photons === false || (o.photons == null && o.wavefronts) ? null
          : { speed: 140, spacing: 64, count: 260, size: 1, trail: 30, ...(typeof o.photons === "object" ? o.photons : {}) };
        if (ph) {
          const still = checkingNow() || reduced.matches;
          const t = o.time ?? (still ? 0 : g.time);
          if (o.time == null && !still) g.wantsFrame = true;
          const v = ph.speed / sc, trail = ph.trail / sc;
          // Many-ray sources carry fewer photons per ray, so a dense fan isn't a swarm.
          const gapOf = si => (ph.spacing / sc) * Math.max(1, Math.sqrt((srcs[si]?.rays.length ?? 1) / 5));
          let spread = 1, est = 0;
          for (const s of segs) {
            const span = s.opl ? s.opl[1] - s.opl[0] : 0;
            if (s.qa && span > 0) est += (span * (s.c1 - s.c0) * Math.min(1, s.I / (srcs[s.src]?.I || 1))) / gapOf(s.src);
          }
          // Spread them out when the paths are long, so a busy figure stays cheap.
          if (est > ph.count) spread = est / ph.count;
          const used = [];
          for (const s of segs) {
            if (!s.qa || !s.opl) continue;
            const src = srcs[s.src], rel = s.I / (src?.I || 1), L0 = s.opl[0], span = s.opl[1] - L0;
            if (rel < 0.02 || !(span > 0)) continue;
            const sp = gapOf(s.src) * spread;
            const v0 = L0 + span * s.c0, v1 = L0 + span * s.c1, head = v * t - hash(s.src, s.ray, 1) * sp;
            const bands = Array.isArray(src?.wl) && s.wl != null ? src.wl : null, bi = bands ? bands.indexOf(s.wl) : -1;
            const L = lightFor(s);
            for (let m = Math.ceil((head - v1) / sp) - 1, m1 = Math.floor((head - v0) / sp) + 1; m <= m1; m++) {
              const id = (m & 0xffffff) * 4;
              const lam = head - m * sp + (hash(s.src, s.ray, id + 2) - 0.5) * 0.6 * sp;
              if (lam < v0 || lam > v1) continue;
              const u = hash(s.src, s.ray, id + 3);
              if ((s.flip ? 1 - u : u) >= rel) continue;
              if (bi >= 0 && Math.floor(hash(s.src, s.ray, id + 4) * bands.length) !== bi) continue;
              const f = (lam - L0) / span, f0 = Math.max(0, (lam - trail - L0) / span), fm = (f + f0) / 2;
              if (!L.hd.length) used.push(L);
              L.hd.push(s.pa[0] + (s.pb[0] - s.pa[0]) * f, s.pa[1] + (s.pb[1] - s.pa[1]) * f);
              L.tr.push(s.pa[0] + (s.pb[0] - s.pa[0]) * f0, s.pa[1] + (s.pb[1] - s.pa[1]) * f0, s.pa[0] + (s.pb[0] - s.pa[0]) * fm, s.pa[1] + (s.pb[1] - s.pa[1]) * fm);
            }
          }
          ctx.globalCompositeOperation = comp;
          const r = (dk ? 9 : 6.5) * ph.size;
          for (const L of used) {
            // A tail fading toward the back: a faint wide stroke over the whole trail, a brighter one over its front half.
            ctx.strokeStyle = L.glow; ctx.lineWidth = 3 * ph.size; ctx.globalAlpha = dk ? 0.3 : 0.35;
            ctx.beginPath();
            for (let i = 0, j = 0; j < L.hd.length; i += 4, j += 2) { ctx.moveTo(L.tr[i], L.tr[i + 1]); ctx.lineTo(L.hd[j], L.hd[j + 1]); }
            ctx.stroke();
            ctx.strokeStyle = L.core; ctx.lineWidth = 1.4 * ph.size; ctx.globalAlpha = dk ? 0.6 : 0.75;
            ctx.beginPath();
            for (let i = 0, j = 0; j < L.hd.length; i += 4, j += 2) { ctx.moveTo(L.tr[i + 2], L.tr[i + 3]); ctx.lineTo(L.hd[j], L.hd[j + 1]); }
            ctx.stroke();
            const spr = spriteOf(L);
            ctx.globalAlpha = 1;
            if (spr) for (let j = 0; j < L.hd.length; j += 2) ctx.drawImage(spr, L.hd[j] - r, L.hd[j + 1] - r, 2 * r, 2 * r);
            L.hd.length = 0; L.tr.length = 0;
          }
        }
        if (o.arrows) {
          ctx.globalCompositeOperation = "source-over";
          const size = o.arrowSize ?? 8;
          for (const s of segs) {
            if (o.arrows === "first" && s.depth > 0) continue;
            if (!s.qa || dist(s.qa, s.qb) < size * 5) continue;
            ctx.fillStyle = lightFor(s).core;
            ctx.globalAlpha = alphaOf(s);
            const u = unit(sub(s.qb, s.qa));
            tri(add(mul(add(s.qa, s.qb), 0.5), mul(u, size / 2)), u, size);
          }
        }
        ctx.restore();
      }
      // Total internal reflection: a small ring at each point it happens, in the ray's color.
      if (o.tir !== false && o.rays !== false) for (const h of T.hits) {
        if (h.kind !== "tir" || h.I < (o.minI ?? 0.01) * 3) continue;
        g.circle(P(h.p), 4.5, { stroke: lightFor(h).glow, width: 1.75, alpha: clamp(Math.sqrt(h.I), 0.35, 1) });
      }
      if (show) {
        for (const el of els) {
          if (el.hidden) continue;
          if (el.type === "body") g.path(outline(el, P, sc), { stroke: "ink", width: lit(el) ? 2.5 : 1.25, alpha: lit(el) ? 1 : 0.6, close: true });
          else if (el.type === "mirror") drawMirror(el, P, sc, lit(el));
          else if (el.type === "lens") drawThinLens(el, P, dk, lit(el));
          else if (el.type === "absorber") drawAbsorber(el, P, sc, lit(el));
        }
        els.forEach((el, ei) => {
          if (!el.record || el.hidden || o.marks === false) return;
          for (const r of T.sensors[keyOf(el, ei)] ?? []) {
            g.circle(P(r.p), 2.4, { fill: lightFor(r).glow, alpha: clamp(Math.sqrt(r.I), 0.25, 1) });
          }
        });
        srcs.forEach((s, si) => {
          if (!s.marker || !s.at || o.sources === false) return;
          const L = lightFor({ wl: Array.isArray(s.wl) ? null : s.wl, band: Array.isArray(s.wl) ? s.wl : null, src: si });
          g.circle(P(s.at), 4.5, { fill: dk ? L.core : L.glow, stroke: "panel", width: 1.5 });
        });
        if (o.focal) for (const el of els) if (!el.hidden) marks(el, P, dk);
        if (o.labels !== false) for (const el of els) {
          if (!el.label || el.hidden) continue;
          let p;
          if (el.labelAt) p = P(el.labelAt);
          else {
            const pts = el.shape.flatMap(pc => piecePx(pc, P, sc)), xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
            p = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys) - 12];
          }
          g.label(el.label, p, { color: lit(el) ? "ink" : el.labelColor ?? "ink" });
        }
      }
      for (const h of T.hits) h.px = P(h.p);
      for (const k in T.sensors) for (const r of T.sensors[k]) r.px = P(r.p);
      return T;
    };

    // The normal at a hit with the angles of incidence, refraction, and reflection marked against it.
    // o: P (defaults to the last g.optics mapping), r [30] arc radius px, length [52] of the normal each side,
    // show ("auto": incidence plus refraction, or reflection at mirrors and total internal reflection;
    // or a string with any of "i", "t", "r"), names { i, t, r }, colors { i, t, r }, values [true], digits [1].
    g.rayAngles = (hit, o = {}) => {
      if (!hit) return null;
      const P = o.P ?? lastP ?? ident, c = P(hit.p), d = v => dirPx(P, hit.p, v);
      const n = d(hit.normal), L = o.length ?? 52, rad = o.r ?? 30;
      if (o.normal !== false) g.line(sub(c, mul(n, L)), add(c, mul(n, L)), { stroke: "muted", width: 1, dash: [4, 4] });
      const reflects = hit.kind === "mirror" || hit.kind === "tir";
      const show = o.show && o.show !== "auto" ? o.show : reflects ? "ir" : hit.kind === "refract" ? "it" : "i";
      const names = { i: hit.kind === "mirror" ? "θᵢ" : "θ₁", t: "θ₂", r: "θᵣ", ...o.names }, colors = { i: "blue", t: "purple", r: "green", ...o.colors };
      const fmt = a => `${a.toFixed(o.digits ?? 1)}°`;
      const wedge = (u, w, r, col, text) => {
        const a0 = Math.atan2(u[1], u[0]);
        let da = Math.atan2(w[1], w[0]) - a0;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        const pts = [];
        for (let k = 0; k <= 24; k++) { const a = a0 + (da * k) / 24; pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
        g.path([c, ...pts], { fill: col, alpha: 0.13, close: true });
        g.path(pts, { stroke: col, width: 1.5 });
        if (!text) return;
        // Beside the ray's end of the arc, on the side away from the normal, where the wedge isn't.
        let q = [-w[1], w[0]];
        if (q[0] * u[0] + q[1] * u[1] > 0) q = [-q[0], -q[1]];
        const k = (o.gap ?? 8) + 5 * Math.abs(q[1]);
        g.text(text, [c[0] + w[0] * (r + 2) + q[0] * k, c[1] + w[1] * (r + 2) + q[1] * k], { size: 13, weight: 600, color: col, halo: true, align: q[0] > 0.3 ? "left" : q[0] < -0.3 ? "right" : "center" });
      };
      const label = (key, a) => (o.labels === false ? null : o.values === false ? names[key] : `${names[key]} ${fmt(a)}`);
      if (show.includes("i")) wedge(n, d(mul(hit.din, -1)), rad, colors.i, label("i", hit.i));
      if (show.includes("t") && hit.t != null && hit.dout) wedge(mul(n, -1), d(hit.dout), rad, colors.t, label("t", hit.t));
      if (show.includes("r") && (hit.dr || hit.dout)) wedge(n, d(hit.dr ?? hit.dout), reflects ? rad : rad * 0.72, colors.r, label("r", hit.i));
      return { i: hit.i, t: hit.t, r: hit.i, at: c };
    };

    // A strip of the visible spectrum in box = [x, y, w, h]; o.range [380, 720] nm, o.marks [{ wl, label, color }].
    // Returns { x(nm) -> px, wl(px) -> nm }.
    g.visibleSpectrum = (box, o = {}) => {
      const [x, y, w, h] = box, [lo, hi] = o.range ?? [380, 720], ctx = g.ctx;
      const X = nm => x + ((nm - lo) / (hi - lo)) * w;
      ctx.save();
      for (let i = 0; i < w; i++) { ctx.fillStyle = wavelengthColor(lo + ((hi - lo) * (i + 0.5)) / w); ctx.fillRect(x + i, y, 1.5, h); }
      ctx.restore();
      g.rect(x, y, w, h, { stroke: "faint", width: 1 });
      if (o.ticks !== false) {
        const step = o.step ?? (w < 300 ? 100 : 50);
        for (let nm = Math.ceil(lo / step) * step; nm <= hi; nm += step) {
          g.line([X(nm), y + h], [X(nm), y + h + 4], { stroke: "muted", width: 1 });
          g.text(String(nm), [X(nm), y + h + 14], { size: 11, color: "muted" });
        }
        if (o.label !== false) g.text(o.label ?? "nm", [x + w + 6, y + h + 14], { size: 11, color: "muted", align: "left" });
      }
      for (const m of o.marks ?? []) {
        const px = X(m.wl);
        g.line([px, y - 5], [px, y + h + 2], { stroke: m.color ?? "ink", width: 2 });
        if (m.label) g.label(m.label, [px, y - 14], { color: m.color ?? "ink" });
      }
      return { x: X, wl: px => lo + ((px - x) / w) * (hi - lo), box };
    };

    // An eye from Optics.eye with light from an object o.distance mm away (Infinity by default):
    // traces and draws it, and marks where the image actually forms. Returns { trace, focus }.
    g.eye = (E, o = {}) => {
      const distance = o.distance ?? Infinity, P = o.P ?? ident;
      const src = o.source ?? eyeLight(E, distance, { n: o.n ?? 9, wl: o.wl, color: o.color });
      const T = g.optics([E.items, src], { minI: 0.05, ...o, P });
      const F = eyeFocus(E, distance);
      if (o.focus !== false && Number.isFinite(F.image) && Math.abs(F.defocus) < E.length) {
        const q = P([F.image, E.at[1]]), col = F.sharp ? "green" : "red";
        g.circle(q, 5, { stroke: col, width: 2 });
        if (!F.sharp && o.focusLabel !== false) g.label("focus", [q[0], q[1] - 15], { color: col });
      }
      return { trace: T, focus: F };
    };
  });

  window.Optics = {
    // materials and light
    materials: MATERIALS, index, abbe, dispersive, WHITE, spectrum, wavelengthRGB, wavelengthColor, blackbodyRGB,
    // physics
    snell, critical, brewster, fresnel, image, lensmaker, thick, rainbow,
    // geometry and elements
    segment, arc, body, polygon, slab, prism, circle, drop, semicircle, lens, mirror, curvedMirror, thinLens, wall, screen, sensor, distance, inside,
    // sources
    ray, beam, fan, fanTo,
    // tracing and measuring
    trace, focus, spot,
    // the eye
    eye, eyeLight, eyeFocus, correction,
  };
})();
