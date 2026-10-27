#!/usr/bin/env node
// Tests for src/tex.js: TeX to MathML for every supported construct, error
// handling, and the canvas layout (g.tex) against a fake 2D context.
//
// Usage: node tools/test-tex.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = { console };
vm.runInNewContext(await readFile(path.join(root, "src/tex.js"), "utf8"), { window: win, console });
const { toMathML } = win.SafisTeX;

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else { failed++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}
// Each case: TeX, then substrings the MathML must contain (in order).
function has(tex, ...parts) {
  const out = toMathML(tex);
  let at = 0;
  for (const p of parts) {
    const k = out.indexOf(p, at);
    if (k < 0) return check(tex, false, `missing ${JSON.stringify(p)} in ${out}`);
    at = k + p.length;
  }
  check(tex, !out.includes("tex-error"), out);
}
const errs = (tex, msg) => {
  const out = toMathML(tex);
  check(`error: ${tex}`, out.startsWith('<code class="tex-error"') && out.includes(msg.replace(/"/g, "&quot;")), out);
};

// Atoms
has("x", "<math", "<mi>x</mi>");
has("3.14", "<mn>3.14</mn>");
has("2x", "<mn>2</mn><mi>x</mi>");
has("a-b", "<mi>a</mi><mo>−</mo><mi>b</mi>");
has("a+b=c", "<mo>+</mo>", "<mo>=</mo>");
has("a<b", "<mo>&lt;</mo>");
has("a \\lt b \\gt c", "<mo>&lt;</mo>", "<mo>&gt;</mo>");
has("x \\le y \\ge z \\approx w \\ne v \\propto u", "≤", "≥", "≈", "≠", "∝");
has("a \\pm b \\times c \\cdot d \\div e", "±", "×", "⋅", "÷");
has("x \\to \\infty", "<mo>→</mo>", '<mi mathvariant="normal">∞</mi>');
has("\\partial f / \\partial x", "∂", '<mo lspace="0" rspace="0">/</mo>');
has("\\nabla \\cdot E", "∇");
has("f'(x) + f''(x)", '<mrow><mi>f</mi><mo lspace="0" rspace="0">\u2032</mo></mrow><mo stretchy="false">(</mo>', '<mo lspace="0" rspace="0">\u2033</mo>');
has("f'^2", '<msup><mrow><mi>f</mi><mo lspace="0" rspace="0">\u2032</mo></mrow><mn>2</mn></msup>');
// Greek
has("\\alpha + \\theta + \\omega", "<mi>α</mi>", "<mi>θ</mi>", "<mi>ω</mi>");
has("\\Delta x", '<mi mathvariant="normal">Δ</mi><mi>x</mi>');
has("\\varphi \\varepsilon", "<mi>φ</mi>", "<mi>ε</mi>");
// Scripts
has("x^2", "<msup><mi>x</mi><mn>2</mn></msup>");
has("x_0", "<msub><mi>x</mi><mn>0</mn></msub>");
has("x_i^2", "<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>");
has("x^{2n}", "<msup><mi>x</mi><mrow><mn>2</mn><mi>n</mi></mrow></msup>");
has("x^23", "<msup><mi>x</mi><mn>2</mn></msup><mn>3</mn>");
has("e^{-x^2}", "<msup><mi>e</mi><mrow><mo>−</mo><msup><mi>x</mi><mn>2</mn></msup></mrow></msup>");
has("{}^{14}C", "<msup><mrow></mrow><mn>14</mn></msup>");
// Fractions, roots
has("\\frac{a}{b}", "<mfrac><mi>a</mi><mi>b</mi></mfrac>");
has("\\frac12", "<mfrac><mn>1</mn><mn>2</mn></mfrac>");
has("\\dfrac{1}{2}", '<mfrac displaystyle="true">');
has("\\tfrac{1}{2}", '<mfrac displaystyle="false">');
has("\\binom{n}{k}", "(", '<mfrac linethickness="0">', ")");
has("\\sqrt{x}", "<msqrt><mi>x</mi></msqrt>");
has("\\sqrt[3]{x}", "<mroot><mi>x</mi><mn>3</mn></mroot>");
has("T = 2\\pi\\sqrt{\\frac{L}{g}}", "<mi>π</mi><msqrt><mfrac>");
// Fences
has("(a+b)", '<mo stretchy="false">(</mo>', '<mo stretchy="false">)</mo>');
has("\\left( \\frac{a}{b} \\right)", '<mo fence="true" form="prefix" stretchy="true" symmetric="true">(</mo>', "<mfrac>", 'form="postfix"');
has("\\left. \\frac{df}{dx} \\right|_{x=0}", "<msub><mrow><mfrac>", '<mo fence="true" form="postfix" stretchy="true" symmetric="true">|</mo>');
has("\\left\\{ x \\right\\}", ">{</mo>", ">}</mo>");
has("\\left\\langle \\psi \\middle| \\phi \\right\\rangle", "⟨", '<mo stretchy="true" symmetric="true">|</mo>', "⟩");
has("\\lfloor x \\rfloor + \\lceil y \\rceil", "⌊", "⌋", "⌈", "⌉");
has("\\big( x \\big)", 'minsize="1.2em"');
has("\\Bigl[ x \\Bigr]", 'minsize="1.8em"');
has("\\|v\\|", '<mo stretchy="false" lspace="0" rspace="0">\u2016</mo>');
has("|x|", '<mo stretchy="false" lspace="0" rspace="0">|</mo><mi>x</mi>');
// Functions and operators
has("\\sin x", "<mi>sin</mi><mo>⁡</mo><mspace width=\"0.1667em\"></mspace><mi>x</mi>");
has("\\sin(x)", "<mi>sin</mi><mo>⁡</mo><mo stretchy=\"false\">(</mo>");
has("\\sin^2\\theta + \\cos^2\\theta = 1", "<msup><mi>sin</mi><mn>2</mn></msup><mo>⁡</mo>", "<mi>cos</mi>");
has("\\log_2 n", "<msub><mi>log</mi><mn>2</mn></msub><mo>⁡</mo>");
has("\\ln x + \\exp(y)", "<mi>ln</mi>", "<mi>exp</mi>");
has("\\lim_{x \\to 0} \\frac{\\sin x}{x}", '<munder><mo form="prefix" movablelimits="true" lspace="0" rspace="0.1667em">lim</mo>', "→");
has("\\max_i x_i", "<munder><mo", ">max</mo>");
has("\\operatorname{softmax}(z)", "<mi>softmax</mi><mo>⁡</mo>");
has("\\operatorname*{arg\\,max}_x f", "<munder><mo", "arg max</mo>");
has("\\argmax_x f", "arg max</mo>");
has("\\sum_{i=1}^{n} i", "<munderover><mo>∑</mo>", "<mi>n</mi></munderover>");
has("\\prod_k a_k", "<munder><mo>∏</mo>");
has("\\int_0^1 x\\,dx", "<msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup>", '<mspace width="0.1667em">');
has("\\int\\limits_0^1 f", "<munderover><mo>∫</mo>");
has("\\sum\\nolimits_i x", "<msub><mo>∑</mo>");
has("\\oint_C \\vec{F} \\cdot d\\vec{r}", "<msub><mo>∮</mo><mi>C</mi></msub>");
has("\\iint f", "∬");
// Accents
has("\\vec{v}", '<mover accent="true"><mi>v</mi><mo stretchy="false" style="font-size:0.7em;transform:translateX(0.08em)">\u2192</mo></mover>');
has("\\vec{\\mathbf{F}}", '<mo stretchy="false" style="font-size:0.7em">\u2192</mo>');
has("\\hat{x} + \\bar{x} + \\dot{x} + \\ddot{x} + \\tilde{x}", "\u02c6", "\u00af", "\u02d9", "\u00a8", "\u02dc");
has("\\widehat{AB}", '<mo stretchy="true">\u0302</mo>');
has("\\overline{AB}", '<mo stretchy="true">‾</mo>');
has("\\overrightarrow{AB}", '<mrow class="tex-overarrow tex-arrow-r"><mrow><mi>A</mi><mi>B</mi></mrow></mrow>');
has("\\overleftarrow{AB} \\overleftrightarrow{AB}", "tex-arrow-l", "tex-arrow-lr");
has("\\underline{x}", '<munder accentunder="true">');
// Text and fonts
has("\\text{if } x > 0", "<mtext>if\u00a0</mtext>");
has("\\text{for all $x$}", "<mtext>for\u00a0all\u00a0</mtext><mi>x</mi>");
has("\\textbf{bold}", 'style="font-weight:bold"');
has("\\mathrm{d}x", '<mi mathvariant="normal">d</mi><mi>x</mi>');
has("9.8\\,\\mathrm{m/s^2}", "<mn>9.8</mn>", '<mi mathvariant="normal">m</mi>', "<mo lspace=\"0\" rspace=\"0\">/</mo>", '<msup><mi mathvariant="normal">s</mi><mn>2</mn></msup>');
has("\\mathrm{kg}", "<mi>kg</mi>");
has("\\mathrm{H_2O}", "<msub><mi mathvariant=\"normal\">H</mi><mn>2</mn></msub><mi mathvariant=\"normal\">O</mi>");
has("\\mathbf{F} = m\\mathbf{a}", "<mi>𝐅</mi>", "<mi>𝐚</mi>");
has("\\boldsymbol{\\omega}", "<mi>𝝎</mi>");
has("\\mathbb{R}^n", "<mi>ℝ</mi>");
has("\\mathcal{L}", "<mi>ℒ</mi>");
has("\\mathit{diff}", "<mi>𝑑𝑖𝑓𝑓</mi>");
// Spacing
has("a\\,b\\;c\\quad d\\qquad e", 'width="0.1667em"', 'width="0.2778em"', 'width="1em"', 'width="2em"');
has("a~b", 'width="0.3333em"');
// Environments
has("\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", '<mrow><mo fence="true" form="prefix" stretchy="true" symmetric="true">(</mo><mtable class="tex-matrix"><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr>');
has("\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}", ">[</mo>", ">]</mo>");
has("\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}", ">|</mo><mtable");
has("\\begin{matrix} a \\\\ b \\end{matrix}", '<mtable class="tex-matrix">');
has("|x| = \\begin{cases} x & \\text{if } x \\ge 0 \\\\ -x & \\text{otherwise} \\end{cases}", ">{</mo><mtable class=\"tex-cases\">", "<mtext>otherwise</mtext>");
has("\\begin{aligned} a &= b + c \\\\ &= d \\end{aligned}", '<mtable class="tex-aligned">', "<mtd><mrow><mrow></mrow><mo>=</mo>");
has("\\begin{array}{lr} a & b \\end{array}", '<mtd class="tex-left">', '<mtd class="tex-right">');
has("\\begin{smallmatrix} a & b \\end{smallmatrix}", "tex-matrix tex-small");
has("a &= b \\\\ c &= d", '<mtable class="tex-aligned">');
has("a = b \\\\ c = d", '<mtable class="tex-gathered">');
has("\\begin{pmatrix} a \\\\ b \\\\ \\end{pmatrix}", "<mtr><mtd><mi>b</mi></mtd></mtr></mtable>");
// Braces, boxes, colors
has("\\overbrace{a+b}^{n}", "<mover><mover>", '<mo stretchy="true">⏞</mo></mover><mi>n</mi></mover>');
has("\\underbrace{a+b}_{\\text{sum}}", "<munder><munder>", "⏟", "<mtext>sum</mtext></munder>");
has("\\boxed{E=mc^2}", '<mrow class="tex-boxed">');
has("\\cancel{x}", '<mrow class="tex-cancel">');
has("\\blue{v_0} t + \\tfrac12 \\red{a} t^2", '<mrow style="color:var(--blue)"><msub>', '<mrow style="color:var(--red)"><mi>a</mi>');
has("\\color{green}{x} + y", '<mrow style="color:var(--green)"><mi>x</mi></mrow><mo>+</mo>');
has("{\\color{purple} x + y} + z", '<mrow style="color:var(--purple)"><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow></mrow><mo>+</mo>');
has("\\textcolor{brass}{k}", "var(--brass)");
has("\\muted{x}", "var(--muted)");
has("\\phantom{x}", "<mphantom>");
has("\\displaystyle \\sum_i x", '<mrow displaystyle="true">');
// Arrows and chemistry
has("\\mathrm{N_2} + 3\\mathrm{H_2} \\rightleftharpoons 2\\mathrm{NH_3}", "⇌");
has("A \\xrightarrow{k} B", '<mrow class="tex-xarrow tex-arrow-r"><mtable><mtr><mtd><mrow class="tex-xarrow-label"><mi>k</mi></mrow></mtd></mtr><mtr><mtd><mphantom><mrow class="tex-xarrow-label"><mi>k</mi></mrow></mphantom></mtd></mtr></mtable></mrow>');
has("A \\xrightarrow[\\Delta]{\\text{cat}} B", "<mtext>cat</mtext></mrow></mtd></mtr><mtr><mtd><mrow class=\"tex-xarrow-label\">", "\u0394");
has("A \\xrightarrow[k]{} B", "<mphantom><mrow class=\"tex-xarrow-label\"><mi>k</mi></mrow></mphantom></mtd></mtr><mtr><mtd><mrow class=\"tex-xarrow-label\"><mi>k</mi>");
has("A \\xrightleftharpoons{} B \\xLeftarrow{} C \\xmapsto{f} D", "tex-arrow-eq", "tex-arrow-l2", "tex-arrow-map");
has("\\mathrm{Na^+} + \\mathrm{Cl^-}", "<msup><mi mathvariant=\"normal\">a</mi><mo>+</mo></msup>");
// Misc symbols
has("\\forall x \\exists y", "∀", "∃");
has("x \\in \\mathbb{N}", "∈", "ℕ");
has("a \\not= b", "<mo>≠</mo>");
has("a \\not\\in B", "∉");
has("1, 2, \\ldots, n", "…");
has("\\hbar \\omega", "ℏ");
has("90^\\circ", "<msup><mn>90</mn><mo>∘</mo></msup>");
has("50\\%", "%");
has("a \\bmod b", 'lspace="0.2222em"');
has("x \\pmod{n}", "<mi>mod</mi>");
has("x \\equiv y", "≡");
has("\\{1, 2\\}", ">{</mo>", ">}</mo>");
has("E = mc^2 \\tag{3}", "<mi>E</mi>");
// Display and alt text
{
  const out = toMathML("x^2", { display: true });
  check("display=block", out.startsWith('<math display="block" alttext="x^2">'), out);
  check("alttext escapes", toMathML("a<b").includes('alttext="a&lt;b"'));
}
// Errors render, never throw
errs("\\frac{a}", "missing argument");
errs("\\left( x", "\\left without a matching \\right");
errs("x \\right)", "\\right without a matching \\left");
errs("\\foo", "unknown command \\foo");
errs("x^2^3", "double superscript");
errs("x_1_2", "double subscript");
errs("{x", 'missing "}"');
errs("x}", 'unexpected "}"');
errs("\\begin{foo} x \\end{foo}", 'unknown environment "foo"');
errs("\\begin{pmatrix} a \\end{bmatrix}", "\\begin{pmatrix} ended by \\end{bmatrix}");
errs("\\sqrt[3{x}", 'missing "]"');
errs("a $ b", "\\$");
check("error never throws on garbage", (() => { try { toMathML("\\\\\\{{{^_^&&"); return true; } catch { return false; } })());

// Canvas: lay out every case with a fake context and check the boxes are sane.
{
  const calls = [];
  const ctx = {
    font: "16px serif", fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", letterSpacing: "0px",
    measureText(t) { const n = [...t].length, s = parseFloat(this.font.match(/([\d.]+)px/)[1]); return { width: n * s * 0.5, actualBoundingBoxAscent: s * 0.7, actualBoundingBoxDescent: /[gjpqy(),]/.test(t) ? s * 0.2 : 0 }; },
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() { calls.push("stroke"); }, fill() { calls.push("fill"); }, arc() {}, setLineDash() {},
    fillText(t) { calls.push(`text:${t}`); }, strokeText() { calls.push("halo"); },
  };
  const g = { ctx };
  const palette = { ink: "#111111", red: "#c0392b", blue: "#2b5fb4", panel: "#ffffff" };
  const util = { color: c => palette[c] ?? c, fontText: "sans-serif", fontSerif: "serif", fontMono: "monospace" };
  for (const ext of win.__safisG) ext(g, util);
  const cases = ["v_0", "\\theta", "\\frac{1}{2}mv^2", "x_i^2", "\\sqrt{x^2+y^2}", "\\sqrt[3]{x}", "\\vec{F} = m\\vec{a}", "\\hat{n}", "\\bar{x}", "\\dot{x}", "\\ddot{x}",
    "\\tilde{x}", "\\left(\\frac{a}{b}\\right)", "\\sum_{i=1}^n i", "\\int_0^1 f\\,dx", "\\lim_{x\\to0}", "\\sin\\theta", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
    "\\blue{v} + \\red{a}", "\\text{speed } v", "\\overbrace{a+b}^n", "\\underbrace{a}_b", "A \\xrightarrow{k} B", "\\mathrm{H_2O}", "\\boxed{x}", "\\cancel{x}",
    "|x|", "\\left\\{ x \\right\\}", "\\left\\langle x \\right\\rangle", "\\lfloor x \\rfloor", "\\begin{cases} 1 & x>0 \\\\ 0 & x \\le 0 \\end{cases}", "\\mathbf{v}", "\\mathbb{R}", "\\bad"];
  for (const c of cases) {
    calls.length = 0;
    let r;
    try { r = g.tex(c, [100, 100], { size: 16, halo: true }); } catch (e) { check(`canvas ${c}`, false, e.stack); continue; }
    check(`canvas ${c}`, r.w > 0 && r.h > 0 && Number.isFinite(r.w) && Number.isFinite(r.h) && calls.some(x => x.startsWith("text:") || x === "stroke"), JSON.stringify({ r, calls }));
  }
  calls.length = 0;
  g.tex("v_0", [0, 0]);
  check("canvas italic v", calls.includes("text:𝑣"), calls.join(" "));
  calls.length = 0;
  g.tex("\\Delta", [0, 0]);
  check("canvas upright Delta", calls.includes("text:Δ"), calls.join(" "));
  const m1 = g.measureTex("x"), m2 = g.measureTex("\\frac{x}{y}");
  check("measureTex fraction is taller", m2.h > m1.h, JSON.stringify({ m1, m2 }));
  const s1 = g.measureTex("x", { size: 10 }), s2 = g.measureTex("x", { size: 20 });
  check("measureTex scales with size", Math.abs(s2.w - 2 * s1.w) < 1e-6, JSON.stringify({ s1, s2 }));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
