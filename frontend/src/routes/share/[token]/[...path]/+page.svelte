<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, getPreviewUrl, setFolderCover, getFolderZipUrl, setFolderDescription, fetchMediaFaces } from '$lib/api/media';
  import { createShare, getActiveShares, revokeShare, type ShareData } from '$lib/api/shares';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import { ChevronLeft, ArrowDownUp, LayoutGrid, Download, Share2, Settings, X, ChevronDown, Check, Copy, Trash2, Clock } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';
  
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

  let fallbackCoverId = $derived(
    data.folderCoverId || 
    (data.files.length > 0 ? data.files[0].id : null) || 
    (data.directories && data.directories.length > 0 ? (data.directories.find((d: any) => d.cover_id)?.cover_id || null) : null)
  );

  let coverLoaded = $state(false);
  let coverBackgroundPosition = $state('center 50%');

  $effect(() => {
    if (fallbackCoverId) {
      coverBackgroundPosition = 'center 50%'; // Default
      fetchMediaFaces(fallbackCoverId, data.token)
        .then(faces => {
          if (faces && faces.length > 0) {
            coverBackgroundPosition = 'center 25%'; // Good default for faces
            const localFile = data.files.find((f: any) => f.id === fallbackCoverId);
            if (localFile && localFile.exif_json) {
              const height = parseInt(localFile.exif_json.ImageHeight || localFile.exif_json.ExifImageHeight || '0');
              if (height > 0) {
                let totalYCenter = 0;
                let validCount = 0;
                faces.forEach((f: any) => {
                  let box = typeof f.bounding_box === 'string' ? JSON.parse(f.bounding_box) : f.bounding_box;
                  let y = box.y || box._y || box.top || box.yMin || 0;
                  let h = box.height || box._height || box.h || 0;
                  if (y !== undefined && h !== undefined) {
                    totalYCenter += (y + h/2) / height;
                    validCount++;
                  }
                });
                if (validCount > 0) {
                  const avgYPercent = (totalYCenter / validCount) * 100;
                  coverBackgroundPosition = `center ${Math.max(0, Math.min(100, avgYPercent))}%`;
                }
              }
            }
          }
        })
        .catch(e => console.error(e));
    }
  });
</script>

{#if data.error}
  <div style="text-align: center; padding-top: 10vh; color: var(--text-color);">
    <h2>{data.error}</h2>
  </div>
{:else}
<div class="header-wrapper {fallbackCoverId ? 'has-cover' : ''} {!coverLoaded && fallbackCoverId ? 'skeleton' : ''}" bind:this={headerWrapper}>
  {#if data.folderPath && data.folderPath !== data.baseFolderPath}
    {@const parts = data.folderPath.split('/')}
    {@const parentPath = parts.slice(0, -1).join('/')}
    {@const isParentBase = parentPath === data.baseFolderPath}
    {@const targetUrl = isParentBase ? `/share/${$page.params.token}` : `/share/${$page.params.token}/${parentPath.substring(data.baseFolderPath.length + 1)}`}
    <a href={targetUrl} 
       style="position: absolute; top: 24px; left: 24px; z-index: 20; color: rgba(255,255,255,0.4); text-decoration: none; display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; transition: color 0.2s, transform 0.2s;"
       onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }}
       onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}
       title="Go to parent folder">
      <ChevronLeft size={32} strokeWidth={2.5} />
    </a>
  {/if}
  {#if fallbackCoverId}
    <img src={getPreviewUrl(fallbackCoverId, false, data.token)} class="header-bg" class:loaded={coverLoaded} onload={() => coverLoaded = true} fetchpriority="high" alt="Cover" style="object-position: {coverBackgroundPosition};" />
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
      <div class="header-text-container">
        {#key data.folderPath}
          {#if data.folderPath && data.folderPath.includes('/')}
            <div class="subheading breadcrumbs">
              {#each data.folderPath.split('/').slice(0, -1) as part, index}
                {@const currentPath = data.folderPath.split('/').slice(0, index + 1).join('/')}
                {#if index > 0}<span class="separator"> &gt; </span>{/if}
                {#if currentPath === data.baseFolderPath}
                  <a href="/share/{$page.params.token}">{part}</a>
                {:else if currentPath.startsWith(data.baseFolderPath + '/')}
                  <a href="/share/{$page.params.token}/{currentPath.substring(data.baseFolderPath.length + 1)}">{part}</a>
                {:else}
                  <span class="breadcrumb unclickable" style="color: #888; cursor: default;">{part}</span>
                {/if}
              {/each}
            </div>
          {/if}
          <h2>{data.folderPath ? data.folderPath.split('/').pop() : 'Home'}</h2>
          {#if data.folderDescription}
            <p class="folder-desc">{data.folderDescription}</p>
          {/if}
        {/key}
      </div>
    </div>
    
    <div class="header-right">
      <div class="toolbar">
        <div class="dropdown-container" use:clickOutside={() => showSortMenu = false}>
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
        
        <div class="dropdown-container" use:clickOutside={() => showViewMenu = false}>
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
        
        <div class="actions">
          {#if data.share.allow_download_folder}<a href={getFolderZipUrl(data.share.folder_path, data.token)} target="_blank" class="icon-btn" title="Download ZIP"><Download size={18} /></a>{/if}
        </div>
        
      </div>
      
      <span class="count">
        {#if data.directories && data.directories.length > 0}{data.directories.length} {data.directories.length === 1 ? 'folder' : 'folders'}{#if data.files.length > 0}{' & '}{/if}{/if}{#if data.files.length > 0 || (data.directories && data.directories.length === 0)}{data.files.length} {data.files.length === 1 ? 'item' : 'items'}{/if}
      </span>
    </div>
  </div>
</div>

{#key data.folderPath}
{#if data.directories && data.directories.length > 0}
  <div class="dir-grid {data.files.length > 0 ? 'list-view' : ''}">
    {#each data.directories as dir, i}
      <a href="{$page.url.pathname.endsWith('/') ? $page.url.pathname + encodeURIComponent(dir.name) : $page.url.pathname + '/' + encodeURIComponent(dir.name)}" class="dir-card" style="animation-delay: {i * 40}ms">
        <div class="dir-cover">
          {#if dir.cover_id}
            <BlurhashImage 
              hash={dir.blurhash || ''} 
              src={`${getThumbnailUrl(dir.cover_id, data.token)}${dir.blurhash ? (getThumbnailUrl(dir.cover_id, data.token).includes('?') ? '&' : '?') + 'cb=' + encodeURIComponent(dir.blurhash) : ''}`} 
              alt={dir.name}
              objectFit="cover"
              square={true}
            />
          {:else}
            <div class="dir-placeholder"></div>
          {/if}
        </div>
        <div class="dir-info" style="position: relative; display: flex; align-items: center; justify-content: space-between; flex: 1;">
          <span class="dir-name">{dir.name}</span>
        </div>
      </a>
    {/each}
  </div>
{/if}
{/key}

{#key data.folderPath}
<div class="grid {viewMode}">
  {#each sortedFiles as file, i}
    <BlurhashImage 
      hash={file.blurhash || ''} 
      src={`${getThumbnailUrl(file.id, data.token)}${file.blurhash ? (getThumbnailUrl(file.id, data.token).includes('?') ? '&' : '?') + 'cb=' + encodeURIComponent(file.blurhash) : ''}`} 
      alt={file.file_name} 
      isVideo={file.mime_type.startsWith('video/')}
      onclick={() => openLightbox(i)}
      objectFit={viewMode.includes('square') ? 'cover' : 'contain'}
      square={viewMode.includes('square')}
      targetHeight={viewMode.includes('small') ? 150 : viewMode.includes('large') ? 350 : 250}
      priority={i < 8}
    />
  {/each}
</div>
{/key}

{#if selectedMediaIndex !== null}
  <Lightbox media={sortedFiles[selectedMediaIndex]} allowDownload={data.share.allow_download_images} isSharedView={true} on:close={closeLightbox} on:next={nextMedia} on:prev={prevMedia} />
{/if}
{/if}

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes fadeInOnly {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .header-wrapper {
    position: relative;
    margin: -24px -24px 0 -24px;
    min-height: 120px;
    z-index: 0;
  }
  
  .header-wrapper.has-cover {
    min-height: 40vh;
  }
  
  .header-wrapper.skeleton {
    background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
  
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  
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
  
  .header-left h2 {
    animation: fadeIn 0.4s ease both;
  }

  .header-left .subheading,
  .header-left .folder-desc {
    animation: fadeInOnly 0.4s ease both;
  }

  .header-text-container {
    overflow: hidden;
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
  
  .subheading a {
    color: #a1a1aa;
    text-decoration: none;
    transition: color 0.2s;
  }
  
  .subheading a:hover {
    color: var(--text-color);
    text-decoration: underline;
  }
  
  .subheading .separator {
    margin: 0 4px;
    opacity: 0.5;
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

  .dir-grid.list-view {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .dir-grid.list-view .dir-card {
    flex-direction: row;
    align-items: center;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 8px;
    width: auto;
    gap: 12px;
    border: 1px solid var(--glass-border);
  }

  .dir-grid.list-view .dir-cover {
    width: 48px;
    height: 48px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .dir-grid.list-view .dir-info {
    padding: 0;
    padding-right: 8px;
  }

  .dir-grid.list-view .dir-name {
    font-size: 1rem;
    margin: 0;
  }

  .dir-card {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: var(--text-color);
    background: transparent;
    overflow: hidden;
    transition: filter 0.2s ease;
    animation: fadeIn 0.35s ease both;
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
