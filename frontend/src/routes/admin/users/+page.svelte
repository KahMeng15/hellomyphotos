<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { UserPlus, Edit2, Trash2, Shield, Folder, X, Check } from '@lucide/svelte';

  let users: any[] = $state([]);
  let loading = $state(true);
  let showModal = $state(false);
  let editingUser: any = $state(null);

  // Form states
  let formEmail = $state('');
  let formName = $state('');
  let formPassword = $state('');
  let formRole = $state('user');
  let formFolders = $state(''); // Comma separated

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

  onMount(() => {
    loadUsers();
  });

  function openCreateModal() {
    editingUser = null;
    formEmail = '';
    formName = '';
    formPassword = '';
    formRole = 'user';
    formFolders = '';
    showModal = true;
  }

  function openEditModal(user: any) {
    editingUser = user;
    formEmail = user.email;
    formName = user.name;
    formPassword = '';
    formRole = user.role;
    formFolders = user.folders ? user.folders.join(', ') : '';
    showModal = true;
  }

  async function saveUser() {
    const payload = {
      email: formEmail,
      name: formName,
      role: formRole,
      password: formPassword || undefined,
      folders: formFolders.split(',').map(f => f.trim()).filter(f => f)
    };

    const method = editingUser ? 'PUT' : 'POST';
    const url = editingUser 
      ? `${API_BASE}/api/admin/users/${editingUser.id}` 
      : `${API_BASE}/api/admin/users`;

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showModal = false;
      loadUsers();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to save user');
    }
  }

  async function deleteUser(id: string) {
    if (confirm('Are you sure you want to delete this user? This cannot be undone.')) {
      await fetch(`${API_BASE}/api/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
      loadUsers();
    }
  }
</script>

<div class="admin-container">
  <div class="header">
    <div>
      <h2>User Management</h2>
      <p>Manage user accounts, roles, and folder access scopes.</p>
    </div>
    <button class="btn primary" onclick={openCreateModal}>
      <UserPlus size={18} /> Add New User
    </button>
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
          {#each users as user}
            <tr>
              <td>{user.name}</td>
              <td class="email-cell">{user.email}</td>
              <td>
                <span class="badge {user.role}">
                  {#if user.role === 'admin'}
                    <Shield size={14} />
                  {/if}
                  {user.role}
                </span>
              </td>
              <td class="folders-cell">
                {#if user.role === 'admin'}
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
                <button class="icon-btn edit" onclick={() => openEditModal(user)} title="Edit">
                  <Edit2 size={16} />
                </button>
                {#if user.email !== 'admin@example.com'}
                  <button class="icon-btn delete" onclick={() => deleteUser(user.id)} title="Delete">
                    <Trash2 size={16} />
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showModal}
  <div class="modal-backdrop" onclick={() => showModal = false} role="button" tabindex="0" onkeydown={(e) => e.key === 'Escape' && (showModal = false)}>
    <div class="modal glass-panel" onclick={(e) => e.stopPropagation()} role="document" tabindex="0" onkeydown={(e) => {}}>
      <div class="modal-header">
        <h3>{editingUser ? 'Edit User' : 'Create New User'}</h3>
        <button class="icon-btn" onclick={() => showModal = false}><X size={20} /></button>
      </div>
      
      <div class="modal-body">
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
            <option value="admin">Admin (Full Access)</option>
            <option value="user">User (View/Share)</option>
            <option value="viewer">Viewer (Read Only)</option>
          </select>
        </div>

        {#if formRole !== 'admin'}
          <div class="form-group">
            <label>Folder Scopes (Comma-separated paths)</label>
            <p class="help-text">E.g. "family_photos, vacations/2023"</p>
            <input type="text" bind:value={formFolders} placeholder="family_photos, vacations" />
          </div>
        {/if}
        
        <div class="modal-actions">
          <button class="btn secondary" onclick={() => showModal = false}>Cancel</button>
          <button class="btn primary" onclick={saveUser}>
            <Check size={18} /> Save User
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

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

  .modal-backdrop {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    width: 100%;
    max-width: 500px;
    background: #18181b;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.5);
  }

  .modal-header {
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.25rem;
  }

  .modal-body {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
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
</style>
