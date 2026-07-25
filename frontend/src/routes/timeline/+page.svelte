<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl } from '$lib/api/media';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let selectedMediaIndex: number | null = $state(null);

  // Group files by date
  let groupedFiles = $derived(() => {
    const groups: { date: string, files: any[], startIndex: number }[] = [];
    let currentGroup: { date: string, files: any[], startIndex: number } | null = null;

    data.files.forEach((file, index) => {
      let dateStr = 'Unknown Date';
      if (file.exif_json?.dateTimeOriginal) {
        const d = new Date(file.exif_json.dateTimeOriginal);
        if (!isNaN(d.getTime())) {
          dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        }
      }

      if (!currentGroup || currentGroup.date !== dateStr) {
        currentGroup = { date: dateStr, files: [], startIndex: index };
        groups.push(currentGroup);
      }
      currentGroup.files.push({ ...file, index });
    });
    return groups;
  });
  
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
</script>

<div class="nav-header" style="margin-left: -24px; margin-right: -24px; margin-top: -24px;">
  <h1>Timeline</h1>
</div>

<div class="timeline-container">
  {#if data.files.length === 0}
    <div style="text-align: center; color: #888; padding: 64px 0;">
      <p>No media files found. Check the Admin tab to trigger a scan.</p>
    </div>
  {:else}
    {#each groupedFiles() as group}
      <div class="timeline-group">
        <h2 class="date-header">{group.date}</h2>
        <div class="grid">
          {#each group.files as file}
            <BlurhashImage 
              hash={file.blurhash || ''} 
              src={`${getThumbnailUrl(file.id)}${file.blurhash ? '?cb=' + encodeURIComponent(file.blurhash) : ''}`} 
              alt={file.file_name} 
              isVideo={file.mime_type.startsWith('video/')}
              onclick={() => openLightbox(file.index)}
            />
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>

{#if selectedMediaIndex !== null}
  <Lightbox 
    media={data.files[selectedMediaIndex]} 
    on:close={closeLightbox}
    on:next={nextMedia}
    on:prev={prevMedia}
  />
{/if}

<style>
  .timeline-container {
    padding-bottom: 64px;
  }

  .timeline-group {
    margin-bottom: 48px;
  }

  .date-header {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 16px;
    color: var(--text-color);
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
  }
  
  .grid::after {
    content: "";
    flex-grow: 999999999;
  }
</style>
