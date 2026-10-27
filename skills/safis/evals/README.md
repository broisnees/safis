# Evals

Eight test cases for the safis skill, in the case-folder layout that `claude plugin eval` and the skill-creator skill both read. There's one case per category. Two of them test the edges: the soap case never says "explainer", so it checks that the skill triggers on a casual request, and the Pythagoras case asks for a short piece instead of the in-depth default.

| Case | Category | Checks beyond the common ones |
|---|---|---|
| `heart-valves-in-depth` | Body | pressure opens the leaflets; leaks and stenosis |
| `photosynthesis-in-depth` | Biology | light reactions vs Calvin cycle; correct equations |
| `soap-casual-request` | Chemistry | the skill was used at all; micelles |
| `rainbow-in-depth` | Physics | ray through a drop; 42 and 51 degrees, reversed colors |
| `differential-3d` | Machines | a turnable 3D view; ring gear at the wheels' average; one wheel on ice |
| `earthquake-location` | Earth & Space | S-minus-P gap grows with distance; three-station fix |
| `key-exchange-visual-essay` | Computing | real modular arithmetic; discrete log; no protection from a man in the middle |
| `pythagoras-short` | Math | a short piece (8-12 figures, at most 2,000 words); a proof the reader can reshape |

## Graders

Each in-depth case shares five page checks: the checker passes, 80-180 words of main text per figure, at least 22 main figures, the full article furniture (abstract, prediction, callout, going-deeper section), and at least 5 references. Then come one or two topic checks and a check of the final report.

`grade.mjs` decides the page checks itself. It runs `verify.mjs` and counts. The topic and report checks need a model that reads the page and the transcript.

## Running

These are real model runs, and each one is a full page build. Comparing the current skill against a snapshot on all eight cases means 16 builds.

- **In Claude Code**, in this repo: ask for the safis evals to be run with the skill-creator skill. It snapshots the skill as the baseline, runs each case with both versions into `skills/safis-workspace/iteration-N/`, and opens a viewer with the pages and a benchmark.
- **Grading one run**: `node skills/safis/evals/grade.mjs --run <run-dir> --case skills/safis/evals/<case>` writes `<run-dir>/auto-grading.json`. It holds the page checks with their evidence, and lists the rest under `pending` for the model grader.
- **From a terminal**: `cd skills/safis && claude plugin eval . --allow-tools Write,Edit,Bash,WebSearch,WebFetch` runs the same cases with and without the skill and writes its report to `evals/results/` (ignored by git).

## Baseline

`node skills/safis/evals/grade.mjs site/*/index.html` on the 11 example pages, measured on 2026-10-27 before `SKILL.md` asked for about 25 figures:

| page | check | figures | words | words/figure | 3D | refs | abstract | predictions | callouts | deeper |
|---|---|---|---|---|---|---|---|---|---|---|
| attention | PASS | 17 | 4,027 | 237 | 0 | 8 | 1 | 2 | 3 | 1 |
| hash-table | PASS | 17 | 4,767 | 280 | 0 | 8 | 1 | 3 | 4 | 3 |
| ice | PASS | 19 | 4,585 | 241 | 5 | 13 | 1 | 2 | 5 | 3 |
| jaw-joint | PASS | 18 | 3,243 | 180 | 5 | 8 | 1 | 2 | 5 | 2 |
| learning | PASS | 17 | 4,173 | 245 | 1 | 10 | 1 | 2 | 3 | 1 |
| lock | PASS | 17 | 4,095 | 241 | 3 | 5 | 1 | 3 | 2 | 2 |
| matrix | PASS | 18 | 3,962 | 220 | 1 | 7 | 1 | 3 | 4 | 3 |
| neuron | PASS | 18 | 5,243 | 291 | 1 | 9 | 1 | 1 | 2 | 1 |
| next-word | PASS | 19 | 3,721 | 196 | 0 | 10 | 1 | 2 | 3 | 2 |
| pendulum | PASS | 17 | 3,676 | 216 | 1 | 5 | 1 | 1 | 1 | 2 |
| tides | PASS | 16 | 4,085 | 255 | 2 | 6 | 1 | 2 | 5 | 2 |

Every page passes the checker and has the furniture and references. Those checks guard against regressions. They don't measure progress. No page reaches 22 figures, and only the jaw joint stays within 180 words per figure. The two density checks are the ones a change to the skill should move.
