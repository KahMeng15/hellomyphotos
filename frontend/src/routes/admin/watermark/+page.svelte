<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { Check, ShieldAlert } from '@lucide/svelte';

  let settings = {
    watermarkText: 'hellomyphotos',
    watermarkOpacity: 0.5,
    watermarkPosition: 'center',
    watermarkEnforceGlobal: false
  };

  let isLoading = true;
  let isSaving = false;
  let showSuccess = false;

  async function fetchSettings() {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        settings = { ...settings, ...data };
      }
    } catch (e) {
      console.error(e);
    } finally {
      isLoading = false;
    }
  }

  async function saveSettings() {
    isSaving = true;
    showSuccess = false;
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          watermarkText: settings.watermarkText,
          watermarkOpacity: parseFloat(settings.watermarkOpacity.toString()),
          watermarkPosition: settings.watermarkPosition,
          watermarkEnforceGlobal: settings.watermarkEnforceGlobal
        })
      });
      showSuccess = true;
      setTimeout(() => showSuccess = false, 3000);
    } catch (e) {
      console.error(e);
    } finally {
      isSaving = false;
    }
  }

  onMount(() => {
    fetchSettings();
  });
</script>

<div class="admin-container">
  <div class="header">
    <h2>Watermarking & Enforcement</h2>
    <p>Configure global watermark templates and enforcement rules for public shares.</p>
  </div>

  {#if isLoading}
    <p>Loading settings...</p>
  {:else}
    <div class="card">
      <div class="card-header">
        <ShieldAlert size={20} color="#38bdf8" />
        <h3 style="margin:0; color:#f4f4f5; font-size:1.1rem;">Enforcement</h3>
      </div>
      <div class="card-body">
        <label class="toggle-label" style="flex-direction: row; align-items: center; justify-content: space-between; font-size: 1rem;">
          <div>
            <strong>Enforce Globally on All Shares</strong>
            <p style="margin: 4px 0 0; font-size: 0.85rem; color: #94a3b8; font-weight: normal;">When enabled, watermarks will be permanently stamped on all downloaded and viewed public images, ignoring individual user share settings.</p>
          </div>
          <label class="switch">
            <input type="checkbox" bind:checked={settings.watermarkEnforceGlobal} />
            <span class="slider round"></span>
          </label>
        </label>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 style="margin:0; color:#f4f4f5; font-size:1.1rem;">Template Settings</h3>
      </div>
      <div class="card-body">
        <div class="form-group">
          <label>Watermark Text</label>
          <input type="text" bind:value={settings.watermarkText} placeholder="e.g. Copyright 2026" />
        </div>
        
        <div class="form-group">
          <label>Opacity ({Math.round(settings.watermarkOpacity * 100)}%)</label>
          <input type="range" bind:value={settings.watermarkOpacity} min="0.1" max="1.0" step="0.1" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Position</label>
          <select bind:value={settings.watermarkPosition}>
            <option value="center">Center</option>
            <option value="bottom-right">Bottom Right</option>
            <option value="top-left">Top Left</option>
            <option value="tiled">Tiled (Diagonal)</option>
          </select>
        </div>
      </div>
    </div>

    <button class="btn primary" onclick={saveSettings} disabled={isSaving}>
      {#if isSaving}
        Saving...
      {:else}
        <Check size={18} /> Save Settings
      {/if}
    </button>
    
    {#if showSuccess}
      <div class="success-box">
        Settings saved successfully!
      </div>
    {/if}
  {/if}
</div>

<style>
  .admin-container {
    width: 100%;
    color: #f4f4f5;
  }
  
  .header {
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
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 12px;
    margin-bottom: 24px;
    overflow: hidden;
  }

  .card-header {
    padding: 16px 24px;
    background: rgba(0,0,0,0.2);
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .card-body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  label {
    font-size: 0.875rem;
    color: #cbd5e1;
    font-weight: 500;
  }

  input[type="text"], select {
    background: rgba(0,0,0,0.2);
    border: 1px solid var(--glass-border);
    color: white;
    padding: 10px 14px;
    border-radius: 6px;
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
  }

  input[type="text"]:focus, select:focus {
    border-color: #3b82f6;
  }

  /* Toggle Switch */
  .switch {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 24px;
    flex-shrink: 0;
  }

  .switch input { 
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255,255,255,0.1);
    transition: .4s;
    border-radius: 24px;
    border: 1px solid var(--glass-border);
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 2px;
    background-color: white;
    transition: .4s;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: #3b82f6;
    border-color: #3b82f6;
  }

  input:checked + .slider:before {
    transform: translateX(24px);
  }

  .btn.primary {
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: opacity 0.2s;
  }

  .btn.primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .success-box {
    margin-top: 16px;
    padding: 12px;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 6px;
    color: #34d399;
  }
</style>
