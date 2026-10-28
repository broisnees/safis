<script>
  // TeX math, rendered to MathML during render (works with server rendering too).
  import { toMathML } from "@safis/core/tex";

  let { src = "", display = false } = $props();
  const html = $derived(toMathML(src, { display }));
</script>

{#if display}<div class="tex" data-tex={src}>{@html html}</div>{:else}<span class="tex" data-tex={src}>{@html html}</span>{/if}
