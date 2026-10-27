<script>
  // A live figure. `spec` is the same object demo() takes, or a function returning it.
  import { enhance, mount } from "safis";

  let { spec, id = undefined, caption = undefined, label = undefined, wide = false, class: className = "", onready = undefined } = $props();
  let el;

  $effect(() => {
    const resolved = typeof spec === "function" ? spec() : spec;
    const handle = mount(el, caption === undefined ? resolved : { ...resolved, caption });
    onready?.(handle);
    enhance(document);
    return () => handle?.destroy();
  });
</script>

<!-- The runtime fills the <figure>; Svelte renders no children into it. -->
<figure bind:this={el} {id} class={["demo", "safis", wide && "wide", className]} aria-label={label}></figure>
