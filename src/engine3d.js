/* E3: a small WebGL2 engine for explainer figures.
   Surfaces are drawn the way a technical illustration is: porcelain diagram shading
   or physically based materials (metals that reflect a studio, brushed and heat-tinted
   steel, refracting glass, glowing hot parts), ink outlines, soft shadows, section cuts
   with hatching, see-through parts, ambient occlusion, GPU particles, a ray-marched
   rocket plume, bloom, and adaptive quality.
   Reference: references/engine3d.md in the skill. */
(() => {
  "use strict";

  // ---------- vectors and matrices (column-major, like WebGL) ----------
  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  };

  const m4 = {
    identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    multiply(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    translation: ([x, y, z]) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
    scaling: ([x, y, z]) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]),
    rotationX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    rotationY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rotationZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    rotationAxis(axis, a) {
      const [x, y, z] = v3.norm(axis), c = Math.cos(a), s = Math.sin(a), t = 1 - c;
      return new Float32Array([
        t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
        t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
        t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
        0, 0, 0, 1,
      ]);
    },
    // Rotates +y onto dir (for arrows, cylinders between two points).
    alignY(dir) {
      const d = v3.norm(dir);
      const axis = v3.cross([0, 1, 0], d);
      const s = v3.len(axis), c = d[1];
      if (s < 1e-8) return c > 0 ? m4.identity() : m4.rotationX(Math.PI);
      return m4.rotationAxis(axis, Math.atan2(s, c));
    },
    invert(m) {
      const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return m4.identity();
      det = 1 / det;
      return new Float32Array([
        (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
        (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
        (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
        (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
        (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
        (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
        (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
        (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
      ]);
    },
    // Upper 3x3 of the inverse transpose, for transforming normals.
    normalMatrix(m) {
      const i = m4.invert(m);
      return new Float32Array([i[0], i[4], i[8], i[1], i[5], i[9], i[2], i[6], i[10]]);
    },
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    ortho(l, r, b, t, n, f) {
      return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
        -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
    },
    lookAt(eye, target, up) {
      const z = v3.norm(v3.sub(eye, target));
      let x = v3.cross(up, z);
      if (v3.len(x) < 1e-6) x = v3.cross([0, 0, 1], z);
      x = v3.norm(x);
      const y = v3.cross(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1]);
    },
    apply: (m, p) => [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ],
    applyDir: (m, d) => [
      m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
      m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
      m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
    ],
    project(m, p) {
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [x / w, y / w, z / w, w];
    },
    // position, rotation [x, y, z] (applied X, then Y, then Z), scale, optional pivot
    compose(position, rotation, scale, pivot) {
      let m = m4.translation(position);
      if (pivot) m = m4.multiply(m, m4.translation(pivot));
      if (rotation[2]) m = m4.multiply(m, m4.rotationZ(rotation[2]));
      if (rotation[1]) m = m4.multiply(m, m4.rotationY(rotation[1]));
      if (rotation[0]) m = m4.multiply(m, m4.rotationX(rotation[0]));
      const s = typeof scale === "number" ? [scale, scale, scale] : scale;
      if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) m = m4.multiply(m, m4.scaling(s));
      if (pivot) m = m4.multiply(m, m4.translation(v3.scale(pivot, -1)));
      return m;
    },
  };

  // ---------- 2D polygon helpers and triangulation ----------
  const area2 = pts => { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const samePt = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  function inTri(p, a, b, c) {
    const d1 = cross2(a, b, p), d2 = cross2(b, c, p), d3 = cross2(c, a, p);
    const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12, pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
    return !(neg && pos);
  }

  // Joins a clockwise hole into a counterclockwise outline through a mutually visible pair of vertices.
  function bridge(poly, hole) {
    let mi = 0;
    for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[mi][0]) mi = i;
    const M = hole[mi];
    let best = Infinity, bi = -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[1] > M[1]) === (b[1] > M[1])) continue;
      const x = a[0] + (M[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
      if (x >= M[0] - 1e-9 && x - M[0] < best) { best = x - M[0]; bi = a[0] > b[0] ? i : (i + 1) % poly.length; }
    }
    if (bi < 0) return poly;
    const I = [M[0] + best, M[1]], P = poly[bi];
    let pick = bi, bestAngle = Infinity;
    for (let i = 0; i < poly.length; i++) {
      if (i === bi) continue;
      const q = poly[i], prev = poly[(i - 1 + poly.length) % poly.length], next = poly[(i + 1) % poly.length];
      if (cross2(prev, q, next) >= 0) continue; // only reflex vertices can block the bridge
      if (!inTri(q, M, I, P)) continue;
      const angle = Math.abs(Math.atan2(q[1] - M[1], q[0] - M[0]));
      if (angle < bestAngle) { bestAngle = angle; pick = i; }
    }
    const out = poly.slice(0, pick + 1);
    for (let k = 0; k <= hole.length; k++) out.push(hole[(mi + k) % hole.length]);
    out.push(poly[pick], ...poly.slice(pick + 1));
    return out;
  }

  // Ear clipping. Returns triangles [[a, b, c], ...] wound counterclockwise.
  function triangulate(outer, holes = []) {
    let poly = area2(outer) < 0 ? outer.slice().reverse() : outer.slice();
    const hs = holes.map(h => (area2(h) > 0 ? h.slice().reverse() : h.slice()));
    hs.sort((a, b) => Math.max(...b.map(p => p[0])) - Math.max(...a.map(p => p[0])));
    for (const h of hs) poly = bridge(poly, h);
    const idx = poly.map((_, i) => i);
    const tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 100000) {
      let clipped = false;
      for (let k = 0; k < idx.length; k++) {
        const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
        const a = poly[i0], b = poly[i1], c = poly[i2];
        if (cross2(a, b, c) <= 1e-12) continue;
        let ear = true;
        for (const j of idx) {
          if (j === i0 || j === i1 || j === i2) continue;
          const p = poly[j];
          if (samePt(p, a) || samePt(p, b) || samePt(p, c)) continue;
          if (inTri(p, a, b, c)) { ear = false; break; }
        }
        if (!ear) continue;
        tris.push([a, b, c]);
        idx.splice(k, 1);
        clipped = true;
        break;
      }
      if (!clipped) {
        // Degenerate input: drop the flattest vertex and keep going.
        let worst = 0, wv = Infinity;
        for (let k = 0; k < idx.length; k++) {
          const v = Math.abs(cross2(poly[idx[(k - 1 + idx.length) % idx.length]], poly[idx[k]], poly[idx[(k + 1) % idx.length]]));
          if (v < wv) { wv = v; worst = k; }
        }
        idx.splice(worst, 1);
      }
    }
    if (idx.length === 3 && cross2(poly[idx[0]], poly[idx[1]], poly[idx[2]]) > 1e-12) tris.push(idx.map(i => poly[i]));
    return tris;
  }

  // Moves each vertex of a closed polygon by d along its inward miter (positive d shrinks a CCW outline).
  function inset(pts, d) {
    if (!d) return pts.map(p => p.slice());
    const n = pts.length, ccw = area2(pts) > 0 ? 1 : -1;
    return pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const e0 = v2norm([p[0] - a[0], p[1] - a[1]]), e1 = v2norm([b[0] - p[0], b[1] - p[1]]);
      const n0 = [-e0[1] * ccw, e0[0] * ccw], n1 = [-e1[1] * ccw, e1[0] * ccw];
      const m = v2norm([n0[0] + n1[0], n0[1] + n1[1]]);
      const cos = m[0] * n0[0] + m[1] * n0[1];
      const len = d / Math.max(cos, 0.4);
      return [p[0] + m[0] * len, p[1] + m[1] * len];
    });
  }
  function v2norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

  // Catmull-Rom resampling of a 2D or 3D polyline (closed or open), for smooth outlines.
  function smooth(points, { closed = false, steps = 8 } = {}) {
    const n = points.length, out = [];
    const get = i => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        out.push(p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    if (!closed) out.push(points[n - 1].slice());
    return out;
  }

  // ---------- meshes ----------
  // Builders collect a triangle soup; finish() welds it and computes normals,
  // keeping edges sharper than `crease` degrees hard.
  class Soup {
    constructor() { this.p = []; }
    tri(a, b, c) { this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
    quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  }

  function finish(soup, { crease = 35, closed = false } = {}) {
    let p = soup.p;
    const nt = p.length / 9;
    if (closed && nt) {
      let vol = 0;
      for (let t = 0; t < nt; t++) {
        const o = t * 9;
        vol += p[o] * (p[o + 4] * p[o + 8] - p[o + 5] * p[o + 7]) - p[o + 1] * (p[o + 3] * p[o + 8] - p[o + 5] * p[o + 6]) + p[o + 2] * (p[o + 3] * p[o + 7] - p[o + 4] * p[o + 6]);
      }
      if (vol < 0) {
        p = p.slice();
        for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const o = t * 9; const tmp = p[o + 3 + k]; p[o + 3 + k] = p[o + 6 + k]; p[o + 6 + k] = tmp; }
      }
    }
    const fn = new Float64Array(nt * 3), fu = new Float64Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
      const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz;
      const l = Math.hypot(nx, ny, nz) || 1;
      fu[t * 3] = nx / l; fu[t * 3 + 1] = ny / l; fu[t * 3 + 2] = nz / l;
    }
    const q = v => Math.round(v * 1e4);
    const key = c => `${q(p[c * 3])},${q(p[c * 3 + 1])},${q(p[c * 3 + 2])}`;
    const groups = new Map();
    for (let c = 0; c < nt * 3; c++) {
      const k = key(c);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(c);
    }
    const cosC = Math.cos((crease * Math.PI) / 180);
    const positions = [], normals = [], indices = [], vmap = new Map();
    for (let c = 0; c < nt * 3; c++) {
      const f = (c / 3) | 0;
      let nx = 0, ny = 0, nz = 0;
      for (const d of groups.get(key(c))) {
        const g = (d / 3) | 0;
        if (fu[f * 3] * fu[g * 3] + fu[f * 3 + 1] * fu[g * 3 + 1] + fu[f * 3 + 2] * fu[g * 3 + 2] >= cosC) {
          nx += fn[g * 3]; ny += fn[g * 3 + 1]; nz += fn[g * 3 + 2];
        }
      }
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) { nx = fu[f * 3]; ny = fu[f * 3 + 1]; nz = fu[f * 3 + 2]; l = Math.hypot(nx, ny, nz) || 1; }
      nx /= l; ny /= l; nz /= l;
      const vk = `${key(c)}|${Math.round(nx * 1000)},${Math.round(ny * 1000)},${Math.round(nz * 1000)}`;
      let vi = vmap.get(vk);
      if (vi === undefined) {
        vi = positions.length / 3;
        vmap.set(vk, vi);
        positions.push(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]);
        normals.push(nx, ny, nz);
      }
      indices.push(vi);
    }
    return makeMesh(new Float32Array(positions), new Float32Array(normals), new Uint32Array(indices));
  }

  function makeMesh(positions, normals, indices) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
      if (positions[i + k] < min[k]) min[k] = positions[i + k];
      if (positions[i + k] > max[k]) max[k] = positions[i + k];
    }
    if (!positions.length) { min.fill(0); max.fill(0); }
    const center = v3.lerp(min, max, 0.5);
    let radius = 0;
    for (let i = 0; i < positions.length; i += 3) radius = Math.max(radius, v3.dist(center, [positions[i], positions[i + 1], positions[i + 2]]));
    return { positions, normals, indices, bounds: { min, max, center, radius }, version: 0, isMesh: true };
  }

  function transformMesh(mesh, m) {
    const nm = m4.normalMatrix(m);
    const pos = new Float32Array(mesh.positions.length), nor = new Float32Array(mesh.normals.length);
    for (let i = 0; i < pos.length; i += 3) {
      const p = m4.apply(m, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
      const n = mesh.normals;
      const q = v3.norm([nm[0] * n[i] + nm[3] * n[i + 1] + nm[6] * n[i + 2], nm[1] * n[i] + nm[4] * n[i + 1] + nm[7] * n[i + 2], nm[2] * n[i] + nm[5] * n[i + 1] + nm[8] * n[i + 2]]);
      pos.set(p, i);
      nor.set(q, i);
    }
    return makeMesh(pos, nor, mesh.indices.slice());
  }

  function mergeMeshes(...meshes) {
    meshes = meshes.flat();
    let nv = 0, ni = 0;
    for (const m of meshes) { nv += m.positions.length; ni += m.indices.length; }
    const pos = new Float32Array(nv), nor = new Float32Array(nv), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const m of meshes) {
      pos.set(m.positions, vo);
      nor.set(m.normals, vo);
      const base = vo / 3;
      for (let i = 0; i < m.indices.length; i++) idx[io + i] = m.indices[i] + base;
      vo += m.positions.length;
      io += m.indices.length;
    }
    return makeMesh(pos, nor, idx);
  }

  function grid(soup, rows, cols, at, { wrapCols = false } = {}) {
    const cc = wrapCols ? cols : cols - 1;
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cc; j++) {
      const j1 = (j + 1) % cols;
      soup.quad(at(i, j), at(i + 1, j), at(i + 1, j1), at(i, j1));
    }
  }

  const mesh = {
    box(w, h, d, { round = 0, segments = 4 } = {}) {
      const hx = w / 2, hy = h / 2, hz = d / 2;
      const r = Math.min(round, hx, hy, hz);
      const half = [hx, hy, hz], inner = [hx - r, hy - r, hz - r];
      const samples = k => {
        if (r <= 0) return [-half[k], half[k]];
        const s = [];
        for (let i = segments; i >= 1; i--) s.push(-(inner[k] + r * Math.tan((i / segments) * Math.PI / 4)));
        if (inner[k] > 1e-9) s.push(-inner[k], inner[k]); else s.push(0);
        for (let i = 1; i <= segments; i++) s.push(inner[k] + r * Math.tan((i / segments) * Math.PI / 4));
        return s;
      };
      const soup = new Soup();
      for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        const su = samples(u), sv = samples(v);
        const at = (i, j) => {
          const pt = [0, 0, 0];
          pt[axis] = sign * half[axis];
          pt[u] = su[i];
          pt[v] = sign > 0 ? sv[j] : -sv[j];
          if (r <= 0) return pt;
          const c = pt.map((x, k) => Math.max(-inner[k], Math.min(inner[k], x)));
          const n = v3.norm(v3.sub(pt, c));
          return v3.add(c, v3.scale(n, r));
        };
        grid(soup, su.length, sv.length, at);
      }
      return finish(soup, { crease: r > 0 ? 50 : 30, closed: true });
    },

    ellipsoid(rx, ry = rx, rz = rx, { segments = 28 } = {}) {
      const soup = new Soup(), rows = segments + 1, cols = segments * 2;
      const at = (i, j) => {
        const th = (i / segments) * Math.PI, ph = (j / cols) * Math.PI * 2;
        return [rx * Math.sin(th) * Math.cos(ph), ry * Math.cos(th), rz * Math.sin(th) * Math.sin(ph)];
      };
      grid(soup, rows, cols, at, { wrapCols: true });
      return finish(soup, { crease: 80, closed: true });
    },
    sphere(r, o) { return mesh.ellipsoid(r, r, r, o); },

    // Along y, centered on the origin. r2 = 0 makes a cone.
    cylinder(r, h, { r2 = r, segments = 36, caps = true } = {}) {
      const soup = new Soup(), y0 = -h / 2, y1 = h / 2;
      const ring = (rad, y) => Array.from({ length: segments }, (_, j) => {
        const a = (j / segments) * Math.PI * 2;
        return [rad * Math.cos(a), y, -rad * Math.sin(a)];
      });
      const b = ring(r, y0), t = ring(r2, y1);
      for (let j = 0; j < segments; j++) {
        const k = (j + 1) % segments;
        soup.quad(b[j], b[k], t[k], t[j]);
      }
      if (caps) {
        for (let j = 0; j < segments; j++) {
          const k = (j + 1) % segments;
          if (r > 0) soup.tri([0, y0, 0], b[k], b[j]);
          if (r2 > 0) soup.tri([0, y1, 0], t[j], t[k]);
        }
      }
      return finish(soup, { crease: 40, closed: caps });
    },

    // Around y, in the xz plane.
    torus(R, r, { segments = 64, tube = 18, arc = Math.PI * 2 } = {}) {
      const soup = new Soup(), full = arc >= Math.PI * 2 - 1e-6;
      const cols = full ? segments : segments + 1;
      const at = (i, j) => {
        const a = (j / segments) * arc, b = (i / tube) * Math.PI * 2;
        const rr = R + r * Math.cos(b);
        return [rr * Math.cos(a), r * Math.sin(b), -rr * Math.sin(a)];
      };
      for (let i = 0; i < tube; i++) for (let j = 0; j < (full ? segments : segments); j++) {
        const j1 = full ? (j + 1) % segments : j + 1;
        soup.quad(at(i, j), at(i, j1), at(i + 1, j1), at(i + 1, j));
      }
      return finish(soup, { crease: 60, closed: full });
    },

    // Revolves a profile [[radius, y], ...] around y.
    lathe(profile, { segments = 48, crease = 35 } = {}) {
      const soup = new Soup(), n = profile.length;
      const at = (i, j) => {
        const a = (j / segments) * Math.PI * 2, [r, y] = profile[i];
        return [r * Math.cos(a), y, -r * Math.sin(a)];
      };
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < segments; j++) {
        const j1 = (j + 1) % segments;
        soup.quad(at(i, j), at(i, j1), at(i + 1, j1), at(i + 1, j));
      }
      const closed = profile[0][0] === 0 && profile[n - 1][0] === 0;
      return finish(soup, { crease, closed });
    },

    // Extrudes a 2D outline (xy) along z, centered. Optional rounded bevel and holes.
    extrude(shape, depth, { bevel = 0, bevelSegments = 3, holes = [] } = {}) {
      const outer = area2(shape) < 0 ? shape.slice().reverse() : shape.slice();
      const hs = holes.map(h => (area2(h) > 0 ? h.slice().reverse() : h.slice()));
      const b = Math.min(bevel, depth / 2 - 1e-6);
      const layers = [];
      if (b > 0) {
        for (let k = bevelSegments; k >= 0; k--) {
          const a = (k / bevelSegments) * Math.PI / 2;
          layers.push({ inset: b * (1 - Math.cos(a)), z: -(depth / 2 - b) - b * Math.sin(a) });
        }
        for (let k = 0; k <= bevelSegments; k++) {
          const a = (k / bevelSegments) * Math.PI / 2;
          layers.push({ inset: b * (1 - Math.cos(a)), z: depth / 2 - b + b * Math.sin(a) });
        }
      } else {
        layers.push({ inset: 0, z: -depth / 2 }, { inset: 0, z: depth / 2 });
      }
      const soup = new Soup();
      const loops = [outer, ...hs];
      for (const loop of loops) {
        const rings = layers.map(L => inset(loop, L.inset).map(p => [p[0], p[1], L.z]));
        for (let k = 0; k < rings.length - 1; k++) {
          const A = rings[k], B = rings[k + 1], n = loop.length;
          for (let i = 0; i < n; i++) {
            const i1 = (i + 1) % n;
            soup.quad(A[i], A[i1], B[i1], B[i]);
          }
        }
      }
      const capInset = b;
      const capOuter = inset(outer, capInset), capHoles = hs.map(h => inset(h, capInset));
      const tris = triangulate(capOuter, capHoles);
      for (const [p, q, r] of tris) {
        soup.tri([p[0], p[1], depth / 2], [q[0], q[1], depth / 2], [r[0], r[1], depth / 2]);
        soup.tri([p[0], p[1], -depth / 2], [r[0], r[1], -depth / 2], [q[0], q[1], -depth / 2]);
      }
      return finish(soup, { crease: 35, closed: true });
    },

    // Sweeps a 2D cross-section along a 3D path. section: [[x, y], ...] or (t, i) => [[x, y], ...]
    // with the same point count everywhere. x maps to the side vector, y to the up vector.
    sweep(path, section, { closed = false, caps = true, up = null, crease = 50 } = {}) {
      const n = path.length;
      const T = path.map((_, i) => {
        const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
        const b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        return v3.norm(v3.sub(b, a));
      });
      const Nn = [], Bn = [];
      if (up) {
        for (let i = 0; i < n; i++) {
          let B = v3.sub(up, v3.scale(T[i], v3.dot(up, T[i])));
          if (v3.len(B) < 1e-6) B = Bn[i - 1] || [1, 0, 0];
          B = v3.norm(B);
          Bn.push(B);
          Nn.push(v3.norm(v3.cross(B, T[i])));
        }
      } else {
        let N0 = v3.cross(T[0], Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
        let N = v3.norm(N0);
        for (let i = 0; i < n; i++) {
          if (i > 0) {
            N = v3.sub(N, v3.scale(T[i], v3.dot(N, T[i])));
            N = v3.len(N) < 1e-6 ? Nn[i - 1] : v3.norm(N);
          }
          Nn.push(N);
          Bn.push(v3.norm(v3.cross(T[i], N)));
        }
      }
      const sec = i => (typeof section === "function" ? section(n > 1 ? i / (n - 1) : 0, i) : section);
      const rings = path.map((P, i) => sec(i).map(([x, y]) => v3.add(P, v3.add(v3.scale(Nn[i], x), v3.scale(Bn[i], y)))));
      const m = rings[0].length;
      // Orient side quads so normals point away from the path.
      const probe = () => {
        const a = rings[0][0], b = rings[0][1 % m], c = rings[1][1 % m];
        const nrm = v3.cross(v3.sub(b, a), v3.sub(c, a));
        const s0 = sec(0), cx = s0.reduce((s, p) => s + p[0], 0) / m, cy = s0.reduce((s, p) => s + p[1], 0) / m;
        const center = v3.add(path[0], v3.add(v3.scale(Nn[0], cx), v3.scale(Bn[0], cy)));
        return v3.dot(nrm, v3.sub(a, center)) >= 0;
      };
      const flip = n > 1 && !probe();
      const soup = new Soup();
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const A = rings[i], B = rings[(i + 1) % n];
        for (let j = 0; j < m; j++) {
          const j1 = (j + 1) % m;
          if (flip) soup.quad(A[j], B[j], B[j1], A[j1]);
          else soup.quad(A[j], A[j1], B[j1], B[j]);
        }
      }
      if (caps && !closed) {
        for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
          const tris = triangulate(sec(i));
          for (const tri of tris) {
            const pts = tri.map(([x, y]) => v3.add(path[i], v3.add(v3.scale(Nn[i], x), v3.scale(Bn[i], y))));
            const nrm = v3.cross(v3.sub(pts[1], pts[0]), v3.sub(pts[2], pts[0]));
            if (v3.dot(nrm, T[i]) * dir >= 0) soup.tri(pts[0], pts[1], pts[2]);
            else soup.tri(pts[0], pts[2], pts[1]);
          }
        }
      }
      return finish(soup, { crease, closed: closed || caps });
    },

    // A tube of radius r (number or t => number) along a path.
    tube(path, r, { segments = 18, closed = false, caps = true } = {}) {
      const radius = typeof r === "function" ? r : () => r;
      const circle = t => Array.from({ length: segments }, (_, j) => {
        const a = (j / segments) * Math.PI * 2, rr = Math.max(1e-4, radius(t));
        return [rr * Math.cos(a), rr * Math.sin(a)];
      });
      return mesh.sweep(path, circle, { closed, caps, crease: 70 });
    },

    helix(radius, pitch, turns, wire, { segments = 24 } = {}) {
      const steps = Math.max(12, Math.round(turns * 36)), path = [];
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * turns * Math.PI * 2;
        path.push([radius * Math.cos(a), (i / steps) * turns * pitch - (turns * pitch) / 2, -radius * Math.sin(a)]);
      }
      return mesh.tube(path, wire, { segments });
    },

    // A spur gear lying in the xz plane (axis along y).
    gear({ teeth = 20, module = 1, thickness = 2, hole = 0, spokes = 0, rim = null, bevel = 0 } = {}) {
      const rp = (teeth * module) / 2, ra = rp + module, rr = Math.max(rp - 1.25 * module, module * 0.5);
      const P = (Math.PI * 2) / teeth, pts = [];
      const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
      for (let k = 0; k < teeth; k++) {
        const c = k * P;
        pts.push(polar(rr, c - 0.5 * P), polar(rr, c - 0.3 * P), polar(rp, c - 0.22 * P), polar(ra, c - 0.13 * P),
          polar(ra, c), polar(ra, c + 0.13 * P), polar(rp, c + 0.22 * P), polar(rr, c + 0.3 * P));
      }
      const holes = [];
      const circle = (r, n = 32) => Array.from({ length: n }, (_, i) => polar(r, (i / n) * Math.PI * 2));
      if (hole > 0) holes.push(circle(hole));
      if (spokes > 0) {
        const rimW = rim ?? module * 2.2, rOut = rr - rimW, rIn = Math.max(hole * 2.2, rp * 0.28);
        const spokeAng = Math.min(0.5, (module * 1.6) / ((rOut + rIn) / 2));
        for (let s = 0; s < spokes; s++) {
          const a0 = (s / spokes) * Math.PI * 2 + spokeAng / 2, a1 = ((s + 1) / spokes) * Math.PI * 2 - spokeAng / 2;
          if (rOut <= rIn || a1 <= a0) continue;
          const win = [];
          for (let i = 0; i <= 12; i++) win.push(polar(rOut, a0 + ((a1 - a0) * i) / 12));
          for (let i = 12; i >= 0; i--) win.push(polar(rIn, a0 + ((a1 - a0) * i) / 12));
          holes.push(win);
        }
      }
      const m = mesh.extrude(pts, thickness, { holes, bevel });
      return transformMesh(m, m4.rotationX(-Math.PI / 2));
    },

    // A straight arrow from a to b (world units), shaft plus cone head.
    arrow(a, b, { radius = null, head = null, headRadius = null, segments = 20 } = {}) {
      const len = v3.dist(a, b);
      const r = radius ?? len * 0.03, hl = Math.min(head ?? r * 5, len * 0.6), hr = headRadius ?? r * 2.4;
      const shaft = transformMesh(mesh.cylinder(r, len - hl, { segments }), m4.translation([0, (len - hl) / 2, 0]));
      const tip = transformMesh(mesh.cylinder(hr, hl, { r2: 0, segments }), m4.translation([0, len - hl / 2, 0]));
      const m = m4.multiply(m4.translation(a), m4.alignY(v3.sub(b, a)));
      return transformMesh(mergeMeshes(shaft, tip), m);
    },

    // A curved arrow around the y axis, from angle a0 to a1 (radians, counterclockwise seen from +y).
    arcArrow(radius, a0, a1, { tube = null, head = null, y = 0, segments = 40 } = {}) {
      const r = tube ?? radius * 0.06, hl = head ?? r * 5, dir = Math.sign(a1 - a0) || 1;
      const headAng = Math.min(Math.abs(a1 - a0) * 0.5, hl / radius);
      const end = a1 - dir * headAng, path = [];
      for (let i = 0; i <= segments; i++) {
        const a = a0 + ((end - a0) * i) / segments;
        path.push([radius * Math.cos(a), y, -radius * Math.sin(a)]);
      }
      const body = mesh.tube(path, r, { segments: 16 });
      const p1 = [radius * Math.cos(a1), y, -radius * Math.sin(a1)];
      const p0 = [radius * Math.cos(end), y, -radius * Math.sin(end)];
      const cone = transformMesh(mesh.cylinder(r * 2.4, v3.dist(p0, p1), { r2: 0, segments: 20 }),
        m4.multiply(m4.multiply(m4.translation(v3.lerp(p0, p1, 0.5)), m4.alignY(v3.sub(p1, p0))), m4.identity()));
      return mergeMeshes(body, cone);
    },

    plane(w, d) {
      const soup = new Soup(), x = w / 2, z = d / 2;
      soup.quad([-x, 0, z], [x, 0, z], [x, 0, -z], [-x, 0, -z]);
      return finish(soup, { crease: 10 });
    },

    custom(positions, indices, { crease = 35 } = {}) {
      const soup = new Soup();
      for (let i = 0; i < indices.length; i += 3) soup.tri(positions[indices[i]], positions[indices[i + 1]], positions[indices[i + 2]]);
      return finish(soup, { crease });
    },

    transform: transformMesh,
    merge: mergeMeshes,
  };


  // ---------- color ----------
  // Colors are 0..1 display (sRGB) values unless a name says linear. Palette values arrive
  // as #rgb, #rrggbb, or rgb() once a host's CSS minifier has had them.
  const clamp01 = x => Math.max(0, Math.min(1, x));
  function parseColor(v) {
    const s = String(v ?? "").trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [...m[1]].map(h => parseInt(h + h, 16) / 255);
    m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
    return null;
  }
  const hexRgb = hex => parseColor(hex) ?? [0.5, 0.5, 0.5];
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const toLinear = c => c.map(v => Math.max(0, v) ** 2.2);
  const toHex = c => "#" + c.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");

  // Color of a black body at T kelvin, as linear RGB with its brightest channel at 1
  // (Tanner Helland's fit to the Planckian locus). The shaders carry the same formula.
  function blackbody(T) {
    const t = Math.min(40000, Math.max(500, T)) / 100;
    const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return [r, g, b].map(v => clamp01(v / 255) ** 2.2);
  }
  // How brightly a surface at T kelvin glows, in the engine's linear units: nothing below
  // about 720 K (450 °C), a dull red by 1000 K, bright orange by 1500 K, near white past 2500 K.
  const glowOf = T => { const k = Math.max(T - 720, 0) / 700; return k * k * k * 2.5; };
  // Temper colors: the oxide film on hot steel goes straw, brown, purple, blue, then grey.
  // T in kelvin; shift moves the ramp up for alloys that resist it (inconel: 150).
  // Returns { color: [r, g, b] display, amount: 0..1 }.
  function heatTint(T, shift = 0) {
    const c = T - shift - 273.15, sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    let col = mixRgb([0.93, 0.86, 0.62], [0.85, 0.66, 0.32], sm(190, 240, c));
    col = mixRgb(col, [0.62, 0.38, 0.2], sm(240, 260, c));
    col = mixRgb(col, [0.45, 0.22, 0.42], sm(260, 278, c));
    col = mixRgb(col, [0.15, 0.2, 0.55], sm(278, 295, c));
    col = mixRgb(col, [0.3, 0.5, 0.78], sm(295, 320, c));
    col = mixRgb(col, [0.52, 0.55, 0.58], sm(320, 380, c));
    col = mixRgb(col, [0.36, 0.35, 0.34], sm(380, 600, c));
    return { color: col, amount: sm(180, 230, c) };
  }

  // ---------- materials ----------
  // Materials without `metal` or `roughness` keep the original porcelain shading: soft wrap
  // light, ink outlines, the house diagram look. The rest are physically based: GGX
  // specular, Fresnel, metalness and roughness, lit by the studio environment. f0 is the
  // measured reflectance of the metal (linear RGB).
  const MATERIALS = {
    porcelain: { color: "#f1efe9" },
    paper: { color: "#f7f5ef" },
    bone: { color: "#ede2c9" },
    enamel: { color: "#f8f5ed" },
    cartilage: { color: "#d5e4ea" },
    muscle: { color: "#dc8c80" },
    tendon: { color: "#eee1c0" },
    tissue: { color: "#f0c5ba" },
    fat: { color: "#f2e0a6" },
    nerve: { color: "#ecd067" },
    artery: { color: "#d8645c" },
    vein: { color: "#7896c8" },
    graphite: { color: "#4a4a50" },
    steel: { color: "#bfc3ca", metal: 1, roughness: 0.3, f0: [0.56, 0.57, 0.58] },
    brushed: { color: "#c4c7cc", metal: 1, roughness: 0.3, f0: [0.6, 0.6, 0.6], anisotropy: 0.75, brush: "turned" },
    aluminum: { color: "#d4d7db", metal: 1, roughness: 0.36, f0: [0.91, 0.92, 0.92] },
    titanium: { color: "#a9a49c", metal: 1, roughness: 0.38, f0: [0.54, 0.5, 0.45], heatShift: 60 },
    chrome: { color: "#d8dadc", metal: 1, roughness: 0.08, f0: [0.55, 0.56, 0.55] },
    copper: { color: "#cf8a5c", metal: 1, roughness: 0.26, f0: [0.95, 0.64, 0.54] },
    brass: { color: "#d1a650", metal: 1, roughness: 0.24, f0: [0.91, 0.78, 0.42] },
    gold: { color: "#e0b94f", metal: 1, roughness: 0.18, f0: [1.0, 0.77, 0.34] },
    inconel: { color: "#b8b3aa", metal: 1, roughness: 0.4, f0: [0.62, 0.58, 0.52], heatShift: 150 },
    ceramic: { color: "#ece8df", metal: 0, roughness: 0.4 },
    plastic: { color: "#e9e7e2", metal: 0, roughness: 0.5 },
    concrete: { color: "#bdb8ae", metal: 0, roughness: 0.92 },
    carbon: { color: "#2b2c30", metal: 0, roughness: 0.32, clearcoat: 1, weave: true },
    rubber: { color: "#2c2c2e", metal: 0, roughness: 0.9 },
    paint: { color: "#e6e3dc", metal: 0, roughness: 0.45, clearcoat: 1 },
    glass: { color: "#eef4f4", glass: true, ior: 1.5, roughness: 0.03, dispersion: 0.008 },
    frosted: { color: "#f1f4f4", glass: true, ior: 1.5, roughness: 0.35, dispersion: 0.004 },
    water: { color: "#9cc9d8", glass: true, ior: 1.333, roughness: 0.02, dispersion: 0.002, water: true },
    ghost: { color: "#f1efe9", opacity: 0.3 },
    hot: { color: "#3b3634", metal: 0, roughness: 0.6, temperature: 1400 },
  };
  const ACCENTS = ["red", "orange", "green", "blue", "purple"];
  // In the "anatomy" look the anatomy names shade as tissue (other looks keep the diagram look,
  // so simple teaching figures stay simple). An object material can tune any of these.
  const TISSUE = {
    bone: { sss: 0.22, sssColor: "#c79a6a", wet: 0.08 }, enamel: { sss: 0.4, sssColor: "#d7d2c0", wet: 0.35 },
    cartilage: { sss: 0.75, sssColor: "#8fb1c4", wet: 0.65 }, muscle: { sss: 0.55, sssColor: "#9c2a22", wet: 0.45, sheen: 0.15 },
    tendon: { sss: 0.3, sssColor: "#c9a77a", wet: 0.35, sheen: 0.6 }, tissue: { sss: 0.6, sssColor: "#c9533f", wet: 0.5 },
    fat: { sss: 0.8, sssColor: "#e0a640", wet: 0.35 }, nerve: { sss: 0.45, sssColor: "#b8902d", wet: 0.35, sheen: 0.3 },
    artery: { sss: 0.5, sssColor: "#8a1c16", wet: 0.55 }, vein: { sss: 0.5, sssColor: "#2c3f7a", wet: 0.55 },
  };

  // A display color for a material color: an accent name, a material name, #hex, rgb(), or a
  // palette name. Accents on diagram materials are the pale tints of the page's subject
  // colors; on physical materials (paint) they are the subject colors themselves.
  function colorOf(c, physical) {
    const pal = (typeof window !== "undefined" && window.palette) || {};
    if (ACCENTS.includes(c)) { const p = hexRgb(pal[c] || "#888888"); return physical ? p : mixRgb(p, [1, 1, 1], 0.42); }
    if (MATERIALS[c]) return hexRgb(MATERIALS[c].color);
    return parseColor(c) ?? (pal[c] ? hexRgb(pal[c]) : hexRgb(MATERIALS.porcelain.color));
  }

  // Temperature: a number (kelvin) or a field along a local axis,
  // { axis: [0, 1, 0], stops: [[s, T], ...] } with s the distance along the axis (up to 4 stops).
  function tempField(t) {
    if (t == null || t === false) return null;
    if (typeof t === "number") return { axis: [0, 1, 0], stops: [[0, t]] };
    const stops = (Array.isArray(t) ? t : t.stops || []).slice(0, 4).map(s => [+s[0], +s[1]]).sort((a, b) => a[0] - b[0]);
    return stops.length ? { axis: v3.norm(t.axis || [0, 1, 0]), stops } : null;
  }
  const tempAt = (field, s) => {
    const S = field.stops;
    if (S.length === 1 || s <= S[0][0]) return S[0][1];
    for (let i = 1; i < S.length; i++) if (s <= S[i][0]) return S[i - 1][1] + (S[i][1] - S[i - 1][1]) * (s - S[i - 1][0]) / (S[i][0] - S[i - 1][0] || 1);
    return S[S.length - 1][1];
  };

  // Everything the renderer needs to know about how a node looks.
  function resolveMaterial(node, look) {
    let m = node.material, name = null;
    const tissueOf = n => (look === "anatomy" && TISSUE[n] ? TISSUE[n] : {});
    if (typeof m === "string") { name = m; m = { ...(MATERIALS[m] ?? { color: m }), ...tissueOf(m) }; }
    else if (m && m.base) m = { ...(MATERIALS[m.base] || {}), ...tissueOf(m.base), ...m };
    m = { ...(m || {}) };
    // Tissue only shades as tissue in the anatomy look; elsewhere it's the diagram color.
    const tissue = look === "anatomy" && (m.sss != null || m.wet != null || m.sheen != null);
    if (tissue) {
      const wet = clamp01(m.wet ?? 0.3);
      m.roughness ??= 0.72 - 0.4 * wet;
      m.clearcoat ??= wet * 0.85;
      m.metal ??= 0;
    }
    if (m.color == null) m.color = MATERIALS.porcelain.color;
    const temp = tempField(node.temperature ?? m.temperature);
    const physical = (m.metal != null && m.metal !== false) || m.roughness != null || !!m.glass || m.emissive != null || !!temp;
    const rgb = colorOf(node.color ?? m.color, physical);
    const metal = m.metal === true ? 1 : clamp01(+m.metal || 0);
    const f0 = metal ? (node.color == null && m.f0 ? m.f0 : toLinear(rgb)) : [0.04, 0.04, 0.04];
    let emissive = [0, 0, 0];
    if (m.emissive != null && m.emissive !== false) {
      const k = m.emissiveIntensity ?? 2;
      emissive = typeof m.emissive === "number" ? toLinear(rgb).map(v => v * m.emissive) : toLinear(Array.isArray(m.emissive) ? m.emissive : colorOf(m.emissive, true)).map(v => v * k);
    }
    const opacity = node.opacity < 1 ? node.opacity : m.opacity ?? 1;
    const brush = m.brush === "linear" ? 1 : 0;
    return {
      name, rgb, physical, metal, f0, emissive, temp, opacity,
      kind: opacity < 0.999 ? "ghost" : m.glass ? "glass" : "opaque",
      roughness: clamp01(m.roughness ?? (metal ? 0.3 : 0.5)),
      anisotropy: clamp01(m.anisotropy ?? 0),
      brush, brushAxis: v3.norm(m.brushAxis || [0, 1, 0]),
      clearcoat: clamp01(m.clearcoat ?? 0),
      weave: !!m.weave,
      heatShift: metal && temp ? (m.heatShift ?? 0) : null,
      ior: m.ior ?? 1.5, dispersion: m.dispersion ?? 0.008, thickness: m.thickness ?? null,
      water: m.water ? { ripples: m.ripples ?? 0.35, wavelength: m.wavelength ?? null, depth: m.depthColor ?? 0.5 } : null,
      glow: !!temp || emissive.some(v => v > 0),
      sss: tissue ? clamp01(m.sss ?? 0.4) : 0, sssColor: tissue ? colorOf(m.sssColor ?? "#b5463d", true) : [0, 0, 0],
      sheen: tissue ? clamp01(m.sheen ?? 0) : 0, fibers: tissue && m.fibers ? v3.norm(m.fibers === true ? [0, 1, 0] : m.fibers) : null,
    };
  }

  // ---------- looks ----------
  // One word picks the whole light rig: the environment the metals reflect, the strength of
  // the camera-locked key, fill, and rim lights, shadows, outline weight, and bloom.
  //   studio   soft boxes on a neutral sweep, the default
  //   diagram  flatter and lighter, for teaching drawings with only a few real materials
  //   night    dark surround, strong rim light, glowing parts carry the picture
  //   outdoor  sky dome and a warm sun, harder shadows
  const LOOKS = {
    studio: { env: 0, key: 2.6, fill: 0.5, rim: 1.4, diffuse: 1, specular: 1, ink: 1, parts: 0.5, ground: 0.5, soft: 1, bloom: 0.9, exposure: 1, keyColor: [1, 0.97, 0.93], fillColor: [0.9, 0.94, 1] },
    diagram: { env: 0, key: 2.2, fill: 0.6, rim: 0.7, diffuse: 1.15, specular: 0.85, ink: 1, parts: 0.3, ground: 0.36, soft: 1.5, bloom: 0.6, exposure: 1.05, keyColor: [1, 0.98, 0.95], fillColor: [0.92, 0.95, 1] },
    night: { env: 1, key: 1.1, fill: 0.15, rim: 2.6, diffuse: 0.5, specular: 1, ink: 0.55, parts: 0.7, ground: 0.6, soft: 0.8, bloom: 1.4, exposure: 1, keyColor: [0.72, 0.8, 1], fillColor: [0.6, 0.7, 1] },
    outdoor: { env: 2, key: 3.4, fill: 0.55, rim: 0.4, diffuse: 0.9, specular: 1, ink: 0.65, parts: 0.65, ground: 0.6, soft: 0.45, bloom: 0.7, exposure: 0.95, keyColor: [1, 0.94, 0.84], fillColor: [0.72, 0.84, 1] },
    // Anatomy: a soft surgical studio; anatomy materials shade as tissue, light ink.
    anatomy: { env: 0, key: 2.3, fill: 0.8, rim: 0.9, diffuse: 1.05, specular: 0.9, ink: 0.45, parts: 0.55, ground: 0.45, soft: 1.3, bloom: 0.45, exposure: 1.05, keyColor: [1, 0.96, 0.92], fillColor: [0.92, 0.95, 1] },
  };
  const lookOf = scene => LOOKS[scene.look] || LOOKS.studio;
  // Whether the page is dark, from the palette's background.
  function pageDark() {
    const pal = (typeof window !== "undefined" && window.palette) || {};
    const c = parseColor(pal.bg || pal.panel);
    return !!c && 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 0.5;
  }

  // ---------- adaptive quality ----------
  // Three tiers. While the view moves or an animation plays, the engine watches the time
  // between frames and steps down a tier when frames run long, back up when they're quick.
  // Still frames (and the page checker) always get the full shadow and volume quality;
  // particle counts follow the tier so a paused figure doesn't change its smoke. Systems
  // that measure, run on the CPU, or hold a fixed population (gas molecules) keep every slot.
  const TIERS = {
    low: { rank: 0, ss: 1, scale: 0.75, msaa: 4, shadow: 1024, particles: 0.35, steps: 22, bloom: true, vsteps: 36, vscale: 0.33 },
    medium: { rank: 1, ss: 2, scale: 1, msaa: 4, shadow: 1536, particles: 0.6, steps: 32, bloom: true, vsteps: 56, vscale: 0.5 },
    high: { rank: 2, ss: 3, scale: 1, msaa: 4, shadow: 2048, particles: 1, steps: 48, bloom: true, vsteps: 88, vscale: 0.5 },
  };
  const TIER_NAMES = ["low", "medium", "high"];
  const Q = { rank: null, ema: 16.7, last: 0, quickSince: 0, downAt: -1e9, forced: null };
  function startRank() {
    try {
      const coarse = matchMedia("(pointer: coarse)").matches;
      const small = Math.min(screen.width, screen.height) < 600;
      return coarse ? (small ? 0 : 1) : 2;
    } catch { return 2; }
  }
  const checking = () => typeof document !== "undefined" && document.documentElement.classList.contains("safis-checking");
  // Picks the tier for this frame. `moving` frames come in a stream (< 250 ms apart) or at
  // ss 1, which the page asks for while the reader drags on a dense screen. A caller that
  // knows better passes `cam.still` (the runtime does: true for the frame after a drag),
  // so the settled frame always comes back at full quality.
  function qualityFor(scene, cam, ss, now) {
    const force = cam.quality ?? scene.quality ?? Q.forced;
    const dt = now - (scene._lastFrame ?? -1e9);
    scene._lastFrame = now;
    const moving = cam.still != null ? !cam.still : dt < 250 || ss < 2;
    if (Q.rank == null) Q.rank = startRank();
    if (checking()) return { ...TIERS.high, name: "high", ss, moving: false };
    if (TIERS[force]) {
      const t = TIERS[force];
      return { ...t, name: force, ss: moving ? Math.min(ss, t.ss) : ss, scale: moving ? t.scale : 1, moving };
    }
    const hitch = typeof R !== "undefined" && R && R.hitch;
    if (hitch) R.hitch = false;
    if (moving && dt < 250 && !hitch) {
      Q.ema = Q.ema * 0.9 + Math.min(dt, 250) * 0.1;
      if (Q.ema > 30 && Q.rank > 0 && now - Q.downAt > 800) { Q.rank--; Q.downAt = now; Q.ema = 20; Q.quickSince = now; }
      else if (Q.ema < 18) {
        if (!Q.quickSince) Q.quickSince = now;
        if (Q.rank < 2 && now - Q.quickSince > 3000 && now - Q.downAt > 10000) { Q.rank++; Q.quickSince = now; }
      } else Q.quickSince = 0;
    }
    const name = TIER_NAMES[Q.rank], t = TIERS[name];
    if (!moving) return { ...t, name, ss, scale: 1, shadow: TIERS.high.shadow, steps: TIERS.high.steps, vsteps: TIERS.high.vsteps, vscale: TIERS.high.vscale, moving };
    return { ...t, name, ss: Math.min(ss, t.ss), moving };
  }

  // ---------- scene graph ----------
  class Node {
    constructor(meshArg = null, o = {}) {
      this.mesh = meshArg;
      this.children = [];
      this.parent = null;
      this.name = "";
      this.position = [0, 0, 0];
      this.rotation = [0, 0, 0];
      this.scale = 1;
      this.pivot = null;
      this.matrix = null;
      this.material = "porcelain";
      this.color = null;
      this.opacity = 1;
      this.temperature = null;
      this.visible = true;
      this.cut = true;
      this.highlight = false;
      this.pickable = true;
      this.set(o);
    }
    set(o = {}) {
      for (const [k, v] of Object.entries(o)) if (k !== "parent") this[k] = v;
      return this;
    }
    add(child, o) {
      const node = child instanceof Node ? child.set(o) : new Node(child, o);
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this;
      this.children.push(node);
      return node;
    }
    group(o) { return this.add(null, o); }
    local() { return this.matrix ?? m4.compose(this.position, this.rotation, this.scale, this.pivot); }
    world() { return this.parent ? m4.multiply(this.parent.world(), this.local()) : this.local(); }
    // A point in this node's local coordinates, in world coordinates.
    toWorld(p) { return m4.apply(this.world(), p); }
    find(name) {
      if (this.name === name) return this;
      for (const c of this.children) { const f = c.find(name); if (f) return f; }
      return null;
    }
    traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
    scene() { let n = this; while (n.parent) n = n.parent; return n; }
  }

  class Scene extends Node {
    constructor(o = {}) {
      super(null, {});
      this.cutPlane = null;    // [nx, ny, nz, d]: removes points where n·p > d
      this.shadow = true;      // soft shadows on the ground and between parts
      this.light = "camera";   // "camera" (studio light that follows the view) or a world direction
      this.lighting = "soft";  // "soft" porcelain shading, or "sun" for a hard day/night terminator
      this.look = "studio";    // "studio", "diagram", "night", "outdoor"
      this.ink = 1;            // outline weight multiplier
      this.time = 0;           // seconds, for particles and plumes
      this.set(o);
    }
  }

  // ---------- random numbers shared with the shaders ----------
  // A 32-bit integer hash; the GLSL in the particle shaders is the same function, so a
  // particle's birth place, speed, and life come out the same on the CPU and the GPU.
  const hashU = x => {
    x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x7feb352d) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x846ca68b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };
  const rndU = (i, k, c, seed) => (hashU((Math.imul(i, 0x9E3779B1) ^ hashU((k + Math.imul(c, 0x632BE5AB) + seed) >>> 0)) >>> 0) >>> 8) / 16777216;
  const hash3 = (x, y, z, s) => (hashU((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ s) >>> 0) >>> 8) / 8388608 - 1;
  // Value noise with its gradient, [n, dn/dx, dn/dy, dn/dz] (Quilez); curl noise is built from three of these.
  function noised(x, y, z, s = 0) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
    const q = f => f * f * f * (f * (f * 6 - 15) + 10), dq = f => 30 * f * f * (f * (f - 2) + 1);
    const ux = q(fx), uy = q(fy), uz = q(fz), dx = dq(fx), dy = dq(fy), dz = dq(fz);
    const a = hash3(ix, iy, iz, s), b = hash3(ix + 1, iy, iz, s), c = hash3(ix, iy + 1, iz, s), d = hash3(ix + 1, iy + 1, iz, s);
    const e = hash3(ix, iy, iz + 1, s), f = hash3(ix + 1, iy, iz + 1, s), g = hash3(ix, iy + 1, iz + 1, s), h = hash3(ix + 1, iy + 1, iz + 1, s);
    const k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f, k7 = -a + b + c - d + e - f - g + h;
    return [a + k1 * ux + k2 * uy + k3 * uz + k4 * ux * uy + k5 * uy * uz + k6 * uz * ux + k7 * ux * uy * uz,
      dx * (k1 + k4 * uy + k6 * uz + k7 * uy * uz), dy * (k2 + k5 * uz + k4 * ux + k7 * uz * ux), dz * (k3 + k6 * ux + k5 * uy + k7 * ux * uy)];
  }
  function curl(x, y, z) {
    const a = noised(x, y, z, 0), b = noised(x + 31.4, y + 17.2, z + 5.9, 0), c = noised(x - 11.3, y + 47.1, z + 23.7, 0);
    return [c[2] - b[3], a[3] - c[1], b[1] - a[2]];
  }

  // ---------- potential flow ----------
  // Two-dimensional ideal flow in the xy plane (extruded along z): uniform stream past a
  // cylinder, and past a Joukowski airfoil with the circulation that makes the flow leave
  // the trailing edge smoothly (the Kutta condition). The particle shaders carry the same
  // formulas, so tracers follow exactly these streamlines.
  const cx = {
    mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
    div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1] || 1e-30; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
    sqrt: a => { const r = Math.hypot(a[0], a[1]), t = Math.atan2(a[1], a[0]) / 2, s = Math.sqrt(r); return [s * Math.cos(t), s * Math.sin(t)]; },
  };
  // A tube flow: axisymmetric stream layers between surfaces of revolution, sampled along the
  // axis (local y) at n stations from y0 every dy. Each station row is the five boundary radii
  // [c0, c1, b0, b1, x0]: core layer c0..c1, bypass b0..b1 (walls where c1 < b0 or b1 < x0), and
  // the outside air from x0 out (an optional sixth value scales the core's volume flow, for
  // gas that expands as it's heated). Each inner layer carries a fixed flux (q, as Q / pi); within a
  // layer the stream function is linear in r², so the axial speed is q / (b² - a²) and the
  // streamlines follow both walls exactly. matrix places the flow's frame in the world.
  function tubeSpec(o) {
    const rows = o.rows, n = rows.length, M = o.matrix ? Float32Array.from(o.matrix) : m4.identity();
    const data = new Float32Array(n * 2 * 4);
    rows.forEach((r, i) => { data.set([r[0], r[1], r[2], r[3]], i * 4); data.set([r[4], r[5] ?? 1, 0, 0], (n + i) * 4); });
    return { type: "tube", kind: 3, U: o.U0, U0: o.U0, y0: o.y0, dy: o.dy, n, rows, q: o.q, M, MI: m4.invert(M), data, center: [0, 0, 0], alpha: 0, S: 1, mu: [0, 0], a: 0, gamma: 0, mid: 0 };
  }
  function tubeAt(F, p) {
    const q = m4.apply(F.MI, p), y = q[1], r = Math.hypot(q[0], q[2]);
    const fi = (y - F.y0) / F.dy;
    if (fi < 0 || fi > F.n - 1) return m4.applyDir(F.M, [0, F.U0, 0]);
    const i = Math.min(F.n - 2, Math.floor(fi)), f = fi - i, A = F.rows[i], B = F.rows[i + 1];
    const v = A.map((a, k) => a + (B[k] - a) * f), d = A.map((a, k) => (B[k] - a) / F.dy);
    let a, b, da, db, Q;
    if (r < v[0] - 1e-6) return null;
    if (r <= v[1]) { a = v[0]; b = v[1]; da = d[0]; db = d[1]; Q = F.q[0] * (v[5] ?? 1); }
    else if (r < v[2]) return null;
    else if (r <= v[3]) { a = v[2]; b = v[3]; da = d[2]; db = d[3]; Q = F.q[1]; }
    else if (r < v[4]) return null;
    else { const uy = F.U0, ur = r > 1e-6 ? (uy * v[4] * d[4]) / r : 0; return m4.applyDir(F.M, [r > 1e-6 ? (ur * q[0]) / r : 0, uy, r > 1e-6 ? (ur * q[2]) / r : 0]); }
    const den = Math.max(b * b - a * a, 1e-9), uy = Q / den, eta = (r * r - a * a) / den;
    const ur = r > 1e-6 ? (uy * (a * da * (1 - eta) + b * db * eta)) / r : 0;
    return m4.applyDir(F.M, [r > 1e-6 ? (ur * q[0]) / r : 0, uy, r > 1e-6 ? (ur * q[2]) / r : 0]);
  }
  function flowSpec(o = {}) {
    if (o.kind === 3 || o.type === "tube") return o.kind === 3 ? o : tubeSpec(o);
    const type = o.type ?? (o.chord != null ? "airfoil" : o.radius != null ? "cylinder" : "uniform");
    const U = o.U ?? o.speed ?? 1, center = o.center ?? [0, 0, 0];
    if (type === "cylinder") {
      const R = o.radius ?? 1;
      return { type, kind: 1, U, center, R, gamma: o.circulation ?? 0, alpha: 0, S: 1, mu: [0, 0], a: R, mid: 0 };
    }
    if (type === "airfoil") {
      const eps = (o.thickness ?? 0.12) / 1.299, del = 2 * (o.camber ?? 0.04), alpha = o.alpha ?? 0;
      const mu = [-eps, del], a = Math.hypot(1 + eps, del), beta = Math.atan2(del, 1 + eps);
      const gamma = o.kutta === false ? 0 : 4 * Math.PI * a * U * Math.sin(alpha + beta);
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < 360; i++) {
        const t = (i / 360) * Math.PI * 2, z = [mu[0] + a * Math.cos(t), mu[1] + a * Math.sin(t)];
        const w = [z[0], z[1]], inv = cx.div([1, 0], w);
        const X = w[0] + inv[0];
        x0 = Math.min(x0, X); x1 = Math.max(x1, X);
      }
      const chord = o.chord ?? 1;
      return { type, kind: 2, U, center, mu, a, gamma, alpha, S: chord / (x1 - x0), mid: (x0 + x1) / 2, beta, lift: 2 * Math.PI * Math.sin(alpha + beta) * (o.kutta === false ? 0 : 1), chord };
    }
    return { type: "uniform", kind: 0, U, center, alpha: 0, S: 1, mu: [0, 0], a: 0, gamma: 0, mid: 0 };
  }
  // Velocity at world point p, or null inside the body.
  function flowAt(F, p) {
    if (F.kind === 0) return [F.U, 0, 0];
    if (F.kind === 3) return tubeAt(F, p);
    const ca = Math.cos(F.alpha), sa = Math.sin(F.alpha);
    let x = (p[0] - F.center[0]) / F.S, y = (p[1] - F.center[1]) / F.S;
    let w;
    if (F.kind === 1) {
      const z = [x, y], r2 = x * x + y * y;
      if (r2 < F.R * F.R / (F.S * F.S)) return null;
      const R2 = F.R * F.R;
      const t = cx.div([R2, 0], cx.mul(z, z));
      const circ = cx.div([0, F.gamma / (2 * Math.PI)], z);
      w = [F.U * (1 - t[0]) + circ[0], -F.U * t[1] + circ[1]];
    } else {
      // into the airfoil's own frame: chord along x, free stream at angle alpha
      const xr = x * ca - y * sa, yr = x * sa + y * ca;
      const z = [xr + F.mid, yr];
      const s = cx.sqrt([z[0] * z[0] - z[1] * z[1] - 4, 2 * z[0] * z[1]]);
      const z1 = [(z[0] + s[0]) / 2, (z[1] + s[1]) / 2], z2 = [(z[0] - s[0]) / 2, (z[1] - s[1]) / 2];
      const d1 = Math.hypot(z1[0] - F.mu[0], z1[1] - F.mu[1]), d2 = Math.hypot(z2[0] - F.mu[0], z2[1] - F.mu[1]);
      const zeta = d1 >= d2 ? z1 : z2, dm = Math.max(d1, d2);
      if (dm < F.a * 1.002) return null;
      const zm = [zeta[0] - F.mu[0], zeta[1] - F.mu[1]];
      const e1 = [Math.cos(-F.alpha), Math.sin(-F.alpha)], e2 = [Math.cos(F.alpha), Math.sin(F.alpha)];
      const t = cx.div(cx.mul([F.a * F.a, 0], e2), cx.mul(zm, zm));
      const circ = cx.div([0, F.gamma / (2 * Math.PI)], zm);
      const dWdzeta = [F.U * (e1[0] - t[0]) + circ[0], F.U * (e1[1] - t[1]) + circ[1]];
      const dzdzeta = (() => { const iz = cx.div([1, 0], cx.mul(zeta, zeta)); return [1 - iz[0], -iz[1]]; })();
      const dw = cx.div(dWdzeta, dzdzeta);
      const u = dw[0], v = -dw[1];
      return [u * ca + v * sa, -u * sa + v * ca, 0];
    }
    return [w[0], -w[1], 0];
  }
  const flow = {
    spec: flowSpec,
    // A flow you can sample: { velocity(p), outline(n), lift, spec }.
    cylinder: (o = {}) => flowObject(flowSpec({ ...o, type: "cylinder" })),
    airfoil: (o = {}) => flowObject(flowSpec({ ...o, type: "airfoil" })),
    uniform: (o = {}) => flowObject(flowSpec({ ...o, type: "uniform" })),
    tube: (o = {}) => flowObject(flowSpec({ ...o, type: "tube" })),
  };
  function flowObject(F) {
    return {
      spec: F, lift: F.lift ?? 0, circulation: F.gamma,
      velocity: p => flowAt(F, p),
      // The body's outline in the xy plane, in world units around the flow's center, with
      // the angle of attack applied: ready for E3.mesh.extrude (which extrudes along z).
      outline(n = 96) {
        const pts = [];
        for (let i = 0; i < n; i++) {
          const t = (i / n) * Math.PI * 2;
          if (F.kind === 1) { pts.push([F.R * Math.cos(t), F.R * Math.sin(t)]); continue; }
          if (F.kind !== 2) continue;
          const z = [F.mu[0] + F.a * Math.cos(t), F.mu[1] + F.a * Math.sin(t)], inv = cx.div([1, 0], z);
          const xr = (z[0] + inv[0] - F.mid) * F.S, yr = (z[1] + inv[1]) * F.S;
          const ca = Math.cos(F.alpha), sa = Math.sin(F.alpha);
          pts.push([xr * ca + yr * sa, -xr * sa + yr * ca]);
        }
        // Joukowski points crowd at the trailing edge; drop near-duplicates for clean triangulation.
        return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-4 * (F.chord ?? 1));
      },
    };
  }

  // ---------- particles ----------
  // A particle system lives in the scene like any node. Each of `count` slots is reborn
  // every `life[1]` seconds at a fixed phase (golden-ratio spacing, so any prefix of the
  // slots is spread evenly in time); where and how fast it's born comes from the hash of
  // (seed, slot, generation). The state is stepped in fixed steps on a global time grid,
  // so the picture at time t depends only on the seed and t: the page checker and
  // screenshots see the same smoke every time. Set `time` (or scene.time) from the figure's state.
  // What the particles are made of sets how they move, from SI numbers scaled by `units` (world
  // units per meter: "m", "cm", "mm", or a number). Things that fall get gravity and the drag that
  // brings them to their terminal speed in still air (vt, m/s); bubbles do the same upward (rise).
  // Hot gas gets Archimedes' lift on a parcel at its birth temperature in air at 293 K,
  // g (T - Ta) / T, fading as it mixes and cools, against an entrainment drag (1/s). Eddies are
  // the air's own swirl [speed m/s, size m, change rate], so a stiff tracer like dust rides them.
  const UNITS = { m: 1, cm: 100, mm: 1000, km: 0.001 };
  const MATTER = {
    smoke: { gas: true, style: "smoke", temperature: [600, 300], drag: 1.6, eddy: [0.9, 0.8, 0.35], life: [5, 9], size: [0.3, 2.4], opacity: 0.3, bounce: 0, friction: 0.05 },
    exhaust: { gas: true, style: "smoke", temperature: [1100, 320], drag: 0.9, eddy: [2.2, 3, 0.25], life: [6, 12], size: [1, 8], opacity: 0.26, bounce: 0, friction: 0.05 },
    steam: { gas: true, style: "smoke", temperature: [373, 295], drag: 2.5, eddy: [0.4, 0.3, 0.5], life: [1.5, 3.5], size: [0.04, 0.5], opacity: 0.35, color: "#f3f5f7", fade: [0.12, 0.65], bounce: 0, friction: 0.05 },
    fire: { gas: true, style: "fire", temperature: [1300, 700], drag: 3.5, eddy: [1, 0.15, 1.4], life: [0.4, 0.9], size: [0.08, 0.3], intensity: 0.55, bounce: 0, friction: 0.05 },
    dust: { vt: 0.3, style: "smoke", eddy: [0.6, 0.6, 0.3], life: [3, 7], size: [0.08, 1], opacity: 0.22, color: "#a8916f", bounce: 0, friction: 1 },
    mist: { vt: 0.25, style: "smoke", eddy: [0.4, 0.5, 0.4], life: [1.5, 3], size: [0.05, 0.4], opacity: 0.18, color: "#eef4f8", fade: [0.1, 0.6], bounce: 0, friction: 1 },
    sand: { vt: 2.5, style: "dot", eddy: [0.2, 0.3, 0.3], life: [1.2, 2.5], size: [0.006, 0.006], color: "#c4a26a", bounce: 0.15, friction: 0.85 },
    water: { vt: 5.5, style: "streak", eddy: [0.05, 0.3, 0.3], life: [0.8, 2], size: [0.012, 0.012], color: "#d4e9f7", bounce: 0.1, friction: 0.6 },
    rain: { vt: 8.5, style: "streak", life: [1.5, 3], size: [0.006, 0.006], color: "#bcd3e6", bounce: 0.02, friction: 0.95 },
    snow: { vt: 1, style: "dot", eddy: [0.8, 0.6, 0.5], life: [4, 8], size: [0.012, 0.012], color: "#ffffff", bounce: 0, friction: 1 },
    spark: { vt: 7, style: "spark", temperature: [2100, 900], life: [0.5, 1.4], size: [0.01, 0.006], bounce: 0.35, friction: 0.25 },
    ember: { vt: 1.5, lift: 1.8, style: "spark", temperature: [1250, 750], eddy: [0.5, 0.3, 0.6], life: [1.5, 3.5], size: [0.012, 0.008], bounce: 0.2, friction: 0.6 },
    bubble: { rise: 0.25, style: "sphere", eddy: [0.06, 0.02, 1], life: [2, 5], size: [0.004, 0.005], color: "#dff1fb", bounce: 0, friction: 0 },
    air: { drag: 20, style: "streak", eddy: [0.3, 1, 0.3], life: [1, 2], size: [0.004, 0.004], color: "#9fc3dd", bounce: 0.5, friction: 0 },
  };
  function matterPreset(o) {
    const P = MATTER[o.matter];
    if (!P) throw new Error("E3.particles: unknown matter " + JSON.stringify(o.matter) + "; one of " + Object.keys(MATTER).join(", "));
    const u = typeof o.units === "number" ? o.units : UNITS[o.units ?? "m"] ?? 1, G = 9.81;
    const forces = {}, opts = { style: P.style, life: P.life, size: P.size.map(s => s * u) };
    for (const k of ["temperature", "color", "opacity", "fade", "intensity"]) if (P[k] != null) opts[k] = P[k];
    if (P.vt != null) { forces.gravity = -G * u; forces.drag = G / P.vt; }
    else if (P.rise != null) { forces.gravity = G * u; forces.drag = G / P.rise; }
    else forces.drag = P.drag ?? 0;
    const T = o.temperature ?? P.temperature, T0 = Array.isArray(T) ? T[0] : T;
    if (P.gas && T0) forces.buoyancy = G * u * Math.max(0, (T0 - (o.ambient ?? 293)) / T0);
    if (P.lift) forces.buoyancy = G * u * P.lift;
    if (P.eddy) forces.turbulence = { strength: P.eddy[0] * u * Math.max(1, forces.drag), scale: P.eddy[1] * u, speed: P.eddy[2] };
    return { opts, forces, bounce: P.bounce ?? 0.2, friction: P.friction ?? 0.5 };
  }
  const PDEF = {
    count: 2000, seed: 1, life: [2, 4], step: 1 / 30, prewarm: true, style: "smoke",
    size: [0.2, 0.8], opacity: 0.6, fade: [0.12, 0.4], trail: 0.12, width: 0, intensity: 1, density: 1,
    temperature: [1900, 900], color: null, colorBy: null, range: [0, 1], soft: null, measure: false, glow: 0, segments: null, volume: null,
  };
  const STYLE_ID = { smoke: 0, fire: 1, spark: 2, streak: 3, sphere: 4, dot: 5 };
  class Particles extends Node {
    constructor(o = {}) {
      super(null, {});
      this.isParticles = true;
      this.pickable = false;
      this.cut = false;
      this.time = null;
      const M = o.matter ? matterPreset(o) : null;
      Object.assign(this, PDEF, M && M.opts, o);
      this.emitter = { shape: "point", ...(o.emitter || {}) };
      this.forces = M ? { ...M.forces, ...(o.forces || {}) } : o.forces || {};
      this.colliders = o.colliders || [];
      // A collider without its own bounce and friction takes the matter's: water splashes a
      // little and runs, dust and snow stay where they land, sparks skip.
      if (M) for (const c of this.colliders) { if (c.bounce == null) c.bounce = M.bounce; if (c.friction == null) c.friction = M.friction; }
      if (o.ground != null) this.colliders.push({ plane: [0, 1, 0, o.ground], bounce: M ? M.bounce : 0.2, friction: M ? M.friction : 0.5 });
      this._state = null;
      this._n = null;
      this.hits = [];
    }
    get lifeRange() { const L = this.life; return typeof L === "number" ? [L, L] : L; }
    get period() { const P = this.lifeRange[1]; return Number.isFinite(P) ? P : 0; }
    // Slot i's generation k and age at time t.
    slot(i, t) {
      const P = this.period;
      if (!P) return [0, t];
      const ph = ((i * 0.6180339887) % 1) * P, k = Math.floor((t - ph) / P);
      return [k, t - (ph + k * P)];
    }
    lifeOf(i, k) { const [a, b] = this.lifeRange; return Number.isFinite(b) ? a + (b - a) * rndU(i, k, 1, this.seed) : Infinity; }
    simTime(t) { return (t ?? 0) + (this.prewarm && this.period ? this.period : 0); }
    // Where slot i is born in generation k: position and velocity in world space.
    emit(i, k, M) {
      const E = this.emitter, s = this.seed, r = c => rndU(i, k, c, s);
      const dir = v3.norm(E.direction || [0, 1, 0]);
      const tmp = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = v3.norm(v3.cross(dir, tmp)), w = v3.cross(dir, u);
      const R = E.radius ?? 0.5, pos0 = E.position || [0, 0, 0];
      const lanes = E.rake | 0, lane = x => (lanes > 0 ? (Math.floor(x * lanes) + 0.5) / lanes : x);
      let p = [0, 0, 0], n = dir, radial = null;
      const shape = E.shape;
      if (shape === "disk" || shape === "cone" || shape === "ring") {
        const a = 2 * Math.PI * r(10), rr = shape === "ring" ? R + (E.thickness ?? 0) * (r(11) - 0.5) : R * Math.sqrt(r(11));
        radial = v3.add(v3.scale(u, Math.cos(a)), v3.scale(w, Math.sin(a)));
        p = v3.scale(radial, rr);
        if (shape === "cone") n = v3.norm(v3.add(dir, v3.scale(radial, Math.tan(E.angle ?? 0.4) * (R > 0 ? rr / R : 1))));
        if (shape === "ring" && E.along === "radial") n = radial;
      } else if (shape === "sphere") {
        const z = 2 * r(10) - 1, a = 2 * Math.PI * r(11), q = Math.sqrt(1 - z * z);
        n = [q * Math.cos(a), z, q * Math.sin(a)];
        p = v3.scale(n, E.surface ? R : R * Math.cbrt(r(12)));
      } else if (shape === "box") {
        const sz = E.size || [1, 1, 1];
        p = [(r(10) - 0.5) * sz[0], (lane(r(11)) - 0.5) * sz[1], (r(12) - 0.5) * sz[2]];
      } else if (shape === "line") {
        const a = E.from || [-0.5, 0, 0], b = E.to || [0.5, 0, 0];
        p = v3.sub(v3.lerp(a, b, lane(r(10))), pos0);
      } else if (shape === "mesh" && this._samples) {
        const S = this._samples, j = Math.min(S.length / 6 - 1, Math.floor(r(10) * S.length / 6));
        p = [S[j * 6], S[j * 6 + 1], S[j * 6 + 2]].map((v, q) => v - pos0[q]);
        n = [S[j * 6 + 3], S[j * 6 + 4], S[j * 6 + 5]];
      }
      p = v3.add(p, pos0);
      let d = E.along === "normal" ? n : shape === "cone" ? n : dir;
      const spread = E.spread ?? 0;
      if (spread > 0) {
        const ct = 1 - r(13) * (1 - Math.cos(spread)), st = Math.sqrt(Math.max(0, 1 - ct * ct)), a = 2 * Math.PI * r(14);
        const du = v3.norm(v3.cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), dw = v3.cross(d, du);
        d = v3.add(v3.scale(d, ct), v3.add(v3.scale(du, st * Math.cos(a)), v3.scale(dw, st * Math.sin(a))));
      }
      const sp = E.speed ?? 1, speed = Array.isArray(sp) ? sp[0] + (sp[1] - sp[0]) * r(15) : sp;
      let vel = v3.scale(d, speed);
      if (E.thermal) {
        const g = c => Math.sqrt(-2 * Math.log(Math.max(1e-7, r(c)))) * Math.cos(2 * Math.PI * r(c + 1));
        vel = v3.add(vel, v3.scale([g(16), g(18), g(20)], E.thermal));
      }
      const pw = m4.apply(M, p);
      const vw = m4.applyDir(M, vel);
      return [pw, vw];
    }
    // Area-weighted surface samples for the mesh emitter (local coordinates), made once.
    prepare() {
      const E = this.emitter;
      if (E.shape !== "mesh" || !E.mesh || this._samples) return;
      const m = E.mesh, P = m.positions, I = m.indices, nT = I.length / 3, area = new Float64Array(nT);
      let total = 0;
      for (let t = 0; t < nT; t++) {
        const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        total += v3.len(v3.cross(e1, e2)) / 2;
        area[t] = total;
      }
      const N = 1024, S = new Float32Array(N * 6);
      for (let j = 0; j < N; j++) {
        const x = ((j + rndU(j, 0, 3, this.seed)) / N) * total;
        let lo = 0, hi = nT - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (area[mid] < x) lo = mid + 1; else hi = mid; }
        const a = I[lo * 3] * 3, b = I[lo * 3 + 1] * 3, c = I[lo * 3 + 2] * 3;
        let s = rndU(j, 0, 4, this.seed), t = rndU(j, 0, 5, this.seed);
        if (s + t > 1) { s = 1 - s; t = 1 - t; }
        for (let q = 0; q < 3; q++) S[j * 6 + q] = P[a + q] + (P[b + q] - P[a + q]) * s + (P[c + q] - P[a + q]) * t;
        const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
        const nn = v3.norm(v3.cross(e1, e2));
        S.set(nn, j * 6 + 3);
      }
      this._samples = S;
    }
    // Packed force and collider parameters, shared by the CPU and GPU integrators.
    params() {
      const f = this.forces;
      const g = f.gravity == null ? [0, 0, 0] : typeof f.gravity === "number" ? [0, f.gravity, 0] : f.gravity;
      const tb = f.turbulence == null ? null : typeof f.turbulence === "number" ? { strength: f.turbulence } : f.turbulence;
      const vx = f.vortex || null;
      const planes = [], spheres = [];
      this.colliders.forEach((c, idx) => {
        if (c.plane) { const n = v3.norm(c.plane.slice(0, 3)), L = v3.len(c.plane.slice(0, 3)) || 1; planes.push({ n, d: c.plane[3] / L, e: c.bounce ?? 0.3, fr: c.friction ?? 0, u: c.velocity ?? 0, idx }); }
        else if (c.sphere) spheres.push({ c: c.sphere.slice(0, 3), r: c.sphere[3], inside: c.inside ? -1 : 1, e: c.bounce ?? 0.3, fr: c.friction ?? 0, idx });
      });
      return {
        g, drag: f.drag ?? 0, wind: f.wind || [0, 0, 0],
        turb: tb ? [tb.strength ?? 1, 1 / (tb.scale ?? 1), tb.speed ?? 0.3] : [0, 1, 0],
        vortex: vx ? { c: vx.center || [0, 0, 0], a: v3.norm(vx.axis || [0, 1, 0]), s: vx.strength ?? 1, core: vx.core ?? 0.2, pull: vx.pull ?? 0 } : null,
        attractors: (f.attractors || []).slice(0, 4).map(a => ({ p: a.position, s: a.strength ?? 1, r: a.radius ?? 0.1 })),
        planes: planes.slice(0, 8), spheres: spheres.slice(0, 4),
        flow: this.flow ? flowSpec(this.flow) : null,
        kill: this.kill || null,
        buoyancy: f.buoyancy ?? 0,
      };
    }
    // The CPU integrator: the same steps as the transform-feedback shader. Used when there's
    // no WebGL (tests in Node), for small exact systems (`cpu: true`), and for `measure`.
    cpuStep(state, n, t, h, M, F) {
      const P = this.period;
      const hits = this._hitAcc;
      for (let i = 0; i < n; i++) {
        const o = i * 8;
        const [k, age] = this.slot(i, t);
        const life = this.lifeOf(i, k);
        let px = state[o], py = state[o + 1], pz = state[o + 2], vx = state[o + 4], vy = state[o + 5], vz = state[o + 6];
        let dtl = h;
        if (Math.floor(state[o + 3]) !== k) {
          if (age > h + 1e-9 && P) { state[o + 3] = k + 0.5; continue; } // born before this run began; it dies unseen
          const [pw, vw] = this.emit(i, k, M);
          [px, py, pz] = pw; [vx, vy, vz] = vw;
          state[o + 3] = k;
          dtl = Math.max(0, Math.min(age, h));
        }
        if (state[o + 3] !== k || age > life) continue;
        if (F.flow) {
          const v1 = flowAt(F.flow, [px, py, pz]);
          if (!v1) { state[o + 3] = k + 0.5; continue; }
          const v2 = flowAt(F.flow, [px + v1[0] * dtl * 0.5, py + v1[1] * dtl * 0.5, pz]) || v1;
          vx = v2[0]; vy = v2[1]; vz = v2[2];
          if (F.turb[0]) { const c = curl(px * F.turb[1], py * F.turb[1], pz * F.turb[1] + t * F.turb[2]); vx += c[0] * F.turb[0]; vy += c[1] * F.turb[0]; vz += c[2] * F.turb[0]; }
          px += vx * dtl; py += vy * dtl; pz += vz * dtl;
        } else {
          let ax = F.g[0], ay = F.g[1] + F.buoyancy * Math.max(0, 1 - age / life), az = F.g[2];
          if (F.turb[0]) { const c = curl(px * F.turb[1], py * F.turb[1], pz * F.turb[1] + t * F.turb[2]); ax += c[0] * F.turb[0]; ay += c[1] * F.turb[0]; az += c[2] * F.turb[0]; }
          if (F.vortex) {
            const V = F.vortex, r = [px - V.c[0], py - V.c[1], pz - V.c[2]], ra = v3.dot(r, V.a), rp = v3.sub(r, v3.scale(V.a, ra));
            const tng = v3.cross(V.a, rp), q = 1 / (v3.dot(rp, rp) + V.core * V.core);
            ax += V.s * tng[0] * q - V.pull * rp[0]; ay += V.s * tng[1] * q - V.pull * rp[1]; az += V.s * tng[2] * q - V.pull * rp[2];
          }
          for (const A of F.attractors) {
            const d = [A.p[0] - px, A.p[1] - py, A.p[2] - pz], q = A.s / Math.pow(v3.dot(d, d) + A.r * A.r, 1.5);
            ax += d[0] * q; ay += d[1] * q; az += d[2] * q;
          }
          const k = F.drag;
          if (k > 0) {
            // Drag solved exactly over the step, so stiff drag (dust, bubbles) stays stable: the
            // velocity relaxes at rate k toward the wind plus the other forces over k.
            const e = Math.exp(-k * dtl), f = (1 - e) / k;
            const tx = F.wind[0] + ax / k, ty = F.wind[1] + ay / k, tz = F.wind[2] + az / k;
            px += tx * dtl + (vx - tx) * f; py += ty * dtl + (vy - ty) * f; pz += tz * dtl + (vz - tz) * f;
            vx = tx + (vx - tx) * e; vy = ty + (vy - ty) * e; vz = tz + (vz - tz) * e;
          } else {
            vx += ax * dtl; vy += ay * dtl; vz += az * dtl;
            px += vx * dtl; py += vy * dtl; pz += vz * dtl;
          }
        }
        for (const C of F.planes) {
          const s = C.n[0] * px + C.n[1] * py + C.n[2] * pz - C.d;
          if (s >= 0) continue;
          px -= C.n[0] * s; py -= C.n[1] * s; pz -= C.n[2] * s;
          const vn = C.n[0] * vx + C.n[1] * vy + C.n[2] * vz - C.u;
          if (vn < 0) {
            const j = -(1 + C.e) * vn;
            vx += C.n[0] * j; vy += C.n[1] * j; vz += C.n[2] * j;
            if (C.fr) { const vn2 = C.n[0] * vx + C.n[1] * vy + C.n[2] * vz; vx -= (vx - C.n[0] * vn2) * C.fr; vy -= (vy - C.n[1] * vn2) * C.fr; vz -= (vz - C.n[2] * vn2) * C.fr; }
            if (hits) hits[C.idx] += j;
          }
        }
        for (const C of F.spheres) {
          const d = [px - C.c[0], py - C.c[1], pz - C.c[2]], L = v3.len(d) || 1e-9, s = (L - C.r) * C.inside;
          if (s >= 0) continue;
          const nn = v3.scale(d, C.inside / L);
          px -= nn[0] * s; py -= nn[1] * s; pz -= nn[2] * s;
          const vn = v3.dot(nn, [vx, vy, vz]);
          if (vn < 0) { const j = -(1 + C.e) * vn; vx += nn[0] * j; vy += nn[1] * j; vz += nn[2] * j; if (hits) hits[C.idx] += j; }
        }
        if (F.kill && (px < F.kill.min[0] || py < F.kill.min[1] || pz < F.kill.min[2] || px > F.kill.max[0] || py > F.kill.max[1] || pz > F.kill.max[2])) state[o + 3] = k + 0.5;
        state[o] = px; state[o + 1] = py; state[o + 2] = pz; state[o + 4] = vx; state[o + 5] = vy; state[o + 6] = vz;
      }
    }
    // Brings the state to time t (seconds). Returns true if anything was simulated.
    // stepFn(tEnd) runs one step on whatever integrator holds the state; reset() starts over.
    advanceWith(t, n, reset, stepFn) {
      // At least one step, so a system at time 0 (a paused figure, reduced motion) has been born.
      const h = this.step, te = this.simTime(t), target = Math.max(1, Math.floor(te / h + 1e-6)), P = this.period;
      const need = P ? Math.ceil(P / h) + 2 : 4000;
      if (this._n == null || target < this._n || target - this._n > need || this._count !== n) {
        this._n = P ? target - need : Math.max(0, target - need);
        this._count = n;
        reset();
      }
      while (this._n < target) { this._n++; stepFn(this._n * h); }
      this._t = this._n * h;
      return true;
    }
    // CPU simulation to time t; returns the state (8 floats per particle: x, y, z, generation, vx, vy, vz, 0).
    simulate(t = this.time ?? 0, n = this.count) {
      this.prepare();
      const M = this.world(), F = this.params(), h = this.step;
      if (!this._state || this._state.length !== this.count * 8) this._state = new Float32Array(this.count * 8);
      const S = this._state;
      const window_ = this.measureWindow ?? 0.5;
      this.advanceWith(t, n, () => { for (let i = 0; i < this.count; i++) S[i * 8 + 3] = -1e6; this._hitLog = []; }, tEnd => {
        this._hitAcc = this.measure ? new Float64Array(this.colliders.length) : null;
        this.cpuStep(S, n, tEnd, h, M, F);
        if (this._hitAcc) { this._hitLog.push(this._hitAcc); if (this._hitLog.length > Math.max(1, Math.round(window_ / h))) this._hitLog.shift(); }
      });
      if (this.measure && this._hitLog) {
        // Momentum delivered to each collider per second, averaged over the last `measureWindow` seconds.
        const L = this._hitLog, out = new Array(this.colliders.length).fill(0);
        for (const a of L) a.forEach((v, j) => (out[j] += v));
        this.hits = out.map(v => v / Math.max(1, L.length) / h);
      }
      return S;
    }
    // Live particles at the current state: [{ position, velocity, age, life }].
    alive() {
      const S = this._state, out = [];
      if (!S) return out;
      const tt = this._t ?? 0;
      for (let i = 0; i < this._count; i++) {
        const [k, age] = this.slot(i, tt), life = this.lifeOf(i, k);
        if (S[i * 8 + 3] !== k || age > life) continue;
        out.push({ position: [S[i * 8], S[i * 8 + 1], S[i * 8 + 2]], velocity: [S[i * 8 + 4], S[i * 8 + 5], S[i * 8 + 6]], age, life });
      }
      return out;
    }
  }

  // ---------- plume ----------
  // A rocket exhaust drawn as a ray-marched volume: hot core, Mach diamonds, turbulent
  // mixing layer, all emitting by temperature. Its local frame has the nozzle exit at the
  // origin and the flow running down -y. It also lights the scene around it.
  const FUELS = { kerosene: 0, rp1: 0, methane: 1, hydrogen: 2, solid: 3 };
  class Plume extends Node {
    constructor(o = {}) {
      super(null, {});
      this.isPlume = true;
      this.pickable = false;
      this.cut = false;
      this.time = null;
      Object.assign(this, { radius: 1, length: 8, throttle: 1, temperature: 2500, fuel: "kerosene", cells: 1.5, spread: 0.05, turbulence: 1, intensity: 1, light: 1, speed: 1, expansion: 0.8, impact: null, splash: 1, ground: 0, profile: null }, o);
      if (this.profile && o.cut == null) this.cut = true;
    }
    get lengthNow() { return this.profile ? this.profile[this.profile.length - 1][1] : this.length * (0.45 + 0.55 * clamp01(this.throttle)); }
    // Distance along the jet (local units) to the surface it hits: a number, or with
    // impact: true the plane y = ground in world space; 0 when it hits nothing.
    impactNow() {
      if (this.profile || !this.impact) return 0;
      if (typeof this.impact === "number") return this.impact;
      const W = this.world(), o = m4.apply(W, [0, 0, 0]), d = m4.applyDir(W, [0, -1, 0]), ws = Math.hypot(W[0], W[1], W[2]) || 1;
      const dn = v3.norm(d);
      if (dn[1] > -0.05) return 0;
      const dist = (o[1] - this.ground) / -dn[1] / ws;
      return dist > 0 && dist < this.lengthNow * 1.6 ? dist : 0;
    }
    get splashRadius() { return this.radius * 4.5 * this.splash * (0.6 + 0.4 * clamp01(this.throttle)); }
    // Exit pressure over ambient at the current throttle: a throttled engine runs over-expanded.
    get expansionNow() { return this.expansion * (0.35 + 0.65 * clamp01(this.throttle)); }
    // Point lights in world space that stand in for the plume's glow on nearby surfaces:
    // a strong one just below the exit (it lights the nozzle and the stand) and a softer
    // one down the plume for the ground and the smoke.
    glowLights() {
      if (!this.light || this.throttle <= 0 || this.profile) return [];
      const thr = clamp01(this.throttle), T = this.temperature * (0.7 + 0.3 * thr);
      const sc = this.world(), s = Math.hypot(sc[0], sc[1], sc[2]);
      const L = this.lengthNow, k = this.light * thr, imp = this.impactNow();
      const col = blackbody(T * 0.75);
      // With an impact, the second light sits in the splash and lights the pad and the cloud from below.
      return [
        { position: this.toWorld([0, -L * 0.12, 0]), color: col.map(v => v * k * 5), range: L * s * 0.6 },
        imp ? { position: this.toWorld([0, -imp * 0.96, 0]), color: blackbody(1900).map(v => v * k * 4), range: this.splashRadius * s * 1.6 }
            : { position: this.toWorld([0, -L * 0.6, 0]), color: col.map(v => v * k * 2.5), range: L * s * 1.1 },
      ];
    }
    glowLight() { return this.glowLights()[0] || null; }
  }

  // ---------- shaders ----------
  const G_COMMON = `
precision highp float;
precision highp int;
const float PI = 3.141592653589793;
vec3 toLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
// Khronos PBR Neutral: base colors stay true up to about 0.8, highlights roll off to white.
vec3 tonemap(vec3 c) {
  float x = min(c.r, min(c.g, c.b));
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= off;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < 0.76) return c;
  float np = 1.0 - 0.0576 / (peak - 0.52);
  c *= np / peak;
  float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);
  return mix(c, vec3(np), g);
}
vec3 blackbody(float T) {
  float t = clamp(T, 500.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 255.0 : 329.698727446 * pow(t - 60.0, -0.1332047592);
  float g = t <= 66.0 ? 99.4708025861 * log(t) - 161.1195681661 : 288.1221695283 * pow(t - 60.0, -0.0755148492);
  float b = t >= 66.0 ? 255.0 : (t <= 19.0 ? 0.0 : 138.5177312231 * log(t - 10.0) - 305.0447927307);
  return toLin(clamp(vec3(r, g, b) / 255.0, 0.0, 1.0));
}
float glowOf(float T) { float k = max(T - 720.0, 0.0) / 700.0; return k * k * k * 2.5; }
uint hashu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hash3(ivec3 p, uint s) { return float(hashu(uint(p.x) * 73856093u ^ uint(p.y) * 19349663u ^ uint(p.z) * 83492791u ^ s) >> 8) / 8388608.0 - 1.0; }
vec4 noised(vec3 x, uint s) {
  vec3 i = floor(x), f = x - i;
  ivec3 p = ivec3(i);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash3(p, s), b = hash3(p + ivec3(1, 0, 0), s), c = hash3(p + ivec3(0, 1, 0), s), d = hash3(p + ivec3(1, 1, 0), s);
  float e = hash3(p + ivec3(0, 0, 1), s), g = hash3(p + ivec3(1, 0, 1), s), h = hash3(p + ivec3(0, 1, 1), s), k = hash3(p + ivec3(1, 1, 1), s);
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + h, k6 = a - b - e + g, k7 = -a + b + c - d + e - g - h + k;
  return vec4(a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z,
    du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y));
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = x - i;
  ivec3 p = ivec3(i);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(p, 7u), hash3(p + ivec3(1, 0, 0), 7u), u.x), mix(hash3(p + ivec3(0, 1, 0), 7u), hash3(p + ivec3(1, 1, 0), 7u), u.x), u.y),
             mix(mix(hash3(p + ivec3(0, 0, 1), 7u), hash3(p + ivec3(1, 0, 1), 7u), u.x), mix(hash3(p + ivec3(0, 1, 1), 7u), hash3(p + ivec3(1, 1, 1), 7u), u.x), u.y), u.z);
}
float vnoise1(float x) { float i = floor(x), f = x - i; return mix(hash3(ivec3(int(i), 0, 0), 3u), hash3(ivec3(int(i) + 1, 0, 0), 3u), f * f * (3.0 - 2.0 * f)); }
vec3 curl(vec3 p) {
  vec4 a = noised(p, 0u), b = noised(p + vec3(31.4, 17.2, 5.9), 0u), c = noised(p + vec3(-11.3, 47.1, 23.7), 0u);
  return vec3(c.z - b.w, a.w - c.y, b.y - a.z);
}
// Linear view distance from a depth-buffer value.
uniform vec2 uNearFar; uniform float uOrtho;
float linDepth(float d) {
  if (uOrtho > 0.5) return uNearFar.x + d * (uNearFar.y - uNearFar.x);
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}`;

  // Studio environment lookups: a prefiltered radiance map (mip level = roughness) and an
  // irradiance map, both lat-long, turned with the camera so the soft boxes stay put.
  const G_ENV = `
uniform sampler2D uEnvSpec; uniform sampler2D uEnvIrr; uniform mat3 uEnvRot; uniform vec2 uEnvInfo;
vec2 envUv(vec3 d) { d = uEnvRot * d; return vec2(atan(d.x, -d.z) * (0.5 / PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI); }
vec3 envSpec(vec3 r, float rough) { return textureLod(uEnvSpec, envUv(r), rough * uEnvInfo.y).rgb * uEnvInfo.x; }
vec3 envDiff(vec3 n) { return textureLod(uEnvIrr, envUv(n), 0.0).rgb * uEnvInfo.x; }`;

  // Soft shadows from the key light: a blocker search sets the penumbra (contact-hardening),
  // then 16 rotated Poisson taps of hardware 2x2 PCF. Glass casts a lighter shadow of its own.
  const G_SHADOW = `
uniform highp sampler2DShadow uShadowCmp; uniform highp sampler2D uShadowRaw; uniform highp sampler2DShadow uShadowGlass;
uniform mat4 uShadowVP; uniform vec4 uShadowA; uniform vec4 uShadowB;
const vec2 DISK[16] = vec2[16](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.094184101, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790));
float shadowAt(vec3 wp, vec3 n) {
  if (uShadowA.x < 0.5) return 1.0;
  vec4 sp = uShadowVP * vec4(wp + n * uShadowA.z, 1.0);
  vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.y <= 0.0 || p.x >= 1.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float ca = cos(ang), sa = sin(ang);
  mat2 rot = mat2(ca, sa, -sa, ca);
  float z = p.z - uShadowA.y;
  float blk = 0.0, cnt = 0.0;
  float d0 = texture(uShadowRaw, p.xy).r;
  if (d0 < z) { blk += d0; cnt += 1.0; }
  for (int i = 0; i < 16; i += 2) {
    float d = texture(uShadowRaw, p.xy + rot * DISK[i] * uShadowB.y).r;
    if (d < z) { blk += d; cnt += 1.0; }
  }
  float vis = 1.0;
  if (cnt > 0.0) {
    float r = clamp((z - blk / cnt) * uShadowB.z, uShadowB.x, uShadowB.y);
    float s = 0.0;
    for (int i = 0; i < 16; i++) s += texture(uShadowCmp, vec3(p.xy + rot * DISK[i] * r, z));
    vis = s / 16.0;
  }
  if (uShadowA.w > 0.0) {
    float g = 0.0;
    for (int i = 0; i < 8; i++) g += texture(uShadowGlass, vec3(p.xy + rot * DISK[i * 2 + 1] * uShadowB.x * 3.0, z));
    vis *= 1.0 - uShadowA.w * (1.0 - g / 8.0);
  }
  return vis;
}`;

  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel, uViewProj;
uniform mat3 uNormalMat;
out vec3 vWorld; out vec3 vNormal; out vec3 vLocal; out vec3 vLocalN;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = uNormalMat * aNormal;
  vLocal = aPos;
  vLocalN = aNormal;
  gl_Position = uViewProj * w;
}`;

  // Depth only, for the shadow maps; it honors the section cut so cut-away parts cast nothing.
  const FS_DEPTH = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec4 uCut; uniform float uCutOn;
out vec4 o;
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  o = vec4(1.0);
}`;

  // Surface shading. Model 0 is the original porcelain look (wrap light, cool shade side,
  // a faint sheen), now with cast shadows; model 1 is physically based (GGX, Fresnel,
  // metalness, roughness, anisotropy for brushed metal, clear coat, temper colors and
  // black-body glow), lit by key, fill and rim lights, point lights, and the environment.
  // PBR color is tone mapped here, so diagram materials stay exactly as they were; glow
  // above 1.0 is what the bloom pass picks up.
  const G_SURFACE = `
uniform mat4 uModel;
uniform vec3 uColor; uniform vec3 uLight; uniform vec3 uEye;
uniform float uSun;
uniform vec4 uMat; uniform vec3 uF0; uniform vec4 uBrush; uniform vec4 uDetail; uniform vec3 uEmit;
uniform vec4 uTissue; uniform vec3 uSssCol; // tissue: scattering, sheen, fibers on, _; scattered light color
uniform vec4 uTempAxis; uniform vec4 uTempS; uniform vec4 uTempT; uniform vec4 uHeat;
uniform vec3 uKeyCol; uniform vec3 uFillDir; uniform vec3 uFillCol; uniform vec3 uRimDir; uniform vec3 uRimCol;
uniform vec4 uPtPos[2]; uniform vec3 uPtCol[2];
uniform vec4 uLook;
float D_GGX(float NoH, float a) { float a2 = a * a; float f = (NoH * a2 - NoH) * NoH + 1.0; return a2 / (PI * f * f + 1e-7); }
float V_GGX(float NoV, float NoL, float a) { float a2 = a * a; float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / (gv + gl + 1e-7); }
float D_Aniso(float at, float ab, float XoH, float YoH, float NoH) { float a2 = at * ab; vec3 d = vec3(ab * XoH, at * YoH, a2 * NoH); float d2 = dot(d, d); float b2 = a2 / d2; return a2 * b2 * b2 / PI; }
float V_Aniso(float at, float ab, float XoV, float YoV, float XoL, float YoL, float NoV, float NoL) {
  float lv = NoL * length(vec3(at * XoV, ab * YoV, NoV)); float ll = NoV * length(vec3(at * XoL, ab * YoL, NoL)); return 0.5 / (lv + ll + 1e-7);
}
vec2 envBRDF(float NoV, float r) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022); const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 rr = r * c0 + c1; float a004 = min(rr.x * rr.x, exp2(-9.28 * NoV)) * rr.x + rr.y;
  return vec2(-1.04, 1.04) * a004 + rr.zw;
}
vec4 heatTint(float T) {
  float c = T - 273.15;
  vec3 col = mix(vec3(0.93, 0.86, 0.62), vec3(0.85, 0.66, 0.32), smoothstep(190.0, 240.0, c));
  col = mix(col, vec3(0.62, 0.38, 0.2), smoothstep(240.0, 260.0, c));
  col = mix(col, vec3(0.45, 0.22, 0.42), smoothstep(260.0, 278.0, c));
  col = mix(col, vec3(0.15, 0.2, 0.55), smoothstep(278.0, 295.0, c));
  col = mix(col, vec3(0.3, 0.5, 0.78), smoothstep(295.0, 320.0, c));
  col = mix(col, vec3(0.52, 0.55, 0.58), smoothstep(320.0, 380.0, c));
  col = mix(col, vec3(0.36, 0.35, 0.34), smoothstep(380.0, 600.0, c));
  return vec4(col, smoothstep(180.0, 230.0, c));
}
float temperatureAt(vec3 lp) {
  int n = int(uTempAxis.w + 0.5);
  float s = dot(lp, uTempAxis.xyz), T = uTempT.x;
  if (n > 1) T = mix(uTempT.x, uTempT.y, smoothstep(uTempS.x, uTempS.y, s));
  if (n > 2 && s > uTempS.y) T = mix(uTempT.y, uTempT.z, smoothstep(uTempS.y, uTempS.z, s));
  if (n > 3 && s > uTempS.z) T = mix(uTempT.z, uTempT.w, smoothstep(uTempS.z, uTempS.w, s));
  return T;
}
vec3 lightPBR(vec3 N, vec3 V, vec3 L, vec3 Lc, vec3 diff, vec3 f0, float a, vec3 X, vec3 Y, float aniso) {
  float NoL = dot(N, L);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 H = normalize(V + L);
  float NoV = max(dot(N, V), 1e-4), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
  float DV;
  if (aniso > 0.0) {
    float at = max(a * (1.0 + aniso), 0.003), ab = max(a * (1.0 - aniso), 0.003);
    DV = D_Aniso(at, ab, dot(X, H), dot(Y, H), NoH) * V_Aniso(at, ab, dot(X, V), dot(Y, V), dot(X, L), dot(Y, L), NoV, NoL);
  } else DV = D_GGX(NoH, a) * V_GGX(NoV, NoL, a);
  return (diff * (1.0 - F) / PI + DV * F) * Lc * NoL;
}
// N, V: unit normal and view vector; wp: world position; lp, ln: local position and normal.
vec3 shadePBR(vec3 N, vec3 V, vec3 wp, vec3 lp, vec3 ln, float vis, out vec3 emission) {
  vec3 base = toLin(uColor);
  float metal = uMat.y, rough = clamp(uMat.z, 0.03, 1.0), cc = uMat.w;
  vec3 f0 = mix(vec3(0.04), uF0, metal);
  vec3 diff = base * (1.0 - metal);
  float aniso = uBrush.w;
  vec3 X = vec3(1.0, 0.0, 0.0), Y = vec3(0.0, 0.0, 1.0);
  vec3 org = (uModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  if (aniso > 0.0 || uDetail.y > 0.0) {
    vec3 A = normalize(mat3(uModel) * uBrush.xyz);
    vec3 T;
    if (uDetail.x < 0.5) {
      // turned: the grooves run around the axis, on the sides and on the end faces
      vec3 side = cross(A, N);
      vec3 rad = wp - org; rad -= A * dot(rad, A);
      T = length(side) > 0.3 ? normalize(side) : normalize(cross(A, normalize(rad + N * 1e-4)) + 1e-6);
    } else {
      T = A - N * dot(A, N);
      T = length(T) > 1e-3 ? normalize(T) : normalize(cross(N, vec3(0.0, 0.0, 1.0)) + vec3(1e-4));
    }
    Y = T; X = normalize(cross(N, T));
    if (uDetail.y > 0.0) {
      float s = dot(wp - org, X) * uDetail.y;
      float g = 0.55 * vnoise1(s) + 0.3 * vnoise1(s * 3.7 + 11.0) + 0.15 * vnoise1(s * 11.3 + 37.0);
      rough = clamp(rough * (1.0 + 0.4 * g), 0.03, 1.0);
      f0 *= 1.0 + 0.07 * g;
      // Muscle: fascicles show as fine light and dark stripes along the fibers.
      if (uTissue.z > 0.5) diff *= 0.8 + 0.2 * smoothstep(-0.4, 0.6, g + 0.35 * sin(s * 2.1));
    }
  }
  if (uDetail.z > 0.5) {
    // carbon fiber: a 2x2 twill of tows, each with its own fiber direction, under clear coat
    vec3 an = abs(normalize(ln));
    vec2 uv; vec3 ax, ay;
    if (an.x >= an.y && an.x >= an.z) { uv = lp.yz; ax = vec3(0.0, 1.0, 0.0); ay = vec3(0.0, 0.0, 1.0); }
    else if (an.y >= an.z) { uv = lp.xz; ax = vec3(1.0, 0.0, 0.0); ay = vec3(0.0, 0.0, 1.0); }
    else { uv = lp.xy; ax = vec3(1.0, 0.0, 0.0); ay = vec3(0.0, 1.0, 0.0); }
    vec2 q = uv * uDetail.w, c = floor(q), f = q - c;
    bool hz = mod(c.x + c.y, 4.0) < 2.0;
    vec3 fib = normalize(mat3(uModel) * (hz ? ax : ay));
    Y = normalize(fib - N * dot(fib, N) + 1e-5); X = normalize(cross(N, Y));
    float across = hz ? f.y : f.x, along = hz ? f.x : f.y;
    float edge = smoothstep(0.0, 0.18, across) * smoothstep(1.0, 0.82, across);
    diff *= 0.55 + 0.45 * edge * (0.75 + 0.25 * sin(along * PI));
    aniso = 0.75;
    rough = mix(0.55, 0.28, edge);
  }
  emission = uEmit;
  if (uTempAxis.w > 0.5) {
    float Tk = temperatureAt(lp);
    if (uHeat.x > 0.5) {
      // Oxide colors vary across a fired part: jitter the temperature by surface noise so the
      // bands mottle the way real heat tint does, and keep them muted.
      float span = max(abs(uTempS.y - uTempS.x), 1e-3);
      float nT = 0.6 * vnoise(lp * (7.0 / span)) + 0.4 * vnoise(lp * (19.0 / span) + 7.3);
      vec4 ht = heatTint(Tk - uHeat.y + 45.0 * nT);
      f0 = mix(f0, toLin(mix(ht.rgb, vec3(0.6), 0.45)), ht.a * 0.5);
      rough = mix(rough, max(rough, 0.5), smoothstep(620.0, 900.0, Tk - uHeat.y));
    }
    emission += blackbody(Tk) * glowOf(Tk);
  }
  float a = rough * rough;
  vec3 col = vec3(0.0);
  col += lightPBR(N, V, uLight, uKeyCol * vis, diff, f0, a, X, Y, aniso);
  if (uSun < 0.5) {
    col += lightPBR(N, V, uFillDir, uFillCol, diff, f0, a, X, Y, aniso);
    col += lightPBR(N, V, uRimDir, uRimCol, diff, f0, a, X, Y, aniso);
  }
  for (int i = 0; i < 2; i++) {
    if (uPtPos[i].w <= 0.0) continue;
    vec3 d = uPtPos[i].xyz - wp;
    float r2 = dot(d, d), att = 1.0 / (1.0 + r2 / (uPtPos[i].w * uPtPos[i].w));
    col += lightPBR(N, V, normalize(d), uPtCol[i] * att, diff, f0, a, X, Y, aniso);
  }
  // Tissue: light that enters scatters under the surface, so it wraps past the terminator tinted
  // by the blood and fat it passed through, glows through thin edges, and fuzzy fibers add sheen.
  if (uTissue.x > 0.0) {
    vec3 sc = toLin(uSssCol);
    float sssAmt = uTissue.x, w = 0.55 * sssAmt;
    for (int i = 0; i < 3; i++) {
      if (i > 0 && uSun > 0.5) break;
      vec3 L = i == 0 ? uLight : i == 1 ? uFillDir : uRimDir;
      vec3 Lc = i == 0 ? uKeyCol * mix(1.0, vis, 0.6) : i == 1 ? uFillCol : uRimCol;
      float ndl = dot(N, L), wrapped = clamp((ndl + w) / (1.0 + w), 0.0, 1.0);
      col += Lc * sc * (wrapped * wrapped - max(ndl, 0.0) * max(ndl, 0.0)) * sssAmt * base / PI * 1.6;
      col += Lc * sc * pow(clamp(dot(V, -(L + N * 0.35)), 0.0, 1.0), 4.0) * sssAmt * 0.22;
    }
    col += sc * envDiff(-N) * uLook.x * 0.18 * sssAmt;
    float NoV0 = max(dot(N, V), 0.0);
    col += uTissue.y * pow(1.0 - NoV0, 4.0) * (envDiff(N) * uLook.x + uKeyCol * vis * 0.25) * mix(base, vec3(1.0), 0.4) * 0.7;
  }
  float NoV = max(dot(N, V), 1e-4);
  vec3 Nb = N;
  if (aniso > 0.0) {
    vec3 at = cross(Y, V), anN = normalize(cross(at, Y) + 1e-6);
    Nb = normalize(mix(N, anN, aniso * clamp(3.0 * rough, 0.0, 0.9)));
  }
  vec2 ab = envBRDF(NoV, rough);
  float envK = uSun > 0.5 ? 0.06 : 1.0;
  col += (diff * envDiff(N) * uLook.x + envSpec(reflect(-V, Nb), rough) * (f0 * ab.x + ab.y) * uLook.y) * envK;
  if (cc > 0.0) {
    float Fc = (0.04 + 0.96 * pow(1.0 - NoV, 5.0)) * cc;
    col *= 1.0 - Fc;
    vec3 H = normalize(V + uLight);
    float sp = D_GGX(max(dot(N, H), 0.0), 0.04) * V_GGX(NoV, max(dot(N, uLight), 0.0), 0.04) * max(dot(N, uLight), 0.0);
    col += (envSpec(reflect(-V, N), 0.05) * uLook.y * envK + uKeyCol * vis * sp) * Fc;
  }
  return col;
}
vec3 shadeSoft(vec3 N, vec3 V, vec3 wp, float vis) {
  float ndl = dot(N, uLight);
  vec3 col;
  float sh = mix(1.0, vis, uHeat.w);
  if (uSun > 0.5) {
    float lit = smoothstep(-0.05, 0.25, ndl) * sh;
    col = uColor * (0.12 + 0.95 * lit * (0.55 + 0.45 * max(ndl, 0.0)));
  } else {
    float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
    wrap = wrap * wrap * (3.0 - 2.0 * wrap);
    vec3 cool = uColor * vec3(0.84, 0.86, 0.90);
    col = mix(cool, uColor, wrap * sh);
    col *= (0.92 + 0.08 * (0.5 + 0.5 * N.y)) * (1.0 - 0.1 * (1.0 - sh));
    vec3 H = normalize(uLight + V);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    col += vec3(pow(max(dot(N, H), 0.0), 40.0) * 0.06) * sh;
    col = mix(col, vec3(1.0), fres * 0.10);
  }
  for (int i = 0; i < 2; i++) {
    if (uPtPos[i].w <= 0.0) continue;
    vec3 d = uPtPos[i].xyz - wp;
    float r2 = dot(d, d), att = 1.0 / (1.0 + r2 / (uPtPos[i].w * uPtPos[i].w));
    col += uColor * uPtCol[i] * att * max(dot(N, normalize(d)), 0.0) * 0.3;
  }
  return col;
}`;

  const FS_MAIN = `#version 300 es
${G_COMMON}
${G_ENV}
${G_SHADOW}
${G_SURFACE}
in vec3 vWorld; in vec3 vNormal; in vec3 vLocal; in vec3 vLocalN;
uniform vec4 uCut; uniform float uCutOn; uniform float uId; uniform vec3 uHighlight; uniform float uHighlightOn;
uniform float uHatch;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  if (!gl_FrontFacing) {
    if (uCutOn < 0.5) discard;
    // Looking into a cut solid: this back face stands in for the section face. Its depth
    // stays where it is (so nearer surfaces still win); only the hatch is laid out on the
    // cut plane, where the view ray crosses it, so the lines stay straight and steady.
    vec3 dir = vWorld - uEye;
    float t = (uCut.w - dot(uEye, uCut.xyz)) / dot(dir, uCut.xyz);
    vec3 p = uEye + dir * t;
    vec3 n = uCut.xyz;
    vec3 a = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, a);
    float u = dot(p, normalize(a + b));
    float fw = max(fwidth(u), 1e-6);
    float d = abs(fract(u / uHatch + 0.5) - 0.5) * uHatch / fw;
    float line = 1.0 - smoothstep(0.35, 1.1, d);
    vec3 capc = uMat.x > 0.5 ? mix(uColor, vec3(0.86), 0.25 * uMat.y) : uColor;
    oColor = vec4(mix(capc * 0.93, capc * 0.5, line * 0.75), 1.0);
    oNormal = vec4(n * 0.5 + 0.5, uId);
    return;
  }
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);
  float vis = shadowAt(vWorld, N);
  vec3 col, glow = vec3(0.0);
  if (uMat.x < 0.5) col = shadeSoft(N, V, vWorld, vis);
  else {
    vec3 em;
    vec3 lin = shadePBR(N, V, vWorld, vLocal, vLocalN, vis, em);
    col = toSrgb(tonemap((lin + em) * uLook.z));
    glow = em * uLook.w;
  }
  if (uHighlightOn > 0.5) col = mix(col, uHighlight, 0.38);
  oColor = vec4(col + glow, 1.0);
  oNormal = vec4(N * 0.5 + 0.5, uId);
}`;

  const FS_GHOST = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNormal;
uniform vec3 uColor; uniform vec3 uEye; uniform vec3 uLight; uniform float uOpacity;
uniform vec4 uCut; uniform float uCutOn;
layout(location=0) out vec4 oColor;
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vWorld);
  float facing = abs(dot(N, V));
  float rim = pow(1.0 - facing, 2.2);
  float a = clamp(uOpacity * (0.30 + 1.6 * rim), 0.0, 0.9);
  vec3 col = uColor * (0.85 + 0.15 * clamp(dot(N, uLight), 0.0, 1.0));
  col = mix(col, col * 0.55, rim * 0.6);
  oColor = vec4(col * a, a);
}`;

  // Glass: refracts the finished opaque picture behind it (with a little dispersion),
  // reflects the environment by Fresnel, absorbs a tint along its thickness, and writes
  // depth and normals so its edges get ink like any solid.
  const FS_GLASS = `#version 300 es
${G_COMMON}
${G_ENV}
in vec3 vWorld; in vec3 vNormal;
uniform vec3 uColor; uniform vec3 uEye; uniform vec3 uLight; uniform vec3 uKeyCol;
uniform vec4 uCut; uniform float uCutOn; uniform float uId; uniform vec3 uHighlight; uniform float uHighlightOn;
uniform sampler2D uScene; uniform vec2 uSceneInv; uniform vec2 uSceneSize;
uniform mat4 uViewProj; uniform vec4 uGlass; uniform vec4 uLook;
uniform vec4 uWater; // water: ripple strength, ripple wavelength (world), time, depth color
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
vec2 screenOf(vec3 w) { vec4 c = uViewProj * vec4(w, 1.0); return (c.xy / c.w * 0.5 + 0.5) * uSceneSize; }
void main() {
  if (uCutOn > 0.5 && dot(vWorld, uCut.xyz) > uCut.w) discard;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vWorld);
  if (uWater.x > 0.0 && N.y > 0.2) {
    // A water surface: three travelling swells and a finer chop tilt the normal; the tilts move
    // the refracted picture and break the sun's reflection into glints.
    vec2 q = vWorld.xz / max(uWater.y, 1e-6);
    float t = uWater.z;
    vec2 g = vec2(0.8, 0.6) * cos(dot(q, vec2(0.8, 0.6)) + t * 1.3)
           + vec2(-0.5, 0.86) * cos(dot(q, vec2(-0.5, 0.86)) * 1.7 + t * 1.9) * 0.55
           + vec2(0.24, -0.97) * cos(dot(q, vec2(0.24, -0.97)) * 2.9 + t * 2.7) * 0.3;
    g += vec2(vnoise(vec3(q * 3.1, t * 0.7)), vnoise(vec3(q * 3.1 + 11.0, t * 0.7))) * 0.35;
    N = normalize(N + vec3(-g.x, 0.0, -g.y) * uWater.x * 0.08 * N.y);
  }
  float NoV = clamp(dot(N, V), 0.0, 1.0);
  float ior = uGlass.x, thick = uGlass.y, disp = uGlass.z, rough = uGlass.w;
  float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  float F = f0 + (1.0 - f0) * pow(1.0 - NoV, 5.0);
  vec2 here = gl_FragCoord.xy;
  vec3 behind = vec3(0.0), wsum = vec3(0.0); float behindA = 0.0;
  float tir = 0.0;
  // Dispersion: six wavelengths across the visible band, each bent by its own index and weighted
  // into RGB by a smooth response, so a fringe is a soft gradient rather than three hard copies.
  // Rough (frosted) glass spreads each sample over a small disk of what's behind.
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(here, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < 6; i++) {
    float u = (float(i) + 0.5) / 6.0;
    float n = ior + (u - 0.5) * 2.0 * disp;
    vec3 Tr = refract(-V, N, 1.0 / n);
    if (dot(Tr, Tr) < 1e-6) { tir += 1.0; continue; }
    vec2 at = screenOf(vWorld + Tr * thick * (1.0 + 0.6 * (1.0 - NoV)));
    float a2 = ang + float(i) * 2.39996;
    at += vec2(cos(a2), sin(a2)) * rough * 28.0 * sqrt(u + 0.1);
    vec4 sm = texture(uScene, clamp(at, vec2(0.5), uSceneSize - 0.5) * uSceneInv);
    vec3 w = vec3(exp(-pow((u - 0.1) / 0.24, 2.0)), exp(-pow((u - 0.5) / 0.22, 2.0)), exp(-pow((u - 0.9) / 0.24, 2.0)));
    behind += sm.rgb * w; wsum += w;
    behindA += sm.a / 6.0;
  }
  behind /= max(wsum, vec3(1e-4));
  tir *= 3.0 / 6.0;
  // Absorption: a faint tint, stronger where the light crosses more glass (edges).
  // Water absorbs red first, so deeper water (or a longer path at a grazing angle) turns blue-green.
  vec3 tint = pow(clamp(uColor, 0.02, 1.0), vec3((0.6 + 1.6 * (1.0 - NoV)) * (1.0 + uWater.w)));
  float T = (1.0 - F) * (1.0 - tir / 3.0);
  vec3 R = reflect(-V, N);
  vec3 refl = envSpec(R, rough) * uLook.y;
  vec3 H = normalize(V + uLight);
  refl += uKeyCol * pow(max(dot(N, H), 0.0), 600.0) * 4.0;
  float Fr = mix(F, 1.0, tir / 3.0);
  vec3 reflD = toSrgb(tonemap(refl * uLook.z));
  vec3 col = behind * tint * T + reflD * Fr;
  float alpha = clamp(behindA * T + (1.0 - T * (0.55 + 0.45 * dot(tint, vec3(0.333)))), 0.0, 1.0);
  col = min(col, vec3(alpha + Fr));
  if (uHighlightOn > 0.5) col = mix(col, uHighlight * alpha, 0.3);
  oColor = vec4(col, max(alpha, Fr * 0.6));
  oNormal = vec4(N * 0.5 + 0.5, uId);
}`;

  // The ground: invisible except for the shadow it catches, a soft contact shadow right
  // under the model plus the cast shadow of the key light, fading out with distance.
  const VS_GROUND = `#version 300 es
uniform mat4 uViewProj; uniform vec3 uCenter; uniform float uHalf;
out vec3 vWorld;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vWorld = uCenter + vec3(c.x * uHalf, 0.0, c.y * uHalf);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;
  const FS_GROUND = `#version 300 es
${G_COMMON}
${G_SHADOW}
in vec3 vWorld;
uniform vec3 uCenter; uniform vec2 uRadii; uniform vec4 uGround;
out vec4 o;
void main() {
  vec2 q = (vWorld.xz - uCenter.xz) / uRadii;
  float blob = uGround.x * pow(1.0 - smoothstep(0.0, 1.0, length(q)), 1.7);
  float fade = 1.0 - smoothstep(0.55, 1.0, length(vWorld.xz - uCenter.xz) / uGround.z);
  float castS = (1.0 - shadowAt(vWorld, vec3(0.0, 1.0, 0.0))) * uGround.y * fade;
  float a = 1.0 - (1.0 - blob) * (1.0 - castS);
  o = vec4(0.0, 0.0, 0.0, a);
}`;

  const VS_FULL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  // Composite: ink outlines from depth, normal, and part-id discontinuities over a filter
  // of the render pixels behind each output pixel (supersampled, or a smooth upscale at
  // reduced render scale), ambient occlusion, the effects layer, and bloom.
  const FS_COMPOSITE = `#version 300 es
${G_COMMON}
uniform sampler2D uColor; uniform sampler2D uNormal; uniform sampler2D uDepth; uniform sampler2D uFx; uniform sampler2D uBloom;
uniform vec2 uInvSize; uniform float uStep; uniform float uInk;
uniform vec2 uScale; uniform int uTaps; uniform float uAo; uniform float uAoR;
uniform vec2 uFxInv; uniform vec2 uBloomInv; uniform vec4 uPost;
uniform mat3 uViewRot; uniform vec2 uTanHalf; uniform vec2 uSize;
uniform vec4 uShim[4]; uniform vec4 uShimR[4]; uniform int uShimN; uniform float uShimT;
out vec4 o;
// Heat shimmer: hot gas bends the light from what's behind it. Each zone is a tapered capsule
// in output pixels (start, end; radius at each end, strength in pixels); noise drifting along
// it offsets where the scene behind is read, so solids seen through the jet waver.
vec2 shimmer(vec2 p) {
  vec2 off = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uShimN) break;
    vec2 a = uShim[i].xy, ab = uShim[i].zw - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float r = mix(uShimR[i].x, uShimR[i].y, t), d = length(p - (a + ab * t));
    float m = (1.0 - smoothstep(r * 0.35, r, d)) * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.7, 1.0, t));
    if (m <= 0.0) continue;
    vec2 dir = ab / max(length(ab), 1e-4);
    vec3 q = vec3((p - dir * uShimT * r * 2.5) / max(r * 0.3, 1.0), uShimT * 3.0);
    off += vec2(vnoise(q), vnoise(q + 19.7)) * uShimR[i].z * m;
  }
  return off;
}
vec4 shade(vec2 px) {
  vec4 c0 = texture(uColor, px * uInvSize);
  c0.rgb = min(c0.rgb, vec3(c0.a));
  vec4 n0 = texture(uNormal, px * uInvSize);
  float d0 = linDepth(texture(uDepth, px * uInvSize).r);
  bool bg0 = n0.a < 0.5 / 255.0;
  float edge = 0.0;
  float inkDepth = bg0 ? 1e20 : d0;
  vec3 inkSrc = bg0 ? vec3(0.45) : c0.rgb / max(c0.a, 1e-3);
  const vec2 offs[8] = vec2[8](vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1),
                               vec2(0.71, 0.71), vec2(-0.71, 0.71), vec2(0.71, -0.71), vec2(-0.71, -0.71));
  for (int i = 0; i < 8; i++) {
    vec2 q = (px + offs[i] * uStep) * uInvSize;
    vec4 n1 = texture(uNormal, q);
    bool bg1 = n1.a < 0.5 / 255.0;
    float d1 = linDepth(texture(uDepth, q).r);
    float e = 0.0;
    if (bg0 != bg1) e = 1.0;
    else if (!bg0) {
      if (abs(n0.a - n1.a) > 0.5 / 255.0) e = 0.85;
      float dd = abs(d0 - d1) / max(min(d0, d1), 1e-4);
      e = max(e, smoothstep(0.012, 0.035, dd) * 0.85);
      float nd = 1.0 - dot(n0.xyz * 2.0 - 1.0, n1.xyz * 2.0 - 1.0);
      e = max(e, smoothstep(0.10, 0.32, nd) * 0.5);
    }
    if (e > 0.0 && !bg1 && d1 < inkDepth) {
      vec4 c1 = texture(uColor, q);
      inkDepth = d1;
      inkSrc = min(c1.rgb / max(c1.a, 1e-3), vec3(1.0));
    }
    edge = max(edge, e);
  }
  // Ink is a darker shade of the surface it outlines, so colored parts get colored lines.
  vec3 ink = pow(inkSrc, vec3(1.35)) * 0.40;
  float a = clamp(edge * uInk, 0.0, 1.0);
  return vec4(ink * a, a) + c0 * (1.0 - a);
}
// View-space position of a render pixel.
vec3 viewPos(vec2 px, float d) {
  vec2 ndc = px / uSize * 2.0 - 1.0;
  return uOrtho > 0.5 ? vec3(ndc * uTanHalf, -d) : vec3(ndc * uTanHalf * d, -d);
}
// Ambient occlusion: a normal-oriented hemisphere test against the depth buffer, 16 taps
// on a fixed spiral (no noise, so nothing to blur), with a range check so far-off
// surfaces don't darken what's in front of them.
float occlusion(vec2 px) {
  vec4 n0 = texture(uNormal, px * uInvSize);
  if (n0.a < 0.5 / 255.0) return 1.0;
  float d0 = linDepth(texture(uDepth, px * uInvSize).r);
  vec3 P = viewPos(px, d0), N = normalize(uViewRot * (n0.xyz * 2.0 - 1.0));
  float rpx = uOrtho > 0.5 ? uAoR / (2.0 * uTanHalf.y) * uSize.y : uAoR / (2.0 * uTanHalf.y * d0) * uSize.y;
  rpx = clamp(rpx, 2.0, uSize.y * 0.08);
  float occ = 0.0;
  for (int i = 0; i < 16; i++) {
    float f = (float(i) + 0.5) / 16.0;
    float ang = float(i) * 2.39996323;
    vec2 q = px + vec2(cos(ang), sin(ang)) * rpx * sqrt(f);
    vec4 nq = texture(uNormal, q * uInvSize);
    if (nq.a < 0.5 / 255.0) continue;
    vec3 Q = viewPos(q, linDepth(texture(uDepth, q * uInvSize).r));
    vec3 v = Q - P;
    float L = length(v);
    float h = max(dot(N, v) / max(L, 1e-5) - 0.12, 0.0);
    occ += h * (1.0 - smoothstep(uAoR * 0.6, uAoR * 1.6, L));
  }
  return 1.0 - uAo * clamp(occ / 16.0 * 2.2, 0.0, 1.0);
}
void main() {
  vec2 o0 = floor(gl_FragCoord.xy);
  vec2 o1 = uShimN > 0 ? o0 + shimmer(o0 + 0.5) : o0;
  vec4 sum = vec4(0.0);
  float N = float(uTaps);
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    if (i < uTaps && j < uTaps) sum += shade((o1 + (vec2(float(i), float(j)) + 0.5) / N) * uScale);
  }
  vec4 sc = sum / (N * N);
  if (uAo > 0.0) sc.rgb *= occlusion((o1 + 0.5) * uScale);
  vec4 res = sc;
  if (uPost.x > 0.5) {
    vec4 fx = texture(uFx, (o0 + 0.5) * uFxInv);
    res = vec4(min(fx.rgb, vec3(1.0)) + sc.rgb * (1.0 - fx.a), fx.a + sc.a * (1.0 - fx.a));
  }
  if (uPost.y > 0.0) {
    vec3 b = texture(uBloom, (o0 + 0.5) * uBloomInv).rgb * uPost.y;
    res.rgb += b;
  }
  res.a = clamp(max(res.a, max(res.r, max(res.g, res.b))), 0.0, 1.0);
  float dz = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  res.rgb = clamp(res.rgb + dz * step(0.002, res.a), 0.0, res.a);
  o = res;
}`;

  // Bloom: pick out what's brighter than its own coverage (glowing parts, fire, plumes),
  // halve it down a chain, and add it back up with a tent filter.
  const FS_BLOOM_EXTRACT = `#version 300 es
precision highp float;
uniform sampler2D uColor; uniform sampler2D uFx; uniform vec2 uColorInv; uniform vec2 uColorScale; uniform vec2 uFxInv; uniform float uFxOn;
out vec4 o;
vec3 over(vec4 c) { return max(c.rgb - vec3(c.a), 0.0); }
void main() {
  vec2 p = gl_FragCoord.xy * 2.0;
  vec3 s = vec3(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 q = p + vec2(float(i), float(j)) - 0.5;
    s += over(texture(uColor, q * uColorScale * uColorInv));
    if (uFxOn > 0.5) s += over(texture(uFx, q * uFxInv)) * 0.8;
  }
  o = vec4(min(s * 0.25, vec3(16.0)), 1.0);
}`;
  const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uSrcInv;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy * 2.0;
  vec3 s = texture(uSrc, (p + vec2(-1.0, -1.0)) * uSrcInv).rgb + texture(uSrc, (p + vec2(1.0, -1.0)) * uSrcInv).rgb
         + texture(uSrc, (p + vec2(-1.0, 1.0)) * uSrcInv).rgb + texture(uSrc, (p + vec2(1.0, 1.0)) * uSrcInv).rgb;
  s = s * 0.5 + texture(uSrc, p * uSrcInv).rgb * 2.0;
  o = vec4(s / 4.0, 1.0);
}`;
  const FS_UP = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uSrcInv; uniform float uWeight;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy * 0.5;
  vec3 s = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
    s += texture(uSrc, (p + vec2(float(i), float(j)) * 0.75) * uSrcInv).rgb * w;
  }
  o = vec4(s / 16.0 * uWeight, 1.0);
}`;

  // The procedural environment, made once per look and page theme: soft boxes around a
  // neutral sweep (studio), a dark room with cool rim strips (night), or a sky (outdoor).
  const FS_ENV = `#version 300 es
${G_COMMON}
uniform vec2 uSize; uniform int uKind; uniform float uDark; uniform vec3 uSun; uniform float uOutScale;
out vec4 o;
float softbox(vec3 d, vec3 c, vec3 up, vec2 size, float soft) {
  float k = dot(d, c);
  if (k <= 0.05) return 0.0;
  vec3 u = normalize(up - c * dot(up, c)), v = cross(c, u);
  vec2 q = vec2(dot(d, v), dot(d, u)) / k;
  vec2 e = abs(q) - size;
  float dist = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  return 1.0 - smoothstep(-soft, soft, dist);
}
vec3 env(vec3 d) {
  float y = d.y;
  if (uKind == 2) {
    vec3 zen = vec3(0.16, 0.32, 0.72), hor = vec3(0.78, 0.84, 0.92), gnd = vec3(0.26, 0.24, 0.21);
    if (uDark > 0.5) { zen *= 0.35; hor *= 0.35; gnd *= 0.4; }
    vec3 col = y > 0.0 ? mix(hor, zen, pow(y, 0.55)) * 1.3 : mix(hor * 0.75, gnd, smoothstep(0.0, 0.2, -y));
    float s = max(dot(d, uSun), 0.0);
    col += vec3(1.0, 0.9, 0.75) * (pow(s, 1200.0) * 60.0 + pow(s, 24.0) * 0.6);
    return col;
  }
  if (uKind == 1) {
    vec3 col = y > 0.0 ? mix(vec3(0.016, 0.018, 0.026), vec3(0.03, 0.035, 0.05), y) : vec3(0.008, 0.008, 0.01);
    col += vec3(0.55, 0.65, 1.0) * 3.2 * softbox(d, normalize(vec3(-0.85, 0.2, -0.5)), vec3(0, 1, 0), vec2(0.06, 0.7), 0.04);
    col += vec3(0.55, 0.65, 1.0) * 2.6 * softbox(d, normalize(vec3(0.85, 0.25, -0.45)), vec3(0, 1, 0), vec2(0.06, 0.7), 0.04);
    col += vec3(0.7, 0.75, 0.9) * 0.9 * softbox(d, normalize(vec3(0.05, 1.0, 0.1)), vec3(0, 0, 1), vec2(0.5, 0.3), 0.15);
    return col;
  }
  vec3 wall = uDark > 0.5 ? vec3(0.05, 0.052, 0.058) : vec3(0.54, 0.55, 0.57);
  vec3 ceilc = uDark > 0.5 ? vec3(0.03, 0.032, 0.036) : vec3(0.42, 0.43, 0.45);
  vec3 flo = uDark > 0.5 ? vec3(0.018, 0.018, 0.02) : vec3(0.2, 0.2, 0.205);
  vec3 col = y > 0.0 ? mix(wall, ceilc, smoothstep(0.0, 0.9, y)) : mix(wall * 0.8, flo, smoothstep(0.0, 0.18, -y));
  col += (uDark > 0.5 ? 0.04 : 0.18) * exp(-abs(y) * 22.0);
  float bright = uDark > 0.5 ? 0.8 : 1.0;
  col += vec3(1.0, 0.97, 0.93) * 7.0 * bright * softbox(d, normalize(vec3(-0.5, 0.62, 0.6)), vec3(0, 1, 0), vec2(0.36, 0.26), 0.05);
  col += vec3(1.0, 0.99, 0.97) * 3.0 * bright * softbox(d, normalize(vec3(0.15, 1.0, 0.2)), vec3(0, 0, 1), vec2(0.55, 0.32), 0.08);
  col += vec3(0.93, 0.96, 1.0) * 1.5 * bright * softbox(d, normalize(vec3(0.92, 0.12, 0.38)), vec3(0, 1, 0), vec2(0.28, 0.5), 0.12);
  col += vec3(1.0) * 4.5 * bright * softbox(d, normalize(vec3(-0.78, 0.18, -0.6)), vec3(0, 1, 0), vec2(0.06, 0.62), 0.03);
  col += vec3(1.0) * 3.5 * bright * softbox(d, normalize(vec3(0.8, 0.28, -0.52)), vec3(0, 1, 0), vec2(0.06, 0.62), 0.03);
  return col;
}
vec3 dirOf(vec2 uv) {
  float ph = (uv.x - 0.5) * 2.0 * PI, th = uv.y * PI;
  return vec3(sin(th) * sin(ph), cos(th), -sin(th) * cos(ph));
}
void main() { o = vec4(env(dirOf(gl_FragCoord.xy / uSize)) * uOutScale, 1.0); }`;

  // Prefilters the environment for one roughness (GGX importance sampling, reading lower
  // mips of the source for wide lobes so small bright boxes don't sparkle), or, with
  // uMode 1, convolves it with a cosine lobe for diffuse light.
  const FS_PREFILTER = `#version 300 es
${G_COMMON}
uniform sampler2D uSrc; uniform vec2 uSize; uniform float uRough; uniform int uMode; uniform float uSrcW; uniform float uScale;
out vec4 o;
vec3 dirOf(vec2 uv) { float ph = (uv.x - 0.5) * 2.0 * PI, th = uv.y * PI; return vec3(sin(th) * sin(ph), cos(th), -sin(th) * cos(ph)); }
vec2 uvOf(vec3 d) { return vec2(atan(d.x, -d.z) * (0.5 / PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI); }
vec2 hamm(uint i, uint n) { uint b = i; b = (b << 16u) | (b >> 16u); b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u); b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u); b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u); b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u); return vec2(float(i) / float(n), float(b) * 2.3283064365386963e-10); }
void main() {
  vec3 N = dirOf(gl_FragCoord.xy / uSize);
  vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(up, N)), ty = cross(N, tx);
  vec3 sum = vec3(0.0); float w = 0.0;
  const uint S = 96u;
  float texel = 4.0 * PI / (uSrcW * uSrcW * 0.5);
  if (uMode == 1) {
    for (uint i = 0u; i < S; i++) {
      vec2 xi = hamm(i, S);
      float ph = 2.0 * PI * xi.y, ct = sqrt(1.0 - xi.x), st = sqrt(xi.x);
      vec3 L = tx * (st * cos(ph)) + ty * (st * sin(ph)) + N * ct;
      float pdf = ct / PI;
      float lod = clamp(0.5 * log2(1.0 / (float(S) * pdf * texel)) + 1.0, 0.0, 8.0);
      sum += textureLod(uSrc, uvOf(L), lod).rgb;
      w += 1.0;
    }
    o = vec4(sum / w * uScale, 1.0);
    return;
  }
  float a = uRough * uRough;
  for (uint i = 0u; i < S; i++) {
    vec2 xi = hamm(i, S);
    float ph = 2.0 * PI * xi.y, ct = sqrt((1.0 - xi.x) / (1.0 + (a * a - 1.0) * xi.x)), st = sqrt(1.0 - ct * ct);
    vec3 H = tx * (st * cos(ph)) + ty * (st * sin(ph)) + N * ct;
    vec3 L = 2.0 * dot(N, H) * H - N;
    float NoL = dot(N, L);
    if (NoL <= 0.0) continue;
    float a2 = a * a, f = (ct * a2 - ct) * ct + 1.0, D = a2 / (PI * f * f);
    float pdf = D * 0.25 + 1e-4;
    float lod = uRough < 0.02 ? 0.0 : clamp(0.5 * log2(1.0 / (float(S) * pdf * texel)) + 1.0, 0.0, 8.0);
    sum += textureLod(uSrc, uvOf(L), lod).rgb * NoL;
    w += NoL;
  }
  o = vec4(sum / max(w, 1e-4) * uScale, 1.0);
}`;

  // ---------- particle shaders ----------
  // Shared slot bookkeeping: generation, age, life, and hashed randoms per (slot, generation).
  const G_SLOT = `
uniform uint uSeed; uniform vec4 uLife;
float rnd(int i, float k, uint c) { return float(hashu(uint(i) * 0x9E3779B1u ^ hashu(uint(int(k)) + c * 0x632BE5ABu + uSeed)) >> 8) / 16777216.0; }
void slotAt(int i, float t, float P, out float k, out float age) {
  if (P <= 0.0) { k = 0.0; age = t; return; }
  float ph = fract(float(i) * 0.6180339887) * P;
  k = floor((t - ph) / P);
  age = t - (ph + k * P);
}
float lifeOf(int i, float k) { return uLife.y <= 0.0 ? 1e9 : mix(uLife.x, uLife.y, rnd(i, k, 1u)); }`;

  // Flow fields, the same formulas as E3.flow: uniform, cylinder, Joukowski airfoil.
  const G_FLOW = `
uniform vec4 uFlowA; uniform vec4 uFlowB; uniform vec4 uFlowC;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { float d = max(dot(b, b), 1e-30); return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
vec2 csqrt(vec2 a) { float r = length(a), t = atan(a.y, a.x) * 0.5; return sqrt(r) * vec2(cos(t), sin(t)); }
uniform highp sampler2D uFlowTex; uniform vec4 uFlowD; uniform vec4 uFlowE; uniform mat4 uFlowM; uniform mat4 uFlowMI;
// Tube flow (kind 3): boundary radii by station in uFlowTex (row 0: c0 c1 b0 b1, row 1: x0),
// uFlowD: y0, dy, stations, outside speed; uFlowE: core and bypass flux (Q / pi).
vec4 tubeFlow(vec3 pw) {
  vec3 q = (uFlowMI * vec4(pw, 1.0)).xyz;
  float r = length(q.xz), fi = (q.y - uFlowD.x) / uFlowD.y;
  int n = int(uFlowD.z + 0.5);
  if (fi < 0.0 || fi > float(n - 1)) return vec4(mat3(uFlowM) * vec3(0.0, uFlowD.w, 0.0), 1.0);
  int i = min(n - 2, int(floor(fi)));
  float f = fi - float(i);
  vec4 A = texelFetch(uFlowTex, ivec2(i, 0), 0), B = texelFetch(uFlowTex, ivec2(i + 1, 0), 0);
  vec2 ra = texelFetch(uFlowTex, ivec2(i, 1), 0).xy, rb = texelFetch(uFlowTex, ivec2(i + 1, 1), 0).xy;
  float xa = ra.x, xb = rb.x, heat = mix(ra.y, rb.y, f);
  vec4 v = mix(A, B, f), d = (B - A) / uFlowD.y;
  float x0 = mix(xa, xb, f), dx0 = (xb - xa) / uFlowD.y;
  float a, b, da, db, Q, uy, ur;
  if (r < v.x - 1e-4) return vec4(0.0);
  if (r <= v.y) { a = v.x; b = v.y; da = d.x; db = d.y; Q = uFlowE.x * heat; }
  else if (r < v.z) return vec4(0.0);
  else if (r <= v.w) { a = v.z; b = v.w; da = d.z; db = d.w; Q = uFlowE.y; }
  else if (r < x0) return vec4(0.0);
  else { uy = uFlowD.w; ur = r > 1e-4 ? uy * x0 * dx0 / r : 0.0; vec3 lv = vec3(r > 1e-4 ? ur * q.x / r : 0.0, uy, r > 1e-4 ? ur * q.z / r : 0.0); return vec4(mat3(uFlowM) * lv, 1.0); }
  float den = max(b * b - a * a, 1e-6);
  uy = Q / den;
  float eta = (r * r - a * a) / den;
  ur = r > 1e-4 ? uy * (a * da * (1.0 - eta) + b * db * eta) / r : 0.0;
  vec3 lv = vec3(r > 1e-4 ? ur * q.x / r : 0.0, uy, r > 1e-4 ? ur * q.z / r : 0.0);
  return vec4(mat3(uFlowM) * lv, 1.0);
}
// uFlowA: kind, U, alpha, S. uFlowB: center xyz, mid. uFlowC: mu.x, mu.y, a, gamma. Returns w = 0 inside the body.
vec4 flowAt(vec3 p) {
  int kind = int(uFlowA.x + 0.5);
  float U = uFlowA.y;
  if (kind == 0) return vec4(U, 0.0, 0.0, 1.0);
  if (kind == 3) return tubeFlow(p);
  float al = uFlowA.z, ca = cos(al), sa = sin(al);
  vec2 x = (p.xy - uFlowB.xy) / uFlowA.w;
  float g = uFlowC.w / (2.0 * PI);
  if (kind == 1) {
    float R = uFlowC.z;
    if (dot(x, x) < R * R) return vec4(0.0);
    vec2 t = cdiv(vec2(R * R, 0.0), cmul(x, x));
    vec2 w = vec2(U * (1.0 - t.x), -U * t.y) + cdiv(vec2(0.0, g), x);
    return vec4(w.x, -w.y, 0.0, 1.0);
  }
  vec2 z = vec2(x.x * ca - x.y * sa + uFlowB.w, x.x * sa + x.y * ca);
  vec2 s = csqrt(vec2(z.x * z.x - z.y * z.y - 4.0, 2.0 * z.x * z.y));
  vec2 z1 = (z + s) * 0.5, z2 = (z - s) * 0.5, mu = uFlowC.xy;
  float d1 = length(z1 - mu), d2 = length(z2 - mu);
  vec2 ze = d1 >= d2 ? z1 : z2;
  if (max(d1, d2) < uFlowC.z * 1.002) return vec4(0.0);
  vec2 zm = ze - mu;
  vec2 t = cdiv(cmul(vec2(uFlowC.z * uFlowC.z, 0.0), vec2(cos(al), sin(al))), cmul(zm, zm));
  vec2 dW = U * (vec2(cos(al), -sin(al)) - t) + cdiv(vec2(0.0, g), zm);
  vec2 iz = cdiv(vec2(1.0, 0.0), cmul(ze, ze));
  vec2 dw = cdiv(dW, vec2(1.0 - iz.x, -iz.y));
  float u = dw.x, v = -dw.y;
  return vec4(u * ca + v * sa, -u * sa + v * ca, 0.0, 1.0);
}`;

  // One fixed step of the particle simulation, run by transform feedback.
  const VS_PUPDATE = `#version 300 es
${G_COMMON}
${G_SLOT}
${G_FLOW}
layout(location=0) in vec4 aP; layout(location=1) in vec4 aV;
out vec4 oP; out vec4 oV;
uniform float uT; uniform float uH; uniform mat4 uEmitM;
uniform vec4 uEm0; uniform vec4 uEm1; uniform vec4 uEm2; uniform vec4 uEm3; uniform vec4 uEm4;
uniform highp sampler2D uSamples;
uniform vec4 uGrav; uniform vec4 uWind; uniform vec4 uTurb; uniform vec4 uVortA; uniform vec4 uVortB; uniform vec4 uVortC;
uniform vec4 uAttr[4]; uniform vec4 uAttrR; uniform int uNAttr;
uniform vec4 uPlane[8]; uniform vec4 uPlaneB[8]; uniform int uNPlane;
uniform vec4 uSph[4]; uniform vec4 uSphB[4]; uniform int uNSph;
uniform vec4 uKillMin; uniform vec4 uKillMax;
// uEm0: shape, radius, thickness/angle, rake lanes. uEm1: position xyz, spread. uEm2: direction xyz, speed0.
// uEm3: speed1, thermal, along (0 dir, 1 normal, 2 radial), surface. uEm4: size xyz (box) or line end xyz, nSamples.
void emit(int i, float k, out vec3 p, out vec3 v) {
  float shape = uEm0.x, R = uEm0.y;
  vec3 dir = normalize(uEm2.xyz);
  vec3 tmp = abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(dir, tmp)), w = cross(dir, u);
  float lanes = uEm0.w;
  vec3 n = dir; p = vec3(0.0);
  if (shape > 0.5 && shape < 3.5) { // 1 disk, 2 ring, 3 cone
    float a = 6.2831853 * rnd(i, k, 10u);
    float rr = shape > 1.5 && shape < 2.5 ? R + uEm0.z * (rnd(i, k, 11u) - 0.5) : R * sqrt(rnd(i, k, 11u));
    vec3 radial = u * cos(a) + w * sin(a);
    p = radial * rr;
    if (shape > 2.5) n = normalize(dir + radial * tan(uEm0.z) * (R > 0.0 ? rr / R : 1.0));
    if (shape > 1.5 && shape < 2.5 && uEm3.z > 1.5) n = radial;
  } else if (shape > 3.5 && shape < 4.5) { // sphere
    float z = 2.0 * rnd(i, k, 10u) - 1.0, a = 6.2831853 * rnd(i, k, 11u), q = sqrt(1.0 - z * z);
    n = vec3(q * cos(a), z, q * sin(a));
    p = n * (uEm3.w > 0.5 ? R : R * pow(rnd(i, k, 12u), 1.0 / 3.0));
  } else if (shape > 4.5 && shape < 5.5) { // box
    float ry = rnd(i, k, 11u);
    if (lanes > 0.5) ry = (floor(ry * lanes) + 0.5) / lanes;
    p = (vec3(rnd(i, k, 10u), ry, rnd(i, k, 12u)) - 0.5) * uEm4.xyz;
  } else if (shape > 5.5 && shape < 6.5) { // line from position to end
    float t = rnd(i, k, 10u);
    if (lanes > 0.5) t = (floor(t * lanes) + 0.5) / lanes;
    p = (uEm4.xyz - uEm1.xyz) * t;
  } else if (shape > 6.5) { // mesh samples
    int j = min(int(uEm4.w) - 1, int(rnd(i, k, 10u) * uEm4.w));
    p = texelFetch(uSamples, ivec2(j % 1024, (j / 1024) * 2), 0).xyz - uEm1.xyz;
    n = texelFetch(uSamples, ivec2(j % 1024, (j / 1024) * 2 + 1), 0).xyz;
  }
  p += uEm1.xyz;
  vec3 d = (uEm3.z > 0.5 || (shape > 2.5 && shape < 3.5)) ? n : dir;
  float spread = uEm1.w;
  if (spread > 0.0) {
    float ct = 1.0 - rnd(i, k, 13u) * (1.0 - cos(spread)), st = sqrt(max(0.0, 1.0 - ct * ct)), a = 6.2831853 * rnd(i, k, 14u);
    vec3 du = normalize(cross(d, abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), dw = cross(d, du);
    d = d * ct + du * st * cos(a) + dw * st * sin(a);
  }
  v = d * mix(uEm2.w, uEm3.x, rnd(i, k, 15u));
  if (uEm3.y > 0.0) {
    vec3 gs;
    for (int c = 0; c < 3; c++) gs[c] = sqrt(-2.0 * log(max(1e-7, rnd(i, k, uint(16 + c * 2))))) * cos(6.2831853 * rnd(i, k, uint(17 + c * 2)));
    v += gs * uEm3.y;
  }
  p = (uEmitM * vec4(p, 1.0)).xyz;
  v = mat3(uEmitM) * v;
}
void main() {
  int i = gl_VertexID;
  float k, age;
  slotAt(i, uT, uLife.y, k, age);
  float life = lifeOf(i, k);
  vec3 p = aP.xyz, v = aV.xyz;
  float gen = aP.w, hit = 0.0, h = uH;
  if (floor(gen) != k) {
    if (age > uH + 1e-5 && uLife.y > 0.0) { oP = vec4(p, k + 0.5); oV = vec4(v, 0.0); return; }
    emit(i, k, p, v);
    gen = k;
    h = clamp(age, 0.0, uH);
  }
  if (gen != k || age > life) { oP = vec4(p, gen); oV = vec4(v, 0.0); return; }
  if (uFlowA.x > -0.5) {
    vec4 f1 = flowAt(p);
    if (f1.w < 0.5) { oP = vec4(p, k + 0.5); oV = vec4(v, 0.0); return; }
    vec4 f2 = flowAt(p + f1.xyz * h * 0.5);
    v = f2.w > 0.5 ? f2.xyz : f1.xyz;
    if (uTurb.x > 0.0) v += curl(p * uTurb.y + vec3(0.0, 0.0, uT * uTurb.z)) * uTurb.x;
    p += v * h;
  } else {
    vec3 acc = uGrav.xyz;
    acc.y += uWind.w * max(0.0, 1.0 - age / life);
    if (uTurb.x > 0.0) acc += curl(p * uTurb.y + vec3(0.0, 0.0, uT * uTurb.z)) * uTurb.x;
    if (uVortC.y > 0.5) {
      vec3 r = p - uVortA.xyz, ax = uVortB.xyz;
      vec3 rp = r - ax * dot(r, ax);
      acc += uVortA.w * cross(ax, rp) / (dot(rp, rp) + uVortB.w * uVortB.w) - rp * uVortC.x;
    }
    for (int j = 0; j < 4; j++) {
      if (j >= uNAttr) break;
      vec3 d = uAttr[j].xyz - p;
      acc += d * uAttr[j].w / pow(dot(d, d) + uAttrR[j] * uAttrR[j], 1.5);
    }
    float kd = uGrav.w;
    if (kd > 0.0) {
      float e = exp(-kd * h), f = (1.0 - e) / kd;
      vec3 vt = uWind.xyz + acc / kd;
      p += vt * h + (v - vt) * f;
      v = vt + (v - vt) * e;
    } else {
      v += acc * h;
      p += v * h;
    }
  }
  for (int j = 0; j < 8; j++) {
    if (j >= uNPlane) break;
    vec3 n = uPlane[j].xyz;
    float s = dot(n, p) - uPlane[j].w;
    if (s >= 0.0) continue;
    p -= n * s;
    float vn = dot(n, v) - uPlaneB[j].z;
    if (vn < 0.0) {
      float jj = -(1.0 + uPlaneB[j].x) * vn;
      v += n * jj;
      if (uPlaneB[j].y > 0.0) { float vn2 = dot(n, v); v -= (v - n * vn2) * uPlaneB[j].y; }
      hit += jj;
    }
  }
  for (int j = 0; j < 4; j++) {
    if (j >= uNSph) break;
    vec3 d = p - uSph[j].xyz;
    float L = max(length(d), 1e-9), sg = uSphB[j].y, s = (L - uSph[j].w) * sg;
    if (s >= 0.0) continue;
    vec3 n = d * (sg / L);
    p -= n * s;
    float vn = dot(n, v);
    if (vn < 0.0) { float jj = -(1.0 + uSphB[j].x) * vn; v += n * jj; hit += jj; }
  }
  if (uKillMin.w > 0.5 && (any(lessThan(p, uKillMin.xyz)) || any(greaterThan(p, uKillMax.xyz)))) gen = k + 0.5;
  oP = vec4(p, gen);
  oV = vec4(v, hit);
}`;
  const FS_NULL = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

  // Particle sprites. Styles: 0 smoke (soft lit puffs), 1 fire (additive, black-body color
  // over life), 2 spark (additive streaks), 3 streak (tracer dashes along the velocity),
  // 4 sphere (lit balls with depth and ink, drawn with the solids), 5 dot (flat discs).
  const VS_PARTICLE = `#version 300 es
${G_COMMON}
${G_SLOT}
${G_FLOW}
layout(location=0) in vec4 aP; layout(location=1) in vec4 aV;
uniform mat4 uViewProj; uniform vec3 uEye; uniform vec3 uCamR; uniform vec3 uCamU;
uniform vec4 uTime; uniform vec4 uSize; uniform int uStyle; uniform vec4 uShape;
uniform vec4 uSlab; uniform vec2 uSlabZ; uniform vec3 uSlabEye; uniform vec2 uPxW;
out vec2 vUv; out float vAge; out float vRnd; out vec3 vWorld; out vec3 vCenter; out float vSize; out vec3 vVel; out float vCov;
flat out int vAlive;
// uPxW: world size of one output pixel, per unit of distance (perspective) and flat (orthographic).
// uShape: trail (seconds of path behind the head), width (world units, 0 = from size), ribbon segments, part shadow.
// uSlab: camera forward (w = 0 for no slab); uSlabZ: the depth range this draw keeps.
void main() {
  int i = gl_InstanceID;
  float k, age;
  slotAt(i, uTime.x, uLife.y, k, age);
  float life = lifeOf(i, k);
  float r = rnd(i, k, 7u);
  vAlive = 0; vCov = 1.0;
  vUv = vec2(0.0); vAge = 0.0; vRnd = r; vWorld = vec3(0.0); vCenter = vec3(0.0); vSize = 0.0; vVel = vec3(0.0);
  if (aP.w != k || age < 0.0 || age > life || r > uTime.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vAlive = 1;
  float dtR = uTime.y - uTime.x;
  vec3 p = aP.xyz + aV.xyz * dtR;
  if (dot(uSlab.xyz, uSlab.xyz) > 0.5) {
    float z = dot(p - uSlabEye, uSlab.xyz);
    if (z < uSlabZ.x || z >= uSlabZ.y) { vAlive = 0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  }
  age += dtR;
  float t01 = uLife.y <= 0.0 ? 0.0 : clamp(age / life, 0.0, 1.0);
  float size = mix(uSize.x, uSize.y, sqrt(t01)) * (1.0 + uSize.z * (rnd(i, k, 8u) - 0.5));
  vAge = t01; vCenter = p; vSize = size; vVel = aV.xyz;
  vec3 w;
  if (uStyle == 2 || uStyle == 3) {
    // A ribbon of vertex pairs along the path the particle just travelled. Tracers in a
    // flow walk the field backwards, so the ribbon bends with its streamline (and curls
    // around a wing); everything else trails straight back along its velocity. The
    // ribbon is no longer than the particle's age, so nothing shows before its birth.
    int segs = max(int(uShape.z), 1);
    int seg = gl_VertexID >> 1;
    float side = float(gl_VertexID & 1) * 2.0 - 1.0;
    float u = float(seg) / float(segs);
    float sp = length(aV.xyz);
    vec3 dir = sp > 1e-5 ? aV.xyz / sp : uCamU;
    float trailT = max(uShape.x, 1e-4);
    float back = min(u * trailT, age);
    float h = seg > 0 ? back / float(seg) : trailT / float(segs);
    vec3 q = p, tang = dir;
    if (uFlowA.x > -0.5) {
      vec3 vv = aV.xyz;
      for (int st = 0; st < 24; st++) {
        if (st >= seg) break;
        vec4 f = flowAt(q);
        vv = f.w > 0.5 ? f.xyz : vv;
        q -= vv * h;
      }
      vec4 fb = flowAt(q);
      vec3 vt = fb.w > 0.5 ? fb.xyz : vv;
      tang = length(vt) > 1e-7 ? normalize(vt) : dir;
    } else {
      q = p - dir * sp * back;
    }
    vec3 toEye = normalize(uEye - q);
    vec3 sideV = cross(tang, toEye);
    sideV = length(sideV) > 1e-5 ? normalize(sideV) : uCamR;
    float wd = uShape.y > 0.0 ? uShape.y : size * 0.3;
    // Never thinner than about 1.5 output pixels: a thinner ribbon is drawn at that width
    // and faded by the share of it it really covers, so it stays smooth instead of breaking up.
    float px = uPxW.x * length(uEye - q) + uPxW.y, wMin = 1.5 * px;
    vCov = min(1.0, wd / wMin);
    wd = max(wd, wMin);
    float taper = uStyle == 3 ? (1.0 - 0.75 * u) * smoothstep(0.0, 0.08, 1.0 - u) : 1.0 - 0.7 * u;
    w = q + sideV * side * wd * 0.5 * taper;
    vUv = vec2(side, u);
  } else {
    vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
    float ang = uStyle == 0 ? r * 6.2831853 + age * (r - 0.5) * 0.6 : 0.0;
    vec2 rc = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * c;
    float s = uStyle == 4 ? size * 1.25 : size * 0.5;
    w = p + (uCamR * rc.x + uCamU * rc.y) * s;
    vUv = uStyle == 4 ? c : rc;
    if (uStyle == 0) vUv = c;
  }
  vWorld = w;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

  const FS_PARTICLE = `#version 300 es
${G_COMMON}
${G_ENV}
${G_SHADOW}
in vec2 vUv; in float vAge; in float vRnd; in vec3 vWorld; in vec3 vCenter; in float vSize; in vec3 vVel; in float vCov;
flat in int vAlive;
uniform int uStyle; uniform vec4 uShape; uniform vec3 uEye; uniform vec3 uCamR; uniform vec3 uCamU; uniform mat4 uView;
uniform sampler2D uDepth; uniform vec2 uDepthScale;
uniform vec3 uColA; uniform vec3 uColB; uniform vec4 uColorBy; uniform vec4 uHeatP; uniform vec4 uFade;
uniform vec3 uLight; uniform vec3 uKeyCol; uniform vec4 uPtPos[2]; uniform vec3 uPtCol[2]; uniform vec4 uLook;
out vec4 o;
vec3 colorAt() {
  float t = uColorBy.x > 1.5 ? clamp((length(vVel) - uColorBy.y) / max(uColorBy.z - uColorBy.y, 1e-6), 0.0, 1.0) : (uColorBy.x > 0.5 ? vAge : 0.0);
  return mix(uColA, uColB, t);
}
void main() {
  if (vAlive == 0) discard;
  float sceneZ = linDepth(texture(uDepth, gl_FragCoord.xy * uDepthScale).r);
  float fragZ = -(uView * vec4(vWorld, 1.0)).z;
  if (fragZ > sceneZ) discard;
  float soft = clamp((sceneZ - fragZ) / max(uFade.z, 1e-5), 0.0, 1.0);
  float life = smoothstep(0.0, max(uFade.x, 1e-4), vAge) * (1.0 - smoothstep(1.0 - max(uFade.y, 1e-4), 1.0, vAge));
  float d2 = dot(vUv, vUv);
  if (uStyle == 0) {
    // Smoke: a puff of two noise octaves, lit as a small volume. Density toward the light
    // self-shadows the puff (bright on the lit side, dark underneath), the scene's shadow
    // map darkens smoke under the machine, and when the light is behind the puff its thin
    // edges glow (forward scattering). Hot soot (glow > 0) emits by black-body color and
    // cools along its life, so fire turns into smoke in one system.
    vec3 sd = vec3(vRnd * 13.0, vRnd * 7.0, vRnd * 29.0);
    float n1 = vnoise(vec3(vUv * 1.8 + sd.x, sd.y + vAge * 1.5));
    float n2 = vnoise(vec3(vUv * 3.9 + sd.z, sd.x + vAge * 2.3)) * 0.5;
    float puff = smoothstep(1.0, 0.12, d2 + 0.45 * n1 + 0.22 * n2);
    float a = puff * life * soft * uFade.w;
    if (a < 0.002) discard;
    vec3 toEye = normalize(uEye - vCenter);
    vec3 nrm = normalize(uCamR * vUv.x + uCamU * vUv.y + toEye * sqrt(max(1.0 - d2, 0.05)));
    vec2 uvL = vUv + vec2(dot(uLight, uCamR), dot(uLight, uCamU)) * 0.55;
    float dL = smoothstep(1.0, 0.12, dot(uvL, uvL) + 0.45 * vnoise(vec3(uvL * 1.8 + sd.x, sd.y + vAge * 1.5)));
    float selfSh = 1.0 - 0.55 * dL * puff;
    float vis = mix(1.0, shadowAt(vCenter, vec3(0.0, 1.0, 0.0)), uShape.w);
    float mu = max(dot(-toEye, uLight), 0.0);
    float fwd = mu * mu * mu * mu * (1.0 - puff) * 1.6;
    vec3 alb = toLin(colorAt());
    float ndl = max(dot(nrm, uLight), 0.0);
    vec3 lit = envDiff(nrm) * uLook.x * (1.0 - 0.25 * puff)
             + uKeyCol * ((0.25 + 0.75 * ndl) * selfSh + fwd) * vis / PI;
    for (int i = 0; i < 2; i++) {
      if (uPtPos[i].w <= 0.0) continue;
      vec3 d = uPtPos[i].xyz - vCenter;
      float att = 1.0 / (1.0 + dot(d, d) / (uPtPos[i].w * uPtPos[i].w));
      vec3 ld = normalize(d);
      // Smoke between the camera and a flame glows with the light passing through it.
      float through = pow(max(dot(-toEye, ld), 0.0), 4.0) * (1.0 - 0.7 * puff) * 2.5;
      lit += uPtCol[i] * att * (0.4 + 0.6 * max(dot(nrm, ld), 0.0) + through) / PI;
    }
    float T = mix(uHeatP.x, uHeatP.y, vAge);
    vec3 emit = blackbody(T) * glowOf(T) * uHeatP.w * (0.6 + 0.4 * puff);
    vec3 col = toSrgb(tonemap(alb * lit * uLook.z + emit));
    o = vec4(col * a + emit * a * uLook.w * 0.15, a);
  } else if (uStyle == 1 || uStyle == 2) {
    float T = mix(uHeatP.x, uHeatP.y, vAge);
    vec3 e = blackbody(T) * glowOf(T) * uHeatP.z;
    float shape = uStyle == 1 ? pow(max(1.0 - d2, 0.0), 1.5) * (0.75 + 0.25 * vnoise(vec3(vUv * 2.5, vRnd * 9.0 + vAge * 3.0)))
                              : (1.0 - vUv.x * vUv.x) * (1.0 - vUv.y) * (1.0 - vUv.y);
    float a = shape * life * soft * (uStyle == 2 ? vCov : 1.0);
    if (a < 0.002) discard;
    vec3 c = toSrgb(tonemap(e)) * a;
    o = vec4(c + e * a * uLook.w * 0.15, 0.0);
  } else if (uStyle == 3) {
    // Air tracer: a thin ribbon with a brighter core, fading toward its tail.
    float ax = abs(vUv.x);
    float across = 1.0 - smoothstep(0.3, 1.0, ax);
    float core = 1.0 - smoothstep(0.0, 0.55, ax);
    float along = (1.0 - vUv.y) * (1.0 - 0.5 * vUv.y);
    float a = across * along * life * uFade.w * vCov;
    if (a < 0.003) discard;
    vec3 c = colorAt();
    o = vec4(mix(c, mix(c, vec3(1.0), 0.35), core) * a, a);
  } else {
    float edge = 1.0 - smoothstep(0.8, 1.0, sqrt(d2));
    float a = edge * life * uFade.w;
    if (a < 0.003) discard;
    o = vec4(colorAt() * a, a);
  }
}`;

  // Sphere particles are drawn with the solids: an exact ray-sphere hit per pixel, porcelain
  // shading, real depth, and a part id, so molecules get ink outlines and occlude properly.
  const FS_PSPHERE = `#version 300 es
${G_COMMON}
${G_SHADOW}
in vec2 vUv; in float vAge; in float vRnd; in vec3 vWorld; in vec3 vCenter; in float vSize; in vec3 vVel;
flat in int vAlive;
uniform vec3 uEye; uniform mat4 uViewProj; uniform vec3 uLight; uniform float uId; uniform float uOrthoCam; uniform vec3 uCamF;
uniform vec3 uColA; uniform vec3 uColB; uniform vec4 uColorBy; uniform float uPartShadow;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
void main() {
  if (vAlive == 0) discard;
  vec3 ro = uOrthoCam > 0.5 ? vWorld - uCamF * 1e3 : uEye;
  vec3 rd = uOrthoCam > 0.5 ? uCamF : normalize(vWorld - uEye);
  vec3 oc = ro - vCenter;
  float b = dot(oc, rd), c = dot(oc, oc) - vSize * vSize, h = b * b - c;
  if (h < 0.0) discard;
  float t = -b - sqrt(h);
  vec3 P = ro + rd * t, N = normalize(P - vCenter), V = -rd;
  float tc = uColorBy.x > 1.5 ? clamp((length(vVel) - uColorBy.y) / max(uColorBy.z - uColorBy.y, 1e-6), 0.0, 1.0) : 0.0;
  vec3 base = mix(uColA, uColB, tc);
  float vis = mix(1.0, shadowAt(P, N), uPartShadow);
  float ndl = dot(N, uLight);
  float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
  wrap = wrap * wrap * (3.0 - 2.0 * wrap);
  vec3 col = mix(base * vec3(0.84, 0.86, 0.90), base, wrap * vis);
  col *= 0.92 + 0.08 * (0.5 + 0.5 * N.y);
  col += vec3(pow(max(dot(N, normalize(uLight + V)), 0.0), 40.0) * 0.08) * vis;
  col = mix(col, vec3(1.0), pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0) * 0.1);
  vec4 clip = uViewProj * vec4(P, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
  oColor = vec4(col, 1.0);
  oNormal = vec4(N * 0.5 + 0.5, uId);
}`;

  // The plume: march the view ray through a cylinder around the jet, stopping at the first
  // solid (read from the depth buffer), adding emission and absorbing along the way.
  const FS_PLUME = `#version 300 es
${G_COMMON}
in vec3 vWorld;
uniform mat4 uInvModel; uniform vec3 uEye; uniform mat4 uView; uniform vec3 uCamF;
uniform sampler2D uDepth; uniform vec2 uDepthScale;
uniform vec4 uP0; uniform vec4 uP1; uniform vec4 uP2; uniform vec4 uP3; uniform vec4 uP4; uniform vec4 uLook;
uniform vec4 uProf[24]; uniform vec4 uCut;
out vec4 o;
// uP0: exit radius, length, bound radius, time. uP1: throttle, cell length, core T, steps.
// uP2: spread, turbulence, intensity, fuel. uP3: world-to-local scale, flow speed, expansion, _.
// uP4: distance to the surface the jet hits (0 = none), splash radius, inner-flame stations, _.
// uProf: inner flame stations (radius, distance from the origin, temperature).
float fbm(vec3 x) { return 0.55 * vnoise(x) + 0.3 * vnoise(x * 2.03 + 17.0) + 0.15 * vnoise(x * 4.1 + 41.0); }
// Emission by temperature, normalized so 2500 K gives 1 and compressed so the cooler tail
// of the plume still shows instead of the exit alone blowing out.
vec3 emitAt(float T) { return blackbody(T) * pow(glowOf(T) / 35.5, 0.6); }
// Radius and temperature of the inner flame at distance s from its origin (-1 past the end).
float profAt(float s, out float T) {
  int n = int(uP4.z + 0.5);
  vec4 a = uProf[0];
  T = a.z;
  if (s <= a.y) return a.x;
  for (int i = 1; i < 24; i++) {
    if (i >= n) break;
    vec4 b = uProf[i];
    if (s <= b.y) { float f = (s - a.y) / max(b.y - a.y, 1e-6); T = mix(a.z, b.z, f); return mix(a.x, b.x, f); }
    a = b;
  }
  T = a.z;
  return -1.0;
}
// The burning gas inside a chamber and nozzle: it fills the duct to its wall, hottest in the
// middle, cooling as it expands; seen through a section cut.
vec3 flameField(vec3 q, out float sigma) {
  float s = -q.y, r = length(q.xz), T;
  float R = profAt(s, T);
  sigma = 0.0;
  if (R <= 0.0) return vec3(0.0);
  vec3 nq = vec3(q.x, q.y + uP0.w * uP3.y, q.z) / max(uP0.x, 1e-6) * 1.8;
  float n = uP2.y > 0.0 ? fbm(nq) : 0.5;
  float rr = r / max(R, 1e-6);
  float body = smoothstep(1.0, 0.86, rr + 0.1 * (n - 0.5));
  float Tl = T * (1.0 - 0.22 * rr * rr) * (0.93 + 0.14 * n);
  sigma = body * 0.04;
  return emitAt(Tl) * body * uP2.z * uP1.x * 0.3;
}
vec3 field(vec3 q, out float sigma) {
  float r0 = uP0.x, L = uP0.y, lam = uP1.y, thr = uP1.x, ex = uP3.z;
  float s = -q.y, r = length(q.xz);
  float imp = uP4.x;
  sigma = 0.0;
  if (imp > 0.0 && s > imp) return vec3(0.0);
  // A jet that hits a surface keeps its strength down to it.
  if (imp > 0.0) L = max(L, imp * 1.5);
  // Mean radius: the spreading jet, pushed out (under-expanded) or necked in
  // (over-expanded) by the exit pressure, settling back over a few cells.
  float R = r0 * (1.0 + uP2.x * s / r0);
  R *= 1.0 + 0.4 * (ex - 1.0) * smoothstep(0.0, lam * 0.6, s) * exp(-s / (lam * 3.0));
  // Near the surface the jet slows and bulges (the stagnation bubble).
  float nearImp = imp > 0.0 ? smoothstep(imp - 2.5 * r0, imp, s) : 0.0;
  R *= 1.0 + 1.4 * nearImp * nearImp;
  float cells = s / lam;
  float ripple = 0.1 + 0.22 * min(abs(ex - 1.0), 1.0);
  R *= 1.0 - ripple * (0.5 + 0.5 * cos(6.2831853 * cells)) * exp(-s / (lam * 4.0));
  // The mixing layer: eddies grow with distance and the layer thickens.
  float grow = 1.0 + 0.6 * s / L;
  float turb = uP2.y * smoothstep(0.0, lam * 1.5, s) * (0.6 + 0.4 * s / L);
  vec3 nq = vec3(q.x, q.y + uP0.w * uP3.y, q.z) / (r0 * grow) * 1.4;
  float n = turb > 0.001 ? fbm(nq) : 0.0;
  float rr = r / R + turb * n * 0.45;
  float body = smoothstep(1.08, 0.5, rr) * smoothstep(0.0, 0.08 * r0, s);
  float fade = 1.0 - smoothstep(0.55 * L, L, s);
  float T = uP1.z * (0.62 + 0.38 * exp(-s / (L * 0.5))) * (1.0 - 0.3 * smoothstep(0.35, 1.0, rr));
  // Shock diamonds: strong when the exit pressure is off ambient, faint when matched.
  float diaGain = clamp(0.3 + 1.4 * abs(ex - 1.0), 0.3, 1.0);
  // Only the two cells nearest this point can contribute (each is a narrow Gaussian).
  float dia = 0.0, rr2 = pow(r / (0.38 * R), 2.0);
  float kc = floor(s / lam - 0.62);
  for (int j = 0; j < 2; j++) {
    float k = kc + float(j);
    if (k < 0.0 || k > 6.0) continue;
    float dk = (s - (k + 0.62) * lam) / (0.14 * lam);
    dia += exp(-dk * dk - rr2) * pow(0.74, k);
  }
  dia *= diaGain;
  float coreLen = lam * 0.85;
  float core = s < coreLen ? exp(-pow(r / (0.8 * r0 * (1.0 - s / coreLen) + 1e-3), 2.0)) : 0.0;
  int fuel = int(uP2.w + 0.5);
  vec3 bb = emitAt(T);
  vec3 tint = fuel == 1 ? vec3(0.55, 0.62, 1.0) : fuel == 2 ? vec3(0.75, 0.62, 1.0) : vec3(1.0);
  float bodyGain = fuel == 2 ? 0.1 : fuel == 1 ? 0.4 : 1.0;
  vec3 e = bb * body * fade * bodyGain * mix(vec3(1.0), tint, 0.6);
  vec3 hot = emitAt(T * 1.25);
  e += hot * dia * (fuel == 2 ? 1.2 : 0.8) * fade * mix(vec3(1.0), tint, 0.5);
  e += hot * core * 1.2 * mix(vec3(1.0), tint, 0.7);
  // Afterburning: fuel-rich exhaust meets air in the shear layer and burns as a slightly
  // wider, cooler, ragged orange sheath that starts a cell or so downstream.
  float R2 = R * 1.3 * (1.0 + 0.6 * s / L);
  float n3 = turb > 0.001 ? fbm(nq * 0.6 + vec3(7.0, 0.0, 3.0)) : 0.0;
  float sheath = smoothstep(1.2, 0.55, r / R2 + 0.6 * n3) * (1.0 - body) * smoothstep(lam * 0.9, lam * 2.5, s) * fade;
  float Ta = 1600.0 + 250.0 * n3;
  float abGain = fuel == 3 ? 1.1 : fuel == 1 ? 0.45 : fuel == 2 ? 0.1 : 0.85;
  e += emitAt(Ta) * sheath * abGain * 0.35;
  // Soot: kerosene and solid exhaust absorb; hydrogen and methane are nearly clear.
  float soot = fuel == 0 ? 0.35 : fuel == 3 ? 0.8 : 0.08;
  sigma = (body * soot + sheath * soot * 0.5) * fade * (0.6 + 0.4 * smoothstep(0.3 * L, L, s));
  // Splash: the flow turns along the surface as a hot, thin, ragged sheet that cools outward.
  if (imp > 0.0) {
    float above = imp - s, Rs = uP4.y;
    float n4 = turb > 0.001 ? fbm(vec3(q.x, q.z, uP0.w * uP3.y * 0.6) / r0 * 0.9) : 0.5;
    float hs = r0 * (0.35 + 0.5 * smoothstep(0.0, Rs, r));
    float sheet = exp(-pow(above / max(hs, 1e-3), 2.0)) * (1.0 - smoothstep(Rs * (0.55 + 0.45 * n4), Rs, r)) * step(0.0, above);
    float Ts = 2100.0 - 900.0 * smoothstep(0.0, Rs, r) + 200.0 * n4;
    e += emitAt(Ts) * sheet * (fuel == 2 ? 0.25 : 1.0) * 0.6 / max(uP2.z * thr * 0.55, 1e-4) * thr;
    sigma += sheet * soot * 0.9;
  }
  return e * uP2.z * thr * 0.55;
}
void main() {
  vec3 rdw = normalize(vWorld - uEye);
  vec3 eye = uEye;
  if (uOrtho > 0.5) { rdw = uCamF; eye = vWorld - rdw * dot(vWorld - uEye, rdw); }
  vec3 ro = (uInvModel * vec4(eye, 1.0)).xyz;
  vec3 rd = mat3(uInvModel) * rdw;
  float Rb = uP0.z, L = uP0.y;
  float a = dot(rd.xz, rd.xz), b = 2.0 * dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - Rb * Rb;
  float t0 = -1e9, t1 = 1e9;
  if (a > 1e-9) {
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0) discard;
    float sq = sqrt(disc);
    t0 = (-b - sq) / (2.0 * a); t1 = (-b + sq) / (2.0 * a);
  } else if (c > 0.0) discard;
  if (abs(rd.y) > 1e-9) {
    float ya = (0.0 - ro.y) / rd.y, yb = (-L - ro.y) / rd.y;
    t0 = max(t0, min(ya, yb)); t1 = min(t1, max(ya, yb));
  } else if (ro.y > 0.0 || ro.y < -L) discard;
  t0 = max(t0, 0.0);
  float sceneZ = linDepth(texture(uDepth, gl_FragCoord.xy * uDepthScale).r);
  float dz = uOrtho > 0.5 ? 1.0 : dot(rdw, uCamF);
  float tScene = uOrtho > 0.5 ? sceneZ - dot(eye - uEye, uCamF) : sceneZ / max(dz, 1e-4);
  t1 = min(t1, tScene);
  if (t1 <= t0) discard;
  int steps = int(uP1.w);
  float dt = (t1 - t0) / float(steps);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 E = vec3(0.0); float Tr = 1.0;
  float scale = uP3.x;
  // Low-frequency flicker of the whole flame, from the time alone (deterministic).
  float flick = 1.0 + 0.08 * vnoise1(uP0.w * 14.0) + 0.04 * vnoise1(uP0.w * 37.0 + 5.0);
  for (int i = 0; i < 96; i++) {
    if (i >= steps || Tr < 0.01) break;
    float t = t0 + (float(i) + jit) * dt;
    vec3 q = ro + rd * t;
    if (length(q.xz) > Rb) continue;
    if (dot(uCut.xyz, eye + rdw * t) > uCut.w) continue;
    float sig;
    vec3 e = uP4.z > 0.5 ? flameField(q, sig) : field(q, sig);
    float ds = dt * scale / uP0.x;
    E += Tr * e * flick * ds;
    Tr *= exp(-sig * ds);
  }
  float alpha = 1.0 - Tr;
  vec3 col = toSrgb(tonemap(E * uLook.z));
  o = vec4(col + E * uLook.w * 0.12, alpha);
}`;

  // ---------- volumetric media (smoke, dust, steam, fire) ----------
  // A particle system with `volume` set is drawn as a continuous medium instead of sprites.
  // Each frame its particles are splatted into a 3D grid (R: density, G: hot density), a
  // second grid stores how much key light reaches each cell, and the view ray is marched
  // through the grid at part resolution: billowy detail noise erodes the edges, light
  // scatters toward the eye with a two-lobed phase, flames light it with falloff and
  // occlusion, young soot glows by black-body color, and a depth-aware upsample puts the
  // result in the effects layer without halos around solid parts.
  const VS_VSPLAT = `#version 300 es
${G_COMMON}
${G_SLOT}
layout(location=0) in vec4 aP; layout(location=1) in vec4 aV;
uniform vec4 uTime; uniform vec4 uSize; uniform vec4 uFade; uniform vec3 uVolMin; uniform vec3 uDims;
uniform float uVoxel; uniform float uSlice; uniform float uPtMax; uniform vec4 uVHeat;
out float vRv; out float vDz; out float vPs; out float vW; out float vHot;
// uFade: fade in, fade out, mass scale (count / drawn), density. uVHeat: glow, hot share of life, thinning, _.
void main() {
  int i = gl_VertexID;
  float k, age;
  slotAt(i, uTime.x, uLife.y, k, age);
  float life = lifeOf(i, k);
  float r = rnd(i, k, 7u);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0;
  vRv = 1.0; vDz = 0.0; vPs = 1.0; vW = 0.0; vHot = 0.0;
  if (aP.w != k || age < 0.0 || age > life || r > uTime.w) return;
  float dtR = uTime.y - uTime.x;
  vec3 p = aP.xyz + aV.xyz * dtR;
  age += dtR;
  float t01 = uLife.y <= 0.0 ? 0.0 : clamp(age / life, 0.0, 1.0);
  float size = mix(uSize.x, uSize.y, sqrt(t01)) * (1.0 + uSize.z * (rnd(i, k, 8u) - 0.5));
  vec3 g = (p - uVolMin) / uVoxel;
  float rv = max(size * 0.5 / uVoxel, 0.8);
  float dz = g.z - (uSlice + 0.5);
  if (abs(dz) >= rv) return;
  float rc = sqrt(rv * rv - dz * dz);
  float ps = min(2.0 * rc + 2.0, uPtMax);
  float fade = smoothstep(0.0, max(uFade.x, 1e-4), t01) * (1.0 - smoothstep(1.0 - max(uFade.y, 1e-4), 1.0, t01));
  // A puff thins as it grows (the same smoke spread over more volume); each is a little denser or thinner.
  float grow = uSize.x / max(size, 1e-6);
  vW = uFade.w * uFade.z * fade * mix(0.5, 1.5, rnd(i, k, 9u)) * pow(grow, uVHeat.z);
  vHot = uVHeat.x * (1.0 - smoothstep(0.0, max(uVHeat.y, 1e-3), t01));
  vRv = rv; vDz = dz; vPs = ps;
  gl_Position = vec4(g.xy / uDims.xy * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = ps;
}`;
  const FS_VSPLAT = `#version 300 es
precision highp float;
in float vRv; in float vDz; in float vPs; in float vW; in float vHot;
out vec4 o;
void main() {
  vec2 off = (gl_PointCoord * 2.0 - 1.0) * (vPs * 0.5);
  float q = 1.0 - (dot(off, off) + vDz * vDz) / (vRv * vRv);
  if (q <= 0.0) discard;
  float w = vW * q * q;
  o = vec4(w, w * vHot, 0.0, 0.0);
}`;
  // Key light reaching each cell: march toward the light through the coarse density.
  const FS_VLIGHT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uDens;
uniform vec3 uLDims; uniform float uSlice; uniform vec3 uLDelta; uniform float uSigmaStep; uniform int uLSteps;
uniform vec4 uPt0; uniform vec4 uPt1; uniform float uSigma; // point lights in grid coordinates (w > 0: on)
out vec4 o;
float march(vec3 p, vec3 d, int n, float sig) {
  float tau = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    if (any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0)))) break;
    tau += (1.0 - exp(-1.5 * textureLod(uDens, p, 1.0).r)) * sig;
    p += d;
  }
  return exp(-tau);
}
// R: key light reaching the cell; G, B: the share of each point light (a flame) that does.
// The point lights are marched in 12 steps straight to the light, so a cell behind smoke darkens.
float toPoint(vec3 p, vec4 L) {
  if (L.w <= 0.0) return 1.0;
  vec3 d = (L.xyz - p) / 12.0;
  return march(p + d * 0.5, d, 12, uSigma * L.w / 12.0);
}
void main() {
  vec3 p = vec3(gl_FragCoord.xy, uSlice + 0.5) / uLDims;
  o = vec4(march(p + uLDelta * 0.5, uLDelta, uLSteps, uSigmaStep), toPoint(p, uPt0), toPoint(p, uPt1), 1.0);
}`;
  const FS_VMARCH = `#version 300 es
${G_COMMON}
${G_ENV}
precision highp sampler3D;
uniform sampler3D uDens; uniform sampler3D uLightVol; uniform sampler3D uNoise;
uniform sampler2D uDepth; uniform vec2 uDepthMap;
uniform mat4 uInvVP; uniform vec3 uEye; uniform vec3 uCamF; uniform vec2 uVSize;
uniform vec3 uVolMin; uniform vec3 uVolSize; uniform float uVoxel;
uniform vec2 uSlabZ; uniform int uSteps; uniform vec4 uCut;
uniform vec4 uMed;    // extinction at full coverage (per world unit), erosion, detail frequency, ambient occlusion
uniform vec4 uMed2;   // shadow strength, powder, flame occlusion, emission-only (fire)
uniform vec3 uFlow; uniform vec3 uFlow2; uniform vec3 uAlbedo;
uniform vec3 uLight; uniform vec3 uKeyCol; uniform vec4 uPtPos[2]; uniform vec3 uPtCol[2]; uniform vec4 uLook;
uniform vec4 uHeatT;  // hot temperature, cool temperature, intensity, glow
out vec4 o;
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5); }
float cover(float d) { return 1.0 - exp(-1.5 * d); }
void main() {
  vec2 ndc = gl_FragCoord.xy / uVSize * 2.0 - 1.0;
  vec4 a = uInvVP * vec4(ndc, -1.0, 1.0), b = uInvVP * vec4(ndc, 1.0, 1.0);
  vec3 pn = a.xyz / a.w, pf = b.xyz / b.w;
  vec3 ro, rd; float zPerT, z0;
  if (uOrtho > 0.5) { ro = pn; rd = normalize(pf - pn); zPerT = 1.0; z0 = dot(pn - uEye, uCamF); }
  else { ro = uEye; rd = normalize(pf - uEye); zPerT = max(dot(rd, uCamF), 1e-4); z0 = 0.0; }
  vec3 inv = 1.0 / (abs(rd) + 1e-9) * sign(rd + 1e-12);
  vec3 ta = (uVolMin - ro) * inv, tb = (uVolMin + uVolSize - ro) * inv;
  vec3 tmn = min(ta, tb), tmx = max(ta, tb);
  float t0 = max(max(tmn.x, tmn.y), tmn.z), t1 = min(min(tmx.x, tmx.y), tmx.z);
  float sceneZ = linDepth(texture(uDepth, gl_FragCoord.xy * uDepthMap).r);
  t0 = max(t0, max((uSlabZ.x - z0) / zPerT, 0.0));
  t1 = min(t1, min((sceneZ - z0) / zPerT, (uSlabZ.y - z0) / zPerT));
  if (t1 <= t0) { o = vec4(0.0); return; }
  float ds = max((t1 - t0) / float(uSteps), uVoxel * 0.45);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float Tr = 1.0; vec3 C = vec3(0.0), Ce = vec3(0.0);
  float cosT = dot(rd, uLight);
  float phase = mix(hg(cosT, -0.25), hg(cosT, 0.6), 0.6);
  vec3 envUp = envDiff(vec3(0.0, 1.0, 0.0)) * uLook.x, envDn = envDiff(vec3(0.0, -1.0, 0.0)) * uLook.x;
  float t = t0 + jit * ds;
  for (int i = 0; i < 192; i++) {
    if (t > t1 || Tr < 0.01) break;
    vec3 p = ro + rd * t;
    float tNow = t;
    t += ds;
    if (dot(uCut.xyz, p) > uCut.w) continue;
    vec3 uvw = (p - uVolMin) / uVolSize;
    // Level 0 always: at the box's silhouette neighboring rays enter far apart, the screen-space
    // derivatives jump, and an automatic level would read the whole grid's average as a seam.
    vec2 dh = textureLod(uDens, uvw, 0.0).rg;
    // Empty space: if the coarse grid is empty here too, stride ahead three steps.
    if (dh.r < 0.003) { if (textureLod(uDens, uvw, 2.0).r < 0.002) t += 2.0 * ds; continue; }
    float cov = cover(dh.r);
    // Detail: billows eat into the thin edges, much less into the dense core.
    float nz = textureLod(uNoise, p * uMed.z + uFlow, 0.0).r * 0.62 + textureLod(uNoise, p * (uMed.z * 2.71) + uFlow2, 0.0).r * 0.38;
    float e = uMed.y * (1.0 - 0.7 * cov);
    float d = clamp((cov - (1.0 - nz) * e) / max(1.0 - (1.0 - nz) * e, 1e-3), 0.0, 1.0);
    float sigma = d * uMed.x;
    if (sigma <= 0.0) continue;
    float heat = clamp(dh.g / max(dh.r, 1e-4), 0.0, 1.0);
    float T = mix(uHeatT.y, uHeatT.x, heat);
    vec3 em = blackbody(T) * glowOf(T) * uHeatT.z * uHeatT.w * heat * (0.55 + 0.45 * nz);
    vec3 S = vec3(0.0);
    if (uMed2.w < 0.5) {
      // Single scattering plus a cheap multiple-scattering term, so thick smoke isn't black inside.
      vec4 lv = textureLod(uLightVol, uvw, 0.0);
      float tl = lv.r;
      float sh = mix(1.0, max(tl, pow(tl, 0.25) * 0.55), uMed2.x);
      float ao = exp(-textureLod(uDens, uvw, 2.0).r * uMed.w);
      float powder = mix(1.0, 1.0 - exp(-5.0 * d), uMed2.y);
      vec3 Ld = uKeyCol * sh * phase * powder / PI;
      vec3 La = mix(envDn * 0.5, envUp, clamp(0.3 + 0.7 * uvw.y, 0.0, 1.0)) * ao;
      vec3 Lp = vec3(0.0);
      for (int j = 0; j < 2; j++) {
        if (uPtPos[j].w <= 0.0) continue;
        vec3 dv = uPtPos[j].xyz - p;
        float d2 = dot(dv, dv), rr = uPtPos[j].w * uPtPos[j].w;
        float att = rr / (rr + d2); att *= att;
        float tp = j == 0 ? lv.g : lv.b;
        float occ = max(tp, pow(tp, 0.25) * 0.5);
        Lp += uPtCol[j] * att * occ * (0.35 + 0.65 * ao) * 1.5 / PI;
      }
      S = uAlbedo * (Ld + La + Lp);
    }
    float tr = exp(-sigma * ds), w = Tr * (1.0 - tr);
    C += w * (S + em);
    Ce += w * em;
    Tr *= tr;
  }
  float alpha = 1.0 - Tr;
  if (alpha < 0.002) { o = vec4(0.0); return; }
  vec3 col = toSrgb(tonemap(C / alpha * uLook.z)) * alpha;
  o = vec4(col + Ce * uLook.w * 0.15, alpha);
}`;
  // Depth-aware upsample of a part-resolution effect into the effects layer.
  const FS_VUP = `#version 300 es
${G_COMMON}
uniform sampler2D uV; uniform sampler2D uDepth; uniform vec2 uDepthScale; uniform vec2 uRatio; uniform vec2 uVMax;
out vec4 o;
void main() {
  vec2 hp = gl_FragCoord.xy * uRatio - 0.5;
  vec2 b = floor(hp), f = hp - b;
  float zc = linDepth(texture(uDepth, gl_FragCoord.xy * uDepthScale).r);
  vec4 acc = vec4(0.0), best = vec4(0.0);
  float wsum = 0.0, bestD = 1e30;
  for (int j = 0; j < 4; j++) {
    vec2 o2 = vec2(float(j & 1), float(j >> 1));
    vec2 ti = clamp(b + o2, vec2(0.0), uVMax);
    float zt = linDepth(texture(uDepth, (ti + 0.5) / uRatio * uDepthScale).r);
    float bw = (o2.x > 0.5 ? f.x : 1.0 - f.x) * (o2.y > 0.5 ? f.y : 1.0 - f.y);
    float dz = abs(zc - zt) / max(zc, 1e-4);
    float w = bw * exp(-dz * 50.0) + 1e-6;
    vec4 s = texelFetch(uV, ivec2(ti), 0);
    acc += s * w; wsum += w;
    if (dz < bestD) { bestD = dz; best = s; }
  }
  o = wsum > 1e-3 ? acc / wsum : best;
}`;


  // ---------- WebGL renderer ----------
  let R = null;
  function compile(gl, vs, fs, varyings) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
    if (varyings) gl.transformFeedbackVaryings(p, varyings, gl.SEPARATE_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const loc = gl.getUniformLocation(p, info.name);
      const entry = { loc, type: info.type, size: info.size };
      u[info.name] = entry;
      if (info.name.endsWith("[0]")) u[info.name.slice(0, -3)] = entry;
    }
    return { p, u };
  }
  // Sets a uniform by name from a number or array, whatever its GLSL type; unused names are ignored.
  function setU(P, name, v) {
    const e = P.u[name];
    if (!e || v == null) return;
    const { gl } = R, l = e.loc;
    switch (e.type) {
      case gl.FLOAT: e.size > 1 ? gl.uniform1fv(l, v) : gl.uniform1f(l, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(l, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(l, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(l, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(l, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(l, false, v); break;
      case gl.UNSIGNED_INT: gl.uniform1ui(l, v >>> 0); break;
      default: gl.uniform1i(l, v | 0);
    }
  }
  const setAll = (P, o) => { for (const k in o) setU(P, k, o[k]); };

  const PROGRAMS = {
    main: () => [VS, FS_MAIN], depth: () => [VS, FS_DEPTH], ghost: () => [VS, FS_GHOST], glass: () => [VS, FS_GLASS],
    ground: () => [VS_GROUND, FS_GROUND], composite: () => [VS_FULL, FS_COMPOSITE],
    extract: () => [VS_FULL, FS_BLOOM_EXTRACT], down: () => [VS_FULL, FS_DOWN], up: () => [VS_FULL, FS_UP],
    env: () => [VS_FULL, FS_ENV], prefilter: () => [VS_FULL, FS_PREFILTER],
    pupdate: () => [VS_PUPDATE, FS_NULL, ["oP", "oV"]], particle: () => [VS_PARTICLE, FS_PARTICLE], psphere: () => [VS_PARTICLE, FS_PSPHERE],
    plume: () => [VS, FS_PLUME],
    vsplat: () => [VS_VSPLAT, FS_VSPLAT], vlight: () => [VS_FULL, FS_VLIGHT], vmarch: () => [VS_FULL, FS_VMARCH], vup: () => [VS_FULL, FS_VUP],
  };
  // Programs compile the first time a frame needs them, so a page without particles never pays for them.
  // Compiling a program (or allocating a big target) makes a slow frame that says nothing about the
  // device; R.hitch tells the quality tiers to ignore it.
  const prog = name => R.prog[name] || ((R.hitch = true), (R.prog[name] = compile(R.gl, ...PROGRAMS[name]())));

  // One WebGL context serves every figure. It renders into an OffscreenCanvas and each
  // frame is handed over with transferToImageBitmap(), which is exact; reading a shared
  // WebGL canvas with drawImage() can return a stale buffer in some browsers.
  function renderer() {
    if (R) return R;
    const offscreen = typeof OffscreenCanvas !== "undefined";
    const canvas = offscreen ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: !offscreen, depth: true });
    if (!gl) throw new Error("this figure needs WebGL 2, which this browser doesn't provide");
    const hdr = !!gl.getExtension("EXT_color_buffer_float");
    R = {
      canvas, gl, offscreen, hdr, prog: {}, env: new Map(), cw: 0, ch: 0,
      maxSamples: Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0),
      ptMax: (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1],
      empty: gl.createVertexArray(),
      main: null, msaa: null, scene: null, fx: null, bloom: [], shadow: {},
    };
    R.colorFmt = hdr ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    const sampler = (cmp, filter) => {
      const s = gl.createSampler();
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, filter);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (cmp) { gl.samplerParameteri(s, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.samplerParameteri(s, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL); }
      return s;
    };
    R.sCmp = sampler(true, gl.LINEAR);
    R.sRaw = sampler(false, gl.NEAREST);
    R.dummyDepth = texture(1, 1, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    R.dummyColor = texture(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    if (canvas.addEventListener) canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); R = null; });
    return R;
  }

  function texture(w, h, internal, format, type, filter, levels = 1) {
    const { gl } = R;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (levels > 1) gl.texStorage2D(gl.TEXTURE_2D, levels, internal, w, h);
    else gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function framebuffer(colors, depth) {
    const { gl } = R;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    colors.forEach((c, i) => {
      if (c.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.RENDERBUFFER, c.rb);
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c.tex || c, c.level ?? 0);
    });
    if (depth) {
      if (depth.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth.rb);
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    }
    gl.drawBuffers(colors.length ? colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i) : [gl.NONE]);
    if (!colors.length) gl.readBuffer(gl.NONE);
    return fb;
  }
  const drop = (list, del) => list.forEach(x => x && del(x));

  // Render targets grow to the largest figure and are shared; each frame uses a corner.
  function targets(W, H, Wo, Ho, samples, needScene) {
    const { gl } = R;
    const [ci, cf, ct] = R.colorFmt;
    let M = R.main;
    if (!M || M.w < W || M.h < H) {
      if (M) { gl.deleteFramebuffer(M.fb); drop([M.color, M.normal, M.depth], t => gl.deleteTexture(t)); }
      const w = Math.max(W, M?.w ?? 0), h = Math.max(H, M?.h ?? 0);
      M = R.main = { w, h };
      M.color = texture(w, h, ci, cf, ct, gl.LINEAR);
      M.normal = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
      M.depth = texture(w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
      M.fb = framebuffer([M.color, M.normal], M.depth);
      if (R.scene) { gl.deleteFramebuffer(R.scene.fb); gl.deleteTexture(R.scene.tex); R.scene = null; }
    }
    if (needScene && (!R.scene || R.scene.w < M.w || R.scene.h < M.h)) {
      if (R.scene) { gl.deleteFramebuffer(R.scene.fb); gl.deleteTexture(R.scene.tex); }
      const tex = texture(M.w, M.h, ci, cf, ct, gl.LINEAR);
      R.scene = { w: M.w, h: M.h, tex, fb: framebuffer([tex]) };
    }
    if (samples > 1) {
      let S = R.msaa;
      if (!S || S.w < W || S.h < H || S.samples !== samples) {
        if (S) { gl.deleteFramebuffer(S.fb); drop([S.color, S.normal, S.depth], x => gl.deleteRenderbuffer(x.rb)); }
        const w = Math.max(W, S?.w ?? 0), h = Math.max(H, S?.h ?? 0);
        const rb = fmt => { const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h); return { rb: r }; };
        S = R.msaa = { w, h, samples, color: rb(ci), normal: rb(gl.RGBA8), depth: rb(gl.DEPTH_COMPONENT24) };
        S.fb = framebuffer([S.color, S.normal], S.depth);
      }
    }
    let F = R.fx;
    if (!F || F.w < Wo || F.h < Ho) {
      if (F) { gl.deleteFramebuffer(F.fb); gl.deleteTexture(F.tex); }
      const w = Math.max(Wo, F?.w ?? 0), h = Math.max(Ho, F?.h ?? 0);
      const tex = texture(w, h, ci, cf, ct, gl.LINEAR);
      F = R.fx = { w, h, tex, fb: framebuffer([tex]) };
    }
    if (R.cw < Wo || R.ch < Ho) {
      R.cw = Math.max(R.cw, Wo); R.ch = Math.max(R.ch, Ho);
      R.canvas.width = R.cw; R.canvas.height = R.ch;
    }
  }
  function bloomTargets(Wo, Ho) {
    const { gl } = R;
    const [ci, cf, ct] = R.colorFmt;
    let w = Math.ceil(Wo / 2), h = Math.ceil(Ho / 2);
    const out = [];
    for (let i = 0; i < 5 && w >= 4 && h >= 4; i++) {
      let L = R.bloom[i];
      if (!L || L.w < w || L.h < h) {
        if (L) { gl.deleteFramebuffer(L.fb); gl.deleteTexture(L.tex); }
        const tw = Math.max(w, L?.w ?? 0), th = Math.max(h, L?.h ?? 0);
        const tex = texture(tw, th, ci, cf, ct, gl.LINEAR);
        L = R.bloom[i] = { w: tw, h: th, tex, fb: framebuffer([tex]) };
      }
      out.push({ ...L, vw: w, vh: h });
      w = Math.ceil(w / 2); h = Math.ceil(h / 2);
    }
    return out;
  }

  // The environment for a look and theme, made on the GPU the first time it's needed:
  // a 512x256 lat-long source, then six prefiltered roughness levels and an irradiance map.
  function environment(kind, dark, sun) {
    const key = `${kind}|${dark ? 1 : 0}|${kind === 2 ? sun.map(v => v.toFixed(2)).join(",") : ""}`;
    let E = R.env.get(key);
    if (E) return E;
    const { gl } = R;
    const [ci, cf, ct] = R.colorFmt;
    const enc = R.hdr ? 1 : 1 / 8;
    const src = texture(512, 256, ci, cf, ct, gl.LINEAR, 9);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    let fb = framebuffer([src]);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.viewport(0, 0, 512, 256);
    const pe = prog("env");
    gl.useProgram(pe.p);
    setAll(pe, { uSize: [512, 256], uKind: kind, uDark: dark ? 1 : 0, uSun: sun, uOutScale: enc });
    gl.bindVertexArray(R.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.deleteFramebuffer(fb);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    const LEVELS = 6;
    const spec = texture(256, 128, ci, cf, ct, gl.LINEAR, LEVELS);
    gl.bindTexture(gl.TEXTURE_2D, spec);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    const irr = texture(64, 32, ci, cf, ct, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, irr);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    const pf = prog("prefilter");
    gl.useProgram(pf.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    setAll(pf, { uSrc: 0, uSrcW: 512, uScale: 1 });
    for (let l = 0; l <= LEVELS; l++) {
      const isIrr = l === LEVELS;
      const w = isIrr ? 64 : 256 >> l, h = isIrr ? 32 : 128 >> l;
      fb = framebuffer([isIrr ? irr : { tex: spec, level: l }]);
      gl.viewport(0, 0, w, h);
      setAll(pf, { uSize: [w, h], uRough: l / (LEVELS - 1), uMode: isIrr ? 1 : 0 });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.deleteFramebuffer(fb);
    }
    gl.deleteTexture(src);
    gl.bindVertexArray(null);
    E = { spec, irr, scale: 1 / enc, lod: LEVELS - 1 };
    R.env.set(key, E);
    return E;
  }

  function shadowMaps(size, glass) {
    const { gl } = R;
    const S = R.shadow;
    const make = () => {
      const t = texture(size, size, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
      return { tex: t, fb: framebuffer([], t) };
    };
    if (S.size !== size) {
      if (S.main) { gl.deleteFramebuffer(S.main.fb); gl.deleteTexture(S.main.tex); }
      if (S.glass) { gl.deleteFramebuffer(S.glass.fb); gl.deleteTexture(S.glass.tex); }
      S.main = make(); S.glass = null; S.size = size;
    }
    if (glass && !S.glass) S.glass = make();
    return S;
  }

  function upload(m) {
    const { gl } = R;
    if (m._gpu && m._gpu.gl === gl && m._gpu.version === m.version) return m._gpu;
    if (m._gpu && m._gpu.gl === gl) { gl.deleteVertexArray(m._gpu.vao); m._gpu.buffers.forEach(b => gl.deleteBuffer(b)); }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    const bp = buf(gl.ARRAY_BUFFER, m.positions);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const bn = buf(gl.ARRAY_BUFFER, m.normals);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const bi = buf(gl.ELEMENT_ARRAY_BUFFER, m.indices);
    gl.bindVertexArray(null);
    m._gpu = { gl, vao, buffers: [bp, bn, bi], count: m.indices.length, version: m.version };
    return m._gpu;
  }

  // Collects visible mesh nodes with world matrices and world-space bounds, and the
  // particle systems and plumes, which draw themselves.
  function collect(scene) {
    const items = [], fx = [];
    const walk = (node, parentM) => {
      if (!node.visible) return;
      const world = m4.multiply(parentM, node.local());
      if (node.isParticles || node.isPlume) fx.push({ node, world, center: m4.apply(world, [0, 0, 0]) });
      else if (node.mesh && node.mesh.indices.length) {
        const b = node.mesh.bounds;
        const c = m4.apply(world, b.center);
        const sx = Math.hypot(world[0], world[1], world[2]), sy = Math.hypot(world[4], world[5], world[6]), sz = Math.hypot(world[8], world[9], world[10]);
        items.push({ node, world, center: c, radius: b.radius * Math.max(sx, sy, sz) });
      }
      for (const c of node.children) walk(c, world);
    };
    walk(scene, m4.identity());
    items.fx = fx;
    return items;
  }

  function sceneBounds(items) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const it of items) {
      const b = it.node.mesh.bounds;
      for (let i = 0; i < 8; i++) {
        const p = m4.apply(it.world, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
      }
    }
    if (!items.length) return { min: [-1, -1, -1], max: [1, 1, 1], center: [0, 0, 0], radius: 1 };
    const center = v3.lerp(min, max, 0.5);
    return { min, max, center, radius: Math.max(1e-3, v3.dist(min, max) / 2) };
  }

  const orbitDir = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

  // Frames the scene's bounding box as seen from one direction: centers it and
  // finds the distance (or ortho half-height) at which it fills `margin` of the view.
  function frameFit(bounds, dir, fov, aspect, margin, fixedTarget) {
    const z = v3.norm(dir);
    let x = v3.cross([0, 1, 0], z);
    if (v3.len(x) < 1e-6) x = v3.cross([0, 0, 1], z);
    x = v3.norm(x);
    const y = v3.cross(z, x);
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push([i & 1 ? bounds.max[0] : bounds.min[0], i & 2 ? bounds.max[1] : bounds.min[1], i & 4 ? bounds.max[2] : bounds.min[2]]);
    let target = fixedTarget;
    if (!target) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const r = v3.sub(c, bounds.center), px = v3.dot(r, x), py = v3.dot(r, y);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      target = v3.add(bounds.center, v3.add(v3.scale(x, (x0 + x1) / 2), v3.scale(y, (y0 + y1) / 2)));
    }
    const t = Math.tan(fov / 2);
    let distance = 0, half = 0;
    for (const c of corners) {
      const r = v3.sub(c, target), vx = Math.abs(v3.dot(r, x)), vy = Math.abs(v3.dot(r, y)), vz = v3.dot(r, z);
      half = Math.max(half, vy / margin, vx / (aspect * margin));
      if (fov > 0) distance = Math.max(distance, vz + vx / (t * aspect * margin), vz + vy / (t * margin));
    }
    if (!(fov > 0)) distance = bounds.radius * 4;
    return { target, distance: Math.max(distance, bounds.radius * 0.5), half: Math.max(half, 1e-3) };
  }

  // Camera from orbit angles. yaw/pitch match g.view3d: positive pitch looks from above.
  // Unless distance (and target) are given, the scene is framed once from the first
  // view and that framing is kept, so turning the view doesn't make it zoom in and out.
  function camera(cam, scene, bounds, aspect) {
    const fovDeg = cam.fov ?? 28;
    const fov = (fovDeg * Math.PI) / 180;
    const yaw = cam.yaw ?? -0.6, pitch = cam.pitch ?? 0.4;
    const dir = orbitDir(yaw, pitch);
    const margin = cam.margin ?? 0.86;
    let target = cam.target, distance = cam.distance, half = cam.half;
    if (distance == null || target == null || (!(fov > 0) && half == null)) {
      const key = `${aspect.toFixed(2)}|${fovDeg}|${margin}|${cam.target ? cam.target.join(",") : "auto"}`;
      if (cam.fit === "always" || !scene._fit || scene._fit.key !== key) {
        scene._fit = { key, ...frameFit(bounds, cam.fitFrom ? orbitDir(cam.fitFrom.yaw, cam.fitFrom.pitch) : dir, fov, aspect, margin, cam.target) };
      }
      target = target ?? scene._fit.target;
      distance = distance ?? scene._fit.distance;
      half = half ?? scene._fit.half;
    }
    const zoom = cam.zoom ?? 1;
    if (fov > 0) distance /= zoom;
    const eye = v3.add(target, v3.scale(dir, distance));
    const view = m4.lookAt(eye, target, [0, 1, 0]);
    const reach = v3.dist(target, bounds.center) + bounds.radius * (cam.reach ?? 1);
    const near = Math.max(distance - reach * 1.5, distance * 0.02), far = distance + reach * 1.5;
    let proj, worldPerPx, tanHalf;
    if (fov > 0) {
      proj = m4.perspective(fov, aspect, near, far);
      worldPerPx = 2 * distance * Math.tan(fov / 2);
      tanHalf = [Math.tan(fov / 2) * aspect, Math.tan(fov / 2)];
    } else {
      const hh = half / zoom;
      proj = m4.ortho(-hh * aspect, hh * aspect, -hh, hh, near, far);
      worldPerPx = 2 * hh;
      tanHalf = [hh * aspect, hh];
    }
    const forward = v3.norm(v3.sub(target, eye));
    return { eye, target, view, proj, vp: m4.multiply(proj, view), near, far, ortho: !(fov > 0), worldPerPx, distance, tanHalf, forward };
  }

  // Camera-locked light directions (view space to world), or the scene's fixed key.
  function lightDir(scene, cam) {
    if (Array.isArray(scene.light)) return v3.norm(scene.light);
    const inv = m4.invert(cam.view);
    return v3.norm(m4.applyDir(inv, [-0.45, 0.75, 0.55]));
  }
  const viewToWorld = (cam, d) => v3.norm(m4.applyDir(m4.invert(cam.view), d));

  // ---------- particles on the GPU ----------
  // Transform feedback ping-pongs two buffer sets: each step reads one and writes the other.
  function particleGPU(sys, n) {
    const { gl } = R;
    let G = sys._gpu;
    if (G && G.gl === gl && G.count === sys.count) return G;
    const count = sys.count;
    G = sys._gpu = { gl, count, sets: [], cur: 0 };
    for (let s = 0; s < 2; s++) {
      const p = gl.createBuffer(), v = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, p); gl.bufferData(gl.ARRAY_BUFFER, count * 16, gl.DYNAMIC_COPY);
      gl.bindBuffer(gl.ARRAY_BUFFER, v); gl.bufferData(gl.ARRAY_BUFFER, count * 16, gl.DYNAMIC_COPY);
      const vao = divisor => {
        const a = gl.createVertexArray();
        gl.bindVertexArray(a);
        gl.bindBuffer(gl.ARRAY_BUFFER, p); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, divisor);
        gl.bindBuffer(gl.ARRAY_BUFFER, v); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, divisor);
        gl.bindVertexArray(null);
        return a;
      };
      G.sets.push({ p, v, update: vao(0), draw: vao(1) });
    }
    G.tf = gl.createTransformFeedback();
    if (sys._samples) {
      const S = sys._samples, N = S.length / 6, rows = Math.ceil(N / 1024) * 2, data = new Float32Array(1024 * rows * 4);
      for (let j = 0; j < N; j++) {
        const x = j % 1024, y = Math.floor(j / 1024) * 2;
        data.set([S[j * 6], S[j * 6 + 1], S[j * 6 + 2], 1], (y * 1024 + x) * 4);
        data.set([S[j * 6 + 3], S[j * 6 + 4], S[j * 6 + 5], 0], ((y + 1) * 1024 + x) * 4);
      }
      G.samples = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, G.samples);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1024, rows, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      G.nSamples = N;
    }
    return G;
  }
  // A buffer the CPU integrator's state is copied into each frame, laid out like the GPU's.
  function particleCPUBuffer(sys) {
    const { gl } = R;
    let G = sys._cpuGpu;
    if (G && G.gl === gl && G.count === sys.count) return G;
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, sys.count * 32, gl.DYNAMIC_DRAW);
    const a = gl.createVertexArray();
    gl.bindVertexArray(a);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(1, 1);
    const pts = gl.createVertexArray();
    gl.bindVertexArray(pts);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    G = sys._cpuGpu = { gl, count: sys.count, buffer: b, draw: a, points: pts };
    return G;
  }
  const SHAPE_ID = { point: 0, disk: 1, ring: 2, cone: 3, sphere: 4, box: 5, line: 6, mesh: 7 };
  function emitterUniforms(sys) {
    const E = sys.emitter, sp = E.speed ?? 1, s = Array.isArray(sp) ? sp : [sp, sp];
    const along = E.along === "normal" ? 1 : E.along === "radial" ? 2 : 0;
    const pos = E.position || [0, 0, 0];
    const end = E.shape === "line" ? (E.to || [0.5, 0, 0]) : E.size || [1, 1, 1];
    const start = E.shape === "line" ? (E.from || pos) : pos;
    return {
      uEm0: [SHAPE_ID[E.shape] ?? 0, E.radius ?? 0.5, E.shape === "cone" ? (E.angle ?? 0.4) : (E.thickness ?? 0), E.rake | 0],
      uEm1: [...start, E.spread ?? 0],
      uEm2: [...(E.direction || [0, 1, 0]), s[0]],
      uEm3: [s[1], E.thermal ?? 0, along, E.surface ? 1 : 0],
      uEm4: [...end, sys._samples ? sys._samples.length / 6 : 0],
    };
  }
  // Flow-field uniforms; a tube flow's station table goes to texture unit 11 as a float texture.
  function flowUniforms(fl) {
    const u = {
      uFlowA: fl ? [fl.kind, fl.U, fl.alpha, fl.S] : [-1, 0, 0, 1],
      uFlowB: fl ? [...fl.center, fl.mid] : [0, 0, 0, 0],
      uFlowC: fl ? [fl.mu[0], fl.mu[1], fl.kind === 1 ? fl.R : fl.a, fl.gamma] : [0, 0, 0, 0],
      uFlowTex: 11,
    };
    const { gl } = R;
    gl.activeTexture(gl.TEXTURE11);
    if (fl && fl.kind === 3) {
      if (!fl._tex || fl._texGl !== gl) {
        fl._texGl = gl;
        fl._tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, fl._tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, fl.n, 2, 0, gl.RGBA, gl.FLOAT, fl.data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else gl.bindTexture(gl.TEXTURE_2D, fl._tex);
      Object.assign(u, { uFlowD: [fl.y0, fl.dy, fl.n, fl.U0], uFlowE: [fl.q[0], fl.q[1], 0, 0], uFlowM: fl.M, uFlowMI: fl.MI });
    } else gl.bindTexture(gl.TEXTURE_2D, R.dummyFloat || (R.dummyFloat = (() => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 2, 0, gl.RGBA, gl.FLOAT, new Float32Array(8)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; })()));
    gl.activeTexture(gl.TEXTURE0);
    return u;
  }
  function forceUniforms(F) {
    const u = {
      uGrav: [...F.g, F.drag], uWind: [...F.wind, F.buoyancy], uTurb: [...F.turb, 0],
      uVortA: F.vortex ? [...F.vortex.c, F.vortex.s] : [0, 0, 0, 0], uVortB: F.vortex ? [...F.vortex.a, F.vortex.core] : [0, 1, 0, 0.2],
      uVortC: [F.vortex ? F.vortex.pull : 0, F.vortex ? 1 : 0, 0, 0],
      uNAttr: F.attractors.length, uNPlane: F.planes.length, uNSph: F.spheres.length,
      uKillMin: F.kill ? [...F.kill.min, 1] : [0, 0, 0, 0], uKillMax: F.kill ? [...F.kill.max, 0] : [0, 0, 0, 0],
      ...flowUniforms(F.flow),
    };
    const attr = new Float32Array(16), attrR = [0.1, 0.1, 0.1, 0.1];
    F.attractors.forEach((a, j) => { attr.set([...a.p, a.s], j * 4); attrR[j] = a.r; });
    const pl = new Float32Array(32), plb = new Float32Array(32);
    F.planes.forEach((c, j) => { pl.set([...c.n, c.d], j * 4); plb.set([c.e, c.fr, c.u, 0], j * 4); });
    const sp = new Float32Array(16), spb = new Float32Array(16);
    F.spheres.forEach((c, j) => { sp.set([...c.c, c.r], j * 4); spb.set([c.e, c.inside, 0, 0], j * 4); });
    return Object.assign(u, { uAttr: attr, uAttrR: attrR, uPlane: pl, uPlaneB: plb, uSph: sp, uSphB: spb });
  }
  // Brings a system to its time, on the GPU unless it asked for the CPU (or measures hits).
  function stepParticles(sys, n) {
    const t = sys.time ?? sys.scene().time ?? 0;
    sys.prepare();
    if (sys.cpu || sys.measure) { sys.simulate(t, n); sys._mode = "cpu"; return; }
    sys._mode = "gpu";
    const { gl } = R;
    const G = particleGPU(sys, n);
    const P = prog("pupdate");
    const M = sys.world(), F = sys.params(), h = sys.step;
    let ready = false;
    const setup = () => {
      if (ready) return;
      ready = true;
      gl.useProgram(P.p);
      setAll(P, { uSeed: sys.seed, uLife: [sys.lifeRange[0], sys.period, 0, 0], uH: h, uEmitM: M, ...emitterUniforms(sys), ...forceUniforms(F) });
      if (G.samples) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.samples); setU(P, "uSamples", 0); }
      else { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.dummyColor); setU(P, "uSamples", 0); }
    };
    sys.advanceWith(t, n, () => {
      const init = new Float32Array(G.count * 4);
      for (let i = 0; i < G.count; i++) init[i * 4 + 3] = -1e6;
      for (const s of G.sets) { gl.bindBuffer(gl.ARRAY_BUFFER, s.p); gl.bufferSubData(gl.ARRAY_BUFFER, 0, init); gl.bindBuffer(gl.ARRAY_BUFFER, s.v); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(G.count * 4)); }
      G.cur = 0;
    }, tEnd => {
      setup();
      const src = G.sets[G.cur], dst = G.sets[1 - G.cur];
      setU(P, "uT", tEnd);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindVertexArray(src.update);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, G.tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dst.p);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, dst.v);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.bindVertexArray(null);
      G.cur = 1 - G.cur;
    });
  }
  // The draw VAO holding the current state, and the time that state is at.
  function particleSource(sys) {
    if (sys._mode === "cpu") {
      const G = particleCPUBuffer(sys), { gl } = R;
      gl.bindBuffer(gl.ARRAY_BUFFER, G.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sys._state);
      return G.draw;
    }
    return sys._gpu.sets[sys._gpu.cur].draw;
  }
  function particleColors(sys) {
    const c = sys.color ?? (sys.style === "smoke" ? (pageDark() ? "#9a9894" : "#c9c6c0") : sys.style === "streak" ? "blue" : sys.style === "sphere" ? "porcelain" : "ink");
    const pal = (typeof window !== "undefined" && window.palette) || {};
    const one = x => (ACCENTS.includes(x) ? hexRgb(pal[x] || "#888888") : colorOf(x === "ink" ? (pal.ink || "#222222") : x, true));
    const [a, b] = Array.isArray(c) ? c.map(one) : [one(c), one(c)];
    const by = sys.colorBy === "speed" ? 2 : sys.colorBy === "life" || Array.isArray(c) ? 1 : 0;
    return { uColA: a, uColB: b, uColorBy: [by, ...(sys.range || [0, 1]), 0] };
  }

  // ---------- volumetric media on the GPU ----------
  // `volume: true` (or options) on a "smoke" or "fire" system draws it as a medium (see the shaders).
  //   density   extinction scale [1]             erosion  how much billow noise eats the edges [0.6]
  //   detail    noise frequency, per world unit  flow     velocity the detail drifts with (default: wind and rise)
  //   ambient   occlusion of sky light [0.8]     shadow   key-light self-shadowing [1]
  //   powder    dark edges toward the light [0.5] occlusion  how much smoke hides flames behind it [0.25]
  //   hot       share of life the soot glows [0.3; fire 1]   thin  how fast a puff thins as it grows [1]
  //   resolution  cells along the longest side   bounds  [[x0, y0, z0], [x1, y1, z1]] (default: found by simulating)
  //   albedo    smoke color (default warm grey)
  const VDEF = { density: 1, erosion: 0.6, detail: null, flow: null, ambient: 0.8, shadow: 1, powder: 0.5, occlusion: 0.25, hot: null, thin: 1, resolution: null, bounds: null, albedo: null };
  const volumeOpts = sys => (sys.volume && (sys.style === "smoke" || sys.style === "fire") ? { ...VDEF, ...(sys.volume === true ? {} : sys.volume) } : null);
  const sizePair = sys => (Array.isArray(sys.size) ? sys.size : [sys.size, sys.size]);
  const volumeSigma = (sys, V) => (V.density * 8) / Math.max(1e-9, (sizePair(sys)[0] + sizePair(sys)[1]) / 2) * (sys.style === "fire" ? 0.35 : 1);
  // Tileable billow noise (inverted Worley, three octaves), 32³, made once.
  function noise3() {
    if (R.noise3) return R.noise3;
    const { gl } = R, N = 32, val = new Float32Array(N * N * N);
    for (const [c, w, salt] of [[4, 0.55, 1], [8, 0.3, 2], [16, 0.15, 3]]) {
      const pts = new Float32Array(c * c * c * 3);
      for (let i = 0; i < c * c * c; i++) for (let a = 0; a < 3; a++) pts[i * 3 + a] = rndU(i, salt, 40 + a, 9);
      const cs = N / c, wrap = v => ((v % c) + c) % c;
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const px = (x + 0.5) / cs, py = (y + 0.5) / cs, pz = (z + 0.5) / cs;
        const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
        let best = 9;
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ix = cx + dx, iy = cy + dy, iz = cz + dz, j = (wrap(iz) * c + wrap(iy)) * c + wrap(ix);
          const fx = ix + pts[j * 3] - px, fy = iy + pts[j * 3 + 1] - py, fz = iz + pts[j * 3 + 2] - pz;
          best = Math.min(best, fx * fx + fy * fy + fz * fz);
        }
        val[(z * N + y) * N + x] += w * (1 - Math.min(1, Math.sqrt(best)));
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of val) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const data = new Uint8Array(val.length);
    for (let i = 0; i < val.length; i++) data[i] = Math.round(((val[i] - lo) / (hi - lo || 1)) * 255);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.generateMipmap(gl.TEXTURE_3D);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
    R.noise3 = t;
    return t;
  }
  // The world box the medium lives in: given, or found by running a sample of the system on the
  // CPU over two lifetimes and padding by the largest puff. Cached until the system changes.
  function volumeBounds(sys, V) {
    if (V.bounds) return V.bounds;
    const W = sys.world();
    const key = JSON.stringify([sys.emitter, sys.forces, sys.colliders, sys.life, sys.size, sys.seed, Array.from(W)]);
    if (sys._vbKey === key) return sys._vb;
    const probe = new Particles({ count: 320, seed: sys.seed, life: sys.life, step: 1 / 15, prewarm: false, emitter: sys.emitter, forces: sys.forces, colliders: sys.colliders, kill: sys.kill, cpu: true });
    probe.matrix = W;
    const P = probe.period || 4, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const f of [0.35, 0.7, 1.05, 1.4, 1.75, 2.1]) {
      probe.simulate(P * f);
      for (const a of probe.alive()) for (let k = 0; k < 3; k++) { if (a.position[k] < min[k]) min[k] = a.position[k]; if (a.position[k] > max[k]) max[k] = a.position[k]; }
    }
    const pad = Math.max(...sizePair(sys)) * 0.55;
    if (!(min[0] <= max[0])) { const c = m4.apply(W, sys.emitter.position || [0, 0, 0]); for (let k = 0; k < 3; k++) { min[k] = c[k] - pad * 4; max[k] = c[k] + pad * 4; } }
    for (let k = 0; k < 3; k++) { const e = (max[k] - min[k]) * 0.06 + pad; min[k] -= e; max[k] += e; }
    sys._vbKey = key;
    sys._vb = [min, max];
    return sys._vb;
  }
  // Cubic cells over the box; the cell count along the longest side follows the device's tier.
  function volumeLayout(sys, V) {
    const [min, max] = volumeBounds(sys, V);
    const ext = [0, 1, 2].map(k => Math.max(1e-6, max[k] - min[k]));
    // Detail comes from the billow noise, not the grid, so a coarse grid looks nearly the same and
    // costs far less (the splat and light passes run once per slice).
    if (sys._vres == null) sys._vres = V.resolution ?? [36, 48, 60][Q.rank ?? startRank()];
    const voxel = Math.max(...ext) / sys._vres;
    const dims = ext.map(e => Math.max(4, Math.ceil(e / voxel)));
    const size = dims.map(d => d * voxel);
    return { dims, voxel, size, min: [0, 1, 2].map(k => (min[k] + max[k]) / 2 - size[k] / 2) };
  }
  function volumeGrid(sys, dims) {
    const { gl } = R;
    let G = sys._vg;
    if (G && G.gl === gl && G.dims.join() === dims.join()) return G;
    if (G && G.gl === gl) { gl.deleteTexture(G.dens); gl.deleteTexture(G.light); gl.deleteFramebuffer(G.fb); }
    const tex3 = (d, fmt, levels) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texStorage3D(gl.TEXTURE_3D, levels, fmt, d[0], d[1], d[2]);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
      return t;
    };
    const ld = dims.map(v => Math.max(4, Math.ceil(v / 2)));
    R.hitch = true;
    G = sys._vg = { gl, dims, ld, dens: tex3(dims, gl.RG16F, Math.floor(Math.log2(Math.max(...dims))) + 1), light: tex3(ld, gl.RGBA16F, 1), fb: gl.createFramebuffer() };
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, G.dens, 0, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { R.volBad = true; return null; }
    return G;
  }
  function particlePoints(sys) {
    if (sys._mode === "cpu") { particleSource(sys); return sys._cpuGpu.points; }
    return sys._gpu.sets[sys._gpu.cur].update;
  }
  // Splats the particles into the density grid slice by slice, then fills the light grid.
  function prepareVolume(sys, V, lay, L, sceneTime, pts) {
    const { gl } = R;
    const G = volumeGrid(sys, lay.dims);
    if (!G) return false;
    const [nx, ny, nz] = lay.dims;
    const t = sys._t ?? 0, tr = sys.simTime(sys.time ?? sceneTime ?? 0);
    const sz = sizePair(sys), fade = Array.isArray(sys.fade) ? sys.fade : [sys.fade, sys.fade];
    const fire = sys.style === "fire";
    const P = prog("vsplat");
    gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.fb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, nx, ny);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    setAll(P, {
      uTime: [t, Math.max(t, Math.min(tr, t + sys.step)), 0, sys.density], uLife: [sys.lifeRange[0], sys.period, 0, 0], uSeed: sys.seed,
      uSize: [sz[0], sz[1], sys.sizeJitter ?? 0.5, 0], uFade: [fade[0], fade[1], sys.count / Math.max(1, sys._drawN), sys.opacity],
      uVolMin: lay.min, uDims: lay.dims, uVoxel: lay.voxel, uPtMax: R.ptMax,
      uVHeat: [fire ? Math.max(1, sys.glow) : sys.glow, V.hot ?? (fire ? 1 : 0.3), V.thin, 0],
    });
    gl.bindVertexArray(particlePoints(sys));
    for (let z = 0; z < nz; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, G.dens, 0, z);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
      setU(P, "uSlice", z);
      gl.drawArrays(gl.POINTS, 0, sys._drawN);
    }
    gl.disable(gl.BLEND);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, G.light, 0, 0);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_3D, G.dens);
    gl.generateMipmap(gl.TEXTURE_3D);
    const PL = prog("vlight");
    gl.useProgram(PL.p);
    const [lx, ly, lz] = G.ld, diag = Math.hypot(...lay.size), ds = Math.max(lay.voxel * 1.5, diag / 60);
    // Point lights in grid coordinates; w carries the light's distance through the grid in world units.
    const pt = j => { if (!pts || !pts[j]) return [0, 0, 0, 0]; const g = pts[j].position.map((v, k) => (v - lay.min[k]) / lay.size[k]); return [...g, 1]; };
    const sig = volumeSigma(sys, V);
    setAll(PL, { uDens: 8, uLDims: G.ld, uLDelta: L.map((v, k) => (v * ds) / lay.size[k]), uSigmaStep: sig * ds, uLSteps: Math.min(64, Math.ceil(diag / ds)), uPt0: pt(0), uPt1: pt(1), uSigma: sig * diag * (V.occlusion ?? 0.25) * 2 });
    gl.viewport(0, 0, lx, ly);
    gl.bindVertexArray(R.empty);
    for (let z = 0; z < lz; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, G.light, 0, z);
      setU(PL, "uSlice", z);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }
  // The part-resolution buffer volumes are marched into; grows like the other targets.
  function volBuffer(w, h) {
    const { gl } = R;
    let B = R.vbuf;
    if (!B || B.w < w || B.h < h) {
      if (B) { gl.deleteFramebuffer(B.fb); gl.deleteTexture(B.tex); }
      const W = Math.max(w, B?.w ?? 0), H = Math.max(h, B?.h ?? 0);
      // Creating a texture binds it to the active unit; use unit 0, which every pass rebinds,
      // so the scene depth on unit 2 isn't replaced mid-pass.
      gl.activeTexture(gl.TEXTURE0);
      const tex = texture(W, H, ...R.colorFmt, gl.NEAREST);
      B = R.vbuf = { w: W, h: H, tex, fb: framebuffer([tex]) };
    }
    return B;
  }
  const volumeColor = (sys, V) => toLinear(colorOf(sys.color ?? V.albedo ?? (sys.style === "fire" ? "#333333" : "#d6d0c6"), true));

  // ---------- render ----------
  let E3stats = null;
  // Renders the scene into the shared WebGL canvas; returns a view for projection and picking.
  // outScale: output pixels per CSS pixel (the screen's density). ss: supersampling
  // factor (1 to 3); the frame is rendered ss times larger and filtered down in the
  // composite pass, so the result can be copied to the page 1:1 with no resampling.
  function render(scene, cam = {}, cssW, cssH, outScale = 1, ss = 2) {
    renderer();
    const { gl } = R;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const q = qualityFor(scene, cam, Math.max(1, Math.min(3, Math.round(ss))), now);
    ss = q.ss;
    const Wo = Math.max(1, Math.round(cssW * outScale)), Ho = Math.max(1, Math.round(cssH * outScale));
    const W = Math.max(1, Math.round(Wo * ss * q.scale)), H = Math.max(1, Math.round(Ho * ss * q.scale));
    const scale = (W / Wo) * outScale;
    const items = collect(scene);
    const fxNodes = items.fx;
    const bounds = sceneBounds(items);
    const C = camera(cam, scene, bounds, cssW / cssH);
    const look = lookOf(scene), dark = pageDark();
    const L = lightDir(scene, C);
    // cutPlane: [nx, ny, nz, d], { normal, offset }, or { facing: "camera", at, offset, level, follow }:
    // a cut through `at` (default the scene's center) that opens the side facing the viewer when
    // it is switched on, then stays fixed to the model like a real cutaway, so turning the model
    // doesn't re-slice it. follow: true re-faces the camera every frame; level: false lets the cut
    // tilt with the view instead of staying upright.
    const cpo = scene.cutPlane;
    if (!cpo || cpo.facing !== "camera") scene._cutFace = null;
    const cut = !cpo ? null : Array.isArray(cpo) ? cpo : cpo.facing === "camera" ? (() => {
      const at = cpo.at ?? bounds.center;
      let n = scene._cutFace;
      if (!n || cpo.follow) {
        const d = v3.sub(C.eye, C.target);
        n = scene._cutFace = v3.norm(cpo.level === false ? d : [d[0], 0, d[2]]);
      }
      return [...n, v3.dot(n, at) + (cpo.offset ?? 0)];
    })() : [...cpo.normal, cpo.offset ?? 0];
    const cutN = cut ? v3.norm(cut.slice(0, 3)) : null;
    const cutV = cut ? [...cutN, cut[3] / v3.len(cut.slice(0, 3))] : [0, 1, 0, 1e9];
    const hatch = (C.worldPerPx / cssH) * 7;
    const pal = (typeof window !== "undefined" && window.palette) || {};
    const hiDefault = hexRgb(pal.orange || "#d9800f");

    const mats = new Map();
    const matOf = it => { let m = mats.get(it.node); if (!m) mats.set(it.node, (m = resolveMaterial(it.node, scene.look))); return m; };
    const opaque = items.filter(it => matOf(it).kind === "opaque");
    const glassItems = items.filter(it => matOf(it).kind === "glass");
    // A glass part that wholly contains another solid is a container (a jar, a tank, a cylinder
    // around a piston): thin walls, so what's inside isn't bent into doubled copies. Prisms, lenses
    // and blocks keep refracting as solid glass. An explicit material thickness always wins.
    const worldBox = it => {
      const b = it.node.mesh.bounds, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 8; i++) { const p = m4.apply(it.world, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); } }
      return [min, max];
    };
    for (const g of glassItems) {
      const [gmin, gmax] = worldBox(g);
      g.container = items.some(it => it !== g && matOf(it).kind !== "glass" && (() => { const [a, b] = worldBox(it); return [0, 1, 2].every(k => a[k] >= gmin[k] - 1e-6 && b[k] <= gmax[k] + 1e-6); })());
    }
    const ghosts = items.filter(it => matOf(it).kind === "ghost").sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye));
    opaque.concat(glassItems).forEach((it, i) => { it.id = ((i * 97) % 254) + 1; });

    // Environment, its turn with the camera, and the light rig.
    const fwd = v3.sub(C.eye, C.target);
    let ez = v3.norm([fwd[0], 0, fwd[2]]);
    if (!Number.isFinite(ez[0]) || v3.len([fwd[0], 0, fwd[2]]) < 1e-6) ez = [0, 0, 1];
    const ex = v3.norm(v3.cross([0, 1, 0], ez));
    const envRot = new Float32Array([ex[0], 0, ez[0], ex[1], 1, ez[1], ex[2], 0, ez[2]]);
    const sunEnv = [v3.dot(L, ex), L[1], v3.dot(L, ez)];
    const env = environment(look.env, dark, sunEnv);
    const kc = look.keyColor.map(v => v * look.key), fc = look.fillColor.map(v => v * look.fill), rc = [1, 1, 1].map(v => v * look.rim);
    const fillDir = viewToWorld(C, [0.8, 0.1, 0.55]), rimDir = viewToWorld(C, [0.25, 0.5, -0.85]);
    const points = [];
    for (const f of fxNodes) if (f.node.isPlume) points.push(...f.node.glowLights());
    for (const p of scene.lights || []) points.push({ position: p.position, color: colorOf(p.color || "#ffffff", true).map(v => (v ** 2.2) * (p.intensity ?? 1)), range: p.range ?? bounds.radius });
    const ptPos = new Float32Array(8), ptCol = new Float32Array(6);
    points.slice(0, 2).forEach((p, i) => { ptPos.set([...p.position, p.range], i * 4); ptCol.set(p.color, i * 3); });
    const hasGlow = items.some(it => matOf(it).glow) || fxNodes.some(f => f.node.isPlume || (f.node.isParticles && (f.node.style === "fire" || f.node.style === "spark" || (f.node.style === "smoke" && f.node.glow > 0))));
    const bloomK = (scene.bloom === false ? 0 : typeof scene.bloom === "number" ? scene.bloom : look.bloom) * (R.hdr && q.bloom ? 1 : 0);
    const exposure = (scene.exposure ?? 1) * look.exposure;
    const lookU = [look.diffuse, look.specular, exposure, bloomK > 0 ? 0.12 : 0];
    const envU = { uEnvSpec: 3, uEnvIrr: 4, uEnvRot: envRot, uEnvInfo: [env.scale, env.lod] };
    const bindEnv = () => {
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, env.spec);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, env.irr);
    };

    // Particles step before anything is drawn (sphere particles draw with the solids).
    const tierFrac = q.particles;
    for (const f of fxNodes) if (f.node.isParticles) {
      const sys = f.node, exact = sys.quality === false || sys.measure || sys.cpu || !Number.isFinite(sys.lifeRange[1]);
      const n = Math.max(1, Math.min(sys.count, Math.ceil(sys.count * (exact ? 1 : tierFrac))));
      sys._drawN = n;
      stepParticles(sys, n);
    }
    const spheres = fxNodes.filter(f => f.node.isParticles && f.node.style === "sphere");
    // Volumetric systems splat into their grids now, before anything reads them.
    for (const f of fxNodes) {
      const sys = f.node;
      if (!sys.isParticles) continue;
      sys._volLay = null;
      const V = R.hdr && !R.volBad ? volumeOpts(sys) : null;
      if (!V) continue;
      const lay = volumeLayout(sys, V);
      if (prepareVolume(sys, V, lay, L, scene.time, points)) sys._volLay = lay;
    }

    // Shadow maps from the key light, fitted around the scene.
    const sh = scene.shadow === false ? null : typeof scene.shadow === "object" ? scene.shadow : {};
    const shadowOn = !!sh && sh.cast !== false && items.length > 0;
    let shadowU = { uShadowA: [0, 0, 0, 0], uShadowB: [0, 0, 0, 0], uShadowVP: m4.identity(), uShadowCmp: 5, uShadowRaw: 6, uShadowGlass: 7 };
    let SM = null;
    if (shadowOn) {
      const size = q.shadow;
      SM = shadowMaps(size, glassItems.length > 0);
      let Ls = L.slice();
      if (Ls[1] < 0.3) Ls = v3.norm([Ls[0], 0.3 + (0.3 - Ls[1]) * 0.2, Ls[2]]);
      const ext = bounds.radius * 1.35, ctr = bounds.center;
      const lv = m4.lookAt(v3.add(ctr, v3.scale(Ls, bounds.radius * 3)), ctr, Math.abs(Ls[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0]);
      const lp = m4.ortho(-ext, ext, -ext, ext, bounds.radius * 0.5, bounds.radius * 5.5);
      const vp = m4.multiply(lp, lv);
      const depthRange = bounds.radius * 5;
      const texelW = (2 * ext) / size;
      const soft = (sh.softness ?? 1) * look.soft;
      const lightAngle = 0.045 * soft;
      shadowU = {
        uShadowVP: vp,
        uShadowA: [1, (texelW * 0.8) / depthRange, texelW * 1.6, glassItems.length ? 0.55 : 0],
        uShadowB: [1.2 / size, Math.min(0.06, (0.012 + 0.02 * soft)), (depthRange * Math.tan(lightAngle)) / (2 * ext), 0],
        uShadowCmp: 5, uShadowRaw: 6, uShadowGlass: 7,
      };
      const P = prog("depth");
      gl.useProgram(P.p);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
      setAll(P, { uViewProj: vp, uCut: cutV });
      const pass = (fb, list) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, size, size);
        gl.clearBufferfv(gl.DEPTH, 0, [1]);
        for (const it of list) {
          if (it.node.castShadow === false) continue;
          const g = upload(it.node.mesh);
          setAll(P, { uModel: it.world, uCutOn: cut && it.node.cut ? 1 : 0 });
          gl.bindVertexArray(g.vao);
          gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
        }
      };
      pass(SM.main.fb, opaque);
      if (glassItems.length) pass(SM.glass.fb, glassItems);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindVertexArray(null);
    }
    const bindShadow = () => {
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, SM ? SM.main.tex : R.dummyDepth); gl.bindSampler(5, R.sCmp);
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, SM ? SM.main.tex : R.dummyDepth); gl.bindSampler(6, R.sRaw);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, SM && SM.glass ? SM.glass.tex : R.dummyDepth); gl.bindSampler(7, R.sCmp);
    };
    const unbindSamplers = () => { for (const u of [5, 6, 7]) gl.bindSampler(u, null); };

    const samples = q.moving && ss === 1 && q.scale >= 1 && R.maxSamples > 1 ? Math.min(q.msaa, R.maxSamples) : 0;
    // What this frame ran at, for the harness and for pages that report it.
    E3stats = { tier: q.name, moving: q.moving, ss, scale: q.scale, samples, size: [W, H], out: [Wo, Ho], triangles: items.reduce((n, it) => n + (it.node.mesh ? it.node.mesh.indices.length / 3 : 0), 0), particles: fxNodes.filter(f => f.node.isParticles).reduce((n, f) => n + (f.node._drawN || 0), 0), plumes: fxNodes.filter(f => f.node.isPlume).length };
    scene.stats = E3stats;
    targets(W, H, Wo, Ho, samples, glassItems.length > 0);
    const target = samples ? R.msaa.fb : R.main.fb;
    const partShadow = shadowOn ? (sh.parts ?? 1) * look.parts : 0;
    const common = {
      uViewProj: C.vp, uEye: C.eye, uLight: L, uCut: cutV, uSun: scene.lighting === "sun" ? 1 : 0, uHatch: hatch,
      uKeyCol: kc, uFillDir: fillDir, uFillCol: fc, uRimDir: rimDir, uRimCol: rc, uPtPos: ptPos, uPtCol: ptCol, uLook: lookU,
      uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0,
      ...envU, ...shadowU,
    };

    // Opaque pass: color, normal + part id, depth.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, W, H);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    bindEnv();
    bindShadow();
    const drawSurface = (P, it, m) => {
      const g = upload(it.node.mesh);
      const cutOn = cut && it.node.cut ? 1 : 0;
      if (cutOn) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
      const r = it.node.mesh.bounds.radius || 1, wr = it.radius || 1;
      const bb = it.node.mesh.bounds, sc = wr / r, minSide = Math.max(1e-6, Math.min(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) * sc);
      const T = m.temp;
      const tS = [0, 0, 0, 0], tT = [0, 0, 0, 0];
      if (T) T.stops.forEach(([s, t], j) => { tS[j] = s; tT[j] = t; });
      for (let j = T ? T.stops.length : 0; j < 4; j++) { tS[j] = (tS[j - 1] ?? 0) + 1; tT[j] = tT[j - 1] ?? 0; }
      const hl = it.node.highlight;
      setAll(P, {
        uModel: it.world, uNormalMat: m4.normalMatrix(it.world), uColor: m.rgb, uId: it.id / 255, uCutOn: cutOn,
        uMat: [m.physical ? 1 : 0, m.metal, m.roughness, m.clearcoat], uF0: m.f0,
        // Muscle fibers run along `fibers`: a linear grain with a little anisotropy and fine stripes.
        uBrush: m.fibers ? [...m.fibers, Math.max(m.anisotropy, 0.3)] : [...m.brushAxis, m.anisotropy],
        uDetail: m.fibers ? [1, 140 / wr, 0, 9 / r] : [m.brush, m.anisotropy > 0 ? 70 / wr : 0, m.weave ? 1 : 0, 9 / r],
        uTissue: [m.sss, m.sheen, m.fibers ? 1 : 0, 0], uSssCol: m.sssColor,
        uEmit: m.emissive, uTempAxis: [...(T ? T.axis : [0, 1, 0]), T ? T.stops.length : 0], uTempS: tS, uTempT: tT,
        uHeat: [m.heatShift != null ? 1 : 0, m.heatShift ?? 0, 0, partShadow],
        uHighlightOn: hl ? 1 : 0, uHighlight: typeof hl === "string" ? hexRgb(pal[hl] || hl) : hiDefault,
        // Water's refraction depth is its real depth (the box's smallest side), not its size.
        uOpacity: m.opacity, uGlass: [m.ior, m.thickness ?? (m.water ? minSide * 0.6 : it.container ? minSide * 0.03 : wr * 0.9), m.dispersion, m.roughness],
        uWater: m.water ? [m.water.ripples, m.water.wavelength ?? wr * 0.12, scene.time ?? 0, m.water.depth] : [0, 1, 0, 0],
      });
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
    };
    if (opaque.length) {
      const P = prog("main");
      gl.useProgram(P.p);
      setAll(P, { ...common, uEnvSpec: 3, uEnvIrr: 4 });
      for (const it of opaque) drawSurface(P, it, matOf(it));
    }
    gl.disable(gl.CULL_FACE);
    if (spheres.length) {
      const P = prog("psphere");
      gl.useProgram(P.p);
      const camR = viewToWorld(C, [1, 0, 0]), camU = viewToWorld(C, [0, 1, 0]);
      // The particle vertex shader also declares the flow table; point it at a harmless texture.
      setAll(P, { ...common, uCamR: camR, uCamU: camU, uCamF: C.forward, uOrthoCam: C.ortho ? 1 : 0, uPartShadow: partShadow, ...flowUniforms(null) });
      spheres.forEach((f, j) => {
        const sys = f.node, t = sys._t ?? 0, tr = sys.simTime(sys.time ?? scene.time ?? 0);
        const sz = Array.isArray(sys.size) ? sys.size : [sys.size, sys.size];
        setAll(P, {
          uTime: [t, Math.max(t, Math.min(tr, t + sys.step)), 0, sys.density], uLife: [sys.lifeRange[0], sys.period, 0, 0], uSeed: sys.seed,
          uSize: [sz[0], sz[1], sys.sizeJitter ?? 0, 0], uStyle: 4, uShape: [sys.trail, sys.width, 0, 0], uId: (250 - j) / 255,
          ...particleColors(sys),
        });
        gl.bindVertexArray(particleSource(sys));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sys._drawN);
      });
    }

    // Ground shadow: a contact shadow plus the key light's cast shadow, on an invisible floor.
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (sh && sh.ground !== false && items.length) {
      const ext = [(bounds.max[0] - bounds.min[0]) / 2, (bounds.max[2] - bounds.min[2]) / 2];
      const k = sh.scale ?? 1.25;
      const P = prog("ground");
      gl.useProgram(P.p);
      setAll(P, {
        ...shadowU, uViewProj: C.vp, uHalf: bounds.radius * 4,
        uCenter: [bounds.center[0], sh.y ?? bounds.min[1] - bounds.radius * 0.01, bounds.center[2]],
        uRadii: [Math.max(ext[0], ext[1] * 0.35) * k, Math.max(ext[1], ext[0] * 0.35) * k],
        uGround: [sh.opacity ?? 0.16, shadowOn ? (sh.strength ?? look.ground) * (dark ? 0.75 : 1) : 0, bounds.radius * 2.2, 0],
      });
      gl.bindVertexArray(R.empty);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Glass refracts the opaque picture, so take a copy of it first.
    if (glassItems.length) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, R.scene.fb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      const P = prog("glass");
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.scene.tex);
      setAll(P, { ...common, uScene: 0, uSceneInv: [1 / R.scene.w, 1 / R.scene.h], uSceneSize: [W, H] });
      for (const it of glassItems.sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye))) drawSurface(P, it, matOf(it));
      gl.disable(gl.CULL_FACE);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
    }
    if (ghosts.length) {
      const P = prog("ghost");
      gl.useProgram(P.p);
      setAll(P, { uViewProj: C.vp, uEye: C.eye, uLight: L, uCut: cutV });
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      for (const it of ghosts) {
        const m = matOf(it), g = upload(it.node.mesh);
        setAll(P, { uModel: it.world, uNormalMat: m4.normalMatrix(it.world), uColor: m.rgb, uOpacity: m.opacity, uCutOn: cut && it.node.cut ? 1 : 0 });
        gl.bindVertexArray(g.vao);
        gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.CULL_FACE);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    unbindSamplers();

    // MSAA: resolve color, normals and depth into the textures the later passes read.
    if (samples) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, R.msaa.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, R.main.fb);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.main.fb);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
    }

    // Effects layer at output resolution: plumes and sprite particles, back to front,
    // depth-tested by hand against the solids' depth buffer.
    // Sprites and plumes sort per node, back to front. A plume splits every particle system
    // into the sprites behind its midplane (drawn before it) and those in front (after it),
    // so smoke wraps around the flame instead of sitting on top of it.
    const plumeNodes = fxNodes.filter(f => f.node.isPlume);
    const plumeDepth = f => v3.dot(v3.sub(f.node.toWorld([0, -f.node.lengthNow * 0.5, 0]), C.eye), C.forward);
    const fxDraw = [];
    const sprites = fxNodes.filter(f => f.node.isParticles && f.node.style !== "sphere");
    if (plumeNodes.length) {
      const cuts = plumeNodes.map(f => ({ f, z: plumeDepth(f) })).sort((a, b) => b.z - a.z);
      let far = Infinity;
      for (const c of cuts) {
        for (const sp of sprites) fxDraw.push({ ...sp, slab: [c.z, far] });
        fxDraw.push(c.f);
        far = c.z;
      }
      for (const sp of sprites) fxDraw.push({ ...sp, slab: [-Infinity, far] });
    } else fxDraw.push(...sprites.sort((a, b) => v3.dist(b.center, C.eye) - v3.dist(a.center, C.eye)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.fx.fb);
    gl.viewport(0, 0, Wo, Ho);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    if (fxDraw.length) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      bindEnv();
      bindShadow();
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
      const depthScale = [(W / Wo) / R.main.w, (H / Ho) / R.main.h];
      const camR = viewToWorld(C, [1, 0, 0]), camU = viewToWorld(C, [0, 1, 0]);
      for (const f of fxDraw) {
        const node = f.node;
        if (node.isPlume) {
          // Marched into the part-resolution buffer, then upsampled by depth into the effects layer.
          const Wv = Math.max(1, Math.round(Wo * q.vscale)), Hv = Math.max(1, Math.round(Ho * q.vscale));
          const VB = volBuffer(Wv, Hv);
          gl.bindFramebuffer(gl.FRAMEBUFFER, VB.fb);
          gl.viewport(0, 0, Wv, Hv);
          gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
          const P = prog("plume");
          gl.useProgram(P.p);
          const prof = node.profile, Lp = node.lengthNow, thr = clamp01(node.throttle), imp = node.impactNow();
          const r0 = prof ? Math.max(...prof.map(st => st[0])) : node.radius;
          let Rb = prof ? r0 * 1.04 : r0 * (1 + node.spread * Lp / r0) * 1.7;
          if (imp) Rb = Math.max(Rb, node.splashRadius * 1.05);
          const proxy = R.unitCyl || (R.unitCyl = transformMesh(mesh.cylinder(1, 1, { segments: 28 }), m4.translation([0, -0.5, 0])));
          const g = upload(proxy);
          const ws = Math.hypot(f.world[0], f.world[1], f.world[2]) || 1;
          const profU = new Float32Array(96);
          if (prof) prof.slice(0, 24).forEach((st, i) => profU.set([st[0], st[1], st[2] ?? node.temperature, 0], i * 4));
          setAll(P, {
            uModel: m4.multiply(f.world, m4.scaling([Rb, Lp * 1.02, Rb])), uViewProj: C.vp, uNormalMat: m4.normalMatrix(f.world),
            uInvModel: m4.invert(f.world), uEye: C.eye, uView: C.view, uCamF: C.forward, uDepth: 2, uDepthScale: [(depthScale[0] * Wo) / Wv, (depthScale[1] * Ho) / Hv],
            uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0, uLook: lookU,
            uP0: [r0, Lp, Rb, node.time ?? scene.time ?? 0], uP1: [thr, node.cells * 2 * r0 * Math.sqrt(0.4 + 0.6 * thr) * Math.sqrt(Math.max(0.2, node.expansionNow)), node.temperature, q.steps],
            uP2: [node.spread, node.turbulence, node.intensity, FUELS[node.fuel] ?? 0], uP3: [1 / ws, node.speed * r0 * 6, node.expansionNow, 0],
            uP4: [imp, node.splashRadius, prof ? Math.min(24, prof.length) : 0, 0], uProf: profU,
            uCut: node.cut && cut ? cutV : [0, 1, 0, 1e30],
          });
          gl.disable(gl.BLEND);
          gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
          gl.bindVertexArray(g.vao);
          gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
          gl.disable(gl.CULL_FACE); gl.cullFace(gl.BACK);
          gl.bindFramebuffer(gl.FRAMEBUFFER, R.fx.fb);
          gl.viewport(0, 0, Wo, Ho);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          const PU = prog("vup");
          gl.useProgram(PU.p);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, VB.tex);
          setAll(PU, { uV: 0, uDepth: 2, uDepthScale: depthScale, uRatio: [Wv / Wo, Hv / Ho], uVMax: [Wv - 1, Hv - 1], uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0 });
          gl.bindVertexArray(R.empty);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          continue;
        }
        if (node.isParticles && node._volLay) {
          const sys = node, V = volumeOpts(sys), lay = sys._volLay, G = sys._vg;
          const Wv = Math.max(1, Math.round(Wo * q.vscale)), Hv = Math.max(1, Math.round(Ho * q.vscale));
          const VB = volBuffer(Wv, Hv);
          gl.bindFramebuffer(gl.FRAMEBUFFER, VB.fb);
          gl.viewport(0, 0, Wv, Hv);
          gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
          gl.disable(gl.BLEND);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
          const P = prog("vmarch");
          gl.useProgram(P.p);
          gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_3D, G.dens);
          gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_3D, G.light);
          gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_3D, noise3());
          const time = sys.time ?? scene.time ?? 0, sz = sizePair(sys), detail = V.detail ?? 1 / (((sz[0] + sz[1]) / 2) * 1.6);
          const Fo = sys.forces || {}, wind = Fo.wind || [0, 0, 0], rise = ((Fo.buoyancy || 0) / Math.max(Fo.drag || 1, 0.2)) * 0.5;
          const vel = V.flow ?? [wind[0] * 0.7, wind[1] * 0.7 + rise, wind[2] * 0.7];
          const temps = Array.isArray(sys.temperature) ? sys.temperature : [sys.temperature, sys.temperature];
          const fire = sys.style === "fire";
          setAll(P, {
            ...envU, uDens: 8, uLightVol: 9, uNoise: 10, uDepth: 2, uDepthMap: [(depthScale[0] * Wo) / Wv, (depthScale[1] * Ho) / Hv],
            uInvVP: m4.invert(C.vp), uEye: C.eye, uCamF: C.forward, uVSize: [Wv, Hv], uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0,
            uVolMin: lay.min, uVolSize: lay.size, uVoxel: lay.voxel, uSteps: q.vsteps,
            uSlabZ: f.slab ? [Math.max(f.slab[0], -1e30), Math.min(f.slab[1], 1e30)] : [-1e30, 1e30],
            uCut: sys.cut && cut ? cutV : [0, 1, 0, 1e30],
            uMed: [volumeSigma(sys, V), V.erosion, detail, V.ambient], uMed2: [V.shadow, V.powder, V.occlusion, fire ? 1 : 0],
            uFlow: vel.map(v => -v * time * detail), uFlow2: vel.map((v, k) => -v * time * detail * 3.4 + [0.31, 0.57 + time * 0.04, 0.13][k]),
            uAlbedo: volumeColor(sys, V), uLight: L, uKeyCol: kc, uPtPos: ptPos, uPtCol: ptCol, uLook: lookU,
            uHeatT: [temps[0], temps[1], sys.intensity, fire ? Math.max(1, sys.glow) : sys.glow],
          });
          gl.bindVertexArray(R.empty);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, R.fx.fb);
          gl.viewport(0, 0, Wo, Ho);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          const PU = prog("vup");
          gl.useProgram(PU.p);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, VB.tex);
          setAll(PU, { uV: 0, uDepth: 2, uDepthScale: depthScale, uRatio: [Wv / Wo, Hv / Ho], uVMax: [Wv - 1, Hv - 1], uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0 });
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          continue;
        }
        const sys = node, P = prog("particle");
        gl.useProgram(P.p);
        const t = sys._t ?? 0, tr = sys.simTime(sys.time ?? scene.time ?? 0);
        const ribbon = sys.style === "streak" || sys.style === "spark";
        const segs = ribbon ? Math.max(1, Math.min(24, sys.segments ?? (sys.style === "streak" ? 10 : 2))) : 1;
        const F = sys.params();
        const sz = Array.isArray(sys.size) ? sys.size : [sys.size, sys.size];
        const fade = Array.isArray(sys.fade) ? sys.fade : [sys.fade, sys.fade];
        const temps = Array.isArray(sys.temperature) ? sys.temperature : [sys.temperature, sys.temperature];
        setAll(P, {
          ...envU, uViewProj: C.vp, uView: C.view, uEye: C.eye, uCamR: camR, uCamU: camU, uDepth: 2, uDepthScale: depthScale,
          uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0, uLight: L, uKeyCol: kc, uPtPos: ptPos, uPtCol: ptCol, uLook: lookU,
          uTime: [t, Math.max(t, Math.min(tr, t + sys.step)), 0, sys.density], uLife: [sys.lifeRange[0], sys.period, 0, 0], uSeed: sys.seed,
          uSize: [sz[0], sz[1], sys.sizeJitter ?? 0.5, 0], uStyle: STYLE_ID[sys.style] ?? 0, uShape: [sys.trail, sys.width, segs, partShadow],
          uPxW: C.ortho ? [0, (2 * C.tanHalf[1]) / Ho] : [(2 * C.tanHalf[1]) / Ho, 0],
          uFade: [fade[0], fade[1], sys.soft ?? bounds.radius * 0.04, sys.opacity],
          uHeatP: [temps[0], temps[1], sys.intensity, sys.glow],
          uSlab: f.slab ? [...C.forward, 0] : [0, 0, 0, 0], uSlabZ: f.slab ? [Math.max(f.slab[0], -1e30), Math.min(f.slab[1], 1e30)] : [-1e30, 1e30], uSlabEye: C.eye,
          ...flowUniforms(F.flow),
          ...shadowU,
          ...particleColors(sys),
        });
        gl.bindVertexArray(particleSource(sys));
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, ribbon ? 2 * (segs + 1) : 4, sys._drawN);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      unbindSamplers();
    }

    // Bloom from whatever glows.
    let bloomTex = null, bloomInv = [0, 0];
    if (bloomK > 0 && hasGlow) {
      const levels = bloomTargets(Wo, Ho);
      if (levels.length) {
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        gl.bindVertexArray(R.empty);
        const Px = prog("extract");
        gl.useProgram(Px.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.main.color);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.fx.tex);
        setAll(Px, { uColor: 0, uFx: 1, uColorInv: [1 / R.main.w, 1 / R.main.h], uColorScale: [W / Wo, H / Ho], uFxInv: [1 / R.fx.w, 1 / R.fx.h], uFxOn: fxDraw.length ? 1 : 0 });
        for (const Lv of levels) { gl.bindFramebuffer(gl.FRAMEBUFFER, Lv.fb); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); }
        gl.bindFramebuffer(gl.FRAMEBUFFER, levels[0].fb);
        gl.viewport(0, 0, levels[0].vw, levels[0].vh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const Pd = prog("down");
        gl.useProgram(Pd.p);
        gl.activeTexture(gl.TEXTURE0);
        for (let i = 1; i < levels.length; i++) {
          gl.bindTexture(gl.TEXTURE_2D, levels[i - 1].tex);
          setAll(Pd, { uSrc: 0, uSrcInv: [1 / levels[i - 1].w, 1 / levels[i - 1].h] });
          gl.bindFramebuffer(gl.FRAMEBUFFER, levels[i].fb);
          gl.viewport(0, 0, levels[i].vw, levels[i].vh);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        const Pu = prog("up");
        gl.useProgram(Pu.p);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (let i = levels.length - 1; i > 0; i--) {
          gl.bindTexture(gl.TEXTURE_2D, levels[i].tex);
          setAll(Pu, { uSrc: 0, uSrcInv: [1 / levels[i].w, 1 / levels[i].h], uWeight: 1 });
          gl.bindFramebuffer(gl.FRAMEBUFFER, levels[i - 1].fb);
          gl.viewport(0, 0, levels[i - 1].vw, levels[i - 1].vh);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.disable(gl.BLEND);
        bloomTex = levels[0].tex;
        bloomInv = [0.5 / levels[0].w, 0.5 / levels[0].h];
      }
    }

    // Composite with ink outlines into the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, R.cw, R.ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.viewport(0, 0, Wo, Ho);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const cp = prog("composite");
    gl.useProgram(cp.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.main.color);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, R.main.normal);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, R.main.depth);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, R.fx.tex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, bloomTex || R.fx.tex);
    const v = C.view;
    // Shimmer zones: behind every lit plume, plus any in scene.shimmer ({ from, to, radius: [r0, r1], strength }).
    const shimU = new Float32Array(16), shimR = new Float32Array(16);
    let shimN = 0;
    const toPx = w => { const c = m4.project(C.vp, w); return [(c[0] * 0.5 + 0.5) * Wo, (c[1] * 0.5 + 0.5) * Ho]; };
    const pxPerWorld = w => { const d = C.ortho ? 1 : Math.max(v3.dot(v3.sub(w, C.eye), C.forward), C.near); return Ho / (2 * C.tanHalf[1] * d); };
    const zone = (a, b, ra, rb, k) => {
      if (shimN >= 4) return;
      const A = toPx(a), B = toPx(b);
      shimU.set([...A, ...B], shimN * 4);
      shimR.set([ra * pxPerWorld(a), rb * pxPerWorld(b), k, 0], shimN * 4);
      shimN++;
    };
    for (const f of fxNodes) {
      const n = f.node;
      if (!n.isPlume || n.profile || !(n.throttle > 0) || n.shimmer === false) continue;
      const ws = Math.hypot(f.world[0], f.world[1], f.world[2]) || 1, Lp = n.lengthNow, imp = n.impactNow();
      const end = imp ? imp : Lp * 1.35;
      zone(n.toWorld([0, -Lp * 0.15, 0]), n.toWorld([0, -end, 0]), n.radius * ws * 1.8, (imp ? n.splashRadius : n.radius * 4) * ws, 2.2 * clamp01(n.throttle));
    }
    for (const z of scene.shimmer || []) {
      const r = Array.isArray(z.radius) ? z.radius : [z.radius ?? 1, z.radius ?? 1];
      zone(z.from, z.to, r[0], r[1], z.strength ?? 2);
    }
    setAll(cp, {
      uShim: shimU, uShimR: shimR, uShimN: shimN, uShimT: scene.time ?? 0,
      uColor: 0, uNormal: 1, uDepth: 2, uFx: 3, uBloom: 4,
      uInvSize: [1 / R.main.w, 1 / R.main.h], uScale: [W / Wo, H / Ho], uTaps: Math.max(1, Math.min(3, Math.round(W / Wo))),
      uStep: Math.max(0.75, 0.62 * scale * (scene.ink ?? 1)), uNearFar: [C.near, C.far], uOrtho: C.ortho ? 1 : 0,
      uInk: scene.ink === 0 ? 0 : 0.9 * look.ink,
      uAo: scene.ao === false ? 0 : typeof scene.ao === "number" ? scene.ao : 0.5, uAoR: bounds.radius * 0.09,
      uFxInv: [1 / R.fx.w, 1 / R.fx.h], uBloomInv: bloomInv, uPost: [fxDraw.length ? 1 : 0, bloomTex ? bloomK : 0, 0, 0],
      uViewRot: new Float32Array([v[0], v[1], v[2], v[4], v[5], v[6], v[8], v[9], v[10]]), uTanHalf: C.tanHalf, uSize: [W, H],
    });
    gl.bindVertexArray(R.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);

    const image = R.offscreen ? R.canvas.transferToImageBitmap() : R.canvas;
    const view = makeView(scene, items, C, cssW, cssH, cut ? cutV : null, { image, sx: 0, sy: R.ch - Ho, sw: Wo, sh: Ho });
    view.quality = q.name;
    return view;
  }

  function makeView(scene, items, C, w, h, cut, source) {
    const invVP = m4.invert(C.vp);
    const project = p => {
      const q = m4.project(C.vp, p);
      return [(q[0] * 0.5 + 0.5) * w, (1 - (q[1] * 0.5 + 0.5)) * h, q[3]];
    };
    const ray = ([x, y]) => {
      const nx = (x / w) * 2 - 1, ny = 1 - (y / h) * 2;
      const a = m4.project(invVP, [nx, ny, -1]), b = m4.project(invVP, [nx, ny, 1]);
      return { origin: a.slice(0, 3), dir: v3.norm(v3.sub(b.slice(0, 3), a.slice(0, 3))) };
    };
    function pick(p, { ghosts = false } = {}) {
      const { origin, dir } = ray(p);
      let best = null;
      for (const it of items) {
        const node = it.node;
        if (!node.pickable) continue;
        const mat = resolveMaterial(node);
        if (!ghosts && mat.opacity < 0.5) continue;
        // bounding sphere
        const oc = v3.sub(origin, it.center), bq = v3.dot(oc, dir), cq = v3.dot(oc, oc) - it.radius * it.radius;
        if (bq * bq - cq < 0) continue;
        const inv = m4.invert(it.world);
        const o = m4.apply(inv, origin), d = m4.applyDir(inv, dir);
        const P = node.mesh.positions, I = node.mesh.indices;
        for (let t = 0; t < I.length; t += 3) {
          const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
          const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
          const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
          const pv = v3.cross(d, e2), det = v3.dot(e1, pv);
          if (Math.abs(det) < 1e-12) continue;
          const tv = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]];
          const u = v3.dot(tv, pv) / det;
          if (u < 0 || u > 1) continue;
          const qv = v3.cross(tv, e1), v = v3.dot(d, qv) / det;
          if (v < 0 || u + v > 1) continue;
          const tt = v3.dot(e2, qv) / det;
          if (tt <= 0) continue;
          const local = v3.add(o, v3.scale(d, tt));
          const world = m4.apply(it.world, local);
          if (cut && node.cut && v3.dot(world, cut.slice(0, 3)) > cut[3]) continue;
          const dist = v3.dist(world, origin);
          if (!best || dist < best.distance) best = { node, point: world, distance: dist };
        }
      }
      return best;
    }
    return {
      project,
      ray,
      pick,
      // The section cut this frame used, [nx, ny, nz, d] with a unit normal (n·p > d is removed), or null.
      cut: cut ? [...v3.norm(cut.slice(0, 3)), cut[3] / v3.len(cut.slice(0, 3))] : null,
      // False for a point the section cut removed.
      kept: p => !cut || v3.dot(cut.slice(0, 3), p) <= cut[3],
      // True when something opaque sits between the camera and p.
      hidden(p) {
        const s = project(p), hit = pick([s[0], s[1]]);
        return !!hit && hit.distance < v3.dist(ray([s[0], s[1]]).origin, p) - 1e-3 * C.distance;
      },
      eye: C.eye,
      target: C.target,
      width: w,
      height: h,
      source,
    };
  }
  // ---------- chemistry ----------
  // Covalent radius (Å) for bond lengths and ball sizes, van der Waals radius for space-filling,
  // and a color that reads well in the porcelain style.
  const ELEMENTS = {
    H: { cov: 0.31, vdw: 1.2, color: "#f5f3ee" }, C: { cov: 0.76, vdw: 1.7, color: "#5b5b61" },
    N: { cov: 0.71, vdw: 1.55, color: "#7d9bd8" }, O: { cov: 0.66, vdw: 1.52, color: "#e07a6e" },
    F: { cov: 0.57, vdw: 1.47, color: "#9fd18f" }, Cl: { cov: 1.02, vdw: 1.75, color: "#8fcf7c" },
    Br: { cov: 1.2, vdw: 1.85, color: "#b7685a" }, I: { cov: 1.39, vdw: 1.98, color: "#9a6fbf" },
    S: { cov: 1.05, vdw: 1.8, color: "#ead36a" }, P: { cov: 1.07, vdw: 1.8, color: "#ec9f5a" },
    Na: { cov: 1.66, vdw: 2.27, color: "#b49be0" }, K: { cov: 2.03, vdw: 2.75, color: "#a58ad6" },
    Mg: { cov: 1.41, vdw: 1.73, color: "#9fcf86" }, Ca: { cov: 1.76, vdw: 2.31, color: "#c9c9c0" },
    Fe: { cov: 1.32, vdw: 2.0, color: "#d0874f" }, Zn: { cov: 1.22, vdw: 1.39, color: "#9ea7c4" },
    Cu: { cov: 1.32, vdw: 1.4, color: "#cf8a5c" }, Si: { cov: 1.11, vdw: 2.1, color: "#d8c49a" },
    Li: { cov: 1.28, vdw: 1.82, color: "#c79be0" }, He: { cov: 0.28, vdw: 1.4, color: "#dff3f3" },
  };

  // atoms: [["O", [x, y, z]], ...] in ångström; bonds: [[i, j, order], ...].
  // style: "ball" (ball-and-stick) or "space" (space-filling).
  function molecule(atoms, bonds = [], { style = "ball", scale = 1, name = "molecule" } = {}) {
    const g = new Node(null, { name });
    const cache = new Map();
    const sphereFor = r => { const k = r.toFixed(3); if (!cache.has(k)) cache.set(k, mesh.sphere(r, { segments: 20 })); return cache.get(k); };
    atoms.forEach(([el, pos], i) => {
      const e = ELEMENTS[el] || { cov: 0.75, vdw: 1.7, color: "#cccccc" };
      const r = (style === "space" ? e.vdw : Math.max(0.22, e.cov * 0.42)) * scale;
      g.add(sphereFor(r), { position: v3.scale(pos, scale), color: e.color, name: `${el}${i + 1}`, data: { atom: i, element: el } });
    });
    if (style !== "space") {
      for (const [i, j, order = 1] of bonds) {
        const a = v3.scale(atoms[i][1], scale), b = v3.scale(atoms[j][1], scale);
        const dir = v3.sub(b, a), len = v3.len(dir);
        const side = v3.norm(v3.cross(dir, Math.abs(dir[1]) < 0.9 * len ? [0, 1, 0] : [1, 0, 0]));
        const r = 0.09 * scale * (order > 1 ? 0.75 : 1);
        const offsets = order === 1 ? [0] : order === 2 ? [-0.11, 0.11] : [-0.18, 0, 0.18];
        for (const off of offsets) {
          const sh = v3.scale(side, off * scale);
          const m = mesh.transform(mesh.cylinder(r, len, { segments: 14 }),
            m4.multiply(m4.translation(v3.add(v3.lerp(a, b, 0.5), sh)), m4.alignY(dir)));
          g.add(m, { material: "porcelain", name: `bond ${i + 1}-${j + 1}`, data: { bond: [i, j, order] } });
        }
      }
    }
    return g;
  }

  // ---------- science and math builders ----------
  // Height field y = f(x, z) over x: [x0, x1], z: [z0, z1]. The engine is y-up, so the
  // math picture z = f(x, y) stands on the floor here: pass f(x, z) and read y as height.
  // Non-finite values leave holes. Both sides are drawn, so it can be seen from below.
  function surfaceSoup(f, { x = [-1, 1], z = [-1, 1], n = 48, nz = n, keep = null } = {}) {
    const soup = new Soup(), back = new Soup();
    const pt = (i, j) => { const px = x[0] + ((x[1] - x[0]) * i) / n, pz = z[0] + ((z[1] - z[0]) * j) / nz; return [px, f(px, pz), pz]; };
    const P = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= n; i++) P.push(pt(i, j));
    const at = (i, j) => P[j * (n + 1) + i];
    const tri = (a, b, c) => {
      if (![a, b, c].every(q => Number.isFinite(q[1]))) return;
      if (keep && !keep((a[1] + b[1] + c[1]) / 3)) return;
      soup.tri(a, b, c);
      back.tri(a, c, b);
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      tri(a, d, c);
      tri(a, c, b);
    }
    return { soup, back, P };
  }
  mesh.surface = (f, o = {}) => {
    const { soup, back } = surfaceSoup(f, o);
    if (o.doubleSided !== false) soup.p.push(...back.p);
    return finish(soup, { crease: o.crease ?? 60 });
  };
  // The same surface cut into `bands` meshes by height, from range [lo, hi] (default: the
  // surface's own span). Color each band (E3.ramp) and the outlines between bands read as
  // contour lines. Returns { meshes, levels } with levels[k] the band's lower edge.
  mesh.surfaceBands = (f, o = {}) => {
    const { P } = surfaceSoup(f, { ...o, keep: () => false });
    const ys = P.map(q => q[1]).filter(Number.isFinite);
    const [lo, hi] = o.range ?? [Math.min(...ys), Math.max(...ys)];
    const K = o.bands ?? 8, step = (hi - lo) / K || 1;
    const n = o.n ?? 48, nz = o.nz ?? n, x = o.x ?? [-1, 1], z = o.z ?? [-1, 1];
    const at = (i, j) => P[j * (n + 1) + i];
    // Each triangle is clipped to every band it crosses, so band edges follow the
    // exact level curves (smooth contours) instead of stepping from triangle to triangle.
    const clip = (poly, level, keepAbove) => {
      const out = [];
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k], q = poly[(k + 1) % poly.length];
        const pin = keepAbove ? p[1] >= level : p[1] < level, qin = keepAbove ? q[1] >= level : q[1] < level;
        if (pin) out.push(p);
        if (pin !== qin) { const t = (level - p[1]) / (q[1] - p[1]); out.push([p[0] + (q[0] - p[0]) * t, level, p[2] + (q[2] - p[2]) * t]); }
      }
      return out;
    };
    const soups = Array.from({ length: K }, () => new Soup());
    const add = (a, b, c) => {
      if (![a, b, c].every(q => Number.isFinite(q[1]))) return;
      for (let k = 0; k < K; k++) {
        let poly = [a, b, c];
        if (k > 0) poly = clip(poly, lo + k * step, true);
        if (k < K - 1 && poly.length) poly = clip(poly, lo + (k + 1) * step, false);
        for (let t = 1; t + 1 < poly.length; t++) {
          soups[k].tri(poly[0], poly[t], poly[t + 1]);
          if (o.doubleSided !== false) soups[k].tri(poly[0], poly[t + 1], poly[t]);
        }
      }
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < n; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      add(a, d, c);
      add(a, c, b);
    }
    // Normals come from the whole surface, so shading doesn't break at the band edges.
    const fn = (px, pz) => { const e = 1e-4 * ((x[1] - x[0]) + (z[1] - z[0])); const nx = -(f(px + e, pz) - f(px - e, pz)) / (2 * e), nzz = -(f(px, pz + e) - f(px, pz - e)) / (2 * e); return v3.norm([nx, 1, nzz]); };
    const meshes = soups.map(soup => {
      const m = finish(soup, { crease: o.crease ?? 60 });
      for (let i = 0; i < m.positions.length; i += 3) {
        const nrm = fn(m.positions[i], m.positions[i + 2]), flip = m.normals[i + 1] < 0 ? -1 : 1;
        m.normals[i] = nrm[0] * flip; m.normals[i + 1] = nrm[1] * flip; m.normals[i + 2] = nrm[2] * flip;
      }
      return m;
    });
    return { meshes, levels: Array.from({ length: K }, (_, k) => lo + k * step), range: [lo, hi] };
  };
  // Parametric surface fn(u, v) -> [x, y, z] over u: [u0, u1], v: [v0, v1] (a sphere, a torus,
  // a Möbius strip, a saddle). wrapU / wrapV join the seams of closed surfaces.
  mesh.parametric = (fn, { u = [0, 1], v = [0, 1], nu = 48, nv = 32, wrapU = false, wrapV = false, doubleSided = true, crease = 60 } = {}) => {
    const soup = new Soup();
    const cols = wrapU ? nu : nu + 1, rows = wrapV ? nv : nv + 1;
    const P = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) P.push(fn(u[0] + ((u[1] - u[0]) * i) / nu, v[0] + ((v[1] - v[0]) * j) / nv));
    const at = (i, j) => P[(j % rows) * cols + (i % cols)];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      soup.quad(a, b, c, d);
      if (doubleSided) soup.quad(a, d, c, b);
    }
    return finish(soup, { crease });
  };
  // Arrows for a vector field: one per point, length |v| * scale (capped at maxLength).
  mesh.glyphs = (points, vectors, { scale = 1, radius = null, maxLength = Infinity, minLength = 1e-6 } = {}) => {
    const parts = [];
    points.forEach((p, i) => {
      const v = vectors[i], len = Math.min(v3.len(v) * scale, maxLength);
      if (!(len > minLength)) return;
      parts.push(mesh.arrow(p, v3.add(p, v3.scale(v3.norm(v), len)), { radius: radius ?? len * 0.05, segments: 10 }));
    });
    return parts.length ? mergeMeshes(...parts) : mesh.custom([], []);
  };
  // A curve in space as a round wire (orbits, trajectories, field lines). Short curves get dots at the ends.
  mesh.polyline = (points, r, { segments = 12, dots = false } = {}) => {
    const wire = mesh.tube(points, r, { segments });
    if (!dots) return wire;
    return mergeMeshes(wire, transformMesh(mesh.sphere(r * 2.2, { segments: 14 }), m4.translation(points[0])), transformMesh(mesh.sphere(r * 2.2, { segments: 14 }), m4.translation(points[points.length - 1])));
  };

  // Color between palette stops for t in [0, 1], read from the page's palette at call time
  // (call it in draw so it follows dark mode). Stops are palette or material names or hex.
  function ramp(t, stops = ["blue", "porcelain", "red"]) {
    const pal = window.palette || {};
    const rgb = c => hexRgb(pal[c] || MATERIALS[c]?.color || c);
    t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    const c = mixRgb(rgb(stops[k]), rgb(stops[k + 1]), f);
    return "#" + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
  }

  // Axes for a 3D plot: an ink arrow per axis over its range, tick marks every `ticks` units,
  // and optionally a floor grid. Adds nodes to `scene` (or `group`), returns { nodes, labels }
  // where labels are [{ at: [x, y, z], text, axis }] to draw with view.project and g.text.
  // Ranges are in world units, y up: x: [x0, x1], y: [y0, y1], z: [z0, z1].
  function axes3(scene, { x = [-1, 1], y = [0, 1], z = [-1, 1], ticks = 1, radius = null, origin = [0, 0, 0], grid = false, names = { x: "x", y: "y", z: "z" }, format = v => String(+v.toFixed(3)) } = {}) {
    const span = Math.max(x[1] - x[0], y[1] - y[0], z[1] - z[0]), r = radius ?? span * 0.006;
    const T = typeof ticks === "number" ? { x: ticks, y: ticks, z: ticks } : ticks;
    const axes = { x: [[1, 0, 0], x], y: [[0, 1, 0], y], z: [[0, 0, 1], z] };
    const nodes = [], labels = [];
    for (const [name, [dir, [a, b]]] of Object.entries(axes)) {
      if (a === b) continue;
      const from = v3.add(origin, v3.scale(dir, a)), to = v3.add(origin, v3.scale(dir, b + span * 0.06));
      const parts = [mesh.arrow(from, to, { radius: r, head: r * 7, headRadius: r * 2.6, segments: 12 })];
      const step = T[name];
      if (step) for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) {
        if (Math.abs(v) < 1e-9) continue;
        const p = v3.add(origin, v3.scale(dir, v)), side = name === "y" ? [1, 0, 0] : [0, 1, 0];
        parts.push(mesh.transform(mesh.cylinder(r * 0.8, span * 0.025, { segments: 8 }), m4.multiply(m4.translation(p), m4.alignY(side))));
        labels.push({ at: v3.add(p, v3.scale(name === "y" ? [-1, 0, 0] : [0, -1, 0], span * 0.05)), text: format(v), axis: name, tick: true });
      }
      nodes.push(scene.add(mergeMeshes(...parts), { material: "graphite", name: `${name} axis`, pickable: false, cut: false }));
      labels.push({ at: v3.add(origin, v3.scale(dir, b + span * 0.12)), text: names[name], axis: name, tick: false });
    }
    if (grid) {
      const lines = [], step = T.x || T.z || 1;
      for (let v = Math.ceil(x[0] / step) * step; v <= x[1] + 1e-9; v += step) lines.push(mesh.tube([[v, origin[1], z[0]], [v, origin[1], z[1]]], r * 0.35, { segments: 6 }));
      for (let v = Math.ceil(z[0] / step) * step; v <= z[1] + 1e-9; v += step) lines.push(mesh.tube([[x[0], origin[1], v], [x[1], origin[1], v]], r * 0.35, { segments: 6 }));
      nodes.push(scene.add(mergeMeshes(...lines), { material: "paper", name: "grid", pickable: false, cut: false }));
    }
    return { nodes, labels };
  }

  window.E3 = {
    v3, m4, mesh, smooth, triangulate, inset,
    scene: o => new Scene(o),
    node: (m, o) => new Node(m, o),
    particles: o => new Particles(o),
    // The matter presets E3.particles({ matter }) draws on, for reading their numbers.
    matter: MATTER,
    plume: o => new Plume(o),
    Node, Scene, Particles, Plume,
    flow,
    render,
    molecule, ELEMENTS, MATERIALS, LOOKS,
    ramp, axes3,
    // Black-body color at T kelvin as #hex (display), its glow in engine units, and the temper color of hot steel.
    blackbody: T => toHex(blackbody(T).map(v => v ** (1 / 2.2))),
    glow: glowOf,
    heatTint: (T, shift = 0) => { const h = heatTint(T, shift); return { color: toHex(h.color), amount: h.amount }; },
    // Adaptive quality: E3.quality.tier is the current tier; E3.quality.force("low" | "medium" | "high" | null).
    quality: {
      get tier() { return TIER_NAMES[Q.rank ?? startRank()]; },
      force(name) { Q.forced = TIERS[name] ? name : null; },
      tiers: TIERS,
    },
    // True when the page is dark (from the palette's background): pick a look by it, in draw.
    get dark() { return pageDark(); },
    get canvas() { return R && R.canvas; },
    // The last frame's tier, supersampling, MSAA samples, size, and triangle and particle counts.
    get stats() { return E3stats; },
    available() { try { renderer(); return true; } catch { return false; } },
    // For tests: the pure functions the shaders mirror.
    _: { resolveMaterial, hashU, rndU, noised, curl, flowAt, flowSpec, blackbody, glowOf, heatTint, tempAt, tempField, qualityFor, Q, TIERS, parseColor, pageDark, LOOKS },
  };
})();
