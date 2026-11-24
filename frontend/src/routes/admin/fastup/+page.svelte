<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ChevronLeft, Camera, KeyRound, HardDrive, Cpu, Activity, RefreshCw, Trash2, Eye, EyeOff, Link2, Copy, Check, AlertTriangle, Shield, Folder, ArrowRight, UserCheck, CheckCircle2, UploadCloud, Wifi, Pencil, Power, Filter, ChevronRight, CornerLeftUp, Search, Radio } from '@lucide/svelte';
  import Modal from '$lib/components/Modal.svelte';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import { toast } from '$lib/stores/toast';
  import {
    createPhotographerOtp,
    fetchPhotographerTokens,
    revokePhotographerToken,
    togglePhotographerTokenActive,
    refreshPhotographerOtp,
    updatePhotographerToken,
    fetchFastUpStats,
    retryFastUpFailedJobs,
    reconcileStagingSession,
    relinkStagingFolder,
    toggleHideStagingSession,
    purgeStagingSession,
    fetchFastUpNotice,
    updateFastUpNotice,
    type PhotographerToken,
    type FastUpStats,
    type ReconcileData,
    type FastUpNoticeSettings
  } from '$lib/api/fastup';
  import { API_BASE } from '$lib/api/media';

  let activeTab = $state<'pairing' | 'stats' | 'reconcile' | 'notice'>('pairing');
  let loading = $state(true);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Pairing Tab State
  let tokens = $state<PhotographerToken[]>([]);
  let showOtpModal = $state(false);
  let photogName = $state('');
  let folderPath = $state('');
  let scopeFoldersInput = $state('');
  let availableFolders = $state<string[]>([]);
  let isCreatingFolder = $state(false);
  let newFolderName = $state('');
  let creatingFolder = $state(false);
  let validityHours = $state(24);
  let customServerUrl = $state('');
  let uploadFormat = $state<'JPEG_ONLY' | 'RAW_ONLY' | 'RAW_PLUS_JPEG'>('JPEG_ONLY');
  let autoUpload = $state(true);
  let wifiOnly = $state(false);

  let creatingOtp = $state(false);
  let generatedOtp = $state<string | null>(null);
  let copied = $state(false);

  // Edit Photographer Session Modal State
  let showEditModal = $state(false);
  let editingTokenId = $state('');
  let editPhotogName = $state('');
  let editFolderPath = $state('');
  let editScopeFoldersInput = $state('');
  let editUploadFormat = $state<'JPEG_ONLY' | 'RAW_ONLY' | 'RAW_PLUS_JPEG'>('JPEG_ONLY');
  let editAutoUpload = $state(true);
  let editWifiOnly = $state(false);
  let editValidityHours = $state(24);
  let savingEdit = $state(false);

  let refreshingOtpId = $state<string | null>(null);
  let togglingTokenId = $state<string | null>(null);

  // Stats Tab State
  let stats = $state<FastUpStats | null>(null);
  let statsSessionFilter = $state<string>('');
  let retryingJobs = $state(false);

  // Reconcile Tab State
  let availableSessions = $state<string[]>([]);
  let selectedSession = $state('');
  let customMediaFolder = $state('');
  let reconcileLoading = $state(false);
  let reconcileData = $state<ReconcileData | null>(null);

  // Relink Modal State
  let showRelinkModal = $state(false);
  let targetMediaFolderInput = $state('');
  let relinking = $state(false);

  // Folder Picker Modal State (Hierarchical Directory Navigator with Radio Selection)
  let showFolderPickerModal = $state(false);
  let folderPickerTarget = $state<'otp' | 'relink' | 'edit' | 'otp_scope' | 'edit_scope'>('otp');
  let pickerCurrentPath = $state('');
  let pickerSelectedPath = $state('');
  let pickerSearch = $state('');
  let newPickerSubfolderName = $state('');
  let creatingPickerSubfolder = $state(false);

  // Purge Modal State
  let showPurgeModal = $state(false);
  let purging = $state(false);

  // Revoke Photographer Session Modal State
  let showRevokeModal = $state(false);
  let revokingTokenId = $state<string | null>(null);
  let revokingTokenName = $state<string>('');
  let isRevoking = $state(false);

  // Staging Hide Toggle State
  let stagingHidden = $state(false);
  let togglingHide = $state(false);

  // Live Staging Notice State
  let noticeEnabled = $state(true);
  let noticeTitle = $state('Realtime Photo Sync in Progress');
  let noticeMessage = $state('Note that the photos in this app are being synced in realtime and are not filtered or edited yet. Please return during a later time for the final images. Any enquiries about these photos, you may contact the photographer.');
  let loadingNotice = $state(false);
  let savingNotice = $state(false);

  async function loadNoticeSettings() {
    try {
      loadingNotice = true;
      const res = await fetchFastUpNotice();
      if (res) {
        noticeEnabled = res.enabled !== false;
        noticeTitle = res.title || 'Realtime Photo Sync in Progress';
        noticeMessage = res.message || '';
      }
    } catch (err: any) {
      console.error('Failed to load notice settings:', err);
    } finally {
      loadingNotice = false;
    }
  }

  async function handleSaveNotice(e?: Event) {
    if (e) e.preventDefault();
    savingNotice = true;
    try {
      await updateFastUpNotice({
        enabled: noticeEnabled,
        title: noticeTitle.trim(),
        message: noticeMessage.trim()
      });
      toast.success('Live sync notice settings updated successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update notice settings');
    } finally {
      savingNotice = false;
    }
  }

  function formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDateTime(dateInput: string | Date | null | undefined): string {
    if (!dateInput) return 'Never';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'N/A';
    
    const timeStr = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    const dateStr = d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

    return `${timeStr} ${dateStr}`;
  }

  async function loadInitialData() {
    loading = true;
    try {
      await Promise.all([
        refreshTokens(),
        refreshStats(),
        loadAvailableSessions(),
        loadNoticeSettings()
      ]);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load FastUp data');
    } finally {
      loading = false;
    }
  }

  async function refreshTokens() {
    try {
      tokens = await fetchPhotographerTokens();
    } catch (err: any) {
      console.error(err);
    }
  }

  async function refreshStats() {
    try {
      stats = await fetchFastUpStats(statsSessionFilter || undefined);
    } catch (err: any) {
      console.error(err);
    }
  }

  async function loadAvailableSessions() {
    try {
      const [sessRes, foldRes, adminFoldRes] = await Promise.all([
        fetch(`${API_BASE}/api/staging/sessions`, { credentials: 'include' }).catch(() => null),
        fetch(`${API_BASE}/api/staging/folders`, { credentials: 'include' }).catch(() => null),
        fetch(`${API_BASE}/api/admin/fastup/folders`, { credentials: 'include' }).catch(() => null)
      ]);

      const sessionList: string[] = [];
      if (sessRes && sessRes.ok) {
        const data = await sessRes.json();
        const rawList = Array.isArray(data) ? data : Array.isArray(data.sessions) ? data.sessions : [];
        sessionList.push(...rawList.map((d: any) => d.sessionId || d.folderPath).filter(Boolean));
      }

      const folderList: string[] = [];
      if (adminFoldRes && adminFoldRes.ok) {
        const data = await adminFoldRes.json();
        const rawFolders = Array.isArray(data) ? data : Array.isArray(data.folders) ? data.folders : [];
        folderList.push(...rawFolders);
      }
      if (foldRes && foldRes.ok) {
        const data = await foldRes.json();
        const rawFolders = Array.isArray(data) ? data : Array.isArray(data.folders) ? data.folders : [];
        folderList.push(...rawFolders);
      }

      const combined = Array.from(new Set([...sessionList, ...folderList]))
        .map(s => String(s).trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      availableSessions = sessionList.length > 0 ? sessionList : combined;
      availableFolders = combined;

      if (availableFolders.length > 0 && !folderPath) {
        folderPath = availableFolders[0];
      }
      if (availableSessions.length > 0 && !selectedSession) {
        selectedSession = availableSessions[0];
        triggerReconcile();
      }
    } catch (err: any) {
      console.error('[FastUp] Error loading sessions and folders:', err);
    }
  }

  function openGenerateOtpModal() {
    generatedOtp = null;
    isCreatingFolder = false;
    newFolderName = '';
    photogName = '';
    folderPath = '';
    scopeFoldersInput = '';
    loadAvailableSessions();
    showOtpModal = true;
  }

  async function handleCreateNewFolder() {
    if (!newFolderName.trim()) {
      toast.warning('Please enter a folder name');
      return;
    }
    creatingFolder = true;
    try {
      const res = await fetch(`${API_BASE}/api/staging/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folderPath: newFolderName.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create folder');
      const created = data.folderPath || newFolderName.trim();
      if (!availableFolders.includes(created)) {
        availableFolders = [created, ...availableFolders];
      }
      folderPath = created;
      isCreatingFolder = false;
      newFolderName = '';
      toast.success(`Created folder "${created}"`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create folder');
    } finally {
      creatingFolder = false;
    }
  }

  async function handleCreateOtp(e: Event) {
    e.preventDefault();
    if (!photogName.trim() || !folderPath.trim()) {
      toast.warning('Photographer name and folder path are required');
      return;
    }

    creatingOtp = true;
    try {
      let finalServerUrl = customServerUrl.trim();
      if (!finalServerUrl) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
        // Do not force localhost onto remote phones if left blank
        finalServerUrl = isLocalhost ? '' : origin;
      }

      const rawScopes = scopeFoldersInput.split(',').map(s => s.trim()).filter(Boolean);
      const finalScopes = rawScopes.length > 0 ? rawScopes : [folderPath.trim()];

      const res = await createPhotographerOtp({
        photographerName: photogName.trim(),
        folderPath: folderPath.trim(),
        scopes: finalScopes,
        validityHours: Number(validityHours),
        settings: {
          serverUrl: finalServerUrl,
          sessionId: folderPath.trim(),
          uploadFormat,
          autoUpload,
          wifiOnly
        }
      });

      generatedOtp = res.otpCode;
      toast.success('6-Digit OTP generated successfully!');
      await refreshTokens();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create OTP');
    } finally {
      creatingOtp = false;
    }
  }

  function copyCode() {
    if (!generatedOtp) return;
    navigator.clipboard.writeText(generatedOtp);
    copied = true;
    toast.info('OTP code copied to clipboard');
    setTimeout(() => { copied = false; }, 2000);
  }

  function promptRevokeToken(t: PhotographerToken) {
    revokingTokenId = t.id;
    revokingTokenName = t.photographerName;
    showRevokeModal = true;
  }

  async function confirmRevokeToken() {
    if (!revokingTokenId) return;
    isRevoking = true;
    try {
      await revokePhotographerToken(revokingTokenId);
      toast.success('Photographer session removed');
      showRevokeModal = false;
      revokingTokenId = null;
      await refreshTokens();
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove session');
    } finally {
      isRevoking = false;
    }
  }

  function openEditModal(t: PhotographerToken) {
    editingTokenId = t.id;
    editPhotogName = t.photographerName;
    editFolderPath = t.folderPath;
    editScopeFoldersInput = t.scopes && t.scopes.length > 0 ? t.scopes.join(', ') : t.folderPath;
    editUploadFormat = t.settings?.uploadFormat || 'JPEG_ONLY';
    editAutoUpload = t.settings?.autoUpload ?? true;
    editWifiOnly = t.settings?.wifiOnly ?? false;
    editValidityHours = 24;
    loadAvailableSessions();
    showEditModal = true;
  }

  async function handleSaveEdit(e: Event) {
    e.preventDefault();
    if (!editingTokenId || !editPhotogName.trim() || !editFolderPath.trim()) {
      toast.warning('Photographer name and folder path are required');
      return;
    }
    savingEdit = true;
    try {
      const rawScopes = editScopeFoldersInput.split(',').map(s => s.trim()).filter(Boolean);
      const finalScopes = rawScopes.length > 0 ? rawScopes : [editFolderPath.trim()];

      await updatePhotographerToken(editingTokenId, {
        photographerName: editPhotogName.trim(),
        folderPath: editFolderPath.trim(),
        scopes: finalScopes,
        settings: {
          sessionId: editFolderPath.trim(),
          uploadFormat: editUploadFormat,
          autoUpload: editAutoUpload,
          wifiOnly: editWifiOnly
        },
        validityHours: Number(editValidityHours)
      });
      toast.success('Photographer session updated successfully!');
      showEditModal = false;
      await refreshTokens();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update session');
    } finally {
      savingEdit = false;
    }
  }

  async function handleRefreshOtp(tokenId: string) {
    refreshingOtpId = tokenId;
    try {
      const res = await refreshPhotographerOtp(tokenId);
      generatedOtp = res.otpCode;
      showOtpModal = true;
      toast.success('Generated new 6-digit OTP code!');
      await refreshTokens();
    } catch (err: any) {
      toast.error(err.message || 'Failed to refresh OTP');
    } finally {
      refreshingOtpId = null;
    }
  }

  async function handleToggleActive(tokenId: string, targetActive: boolean) {
    togglingTokenId = tokenId;
    try {
      await togglePhotographerTokenActive(tokenId, targetActive);
      toast.success(targetActive ? 'Photographer session enabled' : 'Photographer session disabled');
      await refreshTokens();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update session status');
    } finally {
      togglingTokenId = null;
    }
  }

  async function handleRetryJobs() {
    retryingJobs = true;
    try {
      const res = await retryFastUpFailedJobs();
      toast.success(`Queued ${res.retriedCount} jobs for reprocessing`);
      await refreshStats();
    } catch (err: any) {
      toast.error(err.message || 'Failed to retry jobs');
    } finally {
      retryingJobs = false;
    }
  }

  async function triggerReconcile() {
    if (!selectedSession) return;
    reconcileLoading = true;
    try {
      reconcileData = await reconcileStagingSession(selectedSession, customMediaFolder.trim() || undefined);
    } catch (err: any) {
      toast.error(err.message || 'Failed to reconcile session');
    } finally {
      reconcileLoading = false;
    }
  }

  function getBreadcrumbSegments(currentPath: string) {
    if (!currentPath) return [];
    const parts = currentPath.split('/').filter(Boolean);
    const segs: { name: string; fullPath: string }[] = [];
    let acc = '';
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      segs.push({ name: p, fullPath: acc });
    }
    return segs;
  }

  let pickerSubfolders = $derived.by(() => {
    const currentPrefix = pickerCurrentPath ? `${pickerCurrentPath}/` : '';
    const subfolderMap = new Map<string, { name: string; fullPath: string; hasChildren: boolean }>();

    for (const f of availableFolders) {
      if (!f) continue;
      if (pickerCurrentPath === '') {
        const slashIndex = f.indexOf('/');
        const topName = slashIndex === -1 ? f : f.substring(0, slashIndex);
        if (!topName) continue;
        const hasChildren = slashIndex !== -1 || availableFolders.some(other => other !== topName && other.startsWith(`${topName}/`));
        if (!subfolderMap.has(topName)) {
          subfolderMap.set(topName, { name: topName, fullPath: topName, hasChildren });
        } else if (hasChildren) {
          subfolderMap.get(topName)!.hasChildren = true;
        }
      } else if (f.startsWith(currentPrefix)) {
        const remainder = f.slice(currentPrefix.length);
        if (!remainder) continue;
        const slashIndex = remainder.indexOf('/');
        const childName = slashIndex === -1 ? remainder : remainder.substring(0, slashIndex);
        if (!childName) continue;
        const childFullPath = `${pickerCurrentPath}/${childName}`;
        const hasChildren = slashIndex !== -1 || availableFolders.some(other => other !== childFullPath && other.startsWith(`${childFullPath}/`));
        if (!subfolderMap.has(childName)) {
          subfolderMap.set(childName, { name: childName, fullPath: childFullPath, hasChildren });
        } else if (hasChildren) {
          subfolderMap.get(childName)!.hasChildren = true;
        }
      }
    }

    const list = Array.from(subfolderMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (!pickerSearch.trim()) return list;
    const q = pickerSearch.trim().toLowerCase();
    return list.filter(item => item.name.toLowerCase().includes(q));
  });

  function openFolderPickerModal(target: 'otp' | 'relink' | 'edit' | 'otp_scope' | 'edit_scope', initialValue = '') {
    folderPickerTarget = target;
    const cleanVal = initialValue.trim();
    pickerSelectedPath = cleanVal;
    
    // Set initial navigation path to parent directory of initialValue if present
    if (cleanVal) {
      const parts = cleanVal.split('/').filter(Boolean);
      if (parts.length > 1) {
        parts.pop();
        pickerCurrentPath = parts.join('/');
      } else {
        pickerCurrentPath = '';
      }
    } else {
      pickerCurrentPath = '';
    }
    
    pickerSearch = '';
    newPickerSubfolderName = '';
    loadAvailableSessions();
    showFolderPickerModal = true;
  }

  function enterPickerFolder(fullPath: string) {
    pickerCurrentPath = fullPath;
    pickerSearch = '';
  }

  function navigateToBreadcrumb(path: string) {
    pickerCurrentPath = path;
    pickerSearch = '';
  }

  function goUpPickerTree() {
    if (!pickerCurrentPath) return;
    const parts = pickerCurrentPath.split('/').filter(Boolean);
    parts.pop();
    pickerCurrentPath = parts.join('/');
    pickerSearch = '';
  }

  async function handleCreatePickerSubfolder() {
    if (!newPickerSubfolderName.trim()) {
      toast.warning('Please enter a folder name');
      return;
    }
    creatingPickerSubfolder = true;
    try {
      const targetFolder = pickerCurrentPath 
        ? `${pickerCurrentPath}/${newPickerSubfolderName.trim()}`
        : newPickerSubfolderName.trim();

      const res = await fetch(`${API_BASE}/api/staging/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folderPath: targetFolder })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create folder');
      const created = data.folderPath || targetFolder;
      if (!availableFolders.includes(created)) {
        availableFolders = [created, ...availableFolders];
      }
      pickerSelectedPath = created;
      newPickerSubfolderName = '';
      toast.success(`Created folder "${created}"`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create folder');
    } finally {
      creatingPickerSubfolder = false;
    }
  }

  function confirmFolderPickerSelection() {
    if (!pickerSelectedPath) {
      toast.warning('Please select a folder');
      return;
    }

    if (folderPickerTarget === 'otp') {
      folderPath = pickerSelectedPath;
      if (!scopeFoldersInput.trim() || scopeFoldersInput === folderPath) {
        scopeFoldersInput = pickerSelectedPath;
      }
    } else if (folderPickerTarget === 'otp_scope') {
      scopeFoldersInput = pickerSelectedPath;
    } else if (folderPickerTarget === 'edit_scope') {
      editScopeFoldersInput = pickerSelectedPath;
    } else if (folderPickerTarget === 'relink') {
      targetMediaFolderInput = pickerSelectedPath;
    } else if (folderPickerTarget === 'edit') {
      editFolderPath = pickerSelectedPath;
      if (!editScopeFoldersInput.trim() || editScopeFoldersInput === editFolderPath) {
        editScopeFoldersInput = pickerSelectedPath;
      }
    }

    showFolderPickerModal = false;
    toast.success(`Selected folder: ${pickerSelectedPath}`);
  }

  function openRelinkModal() {
    targetMediaFolderInput = customMediaFolder || selectedSession || (availableFolders.length > 0 ? availableFolders[0] : '');
    loadAvailableSessions();
    showRelinkModal = true;
  }

  async function handleRelinkFolder() {
    if (!selectedSession || !targetMediaFolderInput.trim()) return;
    relinking = true;
    try {
      await relinkStagingFolder(selectedSession, targetMediaFolderInput.trim());
      toast.success(`Session relinked to ${targetMediaFolderInput.trim()}! Shares and settings adopted.`);
      showRelinkModal = false;
      customMediaFolder = targetMediaFolderInput.trim();
      targetMediaFolderInput = '';
      await triggerReconcile();
    } catch (err: any) {
      toast.error(err.message || 'Failed to relink folder');
    } finally {
      relinking = false;
    }
  }

  async function handleToggleHideStaging() {
    if (!selectedSession) return;
    togglingHide = true;
    try {
      const targetState = !stagingHidden;
      await toggleHideStagingSession(selectedSession, targetState);
      stagingHidden = targetState;
      toast.success(targetState ? 'Staging photos hidden from gallery' : 'Staging photos visible in gallery');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update visibility');
    } finally {
      togglingHide = false;
    }
  }

  async function handlePurgeStaging() {
    if (!selectedSession) return;
    purging = true;
    try {
      const res = await purgeStagingSession(selectedSession);
      toast.success(`Purged staging volume! Deleted ${res.deletedCount} temporary photos.`);
      showPurgeModal = false;
      await Promise.all([loadAvailableSessions(), refreshStats()]);
      reconcileData = null;
    } catch (err: any) {
      toast.error(err.message || 'Failed to purge staging volume');
    } finally {
      purging = false;
    }
  }

  onMount(() => {
    loadInitialData();
    pollTimer = setInterval(() => {
      refreshStats();
      refreshTokens();
    }, 8000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<div class="admin-container">
  <!-- HelloMyPhotos Standard Admin Header -->
  <div class="header">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a 
        href="/admin" 
        title="Back to Admin Dashboard" 
        style="display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; color: rgba(255,255,255,0.4); text-decoration: none; transition: color 0.2s, transform 0.2s;" 
        onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }} 
        onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>FastUp Live Ingest & Staging</h2>
        <p>Photographer OTP pairing, storage metrics, EXIF reconciliation, and staging volume lifecycle.</p>
      </div>
    </div>
    <div style="display: flex; gap: 10px; align-items: center;">
      <button class="btn secondary" onclick={() => { refreshStats(); refreshTokens(); }} title="Refresh metrics">
        <RefreshCw size={18} /> Refresh
      </button>
      <button class="btn primary" onclick={openGenerateOtpModal}>
        <KeyRound size={18} /> Generate Photographer OTP
      </button>
    </div>
  </div>

  <!-- Metric Tabs Navigation -->
  <div class="metric-tabs" role="tablist">
    <button class="metric-tab" class:active={activeTab === 'pairing'} onclick={() => activeTab = 'pairing'} role="tab">
      <Camera size={16} />
      <span>Photographers & OTPs</span>
      {#if tokens.filter(t => t.isActive).length > 0}
        <span class="badge active">{tokens.filter(t => t.isActive).length} Active</span>
      {/if}
    </button>
    <button class="metric-tab" class:active={activeTab === 'stats'} onclick={() => activeTab = 'stats'} role="tab">
      <Cpu size={16} />
      <span>Storage & Pipeline Stats</span>
      {#if stats?.failedJobs && stats.failedJobs.length > 0}
        <span class="badge danger">{stats.failedJobs.length} Failed</span>
      {/if}
    </button>
    <button class="metric-tab" class:active={activeTab === 'reconcile'} onclick={() => activeTab = 'reconcile'} role="tab">
      <HardDrive size={16} />
      <span>EXIF Reconcile & Lifecycle</span>
    </button>
    <button class="metric-tab" class:active={activeTab === 'notice'} onclick={() => activeTab = 'notice'} role="tab">
      <Radio size={16} />
      <span>Live Sync Disclaimer</span>
    </button>
  </div>

  {#if loading}
    <div class="spinner"></div>
  {:else}
    <!-- TAB 1: PAIRING & PHOTOGRAPHERS -->
    {#if activeTab === 'pairing'}
      <div class="tab-pane">
        <div class="card intro-card">
          <div class="intro-icon">
            <KeyRound size={24} color="#c084fc" />
          </div>
          <div>
            <h3 style="margin: 0 0 4px 0; font-size: 1.1rem; color: #f4f4f5;">Multi-Photographer Pairing via 6-Digit Code</h3>
            <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem; line-height: 1.5;">
              No master API keys needed. Generate an isolated 6-digit OTP code for each photographer. When they enter the code in FastUp, the app automatically adopts all pre-configured session settings.
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-title-bar">
            <h3>Connected Photographers ({tokens.length})</h3>
          </div>
          {#if tokens.length === 0}
            <div class="empty-state">
              <Camera size={36} color="#71717a" />
              <p>No photographer connections yet. Click "Generate Photographer OTP" to connect a device.</p>
            </div>
          {:else}
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Photographer</th>
                    <th>Assigned Folder</th>
                    <th>Settings</th>
                    <th>Status</th>
                    <th>Last Seen</th>
                    <th>Token / OTP</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {#each tokens as t}
                    <tr>
                      <td>
                        <div class="user-row">
                          <div class="user-avatar">
                            <UserCheck size={16} />
                          </div>
                          <div>
                            <strong>{t.photographerName}</strong>
                            <div class="muted text-xs">{t.tokenPreview}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                          <span class="tag"><Folder size={12} /> {t.folderPath}</span>
                          {#if t.scopes && t.scopes.length > 0}
                            <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                              <span class="muted text-xs" style="font-size: 0.7rem;">Scope:</span>
                              {#each t.scopes as sc}
                                <span class="badge" style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); color: #93c5fd; font-size: 0.7rem; padding: 1px 5px;">
                                  {sc || '/ (Root)'}
                                </span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      </td>
                      <td>
                        <div class="settings-pill-row">
                          <span class="setting-tag">{t.settings?.uploadFormat === 'RAW_ONLY' ? 'RAW' : t.settings?.uploadFormat === 'RAW_PLUS_JPEG' ? 'RAW+JPG' : 'JPEG'}</span>
                          {#if t.settings?.autoUpload}
                            <span class="setting-tag" title="Auto-upload upon capture">Auto</span>
                          {/if}
                          {#if t.settings?.wifiOnly}
                            <span class="setting-tag" title="Wi-Fi only">Wi-Fi</span>
                          {/if}
                        </div>
                      </td>
                      <td>
                        {#if t.connectionStatus === 'disabled' || !t.isActive}
                          <span class="badge danger"><Power size={12} /> Disabled</span>
                        {:else if t.connectionStatus === 'expired'}
                          <span class="badge danger"><AlertTriangle size={12} /> Session Expired</span>
                        {:else if t.connectionStatus === 'otp_expired'}
                          <span class="badge danger" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171;"><AlertTriangle size={12} /> OTP Expired</span>
                        {:else if t.connectionStatus === 'pending_claim'}
                          <span class="badge info"><KeyRound size={12} /> Pending Claim</span>
                        {:else if t.connectionStatus === 'online'}
                          <span class="badge active"><span class="live-dot"></span> Online</span>
                        {:else}
                          <span class="badge" style="background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);"><Wifi size={12} /> Offline</span>
                        {/if}
                      </td>
                      <td>
                        <span class="muted text-sm">
                          {#if t.lastSeenAt}
                            {formatDateTime(t.lastSeenAt)}
                          {:else}
                            Never
                          {/if}
                        </span>
                      </td>
                      <td>
                        {#if t.otpCode}
                          <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span class="otp-pill {t.isOtpExpired ? 'expired-otp' : ''}">{t.otpCode}</span>
                            {#if t.isOtpExpired}
                              <span class="text-xs" style="color: #f87171;">Expired</span>
                            {:else}
                              <span class="muted text-xs">Unclaimed</span>
                            {/if}
                          </div>
                        {:else}
                          <div style="display: flex; align-items: center; gap: 4px;">
                            <CheckCircle2 size={13} color="#34d399" />
                            <span class="muted text-sm" style="color: #34d399;">Claimed</span>
                          </div>
                        {/if}
                      </td>
                      <td>
                        <div class="action-cell">
                          <button class="btn secondary btn-xs" onclick={() => openEditModal(t)} title="Edit session settings">
                            <Pencil size={12} /> Edit
                          </button>

                          <button 
                            class="btn secondary btn-xs" 
                            onclick={() => handleRefreshOtp(t.id)} 
                            disabled={refreshingOtpId === t.id}
                            title="Regenerate new 6-digit OTP code"
                          >
                            <RefreshCw size={12} class={refreshingOtpId === t.id ? 'spin' : ''} /> Refresh OTP
                          </button>

                          {#if t.isActive}
                            <button 
                              class="btn btn-warn btn-xs" 
                              onclick={() => handleToggleActive(t.id, false)}
                              disabled={togglingTokenId === t.id}
                              title="Disable this session (blocks connection & uploads)"
                            >
                              <Power size={12} /> Disable
                            </button>
                          {:else}
                            <button 
                              class="btn primary btn-xs" 
                              onclick={() => handleToggleActive(t.id, true)}
                              disabled={togglingTokenId === t.id}
                              title="Enable this session"
                            >
                              <Power size={12} /> Enable
                            </button>
                          {/if}

                          <button 
                            class="btn danger btn-xs" 
                            onclick={() => promptRevokeToken(t)}
                            title="Delete session"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- TAB 2: STORAGE & PIPELINE STATS -->
    {#if activeTab === 'stats'}
      <div class="tab-pane">
        <!-- Session Filter Bar -->
        <div class="card" style="padding: 1rem 1.25rem;">
          <div class="session-bar">
            <div class="session-selector">
              <label for="stats-session-pick" style="display: flex; align-items: center; gap: 6px;">
                <Filter size={16} /> <strong>Filter Stats by Session:</strong>
              </label>
              <select 
                id="stats-session-pick" 
                bind:value={statsSessionFilter} 
                onchange={() => refreshStats()} 
                class="form-input" 
                style="max-width: 340px;"
              >
                <option value="">All Sessions (Combined Overview)</option>
                {#if stats?.sessions}
                  {#each stats.sessions as s}
                    <option value={s.folderPath}>
                      {s.folderPath} ({s.fileCount} photos{s.photographerName ? ` • ${s.photographerName}` : ''})
                    </option>
                  {/each}
                {/if}
              </select>
            </div>

            <div class="action-btn-group">
              {#if statsSessionFilter}
                <button class="btn secondary btn-sm" onclick={() => { statsSessionFilter = ''; refreshStats(); }}>
                  Clear Filter
                </button>
                <span class="badge info">Showing: <strong>{statsSessionFilter}</strong></span>
              {:else}
                <span class="muted text-xs">Viewing metrics aggregated across all active sessions</span>
              {/if}
            </div>
          </div>
        </div>

        <!-- KPI Cards Grid using Native KpiCard component (Staging Volume Only) -->
        <div class="kpi-grid">
          <KpiCard 
            icon={HardDrive} 
            color="bg-purple" 
            title={statsSessionFilter ? `Session Staging` : 'Staging Volume'} 
            value={stats ? formatBytes(stats.storage.staging.sizeBytes) : '0 B'} 
            subtitle={statsSessionFilter ? `${stats?.storage.staging.fileCount ?? 0} photos in session "${statsSessionFilter}"` : `${stats?.storage.staging.fileCount ?? 0} photos in live staging`} 
          />
          <KpiCard 
            icon={Activity} 
            color="bg-emerald" 
            title="Upload Activity" 
            value={stats ? `${stats.uploads.uploadsLast24h} Uploads` : '0'} 
            subtitle={statsSessionFilter ? `${stats?.uploads.totalStaged ?? 0} photos in session` : `${stats?.uploads.totalStaged ?? 0} total photos uploaded`} 
          />
          <KpiCard 
            icon={Cpu} 
            color="bg-blue" 
            title="Cache Footprint" 
            value={stats ? formatBytes(stats.storage.cache.sizeBytes) : '0 B'} 
            subtitle="WebP 1080p, 480p & watermarks" 
          />
        </div>

        <!-- Active Sessions Breakdown Card -->
        <div class="card">
          <div class="card-title-bar">
            <div>
              <h3>Active Sessions Breakdown ({stats?.sessions?.length ?? 0})</h3>
              <p class="muted text-xs">Per-session storage, uploads, and processing pipeline progress</p>
            </div>
            {#if statsSessionFilter}
              <button class="btn secondary btn-sm" onclick={() => { statsSessionFilter = ''; refreshStats(); }}>
                Show All Sessions
              </button>
            {/if}
          </div>

          {#if !stats?.sessions || stats.sessions.length === 0}
            <div class="empty-state">
              <Folder size={32} color="#71717a" />
              <p>No active sessions found.</p>
            </div>
          {:else}
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Session Folder</th>
                    <th>Photographer</th>
                    <th>Staged Photos</th>
                    <th>Storage Footprint</th>
                    <th>24h Uploads</th>
                    <th>Thumbnails</th>
                    <th>EXIF</th>
                    <th>Issues</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {#each stats.sessions as s}
                    <tr class={statsSessionFilter === s.folderPath ? 'selected-row' : ''}>
                      <td>
                        <div style="display: flex; align-items: center; gap: 6px;">
                          <Folder size={14} color="#a855f7" />
                          <strong>{s.folderPath}</strong>
                          {#if statsSessionFilter === s.folderPath}
                            <span class="badge active" style="font-size: 0.65rem; padding: 2px 6px;">Filtered</span>
                          {/if}
                        </div>
                      </td>
                      <td>
                        {#if s.photographerName}
                          <span class="text-sm">{s.photographerName}</span>
                          {#if s.isActive}
                            <span class="badge active" style="margin-left: 4px; font-size: 0.65rem;">Active</span>
                          {/if}
                        {:else}
                          <span class="muted text-xs">Unassigned</span>
                        {/if}
                      </td>
                      <td>
                        <strong>{s.fileCount}</strong>
                      </td>
                      <td>
                        <span class="muted text-sm">{formatBytes(s.sizeBytes)}</span>
                      </td>
                      <td>
                        <span class="text-sm">+{s.uploads24h}</span>
                      </td>
                      <td>
                        <span class="text-xs {s.completedThumbs === s.fileCount && s.fileCount > 0 ? 'text-emerald' : 'muted'}">
                          {s.completedThumbs}/{s.fileCount}
                        </span>
                      </td>
                      <td>
                        <span class="text-xs {s.completedExif === s.fileCount && s.fileCount > 0 ? 'text-purple' : 'muted'}">
                          {s.completedExif}/{s.fileCount}
                        </span>
                      </td>
                      <td>
                        {#if s.failedCount > 0}
                          <span class="badge danger">{s.failedCount} Failed</span>
                        {:else}
                          <span class="text-emerald text-xs">None</span>
                        {/if}
                      </td>
                      <td>
                        {#if statsSessionFilter === s.folderPath}
                          <button class="btn secondary btn-xs" onclick={() => { statsSessionFilter = ''; refreshStats(); }}>
                            Reset
                          </button>
                        {:else}
                          <button class="btn secondary btn-xs" onclick={() => { statsSessionFilter = s.folderPath; refreshStats(); }}>
                            Filter Stats
                          </button>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <!-- Processing Health Card -->
        <div class="card">
          <div class="card-title-bar">
            <h3>Live Image Processing Health</h3>
            <span class="muted text-sm">Uploads in last 24h: {stats?.uploads.uploadsLast24h ?? 0}</span>
          </div>

          <div class="pipeline-list">
            <!-- WebP Thumbnails -->
            <div class="pipeline-row">
              <div class="pipeline-info">
                <span>WebP Thumbnails (1080p / 480p)</span>
                <strong>{stats?.pipelines.thumbnails.completed ?? 0} / {stats?.pipelines.thumbnails.total ?? 0}</strong>
              </div>
              <div class="progress-container">
                <div 
                  class="progress-bar bar-emerald" 
                  style="width: {stats?.pipelines.thumbnails.total ? Math.min(100, Math.round(((stats.pipelines.thumbnails.completed || 0) / stats.pipelines.thumbnails.total) * 100)) : 0}%"
                ></div>
              </div>
              <div class="pipeline-meta">
                <span class="muted text-xs">Pending: {stats?.pipelines.thumbnails.pending ?? 0}</span>
                {#if stats?.pipelines.thumbnails.failed}
                  <span class="text-danger text-xs">Failed: {stats.pipelines.thumbnails.failed}</span>
                {/if}
              </div>
            </div>

            <!-- EXIF Metadata -->
            <div class="pipeline-row">
              <div class="pipeline-info">
                <span>EXIF Metadata Extraction</span>
                <strong>{stats?.pipelines.metadata.completed ?? 0} / {stats?.pipelines.metadata.total ?? 0}</strong>
              </div>
              <div class="progress-container">
                <div 
                  class="progress-bar bar-purple" 
                  style="width: {stats?.pipelines.metadata.total ? Math.min(100, Math.round(((stats.pipelines.metadata.completed || 0) / stats.pipelines.metadata.total) * 100)) : 0}%"
                ></div>
              </div>
              <div class="pipeline-meta">
                <span class="muted text-xs">Pending: {stats?.pipelines.metadata.pending ?? 0}</span>
                {#if stats?.pipelines.metadata.failed}
                  <span class="text-danger text-xs">Failed: {stats.pipelines.metadata.failed}</span>
                {/if}
              </div>
            </div>

            <!-- CLIP AI -->
            <div class="pipeline-row">
              <div class="pipeline-info">
                <span>CLIP AI Semantic Embeddings</span>
                <strong>{stats?.pipelines.mlSmartSearch.completed ?? 0} / {stats?.pipelines.mlSmartSearch.total ?? 0}</strong>
              </div>
              <div class="progress-container">
                <div 
                  class="progress-bar bar-blue" 
                  style="width: {stats?.pipelines.mlSmartSearch.total ? Math.min(100, Math.round(((stats.pipelines.mlSmartSearch.completed || 0) / stats.pipelines.mlSmartSearch.total) * 100)) : 0}%"
                ></div>
              </div>
              <div class="pipeline-meta">
                <span class="muted text-xs">Pending: {stats?.pipelines.mlSmartSearch.pending ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Failed Processing Items -->
        {#if stats?.failedJobs && stats.failedJobs.length > 0}
          <div class="card card-danger">
            <div class="card-title-bar">
              <div style="display: flex; align-items: center; gap: 8px;">
                <AlertTriangle size={18} color="#ef4444" />
                <h3 style="color: #ef4444;">Failed Processing Items ({stats.failedJobs.length})</h3>
              </div>
              <button class="btn primary btn-sm" onclick={handleRetryJobs} disabled={retryingJobs}>
                <RefreshCw size={14} class={retryingJobs ? 'spin' : ''} />
                <span>{retryingJobs ? 'Retrying...' : 'Retry All Failed'}</span>
              </button>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Folder</th>
                    <th>File Name</th>
                    <th>Error</th>
                    <th>Attempts</th>
                    <th>Last Attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {#each stats.failedJobs as job}
                    <tr>
                      <td><span class="tag"><Folder size={12} /> {job.folderPath}</span></td>
                      <td><strong>{job.fileName}</strong></td>
                      <td class="text-danger text-sm">{job.error || 'Unknown error'}</td>
                      <td>{job.failedAttempts}</td>
                      <td class="muted text-sm">{formatDateTime(job.updatedAt)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/if}

        <!-- Live Transfer Status (Recent Staging Uploads) -->
        <div class="card">
          <div class="card-title-bar">
            <div>
              <h3>Live Transfer Status (Recent Staging Uploads)</h3>
              <p class="muted text-xs">Live stream of captured camera frames uploaded to the staging pipeline</p>
            </div>
            <button class="btn secondary btn-sm" onclick={refreshStats}>
              <RefreshCw size={13} class={loading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>

          {#if !stats?.transferLogs || stats.transferLogs.length === 0}
            <div class="empty-state">
              <UploadCloud size={32} color="#71717a" />
              <p>No staging transfers recorded yet. Captured photos from FastUp will appear here.</p>
            </div>
          {:else}
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>Session / Folder</th>
                    <th>Size</th>
                    <th>Transfer & Processing Status</th>
                    <th>Transferred At</th>
                  </tr>
                </thead>
                <tbody>
                  {#each stats.transferLogs as transfer}
                    <tr>
                      <td>
                        <div class="file-name-cell">
                          <strong>{transfer.fileName}</strong>
                          <span class="muted text-xs">{transfer.mimeType}</span>
                        </div>
                      </td>
                      <td>
                        <span class="tag"><Folder size={12} /> {transfer.folderPath}</span>
                      </td>
                      <td>
                        <span class="muted text-sm">{formatBytes(transfer.sizeBytes)}</span>
                      </td>
                      <td>
                        {#if transfer.status === 'completed'}
                          <span class="badge active">
                            <CheckCircle2 size={12} /> {transfer.statusLabel}
                          </span>
                        {:else if transfer.status === 'failed'}
                          <span class="badge danger">
                            <AlertTriangle size={12} /> {transfer.statusLabel}
                          </span>
                        {:else}
                          <span class="badge info">
                            <RefreshCw size={12} class="spin" /> {transfer.statusLabel}
                          </span>
                        {/if}
                      </td>
                      <td>
                        <span class="muted text-sm">
                          {formatDateTime(transfer.createdAt)}
                        </span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <!-- Photographer Connection & Pairing Log -->
        <div class="card">
          <div class="card-title-bar">
            <div>
              <h3>Photographer Connection & Pairing Log</h3>
              <p class="muted text-xs">Recent handshake, OTP pairing, and tethering session connection events</p>
            </div>
          </div>

          {#if !stats?.connectionLogs || stats.connectionLogs.length === 0}
            <div class="empty-state">
              <Activity size={32} color="#71717a" />
              <p>No connection events recorded yet. Connect a photographer via OTP code to record events.</p>
            </div>
          {:else}
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Event Type</th>
                    <th>Photographer</th>
                    <th>Target Folder</th>
                    <th>IP Address</th>
                    <th>Status</th>
                    <th>Logged At</th>
                  </tr>
                </thead>
                <tbody>
                  {#each stats.connectionLogs as log}
                    <tr>
                      <td>
                        {#if log.eventType === 'pairing'}
                          <span class="badge purple">
                            <KeyRound size={12} /> Pairing (OTP Claimed)
                          </span>
                        {:else}
                          <span class="badge info">
                            <Wifi size={12} /> Tether Connection
                          </span>
                        {/if}
                      </td>
                      <td>
                        <div class="user-row">
                          <div class="user-avatar">
                            <UserCheck size={16} />
                          </div>
                          <div>
                            <strong>{log.photographerName}</strong>
                          </div>
                        </div>
                      </td>
                      <td>
                        {#if log.folderPath}
                          <span class="tag"><Folder size={12} /> {log.folderPath}</span>
                        {:else}
                          <span class="muted text-sm">—</span>
                        {/if}
                      </td>
                      <td>
                        <code class="ip-pill">{log.ipAddress || 'Internal'}</code>
                      </td>
                      <td>
                        {#if log.status === 'success' || log.status === 'active'}
                          <span class="badge active"><Check size={12} /> Active / OK</span>
                        {:else}
                          <span class="badge danger">{log.status}</span>
                        {/if}
                      </td>
                      <td>
                        <span class="muted text-sm">
                          {formatDateTime(log.createdAt)}
                        </span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- TAB 3: EXIF RECONCILE & LIFECYCLE -->
    {#if activeTab === 'reconcile'}
      <div class="tab-pane">
        <!-- Session Selector Card -->
        <div class="card">
          <div class="session-bar">
            <div class="session-selector">
              <label for="session-pick">Select Staging Event Session:</label>
              <select id="session-pick" bind:value={selectedSession} onchange={triggerReconcile} class="form-input" style="max-width: 320px;">
                {#if availableSessions.length === 0}
                  <option value="">No staging sessions found</option>
                {:else}
                  {#each availableSessions as s}
                    <option value={s}>{s}</option>
                  {/each}
                {/if}
              </select>
            </div>

            <div class="action-btn-group">
              <button class="btn secondary" onclick={openRelinkModal}>
                <Link2 size={16} /> Relink Folder
              </button>

              <button 
                class="btn {stagingHidden ? 'btn-warn' : 'secondary'}" 
                onclick={handleToggleHideStaging} 
                disabled={togglingHide || !selectedSession}
              >
                {#if stagingHidden}
                  <EyeOff size={16} /> Staging Hidden
                {:else}
                  <Eye size={16} /> Staging Visible
                {/if}
              </button>

              <button class="btn danger" onclick={() => showPurgeModal = true} disabled={!selectedSession}>
                <Trash2 size={16} /> Purge Staging
              </button>
            </div>
          </div>
        </div>

        {#if reconcileLoading}
          <div class="spinner"></div>
        {:else if reconcileData}
          <!-- Reconcile Match Score Card -->
          <div class="card reconcile-score-card">
            <div class="score-circle">
              <div class="score-percent">{reconcileData.matchPercentage}%</div>
              <div class="score-text">MATCHED</div>
            </div>
            <div class="score-info">
              <h3>{reconcileData.matchedCount} of {reconcileData.stagingCount} Live Photos Matched in Media Volume</h3>
              <p class="muted">
                Permanent Media Folder: <strong>/app/media/{reconcileData.targetMediaFolder}</strong>
              </p>
              {#if reconcileData.unmatchedStaging.length === 0}
                <div class="status-box box-success">
                  <Check size={18} />
                  <span>All live staging photos have been matched in the media volume! It is safe to purge staging.</span>
                </div>
              {:else}
                <div class="status-box box-warning">
                  <AlertTriangle size={18} />
                  <span>
                    {reconcileData.unmatchedStaging.length} photos have not yet been uploaded or matched in the media volume.
                  </span>
                </div>
              {/if}
            </div>
          </div>

          <!-- Unmatched Photos List -->
          {#if reconcileData.unmatchedStaging.length > 0}
            <div class="card">
              <div class="card-title-bar">
                <div>
                  <h3>Unmatched Live Staging Photos ({reconcileData.unmatchedStaging.length})</h3>
                  <span class="muted text-sm">Photos pending final export</span>
                </div>
              </div>
              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>EXIF DateTime</th>
                      <th>Camera Model</th>
                      <th>File Size</th>
                      <th>Uploaded At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each reconcileData.unmatchedStaging as u}
                      <tr>
                        <td><strong>{u.fileName}</strong></td>
                        <td class="muted">{u.dateTimeOriginal ? formatDateTime(u.dateTimeOriginal) : 'N/A'}</td>
                        <td>{u.model || 'Sony Alpha'}</td>
                        <td>{formatBytes(u.sizeBytes)}</td>
                        <td class="muted text-sm">{formatDateTime(u.createdAt)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}

          <!-- Matched Pairs Preview -->
          {#if reconcileData.matchedPairs.length > 0}
            <div class="card">
              <div class="card-title-bar">
                <h3>Matched Pairs Preview ({reconcileData.matchedPairs.length})</h3>
                <span class="muted text-sm">Matched via EXIF timestamp & camera model</span>
              </div>
              <div class="pair-grid">
                {#each reconcileData.matchedPairs.slice(0, 12) as pair}
                  <div class="pair-tile">
                    <div class="pair-col">
                      <span class="pair-label">Live Staging</span>
                      <span class="pair-name">{pair.stagingFileName}</span>
                    </div>
                    <ArrowRight size={14} color="#71717a" />
                    <div class="pair-col">
                      <span class="pair-label">Final Media</span>
                      <span class="pair-name">{pair.mediaFileName}</span>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- TAB 4: LIVE SYNC DISCLAIMER & NOTICE -->
    {#if activeTab === 'notice'}
      <div class="tab-pane">
        <div class="card" style="padding: 1.5rem;">
          <div class="card-header" style="margin-bottom: 1.25rem;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="background: rgba(168, 85, 247, 0.15); padding: 8px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                <Radio size={20} color="#a855f7" />
              </div>
              <div>
                <h3 style="margin: 0; font-size: 1.15rem; color: #f3e8ff;">Live Staging Disclaimer & Notice Banner</h3>
                <p style="margin: 2px 0 0 0; font-size: 0.85rem; color: #a1a1aa;">
                  Configure the realtime notice banner displayed to visitors viewing folders currently receiving live tether syncs via FastUp.
                </p>
              </div>
            </div>
          </div>

          <form onsubmit={handleSaveNotice} style="display: flex; flex-direction: column; gap: 1.25rem;">
            <!-- Enabled toggle -->
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none;">
              <input type="checkbox" bind:checked={noticeEnabled} style="width: 18px; height: 18px; accent-color: #a855f7;" />
              <span style="font-weight: 500; color: #f1f5f9; font-size: 0.95rem;">Enable Live Staging Notice Banner</span>
            </label>

            <!-- Title input -->
            <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
              <label for="notice-title" style="font-size: 0.875rem; font-weight: 500; color: #cbd5e1;">Banner Title</label>
              <input 
                id="notice-title"
                type="text" 
                bind:value={noticeTitle} 
                class="form-control" 
                placeholder="Realtime Photo Sync in Progress"
                style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 10px 14px; color: white; font-size: 0.95rem;"
              />
            </div>

            <!-- Message input -->
            <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
              <label for="notice-message" style="font-size: 0.875rem; font-weight: 500; color: #cbd5e1;">Disclaimer Text / Paragraph</label>
              <textarea 
                id="notice-message"
                bind:value={noticeMessage} 
                rows="4" 
                class="form-control" 
                placeholder="Note that the photos in this app are being synced in realtime and are not filtered or edited yet. Please return during a later time for the final images. Any enquiries about these photos, you may contact the photographer."
                style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 10px 14px; color: white; font-size: 0.92rem; resize: vertical; line-height: 1.5;"
              ></textarea>
              <span style="font-size: 0.78rem; color: #94a3b8;">
                This disclaimer explains that live photos are unedited and subject to change before final delivery.
              </span>
            </div>

            <!-- Live Client Preview -->
            <div style="margin-top: 0.5rem;">
              <div style="font-size: 0.85rem; font-weight: 600; color: #cbd5e1; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;">
                Visitor Preview (Folder & Album View)
              </div>
              <div style="padding: 16px; background: rgba(0,0,0,0.4); border: 1px dashed rgba(255,255,255,0.15); border-radius: 10px;">
                <div style="display: flex; align-items: flex-start; gap: 12px; padding: 14px 18px; background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(59, 130, 246, 0.06) 100%); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 12px; opacity: {noticeEnabled ? 1 : 0.4};">
                  <div style="display: flex; align-items: center; justify-content: center; padding: 6px; background: rgba(168, 85, 247, 0.15); border-radius: 8px; flex-shrink: 0;">
                    <Radio size={20} color="#a855f7" />
                  </div>
                  <div style="display: flex; flex-direction: column; gap: 4px;">
                    <h4 style="margin: 0; font-size: 0.95rem; font-weight: 600; color: #f3e8ff;">{noticeTitle || 'Realtime Photo Sync in Progress'}</h4>
                    <p style="margin: 0; font-size: 0.85rem; line-height: 1.45; color: #d1d5db;">{noticeMessage || 'No disclaimer message configured.'}</p>
                  </div>
                </div>
                {#if !noticeEnabled}
                  <div style="text-align: center; margin-top: 8px; font-size: 0.78rem; color: #f87171;">
                    (Notice banner is currently disabled and will not be displayed to visitors)
                  </div>
                {/if}
              </div>
            </div>

            <!-- Actions -->
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 0.5rem;">
              <button 
                type="submit" 
                class="btn primary" 
                disabled={savingNotice}
                style="padding: 10px 20px; font-size: 0.95rem; display: inline-flex; align-items: center; gap: 8px;"
              >
                {#if savingNotice}
                  <RefreshCw size={16} class="spinning" /> Saving...
                {:else}
                  <Check size={16} /> Save Disclaimer Settings
                {/if}
              </button>
            </div>
          </form>
        </div>
      </div>
    {/if}
  {/if}
</div>

<!-- NATIVE MODAL: GENERATE PHOTOGRAPHER OTP -->
<Modal id="generate-otp-modal" bind:show={showOtpModal} title="Generate Photographer OTP">
  {#if generatedOtp}
    <div class="otp-view">
      <p class="muted">Share this 6-digit OTP code with the photographer:</p>
      <div class="otp-box" onclick={copyCode} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && copyCode()}>
        <span class="otp-digits">{generatedOtp.slice(0, 3)} {generatedOtp.slice(3)}</span>
        <button class="icon-action-btn" title="Copy code">
          {#if copied}
            <Check size={20} color="#10b981" />
          {:else}
            <Copy size={20} />
          {/if}
        </button>
      </div>
      <p class="muted text-sm" style="line-height: 1.5; margin-bottom: 1.5rem;">
        In the FastUp Android app, go to <strong>Settings &rarr; Pair with HelloMyPhotos</strong> and enter this 6-digit code.
      </p>
      <div class="modal-footer">
        <button class="btn primary" onclick={() => showOtpModal = false}>Done</button>
      </div>
    </div>
  {:else}
    <form onsubmit={handleCreateOtp}>
      <div class="form-group">
        <label for="p-name">Photographer Name / Label *</label>
        <input 
          id="p-name" 
          type="text" 
          bind:value={photogName} 
          placeholder="e.g. Alice - Main Stage" 
          class="form-input" 
          required 
        />
      </div>

      <div class="form-group">
        <label for="folder-pick">Default Session Folder Path *</label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input 
            id="folder-pick" 
            type="text" 
            bind:value={folderPath} 
            placeholder="e.g. weddings/2026-11-22-john" 
            class="form-input" 
            style="flex: 1;"
            oninput={() => {
              if (!scopeFoldersInput.trim() || scopeFoldersInput === folderPath) {
                scopeFoldersInput = folderPath;
              }
            }}
            required 
          />
          <button 
            type="button" 
            class="btn secondary" 
            onclick={() => openFolderPickerModal('otp', folderPath)}
            title="Browse & select folder directory"
          >
            <Folder size={16} /> Browse...
          </button>
        </div>
        <p class="muted text-xs" style="margin-top: 4px;">Initial folder selected on FastUp upon pairing.</p>
      </div>

      <div class="form-group">
        <label for="scope-folders">Allowed Scope Folders (Read / Write Permissions) *</label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input 
            id="scope-folders" 
            type="text" 
            bind:value={scopeFoldersInput} 
            placeholder="e.g. weddings/2026-11-22-john (or comma-separated scopes)" 
            class="form-input" 
            style="flex: 1;"
            required 
          />
          <button 
            type="button" 
            class="btn secondary" 
            onclick={() => openFolderPickerModal('otp_scope', scopeFoldersInput)}
            title="Browse & select scope folder"
          >
            <Folder size={16} /> Browse...
          </button>
        </div>
        <p class="muted text-xs" style="margin-top: 4px;">
          FastUp can <strong>ONLY</strong> view, select, and create subfolders inside this scope. Parent folders up to Root are visible for navigation, but cannot be selected or written to.
        </p>
      </div>

      <div class="form-group">
        <label for="server-url">Target Server URL (Optional)</label>
        <input 
          id="server-url" 
          type="text" 
          bind:value={customServerUrl} 
          placeholder="e.g. http://192.168.1.100:8000 (leave blank to keep phone's setting)" 
          class="form-input" 
        />
        <p class="muted text-xs" style="margin-top: 4px;">Leave blank if testing on localhost so the Android phone preserves its own entered LAN IP / domain.</p>
      </div>

      <div class="form-row">
        <div class="form-group" style="flex: 1;">
          <label for="p-dur">Validity Duration</label>
          <select id="p-dur" bind:value={validityHours} class="form-input">
            <option value={2}>2 Hours</option>
            <option value={6}>6 Hours</option>
            <option value={12}>12 Hours</option>
            <option value={24}>24 Hours (1 Day)</option>
            <option value={72}>3 Days</option>
            <option value={168}>7 Days</option>
          </select>
        </div>

        <div class="form-group" style="flex: 1;">
          <label for="p-fmt">Upload Format</label>
          <select id="p-fmt" bind:value={uploadFormat} class="form-input">
            <option value="JPEG_ONLY">JPEG Only (Faster)</option>
            <option value="RAW_ONLY">RAW Only (.ARW)</option>
            <option value="RAW_PLUS_JPEG">RAW + JPEG</option>
          </select>
        </div>
      </div>

      <div class="checkbox-group">
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={autoUpload} />
          <span>Auto-Upload upon capture</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={wifiOnly} />
          <span>Wi-Fi Only mode</span>
        </label>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn secondary" onclick={() => showOtpModal = false}>Cancel</button>
        <button type="submit" class="btn primary" disabled={creatingOtp}>
          {creatingOtp ? 'Generating...' : 'Generate 6-Digit Code'}
        </button>
      </div>
    </form>
  {/if}
</Modal>

<!-- NATIVE MODAL: EDIT PHOTOGRAPHER SESSION -->
<Modal id="edit-session-modal" bind:show={showEditModal} title="Edit Photographer Session">
  <form onsubmit={handleSaveEdit}>
    <div class="form-group">
      <label for="edit-p-name">Photographer Name / Label *</label>
      <input 
        id="edit-p-name" 
        type="text" 
        bind:value={editPhotogName} 
        placeholder="e.g. John Doe (Lead Photographer)" 
        required 
        class="form-input" 
      />
    </div>

    <div class="form-group">
      <label for="edit-folder-pick">Default Session Folder Path *</label>
      <div style="display: flex; gap: 8px; align-items: center;">
        <input 
          id="edit-folder-pick" 
          type="text" 
          bind:value={editFolderPath} 
          class="form-input" 
          style="flex: 1;" 
          required
        />
        <button 
          type="button" 
          class="btn secondary" 
          onclick={() => openFolderPickerModal('edit', editFolderPath)}
          title="Browse & select folder directory"
        >
          <Folder size={16} /> Browse...
        </button>
      </div>
      <p class="muted text-xs" style="margin-top: 4px;">Initial folder selected on FastUp upon pairing.</p>
    </div>

    <div class="form-group">
      <label for="edit-scope-folders">Allowed Scope Folders (Read / Write Permissions) *</label>
      <div style="display: flex; gap: 8px; align-items: center;">
        <input 
          id="edit-scope-folders" 
          type="text" 
          bind:value={editScopeFoldersInput} 
          placeholder="e.g. weddings/2026-11-22-john (or comma-separated scopes)"
          class="form-input" 
          style="flex: 1;" 
          required
        />
        <button 
          type="button" 
          class="btn secondary" 
          onclick={() => openFolderPickerModal('edit_scope', editScopeFoldersInput)}
          title="Browse & select scope folder"
        >
          <Folder size={16} /> Browse...
        </button>
      </div>
      <p class="muted text-xs" style="margin-top: 4px;">
        FastUp can <strong>ONLY</strong> view, select, and create subfolders inside this scope. Parent folders up to Root are visible for navigation, but cannot be selected or written to.
      </p>
    </div>

    <div class="form-row">
      <div class="form-group" style="flex: 1;">
        <label for="edit-p-dur">Extend Expiration</label>
        <select id="edit-p-dur" bind:value={editValidityHours} class="form-input">
          <option value={2}>+2 Hours</option>
          <option value={6}>+6 Hours</option>
          <option value={12}>+12 Hours</option>
          <option value={24}>+24 Hours (1 Day)</option>
          <option value={72}>+3 Days</option>
          <option value={168}>+7 Days</option>
        </select>
      </div>

      <div class="form-group" style="flex: 1;">
        <label for="edit-p-fmt">Upload Format</label>
        <select id="edit-p-fmt" bind:value={editUploadFormat} class="form-input">
          <option value="JPEG_ONLY">JPEG Only (Faster)</option>
          <option value="RAW_ONLY">RAW Only (.ARW)</option>
          <option value="RAW_PLUS_JPEG">RAW + JPEG</option>
        </select>
      </div>
    </div>

    <div class="checkbox-group">
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={editAutoUpload} />
        <span>Auto-Upload upon capture</span>
      </label>
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={editWifiOnly} />
        <span>Wi-Fi Only mode</span>
      </label>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn secondary" onclick={() => showEditModal = false}>Cancel</button>
      <button type="submit" class="btn primary" disabled={savingEdit}>
        {savingEdit ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  </form>
</Modal>

<!-- NATIVE MODAL: RELINK FOLDER -->
<Modal id="relink-modal" bind:show={showRelinkModal} title="Relink Staging Session">
  <p class="muted text-sm" style="line-height: 1.5; margin-bottom: 1rem;">
    Relinking transfers and adopts all <strong>folder cover photos</strong>, <strong>descriptions</strong>, and <strong>active public share links</strong> to the new target folder path in the permanent media library.
  </p>

  <div class="form-group">
    <label for="relink-folder-input">Target Media Folder Path *</label>
    <div style="display: flex; gap: 8px; align-items: center;">
      <input 
        id="relink-folder-input" 
        type="text" 
        bind:value={targetMediaFolderInput} 
        placeholder="e.g. weddings/2026-11-22-final-edited" 
        class="form-input" 
        style="flex: 1;" 
        required
      />
      <button 
        type="button" 
        class="btn secondary" 
        onclick={() => openFolderPickerModal('relink', targetMediaFolderInput)}
        title="Browse & select folder directory"
      >
        <Folder size={16} /> Browse...
      </button>
    </div>
    <p class="muted text-xs" style="margin-top: 4px;">Click <strong>Browse...</strong> to navigate directories and select the target folder.</p>
  </div>

  <div class="modal-footer">
    <button type="button" class="btn secondary" onclick={() => showRelinkModal = false}>Cancel</button>
    <button type="button" class="btn primary" onclick={handleRelinkFolder} disabled={relinking || !targetMediaFolderInput.trim()}>
      {relinking ? 'Relinking...' : 'Relink & Adopt All Settings'}
    </button>
  </div>
</Modal>

<!-- NATIVE MODAL: DIRECTORY FOLDER SELECTOR (DRILL-DOWN & RADIO SELECTION) -->
<Modal id="folder-picker-modal" bind:show={showFolderPickerModal} title="Select Directory Folder">
  <p class="muted text-sm" style="line-height: 1.4; margin-bottom: 0.85rem;">
    Browse directories, enter subfolders, and select your destination folder via the radio button.
  </p>

  <!-- Breadcrumbs & Navigation Bar -->
  <div class="breadcrumb-nav">
    <button 
      type="button" 
      class="breadcrumb-btn" 
      class:active={pickerCurrentPath === ''} 
      onclick={() => navigateToBreadcrumb('')}
    >
      Root
    </button>
    {#if pickerCurrentPath}
      {#each getBreadcrumbSegments(pickerCurrentPath) as seg}
        <span class="breadcrumb-sep">/</span>
        <button 
          type="button" 
          class="breadcrumb-btn" 
          class:active={seg.fullPath === pickerCurrentPath} 
          onclick={() => navigateToBreadcrumb(seg.fullPath)}
        >
          {seg.name}
        </button>
      {/each}
    {/if}

    {#if pickerCurrentPath}
      <button 
        type="button" 
        class="btn secondary btn-xs" 
        style="margin-left: auto;" 
        onclick={goUpPickerTree}
        title="Go up one folder level"
      >
        <CornerLeftUp size={12} /> Up
      </button>
    {/if}
  </div>

  <!-- Search Filter -->
  <div style="margin-bottom: 10px;">
    <div style="position: relative;">
      <input 
        type="text" 
        bind:value={pickerSearch} 
        placeholder="Filter folders in this directory..." 
        class="form-input" 
        style="padding-left: 2rem; font-size: 0.85rem;"
      />
      <div style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); pointer-events: none; color: #71717a;">
        <Search size={14} />
      </div>
    </div>
  </div>

  <!-- Option: Select Current Folder (if inside a directory) -->
  {#if pickerCurrentPath}
    <label class="current-folder-banner">
      <input 
        type="radio" 
        name="folder-picker-radio" 
        value={pickerCurrentPath} 
        checked={pickerSelectedPath === pickerCurrentPath}
        onchange={() => pickerSelectedPath = pickerCurrentPath} 
      />
      <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
        <Folder size={18} color="#a855f7" />
        <div>
          <strong style="color: #f1f5f9; font-size: 0.88rem;">Select current folder: /{pickerCurrentPath}</strong>
          <span class="muted text-xs" style="display: block;">Use this parent directory as the target</span>
        </div>
      </div>
    </label>
  {/if}

  <!-- Subfolders List with Radio Buttons & Drill-Down -->
  <div class="folder-tree-container">
    {#if pickerSubfolders.length === 0}
      <div style="padding: 1.5rem; text-align: center; color: #71717a;">
        <Folder size={28} style="margin: 0 auto 6px auto; opacity: 0.5;" />
        <p class="text-xs" style="margin: 0;">No subdirectories found in <strong>/{pickerCurrentPath || 'Root'}</strong></p>
      </div>
    {:else}
      {#each pickerSubfolders as item}
        <div class="folder-tree-row {pickerSelectedPath === item.fullPath ? 'selected-folder-row' : ''}">
          <label class="folder-radio-label">
            <input 
              type="radio" 
              name="folder-picker-radio" 
              value={item.fullPath} 
              checked={pickerSelectedPath === item.fullPath}
              onchange={() => pickerSelectedPath = item.fullPath} 
            />
            <Folder size={16} color={pickerSelectedPath === item.fullPath ? '#a855f7' : '#94a3b8'} />
            <span class="folder-name-text">{item.name}</span>
          </label>

          <button 
            type="button" 
            class="btn secondary btn-xs enter-folder-btn" 
            onclick={() => enterPickerFolder(item.fullPath)}
            title="Open folder to see subfolders"
          >
            <span>Open</span>
            <ChevronRight size={13} />
          </button>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Inline Create Subfolder Inside Current Path -->
  <div class="picker-create-section">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
      <span class="text-xs muted">
        Create new subfolder inside <strong>/{pickerCurrentPath || 'Root'}</strong>:
      </span>
    </div>
    <div style="display: flex; gap: 8px;">
      <input 
        type="text" 
        bind:value={newPickerSubfolderName} 
        placeholder="Subfolder name (e.g. reception)" 
        class="form-input" 
        style="flex: 1; font-size: 0.85rem;" 
        onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCreatePickerSubfolder())}
      />
      <button 
        type="button" 
        class="btn primary btn-sm" 
        onclick={handleCreatePickerSubfolder} 
        disabled={creatingPickerSubfolder || !newPickerSubfolderName.trim()}
      >
        {creatingPickerSubfolder ? 'Creating...' : '+ Create & Select'}
      </button>
    </div>
  </div>

  <!-- Modal Footer -->
  <div class="modal-footer">
    <button type="button" class="btn secondary" onclick={() => showFolderPickerModal = false}>Cancel</button>
    <button 
      type="button" 
      class="btn primary" 
      onclick={confirmFolderPickerSelection} 
      disabled={!pickerSelectedPath.trim()}
    >
      <Check size={16} /> Select This Folder
    </button>
  </div>
</Modal>

<!-- NATIVE MODAL: PURGE STAGING CONFIRMATION -->
<Modal id="purge-modal" bind:show={showPurgeModal} title="Purge Staging Volume">
  <div style="display: flex; gap: 12px; align-items: flex-start; margin-bottom: 1rem;">
    <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); padding: 8px; border-radius: 8px; color: #ef4444; flex-shrink: 0;">
      <AlertTriangle size={24} />
    </div>
    <div>
      <h4 style="margin: 0 0 4px 0; color: #ef4444; font-size: 1.05rem;">Delete Live Staging Photos?</h4>
      <p class="muted text-sm" style="margin: 0; line-height: 1.5;">
        Are you sure you want to purge the live staging files for <strong>{selectedSession}</strong>?
      </p>
    </div>
  </div>

  {#if reconcileData && reconcileData.unmatchedStaging.length > 0}
    <div class="status-box box-danger" style="margin-bottom: 1rem;">
      <AlertTriangle size={18} />
      <span>
        Warning: <strong>{reconcileData.unmatchedStaging.length} photos</strong> have not yet been matched in the permanent media volume. Purging now will delete them permanently.
      </span>
    </div>
  {/if}

  <p class="muted text-xs" style="line-height: 1.4; margin-bottom: 1.5rem;">
    This unlinks database records, deletes cached thumbnails, and frees storage space on the server.
  </p>

  <div class="modal-footer">
    <button type="button" class="btn secondary" onclick={() => showPurgeModal = false}>Cancel</button>
    <button type="button" class="btn danger" onclick={handlePurgeStaging} disabled={purging}>
      {purging ? 'Purging Volume...' : 'Yes, Purge Staging'}
    </button>
  </div>
</Modal>

<!-- Revoke Session Confirmation Modal -->
<Modal id="revoke-session-modal" bind:show={showRevokeModal} title="Revoke Photographer Session">
  <div style="padding: 0.5rem 0 1rem 0;">
    <p style="color: #cbd5e1; margin-bottom: 1rem; line-height: 1.5; font-size: 0.95rem;">
      Are you sure you want to permanently delete and revoke the session for
      <strong style="color: #fff; font-weight: 600;">{revokingTokenName || 'this photographer'}</strong>?
    </p>
    <div class="status-box box-danger" style="margin-bottom: 1rem;">
      <AlertTriangle size={18} />
      <span>
        FastUp app using this session will be immediately disconnected and blocked from uploading.
      </span>
    </div>
  </div>
  <div class="modal-footer">
    <button type="button" class="btn secondary" onclick={() => { showRevokeModal = false; revokingTokenId = null; }}>Cancel</button>
    <button type="button" class="btn danger" onclick={confirmRevokeToken} disabled={isRevoking}>
      {isRevoking ? 'Revoking...' : 'Permanently Revoke'}
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
    flex-wrap: wrap;
    gap: 1rem;
  }

  h2 {
    font-size: 2rem;
    margin: 0 0 0.5rem 0;
  }

  p {
    color: #a1a1aa;
    margin: 0;
  }

  /* Metric Tabs matching HelloMyPhotos Analytics tabs */
  .metric-tabs {
    display: flex;
    gap: 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--glass-border);
    padding: 4px;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .metric-tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: 1px solid transparent;
    color: #a1a1aa;
    padding: 8px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    transition: all 0.2s;
  }

  .metric-tab:hover {
    color: white;
    background: rgba(255, 255, 255, 0.05);
  }

  .metric-tab.active {
    background: rgba(168, 85, 247, 0.2);
    color: #c084fc;
    border-color: rgba(168, 85, 247, 0.4);
  }

  .tab-pane {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* HelloMyPhotos Native Card */
  .card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 1.5rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }

  .card-danger {
    border-color: rgba(239, 68, 68, 0.3);
  }

  .intro-card {
    display: flex;
    gap: 16px;
    align-items: center;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(99, 102, 241, 0.08));
    border-color: rgba(168, 85, 247, 0.25);
  }

  .intro-icon {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    background: rgba(168, 85, 247, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .card-title-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
  }

  .card-title-bar h3 {
    margin: 0;
    font-size: 1.15rem;
    color: #f4f4f5;
  }

  /* KPI Grid */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  /* Table styles matching admin/users */
  .table-container {
    overflow-x: auto;
    margin: 0 -1.5rem -1.5rem -1.5rem;
    padding: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
  }

  th {
    padding: 0.85rem 1rem;
    font-size: 0.85rem;
    color: #a1a1aa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  th:first-child, td:first-child {
    padding-left: 1.5rem;
  }

  th:last-child, td:last-child {
    padding-right: 1.5rem;
  }

  td {
    padding: 0.85rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    vertical-align: middle;
  }

  tr:last-child td {
    border-bottom: none;
  }

  .user-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .user-avatar {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    background: rgba(168, 85, 247, 0.15);
    color: #c084fc;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.8rem;
    color: #e4e4e7;
    font-family: monospace;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .badge.active {
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #34d399;
    box-shadow: 0 0 6px #34d399;
    display: inline-block;
    animation: livePulse 2s infinite ease-in-out;
  }

  @keyframes livePulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.8); }
  }

  .expired-otp {
    text-decoration: line-through;
    opacity: 0.6;
    border-color: rgba(239, 68, 68, 0.4) !important;
    color: #f87171 !important;
  }

  .badge.danger {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .badge.info {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .badge.purple {
    background: rgba(168, 85, 247, 0.15);
    color: #c084fc;
    border: 1px solid rgba(168, 85, 247, 0.3);
  }

  .badge.warn {
    background: rgba(245, 158, 11, 0.15);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .file-name-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ip-pill {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.78rem;
    color: #a1a1aa;
    font-family: monospace;
  }

  .action-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .settings-pill-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .setting-tag {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.72rem;
    color: #cbd5e1;
    font-family: monospace;
    font-weight: 500;
  }

  .otp-pill {
    font-family: monospace;
    font-size: 1rem;
    font-weight: 700;
    color: #c084fc;
    letter-spacing: 0.1em;
  }

  /* Buttons matching HelloMyPhotos native button styles */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0.6rem 1.2rem;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .btn.primary {
    background: #a855f7;
    color: white;
  }
  .btn.primary:hover:not(:disabled) {
    background: #9333ea;
  }

  .btn.secondary {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
    color: #e4e4e7;
  }
  .btn.secondary:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .btn.danger {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }
  .btn.danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.25);
  }

  .btn.btn-warn {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.3);
    color: #f59e0b;
  }

  .btn-sm {
    padding: 0.4rem 0.8rem;
    font-size: 0.82rem;
  }

  .btn-xs {
    padding: 0.25rem 0.6rem;
    font-size: 0.78rem;
  }

  .text-link-btn {
    background: transparent;
    border: none;
    color: #a855f7;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }
  .text-link-btn:hover {
    text-decoration: underline;
  }

  /* Pipelines */
  .pipeline-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .pipeline-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .pipeline-info {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
  }

  .progress-container {
    height: 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    transition: width 0.3s ease;
  }

  .bar-emerald { background: #10b981; }
  .bar-purple { background: #a855f7; }
  .bar-blue { background: #3b82f6; }

  .pipeline-meta {
    display: flex;
    justify-content: space-between;
  }

  /* Session selector bar */
  .session-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .session-selector {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .session-selector label {
    font-size: 0.9rem;
    color: #e4e4e7;
  }

  .action-btn-group {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  /* Reconcile score card */
  .reconcile-score-card {
    display: flex;
    align-items: center;
    gap: 2rem;
  }

  .score-circle {
    width: 110px;
    height: 110px;
    border-radius: 50%;
    background: rgba(16, 185, 129, 0.1);
    border: 3px solid #10b981;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .score-percent {
    font-size: 1.8rem;
    font-weight: 800;
    color: #f4f4f5;
  }

  .score-text {
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #34d399;
  }

  .score-info h3 {
    margin: 0 0 6px 0;
    font-size: 1.25rem;
  }

  /* Status boxes */
  .status-box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 8px;
    margin-top: 10px;
    font-size: 0.88rem;
  }

  .box-success {
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: #34d399;
  }

  .box-warning {
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: #fbbf24;
  }

  .box-danger {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #f87171;
  }

  /* Pair preview tiles */
  .pair-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }

  .pair-tile {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .pair-col {
    display: flex;
    flex-direction: column;
    max-width: 44%;
  }

  .pair-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    color: #a1a1aa;
    letter-spacing: 0.05em;
  }

  .pair-name {
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Form controls matching HelloMyPhotos modals */
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }

  .form-group label {
    font-size: 0.85rem;
    color: #e4e4e7;
    font-weight: 500;
  }

  .form-input {
    width: 100%;
    padding: 0.6rem 0.8rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: white;
    border-radius: 6px;
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
  }

  .form-input:focus {
    border-color: #a855f7;
  }

  .form-row {
    display: flex;
    gap: 12px;
  }

  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 0 16px 0;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.88rem;
    color: #e4e4e7;
    cursor: pointer;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 1.5rem;
  }

  /* OTP Code Display */
  .otp-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 0.5rem 0;
  }

  .otp-box {
    display: flex;
    align-items: center;
    gap: 14px;
    background: rgba(168, 85, 247, 0.1);
    border: 2px dashed #a855f7;
    border-radius: 12px;
    padding: 1rem 2rem;
    margin: 1rem 0;
    cursor: pointer;
  }

  .otp-digits {
    font-family: monospace;
    font-size: 2.2rem;
    font-weight: 800;
    letter-spacing: 0.15em;
    color: #c084fc;
  }

  .icon-action-btn {
    background: transparent;
    border: none;
    color: #a1a1aa;
    cursor: pointer;
    display: flex;
  }

  .spinner {
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top: 3px solid #a855f7;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    animation: spin 1s linear infinite;
    margin: 3rem auto;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3rem 1rem;
    text-align: center;
    color: #71717a;
    gap: 8px;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .muted { color: #a1a1aa; }
  .text-danger { color: #ef4444; }
  .text-emerald { color: #10b981; }
  .text-purple { color: #a855f7; }
  .text-sm { font-size: 0.85rem; }
  .text-xs { font-size: 0.75rem; }
  .selected-row {
    background: rgba(168, 85, 247, 0.08) !important;
  }

  /* Folder Picker Modal */
  .breadcrumb-nav {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    margin-bottom: 10px;
  }

  .breadcrumb-btn {
    background: none;
    border: none;
    color: #cbd5e1;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
  }
  .breadcrumb-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  .breadcrumb-btn.active {
    color: #c084fc;
    font-weight: 600;
  }

  .breadcrumb-sep {
    color: #64748b;
    font-size: 0.8rem;
  }

  .current-folder-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: rgba(168, 85, 247, 0.08);
    border: 1px solid rgba(168, 85, 247, 0.25);
    border-radius: 8px;
    margin-bottom: 10px;
    cursor: pointer;
    user-select: none;
  }
  .current-folder-banner input[type="radio"] {
    accent-color: #a855f7;
    width: 16px;
    height: 16px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .folder-tree-container {
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    background: rgba(18, 18, 22, 0.5);
    margin-bottom: 10px;
  }

  .folder-tree-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition: background 0.15s;
  }
  .folder-tree-row:last-child {
    border-bottom: none;
  }
  .folder-tree-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .folder-tree-row.selected-folder-row {
    background: rgba(168, 85, 247, 0.12);
  }

  .folder-radio-label {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    cursor: pointer;
    font-size: 0.88rem;
    color: #f1f5f9;
    user-select: none;
    overflow: hidden;
  }
  .folder-radio-label input[type="radio"] {
    accent-color: #a855f7;
    width: 16px;
    height: 16px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .folder-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .enter-folder-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px 8px;
    font-size: 0.78rem;
    flex-shrink: 0;
  }

  .picker-create-section {
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    margin-bottom: 12px;
  }

  @media (max-width: 900px) {
    h2 { font-size: 1.5rem; }
    .header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .header > div:last-child { flex-wrap: wrap; }
    .card { padding: 1rem; }
  }
</style>
