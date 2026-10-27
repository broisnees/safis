# Math

Equations are written in TeX. The runtime turns them into MathML in the prose and draws them on figure canvases with `g.tex()`. Both use the same font (a subset of STIX Two Math), so a symbol in the text and the same symbol in a figure look identical. Use math wherever a formula is the clearest way to say something, but let the figure carry the idea: an equation usually follows a figure and names what the reader just saw.

## In the prose

```html
<p>The period depends only on <span class="tex">\blue{L}</span> and <span class="tex">\green{g}</span>:</p>
<div class="tex">T = 2\pi\sqrt{\frac{\blue{L}}{\green{g}}}</div>
```

- `<span class="tex">` is inline math; `<div class="tex">` (or `<p class="tex">`) is a display equation, centered on its own line.
- Number a display equation with `data-number="3"` or `\tag{3}` in the TeX, or let the page count with `class="tex numbered"`. Use one style per page.
- Write `<` as `\lt` (or `&lt;`) and `>` as `\gt`; in HTML, `a<b` starts a tag. Put spaces around `&` in matrices.
- Long display equations scroll sideways on phones. Keep them under about 30 symbols, or split them with `aligned`.
- A TeX mistake shows the source in red on the page and logs `[tex] ...` to the console, which `verify.mjs` reports as an error.

## Color

Give a quantity the same color in the equation, the prose, and the figure: `\blue{v}`, `\red{...}`, and so on, for every palette name (`ink muted brass red orange green blue purple`). `\color{blue}{x}` and `\textcolor{blue}{x}` work too. Colors follow light and dark mode.

```html
<p>The <span class="c-blue">velocity</span> <span class="tex">\blue{v}</span> grows by <span class="tex">\red{a}</span> every second:</p>
<div class="tex">x = x_0 + \blue{v_0}\,t + \tfrac{1}{2}\red{a}\,t^2</div>
```

## On a canvas

```js
g.tex("\\theta", P([0.3, 0.2]), { size: 16, color: "orange", halo: true });
const { w, h } = g.measureTex("\\frac{1}{2}mv^2", { size: 15 });
```

`g.tex(str, point, options)` takes the same options as `g.text`: `size` (px, default 16), `color`, `align` (`"center"`, `"left"`, `"right"`), `baseline` (`"middle"`, `"alphabetic"`, `"top"`, `"bottom"`), `halo`, `alpha`, plus `display: true` for full-size fractions and limits. It returns `{ w, h }`. In JS strings double the backslashes (`"\\theta"`) or use ``String.raw`\theta` ``. Use `g.tex` for every symbol in a figure (`v_0`, `\theta`, `F_{net}`), and `g.text`/`g.label` for words.

## What's supported

| | |
|---|---|
| Scripts | `x^2`, `x_i`, `x_i^2`, `x^{2n}`, `f'(x)`, `f''`, `{}^{14}C` |
| Fractions, roots | `\frac{a}{b}`, `\dfrac`, `\tfrac`, `\binom{n}{k}`, `\sqrt{x}`, `\sqrt[3]{x}` |
| Fences | `( ) [ ] \{ \} | \|`, `\left( ... \right)`, `\middle|`, `\big( \Big[ \bigg\{ \Bigg|` (`l`/`r` forms too), `\langle \rangle \lfloor \rfloor \lceil \rceil`, `\left.` |
| Greek | `\alpha` ... `\omega`, `\varepsilon \vartheta \varphi \varrho \varsigma \varpi`, `\Gamma \Delta \Theta \Lambda \Xi \Pi \Sigma \Upsilon \Phi \Psi \Omega` |
| Relations | `= < > \lt \gt \le \ge \ne \approx \sim \simeq \cong \equiv \propto \ll \gg \in \notin \subset \subseteq \parallel \perp \mid`, `\not=` |
| Operators | `+ - \pm \mp \times \cdot \div \ast \circ \bullet \cup \cap \wedge \vee \oplus \otimes \setminus`, `\bmod`, `\pmod{n}` |
| Arrows | `\to \gets \rightarrow \leftarrow \leftrightarrow \Rightarrow \Leftarrow \Leftrightarrow \implies \iff \mapsto \longrightarrow \uparrow \downarrow \rightleftharpoons` |
| Labeled arrows | `\xrightarrow{k}`, `\xrightarrow[below]{above}`, `\xleftarrow`, `\xleftrightarrow`, `\xRightarrow`, `\xLeftarrow`, `\xrightleftharpoons`, `\xmapsto` |
| Big operators | `\sum \prod \coprod \int \iint \iiint \oint \bigcup \bigcap \bigoplus \bigotimes`, with `\limits` / `\nolimits` |
| Functions | `\sin \cos \tan \sec \csc \cot \arcsin \arccos \arctan \sinh \cosh \tanh \log \ln \lg \exp \deg \dim \ker \arg \sgn`, `\lim \max \min \sup \inf \det \gcd \Pr \argmax \argmin \liminf \limsup`, `\operatorname{softmax}`, `\operatorname*{arg\,max}` |
| Accents | `\vec \hat \widehat \bar \overline \underline \dot \ddot \tilde \check \breve \acute \grave \overrightarrow \overleftarrow \overleftrightarrow` |
| Braces | `\overbrace{...}^{label}`, `\underbrace{...}_{label}`, `\overparen \underparen \overbracket \underbracket` |
| Symbols | `\infty \partial \nabla \hbar \ell \Re \Im \aleph \emptyset \forall \exists \neg \angle \triangle \degree \prime \ldots \cdots \vdots \ddots \dagger`, `\% \# \& \$ \_ \{ \}` |
| Text and fonts | `\text{...}` (with `$x$` inside), `\textbf \textit \mathrm \mathit \mathbf \boldsymbol \mathbb \mathcal \mathscr \mathsf \mathtt` |
| Spacing | `\, \: \; \quad \qquad \ ~`, `\!` (ignored) |
| Environments | `matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix smallmatrix cases rcases aligned align align* split gathered gather array{lcr}`; rows split with `\\`, columns with `&` |
| Other | `\boxed \cancel \bcancel \xcancel \phantom \displaystyle \textstyle \tag{n}`; a top-level `\\` or `&` makes `gathered`/`aligned` rows |

Not supported: macros (`\newcommand`), `\ce{}` (write chemistry as `\mathrm{H_2O}`, `\mathrm{Na^+}`, `\xrightarrow{\Delta}`), `\mathfrak`, and line breaking inside inline math. `\mathsf` and `\mathtt` set letters upright rather than in a sans or mono face. On the canvas, environments lay out as plain tables.

## Good and bad

- **Name what the figure showed.** Good: after the reader doubles the length and watches the period grow by 41%, show `T = 2\pi\sqrt{L/g}` with `L` in the length's color. Bad: open a section with the formula before the reader has anything to attach it to.
- **Use units upright, with a thin space.** Good: `9.8\,\mathrm{m/s^2}`. Bad: `9.8 m/s^2` (italic m and s read as variables).
- **One symbol, one meaning, one color.** Good: `\blue{\theta}` everywhere for the swing angle, in prose, equations, and on the canvas. Bad: `\theta` in the text but "angle" on the canvas and `a` in the code.
- **Keep display math short.** Good: two lines in `aligned`, one step each. Bad: a five-term expression on one line that scrolls on a phone.
