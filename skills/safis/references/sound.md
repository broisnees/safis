# Sound: voices, plucks, and spectra

The sound kit (`src/sound.js`) adds four things to every page:

- **`Sound.voice(o)`**: a continuous tone, chord partial, or noise whose pitch, harmonics, filter, and loudness glide smoothly while a slider moves.
- **One-shots**: `Sound.pluck` (a Karplus-Strong string) and `Sound.play` (samples, a function f(t), or a voice spec, played once).
- **`Sound.button(...)`**: the standard play/stop control, which keeps the sound and the figure in step.
- **Analysis and drawing**: a radix-2 FFT, `Sound.spectrum`, `Sound.stft`, and `g.waveform`, `g.spectrum`, `g.spectrogram`, `g.envelope`.

Use it when hearing the thing teaches something seeing it can't: pitch, timbre, beats, consonance, a filter's sweep, a string's decay. Draw what plays: render the same spec offline with `Sound.render` or `Sound.karplus` and draw that, so the picture and the sound come from one model.

Rules the kit enforces, so pages don't have to:
- **Silent until pressed.** The AudioContext is created inside the reader's first press of a sound button. Nothing autoplays. Headless checks never make a sound; voices still report `playing`, so screenshots show the playing state.
- **Never loud.** Every voice goes through a gain cap (0.22 of full scale) and a limiter. `gain` is relative loudness, 0 to 1, and the kit clamps it.
- **One figure at a time.** Starting a sound in one figure stops what another figure is playing. Scrolling a figure off screen, or hiding the tab, stops its sound.

## When to use what

| The figure teaches | Use |
|---|---|
| Pitch and loudness of a pure tone | `Sound.voice({ type: "sine" })` + `Sound.button(voice)`; draw `Sound.render(voice.params, ...)` with `g.waveform` |
| Timbre, harmonics, Fourier series | `Sound.voice({ harmonics })`; `g.spectrum(h, box, { freqs })` for the stems; `Sound.partials` for square, sawtooth, triangle |
| Intervals, chords, beats | Two voices in one button: `Sound.button([a, b])` |
| What frequencies are in a signal | `Sound.spectrum(x)` then `g.spectrum(mags, box, { sampleRate, peaks })` |
| How a sound changes over time | `Sound.stft(x)` then `g.spectrogram(frames, box, { sampleRate, hop })` |
| A plucked string, pick position, decay | `Sound.pluck(o)` from `Sound.button(fn)`; draw `Sound.karplus(o)` |
| Noise colors, filters, resonance | `Sound.voice({ type: "noise", filter })`; `Sound.filter` and `Sound.response` for the curves |
| Attack, decay, sustain, release | `env` on a voice, `g.envelope(env, box)` |
| An equation as sound | `Sound.play(t => ..., { duration })` |

## Voices

```js
const tone = Sound.voice({ type: "sine", freq: 220, gain: 0.7 });
tone.set({ freq: v.f });      // in draw(): glides to the new value, does nothing if unchanged
```

| option | default | |
|---|---|---|
| `type` | `"sine"` | `"sine"`, `"square"`, `"sawtooth"`, `"triangle"`, `"additive"` (implied by `harmonics`), or `"noise"`. |
| `freq` | 220 | Hz. For additive voices, the fundamental. |
| `gain` | 1 | Relative loudness, 0 to 1. |
| `harmonics` | | Amplitudes of harmonics 1, 2, 3... (up to 64), as a sine series. Negative values flip a partial's phase. |
| `phases` | | Radians per harmonic. Changes the waveform's shape, barely its sound. |
| `normalize` | true | Scale the sum of harmonics to a peak of 1, so adding harmonics doesn't get louder. `false` keeps raw amplitudes (still capped at 1). |
| `color`, `seed` | `"white"`, 7 | Noise only: `"white"`, `"pink"` (−3 dB per octave), or `"brown"`. |
| `filter` | | `{ type, freq, q, gain }`: `"lowpass"`, `"highpass"`, `"bandpass"`, `"notch"`, `"allpass"`, or `"peaking"`. `q` is linear for every type (0.707 is flat). Works on any voice type. |
| `env` | `{ a: 0.02, d: 0, s: 1, r: 0.08 }` | ADSR in seconds (`s` is a level, 0 to 1). The default only avoids clicks. |
| `glide` | 0.03 | Time constant (s) for parameter changes. |

| member | |
|---|---|
| `voice.start(o)`, `voice.stop()`, `voice.toggle(on)` | Start and stop (stop runs the release). `o.fig` ties the voice to a figure; `Sound.button` sets it automatically. Return the voice. |
| `voice.set(params)` | Change any option above except `type`. Smooth while playing; stored while silent. Cheap enough for every `draw()`. |
| `voice.playing`, `voice.elapsed`, `voice.audible`, `voice.params` | Whether it's on (true in headless checks too), seconds since start, whether real audio is running, and the current spec (pass it to `Sound.render` to draw what plays). |

## One-shots

| call | |
|---|---|
| `Sound.play(src, o)` | `src` is samples (a Float32Array), a function `t => value` in seconds, or a voice spec. `o.sampleRate` [44100] for samples, `o.duration` [1] for functions and specs, `o.gain` [1], `o.loop`, `o.fig`, `o.onend`. Values are clipped to ±1 and faded over 3 ms at both ends. |
| `Sound.pluck(o)` | A plucked string: `freq` [220], `decay` [2] (seconds to fall 60 dB), `pick` [0.2] (where along the string, 0 to 0.5), `brightness` [0.5], `gain` [0.9], `seed`. |

Both return a playback: `{ playing, duration, elapsed, progress, stop() }`. `progress` (0 to 1) is what a playhead needs.

## The play button

```js
controls: [ Sound.button(tone) ]                                        // toggles: Play / Stop
controls: [ Sound.button([low, high]) ]                                 // two voices as one sound
controls: [ Sound.button((s, v) => (pb = Sound.pluck({ freq: v.f })), { label: "Pluck" }) ]   // one-shot
```

`Sound.button(target, o)` returns a runtime button control. `target` is a voice, a list of voices, or `fn(s, v, fig)` that starts one-shots and returns them.

| option | default | |
|---|---|---|
| `label`, `stopLabel` | `"Play"`, `"Stop"` | The button reads `stopLabel` while its sound plays. |
| `toggle` | true for voices, false for functions | A one-shot button re-triggers on every press unless `toggle: true` (use it for sounds longer than a second). |
| `primary` | true | The filled style. |
| `animate` | false | Also play and pause the figure's `step()` with the sound. |
| `color`, `hidden` | | As for any button. |

The button starts audio inside the reader's click, stops the other figures' sounds, relabels itself, and redraws the figure whenever its sound starts or stops for any reason (scrolled away, another figure started, a one-shot ended). Prose can press it like any button: `<button class="set" data-press="Play">hear it</button>`.

Also: `Sound.stopAll()`, `Sound.playing(fig)` (anything from this figure playing), `Sound.ready` (audio running), `Sound.volume` (0 to 1, a page-wide multiplier under the cap).

## Offline synthesis

Pure functions that return Float32Arrays; use them for drawing and for the buffers to play.

| call | |
|---|---|
| `Sound.render(spec, { duration, sampleRate, held })` | Exactly what a voice with that spec sounds like: shape, filter, gain, and `env` (released at `held` s, default `duration − r`). |
| `Sound.cycle(spec, { n: 512, cycles: 1 })` | One or more periods of a voice's waveform at `n` points, scaled the way the voice plays it. |
| `Sound.partials(spec)` | Harmonic amplitudes of `"square"` (4/πk, odd k), `"sawtooth"` (±2/πk), `"triangle"` (±8/π²k², odd k) up to Nyquist, or `spec.harmonics`. |
| `Sound.karplus(o)` | The plucked string as samples; same options as `Sound.pluck`, plus `duration` [2] and `sampleRate`. Pitch is exact to a hundredth of a cent (an allpass supplies the fractional delay). |
| `Sound.noise(n, { color, seed })` | Seeded white, pink, or brown noise. |
| `Sound.fromFunction(f, { duration, sampleRate })` | Samples f(t), clipped to ±1. |
| `Sound.adsr(t, env, held)` | Envelope level at time t for a note held `held` seconds. Linear segments, the same shape the live voice uses. |
| `Sound.filter(x, f, sampleRate)`, `Sound.response(f, freqs, sampleRate)`, `Sound.biquad(f, sampleRate)` | The voice's filter applied offline, its magnitude response at each frequency, and its coefficients (RBJ cookbook, as in Web Audio). |

## Analysis

| call | |
|---|---|
| `Sound.fft(re, im, inverse)`, `Sound.ifft(re, im)` | In-place radix-2 FFT. Length must be a power of two. Returns `{ re, im }`. |
| `Sound.spectrum(x, o)` | One-sided amplitude spectrum, `size / 2 + 1` values, scaled so a sine of amplitude A peaks near A. `o.size` (power of two; default the next one above the length, at most 16384; shorter input is zero-padded), `offset` [0], `window` [`"hann"`] (`"hamming"`, `"blackman"`, `"rect"`), `db`, `floor` [−120]. Bin k is `k * sampleRate / size` Hz. |
| `Sound.peaks(mags, { count: 5, sampleRate, min })` | The largest local maxima as `[{ bin, freq, mag }]`, refined to a fraction of a bin; with the Hann window the amplitude is corrected for where the peak falls between bins. |
| `Sound.stft(x, { size: 1024, hop: size / 4, window })` | One magnitude spectrum per hop, for `g.spectrogram`. |
| `Sound.binFreq(k, size, sampleRate)`, `Sound.rms(x)`, `Sound.window(name, n)`, `Sound.nextPow2(n)`, `Sound.rng(seed)` | Helpers. |

## Drawing

Boxes are `[x, y, w, h]` in px, like the rest of `g`. Each helper returns its mapping for playheads, hover, and labels.

| call | |
|---|---|
| `g.waveform(x, box, o)` | Samples as a trace; more samples than pixels draw as a min/max band, like an audio editor. `range` [−1, 1], `from`, `to` (sample indexes), `color` ["blue"], `width` [2], `fill`, `stems` (lollipops, for showing samples), `playhead` (0 to 1), `label`, `zero` [true]. Returns `{ box, x(i), y(v), index(px) }`. |
| `g.spectrum(mags, box, o)` | Frame axes from `g.graph` with Hz labels. `sampleRate` [44100], `minFreq`, `maxFreq`, `log`, `db` (input stays linear; the axis is dB), `floor` [−80], `range` ([0, 1] or [floor, 0]), `style` ("line", "bars", "stems"), `freqs` (one frequency per value: partial amplitudes as stems), `peaks` (label the n largest), `color` ["blue"], `fill`, `highlight` (an index), `axes: false` (draw into `box` as is, for overlaying a second spectrum on the first's returned `box`), plus `g.graph`'s `xTicks`, `yTicks`, `xFormat`, `yFormat`, `xLabel`, `yLabel`, `grid`, `pad`. Returns `{ P, box, x(freq), y(mag) }`. |
| `g.spectrogram(frames, box, o)` | Time across, frequency up, loudness from paper to `color` ["ink"]. `sampleRate`, `hop` (for the time axis), `maxFreq`, `floor` [−80 dB], `ref` [1], `gamma` [1], `smooth` [true], `playhead`, `playheadColor` ["red"], `axes`. Cached per frames array and theme. Returns `{ P, box, time(px), freq(py) }`. |
| `g.envelope(env, box, o)` | An ADSR shape with its phases named. `held` (s), `t` (a dot on the curve), `color` ["orange"], `labels`. Returns `{ box, x(t), y(level), held, T }`. |

## Examples

### A tone, heard and seen

The waveform is rendered from the voice's own spec, so the drawing is the sound. The status line gives the period.

```html
<p>Drag the <span class="c-blue">frequency</span> from <button class="set" data-set="f=110">110 Hz</button> to <button class="set" data-set="f=880">880 Hz</button>: each doubling is an octave.</p>
<figure class="demo" id="tone" aria-label="Twelve milliseconds of a sine wave; a frequency slider squeezes the waves together."></figure>
<script>
{
  const tone = Sound.voice({ type: "sine", freq: 220, gain: 0.7 });
  demo("tone", {
    aspect: 2.3,
    controls: [
      { key: "f", label: "Frequency", min: 110, max: 880, step: 1, value: 220, unit: "Hz", color: "blue" },
      Sound.button(tone),
    ],
    status: (s, v) => `one cycle every ${(1000 / v.f).toFixed(2)} ms`,
    draw(g, s, v) {
      tone.set({ freq: v.f });
      const P = g.graph({ x: [0, 12], y: [-1.2, 1.2], axes: "frame", xLabel: "Time (ms)", yTicks: false });
      g.waveform(Sound.render(tone.params, { duration: 0.012, sampleRate: 48000 }), P.box, { range: [-1.2, 1.2], width: 2.5 });
    },
  });
}
</script>
```

### A plucked string with a playhead

A one-shot button keeps the playback it started in a block variable; `draw()` reads its progress and asks for frames while it plays. The expensive offline render is cached by its parameters.

```html
<p>Pluck at the <button class="set" data-set="pick=0.5">middle</button> and every even harmonic disappears.</p>
<figure class="demo" id="pluck" aria-label="Two seconds of a plucked string's sound above its spectrum in decibels, with harmonics numbered."></figure>
<script>
{
  const SR = 22050;
  let pb = null, key = "", wave, spec;
  const opts = v => ({ freq: 110, pick: v.pick, decay: 1.5, brightness: 0.1 });
  demo("pluck", {
    aspect: 1.7,
    controls: [
      { key: "pick", label: "Pluck at", min: 0.05, max: 0.5, step: 0.01, value: 0.2, color: "orange" },
      Sound.button((s, v) => (pb = Sound.pluck(opts(v))), { label: "Pluck" }),
    ],
    draw(g, s, v) {
      const k = JSON.stringify(opts(v));
      if (k !== key) { key = k; wave = Sound.karplus({ ...opts(v), sampleRate: SR }); spec = Sound.spectrum(wave, { size: 16384 }); }
      g.waveform(wave, [0, 0, g.w, g.h * 0.35], { color: "ink", playhead: pb?.playing ? pb.progress : null });
      g.spectrum(spec, [0, g.h * 0.4, g.w, g.h * 0.6], { sampleRate: SR, maxFreq: 110 * 12.5, db: true, floor: -90, range: [-90, -10],
        xTicks: Array.from({ length: 12 }, (_, i) => (i + 1) * 110), xFormat: f => `${Math.round(f / 110)}`, xLabel: "Harmonic number", color: "orange" });
      if (pb?.playing) g.wantsFrame = true;
    },
  });
}
</script>
```

### Two notes and their spectrum

Two voices share one button. The FFT finds both notes in the tangled sum; `peaks` labels them.

```html
<figure class="demo" id="chord" aria-label="Forty milliseconds of two tones added together, above the FFT spectrum with both peaks labeled."></figure>
<script>
{
  const SR = 16000, a = Sound.voice({ freq: 220, gain: 0.5 }), b = Sound.voice({ freq: 330, gain: 0.5 });
  demo("chord", {
    aspect: 1.75,
    controls: [{ key: "f2", label: "Second note", min: 220, max: 660, step: 0.1, value: 330, unit: "Hz", color: "purple" }, Sound.button([a, b])],
    presets: [{ label: "Octave", set: { f2: 440 } }, { label: "Fifth", set: { f2: 330 } }, { label: "Tritone", set: { f2: 311.1 } }],
    draw(g, s, v) {
      b.set({ freq: v.f2 });
      const x = Sound.fromFunction(t => 0.5 * Math.sin(TAU * 220 * t) + 0.5 * Math.sin(TAU * v.f2 * t), { duration: 0.5, sampleRate: SR });
      g.waveform(x, [0, 0, g.w, g.h * 0.38], { to: SR * 0.04, range: [-1.1, 1.1], color: "ink" });
      g.spectrum(Sound.spectrum(x, { size: 16384 }), [0, g.h * 0.44, g.w, g.h * 0.56], { sampleRate: SR, maxFreq: 800, peaks: 2, color: "purple", range: [0, 0.65], yTicks: [0, 0.25, 0.5] });
    },
  });
}
</script>
```

## Pitfalls

- **Keep voices out of `state`.** Create them once in the figure's block (`const tone = Sound.voice(...)`) next to `demo()`. State must stay plain data for the self-check.
- **Never start sound from `draw()`, `step()`, or page load.** Start it from `Sound.button` or a pointer handler (`drag.start`), which are user gestures. `draw()` only calls `voice.set(...)`.
- **Ask for frames while something plays.** A playhead or a pulsing mark needs `g.wantsFrame = true` in `draw()` while `voice.playing` or `pb.playing`.
- **Draw at a low sample rate.** 4,000 to 22,050 Hz is plenty for pictures and keeps `draw()` fast; the voice plays at the device's rate either way. Cache anything that renders seconds of audio or runs a large FFT, keyed by the parameters.
- **A reset doesn't stop a voice.** The runtime's reset only replaces `s`. Stop the sound yourself in `change()` when a control should silence it (`change(key) { if (key === "which") pb?.stop(); }`).
- **Pick linear or dB on purpose.** Tones and harmonics read best on a linear axis with a fixed `range`; noise, decays, and anything spanning 40 dB or more needs `db: true`. Keep the range still while the reader drags.
- **Spectra need power-of-two sizes.** `Sound.spectrum` zero-pads short input to `size`; pass a larger `size` to see peaks more finely, not to gain resolution (that comes only from more samples).
- **Label pitch in Hz and as a note when it helps** ("196 Hz, G3"). The master cap means loudness on the page is relative: say "louder", not "80 dB".
