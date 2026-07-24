<script lang="ts">
  import { getThumbnailUrl } from '$lib/api/media';
  import type { PageData } from './$types';
  
  let { data }: { data: PageData } = $props();
</script>

<div class="header">
  <h2>People & Faces</h2>
  <span class="count">{data.faces.length} people identified</span>
</div>

<div class="grid">
  {#each data.faces as face}
    <a href="/faces/{face.person_id}" class="grid-item">
      <img 
        src={getThumbnailUrl(face.media_id)} 
        alt="Person {face.person_id}"
        loading="lazy"
        style="object-position: {face.bounding_box.x * 100}% {face.bounding_box.y * 100}%;"
      />
    </a>
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
    border-radius: 50%; /* Make face clusters circular */
    overflow: hidden;
    cursor: pointer;
    position: relative;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    background: #1e293b;
    border: 2px solid transparent;
  }

  .grid-item:hover {
    transform: scale(1.05);
    border-color: var(--accent-color);
  }
  
  .grid-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Zoom into the face using transform scale if needed, but object-position helps center it */
    transform: scale(1.5);
  }
</style>
