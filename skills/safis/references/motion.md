# Motion: figures that move like a good animation

The best math and science animations feel alive because nothing ever jumps: values glide, things that change are the things you look at, and objects keep their identity from one state to the next. Use these moves in any figure whose state changes (a slider, a step, a new token, a training step).

## Rules

- **Glide, don't jump.** Every value a control changes reaches its new value over 0.4 to 0.7 s with an ease-out (`g.ease`). Bars grow in, numbers count, matrices recolor cell by cell, rows reorder by sliding.
- **One change at a time.** When a step changes several things, stage them (the score, then the softmax, then the sum) with `step()` advancing a stage clock, so the eye can follow.
- **Objects persist.** The same token, vector, or cell keeps its color and place across figures and steps; it moves to where it goes next rather than vanishing and reappearing.
- **Show the flow.** When data moves from one place to another (tokens into a model, values into a weighted sum), let dots or the thing itself travel the path (`g.flow`).
- **Color carries meaning.** A small fixed set (query, key, value; positive, negative), vivid on a dark band, used the same way in prose and figure.
- **Respect still readers.** All of this snaps to the final state under reduced motion and for the page checker; never hide content behind an animation.

## Helpers (plot kit)

| call | does |
|---|---|
| `g.ease(key, target, { dur, from, curve })` | A number or array that glides to `target` when it changes; keeps the figure drawing until it arrives. `curve`: `"out"` (default), `"inOut"`, `"spring"`, `"linear"`. Keys are per figure. |
| `g.tokens(list, { at, size, from, color, caret, colors, highlight })` | Token chips, soft and borderless; tokens from `from` on pop in, in `color`; `caret` blinks after the last; `colors: "none"` for quiet ink chips. Returns `{ rects (with cx, cy), hit }`. |
| `g.bars([{ label, value }], { box, share, chosen, top, id })` | Ranked bars: grow in, glide when values change, slide when the order changes, the leader (or `chosen`) in color. A plain array keeps the classic bar chart (also animated). |
| `g.matrix(M, { at, cell, range, rowLabels, colLabels, highlight, digits })` | A bracketed matrix with cells tinted by sign and size, numbers gliding as they change; `highlight` a row, a column, or a cell. Returns `cell(r, c)` centers for arrows. |
| `g.flow(points, { t, n, speed, color })` | Dots traveling along a path, deterministic in `t`. |
| control `{ type: "text", key, label, value, examples }` | A text field (a prompt, a word); `examples` are what the checker tries. |

```js
draw(g, s, v) {
  const toks = g.tokens([...prompt, next], { at: [16, 14], size: 15, colors: "none", from: prompt.length, caret: true });
  g.bars(probs.map(([label, value]) => ({ label, value })), { box: [16, 70, g.w * 0.55, g.h - 86], share: true, chosen: next });
  g.matrix(weights, { at: [g.w * 0.66, 90], cell: 36, rowLabels: prompt, colLabels: prompt, highlight: { row: prompt.length - 1 } });
}
```
