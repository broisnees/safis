// Vue 3 components for safis figures, written with render functions so they need no build.
import { defineComponent, h, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from "vue";
import { enhance, mount, typeset } from "@safis/core";
import { toMathML } from "@safis/core/tex";

const setString = values => Object.entries(values ?? {}).map(([k, v]) => `${k}=${v}`).join(" ");
const slotText = slots => (slots.default?.() ?? []).map(n => (typeof n.children === "string" ? n.children : "")).join("");

/**
 * A live figure. `spec` is the same object demo() takes, or a function returning it.
 * Pass it with markRaw() or define it outside reactive state: the runtime mutates it.
 */
export const Figure = defineComponent((props, { expose, emit }) => {
  const el = ref(null);
  let handle = null;
  const start = () => {
    const resolved = typeof props.spec === "function" ? props.spec() : props.spec;
    handle = mount(el.value, props.caption === undefined ? resolved : { ...resolved, caption: props.caption });
    emit("ready", handle);
    enhance(document);
  };
  const stop = () => { handle?.destroy(); handle = null; };
  onMounted(start);
  watch(() => [props.spec, props.caption], () => { stop(); start(); });
  onBeforeUnmount(stop);
  expose({ get handle() { return handle; } });
  // The runtime fills the <figure>; Vue renders no children into it.
  return () => h("figure", { ref: el, id: props.id, class: ["demo", "safis", { wide: props.wide }], "aria-label": props.label });
}, { props: { spec: { type: [Object, Function], required: true }, id: String, caption: { type: [String, Boolean], default: undefined }, label: String, wide: Boolean }, emits: ["ready"] });

/** A stretch of prose in the book style. Binds scrubs, "try" links and terms inside it, and typesets .tex. */
export const Explainer = defineComponent((props, { slots }) => {
  const el = ref(null);
  const bind = () => nextTick(() => { enhance(el.value); typeset(el.value); });
  onMounted(bind);
  onUpdated(bind);
  return () => h(props.as, { ref: el, class: "safis" }, slots.default?.());
}, { props: { as: { type: String, default: "article" } } });

/** A number in the sentence the reader drags; mirrors control `k` of figure `figure`. */
export const Scrub = defineComponent(props => {
  onMounted(() => enhance(document));
  return () => h("span", { key: `${props.figure}:${props.k}`, class: "scrub", "data-figure": props.figure, "data-key": props.k });
}, { props: { figure: String, k: { type: String, required: true } } });

/** A "try this" link: glides figure `figure` to `values`, optionally pressing a button or playing. */
export const SetLink = defineComponent((props, { slots }) => {
  onMounted(() => enhance(document));
  onUpdated(() => enhance(document));
  return () => {
    const data = setString(props.values);
    return h("button", {
      key: `${props.figure}:${data}:${props.press ?? ""}`, type: "button", class: "set",
      "data-figure": props.figure, "data-set": data, "data-press": props.press, "data-play": props.play == null ? undefined : String(props.play),
    }, slots.default?.());
  };
}, { props: { figure: String, values: Object, press: String, play: { type: Boolean, default: undefined } } });

/** A colored term that lights part `part` of figure `figure` while the reader points at it. */
export const Term = defineComponent((props, { slots }) => {
  onMounted(() => { if (props.part) enhance(document); });
  return () => h("span", { class: props.color ? `c-${props.color}` : undefined, "data-part": props.part, "data-figure": props.figure }, slots.default?.());
}, { props: { color: String, part: String, figure: String } });

/** TeX math, rendered to MathML during render (works with server rendering too). */
export const Tex = defineComponent((props, { slots }) => () => {
  const tex = props.src ?? slotText(slots);
  return h(props.display ? "div" : "span", { class: "tex", "data-tex": tex, innerHTML: toMathML(tex, { display: props.display }) });
}, { props: { src: String, display: Boolean } });

export { enhance, mount, typeset };
