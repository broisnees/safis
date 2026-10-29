# Effects: fire, exhaust, smoke, dust, glow, water, sparks, arcs, airflow, wind

The effects kit (`src/effects.js`) draws what lines can't: a flame with embers and soot, a rocket plume with shock diamonds, smoke and steam that billow and shade themselves, dust thrown up from the ground, the glow of hot metal or a filament, water seen from above or in section, ripples and the light pattern on a pool floor, sparks, an electric arc, heat shimmer, streaks of air flowing through an engine, and wind curling round bodies into a vortex street.

- **`g.fx.<name>(box, o)`** draws one effect into `box = [x, y, w, h]` (figure px; `null` for the whole canvas) and returns what the figure needs to label it.
- **`Fx`** is the global namespace: easing (`Fx.follow`), camera matching (`Fx.ellipse`), black-body color, and the bare models for labels and tests.
- **`Fx.fluid`, `Fx.waves`, `Fx.particles`** are simulations: real Navier-Stokes air, a simulated water surface, and particles moving by the physics of what they are. Each is made once per figure, stepped from its time, and drawn by `g.fx.fluid`, `g.fx.waves`, `g.fx.particles` (see Simulations).

Every effect is a pure function of the time `t` and a `seed` passed in. Shaders run on one shared WebGL2 context; without WebGL2 each effect draws a simpler 2D version, with no errors.

## When an effect earns its place

An effect belongs in a figure when its look *is* the physics the paragraph teaches, and a control changes it the way the real thing would change:

- the flame turns from yellow to blue as air is premixed (soot versus complete burning),
- the shock diamonds stretch out as the rocket climbs (the outside pressure falls),
- the bright lines on a pool floor sharpen and then blur as the water deepens (each wave crest is a lens),
- the bar's glow climbs from nothing through dull red to yellow (black-body radiation, the Draper point),
- the intake streaks swirl into the fan and the ground vortex appears at high power and low speed.

Leave effects out when they are decoration. A glow behind a title, smoke that no control touches, or sparks that mean nothing all cost frames and attention and teach nothing. If no sentence on the page refers to what the effect shows, cut it.

| The figure shows | Use |
|---|---|
| A flame: color from soot or premixing, height from heat release, flicker, embers, soot smoke | `g.fx.fire` |
| Rocket or jet exhaust, shock diamonds, a plume ballooning at altitude | `g.fx.plume` |
| A chimney, a kettle, a plume spreading and bending in wind | `g.fx.smoke`, `g.fx.steam` |
| Dust from a footstep, an impact, or a jet blowing on the ground | `g.fx.dust` |
| A pool from above (refracted floor, caustics, Fresnel sky), or water in section (light shafts, floor, foam) | `g.fx.water` |
| Air past a body: streamlines, separation, a vortex street, lift from spin | `g.fx.wind` |
| Hot metal, a lamp filament, a weld pool, anything incandescent | `g.fx.glow` (color from `temp`) |
| Waves from point sources, interference, a tilted water surface | `g.fx.ripples` |
| Light focused by a wavy surface onto a floor | `g.fx.caustics` |
| Grinding or welding sparks, embers | `g.fx.sparks` |
| An arc, a spark gap, a Jacob's ladder | `g.fx.arc` |
| Hot air bending light above a surface | `g.fx.shimmer` |
| Air drawn into an inlet and blown out of a nozzle, on any drawing | `g.fx.flow` |
| A real flow: a wake that sheds only above the right Reynolds number, pressure on a body, dye the reader stirs | `Fx.fluid` + `g.fx.fluid` |
| Waves that reflect, diffract through slits, interfere, spread as rings from a pebble | `Fx.waves` + `g.fx.waves` |
| Dust, smoke, rain, sand, sparks moving by their physics: settling, piling, splashing, riding a simulated wind | `Fx.particles` + `g.fx.particles` |

## Rules

- **Time comes from the state.** Keep `t` in `s`, advance it in `step(dt, s)` with `s.t += dt`, and pass `t: s.t`. The runtime clamps `dt` to 1/30 s, so a tab that slept doesn't make the effect jump. Never pass `g.time` or `performance.now()`: the self-check, screenshots, and contact sheets would all change from run to run.
- **Start at a representative moment.** Readers who prefer reduced motion get the figure paused on its first frame, so start `t` where the effect looks like itself (`state: () => ({ t: 2 })`), not at 0. When time itself is what the figure teaches (a ring spreading from a dropped pebble), add a time slider for those readers: `Fx.still` is true when they asked for less motion.
- **Ease every setting that drives an effect.** A slider clicked from 20% to 100% would make a plume or a column of streaks pop. Ease it in `step()` and snap it when the figure is paused:

  ```js
  change(key, s, v, fig) { if (!fig.playing) s.thr = v.throttle; },
  step(dt, s, v) { s.t += dt; s.thr = Fx.follow(s.thr, v.throttle, dt); },
  draw(g, s, v) { g.fx.plume(null, { throttle: s.thr ?? v.throttle, t: s.t }); },
  ```

  Presets and `.set` buttons already glide. A `choice` (such as the propellant) switches at once; that is fine, since the reader asked for a different thing.
- **Layer by call order.** Each call composites into the canvas right away, so anything drawn before it sits behind the effect and anything drawn after sits in front. When a part is on both sides (a test stand with one leg behind the plume and one in front, a duct that streaks pass in front of and behind), split it: draw the back half, then the effect, then the front half. `g.clip(box, fn)` or a part's own polygon does the split.
- **Theme is automatic.** Emitted light (fire, plume, glow, sparks, arc) adds on a dark page. On a light page it multiplies instead, tinting and darkening the paper like ink, because added light vanishes on white; the hottest, whitest parts show as the paper itself inside a colored body. Smoke, steam, water, and flow streaks are paint and cover what's below. Effects may use physical colors (a flame is orange); water and flow use the palette (`"blue"`, `"orange"`) so they follow the theme.
- **Match the drawing's camera.** A round part seen in any parallel view (isometric, `g.view3d`) has an ellipse for a rim, and that ellipse fixes the whole projection of anything round about its axis: the axis runs along the minor axis, foreshortened to sqrt(major² - minor²) px per rim radius. Pass the same ellipse the drawing uses (`nozzle`, `inlet`) and the plume or streaks line up with its outlines from any angle. `Fx.ellipse(project, center, normal, r)` gets it from a 3D projector.
- **Keep the GPU cheap.** Each shader effect renders its box at figure size (pixel density capped at 2) every frame it animates. Give each effect the smallest box that holds it, use `res: 0.5` for big soft ones (smoke), and keep to about four shader effects per figure.

## Common options and return value

| option | default | |
|---|---|---|
| `t` | 0 | Time in seconds. Always `s.t`. |
| `seed` | 1 | Integer. The same seed gives the same flame, sparks, and streaks. |
| `alpha` | 1 | Overall opacity. |
| `blend` | `"auto"` | `"add"`, `"multiply"`, or `"over"` to override the theme's choice. |
| `clip` | the box | A polygon `[[x, y], ...]` to draw inside, such as the opening of a tilted pool. |
| `res` | 1 | Fraction of the figure's pixel density to render shaders at, 0.25 to 1. |
| `gpu` | true | `false` draws the 2D version. `Fx.force2d = true` does it for every effect. |

Every call returns `{ box, gpu }`, where `gpu` says whether the shader drew it, plus the extras below.

## g.fx reference

Positions and lengths are figure px. Angles are canvas radians (y down, so `-Math.PI / 2` points up).

**`g.fx.fire(box, o)`**: a flame on a base line, rising from fuel that burns blue where it is premixed and yellow where soot forms. Returns `{ height, tip }` (px, and the tip's point for a label).

| option | default | |
|---|---|---|
| `base` | bottom center of the box | Center of the flame's base. |
| `width` | `min(0.42 w, 0.45 h)` | Base width. |
| `height` | `0.9 h` | Height at full power. The flame's height grows as `power` to the 2/5. |
| `power` | 0.7 | Heat release, 0 (off) to 1. |
| `soot` | 1 | 1 is a sooty yellow flame, 0 a fully premixed blue one. The base stays blue either way. |
| `wind` | 0 | -1 to 1; leans the top over. |
| `size` | 0.3 | The fire's real diameter in meters. Sets the flicker: flames puff at 1.5 / sqrt(D) Hz, about 3 Hz for a campfire and 15 Hz for a candle. |
| `embers` | 0 | 0 to 1: glowing flecks lofted from the base, wandering more as they climb and cooling from yellow to dull red. Returned as `embers` (each `{ p, T, level }`). |
| `smoke` | 0 | 0 to 1: soot leaving the tip as a smoke column (drawn first, so the flame shines over its root). Only where `soot` is up. `smokeColor` sets its tone. |

The flame is layered: a temperature field from its shape and rising turbulence colors the sooty part by black-body light, dull red at the edges to yellow-white in the core (on dark pages an exposure curve takes the core to white); the premixed base burns in a thin blue cone; the tip breaks into licks.

**`g.fx.plume(box, o)`**: rocket or jet exhaust, ray-marched as a round jet so it fits a nozzle drawn at any angle. Returns `{ length, end, diamonds }`: the visible length in px, the end of the axis, and a point at each shock diamond (for labels and highlights).

| option | default | |
|---|---|---|
| `nozzle` | | The exit rim as a screen ellipse `{ center, rx, ry, angle }`. With `axis` (screen direction of the flow) and `along` (px per exit radius along the axis), or from `Fx.ellipse`. |
| `at`, `angle`, `width` | top center, `Math.PI / 2`, `0.16 min(w, h)` | A side view instead: exit center, flow direction, exit diameter. |
| `throttle` | 0.8 | 0 (off) to 1. Longer, brighter plume and bigger shock cells. |
| `ambient` | 1 | Outside pressure over sea-level pressure. Falling pressure stretches the cells (about 1.3 D sqrt(M² - 1) apart), fades the diamonds, and lets the plume balloon. `Math.exp(-km / 8.5)` for altitude. |
| `fuel` | `"kerosene"` | `"kerosene"` (sooty orange), `"methane"` (blue), `"hydrogen"` (nearly clear, faint violet). |
| `diamonds` | true | `false` hides the shock cells. |

**`g.fx.smoke(box, o)`** and **`g.fx.steam(box, o)`**: a rising column whose width grows by 0.12 of its height as it pulls in air. Smoke is particles and keeps going; steam is droplets that evaporate, so it fades within a short rise. Returns `{}`.

| option | default | |
|---|---|---|
| `at` | bottom center of the box | The source. For steam, start it a little above the spout: the vapor right at the spout is too hot to have condensed and is invisible. |
| `width` | `0.1 w` | Source width. |
| `rise` | 0.35 | Rise speed in box heights per second. |
| `wind` | 0 | Sideways drift per unit of rise (1 leans 45°). |
| `density` | 0.7 | 0 to 1. |
| `spread` | 0.12 | Widening per unit height. |
| `kind` | `"smoke"` | `"steam"` (what `g.fx.steam` sets). |
| `color` | grey | A palette name, such as `"brass"` for dust. |
| `light` | -2.16 | Direction toward the light, canvas radians (upper left). The column shades itself: each billow is bright on its lit face and darker on the far side and under the rest. |
| `shadow` | 1 (steam 0.45) | How dark the self-shadowing gets, 0 to 2. |
| `billows` | 1 (steam 0.6) | 0 is a soft column; 1 breaks it into puffs with edges (folded noise that evolves in time and swirls more as it rises). |

Smoke renders at `res: 0.5` by default; pass `res: 1` for a small, sharp figure.

**`g.fx.dust(box, o)`**: dust raised from a ground line. A burst (a footstep, an impact) is a cloud that spreads fast, slows, piles up into a rolling rim, and settles; a jet blowing down on the ground feeds a layer that runs outward both ways, thickening, with a rolled-up front. Grains are thrown ballistically and land. Lit and self-shadowed like smoke. Returns `{ ground, grains }`.

| option | default | |
|---|---|---|
| `ground` | 92% down the box | Screen y of the ground. |
| `sources` | one burst at the box center | Up to 4: `{ at: [x, y], kind: "burst" \| "jet", start, strength, angle }`. A burst happens at `start` (a time); press a button that sets `start: s.t` for another. `strength` 0 to 3. |
| `scale` | `0.24 h` | Size of the cloud in px (a burst spreads to about 2 scales). |
| `density`, `settle`, `grains` | 1, 2.6 s, 1 | Opacity, how long a burst takes to settle, how many grains (0 for none). |
| `light`, `shadow`, `color` | upper left, 1, `"brass"` | As for smoke. |

**`g.fx.water(box, o)`**: a body of water. `view: "top"` (default) is a pool seen from above: the floor (`"tiles"`, `"sand"`, or `"plain"`) is seen through the surface, shifted by refraction; it is lit by the caustics the same surface focuses; red is absorbed first on the way down and back, so depth turns it blue-green; the surface reflects the sky by Fresnel (more at a grazing view) and the sun as glints. `view: "side"` is a section: waves on the surface, light shafts below it (each crest focuses the light into a sheet), color deepening with depth, a sandy floor lit by the same focusing, drifting specks, and foam on the crests. Returns `{ height(p), intensity(p) }` from above, `{ level(x) }` in section.

| option | default | |
|---|---|---|
| `view` | `"top"` | `"side"` for a section. |
| `depth`, `clarity` | `2 scale`, `3 scale` (top) | px. Clarity is how far light goes before green falls to 1/e; murky water is a small number. In section, `clarity` sets how fast color deepens and shafts fade. |
| `scale`, `amp`, `wind`, `calm` | 80, 1, 0.6, false | Wind waves, as in `g.fx.caustics`. |
| `sources`, `wavelength`, `speed`, `damping` | | Ripples on top, as in `g.fx.ripples`. A source with `dur` rings for that long and dies away: `{ at, start: s.t, dur: 0.7, amp: 3 }` is a dropped pebble. |
| `floor`, `tile` | `"tiles"` (top), `"sand"` (side); `0.55 scale` | Floor pattern and tile size in px. |
| `tilt` | 0.35 | View angle from straight down, radians: more tilt, more sky reflected. |
| `foam` | 0 (top), 0.6 (side) | Whitecaps on the highest crests, 0 to 1. |
| `level`, `bottom` | 28% and 97% down the box | In section: screen y of the still surface and of the floor. |
| `n`, `color`, `specks` | 1.333, `"blue"`, true | Index of refraction, tint, drifting specks in section. |

**`g.fx.wind(box, o)`**: air past round bodies. Each body is a doublet in a uniform stream (potential flow round a cylinder), with circulation from `spin`; behind it the flow is slack (it separates), and it sheds a von Kármán street of vortices of alternating sign at a Strouhal number of 0.2, drifting downstream at 0.85 of the stream. Streaks are particles released along the upstream edge and followed for `trail` seconds; dye released at each body's shoulders traces the wake. Paths are cached between frames on a fixed time grid, so a frame depends only on `t` and costs about one integration step per streak. Draw the body after the wind. Returns `{ count, velocity(p) }`.

| option | default | |
|---|---|---|
| `bodies` | none | Up to 4: `{ at: [x, y], r, spin, shed }`. `spin` -2 to 2: 1 puts the two stagnation points together, and the side moving with the stream speeds up (lift). `shed: false` turns its wake off. |
| `speed`, `angle` | `0.22 w` px/s, 0 | Stream speed and direction (canvas radians). |
| `density`, `spacing`, `trail`, `width` | 1, 10 px, 0.8 s, 1.1 | Streak count, lane spacing, streak length in seconds, width. |
| `turbulence`, `shedding` | 0.25, 1 | Gusts in the stream; strength of the vortex street (0 for none). |
| `color`, `colorBy` | `"blue"`, `"speed"` | Streaks lighten where the air is fast; `colorBy: "none"` keeps one color. |
| `dye`, `dyeColor` | true, red (orange on dark) | Smoke from the bodies' separation points. |

**`g.fx.glow(box, o)`**: a hot body and its bloom, colored by temperature. Returns `{ color, level }`: the CSS color and the brightness used, for a matching label or legend.

| option | default | |
|---|---|---|
| `at`, `r` | box center, 6 | A glowing point (a lamp, a star) and its radius. |
| `path`, `width`, `close` | | A glowing shape instead: a polyline (a filament, a bar, a coil) and its thickness. |
| `temp` | 2700 | Kelvin. Sets the color (black body) and the brightness, which is zero below the Draper point (798 K) and full by 1600 K. A filament is about 2700 K, a weld pool 1800 K, steel just glowing 900 K. |
| `intensity` | from `temp` | 0 to 2, to override the brightness. |
| `spread` | 22 | Bloom radius. Keep the box at least 3 spreads wider than the shape. |
| `core` | true | `false` draws the halo only, around a part drawn separately. |
| `color` | | A palette name instead of a temperature (a neon sign). |

**`g.fx.ripples(box, o)`**: the water surface from point sources, each sending rings whose height falls as 1/sqrt(distance). Returns `{ wavelength, period, height(p) }`; `height` gives the surface at a figure point in units of one source's amplitude, for marking crests or calm lines.

| option | default | |
|---|---|---|
| `sources` | the box center | Up to 8: `[x, y]`, or `{ at, phase, amp, start, dur }`. With `start` (a time), the rings spread out from that moment at the wave speed; with `dur`, the source rings for about that many seconds and dies away, so it sends a packet of rings (a dropped pebble). |
| `wavelength`, `speed` | 32, 48 | px and px/s. |
| `amp`, `damping` | 1, 0 | Wave height scale; amplitude lost per px. |
| `style` | `"water"` | `"height"` colors crests `high` and troughs `low` on the paper, to show interference plainly. |
| `color`, `low`, `high` | `"blue"`, `"blue"`, `"red"` | Palette names. |
| `frame` | the screen | `{ origin, x, y }`: where the surface's origin and its unit x and y axes land in figure px, for water drawn in perspective or isometric. Sources and wavelength are then in surface units. |

**`g.fx.caustics(box, o)`**: the bright web of light on a pool floor under wind waves. A slope bends each ray by a quarter of its angle, so every crest focuses light at some depth; the floor is evenly lit at depth 0, sharpest near the focal depth, and blurred past it. Returns `{ intensity(p) }`, the floor brightness at a point (1 is flat water).

| option | default | |
|---|---|---|
| `depth` | `2 * scale` | Water depth in px. |
| `scale` | 80 | Typical wind-wave length in px. The waves have deep-water dispersion: long ones move faster. |
| `amp`, `wind`, `calm` | 1, 0.6, false | Wave steepness, wind direction (radians), `true` for no wind waves. |
| `sources`, `wavelength`, `speed` | | Ripples on top, as in `g.fx.ripples` (a dropped pebble: `{ at, start: s.t }`). |
| `color`, `frame` | `"blue"` | Floor tint; surface frame as in `g.fx.ripples`. |

**`g.fx.sparks(box, o)`**: hot particles thrown from a point, flying under gravity and drag and cooling from yellow to red until they go dark. Always drawn in 2D. Returns `{ sparks }`, each `{ k, p, tail, T, age, life, level }`.

| option | default | |
|---|---|---|
| `at`, `angle`, `spread` | `[center, 0.85 h]`, `-Math.PI / 2`, 0.55 | Emitter, mean direction, half-angle of the cone. |
| `speed`, `rate`, `life` | `1.5 h` px/s, 50 per s, 1.1 s | Launch speed (each spark gets 40% to 100% of it), births per second, longest life. |
| `gravity`, `drag` | `2.2 h` px/s², 1.2 per s | Linear drag, solved exactly: sparks reach a terminal speed `gravity / drag`. |
| `temp`, `width`, `trail` | 2000 K, 1.5, 1/30 s | Birth temperature; streak width; streak length as a camera's exposure. |

**`g.fx.arc(box, o)`**: an electric arc whose path wanders as the hot channel drifts, with short branches that strike and fade. Air in an arc glows blue-violet around a white-hot core. Returns `{ path, branches }` (point lists).

| option | default | |
|---|---|---|
| `from`, `to` | left and right of the box's middle | The electrodes. The path starts and ends exactly there. |
| `jitter`, `rate`, `branches` | 0.16, 7, 2 | Wander as a fraction of the length, how fast it wanders (Hz), branches (0 to 4). |
| `width`, `spread`, `intensity` | 1.6, 14, 1 | Core thickness, glow radius, brightness (0 to 2). |
| `color` | violet | A palette name to override. |

**`g.fx.shimmer(box, o)`**: heat haze. It redraws what is already on the canvas inside the box, displaced by rising turbulence, strongest at the box's bottom edge (the hot surface). Draw it after the background it distorts and before anything that should stay sharp. Without WebGL2 it slides rows sideways. Returns `{}`.

| option | default | |
|---|---|---|
| `strength`, `scale`, `rise` | 2.5, 16, 40 | Displacement in px, eddy size in px, rise speed in px/s. |

**`g.fx.flow(box, o)`**: streaks of air through an engine or a duct. Cold intake air is drawn into the inlet from a wide region, speeding up and swirling toward the fan; hot exhaust leaves the nozzle, slows, spreads, and cools from orange to blue as it mixes; at high power and low forward speed a thin vortex rises from the ground into the inlet. Each streak is a particle followed for `trail` seconds through a model flow (a sink over the inlet face, a spreading jet, curl noise), so it shows the real shape of the flow but is not a fluid simulation; say so in the caption. Always drawn in 2D. Returns `{ count, frame }`.

| option | default | |
|---|---|---|
| `inlet` | a ring at 30% across the box | The inlet rim as a screen ellipse `{ center, rx, ry, angle }`. |
| `nozzle` | 4 radii downstream | The nozzle rim, the same way. Without it there is no exhaust. |
| `axis`, `along` | inlet to nozzle; from the ellipse | Screen direction of the flow; px per inlet radius along it. |
| `throttle` | 0.7 | Streak density, swirl, and jet speed. |
| `temperature` | 900 | Exhaust temperature in K. The ramp runs from palette blue (288 K) through purple and red to orange (900 K and up). |
| `speed` | 0.1 | Forward speed, 0 to 1. Narrows the air the inlet captures and blows the ground vortex away. |
| `ground` | none | Screen y of the ground under the inlet. The ground vortex needs it, and weakens as the inlet sits higher. |
| `density`, `trail`, `width` | 1, 0.45, 1.1 | Streak count (0 to 4), streak length in seconds, line width. Each streak tapers from its head to a hairline tail. |
| `intake`, `exhaust` | true, true | Turn either stream off. |

## Simulations: fluid, waves, particles

`g.fx.wind`, `g.fx.water`, and `g.fx.dust` are models drawn from formulas. When the figure must behave like the real thing (a wake that sheds only above the right Reynolds number, waves that diffract through the slit the reader moved, dust that piles where it lands), simulate it. A simulation is made **once**, in the figure's block, stepped from the figure's time, and drawn by its `g.fx` call:

```js
{
  const sim = Fx.fluid({ domain: [2.4, 0.9], speed: 0.5, re: 60, obstacles: [{ shape: "rect", at: [0.6, 0.45], size: [0.16, 0.16] }] });
  demo("channel", {
    aspect: w => w / (w * 0.9 / 2.4 + 50),
    reset: true,
    state: () => ({ t: 5 }),                           // 5 s in, the wake has formed; reset comes back here
    controls: [
      { key: "speed", label: "Inflow speed", min: 0.1, max: 1, step: 0.01, value: 0.5, unit: " m/s", color: "orange" },
      { key: "re", label: "Reynolds number", min: 5, max: 250, step: 1, value: 60, color: "blue" },
    ],
    drag: sim.interact,                                 // drag the square, or stir the air
    step(dt, s, v) { sim.set({ speed: v.speed, re: v.re }); s.t += dt; sim.advance(s.t); },
    draw(g, s, v) {
      const H = g.w * 0.9 / 2.4, r = g.fx.fluid([0, 0, g.w, H], { sim, arrows: true });
      g.fx.colorbar([g.w - 190, H + 26, 170, 8], r.legend);
    },
  });
}
```

- **Meters, y down.** Positions are meters from the top left of `domain: [width, height]`; the `g.fx` call maps the domain onto its box, so give the box the domain's aspect. `sim.toWorld(p)` and `sim.toScreen(q)` convert with the box it was last drawn in.
- **Settings from `v`, in `step`.** Call `sim.set(...)` from the controls at the top of `step`, so the simulation always matches the sliders (also after the checker's probes).
- **Time.** `sim.advance(t)` steps in fixed sub-steps up to `t`. `sim.warm(t)` does it once and keeps a checkpoint, so the still frame (reduced motion, the checker) shows a developed flow and going back in time (reset, the checker's probes) reloads it instead of recomputing. Warm lazily, the first time the figure is on screen: `draw(g, s, v, fig) { if (!s.warmed && fig.visible) { sim.warm(s.t); s.warmed = true; } ... }`. Figures draw once as the page loads even when they're far down, and several warm-ups on the CPU fallback can take seconds, so warming in `state()` slows every page load. `sim.reset()` starts from rest. The same history gives the same picture. Inside a figure's frame, stepping keeps to about 10 ms a frame across all sims, so a long warm-up spreads over several frames: `sim.behind` is true until the sim reaches its time, and `g.fx` keeps catching it up and shows a "Simulating" chip meanwhile (even on a paused figure). Called outside a frame, or while the checker runs, `advance` and `warm` finish at once.
- **GPU or not.** Fluid and waves run in float textures on the shared WebGL2 context (`sim.gpu`), or as WebGPU compute where there's a hardware adapter (Backends, below); without float render targets, or on a software WebGL (SwiftShader, as in the checker's screenshots), the same steps run on the CPU on a coarser grid. `gpu: true` forces the shaders, `gpu: false` the CPU. Particles run on the CPU (a few thousand is fine) or on WebGPU. The CPU reads back a small velocity grid only when arrows, streamlines, particles, or `sim.velocity` need it.
- **Cost** (laptop GPU, step and redraw): the channel above 7 ms a frame, a vortex street 6 ms, a ripple tank 1.5 ms, 1,400 dust motes 1.5 ms, smoke in a simulated wind 9 ms (software WebGL, on the CPU: 11 to 15 ms). Keep to one fluid per figure.

**`Fx.fluid(o)`**: incompressible Navier-Stokes on a staggered grid: MacCormack advection, viscosity (implicit when it's strong), and a pressure projection (red-black SOR) that leaves the divergence at a solver residual. Bodies are no-slip (or free-slip); air flows in on the left at `speed` and out on the right. It gives the real regimes: steady attached flow at Re 2, a recirculation bubble behind a cylinder from about Re 7, and a von Kármán street above about 47, shedding at St = fD/U near 0.18 at Re 150.

| option | default | |
|---|---|---|
| `domain`, `speed` | [2.4, 0.9], 0.5 | m; inflow m/s. |
| `re` or `nu` | `re: 100` | Reynolds number U L / ν on `length` (default the first body's size across the stream), or the viscosity in m²/s (air 1.5e-5, water 1e-6). With `re`, changing `speed` keeps Re. Real air past a 10 cm cylinder at 1 m/s is Re 6,700, past what a grid resolves: write "at Re 150" in the caption. |
| `obstacles` | none | `{ shape: "circle", at, r }`, `{ shape: "rect", at, size, angle }`, `{ shape: "polygon", points }`, `{ shape: "airfoil", at, chord, thickness, camber, alpha }` (NACA 4-digit, `alpha` nose up). `slip: "free"`; `fixed: true` so the reader can't drag it. Keep a body 10 or more cells across (`sim.h` is a cell). |
| `walls` | `"slip"` | Top and bottom: `"slip"`, `"no-slip"`, `"open"`. |
| `dye`, `streaks`, `fade` | none, 0, 0 | Dye sources `[{ at, r, rate }]`; `streaks: 0.05` releases dye lanes 5 cm apart at the inflow (streaklines); dye loss per second. |
| `vorticity` | 0 | Vorticity confinement. Not physical (it keeps eddies the grid would smear): leave it off unless the caption says so. |
| `cells`, `cpuCells`, `iterations`, `track` | 96, 40, 24, false | Grid rows on the GPU and CPU; SOR iterations per step; record the wake for `shedding()`. |

Methods: `set({ speed, re, nu, length, vorticity, iterations, dye, streaks })`, `velocity(q)` (m/s), `sample(q)` (`{ u, v, speed, p, solid }`), `solidAt(q)`, `stir(a, b, { radius, strength, dye })`, `inject(q, { radius, amount })`, `paint(q, r, on)` and `clearPaint()` (a solid the figure paints), `move(i, at)` (its motion pushes the air), `update()` after editing `sim.obstacles`, `shedding()` (`{ frequency, strouhal }`), `interact` (a `drag` spec: drag a body or stir), and `re`, `nu`, `speed`, `time`, `gpu`, `grid`, `h`.

**`g.fx.fluid(box, { sim, show, ... })`** returns `{ legend, toWorld, toScreen }`.

| option | default | |
|---|---|---|
| `show` | `"speed"` | `"speed"` (magma, m/s), `"pressure"` (coolwarm, the pressure coefficient Cp against the inflow), `"vorticity"` (coolwarm, ωD/U), `"dye"` (dye on the paper), `"none"`. |
| `map`, `range` | by `show` | Any colormap; `[lo, hi]`. |
| `arrows` | false | `true` or `{ spacing: 26, scale, color, width }`: arrows on a grid, length by speed up to `scale` (1.5 × inflow). |
| `streamlines`, `bodies` | 0, true | Streamlines from the inflow edge; draw the bodies (`bodyColor`, `dyeColor`). |

`g.fx.colorbar(box, { map, range, label, ticks })` draws the legend `g.fx.fluid` returns, in either theme.

**`Fx.waves(o)`**: the water surface by the 2D wave equation (height and its rate, symplectic steps): walls reflect, gaps diffract, sources interfere, and a sponge along the edges absorbs what reaches it.

| option | default | |
|---|---|---|
| `domain` | [1.6, 1] | m |
| `speed` or `depth` | `depth: 0.01` | Wave speed m/s, or the depth: shallow water runs at c = √(g h) (`gravity` 9.81). |
| `tension` | 0 | Surface tension over density, m³/s² (water 7.3e-5): short ripples outrun long ones, so a pebble's rings spread into a train. |
| `damping`, `edges`, `sponge` | 0.15/s, `"absorb"`, 10% of the short side | `"reflect"` makes the box edge a wall. |
| `walls` | none | `{ from, to, width }`, `{ points, width }`, `{ polygon }`. `Fx.waves.slits(a, b, [[center, width], ...], thickness)` is a barrier from a to b with gaps. |
| `sources` | none | `{ at, to, freq, amp, phase, start, dur, r }`: a point (a line with `to`: plane waves) at `freq` Hz; `amp` is the wave height one wavelength out, m. |

Methods: `drop(q, { amp, r })` (a pebble), `height(q)`, `heights()`, `set({ speed, depth, tension, damping, walls, sources })`, `interact` (a click drops a pebble).

**`g.fx.waves(box, { sim, look })`**: `"pool"` (from above: the floor refracted by the surface, lit by the caustics it focuses, Fresnel sky), `"height"` (crests `high`, troughs `low` on the paper, or a `map`), `"caustics"` (the floor light alone), `"section"` (the surface along the row `at`, exaggerated). Pool options as for `g.fx.water`, in m: `depth` (to the floor, 0.3), `tile`, `floor`, `clarity`, `tilt`, `n`. `g.fx.water`, `g.fx.ripples`, and `g.fx.caustics` given `{ sim }` draw the simulation.

**`Fx.particles(o)`**: the same physics as `E3.particles`: the matter sets gravity and the drag that gives its terminal speed (solved exactly over each step), a hot gas's lift g(T - Ta)/T fading as it mixes, curl-noise eddies, and how it meets the ground. Slots are reborn on a seeded schedule, so a time shows the same particles.

| option | default | |
|---|---|---|
| `matter` | `"dust"` | smoke, exhaust, steam, fire, dust, mist, sand, water, rain, snow, spark, ember, bubble, air, pollen, grass-seed, leaf (`Fx.matter(name)` shows the numbers). |
| `domain`, `units` | [4, 2.25], `"m"` | World size; world units per meter (`"cm"`, `"mm"`, or a number). |
| `count`, `seed`, `life`, `size` | 400, 1, matter | Slots; size `[birth, end]` in m. |
| `emitter` | a point low in the middle | `{ shape: "point", "disk", "line", "box", at, radius, from, to, size, dir (radians), spread, speed: [a, b] m/s }` |
| `forces` | the matter's | `gravity` (m/s², down), `drag` (1/s), `buoyancy`, `wind: [x, y]` m/s, `turbulence: { strength m/s, scale m, speed }` |
| `ground`, `colliders` | none | The floor's y; `[{ from, to }, { circle: [x, y, r] }, { points }]` with `bounce`, `friction`. |
| `fluid` | none | An `Fx.fluid`: particles drag toward its velocity, so smoke and dust go round bodies and into the eddies, and hit its bodies. The domain is the fluid's. |
| `pile`, `heap`, `splash` | dust, sand; 1; water, rain | Grains at rest roll down the heap to their angle of repose (`heap` scales their volume to be seen); drops break into droplets. |
| `light` | none | `{ from, dir, width }`: a beam. Particles in it scatter it toward the eye (the Tyndall effect): motes glint, the rest stay faint. |
| `density`, `temperature`, `color`, `opacity`, `style` | | Share drawn (a throttle), `[birth, end]` K, look. |

Methods: `set({ density, wind, emitter, light, emitting })`, `alive()` (`[{ p, v, age, life, landed }]`), `droplets()`, `pile()`, `terminal()`, and the clock (with a `fluid`, `warm` and `advance` drive both).

**`g.fx.particles(box, { sys })`** draws by style: lit puffs that shade themselves (smoke, steam), additive glow (fire), streaks (rain, water, air), hot ribbons (spark, ember), motes that glint in the beam (dust, pollen), dots, bubbles, leaves, and the heap. `light` (`null` hides the beam), `lightAngle` (the puffs' light), `opacity`, `color`, `trail`.

### Backends

Each simulation steps on WebGPU compute, WebGL2 shaders, or the CPU: the same steps in the same order, so a history gives the same picture on each, within float rounding. WebGL2 (or 2D) still draws them.

| backend | used | |
|---|---|---|
| `"webgpu"` | with a hardware WebGPU adapter (the default there) | Fluid and waves as compute passes (the pressure sweep runs in place); particles one thread per slot through a whole run of steps, so the warm-up of 20,000 takes 4 ms instead of 570 and up to a million slots run. The state comes back without stalling: while it runs, what's drawn (and `velocity`, `heights`, `alive`) is a frame behind its clock; a still figure settles on exactly time t. `await sim.sync()` waits for it. |
| `"webgl2"` | without WebGPU; the checker (SwiftShader has none) | Float textures on the shared context. |
| `"cpu"` | `gpu: false`, no float render targets, software WebGL | Fluid and waves on a coarser grid (`cpuCells`); particles show their first 20,000 slots. |

`Fx.backend` reads what new simulations use; setting it forces one (`"auto"` undoes it), and a running fluid or wave field moves between WebGPU and WebGL2 at its next step without changing its frames. A simulation's `backend` option overrides it, `?backend=webgl2` in the page URL (or `window.SAFIS_BACKEND` set before the scripts) forces one for a test, and `sim.backend` says where it runs. Some stay put because they share state every step: a fluid that tracks shedding or carries `Fx.particles`, and particles with a heap, splashes, or a fluid run on WebGL2 and the CPU. A software adapter is skipped unless forced. `Fx.webgpu` describes the device.

Measured on an M3 Pro (ms per 1/60 s of simulated time, to the end of the GPU work): the 96-row channel 0.6 on WebGPU, 2.7 on WebGL2, 49 on the CPU; 192 rows 3.7 and 7.7, and with 80 pressure iterations 9.9 and 23. Waves cost under 0.1 ms on either GPU backend at 160 rows. 20,000 snowflakes 0.03 ms on WebGPU, 1.3 on the CPU. `node tools/time-backends.mjs --gpu` times every lab figure on each backend.

## Adding a new effect, matter, or colormap

Define it in the page's first script; it is checked as it's made, and a bad key or number throws saying what it should be.

```js
Fx.matter.define("ash", { base: "dust", vt: 0.5, color: "#777" });            // like dust, falls at 0.5 m/s
Fx.matter.define("fluff", { vt: 0.25, style: "mote", eddy: [0.4, 0.6, 0.3], life: [6, 10], size: [0.01, 0.01] });
Fx.colormap.define("ocean", ["#03051a", "#1d4e89", "#2fa4c9", "#d8f3f0"]);   // low to high, evenly spaced
Fx.colormap.define("signed", [[0, "#2b59c3"], [0.5, "#f2f2f2"], [1, "#c0392b"]]);
// then: Fx.particles({ matter: "ash", ... }); g.fx.fluid(box, { sim, map: "ocean" })
```

| matter key | |
|---|---|
| `vt`, `rise`, or `drag` (one) | Terminal speed falling in still air, m/s (Stokes for fine grains: (ρp - ρair) g d² / 18μ); a bubble's rise, m/s; a gas's mixing rate, 1/s |
| `base` | A matter to copy and change |
| `gas`, `temperature`, `lift` | Hot gas: lift g (T - 293) / T at `[birth K, end K]`; or a fixed lift in g |
| `eddy` | `[speed m/s, size m, change rate]` of the air it rides: indoors [0.03, 0.4, 0.1], outdoors [1, 1, 0.3] |
| `life`, `size`, `opacity`, `color`, `fade` | `[min, max]` s; `[birth, end]` m; 0 to 1; CSS color or palette name; `[in, out]` as shares of life |
| `style` | `puff`, `glow`, `mote`, `dot`, `streak`, `spark`, `bubble`, `leaf` (E3's `smoke`, `fire`, `sphere` work too) |
| `bounce`, `friction`, `pile`, `splash`, `flutter` | 0 to 1; 0 to 1; heaps at this angle of repose (degrees); drops break up; `[sway Hz, sway m/s]` |

A colormap is 2 to 64 stops, `"#rrggbb"` or `[r, g, b]` (all 0-1 or all 0-255), even or as `[position, color]` from 0 to 1. Make a diverging map pale in the middle. `Fx.colormap(name, t)` reads one back; `Fx.colormap.names` and `Fx.matter.names` list them.

A new effect is a function of `s.t` drawn with `g`: seed every random number with `Fx.hash`, ease its settings with `Fx.follow`, and look at it in `tools/check-2d.mjs`. For anything stepped on a grid, copy the shape of `Fx.fluid`: made once, `advance(t)` in fixed steps, `warm(t)` the first time the figure is visible.

## Fx

| call | |
|---|---|
| `Fx.fluid(o)`, `Fx.waves(o)`, `Fx.particles(o)` | Simulations (above). `Fx.waves.slits(a, b, gaps, thickness)` makes a slit barrier. |
| `Fx.matter(name)`, `Fx.matter.define(name, o)`, `Fx.colormap(name, t)`, `Fx.colormap.define(name, stops)` | Particle matter and colormaps: read, add. |
| `Fx.follow(cur, target, dt, tau = 0.3)` | Eases `cur` toward `target` with time constant `tau` seconds. Returns `target` when `cur` isn't a number yet. |
| `Fx.ellipse(project, center, normal, r)` | The screen ellipse of a circle (world `center`, `normal`, radius `r`) under any projector: `g.view3d`'s `P` or an E3 view's `project`. Returns `{ center, rx, ry, angle, axis, along }`, ready for `nozzle` / `inlet` with `axis` and `along`. Exact for parallel views; close for mild perspective. |
| `Fx.frame(e, axis, along)`, `Fx.project(F, [s, y, z])` | The affine map an ellipse fixes, and a point in part coordinates (rim radii, `s` along the axis) on screen. Use it to place a label in a plume or a flow. |
| `Fx.blackbody(T)`, `Fx.glowLevel(T)` | Black-body color `[r, g, b]` (0 to 255) and how bright it looks (0 to 1). |
| `Fx.puff(D)` | Flicker frequency in Hz of a fire `D` meters across. |
| `Fx.params(name, box, o)` | The options an effect would use, defaults and limits applied. |
| `Fx.surface(box, o, [x, y])`, `Fx.focus(box, o, [x, y])` | The caustics' water surface `[h, h_x, h_y, h_xx, h_xy, h_yy]` (add `calm: true` for ripples alone), and the floor brightness. |
| `Fx.sparks(box, o)`, `Fx.arc(box, o)`, `Fx.flow(box, o)`, `Fx.embers(box, o)`, `Fx.grains(box, o)`, `Fx.wind(box, o)` | The models' output without drawing. |
| `Fx.windVelocity(box, o, [x, y])`, `Fx.waterLevel(box, o, x)` | The wind's velocity at a point (`null` inside a body); the surface's screen y in section. |
| `Fx.gpu`, `Fx.force2d`, `Fx.errors` | WebGL2 is in use; set to draw every effect in 2D; shader compile messages. |
| `Fx.backend`, `Fx.webgpu` | What simulations step on (`"webgpu"`, `"webgl2"`, `"cpu"`; set to force, `"auto"` to undo); the WebGPU device (`state`, `name`, `errors`, `ready`). |
| `Fx.still` | The reader prefers reduced motion. |
| `Fx.hash(a, b, c)`, `Fx.noise(x, seed)` | Seeded integer hash and smooth 1D noise, for a custom effect. |

## Examples

### A gas flame and its air hole

A burner flame turns from yellow to blue as air is premixed, and its height follows the gas flow to the 2/5 power. The burner tube is drawn after the flame, so it covers the flame's base.

```html
<p>With the air hole shut, <span class="scrub" data-key="air"></span> of the air is premixed and soot glows yellow. Open it to <button class="set" data-set="air=0.95">let air in</button> and the flame burns blue. Turn the <span class="c-orange">gas</span> down and the flame shortens, but only as the 2/5 power of the heat released:</p>
<figure class="demo" id="burner" aria-label="A gas burner tube with a flame above it. Sliders set the gas flow, the air premixed, and a draft. With little air the flame is tall and yellow; with plenty it is short and blue."></figure>
<script>
{
  demo("burner", {
    aspect: 1.45,
    state: () => ({ t: 1.4 }),
    controls: [
      { key: "gas", label: "Gas flow", min: 0, max: 1, step: 0.01, value: 0.75, color: "orange" },
      { key: "air", label: "Air premixed", min: 0, max: 1, step: 0.01, value: 0.1, color: "blue", format: x => `${Math.round(x * 100)}%` },
      { key: "wind", label: "Draft", min: -1, max: 1, step: 0.01, value: 0, color: "muted" },
    ],
    change(key, s, v, fig) { if (!fig.playing) Object.assign(s, { gas: v.gas, air: v.air }); },
    step(dt, s, v) { s.t += dt; s.gas = Fx.follow(s.gas, v.gas, dt); s.air = Fx.follow(s.air, v.air, dt); },
    status: (s, v) => `flame height ${Math.round(100 * (s.gas ?? v.gas) ** 0.4)}% of full`,
    draw(g, s, v) {
      const cx = g.w / 2, top = g.h * 0.74, tw = Math.min(46, g.w * 0.09);
      const f = g.fx.fire([0, 0, g.w, top + 1], { t: s.t, power: s.gas ?? v.gas, soot: 1 - (s.air ?? v.air), wind: v.wind * 0.7, base: [cx, top], width: tw * 1.15, height: g.h * 0.68, size: 0.06 });
      g.rect(cx - tw / 2, top, tw, g.h - top - 18, { fill: "panel", stroke: "ink", width: 1.5 });
      g.line([cx - tw * 1.6, g.h - 18], [cx + tw * 1.6, g.h - 18], { stroke: "ink", width: 1.5 });
      if (f.height > 8) g.label("flame tip", [f.tip[0] + 44, f.tip[1] + 6]);
    },
  });
}
</script>
```

### A rocket plume that turns with the engine

The engine is a wireframe from `g.view3d`; `Fx.ellipse` gives the plume the same exit rim, so the reader can drag the view and the plume stays on the nozzle. The stand's back beam is drawn before the plume and the bell after it.

```html
<p>At sea level the air squeezes the jet into a row of <span class="c-orange" data-part="diamonds">shock diamonds</span>. Climb to <button class="set" data-set="alt=30">30 km</button> and the cells stretch out; by <button class="set" data-set="alt=60">60 km</button> they are gone and the plume balloons. Drag to turn the engine:</p>
<figure class="demo" id="rocket" aria-label="A rocket engine bell seen at an angle with its exhaust plume. Sliders set throttle and altitude; at sea level a row of bright shock diamonds sits in the plume, and higher up they stretch out and fade."></figure>
<script>
{
  const BELL = 2.4, EXIT = 1, THROAT = 0.38;
  const radius = y => THROAT + (EXIT - THROAT) * Math.sqrt(y / BELL);   // bell profile, y down from the throat
  demo("rocket", {
    aspect: w => (w < 560 ? 0.9 : 1.25),
    orbit: { yaw: -0.55, pitch: 0.3, minPitch: 0.05, maxPitch: 0.9 },
    state: () => ({ t: 2 }),
    controls: [
      { key: "throttle", label: "Throttle", min: 0, max: 1, step: 0.01, value: 0.85, color: "orange" },
      { key: "alt", label: "Altitude", min: 0, max: 60, step: 1, value: 0, unit: "km", color: "blue" },
      { key: "fuel", label: "Propellant", type: "choice", options: ["kerosene", "methane", "hydrogen"], value: "kerosene" },
    ],
    change(key, s, v, fig) { if (!fig.playing) s.thr = v.throttle; },
    step(dt, s, v) { s.t += dt; s.thr = Fx.follow(s.thr, v.throttle, dt); },
    draw(g, s, v) {
      const P = g.view3d({ yaw: s.view.yaw, pitch: s.view.pitch, scale: g.h * 0.075, center: [g.w / 2, g.h * 0.2] });
      const ring = y => Array.from({ length: 33 }, (_, i) => P([radius(y) * Math.cos(i / 32 * TAU), -y, radius(y) * Math.sin(i / 32 * TAU)]));
      g.line(P([-2.2, 0.9, -1.4]), P([2.2, 0.9, -1.4]), { stroke: "muted", width: 3 });       // behind the plume
      const exit = Fx.ellipse(P, [0, -BELL, 0], [0, -1, 0], EXIT);
      const pl = g.fx.plume(null, { nozzle: exit, axis: exit.axis, along: exit.along, throttle: s.thr ?? v.throttle, ambient: Math.exp(-v.alt / 8.5), fuel: v.fuel, t: s.t });
      for (let y = 0; y <= BELL + 1e-9; y += BELL / 16) g.path(ring(y), { fill: "panel", close: true });   // in front of it
      for (let y = 0; y <= BELL + 1e-9; y += BELL / 4) g.path(ring(y), { stroke: y < BELL ? "muted" : "ink", width: y < BELL ? 1 : 1.5, close: true });
      g.line(P([0, 0, 0]), P([0, 0.9, 1.4]), { stroke: "ink", width: 2 });
      g.line(P([-2.2, 0.9, 1.4]), P([2.2, 0.9, 1.4]), { stroke: "ink", width: 3 });
      if (pl.diamonds.length) g.callouts([{ at: pl.diamonds[0], text: "shock diamonds", color: "orange" }], { split: pl.diamonds[0][0] + 1 });
      if (g.lit("diamonds")) pl.diamonds.forEach(q => g.circle(q, 9, { stroke: "orange", width: 2 }));
    },
  });
}
</script>
```

### Air through a duct on an isometric drawing

The duct's rims come from the same projector as its outline, so the streaks enter the drawn inlet and leave the drawn nozzle. The ground vortex needs the screen y of the ground under the inlet.

```html
<p>Each streak is a puff of air followed for a third of a second. Run the fan at <span class="scrub" data-key="throttle"></span> with no forward speed and a thin vortex lifts off the ground into the intake; <button class="set" data-set="speed=0.8">give it forward speed</button> and it blows away:</p>
<figure class="demo" id="duct" aria-label="A round duct seen at an angle above the ground. Blue streaks of intake air swirl into its front; orange streaks of exhaust leave the back and fade to blue as they mix."></figure>
<script>
{
  const L = 5, R = 1, RN = 0.72, HGT = 1.7;
  demo("duct", {
    aspect: w => (w < 560 ? 1 : 1.6),
    state: () => ({ t: 3 }),
    controls: [
      { key: "throttle", label: "Throttle", min: 0, max: 1, step: 0.01, value: 0.8, color: "orange" },
      { key: "temp", label: "Exhaust", min: 300, max: 1000, step: 10, value: 850, unit: "K", color: "red" },
      { key: "speed", label: "Forward speed", min: 0, max: 1, step: 0.01, value: 0, color: "blue" },
    ],
    caption: "Streaks follow a model flow (a sink at the intake, a spreading jet, and some swirl), not a fluid simulation.",
    change(key, s, v, fig) { if (!fig.playing) Object.assign(s, { thr: v.throttle, spd: v.speed }); },
    step(dt, s, v) { s.t += dt; s.thr = Fx.follow(s.thr, v.throttle, dt); s.spd = Fx.follow(s.spd, v.speed, dt); },
    draw(g, s, v) {
      const P = g.view3d({ yaw: -0.62, pitch: 0.32, scale: g.w * 0.06, center: [g.w * 0.5, g.h * 0.45] });
      const ring = (x, r) => Array.from({ length: 41 }, (_, i) => P([x, r * Math.cos(i / 40 * TAU), r * Math.sin(i / 40 * TAU)]));
      g.path([[-6, -HGT, -3], [6, -HGT, -3], [6, -HGT, 3], [-6, -HGT, 3]].map(P), { fill: g.rgba("muted", 0.08), stroke: "faint", width: 1, close: true });
      const inlet = Fx.ellipse(P, [-L / 2, 0, 0], [1, 0, 0], R), nozzle = Fx.ellipse(P, [L / 2, 0, 0], [1, 0, 0], RN);
      g.path(ring(-L / 2, R).concat(ring(L / 2, RN).reverse()), { fill: "panel", stroke: "ink", width: 1.5, close: true });   // the body, behind
      g.path(ring(-L / 2, R), { fill: g.mix("panel", "ink", 0.12), stroke: "ink", width: 1.5, close: true });
      g.fx.flow(null, { inlet, nozzle, throttle: s.thr ?? v.throttle, speed: s.spd ?? v.speed, temperature: v.temp, ground: P([-L / 2 - 1, -HGT, 0])[1], t: s.t, seed: 5 });
    },
  });
}
</script>
```

## Recipes

- **A campfire.** `g.fx.fire(box, { power, soot: 1, embers: 1, smoke: 0.7, size: 0.5, t: s.t })` over a drawn hearth; a "Draft" slider into `wind`. Embers and smoke come with it.
- **A footstep in dust.** A ground line, `g.fx.dust(null, { ground, sources: [{ at: [x, ground], start: s.stepAt }], t: s.t })`, and a button whose `action` sets `s.stepAt = s.t`. Start `s.stepAt` a second before `s.t` so the still frame shows a cloud.
- **Downwash on dust.** A rotor or a jet above the ground: `sources: [{ at: [x, ground], kind: "jet", strength: v.power }]`; a dashed line for the jet.
- **A pool and a pebble.** `g.fx.water(null, { depth, sources: [{ at, start: s.drop, dur: 0.7, amp: 3 }], t: s.t })` and a "Drop a pebble" button. Depth sharpens and then blurs the caustics, and turns the water from clear to blue-green.
- **Light under the sea.** `g.fx.water(null, { view: "side", amp, clarity, level, bottom, t: s.t })`; the shafts focus under the crests and fade with depth.
- **Wind past a cylinder, and the Magnus effect.** `g.fx.wind(null, { bodies: [{ at: c, r, spin: v.spin }], t: s.t })` then `g.circle(c, r, ...)`. At `spin: 0` the wake is a vortex street; spin it and the streaks speed up on one side.

## Pitfalls

- **The figure shimmers in screenshots or fails the self-check.** Something passes `g.time` or a clock. Pass `t: s.t` and advance it in `step()`.
- **The figure shows nothing for reduced-motion readers.** `t` starts at 0 and the effect (a ring from `start`, a flame still lighting) hasn't developed. Start `t` at a moment that shows the effect.
- **The effect doesn't move.** It has no `step()`. Effects only animate through `s.t`.
- **A plume or streaks pop when the slider jumps.** Ease the setting with `Fx.follow` in `step()`, and snap it in `change()` when paused, or the slider won't respond while paused.
- **The effect covers a part it should be behind.** Call order is depth order. Split the part into back and front halves around the effect.
- **The glow is cut off square.** The box is too small. Give a glow a box at least three `spread`s past the shape.
- **A glow forced to `blend: "add"` on a light page vanishes.** Leave `blend` on `"auto"`.
- **The plume or streaks miss the drawn nozzle.** The ellipse doesn't match the drawing. Build it with `Fx.ellipse` from the drawing's own projector, or pass the iso drawing's own rim ellipse; for a perspective camera keep the rim small on screen or the match is only approximate.
- **Shimmer distorts the labels.** Shimmer redraws whatever is already in its box. Draw it right after the background, before labels and foreground parts.
- **The page gets slow.** Too many shader effects, or boxes far bigger than the effect. Shrink boxes, add `res: 0.5` to soft effects, and keep to about four per figure.
- **Choosing an effect for mood.** If no control changes it and no sentence refers to it, it is decoration. Cut it.
- **A simulation starts over every frame, or the page crawls.** It's made inside `draw` or `state`. Make it once in the figure's block, and warm it the first time the figure is visible (see Time, above).
- **The still frame shows an empty channel.** No `warm`: the flow starts from rest at t = 0. Warm to a time when the wake or the waves have formed (a few crossing times).
- **The wake never sheds.** Re is below about 47 for a cylinder, or the body is under 10 cells across (`D / sim.h`) and the grid smears it.
- **Smoke goes through the building.** The particles aren't coupled: give them `fluid: sim`.
- **Stirring does nothing until the drag ends.** The figure's `drag` lacks `live: true`; `sim.interact` has it.
