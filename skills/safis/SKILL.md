---
name: safis
description: Safis builds interactive explainer web pages, and small sites that collect them. Long-form prose builds intuition step by step, interleaved with live 2D and 3D figures the reader drags, turns, cuts open, scrubs, and animates. Works for any subject, including anatomy and the body, biology, chemistry, physics, machines, earth and space, computing, AI, and math. Use when someone asks for an interactive explainer, explorable explanation, visual essay, interactive article, or a page or blog that teaches how something works with live diagrams, 3D models, simulations, or sliders, for example "explain how the jaw joint works and what happens when it locks" or "an interactive page on gears". Use it even when the request doesn't say "explainer" but clearly wants a page that teaches through interactive figures.
license: MIT
compatibility: Produces self-contained HTML files with no dependencies that open from disk; 3D figures need WebGL 2. The check and exploration scripts need Node 22+ and Chrome, Chromium, or Edge.
metadata:
  author: broisnees
  repository: https://github.com/broisnees/safis
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)
---

# Safis

Safis builds pages that teach one topic through prose and live figures. What makes the best interactive articles work:

- **One idea per figure, discovered by moving something.** About one figure per 130 words of text.
- **Prose and figures take turns.** A sentence says what to try and ends with a colon, the figure lets the reader try it, the next paragraph names what they saw.
- **Neutral objects, colored subjects.** Everything is drawn in a calm neutral with clean outlines; only the parts under discussion get color, and the same color names them in the text.
- **Real models.** Mechanisms are modeled in 3D and actually move, cut open, explode, and turn, with the physics or geometry computed, not faked.

Borrow the approach, not the identity: never copy another author's text, models, site design, name, or branding, and don't present a page as theirs. [references/craft.md](references/craft.md) has the full study of the reference articles and how each technique maps to this skill's tools.

## What to produce

One self-contained HTML page per topic. Inline CSS and JS, no network requests, opens straight from disk. Pages are built from `assets/template.html`, which contains:

- the **Porcelain** theme, monochrome edition: serif text (Source Serif 4, with Source Sans 3 for labels, both embedded) on a neutral near-white or near-black page, numbered sections, figures drawn straight onto the page with their controls beneath and a numbered caption, color kept for the subjects of the figures, objects drawn like glazed porcelain with graphite outlines, light and dark modes with a switch;
- a **2D runtime**: `demo(id, spec)` turns each `<figure class="demo">` into a live canvas with controls beneath it: sliders with marks, segmented choices, steppers, knobs, XY pads, switches, buttons, presets, play/step/speed transport, dragging with grab handles, hover, keyboard control, and drawing helpers (callouts, labels that keep clear of each other, named beads, chips, measurement lines, hatching, color fields, dials, magnifier insets);
- **prose that drives figures**: numbers in a sentence the reader drags, "try this" links that set a figure, and colored terms that light their part;
- **article furniture**: abstract, automatic contents and reading progress, sidenotes, numbered citations with previews, defined terms, callouts, collapsible deep dives, predictions, numbered tables, highlighted code, figure references, a light/dark/system switch;
- **simulations**: `Sim` for particle and rigid-body physics, waves and diffusion on grids, N-body gravity, random processes, classic ODE systems, and small neural networks trained live in the page; 3D surfaces, parametric meshes, and 3D plot axes in E3;
- a **plotting and science kit**: `g.graph` for function plots, areas, tangents, vector fields, contours, and measured data with bands, error bars, histograms, and hover readouts; `Num` numerics (ODE integration, root finding, statistics, small linear algebra, softmax); helpers for springs, charges, atoms and bonds, bar charts, heatmaps, neural networks, and tokens;
- **math typesetting**: TeX in the prose rendered as MathML, with symbols colored to match the figures, and `g.tex` for formulas on the canvas;
- **E3**, a small WebGL 2 engine for 3D figures: procedural meshes (boxes, lathes, extrusions with holes, sweeps, tubes, gears, springs, arrows, molecules), a scene graph, ink outlines, section cuts with hatched faces, see-through parts, soft ground shadows, orbit with momentum, and picking;
- **isometric illustration** (`Iso`): machines and devices drawn from many small solid parts with four-tone shading and ink outlines, crisp at any zoom, turnable, cut away, see-through, and exportable as a standalone SVG;
- **effects** (`Fx`): fire and exhaust, smoke and steam, airflow streaks, water ripples and caustics, glow, sparks, and electric arcs, drawn with WebGL inside a figure;
- **maps** (`Geo`): world maps and globes in several projections, countries, cities, great-circle routes, and distances;
- **optics** (`Optics`): rays through mirrors, lenses, prisms, raindrops, and the eye, with reflection, refraction, total internal reflection, and dispersion;
- **sound** (`Sound`) and **images** (`Img`): tones, harmonics, and plucked strings the reader hears, with spectra; pixels, filters, sampling and aliasing, dithering, and the DCT;
- **diagrams and code**: Mermaid diagrams (sequence, flow, state, class, ER, charts), Shiki-highlighted code, and diffs, pre-rendered by `scripts/render.mjs` so the page still makes no requests;
- a **self-check** the scripts drive.

Several pages can form a site: put each at `<root>/<slug>/index.html` and run `scripts/site.mjs`, which writes a home page grouped by category and puts the index in every page's sidebar.

Defaults, unless the request says otherwise:

- **Size:** in depth. A full explainer has about 25 figures in 7-12 sections, more when the topic needs them, the way the best long-form interactive articles are: every idea gets its own figure, and the page goes from the everyday phenomenon all the way to how it really works, including the complications. Main text (paragraphs and lists, not captions, sidenotes, deep dives, or references) runs 130-180 words per figure, so about 3,300-4,500 words at 25 figures. When the text runs longer, the fix is a figure for the paragraph that describes something the reader can't see, not more words. Write a short piece (8-12 figures, 1,000-2,000 words) only when the request asks for one.
- **Furniture:** an "In brief" abstract, sidenotes for asides, predictions before the surprising figures, callouts for the key idea and the common mistake, collapsed "going deeper" sections for derivations and history, numbered citations to real sources, and a references list. See [references/article.md](references/article.md).
- **Reader:** a curious adult with high-school math. Define every term, ideally while it's visible in a figure.
- **Category:** one of Body, Biology, Chemistry, Physics, Machines, Engineering, Earth & Space, Computing, AI, Math.
- **Research pages:** when the subject is a paper, a study, or an open question, follow the research arc in [references/writing.md](references/writing.md): the question, what was known, the method as figures the reader runs, the results reproduced live, the limits, and references with DOIs.
- **Location:** the path the request names; inside an existing site folder, `<root>/<slug>/index.html`; otherwise `./<slug>/index.html`.

The pages are local files. Don't publish, upload, or deploy them unless asked to.

## Workflow

Paths in this file are relative to the skill's own folder, the one that holds this SKILL.md. Run the scripts with that folder's full path, for example `node /path/to/safis/scripts/verify.mjs page.html`.

### 1. Frame the topic

Pin down the question the page answers ("What happens in the jaw joint when it locks?", not "The TMJ"). Pick the category. If the topic is huge, narrow it and note what was left out. Ask only if there's no topic at all; otherwise make reasonable choices and state them in the report.

### 2. Study the subject, then plan

Read [references/craft.md](references/craft.md), [references/figures.md](references/figures.md), [references/writing.md](references/writing.md), and the section of [references/categories.md](references/categories.md) for the category. Get the facts right before drawing anything: dimensions, ranges, mechanisms, names. Leave out anything you can't stand behind.

Write a short plan in the conversation:

```
Question: ...
Shared model: what geometry, physics, or data every figure draws from
1. <section>: the idea it teaches
   Figure (2D or 3D, and why): what is on screen / what the reader moves / what they should notice
...
Colors: <thing> = <palette color>, ...
```

Pick how each figure draws by what it has to show:

| The figure shows | Draw it with | Reference |
|---|---|---|
| A mechanism in cross-section, a graph, a process that moves | the 2D canvas and plot kit | runtime.md, plots.md |
| A machine or device made of many parts, a cutaway, an exploded view | E3 with `E3.parts` (real materials, turns freely), or `Iso` for a flat technical illustration | parts3d.md, engine3d.md, iso.md |
| A shape that must turn freely in 3D, a surface, a molecule | E3 | engine3d.md |
| Anything located on Earth | `Geo` | maps.md |
| Light: rays, lenses, mirrors, the eye | `Optics` | optics.md |
| Fire, flow, water, glow (only where it shows something physical) | `Fx`, layered on one of the above | effects.md |
| Sound the reader should hear, pixels and filters | `Sound`, `Img` | sound.md, images.md |
| Fixed structure: message sequences, states, code, a diff | Mermaid, Shiki | diagrams.md |

For a machine, list its named parts (40 or more for a whole machine) before writing any geometry. Most of a technical figure's quality comes from that list.

Every 3D figure follows "Making 3D that looks real" in [references/engine3d.md](references/engine3d.md): real dimensions first, then the named parts list, then [`E3.parts`](references/parts3d.md) builders and assemblies, materials by what each real part is made of, a `scene.look` preset, and turntable checks at 2x. A 3D figure that looks like a toy (wrong proportions, flat metal, floating parts, one material everywhere) is a fault like any other: fix it before calling the page done.

When several figures show the same object, build one **shared model** first (geometry, kinematics, simulation) in a single script and have every figure draw from it. Side views and 3D views then always agree, and a fix in one place fixes every figure.

For an in-depth page, plan the arc first: the everyday phenomenon, the simplest model that explains part of it, each complication in turn (each with its own figures), the full mechanism, and the payoff back at the opening. Most sections have two to four figures that build on each other, often the same scene with one more thing added.

Test the plan: are there about 25 figures (8-12 for a short piece)? A plan that lands near the bottom of that count usually has paragraphs doing a figure's job. Does every figure have something to move, and does moving it reveal its section's idea? Does each figure add exactly one thing? Does the default state already show something? Is the order concrete phenomenon, simplest model, one complication at a time, payoff? Share the plan in a few lines and keep going; wait for a go-ahead only when the person asked to review it first.

### 3. Scaffold

```
node scripts/new-page.mjs --title "..." --category <Category> --dek "<one sentence>" --out <path>/index.html
```

This copies the template with the title, category, and summary filled in and an empty article between the `explainer:article` markers. The page is about 850 KB, almost all of it runtime, so don't read or edit it whole. Keep the article in its own file next to the page (`article.html`) and splice it in after each change:

```
node scripts/put-article.mjs <path>/index.html <path>/article.html
```

Leave the runtime block in `<head>` alone.

### 4. Build section by section

Read [references/runtime.md](references/runtime.md) before the first 2D figure, [references/plots.md](references/plots.md) before the first graph or science diagram, [references/simulations.md](references/simulations.md) before the first simulation, [references/math.md](references/math.md) before the first equation, [references/article.md](references/article.md) before the first sidenote, citation, or callout, [references/engine3d.md](references/engine3d.md) before the first 3D figure, and the reference from the table in step 2 before the first figure of each other kind ([parts3d](references/parts3d.md), [iso](references/iso.md), [maps](references/maps.md), [optics](references/optics.md), [effects](references/effects.md), [sound](references/sound.md), [images](references/images.md), [diagrams and code](references/diagrams.md)). Then write each section's prose and figure together, in page order:

```html
<p>Open the mouth <span class="scrub" data-key="open"></span> and watch the <span class="c-green" data-part="condyle">condyle</span> slide:</p>
<figure class="demo" id="slide" aria-label="Side cut through the jaw joint; the condyle turns, then slides forward."></figure>
<script>
{
  let P; // world-to-pixel mapping from the last draw, shared with drag callbacks
  demo("slide", { /* ... */ });
}
</script>
<p>For the first 20 mm the condyle only turns...</p>
```

Build a long page in passes, not in one go: write the shared model and the first section, verify, then add two or three sections at a time and verify again, so a broken figure is found while it's fresh. Wrap each figure's script in a block `{ ... }`. Use palette names (`"blue"`, `"ink"`, materials like `"bone"`) for every color. Pick each control to match its quantity (runtime.md lists which control fits what), draw draggable things with `g.handle`, give each figure a caption, and let the prose drive the figure where a sentence is about a number or a comparison. Use 3D where depth, assembly, or turning the object teaches something; use 2D cross-sections, plots, and diagrams where a flat view is clearer. Most good pages mix both.

### 5. Check, explore, look

When the page has Mermaid diagrams or code blocks, render them first (safe to repeat):

```
node scripts/render.mjs <page>
node scripts/verify.mjs <page>
node scripts/explore.mjs <page> [--figure <id>]
```

`verify.mjs` loads the page in headless Chrome at desktop and phone widths and reports script errors, blank figures, controls and presets that change nothing, animations that don't move, views that don't turn, prose numbers and links not tied to a figure, citations with no reference, TeX errors, leftover placeholders, sideways scrolling, and external requests. It also counts words of main text per figure and warns outside 80-180. It saves screenshots (desktop, dark, phone).

`explore.mjs` plays with every figure: it sweeps each slider across its range, flips toggles, presses buttons and lets time run, turns 3D views to four sides, and steps animations. It saves one contact sheet per figure. Read every sheet. This is how you find out whether a figure actually teaches what its paragraph promises.

Read each figure's lead-in sentence next to its sheet and confirm that a reader doing what the sentence says would see what the next paragraph claims, at the values it claims.

### 6. Fix what's wrong

Anything that fails a check, looks wrong in a sheet, or doesn't match the text goes through this loop. Repeat it until everything passes and every sheet looks right.

1. **Reproduce.** Find the exact state where it's wrong (control values, view, time) in the sheets. If no sheet shows it, run `explore.mjs --figure <id>`.
2. **Find the cause and its layer.** Decide which of these it is:
   - the **model** (wrong numbers, wrong motion, an effect too small to see)
   - the **figure code** (layout, clipping, framing, labels, colors)
   - the **prose** (a claim the figure or the facts don't support)
   - the **runtime or engine** (a rendering bug that would hit any page)

   [references/fixing.md](references/fixing.md) lists symptoms with their usual causes.
3. **Fix the cause, not the symptom.**
   - If a locked joint barely deflects the jaw, fix the kinematics; don't nudge the drawing.
   - If labels collide, change what's labeled and where it's anchored; don't shrink the text until it's unreadable.
   - If a sentence overclaims, change the sentence or the figure so they agree.
4. **Re-run** `verify.mjs`, then `explore.mjs` on the figure. Check that the fix worked and nothing else moved.
5. **Re-read** the text around the figure against the new sheet, and update numbers or wording that changed.

If something can't be fixed, say so in the report instead of hiding it. If the cause is in the runtime or engine, fix it in the page only as a last resort, and name it in the report.

If the scripts can't run (no Node 22+, no Chrome), say so in the report and suggest opening the page with `?check` on the end of the URL, which shows the same self-check in a panel.

When the person wants the figures inside their own app or blog (React, Vue, Svelte, Astro/MDX) rather than standalone pages, the same runtime ships as packages for each framework (`safis`, `@safis/react`, `@safis/vue`, `@safis/svelte`, `@safis/astro`), with source and setup under `packages/` in https://github.com/broisnees/safis. Figure specs are identical; only the mounting differs.

### 7. Build the site (when there is one)

```
node scripts/site.mjs <root> [--title "..."] [--intro "..."] [--thumbs] [--shared | --inline]
```

It reads each page's title, summary, and category, writes `<root>/index.html`, and updates the sidebar in every page. Run it again whenever a page is added or renamed. `--thumbs` screenshots each page's first figure for the home page cards. `--shared` moves the runtime and fonts out of the pages into one `<root>/safis.css` and `<root>/safis.js`, which takes a page from about 950 KB to about 100 KB. Use it for a site that will be hosted. The pages still open from disk, but only inside the site folder, so leave it off when someone wants standalone files. The choice sticks for later runs, and `--inline` reverses it. Pages from an older template can be brought up to date with `scripts/upgrade.mjs <page>...`.

### 8. Report

Reply with:

- the file path or paths, and how to open them (plain files; open in a browser, no server needed)
- the sections, with one line per figure: what the reader does and what it shows
- the check result, what the exploration showed, and what was fixed along the way
- simplifications and exaggerations a reader should know about, and anything that wasn't verified
