<script lang="ts">
  import { API_BASE } from '$lib/api/media';
  import { toast } from '$lib/stores/toast';
  import { loadAuthUser } from '$lib/stores/auth';
  import { User, Mail, Lock, Shield } from '@lucide/svelte';

  let name = $state('');
  let email = $state('');
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let isSubmitting = $state(false);

  async function handleSetup(e: Event) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    
    isSubmitting = true;
    try {
      // 1. Update Profile
      const profileRes = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, currentPassword }),
        credentials: 'include'
      });
      const profileData = await profileRes.json();
      if (!profileRes.ok) throw new Error(profileData.error || 'Failed to update profile');

      // 2. Update Password
      const passRes = await fetch(`${API_BASE}/api/auth/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
        credentials: 'include'
      });
      const passData = await passRes.json();
      if (!passRes.ok) throw new Error(passData.error || 'Failed to update password');

      toast.success('Setup complete! Welcome to hellomyphotos.');
      await loadAuthUser();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="setup-overlay">
  <div class="setup-modal">
    <div class="modal-header">
      <Shield size={32} class="shield-icon" />
      <h2>Welcome to hellomyphotos</h2>
      <p>Please secure your account by changing the default credentials before continuing.</p>
    </div>
    
    <form onsubmit={handleSetup} class="form">
      <div class="form-group">
        <label for="setup-name"><User size={16} class="label-icon" /> Name</label>
        <input type="text" id="setup-name" bind:value={name} required placeholder="Your Name" />
      </div>
      
      <div class="form-group">
        <label for="setup-email"><Mail size={16} class="label-icon" /> New Email Address</label>
        <input type="email" id="setup-email" bind:value={email} required placeholder="you@example.com" />
      </div>
      
      <div class="form-group">
        <label for="setup-current-password"><Lock size={16} class="label-icon" /> Current Password <span class="muted">(default is 'admin')</span></label>
        <input type="password" id="setup-current-password" bind:value={currentPassword} required placeholder="••••••••" />
      </div>
      
      <div class="form-divider"></div>
      
      <div class="form-group">
        <label for="setup-new-password"><Lock size={16} class="label-icon" /> New Password</label>
        <input type="password" id="setup-new-password" bind:value={newPassword} required placeholder="••••••••" minlength="6" />
      </div>
      
      <div class="form-group">
        <label for="setup-confirm-password"><Lock size={16} class="label-icon" /> Confirm New Password</label>
        <input type="password" id="setup-confirm-password" bind:value={confirmPassword} required placeholder="••••••••" minlength="6" />
      </div>
      
      <button type="submit" class="btn primary-btn" disabled={isSubmitting}>
        {#if isSubmitting}<span class="spinner-sm"></span>{/if}
        Complete Setup
      </button>
    </form>
  </div>
</div>

<style>
  .setup-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(9, 9, 11, 0.9);
    backdrop-filter: blur(10px);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  
  .setup-modal {
    background: #18181b;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    width: 100%;
    max-width: 480px;
    padding: 2rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin-bottom: 2rem;
  }
  
  .shield-icon {
    color: #3b82f6;
    margin-bottom: 1rem;
  }
  
  .modal-header h2 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
    color: #f4f4f5;
  }
  
  .modal-header p {
    margin: 0;
    color: #a1a1aa;
    font-size: 0.95rem;
    line-height: 1.5;
  }

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
  
  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    font-weight: 500;
    color: #e4e4e7;
  }
  
  .label-icon {
    color: #a1a1aa;
  }
  
  .muted {
    color: #71717a;
    font-style: italic;
    font-weight: normal;
    margin-left: 0.25rem;
  }
  
  input {
    width: 100%;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: #f4f4f5;
    font-family: inherit;
    font-size: 0.95rem;
    transition: all 0.2s;
  }
  
  input:focus {
    outline: none;
    border-color: #3b82f6;
    background: rgba(0, 0, 0, 0.4);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }
  
  .form-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 0.5rem 0;
  }
  
  .primary-btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-weight: 500;
    font-size: 1rem;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  
  .primary-btn:hover:not(:disabled) {
    background: #2563eb;
  }
  
  .primary-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
  
  .spinner-sm {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
