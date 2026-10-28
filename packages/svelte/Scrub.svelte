<script>
  // A number in the sentence the reader drags; mirrors control `k` of figure `figure`.
  import { enhance } from "@safis/core";

  let { figure = undefined, k } = $props();
  $effect(() => { enhance(document); });
</script>

{#key `${figure}:${k}`}<span class="scrub" data-figure={figure} data-key={k}></span>{/key}
