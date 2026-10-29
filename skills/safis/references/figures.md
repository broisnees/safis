# Designing the figures

Contents: [principles](#principles), [2D or 3D](#2d-or-3d), [the Porcelain look](#the-porcelain-look), [patterns](#patterns), [shared models](#shared-models), [simulations](#simulations), [phones and accessibility](#phones-and-accessibility), [common mistakes](#common-mistakes). [craft.md](craft.md) has the study these principles come from.

## Principles

**The manipulation is the explanation.** Choose the control so that moving it *is* the experiment. To show why a jaw locks, let the reader try to open it and feel it stop; a figure that only shows a locked jaw doesn't teach that.

**One new thing per figure.** If a figure needs a paragraph of instructions, it's two figures. Show the same scene several times in a row with one more element each time.

**Direct manipulation beats sliders** when the thing has a position: drag the planet, the control point, the lens, and draw it with `g.handle` so it's obviously grabbable. Then pick the control that matches the quantity: a slider for an amount (mass, time of day, how far the mouth is open), a segmented choice for a few named cases (Earth, Moon, Jupiter), a stepper for a count, a knob for an angle that wraps, a pad for two coupled numbers, a switch for a view option. Use a scrubber slider when the reader should study a process frame by frame, and the transport (play, step, speed) when the motion itself is the point.

**Let the prose drive it too.** The number a paragraph is about can be a scrub in the sentence, and the comparison it makes can be a "try" link; presets under the figure jump to the cases worth seeing. See [runtime.md](runtime.md#prose-that-drives-figures).

**Few controls.** Zero to two is typical, three is the limit; presets and prose links don't count against it, and are often better than a third control.

**Start interesting.** Defaults mid-range, where the effect already shows. A figure that starts at rest teaches nothing until the reader acts.

**One visual vocabulary.** The same thing has the same color and shape in every figure. Fix the color map in the plan (disc = blue, muscle = red, rotation = orange, slide = green) and keep each color for one meaning.

**Label sparingly.** Name things in the prose with colored words. On the canvas label only what the reader must read there, with `g.callouts` so labels stay out of the way.

**Show a number when the reader has to compare.** A readout in `status` turns an impression into a measurement.

**Be honest about scale.** If sizes, distances, or speeds are exaggerated, the text says so near the figure.

## 2D or 3D

Use **3D** when depth, arrangement, or turning the object teaches something: how parts fit together, which way something faces, what's hidden behind what, how a mechanism moves in space. Let the reader turn it.

Use **2D** when a flat view is clearer: cross-sections (anatomy is taught in sections), plots, ray diagrams, circuits, algorithms, anything where the third dimension adds nothing but clutter.

The strongest pages mix them: a 3D hero to show the whole thing, 2D sections to show the mechanism, back to 3D when something depends on both sides at once. Build both from one shared model so they agree.

## The Porcelain look

- **Context is porcelain, subjects are colored.** Most of the object is `porcelain`, `bone`, or another natural material; only the parts the current paragraph talks about get a subject color.
- **Outlines do the work.** E3 outlines every silhouette and part boundary in a darker shade of the part's own color. In 2D, outline shapes with 1.5 px `ink`; guides and leader lines 1 px `muted`.
- **Cut material is hatched.** In 3D, `scene.cutPlane` hatches cut faces automatically. In 2D sections, fill cut solids with a pale tint plus `hatch`.
- **See-through for context.** Housings, skin, and sockets that would hide the subject go to `opacity` 0.3-0.5.
- **Labels are quiet.** `g.callouts` and `g.label` draw small sentence-case sans with a halo; name things in lowercase ("key pin", "shear line"). Variables and formulas on the canvas go through `g.tex` in the serif italic. Never uppercase tracked labels.
- **Figures sit on the page.** No card, border, or background of their own: the canvas is the page color, the controls sit under the drawing, and a numbered caption follows. Don't paint frames or panels inside the canvas either; group with space. A scene that needs a dark backdrop (fire, smoke, a night sky, dust in a beam) paints it only on a light page, `if (!g.dark) g.rect(0, 0, g.w, g.h, { fill: "#141312" })`: on a dark page the page's black is the sky, and a box of near-black shows as a gray frame. The self-check warns when a figure's four corners are one dim color that isn't the page's.
- **Dark scenes when the subject is light or space.** Paint the canvas dark yourself and draw light on it. Light should look like light: rays that glow and add up where they cross, photons that travel, a focus that burns white. `g.optics` does all of that for anything traced; don't stand in for light with flat orange lines.
- **Draw the phenomenon, not an interface.** A figure is a model, a measurement, or a picture of the real thing, never a mock-up of an app: no phone frames, skeleton cards with gray placeholder lines, buttons drawn inside the canvas, chat bubbles, or browser windows. To show a feed, plot the session (each post a mark on a time line, its value as height, the reward signal under it); to show text, set it as type and color the spans that matter; to show a model's choices, show the numbers. Real controls go under the figure.
- **No grids of outlined boxes.** Tokens, cells, and items are soft tinted chips or tinted cells with no outlines (`g.tokens`, `g.matrix`, motion.md); outline only the one being pointed at. A screen full of bordered rectangles reads as a form, not a figure.

## Patterns

- **Hero.** The whole object in 3D at the top, turnable, with one slider that does something striking (opens, explodes, cuts).
- **Parameter sweep.** One slider, one picture that changes. Most figures are this.
- **Drag the object.** `drag.hit` finds a handle (hit radius about 24 px), `drag.move` moves it, the rest follows.
- **Scene plus plot.** A scene and a graph of one quantity in two `box`es of one canvas, with a marker at the current value. Stack them on phones with an `aspect` function.
- **Section through motion.** A 2D cross-section driven through a range of motion, with a dashed ghost of the starting position and the moving surfaces highlighted.
- **Context drawing.** A small drawing of the whole thing in a corner with a frame around the part the big figure shows.
- **Healthy versus failing.** The same figure behind a toggle, or two figures in a row: normal first, then what goes wrong.
- **State that remembers.** Some behaviors depend on history (a disc that clicks back into place on opening and slips out late on closing). Keep the state in `s` and switch it in `change()` at thresholds of the current value.
- **Explode and assemble.** Parts offset along directions times a slider; or one more part visible per figure.
- **Cutaway.** A slider moves the cut plane from outside to the middle.
- **Hover to name.** `view.pick` in `hover`, highlight the part, explain it in `status`.
- **Front and side.** Two views of one model, or a 3D view next to a 2D section.
- **Magnifier.** `g.inset` to show a small region enlarged.
- **Instruments.** A dial, meter, or readout that measures what the figure is doing.
- **Predict, then reveal.** The lead-in asks for a guess; the figure starts hiding the answer (a switch "Show the answer", or a button that runs the experiment), and the follow-up confirms it.
- **Linked parts.** Colored terms in the prose with `data-part`; `draw` emphasizes `g.lit("part")`. Good for anatomy and machines with many named parts.
- **Graph of the model.** A function plot next to the scene, with the current value marked, built with `g.graph` ([plots.md](plots.md)).
- **Visual equation.** A formula in the prose whose variables are `chip`s colored like the segments in the figure.
- **Step-through.** An integer slider over the stages of a process, with `status` naming the stage.
- **One-shot action.** A button that runs a short animation (`autoplay: false`, `playButton: false`, `fig.play()` in the action), like pushing a dislocated jaw back.

## Shared models

When three figures show the same joint, engine, or orbit, write the model once:

```html
<script>
window.JOINT = (() => {
  const boneY = x => ...;            // geometry
  function pose(opening) { ... }     // kinematics: from one control value to positions and angles
  function drawSection(g, P, pose, o) { ... }  // a drawing several figures share
  function meshes() { ... }          // the same geometry, extruded for 3D
  return { boneY, pose, drawSection, meshes };
})();
</script>
```

Every figure then reads from it. A wrong number gets fixed once, and the side view always agrees with the 3D view.

## Simulations

```js
step(dt, s, v) {
  const n = 8, h = dt / n;            // substeps keep stiff or fast systems stable
  for (let i = 0; i < n; i++) {
    const a = acceleration(s, v);
    s.vel += a * h;                   // semi-implicit Euler: velocity first,
    s.pos += s.vel * h;               // then position with the new velocity
  }
}
```

- Semi-implicit Euler for oscillators and orbits (energy stays bounded); RK4 when comparing against an exact formula.
- `dt` is real seconds, clamped to 1/30. Say so in the text when time is scaled.
- Cap trails and histories; seed randomness once into state.
- When a kinematic quantity has to hit a target (an opening of exactly 30 mm), solve for the angle numerically (bisection) instead of guessing a formula.

## Phones and accessibility

- The canvas is about 358 px wide on a phone. Size from `g.w`/`g.h` or `g.fit`; keep text at 11 px or larger; give split layouts an `aspect` function and stack them below about 560 px.
- Every `<figure>` gets an `aria-label` saying what it shows.
- Keyboards can't drag; arrow keys move the first two sliders and turn 3D views. Anything only reachable by dragging should be a bonus, not the point.
- Animated figures get a pause button and start paused for reduced-motion readers. Put all motion in `step()`.

## Common mistakes

- Hex colors instead of palette names: the figure stops matching the prose and breaks in dark mode.
- One region of a split figure drawing over another: clip each region with `g.clip`.
- A context part (ghost shell, housing) dominating the 3D frame: set `target` and `distance` on the subject.
- Two figure scripts declaring the same top-level `const`: wrap each script in `{ }`.
- A shared model defined after the first figure that uses it.
- A default state where nothing is happening.
- An effect the text describes that's too small to see at the figure's scale.
