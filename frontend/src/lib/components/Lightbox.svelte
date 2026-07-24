<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import type { MediaFile } from '$lib/api/media';
  import { getPreviewUrl, getStreamUrl, getThumbnailUrl, fetchMediaFaces } from '$lib/api/media';
  import BlurhashImage from './BlurhashImage.svelte';
  import { Download, Share2, Info, MoreHorizontal, X, ChevronLeft, ChevronRight } from '@lucide/svelte';

  let { media }: { media: MediaFile } = $props();
  const dispatch = createEventDispatcher();
  
  function close() {
    dispatch('close');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') dispatch('next');
    if (e.key === 'ArrowLeft') dispatch('prev');
  }
  let showInfo = $state(false);
  let showMenu = $state(false);
  
  let isIdle = $state(false);
  let idleTimer: any;

  function resetIdle() {
    isIdle = false;
    clearTimeout(idleTimer);
    if (!showInfo) {
      idleTimer = setTimeout(() => {
        isIdle = true;
      }, 2500);
    }
  }
  
  let faces: {person_id: string, bounding_box: any}[] = $state([]);
  let loadingFaces = $state(false);

  function toggleInfo() {
    showInfo = !showInfo;
  }

  $effect(() => {
    if (showInfo) {
      resetIdle();
    } else {
      resetIdle();
    }
    
    if (showInfo && media.id) {
      loadingFaces = true;
      fetchMediaFaces(media.id).then(res => {
        faces = res;
        loadingFaces = false;
      }).catch(err => {
        console.error(err);
        loadingFaces = false;
      });
    }
  });

  function download() {
    const url = getStreamUrl(media.id) + '?download=1';
    window.location.href = url;
  }

  function share() {
    alert('Share functionality coming soon!');
  }

  async function makeCoverImage() {
    showMenu = false;
    dispatch('setcover', media.id);
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('mousemove', resetIdle);
    document.addEventListener('mousedown', resetIdle);
    document.addEventListener('touchstart', resetIdle);
    resetIdle();
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('mousemove', resetIdle);
      document.removeEventListener('mousedown', resetIdle);
      document.removeEventListener('touchstart', resetIdle);
      clearTimeout(idleTimer);
    };
  });
</script>

<div class="lightbox" class:idle={isIdle} transition:fade={{ duration: 150 }} on:click={close}>
  <div class="layout-wrapper">
    <div class="main-area">
      <div class="top-bar" on:click|stopPropagation>
        <button class="icon-btn" on:click={download} title="Download">
          <Download size={20} strokeWidth={2} />
        </button>
        <button class="icon-btn" on:click={share} title="Share">
          <Share2 size={20} strokeWidth={2} />
        </button>
        <button class="icon-btn {showInfo ? 'active' : ''}" on:click={toggleInfo} title="Info">
          <Info size={20} strokeWidth={2} />
        </button>
        <div style="position: relative;">
          <button class="icon-btn" on:click={() => showMenu = !showMenu} title="More">
            <MoreHorizontal size={20} strokeWidth={2} />
          </button>
          {#if showMenu}
            <div class="dropdown-menu">
              <button on:click={makeCoverImage}>Set as Cover Image</button>
            </div>
          {/if}
        </div>
        <button class="icon-btn close-btn" on:click={close} title="Close">
          <X size={24} strokeWidth={2} />
        </button>
      </div>

      <button class="nav-btn prev-btn" on:click|stopPropagation={() => dispatch('prev')}>
        <ChevronLeft size={32} strokeWidth={2} />
      </button>
      
      <div class="content" on:click|stopPropagation>
        {#if media.mime_type.startsWith('video/')}
          <video controls autoplay class="media-element">
            <source src={getStreamUrl(media.id)} type={media.mime_type} />
            Your browser does not support the video tag.
          </video>
        {:else}
          <img src={getPreviewUrl(media.id, false)} alt={media.file_name} class="media-element" />
        {/if}
      </div>
      
      <button class="nav-btn next-btn" on:click|stopPropagation={() => dispatch('next')}>
        <ChevronRight size={32} strokeWidth={2} />
      </button>
    </div>

    {#if showInfo}
      <div class="sidebar" transition:slide={{ axis: 'x', duration: 300 }} on:click|stopPropagation>
        <div class="sidebar-inner">
          <h3>Info</h3>
          <div class="info-section">
            <h4>DETAILS</h4>
            <p><strong>Filename:</strong> {media.file_name}</p>
            <p><strong>Size:</strong> {(media.size_bytes / 1024 / 1024).toFixed(2)} MB</p>
            <p><strong>Date Taken:</strong> {media.exif_json?.dateTimeOriginal ? new Date(media.exif_json.dateTimeOriginal).toLocaleString() : 'Unknown'}</p>
          </div>
          <div class="info-section">
            <h4>CAMERA</h4>
            <p><strong>Device:</strong> {media.exif_json?.make || ''} {media.exif_json?.model || 'Unknown'}</p>
            <p><strong>Lens:</strong> {media.exif_json?.lensModel || 'Unknown'}</p>
            <p><strong>Settings:</strong> 
              {#if media.exif_json?.iso || media.exif_json?.exposureTime || media.exif_json?.fNumber}
                ISO {media.exif_json.iso || '-'} / 
                {media.exif_json.exposureTime ? `1/${Math.round(1/media.exif_json.exposureTime)}s` : '-'} / 
                {media.exif_json.fNumber ? `f/${media.exif_json.fNumber}` : '-'}
              {:else}
                Unknown ISO / Shutter / Aperture
              {/if}
            </p>
          </div>
          <div class="info-section">
            <h4>PEOPLE</h4>
            {#if loadingFaces}
              <p style="color: #888;">Loading faces...</p>
            {:else if faces.length > 0}
              <div class="face-list">
                {#each faces as face}
                  <a href={`/faces/${face.person_id}`} class="face-avatar" on:click|stopPropagation>
                    <BlurhashImage 
                      hash={media.blurhash || ''} 
                      src={getThumbnailUrl(media.id)} 
                      objectFit="cover" 
                      faceBox={face.bounding_box} 
                      square={true} 
                    />
                  </a>
                {/each}
              </div>
            {:else}
              <p style="color: #888;">No faces detected.</p>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .lightbox {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .top-bar {
    position: absolute;
    top: 0;
    right: 0;
    padding: 16px;
    display: flex;
    gap: 12px;
    z-index: 1010;
    transition: opacity 0.4s ease;
  }

  .lightbox.idle .top-bar,
  .lightbox.idle .nav-btn {
    opacity: 0;
    pointer-events: none;
  }

  .icon-btn {
    background: rgba(0, 0, 0, 0.5);
    border: none;
    color: white;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background 0.2s;
  }
  
  .icon-btn:hover, .icon-btn.active {
    background: rgba(255, 255, 255, 0.2);
  }

  .close-btn {
    font-size: 1.5rem;
  }

  .dropdown-menu {
    position: absolute;
    top: 50px;
    right: 0;
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    overflow: hidden;
    min-width: 180px;
  }

  .dropdown-menu button {
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: none;
    color: white;
    text-align: left;
    cursor: pointer;
  }

  .dropdown-menu button:hover {
    background: rgba(255,255,255,0.1);
  }

  .layout-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    align-items: stretch;
  }

  .main-area {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }

  .nav-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0,0,0,0.5);
    color: white;
    border: none;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    z-index: 1005;
    transition: opacity 0.4s ease, background 0.2s ease;
  }

  .nav-btn:hover {
    background: rgba(255,255,255,0.2);
  }

  .prev-btn {
    left: 24px;
  }

  .next-btn {
    right: 24px;
  }

  .sidebar {
    width: 350px;
    flex-shrink: 0;
    height: 100%;
    background: #000000;
    border-left: 1px solid rgba(255,255,255,0.1);
    padding: 80px 24px 24px 24px;
    overflow-y: auto;
    overflow-x: hidden;
    z-index: 1000;
  }

  .sidebar-inner {
    width: 302px; /* 350px - 48px padding */
  }

  .sidebar h3 {
    margin-bottom: 24px;
    font-size: 1.5rem;
  }

  .info-section {
    margin-bottom: 24px;
  }

  .info-section h4 {
    color: #94a3b8;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }

  .info-section p {
    font-size: 0.875rem;
    margin-bottom: 4px;
    color: #e2e8f0;
  }

  .face-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .face-avatar {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    overflow: hidden;
    display: block;
    border: 2px solid transparent;
    transition: border-color 0.2s;
  }

  .face-avatar:hover {
    border-color: var(--text-color);
  }

  .content {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .media-element {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 0;
  }
</style>
