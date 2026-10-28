# @safis/vue

Vue 3 components for [Safis](https://safis.fyi) interactive figures: `Figure`, `Explainer`, `Scrub`, `SetLink`, `Term`, `Tex`.

```sh
npm install @safis/vue @safis/core
```

A figure is a spec: controls, state, and a `draw` function. The same spec runs in every framework.

```js
// figures/spring.js
export default () => ({
  controls: [{ key: "k", label: "Stiffness", min: 1, max: 10, value: 4, unit: "N/m" }],
  state: () => ({ x: 1, v: 0 }),
  step(dt, s, v) { s.v -= v.k * s.x * dt; s.x += s.v * dt; },
  draw(g, s) { g.circle([g.w / 2 + 120 * s.x, g.h / 2], 16, { fill: "blue" }); },
});
```

```vue
<script setup>
import "@safis/core/scoped.css"; // the book theme inside .safis elements ("@safis/core/style.css" styles the whole page)
import { Explainer, Figure, Scrub, Tex } from "@safis/vue";
import spring from "./figures/spring.js";
</script>

<template>
  <Explainer>
    <p>Give it a stiffness of <Scrub figure="spring" k="k" />:</p>
    <Figure id="spring" :spec="spring" label="A block on a spring." />
    <p>One swing takes <Tex src="T = 2\pi\sqrt{m/k}" />.</p>
  </Explainer>
</template>
```

Docs: the figure runtime, plots, simulations, maps, optics, sound, math, and the 3D engine are described in the [Safis skill references](https://github.com/broisnees/safis/tree/main/skills/safis/references). Examples for every framework live in [examples/](https://github.com/broisnees/safis/tree/main/examples).
