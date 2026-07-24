<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { MediaFile } from '$lib/api/media';
  import { getPreviewUrl, getStreamUrl } from '$lib/api/media';
  import { lowBandwidthMode } from '$lib/stores/settings';

  export let media: MediaFile;
  const dispatch = createEventDispatcher();
  
  function close() {
    dispatch('close');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') dispatch('next');
    if (e.key === 'ArrowLeft') dispatch('prev');
  }
  
  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="lightbox" transition:fade={{ duration: 150 }} on:click={close}>
  <button class="close-btn" on:click|stopPropagation={close}>&times;</button>
  
  <div class="content" on:click|stopPropagation>
    {#if media.mime_type.startsWith('video/')}
      <video controls autoplay class="media-element">
        <source src={getStreamUrl(media.id)} type={media.mime_type} />
        Your browser does not support the video tag.
      </video>
    {:else}
      <img src={getPreviewUrl(media.id, $lowBandwidthMode)} alt={media.file_name} class="media-element" />
    {/if}
  </div>
</div>

<style>
  .lightbox {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .close-btn {
    position: absolute;
    top: 24px;
    right: 24px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    font-size: 2rem;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    cursor: pointer;
    z-index: 1010;
    transition: background 0.2s;
  }
  
  .close-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .content {
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .media-element {
    max-width: 100%;
    max-height: 90vh;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  }
</style>
