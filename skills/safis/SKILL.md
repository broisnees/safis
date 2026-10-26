---
name: safis
description: Safis builds interactive explainer web pages, and small sites that collect them. Long-form prose builds intuition step by step, interleaved with live 2D and 3D figures the reader drags, turns, cuts open, scrubs, and animates. Works for any subject, including anatomy and the body, biology, chemistry, physics, machines, earth and space, computing, and math. Use when someone asks for an interactive explainer, explorable explanation, visual essay, interactive article, or a page or blog that teaches how something works with live diagrams, 3D models, simulations, or sliders, for example "explain how the jaw joint works and what happens when it locks" or "an interactive page on gears". Use it even when the request doesn't say "explainer" but clearly wants a page that teaches through interactive figures.
compatibility: Produces self-contained HTML files with no dependencies that open from disk; 3D figures need WebGL 2. The check and exploration scripts need Node 22+ and Chrome, Chromium, or Edge.
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

- the **Porcelain** theme: paper-white page, objects drawn like glazed porcelain with graphite outlines, one brass accent, serif italic accents, numbered sections, key hints in the margin, light and dark modes;
- a **2D runtime**: `demo(id, spec)` turns each `<figure class="demo">` into a canvas with sliders, toggles, buttons, dragging, hover, keyboard control, animation, and a large set of drawing helpers (callouts, chips, measurement lines, hatching, color fields, dials, magnifier insets, plots);
- **E3**, a small WebGL 2 engine for 3D figures: procedural meshes (boxes, lathes, extrusions with holes, sweeps, tubes, gears, springs, arrows, molecules), a scene graph, ink outlines, section cuts with hatched faces, see-through parts, soft ground shadows, orbit with momentum, and picking;
- a **self-check** the scripts drive.

Several pages can form a site: put each at `<root>/<slug>/index.html` and run `scripts/site.mjs`, which writes a home page grouped by category and puts the index in every page's sidebar.

Defaults, unless the request says otherwise:

- **Size:** 5-8 figures, 1,500-3,000 words, 4-7 sections. Go longer (10-30 figures) only when asked for depth.
- **Reader:** a curious adult with high-school math. Define every term, ideally while it's visible in a figure.
- **Category:** one of Body, Biology, Chemistry, Physics, Machines, Earth & Space, Computing, Math.
- **Location:** the path the request names; inside an existing site folder, `<root>/<slug>/index.html`; otherwise `./<slug>/index.html`.

The pages are local files. Don't publish, upload, or deploy them unless asked to.

## Workflow

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

When several figures show the same object, build one **shared model** first (geometry, kinematics, simulation) in a single script and have every figure draw from it. Side views and 3D views then always agree, and a fix in one place fixes every figure.

Test the plan: does every figure have something to move, and does moving it reveal its section's idea? Does each figure add exactly one thing? Does the default state already show something? Is the order concrete phenomenon, simplest model, one complication at a time, payoff? For long pieces, share the plan and wait for a go-ahead.

### 3. Scaffold

```
node ${CLAUDE_SKILL_DIR}/scripts/new-page.mjs --title "..." --category <Category> --dek "<one sentence>" --out <path>/index.html
```

This copies the template with the title, category, and summary filled in and an empty article between the `explainer:article` markers. Write only inside those markers; leave the runtime block in `<head>` alone.

### 4. Build section by section

Read [references/runtime.md](references/runtime.md) before the first 2D figure and [references/engine3d.md](references/engine3d.md) before the first 3D figure. Then write each section's prose and figure together, in page order:

```html
<p>Open the mouth with the slider and watch the <span class="c-green">condyle</span> slide:</p>
<figure class="demo" id="slide" aria-label="Side cut through the jaw joint; the condyle turns, then slides forward."></figure>
<script>
{
  let P; // world-to-pixel mapping from the last draw, shared with drag callbacks
  demo("slide", { /* ... */ });
}
</script>
<p>For the first 20 mm the condyle only turns...</p>
```

Wrap each figure's script in a block `{ ... }`. Use palette names (`"blue"`, `"ink"`, materials like `"bone"`) for every color. Use 3D where depth, assembly, or turning the object teaches something; use 2D cross-sections, plots, and diagrams where a flat view is clearer. Most good pages mix both.

### 5. Check, explore, look

```
node ${CLAUDE_SKILL_DIR}/scripts/verify.mjs <page>
node ${CLAUDE_SKILL_DIR}/scripts/explore.mjs <page> [--figure <id>]
```

`verify.mjs` loads the page in headless Chrome at desktop and phone widths and reports script errors, blank figures, controls that change nothing, animations that don't move, views that don't turn, leftover placeholders, sideways scrolling, and external requests. It saves screenshots (desktop, dark, phone).

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

### 7. Build the site (when there is one)

```
node ${CLAUDE_SKILL_DIR}/scripts/site.mjs <root> [--title "..."] [--intro "..."] [--thumbs]
```

It reads each page's title, summary, and category, writes `<root>/index.html`, and updates the sidebar in every page. Run it again whenever a page is added or renamed. `--thumbs` screenshots each page's first figure for the home page cards. Pages from an older template can be brought up to date with `scripts/upgrade.mjs <page>...`.

### 8. Report

Reply with:

- the file path or paths, and how to open them (plain files; open in a browser, no server needed)
- the sections, with one line per figure: what the reader does and what it shows
- the check result, what the exploration showed, and what was fixed along the way
- simplifications and exaggerations a reader should know about, and anything that wasn't verified
