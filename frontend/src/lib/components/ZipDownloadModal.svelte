<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import { prepareFolderZip, getZipJobStatus, getZipDownloadUrl } from '$lib/api/media';
  import { Loader2, Check, AlertCircle } from '@lucide/svelte';

  let {
    show = $bindable(false),
    folderPath = '',
    folderName = '',
    shareToken = '',
    autoStart = false,
    onclose
  }: {
    show: boolean;
    folderPath: string;
    folderName?: string;
    shareToken?: string;
    autoStart?: boolean;
    onclose?: () => void;
  } = $props();

  let status = $state<'idle' | 'preparing' | 'zipping' | 'ready' | 'error'>('idle');
  let progress = $state(0);
  let processedFiles = $state(0);
  let totalFiles = $state(0);
  let totalBytes = $state(0);
  let errorMessage = $state('');
  let currentJobId = $state<string | null>(null);
  let pollInterval: any = null;
  let downloadUrl = $state('');

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function handleClose() {
    stopPolling();
    show = false;
    if (onclose) onclose();
  }

  async function startZipProcess() {
    stopPolling();
    status = 'preparing';
    progress = 0;
    processedFiles = 0;
    totalFiles = 0;
    totalBytes = 0;
    errorMessage = '';
    downloadUrl = '';

    try {
      const res = await prepareFolderZip(folderPath, shareToken);
      currentJobId = res.jobId;
      totalFiles = res.totalFiles || 0;
      status = 'zipping';

      // Poll status every 750ms
      pollInterval = setInterval(async () => {
        if (!currentJobId) return;
        try {
          const job = await getZipJobStatus(currentJobId, shareToken);
          progress = job.progress;
          processedFiles = job.processedFiles;
          totalFiles = job.totalFiles;
          totalBytes = job.totalBytes;

          if (job.status === 'ready') {
            stopPolling();
            status = 'ready';
            progress = 100;
            const finalUrl = getZipDownloadUrl(currentJobId, shareToken);
            downloadUrl = finalUrl;
            // Automatically open download in new tab
            window.open(finalUrl, '_blank');
          } else if (job.status === 'error') {
            stopPolling();
            status = 'error';
            errorMessage = job.error || 'Failed to archive files.';
          }
        } catch (e: any) {
          console.error('[ZIP] Status poll error:', e);
        }
      }, 750);
    } catch (e: any) {
      status = 'error';
      errorMessage = e.message || 'Failed to initialize ZIP preparation.';
    }
  }

  $effect(() => {
    if (show) {
      if (autoStart) {
        startZipProcess();
      } else {
        status = 'idle';
      }
    } else {
      stopPolling();
      status = 'idle';
    }
  });
</script>

<Modal bind:show={show} id="download-folder" title={status === 'ready' ? 'Download Ready' : 'Download Folder'}>
  {#if status === 'idle'}
    <div>
      <button 
        class="btn" 
        style="display: block; text-align: center; width: 100%; margin-bottom: 12px; background: var(--text-color); color: var(--bg-color);" 
        onclick={startZipProcess}
      >
        Download All in One Zip
      </button>
      <button 
        class="btn" 
        style="width: 100%; background: var(--glass-bg); border: 1px solid var(--glass-border); color: rgba(255, 255, 255, 0.4); cursor: not-allowed;" 
        disabled
      >
        Download as Multi-part Zips (Coming Soon)
      </button>
    </div>
  {:else if status === 'preparing'}
    <div class="zip-progress-container">
      <div class="spinner-row">
        <Loader2 size={20} class="spinner" />
        <span>Preparing archive...</span>
      </div>
      <p class="zip-muted">Scanning folder contents and verifying files.</p>
    </div>
  {:else if status === 'zipping'}
    <div class="zip-progress-container">
      <div class="zip-header-row">
        <span>Archiving files...</span>
        <span class="zip-pct">{progress}%</span>
      </div>
      
      <div class="zip-bar-track">
        <div class="zip-bar-fill" style="width: {progress}%;"></div>
      </div>

      <div class="zip-details-row">
        <span>{processedFiles} of {totalFiles} packaged</span>
        <Loader2 size={14} class="spinner" />
      </div>
    </div>
  {:else if status === 'ready'}
    <div class="zip-progress-container">
      <div class="zip-ready-header">
        <div class="ready-badge">
          <Check size={18} />
        </div>
        <div>
          <div style="font-weight: 600; font-size: 1rem;">Archive Ready</div>
          <div class="zip-muted">Download started automatically.</div>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 16px;">
        {#if downloadUrl}
          <a 
            href={downloadUrl} 
            target="_blank" 
            class="btn" 
            style="display: block; text-align: center; text-decoration: none; width: 100%; background: var(--text-color); color: var(--bg-color);"
          >
            Click to Download Again
          </a>
        {/if}
        <button 
          class="btn" 
          style="width: 100%; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-color);" 
          onclick={handleClose}
        >
          Close
        </button>
      </div>
    </div>
  {:else if status === 'error'}
    <div class="zip-progress-container">
      <div class="zip-ready-header">
        <AlertCircle size={24} style="color: var(--danger); flex-shrink: 0;" />
        <div>
          <div style="font-weight: 600; color: var(--danger);">Archiving Failed</div>
          <div class="zip-muted" style="margin-top: 4px;">{errorMessage}</div>
        </div>
      </div>

      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button 
          class="btn" 
          style="flex: 1; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-color);" 
          onclick={handleClose}
        >
          Cancel
        </button>
        <button 
          class="btn" 
          style="flex: 1; background: var(--text-color); color: var(--bg-color);" 
          onclick={startZipProcess}
        >
          Try Again
        </button>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .zip-progress-container {
    padding: 8px 0;
  }

  .spinner-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--text-color);
  }

  .zip-muted {
    font-size: 0.85rem;
    color: #a1a1aa;
    margin-top: 6px;
  }

  .zip-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
    font-weight: 500;
    margin-bottom: 8px;
    color: var(--text-color);
  }

  .zip-pct {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .zip-bar-track {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .zip-bar-fill {
    height: 100%;
    background: var(--text-color);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .zip-details-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8rem;
    color: #a1a1aa;
    font-variant-numeric: tabular-nums;
  }

  .zip-ready-header {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .ready-badge {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  :global(.spinner) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
