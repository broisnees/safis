# Plots, numerics, and science helpers

The plot kit (`src/plot.js`) adds three things to every page:

- **`g.graph(o)`**: a function graph in data coordinates, with axes, ticks, and labels.
- **`Num`**: the numerics a figure's model needs, such as ODE steps, roots, integrals, matrices, softmax, and seeded random numbers.
- **Helpers on `g`**: springs, ground, charges, field lines, atoms, bonds, energy diagrams, bars, heatmaps, networks, and tokens, all drawn in the house style.

Use them instead of hand-drawing axes or re-deriving physics in each figure. Compute the model once with `Num`, then draw it with these helpers, so every number on screen comes from the model.

Conventions everywhere:
- Colors are palette names (`"blue"`, `"ink"`, `"muted"`), so dark mode works.
- A label written `"$...$"` is math and is set with `g.tex` ([math.md](math.md)). A single letter (`"x"`, `"θ"`) is set as an italic variable automatically. Anything else is a plain sentence-case label.

## When to use what

| The figure shows | Use |
|---|---|
| y = f(x), a parameter's effect on a curve | `g.graph` + `P.fn`, with `P.marker` for the current value |
| A geometric construction (unit circle, vectors) | `g.graph({ equal: true })` + `P.vector`, `P.segment`, `g.angleMark` |
| Accumulation, an integral, a derivative | `P.area`, `P.riemann`, `P.tangent` |
| Flow, forces in a plane, potentials | `P.vectorField`, `P.streamlines`, `P.contour`, `P.heat`; `g.fieldLines` for point charges |
| Quantities spanning decades | `xScale: "log"` / `yScale: "log"` |
| A machine or experiment in 2D | `g.spring`, `g.ground`, `g.wall`, `g.block`, `g.pulley`, `g.wave`, `g.dimension` |
| Molecules, energetics | `g.atom`, `g.bond`, `g.reaction`, `g.levels` (use E3 molecules when turning it in 3D teaches something) |
| Probabilities, scores, rankings | `g.bars` (horizontal for ranked lists of words) |
| Attention, confusion, correlation matrices | `g.heatmap` |
| Neural networks, tokenization | `g.network`, `g.tokens` |

## g.graph(o)

```js
const P = g.graph({ box, x: [x0, x1], y: [y0, y1], axes: "cross", xTicks: "pi", xLabel: "x", yLabel: "$y$" });
P.fn(Math.sin, { color: "blue", label: "$\\sin x$" });
```

The graph draws its grid and axes as soon as it's created; every later call draws on top, clipped to the plot area.

**Options**

| option | default | |
|---|---|---|
| `box` | whole canvas | `[x, y, w, h]` in px. Split a figure by giving each graph its own box. |
| `x`, `y` | `[-1, 1]` | Data ranges. Put the larger value first to flip an axis. |
| `axes` | `"cross"` | `"cross"`: axes through the origin with arrowheads, for math. `"frame"`: an L-shaped frame with labels outside, for measured data and anything with units. `"none"`: no axes. |
| `equal` | false | Same scale on both axes (circles stay round); the shorter range grows to fill the box. |
| `grid` | true | `false`, or `"minor"` for minor lines too. |
| `xTicks`, `yTicks` | auto | A step (`0.5`), a list (`[0, 9.81]`), `"pi"` (π/2, π, 3π/2…), `false`, or `{ step, values, format, minor }`. |
| `xFormat`, `yFormat` | | `v => string` for tick labels. `Num.fmt` and `Num.si` are good bases. |
| `xScale`, `yScale` | `"linear"` | `"log"` puts ticks on decades, with minor ticks at 2–9. |
| `xLabel`, `yLabel` | | Sentence case with units in parentheses ("Length (m)"), or a variable ("t", "$v_0$"). |
| `arrows` | true | Arrowheads on cross axes. |
| `origin` | true | One "0" at the origin of cross axes. |
| `zeroLine` | true | On frame axes, a thin line at 0 when 0 is inside the range. |
| `pad`, `tickSize`, `labelSize`, `xTickSpacing`, `yTickSpacing` | 10, 11.5, 13, 80, 46 | Fine tuning. Spacing is the target px between ticks. |
| `clip` | true | Set `false` to let curves draw outside the plot. |

**Mapping:** `P([x, y])` gives px. `P.inv([px, py])` gives data, which is what `drag.move` needs. `P.near(p, [x, y], r = 14)` is a hit test for dragging a point. `P.contains([x, y])`, `P.xpx(x)`, `P.ypx(y)`, `P.box`, `P.x`, `P.y`, `P.sx`, `P.sy`, and `P.axis` (the px position of each axis) are also available. `P.clip(fn)` draws anything clipped to the plot area. `P.axesOnTop()` draws the axes and tick labels again; call it last when curves cross the tick labels.

**Drawing**

| call | |
|---|---|
| `P.fn(f, o)` | Adaptive sampling. Breaks at jumps it can't resolve (`tan`, `1/x`) and where `f` is `NaN`. `o.color` ["blue"], `width` [2], `dash`, `domain: [a, b]`, `label` (placed near the right end, or at `labelAt: x`; `labelOffset: [dx, dy]`). Returns the px polylines. |
| `P.parametric(t => [x, y], [t0, t1], o)` | Same options, plus `fill`. |
| `P.polar(θ => r, [θ0, θ1] = [0, 2π], o)` | |
| `P.points(list, o)`, `P.scatter` | `o.r` [3.5], `color` (one, or a list), `labels`. |
| `P.segment(a, b, o)`, `P.line(a, b, o)`, `P.ray(a, b, o)`, `P.polyline(list, o)` | `line` is the whole line through a and b. `polyline` takes `close` and `fill`. |
| `P.vector(from, to, o)` | An arrow in data coordinates; `o.label` sits past the tip. |
| `P.area(f, a, b, o)` | Shades between `f` and `o.to` (a number or a function, default 0). `o.neg` colors the parts below the baseline differently. `o.hatch`, `o.edge`, `o.alpha` [0.2]. Returns the integral. |
| `P.between(f, f2, a, b, o)` | The region between two curves. |
| `P.tangent(f, x0, o)` | The tangent line (or `o.span` either side) and the point. Returns `{ x, y, slope }`. |
| `P.riemann(f, a, b, n, o)` | `o.rule`: "left", "right", "mid" (default), or "trap". Returns the sum. |
| `P.hline(y, o)`, `P.vline(x, o)` | Dashed reference lines, with `o.label`. |
| `P.marker(x, y, o)` | A point. `o.drop` adds dashed lines to the axes; `o.label` goes on the side `o.pos` ("ne", "sw"…). |
| `P.label(text, [x, y], o)` | `dx`, `dy`, `align`, `color`. |
| `P.legend(items, o)` | `items: [{ label, color, dash, fill }]`; `o.at`: "top-left", "top-right", "bottom-left", "bottom-right", or `[px, py]`. Prefer labeling curves directly (`P.fn(..., { label })`); use a legend only when labels would collide. |
| `P.vectorField(F, o)` | `F(x, y) -> [u, v]` as arrows on a grid. `o.spacing` [32 px]. `o.scale`: "linear" (length by magnitude) or "normalize" (equal length, faded by magnitude). `o.max` fixes the scale between frames. |
| `P.streamlines(F, seeds, o)` | Curves that follow `F` from each seed (`[x, y]` in data). Without seeds, a grid of them (`o.count: [7, 5]`). `o.both` [true] traces backward too; arrowheads mark the direction. |
| `P.contour(f, levels, o)` | Level curves by marching squares. `levels` is a list or a count; `o.colors` cycles per level. Returns `{ levels, min, max }`. |
| `P.heat(f, o)` | `f(x, y)` as color under the axes. `o.map`: "diverging" (default, symmetric around 0) or "sequential"; `o.range`; `o.res` [3 px]. |
| `P.series(data, o)` | Measured data: a line through `[x, y]` pairs. `o.dots`, `fill` (soft area down to `o.to`, default 0), `smooth`, `label` (at the last point), `color`, `width`, `dash`. |
| `P.band(xs, lo, hi, o)` | A shaded band between `lo` and `hi` (arrays the length of `xs`, or functions of x): confidence intervals, ranges, envelopes. `o.edges` outlines it. |
| `P.errorbars(list, o)` | `[x, y, err]` or `[x, y, below, above]`: a dot with capped whiskers. `o.cap` [4 px]. |
| `P.histogram(samples, o)` | Bins raw samples (`o.bins` [20], `o.range`) or takes `{ edges, counts }`. `o.density` scales the area to 1 so a pdf from `P.fn` lays over it. |
| `P.crosshair(x, curves, o)` | A hover readout at data x: a guide line, a dot on each curve, and value tags that keep clear of each other. `curves: [{ f } or { data }, color, label, format]`; `o.xFormat`, `o.xLabel: false`. Returns the hits. |
| `P.interp(data, x)` | y on `[x, y]` pairs by straight lines between them; `NaN` outside the data. |

## Trees and timelines

**`g.tree(root, o)`** lays out any tree tidily: a phylogeny, a family tree, a decision tree, an argument map, a parse tree, an org chart, a file system. `root = { label, children, color, length, note, italic }`.

| option | |
|---|---|
| `orient` | `"down"` (default), `"right"` (phylogenies, file trees), `"radial"` (big trees of life) |
| `lengths` | `true`: depth by each node's `length` (a phylogram in millions of years) |
| `edges` | `"elbow"`, `"curve"`, `"straight"` |
| `style: "cards"` | Each node a rounded card with wrapped text: argument maps, decision trees, org charts |
| `highlight` | A label or a function: that node and its path to the root in color, the rest faint |
| `collapsed` | Labels whose children are hidden (draw them hollow; toggle on click with `hit`) |

Returns `{ nodes, at(label), hit(p) }` for labels, hover, and clicks. Long labels wrap and stay inside the box.

**`g.timeline(events, o)`** is a time axis: `events = [{ t, end, label, color }]` as dots (spans as bars) with labels stacked in lanes so none overlap, `eras = [{ from, to, label, color }]` as tinted bands, and `now` as a marker (drive it from a slider; events after it fade). Years before 0 read "BCE"; `format: "ago"` writes "65 Ma" for deep time, with `log: true` and `ref` spacing by time before `ref`. Returns `{ x(t), t(x), hit(p), axisY }`.

## Num

Pure functions with no dependencies, usable in `state()`, `step()`, and `draw()` alike.

| | |
|---|---|
| **Display** | `fmt(x, { digits = 3, fixed, trim, sign, unit })` uses a true minus sign, thin-space thousands (12 500), and 1.2×10⁻⁴ for tiny or huge values. `si(x, unit)` gives "4.2 ms" or "15.3 kN". `piFmt(x)` gives "3π/4". Also `sup("2")`, `niceStep(span, n)`, and `ticks(a, b, n)`. |
| **Sequences** | `linspace(a, b, n)`, `range(a, b, step)`, `clamp`, `lerp`. |
| **ODEs** | `f(t, y)` returns dy/dt, where `y` is a number or an array. `rk4(f, y, t, dt)` and `euler(...)` take one step. `advance(f, y, t, dt, maxStep = 1/240)` does RK4 substeps for a frame's `dt`; use it in `step()`. `ode(f, y0, [t0, t1], { steps | dt })` returns `{ t, y }` arrays for plotting a whole run. |
| **Roots and calculus** | `solve(f, a, b)` brackets a root (bisection), and `solve(f, x0)` uses Newton's method. `roots(f, a, b)` finds every sign change. Also `bisect`, `newton`, `deriv(f, x)`, `deriv2`, `integrate(f, a, b, n = 256)` (Simpson's rule), `interp(xs, ys, x)`, and `table(xs, ys)` (returns a function). |
| **Random numbers** | `const r = Num.rng(seed)` gives the same numbers on every load. `r()` is in [0, 1). Also `r.gauss(mu, sigma)`, `r.int(lo, hi)` (inclusive), `r.pick(list)`, `r.shuffle(list)`. |
| **Statistics** | `sum`, `mean`, `variance(xs, sample)`, `std`, `erf`, `normalPdf(x, mu, sigma)`, `normalCdf`, and `histogram(xs, { bins, range })`, which returns `{ edges, counts, width }`. |
| **Vectors** | `v2.{add, sub, scale, dot, cross, len, dist, norm, perp, rot, angle, lerp, polar}`, `v3.{add, sub, scale, dot, cross, len, dist, norm, lerp}`, and `dot(a, b)` for any length. |
| **Matrices** (arrays of rows) | `mat.mul(A, B)` (B can be a vector), `matmul`, `mat.transpose`, `mat.add`, `mat.scale`, `mat.det` (any size), `mat.inv` (null when singular), `mat.identity(n)`, and `mat.rotation(θ)`. `mat.eigen2(A)` returns `{ values, vectors, complex }`, larger eigenvalue first. |
| **Complex numbers** | `C.of(re, im)`, `C.polar(r, θ)`, and `C.add`, `sub`, `mul`, `div`, `scale`, `conj`, `abs`, `arg`, `exp`, `fmt` on `{ re, im }`. |
| **Neural networks** | `softmax(logits, T = 1)` (T → 0 gives argmax), `sigmoid`, `tanh`, `relu`, `gelu`, `argmax`, `topK(xs, k)` (indices), `sample(probs, r)`, `entropy(ps, base)`, `crossEntropy(ps, target)`, `logsumexp`, `normalize`. |

## Science and data helpers

Positions are px, like the rest of `g`. Each helper returns what you need for hit-testing.

| call | |
|---|---|
| `g.spring(a, b, o)` | A coil seen slightly from the side, so a squeezed spring shows its loops. `o.coils` [8], `radius` [7], `lead` [10] straight ends, `style: "zigzag"`, `tilt`. |
| `g.ground(a, b, o)`, `g.wall(a, b, o)` | A surface with hatching on one side. `o.side` (1 or −1) flips it. Returns `{ normal }`. |
| `g.block(c, w, h, o)`, `g.mass` | A labeled block centered at `c`. `o.label` ("m", "$m_1$", "2 kg"), `o.color` tints it. Returns edges (`top`, `left`…) and `hit(p)`. |
| `g.pulley(c, r, o)` | `o.angle` turns spoke marks so rotation shows; `o.mount` is a strap to a support point. |
| `g.wave(a, b, f, o)` | `f(s)` gives the sideways displacement (px) at distance `s` along a→b. |
| `g.angleMark(c, a0, a1, r, o)` | An angle arc (canvas radians, y down) with `o.label`. `o.right` draws the square right-angle mark instead. |
| `g.brace(a, b, label, o)` | A curly brace, `o.side` ±1. |
| `g.charge(p, sign, o)` | A ⊕ or ⊖ disc in red or blue, with `o.label`. |
| `g.fieldLines(charges, o)` | `charges: [{ p: [px, py], q }]`. Lines leave positive charges (`o.density` lines per unit charge) and end on negative ones. |
| `g.atom(p, "O", o)` | A disc colored by element (H paper, C graphite, N blue, O red, S brass, halogens green, metals purple or orange) with its symbol. `o.r`, `o.scale`, `o.charge` ("δ−", "+"), `o.label`. |
| `g.bond(a, b, o)` | `o.order` 1, 2, 3, or 1.5. `o.r1`/`o.r2` trim the bond to the atoms' radii. `o.style: "dashed"` draws a hydrogen bond. |
| `g.reaction(o)` | An energy profile: `energies: [reactants, transition state, products]`. `catalyzed` adds a lower dashed peak; `show: { ea, dh }` adds the barrier and ΔH arrows; `labels: { reactants, products, ts }`; `box`. Returns `{ P, E(t) }`. |
| `g.levels(items, o)` | Energy levels `[{ E, label, color, column }]` on an energy axis, with `o.transitions: [{ from, to, label, color }]`. |
| `g.bars(values, o)` | `box`, `labels`, `highlight` (an index or a list; the others go pale), `colors`, `range`, `values` (print the numbers), `format`. `horizontal` puts labels on the left, best for ranked words. `labelFont: "mono"` suits tokens. Returns `{ bars, hit(p) }`. |
| `g.heatmap(M, o)` | `rowLabels`, `colLabels` (rotated when crowded), `range`, `color` (sequential), `diverging: true` (with `low`/`high`), `values`, `format`, `highlight: { row, col }`. Returns `{ cell(i, j), hit(p) -> { i, j }, box }`. |
| `g.network(layers, o)` | `layers` is counts (`[3, 4, 2]`) or label lists. `weights[l][j][i]` is the weight from node i of layer l to node j of layer l+1; blue is positive, red negative, and width shows size. `activations[l][i]` in 0–1 fills nodes. Also `labels` (under the layers), `highlight: { layer, i }`, `showValues`. Returns `{ nodes, hit(p) }`. |
| `g.tokens(list, o)` | A wrapping row of token chips. Spaces show as ·. Options: `at`, `width`, `highlight`, `colors` ("cycle", one name, or a list), `values` (a number under each chip). Returns `{ rects, hit(p), height }`. |

## Examples

### Unit circle to sine

Drag the point around the circle. The graph traces where its height goes.

```html
<p>Drag the <span class="c-blue" data-part="point">point</span> around the circle and watch its height trace the sine curve:</p>
<figure class="demo" id="unit" aria-label="A unit circle with a draggable point beside a sine graph that marks the point's height."></figure>
<script>
{
  let C; // the circle's graph from the last draw, for dragging
  demo("unit", {
    aspect: 2.2,
    state: () => ({ t: 1 }),
    drag: {
      hit: (p, s) => C && C.near(p, [Math.cos(s.t), Math.sin(s.t)], 16),
      move: (p, s) => { const q = C.inv(p); s.t = (Math.atan2(q[1], q[0]) + TAU) % TAU; },
    },
    draw(g, s) {
      const split = g.w * 0.36, x = Math.cos(s.t), y = Math.sin(s.t);
      C = g.graph({ box: [0, 0, split, g.h], x: [-1.25, 1.25], y: [-1.25, 1.25], equal: true, grid: false, xTicks: false, yTicks: false });
      C.parametric(t => [Math.cos(t), Math.sin(t)], [0, TAU], { color: "muted", width: 1.5 });
      C.segment([0, 0], [x, y], { color: "ink", width: 1.5 });
      C.segment([x, 0], [x, y], { color: "blue", width: 2.5 });
      g.angleMark(C([0, 0]), 0, -s.t, 22, { label: "θ", color: "orange" });
      g.handle(C([x, y]), { color: "blue", active: g.lit("point") });
      const S = g.graph({ box: [split, 0, g.w - split, g.h], x: [0, TAU], y: [-1.25, 1.25], xTicks: "pi", yTicks: [-1, 1], xLabel: "θ" });
      S.fn(Math.sin, { color: "blue" });
      S.marker(s.t, y, { color: "blue", drop: true, label: Num.fmt(y, { fixed: 2 }) });
    },
  });
}
</script>
```

### Spring and mass, with the energy plotted

```html
<p>Add <span class="scrub" data-key="c"></span> of damping and watch the energy drain away:</p>
<figure class="demo" id="osc" aria-label="A block on a spring above a plot of its kinetic and potential energy over time."></figure>
<script>
{
  const k = 20, m = 1, accel = (t, [x, u], c) => [u, (-k * x - c * u) / m];
  demo("osc", {
    aspect: 1.4,
    state: () => ({ y: [0.5, 0], t: 0, log: [] }),
    reset: true,
    controls: [{ key: "c", label: "Damping", min: 0, max: 3, step: 0.1, value: 0.4, unit: "kg/s", color: "orange" }],
    step(dt, s, v) {
      s.y = Num.advance((t, y) => accel(t, y, v.c), s.y, s.t, dt);
      s.t += dt;
      s.log.push([s.t, 0.5 * k * s.y[0] ** 2, 0.5 * m * s.y[1] ** 2]);
      if (s.t > 8) Object.assign(s, { y: [0.5, 0], t: 0, log: [] });
    },
    draw(g, s) {
      const floor = Math.min(110, g.h * 0.3), rest = g.w * 0.5, bx = rest + s.y[0] * g.w * 0.4;
      g.wall([24, floor - 60], [24, floor], { side: -1 });
      g.ground([24, floor], [g.w - 16, floor]);
      g.spring([24, floor - 24], [bx - 28, floor - 24], { coils: 9, radius: 10 });
      g.block([bx, floor - 24], 56, 48, { label: "m", color: "blue" });
      const P = g.graph({ box: [0, floor + 16, g.w, g.h - floor - 16], x: [0, 8], y: [0, 0.5 * k * 0.25 * 1.1], axes: "frame", xLabel: "Time (s)", yLabel: "Energy (J)" });
      P.polyline(s.log.map(r => [r[0], r[1]]), { color: "green" });
      P.polyline(s.log.map(r => [r[0], r[2]]), { color: "purple" });
      P.legend([{ label: "in the spring", color: "green" }, { label: "in the motion", color: "purple" }], { at: "top-right" });
    },
  });
}
</script>
```

### Measured data with a hover readout

Readers compare curves by pointing at them. Keep the pointer's x in the state and draw the readout where it is:

```html
<p>Point anywhere on the chart to read both runs at that moment:</p>
<figure class="demo" id="runs" aria-label="Two noisy temperature runs with a shaded uncertainty band; pointing shows both values at that time."></figure>
<script>
{
  let P;
  const t = Num.linspace(0, 60, 61);
  const a = t.map(x => [x, 20 + 15 * (1 - Math.exp(-x / 12))]);
  const b = t.map(x => [x, 20 + 11 * (1 - Math.exp(-x / 20))]);
  demo("runs", {
    aspect: 1.6,
    state: () => ({ hx: null }),
    hover(p, s) { const hx = p && P ? P.inv(p)[0] : null; if (hx !== s.hx) { s.hx = hx; return true; } return false; },
    draw(g, s) {
      P = g.graph({ x: [0, 60], y: [15, 40], axes: "frame", xLabel: "Time (s)", yLabel: "Temperature (°C)" });
      P.band(t, x => 20 + 15 * (1 - Math.exp(-x / 12)) - 1.5, x => 20 + 15 * (1 - Math.exp(-x / 12)) + 1.5, { color: "red" });
      P.series(a, { color: "red", label: "copper" });
      P.series(b, { color: "blue", label: "steel" });
      P.crosshair(s.hx, [{ data: a, color: "red", format: v => v.toFixed(1) + " °C" }, { data: b, color: "blue", format: v => v.toFixed(1) + " °C" }], { xFormat: x => x.toFixed(0) + " s" });
    },
  });
}
</script>
```

### Next-word probabilities under a temperature slider

```html
<p>Lower the temperature to <span class="scrub" data-key="T"></span> and the top word takes almost all the probability:</p>
<figure class="demo" id="temp" aria-label="Six candidate next words as horizontal bars of probability; a temperature slider sharpens or flattens them."></figure>
<script>
{
  const words = [" mat", " floor", " sofa", " roof", " moon", " idea"], logits = [3.1, 2.4, 1.8, 0.9, 0.2, -0.5];
  demo("temp", {
    aspect: 1.9,
    controls: [{ key: "T", label: "Temperature", min: 0.1, max: 3, step: 0.05, value: 1, color: "purple" }],
    draw(g, s, v) {
      const p = Num.softmax(logits, v.T);
      g.bars(p, { box: [16, 12, g.w - 32, g.h - 24], labels: words, labelFont: "mono", horizontal: true, range: [0, 1],
        values: true, format: x => Num.fmt(x * 100, { fixed: 1 }) + "%", color: "purple", highlight: Num.argmax(p) });
    },
  });
}
</script>
```

### Attention weights you can hover

```html
<figure class="demo" id="attn" aria-label="An attention matrix for six tokens; hovering a row shows what that token looks at."></figure>
<script>
{
  const toks = ["The", " cat", " sat", " on", " the", " mat"], r = Num.rng(4);
  // Causal attention: each token spreads its weight over itself and earlier tokens.
  const A = toks.map((_, i) => Num.softmax(toks.slice(0, i + 1).map(() => r.gauss(0, 1.4))).concat(Array(toks.length - i - 1).fill(0)));
  let H; // the heatmap from the last draw, for hover
  demo("attn", {
    aspect: 1.5,
    state: () => ({ row: 2 }),
    hover(p, s) { const c = p && H?.hit(p); if (c && c.i !== s.row) { s.row = c.i; return true; } return false; },
    draw(g, s) {
      const top = g.tokens(toks, { at: [16, 12], highlight: s.row });
      H = g.heatmap(A, { box: [16, top.height + 24, g.w - 32, g.h - top.height - 36], rowLabels: toks, colLabels: toks, labelFont: "mono", highlight: { row: s.row }, values: true });
    },
  });
}
</script>
```

### A dipole you can pull apart

```html
<figure class="demo" id="dipole" aria-label="Field lines from a positive charge to a negative one; drag the negative charge."></figure>
<script>
{
  demo("dipole", {
    aspect: 1.8,
    state: () => ({ b: null }),
    drag: { hit: (p, s) => s.b && Math.hypot(p[0] - s.b[0], p[1] - s.b[1]) < 18, move: (p, s) => { s.b = p; } },
    draw(g, s) {
      s.b ??= [g.w * 0.68, g.h / 2];
      const a = [g.w * 0.32, g.h / 2];
      g.fieldLines([{ p: a, q: 1 }, { p: s.b, q: -1 }], { density: 12 });
      g.charge(a, 1, { label: "+q" });
      g.charge(s.b, -1, { label: "−q" });
    },
  });
}
</script>
```

## Pitfalls

- **Curves cover tick labels on cross axes.** Call `P.axesOnTop()` after the curves, or move the curve's range.
- **Create the graph in `draw()` every frame.** It's cheap. Keep the last one in a block variable (`let P;`) for drag and hover callbacks, which don't get `g`.
- **Keep scales still.** A field's `o.max`, a heatmap's `o.range`, and a graph's ranges should stay fixed while the reader moves things, or comparisons lie.
- **Keep the model in data units.** Put the simulation in data units, step it with `Num.advance` in `step()`, and only map to px in `draw()`. Don't integrate in px.
- **Label what moves, not everything.** One labeled curve and one marker teach more than a legend of six.
