<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE, fetchFolderContent } from '$lib/api/media';
  import Modal from '$lib/components/Modal.svelte';
  import { ChevronLeft, UserPlus, Edit2, Trash2, Shield, Folder, Check, Plus, Minus, ChevronRight, Lock, Unlock } from '@lucide/svelte';

  let users: any[] = $state([]);
  let loading = $state(true);
  let showModal = $state(false);
  let editingUser: any = $state(null);

  let showPasswordPrompt = $state(false);
  let adminPasswordInput = $state('');

  let isUnlocked = $state(false);
  let sessionPassword = $state<string | null>(null);
  let lockTimeout: ReturnType<typeof setTimeout>;

  let showAlertModal = $state(false);
  let alertModalMessage = $state('');

  let showConfirmModal = $state(false);
  let confirmDeleteId = $state<string | null>(null);

  function showError(msg: string) {
    alertModalMessage = msg;
    showAlertModal = true;
  }

  function closeAlert() {
    showAlertModal = false;
  }

  function resetLockTimeout() {
    if (lockTimeout) clearTimeout(lockTimeout);
    lockTimeout = setTimeout(() => {
      lockSession();
    }, 5 * 60 * 1000);
  }

  function lockSession() {
    isUnlocked = false;
    sessionPassword = null;
    if (lockTimeout) clearTimeout(lockTimeout);
  }

  function handleUnlockClick() {
    if (isUnlocked) {
      lockSession();
    } else {
      adminPasswordInput = '';
      showPasswordPrompt = true;
    }
  }

  function closePasswordPrompt() {
    showPasswordPrompt = false;
  }

  async function submitUnlock() {
    if (!adminPasswordInput) return;
    sessionPassword = adminPasswordInput;
    isUnlocked = true;
    resetLockTimeout();
    showPasswordPrompt = false;
  }

  // Form states
  let formEmail = $state('');
  let formName = $state('');
  let formPassword = $state('');
  let formRole = $state('user');
  let folderPaths = $state<string[]>([]);
  let showFolderTree = $state(false);
  let treeCurrentPath = $state('');
  let treeSubdirs = $state<string[]>([]);
  let treeLoading = $state(false);

  async function loadUsers() {
    loading = true;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        users = data.users || [];
      }
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  let sortedUsers = $derived([...users].sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  ));

  function displayRole(role: string) {
    return role === 'super_admin' ? 'Super Admin' : role.charAt(0).toUpperCase() + role.slice(1);
  }

  async function openFolderTree() {
    treeCurrentPath = '';
    await loadTreeSubdirs('');
    showFolderTree = true;
  }

  async function loadTreeSubdirs(path: string) {
    treeLoading = true;
    try {
      const content = await fetchFolderContent(path || '.');
      treeSubdirs = (content.directories || []).map(d => d.name).sort();
      treeCurrentPath = path;
    } catch {
      treeSubdirs = [];
    } finally {
      treeLoading = false;
    }
  }

  async function enterSubdir(name: string) {
    const newPath = treeCurrentPath ? `${treeCurrentPath}/${name}` : name;
    await loadTreeSubdirs(newPath);
  }

  function goUpInTree() {
    const parts = treeCurrentPath.split('/');
    parts.pop();
    const parent = parts.join('/');
    loadTreeSubdirs(parent);
  }

  function selectCurrentFolder() {
    if (treeCurrentPath && !folderPaths.includes(treeCurrentPath)) {
      folderPaths = [...folderPaths, treeCurrentPath];
    }
    showFolderTree = false;
  }

  function removeFolder(path: string) {
    folderPaths = folderPaths.filter(p => p !== path);
  }

  onMount(() => {
    loadUsers();
  });

  function openCreateModal() {
    editingUser = null;
    formEmail = '';
    formName = '';
    formPassword = '';
    formRole = 'user';
    folderPaths = [];
    showModal = true;
  }

  function openEditModal(user: any) {
    editingUser = user;
    formEmail = user.email;
    formName = user.name;
    formPassword = '';
    formRole = user.role;
    folderPaths = user.folders ? [...user.folders] : [];
    showModal = true;
  }

  async function saveUser() {
    if (!isUnlocked || !sessionPassword) {
      showError('Please unlock settings first.');
      return;
    }
    resetLockTimeout();

    const payload = {
      email: formEmail,
      name: formName,
      role: formRole,
      password: formPassword || undefined,
      folders: folderPaths
    };

    const method = editingUser ? 'PUT' : 'POST';
    const url = editingUser 
      ? `${API_BASE}/api/admin/users/${editingUser.id}` 
      : `${API_BASE}/api/admin/users`;

    const res = await fetch(url, {
      method,
      headers: { 
        'Content-Type': 'application/json',
        'x-admin-password': sessionPassword
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showModal = false;
      loadUsers();
    } else {
      const data = await res.json();
      if (res.status === 401 || res.status === 403 || data.error?.toLowerCase().includes('password')) {
        lockSession();
        showError('Invalid admin password. Session locked.');
      } else {
        showError(data.error || 'Failed to save user');
      }
    }
  }

  function showDeleteConfirm(id: string) {
    confirmDeleteId = id;
    showConfirmModal = true;
  }

  async function confirmDeleteUser() {
    if (!isUnlocked || !sessionPassword) {
      showError('Please unlock settings first.');
      return;
    }
    showConfirmModal = false;
    if (confirmDeleteId) {
      resetLockTimeout();
      const res = await fetch(`${API_BASE}/api/admin/users/${confirmDeleteId}`, { 
        method: 'DELETE', 
        headers: { 'x-admin-password': sessionPassword },
        credentials: 'include' 
      });
      if (res.ok) {
        loadUsers();
      } else {
        const data = await res.json();
        if (res.status === 401 || res.status === 403 || data.error?.toLowerCase().includes('password')) {
          lockSession();
          showError('Invalid admin password. Session locked.');
        } else {
          showError(data.error || 'Failed to delete user');
        }
      }
    }
  }
</script>

<div class="admin-container">
  <div class="header">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a href="/admin" title="Back to Admin Dashboard" style="display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; color: rgba(255,255,255,0.4); text-decoration: none; transition: color 0.2s, transform 0.2s;" onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }} onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}>
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>User Management</h2>
      <p>Manage user accounts, roles, and folder access scopes.</p>
    </div>
    </div>
    <div style="display: flex; gap: 12px; align-items: center;">
      <button class="btn {isUnlocked ? 'secondary' : 'primary'}" onclick={handleUnlockClick} style={isUnlocked ? 'color: #10b981; border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.1);' : ''}>
        {#if isUnlocked}
          <Unlock size={18} /> Unlocked
        {:else}
          <Lock size={18} /> Unlock to Edit
        {/if}
      </button>
      {#if isUnlocked}
        <button class="btn primary" onclick={openCreateModal}>
          <UserPlus size={18} /> Add New User
        </button>
      {/if}
    </div>
  </div>

  {#if loading}
    <div class="spinner"></div>
  {:else}
    <div class="table-container card">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Folder Access</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedUsers as user}
            <tr>
              <td>{user.name}</td>
              <td class="email-cell">{user.email}</td>
              <td>
                <span class="badge {user.role}">
                  {#if user.role === 'admin' || user.role === 'super_admin'}
                    <Shield size={14} />
                  {/if}
                  {displayRole(user.role)}
                </span>
              </td>
              <td class="folders-cell">
                {#if user.role === 'admin' || user.role === 'super_admin'}
                  <span class="muted">Full Access</span>
                {:else if user.folders && user.folders.length > 0}
                  <div class="folder-tags">
                    {#each user.folders as folder}
                      <span class="tag"><Folder size={12} /> {folder}</span>
                    {/each}
                  </div>
                {:else}
                  <span class="muted">No access</span>
                {/if}
              </td>
              <td class="actions">
                {#if isUnlocked}
                  <button class="icon-btn edit" onclick={() => openEditModal(user)} title="Edit">
                    <Edit2 size={16} />
                  </button>
                  {#if user.email !== 'admin@example.com'}
                    <button class="icon-btn delete" onclick={() => showDeleteConfirm(user.id)} title="Delete">
                      <Trash2 size={16} />
                    </button>
                  {/if}
                {:else}
                  <span class="muted" style="display: flex; align-items: center; gap: 4px; font-size: 0.8rem; justify-content: center;"><Lock size={12}/> Locked</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<Modal bind:show={showModal} id="user-form" title={editingUser ? 'Edit User' : 'Create New User'}>
  <div class="form-group">
    <label>Display Name</label>
    <input type="text" bind:value={formName} placeholder="Jane Doe" />
  </div>
  
  <div class="form-group">
    <label>Email Address</label>
    <input type="email" bind:value={formEmail} placeholder="jane@example.com" />
  </div>

  <div class="form-group">
    <label>Password {editingUser ? '(Leave blank to keep current)' : ''}</label>
    <input type="password" bind:value={formPassword} placeholder="••••••••" />
  </div>

  <div class="form-group">
    <label>Role</label>
    <select bind:value={formRole}>
      <option value="super_admin">Super Admin (Master Access)</option>
      <option value="admin">Admin (Full Access)</option>
      <option value="user">User (View/Share)</option>
      <option value="viewer">Viewer (Read Only)</option>
    </select>
  </div>

  {#if formRole !== 'admin' && formRole !== 'super_admin'}
    <div class="form-group">
      <label>Folder Access</label>
      <div class="folder-list">
        {#each folderPaths as path}
          <div class="folder-list-item">
            <Folder size={14} />
            <span>{path}</span>
            <button class="icon-btn remove-btn" onclick={() => removeFolder(path)} title="Remove"><Minus size={14} /></button>
          </div>
        {/each}
      </div>
      <button class="btn secondary add-folder-btn" onclick={openFolderTree}>
        <Plus size={16} /> Add Folder
      </button>
    </div>
  {/if}
  
  <div class="modal-actions">
    <button class="btn secondary" onclick={() => showModal = false}>Cancel</button>
    <button class="btn primary" onclick={saveUser}>
          Save User
    </button>
  </div>
</Modal>

<Modal bind:show={showPasswordPrompt} id="password-prompt" title="Admin Verification">
  <p style="color: #cbd5e1; margin-bottom: 16px; font-size: 0.95rem;">Please enter your admin password to confirm this action.</p>
  <div class="form-group">
    <input type="password" bind:value={adminPasswordInput} placeholder="Admin Password" onkeydown={(e) => e.key === 'Enter' && submitUnlock()} />
  </div>
  
  <div class="modal-actions" style="margin-top: 24px;">
    <button class="btn secondary" onclick={closePasswordPrompt}>Cancel</button>
    <button class="btn primary" onclick={submitUnlock}>
      <Check size={18} /> Confirm
    </button>
  </div>
</Modal>

<Modal bind:show={showAlertModal} id="alert" title="Error">
  <p style="color: #cbd5e1; margin-bottom: 24px; line-height: 1.5;">{alertModalMessage}</p>
  <div class="modal-actions">
    <button class="btn primary" onclick={closeAlert}>Okay</button>
  </div>
</Modal>

<Modal bind:show={showConfirmModal} id="delete-confirm" title="Delete User">
  <p style="color: #cbd5e1; margin-bottom: 24px; line-height: 1.5;">Are you sure you want to delete this user? This cannot be undone.</p>
  <div class="modal-actions">
    <button class="btn secondary" onclick={() => showConfirmModal = false}>Cancel</button>
    <button class="btn primary" onclick={confirmDeleteUser} style="background: linear-gradient(135deg, #ef4444, #dc2626);">Delete</button>
  </div>
</Modal>

<Modal bind:show={showFolderTree} id="folder-tree" title={treeCurrentPath || 'Home'}>
  {#if treeLoading}
    <div class="spinner"></div>
  {:else}
    {#if treeCurrentPath}
      <button class="btn secondary" style="width: 100%; margin-bottom: 12px; justify-content: center;" onclick={goUpInTree}>.. / Go up</button>
    {/if}
    <div class="tree-list">
      {#each treeSubdirs as dir}
        <button class="tree-list-item" onclick={() => enterSubdir(dir)}>
          <Folder size={16} />
          <span>{dir}</span>
          <ChevronRight size={14} />
        </button>
      {/each}
    </div>
    {#if treeSubdirs.length === 0}
      <p style="color: #71717a; text-align: center; margin: 24px 0;">No subdirectories</p>
    {/if}
  {/if}
  <div class="modal-actions" style="margin-top: 16px;">
    {#if treeCurrentPath}
      <button class="btn primary" onclick={selectCurrentFolder} style="flex: 1; justify-content: center;">Add "{treeCurrentPath}"</button>
    {/if}
    <button class="btn secondary" onclick={() => showFolderTree = false}>Cancel</button>
  </div>
</Modal>

<style>
  .admin-container {
    width: 100%;
    color: #f4f4f5;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 2rem;
  }



  h2 {
    font-size: 2rem;
    margin: 0 0 0.5rem 0;
  }

  p {
    color: #a1a1aa;
    margin: 0;
  }

  .card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }

  .table-container {
    overflow-x: auto;
    padding: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
  }

  th {
    padding: 1rem;
    font-size: 0.85rem;
    color: #a1a1aa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  td {
    padding: 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    vertical-align: middle;
  }

  .email-cell {
    color: #d4d4d8;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: capitalize;
  }

  .badge.super_admin {
    background: rgba(234, 179, 8, 0.2);
    color: #fde047;
    border: 1px solid rgba(234, 179, 8, 0.3);
  }

  .badge.admin {
    background: rgba(168, 85, 247, 0.2);
    color: #d8b4fe;
    border: 1px solid rgba(168, 85, 247, 0.3);
  }

  .badge.user {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .badge.viewer {
    background: rgba(161, 161, 170, 0.2);
    color: #d4d4d8;
    border: 1px solid rgba(161, 161, 170, 0.3);
  }

  .folders-cell {
    max-width: 250px;
  }

  .folder-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: rgba(255, 255, 255, 0.1);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    color: #e4e4e7;
  }

  .muted {
    color: #71717a;
    font-size: 0.85rem;
    font-style: italic;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .icon-btn {
    background: rgba(255,255,255,0.05);
    border: none;
    color: #a1a1aa;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .icon-btn.edit:hover { color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
  .icon-btn.delete:hover { color: #ef4444; background: rgba(239, 68, 68, 0.1); }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
  }

  .btn.primary {
    background: linear-gradient(135deg, #6366f1, #a855f7);
    color: white;
  }

  .btn.secondary {
    background: rgba(255,255,255,0.1);
    color: white;
  }

  .form-group {
    margin-bottom: 1.25rem;
  }

  .form-group label {
    display: block;
    font-size: 0.85rem;
    color: #a1a1aa;
    margin-bottom: 0.5rem;
  }

  .help-text {
    font-size: 0.75rem;
    color: #71717a;
    margin-top: -0.25rem;
    margin-bottom: 0.5rem;
  }

  input, select {
    width: 100%;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    padding: 0.75rem;
    border-radius: 6px;
    color: white;
    font-family: inherit;
    box-sizing: border-box;
  }

  input:focus, select:focus {
    outline: none;
    border-color: #a855f7;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    margin-top: 1rem;
  }

  .folder-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }

  .folder-list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: rgba(255,255,255,0.05);
    border-radius: 6px;
    font-size: 0.85rem;
    color: #e4e4e7;
  }

  .folder-list-item span {
    flex: 1;
  }

  .remove-btn {
    background: none;
    border: none;
    color: #a1a1aa;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .remove-btn:hover {
    color: #ef4444;
    background: rgba(239,68,68,0.15);
  }

  .add-folder-btn {
    width: 100%;
    justify-content: center;
  }

  .tree-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 300px;
    overflow-y: auto;
  }

  .tree-list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    background: rgba(255,255,255,0.03);
    border: none;
    border-radius: 6px;
    color: #e4e4e7;
    cursor: pointer;
    font-size: 0.9rem;
    font-family: inherit;
    text-align: left;
    transition: background 0.2s;
  }

  .tree-list-item:hover {
    background: rgba(255,255,255,0.08);
  }

  .tree-list-item span {
    flex: 1;
  }

  .spinner {
    border: 3px solid rgba(255,255,255,0.1);
    border-top: 3px solid #a855f7;
    border-radius: 50%;
    width: 30px;
    height: 30px;
    animation: spin 1s linear infinite;
    margin: 2rem auto;
  }
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

  @media (max-width: 900px) {
    h2 { font-size: 1.5rem; }
    .header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .header > div:last-child { flex-wrap: wrap; }
    .card { padding: 1rem; }
  }
</style>
