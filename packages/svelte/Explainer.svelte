<script>
  // A stretch of prose in the book style. Binds scrubs, "try" links and terms inside it, and typesets .tex.
  import { enhance, typeset } from "safis";

  let { as = "article", class: className = "", children } = $props();
  let el;

  $effect(() => {
    enhance(el);
    typeset(el);
  });
</script>

<svelte:element this={as} bind:this={el} class={["safis", className]}>{@render children?.()}</svelte:element>
