/* E3.parts: parametric machine parts and assemblies for E3 figures.
   Everything is built in millimeters on E3's axes: y is up, and anything round
   turns about y (the way E3.mesh.lathe does). Parts come back as meshes or as
   group nodes with named children; assemblies add pose(), explode(), labels(),
   notes, and attachment points. It uses only E3's public API.
   Reference: references/parts3d.md in the skill. */
(() => {
  "use strict";
  const E3 = window.E3;
  if (!E3 || !E3.mesh || E3.parts) return;
  const { v3, m4, mesh } = E3;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mul = (...ms) => ms.reduce((a, b) => m4.multiply(a, b));
  const T = p => m4.translation(p);
  const RX = a => m4.rotationX(a), RY = a => m4.rotationY(a), RZ = a => m4.rotationZ(a);
  const SC = s => m4.scaling(typeof s === "number" ? [s, s, s] : s);
  const xf = (m, ...ms) => mesh.transform(m, mul(...ms));
  const merge = (...ms) => { const l = ms.flat(Infinity).filter(Boolean); return l.length ? mesh.merge(...l) : null; };
  // Cylindrical point in E3's lathe convention: angle a counterclockwise seen from +y.
  const cyl = (r, a, y) => [r * Math.cos(a), y, -r * Math.sin(a)];
  // Turns a part built along y so its axis runs along x or z.
  const ALONG = { x: RZ(-Math.PI / 2), y: m4.identity(), z: RX(Math.PI / 2) };

  // ---------- triangle soup ----------
  // Builders emit triangles; build() welds them with E3's crease rule. Closed solids are
  // flipped as a whole if they came out inside out, so callers only need consistent winding.
  class Soup {
    constructor() { this.p = []; }
    tri(a, b, c) {
      if (v3.dist(a, b) < 1e-7 || v3.dist(b, c) < 1e-7 || v3.dist(c, a) < 1e-7) return;
      this.p.push(a, b, c);
    }
    quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
    // A planar 2D polygon mapped into 3D by fn, wound so its normal points along dir.
    cap(poly, fn, dir, holes = []) {
      for (const t of E3.triangulate(poly, holes)) {
        const P = t.map(fn);
        const n = v3.cross(v3.sub(P[1], P[0]), v3.sub(P[2], P[0]));
        if (v3.dot(n, dir) >= 0) this.tri(P[0], P[1], P[2]); else this.tri(P[0], P[2], P[1]);
      }
    }
    build({ crease = 35, closed = true } = {}) {
      let p = this.p;
      if (closed) {
        let vol = 0;
        for (let i = 0; i < p.length; i += 3) vol += v3.dot(p[i], v3.cross(p[i + 1], p[i + 2]));
        if (vol < 0) { p = p.slice(); for (let i = 0; i < p.length; i += 3) { const t = p[i + 1]; p[i + 1] = p[i + 2]; p[i + 2] = t; } }
      }
      return mesh.custom(p, p.map((_, i) => i), { crease });
    }
  }

  // Turns a closed mesh inside out (the inner skin of a hollow casing).
  function flip(m) {
    const c = mesh.merge(m);
    for (let i = 0; i < c.normals.length; i++) c.normals[i] = -c.normals[i];
    for (let i = 0; i < c.indices.length; i += 3) { const t = c.indices[i + 1]; c.indices[i + 1] = c.indices[i + 2]; c.indices[i + 2] = t; }
    return c;
  }

  // ---------- 2D profiles ----------
  const area2 = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const circle2 = (r, n = 32, cx = 0, cy = 0, a0 = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(a0 + (i / n) * TAU), cy + r * Math.sin(a0 + (i / n) * TAU)]);
  const arc2 = (cx, cy, r, a0, a1, n = 8) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  function roundRect2(w, h, r = 0, n = 5, cx = 0, cy = 0) {
    r = Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6);
    if (r <= 0) return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
    const x = w / 2 - r, y = h / 2 - r;
    return [
      ...arc2(cx + x, cy - y, r, -Math.PI / 2, 0, n), ...arc2(cx + x, cy + y, r, 0, Math.PI / 2, n),
      ...arc2(cx - x, cy + y, r, Math.PI / 2, Math.PI, n), ...arc2(cx - x, cy - y, r, Math.PI, Math.PI * 1.5, n),
    ];
  }
  function hull2(pts) {
    const p = pts.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  // Rounds the corners of a polyline. Points are [x, y] or [x, y, r], r being that corner's fillet radius.
  function fillet(pts, { closed = false, steps = 6 } = {}) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const P = pts[i], r = P[2] || 0;
      if (!r || (!closed && (i === 0 || i === n - 1))) { out.push([P[0], P[1]]); continue; }
      const A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
      let ux = A[0] - P[0], uy = A[1] - P[1], wx = B[0] - P[0], wy = B[1] - P[1];
      const la = Math.hypot(ux, uy), lb = Math.hypot(wx, wy);
      ux /= la; uy /= la; wx /= lb; wy /= lb;
      const th = Math.acos(clamp(ux * wx + uy * wy, -1, 1));
      if (th < 1e-3 || th > Math.PI - 1e-3) { out.push([P[0], P[1]]); continue; }
      let t = r / Math.tan(th / 2), rr = r;
      const tmax = 0.5 * Math.min(la, lb);
      if (t > tmax) { t = tmax; rr = t * Math.tan(th / 2); }
      const bx = ux + wx, by = uy + wy, bl = Math.hypot(bx, by), d = rr / Math.sin(th / 2);
      const C = [P[0] + (bx / bl) * d, P[1] + (by / bl) * d];
      const a0 = Math.atan2(P[1] + uy * t - C[1], P[0] + ux * t - C[0]);
      let da = Math.atan2(P[1] + wy * t - C[1], P[0] + wx * t - C[0]) - a0;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      const k = Math.max(2, Math.ceil((steps * Math.abs(da)) / (Math.PI / 2)));
      for (let s = 0; s <= k; s++) { const a = a0 + (da * s) / k; out.push([C[0] + rr * Math.cos(a), C[1] + rr * Math.sin(a)]); }
    }
    return out;
  }
  // Offsets an open 2D polyline sideways by d (positive: to the left of travel).
  function offset2(pts, d) {
    const n = pts.length;
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      return [p[0] - (ty / l) * d, p[1] + (tx / l) * d];
    });
  }
  // Samples y(x) or r(y) style polylines at even arc length.
  function resample(pts, n) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = L[L.length - 1], out = [];
    let j = 0;
    for (let k = 0; k <= n; k++) {
      const s = (total * k) / n;
      while (j < pts.length - 2 && L[j + 1] < s) j++;
      const t = (s - L[j]) / (L[j + 1] - L[j] || 1);
      out.push([lerp(pts[j][0], pts[j + 1][0], t), lerp(pts[j][1], pts[j + 1][1], t)]);
    }
    return out;
  }

  // ---------- revolve ----------
  // Revolves a profile [[r, y], ...] about y. loop: the profile is a closed outline (a wall
  // with thickness). arc < 2π leaves a wedge open, with flat caps on the cut faces.
  function revolve(profile, { segments = 64, arc = TAU, start = 0, loop = false, crease = 35, caps = true } = {}) {
    let pr = profile.map(p => [Math.max(0, p[0]), p[1]]);
    const n = pr.length, poles = pr[0][0] < 1e-9 && pr[n - 1][0] < 1e-9;
    if ((loop || poles) && area2(pr) < 0) pr = pr.reverse();
    const full = arc >= TAU - 1e-6;
    const ang = j => start + (arc * j) / segments;
    const at = (i, j) => { const [r, y] = pr[i % n]; return cyl(r, ang(j), y); };
    const S = new Soup();
    const rows = loop ? n : n - 1;
    for (let i = 0; i < rows; i++) for (let j = 0; j < segments; j++) {
      const j1 = full ? (j + 1) % segments : j + 1;
      S.quad(at(i, j), at(i, j1), at(i + 1, j1), at(i + 1, j));
    }
    if (!full && caps && (loop || poles)) {
      for (const [a, sgn] of [[start, -1], [start + arc, 1]]) {
        const dir = v3.scale([-Math.sin(a), 0, -Math.cos(a)], sgn);
        S.cap(pr, ([r, y]) => cyl(r, a, y), dir);
      }
    }
    return S.build({ crease, closed: loop || poles });
  }
  // ---------- paths and tubes ----------
  function frames(path, closed = false) {
    const n = path.length, Tg = [], N = [], B = [];
    for (let i = 0; i < n; i++) {
      const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      Tg.push(v3.norm(v3.sub(b, a)));
    }
    let Nv = v3.norm(v3.cross(Tg[0], Math.abs(Tg[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    for (let i = 0; i < n; i++) {
      if (i) { Nv = v3.sub(Nv, v3.scale(Tg[i], v3.dot(Nv, Tg[i]))); Nv = v3.len(Nv) < 1e-9 ? N[i - 1] : v3.norm(Nv); }
      N.push(Nv);
      B.push(v3.cross(Tg[i], Nv));
    }
    return { T: Tg, N, B };
  }
  // A tube along a path: solid, or hollow when ri > 0 (pipes show a ring when cut).
  // ro may be a function of t in [0, 1].
  function tubeShell(path, ro, ri = 0, { segments = 20, crease = 60, closed = false } = {}) {
    const { T: Tg, N, B } = frames(path, closed), n = path.length;
    const rad = typeof ro === "function" ? ro : () => ro, irad = typeof ri === "function" ? ri : () => ri;
    const ring = (i, r) => Array.from({ length: segments }, (_, j) => {
      const a = (j / segments) * TAU;
      return v3.add(path[i], v3.add(v3.scale(N[i], r * Math.cos(a)), v3.scale(B[i], r * Math.sin(a))));
    });
    const O = path.map((_, i) => ring(i, rad(i / (n - 1))));
    const I = (typeof ri === "function" || ri > 0) ? path.map((_, i) => ring(i, irad(i / (n - 1)))) : null;
    const S = new Soup();
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % n;
      for (let j = 0; j < segments; j++) {
        const k = (j + 1) % segments;
        S.quad(O[i][j], O[i][k], O[i1][k], O[i1][j]);
        if (I) S.quad(I[i][j], I[i1][j], I[i1][k], I[i][k]);
      }
    }
    if (!closed) {
      for (const [i, start] of [[0, true], [n - 1, false]]) {
        for (let j = 0; j < segments; j++) {
          const k = (j + 1) % segments;
          if (I) { if (start) S.quad(O[i][j], I[i][j], I[i][k], O[i][k]); else S.quad(O[i][j], O[i][k], I[i][k], I[i][j]); }
          else if (start) S.tri(path[i], O[i][k], O[i][j]);
          else S.tri(path[i], O[i][j], O[i][k]);
        }
      }
    }
    return S.build({ crease, closed: true });
  }
  // Straight runs through the given points, joined by true circular bends of radius `bend`
  // (shrunk where a run is too short to fit it).
  function route(points, bend = 50) {
    const out = [points[0]], n = points.length;
    for (let i = 1; i < n - 1; i++) {
      const A = points[i - 1], P = points[i], Bq = points[i + 1];
      const d0 = v3.norm(v3.sub(P, A)), d1 = v3.norm(v3.sub(Bq, P));
      const cos = clamp(v3.dot(d0, d1), -1, 1), th = Math.acos(cos);
      if (th < 1e-3) { out.push(P); continue; }
      let R = typeof bend === "function" ? bend(i) : bend;
      const room = Math.min(v3.dist(A, P) * (i === 1 ? 0.95 : 0.5), v3.dist(P, Bq) * (i === n - 2 ? 0.95 : 0.5));
      let t = R * Math.tan(th / 2);
      if (t > room) { t = room; R = t / Math.tan(th / 2); }
      const S0 = v3.sub(P, v3.scale(d0, t)), nIn = v3.norm(v3.sub(d1, v3.scale(d0, cos))), C = v3.add(S0, v3.scale(nIn, R));
      const steps = Math.max(3, Math.ceil(th / (7 * DEG)));
      for (let s = 0; s <= steps; s++) {
        const f = (th * s) / steps;
        out.push(v3.add(C, v3.add(v3.scale(nIn, -R * Math.cos(f)), v3.scale(d0, R * Math.sin(f)))));
      }
    }
    out.push(points[n - 1]);
    return out;
  }
  const pathLength = p => p.reduce((s, q, i) => (i ? s + v3.dist(p[i - 1], q) : 0), 0);
  // Point and tangent at arc length s along a polyline.
  function along(path, s, closed = false) {
    const n = path.length, segs = closed ? n : n - 1;
    let total = 0;
    const L = [];
    for (let i = 0; i < segs; i++) { const l = v3.dist(path[i], path[(i + 1) % n]); L.push(l); total += l; }
    if (closed) s = ((s % total) + total) % total; else s = clamp(s, 0, total);
    for (let i = 0; i < segs; i++) {
      if (s <= L[i] || i === segs - 1) {
        const a = path[i], b = path[(i + 1) % n], t = L[i] ? clamp(s / L[i], 0, 1) : 0;
        return { at: v3.lerp(a, b, t), dir: v3.norm(v3.sub(b, a)) };
      }
      s -= L[i];
    }
    return { at: path[0], dir: [1, 0, 0] };
  }
  // Placement matrix: local origin at p, local +y along dir.
  const aim = (p, dir) => mul(T(p), m4.alignY(dir));

  // ---------- part nodes and assemblies ----------
  const MATERIALS = new Set(["porcelain", "ceramic", "steel", "brushed", "aluminum", "titanium", "copper", "brass", "inconel", "carbon", "rubber", "paint", "glass", "ghost", "hot", "graphite", "paper", "gold"]);
  // Picks a part's material: o.materials[role] wins, o.plain turns every metal to porcelain.
  function matFor(o, role, fallback) {
    const m = (o.materials && o.materials[role]) || fallback;
    if (o.plain && m !== "glass" && m !== "ghost" && !(o.materials && o.materials[role])) return "porcelain";
    return m;
  }
  const NODE_KEYS = new Set(["name", "position", "rotation", "scale", "pivot", "matrix", "material", "color", "opacity", "visible", "cut", "highlight", "pickable"]);
  function nodeOpts(o) { const r = {}; for (const k in o) if (NODE_KEYS.has(k)) r[k] = o[k]; return r; }
  // A group node for a multi-part part (a flange with its bolts, a bearing).
  function group(name, kids = []) {
    const g = E3.node(null, { name });
    for (const [m, o] of kids) if (m) g.add(m, nodeOpts(o));
    return g;
  }

  // An assembly: a group node that knows its named parts, how they come apart, where
  // their labels go, and how its moving parts are driven.
  function assembly(name, o = {}) {
    const root = E3.node(null, { name });
    const parts = {}, notes = {}, labels = [], exploding = [];
    let ex = 0;
    root.parts = parts;
    root.notes = notes;
    root.info = {};
    root.ports = {};
    // Adds a part. opts: node options plus explode [x, y, z] (offset at explode 1, in the
    // parent's frame), label (text, or { text, at } with at in the part's own frame),
    // note (one line for readouts), parent (a node in this assembly).
    root.part = (nameOrMesh, m, opts = {}) => {
      if (typeof nameOrMesh !== "string") { opts = m || {}; m = nameOrMesh; nameOrMesh = opts.name || ""; }
      const parent = opts.parent || root;
      const node = parent.add(m, { ...nodeOpts(opts), name: nameOrMesh });
      if (nameOrMesh && !parts[nameOrMesh]) parts[nameOrMesh] = node;
      if (opts.note && nameOrMesh) notes[nameOrMesh] = opts.note;
      if (opts.explode) { node._ex = opts.explode; node._home = (opts.position || [0, 0, 0]).slice(); exploding.push(node); }
      if (opts.label) {
        const L = typeof opts.label === "string" ? { text: opts.label } : opts.label;
        labels.push({ node, text: L.text, at: L.at || null, color: L.color });
      }
      return node;
    };
    const nodeGroup = root.group.bind(root);
    root.group = (gname, opts = {}) => (typeof gname === "string" ? root.part(gname, null, opts) : nodeGroup(gname));
    // Moves a part's resting place (for parts the pose drives), keeping the explode offset.
    root.home = (node, p) => { node._home = p.slice(); if (!node._ex) node.position = p.slice(); else node.position = v3.add(p, v3.scale(node._ex, ex)); };
    root.homeMatrix = (node, M) => { node._m0 = M; node.matrix = node._ex ? mul(T(v3.scale(node._ex, ex)), M) : M; };
    root.explode = (t = 0) => {
      ex = t;
      for (const n of exploding) {
        const off = v3.scale(n._ex, t);
        if (n._m0) n.matrix = mul(T(off), n._m0);
        else n.position = v3.add(n._home, off);
      }
      return root;
    };
    Object.defineProperty(root, "exploded", { get: () => ex });
    // Label anchors in world coordinates: [{ text, at, color, node }]. Hidden parts are skipped.
    root.labels = () => {
      const out = [];
      for (const L of labels) {
        let vis = true;
        for (let n = L.node; n; n = n.parent) if (!n.visible) { vis = false; break; }
        if (!vis) continue;
        let at = L.at;
        if (!at) {
          const b = L.node.mesh ? L.node.mesh.bounds : null;
          at = b ? b.center : [0, 0, 0];
        }
        out.push({ text: L.text, at: L.node.toWorld(at), color: L.color, node: L.node });
      }
      return out;
    };
    // A port is a circular opening: { center, normal, radius } in world coordinates.
    // root.portLocal(name) gives the same port in the assembly's own frame (for building on it).
    const portData = {};
    const rel = node => { let Mx = m4.identity(); for (let n = node; n && n !== root; n = n.parent) Mx = mul(n.local(), Mx); return Mx; };
    root.portLocal = pname => {
      const d = portData[pname], Mx = rel(d.node);
      return { center: m4.apply(Mx, d.center), normal: v3.norm(m4.applyDir(Mx, d.normal)), radius: d.radius, ...d.extra };
    };
    root.port = (pname, node, center, normal, radius, extra = {}) => {
      portData[pname] = { node, center, normal, radius, extra };
      Object.defineProperty(root.ports, pname, {
        enumerable: true,
        get() {
          const W = node.world();
          return { center: m4.apply(W, center), normal: v3.norm(m4.applyDir(W, normal)), radius: radius * Math.hypot(W[0], W[1], W[2]), ...extra };
        },
      });
      if (!(pname in root)) Object.defineProperty(root, pname, { get: () => root.ports[pname] });
    };
    root.pose = state => { if (root.onPose) root.onPose(state || {}); return root; };
    return root;
  }
  // Highlights the parts named in `names` (or matching a predicate); handy with hover and g.lit.
  function highlight(root, test) {
    const f = typeof test === "function" ? test : n => n && (Array.isArray(test) ? test.includes(n) : n === test);
    root.traverse(n => { if (n !== root) n.highlight = !!f(n.name, n); });
  }

  // ---------- fasteners ----------
  const hexagon = (s, a0 = Math.PI / 6) => circle2(s / Math.sqrt(3), 6, 0, 0, a0);
  // A plate outline (xy, with holes) extruded to thickness t, lying flat: y from y0 to y0 + t.
  function plate(outline, t, { holes = [], bevel = 0, y0 = 0, bevelSegments = 2 } = {}) {
    return xf(mesh.extrude(outline, t, { holes, bevel, bevelSegments }), T([0, y0 + t / 2, 0]), RX(-Math.PI / 2));
  }
  // Hex bolt: the head's bearing face sits at y = 0, head up, shank down to y = -length.
  function bolt(o = {}) {
    const d = o.d ?? o.diameter ?? 10, L = o.length ?? 4 * d, s = o.across ?? 1.6 * d, k = o.head ?? 0.65 * d;
    const seg = o.segments ?? 18;
    const head = plate(hexagon(s), k, { bevel: 0.1 * d, bevelSegments: o.lite ? 1 : 2 });
    const r = d / 2, prof = [[0, 0.3 * k], [r, 0.3 * k]];
    const thread = o.thread ?? true, tl = Math.min(L - 0.5 * d, o.threadLength ?? Math.max(2 * d, L * 0.6));
    const p = o.pitch ?? 0.15 * d;
    if (thread && L > 2 * d) {
      prof.push([r, -(L - tl)]);
      for (let y = -(L - tl); y > -L + 1.5 * p; y -= p) prof.push([r * 0.9, y - p * 0.5], [r, y - p]);
    }
    prof.push([r, -L + 0.12 * d], [r - 0.12 * d, -L], [0, -L]);
    return merge(head, revolve(prof, { segments: seg }));
  }
  // Hex nut sitting on y = 0, up to its height.
  function nut(o = {}) {
    const d = o.d ?? o.diameter ?? 10, s = o.across ?? 1.6 * d, m = o.height ?? 0.8 * d;
    return plate(hexagon(s), m, { holes: [circle2(d * 0.5, o.lite ? 8 : 16)], bevel: 0.1 * d, bevelSegments: o.lite ? 1 : 2 });
  }
  function washer(o = {}) {
    const d = o.d ?? o.diameter ?? 10, t = o.thickness ?? 0.18 * d;
    return revolve([[0.54 * d, 0], [d, 0], [d, t], [0.54 * d, t]], { loop: true, segments: o.segments ?? 24 });
  }
  // n bolts on a circle in the xz plane at height y (heads up), with nuts `grip` below.
  function boltCircle(n, radius, o = {}) {
    const d = o.d ?? 8, grip = o.grip ?? 2 * d, a0 = o.start ?? Math.PI / n;
    const b = bolt({ d, length: o.length ?? grip + d * 1.3, thread: o.thread ?? false, segments: o.segments ?? 10, lite: true });
    const nt = o.nuts === false ? null : xf(nut({ d, lite: true }), T([0, -grip - 0.8 * d, 0]));
    const one = merge(b, nt);
    const out = [];
    for (let i = 0; i < n; i++) { const a = a0 + (i / n) * TAU; out.push(xf(one, T(cyl(radius, a, o.y ?? 0)), RY(a))); }
    return merge(out);
  }

  // ---------- flange ----------
  // Weld-neck flange on a pipe of outer radius `pipe`. The mating face is at y = 0 and
  // the flange runs down the pipe (toward -y). Proportions follow ASME B16.5 class 150.
  function flange(o = {}) {
    const rp = o.pipe ?? o.radius ?? 30, ri = o.bore ?? rp * 0.88;
    const R = o.outer ?? Math.max(rp * 2, rp + 30), t = o.thickness ?? Math.max(6, rp * 0.42);
    const n = o.bolts ?? (rp > 120 ? 16 : rp > 70 ? 12 : 8), rb = o.boltCircle ?? (R + Math.max(rp * 1.15, rp + 6)) / 2;
    const hr = o.hole ?? Math.max(2.5, Math.min((R - rp) * 0.17, (Math.PI * rb) / n * 0.32));
    const holes = [circle2(ri, 32)];
    for (let i = 0; i < n; i++) { const a = Math.PI / n + (i / n) * TAU; holes.push(circle2(hr, 10, rb * Math.cos(a), rb * Math.sin(a))); }
    const body = xf(mesh.extrude(circle2(R, 48), t, { holes, bevel: t * 0.12, bevelSegments: 1 }), T([0, -t / 2, 0]), RX(-Math.PI / 2));
    const neckL = o.neck ?? t * 1.6, rh = Math.max(rp * 1.18, rp + 4);
    const neck = revolve(fillet([[ri, -t + 0.5], [rh, -t + 0.5], [rh, -t - neckL * 0.15, rh * 0.06], [rp, -t - neckL], [ri, -t - neckL]], { steps: 2 }), { loop: true, segments: 32 });
    const face = revolve([[ri, -0.3], [rp * 1.45, -0.3], [rp * 1.45, t * 0.06], [ri, t * 0.06]], { loop: true, segments: 32 });
    const m = merge(body, neck, face);
    m.flange = { radius: R, thickness: t, bolts: n, boltCircle: rb, hole: hr, bore: ri };
    return m;
  }

  // ---------- pipe ----------
  // A pipe through 3D points with true bends, hollow, with a flange and bolts at each end.
  // Returns a group: pipe, flanges, bolts. group.path is the centerline; group.ends the ends.
  function pipe(points, o = {}) {
    const r = o.radius ?? 25, w = o.wall ?? Math.max(1.2, r * 0.12), bend = o.bend ?? r * 3;
    const path = route(points, bend);
    const g = group(o.name ?? "pipe");
    g.add(tubeShell(path, r, r - w, { segments: o.segments ?? 24 }), { name: o.name ?? "pipe", material: o.material ?? "brushed" });
    const n = path.length;
    const ends = [
      { at: path[0], dir: v3.norm(v3.sub(path[0], path[1])) },
      { at: path[n - 1], dir: v3.norm(v3.sub(path[n - 1], path[n - 2])) },
    ];
    const which = o.flanges === false ? [] : o.flanges === "start" ? [0] : o.flanges === "end" ? [1] : [0, 1];
    const fl = [], bl = [];
    for (const e of which) {
      const f = flange({ pipe: r, bore: r - w, ...(o.flange || {}) });
      const M = aim(ends[e].at, ends[e].dir);
      fl.push(mesh.transform(f, M));
      if (o.bolts !== false) {
        const info = f.flange, d = Math.max(3, info.hole * 1.6);
        bl.push(mesh.transform(boltCircle(info.bolts, info.boltCircle, { d, grip: info.thickness * 2, y: info.thickness }), mul(M, RX(Math.PI))));
      }
    }
    if (fl.length) g.add(merge(fl), { name: `${o.name ?? "pipe"} flange`, material: o.flangeMaterial ?? "steel" });
    if (bl.length) g.add(merge(bl), { name: `${o.name ?? "pipe"} bolts`, material: o.boltMaterial ?? "steel" });
    g.path = path;
    g.ends = ends;
    g.length = pathLength(path);
    return g;
  }

  // ---------- small parts ----------
  // L bracket: base plate on y = 0 along +x, upright plate at x = 0, inner fillet, gusset, holes.
  function bracket(o = {}) {
    const w = o.width ?? 60, h = o.height ?? 70, l = o.depth ?? 70, t = o.thickness ?? 6, hr = o.hole ?? Math.max(2.5, w * 0.07);
    const rr = Math.min(w, l) * 0.12;
    const base = xf(mesh.extrude(roundRect2(l, w, rr, 4, l / 2, 0), t, { holes: [circle2(hr, 16, l * 0.68, w * 0.27), circle2(hr, 16, l * 0.68, -w * 0.27)], bevel: t * 0.15 }), T([0, t / 2, 0]), RX(-Math.PI / 2));
    const up = xf(mesh.extrude(roundRect2(w, h, rr, 4, 0, h / 2), t, { holes: [circle2(hr, 16, w * 0.27, h * 0.68), circle2(hr, 16, -w * 0.27, h * 0.68)], bevel: t * 0.15 }), T([t / 2, 0, 0]), RY(Math.PI / 2));
    const rf = t * 1.2;
    const fil = mesh.extrude([[t - 0.3, t - 0.3], [t + rf, t - 0.3], ...arc2(t + rf, t + rf, rf, -Math.PI / 2, -Math.PI, 6).slice(1, -1), [t - 0.3, t + rf]], w * 0.98);
    const parts = [base, up, fil];
    if (o.gusset !== false) parts.push(mesh.extrude([[t - 0.3, t - 0.3], [l * 0.62, t - 0.3], [t - 0.3, h * 0.62]], t * 0.8, { bevel: t * 0.12 }));
    return merge(parts);
  }

  // Ball bearing on y = 0..width: inner ring, outer ring, balls, cage (a group).
  function bearing(o = {}) {
    const ri = o.bore ?? 20, ro = o.outer ?? ri * 1.9, w = o.width ?? (ro - ri) * 0.75;
    const rp = (ri + ro) / 2, rb = o.ball ?? Math.min((ro - ri) * 0.28, w * 0.42), n = o.balls ?? Math.max(7, Math.floor((TAU * rp) / (rb * 2.7)));
    const c = Math.min(w, ro - ri) * 0.07, rho = rb * 1.04, sh = rb * 0.62;
    const dy = Math.sqrt(rho * rho - sh * sh), al = Math.atan2(dy, sh);
    const rIn = rp - sh, rOut = rp + sh;
    const innerP = fillet([[ri, 0, c], [rIn, 0, c * 0.6], [rIn, w / 2 - dy], ...arc2(rp, w / 2, rho, Math.PI + al, Math.PI - al, 10).slice(1, -1), [rIn, w / 2 + dy], [rIn, w, c * 0.6], [ri, w, c]], { closed: true, steps: 3 });
    const outerP = fillet([[rOut, 0, c * 0.6], [ro, 0, c], [ro, w, c], [rOut, w, c * 0.6], [rOut, w / 2 + dy], ...arc2(rp, w / 2, rho, al, -al, 10).slice(1, -1), [rOut, w / 2 - dy]], { closed: true, steps: 3 });
    const ball = mesh.sphere(rb, { segments: o.ballSegments ?? 8 });
    const balls = merge(Array.from({ length: n }, (_, i) => xf(ball, T(cyl(rp, (i / n) * TAU, w / 2)))));
    const cw = rb * 0.22;
    const cage = revolve([[rp - cw, w / 2 - rb * 1.02], [rp + cw, w / 2 - rb * 1.02], [rp + cw, w / 2 - rb * 0.8], [rp - cw, w / 2 - rb * 0.8]], { loop: true, segments: 48 });
    const g = group(o.name ?? "bearing", [
      [revolve(outerP, { loop: true, segments: o.segments ?? 64 }), { name: "outer ring", material: o.material ?? "steel" }],
      [revolve(innerP, { loop: true, segments: o.segments ?? 64 }), { name: "inner ring", material: o.material ?? "steel" }],
      [balls, { name: "balls", material: o.material ?? "steel" }],
      [cage, { name: "cage", material: "brass" }],
    ]);
    g.info = { bore: ri, outer: ro, width: w, balls: n, ball: rb, pitch: rp };
    return g;
  }

  // Stepped shaft along y from y = 0: steps [[length, diameter], ...], chamfered ends,
  // filleted shoulders, optional bore (hollow shafts nest inside each other).
  function shaft(o = {}) {
    const steps = o.steps ?? [[40, 30], [120, 40], [30, 50], [80, 40]];
    const bore = (o.bore ?? 0) / 2, fr = o.fillet ?? 1.5;
    const ch = o.chamfer ?? Math.min(1.5, steps[0][1] * 0.04);
    const r0 = steps[0][1] / 2, pts = [[bore, 0], [r0 - ch, 0], [r0, ch]];
    let y = 0;
    steps.forEach(([len, dia], i) => {
      const r = dia / 2;
      y += len;
      const next = steps[i + 1];
      if (!next) { pts.push([r, y - ch], [r - ch, y], [bore, y]); return; }
      const rn = next[1] / 2;
      if (rn > r + 1e-6) pts.push([r, y, fr], [rn - ch, y], [rn, y + ch]);
      else if (rn < r - 1e-6) pts.push([r, y - ch], [r - ch, y], [rn, y, fr]);
    });
    const m = revolve(fillet(pts, { steps: 3 }), { loop: bore > 0, segments: o.segments ?? 40 });
    m.shaft = { length: y };
    return m;
  }

  // Helical compression spring along y from 0 to length, with closed ends.
  function spring(o = {}) {
    const R = o.radius ?? 15, w = o.wire ?? R * 0.16, L = o.length ?? 60, coils = o.coils ?? 7, closed = o.closedEnds ?? true;
    const pts = [], steps = Math.round(coils * 28);
    const endTurn = closed ? 0.9 : 0, active = coils - 2 * endTurn;
    const free = L - w * (closed ? 2 * endTurn + 1 : 1);
    for (let i = 0; i <= steps; i++) {
      const c = (i / steps) * coils;
      let y;
      if (c < endTurn) y = w / 2 + c * w;
      else if (c > coils - endTurn) y = L - w / 2 - (coils - c) * w;
      else y = w / 2 + endTurn * w + ((c - endTurn) / active) * free;
      pts.push(cyl(R, c * TAU, y));
    }
    return tubeShell(pts, w / 2, 0, { segments: 10, crease: 70 });
  }

  // E3's spur gear (axis y, centered on y = 0), with an optional raised hub.
  function gear(o = {}) {
    const g = mesh.gear(o);
    if (!o.hubRadius) return g;
    const t = o.thickness ?? 2, hl = o.hubLength ?? t * 1.6, bore = o.hole ?? 0;
    const hub = revolve([[bore, -hl / 2], [o.hubRadius, -hl / 2], [o.hubRadius, hl / 2], [bore, hl / 2]], { loop: bore > 0, segments: 40 });
    return merge(g, hub);
  }

  // A strut between two points with rod-end fittings (frames, trusses, links).
  function strut(a, b, o = {}) {
    const r = o.radius ?? 8, L = v3.dist(a, b), e = o.end ?? r * 1.7;
    const body = revolve(fillet([[0, e * 0.8], [r * 0.8, e * 0.8], [r, e * 1.5, r * 0.5], [r, L - e * 1.5, r * 0.5], [r * 0.8, L - e * 0.8], [0, L - e * 0.8]], { steps: 2 }), { segments: 12 });
    const eye = xf(mesh.torus(e * 0.62, e * 0.36, { segments: 14, tube: 6 }), RX(Math.PI / 2));
    return mesh.transform(merge(body, eye, xf(eye, T([0, L, 0]))), aim(a, v3.sub(b, a)));
  }

  // Housing: a hollow rounded box (outer skin and an inner skin), for gearboxes and covers.
  function housing(o = {}) {
    const w = o.width ?? 200, h = o.height ?? 150, d = o.depth ?? 120, t = o.wall ?? 8, r = o.round ?? t * 1.5;
    const outer = mesh.box(w, h, d, { round: r, segments: 3 });
    if (o.solid) return outer;
    const inner = flip(mesh.box(w - 2 * t, h - 2 * t, d - 2 * t, { round: Math.max(0, r - t), segments: 2 }));
    return merge(outer, inner);
  }

  // Coil spring, bellows, and cable bundle helpers ----------
  // Cable harness: a bundle of wires along a smooth path, with ties and end connectors.
  function harness(points, o = {}) {
    const wires = o.wires ?? 7, wr = o.wire ?? 2, ties = o.ties ?? 6;
    const path = E3.smooth(points, { steps: o.steps ?? 10 });
    const { T: Tg, N, B } = frames(path);
    const L = pathLength(path);
    const slots = [[0, 0]];
    for (let k = 0; slots.length < wires; k++) { const ring = 1 + Math.floor(k / 6), a = ((k % 6) / 6) * TAU + ring * 0.3; slots.push([ring * 2.05 * wr, a]); }
    const lay = o.lay ?? 1 / 120;
    let s = 0;
    const S = [0];
    for (let i = 1; i < path.length; i++) S.push((s += v3.dist(path[i - 1], path[i])));
    const wireMeshes = slots.map(([rr, a]) => tubeShell(path.map((p, i) => {
      const ang = a + S[i] * lay * TAU;
      return v3.add(p, v3.add(v3.scale(N[i], rr * Math.cos(ang)), v3.scale(B[i], rr * Math.sin(ang))));
    }), wr, 0, { segments: 8 }));
    const R = (slots.length > 1 ? slots[slots.length - 1][0] : 0) + wr;
    const tieRing = revolve([[R + 0.2, -wr * 0.7], [R + wr * 0.7, -wr * 0.7], [R + wr * 0.7, wr * 0.7], [R + 0.2, wr * 0.7]], { loop: true, segments: 16 });
    const tieM = [];
    for (let k = 1; k <= ties; k++) {
      const { at, dir } = along(path, (L * k) / (ties + 1));
      tieM.push(mesh.transform(tieRing, aim(at, dir)));
    }
    const conn = revolve(fillet([[0, -R * 2.6], [R * 1.5, -R * 2.6], [R * 1.5, -R * 1.2, 0.5], [R * 1.9, -R * 1.2, 0.5], [R * 1.9, 0, 0.5], [R * 1.2, R * 1.4, R * 0.4], [R * 1.05, R * 2.8], [0, R * 2.8]]), { segments: 24 });
    const ends = [
      mesh.transform(conn, aim(path[0], v3.scale(Tg[0], 1))),
      mesh.transform(conn, aim(path[path.length - 1], v3.scale(Tg[path.length - 1], -1))),
    ];
    const g = group(o.name ?? "harness", [
      [merge(wireMeshes), { name: "wires", material: o.material ?? "rubber" }],
      [ties ? merge(tieM) : null, { name: "ties", material: "graphite" }],
      [o.connectors === false ? null : merge(ends), { name: "connectors", material: "brushed" }],
    ]);
    g.path = path;
    return g;
  }

  // ---------- rocket parts ----------
  // Rao's thrust-optimized bell: initial and exit wall angles from his charts for an 80% bell.
  const RAO = { eps: [4, 5, 10, 20, 30, 40, 50, 100], tn: [21.5, 23, 26.3, 28.8, 30, 31, 31.5, 33.5], te: [14, 13, 11, 9, 8.5, 8, 7.5, 7] };
  function raoAngles(eps) {
    const L = Math.log(clamp(eps, 4, 100)), xs = RAO.eps.map(Math.log);
    let i = 0;
    while (i < xs.length - 2 && L > xs[i + 1]) i++;
    const t = (L - xs[i]) / (xs[i + 1] - xs[i]);
    return { thetaN: lerp(RAO.tn[i], RAO.tn[i + 1], t), thetaE: lerp(RAO.te[i], RAO.te[i + 1], t) };
  }
  // Gas-side contour of a bell from the throat (y = 0) down to the exit (y = -length):
  // a 0.382 Rt arc out of the throat, then a parabola (quadratic Bezier) to the exit lip.
  function bellContour(o = {}) {
    const Rt = o.throat ?? 100, eps = o.expansion ?? 16, f = o.lengthFraction ?? 0.8;
    const Re = Math.sqrt(eps) * Rt, R1 = 0.382 * Rt, ang = raoAngles(eps);
    const tn = (o.thetaN ?? ang.thetaN) * DEG, te = (o.thetaE ?? ang.thetaE) * DEG;
    const Ln = (f * (Re - Rt + R1 * (1 / Math.cos(15 * DEG) - 1))) / Math.tan(15 * DEG);
    const pts = [], na = o.arcSteps ?? 8, nb = o.steps ?? 40;
    for (let k = 0; k <= na; k++) { const a = (tn * k) / na; pts.push([R1 * Math.sin(a), Rt + R1 * (1 - Math.cos(a))]); }
    const N = pts[pts.length - 1], E = [Ln, Re], m1 = Math.tan(tn), m2 = Math.tan(te);
    const c1 = N[1] - m1 * N[0], c2 = E[1] - m2 * E[0];
    const Q = [(c2 - c1) / (m1 - m2), (m1 * c2 - m2 * c1) / (m1 - m2)];
    for (let k = 1; k <= nb; k++) {
      const t = k / nb, u = 1 - t;
      pts.push([u * u * N[0] + 2 * u * t * Q[0] + t * t * E[0], u * u * N[1] + 2 * u * t * Q[1] + t * t * E[1]]);
    }
    const points = pts.map(([x, r]) => [r, -x]);
    // Radius at height y (y from 0 down to -length).
    const radiusAt = y => {
      if (y >= 0) return Rt;
      for (let i = 1; i < points.length; i++) if (points[i][1] <= y) { const a = points[i - 1], b = points[i]; return lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1])); }
      return Re;
    };
    return { points, radiusAt, throat: Rt, exit: Re, length: Ln, thetaN: tn / DEG, thetaE: te / DEG, expansion: eps };
  }
  // A ring hugging a revolved surface: inner side follows rAt(y) from y0 to y1, `h` proud of it.
  function collar(rAt, y0, y1, h, { segments = 96, round = 0.3, embed = 0.6, steps = 4 } = {}) {
    const n = Math.max(2, steps), lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    const inner = Array.from({ length: n + 1 }, (_, i) => { const y = lerp(lo, hi, i / n); return [rAt(y) - embed, y]; });
    const top = Math.max(...inner.map(p => p[0])) + embed + h, rr = Math.min(h, hi - lo) * round;
    const prof = fillet([...inner, [top, hi, rr], [top, lo, rr]], { closed: true, steps: 3 });
    return revolve(prof, { loop: true, segments });
  }

  // Bell nozzle with an optional regeneratively cooled tube wall, an inlet manifold where
  // the tubes end, hat-band stiffeners, and an exit lip. Throat at y = 0, exit at y = -length.
  // Returns a group (wall, tubes, manifold, stiffeners, lip) with .contour and .exit.
  function bellNozzle(o = {}) {
    const C = bellContour(o), Rt = C.throat, t = o.wall ?? Math.max(1.5, Rt * 0.05), seg = o.segments ?? 96;
    const inner = C.points;
    const outer = inner.map(([r, y]) => [r + t * (1 + 0.6 * clamp(1 + y / C.length, 0, 1)), y]);
    const rOut = y => { const r = C.radiusAt(y); return r + t * (1 + 0.6 * clamp(1 + y / C.length, 0, 1)); };
    const wallM = revolve([...inner, ...outer.reverse()], { loop: true, segments: o.wallSegments ?? 80 });
    const g = group(o.name ?? "nozzle", [[wallM, { name: "nozzle wall", material: o.material ?? "inconel" }]]);
    const tubes = o.tubes ?? { count: 96, from: 0.05, to: 0.55 };
    let manifoldY = null;
    if (tubes) {
      const N = tubes.count ?? 96, k = 4, cols = N * k, rows = tubes.rows ?? 28;
      const y0 = -C.length * (tubes.from ?? 0.05), y1 = -C.length * (tubes.to ?? 0.55);
      const S = new Soup(), O = [], I = [];
      for (let i = 0; i <= rows; i++) {
        const y = lerp(y0, y1, i / rows), base = rOut(y), rt = (Math.PI * base) / N;
        const ring = [], iring = [];
        for (let j = 0; j < cols; j++) {
          const u = (j % k) / k, h = Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
          ring.push(cyl(base + rt * (0.12 + 0.88 * h), (j / cols) * TAU, y));
        }
        for (let j = 0; j < N; j++) iring.push(cyl(base - 0.4, (j / N) * TAU, y));
        O.push(ring); I.push(iring);
      }
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) { const j1 = (j + 1) % cols; S.quad(O[i][j], O[i][j1], O[i + 1][j1], O[i + 1][j]); }
        for (let j = 0; j < N; j++) { const j1 = (j + 1) % N; S.quad(I[i][j], I[i + 1][j], I[i + 1][j1], I[i][j1]); }
      }
      // End rings: zip the corrugated outer ring to the coarse inner ring.
      for (const [i, sg] of [[0, 1], [rows, -1]]) {
        for (let j = 0; j < N; j++) {
          const j1 = (j + 1) % N;
          for (let q = 0; q < k; q++) {
            const a = O[i][j * k + q], b = O[i][(j * k + q + 1) % cols];
            if (sg > 0) S.tri(I[i][j], b, a); else S.tri(I[i][j], a, b);
          }
          if (sg > 0) S.tri(I[i][j], I[i][j1], O[i][(j1 * k) % cols]); else S.tri(I[i][j], O[i][(j1 * k) % cols], I[i][j1]);
        }
      }
      g.add(S.build({ crease: 50 }), { name: "regen tubes", material: o.tubeMaterial ?? o.material ?? "inconel" });
      manifoldY = y1;
      const mh = Rt * 0.16;
      const man = collar(y => rOut(y) + (Math.PI * rOut(y)) / N, y1 + mh * 0.2, y1 - mh * 1.4, mh, { segments: seg });
      const top = collar(rOut, y0 + Rt * 0.12, y0 - Rt * 0.02, Rt * 0.08, { segments: seg });
      g.add(merge(man, top), { name: "manifold", material: o.manifoldMaterial ?? "steel" });
    }
    const bands = o.stiffeners ?? 2, below = manifoldY ?? -C.length * 0.3, sm = [];
    for (let b = 1; b <= bands; b++) {
      const y = lerp(below, -C.length, b / (bands + 1));
      sm.push(collar(rOut, y + Rt * 0.035, y - Rt * 0.035, Rt * 0.05, { segments: seg }));
    }
    sm.push(collar(rOut, -C.length + Rt * 0.09, -C.length, Rt * 0.06, { segments: seg, embed: 0.3 }));
    g.add(merge(sm), { name: "stiffeners", material: o.material ?? "inconel" });
    g.contour = C;
    g.outerRadiusAt = rOut;
    g.manifoldY = manifoldY;
    g.exit = { center: [0, -C.length, 0], normal: [0, -1, 0], radius: C.exit };
    return g;
  }

  // Combustion chamber from the injector face (top) to the throat (y = 0): cylinder, a
  // 1.5 Rt arc into the throat, a straight convergence, and a bolted flange on top.
  // Chamber length follows L* (characteristic length, mm) when no cylinder length is given.
  function combustionChamber(o = {}) {
    const Rt = o.throat ?? 100, cr = o.contraction ?? 3, Rc = Rt * Math.sqrt(cr), th = (o.convergence ?? 30) * DEG;
    const tw = o.wall ?? Rt * 0.11, Lstar = o.lstar ?? 1000;
    const pts = [];
    for (let k = 0; k <= 8; k++) { const f = (th * k) / 8; pts.push([Rt + 1.5 * Rt * (1 - Math.cos(f)), 1.5 * Rt * Math.sin(f)]); }
    const e = pts[pts.length - 1], yK = e[1] + (Rc - e[0]) / Math.tan(th);
    const At = Math.PI * Rt * Rt, Ac = Math.PI * Rc * Rc, hc = (Rc - Rt) / Math.tan(th);
    const Vconv = (Math.PI / 3) * hc * (Rc * Rc + Rc * Rt + Rt * Rt);
    const Lcyl = o.cylinder ?? Math.max(0.4 * Rc, (Lstar * At - Vconv) / Ac);
    const top = yK + Lcyl;
    const inner = fillet([...pts, [Rc, yK, Rc * 0.7], [Rc, top]], { steps: 8 });
    const outer = inner.map(([r, y]) => [r + tw, y]);
    const fw = o.flangeWidth ?? Rc * 0.32, fh = o.flangeHeight ?? Rt * 0.22;
    const prof = fillet([...inner, [Rc + tw + fw, top, 1.5], [Rc + tw + fw, top - fh, 1.5], [Rc + tw, top - fh * 2.2, fh * 0.6], ...outer.slice(0, -1).reverse().filter(p => p[1] < top - fh * 2.2)], { closed: true, steps: 4 });
    const g = group(o.name ?? "combustion chamber", [[revolve(prof, { loop: true, segments: o.segments ?? 96 }), { name: "chamber", material: o.material ?? "inconel" }]]);
    const nb = o.bolts ?? 24, d = Math.max(4, fh * 0.45);
    g.add(boltCircle(nb, Rc + tw + fw * 0.55, { d, y: top, grip: fh * 2, nuts: false }), { name: "chamber bolts", material: "steel" });
    g.info = { throat: Rt, chamberRadius: Rc, top, cylinder: Lcyl, flangeRadius: Rc + tw + fw, flangeHeight: fh, wall: tw };
    g.radiusAt = y => { for (let i = 1; i < inner.length; i++) if (inner[i][1] >= y) { const a = inner[i - 1], b = inner[i]; return lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1] || 1)) + tw; } return Rc + tw; };
    return g;
  }

  // Injector plate: a disc whose face (y = 0, facing down) carries rings of coaxial
  // elements. The body runs from y = 0 up to the thickness. Returns a group (plate, elements).
  function injectorPlate(o = {}) {
    const Rc = o.radius ?? 170, R = o.outer ?? Rc * 1.4, t = o.thickness ?? Rc * 0.14, pitch = o.pitch ?? Rc * 0.115;
    const rings = o.rings ?? Math.max(2, Math.round(Rc / pitch) - 1), er = o.element ?? pitch * 0.22;
    const body = revolve(fillet([[0, 0], [Rc, 0], [Rc + 2, -1.2], [R, -1.2, 1], [R, t, 1.5], [0, t]], { steps: 3 }), { segments: o.segments ?? 96 });
    const post = revolve([[0, -0.8], [er, -0.8], [er, 1], [0, 1]], { segments: 10 });
    const sleeve = revolve([[er * 1.2, -0.4], [er * 1.6, -0.4], [er * 1.6, 1], [er * 1.2, 1]], { loop: true, segments: 10 });
    const posts = [xf(post, T([0, 0, 0]))], sleeves = o.sleeves ? [xf(sleeve, T([0, 0, 0]))] : [];
    for (let k = 1; k <= rings; k++) {
      const r = (Rc * 0.9 * k) / rings, n = Math.max(6, Math.round((TAU * r) / pitch));
      for (let i = 0; i < n; i++) { const p = cyl(r, (i + (k % 2) * 0.5) / n * TAU, 0); posts.push(xf(post, T(p))); if (o.sleeves) sleeves.push(xf(sleeve, T(p))); }
    }
    const g = group(o.name ?? "injector", [
      [body, { name: "injector plate", material: o.material ?? "copper" }],
      [sleeves.length ? merge(sleeves) : null, { name: "injector elements", material: "steel" }],
      [merge(posts), { name: "orifices", material: "graphite" }],
    ]);
    g.info = { elements: posts.length, radius: Rc, outer: R, thickness: t };
    return g;
  }

  // Centrifugal impeller with backswept vanes on a hub; the back face sits on y = 0 and the
  // eye faces +y. exitAngle is the vane angle from the tangent at the tip (degrees).
  function impeller(o = {}) {
    const R2 = o.radius ?? 80, R1 = o.eye ?? R2 * 0.45, nb = o.vanes ?? 6, b2 = o.width ?? R2 * 0.14;
    const beta = (o.exitAngle ?? 24) * DEG, tb = o.back ?? R2 * 0.07, H = o.length ?? R2 * 0.62, Rn = R1 * 0.42, tv = o.vane ?? R2 * 0.045;
    const hubY = r => tb + H * Math.pow(clamp((R2 - r) / (R2 - Rn), 0, 1), 2.2);
    const prof = [[0, 0], [R2 - 1, 0], [R2, 1], [R2, tb]];
    for (let i = 1; i <= 16; i++) { const r = lerp(R2, Rn, i / 16); prof.push([r, hubY(r)]); }
    prof.push(...arc2(0, hubY(Rn), Rn, 0, Math.PI / 2, 6).slice(1));
    const hub = revolve(prof, { segments: o.segments ?? 64 });
    const S = new Soup(), st = 18, r0 = R1 * 0.92;
    const tipH = r => lerp(R1 * 0.95, b2, Math.pow((r - r0) / (R2 - r0), 0.7));
    const vane = (phase, rs) => {
      const rings = [];
      for (let i = 0; i <= st; i++) {
        const r = lerp(rs, R2, i / st), phi = phase - Math.log(r / R1) / Math.tan(beta) * (o.sweep ?? 1);
        const da = tv / 2 / r, yh = hubY(r) - 1.5, yt = hubY(r) + tipH(r);
        rings.push([cyl(r, phi - da, yh), cyl(r, phi + da, yh), cyl(r, phi + da, yt), cyl(r, phi - da, yt)]);
      }
      for (let i = 0; i < st; i++) for (let q = 0; q < 4; q++) { const q1 = (q + 1) % 4; S.quad(rings[i][q], rings[i + 1][q], rings[i + 1][q1], rings[i][q1]); }
      S.quad(rings[0][0], rings[0][1], rings[0][2], rings[0][3]);
      S.quad(rings[st][3], rings[st][2], rings[st][1], rings[st][0]);
    };
    for (let k = 0; k < nb; k++) {
      vane((k / nb) * TAU, r0);
      if (o.splitters !== false) vane(((k + 0.5) / nb) * TAU, (R1 + R2) / 2);
    }
    const m = merge(hub, S.build({ crease: 40 }));
    m.impeller = { radius: R2, eye: R1, vanes: nb, height: hubY(Rn) + Rn, tipWidth: b2, hubY, tipY: r => hubY(r) + tipH(clamp(r, r0, R2)), back: tb };
    return m;
  }

  // Volute (spiral casing) around an impeller of radius `radius`, centered on y, discharging
  // along -z from the +x side. Section area grows linearly with angle. Hollow.
  function volute(o = {}) {
    const R2 = o.radius ?? 80, R3 = o.base ?? R2 * 1.12, r0 = o.start ?? R2 * 0.12, r1 = o.end ?? R2 * 0.4, yc = o.y ?? 0, t = o.wall ?? R2 * 0.05;
    const Ld = o.discharge ?? R2 * 1.6, path = [], rs = [], n = 64;
    for (let i = 0; i <= n; i++) {
      const a = 0.35 + ((TAU - 0.35) * i) / n, r = Math.sqrt(lerp(r0 * r0, r1 * r1, (a - 0.35) / (TAU - 0.35)));
      path.push(cyl(R3 + r * 0.75, a, yc)); rs.push(r);
    }
    const end = path[path.length - 1];
    for (let i = 1; i <= 8; i++) { path.push(v3.add(end, [0, 0, (-Ld * i) / 8])); rs.push(r1 * (1 + 0.18 * (i / 8))); }
    const N = path.length - 1, rr = t2 => { const f = t2 * N, i = Math.min(N - 1, Math.floor(f)); return lerp(rs[i], rs[i + 1], f - i); };
    const m = tubeShell(path, rr, t2 => rr(t2) - t, { segments: o.segments ?? 22 });
    m.volute = { exit: { center: path[N], normal: [0, 0, -1], radius: rs[N] }, outer: R3 + r1 * 1.75 };
    return m;
  }

  // Gimbal: a universal joint. upper yoke (fixed), cross (turns for pitch about x), lower
  // yoke (turns for yaw about z, carries the engine). Pivot at the origin.
  function gimbal(o = {}) {
    const s = o.size ?? 50, t = s * 0.28;
    const ear = (w, h, hole) => mesh.extrude([...arc2(0, 0, w / 2, Math.PI, TAU, 10), [w / 2, h], [-w / 2, h]], t, { holes: [circle2(hole, 20)], bevel: t * 0.15 });
    const up = xf(ear(s * 1.15, s * 1.5, s * 0.34), RX(Math.PI));
    const upper = merge(
      revolve(fillet([[0, s * 1.3], [s * 1.7, s * 1.3, s * 0.1], [s * 1.7, s * 1.75, s * 0.12], [0, s * 1.75]]), { segments: 48 }),
      xf(up, T([s * 1.15, 0, 0]), RY(Math.PI / 2)), xf(up, T([-s * 1.15, 0, 0]), RY(Math.PI / 2)),
    );
    const low = ear(s * 1.15, s * 1.5, s * 0.34);
    const lower = merge(
      revolve(fillet([[0, -s * 1.75], [s * 1.7, -s * 1.75, s * 0.12], [s * 1.7, -s * 1.3, s * 0.1], [0, -s * 1.3]]), { segments: 48 }),
      xf(low, T([0, 0, s * 1.15]), RX(Math.PI)), xf(low, T([0, 0, -s * 1.15]), RX(Math.PI)),
    );
    const pin = mesh.cylinder(s * 0.32, s * 3.1, { segments: 24 });
    const cross = merge(mesh.box(s * 1.25, s * 1.25, s * 1.25, { round: s * 0.18 }), xf(pin, RZ(Math.PI / 2)), xf(pin, RX(Math.PI / 2)));
    const g = E3.node(null, { name: o.name ?? "gimbal" });
    g.add(upper, { name: "gimbal upper yoke", material: o.material ?? "steel" });
    const c = g.add(cross, { name: "gimbal cross", material: o.material ?? "steel" });
    const l = c.add(lower, { name: "gimbal lower yoke", material: o.material ?? "steel" });
    g.cross = c; g.lower = l;
    g.set2 = (pitch = 0, yaw = 0) => { c.rotation = [pitch, 0, 0]; l.rotation = [0, 0, yaw]; return g; };
    g.info = { size: s, top: s * 1.75, bottom: -s * 1.75 };
    return g;
  }

  // Linear actuator (hydraulic or electromechanical): barrel, rod, clevis eyes.
  // span(a, b) stretches it between two points in its parent's frame.
  function actuator(o = {}) {
    const bore = o.bore ?? 30, Lc = o.length ?? 320, stroke = o.stroke ?? Math.min(110, Lc * 0.4);
    const Lb = Lc * 0.72, Lr = stroke + Lc * 0.32, e = bore * 0.42;
    const eye = merge(xf(mesh.torus(e * 0.75, e * 0.32, { segments: 24, tube: 10 }), RX(Math.PI / 2)), xf(mesh.cylinder(e * 0.45, e * 0.9, { segments: 16 }), RX(Math.PI / 2)));
    const rb = bore * 0.62;
    const barrel = merge(
      revolve(fillet([[0, e * 0.9], [rb * 0.7, e * 0.9], [rb * 0.78, e * 1.6, 2], [rb, e * 1.7, 2], [rb, Lb * 0.94, 3], [rb * 0.92, Lb, 2], [bore * 0.36, Lb + 2], [0, Lb + 2]]), { segments: 32 }),
      revolve([[rb - 0.5, Lb * 0.3], [rb + bore * 0.08, Lb * 0.3], [rb + bore * 0.08, Lb * 0.36], [rb - 0.5, Lb * 0.36]], { loop: true, segments: 32 }),
      xf(mesh.cylinder(bore * 0.12, bore * 0.4, { segments: 12 }), T([rb + bore * 0.15, Lb * 0.75, 0]), RZ(Math.PI / 2)),
      eye,
    );
    const rod = merge(revolve([[0, 0], [bore * 0.24, 0], [bore * 0.24, Lr - e * 1.4], [bore * 0.33, Lr - e * 1.1], [bore * 0.33, Lr - e * 0.8], [0, Lr - e * 0.8]], { segments: 24 }), xf(eye, T([0, Lr, 0])));
    const g = E3.node(null, { name: o.name ?? "actuator" });
    const bN = g.add(barrel, { name: `${o.name ?? "actuator"} barrel`, material: o.material ?? "steel" });
    const rN = g.add(rod, { name: `${o.name ?? "actuator"} rod`, material: o.rodMaterial ?? "brushed" });
    g.barrel = bN; g.rod = rN;
    g.span = (a, b) => {
      const d = v3.dist(a, b);
      g.matrix = aim(a, v3.sub(b, a));
      rN.position = [0, d - Lr, 0];
      g.extension = (d - Lc) / stroke;
      return g;
    };
    g.span([0, 0, 0], [0, Lc, 0]);
    g.info = { length: Lc, stroke, bore };
    return g;
  }

  // Propellant tank: cylinder with elliptical domes (dome height = ratio x radius), as a
  // hollow shell, with weld lands and ports. Centered on y = 0.
  function tank(o = {}) {
    const R = o.radius ?? 400, L = o.length ?? 800, k = o.dome ?? 1 / Math.SQRT2, t = o.wall ?? Math.max(2, R * 0.012), seg = o.segments ?? 72;
    const shell = (Rr, kk) => {
      const pts = [];
      for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / 16); pts.push([Rr * Math.cos(a), -L / 2 + kk * Math.sin(a)]); }
      for (let i = 0; i <= 16; i++) { const a = (Math.PI / 2) * (i / 16); pts.push([Rr * Math.cos(a), L / 2 + kk * Math.sin(a)]); }
      return pts;
    };
    const out = shell(R, k * R), inn = shell(R - t, k * R - t).reverse();
    const body = revolve([...out, ...inn], { loop: true, segments: seg });
    const land = y => revolve(fillet([[R - 1, y - t * 4], [R + t * 0.8, y - t * 3, t * 0.8], [R + t * 0.8, y + t * 3, t * 0.8], [R - 1, y + t * 4]]), { loop: true, segments: seg });
    const rp = o.port ?? R * 0.12, top = L / 2 + k * R, bot = -L / 2 - k * R;
    const boss = y => revolve(fillet([[0, y - rp * 0.6 * Math.sign(y)], [rp * 1.6, y - rp * 0.3 * Math.sign(y), rp * 0.2], [rp * 1.6, y + rp * 0.25 * Math.sign(y)], [0, y + rp * 0.25 * Math.sign(y)]]), { loop: false, segments: 32 });
    const g = group(o.name ?? "tank", [
      [body, { name: "tank", material: o.material ?? "aluminum" }],
      [merge(land(-L / 2), land(L / 2), ...(o.rings ? Array.from({ length: o.rings }, (_, i) => land(lerp(-L / 2, L / 2, (i + 1) / (o.rings + 1)))) : [])), { name: "weld lands", material: o.material ?? "aluminum" }],
      [merge(boss(top), boss(bot)), { name: "ports", material: "steel" }],
    ]);
    g.info = { radius: R, length: L, height: L + 2 * k * R, volume: Math.PI * R * R * L + (4 / 3) * Math.PI * R * R * k * R };
    g.ports = { top: { center: [0, top + rp * 0.25, 0], normal: [0, 1, 0], radius: rp }, bottom: { center: [0, bot - rp * 0.25, 0], normal: [0, -1, 0], radius: rp } };
    return g;
  }

  // ---------- turbomachinery parts ----------
  // NACA 4-digit section (m camber, p camber position, t thickness, all fractions of chord),
  // closed trailing edge, cosine spacing: a loop of 2n points, TE -> upper -> LE -> lower.
  function nacaMPT(m, p, t, n = 16) {
    const f = x => {
      const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
      let yc = 0, dy = 0;
      if (m > 0 && p > 0) {
        if (x < p) { yc = (m / (p * p)) * (2 * p * x - x * x); dy = ((2 * m) / (p * p)) * (p - x); }
        else { yc = (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x); dy = ((2 * m) / (1 - p) ** 2) * (p - x); }
      }
      const th = Math.atan(dy);
      return { xu: x - yt * Math.sin(th), yu: yc + yt * Math.cos(th), xl: x + yt * Math.sin(th), yl: yc - yt * Math.cos(th) };
    };
    const P = Array.from({ length: n + 1 }, (_, i) => f((1 - Math.cos((Math.PI * i) / n)) / 2));
    const pts = [];
    for (let i = n; i >= 0; i--) pts.push([P[i].xu, P[i].yu]);
    for (let i = 1; i < n; i++) pts.push([P[i].xl, P[i].yl]);
    return pts;
  }
  function naca(code = "2412", n = 16) {
    const s = String(code).padStart(4, "0");
    return nacaMPT(+s[0] / 100, +s[1] / 10, +s.slice(2) / 100, n);
  }
  // A value that varies along the span: a number, [root, ..., tip] (piecewise linear), or s => value.
  const spanVal = (v, s) => {
    if (typeof v === "function") return v(s);
    if (!Array.isArray(v)) return v;
    if (v.length === 1) return v[0];
    const f = clamp(s, 0, 1) * (v.length - 1), i = Math.min(v.length - 2, Math.floor(f));
    return lerp(v[i], v[i + 1], f - i);
  };
  const centroid = pts => v3.scale(pts.reduce((a, p) => v3.add(a, p), [0, 0, 0]), 1 / pts.length);
  // Lofts NACA sections into a closed blade. sec(s) -> { m, p, t, chord, angle, dx, dz, pivot };
  // map(X, s, Z) places a section point: X chordwise (axial), Z across, s the span fraction.
  function loft(sec, map, { stations = 9, n = 14, hand = 1 } = {}) {
    const rings = [], flat = [];
    for (let k = 0; k < stations; k++) {
      const s = k / (stations - 1), q = sec(s), ca = Math.cos(q.angle), sa = Math.sin(q.angle);
      const loop = nacaMPT(q.m, q.p ?? 0.4, q.t, n).map(([x, y]) => {
        const xx = (x - (q.pivot ?? 0.4)) * q.chord, yy = y * q.chord;
        return [xx * ca - yy * sa + (q.dx || 0), hand * (-xx * sa - yy * ca) + (q.dz || 0)];
      });
      flat.push(loop);
      rings.push(loop.map(([X, Z]) => map(X, s, Z)));
    }
    const m = rings[0].length, S = new Soup();
    for (let k = 0; k < stations - 1; k++) for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      S.quad(rings[k][j], rings[k][j1], rings[k + 1][j1], rings[k + 1][j]);
    }
    // Caps must run their edges against the sides': backward along the root ring, forward
    // along the tip ring. E3.triangulate returns counterclockwise triangles, so check the
    // section's own winding to know which way they run. build() then turns the whole
    // closed blade outward.
    for (const [k, forward] of [[0, false], [stations - 1, true]]) {
      const s = k / (stations - 1), ccw = area2(flat[k]) > 0, fn = ([X, Z]) => map(X, s, Z);
      for (const [p, q, r] of E3.triangulate(flat[k])) {
        if (ccw === forward) S.tri(fn(p), fn(q), fn(r)); else S.tri(fn(p), fn(r), fn(q));
      }
    }
    return S.build({ crease: 45, closed: true });
  }

  // A single blade standing on y = 0 (span up +y, chord along x). twist is the section
  // angle from the x axis at root and tip (degrees); thickness and camber are fractions of chord.
  function blade(o = {}) {
    const span = o.span ?? 200, chord = o.chord ?? [80, 50], twist = o.twist ?? [10, 40];
    const thick = o.thickness ?? (o.airfoil ? null : [0.12, 0.06]), camber = o.camber ?? [0.04, 0.02];
    const codes = o.airfoil ? (Array.isArray(o.airfoil) ? o.airfoil : [o.airfoil, o.airfoil]) : null;
    const dig = (c, i) => { const s = String(c).padStart(4, "0"); return [+s[0] / 100, +s[1] / 10, +s.slice(2) / 100][i]; };
    const sec = s => ({
      m: codes ? lerp(dig(codes[0], 0), dig(codes[codes.length - 1], 0), s) : spanVal(camber, s),
      p: codes ? lerp(dig(codes[0], 1), dig(codes[codes.length - 1], 1), s) || 0.4 : 0.4,
      t: codes ? lerp(dig(codes[0], 2), dig(codes[codes.length - 1], 2), s) : spanVal(thick, s),
      chord: spanVal(chord, s), angle: spanVal(twist, s) * DEG, dx: spanVal(o.sweep ?? 0, s), dz: spanVal(o.lean ?? 0, s), pivot: o.pivot ?? 0.4,
    });
    const m = loft(sec, (X, s, Z) => [X, s * span, Z], { stations: o.stations ?? 9, n: o.points ?? 16, hand: o.hand ?? 1 });
    m.blade = { span };
    return m;
  }

  // n blades around the y axis between hub and tip radii, stacked at y = o.y. Blades follow
  // the hub and casing (hubSlope, tipSlope = dr/dy) and twist from root to tip. Returns a
  // group: blades, disk (optional), shroud (optional).
  function rotorStage(o = {}) {
    const n = o.blades ?? 24, hub = o.hub ?? 100, tip = o.tip ?? 200, y0 = o.y ?? 0, h = tip - hub;
    const embed = o.embed ?? Math.max(0.6, h * 0.05), hs = o.hubSlope ?? 0, ts = o.tipSlope ?? 0;
    const sec = s => ({
      m: spanVal(o.camber ?? [0.05, 0.03], s), p: 0.45, t: spanVal(o.thickness ?? [0.1, 0.05], s),
      chord: spanVal(o.chord ?? [h * 0.6, h * 0.5], s), angle: spanVal(o.stagger ?? o.twist ?? [30, 55], s) * DEG,
      dx: spanVal(o.sweep ?? 0, s), dz: spanVal(o.lean ?? 0, s), pivot: o.pivot ?? 0.45,
    });
    const map = (X, s, Z) => {
      const R = lerp(hub + hs * X - embed, tip + ts * X - (o.clearance ?? 0), s);
      return cyl(R, Z / R, y0 + X);
    };
    const one = loft(sec, map, { stations: o.stations ?? 3, n: o.points ?? 6, hand: o.hand ?? 1 });
    const a0 = o.phase ?? 0;
    const g = E3.node(null, { name: o.name ?? "rotor" });
    g.add(merge(Array.from({ length: n }, (_, k) => xf(one, RY(a0 + (k / n) * TAU)))), { name: o.bladeName ?? `${o.name ?? "rotor"} blades`, material: o.material ?? "titanium" });
    const cx = spanVal(o.chord ?? [h * 0.6, h * 0.5], 0) * 0.55;
    if (o.disk !== false) {
      const w = o.diskWidth ?? cx * 1.3, bore = o.bore ?? hub * 0.35, rim = hub - Math.max(1, h * 0.03);
      const prof = fillet([[bore, y0 - w * 0.45], [bore + w * 0.3, y0 - w * 0.45, w * 0.1], [lerp(bore, rim, 0.45), y0 - w * 0.14, w * 0.25], [rim * 0.86, y0 - w * 0.14, w * 0.2], [rim * 0.86, y0 - w * 0.5, w * 0.05], [rim, y0 - w * 0.5, w * 0.05], [rim, y0 + w * 0.5, w * 0.05], [rim * 0.86, y0 + w * 0.5, w * 0.05], [rim * 0.86, y0 + w * 0.14, w * 0.2], [lerp(bore, rim, 0.45), y0 + w * 0.14, w * 0.25], [bore + w * 0.3, y0 + w * 0.45, w * 0.1], [bore, y0 + w * 0.45]], { closed: true, steps: 3 });
      g.add(revolve(prof, { loop: true, segments: o.segments ?? 64 }), { name: `${o.name ?? "rotor"} disk`, material: o.diskMaterial ?? o.material ?? "titanium" });
    }
    if (o.shroud) {
      const w = cx * 1.6, t = Math.max(1, h * 0.06);
      g.add(revolve([[tip - t * 0.6, y0 - w / 2], [tip + t * 0.4, y0 - w / 2], [tip + t * 0.4 + ts * w, y0 + w / 2], [tip - t * 0.6 + ts * w, y0 + w / 2]], { loop: true, segments: o.segments ?? 96 }), { name: `${o.name ?? "rotor"} shroud`, material: o.material ?? "inconel" });
    }
    g.info = { blades: n, hub, tip, y: y0 };
    return g;
  }

  // Stator stage: vanes between an inner and an outer band (y = o.y).
  function statorStage(o = {}) {
    const n = o.vanes ?? 30, inner = o.inner ?? 100, outer = o.outer ?? 200, y0 = o.y ?? 0, h = outer - inner;
    const chord = o.chord ?? h * 0.55, emb = Math.max(0.8, h * 0.06), is = o.innerSlope ?? 0, os = o.outerSlope ?? 0;
    const sec = s => ({ m: spanVal(o.camber ?? 0.05, s), p: 0.4, t: spanVal(o.thickness ?? 0.08, s), chord: spanVal(chord, s), angle: spanVal(o.stagger ?? -20, s) * DEG, dx: 0, dz: 0, pivot: 0.5 });
    const map = (X, s, Z) => { const R = lerp(inner + is * X - emb, outer + os * X + emb, s); return cyl(R, Z / R, y0 + X); };
    const one = loft(sec, map, { stations: o.stations ?? 2, n: o.points ?? 6, hand: o.hand ?? -1 });
    const g = E3.node(null, { name: o.name ?? "stator" });
    g.add(merge(Array.from({ length: n }, (_, k) => xf(one, RY((o.phase ?? 0) + (k / n) * TAU)))), { name: o.vaneName ?? `${o.name ?? "stator"} vanes`, material: o.material ?? "titanium" });
    const cw = spanVal(chord, 0.5) * 0.62, t = Math.max(1, h * 0.05);
    const band = (r, sl, sgn) => {
      const at = y => r + sl * (y - y0);
      return revolve([[at(y0 - cw), y0 - cw], [at(y0 - cw) + sgn * t, y0 - cw], [at(y0 + cw) + sgn * t, y0 + cw], [at(y0 + cw), y0 + cw]], { loop: true, segments: o.segments ?? 96 });
    };
    if (o.bands !== false) g.add(merge(band(inner, is, -1), o.outerBand === false ? null : band(outer, os, 1)), { name: `${o.name ?? "stator"} bands`, material: o.bandMaterial ?? o.material ?? "titanium" });
    g.info = { vanes: n, inner, outer, y: y0 };
    return g;
  }

  // Spinner (nose cone) with its tip at y = 0 and its base (radius R) at y = length.
  function spinner(o = {}) {
    const R = o.radius ?? 250, L = o.length ?? R * 1.35, shape = o.shape ?? "ogive", n = 28, pts = [[0, 0]];
    const rho = (R * R + L * L) / (2 * R);
    for (let i = 1; i <= n; i++) {
      const y = (L * i) / n;
      let r;
      if (shape === "cone") r = R * Math.min(1, (y / L) * 1.04);
      else if (shape === "ellipse") r = R * Math.sqrt(1 - (1 - y / L) ** 2);
      else r = Math.sqrt(Math.max(0, rho * rho - (L - y) ** 2)) + R - rho;
      pts.push([r, y]);
    }
    const back = o.back ?? R * 0.12;
    pts.push([R, L + back], [R * 0.6, L + back], [0, L + back]);
    const m = revolve(pts, { segments: o.segments ?? 64 });
    m.spinner = { radius: R, length: L };
    return m;
  }

  // Nacelle as a revolved wall: inlet lip, diffuser to the fan case, a pocket the fan case
  // fills, the bypass duct, and a boat tail to the fan nozzle. Fan face at y = 0, flow +y.
  // arc/start leave a wedge open (a cutaway).
  function nacelleProfile(o = {}) {
    const Rf = o.fan ?? 900, Rc = o.caseInner ?? Rf * 1.006, Rco = o.caseOuter ?? Rf * 1.075;
    const yH = o.inlet ?? -Rf * 0.86, Rh = o.highlight ?? Rf * 1.045, Rth = o.throat ?? Rf * 0.965;
    const Rmax = o.max ?? Rf * 1.18, yMax = o.maxAt ?? yH + Rf * 0.62, yE = o.exit ?? Rf * 1.75, RE = o.exitRadius ?? Rf * 0.9;
    const yCF = o.caseFront ?? -Rf * 0.32, yCR = o.caseRear ?? Rf * 0.52, ductR = o.duct ?? Rf * 0.985, te = o.trailing ?? Rf * 0.006;
    const ai = o.lipLength ?? Rf * 0.13, bi = Rh - Rth, k = o.forebody ?? 2.3;
    const outer = [];
    for (let i = 0; i <= 28; i++) { const u = i / 28; outer.push([Rh + (Rmax - Rh) * Math.pow(1 - Math.pow(1 - u, k), 1 / k), yH + (yMax - yH) * u]); }
    for (let i = 1; i <= 28; i++) { const u = i / 28; outer.push([Rmax - (Rmax - RE) * Math.pow(u, 1.7), yMax + (yE - yMax) * u]); }
    const inner = [];
    for (let i = 1; i <= 10; i++) { const a = Math.PI + (Math.PI / 2) * (i / 10); inner.push([Rh + bi * Math.sin(a), yH + ai + ai * Math.cos(a)]); }
    const yT = yH + ai;
    for (let i = 1; i <= 14; i++) { const u = i / 14; inner.push([Rth + ((Rc - Rth) * (1 - Math.cos(Math.PI * u))) / 2, yT + (yCF - yT) * u]); }
    inner.push([Rco, yCF], [Rco, yCR], [ductR, yCR]);
    for (let i = 1; i <= 20; i++) { const u = i / 20; inner.push([ductR - (ductR - (RE - te)) * Math.pow(u, 1.8), yCR + (yE - te * 3 - yCR) * u]); }
    const loop = [...outer, ...inner.reverse()];
    return { loop, Rf, Rc, Rco, yCF, yCR, ductR, yE, RE, te, yH, Rh, Rmax };
  }
  function nacelle(o = {}) {
    const P = nacelleProfile(o);
    const m = revolve(P.loop, { loop: true, segments: o.segments ?? 128, arc: o.arc ?? TAU, start: o.start ?? 0 });
    m.nacelle = P;
    return m;
  }

  // ---------- plumbing extras ----------
  // Bellows (flex joint) along y from 0 to length: a convoluted tube with plain cuffs.
  function bellows(o = {}) {
    const r = o.radius ?? 25, L = o.length ?? 60, n = o.convolutions ?? 8, h = o.depth ?? r * 0.18, t = o.wall ?? Math.max(0.8, r * 0.05);
    const cuff = L * 0.14, pts = [[r, 0], [r, cuff]];
    for (let i = 0; i <= n * 6; i++) { const u = i / (n * 6), y = cuff + u * (L - 2 * cuff); pts.push([r + h * 0.5 * (1 - Math.cos(u * n * TAU)), y]); }
    pts.push([r, L]);
    const inner = pts.map(([rr, y]) => [rr - t, y]).reverse();
    return revolve([...pts, ...inner], { loop: true, segments: o.segments ?? 32, crease: 70 });
  }
  // Inline ball valve on a pipe of radius `pipe`, flow along y, centered on y = 0, with its
  // actuator on +x. Returns a group: valve body, valve actuator.
  function valve(o = {}) {
    const rp = o.pipe ?? 25, L = o.length ?? rp * 4.2, rb = rp * 1.55;
    const body = revolve(fillet([[rp * 0.88, -L / 2], [rp * 1.25, -L / 2], [rp * 1.25, -L * 0.36, 2], [rb, -L * 0.2, rp * 0.4], [rb, L * 0.2, rp * 0.4], [rp * 1.25, L * 0.36, 2], [rp * 1.25, L / 2], [rp * 0.88, L / 2]]), { loop: true, segments: 40 });
    const fl = flange({ pipe: rp * 1.25, bore: rp * 0.88 });
    const bonnet = xf(revolve(fillet([[0, rb * 0.6], [rp * 0.5, rb * 0.6], [rp * 0.5, rb * 1.25, 2], [rp * 0.8, rb * 1.3, 2], [rp * 0.8, rb * 1.45], [0, rb * 1.45]]), { segments: 24 }), RZ(-Math.PI / 2));
    const act = xf(mesh.box(rp * 1.4, rp * 2.2, rp * 1.8, { round: rp * 0.25 }), T([rb * 1.45 + rp * 0.7, 0, 0]));
    const g = group(o.name ?? "valve", [
      [merge(body, xf(fl, T([0, L / 2, 0])), xf(fl, T([0, -L / 2, 0]), RX(Math.PI)), bonnet), { name: o.name ?? "valve", material: o.material ?? "steel" }],
      [act, { name: `${o.name ?? "valve"} actuator`, material: o.actuatorMaterial ?? "porcelain" }],
    ]);
    g.info = { length: L };
    return g;
  }

  // ---------- turbopump ----------
  // Impeller, casing (front cover, back plate, inlet neck) and volute for a centrifugal
  // pump, impeller axis y, back face on y = 0. Shared by turbopump() and pump().
  function pumpCasing(o = {}) {
    const R2 = o.radius ?? 75;
    const imp = impeller({ radius: R2, vanes: o.vanes ?? 6, exitAngle: o.exitAngle ?? 24 }), I = imp.impeller;
    const c = R2 * 0.04, tc = R2 * 0.075, Ri = I.eye * 1.08, R3 = R2 * 1.12, r0 = R2 * 0.12, rs = R2 * 0.2, tb2 = R2 * 0.12;
    const yTip = r => I.tipY(Math.min(r, R2));
    const yIn = I.height + R2 * (o.neck ?? 0.5);
    const shIn = [], shOut = [];
    for (let i = 0; i <= 12; i++) { const r = lerp(Ri, R2 + c, i / 12); shIn.push([r, yTip(r) + c]); }
    for (let i = 0; i <= 12; i++) { const r = lerp(R2 + c, Ri + tc, i / 12); shOut.push([r, yTip(r) + c + tc]); }
    const casing = revolve(fillet([[Ri, yIn], ...shIn, [R3, yTip(R2) + c, 2], [R3, -c, 2], [rs, -c], [rs, -c - tb2], [R3 + r0 * 0.6, -c - tb2, 3], [R3 + r0 * 0.6, yTip(R2) + c + tc, 4], ...shOut, [Ri + tc, yIn]], { closed: true, steps: 3 }), { loop: true, segments: 72 });
    const yc = (I.back + yTip(R2)) / 2;
    const vol = volute({ radius: R2, base: R3, y: yc, start: r0, end: R2 * 0.36, wall: tc * 0.8, discharge: o.discharge });
    const ex = vol.volute.exit;
    const inFl = flange({ pipe: Ri + tc, bore: Ri });
    const disFl = flange({ pipe: ex.radius, bore: ex.radius - tc * 0.8 });
    return { imp, I, c, tc, Ri, R3, yIn, yc, casing, vol, ex, inFl, disFl, tb2 };
  }

  // A turbine-driven centrifugal pump on one shaft: axial inlet on top, impeller and volute,
  // bearing housing, turbine below with its hot-gas manifold and exhaust. Origin: the
  // impeller's back face. pose({ spin }) turns the rotor (impeller, shaft, turbine).
  function turbopump(o = {}) {
    const R2 = o.impeller ?? 75, A = assembly(o.name ?? "turbopump", o), M = (r, f) => matFor(o, r, f);
    const CP = pumpCasing({ radius: R2, vanes: o.vanes ?? 6, exitAngle: o.exitAngle ?? 24 });
    const { imp, I, c, tc, Ri, yIn, casing, vol, ex, inFl, disFl, tb2 } = CP;
    const hx = [2.6 * R2, 0, 0];
    A.part("pump housing", merge(casing, vol), { material: M("housing", "aluminum"), explode: [0, 2.6 * R2, 0], label: { text: "volute", at: v3.add(ex.center, [0, 0, R2 * 0.5]) }, note: "the spiral casing slows the flow leaving the impeller and turns speed into pressure" });
    A.part("pump flanges", merge(xf(inFl, T([0, yIn, 0])), mesh.transform(disFl, aim(ex.center, ex.normal))), { material: M("flange", "steel"), explode: [0, 2.6 * R2, 0] });
    const rotor = A.group("rotor");
    A.rotor = rotor;
    A.part("impeller", imp, { parent: rotor, material: M("impeller", "aluminum"), explode: [0, 1.4 * R2, 0], label: { text: "impeller", at: [R2 * 0.8, I.tipY(R2 * 0.8), 0] }, note: "backswept vanes fling the propellant outward and raise its pressure" });
    const yT = -2.35 * R2, yB = yT - 0.28 * R2, yTop = I.height * 0.55, Ls = yTop - yB;
    const sh = shaft({ steps: [[0.32 * R2, 0.26 * R2], [0.32 * R2, 0.36 * R2], [Ls - 1.6 * R2, 0.32 * R2], [0.32 * R2, 0.36 * R2], [0.64 * R2, 0.26 * R2]], segments: 24 });
    A.part("shaft", xf(sh, T([0, yB, 0])), { parent: rotor, material: M("shaft", "steel"), label: { text: "shaft", at: [0, yT + R2 * 0.9, 0] }, note: "one shaft carries the turbine and the impeller, so they turn together" });
    const br = { bore: 0.18 * R2, outer: 0.34 * R2, width: 0.26 * R2 };
    const yb1 = yB + 0.35 * R2, yb2 = yTop - 0.94 * R2;
    A.part("lower bearing", bearing({ ...br, name: "lower bearing" }), { position: [0, yb1, 0], explode: [0, -0.9 * R2, 0] });
    A.part("upper bearing", bearing({ ...br, name: "upper bearing" }), { position: [0, yb2, 0], explode: [0, 0.75 * R2, 0], label: { text: "bearing", at: [br.outer, br.width / 2, 0] }, note: "ball bearings hold the spinning shaft centered in its housing" });
    const hT = -c - tb2, hB = yT + 0.46 * R2;
    const bh = revolve(fillet([[br.outer, hT], [0.62 * R2, hT], [0.62 * R2, hT - 0.07 * R2, 1], [0.42 * R2, hT - 0.16 * R2, 0.06 * R2], [0.42 * R2, hB + 0.16 * R2, 0.06 * R2], [0.62 * R2, hB + 0.07 * R2, 1], [0.62 * R2, hB], [br.outer, hB]], { closed: true, steps: 3 }), { loop: true, segments: 48 });
    const ribs = Array.from({ length: 4 }, (_, k) => xf(mesh.box(0.2 * R2, hT - hB - 0.3 * R2, 0.05 * R2, { round: 0.5 }), RY((k / 4) * TAU + Math.PI / 4), T([0.48 * R2, (hT + hB) / 2, 0])));
    A.part("bearing housing", merge(bh, ribs), { material: M("bearingHousing", "steel"), explode: hx, label: { text: "bearing housing", at: [0.42 * R2, (hT + hB) / 2, 0] }, note: "holds both bearings and keeps hot turbine gas away from the cold pump" });
    const turb = rotorStage({ name: "turbine", blades: o.turbineBlades ?? 56, hub: 0.6 * R2, tip: 0.8 * R2, y: yT, chord: [0.17 * R2], stagger: [0], camber: [0.13], thickness: [0.16], hand: -1, shroud: true, diskWidth: 0.24 * R2, bore: 0.14 * R2, material: M("turbine", "inconel") });
    A.part("turbine rotor", turb, { parent: rotor, explode: [0, -1.25 * R2, 0], label: { text: "turbine", at: [0.8 * R2, yT, 0] }, note: "hot gas from the gas generator pushes on these blades and spins the shaft" });
    const nz = statorStage({ name: "turbine nozzle", vanes: 26, inner: 0.6 * R2, outer: 0.8 * R2, y: yT + 0.21 * R2, chord: 0.15 * R2, stagger: 58, camber: 0.08, thickness: 0.14, material: M("turbine", "inconel") });
    A.part("turbine nozzle", nz, { explode: [0, -1.75 * R2, 0], note: "fixed vanes that aim the hot gas at the turbine blades" });
    const yEx = yT - 0.95 * R2, tw = tc;
    const th = revolve(fillet([[0.4 * R2, yT + 0.38 * R2], [0.82 * R2, yT + 0.38 * R2, 3], [0.82 * R2, yT - 0.12 * R2, 4], [0.5 * R2, yT - 0.62 * R2, 6], [0.5 * R2, yEx], [0.5 * R2 + tw, yEx], [0.5 * R2 + tw, yT - 0.62 * R2 + tw * 0.4, 6], [0.82 * R2 + tw, yT - 0.12 * R2 + tw * 0.4, 4], [0.82 * R2 + tw, yT + 0.38 * R2 + tw, 3], [0.4 * R2, yT + 0.38 * R2 + tw]], { closed: true, steps: 3 }), { loop: true, segments: 64 });
    const yM = yT + 0.3 * R2, rM = 0.9 * R2, rt = 0.17 * R2;
    const man = xf(mesh.torus(rM, rt, { segments: 64, tube: 14 }), T([0, yM, 0]));
    const inlet = tubeShell([cyl(rM, Math.PI / 2, yM), cyl(rM + 0.7 * R2, Math.PI / 2, yM)], rt, 0, { segments: 20 });
    const tin = { center: cyl(rM + 0.7 * R2, Math.PI / 2, yM), normal: [0, 0, -1], radius: rt };
    const tinFl = mesh.transform(flange({ pipe: rt, bore: rt * 0.85 }), aim(tin.center, tin.normal));
    const exFl = xf(flange({ pipe: 0.5 * R2 + tw, bore: 0.5 * R2 }), T([0, yEx, 0]), RX(Math.PI));
    A.part("turbine housing", merge(th, man, inlet), { material: M("turbineHousing", "inconel"), explode: [0, -2.5 * R2, 0], label: { text: "turbine housing", at: cyl(rM + rt, Math.PI / 4, yM) }, note: "a ring manifold spreads the hot gas evenly around the turbine" });
    A.part("turbine flanges", merge(tinFl, exFl), { material: M("flange", "steel"), explode: [0, -2.5 * R2, 0] });
    A.port("inlet", A, [0, yIn, 0], [0, 1, 0], Ri);
    A.port("discharge", A, ex.center, ex.normal, ex.radius);
    A.port("turbineInlet", A, tin.center, tin.normal, rt);
    A.port("exhaust", A, [0, yEx, 0], [0, -1, 0], 0.5 * R2);
    A.info = { impeller: R2, top: yIn, bottom: yEx, volute: vol.volute.outer, flange: inFl.flange, yc: CP.yc };
    A.onPose = s => { if (s.spin != null) rotor.rotation = [0, s.spin, 0]; };
    return A;
  }

  // ---------- rocket engine ----------
  // A gas-generator cycle engine: bell nozzle with regen tubes, chamber, injector, LOX dome,
  // gimbal with two actuators, two turbopumps, a gas generator, feed lines with bellows,
  // valves, turbine exhaust ducts, harness, and a thrust frame. The nozzle exit is at y = 0.
  // pose({ pitch, yaw, spin, fuelSpin }) gimbals the engine (radians) and spins the pumps.
  function rocketEngine(o = {}) {
    const A = assembly(o.name ?? "rocket engine", o), M = (r, f) => matFor(o, r, f);
    const Rt = o.throat ?? 110, eps = o.expansion ?? 16;
    const noz = bellNozzle({ throat: Rt, expansion: eps, steps: 28, segments: 72, tubes: o.tubes === false ? false : { count: o.tubeCount ?? 84, from: 0.04, to: 0.5 }, material: M("nozzle", "inconel"), tubeMaterial: M("tubes", "inconel"), manifoldMaterial: M("manifold", "steel") });
    const C = noz.contour, yT = C.length, Ln = C.length;
    const ch = combustionChamber({ throat: Rt, contraction: o.contraction ?? 3, material: M("chamber", "inconel") });
    const CI = ch.info, Rc = CI.chamberRadius, top = yT + CI.top, Rfl = CI.flangeRadius;
    const eng = A.group("engine");
    A.engine = eng;
    const H = top + Rc * 0.6;
    A.part("nozzle", noz, { parent: eng, position: [0, yT, 0], explode: [0, -0.32 * H, 0], label: { text: "nozzle", at: [0, -Ln * 0.82, 0] }, note: `a bell that expands the gas ${eps} times in area, turning pressure into speed` });
    A.part("combustion chamber", ch, { parent: eng, position: [0, yT, 0], label: { text: "combustion chamber", at: [Rc + CI.wall, CI.top * 0.6, 0] }, note: "propellants burn here at high pressure; the throat below sets the flow" });
    const inj = injectorPlate({ radius: Rc, outer: Rfl, thickness: Rc * 0.13, material: M("injector", "steel") });
    const ti = inj.info.thickness;
    A.part("injector", inj, { parent: eng, position: [0, top, 0], explode: [0, 0.14 * H, 0], label: { text: "injector", at: [Rfl, ti / 2, 0] }, note: "hundreds of small elements spray and mix fuel and oxidizer" });
    // LOX dome: an elliptical shell over the injector with a side inlet and a gimbal boss.
    const fh = CI.flangeHeight * 1.1, hd = Rc * 0.55, tw = CI.wall * 0.8, domeY = top + ti;
    const outArc = Array.from({ length: 17 }, (_, i) => { const a = (Math.PI / 2) * (i / 16); return [(Rc + tw) * Math.cos(a), fh + hd * Math.sin(a)]; });
    const inArc = Array.from({ length: 17 }, (_, i) => { const a = (Math.PI / 2) * (1 - i / 16); return [Rc * Math.cos(a), fh + (hd - tw) * Math.sin(a)]; });
    const dome = revolve(fillet([[Rc, 0], [Rfl, 0, 1], [Rfl, fh, 1.5], ...outArc, ...inArc, [Rc, 0]].filter((p, i, a) => i === 0 || v3.dist([p[0], p[1], 0], [a[i - 1][0], a[i - 1][1], 0]) > 1e-6).slice(0, -1), { closed: true, steps: 3 }), { loop: true, segments: 72 });
    const portY = fh + hd * 0.42, portR = Rc * 0.16, portX = (Rc + tw) * Math.cos(Math.asin(0.42)) - 6;
    const stub = tubeShell([[portX, portY, 0], [Rfl + Rc * 0.08, portY, 0]], portR, portR * 0.85, { segments: 24 });
    const stubFl = mesh.transform(flange({ pipe: portR, bore: portR * 0.85 }), aim([Rfl + Rc * 0.08, portY, 0], [1, 0, 0]));
    const boss = revolve(fillet([[0, fh + hd - 8], [Rc * 0.36, fh + hd - 14, 4], [Rc * 0.36, fh + hd + 10, 2], [0, fh + hd + 10]]), { segments: 48 });
    const domeBolts = boltCircle(24, (Rc + tw + Rfl) / 2 + 2, { d: Math.max(4, fh * 0.42), y: fh, grip: fh + ti + CI.flangeHeight, nuts: true });
    A.part("LOX dome", merge(dome, stub, boss), { parent: eng, position: [0, domeY, 0], material: M("dome", "steel"), explode: [0, 0.24 * H, 0], label: { text: "oxidizer dome", at: [Rc * 0.5, fh + hd * 0.9, 0] }, note: "a manifold that spreads liquid oxygen across the back of the injector" });
    A.part("dome flanges", merge(stubFl, domeBolts), { parent: eng, position: [0, domeY, 0], material: M("flange", "steel"), explode: [0, 0.24 * H, 0] });
    const apex = domeY + fh + hd + 10;
    // Gimbal and frame.
    const s = o.gimbalSize ?? Rc * 0.24, pivot = apex + 1.75 * s;
    const gim = gimbal({ size: s, material: M("gimbal", "steel") });
    A.part("gimbal", gim, { position: [0, pivot, 0], explode: [0, 0.34 * H, 0], label: { text: "gimbal", at: [s * 1.3, 0, 0] }, note: "a universal joint: the whole engine tilts on it to steer the rocket" });
    A.gimbalNode = gim;
    const yF = pivot + 1.75 * s + Rc * 1.15, RF = Rc * 1.9;
    const ring = revolve(fillet([[RF - Rc * 0.13, yF - Rc * 0.09, 2], [RF + Rc * 0.13, yF - Rc * 0.09, 2], [RF + Rc * 0.13, yF + Rc * 0.09, 2], [RF - Rc * 0.13, yF + Rc * 0.09, 2]], { closed: true }), { loop: true, segments: 96 });
    const struts = [], plateY = pivot + 1.55 * s;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + Math.PI / 6, p = cyl(s * 1.45, a, plateY);
      for (const d of [-0.36, 0.36]) struts.push(strut(p, cyl(RF, a + d, yF - Rc * 0.09), { radius: Rc * 0.045 }));
    }
    const actA = [Math.PI / 4, (3 * Math.PI) / 4];
    const lugs = actA.map(a => xf(mesh.box(Rc * 0.22, Rc * 0.2, Rc * 0.22, { round: 3 }), T(cyl(RF, a, yF - Rc * 0.17))));
    A.part("thrust frame", merge(ring, struts, lugs), { material: M("frame", "titanium"), explode: [0, 0.48 * H, 0], label: { text: "thrust frame", at: cyl(RF + Rc * 0.13, Math.PI * 1.75, yF) }, note: "carries the thrust into the rocket; the engine hangs from it" });
    // Actuator brackets on the chamber, actuators from the frame to them.
    const attachY = top - CI.cylinder * 0.45 - yT * 0 , attachR = Rc + CI.wall + Rc * 0.24;
    const brk = actA.map(a => merge(xf(mesh.box(Rc * 0.28, Rc * 0.34, Rc * 0.12, { round: 3 }), T(cyl(Rc + CI.wall + Rc * 0.1, a, attachY)), RY(a)), xf(mesh.box(Rc * 0.12, Rc * 0.24, Rc * 0.22, { round: 2 }), T(cyl(attachR, a, attachY)), RY(a))));
    A.part("actuator brackets", merge(brk), { parent: eng, material: M("chamber", "inconel") });
    const anchors = actA.map(a => cyl(RF, a, yF - Rc * 0.24)), attach = actA.map(a => cyl(attachR, a, attachY));
    const Lc = v3.dist(anchors[0], attach[0]), acts = [];
    actA.forEach((a, i) => {
      const act = actuator({ name: i ? "yaw actuator" : "pitch actuator", bore: Rc * 0.17, length: Lc - Rc * 0.25, stroke: Rc * 0.5, material: M("actuator", "steel"), rodMaterial: "brushed" });
      acts.push(A.part(i ? "yaw actuator" : "pitch actuator", act, { label: { text: i ? "actuator" : "actuator", at: [0, Lc * 0.4, 0] }, note: "pushes or pulls on the chamber to tilt the engine" }));
    });
    // Turbopumps: oxidizer at +x, fuel at -x (turned half a turn so its discharge faces +z).
    const R2 = o.pumpSize ?? Rc * 0.5;
    const yP = yT + CI.top * 0.5, pR = Rc + CI.wall + R2 * 1.9;
    const ox = turbopump({ name: "oxidizer turbopump", impeller: R2, materials: o.materials, plain: o.plain });
    const fu = turbopump({ name: "fuel turbopump", impeller: R2 * 0.92, materials: o.materials, plain: o.plain });
    A.part("oxidizer turbopump", ox, { parent: eng, position: [pR, yP, 0], explode: [0.3 * H, 0, 0], label: { text: "oxidizer pump", at: [R2 * 1.2, R2 * 0.3, R2 * 0.6] }, note: "pumps liquid oxygen up to chamber pressure" });
    A.part("fuel turbopump", fu, { parent: eng, position: [-pR, yP, 0], rotation: [0, Math.PI, 0], explode: [-0.3 * H, 0, 0], label: { text: "fuel pump", at: [R2 * 1.2, R2 * 0.3, R2 * 0.6] }, note: "pumps fuel, which cools the nozzle on its way to the injector" });
    A.pumps = [ox, fu];
    A.shafts = [ox.rotor, fu.rotor];
    // Positions in engine coordinates of points on the pumps.
    const at = (pump, p, flipX) => v3.add(flipX ? [-p[0], p[1], -p[2]] : p, [flipX ? -pR : pR, yP, 0]);
    const lp = (pump, name, flipX) => at(pump, pump.portLocal(name).center, flipX);
    const oxEx = lp(ox, "discharge"), fuEx = lp(fu, "discharge", true);
    const pr = R2 * 0.36 * 1.18;
    // Oxidizer discharge to the dome inlet, through the main oxidizer valve.
    const domePort = [Rfl + Rc * 0.08, domeY + portY, 0];
    const oxPipe = pipe([oxEx, v3.add(oxEx, [0, 0, -R2 * 0.6]), [oxEx[0], domeY + portY, oxEx[2] - R2 * 0.6], [oxEx[0], domeY + portY, 0], domePort.map((v, i) => (i === 0 ? v + 0.01 : v))], { radius: pr, bend: pr * 2.4, name: "oxidizer line", material: M("pipe", "brushed"), flanges: false });
    A.part("oxidizer line", oxPipe, { parent: eng, explode: [0.18 * H, 0.04 * H, 0], label: { text: "oxidizer line", at: [oxEx[0], (oxEx[1] + domeY + portY) / 2, oxEx[2] - R2 * 0.6] }, note: "high-pressure oxidizer from the pump to the dome" });
    // Fuel discharge down to the regen manifold on the nozzle.
    const mY = yT + noz.manifoldY - Rt * 0.07, mR = noz.outerRadiusAt(noz.manifoldY) + Rt * 0.2;
    const fuelIn = [-(mR + Rt * 0.35), mY, 0];
    const stubM = tubeShell([[-(mR - 4), mY, 0], fuelIn], pr, pr * 0.85, { segments: 24 });
    A.part("manifold inlet", merge(stubM, mesh.transform(flange({ pipe: pr, bore: pr * 0.85 }), aim(fuelIn, [-1, 0, 0]))), { parent: eng, material: M("manifold", "steel"), explode: [0, -0.32 * H, 0] });
    const fuPipe = pipe([fuEx, v3.add(fuEx, [0, 0, R2 * 0.7]), [fuEx[0] - R2 * 0.3, mY + R2, fuEx[2] + R2 * 0.7], [fuelIn[0] - R2 * 0.3, mY, fuEx[2] + R2 * 0.7], [fuelIn[0] - R2 * 0.3, mY, 0], fuelIn], { radius: pr, bend: pr * 2.6, name: "fuel line", material: M("pipe", "brushed"), flanges: "end" });
    A.part("fuel line", fuPipe, { parent: eng, explode: [-0.18 * H, -0.1 * H, 0], label: { text: "fuel line", at: [fuEx[0] - R2 * 0.3, (fuEx[1] + mY) / 2, fuEx[2] + R2 * 0.7] }, note: "fuel runs to the nozzle manifold, then up through the tubes to cool the wall" });
    // Main valves sit on the vertical runs.
    const mov = valve({ pipe: pr, name: "main oxidizer valve" });
    A.part("main oxidizer valve", mov, { parent: eng, position: [oxEx[0], (oxEx[1] + domeY + portY) / 2 + R2 * 0.2, oxEx[2] - R2 * 0.6], rotation: [0, -Math.PI / 2, 0], explode: [0.18 * H, 0.04 * H, 0], label: "main oxidizer valve", note: "opens to start the engine and closes to shut it down" });
    const mfv = valve({ pipe: pr, name: "main fuel valve" });
    A.part("main fuel valve", mfv, { parent: eng, position: [fuEx[0] - R2 * 0.3 * 0.5, lerp(fuEx[1], mY + R2, 0.45), fuEx[2] + R2 * 0.7], rotation: [0, Math.PI / 2, 0], explode: [-0.18 * H, -0.1 * H, 0], label: "main fuel valve", note: "lets fuel through to the cooling tubes" });
    // Gas generator at -z, feeding both turbines.
    const gR = Rc + CI.wall + R2 * 1.25, tinO = lp(ox, "turbineInlet"), tinF = lp(fu, "turbineInlet", true);
    const gy = tinO[1] + R2 * 1.1, gr = R2 * 0.42;
    const gg = revolve(fillet([[0, gy + gr * 2.6], [gr * 0.5, gy + gr * 2.6, 2], [gr, gy + gr * 2.1, gr * 0.5], [gr, gy + gr * 0.2, 3], [gr * 0.55, gy - gr * 0.6, 3], [gr * 0.55, gy - gr * 1.2], [0, gy - gr * 1.2]]), { segments: 40 });
    const ggN = A.part("gas generator", xf(gg, T([0, 0, -gR])), { parent: eng, material: M("gasGenerator", "inconel"), explode: [0, 0, -0.32 * H], label: { text: "gas generator", at: [gr, gy + gr, -gR] }, note: "burns a little propellant fuel-rich to make the gas that drives the turbines" });
    const ggOut = [0, gy - gr * 1.2, -gR], rd = R2 * 0.17;
    const ducts = [tinO, tinF].map(tp => pipe([ggOut, [0, tp[1], -gR], [tp[0] * 0.55, tp[1], -gR], [tp[0], tp[1], tp[2] - R2 * 0.55], v3.add(tp, [0, 0, -0.01])], { radius: rd, bend: rd * 2.5, name: "hot gas duct", material: M("hotDuct", "inconel"), flanges: "end" }));
    A.part("hot gas ducts", ducts[0], { parent: eng, explode: [0, 0, -0.22 * H] });
    A.part("hot gas ducts 2", ducts[1], { parent: eng, explode: [0, 0, -0.22 * H] });
    // Turbine exhaust: a duct from each turbine down beside the nozzle, ending in a small flared exit.
    const exs = [];
    for (const [pump, flipX] of [[ox, false], [fu, true]]) {
      const e = lp(pump, "exhaust", flipX), sgn = flipX ? -1 : 1, er = pump.portLocal("exhaust").radius + R2 * 0.075;
      const yEnd = yT - Ln * 0.42, xEnd = sgn * (noz.outerRadiusAt(-Ln * 0.42) + er * 2.6);
      const p = pipe([e, [e[0], e[1] - R2 * 0.6, 0], [xEnd, yEnd + R2 * 1.2, 0], [xEnd, yEnd, 0]], { radius: er, bend: er * 3, flanges: "start", name: "turbine exhaust", material: M("exhaust", "inconel") });
      const flare = revolve(fillet([[er - 1.5, 0], [er, 0], [er * 1.6, -er * 1.4, 3], [er * 1.6 - 2, -er * 1.4], [er - 3.5, 0]].map(q => [q[0], q[1]])), { loop: true, segments: 40 });
      exs.push(p, flare);
      A.part(flipX ? "fuel turbine exhaust" : "oxidizer turbine exhaust", p, { parent: eng, explode: [sgn * 0.3 * H, 0, 0], label: flipX ? undefined : { text: "turbine exhaust", at: [xEnd, yEnd + R2, 0] }, note: "spent turbine gas dumps overboard here" });
      A.part(flipX ? "fuel exhaust exit" : "oxidizer exhaust exit", flare, { parent: eng, position: [xEnd, yEnd, 0], material: M("exhaust", "inconel"), explode: [sgn * 0.3 * H, 0, 0] });
    }
    // Feed lines from the vehicle interface (top) to the pump inlets, each with a bellows.
    const feeds = [];
    for (const [pump, flipX, nm] of [[ox, false, "oxidizer feed"], [fu, true, "fuel feed"]]) {
      const pin = lp(pump, "inlet", flipX), r = pump.portLocal("inlet").radius + R2 * 0.075;
      const yb = yF - Rc * 0.1, bl = Rc * 0.4;
      const p = pipe([pin, [pin[0], yb - bl - R2 * 0.05, 0]], { radius: r, flanges: "start", name: nm, material: M("pipe", "brushed") });
      const bel = bellows({ radius: r * 1.02, length: bl, convolutions: 9 });
      const topFl = flange({ pipe: r, bore: r * 0.85 });
      const node = A.part(nm, p, { parent: eng, explode: [(flipX ? -1 : 1) * 0.3 * H, 0.1 * H, 0], label: { text: flipX ? "fuel inlet" : "oxidizer inlet", at: [pin[0], yb - bl * 1.6, 0] }, note: "propellant arrives from the tank through this line" });
      A.part(`${nm} bellows`, merge(xf(bel, T([pin[0], yb - bl, 0])), xf(topFl, T([pin[0], yb, 0]))), { parent: eng, material: M("bellows", "steel"), explode: [(flipX ? -1 : 1) * 0.3 * H, 0.14 * H, 0] });
      feeds.push(node);
      A.port(flipX ? "fuelInlet" : "oxidizerInlet", eng, [pin[0], yb, 0], [0, 1, 0], r);
    }
    // A small harness from the frame down to the gas generator igniter.
    const hz = harness([[0, yF - Rc * 0.2, -RF * 0.8], [0, pivot, -Rc * 1.5], [R2 * 0.3, gy + gr * 4, -gR - R2 * 0.3], [0, gy + gr * 2.65, -gR]], { wires: 7, wire: Math.max(1.2, Rc * 0.012), ties: 5 });
    A.part("harness", hz, { parent: eng, explode: [0, 0.1 * H, -0.3 * H], note: "wires for the igniter and the valve sensors" });
    A.port("nozzleExit", A.parts["nozzle"], [0, -Ln, 0], [0, -1, 0], C.exit);
    A.info = { throat: Rt, exit: C.exit, expansion: eps, nozzleLength: Ln, chamberRadius: Rc, height: yF + Rc * 0.1, pivot, thetaN: C.thetaN, thetaE: C.thetaE };
    const st = { pitch: 0, yaw: 0, spin: 0, fuelSpin: null };
    A.gimbal = { pitch: 0, yaw: 0, range: o.gimbalRange ?? 6 * DEG };
    A.onPose = p => {
      Object.assign(st, p);
      const lim = A.gimbal.range, pitch = clamp(st.pitch, -lim, lim), yaw = clamp(st.yaw, -lim, lim);
      A.gimbal.pitch = pitch; A.gimbal.yaw = yaw;
      const Mg = mul(T([0, pivot, 0]), RX(pitch), RZ(yaw), T([0, -pivot, 0]));
      eng.matrix = Mg;
      gim.set2(pitch, yaw);
      const e = A.exploded, fOff = [0, 0.48 * H * e, 0];
      acts.forEach((act, i) => act.span(v3.add(anchors[i], fOff), m4.apply(Mg, attach[i])));
      ox.pose({ spin: st.spin });
      fu.pose({ spin: st.fuelSpin ?? st.spin * 1.35 });
    };
    const baseExplode = A.explode;
    A.explode = t => { baseExplode(t); A.onPose({}); return A; };
    A.onPose({});
    return A;
  }

  // ---------- turbofan ----------
  // A two-spool high-bypass turbofan, axis along +x (flow left to right), fan face at x = 0.
  // Static casings can be shown with a quarter cut away; the low spool (spinner, fan,
  // booster, LP shaft, LP turbine) and the high spool (HP compressor, HP shaft, HP turbine)
  // turn independently. pose({ low, high }) sets their angles in radians.
  function turbofan(o = {}) {
    const A = assembly(o.name ?? "turbofan", o), M = (r, f) => matFor(o, r, f);
    const Rf = o.fanRadius ?? 900, k = Rf / 900;
    const cutStart = o.cutStart ?? Math.PI * 1.5, cutArc = TAU * 0.75;
    // The engine is modeled about local y (flow +y) and turned so local y becomes world x.
    const axis = A.group("axis", { matrix: RZ(-Math.PI / 2) });
    const cases = [];
    // A static revolved part, built whole and with the cutaway wedge removed.
    const shell = (name, profile, opts = {}) => {
      const g = A.part(name, null, { parent: opts.parent || axis, explode: opts.explode, label: opts.label, note: opts.note });
      const full = g.add(revolve(profile, { loop: true, segments: opts.segments ?? 96 }), { name, material: opts.material });
      const cut = g.add(revolve(profile, { loop: true, segments: Math.round((opts.segments ?? 96) * 0.75), arc: cutArc, start: cutStart }), { name, material: opts.material, visible: false });
      cases.push([full, cut]);
      return g;
    };
    const low = A.group("low spool", { parent: axis }), high = A.group("high spool", { parent: axis });
    A.spools = { low, high };
    // ---- flowpath (mm at a 900 mm fan radius) ----
    const s = v => v * k;
    // Core flowpath stations: [y, hub, tip].
    const core = [[300, 338, 440], [360, 345, 432], [640, 352, 410], [720, 300, 365], [800, 232, 300], [840, 222, 292], [1340, 222, 244], [1390, 230, 250]].map(r => r.map(s));
    const coreAt = (y, i) => { for (let j = 1; j < core.length; j++) if (core[j][0] >= y) { const a = core[j - 1], b = core[j]; return lerp(a[i], b[i], (y - a[0]) / (b[0] - a[0])); } return core[core.length - 1][i]; };
    const hubAt = y => coreAt(y, 1), tipAt = y => coreAt(y, 2);
    // ---- nacelle and fan case ----
    const P = nacelleProfile({ fan: Rf });
    shell("nacelle", P.loop, { material: M("nacelle", "porcelain"), segments: 128, explode: [0, -s(1500), 0], label: { text: "nacelle", at: cyl(P.Rmax, Math.PI * 0.62, s(-100)) }, note: "the smooth outer cowl; its lip and inlet slow the air before the fan" });
    const caseProf = fillet([[P.Rc, P.yCF], [P.Rco, P.yCF], [P.Rco, P.yCR], [P.ductR, P.yCR], [P.ductR, s(260), s(30)], [P.Rc, s(200), s(20)]], { steps: 3 });
    shell("fan case", caseProf, { material: M("fanCase", "aluminum"), segments: 128, explode: [0, -s(1500), 0], label: { text: "fan case", at: cyl(P.Rc, Math.PI * 0.85, s(-150)) }, note: "a thick ring around the fan that would contain a broken blade" });
    // ---- spinner, fan, fan disk ----
    const hubR = s(275), yS = s(-420);
    const sp = spinner({ radius: hubR, length: s(380), shape: "ellipse", back: s(10) });
    A.part("spinner", sp, { parent: low, position: [0, yS, 0], material: M("spinner", "porcelain"), explode: [0, -s(1100), 0], label: { text: "spinner", at: [hubR * 0.5, s(200), 0] }, note: "a nose cone that guides air smoothly onto the fan blade roots" });
    const fanHub = revolve(fillet([[0, s(-40)], [hubR, s(-40)], [s(300), s(80), s(80)], [s(338), s(240)], [s(338), s(300)], [s(120), s(300)], [s(120), s(200)], [0, s(200)]], { steps: 4 }), { segments: 96 });
    A.part("fan disk", fanHub, { parent: low, material: M("fanDisk", "titanium"), explode: [0, -s(900), 0], note: "holds the fan blades by their dovetail roots" });
    const fan = rotorStage({
      name: "fan", blades: o.fanBlades ?? 18, hub: s(292), tip: Rf - s(3), y: s(40), hubSlope: 0.18, embed: s(14),
      chord: [s(300), s(380), s(445)], stagger: [24, 44, 61], camber: [0.075, 0.05, 0.028], thickness: [0.1, 0.06, 0.032],
      sweep: t => s(70) * t * t, lean: t => s(-30) * t * t, stations: 13, points: 16, disk: false, material: M("fanBlades", "titanium"),
    });
    A.part("fan", fan, { parent: low, explode: [0, -s(900), 0], label: { text: "fan blades", at: cyl(Rf * 0.75, Math.PI * 0.3, s(60)) }, note: `${o.fanBlades ?? 18} wide-chord blades; the fan makes most of the thrust` });
    // ---- splitter, core cowl, OGVs ----
    const yE = P.yE, cowl = [];
    for (let i = 0; i <= 30; i++) { const u = i / 30, y = lerp(s(300), s(2420), u); cowl.push([s(440) + s(125) * Math.sin(Math.min(1, u / 0.3) * Math.PI / 2) - s(150) * sstep(0.3, 1, u), y]); }
    const cowlIn = cowl.slice(3).map(([r, y]) => [r - s(16), y]).reverse();
    const splitIn = [[tipAt(s(640)) + 1, s(640)], [tipAt(s(360)) + 1, s(360)], [s(434), s(304)]];
    shell("core cowl", fillet([...cowl, [cowl[30][0] - s(14), s(2420)], ...cowlIn.filter(p => p[1] > s(700)), [s(400), s(700)], ...splitIn], { closed: false, steps: 2 }), { material: M("coreCowl", "porcelain"), segments: 96, explode: [0, s(250), 0], label: { text: "core cowl", at: cyl(s(560), Math.PI * 0.7, s(1200)) }, note: "the inner wall of the bypass duct; the core engine is inside it" });
    const cowlR = y => { for (let i = 1; i < cowl.length; i++) if (cowl[i][1] >= y) return lerp(cowl[i - 1][0], cowl[i][0], (y - cowl[i - 1][1]) / (cowl[i][1] - cowl[i - 1][1])); return cowl[30][0]; };
    const ogv = statorStage({ name: "outlet guide vanes", vanes: o.ogvs ?? 44, inner: cowlR(s(640)), outer: P.ductR, y: s(640), chord: s(170), stagger: -8, camber: 0.06, thickness: 0.08, innerSlope: (cowlR(s(700)) - cowlR(s(580))) / s(120), bands: false, material: M("ogv", "aluminum") });
    A.part("outlet guide vanes", ogv, { parent: axis, explode: [0, s(250), 0], label: { text: "outlet guide vanes", at: cyl(s(760), Math.PI * 0.25, s(640)) }, note: "fixed vanes that straighten the swirling bypass air" });
    // ---- booster (low-pressure compressor) ----
    const boost = [];
    [[360, 64, "s"], [410, 52, "r"], [455, 72, "s"], [500, 56, "r"], [545, 76, "s"], [590, 60, "r"], [630, 80, "s"]].forEach(([y, n, kind], i) => {
      const yy = s(y), hb = hubAt(yy), tp = tipAt(yy), sl = (tipAt(yy + 10) - tipAt(yy - 10)) / 20, hl = (hubAt(yy + 10) - hubAt(yy - 10)) / 20;
      if (kind === "r") boost.push(A.part(`booster rotor ${i}`, rotorStage({ name: "booster", blades: n, hub: hb, tip: tp - 1.5, y: yy, chord: [s(42), s(38)], stagger: [35, 48], hubSlope: hl, tipSlope: sl, diskWidth: s(30), bore: s(150), material: M("compressor", "titanium") }), { parent: low, explode: [0, -s(500), 0] }));
      else boost.push(A.part(`booster stator ${i}`, statorStage({ name: "booster stator", vanes: n, inner: hb, outer: tp, y: yy, chord: s(36), stagger: -25, innerSlope: hl, outerSlope: sl, material: M("compressor", "titanium") }), { parent: axis, explode: [0, -s(500), 0] }));
    });
    A.parts["booster"] = boost[1];
    A.part("booster label", null, { parent: axis, label: { text: "booster", at: cyl(s(400), Math.PI * 0.75, s(500)) }, note: "a few low-pressure compressor stages on the fan shaft" });
    // ---- core casings: transition duct, HPC case, combustor case, turbine case ----
    const caseIn = [], caseT = s(14);
    for (let i = 0; i <= 24; i++) { const y = lerp(s(640), s(1390), i / 24); caseIn.push([tipAt(y) + 1, y]); }
    shell("compressor case", [...caseIn, ...caseIn.slice().reverse().map(([r, y]) => [r + caseT, y])], { material: M("compressorCase", "steel"), segments: 80, explode: [0, s(120), 0], note: "the casing around the compressor; its inner wall sits just clear of the blade tips" });
    // Flanges and a bleed manifold on the HP compressor case.
    const cf = [s(830), s(1050), s(1250)].map(y => collar(yy => tipAt(yy) + caseT, y - s(8), y + s(8), s(16), { segments: 72 }));
    const bleed = xf(mesh.torus(tipAt(s(1150)) + caseT + s(28), s(20), { segments: 72, tube: 12 }), T([0, s(1150), 0]));
    A.part("case flanges", merge(cf, bleed), { parent: axis, material: M("compressorCase", "steel"), explode: [0, s(120), 0] });
    // Inner wall of the transition duct (static).
    const ductIn = []; for (let i = 0; i <= 12; i++) { const y = lerp(s(640), s(820), i / 12); ductIn.push([hubAt(y) - 1, y]); }
    shell("transition duct", [...ductIn, ...ductIn.slice().reverse().map(([r, y]) => [r - s(12), y])], { material: M("compressorCase", "steel"), segments: 72, explode: [0, s(120), 0] });
    // ---- HP compressor ----
    const hpcN = [38, 44, 50, 56, 60, 64, 68, 72, 76];
    hpcN.forEach((n, i) => {
      const yr = s(850 + i * 54), ys = yr + s(27), sl = (tipAt(yr + 10) - tipAt(yr - 10)) / 20;
      A.part(`hpc rotor ${i + 1}`, rotorStage({ name: "high-pressure compressor", blades: n, hub: hubAt(yr), tip: tipAt(yr) - 1, y: yr, chord: [s(30 - i * 1.4), s(26 - i * 1.2)], stagger: [38, 52], tipSlope: sl, diskWidth: s(22), bore: s(118), material: M("compressor", "titanium") }), { parent: high, explode: [0, s(120), 0] });
      A.part(`hpc stator ${i + 1}`, statorStage({ name: "hpc stator", vanes: Math.round(n * 1.3), inner: hubAt(ys), outer: tipAt(ys), y: ys, chord: s(24 - i), stagger: -28, outerSlope: sl, material: M("compressor", "titanium") }), { parent: axis, explode: [0, s(120), 0] });
    });
    A.parts["high-pressure compressor"] = A.parts["hpc rotor 1"];
    const drum = []; for (let i = 0; i <= 10; i++) { const y = lerp(s(830), s(1330), i / 10); drum.push([hubAt(y) - s(1.5), y]); }
    A.part("hpc drum", revolve([...drum, ...drum.slice().reverse().map(([r, y]) => [r - s(8), y])], { loop: true, segments: 72 }), { parent: high, material: M("compressor", "titanium"), explode: [0, s(120), 0] });
    A.part("hpc label", null, { parent: axis, label: { text: "high-pressure compressor", at: cyl(s(260), Math.PI * 0.75, s(1100)) }, note: "nine stages squeeze the core air about 20 times" });
    // ---- combustor ----
    const yC0 = s(1400), yC1 = s(1640);
    shell("combustor case", fillet([[s(250), yC0 - s(20)], [s(372), s(1440), s(30)], [s(372), yC1 + s(20), s(10)], [s(330), yC1 + s(40)], [s(330) - s(12), yC1 + s(40)], [s(360), yC1 + s(20)], [s(360), s(1450), s(20)], [s(250), yC0 - s(8)]], { closed: true, steps: 3 }), { material: M("combustorCase", "steel"), explode: [0, s(300), 0], note: "the pressure casing around the combustor" });
    const step = (r0, r1, sgn) => { const pts = []; for (let i = 0; i < 6; i++) { const y = lerp(s(1440), yC1, i / 6), y2 = lerp(s(1440), yC1, (i + 1) / 6), r = lerp(r0, r1, i / 6), r2 = lerp(r0, r1, (i + 1) / 6); pts.push([r, y], [r2 + sgn * s(4), y2 - s(6)], [r2, y2 - s(2)]); } return pts; };
    const outerLiner = step(s(322), s(302), 1), innerLiner = step(s(232), s(258), -1);
    const linerT = s(4);
    A.part("combustor", merge(
      revolve([...outerLiner, ...outerLiner.slice().reverse().map(([r, y]) => [r + linerT, y])], { loop: true, segments: 72, crease: 50 }),
      revolve([...innerLiner, ...innerLiner.slice().reverse().map(([r, y]) => [r - linerT, y])], { loop: true, segments: 72, crease: 50 }),
      revolve(fillet([[s(232), s(1440)], [s(250), s(1405), s(14)], [s(305), s(1405), s(14)], [s(322), s(1440)], [s(322) + linerT, s(1440)], [s(305), s(1405) - linerT, s(14)], [s(250), s(1405) - linerT, s(14)], [s(232) - linerT, s(1440)]], { closed: true, steps: 3 }), { loop: true, segments: 96 }),
    ), { parent: axis, material: M("combustor", "inconel"), explode: [0, s(300), 0], label: { text: "combustor", at: cyl(s(320), Math.PI * 0.75, s(1540)) }, note: "an annular chamber where fuel burns in the compressed air" });
    const nozzleStem = revolve(fillet([[0, 0], [s(14), 0], [s(14), s(70)], [s(9), s(80)], [s(9), s(118)], [s(16), s(122)], [s(16), s(134)], [0, s(134)]]), { segments: 14 });
    const nzz = Array.from({ length: o.fuelNozzles ?? 20 }, (_, i) => xf(nozzleStem, RY((i / (o.fuelNozzles ?? 20)) * TAU), T([s(395), s(1415), 0]), RZ(Math.PI / 2 + 0.25)));
    A.part("fuel nozzles", merge(nzz), { parent: axis, material: M("fuelNozzles", "steel"), explode: [0, s(300), 0], label: { text: "fuel nozzles", at: cyl(s(380), Math.PI * 0.62, s(1420)) }, note: "spray fuel into the front of the combustor" });
    // ---- turbines ----
    const turb = [[1655, 255, 300, "s", 40], [1695, 255, 302, "r", 72], [1740, 258, 312, "s", 44], [1780, 258, 318, "r", 76]];
    turb.forEach(([y, h, t, kind, n], i) => {
      const yy = s(y);
      if (kind === "r") A.part(`hpt rotor ${i}`, rotorStage({ name: "high-pressure turbine", blades: n, hub: s(h), tip: s(t) - 1, y: yy, chord: [s(30), s(28)], stagger: [-30, -40], camber: [0.12, 0.1], thickness: [0.16, 0.12], hand: -1, diskWidth: s(34), bore: s(110), material: M("turbine", "inconel") }), { parent: high, explode: [0, s(450), 0] });
      else A.part(`hpt nozzle ${i}`, statorStage({ name: "hpt nozzle", vanes: n, inner: s(h), outer: s(t), y: yy, chord: s(30), stagger: 40, camber: 0.12, thickness: 0.18, hand: 1, material: M("turbine", "inconel") }), { parent: axis, explode: [0, s(450), 0] });
    });
    A.parts["high-pressure turbine"] = A.parts["hpt rotor 1"];
    A.part("hpt label", null, { parent: axis, label: { text: "high-pressure turbine", at: cyl(s(300), Math.PI * 0.8, s(1720)) }, note: "two stages that drive the compressor through the HP shaft" });
    const lptHub = y => lerp(s(265), s(300), (y - s(1830)) / s(450)), lptTip = y => lerp(s(335), s(455), (y - s(1830)) / s(450));
    for (let i = 0; i < 5; i++) {
      const ys = s(1840 + i * 90), yr = ys + s(45), tsl = (lptTip(s(100)) - lptTip(0)) / s(100);
      A.part(`lpt nozzle ${i + 1}`, statorStage({ name: "lpt nozzle", vanes: 70 + i * 6, inner: lptHub(ys), outer: lptTip(ys), y: ys, chord: s(36), stagger: 38, camber: 0.1, thickness: 0.14, hand: 1, innerSlope: (lptHub(s(100)) - lptHub(0)) / s(100), outerSlope: tsl, material: M("turbine", "inconel") }), { parent: axis, explode: [0, s(700), 0] });
      A.part(`lpt rotor ${i + 1}`, rotorStage({ name: "low-pressure turbine", blades: 80 + i * 8, hub: lptHub(yr), tip: lptTip(yr) - 2, y: yr, chord: [s(34), s(30)], stagger: [-32, -46], camber: [0.1, 0.08], thickness: [0.12, 0.08], hand: -1, tipSlope: tsl, shroud: true, diskWidth: s(30), bore: s(70), material: M("turbine", "inconel") }), { parent: low, explode: [0, s(700), 0] });
    }
    A.parts["low-pressure turbine"] = A.parts["lpt rotor 1"];
    A.part("lpt label", null, { parent: axis, label: { text: "low-pressure turbine", at: cyl(lptTip(s(2100)), Math.PI * 0.8, s(2100)) }, note: "five stages that drive the fan through the LP shaft" });
    const tcase = []; for (let i = 0; i <= 16; i++) { const y = lerp(s(1640), s(2330), i / 16); tcase.push([(y < s(1820) ? s(322) + (y - s(1640)) * 0.05 : lptTip(y)) + 2, y]); }
    shell("turbine case", [...tcase, ...tcase.slice().reverse().map(([r, y]) => [r + s(14), y])], { material: M("turbineCase", "inconel"), segments: 96, explode: [0, s(600), 0], note: "the casing around both turbines" });
    // Turbine rear frame struts and the exhaust plug.
    const trf = statorStage({ name: "turbine rear frame", vanes: 12, inner: s(300), outer: s(460), y: s(2330), chord: s(60), stagger: 0, camber: 0, thickness: 0.16, material: M("turbineCase", "inconel") });
    A.part("turbine rear frame", trf, { parent: axis, explode: [0, s(850), 0] });
    const plug = revolve([[0, s(2860)], ...Array.from({ length: 16 }, (_, i) => { const u = 1 - i / 15; return [s(300) * Math.pow(u, 0.8), lerp(s(2300), s(2860), 1 - u)]; }).reverse().reverse(), [s(300), s(2300)], [0, s(2300)]].sort((a, b) => b[1] - a[1]).map(p => p), { segments: 72 });
    A.part("exhaust cone", plug, { parent: axis, material: M("exhaustCone", "inconel"), explode: [0, s(950), 0], label: { text: "exhaust cone", at: [s(150), s(2600), 0] }, note: "the plug that shapes the hot core exhaust" });
    // ---- shafts and bearings ----
    const lpS = shaft({ steps: [[s(200), s(110)], [s(2150), s(90)], [s(100), s(110)]], bore: s(60), segments: 32 });
    A.part("LP shaft", xf(lpS, T([0, s(150), 0])), { parent: low, material: M("shaft", "steel"), label: { text: "LP shaft", at: [0, s(1900), s(55)] }, note: "the inner shaft: LP turbine to fan, turning slower" });
    const hpS = shaft({ steps: [[s(60), s(236)], [s(940), s(200)], [s(60), s(220)]], bore: s(150), segments: 40 });
    A.part("HP shaft", xf(hpS, T([0, s(800), 0])), { parent: high, material: M("shaft", "steel"), label: { text: "HP shaft", at: [0, s(1450), s(100)] }, note: "the outer, hollow shaft: HP turbine to compressor, turning faster" });
    for (const [y, bore, outer, nm] of [[260, 55, 85, "No. 1 bearing"], [770, 118, 150, "No. 3 bearing"], [2250, 55, 85, "No. 5 bearing"]]) A.part(nm, bearing({ bore: s(bore), outer: s(outer), width: s(24), name: nm, segments: 40, ballSegments: 6 }), { parent: axis, position: [0, s(y), 0], explode: [0, y < 1000 ? -s(300) : s(600), 0] });
    // ---- pylon mounts, test stand ----
    const fwdMount = cyl(P.Rco, Math.PI, s(380)), aftMount = cyl(lptTip(s(2330)) + s(16), Math.PI, s(2330));
    A.mounts = { forward: () => axis.toWorld(fwdMount), aft: () => axis.toWorld(aftMount) };
    const lugs = merge(xf(mesh.box(s(70), s(60), s(90), { round: s(6) }), T(v3.add(fwdMount, [s(-20), 0, 0]))), xf(mesh.box(s(70), s(50), s(80), { round: s(6) }), T(v3.add(aftMount, [s(-20), 0, 0]))));
    A.part("engine mounts", lugs, { parent: axis, material: M("mount", "steel"), explode: [0, s(250), 0], note: "the forward and aft mounts take the thrust into the pylon" });
    // Accessory plumbing on the core: two pipes and a harness along the compressor case.
    const ra = y => tipAt(y) + caseT + s(45);
    const pipeA = pipe([cyl(ra(s(860)), Math.PI * 0.35, s(860)), cyl(ra(s(1150)), Math.PI * 0.35, s(1150)), cyl(s(330), Math.PI * 0.33, s(1700)), cyl(s(345), Math.PI * 0.33, s(2050))], { radius: s(10), bend: s(40), flanges: false, name: "bleed pipe", material: M("pipe", "brushed") });
    A.part("bleed pipe", pipeA, { parent: axis, explode: [0, s(250), 0] });
    const hz = harness([cyl(ra(s(850)), Math.PI * 1.18, s(850)), cyl(ra(s(1100)) + s(5), Math.PI * 1.2, s(1100)), cyl(s(400), Math.PI * 1.22, s(1500)), cyl(s(395), Math.PI * 1.2, s(1900))], { wires: 7, wire: s(2.4), ties: 6 });
    A.part("harness", hz, { parent: axis, explode: [0, s(250), 0], note: "sensor and control wiring" });
    if (o.testStand || o.pylon) {
      const top = P.Rmax, bx0 = s(-500), bx1 = s(2600), beamY = top + s(520);
      const st = A.group("test stand");
      const pyl = mesh.extrude([[s(150), top - s(40)], [s(1500), top - s(40)], [s(2300), lptTip(s(2330)) + s(10)], [s(2300), beamY - s(60)], [s(150), beamY - s(60)]], s(170), { bevel: s(20) });
      A.part("pylon", pyl, { parent: st, material: M("pylon", "porcelain"), label: { text: "pylon", at: [s(800), top + s(200), s(85)] }, note: "carries the engine's thrust and weight into the wing, or here the stand" });
      if (o.testStand) {
        const ground = -top - s(700);
        const col = (x, z) => xf(mesh.box(s(110), beamY - ground, s(110), { round: s(6) }), T([x, (beamY + ground) / 2, z]));
        const frame = merge(
          xf(mesh.box(bx1 - bx0, s(140), s(240), { round: s(8) }), T([(bx0 + bx1) / 2, beamY, 0])),
          col(bx0 + s(100), s(1050)), col(bx0 + s(100), s(-1050)), col(bx1 - s(100), s(1050)), col(bx1 - s(100), s(-1050)),
          xf(mesh.box(s(110), s(110), s(2210), { round: s(6) }), T([bx0 + s(100), beamY, 0])), xf(mesh.box(s(110), s(110), s(2210), { round: s(6) }), T([bx1 - s(100), beamY, 0])),
          strut([bx0 + s(100), ground + s(200), s(1050)], [bx0 + s(100), beamY - s(80), s(150)], { radius: s(26) }), strut([bx0 + s(100), ground + s(200), s(-1050)], [bx0 + s(100), beamY - s(80), s(-150)], { radius: s(26) }),
          strut([bx1 - s(100), ground + s(200), s(1050)], [bx1 - s(100), beamY - s(80), s(150)], { radius: s(26) }), strut([bx1 - s(100), ground + s(200), s(-1050)], [bx1 - s(100), beamY - s(80), s(-150)], { radius: s(26) }),
        );
        A.part("stand frame", frame, { parent: st, material: M("stand", "porcelain"), note: "a thrust stand: the engine hangs from a beam that measures its pull" });
        A.part("stand base", xf(mesh.box(bx1 - bx0 + s(400), s(60), s(2600), { round: s(10) }), T([(bx0 + bx1) / 2, ground - s(30), 0])), { parent: st, material: M("ground", "concrete") });
      }
    }
    // ---- ports ----
    A.port("inlet", axis, [0, P.yH, 0], [0, -1, 0], P.Rh);
    A.port("fanFace", axis, [0, s(-60), 0], [0, -1, 0], Rf, { inner: hubR });
    A.port("fanNozzle", axis, [0, yE, 0], [0, 1, 0], P.RE - P.te, { inner: cowlR(yE) });
    A.port("nozzle", axis, [0, s(2420), 0], [0, 1, 0], cowl[30][0] - s(16), { inner: s(300) * Math.pow(1 - (s(2420) - s(2300)) / s(560), 0.8) });
    const bypassArea = Math.PI * (P.ductR ** 2 - s(440) ** 2), coreArea = Math.PI * (s(440) ** 2 - s(338) ** 2);
    A.info = { fanRadius: Rf, hubRadius: hubR, splitter: s(440), coreHub: s(338), bypassArea, coreArea, bypassRatio: bypassArea / coreArea, length: s(2860) - P.yH, fanBlades: o.fanBlades ?? 18, maxRadius: P.Rmax };
    A.cutaway = (on = true) => { for (const [f, c] of cases) { f.visible = !on; c.visible = !!on; } return A; };
    if (o.cutaway) A.cutaway(true);
    A.onPose = p => { if (p.low != null) low.rotation = [0, p.low, 0]; if (p.high != null) high.rotation = [0, p.high, 0]; };
    return A;
  }

  // ---------- belts and chains ----------
  // A closed belt path around circles [{ c: [x, y], r, cw }] taken in travel order; cw: true
  // wraps clockwise (seen from +z). Returns { points (closed polyline, xy), length, arcs }.
  function beltPath(circles, { step = 4 } = {}) {
    const n = circles.length, tang = [];
    for (let i = 0; i < n; i++) {
      const A0 = circles[i], B0 = circles[(i + 1) % n];
      const d = [B0.c[0] - A0.c[0], B0.c[1] - A0.c[1]], L = Math.hypot(d[0], d[1]), e = [d[0] / L, d[1] / L], ep = [-e[1], e[0]];
      let best = null;
      for (const sa of [1, -1]) for (const sb of [1, -1]) {
        const cosA = (sa * A0.r - sb * B0.r) / L;
        if (Math.abs(cosA) > 1) continue;
        for (const sg of [1, -1]) {
          const sinA = sg * Math.sqrt(1 - cosA * cosA), nrm = [e[0] * cosA + ep[0] * sinA, e[1] * cosA + ep[1] * sinA];
          const pa = [A0.c[0] + sa * A0.r * nrm[0], A0.c[1] + sa * A0.r * nrm[1]], pb = [B0.c[0] + sb * B0.r * nrm[0], B0.c[1] + sb * B0.r * nrm[1]];
          const t = [pb[0] - pa[0], pb[1] - pa[1]];
          const vel = (C, p, cw) => { const rx = p[0] - C.c[0], ry = p[1] - C.c[1]; return cw ? [ry, -rx] : [-ry, rx]; };
          const va = vel(A0, pa, A0.cw), vb = vel(B0, pb, B0.cw);
          if (va[0] * t[0] + va[1] * t[1] > 0 && vb[0] * t[0] + vb[1] * t[1] > 0) best = { pa, pb };
        }
      }
      tang.push(best || { pa: A0.c, pb: B0.c });
    }
    const pts = [], arcs = [];
    let length = 0;
    for (let i = 0; i < n; i++) {
      const C = circles[i], arrive = tang[(i - 1 + n) % n].pb, leave = tang[i].pa;
      const a0 = Math.atan2(arrive[1] - C.c[1], arrive[0] - C.c[0]);
      let da = Math.atan2(leave[1] - C.c[1], leave[0] - C.c[0]) - a0;
      if (C.cw) { while (da > 0) da -= TAU; } else { while (da < 0) da += TAU; }
      const m = Math.max(2, Math.ceil((Math.abs(da) * C.r) / step));
      for (let k = 0; k < m; k++) { const a = a0 + (da * k) / m; pts.push([C.c[0] + C.r * Math.cos(a), C.c[1] + C.r * Math.sin(a)]); }
      arcs.push({ start: length, angle: Math.abs(da) });
      length += Math.abs(da) * C.r;
      const L = Math.hypot(tang[i].pb[0] - leave[0], tang[i].pb[1] - leave[1]);
      const m2 = Math.max(1, Math.ceil(L / (step * 6)));
      for (let k = 0; k < m2; k++) pts.push([lerp(leave[0], tang[i].pb[0], k / m2), lerp(leave[1], tang[i].pb[1], k / m2)]);
      length += L;
    }
    return { points: pts, length, arcs, tangents: tang };
  }
  // A belt (flat band) along a closed xy path at z = 0: width along z, thickness outward.
  function belt(path2, { width = 20, thickness = 4 } = {}) {
    const P = path2.map(([x, y]) => [x, y, 0]), n = P.length, S = new Soup();
    let area = 0;
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1;
    const ring = P.map((p, i) => {
      const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      const nx = (ty / l) * sgn, ny = (-tx / l) * sgn;
      return [[p[0], p[1], -width / 2], [p[0] + nx * thickness, p[1] + ny * thickness, -width / 2], [p[0] + nx * thickness, p[1] + ny * thickness, width / 2], [p[0], p[1], width / 2]];
    });
    for (let i = 0; i < n; i++) { const A0 = ring[i], B0 = ring[(i + 1) % n]; for (let q = 0; q < 4; q++) { const q1 = (q + 1) % 4; S.quad(A0[q], B0[q], B0[q1], A0[q1]); } }
    return S.build({ crease: 50 });
  }

  // ---------- piston engine ----------
  // An inline four-stroke engine with double overhead cams and two valves per cylinder.
  // Crank axis along x at the origin, cylinders up (+y). Defaults are a 2.0 L inline four
  // (86 x 86 mm, 143 mm rods). pose({ crank }) sets the crank angle in radians; pistons,
  // rods, cams, and valves follow, with the cams at half crank speed.
  function pistonEngine(o = {}) {
    const A = assembly(o.name ?? "piston engine", o), M = (r, f) => matFor(o, r, f);
    const n = o.cylinders ?? 4, B = o.bore ?? 86, Sk = o.stroke ?? 86, L = o.rod ?? Sk * 1.66, r = Sk / 2;
    const pitch = o.spacing ?? B * 1.12, ch = B * 0.36, X = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
    const FO = { 1: [1], 2: [1, 2], 3: [1, 3, 2], 4: [1, 3, 4, 2], 5: [1, 2, 4, 5, 3], 6: [1, 5, 3, 6, 2, 4] }[n] || Array.from({ length: n }, (_, i) => i + 1);
    const firing = o.firingOrder ?? FO;
    const phase = X.map((_, i) => ((firing.indexOf(i + 1) * 720) / n) * DEG);
    const pinA = phase.map(p => -p);
    const yDeck = r + L + ch + 0.6, Hh = B * 0.95, yHead = yDeck + Hh, len = n * pitch + B * 0.32, W = B * 1.5;
    const yBlock0 = L - r - B * 0.3, yRail = -r - B * 0.55;
    // Block with bores, open crankcase, bulkheads, oil pan.
    const bores = X.map(x => circle2(B / 2, 48, x, 0));
    A.part("block", plate(roundRect2(len, W, B * 0.12, 4), yDeck - yBlock0, { holes: bores, y0: yBlock0, bevelSegments: 1 }), { material: M("block", "aluminum"), explode: [0, 0, 0], label: { text: "cylinder block", at: [X[0] - pitch * 0.4, (yDeck + yBlock0) / 2, W / 2] }, note: `${n} cylinders, ${B} mm across, bored straight through the block` });
    const cw = W * 1.12, inner = roundRect2(len - B * 0.16, cw - B * 0.16, B * 0.06, 3);
    const bulk = X.concat(X[n - 1] + pitch).map(x0 => x0 - pitch / 2).map(x => xf(mesh.extrude([[-cw / 2 + 2, yBlock0 + 1], [-cw / 2 + 2, yRail + 6], [-B * 0.42, yRail + 6], [-B * 0.42, -B * 0.32], [B * 0.42, -B * 0.32], [B * 0.42, yRail + 6], [cw / 2 - 2, yRail + 6], [cw / 2 - 2, yBlock0 + 1]], B * 0.16, { holes: [circle2(B * 0.31, 32, 0, 0)], bevel: 1 }), T([x, 0, 0]), RY(-Math.PI / 2)));
    A.part("crankcase", merge(plate(roundRect2(len, cw, B * 0.1, 4), yBlock0 - yRail, { holes: [inner], y0: yRail, bevelSegments: 1 }), bulk), { material: M("block", "aluminum"), label: { text: "crankcase", at: [X[n - 1] + pitch * 0.4, (yRail + yBlock0) / 2, cw / 2] }, note: "the lower block; bulkheads carry the main bearings" });
    const pan = merge(plate(roundRect2(len - 8, cw - 8, B * 0.1, 4), B * 0.55, { holes: [roundRect2(len - 18, cw - 18, B * 0.06, 3)], y0: yRail - B * 0.55, bevelSegments: 1 }), plate(roundRect2(len - 8, cw - 8, B * 0.1, 4), 3, { y0: yRail - B * 0.55 - 3, bevel: 1, bevelSegments: 1 }));
    A.part("oil pan", pan, { material: M("pan", "steel"), explode: [0, -B * 1.6, 0], label: { text: "oil pan", at: [0, yRail - B * 0.3, (cw - 8) / 2] }, note: "holds the oil the crank splashes and the pump draws up" });
    // Head and cam cover.
    A.part("cylinder head", xf(mesh.box(len, Hh, W * 0.98, { round: B * 0.05 }), T([0, yDeck + Hh / 2 + 0.3, 0])), { material: M("head", "aluminum"), explode: [0, B * 1.4, 0], label: { text: "cylinder head", at: [X[0] - pitch * 0.4, yDeck + Hh * 0.5, W * 0.49] }, note: "closes the cylinders; holds the valves, ports, and spark plugs" });
    // Valves: pent-roof, intake on +z, exhaust on -z, tilted 20 degrees.
    const tilt = (o.valveAngle ?? 20) * DEG, vz = B * 0.24;
    const dI = [0, Math.cos(tilt), Math.sin(tilt)], dE = [0, Math.cos(tilt), -Math.sin(tilt)];
    const seatY = yDeck + 1.2, Lv = Hh + B * 0.2, rb = B * 0.2, lift = o.valveLift ?? B * 0.11, half = 66 * DEG;
    const valveMesh = rv => revolve(fillet([[0, 0], [rv, 0], [rv, 1.2], [rv - 2.2, 3.4, 1], [B * 0.045, rv * 0.95, rv * 0.5], [B * 0.045, Lv - 6], [B * 0.036, Lv - 5], [B * 0.036, Lv - 3], [B * 0.045, Lv - 2], [B * 0.045, Lv], [0, Lv]], { steps: 3 }), { segments: 24 });
    const vI = valveMesh(B * 0.21), vE = valveMesh(B * 0.18);
    const rs = B * 0.13, springL = Hh * 0.42;
    const spr = spring({ radius: rs, wire: B * 0.035, length: springL, coils: 6.5 });
    const bucketH = B * 0.24, bucketR = B * 0.16;
    const bucket = revolve(fillet([[0, 0], [bucketR - 1, 0], [bucketR, 1], [bucketR, bucketH - 1], [bucketR - 1, bucketH], [0, bucketH]]), { segments: 24 });
    const retainer = revolve([[B * 0.045, 0], [rs + 2, 0], [rs + 2, 2], [B * 0.08, 6], [B * 0.045, 6]], { loop: true, segments: 20 });
    const camAxis = d => v3.add([0, seatY, 0], v3.scale(d, Lv + bucketH + rb + 1));
    const camI = v3.add(camAxis(dI), [0, 0, vz]), camE = v3.add(camAxis(dE), [0, 0, -vz]);
    // Cam lobe outline, nose toward +y in the (y, z) plane, made convex.
    const lobe2 = hull2(Array.from({ length: 96 }, (_, i) => {
      const a = (i / 96) * TAU, d = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      const rr = rb + (d < half ? lift * Math.pow(0.5 + 0.5 * Math.cos((Math.PI * d) / half), 1.3) : 0);
      return [rr * Math.cos(a), rr * Math.sin(a)];
    }));
    const lobeMesh = (beta, x) => xf(mesh.extrude(lobe2.map(([y, z]) => [z * Math.cos(beta) + y * Math.sin(beta), y * Math.cos(beta) - z * Math.sin(beta)]), B * 0.17, { bevel: 0.8, bevelSegments: 1 }), T([x, 0, 0]), RY(-Math.PI / 2));
    // Nose angle: the lobe points at its follower (along -d) at the peak of its event.
    const peakE = 255 * DEG, peakI = 465 * DEG;
    const follow = d => Math.atan2(-d[2], -d[1]);
    const cams = [], valves = [];
    const camShaftMesh = (center, d, peak) => {
      const parts = [xf(mesh.cylinder(B * 0.14, len + B * 0.3, { segments: 20 }), RZ(Math.PI / 2))];
      X.forEach((x, i) => {
        parts.push(lobeMesh(follow(d) - (phase[i] + peak) / 2, x));
        parts.push(xf(mesh.cylinder(B * 0.19, B * 0.12, { segments: 24 }), T([x + pitch / 2, 0, 0]), RZ(Math.PI / 2)));
      });
      return merge(parts);
    };
    const lobeLift = (psi, d) => {
      const fa = follow(d);
      let m = -Infinity;
      for (const [y, z] of lobe2) { const a = Math.atan2(z, y) + psi, rr = Math.hypot(y, z); m = Math.max(m, rr * Math.cos(a - fa)); }
      return Math.max(0, m - rb);
    };
    for (const [nm, c, d, peak, vm, side] of [["intake camshaft", camI, dI, peakI, vI, 1], ["exhaust camshaft", camE, dE, peakE, vE, -1]]) {
      const cam = A.part(nm, camShaftMesh(c, d, peak), { position: c, material: M("cam", "steel"), explode: [0, B * 2.6, side * B * 0.5], label: { text: side > 0 ? "camshaft" : "camshaft", at: [X[n - 1] + pitch * 0.25, 0, 0] }, note: "lobes open each valve once every two turns of the crank" });
      cams.push({ node: cam, d, center: c });
      X.forEach((x, i) => {
        const seat = [x, seatY, side * vz], Mv = aim(seat, d);
        const v = A.part(`${side > 0 ? "intake" : "exhaust"} valve ${i + 1}`, vm, { material: M(side > 0 ? "intakeValve" : "exhaustValve", "steel"), explode: [0, B * 1.4, 0], label: i === 0 ? (side > 0 ? "intake valve" : "exhaust valve") : undefined, note: side > 0 ? "lets the fuel-air mixture in" : "lets the burned gas out" });
        const sp = A.part(`valve spring ${side}${i}`, spr, { material: M("spring", "steel"), explode: [0, B * 1.4, 0] });
        const bk = A.part(`bucket ${side}${i}`, merge(bucket, xf(retainer, T([0, -B * 0.06, 0]))), { material: M("tappet", "steel"), explode: [0, B * 2, 0] });
        valves.push({ v, sp, bk, Mv, d, i, side, cam: cams.length - 1 });
      });
    }
    A.part("cam cover", xf(housing({ width: len - 4, height: B * 0.62, depth: W * 0.98, wall: 3.5, round: B * 0.1 }), T([0, yHead + B * 0.31, 0])), { material: M("cover", "porcelain"), explode: [0, B * 3.6, 0], label: { text: "cam cover", at: [X[n - 1], yHead + B * 0.62, 0] }, note: "keeps the oil in around the cams" });
    // Spark plugs between the cams.
    const plug = revolve(fillet([[0, 0], [B * 0.05, 0], [B * 0.05, B * 0.25], [B * 0.08, B * 0.27], [B * 0.08, B * 0.36], [B * 0.06, B * 0.4], [B * 0.055, B * 0.72, 2], [B * 0.04, B * 0.95], [B * 0.025, B * 1.0], [0, B * 1.0]], { steps: 2 }), { segments: 20 });
    A.part("spark plugs", merge(X.map(x => xf(plug, T([x, yDeck + 1, 0])))), { material: M("sparkPlug", "ceramic"), explode: [0, B * 3, 0], label: { text: "spark plug", at: [X[0], yDeck + B * 0.9, 0] }, note: "fires the mixture just before the piston reaches the top" });
    // Crankshaft: mains, pins, webs with counterweights, snout, flange.
    const rm = B * 0.3, rp = B * 0.25, pinW = B * 0.26, webT = B * 0.19;
    const web2 = hull2([...circle2(rp + B * 0.1, 24, 0, r), ...circle2(rm + B * 0.08, 24, 0, 0), ...arc2(0, 0, r * 1.38, -Math.PI / 2 - 1.15, -Math.PI / 2 + 1.15, 16)].map(([zz, yy]) => [zz, yy]));
    const webM = (ang, x) => xf(mesh.extrude(web2.map(([zz, yy]) => [zz * Math.cos(ang) + yy * Math.sin(ang), yy * Math.cos(ang) - zz * Math.sin(ang)]), webT, { bevel: 1.2, bevelSegments: 1 }), T([x, 0, 0]), RY(-Math.PI / 2));
    const cyx = (rad, x0, x1, at = [0, 0]) => xf(mesh.cylinder(rad, x1 - x0, { segments: 28 }), T([(x0 + x1) / 2, at[0], at[1]]), RZ(Math.PI / 2));
    const crankParts = [];
    X.forEach((x, i) => {
      const a = pinA[i], py = r * Math.cos(a), pz = r * Math.sin(a);
      crankParts.push(cyx(rp, x - pinW / 2 - 1, x + pinW / 2 + 1, [py, pz]), webM(-a, x - pinW / 2 - webT / 2), webM(-a, x + pinW / 2 + webT / 2));
      crankParts.push(cyx(rm, x - pitch / 2 - B * 0.12, x - pinW / 2 - webT + 1));
    });
    crankParts.push(cyx(rm, X[n - 1] + pinW / 2 + webT - 1, X[n - 1] + pitch / 2 + B * 0.12));
    const xF = X[0] - pitch / 2 - B * 0.12, xR = X[n - 1] + pitch / 2 + B * 0.12;
    crankParts.push(cyx(B * 0.2, xF - B * 0.9, xF + 1), cyx(B * 0.55, xR - 1, xR + B * 0.12));
    const crank = A.part("crankshaft", merge(crankParts), { material: M("crank", "steel"), explode: [0, -B * 0.9, 0], label: { text: "crankshaft", at: [X[0] - pitch / 2, -rm, 0] }, note: "turns the pistons' up-and-down push into rotation" });
    // Flywheel, front pulley, timing sprockets and belt.
    const fly = merge(xf(gear({ teeth: 120, module: B * 0.03, thickness: B * 0.14, hole: B * 0.2 }), RZ(Math.PI / 2)), xf(revolve(fillet([[B * 0.2, -B * 0.12], [B * 1.6, -B * 0.12, 2], [B * 1.6, B * 0.05, 2], [B * 0.8, B * 0.05, 4], [B * 0.6, B * 0.18, 4], [B * 0.2, B * 0.18]], { closed: true, steps: 2 }), { loop: true, segments: 64 }), RZ(Math.PI / 2)));
    A.part("flywheel", fly, { parent: crank, position: [xR + B * 0.3, 0, 0], material: M("flywheel", "steel"), explode: [B * 1.2, 0, 0], label: { text: "flywheel", at: [0, B * 1.4, 0] }, note: "a heavy disc that smooths the four separate power pulses" });
    const xS = xF - B * 0.35, zc = B * 0.03 * 21 / 2;
    const tooth = B * 0.03 * 1.06;
    const crankSp = xf(gear({ teeth: 21, module: tooth, thickness: B * 0.2, hole: B * 0.15 }), RZ(Math.PI / 2));
    A.part("crank sprocket", crankSp, { parent: crank, position: [xS, 0, 0], material: M("sprocket", "steel"), explode: [-B * 1, 0, 0] });
    const pulley = revolve(fillet([[B * 0.15, 0], [B * 0.85, 0, 1], [B * 0.85, B * 0.3, 1], [B * 0.15, B * 0.3]].concat([]), { closed: true }), { loop: true, segments: 48 });
    const grooves = Array.from({ length: 5 }, (_, k) => revolve([[B * 0.8, B * (0.05 + k * 0.05)], [B * 0.86, B * (0.07 + k * 0.05)], [B * 0.8, B * (0.09 + k * 0.05)], [B * 0.78, B * (0.07 + k * 0.05)]], { loop: true, segments: 48 }));
    A.part("crank pulley", xf(merge(pulley, grooves), T([xS - B * 0.5, 0, 0]), RZ(Math.PI / 2)), { parent: crank, material: M("pulley", "steel"), explode: [-B * 1.6, 0, 0], label: { text: "crank pulley", at: [xS - B * 0.65, B * 0.85, 0] }, note: "drives the alternator and water pump belt" });
    const camSp = xf(gear({ teeth: 42, module: tooth, thickness: B * 0.2, hole: B * 0.15 }), RZ(Math.PI / 2));
    const rsp = (42 * tooth) / 2, rcs = (21 * tooth) / 2;
    cams.forEach(c => A.part("cam sprocket", camSp, { parent: c.node, position: [xS - c.center[0], 0, 0], material: M("sprocket", "steel"), explode: [-B, 0, 0] }));
    const idler = [B * 0.0, (yDeck + yHead) * 0.45];
    const bp = beltPath([
      { c: [0, 0], r: rcs, cw: false },
      { c: [camE[2], camE[1]], r: rsp, cw: false },
      { c: [camI[2], camI[1]], r: rsp, cw: false },
      { c: [B * 0.9, idler[1]], r: B * 0.32, cw: true },
    ]);
    // The path above is in (z, y); turn it into a band in the yz plane at the sprocket face.
    const beltM = xf(belt(bp.points, { width: B * 0.22, thickness: B * 0.05 }), T([xS, 0, 0]), RY(-Math.PI / 2));
    A.part("timing belt", beltM, { material: M("belt", "rubber"), explode: [-B * 2.2, 0, 0], label: { text: "timing belt", at: [xS, (yDeck) * 0.6, B * 0.6] }, note: "keeps the cams turning at exactly half the crank's speed" });
    A.part("belt tensioner", xf(revolve(fillet([[B * 0.05, -B * 0.13], [B * 0.32, -B * 0.13, 2], [B * 0.32, B * 0.13, 2], [B * 0.05, B * 0.13]], { closed: true }), { loop: true, segments: 40 }), T([xS, idler[1], -B * 0.9]), RZ(Math.PI / 2)), { material: M("pulley", "steel"), explode: [-B * 2.2, 0, 0] });
    // Pistons, rings, wrist pins, and rods.
    const Rp = B / 2 - 0.25, sk = B * 0.32;
    const pistonProf = [[0, ch], [Rp - 1.2, ch], [Rp, ch - 1.2]];
    for (const [g0, g1] of [[ch - 5, ch - 7], [ch - 10, ch - 12], [ch - 15, ch - 18]]) pistonProf.push([Rp, g0], [Rp - 3.5, g0], [Rp - 3.5, g1], [Rp, g1]);
    pistonProf.push([Rp, -sk + 1], [Rp - 1, -sk], [Rp - 4, -sk], [Rp - 4, ch - 8, 3], [0, ch - 8]);
    const pistonM = revolve(fillet(pistonProf, { steps: 2 }), { segments: 48 });
    const ringM = merge([[ch - 5, ch - 7], [ch - 10, ch - 12], [ch - 15, ch - 18]].map(([a, b]) => revolve([[Rp - 3.2, b + 0.1], [Rp - 0.05, b + 0.1], [Rp - 0.05, a - 0.1], [Rp - 3.2, a - 0.1]], { loop: true, segments: 48 })));
    const wristR = B * 0.12;
    const wrist = xf(mesh.cylinder(wristR, B * 0.78, { segments: 20 }), RZ(Math.PI / 2));
    const Rb = B * 0.42, Rs = B * 0.2, wb = B * 0.32, wt = B * 0.2;
    const rodShape = fillet([...arc2(0, 0, Rb, Math.PI + 0.45, TAU - 0.45, 14), [Rb * 0.9, Rb * 0.6], [wb / 2, Rb * 1.15, 6], [wt / 2, L - Rs * 1.1, 6], ...arc2(0, L, Rs, -0.3, Math.PI + 0.3, 12), [-wt / 2, L - Rs * 1.1, 6], [-wb / 2, Rb * 1.15, 6], [-Rb * 0.9, Rb * 0.6]], { closed: true, steps: 3 });
    const rodM = merge(
      xf(mesh.extrude(rodShape, pinW - 1.5, { holes: [circle2(rp + 0.4, 32), circle2(wristR + 0.3, 24, 0, L)], bevel: 1.2, bevelSegments: 1 }), RY(-Math.PI / 2)),
      xf(mesh.cylinder(B * 0.05, Rb * 1.5, { segments: 10 }), T([0, -Rb * 0.2, Rb * 0.78])), xf(mesh.cylinder(B * 0.05, Rb * 1.5, { segments: 10 }), T([0, -Rb * 0.2, -Rb * 0.78])),
    );
    const pistons = [], rods = [];
    X.forEach((x, i) => {
      const pn = A.part(`piston ${i + 1}`, merge(pistonM, wrist), { material: M("piston", "aluminum"), explode: [0, B * 4.2, 0], label: i === n - 1 ? "piston" : undefined, note: "pushed down by the burning gas; four strokes make one cycle" });
      A.part(`piston rings ${i + 1}`, ringM, { parent: pn, material: M("rings", "steel") });
      pistons.push(pn);
      rods.push(A.part(`connecting rod ${i + 1}`, rodM, { material: M("rod", "steel"), label: i === n - 1 ? "connecting rod" : undefined, note: "links the piston to the crank pin" }));
    });
    A.cylinders = X.map((x, i) => ({ x, firing: firing.indexOf(i + 1) + 1, phase: phase[i], bore: B, deck: yDeck }));
    A.port("output", crank, [xR + B * 0.42, 0, 0], [1, 0, 0], B * 1.6);
    A.info = { cylinders: n, bore: B, stroke: Sk, rod: L, displacement: (Math.PI / 4) * B * B * Sk * n / 1000, firingOrder: firing, compressionHeight: ch, deck: yDeck };
    const state = { crank: 0 };
    A.onPose = p => {
      if (p.crank != null) state.crank = p.crank;
      const th = state.crank;
      crank.rotation = [th, 0, 0];
      X.forEach((x, i) => {
        const a = th + pinA[i], py = r * Math.cos(a), pz = r * Math.sin(a);
        const yp = py + Math.sqrt(L * L - pz * pz);
        A.home(pistons[i], [x, yp, 0]);
        A.homeMatrix(rods[i], mul(T([x, py, pz]), RX(Math.atan2(-pz, yp - py))));
      });
      cams.forEach(c => { c.node.rotation = [th / 2, 0, 0]; });
      for (const q of valves) {
        const l = lobeLift(th / 2, q.d);
        const Mv = mul(T(v3.scale(q.d, -l)), q.Mv);
        A.homeMatrix(q.v, Mv);
        A.homeMatrix(q.bk, mul(Mv, T([0, Lv, 0])));
        const top = Lv - B * 0.06 - l, bottom = Hh * 0.38;
        A.homeMatrix(q.sp, mul(q.Mv, T([0, bottom, 0]), SC([1, (top - bottom) / springL, 1])));
      }
    };
    const baseExplode = A.explode;
    A.explode = t => { baseExplode(t); A.onPose({}); return A; };
    A.onPose({});
    A.lift = (cyl, which, crankAngle) => lobeLift(crankAngle / 2, which === "intake" ? dI : dE);
    return A;
  }

  // ---------- exports ----------
  E3.parts = {
    // profiles and geometry helpers
    revolve, fillet, roundRect: roundRect2, circle: circle2, arc: arc2, hull: hull2, offset: offset2, resample,
    route, tube: tubeShell, frames, along, aim, flip, Soup, naca, nacaMPT, loft, bellContour, raoAngles, collar,
    // parts
    bolt, nut, washer, boltCircle, flange, pipe, bracket, bearing, shaft, spring, gear, strut, housing, harness,
    bellows, valve, bellNozzle, combustionChamber, injectorPlate, impeller, volute, gimbal, actuator, tank,
    blade, rotorStage, statorStage, spinner, nacelle, nacelleProfile,
    // assemblies
    assembly, highlight, turbopump, rocketEngine, turbofan, pistonEngine, beltPath, belt,
    materials: [...MATERIALS],
  };
})();
