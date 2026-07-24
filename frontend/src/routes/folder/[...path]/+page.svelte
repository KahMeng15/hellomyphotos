<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, getPreviewUrl, setFolderCover } from '$lib/api/media';
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  
  let { data }: { data: PageData } = $props();
  
  let selectedMediaIndex: number | null = $state(null);
  
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

  async function handleSetCover(event: CustomEvent<string>) {
    const mediaId = event.detail;
    try {
      await setFolderCover(data.folderPath || '', mediaId);
      await invalidateAll(); // Reload page data to reflect the new cover image
    } catch (e) {
      console.error(e);
      alert('Failed to set cover image.');
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

<div class="header-wrapper {(data.folderCoverId || data.files.length > 0) ? 'has-cover' : ''}">
  {#if data.folderCoverId || data.files.length > 0}
    <div class="header-bg" style="background-image: url('{getPreviewUrl(data.folderCoverId || data.files[0].id, false)}');"></div>
    <div class="header-gradient"></div>
  {/if}
  
  <div class="header-content">
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
              square={true}
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
    on:setcover={handleSetCover}
  />
{/if}

<style>
  .header-wrapper {
    position: relative;
    margin: -24px -24px 24px -24px;
    padding: 24px;
    display: flex;
    align-items: flex-end;
    min-height: 120px;
    border-bottom: 1px solid var(--glass-border);
  }
  
  .header-wrapper.has-cover {
    min-height: 350px;
    padding: 120px 24px 24px 24px;
    border-bottom: none;
  }
  
  .header-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center 30%;
    z-index: 0;
  }
  
  .header-gradient {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,1) 100%);
    z-index: 1;
  }
  
  .header-content {
    position: relative;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    width: 100%;
  }
  
  .header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  
  .header-content h2 {
    font-weight: 700;
    font-size: 2.5rem;
    color: var(--text-color);
    margin-bottom: 0;
    text-shadow: 0 2px 10px rgba(0,0,0,0.5);
  }
  
  .subheading {
    color: #a1a1aa;
    font-size: 1rem;
    margin-bottom: 4px;
    font-family: 'Instrument Sans', sans-serif;
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
  }
  
  .count {
    color: #a1a1aa;
    font-size: 0.875rem;
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
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
