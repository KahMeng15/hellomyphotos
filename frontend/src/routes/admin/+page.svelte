<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';

  let maxCpuCores = 2;
  let scanInterval = 3600000;
  let sharePath = '';
  let watermarkEnabled = false;
  let generatedToken = '';
  let saving = false;

  onMount(async () => {
    const res = await fetch(`${API_BASE}/api/admin/settings`);
    if (res.ok) {
      const data = await res.json();
      maxCpuCores = data.maxCpuCores;
      scanInterval = data.scanInterval;
    }
  });

  async function saveSettings() {
    saving = true;
    await fetch(`${API_BASE}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxCpuCores, scanInterval })
    });
    saving = false;
  }

  async function generateShare() {
    if (!sharePath) return;
    const res = await fetch(`${API_BASE}/api/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        folderPath: sharePath, 
        watermarkEnabled,
        allowDownload: false 
      })
    });
    if (res.ok) {
      const data = await res.json();
      generatedToken = data.shareToken;
    }
  }
</script>

<div class="admin-container">
  <h2>Admin Dashboard</h2>
  
  <div class="card">
    <h3>Resource Controls</h3>
    <label>
      Max Worker Concurrency (CPU Cores)
      <input type="number" bind:value={maxCpuCores} min="1" max="16" />
    </label>
    <label>
      Background Scan Interval (ms)
      <input type="number" bind:value={scanInterval} step="10000" />
    </label>
    <button class="btn" on:click={saveSettings} disabled={saving}>
      {saving ? 'Saving...' : 'Save Settings'}
    </button>
  </div>

  <div class="card">
    <h3>Generate Public Share</h3>
    <label>
      Folder Path
      <input type="text" bind:value={sharePath} placeholder="e.g. holidays/2023" />
    </label>
    <label style="flex-direction: row; align-items: center; gap: 8px;">
      <input type="checkbox" bind:value={watermarkEnabled} />
      Enable Dynamic Watermarking
    </label>
    <button class="btn" style="background: var(--accent-hover);" on:click={generateShare}>
      Generate Share Link
    </button>
    
    {#if generatedToken}
      <div class="success-box">
        Share Link: 
        <a href="/share/{generatedToken}">/share/{generatedToken}</a>
      </div>
    {/if}
  </div>
</div>

<style>
  .admin-container {
    max-width: 600px;
    margin: 0 auto;
  }

  h2 { margin-bottom: 24px; }

  .card {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    padding: 24px;
    border-radius: 12px;
    margin-bottom: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 0.875rem;
    color: #cbd5e1;
  }

  input[type="text"], input[type="number"] {
    background: rgba(0,0,0,0.2);
    border: 1px solid var(--glass-border);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-family: inherit;
  }

  .success-box {
    margin-top: 16px;
    padding: 12px;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 6px;
    color: #34d399;
  }
  
  .success-box a {
    color: #6ee7b7;
  }
</style>
