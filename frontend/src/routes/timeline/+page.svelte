<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl } from '$lib/api/media';
  import { getSortDate, formatDate, getRawDate } from '$lib/utils/date';
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
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

  let sortMode: SortMode = $state((data as any).defaultSortMode || 'oldest');
  let viewMode: ViewMode = $state((data as any).defaultViewMode || 'small-fit');
  
  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);

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

  type DateGroup = {
    date: string;
    files: { file: any; index: number }[];
    rawDate: Date;
    year: number;
    month: number;
    monthName: string;
    fullMonthName: string;
    day: number;
    weekday: string;
  };

  let dateGroups = $derived.by<DateGroup[]>(() => {
    if (sortMode !== 'newest' && sortMode !== 'oldest') return [];
    const groups: DateGroup[] = [];
    let currentGroup: DateGroup | null = null;
    sortedFiles.forEach((file, idx) => {
      const dateStr = formatDate(file);
      if (!currentGroup || currentGroup.date !== dateStr) {
        const raw = getRawDate(file);
        currentGroup = {
          date: dateStr,
          files: [],
          rawDate: raw,
          year: raw.getFullYear(),
          month: raw.getMonth(),
          monthName: raw.toLocaleDateString('en-US', { month: 'short' }),
          fullMonthName: raw.toLocaleDateString('en-US', { month: 'long' }),
          day: raw.getDate(),
          weekday: raw.toLocaleDateString('en-US', { weekday: 'long' })
        };
        groups.push(currentGroup);
      }
      currentGroup.files.push({ file, index: idx });
    });
    return groups;
  });

  // Date Scrubber state & logic
  type ScrubberMarker = {
    id: string;
    label: string;
    fullLabel: string;
    groupIndex: number;
    year: number;
    month: number;
    isYear: boolean;
    progress: number;
  };

  let scrollContainer: HTMLElement | null = null;
  let trackEl: HTMLElement | null = $state(null);
  let trackHeight = $state(400);
  let isDragging = $state(false);
  let isScrolling = $state(false);
  let isTrackHovered = $state(false);
  let scrollRatio = $state(0);
  let activeGroupIndex = $state(0);
  let groupElements: HTMLElement[] = $state([]);
  let hideBadgeTimeout: ReturnType<typeof setTimeout> | null = null;

  let activeGroup = $derived(dateGroups[activeGroupIndex] || dateGroups[0]);
  let activeMarkerId = $derived(
    activeGroup ? `${activeGroup.year}-${activeGroup.month}` : ''
  );

  const thumbHeight = 36;
  let thumbOffset = $derived.by(() => {
    const available = Math.max(0, trackHeight - thumbHeight);
    return scrollRatio * available;
  });

  let uniqueYears = $derived(Array.from(new Set(dateGroups.map(g => g.year))));

  let scrubberMarkers = $derived.by<ScrubberMarker[]>(() => {
    if (dateGroups.length <= 1) return [];

    const totalGroups = dateGroups.length;
    const markers: ScrubberMarker[] = [];

    if (uniqueYears.length > 2) {
      let lastYear: number | null = null;
      dateGroups.forEach((g, idx) => {
        if (g.year !== lastYear) {
          lastYear = g.year;
          markers.push({
            id: `year-${g.year}`,
            label: String(g.year),
            fullLabel: String(g.year),
            groupIndex: idx,
            year: g.year,
            month: g.month,
            isYear: true,
            progress: idx / Math.max(1, totalGroups - 1)
          });
        }
      });
    } else {
      let lastYM = '';
      dateGroups.forEach((g, idx) => {
        const ym = `${g.year}-${g.month}`;
        if (ym !== lastYM) {
          const isNewYear = !lastYM || !lastYM.startsWith(`${g.year}-`);
          lastYM = ym;
          markers.push({
            id: `ym-${ym}`,
            label: isNewYear && uniqueYears.length > 1 ? `${g.year} ${g.monthName}` : g.monthName,
            fullLabel: `${g.fullMonthName} ${g.year}`,
            groupIndex: idx,
            year: g.year,
            month: g.month,
            isYear: isNewYear,
            progress: idx / Math.max(1, totalGroups - 1)
          });
        }
      });
    }

    return markers;
  });

  function updateActiveGroupFromScroll() {
    if (!scrollContainer || dateGroups.length === 0) return;
    const header = document.querySelector<HTMLElement>('.sticky-header');
    const headerBottom = header ? (header.offsetHeight - 25) : 71;
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetY = containerRect.top + headerBottom + 20;

    let closestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < groupElements.length; i++) {
      const el = groupElements[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top <= targetY && rect.bottom >= targetY) {
        closestIdx = i;
        break;
      }
      const dist = Math.abs(rect.top - targetY);
      if (dist < minDistance) {
        minDistance = dist;
        closestIdx = i;
      }
    }
    activeGroupIndex = closestIdx;
  }

  function onMainScroll() {
    if (isDragging) return;
    if (!scrollContainer) return;
    const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    if (maxScroll > 0) {
      scrollRatio = Math.max(0, Math.min(1, scrollContainer.scrollTop / maxScroll));
    } else {
      scrollRatio = 0;
    }
    updateActiveGroupFromScroll();

    isScrolling = true;
    if (hideBadgeTimeout) clearTimeout(hideBadgeTimeout);
    hideBadgeTimeout = setTimeout(() => {
      isScrolling = false;
    }, 1500);
  }

  function scrubTo(clientY: number) {
    if (!trackEl || !scrollContainer) return;
    const rect = trackEl.getBoundingClientRect();
    const thumbH = 36;
    const availableH = rect.height - thumbH;
    if (availableH <= 0) return;
    const relativeY = clientY - rect.top - (thumbH / 2);
    const ratio = Math.max(0, Math.min(1, relativeY / availableH));
    scrollRatio = ratio;

    const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    if (maxScroll > 0) {
      scrollContainer.scrollTop = ratio * maxScroll;
    }
    updateActiveGroupFromScroll();
  }

  function handlePointerDown(e: PointerEvent) {
    if (!trackEl || !scrollContainer) return;
    isDragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubTo(e.clientY);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    scrubTo(e.clientY);
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isDragging) return;
    isDragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    if (hideBadgeTimeout) clearTimeout(hideBadgeTimeout);
    hideBadgeTimeout = setTimeout(() => {
      isScrolling = false;
    }, 1500);
  }

  function scrollToGroup(idx: number) {
    if (!scrollContainer || !groupElements[idx]) return;
    const header = document.querySelector<HTMLElement>('.sticky-header');
    const headerBottom = header ? (header.offsetHeight - 25) : 71;
    const el = groupElements[idx];
    if (el) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetScrollTop = scrollContainer.scrollTop + (elRect.top - containerRect.top) - headerBottom;
      scrollContainer.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
    }
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

  let pollInterval: ReturnType<typeof setInterval>;

  function isTyping(e: Event): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function cycleTimelineViewMode() {
    const modes: ViewMode[] = ['small-fit', 'large-fit', 'small-square', 'large-square'];
    const idx = modes.indexOf(viewMode);
    viewMode = modes[(idx + 1) % modes.length];
    showViewMenu = false;
  }

  function cycleTimelineSortMode() {
    const modes: SortMode[] = ['newest', 'oldest', 'a-z', 'z-a'];
    const idx = modes.indexOf(sortMode);
    sortMode = modes[(idx + 1) % modes.length];
    showSortMenu = false;
  }

  function handleTimelineKeydown(e: KeyboardEvent) {
    if (selectedMediaIndex !== null) return;
    if (isTyping(e)) return;

    if (e.key === 'Escape') {
      showSortMenu = false;
      showViewMenu = false;
      return;
    }

    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      cycleTimelineViewMode();
      return;
    }

    if ((e.key === 's' || e.key === 'S') && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      cycleTimelineSortMode();
      return;
    }
  }

  onMount(() => {
    sortMode = loadPref<SortMode>('timelineSortMode', (data as any).defaultSortMode || 'newest');
    viewMode = loadPref<ViewMode>('timelineViewMode', (data as any).defaultViewMode || 'small-fit');

    let pollCount = 0;
    const MAX_POLLS = 10;
    pollInterval = setInterval(() => {
      pollCount++;
      if (pollCount > MAX_POLLS) {
        clearInterval(pollInterval);
        return;
      }
      const stillProcessing = data.files && data.files.some(f => !f.blurhash);
      if (stillProcessing) {
        invalidateAll();
      } else {
        clearInterval(pollInterval);
      }
    }, 5000);

    function updateStickyBottom() {
      const header = document.querySelector<HTMLElement>('.sticky-header');
      if (header) {
        const topOffset = parseFloat(getComputedStyle(header).top) || 0;
        document.documentElement.style.setProperty('--sticky-header-bottom', (header.offsetHeight + topOffset) + 'px');
      }
    }

    updateStickyBottom();

    let resizeObserver: ResizeObserver | undefined;
    const headerEl = document.querySelector<HTMLElement>('.sticky-header');
    if (headerEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateStickyBottom());
      resizeObserver.observe(headerEl);
    }

    windowWidth = window.innerWidth;
    const handleResize = () => {
      updateStickyBottom();
      windowWidth = window.innerWidth;
      onMainScroll();
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleTimelineKeydown);

    scrollContainer = document.querySelector<HTMLElement>('.main-content');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', onMainScroll, { passive: true });
      requestAnimationFrame(() => onMainScroll());
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (resizeObserver) resizeObserver.disconnect();
      if (scrollContainer) scrollContainer.removeEventListener('scroll', onMainScroll);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleTimelineKeydown);
    };
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
    if (hideBadgeTimeout) clearTimeout(hideBadgeTimeout);
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
          <button class="icon-btn" onclick={() => { showSortMenu = !showSortMenu; showViewMenu = false; }} title="Sort (S)">
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
          <button class="icon-btn" onclick={() => { showViewMenu = !showViewMenu; showSortMenu = false; }} title="View (V)">
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
    {#each dateGroups as group, gIdx}
      <div class="timeline-group" bind:this={groupElements[gIdx]}>
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
              targetHeight={viewMode.includes('small') ? (windowWidth <= 768 ? 100 : 150) : viewMode.includes('large') ? (windowWidth <= 768 ? 200 : 350) : 250}
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
          targetHeight={viewMode.includes('small') ? (windowWidth <= 768 ? 100 : 150) : viewMode.includes('large') ? (windowWidth <= 768 ? 200 : 350) : 250}
          priority={i < 8}
          initialAspectRatio={getAspectRatio(file)}
        />
      {/each}
    </div>
  {/if}
</div>

{#if selectedMediaIndex === null && dateGroups.length > 1}
  <div class="timeline-scrubber" class:active={isDragging || isScrolling || isTrackHovered}>
    <div 
      class="scrubber-track" 
      role="slider"
      aria-label="Timeline date scrubber"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(scrollRatio * 100)}
      tabindex="0"
      bind:this={trackEl}
      bind:clientHeight={trackHeight}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      onmouseenter={() => isTrackHovered = true}
      onmouseleave={() => isTrackHovered = false}
    >
      <div class="track-rail"></div>

      <!-- Markers along track (Year / Month) -->
      <div class="scrubber-markers">
        {#each scrubberMarkers as marker}
          <button 
            type="button" 
            class="marker-btn" 
            class:is-year={marker.isYear}
            class:is-active={activeMarkerId === marker.id}
            style="top: calc(14px + {marker.progress} * (100% - 28px));"
            onclick={(e) => { e.stopPropagation(); scrollToGroup(marker.groupIndex); }}
            title={marker.fullLabel}
          >
            <span class="marker-label">{marker.label}</span>
            <span class="marker-dot"></span>
          </button>
        {/each}
      </div>

      <!-- Scrubber Thumb with floating date badge -->
      <div 
        class="scrubber-thumb" 
        class:dragging={isDragging}
        style="transform: translateY({thumbOffset}px);"
      >
        <div class="thumb-pill"></div>

        {#if isDragging || isScrolling || isTrackHovered}
          <div class="scrubber-badge" transition:fade={{ duration: 150 }}>
            <div class="badge-title">
              {activeGroup?.fullMonthName || ''} {activeGroup?.year || ''}
            </div>
            {#if activeGroup?.day}
              <div class="badge-subtitle">
                {activeGroup.day} {activeGroup.monthName} · {activeGroup.weekday}
              </div>
            {/if}
            <div class="badge-arrow"></div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if selectedMediaIndex !== null && sortedFiles[selectedMediaIndex]}
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
    margin: 0 -24px 0 -24px;
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
    top: var(--sticky-header-bottom, 71px);
    z-index: 40;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    margin: 0 -24px 16px -24px;
    padding: 8px 24px;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-color);
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
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
    .sticky-header {
      padding: 10px 24px;
    }
    .grid {
      margin: 0 -24px;
    }
    .header-content {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    .header-right {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }
    .count {
      text-align: right;
    }
    .grid.small-square {
      grid-template-columns: repeat(3, 1fr);
    }
    .toolbar .dropdown-menu {
      right: auto;
      left: 0;
    }
  }

  /* Timeline Scrubber (Immich / Google Photos style) */
  .timeline-scrubber {
    position: fixed;
    right: 8px;
    top: 100px;
    bottom: 32px;
    width: 64px;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
    opacity: 0.35;
    transition: opacity 0.25s ease;
  }

  .timeline-scrubber.active,
  .timeline-scrubber:hover {
    opacity: 1;
  }

  .scrubber-track {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: flex-end;
    pointer-events: auto;
    cursor: pointer;
    touch-action: none;
  }

  .track-rail {
    position: absolute;
    right: 12px;
    top: 0;
    bottom: 0;
    width: 3px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 9999px;
    transition: background 0.2s, width 0.2s;
  }

  .timeline-scrubber:hover .track-rail,
  .timeline-scrubber.active .track-rail {
    background: rgba(255, 255, 255, 0.45);
    width: 4px;
  }

  .scrubber-markers {
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
    pointer-events: none;
  }

  .marker-btn {
    position: absolute;
    right: 7px;
    transform: translateY(-50%);
    background: none;
    border: none;
    padding: 2px 4px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    pointer-events: auto;
    transition: transform 0.15s, opacity 0.15s;
    opacity: 0.6;
  }

  .marker-btn:hover,
  .marker-btn.is-active {
    opacity: 1;
    transform: translateY(-50%) translateX(-2px);
  }

  .marker-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: #e4e4e7;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
    transition: color 0.15s;
    white-space: nowrap;
  }

  .marker-btn.is-year .marker-label {
    font-size: 0.75rem;
    font-weight: 700;
    color: #ffffff;
  }

  .marker-btn.is-active .marker-label {
    color: #ffffff;
    font-weight: 700;
  }

  .marker-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
    border: 1px solid rgba(0, 0, 0, 0.5);
    flex-shrink: 0;
    transition: background 0.15s, transform 0.15s;
  }

  .marker-btn:hover .marker-dot,
  .marker-btn.is-active .marker-dot {
    background: #ffffff;
    transform: scale(1.3);
  }

  .scrubber-thumb {
    position: absolute;
    right: 8px;
    top: 0;
    width: 12px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    cursor: grab;
    will-change: transform;
    z-index: 2;
  }

  .scrubber-thumb.dragging {
    cursor: grabbing;
  }

  .thumb-pill {
    width: 8px;
    height: 34px;
    background: #ffffff;
    border-radius: 9999px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6), 0 0 4px rgba(255, 255, 255, 0.5);
    transition: width 0.15s, transform 0.15s;
  }

  .scrubber-thumb:hover .thumb-pill,
  .scrubber-thumb.dragging .thumb-pill {
    width: 10px;
    transform: scale(1.1);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.8), 0 0 10px rgba(255, 255, 255, 0.9);
  }

  .scrubber-badge {
    position: absolute;
    right: 24px;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(18, 18, 18, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 12px;
    padding: 8px 14px;
    color: white;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7), 0 2px 6px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    z-index: 100;
  }

  .badge-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.01em;
  }

  .badge-subtitle {
    font-size: 0.75rem;
    font-weight: 500;
    color: #a1a1aa;
  }

  .badge-arrow {
    position: absolute;
    right: -5px;
    top: 50%;
    transform: translateY(-50%) rotate(45deg);
    width: 8px;
    height: 8px;
    background: rgba(18, 18, 18, 0.92);
    border-top: 1px solid rgba(255, 255, 255, 0.18);
    border-right: 1px solid rgba(255, 255, 255, 0.18);
  }

  @media (max-width: 768px) {
    .timeline-scrubber {
      right: 2px;
      width: 48px;
    }
    .marker-label {
      display: none;
    }
    .marker-btn {
      right: 8px;
    }
    .scrubber-badge {
      right: 20px;
      padding: 6px 10px;
    }
    .badge-title {
      font-size: 0.8rem;
    }
    .badge-subtitle {
      font-size: 0.7rem;
    }
  }
</style>
