<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import { getFaceThumbnailUrl, renamePerson } from '$lib/api/media';
  import { ArrowDownUp } from '@lucide/svelte';
  import type { PageData } from './$types';
  
  let { data }: { data: PageData } = $props();

  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let showSortMenu = $state(false);
  let sortMode = $state<'named' | 'a-z' | 'z-a'>('named');

  type Face = typeof data.faces[number];

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

  function clickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) showSortMenu = false;
    }
    document.addEventListener('click', handler);
    return { destroy: () => document.removeEventListener('click', handler) };
  }

  let sortedFaces = $derived.by(() => {
    const named: Face[] = [];
    const unnamed: Face[] = [];
    for (const f of data.faces) {
      if (f.name) named.push(f); else unnamed.push(f);
    }
    const cmp = sortMode === 'z-a' ? -1 : 1;
    if (sortMode !== 'named') {
      named.sort((a, b) => cmp * a.name!.localeCompare(b.name!));
      unnamed.sort((a, b) => cmp * a.name.localeCompare(b.name));
    }
    return [...named, ...unnamed];
  });
</script>

<div class="header">
  <h2>People</h2>
  <div class="header-right">
    <span class="count">{data.faces.length} people identified</span>
    <div class="dropdown-container" use:clickOutside>
      <button class="icon-btn" onclick={() => showSortMenu = !showSortMenu} title="Sort">
        <ArrowDownUp size={18} />
      </button>
      {#if showSortMenu}
        <div class="dropdown-menu">
          <button class:active={sortMode === 'named'} onclick={() => { sortMode = 'named'; showSortMenu = false; }}>Named first</button>
          <button class:active={sortMode === 'a-z'} onclick={() => { sortMode = 'a-z'; showSortMenu = false; }}>A to Z</button>
          <button class:active={sortMode === 'z-a'} onclick={() => { sortMode = 'z-a'; showSortMenu = false; }}>Z to A</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<div class="grid">
  {#each sortedFaces as face, i}
    <div class="face-card">
      <a href="/people/{face.person_id}" class="grid-item">
        <BlurhashImage 
          hash={face.blurhash || ''}
          src={getFaceThumbnailUrl(face.person_id) + (face.cover_media_id ? '?cv=' + face.cover_media_id.substring(0,8) : '')} 
          alt={face.name || 'unnamed'}
          objectFit="cover"
          square={true}
          priority={i < 8}
        />
      </a>
      <div class="face-info">
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
              <span class="face-name">{face.name}</span>
            {:else}
              <span class="face-name placeholder">Add name...</span>
            {/if}
          </button>
        {/if}
        <span class="face-count">{face.count} photos</span>
      </div>
    </div>
  {/each}
</div>

<style>
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--glass-border);
  }
  
  .header h2 {
    font-weight: 600;
    font-size: 1.5rem;
    color: #e2e8f0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .count {
    color: #94a3b8;
    font-size: 0.875rem;
  }

  .dropdown-container {
    position: relative;
  }

  .dropdown-menu {
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 4px;
    min-width: 140px;
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    overflow: hidden;
    z-index: 50;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }

  .dropdown-menu button {
    display: block;
    width: 100%;
    padding: 8px 14px;
    background: none;
    border: none;
    color: #cbd5e1;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }

  .dropdown-menu button:hover {
    background: rgba(255,255,255,0.06);
    color: #fff;
  }

  .dropdown-menu button.active {
    color: var(--accent-color);
    background: rgba(168,85,247,0.1);
  }

  .icon-btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px;
    color: #94a3b8;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    transition: background 0.15s, color 0.15s;
  }

  .icon-btn:hover {
    background: rgba(255,255,255,0.12);
    color: #e2e8f0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 16px;
    padding-bottom: 64px;
  }

  .grid-item {
    aspect-ratio: 1;
    border-radius: 50%;
    overflow: hidden;
    cursor: pointer;
    position: relative;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    background: #1e293b;
    border: 2px solid transparent;
    display: block;
    width: 100%;
  }

  .grid-item:hover {
    transform: scale(1.05);
    border-color: var(--accent-color);
  }
  
  .face-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .face-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
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
</style>
