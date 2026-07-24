<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl } from '$lib/api/media';
  import type { PageData } from './$types';
  
  export let data: PageData;
  
  let selectedMediaIndex: number | null = null;
  
  function openLightbox(index: number) {
    selectedMediaIndex = index;
  }
  
  function closeLightbox() {
    selectedMediaIndex = null;
  }
  
  function nextMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex < data.files.length - 1) {
      selectedMediaIndex++;
    }
  }
  
  function prevMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex > 0) {
      selectedMediaIndex--;
    }
  }
</script>

<div class="header">
  <h2>/{data.folderPath || 'root'}</h2>
  <span class="count">{data.files.length} items</span>
</div>

<div class="grid">
  {#each data.files as file, i}
    <div class="grid-item" on:click={() => openLightbox(i)}>
      <BlurhashImage 
        hash={file.blurhash || ''} 
        src={getThumbnailUrl(file.id)} 
        alt={file.file_name} 
      />
      {#if file.mime_type.startsWith('video/')}
        <div class="video-indicator">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </div>
      {/if}
    </div>
  {/each}
</div>

{#if selectedMediaIndex !== null}
  <Lightbox 
    media={data.files[selectedMediaIndex]} 
    on:close={closeLightbox}
    on:next={nextMedia}
    on:prev={prevMedia}
  />
{/if}

<style>
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--glass-border);
  }
  
  .header h2 {
    font-weight: 600;
    font-size: 1.5rem;
    color: #e2e8f0;
  }
  
  .count {
    color: #94a3b8;
    font-size: 0.875rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
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
  
  .video-indicator {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0,0,0,0.6);
    border-radius: 50%;
    width: 32px;
    height: 32px;
    display: flex;
    justify-content: center;
    align-items: center;
    color: white;
  }
</style>
