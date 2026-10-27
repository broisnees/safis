# Images: pixels, kernels, and the JPEG idea

The image kit (`src/image.js`) adds three things to every page:

- **`Img`**: procedural test images, embedded-image decoding, and real pixel operations: grayscale and channels, convolution, Sobel edges, resampling with honest aliasing, quantization and dithering, the 8 × 8 DCT with JPEG's quantization tables, and histograms.
- **`g.pixels(img, box, o)`**: crisp nearest-neighbor pixels that show a grid and their values when zoomed in.
- **`g.kernel(k, box)`** and **`g.histogram(h, box)`**: a kernel's weights as a grid, and a histogram of tones.

Use it for any figure about digital pictures: what a pixel is, filters, edges, scaling, color depth, compression, exposure. Compute the picture with `Img` and draw it with `g.pixels`, so every pixel on screen is the result of the operation the prose describes.

Conventions everywhere:
- **An image is `{ w, h, data }`**: `data` is a Float32Array of RGB triples, row by row from the top left, values 0 to 1. Gray images have equal R, G, and B.
- **Images are read-only.** Every operation returns a new image and leaves its input alone. Results are cached by their input and parameters, so calling `Img.blur(IM, v.sigma)` in every `draw()` costs one lookup after the first time.
- **Values aren't clamped** by operations (an edge kernel gives negative numbers). `g.pixels` clamps when it draws. Use `abs` or `offset: 0.5` on `Img.convolve` to make signed results visible.
- **Real pixels are the one exception to palette colors.** Everything drawn around them (grids, marks, labels, kernel tints) uses palette names and follows dark mode.

## When to use what

| The figure teaches | Use |
|---|---|
| What a pixel is, RGB values | `Img.scene(128)` + `g.pixels(img, box, { src })` zoomed in (values appear at 30 px per pixel or more) |
| Color channels, grayscale | `Img.channel(img, "r", { tint: true })`, `Img.gray(img)` |
| Blur, sharpen, the arithmetic of a kernel | `Img.convolve(img, Img.kernels.box(3))` + `g.kernel(k, box)` + a 3 × 3 `Img.crop` drawn with values |
| Edges | `Img.sobel(img)` → `{ gx, gy, mag }` |
| Scaling, aliasing, moiré | `Img.zonePlate(128)` or the scene's fence through `Img.resize(img, w, h, "nearest" | "bilinear" | "area")` |
| Banding, color depth, dithering | `Img.gradient(256, 20)`, `Img.quantize(img, levels)`, `Img.dither(img, levels, { method })` |
| JPEG, the DCT, frequency in images | `Img.dctBasis(u, v)`, `Img.block` + `Img.dct8`, `Img.quantTable(q)`, `Img.jpeg(img, { quality })` |
| Exposure, contrast, histograms | `Img.histogram(img)` + `g.histogram`, `Img.equalize(img)`, `Img.map` |
| A real photograph | `Img.fromDataURL(dataUrl)` (a small PNG or JPEG embedded in the page) |

## Making images

| call | |
|---|---|
| `Img.scene(w = 128, h = w, { seed })` | A country scene built to exercise every operation: smooth sky with a sun and clouds, textured mountains with snow, grass, a white house with a red roof, a window and door (hard edges), and a picket fence (fine repeats that alias when shrunk). Saturated colors and tones from about 0.07 to 1. 128 × 128 takes about 13 ms once. |
| `Img.checker(w = 64, h = w, cell = 8, { colors })` | Black and white squares (`colors: [[r, g, b], [r, g, b]]`). |
| `Img.zonePlate(w = 128, h = w, { scale: 1 })` | Rings whose frequency rises with radius, reaching half a cycle per pixel (the Nyquist limit) at the edge. Every spatial frequency at once: the standard aliasing test. |
| `Img.gradient(w = 256, h = 32, { from, to, dir })` | A ramp from `from` [black] to `to` [white]; `dir`: "x", "y", or "radial". |
| `Img.glyph(ch, size = 64, { font, weight, invert, pixel })` | A dark letter on white, drawn with the page's serif. `pixel: true` uses a built-in 5 × 7 bitmap font (A to Z, 0 to 9) at a whole-number scale. |
| `Img.make(w, h, (x, y, u, v) => value)` | Any image from a function of pixel coordinates (and 0 to 1 coordinates `u`, `v`). Return a number for gray or `[r, g, b]`. |
| `Img.fromDataURL(url, { maxSize: 256 })` | Decodes an embedded image once, shrunk to fit `maxSize`. Returns a promise. `Img.peek(url)` gives the decoded image, or `null` while it decodes. |

## Operations

| call | |
|---|---|
| `Img.gray(img)`, `Img.luma(img)` | Luma (0.299 R + 0.587 G + 0.114 B, the BT.601 weights JPEG uses) as a gray image, or as a Float32Array of `w * h`. |
| `Img.channel(img, c, { tint })` | One channel (`"r"`, `"g"`, `"b"`, or 0 to 2) as gray, or kept in its color with `tint: true`. |
| `Img.map(img, (r, g, b, x, y) => value)` | Any per-pixel change (exposure, threshold, false color). Not cached: keep results in a `Map` keyed by the parameter. |
| `Img.convolve(img, k, o)` | True convolution with an odd-sized kernel (an array of rows). `edge`: "clamp" (default, repeat the border), "wrap", or "zero". `gray: true` works on luma only (a third of the work). `abs`, `scale`, `offset` adjust the result. Separable kernels run as two 1D passes automatically. |
| `Img.kernels` | `box(n)`, `gaussian(sigma, n)`, `binomial(n)` ([1 2 1] × [1 2 1] / 16 for n = 3), `sharpen(amount)`, `sobelX()`, `sobelY()`, `laplacian()`, `edge()`, `emboss()`, `identity(n)`. Each returns a fresh array of rows. |
| `Img.blur(img, sigma, { edge })` | Separable Gaussian blur. |
| `Img.sobel(img)` | `{ gx, gy, mag }` as gray images. `gx` and `gy` are signed (−4 to 4 for a full step); `mag` is scaled so a full black-to-white step reads 1. |
| `Img.resize(img, w, h, method)` | `"nearest"` (keeps one pixel, aliases), `"bilinear"` (default; blends four, still aliases when shrinking a lot), `"area"` (averages every covered pixel: the antialiased way to shrink; same as bilinear when enlarging). |
| `Img.quantize(img, levels)` | Rounds each channel to `levels` evenly spaced values. |
| `Img.dither(img, levels = 2, o)` | `method`: "floyd" (Floyd-Steinberg error diffusion, default), "ordered" (8 × 8 Bayer), "random". `gray: true` dithers luma to gray levels; `serpentine: true` alternates row direction. Keeps the mean tone. |
| `Img.crop(img, x, y, w, h)`, `Img.get(img, x, y)` | A sub-image (edges repeat outside), and one pixel as `[r, g, b]`. |
| `Img.invert`, `Img.diff(a, b, { gain })`, `Img.stats(img)`, `Img.mse(a, b)`, `Img.psnr(a, b)` | Utilities. `stats` returns `{ mean: [r, g, b], luma, min, max }`; PSNR is in dB. |
| `Img.histogram(img, { bins: 256, channel: "luma", normalize })` | Counts per bin of tone. `channel`: "luma", "r", "g", "b", or "rgb" for `{ r, g, b }`. |
| `Img.equalize(img)` | Remaps luma through its cumulative histogram so every level is used about equally; colors keep their hue. |

### The JPEG idea

| call | |
|---|---|
| `Img.dct8(values)`, `Img.idct8(coefs)` | The orthonormal 8 × 8 DCT-II and its inverse on 64 values (index `y * 8 + x`; coefficient (u, v) at `v * 8 + u`). The round trip is exact to 1e-13. |
| `Img.block(img, bx, by)` | One 8 × 8 block of luma, 0 to 255, at block column `bx`, row `by`. Subtract 128 before `dct8`, as JPEG does. |
| `Img.fromBlock(values, scale = 255)` | 64 values back to an 8 × 8 gray image for `g.pixels`. |
| `Img.dctBasis(u, v)` | The (u, v) cosine pattern as an 8 × 8 gray image: draw all 64 for the classic grid. |
| `Img.QUANT_LUMA`, `Img.QUANT_CHROMA`, `Img.quantTable(quality, chroma)` | The standard's example tables (ITU T.81 Annex K), scaled for quality 1 to 100 the way libjpeg does (50 is the table itself). |
| `Img.ZIGZAG` | The 64 coefficient indexes in JPEG's zigzag order, low frequencies first. |
| `Img.jpeg(img, o)` | Compress and decompress: YCbCr, chroma at half resolution (`subsample: false` keeps it full), 8 × 8 DCT, quantize by `quality` [50] (or keep only the first `keep` zigzag coefficients), and back. Gray images code luma only. Returns `{ img, nonzero, total, ratio, psnr }`. Entropy coding is left out, so state ratios as "coefficients kept", not file size. |

## Drawing

| call | |
|---|---|
| `g.pixels(img, box, o)` | Each pixel becomes a cell of whole screen pixels, centered in `box`. `src: [x, y, w, h]` shows only that region (zoom). `fit`: "contain" (default) or "fill" (stretch); `cell` fixes px per pixel; `snap: false` allows fractional cells (useful when comparing images of different sizes at one display size). `grid` ["auto": at 12 px per pixel or more], `values` ["auto": 30 px for gray, 46 px for color, shown as 0 to 255; `format(v)` to change], `channel` (show one channel's values), `smooth` (bilinear display, for photos), `frame` [true], `mark: [x, y, w, h]` or a list of them (outlined in `markColor` ["orange"]), `label` (under the image), `alpha`, `align`, `valign`. Returns `{ box, cell, at(p) -> [x, y] or null, rect(x, y, w, h), center(x, y) }`. |
| `g.kernel(k, box, o)` | The weights in a grid, tinted `positive` ["blue"] and `negative` ["red"] by size. When every weight is a whole number over a common denominator it shows the whole numbers and "× 1/16" under the grid (`denominator` to force one, `note: false` to hide it). `highlight: [row, col]`, `label` (above), `cell`, `valign: "top"`, `values: false`. Returns `{ box, cell, denominator, hit(p) -> [row, col], center(row, col) }`. |
| `g.histogram(h, box, o)` | Bars from `Img.histogram`: one color [`"ink"`], or red, green, and blue overlaid for `{ r, g, b }`. `log`, `max` (fix the scale), `mark` (a tone 0 to 1, or a list), `markColor`, `ends` [["0", "255"]], `label`, `axis` [true]. Returns `{ box, x(tone), y(count), tone(px) }`. |

## Examples

### Zooming into pixels

Drag the orange window over the picture; at 4 pixels across, each cell shows its red, green, and blue values. Keep the last `g.pixels` result in a block variable so `drag` can map the pointer to a pixel.

```html
<p>Drag the <span class="c-orange">orange window</span>, and shrink it to <button class="set" data-set="n=4">4 pixels across</button> to read the numbers in each pixel.</p>
<figure class="demo" id="pixels" aria-label="A 128 by 128 country scene with an orange square on it, and the pixels inside the square enlarged with their values."></figure>
<script>
{
  const IM = Img.scene(128);
  let L = null;
  demo("pixels", {
    aspect: w => (w < 560 ? 0.6 : 1.9),
    state: () => ({ c: [40, 75] }),
    controls: [{ key: "n", label: "Window", min: 4, max: 32, step: 1, value: 10, format: n => `${n} × ${n} pixels`, color: "orange" }],
    drag: { hit: p => !!L?.at(p), move: (p, s) => { const q = L?.at(p); if (q) s.c = q; } },
    draw(g, s, v) {
      const narrow = g.w < 560, n = v.n;
      const x0 = clamp(Math.round(s.c[0] - n / 2), 0, 128 - n), y0 = clamp(Math.round(s.c[1] - n / 2), 0, 128 - n);
      L = g.pixels(IM, narrow ? [0, 0, g.w, g.h * 0.48] : [0, 0, g.w * 0.42, g.h], { mark: [x0, y0, n, n] });
      g.pixels(IM, narrow ? [0, g.h * 0.5, g.w, g.h * 0.5] : [g.w * 0.46, 0, g.w * 0.54, g.h], { src: [x0, y0, n, n] });
      const a = L.rect(x0, y0, n, n);
      g.handle([a[0] + a[2] / 2, a[1] + a[3] / 2], { color: "orange", r: 5 });
    },
  });
}
</script>
```

### A kernel, worked for one pixel

The neighbors, the weights, and the new value side by side, between the image before and after. These kernels are symmetric, so each weight sits over the neighbor it multiplies; for Sobel or emboss, say that convolution turns the kernel around first.

```html
<figure class="demo" id="kernel" aria-label="A gray picture with one pixel marked, its 3 by 3 neighbors with values, the kernel's weights, the new value, and the filtered picture."></figure>
<script>
{
  const IM = Img.gray(Img.scene(96));
  const KS = { blur: Img.kernels.box(3), gaussian: Img.kernels.binomial(3), sharpen: Img.kernels.sharpen(1) };
  let A = null;
  demo("kernel", {
    aspect: 2.25,
    state: () => ({ p: [30, 50] }),
    controls: [{ key: "k", label: "Kernel", type: "choice", options: [{ value: "blur", label: "Box blur" }, { value: "gaussian", label: "Gaussian" }, { value: "sharpen", label: "Sharpen" }], value: "sharpen" }],
    drag: { hit: p => !!A?.at(p), move: (p, s) => { const q = A?.at(p); if (q) s.p = [clamp(q[0], 1, 94), clamp(q[1], 1, 94)]; } },
    draw(g, s, v) {
      const k = KS[v.k], out = Img.convolve(IM, k), [px, py] = s.p, W = g.w * 0.26;
      A = g.pixels(IM, [0, 0, W - 6, g.h], { mark: [px - 1, py - 1, 3, 3], label: "before" });
      g.pixels(out, [g.w - W + 6, 0, W - 6, g.h], { mark: [px, py, 1, 1], label: "after" });
      const mid = g.w - 2 * W - 12, op = 22, cell = Math.floor(Math.min((mid - 2 * op) / 7, (g.h - 48) / 3));
      const x = W + 6 + (mid - 7 * cell - 2 * op) / 2, y = (g.h - 3 * cell) / 2 - 4;
      g.pixels(Img.crop(IM, px - 1, py - 1, 3, 3), [x, y, 3 * cell, 3 * cell], { values: true, mark: [1, 1, 1, 1] });
      g.text("×", [x + 3 * cell + op / 2, y + 1.5 * cell], { size: 18, color: "muted" });
      g.kernel(k, [x + 3 * cell + op, y, 3 * cell, 3 * cell + 20], { valign: "top" });
      g.text("=", [x + 6 * cell + 1.5 * op, y + 1.5 * cell], { size: 18, color: "muted" });
      g.pixels(Img.crop(out, px, py, 1, 1), [x + 6 * cell + 2 * op, y + cell, cell, cell], { values: true });
    },
  });
}
</script>
```

### JPEG quality

The 64 cosine patterns, each faded by how often it survives rounding at this quality, beside the decompressed photo and an enlarged crop where the 8 × 8 blocks show. The survival counts are computed with the same blocks, DCT, and table JPEG uses.

```html
<figure class="demo" id="jpeg" aria-label="The 64 cosine patterns of an 8 by 8 block, faded by how rarely each survives; the photo after JPEG compression and an enlarged crop."></figure>
<script>
{
  const IM = Img.scene(128), cache = new Map();
  const survival = q => {
    if (!cache.has(q)) {
      const t = Img.quantTable(q), keep = new Float32Array(64);
      for (let by = 0; by < 16; by++) for (let bx = 0; bx < 16; bx++) {
        const c = Img.dct8(Img.block(IM, bx, by).map(x => x - 128));
        for (let i = 0; i < 64; i++) if (Math.round(c[i] / t[i])) keep[i] += 1 / 256;
      }
      cache.set(q, keep);
    }
    return cache.get(q);
  };
  demo("jpeg", {
    aspect: 1.75,
    controls: [{ key: "q", label: "Quality", min: 1, max: 100, step: 1, value: 30, color: "blue" }],
    status(s, v) { const r = Img.jpeg(IM, { quality: v.q }); return `keeps ${(100 * r.ratio).toFixed(1)}% of the coefficients · ${r.psnr.toFixed(1)} dB`; },
    draw(g, s, v) {
      const keep = survival(v.q), r = Img.jpeg(IM, { quality: v.q }), side = Math.min(g.w * 0.4, g.h - 26), cell = side / 8;
      for (let vv = 0; vv < 8; vv++) for (let u = 0; u < 8; u++) {
        g.pixels(Img.dctBasis(u, vv), [u * cell + 1, vv * cell + 3, cell - 2, cell - 2], { frame: false, alpha: 0.12 + 0.88 * Math.min(1, keep[vv * 8 + u] * 4) });
      }
      const x = g.w * 0.43, w = (g.w - x) / 2 - 6;
      g.pixels(r.img, [x, 0, w, g.h], { label: "whole photo", mark: [24, 56, 24, 24] });
      g.pixels(r.img, [x + w + 12, 0, w, g.h], { src: [24, 56, 24, 24], label: "enlarged" });
    },
  });
}
</script>
```

## Pitfalls

- **Make test images once, outside `draw()`.** `const IM = Img.scene(128)` in the figure's block. Generators are cached too, but the block constant makes the intent plain.
- **`Img.map` isn't cached.** Its function could be anything. Keep its results in a `Map` keyed by the parameter, or every frame creates a new image (and a new canvas to draw it).
- **Stay at 128 × 128 for live sliders.** Every operation on 256 × 256 runs in 2 to 12 ms once warm, which is fine for a step but adds up across a figure that runs four operations per drag.
- **Show shrunk images at the original size.** Aliasing is only visible when the small image is enlarged back with crisp pixels: draw it into the same box with `snap: false`.
- **Signed results need a choice.** A Sobel or Laplacian result is mostly near zero with both signs. Use `{ abs: true }` for edge strength, or `{ scale: 1 / 8, offset: 0.5 }` so zero is mid-gray and say so in the caption.
- **Say what is left out.** `Img.jpeg` skips entropy coding; `Img.dither` works on display values, not linear light. Name the simplification in the caption once.
- **Embedded photos load asynchronously.** Draw a procedural stand-in until `Img.peek(url)` returns the image, and call `fig.redraw()` when `Img.fromDataURL` resolves. Keep embedded images small (under about 20 KB of base64).
