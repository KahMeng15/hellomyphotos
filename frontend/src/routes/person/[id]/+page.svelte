<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, API_BASE } from '$lib/api/media';
  import type { PageData } from './$types';
  
  let { data }: { data: PageData } = $props();
  
  let selectedMediaIndex: number | null = null;
  let isEditingName = $state(false);
  let editNameValue = $state(data.personName);
  let isSaving = $state(false);
  
  function openLightbox(index: number) {
    selectedMediaIndex = index;
  }
  
  function closeLightbox() {
    selectedMediaIndex = null;
  }
  
  function nextMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex < data.files.length - 1) {
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
</script>

<div class="header">
  <div style="display: flex; align-items: center; gap: 16px;">
    <a href="/person" class="back-btn">&larr; Back</a>
    
    {#if isEditingName}
      <input 
        type="text" 
        bind:value={editNameValue} 
        class="name-input" 
        onkeydown={(e) => e.key === 'Enter' && saveName()}
        disabled={isSaving}
        autofocus
      />
      <button class="btn primary sm" onclick={saveName} disabled={isSaving}>Save</button>
      <button class="btn sm" onclick={() => { isEditingName = false; editNameValue = data.personName; }}>Cancel</button>
    {:else}
      <h2 style="display: flex; align-items: center; gap: 8px;">
        {data.personName} 
        <button class="edit-icon-btn" onclick={() => isEditingName = true} title="Rename">✎</button>
      </h2>
    {/if}
  </div>
  <span class="count">{data.files.length} items</span>
</div>

<div class="grid">
  {#each data.files as file, i}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="grid-item" onclick={() => openLightbox(i)}>
      <BlurhashImage 
        hash={file.blurhash || ''} 
        src={getThumbnailUrl(file.id)} 
        alt={file.file_name} 
      />
    </div>
  {/each}
</div>

{#if selectedMediaIndex !== null}
  <Lightbox 
    media={data.files[selectedMediaIndex]} 
    onclose={closeLightbox}
    onnext={nextMedia}
    onprev={prevMedia}
  />
{/if}

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
  
  .back-btn {
    text-decoration: none;
    color: var(--accent-color);
    font-weight: 500;
  }

  .count {
    color: #94a3b8;
    font-size: 0.875rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    padding-bottom: 64px;
  }

  .grid-item {
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    position: relative;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  .grid-item:hover {
    transform: scale(1.02);
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);
  }

  .name-input {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid var(--glass-border);
    color: #f1f5f9;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 1.2rem;
    font-weight: 500;
  }
  .name-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  .btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.9rem;
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
  .btn.primary {
    background: var(--accent-color);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .edit-icon-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 1.2rem;
    padding: 0 4px;
  }
  .edit-icon-btn:hover {
    color: var(--accent-color);
  }
</style>
