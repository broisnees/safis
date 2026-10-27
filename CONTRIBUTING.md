# Contributing

Thanks for helping with Safis. Bug reports, new figure helpers, fixes to the guides, and new example pages are all welcome.

## Setup

You need Node 22+ and Chrome, Chromium, or Edge (set `CHROME_PATH` if it isn't found).

```
git clone https://github.com/broisnees/safis
cd safis
npm install
npm test
```

## Where things live

| Change | Edit | Then |
|---|---|---|
| Runtime, theme, 3D engine, plots, simulations, TeX | `src/` | `npm run build` (regenerates `skills/safis/assets/template.html` and the packages) |
| How the skill works, what it tells the agent | `skills/safis/SKILL.md`, `skills/safis/references/` | run the evals (below) |
| Checker, explorer, site builder | `skills/safis/scripts/` | run them on `site/` pages |
| Framework wrappers | `packages/` | `npm run test:packages` |
| Example pages | `site/<slug>/index.html` | `npm run site` |

Never edit `assets/template.html` by hand. It's generated from `src/`, and CI fails when the two disagree.

## Checking a change

```
npm test                                                  # engine, TeX, plot, and sim tests
node skills/safis/scripts/verify.mjs site/tides/index.html  # one page, desktop and phone
node skills/safis/scripts/explore.mjs site/tides/index.html --figure tilt
node skills/safis/evals/grade.mjs site/*/index.html       # scores every example page
```

For a runtime change, upgrade the example pages (`node skills/safis/scripts/upgrade.mjs site/*/index.html`), rerun `verify.mjs` on a few of them, and look at the screenshots it saves. A figure that passes every check can still look wrong.

For a change to `SKILL.md` or the references, run the eval suite in `skills/safis/evals/` (its README explains how) and compare against the previous scores.

## Pull requests

- One change per pull request, with a short note on what it fixes and how you checked it.
- Commit subjects in the imperative, like the history: `Add map projections to the plot kit`.
- New runtime features get a test in `tools/test-*.mjs` when they compute something, and a line in the matching reference file in `skills/safis/references/`.
- Prose in the guides and example pages: no em or en dashes, no filler, one idea per sentence.

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
