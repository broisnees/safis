# Fixing what's wrong

The loop is in SKILL.md: reproduce, find the cause and its layer, fix the cause, re-run `verify.mjs` and `explore.mjs`, re-read the text. This file is the lookup table for step 2: what a symptom usually means and where the fix belongs.

## Check errors and warnings

| Symptom | Usual cause | Fix |
|---|---|---|
| `draw() threw: X is not defined` | A shared model or helper is defined in a later script, or inside another figure's `{ }` block | Define shared code once, in its own script, before the first figure that uses it (`window.MODEL = (() => { ... })()`) |
| `canvas is blank after draw()` | Drawing in world units without `g.fit`, everything off-canvas, or everything in the background color | Map coordinates with `g.fit` or `g.view3d` / `g.render3d`; check the first point lands inside `g.w x g.h` |
| `moving "X" across its range doesn't change the figure` | `draw()` doesn't use `v.X`; or X only matters over time and the figure has no `step()`; or the change is too small to see | Use the value; or make the change visible (bigger range, a readout, a trace) |
| `the animation runs but nothing moves` | The default state is at rest, or `step()` updates state `draw()` doesn't read | Start in motion; if motion only starts on a button, set `autoplay: false` and `playButton: false` |
| `turning the view doesn't change the figure` | `draw()` ignores `s.view` | Pass `{ ...s.view }` to `g.render3d` or `g.view3d` |
| `page scrolls sideways at 390px` | A fixed-width element, an unbroken long string, or a table wider than the screen | Size from the container; let text wrap; put wide content in a figure |
| `loads https://...` | A CDN script, web font, or remote image | Inline it or drop it; pages must work offline |
| `template placeholders are still on the page` | A `{{...}}` left from the template | Replace it, or delete the element |
| `the <figure> has no aria-label` | Missing description | Add `aria-label` saying what the figure shows |
| `<span class="scrub" ...> isn't tied to any figure` | No figure after it on the page, or a `data-figure` id that doesn't exist | Put the lead-in before its figure, or set `data-figure` to the right id |
| `a .scrub names control "x", which isn't a number control` | The key is a toggle or a choice, or misspelled | Scrubs drive sliders, steppers, and knobs; use a `.set` link for toggles and choices |
| `citation #ref-x has no matching .references item` | A cite whose reference was renamed or never written | Add the reference to the `.references` list with that id, or remove the cite |
| `figure reference #x names no figure` | A `.figref` to a renamed figure | Point it at the figure's current id |
| `[tex] ...` in the console, red source in the text | Unsupported command or unbalanced braces | Check [math.md](math.md) for the supported commands; put spaces around `&` in environments |
| `preset "X": figure has no control "k"` | A preset sets a key that doesn't exist | Fix the key, or add the control (it can be `hidden: true`) |

## Pictures that look wrong

| Symptom in a sheet | Usual cause | Fix |
|---|---|---|
| One part of a split figure draws over another (a cross-section spilling into its plot) | Shapes extend past their region | Draw each region inside `g.clip(box, () => ...)` |
| Labels collide with each other or cover the subject | Too many labels on one side, or anchors bunched together | Label fewer things; use `callouts` with `split` to send labels left and right; move anchors to distinct spots; put names in the prose instead |
| 3D object small in the frame, or a band of empty space | Camera fitted to something large but unimportant (a ghost shell, a ground plane) | Set `target` to the subject's center and `distance` or `zoom`; leave context out of the fit |
| 3D object jumps in size while turning | Camera refits every frame (`fit: "always"`) | Use the default one-time fit, or a fixed `distance` |
| 3D model cut off at the top or bottom of the canvas at some views or toggles | A fixed `distance` chosen for one state (small atoms, one layer) and kept when the model grows | Compute `distance` from the bounding radius of what's visible now, or fit once from the largest state with `fitFrom`; check the sheet at every toggle |
| A label jumps between the left and right margins while the view turns | Its anchor crosses the middle of the canvas | The runtime keeps a label's side until its anchor is well past the middle; if it still flips, give the item a fixed `side` |
| Packed spheres look like flat discs | No depth cue between touching parts | Ambient occlusion is on by default (`scene.ao`); raise it for crowded scenes, or ghost the context |
| A cut-open 3D part shows hatching across faces that aren't cut | An interpenetrating mesh: two closed meshes overlap, so the inside of one shows through the other | Model parts that touch as separate, non-overlapping solids, or merge them into one mesh |
| Hard-to-read 3D shape (a "brick", a "balloon") | Primitive used as-is | Shape it: bevels, sweeps along curves, lathe profiles, extruded real outlines; or ghost it (`opacity`) so it reads as context |
| Thin outlines vanish or flicker | Canvas resized or scaled by hand | Always draw 3D through `g.render3d`, which supersamples and copies 1:1 |
| Old frames stay visible behind new ones | Page built from an older runtime | Run `scripts/upgrade.mjs <page>` |
| Colors wrong or unreadable in dark mode | Hex colors in figure code | Palette names and materials only |
| Text cut off at the canvas edge | Labels placed near the edge, or long label text | Use `callouts` (they stay inside), shorten the text, or anchor further in |
| A figure says nothing at its default values | Default chosen at zero or at rest | Pick defaults mid-range, where the effect already shows |

## Figures that don't teach what the text says

| Symptom | Usual cause | Fix |
|---|---|---|
| The effect the paragraph describes is barely visible | Model parameters too timid, or a numerical error | Check the numbers against real values; if the real effect is small, show it with a readout, a trace, or an honest exaggeration that the text mentions |
| A number in the text doesn't match the figure's readout | Model changed after the text was written | Re-read the sheet at the stated values and update the text |
| A two-state behavior (clicks, locks) only appears when moving slowly | State machine fed by slider events that jump | Base the state on thresholds of the current value, so a jump across a threshold still triggers it |
| A button does nothing in the exploration | It only acts in a state the default doesn't reach | That can be right (a reset only works when stuck); check the sheet row with the slider at max |
| The prose claims a fact you can't source | Over-reach | Cut it, soften it to what's established, or name the source |

## Runtime and engine problems

These would affect every page. If one shows up, fix it in the page only as a last resort and mention it in the report, so it can be fixed in the template.

- Canvas content that won't clear, or ghost images: an old runtime; upgrade the page.
- WebGL errors in the console (`shader:`, `program:`): the engine failed to compile on that browser; the figure shows an error message instead.
- Picking hits the wrong part: a part with `pickable: true` is in front (a ghost shell); pass `{ ghosts: false }` to `view.pick` or set `pickable: false` on context parts.
