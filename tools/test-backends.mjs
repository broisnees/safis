#!/usr/bin/env node
// Backend parity for the simulations: E3 particles (transform feedback, CPU, WebGPU compute) and
// Fx.fluid, Fx.waves, Fx.particles (WebGL2, CPU, WebGPU compute). In Node: the backend switches.
// In headless Chrome on SwiftShader (no WebGPU, the default every checker runs): the fallback is
// what runs, and transform feedback agrees with the CPU integrator. With WebGPU exposed (the
// software adapter, forced on): each WebGPU path agrees with the others, is deterministic, keeps
// going back in time, and moves between backends mid-run without changing the picture.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findChrome, openBrowser } from "../skills/safis/scripts/lib/chrome.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed++; };

// ---------- in Node: no WebGPU, no WebGL ----------
globalThis.window = {};
new Function(await readFile(path.join(root, "src/engine3d.js"), "utf8"))();
new Function(await readFile(path.join(root, "src/effects.js"), "utf8"))();
const { E3, Fx } = window;
check("Node: E3 and Fx step on the CPU", E3.backend === "cpu" && Fx.backend === "cpu");
check("Node: one WebGPU detector shared by both kits", !!window.__safisGPU && E3.webgpu.state === "none" && Fx.webgpu.state === "none");
Fx.backend = "webgpu";
const f0 = Fx.fluid({ domain: [1, 0.5], cpuCells: 12 });
check("Node: forcing webgpu without a device falls back", Fx.backend === "cpu" && f0.backend === "cpu" && (f0.advance(0.1), f0.time > 0));
Fx.backend = "nonsense";
check("Node: an unknown backend means auto", Fx.backend === "cpu");
Fx.backend = "auto"; E3.backend = "auto";
{
  const p = Fx.particles({ matter: "snow", count: 50, backend: "cpu" });
  p.advance(1);
  let synced = false;
  await p.sync().then(() => (synced = true));
  check("Node: sim.sync() resolves and alive() reads the state", synced && p.alive().length > 0 && p.backend === "cpu");
}

// ---------- in a browser ----------
if (!findChrome() || typeof WebSocket === "undefined") console.log("skip browser checks (no Chrome or Node < 22)");
else {
  const dir = await mkdtemp(path.join(os.tmpdir(), "safis-backends-")), tpl = path.join(dir, "template.html"), file = path.join(dir, "index.html");
  execFileSync(process.execPath, [path.join(root, "tools/build-template.mjs"), "--out", tpl], { stdio: "ignore" });
  const page = (await readFile(tpl, "utf8")).replace(/<!-- explainer:article:start -->[\s\S]*?<!-- explainer:article:end -->/, () => "<!-- explainer:article:start --><p>backends</p><!-- explainer:article:end -->");
  await writeFile(file, page);
  // Systems both integrators run: forces, a vortex and an attractor, colliders, flows past a wing and a cylinder.
  const CASES = `{
    vortex: { count: 300, seed: 5, life: [2, 3], emitter: { shape: "sphere", radius: 0.5, speed: [0, 1], spread: 3 }, forces: { gravity: -2, drag: 0.5, vortex: { center: [0, 0, 0], axis: [0, 1, 0], strength: 1, core: 0.2, pull: 0.3 }, attractors: [{ position: [0.5, 0.5, 0], strength: 0.5, radius: 0.2 }] }, colliders: [{ sphere: [0, 0, 0, 1.2], inside: true, bounce: 0.6 }, { plane: [0, 1, 0, -0.5], bounce: 0.4, friction: 0.2 }] },
    wing: { count: 300, seed: 5, life: [3.2, 3.2], emitter: { shape: "box", size: [0.02, 1.5, 2.2], position: [-1.7, 0, 0], rake: 20, speed: 1 }, flow: { type: "airfoil", chord: 1, thickness: 0.12, camber: 0.04, alpha: 0.12, U: 1 }, kill: { min: [-2, -2, -2], max: [2.3, 2, 2] } },
    cylinder: { count: 300, seed: 6, life: [3, 3], emitter: { shape: "line", from: [-1.5, -1, 0], to: [-1.5, 1, 0], speed: 1 }, flow: { type: "cylinder", radius: 0.3, circulation: 0.5 } },
    smoke: { matter: "smoke", count: 300, seed: 4, ground: 0, emitter: { shape: "disk", radius: 0.3, position: [0, 0.3, 0], speed: [0.5, 1.2], spread: 0.3 }, forces: { wind: [0.4, 0, 0] } },
  }`;
  // The state each backend reaches at scene time 2.5: generation and position per slot.
  const STATE = `window.stateOf = async (o, backend) => {
    const scene = E3.scene({ look: "studio", shadow: false }), s = scene.add(E3.particles({ ...o, quality: false, backend, cpu: backend === "cpu" }));
    scene.time = 2.5;
    const v = E3.render(scene, { yaw: 0.3, pitch: 0.2 }, 240, 160, 1, 1); v.source?.image?.close?.();
    await E3.webgpu.sync(s);
    if (s._mode === "cpu") return { mode: s._xm, t: s._t, S: Array.from(s._state) };
    const gl = E3.canvas.getContext("webgl2"), G = s._gpu.sets[s._gpu.cur], P = new Float32Array(o.count * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.p); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, P);
    const S = new Array(o.count * 8).fill(0); for (let i = 0; i < o.count; i++) for (let c = 0; c < 4; c++) S[i * 8 + c] = P[i * 4 + c];
    return { mode: s._xm, t: s._t, S };
  };
  window.compare = (a, b, n) => { let gen = 0, worst = 0, live = 0; for (let i = 0; i < n; i++) { if (a.S[i * 8 + 3] !== b.S[i * 8 + 3]) { gen++; continue; } if (Math.floor(a.S[i * 8 + 3]) !== a.S[i * 8 + 3]) continue; live++; worst = Math.max(worst, Math.hypot(a.S[i * 8] - b.S[i * 8], a.S[i * 8 + 1] - b.S[i * 8 + 1], a.S[i * 8 + 2] - b.S[i * 8 + 2])); } return { gen, worst, live, same: a.t === b.t }; };`;

  // --- the default: SwiftShader WebGL2, no WebGPU adapter ---
  {
    const b = await openBrowser({ viewport: { width: 600, height: 600, deviceScaleFactor: 1, mobile: false } });
    const errs = [];
    b.on(m => { if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description?.split("\n")[0] ?? "exception"); });
    try {
      await b.goto(pathToFileURL(file).href, 60000);
      const r = await b.evaluate(`(async () => {
        ${STATE}
        if (window.__safisGPU) await window.__safisGPU.ready;
        const out = { e3: E3.backend, fx: Fx.backend, state: E3.webgpu.state, cases: {} };
        const C = ${CASES};
        for (const k of ["vortex", "wing", "cylinder"]) { const a = await stateOf(C[k], "webgl2"), c = await stateOf(C[k], "cpu"); out.cases[k] = { ...compare(a, c, C[k].count), modes: a.mode + "/" + c.mode }; }
        // The global switch: forced to the CPU, then back.
        E3.backend = "cpu"; const forced = await stateOf(C.wing); E3.backend = "auto"; const back = await stateOf(C.wing);
        out.switch = { forced: forced.mode, back: back.mode, agree: compare(forced, back, 300) };
        Fx.backend = "webgl2"; const f1 = Fx.fluid({ domain: [1.2, 0.4], cells: 24 }); Fx.backend = "cpu"; const f2 = Fx.fluid({ domain: [1.2, 0.4], cpuCells: 24 }); Fx.backend = "auto";
        out.fxSwitch = [f1.backend, f2.backend];
        return out;
      })()`);
      check("SwiftShader: no WebGPU adapter, so E3 uses transform feedback and Fx the CPU", r.e3 === "webgl2" && r.fx === "cpu" && r.state !== "ready", `${r.state}, E3 ${r.e3}, Fx ${r.fx}`);
      for (const [k, c] of Object.entries(r.cases)) check(`E3 ${k}: transform feedback and the CPU agree (same births and deaths, positions within 5 mm)`, c.modes === "tf/cpu" && c.same && c.gen === 0 && c.live > 50 && c.worst < 5e-3, `${c.live} live, ${c.gen} differ in generation, worst ${c.worst.toExponential(2)}`);
      check("E3.backend = \"cpu\" moves particles to the CPU and \"auto\" back, same picture", r.switch.forced === "cpu" && r.switch.back === "tf" && r.switch.agree.gen === 0 && r.switch.agree.worst < 5e-3, JSON.stringify(r.switch));
      check("Fx.backend forces new simulations (webgl2, then cpu)", r.fxSwitch[0] === "webgl2" && r.fxSwitch[1] === "cpu", r.fxSwitch.join(", "));
      check("no errors on the fallback", errs.length === 0, errs.join("; "));
    } finally { await b.close(); }
  }

  // --- WebGPU exposed (SwiftShader's software adapter, forced on) ---
  {
    const b = await openBrowser({ viewport: { width: 600, height: 600, deviceScaleFactor: 1, mobile: false }, webgpu: true });
    const errs = [];
    b.on(m => { if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description?.split("\n")[0] ?? "exception"); });
    try {
      await b.goto(pathToFileURL(file).href, 60000);
      const state = await b.evaluate(`(async () => { await window.__safisGPU.ready; return { state: window.__safisGPU.state, soft: window.__safisGPU.soft, e3: E3.backend, fx: Fx.backend }; })()`);
      if (state.state !== "ready") console.log(`skip WebGPU checks (no adapter: ${state.state})`);
      else {
        check("a software adapter is skipped unless forced", state.soft && state.e3 === "webgl2" && state.fx === "cpu", JSON.stringify(state));
        const r = await b.evaluate(`(async () => {
          ${STATE}
          E3.backend = "webgpu"; Fx.backend = "webgpu";
          const out = { e3: E3.backend, fx: Fx.backend, cases: {} };
          const C = ${CASES};
          for (const k of Object.keys(C)) { const x = await stateOf(C[k], "webgpu"), t = await stateOf(C[k], "webgl2"); out.cases[k] = { ...compare(x, t, C[k].count), modes: x.mode + "/" + t.mode }; }
          // Fluid, waves, 2D particles: WebGPU against the CPU (and the WebGL2 solver).
          const o = { domain: [1.2, 0.4], speed: 0.4, re: 20, kick: false, obstacles: [{ shape: "circle", at: [0.3, 0.2], r: 0.05 }] };
          const fa = Fx.fluid({ ...o, cells: 32 }), fb = Fx.fluid({ ...o, backend: "cpu", cpuCells: 32 }), fg = Fx.fluid({ ...o, backend: "webgl2", cells: 32 });
          fa.advance(3); await fa.sync(); fb.advance(3); fg.advance(3);
          let fl = 0, flg = 0;
          for (let x = 0.05; x < 1.2; x += 0.05) for (let y = 0.03; y < 0.4; y += 0.04) { const p = fa.velocity([x, y]), q = fb.velocity([x, y]), w = fg.velocity([x, y]); fl = Math.max(fl, Math.hypot(p[0] - q[0], p[1] - q[1]) / 0.4); flg = Math.max(flg, Math.hypot(p[0] - w[0], p[1] - w[1]) / 0.4); }
          out.fluid = { fl, flg, be: [fa.backend, fb.backend, fg.backend] };
          // Determinism, going back in time, and moving from WebGL2 to WebGPU mid-run.
          const shed = { domain: [1.2, 0.4], speed: 0.5, re: 150, obstacles: [{ shape: "circle", at: [0.3, 0.2], r: 0.04 }] };
          const run = async (s, t) => { s.advance(t); await s.sync(); return s.velocity([0.5, 0.2]).concat(s.velocity([0.8, 0.25])); };
          const r1 = Fx.fluid({ ...shed, cells: 24 }), r2 = Fx.fluid({ ...shed, cells: 24 });
          const a1 = await run(r1, 2), a2 = await run(r2, 2);
          r1.warm(1); await r1.sync(); const back = await run(r1, 2);
          out.det = { same: JSON.stringify(a1) === JSON.stringify(a2), back: JSON.stringify(back) === JSON.stringify(a1), be: r1.backend };
          const w = { domain: [1, 0.5], speed: 0.3, damping: 0.1, sources: [{ at: [0.3, 0.25], freq: 3, amp: 0.002 }] }, wa = Fx.waves({ ...w, cells: 40 }), wb = Fx.waves({ ...w, backend: "cpu", cpuCells: 40 });
          wa.drop([0.7, 0.2]); wb.drop([0.7, 0.2]); wa.advance(1.5); await wa.sync(); wb.advance(1.5);
          const H = wa.heights(), K = wb.heights(), m = Math.max(...K.map(Math.abs));
          let wv = 0; H.forEach((v, i) => { wv = Math.max(wv, Math.abs(v - K[i]) / m); });
          out.waves = { wv, be: [wa.backend, wb.backend] };
          out.parts = {};
          for (const matter of ["snow", "leaf", "spark", "smoke"]) {
            const po = { matter, domain: [4, 2.25], count: 400, seed: 3, ground: 2.1, colliders: [{ circle: [2, 1.2, 0.2] }, { from: [0.5, 1.5], to: [1.5, 1.7] }, { points: [[3, 1.4], [3.4, 1.4], [3.2, 1.8]] }], emitter: { shape: "disk", at: [2, 0.4], radius: 0.3, speed: [0.2, 1], spread: 1 } };
            const P1 = Fx.particles(po), P2 = Fx.particles({ ...po, backend: "cpu" });
            P1.advance(2.5); await P1.sync(); P2.advance(2.5);
            const A1 = P1.alive(), A2 = P2.alive(), byI = new Map(A2.map(p => [p.i, p]));
            let close = 0, miss = 0; for (const p of A1) { const q = byI.get(p.i); if (!q) { miss++; continue; } if (Math.hypot(p.p[0] - q.p[0], p.p[1] - q.p[1]) < 5e-3) close++; }
            out.parts[matter] = { n1: A1.length, n2: A2.length, close, miss, be: P1.backend + "/" + P2.backend };
          }
          // A heap needs the CPU, so it stays there.
          out.heap = Fx.particles({ matter: "sand", count: 50, ground: 2 }).backend;
          out.errors = Fx.errors.concat(E3.webgpu.errors);
          return out;
        })()`);
        for (const [k, c] of Object.entries(r.cases)) check(`E3 ${k}: WebGPU compute and transform feedback agree (same births and deaths, positions within 1 mm)`, c.modes === "webgpu/tf" && c.same && c.gen <= 3 && c.live > 50 && c.worst < 1e-3, `${c.live} live, ${c.gen} differ in generation, worst ${c.worst.toExponential(2)}`);
        check("Fx fluid: WebGPU agrees with the CPU (within 1% of the stream) and WebGL2", r.fluid.be.join() === "webgpu,cpu,webgl2" && r.fluid.fl < 0.01 && r.fluid.flg < 0.01, `${(r.fluid.fl * 100).toFixed(4)}% / ${(r.fluid.flg * 100).toFixed(4)}%`);
        check("Fx fluid on WebGPU: deterministic, and going back in time gives the same frame", r.det.same && r.det.back, JSON.stringify(r.det));
        check("Fx waves: WebGPU agrees with the CPU (within 0.1%)", r.waves.be.join() === "webgpu,cpu" && r.waves.wv < 1e-3, `${(r.waves.wv * 100).toFixed(4)}%`);
        for (const [k, c] of Object.entries(r.parts)) check(`Fx particles ${k}: WebGPU and the CPU agree (same live set, 97% within 5 mm)`, c.be === "webgpu/cpu" && c.miss === 0 && Math.abs(c.n1 - c.n2) <= 2 && c.close >= 0.97 * c.n1, JSON.stringify(c));
        check("Fx particles with a heap stay on the CPU", r.heap === "cpu");
        check("no WebGPU shader or validation errors", r.errors.length === 0, r.errors.join("; "));
        // Moving between backends mid-run: the same frames as staying on one.
        const mv = await b.evaluate(`(async () => {
          const o = { domain: [1.2, 0.4], speed: 0.5, re: 150, cells: 24, obstacles: [{ shape: "circle", at: [0.3, 0.2], r: 0.04 }] };
          Fx.backend = "webgl2"; const a = Fx.fluid(o), g = Fx.fluid(o); a.advance(1); g.advance(1);
          const before = a.backend; Fx.backend = "webgpu"; a.advance(2); await a.sync(); const during = a.backend; Fx.backend = "webgl2"; a.advance(2.5); const after = a.backend; g.advance(2.5);
          let worst = 0; for (let x = 0.1; x < 1.2; x += 0.1) { const p = a.velocity([x, 0.2]), q = g.velocity([x, 0.2]); worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1]) / 0.5); }
          E3.backend = "webgl2"; const sc = E3.scene({}), s = sc.add(E3.particles({ count: 200, seed: 2, life: [1, 2], emitter: { speed: [0.5, 1], spread: 1 }, forces: { gravity: -9.8 } }));
          sc.time = 1; E3.render(sc, {}, 200, 120, 1, 1).source?.image?.close?.(); const m1 = s._xm;
          E3.backend = "webgpu"; sc.time = 1.2; E3.render(sc, {}, 200, 120, 1, 1).source?.image?.close?.(); await E3.webgpu.sync(s); E3.render(sc, {}, 200, 120, 1, 1).source?.image?.close?.(); const m2 = s._xm, drawn = s._state === s._x?.shown;
          E3.backend = "auto"; Fx.backend = "auto";
          return { before, during, after, worst, m1, m2, drawn };
        })()`);
        check("a fluid moves WebGL2 -> WebGPU -> WebGL2 mid-run and matches one that stayed (within 0.1%)", mv.before === "webgl2" && mv.during === "webgpu" && mv.after === "webgl2" && mv.worst < 1e-3, JSON.stringify(mv));
        check("E3 particles move from transform feedback to WebGPU and draw its copy", mv.m1 === "tf" && mv.m2 === "webgpu" && mv.drawn, JSON.stringify(mv));
      }
      check("no errors with WebGPU", errs.length === 0, errs.join("; "));
    } finally { await b.close(); }
  }
  await rm(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
