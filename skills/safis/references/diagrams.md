# Diagrams, code, and diffs

Some ideas are structure, not motion: the steps of a protocol, the states of a machine, the classes in a design, the lines a patch changes. Those get a static diagram or a code block, pre-rendered once by `scripts/render.mjs` so the page still carries no renderer and makes no requests. Anything the reader should move stays a live figure (`demo`); a diagram never replaces one.

## When to use what

| The idea | Use |
|---|---|
| Who talks to whom, in what order (DNS lookup, TLS handshake, cache miss) | Mermaid `sequenceDiagram` |
| A process or decision path | Mermaid `graph TD` (top-down reads best in a column; use `LR` only for 3-5 nodes) |
| States and the events between them (a lock, a TCP connection) | Mermaid `stateDiagram-v2` |
| Types and their relations, tables and keys | Mermaid `classDiagram`, `erDiagram` |
| A small static chart that nothing changes | Mermaid `xychart-beta` (anything the reader varies belongs in `g.graph`) |
| Real code the reader should read | `<pre><code class="language-x">` |
| What a change does to a file | `<pre><code class="language-diff">`, or notation comments in normal code |

## Writing them

```html
<p>A resolver answers from its cache when it can, and asks down the tree when it can't:</p>
<figure class="diagram">
<pre class="mermaid">sequenceDiagram
  participant B as Browser
  participant R as Resolver
  participant A as Authoritative
  B->>R: example.com?
  R->>A: example.com?
  A-->>R: 93.184.215.14, TTL 3600
  R-->>B: 93.184.215.14</pre>
<figcaption>One lookup on a cold cache. The next one stops at the resolver.</figcaption>
</figure>

<pre><code class="language-js" data-title="cache.js">function lookup(name) {
  const hit = cache.get(name);
  if (hit &amp;&amp; hit.expires &gt; now()) return hit.address; // [!code highlight]
  return ask(name);
}</code></pre>

<pre class="numbered"><code class="language-diff" data-title="nginx.conf">@@ -10,3 +10,4 @@
   location /static/ {
-    expires 1h;
+    expires 30d;
   }</code></pre>
```

Then, before `verify.mjs`:

```
node scripts/render.mjs <page>
```

- **Escape code.** Inside `<code>`, write `&lt;`, `&gt;`, `&amp;`. Mermaid inside `<pre class="mermaid">` needs the same for `<` and `&`.
- **Captions.** Wrap a diagram in `<figure class="diagram">` with a `<figcaption>`; it's numbered with the other figures. A bare one gets a figure wrapper without a caption.
- **Titles and numbers.** `data-title="file.js"` on `<code>` adds a title bar; `class="numbered"` on `<pre>` adds line numbers.
- **Marking lines** in any language with Shiki's notation comments, removed from the output: `// [!code ++]` (added), `// [!code --]` (removed), `// [!code highlight]`, `// [!code focus]` (the rest dims until hovered). Use `#` instead of `//` in Python, shell, and YAML.
- **Re-running is safe.** Each block keeps its source in `data-src`, and `render.mjs` re-renders from it. Edit a rendered diagram by changing its `data-src`, or put the `<pre>` back.
- **Wide diagrams** shrink to about 70% of their natural size and then scroll sideways, so the text stays readable. Prefer `TD` and short node labels over a wide `LR`.

`verify.mjs` fails a page with an unrendered `<pre class="mermaid">`.

## How it looks

Diagrams draw in the page's ink on the page's paper, with no color of their own, and switch with the theme. Code uses GitHub's light and dark colors; every block has a copy button. Diffs tint added lines green and removed lines red, with the sign in the gutter.

## Pitfalls

- **Don't diagram what moves.** A sequence diagram of a handshake is fine; the timing of that handshake over distance is a live figure with a slider.
- **Keep diagrams small.** Past about 12 nodes, split it or teach it as a figure the reader builds up.
- **Code is evidence, not decoration.** Show the 5-15 lines that make the point, with the line that matters highlighted, and say in the prose what to look at.
- **First run needs a network.** `render.mjs` installs its pinned renderers into `~/.cache/safis` once. If it can't, say so in the report and leave the blocks as plain `<pre>`.
