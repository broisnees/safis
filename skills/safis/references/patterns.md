# Patterns: figures and sections that make a page memorable

A catalog of moves that work in long-form interactive articles, each with what builds it here. Pick the few that fit the topic; one per section is plenty. Borrow the move, never the content or look of a page you studied.

## Paired and nested views

| pattern | when | build |
|---|---|---|
| **Scene and what an instrument sees** | cameras, eyes, telescopes, sensors: the 3D world on the left, the picture it makes on the right, both driven by one slider | two `g.render3d` calls with `box`; the right one with the instrument's camera (`focal`, `fNumber`, `focus` for real depth of field) |
| **Magnifier** | a tiny region decides the story (gear teeth, a patch hit by photons, a pixel) | `g.inset([x, y, r], [fx, fy, fr], box => ...)`, drawing a closer `g.render3d` inside |
| **Context globe or icon** | the main figure is local (the sky over a town, a part of a plane) | a small second render in a corner: `E3.earth()` with the observer marked, or a tiny whole-object drawing |
| **Not realistic / realistic** | a common wrong picture versus the right one | one slider driving two halves of one canvas, each labeled under it |
| **Before and after on one control** | linear vs sRGB gray steps, aliasing vs filtered | the same data drawn twice, stacked, with the control under both |

## Things accumulating

| pattern | build |
|---|---|
| **Photons into pixels**: particles fall on a sensor grid, each cell counts its hits and the picture builds up; a stopwatch shows exposure time | `E3.particles` or a CPU list, a cell grid as `E3.mesh.box` tiles or 2D rects, the counts as a grayscale image beside it (`g.field` or `Img`) |
| **Filters sorting particles**: colored photons pass the matching filter (a Bayer mosaic) and stop at the others | colored dots, filter planes as tinted `E3.mesh.plane`s, survivors by wavelength |
| **Rays and where they land** | `E3.photons(scene, light)` drawn as lines, hits as dots |
| **A trail fading behind each tracer** | particles in a flow with `style: "streak"` (3D) or `Fx.particles` (2D), dots at the heads |

## Fields and flows

| pattern | build |
|---|---|
| **A field as color with a diverging bar** (pressure, charge, temperature): blue below, red above, white at zero, contour lines, a marker on the bar for the value under the pointer | `g.field` + a colorbar (2D); `Fx.fluid` `show: "pressure"`; in 3D a `E3.mesh.surfaceBands` height field |
| **Sources and sinks the reader drags** (+/− circles with dashed outlines) shaping the flow | ideal-flow superposition in `Sim` or `E3.flow`, tracer streaks through it |
| **Arrows normal to a surface for pressure** | `g.arrow` along the outline, length by the local value |
| **A height field with pathlines riding it** | `E3.mesh.surface` + `E3.mesh.polyline` trails, colored by sign |

## Waves

| pattern | build |
|---|---|
| **E and B as 3D ribbons** along an axis, fading at the ends | `E3.mesh.tube` on a sine path, or 2D lines through `view.project` with alpha by distance |
| **A wave crossing a glass block** drawn as a sheet of many thin lines inside a wire box | many `g.line`s through `view.project`, the box's 12 edges as thin lines; wavelength shortens by n inside |
| **Side view on demand** | a "from the side" link in the prose that sets the orbit (`data-set="yaw=1.57"`) |

## Sections and rhythm

- **Hero first**: the finished thing, alive, before any explanation.
- **A dark band** (`<section class="band dark">`) for the stretch about light, night, screens, or glow: the page goes dark edge to edge and the figures with it.
- **Segmented choices for real settings** (f/1.4 ... f/8, gear 1 ... 6) rather than a slider when the real thing has steps.
- **Predict, then show** (a quiz before the surprising figure), **name it after it's seen**, and **revisit with one change**.
- **Trees and timelines** for history, evolution, languages, arguments: `g.tree`, `g.timeline` (plots.md).
- **End with scale and sources**: how big, how fast, how sure, and where the numbers came from.
