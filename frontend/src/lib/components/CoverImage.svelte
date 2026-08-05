<script lang="ts">
  import { computeCoverObjectPosition } from '$lib/utils/cover';

  let {
    src,
    objectPosition = 'center center',
    alt = 'Cover'
  }: {
    src: string;
    objectPosition?: string;
    alt?: string;
  } = $props();

  let loaded = $state(false);
</script>

{#key src}
  <img {src} class="header-bg" class:loaded onload={() => loaded = true} fetchpriority="low" loading="lazy" {alt} style="object-position: {objectPosition};" />
{/key}

<style>
  .header-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: 0;
    opacity: 0;
    transition: opacity 0.5s ease;
  }

  .header-bg.loaded {
    opacity: 1;
  }
</style>
