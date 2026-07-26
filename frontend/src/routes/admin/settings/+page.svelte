<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { ChevronLeft, Settings, Cpu, HardDrive, ShieldCheck, Save, Clock } from '@lucide/svelte';

  let settings = $state<any>({
    throttleAuth: 0,
    throttlePublic: 0,
    rateLimitApi: 100
  });

  let loading = $state(true);
  let saving = $state(false);

  async function loadSettings() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        settings = data;
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadSettings();
  });

  async function saveSettings() {
    saving = true;
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          throttleAuth: Number(settings.throttleAuth),
          throttlePublic: Number(settings.throttlePublic),
          rateLimitApi: Number(settings.rateLimitApi)
        })
      });
      if (res.ok) {
        alert('Settings saved successfully!');
      } else {
        alert('Failed to save settings.');
      }
    } finally {
      saving = false;
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
        <h2>Global Settings</h2>
      <p>Configure hardware constraints, ML thresholds, and bandwidth throttling.</p>
    </div>
    </div>
    <button class="btn primary" onclick={saveSettings} disabled={saving}>
      {#if saving}
        Saving...
      {:else}
        <Save size={18} /> Save Changes
      {/if}
    </button>
  </div>

  {#if loading}
    <div class="spinner"></div>
  {:else}
    <div class="settings-grid">
      <!-- Bandwidth Throttling -->
      <div class="card">
        <div class="card-header">
          <HardDrive size={20} class="text-emerald" />
          <h3>Bandwidth & Server Limits</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>Authenticated Users Limit (Mbps)</label>
            <p class="help">Limit streaming and downloading for logged in users (0 = Unlimited).</p>
            <input type="number" bind:value={settings.throttleAuth} step="1" min="0" />
          </div>
          
          <div class="form-group">
            <label>Public Share Links Limit (Mbps)</label>
            <p class="help">Prevent anonymous users from exhausting your bandwidth.</p>
            <input type="number" bind:value={settings.throttlePublic} step="1" min="0" />
            <div class="preset-btns">
              <button class="btn sm secondary" onclick={() => settings.throttlePublic = 5}>5 Mbps</button>
              <button class="btn sm secondary" onclick={() => settings.throttlePublic = 15}>15 Mbps</button>
            </div>
          </div>
          
          <div class="form-group">
            <label>API Rate Limiting (Requests / minute)</label>
            <p class="help">Limit max API requests from a single IP to prevent scraping and abuse. (0 = Unlimited)</p>
            <input type="number" bind:value={settings.rateLimitApi} min="0" step="10" />
            <div class="preset-btns">
              <button class="btn sm secondary" onclick={() => settings.rateLimitApi = 60}>60 / min</button>
              <button class="btn sm secondary" onclick={() => settings.rateLimitApi = 300}>300 / min</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .admin-container { width: 100%; color: #f4f4f5; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 2rem; }
  h2 { font-size: 2rem; margin: 0 0 0.5rem 0; }
  p { color: #a1a1aa; margin: 0; }

  .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }

  .card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
  }
  .card-header {
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .card-header h3 { margin: 0; font-size: 1.2rem; }
  .text-blue { color: #3b82f6; }
  .text-purple { color: #a855f7; }
  .text-emerald { color: #10b981; }

  .card-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }

  .form-group label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.95rem; }
  .help { color: #71717a; font-size: 0.8rem; margin: 0 0 0.5rem 0; }
  
  input[type="number"] {
    width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
    padding: 0.75rem; border-radius: 6px; color: white; font-family: inherit;
  }
  input[type="number"]:focus { outline: none; border-color: #a855f7; }

  .slider-group { display: flex; align-items: center; gap: 1rem; }
  input[type="range"] { flex: 1; cursor: pointer; accent-color: #a855f7; }
  .slider-val { background: rgba(168,85,247,0.2); color: #d8b4fe; padding: 0.25rem 0.5rem; border-radius: 4px; font-family: monospace; font-size: 0.9rem; }

  .preset-btns { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  
  .btn {
    display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem;
    border-radius: 8px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;
  }
  .btn.primary { background: linear-gradient(135deg, #6366f1, #a855f7); color: white; }
  .btn.secondary { background: rgba(255,255,255,0.1); color: white; }
  .btn.sm { padding: 0.4rem 0.75rem; font-size: 0.8rem; }
  .btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .spinner {
    border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #a855f7;
    border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 4rem auto;
  }
  @keyframes spin { 100% { transform: rotate(360deg); } }
</style>
