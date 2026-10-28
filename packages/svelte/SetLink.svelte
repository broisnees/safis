<script>
  // A "try this" link: glides figure `figure` to `values`, optionally pressing a button or playing.
  import { enhance } from "@safis/core";

  let { figure = undefined, values = {}, press = undefined, play = undefined, children } = $props();
  const data = $derived(Object.entries(values).map(([k, v]) => `${k}=${v}`).join(" "));
  $effect(() => { data; enhance(document); });
</script>

{#key data}<button type="button" class="set" data-figure={figure} data-set={data} data-press={press} data-play={play == null ? undefined : String(play)}>{@render children?.()}</button>{/key}
