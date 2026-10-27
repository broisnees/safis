# Simulations reference

`window.Sim` runs real models in the page: a figure whose motion comes from a simulator teaches what the physics (or the learning rule) actually does, and every number it shows is true. Use it whenever a figure moves because of forces, fields, chance, or training. Script an animation only for motion that has no model (a hand-drawn diagram sliding into place).

Contents: [rules](#rules-every-simulator-follows), [which simulator](#which-simulator), [particles](#particles-ropes-nets-springs), [rigid bodies](#rigid-bodies), [grids](#fields-on-grids), [N-body](#n-body-gravity), [randomness](#randomness), [ODE systems](#ode-systems), [neural networks](#neural-networks), [language model and attention](#language-model-and-attention), [drawing](#drawing), [3D builders](#3d-builders-for-math-and-science), [budgets](#performance-budgets), [examples](#examples).

## Rules every simulator follows

- **State is plain data.** Every `create` returns numbers, arrays, and typed arrays, never functions.
- **Something visible from the first frame.** A field that starts flat (a still tank) draws as an empty canvas; mark the sources or start with a pulse. Keep it in the figure's state (`state: () => ({ w: Sim.rigid.create() })`) so reset, the self-check, and the exploration script can snapshot and restore it. Don't store anything that holds a function (a callback, a closure, a DOM node) next to it.
- **Fixed clock.** `step(state, dt)` banks `dt` and runs whole substeps of `state.h`, so 30 fps and 144 fps give the same result. Call it from `step(dt, s)` and nowhere else. To show slow motion, pass `dt * 0.25`; to run faster than real time, pass a bigger `dt` or raise `state.h` within its stability limit.
- **Seeded randomness.** Everything random draws from the integer `rng` kept in the state (`seed` at creation), so the same page shows the same "random" data every time, and a restored snapshot continues the same stream. `Sim.random(obj)` and `Sim.gauss(obj)` draw from `obj.rng` for your own randomness.
- **Units are yours.** Pick world units (meters, seconds) and keep them; `g.fit` maps them to pixels. Defaults assume meters and seconds with gravity 9.81.

## Which simulator

| The figure shows | Use |
|---|---|
| Ropes, chains, nets, cloth, springs, soft bodies, pendulums made of links | `Sim.particles` |
| Boxes, balls, and polygons that collide, stack, tip, and slide | `Sim.rigid` |
| Waves on a string or a pond, interference, diffraction through slits | `Sim.wave` |
| Heat spreading, diffusion, cooling | `Sim.heat` |
| Patterns from chemistry (spots, stripes, coral) | `Sim.grayScott` |
| Something carried along by a flow | `Sim.advect` |
| Orbits, binary stars, three-body motion | `Sim.nbody` |
| Brownian motion, diffusion as random steps, estimating by sampling, magnets near a phase transition | `Sim.walkers`, `Sim.mc`, `Sim.ising` |
| A pendulum at any swing, a double pendulum, a driven oscillator, Lorenz, SIR epidemics, predator and prey | `Sim.ode` |
| A network learning from data, a decision boundary, a loss curve | `Sim.nn`, `Sim.data` |
| Next-word probabilities, sampling with temperature, a single attention head | `Sim.lm`, `Sim.attention` |

## Particles: ropes, nets, springs

Position-based dynamics with velocity Verlet forces: springs, gravity, drag, and the mouse are forces; rods, pins, walls, bounds, and collisions are constraints enforced on positions, so they are stable at any stiffness. Stiff springs get extra inner steps automatically, so no setting can blow up.

| call | |
|---|---|
| `Sim.particles.create({ gravity: [0, -9.81], drag, h: 1/240, iterations: 8, restitution, friction, collide: false, bounds: [x0, y0, x1, y1] })` | A world. `collide: true` makes particles bump each other (spatial hash; thousands are fine). |
| `add(w, { x, y, vx, vy, m: 1, r: 0.05, pinned })` | A particle; returns its index. `m: 0` or `pinned` makes it immovable. |
| `spring(w, a, b, { k, damping, rest })`, `rod(w, a, b, { rest, stiffness: 1, slack })` | Links. Rods hold their length (`slack: true` lets a string go loose). |
| `pin(w, i, at)`, `unpin(w, i, m)`, `wall(w, [x, y], [x, y])` | Fix a particle (optionally at a point); static segments particles bounce off. |
| `rope(w, a, b, n, { mass, spring, pinEnd, slack })`, `cloth(w, { x, y, width, height, nx, ny, shear, springs, stiffness, pin })` | Builders. Ropes use rods unless `spring: k`. In 2D a fully braced cloth is a rigid plate; use `shear: false` and pin a few points (`pin: [[0, 0], [nx - 1, 0]]`) for a net that sags and sways. |
| `step(w, dt)` | Advance. |
| `nearest(w, q, radius)`, `grab(w, q, radius)`, `drag(w, q)`, `release(w)` | Mouse dragging through a stiff damped spring. Use `nearest` in `drag.hit` (it must not change state), `grab` in `drag.start`. |
| `energy(w)` → `{ kinetic, potential, elastic, total }`, `momentum(w)`, `strain(w)` | Readouts. Undamped spring systems keep `total` flat to about 1%. |
| `touch(w)` | Call after editing positions or springs by hand. |

## Rigid bodies

Sequential impulses with warm starting and speculative contacts (Box2D Lite's approach): a dozen boxes stack still, a ball knocks them over, friction holds a block on a slope.

| call | |
|---|---|
| `Sim.rigid.create({ gravity, h: 1/120, iterations: 12, friction: 0.5, restitution: 0.1 })` | A world. |
| `box(w, x, y, width, height, o)`, `circle(w, x, y, r, o)`, `poly(w, points, o)`, `ground(w, y, { x0, x1 })` | Bodies; return indices. `o`: `angle`, `vx`, `vy`, `omega`, `density` or `mass`, `static`, `friction`, `restitution`, `color` (palette name for the tint), `name`. Polygons must be convex. |
| `step(w, dt)`, `vertices(body)`, `hit(w, q)` | Advance; world corners of a polygon; body under a point. |
| `grab(w, q)`, `drag(w, q)`, `release(w)`, `anchor(w)` | Mouse spring on the grabbed point. |
| `energy(w)`, `momentum(w)` → `{ linear, angular }`, `w.contacts` | Readouts; the last step's contact points and normal impulses, for drawing forces. |

## Fields on grids

A grid is `{ nx, ny, u: Float64Array(nx * ny) }`; cell `(i, j)` is `u[j * nx + i]`, row 0 at the bottom; `ny: 1` is a 1D grid. `dx` is the cell size in world units.

| call | |
|---|---|
| `Sim.wave.create({ nx, ny, c, dx, damping, boundary: "fixed" \| "free" \| "absorbing" })` | Leapfrog wave equation at a stable Courant number. `"absorbing"` lets waves leave the tank. |
| `wave.source(G, i, j, { amp, freq, phase, soft })`, `wave.pulse(G, x0, y0, { amp, sigma, moving })`, `wave.walls(G, (i, j) => bool)` | Driven points (hard by default), a Gaussian bump (`moving: ±1` sends a 1D pulse one way), cells held still (slits, barriers). |
| `wave.energy(G)` | The energy the scheme conserves exactly (no damping, fixed edges). |
| `Sim.heat.create({ nx, ny, D, dx, boundary: "insulated" \| "fixed", edge })`, `heat.hold(G, mask)`, `heat.total(G)` | Diffusion; insulated edges conserve the total. The step is `0.9 dx² / (2 · dims · D)`: choose `D` and `dx` so that is around 1/600 s or longer. |
| `Sim.grayScott.create({ nx, ny, preset, F, k, seed, rate: 600 })`, `grayScott.seed(G, x, y, r)`, `grayScott.presets` | Reaction-diffusion; presets `coral`, `mitosis`, `spots`, `maze`, `worms`, `waves`. Patterns take a few seconds to grow; draw `value: "v"`. |
| `Sim.advect(G, (i, j) => [vx, vy], dt, { wrap })` | Semi-Lagrangian transport (velocity in cells per second). |

## N-body gravity

`Sim.nbody.create({ bodies, G: 1, soft, h: 1/1000, trail })`: `bodies` is a preset (`"figure8"`, `"binary"`, `"solar"`) or `[{ m, x, y, vx, vy }]`. Leapfrog keeps energy within about 10⁻⁷ over an orbit, so orbits close. `energy(w)`, `momentum(w)`, `center(w)`, and `w.trails` (recent positions per body).

## Randomness

- `Sim.walkers.create({ n, D, dims, seed })`: Brownian walkers from the origin; `msd(w)` is the mean squared displacement (theory: 2 · dims · D · t). Positions are `w.x`, `w.y`.
- `Sim.mc.pi(state, n)`: throws `n` darts and returns the running estimate of π; `state.points` holds the last 4000 `[x, y, inside]`.
- `Sim.ising.create({ n, T, J, field, seed, init: "random" | "up" })`: Metropolis on an n × n lattice, one sweep per substep; `magnetization(w)`, `energy(w)`. The critical temperature is about 2.27.

## ODE systems

`Sim.ode.create(name, params, y0, { h })` makes a live state; `Sim.ode.step(st, dt)` advances it with RK4; `Sim.ode.run(name, params, y0, T, { h, every })` returns a whole trajectory `{ t, y }` for plotting.

| name | `y` | params |
|---|---|---|
| `oscillator` | `[x, v]` | `m`, `k`, `c` (damping), `F`, `omega` (drive) |
| `pendulum` | `[θ, ω]` | `L`, `g`, `c` (full sin θ: wide swings are slower) |
| `doublePendulum` | `[θ1, θ2, ω1, ω2]` | `m1`, `m2`, `l1`, `l2`, `g`; `Sim.ode.bobs(st)` gives the bob positions |
| `lorenz` | `[x, y, z]` | `sigma`, `rho`, `beta` |
| `sir` | `[S, I, R]` (fractions) | `beta`, `gamma` |
| `lotkaVolterra` | `[prey, predators]` | `a`, `b`, `c`, `d` |

`Sim.ode.energy(st)` for the pendulums and the oscillator. For your own equations, `Num.rk4` and `Num.advance` take any `f(t, y)`.

## Neural networks

- `Sim.nn.mlp({ sizes: [2, 16, 16, 2], act: "tanh" | "relu" | "sigmoid", out: "softmax" | "sigmoid" | "linear", seed })`: weights and optimizer state in typed arrays.
- `Sim.nn.train(net, X, Y, { lr, batch: 32, opt: "adam" | "momentum" | "sgd", l2 })`: one step on a random mini-batch; returns its loss. Labels are class indices for softmax, 0/1 for sigmoid, target arrays for linear.
- `forward(net, x)`, `activations(net, x)` (every layer, for drawing a network lighting up), `loss(net, X, Y)`, `accuracy(net, X, Y)`, `params(net)`.
- `Sim.nn.grid(net, [x0, x1], [y0, y1], nx, ny, cls)`: the class-`cls` probability over a grid, for a decision-boundary picture with `g.gridField`.
- `Sim.data.spirals | blobs | xor | circles | moons({ n, noise, seed })` → `{ X, Y }`.

## Language model and attention

- `Sim.lm.counts(text, { level: "char" | "word", smoothing })`: a bigram table counted from a text. `Sim.lm.next(model, prev, { T })` gives next-token probabilities (temperature `T`); `Sim.lm.sample(model, st, start, n, { T, topK, topP })` generates text from the seed in `st.rng`; `Sim.lm.crossEntropy(model, text)` is the average surprise in nats (`exp` of it is the perplexity).
- `Sim.lm.learner(text, { level, seed })` and `Sim.lm.train(m, { lr, batch })`: the same table learned by gradient descent, so a page can show a loss falling toward the counted answer.
- `Sim.attention.init({ d, dk, dv, seed })` → `{ Wq, Wk, Wv }`; `Sim.attention.head(X, W, { causal, T })` → `{ Q, K, V, scores, weights, out }` with exact arithmetic (each row of `weights` sums to 1); `Sim.attention.positions(n, d)` gives sinusoidal position vectors. Matrices are arrays of rows; `Sim.attention.matmul` and `transpose` are there for your own steps.
- State the toy's size on the page ("a 30-word vocabulary", "8 dimensions"); don't present it as a real model's numbers.

## Drawing

`P` is the mapping from `g.fit` or `g.graph`.

| call | draws |
|---|---|
| `Sim.draw.particles(g, P, w, { springs, rods, beads, strain, color, rodColor, rodWidth, hide })` | Springs colored by strain (blue squeezed, red stretched), rods, walls, porcelain beads, pinned points as ink squares, the mouse spring dashed in orange. |
| `Sim.draw.rigid(g, P, w, { contacts })` | Bodies as porcelain plates with graphite outlines, statics hatched, `color` tints, the mouse spring. |
| `Sim.draw.field(g, G, { value, map, range, low, high, box, alpha, smooth })` | A grid as color: `"diverging"` (low color, paper, high color; waves) or `"sequential"` (paper to high; concentrations). Uses `g.gridField(array, nx, ny, o)`, which you can call on any array. |
| `Sim.draw.spins(g, w)`, `Sim.draw.nbody(g, P, w, { colors, trails })` | Ising lattice; bodies and their trails. |

## 3D builders for math and science

In `E3` (see [engine3d.md](engine3d.md)). The engine is y-up, so a math surface z = f(x, y) is built as height y = f(x, z) over the floor.

| call | |
|---|---|
| `E3.mesh.surface(f, { x: [x0, x1], z: [z0, z1], n, nz, doubleSided })` | Height field; `NaN` leaves holes. Drawn from both sides by default. |
| `E3.mesh.surfaceBands(f, { ..., bands: 8, range })` → `{ meshes, levels, range }` | The surface cut exactly at `bands` levels: add each mesh as its own node and color it with `E3.ramp(k / (bands - 1))`; the outlines between bands are the contour lines. |
| `E3.mesh.parametric((u, v) => [x, y, z], { u, v, nu, nv, wrapU, wrapV })` | Spheres, tori, saddles, Möbius strips. |
| `E3.mesh.glyphs(points, vectors, { scale, radius, maxLength })` | A vector field as arrows (one mesh). |
| `E3.mesh.polyline(points, r, { dots })` | A trajectory or field line as a wire. |
| `E3.axes3(scene, { x, y, z, ticks, origin, grid, names, format })` → `{ nodes, labels }` | Graphite axes with ticks (and a floor grid); draw `labels` with `view.project(l.at)` and `g.text`. |
| `E3.ramp(t, stops = ["blue", "porcelain", "red"])` | A color between palette stops; call it in `draw` so it follows dark mode. |

## Performance budgets

Measured per 60 Hz frame on a laptop (Node, comparable in Chrome). Aim to keep a figure's simulation under about 3 ms, since a page may run two figures at once.

| setup | ms per frame |
|---|---|
| Net, 234 particles and 425 rods at 240 Hz | 0.5 |
| Cloth, 750 particles and 2,800 rods | 3.1 (the practical limit) |
| 40 stacked boxes at 120 Hz / 120 boxes | 0.5 / 1.2 |
| 2D wave tank 200 × 125 | 0.4 |
| Gray-Scott 160 × 100 at 600 steps/s | 1.8 |
| Heat 120 × 80 | 0.1 |
| 50 bodies of gravity at 1000 Hz | 0.1 |
| Ising 128 × 128 at 30 sweeps/s | 0.15 |
| MLP 2-16-16-2, 8 batches of 32 per frame | 1.0 |
| Decision grid 60 × 60 of that MLP | 4.4: use 40 × 40, or recompute every third frame |

Figures only step while on screen. For anything heavier, lower the resolution, raise `h` within its stability limit, or precompute with `run`.

## Examples

**A ball on a rope you can drag**

```html
<figure class="demo" id="swing" aria-label="A ball hanging on a rope from a pin; drag the ball."></figure>
<script>
{
  let P;
  demo("swing", {
    aspect: 1.4,
    state: () => { const w = Sim.particles.create({ drag: 0.05 }); const ids = Sim.particles.rope(w, [0, 1], [1, 1], 12); w.p[ids[11]].im = 1 / 0.5; w.p[ids[11]].r = 0.07; return { w }; },
    reset: true,
    step(dt, s) { Sim.particles.step(s.w, dt); },
    draw(g, s) { P = g.fit(-1.3, 1.3, -0.8, 1.2); Sim.draw.particles(g, P, s.w, { color: "blue" }); },
    drag: {
      hit: (p, s) => Sim.particles.nearest(s.w, P.inv(p), 0.15) >= 0,
      start: (p, s) => Sim.particles.grab(s.w, P.inv(p), 0.15),
      move: (p, s) => Sim.particles.drag(s.w, P.inv(p)),
      end: s => Sim.particles.release(s.w),
    },
    status: s => `energy ${Sim.particles.energy(s.w).total.toFixed(2)} J`,
  });
}
</script>
```

**Knock down a tower**

```js
demo("tower", {
  aspect: 1.6,
  state: () => { const w = Sim.rigid.create(); Sim.rigid.ground(w, 0); for (let i = 0; i < 8; i++) Sim.rigid.box(w, 0, 0.25 + 0.5 * i, 0.5, 0.5); return { w }; },
  reset: true,
  controls: [{ label: "Throw a ball", type: "button", action: s => Sim.rigid.circle(s.w, -3, 1.5, 0.2, { vx: 9, vy: 2, density: 4, color: "red" }) }],
  step(dt, s) { Sim.rigid.step(s.w, dt); },
  draw(g, s) { Sim.draw.rigid(g, g.fit(-3.5, 3.5, -0.3, 4.5), s.w); },
});
```

**Two-source interference**

```js
const make = sep => { const G = Sim.wave.create({ nx: 200, ny: 125, c: 4, dx: 0.05, boundary: "absorbing" }); const h = Math.round(sep / 0.1); Sim.wave.source(G, 100 - h, 62, { freq: 3 }); Sim.wave.source(G, 100 + h, 62, { freq: 3 }); return G; };
demo("tank", {
  aspect: 1.6,
  state: () => ({ G: make(2) }),
  controls: [{ key: "sep", label: "Separation", min: 0.5, max: 4, step: 0.05, value: 2, unit: "m", color: "red" }],
  change(key, s, v) { s.G = make(v.sep); },
  step(dt, s) { Sim.wave.step(s.G, dt); },
  draw(g, s) {
    Sim.draw.field(g, s.G, { range: [-0.6, 0.6] });
    for (const src of s.G.sources) g.circle([((src.i + 0.5) / s.G.nx) * g.w, g.h - ((src.j + 0.5) / s.G.ny) * g.h], 4, { fill: "ink", stroke: "panel", width: 1.5 });
  },
});
```

**Chaos from a millionth of a radian**

```js
demo("chaos", {
  aspect: 1.4,
  state: () => ({ a: Sim.ode.create("doublePendulum", {}, [2.2, 2.6, 0, 0]), b: Sim.ode.create("doublePendulum", {}, [2.2 + 1e-6, 2.6, 0, 0]) }),
  reset: true,
  step(dt, s) { Sim.ode.step(s.a, dt); Sim.ode.step(s.b, dt); },
  draw(g, s) {
    const P = g.fit(-2.2, 2.2, -2.2, 1.2);
    for (const [st, c] of [[s.a, "blue"], [s.b, "red"]]) { const [p1, p2] = Sim.ode.bobs(st); g.path([P([0, 0]), P(p1), P(p2)], { stroke: c, width: 2 }); g.circle(P(p2), 7, { fill: c }); }
  },
  status: s => { const [, p] = Sim.ode.bobs(s.a), [, q] = Sim.ode.bobs(s.b); return `${Math.hypot(p[0] - q[0], p[1] - q[1]).toFixed(4)} m apart`; },
});
```

**A network learning a decision boundary**

```js
demo("learn", {
  aspect: 1,
  state: () => ({ data: Sim.data.spirals({ n: 100, seed: 3 }), net: Sim.nn.mlp({ sizes: [2, 16, 16, 2], seed: 1 }), frame: 0, grid: null }),
  reset: true,
  controls: [{ key: "lr", label: "Learning rate", min: -3.5, max: -0.5, step: 0.1, value: -2, format: e => (10 ** e).toPrecision(2), color: "orange" }],
  // The grid is the expensive part: refresh it every third step, in step, so draw stays cheap.
  step(dt, s, v) {
    for (let i = 0; i < 8; i++) Sim.nn.train(s.net, s.data.X, s.data.Y, { lr: 10 ** v.lr });
    if (s.frame++ % 3 === 0) s.grid = Array.from(Sim.nn.grid(s.net, [-1.4, 1.4], [-1.4, 1.4], 48, 48));
  },
  draw(g, s) {
    s.grid ??= Array.from(Sim.nn.grid(s.net, [-1.4, 1.4], [-1.4, 1.4], 48, 48));
    g.gridField(s.grid, 48, 48, { map: "diverging", range: [0, 1], low: "blue", high: "orange", alpha: 0.85 });
    const P = g.fit(-1.4, 1.4, -1.4, 1.4, { pad: 0 });
    s.data.X.forEach((x, i) => g.circle(P(x), 2.6, { fill: s.data.Y[i] ? "orange" : "blue", stroke: "panel", width: 1 }));
  },
  status: s => `accuracy ${(Sim.nn.accuracy(s.net, s.data.X, s.data.Y) * 100).toFixed(0)}%`,
});
```

**Gradient descent on a 3D loss surface**

```js
const f = (x, z) => 0.08 * x * x + 0.45 * z * z - 0.7 * Math.exp(-((x - 1.4) ** 2 + (z + 0.6) ** 2) / 0.5);
const scene = E3.scene({ shadow: false });
const { meshes } = E3.mesh.surfaceBands(f, { x: [-3, 3], z: [-2, 2], n: 60, nz: 40, bands: 9 });
const bands = meshes.map(m => scene.add(m));
const ball = scene.add(E3.mesh.sphere(0.16), { material: "brass" });
// in draw: bands.forEach((n, k) => (n.color = E3.ramp(k / 8, ["blue", "porcelain", "orange"])));
//          ball.position = [x, f(x, z) + 0.16, z]; const view = g.render3d(scene, { ...s.view, zoom: 1.3 });
//          then draw the path of steps with view.project and g.path.
```
