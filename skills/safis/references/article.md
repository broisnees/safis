# Article furniture

The parts around the figures that make a page read like careful science writing: an abstract, a contents list, sidenotes, numbered citations, defined terms, callouts, optional deep dives, predictions, tables, code, and figure references. All of it is plain HTML in the article; the runtime numbers it and wires it up, and `src/article.css` styles it in both themes.

Use each where it helps the reader, not as decoration. A good long page has a handful of sidenotes, three to six callouts, one or two predictions per major idea, a deep dive wherever the math or history would interrupt the main line, and a real reference list.

## At the top

```html
<div class="abstract">
  <ul>
    <li>A pendulum's beat depends on its length, not its weight.</li>
    <li>Big swings run slow, which is why clocks keep the swing small.</li>
    <li>An escapement gives the pendulum a tiny push each swing and counts the swings.</li>
  </ul>
</div>
```

- **`.abstract`** ("In brief", or `data-label="..."`): three to five plain sentences of what the reader will understand. Put it right after the article starts, before the opening paragraph.
- **Contents** are built automatically when the article has five or more numbered sections (after the abstract if there is one). A reading-progress rule appears at the top for pages with four or more sections.
- **`<p class="lede">`** on the first paragraph gives it a drop cap.
- **`<p class="byline">`** only when the request supplies an author or date. Never invent one.

## In the margin

```html
<p>Galileo noticed the beat stays steady<span class="sidenote">The story that he timed a lamp in Pisa
cathedral against his pulse comes from his student Viviani, written decades later.</span>, and ...</p>
```

- **`.sidenote`** is numbered and sits in the right margin on wide screens; on narrow ones the number becomes a button that opens the note in place. Use it for asides that would break the sentence: a historical note, a caveat, a number's source, a "strictly speaking".
- **`.marginnote`** is the same without a number, for a short gloss next to a paragraph.
- Keep notes to one to three sentences. A note that needs a figure is a deep dive.

## Citations and references

```html
<p>Hodgkin and Huxley measured the currents in a squid's giant axon <a class="cite" href="#ref-hh1952"></a>.</p>
...
<h2 class="plain">References</h2>
<ol class="references">
  <li id="ref-hh1952">A. L. Hodgkin and A. F. Huxley, “A quantitative description of membrane current and its
  application to conduction and excitation in nerve”, <em>Journal of Physiology</em> 117 (1952), 500–544.</li>
</ol>
```

- An empty `<a class="cite" href="#ref-...">` becomes `[1]`, numbered by the reference's position in the list, with a preview of the reference on hover, focus, or tap. The self-check reports a citation with no matching reference.
- Cite real, checkable sources only: papers, books, standards, datasheets, well-known reviews. If you aren't sure a source exists exactly as you'd cite it, leave it out. A short honest list beats a long invented one.
- Cite claims a reader might doubt or want to follow up (a measured value, a historical first, a result), not common knowledge.

## Defined terms

```html
The time for one full swing, the <dfn data-def="The time for one full swing, there and back.">period</dfn>, is ...
```

`<dfn data-def="...">` marks the place a term is defined and shows the definition on hover or focus wherever the reader meets it again with `<span class="term" data-def="...">`. Use it for jargon the reader will meet several times.

## Callouts

```html
<aside class="callout key"><p>Four times the length, twice the period.</p></aside>
```

| class | label | use it for |
|---|---|---|
| `key` | Key idea | the one sentence of a section worth remembering |
| `mistake` | A common mistake | the wrong intuition, stated and corrected |
| `try` | Try this | an experiment the reader can do at home or in a figure |
| `history` | A little history | who found it and how, when it helps the story |
| `note` | Note | anything else; or set `data-label="..."` on any callout |

At most one callout per screen. If every paragraph is a callout, none of them is.

## Going deeper

```html
<details class="deeper">
  <summary>Where the formula comes from <span class="hint">3 min</span></summary>
  <p>...</p>
  <div class="tex">\ddot\theta = -\frac{g}{L}\sin\theta</div>
  <figure class="demo" id="phase" aria-label="..."></figure>
  <script>{ demo("phase", { ... }); }</script>
</details>
```

A collapsed section for the derivation, the edge case, the history, the real-world complication. The main text must make sense without it. Figures inside work normally (they size themselves when opened, and the self-check opens them). Give the summary an honest time estimate.

## Predictions

```html
<div class="quiz">
  <p>A heavier bob on the same rod: will it swing faster, slower, or the same?</p>
  <div class="choices"><button>Faster</button><button>Slower</button><button data-correct>The same</button></div>
  <p class="why">Gravity pulls harder on the heavier bob, but it is harder to move by exactly the same factor.</p>
</div>
```

Put a prediction right before the figure that answers it, at the moments where intuition goes wrong. The reader picks; the page marks the answer and shows `.why`. Write the wrong options as the mistakes people actually make.

## Tables, code, figure references

- **Tables** get a numbered caption ("Table 2") from `<caption>`; mark number columns `class="num"` so they align. Use them for real data the reader compares (constants, measured values, a model's sizes).
- **Code**: `<pre><code class="language-js">` (or `language-python`) is highlighted lightly. Show code only on computing and AI pages, and only short pieces that the figure is running.
- **Figure references**: `<a class="figref" href="#plot"></a>` becomes "Figure 3", matching the figure's caption number. Use them when the text returns to a figure from far away.

## Equations

Inline and display math, numbered equations, and colors that match figures are in [math.md](math.md).
