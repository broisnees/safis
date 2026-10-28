/* E3.bio: anatomy and cell biology for E3 figures. Organic modeling helpers (implicit
   surfaces polygonized into smooth meshes, muscles, vessel trees by Murray's law, long
   bones with cortical and cancellous bone, thin sheets, surface noise) and assemblies with
   named parts that move: heart, eye, knee, neuron, cell, tooth, skin. Same interface as
   E3.parts assemblies (pose, explode, labels, notes, cutaway, ports, info).
   Units are millimeters, except the neuron and the cell, which are in micrometers.
   Reference: references/bio3d.md in the skill. */
(() => {
  "use strict";
  const E3 = typeof window !== "undefined" ? window.E3 : null;
  if (!E3 || !E3.mesh || !E3.parts || E3.bio) return;
  const { v3, m4, mesh } = E3, P = E3.parts;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mul = (...ms) => ms.reduce((a, b) => m4.multiply(a, b));
  const T = p => m4.translation(p);
  const RX = a => m4.rotationX(a), RY = a => m4.rotationY(a), RZ = a => m4.rotationZ(a);
  const xf = (m, ...ms) => mesh.transform(m, mul(...ms));
  const merge = (...ms) => { const l = ms.flat(Infinity).filter(Boolean); return l.length ? mesh.merge(...l) : null; };
  const vlerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // Level of detail: assemblies take `detail` (0.3 to 1.5, default 1). Grid spacing of
  // implicit surfaces divides by it and segment counts multiply by it.
  let DETAIL = 1;
  const segs = (n, min = 6) => Math.max(min, Math.round(n * DETAIL));
  const detailed = fn => (o = {}) => { const prev = DETAIL; DETAIL = clamp(o.detail ?? 1, 0.3, 1.5); try { return fn(o); } finally { DETAIL = prev; } };

  // Seeded random numbers for organic irregularity: the same seed builds the same model.
  function rng(seed = 1) {
    let s = (seed * 2654435761) >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // ---------- noise ----------
  const hash3 = (x, y, z, s) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(s + 1, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  // Smooth value noise in [-1, 1].
  function noise(x, y, z, s = 0) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    const c = (a, b, d) => hash3(ix + a, iy + b, iz + d, s);
    const x00 = lerp(c(0, 0, 0), c(1, 0, 0), ux), x10 = lerp(c(0, 1, 0), c(1, 1, 0), ux);
    const x01 = lerp(c(0, 0, 1), c(1, 0, 1), ux), x11 = lerp(c(0, 1, 1), c(1, 1, 1), ux);
    return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz) * 2 - 1;
  }
  function fbm(x, y, z, octaves = 3, s = 0) {
    let a = 0, w = 0.5, f = 1;
    for (let o = 0; o < octaves; o++) { a += w * noise(x * f, y * f, z * f, s + o * 17); f *= 2.03; w *= 0.5; }
    return a;
  }

  // ---------- implicit surfaces ----------
  // A signed distance field: { d(x, y, z), min, max }. d is negative inside; min/max bound
  // the shape. Builders here are exact or close to it, so blends and the polygonizer's
  // empty-space skipping stay correct.
  const SDF = (d, min, max) => ({ d, min, max });
  const addv = (c, r) => [c[0] + r, c[1] + r, c[2] + r], subv = (c, r) => [c[0] - r, c[1] - r, c[2] - r];
  // Distance from a point to a box, 0 inside: used to skip far children of a union.
  const boxDist = (x, y, z, mn, mx) => {
    const dx = Math.max(mn[0] - x, 0, x - mx[0]), dy = Math.max(mn[1] - y, 0, y - mx[1]), dz = Math.max(mn[2] - z, 0, z - mx[2]);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const smax = (a, b, k) => -smin(-a, -b, k);
  // World-to-local for a placement matrix M (rigid: rotation and translation).
  function inverseRigid(M) {
    const I = m4.invert(M);
    return [I[0], I[4], I[8], I[12], I[1], I[5], I[9], I[13], I[2], I[6], I[10], I[14]];
  }
  function boundsOf(points, pad) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k] - pad); mx[k] = Math.max(mx[k], p[k] + pad); }
    return [mn, mx];
  }
  const sd = {
    sphere(c, r) { return SDF((x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r, subv(c, r), addv(c, r)); },
    // Ellipsoid with radii [a, b, c], optionally turned by a rotation matrix M (local to world).
    ellipsoid(c, R, M = null) {
      const I = M ? inverseRigid(M) : null, [a, b, cc] = R, rmax = Math.max(a, b, cc);
      return SDF((x, y, z) => {
        let px = x - c[0], py = y - c[1], pz = z - c[2];
        if (I) { const qx = I[0] * px + I[1] * py + I[2] * pz, qy = I[4] * px + I[5] * py + I[6] * pz, qz = I[8] * px + I[9] * py + I[10] * pz; px = qx; py = qy; pz = qz; }
        const k0 = Math.hypot(px / a, py / b, pz / cc), k1 = Math.hypot(px / (a * a), py / (b * b), pz / (cc * cc));
        return k1 < 1e-12 ? -Math.min(a, b, cc) : (k0 * (k0 - 1)) / k1;
      }, subv(c, rmax), addv(c, rmax));
    },
    capsule(a, b, r) { return sd.cone(a, b, r, r); },
    // Round cone: a capsule whose radius goes from ra at a to rb at b (exact).
    cone(a, b, ra, rb) {
      const ba = v3.sub(b, a), l2 = v3.dot(ba, ba) || 1e-12, rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2;
      const [mn1, mx1] = boundsOf([a], ra), [mn2, mx2] = boundsOf([b], rb);
      return SDF((x, y, z) => {
        const pax = x - a[0], pay = y - a[1], paz = z - a[2];
        const yy = pax * ba[0] + pay * ba[1] + paz * ba[2], zz = yy - l2;
        const xvx = pax * l2 - ba[0] * yy, xvy = pay * l2 - ba[1] * yy, xvz = paz * l2 - ba[2] * yy;
        const x2 = xvx * xvx + xvy * xvy + xvz * xvz, y2 = yy * yy * l2, z2 = zz * zz * l2;
        const k = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
        if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
        return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
      }, mn1.map((v, i) => Math.min(v, mn2[i])), mx1.map((v, i) => Math.max(v, mx2[i])));
    },
    // Box of half extents h with rounded edges, optionally turned by M.
    box(c, h, round = 0, M = null) {
      const I = M ? inverseRigid(M) : null, ext = Math.hypot(h[0], h[1], h[2]);
      return SDF((x, y, z) => {
        let px = x - c[0], py = y - c[1], pz = z - c[2];
        if (I) { const qx = I[0] * px + I[1] * py + I[2] * pz, qy = I[4] * px + I[5] * py + I[6] * pz, qz = I[8] * px + I[9] * py + I[10] * pz; px = qx; py = qy; pz = qz; }
        const qx = Math.abs(px) - h[0] + round, qy = Math.abs(py) - h[1] + round, qz = Math.abs(pz) - h[2] + round;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - round;
      }, subv(c, ext), addv(c, ext));
    },
    // Torus of radius R and tube r around axis (default y) through c.
    torus(c, R, r, axis = [0, 1, 0]) {
      const ax = v3.norm(axis);
      return SDF((x, y, z) => {
        const px = x - c[0], py = y - c[1], pz = z - c[2], h = px * ax[0] + py * ax[1] + pz * ax[2];
        const q = Math.sqrt(Math.max(0, px * px + py * py + pz * pz - h * h)) - R;
        return Math.sqrt(q * q + h * h) - r;
      }, subv(c, R + r), addv(c, R + r));
    },
    // Half-space n·p <= d (n need not be unit).
    plane(n, d) { const l = v3.len(n), u = v3.scale(n, 1 / l), dd = d / l; return SDF((x, y, z) => x * u[0] + y * u[1] + z * u[2] - dd, [-1e9, -1e9, -1e9], [1e9, 1e9, 1e9]); },
    // A smooth tube through points with radius per point (number or array), as blended round cones.
    tube(points, radii, k = 0) {
      const r = i => (Array.isArray(radii) ? radii[i] : typeof radii === "function" ? radii(i / (points.length - 1), i) : radii);
      const parts = [];
      for (let i = 0; i + 1 < points.length; i++) parts.push(sd.cone(points[i], points[i + 1], r(i), r(i + 1)));
      return k > 0 ? sd.smooth(k, ...parts) : sd.union(...parts);
    },
    union(...list) { return sd.smooth(0, ...list); },
    // Smooth union with blend radius k. Children whose bounds are farther than the best
    // distance so far (plus k) are skipped, which keeps big unions fast.
    smooth(k, ...list) {
      list = list.flat().filter(Boolean);
      if (list.length === 1) return list[0];
      const mn = [0, 1, 2].map(i => Math.min(...list.map(f => f.min[i])) - k), mx = [0, 1, 2].map(i => Math.max(...list.map(f => f.max[i])) + k);
      const n = list.length, fs = list.map(f => f.d), lo = list.map(f => f.min), hi = list.map(f => f.max);
      return SDF((x, y, z) => {
        let best = 1e9;
        for (let i = 0; i < n; i++) {
          if (boxDist(x, y, z, lo[i], hi[i]) > best + k) continue;
          const v = fs[i](x, y, z);
          best = k > 0 ? smin(best, v, k) : Math.min(best, v);
        }
        return best;
      }, mn, mx);
    },
    // a minus b, with an optional blend radius.
    subtract(a, b, k = 0) { return SDF((x, y, z) => { const da = a.d(x, y, z); if (boxDist(x, y, z, b.min, b.max) > -da + k + 1e-9 && da > -1e8) return da; return k > 0 ? smax(da, -b.d(x, y, z), k) : Math.max(da, -b.d(x, y, z)); }, a.min, a.max); },
    intersect(a, b, k = 0) { return SDF((x, y, z) => (k > 0 ? smax(a.d(x, y, z), b.d(x, y, z), k) : Math.max(a.d(x, y, z), b.d(x, y, z))), a.min.map((v, i) => Math.max(v, b.min[i])), a.max.map((v, i) => Math.min(v, b.max[i]))); },
    // Grows (r > 0) or shrinks a shape. r may be a function of the point.
    offset(a, r) { return typeof r === "function" ? SDF((x, y, z) => a.d(x, y, z) - r(x, y, z), a.min, a.max) : SDF((x, y, z) => a.d(x, y, z) - r, subv(a.min, Math.max(0, r)), addv(a.max, Math.max(0, r))); },
    // A shell of thickness t inside the surface (t a number or function of the point).
    shell(a, t) { const tf = typeof t === "function" ? t : () => t; return SDF((x, y, z) => { const v = a.d(x, y, z); return Math.max(v, -(v + tf(x, y, z))); }, a.min, a.max); },
    // Organic irregularity: noise of amplitude amp (world units) at frequency freq (cycles per unit).
    displace(a, amp, freq, seed = 0, octaves = 2) {
      return SDF((x, y, z) => { const v = a.d(x, y, z); return v > amp * 3 ? v : v + amp * fbm(x * freq, y * freq, z * freq, octaves, seed); }, subv(a.min, amp), addv(a.max, amp));
    },
    // Moves a shape by a rigid placement matrix (local to world).
    place(a, M) {
      const I = inverseRigid(M), corners = [];
      for (let i = 0; i < 8; i++) corners.push(m4.apply(M, [i & 1 ? a.max[0] : a.min[0], i & 2 ? a.max[1] : a.min[1], i & 4 ? a.max[2] : a.min[2]]));
      const [mn, mx] = boundsOf(corners, 0);
      return SDF((x, y, z) => a.d(I[0] * x + I[1] * y + I[2] * z + I[3], I[4] * x + I[5] * y + I[6] * z + I[7], I[8] * x + I[9] * y + I[10] * z + I[11]), mn, mx);
    },
    // A gyroid lattice of the given period: negative inside the struts (trabecular bone, sponges).
    gyroid(period, thickness = 0.3, mn = [-1e9, -1e9, -1e9], mx = [1e9, 1e9, 1e9]) {
      const k = TAU / period, s = period / TAU / 1.5;
      return SDF((x, y, z) => {
        const X = x * k, Y = y * k, Z = z * k;
        const g = Math.sin(X) * Math.cos(Y) + Math.sin(Y) * Math.cos(Z) + Math.sin(Z) * Math.cos(X);
        return (g - thickness) * s;
      }, mn, mx);
    },
    // Custom field: d(x, y, z) with the bounds it lives in.
    field(d, mn, mx) { return SDF(d, mn, mx); },
  };

  // Polygonizes an SDF into a closed mesh with smooth normals from the field's gradient
  // (surface nets with one Newton step to the surface). h is the grid spacing in world
  // units; space far from the surface is skipped on a coarse grid first. sharp: true (for
  // shapes with flat cuts) uses face normals split at creases instead. caps: [{ n, d }] names
  // the section planes (n·p = d, n pointing out of the kept side): triangles lying on them get
  // the plane's normal, so a cut face is flat with a clean edge and the rest stays smooth.
  function polygonize(f, o = {}) {
    const h = (o.h ?? 1) / DETAIL;
    const pad = 2 * h;
    const mn = f.min.map(v => v - pad), mx = f.max.map(v => v + pad);
    const nx = Math.max(3, Math.ceil((mx[0] - mn[0]) / h) + 1), ny = Math.max(3, Math.ceil((mx[1] - mn[1]) / h) + 1), nz = Math.max(3, Math.ceil((mx[2] - mn[2]) / h) + 1);
    const N = nx * ny * nz;
    if (N > 3.2e7) throw new Error(`E3.bio.polygonize: a ${nx}×${ny}×${nz} grid is too fine; raise h (now ${h.toFixed(3)})`);
    const V = new Float32Array(N), d = f.d;
    const X = i => mn[0] + i * h, Y = j => mn[1] + j * h, Z = k => mn[2] + k * h;
    const nxy = nx * ny, at = (i, j, k) => i + nx * j + nxy * k;
    // Coarse pass: a coarse cell any of whose corners is farther from the surface than the
    // cell's diagonal holds no surface, so its nodes only need that corner's sign.
    const S = 4, cx = Math.ceil((nx - 1) / S) + 1, cy = Math.ceil((ny - 1) / S) + 1, cz = Math.ceil((nz - 1) / S) + 1;
    const C = new Float32Array(cx * cy * cz), ci = (a, b, c) => a + cx * b + cx * cy * c;
    for (let c = 0; c < cz; c++) for (let b = 0; b < cy; b++) for (let a = 0; a < cx; a++) C[ci(a, b, c)] = d(X(Math.min(a * S, nx - 1)), Y(Math.min(b * S, ny - 1)), Z(Math.min(c * S, nz - 1)));
    const far = S * h * Math.sqrt(3) * 1.6;
    const done = new Uint8Array(N);
    for (let c = 0; c < cz - 1; c++) for (let b = 0; b < cy - 1; b++) for (let a = 0; a < cx - 1; a++) {
      let sgn = 0;
      for (let q = 0; q < 8 && !sgn; q++) { const v = C[ci(a + (q & 1), b + ((q >> 1) & 1), c + (q >> 2))]; if (Math.abs(v) > far) sgn = v; }
      const i0 = a * S, j0 = b * S, k0 = c * S, i1 = Math.min(i0 + S, nx - 1), j1 = Math.min(j0 + S, ny - 1), k1 = Math.min(k0 + S, nz - 1);
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const n = at(i, j, k);
        if (done[n]) continue;
        V[n] = sgn ? sgn : d(X(i), Y(j), Z(k));
        done[n] = 1;
      }
    }
    // Vertices: one per cell the surface crosses.
    const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
    const cell = new Int32Array(cnx * cny * cnz).fill(-1), cAt = (i, j, k) => i + cnx * j + cnx * cny * k;
    const pos = [], nor = [];
    const eg = h * 0.25;
    const grad = (x, y, z) => [d(x + eg, y, z) - d(x - eg, y, z), d(x, y + eg, z) - d(x, y - eg, z), d(x, y, z + eg) - d(x, y, z - eg)];
    const corner = new Float32Array(8);
    const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
      let mask = 0;
      for (let q = 0; q < 8; q++) { const v = V[at(i + (q & 1), j + ((q >> 1) & 1), k + (q >> 2))]; corner[q] = v; if (v < 0) mask |= 1 << q; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (const [a, b] of EDGES) {
        const va = corner[a], vb = corner[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += (a & 1) + (((b & 1) - (a & 1)) * t); sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t); sz += (a >> 2) + (((b >> 2) - (a >> 2)) * t);
        cnt++;
      }
      let px = X(i) + (sx / cnt) * h, py = Y(j) + (sy / cnt) * h, pz = Z(k) + (sz / cnt) * h;
      // One Newton step onto the surface, kept inside the cell's neighborhood.
      const g = grad(px, py, pz), gl2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (gl2 > 1e-20) {
        const s = (d(px, py, pz) * (2 * eg)) / gl2;
        // Kept inside its own cell, so neighboring faces can't fold over each other.
        px = clamp(px - g[0] * s, X(i) + 0.02 * h, X(i + 1) - 0.02 * h);
        py = clamp(py - g[1] * s, Y(j) + 0.02 * h, Y(j + 1) - 0.02 * h);
        pz = clamp(pz - g[2] * s, Z(k) + 0.02 * h, Z(k + 1) - 0.02 * h);
      }
      const g2 = grad(px, py, pz), l = Math.hypot(g2[0], g2[1], g2[2]) || 1;
      cell[cAt(i, j, k)] = pos.length / 3;
      pos.push(px, py, pz);
      nor.push(g2[0] / l, g2[1] / l, g2[2] / l);
    }
    // Faces: a quad of the four cells around every grid edge the surface crosses,
    // wound so it faces from inside to outside.
    const idx = [];
    // A triangle's agreement with its vertices' normals (negative: folded over).
    const agree = (a, b, c) => {
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx, l = Math.hypot(fx, fy, fz) || 1;
      const nx2 = nor[a * 3] + nor[b * 3] + nor[c * 3], ny2 = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1], nz2 = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
      return (fx * nx2 + fy * ny2 + fz * nz2) / (l * (Math.hypot(nx2, ny2, nz2) || 1));
    };
    // Each quad splits along the diagonal whose two triangles agree best with the surface.
    const quad = (a, b, c, e) => {
      if (a < 0 || b < 0 || c < 0 || e < 0) return;
      const s1 = Math.min(agree(a, b, c), agree(a, c, e)), s2 = Math.min(agree(a, b, e), agree(b, c, e));
      if (s1 >= s2) idx.push(a, b, c, a, c, e); else idx.push(a, b, e, b, c, e);
    };
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const n = at(i, j, k), inside = V[n] < 0;
      if (i < cnx && (V[n + 1] < 0) !== inside) {
        const c = [cell[cAt(i, j - 1, k - 1)], cell[cAt(i, j, k - 1)], cell[cAt(i, j, k)], cell[cAt(i, j - 1, k)]];
        if (inside) quad(c[0], c[1], c[2], c[3]); else quad(c[3], c[2], c[1], c[0]);
      }
      if (j < cny && (V[n + nx] < 0) !== inside) {
        const c = [cell[cAt(i - 1, j, k - 1)], cell[cAt(i - 1, j, k)], cell[cAt(i, j, k)], cell[cAt(i, j, k - 1)]];
        if (inside) quad(c[0], c[1], c[2], c[3]); else quad(c[3], c[2], c[1], c[0]);
      }
      if (k < cnz && (V[n + nxy] < 0) !== inside) {
        const c = [cell[cAt(i - 1, j - 1, k)], cell[cAt(i, j - 1, k)], cell[cAt(i, j, k)], cell[cAt(i - 1, j, k)]];
        if (inside) quad(c[0], c[1], c[2], c[3]); else quad(c[3], c[2], c[1], c[0]);
      }
    }
    // Where a shell is thinner than the gradient's sampling the gradient can point the wrong
    // way; there the surrounding faces decide.
    const fn = new Float64Array(nor.length);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx2 = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
      for (const q of [a, b, c]) { fn[q] += nx2; fn[q + 1] += ny2; fn[q + 2] += nz2; }
    }
    for (let q = 0; q < nor.length; q += 3) {
      const l = Math.hypot(fn[q], fn[q + 1], fn[q + 2]);
      if (l < 1e-20) continue;
      const fx = fn[q] / l, fy = fn[q + 1] / l, fz = fn[q + 2] / l;
      if (fx * nor[q] + fy * nor[q + 1] + fz * nor[q + 2] < 0.35) { nor[q] = fx; nor[q + 1] = fy; nor[q + 2] = fz; }
    }
    if (o.caps && o.caps.length) {
      const caps = o.caps.map(c => { const l = v3.len(c.n); return { n: v3.scale(c.n, 1 / l), d: c.d / l }; });
      const P2 = pos.slice(), N2 = nor.slice(), I2 = [], dup = new Map();
      const tol = 0.6 * h;
      // Vertices on a section plane that side faces also use take those faces' normal (their
      // gradient belongs to the plane there).
      const sideN = new Float64Array(nor.length), onPlane = new Uint8Array(nor.length / 3);
      for (let q = 0; q < pos.length; q += 3) for (const { n, d: dd } of caps) if (Math.abs(pos[q] * n[0] + pos[q + 1] * n[1] + pos[q + 2] * n[2] - dd) < tol) onPlane[q / 3] = 1;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx, fl = Math.hypot(fx, fy, fz) || 1;
        let ci = -1;
        for (let k = 0; k < caps.length && ci < 0; k++) {
          const { n, d: dd } = caps[k];
          if ((fx * n[0] + fy * n[1] + fz * n[2]) / fl < 0.9) continue;
          if ([a, b, c].every(q => Math.abs(pos[q] * n[0] + pos[q + 1] * n[1] + pos[q + 2] * n[2] - dd) < tol)) ci = k;
        }
        if (ci < 0) { I2.push(idx[t], idx[t + 1], idx[t + 2]); for (const q of [a, b, c]) { sideN[q] += fx; sideN[q + 1] += fy; sideN[q + 2] += fz; } continue; }
        for (const q of [idx[t], idx[t + 1], idx[t + 2]]) {
          const key = q * 8 + ci;
          if (!dup.has(key)) { dup.set(key, P2.length / 3); P2.push(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]); N2.push(...caps[ci].n); }
          I2.push(dup.get(key));
        }
      }
      for (let v = 0; v < onPlane.length; v++) {
        if (!onPlane[v]) continue;
        const q = v * 3, l = Math.hypot(sideN[q], sideN[q + 1], sideN[q + 2]);
        if (l > 1e-20) { N2[q] = sideN[q] / l; N2[q + 1] = sideN[q + 1] / l; N2[q + 2] = sideN[q + 2] / l; }
      }
      // The edge of a cut face follows the grid in steps; smooth it along itself, in the
      // plane, so section outlines are clean curves. Boundary edges of the cap regions are
      // those used by one cap triangle only.
      const capTri = [], edgeUse = new Map(), ek = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
      for (let t = 0; t < I2.length; t += 3) {
        const o0 = [I2[t], I2[t + 1], I2[t + 2]];
        if (!o0.every(q => q * 3 >= pos.length)) continue; // cap triangles use the duplicated vertices
        capTri.push(o0);
        for (let e = 0; e < 3; e++) { const k2 = ek(o0[e], o0[(e + 1) % 3]); edgeUse.set(k2, (edgeUse.get(k2) || 0) + 1); }
      }
      const nb = new Map(), back = new Map();
      for (const [key, v] of dup) back.set(v, (key / 8) | 0);
      for (const tr of capTri) for (let e = 0; e < 3; e++) {
        const a = tr[e], b = tr[(e + 1) % 3];
        if (edgeUse.get(ek(a, b)) !== 1) continue;
        const oa = back.get(a), ob = back.get(b);
        if (!nb.has(oa)) nb.set(oa, new Set()); if (!nb.has(ob)) nb.set(ob, new Set());
        nb.get(oa).add(ob); nb.get(ob).add(oa);
      }
      const P3 = new Float64Array(pos);
      const multi = new Map();
      for (const key of dup.keys()) { const q = (key / 8) | 0; multi.set(q, (multi.get(q) || 0) + 1); }
      const capsOfAny = q => multi.get(q) > 1;
      for (let it = 0; it < (o.smoothEdges ?? 4); it++) {
        const next = new Map();
        for (const [v, set] of nb) {
          if (set.size !== 2 || capsOfAny(v)) continue;
          const [a, b] = [...set];
          next.set(v, [0, 1, 2].map(k => 0.5 * P3[v * 3 + k] + 0.25 * (P3[a * 3 + k] + P3[b * 3 + k])));
        }
        for (const [v, pnt] of next) for (let k = 0; k < 3; k++) P3[v * 3 + k] = pnt[k];
      }
      // Vertices on two section planes (where cuts meet) stay put, so both caps still share them.
      const capsOf = new Map();
      for (const key of dup.keys()) { const q = (key / 8) | 0; capsOf.set(q, (capsOf.get(q) || 0) + 1); }
      for (const [key, v] of dup) {
        const q = (key / 8) | 0;
        if (capsOf.get(q) > 1) continue;
        const c = caps[key % 8];
        let px = P3[q * 3], py = P3[q * 3 + 1], pz = P3[q * 3 + 2];
        const dd = px * c.n[0] + py * c.n[1] + pz * c.n[2] - c.d;
        px -= c.n[0] * dd; py -= c.n[1] * dd; pz -= c.n[2] * dd;
        P2[v * 3] = px; P2[v * 3 + 1] = py; P2[v * 3 + 2] = pz; P2[q * 3] = px; P2[q * 3 + 1] = py; P2[q * 3 + 2] = pz;
      }
      return mesh.merge({ positions: new Float32Array(P2), normals: new Float32Array(N2), indices: new Uint32Array(I2) });
    }
    if (o.sharp) {
      const pts = [];
      for (let q = 0; q < pos.length; q += 3) pts.push([pos[q], pos[q + 1], pos[q + 2]]);
      return mesh.custom(pts, idx, { crease: o.crease ?? 70 });
    }
    return mesh.merge({ positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) });
  }
  // An implicit shape straight to a mesh: implicit(sdf, h) or implicit(sdf, { h }).
  const implicit = (f, o = {}) => polygonize(f, typeof o === "number" ? { h: o } : o);

  // ---------- thin sheets ----------
  // A thin curved sheet as a closed solid: f(u, v) gives the mid-surface point for u, v in
  // [0, 1]; thickness is a number or (u, v) => number. closedU joins u = 1 back to u = 0
  // (a ring or a sleeve). Valve leaflets, membranes, cisternae, skin layers.
  function sheet(f, { nu = 16, nv = 10, thickness = 0.5, closedU = false, crease = 60 } = {}) {
    nu = segs(nu, 3); nv = segs(nv, 2);
    const cols = closedU ? nu : nu + 1, e = 1e-3;
    const tk = typeof thickness === "function" ? thickness : () => thickness;
    const uu = u => (closedU ? ((u % 1) + 1) % 1 : clamp(u, 0, 1));
    const top = [], bot = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) {
      const u = i / nu, v = j / nv, p = f(u, v);
      const du = v3.sub(f(uu(u + e), v), f(uu(u - e), v)), dv = v3.sub(f(u, clamp(v + e, 0, 1)), f(u, clamp(v - e, 0, 1)));
      let n = v3.cross(du, dv);
      n = v3.len(n) > 1e-12 ? v3.norm(n) : [0, 1, 0];
      const t = tk(u, v) / 2;
      top.push(v3.add(p, v3.scale(n, t)));
      bot.push(v3.sub(p, v3.scale(n, t)));
    }
    const S = new P.Soup(), id = (i, j) => j * cols + (closedU ? i % nu : i);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      S.quad(top[a], top[b], top[c], top[d]);
      S.quad(bot[a], bot[d], bot[c], bot[b]);
    }
    for (let i = 0; i < nu; i++) {
      const a = id(i, 0), b = id(i + 1, 0), c = id(i, nv), d = id(i + 1, nv);
      S.quad(top[a], bot[a], bot[b], top[b]);
      S.quad(top[c], top[d], bot[d], bot[c]);
    }
    if (!closedU) for (let j = 0; j < nv; j++) {
      const a = id(0, j), b = id(0, j + 1), c = id(nu, j), d = id(nu, j + 1);
      S.quad(top[a], top[b], bot[b], bot[a]);
      S.quad(top[c], bot[c], bot[d], top[d]);
    }
    return S.build({ crease, closed: true });
  }
  // A height field slab: the solid between two surfaces y = low(x, z) and y = high(x, z) over
  // the rectangle [x0, x1] × [z0, z1] (skin layers, a tissue block).
  function slab(low, high, [x0, x1], [z0, z1], { n = 48, crease = 50 } = {}) {
    const nx = segs(n, 4), nz = segs(Math.round((n * (z1 - z0)) / (x1 - x0)), 4);
    const pt = (i, k, top) => { const x = lerp(x0, x1, i / nx), z = lerp(z0, z1, k / nz); return [x, top ? high(x, z) : low(x, z), z]; };
    const S = new P.Soup();
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      S.quad(pt(i, k, true), pt(i, k + 1, true), pt(i + 1, k + 1, true), pt(i + 1, k, true));
      S.quad(pt(i, k, false), pt(i + 1, k, false), pt(i + 1, k + 1, false), pt(i, k + 1, false));
    }
    for (let i = 0; i < nx; i++) {
      S.quad(pt(i, 0, false), pt(i, 0, true), pt(i + 1, 0, true), pt(i + 1, 0, false));
      S.quad(pt(i, nz, false), pt(i + 1, nz, false), pt(i + 1, nz, true), pt(i, nz, true));
    }
    for (let k = 0; k < nz; k++) {
      S.quad(pt(0, k, false), pt(0, k + 1, false), pt(0, k + 1, true), pt(0, k, true));
      S.quad(pt(nx, k, false), pt(nx, k, true), pt(nx, k + 1, true), pt(nx, k + 1, false));
    }
    return S.build({ crease, closed: true });
  }

  // ---------- tissue materials ----------
  // Anatomy materials as objects on E3's anatomy names. In the "anatomy" look they shade as
  // tissue (subsurface scattering, wet specular, sheen, muscle fibers along `fibers`); in
  // any other look they are E3's diagram colors.
  const TISSUE = {
    muscle: { base: "muscle", sss: 0.55, sssColor: "#9c2a22", wet: 0.45, sheen: 0.15 },
    tendon: { base: "tendon", sss: 0.3, sssColor: "#c9a77a", wet: 0.35, sheen: 0.6 },
    ligament: { base: "tendon", sss: 0.32, sssColor: "#c9a77a", wet: 0.35, sheen: 0.55 },
    bone: { base: "bone", sss: 0.22, sssColor: "#c79a6a", wet: 0.08 },
    cancellous: { base: "bone", color: "#d9b88f", sss: 0.35, sssColor: "#b0663f", wet: 0.1 },
    marrow: { base: "fat", color: "#e7c46a", sss: 0.7, sssColor: "#d08a2a", wet: 0.3 },
    cartilage: { base: "cartilage", sss: 0.75, sssColor: "#8fb1c4", wet: 0.65 },
    fat: { base: "fat", sss: 0.8, sssColor: "#e0a640", wet: 0.35 },
    tissue: { base: "tissue", sss: 0.6, sssColor: "#c9533f", wet: 0.5 },
    myocardium: { base: "muscle", color: "#b9473c", sss: 0.55, sssColor: "#7c1d17", wet: 0.55, sheen: 0.1 },
    artery: { base: "artery", sss: 0.5, sssColor: "#8a1c16", wet: 0.55 },
    vein: { base: "vein", sss: 0.5, sssColor: "#2c3f7a", wet: 0.55 },
    nerve: { base: "nerve", sss: 0.45, sssColor: "#b8902d", wet: 0.35, sheen: 0.3 },
    enamel: { base: "enamel", sss: 0.4, sssColor: "#d7d2c0", wet: 0.35 },
    dentin: { base: "bone", color: "#efdcae", sss: 0.4, sssColor: "#c6a05e", wet: 0.15 },
    pulp: { base: "tissue", color: "#d9675b", sss: 0.6, sssColor: "#8a2a22", wet: 0.5 },
    gum: { base: "tissue", color: "#e59a91", sss: 0.7, sssColor: "#b5463d", wet: 0.6 },
    skin: { base: "tissue", color: "#e9b9a0", sss: 0.7, sssColor: "#c0563d", wet: 0.2, sheen: 0.25 },
    dermis: { base: "tissue", color: "#f0c8b6", sss: 0.6, sssColor: "#c86a55", wet: 0.3 },
    membrane: { base: "tissue", color: "#e8d6c6", sss: 0.6, sssColor: "#b98a6a", wet: 0.45 },
    nucleus: { base: "tissue", color: "#8f78b8", sss: 0.5, sssColor: "#4b3a7a", wet: 0.4 },
    organelle: { base: "tissue", color: "#e0a28a", sss: 0.5, sssColor: "#a5503a", wet: 0.45 },
    myelin: { base: "fat", color: "#f4ecdc", sss: 0.6, sssColor: "#d7b98a", wet: 0.4 },
    lens: { base: "glass", ior: 1.41, roughness: 0.04, color: "#f3efe0" },
    cornea: { base: "glass", ior: 1.376, roughness: 0.02, color: "#f4f7f7" },
    vitreous: { base: "water", color: "#dfe9ee", opacity: 0.18 },
    iris: { base: "tissue", color: "#5d7fa6", sss: 0.35, sssColor: "#2c3f5e", wet: 0.3 },
    sclera: { base: "tissue", color: "#f4efe7", sss: 0.55, sssColor: "#d9b8a6", wet: 0.5 },
    retina: { base: "tissue", color: "#d8644f", sss: 0.6, sssColor: "#8a261c", wet: 0.6 },
    choroid: { base: "tissue", color: "#7a2c28", sss: 0.5, sssColor: "#3e0f0c", wet: 0.4 },
  };
  // A tissue material, with overrides ({ fibers: [0, 1, 0] } for a muscle along y, a color).
  const tissue = (name, extra) => ({ ...(TISSUE[name] || { base: name }), ...(extra || {}) });
  // Picks a part's material: o.materials[role] wins; o.plain makes everything porcelain
  // except the parts named in o.subject, which keep their color for the paragraph about them.
  function matFor(o, role, name, fallback) {
    if (o.materials && o.materials[role]) return o.materials[role];
    const subject = o.subject ? [].concat(o.subject) : [];
    if (o.plain && !subject.includes(name) && !subject.includes(role)) return fallback && (fallback === "glass" || fallback.base === "glass" || fallback.base === "water" || fallback === "ghost") ? "ghost" : "porcelain";
    return fallback;
  }

  // ---------- paths ----------
  const pathLen = p => p.reduce((s, q, i) => (i ? s + v3.dist(p[i - 1], q) : 0), 0);
  // n + 1 points spaced evenly along a polyline.
  function resamplePath(p, n) {
    const L = [0];
    for (let i = 1; i < p.length; i++) L.push(L[i - 1] + v3.dist(p[i - 1], p[i]));
    const total = L[L.length - 1], out = [];
    let j = 0;
    for (let k = 0; k <= n; k++) {
      const s = (total * k) / n;
      while (j < p.length - 2 && L[j + 1] < s) j++;
      out.push(vlerp(p[j], p[j + 1], (s - L[j]) / (L[j + 1] - L[j] || 1)));
    }
    return out;
  }
  const smoothPath = (pts, n) => resamplePath(pts.length > 2 ? E3.smooth(pts, { steps: 10 }) : pts, n);
  // Moves p onto the surface of f, then out along the normal by `lift` (a vessel lying on an organ).
  function onSurface(f, p, lift = 0, iters = 6) {
    let q = p.slice();
    const e = 1e-2;
    for (let it = 0; it < iters; it++) {
      const v = f.d(q[0], q[1], q[2]) - lift;
      const g = [f.d(q[0] + e, q[1], q[2]) - f.d(q[0] - e, q[1], q[2]), f.d(q[0], q[1] + e, q[2]) - f.d(q[0], q[1] - e, q[2]), f.d(q[0], q[1], q[2] + e) - f.d(q[0], q[1], q[2] - e)];
      const gl = Math.hypot(...g) / (2 * e) || 1;
      q = v3.sub(q, v3.scale(g, v / (gl * gl * 2 * e)));
      if (Math.abs(v) < 1e-4) break;
    }
    return q;
  }
  // Splits a path where it leaves the kept side of a section (keep(p) <= 0 is kept): returns
  // the pieces with the parameter range of the original path each covers, for tubes that
  // end exactly at the cut.
  function clipPath(path, keep) {
    const n = path.length, out = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), inside = keep(path[i]) <= 0;
      if (inside) { if (!cur) cur = { pts: [], t0: t }; cur.pts.push(path[i]); cur.t1 = t; }
      if (i + 1 < n && inside !== (keep(path[i + 1]) <= 0)) {
        let a = 0, b = 1;
        for (let k = 0; k < 24; k++) { const m = (a + b) / 2; if ((keep(vlerp(path[i], path[i + 1], m)) <= 0) === inside) a = m; else b = m; }
        const f = (a + b) / 2, q = vlerp(path[i], path[i + 1], f), tq = (i + f) / (n - 1);
        if (inside) { cur.pts.push(q); cur.t1 = tq; out.push(cur); cur = null; } else cur = { pts: [q], t0: tq, t1: tq };
      }
    }
    if (cur) out.push(cur);
    return out.filter(c => c.pts.length > 1);
  }
  // Tubes along paths, clipped by a section: r is a number or a function of the original t.
  const clippedTubes = (paths, r, keep, o = {}) => merge(paths.flatMap(path => clipPath(path, keep).map(c => tube(c.pts, t => (typeof r === "function" ? r(lerp(c.t0, c.t1, t)) : r), o))));
  // A tube along a path with radius r (number, or t => r), solid or hollow (wall > 0).
  const tube = (path, r, { wall = 0, segments = 18 } = {}) => {
    const ro = typeof r === "function" ? r : () => r;
    return P.tube(path, ro, wall > 0 ? t => Math.max(ro(t) - wall, ro(t) * 0.4) : 0, { segments: segs(segments, 6) });
  };
  // Ellipse cross-section points: half-width a (across), half-thickness b (along `up`).
  const ellipse = (a, b, n) => Array.from({ length: n }, (_, i) => { const t = (i / n) * TAU; return [a * Math.cos(t), b * Math.sin(t)]; });
  // A small low-poly sphere mesh at p (organelles, boutons, ribosomes), merged in bulk.
  const ball = (p, r, n = 8) => xf(mesh.sphere(r, { segments: segs(n, 4) }), T(p));

  // ---------- muscle ----------
  // A muscle from origin to insertion through optional via points (where it wraps over a
  // bone or the globe), with a fusiform belly tapering into a flat tendon at each end.
  // o: belly (half-thickness of the belly), width (half-width, default 1.5 × belly),
  //    tendonLength (one number or [at origin, at insertion]; default 15% of the length each),
  //    tendon / tendonWidth (tendon half-thickness and half-width), pennation (fiber angle to
  //    the line of pull, radians), up (which way the belly's thickness faces), shape (bulge
  //    exponent: below 1 fuller, above 1 more spindle-like), via.
  // Returns { mesh, path, length, fibers } with fibers the mean fiber direction.
  function muscle(origin, insertion, o = {}) {
    const path = smoothPath([origin, ...(o.via || []), insertion], segs(o.stations ?? 30, 10));
    const n = path.length, L = pathLen(path);
    const tl = Array.isArray(o.tendonLength) ? o.tendonLength : [o.tendonLength ?? L * 0.15, o.tendonLength ?? L * 0.15];
    const rb = o.belly ?? L * 0.08, wb = o.width ?? rb * 1.5;
    const rt = o.tendon ?? Math.max(rb * 0.16, 1e-3);
    // tendonWidth: one number or [at origin, at insertion].
    const wtA = Array.isArray(o.tendonWidth) ? o.tendonWidth : [o.tendonWidth ?? Math.max(wb * 0.45, rt * 1.3), o.tendonWidth ?? Math.max(wb * 0.45, rt * 1.3)];
    const shape = o.shape ?? 0.75, sect = segs(o.segments ?? 16, 8);
    const S = [0];
    for (let i = 1; i < n; i++) S.push(S[i - 1] + v3.dist(path[i - 1], path[i]));
    const f = s => {
      const b0 = tl[0], b1 = L - tl[1];
      if (s <= b0 || s >= b1) return 0;
      const q = (s - b0) / (b1 - b0);
      return Math.pow(Math.sin(Math.PI * q), shape);
    };
    // The musculotendinous junction blends over a short stretch rather than a step.
    const prof = i => { const s = S[i], k = Math.max(L * 0.04, 1e-6); return (f(s - k) + 2 * f(s) + f(s + k)) / 4; };
    const m = mesh.sweep(path, (t, i) => { const q = prof(i), wt = lerp(wtA[0], wtA[1], S[i] / L); return ellipse(lerp(wt, wb, q), lerp(rt, rb, q), sect); }, { up: o.up || null, caps: true, crease: 80 });
    const dir = v3.norm(v3.sub(path[n - 1], path[0]));
    let fibers = dir;
    if (o.pennation) {
      const side = v3.norm(v3.cross(dir, o.up || (Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])));
      fibers = v3.norm(v3.add(v3.scale(dir, Math.cos(o.pennation)), v3.scale(side, Math.sin(o.pennation))));
    }
    return { mesh: m, path, length: L, fibers };
  }

  // ---------- vessel and dendrite trees ----------
  // A branching tree whose radii follow Murray's law, r^n = r1^n + r2^n (n = 3 for blood
  // vessels; 1.5 is Rall's law for dendrites), and whose two children leave at the angles
  // that minimize the work of flow: cos θ1 = (r⁴ + r1⁴ − r2⁴) / (2 r² r1²), likewise θ2.
  // o: root, dir, radius, length, depth, exponent, ratio (smaller child's radius over the
  //    larger's), taper (radius kept along a segment), curl (random bend), seed, minRadius,
  //    project (p => p, keeps the tree on a surface), lengthRatio.
  // Returns { segments: [{ path, r0, r1, level, parent }], mesh(o) } where mesh() builds tubes.
  function vesselTree(o) {
    const R = rng(o.seed ?? 3), nExp = o.exponent ?? 3, ratio = o.ratio ?? 0.72, taper = o.taper ?? 0.94;
    const depth = o.depth ?? 4, minR = o.minRadius ?? 0, curl = o.curl ?? 0.25, lr = o.lengthRatio ?? 0.85;
    const out = [];
    const perp = d => v3.norm(v3.cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const rot = (v, axis, a) => { const k = v3.norm(axis), c = Math.cos(a), s = Math.sin(a); return v3.add(v3.add(v3.scale(v, c), v3.scale(v3.cross(k, v), s)), v3.scale(k, v3.dot(k, v) * (1 - c))); };
    function grow(a, dir, r, len, level, roll, parent) {
      const pts = [a];
      let d = v3.norm(dir), p = a;
      const steps = 6;
      for (let k = 1; k <= steps; k++) {
        const jitter = [R() - 0.5, R() - 0.5, R() - 0.5];
        d = v3.norm(v3.add(d, v3.scale(jitter, curl)));
        p = v3.add(p, v3.scale(d, len / steps));
        if (o.project) { p = o.project(p); d = v3.norm(v3.sub(p, pts[pts.length - 1])); }
        pts.push(p);
      }
      const rEnd = r * taper, idx = out.length;
      out.push({ path: pts, r0: r, r1: rEnd, level, parent });
      if (level >= depth || rEnd < minR * 1.5) return;
      const r1 = rEnd / Math.pow(1 + Math.pow(ratio, nExp), 1 / nExp), r2 = r1 * ratio;
      const c1 = clamp((rEnd ** 4 + r1 ** 4 - r2 ** 4) / (2 * rEnd * rEnd * r1 * r1), -1, 1);
      const c2 = clamp((rEnd ** 4 + r2 ** 4 - r1 ** 4) / (2 * rEnd * rEnd * r2 * r2), -1, 1);
      const axis = rot(perp(d), d, roll);
      const d1 = rot(d, axis, Math.acos(c1)), d2 = rot(d, axis, -Math.acos(c2));
      const next = roll + 2.39996 + (R() - 0.5) * 0.6;
      grow(p, d1, r1, len * Math.pow(r1 / r, 0.9) * lr * (0.85 + 0.3 * R()), level + 1, next, idx);
      if (r2 >= minR) grow(p, d2, r2, len * Math.pow(r2 / r, 0.9) * lr * (0.85 + 0.3 * R()), level + 1, next + 1.3, idx);
    }
    grow(o.root, o.dir, o.radius, o.length, 0, R() * TAU, -1);
    return {
      segments: out,
      mesh: (m = {}) => merge(out.map(s => tube(s.path, t => lerp(s.r0, s.r1, t), { segments: Math.max(6, Math.round((m.segments ?? 12) * Math.min(1, Math.sqrt(s.r0 / out[0].r0) + 0.3))) }))),
      // A smooth version with blended junctions, as an implicit surface.
      sdf: (k = 0.4) => sd.smooth(k * (o.radius ?? 1) * 0.3, ...out.map(s => sd.tube(s.path, s.path.map((_, i) => lerp(s.r0, s.r1, i / (s.path.length - 1)))))),
    };
  }

  // ---------- long bones ----------
  // A long bone from its outer shape: a cortical shell (thick along the shaft, thin at the
  // ends), cancellous bone filling the ends, and a marrow cavity in the shaft, as three
  // closed meshes so a section shows all three. o: shaft ([end, end], the shaft's axis; the
  // cavity runs between 20% and 80% of it), cortex (number, or [shaft, ends]), h,
  // trabecular (a lattice of struts in the cancellous bone, for close-ups), period.
  // Returns { solid, cortical(), cancellous(), marrow(), outer, inner }: the solid outer bone for
  // a closed view, and the shell and cores (built on first call). With o.section ({ n, d }: keep
  // n·p <= d), they're a section: the bone cut as a solid whose cut face is cortical bone, and
  // the cores cut 0.15 mm proud of it, so they show inside a cortical ring.
  function longBone(outer, o = {}) {
    const [A, B] = o.shaft, ax = v3.sub(B, A), L = v3.len(ax), u = v3.scale(ax, 1 / L);
    const [tS, tE] = Array.isArray(o.cortex) ? o.cortex : [o.cortex ?? 3, (o.cortex ?? 3) * 0.35];
    const q = (x, y, z) => ((x - A[0]) * u[0] + (y - A[1]) * u[1] + (z - A[2]) * u[2]) / L;
    const t = (x, y, z) => { const s = q(x, y, z); return lerp(tE, tS, sstep(0.1, 0.3, s) * (1 - sstep(0.7, 0.9, s))); };
    const inner = sd.field((x, y, z) => outer.d(x, y, z) + t(x, y, z), outer.min, outer.max);
    const cortical = sd.field((x, y, z) => { const v = outer.d(x, y, z); return Math.max(v, -(v + t(x, y, z))); }, outer.min, outer.max);
    const inShaft = (x, y, z) => { const s = q(x, y, z); return Math.max((0.2 - s) * L, (s - 0.8) * L); };
    const h = o.h ?? 1.2, hc = o.coreH ?? h * 1.35;
    const S0 = o.section ? { n: v3.norm(o.section.n), d: o.section.d / v3.len(o.section.n) } : null;
    const cut = (f, lift = 0) => (S0 ? sd.intersect(f, sd.plane(S0.n, S0.d + lift)) : f);
    const caps = lift => (S0 ? [{ n: S0.n, d: S0.d + lift }] : null);
    let cort = null, canc = null, marr = null;
    return {
      outer, inner,
      solid: polygonize(outer, { h }),
      cortical() { return cort || (cort = S0 ? polygonize(cut(outer), { h, caps: caps(0) }) : polygonize(cortical, { h })); },
      cancellous() {
        if (canc) return canc;
        let f = sd.field((x, y, z) => smax(inner.d(x, y, z), -inShaft(x, y, z), 2), outer.min, outer.max);
        if (o.trabecular) f = sd.intersect(f, sd.gyroid(o.period ?? 5, 0.35, outer.min, outer.max));
        return (canc = polygonize(cut(f, 0.15), { h: o.trabecular ? Math.min(hc, (o.period ?? 5) / 6) : hc, caps: caps(0.15) }));
      },
      marrow() { return marr || (marr = polygonize(cut(sd.field((x, y, z) => smax(inner.d(x, y, z), inShaft(x, y, z), 2), outer.min, outer.max), 0.15), { h: hc, caps: caps(0.15) })); },
    };
  }

  // Parts whose meshes are built only when first shown (section variants, bone interiors).
  function lazyPart(node, make) {
    node._lazy = make;
    return node;
  }
  function realize(node) {
    if (node && node._lazy) { node.mesh = node._lazy(); node._lazy = null; }
    return node;
  }
  // Every node of an assembly that holds a mesh and is showing.
  function visibleMeshes(root) {
    const out = [];
    const walk = n => { if (!n.visible) return; if (n.mesh) out.push(n.mesh); for (const c of n.children) walk(c); };
    walk(root);
    return out;
  }
  const triangles = root => visibleMeshes(root).reduce((s, m) => s + m.indices.length / 3, 0);

  // A "section" helper shared by assemblies: a node holding a whole mesh and a cut one
  // (built on first use); swap(on) shows one or the other.
  function sectioned(asm, name, whole, cutSdf, opts) {
    const g = asm.part(name, null, opts);
    const full = g.add(whole, { name, material: opts.material });
    const cut = lazyPart(g.add(null, { name, material: opts.material, visible: false }), cutSdf);
    asm._sections.push([full, cut]);
    return g;
  }
  function sectionable(asm) {
    asm._sections = [];
    asm._interior = [];
    const base = asm.cutaway;
    asm.cutaway = (on = true) => {
      base(on);
      for (const [f, c] of asm._sections) { if (on) realize(c); f.visible = !on; c.visible = !!on; }
      for (const n of asm._interior) { if (on) realize(n); n.visible = !!on; }
      return asm;
    };
    return asm;
  }

  // ---------- valve leaflets ----------
  // A leaflet hinged on an annulus arc [a0, a1] (radians, in the annulus plane) of a valve
  // with center C, axis ax (pointing downstream) and radius r. closed(u) gives the free edge
  // point where the leaflet meets its neighbors; open hangs it downstream along the wall.
  // o: length (hinge to free edge when open), dome (bulge upstream when closed, mm), pocket
  // (semilunar cusps sag upstream in the middle), crown (commissures rise this far
  // downstream: semilunar valves), thickness, openness (0 shut, 1 open).
  function leaflet(C, ax, r, a0, a1, closedAt, o) {
    const w = v3.norm(ax), e1 = v3.norm(v3.cross(w, Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = v3.cross(w, e1);
    const dirAt = a => v3.add(v3.scale(e1, Math.cos(a)), v3.scale(e2, Math.sin(a)));
    const op = clamp(o.openness ?? 0, 0, 1), ease = op * op * (3 - 2 * op);
    const f = (u, v) => {
      const a = lerp(a0, a1, u), dir = dirAt(a);
      const crown = (o.crown ?? 0) * (1 - Math.sin(Math.PI * u));
      const H = v3.add(v3.add(C, v3.scale(dir, r)), v3.scale(w, crown));
      const F = closedAt(u, a, dir);
      const bulge = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      const shut = v3.add(v3.add(vlerp(H, F, v), v3.scale(w, -(o.dome ?? 0) * bulge)), v3.scale(w, -(o.pocket ?? 0) * bulge));
      // Open, a leaflet hangs downstream and in (a funnel), longest at its middle.
      const len = (o.length ?? r) * (o.crown ? 1 : 0.62 + 0.38 * Math.sin(Math.PI * u));
      const open = v3.add(v3.add(H, v3.scale(w, v * len)), v3.scale(dir, -(o.inset ?? 0.12) * r * v * v + 0.6 * Math.sin(Math.PI * v)));
      return vlerp(shut, open, ease);
    };
    return { mesh: sheet(f, { nu: o.nu ?? 14, nv: o.nv ?? 8, thickness: o.thickness ?? 1 }), freeEdge: u => f(u, 1), point: f };
  }

  // ---------- heart ----------
  // An adult human heart, about 120 mm base to apex, in its anatomical position (apex to the
  // patient's left, front, and down). +x is the patient's left, +y up, +z the front.
  // pose({ phase }) runs one cardiac cycle (0 to 1, about 0.8 s at 75 beats a minute): atrial
  // systole, isovolumetric contraction, ejection, isovolumetric relaxation, filling, with the
  // four valves opening and closing on the Wiggers timing. cutaway(on) opens a frontal section
  // through the four chambers. o: upright (long axis vertical instead of anatomical), plain,
  // subject, materials, detail.
  function heart(o = {}) {
    const A = sectionable(P.assembly(o.name ?? "heart", o));
    const M = (role, name, fb) => matFor(o, role, name, fb);
    const h = o.h ?? 1.25;
    // The heart's own frame: base plane at y = 0, ventricular long axis along -y.
    const H = A.group("heart frame", { rotation: o.upright ? [0, 0, 0] : [-20 * DEG, 0, 40 * DEG] });
    // End-diastolic cavities and walls (LV wall 11 mm, RV free wall 4 mm, atria 2.5 mm).
    const LVc = sd.ellipsoid([12, 0, -8], [26, 78, 24]), LVo = sd.ellipsoid([12, 2, -8], [37, 88, 35]);
    const RVe = sd.ellipsoid([-8, 0, 8], [34, 63, 30]), RVo = sd.ellipsoid([-8, 2, 8], [38, 70, 34]);
    const RVOTc = sd.cone([-8, -8, 22], [5, 20, 21], 13, 11.5), RVOTo = sd.cone([-8, -8, 22], [5, 20, 21], 17, 15);
    const below = y0 => sd.plane([0, 1, 0], y0);
    const LVcav = sd.intersect(LVc, below(-0.5), 3);
    const RVcav = sd.union(sd.intersect(sd.subtract(RVe, LVo, 3), below(-0.5), 3), sd.subtract(RVOTc, LVo, 2));
    // Valve positions (heart frame): annulus center, axis downstream, radius.
    const V = {
      mitral: { c: [20, 1.5, -18], ax: [0, -1, 0], r: 13 },
      tricuspid: { c: [-24, 1.5, 2], ax: [0, -1, 0], r: 15 },
      aortic: { c: [1, 2, 2], ax: v3.norm([-0.25, 1, 0.15]), r: 11.5 },
      pulmonary: { c: [5.5, 21, 21], ax: v3.norm([0.45, 1, -0.1]), r: 12 },
    };
    const channel = (v, back, fwd) => sd.capsule(v3.add(v.c, v3.scale(v.ax, -back)), v3.add(v.c, v3.scale(v.ax, fwd)), v.r);
    const chans = sd.union(channel(V.mitral, 7, 6), channel(V.tricuspid, 7, 6), channel(V.aortic, 6, 9), channel(V.pulmonary, 8, 6));
    const ventricles = sd.intersect(sd.smooth(8, LVo, RVo, RVOTo), below(4), 4);
    const cavities = sd.union(LVcav, RVcav, chans);
    // The ventricular mass is split between the two ventricles by which outer surface each
    // point is nearer, so the two meshes meet on one smooth surface (a clean groove line).
    const side = sd.field((x, y, z) => RVo.d(x, y, z) - LVo.d(x, y, z), ventricles.min, ventricles.max);
    const lvWall = sd.subtract(sd.intersect(ventricles, sd.field((x, y, z) => -side.d(x, y, z), ventricles.min, ventricles.max)), cavities);
    const rvWall = sd.subtract(sd.intersect(ventricles, side), cavities);
    // Atria and their appendages.
    const LAc = sd.smooth(4, sd.ellipsoid([18, 22, -26], [22, 17, 17]), sd.ellipsoid([38, 24, -6], [9, 5, 5], RY(-0.6)));
    const RAc = sd.smooth(4, sd.ellipsoid([-27, 18, -4], [21, 20, 19]), sd.ellipsoid([-14, 30, 16], [10, 6, 5], RY(0.5)));
    const LAo = sd.offset(LAc, 2.8), RAo = sd.offset(RAc, 2.6);
    const above = y0 => sd.plane([0, -1, 0], -y0);
    const vesselHoles = [];
    // Great vessels (centerlines in the heart frame, radii in mm).
    const aortaPath = smoothPath([[1, 2, 2], [-3, 28, 6], [-2, 54, 2], [6, 70, -14], [16, 66, -38], [18, 46, -54], [16, 0, -58], [14, -50, -58]], segs(70, 24));
    const aortaR = t => (t < 0.04 ? 13.5 + 2 * Math.sin((t / 0.04) * Math.PI) : t < 0.5 ? 14 : lerp(14, 11, (t - 0.5) / 0.5));
    const ptPath = smoothPath([[5.5, 21, 21], [12, 34, 16], [15, 44, 6]], segs(20, 8));
    const lpa = smoothPath([[15, 44, 6], [30, 50, -6], [46, 48, -18]], segs(16, 6)), rpa = smoothPath([[15, 44, 6], [0, 48, -10], [-30, 46, -16]], segs(18, 6));
    const svc = smoothPath([[-28, 88, -6], [-27, 52, -6], [-27, 32, -4]], segs(16, 6)), ivc = smoothPath([[-24, -44, -34], [-26, -10, -26], [-26, 5, -12]], segs(16, 6));
    const pv = [[[50, 34, -46], [30, 30, -38]], [[50, 15, -46], [30, 16, -38]], [[-14, 32, -46], [6, 30, -38]], [[-14, 13, -46], [6, 16, -38]]].map(p => smoothPath(p, 6));
    // Vessel lumens open into their chambers.
    for (const [p, r] of [[svc, 8.5], [ivc, 10.5], ...pv.map(p => [p, 5])]) vesselHoles.push(sd.capsule(p[Math.max(0, p.length - 3)], p[p.length - 1], r));
    const atrialCav = sd.union(LAc, RAc, ...vesselHoles, channel(V.mitral, 3, 9), channel(V.tricuspid, 3, 9));
    const laWall = sd.subtract(sd.intersect(LAo, above(-3), 3), atrialCav);
    const raWall = sd.subtract(sd.intersect(RAo, above(-3), 3), atrialCav);
    // Ventricles scale about the base (pivot) as the cycle runs; atria about their floor.
    const vent = A.group("ventricles", { pivot: [0, 4, 0], parent: H });
    const atria = A.group("atria", { pivot: [0, 4, -10], parent: H, explode: [0, 50, -20] });
    const frontal = z => sd.plane([0, 0, 1], z); // keeps z <= zc: removes the front of the heart
    const zc = o.section ?? 4;
    const cutOf = (f, hh = h) => () => polygonize(sd.intersect(f, frontal(zc)), { h: hh * 0.85, caps: [{ n: [0, 0, 1], d: zc }] });
    const ha = h * 0.78; // the thin atrial walls need a finer grid
    const myo = M("myocardium", "left ventricle", tissue("myocardium", { fibers: [0.5, -0.8, 0.3] }));
    sectioned(A, "left ventricle", polygonize(lvWall, { h }), cutOf(lvWall), { parent: vent, material: myo, label: { text: "left ventricle", at: [44, -40, -6] }, note: "the thickest wall in the heart: it pumps blood out through the aorta to the whole body" });
    sectioned(A, "right ventricle", polygonize(rvWall, { h }), cutOf(rvWall), { parent: vent, material: M("myocardium", "right ventricle", myo), label: { text: "right ventricle", at: [-30, -24, 30] }, note: "pumps blood to the lungs; its wall is a third as thick as the left" });
    const atrialMat = M("myocardium", "atria", tissue("myocardium", { color: "#c45e52" }));
    sectioned(A, "left atrium", polygonize(laWall, { h: ha }), cutOf(laWall, ha), { parent: atria, material: atrialMat, label: { text: "left atrium", at: [40, 28, -26] }, note: "collects blood back from the lungs through four pulmonary veins" });
    sectioned(A, "right atrium", polygonize(raWall, { h: ha }), cutOf(raWall, ha), { parent: atria, material: atrialMat, label: { text: "right atrium", at: [-48, 18, -4] }, note: "collects blood from the body through the venae cavae" });
    // Septum label: inside, on the wall between the ventricles.
    A.part("interventricular septum", null, { parent: vent, label: { text: "interventricular septum", at: [-4, -30, 0], inside: true }, note: "the muscular wall between the two ventricles" });
    // Great vessels: hollow tubes.
    const art = M("artery", "aorta", tissue("artery")), ven = M("vein", "veins", tissue("vein"));
    const vessel = (name, path, r, mat, extra = {}) => A.part(name, tube(path, r, { wall: extra.wall ?? 2, segments: 28 }), { parent: H, material: mat, explode: extra.explode, label: extra.label, note: extra.note });
    vessel("aorta", aortaPath, aortaR, art, { explode: [0, 40, 0], label: { text: "aorta", at: aortaPath[Math.round(aortaPath.length * 0.36)] }, note: "carries oxygenated blood from the left ventricle to the body; about 28 mm across" });
    const arch = (t0, end, r, name) => { const s = aortaPath[Math.round(aortaPath.length * t0)]; return vessel(name, smoothPath([s, vlerp(s, end, 0.5), end], 10), r, art, { wall: 1.2, explode: [0, 40, 0], note: `a branch of the aortic arch, about ${Math.round(r * 2)} mm across` }); };
    arch(0.3, [-14, 104, -2], 6, "brachiocephalic trunk");
    arch(0.35, [12, 104, -16], 4, "left common carotid artery");
    arch(0.4, [32, 98, -32], 5, "left subclavian artery");
    vessel("pulmonary trunk", ptPath, 13, M("artery", "pulmonary trunk", tissue("artery", { color: "#7b8fc2" })), { explode: [0, 40, 20], label: { text: "pulmonary trunk", at: ptPath[Math.round(ptPath.length * 0.6)] }, note: "carries deoxygenated blood from the right ventricle toward the lungs" });
    vessel("left pulmonary artery", lpa, 10, M("artery", "pulmonary trunk", tissue("artery", { color: "#7b8fc2" })), { wall: 1.5, explode: [0, 40, 20] });
    vessel("right pulmonary artery", rpa, 10, M("artery", "pulmonary trunk", tissue("artery", { color: "#7b8fc2" })), { wall: 1.5, explode: [0, 40, 20] });
    vessel("superior vena cava", svc, 10, ven, { wall: 1.5, explode: [0, 50, -20], label: { text: "superior vena cava", at: svc[2] }, note: "returns blood from the head and arms" });
    vessel("inferior vena cava", ivc, 12, ven, { wall: 1.5, explode: [0, -20, -20], label: { text: "inferior vena cava", at: ivc[2] }, note: "returns blood from the lower body" });
    A.part("pulmonary veins", merge(pv.map(p => tube(p, 6.5, { wall: 1.2, segments: 20 }))), { parent: H, material: M("vein", "pulmonary veins", tissue("vein", { color: "#c86a63" })), explode: [0, 50, -20], label: { text: "pulmonary veins", at: pv[0][1] }, note: "four veins bringing oxygenated blood from the lungs to the left atrium" });
    // Coronary circulation, lying on the outer surface (projected onto it).
    const epi = sd.intersect(sd.smooth(8, LVo, RVo), below(4), 4);
    const onHeart = (pts, r, n) => smoothPath(pts, n).map(p => onSurface(epi, p, r * 0.8));
    const cor = M("artery", "coronary arteries", tissue("artery", { color: "#c2352b" })), cv = M("vein", "coronary veins", tissue("vein"));
    const rca = onHeart([[-10, 4, 12], [-26, 3, 22], [-40, 0, 8], [-44, -2, -12], [-28, -1, -30], [-8, -30, -38], [2, -60, -30]], 1.8, 40);
    const lad = onHeart([[8, 4, 10], [8, -6, 24], [3, -26, 30], [0, -52, 26], [5, -76, 12]], 1.8, 36);
    const lcx = onHeart([[10, 4, 8], [30, 2, 14], [46, 0, -6], [44, -2, -28], [30, -4, -44]], 1.6, 30);
    const tap = (a, b) => t => lerp(a, b, t);
    const keepFront = p => p[2] - zc;
    // Vessels on the surface: whole, and clipped at the frontal section for the cutaway.
    const surfaceVessel = (name, paths, r, mat, extra = {}) => sectioned(A, name, merge(paths.map(pp => tube(pp, r, { segments: 12 }))), () => clippedTubes(paths, r, keepFront, { segments: 12 }), { parent: vent, material: mat, ...extra });
    surfaceVessel("right coronary artery", [rca], tap(1.8, 0.8), cor, { label: { text: "right coronary artery", at: rca[8] }, note: "feeds the right ventricle and, usually, the back of the septum" });
    surfaceVessel("left anterior descending artery", [lad], tap(1.9, 0.7), cor, { label: { text: "left anterior descending", at: lad[14] }, note: "runs down the front groove between the ventricles; the artery most often blocked in heart attacks" });
    surfaceVessel("circumflex artery", [lcx], tap(1.6, 0.8), cor, { note: "wraps around the left side in the groove between atrium and ventricle" });
    // Side branches (diagonals and marginals) off the main arteries, by Murray's law.
    const branchPaths = [];
    for (const [path, at, len, r] of [[lad, 0.3, 30, 1.0], [lad, 0.55, 26, 0.9], [lcx, 0.5, 28, 0.9], [rca, 0.45, 26, 0.9]]) {
      const i = Math.round(path.length * at), a = path[i], dir = v3.norm(v3.sub(path[i + 2], path[i]));
      const away = v3.norm(v3.cross(dir, v3.norm(v3.sub(a, [12, -20, -8]))));
      const tr = vesselTree({ root: a, dir: v3.norm(v3.add(v3.scale(dir, 0.6), v3.scale(away, -0.8))), radius: r, length: len, depth: 1, curl: 0.15, seed: i, project: p => onSurface(epi, p, 0.8) });
      for (const sgm of tr.segments) branchPaths.push({ path: sgm.path, r0: sgm.r0, r1: sgm.r1 });
    }
    sectioned(A, "coronary branches", merge(branchPaths.map(b => tube(b.path, t => lerp(b.r0, b.r1, t), { segments: 8 }))), () => merge(branchPaths.map(b => clippedTubes([b.path], t => lerp(b.r0, b.r1, t), keepFront, { segments: 8 }))), { parent: vent, material: cor });
    const gcv = onHeart([[14, -70, 16], [6, -46, 30], [10, -20, 30], [20, 0, 16], [44, 2, -10], [36, 0, -38], [8, 0, -40], [-20, 2, -26]], 2.2, 44);
    surfaceVessel("coronary veins", [gcv], tap(1.2, 3), cv, { note: "the great cardiac vein and the coronary sinus, which drains into the right atrium" });
    // Papillary muscles: from the ventricular wall up into the cavity, holding the chordae.
    const pap = [
      { name: "anterolateral papillary muscle", base: [34, -54, -8], tip: [28, -30, -12], r: 6, valve: "mitral" },
      { name: "posteromedial papillary muscle", base: [10, -56, -26], tip: [12, -32, -24], r: 6, valve: "mitral" },
      { name: "anterior papillary muscle", base: [-24, -38, 17], tip: [-26, -22, 9], r: 4, valve: "tricuspid" },
      { name: "septal papillary muscle", base: [-12, -28, 5], tip: [-17, -17, 4], r: 2.6, valve: "tricuspid" },
    ];
    const papillary = A.part("papillary muscles", merge(pap.map(p => polygonize(sd.displace(sd.cone(p.base, p.tip, p.r, p.r * 0.45), 0.3, 0.6, 7), { h: 0.8 }))), { parent: vent, material: myo, label: { text: "papillary muscle", at: pap[0].tip, inside: true }, note: "muscles that pull on the chordae so the valve leaflets don't flip back into the atria" });
    // Valves: leaflets rebuilt (and cached) as they open and close.
    const valveMat = M("valve", "valves", tissue("tendon", { color: "#f1e4c8", sss: 0.6 }));
    const vg = {}, chordae = {};
    const W = v => { const w = v3.norm(v.ax), e1 = v3.norm(v3.cross(w, Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); return { w, e1, e2: v3.cross(w, e1) }; };
    const LEAF = {
      mitral: { leaves: [["anterior leaflet", 0.95, 3.1], ["posterior leaflet", 3.1, 0.95 + TAU]], length: 18, dome: 2.5 },
      tricuspid: { leaves: [["anterior leaflet", 0.3, 2.4], ["posterior leaflet", 2.4, 4.4], ["septal leaflet", 4.4, 0.3 + TAU]], length: 15, dome: 2 },
      aortic: { leaves: [["right coronary cusp", 0, TAU / 3], ["left coronary cusp", TAU / 3, (2 * TAU) / 3], ["non-coronary cusp", (2 * TAU) / 3, TAU]], length: 12, pocket: 5, crown: 9 },
      pulmonary: { leaves: [["anterior cusp", 0.5, 0.5 + TAU / 3], ["left cusp", 0.5 + TAU / 3, 0.5 + (2 * TAU) / 3], ["right cusp", 0.5 + (2 * TAU) / 3, 0.5 + TAU]], length: 12, pocket: 5, crown: 9 },
    };
    const leafCache = new Map();
    const buildLeaves = (key, open) => {
      const q = Math.round(open * 20) / 20, ck = `${key}:${q}`;
      if (leafCache.has(ck)) return leafCache.get(ck);
      const v = V[key], L = LEAF[key], { e1, e2 } = W(v);
      const dirAt = a => v3.add(v3.scale(e1, Math.cos(a)), v3.scale(e2, Math.sin(a)));
      const res = L.leaves.map(([name, a0, a1]) => {
        // Closed free edges meet at the center (the coaptation lines run out to the commissures).
        const closedAt = (u, a) => {
          const c0 = v3.add(v.c, v3.scale(dirAt(a0), v.r * 0.85)), c1 = v3.add(v.c, v3.scale(dirAt(a1), v.r * 0.85));
          const mid = v3.add(v.c, v3.scale(v.ax, (L.crown ? L.crown * 0.55 : 0) + (L.pocket ? 0 : 4)));
          return u < 0.5 ? vlerp(c0, mid, u * 2) : vlerp(mid, c1, u * 2 - 1);
        };
        const lf = leaflet(v.c, v.ax, v.r, a0, a1, closedAt, { length: L.length, dome: L.dome, pocket: L.pocket, crown: L.crown, openness: q, thickness: key === "mitral" ? 1.3 : 1, inset: L.crown ? 0.12 : 0.42 });
        return { name, mesh: lf.mesh, edge: [0.2, 0.35, 0.5, 0.65, 0.8].map(u => lf.freeEdge(u)) };
      });
      leafCache.set(ck, res);
      return res;
    };
    const vsc = { sr: 1, sl: 1 };
    const inVent = p => [p[0] * vsc.sr, 4 + (p[1] - 4) * vsc.sl, p[2] * vsc.sr];
    for (const key of Object.keys(V)) {
      const g = A.part(`${key} valve`, null, { parent: H, explode: v3.scale(V[key].ax, key === "aortic" || key === "pulmonary" ? 30 : -30), label: { text: `${key} valve`, at: V[key].c, inside: true }, note: {
        mitral: "two leaflets between the left atrium and ventricle; shut while the ventricle squeezes",
        tricuspid: "three leaflets between the right atrium and ventricle",
        aortic: "three pocket-shaped cusps; open while the left ventricle ejects, shut the rest of the time",
        pulmonary: "three cusps at the outflow of the right ventricle into the pulmonary trunk",
      }[key] });
      vg[key] = { group: g, leaves: LEAF[key].leaves.map(([name]) => g.add(null, { name, material: valveMat })), open: 0 };
      if (key === "mitral" || key === "tricuspid") chordae[key] = g.add(null, { name: `${key} chordae`, material: M("tendon", "chordae", tissue("tendon")) });
    }
    const setValve = (key, open) => {
      const res = buildLeaves(key, open);
      vg[key].open = open;
      res.forEach((r, i) => { vg[key].leaves[i].mesh = r.mesh; });
      if (chordae[key]) {
        const tips = pap.filter(p => p.valve === key).map(p => inVent(p.tip));
        const cords = [];
        res.forEach(r => r.edge.forEach((p, j) => { const tip = tips[j % tips.length]; cords.push(tube([p, vlerp(p, tip, 0.5), tip], 0.35, { segments: 5 })); }));
        chordae[key].mesh = merge(cords);
      }
    };
    // The cardiac cycle (Wiggers): left ventricular volume as a fraction of end-diastolic
    // volume (120 mL), and when each valve is open.
    const EDV = 120, ESV = 50;
    const ramp = (p, a, b) => sstep(a, b, p);
    const lvFraction = p => {
      const f0 = 0.92, ef = ESV / EDV;
      if (p < 0.12) return lerp(f0, 1, ramp(p, 0.02, 0.11));
      if (p < 0.16) return 1;
      if (p < 0.44) return lerp(1, ef, ramp(p, 0.16, 0.44));
      if (p < 0.5) return ef;
      if (p < 0.65) return lerp(ef, 0.83, ramp(p, 0.5, 0.65));
      return lerp(0.83, f0, ramp(p, 0.65, 1));
    };
    const avOpen = p => (p < 0.12 ? 1 - ramp(p, 0.1, 0.125) : p < 0.49 ? 0 : ramp(p, 0.49, 0.53));
    const slOpen = p => (p < 0.16 ? 0 : p < 0.43 ? ramp(p, 0.16, 0.19) : 1 - ramp(p, 0.43, 0.46));
    A.state = {};
    A.onPose = s => {
      const p = (((s.phase ?? A.state.phase ?? 0.7) % 1) + 1) % 1;
      const f = lvFraction(p);
      vsc.sr = Math.pow(f, 0.4); vsc.sl = Math.pow(f, 0.2);
      vent.scale = [vsc.sr, vsc.sl, vsc.sr];
      const as = 1 - 0.08 * Math.sin(Math.PI * ramp(p, 0.0, 0.12)) * (p < 0.13 ? 1 : 0) + 0.03 * Math.sin(Math.PI * clamp((p - 0.16) / 0.34, 0, 1));
      atria.scale = [as, as, as];
      const av = avOpen(p), sl = slOpen(p);
      setValve("mitral", av); setValve("tricuspid", av); setValve("aortic", sl); setValve("pulmonary", sl);
      const phaseName = p < 0.12 ? "atrial systole" : p < 0.16 ? "isovolumetric contraction" : p < 0.44 ? "ejection" : p < 0.5 ? "isovolumetric relaxation" : "ventricular filling";
      Object.assign(A.state, { phase: p, name: phaseName, lvVolume: f * EDV, mitral: av, tricuspid: av, aortic: sl, pulmonary: sl });
    };
    A.valves = vg;
    // Ports: where blood enters and leaves (for flow particles).
    const portAt = (name, path, r, out) => { const a = path[out ? path.length - 2 : 1], b = path[out ? path.length - 1 : 0]; A.port(name, H, b, v3.norm(v3.sub(b, a)), r); };
    portAt("aortaOut", aortaPath, 11, true); portAt("svcIn", svc, 10, false); portAt("ivcIn", ivc, 12, false);
    portAt("lpaOut", lpa, 10, true); portAt("rpaOut", rpa, 10, true);
    pv.forEach((p, i) => portAt(`pulmonaryVein${i + 1}`, p, 6.5, false));
    A.section = { normal: [0, 0, 1], offset: zc, frame: "heart frame" };
    A.info = {
      units: "mm", length: 120, width: 85, depth: 60, wall: { leftVentricle: 11, rightVentricle: 4, atria: 2.5 },
      volumes: { endDiastolic: EDV, endSystolic: ESV, strokeVolume: EDV - ESV, ejectionFraction: (EDV - ESV) / EDV },
      annulus: { mitral: 26, tricuspid: 30, aortic: 23, pulmonary: 24 }, aorta: 28, cycle: 0.8,
      sources: ["Standring (ed.), Gray's Anatomy, 41st ed., 2016", "Maceira et al., J Cardiovasc Magn Reson 8 (2006) 417 (ventricular volumes)", "Hall, Guyton and Hall Textbook of Medical Physiology, 14th ed., 2020 (cycle timing)"],
    };
    A.pose({ phase: 0.7 });
    return A;
  }

  // ---------- eye ----------
  // A right human eye, 24 mm along its axis, looking along +z (cornea in front), +x lateral
  // (temporal), +y up. Profiles are revolved about the optical axis; the sagittal cutaway
  // keeps the nasal half (x <= 0) so the cut face shows every layer.
  // pose({ gaze: [yaw, pitch] (radians), pupil (diameter, mm: 2 to 8), accommodation (0 far, 1 near) }).
  function eye(o = {}) {
    const A = sectionable(P.assembly(o.name ?? "eye", o));
    const M = (role, name, fb) => matFor(o, role, name, fb);
    const Rg = 11.5, limbusR = 5.85, yL = Math.sqrt(Rg * Rg - limbusR * limbusR); // sclera radius, limbus
    const apex = yL + (7.8 - Math.sqrt(7.8 * 7.8 - limbusR * limbusR)); // corneal apex (24 mm axial length)
    const toZ = RX(Math.PI / 2); // revolve axis y -> optical axis z
    const sg = segs(96, 24);
    // Revolve a profile about the optical axis, whole or as the nasal half.
    const rev = (prof, cut, loop = true) => xf(P.revolve(prof, { segments: cut ? Math.round(sg / 2) : sg, loop, arc: cut ? Math.PI : TAU, start: Math.PI / 2 }), toZ);
    const arc = (cy, R, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return [R * Math.cos(a), cy + R * Math.sin(a)]; });
    const globe = A.group("globe");
    const layer = (name, prof, mat, opts = {}) => {
      const g = A.part(name, null, { parent: globe, ...opts });
      const whole = g.add(rev(prof, false), { name, material: mat });
      const half = lazyPart(g.add(null, { name, material: mat, visible: false }), () => rev(prof, true));
      A._sections.push([whole, half]);
      return g;
    };
    // Sclera: 0.6 mm at the back to 0.8 mm at the limbus.
    const aL = Math.atan2(yL, limbusR), scl = [...arc(0, Rg, -Math.PI / 2, aL, 40), ...arc(0, Rg - 0.7, aL, -Math.PI / 2, 40)];
    layer("sclera", scl, M("sclera", "sclera", tissue("sclera")), { label: { text: "sclera", at: [0, Rg * 0.7, -Rg * 0.7] }, note: "the tough white outer coat, about 0.6 mm thick" });
    // Cornea: anterior radius 7.8 mm, posterior 6.5 mm, 0.55 mm thick at the center.
    const ca = apex - 7.8, cp = apex - 0.55 - 6.5;
    const aEnd = Math.atan2(yL - ca, limbusR), aEnd2 = Math.atan2(yL - 0.15 - cp, limbusR - 0.45);
    const corneaProf = [...arc(ca, 7.8, Math.PI / 2, aEnd, 20), [limbusR - 0.45, yL - 0.15], ...arc(cp, 6.5, aEnd2, Math.PI / 2, 20)];
    layer("cornea", corneaProf, M("cornea", "cornea", tissue("cornea")), { label: { text: "cornea", at: [0, 3, apex - 0.6] }, note: "the clear front window; it does two thirds of the eye's focusing" });
    // Choroid and retina, inside the sclera, from the ora serrata back.
    const ora = 7.2, aO = Math.atan2(ora, Math.sqrt((Rg - 0.7) ** 2 - ora * ora));
    layer("choroid", [...arc(0, Rg - 0.7, -Math.PI / 2, aO, 36), ...arc(0, Rg - 0.95, aO, -Math.PI / 2, 36)], M("choroid", "choroid", tissue("choroid")), { note: "a layer of blood vessels and pigment that feeds the outer retina" });
    const aR = Math.atan2(ora - 0.4, Math.sqrt((Rg - 0.95) ** 2 - (ora - 0.4) ** 2));
    layer("retina", [...arc(0, Rg - 0.95, -Math.PI / 2, aR, 36), ...arc(0, Rg - 1.2, aR, -Math.PI / 2, 36)], M("retina", "retina", tissue("retina")), { label: { text: "retina", at: [Rg * 0.6, -Rg * 0.5, -Rg * 0.4], inside: true }, note: "the light-sensitive layer, about 0.25 mm thick" });
    // Vitreous: fills the eye behind the lens.
    const vit = [...arc(0, Rg - 1.2, -Math.PI / 2, Math.atan2(ora - 0.6, Math.sqrt((Rg - 1.2) ** 2 - (ora - 0.6) ** 2)), 30), [4.4, ora - 0.2], [0, 4.6]];
    layer("vitreous", [[0, -(Rg - 1.2)], ...vit.slice(1)], M("vitreous", "vitreous", tissue("vitreous")), { label: { text: "vitreous body", at: [0, -3, -3], inside: true }, note: "a clear gel that keeps the eye's shape" });
    // Ciliary body with its processes, behind the iris root.
    const cil = [[5.4, 7.6], [6.2, 8.3], [6.45, 7.9], [6.2, 6.6], [5.95, 5.9], [5.4, 6.6]];
    const ciliary = layer("ciliary body", cil, M("muscle", "ciliary body", tissue("muscle", { color: "#8b4a3a" })), { note: "its muscle changes the lens's shape to focus near or far" });
    const processes = [];
    for (let i = 0; i < segs(70, 24); i++) { const a = (i / segs(70, 24)) * TAU; processes.push(xf(mesh.box(0.25, 0.9, 1.0), RZ(a), T([5.3, 0, 7.1]))); }
    const procNode = A.part("ciliary processes", merge(processes), { parent: globe, material: M("muscle", "ciliary body", tissue("muscle", { color: "#7a3c30" })) });
    // Iris (rebuilt with the pupil): a ruffled annulus with radial ridges, slightly conical.
    const irisNode = A.part("iris", null, { parent: globe, label: { text: "iris", at: [3.8, 0, 9.3] }, note: "a ring of muscle that opens and closes the pupil" });
    const irisMat = M("iris", "iris", tissue("iris"));
    const iris = irisNode.add(null, { name: "iris", material: irisMat });
    const irisHalf = irisNode.add(null, { name: "iris", material: irisMat, visible: false });
    const irisMesh = (pr, half) => sheet((u, v) => {
      const a = half ? Math.PI / 2 + u * Math.PI : u * TAU, r = lerp(pr, 6.0, v);
      const ridge = 0.06 * Math.sin(a * 48 + 3 * Math.sin(a * 5)) * Math.sin(Math.PI * v) + 0.04 * Math.sin(a * 13);
      const z = 9.15 - 0.45 * v + 0.12 * Math.sin(Math.PI * v) + ridge;
      return [r * Math.cos(a), r * Math.sin(a), z];
    }, { nu: half ? 72 : 144, nv: 10, thickness: v => 0.42 - 0.1 * v, closedU: !half });
    // Lens (rebuilt with accommodation), after Le Grand's theoretical eye: 4.0 mm thick with
    // radii 10.2 and 6.0 mm relaxed, 4.5 mm with 6.0 and 5.5 mm fully accommodated.
    const lensNode = A.part("lens", null, { parent: globe, label: { text: "lens", at: [0, 2.2, 7.6], inside: true }, note: "a flexible lens that thickens to focus on near things" });
    const lensMat = M("lens", "lens", tissue("lens"));
    const lens = lensNode.add(null, { name: "lens", material: lensMat }), lensHalf = lensNode.add(null, { name: "lens", material: lensMat, visible: false });
    const lensProfile = acc => {
      const Ra = lerp(10.2, 6.0, acc), Rp = lerp(6.0, 5.5, acc), d = lerp(9.0, 8.6, acc) / 2, front = lerp(8.94, 8.6, acc);
      const sa = Ra - Math.sqrt(Ra * Ra - d * d), sp = Rp - Math.sqrt(Rp * Rp - d * d), band = lerp(0.92, 0.61, acc);
      const yEqA = front - sa, yEqP = yEqA - band;
      const ant = Array.from({ length: 17 }, (_, i) => { const r = (d * i) / 16; return [r, front - (Ra - Math.sqrt(Ra * Ra - r * r))]; });
      const post = Array.from({ length: 17 }, (_, i) => { const r = d - (d * i) / 16; return [r, yEqP - (sp - (Rp - Math.sqrt(Rp * Rp - r * r)))]; });
      return { prof: [...ant, ...post], thickness: front - (yEqP - sp), front, d };
    };
    // Zonules: fibers from the ciliary processes to the lens equator (rebuilt with the lens).
    const zon = A.part("zonules", null, { parent: globe, material: M("tendon", "zonules", tissue("tendon", { color: "#efe6d0" })), note: "fibers that hold the lens; they slacken when the ciliary muscle contracts" });
    // Optic disc, macula, retinal vessels (on the inner surface of the retina).
    const rIn = Rg - 1.22;
    const onRet = (th, ph) => [rIn * Math.sin(th) * Math.cos(ph), rIn * Math.sin(th) * Math.sin(ph), -rIn * Math.cos(th)]; // th from the posterior pole
    const disc = [-Math.sin(15 * DEG) * rIn, 0, -Math.cos(15 * DEG) * rIn];
    const discMesh = xf(P.revolve([[0, 0.12], [0.55, 0.16], [0.9, 0.05], [0.9, -0.05], [0, -0.05]], { segments: segs(32, 12) }), m4.alignY(v3.scale(v3.norm(disc), -1)));
    A.part("optic disc", xf(discMesh, T(disc)), { parent: globe, material: M("nerve", "optic disc", tissue("nerve", { color: "#f2d9a0" })), label: { text: "optic disc", at: disc, inside: true }, note: "where the nerve fibers leave the eye: the blind spot" });
    const mac = [0, 0, -rIn + 0.02];
    A.part("macula", xf(P.revolve([[0, 0.03], [2.6, 0.03], [2.75, 0], [0, -0.01]], { segments: segs(36, 12) }), m4.alignY([0, 0, 1]), T(mac)), { parent: globe, material: M("retina", "macula", tissue("retina", { color: "#a8543c" })), label: { text: "macula", at: mac, inside: true }, note: "5.5 mm across, the center of sharp vision; the fovea is its pit" });
    // Central retinal vessels: the temporal arcades arch above and below the macula; shorter
    // nasal branches run toward the nose. Angles: th from the posterior pole, ph around it.
    const vesselPaths = [];
    const arcade = (kind, th, ph) => { const pts = []; for (let k = 0; k <= 18; k++) { const t = k / 18; pts.push(vlerp(disc, onRet(th(t), ph(t)), Math.min(1, t * 6))); } vesselPaths.push({ kind, pts: pts.map(p => v3.scale(v3.norm(p), rIn - 0.06)) }); };
    for (const sgn of [1, -1]) {
      arcade("a", t => (15 + 52 * t) * DEG, t => Math.PI + sgn * (0.45 + 2.6 * t));
      arcade("v", t => (15 + 48 * t) * DEG, t => Math.PI + sgn * (0.62 + 2.5 * t));
      arcade("a", t => (15 + 38 * t) * DEG, t => Math.PI + sgn * (0.2 + 0.55 * t));
      arcade("v", t => (15 + 34 * t) * DEG, t => Math.PI + sgn * (0.32 + 0.6 * t));
    }
    const ret = (kind, r) => merge(vesselPaths.filter(v => v.kind === kind).map(v => tube(v.pts, t => lerp(r, r * 0.4, t), { segments: 8 })));
    A.part("retinal arteries", ret("a", 0.09), { parent: globe, material: M("artery", "retinal vessels", tissue("artery")), note: "the central retinal artery branches over the inner retina" });
    A.part("retinal veins", ret("v", 0.12), { parent: globe, material: M("vein", "retinal vessels", tissue("vein", { color: "#7a2a3a" })) });
    // Optic nerve with its sheath, from the back of the globe toward the orbital apex.
    const apexPt = [-6, 0, -42];
    const nerve = A.part("optic nerve", null, { material: M("nerve", "optic nerve", tissue("nerve", { color: "#efe2bf" })), label: { text: "optic nerve", at: [-4, 0, -24] }, note: "1.2 million nerve fibers carrying the image to the brain, about 4 mm thick" });
    // Extraocular muscles: four recti from the annulus of Zinn to insertions on the
    // spiral of Tillaux (5.5, 6.5, 6.9, 7.7 mm behind the limbus), and the two obliques.
    const insertAt = (meridian, mm) => { const th = Math.asin(limbusR / Rg) + mm / Rg; return [Rg * Math.sin(th) * Math.cos(meridian), Rg * Math.sin(th) * Math.sin(meridian), Rg * Math.cos(th)]; };
    const REC = [["medial rectus", Math.PI, 5.5], ["inferior rectus", -Math.PI / 2, 6.5], ["lateral rectus", 0, 6.9], ["superior rectus", Math.PI / 2, 7.7]];
    const musMat = M("muscle", "extraocular muscles", tissue("muscle"));
    const mus = {};
    for (const [name] of REC) mus[name] = A.part(name, null, { material: musMat, label: name, note: `${name === "medial rectus" ? "turns the eye toward the nose" : name === "lateral rectus" ? "turns the eye outward" : name === "superior rectus" ? "turns the eye up" : "turns the eye down"}` });
    mus["superior oblique"] = A.part("superior oblique", null, { material: musMat, note: "runs through a pulley (the trochlea) and turns the eye down and in" });
    mus["inferior oblique"] = A.part("inferior oblique", null, { material: musMat, note: "turns the eye up and out" });
    const trochlea = [-13, 13, 6];
    A.part("trochlea", xf(mesh.torus(1.6, 0.55, { segments: segs(20, 8) }), T(trochlea)), { material: M("cartilage", "trochlea", tissue("cartilage")), note: "the cartilage pulley of the superior oblique" });
    // The current state, so labels and tests can read it.
    A.state = {};
    const ringAround = (from, to, n) => {
      // Points from a muscle's tangent point on the globe along a great circle to `to`.
      const a = v3.norm(from), b = v3.norm(to), ang = Math.acos(clamp(v3.dot(a, b), -1, 1)), out = [];
      for (let k = 0; k <= n; k++) { const t = k / n, s = Math.sin(ang) || 1; const p = v3.add(v3.scale(a, Math.sin((1 - t) * ang) / s), v3.scale(b, Math.sin(t * ang) / s)); out.push(v3.scale(p, Rg + 0.9)); }
      return out;
    };
    A.onPose = s => {
      const gaze = s.gaze ?? A.state.gaze ?? [0, 0], pupil = clamp(s.pupil ?? A.state.pupil ?? 4, 1.5, 8.5), acc = clamp(s.accommodation ?? A.state.accommodation ?? 0, 0, 1);
      const G = mul(RY(gaze[0]), RX(-gaze[1]));
      globe.matrix = G;
      const cut = A.open;
      if (A.state.pupil !== pupil || !iris.mesh) { iris.mesh = irisMesh(pupil / 2, false); irisHalf.mesh = irisMesh(pupil / 2, true); }
      iris.visible = !cut; irisHalf.visible = cut;
      if (A.state.accommodation !== acc || !lens.mesh) {
        const L = lensProfile(acc);
        lens.mesh = rev(L.prof, false); lensHalf.mesh = rev(L.prof, true);
        const fibers = [];
        const n = segs(48, 16);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU, ce = (L.front - L.thickness * 0.45);
          const from = [5.25 * Math.cos(a), 5.25 * Math.sin(a), 7.0], to = [(L.d + 0.05) * Math.cos(a), (L.d + 0.05) * Math.sin(a), ce + (i % 2 ? 0.5 : -0.5)];
          fibers.push(tube([from, to], 0.03, { segments: 4 }));
        }
        zon.mesh = merge(fibers);
        A.state.lens = { thickness: L.thickness, anteriorRadius: lerp(10.2, 6.0, acc) };
      }
      lens.visible = !cut; lensHalf.visible = cut;
      // Muscles follow the turned globe: insertion turns with it; origin stays at the apex.
      const W = p => m4.apply(G, p);
      for (const [name, mer, mm] of REC) {
        const ins = W(insertAt(mer, mm));
        const orig = v3.add(apexPt, [Math.cos(mer) * 4, Math.sin(mer) * 4, 0]);
        // Tangent point: where the line from the origin first touches the globe on the muscle's side.
        const back = W([Math.cos(mer) * Rg * 0.92, Math.sin(mer) * Rg * 0.92, -Rg * 0.4]);
        const wrap = ringAround(back, ins, 6);
        const up = v3.norm(W([Math.cos(mer), Math.sin(mer), 0]));
        const m = muscle(orig, ins, { via: wrap.slice(0, -1), belly: 1.9, width: 4.4, tendonLength: [6, 8], tendon: 0.3, tendonWidth: [1.4, 4.9], up, stations: 40, shape: 0.6 });
        mus[name].mesh = m.mesh;
        mus[name].material = matFor(o, "muscle", name, tissue("muscle", { fibers: m.fibers }));
        A.state[name] = m.length;
      }
      {
        const insSO = W([Rg * 0.55, Rg * 0.62, -Rg * 0.55]);
        const m = muscle([-8, 5, -40], insSO, { via: [[-12, 11, -14], trochlea, W([-2, Rg + 1.4, 1])], belly: 1.2, width: 2.2, tendonLength: [4, 20], tendon: 0.35, tendonWidth: 1.4, stations: 40 });
        mus["superior oblique"].mesh = m.mesh;
        const insIO = W([Rg * 0.62, -Rg * 0.45, -Rg * 0.62]);
        const m2 = muscle([-12, -12, 7], insIO, { via: [W([-2, -Rg - 1.2, 2]), W([Rg * 0.5, -Rg * 0.95, -2])], belly: 1.3, width: 3.4, tendonLength: [2, 4], tendon: 0.3, tendonWidth: 3, stations: 34 });
        mus["inferior oblique"].mesh = m2.mesh;
      }
      // In the sagittal section the muscles of the removed (lateral) side are hidden.
      for (const name of ["lateral rectus", "inferior oblique"]) mus[name].visible = !cut;
      const dW = W(v3.scale(v3.norm(disc), Rg - 0.2));
      const nPath = smoothPath([dW, W(v3.scale(v3.norm(disc), Rg + 3)), vlerp(W(v3.scale(v3.norm(disc), Rg + 6)), apexPt, 0.35), apexPt], 24);
      nerve.mesh = tube(nPath, t => lerp(2.2, 1.8, t), { segments: 18 });
      Object.assign(A.state, { gaze, pupil, accommodation: acc });
    };
    A.port("pupil", globe, [0, 0, 9.4], [0, 0, 1], 2);
    // Cutaway swaps in the halves; refresh which iris and lens show.
    const baseCut = A.cutaway;
    A.cutaway = (on = true) => { baseCut(on); A.onPose({}); return A; };
    A.info = {
      units: "mm", axialLength: +(apex + Rg).toFixed(2), globeRadius: Rg, cornea: { diameter: 2 * limbusR, anteriorRadius: 7.8, posteriorRadius: 6.5, thickness: 0.55 },
      lens: { diameter: [9.0, 8.6], thickness: [4.0, 4.5], anteriorRadius: [10.2, 6.0], posteriorRadius: [6.0, 5.5] }, anteriorChamber: 3.05, pupil: [2, 8],
      opticDisc: { diameter: 1.8, nasalAngle: 15 }, macula: 5.5, insertions: { medialRectus: 5.5, inferiorRectus: 6.5, lateralRectus: 6.9, superiorRectus: 7.7 },
      sources: ["Atchison and Smith, Optics of the Human Eye, 2000 (Le Grand's theoretical eye)", "Apt, Trans Am Ophthalmol Soc 78 (1980) 365 (rectus insertions)", "Standring (ed.), Gray's Anatomy, 41st ed., 2016"],
    };
    void ciliary; void procNode;
    A.pose({ gaze: [0, 0], pupil: 4, accommodation: 0 });
    return A;
  }

  // ---------- knee ----------
  // A right knee: the tibia is fixed with its plateau at y = 0, +z to the front, +x lateral.
  // pose({ flex }) (radians, 0 straight to about 2.3) moves the femur by the crossed four-bar
  // linkage of the cruciate ligaments (their attachments and lengths fixed), which gives the
  // condyles their rolling and gliding; the patella tracks its groove on a tendon of fixed
  // length. cutaway(on) opens a sagittal section through the medial condyle (x = -21, the
  // lateral side kept): cortical bone, cancellous bone, marrow, and the meniscus wedges.
  function knee(o = {}) {
    const A = sectionable(P.assembly(o.name ?? "knee", o));
    const M = (role, name, fb) => matFor(o, role, name, fb);
    const h = o.h ?? 1.5, xs = o.section ?? -21;

    // Femur (distal 170 mm), in its own frame with the condyles resting on the plateau at flex 0.
    const condyle = x => sd.smooth(10, sd.ellipsoid([x, 24, -2], [14, 23, 27]), sd.ellipsoid([x, 30, -14], [13, 20, 15]));
    let femurOuter = sd.smooth(14, condyle(-21), condyle(21), sd.cone([0, 52, -2], [0, 175, 6], 24, 14), sd.ellipsoid([0, 42, 2], [36, 16, 20]));
    femurOuter = sd.subtract(femurOuter, sd.box([0, 12, -14], [9.5, 16, 22], 5), 4); // intercondylar notch
    femurOuter = sd.subtract(femurOuter, sd.capsule([0, 22, 30], [0, 66, 22], 7.5), 5); // trochlear groove
    femurOuter = sd.smooth(5, femurOuter, sd.sphere([-38, 36, -2], 7), sd.sphere([38, 36, -4], 6)); // epicondyles
    femurOuter = sd.displace(femurOuter, 0.35, 0.12, 11);
    const sec = { n: [-1, 0, 0], d: -xs };
    const fem = longBone(femurOuter, { shaft: [[0, 50, 0], [0, 175, 6]], cortex: [4.5, 1.2], h, trabecular: o.trabecular, section: sec });
    // Tibia (proximal 170 mm): plateau with two facets and the intercondylar eminence.
    let tibOuter = sd.smooth(12, sd.box([0, -13, 0], [37, 13, 25], 11), sd.cone([0, -30, 0], [0, -170, 3], 24, 14), sd.sphere([0, -32, 24], 7));
    tibOuter = sd.subtract(tibOuter, sd.ellipsoid([-20, 18.5, -2], [17, 19, 21]), 2); // medial facet, concave
    tibOuter = sd.smooth(3, tibOuter, sd.cone([-4, -2, 1], [-4, 4.5, 1], 4, 1.4), sd.cone([5, -2, -1], [5, 4, -1], 4, 1.4)); // tibial spines
    tibOuter = sd.displace(tibOuter, 0.3, 0.1, 12);
    const tib = longBone(tibOuter, { shaft: [[0, -35, 0], [0, -170, 3]], cortex: [4.5, 1.2], h, trabecular: o.trabecular, section: sec });
    const fibOuter = sd.displace(sd.smooth(6, sd.ellipsoid([33, -22, -14], [10, 9, 10]), sd.cone([33, -28, -14], [30, -170, -12], 7, 5.5)), 0.25, 0.15, 13);
    const fib = longBone(fibOuter, { shaft: [[33, -35, -14], [30, -170, -12]], cortex: [2.5, 0.8], h });
    const bone = M("bone", "bones", tissue("bone")), canc = M("cancellous", "cancellous bone", tissue("cancellous")), marrow = M("marrow", "marrow", tissue("marrow"));
    const femurG = A.group("femur", { explode: [0, 60, 0], label: { text: "femur", at: [0, 120, 16] }, note: "the thigh bone; its two rounded condyles roll and glide on the tibia" });
    const boneParts = (g, b, name) => {
      const whole = g.add(b.solid, { name, material: bone });
      const shell = lazyPart(g.add(null, { name, material: bone, visible: false }), () => b.cortical());
      A._sections.push([whole, shell]);
    };
    boneParts(femurG, fem, "femur");
    A._interior.push(lazyPart(femurG.add(null, { name: "femur cancellous bone", material: canc, visible: false }), () => fem.cancellous()), lazyPart(femurG.add(null, { name: "femur marrow", material: marrow, visible: false }), () => fem.marrow()));
    const tibG = A.group("tibia", { label: { text: "tibia", at: [0, -110, 18] }, note: "the shin bone; its plateau carries the menisci and cartilage" });
    boneParts(tibG, tib, "tibia");
    A._interior.push(lazyPart(tibG.add(null, { name: "tibia cancellous bone", material: canc, visible: false }), () => tib.cancellous()), lazyPart(tibG.add(null, { name: "tibia marrow", material: marrow, visible: false }), () => tib.marrow()));
    A.part("fibula", fib.solid, { material: bone, explode: [20, -10, 0], label: { text: "fibula", at: [34, -80, -12] }, note: "the thin outer bone of the leg; the lateral collateral ligament attaches to its head" });
    // Articular cartilage (2.5 mm on the femur, 2 mm on the tibia, 4 mm on the patella).
    const cartMat = M("cartilage", "cartilage", tissue("cartilage"));
    // Cartilage covers the condyles and the patellar groove: everything below a slanted line
    // across the front, except the intercondylar notch.
    const eN = 0.4, nxOf = (x, y, z) => { const gx = femurOuter.d(x + eN, y, z) - femurOuter.d(x - eN, y, z), gy = femurOuter.d(x, y + eN, z) - femurOuter.d(x, y - eN, z), gz = femurOuter.d(x, y, z + eN) - femurOuter.d(x, y, z - eN); return Math.abs(gx) / (Math.hypot(gx, gy, gz) || 1); };
    const femRegion = sd.field((x, y, z) => Math.max(y - 52 + 0.2 * z, z < 4 && y < 36 ? 10.5 - Math.abs(x) : -10, Math.abs(x) > 24 ? (nxOf(x, y, z) - 0.62) * 8 : -10), femurOuter.min, [femurOuter.max[0], 60, femurOuter.max[2]]);
    const femCart = sd.intersect(sd.field((x, y, z) => { const v = femurOuter.d(x, y, z); return Math.max(v - 2.4, -v); }, subv(femurOuter.min, 3), addv(femurOuter.max, 3)), femRegion, 1.2);
    const cutX = f => () => polygonize(sd.intersect(f, sd.plane(sec.n, sec.d)), { h: 1.0, caps: [sec] });
    sectioned(A, "femoral cartilage", polygonize(femCart, { h: 1.35 }), cutX(femCart), { parent: femurG, material: cartMat, label: { text: "articular cartilage", at: [-21, 1.5, 4] }, note: "smooth, slippery cartilage on the condyles and the patellar groove" });
    // Tibial cartilage: on the two facets of the plateau, not on the eminence between them.
    const tibRegion = sd.field((x, y, z) => Math.max(-0.5 - y, Math.abs(x) < 8 ? 8 - Math.abs(x) : Math.abs(x) - 34), tibOuter.min, tibOuter.max);
    const tibCart = sd.intersect(sd.field((x, y, z) => { const v = tibOuter.d(x, y, z); return Math.max(v - 2, -v); }, subv(tibOuter.min, 3), addv(tibOuter.max, 3)), tibRegion, 1);
    sectioned(A, "tibial cartilage", polygonize(tibCart, { h: 0.9 }), cutX(tibCart), { parent: tibG, material: cartMat });
    // Menisci: wedge-shaped C rings on the plateau, open toward the middle.
    const menLat = o.meniscusLateral ?? 1;
    // A meniscus as a wedge swept along a C. Cut, the path is split where it crosses the
    // section plane, so each piece's end cap is the wedge's cross-section.
    const meniscus = (cx, ra, rz, gap, mid, cutAt = null) => {
      const n = segs(48, 16), path = [];
      for (let i = 0; i <= n; i++) { const a = mid + gap / 2 + ((TAU - gap) * i) / n; path.push({ p: [cx + ra * Math.cos(a), 1.6, rz * Math.sin(a)], t: i / n }); }
      const pieces = [];
      let cur = [];
      for (let i = 0; i < path.length; i++) {
        const q = path[i], inside = cutAt == null || q.p[0] >= cutAt;
        if (inside) cur.push(q);
        const nx = path[i + 1];
        if (nx && cutAt != null && (q.p[0] >= cutAt) !== (nx.p[0] >= cutAt)) {
          const f = (cutAt - q.p[0]) / (nx.p[0] - q.p[0]), m = { p: vlerp(q.p, nx.p, f), t: lerp(q.t, nx.t, f) };
          m.p[0] = cutAt;
          cur.push(m);
          if (inside) { pieces.push(cur); cur = []; } else cur = [m];
        }
      }
      if (cur.length > 1) pieces.push(cur);
      const wedge = t => { const k = Math.sin(Math.PI * clamp(t, 0.001, 0.999)) ** 0.25; return [[-4.8 * k, -0.4], [4.8 * k, -0.4], [4.2 * k, 5.6 * k + 0.6], [3.2 * k, 6.2 * k + 0.6]]; };
      return merge(pieces.filter(pc => pc.length > 1).map(pc => mesh.sweep(pc.map(q => q.p), (_, i) => wedge(pc[i].t), { up: [0, 1, 0], caps: true, crease: 50 })));
    };
    const menMat = M("cartilage", "menisci", tissue("cartilage", { color: "#eef0e6", sssColor: "#b5b9a0" }));
    const menG = A.group("menisci", { parent: tibG, explode: [0, 15, 0] });
    sectioned(A, "medial meniscus", meniscus(-21, 15, 20, 1.1, 0), () => meniscus(-21, 15, 20, 1.1, 0, xs), { parent: menG, material: menMat, label: { text: "medial meniscus", at: [-36, 3, 4] }, note: "a C-shaped cushion of fibrocartilage that spreads the load on the medial plateau" });
    A.part("lateral meniscus", meniscus(21, 13 * menLat, 15, 0.55, Math.PI), { parent: menG, material: menMat, label: { text: "lateral meniscus", at: [34, 3, 4] }, note: "nearly a ring; it moves more than the medial one" });
    // Patella: a rounded triangle with its posterior ridge in the femoral groove.
    const patOuter = sd.displace(sd.smooth(6, sd.ellipsoid([0, 0, 0], [21, 23, 9.5]), sd.ellipsoid([0, -14, 1], [10, 9, 6]), sd.ellipsoid([0, 2, -6], [6, 16, 6])), 0.25, 0.2, 14);
    const patG = A.group("patella", { explode: [0, 0, 50], label: { text: "patella", at: [0, 0, 10] }, note: "the kneecap: a bone inside the quadriceps tendon that runs in the femur's groove" });
    patG.add(polygonize(patOuter, { h: h * 0.7 }), { name: "patella", material: bone });
    const patCart = sd.intersect(sd.field((x, y, z) => { const v = patOuter.d(x, y, z); return Math.max(v - 3.5, -v); }, subv(patOuter.min, 4), addv(patOuter.max, 4)), sd.plane([0, 0, 1], -2.5), 1);
    patG.add(polygonize(patCart, { h: 1.15 }), { name: "patellar cartilage", material: cartMat });
    // Ligaments and tendons: rebuilt each pose between their attachments.
    const ligMat = M("ligament", "ligaments", tissue("ligament")), tenMat = M("tendon", "tendons", tissue("tendon"));
    const lig = {};
    for (const [name, note, mat] of [
      ["anterior cruciate ligament", "stops the tibia sliding forward under the femur; about 32 mm long", ligMat],
      ["posterior cruciate ligament", "stops the tibia sliding back; about 38 mm long and stronger than the ACL", ligMat],
      ["medial collateral ligament", "a broad band on the inner side that resists the knee bending inward", ligMat],
      ["lateral collateral ligament", "a cord from the femur to the fibular head on the outer side", ligMat],
      ["patellar tendon", "from the patella to the tibial tuberosity; transmits the quadriceps' pull", tenMat],
      ["quadriceps tendon", "joins the thigh muscles to the top of the patella", tenMat],
    ]) lig[name] = A.part(name, null, { material: mat, note, label: { text: name.replace(" ligament", "").replace("anterior cruciate", "ACL").replace("posterior cruciate", "PCL"), inside: /cruciate/.test(name) } });
    // Femoral motion. For a flexion angle the femur's placement is fixed by two conditions:
    // the ACL keeps its length, and the condyles touch the tibial cartilage. Rolling and
    // gliding (rollback) come out of these. The PCL's femoral attachment is chosen where its
    // length varies least over the motion, as its main fibers do in a real knee.
    const At = [-3, 0.5, 12], Af = [11, 23, -13], Pt = [1, -5, -21];
    const LA = v3.dist(At, Af);
    const condProfile = [];
    for (let a = -1.9; a <= 0.6; a += 0.05) for (const x of [-21, 21]) condProfile.push(onSurface(femurOuter, [x, 24 - 23 * Math.cos(a), -2 + 27 * Math.sin(a)], 2.4));
    const contactOf = M0 => { let lowest = Infinity, z = 0; for (const p of condProfile) { const q = m4.apply(M0, p); if (Math.abs(q[2]) < 24 && q[1] < lowest) { lowest = q[1]; z = q[2]; } } return { y: lowest, z }; };
    // Flexion turns the femur's shaft backward (the hip ends up behind the knee).
    const placed = (flex, t) => mul(T([0, t[0], t[1]]), RX(-flex));
    const femurPose = (flex, t0) => {
      let t = t0.slice();
      const g = tt => { const M0 = placed(flex, tt); return [v3.dist(m4.apply(M0, Af), At) - LA, contactOf(M0).y - 2.1]; };
      for (let it = 0; it < 12; it++) {
        const f0 = g(t), e = 0.05, f1 = g([t[0] + e, t[1]]), f2 = g([t[0], t[1] + e]);
        const J = [[(f1[0] - f0[0]) / e, (f2[0] - f0[0]) / e], [(f1[1] - f0[1]) / e, (f2[1] - f0[1]) / e]];
        const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
        if (Math.abs(det) < 1e-9) break;
        const dy = (f0[0] * J[1][1] - f0[1] * J[0][1]) / det, dz = (J[0][0] * f0[1] - J[1][0] * f0[0]) / det;
        t = [t[0] - clamp(dy, -4, 4), t[1] - clamp(dz, -4, 4)];
        if (Math.abs(f0[0]) + Math.abs(f0[1]) < 1e-4) break;
      }
      const M0 = placed(flex, t);
      return { M: M0, t, contactZ: contactOf(M0).z };
    };
    // Flexion is solved in small steps from straight, each from the last solution.
    const cache = new Map();
    const solveFlex = flex => {
      const key = Math.round(flex * 1000);
      if (cache.has(key)) return cache.get(key);
      let t = [0, 0], r = null;
      const n = Math.max(1, Math.ceil(flex / 0.05));
      for (let i = 0; i <= n; i++) { r = femurPose((flex * i) / n, t); t = r.t; }
      if (cache.size > 400) cache.clear();
      cache.set(key, r);
      return r;
    };
    const rest = solveFlex(0);
    const sweep = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1].map(f => solveFlex(f).M);
    let Pf = [-11, 19, 6], bestVar = Infinity;
    for (let y = 8; y <= 34; y += 1.5) for (let z = -16; z <= 16; z += 1.5) {
      const cand = [-11, y, z];
      const dd = femurOuter.d(...cand);
      if (dd > 0.5 || dd < -3) continue; // on the medial condyle's wall of the notch
      const Ls = sweep.map(M0 => v3.dist(m4.apply(M0, cand), Pt));
      const mean = Ls.reduce((a, b) => a + b, 0) / Ls.length, vr = Math.max(...Ls.map(L => Math.abs(L / mean - 1)));
      if (mean > 30 && mean < 42 && vr < bestVar) { bestVar = vr; Pf = cand; }
    }
    const LP = v3.dist(m4.apply(rest.M, Pf), Pt);
    const tuberosity = [0, -31, 29], LPT = 46;
    let prevPsi = null;
    const patPose = Mf => {
      // The patella rides on a circle around the trochlea (femur frame); find where the
      // patellar tendon from the tuberosity has its rest length.
      const C = [0, 30, 2], R0 = 37;
      const at = psi => { const p = [0, C[1] - R0 * Math.sin(psi), C[2] + R0 * Math.cos(psi)]; return m4.apply(Mf, p); };
      const apexOf = psi => { const c = at(psi), up = v3.norm(v3.sub(at(psi - 0.05), at(psi + 0.05))); return v3.sub(c, v3.scale(up, 21)); };
      // The root of tendon length - rest length nearest the last one (the patella moves smoothly).
      const fn = psi => v3.dist(apexOf(psi), tuberosity) - LPT;
      const roots = [];
      for (let a = -0.9; a < 2.6; a += 0.02) { const f0 = fn(a), f1 = fn(a + 0.02); if (f0 * f1 <= 0) { let lo = a, hi = a + 0.02; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fn(lo) * fn(mid) <= 0) hi = mid; else lo = mid; } roots.push((lo + hi) / 2); } }
      const ref = prevPsi ?? -0.2;
      const psi = roots.length ? roots.reduce((b, r) => (Math.abs(r - ref) < Math.abs(b - ref) ? r : b)) : ref;
      prevPsi = psi;
      const c = at(psi), up = v3.norm(v3.sub(at(psi - 0.05), at(psi + 0.05)));
      const fwd = v3.norm(v3.sub(c, m4.apply(Mf, C)));
      const side = v3.cross(up, fwd);
      const Mp = [side[0], side[1], side[2], 0, up[0], up[1], up[2], 0, fwd[0], fwd[1], fwd[2], 0, c[0], c[1], c[2], 1];
      return { M: new Float32Array(Mp), apex: v3.sub(c, v3.scale(up, 21)), base: v3.add(c, v3.scale(up, 20)), psi };
    };
    const band = (a, b, w, t, twist = 0, mid = null) => {
      const path = smoothPath(mid ? [a, mid, b] : [a, vlerp(a, b, 0.5), b], 14);
      return mesh.sweep(path, (u) => { const k = 0.85 + 0.15 * Math.sin(Math.PI * u), r = twist * (u - 0.5); return ellipse(w * k, t * k, 12).map(([x, y]) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]); }, { caps: true, crease: 80 });
    };
    A.state = {};
    A.onPose = s => {
      const flex = clamp(s.flex ?? A.state.flex ?? 0, 0, 2.3);
      const F = solveFlex(flex), Mf = F.M;
      A.homeMatrix(femurG, Mf);
      // The patella is tracked from straight in steps too, so it stays on its branch.
      prevPsi = null;
      for (let i = 1; i <= Math.ceil(flex / 0.1); i++) patPose(solveFlex((flex * i) / Math.ceil(flex / 0.1)).M);
      const pp = patPose(Mf);
      A.homeMatrix(patG, pp.M);
      const W = p => m4.apply(Mf, p);
      const aF = W(Af), pF = W(Pf);
      lig["anterior cruciate ligament"].mesh = band(At, aF, 5, 3, 1.2);
      lig["posterior cruciate ligament"].mesh = band(Pt, pF, 6.5, 3.2, -0.9);
      lig["medial collateral ligament"].mesh = band(W([-39, 36, -3]), [-31, -58, -3], 5.5, 1.3, 0, vlerp(W([-41, 20, -3]), [-38, -8, -3], 0.5));
      lig["lateral collateral ligament"].mesh = band(W([39, 35, -5]), [36, -16, -14], 2.4, 2.2);
      lig["patellar tendon"].mesh = band(pp.apex, tuberosity, 13, 3.4, 0, v3.add(vlerp(pp.apex, tuberosity, 0.5), [0, 0, 2]));
      const qTop = W([0, 150, 23]);
      lig["quadriceps tendon"].mesh = band(pp.base, qTop, 16, 5, 0, W([0, 92, 25]));
      A.home(menG, [0, 0, -Math.min(6, flex * 3)]); // the menisci slide back with the condyles
      lig["medial collateral ligament"].visible = !A.open; // on the side the section removes
      Object.assign(A.state, { flex, acl: v3.dist(At, aF), pcl: v3.dist(Pt, pF), patellaAngle: pp.psi, contactZ: F.contactZ, rollback: rest.contactZ - F.contactZ, patellarTendon: v3.dist(pp.apex, tuberosity) });
    };
    A.section = [-1, 0, 0, -xs]; // the plane of the built-in section (keeps x >= xs)
    A.info = {
      units: "mm", cartilage: { femur: 2.4, tibia: 2, patella: 3.5 }, acl: +LA.toFixed(1), pcl: +LP.toFixed(1), pclVariation: +bestVar.toFixed(3), patellarTendon: LPT, plateauWidth: 74, cortex: 4.5,
      sources: ["Standring (ed.), Gray's Anatomy, 41st ed., 2016", "Girgis, Marshall and Monajem, Clin Orthop 106 (1975) 216 (cruciate dimensions)", "O'Connor et al., Proc Inst Mech Eng H 203 (1989) 223 (four-bar model)", "Shepherd and Seedhom, Ann Rheum Dis 58 (1999) 27 (cartilage thickness)"],
    };
    A.pose({ flex: 0 });
    return A;
  }

  // ---------- neuron ----------
  // A motor-neuron-like cell in micrometers: soma 26 µm across, dendrites whose diameters
  // follow Rall's 3/2 law, spines on the distal dendrites, an axon hillock, a myelinated axon
  // (internodes and nodes of Ranvier) and a terminal arbor with boutons. The axon is shown
  // much shorter than life (internodes are really about 100 times the fiber's diameter).
  // pose({ signal }) (0 to 1) moves an action potential from the hillock to the terminals,
  // jumping node to node as it does in a myelinated axon.
  function neuron(o = {}) {
    const A = sectionable(P.assembly(o.name ?? "neuron", o));
    const M = (role, name, fb) => matFor(o, role, name, fb);
    const R = rng(o.seed ?? 5), rs = 13;
    const memb = M("nerve", "neuron", tissue("membrane", { color: "#e9d4b0", sssColor: "#b98a4a" }));
    // Dendrites: primary trunks leave the soma in all directions except down (the axon).
    const trunks = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + R() * 0.5, el = 0.2 + R() * 0.9;
      trunks.push(v3.norm([Math.cos(a) * Math.cos(el), Math.sin(el) + 0.3, Math.sin(a) * Math.cos(el)]));
    }
    const trees = trunks.map((d, i) => vesselTree({ root: v3.scale(d, rs * 0.85), dir: d, radius: 2.6 - R() * 0.6, length: 70, depth: 5, exponent: 1.5, ratio: 0.8, taper: 0.88, curl: 0.3, seed: 20 + i, lengthRatio: 0.82 }));
    const segsAll = trees.flatMap(t => t.segments);
    // The soma blends smoothly into the trunks and the hillock (an implicit surface).
    const hillockEnd = [0, -rs - 14, 0];
    const somaSdf = sd.displace(sd.smooth(4, sd.ellipsoid([0, 0, 0], [rs, rs * 0.9, rs * 0.95]), sd.cone([0, -rs * 0.6, 0], hillockEnd, 6, 1.6),
      ...trunks.map(d => sd.cone(v3.scale(d, rs * 0.6), v3.scale(d, rs + 10), 3.4, 2.3))), 0.35, 0.18, 17);
    const somaCut = () => polygonize(sd.intersect(somaSdf, sd.plane([0, 0, 1], 0)), { h: 0.55, caps: [{ n: [0, 0, 1], d: 0 }] });
    sectioned(A, "soma", polygonize(somaSdf, { h: 0.55 }), somaCut, { material: memb, label: { text: "cell body (soma)", at: [rs * 0.7, rs * 0.6, 0] }, note: "the cell body, with the nucleus and most of the cell's machinery" });
    const dend = A.part("dendrites", merge(trees.map(t => t.mesh({ segments: 10 }))), { material: memb, explode: [0, 20, 0], label: { text: "dendrites", at: segsAll[3].path[3] }, note: "branches that collect signals from other neurons; their diameters follow Rall's 3/2 law" });
    // Spines on the thinner dendrites: neck and head.
    const spines = [];
    for (const s of segsAll) {
      if (s.level < 2) continue;
      for (let k = 1; k < s.path.length - 1; k++) {
        if (R() > 0.3) continue;
        const p = s.path[k], d = v3.norm(v3.sub(s.path[k + 1], s.path[k - 1]));
        const side = v3.norm(v3.cross(d, [R() - 0.5, R() - 0.5, R() - 0.5]));
        const r = lerp(s.r0, s.r1, k / (s.path.length - 1)), base = v3.add(p, v3.scale(side, r * 0.7)), tip = v3.add(p, v3.scale(side, r + 1.4));
        spines.push(tube([base, tip], 0.18, { segments: 5 }), ball(tip, 0.45, 5));
      }
    }
    A.part("dendritic spines", merge(spines), { parent: dend, material: memb, note: "tiny protrusions where most excitatory synapses land" });
    // Nucleus and nucleolus, visible in the cutaway.
    const nuc = A.part("nucleus", xf(mesh.sphere(5.5, { segments: segs(28, 12) }), T([1, 2, 0])), { material: M("nucleus", "nucleus", tissue("nucleus")), label: { text: "nucleus", at: [1, 2, 5.5], inside: true }, note: "holds the cell's DNA" });
    A.part("nucleolus", xf(mesh.sphere(1.8, { segments: segs(16, 8) }), T([2, 3, 2.5])), { parent: nuc, material: M("nucleus", "nucleolus", tissue("nucleus", { color: "#4f3a7a" })) });
    // Axon: initial segment, then internodes of myelin with nodes of Ranvier between them.
    const axonTop = hillockEnd, nIntern = o.internodes ?? 5, Lint = o.internode ?? 30, Lnode = 1.6, rAx = 1.4, rMy = 3.2;
    const axonLen = 18 + nIntern * (Lint + Lnode);
    const axonPath = smoothPath([axonTop, [2, axonTop[1] - axonLen * 0.3, 1], [-3, axonTop[1] - axonLen * 0.7, -2], [0, axonTop[1] - axonLen, 0]], segs(140, 40));
    const at = s => { let acc = 0; for (let i = 1; i < axonPath.length; i++) { const l = v3.dist(axonPath[i - 1], axonPath[i]); if (acc + l >= s) return vlerp(axonPath[i - 1], axonPath[i], (s - acc) / l); acc += l; } return axonPath[axonPath.length - 1]; };
    const sub = (s0, s1, n = 16) => Array.from({ length: n + 1 }, (_, i) => at(lerp(s0, s1, i / n)));
    A.part("axon", tube(axonPath, rAx, { segments: 12 }), { material: memb, label: { text: "axon", at: at(8) }, note: "carries the action potential away from the cell body" });
    const myel = M("myelin", "myelin", tissue("myelin")), nodeMat = M("nerve", "nodes", tissue("nerve", { color: "#d9a441" }));
    const internodes = [], nodes = [];
    for (let k = 0; k < nIntern; k++) {
      const s0 = 18 + k * (Lint + Lnode) + Lnode, s1 = s0 + Lint;
      const sheath = tube(sub(s0, s1, 20), t => rMy * Math.min(1, Math.sin(Math.PI * t) * 4 + 0.15), { segments: 16 });
      internodes.push(A.part(`myelin sheath ${k + 1}`, sheath, { material: myel, label: k === 1 ? { text: "myelin sheath", at: at((s0 + s1) / 2) } : undefined, note: "wrapped layers of a Schwann cell's membrane that insulate the axon" }));
      const sn = s0 - Lnode;
      nodes.push(A.part(`node of Ranvier ${k + 1}`, tube(sub(sn, s0, 4), rAx * 1.12, { segments: 12 }), { material: nodeMat, label: k === 2 ? { text: "node of Ranvier", at: at(sn) } : undefined, note: "a gap in the myelin where the action potential is regenerated" }));
    }
    // Terminal arbor and boutons.
    const end = axonPath[axonPath.length - 1];
    const arbor = vesselTree({ root: end, dir: [0, -1, 0], radius: rAx * 0.9, length: 18, depth: 3, exponent: 1.5, ratio: 0.85, curl: 0.5, seed: 31 });
    A.part("axon terminals", arbor.mesh({ segments: 8 }), { material: memb, note: "the axon's branches ending on muscle fibers or other neurons" });
    const tips = arbor.segments.filter(s => !arbor.segments.some(c => c.parent === arbor.segments.indexOf(s))).map(s => s.path[s.path.length - 1]);
    const boutons = A.part("synaptic boutons", merge(tips.map(p => ball(p, 1.6, 10))), { material: nodeMat, label: { text: "synaptic boutons", at: tips[0] }, note: "swellings that release neurotransmitter onto the next cell" });
    tips.forEach((p, i) => A.port(`terminal${i + 1}`, A, p, [0, -1, 0], 1.6));
    A.state = {};
    A.onPose = s => {
      const sig = clamp(s.signal ?? A.state.signal ?? 0, 0, 1);
      // Saltatory conduction: the active point jumps from node to node.
      const k = Math.min(nIntern, Math.floor(sig * (nIntern + 2)) - 1);
      nodes.forEach((n, i) => { n.highlight = i === k ? "orange" : false; });
      internodes.forEach((n, i) => { n.highlight = i === k - 1 ? "orange" : false; });
      A.parts.soma.traverse(n => { n.highlight = k < 0 ? "orange" : false; });
      boutons.highlight = k >= nIntern ? "orange" : false;
      Object.assign(A.state, { signal: sig, activeNode: k, distance: k < 0 ? 0 : 18 + Math.min(k, nIntern) * (Lint + Lnode) });
    };
    A.info = { units: "µm", soma: 2 * rs, axon: { diameter: 2 * rAx, myelinated: 2 * rMy, internode: Lint, node: Lnode, internodes: nIntern }, dendriteLaw: "Rall 3/2", sources: ["Kandel et al., Principles of Neural Science, 6th ed., 2021", "Rall, Exp Neurol 1 (1959) 491 (dendritic branching)"] };
    A.pose({ signal: 0 });
    return A;
  }

  // ---------- cell ----------
  // A generic animal cell in micrometers, about 24 µm across: plasma membrane, nucleus with
  // envelope pores and nucleolus, rough ER with ribosomes, smooth ER, a Golgi stack with
  // vesicles, mitochondria (three opened to show their cristae), lysosomes, a centrosome and
  // microtubules. cutaway(on) removes a quarter wedge so the inside shows.
  function cell(o = {}) {
    const A = sectionable(P.assembly(o.name ?? "cell", o));
    const M = (role, name, fb) => matFor(o, role, name, fb);
    const R = rng(o.seed ?? 9), rc = 12;
    const membSdf = sd.displace(sd.ellipsoid([0, 0, 0], [rc, rc * 0.82, rc * 0.95]), 0.45, 0.12, 21);
    const memShell = sd.shell(membSdf, 0.5);
    const wedge = sd.field((x, y, z) => Math.max(-x, -z), [-1e9, -1e9, -1e9], [1e9, 1e9, 1e9]); // the quarter x > 0, z > 0
    sectioned(A, "plasma membrane", polygonize(memShell, { h: 0.33 }), () => polygonize(sd.subtract(memShell, wedge), { h: 0.33, caps: [{ n: [1, 0, 0], d: 0 }, { n: [0, 0, 1], d: 0 }] }), { material: M("membrane", "plasma membrane", tissue("membrane")), label: { text: "plasma membrane", at: [-rc * 0.7, rc * 0.6, -rc * 0.2] }, note: "a lipid bilayer about 5 nm thick, shown much thicker" });
    const interior = A.group("organelles");
    const inner = (name, m, mat, opts = {}) => A.part(name, m, { parent: interior, material: mat, ...opts });
    // Nucleus: envelope with pores, nucleoplasm, nucleolus. Revolved, so the wedge cut is exact.
    const Rn = 5.2, nucMat = M("nucleus", "nucleus", tissue("nucleus"));
    const envProf = Array.from({ length: 41 }, (_, i) => { const a = -Math.PI / 2 + (i / 40) * Math.PI; return [Rn * Math.cos(a), Rn * Math.sin(a)]; });
    const env = (arc, start) => P.revolve([...envProf, ...envProf.slice().reverse().map(([r, y]) => [r * 0.94, y * 0.94])], { loop: true, segments: segs(64, 20), arc, start });
    const nucG = A.part("nucleus", null, { parent: interior, label: { text: "nucleus", at: [0, Rn, 0] }, note: "holds the DNA; its double envelope is studded with pores" });
    const nucWhole = nucG.add(env(TAU, 0), { name: "nuclear envelope", material: nucMat });
    const nucCut = lazyPart(nucG.add(null, { name: "nuclear envelope", material: nucMat, visible: false }), () => env(TAU * 0.75, 0));
    A._sections.push([nucWhole, nucCut]);
    const pores = [];
    for (let i = 0; i < segs(90, 30); i++) {
      const z = 2 * R() - 1, a = TAU * R(), q = Math.sqrt(1 - z * z), n = [q * Math.cos(a), z, q * Math.sin(a)];
      if (n[0] > 0 && n[2] > 0) continue; // none in the removed wedge
      pores.push(xf(mesh.torus(0.22, 0.08, { segments: 8, tube: 5 }), m4.multiply(T(v3.scale(n, Rn * 0.985)), m4.alignY(n))));
    }
    inner("nuclear pores", merge(pores), M("nucleus", "nuclear pores", tissue("nucleus", { color: "#5e4a8f" })), { parent: nucG, note: "channels through the envelope for RNA and proteins" });
    const npl = (arc) => P.revolve(envProf.map(([r, y]) => [r * 0.93, y * 0.93]), { segments: segs(48, 16), arc, start: 0 });
    const nplWhole = nucG.add(npl(TAU), { name: "nucleoplasm", material: M("nucleus", "chromatin", tissue("nucleus", { color: "#b3a0cf" })) });
    const nplCut = lazyPart(nucG.add(null, { name: "nucleoplasm", material: M("nucleus", "chromatin", tissue("nucleus", { color: "#b3a0cf" })), visible: false }), () => npl(TAU * 0.75));
    A._sections.push([nplWhole, nplCut]);
    inner("nucleolus", polygonize(sd.displace(sd.sphere([1.6, 1.2, 1.4], 1.6), 0.15, 1.5, 23), { h: 0.12 }), M("nucleus", "nucleolus", tissue("nucleus", { color: "#4b3577" })), { parent: nucG, label: { text: "nucleolus", at: [1.6, 2.8, 1.4], inside: true }, note: "where ribosomes are assembled" });
    // Rough ER: curved cisternae wrapping the nucleus, with ribosomes on their outer faces.
    const rer = [], ribos = [];
    for (let k = 0; k < 5; k++) {
      const r = Rn + 0.8 + k * 0.55, th0 = 0.4 + 0.15 * k, th1 = 1.9 - 0.1 * k, ph0 = 1.6 + 0.2 * k, ph1 = 4.4 - 0.15 * k;
      const f = (u, v) => { const th = lerp(th0, th1, v), ph = lerp(ph0, ph1, u), w = 1 + 0.035 * Math.sin(ph * 7 + k) * Math.sin(th * 5); return [r * w * Math.sin(th) * Math.cos(ph), r * w * Math.cos(th), r * w * Math.sin(th) * Math.sin(ph)]; };
      rer.push(sheet(f, { nu: 28, nv: 14, thickness: 0.16 }));
      for (let i = 0; i < 70; i++) { const u = R(), v = R(), p = f(u, v); ribos.push(ball(v3.scale(p, 1 + 0.1 / r), 0.07, 4)); }
    }
    inner("rough endoplasmic reticulum", merge(rer), M("organelle", "rough ER", tissue("organelle", { color: "#d9a3c2" })), { label: { text: "rough ER", at: [-(Rn + 2), 1, 1], inside: true }, note: "flattened sacs studded with ribosomes that make proteins for export" });
    inner("ribosomes", merge(ribos), M("nucleus", "ribosomes", tissue("nucleus", { color: "#3d2a5e" })), { note: "about 25 nm across; shown larger" });
    // Smooth ER: a tubular network.
    const insideCell = p => { const k = Math.hypot(p[0] / (rc * 0.86), p[1] / (rc * 0.82 * 0.86), p[2] / (rc * 0.95 * 0.86)); const q = k > 1 ? v3.scale(p, 1 / k) : p; const dn = v3.len(q); return dn < Rn + 0.6 ? v3.scale(q, (Rn + 0.6) / dn) : q; };
    const ser = vesselTree({ root: [-2, -5.5, 6.5], dir: [-1, -0.3, 0.2], radius: 0.18, length: 3.2, depth: 5, exponent: 3, ratio: 0.95, taper: 1, curl: 0.8, seed: 41, lengthRatio: 0.95, project: insideCell });
    inner("smooth endoplasmic reticulum", ser.mesh({ segments: 7 }), M("organelle", "smooth ER", tissue("organelle", { color: "#c9a0d6" })), { note: "a tubular network that makes lipids and stores calcium" });
    // Golgi apparatus: a stack of curved cisternae with swollen rims, and vesicles.
    const golgi = [], ves = [];
    const gC = [3.5, 6.2, -3], gN = v3.norm([0.3, 1, -0.2]);
    for (let k = 0; k < 6; k++) {
      const off = (k - 2.5) * 0.32, rad = 2.3 - Math.abs(k - 2.5) * 0.18;
      const f = (u, v) => { const a = lerp(-1.1, 1.1, u), r = rad * (0.2 + 0.8 * v), cup = 0.5 * (r / rad) ** 2; return [gC[0] + r * Math.cos(a) * 1.3, gC[1] + off - cup, gC[2] + r * Math.sin(a)]; };
      golgi.push(sheet(f, { nu: 18, nv: 8, thickness: u => 0.12 }));
      for (let i = 0; i < 5; i++) ves.push(ball(v3.add(f(R(), 1), [0, 0.2 * (R() - 0.5), 0]), 0.17 + 0.08 * R(), 6));
    }
    void gN;
    inner("Golgi apparatus", merge(golgi), M("organelle", "Golgi", tissue("organelle", { color: "#e6c07a" })), { label: { text: "Golgi apparatus", at: [gC[0] + 2.6, gC[1], gC[2]], inside: true }, note: "a stack of sacs that sorts and packages proteins" });
    inner("vesicles", merge(ves), M("organelle", "vesicles", tissue("organelle", { color: "#f0d394" })));
    // Mitochondria: capsules; three of them opened to show the inner membrane's cristae.
    const mitoMat = M("organelle", "mitochondria", tissue("organelle", { color: "#e1876a" }));
    const mitos = [], opened = [];
    const place = () => { for (;;) { const p = [(R() * 2 - 1) * 9, (R() * 2 - 1) * 7, (R() * 2 - 1) * 8.5]; const rr = Math.hypot(p[0] / 11, p[1] / 9, p[2] / 10.5); if (rr < 0.9 && v3.len(p) > Rn + 2.2) return p; } };
    for (let i = 0; i < 14; i++) {
      const c = place(), d = v3.norm([R() - 0.5, R() - 0.5, R() - 0.5]), L = 1.6 + R() * 1.4, r = 0.42 + R() * 0.12;
      const a = v3.sub(c, v3.scale(d, L / 2)), b = v3.add(c, v3.scale(d, L / 2));
      if (i < 2) {
        // An opened mitochondrion: outer membrane, inner membrane folded into cristae, cut lengthwise.
        const outer = sd.capsule(a, b, r), innerM = sd.capsule(a, b, r - 0.08), n = v3.norm(v3.cross(d, [0, 1, 0]));
        // Cristae: plates every 0.32 µm along the axis, folded in from the inner membrane.
        const cristae = sd.field((x, y, z) => {
          const px = x - a[0], py = y - a[1], pz = z - a[2], s = px * d[0] + py * d[1] + pz * d[2];
          const rad = Math.hypot(px - d[0] * s, py - d[1] * s, pz - d[2] * s);
          const slabD = Math.abs((((s / 0.32) % 1) + 1) % 1 - 0.5) * 0.32 - 0.05;
          return Math.max(slabD, 0.12 - rad, innerM.d(x, y, z));
        }, outer.min, outer.max);
        const cutS = sd.intersect(sd.union(sd.shell(outer, 0.09), sd.shell(innerM, 0.09), cristae), sd.plane(n, v3.dot(n, c)));
        opened.push(polygonize(cutS, { h: 0.045, caps: [{ n, d: v3.dot(n, c) }] }));
      } else mitos.push(xf(mesh.cylinder(r, L, { r2: r, segments: segs(14, 8) }), m4.multiply(T(c), m4.alignY(d))), ball(a, r, 10), ball(b, r, 10));
    }
    inner("mitochondria", merge(mitos), mitoMat, { label: { text: "mitochondria", at: place(), inside: true }, note: "make most of the cell's ATP; 0.5 to 1 µm across" });
    inner("mitochondria (opened)", merge(opened), mitoMat, { note: "cut open: the inner membrane folds into cristae" });
    // Lysosomes, centrosome, microtubules.
    const lys = [];
    for (let i = 0; i < 10; i++) lys.push(ball(place(), 0.3 + R() * 0.25, 10));
    inner("lysosomes", merge(lys), M("organelle", "lysosomes", tissue("organelle", { color: "#9fc48a" })), { note: "bags of enzymes that digest worn-out parts" });
    const cen = [-1.5, 6.4, 2.2];
    inner("centrosome", merge(xf(mesh.cylinder(0.11, 0.45, { segments: 9 }), T(cen)), xf(mesh.cylinder(0.11, 0.45, { segments: 9 }), T(v3.add(cen, [0.3, 0, 0])), RZ(Math.PI / 2))), M("organelle", "centrosome", tissue("organelle", { color: "#5b8fd6" })), { note: "two centrioles; microtubules grow out from here" });
    const mts = [];
    for (let i = 0; i < 46; i++) {
      const d = v3.norm([R() - 0.5, R() - 0.5, R() - 0.5]);
      const pts = [cen];
      let p = cen, dd = d;
      for (let k = 0; k < 8; k++) { dd = v3.norm(v3.add(dd, v3.scale([R() - 0.5, R() - 0.5, R() - 0.5], 0.25))); p = v3.add(p, v3.scale(dd, 1.4)); if (membSdf.d(...p) > -0.8 || v3.len(p) < Rn + 0.4) break; pts.push(p); }
      if (pts.length > 2) mts.push(tube(pts, 0.035, { segments: 5 }));
    }
    inner("microtubules", merge(mts), M("organelle", "microtubules", tissue("organelle", { color: "#7fa8e0" })), { note: "25 nm tubes that carry cargo and shape the cell" });
    // The interior is hidden until the cell is opened (the membrane hides it anyway).
    interior.visible = false;
    A._interior.push(interior);
    A.info = { units: "µm", diameter: 2 * rc, nucleus: 2 * Rn, mitochondrion: [0.5, 1.0], ribosome: 0.025, microtubule: 0.025, sources: ["Alberts et al., Molecular Biology of the Cell, 6th ed., 2014"] };
    A.state = {};
    A.onPose = () => {};
    return A;
  }

  // ---------- tooth ----------
  // A mandibular first molar in its socket, in millimeters: enamel (2.5 mm at the cusps),
  // dentin, pulp chamber and root canals, cementum, periodontal ligament (0.2 mm), gum, and
  // alveolar bone. The crown is up (+y); the cementoenamel junction is at y = 0.
  // cutaway(on) shows a buccolingual section through the mesial root.
  function tooth(o = {}) {
    const A = sectionable(P.assembly(o.name ?? "tooth", o));
    const M = (role, name, fb) => matFor(o, role, name, fb);
    const h = o.h ?? 0.24;
    // Mandibular first molar: three buccal cusps (mesiobuccal, distobuccal, distal) and two lingual.
    // x runs mesial (-) to distal (+), z lingual (-) to buccal (+).
    const CUSPS = [["mesiobuccal cusp", [-2.8, 6.6, 2.4]], ["distobuccal cusp", [1.2, 6.4, 2.8]], ["distal cusp", [4.0, 6.0, 1.2]], ["mesiolingual cusp", [-2.6, 6.9, -2.4]], ["distolingual cusp", [2.4, 6.6, -2.5]]];
    const cusps = CUSPS.map(c => c[1]);
    const crown = sd.smooth(1.6, sd.box([0, 3.6, 0], [5.2, 2.9, 4.6], 2.2), ...cusps.map(c => sd.sphere(c, 2.25)));
    const neck = sd.ellipsoid([0, 0.3, 0], [4.6, 1.6, 4.0]);
    const roots = [sd.cone([-2.6, -0.5, 0], [-3.2, -13.5, -0.2], 2.6, 0.9), sd.cone([2.6, -0.5, 0], [3.0, -12.5, 0.2], 2.4, 0.9)];
    const toothSdf = sd.displace(sd.smooth(1.4, crown, neck, ...roots), 0.05, 1.4, 31);
    const tE = (x, y, z) => 2.5 * sstep(0.2, 5.5, y), tC = (x, y, z) => 0.25 * (1 - sstep(-0.6, 0.2, y));
    const enamel = sd.field((x, y, z) => { const v = toothSdf.d(x, y, z); return Math.max(v, -(v + tE(x, y, z)), -y + 0.1); }, toothSdf.min, toothSdf.max);
    const chamber = sd.smooth(0.7, sd.box([0, 2.4, 0], [2.6, 1.1, 2.0], 0.9), ...[0, 1, 3, 4].map(i => cusps[i]).map(c => sd.cone([c[0] * 0.7, 2.6, c[2] * 0.7], [c[0] * 0.55, 4.0, c[2] * 0.55], 0.8, 0.35)));
    const canalM = sd.cone([-2.4, 1.6, 0], [-3.1, -13.2, -0.2], 0.75, 0.12), canalD = sd.cone([2.4, 1.6, 0], [2.9, -12.2, 0.2], 0.7, 0.12);
    const pulp = sd.smooth(0.7, chamber, canalM, canalD);
    const dentin = sd.field((x, y, z) => { const v = toothSdf.d(x, y, z); const inner = v + Math.max(tE(x, y, z), tC(x, y, z)); return Math.max(inner, -pulp.d(x, y, z)); }, toothSdf.min, toothSdf.max);
    const cementum = sd.field((x, y, z) => { const v = toothSdf.d(x, y, z); return Math.max(v, -(v + 0.25), y - 0.15); }, toothSdf.min, toothSdf.max);
    const pdl = sd.field((x, y, z) => { const v = toothSdf.d(x, y, z); return Math.max(v - 0.25, -v, y + 1.6); }, subv(toothSdf.min, 0.3), addv(toothSdf.max, 0.3));
    const boneBlock = sd.box([0, -9, 0], [8.5, 7.6, 7.2], 2.2);
    // The mandibular canal runs mesiodistally below the roots with the inferior alveolar bundle.
    const yCan = -15, canal = sd.capsule([-12, yCan, -0.6], [12, yCan, -0.6], 1.7);
    const bone = sd.field((x, y, z) => Math.max(boneBlock.d(x, y, z) + 0.15 * fbm(x * 0.6, y * 0.6, z * 0.6, 2, 33), -(toothSdf.d(x, y, z) - 0.25), -canal.d(x, y, z)), boneBlock.min, boneBlock.max);
    // Gum: within 1.8 mm of the tooth's neck or 1.2 mm of the bone, from below the bone's
    // crest up to the free gingival margin (1 mm above the cementoenamel junction), sloping
    // down away from the tooth.
    const gum = sd.field((x, y, z) => {
      const v = toothSdf.d(x, y, z), b = boneBlock.d(x, y, z);
      const near = smin(v - 1.25, Math.max(b - 0.8, v - 4.5), 0.9); // over the crest near the tooth only
      const top = y - 1.0 + 0.55 * Math.max(v, 0), bottom = -4.0 - y;
      return Math.max(near, top, bottom, -(v - 0.03), -(b - 0.05));
    }, [-10.5, -6, -9.5], [10.5, 2, 9.5]);
    const plane = sd.plane([0, 0, 1], 0.2);
    const layer = (name, f, mat, hh, extra) => sectioned(A, name, polygonize(f, { h: hh }), () => polygonize(sd.intersect(f, plane), { h: hh, caps: [{ n: [0, 0, 1], d: 0.2 }] }), { material: mat, ...extra });
    layer("enamel", enamel, M("enamel", "enamel", tissue("enamel")), h, { label: { text: "enamel", at: [-2.6, 8.6, 2.4] }, note: "the hardest tissue in the body, up to 2.5 mm thick on the cusps" });
    layer("dentin", dentin, M("dentin", "dentin", tissue("dentin")), h, { label: { text: "dentin", at: [-4.2, 2, 0], inside: true }, note: "makes up most of the tooth; full of tiny tubules" });
    const pulpMat = M("pulp", "pulp", tissue("pulp"));
    layer("pulp chamber", chamber, pulpMat, h * 0.8, { label: { text: "pulp", at: [0, 2.4, 0], inside: true }, note: "the chamber under the crown, with horns up under the cusps" });
    layer("mesial root canal", canalM, pulpMat, h * 0.7, { label: { text: "root canal", at: [-2.8, -6, 0], inside: true }, note: "carries the pulp's nerves and vessels down the mesial root" });
    layer("distal root canal", canalD, pulpMat, h * 0.7, { note: "the canal of the distal root" });
    layer("cementum", cementum, M("bone", "cementum", tissue("bone", { color: "#e7d3a6" })), 0.17, { note: "a thin bony layer on the roots that the ligament anchors to" });
    layer("periodontal ligament", pdl, M("ligament", "periodontal ligament", tissue("ligament", { color: "#e6a98f" })), 0.17, { label: { text: "periodontal ligament", at: [-5.4, -6, 0], inside: true }, note: "a 0.2 mm sling of fibers that holds the tooth in its socket" });
    layer("alveolar bone", bone, M("bone", "alveolar bone", tissue("bone")), h * 1.4, { label: { text: "alveolar bone", at: [8, -9, 4] }, note: "the jaw bone that forms the socket" });
    layer("gingiva", gum, M("gum", "gingiva", tissue("gum")), h * 1.3, { label: { text: "gum (gingiva)", at: [5, 0.5, 5] }, note: "the gum, sealing around the neck of the tooth" });
    // Nerves and vessels: the inferior alveolar bundle in its canal, branching up through the
    // apical foramina into the canals and the chamber.
    const bundle = { nerve: [0, 0, 0.9, "#f0d36a", "nerve"], artery: [0.7, 0.55, 0.38, "#c8372d", "artery"], vein: [-0.7, -0.5, 0.5, "#4a63a8", "vein"] };
    for (const [kind, [dx, dz, r, color, base]] of Object.entries(bundle)) {
      const mat = M(base, `inferior alveolar ${kind}`, tissue(base, { color }));
      A.part(`inferior alveolar ${kind}`, tube(smoothPath([[-11.5, yCan + dz * 0.3, -0.6 + dz], [0, yCan + dz * 0.3 - 0.2, -0.6 + dz], [11.5, yCan + dz * 0.3, -0.6 + dz]], 24), r, { segments: 12 }), { material: mat, label: kind === "nerve" ? { text: "inferior alveolar nerve", at: [9, yCan, 0], inside: true } : undefined, note: kind === "nerve" ? "the nerve that gives sensation to the lower teeth" : `the inferior alveolar ${kind}` });
      const branches = [];
      for (const [apex, top] of [[[-3.1, -13.2, -0.2], [-2.4, 1.6, 0]], [[2.9, -12.2, 0.2], [2.4, 1.6, 0]]]) {
        const up = smoothPath([[apex[0] + dx * 0.4, yCan + 0.6, -0.6 + dz], [apex[0] + dx * 0.2, apex[1] - 0.6, apex[2]], vlerp(apex, top, 0.5).map((v, i) => v + [dx * 0.25, 0, dz * 0.25][i]), [top[0] + dx * 0.3, top[1] + 0.6, top[2] + dz * 0.3]], 22);
        branches.push(tube(up, t => r * lerp(0.35, 0.12, t), { segments: 6 }));
      }
      A.part(`pulp ${kind === "nerve" ? "nerves" : kind === "artery" ? "arteries" : "veins"}`, merge(branches), { material: mat });
    }
    for (const [name, c] of CUSPS) A.part(name, null, { label: { text: name, at: v3.add(c, [0, 2.3, 0]) }, note: `one of the five cusps of the mandibular first molar` });
    A.section = [0, 0, 1, 0.2];
    A.info = { units: "mm", crown: { mesiodistal: 11, buccolingual: 10.5, height: 7.5 }, root: 14, enamel: 2.5, pdl: 0.2, sources: ["Nelson, Wheeler's Dental Anatomy, Physiology and Occlusion, 11th ed., 2019", "Berkovitz, Holland and Moxham, Oral Anatomy, Histology and Embryology, 5th ed., 2017"] };
    A.state = {};
    A.onPose = () => {};
    return A;
  }

  // ---------- skin ----------
  // A block of thick skin, 4 × 4 mm, in millimeters: epidermis (0.4 mm, ridged on its
  // underside into dermal papillae), dermis (1.6 mm), and hypodermis (fat lobules), with a
  // hair follicle (shaft, root sheath, bulb, sebaceous gland, arrector pili), a coiled sweat
  // gland and its duct, two vascular plexuses with capillary loops, and nerve endings
  // (Meissner and Pacinian corpuscles). The surface is y = 0. cutaway(on) removes the front
  // half of the layers (z > 0) to show the follicle and gland in section.
  function skin(o = {}) {
    const A = sectionable(P.assembly(o.name ?? "skin", o));
    const M = (role, name, fb) => matFor(o, role, name, fb);
    const R = rng(o.seed ?? 13), W = 2, tE = 0.4, tD = 1.6, tH = 1.8;
    const surf = (x, z) => 0.025 * Math.sin(x * 22 + Math.sin(z * 9) * 2) + 0.012 * noise(x * 6, 0, z * 6, 3);
    const papillae = (x, z) => -tE - 0.09 * (0.5 + 0.5 * Math.sin(x * 26) * Math.sin(z * 26 + 0.7 * Math.sin(x * 8))) + 0.02 * noise(x * 8, 1, z * 8, 4);
    const dBot = (x, z) => -tE - tD + 0.06 * noise(x * 3, 2, z * 3, 5);
    const lay = (name, low, high, mat, extra, n) => {
      const g = A.part(name, null, extra);
      const whole = g.add(slab(low, high, [-W, W], [-W, W], { n }), { name, material: mat });
      const cut = lazyPart(g.add(null, { name, material: mat, visible: false }), () => slab(low, high, [-W, W], [-W, 0], { n }));
      A._sections.push([whole, cut]);
      return g;
    };
    const corneum = (x, z) => surf(x, z) - 0.06;
    lay("stratum corneum", corneum, surf, M("skin", "stratum corneum", tissue("skin", { color: "#efd2bd", sss: 0.45 })), { label: { text: "stratum corneum", at: [1.6, -0.02, -0.4] }, note: "15 to 20 layers of dead, flattened cells: the waterproof surface" }, 90);
    lay("epidermis", papillae, corneum, M("skin", "epidermis", tissue("skin")), { label: { text: "epidermis", at: [-1.4, -0.22, -0.2] }, note: "living layers of skin cells, renewed every month or so; 0.1 mm on most skin, 0.4 to 1.5 mm on palms and soles" }, 90);
    lay("dermis", dBot, papillae, M("dermis", "dermis", tissue("dermis")), { label: { text: "dermis", at: [-1.6, -1.1, -0.2] }, note: "tough connective tissue with collagen, vessels, nerves, glands, and follicles" }, 60);
    const fat = [], fatAt = [];
    for (let i = 0; i < 90; i++) {
      const p = [lerp(-W + 0.3, W - 0.3, R()), lerp(-tE - tD - 0.35, -tE - tD - tH + 0.3, R()), lerp(-W + 0.3, W - 0.3, R())];
      fat.push(xf(mesh.sphere(1, { segments: segs(10, 6) }), T(p), m4.scaling([0.32 + R() * 0.12, 0.26 + R() * 0.08, 0.32 + R() * 0.12])));
      fatAt.push(p);
    }
    const fatG = A.part("hypodermis", merge(fat), { material: M("fat", "hypodermis", tissue("fat")), label: { text: "hypodermis (fat)", at: [-1.6, -3.0, -0.4] }, note: "fat lobules that cushion and insulate" });
    // Hair follicle: tilted, in the plane z = 0 so the cutaway shows it in section.
    const hair = M("tissue", "hair", tissue("tissue", { color: "#3a2a20" })), sheath = M("tissue", "follicle", tissue("tissue", { color: "#e3b49a" }));
    const bulb = [-0.6, -tE - tD - 0.45, 0], exitP = [0.35, 0.02, 0], tipP = [1.2, 1.4, 0.1];
    const shaftPath = smoothPath([bulb, vlerp(bulb, exitP, 0.5), exitP, tipP], 30);
    A.part("hair shaft", tube(shaftPath, t => lerp(0.045, 0.035, t), { segments: 10 }), { material: hair, label: { text: "hair shaft", at: tipP }, note: "dead keratin cells, about 0.07 mm thick" });
    const folPath = smoothPath([v3.add(bulb, [0, -0.08, 0]), vlerp(bulb, exitP, 0.5), [0.32, -0.02, 0]], 20);
    A.part("hair follicle", merge(tube(folPath, t => (t < 0.1 ? 0.16 : 0.1), { segments: 14 }), ball(v3.add(bulb, [0, -0.04, 0]), 0.17, 12)), { material: sheath, label: { text: "hair follicle", at: vlerp(bulb, exitP, 0.4), inside: true }, note: "the sheath the hair grows from; the bulb at its base holds the dividing cells" });
    const seb = vlerp(bulb, exitP, 0.68);
    A.part("sebaceous gland", polygonize(sd.displace(sd.smooth(0.08, sd.sphere(v3.add(seb, [0.18, 0, 0]), 0.14), sd.sphere(v3.add(seb, [0.26, -0.12, 0.05]), 0.11), sd.sphere(v3.add(seb, [0.12, -0.16, -0.06]), 0.1)), 0.015, 12, 51), { h: 0.02 }), { material: M("fat", "sebaceous gland", tissue("fat", { color: "#f1dc9a" })), label: { text: "sebaceous gland", at: v3.add(seb, [0.3, 0, 0]), inside: true }, note: "makes sebum, the oil that coats the hair and skin" });
    A.part("arrector pili muscle", muscle(vlerp(bulb, exitP, 0.45), [0.95, -tE - 0.05, 0], { belly: 0.03, width: 0.06, tendonLength: 0.05, stations: 16 }).mesh, { material: M("muscle", "arrector pili", tissue("muscle")), note: "a tiny muscle that stands the hair up: goose bumps" });
    // Eccrine sweat gland: a coil deep in the dermis and a duct spiraling to a pore.
    const coilC = [1.0, -tE - tD + 0.15, 0.25], coil = [];
    for (let k = 0; k <= 160; k++) { const t = k / 160, a = t * TAU * 7; coil.push([coilC[0] + 0.14 * Math.cos(a) + 0.05 * noise(t * 9, 0, 0, 7), coilC[1] + 0.12 * Math.sin(a * 0.5) + 0.04 * noise(t * 9, 1, 0, 7), coilC[2] + 0.14 * Math.sin(a)]); }
    const duct = [];
    for (let k = 0; k <= 60; k++) { const t = k / 60, a = t * TAU * (t > 0.75 ? 5 : 1.5); duct.push([coilC[0] + 0.04 * Math.cos(a) + 0.1 * t, lerp(coilC[1] + 0.12, 0.01, t), coilC[2] + 0.04 * Math.sin(a)]); }
    A.part("sweat gland", merge(tube(coil, 0.028, { segments: 8 }), tube(duct, 0.02, { segments: 6 })), { material: M("tissue", "sweat gland", tissue("tissue", { color: "#f2b7a6" })), label: { text: "sweat gland", at: coilC, inside: true }, note: "a coiled tube that makes sweat; its duct spirals up through the epidermis" });
    // Vessels: deep and superficial plexuses, connected, with capillary loops into the papillae.
    const keepBack = p => p[2];
    const vesA = [], vesV = [];
    const vv = (path, r) => ({ path, r, mesh: tube(path, r, { segments: 8 }) });
    for (const [y, r] of [[-tE - tD + 0.05, 0.05], [-tE - 0.2, 0.03]]) for (let i = -2; i <= 2; i++) {
      const x = i * 0.85 + 0.1;
      vesA.push(vv(smoothPath([[x, y, -W], [x + 0.1, y + 0.02, 0], [x - 0.05, y, W]], 16), r));
      vesV.push(vv(smoothPath([[x + 0.25, y - 0.02, -W], [x + 0.32, y, 0], [x + 0.2, y - 0.02, W]], 16), r * 1.25));
    }
    const caps = [], capsCut = [];
    for (let i = 0; i < 24; i++) {
      const x = lerp(-1.8, 1.8, R()), z = lerp(-1.8, 1.8, R()), top = papillae(x, z) + 0.05;
      const m = tube(smoothPath([[x, -tE - 0.2, z], [x, top - 0.02, z], [x + 0.03, top, z], [x + 0.06, -tE - 0.2, z]], 8), 0.008, { segments: 4 });
      caps.push(m);
      if (z < 0) capsCut.push(m);
    }
    sectioned(A, "capillary loops", merge(caps), () => merge(capsCut), { material: M("artery", "capillaries", tissue("artery", { color: "#d0574b" })), note: "hairpin capillaries rising into each dermal papilla" });
    sectioned(A, "arterioles", merge(vesA.map(v => v.mesh)), () => merge(vesA.map(v => clippedTubes([v.path], v.r, keepBack, { segments: 8 }))), { material: M("artery", "arteries", tissue("artery")), note: "the deep and superficial plexuses of small arteries" });
    sectioned(A, "venules", merge(vesV.map(v => v.mesh)), () => merge(vesV.map(v => clippedTubes([v.path], v.r, keepBack, { segments: 8 }))), { material: M("vein", "veins", tissue("vein")) });
    // Nerves and receptors.
    const nerves = [], meiss = [];
    for (let i = 0; i < 6; i++) {
      // In the half the cutaway keeps (z < 0), so they show in it.
      const x = lerp(-1.7, 1.7, R()), z = lerp(-1.7, -0.1, R()), top = papillae(x, z);
      nerves.push(tube(smoothPath([[x - 0.2, -tE - tD, z], [x, -tE - 0.6, z], [x, top - 0.05, z]], 12), 0.012, { segments: 5 }));
      meiss.push(xf(mesh.sphere(1, { segments: 8 }), T([x, top - 0.06, z]), m4.scaling([0.025, 0.06, 0.025])));
    }
    const pac = [1.3, -tE - tD - 0.9, -1.0];
    const onion = [];
    for (let k = 0; k < 4; k++) onion.push(xf(P.revolve(Array.from({ length: 17 }, (_, i) => { const a = -Math.PI / 2 + (i / 16) * Math.PI; return [(0.12 + k * 0.08) * Math.cos(a), (0.3 + k * 0.1) * Math.sin(a)]; }), { segments: segs(24, 10), arc: TAU * 0.75 }), T(pac), RX(0.4)));
    A.part("nerve fibers", merge(nerves, tube(smoothPath([[-W, -tE - tD - 0.4, -1], [0, -tE - tD - 0.5, -1.1], [pac[0], pac[1], pac[2]]], 12), 0.03, { segments: 6 })), { material: M("nerve", "nerves", tissue("nerve")), note: "sensory fibers running up to the papillae" });
    const free = [];
    for (let i = 0; i < 10; i++) { const x = lerp(-1.7, 1.7, R()), z = lerp(-1.7, -0.1, R()), top = papillae(x, z); free.push(tube(smoothPath([[x, -tE - 0.35, z], [x + 0.02, top + 0.02, z], [x + 0.03, top + 0.12, z + 0.02]], 8), 0.006, { segments: 4 })); }
    A.part("free nerve endings", merge(free), { material: M("nerve", "nerves", tissue("nerve")), note: "bare nerve endings reaching into the epidermis: pain, itch, temperature" });
    A.part("Meissner corpuscles", merge(meiss), { material: M("nerve", "Meissner", tissue("nerve", { color: "#e8c96a" })), note: "light-touch receptors in the dermal papillae" });
    A.part("Pacinian corpuscle", merge(onion), { material: M("nerve", "Pacinian", tissue("nerve", { color: "#f1e3b0" })), label: { text: "Pacinian corpuscle", at: v3.add(pac, [0.4, 0.3, 0]) }, note: "an onion-like capsule, about 1 mm long, that senses vibration and pressure" });
    // The cutaway removes fat lobules in front too.
    const fatCut = A.part("hypodermis (cut)", merge(fat.filter((_, i) => fatAt[i][2] < 0.15)), { material: M("fat", "hypodermis", tissue("fat")), visible: false });
    A._sections.push([fatG, fatCut]);
    A.info = { units: "mm", block: [2 * W, 2 * W], epidermis: tE, dermis: tD, hypodermis: tH, hair: 0.07, sources: ["Standring (ed.), Gray's Anatomy, 41st ed., 2016", "Kolarsick, Kolarsick and Goodwin, J Dermatol Nurses Assoc 3 (2011) 203"] };
    A.state = {};
    A.onPose = () => {};
    return A;
  }

  E3.bio = {
    // modeling helpers
    sd, polygonize, implicit, sheet, slab, muscle, vesselTree, longBone, leaflet, onSurface, clipPath, clippedTubes, noise, fbm, rng, tissue, TISSUE, triangles, smoothPath,
    // assemblies
    heart: detailed(heart), eye: detailed(eye), knee: detailed(knee), neuron: detailed(neuron), cell: detailed(cell), tooth: detailed(tooth), skin: detailed(skin),
  };
})();
