# Effects: fire, exhaust, smoke, dust, glow, water, sparks, arcs, airflow, wind

The effects kit (`src/effects.js`) draws what lines can't: a flame with embers and soot, a rocket plume with shock diamonds, smoke and steam that billow and shade themselves, dust thrown up from the ground, the glow of hot metal or a filament, water seen from above or in section, ripples and the light pattern on a pool floor, sparks, an electric arc, heat shimmer, streaks of air flowing through an engine, and wind curling round bodies into a vortex street.

- **`g.fx.<name>(box, o)`** draws one effect into `box = [x, y, w, h]` (figure px; `null` for the whole canvas) and returns what the figure needs to label it.
- **`Fx`** is the global namespace: easing (`Fx.follow`), camera matching (`Fx.ellipse`), black-body color, and the bare models for labels and tests.

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

## Fx

| call | |
|---|---|
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
