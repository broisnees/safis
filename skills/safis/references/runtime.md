# Runtime reference (2D and figure plumbing)

The template's `<head>` defines the runtime. A page calls `demo(id, spec)` once per figure. 3D scenes are drawn through the same figures with `g.render3d`; the engine itself is in [engine3d.md](engine3d.md). Graphs, numerics, and science drawing helpers are in [plots.md](plots.md); equations in [math.md](math.md). Everything here matches the code in `assets/template.html`; when in doubt, read the code.

Contents: [demo()](#demoid-spec), [controls](#controls), [prose that drives figures](#prose-that-drives-figures), [the figure handle](#the-figure-handle), [drawing with g](#drawing-with-g), [labels and annotations](#labels-and-annotations), [instruments and fields](#instruments-and-fields), [coordinates and plots](#coordinates-and-plots), [3D in a figure](#3d-in-a-figure), [globals](#globals), [a complete example](#a-complete-example).

## demo(id, spec)

```html
<figure class="demo" id="throw" aria-label="A ball thrown from the left; drag the green arrow to change the throw."></figure>
<script>
{
  demo("throw", { aspect: 1.8, state: () => ({ ... }), controls: [ ... ], step(dt, s, v) { ... }, draw(g, s, v) { ... } });
}
</script>
```

Each figure is drawn straight onto the page, with its controls beneath it (sliders, switches, transport, presets, readout) and a caption that starts "Figure N". `demo()` also takes the element itself instead of an id (that's how the React, Vue, and Svelte wrappers mount it). Add `class="demo wide"` for a figure that should break out of the text column (hero 3D scenes).

| spec field | meaning |
|---|---|
| `draw(g, s, v, fig)` | **Required.** Draws the figure. Runs after any change, on resize, on theme change, and every frame while animating. The canvas is already painted with the page color. |
| `aspect` | Width / height. A number (default `1.6`), or a function of the canvas width in CSS pixels, like `w => (w < 560 ? 0.9 : 1.6)` for layouts that stack on phones. |
| `state` | The mutable state `s`. An object, or a function returning one (needed for reset). Keep it plain data so the self-check can snapshot it. |
| `controls` | Sliders, switches, segmented choices, steppers, knobs, XY pads, and buttons in the panel; values arrive in `v`. See [controls](#controls). |
| `presets` | `[{ label, set: { key: value, ... }, press?, play? }]`: a "Try" row of chips that glide the controls to interesting settings ("Moon", "Mars", "Jupiter"). The chip whose values are current shows as pressed. |
| `caption` | The caption text (HTML allowed). Defaults to the figure's own `<figcaption>`, then its `aria-label`. `false` for none. Write it as "what this shows; what to notice", not as instructions. |
| `change(key, s, v, fig)` | Runs after a control changes, before the redraw. Use it to restart a simulation or update a state machine. |
| `step(dt, s, v, fig)` | Advances an animation by `dt` seconds (at most 1/30, times the playback speed). Animated figures run only while on screen, pause during drags, and start paused for readers who prefer reduced motion. |
| `transport` | Animated figures get play/pause, step-forward, and speed (¼×–2×) buttons. `{ step: false, speed: false }` hides parts; `false` hides all. `stepFrames` [6] sets how far one step goes (in 1/60 s frames). |
| `autoplay` | `false` starts paused, and tells the self-check that stillness is fine (motion starts from a button). |
| `playButton` | `false` hides the transport and the Space key, for one-shot animations started by a button via `fig.play()`. |
| `reset` | `true` adds a reset button (needs `state` as a function). A function also runs after the reset. |
| `drag` | `{ hit(p, s, v, fig), start(p, s, v, fig), move(p, s, v, delta, fig), end(s, v, fig) }`. `hit` returns truthy when `p` is on something draggable (omit to drag anywhere). Points are `[x, y]` CSS pixels, origin top-left. Draw what can be dragged with `g.handle`. |
| `orbit` | `{ yaw, pitch, minPitch, maxPitch, minYaw, maxYaw }` in radians. Dragging (where `drag.hit` doesn't claim it) turns `s.view = { yaw, pitch }`, with momentum after release. Arrow keys turn it too when there are no number controls. |
| `hover(p, s, v, fig)` | Called on pointer moves while not dragging, with `null` when the pointer leaves. Return `true` when something changed and the figure should redraw. |
| `highlight(name, s, v, fig)` | Called when a linked term in the prose lights a part (or `null` when it goes out). Usually you don't need it: read `g.lit("part")` in `draw`. |
| `status(s, v, fig)` | Returns a short readout shown at the right of the panel, updated after every draw ("period 2.01 s", "slid 4.2 mm"). |
| `hints` | Keyboard hints, shown over the drawing while it has keyboard focus. Built automatically (Drag / ← → first number control / ↑ ↓ second / Space); `false` hides them, `[["Drag", "the bob"], ...]` replaces them. |
| `background` | Palette name painted under the drawing (default `"panel"`, which is the page color). For dark scenes paint a rect yourself. |

Keyboard: the drawing is focusable. ← → nudge the first number control (Shift for 10x), ↑ ↓ the second, Space plays and pauses. Every control in the panel is reachable with Tab.

All figure scripts share one global scope: wrap each in `{ ... }`, and put code several figures share in one earlier script that assigns a global (`window.MODEL = (() => { ... })()`).

## Controls

Pick the control that matches the quantity. A position is dragged in the drawing (`drag` + `g.handle`); an amount is a slider; a few named cases are a segmented choice; a count is a stepper; an angle that wraps is a knob; two coupled numbers (a point, a velocity) are a pad; an on/off view option is a switch; an event is a button.

```js
controls: [
  { key: "open", label: "Opening", min: 0, max: 50, step: 0.5, value: 20, unit: "mm", color: "green",
    marks: [{ value: 0, label: "closed" }, { value: 25, label: "relaxed" }, { value: 50, label: "wide" }] },
  { key: "planet", label: "Planet", type: "choice", options: [{ value: 9.8, label: "Earth" }, { value: 1.6, label: "Moon" }, { value: 24.8, label: "Jupiter" }], value: 9.8 },
  { key: "teeth", label: "Teeth", type: "stepper", min: 6, max: 40, step: 1, value: 12, format: n => `${n} teeth` },
  { key: "aim", label: "Aim", type: "knob", min: 0, max: 360, step: 1, value: 40, unit: "°", wrap: true, color: "red" },
  { type: "pad", label: "Velocity", keys: ["vx", "vy"], x: { min: -5, max: 5, step: 0.1 }, y: { min: -5, max: 5, step: 0.1 }, value: [2, 3], color: "blue" },
  { key: "cut", label: "Show the cut", type: "toggle", value: true, color: "orange" },
  { label: "Push down and back", type: "button", action: (s, v, fig) => { ... } },
  { key: "speed", min: 0, max: 3, step: 0.1, value: 1, hidden: true },   // driven only from the prose
]
```

- **Slider** (default type): `key`, `label`, `min`, `max`, `step`, `value`, `color`, and `unit` or `format(value)`. `marks` puts ticks (and labels, when given) under the track; the thumb snaps to a mark within 2% of it (`snapToMarks: false` turns that off). Values always land on `step`.
- **Choice**: `type: "choice"`, `options` as values or `{ value, label }`. A segmented control; `v[key]` is the option's value (a number or a string).
- **Stepper**: `type: "stepper"`, integers or any `step`; − and + buttons with the value between them.
- **Knob**: `type: "knob"`, for angles and phases; drag sideways or up and down. `wrap: true` makes max wrap round to min.
- **Pad**: `type: "pad"`, `keys: [kx, ky]`, `x` and `y` ranges; the reader drags a dot in a square. Both values arrive in `v`.
- **Switch**: `type: "toggle"`, `key`, `label`, `value`, `color`. Several switches share one row.
- **Button**: `type: "button"`, `label`, `action(s, v, fig)`, `primary: true` for the main one. The exploration script presses every button, from the start and with the first slider at its maximum.
- **Hidden**: `hidden: true` on any control keeps the value and its range but draws nothing in the panel, for numbers the reader changes only from the prose (below).
- Every value readout can be dragged sideways to scrub it, and clicked to type a number.
- Give a control the color of the thing it changes in the figure and the colored word in the prose.

## Prose that drives figures

Three kinds of markup tie the text to a figure. They bind to the figure named by `data-figure="<id>"`, or, without it, to the next figure on the page (so a lead-in can talk to the figure right after it).

```html
<p>Pull the bob back <span class="scrub" data-key="swing"></span> and let go. Compare a
<button class="set" data-set="swing=5">small swing</button> with a
<button class="set" data-set="swing=60 length=2">big swing on a long rod</button>.
Watch the <span class="c-blue" data-part="bob">bob</span>:</p>
```

- **`.scrub`**: a number in the sentence, filled in and kept in sync with the control `data-key`, that the reader drags sideways (Shift for fine) or nudges with arrow keys. Use it for the parameter the sentence is about, so the reader changes it without leaving the text. Works with hidden controls.
- **`.set`**: a "try this" link. `data-set="key=value key2=value2"` glides the figure to those values; `data-press="Button label"` presses a button; `data-play` starts the animation. Use it for the specific comparisons the paragraph makes.
- **`[data-part]`** on a colored term: hovering or focusing it lights that part in the figure. In `draw`, check `g.lit("bob")` (or `g.lit(["bob", "rod"])`) and draw the part emphasized (thicker outline, tinted fill). Set it from figure code with `fig.highlight = "bob"`, which also lights the term.

## The figure handle

Callbacks get it as their last argument (`fig`); `demo()` returns it.

| | |
|---|---|
| `fig.set(key, value)` | Set a control as if the reader moved it (updates the panel and prose, runs `change`, redraws). |
| `fig.setMany({ key: value }, { animate })` | Set several at once; `animate: true` glides numbers there like a preset. |
| `fig.reset()` | Fresh `state()`, keeping the 3D view. |
| `fig.redraw()` | Ask for a redraw. |
| `fig.play(on = true)`, `fig.playing` | Start or stop `step()`. |
| `fig.highlight` | The lit part's name, or `null`; assign to light a part and its term. |
| `fig.state`, `fig.values` | The live `s` and `v`. |
| `fig.destroy()` | Remove the figure (framework wrappers call this on unmount). |

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
| `g.text(str, p, o)` | `color`, `size` [14], `weight` [500], `align`, `baseline`, `italic`, `font` (`"serif"` for variables and quotes, `"mono"` for code), `halo`, `alpha`. Use `g.tex` ([math.md](math.md)) for anything with sub- or superscripts or Greek. |
| `g.measure(str, o)` | Text width in px |
| `g.clip(box, fn)` | Runs `fn` with drawing clipped to `[x, y, w, h]`. Use it for every region of a split figure. |
| `g.color(name)`, `g.rgba(name, a)`, `g.mix(a, b, t)` | Palette lookups and mixes |
| `g.ctx` | The raw 2D context, scaled for pixel density. Wrap raw drawing in `save()` / `restore()`. |

`hatch` fills a shape with diagonal lines in that color (`hatch: g.rgba("muted", 0.55)`), the convention for cut surfaces: bone and metal sliced by a section are hatched. `hatchGap` [6] and `hatchAngle` [45] adjust it.

**Palette names:** `ink`, `muted`, `faint`, `grid`, `panel`, `bg`, `brass` (the accent), and the five subject colors `red`, `orange`, `green`, `blue`, `purple`. Use `g.rgba(name, 0.15)` for soft fills. Hex colors don't follow dark mode.

## Labels and annotations

| call | what it draws |
|---|---|
| `g.label(str, p, o)` | The house label: 12.5 px sentence-case sans with a halo. Name things in lowercase ("condyle", "shear line"). |
| `g.callouts(items, o)` | Labels in the left and right margins of the canvas with leader lines to their anchors, spaced so they don't collide. `items: [{ at: [x, y], text, color, side, dy }]`. `o.split` (x pixel) decides left versus right; `o.size` [12.5], `o.gap` [20]. |
| `g.handle(p, o)` | A grab handle for something draggable: a filled dot in `o.color` that breathes gently until the reader first touches the figure. `o.r` [7], `o.active` (while dragging or hovered). Returns `{ at, r }` for hit-testing. |
| `g.lit(name)` | True while the prose term with `data-part="name"` is hovered (or `fig.highlight` is that name). |
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

`demo`, `palette` (live colors by name), `rgba(name, a)`, `clamp`, `lerp`, `smoothstep`, `TAU`, `E3` (the 3D engine), `Num` (numerics, [plots.md](plots.md)), `SafisTeX` ([math.md](math.md)), and `Safis` (`{ demo, mount, enhance, typeset, version }`, for hosts that add figures after load). `window.__explainer` holds `check()`, `describe(id)`, `drive(id, action)`, and `ids()`, which the scripts use. Opening a page with `?check` shows the self-check in a panel.

Pages follow the reader's light or dark setting; a host can force one with `<html data-theme="light">` or `"dark"`.

## A complete example

A thrown ball. Drag the green velocity arrow to change the throw; gravity is a number in the sentence, with presets for other worlds.

```html
<p>Drag the tip of the <span class="c-green" data-part="aim">green arrow</span> to change how hard and how steeply the ball is thrown. Gravity pulls it down at <span class="scrub" data-key="g"></span>; on the
<button class="set" data-set="g=1.62">Moon</button> the same throw goes six times as far:</p>
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
      { key: "g", label: "Gravity", min: 1, max: 25, step: 0.01, value: 9.81, unit: "m/s²", color: "red", marks: [{ value: 9.81, label: "Earth" }] },
      { key: "showPath", label: "Show path", type: "toggle", value: true, color: "blue" },
      { label: "Throw again", type: "button", action: s => launch(s) },
    ],
    presets: [{ label: "Earth", set: { g: 9.81 } }, { label: "Mars", set: { g: 3.71 } }, { label: "Jupiter", set: { g: 24.79 } }],
    caption: "A ball thrown at the green velocity; the dashed blue line is its path.",
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
      g.arrow(P([0, 0]), P(tip), { stroke: "green", width: g.lit("aim") ? 4 : 3 });
      g.handle(P(tip), { color: "green" });
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
