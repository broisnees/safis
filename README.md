# Safis

Safis is a Claude skill that builds interactive explainer pages and small sites that collect them. Give it a topic and it writes a self-contained HTML page: long-form prose that builds the idea step by step, with 2D and 3D figures the reader drags, turns, cuts open, and animates.

The approach comes from studying long-form interactive articles in a headless browser, dragging their sliders and turning their models, and writing down what makes them work in `skills/safis/references/craft.md`. The skill borrows teaching techniques, not anyone's content, models, or design.

## Layout

```
skills/safis/                        the skill
  SKILL.md                           workflow, including the fix loop
  references/craft.md                study of the reference articles, mapped to the tools
  references/figures.md              designing figures, 2D or 3D, the Porcelain look
  references/writing.md              writing the prose around them
  references/categories.md           Body, Biology, Chemistry, Physics, Machines, Earth & Space, Computing, Math
  references/runtime.md              2D runtime: demo(), controls, drawing and annotation helpers
  references/engine3d.md             E3, the 3D engine
  references/fixing.md               symptoms, causes, and fixes
  assets/template.html               theme, 2D runtime, 3D engine, self-check (built from src/)
  scripts/new-page.mjs               new page from the template
  scripts/verify.mjs                 headless check with screenshots (desktop, dark, phone)
  scripts/explore.mjs                plays with every figure and saves a contact sheet per figure
  scripts/site.mjs                   home page and sidebar index for a folder of pages
  scripts/upgrade.mjs                moves older pages to the current runtime
  scripts/lib/chrome.mjs             headless Chrome over the DevTools protocol, no dependencies
.claude/skills/safis -> ../../skills/safis
src/                                 sources of the template: theme.css, runtime.js, engine3d.js, page.html
tools/                               build-template.mjs, test-engine.mjs, peek.mjs (the research browser), put-article.mjs
site/                                example site: home page, The Jaw Joint, How a Pendulum Keeps Time
```

## Use

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

## Working on the skill itself

The template is generated. Edit `src/`, then:

```
node tools/build-template.mjs                      # rebuild assets/template.html
node tools/test-engine.mjs                         # geometry tests for the 3D engine
node skills/safis/scripts/upgrade.mjs site/*/index.html
node skills/safis/scripts/verify.mjs site/jaw-joint/index.html
node skills/safis/scripts/site.mjs site --thumbs
```

The scripts need Node 22+ and Chrome, Chromium, or Edge.

## Status

Unpublished. No license chosen yet.
