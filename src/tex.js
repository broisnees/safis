/* TeX for explainer pages. A small TeX subset becomes MathML in prose
   (<span class="tex"> inline, <div class="tex"> display) and is drawn straight
   onto figure canvases with g.tex(). Reference: references/math.md in the skill. */
(() => {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const PALETTE = ["ink", "muted", "faint", "brass", "red", "orange", "green", "blue", "purple"];

  // ---------- symbols ----------
  const GREEK = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η",
    theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", varkappa: "ϰ", lambda: "λ", mu: "μ", nu: "ν",
    xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς",
    tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  };
  const GREEK_UP = { Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω" };
  const REL = {
    lt: "<", gt: ">", le: "≤", leq: "≤", ge: "≥", geq: "≥", leqslant: "⩽", geqslant: "⩾", ne: "≠", neq: "≠",
    approx: "≈", sim: "∼", simeq: "≃", cong: "≅", equiv: "≡", propto: "∝", ll: "≪", gg: "≫", asymp: "≍", doteq: "≐",
    to: "→", gets: "←", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐",
    Leftrightarrow: "⇔", implies: "⟹", impliedby: "⟸", iff: "⟺", mapsto: "↦", longrightarrow: "⟶",
    longleftarrow: "⟵", longleftrightarrow: "⟷", Longrightarrow: "⟹", Longleftarrow: "⟸", uparrow: "↑",
    downarrow: "↓", updownarrow: "↕", rightleftharpoons: "⇌", rightharpoonup: "⇀", leftharpoonup: "↼",
    in: "∈", notin: "∉", ni: "∋", subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇",
    parallel: "∥", perp: "⊥", mid: "∣", vdash: "⊢", colon: ":",
  };
  const BIN = {
    pm: "±", mp: "∓", times: "×", cdot: "⋅", div: "÷", ast: "∗", star: "⋆", circ: "∘", bullet: "∙",
    cup: "∪", cap: "∩", wedge: "∧", land: "∧", vee: "∨", lor: "∨", oplus: "⊕", ominus: "⊖", otimes: "⊗",
    odot: "⊙", setminus: "∖",
  };
  const ORD = {
    infty: "∞", partial: "∂", nabla: "∇", hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", wp: "℘",
    emptyset: "∅", varnothing: "∅", forall: "∀", exists: "∃", nexists: "∄", neg: "¬", lnot: "¬",
    angle: "∠", triangle: "△", square: "□", Box: "□", degree: "°", prime: "′", ldots: "…", dots: "…",
    cdots: "⋯", vdots: "⋮", ddots: "⋱", top: "⊤", bot: "⊥", dagger: "†", ddagger: "‡", S: "§", P: "¶",
    "#": "#", "%": "%", "&": "&", $: "$", _: "_",
  };
  const OPEN = { langle: "⟨", lfloor: "⌊", lceil: "⌈", lbrace: "{", lbrack: "[", lvert: "|", lVert: "‖", "{": "{" };
  const CLOSE = { rangle: "⟩", rfloor: "⌋", rceil: "⌉", rbrace: "}", rbrack: "]", rvert: "|", rVert: "‖", "}": "}" };
  const DELIM = {
    "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", "/": "/", "<": "⟨", ">": "⟩", ".": "",
    "\\{": "{", "\\}": "}", "\\|": "‖", "\\vert": "|", "\\Vert": "‖", "\\uparrow": "↑", "\\downarrow": "↓",
  };
  for (const [k, v] of Object.entries({ ...OPEN, ...CLOSE })) DELIM["\\" + k] = v;
  const BIGOP = { sum: "∑", prod: "∏", coprod: "∐", bigcup: "⋃", bigcap: "⋂", bigvee: "⋁", bigwedge: "⋀", bigoplus: "⨁", bigotimes: "⨂", int: "∫", iint: "∬", iiint: "∭", oint: "∮" };
  const INTEGRAL = new Set(["∫", "∬", "∭", "∮"]);
  const FN = new Set("sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh coth log ln lg exp deg dim ker hom arg sgn".split(" "));
  const LIMOP = { lim: "lim", liminf: "lim inf", limsup: "lim sup", max: "max", min: "min", sup: "sup", inf: "inf", det: "det", gcd: "gcd", Pr: "Pr", argmax: "arg max", argmin: "arg min" };
  const ACCENT = {
    // Spacing accents (U+02C6 and friends) center over the letter; combining ones drift left.
    vec: ["→", false], hat: ["ˆ", false], widehat: ["\u0302", true], bar: ["\u00af", false],
    overline: ["\u203e", true], dot: ["\u02d9", false], ddot: ["\u00a8", false], tilde: ["\u02dc", false],
    widetilde: ["\u02dc", false], check: ["ˇ", false], breve: ["\u02d8", false], acute: ["\u00b4", false],
    grave: ["`", false], overrightarrow: ["→", true], overleftarrow: ["←", true], overleftrightarrow: ["↔", true],
  };
  const BRACE = {
    overbrace: ["⏞", true], underbrace: ["⏟", false], overparen: ["⏜", true], underparen: ["⏝", false],
    overbracket: ["⎴", true], underbracket: ["⎵", false],
  };
  const ARROW_CLASS = { "→": "r", "←": "l", "↔": "lr", "⇌": "eq", "↦": "map", "⇒": "r2", "⇐": "l2" };
  const OVERARROW = { overrightarrow: "r", overleftarrow: "l", overleftrightarrow: "lr" };
  const XARROW = { xrightarrow: "→", xleftarrow: "←", xRightarrow: "⇒", xLeftarrow: "⇐", xleftrightarrow: "↔", xrightleftharpoons: "⇌", xmapsto: "↦" };
  const SPACE = { ",": 3 / 18, ":": 4 / 18, ">": 4 / 18, ";": 5 / 18, " ": 6 / 18, "!": -3 / 18, quad: 1, qquad: 2, enspace: 0.5, thinspace: 3 / 18, medspace: 4 / 18, thickspace: 5 / 18 };
  const VARIANT = {
    mathrm: "normal", mathup: "normal", mathsf: "normal", mathtt: "normal", mathit: "italic", mathbf: "bold",
    boldsymbol: "bolditalic", bm: "bolditalic", mathcal: "script", mathscr: "script", mathbb: "double",
  };
  const TEXT = { text: null, textrm: null, textup: null, textnormal: null, mbox: null, hbox: null, textit: "it", textbf: "bf", textsf: null, texttt: null };
  const BIG = { big: 1.2, Big: 1.8, bigg: 2.4, Bigg: 3 };
  const ENV = {
    matrix: [null, null], smallmatrix: [null, null], pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"],
    vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], cases: ["{", null], rcases: [null, "}"], array: [null, null],
    aligned: [null, null], align: [null, null], "align*": [null, null], split: [null, null],
    gathered: [null, null], gather: [null, null], "gather*": [null, null],
  };
  const NEGATE = { "=": "≠", "<": "≮", ">": "≯", "≤": "≰", "≥": "≱", "∈": "∉", "⊂": "⊄", "⊆": "⊈", "≡": "≢", "∼": "≁", "≈": "≉", "∃": "∄" };

  const RELCH = new Set([..."=<>:", ...Object.values(REL)]);
  const BINCH = new Set([..."+−∗", ...Object.values(BIN)]);

  // ---------- math alphanumerics (U+1D400 block, plus letters that live elsewhere) ----------
  const HOLES = {
    italic: { h: 0x210e },
    script: { B: 0x212c, E: 0x2130, F: 0x2131, H: 0x210b, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211b, e: 0x212f, g: 0x210a, o: 0x2134 },
    double: { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 },
  };
  const LATIN = { bold: 0x1d400, italic: 0x1d434, bolditalic: 0x1d468, script: 0x1d49c, double: 0x1d538 };
  const DIGIT = { bold: 0x1d7ce, double: 0x1d7d8 };
  const GREEK_AT = { italic: [0x1d6e2, 0x1d6fc], bolditalic: [0x1d71c, 0x1d736] }; // capital Alpha, small alpha
  const GREEK_EXTRA = { 0x2202: 25, 0x3f5: 26, 0x3d1: 27, 0x3f0: 28, 0x3d5: 29, 0x3f1: 30, 0x3d6: 31 };
  function styleChar(ch, variant) {
    const c = ch.codePointAt(0);
    const hole = HOLES[variant]?.[ch];
    if (hole) return String.fromCodePoint(hole);
    const L = LATIN[variant];
    if (L != null && c >= 65 && c <= 90) return String.fromCodePoint(L + c - 65);
    if (L != null && c >= 97 && c <= 122) return String.fromCodePoint(L + 26 + c - 97);
    const D = DIGIT[variant];
    if (D != null && c >= 48 && c <= 57) return String.fromCodePoint(D + c - 48);
    const G = GREEK_AT[variant];
    if (G) {
      if (c >= 0x391 && c <= 0x3a9) return String.fromCodePoint(G[0] + c - 0x391);
      if (c >= 0x3b1 && c <= 0x3c9) return String.fromCodePoint(G[1] + c - 0x3b1);
      if (c === 0x2207) return String.fromCodePoint(G[0] + 25);
      if (c in GREEK_EXTRA) return String.fromCodePoint(G[1] + GREEK_EXTRA[c]);
    }
    return ch;
  }
  const styleText = (s, variant) => [...s].map(ch => styleChar(ch, variant)).join("");
  // Letters a single-letter <mi> would italicize (MathML's math-auto), so the canvas matches.
  const autoItalic = ch => /^[A-Za-zα-ωϑϕϖϰϱϵ]$/u.test(ch);

  // ---------- parser: TeX source -> tree ----------
  class TexError extends Error {}
  const fail = msg => { throw new TexError(msg); };
  const row = c => ({ t: "row", c });

  function parse(src) {
    const s = String(src);
    let i = 0;
    let tag = null;
    const CMD = /\\([A-Za-z]+\*?|[^A-Za-z])/y;

    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const peekName = () => { CMD.lastIndex = i; const m = CMD.exec(s); return m ? m[1] : null; };
    const readName = () => {
      CMD.lastIndex = i;
      const m = CMD.exec(s);
      i = CMD.lastIndex;
      if (/^[A-Za-z]/.test(m[1])) ws();
      return m[1];
    };
    const close = () => { ws(); if (s[i] !== "}") fail(i < s.length ? `expected "}" but found "${s[i]}"` : 'missing "}"'); i++; };

    // The raw text of a {...} group, braces balanced.
    function raw() {
      ws();
      if (s[i] !== "{") fail("expected {");
      let depth = 0;
      const start = i + 1;
      for (; i < s.length; i++) {
        if (s[i] === "\\") { i++; continue; }
        if (s[i] === "{") depth++;
        else if (s[i] === "}" && --depth === 0) { i++; return s.slice(start, i - 1); }
      }
      fail('missing "}"');
    }
    // An optional [...] argument, parsed as math.
    function optional() {
      ws();
      if (s[i] !== "[") return null;
      let depth = 0;
      const start = i + 1;
      for (i++; i < s.length; i++) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") depth--;
        else if (s[i] === "]" && depth === 0) { i++; return parse(s.slice(start, i - 1)).node; }
      }
      fail('missing "]"');
    }

    function argument() {
      ws();
      if (i >= s.length || s[i] === "}" || s[i] === "&") fail("missing argument");
      if (s[i] === "{") { i++; const c = expr(); close(); return row(c); }
      // A single token: TeX reads x^23 as x^{2}3.
      if (/\d/.test(s[i])) return { t: "mn", v: s[i++] };
      return atom() ?? row([]);
    }

    function expr() {
      const list = [];
      for (;;) {
        ws();
        if (i >= s.length) break;
        const ch = s[i];
        if (ch === "}" || ch === "&") break;
        if (ch === "\\") {
          const name = peekName();
          if (name === "\\" || name === "right" || name === "end" || name === "cr") break;
        }
        if (ch === "^" || ch === "_") {
          i++;
          const base = list.pop() ?? row([]);
          list.push(attach(base, ch === "^" ? "sup" : "sub", argument()));
          continue;
        }
        if (ch === "'") {
          // Primes sit beside the letter (the font draws them raised), so f'^2 puts the 2 after the prime.
          let n = 0;
          while (s[i] === "'") { n++; i++; }
          const base = list.pop() ?? row([]);
          list.push(row([base, { t: "mo", v: ["′", "″", "‴"][Math.min(n, 3) - 1], cls: "ord" }]));
          continue;
        }
        const node = atom(list);
        if (node) list.push(node);
      }
      return list;
    }

    function attach(base, slot, arg) {
      if (base.t === "brace" && (slot === "sup") === base.over) return { t: "limit", base, [slot]: arg };
      if (base.t === "scripts") {
        if (!base[slot]) return { ...base, [slot]: arg };
        fail(slot === "sup" ? "double superscript" : "double subscript");
      }
      return { t: "scripts", base, [slot]: arg, limits: !!base.limits };
    }

    function limitsFlag(node) {
      ws();
      const name = peekName();
      if (name === "limits" || name === "nolimits") { readName(); node.limits = name === "limits"; }
      return node;
    }

    function delimiter() {
      ws();
      let key = s[i];
      if (key === "\\") { CMD.lastIndex = i; key = "\\" + CMD.exec(s)[1]; }
      if (!(key in DELIM)) fail(`"${key ?? "end"}" isn't a delimiter`);
      i += key.length;
      if (/^\\[A-Za-z]/.test(key)) ws();
      return DELIM[key];
    }

    function variant(node, v) {
      const walk = n => {
        if (n.t === "mi") return { ...n, variant: v, normal: false };
        if (n.t === "mn") return v === "bold" || v === "double" ? { ...n, variant: v } : n;
        if (n.t === "row") {
          const c = [];
          for (const k of n.c.map(walk)) {
            const last = c[c.length - 1];
            // \mathrm{kg} is one word, not k times g.
            if (k.t === "mi" && last && last.t === "mi") c[c.length - 1] = { ...last, v: last.v + k.v };
            else c.push(k);
          }
          return { ...n, c };
        }
        if (n.t === "scripts") return { ...n, base: walk(n.base) };
        if (n.t === "color" || n.t === "style") return { ...n, body: walk(n.body) };
        return n;
      };
      return walk(node);
    }

    function text(style) {
      const body = raw();
      const parts = [];
      // Math inside text: \text{for all $x$}.
      body.split(/(\$[^$]*\$)/).forEach(p => {
        if (!p) return;
        if (p.startsWith("$") && p.endsWith("$") && p.length > 1) parts.push(parse(p.slice(1, -1)).node);
        else parts.push({ t: "text", v: p.replace(/\\([{}$%&#_ ])/g, "$1").replace(/~/g, "\u00a0"), style });
      });
      return parts.length === 1 ? parts[0] : row(parts);
    }

    function environment(name) {
      if (!(name in ENV)) fail(`unknown environment "${name}"`);
      let cols = null;
      if (name === "array") cols = raw().replace(/[^lcr]/g, "").split("");
      const rows = table();
      ws();
      if (peekName() !== "end") fail(`missing \\end{${name}}`);
      readName();
      const end = raw();
      if (end !== name) fail(`\\begin{${name}} ended by \\end{${end}}`);
      const kind = name.startsWith("align") || name === "split" ? "aligned"
        : name.startsWith("gather") ? "gathered"
        : name.endsWith("cases") ? "cases"
        : name === "array" ? "array" : name === "smallmatrix" ? "smallmatrix" : "matrix";
      const [open, close] = ENV[name];
      return { t: "table", rows, kind, cols, open, close };
    }

    function table() {
      const rows = [[]];
      for (;;) {
        rows[rows.length - 1].push(row(expr()));
        ws();
        if (s[i] === "&") { i++; continue; }
        const name = peekName();
        if (name === "\\" || name === "cr") {
          readName();
          if (s[i] === "[") optional();
          rows.push([]);
          continue;
        }
        break;
      }
      const last = rows[rows.length - 1];
      if (rows.length > 1 && last.length === 1 && !last[0].c.length) rows.pop();
      return rows;
    }

    function atom() {
      const ch = s[i];
      if (ch === "{") { i++; const c = expr(); close(); return row(c); }
      const num = /\d+(?:\.\d+)?|\.\d+/y;
      num.lastIndex = i;
      const m = num.exec(s);
      if (m) { i += m[0].length; return { t: "mn", v: m[0] }; }
      if (ch === "\\") return command();
      const cp = s.codePointAt(i), c = String.fromCodePoint(cp);
      i += c.length;
      if (c === "~") return { t: "space", w: 6 / 18 };
      if (c === "-") return { t: "mo", v: "−", cls: "bin" };
      if (c === "*") return { t: "mo", v: "∗", cls: "bin" };
      if (c === "(" || c === "[") return { t: "mo", v: c, cls: "open" };
      if (c === ")" || c === "]") return { t: "mo", v: c, cls: "close" };
      if (c === "|") return { t: "mo", v: "|", cls: "ord", fence: true };
      if (c === "," || c === ";") return { t: "mo", v: c, cls: "punct" };
      if (c === "!" || c === "?") return { t: "mo", v: c, cls: "close" };
      if (c === "/" || c === ".") return { t: "mo", v: c, cls: "ord" };
      if (RELCH.has(c)) return { t: "mo", v: c, cls: "rel" };
      if (BINCH.has(c)) return { t: "mo", v: c, cls: "bin" };
      if (/\p{L}/u.test(c)) return { t: "mi", v: c };
      if (/\p{N}/u.test(c)) return { t: "mn", v: c };
      if (c === "$" || c === "#") fail(`"${c}" has to be written \\${c}`);
      return { t: "mo", v: c, cls: "ord" };
    }

    function command() {
      const name = readName();
      if (name in GREEK) return { t: "mi", v: GREEK[name] };
      if (name in GREEK_UP) return { t: "mi", v: GREEK_UP[name], normal: true };
      if (name in REL) return { t: "mo", v: REL[name], cls: "rel" };
      if (name in BIN) return { t: "mo", v: BIN[name], cls: "bin" };
      if (name in ORD) return { t: "mi", v: ORD[name], normal: true };
      if (name in OPEN) return { t: "mo", v: OPEN[name], cls: "open" };
      if (name in CLOSE) return { t: "mo", v: CLOSE[name], cls: "close" };
      if (name in SPACE) return { t: "space", w: SPACE[name] };
      if (name === "|" || name === "Vert" || name === "vert") return { t: "mo", v: name === "vert" ? "|" : "‖", cls: "ord", fence: true };
      if (name in BIGOP) return limitsFlag({ t: "mo", v: BIGOP[name], cls: "op", large: true, limits: !INTEGRAL.has(BIGOP[name]) });
      if (FN.has(name)) return { t: "fn", v: name };
      if (name in LIMOP) return limitsFlag({ t: "fn", v: LIMOP[name], limits: true });
      if (name === "operatorname" || name === "operatorname*") return limitsFlag({ t: "fn", v: raw().replace(/\\,|\\ |~/g, " ").trim(), limits: name.endsWith("*") });
      if (name in VARIANT) return variant(argument(), VARIANT[name]);
      if (name in TEXT) return text(TEXT[name]);
      if (name in ACCENT) { const [ch, stretchy] = ACCENT[name]; return { t: "accent", body: argument(), ch, stretchy, kind: name }; }
      if (name === "underline") return { t: "underline", body: argument() };
      if (name in BRACE) { const [ch, over] = BRACE[name]; return { t: "brace", body: argument(), ch, over, kind: name }; }
      if (name in XARROW) { const below = optional(); return { t: "xarrow", ch: XARROW[name], below, above: argument() }; }
      switch (name) {
        case "frac": case "dfrac": case "tfrac": case "cfrac":
          return { t: "frac", num: argument(), den: argument(), style: name === "dfrac" || name === "cfrac" ? "display" : name === "tfrac" ? "text" : null };
        case "binom": case "dbinom": case "tbinom":
          return { t: "fence", open: "(", close: ")", body: { t: "frac", num: argument(), den: argument(), thin: true, style: name === "dbinom" ? "display" : name === "tbinom" ? "text" : null } };
        case "sqrt": { const index = optional(); return { t: "sqrt", index, body: argument() }; }
        case "left": {
          const open = delimiter();
          const body = row(expr());
          if (peekName() !== "right") fail("\\left without a matching \\right");
          readName();
          return { t: "fence", open, close: delimiter(), body, left: true };
        }
        case "right": fail("\\right without a matching \\left"); break;
        case "middle": return { t: "mo", v: delimiter(), cls: "rel", stretchy: true };
        case "color": case "textcolor": {
          const c = raw().trim();
          ws();
          const body = name === "textcolor" || s[i] === "{" ? argument() : row(expr());
          return { t: "color", c, body };
        }
        case "displaystyle": case "textstyle": return { t: "style", display: name === "displaystyle", body: row(expr()) };
        case "boxed": return { t: "box", body: argument() };
        case "cancel": case "bcancel": case "xcancel": return { t: "cancel", body: argument(), kind: name };
        case "phantom": case "hphantom": case "vphantom": return { t: "phantom", body: argument() };
        case "begin": return environment(raw().trim());
        case "end": fail("\\end without a matching \\begin"); break;
        case "not": {
          ws();
          const n = atom();
          if (!n || (n.t !== "mo" && n.t !== "mi")) fail("\\not needs a symbol after it");
          return { t: "mo", v: NEGATE[n.v] ?? n.v + "\u0338", cls: "rel" };
        }
        case "tag": case "tag*": tag = raw().trim(); return null;
        case "label": case "nonumber": case "notag": if (name === "label") raw(); return null;
        case "limits": case "nolimits": return null;
        case "bmod": case "mod": return { t: "mo", v: "mod", cls: "bin" };
        case "pmod": return row([{ t: "space", w: 1 }, { t: "fence", open: "(", close: ")", body: row([{ t: "mi", v: "mod", normal: true }, { t: "space", w: 6 / 18 }, argument()]) }]);
        case "\\": fail("\\\\ (new line) only works between rows of an equation or environment"); break;
        case "{": case "}": return { t: "mo", v: name, cls: name === "{" ? "open" : "close" };
      }
      if (name in BIG || /^(big|Big|bigg|Bigg)[lrm]$/.test(name)) {
        const size = BIG[name.replace(/[lrm]$/, "")];
        const v = delimiter();
        const cls = name.endsWith("l") ? "open" : name.endsWith("r") ? "close" : name.endsWith("m") ? "rel" : "ord";
        return { t: "mo", v, cls, size };
      }
      if (PALETTE.includes(name)) return { t: "color", c: name, body: argument() };
      fail(`unknown command \\${name}`);
    }

    const rows = table();
    ws();
    if (i < s.length) {
      const name = peekName();
      fail(name === "right" ? "\\right without a matching \\left" : name === "end" ? "\\end without a matching \\begin" : `unexpected "${s[i]}"`);
    }
    let node;
    if (rows.length === 1 && rows[0].length === 1) node = rows[0][0];
    else node = { t: "table", rows, kind: rows.some(r => r.length > 1) ? "aligned" : "gathered", open: null, close: null };
    return { node, tag };
  }

  const cache = new Map();
  function parsed(src) {
    let r = cache.get(src);
    if (!r) {
      try { r = parse(src); } catch (e) { if (!(e instanceof TexError)) throw e; r = { error: e.message }; }
      if (cache.size > 500) cache.clear();
      cache.set(src, r);
    }
    return r;
  }

  // ---------- MathML ----------
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cssColor = c => (PALETTE.includes(c) ? `var(--${c})` : /^#[0-9a-f]{3,8}$/i.test(c) || /^[a-z]+$/i.test(c) ? c : "inherit");
  const isOpen = n => n && ((n.t === "mo" && n.cls === "open") || (n.t === "fence" && n.open));
  const appliesFn = n => n && (n.t === "fn" && !n.limits || (n.t === "scripts" && n.base.t === "fn" && !n.base.limits));
  const mrow = items => (items.length === 1 ? items[0] : `<mrow>${items.join("")}</mrow>`);

  function ml(n) {
    switch (n.t) {
      case "mi": {
        const v = n.variant && n.variant !== "normal" ? styleText(n.v, n.variant) : n.v;
        const upright = (n.normal || n.variant === "normal") && [...v].length === 1;
        return `<mi${upright ? ' mathvariant="normal"' : ""}>${esc(v)}</mi>`;
      }
      case "mn": return `<mn>${esc(n.variant ? styleText(n.v, n.variant) : n.v)}</mn>`;
      case "mo": {
        let a = "";
        if (n.size) a = ` stretchy="true" symmetric="true" minsize="${n.size}em" maxsize="${n.size}em"`;
        else if (n.stretchy) a = ' stretchy="true" symmetric="true"';
        else if (n.cls === "open" || n.cls === "close" || n.fence) a = ' stretchy="false"';
        // Ordinary symbols (| / . ′) take no operator spacing, as in TeX.
        if (n.cls === "ord" && !n.size && !n.stretchy) a += ' lspace="0" rspace="0"';
        if (n.v === "mod") a += ' lspace="0.2222em" rspace="0.2222em"';
        return `<mo${a}>${esc(n.v)}</mo>`;
      }
      case "fn":
        return n.limits
          ? `<mo form="prefix" movablelimits="true" lspace="0" rspace="0.1667em">${esc(n.v)}</mo>`
          : `<mi>${esc(n.v)}</mi>`;
      case "space": return n.w > 0 ? `<mspace width="${+n.w.toFixed(4)}em"></mspace>` : "";
      case "text": {
        const st = n.style === "it" ? ' style="font-style:italic"' : n.style === "bf" ? ' style="font-weight:bold"' : "";
        // Spaces at the edges of <mtext> collapse; non-breaking ones keep "if x" apart.
        return `<mtext${st}>${esc(n.v.replace(/ /g, "\u00a0"))}</mtext>`;
      }
      case "row": {
        const out = [];
        n.c.forEach((k, j) => {
          out.push(ml(k));
          // sin x: the invisible function application, and TeX's thin space unless a bracket follows.
          if (appliesFn(k)) out.push(`<mo>\u2061</mo>${isOpen(n.c[j + 1]) || !n.c[j + 1] ? "" : '<mspace width="0.1667em"></mspace>'}`);
        });
        return out.length === 1 ? out[0] : `<mrow>${out.join("")}</mrow>`;
      }
      case "scripts": {
        const b = ml(n.base), sub = n.sub && ml(n.sub), sup = n.sup && ml(n.sup);
        if (n.limits) {
          if (sub && sup) return `<munderover>${b}${sub}${sup}</munderover>`;
          return sub ? `<munder>${b}${sub}</munder>` : `<mover>${b}${sup}</mover>`;
        }
        if (sub && sup) return `<msubsup>${b}${sub}${sup}</msubsup>`;
        return sub ? `<msub>${b}${sub}</msub>` : `<msup>${b}${sup}</msup>`;
      }
      case "limit": {
        const b = ml(n.base);
        return n.sup ? `<mover>${b}${ml(n.sup)}</mover>` : `<munder>${b}${ml(n.sub)}</munder>`;
      }
      case "frac": {
        const a = (n.thin ? ' linethickness="0"' : "") + (n.style === "display" ? ' displaystyle="true"' : n.style === "text" ? ' displaystyle="false"' : "");
        return `<mfrac${a}>${ml(n.num)}${ml(n.den)}</mfrac>`;
      }
      case "sqrt": return n.index ? `<mroot>${ml(n.body)}${ml(n.index)}</mroot>` : `<msqrt>${ml(n.body)}</msqrt>`;
      case "fence": {
        const f = (ch, form) => (ch ? `<mo fence="true" form="${form}" stretchy="true" symmetric="true">${esc(ch)}</mo>` : "");
        return `<mrow>${f(n.open, "prefix")}${ml(n.body)}${f(n.close, "postfix")}</mrow>`;
      }
      case "accent": {
        if (n.kind in OVERARROW) return `<mrow class="tex-overarrow tex-arrow-${OVERARROW[n.kind]}">${ml(n.body)}</mrow>`;
        // \vec: a script-sized arrow, nudged right over a slanted letter.
        const b = n.body.t === "row" && n.body.c.length === 1 ? n.body.c[0] : n.body;
        const italic = b.t === "mi" && !b.normal && !b.variant && [...b.v].length === 1 && autoItalic(b.v);
        const st = n.kind === "vec" ? ` style="font-size:0.7em${italic ? ";transform:translateX(0.08em)" : ""}"` : "";
        return `<mover accent="true">${ml(n.body)}<mo stretchy="${n.stretchy}"${st}>${n.ch}</mo></mover>`;
      }
      case "underline": return `<munder accentunder="true">${ml(n.body)}<mo stretchy="true">\u203e</mo></munder>`;
      case "brace": {
        const el = n.over ? "mover" : "munder";
        return `<${el}>${ml(n.body)}<mo stretchy="true">${n.ch}</mo></${el}>`;
      }
      case "xarrow": {
        // Chrome won't stretch an arrow to its labels, so tex.css draws the arrow with
        // gradients across a two-row table; the table centers on the math axis.
        const label = x => `<mrow class="tex-xarrow-label">${ml(x)}</mrow>`;
        const empty = x => !x || (x.t === "row" && !x.c.length);
        const above = empty(n.above) && !empty(n.below) ? `<mphantom>${label(n.below)}</mphantom>` : label(n.above);
        const below = empty(n.below) ? `<mphantom>${above}</mphantom>` : label(n.below);
        return `<mrow class="tex-xarrow tex-arrow-${ARROW_CLASS[n.ch]}"><mtable><mtr><mtd>${above}</mtd></mtr><mtr><mtd>${below}</mtd></mtr></mtable></mrow>`;
      }
      case "color": return `<mrow style="color:${cssColor(n.c)}">${ml(n.body)}</mrow>`;
      case "style": return `<mrow displaystyle="${n.display}">${ml(n.body)}</mrow>`;
      case "box": return `<mrow class="tex-boxed">${ml(n.body)}</mrow>`;
      case "cancel": return `<mrow class="tex-${n.kind}">${ml(n.body)}</mrow>`;
      case "phantom": return `<mphantom>${ml(n.body)}</mphantom>`;
      case "table": {
        const kind = n.kind === "smallmatrix" ? "matrix tex-small" : n.kind;
        const align = n.cols ? n.cols : null;
        const body = n.rows.map(r => `<mtr>${r.map((cell, j) => {
          let c = cell;
          // "&= b": the relation after & spaces like it follows something, as TeX's {} = would.
          if (n.kind === "aligned" && j % 2 === 1 && c.c.length && c.c[0].t === "mo") c = row([row([]), ...c.c]);
          const al = align && align[j] ? ` class="tex-${{ l: "left", c: "center", r: "right" }[align[j]]}"` : "";
          return `<mtd${al}>${ml(c)}</mtd>`;
        }).join("")}</mtr>`).join("");
        const t = `<mtable class="tex-${kind}">${body}</mtable>`;
        if (!n.open && !n.close) return t;
        const f = (ch, form) => (ch ? `<mo fence="true" form="${form}" stretchy="true" symmetric="true">${esc(ch)}</mo>` : "");
        return `<mrow>${f(n.open, "prefix")}${t}${f(n.close, "postfix")}</mrow>`;
      }
    }
    return "";
  }

  function convert(src, display) {
    const r = parsed(String(src).trim());
    const alt = esc(String(src).replace(/\s+/g, " ").trim());
    if (r.error) return { error: r.error, html: `<code class="tex-error" title="TeX error: ${esc(r.error)}">${esc(src)}</code>` };
    return { tag: r.tag, html: `<math${display ? ' display="block"' : ""} alttext="${alt}">${ml(r.node)}</math>` };
  }

  const toMathML = (src, o = {}) => convert(src, !!o.display).html;

  function typeset(root = W.document?.body) {
    if (!root || !root.querySelectorAll) return 0;
    const els = [...(root.matches?.(".tex") ? [root] : []), ...root.querySelectorAll(".tex")];
    let n = 0;
    for (const el of els) {
      if (el.hasAttribute("data-tex")) continue;
      const src = el.textContent.trim();
      const display = el.classList.contains("display") || el.tagName === "DIV" || el.tagName === "P";
      const r = convert(src, display);
      el.setAttribute("data-tex", src);
      if (r.tag) el.setAttribute("data-number", r.tag);
      // Display math scrolls inside its own box, so an equation number beside it stays put.
      el.innerHTML = display && !r.error ? `<span class="tex-scroll">${r.html}</span>` : r.html;
      if (r.error) {
        errors.push({ src, message: r.error });
        console.error(`[tex] ${r.error} in "${src}"`);
      }
      n++;
    }
    if (n) trimRadicals(root);
    return n;
  }
  const errors = [];

  // Chrome leaves about 0.45em of empty space after <msqrt> and <mroot>. Measure
  // it and pull the next symbol back in; browsers without the gap are left alone.
  function trimRadicals(root) {
    const fix = () => {
      for (const m of root.querySelectorAll(".tex msqrt, .tex mroot")) {
        m.style.marginInlineEnd = "";
        const base = m.tagName === "mroot" ? [m.firstElementChild] : [...m.children];
        const right = Math.max(...base.filter(Boolean).map(c => c.getBoundingClientRect().right));
        const em = parseFloat(getComputedStyle(m).fontSize) || 16;
        const gap = (m.getBoundingClientRect().right - right) / em;
        if (gap > 0.15) m.style.marginInlineEnd = `${-(gap - 0.08).toFixed(3)}em`;
      }
    };
    fix();
    W.document?.fonts?.ready?.then(fix);
  }

  // ---------- canvas: tree -> boxes ----------
  // Sizes in px; em = the current font size. Constants follow the STIX Two Math font.
  const AXIS = 0.258, RULE = 0.066, SCALE = [1, 0.7, 0.5];
  const MU = 1 / 18;
  // TeX's inter-atom spacing in mu (thin 3, medium 4, thick 5), text style.
  const GAP = {
    ord: { op: 3, bin: 4, rel: 5 }, op: { ord: 3, op: 3, rel: 5 }, bin: { ord: 4, op: 4, open: 4 },
    rel: { ord: 5, op: 5, open: 5 }, close: { op: 3, bin: 4, rel: 5 }, punct: { ord: 3, op: 3, rel: 3, open: 3, close: 3, punct: 3 },
  };

  let mathFamily = null;
  const family = () => {
    if (!mathFamily) {
      const v = W.document && W.getComputedStyle ? W.getComputedStyle(W.document.documentElement).getPropertyValue("--font-math").trim() : "";
      mathFamily = v || '"Safis Math", "STIX Two Math", "Cambria Math", serif';
    }
    return mathFamily;
  };

  function boxes(ctx, util) {
    const measure = (str, font) => {
      ctx.font = font;
      const m = ctx.measureText(str);
      return { w: m.width, a: Math.max(0, m.actualBoundingBoxAscent ?? 0), d: Math.max(0, m.actualBoundingBoxDescent ?? 0) };
    };
    const sizeOf = env => env.base * SCALE[Math.min(env.level, 2)];
    const deeper = (env, k = 1) => ({ ...env, level: env.level + k });

    function glyph(str, env, o = {}) {
      const S = sizeOf(env) * (o.scale ?? 1);
      const font = `${o.style ?? ""} ${S}px ${o.family ?? family()}`.trim();
      const m = measure(str, font);
      const color = env.color;
      return { ...m, cls: o.cls ?? "ord", italic: !!o.italic, S,
        draw(p, x, y) { p.text(str, font, color, x, y); } };
    }
    const empty = cls => ({ w: 0, a: 0, d: 0, cls: cls ?? "ord", draw() {} });

    function hrow(items, env, display) {
      const S = sizeOf(env);
      const out = [];
      let x = 0, a = 0, d = 0, prev = null;
      items.forEach((b, j) => {
        let cls = b.cls;
        if (cls === "bin" && (!prev || ["bin", "op", "rel", "open", "punct"].includes(prev) || !items[j + 1] || ["rel", "close", "punct"].includes(items[j + 1].cls))) cls = "ord";
        if (prev) {
          const g = (GAP[prev] ?? {})[cls] ?? 0;
          // Scripts keep only thin spaces, as in TeX.
          if (g && (env.level === 0 || g === 3)) x += g * MU * S;
        }
        out.push([b, x]);
        x += b.w;
        a = Math.max(a, b.a);
        d = Math.max(d, b.d);
        prev = cls;
      });
      return { w: x, a, d, cls: items.length === 1 ? items[0].cls : "ord", italic: items.length === 1 && items[0].italic,
        draw(p, X, Y) { for (const [b, dx] of out) b.draw(p, X + dx, Y); } };
    }

    function lay(n, env) {
      const S = sizeOf(env);
      switch (n.t) {
        case "mi": {
          let v = n.v;
          if (n.variant && n.variant !== "normal") v = styleText(v, n.variant);
          else if (!n.normal && n.variant !== "normal" && [...v].length === 1 && autoItalic(v)) return glyph(styleChar(v, "italic"), env, { italic: true });
          return glyph(v, env);
        }
        case "mn": return glyph(n.variant ? styleText(n.v, n.variant) : n.v, env);
        case "mo": {
          if (n.size || n.stretchy) {
            const half = Math.max(n.size ? n.size * S / 2 : S * 0.6, S * 0.5);
            return delim(n.v, half, env, n.cls);
          }
          if (n.large) {
            const g = glyph(n.v, env, { scale: env.display ? 1.45 : 1.05, cls: "op" });
            const shift = (g.a - g.d) / 2 - AXIS * S; // center on the math axis
            return { ...g, a: g.a - shift, d: g.d + shift, draw(p, x, y) { g.draw(p, x, y + shift); } };
          }
          return glyph(n.v, env, { cls: n.v === "mod" ? "bin" : n.cls });
        }
        case "fn": return glyph(n.v, env, { cls: "op" });
        case "space": return { ...empty("space"), w: Math.max(0, n.w * S), cls: "ord" };
        case "text": return glyph(n.v, env, { family: util.fontSerif, style: n.style === "it" ? "italic" : n.style === "bf" ? "bold" : "" });
        case "row": return hrow(n.c.map(k => lay(k, env)).filter(Boolean), env);
        case "style": return lay(n.body, { ...env, display: n.display });
        case "color": return lay(n.body, { ...env, color: util.color(n.c) });
        case "phantom": { const b = lay(n.body, env); return { ...b, draw() {} }; }
        case "scripts": return scripts(n, env);
        case "limit": return limits(lay(n.base, env), n.sub && lay(n.sub, deeper(env)), n.sup && lay(n.sup, deeper(env)), env);
        case "frac": return frac(n, env);
        case "sqrt": return sqrt(n, env);
        case "fence": {
          const body = lay(n.body, env);
          const half = Math.max(body.a - AXIS * S, body.d + AXIS * S) + 0.08 * S;
          const parts = [n.open ? delim(n.open, half, env, "open") : null, body, n.close ? delim(n.close, half, env, "close") : null].filter(Boolean);
          return hrow(parts, env);
        }
        case "accent": return accent(n, env);
        case "underline": {
          const b = lay(n.body, env), t = Math.max(1, RULE * S), y = b.d + 0.12 * S;
          return { ...b, d: y + t, draw(p, x, Y) { b.draw(p, x, Y); p.line([[x, Y + y], [x + b.w, Y + y]], t, env.color); } };
        }
        case "brace": return brace(n, env);
        case "xarrow": return xarrow(n, env);
        case "box": {
          const b = lay(n.body, env), pad = 0.22 * S, t = Math.max(1, RULE * S);
          return { w: b.w + 2 * pad, a: b.a + pad, d: b.d + pad, cls: "ord",
            draw(p, x, y) { b.draw(p, x + pad, y); p.line([[x, y - b.a - pad], [x + b.w + 2 * pad, y - b.a - pad], [x + b.w + 2 * pad, y + b.d + pad], [x, y + b.d + pad]], t, env.color, true); } };
        }
        case "cancel": {
          const b = lay(n.body, env), t = Math.max(1, RULE * S);
          return { ...b, draw(p, x, y) {
            b.draw(p, x, y);
            if (n.kind !== "bcancel") p.line([[x, y + b.d], [x + b.w, y - b.a]], t, env.color);
            if (n.kind !== "cancel") p.line([[x, y - b.a], [x + b.w, y + b.d]], t, env.color);
          } };
        }
        case "table": return table(n, env);
      }
      return empty();
    }

    function scripts(n, env) {
      const base = lay(n.base, env);
      const S = sizeOf(env), se = deeper(env);
      const sub = n.sub && lay(n.sub, se), sup = n.sup && lay(n.sup, se);
      if (n.limits && (env.display || n.base.limits === true && n.base.t === "mo" && INTEGRAL.has(n.base.v))) return limits(base, sub, sup, env);
      let u = sup ? Math.max(base.a - 0.3 * sizeOf(se), 0.36 * S, sup.d + 0.12 * S) : 0;
      let v = sub ? Math.max(base.d + 0.05 * S, 0.16 * S, sub.a - 0.36 * S) : 0;
      if (sup && sub) {
        const gap = (u - sup.d) - (sub.a - v);
        if (gap < 0.16 * S) v += 0.16 * S - gap;
      }
      const kern = base.italic ? 0.06 * S : 0;
      const w = base.w + Math.max(sup ? sup.w + kern : 0, sub ? sub.w : 0) + 0.04 * S;
      return { w, a: Math.max(base.a, sup ? u + sup.a : 0), d: Math.max(base.d, sub ? v + sub.d : 0), cls: base.cls,
        draw(p, x, y) {
          base.draw(p, x, y);
          if (sup) sup.draw(p, x + base.w + kern, y - u);
          if (sub) sub.draw(p, x + base.w, y + v);
        } };
    }

    function limits(base, under, over, env) {
      const S = sizeOf(env), gap = 0.12 * S;
      const w = Math.max(base.w, under ? under.w : 0, over ? over.w : 0);
      const a = base.a + (over ? gap + over.d + over.a : 0), d = base.d + (under ? gap + under.a + under.d : 0);
      return { w, a, d, cls: base.cls,
        draw(p, x, y) {
          base.draw(p, x + (w - base.w) / 2, y);
          if (over) over.draw(p, x + (w - over.w) / 2, y - base.a - gap - over.d);
          if (under) under.draw(p, x + (w - under.w) / 2, y + base.d + gap + under.a);
        } };
    }

    function frac(n, env) {
      const S = sizeOf(env);
      const display = n.style === "display" || (n.style !== "text" && env.display);
      const inner = display ? { ...env, display: false } : deeper(env);
      const num = lay(n.num, inner), den = lay(n.den, inner);
      const t = n.thin ? 0 : Math.max(1, RULE * S), gap = (display ? 0.2 : 0.11) * S, ax = AXIS * S, pad = 0.1 * S;
      const up = ax + t / 2 + gap + num.d, down = -ax + t / 2 + gap + den.a;
      const w = Math.max(num.w, den.w) + 2 * pad;
      return { w, a: up + num.a, d: down + den.d, cls: "ord",
        draw(p, x, y) {
          num.draw(p, x + (w - num.w) / 2, y - up);
          den.draw(p, x + (w - den.w) / 2, y + down);
          if (t) p.line([[x + pad * 0.4, y - ax], [x + w - pad * 0.4, y - ax]], t, env.color);
        } };
    }

    function sqrt(n, env) {
      const S = sizeOf(env), body = lay(n.body, env);
      const t = Math.max(1, RULE * S), gap = (env.display ? 0.18 : 0.12) * S;
      const top = body.a + gap + t / 2, bottom = Math.max(body.d, 0.05 * S) + 0.06 * S, H = top + bottom;
      const rw = 0.5 * S + 0.06 * H;
      const index = n.index && lay(n.index, deeper(env, 2));
      const shift = index ? Math.max(0, index.w - 0.45 * rw) : 0;
      const w = shift + rw + body.w + 0.12 * S;
      return { w, a: Math.max(top + t / 2, index ? 0.6 * H - bottom + index.a + index.d : 0), d: bottom, cls: "ord",
        draw(p, x, y) {
          const X = x + shift;
          p.line([[X, y + bottom - 0.42 * H], [X + 0.16 * rw, y + bottom - 0.5 * H], [X + 0.48 * rw, y + bottom], [X + rw, y - top], [X + rw + body.w + 0.12 * S, y - top]], t * 1.1, env.color);
          body.draw(p, X + rw + 0.04 * S, y);
          if (index) index.draw(p, X + 0.45 * rw - index.w, y + bottom - 0.6 * H - index.d);
        } };
    }

    function accent(n, env) {
      const S = sizeOf(env), b = lay(n.body, env), t = Math.max(1, RULE * S);
      const skew = b.italic ? 0.08 * S : 0;
      const wide = n.stretchy;
      const wd = wide ? Math.max(b.w, 0.4 * S) : Math.min(Math.max(b.w * 0.8, 0.36 * S), 0.5 * S);
      const lift = Math.max(b.a, 0.46 * S) + 0.1 * S;
      const hgt = { vec: 0.2, overrightarrow: 0.2, overleftarrow: 0.2, overleftrightarrow: 0.2, dot: 0.12, ddot: 0.12, bar: 0.06, overline: 0.06 }[n.kind] ?? 0.18;
      return { ...b, a: lift + hgt * S + t, cls: b.cls,
        draw(p, x, y) {
          b.draw(p, x, y);
          const cx = x + b.w / 2 + skew, y0 = y - lift, c = env.color;
          const L = cx - wd / 2, R = cx + wd / 2, h = hgt * S;
          const head = (tip, dir) => { const k = 0.13 * S; p.line([[tip[0] - dir * k, tip[1] - k * 0.6], tip, [tip[0] - dir * k, tip[1] + k * 0.6]], t, c); };
          switch (n.kind) {
            case "vec": case "overrightarrow": p.line([[L, y0 - h / 2], [R, y0 - h / 2]], t, c); head([R, y0 - h / 2], 1); break;
            case "overleftarrow": p.line([[L, y0 - h / 2], [R, y0 - h / 2]], t, c); head([L, y0 - h / 2], -1); break;
            case "overleftrightarrow": p.line([[L, y0 - h / 2], [R, y0 - h / 2]], t, c); head([R, y0 - h / 2], 1); head([L, y0 - h / 2], -1); break;
            case "hat": case "widehat": p.line([[L, y0], [cx, y0 - h], [R, y0]], t, c); break;
            case "check": p.line([[L, y0 - h], [cx, y0], [R, y0 - h]], t, c); break;
            case "bar": case "overline": p.line([[wide ? x : L, y0 - h / 2], [wide ? x + b.w : R, y0 - h / 2]], t, c); break;
            case "dot": p.dot([cx, y0 - h / 2], 0.065 * S, c); break;
            case "ddot": p.dot([cx - 0.12 * S, y0 - h / 2], 0.065 * S, c); p.dot([cx + 0.12 * S, y0 - h / 2], 0.065 * S, c); break;
            case "tilde": case "widetilde": {
              const pts = [];
              for (let k = 0; k <= 16; k++) pts.push([L + (wd * k) / 16, y0 - h / 2 - Math.sin((k / 16) * Math.PI * 2) * h * 0.4]);
              p.line(pts, t, c);
              break;
            }
            case "breve": {
              const pts = [];
              for (let k = 0; k <= 12; k++) pts.push([L + (wd * k) / 12, y0 - h + Math.sin((k / 12) * Math.PI) * h]);
              p.line(pts, t, c);
              break;
            }
            case "acute": p.line([[cx - 0.06 * S, y0], [cx + 0.1 * S, y0 - h]], t, c); break;
            case "grave": p.line([[cx + 0.06 * S, y0], [cx - 0.1 * S, y0 - h]], t, c); break;
          }
        } };
    }

    function braceShape(p, x0, x1, y, h, up, t, c) {
      // A horizontal curly brace from x0 to x1; tips at y, cusp pointing away from the body.
      const m = (x0 + x1) / 2, s = up ? -1 : 1, pts = [];
      const q = (a, b, ctl, n = 8) => { for (let k = 0; k <= n; k++) { const u = k / n; pts.push([(1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * ctl[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * ctl[1] + u * u * b[1]]); } };
      const r = Math.min(h * 0.5, (x1 - x0) / 6);
      q([x0, y], [x0 + r, y + s * h * 0.5], [x0, y + s * h * 0.5]);
      q([m - r, y + s * h * 0.5], [m, y + s * h], [m, y + s * h * 0.5]);
      q([m, y + s * h], [m + r, y + s * h * 0.5], [m, y + s * h * 0.5]);
      q([x1 - r, y + s * h * 0.5], [x1, y], [x1, y + s * h * 0.5]);
      p.line(pts, t, c);
    }

    function brace(n, env) {
      const S = sizeOf(env), b = lay(n.body, env), t = Math.max(1, RULE * S), h = 0.32 * S, gap = 0.1 * S;
      return { ...b, a: n.over ? b.a + gap + h : b.a, d: n.over ? b.d : b.d + gap + h, cls: "ord",
        draw(p, x, y) {
          b.draw(p, x, y);
          if (n.over) braceShape(p, x, x + b.w, y - b.a - gap, h, true, t, env.color);
          else braceShape(p, x, x + b.w, y + b.d + gap, h, false, t, env.color);
        } };
    }

    function xarrow(n, env) {
      const S = sizeOf(env), se = deeper(env), t = Math.max(1, RULE * S);
      const above = lay(n.above, se), below = n.below && lay(n.below, se);
      const w = Math.max(above.w, below ? below.w : 0) + 0.8 * S, ax = AXIS * S;
      const arrow = { w, a: ax + 0.15 * S, d: Math.max(0, -ax + 0.15 * S), cls: "rel",
        draw(p, x, y) {
          const Y = y - ax, k = 0.14 * S, c = env.color;
          if (n.ch === "⇌") {
            p.line([[x, Y - 0.08 * S], [x + w, Y - 0.08 * S], [x + w - k, Y - 0.08 * S - k * 0.7]], t, c);
            p.line([[x + w, Y + 0.08 * S], [x, Y + 0.08 * S], [x + k, Y + 0.08 * S + k * 0.7]], t, c);
            return;
          }
          const double = n.ch === "⇒" || n.ch === "⇐";
          for (const off of double ? [-0.07 * S, 0.07 * S] : [0]) p.line([[x, Y + off], [x + w, Y + off]], t, c);
          const tip = (X, dir) => p.line([[X - dir * k, Y - k * 0.7], [X, Y], [X - dir * k, Y + k * 0.7]], t, c);
          if (n.ch === "→" || n.ch === "⇒" || n.ch === "↔" || n.ch === "↦") tip(x + w, 1);
          if (n.ch === "←" || n.ch === "⇐" || n.ch === "↔") tip(x, -1);
          if (n.ch === "↦") p.line([[x, Y - k * 0.7], [x, Y + k * 0.7]], t, c);
        } };
      const box = limits(arrow, below, above, env);
      box.cls = "rel";
      return box;
    }

    function delim(ch, half, env, cls) {
      const S = sizeOf(env), ax = AXIS * S, t = Math.max(1, RULE * S) * 1.15;
      const wide = { "(": 0.36, ")": 0.36, "[": 0.3, "]": 0.3, "{": 0.46, "}": 0.46, "⟨": 0.36, "⟩": 0.36, "|": 0.24, "‖": 0.36, "⌊": 0.3, "⌋": 0.3, "⌈": 0.3, "⌉": 0.3, "/": 0.4 }[ch] ?? 0.36;
      const w = wide * S + 0.06 * S;
      if (!ch) return { w: 0.1 * S, a: 0, d: 0, cls, draw() {} };
      if (!(ch in { "(": 1, ")": 1, "[": 1, "]": 1, "{": 1, "}": 1, "⟨": 1, "⟩": 1, "|": 1, "‖": 1, "⌊": 1, "⌋": 1, "⌈": 1, "⌉": 1, "/": 1 })) return glyph(ch, env, { cls });
      return { w, a: ax + half, d: half - ax, cls,
        draw(p, x, y) {
          const T = y - ax - half, B = y - ax + half, M = y - ax, c = env.color;
          const L = x + 0.08 * S, R = x + w - 0.08 * S, C = (L + R) / 2;
          const curve = (a, ctl, b) => { const pts = []; for (let k = 0; k <= 16; k++) { const u = k / 16; pts.push([(1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * ctl[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * ctl[1] + u * u * b[1]]); } return pts; };
          switch (ch) {
            case "(": p.line(curve([R, T], [L - 0.1 * S, M], [R, B]), t, c); break;
            case ")": p.line(curve([L, T], [R + 0.1 * S, M], [L, B]), t, c); break;
            case "[": p.line([[R, T], [L + 0.04 * S, T], [L + 0.04 * S, B], [R, B]], t, c); break;
            case "]": p.line([[L, T], [R - 0.04 * S, T], [R - 0.04 * S, B], [L, B]], t, c); break;
            case "⌊": p.line([[L + 0.04 * S, T], [L + 0.04 * S, B], [R, B]], t, c); break;
            case "⌋": p.line([[R - 0.04 * S, T], [R - 0.04 * S, B], [L, B]], t, c); break;
            case "⌈": p.line([[R, T], [L + 0.04 * S, T], [L + 0.04 * S, B]], t, c); break;
            case "⌉": p.line([[L, T], [R - 0.04 * S, T], [R - 0.04 * S, B]], t, c); break;
            case "⟨": p.line([[R, T], [L, M], [R, B]], t, c); break;
            case "⟩": p.line([[L, T], [R, M], [L, B]], t, c); break;
            case "|": p.line([[C, T], [C, B]], t, c); break;
            case "‖": p.line([[C - 0.07 * S, T], [C - 0.07 * S, B]], t, c); p.line([[C + 0.07 * S, T], [C + 0.07 * S, B]], t, c); break;
            case "/": p.line([[R, T], [L, B]], t, c); break;
            case "{": case "}": {
              const tip = ch === "{" ? L : R, body = (L + R) / 2, end = ch === "{" ? R : L;
              const r = Math.min(0.18 * S, half * 0.3);
              const pts = [
                ...curve([end, T], [body, T], [body, T + r]),
                ...curve([body, M - r], [body, M], [tip, M]),
                ...curve([tip, M], [body, M], [body, M + r]),
                ...curve([body, B - r], [body, B], [end, B]),
              ];
              p.line(pts, t, c);
              break;
            }
          }
        } };
    }

    function table(n, env) {
      const S = sizeOf(env);
      const cellEnv = n.kind === "smallmatrix" ? deeper(env) : env;
      const cells = n.rows.map(r => r.map(c => lay(c, cellEnv)));
      const ncol = Math.max(...cells.map(r => r.length));
      const colW = Array.from({ length: ncol }, (_, j) => Math.max(0, ...cells.map(r => (r[j] ? r[j].w : 0))));
      const aligned = n.kind === "aligned";
      const colGap = j => (aligned ? (j % 2 === 0 ? 0 : 1.2 * S) : n.kind === "cases" ? 1 * S : 0.8 * S);
      const rowGap = (n.kind === "matrix" || n.kind === "smallmatrix" ? 0.28 : 0.4) * S;
      const xs = [];
      let X = 0;
      colW.forEach((cw, j) => { xs.push(X); X += cw + (j < ncol - 1 ? colGap(j) : 0); });
      const rowsH = cells.map(r => [Math.max(0.6 * S, ...r.map(b => b.a)), Math.max(0.2 * S, ...r.map(b => b.d))]);
      const H = rowsH.reduce((s, [a, d]) => s + a + d, 0) + rowGap * (rowsH.length - 1);
      const align = j => (n.cols ? { l: "left", c: "center", r: "right" }[n.cols[j]] : aligned ? (j % 2 === 0 ? "right" : "left") : n.kind === "cases" ? "left" : "center");
      const ax = AXIS * S;
      const tableBox = { w: X, a: H / 2 + ax, d: H / 2 - ax, cls: "ord",
        draw(p, x, y) {
          let Y = y - ax - H / 2;
          cells.forEach((r, i) => {
            const [ra, rd] = rowsH[i];
            r.forEach((b, j) => {
              const al = align(j);
              const off = al === "left" ? 0 : al === "right" ? colW[j] - b.w : (colW[j] - b.w) / 2;
              b.draw(p, x + xs[j] + off, Y + ra);
            });
            Y += ra + rd + rowGap;
          });
        } };
      if (!n.open && !n.close) return tableBox;
      const half = H / 2 + 0.1 * S;
      return hrow([n.open ? delim(n.open, half, env, "open") : null, tableBox, n.close ? delim(n.close, half, env, "close") : null].filter(Boolean), env);
    }

    return { lay };
  }

  // A painter draws boxes in two passes: halo strokes first, then ink.
  function painter(ctx, pass, halo, haloWidth) {
    return {
      text(str, font, color, x, y) {
        ctx.font = font;
        if (pass === 0) { if (!halo) return; ctx.lineWidth = haloWidth; ctx.lineJoin = "round"; ctx.strokeStyle = halo; ctx.strokeText(str, x, y); return; }
        ctx.fillStyle = color;
        ctx.fillText(str, x, y);
      },
      line(pts, width, color, closed) {
        if (pass === 0 && !halo) return;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        if (closed) ctx.closePath();
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.setLineDash([]);
        ctx.lineWidth = pass === 0 ? width + haloWidth : width;
        ctx.strokeStyle = pass === 0 ? halo : color;
        ctx.stroke();
      },
      dot(c, r, color) {
        if (pass === 0 && !halo) return;
        ctx.beginPath();
        ctx.arc(c[0], c[1], pass === 0 ? r + haloWidth / 2 : r, 0, Math.PI * 2);
        ctx.fillStyle = pass === 0 ? halo : color;
        ctx.fill();
      },
    };
  }

  function layoutTex(ctx, util, str, o) {
    const r = parsed(String(str));
    const size = o.size ?? 16;
    const env = { base: size, level: 0, display: !!o.display, color: util.color(o.color ?? "ink") };
    if (r.error) {
      const font = `${size * 0.8}px ${util.fontMono}`;
      ctx.font = font;
      const w = ctx.measureText(String(str)).width;
      return { w, a: size * 0.6, d: size * 0.2, draw(p, x, y) { p.text(String(str), font, util.color("red"), x, y); } };
    }
    return boxes(ctx, util).lay(r.node, env);
  }

  function install(g, util) {
    const ctx = g.ctx;
    g.measureTex = (str, o = {}) => {
      ctx.save();
      const b = layoutTex(ctx, util, str, o);
      ctx.restore();
      return { w: b.w, h: b.a + b.d, ascent: b.a, descent: b.d };
    };
    g.tex = (str, p, o = {}) => {
      ctx.save();
      const b = layoutTex(ctx, util, str, o);
      const align = o.align ?? "center", base = o.baseline ?? "middle";
      const x = align === "left" ? p[0] : align === "right" ? p[0] - b.w : p[0] - b.w / 2;
      const y = base === "alphabetic" ? p[1] : base === "top" ? p[1] + b.a : base === "bottom" ? p[1] - b.d : p[1] + (b.a - b.d) / 2;
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      const halo = o.halo ? util.color(o.halo === true ? "panel" : o.halo) : null;
      if (halo) b.draw(painter(ctx, 0, halo, o.haloWidth ?? 4), x, y);
      b.draw(painter(ctx, 1, null, 0), x, y);
      ctx.restore();
      return { w: b.w, h: b.a + b.d };
    };
  }

  (W.__safisG ||= []).push(install);
  W.SafisTeX = { toMathML, typeset, errors, convert, parse: src => { const r = parsed(String(src)); if (r.error) throw new Error(r.error); return r.node; } };

  const doc = W.document;
  if (doc) {
    const start = () => {
      typeset(doc.body);
      // Load the math font now so figures that draw math labels get it early.
      doc.fonts?.load?.(`16px ${family().split(",")[0]}`, "x").catch(() => {});
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
    else start();
  }
})();
