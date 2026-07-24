<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl } from '$lib/api/media';
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  
  let { data }: { data: PageData } = $props();
  
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

  let pollInterval: ReturnType<typeof setInterval>;

  onMount(() => {
    pollInterval = setInterval(() => {
      // Poll if any file lacks a blurhash (still processing) or if the scanner is active
      const stillProcessing = data.files.some(f => !f.blurhash) || data.scanning;
      if (stillProcessing) {
        invalidateAll();
      }
    }, 2000);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });
</script>

<div class="header">
  <div class="header-left">
    <div class="subheading">{data.folderPath || '/'}</div>
    <h2>{data.folderPath ? data.folderPath.split('/').pop() : 'Home'}</h2>
  </div>
  <span class="count">
    {#if data.directories.length > 0}{data.directories.length} folders, {/if}{data.files.length} media items
  </span>
</div>

{#if data.directories.length > 0}
  <div class="dir-grid">
    {#each data.directories as dir}
      <a href="/folder/{data.folderPath ? data.folderPath + '/' + dir : dir}" class="dir-item">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="dir-icon">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="dir-name">{dir}</span>
      </a>
    {/each}
  </div>
{/if}

<div class="grid">
  {#each data.files as file, i}
    <BlurhashImage 
      hash={file.blurhash || ''} 
      src={`${getThumbnailUrl(file.id)}${file.blurhash ? '?cb=' + encodeURIComponent(file.blurhash) : ''}`} 
      alt={file.file_name} 
      isVideo={file.mime_type.startsWith('video/')}
      onclick={() => openLightbox(i)}
    />
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
    align-items: flex-end;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--glass-border);
  }
  
  .header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  
  .header h2 {
    font-weight: 700;
    font-size: 2rem;
    color: var(--text-color);
    margin-bottom: 0;
  }
  
  .subheading {
    color: #888888;
    font-size: 0.875rem;
    margin-bottom: 8px;
    font-family: 'Instrument Sans', sans-serif;
  }
  
  .count {
    color: #666666;
    font-size: 0.875rem;
  }

  .dir-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 16px;
    margin-bottom: 32px;
  }

  .dir-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    color: var(--text-color);
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .dir-item:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: translateY(-2px);
  }

  .dir-icon {
    color: var(--accent-color);
    flex-shrink: 0;
  }

  .dir-name {
    font-weight: 500;
    font-size: 0.875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    padding-bottom: 64px;
  }
  
  /* Trick to prevent the last row from stretching to the edges if there's only 1 or 2 photos */
  .grid::after {
    content: "";
    flex-grow: 999999999;
  }
</style>
