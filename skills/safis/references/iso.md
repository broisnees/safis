# Iso: isometric technical illustration

The iso kit (`src/iso.js`) draws machines the way a technical illustration does: hundreds of small solid parts in near-white porcelain and light metal, each face in one flat tone (a light top, four side tones set by a light that turns with the camera), a crisp ink outline that is heavier on silhouettes than on creases, a soft contact shadow, and color only on the parts the text is about. Everything is vector polygons on the 2D canvas, so the drawing is sharp at any zoom and exports to SVG.

It adds two things to every page:

- **`Iso`**: scenes and part builders, layout and paint order, the paint-order audit, SVG export, drag and hover helpers, and motion helpers.
- **`g.iso(scene, o)`**: draws a scene into a figure and returns the view: `project`, `pick`, `at`, `ellipse`, `glow`.

Conventions everywhere:
- World units are yours (meters for a machine, millimeters for a watch); z is up.
- Colors are material names or palette names (`"steel"`, `"orange"`), so light and dark mode both work. Dark mode turns parts into graphite and dark porcelain with light outlines; nothing to do.
- Build the scene once, outside `draw`. In `draw`, set poses (`move`, `rotate`), `heat`, and text from the state, then call `g.iso`.

## When to use what

| The figure shows | Use |
|---|---|
| A machine, instrument, plant, or apparatus explained part by part: rails, carriages, housings, pipes, knobs, screens | `g.iso` |
| Motion along rails and around axles, an exploded assembly, a cutaway of a casing | `g.iso` (`move`, `rotate`, `cut`) |
| A drawing the reader may download for slides or print | `g.iso` plus `Iso.download` |
| Organic and smooth shapes (bones, organs, molecules), true perspective, free turning of dense meshes | E3 ([engine3d.md](engine3d.md)) |
| A cross-section, a plot, a circuit, anything flat | plain 2D ([runtime.md](runtime.md), [plots.md](plots.md)) |

Iso shines when the object is made of many simple solids and the reader learns from seeing them arranged; E3 shines when the surface itself is the subject.

## Plan before geometry

Write the concept down first: what the reader must see, what moves, what the readout says. Then list the parts by name, at least 40 for a machine figure, grouped by assembly (frame, bed, gantry, carriage, torch, drag chain, control box, power source). Each name becomes `name` on a part, a hover label, and a `data-part` term in the prose. A figure with a dozen labeled boxes or one slab with lines on it reads as a diagram, not a machine; detail (screws, feet, vents, cable glands, handles, end stops) is what makes it read as real.

## Scenes and parts

```js
const S = Iso.scene();
const gantry = S.group({ name: "gantry" });
gantry.box({ name: "upright", from: [-0.05, 0.03, 0.93], to: [0.05, 0.09, 1.08], material: "aluminum", bevel: 0.004 });
gantry.tslot({ name: "gantry beam", from: [0, 0.02, 1.12], to: [0, 1.28, 1.12], size: 0.08, material: "aluminum" });
```

`Iso.scene(o)` returns the root node. `o.shadow` [true] draws the contact shadow, `o.ground` [lowest point] sets its height, `o.ink` [1] scales every line.

Every node (scene, group, part) has the builder methods below, `group(o)`, `part(mesh, o)` for a custom `Iso.Mesh`, `find(name)`, `all(name)`, and `set(o)`. Builders return the new part; groups return the group.

| node property | default | |
|---|---|---|
| `name` | `""` | Used by hover, `pick`, `V.at`, `data-part` links, and drag. Several parts may share one name (all six legs are `"leg"`); a group's name covers everything inside it. |
| `material` | `"porcelain"` | See [materials](#materials). |
| `color` | | A subject color (`"blue"`) that replaces the material's tone, for the part the paragraph is about. |
| `move` | | `[dx, dy, dz]`, applied after `rotate`. Parts are built where they sit at rest; `move` and `rotate` animate them from there. |
| `rotate` | | `{ axis, angle, about }` or a list of them, applied in order. `axis` is `"x"`, `"y"`, `"z"` (or `"-x"`) or a vector; `about` is the pivot. |
| `cut` | | A section plane `[nx, ny, nz, d]` in world coordinates: keeps `n·p <= d` and caps the cut with hatched faces. Set it on a group to cut everything inside; `cut: false` exempts a part. |
| `heat` | 0 | 0 to 1: blends the tones toward the hot material and adds a glow (always on for `material: "hot"` with `heat > 0`). Drive it smoothly. |
| `layer` | 0 | A manual override: every part in a higher layer paints after every part in a lower one. Last resort; see [paint order](#paint-order). |
| `visible`, `pickable`, `shadow`, `opacity` | true, true, true, material | `shadow: false` leaves a part out of the ground shadow; `opacity` overrides the material's. |

## Builders

All sizes are world units. `at` defaults to the origin and `axis` to `"z"`. Every builder also takes the node properties above and `split` (chunks along the long axis, see [paint order](#paint-order)).

| call | options (defaults in brackets) |
|---|---|
| `box(o)` | `from`, `to` (opposite corners) or `size: [x, y, z]` with `at` the center of the bottom face. `bevel` [0] chamfers every edge. Long boxes split automatically; give `split: 1` to a plate that carries decals across its whole face. |
| `cylinder(o)` | `r` [0.5], `r2` (top radius: a frustum, 0 is a cone), `from`/`to`, or `at` (base center) + `axis` + `length` [1]; `center: true` centers it on `at`. `hole` makes a tube (a shell that wraps what is inside it). `bevel`, `segments` [32]; 6 segments make a hex. Metals get a specular stripe. |
| `cone(o)` | `cylinder` with `r2: 0`. |
| `sphere(o)` | `r`, `at` (center), `segments` [24]. |
| `lathe(o)` | `profile: [[r, z], ...]` turned about `axis` from `at`. Go up the outside and back down the inside (counterclockwise with r to the right and z up). Points with r = 0 close the ends. `closed: true` makes a shell (casings, nacelles, combustors); shells split along their axis on their own, or at `splitAt: [z, ...]`. |
| `extrude(o)` | `outline: [[u, v], ...]` (any polygon, concave allowed), `holes` (list of outlines), lifted `depth` along `axis` from `at`; `bevel` (no holes), `spin` turns the outline about the axis. |
| `plate(o)` | `size: [w, d]`, `thick` [0.05], `round` (corner radius), `holes: [{ at: [u, v], r } or { at, size: [w, h], round }]`, `at` (bottom center), `axis` (the plate's normal). |
| `tslot(o)` | T-slot aluminum extrusion: `size` [0.04] square profile with four slots and a bore, `from`/`to` or `at` + `axis` + `length`. |
| `pipe(o)` | `path: [[x, y, z], ...]`, `r` [0.05], `bend` [2.5 r] corner radius, `segments` [14], `caps` [true]. Hoses, cables, handles, coiled conduit (`path: Iso.helix(...)`). |
| `blades(o)` | A radial array of thin twisted blades: `count` [20], `r0` (hub), `r1` (tip), `chord` (or `[root, tip]`), `twist` [[0.5, 1.1]] radians from the axis, `thick`, `spans` [2], `phase`, around `axis` at `at`. Fans, compressor and turbine stages, propellers. Wraps its hub. |
| `screw(o)` | A pan head with a slot, or `head: "hex"`; `r` [0.01], `at` on a surface, `axis` the way the head faces, `angle` turns the slot. |
| `knob(o)` | `r`, `h`, `skirt` [1.25], `angle` (pointer), `axis` (the way it faces), `mark` (pointer color). |

**Decals** are flat marks drawn on one face of a part right after that face. `face` is `"+x"`, `"-x"`, `"+y"`, `"-y"`, `"+z"`, `"-z"` (or a normal vector); positions `[u, v]` are measured from the face's center, with u reading left to right and v up. On a `+z` face, u is +x and v is -y.

| call | |
|---|---|
| `part.vents(o)` | Rounded slots: `face`, `at`, `size: [w, h]`, `count` [5], `open` [0.5] share of each pitch. |
| `part.screen(o)` | A display: `face`, `at`, `size`, `text`, `color` ["green"], `textSize`. Returns a handle; set `handle.text` in `draw` for a live readout on the machine. |
| `part.text(o)` | Text on a face: `face`, `at`, `text`, `size` (world units), `color`, `align`, `font` ("mono" or "text"). Returns a handle with a mutable `text`. |
| `part.ruler(o)` | A scale: `face`, `from`, `to`, `step`, `major` [5], `tick`, `size`, `label(x, i)`, `side`. |
| `part.decal(o)` | Any mark: `face`, `points` (two points draw a line), `tone` ("slot", "screen", "mark", a palette name, or "none" to hide it), `line`, `width`. Returns a handle whose `tone` can change per frame (a kerf that darkens as it is cut). |

`Iso.helix({ at, axis, r, pitch, turns, steps })` returns a coil path. `Iso.fillet(points, r)` rounds a polyline's corners. `Iso.frame(at, axis, spin)` gives the 3x4 placement matrix the builders use.

## Materials

| name | look |
|---|---|
| `porcelain` (default), `white` | Near-white context parts |
| `steel`, `aluminum`, `brass` | Metals, with a specular stripe on turned parts |
| `rubber`, `plastic`, `graphite` | Dark parts: feet, hoses, motor bodies, grips |
| `glass` | See-through blue tint, outlines kept |
| `ghost` | See-through porcelain: housings and nacelles shown so the inside reads |
| `hot` | Orange tint and a glow scaled by `heat` (a combustor, a heater, a cut) |
| `red`, `orange`, `green`, `blue`, `purple` | Pale subject colors, matching the colored word in the prose |

The house style: nearly everything porcelain or metal, and only the parts the current paragraph talks about in a subject color.

## g.iso(scene, o) and the view

```js
const V = g.iso(S, { view: s.view, hover: s.hover });
```

| option | default | |
|---|---|---|
| `view` | `{ yaw: π/4, pitch: π/6 }` | Usually `s.view` from `orbit: Iso.orbit()`. Yaw is the camera's azimuth, pitch its elevation; `Iso.VIEWS` has `iso`, `dimetric`, `front`, `side`, `top`. |
| `box` | whole canvas | `[x, y, w, h]`. |
| `fit` | `"once"` | Fits the drawing on the first draw and keeps that scale while the view turns; `"always"` refits every frame. |
| `zoom`, `margin`, `center`, `scale`, `bounds` | 1, 0.92 | `scale` fixes px per world unit (one floor unit is `scale` px in the default view); `center` is the world point at the box center; `bounds: [lo, hi]` fits a box instead of the drawing. |
| `hover` | | A part or group name to highlight; it crossfades in and out. Prose terms with `data-part` light parts the same way, with no code. |
| `highlightColor` | `"brass"` | |
| `glow` | true | `false` turns off the automatic glow of hot parts. |
| `ink` | 1 | Line weight multiplier. |

The view `V`:

| | |
|---|---|
| `V.project([x, y, z])` | `[px, py, depth]`, for labels, arrows, and effects anchored to 3D points. |
| `V.unproject([px, py], z)` | The world point under a pixel on the plane `z = h`, or on `{ point, normal }`. |
| `V.pick([px, py])` | The front-most part under a pixel: `{ node, name, names, point, face }` or `null`. Solid parts win over see-through ones. |
| `V.at(name, f)` | Screen point of a named part or group (`f` [0.5, 0.5, 0.5] picks a spot inside its bounds). Feed it to `g.callouts`. |
| `V.bounds(name)` | World `[lo, hi]` of everything with that name. |
| `V.ellipse(center, normal, r)` | The screen ellipse of a 3D circle, `{ center, rx, ry, angle, axis, along }`: the format `g.fx.flow` and `g.fx.plume` take for `inlet` and `nozzle`. |
| `V.axis(a, b)` | `{ from, to, dir, length }`: a 3D axis on screen. |
| `V.glow(p, o)` | A glow at a 3D point (`r`, `intensity`, `temp`, `spread`), through `g.fx.glow` when the effects kit is there. |
| `V.stats` | `{ faces, chunks, cycles, ms }` for tuning. |

## Interaction

- **Turn**: `orbit: Iso.orbit({ minPitch, maxPitch })` starts at the dimetric view; `draw` passes `s.view`.
- **Hover**: `hover: Iso.hover(S)` writes the part name under the pointer to `s.hover` (`{ level: "group" }` reports the outermost group, `only: [names]` limits it). Name it on the drawing with `g.callouts([{ at: V.at(s.hover), text: s.hover }])`.
- **Prose**: `<span data-part="gantry">gantry</span>` lights every part in the group named "gantry".
- **Drag along an axis**: `drag: Iso.drag(S, [{ part: "carriage", axis: "y", key: "ty", min, max, scale }])`. The pointer's motion is projected on the axis; `key` is a state field or a control (then the slider and prose follow). `scale` is world units per unit of the value. The first spec whose part is under the pointer wins, so list inner groups first.

## Paint order

Parts are painted back to front, chunk by chunk. For each pair of chunks that overlap on screen, the kit looks for a separating plane (the world axes, then each part's own axes) and paints the chunk on the far side first. Pairs that two planes disagree on can't hide each other and get no constraint. Pairs with no separating plane fall back to the depth of their centers. A shell (`hole`, `closed: true`, `blades`) is split into a back half and a front half each frame, and anything inside it paints between the two. The sort is keyed to the last frame's order, so parts swap only when they must, and it is cached while nothing moves.

Rules that keep it right:

- **Parts touch; they don't interpenetrate.** Model what shows: a bolt head sits on a plate, a shaft runs between two disks rather than through them, a pipe ends on the face it enters. Pipes must not pass through parts.
- **Split long parts.** Boxes, cylinders, and T-slots longer than about four times their thickness split along their length automatically, so a carriage on a rail sorts against the piece it sits on. Plates that carry decals over the whole face need `split: 1`.
- **Wrap with shells.** A casing around a shaft, a ring of blades around a hub, a nacelle around a fan: build the outer one as a shell. Coaxial shells must share split planes (`splitAt`), placed in the gaps between the stages inside them and at the end of each shell, so no inner part straddles a plane.
- **Cut the geometry, don't nudge.** When a pair can't be satisfied, split one of the parts. `layer` is for overlays only.
- **Check with the audit.** `Iso.audit(scene)` samples every overlapping pair after a draw, compares the paint order with the true depth there, and returns `{ pairs, conflicts: [{ first, second, samples, at, depth }], ok }`. Run it in the console from several views (`?check` pages, or `Iso.layout(S, { view })` then `Iso.audit(S, { view: V })`). A few samples where see-through parts touch are harmless; anything else is a part to split.

## Effects on top of the drawing

The view gives the effects kit what it needs, in the drawing's own camera:

```js
const V = g.iso(S, { view: s.view });
const inlet = V.ellipse([-0.1, 0, HC], [1, 0, 0], 1.02), nozzle = V.ellipse([3.42, 0, HC], [1, 0, 0], 0.45);
if (g.fx) g.fx.flow(null, { inlet, nozzle, throttle, temperature: tgt + 273, t: s.t, seed: 4, density: 0.35 });
V.glow([x, y, z], { r: 4, intensity: arc, temp: 2000 });
```

Draw effects after `g.iso`, since they paint over it. Keep `throttle`, `heat`, and glow intensity eased so color never jumps.

## Export

`Iso.toSVG(scene, o)` returns a standalone SVG of the last drawing (or of `o.view` at `o.width` x `o.height`): every face a path, colors as CSS variables with a `prefers-color-scheme: dark` block, a blurred shadow, a hatch pattern for cuts, and live screen text. `o.title`, `o.background` [true]. `Iso.download(scene, "name.svg", o)` saves it (and only returns the string during automated checks). A button in the panel:

```js
controls: [{ label: "Download SVG", type: "button", action: () => Iso.download(S, "plasma-table.svg", { title: "CNC plasma table" }) }],
```

## Motion

| call | |
|---|---|
| `Iso.follow(cur, target, dt, tau = 0.25)` | Exponential follow: moves a share 1 - e^(-dt/τ) of the way, the same at any frame rate. |
| `Iso.spring(st, target, dt, tau = 0.25)` | Critically damped spring on `st = { x, v }` (plain data in the state): settles without overshoot. Returns `st.x`; `st.v` is the speed for a readout. |
| `Iso.pulse(t, rise = 0.12, decay = 0.6)` | A one-off event: smoothstep rise, then exponential decay. |
| `Iso.reduced()` | True under reduced motion; all three helpers then snap to the target. |

All clamp `dt` to 0.1 s, so a tab that slept doesn't jump. Hover highlights crossfade on their own; do the same for `heat` and colored states (drive them with `follow`).

## Examples

### A linear axis you drag, with a readout and an SVG button

A carriage on a rail, moved by the reader's hand; the readout shows the position. For eased motion, keep a target and a spring in the state and step it, as the plasma table does: `step(dt, s) { Iso.spring(s.p, s.x, dt, 0.12); }`, then pose from `s.p.x`.

```html
<p>Drag the <span class="c-blue" data-part="carriage">carriage</span> along the <span data-part="rail">rail</span>; the <span data-part="motor">motor</span> at the end would do this through the belt:</p>
<figure class="demo" id="axis" aria-label="An isometric linear axis: a rail on a base, a blue carriage the reader drags along it, and a stepper motor at one end."></figure>
<script>
{
  const S = Iso.scene();
  S.box({ name: "base", from: [0, -0.05, 0], to: [0.6, 0.05, 0.012], material: "aluminum", bevel: 0.002 });
  S.box({ name: "rail", from: [0.02, -0.01, 0.012], to: [0.58, 0.01, 0.027], material: "steel" });
  for (const x of [0.03, 0.57]) S.screw({ name: "screw", at: [x, 0.03, 0.012], r: 0.005 });
  S.box({ name: "motor", from: [-0.045, -0.022, 0], to: [0, 0.022, 0.044], material: "plastic", bevel: 0.003 });
  S.cylinder({ name: "motor", at: [-0.045, 0, 0.022], axis: "-x", r: 0.012, length: 0.006, material: "steel", segments: 20 });
  const car = S.group({ name: "carriage" });
  car.box({ name: "carriage", from: [0.1, -0.03, 0.027], to: [0.18, 0.03, 0.047], color: "blue", bevel: 0.002 });
  for (const x of [0.11, 0.17]) for (const y of [-0.02, 0.02]) car.screw({ name: "screw", at: [x, y, 0.047], r: 0.004 });
  const D = Iso.drag(S, { part: "carriage", axis: "x", key: "x", min: -0.08, max: 0.38 });
  demo("axis", {
    aspect: 1.9,
    orbit: Iso.orbit({ minPitch: 0.15, maxPitch: 1.2 }),
    state: () => ({ x: 0.12, hover: null }),
    controls: [{ label: "Download SVG", type: "button", action: () => Iso.download(S, "linear-axis.svg") }],
    hover: Iso.hover(S),
    drag: D,
    draw(g, s) {
      car.move = [s.x, 0, 0];
      const V = g.iso(S, { view: s.view, hover: s.hover });
      if (s.hover) g.callouts([{ at: V.at(s.hover), text: s.hover }]);
    },
    status: s => `${(s.x * 1000 + 100).toFixed(0)} mm from the motor`,
  });
}
</script>
```

### An exploded assembly on a slider

Every part stores where it sits; one slider spreads them along their assembly axis.

```html
<p>Pull the <span class="scrub" data-key="open"></span> slider and the valve comes apart in the order it was built: <span data-part="bonnet">bonnet</span>, <span data-part="stem">stem</span>, <span class="c-orange" data-part="seat">seat</span>, body.</p>
<figure class="demo" id="valve" aria-label="An isometric valve that separates into body, seat, stem, bonnet, and handwheel along its axis as a slider opens."></figure>
<script>
{
  const S = Iso.scene();
  const parts = [
    S.cylinder({ name: "body", r: 0.04, length: 0.06, material: "brass", bevel: 0.003 }),
    S.cylinder({ name: "seat", at: [0, 0, 0.06], r: 0.026, length: 0.01, color: "orange" }),
    S.cylinder({ name: "stem", at: [0, 0, 0.07], r: 0.006, length: 0.07, material: "steel", segments: 16 }),
    S.lathe({ name: "bonnet", at: [0, 0, 0.07], profile: [[0, 0], [0.03, 0], [0.03, 0.012], [0.012, 0.03], [0, 0.03]], material: "brass" }),
    S.cylinder({ name: "handwheel", at: [0, 0, 0.14], r: 0.04, hole: 0.033, length: 0.008, material: "steel" }),
  ];
  demo("valve", {
    aspect: 1.2,
    orbit: Iso.orbit(),
    controls: [{ key: "open", label: "Explode", min: 0, max: 1, step: 0.01, value: 0.4, color: "orange" }],
    draw(g, s, v) {
      parts.forEach((p, i) => { p.move = [0, 0, v.open * 0.05 * i]; });
      g.iso(S, { view: s.view, bounds: [[-0.06, -0.06, 0], [0.06, 0.06, 0.36]] });
    },
  });
}
</script>
```

`bounds` fixes the framing to the fully exploded stack, so opening the slider doesn't rescale the drawing. Each part is built where it sits when assembled; the slider only adds a `move`.

### A cutaway with heat and airflow

A shell cut open on the near side, an inner stage, and a hot part whose glow follows the throttle (the [turbofan figure](#effects-on-top-of-the-drawing) at small scale).

```html
<figure class="demo" id="burner" aria-label="An isometric cutaway of a duct: a translucent casing cut open, a ring of blades, and a combustor that glows hotter as the throttle opens. Air streaks flow through."></figure>
<script>
{
  const S = Iso.scene(), H = 0.5;
  S.box({ name: "stand", from: [-0.1, -0.3, 0], to: [1.3, 0.3, 0.04], material: "aluminum", split: 1 });
  S.box({ name: "pylon", from: [0.5, -0.05, 0.04], to: [0.7, 0.05, H - 0.3], material: "steel" });
  // The casing splits between the rotor and the combustor, so nothing inside straddles a split plane.
  S.cylinder({ name: "casing", at: [0, 0, H], axis: "x", r: 0.3, hole: 0.27, length: 1.2, segments: 40, material: "porcelain", cut: [0, 1, 0, 0], splitAt: [0.4, 0.95] });
  const rotor = S.blades({ name: "rotor", at: [0.25, 0, H], axis: "x", count: 18, r0: 0.08, r1: 0.25, chord: 0.08, spans: 1, material: "steel" });
  S.cylinder({ name: "rotor", at: [0.23, 0, H], axis: "x", r: 0.08, length: 0.04, material: "steel", segments: 24 });
  const burner = S.cylinder({ name: "combustor", at: [0.55, 0, H], axis: "x", r: 0.2, hole: 0.1, length: 0.3, material: "hot", segments: 32 });
  demo("burner", {
    aspect: 1.6,
    orbit: Iso.orbit({ yaw: 2.3, pitch: 0.45 }),
    state: () => ({ thr: { x: 0.7, v: 0 }, a: 0, t: 0 }),
    controls: [{ key: "throttle", label: "Throttle", min: 0, max: 1, step: 0.01, value: 0.7, color: "orange" }],
    step(dt, s, v) { s.t += dt; Iso.spring(s.thr, v.throttle, dt, 0.4); s.a += dt * 4 * s.thr.x; },
    draw(g, s) {
      rotor.rotate = { axis: "x", angle: s.a, about: [0, 0, H] };
      burner.heat = 0.2 + 0.8 * s.thr.x;
      const V = g.iso(S, { view: s.view });
      if (g.fx) g.fx.flow(null, { inlet: V.ellipse([0, 0, H], [1, 0, 0], 0.27), nozzle: V.ellipse([1.2, 0, H], [1, 0, 0], 0.27), throttle: s.thr.x, t: s.t, density: 0.4 });
    },
  });
}
</script>
```

## Building a machine quickly

1. Write the concept and the part list (40 or more names) first. Pick units and an origin: a corner of the base at the floor, x along the machine.
2. Block in the big assemblies with `from`/`to` boxes and T-slots: frame, bed, moving axes. Check the silhouette in the default view before adding detail.
3. Put each moving assembly in a group, built at rest. Animate with `group.move` and `group.rotate` from the state; children follow.
4. Add detail where the eye lands: feet and leveling pads, end stops, bearing blocks, motors with end caps, screws on every plate, cable chains, a control box with vents, a screen, knobs and buttons, hoses that start and end on faces.
5. Give materials: porcelain bodies, aluminum extrusions, steel rails and fasteners, rubber and plastic for feet, hoses, and motors. Color one or two parts that the text is about.
6. Wire the reader in: `Iso.orbit`, `Iso.hover` with callouts, `Iso.drag` on the moving assembly, a readout in `status` (and on a `screen` decal), `data-part` terms in the prose.
7. Run `Iso.audit` from four or five views, and fix conflicts by splitting or by making touching parts touch.

## Pitfalls

- **A part shows through another.** Two parts interpenetrate or a long part needs splitting. Run `Iso.audit(S)` and split the part it names; check `V.stats.cycles`.
- **Lines that stop in mid-air.** Every line must end on a face, another line, or a terminal dot. Pipes and cables start and end on a face; a screw sits on a face, not beside it.
- **Pipes through parts.** Route around (along the floor, over a beam) with corners rounded by `bend`.
- **Blades fold into slivers at a cut.** Don't cut rotating parts; cut the casing and keep the stages whole.
- **The model is small in the frame.** A figure fits the drawing on its first draw. Moving parts that travel far need `bounds` or `zoom`.
- **Hex colors.** They break dark mode. Use materials and palette names only.
- **Readouts that jump.** Drive every displayed number from eased state (`Iso.spring`, `Iso.follow`), not from the raw target.
- **Too few or too many faces.** Keep `segments` low on small parts (12 to 16 for screws and knobs) and the whole scene near 3,000 visible faces; check `V.stats`.
- **Check both themes up close.** Take 4x crops around junctions (rail on frame, carriage on rail, pipe on face) in light and dark; that's where sorting slips and stray lines show.
