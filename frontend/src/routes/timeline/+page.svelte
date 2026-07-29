<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl } from '$lib/api/media';
  import { getSortDate, formatDate } from '$lib/utils/date';
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import { ArrowDownUp, LayoutGrid } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';

  let { data }: { data: PageData } = $props();

  type SortMode = 'newest' | 'oldest' | 'a-z' | 'z-a';
  type ViewMode = 'small-fit' | 'large-fit' | 'small-square' | 'large-square';

  function loadPref<T>(key: string, fallback: T): T {
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
  }

  let sortMode: SortMode = $state(loadPref<SortMode>('timelineSortMode', 'newest'));
  let viewMode: ViewMode = $state(loadPref<ViewMode>('timelineViewMode', 'small-fit'));

  $effect(() => savePref('timelineSortMode', sortMode));
  $effect(() => savePref('timelineViewMode', viewMode));

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);

  function getAspectRatio(file: any): number | undefined {
    const exif = file.exif_json;
    if (exif) {
      const w = exif.ExifImageWidth || exif.ImageWidth;
      const h = exif.ExifImageHeight || exif.ImageHeight;
      if (w && h && w > 0 && h > 0) return w / h;
    }
    return undefined;
  }

  let sortedFiles = $derived([...data.files].sort((a, b) => {
    if (sortMode === 'newest') return getSortDate(b) - getSortDate(a);
    if (sortMode === 'oldest') return getSortDate(a) - getSortDate(b);
    if (sortMode === 'a-z') return a.file_name.localeCompare(b.file_name);
    if (sortMode === 'z-a') return b.file_name.localeCompare(a.file_name);
    return 0;
  }));

  type DateGroup = { date: string; files: { file: any; index: number }[] };

  let dateGroups = $derived.by<DateGroup[]>(() => {
    if (sortMode !== 'newest' && sortMode !== 'oldest') return [];
    const groups: DateGroup[] = [];
    let currentGroup: DateGroup | null = null;
    sortedFiles.forEach((file, idx) => {
      const dateStr = formatDate(file);
      if (!currentGroup || currentGroup.date !== dateStr) {
        currentGroup = { date: dateStr, files: [] };
        groups.push(currentGroup);
      }
      currentGroup.files.push({ file, index: idx });
    });
    return groups;
  });

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

  let pollInterval: ReturnType<typeof setInterval>;

  onMount(() => {
    pollInterval = setInterval(() => {
      const stillProcessing = data.files.some(f => !f.blurhash);
      if (stillProcessing) {
        invalidateAll();
      }
    }, 2000);

    function updateStickyBottom() {
      const header = document.querySelector<HTMLElement>('.sticky-header');
      if (header) {
        const topOffset = parseFloat(getComputedStyle(header).top) || 0;
        document.documentElement.style.setProperty('--sticky-header-bottom', (header.offsetHeight + topOffset + 8) + 'px');
      }
    }

    updateStickyBottom();
    window.addEventListener('resize', updateStickyBottom);

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      window.removeEventListener('resize', updateStickyBottom);
    };
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });
</script>

<div class="sticky-header" style="background: rgba(0,0,0,0.9); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-bottom-color: rgba(255,255,255,0.05);">
  <div class="header-content">
    <div class="header-left">
      <h2>Timeline</h2>
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
      </div>
      <span class="count">{data.files.length} {data.files.length === 1 ? 'item' : 'items'}</span>
    </div>
  </div>
</div>

<div class="timeline-container">
  {#if data.files.length === 0}
    <div style="text-align: center; color: #888; padding: 64px 0;">
      <p>No media files found. Check the Admin tab to trigger a scan.</p>
    </div>
  {:else if dateGroups.length > 0}
    {#each dateGroups as group}
      <div class="timeline-group">
        <h3 class="date-header">{group.date}</h3>
        <div class="grid {viewMode}">
          {#each group.files as entry, i}
            <BlurhashImage 
              hash={entry.file.blurhash || ''} 
              src={`${getThumbnailUrl(entry.file.id)}${entry.file.blurhash ? '?cb=' + encodeURIComponent(entry.file.blurhash) : ''}`} 
              alt={entry.file.file_name} 
              isVideo={entry.file.mime_type.startsWith('video/')}
              onclick={() => openLightbox(entry.index)}
              objectFit={viewMode.includes('square') ? 'cover' : 'contain'}
              square={viewMode.includes('square')}
              targetHeight={viewMode.includes('small') ? 150 : viewMode.includes('large') ? 350 : 250}
              priority={i < 8}
              initialAspectRatio={getAspectRatio(entry.file)}
            />
          {/each}
        </div>
      </div>
    {/each}
  {:else}
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
          priority={i < 8}
          initialAspectRatio={getAspectRatio(file)}
        />
      {/each}
    </div>
  {/if}
</div>

{#if selectedMediaIndex !== null}
  <Lightbox 
    media={sortedFiles[selectedMediaIndex]} 
    onclose={closeLightbox}
    onnext={nextMedia}
    onprev={prevMedia}
  />
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

  .sticky-header {
    position: sticky;
    top: -25px;
    z-index: 50;
    margin: 0 -24px 24px -24px;
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

  .timeline-container {
    padding-bottom: 64px;
  }

  .timeline-group {
    margin-bottom: 48px;
  }

  .timeline-group .grid {
    padding-bottom: 0;
  }

  .date-header {
    position: sticky;
    top: var(--sticky-header-bottom, 100px);
    z-index: 40;
    background: var(--bg-color, #000);
    padding: 8px 0;
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 16px;
    color: var(--text-color);
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
</style>
