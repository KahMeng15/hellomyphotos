<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getThumbnailUrl } from '$lib/api/media';

  interface Props {
    id: string;
    children: Snippet;
  }

  let { id, children }: Props = $props();
  let show = $state(false);
  let pos = $state({ x: 0, y: 0 });
  let loaded = $state(false);
  let failed = $state(false);

  function move(e: MouseEvent) {
    pos = { x: e.clientX, y: e.clientY };
  }
  function onEnter(e: MouseEvent) {
    loaded = false;
    failed = false;
    show = true;
    move(e);
  }
  function onMove(e: MouseEvent) {
    if (show) move(e);
  }
  function onLeave() {
    show = false;
  }
</script>

<span class="hover-thumb" role="presentation" onmouseenter={onEnter} onmousemove={onMove} onmouseleave={onLeave}>
  {@render children()}
</span>

{#if show}
  <div class="thumb-pop" style="left: {pos.x}px; top: {pos.y}px;" role="tooltip">
    {#if failed}
      <div class="thumb-fallback">
        <span class="muted">No preview</span>
      </div>
    {:else}
      <img src={getThumbnailUrl(id)} alt="" loading="lazy" onload={() => (loaded = true)} onerror={() => (failed = true)} class:thumb-loaded={loaded} />
    {/if}
  </div>
{/if}

<style>
  .hover-thumb { display: inline-block; }

  .thumb-pop {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    transform: translate(14px, -50%);
    max-width: 260px;
    max-height: 220px;
    border-radius: 10px;
    overflow: hidden;
    background: rgba(20, 20, 25, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
    padding: 6px;
  }

  .thumb-pop img {
    display: block;
    width: auto;
    max-width: 248px;
    max-height: 208px;
    border-radius: 6px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .thumb-pop img.thumb-loaded { opacity: 1; }

  .thumb-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 160px;
    height: 100px;
  }
</style>
