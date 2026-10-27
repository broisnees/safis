/* Iso kit: isometric technical illustration as vector polygons on the 2D canvas: solid parts in
   flat tones, ink outlines, a separating-plane paint order, SVG export. Reference: references/iso.md. */
(() => {
  "use strict";
  const { sin, cos, sqrt, abs, min, max, hypot, exp, PI, floor, round, ceil } = Math;
  const TAU = 2 * PI, clamp = (x, a, b) => min(b, max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = a => { const l = hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const axv = a => (typeof a === "string" ? scl(AX[a.replace(/[+-]/, "")], a[0] === "-" ? -1 : 1) : nrm(a));
  const now = () => performance.now();

  // ---------- affine 3x4 matrices, row-major: x' = m0 x + m1 y + m2 z + m3 ----------
  const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  function mul(a, b) {
    const o = new Array(12);
    for (let r = 0; r < 12; r += 4) {
      const x = a[r], y = a[r + 1], z = a[r + 2];
      o[r] = x * b[0] + y * b[4] + z * b[8]; o[r + 1] = x * b[1] + y * b[5] + z * b[9];
      o[r + 2] = x * b[2] + y * b[6] + z * b[10]; o[r + 3] = x * b[3] + y * b[7] + z * b[11] + a[r + 3];
    }
    return o;
  }
  const ap = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
  const ad = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[4] * p[0] + m[5] * p[1] + m[6] * p[2], m[8] * p[0] + m[9] * p[1] + m[10] * p[2]];
  function rot(axis, ang, about) {
    const [x, y, z] = axv(axis), c = cos(ang), s = sin(ang), t = 1 - c;
    const m = [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0];
    if (about) { const q = ad(m, about); m[3] = about[0] - q[0]; m[7] = about[1] - q[1]; m[11] = about[2] - q[2]; }
    return m;
  }
  // A node's pose: its rotations in order, then its move.
  function pose(n) {
    let m = ID;
    for (const r of [].concat(n.rotate || [])) if (r && r.angle) m = mul(rot(r.axis ?? "z", r.angle, r.about), m);
    if (n.move) { m = m.slice(); m[3] += n.move[0]; m[7] += n.move[1]; m[11] += n.move[2]; }
    return m;
  }
  // Right-handed basis [u, v, w] with w along the axis.
  const BASES = { x: [[0, 1, 0], [0, 0, 1], [1, 0, 0]], "-x": [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], y: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    "-y": [[1, 0, 0], [0, 0, 1], [0, -1, 0]], z: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "-z": [[0, 1, 0], [1, 0, 0], [0, 0, -1]] };
  function basis(a) {
    if (typeof a === "string") return BASES[a.replace("+", "")];
    const w = nrm(a), u = nrm(crs(abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], w));
    return [u, crs(w, u), w];
  }
  function frame(at = [0, 0, 0], a = "z", spin = 0) {
    let [u, v, w] = basis(a);
    if (spin) { const c = cos(spin), s = sin(spin); [u, v] = [add(scl(u, c), scl(v, s)), add(scl(u, -s), scl(v, c))]; }
    return [u[0], v[0], w[0], at[0], u[1], v[1], w[1], at[1], u[2], v[2], w[2], at[2]];
  }

  // ---------- meshes: vertices plus polygon faces (outer loop, optional holes) ----------
  let SID = 1, NID = 1;
  class Mesh {
    constructor() { this.id = NID++; this.P = []; this.F = []; this.convex = false; this.wrap = null; }
    v(x, y, z) { this.P.push(x, y, z); return this.P.length / 3 - 1; }
    f(v, s = 0, c = 0, x) { const F = { v, s, c }; if (x) Object.assign(F, x); this.F.push(F); return F; }
  }
  function newell(P, L) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < L.length; i++) {
      const a = L[i] * 3, b = L[(i + 1) % L.length] * 3;
      x += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]); y += (P[a + 2] - P[b + 2]) * (P[a] + P[b]); z += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
    }
    return nrm([x, y, z]);
  }
  // Edges with their two faces; a crease is drawn where flat faces meet at an angle.
  function edges(F) {
    const map = new Map(), E = [];
    F.forEach((f, i) => {
      if (f.d) return;
      for (const L of f.h ? [f.v, ...f.h] : [f.v]) for (let j = 0; j < L.length; j++) {
        const a = L[j], b = L[(j + 1) % L.length];
        if (a === b) continue;
        const k = a < b ? a * 2097152 + b : b * 2097152 + a, e = map.get(k);
        if (e && e[3] < 0) e[3] = i; else { const ne = [a, b, i, -1, 0]; map.set(k, ne); E.push(ne); }
      }
    });
    for (const e of E) {
      if (e[3] < 0) { e[4] = 1; continue; }
      const A = F[e[2]], B = F[e[3]];
      e[4] = A.s && A.s === B.s ? 0 : dot(A.n, B.n) < 0.985 ? 1 : 0;
    }
    return E;
  }
  function finish(m) {
    for (const f of m.F) if (!f.n) f.n = newell(m.P, f.v);
    m.E = edges(m.F);
    m.nc = 1 + max(0, ...m.F.map(f => f.c || 0));
    return m;
  }
  function bake(m, F) {
    const P = m.P;
    for (let i = 0; i < P.length; i += 3) { const q = ap(F, [P[i], P[i + 1], P[i + 2]]); P[i] = q[0]; P[i + 1] = q[1]; P[i + 2] = q[2]; }
    if (m.wrap) m.wrap = { ...m.wrap, o: ap(F, m.wrap.o), a: ad(F, m.wrap.a) };
    if (m.ax) m.ax = ad(F, m.ax);
    return m;
  }

  // ---------- 2D outlines ----------
  const area = L => { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const orient = (L, ccw) => ((area(L) > 0) === ccw ? L : L.slice().reverse());
  function convex2(L) {
    let sg = 0;
    for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[(i + 1) % L.length], c = L[(i + 2) % L.length], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (abs(z) < 1e-12) continue;
      if (sg && Math.sign(z) !== sg) return false;
      sg = Math.sign(z);
    }
    return true;
  }
  const leftN = (x, y) => { const l = hypot(x, y) || 1; return [-y / l, x / l]; };
  function inset(L, d) {
    const n = L.length;
    return L.map((p, i) => {
      const a = L[(i + n - 1) % n], b = L[(i + 1) % n], n1 = leftN(p[0] - a[0], p[1] - a[1]), n2 = leftN(b[0] - p[0], b[1] - p[1]);
      const m = nrm([n1[0] + n2[0], n1[1] + n2[1], 0]), k = d / max(0.25, m[0] * n1[0] + m[1] * n1[1]);
      return [p[0] + m[0] * k, p[1] + m[1] * k];
    });
  }
  // Smooth-group id per edge: edges joined at gentle corners share a group (no crease line).
  function groups(L, cyclic, singles) {
    const n = L.length, segs = cyclic ? n : n - 1, id = new Array(segs);
    const sharp = j => {
      if (!cyclic && (j === 0 || j === n - 1)) return true;
      const a = L[(j + n - 1) % n], p = L[j], c = L[(j + 1) % n], d1 = [p[0] - a[0], p[1] - a[1]], d2 = [c[0] - p[0], c[1] - p[1]];
      return (d1[0] * d2[0] + d1[1] * d2[1]) / (hypot(...d1) * hypot(...d2) || 1) < 0.9;
    };
    let st = 0;
    if (cyclic) { st = -1; for (let j = 0; j < n; j++) if (sharp(j)) { st = j; break; } if (st < 0) return id.fill(SID++); }
    let s = 0;
    for (let k = 0; k < segs; k++) { const j = (st + k) % n; if (!k || sharp(j)) s = SID++; id[j] = s; }
    if (singles) return id;
    const cnt = {}; for (const g of id) cnt[g] = (cnt[g] || 0) + 1;
    return id.map(g => (cnt[g] > 1 ? g : 0));
  }
  function rrect(x, y, w, h, r = 0, n = 4) {
    if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    r = min(r, w / 2, h / 2);
    const pts = [];
    for (const [cx, cy, a0] of [[x + w - r, y + r, -PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, PI / 2], [x + r, y + r, PI]])
      for (let i = 0; i <= n; i++) { const a = a0 + (PI / 2) * i / n; pts.push([cx + r * cos(a), cy + r * sin(a)]); }
    return pts;
  }
  const circle = (c, r, n = 20) => Array.from({ length: n }, (_, i) => [c[0] + r * cos(i * TAU / n), c[1] + r * sin(i * TAU / n)]);

  // ---------- core builders, in local coordinates (Z is the axis) ----------
  // A 2D outline lifted from z0 to z1, with holes or a chamfer, split into chunks along Z.
  function prism(out, holes, z0, z1, o = {}) {
    const m = new Mesh(), n = max(1, o.split || 1), b = holes.length ? 0 : min(o.bevel || 0, (z1 - z0) / 2.2);
    out = orient(out, true); holes = holes.map(h => orient(h, false));
    const lv = [];
    if (b) lv.push([z0, 1]);
    for (let i = 0; i <= n; i++) lv.push([lerp(z0 + b, z1 - b, i / n), 0]);
    if (b) lv.push([z1, 2]);
    const last = lv.length - 1;
    const rings = [out, ...holes].map(L => {
      const sid = groups(L, true, false), ins = b ? inset(L, b) : L;
      const R = lv.map(([z, t]) => (t ? ins : L).map(p => m.v(p[0], p[1], z)));
      for (let i = 0; i < last; i++) {
        const kind = lv[i][1] === 1 ? 1 : lv[i + 1][1] === 2 ? 2 : 0, c = clamp(i - (b ? 1 : 0), 0, n - 1);
        for (let j = 0; j < L.length; j++) { const j2 = (j + 1) % L.length; m.f([R[i][j], R[i][j2], R[i + 1][j2], R[i + 1][j]], sid[j] ? sid[j] * 4 + kind : 0, c); }
      }
      return R;
    });
    const hl = k => (holes.length ? { h: rings.slice(1).map(R => (k ? R[k] : R[0].slice().reverse())) } : null);
    m.f(rings[0][0].slice().reverse(), 0, 0, hl(0));
    m.f(rings[0][last], 0, n - 1, hl(last));
    m.convex = !holes.length && convex2(out);
    return m;
  }
  // A profile [[r, z], ...] turned about Z. Closed profiles (all r > 0) make shells.
  function lathe(prof, o = {}) {
    const m = new Mesh(), seg = o.segments || 32, closed = !!o.closed, ph = o.phase || 0;
    let pr = prof.map(p => [max(0, p[0]), p[1]]);
    const za = min(...pr.map(p => p[1])), zb = max(...pr.map(p => p[1])), rm = max(...pr.map(p => p[0]));
    // Shells split along their axis (splitAt: positions, to line up coaxial shells).
    const n0 = max(1, o.split ?? (closed ? clamp(round((zb - za) / rm), 1, 8) : 1));
    const zs = o.splitAt ? [za, ...o.splitAt.filter(z => z > za && z < zb), zb] : Array.from({ length: n0 + 1 }, (_, k) => lerp(za, zb, k / n0)), n = zs.length - 1;
    if (n > 1) {
      const q = [], L = closed ? pr.length : pr.length - 1;
      for (let i = 0; i < pr.length; i++) {
        const a = pr[i], b = i < L ? pr[(i + 1) % pr.length] : null; q.push(a);
        if (b) { const cut = zs.slice(1, -1).filter(z => (a[1] - z) * (b[1] - z) < 0); if (b[1] < a[1]) cut.reverse(); for (const z of cut) { const t = (z - a[1]) / (b[1] - a[1]); q.push([lerp(a[0], b[0], t), z]); } }
      }
      pr = q;
    }
    const chunkOf = z => { let k = 0; while (k < n - 1 && z >= zs[k + 1]) k++; return k; };
    const rings = pr.map(([r, z]) => (r < 1e-9 ? null : Array.from({ length: seg }, (_, j) => m.v(r * cos(ph + j * TAU / seg), r * sin(ph + j * TAU / seg), z))));
    const apex = pr.map(([r, z]) => (r < 1e-9 ? m.v(0, 0, z) : -1));
    const sid = groups(pr, closed, true), segs = closed ? pr.length : pr.length - 1, smooth = seg >= 10;
    for (let i = 0; i < segs; i++) {
      const i2 = (i + 1) % pr.length, A = rings[i], B = rings[i2];
      const c = chunkOf((pr[i][1] + pr[i2][1]) / 2), s = smooth ? sid[i] : 0;
      if (!A && !B) continue;
      if (!A || !B) {
        if (abs(pr[i][1] - pr[i2][1]) < 1e-9) m.f(A ? A.slice() : B.slice().reverse(), 0, c);
        else for (let j = 0; j < seg; j++) { const j2 = (j + 1) % seg; m.f(A ? [A[j], A[j2], apex[i2]] : [apex[i], B[j2], B[j]], s, c); }
        continue;
      }
      for (let j = 0; j < seg; j++) { const j2 = (j + 1) % seg; m.f([A[j], A[j2], B[j2], B[j]], s, c); }
    }
    const poly = pr.slice();
    if (!closed) { if (pr[0][0] > 0) poly.unshift([0, pr[0][1]]); if (pr[pr.length - 1][0] > 0) poly.push([0, pr[pr.length - 1][1]]); }
    m.convex = !closed && convex2(poly);
    m.ax = [0, 0, 1];
    if (closed || o.wrap) m.wrap = { o: [0, 0, 0], a: [0, 0, 1], z0: za, z1: zb, r: rm, zs };
    return m;
  }
  // Round the corners of a polyline with arcs of radius R.
  function fillet(P, R, steps = 6) {
    if (P.length < 3 || R <= 0) return P;
    const out = [P[0]];
    for (let i = 1; i + 1 < P.length; i++) {
      const p = P[i], a = sub(p, P[i - 1]), b = sub(P[i + 1], p), la = hypot(...a), lb = hypot(...b);
      const d1 = scl(a, 1 / la), d2 = scl(b, 1 / lb), cs = clamp(dot(d1, d2), -1, 1), th = Math.acos(cs);
      if (th < 1e-3 || la < 1e-9 || lb < 1e-9) { out.push(p); continue; }
      let t = R * Math.tan(th / 2), rr = R;
      const tm = 0.5 * min(la, lb);
      if (t > tm) { rr = R * tm / t; t = tm; }
      const A = sub(p, scl(d1, t)), nIn = nrm(sub(d2, scl(d1, cs))), C = add(A, scl(nIn, rr)), k = max(2, ceil(steps * th / (PI / 2)));
      for (let s = 0; s <= k; s++) { const f = th * s / k; out.push(add(C, add(scl(nIn, -rr * cos(f)), scl(d1, rr * sin(f))))); }
    }
    out.push(P[P.length - 1]);
    return out;
  }
  // A round tube along a 3D path, with rounded bends.
  function pipe(path, r, o = {}) {
    const m = new Mesh(), seg = o.segments || 14, pts = fillet(path, o.bend ?? r * 2.5, o.steps || 6), n = pts.length;
    const T = pts.map((p, i) => nrm(sub(pts[min(n - 1, i + 1)], pts[max(0, i - 1)])));
    let u = nrm(crs(abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], T[0]));
    const S = [0];
    for (let i = 1; i < n; i++) S.push(S[i - 1] + hypot(...sub(pts[i], pts[i - 1])));
    const clen = o.chunk ?? max(r * 8, S[n - 1] / 40), g = SID++;
    const rings = pts.map((p, i) => {
      u = nrm(sub(u, scl(T[i], dot(u, T[i]))));
      const v = crs(T[i], u);
      return Array.from({ length: seg }, (_, j) => { const a = j * TAU / seg; return m.v(...add(p, add(scl(u, r * cos(a)), scl(v, r * sin(a))))); });
    });
    let c = 0;
    for (let i = 0; i + 1 < n; i++) {
      c = floor((S[i] + S[i + 1]) / 2 / clen);
      for (let j = 0; j < seg; j++) { const j2 = (j + 1) % seg; m.f([rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]], g, c); }
    }
    if (o.caps !== false) { m.f(rings[0].slice().reverse(), 0, 0); m.f(rings[n - 1].slice(), 0, c); }
    return m;
  }
  // A radial array of thin twisted blades around Z, from radius r0 to r1.
  function bladeRing(o) {
    const m = new Mesh(), N = o.count || 20, r0 = o.r0 ?? 1, r1 = o.r1 ?? 3, sp = o.spans || 2;
    const ch = [].concat(o.chord ?? (r1 - r0) * 0.4), c0 = ch[0], c1 = ch[1] ?? c0, th = o.thick ?? c0 * 0.1;
    const tw = [].concat(o.twist ?? [0.5, 1.1]), b0 = tw[0], b1 = tw[1] ?? b0;
    for (let i = 0; i < N; i++) {
      const ph = (o.phase || 0) + i * TAU / N, er = [cos(ph), sin(ph), 0], et = [-sin(ph), cos(ph), 0], st = [];
      for (let k = 0; k <= sp; k++) {
        const t = k / sp, r = lerp(r0, r1, t), b = lerp(b0, b1, t), c = lerp(c0, c1, t);
        const cd = add([0, 0, cos(b) * c / 2], scl(et, sin(b) * c / 2)), td = add([0, 0, -sin(b) * th / 2], scl(et, cos(b) * th / 2)), q = scl(er, r);
        st.push([sub(sub(q, cd), td), add(sub(q, cd), td), add(add(q, cd), td), sub(add(q, cd), td)].map(p => m.v(...p)));
      }
      for (let k = 0; k < sp; k++) for (let j = 0; j < 4; j++) { const j2 = (j + 1) % 4; m.f([st[k][j], st[k][j2], st[k + 1][j2], st[k + 1][j]]); }
      m.f(st[0].slice().reverse()); m.f(st[sp].slice());
    }
    m.wrap = { o: [0, 0, 0], a: [0, 0, 1], z0: -max(c0, c1) / 2, z1: max(c0, c1) / 2, r: r1 };
    return m;
  }
  // T-slot aluminum profile of side s: four slots and a center bore.
  function tslotProfile(s) {
    const h = s / 2, o = s * 0.14, lip = s * 0.085, cw = s * 0.29, cd = s * 0.29, c = s * 0.045, cb = s * 0.15;
    const side = [[h - c, h], [o, h], [o, h - lip], [cw, h - lip], [cb, h - cd], [-cb, h - cd], [-cw, h - lip], [-o, h - lip], [-o, h], [-h + c, h]], pts = [];
    for (let k = 0; k < 4; k++) { const a = k * PI / 2, C = cos(a), S = sin(a); for (const [x, y] of side) pts.push([x * C - y * S, x * S + y * C]); }
    return pts;
  }
  function seg3(o, def) {
    if (o.from && o.to) { const d = sub(o.to, o.from); return { at: o.from, axis: d, len: hypot(...d) }; }
    const axis = o.axis || "z", len = o.length ?? def;
    return { at: o.center ? sub(o.at || [0, 0, 0], scl(axv(axis), len / 2)) : o.at || [0, 0, 0], axis, len };
  }
  const autoSplit = (L, cs, cap = 24) => (L > 4 * cs ? min(cap, round(L / (2.5 * cs))) : 1);

  const BUILD = {
    box(o) {
      let lo, hi;
      if (o.from && o.to) { lo = o.from.map((v, i) => min(v, o.to[i])); hi = o.from.map((v, i) => max(v, o.to[i])); }
      else { const s = o.size || [1, 1, 1], a = o.at || [0, 0, 0]; lo = [a[0] - s[0] / 2, a[1] - s[1] / 2, a[2]]; hi = [a[0] + s[0] / 2, a[1] + s[1] / 2, a[2] + s[2]]; }
      const d = sub(hi, lo), k = d[0] >= d[1] && d[0] >= d[2] ? 0 : d[1] >= d[2] ? 1 : 2, i = (k + 1) % 3, j = (k + 2) % 3;
      const w = d[i], h = d[j], L = d[k], b = min(o.bevel || 0, w / 2.2, h / 2.2, L / 2.2);
      const out = b ? [[b, 0], [w - b, 0], [w, b], [w, h - b], [w - b, h], [b, h], [0, h - b], [0, b]] : [[0, 0], [w, 0], [w, h], [0, h]];
      const m = prism(out, [], 0, L, { bevel: b, split: o.split ?? autoSplit(L, max(w, h)) });
      const e = q => { const v = [0, 0, 0]; v[q] = 1; return v; }, ei = e(i), ej = e(j), ek = e(k);
      return bake(m, [ei[0], ej[0], ek[0], lo[0], ei[1], ej[1], ek[1], lo[1], ei[2], ej[2], ek[2], lo[2]]);
    },
    cylinder(o) {
      const { at, axis, len } = seg3(o, 1), r = o.r ?? 0.5, r2 = o.r2 ?? r, hole = o.hole || 0, b = min(o.bevel || 0, r / 2, len / 3);
      let pr;
      if (hole) pr = [[hole, 0], [r, 0], [r2, len], [o.hole2 ?? hole, len]];
      else if (r2 <= 1e-9) pr = b ? [[0, 0], [r - b, 0], [r, b], [0, len]] : [[0, 0], [r, 0], [0, len]];
      else pr = b ? [[0, 0], [r - b, 0], [r, b], [r2, len - b], [r2 - b, len], [0, len]] : [[0, 0], [r, 0], [r2, len], [0, len]];
      const m = lathe(pr, { segments: o.segments ?? 32, closed: !!hole, split: o.split ?? (hole ? undefined : autoSplit(len, 2 * max(r, r2), 16)), splitAt: o.splitAt, phase: o.phase });
      return bake(m, frame(at, axis, o.spin));
    },
    cone(o) { return BUILD.cylinder({ ...o, r2: o.r2 ?? 0 }); },
    sphere(o) {
      const r = o.r ?? 0.5, n = o.segments ?? 24, h = max(4, n >> 1), pr = [];
      for (let i = 0; i <= h; i++) { const a = -PI / 2 + PI * i / h; pr.push([r * cos(a), r * sin(a)]); }
      return bake(lathe(pr, { segments: n }), frame(o.at, o.axis || "z"));
    },
    lathe(o) { return bake(lathe(o.profile, o), frame(o.at, o.axis || "z", o.spin)); },
    extrude(o) {
      const { at, axis, len } = seg3(o, o.depth ?? 1);
      return bake(prism(o.outline, o.holes || [], 0, o.depth ?? len, { bevel: o.bevel, split: o.split }), frame(at, axis, o.spin));
    },
    plate(o) {
      const [w, d] = o.size || [1, 1], t = o.thick ?? 0.05;
      const holes = (o.holes || []).map(h => (h.r ? circle(h.at, h.r, h.segments || 20) : rrect(h.at[0] - h.size[0] / 2, h.at[1] - h.size[1] / 2, h.size[0], h.size[1], h.round || 0)));
      return bake(prism(rrect(-w / 2, -d / 2, w, d, o.round || 0), holes, 0, t, { bevel: o.bevel }), frame(o.at, o.axis || "z", o.spin));
    },
    tslot(o) {
      const { at, axis, len } = seg3(o, 1), s = o.size ?? 0.04;
      return bake(prism(tslotProfile(s), [circle([0, 0], s * 0.1, 12)], 0, len, { split: o.split ?? autoSplit(len, s) }), frame(at, axis, o.spin));
    },
    pipe(o) { return pipe(o.path, o.r ?? 0.05, o); },
    blades(o) { return bake(bladeRing(o), frame(o.at, o.axis || "z")); },
    screw(o) {
      const r = o.r ?? 0.01, hex = o.head === "hex";
      const pr = hex ? [[0, 0], [r, 0], [r, r * 0.55], [r * 0.86, r * 0.7], [0, r * 0.7]] : [[0, 0], [r, 0], [r, r * 0.3], [r * 0.8, r * 0.6], [0, r * 0.6]];
      const m = lathe(pr, { segments: hex ? 6 : 16, phase: hex ? PI / 6 : 0 }), top = m.F.length - 1, z = hex ? r * 0.7 : r * 0.6, w = r * 0.11;
      if (!hex && o.slot !== false) m.f([m.v(-r * 0.72, -w, z), m.v(r * 0.72, -w, z), m.v(r * 0.72, w, z), m.v(-r * 0.72, w, z)], 0, 0, { d: { base: top, tone: "slot" } });
      return bake(m, frame(o.at, o.axis || "z", o.angle || 0));
    },
    knob(o) {
      const r = o.r ?? 0.02, h = o.h ?? r * 1.2, sk = o.skirt ?? 1.25, w = r * 0.13;
      const m = lathe([[0, 0], [r * sk, 0], [r * sk, h * 0.18], [r, h * 0.26], [r, h * 0.86], [r * 0.86, h], [0, h]], { segments: o.segments ?? 28 }), top = m.F.length - 1;
      m.f([m.v(r * 0.1, -w, h), m.v(r * 0.78, -w, h), m.v(r * 0.78, w, h), m.v(r * 0.1, w, h)], 0, 0, { d: { base: top, tone: o.mark ?? "mark" } });
      return bake(m, frame(o.at, o.axis || "z", o.angle || 0));
    },
  };

  // ---------- scene graph ----------
  const KEEP = ["name", "material", "color", "layer", "move", "rotate", "cut", "visible", "heat", "pickable", "shadow", "opacity", "data"];
  class Node {
    constructor(o = {}) { this.id = NID++; this.kids = []; this.name = ""; this.visible = true; this.material = "porcelain"; this.heat = 0; Object.assign(this, o); }
    add(n) { n.parent = this; this.kids.push(n); return n; }
    group(o = {}) { const n = new Node(); for (const k of KEEP) if (o[k] !== undefined) n[k] = o[k]; return this.add(n); }
    part(m, o = {}) {
      finish(m);
      if (o.wrap === false) m.wrap = null; else if (o.wrap && typeof o.wrap === "object") m.wrap = o.wrap;
      const n = new Node({ mesh: m });
      for (const k of KEEP) if (o[k] !== undefined) n[k] = o[k];
      return this.add(n);
    }
    find(name) { if (this.name === name) return this; for (const k of this.kids) { const f = k.find(name); if (f) return f; } return null; }
    all(name, out = []) { if (name == null ? this.mesh : this.name === name) out.push(this); for (const k of this.kids) k.all(name, out); return out; }
    set(o) { Object.assign(this, o); return this; }
    // Decals: flat marks drawn on one face of this part, right after that face.
    decal(o) {
      const m = this.mesh, fr = faceFrame(m, o.face || "+z"), pts = o.points.map(([a, b]) => m.v(...add(fr.o, add(scl(fr.u, a), scl(fr.v, b)))));
      const d = { base: fr.fi, tone: o.tone || "slot", line: o.line, k: pts.length === 2 ? "line" : "fill", w: o.width };
      m.F.push({ v: pts, s: 0, c: m.F[fr.fi].c, n: fr.n, d });
      return d;
    }
    vents(o = {}) {
      const [w, h] = o.size || [0.1, 0.06], n = o.count || 5, c = o.at || [0, 0], p = h / n, sh = p * (o.open ?? 0.5);
      for (let i = 0; i < n; i++) { const y = c[1] - h / 2 + p * (i + 0.5); this.decal({ face: o.face, points: rrect(c[0] - w / 2, y - sh / 2, w, sh, sh / 2, 3), tone: o.tone || "slot", line: true }); }
      return this;
    }
    text(o = {}) {
      const m = this.mesh, fr = faceFrame(m, o.face || "+z"), a = o.at || [0, 0];
      const d = { base: fr.fi, k: "text", text: o.text ?? "", size: o.size ?? 0.02, color: o.color ?? "ink", align: o.align ?? "center", font: o.font ?? "mono", weight: o.weight ?? 600, o: add(fr.o, add(scl(fr.u, a[0]), scl(fr.v, a[1]))), u: fr.u, v: fr.v };
      m.F.push({ v: [], s: 0, c: m.F[fr.fi].c, n: fr.n, d });
      return d;
    }
    screen(o = {}) {
      const [w, h] = o.size || [0.1, 0.05], c = o.at || [0, 0];
      this.decal({ face: o.face, points: rrect(c[0] - w / 2, c[1] - h / 2, w, h, o.round ?? h * 0.1, 2), tone: "screen", line: true });
      return this.text({ face: o.face, at: [c[0] - w / 2 + h * 0.2, c[1]], text: o.text ?? "", size: o.textSize ?? h * 0.42, color: o.color ?? "green", align: "left" });
    }
    ruler(o) {
      const a = o.from, b = o.to, L = hypot(b[0] - a[0], b[1] - a[1]), dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nn = [-dir[1], dir[0]];
      const st = o.step, maj = o.major || 5, tk = o.tick ?? L * 0.02, side = o.side ?? 1;
      for (let i = 0, x = 0; x <= L + 1e-9; i++, x = i * st) {
        const len = (i % maj ? tk : tk * 2) * side, p = [a[0] + dir[0] * x, a[1] + dir[1] * x];
        this.decal({ face: o.face, points: [p, [p[0] + nn[0] * len, p[1] + nn[1] * len]], tone: "mark" });
        if (!(i % maj) && o.label !== false) this.text({ face: o.face, at: [p[0] + nn[0] * tk * 3.3 * side, p[1] + nn[1] * tk * 3.3 * side], text: o.label ? o.label(x, i) : String(i), size: o.size ?? tk * 1.5, color: o.color ?? "muted", font: "text", weight: 500 });
      }
      this.decal({ face: o.face, points: [a, b], tone: "mark" });
      return this;
    }
  }
  for (const [k, fn] of Object.entries(BUILD)) Node.prototype[k] = function (o = {}) { return this.part(fn(o), o); };

  const FACES = { "+x": [[1, 0, 0], [0, -1, 0]], "-x": [[-1, 0, 0], [0, 1, 0]], "+y": [[0, 1, 0], [1, 0, 0]], "-y": [[0, -1, 0], [-1, 0, 0]], "+z": [[0, 0, 1], [1, 0, 0]], "-z": [[0, 0, -1], [1, 0, 0]] };
  // A face's frame: center o, u (left to right), v (up), normal n.
  function faceFrame(m, face) {
    let n, u;
    if (typeof face === "string") [n, u] = FACES[/^[+-]/.test(face) ? face : "+" + face];
    else { n = nrm(face); u = nrm(crs(abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], n)); }
    const v = crs(u, n);
    let fi = -1, best = -1e18;
    m.F.forEach((f, i) => {
      if (f.d || dot(f.n, n) < 0.99) return;
      let c = 0; for (const q of f.v) c += m.P[q * 3] * n[0] + m.P[q * 3 + 1] * n[1] + m.P[q * 3 + 2] * n[2];
      c /= f.v.length;
      if (c > best + 1e-9) { best = c; fi = i; }
    });
    if (fi < 0) throw new Error("no face " + face);
    const lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18];
    for (const q of m.F[fi].v) for (let k = 0; k < 3; k++) { lo[k] = min(lo[k], m.P[q * 3 + k]); hi[k] = max(hi[k], m.P[q * 3 + k]); }
    return { o: scl(add(lo, hi), 0.5), u, v, n, fi };
  }

  // ---------- section cut: keep n·p <= d, cap the cut with hatched faces ----------
  function clip(W0, F0, N0, plane, wrap) {
    const n = plane.slice(0, 3), d0 = plane[3], W = Array.from(W0), nv = W.length / 3, dist = new Float64Array(nv);
    for (let i = 0; i < nv; i++) dist[i] = n[0] * W[i * 3] + n[1] * W[i * 3 + 1] + n[2] * W[i * 3 + 2] - d0;
    const cache = new Map(), F = [], N = [], seg = new Map(), remap = new Map();
    const cut = (a, b) => {
      const k = a < b ? a * 2097152 + b : b * 2097152 + a;
      let i = cache.get(k);
      if (i == null) { const t = dist[a] / (dist[a] - dist[b]); for (let q = 0; q < 3; q++) W.push(W[a * 3 + q] + (W[b * 3 + q] - W[a * 3 + q]) * t); i = W.length / 3 - 1; cache.set(k, i); }
      return i;
    };
    F0.forEach((f, fi) => {
      if (f.d && !remap.has(f.d.base)) return;
      if (f.d && f.d.k === "text") { if (dot(n, f.d.o) <= d0) { F.push({ ...f, d: { ...f.d, base: remap.get(f.d.base) } }); N.push(N0[fi]); } return; }
      const out = [];
      for (const L of f.h ? [f.v, ...f.h] : [f.v]) {
        const q = [], tr = [];
        for (let i = 0; i < L.length; i++) {
          const a = L[i], b = L[(i + 1) % L.length], ia = dist[a] <= 0, ib = dist[b] <= 0;
          if (ia) q.push(a);
          if (ia !== ib && (L.length > 2 || i === 0)) { const c = cut(a, b); q.push(c); tr.push([ia ? 0 : 1, c]); }
        }
        if (!f.d && tr.length > 1) for (let k = 0; k < tr.length; k++) if (tr[k][0] === 0) { const y = tr[(k + 1) % tr.length]; if (y[0] === 1) seg.set(y[1], tr[k][1]); }
        if (q.length >= (L.length === 2 ? 2 : 3)) out.push(q);
      }
      if (!out.length) return;
      remap.set(fi, F.length);
      F.push({ ...f, v: out[0], h: out.length > 1 ? out.slice(1) : null, n: N0[fi], d: f.d ? { ...f.d, base: remap.get(f.d.base) } : f.d });
      N.push(N0[fi]);
    });
    const loops = [];
    for (const start of [...seg.keys()]) {
      if (!seg.has(start)) continue;
      const L = [];
      let p = start, guard = 0;
      while (seg.has(p) && guard++ < 1e5) { L.push(p); const q = seg.get(p); seg.delete(p); p = q; }
      if (L.length > 2) loops.push(L);
    }
    const nn = nrm(n), sid = SID++, zs = wrap && wrap.zs && wrap.zs.length > 2 ? wrap.zs : [-1e18, 1e18], hc = new Map();
    // Keep loop L where a·p <= d; k names the plane so pieces share new vertices.
    const half = (L, a, d, k) => {
      const q = [], f = i => a[0] * W[i * 3] + a[1] * W[i * 3 + 1] + a[2] * W[i * 3 + 2] - d;
      for (let i = 0; i < L.length; i++) {
        const p = L[i], r = L[(i + 1) % L.length], fp = f(p), fr = f(r);
        if (fp <= 0) q.push(p);
        if ((fp <= 0) !== (fr <= 0)) {
          const key = `${min(p, r)},${max(p, r)},${k}`;
          let x = hc.get(key);
          if (x == null) { const t = fp / (fp - fr); for (let j = 0; j < 3; j++) W.push(W[p * 3 + j] + (W[r * 3 + j] - W[p * 3 + j]) * t); x = W.length / 3 - 1; hc.set(key, x); }
          q.push(x);
        }
      }
      return q;
    };
    if (loops.length) for (let k = 0; k + 1 < zs.length; k++) {
      const a = wrap ? wrap.a : [0, 0, 1], t0 = wrap ? dot(a, wrap.o) : 0;
      const L = loops.map(l => half(half(l, a, zs[k + 1] + t0, k + 1), scl(a, -1), -(zs[k] + t0), -(k + 1) * 7 - 1)).filter(l => l.length > 2);
      if (L.length) { F.push({ v: L[0], h: L.length > 1 ? L.slice(1) : null, s: sid, c: k, n: nn, cap: true }); N.push(nn); }
    }
    return { W, F, N, E: edges(F) };
  }

  // ---------- materials: tones defined against the page palette ----------
  const NAMES = ["bg", "panel", "ink", "muted", "faint", "grid", "brass", "red", "orange", "green", "blue", "purple"];
  // Fallbacks when no stylesheet is readable.
  const DEF_L = { bg: "#fcfcfc", ink: "#111111", muted: "#666666", faint: "#d4d4d4", grid: "#efefef", brass: "#966111", red: "#d22d2d", orange: "#bd4f08", green: "#18793e", blue: "#2457d6", purple: "#7438e0" };
  const DEF_D = { bg: "#0a0a0a", ink: "#ededed", muted: "#9a9a9a", faint: "#3a3a3a", grid: "#1a1a1a", brass: "#d9a548", red: "#f47272", orange: "#f59447", green: "#4fd185", blue: "#6aa5ff", purple: "#ac8cff" };
  function parse(v) {
    const s = String(v ?? "").trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [...m[1]].map(h => parseInt(h + h, 16));
    m = /^#([0-9a-f]{6})/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  function mkPal(src, def) {
    const p = {};
    for (const n of NAMES) p[n] = parse(src[n]) || parse(def[n]) || [128, 128, 128];
    if (!parse(src.panel)) p.panel = p.bg;
    p.dark = lum(p.panel) < lum(p.ink);
    p.id = NAMES.map(n => p[n].join(",")).join("|");
    return p;
  }
  let LIVE = null;
  function livePal() {
    const src = (typeof window !== "undefined" && window.palette) || {}, key = (src.ink || "") + (src.panel || "") + (src.blue || "");
    if (!LIVE || LIVE.key !== key) { LIVE = mkPal(src, DEF_L); LIVE.key = key; }
    return LIVE;
  }
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hex = c => "#" + c.map(v => clamp(round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  // [light base, dark base, metal, line tint, alpha]; a base [a, b, t, c, t2] mixes a to b by t, then to c by t2.
  const MAT = {
    porcelain: [["panel", "ink", 0.035], ["panel", "ink", 0.34]],
    white: [["panel", "ink", 0], ["panel", "ink", 0.42]],
    steel: [["panel", "ink", 0.17, "blue", 0.05], ["panel", "ink", 0.27, "blue", 0.07], 1],
    aluminum: [["panel", "ink", 0.08, "blue", 0.035], ["panel", "ink", 0.37, "blue", 0.05], 1],
    brass: [["panel", "brass", 0.5], ["panel", "brass", 0.62], 1, "brass"],
    rubber: [["panel", "ink", 0.74], ["panel", "ink", 0.13]],
    plastic: [["panel", "ink", 0.56], ["panel", "ink", 0.2]],
    graphite: [["panel", "ink", 0.4], ["panel", "ink", 0.24]],
    glass: [["panel", "blue", 0.18], ["panel", "blue", 0.3], 1, "blue", 0.26],
    ghost: [["panel", "ink", 0.04], ["panel", "ink", 0.3], 0, null, 0.3],
    hot: [["panel", "orange", 0.55], ["panel", "orange", 0.7], 0, "orange"],
  };
  for (const c of ["red", "orange", "green", "blue", "purple"]) MAT[c] = [["panel", c, 0.3], ["panel", c, 0.52], 0, c];
  const baseOf = (b, p) => { let c = mixc(p[b[0]], p[b[1]], b[2]); if (b[3]) c = mixc(c, p[b[3]], b[4]); return c; };
  // Tones: 0 top, 1-4 sides, 5 specular, 6 cut, 7 slot, 8 screen, 9 mark, 10 silhouette, 11 crease, 12 hatch.
  function toneSet(p, mat, color) {
    const M = MAT[mat] || MAT.porcelain, dk = p.dark, tint = color || M[3];
    const b = color && MAT[color] ? baseOf(MAT[color][dk ? 1 : 0], p) : baseOf(M[dk ? 1 : 0], p);
    const tg = dk ? p.panel : p.ink, f = dk ? [0, 0.22, 0.38, 0.54, 0.68] : [0, 0.08, 0.18, 0.31, 0.45];
    const t = f.map(x => mixc(b, tg, x));
    t.push(dk ? mixc(b, p.ink, 0.4) : mixc(b, p.panel, 0.8), dk ? mixc(b, tg, 0.5) : mixc(b, p.ink, 0.27), dk ? mixc(b, tg, 0.8) : mixc(b, p.ink, 0.62),
      dk ? mixc(p.panel, p.ink, 0.04) : mixc(p.panel, p.ink, 0.86));
    let sil = mixc(p.ink, p.panel, dk ? 0.1 : 0.03), cre = mixc(p.ink, p.panel, dk ? 0.5 : 0.48);
    if (tint && p[tint]) { sil = mixc(sil, p[tint], 0.35); cre = mixc(cre, p[tint], 0.3); }
    t.push(mixc(p.ink, p.panel, dk ? 0.15 : 0.1), sil, cre, dk ? mixc(b, p.ink, 0.32) : mixc(b, p.ink, 0.52));
    return t;
  }
  const CACHE = new Map();
  // Colors for one part this frame: material, subject color, heat (blend to "hot"), highlight.
  function partColors(p, r, hlc, fmt = hex) {
    const n = r.node, heat = round(clamp(n.heat || 0, 0, 1) * 50) / 50, hl = round((r.hl || 0) * 20) / 20;
    const key = `${p.id}|${n.material}|${n.color || ""}|${heat}|${hl}|${hlc}`;
    let c = CACHE.get(key);
    if (!c) {
      let t = toneSet(p, n.material, n.color);
      if (heat) { const h = toneSet(p, "hot"); t = t.map((x, i) => (i < 9 || i === 12 ? mixc(x, h[i], heat) : x)); }
      if (hl) { const h = toneSet(p, hlc, hlc); t = t.map((x, i) => (i < 9 ? mixc(x, h[i], 0.5 * hl) : i === 10 ? mixc(x, p[hlc] || x, 0.7 * hl) : x)); }
      c = t.map(fmt);
      if (CACHE.size > 4000) CACHE.clear();
      CACHE.set(key, c);
    }
    return c;
  }
  const alphaOf = n => (n.opacity != null ? n.opacity : (MAT[n.material] || [])[4] ?? 1);

  // ---------- camera: orthographic, azimuth A (yaw) and elevation E (pitch) ----------
  const VIEWS = { iso: { yaw: PI / 4, pitch: Math.atan(1 / sqrt(2)) }, dimetric: { yaw: PI / 4, pitch: PI / 6 },
    front: { yaw: PI / 2, pitch: 0 }, side: { yaw: 0, pitch: 0 }, top: { yaw: PI / 2, pitch: PI / 2 - 1e-4 } };
  function camera(scene, A, E, box, lo, hi, o, recs) {
    const sA = sin(A), cA = cos(A), sE = sin(E), cE = cos(E);
    const R = [sA, -cA, 0], D = [cA * sE, sA * sE, -cE], V = [cA * cE, sA * cE, sE];
    const zoom = o.zoom ?? 1, bw = box[2], bh = box[3];
    let fit = scene._fit;
    if (!fit || o.fit === "always" || fit.w !== bw || fit.h !== bh || fit.zoom !== zoom) {
      // Fit every vertex (or o.bounds) into the box.
      let x0 = 1e18, x1 = -1e18, y0 = 1e18, y1 = -1e18;
      const see = (x, y, z) => { const a = x * R[0] + y * R[1], b = x * D[0] + y * D[1] + z * D[2]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; };
      if (o.bounds) for (let i = 0; i < 8; i++) see(o.bounds[i & 1][0], o.bounds[(i >> 1) & 1][1], o.bounds[i >> 2][2]);
      else for (const r of recs) { const W = r.G.W; for (let i = 0; i < W.length; i += 3) see(W[i], W[i + 1], W[i + 2]); }
      const mg = o.margin ?? 0.92, k = min(bw * mg / (x1 - x0 || 1), bh * mg / (y1 - y0 || 1)) * zoom, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      fit = scene._fit = { w: bw, h: bh, zoom, k, c: add(add(scl(R, cx), scl(D, cy)), scl(V, dot(scl(add(lo, hi), 0.5), V))) };
    }
    const k = o.scale ? o.scale * sqrt(1.6) : fit.k, c = o.center || fit.c;
    const ox = box[0] + bw / 2 - k * dot(c, R), oy = box[1] + bh / 2 - k * dot(c, D);
    const L = nrm(add(add(scl(R, -0.52), scl(D, -0.62)), scl(V, 0.58))), H = nrm(add(add(scl(R, -0.45), scl(D, -0.3)), V));
    return { A, E, R, D, V, L, H, k, ox, oy, T: a => nrm(sub(H, scl(a, dot(H, a)))), key: [A, E, k, ox, oy].map(x => x.toFixed(6)).join(","),
      p: q => [ox + k * (q[0] * R[0] + q[1] * R[1]), oy + k * (q[0] * D[0] + q[1] * D[1] + q[2] * D[2]), dot(q, V)] };
  }
  // The light is locked to the camera: tops get their own fill, sides fall in four buckets.
  // Turned metal parts get a specular stripe, measured around their axis.
  function toneOf(n, cam, ax) {
    if (ax) { const d = dot(n, ax), q = sub(n, scl(ax, d)), l = hypot(...q); if (l > 0.3 && dot(q, cam.T(ax)) / l > 0.975) return 5; }
    if (n[2] > 0.8) return 0;
    const i = dot(n, cam.L);
    return i > 0.35 ? 1 : i > 0 ? 2 : i > -0.3 ? 3 : 4;
  }

  // ---------- layout: world geometry, projection, paint order ----------
  function walk(n, M, cut, layer, names, out) {
    if (!n.visible) return;
    if (n.move || n.rotate) M = mul(M, pose(n));
    if (n.cut !== undefined) cut = n.cut || null;
    if (n.layer != null) layer = n.layer;
    if (n.name) names = names.concat(n.name);
    if (n.mesh) out.push({ node: n, M, cut, layer, names });
    for (const k of n.kids) walk(k, M, cut, layer, names, out);
  }
  function geo(r) {
    const n = r.node, m = n.mesh, key = r.M.map(x => x.toFixed(7)).join(",") + (r.cut ? "|" + r.cut.join(",") : "") + "|" + m.id + "." + m.F.length;
    let G = n._g;
    if (!G || G.key !== key) {
      const M = r.M, P = m.P, nv = P.length / 3;
      let W = new Float64Array(nv * 3);
      for (let i = 0; i < nv * 3; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        W[i] = M[0] * x + M[1] * y + M[2] * z + M[3]; W[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7]; W[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
      }
      let F = m.F, E = m.E, N = F.map(f => ad(M, f.n));
      const wr = m.wrap && { o: ap(M, m.wrap.o), a: ad(M, m.wrap.a), z0: m.wrap.z0, z1: m.wrap.z1, r: m.wrap.r, zs: m.wrap.zs };
      if (r.cut) ({ W, F, N, E } = clip(W, F, N, r.cut, wr));
      const lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18];
      for (const f of F) for (const q of f.v) for (let k = 0; k < 3; k++) { const v = W[q * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
      const rotd = abs(M[0] - 1) + abs(M[5] - 1) + abs(M[10] - 1) > 1e-9;
      G = n._g = { key, ver: (G ? G.ver : 0) + 1, W, F, N, E, lo, hi, rot: rotd && !r.cut, wrap: wr };
    }
    r.G = G;
  }
  function layout(scene, o = {}) {
    const t0 = now(), box = o.box || [0, 0, o.w || 640, o.h || 400], vw = o.view || {};
    const A = vw.yaw ?? o.yaw ?? PI / 4, E = vw.pitch ?? o.pitch ?? PI / 6, recs = [];
    walk(scene, ID, null, 0, [], recs);
    const lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18];
    let h = 7;
    for (const r of recs) {
      geo(r);
      for (let k = 0; k < 3; k++) { lo[k] = min(lo[k], r.G.lo[k]); hi[k] = max(hi[k], r.G.hi[k]); }
      h = (h * 31 + r.node.id * 17 + r.G.ver * 7 + r.layer) | 0;
    }
    if (!recs.length) for (let k = 0; k < 3; k++) { lo[k] = -1; hi[k] = 1; }
    const cam = camera(scene, A, E, box, lo, hi, o, recs), key = `${cam.key}|${h}|${recs.length}`;
    let V = scene._lay;
    if (!V || V.key !== key) V = scene._lay = order(scene, recs, cam, lo, hi, key, box);
    V.ms = now() - t0;
    return V;
  }
  function order(scene, recs, cam, lo, hi, key, box) {
    const { V, k, ox, oy, R, D } = cam, eps = 1e-6 * (hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1), chunks = [];
    let faces = 0;
    for (const r of recs) {
      const G = r.G, W = G.W, nv = W.length / 3, S = (r.S = new Float64Array(nv * 3)), F = G.F, nf = F.length, m = r.node.mesh;
      for (let i = 0, j = 0; i < nv; i++, j += 3) {
        const x = W[j], y = W[j + 1], z = W[j + 2];
        S[j] = ox + k * (x * R[0] + y * R[1]); S[j + 1] = oy + k * (x * D[0] + y * D[1] + z * D[2]); S[j + 2] = x * V[0] + y * V[1] + z * V[2];
      }
      const front = (r.front = new Uint8Array(nf)), tone = (r.tone = new Uint8Array(nf)), ch = (r.ch = new Int32Array(nf)), ax = (MAT[r.node.material] || [])[2] && m.ax && nrm(ad(r.M, m.ax));
      const w = G.wrap;
      let vp = null;
      if (w) { vp = sub(V, scl(w.a, dot(V, w.a))); if (hypot(...vp) < 1e-3) vp = null; }
      const map = new Map();
      for (let f = 0; f < nf; f++) {
        const fc = F[f], d = fc.d;
        if (d) { front[f] = front[d.base] ?? 0; ch[f] = ch[d.base] ?? 0; }
        else {
          front[f] = dot(G.N[f], V) > 1e-7 ? 1 : 0;
          if (front[f]) tone[f] = fc.cap ? 6 : toneOf(G.N[f], cam, fc.s && ax);
          if (w) { let c = [0, 0, 0]; for (const q of fc.v) c = add(c, [W[q * 3], W[q * 3 + 1], W[q * 3 + 2]]); ch[f] = (fc.c || 0) * 2 + (vp && dot(sub(scl(c, 1 / fc.v.length), w.o), vp) > 0 ? 1 : 0); }
          else ch[f] = fc.c || 0;
        }
        let C = map.get(ch[f]);
        if (!C) map.set(ch[f], (C = { r, c: ch[f], faces: [], all: [], layer: r.layer, key: r.node.id * 64 + ch[f] }));
        C.all.push(f);
        if (front[f]) C.faces.push(f);
      }
      for (const C of map.values()) {
        if (!C.faces.length) continue;
        const l = [1e18, 1e18, 1e18], u = [-1e18, -1e18, -1e18], sb = [1e18, 1e18, -1e18, -1e18];
        for (const f of C.all) for (const q of F[f].v) for (let a = 0; a < 3; a++) { const v = W[q * 3 + a]; if (v < l[a]) l[a] = v; if (v > u[a]) u[a] = v; }
        for (const f of C.faces) for (const q of F[f].v) { const x = S[q * 3], y = S[q * 3 + 1]; if (x < sb[0]) sb[0] = x; if (y < sb[1]) sb[1] = y; if (x > sb[2]) sb[2] = x; if (y > sb[3]) sb[3] = y; }
        if (!(sb[2] >= sb[0])) continue;
        Object.assign(C, { lo: l, hi: u, sb, dz: dot(scl(add(l, u), 0.5), V) });
        if (G.rot) {   // oriented box from the part's own axes
          const M = r.M, ll = [1e18, 1e18, 1e18], hh = [-1e18, -1e18, -1e18], P = m.P;
          for (const f of C.all) for (const q of F[f].v) for (let a = 0; a < 3; a++) { const v = P[q * 3 + a]; if (v < ll[a]) ll[a] = v; if (v > hh[a]) hh[a] = v; }
          const ax = [0, 1, 2].map(i => [M[i], M[4 + i], M[8 + i]]), t = [M[3], M[7], M[11]], corners = [];
          for (let i = 0; i < 8; i++) corners.push(ap(M, [i & 1 ? hh[0] : ll[0], i & 2 ? hh[1] : ll[1], i & 4 ? hh[2] : ll[2]]));
          C.ob = { ax, lo: ax.map((a, i) => ll[i] + dot(a, t)), hi: ax.map((a, i) => hh[i] + dot(a, t)), corners };
        }
        chunks.push(C);
        faces += C.faces.length;
      }
    }
    // Constraints between chunks that overlap on screen, then a stable topological sort.
    const N = chunks.length, prev = scene._rank, pri = new Float64Array(N);
    chunks.map((c, i) => i).sort((a, b) => chunks[a].dz - chunks[b].dz).forEach((ci, rank) => { pri[ci] = rank; });
    if (prev) for (let i = 0; i < N; i++) { const p = prev.get(chunks[i].key); if (p != null) pri[i] = p; }
    const byX = chunks.map((c, i) => i).sort((a, b) => chunks[a].sb[0] - chunks[b].sb[0]), adj = Array.from({ length: N }, () => []), pre = Array.from({ length: N }, () => []), indeg = new Int32Array(N), strong = new Int32Array(N);
    for (let a = 0; a < N; a++) {
      const ia = byX[a], P = chunks[ia];
      for (let b = a + 1; b < N; b++) {
        const ib = byX[b], Q = chunks[ib];
        if (Q.sb[0] >= P.sb[2]) break;
        if (Q.sb[1] >= P.sb[3] || Q.sb[3] <= P.sb[1]) continue;
        let s = before(P, Q, V, eps);
        if (s === 2) continue;   // neither can hide the other
        const weak = !s;         // no separating plane: fall back to depth, as a weak edge
        if (weak) s = P.dz < Q.dz ? 1 : -1;
        const [u, w] = s > 0 ? [ia, ib] : [ib, ia];
        adj[u].push(weak ? ~w : w); pre[w].push(u); indeg[w]++; if (!weak) strong[w]++;
      }
    }
    const heap = [], push = i => { heap.push(i); let j = heap.length - 1; while (j > 0) { const p = (j - 1) >> 1; if (pri[heap[p]] <= pri[heap[j]]) break; [heap[p], heap[j]] = [heap[j], heap[p]]; j = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let j = 0; ;) { const l = 2 * j + 1, r = l + 1; let m = j; if (l < heap.length && pri[heap[l]] < pri[heap[m]]) m = l; if (r < heap.length && pri[heap[r]] < pri[heap[m]]) m = r; if (m === j) break; [heap[m], heap[j]] = [heap[j], heap[m]]; j = m; }
      }
      return top;
    };
    const done = new Uint8Array(N), seq = [];
    let cycles = 0;
    for (let i = 0; i < N; i++) if (!indeg[i]) push(i);
    while (seq.length < N) {
      let i = -1;
      if (heap.length) { i = pop(); if (done[i]) continue; }
      else {
        // Stuck on a cycle: free a node held only by weak edges, else walk back to a node on the cycle.
        cycles++;
        for (let j = 0; j < N; j++) if (!done[j] && !strong[j] && (i < 0 || pri[j] < pri[i])) i = j;
        if (i < 0) {
          const seen = new Map();
          let v = 0;
          while (done[v]) v++;
          while (!seen.has(v)) { seen.set(v, seen.size); v = pre[v].find(u => !done[u]) ?? v; }
          const k0 = seen.get(v);
          for (const [u, k] of seen) if (k >= k0 && (i < 0 || pri[u] < pri[i])) i = u;
        }
      }
      done[i] = 1; seq.push(i);
      for (const e of adj[i]) { const w = e < 0 ? ~e : e; if (done[w]) continue; if (e >= 0) strong[w]--; if (--indeg[w] === 0) push(w); }
    }
    scene._rank = new Map(seq.map((ci, rank) => [chunks[ci].key, rank]));
    // Faces inside each chunk: convex pieces need no sort; decals follow their face.
    const list = [];
    for (const r of recs) r.items = [];
    for (const ci of seq) {
      const C = chunks[ci], r = C.r, F = r.G.F, S = r.S, dec = new Map(), fs = [];
      for (const f of C.faces) { const d = F[f].d; if (d) { if (!dec.has(d.base)) dec.set(d.base, []); dec.get(d.base).push(f); } else fs.push(f); }
      if (!(r.node.mesh.convex && !r.cut)) {
        const dz = f => { let s = 0; for (const q of F[f].v) s += S[q * 3 + 2]; return s / F[f].v.length; }, key = new Map(fs.map(f => [f, dz(f)]));
        fs.sort((a, b) => key.get(a) - key.get(b));
      }
      const seam = r.node.mesh.nc > 1 || !!r.cut, start = list.length;
      for (const f of fs) {
        list.push((r.items[f] = { r, f, t: r.tone[f], i: list.length, seam: seam || !!F[f].s, sil: [], cre: [] }));
        for (const d of dec.get(f) || []) list.push((r.items[d] = { r, f: d, i: list.length, sil: [], cre: [] }));
      }
      if (r.node.mesh.convex && !r.cut && list.length - start > 1) list[start].run = list.length - start;   // faces that can't overlap: batch them
    }
    // Lines: silhouettes (front face by back face) and creases (owned by the later of two front faces).
    for (const r of recs) {
      const fr = r.front, it = r.items;
      for (const e of r.G.E) {
        const a = e[2], b = e[3], fa = fr[a] && it[a], fb = b >= 0 && fr[b] && it[b];
        if (fa && fb) { if (e[4]) (fa.i > fb.i ? fa : fb).cre.push(e); }
        else if (fa || fb) (fa || fb).sil.push(e);
      }
    }
    // Contact shadow: footprints of parts on the ground, projected.
    const gz = scene.ground ?? lo[2], hz = (hi[2] - lo[2]) * 0.06, amb = [], con = [];
    for (const r of recs) {
      if (r.node.shadow === false || alphaOf(r.node) < 1) continue;
      const l = r.G.lo, u = r.G.hi, poly = [[l[0], l[1]], [u[0], l[1]], [u[0], u[1]], [l[0], u[1]]].map(([x, y]) => cam.p([x, y, gz]));
      amb.push(poly);
      if (l[2] < gz + hz) con.push(poly);
    }
    return Object.assign(Object.create(VIEW), { key, cam, box, scene, recs, list, chunks: seq.map(i => chunks[i]), shadow: { amb, con }, lo, hi, faces, cycles });
  }
  // Does chunk P paint before chunk Q? 1 yes, -1 no, 0 unknown (no separating plane), 2 either
  // (two separating planes disagree, so neither can hide the other).
  function before(P, Q, V, eps) {
    if (P.layer !== Q.layer) return P.layer < Q.layer ? 1 : -1;
    const wp = P.r.G.wrap, wq = Q.r.G.wrap;
    let s = 0;
    const vote = x => { if (!s) s = x; else if (s !== x) s = 2; };
    if (P.r === Q.r && wp) {   // one shell: the plane through its axis puts back halves first
      if (P.c >> 1 === Q.c >> 1) return P.c < Q.c ? 1 : -1;
      if ((P.c & 1) !== (Q.c & 1)) vote(P.c & 1 ? -1 : 1);
    }
    if (wp && P.r !== Q.r && inside(Q, wp) && over(P, Q, wp)) return P.c & 1 ? -1 : 1;
    if (wq && P.r !== Q.r && inside(P, wq) && over(P, Q, wq)) return Q.c & 1 ? 1 : -1;
    for (let a = 0; a < 3 && s !== 2; a++) {
      const v = V[a];
      if (abs(v) < 1e-4) continue;
      if (P.hi[a] <= Q.lo[a] + eps) vote(v > 0 ? 1 : -1);
      else if (Q.hi[a] <= P.lo[a] + eps) vote(v > 0 ? -1 : 1);
    }
    for (const [X, Y, sg] of [[P, Q, 1], [Q, P, -1]]) {
      if (!X.ob || s === 2) continue;
      for (let i = 0; i < 3; i++) {
        const ax = X.ob.ax[i], v = dot(ax, V);
        if (abs(v) < 1e-4) continue;
        const [y0, y1] = range(Y, ax);
        if (X.ob.hi[i] <= y0 + eps) vote(sg * (v > 0 ? 1 : -1));
        else if (y1 <= X.ob.lo[i] + eps) vote(sg * (v > 0 ? -1 : 1));
      }
    }
    return s;
  }
  function range(C, ax) {
    let a = 1e18, b = -1e18;
    const pts = C.ob ? C.ob.corners : Array.from({ length: 8 }, (_, i) => [i & 1 ? C.hi[0] : C.lo[0], i & 2 ? C.hi[1] : C.lo[1], i & 4 ? C.hi[2] : C.lo[2]]);
    for (const p of pts) { const d = dot(p, ax); if (d < a) a = d; if (d > b) b = d; }
    return [a, b];
  }
  // A chunk's extent along a shell's axis: [center, half length, half size].
  const span = (C, w) => { const e = scl(sub(C.hi, C.lo), 0.5), c = add(C.lo, e); return [dot(sub(c, w.o), w.a), abs(e[0] * w.a[0]) + abs(e[1] * w.a[1]) + abs(e[2] * w.a[2]), e, c]; };
  const over = (P, Q, w) => { const a = span(P, w), b = span(Q, w); return a[1] + b[1] - abs(a[0] - b[0]) > 0.6 * min(a[1], b[1]); };
  // Is chunk C inside the shell w (a part that wraps others)? Coaxial shells compare radii.
  function inside(C, w) {
    const q = C.r.G.wrap, [t, ext, e, c] = span(C, w);
    if (t < w.z0 || t > w.z1 || min(t + ext, w.z1) - max(t - ext, w.z0) < ext) return false;   // mostly within the shell's length
    if (q && hypot(...crs(q.a, w.a)) < 0.01) { const d = sub(q.o, w.o); return hypot(...sub(d, scl(w.a, dot(d, w.a)))) < w.r * 0.05 && q.r < w.r; }
    const rq = sqrt(max(0, dot(e, e) - ext * ext));
    return hypot(...sub(sub(c, w.o), scl(w.a, t))) + 0.7 * rq < w.r;
  }
  function inPoly(S, L, H, p) {
    let c = false;
    for (const lp of H ? [L, ...H] : [L]) for (let i = 0, j = lp.length - 1; i < lp.length; j = i++) {
      const a = lp[i] * 3, b = lp[j] * 3, yi = S[a + 1], yj = S[b + 1];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < (S[b] - S[a]) * (p[1] - yi) / (yj - yi) + S[a]) c = !c;
    }
    return c;
  }
  const planeDepth = (V, it, p) => {
    const r = it.r, F = r.G.F[it.f], n = r.G.N[it.f], W = r.G.W, j = F.v[0] * 3, c = V.cam;
    const q = add(scl(c.R, (p[0] - c.ox) / c.k), scl(c.D, (p[1] - c.oy) / c.k)), den = dot(n, c.V);
    return abs(den) < 1e-9 ? null : (dot(n, [W[j], W[j + 1], W[j + 2]]) - dot(n, q)) / den;
  };

  // ---------- the view a layout returns ----------
  const VIEW = {
    project(p) { return this.cam.p(p); },
    // A screen point back onto the plane z = h, or onto { point, normal }.
    unproject(pt, z = 0) {
      const c = this.cam, q = add(scl(c.R, (pt[0] - c.ox) / c.k), scl(c.D, (pt[1] - c.oy) / c.k));
      const n = typeof z === "object" ? z.normal : [0, 0, 1], d0 = typeof z === "object" ? dot(z.normal, z.point) : z, den = dot(n, c.V);
      return abs(den) < 1e-9 ? null : add(q, scl(c.V, (d0 - dot(n, q)) / den));
    },
    // The front-most part under a screen point (solid parts first, then see-through ones).
    pick(pt) {
      for (const glass of [false, true]) for (let i = this.list.length - 1; i >= 0; i--) {
        const it = this.list[i], r = it.r, F = r.G.F[it.f];
        if (F.d || r.node.pickable === false || (alphaOf(r.node) < 1) !== glass) continue;
        if (inPoly(r.S, F.v, F.h, pt)) {
          const d = planeDepth(this, it, pt);
          return { node: r.node, name: r.names[r.names.length - 1] ?? "", names: r.names, face: it.f, point: d == null ? null : add(add(scl(this.cam.R, (pt[0] - this.cam.ox) / this.cam.k), scl(this.cam.D, (pt[1] - this.cam.oy) / this.cam.k)), scl(this.cam.V, d)) };
        }
      }
      return null;
    },
    // World bounds of every part with this name (or in a group with it).
    bounds(name) {
      const lo = [1e18, 1e18, 1e18], hi = [-1e18, -1e18, -1e18];
      let any = false;
      for (const r of this.recs) if (r.names.includes(name)) { any = true; for (let k = 0; k < 3; k++) { lo[k] = min(lo[k], r.G.lo[k]); hi[k] = max(hi[k], r.G.hi[k]); } }
      return any ? [lo, hi] : null;
    },
    at(name, f = [0.5, 0.5, 0.5]) { const b = this.bounds(name); return b ? this.project([0, 1, 2].map(k => lerp(b[0][k], b[1][k], f[k]))) : null; },
    // The screen ellipse of a 3D circle, in the effects kit's format.
    ellipse(c, n, r) {
      n = nrm(n);
      const u = nrm(crs(abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n)), w = crs(n, u), p0 = this.project(c);
      const d = v => { const p = this.project(add(c, scl(v, r))); return [p[0] - p0[0], p[1] - p0[1]]; };
      const a = d(u), b = d(w), A = d(n), LA = hypot(...A), P = a[0] ** 2 + b[0] ** 2, Q = a[0] * a[1] + b[0] * b[1], S = a[1] ** 2 + b[1] ** 2, m = (P + S) / 2, q = hypot((P - S) / 2, Q);
      return { center: [p0[0], p0[1]], rx: sqrt(m + q), ry: sqrt(max(0, m - q)), angle: 0.5 * Math.atan2(2 * Q, P - S), axis: LA > 1e-9 ? [A[0] / LA, A[1] / LA] : [1, 0], along: LA };
    },
    axis(a, b) { const p = this.project(a), q = this.project(b), l = hypot(q[0] - p[0], q[1] - p[1]) || 1; return { from: p, to: q, dir: [(q[0] - p[0]) / l, (q[1] - p[1]) / l], length: l }; },
    get stats() { return { faces: this.faces, chunks: this.chunks.length, cycles: this.cycles, ms: this.ms }; },
  };

  // ---------- painting, to a canvas or to SVG ----------
  const LW = { sil: 1.35, cre: 0.7 };
  function textMatrix(cam, r, d) {
    const o = ap(r.M, d.o), u = ad(r.M, d.u), v = ad(r.M, d.v), s = d.size / 10, k = cam.k, p = cam.p(o);
    return [s * k * dot(u, cam.R), s * k * dot(u, cam.D), -s * k * dot(v, cam.R), -s * k * dot(v, cam.D), p[0], p[1]];
  }
  function paint(V, pen, colorsOf, nameColor, o = {}) {
    const ink = (V.scene.ink ?? 1) * (o.ink ?? 1), L = V.list;
    if (V.scene.shadow !== false) pen.shadow(V.shadow);
    const lines = (r, S, col, a, cre, sil) => {
      if (cre.length) pen.seg(S, cre, col[11], LW.cre * ink, a < 1 ? 0.55 : 1);
      if (sil.length) pen.seg(S, sil, col[10], LW.sil * ink * (1 + 0.5 * (r.hl || 0)), a < 1 ? 0.7 : 1);
    };
    for (let i = 0; i < L.length; i++) {
      const it = L[i], r = it.r, F = r.G.F[it.f], S = r.S, col = colorsOf(r), a = alphaOf(r.node), d = F.d;
      if (it.run) {   // a convex chunk: one fill per tone, then all its lines in two strokes
        const tones = new Map(), cre = [], sil = [], dec = [];
        let sm = 0;
        for (let k = i; k < i + it.run; k++) {
          const q = L[k], G = r.G.F[q.f];
          if (G.d) { dec.push(q); continue; }
          if (!tones.has(q.t)) tones.set(q.t, []);
          tones.get(q.t).push(G.v, ...(G.h || []));
          cre.push(...q.cre); sil.push(...q.sil); sm ||= q.seam;
        }
        for (const [t, loops] of tones) pen.poly(S, loops, col[t], a, a < 1 || !sm ? 0 : 0.6);
        for (const q of dec) mark(q);
        lines(r, S, col, a, cre, sil);
        i += it.run - 1;
        continue;
      }
      if (d) { mark(it); continue; }
      const loops = F.h ? [F.v, ...F.h] : [F.v];
      pen.poly(S, loops, col[it.t], a, a < 1 ? 0 : it.seam ? 0.6 : 0);
      if (F.cap) pen.hatch(S, loops, col[12]);
      lines(r, S, col, a, it.cre, it.sil);
    }
    function mark(it) {
      const r = it.r, F = r.G.F[it.f], S = r.S, col = colorsOf(r), a = alphaOf(r.node), d = F.d;
      {
        if (d.k === "text") { if (d.text !== "" && d.text != null) pen.text(String(d.text), textMatrix(V.cam, r, d), nameColor(d.color), d); return; }
        if (d.tone === "none") return;
        const c = d.tone === "slot" ? col[7] : d.tone === "screen" ? col[8] : d.tone === "mark" ? col[9] : nameColor(d.tone);
        if (d.k === "line") return pen.seg(S, [F.v], c, (d.w || 0.8) * ink, a);
        pen.poly(S, [F.v], c, a, 0);
        if (d.line) pen.seg(S, F.v.map((q, i) => [q, F.v[(i + 1) % F.v.length]]), col[11], LW.cre * ink * 0.85, a);
      }
    }
  }
  function canvasPen(ctx, g, fonts, sh) {
    const trace = (S, L) => { let j = L[0] * 3; ctx.moveTo(S[j], S[j + 1]); for (let i = 1; i < L.length; i++) { j = L[i] * 3; ctx.lineTo(S[j], S[j + 1]); } ctx.closePath(); };
    const blur = (polys, b, color, alpha) => {
      if (!polys.length) return;
      const dpr = g.dpr || 1, off = 6000;
      ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = b * dpr; ctx.shadowOffsetX = off * dpr; ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.beginPath();
      for (const P of polys) { ctx.moveTo(P[0][0] - off, P[0][1]); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0] - off, P[i][1]); ctx.closePath(); }
      ctx.fill(); ctx.restore();
    };
    return {
      poly(S, loops, fill, a, seam) {
        ctx.beginPath(); for (const L of loops) trace(S, L);
        ctx.globalAlpha = a; ctx.fillStyle = fill; ctx.fill("evenodd");
        if (seam) { ctx.strokeStyle = fill; ctx.lineWidth = seam; ctx.stroke(); }
        ctx.globalAlpha = 1;
      },
      hatch(S, loops, color) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        ctx.save(); ctx.beginPath();
        for (const L of loops) { trace(S, L); for (const q of L) { x0 = min(x0, S[q * 3]); x1 = max(x1, S[q * 3]); y0 = min(y0, S[q * 3 + 1]); y1 = max(y1, S[q * 3 + 1]); } }
        ctx.clip("evenodd"); ctx.beginPath();
        for (let x = x0 - (y1 - y0); x < x1; x += 4.5) { ctx.moveTo(x, y1); ctx.lineTo(x + (y1 - y0), y0); }
        ctx.strokeStyle = color; ctx.lineWidth = 0.75; ctx.stroke(); ctx.restore();
      },
      seg(S, es, color, w, a) {
        ctx.beginPath();
        for (const e of es) { const i = e[0] * 3, j = e[1] * 3; ctx.moveTo(S[i], S[i + 1]); ctx.lineTo(S[j], S[j + 1]); }
        ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); ctx.globalAlpha = 1;
      },
      text(str, m, color, d) {
        ctx.save(); ctx.transform(...m);
        ctx.font = `${d.weight} 10px ${d.font === "mono" ? fonts.mono : fonts.text}`;
        ctx.textAlign = d.align; ctx.textBaseline = "middle"; ctx.fillStyle = color; ctx.fillText(str, 0, 0); ctx.restore();
      },
      shadow(s) { blur(s.amb, 16, sh.color, sh.amb); blur(s.con, 5, sh.color, sh.con); },
    };
  }
  const f1 = x => (round(x * 10) / 10).toString();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function svgPen(out, sh) {
    const P = (S, L) => { let s = ""; for (let i = 0; i < L.length; i++) { const j = L[i] * 3; s += (i ? "L" : "M") + f1(S[j]) + " " + f1(S[j + 1]); } return s + "Z"; };
    const op = (k, a) => (a < 1 ? ` ${k}="${a}"` : "");
    return {
      poly(S, loops, fill, a, seam) { out.push(`<path d="${loops.map(L => P(S, L)).join("")}" fill="${fill}"${loops.length > 1 ? ' fill-rule="evenodd"' : ""}${op("fill-opacity", a)}${seam ? ` stroke="${fill}" stroke-width="${seam}"` : ""}/>`); },
      hatch(S, loops) { out.push(`<path d="${loops.map(L => P(S, L)).join("")}" fill="url(#iso-hatch)" fill-rule="evenodd"/>`); },
      seg(S, es, color, w, a) { if (es.length) out.push(`<path d="${es.map(e => `M${f1(S[e[0] * 3])} ${f1(S[e[0] * 3 + 1])}L${f1(S[e[1] * 3])} ${f1(S[e[1] * 3 + 1])}`).join("")}" fill="none" stroke="${color}" stroke-width="${f1(w * 10) / 10}"${op("stroke-opacity", a)}/>`); },
      text(str, m, color, d) { out.push(`<text transform="matrix(${m.map(x => (round(x * 1000) / 1000)).join(" ")})" fill="${color}" font-family="${d.font === "mono" ? "monospace" : "sans-serif"}" font-size="10" font-weight="${d.weight}" text-anchor="${d.align === "left" ? "start" : d.align === "right" ? "end" : "middle"}" dominant-baseline="central">${esc(str)}</text>`); },
      shadow(s) {
        for (const [polys, b, a] of [[s.amb, 8, sh.amb], [s.con, 2.5, sh.con]]) if (polys.length)
          out.push(`<path d="${polys.map(p => "M" + p.map(q => f1(q[0]) + " " + f1(q[1])).join("L") + "Z").join("")}" fill="${sh.color}" fill-opacity="${a}" filter="url(#iso-b${b * 10})"/>`);
      },
    };
  }
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // A glow at a 3D point: g.fx.glow when present, else a gradient.
  function glow(g, V, p3, o = {}) {
    const p = V.project(p3), I = o.intensity ?? 1, r = o.r ?? 6, sp = o.spread ?? 22;
    if (I <= 0.01) return null;
    if (g.fx && g.fx.glow) return g.fx.glow(o.box ?? null, { at: [p[0], p[1]], r, temp: o.temp ?? 1500, intensity: I, spread: sp, seed: o.seed, t: o.t });
    const c = g.ctx, R = r + sp, gr = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], R), col = o.color ?? "orange";
    gr.addColorStop(0, g.rgba(col, 0.9 * min(1, I))); gr.addColorStop(r / R, g.rgba(col, 0.5 * min(1, I))); gr.addColorStop(1, g.rgba(col, 0));
    c.save(); c.fillStyle = gr; c.fillRect(p[0] - R, p[1] - R, 2 * R, 2 * R); c.restore();
    return null;
  }

  (typeof window !== "undefined" ? (window.__safisG ||= []) : []).push((g, util) => {
    // Draws a scene into the figure (or o.box); returns the view.
    g.iso = (scene, o = {}) => {
      const box = o.box || [0, 0, g.w, g.h], V = layout(scene, { ...o, box }), pal = livePal(), hlc = o.highlightColor || "brass";
      const dt = scene._time != null ? clamp(g.time - scene._time, 0, 0.1) : 1, still = reduced();
      scene._time = g.time;
      let anim = false;
      for (const r of V.recs) {
        const n = r.node, tg = n.pickable !== false && ((o.hover != null && r.names.includes(o.hover)) || (g.highlight != null && r.names.includes(g.highlight))) ? 1 : 0;
        n._hl = still ? tg : follow(n._hl ?? tg, tg, dt, 0.08);
        if (abs(n._hl - tg) < 0.01) n._hl = tg; else anim = true;
        r.hl = n._hl;
      }
      const ctx = g.ctx;
      ctx.save();
      if (o.box) { ctx.beginPath(); ctx.rect(...box); ctx.clip(); }
      ctx.lineCap = ctx.lineJoin = "round";
      paint(V, canvasPen(ctx, g, { mono: util.fontMono, text: util.fontText }, pal.dark ? { color: "rgb(0,0,0)", amb: 0.55, con: 0.75 } : { color: hex(pal.ink), amb: 0.1, con: 0.22 }),
        r => partColors(pal, r, hlc), name => (pal[name] ? hex(pal[name]) : name), o);
      ctx.restore();
      V.glow = (p, oo) => glow(g, V, p, oo);
      if (o.glow !== false) for (const r of V.recs) {
        const n = r.node;
        if ((n.material === "hot" || n.heat > 0) && (n.heat ?? 0) > 0.02) {
          const lo = r.G.lo, hi = r.G.hi, c = scl(add(lo, hi), 0.5), a = V.project(lo), b = V.project(hi);
          V.glow(c, { r: hypot(a[0] - b[0], a[1] - b[1]) * 0.16, intensity: n.heat * (pal.dark ? 0.6 : 0.85), temp: 900 + 800 * n.heat, spread: 22 });
        }
      }
      if (anim) g.wantsFrame = true;
      scene._view = V;
      return V;
    };
  });

  // ---------- SVG export ----------
  function themes() {
    const L = {}, D = {};
    if (typeof document !== "undefined") try {
      const grab = (st, to) => { for (const n of NAMES) { const v = st.getPropertyValue("--" + n).trim(); if (v && !v.startsWith("var(")) to[n] = v; } };
      const visit = rules => {
        for (const r of rules) {
          if (r.media) { if (!/dark/.test(r.media.mediaText) && r.cssRules) visit(r.cssRules); continue; }
          if (r.selectorText === ":root") grab(r.style, L);
          else if (/^:root\[data-theme=["']?dark["']?\]$/.test(r.selectorText || "")) grab(r.style, D);
        }
      };
      for (const s of document.styleSheets) visit(s.cssRules);
    } catch (e) { /* stylesheet unreadable: fall back to defaults */ }
    return { light: mkPal(L, DEF_L), dark: mkPal(D, DEF_D) };
  }
  function toSVG(scene, o = {}) {
    let V = scene._view;
    if (!V || o.view || o.width) {
      const keep = [scene._fit, scene._lay, scene._rank], w = o.width ?? V?.box[2] ?? 640, h = o.height ?? V?.box[3] ?? 400;
      V = layout(scene, { view: o.view ?? (V ? { yaw: V.cam.A, pitch: V.cam.E } : {}), box: [0, 0, w, h], zoom: o.zoom });
      [scene._fit, scene._lay, scene._rank] = keep;
    }
    const [bx, by, w, h] = V.box, th = themes(), vars = new Map();
    const reg = (l, d) => { const k = l + d; let v = vars.get(k); if (!v) vars.set(k, (v = { n: "i" + vars.size.toString(36), l, d })); return `var(--${v.n})`; };
    const hlc = o.highlightColor || "brass", out = [];
    const sh = { color: reg(hex(th.light.ink), "#000000"), amb: 0.1, con: 0.22 };
    const bg = reg(hex(th.light.panel), hex(th.dark.panel)), hatch = reg(hex(mixc(th.light.ink, th.light.panel, 0.45)), hex(mixc(th.dark.ink, th.dark.panel, 0.55)));
    const memo = new Map();
    paint(V, svgPen(out, sh), r => {
      let c = memo.get(r);
      if (!c) { const a = partColors(th.light, r, hlc), b = partColors(th.dark, r, hlc); c = a.map((x, i) => reg(x, b[i])); memo.set(r, c); }
      return c;
    }, name => (th.light[name] ? reg(hex(th.light[name]), hex(th.dark[name])) : name), o);
    const vl = [...vars.values()];
    const css = `svg{${vl.map(v => `--${v.n}:${v.l}`).join(";")}}@media (prefers-color-scheme:dark){svg{${vl.map(v => `--${v.n}:${v.d}`).join(";")}}}`;
    const defs = `<filter id="iso-b80" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter><filter id="iso-b25"><feGaussianBlur stdDeviation="2.5"/></filter>` +
      `<pattern id="iso-hatch" width="4.5" height="4.5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="4.5" stroke="${hatch}" stroke-width="0.75"/></pattern>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx} ${by} ${w} ${h}" width="${w}" height="${h}">${o.title ? `<title>${esc(o.title)}</title>` : ""}<style>${css}</style><defs>${defs}</defs>` +
      `${o.background !== false ? `<rect x="${bx}" y="${by}" width="${w}" height="${h}" fill="${bg}"/>` : ""}<g stroke-linecap="round" stroke-linejoin="round">${out.join("")}</g></svg>`;
  }
  function download(scene, name = "figure.svg", o = {}) {
    const svg = toSVG(scene, o);
    if (typeof document === "undefined" || navigator.webdriver || document.documentElement.classList.contains("safis-checking")) return svg;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return svg;
  }

  // ---------- audit: paint order against true depth where chunks overlap ----------
  function audit(scene, o = {}) {
    const V = o.view || scene._view || scene._lay;
    if (!V) return null;
    const C = V.chunks, n = o.samples ?? 5, tol = o.tol ?? 1e-4 * (hypot(V.hi[0] - V.lo[0], V.hi[1] - V.lo[1], V.hi[2] - V.lo[2]) || 1), conflicts = [];
    const depth = (ch, p) => {
      let best = null;
      for (const f of ch.faces) {
        const it = ch.r.items[f], F = ch.r.G.F[f];
        if (F.d || !it || !inPoly(ch.r.S, F.v, F.h, p)) continue;
        const d = planeDepth(V, it, p);
        if (d != null && (best == null || d > best)) best = d;
      }
      return best;
    };
    let pairs = 0;
    for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) {
      const A = C[i], B = C[j], x0 = max(A.sb[0], B.sb[0]), x1 = min(A.sb[2], B.sb[2]), y0 = max(A.sb[1], B.sb[1]), y1 = min(A.sb[3], B.sb[3]);
      if (x0 >= x1 || y0 >= y1) continue;
      pairs++;
      let bad = 0, at = null, worst = 0;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
        const p = [lerp(x0, x1, (a + 0.5) / n), lerp(y0, y1, (b + 0.5) / n)], da = depth(A, p), db = depth(B, p);
        if (da != null && db != null && da > db + tol) { bad++; if (da - db > worst) { worst = da - db; at = p; } }
      }
      if (bad) conflicts.push({ first: A.r.names.join("/") || "part", second: B.r.names.join("/") || "part", samples: bad, at, depth: worst });
    }
    return { pairs, conflicts, ok: !conflicts.length };
  }

  // ---------- motion helpers ----------
  const cdt = dt => clamp(dt || 0, 0, 0.1);
  // Exponential follow: moves a share 1 - e^(-dt/tau) of the way each step, at any frame rate.
  function follow(cur, target, dt, tau = 0.25) {
    if (reduced() || cur == null || !Number.isFinite(cur)) return target;
    return target + (cur - target) * exp(-cdt(dt) / max(1e-6, tau));
  }
  // Critically damped spring on { x, v }: settles on target without overshoot. Returns x.
  function spring(st, target, dt, tau = 0.25) {
    if (reduced() || !Number.isFinite(st.x)) { st.x = target; st.v = 0; return target; }
    const w = 1 / max(1e-6, tau), h = cdt(dt), c1 = st.x - target, c2 = (st.v || 0) + w * c1, e = exp(-w * h);
    st.x = target + (c1 + c2 * h) * e; st.v = (c2 - w * (c1 + c2 * h)) * e;
    return st.x;
  }
  // A one-off event: smoothstep rise over `rise` seconds, then exponential decay.
  function pulse(t, rise = 0.12, decay = 0.6) {
    if (t < 0) return 0;
    if (t < rise) { const u = t / rise; return u * u * (3 - 2 * u); }
    return reduced() ? 0 : exp(-(t - rise) / decay);
  }

  // ---------- interaction helpers for demo() ----------
  const matches = (hit, sp) => hit && [].concat(sp.part).some(n => hit.names.includes(n));
  // drag: { hit, start, move, end } that slides named parts along an axis within limits.
  function drag(scene, specs) {
    specs = [].concat(specs);
    let act = null;
    return {
      hit(p) { const V = scene._view, h = V && V.pick(p); return !!specs.find(sp => matches(h, sp)); },
      start(p, s, v) {
        const V = scene._view, h = V && V.pick(p), sp = h && specs.find(x => matches(h, x));
        act = sp ? { sp, p0: p, val: sp.key in v ? v[sp.key] : s[sp.key] } : null;
      },
      move(p, s, v, delta, fig) {
        const V = scene._view;
        if (!act || !V) return;
        const { sp, p0, val } = act, u = axv(sp.axis || "x"), c = V.cam, pu = [c.k * dot(u, c.R), c.k * dot(u, c.D)], l2 = pu[0] ** 2 + pu[1] ** 2;
        if (l2 < 1e-6) return;
        const t = ((p[0] - p0[0]) * pu[0] + (p[1] - p0[1]) * pu[1]) / l2, x = clamp(val + t / (sp.scale ?? 1), sp.min ?? -Infinity, sp.max ?? Infinity);
        if (sp.key in v && fig) fig.set(sp.key, x); else s[sp.key] = x;
      },
      end() { act = null; },
    };
  }
  // hover(p, s): the name under the pointer goes to s[key]; true when it changed.
  function hover(scene, o = {}) {
    const key = o.key || "hover";
    return (p, s) => {
      const V = scene._view, h = p && V ? V.pick(p) : null;
      let name = h ? (o.level === "group" ? h.names[0] : h.name) || null : null;
      if (o.only && !o.only.includes(name)) name = null;
      if (s[key] === name) return false;
      s[key] = name;
      return true;
    };
  }
  function helix(o = {}) {
    const r = o.r ?? 1, pitch = o.pitch ?? 0.3, turns = o.turns ?? 4, n = max(8, round((o.steps ?? 16) * turns)), F = frame(o.at, o.axis || "z"), pts = [];
    for (let i = 0; i <= n; i++) { const a = TAU * turns * i / n; pts.push(ap(F, [r * cos(a), r * sin(a), pitch * turns * i / n])); }
    return pts;
  }

  const Iso = {
    scene: (o = {}) => new Node({ ...o, name: o.name ?? "" }),
    layout, toSVG, download, audit, follow, spring, pulse, reduced, helix, fillet, frame, VIEWS,
    orbit: (o = {}) => ({ yaw: PI / 4, pitch: PI / 6, minPitch: -0.3, maxPitch: 1.45, ...o }),
    drag, hover, materials: Object.keys(MAT), Mesh, Node, version: 1,
  };
  if (typeof window !== "undefined") window.Iso = Iso;
})();
