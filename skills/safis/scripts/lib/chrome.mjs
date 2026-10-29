// Headless Chrome over the DevTools protocol, with no npm dependencies.
// Shared by verify.mjs and explore.mjs. Needs Node 22+ for the built-in WebSocket.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const names = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "chrome", "microsoft-edge"];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find(p => existsSync(p)) ?? null;
}

export function describeException(details) {
  const where = details.url ? ` (${path.basename(details.url)}:${details.lineNumber + 1})` : "";
  return (details.exception?.description ?? details.text ?? "exception").split("\n")[0] + where;
}

// Minimal DevTools Protocol client over one browser-level socket.
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const handlers = new Set();
  let next = 0;
  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id != null) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else {
      for (const h of handlers) h(msg);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("couldn't connect to Chrome")), { once: true });
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = ++next;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
      ws.send(JSON.stringify({ id, method, params, sessionId }));
      return result;
    },
    on(fn) { handlers.add(fn); return () => handlers.delete(fn); },
    close() { ws.close(); },
  };
}

// Starts Chrome and opens one tab. Returns helpers bound to that tab. WebGL runs on the
// SwiftShader software renderer, so screenshots match everywhere; gpu: true uses the machine's
// GPU instead (for timing frames as a reader would see them).
// webgpu: true exposes WebGPU in headless mode (on SwiftShader it's a software adapter, which
// pages skip unless forced: useful for testing the WebGPU paths anywhere).
export async function openBrowser({ viewport, gpu = false, webgpu = false }) {
  if (typeof WebSocket === "undefined") throw new Error("needs Node 22 or newer (it uses the built-in WebSocket)");
  const bin = findChrome();
  if (!bin) throw new Error("couldn't find Chrome, Chromium, or Edge; install one or set CHROME_PATH");
  const profile = await mkdtemp(path.join(os.tmpdir(), "explainer-chrome-"));
  const proc = spawn(bin, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars", "--disable-accelerated-2d-canvas",
    "--mute-audio",
    "--force-color-profile=srgb",
    // WebGL in headless mode runs on the SwiftShader software renderer unless gpu is set.
    ...(gpu ? ["--enable-gpu", "--use-gl=angle"] : ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]),
    "--ignore-gpu-blocklist",
    ...(webgpu ? ["--enable-unsafe-webgpu"] : []),
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  // If the script ends without close() (an error, a timeout, Ctrl-C), take Chrome down with it,
  // so no headless browser is left running.
  const reap = () => { try { if (proc.exitCode === null) proc.kill("SIGKILL"); } catch {} };
  process.once("exit", reap);
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { reap(); process.exit(130); });
  const wsUrl = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Chrome didn't start within 20s:\n${log}`)), 20000);
    proc.stderr.on("data", chunk => {
      log += chunk;
      const m = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on("error", e => { clearTimeout(timer); reject(e); });
    proc.on("exit", code => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}) before it was ready:\n${log}`)); });
  });

  const cdp = connect(wsUrl);
  await cdp.ready;
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const on = fn => cdp.on(msg => { if (msg.sessionId === sessionId) fn(msg); });
  await Promise.all(["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"].map(m => send(m)));

  async function evaluate(expression) {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(describeException(r.exceptionDetails));
    return r.result.value;
  }
  const settle = (ms = 200) =>
    evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ${ms}))))`);
  const setViewport = v => send("Emulation.setDeviceMetricsOverride", v);
  const setMedia = (scheme, motion = "no-preference") => send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: motion }],
  });

  async function goto(url, timeout = 30000) {
    const loaded = new Promise(resolve => {
      const off = on(m => { if (m.method === "Page.loadEventFired") { off(); resolve(); } });
    });
    await send("Page.navigate", { url });
    await Promise.race([loaded, sleep(timeout).then(() => { throw new Error(`page didn't finish loading within ${timeout / 1000}s`); })]);
    await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
    await settle();
  }

  // Screenshot; clip is {x, y, width, height} in document CSS pixels.
  async function screenshot(clip, o = {}) {
    const params = { format: o.format ?? "png" };
    if (o.quality != null) params.quality = o.quality;
    if (clip) Object.assign(params, { clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
    const { data } = await send("Page.captureScreenshot", params);
    return Buffer.from(data, "base64");
  }

  // Mouse drag in viewport CSS pixels, in small steps so pages see real motion.
  async function drag(from, to, { steps = 12, hold = 0 } = {}) {
    const ev = (type, [x, y], extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from[0], y: from[1], buttons: 0 });
    await ev("mousePressed", from);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await ev("mouseMoved", [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
      await sleep(16);
    }
    if (hold) await sleep(hold);
    await ev("mouseReleased", to);
  }

  async function close() {
    process.removeListener("exit", reap);
    cdp.close();
    if (proc.exitCode === null) {
      const exited = new Promise(r => proc.once("exit", r));
      proc.kill();
      await Promise.race([exited, sleep(3000)]);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }

  if (viewport) await setViewport(viewport);
  return { send, on, evaluate, settle, setViewport, setMedia, goto, screenshot, drag, close };
}
