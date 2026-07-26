<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import { getThumbnailUrl, API_BASE } from '$lib/api/media';
  import type { PageData } from './$types';
  import { ChevronLeft, Check, Merge, X } from '@lucide/svelte';
  
  let { data }: { data: PageData } = $props();
  
  let selectedFaces = $state<Set<string>>(new Set());
  let isMerging = $state(false);

  function toggleSelection(personId: string) {
    if (selectedFaces.has(personId)) {
      selectedFaces.delete(personId);
    } else {
      selectedFaces.add(personId);
    }
    // trigger reactivity
    selectedFaces = new Set(selectedFaces);
  }

  async function mergeSelected() {
    if (selectedFaces.size < 2) return;
    
    // Choose the first one as the target arbitrarily, or could ask user
    const arr = Array.from(selectedFaces);
    const targetPersonId = arr[0];
    const sourcePersonIds = arr.slice(1);
    
    isMerging = true;
    try {
      const res = await fetch(`${API_BASE}/api/admin/faces/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ targetPersonId, sourcePersonIds })
      });
      
      if (res.ok) {
        // Remove merged sources from data.faces
        data.faces = data.faces.filter((f: any) => !sourcePersonIds.includes(f.person_id));
        selectedFaces.clear();
        selectedFaces = new Set();
      } else {
        const err = await res.json();
        alert(`Merge failed: ${err.error}`);
      }
    } catch (e) {
      console.error(e);
      alert('Network error merging faces');
    } finally {
      isMerging = false;
    }
  }

  function clearSelection() {
    selectedFaces.clear();
    selectedFaces = new Set();
  }
</script>

<div class="admin-container">
  <div class="header">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a href="/admin" title="Back to Admin Dashboard" style="display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; color: rgba(255,255,255,0.4); text-decoration: none; transition: color 0.2s, transform 0.2s;" onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }} onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}>
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>Face Management</h2>
      <p>Select multiple faces to merge them into a single identity.</p>
    </div>
    </div>
    <div class="actions">
      {#if selectedFaces.size > 0}
        <button class="btn secondary" onclick={clearSelection}>
          <X size={16} /> Cancel
        </button>
        <button class="btn primary" disabled={selectedFaces.size < 2 || isMerging} onclick={mergeSelected}>
          <Merge size={16} /> Merge {selectedFaces.size} Faces
        </button>
      {/if}
    </div>
  </div>

  <div class="grid">
    {#each data.faces as face}
      <button 
        class="grid-item {selectedFaces.has(face.person_id) ? 'selected' : ''}" 
        onclick={() => toggleSelection(face.person_id)}
      >
        <BlurhashImage 
          hash={face.blurhash || ''}
          src={getThumbnailUrl(face.media_id)} 
          alt="Person {face.person_id}"
          objectFit="cover"
          faceBox={face.bounding_box}
          square={true}
        />
        {#if selectedFaces.has(face.person_id)}
          <div class="selection-overlay">
            <Check size={32} color="white" />
          </div>
        {/if}
        <div class="person-id-label">{face.person_id.substring(0, 8)}</div>
      </button>
    {/each}
  </div>
</div>

<style>
  .admin-container {
    width: 100%;
    color: #f4f4f5;
  }
  
  .header {
    margin-bottom: 2rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  
  h2 {
    font-size: 2rem;
    margin: 0 0 0.5rem 0;
  }

  p {
    color: #a1a1aa;
    margin: 0;
  }
  
  .actions {
    display: flex;
    gap: 12px;
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
    border: 3px solid transparent;
    padding: 0;
    display: block;
    width: 100%;
  }

  .grid-item:hover {
    transform: scale(1.05);
    border-color: rgba(255,255,255,0.3);
  }

  .grid-item.selected {
    border-color: #3b82f6;
    transform: scale(0.95);
  }

  .selection-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(59, 130, 246, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .person-id-label {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.7);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.7rem;
    font-family: monospace;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .grid-item:hover .person-id-label {
    opacity: 1;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    font-size: 0.95rem;
  }
  
  .btn.primary {
    background: #3b82f6;
    color: white;
  }
  
  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn.secondary {
    background: rgba(255,255,255,0.1);
    color: white;
  }
  
  .btn.secondary:hover {
    background: rgba(255,255,255,0.2);
  }
</style>
