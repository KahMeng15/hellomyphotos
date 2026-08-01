<script lang="ts">
  import { onMount } from 'svelte';
  import { currentUser, loadAuthUser } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { API_BASE } from '$lib/api/media';
  import { User, Mail, Shield, Lock, Save, KeyRound, Server } from '@lucide/svelte';

  let name = $state('');
  let email = $state('');
  let role = $state('');
  let folders = $state<string[]>([]);

  let profilePassword = $state('');

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');

  let savingProfile = $state(false);
  let savingPassword = $state(false);

  onMount(async () => {
    // Reload user data to ensure freshness
    const user = await loadAuthUser();
    if (user) {
      name = user.name || '';
      email = user.email || '';
      role = user.role || '';
      folders = user.folders || [];
    }
  });

  async function handleProfileSave(e: Event) {
    e.preventDefault();
    savingProfile = true;
    try {
      const res = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, currentPassword: profilePassword }),
        credentials: 'include'
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');
      
      toast.success('Profile updated successfully');
      profilePassword = '';
      await loadAuthUser(); // reload the store
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      savingProfile = false;
    }
  }

  async function handlePasswordSave(e: Event) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    
    savingPassword = true;
    try {
      const res = await fetch(`${API_BASE}/api/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
        credentials: 'include'
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      
      toast.success('Password changed successfully');
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      savingPassword = false;
    }
  }
</script>

<div class="settings-container">
  <div class="header">
    <h2>Account Settings</h2>
    <p>Manage your profile, security, and access level.</p>
  </div>

  {#if $currentUser?.mustChangeCredentials}
    <div class="mandatory-banner">
      <Shield size={24} class="banner-icon" />
      <div class="banner-text">
        <h3>Action Required: Default Credentials Detected</h3>
        <p>You must change your default email (admin@example.com) and set a new password before you can use the rest of the app.</p>
      </div>
    </div>
  {/if}

  <div class="grid">
    <!-- Profile & Access -->
    <div class="column">
      <div class="card glass-panel">
        <div class="card-header">
          <User size={20} class="text-blue" />
          <h3>Profile Info</h3>
        </div>
        <form onsubmit={handleProfileSave} class="form">
          <div class="form-group">
            <label for="name">Full Name</label>
            <div class="input-wrap">
              <User size={16} class="input-icon" />
              <input type="text" id="name" bind:value={name} required placeholder="John Doe" />
            </div>
          </div>
          <div class="form-group">
            <label for="email">Email Address</label>
            <div class="input-wrap">
              <Mail size={16} class="input-icon" />
              <input type="email" id="email" bind:value={email} required placeholder="john@example.com" />
            </div>
          </div>
          <div class="form-divider"></div>
          <div class="form-group">
            <label for="profilePassword">Verify Current Password</label>
            <div class="input-wrap">
              <Lock size={16} class="input-icon" />
              <input type="password" id="profilePassword" bind:value={profilePassword} required placeholder="••••••••" />
            </div>
          </div>
          <button type="submit" class="btn primary-btn" disabled={savingProfile}>
            {#if savingProfile}<span class="spinner-sm"></span>{/if}
            <Save size={16} /> Save Changes
          </button>
        </form>
      </div>

      <div class="card glass-panel access-card">
        <div class="card-header">
          <Shield size={20} class="text-purple" />
          <h3>Access & Scope</h3>
        </div>
        <div class="info-row folders-row">
          <span class="label">Role</span>
          <span class="badge {role === 'admin' || role === 'super_admin' ? 'badge-admin' : 'badge-user'}">
            {role.replace('_', ' ').toUpperCase()}
          </span>
        </div>
        <div class="info-row folders-row">
          <span class="label">Allowed Folders</span>
          <div class="folders-list">
            {#if folders.includes('*')}
              <span class="folder-badge all-access"><Server size={14} /> Full System Access</span>
            {:else if folders.length === 0}
              <span class="muted">No folder access</span>
            {:else}
              {#each folders as folder}
                <span class="folder-badge">{folder}</span>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Security -->
    <div class="column">
      <div class="card glass-panel">
        <div class="card-header">
          <KeyRound size={20} class="text-emerald" />
          <h3>Security</h3>
        </div>
        <form onsubmit={handlePasswordSave} class="form">
          <div class="form-group">
            <label for="currentPassword">Current Password</label>
            <div class="input-wrap">
              <Lock size={16} class="input-icon" />
              <input type="password" id="currentPassword" bind:value={currentPassword} required placeholder="••••••••" />
            </div>
          </div>
          <div class="form-divider"></div>
          <div class="form-group">
            <label for="newPassword">New Password</label>
            <div class="input-wrap">
              <Lock size={16} class="input-icon" />
              <input type="password" id="newPassword" bind:value={newPassword} required placeholder="••••••••" />
            </div>
          </div>
          <div class="form-group">
            <label for="confirmPassword">Confirm New Password</label>
            <div class="input-wrap">
              <Lock size={16} class="input-icon" />
              <input type="password" id="confirmPassword" bind:value={confirmPassword} required placeholder="••••••••" />
            </div>
          </div>
          <button type="submit" class="btn danger-btn" disabled={savingPassword}>
            {#if savingPassword}<span class="spinner-sm"></span>{/if}
            <KeyRound size={16} /> Update Password
          </button>
        </form>
      </div>
    </div>
  </div>
</div>

<style>
  .settings-container {
    max-width: 1000px;
    margin: 0 auto;
    padding: 2rem 1rem;
    color: #f4f4f5;
  }

  .header {
    margin-bottom: 2.5rem;
  }
  .header h2 {
    font-size: 2.25rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    letter-spacing: -0.02em;
    background: linear-gradient(to right, #fff, #a1a1aa);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .header p {
    color: #a1a1aa;
    margin: 0;
    font-size: 1.1rem;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
  }
  @media (min-width: 768px) {
    .grid { grid-template-columns: 1fr 1fr; }
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .card {
    padding: 2rem;
    border-radius: 16px;
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 1rem;
  }
  .card-header h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .text-blue { color: #3b82f6; }
  .text-purple { color: #a855f7; }
  .text-emerald { color: #10b981; }

  .form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .form-group label {
    font-size: 0.9rem;
    color: #d4d4d8;
    font-weight: 500;
  }

  .input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  :global(.input-icon) {
    position: absolute;
    left: 12px;
    color: #71717a;
  }
  .input-wrap input {
    width: 100%;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 0.75rem 1rem 0.75rem 2.5rem;
    color: #fff;
    font-family: inherit;
    font-size: 0.95rem;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .input-wrap input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }
  .input-wrap input::placeholder { color: #52525b; }

  .form-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
    margin: 0.5rem 0;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
    font-size: 0.95rem;
    margin-top: 0.5rem;
  }
  .btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
  .primary-btn {
    background: #3b82f6;
    color: white;
  }
  .primary-btn:hover:not(:disabled) { background: #2563eb; }
  
  .danger-btn {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }
  .danger-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .info-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .folders-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }
  
  .label {
    color: #a1a1aa;
    font-size: 0.95rem;
  }

  .badge {
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .badge-admin {
    background: rgba(168, 85, 247, 0.2);
    color: #d8b4fe;
    border: 1px solid rgba(168, 85, 247, 0.4);
  }
  .badge-user {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
    border: 1px solid rgba(59, 130, 246, 0.4);
  }

  .folders-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .folder-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    font-size: 0.85rem;
    color: #e4e4e7;
  }
  .folder-badge.all-access {
    background: rgba(99, 102, 241, 0.1);
    color: #818cf8;
    border-color: rgba(99, 102, 241, 0.2);
    font-weight: 500;
  }

  .mandatory-banner {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    background: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    padding: 1.5rem;
    border-radius: 12px;
    margin-bottom: 2rem;
    color: #fca5a5;
  }
  
  .mandatory-banner h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    color: #ef4444;
  }

  .mandatory-banner p {
    margin: 0;
    font-size: 0.95rem;
    opacity: 0.9;
  }

  .banner-icon {
    flex-shrink: 0;
    color: #ef4444;
  }

  @media (max-width: 768px) {
    .grid {
      grid-template-columns: 1fr;
    }
    
    .settings-container {
      padding: 1rem;
    }
  }

  .muted { color: #71717a; font-style: italic; }

  .spinner-sm {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
