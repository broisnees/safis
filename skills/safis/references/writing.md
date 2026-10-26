# Writing the prose

The figures carry the insight; the prose tells the reader where to look and names what they found. Write so that someone who skipped every figure would still follow the argument, and someone who skimmed the text would still learn from the figures.

## Shape of the page

1. **Title and dek.** The title names the thing or the question ("Gears", "How Gears Trade Speed for Force"). The one-sentence dek under it says what the reader will understand by the end.
2. **Opening.** One or two short paragraphs that start from something the reader has seen or felt, then the first figure, within the first screen or two. Don't open with history or definitions.
3. **Sections.** Each has a short heading (a noun phrase, not a question) and one to three figures. Each section answers a question the previous one raised, and its last paragraph often raises the next one.
4. **Payoff.** The last main section returns to the opening phenomenon and explains it with everything built so far.
5. **Ending.** An optional "Further reading" list and a short closing paragraph. No recap of every section.

## Around each figure

- **Lead-in.** Tell the reader exactly what to do and what to watch: "Drag the slider to give the second gear more teeth and keep an eye on its speed readout:" End it with a colon right before the figure; about two thirds of lead-ins in the reference articles do.
- **Follow-up.** Name what they saw, then say why: "Twice the teeth, half the speed." Then the reason.
- **Don't narrate the picture.** The reader is looking at it. Describe only what they might miss.
- **Point at things by color.** "The <span class="c-red">red arrow</span> is gravity" is faster than "the arrow pointing down from the ball". Color words belong mostly in the follow-up, where the reader is checking what they saw.
- **Statements, not questions.** Don't put rhetorical questions next to figures; say what to do and what happened.

## Voice

- "We" when discovering things together ("we can see that..."), "I" for the author's choices ("I've slowed the animation down"). Direct, concrete, curious.
- Short paragraphs, two to four sentences. Mix short sentences with longer ones.
- Concrete numbers beat adjectives: "sunlight takes about eight minutes to reach Earth", not "a long time".
- Define each term the first time it appears, ideally while the thing is visible in a figure.
- Skip filler. No "In this article we will explore", "It's important to note", "Let's dive in", "fascinating", "simply", and no closing summary that repeats the sections. <!-- ai-tells: ignore -->
- Don't invent an author, byline, date, testimonial, or quote. Leave the byline out unless the request supplies one.

## Colored words

Wrap a word in `<span class="c-blue">` (or `c-red`, `c-orange`, `c-green`, `c-purple`, `c-muted`) when it names something drawn in that color in a nearby figure. Use it on the first mention in a section and whenever the color is the fastest way to find the thing. Don't use it for general emphasis; that's what `<strong>` is for, sparingly.

Keep the color map from the plan. If friction is red in figure 2, it is red in figure 5 too, and nothing else is red.

## Math

- Introduce an idea in words and in a figure first; the formula comes after, as a summary of what the reader already saw.
- Inline variables: `<var>L</var>`, `x<sup>2</sup>`. Display equations: `<p class="eq"><i>E</i> = ½ <i>m</i> <i>v</i><sup>2</sup></p>`. There's no MathJax, because the page has to work offline, so keep formulas simple and few.
- A visual equation ties a formula to the figure: `<span class="chip green">c</span> / <span class="chip orange">a</span>`, with the same colors on the segments the figure draws.
- After a formula, read it back in words and connect each symbol to something in a figure.

## Accuracy

- Use real equations, real constants with units, and real numbers. A wrong explanation that feels clear is worse than none.
- When a figure simplifies or exaggerates (scale, speed, angle, a missing force), say so in the text near it.
- When writing about health, describe; don't diagnose or prescribe. One plain sentence on when to see a clinician is enough.
- Further reading: only sources you're sure exist, such as well-known books, Wikipedia articles, or papers you can name precisely. Link a URL only when you're confident it's right; otherwise name the source without a link. Drop the section rather than invent one.
