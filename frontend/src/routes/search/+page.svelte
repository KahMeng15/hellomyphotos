<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, getStreamUrl, API_BASE, type MediaFile } from '$lib/api/media';
  import type { PageData } from './$types';
  import { ArrowDownUp, LayoutGrid, List, Check, Film, Image as ImageIcon, Download, Loader2 } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';
  import { getSortDate, getRawDate } from '$lib/utils/date';
  import { currentUser } from '$lib/stores/auth';
  import { updatePreferences } from '$lib/api/auth';
  import { onMount, untrack, onDestroy } from 'svelte';

  let { data }: { data: PageData } = $props();

  type SortMode = 'relevance' | 'newest' | 'oldest' | 'a-z' | 'z-a';
  type ViewMode = 'small-fit' | 'large-fit' | 'small-square' | 'large-square' | 'compact-list';

  function formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatFileDate(file: { exif_json?: Record<string, unknown> | null; created_at?: string | null }): string {
    const d = getRawDate(file);
    if (isNaN(d.getTime()) || d.getTime() === 0) return '—';
    const clientLocale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined;
    return d.toLocaleDateString(clientLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function getFileDimensions(file: { img_width?: number | null; img_height?: number | null; exif_json?: any }): string {
    const w = file.img_width || file.exif_json?.ExifImageWidth || file.exif_json?.ImageWidth || file.exif_json?.width;
    const h = file.img_height || file.exif_json?.ExifImageHeight || file.exif_json?.ImageHeight || file.exif_json?.height;
    if (w && h) return `${w} × ${h}`;
    return '—';
  }

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

  let sortMode: SortMode = $state('relevance');
  let viewMode: ViewMode = $state('small-fit');
  let showFileNames: boolean = $state(false);

  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);

  let hasSyncedPreferences = $state(false);
  $effect(() => {
    if ($currentUser && $currentUser.preferences && !hasSyncedPreferences) {
      hasSyncedPreferences = true;
      if ($currentUser.preferences.searchSortMode) sortMode = $currentUser.preferences.searchSortMode as SortMode;
      if ($currentUser.preferences.folderViewMode) viewMode = $currentUser.preferences.folderViewMode as ViewMode;
      if ($currentUser.preferences.showFileNames !== undefined) showFileNames = !!$currentUser.preferences.showFileNames;
    }
  });

  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('searchSortMode', sortMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderViewMode', viewMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('showFileNames', showFileNames); });

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);

  function cycleViewMode() {
    const modes: ViewMode[] = ['small-fit', 'large-fit', 'small-square', 'large-square', 'compact-list'];
    const idx = modes.indexOf(viewMode);
    viewMode = modes[(idx + 1) % modes.length];
    showViewMenu = false;
  }

  function isTyping(e: Event): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (selectedMediaIndex !== null) return;
    if (isTyping(e)) return;
    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      cycleViewMode();
    }
  }

  function getAspectRatio(file: any): number | undefined {
    if (file.img_width && file.img_height && file.img_width > 0 && file.img_height > 0) {
      return file.img_width / file.img_height;
    }
    const exif = file.exif_json;
    if (exif) {
      let w = exif.ExifImageWidth || exif.ImageWidth || exif.width;
      let h = exif.ExifImageHeight || exif.ImageHeight || exif.height;
      const orient = exif.Orientation;
      const isRotated90 = (typeof orient === 'number' && [5, 6, 7, 8].includes(orient)) ||
        (typeof orient === 'string' && (orient.includes('90') || orient.includes('270') || orient.includes('Rotate 90') || orient.includes('Rotate 270')));
      if (isRotated90 && w && h) {
        const temp = w;
        w = h;
        h = temp;
      }
      if (w && h && w > 0 && h > 0) return w / h;
    }
    return undefined;
  }

  const PAGE_SIZE = 50;
  let allFiles = $state<MediaFile[]>([...(data.results || [])]);
  let isLoadingMore = $state(false);
  // Defensive check: PAGE_SIZE (50) or 40 (pgvector default hnsw.ef_search limit) indicates there may be more results
  let hasMore = $state((data.results || []).length >= PAGE_SIZE || (data.results || []).length === 40);
  let lastDataQ = data.q;

  $effect(() => {
    const newQ = data.q;
    const newResults = data.results || [];
    untrack(() => {
      if (newQ !== lastDataQ) {
        lastDataQ = newQ;
        allFiles = [...newResults];
        hasMore = newResults.length >= PAGE_SIZE || newResults.length === 40;
        isLoadingMore = false;
      }
    });
  });

  async function loadMore() {
    if (isLoadingMore || !hasMore || !data.q) return;
    isLoadingMore = true;
    try {
      const currentOffset = allFiles.length;
      const res = await fetch(`${API_BASE}/api/media/search?q=${encodeURIComponent(data.q)}&limit=${PAGE_SIZE}&offset=${currentOffset}`);
      if (!res.ok) throw new Error('Search failed');
      const nextBatch: MediaFile[] = await res.json();
      if (nextBatch.length > 0) {
        const existing = new Set(allFiles.map(f => f.id));
        const unique = nextBatch.filter(f => !existing.has(f.id));
        if (unique.length > 0) {
          allFiles = [...allFiles, ...unique];
          // If the batch returned PAGE_SIZE or 40 items and yielded new unique items, continue pagination
          hasMore = nextBatch.length >= PAGE_SIZE || nextBatch.length === 40;
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    } catch (e) {
      console.error('Failed to load more results:', e);
      hasMore = false;
    } finally {
      isLoadingMore = false;
    }
  }

  function infiniteScroll(node: HTMLElement) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        loadMore();
      }
    }, { rootMargin: '600px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  let sortedFiles = $derived([...allFiles].sort((a, b) => {
    if (sortMode === 'relevance') {
      return (a.distance ?? 0) - (b.distance ?? 0);
    }
    if (sortMode === 'newest') return getSortDate(b) - getSortDate(a);
    if (sortMode === 'oldest') return getSortDate(a) - getSortDate(b);
    if (sortMode === 'a-z') return a.file_name.localeCompare(b.file_name);
    if (sortMode === 'z-a') return b.file_name.localeCompare(a.file_name);
    return 0;
  }));

  let selectedMediaIndex: number | null = $state(null);

  function handleFavoriteUpdated(id: string, isFavorite: boolean) {
    allFiles = allFiles.map((f: MediaFile) => f.id === id ? { ...f, is_favorite: isFavorite } : f);
  }

  function openLightbox(index: number) {
    selectedMediaIndex = index;
  }
  
  function closeLightbox() {
    selectedMediaIndex = null;
  }
  
  function nextMedia() {
    if (selectedMediaIndex !== null) {
      if (selectedMediaIndex < sortedFiles.length - 1) {
        selectedMediaIndex++;
        if (selectedMediaIndex >= sortedFiles.length - 5 && hasMore && !isLoadingMore) {
          loadMore();
        }
      } else if (hasMore && !isLoadingMore) {
        loadMore().then(() => {
          if (selectedMediaIndex !== null && selectedMediaIndex < sortedFiles.length - 1) {
            selectedMediaIndex++;
          }
        });
      }
    }
  }

  function prevMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex > 0) {
      selectedMediaIndex--;
    }
  }

  onMount(() => {
    sortMode = loadPref<SortMode>('searchSortMode', 'relevance');
    viewMode = loadPref<ViewMode>('folderViewMode', 'small-fit');
    showFileNames = loadPref<boolean>('showFileNames', false);

    windowWidth = window.innerWidth;
    const updateWidth = () => windowWidth = window.innerWidth;
    window.addEventListener('resize', updateWidth);
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('resize', updateWidth);
      window.removeEventListener('keydown', handleKeydown);
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
        {:else}
          <div class="subheading">Please enter a search query</div>
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
              <button class:active={sortMode === 'relevance'} onclick={() => { sortMode = 'relevance'; showSortMenu = false; }}>Most Relevant</button>
              <button class:active={sortMode === 'newest'} onclick={() => { sortMode = 'newest'; showSortMenu = false; }}>Newest to Oldest</button>
              <button class:active={sortMode === 'oldest'} onclick={() => { sortMode = 'oldest'; showSortMenu = false; }}>Oldest to Newest</button>
              <button class:active={sortMode === 'a-z'} onclick={() => { sortMode = 'a-z'; showSortMenu = false; }}>A to Z</button>
              <button class:active={sortMode === 'z-a'} onclick={() => { sortMode = 'z-a'; showSortMenu = false; }}>Z to A</button>
            </div>
          {/if}
        </div>
        
        <div class="dropdown-container" use:clickOutside={() => showViewMenu = false}>
          <button class="icon-btn" onclick={() => { showViewMenu = !showViewMenu; showSortMenu = false; }} title="View (V)">
            {#if viewMode === 'compact-list'}
              <List size={18} />
            {:else}
              <LayoutGrid size={18} />
            {/if}
          </button>
          {#if showViewMenu}
            <div class="dropdown-menu">
              <button class:active={viewMode === 'small-fit'} onclick={() => { viewMode = 'small-fit'; showViewMenu = false; }}>Small Fit Size</button>
              <button class:active={viewMode === 'large-fit'} onclick={() => { viewMode = 'large-fit'; showViewMenu = false; }}>Large Fit Size</button>
              <button class:active={viewMode === 'small-square'} onclick={() => { viewMode = 'small-square'; showViewMenu = false; }}>Small Square Grid</button>
              <button class:active={viewMode === 'large-square'} onclick={() => { viewMode = 'large-square'; showViewMenu = false; }}>Large Square Grid</button>
              <button class:active={viewMode === 'compact-list'} onclick={() => { viewMode = 'compact-list'; showViewMenu = false; }}>Compact List</button>
              <div class="dropdown-divider"></div>
              <button class="toggle-item" class:active={showFileNames} onclick={() => { showFileNames = !showFileNames; showViewMenu = false; }}>
                <span>Show File Names</span>
                {#if showFileNames}
                  <Check size={16} />
                {/if}
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

{#if allFiles.length === 0 && data.q}
  <div class="empty-state">
    <h3 style="color: var(--text-color); margin-bottom: 8px;">No results found</h3>
    <p style="color: #a1a1aa; max-width: 400px; margin: 0 auto;">No photos matched "{data.q}". Try different keywords.</p>
  </div>
{/if}

{#key data.q}
{#if viewMode === 'compact-list'}
  <div class="compact-media-list">
    <div class="compact-list-header">
      <button 
        type="button" 
        class="compact-th col-name" 
        onclick={() => { sortMode = sortMode === 'a-z' ? 'z-a' : 'a-z'; }}
        title="Sort by Name"
      >
        <span>Name</span>
        {#if sortMode === 'a-z'}
          <span class="sort-indicator">↑</span>
        {:else if sortMode === 'z-a'}
          <span class="sort-indicator">↓</span>
        {/if}
      </button>
      <button 
        type="button" 
        class="compact-th col-date" 
        onclick={() => { sortMode = sortMode === 'newest' ? 'oldest' : 'newest'; }}
        title="Sort by Date"
      >
        <span>Date</span>
        {#if sortMode === 'newest'}
          <span class="sort-indicator">↓</span>
        {:else if sortMode === 'oldest'}
          <span class="sort-indicator">↑</span>
        {/if}
      </button>
      <div class="compact-th col-res">
        <span>Dimensions</span>
      </div>
      <div class="compact-th col-size">
        <span>Size</span>
      </div>
      <div class="compact-th col-actions"></div>
    </div>
    <div class="compact-list-body">
      {#each sortedFiles as file, i (file.id)}
        {@const isVideo = file.mime_type.startsWith('video/')}
        <div 
          class="compact-row" 
          role="button" 
          tabindex="0"
          onclick={() => openLightbox(i)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(i); } }}
          title={`Open ${file.file_name}`}
        >
          <div class="col-name">
            <span class="file-icon" class:video={isVideo}>
              {#if isVideo}
                <Film size={16} />
              {:else}
                <ImageIcon size={16} />
              {/if}
            </span>
            <div style="display: flex; flex-direction: column; overflow: hidden; min-width: 0;">
              <span class="file-name" title={file.file_name}>{file.file_name}</span>
            </div>
          </div>
          <div class="col-date">{formatFileDate(file)}</div>
          <div class="col-res">{getFileDimensions(file)}</div>
          <div class="col-size">{formatBytes(file.size_bytes)}</div>
          <div class="col-actions" onclick={(e) => e.stopPropagation()}>
            <a 
              href={`${getStreamUrl(file.id)}?download=1`} 
              download={file.file_name} 
              class="compact-action-btn" 
              title="Download"
              aria-label="Download"
            >
              <Download size={15} />
            </a>
          </div>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="grid {viewMode}">
    {#each sortedFiles as file, i (file.id)}
      <BlurhashImage 
        hash={file.blurhash || ''} 
        src={`${getThumbnailUrl(file.id)}${file.blurhash ? '?cb=' + encodeURIComponent(file.blurhash) : ''}`} 
        alt={file.file_name} 
        fileName={file.file_name}
        showFileName={showFileNames}
        isVideo={file.mime_type.startsWith('video/')}
        onclick={() => openLightbox(i)}
        objectFit={viewMode.includes('square') ? 'cover' : 'contain'}
        square={viewMode.includes('square')}
        targetHeight={viewMode.includes('small') ? (windowWidth <= 768 ? 100 : 150) : viewMode.includes('large') ? (windowWidth <= 768 ? 200 : 350) : 250}
        priority={i < 8}
        initialAspectRatio={getAspectRatio(file)}
      />
    {/each}
  </div>
{/if}

{#if hasMore}
  <div use:infiniteScroll style="height: 20px; width: 100%;"></div>
{/if}

{#if isLoadingMore}
  <div class="status-indicator">
    <Loader2 size={18} class="loading-spinner" />
    <span>Loading more matches...</span>
  </div>
{:else if !hasMore && allFiles.length > 0}
  <div class="status-indicator end-of-results">
    <span>End of results</span>
  </div>
{/if}
{/key}

{#if selectedMediaIndex !== null && sortedFiles[selectedMediaIndex]}
  <Lightbox 
    media={sortedFiles[selectedMediaIndex]} 
    canFavorite={true}
    onfavoriteupdated={handleFavoriteUpdated}
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
    min-width: 170px;
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

  .dropdown-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.12);
    margin: 4px 0;
  }

  .dropdown-menu button.toggle-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .empty-state {
    text-align: center;
    padding: 64px 0;
  }

  .grid {
    padding-bottom: 24px;
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

  /* Compact Media List Styles */
  .compact-media-list {
    margin-bottom: 32px;
    background: rgba(20, 20, 25, 0.4);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    overflow: hidden;
  }

  .compact-list-header {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid var(--glass-border);
    padding: 0 16px;
    height: 38px;
  }

  .compact-th {
    background: none;
    border: none;
    color: #a1a1aa;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: inherit;
    cursor: default;
    user-select: none;
  }

  button.compact-th {
    cursor: pointer;
    transition: color 0.15s ease;
  }

  button.compact-th:hover {
    color: #f4f4f5;
  }

  .sort-indicator {
    font-size: 0.85rem;
    color: #3b82f6;
    line-height: 1;
  }

  .compact-list-body {
    display: flex;
    flex-direction: column;
  }

  .compact-row {
    display: flex;
    align-items: center;
    padding: 0 16px;
    height: 40px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: var(--text-color, #f4f4f5);
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .compact-row:last-child {
    border-bottom: none;
  }

  .compact-row:nth-child(even) {
    background: rgba(255, 255, 255, 0.015);
  }

  .compact-row:hover,
  .compact-row:focus-visible {
    background: rgba(255, 255, 255, 0.07);
    outline: none;
  }

  .compact-media-list .col-name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding-right: 12px;
  }

  .compact-media-list .file-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #60a5fa;
    flex-shrink: 0;
  }

  .compact-media-list .file-icon.video {
    color: #c084fc;
  }

  .compact-media-list .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 450;
  }

  .compact-media-list .col-date {
    width: 140px;
    flex-shrink: 0;
    color: #a1a1aa;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .compact-media-list .col-res {
    width: 130px;
    flex-shrink: 0;
    color: #a1a1aa;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .compact-media-list .col-size {
    width: 80px;
    flex-shrink: 0;
    color: #a1a1aa;
    font-size: 0.8rem;
    text-align: right;
    white-space: nowrap;
    justify-content: flex-end;
  }

  .compact-media-list .col-actions {
    width: 44px;
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
  }

  .compact-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: #a1a1aa;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
  }

  .compact-action-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  .status-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px 0 48px;
    color: #a1a1aa;
    font-size: 0.875rem;
  }

  .status-indicator.end-of-results {
    color: #71717a;
  }

  :global(.loading-spinner) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @media (max-width: 768px) {
    .grid {
      margin: 0 -24px;
    }
    .grid.small-square {
      grid-template-columns: repeat(3, 1fr);
    }
    .sticky-header {
      margin: -24px -24px 16px -24px;
      padding: 10px 24px;
    }
    .header-text-container h2 {
      font-size: 1.5rem;
    }
    .compact-media-list .col-res {
      display: none;
    }
    .compact-media-list .col-date {
      width: 110px;
    }
  }

  @media (max-width: 520px) {
    .compact-media-list .col-date {
      display: none;
    }
    .compact-media-list {
      margin-left: -12px;
      margin-right: -12px;
      border-radius: 0;
      border-left: none;
      border-right: none;
    }
  }
</style>
