<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, getPreviewUrl, API_BASE } from '$lib/api/media';
  import type { PageData } from './$types';
  import { onMount, onDestroy } from 'svelte';
  import { ArrowDownUp, ChevronLeft, LayoutGrid } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';

  let { data }: { data: PageData } = $props();

  let selectedMediaIndex: number | null = $state(null);
  let isEditingName = $state(false);
  let editNameValue = $state(data.personName);
  let isSaving = $state(false);

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

  let sortMode: SortMode = $state(loadPref<SortMode>('personSortMode', 'newest'));
  let viewMode: ViewMode = $state(loadPref<ViewMode>('personViewMode', 'small-fit'));

  $effect(() => savePref('personSortMode', sortMode));
  $effect(() => savePref('personViewMode', viewMode));

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

  let fallbackCoverId = $derived(data.coverMediaId || (data.files.length > 0 ? data.files[0].id : null));

  let coverObjectPosition = $derived.by(() => {
    const bb = data.coverBoundingBox;
    const iw = data.coverImgWidth;
    const ih = data.coverImgHeight;
    if (!bb || !iw || !ih) return 'center 30%';
    const x1 = bb.x1 ?? bb.x ?? 0;
    const y1 = bb.y1 ?? bb.y ?? 0;
    const x2 = bb.x2 ?? (x1 + (bb.w || 200));
    const y2 = bb.y2 ?? (y1 + (bb.h || 200));
    return `${((x1 + x2) / 2 / iw) * 100}% ${((y1 + y2) / 2 / ih) * 100}%`;
  });



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

  async function saveName() {
    if (!editNameValue.trim() || editNameValue.trim() === data.personName) {
      isEditingName = false;
      return;
    }
    isSaving = true;
    try {
      const res = await fetch(`${API_BASE}/api/faces/${data.id}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editNameValue.trim() }),
        credentials: 'include'
      });
      if (res.ok) {
        data.personName = editNameValue.trim();
        isEditingName = false;
      }
    } catch (e) {
      console.error(e);
    } finally {
      isSaving = false;
    }
  }

  let scrollProgress = $state(0);
  let headerWrapper: HTMLElement | undefined = $state();

  function handleScroll(e: Event) {
    if (!headerWrapper) return;
    const target = e.target as HTMLElement;
    const threshold = headerWrapper.offsetHeight - 25;
    if (threshold > 0) {
      scrollProgress = Math.min(1, Math.max(0, target.scrollTop / threshold));
    }
  }

  onMount(() => {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
    };
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
    }
  });
</script>

<div class="header-wrapper {fallbackCoverId ? 'has-cover' : ''}" bind:this={headerWrapper}>
  <a href="/people"
     style="position: absolute; top: 24px; left: 24px; z-index: 20; color: rgba(255,255,255,0.4); text-decoration: none; display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; transition: color 0.2s, transform 0.2s;"
     onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }}
     onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}
     title="Back to all people">
    <ChevronLeft size={32} strokeWidth={2.5} />
  </a>
  {#if fallbackCoverId}
    <img src={getPreviewUrl(fallbackCoverId, false)} class="header-bg" fetchpriority="high" alt="Cover" style="object-position: {coverObjectPosition};" />
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
          {#if isEditingName}
            <div class="edit-row">
              <input
                type="text"
                bind:value={editNameValue}
                class="name-input"
                placeholder="Add a name"
                onkeydown={(e) => e.key === 'Enter' && saveName()}
                disabled={isSaving}
                autofocus
              />
              <button class="btn primary" onclick={saveName} disabled={isSaving}>Save</button>
              <button class="btn" onclick={() => { isEditingName = false; editNameValue = data.personName; }}>Cancel</button>
            </div>
          {:else}
            <h2>
              {#if data.personName}
                {data.personName}
              {/if}
              <button class="icon-btn" onclick={() => isEditingName = true} title="Rename">✎</button>
            </h2>
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
    />
  {/each}
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
    object-fit: cover;
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
    flex-direction: row;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--text-color);
    background: transparent;
    font-weight: 700;
    font-size: 2.5rem;
    margin-bottom: 0;
    text-shadow: 0 2px 10px rgba(0,0,0,0.5);
  }

  .header-text-container {
    overflow: hidden;
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

  .edit-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .name-input {
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255,255,255,0.15);
    color: #f1f5f9;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 1.2rem;
    font-weight: 500;
    text-shadow: 0 1px 4px rgba(0,0,0,0.5);
    min-width: 250px;
  }
  .name-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  .btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.1);
    color: #e4e4e7;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.18);
    color: white;
  }
  .btn.primary {
    background: var(--text-color);
    color: var(--bg-color);
  }
  .btn.primary:hover {
    background: #e4e4e7;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

</style>
