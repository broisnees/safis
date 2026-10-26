# Runtime reference (2D and figure plumbing)

The template's `<head>` defines the runtime. A page calls `demo(id, spec)` once per figure. 3D scenes are drawn through the same figures with `g.render3d`; the engine itself is in [engine3d.md](engine3d.md). Everything here matches the code in `assets/template.html`; when in doubt, read the code.

Contents: [demo()](#demoid-spec), [controls](#controls), [the figure handle](#the-figure-handle), [drawing with g](#drawing-with-g), [labels and annotations](#labels-and-annotations), [instruments and fields](#instruments-and-fields), [coordinates and plots](#coordinates-and-plots), [3D in a figure](#3d-in-a-figure), [globals](#globals), [a complete example](#a-complete-example).

## demo(id, spec)

```html
<figure class="demo" id="throw" aria-label="A ball thrown from the left; drag the green arrow to change the throw."></figure>
<script>
{
  demo("throw", { aspect: 1.8, state: () => ({ ... }), controls: [ ... ], step(dt, s, v) { ... }, draw(g, s, v) { ... } });
}
</script>
```

Add `class="demo wide"` for a figure that should break out of the text column (hero 3D scenes).

| spec field | meaning |
|---|---|
| `draw(g, s, v, fig)` | **Required.** Draws the figure. Runs after any change, on resize, on theme change, and every frame while animating. The canvas is already painted with the page background. |
| `aspect` | Width / height. A number (default `1.6`), or a function of the canvas width in CSS pixels, like `w => (w < 560 ? 0.9 : 1.6)` for layouts that stack on phones. |
| `state` | The mutable state `s`. An object, or a function returning one (needed for reset). Keep it plain data so the self-check can snapshot it. |
| `controls` | Sliders, toggles, buttons under the canvas; values arrive in `v`. See [controls](#controls). |
| `change(key, s, v, fig)` | Runs after a control changes, before the redraw. Use it to restart a simulation or update a state machine. |
| `step(dt, s, v, fig)` | Advances an animation by `dt` seconds (at most 1/30). Animated figures run only while on screen, pause during drags, and start paused for readers who prefer reduced motion. |
| `autoplay` | `false` starts paused, and tells the self-check that stillness is fine (motion starts from a button). |
| `playButton` | `false` hides the play/pause button and the Space key, for one-shot animations started by a button via `fig.play()`. |
| `reset` | `true` adds a reset button (needs `state` as a function). A function also runs after the reset. |
| `drag` | `{ hit(p, s, v, fig), move(p, s, v, delta, fig), end(s, v, fig) }`. `hit` returns truthy when `p` is on something draggable (omit to drag anywhere). Points are `[x, y]` CSS pixels, origin top-left. |
| `orbit` | `{ yaw, pitch, minPitch, maxPitch, minYaw, maxYaw }` in radians. Dragging (where `drag.hit` doesn't claim it) turns `s.view = { yaw, pitch }`, with momentum after release. Arrow keys turn it too when there are no sliders. |
| `hover(p, s, v, fig)` | Called on pointer moves while not dragging, with `null` when the pointer leaves. Return `true` when something changed and the figure should redraw. |
| `status(s, v)` | Returns a short string shown in the figure's margin note, updated after every draw ("21 Jun · sun at 23.4°", "slid 4.2 mm"). |
| `hints` | Keyboard and pointer hints in the margin. Built automatically (Drag / ← → first slider / ↑ ↓ second slider / Space); pass `false` to hide them or `[["Drag", "the bob"], ...]` to replace them. |
| `background` | Palette name painted under the drawing (default `"panel"`, the page color). Use `"ink"`-dark scenes by painting a rect yourself. |

Keyboard: the canvas area is focusable. ← → nudge the first slider (Shift for 10x), ↑ ↓ the second, Space plays and pauses.

All figure scripts share one global scope: wrap each in `{ ... }`, and put code several figures share in one earlier script that assigns a global (`window.MODEL = (() => { ... })()`).

## Controls

```js
controls: [
  { key: "open", label: "Opening", min: 0, max: 50, step: 0.5, value: 0, unit: "mm", color: "green" },
  { key: "teeth", label: "Teeth", min: 6, max: 40, step: 1, value: 12, format: n => `${n} teeth` },
  { key: "cut", label: "Show the cut", type: "toggle", value: true, color: "orange" },
  { label: "Push down and back", type: "button", action: (s, v, fig) => { ... } },
]
```

- **Slider** (default type): `key`, `label`, `min`, `max`, `step`, `value`, `color`, and `unit` or `format(value)`.
- **Toggle**: `type: "toggle"`, `key`, `label`, `value`, `color`.
- **Button**: `type: "button"`, `label`, `action(s, v, fig)`. The exploration script presses every button, from the start and with the first slider at its maximum.
- Give a control the color of the thing it changes in the figure and the colored word in the prose.

## The figure handle

Callbacks get it as their last argument (`fig`); `demo()` returns it.

| | |
|---|---|
| `fig.set(key, value)` | Set a control as if the reader moved it (updates the input, runs `change`, redraws). |
| `fig.reset()` | Fresh `state()`, keeping the 3D view. |
| `fig.redraw()` | Ask for a redraw. |
| `fig.play(on = true)` | Start or stop `step()`. |
| `fig.state`, `fig.values` | The live `s` and `v`. |

## Drawing with g

`draw(g, s, v)` gets `g`. Points are `[x, y]` in CSS pixels, origin top-left. `g.w`, `g.h` are the canvas size; the canvas is about 640 px wide on a laptop and 358 px on a phone, so size everything from them or from `g.fit`.

| call | options `o` (defaults in brackets) |
|---|---|
| `g.line(a, b, o)` | `stroke` ["ink"], `width` [2], `dash`, `alpha` |
| `g.path(points, o)` | `stroke`, `fill`, `hatch`, `width`, `dash`, `close`, `alpha` |
| `g.spline(points, o)` | Smooth curve through the points; same options, `close` for loops |
| `g.circle(c, r, o)` | `fill`, `stroke`, `hatch`, `width`, `alpha` |
| `g.rect(x, y, w, h, o)` | `fill`, `stroke`, `hatch`, `width`, `r` (corner radius), `alpha` |
| `g.arrow(a, b, o)` | `stroke`, `width`, `head`, `dash`, `alpha` |
| `g.arcArrow(c, r, a0, a1, o)` | Curved arrow around `c` from angle `a0` to `a1` (radians, canvas convention: y down) |
| `g.text(str, p, o)` | `color`, `size` [14], `weight` [500], `align`, `baseline`, `italic`, `caps`, `tracking` (px), `font` (`"mono"`, `"serif"`), `halo`, `alpha` |
| `g.measure(str, o)` | Text width in px |
| `g.clip(box, fn)` | Runs `fn` with drawing clipped to `[x, y, w, h]`. Use it for every region of a split figure. |
| `g.color(name)`, `g.rgba(name, a)`, `g.mix(a, b, t)` | Palette lookups and mixes |
| `g.ctx` | The raw 2D context, scaled for pixel density. Wrap raw drawing in `save()` / `restore()`. |

`hatch` fills a shape with diagonal lines in that color (`hatch: g.rgba("muted", 0.55)`), the convention for cut surfaces: bone and metal sliced by a section are hatched. `hatchGap` [6] and `hatchAngle` [45] adjust it.

**Palette names:** `ink`, `muted`, `faint`, `grid`, `panel`, `bg`, `brass` (the accent), and the five subject colors `red`, `orange`, `green`, `blue`, `purple`. Use `g.rgba(name, 0.15)` for soft fills. Hex colors don't follow dark mode.

## Labels and annotations

| call | what it draws |
|---|---|
| `g.label(str, p, o)` | The house label: small uppercase tracked text with a halo. |
| `g.callouts(items, o)` | Labels in the left and right margins of the canvas with leader lines to their anchors, spaced so they don't collide. `items: [{ at: [x, y], text, color, side, dy }]`. `o.split` (x pixel) decides left versus right; `o.caps` [true], `o.size` [11], `o.gap` [20]. |
| `g.chip(str, p, o)` | A colored pill with text, for variables and short values; `o.color`. The same look exists in prose as `<span class="chip green">c</span>`, for visual equations like e = c / a. |
| `g.dimension(a, b, text, o)` | A measurement line with end ticks and a centered value; `o.offset` moves it off the object. |
| `g.inset({ from, to, radius, zoom }, draw)` | A circular magnifier: calls `draw(g)` again zoomed around `from`, shown in a circle at `to`, connected by lines. |

## Instruments and fields

| call | what it draws |
|---|---|
| `g.meter(x, y, w, h, frac, o)` | A horizontal bar filled to `frac` (0-1); `o.color`, `o.label`. |
| `g.dial(c, r, value, o)` | A round gauge with a needle; `o.min`, `o.max`, `o.ticks`, `o.label`, `o.color`. |
| `g.field(fn, o)` | A scalar field as color: `fn(x, y)` gets canvas pixels and returns a number. `o.box`, `o.res` (px per cell), `o.range`, `o.map` (`"diverging"` blue-paper-red, or `"sequential"`), `o.low`, `o.high`. |
| `g.colorbar(x, y, w, h, o)` | A legend for a field: `o.range`, `o.map`, `o.label`, `o.ends: ["low", "high"]`. |

## Coordinates and plots

`g.fit(x0, x1, y0, y1, o)` returns `P`, mapping world coordinates (y up) into the canvas or into `o.box = [x, y, w, h]`. `o.pad` [16]; `o.uniform` [true] keeps circles round, use `false` for plots. `P.inv(px)` maps back (use it in `drag.move`); `P.sx`, `P.sy` are pixels per unit. Drag callbacks don't get `g`, so keep the last `P` in a variable in the figure's block.

`g.axes(P, o)`: `o.x`, `o.y` ranges (required), `xTicks`, `yTicks`, `xLabel`, `yLabel`, `grid`, `format(t)`.

`g.view3d(o)` is a WebGL-free projector for simple line drawings in 3D: `{ yaw, pitch, scale, center, dist }` returns `P([x, y, z]) -> [px, py, depth]` (larger depth is closer) and `P.rotate`. Use E3 for solid objects.

## 3D in a figure

`g.render3d(scene, camera, { box })` renders an E3 scene into the whole canvas or into `box`, and returns a view:

- `view.project([x, y, z])` gives `[px, py, distance]`, for 2D labels and arrows on top of the 3D picture;
- `view.pick([px, py], { ghosts })` gives `{ node, point, distance }` or `null`, for hover and click;
- `view.hidden(p)` says whether something solid is in front of `p`.

`g.gizmo(view, { at, size })` draws a small X/Y/Z marker showing the current orientation. Camera options and everything else about scenes are in [engine3d.md](engine3d.md).

## Globals

`demo`, `palette` (live colors by name), `rgba(name, a)`, `clamp`, `lerp`, `smoothstep`, `TAU`, and `E3` (the 3D engine). `window.__explainer` holds `check()`, `describe(id)`, `drive(id, action)`, and `ids()`, which the scripts use. Opening a page with `?check` shows the self-check in a panel.

## A complete example

A thrown ball. Drag the green velocity arrow to change the throw; the gravity slider restarts it.

```html
<p>Drag the tip of the <span class="c-green">green arrow</span> to change how hard and how steeply the ball is thrown:</p>
<figure class="demo" id="throw" aria-label="A ball thrown from the left. A green arrow shows its launch velocity, a dashed blue line its path."></figure>
<script>
{
  const ARROW = 0.4;          // the arrow shows velocity scaled so 1 m/s is drawn as 0.4 m
  let P;                      // world (meters) to canvas, from the last draw
  const launch = s => { s.pos = [0, 0]; s.vel = [...s.aim]; s.path = [[0, 0]]; };

  demo("throw", {
    aspect: 1.8,
    state: () => { const s = { aim: [7, 9] }; launch(s); return s; },
    controls: [
      { key: "g", label: "Gravity", min: 1, max: 20, step: 0.1, value: 9.8, unit: "m/s²", color: "red" },
      { key: "showPath", label: "Show path", type: "toggle", value: true, color: "blue" },
      { label: "Throw again", type: "button", action: s => launch(s) },
    ],
    change(key, s) { if (key === "g") launch(s); },
    status: s => `${Math.hypot(...s.aim).toFixed(1)} m/s at ${(Math.atan2(s.aim[1], s.aim[0]) * 180 / Math.PI).toFixed(0)}°`,
    step(dt, s, v) {
      if (s.pos[1] < 0) return;                  // landed
      const n = 4, h = dt / n;
      for (let i = 0; i < n; i++) {
        s.vel[1] -= v.g * h;                     // semi-implicit Euler: velocity first,
        s.pos[0] += s.vel[0] * h;                // then position with the new velocity
        s.pos[1] += s.vel[1] * h;
      }
      s.path.push([...s.pos]);
      if (s.path.length > 2000) s.path.shift();
    },
    draw(g, s, v) {
      P = g.fit(-1, 21, -1, 10);
      g.line(P([-1, 0]), P([21, 0]), { stroke: "muted", width: 1 });
      if (v.showPath) g.path(s.path.map(P), { stroke: "blue", dash: [5, 5] });
      const tip = [s.aim[0] * ARROW, s.aim[1] * ARROW];
      g.arrow(P([0, 0]), P(tip), { stroke: "green", width: 3 });
      g.circle(P([s.pos[0], Math.max(0, s.pos[1])]), 7);
    },
    drag: {
      hit(p, s) {
        const tip = P([s.aim[0] * ARROW, s.aim[1] * ARROW]);
        return Math.hypot(p[0] - tip[0], p[1] - tip[1]) < 24;   // generous radius for fingers
      },
      move(p, s) {
        const w = P.inv(p);
        s.aim = [clamp(w[0] / ARROW, 1, 20), clamp(w[1] / ARROW, 1, 20)];
        launch(s);
      },
    },
  });
}
</script>
```
