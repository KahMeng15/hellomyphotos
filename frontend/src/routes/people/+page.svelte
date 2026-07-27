<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import { getFaceThumbnailUrl } from '$lib/api/media';
  import type { PageData } from './$types';
  
  let { data }: { data: PageData } = $props();
</script>

<div class="header">
  <h2>People & Faces</h2>
  <span class="count">{data.faces.length} people identified</span>
</div>

<div class="grid">
  {#each data.faces as face, i}
    <div class="face-card">
      <a href="/people/{face.person_id}" class="grid-item">
        <BlurhashImage 
          hash={face.blurhash || ''}
          src={getFaceThumbnailUrl(face.person_id)} 
          alt={face.name || 'Unknown Person'}
          objectFit="cover"
          square={true}
          priority={i < 8}
        />
      </a>
      <div class="face-info">
        <span class="face-name">{face.name || 'Unknown Person'}</span>
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
  
  .count {
    color: #94a3b8;
    font-size: 0.875rem;
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

  .face-count {
    font-size: 0.75rem;
    color: #94a3b8;
  }
</style>
