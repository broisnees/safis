# Optics: rays, mirrors, lenses, prisms, and the eye

The optics kit (`src/optics.js`) adds two things to every page:

- **`Optics`**: a 2D geometric-optics ray tracer. A scene is a list of plain-data elements (flat and curved mirrors, ideal thin lenses, glass bodies, walls, screens, sensors) and light sources. `Optics.trace` follows every ray from surface to surface with Snell's law, splits it into reflected and transmitted parts by the Fresnel equations, reflects it totally past the critical angle, and spreads white light into colors with a real, wavelength-dependent index. It also holds the formulas (Snell, Fresnel, thin lens, lensmaker, rainbow angles), the materials, wavelength colors, and a schematic eye that accommodates and wears glasses.
- **Helpers on `g`**: `g.optics` traces and draws a scene and returns every hit; `g.rayAngles` marks the angles of incidence, refraction, and reflection against the normal; `g.eye`, `g.visibleSpectrum`, and `g.wavelengthColor`.

Use it for every figure where light changes direction. Never hand-draw a refracted ray: build the scene, trace it, and every angle, focus, and color on screen is computed.

Conventions:
- World coordinates have y up, in any unit you pick (cm for an optical bench, mm for the eye). Map them to the canvas with `P` from `g.fit` or `g.graph`.
- Angles in the API are degrees. Directions are measured counterclockwise from +x. Hits report angles from the surface normal.
- Elements and sources are plain data. Rebuild the scene in `draw()` from `v` and `s` every frame; it costs well under a millisecond.
- Colors are palette names, except rays with a wavelength, which take their physical color.

## When to use what

| The figure shows | Use |
|---|---|
| Light bending at a surface, Snell's law | `Optics.slab` + `Optics.ray` + `g.rayAngles` |
| Total internal reflection, the critical angle | `Optics.semicircle` with the ray aimed at its center, `Optics.critical` |
| A prism splitting white light | `Optics.prism` + `Optics.ray(p, a, { wl: "white" })` + `Optics.screen`, `g.visibleSpectrum` |
| How a lens forms an image | `Optics.thinLens` + `Optics.fanTo` from the object point, `Optics.image`, `focal: true` |
| Spherical aberration, a real lens | `Optics.lens` + `Optics.focus` on the outgoing segments |
| Mirrors and their focal points | `Optics.mirror`, `Optics.curvedMirror` + `Optics.beam`, `arrows: true` |
| Rainbows | `Optics.drop` + a white ray, `filter` on `via`, `Optics.rainbow` |
| Fibers, light pipes, light guides | `Optics.body` from `Optics.segment` and `Optics.arc`, `Optics.fan`, `Optics.sensor` |
| The eye, accommodation, glasses | `Optics.eye` + `g.eye`, `Optics.eyeFocus`, `Optics.correction` |
| Where a bundle of rays meets, blur size | `Optics.focus`, `Optics.spot` |

## Elements

A scene is an array of elements and sources. Nested arrays, `null`, and `false` are skipped, so `[lens, v.glasses && glasses, src]` works. All elements take `name` (shows up on hits and sensor records, and a prose term with `data-part="<name>"` lights the element), `label` (drawn above it), `labelAt` (a world point for the label instead), and `hidden` (traced but not drawn).

| call | makes |
|---|---|
| `Optics.mirror(a, b, o)` | A flat mirror from a to b. The silvered face is on the left going from a to b (world y up); the hatched back absorbs. `flip` [false] swaps the face, `twoSided` [false], `reflectance` [1] (0.5 is a beam splitter, drawn dashed, the rest goes straight through). |
| `Optics.curvedMirror(vertex, R, o)` | A spherical mirror. `R > 0` is concave, `R < 0` convex; f = R/2. `facing` [180] is the direction the mirror faces, in degrees; `aperture` [0.9 \|R\|]. |
| `Optics.thinLens(c, f, o)` | An ideal lens: a ray crossing at height h leaves with its slope changed by −h/f. No aberration, no color, no reflection. `aperture` [0.8 \|f\|], `angle` [0] for the axis. |
| `Optics.lens(c, o)` | A real glass lens with two spherical faces. Either `f` (equal radii, solved from the thick-lens equation) or `R1`, `R2` (center of curvature to the right is positive, so biconvex is `R1 > 0 > R2`). `thickness` [just enough for a thin rim at the full aperture], `aperture` [\|f\|/2], `angle` [0], `n` ["bk7"]. |
| `Optics.slab(c, w, h, o)` | A rectangle of glass, turned by `angle` [0]. |
| `Optics.prism(c, size, o)` | An isosceles prism, apex up before `angle` [0] turns it; `apex` [60] degrees, `size` the length of the two equal sides. |
| `Optics.circle(c, r, o)`, `Optics.drop(c, r, o)` | A disc of glass; `drop` is one of water. |
| `Optics.semicircle(c, r, o)` | A half disc with its flat side through c; the curved side faces `angle` [0]. A ray aimed at c enters the curved side without bending. |
| `Optics.polygon(points, o)` | Any polygon, in either winding order. |
| `Optics.body(pieces, o)` | Any closed outline from `Optics.segment(a, b)` and `Optics.arc(c, r, from, to)` pieces (degrees, counterclockwise), listed end to end. |
| `Optics.wall(a, b, o)` | Absorbs, drawn hatched. |
| `Optics.screen(a, b, o)`, `Optics.sensor(a, b, o)` | Absorb and record where each ray lands in `T.sensors[name]`. A screen is drawn pale, a sensor in its `color` ["muted"], each with a dot where each ray landed. |

Glass bodies take `n` ["bk7"]: a number (no dispersion), a material name, or Cauchy coefficients `{ A, B, C }` with λ in µm. `tint` ["blue"] colors the fill, which gets deeper for higher indices. For a curved wall, screen, or sensor, pass a piece or a list of pieces instead of `a, b`: `Optics.sensor(Optics.arc([0, 0], 5, -60, 60), { name: "retina" })`.

A body inside another body (listed after it) sits in that medium, which is how the eye's lens sits in the eye's fluid. Bodies may touch (a cemented doublet) but must not partly overlap.

## Sources

| call | makes |
|---|---|
| `Optics.ray(p, dir, o)` | One ray from p. `dir` in degrees, or a direction `[dx, dy]` (use `[q[0] - p[0], q[1] - p[1]]` to aim at q). |
| `Optics.beam(p, dir, width, o)` | Parallel rays across `width`, centered on p. `n` [9]. |
| `Optics.fan(p, dir, spread, o)` | A point source: rays over `spread` degrees around `dir`, or all around for 360. `n` [9]. |
| `Optics.fanTo(p, a, b, o)` | Rays from p through `n` [9] evenly spaced points from a to b: a point source filling an aperture, the right source for an object in front of a lens. |

Every source takes `wl`: leave it out for one color traced at the index for 587.6 nm, give a wavelength in nm, a list of them, or `"white"` for seven lines from red (650) to violet (415). White light stays one ray until it meets a material whose index depends on wavelength, then splits. Also `I` [1] (intensity), `color` ["orange"] for rays without a wavelength, `name`, and `marker` (a dot at the source; on by default except for beams).

## Materials and color

| name | n at 587.6 nm | violet (410) to red (656) | Abbe number | critical angle into air |
|---|---|---|---|---|
| `"water"` | 1.333 | 1.342 to 1.331 | 57 | 48.6° |
| `"ice"` | 1.309 | 1.318 to 1.307 | 56 | 49.8° |
| `"acrylic"` | 1.492 | 1.505 to 1.489 | 57 | 42.1° |
| `"bk7"` (also `"crown"`, `"glass"`) | 1.517 | 1.530 to 1.514 | 64 | 41.2° |
| `"flint"` (F2) | 1.620 | 1.647 to 1.615 | 36 | 38.1° |
| `"denseFlint"` (SF11) | 1.785 | 1.834 to 1.776 | 26 | 34.1° |
| `"diamond"` | 2.417 | 2.458 to 2.410 | 55 | 24.4° |

Add your own with `Optics.materials.sapphire = { A: 1.7518, B: 0.00558 }` (n = 1.768, Abbe number 72): pick B = (n<sub>d</sub> − 1) / (1.910 × Abbe) and A = n<sub>d</sub> − 2.897 B.

| call | returns |
|---|---|
| `Optics.index(material, nm)` | The refractive index; `nm` defaults to 587.6. |
| `Optics.abbe(material)` | (n<sub>d</sub> − 1) / (n<sub>F</sub> − n<sub>C</sub>); lower means more color spread. |
| `Optics.WHITE`, `Optics.spectrum(n = 7, lo = 415, hi = 650)` | Wavelength lists, red first, for `wl`. |
| `Optics.wavelengthRGB(nm, { on })`, `Optics.wavelengthColor(nm, { on })` | `[r, g, b]` or `"rgb(...)"` from the CIE 1931 color matching functions. `on: "light"` darkens yellows and greens so a thin line reads on a light page. |
| `g.wavelengthColor(nm)` | The same, adjusted for the current theme. Use it to color a label or a curve like the ray it names. |

## Formulas

All angles in degrees.

| call | returns |
|---|---|
| `Optics.snell(n1, n2, i)` | The refraction angle, or `NaN` past the critical angle. |
| `Optics.critical(n1, n2 = 1)` | The critical angle for light going from n1 into n2 (`NaN` when n1 ≤ n2). |
| `Optics.brewster(n1, n2)` | The angle where p-polarized light doesn't reflect. |
| `Optics.fresnel(n1, n2, i)` | `{ R, T, Rs, Rp, tir, t }`: unpolarized reflectance and transmittance, both polarizations, and the refraction angle. |
| `Optics.image(f, d)` | `{ d, m }`: image distance from 1/f = 1/dₒ + 1/dᵢ (real images positive) and magnification −dᵢ/dₒ. Works for mirrors with f = R/2. |
| `Optics.lensmaker(n, R1, R2, d = 0)`, `Optics.thick(n, R1, R2, d)` | The focal length; `thick` also gives `bfd` and `ffd`, the back and front focal distances from the vertices. |
| `Optics.rainbow(n, k = 1)` | `{ i, r, deviation, angle }` for light reflected k times inside a drop: `angle` is the bow's radius around the antisolar point (42.1° and 50.9° for water). |

## Optics.trace(scene, o)

`g.optics` calls it for you. Call it yourself in `status()`, for a graph of many traced rays, or in tests.

| option | default | |
|---|---|---|
| `depth` | 24 | Interactions per ray path before it stops. |
| `minI` | 0.01 | Rays weaker than this are dropped. Raise it (0.03 to 0.05) to hide faint partial reflections. |
| `fresnel` | true | `false` keeps only the refracted ray at glass (total internal reflection still reflects), and it keeps its full intensity. |
| `n0` | 1 | The medium around everything: `"water"` for an underwater scene. |
| `far` | 20 × scene size | How far an escaping ray runs. |
| `maxSegments` | 6000 | A safety limit; `T.truncated` is true when it was hit. |

It returns `T = { segments, hits, sensors, energy, truncated, ms }`.

- **`T.segments`**: `{ a, b, I, wl, band, depth, via, src, ray, med, end }`. `wl` is the wavelength (or `null`), `band` the list of wavelengths of white light not yet split, `src` and `ray` say which source and which of its rays, `end` is what stopped it (`"body"`, `"mirror"`, `"lens"`, `"absorber"`, `"escape"`, `"depth"`).
- **`T.hits`**: one per interaction: `{ p, px, kind, el, name, normal, din, dout, dr, i, t, R, n1, n2, I, wl, band, depth, via, src, ray }`. `kind` is `"refract"`, `"tir"`, `"mirror"`, `"lens"`, `"absorb"`, or `"sensor"`. `normal` points back toward the side the ray came from. `i` and `t` are the angles of incidence and refraction (`t` is `null` for total internal reflection), `R` the share reflected, `dout` the main outgoing direction and `dr` the reflected one. `px` is the canvas position (set by `g.optics`).
- **`T.sensors[name]`**: `{ p, px, t, I, wl, band, dir, src, ray, via }` for every ray that landed, with `t` from 0 to 1 along the sensor.
- **`T.energy`**: `{ escaped, absorbed, lost }`, summing to the light that went in.

`via` spells each path: `T` transmitted through a glass surface, `R` reflected at one (partly or totally), `M` reflected by a mirror, `P` passed through a half-silvered mirror, `L` bent by a thin lens. A ray that entered a drop, reflected once inside, and left has `via === "TRT"`: that's the rainbow path. Filter on it: `T.segments.filter(s => s.via === "TT")` are the rays that came out of a lens; `T.hits.find(h => h.name === "prism" && h.depth === 0)` is the first hit on the prism.

| call | returns |
|---|---|
| `Optics.focus(lines)` | `{ p, rms, n }`: the point closest to all the lines in the least-squares sense, or `null` if they're parallel. Takes segments, hits, sensor records, or `{ p, d }`. |
| `Optics.spot(points)` | `{ center, rms, width, n }` of landing points (sensor records or `[x, y]`). |
| `Optics.distance(el, q)` | Distance from a world point to an element, for `drag.hit`. |
| `Optics.inside(body, x, y)` | Whether a point is inside a glass body. |

## g.optics(scene, o)

Traces and draws: glass as a tinted fill with an ink outline, mirrors with a hatched back, thin lenses as a slim biconvex or biconcave outline, walls hatched, screens pale, sensors in their color, then the rays with alpha by intensity and color by wavelength. Returns `T` with `px` on every hit and sensor record.

| option | default | |
|---|---|---|
| `P` | identity | World to canvas, from `g.fit` or `g.graph`. |
| `depth`, `minI`, `fresnel`, `n0`, `far`, `maxSegments` | | Passed to `Optics.trace`. |
| `width` | 1.75 | Ray width in px. |
| `alpha`, `minAlpha`, `gain` | 1, 0.12, 1 | Ray alpha is √(I × gain), at least `minAlpha`, times `alpha`. Raise `gain` to show weak paths such as the rainbow's. |
| `blend` | `"auto"` | `"auto"` adds colors together on dark pages (overlapping colors make white) and paints normally on light ones; `"add"`, `"normal"`. |
| `color` | `"orange"` | Rays without a wavelength (a source's own `color` wins). |
| `white` | `"ink"` | Unsplit white light: dark on light pages, white on dark ones. |
| `arrows` | false | `true` puts an arrowhead mid-way along every visible segment, `"first"` only on the rays leaving the sources. |
| `focal` | false | Marks F and F′ of lenses (thin and thick) and F and C of curved mirrors. |
| `axis` | false | A dashed line along each lens's and curved mirror's axis. |
| `labels`, `marks`, `sources` | true | Element labels, dots where rays land on sensors and screens, source dots. |
| `filter` | | `segment => boolean`: draw only some paths (tracing is unchanged). |
| `rays`, `elements` | true | `false` skips that layer. |

## g.rayAngles(hit, o)

Draws the dashed normal at a hit and the angles against it, with arcs and labels placed beside each ray, outside its wedge. For refraction it shows θ₁ and θ₂; for mirrors and total internal reflection, the angles in and out.

| option | default | |
|---|---|---|
| `P` | the last `g.optics` mapping | |
| `show` | `"auto"` | Or any of `"i"`, `"t"`, `"r"`: `"itr"` adds the partial reflection at a refraction. |
| `names` | `{ i: "θ₁", t: "θ₂", r: "θᵣ" }` | `θᵢ` for incidence at mirrors. |
| `colors` | `{ i: "blue", t: "purple", r: "green" }` | |
| `values`, `digits` | true, 1 | "θ₁ 40.0°"; `values: false` for the names alone, `labels: false` for none. |
| `r`, `length`, `normal` | 30, 52, true | Arc radius and normal length in px. |

Returns `{ i, t, r, at }`.

## The eye

`Optics.eye(o)` builds the Gullstrand-Emsley simplified schematic eye in millimeters, cornea vertex at `at`, light traveling toward +x: one corneal surface (radius 7.8 mm) into fluid of index 1.333, a lens of 1.416 behind the iris, and the retina 23.9 mm back. Relaxed, it has 60.5 D of power and focuses distant light on the retina. To accommodate, the lens moves forward and rounds up (front radius 10 to 5 mm, back −6 to −5 mm), adding up to 8.6 D, which puts the near point at 12 cm. The far and near points, the verdict, and the glasses are computed paraxially; the rays drawn are traced through the real surfaces.

| option | default | |
|---|---|---|
| `accommodation` | 0 | Extra power from the lens, in diopters, clamped to the amplitude. |
| `amplitude` | 8.6 | The most this eye can accommodate. Lower it for an older eye: 1 D at about 55. |
| `error` | 0 | Refractive error at the cornea in D: −3 is 3 D nearsighted, +2 is 2 D farsighted. It sets the eye's length (a −3 D eye is 1.1 mm longer). |
| `length` | 23.9 | The eye's length in mm, instead of `error`. |
| `pupil` | 3 | Pupil diameter in mm. |
| `glasses` | none | Spectacle power in D, or `{ power, vertex: 12 }`. Drawn as a real lens. |
| `at`, `labels` | `[0, 0]`, true | |

Its parts are named `"eye"` (the cornea and the fluid behind it), `"lens"`, `"iris"`, `"retina"`, and `"glasses"`, for `data-part` terms and for filtering hits. It returns plain data, `E = { items, retina, length, power, farPoint, nearPoint, accommodation, amplitude, error, glasses, pupil, surfaces, at, t }`. `farPoint` and `nearPoint` are in mm in front of the cornea, with glasses on: `Infinity` for a relaxed normal eye, and negative for a farsighted eye's far point, which lies behind it.

| call | returns |
|---|---|
| `g.eye(E, o)` | Traces light from an object `distance` mm away (`Infinity` by default) through the eye and draws it, with a ring where the image forms: green on the retina, red with "focus" when it misses. `n` [9] rays, `color`, `minI` [0.05], plus any `g.optics` option. Returns `{ trace, focus }`. |
| `Optics.eyeFocus(E, distance)` | `{ image, retina, defocus, diopters, sharp, where, focusDistance }`. `defocus` is mm from the retina to the image; `diopters > 0` means the focus falls behind the retina (the eye needs more power), `< 0` in front; `where` is `"on"`, `"front"`, or `"behind"`; `sharp` within 0.25 D. |
| `Optics.correction(E, vertex = 12)` | The spectacle power that moves the naked eye's far point to infinity: −3.11 D for a −3 D eye. |
| `Optics.eyeLight(E, distance, o)` | The source `g.eye` uses: a beam, or a fan from the object point that fills the pupil. |

`T.sensors.retina` holds where each ray landed; `Optics.spot(T.sensors.retina).width` is the blur in mm.

## Examples

### Bending at a surface

The reader drags the light around; the angles and the reflected share update as it moves.

```html
<p>Drag the <span class="c-orange" data-part="light">light</span>, or tilt it to <span class="scrub" data-key="angle"></span> from the normal. Compare <button class="set" data-set="mat=water">water</button> and <button class="set" data-set="mat=diamond">diamond</button>:</p>
<figure class="demo" id="bend" aria-label="A ray from the upper left meets a flat surface and bends toward the dashed normal below it; a faint part reflects. Arcs mark both angles."></figure>
<script>
{
  let P;
  const src = a => [-4 * Math.sin(a * Math.PI / 180), 4 * Math.cos(a * Math.PI / 180)];
  demo("bend", {
    aspect: 1.75,
    controls: [
      { key: "angle", label: "Angle of incidence", min: 0, max: 85, step: 0.5, value: 40, unit: "°", color: "orange" },
      { key: "mat", label: "Below", type: "choice", options: [{ value: "water", label: "Water" }, { value: "bk7", label: "Glass" }, { value: "diamond", label: "Diamond" }], value: "water" },
    ],
    status: (s, v) => `${(Optics.fresnel(1, Optics.index(v.mat), v.angle).R * 100).toFixed(1)}% reflected`,
    draw(g, s, v) {
      P = g.fit(-5, 5, -3.2, 3);
      const S = src(v.angle);
      const T = g.optics([
        Optics.slab([0, -4], 18, 8, { n: v.mat }),
        Optics.wall([-9, -7.9], [9, -7.9], { hidden: true }),   // stops light at the far bottom face
        Optics.ray(S, [-S[0], -S[1]], { name: "light" }),
      ], { P });
      g.rayAngles(T.hits.find(h => h.depth === 0));
      g.handle(P(S), { color: "orange" });
    },
    drag: {
      hit: (p, s, v) => { const q = P(src(v.angle)); return Math.hypot(p[0] - q[0], p[1] - q[1]) < 24; },
      move: (p, s, v, d, fig) => { const w = P.inv(p); fig.set("angle", clamp(Math.atan2(-w[0], w[1]) * 180 / Math.PI, 0, 85)); },
    },
  });
}
</script>
```

### White light through a prism

Each color is traced with its own index, so switching the glass shows the real spread. On dark pages the colors add back up to white where they overlap.

```html
<figure class="demo" id="prism" aria-label="White light through a slit into a glass prism fans out into colors that land in order on a screen. A spectrum strip runs along the bottom."></figure>
<script>
{
  demo("prism", {
    aspect: 1.6,
    controls: [
      { key: "aim", label: "Aim", min: 10, max: 40, step: 0.5, value: 24, unit: "°", color: "orange" },
      { key: "mat", label: "Prism", type: "choice", options: [{ value: "bk7", label: "Crown" }, { value: "flint", label: "Flint" }], value: "flint" },
    ],
    status: (s, v) => `n from ${Optics.index(v.mat, 650).toFixed(3)} (red) to ${Optics.index(v.mat, 415).toFixed(3)} (violet)`,
    draw(g, s, v) {
      const P = g.fit(-7.4, 7.4, -5.6, 3.3, { box: [0, 0, g.w, g.h - 40] });
      const t = Math.tan(v.aim * Math.PI / 180), M = [-0.85, 0.49];      // aim at the middle of the left face
      const T = g.optics([
        Optics.prism([0, 0], 3.4, { n: v.mat, label: "prism" }),
        Optics.wall([-5.8, M[1] - 4.95 * t + 0.14], [-5.8, 3.4]), Optics.wall([-5.8, M[1] - 4.95 * t - 0.14], [-5.8, -5.8]),
        Optics.screen([6.4, -5.7], [6.4, 3.2], { name: "screen" }),
        Optics.ray([-7.4, M[1] - 6.55 * t], v.aim, { wl: "white" }),
      ], { P, minI: 0.05 });
      const top = T.sensors.screen.reduce((a, r) => (r.wl && (!a || r.p[1] > a.p[1]) ? r : a), null);
      if (top) g.label("red", [top.px[0] - 10, top.px[1] - 4], { align: "right", color: g.wavelengthColor(top.wl) });
      g.visibleSpectrum([(g.w - 420) / 2, g.h - 34, 420, 10], { marks: [{ wl: 415 }, { wl: 650 }] });
    },
  });
}
</script>
```

### An eye that needs glasses

The verdict in the status line comes from `Optics.eyeFocus`; the picture comes from tracing the real surfaces.

```html
<p>Pick a <button class="set" data-set="eye=-3 glasses=false">nearsighted eye</button>, then give it <button class="set" data-set="eye=-3 glasses=true">glasses</button>. Bring the object in to <span class="scrub" data-key="near"></span> and add <span class="c-blue">accommodation</span> until it's sharp:</p>
<figure class="demo" id="eye" aria-label="A cross-section of an eye with rays from an object focusing through the cornea and lens; a ring marks where they meet, green on the retina, red when the focus misses."></figure>
<script>
{
  const build = v => Optics.eye({ error: v.eye, accommodation: v.acc, glasses: v.glasses ? Optics.correction(Optics.eye({ error: v.eye })) : null });
  const away = v => (v.near ? 1000 / v.near : Infinity);   // the slider is in diopters: 4 means 25 cm
  demo("eye", {
    aspect: 1.8,
    controls: [
      { key: "near", label: "Object", min: 0, max: 10, step: 0.25, value: 0, color: "orange", format: d => (d ? `${(100 / d).toFixed(0)} cm away` : "far away") },
      { key: "acc", label: "Accommodation", min: 0, max: 8.5, step: 0.1, value: 0, unit: "D", color: "blue" },
      { key: "eye", label: "Eye", type: "choice", options: [{ value: 0, label: "Normal" }, { value: -3, label: "Nearsighted" }, { value: 2, label: "Farsighted" }], value: 0 },
      { key: "glasses", label: "Glasses", type: "toggle", value: false, color: "purple" },
    ],
    status(s, v) {
      const F = Optics.eyeFocus(build(v), away(v));
      return F.where === "on" ? "sharp on the retina" : `focus ${Math.abs(F.defocus).toFixed(2)} mm ${F.where === "front" ? "in front of" : "behind"} the retina`;
    },
    draw(g, s, v) {
      const P = g.fit(-24, 27.5, -12.6, 12.6), E = build(v);
      const { trace } = g.eye(E, { P, distance: away(v), n: 11 });
      const blur = Optics.spot(trace.sensors.retina);
      if (blur) g.text(`blur ${(blur.width * 1000).toFixed(0)} µm`, P([E.retina[0] - 1, -10.6]), { size: 12, color: "muted", align: "right", halo: true });
    },
  });
}
</script>
```

## Pitfalls

- **Mirrors face left of a → b in world coordinates with y up.** Through `g.fit` that's the visual left. Without `P` (raw canvas pixels, y down) the face flips; use `flip: true` or swap the ends.
- **Partial reflections multiply.** Every glass surface sends back a few percent, and those rays reflect again. Busy scenes get cluttered: raise `minI` to 0.03 to 0.05, put a hidden wall where light should stop (the far bottom of a slab), or use `fresnel: false`, which still keeps total internal reflection.
- **White light only splits at dispersive materials.** A numeric `n` (`n: 1.5`) keeps it white; use a material name to see colors. Colors from one prism spread by a degree or two, so give them distance: put the screen well away, or use flint.
- **Don't let bodies partly overlap.** Nest one fully inside another, or keep them apart. A ray inside overlapping glass doesn't know which index it's in.
- **Fast glass lenses can't exist.** A BK7 lens with f near its aperture needs radii smaller than its half-height; `Optics.lens` trims the aperture to fit, and the result looks like a ball. Keep the aperture under about 1.3 f, or use `Optics.thinLens`.
- **The eye's verdict is paraxial; its rays are real.** With spherical surfaces and a 3 mm pupil the traced rays cross about 0.2 mm in front of the retina even when `eyeFocus` says sharp. Report `eyeFocus`, draw the rays.
- **Keep traces out of state.** Rebuild the scene and call `g.optics` in `draw()`. A trace is plain data but large; store only the numbers the reader controls.
- **Escaping rays run far past the canvas.** That's fine when the figure is one picture. In a split figure, wrap the optics in `g.clip(box, ...)` so rays stay in their panel.
- **Build arcs with `Optics.arc`.** It stores the end vectors the tracer uses.
- **Watch `T.truncated`.** Hundreds of rays bouncing many times inside glass can hit `maxSegments`; raise it only for tracing in `status()` or a precomputed graph, not for drawing.
