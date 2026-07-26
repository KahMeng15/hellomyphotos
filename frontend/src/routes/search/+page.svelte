<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl } from '$lib/api/media';
  import type { PageData } from './$types';
  import { File, Video } from '@lucide/svelte';

  let { data }: { data: PageData } = $props();

  let selectedMediaIndex: number | null = $state(null);

  function openLightbox(index: number) {
    selectedMediaIndex = index;
  }

  function closeLightbox() {
    selectedMediaIndex = null;
  }

  function nextMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex < data.results.length - 1) {
      selectedMediaIndex++;
    }
  }

  function prevMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex > 0) {
      selectedMediaIndex--;
    }
  }

  function isVideo(fileName: string) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    return ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext || '');
  }
</script>

<div class="header">
  <h2>Search Results</h2>
  {#if data.q}
    <div class="search-query">for "{data.q}"</div>
    <div class="count">{data.results.length} matches found</div>
  {:else}
    <div class="count">Please enter a search query</div>
  {/if}
</div>

{#if data.results.length > 0}
  <div class="grid">
    {#each data.results as media, i}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="grid-item" onclick={() => openLightbox(i)}>
        <BlurhashImage 
          hash={media.blurhash || ''} 
          src={getThumbnailUrl(media.id)} 
          alt={media.file_name} 
        />
        <div class="media-icon">
          {#if isVideo(media.file_name)}
            <Video size={16} color="white" />
          {:else}
            <File size={16} color="white" />
          {/if}
        </div>
      </div>
    {/each}
  </div>
{:else if data.q}
  <div class="empty-state">
    <p>No results found for "{data.q}".</p>
    <p class="sub-text">Try different keywords or concepts.</p>
  </div>
{/if}

{#if selectedMediaIndex !== null}
  <Lightbox 
    media={data.results[selectedMediaIndex]} 
    onclose={closeLightbox}
    onnext={nextMedia}
    onprev={prevMedia}
  />
{/if}

<style>
  .header {
    display: flex;
    flex-direction: column;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--glass-border);
  }
  
  .header h2 {
    font-weight: 600;
    font-size: 1.5rem;
    color: #e2e8f0;
    margin: 0;
  }

  .search-query {
    font-size: 1.1rem;
    color: var(--accent-color);
    margin-top: 4px;
  }
  
  .count {
    color: #94a3b8;
    font-size: 0.875rem;
    margin-top: 8px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 16px;
    padding-bottom: 64px;
  }

  .grid-item {
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    position: relative;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  .grid-item:hover {
    transform: scale(1.02);
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);
  }

  .media-icon {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0,0,0,0.4);
    border-radius: 4px;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .empty-state {
    text-align: center;
    padding: 64px 0;
    color: #e2e8f0;
  }

  .empty-state .sub-text {
    color: #94a3b8;
    margin-top: 8px;
    font-size: 0.9rem;
  }
</style>
