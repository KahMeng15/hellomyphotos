<script lang="ts">
  import { onMount } from 'svelte';
  import { 
    ChevronLeft, Mail, Clock, Folder, Image, User, Check, Trash2, 
    Search, X, ExternalLink, RefreshCw, AlertCircle, Send
  } from '@lucide/svelte';
  import { 
    getAdminAccessRequests, deleteAdminAccessRequest, respondAccessRequest,
    type AccessRequest 
  } from '$lib/api/shares';
  import { formatShareDate } from '$lib/utils/shareUtils';
  import { toast } from '$lib/stores/toast';
  import Modal from '$lib/components/Modal.svelte';

  let requests: any[] = $state([]);
  let isLoading = $state(true);
  let statusFilter: 'all' | 'pending' | 'resolved' = $state('all');
  let searchQuery = $state('');
  let serverSearchQuery = $state('');

  // Delete confirm state
  let showDeleteConfirm = $state(false);
  let deleteTargetId = $state('');

  // Response state
  let respondingRequestId = $state<string | null>(null);
  let requestAction: 'extend' | 'reactivate' | 'new_link' = $state('extend');
  let requestExpiryMode: 'duration' | 'date' | 'never' = $state('duration');
  let requestExpiryValue = $state(7);
  let requestExpiryUnit: 'hours' | 'days' | 'months' | 'years' = $state('days');
  let requestExpiryDateTime = $state('');
  let requestNotifyUser = $state(true);
  let isRespondingRequest = $state(false);

  function toDateTimeLocal(d: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function fetchRequests() {
    isLoading = true;
    try {
      requests = await getAdminAccessRequests(statusFilter === 'all' ? undefined : statusFilter, serverSearchQuery || undefined);
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to load access requests');
    } finally {
      isLoading = false;
    }
  }

  function handleSearch() {
    serverSearchQuery = searchQuery.trim();
    fetchRequests();
  }

  function clearSearch() {
    searchQuery = '';
    serverSearchQuery = '';
    fetchRequests();
  }

  function setFilter(filter: 'all' | 'pending' | 'resolved') {
    statusFilter = filter;
    fetchRequests();
  }

  let filteredRequests = $derived(() => {
    let list = requests;
    if (searchQuery.trim() && !serverSearchQuery) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(r => 
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.email && r.email.toLowerCase().includes(q)) ||
        (r.folder_path && r.folder_path.toLowerCase().includes(q)) ||
        (r.share_token && r.share_token.toLowerCase().includes(q)) ||
        (r.note && r.note.toLowerCase().includes(q)) ||
        (r.media_file_name && r.media_file_name.toLowerCase().includes(q)) ||
        (r.person_name && r.person_name.toLowerCase().includes(q))
      );
    }
    return list;
  });

  let pendingCount = $derived(requests.filter(r => r.status === 'pending').length);
  let resolvedCount = $derived(requests.filter(r => r.status !== 'pending').length);

  function openRespond(req: any) {
    respondingRequestId = req.id;
    requestNotifyUser = Boolean(req.email);
    requestAction = 'extend';
    requestExpiryMode = 'duration';
    requestExpiryValue = 7;
    requestExpiryUnit = 'days';
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    requestExpiryDateTime = toDateTimeLocal(future);
  }

  async function handleGrantAccess(req: any) {
    try {
      isRespondingRequest = true;
      let expiresAt: string | null = null;
      if (requestExpiryMode === 'duration' && requestExpiryValue > 0) {
        const date = new Date();
        if (requestExpiryUnit === 'hours') date.setHours(date.getHours() + requestExpiryValue);
        else if (requestExpiryUnit === 'days') date.setDate(date.getDate() + requestExpiryValue);
        else if (requestExpiryUnit === 'months') date.setMonth(date.getMonth() + requestExpiryValue);
        else if (requestExpiryUnit === 'years') date.setFullYear(date.getFullYear() + requestExpiryValue);
        expiresAt = date.toISOString();
      } else if (requestExpiryMode === 'date' && requestExpiryDateTime) {
        expiresAt = new Date(requestExpiryDateTime).toISOString();
      }

      await respondAccessRequest(req.id, {
        action: requestAction,
        expiresAt,
        notifyUser: requestNotifyUser
      });

      toast.success(requestNotifyUser ? 'Access granted and email notification sent!' : 'Access granted successfully!');
      respondingRequestId = null;
      await fetchRequests();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to grant access');
    } finally {
      isRespondingRequest = false;
    }
  }

  function promptDelete(id: string) {
    deleteTargetId = id;
    showDeleteConfirm = true;
  }

  async function confirmDelete() {
    try {
      await deleteAdminAccessRequest(deleteTargetId);
      toast.success('Access request removed');
      requests = requests.filter(r => r.id !== deleteTargetId);
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to delete request');
    } finally {
      showDeleteConfirm = false;
      deleteTargetId = '';
    }
  }

  onMount(() => {
    fetchRequests();
  });
</script>

<div class="admin-container">
  <!-- Top Navigation & Header -->
  <div class="header" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a href="/admin/shares" class="icon-btn" style="text-decoration: none; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: rgba(255,255,255,0.05); border-radius: 50%; color: white;" title="Back to Shares">
        <ChevronLeft size={24} />
      </a>
      <div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <h2 style="margin: 0; font-size: 1.8rem;">Share Access Requests</h2>
          {#if pendingCount > 0}
            <span style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 0.8rem; font-weight: 600; padding: 2px 8px; border-radius: 9999px;">
              {pendingCount} Pending
            </span>
          {/if}
        </div>
        <p style="color: #a1a1aa; margin-top: 0.35rem; margin-bottom: 0; font-size: 0.9rem;">
          View, review, and grant access to visitors requesting reactivation or new links.
        </p>
      </div>
    </div>

    <div style="display: flex; gap: 10px;">
      <a href="/admin/shares" class="btn" style="background: rgba(255,255,255,0.06); border: 1px solid var(--glass-border); color: white; text-decoration: none; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; padding: 8px 14px;">
        <span>Manage All Shares</span>
      </a>
      <button class="icon-btn" style="width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;" onclick={fetchRequests} title="Refresh Requests">
        <RefreshCw size={18} class={isLoading ? 'spin' : ''} />
      </button>
    </div>
  </div>

  <!-- Search and Filter Bar -->
  <div class="search-filter-bar" style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; align-items: center; justify-content: space-between;">
    <!-- Filter Tabs -->
    <div style="display: flex; gap: 6px; background: rgba(0,0,0,0.25); padding: 4px; border-radius: 8px; border: 1px solid var(--glass-border);">
      <button 
        class="tab-btn" 
        class:active={statusFilter === 'all'} 
        onclick={() => setFilter('all')}>
        All ({requests.length})
      </button>
      <button 
        class="tab-btn" 
        class:active={statusFilter === 'pending'} 
        onclick={() => setFilter('pending')}>
        Pending ({pendingCount})
      </button>
      <button 
        class="tab-btn" 
        class:active={statusFilter === 'resolved'} 
        onclick={() => setFilter('resolved')}>
        Resolved ({resolvedCount})
      </button>
    </div>

    <!-- Search input & button -->
    <form onsubmit={(e) => { e.preventDefault(); handleSearch(); }} style="display: flex; gap: 8px; flex: 1; max-width: 480px; min-width: 280px;">
      <div style="position: relative; flex: 1;">
        <Search size={16} color="#71717a" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); pointer-events: none;" />
        <input 
          type="text" 
          bind:value={searchQuery} 
          placeholder="Search requests by name, email, folder, or note..." 
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
      <button type="submit" class="btn" style="background: rgba(255,255,255,0.1); border: 1px solid var(--glass-border); color: white; padding: 8px 14px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
        <Search size={14} />
        <span>Search</span>
      </button>
    </form>
  </div>

  <!-- Content Section -->
  {#if isLoading}
    <div style="text-align: center; padding: 3rem; color: #a1a1aa;">
      <RefreshCw size={24} class="spin" style="margin-bottom: 8px; display: inline-block;" />
      <p>Loading access requests...</p>
    </div>
  {:else if filteredRequests().length === 0}
    <div class="glass-panel" style="text-align: center; padding: 3rem; border-radius: 12px;">
      <Mail size={48} color="#a1a1aa" style="margin-bottom: 1rem; opacity: 0.5;" />
      <h3 style="color: #f4f4f5; margin-bottom: 0.5rem;">No Access Requests Found</h3>
      <p style="color: #a1a1aa; max-width: 440px; margin: 0 auto;">
        {#if searchQuery}
          No access requests matched your search query "{searchQuery}".
        {:else if statusFilter !== 'all'}
          There are currently no {statusFilter} access requests.
        {:else}
          When users or visitors request access to expired or disabled shares, their requests will appear here.
        {/if}
      </p>
    </div>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 14px;">
      {#each filteredRequests() as req}
        <div class="request-card" class:is-pending={req.status === 'pending'}>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; flex-wrap: wrap;">
            <div>
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                <span style="font-weight: 600; color: #f4f4f5; font-size: 1.05rem;">
                  {req.name || 'Anonymous Requester'}
                </span>
                {#if req.status === 'pending'}
                  <span class="badge pending">Pending</span>
                {:else}
                  <span class="badge resolved">Resolved</span>
                {/if}
              </div>

              {#if req.email}
                <div style="font-size: 0.85rem; color: #60a5fa; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                  <Mail size={13} />
                  <a href="mailto:{req.email}" style="color: inherit; text-decoration: none;">{req.email}</a>
                </div>
              {/if}
            </div>

            <!-- Target info -->
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
              <div style="display: flex; align-items: center; gap: 6px; font-size: 0.82rem;">
                {#if req.folder_path || req.share_folder_path}
                  <Folder size={14} color="#60a5fa" />
                  <a href="/folder/{req.folder_path || req.share_folder_path}" target="_blank" style="color: #93c5fd; text-decoration: none; font-family: monospace;">
                    {req.folder_path || req.share_folder_path}
                  </a>
                {:else if req.media_file_name}
                  <Image size={14} color="#f472b6" />
                  <span style="color: #fbcfe8; font-family: monospace;">{req.media_file_name}</span>
                {:else if req.person_name}
                  <User size={14} color="#a78bfa" />
                  <span style="color: #c4b5fd;">Person: {req.person_name}</span>
                {:else}
                  <span style="color: #94a3b8; font-family: monospace;">Share: ...{req.share_token.substring(0, 8)}</span>
                {/if}
              </div>
              <div style="font-size: 0.75rem; color: #71717a; font-family: monospace;">
                Token: <a href="/share/{req.share_token}" target="_blank" style="color: #71717a; text-decoration: none;">{req.share_token}</a>
              </div>
            </div>
          </div>

          <!-- Note text if provided -->
          {#if req.note}
            <div class="note-box">
              <span style="font-style: italic;">"{req.note}"</span>
            </div>
          {/if}

          <!-- Metadata & Actions Row -->
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.06);">
            <div style="font-size: 0.78rem; color: #a1a1aa; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
              <span style="display: flex; align-items: center; gap: 4px;">
                <Clock size={12} color="#71717a" />
                Requested: {formatShareDate(req.created_at)}
              </span>
              {#if req.creator_email}
                <span style="display: flex; align-items: center; gap: 4px;">
                  <User size={12} color="#71717a" />
                  Created by: {req.creator_name || req.creator_email}
                </span>
              {/if}
            </div>

            <div style="display: flex; align-items: center; gap: 8px;">
              {#if req.status === 'pending'}
                <button 
                  class="btn" 
                  style="background: #3b82f6; color: white; border: none; padding: 6px 14px; font-size: 0.8rem; display: flex; align-items: center; gap: 6px;"
                  onclick={() => openRespond(req)}>
                  <Send size={13} />
                  <span>Respond & Grant</span>
                </button>
              {/if}
              <button 
                class="icon-btn danger" 
                title="Delete Request" 
                onclick={() => promptDelete(req.id)}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <!-- Inline Respond Form -->
          {#if respondingRequestId === req.id}
            <div class="respond-panel">
              <div style="font-weight: 500; font-size: 0.9rem; color: #f4f4f5; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                <Send size={15} color="#3b82f6" />
                <span>Grant Access & Configure Validity</span>
              </div>

              <!-- Action choice -->
              <div style="display: flex; gap: 16px; margin-bottom: 14px;">
                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #e4e4e7; cursor: pointer;">
                  <input type="radio" name="admin-req-action-{req.id}" value="extend" bind:group={requestAction} />
                  Reactivate & extend existing link
                </label>
                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #e4e4e7; cursor: pointer;">
                  <input type="radio" name="admin-req-action-{req.id}" value="new_link" bind:group={requestAction} />
                  Generate a fresh share link
                </label>
              </div>

              <!-- Validity picker matching modal -->
              <div style="margin-bottom: 14px;">
                <label style="display: block; font-size: 0.78rem; color: #a1a1aa; margin-bottom: 6px;">Validity Period</label>
                <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                  <button 
                    type="button" 
                    class="btn mode-btn" 
                    class:active={requestExpiryMode === 'duration'}
                    onclick={() => requestExpiryMode = 'duration'}>
                    Duration
                  </button>
                  <button 
                    type="button" 
                    class="btn mode-btn" 
                    class:active={requestExpiryMode === 'date'}
                    onclick={() => requestExpiryMode = 'date'}>
                    Specific Date & Time
                  </button>
                  <button 
                    type="button" 
                    class="btn mode-btn" 
                    class:active={requestExpiryMode === 'never'}
                    onclick={() => requestExpiryMode = 'never'}>
                    Never Expires
                  </button>
                </div>

                {#if requestExpiryMode === 'duration'}
                  <div style="display: flex; gap: 8px;">
                    <input 
                      type="number" 
                      bind:value={requestExpiryValue} 
                      min="1" 
                      style="width: 80px; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 6px;" 
                    />
                    <select 
                      bind:value={requestExpiryUnit} 
                      style="flex: 1; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 6px;">
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                      <option value="months">Months</option>
                      <option value="years">Years</option>
                    </select>
                  </div>
                {:else if requestExpiryMode === 'date'}
                  <input 
                    type="datetime-local" 
                    bind:value={requestExpiryDateTime} 
                    style="width: 100%; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 6px;" 
                  />
                {/if}
              </div>

              {#if req.email}
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 14px;">
                  <input type="checkbox" id="admin-notify-{req.id}" bind:checked={requestNotifyUser} style="width: 16px; height: 16px;" />
                  <label for="admin-notify-{req.id}" style="font-size: 0.85rem; color: #cbd5e1; cursor: pointer;">
                    Notify requester via email ({req.email}) with the share link
                  </label>
                </div>
              {/if}

              <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button 
                  class="btn" 
                  style="padding: 6px 12px; font-size: 0.8rem; background: transparent; border: 1px solid var(--glass-border); color: #a1a1aa;" 
                  onclick={() => respondingRequestId = null}>
                  Cancel
                </button>
                <button 
                  class="btn" 
                  style="padding: 6px 16px; font-size: 0.8rem; background: #10b981; color: white; border: none; font-weight: 500;" 
                  disabled={isRespondingRequest} 
                  onclick={() => handleGrantAccess(req)}>
                  {isRespondingRequest ? 'Processing...' : 'Confirm & Grant Access'}
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<Modal bind:show={showDeleteConfirm} id="admin-delete-request-confirm" title="Delete Access Request">
  <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5;">
    Are you sure you want to delete this access request record? This action cannot be undone.
  </p>
  <div style="display: flex; justify-content: flex-end; gap: 1rem;">
    <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => { showDeleteConfirm = false; deleteTargetId = ''; }}>
      Cancel
    </button>
    <button class="btn" style="background: #ef4444; color: white; border: none;" onclick={confirmDelete}>
      Delete
    </button>
  </div>
</Modal>

<style>
  .admin-container {
    width: 100%;
    color: #f4f4f5;
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

  .request-card {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    padding: 16px;
    transition: border-color 0.2s;
  }

  .request-card.is-pending {
    border-left: 4px solid #f59e0b;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 0.72rem;
    font-weight: 500;
  }

  .badge.pending {
    background: rgba(245, 158, 11, 0.2);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .badge.resolved {
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .note-box {
    background: rgba(0,0,0,0.3);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 0.85rem;
    color: #e4e4e7;
    margin: 8px 0;
    border-left: 2px solid rgba(255,255,255,0.2);
  }

  .respond-panel {
    margin-top: 14px;
    padding: 16px;
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
