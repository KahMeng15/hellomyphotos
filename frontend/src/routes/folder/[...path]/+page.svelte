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
    {#if data.folderPath}
      <div class="subheading">{data.folderPath}</div>
    {/if}
    <h2>{data.folderPath ? data.folderPath.split('/').pop() : 'Home'}</h2>
  </div>
  <span class="count">
    {#if data.directories.length > 0}{data.directories.length} folders, {/if}{data.files.length} media items
  </span>
</div>

{#if data.directories.length > 0}
  <div class="dir-grid">
    {#each data.directories as dir}
      <a href="/folder/{data.folderPath ? data.folderPath + '/' + dir.name : dir.name}" class="dir-card">
        <div class="dir-cover">
          {#if dir.cover_id}
            <BlurhashImage 
              hash={dir.blurhash || ''} 
              src={`${getThumbnailUrl(dir.cover_id)}${dir.blurhash ? '?cb=' + encodeURIComponent(dir.blurhash) : ''}`} 
              alt={dir.name}
              objectFit="cover"
            />
          {:else}
            <div class="dir-placeholder"></div>
          {/if}
        </div>
        <div class="dir-info">
          <span class="dir-name">{dir.name}</span>
        </div>
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
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 48px;
  }

  .dir-card {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: var(--text-color);
    background: transparent;
    overflow: hidden;
    transition: filter 0.2s ease;
  }

  .dir-card:hover {
    filter: brightness(1.2);
  }

  .dir-cover {
    width: 100%;
    aspect-ratio: 1;
    position: relative;
    overflow: hidden;
    background: #111;
  }

  .dir-placeholder {
    width: 100%;
    height: 100%;
    background: #111;
  }

  .dir-info {
    padding: 12px 0;
  }

  .dir-name {
    font-family: 'Cabinet Grotesk', sans-serif;
    font-weight: 700;
    font-size: 1.125rem;
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
