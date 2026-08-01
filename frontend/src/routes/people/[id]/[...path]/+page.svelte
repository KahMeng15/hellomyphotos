<script lang="ts">
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import CoverImage from '$lib/components/CoverImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getSortDate } from '$lib/utils/date';
  import Modal from '$lib/components/Modal.svelte';
  import { getThumbnailUrl, getPreviewUrl, API_BASE } from '$lib/api/media';
  import { computeCoverObjectPosition } from '$lib/utils/cover';
  import { createPersonShare, getActivePersonShares, revokeShare, type ShareData } from '$lib/api/shares';
  import type { PageData } from './$types';
  import { onMount, onDestroy } from 'svelte';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { env } from '$env/dynamic/public';
  import { ArrowDownUp, ChevronLeft, LayoutGrid, Share2, Check, Copy, Trash2, Clock, User, Folder } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';

  let { data }: { data: PageData } = $props();

  let selectedMediaIndex: number | null = $state(null);
  let isEditingName = $state(false);
  let editNameValue = $state(data.personName);
  let isSaving = $state(false);

  type SortMode = 'newest' | 'oldest' | 'a-z' | 'z-a';
  type ViewMode = 'small-fit' | 'large-fit' | 'small-square' | 'large-square';

  function loadPref<T>(key: string, fallback: T): T {
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) as T : fallback;
    } catch { return fallback; }
  }

  function savePref(key: string, val: any) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(val));
    }
  }

  let sortMode: SortMode = $state('oldest');
  let viewMode: ViewMode = $state('small-fit');
  
  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);

  $effect(() => savePref('personSortMode', sortMode));
  $effect(() => savePref('personViewMode', viewMode));

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);
  let showShareModal = $state(false);
  let shareAllowDownloadImages = $state(true);
  let shareAllowDownloadFolder = $state(true);
  let shareExpiryDays = $state(7);
  let activeShares: ShareData[] = $state([]);
  let isCreatingShare = $state(false);
  let newlyCreatedShareToken = $state<string | null>(null);
  let copiedToken = $state<string | null>(null);

  $effect(() => {
    if (showShareModal) {
      loadActiveShares();
      newlyCreatedShareToken = null;
    }
  });

  async function loadActiveShares() {
    try {
      activeShares = await getActivePersonShares(data.id);
    } catch (e) { console.error(e); }
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
      const token = await createPersonShare(data.id, shareAllowDownloadImages, shareAllowDownloadFolder, false, expiresAt);
      toast.success('Share link created successfully!');
      newlyCreatedShareToken = token;
      await loadActiveShares();
    } catch (e) {
      console.error(e);
      toast.error('Failed to create share');
    } finally {
      isCreatingShare = false;
    }
  }

  async function handleRevokeShare(token: string) {
    revokeTargetToken = token;
    showRevokeConfirm = true;
  }

  async function confirmRevokeShare() {
    try {
      await revokeShare(revokeTargetToken);
      await loadActiveShares();
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to revoke share');
    } finally {
      showRevokeConfirm = false;
      revokeTargetToken = '';
    }
  }

  async function copyShareLink(token: string) {
    const domain = env.PUBLIC_APP_DOMAIN || window.location.origin;
    const url = `${domain}/share/${token}`;
    const success = await copyToClipboard(url);
    if (success) {
      toast.success('Link copied to clipboard!');
      copiedToken = token;
      setTimeout(() => {
        if (copiedToken === token) {
          copiedToken = null;
        }
      }, 2000);
    }
  }

  let sortedFiles = $derived([...data.files].sort((a, b) => {
    if (sortMode === 'newest') return getSortDate(b) - getSortDate(a);
    if (sortMode === 'oldest') return getSortDate(a) - getSortDate(b);
    if (sortMode === 'a-z') return a.file_name.localeCompare(b.file_name);
    if (sortMode === 'z-a') return b.file_name.localeCompare(a.file_name);
    return 0;
  }));

  let localCoverOverride: string | null = $state(null);
  let coverRefreshKey = $state(0);
  let showRevokeConfirm = $state(false);
  let revokeTargetToken = $state('');

  import { toast } from '$lib/stores/toast';

  function showAppAlert(title: string, message: string) {
    if (title.toLowerCase().includes('error') || title.toLowerCase().includes('fail')) {
      toast.error(message);
    } else if (title.toLowerCase().includes('success') || title.toLowerCase().includes('queued') || title.toLowerCase().includes('updated')) {
      toast.success(message);
    } else {
      toast.info(message);
    }
  }

  let fallbackCoverId = $derived(localCoverOverride || data.coverMediaId || (data.files.length > 0 ? data.files[0].id : null));

  let coverObjectPosition = $derived(computeCoverObjectPosition(data.coverBoundingBox, data.coverImgWidth, data.coverImgHeight));



  function personUrl() {
    return `/people/${data.id}`;
  }

  function mediaUrl(index: number) {
    const file = sortedFiles[index];
    if (!file) return personUrl();
    return `${personUrl()}/${file.id}`;
  }

  function syncUrl(index: number | null) {
    const url = index !== null ? mediaUrl(index) : personUrl();
    history.replaceState(history.state, '', url);
  }

  async function handleSetCover(mediaId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/faces/${data.id}/cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mediaId })
      });
      if (!res.ok) throw new Error('Failed to set cover');
      localCoverOverride = mediaId;
      coverRefreshKey++;
      showAppAlert('Cover Updated', 'Person cover image has been updated.');
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to set cover image.');
    }
  }

  function openLightbox(index: number) {
    selectedMediaIndex = index;
    syncUrl(index);
  }

  function closeLightbox() {
    selectedMediaIndex = null;
    syncUrl(null);
  }

  function nextMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex < sortedFiles.length - 1) {
      const next = selectedMediaIndex + 1;
      selectedMediaIndex = next;
      syncUrl(next);
    }
  }

  function prevMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex > 0) {
      const prev = selectedMediaIndex - 1;
      selectedMediaIndex = prev;
      syncUrl(prev);
    }
  }

  // Auto-open lightbox once from URL
  let autoOpened = false;
  $effect(() => {
    if (autoOpened) return;
    if (data.selectedMediaId && sortedFiles.length > 0) {
      const idx = sortedFiles.findIndex(f => f.id === data.selectedMediaId);
      if (idx >= 0) {
        selectedMediaIndex = idx;
        autoOpened = true;
      }
    }
  });

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

  let scrollProgress = $state(0);
  let headerWrapper: HTMLElement | undefined = $state();

  function handleScroll(e: Event) {
    if (!headerWrapper) return;
    const target = e.target as HTMLElement;
    const threshold = headerWrapper.offsetHeight - 25;
    if (threshold > 0) {
      scrollProgress = Math.min(1, Math.max(0, target.scrollTop / threshold));
    }
  }

  onMount(() => {
    sortMode = loadPref<SortMode>('personSortMode', 'newest');
    viewMode = loadPref<ViewMode>('personViewMode', 'small-fit');

    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.addEventListener('scroll', handleScroll);
    }
    windowWidth = window.innerWidth;
    const updateWidth = () => windowWidth = window.innerWidth;
    window.addEventListener('resize', updateWidth);
    return () => {
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', updateWidth);
    };
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
    }
  });
</script>

<div class="header-wrapper {fallbackCoverId ? 'has-cover' : ''}" bind:this={headerWrapper}>
  <a href="/people"
     style="position: absolute; top: 24px; left: 24px; z-index: 20; color: rgba(255,255,255,0.4); text-decoration: none; display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; transition: color 0.2s, transform 0.2s;"
     onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }}
     onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}
     title="Back to all people">
    <ChevronLeft size={32} strokeWidth={2.5} />
  </a>
  {#if fallbackCoverId}
    <CoverImage src={getPreviewUrl(fallbackCoverId, false) + '?t=' + coverRefreshKey} objectPosition={coverObjectPosition} />
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
      <div class="header-text-container">
          {#if isEditingName}
            <div class="edit-row">
              <input
                type="text"
                bind:value={editNameValue}
                class="name-input"
                placeholder="Add a name"
                onkeydown={(e) => e.key === 'Enter' && saveName()}
                disabled={isSaving}
                autofocus
              />
              <button class="btn primary" onclick={saveName} disabled={isSaving}>Save</button>
              <button class="btn" onclick={() => { isEditingName = false; editNameValue = data.personName; }}>Cancel</button>
            </div>
          {:else}
            <h2>
              <span class="person-name {data.personName ? '' : 'placeholder'}" onclick={!data.personName ? () => isEditingName = true : undefined}>{data.personName || 'Add name...'}</span>
              <button class="icon-btn" onclick={() => isEditingName = true} title="Rename">✎</button>
            </h2>
          {/if}
      </div>
    </div>

    <div class="header-right">
      <div class="toolbar">
        <div class="dropdown-container" use:clickOutside={() => showSortMenu = false}>
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

        <div class="dropdown-container" use:clickOutside={() => showViewMenu = false}>
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

        <button class="icon-btn" onclick={() => showShareModal = true} title="Share">
          <Share2 size={18} />
        </button>
      </div>

      <span class="count">{data.files.length} {data.files.length === 1 ? 'item' : 'items'}</span>
    </div>
  </div>
</div>

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
      targetHeight={viewMode.includes('small') ? (windowWidth <= 430 ? 100 : 150) : viewMode.includes('large') ? 350 : 250}
      priority={i < 8}
    />
  {/each}
</div>

{#if selectedMediaIndex !== null}
  <Lightbox
    media={sortedFiles[selectedMediaIndex]}
    onclose={closeLightbox}
    onnext={nextMedia}
    onprev={prevMedia}
    onsetcover={handleSetCover}
  />
{/if}

<Modal bind:show={showShareModal} id="person-share" title="Share Person">
  <p style="color: #888; margin-bottom: 16px; font-size: 0.875rem;">
    Creates a share link that only shows photos of <strong>{data.personName || 'this person'}</strong>.
  </p>

  {#if newlyCreatedShareToken}
    <div style="background: rgba(0,255,100,0.1); border: 1px solid rgba(0,255,100,0.3); padding: 16px; border-radius: 8px; margin-bottom: 24px;">
      <p style="color: #4ade80; margin-bottom: 8px; font-weight: 500;">Share link created successfully!</p>
      <div style="display: flex; gap: 8px;">
        <input type="text" readonly value="{env.PUBLIC_APP_DOMAIN || window.location.origin}/share/{newlyCreatedShareToken}" style="flex: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;" />
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
      <input type="checkbox" id="personShareAllowDlImg" bind:checked={shareAllowDownloadImages} style="width: 18px; height: 18px;" />
      <label for="personShareAllowDlImg" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow downloading individual images</label>
    </div>

    <div class="form-group" style="margin-bottom: 24px; display: flex; align-items: center; gap: 12px;">
      <input type="checkbox" id="personShareAllowDlFolder" bind:checked={shareAllowDownloadFolder} style="width: 18px; height: 18px;" />
      <label for="personShareAllowDlFolder" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow downloading the entire folder (ZIP)</label>
    </div>
    
    <button class="btn" style="width: 100%; background: var(--text-color); color: var(--bg-color);" onclick={handleCreateShare} disabled={isCreatingShare}>
      {isCreatingShare ? 'Generating Link...' : 'Generate Share Link'}
    </button>
  </div>

  <div>
    <h4 style="margin-bottom: 16px; font-weight: 500;">Active Share Links</h4>
    {#if activeShares.length === 0}
      <p style="color: #666; font-size: 0.875rem;">No active links for this person's folder.</p>
    {:else}
      <div style="display: flex; flex-direction: column; gap: 12px; max-height: 200px; overflow-y: auto;">
        {#each activeShares as share}
          <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); padding: 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-family: monospace; color: #e4e4e7; margin-bottom: 4px;">...{share.share_token.substring(0, 8)}</div>
              <div style="font-size: 0.75rem; color: #888; display: flex; gap: 12px; flex-wrap: wrap;">
                <span style="display: flex; align-items: center; gap: 4px;">
                  <Clock size={12} />
                  {share.expires_at ? new Date(share.expires_at).toLocaleDateString() : 'Never'}
                </span>
                <span style="display: flex; align-items: center; gap: 4px;">
                  <User size={12} />
                  {share.created_by_name || 'Unknown'}
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
              {#if share.can_manage !== false}
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
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</Modal>



<Modal bind:show={showRevokeConfirm} id="person-revoke-confirm" title="Revoke Share Link">
  <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5;">Are you sure you want to revoke this share link? Anyone using it will instantly lose access.</p>
  <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem;">
    <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => { showRevokeConfirm = false; revokeTargetToken = ''; }}>Cancel</button>
    <button class="btn" style="background: #ef4444; color: white; border: none;" onclick={confirmRevokeShare}>Revoke</button>
  </div>
</Modal>

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .header-wrapper {
    position: relative;
    margin: -24px -24px 0 -24px;
    min-height: 120px;
    z-index: 0;
  }

  .header-wrapper.has-cover {
    min-height: 40vh;
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
    top: -25px;
    z-index: 50;
    margin: 0 -24px 24px -24px;
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

  .header-left h2 {
    animation: fadeIn 0.4s ease both;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--text-color);
    background: transparent;
    font-weight: 700;
    font-size: 2.5rem;
    margin-bottom: 0;
    text-shadow: 0 2px 10px rgba(0,0,0,0.5);
  }

  .header-text-container {
    overflow: hidden;
  }

  .person-name.placeholder {
    color: rgba(255,255,255,0.35);
    font-style: italic;
    font-weight: 400;
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

  .grid.small-fit::after, .grid.large-fit::after {
    content: "";
    flex-grow: 999999999;
  }

  .edit-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .name-input {
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255,255,255,0.15);
    color: #f1f5f9;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 1.2rem;
    font-weight: 500;
    text-shadow: 0 1px 4px rgba(0,0,0,0.5);
    min-width: 250px;
  }
  .name-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  .btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.1);
    color: #e4e4e7;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.18);
    color: white;
  }
  .btn.primary {
    background: var(--text-color);
    color: var(--bg-color);
  }
  .btn.primary:hover {
    background: #e4e4e7;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @media (max-width: 768px) {
    .header-content {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    .header-right {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }
    .count {
      text-align: right;
    }
    .grid.small-square {
      grid-template-columns: repeat(3, 1fr);
    }
    .toolbar .dropdown-menu {
      right: auto;
      left: 0;
    }
  }
</style>
