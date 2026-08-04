<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { ChevronLeft, Activity, Play, Pause, Square, Trash2, Cpu, ShieldCheck, Save, Layers, Image, RefreshCw, Video } from '@lucide/svelte';
  import Modal from '$lib/components/Modal.svelte';

  let queues = $state<any>({});
  let executionMode = $state<'pipeline' | 'batch'>('pipeline');
  let settings = $state<any>({
    scanInterval: 3600000,
    scanSchedule: { type: 'off' },
    mlConfidenceThreshold: 0.6
  });
  let saving = $state(false);
  let loading = $state(true);
  let pollInterval: any;

  import { toast } from '$lib/stores/toast';

  let alertModal = $state(false);
  let alertTitle = $state('');
  let alertMessage = $state('');

  function customAlert(title: string, message: string) {
    if (title.toLowerCase().includes('error') || title.toLowerCase().includes('fail')) {
      toast.error(message);
    } else if (title.toLowerCase().includes('success') || title.toLowerCase().includes('started')) {
      toast.success(message);
    } else if (title.toLowerCase().includes('warning')) {
      toast.warning(message);
    } else {
      toast.info(message);
    }
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
        queues = data.queues || {};
        if (data.mode) executionMode = data.mode;
      }
      if (sRes.ok) {
        const data = await sRes.json();
        settings.scanInterval = data.scanInterval;
        settings.scanSchedule = data.scanSchedule || { type: 'off' };
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
      queues = data.queues || {};
      if (data.mode) executionMode = data.mode;
    }
  }

  async function saveSettings() {
    saving = true;
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          scanInterval: Number(settings.scanInterval),
          scanSchedule: settings.scanSchedule,
          mlConfidenceThreshold: Number(settings.mlConfidenceThreshold)
        })
      });
      // D-4 Fix: check response.ok before declaring success — previously showed
      // 'Settings saved!' even when the API returned an error.
      if (res.ok) {
        customAlert('Success', 'Processing settings saved!');
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        customAlert('Error', `Failed to save settings: ${err.error || res.statusText}`);
      }
    } catch (e: any) {
      customAlert('Error', `Failed to save settings: ${e.message}`);
    } finally {
      saving = false;
    }
  }

  async function toggleExecutionMode(newMode: 'pipeline' | 'batch') {
    if (executionMode === newMode) return;
    // Optimistic update — instant UI feedback before API responds
    executionMode = newMode;
    try {
      const res = await fetch(`${API_BASE}/api/admin/queues/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: newMode })
      });
      if (res.ok) {
        const data = await res.json();
        executionMode = data.mode;
        const label = data.mode === 'pipeline' ? 'Pipeline' : 'Batch';
        toast.success(`Switched to ${label} mode`);
      } else {
        // Roll back on failure
        executionMode = newMode === 'pipeline' ? 'batch' : 'pipeline';
        toast.error('Failed to change execution mode');
      }
    } catch (e) {
      executionMode = newMode === 'pipeline' ? 'batch' : 'pipeline';
      toast.error('Network error changing mode');
    }
  }

  onMount(() => {
    loadData();
    // Slowed from 5s to 10s — backend now caches stats for 6s, so 10s poll is safe
    // and cuts the number of DB-hitting requests by 50%.
    pollInterval = setInterval(loadQueuesOnly, 10000);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  $effect(() => {
    const type = settings.scanSchedule.type;
    if (type === 'daily') {
      if (settings.scanSchedule.hour === undefined) settings.scanSchedule.hour = 2;
      if (settings.scanSchedule.minute === undefined) settings.scanSchedule.minute = 0;
    } else if (type === 'weekly') {
      if (settings.scanSchedule.dayOfWeek === undefined) settings.scanSchedule.dayOfWeek = 0;
      if (settings.scanSchedule.hour === undefined) settings.scanSchedule.hour = 2;
      if (settings.scanSchedule.minute === undefined) settings.scanSchedule.minute = 0;
    } else if (type === 'monthly') {
      if (settings.scanSchedule.dayOfMonth === undefined) settings.scanSchedule.dayOfMonth = 1;
      if (settings.scanSchedule.hour === undefined) settings.scanSchedule.hour = 2;
      if (settings.scanSchedule.minute === undefined) settings.scanSchedule.minute = 0;
    }
  });

  async function actionQueue(name: string, action: string) {
    const label = name.replace(/-/g, ' ');
    const actionLabel = action === 'pause' ? 'Paused' : action === 'resume' ? 'Resumed' : action.charAt(0).toUpperCase() + action.slice(1) + 'ed';
    try {
      const res = await fetch(`${API_BASE}/api/admin/queues/${name}/${action}`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      if (res.ok) {
        toast.success(`${actionLabel} ${label} queue`);
        await loadQueuesOnly();
      } else {
        toast.error(`Failed to ${action} ${label} queue`);
      }
    } catch {
      toast.error(`Network error on ${label} ${action}`);
    }
  }
  
  async function stopQueue(name: string) {
    const label = name.replace(/-/g, ' ');
    customConfirm('Stop Queue', `Stop and cancel all pending jobs in the ${label} queue?`, true, async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/queues/${name}/stop`, { 
          method: 'POST', 
          credentials: 'include' 
        });
        if (res.ok) {
          toast.success(`Stopped ${label} queue`);
          await loadQueuesOnly();
        } else {
          toast.error(`Failed to stop ${label} queue`);
        }
      } catch {
        toast.error(`Network error stopping ${label}`);
      }
    });
  }
  
  async function cleanQueue(name: string, type: string) {
    const label = name.replace(/-/g, ' ');
    try {
      const res = await fetch(`${API_BASE}/api/admin/queues/${name}/clean`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type })
      });
      if (res.ok) {
        toast.success(`Cleared ${type} jobs from ${label}`);
        await loadQueuesOnly();
      } else {
        toast.error(`Failed to clean ${label}`);
      }
    } catch {
      toast.error(`Network error cleaning ${label}`);
    }
  }

  async function triggerResetEverything() {
    customConfirm(
      'Reset Everything',
      'This will permanently wipe ALL indexed data: every photo record, EXIF tag, thumbnail, face detection result, and smart search embedding. Your actual photo files on disk are NOT deleted. Everything will be re-processed from scratch. This cannot be undone.',
      true,
      async () => {
        const res = await fetch(`${API_BASE}/api/admin/reset-index`, { method: 'POST', credentials: 'include' });
        if (res.ok) {
          customAlert('Reset Started', 'All data wiped. A full rescan has been triggered in the background.');
        } else {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          customAlert('Error', `Reset failed: ${err.error}`);
        }
      }
    );
  }

  async function triggerResetExif() {
    customConfirm('Reset EXIF & Thumbnails', 'Are you sure you want to flush all EXIF data and thumbnails? They will be re-generated from scratch.', true, async () => {
      await fetch(`${API_BASE}/api/admin/reset-exif`, { method: 'POST', credentials: 'include' });
      customAlert('Success', 'EXIF data reset and reprocessing initiated!');
    });
  }

  async function triggerResetThumbnails() {
    customConfirm('Reset Image Thumbnails', 'Are you sure you want to clear all image thumbnail caches and blurhash data? EXIF metadata will be preserved. Thumbnails will be regenerated in the background.', false, async () => {
      await fetch(`${API_BASE}/api/admin/reset-thumbnails`, { method: 'POST', credentials: 'include' });
      await loadQueuesOnly();
      customAlert('Success', 'Image thumbnail reset and regeneration initiated!');
    });
  }

  async function triggerResetVideos() {
    customConfirm('Reset Video Transcoding', 'Are you sure you want to wipe all video thumbnails and transcoded video frames? They will be re-processed in the background.', false, async () => {
      await fetch(`${API_BASE}/api/admin/reset-videos`, { method: 'POST', credentials: 'include' });
      await loadQueuesOnly();
      customAlert('Success', 'Video reset and re-processing initiated!');
    });
  }

  async function triggerResetFaces() {
    customConfirm('Reset Faces', 'Are you sure you want to completely wipe all facial recognition data? They will be re-detected.', true, async () => {
      await fetch(`${API_BASE}/api/admin/reset-faces`, { method: 'POST', credentials: 'include' });
      customAlert('Success', 'Face data reset and re-detection initiated!');
    });
  }

  async function triggerResetSmartSearch() {
    customConfirm('Reset Smart Search', 'Are you sure you want to wipe all smart search embeddings? They will be re-generated in the background.', true, async () => {
      await fetch(`${API_BASE}/api/admin/reset-smart-search`, { method: 'POST', credentials: 'include' });
      customAlert('Success', 'Smart search reset and re-generation initiated!');
    });
  }

  async function triggerClearFaceThumbnails() {
    customConfirm('Clear Face Thumbnails', 'This will delete all cached face thumbnail images and re-queue their generation in the background. Face thumbnails will be regenerated with the latest representative face for each person.', false, async () => {
      await fetch(`${API_BASE}/api/admin/clear-face-thumbnails`, { method: 'POST', credentials: 'include' });
      await loadQueuesOnly();
      customAlert('Success', 'Face thumbnail cache cleared and regeneration queued!');
    });
  }

  async function triggerNuke() {
    triggerResetEverything();
  }

  const queueNames = [
    'scanner',
    'metadata',
    'thumbnail',
    'video',
    'smart-search',
    'face-detection',
    'facial-recognition',
    'face-thumbnail'
  ];

  const queueTitles: Record<string, string> = {
    'scanner': '1. Directory Discovery (Scanner)',
    'metadata': '2. EXIF Metadata Extraction (Metadata)',
    'thumbnail': '3. Image Thumbnail & Blurhash (Thumbnail)',
    'video': '4. Video Transcoding & Frames (Video)',
    'smart-search': '5. Smart Search & Embeddings (Smart Search)',
    'face-detection': '6. Face Detection (Face Detection)',
    'facial-recognition': '7. Facial Recognition (Facial Recognition)',
    'face-thumbnail': '8. Face Thumbnail Generation (Face Thumbnail)'
  };

  async function triggerJob(name: string) {
    const label = name.replace(/-/g, ' ');
    try {
      const res = await fetch(`${API_BASE}/api/admin/queues/${name}/trigger`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        toast.success(`Started ${label} queue`);
      } else {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        toast.error(`Failed to start ${label}: ${err.error || res.statusText}`);
      }
    } catch (e: any) {
      toast.error(`Network error starting ${label}: ${e.message}`);
    }
    await loadQueuesOnly();
  }

  let batchRunning = $state(false);

  async function runAllJobs() {
    if (executionMode === 'batch') {
      try {
        batchRunning = true;
        const res = await fetch(`${API_BASE}/api/admin/queues/start-all-batch`, { method: 'POST', credentials: 'include' });
        if (res.status === 409) {
          toast.info('A batch run is already in progress');
        } else if (res.ok) {
          toast.success('Batch processing started. Stages will run serially.');
        } else {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          toast.error(`Failed to start batch: ${err.error}`);
          batchRunning = false;
        }
      } catch (e: any) {
        toast.error(`Network error: ${e.message}`);
        batchRunning = false;
      }
    } else {
      try {
        const res = await fetch(`${API_BASE}/api/admin/queues/metadata/trigger`, { method: 'POST', credentials: 'include' });
        if (res.ok) {
          toast.success('Pipeline started. Photos will chain through all stages automatically.');
        } else {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          toast.error(`Failed to start pipeline: ${err.error || res.statusText}`);
        }
      } catch (e: any) {
        toast.error(`Network error starting pipeline: ${e.message}`);
      }
    }
    await loadQueuesOnly();
  }

  async function stopAllJobs() {
    customConfirm('Stop All Jobs', 'Stop and cancel all pending jobs across all queues?', true, async () => {
      try {
        await Promise.all(queueNames.map(name =>
          fetch(`${API_BASE}/api/admin/queues/${name}/stop`, { method: 'POST', credentials: 'include' })
        ));
        toast.success('All queues stopped');
        await loadQueuesOnly();
      } catch {
        toast.error('Failed to stop all queues');
      }
    });
  }

  async function pauseAllJobs() {
    try {
      await Promise.all(queueNames.map(name =>
        fetch(`${API_BASE}/api/admin/queues/${name}/pause`, { method: 'POST', credentials: 'include' })
      ));
      toast.success('All queues paused');
      await loadQueuesOnly();
    } catch {
      toast.error('Failed to pause all queues');
    }
  }

  // Format seconds into a human-readable string like "2h 35min" or "45min 20s"
  function formatEta(seconds: number | null): string {
    if (seconds === null || seconds <= 0) return '';
    if (seconds < 60) return `${seconds}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min ${s}s`;
  }

  // Overall ETA: the max etaSeconds across all active queues (pipeline bottleneck)
  const overallEta = $derived(() => {
    let max = 0;
    for (const name of queueNames) {
      const q = queues[name];
      if (q?.eta?.etaSeconds != null && q.eta.etaSeconds > max) max = q.eta.etaSeconds;
    }
    return max > 0 ? max : null;
  });

  const anyActive = $derived(() => queueNames.some(n => (queues[n]?.bullmq?.active || 0) > 0));
</script>

<div class="admin-container">
  <div class="header">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a href="/admin" title="Back to Admin Dashboard" style="display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; color: rgba(255,255,255,0.4); text-decoration: none; transition: color 0.2s, transform 0.2s;" onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }} onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}>
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>Processing & Job Queues</h2>
        <p>Configure processing constraints and monitor background workers across all 8 pipeline queues.</p>
      </div>
    </div>
    <div style="display: flex; gap: 0.5rem;">
      <button class="btn secondary" onclick={loadQueuesOnly} title="Refresh queue counts">
        <RefreshCw size={18} /> Refresh
      </button>
      <button class="btn primary" onclick={saveSettings} disabled={saving}>
        {#if saving}
          Saving...
        {:else}
          <Save size={18} /> Save Changes
        {/if}
      </button>
    </div>
  </div>

  <div class="pipeline">
    <!-- Configuration section -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
      <div class="card">
        <h3 style="margin: 0 0 1rem 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;"><Cpu size={18} color="#3b82f6"/> Hardware & Scans</h3>
        <div class="form-group">
          <label style="display: block; font-size: 0.9rem; margin-bottom: 0.25rem;">Auto-Scan Schedule</label>
          <select bind:value={settings.scanSchedule.type} style="width: 100%; padding: 0.5rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px; margin-bottom: 0.5rem;">
            <option value="off">Off</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          {#if settings.scanSchedule.type === 'daily'}
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="color: #a1a1aa; font-size: 0.85rem;">at</span>
              <input type="number" bind:value={settings.scanSchedule.hour} min="0" max="23" style="width: 60px; padding: 0.4rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;" />
              <span style="color: #a1a1aa;">:</span>
              <input type="number" bind:value={settings.scanSchedule.minute} min="0" max="59" style="width: 60px; padding: 0.4rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;" />
            </div>
          {:else if settings.scanSchedule.type === 'weekly'}
            <div style="display: flex; flex-direction: column; gap: 0.4rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="color: #a1a1aa; font-size: 0.85rem;">on</span>
                <select bind:value={settings.scanSchedule.dayOfWeek} style="flex: 1; padding: 0.4rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;">
                  <option value={0}>Sunday</option>
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="color: #a1a1aa; font-size: 0.85rem;">at</span>
                <input type="number" bind:value={settings.scanSchedule.hour} min="0" max="23" style="width: 60px; padding: 0.4rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;" />
                <span style="color: #a1a1aa;">:</span>
                <input type="number" bind:value={settings.scanSchedule.minute} min="0" max="59" style="width: 60px; padding: 0.4rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;" />
              </div>
            </div>
          {:else if settings.scanSchedule.type === 'monthly'}
            <div style="display: flex; flex-direction: column; gap: 0.4rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="color: #a1a1aa; font-size: 0.85rem;">on day</span>
                <input type="number" bind:value={settings.scanSchedule.dayOfMonth} min="1" max="28" style="width: 60px; padding: 0.4rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;" />
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="color: #a1a1aa; font-size: 0.85rem;">at</span>
                <input type="number" bind:value={settings.scanSchedule.hour} min="0" max="23" style="width: 60px; padding: 0.4rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;" />
                <span style="color: #a1a1aa;">:</span>
                <input type="number" bind:value={settings.scanSchedule.minute} min="0" max="59" style="width: 60px; padding: 0.4rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px;" />
              </div>
            </div>
          {/if}
          {#if settings.scanSchedule.type !== 'off'}
            <p style="font-size: 0.75rem; color: #a1a1aa; margin: 0.4rem 0 0 0;">
              Next scan runs {
                settings.scanSchedule.type === 'daily' ? 'daily' :
                settings.scanSchedule.type === 'weekly' ? `weekly on ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][settings.scanSchedule.dayOfWeek ?? 0]}` :
                `monthly on day ${settings.scanSchedule.dayOfMonth ?? 1}`
              } at {String(settings.scanSchedule.hour ?? 2).padStart(2,'0')}:{String(settings.scanSchedule.minute ?? 0).padStart(2,'0')}
            </p>
          {/if}
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

    <!-- Execution Mode Toggle Bar -->
    <div class="card mode-card" style="background: rgba(30, 30, 45, 0.7); border: 1px solid rgba(99, 102, 241, 0.3);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h3 style="margin: 0 0 0.25rem 0; font-size: 1.15rem; display: flex; align-items: center; gap: 0.5rem; color: #fff;">
            <Layers size={20} color="#6366f1" /> Execution Mode Controls
          </h3>
          <p style="margin: 0; font-size: 0.85rem; color: #a1a1aa;">
            {#if executionMode === 'pipeline'}
              <strong style="color: #6366f1;">Pipeline Mode:</strong> Assembly line. Each photo flows through all stages in order (Metadata, Thumbnail, Smart Search, Face Detection, Recognition), while multiple photos are in-flight across different stages simultaneously.
            {:else}
              <strong style="color: #10b981;">Batch Mode:</strong> Stage by stage. All photos complete one stage fully before the next stage begins. Only one queue type is active at a time, using lower memory. Ideal for large libraries.
            {/if}
          </p>
        </div>

        <div style="display: flex; background: rgba(0, 0, 0, 0.4); padding: 4px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1);">
          <button 
            class="mode-btn {executionMode === 'pipeline' ? 'active-sequential' : ''}" 
            onclick={() => toggleExecutionMode('pipeline')}
            type="button"
          >
            Pipeline
          </button>
          <button 
            class="mode-btn {executionMode === 'batch' ? 'active-concurrent' : ''}" 
            onclick={() => toggleExecutionMode('batch')}
            type="button"
          >
            Batch
          </button>
        </div>
      </div>
    </div>

    <div style="margin-top: 0.5rem;">
      <!-- Overall ETA banner when any queue is active -->
      {#if anyActive() && overallEta()}
        <div style="background: linear-gradient(135deg, rgba(59,130,246,0.15), rgba(99,102,241,0.1)); border: 1px solid rgba(99,102,241,0.3); border-radius: 10px; padding: 0.75rem 1.25rem; display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
          <Activity size={18} color="#6366f1" />
          <span style="color: #e4e4e7; font-size: 0.9rem;">Overall estimated completion:</span>
          <span style="font-size: 1rem; font-weight: 700; color: #6366f1;">~{formatEta(overallEta())}</span>
          <span style="color: #a1a1aa; font-size: 0.8rem;">(based on slowest active queue)</span>
        </div>
      {/if}

      <div class="pipeline-toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <!-- D-1 Fix: was incorrectly labelled "7 Pipeline Queues" when there are 8 -->
        <h3 style="margin: 0; font-size: 1.25rem; color: #e4e4e7;">8 Pipeline Queues</h3>
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
            {@const counts = q.counts || { waiting: 0, active: 0, completed: 0, failed: 0, total: 0 }}
            {@const total = counts.total || counts.waiting + counts.active + counts.completed + counts.failed}
            {@const pCompleted = total > 0 ? (counts.completed / total) * 100 : 0}
            {@const pActive = total > 0 ? (counts.active / total) * 100 : 0}
            {@const pWaiting = total > 0 ? (counts.waiting / total) * 100 : 0}
            {@const isRunning = (q.bullmq?.active || 0) > 0}

            {@const isWaiting = !isRunning && counts.waiting > 0}

            <div class="card queue-card" style="margin: 0;">
              <div class="q-header">
                <h3 style="display: flex; align-items: center; gap: 0.5rem;">
                  {queueTitles[name] || name}
                  {#if q.isPaused}
                    <span style="background: #6b7280; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; letter-spacing: 0.5px;">PAUSED</span>
                  {:else if isRunning}
                    <span style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; letter-spacing: 0.5px;">RUNNING</span>
                  {:else if counts.waiting > 0}
                    <span style="background: #f59e0b; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; letter-spacing: 0.5px;">WAITING</span>
                  {:else if counts.total > 0}
                    <span style="background: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; letter-spacing: 0.5px;">COMPLETED</span>
                  {/if}
                </h3>
                <div class="q-actions">
                  <button class="btn success sm" disabled={isRunning || isWaiting} style={(isRunning || isWaiting) ? 'opacity: 0.5; cursor: not-allowed;' : ''} onclick={() => triggerJob(name)} title="Force Run Queue"><Play size={14}/> Start</button>
                  
                  {#if q.isPaused}
                    <button class="btn success sm" onclick={() => actionQueue(name, 'resume')}><Play size={14}/> Resume</button>
                  {:else if !isRunning}
                    <button class="btn warning sm" disabled style="opacity: 0.5; cursor: not-allowed;"><Pause size={14}/> Pause</button>
                  {:else}
                    <button class="btn warning sm" onclick={() => actionQueue(name, 'pause')}><Pause size={14}/> Pause</button>
                  {/if}

                  <button class="btn danger sm" disabled={!isRunning} style={!isRunning ? 'opacity: 0.5; cursor: not-allowed;' : ''} onclick={() => stopQueue(name)} title="Stop & Cancel Pending"><Square size={14}/> Stop</button>
                  <button class="btn secondary sm" onclick={() => cleanQueue(name, 'failed')} title="Clear Failed"><Trash2 size={14}/></button>
                </div>
              </div>
              
              <div class="progress-container" style="display: flex;">
                {#if pCompleted > 0}<div class="progress-bar completed" style="width: {pCompleted}%; background: #10b981;" title="Completed: {counts.completed}/{total}"></div>{/if}
                {#if pActive > 0}<div class="progress-bar active" style="width: {pActive}%; background: #3b82f6;" title="Active: {counts.active}/{total}"></div>{/if}
                {#if pWaiting > 0}<div class="progress-bar waiting" style="width: {pWaiting}%; background: #f59e0b;" title="Waiting: {counts.waiting}/{total}"></div>{/if}
              </div>
              
              <div class="q-stats">
                <div class="stat"><span class="dot total"></span> Total: {total}</div>
                <div class="stat"><span class="dot completed"></span> Completed: {counts.completed}</div>
                <div class="stat"><span class="dot active"></span> Active: {counts.active}</div>
                <div class="stat"><span class="dot waiting"></span> Waiting: {counts.waiting}</div>
                <div class="stat"><span class="dot failed"></span> Failed: {counts.failed}</div>
              </div>
              
              {#if q.extra && name === 'scanner'}
                <div class="q-stats" style="margin-top: 0.5rem; background: rgba(0,0,0,0.2); padding: 0.5rem 1rem; border-radius: 6px;">
                  <div class="stat" style="color: #c084fc;"><span class="dot" style="background: #c084fc;"></span> Unique Folders Found: {q.extra.folders}</div>
                  <div class="stat" style="color: #60a5fa;"><span class="dot" style="background: #60a5fa;"></span> Media Files Discovered: {q.extra.files}</div>
                </div>
              {/if}

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

              {#if q.eta?.etaSeconds != null || q.eta?.ratePerMin != null}
                <div style="margin-top: 0.75rem; display: flex; gap: 1rem; flex-wrap: wrap; align-items: center;">
                  {#if q.eta.ratePerMin != null}
                    <span style="font-size: 0.78rem; color: #a1a1aa; background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2); padding: 2px 8px; border-radius: 20px;">
                      ⚡ {q.eta.ratePerMin} items/min
                    </span>
                  {/if}
                  {#if q.eta.etaSeconds != null && q.eta.etaSeconds > 0}
                    <span style="font-size: 0.78rem; color: #10b981; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); padding: 2px 8px; border-radius: 20px;">
                      ⏱ ~{formatEta(q.eta.etaSeconds)} remaining
                    </span>
                  {:else if q.eta.etaSeconds === 0}
                    <span style="font-size: 0.78rem; color: #10b981;">✓ Done</span>
                  {/if}
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
          <button class="btn danger" style="width: 100%; justify-content: center;" onclick={triggerResetEverything}>
            <Activity size={16}/> Reset Everything
          </button>
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerResetExif}>
            <Save size={16}/> Reset EXIF & Thumbnails
          </button>
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerResetThumbnails}>
            <Image size={16}/> Reset Thumbnails Only
          </button>
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerResetVideos}>
            <Video size={16}/> Reset Videos
          </button>
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerResetFaces}>
            <Cpu size={16}/> Reset ML Data
          </button>
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerResetSmartSearch}>
            <Layers size={16}/> Reset Smart Search
          </button>
          <button class="btn secondary" style="width: 100%; justify-content: center;" onclick={triggerClearFaceThumbnails}>
            <Trash2 size={16}/> Clear Face Thumbnails
          </button>
        </div>
        

      </div>
    </div>
  </div>
</div>


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

  .mode-btn {
    padding: 0.4rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    background: transparent;
    color: #a1a1aa;
    transition: all 0.2s ease;
  }
  .mode-btn.active-sequential {
    background: #6366f1;
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
  }
  .mode-btn.active-concurrent {
    background: #10b981;
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);
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
  .dot.total { background: #a78bfa; }
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
  .btn.primary { background: #6366f1; color: white; }
  .btn.success { background: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
  .btn.warning { background: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
  .btn.danger { background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
  .btn.secondary { background: rgba(255, 255, 255, 0.05); color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.1); }
  .btn:hover { filter: brightness(1.2); }

  @media (max-width: 900px) {
    h2 { font-size: 1.5rem; }
    .header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .pipeline-toolbar {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
    .pipeline-toolbar > div { flex-wrap: wrap; }
    .q-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .q-actions { flex-wrap: wrap; }
    .q-stats { flex-wrap: wrap; gap: 1rem; }
    .card { padding: 1rem; }
  }
</style>
