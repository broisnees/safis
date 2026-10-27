/* Simulation kit for explainer figures. window.Sim holds small, real simulators a
   figure can run live: particles with springs and rods (ropes, cloth), rigid bodies
   that stack and collide, waves, heat, reaction-diffusion and advection on grids,
   N-body gravity, random walks and an Ising lattice, classic ODE systems, and a tiny
   neural network, language model, and attention head for AI pages.
   Every simulator's state is plain data (numbers, arrays, typed arrays, no functions),
   so it can live in a figure's `s` and the self-check can snapshot and restore it.
   Every simulator steps on a fixed clock with substeps, so the result is the same at
   30 or 144 frames a second, and every random number comes from a seed kept in that
   state. Reference: references/simulations.md in the skill. */
(() => {
  "use strict";
  const TAU = Math.PI * 2;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hypot = Math.hypot;

  // ---------- shared plumbing ----------
  // Seeded random numbers (mulberry32, the same stream as Num.rng(seed)). The state is
  // the integer o.rng on whatever object carries it, so a snapshot restores the stream.
  function random(o) {
    o.rng = ((o.rng ?? 1) + 0x6d2b79f5) >>> 0;
    let t = o.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const gauss = o => Math.sqrt(-2 * Math.log(1 - random(o))) * Math.cos(TAU * random(o));

  // Runs fn(h) for every whole step of size h in the time banked so far. Leftover time
  // waits for the next frame; at most maxSub steps run per call, so a stalled tab
  // doesn't make the simulation sprint to catch up.
  function fixed(w, dt, fn) {
    const h = w.h, maxSub = w.maxSub ?? 64;
    w.acc = Math.min((w.acc ?? 0) + Math.max(0, dt), h * maxSub);
    let n = 0;
    while (w.acc >= h * (1 - 1e-9)) {
      fn(h);
      w.acc -= h;
      w.t += h;
      n++;
    }
    return n;
  }

  // ---------- particles: ropes, cloth, springs, soft bodies ----------
  // Position-based dynamics: forces (gravity, drag, springs, the mouse) move the
  // particles, then rods, pins, walls and collisions are enforced by nudging positions,
  // and velocities come from how far each particle actually moved.
  const particles = {
    create(o = {}) {
      return {
        kind: "particles", t: 0, acc: 0, h: o.h ?? 1 / 240, maxSub: o.maxSub ?? 32, iterations: o.iterations ?? 8,
        gravity: o.gravity ?? [0, -9.81], drag: o.drag ?? 0, restitution: o.restitution ?? 0.3, friction: o.friction ?? 0.2,
        collide: o.collide ?? false, bounds: o.bounds ?? null,
        p: [], springs: [], rods: [], walls: [], mouse: null,
      };
    },
    // Adds a particle; returns its index. m: 0 (or pinned: true) makes it immovable.
    add(w, { x = 0, y = 0, vx = 0, vy = 0, m = 1, r = 0.05, pinned = false } = {}) {
      w.p.push({ x, y, vx, vy, px: x, py: y, im: pinned || m <= 0 ? 0 : 1 / m, r, pin: pinned ? [x, y] : null });
      w.a = null;
      return w.p.length - 1;
    },
    pin(w, i, at = null) { w.a = null; const p = w.p[i]; p.im = 0; p.pin = at ?? [p.x, p.y]; p.vx = p.vy = 0; if (at) { p.x = p.px = at[0]; p.y = p.py = at[1]; } },
    unpin(w, i, m = 1) { w.a = null; const p = w.p[i]; p.im = 1 / m; p.pin = null; },
    // Hooke spring with damping along its length. rest defaults to the current distance.
    spring(w, a, b, { k = 100, damping = 0.5, rest = null } = {}) {
      const A = w.p[a], B = w.p[b];
      w.springs.push({ a, b, k, c: damping, rest: rest ?? hypot(B.x - A.x, B.y - A.y) });
      w.a = null;
      return w.springs.length - 1;
    },
    // Rigid distance constraint (a rod or an inextensible string link). stiffness 0-1.
    rod(w, a, b, { rest = null, stiffness = 1, slack = false } = {}) {
      const A = w.p[a], B = w.p[b];
      w.rods.push({ a, b, rest: rest ?? hypot(B.x - A.x, B.y - A.y), s: stiffness, slack });
      return w.rods.length - 1;
    },
    // A static line segment particles bounce off.
    wall(w, a, b) { w.walls.push({ a: [...a], b: [...b] }); return w.walls.length - 1; },
    // A chain of n particles from a to b joined by rods (or springs with { spring: k }).
    rope(w, a, b, n, o = {}) {
      const ids = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        ids.push(particles.add(w, { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), m: (o.mass ?? 1) / n, r: o.r ?? 0.03, pinned: (i === 0 && o.pinStart !== false) || (i === n - 1 && o.pinEnd) }));
        if (i) o.spring ? particles.spring(w, ids[i - 1], ids[i], { k: o.spring, damping: o.damping ?? 0.2 }) : particles.rod(w, ids[i - 1], ids[i], { slack: o.slack });
      }
      return ids;
    },
    // A cloth grid of nx by ny particles, top-left corner at [x, y], size [width, height].
    // Structural and shear links: rods (stable at any stiffness; stiffness 0-1) unless
    // springs: k is given. pin: "top", "corners", or a list of [i, j] cells.
    cloth(w, { x = 0, y = 0, width = 1, height = 1, nx = 12, ny = 10, mass = 1, springs = null, damping = 1, stiffness = 1, shear = true, pin = "corners" } = {}) {
      const id = (i, j) => base + j * nx + i, base = w.p.length;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        particles.add(w, { x: x + (width * i) / (nx - 1), y: y - (height * j) / (ny - 1), m: mass / (nx * ny), r: 0.02 });
      }
      const link = (a, b, f) => (springs ? particles.spring(w, a, b, { k: springs * f, damping }) : particles.rod(w, a, b, { stiffness: stiffness * f }));
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (i < nx - 1) link(id(i, j), id(i + 1, j), 1);
        if (j < ny - 1) link(id(i, j), id(i, j + 1), 1);
        if (shear && i < nx - 1 && j < ny - 1) {
          link(id(i, j), id(i + 1, j + 1), 0.5);
          link(id(i + 1, j), id(i, j + 1), 0.5);
        }
      }
      const pins = pin === "top" ? Array.from({ length: nx }, (_, i) => id(i, 0)) : pin === "corners" ? [id(0, 0), id(nx - 1, 0)] : Array.isArray(pin) ? pin.map(([i, j]) => id(i, j)) : [];
      for (const i of pins) particles.pin(w, i);
      return { nx, ny, index: id, ids: Array.from({ length: nx * ny }, (_, k) => base + k) };
    },

    // Stiff springs get extra inner steps (ω·h kept under 0.5), so no setting can blow up.
    step(w, dt) {
      let wmax = 0;
      for (const sp of w.springs) wmax = Math.max(wmax, Math.sqrt(sp.k * (w.p[sp.a].im + w.p[sp.b].im)));
      return fixed(w, dt, h => {
        const n = Math.min(64, Math.max(1, Math.ceil((wmax * h) / 0.5)));
        for (let i = 0; i < n; i++) particleSubstep(w, h / n);
      });
    },

    // The nearest movable particle within radius of point q, or -1.
    nearest(w, q, radius = Infinity, { movable = true } = {}) {
      let best = -1, bd = radius;
      w.p.forEach((p, i) => { const d = hypot(p.x - q[0], p.y - q[1]); if (d < bd && (!movable || p.im > 0 || p.pin)) { bd = d; best = i; } });
      return best;
    },
    // Mouse dragging: grab(w, q) picks a particle, drag(w, q) moves the target, release(w) lets go.
    grab(w, q, radius = 0.2, { k = 400, damping = 20 } = {}) {
      const i = particles.nearest(w, q, radius);
      w.mouse = i < 0 ? null : { i, x: q[0], y: q[1], k, c: damping };
      w.a = null;
      return i;
    },
    drag(w, q) { if (w.mouse) { w.mouse.x = q[0]; w.mouse.y = q[1]; w.a = null; } },
    release(w) { w.mouse = null; w.a = null; },
    // Call after moving particles or changing springs by hand.
    touch(w) { w.a = null; },

    energy(w) {
      let kinetic = 0, potential = 0, elastic = 0;
      const [gx, gy] = w.gravity;
      for (const p of w.p) {
        if (!p.im) continue;
        const m = 1 / p.im;
        kinetic += 0.5 * m * (p.vx * p.vx + p.vy * p.vy);
        potential -= m * (gx * p.x + gy * p.y);
      }
      for (const s of w.springs) {
        const A = w.p[s.a], B = w.p[s.b], e = hypot(B.x - A.x, B.y - A.y) - s.rest;
        elastic += 0.5 * s.k * e * e;
      }
      return { kinetic, potential, elastic, total: kinetic + potential + elastic };
    },
    momentum(w) {
      let px = 0, py = 0;
      for (const p of w.p) if (p.im) { px += p.vx / p.im; py += p.vy / p.im; }
      return [px, py];
    },
    // Strain of each spring, (length - rest) / rest, for coloring.
    strain(w) { return w.springs.map(s => { const A = w.p[s.a], B = w.p[s.b]; return (hypot(B.x - A.x, B.y - A.y) - s.rest) / s.rest; }); },
  };

  // Accelerations from gravity, drag, springs, and the mouse at the current positions and velocities.
  function particleForces(w) {
    const P = w.p, [gx, gy] = w.gravity, ax = new Float64Array(P.length), ay = new Float64Array(P.length);
    for (const s of w.springs) {
      const A = P[s.a], B = P[s.b];
      let dx = B.x - A.x, dy = B.y - A.y;
      const L = hypot(dx, dy) || 1e-9;
      dx /= L; dy /= L;
      const rel = (B.vx - A.vx) * dx + (B.vy - A.vy) * dy;
      const f = s.k * (L - s.rest) + s.c * rel;
      ax[s.a] += f * dx * A.im; ay[s.a] += f * dy * A.im;
      ax[s.b] -= f * dx * B.im; ay[s.b] -= f * dy * B.im;
    }
    const M = w.mouse;
    if (M && P[M.i] && P[M.i].im) {
      const p = P[M.i];
      ax[M.i] += M.k * (M.x - p.x) - M.c * p.vx;
      ay[M.i] += M.k * (M.y - p.y) - M.c * p.vy;
    }
    P.forEach((p, i) => { if (p.im) { ax[i] += gx - w.drag * p.vx; ay[i] += gy - w.drag * p.vy; } });
    return [ax, ay];
  }

  // Velocity Verlet (half kick, drift, constraints, half kick): second order, so an
  // undamped spring's energy stays flat on a plot instead of creeping.
  function particleSubstep(w, h) {
    const P = w.p, M = w.mouse;
    if (!w.a || w.a[0].length !== P.length) w.a = particleForces(w);
    const [ax, ay] = w.a;
    P.forEach((p, i) => {
      p.px = p.x; p.py = p.y;
      if (!p.im) { if (M && M.i === i && p.pin) { p.x = M.x; p.y = M.y; p.pin = [M.x, M.y]; } p.vx = p.vy = 0; return; }
      p.vx += ax[i] * h / 2;
      p.vy += ay[i] * h / 2;
      p.x += p.vx * h;
      p.y += p.vy * h;
    });
    const contacts = [];
    for (let it = 0; it < w.iterations; it++) {
      for (const r of w.rods) {
        const A = P[r.a], B = P[r.b], wsum = A.im + B.im;
        if (!wsum) continue;
        let dx = B.x - A.x, dy = B.y - A.y;
        const L = hypot(dx, dy) || 1e-9, e = L - r.rest;
        if (r.slack && e < 0) continue;
        const k = (r.s * e) / (L * wsum);
        A.x += dx * k * A.im; A.y += dy * k * A.im;
        B.x -= dx * k * B.im; B.y -= dy * k * B.im;
      }
      for (const p of P) {
        if (!p.im) continue;
        for (const s of w.walls) {
          const n = segmentPush(p, s.a, s.b, p.r);
          if (n && it === w.iterations - 1) contacts.push([p, null, n]);
        }
        if (w.bounds) {
          const [x0, y0, x1, y1] = w.bounds;
          if (p.x < x0 + p.r) { p.x = x0 + p.r; if (it === w.iterations - 1) contacts.push([p, null, [1, 0]]); }
          if (p.x > x1 - p.r) { p.x = x1 - p.r; if (it === w.iterations - 1) contacts.push([p, null, [-1, 0]]); }
          if (p.y < y0 + p.r) { p.y = y0 + p.r; if (it === w.iterations - 1) contacts.push([p, null, [0, 1]]); }
          if (p.y > y1 - p.r) { p.y = y1 - p.r; if (it === w.iterations - 1) contacts.push([p, null, [0, -1]]); }
        }
      }
      if (w.collide) collideParticles(P, it === w.iterations - 1 ? contacts : null);
    }
    for (const p of P) {
      if (!p.im) continue;
      p.vx = (p.x - p.px) / h;
      p.vy = (p.y - p.py) / h;
    }
    w.a = particleForces(w);
    P.forEach((p, i) => { if (p.im) { p.vx += w.a[0][i] * h / 2; p.vy += w.a[1][i] * h / 2; } });
    // Bounce and rub: reflect the approaching part of the velocity at each contact.
    for (const [a, b, n] of contacts) {
      const rvx = a.vx - (b ? b.vx : 0), rvy = a.vy - (b ? b.vy : 0);
      const vn = rvx * n[0] + rvy * n[1];
      if (vn >= 0) continue;
      const tx = rvx - vn * n[0], ty = rvy - vn * n[1];
      const share = b ? a.im / (a.im + b.im) : 1;
      const jn = -(1 + w.restitution) * vn * share, ft = w.friction * share;
      a.vx += jn * n[0] - ft * tx; a.vy += jn * n[1] - ft * ty;
      if (b) { const sb = 1 - share; b.vx -= (-(1 + w.restitution) * vn * sb) * n[0] - w.friction * sb * tx; b.vy -= (-(1 + w.restitution) * vn * sb) * n[1] - w.friction * sb * ty; }
    }
  }

  // Pushes particle p out of segment ab (thickness r); returns the push direction or null.
  function segmentPush(p, a, b, r) {
    const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1e-12;
    const t = clamp(((p.x - a[0]) * ex + (p.y - a[1]) * ey) / L2, 0, 1);
    const cx = a[0] + ex * t, cy = a[1] + ey * t;
    let dx = p.x - cx, dy = p.y - cy;
    const d = hypot(dx, dy);
    if (d >= r) return null;
    if (d < 1e-12) { dx = -ey; dy = ex; } // on the line: push to the left side
    const L = hypot(dx, dy) || 1;
    p.x = cx + (dx / L) * r;
    p.y = cy + (dy / L) * r;
    return [dx / L, dy / L];
  }

  function collideParticles(P, contacts) {
    // Spatial hash on the largest radius, so a few thousand particles stay cheap.
    let rmax = 0;
    for (const p of P) rmax = Math.max(rmax, p.r);
    if (rmax <= 0) return;
    const cell = 2 * rmax, grid = new Map();
    P.forEach((p, i) => {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(i);
    });
    P.forEach((a, i) => {
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        for (const j of grid.get(`${cx + ox},${cy + oy}`) ?? []) {
          if (j <= i) continue;
          const b = P[j], wsum = a.im + b.im;
          if (!wsum) continue;
          let dx = b.x - a.x, dy = b.y - a.y;
          const d = hypot(dx, dy), min = a.r + b.r;
          if (d >= min || d < 1e-12) continue;
          dx /= d; dy /= d;
          const push = (min - d) / wsum;
          a.x -= dx * push * a.im; a.y -= dy * push * a.im;
          b.x += dx * push * b.im; b.y += dy * push * b.im;
          if (contacts) contacts.push([a, b, [-dx, -dy]]);
        }
      }
    });
  }

  // ---------- rigid bodies: boxes, circles, polygons that collide and stack ----------
  // Sequential impulses with warm starting (the approach of Box2D Lite): each contact
  // remembers the impulse it needed last step, which is what lets a tower of boxes
  // stand still instead of jittering.
  const rigid = {
    create(o = {}) {
      return {
        kind: "rigid", t: 0, acc: 0, h: o.h ?? 1 / 120, maxSub: o.maxSub ?? 16, iterations: o.iterations ?? 12,
        gravity: o.gravity ?? [0, -9.81], friction: o.friction ?? 0.5, restitution: o.restitution ?? 0.1,
        bodies: [], cache: {}, mouse: null, contacts: [],
      };
    },
    // shape: { type: "box", w, h } | { type: "circle", r } | { type: "poly", points: [[x, y], ...] }
    add(w, shape, { x = 0, y = 0, angle = 0, vx = 0, vy = 0, omega = 0, density = 1, mass = null, static: isStatic = false, friction = null, restitution = null, color = null, name = null } = {}) {
      let verts = null, r = 0;
      if (shape.type === "box") verts = [[-shape.w / 2, -shape.h / 2], [shape.w / 2, -shape.h / 2], [shape.w / 2, shape.h / 2], [-shape.w / 2, shape.h / 2]];
      else if (shape.type === "poly") verts = ccw(shape.points);
      else r = shape.r;
      let area, I, cx = 0, cy = 0;
      if (verts) {
        ({ area, I, cx, cy } = polyMass(verts));
        verts = verts.map(([px, py]) => [px - cx, py - cy]);
      } else {
        area = Math.PI * r * r;
        I = 0.5 * area * r * r;
      }
      const m = mass ?? density * area;
      const inertia = I * (m / area);
      const b = {
        x: x + cx, y: y + cy, a: angle, vx, vy, w: omega,
        im: isStatic ? 0 : 1 / m, iI: isStatic ? 0 : 1 / inertia, m: isStatic ? 0 : m, I: isStatic ? 0 : inertia,
        type: verts ? "poly" : "circle", verts, r: verts ? Math.max(...verts.map(v => hypot(v[0], v[1]))) : r,
        mu: friction ?? w.friction, e: restitution ?? w.restitution, color, name, static: isStatic,
      };
      w.bodies.push(b);
      return w.bodies.length - 1;
    },
    box(w, x, y, bw, bh, o = {}) { return rigid.add(w, { type: "box", w: bw, h: bh }, { x, y, ...o }); },
    circle(w, x, y, r, o = {}) { return rigid.add(w, { type: "circle", r }, { x, y, ...o }); },
    poly(w, points, o = {}) { return rigid.add(w, { type: "poly", points }, o); },
    // A static floor (a wide flat box with its top at y).
    ground(w, y = 0, { x0 = -50, x1 = 50, thickness = 1 } = {}) { return rigid.box(w, (x0 + x1) / 2, y - thickness / 2, x1 - x0, thickness, { static: true }); },

    step(w, dt) { return fixed(w, dt, h => rigidSubstep(w, h)); },

    // World-space corners of a polygon body.
    vertices(b) {
      const c = Math.cos(b.a), s = Math.sin(b.a);
      return b.verts ? b.verts.map(([px, py]) => [b.x + c * px - s * py, b.y + s * px + c * py]) : null;
    },
    // Index of the body under point q, or -1.
    hit(w, q) {
      for (let i = w.bodies.length - 1; i >= 0; i--) {
        const b = w.bodies[i];
        if (b.type === "circle" ? hypot(q[0] - b.x, q[1] - b.y) <= b.r : pointInPoly(q, rigid.vertices(b))) return i;
      }
      return -1;
    },
    // Mouse spring on a point of a body; k and damping are per unit mass, so heavy and light bodies feel alike.
    grab(w, q, { k = 120, damping = 18, statics = false } = {}) {
      const i = rigid.hit(w, q);
      if (i < 0 || (!statics && w.bodies[i].static)) { w.mouse = null; return -1; }
      const b = w.bodies[i], c = Math.cos(-b.a), s = Math.sin(-b.a), dx = q[0] - b.x, dy = q[1] - b.y;
      w.mouse = { i, lx: c * dx - s * dy, ly: s * dx + c * dy, x: q[0], y: q[1], k, c: damping };
      return i;
    },
    drag(w, q) { if (w.mouse) { w.mouse.x = q[0]; w.mouse.y = q[1]; } },
    release(w) { w.mouse = null; },
    // Where the mouse spring is attached, in world coordinates (for drawing the line).
    anchor(w) {
      const M = w.mouse;
      if (!M) return null;
      const b = w.bodies[M.i], c = Math.cos(b.a), s = Math.sin(b.a);
      return [b.x + c * M.lx - s * M.ly, b.y + s * M.lx + c * M.ly];
    },
    energy(w) {
      let kinetic = 0, potential = 0;
      for (const b of w.bodies) {
        if (!b.im) continue;
        kinetic += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy) + 0.5 * b.I * b.w * b.w;
        potential -= b.m * (w.gravity[0] * b.x + w.gravity[1] * b.y);
      }
      return { kinetic, potential, total: kinetic + potential };
    },
    momentum(w) {
      let px = 0, py = 0, L = 0;
      for (const b of w.bodies) if (b.im) { px += b.m * b.vx; py += b.m * b.vy; L += b.I * b.w + b.m * (b.x * b.vy - b.y * b.vx); }
      return { linear: [px, py], angular: L };
    },
  };

  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  function ccw(points) {
    let s = 0;
    for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; s += cross(p[0], p[1], q[0], q[1]); }
    return s < 0 ? points.slice().reverse() : points.slice();
  }
  function polyMass(v) {
    let area = 0, cx = 0, cy = 0, I = 0;
    for (let i = 0; i < v.length; i++) {
      const [x0, y0] = v[i], [x1, y1] = v[(i + 1) % v.length], c = cross(x0, y0, x1, y1);
      area += c / 2;
      cx += ((x0 + x1) * c) / 6;
      cy += ((y0 + y1) * c) / 6;
      I += (c * (x0 * x0 + x0 * x1 + x1 * x1 + y0 * y0 + y0 * y1 + y1 * y1)) / 12;
    }
    cx /= area; cy /= area;
    I -= area * (cx * cx + cy * cy); // move the inertia to the centroid
    return { area, I, cx, cy };
  }
  function pointInPoly(q, V) {
    for (let i = 0; i < V.length; i++) {
      const a = V[i], b = V[(i + 1) % V.length];
      if (cross(b[0] - a[0], b[1] - a[1], q[0] - a[0], q[1] - a[1]) < 0) return false;
    }
    return true;
  }

  // Contacts between bodies A and B: [{ n (from A to B), p, sep, id }]. Points a hair
  // apart (up to `margin`) count too: resting faces sit at a separation of about zero,
  // and dropping a corner whenever rounding makes it positive is what rocks a stack.
  function collide(A, B, margin = 0.02 * Math.min(A.r, B.r)) {
    if (A.type === "circle" && B.type === "circle") {
      const dx = B.x - A.x, dy = B.y - A.y, d = hypot(dx, dy);
      if (d > A.r + B.r + margin) return [];
      const n = d > 1e-9 ? [dx / d, dy / d] : [0, 1];
      return [{ n, p: [A.x + n[0] * A.r, A.y + n[1] * A.r], sep: d - A.r - B.r, id: 0 }];
    }
    if (A.type === "circle") return collide(B, A, margin).map(c => ({ ...c, n: [-c.n[0], -c.n[1]] }));
    const VA = rigid.vertices(A);
    if (B.type === "circle") {
      // Face of A the circle is most outside of.
      let best = -Infinity, bi = 0;
      for (let i = 0; i < VA.length; i++) {
        const a = VA[i], b = VA[(i + 1) % VA.length], ex = b[0] - a[0], ey = b[1] - a[1], L = hypot(ex, ey);
        const s = cross(ex, ey, B.x - a[0], B.y - a[1]) / -L; // distance outside along the outward normal
        if (s > best) { best = s; bi = i; }
      }
      if (best > B.r + margin) return [];
      const a = VA[bi], b = VA[(bi + 1) % VA.length], ex = b[0] - a[0], ey = b[1] - a[1], L = hypot(ex, ey);
      const t = ((B.x - a[0]) * ex + (B.y - a[1]) * ey) / (L * L);
      let n, cpt;
      if (best > 0 && (t < 0 || t > 1)) {
        cpt = t < 0 ? a : b;
        const dx = B.x - cpt[0], dy = B.y - cpt[1], d = hypot(dx, dy);
        if (d > B.r + margin) return [];
        n = [dx / d, dy / d];
        return [{ n, p: cpt, sep: d - B.r, id: bi * 4 + (t < 0 ? 1 : 2) }];
      }
      n = [ey / L, -ex / L];
      cpt = [B.x - n[0] * B.r, B.y - n[1] * B.r];
      return [{ n, p: cpt, sep: best - B.r, id: bi * 4 }];
    }
    const VB = rigid.vertices(B);
    const [sa, ea] = maxSeparation(VA, VB), [sb, eb] = maxSeparation(VB, VA);
    if (sa > margin || sb > margin) return [];
    // The reference face is on whichever body separates more (A, unless B is clearly better).
    const flip = sb > sa + 0.002 * Math.max(A.r, B.r);
    const R = flip ? VB : VA, I = flip ? VA : VB, ri = flip ? eb : ea;
    const r1 = R[ri], r2 = R[(ri + 1) % R.length], ex = r2[0] - r1[0], ey = r2[1] - r1[1], L = hypot(ex, ey);
    const tx = ex / L, ty = ey / L, nx = ty, ny = -tx; // outward normal of a CCW polygon
    // Incident edge: the one on the other body most opposed to the reference normal.
    let ii = 0, mind = Infinity;
    for (let i = 0; i < I.length; i++) {
      const a = I[i], b = I[(i + 1) % I.length], fx = b[0] - a[0], fy = b[1] - a[1], fl = hypot(fx, fy);
      const d = (fy / fl) * nx + (-fx / fl) * ny;
      if (d < mind) { mind = d; ii = i; }
    }
    let pts = [[...I[ii], 0], [...I[(ii + 1) % I.length], 1]];
    // Clip the incident edge to the sides of the reference face.
    pts = clipSeg(pts, -tx, -ty, -(tx * r1[0] + ty * r1[1]));
    if (pts.length < 2) return [];
    pts = clipSeg(pts, tx, ty, tx * r2[0] + ty * r2[1]);
    if (pts.length < 2) return [];
    const front = nx * r1[0] + ny * r1[1], out = [];
    for (const [px, py, k] of pts) {
      const sep = nx * px + ny * py - front;
      if (sep > margin) continue;
      out.push({ n: flip ? [-nx, -ny] : [nx, ny], p: [px - nx * sep * 0.5, py - ny * sep * 0.5], sep, id: (flip ? 1000 : 0) + ri * 50 + ii * 4 + k });
    }
    return out;
  }
  function maxSeparation(V1, V2) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < V1.length; i++) {
      const a = V1[i], b = V1[(i + 1) % V1.length], ex = b[0] - a[0], ey = b[1] - a[1], L = hypot(ex, ey);
      const nx = ey / L, ny = -ex / L;
      let mn = Infinity;
      for (const v of V2) mn = Math.min(mn, nx * (v[0] - a[0]) + ny * (v[1] - a[1]));
      if (mn > best) { best = mn; bi = i; }
    }
    return [best, bi];
  }
  function clipSeg(pts, nx, ny, off) {
    const out = [], d0 = nx * pts[0][0] + ny * pts[0][1] - off, d1 = nx * pts[1][0] + ny * pts[1][1] - off;
    if (d0 <= 0) out.push(pts[0]);
    if (d1 <= 0) out.push(pts[1]);
    if (d0 * d1 < 0) {
      const t = d0 / (d0 - d1);
      out.push([lerp(pts[0][0], pts[1][0], t), lerp(pts[0][1], pts[1][1], t), d0 > 0 ? pts[0][2] : pts[1][2]]);
    }
    return out;
  }

  function rigidSubstep(w, h) {
    const B = w.bodies, [gx, gy] = w.gravity;
    for (const b of B) {
      if (!b.im) continue;
      b.vx += gx * h;
      b.vy += gy * h;
    }
    const M = w.mouse;
    if (M && B[M.i]) {
      const b = B[M.i], c = Math.cos(b.a), s = Math.sin(b.a);
      const rx = c * M.lx - s * M.ly, ry = s * M.lx + c * M.ly;
      const vpx = b.vx - b.w * ry, vpy = b.vy + b.w * rx;
      const fx = b.m * (M.k * (M.x - (b.x + rx)) - M.c * vpx), fy = b.m * (M.k * (M.y - (b.y + ry)) - M.c * vpy);
      b.vx += fx * b.im * h; b.vy += fy * b.im * h; b.w += cross(rx, ry, fx, fy) * b.iI * h;
    }
    // Narrow phase on every pair whose bounding circles touch (fine for a few hundred bodies).
    const contacts = [], cache = {};
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const A = B[i], C = B[j];
      if (!A.im && !C.im) continue;
      if (hypot(C.x - A.x, C.y - A.y) > (A.r + C.r) * 1.02) continue;
      for (const k of collide(A, C)) {
        const key = `${i}:${j}:${k.id}`, old = w.cache[key];
        const c = { i, j, key, n: k.n, p: k.p, sep: k.sep, Pn: old ? old.Pn : 0, Pt: old ? old.Pt : 0, mu: Math.sqrt(A.mu * C.mu), e: Math.max(A.e, C.e) };
        contacts.push(c);
      }
    }
    // Pre-step: effective masses, position bias, restitution, warm start.
    for (const c of contacts) {
      const A = B[c.i], C = B[c.j], n = c.n, t = [n[1], -n[0]];
      c.ra = [c.p[0] - A.x, c.p[1] - A.y];
      c.rb = [c.p[0] - C.x, c.p[1] - C.y];
      const rna = cross(c.ra[0], c.ra[1], n[0], n[1]), rnb = cross(c.rb[0], c.rb[1], n[0], n[1]);
      const rta = cross(c.ra[0], c.ra[1], t[0], t[1]), rtb = cross(c.rb[0], c.rb[1], t[0], t[1]);
      c.mn = 1 / (A.im + C.im + A.iI * rna * rna + C.iI * rnb * rnb);
      c.mt = 1 / (A.im + C.im + A.iI * rta * rta + C.iI * rtb * rtb);
      c.t = t;
      // Bounce needs the approach speed before any impulse of this step is applied.
      const dv = relVel(A, C, c), vn = dv[0] * n[0] + dv[1] * n[1];
      const slop = 0.005 * Math.min(A.r, C.r);
      c.bias = c.sep > 0 ? -c.sep / h : -0.2 / h * Math.min(0, c.sep + slop) + (vn < -1 ? -c.e * vn : 0);
    }
    for (const c of contacts) {
      const n = c.n, t = c.t;
      applyImpulse(B[c.i], B[c.j], c, n[0] * c.Pn + t[0] * c.Pt, n[1] * c.Pn + t[1] * c.Pt);
    }
    for (let it = 0; it < w.iterations; it++) {
      for (const c of contacts) {
        const A = B[c.i], C = B[c.j], n = c.n, t = c.t;
        let dv = relVel(A, C, c);
        const dPn = c.mn * (-(dv[0] * n[0] + dv[1] * n[1]) + c.bias);
        const Pn0 = c.Pn;
        c.Pn = Math.max(Pn0 + dPn, 0);
        const pn = c.Pn - Pn0;
        applyImpulse(A, C, c, n[0] * pn, n[1] * pn);
        dv = relVel(A, C, c);
        const dPt = c.mt * -(dv[0] * t[0] + dv[1] * t[1]);
        const Pt0 = c.Pt, maxPt = c.mu * c.Pn;
        c.Pt = clamp(Pt0 + dPt, -maxPt, maxPt);
        const pt = c.Pt - Pt0;
        applyImpulse(A, C, c, t[0] * pt, t[1] * pt);
      }
    }
    for (const c of contacts) cache[c.key] = { Pn: c.Pn, Pt: c.Pt };
    w.cache = cache;
    w.contacts = contacts.map(c => ({ p: c.p, n: c.n, Pn: c.Pn }));
    for (const b of B) {
      if (!b.im) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.a += b.w * h;
    }
  }
  function relVel(A, C, c) {
    return [C.vx - C.w * c.rb[1] - (A.vx - A.w * c.ra[1]), C.vy + C.w * c.rb[0] - (A.vy + A.w * c.ra[0])];
  }
  function applyImpulse(A, C, c, px, py) {
    A.vx -= px * A.im; A.vy -= py * A.im; A.w -= cross(c.ra[0], c.ra[1], px, py) * A.iI;
    C.vx += px * C.im; C.vy += py * C.im; C.w += cross(c.rb[0], c.rb[1], px, py) * C.iI;
  }

  // ---------- fields on grids: waves, heat, reaction-diffusion, advection ----------
  // A grid is { nx, ny, u: Float64Array(nx * ny), ... }; cell (i, j) is u[j * nx + i].
  // ny = 1 makes a 1D grid. dx is the cell size in world units.
  const at = (G, i, j) => G.u[j * G.nx + i];

  const wave = {
    // c: wave speed, dx: cell size, damping: per second, boundary: "fixed" | "free" | "absorbing".
    create({ nx = 200, ny = 1, c = 1, dx = 0.01, damping = 0, boundary = "fixed", cfl = null } = {}) {
      const dims = ny > 1 ? 2 : 1;
      const k = cfl ?? (dims === 1 ? 1 : 0.7);
      const h = (k * dx) / (c * Math.sqrt(dims));
      return {
        kind: "wave", t: 0, acc: 0, h, maxSub: 400, nx, ny, c, dx, damping, boundary,
        u: new Float64Array(nx * ny), up: new Float64Array(nx * ny), wall: new Uint8Array(nx * ny), sources: [],
      };
    },
    // A point that oscillates: amp * sin(2π f t + phase), at cell (i, j).
    source(G, i, j = 0, { amp = 1, freq = 1, phase = 0, soft = false } = {}) { G.sources.push({ i, j, amp, freq, phase, soft }); return G.sources.length - 1; },
    // Cells that hold still (slits, reflectors). mask(i, j) -> true for wall.
    walls(G, mask) { for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) G.wall[j * G.nx + i] = mask(i, j) ? 1 : 0; },
    // A smooth bump of height amp centered at (x0, y0) cells with width sigma cells, at rest.
    pulse(G, x0, y0 = 0, { amp = 1, sigma = 5, moving = 0 } = {}) {
      for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
        const r2 = (i - x0) ** 2 + (G.ny > 1 ? (j - y0) ** 2 : 0);
        const v = amp * Math.exp(-r2 / (2 * sigma * sigma));
        G.u[j * G.nx + i] += v;
        // moving: +1 or -1 sends a 1D pulse one way instead of splitting in two.
        const ib = i + moving * (G.c * G.h) / G.dx, r2b = (ib - x0) ** 2 + (G.ny > 1 ? (j - y0) ** 2 : 0);
        G.up[j * G.nx + i] += moving ? amp * Math.exp(-r2b / (2 * sigma * sigma)) : v;
      }
    },
    step(G, dt) { return fixed(G, dt, h => waveSubstep(G, h)); },
    // The energy the leapfrog scheme conserves exactly (no damping, fixed edges): kinetic
    // from the last time difference, strain as the product of this step's and last step's slopes.
    energy(G) {
      let e = 0;
      const { nx, ny, u, up, h, c, dx } = G;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i, vt = (u[k] - up[k]) / h;
        e += 0.5 * vt * vt;
        if (i < nx - 1) e += 0.5 * c * c * ((u[k + 1] - u[k]) * (up[k + 1] - up[k])) / (dx * dx);
        if (ny > 1 && j < ny - 1) e += 0.5 * c * c * ((u[k + nx] - u[k]) * (up[k + nx] - up[k])) / (dx * dx);
      }
      return e * dx ** (ny > 1 ? 2 : 1);
    },
  };
  function waveSubstep(G, h) {
    const { nx, ny, u, up, wall, c, dx } = G, r2 = (c * h / dx) ** 2, g = G.damping * h;
    const next = new Float64Array(nx * ny);
    const two = ny > 1;
    for (let j = two ? 1 : 0; j < (two ? ny - 1 : 1); j++) for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      if (wall[k]) continue;
      const lap = u[k - 1] + u[k + 1] - 2 * u[k] + (two ? u[k - nx] + u[k + nx] - 2 * u[k] : 0);
      next[k] = (2 * u[k] - (1 - g) * up[k] + r2 * lap) / (1 + g);
    }
    // Edges: fixed stays 0, free copies its neighbor, absorbing lets waves leave (Mur).
    const mur = (c * h - dx) / (c * h + dx);
    const edge = (k, inner) => {
      if (G.boundary === "free") next[k] = next[inner];
      else if (G.boundary === "absorbing") next[k] = u[inner] + mur * (next[inner] - u[k]);
    };
    if (two) {
      for (let i = 0; i < nx; i++) { edge(i, i + nx); edge((ny - 1) * nx + i, (ny - 2) * nx + i); }
      for (let j = 0; j < ny; j++) { edge(j * nx, j * nx + 1); edge(j * nx + nx - 1, j * nx + nx - 2); }
    } else { edge(0, 1); edge(nx - 1, nx - 2); }
    const t = G.t + h;
    for (const s of G.sources) {
      const k = s.j * nx + s.i, v = s.amp * Math.sin(TAU * s.freq * t + s.phase);
      if (s.soft) next[k] += v * r2; else next[k] = v;
    }
    G.up = u;
    G.u = next;
  }

  const heat = {
    // D: diffusivity; boundary "insulated" (no flux, total heat conserved) or "fixed" (edges held at `edge`).
    create({ nx = 100, ny = 1, D = 1, dx = 0.01, boundary = "insulated", edge = 0 } = {}) {
      const dims = ny > 1 ? 2 : 1;
      return { kind: "heat", t: 0, acc: 0, h: (0.9 * dx * dx) / (2 * dims * D), maxSub: 2000, nx, ny, D, dx, boundary, edge, u: new Float64Array(nx * ny), fixedMask: new Uint8Array(nx * ny) };
    },
    // Cells held at their current value (a hot plate, an ice cube).
    hold(G, mask) { for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) G.fixedMask[j * G.nx + i] = mask(i, j) ? 1 : 0; },
    step(G, dt) { return fixed(G, dt, h => heatSubstep(G, h)); },
    total(G) { let s = 0; for (const v of G.u) s += v; return s * G.dx ** (G.ny > 1 ? 2 : 1); },
  };
  function heatSubstep(G, h) {
    const { nx, ny, u } = G, k = (G.D * h) / (G.dx * G.dx), next = new Float64Array(u.length), two = ny > 1;
    const get = (i, j) => {
      if (G.boundary === "insulated") { i = clamp(i, 0, nx - 1); j = clamp(j, 0, ny - 1); return u[j * nx + i]; }
      return i < 0 || i >= nx || j < 0 || j >= ny ? G.edge : u[j * nx + i];
    };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (G.fixedMask[c]) { next[c] = u[c]; continue; }
      const lap = get(i - 1, j) + get(i + 1, j) - 2 * u[c] + (two ? get(i, j - 1) + get(i, j + 1) - 2 * u[c] : 0);
      next[c] = u[c] + k * lap;
    }
    G.u = next;
  }

  // Gray-Scott reaction-diffusion (two chemicals, u feeds v): F feed rate, k kill rate.
  const GRAY_SCOTT = {
    coral: { F: 0.0545, k: 0.062 }, mitosis: { F: 0.0367, k: 0.0649 }, spots: { F: 0.03, k: 0.062 },
    maze: { F: 0.029, k: 0.057 }, worms: { F: 0.078, k: 0.061 }, waves: { F: 0.014, k: 0.045 },
  };
  const grayScott = {
    presets: GRAY_SCOTT,
    create({ nx = 128, ny = 128, preset = "coral", F = null, k = null, Du = 1, Dv = 0.5, seed = 1, rate = 600 } = {}) {
      const p = GRAY_SCOTT[preset] ?? GRAY_SCOTT.coral;
      const G = { kind: "grayScott", t: 0, acc: 0, h: 1 / rate, maxSub: 40, nx, ny, F: F ?? p.F, k: k ?? p.k, Du, Dv, rng: seed, u: new Float64Array(nx * ny).fill(1), v: new Float64Array(nx * ny) };
      grayScott.seed(G, nx / 2, ny / 2, Math.max(3, nx / 12));
      for (let n = 0; n < 6; n++) grayScott.seed(G, random(G) * nx, random(G) * ny, 2 + random(G) * 3);
      return G;
    },
    // Drops some v in a square of half-size r at (x, y): where patterns start.
    seed(G, x, y, r = 4) {
      for (let j = Math.floor(y - r); j <= y + r; j++) for (let i = Math.floor(x - r); i <= x + r; i++) {
        const ii = ((i % G.nx) + G.nx) % G.nx, jj = ((j % G.ny) + G.ny) % G.ny;
        G.u[jj * G.nx + ii] = 0.5;
        G.v[jj * G.nx + ii] = 0.25;
      }
    },
    // One unit of model time per substep (the scheme's natural step); `rate` substeps per second.
    step(G, dt) { return fixed(G, dt, () => gsSubstep(G)); },
  };
  function gsSubstep(G) {
    const { nx, ny, u, v, F, k, Du, Dv } = G, nu = new Float64Array(u.length), nv = new Float64Array(v.length);
    for (let j = 0; j < ny; j++) {
      const jm = ((j - 1 + ny) % ny) * nx, j0 = j * nx, jp = ((j + 1) % ny) * nx;
      for (let i = 0; i < nx; i++) {
        const im = (i - 1 + nx) % nx, ip = (i + 1) % nx, c = j0 + i;
        // 3x3 Laplacian: 0.2 to the sides, 0.05 to the corners, -1 at the center.
        const lu = 0.2 * (u[j0 + im] + u[j0 + ip] + u[jm + i] + u[jp + i]) + 0.05 * (u[jm + im] + u[jm + ip] + u[jp + im] + u[jp + ip]) - u[c];
        const lv = 0.2 * (v[j0 + im] + v[j0 + ip] + v[jm + i] + v[jp + i]) + 0.05 * (v[jm + im] + v[jm + ip] + v[jp + im] + v[jp + ip]) - v[c];
        const uvv = u[c] * v[c] * v[c];
        nu[c] = u[c] + Du * lu - uvv + F * (1 - u[c]);
        nv[c] = v[c] + Dv * lv + uvv - (F + k) * v[c];
      }
    }
    G.u = nu;
    G.v = nv;
  }

  // Semi-Lagrangian advection of a scalar grid by a velocity field vel(x, y) -> [vx, vy] in cells per second.
  // Unconditionally stable; a little blurry, as real numerical advection is.
  function advect(G, vel, dt, { wrap = false } = {}) {
    const { nx, ny, u } = G, out = new Float64Array(u.length);
    const sample = (x, y) => {
      if (wrap) { x = ((x % nx) + nx) % nx; y = ((y % ny) + ny) % ny; } else { x = clamp(x, 0, nx - 1); y = clamp(y, 0, ny - 1); }
      const i0 = Math.floor(x), j0 = Math.floor(y), i1 = wrap ? (i0 + 1) % nx : Math.min(i0 + 1, nx - 1), j1 = wrap ? (j0 + 1) % ny : Math.min(j0 + 1, ny - 1);
      const fx = x - i0, fy = y - j0;
      return lerp(lerp(u[j0 * nx + i0], u[j0 * nx + i1], fx), lerp(u[j1 * nx + i0], u[j1 * nx + i1], fx), fy);
    };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [vx, vy] = vel(i, j);
      out[j * nx + i] = sample(i - vx * dt, j - vy * dt);
    }
    G.u = out;
    return G;
  }

  // ---------- N-body gravity ----------
  // Leapfrog (kick-drift-kick) conserves energy over long runs, so orbits close.
  const NBODY_PRESETS = {
    // Chenciner and Montgomery's figure eight: three equal masses chasing on one curve (G = 1).
    figure8: () => {
      const v = [-0.93240737, -0.86473146];
      return [
        { m: 1, x: -0.97000436, y: 0.24308753, vx: -v[0] / 2, vy: -v[1] / 2 },
        { m: 1, x: 0.97000436, y: -0.24308753, vx: -v[0] / 2, vy: -v[1] / 2 },
        { m: 1, x: 0, y: 0, vx: v[0], vy: v[1] },
      ];
    },
    binary: () => [{ m: 1, x: -0.5, y: 0, vx: 0, vy: -0.5 }, { m: 1, x: 0.5, y: 0, vx: 0, vy: 0.5 }],
    // A heavy sun and planets on circular orbits at radii 1, 1.6, 2.5 (G = 1, sun mass 1).
    solar: () => [{ m: 1, x: 0, y: 0, vx: 0, vy: 0 }, ...[1, 1.6, 2.5].map((r, i) => ({ m: 1e-4, x: r * Math.cos(i * 2), y: r * Math.sin(i * 2), vx: -Math.sin(i * 2) / Math.sqrt(r), vy: Math.cos(i * 2) / Math.sqrt(r) }))],
  };
  const nbody = {
    presets: NBODY_PRESETS,
    create({ bodies = "figure8", G = 1, soft = 1e-3, h = 1 / 1000, trail = 400, trailEvery = 4 } = {}) {
      const list = typeof bodies === "string" ? NBODY_PRESETS[bodies]() : bodies.map(b => ({ vx: 0, vy: 0, ...b }));
      const w = { kind: "nbody", t: 0, acc: 0, h, maxSub: 2000, G, soft, b: list.map(b => ({ ...b, ax: 0, ay: 0 })), trail, trailEvery, trails: list.map(b => [[b.x, b.y]]), n: 0 };
      accel(w);
      return w;
    },
    step(w, dt) {
      return fixed(w, dt, h => {
        for (const b of w.b) { b.vx += b.ax * h / 2; b.vy += b.ay * h / 2; b.x += b.vx * h; b.y += b.vy * h; }
        accel(w);
        for (const b of w.b) { b.vx += b.ax * h / 2; b.vy += b.ay * h / 2; }
        if (++w.n % w.trailEvery === 0) w.b.forEach((b, i) => { const t = w.trails[i]; t.push([b.x, b.y]); if (t.length > w.trail) t.shift(); });
      });
    },
    energy(w) {
      let K = 0, U = 0;
      w.b.forEach((a, i) => {
        K += 0.5 * a.m * (a.vx * a.vx + a.vy * a.vy);
        for (let j = i + 1; j < w.b.length; j++) { const b = w.b[j]; U -= (w.G * a.m * b.m) / Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + w.soft * w.soft); }
      });
      return { kinetic: K, potential: U, total: K + U };
    },
    momentum(w) { let px = 0, py = 0; for (const b of w.b) { px += b.m * b.vx; py += b.m * b.vy; } return [px, py]; },
    center(w) { let m = 0, x = 0, y = 0; for (const b of w.b) { m += b.m; x += b.m * b.x; y += b.m * b.y; } return [x / m, y / m]; },
  };
  function accel(w) {
    const B = w.b, e2 = w.soft * w.soft;
    for (const b of B) b.ax = b.ay = 0;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j], dx = b.x - a.x, dy = b.y - a.y, r2 = dx * dx + dy * dy + e2, inv = w.G / (r2 * Math.sqrt(r2));
      a.ax += dx * inv * b.m; a.ay += dy * inv * b.m;
      b.ax -= dx * inv * a.m; b.ay -= dy * inv * a.m;
    }
  }

  // ---------- randomness: walkers, Monte Carlo, Ising ----------
  const walkers = {
    // n walkers starting at the origin, each step a Gaussian kick with diffusion constant D.
    create({ n = 200, D = 1, dims = 2, seed = 1, h = 1 / 60 } = {}) {
      return { kind: "walkers", t: 0, acc: 0, h, maxSub: 60, n, D, dims, rng: seed, x: new Float64Array(n), y: new Float64Array(n) };
    },
    step(w, dt) {
      return fixed(w, dt, h => {
        const s = Math.sqrt(2 * w.D * h);
        for (let i = 0; i < w.n; i++) { w.x[i] += s * gauss(w); if (w.dims > 1) w.y[i] += s * gauss(w); }
      });
    },
    // Mean squared displacement; theory says 2 · dims · D · t.
    msd(w) { let s = 0; for (let i = 0; i < w.n; i++) s += w.x[i] ** 2 + w.y[i] ** 2; return s / w.n; },
  };

  const mc = {
    // Throws n darts at the unit square; the share inside the quarter circle estimates π / 4.
    pi(state, n = 100) {
      state.inside ??= 0; state.total ??= 0; state.points ??= [];
      for (let i = 0; i < n; i++) {
        const x = random(state), y = random(state), hit = x * x + y * y <= 1;
        state.inside += hit; state.total++;
        state.points.push([x, y, hit ? 1 : 0]);
        if (state.points.length > 4000) state.points.shift();
      }
      return (4 * state.inside) / state.total;
    },
    random, gauss,
  };

  const ising = {
    // n by n spins (+1 / -1) at temperature T (in units of J / k), field h. init "random" | "up".
    create({ n = 64, T = 2.27, J = 1, field = 0, seed = 1, init = "random", rate = 30 } = {}) {
      const w = { kind: "ising", t: 0, acc: 0, h: 1 / rate, maxSub: 30, n, T, J, field, rng: seed, s: new Int8Array(n * n) };
      for (let k = 0; k < n * n; k++) w.s[k] = init === "up" ? 1 : random(w) < 0.5 ? -1 : 1;
      return w;
    },
    // One Metropolis sweep per substep: every spin is offered a flip once.
    step(w, dt) { return fixed(w, dt, () => ising.sweep(w)); },
    sweep(w) {
      const { n, s } = w;
      for (let parity = 0; parity < 2; parity++) for (let j = 0; j < n; j++) for (let i = (j + parity) % 2; i < n; i += 2) {
        const k = j * n + i;
        const nb = s[j * n + ((i + 1) % n)] + s[j * n + ((i - 1 + n) % n)] + s[((j + 1) % n) * n + i] + s[((j - 1 + n) % n) * n + i];
        const dE = 2 * s[k] * (w.J * nb + w.field);
        if (dE <= 0 || random(w) < Math.exp(-dE / w.T)) s[k] = -s[k];
      }
    },
    magnetization(w) { let m = 0; for (const v of w.s) m += v; return m / w.s.length; },
    energy(w) {
      const { n, s } = w;
      let e = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        e -= w.J * s[k] * (s[j * n + ((i + 1) % n)] + s[((j + 1) % n) * n + i]) + w.field * s[k];
      }
      return e / s.length;
    },
  };

  // ---------- classic ODE systems ----------
  // Each entry: (params) => f(t, y). Run one live with Sim.ode, or all at once with Sim.ode.run.
  const SYSTEMS = {
    // y = [x, v]; m, k, c (damping), F, omega (drive).
    oscillator: p => (t, y) => [y[1], (-(p.k ?? 1) * y[0] - (p.c ?? 0) * y[1] + (p.F ?? 0) * Math.cos((p.omega ?? 1) * t)) / (p.m ?? 1)],
    // y = [θ, ω]; the full sin θ, so wide swings slow down. L, g, c.
    pendulum: p => (t, y) => [y[1], -((p.g ?? 9.81) / (p.L ?? 1)) * Math.sin(y[0]) - (p.c ?? 0) * y[1]],
    // y = [θ1, θ2, ω1, ω2], angles from straight down. m1, m2, l1, l2, g.
    doublePendulum: p => {
      const m1 = p.m1 ?? 1, m2 = p.m2 ?? 1, l1 = p.l1 ?? 1, l2 = p.l2 ?? 1, g = p.g ?? 9.81;
      return (t, [a, b, w1, w2]) => {
        const d = a - b, den = 2 * m1 + m2 - m2 * Math.cos(2 * d);
        return [w1, w2,
          (-g * (2 * m1 + m2) * Math.sin(a) - m2 * g * Math.sin(a - 2 * b) - 2 * Math.sin(d) * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * Math.cos(d))) / (l1 * den),
          (2 * Math.sin(d) * (w1 * w1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(a) + w2 * w2 * l2 * m2 * Math.cos(d))) / (l2 * den)];
      };
    },
    // y = [x, y, z]; sigma, rho, beta (10, 28, 8/3 is the butterfly).
    lorenz: p => (t, [x, y, z]) => [(p.sigma ?? 10) * (y - x), x * ((p.rho ?? 28) - z) - y, x * y - (p.beta ?? 8 / 3) * z],
    // y = [S, I, R] as fractions; beta (contacts × chance), gamma (recovery rate per day).
    sir: p => (t, [S, I]) => { const inf = (p.beta ?? 0.3) * S * I, rec = (p.gamma ?? 0.1) * I; return [-inf, inf - rec, rec]; },
    // y = [prey, predators]; a, b, c, d.
    lotkaVolterra: p => (t, [x, y]) => [(p.a ?? 1) * x - (p.b ?? 0.5) * x * y, (p.d ?? 0.2) * x * y - (p.c ?? 0.6) * y],
  };
  function rk4(f, y, t, h) {
    const add = (a, k, s) => a.map((v, i) => v + k[i] * s);
    const k1 = f(t, y), k2 = f(t + h / 2, add(y, k1, h / 2)), k3 = f(t + h / 2, add(y, k2, h / 2)), k4 = f(t + h, add(y, k3, h));
    return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }
  const ode = {
    systems: SYSTEMS,
    // Live state for one system: { sys, p, y, t }. h: fixed RK4 step.
    create(sys, p = {}, y0, { h = 1 / 480 } = {}) {
      if (!SYSTEMS[sys]) throw new Error(`Sim.ode: no system "${sys}" (have ${Object.keys(SYSTEMS).join(", ")})`);
      return { kind: "ode", sys, p: { ...p }, y: [...y0], t: 0, acc: 0, h, maxSub: 2000, trail: [], trailMax: 0 };
    },
    step(st, dt) {
      const f = SYSTEMS[st.sys](st.p);
      return fixed(st, dt, h => {
        st.y = rk4(f, st.y, st.t, h);
        if (st.trailMax) { st.trail.push(st.y.slice()); if (st.trail.length > st.trailMax) st.trail.shift(); }
      });
    },
    // Whole trajectory: { t: [...], y: [[...], ...] }, sampled every `every` steps.
    run(sys, p, y0, T, { h = 1 / 240, every = 1 } = {}) {
      const f = SYSTEMS[sys](p), out = { t: [0], y: [[...y0]] };
      let y = [...y0];
      const n = Math.ceil(T / h);
      for (let i = 1; i <= n; i++) {
        y = rk4(f, y, (i - 1) * h, h);
        if (i % every === 0 || i === n) { out.t.push(i * h); out.y.push(y); }
      }
      return out;
    },
    // Where the bobs of a double pendulum are: [[x1, y1], [x2, y2]] with the pivot at the origin, y up.
    bobs(st) {
      const [a, b] = st.y, l1 = st.p.l1 ?? 1, l2 = st.p.l2 ?? 1;
      const x1 = l1 * Math.sin(a), y1 = -l1 * Math.cos(a);
      return [[x1, y1], [x1 + l2 * Math.sin(b), y1 - l2 * Math.cos(b)]];
    },
    // Total energy of a pendulum or double pendulum state (per unit mass for the single one).
    energy(st) {
      const p = st.p, g = p.g ?? 9.81;
      if (st.sys === "pendulum") { const L = p.L ?? 1; return 0.5 * (L * st.y[1]) ** 2 - g * L * Math.cos(st.y[0]); }
      if (st.sys === "doublePendulum") {
        const [a, b, w1, w2] = st.y, m1 = p.m1 ?? 1, m2 = p.m2 ?? 1, l1 = p.l1 ?? 1, l2 = p.l2 ?? 1;
        const [[, y1], [, y2]] = ode.bobs(st);
        return 0.5 * m1 * (l1 * w1) ** 2 + 0.5 * m2 * ((l1 * w1) ** 2 + (l2 * w2) ** 2 + 2 * l1 * l2 * w1 * w2 * Math.cos(a - b)) + m1 * g * y1 + m2 * g * y2;
      }
      if (st.sys === "oscillator") return 0.5 * (p.m ?? 1) * st.y[1] ** 2 + 0.5 * (p.k ?? 1) * st.y[0] ** 2;
      return NaN;
    },
  };

  // ---------- small neural networks ----------
  // Weights live in typed arrays inside plain objects, so a whole network (and its
  // optimizer state) can sit in a figure's state and be snapshotted like anything else.
  const ACT = {
    tanh: { f: Math.tanh, d: (y) => 1 - y * y },
    relu: { f: x => (x > 0 ? x : 0), d: (y) => (y > 0 ? 1 : 0) },
    sigmoid: { f: x => 1 / (1 + Math.exp(-x)), d: (y) => y * (1 - y) },
    linear: { f: x => x, d: () => 1 },
  };
  const nn = {
    // sizes: [inputs, hidden..., outputs]; act: hidden activation; out: "softmax" | "sigmoid" | "linear".
    mlp({ sizes = [2, 16, 16, 2], act = "tanh", out = "softmax", seed = 1 } = {}) {
      const net = { kind: "mlp", sizes, act, out, rng: seed, step: 0, layers: [] };
      for (let l = 0; l < sizes.length - 1; l++) {
        const nin = sizes[l], nout = sizes[l + 1], W = new Float64Array(nin * nout), b = new Float64Array(nout);
        const scale = act === "relu" && l < sizes.length - 2 ? Math.sqrt(2 / nin) : Math.sqrt(1 / nin);
        for (let k = 0; k < W.length; k++) W[k] = gauss(net) * scale;
        net.layers.push({ nin, nout, W, b, mW: new Float64Array(W.length), vW: new Float64Array(W.length), mb: new Float64Array(nout), vb: new Float64Array(nout) });
      }
      return net;
    },
    // Activations of every layer for input x: [x, h1, ..., output].
    activations(net, x) {
      const acts = [Float64Array.from(x)];
      net.layers.forEach((L, l) => {
        const a = acts[l], z = new Float64Array(L.nout), last = l === net.layers.length - 1;
        for (let o = 0; o < L.nout; o++) {
          let s = L.b[o];
          for (let i = 0; i < L.nin; i++) s += L.W[o * L.nin + i] * a[i];
          z[o] = s;
        }
        if (!last) for (let o = 0; o < L.nout; o++) z[o] = ACT[net.act].f(z[o]);
        else if (net.out === "softmax") softmaxInPlace(z);
        else if (net.out === "sigmoid") for (let o = 0; o < L.nout; o++) z[o] = ACT.sigmoid.f(z[o]);
        acts.push(z);
      });
      return acts;
    },
    forward(net, x) { const a = nn.activations(net, x); return Array.from(a[a.length - 1]); },
    // Loss for one example: cross-entropy against a class index (softmax), binary
    // cross-entropy against 0/1 (sigmoid), squared error against a target array (linear).
    loss(net, X, Y) {
      let s = 0;
      for (let n = 0; n < X.length; n++) s += exampleLoss(net, nn.forward(net, X[n]), Y[n]);
      return s / X.length;
    },
    accuracy(net, X, Y) {
      let ok = 0;
      for (let n = 0; n < X.length; n++) {
        const o = nn.forward(net, X[n]);
        const pred = o.length === 1 ? (o[0] > 0.5 ? 1 : 0) : o.indexOf(Math.max(...o));
        ok += pred === (Array.isArray(Y[n]) ? Y[n].indexOf(Math.max(...Y[n])) : Y[n]);
      }
      return ok / X.length;
    },
    // One optimizer step on a random mini-batch; returns the batch's mean loss.
    // opt: "adam" (default), "momentum", or "sgd". l2: weight decay.
    train(net, X, Y, { lr = 0.01, batch = 32, opt = "adam", beta1 = 0.9, beta2 = 0.999, momentum = 0.9, l2 = 0 } = {}) {
      const gW = net.layers.map(L => new Float64Array(L.W.length)), gb = net.layers.map(L => new Float64Array(L.nout));
      const B = Math.min(batch, X.length);
      let loss = 0;
      for (let k = 0; k < B; k++) {
        const n = Math.floor(random(net) * X.length);
        const acts = nn.activations(net, X[n]), o = acts[acts.length - 1], y = Y[n];
        loss += exampleLoss(net, o, y);
        // Output error: for softmax+CE, sigmoid+BCE and linear+MSE it is (output - target).
        let delta = new Float64Array(o.length);
        for (let i = 0; i < o.length; i++) delta[i] = o[i] - (net.out === "softmax" ? (i === y ? 1 : 0) : Array.isArray(y) ? y[i] : y);
        for (let l = net.layers.length - 1; l >= 0; l--) {
          const L = net.layers[l], a = acts[l];
          for (let oi = 0; oi < L.nout; oi++) {
            gb[l][oi] += delta[oi];
            for (let i = 0; i < L.nin; i++) gW[l][oi * L.nin + i] += delta[oi] * a[i];
          }
          if (l === 0) break;
          const prev = new Float64Array(L.nin);
          for (let i = 0; i < L.nin; i++) {
            let s = 0;
            for (let oi = 0; oi < L.nout; oi++) s += L.W[oi * L.nin + i] * delta[oi];
            prev[i] = s * ACT[net.act].d(a[i]);
          }
          delta = prev;
        }
      }
      net.step++;
      const t = net.step;
      net.layers.forEach((L, l) => {
        const upd = (P, G, m, v) => {
          for (let i = 0; i < P.length; i++) {
            const gi = G[i] / B + l2 * P[i];
            if (opt === "adam") {
              m[i] = beta1 * m[i] + (1 - beta1) * gi;
              v[i] = beta2 * v[i] + (1 - beta2) * gi * gi;
              P[i] -= (lr * (m[i] / (1 - beta1 ** t))) / (Math.sqrt(v[i] / (1 - beta2 ** t)) + 1e-8);
            } else if (opt === "momentum") {
              m[i] = momentum * m[i] + gi;
              P[i] -= lr * m[i];
            } else P[i] -= lr * gi;
          }
        };
        upd(L.W, gW[l], L.mW, L.vW);
        upd(L.b, gb[l], L.mb, L.vb);
      });
      return loss / B;
    },
    // Output `cls` (or the single output) over a grid of inputs, for decision-boundary pictures:
    // Float64Array of nx * ny values, row j covers y = y0 + (j + 0.5) / ny * (y1 - y0).
    grid(net, [x0, x1], [y0, y1], nx = 48, ny = 32, cls = 1) {
      // A forward pass that reuses two buffers: thousands of points per frame stay cheap.
      const width = Math.max(...net.sizes), A = new Float64Array(width), Bf = new Float64Array(width), act = ACT[net.act].f;
      const out = new Float64Array(nx * ny), last = net.layers.length - 1;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        A[0] = x0 + ((i + 0.5) / nx) * (x1 - x0);
        A[1] = y0 + ((j + 0.5) / ny) * (y1 - y0);
        let a = A, b = Bf;
        net.layers.forEach((L, l) => {
          for (let o = 0; o < L.nout; o++) {
            let s = L.b[o];
            const row = o * L.nin;
            for (let k = 0; k < L.nin; k++) s += L.W[row + k] * a[k];
            b[o] = l < last ? act(s) : s;
          }
          [a, b] = [b, a];
        });
        const n = net.sizes[net.sizes.length - 1];
        let v;
        if (net.out === "softmax") { let m = -Infinity, sum = 0; for (let k = 0; k < n; k++) m = Math.max(m, a[k]); for (let k = 0; k < n; k++) sum += Math.exp(a[k] - m); v = Math.exp(a[n === 1 ? 0 : cls] - m) / sum; }
        else if (net.out === "sigmoid") v = 1 / (1 + Math.exp(-a[0]));
        else v = a[n === 1 ? 0 : cls];
        out[j * nx + i] = v;
      }
      return out;
    },
    params(net) { return net.layers.reduce((s, L) => s + L.W.length + L.b.length, 0); },
  };
  function softmaxInPlace(z, T = 1) {
    let m = -Infinity;
    for (const v of z) m = Math.max(m, v / T);
    let s = 0;
    for (let i = 0; i < z.length; i++) { z[i] = Math.exp(z[i] / T - m); s += z[i]; }
    for (let i = 0; i < z.length; i++) z[i] /= s;
    return z;
  }
  const softmax = (xs, T = 1) => Array.from(softmaxInPlace(Float64Array.from(xs), T));
  function exampleLoss(net, o, y) {
    if (net.out === "softmax") return -Math.log(Math.max(o[y], 1e-12));
    if (net.out === "sigmoid") return -(y * Math.log(Math.max(o[0], 1e-12)) + (1 - y) * Math.log(Math.max(1 - o[0], 1e-12)));
    const t = Array.isArray(y) ? y : [y];
    return o.reduce((s, v, i) => s + 0.5 * (v - t[i]) ** 2, 0);
  }

  // Toy datasets, seeded: arrays X (points) and Y (class indices).
  const data = {
    spirals({ n = 100, classes = 2, turns = 1.5, noise = 0.08, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      for (let c = 0; c < classes; c++) for (let i = 0; i < n; i++) {
        const r = (i + 1) / n, a = (c * TAU) / classes + r * turns * TAU;
        X.push([r * Math.cos(a) + noise * gauss(st), r * Math.sin(a) + noise * gauss(st)]);
        Y.push(c);
      }
      return { X, Y };
    },
    blobs({ n = 100, centers = [[-0.5, -0.5], [0.5, 0.5]], spread = 0.25, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      centers.forEach((c, k) => { for (let i = 0; i < n; i++) { X.push([c[0] + spread * gauss(st), c[1] + spread * gauss(st)]); Y.push(k); } });
      return { X, Y };
    },
    xor({ n = 50, spread = 0.18, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      for (const [x, y, c] of [[-0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, -0.5, 1]]) for (let i = 0; i < n; i++) { X.push([x + spread * gauss(st), y + spread * gauss(st)]); Y.push(c); }
      return { X, Y };
    },
    circles({ n = 150, noise = 0.06, ratio = 0.45, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) { const a = random(st) * TAU, r = c ? ratio : 1; X.push([r * Math.cos(a) + noise * gauss(st), r * Math.sin(a) + noise * gauss(st)]); Y.push(c); }
      return { X, Y };
    },
    moons({ n = 150, noise = 0.08, seed = 1 } = {}) {
      const st = { rng: seed }, X = [], Y = [];
      for (let i = 0; i < n; i++) { const a = random(st) * Math.PI; X.push([Math.cos(a) - 0.5 + noise * gauss(st), Math.sin(a) - 0.25 + noise * gauss(st)]); Y.push(0); }
      for (let i = 0; i < n; i++) { const a = random(st) * Math.PI; X.push([0.5 - Math.cos(a) + noise * gauss(st), 0.25 - Math.sin(a) + noise * gauss(st)]); Y.push(1); }
      return { X, Y };
    },
  };

  // ---------- a tiny language model ----------
  // Character (or word) bigrams: what comes next, given only the previous token.
  // `counts` builds it exactly from a text; `learner` learns the same table by gradient
  // descent, so a page can show a loss falling toward the count-based answer.
  const tokenize = (text, level) => (level === "word" ? text.toLowerCase().match(/[a-z']+|[.,!?;]/g) ?? [] : [...text]);
  const lm = {
    counts(text, { level = "char", smoothing = 0 } = {}) {
      const toks = tokenize(text, level), vocab = [...new Set(toks)].sort(), V = vocab.length, index = Object.fromEntries(vocab.map((t, i) => [t, i]));
      const counts = Array.from({ length: V }, () => new Array(V).fill(smoothing));
      for (let i = 1; i < toks.length; i++) counts[index[toks[i - 1]]][index[toks[i]]]++;
      return { kind: "bigram", level, vocab, index, counts, V };
    },
    // Probabilities of each next token after `prev` (temperature T sharpens or flattens).
    next(model, prev, { T = 1 } = {}) {
      const i = model.index[prev];
      if (i === undefined) return new Array(model.V).fill(1 / model.V);
      if (model.kind === "bigram") {
        const row = model.counts[i], total = row.reduce((s, v) => s + v, 0) || 1;
        if (T === 1) return row.map(v => v / total);
        return softmax(row.map(v => Math.log(Math.max(v / total, 1e-12))), T);
      }
      return softmax(Array.from(model.W.subarray(i * model.V, (i + 1) * model.V)), T);
    },
    // Generates n tokens after `start`. st carries the rng (st.rng), so the same seed gives the same text.
    // topK keeps only the k likeliest; topP keeps the smallest set whose probabilities add to p.
    sample(model, st, start, n = 40, { T = 1, topK = 0, topP = 1 } = {}) {
      const out = [start];
      let prev = start;
      for (let k = 0; k < n; k++) {
        let p = lm.next(model, prev, { T }).map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
        if (topK) p = p.slice(0, topK);
        if (topP < 1) { let s = 0; p = p.filter(([v]) => (s += v) - v < topP); }
        const total = p.reduce((s, [v]) => s + v, 0);
        let r = random(st) * total, pick = p[p.length - 1][1];
        for (const [v, i] of p) { r -= v; if (r <= 0) { pick = i; break; } }
        prev = model.vocab[pick];
        out.push(prev);
      }
      return model.level === "word" ? out.join(" ") : out.join("");
    },
    // Average surprise per token in nats (cross-entropy); exp() of it is the perplexity.
    crossEntropy(model, text) {
      const toks = tokenize(text, model.level);
      let s = 0, n = 0;
      for (let i = 1; i < toks.length; i++) {
        if (model.index[toks[i - 1]] === undefined || model.index[toks[i]] === undefined) continue;
        s -= Math.log(Math.max(lm.next(model, toks[i - 1])[model.index[toks[i]]], 1e-12));
        n++;
      }
      return n ? s / n : NaN;
    },
    learner(text, { level = "char", seed = 1 } = {}) {
      const base = lm.counts(text, { level }), toks = tokenize(text, level);
      const pairs = new Int32Array(Math.max(0, (toks.length - 1) * 2));
      for (let i = 1; i < toks.length; i++) { pairs[(i - 1) * 2] = base.index[toks[i - 1]]; pairs[(i - 1) * 2 + 1] = base.index[toks[i]]; }
      const m = { kind: "learned", level, vocab: base.vocab, index: base.index, V: base.V, W: new Float64Array(base.V * base.V), pairs, rng: seed, step: 0 };
      for (let k = 0; k < m.W.length; k++) m.W[k] = 0.01 * gauss(m);
      return m;
    },
    // One gradient step on a random batch of (previous, next) pairs; returns the batch loss.
    train(m, { lr = 1, batch = 64 } = {}) {
      const n = m.pairs.length / 2, G = new Float64Array(m.W.length);
      let loss = 0;
      for (let k = 0; k < batch; k++) {
        const r = Math.floor(random(m) * n), a = m.pairs[r * 2], b = m.pairs[r * 2 + 1];
        const p = softmax(Array.from(m.W.subarray(a * m.V, (a + 1) * m.V)));
        loss -= Math.log(Math.max(p[b], 1e-12));
        for (let j = 0; j < m.V; j++) G[a * m.V + j] += p[j] - (j === b ? 1 : 0);
      }
      for (let k = 0; k < G.length; k++) m.W[k] -= (lr * G[k]) / batch;
      m.step++;
      return loss / batch;
    },
  };

  // ---------- one attention head ----------
  // Exact arithmetic on small matrices (arrays of rows), so every number a figure
  // shows (a score, a weight, an output) is the real result for those inputs.
  const matmul = (A, B) => A.map(row => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  const transpose = A => A[0].map((_, j) => A.map(r => r[j]));
  const attention = {
    // Random projection matrices for model width d and head width dk (and dv).
    init({ d = 8, dk = 4, dv = dk, seed = 1 } = {}) {
      const st = { rng: seed }, M = (r, c) => Array.from({ length: r }, () => Array.from({ length: c }, () => gauss(st) / Math.sqrt(d)));
      return { Wq: M(d, dk), Wk: M(d, dk), Wv: M(d, dv) };
    },
    // X: n token vectors (rows of width d). causal: each token sees only itself and earlier ones.
    // Returns Q, K, V, raw scores (Q·Kᵀ/√dk), weights (each row sums to 1), and out (weights · V).
    head(X, { Wq, Wk, Wv }, { causal = false, T = 1 } = {}) {
      const Q = matmul(X, Wq), K = matmul(X, Wk), V = matmul(X, Wv), dk = Wq[0].length;
      const scores = matmul(Q, transpose(K)).map((row, i) => row.map((v, j) => (causal && j > i ? -Infinity : v / Math.sqrt(dk))));
      const weights = scores.map(row => softmax(row.map(v => (v === -Infinity ? -1e9 : v)), T));
      return { Q, K, V, scores, weights, out: matmul(weights, V) };
    },
    // Sinusoidal position vectors (the original Transformer's), n positions of width d.
    positions(n, d) {
      return Array.from({ length: n }, (_, p) => Array.from({ length: d }, (_, i) => {
        const f = 1 / 10000 ** ((2 * Math.floor(i / 2)) / d);
        return i % 2 ? Math.cos(p * f) : Math.sin(p * f);
      }));
    },
    matmul, transpose,
  };

  // ---------- drawing ----------
  // Helpers in the house style. P maps world coordinates to the canvas (g.fit or g.graph).
  const draw = {
    // Springs colored by strain (blue squeezed, red stretched), rods in ink, particles as porcelain beads.
    particles(g, P, w, { springs = true, rods = true, beads = true, strain = true, color = "ink", rodColor = null, rodWidth = null, radius = null, hide = null } = {}) {
      const S = strain ? particles.strain(w) : null;
      if (springs) w.springs.forEach((s, k) => {
        if (hide && (hide(s.a) || hide(s.b))) return;
        const A = w.p[s.a], B = w.p[s.b], e = S ? clamp(S[k] * 6, -1, 1) : 0;
        g.line(P([A.x, A.y]), P([B.x, B.y]), { stroke: e > 0.05 ? g.mix("muted", "red", e) : e < -0.05 ? g.mix("muted", "blue", -e) : "muted", width: 1.25 });
      });
      if (rods) for (const r of w.rods) {
        if (hide && (hide(r.a) || hide(r.b))) continue;
        const A = w.p[r.a], B = w.p[r.b];
        g.line(P([A.x, A.y]), P([B.x, B.y]), { stroke: rodColor ?? color, width: rodWidth ?? (w.rods.length > 60 ? 1 : 2) });
      }
      for (const s of w.walls) g.line(P(s.a), P(s.b), { stroke: "ink", width: 2 });
      if (beads) w.p.forEach((p, i) => {
        if (hide && hide(i)) return;
        const r = radius ?? Math.max(2, p.r * (P.sx ?? 100));
        const at = P([p.x, p.y]);
        if (p.pin) g.rect(at[0] - r - 1, at[1] - r - 1, 2 * r + 2, 2 * r + 2, { fill: "ink", r: 1.5 });
        else g.circle(at, r, { fill: "panel", stroke: color, width: 1.25 });
      });
      if (w.mouse) {
        const p = w.p[w.mouse.i];
        if (p) g.line(P([p.x, p.y]), P([w.mouse.x, w.mouse.y]), { stroke: "orange", width: 1.5, dash: [4, 3] });
      }
    },
    // Rigid bodies as porcelain plates with graphite outlines; statics hatched; b.color tints a body.
    rigid(g, P, w, { stroke = "ink", contacts = false } = {}) {
      w.bodies.forEach(b => {
        const fill = b.color ? g.rgba(b.color, 0.28) : "panel", line = b.color ?? stroke;
        if (b.type === "circle") {
          const c = P([b.x, b.y]), r = b.r * (P.sx ?? 100);
          g.circle(c, r, { fill, stroke: line, width: 1.5, hatch: b.static ? g.rgba("muted", 0.5) : null });
          g.line(c, P([b.x + Math.cos(b.a) * b.r, b.y + Math.sin(b.a) * b.r]), { stroke: line, width: 1.25 });
        } else {
          g.path(rigid.vertices(b).map(v => P(v)), { close: true, fill, stroke: line, width: 1.5, hatch: b.static ? g.rgba("muted", 0.5) : null });
        }
      });
      if (contacts) for (const c of w.contacts) g.circle(P(c.p), 2.5, { fill: "red" });
      const a = rigid.anchor(w);
      if (a) {
        g.line(P(a), P([w.mouse.x, w.mouse.y]), { stroke: "orange", width: 1.5, dash: [4, 3] });
        g.circle(P(a), 3.5, { fill: "orange" });
      }
    },
    // A grid as color: map "diverging" (low color, paper, high color) or "sequential" (paper to high).
    // value: which array to show ("u" by default; "v" for Gray-Scott). box: [x, y, w, h] in canvas pixels.
    field(g, G, o = {}) { g.gridField(G[o.value ?? "u"] ?? G.u, G.nx, G.ny, o); },
    // Ising spins as two tones.
    spins(g, w, o = {}) { g.gridField(w.s, w.n, w.n, { map: "diverging", range: [-1, 1], smooth: false, ...o }); },
    // N-body trails and bodies sized by the cube root of mass.
    nbody(g, P, w, { colors = ["blue", "red", "green", "orange", "purple"], trails = true, scale = 6 } = {}) {
      if (trails) w.trails.forEach((t, i) => g.path(t.map(q => P(q)), { stroke: colors[i % colors.length], width: 1.25, alpha: 0.55 }));
      w.b.forEach((b, i) => g.circle(P([b.x, b.y]), Math.max(2.5, scale * Math.cbrt(b.m / Math.max(...w.b.map(x => x.m))) ), { fill: colors[i % colors.length], stroke: "panel", width: 1.5 }));
    },
  };

  // Canvas helper that draws a grid of values as color, with the palette read at draw time.
  (window.__safisG ||= []).push((g, util) => {
    g.gridField = (arr, nx, ny, o = {}) => {
      const box = o.box ?? [0, 0, g.w, g.h], [lo, hi] = o.range ?? [-1, 1], map = o.map ?? "diverging";
      const paper = util.rgb(o.paper ?? "panel"), neg = util.rgb(o.low ?? "blue"), pos = util.rgb(o.high ?? "red");
      const cv = document.createElement("canvas");
      cv.width = nx; cv.height = ny;
      const c2 = cv.getContext("2d"), img = c2.createImageData(nx, ny);
      // Row 0 of the grid is drawn at the bottom (y up), like the world coordinates.
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const v = arr[j * nx + i], k = ((o.flip ? j : ny - 1 - j) * nx + i) * 4;
        let col;
        if (map === "diverging") {
          const t = clamp((v - (lo + hi) / 2) / ((hi - lo) / 2), -1, 1), s = Math.pow(Math.abs(t), 0.8) * 0.85, end = t < 0 ? neg : pos;
          col = [0, 1, 2].map(q => paper[q] + (end[q] - paper[q]) * s);
        } else {
          const t = clamp((v - lo) / (hi - lo), 0, 1);
          col = [0, 1, 2].map(q => paper[q] + (pos[q] - paper[q]) * t);
        }
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = Number.isFinite(v) ? 255 : 0;
      }
      c2.putImageData(img, 0, 0);
      const ctx = g.ctx;
      ctx.save();
      ctx.imageSmoothingEnabled = o.smooth !== false;
      ctx.imageSmoothingQuality = "high";
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      ctx.drawImage(cv, box[0], box[1], box[2], box[3]);
      ctx.restore();
    };
  });

  window.Sim = {
    particles, rigid, wave, heat, grayScott, advect, nbody, walkers, mc, ising, ode, nn, data, lm, attention, draw,
    random, gauss, softmax, fixed,
  };
})();
