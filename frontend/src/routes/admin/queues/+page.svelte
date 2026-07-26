<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { ChevronLeft, Activity, Play, Pause, Trash2, Cpu, ShieldCheck, Save } from '@lucide/svelte';

  let queues = $state<any>({});
  let settings = $state<any>({
    maxCpuCores: 2,
    scanInterval: 3600000,
    mlConfidenceThreshold: 0.6
  });
  let saving = $state(false);
  let loading = $state(true);
  let pollInterval: any;

  async function loadData() {
    try {
      const [qRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/queues`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/admin/settings`, { credentials: 'include' })
      ]);
      if (qRes.ok) {
        const data = await qRes.json();
        queues = data.queues;
      }
      if (sRes.ok) {
        const data = await sRes.json();
        settings.maxCpuCores = data.maxCpuCores;
        settings.scanInterval = data.scanInterval;
        settings.mlConfidenceThreshold = data.mlConfidenceThreshold;
      }
    } finally {
      loading = false;
    }
  }

  async function loadQueuesOnly() {
    const res = await fetch(`${API_BASE}/api/admin/queues`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      queues = data.queues;
    }
  }

  async function saveSettings() {
    saving = true;
    try {
      await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          maxCpuCores: Number(settings.maxCpuCores),
          scanInterval: Number(settings.scanInterval),
          mlConfidenceThreshold: Number(settings.mlConfidenceThreshold)
        })
      });
      alert('Processing settings saved!');
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    loadData();
    pollInterval = setInterval(loadQueuesOnly, 2000); // Poll every 2 seconds
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  async function actionQueue(name: string, action: string) {
    const res = await fetch(`${API_BASE}/api/admin/queues/${name}/${action}`, { 
      method: 'POST', 
      credentials: 'include' 
    });
    if (res.ok) await loadQueuesOnly();
  }
  
  async function cleanQueue(name: string, type: string) {
    const res = await fetch(`${API_BASE}/api/admin/queues/${name}/clean`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type })
    });
    if (res.ok) await loadQueuesOnly();
  }

  async function triggerRescan() {
    await fetch(`${API_BASE}/api/admin/rescan`, { method: 'POST', credentials: 'include' });
    alert('Background file rescan initiated!');
  }

  async function triggerRescanFaces() {
    if (confirm('Are you sure you want to completely wipe and re-calculate all facial recognition data? This will take a while.')) {
      await fetch(`${API_BASE}/api/admin/rescan-faces`, { method: 'POST', credentials: 'include' });
      alert('Background face re-detection initiated!');
    }
  }

  async function triggerRescanExif() {
    await fetch(`${API_BASE}/api/admin/rescan-exif`, { method: 'POST', credentials: 'include' });
    alert('Background EXIF reprocessing initiated!');
  }

  const queueNames = ['scanner', 'media', 'ml'];
  const queueTitles: Record<string, string> = {
    scanner: '1. Indexing & Discovery (Scanner)',
    media: '2. Thumbnails & Transcoding (Media)',
    ml: '3. Facial & Object Recognition (ML)'
  };
</script>

<div class="admin-container">
  <div class="header">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a href="/admin" title="Back to Admin Dashboard" style="display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; color: rgba(255,255,255,0.4); text-decoration: none; transition: color 0.2s, transform 0.2s;" onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }} onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}>
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>Processing & Job Queues</h2>
      <p>Configure processing constraints and monitor background workers.</p>
    </div>
    </div>
    <div style="display: flex; gap: 1rem; align-items: center;">
      <div class="status-indicator" class:pulse={!loading}>
        <Activity size={16} /> Live
      </div>
      <button class="btn primary" onclick={saveSettings} disabled={saving}>
        {#if saving}Saving...{:else}<Save size={16}/> Save Settings{/if}
      </button>
    </div>
  </div>

  <div class="pipeline">
    <!-- Configuration section -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
      <div class="card">
        <h3 style="margin: 0 0 1rem 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;"><Cpu size={18} color="#3b82f6"/> Hardware & Scans</h3>
        <div class="form-group" style="margin-bottom: 1rem;">
          <label style="display: block; font-size: 0.9rem; margin-bottom: 0.25rem;">Max CPU Cores (Concurrency)</label>
          <input type="number" bind:value={settings.maxCpuCores} min="1" max="32" style="width: 100%; padding: 0.5rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;" />
        </div>
        <div class="form-group">
          <label style="display: block; font-size: 0.9rem; margin-bottom: 0.25rem;">Auto-Scan Interval (ms)</label>
          <input type="number" bind:value={settings.scanInterval} step="1000" style="width: 100%; padding: 0.5rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;" />
        </div>
      </div>

      <div class="card">
        <h3 style="margin: 0 0 1rem 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;"><ShieldCheck size={18} color="#a855f7"/> Machine Learning</h3>
        <div class="form-group">
          <label style="display: block; font-size: 0.9rem; margin-bottom: 0.25rem;">Facial Recognition Confidence Threshold</label>
          <p style="font-size: 0.8rem; color: #a1a1aa; margin: 0 0 0.5rem 0;">Higher means fewer false positives. (0.0 to 1.0)</p>
          <div style="display: flex; gap: 1rem; align-items: center;">
            <input type="range" bind:value={settings.mlConfidenceThreshold} min="0.1" max="0.99" step="0.01" style="flex: 1;" />
            <span style="font-family: monospace; background: rgba(168,85,247,0.2); padding: 0.25rem; border-radius: 4px;">{settings.mlConfidenceThreshold}</span>
          </div>
        </div>
      </div>
    </div>
    {#each queueNames as name}
      {#if queues[name]}
        {@const q = queues[name]}
        {@const counts = q.counts}
        {@const total = counts.waiting + counts.active + counts.completed + counts.failed}
        {@const progress = total > 0 ? ((counts.completed + counts.failed) / total) * 100 : 0}
        
        <div class="card queue-card">
          <div class="q-header">
            <h3>{queueTitles[name]}</h3>
            <div class="q-actions">
              {#if q.isPaused}
                <button class="btn success sm" onclick={() => actionQueue(name, 'resume')}><Play size={14}/> Resume</button>
              {:else}
                <button class="btn warning sm" onclick={() => actionQueue(name, 'pause')}><Pause size={14}/> Pause</button>
              {/if}
              <button class="btn danger sm" onclick={() => cleanQueue(name, 'failed')} title="Clear Failed"><Trash2 size={14}/></button>
            </div>
          </div>
          
          <div class="progress-container">
            <div class="progress-bar" style="width: {progress}%"></div>
          </div>
          
          <div class="q-stats">
            <div class="stat"><span class="dot active"></span> Active: {counts.active}</div>
            <div class="stat"><span class="dot waiting"></span> Waiting: {counts.waiting}</div>
            <div class="stat"><span class="dot completed"></span> Completed: {counts.completed}</div>
            <div class="stat"><span class="dot failed"></span> Failed: {counts.failed}</div>
          </div>
        </div>
      {/if}
    {/each}

    <!-- Advanced System Operations -->
    <div class="card" style="margin-top: 1rem;">
      <h3 style="margin: 0 0 1rem 0; font-size: 1.25rem; color: #e4e4e7;">Advanced System Operations</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
        <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
          <p style="font-size: 0.85rem; color: #a1a1aa; margin-bottom: 0.75rem;">Manually trigger a full background scan of the media directory to find new or deleted files.</p>
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerRescan}>Force Rescan Files</button>
        </div>

        <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
          <p style="font-size: 0.85rem; color: #a1a1aa; margin-bottom: 0.75rem;">Re-process EXIF metadata for all existing images (Useful for backfilling data after updates).</p>
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerRescanExif}>Force Rescan EXIF Data</button>
        </div>

        <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
          <p style="font-size: 0.85rem; color: #a1a1aa; margin-bottom: 0.75rem;">Wipe out all existing face clusters and re-run ML detection on every single image.</p>
          <button class="btn danger" style="width: 100%; justify-content: center;" onclick={triggerRescanFaces}>Force Rescan Faces (Reset)</button>
        </div>
      </div>
    </div>
  </div>
</div>

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

  h2 { font-size: 2rem; margin: 0 0 0.5rem 0; }
  p { color: #a1a1aa; margin: 0; }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #10b981;
    background: rgba(16, 185, 129, 0.1);
    padding: 0.5rem 1rem;
    border-radius: 9999px;
    border: 1px solid rgba(16, 185, 129, 0.2);
  }
  .pulse { animation: pulse 2s infinite; }
  @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }

  .pipeline {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }

  .q-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }
  .q-header h3 { margin: 0; font-size: 1.25rem; color: #e4e4e7; }
  
  .q-actions { display: flex; gap: 0.5rem; }

  .progress-container {
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 1.5rem;
  }
  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #6366f1, #a855f7);
    transition: width 0.3s ease;
  }

  .q-stats {
    display: flex;
    gap: 2rem;
    font-size: 0.85rem;
  }
  .stat {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #a1a1aa;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot.active { background: #3b82f6; }
  .dot.waiting { background: #f59e0b; }
  .dot.completed { background: #10b981; }
  .dot.failed { background: #ef4444; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
  }
  .btn.sm { font-size: 0.75rem; padding: 0.4rem 0.8rem; }
  .btn.success { background: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
  .btn.warning { background: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
  .btn.danger { background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
  .btn:hover { filter: brightness(1.2); }
</style>
