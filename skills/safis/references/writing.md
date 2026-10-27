# Writing the prose

The figures carry the insight; the prose tells the reader where to look, what to try, and what it means. Write so that someone who skipped every figure would still follow the argument, and someone who only played with the figures would still learn.

Contents: [how a page teaches](#how-a-page-teaches), [shape of the page](#shape-of-the-page), [around each figure](#around-each-figure), [prose the reader can touch](#prose-the-reader-can-touch), [words](#words), [sentences and rhythm](#sentences-and-rhythm), [colored words](#colored-words), [math](#math), [captions](#captions), [accuracy](#accuracy), [writing at length](#writing-at-length), [writing like a scientist](#writing-like-a-scientist), [before you finish](#before-you-finish).

## How a page teaches

Good explainers follow the same loop, section after section:

1. **Start from something seen or felt.** A clock ticking, a key that won't turn, a word a chatbot picked. Not a definition, not history.
2. **Ask the reader to predict.** "Before you drag it: will the heavier bob swing faster?" A guess, even a wrong one, makes the answer stick. Use this for the two or three moments where intuition fails, not every figure.
3. **Let them do the experiment.** The figure answers the prediction. The lead-in says exactly what to move and what to watch.
4. **Name what they saw, then explain it.** First the observation in plain words ("same beat, whatever the mass"), then the reason, then, only now, the term for it ("this is called isochronism").
5. **Add one complication.** The next section changes one thing and shows where the simple model breaks.
6. **Pay off.** Return to the opening phenomenon and explain it with everything built so far.

Concrete before abstract, always: the example, then the pattern, then the formula. Introduce at most one new term per paragraph, and use it the same way every time after.

Meet the wrong intuition head on. Most topics have one: heavier things fall faster, the Moon pulls the near ocean only, a hash table searches the list. Say it, let the reader try it in a figure, and show where it fails. That does more than any number of correct statements.

Use one good analogy per idea, grounded in something physical ("attention works like a reader skimming back through a paragraph for the words that matter"), and say where it stops working.

## Shape of the page

1. **Title and dek.** The title names the thing or the question ("Gears", "How a Neuron Fires"). The one-sentence dek says what the reader will understand by the end, in plain words.
2. **Opening.** One or two short paragraphs from the everyday phenomenon, then the first figure within the first screen or two. Mark the first paragraph `<p class="lede">` for the drop cap.
3. **Sections.** Short headings, noun phrases, concrete ("The shear line", not "Understanding Locking Mechanisms"). One to three figures each. Each section answers a question the previous one raised; its last paragraph often raises the next one.
4. **Payoff.** The last main section returns to the opening and closes the loop.
5. **Ending.** A short closing paragraph that looks outward (what this explains elsewhere, what's still unknown) and an optional "Further reading". No recap of every section.

## Around each figure

- **Lead-in.** Tell the reader exactly what to do and what to watch, and end with a colon right before the figure: "Drag the slider to give the second gear more teeth and keep an eye on its speed readout:"
- **Follow-up.** Name what they saw, then say why. "Twice the teeth, half the speed. Each tooth of the small gear pushes one tooth of the big one, so..." Put numbers the reader can check against the readout.
- **Don't narrate the picture.** The reader is looking at it. Describe only what they might miss, and the reason behind what they see.
- **Point at things by color.** "The <span class="c-red">red arrow</span> is gravity" is faster than "the arrow pointing down from the ball".
- **Questions only as predictions.** A question right before a figure is fine when the figure answers it and the next paragraph confirms it. No rhetorical questions anywhere else.

## Prose the reader can touch

The text itself can drive the figures (markup in [runtime.md](runtime.md#prose-that-drives-figures)). Use these where they make the reading active, not on every number:

- **A number the paragraph is about becomes a scrub.** "A rod <span class="scrub" data-key="length"></span> long swings once every 2 s." The reader drags the number and the figure follows.
- **Comparisons become "try" links.** "Compare a <button class="set" data-set="swing=5">small swing</button> with a <button class="set" data-set="swing=70">wide one</button>." Each sets the figure to that case, so the reader checks the claim in one click.
- **Parts become linked terms.** `<span class="c-orange" data-part="spring">spring</span>` lights the spring when the reader points at the word.
- Keep one figure per paragraph in charge; a paragraph that drives two figures loses the reader.

## Words

Plain, exact, physical words. The reader should be able to picture every sentence.

- **Precise verbs.** Swings, slides, tilts, squeezes, stretches, leaks, binds, snaps back. Not "affects", "impacts", "influences", "plays a role in".
- **Short words over long ones.** Use, not utilize; help, not facilitate; about, not approximately (unless it's a measurement); start, not commence; show, not demonstrate.
- **Name the thing.** "The key pins", not "these components". "Sodium ions", not "the relevant species". Pronouns only when there's one candidate.
- **Numbers with units and a familiar scale.** "0.2 mm, about the thickness of two sheets of paper." "A million comparisons a second, about what one core does while you blink." Round to what matters (2.01 s, not 2.0063 s).
- **Technical terms when they earn their place.** Introduce a term once the reader has seen the thing it names, in italics the first time (*shear line*), then use it exactly the same way every time. Don't swap synonyms for variety; in technical writing that reads as a new idea.
- **No filler and no hype.** Cut "it's important to note", "in this article we'll explore", "let's dive in", "simply", "just", "basically", "fascinating", "incredible", "powerful", "seamless", "robust", "crucial", "pivotal", "intricate", "delve", "tapestry", "landscape", "realm", "unlock", "harness", "leverage", "a testament to". <!-- ai-tells: ignore -->
- **No stock patterns.** No "not just X, but Y", no lists of three adjectives, no sentence that ends in a summary of itself, no paragraph that opens with "Imagine". No em-dash chains; one dash per paragraph at most.

## Sentences and rhythm

- One idea per sentence where the idea is hard. Join ideas only where they're easy.
- Mostly short sentences, with a longer one to carry a chain of cause and effect. Vary it; three sentences of the same length in a row read as a list.
- Put the new information at the end of the sentence, the old at the start: "The pins sit in a row. Under each row of pins runs the *shear line*."
- Active voice and a clear subject: "The Moon pulls the near ocean harder", not "A stronger pull is experienced by the near ocean".
- "We" when discovering things together ("we can see that..."); "I" for the author's choices ("I've slowed the animation down 50 times"). Direct, warm, curious, never chummy.
- Paragraphs of two to four sentences.

## Colored words

Wrap a word in `<span class="c-blue">` (or `c-red`, `c-orange`, `c-green`, `c-purple`, `c-brass`, `c-muted`) when it names something drawn in that color in a nearby figure. Use it on the first mention in a section and whenever the color is the fastest way to find the thing. Add `data-part` when the figure can light the part. Don't use color for general emphasis; that's what `<strong>` is for, sparingly.

Keep the color map from the plan. If friction is red in figure 2, it is red in figure 5 too, and nothing else is red. Equations use the same colors ([math.md](math.md)).

## Math

- Introduce an idea in words and in a figure first; the formula comes after, as a summary of what the reader already saw.
- Typeset with TeX: inline `<span class="tex">T = 2\pi\sqrt{L/g}</span>`, display `<div class="tex">...</div>`. Color a symbol like its figure: `\blue{L}`. Details in [math.md](math.md).
- After a formula, read it back in words and connect each symbol to something in a figure: "Double the length <span class="tex">\blue{L}</span> and the period grows by √2, about 41%."
- Keep derivations short. Show the step that carries the insight; put the rest in a sentence ("a page of algebra gets you to...").

## Captions

Every figure gets a caption under it, numbered automatically ("Figure 3"). Write it as one or two sentences: what the figure shows, and what to notice. "A pendulum next to a plot of its period against length. The period grows with the square root of the length." It should make sense to someone who scrolled straight to the figure. Don't repeat the lead-in's instructions in it.

## Accuracy

- Use real equations, real constants with units, and real numbers. A wrong explanation that feels clear is worse than none.
- When a figure simplifies or exaggerates (scale, speed, angle, a missing force), say so in the text near it or on the canvas ("bulge drawn 2 million times taller").
- When writing about health, describe; don't diagnose or prescribe. One plain sentence on when to see a clinician is enough.
- When writing about AI, describe what the model computes, not what it "thinks" or "wants". Real numbers (vocabulary sizes, dimensions) only when you're sure of them; otherwise say "tens of thousands" and show a toy model with its size stated.
- Further reading: only sources you're sure exist, such as well-known books, Wikipedia articles, or papers you can name precisely. Link a URL only when you're confident it's right; otherwise name the source without a link. Drop the section rather than invent one.
- Don't invent an author, byline, date, testimonial, or quote.

## Writing at length

An in-depth page is a sequence of small, satisfying answers, not one long lecture.

- **Every section is a question, a few figures, and an answer.** Open with the question the last section raised, in plain words; close by answering it and noticing the next problem.
- **Reuse scenes.** The same pendulum, lock, or lake comes back figure after figure with one more thing added or one thing changed. The reader's attention goes to the difference.
- **Signpost.** A sentence at the start of a long section says where it's going ("To see why, we need to look inside the plug"). A sentence at the end says what we now know.
- **Pace the hard parts.** Before a hard idea, slow down: more figures, shorter paragraphs. After it, a lighter section or a real-world example lets the reader breathe.
- **Put the detours to the side.** Derivations, history, and edge cases go in sidenotes and collapsed "going deeper" sections ([article.md](article.md)), so the main line stays clear and the curious can still follow every step.
- **End where the reader lives.** The payoff returns to the opening phenomenon; the closing paragraph points at what this explains elsewhere and what is still unknown.

## Writing like a scientist

The page should hold up to a careful reader.

- **Separate the model from the world.** Say which parts of a figure are measured, which are computed from a model, and which are drawn for clarity. "The model gives 2.01 s; a real clock pendulum loses a little to air drag."
- **Give sources for numbers people might doubt**, with numbered citations to real papers, books, or datasheets.
- **State uncertainty plainly.** "About", "roughly", "between 2 and 3 mm", "nobody knows yet why ..." are honest. False precision isn't.
- **Show the evidence.** When a claim rests on data, put the data on the page: a table, a plot of measurements, a figure that runs the real experiment.
- **Name the limits.** Each model breaks somewhere; say where, and what replaces it.

## Research pages

When the subject is a paper, a study, or an open question, the page reads like a good review article that lets the reader rerun the work:

1. **The question**, in one sentence a newcomer can hold, and why it was open.
2. **What was known**: the earlier model and the observation it couldn't explain, each as a figure.
3. **The method** as figures the reader runs: the experiment's setup as an `Iso` illustration, a 3D model, or a diagram, the estimator or algorithm stepping on real or faithfully simulated data.
4. **The results reproduced live**: the paper's key plot rebuilt with `g.graph`, with error bars or bands where the paper had them, and a control that shows how the result depends on the choice the authors made.
5. **The limits**: what the data can't say, what the authors assumed, and what later work found. Name disagreements; don't settle them by tone.
6. **References** with DOIs or stable links, the paper itself first. Quote numbers with their uncertainty ("2.3 ± 0.4 K") and say which figure or table they come from.

Keep the paper's own terms, but define each one where it first appears. Never present a reconstruction as the authors' figure: say "rebuilt from Table 2" in the caption.

## Before you finish

Read the page top to bottom once as the reader and check:

- Could a curious 16-year-old follow every paragraph without looking anything up?
- Does every lead-in say what to move and what to watch, and does the figure deliver exactly that at the values the text claims?
- Is every term defined where it first appears, and used the same way after?
- Is there a sentence anywhere that would survive being deleted? Delete it.
- Did any banned word or stock pattern slip in?
