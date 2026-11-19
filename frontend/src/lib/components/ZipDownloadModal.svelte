<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import { prepareFolderZip, getZipJobStatus, getZipDownloadUrl, type ZipPartInfo } from '$lib/api/media';
  import { Loader2, Check, AlertCircle, Archive, Download } from '@lucide/svelte';

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
  let totalParts = $state(1);
  let currentPartIndex = $state(1);
  let parts = $state<ZipPartInfo[]>([]);
  let errorMessage = $state('');
  let currentJobId = $state<string | null>(null);
  let pollInterval: any = null;
  let singleDownloadUrl = $state('');
  let selectedPartSize = $state<'single' | '2gb' | '4gb' | '8gb'>('single');
  let isDownloadingAll = $state(false);

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

  function triggerDownloadUrl(url: string, filename?: string) {
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function downloadSinglePart(partIdx: number, filename: string) {
    if (!currentJobId) return;
    const url = getZipDownloadUrl(currentJobId, shareToken, partIdx);
    triggerDownloadUrl(url, filename);
  }

  function downloadAllParts() {
    if (!currentJobId || parts.length === 0 || isDownloadingAll) return;
    isDownloadingAll = true;
    parts.forEach((p, index) => {
      setTimeout(() => {
        const url = getZipDownloadUrl(currentJobId!, shareToken, p.partIndex);
        triggerDownloadUrl(url, p.filename);
        if (index === parts.length - 1) {
          setTimeout(() => { isDownloadingAll = false; }, 1000);
        }
      }, index * 750);
    });
  }

  async function startZipProcess(chosenSize: 'single' | '2gb' | '4gb' | '8gb' = 'single') {
    selectedPartSize = chosenSize;
    stopPolling();
    status = 'preparing';
    progress = 0;
    processedFiles = 0;
    totalFiles = 0;
    totalBytes = 0;
    totalParts = 1;
    currentPartIndex = 1;
    parts = [];
    errorMessage = '';
    singleDownloadUrl = '';
    isDownloadingAll = false;

    try {
      const res = await prepareFolderZip(folderPath, shareToken, chosenSize);
      currentJobId = res.jobId;
      totalFiles = res.totalFiles || 0;
      totalParts = res.totalParts || 1;
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
          totalParts = job.totalParts || 1;
          currentPartIndex = job.currentPartIndex || 1;
          parts = job.parts || [];

          if (job.status === 'ready') {
            stopPolling();
            status = 'ready';
            progress = 100;
            if (totalParts === 1) {
              const finalUrl = getZipDownloadUrl(currentJobId, shareToken);
              singleDownloadUrl = finalUrl;
              window.open(finalUrl, '_blank');
            }
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
        startZipProcess('single');
      } else {
        status = 'idle';
      }
    } else {
      stopPolling();
      status = 'idle';
    }
  });
</script>

<Modal bind:show={show} id="download-folder" title={status === 'ready' ? (totalParts > 1 ? 'Downloads Ready' : 'Download Ready') : 'Download Folder'}>
  {#if status === 'idle'}
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <button 
        class="btn" 
        style="display: block; text-align: center; width: 100%; padding: 12px; font-weight: 500; background: var(--text-color); color: var(--bg-color);" 
        onclick={() => startZipProcess('single')}
      >
        Download All in One Zip
      </button>

      <div style="display: flex; align-items: center; gap: 10px; margin: 2px 0;">
        <div style="flex: 1; height: 1px; background: var(--glass-border);"></div>
        <span style="font-size: 0.75rem; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">or in parts</span>
        <div style="flex: 1; height: 1px; background: var(--glass-border);"></div>
      </div>

      <div>
        <div style="font-size: 0.85rem; font-weight: 500; margin-bottom: 4px; color: var(--text-color);">Download as Multi-part Zips</div>
        <p class="zip-muted" style="margin-top: 0; margin-bottom: 10px; font-size: 0.8rem;">
          Recommended for large folders. Splits files into standalone zip archives.
        </p>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
          <button 
            class="btn multi-part-opt-btn"
            onclick={() => startZipProcess('2gb')}
          >
            <span class="part-size-title">2 GB</span>
            <span class="part-size-sub">Parts</span>
          </button>
          <button 
            class="btn multi-part-opt-btn recommended-btn"
            onclick={() => startZipProcess('4gb')}
          >
            <span class="part-size-title">4 GB</span>
            <span class="part-size-sub">Recommended</span>
          </button>
          <button 
            class="btn multi-part-opt-btn"
            onclick={() => startZipProcess('8gb')}
          >
            <span class="part-size-title">8 GB</span>
            <span class="part-size-sub">Parts</span>
          </button>
        </div>
      </div>
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
        <span>
          {#if totalParts > 1}
            Archiving Part {currentPartIndex} of {totalParts}...
          {:else}
            Archiving files...
          {/if}
        </span>
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
          <div style="font-weight: 600; font-size: 1rem;">
            {totalParts > 1 ? `Archive Ready (${totalParts} Parts)` : 'Archive Ready'}
          </div>
          <div class="zip-muted">
            {totalParts > 1 ? 'Download each part below or download all at once.' : 'Download started automatically.'}
          </div>
        </div>
      </div>

      {#if totalParts > 1}
        <div class="parts-list" style="margin-top: 14px; max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
          {#each parts as part}
            <div class="part-item-row">
              <div class="part-item-left">
                <Archive size={16} class="part-icon" />
                <span class="part-name" title={part.filename}>{part.filename}</span>
              </div>
              <button 
                class="btn part-dl-btn" 
                onclick={() => downloadSinglePart(part.partIndex, part.filename)}
              >
                <Download size={14} />
                <span>Download</span>
              </button>
            </div>
          {/each}
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 16px;">
          <button 
            class="btn" 
            style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; background: var(--text-color); color: var(--bg-color);"
            onclick={downloadAllParts}
            disabled={isDownloadingAll}
          >
            {#if isDownloadingAll}
              <Loader2 size={16} class="spinner" />
              <span>Starting Downloads...</span>
            {:else}
              <Download size={16} />
              <span>Download All Parts ({totalParts})</span>
            {/if}
          </button>
          <button 
            class="btn" 
            style="width: 100%; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-color);" 
            onclick={handleClose}
          >
            Close
          </button>
        </div>
      {:else}
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 16px;">
          {#if singleDownloadUrl}
            <a 
              href={singleDownloadUrl} 
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
      {/if}
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
          onclick={() => startZipProcess(selectedPartSize)}
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

  .multi-part-opt-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 10px 8px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    color: var(--text-color);
    border-radius: 8px;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .multi-part-opt-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.25);
  }

  .recommended-btn {
    border-color: rgba(255, 255, 255, 0.3);
  }

  .part-size-title {
    font-weight: 600;
    font-size: 0.95rem;
  }

  .part-size-sub {
    font-size: 0.72rem;
    color: #a1a1aa;
    margin-top: 2px;
  }

  .part-item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    gap: 8px;
  }

  .part-item-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .part-name {
    font-size: 0.85rem;
    color: var(--text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.part-icon) {
    color: #a1a1aa;
    flex-shrink: 0;
  }

  .part-dl-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    padding: 5px 10px;
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    color: var(--text-color);
    flex-shrink: 0;
  }

  .part-dl-btn:hover {
    background: rgba(255, 255, 255, 0.15);
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