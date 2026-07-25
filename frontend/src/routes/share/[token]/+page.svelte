<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, getPreviewUrl, setFolderCover, getFolderZipUrl, setFolderDescription } from '$lib/api/media';
  import { createShare, getActiveShares, revokeShare, type ShareData } from '$lib/api/shares';
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import { ArrowDownUp, LayoutGrid, Download, Share2, Settings, X, ChevronDown, Check, Copy, Trash2, Clock } from '@lucide/svelte';
  
  let { data }: { data: PageData } = $props();
  
  type SortMode = 'newest' | 'oldest' | 'a-z' | 'z-a';
  type ViewMode = 'small-fit' | 'large-fit' | 'small-square' | 'large-square';

  let sortMode: SortMode = $state('newest');
  let viewMode: ViewMode = $state('small-fit');

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);

  let sortedFiles = $derived([...data.files].sort((a, b) => {
    function parseExifDate(dateStr: string | undefined, fallback: number): number {
      if (!dateStr) return fallback;
      const normalized = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const time = new Date(normalized).getTime();
      return isNaN(time) ? fallback : time;
    }

    if (sortMode === 'newest') {
      const dateA = parseExifDate(a.exif_json?.dateTimeOriginal, 0);
      const dateB = parseExifDate(b.exif_json?.dateTimeOriginal, 0);
      return dateB - dateA;
    }
    if (sortMode === 'oldest') {
      const dateA = parseExifDate(a.exif_json?.dateTimeOriginal, Number.MAX_SAFE_INTEGER);
      const dateB = parseExifDate(b.exif_json?.dateTimeOriginal, Number.MAX_SAFE_INTEGER);
      return dateA - dateB;
    }
    if (sortMode === 'a-z') return a.file_name.localeCompare(b.file_name);
    if (sortMode === 'z-a') return b.file_name.localeCompare(a.file_name);
    return 0;
  }));
  
  let selectedMediaIndex: number | null = $state(null);
  
  function openLightbox(index: number) {
    selectedMediaIndex = index;
  }
  
  function closeLightbox() {
    selectedMediaIndex = null;
  }
  
  function nextMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex < sortedFiles.length - 1) {
      selectedMediaIndex++;
    }
  }

  function prevMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex > 0) {
      selectedMediaIndex--;
    }
  }

  let scrollProgress = $state(0);
  let headerWrapper: HTMLElement | undefined = $state();
  let pollInterval: ReturnType<typeof setInterval>;

  function handleScroll(e: Event) {
    if (!headerWrapper) return;
    const target = e.target as HTMLElement;
    // Sticking occurs when scrolled past the wrapper's height minus the 100px overlap and 25px top offset
    const threshold = headerWrapper.offsetHeight - 125;
    if (threshold > 0) {
      scrollProgress = Math.min(1, Math.max(0, target.scrollTop / threshold));
    }
  }

  onMount(() => {
    pollInterval = setInterval(() => {
      if (data.error || !data.files) return;
      const stillProcessing = data.files.some((f: any) => !f.blurhash) ;
      if (stillProcessing) {
        invalidateAll();
      }
    }, 2000);

    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.addEventListener('scroll', handleScroll);
    }
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
    if (typeof document !== 'undefined') {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
    }
  });
</script>

{#if data.error}
  <div style="text-align: center; padding-top: 10vh; color: var(--text-color);">
    <h2>{data.error}</h2>
  </div>
{:else}
<div class="header-wrapper {(data.folderCoverId || data.files.length > 0) ? 'has-cover' : ''}" bind:this={headerWrapper}>
  {#if data.folderCoverId || data.files.length > 0}
    <div class="header-bg" style="background-image: url('{getPreviewUrl(data.folderCoverId || data.files[0].id, false)}');"></div>
    <div class="header-gradient"></div>
  {/if}
</div>

<div class="sticky-header" style="
  background: linear-gradient(to bottom, rgba(0,0,0,calc(0.9 * {scrollProgress})) 0%, rgba(0,0,0,calc(0.6 * {scrollProgress})) 100%);
  backdrop-filter: blur(calc(16px * {scrollProgress}));
  -webkit-backdrop-filter: blur(calc(16px * {scrollProgress}));
  border-bottom-color: rgba(255,255,255,calc(0.05 * {scrollProgress}));
">
  <div class="header-content">
    <div class="header-left">
      {#if data.share.folder_path}
        <div class="subheading">{data.share.folder_path}</div>
      {/if}
      <h2>{data.share.folder_path ? data.share.folder_path.split('/').pop() : 'Home'}</h2>
    </div>
    
    <div class="header-right">
      <div class="toolbar">
        <div class="dropdown-container">
          <button class="icon-btn" onclick={() => { showSortMenu = !showSortMenu; showViewMenu = false; }} title="Sort">
            <ArrowDownUp size={18} />
          </button>
          {#if showSortMenu}
            <div class="dropdown-menu">
              <button class:active={sortMode === 'newest'} onclick={() => { sortMode = 'newest'; showSortMenu = false; }}>Newest to Oldest</button>
              <button class:active={sortMode === 'oldest'} onclick={() => { sortMode = 'oldest'; showSortMenu = false; }}>Oldest to Newest</button>
              <button class:active={sortMode === 'a-z'} onclick={() => { sortMode = 'a-z'; showSortMenu = false; }}>A to Z</button>
              <button class:active={sortMode === 'z-a'} onclick={() => { sortMode = 'z-a'; showSortMenu = false; }}>Z to A</button>
            </div>
          {/if}
        </div>
        
        <div class="dropdown-container">
          <button class="icon-btn" onclick={() => { showViewMenu = !showViewMenu; showSortMenu = false; }} title="View">
            <LayoutGrid size={18} />
          </button>
          {#if showViewMenu}
            <div class="dropdown-menu">
              <button class:active={viewMode === 'small-fit'} onclick={() => { viewMode = 'small-fit'; showViewMenu = false; }}>Small Fit Size</button>
              <button class:active={viewMode === 'large-fit'} onclick={() => { viewMode = 'large-fit'; showViewMenu = false; }}>Large Fit Size</button>
              <button class:active={viewMode === 'small-square'} onclick={() => { viewMode = 'small-square'; showViewMenu = false; }}>Small Square Grid</button>
              <button class:active={viewMode === 'large-square'} onclick={() => { viewMode = 'large-square'; showViewMenu = false; }}>Large Square Grid</button>
            </div>
          {/if}
        </div>
        
        {#if data.share.allow_download_folder}<a href={getFolderZipUrl(data.share.folder_path)} target="_blank" class="icon-btn" title="Download ZIP"><Download size={18} /></a>{/if}
        
        
      </div>
      
      <span class="count">
        {data.files.length} media items
      </span>
    </div>
  </div>
</div>

<div class="grid {viewMode}">
  {#each sortedFiles as file, i}
    <BlurhashImage 
      hash={file.blurhash || ''} 
      src={`${getThumbnailUrl(file.id)}${file.blurhash ? '?cb=' + encodeURIComponent(file.blurhash) : ''}`} 
      alt={file.file_name} 
      isVideo={file.mime_type.startsWith('video/')}
      onclick={() => openLightbox(i)}
      objectFit={viewMode.includes('square') ? 'cover' : 'contain'}
      square={viewMode.includes('square')}
      targetHeight={viewMode.includes('small') ? 150 : viewMode.includes('large') ? 350 : 250}
    />
  {/each}
</div>

{#if selectedMediaIndex !== null}
  <Lightbox media={sortedFiles[selectedMediaIndex]} allowDownload={data.share.allow_download_images} on:close={closeLightbox} on:next={nextMedia} on:prev={prevMedia} />
{/if}
{/if}

<style>
  .header-wrapper {
    position: relative;
    margin: -24px -24px 0 -24px;
    min-height: 120px;
    z-index: 0;
  }
  
  .header-wrapper.has-cover {
    min-height: 40vh;
  }
  
  .header-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center 60%;
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
  
  .sticky-header {
    position: sticky;
    top: -25px; /* Offset main-content padding */
    z-index: 50;
    margin: -100px -24px 24px -24px;
    padding: 24px 24px;
    border-bottom: 1px solid transparent;
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
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: var(--text-color);
    background: transparent;
    font-weight: 700;
    font-size: 2.5rem;
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
  
  .header-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
  }
  
  .toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .dropdown-container {
    position: relative;
  }
  
  .icon-btn {
    background: transparent;
    border: none;
    color: #a1a1aa;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .icon-btn:hover {
    background: rgba(255,255,255,0.1);
    color: white;
  }
  
  .dropdown-menu {
    position: absolute;
    top: 44px;
    right: 0;
    background: #000;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px;
    min-width: 180px;
    overflow: hidden;
    z-index: 100;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  }
  
  .dropdown-menu button {
    width: 100%;
    text-align: left;
    padding: 12px 16px;
    background: none;
    border: none;
    color: #ccc;
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.2s, color 0.2s;
  }
  
  .dropdown-menu button:hover {
    background: rgba(255,255,255,0.1);
    color: white;
  }
  
  .dropdown-menu button.active {
    background: rgba(255,255,255,0.15);
    color: white;
    font-weight: 500;
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
    padding-bottom: 24px;
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
    padding-bottom: 64px;
  }
  
  .grid.small-fit, .grid.large-fit {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
  }
  
  .grid.small-square {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0;
  }
  
  .grid.large-square {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 0;
  }

  /* Trick to prevent the last row from stretching to the edges if there's only 1 or 2 photos in flex view */
  .grid.small-fit::after, .grid.large-fit::after {
    content: "";
    flex-grow: 999999999;
  }
</style>
