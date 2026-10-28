<script>
  // A colored term that lights part `part` of figure `figure` while the reader points at it.
  import { enhance } from "@safis/core";

  let { color = undefined, part = undefined, figure = undefined, children } = $props();
  $effect(() => { if (part) enhance(document); });
</script>

<span class={color ? `c-${color}` : undefined} data-part={part} data-figure={figure}>{@render children?.()}</span>
