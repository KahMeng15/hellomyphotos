<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl } from '$lib/api/media';
  import type { PageData } from './$types';
  import { ArrowDownUp, LayoutGrid } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';
  import { getSortDate } from '$lib/utils/date';
  import { currentUser } from '$lib/stores/auth';
  import { updatePreferences } from '$lib/api/auth';
  import { onMount } from 'svelte';

  let { data }: { data: PageData } = $props();

  type SortMode = 'newest' | 'oldest' | 'a-z' | 'z-a';
  type ViewMode = 'small-fit' | 'large-fit' | 'small-square' | 'large-square';

  function loadPref<T>(key: string, fallback: T): T {
    if ($currentUser && $currentUser.preferences && $currentUser.preferences[key] !== undefined) {
      return $currentUser.preferences[key] as T;
    }
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) as T : fallback;
    } catch { return fallback; }
  }

  function savePref(key: string, val: any) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(val));
    }
    if ($currentUser) {
      if (!$currentUser.preferences) $currentUser.preferences = {};
      if ($currentUser.preferences[key] !== val) {
        $currentUser.preferences[key] = val;
        updatePreferences($currentUser.preferences).catch(err => {
          console.error('Failed to save preference to DB:', err);
        });
      }
    }
  }

  let sortMode: SortMode = $state('newest');
  let viewMode: ViewMode = $state('small-fit');

  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);

  let hasSyncedPreferences = $state(false);
  $effect(() => {
    if ($currentUser && $currentUser.preferences && !hasSyncedPreferences) {
      hasSyncedPreferences = true;
      if ($currentUser.preferences.folderSortMode) sortMode = $currentUser.preferences.folderSortMode as SortMode;
      if ($currentUser.preferences.folderViewMode) viewMode = $currentUser.preferences.folderViewMode as ViewMode;
    }
  });

  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderSortMode', sortMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderViewMode', viewMode); });

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);

  function getAspectRatio(file: { exif_json?: any }): number | undefined {
    const exif = file.exif_json;
    if (exif) {
      const w = exif.ExifImageWidth || exif.ImageWidth || exif.width;
      const h = exif.ExifImageHeight || exif.ImageHeight || exif.height;
      if (w && h && w > 0 && h > 0) return w / h;
    }
    return undefined;
  }

  let sortedFiles = $derived([...data.results].sort((a, b) => {
    if (sortMode === 'newest') return getSortDate(b) - getSortDate(a);
    if (sortMode === 'oldest') return getSortDate(a) - getSortDate(b);
    if (sortMode === 'a-z') return a.file_name.localeCompare(b.file_name);
    if (sortMode === 'z-a') return b.file_name.localeCompare(a.file_name);
    return 0;
  }));

  let visibleCount = $state(50);
  let visibleFiles = $derived(sortedFiles.slice(0, visibleCount));

  function loadMore() {
    visibleCount += 50;
  }

  function infiniteScroll(node: HTMLElement) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore();
      }
    }, { rootMargin: '800px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

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

  onMount(() => {
    sortMode = loadPref<SortMode>('folderSortMode', 'newest');
    viewMode = loadPref<ViewMode>('folderViewMode', 'small-fit');

    windowWidth = window.innerWidth;
    const updateWidth = () => windowWidth = window.innerWidth;
    window.addEventListener('resize', updateWidth);

    return () => {
      window.removeEventListener('resize', updateWidth);
    };
  });
</script>

<div class="sticky-header">
  <div class="header-content">
    <div class="header-left">
      <div class="header-text-container">
        <h2>Search Results</h2>
        {#if data.q}
          <div class="subheading">for "{data.q}"</div>
          <div class="count">{data.results.length} matches found</div>
        {:else}
          <div class="count">Please enter a search query</div>
        {/if}
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
              <button class:active={viewMode === 'small-fit'} onclick={() => { viewMode = 'small-fit'; showViewMenu = false; }}>Small (Fit)</button>
              <button class:active={viewMode === 'large-fit'} onclick={() => { viewMode = 'large-fit'; showViewMenu = false; }}>Large (Fit)</button>
              <button class:active={viewMode === 'small-square'} onclick={() => { viewMode = 'small-square'; showViewMenu = false; }}>Small (Square)</button>
              <button class:active={viewMode === 'large-square'} onclick={() => { viewMode = 'large-square'; showViewMenu = false; }}>Large (Square)</button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

{#if data.results.length === 0 && data.q}
  <div class="empty-state">
    <h3 style="color: var(--text-color); margin-bottom: 8px;">No results found</h3>
    <p style="color: #a1a1aa; max-width: 400px; margin: 0 auto;">No photos matched "{data.q}". Try different keywords.</p>
  </div>
{/if}

{#key data.q}
<div class="grid {viewMode}">
  {#each visibleFiles as file, i}
    <BlurhashImage 
      hash={file.blurhash || ''} 
      src={`${getThumbnailUrl(file.id)}${file.blurhash ? '?cb=' + encodeURIComponent(file.blurhash) : ''}`} 
      alt={file.file_name} 
      isVideo={file.mime_type.startsWith('video/')}
      onclick={() => openLightbox(i)}
      objectFit={viewMode.includes('square') ? 'cover' : 'contain'}
      square={viewMode.includes('square')}
      targetHeight={viewMode.includes('small') ? (windowWidth <= 430 ? 100 : 150) : viewMode.includes('large') ? 350 : 250}
      priority={i < 8}
      initialAspectRatio={getAspectRatio(file)}
    />
  {/each}
</div>
{#if visibleCount < sortedFiles.length}
  <div use:infiniteScroll style="height: 20px; width: 100%;"></div>
{/if}
{/key}

{#if selectedMediaIndex !== null}
  <Lightbox 
    media={sortedFiles[selectedMediaIndex]} 
    onclose={closeLightbox}
    onnext={nextMedia}
    onprev={prevMedia}
  />
{/if}

<style>
  .sticky-header {
    position: sticky;
    top: -24px;
    margin: -24px -24px 24px -24px;
    padding: 24px 24px 16px 24px;
    background: rgba(0,0,0,0.8);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid rgba(255,255,255,0.05);
    z-index: 50;
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .header-text-container {
    display: flex;
    flex-direction: column;
  }
  
  .header-text-container h2 {
    font-size: 2rem;
    font-weight: 600;
    margin: 0 0 4px 0;
    color: var(--text-color);
    letter-spacing: -0.02em;
    font-family: 'Instrument Sans', sans-serif;
  }
  
  .subheading {
    color: var(--accent-color);
    font-size: 1rem;
    margin-bottom: 4px;
    font-family: 'Instrument Sans', sans-serif;
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
    min-width: 140px;
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
  }

  .empty-state {
    text-align: center;
    padding: 64px 0;
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

  .grid.small-fit::after, .grid.large-fit::after {
    content: "";
    flex-grow: 999999999;
  }

  @media (max-width: 768px) {
    .grid.small-square {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (max-width: 430px) {
    .sticky-header {
      margin: -16px -16px 16px -16px;
      padding: 16px;
    }
    
    .header-text-container h2 {
      font-size: 1.5rem;
    }
  }
</style>
