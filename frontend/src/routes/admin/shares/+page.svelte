<script lang="ts">
  import { onMount } from 'svelte';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { env } from '$env/dynamic/public';
  import { API_BASE } from '$lib/api/media';
  import { 
    ChevronLeft, Trash2, Link as LinkIcon, Folder, Image, User, Copy, Check, 
    Pencil, Power, PowerOff, Shield, ShieldAlert, Clock, Search, X, Plus, 
    AlertTriangle, RefreshCw, Mail, ExternalLink, Send
  } from '@lucide/svelte';
  import Modal from '$lib/components/Modal.svelte';
  import { 
    getAdminLockdown, setAdminLockdown, getAdminShares, updateAdminShare, 
    deleteAdminShare, getAdminAccessRequests, createShare, createPersonShare 
  } from '$lib/api/shares';
  import { formatShareDate, getNearestExpiryDuration, isShareExpired } from '$lib/utils/shareUtils';
  import { toast } from '$lib/stores/toast';

  let shares: any[] = $state([]);
  let isLoading = $state(true);
  let isLockdown = $state(false);
  let isTogglingLockdown = $state(false);
  let showLockdownConfirm = $state(false);
  let pendingRequestsCount = $state(0);

  // Search state
  let searchQuery = $state('');
  let serverSearchQuery = $state('');
  let subTab: 'all' | 'active' | 'expired' | 'disabled' = $state('all');

  // Create share panel
  let showCreatePanel = $state(false);
  let isCreating = $state(false);
  let createTargetType: 'folder' | 'media' = $state('folder');
  let createTargetPath = $state('');
  let createExpiryMode: 'duration' | 'date' | 'never' = $state('duration');
  let createExpiryValue = $state(7);
  let createExpiryUnit: 'hours' | 'days' | 'months' | 'years' = $state('days');
  let createExpiryDateTime = $state('');
  let createAllowDownloadImages = $state(true);
  let createAllowDownloadFolder = $state(true);
  let createWatermarkEnabled = $state(false);
  let newlyCreatedToken = $state<string | null>(null);

  // Edit share state
  let editingToken = $state<string | null>(null);
  let editExpiryMode: 'duration' | 'date' | 'never' = $state('duration');
  let editExpiryValue = $state(7);
  let editExpiryUnit: 'hours' | 'days' | 'months' | 'years' = $state('days');
  let editExpiryDateTime = $state('');
  let editAllowDownloadImages = $state(false);
  let editAllowDownloadFolder = $state(false);
  let editWatermarkEnabled = $state(false);
  let editIsActive = $state(true);
  let isSavingEdit = $state(false);

  // Extend validity state
  let extendingToken = $state<string | null>(null);
  let extendExpiryMode: 'duration' | 'date' = $state('duration');
  let extendExpiryValue = $state(7);
  let extendExpiryUnit: 'hours' | 'days' | 'months' | 'years' = $state('days');
  let extendExpiryDateTime = $state('');
  let isExtending = $state(false);

  // Delete confirm state
  let showRevokeConfirm = $state(false);
  let revokeTargetToken = $state('');

  // Copy feedback state
  let copiedToken = $state('');

  function toDateTimeLocal(d: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function loadData() {
    isLoading = true;
    try {
      const [sharesData, lockdownStatus, pendingReqs] = await Promise.all([
        getAdminShares(serverSearchQuery || undefined),
        getAdminLockdown().catch(() => false),
        getAdminAccessRequests('pending').catch(() => [])
      ]);
      shares = sharesData;
      isLockdown = lockdownStatus;
      pendingRequestsCount = pendingReqs.length;
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to load shares data');
    } finally {
      isLoading = false;
    }
  }

  function handleSearch() {
    serverSearchQuery = searchQuery.trim();
    loadData();
  }

  function clearSearch() {
    searchQuery = '';
    serverSearchQuery = '';
    loadData();
  }

  async function copyLink(token: string) {
    const domain = env.PUBLIC_APP_DOMAIN || window.location.origin;
    const url = `${domain}/share/${token}`;
    const success = await copyToClipboard(url);
    if (success) {
      copiedToken = token;
      toast.success('Share link copied to clipboard');
      setTimeout(() => { copiedToken = ''; }, 2000);
    }
  }

  // --- Lockdown handling ---
  function promptLockdownToggle() {
    showLockdownConfirm = true;
  }

  async function confirmLockdownToggle() {
    try {
      isTogglingLockdown = true;
      const targetState = !isLockdown;
      const result = await setAdminLockdown(targetState);
      isLockdown = result;
      showLockdownConfirm = false;
      if (isLockdown) {
        toast.warning('Lockdown Mode ACTIVATED: All share links are temporarily disabled.');
      } else {
        toast.success('Lockdown Mode DEACTIVATED: Share links have been restored.');
      }
      await loadData();
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to toggle lockdown mode');
    } finally {
      isTogglingLockdown = false;
    }
  }

  // --- Create Share ---
  async function handleCreateShare() {
    if (!createTargetPath.trim()) {
      toast.error(createTargetType === 'folder' ? 'Please provide a folder path' : 'Please provide a media ID');
      return;
    }
    try {
      isCreating = true;
      let expiresAt: string | null = null;
      if (createExpiryMode === 'duration' && createExpiryValue > 0) {
        const date = new Date();
        if (createExpiryUnit === 'hours') date.setHours(date.getHours() + createExpiryValue);
        else if (createExpiryUnit === 'days') date.setDate(date.getDate() + createExpiryValue);
        else if (createExpiryUnit === 'months') date.setMonth(date.getMonth() + createExpiryValue);
        else if (createExpiryUnit === 'years') date.setFullYear(date.getFullYear() + createExpiryValue);
        expiresAt = date.toISOString();
      } else if (createExpiryMode === 'date' && createExpiryDateTime) {
        expiresAt = new Date(createExpiryDateTime).toISOString();
      }

      const folderParam = createTargetType === 'folder' ? createTargetPath.trim() : '';
      const mediaParam = createTargetType === 'media' ? createTargetPath.trim() : null;

      const token = await createShare(
        folderParam, 
        mediaParam, 
        createAllowDownloadImages, 
        createAllowDownloadFolder, 
        createWatermarkEnabled, 
        expiresAt
      );

      toast.success('Share link created successfully!');
      newlyCreatedToken = token;
      createTargetPath = '';
      await loadData();
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to create share link');
    } finally {
      isCreating = false;
    }
  }

  // --- Toggle Active ---
  async function toggleDisable(share: any) {
    try {
      const newActive = share.is_active === false ? true : false;
      await updateAdminShare(share.share_token, { is_active: newActive });
      toast.success(newActive ? 'Share link activated' : 'Share link disabled');
      await loadData();
    } catch (e) {
      console.error(e);
      toast.error('Failed to update share');
    }
  }

  // --- Edit Share ---
  function startEditingShare(share: any) {
    if (editingToken === share.share_token) {
      editingToken = null;
      return;
    }
    editingToken = share.share_token;
    extendingToken = null;
    editAllowDownloadImages = share.allow_download_images ?? false;
    editAllowDownloadFolder = share.allow_download_folder ?? false;
    editWatermarkEnabled = share.watermark_enabled ?? false;
    editIsActive = share.is_active !== false;

    if (!share.expires_at) {
      editExpiryMode = 'never';
      editExpiryValue = 7;
      editExpiryUnit = 'days';
      editExpiryDateTime = '';
    } else {
      const expDate = new Date(share.expires_at);
      if (expDate <= new Date()) {
        editExpiryMode = 'duration';
        editExpiryValue = 7;
        editExpiryUnit = 'days';
        const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        editExpiryDateTime = toDateTimeLocal(future);
      } else {
        editExpiryMode = 'date';
        editExpiryDateTime = toDateTimeLocal(expDate);
        editExpiryValue = 7;
        editExpiryUnit = 'days';
      }
    }
  }

  async function handleSaveShareEdit(token: string) {
    try {
      isSavingEdit = true;
      let expiresAt: string | null = null;
      if (editExpiryMode === 'duration' && editExpiryValue > 0) {
        const date = new Date();
        if (editExpiryUnit === 'hours') date.setHours(date.getHours() + editExpiryValue);
        else if (editExpiryUnit === 'days') date.setDate(date.getDate() + editExpiryValue);
        else if (editExpiryUnit === 'months') date.setMonth(date.getMonth() + editExpiryValue);
        else if (editExpiryUnit === 'years') date.setFullYear(date.getFullYear() + editExpiryValue);
        expiresAt = date.toISOString();
      } else if (editExpiryMode === 'date' && editExpiryDateTime) {
        expiresAt = new Date(editExpiryDateTime).toISOString();
      }

      await updateAdminShare(token, {
        is_active: editIsActive,
        expires_at: expiresAt,
        allow_download_images: editAllowDownloadImages,
        allow_download_folder: editAllowDownloadFolder,
        watermark_enabled: editWatermarkEnabled
      });

      toast.success('Share link parameters updated!');
      editingToken = null;
      await loadData();
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to save share parameters');
    } finally {
      isSavingEdit = false;
    }
  }

  // --- Extend Validity ---
  function startExtendingShare(share: any) {
    if (extendingToken === share.share_token) {
      extendingToken = null;
      return;
    }
    extendingToken = share.share_token;
    editingToken = null;
    extendExpiryMode = 'duration';
    extendExpiryValue = 7;
    extendExpiryUnit = 'days';
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    extendExpiryDateTime = toDateTimeLocal(future);
  }

  async function handleExtendShare(token: string) {
    try {
      isExtending = true;
      let newExpiresAt: string | null = null;
      if (extendExpiryMode === 'duration' && extendExpiryValue > 0) {
        const date = new Date();
        if (extendExpiryUnit === 'hours') date.setHours(date.getHours() + extendExpiryValue);
        else if (extendExpiryUnit === 'days') date.setDate(date.getDate() + extendExpiryValue);
        else if (extendExpiryUnit === 'months') date.setMonth(date.getMonth() + extendExpiryValue);
        else if (extendExpiryUnit === 'years') date.setFullYear(date.getFullYear() + extendExpiryValue);
        newExpiresAt = date.toISOString();
      } else if (extendExpiryMode === 'date' && extendExpiryDateTime) {
        newExpiresAt = new Date(extendExpiryDateTime).toISOString();
      }

      if (!newExpiresAt) {
        toast.error('Please specify a valid expiration time');
        return;
      }

      await updateAdminShare(token, {
        expires_at: newExpiresAt,
        is_active: true
      });

      toast.success('Share link validity extended & activated!');
      extendingToken = null;
      await loadData();
    } catch (e) {
      console.error(e);
      toast.error('Failed to extend validity');
    } finally {
      isExtending = false;
    }
  }

  // --- Revoke / Delete ---
  function promptRevoke(token: string) {
    revokeTargetToken = token;
    showRevokeConfirm = true;
  }

  async function confirmRevokeShare() {
    try {
      await deleteAdminShare(revokeTargetToken);
      shares = shares.filter(s => s.share_token !== revokeTargetToken);
      toast.success('Share link permanently revoked');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete share');
    } finally {
      showRevokeConfirm = false;
      revokeTargetToken = '';
    }
  }

  // Filtering
  let filteredShares = $derived(() => {
    let list = shares;
    if (searchQuery.trim() && !serverSearchQuery) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(s => 
        (s.share_token && s.share_token.toLowerCase().includes(q)) ||
        (s.folder_path && s.folder_path.toLowerCase().includes(q)) ||
        (s.media_file_name && s.media_file_name.toLowerCase().includes(q)) ||
        (s.media_id && s.media_id.toLowerCase().includes(q)) ||
        (s.person_name && s.person_name.toLowerCase().includes(q)) ||
        (s.creator_name && s.creator_name.toLowerCase().includes(q)) ||
        (s.creator_email && s.creator_email.toLowerCase().includes(q))
      );
    }

    if (subTab === 'active') {
      list = list.filter(s => s.is_active !== false && !isShareExpired(s.expires_at));
    } else if (subTab === 'expired') {
      list = list.filter(s => isShareExpired(s.expires_at));
    } else if (subTab === 'disabled') {
      list = list.filter(s => s.is_active === false);
    }
    return list;
  });

  let activeCount = $derived(shares.filter(s => s.is_active !== false && !isShareExpired(s.expires_at)).length);
  let expiredCount = $derived(shares.filter(s => isShareExpired(s.expires_at)).length);
  let disabledCount = $derived(shares.filter(s => s.is_active === false).length);

  onMount(() => {
    loadData();
  });
</script>

<div class="admin-container">
  <!-- Top Header -->
  <div class="header" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a href="/admin" class="icon-btn" style="text-decoration: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: rgba(255,255,255,0.05); border-radius: 50%; color: white;" title="Back to Admin Dashboard">
        <ChevronLeft size={24} />
      </a>
      <div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <h2 style="margin: 0; font-size: 1.8rem;">Global Shares Management</h2>
          {#if isLockdown}
            <span class="lockdown-badge">
              <ShieldAlert size={14} />
              Lockdown Active
            </span>
          {/if}
        </div>
        <p style="color: #a1a1aa; margin-top: 0.35rem; margin-bottom: 0; font-size: 0.9rem;">
          View, edit, disable, lockdown, and extend share links generated across the entire system.
        </p>
      </div>
    </div>

    <!-- Header Actions: Lockdown toggle & Requests button -->
    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
      <a 
        href="/admin/shares/requests" 
        class="btn" 
        style="background: rgba(255,255,255,0.06); border: 1px solid var(--glass-border); color: white; text-decoration: none; display: flex; align-items: center; gap: 8px; font-size: 0.85rem; padding: 8px 14px;">
        <Mail size={16} color="#fbbf24" />
        <span>Access Requests</span>
        {#if pendingRequestsCount > 0}
          <span style="background: #ef4444; color: white; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; padding: 1px 6px;">
            {pendingRequestsCount}
          </span>
        {/if}
      </a>

      <!-- Lockdown Mode Button -->
      <button 
        class="btn lockdown-btn" 
        class:is-active={isLockdown}
        onclick={promptLockdownToggle} 
        disabled={isTogglingLockdown}
        title={isLockdown ? 'Deactivate Lockdown Mode' : 'Enable Lockdown Mode (Disable All Links)'}>
        {#if isLockdown}
          <ShieldAlert size={16} color="#fca5a5" />
          <span>Lockdown Active</span>
        {:else}
          <Shield size={16} color="#a1a1aa" />
          <span>Lockdown Mode</span>
        {/if}
      </button>

      <button class="icon-btn" style="width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;" onclick={loadData} title="Refresh Shares">
        <RefreshCw size={18} class={isLoading ? 'spin' : ''} />
      </button>
    </div>
  </div>

  <!-- Lockdown Active Alert Banner -->
  {#if isLockdown}
    <div class="lockdown-banner">
      <div style="display: flex; align-items: center; gap: 12px;">
        <AlertTriangle size={24} color="#ef4444" />
        <div>
          <strong style="color: #fecaca; font-size: 1rem;">LOCKDOWN MODE ACTIVE: All Share Links Are Disabled</strong>
          <p style="margin: 2px 0 0 0; color: #fca5a5; font-size: 0.85rem;">
            Public access to all shared albums, folders, and media files is currently blocked system-wide.
          </p>
        </div>
      </div>
      <button class="btn" style="background: #10b981; color: white; border: none; font-weight: 500; font-size: 0.85rem; padding: 8px 16px; white-space: nowrap;" onclick={promptLockdownToggle}>
        Deactivate Lockdown
      </button>
    </div>
  {/if}

  <!-- Newly created share notification -->
  {#if newlyCreatedToken}
    <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); padding: 16px; border-radius: 8px; margin-bottom: 20px;">
      <p style="color: #34d399; margin: 0 0 8px 0; font-weight: 500;">Share link created successfully!</p>
      <div style="display: flex; gap: 8px;">
        <input type="text" readonly value="{env.PUBLIC_APP_DOMAIN || window.location.origin}/share/{newlyCreatedToken}" style="flex: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 6px; font-family: monospace; font-size: 0.85rem;" />
        <button class="icon-btn" style="display: flex; align-items: center; justify-content: center; width: 42px; background: rgba(255,255,255,0.08);" onclick={() => copyLink(newlyCreatedToken!)}>
          {#if copiedToken === newlyCreatedToken}
            <Check size={18} color="#10b981" />
          {:else}
            <Copy size={18} color="#a1a1aa" />
          {/if}
        </button>
      </div>
    </div>
  {/if}

  <!-- Controls Bar: Search & Sub-tabs & Create Toggle -->
  <div class="controls-bar" style="display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 20px; align-items: center; justify-content: space-between;">
    <!-- Sub-tabs -->
    <div style="display: flex; gap: 6px; background: rgba(0,0,0,0.25); padding: 4px; border-radius: 8px; border: 1px solid var(--glass-border);">
      <button class="tab-btn" class:active={subTab === 'all'} onclick={() => subTab = 'all'}>
        All ({shares.length})
      </button>
      <button class="tab-btn" class:active={subTab === 'active'} onclick={() => subTab = 'active'}>
        Active ({activeCount})
      </button>
      <button class="tab-btn" class:active={subTab === 'expired'} onclick={() => subTab = 'expired'}>
        Expired ({expiredCount})
      </button>
      <button class="tab-btn" class:active={subTab === 'disabled'} onclick={() => subTab = 'disabled'}>
        Disabled ({disabledCount})
      </button>
    </div>

    <!-- Search Section (search button by link, name, file name) -->
    <div style="display: flex; align-items: center; gap: 8px; flex: 1; max-width: 520px; min-width: 280px;">
      <form onsubmit={(e) => { e.preventDefault(); handleSearch(); }} style="display: flex; gap: 8px; width: 100%;">
        <div style="position: relative; flex: 1;">
          <Search size={16} color="#71717a" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); pointer-events: none;" />
          <input 
            type="text" 
            bind:value={searchQuery} 
            placeholder="Search link, name, or file name..." 
            style="width: 100%; padding: 8px 36px 8px 36px; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); border-radius: 8px; color: white; font-size: 0.85rem;" 
          />
          {#if searchQuery}
            <button 
              type="button" 
              onclick={clearSearch} 
              style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #a1a1aa; cursor: pointer; padding: 2px;">
              <X size={14} />
            </button>
          {/if}
        </div>
        <button type="submit" class="btn search-btn" title="Search by link, name or file name">
          <Search size={14} />
          <span>Search</span>
        </button>
      </form>

      <button 
        class="btn" 
        style="background: {showCreatePanel ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}; border: 1px solid var(--glass-border); color: white; padding: 8px 12px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; white-space: nowrap;"
        onclick={() => showCreatePanel = !showCreatePanel}>
        <Plus size={15} />
        <span>Create Share</span>
      </button>
    </div>
  </div>

  <!-- Create New Share Link Section (Matching Modal) -->
  {#if showCreatePanel}
    <div class="create-panel" style="margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <h4 style="margin: 0; font-weight: 500; font-size: 1rem; color: #fff;">Create New Share Link</h4>
        <button class="icon-btn" onclick={() => showCreatePanel = false}>
          <X size={16} />
        </button>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
        <!-- Target Type & Path -->
        <div>
          <label style="display: block; font-size: 0.8rem; color: #a1a1aa; margin-bottom: 6px;">Target Type</label>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <button 
              type="button" 
              class="btn mode-btn" 
              class:active={createTargetType === 'folder'}
              onclick={() => createTargetType = 'folder'}>
              Folder
            </button>
            <button 
              type="button" 
              class="btn mode-btn" 
              class:active={createTargetType === 'media'}
              onclick={() => createTargetType = 'media'}>
              Single Media File
            </button>
          </div>
          <input 
            type="text" 
            bind:value={createTargetPath} 
            placeholder={createTargetType === 'folder' ? 'Folder path (e.g. Vacation/2026 or leave blank for root)' : 'Media UUID (e.g. 123e4567-e89b...)'} 
            style="width: 100%; padding: 8px 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); border-radius: 6px; color: white; font-size: 0.85rem;" 
          />
        </div>

        <!-- Expiration Picker Matching Folder Modal -->
        <div>
          <label style="display: block; font-size: 0.8rem; color: #a1a1aa; margin-bottom: 6px;">Expiration</label>
          <div style="display: flex; gap: 6px; margin-bottom: 8px;">
            <button 
              type="button" 
              class="btn mode-btn" 
              class:active={createExpiryMode === 'duration'}
              onclick={() => createExpiryMode = 'duration'}>
              Duration
            </button>
            <button 
              type="button" 
              class="btn mode-btn" 
              class:active={createExpiryMode === 'date'}
              onclick={() => createExpiryMode = 'date'}>
              Date & Time
            </button>
            <button 
              type="button" 
              class="btn mode-btn" 
              class:active={createExpiryMode === 'never'}
              onclick={() => createExpiryMode = 'never'}>
              Never Expires
            </button>
          </div>

          {#if createExpiryMode === 'duration'}
            <div style="display: flex; gap: 8px;">
              <input 
                type="number" 
                bind:value={createExpiryValue} 
                min="1" 
                style="width: 80px; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 6px;" 
              />
              <select 
                bind:value={createExpiryUnit} 
                style="flex: 1; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 6px;">
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="months">Months</option>
                <option value="years">Years</option>
              </select>
            </div>
          {:else if createExpiryMode === 'date'}
            <input 
              type="datetime-local" 
              bind:value={createExpiryDateTime} 
              style="width: 100%; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 6px;" 
            />
          {/if}
        </div>
      </div>

      <!-- Permission Checkboxes -->
      <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #cbd5e1; cursor: pointer;">
          <input type="checkbox" bind:checked={createAllowDownloadImages} style="width: 16px; height: 16px;" />
          Allow downloading individual images
        </label>
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #cbd5e1; cursor: pointer;">
          <input type="checkbox" bind:checked={createAllowDownloadFolder} style="width: 16px; height: 16px;" />
          Allow downloading entire folder (ZIP)
        </label>
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #cbd5e1; cursor: pointer;">
          <input type="checkbox" bind:checked={createWatermarkEnabled} style="width: 16px; height: 16px;" />
          Enable watermark
        </label>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #a1a1aa;" onclick={() => showCreatePanel = false}>
          Cancel
        </button>
        <button class="btn" style="background: var(--text-color); color: var(--bg-color); font-weight: 500;" onclick={handleCreateShare} disabled={isCreating}>
          {isCreating ? 'Generating Link...' : 'Generate Share Link'}
        </button>
      </div>
    </div>
  {/if}

  <!-- Shares List Cards (Matching the modern Share Link Modal design) -->
  {#if isLoading}
    <div style="text-align: center; padding: 3rem; color: #a1a1aa;">
      <RefreshCw size={24} class="spin" style="margin-bottom: 8px; display: inline-block;" />
      <p>Loading share links...</p>
    </div>
  {:else if filteredShares().length === 0}
    <div class="glass-panel" style="text-align: center; padding: 3rem; border-radius: 12px;">
      <LinkIcon size={48} color="#a1a1aa" style="margin-bottom: 1rem; opacity: 0.5;" />
      <h3 style="color: #f4f4f5; margin-bottom: 0.5rem;">No Share Links Found</h3>
      <p style="color: #a1a1aa; max-width: 440px; margin: 0 auto;">
        {#if searchQuery}
          No share links matched your search "{searchQuery}".
        {:else if subTab !== 'all'}
          No {subTab} share links.
        {:else}
          Users haven't generated any share links yet.
        {/if}
      </p>
    </div>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 12px;">
      {#each filteredShares() as share}
        <div class="share-card" class:is-disabled={share.is_active === false} class:is-expired={isShareExpired(share.expires_at)}>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
            <!-- Left Info -->
            <div style="flex: 1; min-width: 260px;">
              <!-- Target & Token Header -->
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
                {#if share.folder_path}
                  <span style="display: flex; align-items: center; gap: 6px; color: #93c5fd; font-weight: 500; font-size: 0.95rem;">
                    <Folder size={16} color="#60a5fa" />
                    <a href="/folder/{share.folder_path}" target="_blank" style="color: inherit; text-decoration: none; font-family: monospace;">
                      {share.folder_path || 'Root Folder'}
                    </a>
                  </span>
                {:else if share.media_id}
                  <span style="display: flex; align-items: center; gap: 6px; color: #fbcfe8; font-weight: 500; font-size: 0.95rem;">
                    <Image size={16} color="#f472b6" />
                    <span style="font-family: monospace;">{share.media_file_name || share.media_id}</span>
                  </span>
                {:else if share.person_id}
                  <span style="display: flex; align-items: center; gap: 6px; color: #c4b5fd; font-weight: 500; font-size: 0.95rem;">
                    <User size={16} color="#a78bfa" />
                    <span>Person: {share.person_name || 'Person Gallery'}</span>
                  </span>
                {/if}

                <span style="font-family: monospace; color: #a1a1aa; font-size: 0.8rem; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px;">
                  ...{share.share_token.substring(0, 8)}
                </span>

                <!-- Status Badges -->
                {#if isLockdown}
                  <span class="badge" style="background: rgba(239, 68, 68, 0.25); color: #fca5a5; border-color: rgba(239, 68, 68, 0.4);">
                    Lockdown
                  </span>
                {:else if share.is_active === false}
                  <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);">
                    Disabled
                  </span>
                {:else if isShareExpired(share.expires_at)}
                  <span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; border-color: rgba(239, 68, 68, 0.3);">
                    Expired
                  </span>
                {:else}
                  <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-color: rgba(16, 185, 129, 0.3);">
                    Active
                  </span>
                {/if}
              </div>

              <!-- Expiration Line (Highlight) -->
              <div style="font-size: 0.85rem; margin-bottom: 6px;">
                {#if isShareExpired(share.expires_at)}
                  <span style="color: #f87171; font-weight: 500;">
                    Expired on {formatShareDate(share.expires_at)}
                  </span>
                {:else if share.expires_at}
                  <span style="color: #60a5fa; font-weight: 500;">
                    Expiring in {getNearestExpiryDuration(share.expires_at)}
                  </span>
                {:else}
                  <span style="color: #a1a1aa;">Never expires</span>
                {/if}
              </div>

              <!-- Details & Metadata row -->
              <div style="font-size: 0.75rem; color: #888; display: flex; gap: 14px; flex-wrap: wrap; align-items: center;">
                {#if share.expires_at}
                  <span style="display: flex; align-items: center; gap: 4px;">
                    <Clock size={12} />
                    {formatShareDate(share.expires_at)}
                  </span>
                {/if}
                <span style="display: flex; align-items: center; gap: 4px;">
                  <User size={12} />
                  {share.creator_name || share.creator_email || 'System'}
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
                  {#if share.watermark_enabled}
                    · Watermarked
                  {/if}
                </span>
                <span style="color: #cbd5e1;">
                  Views: <strong style="color: #fff;">{share.views || 0}</strong> · DLs: <strong style="color: #fff;">{share.downloads || 0}</strong>
                </span>
                <span>
                  Created: {new Date(share.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>

            <!-- Right Actions Toolbar -->
            <div style="display: flex; gap: 6px; align-items: center;">
              <!-- Edit Parameters button -->
              <button 
                class="icon-btn" 
                title="Edit Parameters" 
                onclick={() => startEditingShare(share)}
                style="color: {editingToken === share.share_token ? '#60a5fa' : '#a1a1aa'};">
                <Pencil size={16} />
              </button>

              <!-- Power button -->
              <button 
                class="icon-btn" 
                title={share.is_active === false ? "Enable Link" : "Disable Link (Temporary)"} 
                onclick={() => toggleDisable(share)}>
                {#if share.is_active === false}
                  <Power size={16} color="#9ca3af" />
                {:else}
                  <Power size={16} color="#10b981" />
                {/if}
              </button>

              <!-- Extend button (for expired or any link) -->
              {#if isShareExpired(share.expires_at)}
                <button 
                  class="btn" 
                  style="padding: 4px 8px; font-size: 0.75rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); color: #93c5fd; display: flex; align-items: center; gap: 4px;"
                  title="Extend Validity" 
                  onclick={() => startExtendingShare(share)}>
                  <Clock size={12} />
                  <span>Extend</span>
                </button>
              {/if}

              <!-- Copy Link -->
              <button class="icon-btn" title="Copy Link" onclick={() => copyLink(share.share_token)}>
                {#if copiedToken === share.share_token}
                  <Check size={16} color="#10b981" />
                {:else}
                  <Copy size={16} color="#a1a1aa" />
                {/if}
              </button>

              <!-- Revoke / Delete -->
              <button class="icon-btn danger" title="Revoke & Delete Link" onclick={() => promptRevoke(share.share_token)}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <!-- Inline Edit Parameters Panel (Matching Modal) -->
          {#if editingToken === share.share_token}
            <div class="edit-panel">
              <div style="font-size: 0.85rem; color: #fff; margin-bottom: 12px; font-weight: 500; display: flex; align-items: center; gap: 8px;">
                <Pencil size={14} color="#60a5fa" />
                <span>Edit Share Parameters</span>
              </div>

              <!-- Expiration Section -->
              <div style="margin-bottom: 14px;">
                <label style="display: block; margin-bottom: 6px; font-size: 0.78rem; color: #aaa;">Expiration</label>
                <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                  <button 
                    type="button" 
                    class="btn mode-btn" 
                    class:active={editExpiryMode === 'duration'}
                    onclick={() => editExpiryMode = 'duration'}>
                    Duration
                  </button>
                  <button 
                    type="button" 
                    class="btn mode-btn" 
                    class:active={editExpiryMode === 'date'}
                    onclick={() => editExpiryMode = 'date'}>
                    Date & Time
                  </button>
                  <button 
                    type="button" 
                    class="btn mode-btn" 
                    class:active={editExpiryMode === 'never'}
                    onclick={() => editExpiryMode = 'never'}>
                    Never Expires
                  </button>
                </div>

                {#if editExpiryMode === 'duration'}
                  <div style="display: flex; gap: 8px;">
                    <input 
                      type="number" 
                      bind:value={editExpiryValue} 
                      min="1" 
                      style="width: 80px; padding: 6px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.85rem;" 
                    />
                    <select 
                      bind:value={editExpiryUnit} 
                      style="flex: 1; padding: 6px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.85rem;">
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                      <option value="months">Months</option>
                      <option value="years">Years</option>
                    </select>
                  </div>
                {:else if editExpiryMode === 'date'}
                  <input 
                    type="datetime-local" 
                    bind:value={editExpiryDateTime} 
                    style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.85rem;" 
                  />
                {/if}
              </div>

              <!-- Options Section -->
              <div style="margin-bottom: 14px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
                <label style="display: block; margin-bottom: 8px; font-size: 0.78rem; color: #aaa;">Options & Permissions</label>
                <div style="display: flex; gap: 16px; flex-wrap: wrap;">
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: #ccc; cursor: pointer;">
                    <input type="checkbox" bind:checked={editAllowDownloadImages} style="width: 16px; height: 16px;" />
                    Allow downloading individual images
                  </label>
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: #ccc; cursor: pointer;">
                    <input type="checkbox" bind:checked={editAllowDownloadFolder} style="width: 16px; height: 16px;" />
                    Allow downloading entire folder (ZIP)
                  </label>
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: #ccc; cursor: pointer;">
                    <input type="checkbox" bind:checked={editWatermarkEnabled} style="width: 16px; height: 16px;" />
                    Enable watermark
                  </label>
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: #ccc; cursor: pointer;">
                    <input type="checkbox" bind:checked={editIsActive} style="width: 16px; height: 16px;" />
                    Link is active (enabled)
                  </label>
                </div>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button class="btn" style="padding: 6px 12px; font-size: 0.8rem; background: transparent; border: 1px solid var(--glass-border); color: #888;" onclick={() => editingToken = null}>
                  Cancel
                </button>
                <button class="btn" style="padding: 6px 16px; font-size: 0.8rem; background: var(--text-color); color: var(--bg-color);" disabled={isSavingEdit} onclick={() => handleSaveShareEdit(share.share_token)}>
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          {/if}

          <!-- Inline Extend Validity Panel -->
          {#if extendingToken === share.share_token}
            <div class="extend-panel">
              <div style="font-size: 0.85rem; color: #ccc; margin-bottom: 8px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                <Clock size={14} color="#60a5fa" />
                <span>Extend Validity & Reactivate Link</span>
              </div>
              <div style="display: flex; gap: 6px; margin-bottom: 10px;">
                <button 
                  type="button" 
                  class="btn mode-btn" 
                  class:active={extendExpiryMode === 'duration'}
                  onclick={() => extendExpiryMode = 'duration'}>
                  Duration
                </button>
                <button 
                  type="button" 
                  class="btn mode-btn" 
                  class:active={extendExpiryMode === 'date'}
                  onclick={() => extendExpiryMode = 'date'}>
                  Specific Date & Time
                </button>
              </div>

              {#if extendExpiryMode === 'duration'}
                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                  <input type="number" bind:value={extendExpiryValue} min="1" style="width: 80px; padding: 6px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;" />
                  <select bind:value={extendExpiryUnit} style="flex: 1; padding: 6px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;">
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="months">Months</option>
                    <option value="years">Years</option>
                  </select>
                </div>
              {:else}
                <div style="margin-bottom: 12px;">
                  <input type="datetime-local" bind:value={extendExpiryDateTime} style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;" />
                </div>
              {/if}

              <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button class="btn" style="padding: 6px 12px; font-size: 0.8rem; background: transparent; border: 1px solid var(--glass-border); color: #888;" onclick={() => extendingToken = null}>
                  Cancel
                </button>
                <button class="btn" style="padding: 6px 16px; font-size: 0.8rem; background: #3b82f6; color: white; border: none;" disabled={isExtending} onclick={() => handleExtendShare(share.share_token)}>
                  {isExtending ? 'Extending...' : 'Save & Extend'}
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Modal: Revoke Confirmation -->
<Modal bind:show={showRevokeConfirm} id="admin-revoke-confirm" title="Revoke Share Link">
  <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5;">
    Are you sure you want to revoke this share link? Anyone using it will instantly lose access.
  </p>
  <div style="display: flex; justify-content: flex-end; gap: 1rem;">
    <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => { showRevokeConfirm = false; revokeTargetToken = ''; }}>Cancel</button>
    <button class="btn" style="background: #ef4444; color: white; border: none;" onclick={confirmRevokeShare}>Revoke</button>
  </div>
</Modal>

<!-- Modal: Lockdown Confirmation -->
<Modal bind:show={showLockdownConfirm} id="admin-lockdown-confirm" title={isLockdown ? 'Deactivate Lockdown Mode' : 'Activate Lockdown Mode'}>
  {#if isLockdown}
    <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5;">
      Are you sure you want to <strong>deactivate Lockdown Mode</strong>? All active share links will immediately be re-enabled and accessible to visitors.
    </p>
    <div style="display: flex; justify-content: flex-end; gap: 1rem;">
      <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => showLockdownConfirm = false}>Cancel</button>
      <button class="btn" style="background: #10b981; color: white; border: none; font-weight: 500;" disabled={isTogglingLockdown} onclick={confirmLockdownToggle}>
        {isTogglingLockdown ? 'Deactivating...' : 'Deactivate Lockdown'}
      </button>
    </div>
  {:else}
    <p style="color: #fca5a5; margin-bottom: 12px; line-height: 1.5; font-weight: 500;">
      Warning: Enabling Lockdown Mode will immediately block and disable all public share links across the entire system.
    </p>
    <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5; font-size: 0.9rem;">
      Visitors attempting to access any share link will receive a Lockdown notice. Authenticated administrators and users with direct account access will not be affected.
    </p>
    <div style="display: flex; justify-content: flex-end; gap: 1rem;">
      <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => showLockdownConfirm = false}>Cancel</button>
      <button class="btn" style="background: #ef4444; color: white; border: none; font-weight: 500;" disabled={isTogglingLockdown} onclick={confirmLockdownToggle}>
        {isTogglingLockdown ? 'Activating...' : 'Activate Lockdown'}
      </button>
    </div>
  {/if}
</Modal>

<style>
  .admin-container {
    width: 100%;
    color: #f4f4f5;
  }

  .lockdown-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    border: 1px solid rgba(239, 68, 68, 0.4);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 9999px;
  }

  .lockdown-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--glass-border);
    color: #f4f4f5;
    font-size: 0.85rem;
    padding: 8px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s;
  }

  .lockdown-btn.is-active {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.4);
    color: #fca5a5;
  }

  .lockdown-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.18), rgba(185, 28, 28, 0.12));
    border: 1px solid rgba(239, 68, 68, 0.45);
    border-radius: 10px;
    padding: 16px 20px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .tab-btn {
    background: transparent;
    border: none;
    color: #a1a1aa;
    padding: 6px 12px;
    font-size: 0.8rem;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab-btn:hover {
    color: white;
  }

  .tab-btn.active {
    background: rgba(255,255,255,0.15);
    color: white;
    font-weight: 500;
  }

  .search-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid var(--glass-border);
    color: white;
    padding: 8px 14px;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .search-btn:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .create-panel {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    padding: 18px;
  }

  .share-card {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    padding: 14px 16px;
    transition: border-color 0.2s;
  }

  .share-card.is-disabled {
    opacity: 0.85;
    border-left: 3px solid #f59e0b;
  }

  .share-card.is-expired {
    border-left: 3px solid #ef4444;
  }

  .edit-panel, .extend-panel {
    margin-top: 12px;
    padding: 14px;
    background: rgba(0,0,0,0.45);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
  }

  .mode-btn {
    flex: 1;
    padding: 6px 8px;
    font-size: 0.75rem;
    background: rgba(0,0,0,0.3);
    color: white;
    border: 1px solid var(--glass-border);
  }

  .mode-btn.active {
    background: rgba(255,255,255,0.2);
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 0.72rem;
    font-weight: 500;
    border: 1px solid transparent;
  }

  .icon-btn {
    background: none;
    border: none;
    color: #a1a1aa;
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    transition: all 0.2s;
  }

  .icon-btn:hover {
    background: rgba(255,255,255,0.1);
    color: white;
  }

  .icon-btn.danger:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
