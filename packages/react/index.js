// React components for safis figures. Plain JavaScript (no JSX), so it needs no build.
import { createElement as h, useEffect, useRef } from "react";
import { enhance, mount, typeset } from "@safis/core";
import { toMathML } from "@safis/core/tex";

const cx = (...names) => names.filter(Boolean).join(" ");
const setString = values => Object.entries(values ?? {}).map(([k, v]) => `${k}=${v}`).join(" ");

/**
 * A live figure. `spec` is the same object demo() takes, or a function returning it.
 * Keep its identity stable (define it outside the component or in useMemo): a new
 * spec object mounts the figure again.
 */
export function Figure({ spec, id, caption, label, wide = false, className, style, handleRef, onReady }) {
  const ref = useRef(null);
  useEffect(() => {
    const resolved = typeof spec === "function" ? spec() : spec;
    const handle = mount(ref.current, caption === undefined ? resolved : { ...resolved, caption });
    if (handleRef) handleRef.current = handle;
    onReady?.(handle);
    enhance(document);
    return () => {
      if (handleRef) handleRef.current = null;
      handle?.destroy();
    };
  }, [spec, caption]);
  // The runtime fills the <figure>; React renders no children into it.
  return h("figure", { ref, id, className: cx("demo", "safis", wide && "wide", className), style, "aria-label": label });
}

/** A stretch of prose in the book style. Binds scrubs, "try" links and terms inside it, and typesets .tex. */
export function Explainer({ as = "article", className, children, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    enhance(ref.current);
    typeset(ref.current);
  });
  return h(as, { ref, className: cx("safis", className), ...rest }, children);
}

/** A number in the sentence the reader drags; mirrors control `k` of figure `figure`. */
export function Scrub({ figure, k, className }) {
  const ref = useRef(null);
  useEffect(() => { enhance(document); }, [figure, k]);
  return h("span", { ref, key: `${figure}:${k}`, className: cx("scrub", className), "data-figure": figure, "data-key": k });
}

/** A "try this" link: glides figure `figure` to `values`, optionally pressing a button or playing. */
export function SetLink({ figure, values, press, play, className, children }) {
  const data = setString(values);
  useEffect(() => { enhance(document); }, [figure, data, press, play]);
  // A new key when the values change gives the runtime a fresh element to bind.
  return h("button", {
    key: `${figure}:${data}:${press ?? ""}:${play ?? ""}`, type: "button", className: cx("set", className),
    "data-figure": figure, "data-set": data, "data-press": press, "data-play": play == null ? undefined : String(play),
  }, children);
}

/** A colored term that lights part `part` of figure `figure` while the reader points at it. */
export function Term({ color, part, figure, className, children }) {
  useEffect(() => { if (part) enhance(document); }, [figure, part]);
  return h("span", { className: cx(color && `c-${color}`, className), "data-part": part, "data-figure": figure }, children);
}

/** TeX math, rendered to MathML during render (works with server rendering too). */
export function Tex({ children, src, display = false, className }) {
  const tex = String(src ?? (Array.isArray(children) ? children.join("") : children ?? ""));
  return h(display ? "div" : "span", {
    className: cx("tex", className), "data-tex": tex,
    dangerouslySetInnerHTML: { __html: toMathML(tex, { display }) },
  });
}

export { enhance, mount, typeset };
