<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, getPreviewUrl, setFolderCover, getFolderZipUrl, setFolderDescription, rescanFolder, rescanFolderML } from '$lib/api/media';
  import { createShare, getActiveShares, revokeShare, type ShareData } from '$lib/api/shares';
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import { ArrowDownUp, LayoutGrid, Download, Share2, Settings, X, ChevronDown, Check, Copy, Trash2, Clock } from '@lucide/svelte';
  
  let { data }: { data: PageData } = $props();
  
  // Settings Modal State
  let folderDescInput = $state('');
  let isSavingSettings = $state(false);

  // Share Modal State
  let shareAllowDownloadImages = $state(true);
  let shareAllowDownloadFolder = $state(true);
  let shareExpiryDays = $state(7);
  let activeShares: ShareData[] = $state([]);
  let isCreatingShare = $state(false);
  let newlyCreatedShareToken = $state<string | null>(null);
  let copiedToken = $state<string | null>(null);

  // Initialize input state when data changes
  $effect(() => {
    folderDescInput = data.folderDescription || '';
  });

  $effect(() => {
    if (showShareModal) {
      loadActiveShares();
      newlyCreatedShareToken = null;
    }
  });

  async function loadActiveShares() {
    try {
      activeShares = await getActiveShares(data.folderPath || '');
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreateShare() {
    try {
      isCreatingShare = true;
      let expiresAt: string | null = null;
      if (shareExpiryDays > 0) {
        const date = new Date();
        date.setDate(date.getDate() + shareExpiryDays);
        expiresAt = date.toISOString();
      }
      
      const token = await createShare(data.folderPath || '', null, shareAllowDownloadImages, shareAllowDownloadFolder, false, expiresAt);
      newlyCreatedShareToken = token;
      await loadActiveShares();
    } catch (e) {
      console.error(e);
      alert('Failed to create share');
    } finally {
      isCreatingShare = false;
    }
  }

  async function handleRevokeShare(token: string) {
    if (!confirm('Are you sure you want to revoke this share link?')) return;
    try {
      await revokeShare(token);
      await loadActiveShares();
    } catch (e) {
      console.error(e);
      alert('Failed to revoke share');
    }
  }

  async function copyShareLink(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    await navigator.clipboard.writeText(url);
    copiedToken = token;
    setTimeout(() => {
      if (copiedToken === token) {
        copiedToken = null;
      }
    }, 2000);
  }

  async function handleSaveSettings() {
    try {
      isSavingSettings = true;
      await setFolderDescription(data.folderPath || '', folderDescInput);
      await invalidateAll();
      showSettingsModal = false;
    } catch (e) {
      console.error(e);
      alert('Failed to save settings');
    } finally {
      isSavingSettings = false;
    }
  }

  let isRescanning = $state(false);
  let isRescanningML = $state(false);

  let alertModalTitle = $state('');
  let alertModalMessage = $state('');
  let showAlertModal = $state(false);

  function showAppAlert(title: string, message: string) {
    alertModalTitle = title;
    alertModalMessage = message;
    showAlertModal = true;
  }

  async function handleRescanFolder() {
    try {
      isRescanning = true;
      await rescanFolder(data.folderPath || '');
      showAppAlert('Scan Queued', 'Folder scan queued! Wait a few moments for new files to appear.');
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to rescan folder');
    } finally {
      isRescanning = false;
    }
  }

  async function handleRescanML() {
    try {
      isRescanningML = true;
      await rescanFolderML(data.folderPath || '');
      showAppAlert('ML Processing Queued', 'ML processing queued! It may take a while to extract faces and items.');
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to trigger ML rescan');
    } finally {
      isRescanningML = false;
    }
  }
  
  type SortMode = 'newest' | 'oldest' | 'a-z' | 'z-a';
  type ViewMode = 'small-fit' | 'large-fit' | 'small-square' | 'large-square';

  let sortMode: SortMode = $state('newest');
  let viewMode: ViewMode = $state('small-fit');

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);
  
  let showDownloadModal = $state(false);
  let showShareModal = $state(false);
  let showSettingsModal = $state(false);

  let sortedFiles = $derived([...data.files].sort((a, b) => {
    function parseExifDate(dateStr: string | undefined, fallback: number): number {
      if (!dateStr) return fallback;
      const normalized = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const time = new Date(normalized).getTime();
      return isNaN(time) ? fallback : time;
    }

    if (sortMode === 'newest') {
      const dateA = parseExifDate(a.exif_json?.dateTimeOriginal, 0);
      const dateB = parseExifDate(b.exif_json?.dateTimeOriginal, 0);
      return dateB - dateA;
    }
    if (sortMode === 'oldest') {
      const dateA = parseExifDate(a.exif_json?.dateTimeOriginal, Number.MAX_SAFE_INTEGER);
      const dateB = parseExifDate(b.exif_json?.dateTimeOriginal, Number.MAX_SAFE_INTEGER);
      return dateA - dateB;
    }
    if (sortMode === 'a-z') return a.file_name.localeCompare(b.file_name);
    if (sortMode === 'z-a') return b.file_name.localeCompare(a.file_name);
    return 0;
  }));
  
  let selectedMediaIndex: number | null = $state(null);
  
  function openLightbox(index: number) {
    selectedMediaIndex = index;
  }
  
  function closeLightbox() {
    selectedMediaIndex = null;
  }
  
  function nextMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex < sortedFiles.length - 1) {
      selectedMediaIndex++;
    }
  }

  function prevMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex > 0) {
      selectedMediaIndex--;
    }
  }

  async function handleSetCover(event: CustomEvent<string>) {
    const mediaId = event.detail;
    try {
      await setFolderCover(data.folderPath || '', mediaId);
      await invalidateAll(); // Reload page data to reflect the new cover image
    } catch (e) {
      console.error(e);
      alert('Failed to set cover image.');
    }
  }

  let fallbackCoverId = $derived(
    data.folderCoverId || 
    (data.files.length > 0 ? data.files[0].id : null) || 
    (data.directories.find(d => d.cover_id)?.cover_id || null)
  );

  let scrollProgress = $state(0);
  let headerWrapper: HTMLElement | undefined = $state();
  let pollInterval: ReturnType<typeof setInterval>;

  function handleScroll(e: Event) {
    if (!headerWrapper) return;
    const target = e.target as HTMLElement;
    // Sticking occurs when scrolled past the wrapper's height minus the 100px overlap and 25px top offset
    const threshold = headerWrapper.offsetHeight - 125;
    if (threshold > 0) {
      scrollProgress = Math.min(1, Math.max(0, target.scrollTop / threshold));
    }
  }

  onMount(() => {
    pollInterval = setInterval(() => {
      // Poll if any file lacks a blurhash (still processing) or if the scanner is active
      const stillProcessing = data.files.some(f => !f.blurhash) || data.scanning;
      if (stillProcessing) {
        invalidateAll();
      }
    }, 2000);

    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.addEventListener('scroll', handleScroll);
    }
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
    if (typeof document !== 'undefined') {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
    }
  });
</script>

<div class="header-wrapper {fallbackCoverId ? 'has-cover' : ''}" bind:this={headerWrapper}>
  {#if fallbackCoverId}
    <div class="header-bg" style="background-image: url('{getPreviewUrl(fallbackCoverId, false)}');"></div>
    <div class="header-gradient"></div>
  {/if}
</div>

<div class="sticky-header" style="
  background: linear-gradient(to bottom, rgba(0,0,0,calc(0.9 * {scrollProgress})) 0%, rgba(0,0,0,calc(0.6 * {scrollProgress})) 100%);
  backdrop-filter: blur(calc(16px * {scrollProgress}));
  -webkit-backdrop-filter: blur(calc(16px * {scrollProgress}));
  border-bottom-color: rgba(255,255,255,calc(0.05 * {scrollProgress}));
">
  <div class="header-content">
    <div class="header-left">
      {#if data.folderPath && data.folderPath.includes('/')}
        <div class="subheading breadcrumbs">
          {#each data.folderPath.split('/').slice(0, -1) as part, index}
            {#if index > 0}<span class="separator"> › </span>{/if}
            <a href="/folder/{data.folderPath.split('/').slice(0, index + 1).join('/')}">{part}</a>
          {/each}
        </div>
      {/if}
      <h2>{data.folderPath ? data.folderPath.split('/').pop() : 'Home'}</h2>
      {#if data.folderDescription}
        <p class="folder-description" style="margin-top: 12px; color: #a1a1aa; font-size: 1rem; max-width: 600px; line-height: 1.5;">{data.folderDescription}</p>
      {/if}
    </div>
    
    <div class="header-right">
      <div class="toolbar">
        <div class="dropdown-container">
          <button class="icon-btn" onclick={() => { showSortMenu = !showSortMenu; showViewMenu = false; }} title="Sort">
            <ArrowDownUp size={18} />
          </button>
          {#if showSortMenu}
            <div class="dropdown-menu">
              <button class:active={sortMode === 'newest'} onclick={() => { sortMode = 'newest'; showSortMenu = false; }}>Newest to Oldest</button>
              <button class:active={sortMode === 'oldest'} onclick={() => { sortMode = 'oldest'; showSortMenu = false; }}>Oldest to Newest</button>
              <button class:active={sortMode === 'a-z'} onclick={() => { sortMode = 'a-z'; showSortMenu = false; }}>A to Z</button>
              <button class:active={sortMode === 'z-a'} onclick={() => { sortMode = 'z-a'; showSortMenu = false; }}>Z to A</button>
            </div>
          {/if}
        </div>
        
        <div class="dropdown-container">
          <button class="icon-btn" onclick={() => { showViewMenu = !showViewMenu; showSortMenu = false; }} title="View">
            <LayoutGrid size={18} />
          </button>
          {#if showViewMenu}
            <div class="dropdown-menu">
              <button class:active={viewMode === 'small-fit'} onclick={() => { viewMode = 'small-fit'; showViewMenu = false; }}>Small Fit Size</button>
              <button class:active={viewMode === 'large-fit'} onclick={() => { viewMode = 'large-fit'; showViewMenu = false; }}>Large Fit Size</button>
              <button class:active={viewMode === 'small-square'} onclick={() => { viewMode = 'small-square'; showViewMenu = false; }}>Small Square Grid</button>
              <button class:active={viewMode === 'large-square'} onclick={() => { viewMode = 'large-square'; showViewMenu = false; }}>Large Square Grid</button>
            </div>
          {/if}
        </div>
        
        <button class="icon-btn" onclick={() => showDownloadModal = true} title="Download">
          <Download size={18} />
        </button>
        <button class="icon-btn" onclick={() => showShareModal = true} title="Share">
          <Share2 size={18} />
        </button>
        <button class="icon-btn" onclick={() => showSettingsModal = true} title="Settings">
          <Settings size={18} />
        </button>
      </div>
      
      <span class="count">
        {#if data.directories.length > 0}{data.directories.length} {data.directories.length === 1 ? 'folder' : 'folders'}{#if data.files.length > 0}{' & '}{/if}{/if}{#if data.files.length > 0 || data.directories.length === 0}{data.files.length} {data.files.length === 1 ? 'item' : 'items'}{/if}
      </span>
    </div>
  </div>
</div>

{#if data.directories.length > 0}
  <div class="dir-grid {data.files.length > 0 ? 'list-view' : ''}">
    {#each data.directories as dir}
      <a href="/folder/{data.folderPath ? data.folderPath + '/' + dir.name : dir.name}" class="dir-card">
        <div class="dir-cover">
          {#if dir.cover_id}
            <BlurhashImage 
              hash={dir.blurhash || ''} 
              src={`${getThumbnailUrl(dir.cover_id)}${dir.blurhash ? '?cb=' + encodeURIComponent(dir.blurhash) : ''}`} 
              alt={dir.name}
              objectFit="cover"
              square={true}
            />
          {:else}
            <div class="dir-placeholder"></div>
          {/if}
        </div>
        <div class="dir-info">
          <span class="dir-name">{dir.name}</span>
        </div>
      </a>
    {/each}
  </div>
{/if}

<div class="grid {viewMode}">
  {#each sortedFiles as file, i}
    <BlurhashImage 
      hash={file.blurhash || ''} 
      src={`${getThumbnailUrl(file.id)}${file.blurhash ? '?cb=' + encodeURIComponent(file.blurhash) : ''}`} 
      alt={file.file_name} 
      isVideo={file.mime_type.startsWith('video/')}
      onclick={() => openLightbox(i)}
      objectFit={viewMode.includes('square') ? 'cover' : 'contain'}
      square={viewMode.includes('square')}
      targetHeight={viewMode.includes('small') ? 150 : viewMode.includes('large') ? 350 : 250}
    />
  {/each}
</div>

{#if selectedMediaIndex !== null}
  <Lightbox 
    media={sortedFiles[selectedMediaIndex]} 
    on:close={closeLightbox}
    on:next={nextMedia}
    on:prev={prevMedia}
    on:setcover={handleSetCover}
  />
{/if}

{#if showDownloadModal}
  <div class="modal-backdrop" onclick={() => showDownloadModal = false}>
    <div class="modal glass-panel" onclick={e => e.stopPropagation()}>
      <div class="modal-header">
        <h3>Download Folder</h3>
        <button class="icon-btn" onclick={() => showDownloadModal = false}><X size={20} /></button>
      </div>
      <div class="modal-body">
        <a href={getFolderZipUrl(data.folderPath || '')} target="_blank" class="btn" style="display: block; text-align: center; text-decoration: none; width: 100%; margin-bottom: 12px; background: var(--text-color); color: var(--bg-color);" onclick={() => showDownloadModal = false}>Download All in One Zip</a>
        <button class="btn" style="width: 100%; background: var(--glass-bg); border: 1px solid var(--glass-border); color: white;">Download as Multi-part Zips (Coming Soon)</button>
      </div>
    </div>
  </div>
{/if}

{#if showShareModal}
  <div class="modal-backdrop" onclick={() => showShareModal = false}>
    <div class="modal glass-panel" onclick={e => e.stopPropagation()}>
      <div class="modal-header">
        <h3>Share Settings</h3>
        <button class="icon-btn" onclick={() => showShareModal = false}><X size={20} /></button>
      </div>
      <div class="modal-body">
        
        {#if newlyCreatedShareToken}
          <div style="background: rgba(0,255,100,0.1); border: 1px solid rgba(0,255,100,0.3); padding: 16px; border-radius: 8px; margin-bottom: 24px;">
            <p style="color: #4ade80; margin-bottom: 8px; font-weight: 500;">Share link created successfully!</p>
            <div style="display: flex; gap: 8px;">
              <input type="text" readonly value="{window.location.origin}/share/{newlyCreatedShareToken}" style="flex: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;" />
              <button class="icon-btn" style="display: flex; align-items: center; justify-content: center;" onclick={() => copyShareLink(newlyCreatedShareToken!)}>
                {#if copiedToken === newlyCreatedShareToken}
                  <Check size={18} color="#10b981" />
                {:else}
                  <Copy size={18} color="#a1a1aa" />
                {/if}
              </button>
            </div>
          </div>
        {/if}

        <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--glass-border);">
          <h4 style="margin-bottom: 16px; font-weight: 500;">Create New Share Link</h4>
          
          <div class="form-group" style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; color: #ccc;">Expiration</label>
            <select bind:value={shareExpiryDays} style="width: 100%; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit;">
              <option value={1}>1 Day</option>
              <option value={7}>7 Days</option>
              <option value={30}>30 Days</option>
              <option value={0}>Never Expires</option>
            </select>
          </div>
          
          <div class="form-group" style="margin-bottom: 8px; display: flex; align-items: center; gap: 12px;">
            <input type="checkbox" id="allowDlsImg" bind:checked={shareAllowDownloadImages} style="width: 18px; height: 18px;" />
            <label for="allowDlsImg" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow downloading individual images</label>
          </div>

          <div class="form-group" style="margin-bottom: 24px; display: flex; align-items: center; gap: 12px;">
            <input type="checkbox" id="allowDlsFolder" bind:checked={shareAllowDownloadFolder} style="width: 18px; height: 18px;" />
            <label for="allowDlsFolder" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow downloading the entire folder (ZIP)</label>
          </div>
          
          <button class="btn" style="width: 100%; background: var(--text-color); color: var(--bg-color);" onclick={handleCreateShare} disabled={isCreatingShare}>
            {isCreatingShare ? 'Generating Link...' : 'Generate Share Link'}
          </button>
        </div>

        <div>
          <h4 style="margin-bottom: 16px; font-weight: 500;">Active Share Links</h4>
          {#if activeShares.length === 0}
            <p style="color: #666; font-size: 0.875rem;">No active links for this folder.</p>
          {:else}
            <div style="display: flex; flex-direction: column; gap: 12px; max-height: 200px; overflow-y: auto;">
              {#each activeShares as share}
                <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); padding: 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div style="font-family: monospace; color: #e4e4e7; margin-bottom: 4px;">...{share.share_token.substring(0, 8)}</div>
                    <div style="font-size: 0.75rem; color: #888; display: flex; gap: 12px;">
                      <span style="display: flex; align-items: center; gap: 4px;">
                        <Clock size={12} />
                        {share.expires_at ? new Date(share.expires_at).toLocaleDateString() : 'Never'}
                      </span>
                      <span>
                        {#if share.allow_download_images && share.allow_download_folder}
                          Full DLs
                        {:else if share.allow_download_images}
                          Images DL Only
                        {:else if share.allow_download_folder}
                          Folder DL Only
                        {:else}
                          View Only
                        {/if}
                      </span>
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <button class="icon-btn" title="Copy Link" onclick={() => copyShareLink(share.share_token)}>
                      {#if copiedToken === share.share_token}
                        <Check size={16} color="#10b981" />
                      {:else}
                        <Copy size={16} color="#a1a1aa" />
                      {/if}
                    </button>
                    <button class="icon-btn" title="Revoke Link" onclick={() => handleRevokeShare(share.share_token)}>
                      <Trash2 size={16} color="#a1a1aa" />
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

      </div>
    </div>
  </div>
{/if}

{#if showSettingsModal}
  <div class="modal-backdrop" onclick={() => showSettingsModal = false}>
    <div class="modal glass-panel" onclick={e => e.stopPropagation()}>
      <div class="modal-header">
        <h3>Folder Settings</h3>
        <button class="icon-btn" onclick={() => showSettingsModal = false}><X size={20} /></button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; color: #888;">View Name (Read Only)</label>
          <input type="text" readonly value={data.folderPath || 'Home'} style="width: 100%; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #888; border-radius: 4px;" />
        </div>
        <div class="form-group">
          <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; color: #ccc;">Description</label>
          <textarea bind:value={folderDescInput} placeholder="Add a description..." style="width: 100%; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; min-height: 100px; font-family: inherit; resize: vertical;"></textarea>
        </div>
        <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
          <button class="btn" onclick={handleSaveSettings} disabled={isSavingSettings}>
            {#if isSavingSettings}
              Saving...
            {:else}
              <Check size={18} style="margin-right: 8px; display: inline-block; vertical-align: middle;" />
              <span style="display: inline-block; vertical-align: middle;">Save Changes</span>
            {/if}
          </button>
        </div>

        <hr style="border-color: rgba(255,255,255,0.1); margin: 24px 0;" />
        
        <h4 style="margin-bottom: 16px; font-weight: 500;">Advanced Actions</h4>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: white; width: 100%; justify-content: flex-start;" onclick={handleRescanFolder} disabled={isRescanning}>
            {isRescanning ? 'Queuing...' : 'Rescan Folder for New Images'}
          </button>
          
          <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: white; width: 100%; justify-content: flex-start;" onclick={handleRescanML} disabled={isRescanningML}>
            {isRescanningML ? 'Queuing...' : 'Rescan Faces & Items in Images'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showAlertModal}
  <div class="modal-backdrop" onclick={() => showAlertModal = false} style="z-index: 9999;">
    <div class="modal glass-panel" onclick={e => e.stopPropagation()} style="max-width: 400px; text-align: center;">
      <div class="modal-header" style="justify-content: center;">
        <h3 style="margin: 0;">{alertModalTitle}</h3>
      </div>
      <div class="modal-body">
        <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5;">{alertModalMessage}</p>
        <button class="btn" style="width: 100%; justify-content: center; background: white; color: black;" onclick={() => showAlertModal = false}>
          Okay
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .header-wrapper {
    position: relative;
    margin: -24px -24px 0 -24px;
    min-height: 120px;
    z-index: 0;
  }
  
  .header-wrapper.has-cover {
    min-height: 40vh;
  }
  
  .header-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center 60%;
    z-index: 0;
  }
  
  .header-gradient {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,1) 100%);
    z-index: 1;
  }
  
  .sticky-header {
    position: sticky;
    top: -25px; /* Offset main-content padding */
    z-index: 50;
    margin: -100px -24px 24px -24px;
    padding: 24px 24px;
    border-bottom: 1px solid transparent;
  }

  .header-content {
    position: relative;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    width: 100%;
  }
  
  .header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
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
  
  .subheading {
    color: #a1a1aa;
    font-size: 1rem;
    margin-bottom: 4px;
    font-family: 'Instrument Sans', sans-serif;
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
  }
  
  .subheading a {
    color: #a1a1aa;
    text-decoration: none;
    transition: color 0.2s;
  }
  
  .subheading a:hover {
    color: var(--text-color);
    text-decoration: underline;
  }
  
  .subheading .separator {
    margin: 0 4px;
    opacity: 0.5;
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
  
  .dropdown-container {
    position: relative;
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
  
  .dropdown-menu {
    position: absolute;
    top: 44px;
    right: 0;
    background: #000;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px;
    min-width: 180px;
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

  .count {
    color: #a1a1aa;
    font-size: 0.875rem;
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
  }

  .dir-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    padding-bottom: 24px;
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
    width: auto;
    gap: 12px;
    border: 1px solid var(--glass-border);
  }

  .dir-grid.list-view .dir-cover {
    width: 48px;
    height: 48px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .dir-grid.list-view .dir-info {
    padding: 0;
    padding-right: 8px;
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
    overflow: hidden;
    transition: filter 0.2s ease, background-color 0.2s ease;
  }

  .dir-card:hover {
    filter: brightness(1.2);
  }

  .dir-cover {
    width: 100%;
    aspect-ratio: 1;
    position: relative;
    overflow: hidden;
    background: #111;
  }

  .dir-placeholder {
    width: 100%;
    height: 100%;
    background: #111;
  }

  .dir-info {
    padding: 12px 0;
  }

  .dir-name {
    font-family: 'Cabinet Grotesk', sans-serif;
    font-weight: 700;
    font-size: 1.125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .grid {
    padding-bottom: 64px;
  }
  
  .grid.small-fit, .grid.large-fit {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
  }
  
  .grid.small-square {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0;
  }
  
  .grid.large-square {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 0;
  }

  /* Trick to prevent the last row from stretching to the edges if there's only 1 or 2 photos in flex view */
  .grid.small-fit::after, .grid.large-fit::after {
    content: "";
    flex-grow: 999999999;
  }
</style>
