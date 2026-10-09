<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import { getThumbnailUrl, renamePerson } from '$lib/api/media';
  import { ArrowDownUp, LayoutGrid, User, MoreVertical } from '@lucide/svelte';
  import type { PageData } from './$types';
  
  import { API_BASE } from '$lib/api/media';
import { currentUser } from '$lib/stores/auth';
import { updatePreferences } from '$lib/api/auth';
  
  let { data }: { data: PageData } = $props();
  
  let faces = $state(data.initialFaces);
  let page = $state(1);
  let isLoading = $state(false);
  let hasMore = $state(data.initialFaces.length === 50);

  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let showSortMenu = $state(false);
  let scrollProgress = $state(0);
  function handleScroll(e: Event) {
    const target = e.target as HTMLElement;
    const threshold = 60; // Fixed threshold since no cover image
    scrollProgress = Math.min(1, Math.max(0, target.scrollTop / threshold));
  }
  let sortMode = $state<'named' | 'a-z' | 'z-a'>('named');
  let viewMode = $state<'small-grid' | 'medium-grid' | 'large-grid' | 'list'>('small-grid');
  let showViewMenu = $state(false);

  
  let hasSyncedPreferences = $state(false);

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

  function loadPref<T>(key: string, fallback: T): T {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem(key);
      if (cached) {
        try { return JSON.parse(cached) as T; } catch (e) {}
      }
    }
    return fallback;
  }

  import { onMount } from 'svelte';
  onMount(() => {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.addEventListener('scroll', handleScroll);
    }
    const savedSortMode = loadPref<'named' | 'a-z' | 'z-a'>('peopleSortMode', 'named');
    viewMode = loadPref<'small-grid' | 'medium-grid' | 'large-grid' | 'list'>('peopleViewMode', 'small-grid');
    
    if (savedSortMode !== 'named') {
      sortMode = savedSortMode;
      fetchFaces(true);
    }
  });

  $effect(() => {
    if ($currentUser && !hasSyncedPreferences) {
      hasSyncedPreferences = true;
      let shouldFetch = false;
      if ($currentUser.preferences.peopleSortMode && $currentUser.preferences.peopleSortMode !== sortMode) {
        sortMode = $currentUser.preferences.peopleSortMode as 'named' | 'a-z' | 'z-a';
        shouldFetch = true;
      }
      if ($currentUser.preferences.peopleViewMode) {
        viewMode = $currentUser.preferences.peopleViewMode as 'small-grid' | 'medium-grid' | 'large-grid' | 'list';
      }
      if (shouldFetch) fetchFaces(true);
    }
  });

  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('peopleSortMode', sortMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('peopleViewMode', viewMode); });

  async function fetchFaces(reset = false) {
    if (isLoading) return;
    isLoading = true;
    try {
      if (reset) {
        page = 1;
        faces = [];
        hasMore = true;
      }
      const res = await fetch(`${API_BASE}/api/faces?page=${page}&limit=50&sort=${sortMode}`);
      if (res.ok) {
        const newFaces = await res.json();
        faces = reset ? newFaces : [...faces, ...newFaces];
        hasMore = newFaces.length === 50;
      }
    } catch (e) {
      console.error(e);
    } finally {
      isLoading = false;
    }
  }

  

  type Face = typeof data.initialFaces[number];

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function startEdit(personId: string, currentName: string) {
    editingId = personId;
    editValue = currentName;
  }

  async function saveEdit(face: Face) {
    const trimmed = editValue.trim();
    if (!trimmed) {
      editingId = null;
      return;
    }
    await renamePerson(face.person_id, trimmed);
    face.name = trimmed;
    editingId = null;
  }

  function cancelEdit() {
    editingId = null;
  }

  function handleKeydown(e: KeyboardEvent, face: Face) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(face);
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }

  import { onDestroy } from 'svelte';
  onDestroy(() => {
    if (typeof document !== 'undefined') {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) mainContent.removeEventListener('scroll', handleScroll);
    }
  });

  function clickOutside(node: HTMLElement, callback: () => void) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) callback();
    }
    document.addEventListener('click', handler, true);
    return { 
      update(newCallback: () => void) { callback = newCallback; },
      destroy: () => document.removeEventListener('click', handler, true) 
    };
  }

  

  let isIntersectingBottom = $state(false);

  async function loadMore() {
    if (hasMore && !isLoading) {
      page++;
      await fetchFaces();
      
      // If the user's screen is very tall or view mode is small,
      // the initial 50 items might not fill the screen. 
      // The IntersectionObserver only fires on state *change*, 
      // so if it's STILL visible after fetch, we must manually fetch again.
      if (isIntersectingBottom && hasMore && !isLoading) {
        // use a small timeout to let the DOM update before deciding if we need more
        setTimeout(loadMore, 50);
      }
    }
  }

  function infiniteScroll(node: HTMLElement) {
    const observer = new IntersectionObserver((entries) => {
      isIntersectingBottom = entries[0].isIntersecting;
      if (isIntersectingBottom) {
        loadMore();
      }
    }, { rootMargin: '800px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
</script>


<div class="sticky-header" style="
  background: linear-gradient(to bottom, rgba(15,23,42,calc(0.95 * {scrollProgress})) 0%, rgba(15,23,42,calc(0.85 * {scrollProgress})) 100%);
  backdrop-filter: blur(calc(16px * {scrollProgress}));
  -webkit-backdrop-filter: blur(calc(16px * {scrollProgress}));
  border-bottom-color: rgba(255,255,255,calc(0.08 * {scrollProgress}));
  z-index: {showSortMenu || showViewMenu ? 105 : 50};
">
  <div class="header-content">
    <div class="header-left">
      <div class="header-text-container" style="--scroll-prog: {scrollProgress};">
        <h2>People</h2>
      </div>
    </div>
    
    <div class="header-right">
      <div class="toolbar">
        <div class="dropdown-container" use:clickOutside={() => showViewMenu = false}>
          <button class="icon-btn" onclick={() => { showViewMenu = !showViewMenu; showSortMenu = false; }} title="View">
            <LayoutGrid size={18} />
          </button>
          {#if showViewMenu}
            <div class="dropdown-menu">
              <button class:active={viewMode === 'small-grid'} onclick={() => { viewMode = 'small-grid'; showViewMenu = false; }}>Small Grid</button>
              <button class:active={viewMode === 'medium-grid'} onclick={() => { viewMode = 'medium-grid'; showViewMenu = false; }}>Medium Grid</button>
              <button class:active={viewMode === 'large-grid'} onclick={() => { viewMode = 'large-grid'; showViewMenu = false; }}>Large Grid</button>
              <button class:active={viewMode === 'list'} onclick={() => { viewMode = 'list'; showViewMenu = false; }}>List</button>
            </div>
          {/if}
        </div>

        <div class="dropdown-container" use:clickOutside={() => showSortMenu = false}>
          <button class="icon-btn" onclick={() => showSortMenu = !showSortMenu} title="Sort">
            <ArrowDownUp size={18} />
          </button>
          {#if showSortMenu}
            <div class="dropdown-menu">
              <button class:active={sortMode === 'named'} onclick={() => { if(sortMode !== 'named') { sortMode = 'named'; fetchFaces(true); } showSortMenu = false; }}>Named first</button>
              <button class:active={sortMode === 'a-z'} onclick={() => { if(sortMode !== 'a-z') { sortMode = 'a-z'; fetchFaces(true); } showSortMenu = false; }}>A to Z</button>
              <button class:active={sortMode === 'z-a'} onclick={() => { if(sortMode !== 'z-a') { sortMode = 'z-a'; fetchFaces(true); } showSortMenu = false; }}>Z to A</button>
            </div>
          {/if}
        </div>
      </div>
      <span class="count" style="display: flex; flex-wrap: wrap; justify-content: flex-end; column-gap: 4px;">
        <span style="white-space: nowrap;">{faces.length} people loaded</span>
      </span>
    </div>
  </div>
</div>
<div class="dir-grid folder-mode-{viewMode}">
  {#each faces as face, i}
    <div class="dir-card" style="animation-delay: {i * 40}ms;" role="link" tabindex="0" onclick={(e) => { if ((e.target).closest('button, input')) return; window.location.href = `/people/${face.person_id}`; }} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = `/people/${face.person_id}`; } }}>
      {#if viewMode === 'list'}
        <div class="dir-info" style="justify-content: space-between;">
          <div class="dir-label">
             {#if face.blurhash}
               <div style="width: 32px; height: 32px; border-radius: 4px; overflow: hidden; flex-shrink: 0;">
                 <BlurhashImage 
                    hash={face.blurhash || ''}
                    src={face.has_thumbnail ? `${API_BASE}/api/faces/${face.person_id}/thumbnail` : getThumbnailUrl(face.media_id)}
                    alt={face.name || 'unnamed'}
                    objectFit="cover"
                    faceBox={face.has_thumbnail ? undefined : face.bounding_box}
                    square={true}
                 />
               </div>
             {:else}
               <User size={18} />
             {/if}
             {#if editingId === face.person_id}
              <input
                class="face-name-input"
                bind:value={editValue}
                onblur={() => saveEdit(face)}
                onkeydown={(e) => handleKeydown(e, face)}
                use:focusOnMount
                placeholder="Enter name..."
              />
            {:else}
              <button class="face-name-btn" style="text-align: left;" onclick={() => startEdit(face.person_id, face.name || '')}>
                {#if face.name}
                  <span class="dir-name">{face.name}</span>
                {:else}
                  <span class="dir-name" style="color: #64748b; font-style: italic;">Add name...</span>
                {/if}
              </button>
            {/if}
          </div>
          <span class="face-count" style="color: #94a3b8; font-size: 0.85rem;">{face.count} photos</span>
        </div>
      {:else}
        <div class="dir-cover" style="border-radius: 0; overflow: hidden;">
          <BlurhashImage 
            hash={face.blurhash || ''}
            src={face.has_thumbnail ? `${API_BASE}/api/faces/${face.person_id}/thumbnail` : getThumbnailUrl(face.media_id)}
            alt={face.name || 'unnamed'}
            objectFit="cover"
            faceBox={face.has_thumbnail ? undefined : face.bounding_box}
            square={true}
            priority={i < 8}
          />
        </div>
        <div class="dir-info" style="display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 4px; padding-top: 8px;">
          {#if editingId === face.person_id}
            <input
              class="face-name-input"
              bind:value={editValue}
              onblur={() => saveEdit(face)}
              onkeydown={(e) => handleKeydown(e, face)}
              use:focusOnMount
              placeholder="Enter name..."
            />
          {:else}
            <button class="face-name-btn" onclick={() => startEdit(face.person_id, face.name || '')}>
              {#if face.name}
                <span class="dir-name" style="max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">{face.name}</span>
              {:else}
                <span class="dir-name" style="color: #64748b; font-style: italic;">Add name...</span>
              {/if}
            </button>
          {/if}
          <span class="face-count" style="color: #94a3b8; font-size: 0.75rem;">{face.count} photos</span>
        </div>
      {/if}
    </div>
  {/each}
</div>
{#if hasMore}
  <div use:infiniteScroll style="height: 20px; width: 100%;"></div>
{/if}

<style>
.dir-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    padding-bottom: 24px;
  }

  .dir-grid.folder-mode-small-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 6px;
  }

  .dir-grid.folder-mode-medium-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
  }

  .dir-grid.folder-mode-large-grid {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px;
  }

  .dir-grid.folder-mode-small-grid .dir-cover,
  .dir-grid.folder-mode-medium-grid .dir-cover,
  .dir-grid.folder-mode-large-grid .dir-cover {
    border-radius: 0;
  }

  .dir-grid.folder-mode-small-grid .dir-info,
  .dir-grid.folder-mode-medium-grid .dir-info,
  .dir-grid.folder-mode-large-grid .dir-info {
    padding: 8px 2px;
    align-items: flex-start;
  }

  .dir-grid.folder-mode-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-bottom: 24px;
  }

  .dir-grid.folder-mode-list .dir-card {
    display: block;
    text-decoration: none;
    color: var(--text-color);
  }

  .dir-grid.folder-mode-list .dir-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
  }

  .dir-grid.folder-mode-list .dir-label {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
    color: #d4d4d8;
  }

  @media (hover: hover) and (pointer: fine) {
    .dir-grid.folder-mode-list .dir-card:not(:hover) .dir-info {
      background: transparent;
    }

    .dir-grid.folder-mode-list .dir-card:nth-child(odd) .dir-info {
      background: rgba(255, 255, 255, 0.03);
    }

    .dir-grid.folder-mode-list .dir-card:hover .dir-info {
      background: rgba(255, 255, 255, 0.08);
    }
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
    width: 250px;
    gap: 12px;
    border: 1px solid var(--glass-border);
  }

  .dir-grid.list-view .dir-cover {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
  }

  .dir-grid.list-view .dir-info {
    padding: 0;
    padding-right: 8px;
    flex: 1;
    min-width: 0;
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
    transition: filter 0.2s ease, background-color 0.2s ease;
    position: relative;
    animation: fadeIn 0.35s ease both;
    cursor: pointer;
  }

  @media (hover: hover) and (pointer: fine) {
    .dir-card:hover {
      filter: brightness(1.2);
    }
  }

  .dir-cover {
    width: 100%;
    aspect-ratio: 1;
    position: relative;
    z-index: 0;
    background: #111;
  }

  .dir-placeholder {
    width: 100%;
    height: 100%;
    background: #111;
  }

  .dir-info {
    padding: 12px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .dir-name {
    font-family: 'Cabinet Grotesk', sans-serif;
    font-weight: 700;
    font-size: 1rem;
    line-height: 1.3;
    word-break: break-word;
    flex: 1;
  }

  .folder-mode-small-grid .dir-name {
    font-size: 0.8rem;
    padding-top: 3px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .folder-mode-medium-grid .dir-name,
  .folder-mode-large-grid .dir-name {
    padding-top: 3px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .dir-actions {
    margin-left: 12px;
    flex-shrink: 0;
  }

  .dir-actions-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 72px;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 5;
    background: linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 100%);
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 8px;
  }

  @media (hover: hover) and (pointer: fine) {
    .dir-card:hover .dir-actions-overlay {
      opacity: 1;
    }
  }

  @media (hover: none) {
    .dir-actions-overlay {
      opacity: 1;
      background: linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%);
    }
  }

  .overlay-btn {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 6;
  }

  .overlay-btn:hover {
    color: #e4e4e7;
  }


  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
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
    align-items: flex-start;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
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

  .count {
    color: #a1a1aa;
    font-size: 0.875rem;
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
  }

  .dropdown-container {
    position: relative;
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

  

  

  
  
  

  

  .face-name {
    font-size: 0.9rem;
    font-weight: 500;
    color: #f1f5f9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .face-name.placeholder {
    color: #64748b;
    font-style: italic;
  }

  .face-name-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font: inherit;
    max-width: 100%;
  }

  .face-name-btn:hover .face-name {
    color: #fff;
  }

  .face-name-btn:hover .face-name.placeholder {
    color: #94a3b8;
  }

  .face-name-input {
    background: rgba(255,255,255,0.08);
    border: 1px solid var(--accent-color);
    border-radius: 4px;
    color: #f1f5f9;
    font-size: 0.9rem;
    font-weight: 500;
    padding: 2px 6px;
    text-align: center;
    width: 100%;
    max-width: 120px;
    outline: none;
    font-family: inherit;
  }

  .face-name-input::placeholder {
    color: #64748b;
  }

  .face-count {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  

  @media (max-width: 768px) {
    .dir-grid.list-view .dir-card {
      width: 100%;
    }
    .header-content {
      flex-direction: column;
      gap: 16px;
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
    .header-text-container {
      max-height: calc((1 - var(--scroll-prog)) * 120px + 4px);
      opacity: calc(1 - var(--scroll-prog));
      overflow: hidden;
    }
  }
</style>
