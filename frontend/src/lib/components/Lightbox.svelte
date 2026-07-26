<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import type { MediaFile } from '$lib/api/media';
  import { getPreviewUrl, getStreamUrl, getThumbnailUrl, fetchMediaFaces } from '$lib/api/media';
  import { createShare } from '$lib/api/shares';
  import BlurhashImage from './BlurhashImage.svelte';
  import { Download, Share2, Info, MoreHorizontal, X, ChevronLeft, ChevronRight, Check } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';

  let { 
    media, 
    allowDownload = true, 
    isSharedView = false, 
    token,
    onclose,
    onnext,
    onprev,
    onsetcover
  }: { 
    media: MediaFile, 
    allowDownload?: boolean, 
    isSharedView?: boolean, 
    token?: string,
    onclose?: () => void,
    onnext?: () => void,
    onprev?: () => void,
    onsetcover?: (id: string) => void
  } = $props();
  
  function close() {
    if (onclose) onclose();
  }

  let showInfo = $state(false);
  let showMenu = $state(false);

  // --- Idle management ---

  let isIdle = $state(false);
  let lastActivity = $state(Date.now());

  function onActivity() {
    lastActivity = Date.now();
    isIdle = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    onActivity();
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' && onnext) onnext();
    if (e.key === 'ArrowLeft' && onprev) onprev();
  }
  
  // --- Info / faces ---

  let faces: {person_id: string, bounding_box: any}[] = $state([]);
  let loadingFaces = $state(false);

  function toggleInfo() {
    showInfo = !showInfo;
  }

  $effect(() => {
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

  // --- Download, share, cover ---

  function download() {
    const url = getStreamUrl(media.id, token) + '&download=1';
    window.location.href = url;
  }

  let isSharing = $state(false);
  let justShared = $state(false);

  async function share() {
    if (isSharing || justShared) return;
    try {
      isSharing = true;
      const date = new Date();
      date.setDate(date.getDate() + 7);
      const token = await createShare(media.folder_path, media.id, allowDownload, false, false, date.toISOString());
      
      const url = `${window.location.origin}/share/${token}`;
      await navigator.clipboard.writeText(url);
      
      justShared = true;
      setTimeout(() => justShared = false, 2000);
    } catch (e) {
      console.error(e);
      alert('Failed to share image');
    } finally {
      isSharing = false;
    }
  }

  async function makeCoverImage() {
    showMenu = false;
    if (onsetcover) onsetcover(media.id);
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    lastActivity = Date.now();
    isIdle = false;
    const interval = setInterval(() => {
      if (!showInfo && Date.now() - lastActivity > 2500) {
        isIdle = true;
      }
    }, 300);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      clearInterval(interval);
    };
  });
</script>

<div class="lightbox" style="opacity: 1;" onmousemove={onActivity} onmousedown={onActivity} ontouchstart={onActivity} onclick={close}>
  <div class="layout-wrapper">
    <div class="main-area">
      <div class="top-bar" style:opacity={isIdle ? 0 : 1} style:pointer-events={isIdle ? 'none' : 'auto'} onclick={(e) => e.stopPropagation()}>
        {#if allowDownload}
          <button class="icon-btn" onclick={download} title="Download">
            <Download size={20} strokeWidth={2} />
          </button>
        {/if}
        {#if !isSharedView}
          <button class="icon-btn {justShared ? 'success' : ''}" onclick={share} title="Share">
            {#if justShared}
              <Check size={20} strokeWidth={2} />
            {:else}
              <Share2 size={20} strokeWidth={2} />
            {/if}
          </button>
        {/if}
        <button class="icon-btn {showInfo ? 'active' : ''}" onclick={toggleInfo} title="Info">
          <Info size={20} strokeWidth={2} />
        </button>
        {#if !isSharedView}
          <div style="position: relative;" use:clickOutside={() => showMenu = false}>
            <button class="icon-btn" onclick={() => showMenu = !showMenu} title="More">
              <MoreHorizontal size={20} strokeWidth={2} />
            </button>
            {#if showMenu}
              <div class="dropdown-menu">
                <button onclick={makeCoverImage}>Set as Cover Image</button>
              </div>
            {/if}
          </div>
        {/if}
        <button class="icon-btn close-btn" onclick={close} title="Close">
          <X size={24} strokeWidth={2} />
        </button>
      </div>

      <button class="nav-btn prev-btn" onclick={(e) => { e.stopPropagation(); if (onprev) onprev(); }}>
        <ChevronLeft size={32} strokeWidth={2} />
      </button>
      
      <div class="content" onclick={(e) => e.stopPropagation()}>
        {#if media.mime_type.startsWith('video/')}
          <video controls autoplay class="media-element">
            <source src={getStreamUrl(media.id, token)} type={media.mime_type} />
            Your browser does not support the video tag.
          </video>
        {:else}
          <img src={getPreviewUrl(media.id, false, token)} alt={media.file_name} class="media-element" />
        {/if}
      </div>
      
      <button class="nav-btn next-btn" onclick={(e) => { e.stopPropagation(); if (onnext) onnext(); }}>
        <ChevronRight size={32} strokeWidth={2} />
      </button>
    </div>

    {#if showInfo}
      <div class="sidebar" transition:slide={{ axis: 'x', duration: 300 }} onclick={(e) => e.stopPropagation()}>
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
                    <a href={`/person/${face.person_id}`} class="face-avatar" onclick={(e) => e.stopPropagation()}>
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
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes fadeInOnly {
    from { opacity: 0; }
    to { opacity: 1; }
  }

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
    animation: fadeInOnly 0.15s ease both;
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
    color: white;
  }

  .icon-btn.success {
    color: #4ade80;
    background: rgba(74, 222, 128, 0.1);
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
    animation: fadeIn 0.4s ease both;
  }

  .media-element {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 0;
  }
</style>
