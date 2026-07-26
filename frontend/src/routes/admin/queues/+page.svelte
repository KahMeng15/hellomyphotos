<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { ChevronLeft, Activity, Play, Pause, Square, Trash2, Cpu, ShieldCheck, Save, Check } from '@lucide/svelte';
  import Modal from '$lib/components/Modal.svelte';

  let queues = $state<any>({});
  let settings = $state<any>({
    maxCpuCores: 2,
    scanInterval: 3600000,
    mlConfidenceThreshold: 0.6
  });
  let saving = $state(false);
  let loading = $state(true);
  let pollInterval: any;

  let alertModal = $state(false);
  let alertTitle = $state('');
  let alertMessage = $state('');

  function customAlert(title: string, message: string) {
    alertTitle = title;
    alertMessage = message;
    alertModal = true;
  }

  let confirmModal = $state(false);
  let confirmTitle = $state('');
  let confirmMessage = $state('');
  let confirmDanger = $state(false);
  let confirmAction: (() => void) | null = $state(null);

  function customConfirm(title: string, message: string, danger: boolean, action: () => void) {
    confirmTitle = title;
    confirmMessage = message;
    confirmDanger = danger;
    confirmAction = action;
    confirmModal = true;
  }

  function executeConfirm() {
    confirmModal = false;
    if (confirmAction) confirmAction();
  }

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
      customAlert('Success', 'Processing settings saved!');
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
  
  async function stopQueue(name: string) {
    customConfirm('Stop Queue', `Are you sure you want to stop and cancel all pending jobs in the ${name} queue?`, true, async () => {
      const res = await fetch(`${API_BASE}/api/admin/queues/${name}/stop`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      if (res.ok) await loadQueuesOnly();
    });
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

  async function triggerResetIndex() {
    customConfirm('Reset Index', 'Are you sure you want to wipe the database index and all caches? This will rescan all files from scratch.', true, async () => {
      await fetch(`${API_BASE}/api/admin/reset-index`, { method: 'POST', credentials: 'include' });
      customAlert('Success', 'Index reset and background rescan initiated!');
    });
  }

  async function triggerResetExif() {
    customConfirm('Reset EXIF & Thumbnails', 'Are you sure you want to flush all EXIF data and thumbnails? They will be re-generated.', true, async () => {
      await fetch(`${API_BASE}/api/admin/reset-exif`, { method: 'POST', credentials: 'include' });
      customAlert('Success', 'EXIF data reset and reprocessing initiated!');
    });
  }

  async function triggerResetFaces() {
    customConfirm('Reset Faces', 'Are you sure you want to completely wipe all facial recognition data? They will be re-detected.', true, async () => {
      await fetch(`${API_BASE}/api/admin/reset-faces`, { method: 'POST', credentials: 'include' });
      customAlert('Success', 'Face data reset and re-detection initiated!');
    });
  }

  async function triggerNuke() {
    customConfirm('System Reset & Full Rescan', 'Are you sure you want to completely wipe the index, EXIF data, and facial recognition data, and rescan everything from scratch? This is a destructive operation and will take a significant amount of time.', true, async () => {
      await fetch(`${API_BASE}/api/admin/reset-faces`, { method: 'POST', credentials: 'include' });
      await fetch(`${API_BASE}/api/admin/reset-exif`, { method: 'POST', credentials: 'include' });
      await fetch(`${API_BASE}/api/admin/reset-index`, { method: 'POST', credentials: 'include' });
      customAlert('Success', 'Full system reset and background rescan initiated!');
    });
  }

  const queueNames = ['scanner', 'media', 'ml'];
  const queueTitles: Record<string, string> = {
    scanner: '1. Indexing & Discovery (Scanner)',
    media: '2. Thumbnails & Transcoding (Media)',
    ml: '3. Facial & Object Recognition (ML)'
  };

  async function triggerJob(name: string) {
    await actionQueue(name, 'resume');
    if (name === 'scanner') {
      await fetch(`${API_BASE}/api/admin/rescan`, { method: 'POST', credentials: 'include' });
    } else if (name === 'media') {
      await fetch(`${API_BASE}/api/admin/rescan-exif`, { method: 'POST', credentials: 'include' });
    } else if (name === 'ml') {
      customConfirm('Rescan Faces', 'Are you sure you want to completely wipe and re-calculate all facial recognition data? This will take a while.', true, async () => {
        await fetch(`${API_BASE}/api/admin/rescan-faces`, { method: 'POST', credentials: 'include' });
      });
    }
  }

  async function runAllJobs() {
    for (const name of queueNames) {
      await fetch(`${API_BASE}/api/admin/queues/${name}/resume`, { method: 'POST', credentials: 'include' });
    }
    await fetch(`${API_BASE}/api/admin/rescan`, { method: 'POST', credentials: 'include' });
    await fetch(`${API_BASE}/api/admin/rescan-exif`, { method: 'POST', credentials: 'include' });
    
    customConfirm('Rescan Faces', 'Are you sure you want to completely wipe and re-calculate all facial recognition data? This will take a while.', true, async () => {
      await fetch(`${API_BASE}/api/admin/rescan-faces`, { method: 'POST', credentials: 'include' });
    });
    
    await loadQueuesOnly();
  }

  async function stopAllJobs() {
    customConfirm('Stop All Jobs', 'Are you sure you want to stop and cancel all pending jobs across all queues?', true, async () => {
      for (const name of queueNames) {
        await fetch(`${API_BASE}/api/admin/queues/${name}/stop`, { method: 'POST', credentials: 'include' });
      }
      await loadQueuesOnly();
    });
  }

  async function pauseAllJobs() {
    for (const name of queueNames) {
      await fetch(`${API_BASE}/api/admin/queues/${name}/pause`, { method: 'POST', credentials: 'include' });
    }
    await loadQueuesOnly();
  }
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
    <button class="btn primary" onclick={saveSettings} disabled={saving}>
      {#if saving}
        Saving...
      {:else}
        <Save size={18} /> Save Changes
      {/if}
    </button>
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
    <div style="margin-top: 1.5rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h3 style="margin: 0; font-size: 1.25rem; color: #e4e4e7;">Background Jobs</h3>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn success sm" onclick={runAllJobs}><Play size={14}/> Start All</button>
          <button class="btn warning sm" onclick={pauseAllJobs}><Pause size={14}/> Pause All</button>
          <button class="btn danger sm" onclick={stopAllJobs}><Square size={14}/> Stop All</button>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        {#each queueNames as name}
          {#if queues[name]}
            {@const q = queues[name]}
            {@const counts = q.counts}
            {@const total = counts.waiting + counts.active + counts.completed + counts.failed}
            {@const pCompleted = total > 0 ? (counts.completed / total) * 100 : 0}
            {@const pActive = total > 0 ? (counts.active / total) * 100 : 0}
            {@const pWaiting = total > 0 ? (counts.waiting / total) * 100 : 0}
            {@const pFailed = total > 0 ? (counts.failed / total) * 100 : 0}
            {@const isRunning = counts.active > 0 || counts.waiting > 0}
            
            <div class="card queue-card" style="margin: 0;">
              <div class="q-header">
                <h3>{queueTitles[name]}</h3>
                <div class="q-actions">
                  <button class="btn success sm" disabled={isRunning} style={isRunning ? 'opacity: 0.5; cursor: not-allowed;' : ''} onclick={() => triggerJob(name)} title="Force Run All"><Play size={14}/> Start</button>
                  
                  {#if !isRunning || q.isPaused}
                    <button class="btn warning sm" disabled style="opacity: 0.5; cursor: not-allowed;"><Pause size={14}/> Pause</button>
                  {:else}
                    <button class="btn warning sm" onclick={() => actionQueue(name, 'pause')}><Pause size={14}/> Pause</button>
                  {/if}

                  <button class="btn danger sm" disabled={!isRunning} style={!isRunning ? 'opacity: 0.5; cursor: not-allowed;' : ''} onclick={() => stopQueue(name)} title="Stop & Cancel Pending"><Square size={14}/> Stop</button>
                  <button class="btn secondary sm" onclick={() => cleanQueue(name, 'failed')} title="Clear Failed"><Trash2 size={14}/></button>
                </div>
              </div>
              
              <div class="progress-container" style="display: flex;">
                {#if pCompleted > 0}<div class="progress-bar completed" style="width: {pCompleted}%; background: #10b981;" title="Completed"></div>{/if}
                {#if pActive > 0}<div class="progress-bar active" style="width: {pActive}%; background: #3b82f6;" title="Active"></div>{/if}
                {#if pWaiting > 0}<div class="progress-bar waiting" style="width: {pWaiting}%; background: #f59e0b;" title="Waiting"></div>{/if}
                {#if pFailed > 0}<div class="progress-bar failed" style="width: {pFailed}%; background: #ef4444;" title="Failed"></div>{/if}
              </div>
              
              <div class="q-stats">
                <div class="stat"><span class="dot active"></span> Active: {counts.active}</div>
                <div class="stat"><span class="dot waiting"></span> Waiting: {counts.waiting}</div>
                <div class="stat"><span class="dot completed"></span> Completed: {counts.completed}</div>
                <div class="stat"><span class="dot failed"></span> Failed: {counts.failed}</div>
              </div>

              {#if q.activeJobs && q.activeJobs.length > 0}
                <div style="margin-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem;">
                  <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: #a1a1aa;">Currently Processing:</h4>
                  <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                    {#each q.activeJobs as job}
                      <div style="font-size: 0.8rem; background: rgba(255,255,255,0.05); padding: 0.25rem 0.5rem; border-radius: 4px; display: flex; align-items: center; gap: 0.5rem; word-break: break-all;">
                        {job.target || 'Processing...'}
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>

    <!-- Advanced System Operations -->
    <div class="card" style="margin-top: 1rem;">
      <h3 style="margin: 0 0 1rem 0; font-size: 1.25rem; color: #e4e4e7;">Advanced System Operations</h3>
      <div style="background: rgba(239, 68, 68, 0.05); padding: 1.5rem; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.2);">
        <h4 style="margin: 0 0 0.5rem 0; color: #f87171;">System Reset & Full Rescan</h4>
        <p style="font-size: 0.9rem; color: #a1a1aa; margin-bottom: 1rem;">
          This action will completely wipe the file index, EXIF metadata, and all facial/object recognition data. 
          It will then trigger a full background rescan of your media directory from scratch. This operation is destructive and cannot be undone.
        </p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid rgba(239, 68, 68, 0.2);">
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerResetIndex}>
            <Activity size={16}/> Reset Index
          </button>
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerResetExif}>
            <Save size={16}/> Reset EXIF Data
          </button>
          <button class="btn warning" style="width: 100%; justify-content: center;" onclick={triggerResetFaces}>
            <Cpu size={16}/> Reset ML Data
          </button>
        </div>
        
        <button class="btn danger" style="width: 100%; justify-content: center; padding: 0.75rem; font-size: 1rem;" onclick={triggerNuke}>
          <Trash2 size={18}/> Reset & Rescan Everything
        </button>
      </div>
    </div>
  </div>
</div>

<Modal bind:show={alertModal} id="alert-modal" title={alertTitle}>
  <p style="color: #cbd5e1; margin-bottom: 0;">{alertMessage}</p>
  <div class="modal-actions" style="margin-top: 24px; display: flex; justify-content: flex-end;">
    <button class="btn primary" onclick={() => alertModal = false}>OK</button>
  </div>
</Modal>

<Modal bind:show={confirmModal} id="confirm-modal" title={confirmTitle}>
  <p style="color: #cbd5e1; margin-bottom: 0;">{confirmMessage}</p>
  <div class="modal-actions" style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 12px;">
    <button class="btn secondary" onclick={() => confirmModal = false}>Cancel</button>
    <button class="btn {confirmDanger ? 'danger' : 'primary'}" onclick={executeConfirm}>
      {#if confirmDanger}<Trash2 size={18} />{/if}
      Confirm
    </button>
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
  .btn.secondary { background: rgba(255, 255, 255, 0.05); color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); }
  .btn:hover { filter: brightness(1.2); }
</style>
