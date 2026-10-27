# Craft: what the reference articles do

This is a study of 14 long-form interactive articles on physics, machines, optics, astronomy, and geometry. Each was loaded in a headless browser; figures were screenshotted, their sliders dragged to several positions, and their 3D views turned. The numbers below come from that pass: 888 figures across the 14 articles, with 127 of them sampled in detail along with the sentence before and after each.

Use it to borrow techniques. Don't reuse their text, models, or designs.

## Measured patterns

- **Figure density.** One figure per about 130 words. Articles run from about 3,000 words with 28 figures (one on the tesseract) to 16,000 words with about 100 (one on the Moon); the one on bicycles has 118.
- **Lead-ins end with a colon.** 64% of the sentences right before a figure end with ":" and lead straight into it.
- **"Notice" comes after.** The word appears three times as often in the paragraph after a figure as in the one before: first the reader acts, then the text points at what happened.
- **Colors are named after the figure.** Color words ("the red arrow", "the dark pink trail") appear more often after a figure than before it.
- **No rhetorical questions around figures.** None of the 127 sampled lead-ins or follow-ups contains a question mark.
- **Short section names.** 8-16 sections per article, each a noun phrase: Power, Gears, Escapement, Balance.
- **First person for choices.** About one lead-in in six uses "I" for an author's decision ("I'll briefly hide the hour wheel").

## Visual language

- **Neutral context, colored subject.** Mechanisms are drawn in light gray with dark outlines; the parts the paragraph is about get saturated colors (an escape wheel in teal, a pallet fork in blue, jewels in pink). The same color names the part in the text and colors its slider.
- **Outlines everywhere.** Silhouettes, creases, and part boundaries all get a line, which keeps dense assemblies readable.
- **Hatched cuts.** A cut through an engine block shows diagonal hatching on the cut faces.
- **See-through parts.** Cylinders and housings go translucent so the moving parts inside stay visible.
- **Arrows for forces and motion.** Thick 3D arrows for forces and velocities; curved arrows for rotation, usually red.
- **Grounds that orient.** A checkerboard floor that fades out (bicycles), a grid plane (orbits), sky and sea (ships), dark backgrounds for space and light.
- **Context icons.** A tiny airplane in the corner shows which part of the plane the big figure is about.
- **Paired views.** The world next to what a camera sees; a scene next to an instrument timing it; a mechanism next to a plot of its output.
- **Magnifiers.** A circular inset connected to its source by two lines, showing gear teeth meshing.
- **Instruments.** Dial gauges, a wristwatch, torque bars, distance bars under spinning gears, particle counters.
- **Labels.** Small sans-serif text; short values in tinted pills ("angle of attack = 0.00°"); axis names in colored chips; visual equations where the variables are the colored segments of the drawing (e = c / a).
- **Readouts.** Dates and times in a corner, counters ("1188 particles", "0 subdivisions").
- **Controls.** Sliders under the figure, colored like the quantity they change, usually without labels because the text says what each does. Pause button at the bottom left of animated figures, a reset button for simulations, a small badge marking figures you can drag. Turning a 3D view keeps a little momentum after release.
- **Legends that teach in order.** In a list of named circles, the one being discussed is dark and the rest are faint.
- **Scale bars** and real-size references (a credit-card outline at true size).

## Narrative moves

- **Hero first.** Show the finished object, then invite: drag to turn it, use the slider to peek inside (an exploded view).
- **Build it up.** "The first two components we will mount..." Each figure adds one part.
- **Revisit with one change.** "Let me bring up the relaxed spring one more time."
- **Remove clutter on purpose.** "I'll briefly hide the hour wheel", "I cut a hole in the barrel so you can see the spring inside."
- **Experiments in the lead-in.** "If we now pull the crown in and out we can see that..."
- **Name things after they're seen.** "When the click snaps back and hits the crown wheel, it makes a clicking sound, which explains its name."
- **End with scale.** Show how big the real thing is.
- **Close with sources and a short goodbye.** "Further Watching and Reading", then a few sentences of final words.

## How this skill maps them

| Technique | Tool |
|---|---|
| Neutral context, colored subject | `porcelain` and natural materials for context; `red`/`orange`/`green`/`blue`/`purple` materials and `c-*` text classes for the subject; slider `color` |
| Outlines | E3 draws them automatically, tinted per part |
| Hatched cuts | `scene.cutPlane` in 3D; `hatch` on shapes in 2D cross-sections |
| See-through parts | node `opacity`, or `glass` |
| Force and rotation arrows | `E3.mesh.arrow`, `E3.mesh.arcArrow`; `g.arrow`, `g.arcArrow` |
| Grounds | `E3.mesh.plane` plus a grid drawn through `view.project`; the automatic soft shadow |
| Context icon | A small second drawing in a corner box (`g.fit` with `box`) with a frame around the zoomed region |
| Paired views | Two boxes in one canvas: `g.fit(..., { box })` and `g.render3d(scene, cam, { box })` |
| Magnifiers | `g.inset` |
| Instruments | `g.dial`, `g.meter`, readouts with `g.text`, `status` in the margin |
| Labels, chips, visual equations | `g.callouts`, `g.label`, `g.chip`; `<span class="chip green">` in prose |
| Readouts | `status(s, v)` |
| Pause, reset, drag badge, momentum | Automatic from `step`, `reset: true`, `drag`/`orbit` |
| Hero, build-up, hide parts | One scene reused across figures; `visible`, positions driven by a slider |
| Scale | `g.dimension`, a real-size reference object |

Where this skill deliberately differs: the Porcelain theme (a monochrome page, serif text, numbered sections, figures on the page with controls beneath, color only for the subjects) is its own look, and controls carry small labels and keyboard support, because not every reader can drag.
