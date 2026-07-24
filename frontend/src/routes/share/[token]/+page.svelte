<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, getPreviewUrl } from '$lib/api/media';
  import type { PageData } from './$types';
  
  let { data }: { data: PageData } = $props();
  
  let selectedMediaIndex: number | null = null;
</script>

{#if data.error}
  <div style="text-align: center; padding-top: 10vh;">
    <h2>{data.error}</h2>
  </div>
{:else}
  <div class="header">
    <h2>Shared Album: {data.share.folder_path}</h2>
    <span class="count">{data.files.length} items</span>
  </div>

  <div class="grid">
    {#each data.files as file, i}
      <div class="grid-item" on:click={() => selectedMediaIndex = i}>
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
      on:close={() => selectedMediaIndex = null}
    />
  {/if}
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
</style>
