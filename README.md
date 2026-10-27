# Safis

Safis is a Claude skill that builds interactive explainer pages and small sites that collect them. Give it a topic and it writes a self-contained HTML page: long-form prose that builds the idea step by step, with 2D and 3D figures the reader drags, turns, cuts open, scrubs, and animates.

The approach comes from studying long-form interactive articles in a headless browser, dragging their sliders and turning their models, and writing down what makes them work in `skills/safis/references/craft.md`. The skill borrows teaching techniques, not anyone's content, models, or design.

## What a page gets

- **A book-like design.** Serif text on warm paper (Source Serif 4 and Source Sans 3, embedded), numbered sections, figures set as numbered plates with captions, light and dark themes with a switch, and print styles. Pages are single HTML files that open from disk with no network requests.
- **Figures with real controls.** Sliders with marks, segmented choices, steppers, knobs, XY pads, switches, presets, and a play/step/speed transport, plus dragging with grab handles, hover, and full keyboard support.
- **Prose that drives the figures.** Numbers in a sentence the reader drags, "try this" links that set a figure, and colored terms that light up their part.
- **A plotting and science kit.** Function graphs with π ticks, areas, tangents, vector fields, streamlines and contours; numerics (ODEs, roots, statistics, small linear algebra, softmax); springs, charges, atoms and bonds, energy diagrams, bar charts, heatmaps, neural-network diagrams, tokens.
- **Simulations.** Particle and rigid-body physics, waves and diffusion on grids, N-body gravity, random processes, classic ODE systems, and small neural networks trained live in the page.
- **3D.** E3, a small WebGL 2 engine with porcelain shading, ink outlines, ambient occlusion, section cuts with hatching, see-through parts, molecules, surfaces, and orbiting with momentum.
- **Math.** TeX in the prose rendered as MathML with a math font, symbols colored to match the figures, and formulas on the canvas.
- **Research-style furniture.** An abstract, automatic contents, reading progress, sidenotes, numbered citations with previews, defined terms, callouts, collapsible deep dives, predictions, numbered tables, and highlighted code.

## Layout

```
skills/safis/                        the skill
  SKILL.md                           workflow, including the fix loop
  references/craft.md                study of the reference articles, mapped to the tools
  references/figures.md              designing figures, 2D or 3D, the Porcelain look
  references/writing.md              writing the prose: teaching method, words, rigor
  references/article.md              sidenotes, citations, callouts, deep dives, predictions
  references/categories.md           Body, Biology, Chemistry, Physics, Machines, Earth & Space, Computing, AI, Math
  references/runtime.md              figures, controls, prose bindings, drawing helpers
  references/plots.md                g.graph, Num, science and data helpers
  references/simulations.md          Sim: physics, fields, N-body, random processes, neural nets
  references/math.md                 TeX in prose and on the canvas
  references/engine3d.md             E3, the 3D engine
  references/fixing.md               symptoms, causes, and fixes
  assets/template.html               everything above in one page template (built from src/)
  scripts/new-page.mjs               new page from the template
  scripts/verify.mjs                 headless check with screenshots (desktop, dark, phone)
  scripts/explore.mjs                plays with every figure and saves a contact sheet per figure
  scripts/site.mjs                   home page, 404, and sidebar index for a folder of pages
  scripts/upgrade.mjs                moves older pages to the current runtime
  scripts/lib/chrome.mjs             headless Chrome over the DevTools protocol, no dependencies
.claude/skills/safis -> ../../skills/safis
src/                                 sources: theme.css, article.css, fonts, runtime.js, engine3d.js, plot.js, sim.js, tex.js
packages/                            npm packages: safis (core), @safis/react, @safis/vue, @safis/svelte, @safis/astro
examples/                            react-vite, vue-vite, svelte-vite, astro-blog
tools/                               build-template, build-packages, tests, font subsetting, the research browser
site/                                the example site
```

## Use the skill

In a Claude Code session started in this folder:

```
/safis how the jaw joint works and what happens when it locks
```

Claude also loads it without the slash command when a request clearly asks for an interactive explainer. To have it in every project:

```
ln -s "$PWD/skills/safis" ~/.claude/skills/safis
```

## Open the example site

Open `site/index.html` in a browser. Everything works from disk; there's nothing to serve.

## Use in your app

The figures also ship as npm packages: `safis` (the runtime, types, theme, fonts) and thin wrappers for React, Vue, Svelte, and Astro. In this repo they're npm workspaces; `npm install && npm run build:packages` builds them, and `examples/` has a small app for each.

```js
import "safis/scoped.css";   // the book theme, only inside .safis elements (or "safis/style.css" for the whole page)
```

**React** (`@safis/react`)

```jsx
import { Explainer, Figure, Scrub, SetLink, Term, Tex } from "@safis/react";
import spring from "./figures/spring.js"; // export default () => ({ controls, draw(g, s, v) { ... } })

<Explainer>
  <p>Give it a stiffness of <Scrub figure="spring" k="k" />, then try a
     <SetLink figure="spring" values={{ k: 2, m: 4 }}>soft spring</SetLink>. Watch the
     <Term color="blue" part="block" figure="spring">block</Term>:</p>
  <Figure id="spring" spec={spring} label="A block on a spring." />
  <p>One swing takes <Tex src="T = 2\pi\sqrt{m/k}" />.</p>
</Explainer>
```

**Vue** (`@safis/vue`) and **Svelte 5** (`@safis/svelte`) export the same components: `Figure`, `Explainer`, `Scrub`, `SetLink`, `Term`, `Tex`.

**Astro and MDX** (`@safis/astro`): put each figure's spec in `src/figures/<name>.js` (default export), mount them once in your layout, and use the components in posts:

```astro
<script>
  import { mountFigures } from "@safis/astro/client";
  mountFigures(import.meta.glob("../figures/*.js"));
</script>
```

```mdx
import Figure from "@safis/astro/Figure.astro";
import Tex from "@safis/astro/Tex.astro";

<Figure name="spring" label="A block on a spring." />
<Tex src="T = 2\pi\sqrt{m/k}" display />
```

`ThemeToggle.astro` adds a light/dark switch. Math is rendered to MathML at build time.

**Anything else**: `import { mount, enhance, typeset, setTheme, E3, Num, Sim } from "safis"`, then `mount(figureElement, spec)` returns a handle with `set`, `setMany`, `play`, `highlight`, and `destroy`. Importing on the server is safe; call `mount` from an effect or a client script. `safis/iife` is a classic script that sets `window.Safis`.

## Deploy the site

`site/` is prebuilt static HTML, so every host just serves the folder. Nothing deploys automatically. The site is currently live on Cloudflare at https://safis.jotko.workers.dev.

| Host | Config | Deploy |
|---|---|---|
| Cloudflare Workers | `wrangler.jsonc` | `npm run deploy` (live at https://safis.jotko.workers.dev) |
| Vercel | `vercel.json` | `npx vercel --prod`, or import the repo |
| Netlify | `netlify.toml` | `npx netlify deploy --prod`, or import the repo |
| GitHub Pages | `.github/workflows/pages.yml` | Settings > Pages > Source: GitHub Actions, then run the workflow (set the repository variable `PAGES_AUTO_DEPLOY=true` to deploy on every push that changes `site/`) |

## Working on the skill itself

The template and packages are generated. Edit `src/`, then:

```
npm run build                                       # template + packages
npm test                                            # engine, TeX, plot, and sim tests
node skills/safis/scripts/upgrade.mjs site/*/index.html
node skills/safis/scripts/verify.mjs site/jaw-joint/index.html
npm run site                                        # home page, 404, sidebars, thumbnails
npm run test:packages                               # builds and checks the four example apps
```

The scripts need Node 22+ and Chrome, Chromium, or Edge. `tools/subset-fonts.sh` rebuilds the embedded fonts (needs Python with fonttools and brotli).

## Status

Unpublished. No license chosen yet. The embedded fonts are under the SIL Open Font License (`src/fonts/*-OFL.txt`).
