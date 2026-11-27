<script lang="ts">
import { slide } from 'svelte/transition';

  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import CoverImage from '$lib/components/CoverImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, getPreviewUrl, getStreamUrl, setFolderCover, getFolderZipUrl, setFolderDescription, rescanFolder, rescanFolderML, regenerateImages, regenerateVideos, regenerateFolderWatermarks, searchFolderContent, toggleFavorite, type MediaFile, type DirectoryInfo } from '$lib/api/media';
  import { computeCoverObjectPosition } from '$lib/utils/cover';
  import { getSortDate, getRawDate } from '$lib/utils/date';
  import { createShare, getActiveShares, revokeShare, updateShare, getAccessRequests, respondAccessRequest, getWatermarkTemplatesForShare, type ShareData, type AccessRequest, type WatermarkTemplateOption } from '$lib/api/shares';
  import { formatShareDate, isShareExpired, getNearestExpiryDuration } from '$lib/utils/shareUtils';
  import { invalidateAll, goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import type { PageData } from './$types';
  import Modal from '$lib/components/Modal.svelte';
  import ZipDownloadModal from '$lib/components/ZipDownloadModal.svelte';
  import { currentUser } from '$lib/stores/auth';
  import { updatePreferences } from '$lib/api/auth';
  import { ChevronLeft, ArrowDownUp, LayoutGrid, Download, Share2, Settings, Check, Copy, Trash2, Clock, MoreVertical, Folder, User, BarChart3, Power, Calendar, Mail, RefreshCw, AlertCircle, Pencil, List, Image as ImageIcon, Film, Search, X, Loader2, Sparkles, Layers, Cloud, ExternalLink, FolderPlus, Pause, Play, QrCode, Unlink, Radio, Heart, SlidersHorizontal, RotateCcw, Minimize2, Shield, Lock, Key, Eye, EyeOff, Tag } from '@lucide/svelte';
  import { generateNaturalPassword } from '$lib/utils/passwordGenerator';
  import { clickOutside } from '$lib/actions/clickOutside';
  import { getFolderGDriveSync, enableFolderGDriveSync, triggerFolderGDriveSync, togglePauseFolderGDriveSync, disableFolderGDriveSync, listGoogleAccounts, listGoogleDriveFolders, getCaesiumSettings, updateFolderCaesiumSettings, updateFolderWatermarkSettings, type FolderSyncInfo, type GoogleAccount, type CaesiumConfig } from '$lib/api/gdrive';
  import QRCode from 'qrcode';
  
  let { data }: { data: PageData } = $props();

  let isStagedFolder = $derived(Boolean((data as any).isStagedFolder || data.files?.some((f: any) => f.is_staged)));
  let stagingNotice = $derived((data as any).stagingNotice || (isStagedFolder ? {
    enabled: true,
    title: 'Realtime Photo Sync in Progress',
    message: 'Note that the photos in this app are being synced in realtime and are not filtered or edited yet. Please return during a later time for the final images. Any enquiries about these photos, you may contact the photographer.'
  } : null));
  let isRefreshingLiveSync = $state(false);

  async function handleRefreshLiveSync() {
    isRefreshingLiveSync = true;
    try {
      const { invalidateAll } = await import('$app/navigation');
      await invalidateAll();
    } catch {} finally {
      setTimeout(() => { isRefreshingLiveSync = false; }, 600);
    }
  }
  
  // Settings Modal State
  let folderDescInput = $state('');
  let isSavingSettings = $state(false);

  // Google Drive Sync State
  let gdriveSyncInfo = $state<FolderSyncInfo | null>(null);
  let gdriveAccounts = $state<GoogleAccount[]>([]);
  let selectedGDriveAccount = $state('');
  let gdriveFolderNameInput = $state('');
  let isGDriveLoading = $state(false);
  let isEnablingGDrive = $state(false);
  let isSyncingNowGDrive = $state(false);
  let isDeletingGDrive = $state(false);
  let gdriveActiveTab: 'sync' | 'new' = $state('sync');
  let gdriveCopied = $state(false);

  // Caesium Image Compression State
  let caesiumSettings = $state<{ isAvailable: boolean; version?: string; binaryPath?: string; defaultConfig: CaesiumConfig } | null>(null);
  let caesiumEnabled = $state(true);
  let caesiumMode = $state<'lossy' | 'lossless' | 'max_size'>('lossy');
  let caesiumQuality = $state(80);
  let caesiumMaxSize = $state('1MB');
  let caesiumWidth = $state<number | null>(null);
  let caesiumHeight = $state<number | null>(null);
  let caesiumKeepExif = $state(true);
  let caesiumSaveAsDefault = $state(true);

  // Active sync Caesium editing state
  let isEditingCaesium = $state(false);
  let editCaesiumEnabled = $state(false);
  let editCaesiumMode = $state<'lossy' | 'lossless' | 'max_size'>('lossy');
  let editCaesiumQuality = $state(80);
  let editCaesiumMaxSize = $state('1MB');
  let editCaesiumWidth = $state<number | null>(null);
  let editCaesiumHeight = $state<number | null>(null);
  let editCaesiumKeepExif = $state(true);
  let editCaesiumSaveAsDefault = $state(false);
  let isSavingCaesium = $state(false);

  // Google Drive Watermark State
  let gdriveWatermarkTemplateId = $state<string>('');
  let isEditingGDriveWatermark = $state(false);
  let editGDriveWatermarkTemplateId = $state<string>('');
  let isSavingGDriveWatermark = $state(false);

  // Folder Google Drive QR Code Modal State
  let showGDriveQrModal = $state(false);
  let gdriveQrDataUrl = $state<string | null>(null);
  let isGeneratingGDriveQr = $state(false);

  async function openGDriveQrModal(link: string) {
    showGDriveQrModal = true;
    isGeneratingGDriveQr = true;
    try {
      gdriveQrDataUrl = await QRCode.toDataURL(link, {
        width: 320,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
    } catch {
      gdriveQrDataUrl = null;
    } finally {
      isGeneratingGDriveQr = false;
    }
  }

  // Remote Drive folder selection
  let gdriveMode = $state<'new' | 'existing'>('new');
  let remoteDriveFolders = $state<Array<{ id: string; name: string }>>([]);
  let selectedExistingDriveFolderId = $state('');
  let isLoadingRemoteFolders = $state(false);
  let remoteFolderSearch = $state('');

  async function loadRemoteDriveFolders(accId: string) {
    if (!accId) return;
    isLoadingRemoteFolders = true;
    try {
      remoteDriveFolders = await listGoogleDriveFolders(accId);
      if (remoteDriveFolders.length > 0 && !selectedExistingDriveFolderId) {
        selectedExistingDriveFolderId = remoteDriveFolders[0].id;
      }
    } catch (e: any) {
      console.warn('Failed to load remote Google Drive folders:', e.message);
    } finally {
      isLoadingRemoteFolders = false;
    }
  }

  let filteredRemoteDriveFolders = $derived(
    remoteDriveFolders.filter(f => f.name.toLowerCase().includes(remoteFolderSearch.toLowerCase()))
  );

  async function loadGDriveSync() {
    if (!data.folderPath) return;
    isGDriveLoading = true;
    try {
      const srcType = isStagedFolder ? 'FASTUP' : 'MEDIA';
      const [syncData, accounts, caesiumInfo] = await Promise.all([
        getFolderGDriveSync(data.folderPath, srcType),
        listGoogleAccounts().catch(() => []),
        getCaesiumSettings().catch(() => null)
      ]);
      gdriveSyncInfo = syncData;
      gdriveAccounts = accounts;
      if (caesiumInfo) {
        caesiumSettings = caesiumInfo;
      }
      if (accounts.length > 0 && !selectedGDriveAccount) {
        selectedGDriveAccount = accounts[0].id;
      }
      if (!gdriveFolderNameInput) {
        gdriveFolderNameInput = data.folderPath.split('/').pop() || data.folderPath;
      }
      if (selectedGDriveAccount) {
        loadRemoteDriveFolders(selectedGDriveAccount);
      }

      if (watermarkTemplates.length === 0) {
        getWatermarkTemplatesForShare().then(wData => {
          watermarkTemplates = wData.templates || [];
          shareGlobalEnforced = Boolean(wData.globalEnforced);
          const gTpl = watermarkTemplates.find(t => t.id === wData.globalTemplateId);
          shareGlobalTemplateName = gTpl?.name || 'Default';
          if (shareGlobalEnforced && wData.globalTemplateId) {
            shareWatermarkTemplateId = wData.globalTemplateId;
            gdriveWatermarkTemplateId = wData.globalTemplateId;
          }
        }).catch(() => {});
      }

      if (syncData.synced && syncData.sync) {
        editGDriveWatermarkTemplateId = syncData.sync.watermark_template_id || '';
        editCaesiumEnabled = syncData.sync.caesium_enabled ?? false;
        const cfg = (syncData.sync.caesium_config || {}) as Partial<CaesiumConfig>;
        editCaesiumMode = cfg.mode || 'lossy';
        editCaesiumQuality = cfg.quality ?? 80;
        editCaesiumMaxSize = cfg.max_size || '1MB';
        editCaesiumWidth = cfg.width ?? null;
        editCaesiumHeight = cfg.height ?? null;
        editCaesiumKeepExif = cfg.keep_exif ?? true;
      } else if (caesiumInfo?.defaultConfig) {
        // Pre-fill parameters with remembered defaults for zero-friction recycling
        const def = caesiumInfo.defaultConfig;
        caesiumEnabled = def.enabled ?? true;
        caesiumMode = def.mode || 'lossy';
        caesiumQuality = def.quality ?? 80;
        caesiumMaxSize = def.max_size || '1MB';
        caesiumWidth = def.width ?? null;
        caesiumHeight = def.height ?? null;
        caesiumKeepExif = def.keep_exif ?? true;
      }
    } catch (e: any) {
      console.warn('Could not load GDrive sync info:', e.message);
    } finally {
      isGDriveLoading = false;
    }
  }

  function applyRememberedDefaultsForNew() {
    if (!caesiumSettings?.defaultConfig) return;
    const def = caesiumSettings.defaultConfig;
    caesiumEnabled = def.enabled ?? true;
    caesiumMode = def.mode || 'lossy';
    caesiumQuality = def.quality ?? 80;
    caesiumMaxSize = def.max_size || '1MB';
    caesiumWidth = def.width ?? null;
    caesiumHeight = def.height ?? null;
    caesiumKeepExif = def.keep_exif ?? true;
    toast.success('Applied remembered Caesium parameters');
  }

  function applyRememberedDefaultsForEdit() {
    if (!caesiumSettings?.defaultConfig) return;
    const def = caesiumSettings.defaultConfig;
    editCaesiumEnabled = def.enabled ?? true;
    editCaesiumMode = def.mode || 'lossy';
    editCaesiumQuality = def.quality ?? 80;
    editCaesiumMaxSize = def.max_size || '1MB';
    editCaesiumWidth = def.width ?? null;
    editCaesiumHeight = def.height ?? null;
    editCaesiumKeepExif = def.keep_exif ?? true;
    toast.success('Applied remembered Caesium parameters');
  }

  async function handleSaveCaesiumSettings() {
    if (!data.folderPath || !gdriveSyncInfo?.sync) return;
    isSavingCaesium = true;
    try {
      const srcType = isStagedFolder ? 'FASTUP' : 'MEDIA';
      const config: CaesiumConfig = {
        enabled: editCaesiumEnabled,
        mode: editCaesiumMode,
        quality: editCaesiumQuality,
        max_size: editCaesiumMaxSize,
        width: editCaesiumWidth,
        height: editCaesiumHeight,
        keep_exif: editCaesiumKeepExif,
        keep_dates: true
      };

      const res = await updateFolderCaesiumSettings({
        folderPath: data.folderPath,
        sourceType: srcType,
        caesiumEnabled: editCaesiumEnabled,
        caesiumConfig: config,
        saveAsDefault: editCaesiumSaveAsDefault
      });

      if (gdriveSyncInfo.sync) {
        gdriveSyncInfo.sync.caesium_enabled = res.sync.caesium_enabled;
        gdriveSyncInfo.sync.caesium_config = res.sync.caesium_config;
      }
      if (editCaesiumSaveAsDefault && caesiumSettings) {
        caesiumSettings.defaultConfig = config;
      }
      isEditingCaesium = false;
      toast.success('Caesium compression settings updated!');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update Caesium settings');
    } finally {
      isSavingCaesium = false;
    }
  }

  async function handleSaveGDriveWatermarkSettings() {
    if (!data.folderPath || !gdriveSyncInfo?.sync) return;
    isSavingGDriveWatermark = true;
    try {
      const srcType = isStagedFolder ? 'FASTUP' : 'MEDIA';
      const isWatermarked = shareGlobalEnforced || Boolean(editGDriveWatermarkTemplateId);
      const res = await updateFolderWatermarkSettings({
        folderPath: data.folderPath,
        sourceType: srcType,
        watermarkEnabled: isWatermarked,
        watermarkTemplateId: editGDriveWatermarkTemplateId || null
      });

      if (gdriveSyncInfo.sync) {
        gdriveSyncInfo.sync.watermark_enabled = res.sync.watermark_enabled;
        gdriveSyncInfo.sync.watermark_template_id = res.sync.watermark_template_id;
        const matchedTpl = watermarkTemplates.find(t => t.id === res.sync.watermark_template_id);
        gdriveSyncInfo.sync.watermark_template_name = matchedTpl?.name || (res.sync.watermark_enabled ? 'Default Template' : null);
      }
      isEditingGDriveWatermark = false;
      toast.success('Watermark settings updated for Google Drive sync!');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update watermark settings');
    } finally {
      isSavingGDriveWatermark = false;
    }
  }

  async function handleEnableGDriveSync() {
    if (!selectedGDriveAccount) {
      toast.error('Please select a Google Account');
      return;
    }
    if (gdriveMode === 'existing' && !selectedExistingDriveFolderId) {
      toast.error('Please select an existing Google Drive folder');
      return;
    }
    isEnablingGDrive = true;
    try {
      const srcType = isStagedFolder ? 'FASTUP' : 'MEDIA';
      const config: CaesiumConfig = {
        enabled: caesiumEnabled,
        mode: caesiumMode,
        quality: caesiumQuality,
        max_size: caesiumMaxSize,
        width: caesiumWidth,
        height: caesiumHeight,
        keep_exif: caesiumKeepExif,
        keep_dates: true
      };

      const isWatermarked = shareGlobalEnforced || Boolean(gdriveWatermarkTemplateId);
      const res = await enableFolderGDriveSync({
        accountId: selectedGDriveAccount,
        folderPath: data.folderPath || '',
        sourceType: srcType,
        folderName: gdriveMode === 'new' ? (gdriveFolderNameInput || (data.folderPath || 'Photos')) : undefined,
        existingFolderId: gdriveMode === 'existing' ? selectedExistingDriveFolderId : undefined,
        caesiumEnabled,
        caesiumConfig: config,
        saveAsDefault: caesiumSaveAsDefault,
        watermarkEnabled: isWatermarked,
        watermarkTemplateId: gdriveWatermarkTemplateId || null
      });
      gdriveSyncInfo = { synced: true, sync: res.sync };
      if (caesiumSaveAsDefault && caesiumSettings) {
        caesiumSettings.defaultConfig = config;
      }
      toast.success('Google Drive sync enabled! Link generated.');
    } catch (e: any) {
      toast.error(e.message || 'Failed to enable Google Drive sync');
    } finally {
      isEnablingGDrive = false;
    }
  }

  let isTogglingPause = $state(false);

  async function handleTogglePauseGDriveSync() {
    if (!data.folderPath || !gdriveSyncInfo?.sync) return;
    const isPaused = gdriveSyncInfo.sync.sync_status === 'PAUSED';
    isTogglingPause = true;
    try {
      const srcType = isStagedFolder ? 'FASTUP' : 'MEDIA';
      const res = await togglePauseFolderGDriveSync(data.folderPath, srcType, !isPaused);
      if (gdriveSyncInfo?.sync) {
        gdriveSyncInfo.sync.sync_status = res.sync.sync_status;
        gdriveSyncInfo.sync.is_active = res.sync.is_active;
      }
      toast.success(isPaused ? 'Google Drive sync resumed' : 'Google Drive sync paused');
    } catch (e: any) {
      toast.error(e.message || 'Failed to toggle sync state');
    } finally {
      isTogglingPause = false;
    }
  }

  async function handleTriggerGDriveSync() {
    if (!data.folderPath) return;
    isSyncingNowGDrive = true;
    try {
      const srcType = isStagedFolder ? 'FASTUP' : 'MEDIA';
      await triggerFolderGDriveSync(data.folderPath, srcType);
      toast.success('Sync queued with Google Drive');
      loadGDriveSync();
    } catch (e: any) {
      toast.error(e.message || 'Failed to trigger sync');
    } finally {
      isSyncingNowGDrive = false;
    }
  }

  // Delete & Unlink Handlers
  let showUnlinkGDriveModal = $state(false);
  let showDeleteGDriveModal = $state(false);

  function handleUnlinkGDriveSync() {
    showUnlinkGDriveModal = true;
  }

  async function confirmUnlinkGDriveSync() {
    showUnlinkGDriveModal = false;
    try {
      const srcType = isStagedFolder ? 'FASTUP' : 'MEDIA';
      await disableFolderGDriveSync(data.folderPath || '', srcType, false);
      gdriveSyncInfo = { synced: false };
      toast.success('Google Drive sync unlinked');
    } catch (e: any) {
      toast.error(e.message || 'Failed to unlink sync');
    }
  }

  function handleDeleteGDriveFolder() {
    showDeleteGDriveModal = true;
  }

  async function confirmDeleteGDriveFolder() {
    showDeleteGDriveModal = false;
    isDeletingGDrive = true;
    try {
      const srcType = isStagedFolder ? 'FASTUP' : 'MEDIA';
      await disableFolderGDriveSync(data.folderPath || '', srcType, true);
      gdriveSyncInfo = { synced: false };
      toast.success('Google Drive folder deleted permanently');
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete Google Drive folder');
    } finally {
      isDeletingGDrive = false;
    }
  }

  // Share Modal State
  let shareAllowDownloadImages = $state(true);
  let shareAllowDownloadFolder = $state(true);
  let shareAllowFavorites = $state(false);
  let shareAllowFilterFavorites = $state(false);
  let shareLabel = $state('');
  let sharePassword = $state('');
  let showSharePassword = $state(false);
  let shareExpiryMode: 'duration' | 'date' | 'never' = $state('duration');
  let shareExpiryValue = $state(7);
  let shareExpiryUnit = $state('days');
  let shareExpiryDateTime = $state('');
  let watermarkTemplates = $state<WatermarkTemplateOption[]>([]);
  let shareWatermarkTemplateId = $state<string>('');
  let shareGlobalEnforced = $state(false);
  let shareGlobalTemplateName = $state('');

  let shareActiveTab: 'links' | 'requests' = $state('links');
  let shareLinksSubTab: 'active' | 'expired' = $state('active');

  let allShares: ShareData[] = $state([]);
  let activeSharesList = $derived(allShares.filter(s => !isShareExpired(s.expires_at)));
  let expiredSharesList = $derived(allShares.filter(s => isShareExpired(s.expires_at)));

  let accessRequests: AccessRequest[] = $state([]);
  let pendingRequestsCount = $derived(accessRequests.filter(r => r.status === 'pending').length);

  // Extending expired share state
  let extendingToken = $state<string | null>(null);
  let extendExpiryMode: 'duration' | 'date' = $state('duration');
  let extendExpiryValue = $state(7);
  let extendExpiryUnit = $state('days');
  let extendExpiryDateTime = $state('');
  let isExtending = $state(false);

  // Editing share state
  let editingShareToken = $state<string | null>(null);
  let editExpiryMode: 'duration' | 'date' | 'never' = $state('duration');
  let editExpiryValue = $state(7);
  let editExpiryUnit = $state('days');
  let editExpiryDateTime = $state('');
  let editAllowDownloadImages = $state(true);
  let editAllowDownloadFolder = $state(true);
  let editAllowFavorites = $state(false);
  let editAllowFilterFavorites = $state(false);
  let editSharePassword = $state('');
  let editRemovePassword = $state(false);
  let showEditSharePassword = $state(false);
  let editIsActive = $state(true);
  let editShareLabel = $state('');
  let editCreatedAtDateTime = $state('');
  let isSavingShareEdit = $state(false);

  function handleGenerateSharePassword() {
    sharePassword = generateNaturalPassword(3);
    showSharePassword = true;
  }

  function handleGenerateEditSharePassword() {
    editSharePassword = generateNaturalPassword(3);
    editRemovePassword = false;
    showEditSharePassword = true;
  }

  // Access request response state
  let respondingRequestId = $state<string | null>(null);
  let requestAction: 'extend' | 'new_link' = $state('extend');
  let requestNotifyUser = $state(true);
  let requestExpiryMode: 'duration' | 'date' | 'never' = $state('duration');
  let requestExpiryValue = $state(7);
  let requestExpiryUnit = $state('days');
  let requestExpiryDateTime = $state('');
  let isRespondingRequest = $state(false);

  let isCreatingShare = $state(false);
  let newlyCreatedShareToken = $state<string | null>(null);
  let copiedToken = $state<string | null>(null);
  let localCoverOverride: string | null = $state(null);

  // Search state
  let isSearchOpen = $state(false);
  let searchQuery = $state('');
  let isSearching = $state(false);
  let isSearchLoading = $state(false);
  let searchFiles: MediaFile[] = $state([]);
  let searchDirectories: DirectoryInfo[] = $state([]);
  let searchInputEl: HTMLInputElement | undefined = $state();
  let searchDebounceTimer: any = null;
  let searchAbortController: AbortController | null = null;

  async function executeSearch(queryText: string) {
    const trimmed = queryText.trim();
    if (!trimmed) {
      isSearching = false;
      isSearchLoading = false;
      searchFiles = [];
      searchDirectories = [];
      return;
    }

    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();

    isSearchLoading = true;
    isSearching = true;

    try {
      const res = await searchFolderContent(data.folderPath || '', trimmed, fetch, searchAbortController.signal);
      searchFiles = res.files || [];
      searchDirectories = res.directories || [];
      visibleCount = 50;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to search folder:', err);
      }
    } finally {
      isSearchLoading = false;
    }
  }

  function handleSearchInput() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (!searchQuery.trim()) {
      isSearching = false;
      searchFiles = [];
      searchDirectories = [];
      return;
    }
    searchDebounceTimer = setTimeout(() => {
      executeSearch(searchQuery);
    }, 300);
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      executeSearch(searchQuery);
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  }

  function toggleSearch() {
    isSearchOpen = !isSearchOpen;
    if (isSearchOpen) {
      setTimeout(() => {
        searchInputEl?.focus();
      }, 50);
    } else {
      closeSearch();
    }
  }

  function clearSearch() {
    searchQuery = '';
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (searchAbortController) searchAbortController.abort();
    isSearching = false;
    isSearchLoading = false;
    searchFiles = [];
    searchDirectories = [];
    searchInputEl?.focus();
  }

  function closeSearch() {
    isSearchOpen = false;
    clearSearch();
  }

  // Initialize input state when data changes
  let previousPath = $state(data.folderPath);
  let hasShownHostError = $state(false);
  $effect(() => {
    folderDescInput = data.folderDescription || '';
    if (data.folderPath !== previousPath) {
      closeSearch();
      localCoverOverride = null;
      visibleCount = 50; // Reset scroll on path change
      previousPath = data.folderPath;
      hasShownHostError = false;
      toast.clear();
      if (data.hostError) {
        toast.error(`Storage Error: ${data.hostError}`);
        hasShownHostError = true;
      } else if (data.isProcessing) {
        toast.info('This folder is still being processed. Some items might be missing or slow to load. Feel free to come back later!', 8000);
      }
    } else if (data.hostError && !hasShownHostError) {
      toast.error(`Storage Error: ${data.hostError}`);
      hasShownHostError = true;
    }
  });

  $effect(() => {
    if (showShareModal) {
      loadAllSharesAndRequests();
      newlyCreatedShareToken = null;
      extendingToken = null;
      editingShareToken = null;
      respondingRequestId = null;
    }
  });

  async function loadAllSharesAndRequests() {
    try {
      const folder = data.folderPath || '';
      const [shares, requests, wData] = await Promise.all([
        getActiveShares(folder),
        getAccessRequests(folder).catch(() => []),
        getWatermarkTemplatesForShare().catch(() => ({ templates: [], globalEnforced: false, globalTemplateId: null }))
      ]);
      allShares = shares;
      accessRequests = requests;
      watermarkTemplates = wData.templates || [];
      shareGlobalEnforced = Boolean(wData.globalEnforced);
      const gTpl = watermarkTemplates.find(t => t.id === wData.globalTemplateId);
      shareGlobalTemplateName = gTpl?.name || 'Default';
      if (shareGlobalEnforced && wData.globalTemplateId) {
        shareWatermarkTemplateId = wData.globalTemplateId;
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreateShare() {
    try {
      isCreatingShare = true;
      let expiresAt: string | null = null;
      if (shareExpiryMode === 'duration' && shareExpiryValue > 0) {
        const date = new Date();
        if (shareExpiryUnit === 'hours') {
          date.setHours(date.getHours() + shareExpiryValue);
        } else if (shareExpiryUnit === 'days') {
          date.setDate(date.getDate() + shareExpiryValue);
        } else if (shareExpiryUnit === 'months') {
          date.setMonth(date.getMonth() + shareExpiryValue);
        } else if (shareExpiryUnit === 'years') {
          date.setFullYear(date.getFullYear() + shareExpiryValue);
        }
        expiresAt = date.toISOString();
      } else if (shareExpiryMode === 'date' && shareExpiryDateTime) {
        expiresAt = new Date(shareExpiryDateTime).toISOString();
      }
      
      const isWatermarked = shareGlobalEnforced || Boolean(shareWatermarkTemplateId);
      const token = await createShare(
        data.folderPath || '',
        null,
        shareAllowDownloadImages,
        shareAllowDownloadFolder,
        isWatermarked,
        expiresAt,
        shareWatermarkTemplateId || null,
        shareAllowFavorites,
        sharePassword.trim() || null,
        shareLabel.trim() || null,
        null,
        shareAllowFilterFavorites
      );
      toast.success('Share link created successfully!');
      newlyCreatedShareToken = token;
      sharePassword = '';
      shareLabel = '';
      await loadAllSharesAndRequests();
    } catch (e) {
      console.error(e);
      toast.error('Failed to create share');
    } finally {
      isCreatingShare = false;
    }
  }

  async function handleToggleShareActive(share: ShareData) {
    try {
      const currentActive = share.is_active ?? true;
      const newActive = !currentActive;
      await updateShare(share.share_token, { isActive: newActive });
      toast.success(newActive ? 'Share link enabled' : 'Share link disabled (temporary)');
      await loadAllSharesAndRequests();
    } catch (e) {
      console.error(e);
      toast.error('Failed to update share link');
    }
  }

  async function handleExtendShare(token: string) {
    try {
      isExtending = true;
      let newExpiresAt: string | null = null;
      if (extendExpiryMode === 'duration' && extendExpiryValue > 0) {
        const date = new Date();
        if (extendExpiryUnit === 'hours') {
          date.setHours(date.getHours() + extendExpiryValue);
        } else if (extendExpiryUnit === 'days') {
          date.setDate(date.getDate() + extendExpiryValue);
        } else if (extendExpiryUnit === 'months') {
          date.setMonth(date.getMonth() + extendExpiryValue);
        } else if (extendExpiryUnit === 'years') {
          date.setFullYear(date.getFullYear() + extendExpiryValue);
        }
        newExpiresAt = date.toISOString();
      } else if (extendExpiryMode === 'date' && extendExpiryDateTime) {
        newExpiresAt = new Date(extendExpiryDateTime).toISOString();
      }

      if (!newExpiresAt) {
        toast.error('Please specify a valid expiration time');
        return;
      }

      await updateShare(token, { expiresAt: newExpiresAt, isActive: true });
      toast.success('Share link validity extended!');
      extendingToken = null;
      await loadAllSharesAndRequests();
    } catch (e) {
      console.error(e);
      toast.error('Failed to extend validity');
    } finally {
      isExtending = false;
    }
  }

  function toDateTimeLocal(d: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function startEditingShare(share: ShareData) {
    if (editingShareToken === share.share_token) {
      editingShareToken = null;
      return;
    }
    editingShareToken = share.share_token;
    extendingToken = null;
    editAllowDownloadImages = share.allow_download_images ?? true;
    editAllowDownloadFolder = share.allow_download_folder ?? true;
    editAllowFavorites = share.allow_favorites ?? false;
    editAllowFilterFavorites = share.allow_filter_favorites ?? false;
    editIsActive = share.is_active !== false;
    editShareLabel = share.label || '';
    editCreatedAtDateTime = share.created_at ? toDateTimeLocal(new Date(share.created_at)) : '';
    editSharePassword = '';
    editRemovePassword = false;
    showEditSharePassword = false;

    if (!share.expires_at) {
      editExpiryMode = 'never';
      editExpiryValue = 7;
      editExpiryUnit = 'days';
      editExpiryDateTime = '';
    } else {
      const expDate = new Date(share.expires_at);
      if (expDate <= new Date()) {
        editExpiryMode = 'duration';
        editExpiryValue = 7;
        editExpiryUnit = 'days';
        const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        editExpiryDateTime = toDateTimeLocal(future);
      } else {
        editExpiryMode = 'date';
        editExpiryDateTime = toDateTimeLocal(expDate);
        editExpiryValue = 7;
        editExpiryUnit = 'days';
      }
    }
  }

  async function handleSaveShareEdit(token: string) {
    try {
      isSavingShareEdit = true;
      let finalExpiresAt: string | null = null;
      if (editExpiryMode === 'duration' && editExpiryValue > 0) {
        const d = new Date();
        if (editExpiryUnit === 'hours') d.setHours(d.getHours() + editExpiryValue);
        else if (editExpiryUnit === 'days') d.setDate(d.getDate() + editExpiryValue);
        else if (editExpiryUnit === 'months') d.setMonth(d.getMonth() + editExpiryValue);
        else if (editExpiryUnit === 'years') d.setFullYear(d.getFullYear() + editExpiryValue);
        finalExpiresAt = d.toISOString();
      } else if (editExpiryMode === 'date' && editExpiryDateTime) {
        finalExpiresAt = new Date(editExpiryDateTime).toISOString();
      } else if (editExpiryMode === 'never') {
        finalExpiresAt = null;
      }

      await updateShare(token, {
        expiresAt: finalExpiresAt,
        allowDownloadImages: editAllowDownloadImages,
        allowDownloadFolder: editAllowDownloadFolder,
        allowFavorites: editAllowFavorites,
        allowFilterFavorites: editAllowFilterFavorites,
        isActive: editIsActive,
        password: editSharePassword.trim() || undefined,
        removePassword: editRemovePassword || undefined,
        label: editShareLabel.trim() || null,
        createdAt: editCreatedAtDateTime ? new Date(editCreatedAtDateTime).toISOString() : undefined
      });

      toast.success('Share link parameters updated!');
      editingShareToken = null;
      await loadAllSharesAndRequests();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to update share parameters');
    } finally {
      isSavingShareEdit = false;
    }
  }

  async function handleRespondRequest(req: AccessRequest) {
    try {
      isRespondingRequest = true;
      let expiresAt: string | null = null;
      if (requestExpiryMode === 'duration' && requestExpiryValue > 0) {
        const date = new Date();
        if (requestExpiryUnit === 'hours') {
          date.setHours(date.getHours() + requestExpiryValue);
        } else if (requestExpiryUnit === 'days') {
          date.setDate(date.getDate() + requestExpiryValue);
        } else if (requestExpiryUnit === 'months') {
          date.setMonth(date.getMonth() + requestExpiryValue);
        } else if (requestExpiryUnit === 'years') {
          date.setFullYear(date.getFullYear() + requestExpiryValue);
        }
        expiresAt = date.toISOString();
      } else if (requestExpiryMode === 'date' && requestExpiryDateTime) {
        expiresAt = new Date(requestExpiryDateTime).toISOString();
      } else if (requestExpiryMode === 'never') {
        expiresAt = null;
      }

      await respondAccessRequest(req.id, {
        action: requestAction === 'extend' ? 'extend' : 'new_link',
        expiresAt,
        notifyUser: requestNotifyUser && Boolean(req.email)
      });

      toast.success(requestNotifyUser && req.email 
        ? 'Access granted and requester notified via email!' 
        : 'Access granted successfully!');
      respondingRequestId = null;
      await loadAllSharesAndRequests();
    } catch (e) {
      console.error(e);
      toast.error('Failed to grant access');
    } finally {
      isRespondingRequest = false;
    }
  }

  async function handleRevokeShare(token: string) {
    revokeTargetToken = token;
    showRevokeConfirm = true;
  }

  async function confirmRevokeShare() {
    try {
      await revokeShare(revokeTargetToken);
      await loadAllSharesAndRequests();
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to revoke share');
    } finally {
      showRevokeConfirm = false;
      revokeTargetToken = '';
    }
  }

  async function copyShareLink(token: string) {
    const domain = (import.meta.env.PUBLIC_APP_DOMAIN as string) || window.location.origin;
    const url = `${domain}/share/${token}`;
    const success = await copyToClipboard(url);
    if (success) {
      toast.success('Link copied to clipboard!');
      copiedToken = token;
      setTimeout(() => {
        if (copiedToken === token) {
          copiedToken = null;
        }
      }, 2000);
    } else {
      toast.error('Failed to copy. Please manually copy the URL.');
    }
  }

  async function handleSaveSettings() {
    try {
      isSavingSettings = true;
      await setFolderDescription(data.folderPath || '', folderDescInput);
      await invalidateAll();
      toast.success('Settings saved successfully!');
      showSettingsModal = false;
    } catch (e) {
      console.error(e);
      toast.error('Failed to save settings');
    } finally {
      isSavingSettings = false;
    }
  }

  import { toast } from '$lib/stores/toast';

  let isRescanning = $state(false);
  let isRescanningML = $state(false);
  let isRegeneratingImages = $state(false);
  let isRegeneratingVideos = $state(false);

  let showRevokeConfirm = $state(false);
  let revokeTargetToken = $state('');

  function showAppAlert(title: string, message: string) {
    if (title.toLowerCase().includes('error') || title.toLowerCase().includes('fail')) {
      toast.error(message);
    } else if (title.toLowerCase().includes('success') || title.toLowerCase().includes('queued') || title.toLowerCase().includes('updated')) {
      toast.success(message);
    } else {
      toast.info(message);
    }
  }

  async function handleRescanFolder() {
    try {
      isRescanning = true;
      await rescanFolder(data.folderPath || '');
      showAppAlert('Scan Queued', 'Folder scan queued! Wait a few moments for new files to appear.');
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to rescan folder');
    } finally {
      isRescanning = false;
    }
  }

  async function handleRegenerateImages() {
    try {
      isRegeneratingImages = true;
      const res = await regenerateImages(data.folderPath || '');
      showAppAlert('Success', `Queued ${res.count} images for thumbnail regeneration.`);
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to queue image regeneration');
    } finally {
      isRegeneratingImages = false;
    }
  }

  async function handleRegenerateVideos() {
    try {
      isRegeneratingVideos = true;
      const res = await regenerateVideos(data.folderPath || '');
      showAppAlert('Success', `Queued ${res.count} videos for transcode and thumbnail regeneration.`);
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to queue video regeneration');
    } finally {
      isRegeneratingVideos = false;
    }
  }

  async function handleRescanML() {
    try {
      isRescanningML = true;
      await rescanFolderML(data.folderPath || '');
      showAppAlert('ML Processing Queued', 'ML processing queued! It may take a while to extract faces and items.');
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to trigger ML rescan');
    } finally {
      isRescanningML = false;
    }
  }
  
  let isRegeneratingOG = $state(false);
  async function handleRegenerateOG() {
    try {
      isRegeneratingOG = true;
      const res = await fetch('/api/folder/regenerate-og', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: data.folderPath || '' })
      });
      if (!res.ok) throw new Error('Failed to regenerate');
      showAppAlert('Success', 'OG Image cache cleared. It will regenerate on the next share request.');
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to regenerate OG image');
    } finally {
      isRegeneratingOG = false;
    }
  }

  let isRegeneratingWatermarks = $state(false);
  async function handleRegenerateWatermarks() {
    try {
      isRegeneratingWatermarks = true;
      const res = await regenerateFolderWatermarks(data.folderPath || '');
      showAppAlert('Success', `Watermark regeneration complete! Purged ${res.purged} cached, regenerated ${res.regenerated} preview photos.`);
    } catch (e: any) {
      console.error(e);
      showAppAlert('Error', e.message || 'Failed to regenerate watermarks');
    } finally {
      isRegeneratingWatermarks = false;
    }
  }
  
  type SortMode = 'newest' | 'oldest' | 'a-z' | 'z-a';
  type ViewMode = 'small-fit' | 'large-fit' | 'small-square' | 'large-square' | 'compact-list';

  function formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatFileDate(file: { exif_json?: Record<string, unknown> | null; created_at?: string | null }): string {
    const d = getRawDate(file);
    if (isNaN(d.getTime()) || d.getTime() === 0) return '—';
    const clientLocale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined;
    return d.toLocaleDateString(clientLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function getFileDimensions(file: { img_width?: number | null; img_height?: number | null; exif_json?: any }): string {
    const w = file.img_width || file.exif_json?.ExifImageWidth || file.exif_json?.ImageWidth || file.exif_json?.width;
    const h = file.img_height || file.exif_json?.ExifImageHeight || file.exif_json?.ImageHeight || file.exif_json?.height;
    if (w && h) return `${w} × ${h}`;
    return '—';
  }

  function loadPref<T>(key: string, fallback: T): T {
    if ($currentUser && $currentUser.preferences && $currentUser.preferences[key] !== undefined) {
      return $currentUser.preferences[key] as T;
    }
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) as T : fallback;
    } catch { return fallback; }
  }

  let savePrefTimer: any = null;
  function savePref(key: string, val: any) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(val));
    }
    if ($currentUser) {
      if (!$currentUser.preferences) $currentUser.preferences = {};
      if ($currentUser.preferences[key] !== val) {
        $currentUser.preferences[key] = val;
        if (savePrefTimer) clearTimeout(savePrefTimer);
        savePrefTimer = setTimeout(() => {
          if ($currentUser?.preferences) {
            updatePreferences($currentUser.preferences).catch(err => {
              console.error('Failed to save preference to DB:', err);
            });
          }
        }, 500);
      }
    }
  }

  type FolderViewMode = 'small-grid' | 'medium-grid' | 'large-grid' | 'list';
  let sortMode: SortMode = $state((data as any).defaultSortMode || 'oldest');
  let viewMode: ViewMode = $state((data as any).defaultViewMode || 'small-fit');
  let folderViewMode: FolderViewMode = $state((data as any).defaultFolderViewMode || 'small-grid');
  let showFileNames = $state(false);

  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);

  let hasSyncedPreferences = $state(false);
  $effect(() => {
    if ($currentUser && $currentUser.preferences && !hasSyncedPreferences) {
      hasSyncedPreferences = true;
      if ($currentUser.preferences.folderSortMode) sortMode = $currentUser.preferences.folderSortMode as SortMode;
      if ($currentUser.preferences.folderViewMode) viewMode = $currentUser.preferences.folderViewMode as ViewMode;
      if ($currentUser.preferences.folderFolderViewMode) folderViewMode = $currentUser.preferences.folderFolderViewMode as FolderViewMode;
      if ($currentUser.preferences.folderCurationMode) folderCurationMode = $currentUser.preferences.folderCurationMode as 'curated' | 'all';
      if ($currentUser.preferences.showFileNames !== undefined) showFileNames = !!$currentUser.preferences.showFileNames;
    }
  });

  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderSortMode', sortMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderViewMode', viewMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderFolderViewMode', folderViewMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderCurationMode', folderCurationMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('showFileNames', showFileNames); });

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);

  let showFolderViewMenu = $state(false);

  function getAspectRatio(file: any): number | undefined {
    if (file.img_width && file.img_height && file.img_width > 0 && file.img_height > 0) {
      return file.img_width / file.img_height;
    }
    const exif = file.exif_json;
    if (exif) {
      let w = exif.ExifImageWidth || exif.ImageWidth || exif.width;
      let h = exif.ExifImageHeight || exif.ImageHeight || exif.height;
      const orient = exif.Orientation;
      const isRotated90 = (typeof orient === 'number' && [5, 6, 7, 8].includes(orient)) ||
        (typeof orient === 'string' && (orient.includes('90') || orient.includes('270') || orient.includes('Rotate 90') || orient.includes('Rotate 270')));
      if (isRotated90 && w && h) {
        const temp = w;
        w = h;
        h = temp;
      }
      if (w && h && w > 0 && h > 0) return w / h;
    }
    return undefined;
  }

  let displayedDirectories = $derived(isSearching ? searchDirectories : data.directories);
  let displayedFiles = $derived(isSearching ? searchFiles : data.files);

  let isFolderOnly = $derived(displayedFiles.length === 0 && displayedDirectories.length > 0);

  let sortedDirectories = $derived([...displayedDirectories].sort((a, b) => {
    if (sortMode === 'a-z') return a.name.localeCompare(b.name);
    if (sortMode === 'z-a') return b.name.localeCompare(a.name);
    return 0;
  }));

  let activeFolderMenu = $state<string | null>(null);

  function toggleFolderMenu(folderName: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (activeFolderMenu === folderName) {
      activeFolderMenu = null;
    } else {
      activeFolderMenu = folderName;
    }
  }

  async function handleSetDirCoverAsParentCover(dir: any) {
    activeFolderMenu = null;
    if (!dir.cover_id) {
      showAppAlert('Cannot Set Cover', 'This folder does not have a cover image to use.');
      return;
    }
    localCoverOverride = dir.cover_id;
    coverRefreshKey++;
    try {
      await setFolderCover(data.folderPath || '', dir.cover_id);
      await invalidateAll();
      showAppAlert('Cover Updated', 'Folder cover image has been updated.');
    } catch (e) {
      localCoverOverride = null;
      console.error(e);
      showAppAlert('Error', 'Failed to set cover image.');
    }
  }

  let showDownloadModal = $state(false);
  let showShareModal = $state(false);
  let showSettingsModal = $state(false);
  let showGDriveModal = $state(false);

  function openGDriveModal() {
    loadGDriveSync();
    showGDriveModal = true;
  }

  let zipTargetFolderPath = $state('');
  let zipTargetFolderName = $state('');
  let zipAutoStart = $state(false);

  function openDownloadModal() {
    zipTargetFolderPath = data.folderPath || '';
    zipTargetFolderName = (data.folderPath ? data.folderPath.split('/').pop() : 'Photos') || 'Photos';
    zipAutoStart = false;
    showDownloadModal = true;
  }

  function startFolderZipDownload(folderPath: string, folderName?: string) {
    zipTargetFolderPath = folderPath;
    zipTargetFolderName = folderName || (folderPath ? folderPath.split('/').pop() : 'Photos') || 'Photos';
    zipAutoStart = true;
    showDownloadModal = true;
  }

  let folderCurationMode = $state<'curated' | 'all'>('all');
  let showOnlyFavorites = $state(false);

  let hasBurstPhotos = $derived(displayedFiles.some((f: any) => f.burst_group_id || (f.burst_count && f.burst_count > 1)));

  let curatedFiles = $derived(
    folderCurationMode === 'curated'
      ? displayedFiles.filter((f: any) => f.is_hero || !f.burst_group_id)
      : displayedFiles
  );

  let favoriteFilteredFiles = $derived(
    showOnlyFavorites
      ? curatedFiles.filter((f: any) => f.is_favorite)
      : curatedFiles
  );

  let sortedFiles = $derived([...favoriteFilteredFiles].sort((a, b) => {
    if (sortMode === 'newest') return getSortDate(b) - getSortDate(a);
    if (sortMode === 'oldest') return getSortDate(a) - getSortDate(b);
    if (sortMode === 'a-z') return a.file_name.localeCompare(b.file_name);
    if (sortMode === 'z-a') return b.file_name.localeCompare(a.file_name);
    return 0;
  }));

  function handleFavoriteUpdated(updatedId: string, isFav: boolean) {
    if (data.files) {
      data.files = data.files.map((f: any) => f.id === updatedId ? { ...f, is_favorite: isFav } : f);
    }
  }

  async function handleToggleThumbnailFavorite(file: any) {
    const targetState = !file.is_favorite;
    handleFavoriteUpdated(file.id, targetState);
    try {
      const res = await toggleFavorite(file.id, targetState);
      if (res.is_favorite !== targetState) {
        handleFavoriteUpdated(file.id, res.is_favorite);
      }
      toast.success(res.is_favorite ? 'Added to favorites' : 'Removed from favorites');
    } catch (err: any) {
      handleFavoriteUpdated(file.id, !targetState);
      toast.error(err.message || 'Failed to update favorite status');
    }
  }

  function handleHeroUpdated(updatedHeroId: string, isVisible?: boolean) {
    if (data.files) {
      if (typeof isVisible === 'boolean') {
        data.files = data.files.map((f: any) => f.id === updatedHeroId ? { ...f, is_hero: isVisible } : f);
      } else {
        const target = data.files.find((f: any) => f.id === updatedHeroId);
        if (target && target.burst_group_id) {
          data.files = data.files.map((f: any) => {
            if (f.burst_group_id === target.burst_group_id) {
              return { ...f, is_hero: f.id === updatedHeroId };
            }
            return f;
          });
        }
      }
    }
  }

  let visibleCount = $state(50);
  let visibleFiles = $derived(sortedFiles.slice(0, visibleCount));

  function loadMore() {
    visibleCount += 50;
  }

  function infiniteScroll(node: HTMLElement) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore();
      }
    }, { rootMargin: '800px' });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  
  let selectedMediaIndex: number | null = $state(null);

  function encodePath(p: string) {
    return p.split('/').map(s => encodeURIComponent(s)).join('/');
  }

  function folderUrl() {
    const fp = data.folderPath || '';
    return fp ? `/folder/${encodePath(fp)}` : '/folder';
  }

  function mediaUrl(index: number) {
    const file = sortedFiles[index];
    if (!file) return folderUrl();
    return `${folderUrl()}/${encodeURIComponent(file.file_name)}`;
  }

  let syncUrlTimer: ReturnType<typeof setTimeout> | null = null;
  function syncUrl(index: number | null, immediate = false) {
    if (syncUrlTimer) {
      clearTimeout(syncUrlTimer);
      syncUrlTimer = null;
    }
    const update = () => {
      const url = index !== null ? mediaUrl(index) : folderUrl();
      if (typeof window !== 'undefined' && window.location.pathname !== url) {
        history.replaceState(history.state, '', url);
      }
    };
    if (immediate || index === null) {
      update();
    } else {
      syncUrlTimer = setTimeout(update, 200);
    }
  }

  function openLightbox(index: number) {
    selectedMediaIndex = index;
    syncUrl(index, true);
  }
  
  function closeLightbox() {
    selectedMediaIndex = null;
    syncUrl(null, true);
  }
  
  function nextMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex < sortedFiles.length - 1) {
      const next = selectedMediaIndex + 1;
      selectedMediaIndex = next;
      syncUrl(next);
    }
  }

  function prevMedia() {
    if (selectedMediaIndex !== null && selectedMediaIndex > 0) {
      const prev = selectedMediaIndex - 1;
      selectedMediaIndex = prev;
      syncUrl(prev);
    }
  }

  // Auto-open lightbox once from URL
  let autoOpened = false;
  $effect(() => {
    if (autoOpened) return;
    if (data.selectedFile && sortedFiles.length > 0) {
      const idx = sortedFiles.findIndex(f => f.file_name === data.selectedFile);
      if (idx >= 0) {
        selectedMediaIndex = idx;
        autoOpened = true;
      }
    }
  });

  // Preload next and previous lightbox previews for fast, instant navigation
  $effect(() => {
    if (selectedMediaIndex !== null && sortedFiles.length > 0) {
      const nextFile = sortedFiles[selectedMediaIndex + 1];
      const prevFile = sortedFiles[selectedMediaIndex - 1];
      if (nextFile && !nextFile.mime_type.startsWith('video/')) {
        const img = new Image();
        img.src = getPreviewUrl(nextFile.id, false, undefined, 'lightbox');
      }
      if (prevFile && !prevFile.mime_type.startsWith('video/')) {
        const img = new Image();
        img.src = getPreviewUrl(prevFile.id, false, undefined, 'lightbox');
      }
    }
  });

  async function handleSetCover(mediaId: string) {
    localCoverOverride = mediaId;
    coverRefreshKey++;
    try {
      await setFolderCover(data.folderPath || '', mediaId);
      await invalidateAll();
      showAppAlert('Cover Updated', 'Folder cover image has been updated.');
    } catch (e) {
      localCoverOverride = null;
      console.error(e);
      showAppAlert('Error', 'Failed to set cover image.');
    }
  }

  let scrollProgress = $state(0);
  let headerWrapper: HTMLElement | undefined = $state();
  let pollInterval: ReturnType<typeof setInterval>;

  let fallbackCoverId = $derived(
    localCoverOverride ||
    data.folderCoverId || 
    (data.files.length > 0 ? data.files[0].id : null) || 
    (data.directories.find(d => d.cover_id)?.cover_id || null)
  );

  let effectiveCoverBoundingBox = $derived.by(() => {
    if (fallbackCoverId === data.folderCoverId) return data.folderCoverBoundingBox;
    const file = data.files.find(f => f.id === fallbackCoverId);
    if (file) return file.bounding_box || null;
    const dir = data.directories.find(d => d.cover_id === fallbackCoverId);
    if (dir) return dir.cover_bounding_box;
    return null;
  });

  let effectiveCoverImgWidth = $derived.by(() => {
    if (fallbackCoverId === data.folderCoverId) return data.folderCoverImgWidth;
    const file = data.files.find(f => f.id === fallbackCoverId);
    if (file) {
      return file.img_width || file.exif_json?.width || file.exif_json?.ImageWidth || file.exif_json?.ExifImageWidth || null;
    }
    const dir = data.directories.find(d => d.cover_id === fallbackCoverId);
    if (dir) return dir.cover_img_width;
    return null;
  });

  let effectiveCoverImgHeight = $derived.by(() => {
    if (fallbackCoverId === data.folderCoverId) return data.folderCoverImgHeight;
    const file = data.files.find(f => f.id === fallbackCoverId);
    if (file) {
      return file.img_height || file.exif_json?.height || file.exif_json?.ImageHeight || file.exif_json?.ExifImageHeight || null;
    }
    const dir = data.directories.find(d => d.cover_id === fallbackCoverId);
    if (dir) return dir.cover_img_height;
    return null;
  });

  let coverObjectPosition = $derived(computeCoverObjectPosition(effectiveCoverBoundingBox, effectiveCoverImgWidth, effectiveCoverImgHeight));


  let coverRefreshKey = $state(0);

  let scrollRafId: number | null = null;
  function handleScroll(e: Event) {
    if (!headerWrapper || scrollRafId !== null) return;
    const target = e.target as HTMLElement;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      if (!headerWrapper) return;
      const threshold = headerWrapper.offsetHeight - 25;
      if (threshold > 0) {
        scrollProgress = Math.min(1, Math.max(0, target.scrollTop / threshold));
      }
    });
  }

  function isTyping(e: Event): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function cycleViewMode() {
    if (isFolderOnly) {
      const modes: FolderViewMode[] = ['small-grid', 'medium-grid', 'large-grid', 'list'];
      const idx = modes.indexOf(folderViewMode);
      folderViewMode = modes[(idx + 1) % modes.length];
      showFolderViewMenu = false;
    } else {
      const modes: ViewMode[] = ['small-fit', 'large-fit', 'small-square', 'large-square', 'compact-list'];
      const idx = modes.indexOf(viewMode);
      viewMode = modes[(idx + 1) % modes.length];
      showViewMenu = false;
    }
  }

  function cycleSortMode() {
    if (isFolderOnly) {
      sortMode = sortMode === 'a-z' ? 'z-a' : 'a-z';
    } else {
      const modes: SortMode[] = ['newest', 'oldest', 'a-z', 'z-a'];
      const idx = modes.indexOf(sortMode);
      sortMode = modes[(idx + 1) % modes.length];
    }
    showSortMenu = false;
  }

  function navigateToParent() {
    if (!data.folderPath) return;
    const parts = data.folderPath.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.join('/');
    goto(parent ? `/folder/${encodePath(parent)}` : '/folder');
  }

  function handleGalleryKeydown(e: KeyboardEvent) {
    if (selectedMediaIndex !== null) return;

    if (isTyping(e)) {
      if (e.key === 'Escape') {
        if (isSearchOpen) closeSearch();
        else (e.target as HTMLElement).blur();
      }
      return;
    }

    if (e.key === 'Escape') {
      if (showSortMenu || showViewMenu || showFolderViewMenu || activeFolderMenu !== null) {
        showSortMenu = false;
        showViewMenu = false;
        showFolderViewMenu = false;
        activeFolderMenu = null;
        return;
      }
      if (isSearchOpen) {
        closeSearch();
        return;
      }
    }

    if (e.key === '/' || ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'))) {
      e.preventDefault();
      if (!isSearchOpen) toggleSearch();
      else searchInputEl?.focus();
      return;
    }

    if (e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      cycleViewMode();
      return;
    }

    if ((e.key === 's' || e.key === 'S') && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      cycleSortMode();
      return;
    }

    if (e.key === 'D' || (e.shiftKey && (e.key === 'd' || e.key === 'D'))) {
      e.preventDefault();
      openDownloadModal();
      return;
    }

    if (e.key === 'S' || (e.shiftKey && (e.key === 's' || e.key === 'S'))) {
      e.preventDefault();
      showShareModal = true;
      return;
    }

    if (e.key === ',') {
      e.preventDefault();
      showSettingsModal = true;
      return;
    }

    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
      if (data.folderPath) {
        e.preventDefault();
        navigateToParent();
        return;
      }
    }
  }

  onMount(() => {
    sortMode = loadPref<SortMode>('folderSortMode', (data as any).defaultSortMode || 'newest');
    viewMode = loadPref<ViewMode>('folderViewMode', (data as any).defaultViewMode || 'small-fit');
    folderViewMode = loadPref<FolderViewMode>('folderFolderViewMode', (data as any).defaultFolderViewMode || 'small-grid');
    folderCurationMode = loadPref<'curated' | 'all'>('folderCurationMode', 'all');
    showFileNames = loadPref<boolean>('showFileNames', false);

    if (data.isProcessing) {
      toast.info('This folder is still being processed. Some items might be missing or slow to load. Feel free to come back later!', 8000);
    }

    let pollCount = 0;
    const MAX_POLLS = 10;
    pollInterval = setInterval(() => {
      pollCount++;
      if (pollCount > MAX_POLLS) {
        clearInterval(pollInterval);
        return;
      }
      // Poll if any file lacks a blurhash (still processing) or if scanner is active
      const stillProcessing = (data.files && data.files.some(f => !f.blurhash)) || data.scanning;
      if (stillProcessing) {
        invalidateAll();
      } else {
        clearInterval(pollInterval);
      }
    }, 5000);

    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.addEventListener('scroll', handleScroll, { passive: true });
    }

    windowWidth = window.innerWidth;
    const updateWidth = () => windowWidth = window.innerWidth;
    window.addEventListener('resize', updateWidth);
    window.addEventListener('keydown', handleGalleryKeydown);

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', updateWidth);
      window.removeEventListener('keydown', handleGalleryKeydown);
    };
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
    }
  });
</script>

<div class="header-wrapper {fallbackCoverId ? 'has-cover' : ''}" bind:this={headerWrapper}>
  {#if data.folderPath}
    <a href="/folder/{data.folderPath.split('/').slice(0, -1).join('/')}" 
       style="position: absolute; top: 24px; left: 24px; z-index: 20; color: rgba(255,255,255,0.4); text-decoration: none; display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; transition: color 0.2s, transform 0.2s;"
       onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }}
       onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}
       title="Go to parent folder">
      <ChevronLeft size={32} strokeWidth={2.5} />
    </a>
  {/if}
  {#if fallbackCoverId}
    <CoverImage src={getPreviewUrl(fallbackCoverId, false) + '?t=' + coverRefreshKey} objectPosition={coverObjectPosition} />
    <div class="header-gradient"></div>
  {/if}
</div>

<div class="sticky-header" style="
  --scroll-prog: {scrollProgress};
  background: linear-gradient(to bottom, rgba(0,0,0,calc(0.9 * {scrollProgress})) 0%, rgba(0,0,0,calc(0.6 * {scrollProgress})) 100%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom-color: rgba(255,255,255,calc(0.05 * {scrollProgress}));
  z-index: {showSortMenu || showViewMenu || showFolderViewMenu ? 105 : 50};
">
  <div class="header-content" class:frozen-mobile={scrollProgress === 1}>
    <div class="header-left">
      <div style="display: flex; flex-direction: row; align-items: center;">
        <div class="header-text-container" style="--scroll-prog: {scrollProgress};">
        {#key data.folderPath}
          {#if data.folderPath && data.folderPath.includes('/')}
            <div class="subheading breadcrumbs">
              {#each data.folderPath.split('/').slice(0, -1) as part, index}
                {#if index > 0}<span class="separator"> &gt; </span>{/if}
                <a href="/folder/{data.folderPath.split('/').slice(0, index + 1).join('/')}">{part}</a>
              {/each}
            </div>
          {/if}
          <div class="folder-title-row">
            <h2>{data.folderPath ? data.folderPath.split('/').pop() : 'Home'}</h2>
            <span class="count mobile-count">
              {#if isSearching && isSearchLoading}
                <span>Searching...</span>
              {:else if displayedDirectories.length > 0}
                <span>{displayedDirectories.length} {displayedDirectories.length === 1 ? 'folder' : 'folders'}</span>
                {#if displayedFiles.length > 0}
                  <span>& {displayedFiles.length} {displayedFiles.length === 1 ? 'item' : 'items'}</span>
                {/if}
              {:else}
                <span>{displayedFiles.length} {displayedFiles.length === 1 ? 'item' : 'items'}</span>
              {/if}
            </span>
          </div>
          {#if data.folderDescription}
            <p class="folder-description" style="margin-top: 12px; color: #a1a1aa; font-size: 1rem; max-width: 600px; line-height: 1.5;">{data.folderDescription}</p>
          {/if}
        {/key}
      </div>
      </div>
    </div>
    
    <div class="header-right">
      <div class="toolbar">
        {#if data.folderPath}
          <a href="/folder/{data.folderPath.split('/').slice(0, -1).join('/')}" 
             class="icon-btn mobile-only-back" 
             style="opacity: {scrollProgress === 1 ? 1 : 0}; width: {scrollProgress === 1 ? '30px' : '0'}; padding: {scrollProgress === 1 ? '4px' : '0'}; margin-right: {scrollProgress === 1 ? '0' : '-8px'}; overflow: hidden; transition: width 0.2s, opacity 0.2s, margin 0.2s, padding 0.2s; pointer-events: {scrollProgress === 1 ? 'auto' : 'none'}; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" 
             title="Go to parent folder (Backspace)">
            <ChevronLeft size={20} />
          </a>
        {/if}
        {#if $currentUser?.role === 'admin' || $currentUser?.role === 'super_admin'}
          <a href="/admin/analytics/folder/{encodePath(data.folderPath || '')}?from={encodePath(data.folderPath || '')}" class="icon-btn" title="Folder Analytics" style="display: inline-flex; align-items: center; justify-content: center;">
            <BarChart3 size={18} />
          </a>
        {/if}
        <button class="icon-btn" class:active={isSearchOpen} onclick={toggleSearch} title="Search (/ or ⌘K)">
          <Search size={18} />
        </button>
        <div class="dropdown-container" use:clickOutside={() => showSortMenu = false}>
          <button class="icon-btn" onclick={() => { showSortMenu = !showSortMenu; showViewMenu = false; showFolderViewMenu = false; }} title="Sort (S)">
            <ArrowDownUp size={18} />
          </button>
          {#if showSortMenu}
            <div class="dropdown-menu">
              {#if isFolderOnly}
                <button class:active={sortMode === 'a-z'} onclick={() => { sortMode = 'a-z'; showSortMenu = false; }}>A to Z</button>
                <button class:active={sortMode === 'z-a'} onclick={() => { sortMode = 'z-a'; showSortMenu = false; }}>Z to A</button>
              {:else}
                <button class:active={sortMode === 'newest'} onclick={() => { sortMode = 'newest'; showSortMenu = false; }}>Newest to Oldest</button>
                <button class:active={sortMode === 'oldest'} onclick={() => { sortMode = 'oldest'; showSortMenu = false; }}>Oldest to Newest</button>
                <button class:active={sortMode === 'a-z'} onclick={() => { sortMode = 'a-z'; showSortMenu = false; }}>A to Z</button>
                <button class:active={sortMode === 'z-a'} onclick={() => { sortMode = 'z-a'; showSortMenu = false; }}>Z to A</button>
              {/if}
            </div>
          {/if}
        </div>
        
        {#if displayedFiles.length > 0}
          <button 
            type="button" 
            class="icon-btn curation-icon-btn" 
            class:active={folderCurationMode === 'curated'} 
            onclick={() => folderCurationMode = folderCurationMode === 'curated' ? 'all' : 'curated'} 
            title={folderCurationMode === 'curated' ? 'Curated view: showing best picks (click for all)' : 'Curate: show best picks only'}
            aria-label="Toggle curated view"
          >
            <Layers size={18} />
          </button>

          <button 
            type="button" 
            class="icon-btn favorites-icon-btn" 
            class:active={showOnlyFavorites} 
            onclick={() => showOnlyFavorites = !showOnlyFavorites} 
            title={showOnlyFavorites ? 'Favorites view: showing favorited photos only (click for all)' : 'Favorites: show favorites only'}
            aria-label="Toggle favorites only"
          >
            <Heart size={18} fill={showOnlyFavorites ? 'currentColor' : 'none'} />
          </button>
        {/if}

        {#if isFolderOnly}
          <div class="dropdown-container" use:clickOutside={() => showFolderViewMenu = false}>
            <button class="icon-btn" onclick={() => { showFolderViewMenu = !showFolderViewMenu; showSortMenu = false; }} title="View (V)">
              {#if folderViewMode === 'list'}
                <List size={18} />
              {:else}
                <LayoutGrid size={18} />
              {/if}
            </button>
            {#if showFolderViewMenu}
              <div class="dropdown-menu">
                <button class:active={folderViewMode === 'small-grid'} onclick={() => { folderViewMode = 'small-grid'; showFolderViewMenu = false; }}>Small Grid</button>
                <button class:active={folderViewMode === 'medium-grid'} onclick={() => { folderViewMode = 'medium-grid'; showFolderViewMenu = false; }}>Medium Grid</button>
                <button class:active={folderViewMode === 'large-grid'} onclick={() => { folderViewMode = 'large-grid'; showFolderViewMenu = false; }}>Large Grid</button>
                <button class:active={folderViewMode === 'list'} onclick={() => { folderViewMode = 'list'; showFolderViewMenu = false; }}>List</button>
                <div class="dropdown-divider"></div>
                <button class="toggle-item" class:active={showFileNames} onclick={() => { showFileNames = !showFileNames; showFolderViewMenu = false; }}>
                  <span>Show File Names</span>
                  {#if showFileNames}
                    <Check size={16} />
                  {/if}
                </button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="dropdown-container" use:clickOutside={() => showViewMenu = false}>
            <button class="icon-btn" onclick={() => { showViewMenu = !showViewMenu; showSortMenu = false; }} title="View (V)">
              {#if viewMode === 'compact-list'}
                <List size={18} />
              {:else}
                <LayoutGrid size={18} />
              {/if}
            </button>
            {#if showViewMenu}
              <div class="dropdown-menu">
                <button class:active={viewMode === 'small-fit'} onclick={() => { viewMode = 'small-fit'; showViewMenu = false; }}>Small Fit Size</button>
                <button class:active={viewMode === 'large-fit'} onclick={() => { viewMode = 'large-fit'; showViewMenu = false; }}>Large Fit Size</button>
                <button class:active={viewMode === 'small-square'} onclick={() => { viewMode = 'small-square'; showViewMenu = false; }}>Small Square Grid</button>
                <button class:active={viewMode === 'large-square'} onclick={() => { viewMode = 'large-square'; showViewMenu = false; }}>Large Square Grid</button>
                <button class:active={viewMode === 'compact-list'} onclick={() => { viewMode = 'compact-list'; showViewMenu = false; }}>Compact List</button>
                <div class="dropdown-divider"></div>
                <button class="toggle-item" class:active={showFileNames} onclick={() => { showFileNames = !showFileNames; showViewMenu = false; }}>
                  <span>Show File Names</span>
                  {#if showFileNames}
                    <Check size={16} />
                  {/if}
                </button>
              </div>
            {/if}
          </div>
        {/if}
        
        <button class="icon-btn" onclick={openDownloadModal} title="Download Folder (Shift+D)">
          <Download size={18} />
        </button>
        <button class="icon-btn" onclick={() => showShareModal = true} title="Share Folder (Shift+S)">
          <Share2 size={18} />
        </button>
        {#if $currentUser?.role === 'admin' || $currentUser?.role === 'super_admin'}
          <button class="icon-btn" onclick={openGDriveModal} title="Google Drive Sync">
            <Cloud size={18} />
          </button>
        {/if}
        <button class="icon-btn" onclick={() => showSettingsModal = true} title="Folder Settings (,)">
          <Settings size={18} />
        </button>
      </div>
      
      <span class="count desktop-count" style="display: flex; flex-wrap: wrap; justify-content: flex-end; column-gap: 4px;">
        {#if isSearching && isSearchLoading}
          <span style="white-space: nowrap; color: #a1a1aa;">Searching...</span>
        {:else if displayedDirectories.length > 0}
          <span style="white-space: nowrap;">{displayedDirectories.length} {displayedDirectories.length === 1 ? 'folder' : 'folders'}</span>
          {#if displayedFiles.length > 0}
            <span style="white-space: nowrap;">& {displayedFiles.length} {displayedFiles.length === 1 ? 'item' : 'items'}</span>
          {/if}
        {:else}
          <span style="white-space: nowrap;">{displayedFiles.length} {displayedFiles.length === 1 ? 'item' : 'items'}</span>
        {/if}
      </span>
    </div>
  </div>

  {#if isSearchOpen}
    <div class="folder-search-bar" transition:slide={{ duration: 180 }}>
      <div class="search-input-wrapper">
        {#if isSearchLoading}
          <Loader2 size={18} class="search-spinner" />
        {:else}
          <Search size={18} class="search-icon" />
        {/if}
        <input 
          bind:this={searchInputEl}
          type="text" 
          placeholder={data.folderPath ? `Search in ${data.folderPath.split('/').pop()} and subfolders...` : "Search all photos and folders..."}
          bind:value={searchQuery}
          oninput={handleSearchInput}
          onkeydown={handleSearchKeydown}
          class="folder-search-input"
        />
        <button class="search-close-btn" onclick={toggleSearch} title="Close search">
          <X size={18} />
        </button>
      </div>
    </div>
  {/if}
</div>

{#key data.folderPath}
{#if isStagedFolder && stagingNotice && stagingNotice.enabled}
  <div class="staging-disclaimer-banner">
    <div class="disclaimer-icon">
      <Radio size={20} color="#a855f7" />
    </div>
    <div class="disclaimer-content">
      <h4 class="disclaimer-title">{stagingNotice.title || 'Realtime Photo Sync in Progress'}</h4>
      <p class="disclaimer-text">{stagingNotice.message}</p>
    </div>
    <button 
      type="button" 
      class="disclaimer-refresh-btn" 
      onclick={handleRefreshLiveSync}
      disabled={isRefreshingLiveSync}
      title="Refresh photos from live sync"
    >
      <RefreshCw size={15} class={isRefreshingLiveSync ? 'spinning' : ''} />
      <span>Refresh</span>
    </button>
  </div>
{/if}

{#if isSearching && !isSearchLoading && sortedDirectories.length === 0 && sortedFiles.length === 0 && viewMode !== 'compact-list'}
  <div class="search-empty-state">
    <p class="empty-title">No media or folders found matching "{searchQuery}"</p>
    <p class="empty-subtitle">Check the spelling or try searching for a different name</p>
    <button class="btn" onclick={clearSearch} style="margin-top: 14px; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: white;">
      Clear Search
    </button>
  </div>
{/if}

{#if displayedDirectories.length > 0}
  <div class="dir-grid {isFolderOnly ? 'folder-mode-' + folderViewMode : (displayedFiles.length > 0 ? 'list-view' : '')}">
    {#each sortedDirectories as dir, i}
      <a 
        class="dir-card" 
        style="animation-delay: {i * 40}ms; z-index: {activeFolderMenu === dir.name ? 50 : 'auto'};" 
        href={dir.path ? `/folder/${encodePath(dir.path)}` : `/folder/${data.folderPath ? data.folderPath + '/' + dir.name : dir.name}`}
        onclick={(e) => { 
          if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('.dropdown-menu')) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {#if isFolderOnly && folderViewMode === 'list'}
          <div class="dir-info">
            <div class="dir-label">
              <Folder size={18} />
              <div>
                <span class="dir-name">{dir.name}</span>
                {#if dir.relative_path && dir.relative_path !== dir.name}
                  <span class="dir-path" style="font-size: 0.75rem; color: #888; display: block;" title={dir.relative_path}>{dir.relative_path}</span>
                {/if}
              </div>
            </div>
            <div class="dir-actions" use:clickOutside={() => { if (activeFolderMenu === dir.name) activeFolderMenu = null; }}>
              <button class="icon-btn" onclick={(e) => toggleFolderMenu(dir.name, e)} title="Options">
                <MoreVertical size={16} />
              </button>
              {#if activeFolderMenu === dir.name}
                <div class="dropdown-menu" style="position: absolute; right: 0; top: 100%; z-index: 100; margin-top: 4px;" onclick={(e) => e.stopPropagation()}>
                  <button onclick={() => { activeFolderMenu = null; startFolderZipDownload(dir.path || (data.folderPath ? data.folderPath + '/' + dir.name : dir.name), dir.name); }}>Download ZIP</button>
                </div>
              {/if}
            </div>
          </div>
        {:else}
          <div class="dir-cover">
            {#if dir.cover_id}
              <BlurhashImage 
                hash={dir.blurhash || ''} 
                src={`${getThumbnailUrl(dir.cover_id)}${dir.blurhash ? '?cb=' + encodeURIComponent(dir.blurhash) : ''}`} 
                alt={dir.name}
                objectFit="cover"
                square={true}
              />
            {:else}
              <div class="dir-placeholder"></div>
            {/if}
            {#if isFolderOnly}
              <div class="dir-actions-overlay" use:clickOutside={() => { if (activeFolderMenu === dir.name) activeFolderMenu = null; }}>
                <button class="overlay-btn" onclick={(e) => toggleFolderMenu(dir.name, e)} title="Options">
                  <MoreVertical size={16} />
                </button>
                {#if activeFolderMenu === dir.name}
                  <div class="dropdown-menu" style="position: absolute; left: 50%; transform: translateX(-50%); top: 100%; z-index: 100; margin-top: 4px;" onclick={(e) => e.stopPropagation()}>
                    <button onclick={(e) => { e.preventDefault(); e.stopPropagation(); handleSetDirCoverAsParentCover(dir); }}>Set as cover</button>
                    <button onclick={() => { activeFolderMenu = null; startFolderZipDownload(dir.path || (data.folderPath ? data.folderPath + '/' + dir.name : dir.name), dir.name); }}>Download ZIP</button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          <div class="dir-info">
            <span class="dir-name">{dir.name}</span>
            {#if dir.relative_path && dir.relative_path !== dir.name}
              <span class="dir-path" style="font-size: 0.75rem; color: #888; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={dir.relative_path}>{dir.relative_path}</span>
            {/if}
            {#if !isFolderOnly}
              <div class="dir-actions" use:clickOutside={() => { if (activeFolderMenu === dir.name) activeFolderMenu = null; }}>
                <button class="icon-btn" onclick={(e) => toggleFolderMenu(dir.name, e)} title="Options">
                  <MoreVertical size={16} />
                </button>
                {#if activeFolderMenu === dir.name}
                  <div class="dropdown-menu" style="position: absolute; right: 0; top: 100%; z-index: 100; margin-top: 4px;" onclick={(e) => e.stopPropagation()}>
                    <button onclick={(e) => { e.preventDefault(); e.stopPropagation(); handleSetDirCoverAsParentCover(dir); }}>Set as cover</button>
                    <button onclick={() => { activeFolderMenu = null; startFolderZipDownload(dir.path || (data.folderPath ? data.folderPath + '/' + dir.name : dir.name), dir.name); }}>Download ZIP</button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </a>
    {/each}
  </div>
{/if}
{/key}

{#if !isSearching && data.directories.length === 0 && data.files.length === 0}
  <div class="empty-state">
    <h3 style="color: var(--text-color); margin-bottom: 8px;">This folder is empty</h3>
    <p style="color: #a1a1aa; max-width: 400px; margin: 0 auto;">There are no files or subfolders here yet.</p>
  </div>
{/if}

{#key data.folderPath}
{#if viewMode === 'compact-list' && (sortedFiles.length > 0 || isSearching)}
  <div class="compact-media-list">
    <div class="compact-list-header">
      <button 
        type="button" 
        class="compact-th col-name" 
        onclick={() => { sortMode = sortMode === 'a-z' ? 'z-a' : 'a-z'; }}
        title="Sort by Name"
      >
        <span>Name</span>
        {#if sortMode === 'a-z'}
          <span class="sort-indicator">↑</span>
        {:else if sortMode === 'z-a'}
          <span class="sort-indicator">↓</span>
        {/if}
      </button>
      <button 
        type="button" 
        class="compact-th col-date" 
        onclick={() => { sortMode = sortMode === 'newest' ? 'oldest' : 'newest'; }}
        title="Sort by Date"
      >
        <span>Date</span>
        {#if sortMode === 'newest'}
          <span class="sort-indicator">↓</span>
        {:else if sortMode === 'oldest'}
          <span class="sort-indicator">↑</span>
        {/if}
      </button>
      <div class="compact-th col-res">
        <span>Dimensions</span>
      </div>
      <div class="compact-th col-size">
        <span>Size</span>
      </div>
      <div class="compact-th col-actions"></div>
    </div>
    <div class="compact-list-body">
      {#if isSearching && !isSearchLoading && sortedFiles.length === 0}
        <div class="compact-empty-state">
          <p class="empty-title">{sortedDirectories.length === 0 ? `No media or folders found matching "${searchQuery}"` : `No media found matching "${searchQuery}"`}</p>
          <p class="empty-subtitle">Check the spelling or try searching for a different name</p>
          <button class="btn" onclick={clearSearch} style="margin-top: 10px; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: white;">
            Clear Search
          </button>
        </div>
      {:else}
        {#each visibleFiles as file, i (file.id)}
        {@const isVideo = file.mime_type.startsWith('video/')}
        <div 
          class="compact-row" 
          role="button" 
          tabindex="0"
          onclick={() => openLightbox(i)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(i); } }}
          title={`Open ${file.file_name}`}
        >
          <div class="col-name">
            <span class="file-icon" class:video={isVideo}>
              {#if isVideo}
                <Film size={16} />
              {:else}
                <ImageIcon size={16} />
              {/if}
            </span>
            <div style="display: flex; flex-direction: column; overflow: hidden; min-width: 0;">
              <span class="file-name" title={file.file_name}>{file.file_name}</span>
              {#if isSearching && file.relative_path && file.relative_path !== file.file_name}
                <span class="file-path" style="font-size: 0.75rem; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={file.relative_path}>{file.relative_path.slice(0, file.relative_path.lastIndexOf('/'))}</span>
              {/if}
            </div>
          </div>
          <div class="col-date">{formatFileDate(file)}</div>
          <div class="col-res">{getFileDimensions(file)}</div>
          <div class="col-size">{formatBytes(file.size_bytes)}</div>
          <div class="col-actions" onclick={(e) => e.stopPropagation()}>
            <button 
              type="button"
              class="compact-action-btn" 
              class:is-fav={file.is_favorite}
              onclick={() => handleToggleThumbnailFavorite(file)}
              title={file.is_favorite ? "Remove from favorites" : "Add to favorites"}
              aria-label="Toggle favorite"
            >
              <Heart size={15} fill={file.is_favorite ? '#ef4444' : 'none'} color={file.is_favorite ? '#ef4444' : 'currentColor'} />
            </button>
            <a 
              href={`${getStreamUrl(file.id)}?download=1`} 
              download={file.file_name} 
              class="compact-action-btn" 
              title="Download"
              aria-label="Download"
            >
              <Download size={15} />
            </a>
          </div>
        </div>
      {/each}
      {/if}
    </div>
  </div>
{:else}
  <div class="grid {viewMode}">
    {#each visibleFiles as file, i}
      <BlurhashImage 
        hash={file.blurhash || ''} 
        src={`${getThumbnailUrl(file.id)}${file.blurhash ? '?cb=' + encodeURIComponent(file.blurhash) : ''}`} 
        alt={file.file_name} 
        fileName={isSearching && file.relative_path ? file.relative_path : file.file_name}
        showFileName={showFileNames || isSearching}
        isVideo={file.mime_type.startsWith('video/')}
        onclick={() => openLightbox(i)}
        objectFit={viewMode.includes('square') ? 'cover' : 'contain'}
        square={viewMode.includes('square')}
        targetHeight={viewMode.includes('small') ? (windowWidth <= 768 ? 100 : 150) : viewMode.includes('large') ? (windowWidth <= 768 ? 200 : 350) : 250}
        priority={i < 8}
        initialAspectRatio={getAspectRatio(file)}
        burstCount={folderCurationMode === 'curated' ? file.burst_count : undefined}
        isFavorite={file.is_favorite ?? false}
        canFavorite={true}
        ontogglefavorite={() => handleToggleThumbnailFavorite(file)}
      />
    {/each}
  </div>
{/if}
{#if showOnlyFavorites && sortedFiles.length === 0}
  <div class="empty-favorites-state">
    <div class="empty-favorites-icon">
      <Heart size={36} strokeWidth={1.5} />
    </div>
    <p class="empty-title">No favorites in this folder</p>
    <p class="empty-subtitle">Click the heart icon on any photo or press F in the viewer to mark your favorites.</p>
    <button class="btn" onclick={() => showOnlyFavorites = false} style="margin-top: 14px; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: white;">
      Show All Photos
    </button>
  </div>
{/if}

{#if visibleCount < sortedFiles.length}
  <div use:infiniteScroll style="height: 20px; width: 100%;"></div>
{/if}
{/key}

{#if selectedMediaIndex !== null && sortedFiles[selectedMediaIndex]}
  <Lightbox folderCoverId={data.folderCoverId} 
    media={sortedFiles[selectedMediaIndex]} 
    showHiddenAlternates={true}
    allowHeroSelection={true}
    canFavorite={true}
    onfavoriteupdated={handleFavoriteUpdated}
    onheroupdated={handleHeroUpdated}
    onclose={closeLightbox}
    onnext={nextMedia}
    onprev={prevMedia}
    onsetcover={handleSetCover}
  />
{/if}

<ZipDownloadModal 
  bind:show={showDownloadModal} 
  folderPath={zipTargetFolderPath} 
  folderName={zipTargetFolderName} 
  autoStart={zipAutoStart}
/>

<Modal bind:show={showShareModal} id="share-settings" title="Share Settings">
  <div style="max-height: 80vh; overflow-y: auto; padding-right: 4px;">
    <!-- Top-level Navigation: Share Links vs Access Requests -->
    <div style="display: flex; gap: 8px; border-bottom: 1px solid var(--glass-border); padding-bottom: 12px; margin-bottom: 20px;">
      <button 
        class="btn" 
        style="flex: 1; padding: 8px 12px; font-size: 0.875rem; background: {shareActiveTab === 'links' ? 'var(--text-color)' : 'rgba(255,255,255,0.06)'}; color: {shareActiveTab === 'links' ? 'var(--bg-color)' : 'white'}; border: 1px solid var(--glass-border);"
        onclick={() => shareActiveTab = 'links'}>
        Share Links
      </button>
      <button 
        class="btn" 
        style="flex: 1; padding: 8px 12px; font-size: 0.875rem; background: {shareActiveTab === 'requests' ? 'var(--text-color)' : 'rgba(255,255,255,0.06)'}; color: {shareActiveTab === 'requests' ? 'var(--bg-color)' : 'white'}; border: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: center; gap: 6px;"
        onclick={() => shareActiveTab = 'requests'}>
        <span>Access Requests</span>
        {#if pendingRequestsCount > 0}
          <span style="background: #ef4444; color: white; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; padding: 1px 6px;">
            {pendingRequestsCount}
          </span>
        {/if}
      </button>
    </div>

    {#if shareActiveTab === 'links'}
      {#if newlyCreatedShareToken}
        <div style="background: rgba(0,255,100,0.1); border: 1px solid rgba(0,255,100,0.3); padding: 16px; border-radius: 8px; margin-bottom: 20px;">
          <p style="color: #4ade80; margin-bottom: 8px; font-weight: 500;">Share link created successfully!</p>
          <div style="display: flex; gap: 8px;">
            <input type="text" readonly value="{(import.meta.env.PUBLIC_APP_DOMAIN as string) || window.location.origin}/share/{newlyCreatedShareToken}" style="flex: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;" />
            <button class="icon-btn" style="display: flex; align-items: center; justify-content: center;" onclick={() => copyShareLink(newlyCreatedShareToken!)}>
              {#if copiedToken === newlyCreatedShareToken}
                <Check size={18} color="#10b981" />
              {:else}
                <Copy size={18} color="#a1a1aa" />
              {/if}
            </button>
          </div>
        </div>
      {/if}

      <!-- Create New Link Section -->
      <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--glass-border);">
        <h4 style="margin-bottom: 12px; font-weight: 500;">Create New Share Link</h4>
        
        <div class="form-group" style="margin-bottom: 14px;">
          <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; color: #ccc;">Expiration</label>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <button 
              type="button" 
              class="btn" 
              style="flex: 1; padding: 6px 10px; font-size: 0.8rem; background: {shareExpiryMode === 'duration' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
              onclick={() => shareExpiryMode = 'duration'}>
              Duration
            </button>
            <button 
              type="button" 
              class="btn" 
              style="flex: 1; padding: 6px 10px; font-size: 0.8rem; background: {shareExpiryMode === 'date' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
              onclick={() => shareExpiryMode = 'date'}>
              Specific Date & Time
            </button>
            <button 
              type="button" 
              class="btn" 
              style="flex: 1; padding: 6px 10px; font-size: 0.8rem; background: {shareExpiryMode === 'never' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
              onclick={() => shareExpiryMode = 'never'}>
              Never Expires
            </button>
          </div>

          {#if shareExpiryMode === 'duration'}
            <div style="display: flex; gap: 8px;">
              <input type="number" bind:value={shareExpiryValue} min="1" style="width: 80px; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit;" />
              <select bind:value={shareExpiryUnit} style="flex: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit;">
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="months">Months</option>
                <option value="years">Years</option>
              </select>
            </div>
          {:else if shareExpiryMode === 'date'}
            <div>
              <input type="datetime-local" bind:value={shareExpiryDateTime} style="width: 100%; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit;" />
            </div>
          {/if}
        </div>
        
        <div class="form-group" style="margin-bottom: 8px; display: flex; align-items: center; gap: 12px;">
          <input type="checkbox" id="allowDlsImg" bind:checked={shareAllowDownloadImages} style="width: 18px; height: 18px;" />
          <label for="allowDlsImg" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow downloading individual images</label>
        </div>

        <div class="form-group" style="margin-bottom: 8px; display: flex; align-items: center; gap: 12px;">
          <input type="checkbox" id="allowDlsFolder" bind:checked={shareAllowDownloadFolder} style="width: 18px; height: 18px;" />
          <label for="allowDlsFolder" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow downloading the entire folder (ZIP)</label>
        </div>

        <div class="form-group" style="margin-bottom: 8px; display: flex; align-items: center; gap: 12px;">
          <input type="checkbox" id="allowFavs" bind:checked={shareAllowFavorites} style="width: 18px; height: 18px;" />
          <label for="allowFavs" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow visitors to favorite photos</label>
        </div>

        <div class="form-group" style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;">
          <input type="checkbox" id="allowFilterFavs" bind:checked={shareAllowFilterFavorites} style="width: 18px; height: 18px;" />
          <label for="allowFilterFavs" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow visitors to filter favorites</label>
        </div>

        <!-- Label for Internal Reference -->
        <div class="form-group" style="margin-bottom: 16px;">
          <label for="shareLabelInput" style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 0.875rem; color: #ccc;">
            <Tag size={14} color="#c084fc" />
            <span>Label (Internal Reference, Optional)</span>
          </label>
          <input
            id="shareLabelInput"
            type="text"
            bind:value={shareLabel}
            placeholder="e.g. Wedding Client, Instagram Link, Vendor Preview"
            style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.875rem;"
          />
        </div>

        <!-- Password Protection (Optional) -->
        <div class="form-group" style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label for="sharePwdInput" style="font-size: 0.875rem; color: #ccc; display: flex; align-items: center; gap: 6px;">
              <Lock size={14} color="#60a5fa" />
              <span>Password Protection (Optional)</span>
            </label>
            <button
              type="button"
              class="btn"
              style="padding: 3px 8px; font-size: 0.75rem; background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.3); display: flex; align-items: center; gap: 4px;"
              onclick={handleGenerateSharePassword}
              title="Generate a natural language password"
            >
              <Sparkles size={12} />
              <span>Generate Password</span>
            </button>
          </div>
          <div style="position: relative; display: flex; align-items: center;">
            <input
              id="sharePwdInput"
              type={showSharePassword ? 'text' : 'password'}
              bind:value={sharePassword}
              placeholder="Leave empty for no password"
              style="width: 100%; padding: 8px 68px 8px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.875rem; font-family: monospace;"
            />
            <div style="position: absolute; right: 4px; display: flex; gap: 4px; align-items: center;">
              {#if sharePassword}
                <button
                  type="button"
                  class="icon-btn"
                  style="padding: 4px; color: #a1a1aa;"
                  onclick={() => { copyToClipboard(sharePassword); toast.success('Password copied!'); }}
                  title="Copy password"
                >
                  <Copy size={14} />
                </button>
              {/if}
              <button
                type="button"
                class="icon-btn"
                style="padding: 4px; color: #a1a1aa;"
                onclick={() => showSharePassword = !showSharePassword}
                title={showSharePassword ? "Hide password" : "Show password"}
              >
                {#if showSharePassword}
                  <EyeOff size={14} />
                {:else}
                  <Eye size={14} />
                {/if}
              </button>
            </div>
          </div>
          <p style="font-size: 0.72rem; color: #888; margin-top: 4px; margin-bottom: 0;">
            If set, visitors must enter this password to view photos.
          </p>
        </div>

        <div class="form-group" style="margin-bottom: 18px;">
          <label style="display: block; margin-bottom: 6px; font-size: 0.875rem; color: #ccc;">Watermark Protection</label>
          {#if shareGlobalEnforced}
            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); padding: 8px 12px; border-radius: 6px;">
              <Lock size={15} color="#38bdf8" />
              <span>Enforced Globally by Admin ({shareGlobalTemplateName})</span>
            </div>
          {:else}
            <select
              bind:value={shareWatermarkTemplateId}
              style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.875rem;"
            >
              <option value="">None (No Watermark)</option>
              {#each watermarkTemplates as t}
                <option value={t.id}>
                  {t.name} {t.is_default ? '(Default)' : ''} {!t.allow_hd_download ? `[${t.restricted_tier} restricted]` : ''}
                </option>
              {/each}
            </select>
          {/if}
        </div>
        
        <button class="btn" style="width: 100%; background: var(--text-color); color: var(--bg-color);" onclick={handleCreateShare} disabled={isCreatingShare}>
          {isCreatingShare ? 'Generating Link...' : 'Generate Share Link'}
        </button>
      </div>

      <!-- Links List Section (Active vs Expired) -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h4 style="font-weight: 500;">Share Links</h4>
          <div style="display: flex; gap: 6px;">
            <button 
              type="button"
              class="btn" 
              style="padding: 4px 10px; font-size: 0.75rem; background: {shareLinksSubTab === 'active' ? 'rgba(255,255,255,0.2)' : 'transparent'}; border: 1px solid var(--glass-border); color: white;"
              onclick={() => shareLinksSubTab = 'active'}>
              Active ({activeSharesList.length})
            </button>
            <button 
              type="button"
              class="btn" 
              style="padding: 4px 10px; font-size: 0.75rem; background: {shareLinksSubTab === 'expired' ? 'rgba(255,255,255,0.2)' : 'transparent'}; border: 1px solid var(--glass-border); color: white;"
              onclick={() => shareLinksSubTab = 'expired'}>
              Expired ({expiredSharesList.length})
            </button>
          </div>
        </div>

        {#if shareLinksSubTab === 'active'}
          {#if activeSharesList.length === 0}
            <p style="color: #666; font-size: 0.875rem;">No active links for this folder.</p>
          {:else}
            <div style="display: flex; flex-direction: column; gap: 12px; max-height: 280px; overflow-y: auto;">
              {#each activeSharesList as share}
                <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); padding: 12px; border-radius: 6px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                    <div style="flex: 1; min-width: 0;">
                      <!-- Main Title: Label (or Share Link if no label) + Status Badge -->
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                        <span style="color: #f4f4f5; font-weight: 600; font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                          {share.label || 'Share Link'}
                        </span>
                        {#if share.is_active === false}
                          <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500; flex-shrink: 0;">
                            Disabled
                          </span>
                        {:else}
                          <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500; flex-shrink: 0;">
                            Active
                          </span>
                        {/if}
                      </div>

                      <!-- Subheading: Back of the link (...token) -->
                      <div style="font-family: monospace; color: #a1a1aa; font-size: 0.78rem; margin-bottom: 6px;">
                        ...{share.share_token.slice(-8)}
                      </div>

                      <!-- Dates: Creation & Expiration -->
                      <div style="font-size: 0.75rem; color: #a1a1aa; display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px;">
                        {#if share.created_at}
                          <div>
                            <span style="color: #71717a;">Created:</span> {formatShareDate(share.created_at)}
                          </div>
                        {/if}
                        <div>
                          <span style="color: #71717a;">Expires:</span>
                          {#if share.expires_at}
                            <span style="color: #60a5fa;">{formatShareDate(share.expires_at)} ({getNearestExpiryDuration(share.expires_at)})</span>
                          {:else}
                            <span>Never expires</span>
                          {/if}
                        </div>
                      </div>

                      <!-- Bottom Settings: Watermark, Download, Password (same colour, no icons) -->
                      <div style="font-size: 0.73rem; line-height: 1.25; color: #94a3b8; display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
                        <span>
                          Download:
                          {#if share.allow_download_images && share.allow_download_folder}
                            Full
                          {:else if share.allow_download_images}
                            Images Only
                          {:else if share.allow_download_folder}
                            Folder Only
                          {:else}
                            Disabled
                          {/if}
                        </span>
                        {#if share.watermark_enabled}
                          <span style="color: #52525b;">•</span>
                          <span>Watermark: {share.watermark_template_name || 'Enabled'}</span>
                        {/if}
                        {#if share.has_password}
                          <span style="color: #52525b;">•</span>
                          <span>Password Protected</span>
                        {/if}
                        {#if share.allow_favorites}
                          <span style="color: #52525b;">•</span>
                          <span>Favorites Allowed</span>
                        {/if}
                      </div>

                      {#if share.folder_path !== data.folderPath}
                        <div style="margin-top: 6px;">
                          <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(59,130,246,0.2); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; border: 1px solid rgba(59,130,246,0.3);">
                            <Folder size={10} />
                            Inherited from: {share.folder_path || 'Root'}
                          </span>
                        </div>
                      {/if}
                    </div>

                    <div style="display: flex; gap: 6px; align-items: center;">
                      {#if share.can_manage !== false}
                        <button 
                          class="icon-btn" 
                          title="Edit Parameters" 
                          onclick={() => startEditingShare(share)}
                          style="color: {editingShareToken === share.share_token ? '#60a5fa' : '#a1a1aa'};">
                          <Pencil size={15} />
                        </button>
                        <button 
                          class="icon-btn" 
                          title={share.is_active === false ? "Enable Link" : "Disable Link (Temporary)"} 
                          onclick={() => handleToggleShareActive(share)}>
                          <Power size={15} color={share.is_active === false ? '#9ca3af' : '#10b981'} />
                        </button>
                        <button class="icon-btn" title="Copy Link" onclick={() => copyShareLink(share.share_token)}>
                          {#if copiedToken === share.share_token}
                            <Check size={15} color="#10b981" />
                          {:else}
                            <Copy size={15} color="#a1a1aa" />
                          {/if}
                        </button>
                        <button class="icon-btn" title="Revoke Link" onclick={() => handleRevokeShare(share.share_token)}>
                          <Trash2 size={15} color="#a1a1aa" />
                        </button>
                      {/if}
                    </div>
                  </div>

                  {#if editingShareToken === share.share_token}
                    <div style="margin-top: 10px; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); border-radius: 6px;">
                      <div style="font-size: 0.82rem; color: #fff; margin-bottom: 8px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                        <Pencil size={13} color="#60a5fa" />
                        <span>Edit Share Parameters</span>
                      </div>

                      <!-- Label Section -->
                      <div style="margin-bottom: 12px;">
                        <label for="editLabel-{share.share_token}" style="display: flex; align-items: center; gap: 5px; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">
                          <Tag size={12} color="#c084fc" />
                          <span>Label (Internal Reference)</span>
                        </label>
                        <input
                          id="editLabel-{share.share_token}"
                          type="text"
                          bind:value={editShareLabel}
                          placeholder="e.g. Wedding Client, Instagram Link, Vendor Preview"
                          style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.78rem;"
                        />
                      </div>

                      <!-- Expiration Section -->
                      <div style="margin-bottom: 12px;">
                        <label style="display: block; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">Expiration</label>
                        <div style="display: flex; gap: 6px; margin-bottom: 6px;">
                          <button 
                            type="button" 
                            class="btn" 
                            style="flex: 1; padding: 4px 6px; font-size: 0.75rem; background: {editExpiryMode === 'duration' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                            onclick={() => editExpiryMode = 'duration'}>
                            Duration
                          </button>
                          <button 
                            type="button" 
                            class="btn" 
                            style="flex: 1; padding: 4px 6px; font-size: 0.75rem; background: {editExpiryMode === 'date' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                            onclick={() => editExpiryMode = 'date'}>
                            Date & Time
                          </button>
                          <button 
                            type="button" 
                            class="btn" 
                            style="flex: 1; padding: 4px 6px; font-size: 0.75rem; background: {editExpiryMode === 'never' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                            onclick={() => editExpiryMode = 'never'}>
                            Never
                          </button>
                        </div>

                        {#if editExpiryMode === 'duration'}
                          <div style="display: flex; gap: 6px;">
                            <input type="number" bind:value={editExpiryValue} min="1" style="width: 70px; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.8rem;" />
                            <select bind:value={editExpiryUnit} style="flex: 1; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.8rem;">
                              <option value="hours">Hours</option>
                              <option value="days">Days</option>
                              <option value="months">Months</option>
                              <option value="years">Years</option>
                            </select>
                          </div>
                        {:else if editExpiryMode === 'date'}
                          <div>
                            <input type="datetime-local" bind:value={editExpiryDateTime} style="width: 100%; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.8rem;" />
                          </div>
                        {/if}
                      </div>

                      <!-- Options Section -->
                      <div style="margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
                        <label style="display: block; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">Options</label>
                        
                        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editDlImg-{share.share_token}" bind:checked={editAllowDownloadImages} style="width: 15px; height: 15px;" />
                          <label for="editDlImg-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow downloading individual images</label>
                        </div>

                        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editDlFolder-{share.share_token}" bind:checked={editAllowDownloadFolder} style="width: 15px; height: 15px;" />
                          <label for="editDlFolder-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow downloading entire folder (ZIP)</label>
                        </div>

                        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editDlFav-{share.share_token}" bind:checked={editAllowFavorites} style="width: 15px; height: 15px;" />
                          <label for="editDlFav-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow visitors to favorite photos</label>
                        </div>

                        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editDlFilterFav-{share.share_token}" bind:checked={editAllowFilterFavorites} style="width: 15px; height: 15px;" />
                          <label for="editDlFilterFav-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow visitors to filter favorites</label>
                        </div>

                        <div style="display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editActive-{share.share_token}" bind:checked={editIsActive} style="width: 15px; height: 15px;" />
                          <label for="editActive-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Link is active (enabled)</label>
                        </div>
                      </div>

                      <!-- Password Section in Edit Share -->
                      <div style="margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                          <label for="editPwd-{share.share_token}" style="display: flex; align-items: center; gap: 5px; font-size: 0.75rem; color: #aaa;">
                            <Lock size={12} color="#60a5fa" />
                            <span>{share.has_password ? 'Change Password' : 'Set Password (Optional)'}</span>
                          </label>
                          <button
                            type="button"
                            class="btn"
                            style="padding: 2px 6px; font-size: 0.7rem; background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.3); display: flex; align-items: center; gap: 4px;"
                            onclick={handleGenerateEditSharePassword}
                            title="Generate natural language password"
                          >
                            <Sparkles size={11} />
                            <span>Generate</span>
                          </button>
                        </div>
                        <div style="position: relative; display: flex; align-items: center;">
                          <input
                            id="editPwd-{share.share_token}"
                            type={showEditSharePassword ? 'text' : 'password'}
                            bind:value={editSharePassword}
                            placeholder={share.has_password ? 'Leave blank to keep existing password' : 'Leave blank for no password'}
                            disabled={editRemovePassword}
                            style="width: 100%; padding: 6px 64px 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.78rem; font-family: monospace;"
                          />
                          <div style="position: absolute; right: 4px; display: flex; gap: 4px; align-items: center;">
                            {#if editSharePassword}
                              <button
                                type="button"
                                class="icon-btn"
                                style="padding: 3px; color: #a1a1aa;"
                                onclick={() => { copyToClipboard(editSharePassword); toast.success('Password copied!'); }}
                                title="Copy password"
                              >
                                <Copy size={13} />
                              </button>
                            {/if}
                            <button
                              type="button"
                              class="icon-btn"
                              style="padding: 3px; color: #a1a1aa;"
                              onclick={() => showEditSharePassword = !showEditSharePassword}
                              title={showEditSharePassword ? "Hide password" : "Show password"}
                            >
                              {#if showEditSharePassword}
                                <EyeOff size={13} />
                              {:else}
                                <Eye size={13} />
                              {/if}
                            </button>
                          </div>
                        </div>
                        {#if share.has_password}
                          <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px;">
                            <input
                              type="checkbox"
                              id="removePwd-{share.share_token}"
                              bind:checked={editRemovePassword}
                              style="width: 14px; height: 14px;"
                              onchange={() => { if (editRemovePassword) editSharePassword = ''; }}
                            />
                            <label for="removePwd-{share.share_token}" style="font-size: 0.75rem; color: #f87171; cursor: pointer;">
                              Remove password protection
                            </label>
                          </div>
                        {/if}
                      </div>

                      <!-- Creation Date Section -->
                      <div style="margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
                        <label for="editCreatedAt-{share.share_token}" style="display: flex; align-items: center; gap: 5px; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">
                          <Clock size={12} color="#60a5fa" />
                          <span>Creation Date</span>
                        </label>
                        <input
                          id="editCreatedAt-{share.share_token}"
                          type="datetime-local"
                          bind:value={editCreatedAtDateTime}
                          style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.78rem;"
                        />
                      </div>

                      <div style="display: flex; justify-content: flex-end; gap: 6px;">
                        <button class="btn" style="padding: 4px 8px; font-size: 0.75rem; background: transparent; border: 1px solid var(--glass-border); color: #888;" onclick={() => editingShareToken = null}>
                          Cancel
                        </button>
                        <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: var(--text-color); color: var(--bg-color);" disabled={isSavingShareEdit} onclick={() => handleSaveShareEdit(share.share_token)}>
                          {isSavingShareEdit ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <!-- Expired Links Subtab -->
          {#if expiredSharesList.length === 0}
            <p style="color: #666; font-size: 0.875rem;">No expired links for this folder.</p>
          {:else}
            <div style="display: flex; flex-direction: column; gap: 12px; max-height: 280px; overflow-y: auto;">
              {#each expiredSharesList as share}
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(239, 68, 68, 0.2); padding: 12px; border-radius: 6px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                    <div style="flex: 1; min-width: 0;">
                      <!-- Main Title: Label (or Share Link if no label) + Status Badge -->
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                        <span style="color: #f4f4f5; font-weight: 600; font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                          {share.label || 'Share Link'}
                        </span>
                        <span style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500; flex-shrink: 0;">
                          Expired
                        </span>
                      </div>

                      <!-- Subheading: Back of the link (...token) -->
                      <div style="font-family: monospace; color: #a1a1aa; font-size: 0.78rem; margin-bottom: 6px;">
                        ...{share.share_token.slice(-8)}
                      </div>

                      <!-- Dates: Creation & Expiration -->
                      <div style="font-size: 0.75rem; color: #a1a1aa; display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px;">
                        {#if share.created_at}
                          <div>
                            <span style="color: #71717a;">Created:</span> {formatShareDate(share.created_at)}
                          </div>
                        {/if}
                        <div>
                          <span style="color: #71717a;">Expired:</span>
                          <span style="color: #f87171;">{formatShareDate(share.expires_at)}</span>
                        </div>
                      </div>

                      <!-- Bottom Settings: Watermark, Download, Password (same colour, no icons) -->
                      <div style="font-size: 0.73rem; line-height: 1.25; color: #94a3b8; display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
                        <span>
                          Download:
                          {#if share.allow_download_images && share.allow_download_folder}
                            Full
                          {:else if share.allow_download_images}
                            Images Only
                          {:else if share.allow_download_folder}
                            Folder Only
                          {:else}
                            Disabled
                          {/if}
                        </span>
                        {#if share.watermark_enabled}
                          <span style="color: #52525b;">•</span>
                          <span>Watermark: {share.watermark_template_name || 'Enabled'}</span>
                        {/if}
                        {#if share.has_password}
                          <span style="color: #52525b;">•</span>
                          <span>Password Protected</span>
                        {/if}
                        {#if share.allow_favorites}
                          <span style="color: #52525b;">•</span>
                          <span>Favorites Allowed</span>
                        {/if}
                      </div>
                    </div>

                    <div style="display: flex; gap: 6px; align-items: center;">
                      {#if share.can_manage !== false}
                        <button 
                          class="icon-btn" 
                          title="Edit Parameters" 
                          onclick={() => startEditingShare(share)}
                          style="color: {editingShareToken === share.share_token ? '#60a5fa' : '#a1a1aa'};">
                          <Pencil size={15} />
                        </button>
                        <button 
                          class="btn" 
                          style="padding: 4px 8px; font-size: 0.75rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); color: #93c5fd; display: flex; align-items: center; gap: 4px;"
                          title="Extend Validity" 
                          onclick={() => { extendingToken = extendingToken === share.share_token ? null : share.share_token; editingShareToken = null; }}>
                          <Clock size={12} />
                          <span>Extend</span>
                        </button>
                        <button class="icon-btn" title="Copy Link" onclick={() => copyShareLink(share.share_token)}>
                          {#if copiedToken === share.share_token}
                            <Check size={15} color="#10b981" />
                          {:else}
                            <Copy size={15} color="#a1a1aa" />
                          {/if}
                        </button>
                        <button class="icon-btn" title="Revoke Link" onclick={() => handleRevokeShare(share.share_token)}>
                          <Trash2 size={15} color="#a1a1aa" />
                        </button>
                      {/if}
                    </div>
                  </div>

                  {#if editingShareToken === share.share_token}
                    <div style="margin-top: 10px; padding: 12px; background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); border-radius: 6px;">
                      <div style="font-size: 0.82rem; color: #fff; margin-bottom: 8px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                        <Pencil size={13} color="#60a5fa" />
                        <span>Edit Share Parameters</span>
                      </div>

                      <!-- Label Section -->
                      <div style="margin-bottom: 12px;">
                        <label for="editLabel-{share.share_token}" style="display: flex; align-items: center; gap: 5px; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">
                          <Tag size={12} color="#c084fc" />
                          <span>Label (Internal Reference)</span>
                        </label>
                        <input
                          id="editLabel-{share.share_token}"
                          type="text"
                          bind:value={editShareLabel}
                          placeholder="e.g. Wedding Client, Instagram Link, Vendor Preview"
                          style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.78rem;"
                        />
                      </div>

                      <!-- Expiration Section -->
                      <div style="margin-bottom: 12px;">
                        <label style="display: block; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">Expiration</label>
                        <div style="display: flex; gap: 6px; margin-bottom: 6px;">
                          <button 
                            type="button" 
                            class="btn" 
                            style="flex: 1; padding: 4px 6px; font-size: 0.75rem; background: {editExpiryMode === 'duration' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                            onclick={() => editExpiryMode = 'duration'}>
                            Duration
                          </button>
                          <button 
                            type="button" 
                            class="btn" 
                            style="flex: 1; padding: 4px 6px; font-size: 0.75rem; background: {editExpiryMode === 'date' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                            onclick={() => editExpiryMode = 'date'}>
                            Date & Time
                          </button>
                          <button 
                            type="button" 
                            class="btn" 
                            style="flex: 1; padding: 4px 6px; font-size: 0.75rem; background: {editExpiryMode === 'never' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                            onclick={() => editExpiryMode = 'never'}>
                            Never
                          </button>
                        </div>

                        {#if editExpiryMode === 'duration'}
                          <div style="display: flex; gap: 6px;">
                            <input type="number" bind:value={editExpiryValue} min="1" style="width: 70px; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.8rem;" />
                            <select bind:value={editExpiryUnit} style="flex: 1; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.8rem;">
                              <option value="hours">Hours</option>
                              <option value="days">Days</option>
                              <option value="months">Months</option>
                              <option value="years">Years</option>
                            </select>
                          </div>
                        {:else if editExpiryMode === 'date'}
                          <div>
                            <input type="datetime-local" bind:value={editExpiryDateTime} style="width: 100%; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.8rem;" />
                          </div>
                        {/if}
                      </div>

                      <!-- Options Section -->
                      <div style="margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
                        <label style="display: block; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">Options</label>
                        
                        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editExpDlImg-{share.share_token}" bind:checked={editAllowDownloadImages} style="width: 15px; height: 15px;" />
                          <label for="editExpDlImg-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow downloading individual images</label>
                        </div>

                        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editExpDlFolder-{share.share_token}" bind:checked={editAllowDownloadFolder} style="width: 15px; height: 15px;" />
                          <label for="editExpDlFolder-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow downloading entire folder (ZIP)</label>
                        </div>

                        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editExpDlFav-{share.share_token}" bind:checked={editAllowFavorites} style="width: 15px; height: 15px;" />
                          <label for="editExpDlFav-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow visitors to favorite photos</label>
                        </div>

                        <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editExpDlFilterFav-{share.share_token}" bind:checked={editAllowFilterFavorites} style="width: 15px; height: 15px;" />
                          <label for="editExpDlFilterFav-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow visitors to filter favorites</label>
                        </div>

                        <div style="display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editExpActive-{share.share_token}" bind:checked={editIsActive} style="width: 15px; height: 15px;" />
                          <label for="editExpActive-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Link is active (reactivate link)</label>
                        </div>
                      </div>

                      <div style="display: flex; justify-content: flex-end; gap: 6px;">
                        <button class="btn" style="padding: 4px 8px; font-size: 0.75rem; background: transparent; border: 1px solid var(--glass-border); color: #888;" onclick={() => editingShareToken = null}>
                          Cancel
                        </button>
                        <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: var(--text-color); color: var(--bg-color);" disabled={isSavingShareEdit} onclick={() => handleSaveShareEdit(share.share_token)}>
                          {isSavingShareEdit ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </div>
                  {/if}

                  {#if extendingToken === share.share_token}
                    <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); border-radius: 6px;">
                      <div style="font-size: 0.8rem; color: #ccc; margin-bottom: 6px; font-weight: 500;">Extend Validity:</div>
                      <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                        <button 
                          type="button" 
                          class="btn" 
                          style="flex: 1; padding: 4px; font-size: 0.75rem; background: {extendExpiryMode === 'duration' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                          onclick={() => extendExpiryMode = 'duration'}>
                          Duration
                        </button>
                        <button 
                          type="button" 
                          class="btn" 
                          style="flex: 1; padding: 4px; font-size: 0.75rem; background: {extendExpiryMode === 'date' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                          onclick={() => extendExpiryMode = 'date'}>
                          Specific Date & Time
                        </button>
                      </div>

                      {#if extendExpiryMode === 'duration'}
                        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                          <input type="number" bind:value={extendExpiryValue} min="1" style="width: 60px; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;" />
                          <select bind:value={extendExpiryUnit} style="flex: 1; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;">
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                            <option value="months">Months</option>
                            <option value="years">Years</option>
                          </select>
                        </div>
                      {:else}
                        <div style="margin-bottom: 8px;">
                          <input type="datetime-local" bind:value={extendExpiryDateTime} style="width: 100%; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;" />
                        </div>
                      {/if}

                      <div style="display: flex; justify-content: flex-end; gap: 6px;">
                        <button class="btn" style="padding: 4px 8px; font-size: 0.75rem; background: transparent; border: 1px solid var(--glass-border); color: #888;" onclick={() => extendingToken = null}>Cancel</button>
                        <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: var(--text-color); color: var(--bg-color);" disabled={isExtending} onclick={() => handleExtendShare(share.share_token)}>
                          {isExtending ? 'Extending...' : 'Save & Extend'}
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>

    {:else}
      <!-- Access Requests Tab -->
      <div>
        <h4 style="margin-bottom: 12px; font-weight: 500;">Access Requests</h4>
        {#if accessRequests.length === 0}
          <p style="color: #666; font-size: 0.875rem;">No access requests for this folder.</p>
        {:else}
          <div style="display: flex; flex-direction: column; gap: 12px; max-height: 400px; overflow-y: auto;">
            {#each accessRequests as req}
              <div style="background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); padding: 14px; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                  <div>
                    <div style="font-weight: 500; color: #f4f4f5; font-size: 0.95rem;">
                      {req.name || 'Anonymous Requester'}
                    </div>
                    {#if req.email}
                      <div style="font-size: 0.78rem; color: #60a5fa; display: flex; align-items: center; gap: 4px; margin-top: 2px;">
                        <Mail size={12} />
                        {req.email}
                      </div>
                    {/if}
                  </div>
                  <div>
                    {#if req.status === 'pending'}
                      <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.7rem; padding: 2px 8px; border-radius: 9999px; font-weight: 500;">
                        Pending
                      </span>
                    {:else}
                      <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.7rem; padding: 2px 8px; border-radius: 9999px; font-weight: 500;">
                        Resolved
                      </span>
                    {/if}
                  </div>
                </div>

                {#if req.note}
                  <div style="background: rgba(0,0,0,0.3); border-radius: 6px; padding: 8px 10px; font-size: 0.8rem; color: #d4d4d8; margin-bottom: 10px; font-style: italic;">
                    "{req.note}"
                  </div>
                {/if}

                <div style="font-size: 0.72rem; color: #71717a; display: flex; gap: 12px; margin-bottom: 10px;">
                  <span>Requested: {formatShareDate(req.created_at)}</span>
                  <span>Link: ...{req.share_token.substring(0, 8)}</span>
                </div>

                {#if req.status === 'pending'}
                  {#if respondingRequestId === req.id}
                    <div style="background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); border-radius: 6px; padding: 12px; margin-top: 8px;">
                      <div style="font-size: 0.825rem; font-weight: 500; margin-bottom: 8px; color: #ccc;">How to handle this request:</div>
                      
                      <div style="display: flex; gap: 12px; margin-bottom: 10px;">
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #ddd; cursor: pointer;">
                          <input type="radio" name="req-action-{req.id}" value="extend" bind:group={requestAction} />
                          Reactivate / Extend validity
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #ddd; cursor: pointer;">
                          <input type="radio" name="req-action-{req.id}" value="new_link" bind:group={requestAction} />
                          Share a new link
                        </label>
                      </div>

                      <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 0.75rem; color: #999; margin-bottom: 6px;">Validity Period</label>
                        <div style="display: flex; gap: 6px; margin-bottom: 6px;">
                          <button 
                            type="button" 
                            class="btn" 
                            style="flex: 1; padding: 4px 6px; font-size: 0.75rem; background: {requestExpiryMode === 'duration' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                            onclick={() => requestExpiryMode = 'duration'}>
                            Duration
                          </button>
                          <button 
                            type="button" 
                            class="btn" 
                            style="flex: 1; padding: 4px 6px; font-size: 0.75rem; background: {requestExpiryMode === 'date' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                            onclick={() => requestExpiryMode = 'date'}>
                            Date & Time
                          </button>
                          <button 
                            type="button" 
                            class="btn" 
                            style="flex: 1; padding: 4px 6px; font-size: 0.75rem; background: {requestExpiryMode === 'never' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                            onclick={() => requestExpiryMode = 'never'}>
                            Never
                          </button>
                        </div>

                        {#if requestExpiryMode === 'duration'}
                          <div style="display: flex; gap: 6px;">
                            <input type="number" bind:value={requestExpiryValue} min="1" style="width: 70px; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.8rem;" />
                            <select bind:value={requestExpiryUnit} style="flex: 1; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.8rem;">
                              <option value="hours">Hours</option>
                              <option value="days">Days</option>
                              <option value="months">Months</option>
                              <option value="years">Years</option>
                            </select>
                          </div>
                        {:else if requestExpiryMode === 'date'}
                          <div>
                            <input type="datetime-local" bind:value={requestExpiryDateTime} style="width: 100%; padding: 6px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.8rem;" />
                          </div>
                        {/if}
                      </div>

                      {#if req.email}
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                          <input type="checkbox" id="notify-user-{req.id}" bind:checked={requestNotifyUser} style="width: 16px; height: 16px;" />
                          <label for="notify-user-{req.id}" style="font-size: 0.8rem; color: #ccc; cursor: pointer;">
                            Notify requester via email ({req.email})
                          </label>
                        </div>
                      {/if}

                      <div style="display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background: transparent; border: 1px solid var(--glass-border); color: #888;" onclick={() => respondingRequestId = null}>
                          Cancel
                        </button>
                        <button class="btn" style="padding: 4px 12px; font-size: 0.75rem; background: var(--text-color); color: var(--bg-color);" disabled={isRespondingRequest} onclick={() => handleRespondRequest(req)}>
                          {isRespondingRequest ? 'Processing...' : 'Grant Access'}
                        </button>
                      </div>
                    </div>
                  {:else}
                    <button class="btn" style="padding: 6px 12px; font-size: 0.8rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); color: #93c5fd;" onclick={() => { 
                      respondingRequestId = req.id; 
                      requestNotifyUser = Boolean(req.email);
                      requestExpiryMode = 'duration';
                      requestExpiryValue = 7;
                      requestExpiryUnit = 'days';
                      const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
                      requestExpiryDateTime = toDateTimeLocal(future);
                    }}>
                      Respond to Request
                    </button>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</Modal>

<Modal bind:show={showSettingsModal} id="folder-settings" title="Folder Settings">
  <div class="form-group" style="margin-bottom: 16px;">
    <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; color: #888;">View Name (Read Only)</label>
    <input type="text" readonly value={data.folderPath || 'Home'} style="width: 100%; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #888; border-radius: 4px;" />
  </div>
  <div class="form-group">
    <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; color: #ccc;">Description</label>
    <textarea bind:value={folderDescInput} placeholder="Add a description..." style="width: 100%; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; min-height: 100px; font-family: inherit; resize: vertical;"></textarea>
  </div>
  <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
    <button class="btn" onclick={handleSaveSettings} disabled={isSavingSettings}>
      {#if isSavingSettings}
        Saving...
      {:else}
        <Check size={18} style="margin-right: 8px; display: inline-block; vertical-align: middle;" />
        <span style="display: inline-block; vertical-align: middle;">Save Changes</span>
      {/if}
    </button>
  </div>

  <hr style="border-color: rgba(255,255,255,0.1); margin: 24px 0;" />
  
  <h4 style="margin-bottom: 16px; font-weight: 500;">Advanced Actions</h4>
  <div style="display: flex; flex-direction: column; gap: 12px;">
    <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: white; width: 100%; justify-content: flex-start;" onclick={handleRescanFolder} disabled={isRescanning}>
      {isRescanning ? 'Queuing...' : 'Rescan Folder for New Images'}
    </button>
    
    <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: white; width: 100%; justify-content: flex-start;" onclick={handleRescanML} disabled={isRescanningML}>
      {isRescanningML ? 'Queuing...' : 'Rescan Faces & Items in Images'}
    </button>
    
    <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: white; width: 100%; justify-content: flex-start;" onclick={handleRegenerateOG} disabled={isRegeneratingOG}>
      {isRegeneratingOG ? 'Regenerating...' : 'Regenerate WhatsApp / OG Images'}
    </button>
    
    <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: white; width: 100%; justify-content: flex-start;" onclick={handleRegenerateWatermarks} disabled={isRegeneratingWatermarks}>
      {isRegeneratingWatermarks ? 'Regenerating...' : 'Regenerate Watermarked Photos'}
    </button>
    
    <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #ff9999; width: 100%; justify-content: flex-start;" onclick={handleRegenerateImages} disabled={isRegeneratingImages}>
      {isRegeneratingImages ? 'Queuing...' : 'Regenerate All Image Thumbnails'}
    </button>
    
    <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #ff9999; width: 100%; justify-content: flex-start;" onclick={handleRegenerateVideos} disabled={isRegeneratingVideos}>
      {isRegeneratingVideos ? 'Queuing...' : 'Regenerate Video Transcodes & Thumbnails'}
    </button>
  </div>
</Modal>

<Modal bind:show={showGDriveModal} id="folder-gdrive-sync" title="Google Drive Cloud Sync">
  <div style="max-height: 80vh; overflow-y: auto; padding-right: 4px;">
    {#if isGDriveLoading}
      <div style="padding: 24px; text-align: center; color: #888; font-size: 0.9rem;">
        <Loader2 size={24} class="animate-spin" style="margin: 0 auto 8px;" />
        Checking Google Drive status...
      </div>
    {:else if gdriveSyncInfo?.synced && gdriveSyncInfo.sync}
      <!-- Success Link Box (Identical to Share Modal's newlyCreatedShareToken box) -->
      <div style="background: rgba(0,255,100,0.1); border: 1px solid rgba(0,255,100,0.3); padding: 16px; border-radius: 8px; margin-bottom: 20px;">
        <p style="color: #4ade80; margin-bottom: 8px; font-weight: 500; display: flex; align-items: center; justify-content: space-between;">
          <span style="display: flex; align-items: center; gap: 6px;">
            <Cloud size={16} /> Google Drive Folder Synced
          </span>
          <span style="font-size: 0.7rem; background: {gdriveSyncInfo.sync.sync_status === 'PAUSED' ? 'rgba(234,179,8,0.2)' : 'rgba(16,185,129,0.2)'}; color: {gdriveSyncInfo.sync.sync_status === 'PAUSED' ? '#fbbf24' : '#34d399'}; padding: 2px 8px; border-radius: 4px; font-weight: 500;">
            {gdriveSyncInfo.sync.sync_status === 'PAUSED' ? 'Paused' : gdriveSyncInfo.sync.sync_status === 'SYNCING' ? 'Syncing...' : 'Active'}
          </span>
        </p>
        <div style="display: flex; gap: 8px;">
          <input 
            type="text" 
            readonly 
            value={gdriveSyncInfo.sync.gdrive_link} 
            style="flex: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.85rem;" 
          />
          <button 
            class="icon-btn" 
            style="display: flex; align-items: center; justify-content: center;" 
            title="Copy Drive Link"
            onclick={() => {
              navigator.clipboard.writeText(gdriveSyncInfo?.sync?.gdrive_link || '');
              gdriveCopied = true;
              toast.success('Google Drive link copied!');
              setTimeout(() => gdriveCopied = false, 2000);
            }}
          >
            {#if gdriveCopied}
              <Check size={18} color="#10b981" />
            {:else}
              <Copy size={18} color="#a1a1aa" />
            {/if}
          </button>
          <button 
            class="icon-btn" 
            style="display: flex; align-items: center; justify-content: center;" 
            title="Show QR Code"
            onclick={() => openGDriveQrModal(gdriveSyncInfo?.sync?.gdrive_link || '')}
          >
            <QrCode size={18} color="#a1a1aa" />
          </button>
          <a 
            href={gdriveSyncInfo.sync.gdrive_link} 
            target="_blank" 
            rel="noopener noreferrer" 
            class="icon-btn" 
            style="display: flex; align-items: center; justify-content: center; text-decoration: none;" 
            title="Open in Google Drive"
          >
            <ExternalLink size={18} color="#a1a1aa" />
          </a>
        </div>
      </div>

      <!-- Sync Status & Details (Identical to Share Modal's Active Links List item style) -->
      <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--glass-border);">
        <h4 style="margin-bottom: 12px; font-weight: 500;">Sync Information</h4>
        <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); padding: 12px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="color: #e4e4e7; font-weight: 500; font-size: 0.95rem;">{gdriveSyncInfo.sync.gdrive_folder_name}</span>
                <span style="background: {gdriveSyncInfo.sync.sync_status === 'PAUSED' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)'}; color: {gdriveSyncInfo.sync.sync_status === 'PAUSED' ? '#fbbf24' : '#34d399'}; border: 1px solid {gdriveSyncInfo.sync.sync_status === 'PAUSED' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)'}; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">
                  {gdriveSyncInfo.sync.sync_status === 'PAUSED' ? 'Paused' : gdriveSyncInfo.sync.sync_status === 'SYNCING' ? 'Syncing' : 'Active'}
                </span>
              </div>

              <div style="font-size: 0.8rem; color: #60a5fa; margin-bottom: 4px; font-weight: 500;">
                {gdriveSyncInfo.sync.syncedFileCount || 0} / {gdriveSyncInfo.sync.totalLocalJpegs || (gdriveSyncInfo.sync.syncedFileCount || 0)} Synced
              </div>

              <!-- Progress bar -->
              <div style="height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin-bottom: 6px; max-width: 300px;">
                <div style="height: 100%; width: {Math.max(gdriveSyncInfo.sync.totalLocalJpegs || 0, gdriveSyncInfo.sync.syncedFileCount || 0) > 0 ? Math.min(100, Math.round(((gdriveSyncInfo.sync.syncedFileCount || 0) / Math.max(gdriveSyncInfo.sync.totalLocalJpegs || 0, gdriveSyncInfo.sync.syncedFileCount || 0)) * 100)) : 100}%; background: {gdriveSyncInfo.sync.sync_status === 'PAUSED' ? '#eab308' : '#34d399'}; transition: width 0.3s;"></div>
              </div>

              <div style="font-size: 0.72rem; color: #888; display: flex; gap: 10px; flex-wrap: wrap;">
                <span>{Math.max(gdriveSyncInfo.sync.totalLocalJpegs || 0, gdriveSyncInfo.sync.syncedFileCount || 0) > 0 ? Math.min(100, Math.round(((gdriveSyncInfo.sync.syncedFileCount || 0) / Math.max(gdriveSyncInfo.sync.totalLocalJpegs || 0, gdriveSyncInfo.sync.syncedFileCount || 0)) * 100)) : 100}% Completed</span>
                <span>•</span>
                <span>{gdriveSyncInfo.sync.sync_status === 'PAUSED' ? 'Sync Paused' : gdriveSyncInfo.sync.sync_status === 'SYNCING' ? 'Uploading in background...' : 'Up to date'}</span>
              </div>
            </div>

            <!-- Management Icon Buttons (Same as Share list icon buttons) -->
            <div style="display: flex; gap: 6px; align-items: center;">
              <button 
                class="icon-btn" 
                title={gdriveSyncInfo.sync.sync_status === 'PAUSED' ? "Resume Sync" : "Pause Sync"} 
                onclick={handleTogglePauseGDriveSync}
                disabled={isTogglingPause || isDeletingGDrive}>
                {#if gdriveSyncInfo.sync.sync_status === 'PAUSED'}
                  <Play size={15} color="#10b981" />
                {:else}
                  <Pause size={15} color="#fbbf24" />
                {/if}
              </button>

              <button 
                class="icon-btn" 
                title="Sync Now" 
                onclick={handleTriggerGDriveSync}
                disabled={isSyncingNowGDrive || isDeletingGDrive || gdriveSyncInfo.sync.sync_status === 'PAUSED'}>
                <RefreshCw size={15} class={isSyncingNowGDrive ? 'animate-spin' : ''} color="#a1a1aa" />
              </button>

              <button 
                class="icon-btn" 
                title="Copy Link" 
                onclick={() => {
                  navigator.clipboard.writeText(gdriveSyncInfo?.sync?.gdrive_link || '');
                  gdriveCopied = true;
                  toast.success('Google Drive link copied!');
                  setTimeout(() => gdriveCopied = false, 2000);
                }}>
                {#if gdriveCopied}
                  <Check size={15} color="#10b981" />
                {:else}
                  <Copy size={15} color="#a1a1aa" />
                {/if}
              </button>

              <button 
                class="icon-btn" 
                title="Unlink Folder" 
                onclick={handleUnlinkGDriveSync}
                disabled={isDeletingGDrive}>
                <Unlink size={15} color="#a1a1aa" />
              </button>

              <button 
                class="icon-btn" 
                title="Delete from Google Drive" 
                onclick={handleDeleteGDriveFolder}
                disabled={isDeletingGDrive}>
                <Trash2 size={15} color="#f87171" />
              </button>
            </div>
          </div>
        </div>

        <!-- Caesium Compression Configuration for Active Sync -->
        <div style="margin-top: 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); padding: 14px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: {isEditingCaesium ? '12px' : '0'};">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <Minimize2 size={16} color="#60a5fa" />
                <span style="font-weight: 500; font-size: 0.9rem; color: #f4f4f5;">Caesium Compression</span>
                {#if !gdriveSyncInfo.sync.caesium_enabled}
                  <span style="font-size: 0.68rem; background: rgba(255,255,255,0.1); color: #a1a1aa; padding: 1px 6px; border-radius: 4px;">
                    Off (Full Size)
                  </span>
                {/if}
              </div>
              <div style="font-size: 0.75rem; color: #a1a1aa; margin-top: 2px;">
                {#if gdriveSyncInfo.sync.caesium_enabled}
                  {#if (gdriveSyncInfo.sync.caesium_config?.mode || 'lossy') === 'lossless'}
                    Lossless compression (pixel-perfect quality)
                  {:else if gdriveSyncInfo.sync.caesium_config?.mode === 'max_size'}
                    Target max size: {gdriveSyncInfo.sync.caesium_config?.max_size || '1MB'}
                  {:else}
                    Quality {gdriveSyncInfo.sync.caesium_config?.quality ?? 80}% lossy
                  {/if}
                  {#if gdriveSyncInfo.sync.caesium_config?.width || gdriveSyncInfo.sync.caesium_config?.height}
                    • Max {gdriveSyncInfo.sync.caesium_config.width || 'auto'}×{gdriveSyncInfo.sync.caesium_config.height || 'auto'}px
                  {/if}
                  {#if gdriveSyncInfo.sync.caesium_config?.keep_exif !== false}
                    • EXIF preserved
                  {/if}
                {:else}
                  Images uploaded to Google Drive without compression
                {/if}
              </div>
            </div>

            <button 
              type="button" 
              class="btn" 
              style="padding: 4px 10px; font-size: 0.75rem; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: #ccc;"
              onclick={() => isEditingCaesium = !isEditingCaesium}
            >
              <SlidersHorizontal size={13} style="margin-right: 4px;" />
              {isEditingCaesium ? 'Close' : 'Configure'}
            </button>
          </div>

          {#if isEditingCaesium}
            <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; margin-top: 8px;">
              <!-- Toggle Enabled -->
              <label style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; cursor: pointer;">
                <span style="font-size: 0.85rem; color: #eee; font-weight: 500;">Compress images before Google Drive upload</span>
                <input type="checkbox" bind:checked={editCaesiumEnabled} style="width: 16px; height: 16px; accent-color: #3b82f6;" />
              </label>

              {#if editCaesiumEnabled}
                <!-- Mode tabs -->
                <div style="margin-bottom: 12px;">
                  <label style="display: block; font-size: 0.75rem; color: #aaa; margin-bottom: 6px;">Compression Mode</label>
                  <div style="display: flex; gap: 6px;">
                    <button 
                      type="button" 
                      class="btn" 
                      style="flex: 1; padding: 4px 8px; font-size: 0.75rem; background: {editCaesiumMode === 'lossy' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)'}; border: 1px solid {editCaesiumMode === 'lossy' ? '#3b82f6' : 'var(--glass-border)'}; color: white;"
                      onclick={() => editCaesiumMode = 'lossy'}>
                      Lossy (Quality)
                    </button>
                    <button 
                      type="button" 
                      class="btn" 
                      style="flex: 1; padding: 4px 8px; font-size: 0.75rem; background: {editCaesiumMode === 'lossless' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)'}; border: 1px solid {editCaesiumMode === 'lossless' ? '#3b82f6' : 'var(--glass-border)'}; color: white;"
                      onclick={() => editCaesiumMode = 'lossless'}>
                      Lossless
                    </button>
                    <button 
                      type="button" 
                      class="btn" 
                      style="flex: 1; padding: 4px 8px; font-size: 0.75rem; background: {editCaesiumMode === 'max_size' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)'}; border: 1px solid {editCaesiumMode === 'max_size' ? '#3b82f6' : 'var(--glass-border)'}; color: white;"
                      onclick={() => editCaesiumMode = 'max_size'}>
                      Target Size
                    </button>
                  </div>
                </div>

                {#if editCaesiumMode === 'lossy'}
                  <div style="margin-bottom: 12px; background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: #ccc; margin-bottom: 6px;">
                      <span>Quality Level:</span>
                      <strong style="color: #60a5fa;">{editCaesiumQuality}%</strong>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="100" 
                      bind:value={editCaesiumQuality} 
                      style="width: 100%; accent-color: #3b82f6; cursor: pointer;" 
                    />
                    <div style="display: flex; justify-content: space-between; font-size: 0.68rem; color: #888; margin-top: 2px;">
                      <span>Smaller file size</span>
                      <span>Higher visual fidelity</span>
                    </div>
                  </div>
                {:else if editCaesiumMode === 'max_size'}
                  <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 0.75rem; color: #aaa; margin-bottom: 4px;">Target Maximum File Size</label>
                    <div style="display: flex; gap: 6px;">
                      <input 
                        type="text" 
                        bind:value={editCaesiumMaxSize} 
                        placeholder="e.g. 1MB, 500KB, 2MB"
                        style="flex: 1; padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.8rem;" 
                      />
                      {#each ['500KB', '1MB', '2MB', '5MB'] as preset}
                        <button 
                          type="button" 
                          class="btn" 
                          style="padding: 4px 8px; font-size: 0.72rem; background: rgba(255,255,255,0.06); border: 1px solid var(--glass-border); color: #aaa;"
                          onclick={() => editCaesiumMaxSize = preset}>
                          {preset}
                        </button>
                      {/each}
                    </div>
                  </div>
                {:else}
                  <div style="margin-bottom: 12px; font-size: 0.75rem; color: #aaa; background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 4px;">
                    Lossless compression optimizes internal image structures and tables without altering any pixel data.
                  </div>
                {/if}

                <!-- Dimensions constraint -->
                <div style="margin-bottom: 12px;">
                  <label style="display: block; font-size: 0.75rem; color: #aaa; margin-bottom: 4px;">Dimension Limits (Optional, maintains aspect ratio without upscaling)</label>
                  <div style="display: flex; gap: 8px;">
                    <div style="flex: 1;">
                      <input 
                        type="number" 
                        bind:value={editCaesiumWidth} 
                        placeholder="Max Width (px)"
                        style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.8rem;" 
                      />
                    </div>
                    <div style="flex: 1;">
                      <input 
                        type="number" 
                        bind:value={editCaesiumHeight} 
                        placeholder="Max Height (px)"
                        style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.8rem;" 
                      />
                    </div>
                  </div>
                </div>

                <!-- EXIF Checkbox -->
                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: #ccc; margin-bottom: 12px; cursor: pointer;">
                  <input type="checkbox" bind:checked={editCaesiumKeepExif} style="accent-color: #3b82f6;" />
                  <span>Preserve EXIF metadata & camera information</span>
                </label>
              {/if}

              <!-- Remember & Recycle Controls -->
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.1);">
                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: #aaa; cursor: pointer;">
                  <input type="checkbox" bind:checked={editCaesiumSaveAsDefault} style="accent-color: #3b82f6;" />
                  <span>Remember as default for other folders</span>
                </label>

                <button 
                  type="button" 
                  class="btn" 
                  style="padding: 2px 8px; font-size: 0.72rem; background: transparent; border: 1px solid var(--glass-border); color: #888; display: inline-flex; align-items: center; gap: 4px;"
                  onclick={applyRememberedDefaultsForEdit}
                >
                  <RotateCcw size={11} /> Use Remembered Defaults
                </button>
              </div>

              <!-- Action buttons -->
              <div style="display: flex; gap: 8px;">
                <button 
                  type="button" 
                  class="btn" 
                  style="flex: 1; padding: 6px; font-size: 0.8rem; background: var(--text-color); color: var(--bg-color);"
                  onclick={handleSaveCaesiumSettings}
                  disabled={isSavingCaesium}
                >
                  {isSavingCaesium ? 'Saving Settings...' : 'Save Caesium Settings'}
                </button>
                <button 
                  type="button" 
                  class="btn" 
                  style="padding: 6px 12px; font-size: 0.8rem; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: #ccc;"
                  onclick={() => isEditingCaesium = false}
                  disabled={isSavingCaesium}
                >
                  Cancel
                </button>
              </div>
            </div>
          {/if}
        </div>

        <!-- Watermark Protection Configuration for Active Sync -->
        <div style="margin-top: 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); padding: 14px; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: {isEditingGDriveWatermark ? '12px' : '0'};">
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <Shield size={16} color="#60a5fa" />
                <span style="font-weight: 500; font-size: 0.9rem; color: #f4f4f5;">Watermark Protection</span>
                {#if shareGlobalEnforced}
                  <span style="font-size: 0.68rem; background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 1px 6px; border-radius: 4px;">
                    Globally Enforced
                  </span>
                {:else if !gdriveSyncInfo.sync.watermark_enabled}
                  <span style="font-size: 0.68rem; background: rgba(255,255,255,0.1); color: #a1a1aa; padding: 1px 6px; border-radius: 4px;">
                    None (Originals)
                  </span>
                {/if}
              </div>
              <div style="font-size: 0.75rem; color: #a1a1aa; margin-top: 2px;">
                {#if shareGlobalEnforced}
                  Admin enforced global template: {shareGlobalTemplateName}
                {:else if gdriveSyncInfo.sync.watermark_enabled}
                  Template: {gdriveSyncInfo.sync.watermark_template_name || watermarkTemplates.find(t => t.id === gdriveSyncInfo?.sync?.watermark_template_id)?.name || 'Default Template'}
                {:else}
                  Photos are uploaded to Google Drive without watermark
                {/if}
              </div>
            </div>

            {#if !shareGlobalEnforced}
              <button 
                type="button" 
                class="btn" 
                style="padding: 4px 10px; font-size: 0.75rem; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: #ccc;"
                onclick={() => isEditingGDriveWatermark = !isEditingGDriveWatermark}
              >
                <SlidersHorizontal size={13} style="margin-right: 4px;" />
                {isEditingGDriveWatermark ? 'Close' : 'Configure'}
              </button>
            {/if}
          </div>

          {#if isEditingGDriveWatermark && !shareGlobalEnforced}
            <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; margin-top: 8px;">
              <div class="form-group" style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.75rem; color: #aaa; margin-bottom: 6px;">Watermark Template</label>
                <select
                  bind:value={editGDriveWatermarkTemplateId}
                  style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.85rem;"
                >
                  <option value="">None (No Watermark)</option>
                  {#each watermarkTemplates as t}
                    <option value={t.id}>
                      {t.name} {t.is_default ? '(Default)' : ''} {!t.allow_hd_download ? `[${t.restricted_tier} restricted]` : ''}
                    </option>
                  {/each}
                </select>
              </div>

              <div style="display: flex; gap: 8px;">
                <button 
                  type="button" 
                  class="btn" 
                  style="flex: 1; padding: 6px; font-size: 0.8rem; background: var(--text-color); color: var(--bg-color);"
                  onclick={handleSaveGDriveWatermarkSettings}
                  disabled={isSavingGDriveWatermark}
                >
                  {isSavingGDriveWatermark ? 'Saving...' : 'Save Watermark Settings'}
                </button>
                <button 
                  type="button" 
                  class="btn" 
                  style="padding: 6px 12px; font-size: 0.8rem; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: #ccc;"
                  onclick={() => isEditingGDriveWatermark = false}
                  disabled={isSavingGDriveWatermark}
                >
                  Cancel
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Create New Google Drive Sync Section (Identical to Create New Share Link Section) -->
      <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--glass-border);">
        <h4 style="margin-bottom: 12px; font-weight: 500;">Enable Google Drive Sync</h4>

        {#if gdriveAccounts.length === 0}
          <div style="text-align: center; padding: 32px 16px; border: 1px dashed var(--glass-border); border-radius: 8px;">
            <Cloud size={36} style="color: #60a5fa; margin: 0 auto 12px;" />
            <p style="color: #ccc; font-size: 0.95rem; margin-bottom: 6px; font-weight: 500;">No Google Account Connected</p>
            <p style="color: #888; font-size: 0.85rem; margin-bottom: 16px; max-width: 380px; margin-left: auto; margin-right: auto;">
              Please connect your Google Drive account in Admin Settings before setting up sync for this folder.
            </p>
            <a href="/admin/settings" class="btn" style="text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
              <Settings size={15} /> Go to Admin Settings
            </a>
          </div>
        {:else}
          <div class="form-group" style="margin-bottom: 14px;">
            <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; color: #ccc;">Google Account</label>
            <select 
              bind:value={selectedGDriveAccount} 
              onchange={() => loadRemoteDriveFolders(selectedGDriveAccount)}
              style="width: 100%; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.875rem;"
            >
              {#each gdriveAccounts as acc}
                <option value={acc.id}>{acc.email} {acc.label && acc.label !== acc.email ? `(${acc.label})` : ''}</option>
              {/each}
            </select>
          </div>

          <div class="form-group" style="margin-bottom: 18px;">
            <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; color: #ccc;">Destination Folder</label>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
              <button 
                type="button" 
                class="btn" 
                style="flex: 1; padding: 6px 10px; font-size: 0.8rem; background: {gdriveMode === 'new' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                onclick={() => gdriveMode = 'new'}>
                Create New Folder
              </button>
              <button 
                type="button" 
                class="btn" 
                style="flex: 1; padding: 6px 10px; font-size: 0.8rem; background: {gdriveMode === 'existing' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border);"
                onclick={() => { gdriveMode = 'existing'; if (remoteDriveFolders.length === 0) loadRemoteDriveFolders(selectedGDriveAccount); }}>
                Choose Existing Folder
              </button>
            </div>

            {#if gdriveMode === 'new'}
              <div>
                <input 
                  type="text" 
                  bind:value={gdriveFolderNameInput} 
                  placeholder="e.g. Wedding 2026 Photos"
                  style="width: 100%; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit; font-size: 0.875rem;" 
                />
              </div>
            {:else}
              <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 0.8rem; color: #888;">Select existing Drive directory</span>
                  <button 
                    type="button" 
                    class="btn" 
                    style="padding: 2px 8px; font-size: 0.75rem; background: transparent; border: 1px solid var(--glass-border); color: #888;"
                    onclick={() => loadRemoteDriveFolders(selectedGDriveAccount)}
                    disabled={isLoadingRemoteFolders}
                  >
                    <RefreshCw size={12} class={isLoadingRemoteFolders ? 'animate-spin' : ''} style="margin-right: 4px;" /> Refresh
                  </button>
                </div>

                {#if isLoadingRemoteFolders}
                  <div style="padding: 16px; text-align: center; color: #888; font-size: 0.85rem;">
                    <Loader2 size={16} class="animate-spin" style="margin: 0 auto 6px;" />
                    Loading Drive folders...
                  </div>
                {:else if remoteDriveFolders.length === 0}
                  <div style="padding: 16px; text-align: center; color: #888; font-size: 0.85rem; border: 1px dashed var(--glass-border); border-radius: 4px;">
                    No folders found in this Google Drive account.
                  </div>
                {:else}
                  <input 
                    type="text" 
                    bind:value={remoteFolderSearch} 
                    placeholder="Filter folders..."
                    style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.85rem; margin-bottom: 8px;" 
                  />
                  <div style="max-height: 180px; overflow-y: auto; background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); border-radius: 4px; padding: 4px;">
                    {#each filteredRemoteDriveFolders as item}
                      <label style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 4px; cursor: pointer; transition: background 0.15s; background: {selectedExistingDriveFolderId === item.id ? 'rgba(255,255,255,0.1)' : 'transparent'};">
                        <input 
                          type="radio" 
                          name="drive-folder-radio" 
                          value={item.id} 
                          checked={selectedExistingDriveFolderId === item.id}
                          onchange={() => selectedExistingDriveFolderId = item.id}
                        />
                        <Folder size={15} color={selectedExistingDriveFolderId === item.id ? '#60a5fa' : '#94a3b8'} />
                        <span style="font-size: 0.85rem; color: #f4f4f5; flex: 1;">{item.name}</span>
                      </label>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Watermark Protection Configuration (Like Share Link Watermark Option) -->
          <div class="form-group" style="margin-bottom: 18px;">
            <label style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 0.875rem; color: #ccc;">
              <span style="display: flex; align-items: center; gap: 6px;">
                <Shield size={15} color="#60a5fa" /> Watermark Protection
              </span>
            </label>
            <p style="font-size: 0.75rem; color: #a1a1aa; margin: 0 0 8px 0;">
              Apply watermark to photos before compressing and uploading to Google Drive. Local files remain unmodified.
            </p>
            {#if shareGlobalEnforced}
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); padding: 8px 12px; border-radius: 6px;">
                <Lock size={15} color="#38bdf8" />
                <span>Enforced Globally by Admin ({shareGlobalTemplateName})</span>
              </div>
            {:else}
              <select
                bind:value={gdriveWatermarkTemplateId}
                style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.875rem;"
              >
                <option value="">None (No Watermark)</option>
                {#each watermarkTemplates as t}
                  <option value={t.id}>
                    {t.name} {t.is_default ? '(Default)' : ''} {!t.allow_hd_download ? `[${t.restricted_tier} restricted]` : ''}
                  </option>
                {/each}
              </select>
            {/if}
          </div>

          <!-- Caesium Image Compressor Configuration -->
          <div style="margin-bottom: 20px; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); padding: 14px; border-radius: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: {caesiumEnabled ? '12px' : '0'};">
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <Minimize2 size={16} color="#60a5fa" />
                  <span style="font-weight: 500; font-size: 0.9rem; color: #f4f4f5;">Caesium Image Compressor</span>
                  {#if caesiumSettings?.isAvailable}
                    <span style="font-size: 0.68rem; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 1px 6px; border-radius: 4px;">
                      CLI Ready
                    </span>
                  {/if}
                </div>
                <p style="font-size: 0.75rem; color: #a1a1aa; margin: 3px 0 0 0;">
                  Compress images before uploading to Google Drive to save Drive storage & bandwidth while leaving local originals untouched.
                </p>
              </div>
              <label style="display: flex; align-items: center; cursor: pointer; margin-left: 8px;">
                <input type="checkbox" bind:checked={caesiumEnabled} style="width: 17px; height: 17px; accent-color: #3b82f6;" />
              </label>
            </div>

            {#if caesiumEnabled}
              <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; margin-top: 8px;">
                <!-- Mode tabs -->
                <div style="margin-bottom: 12px;">
                  <label style="display: block; font-size: 0.75rem; color: #aaa; margin-bottom: 6px;">Compression Mode</label>
                  <div style="display: flex; gap: 6px;">
                    <button 
                      type="button" 
                      class="btn" 
                      style="flex: 1; padding: 4px 8px; font-size: 0.75rem; background: {caesiumMode === 'lossy' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)'}; border: 1px solid {caesiumMode === 'lossy' ? '#3b82f6' : 'var(--glass-border)'}; color: white;"
                      onclick={() => caesiumMode = 'lossy'}>
                      Lossy (Quality)
                    </button>
                    <button 
                      type="button" 
                      class="btn" 
                      style="flex: 1; padding: 4px 8px; font-size: 0.75rem; background: {caesiumMode === 'lossless' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)'}; border: 1px solid {caesiumMode === 'lossless' ? '#3b82f6' : 'var(--glass-border)'}; color: white;"
                      onclick={() => caesiumMode = 'lossless'}>
                      Lossless
                    </button>
                    <button 
                      type="button" 
                      class="btn" 
                      style="flex: 1; padding: 4px 8px; font-size: 0.75rem; background: {caesiumMode === 'max_size' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)'}; border: 1px solid {caesiumMode === 'max_size' ? '#3b82f6' : 'var(--glass-border)'}; color: white;"
                      onclick={() => caesiumMode = 'max_size'}>
                      Target Size
                    </button>
                  </div>
                </div>

                {#if caesiumMode === 'lossy'}
                  <div style="margin-bottom: 12px; background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: #ccc; margin-bottom: 6px;">
                      <span>Quality Level:</span>
                      <strong style="color: #60a5fa;">{caesiumQuality}%</strong>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="100" 
                      bind:value={caesiumQuality} 
                      style="width: 100%; accent-color: #3b82f6; cursor: pointer;" 
                    />
                    <div style="display: flex; justify-content: space-between; font-size: 0.68rem; color: #888; margin-top: 2px;">
                      <span>Smaller file size</span>
                      <span>Higher visual fidelity</span>
                    </div>
                  </div>
                {:else if caesiumMode === 'max_size'}
                  <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 0.75rem; color: #aaa; margin-bottom: 4px;">Target Maximum File Size</label>
                    <div style="display: flex; gap: 6px;">
                      <input 
                        type="text" 
                        bind:value={caesiumMaxSize} 
                        placeholder="e.g. 1MB, 500KB, 2MB"
                        style="flex: 1; padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.8rem;" 
                      />
                      {#each ['500KB', '1MB', '2MB', '5MB'] as preset}
                        <button 
                          type="button" 
                          class="btn" 
                          style="padding: 4px 8px; font-size: 0.72rem; background: rgba(255,255,255,0.06); border: 1px solid var(--glass-border); color: #aaa;"
                          onclick={() => caesiumMaxSize = preset}>
                          {preset}
                        </button>
                      {/each}
                    </div>
                  </div>
                {:else}
                  <div style="margin-bottom: 12px; font-size: 0.75rem; color: #aaa; background: rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 4px;">
                    Lossless compression optimizes internal image structures and tables without altering any pixel data.
                  </div>
                {/if}

                <!-- Dimensions constraint -->
                <div style="margin-bottom: 12px;">
                  <label style="display: block; font-size: 0.75rem; color: #aaa; margin-bottom: 4px;">Dimension Limits (Optional, maintains aspect ratio without upscaling)</label>
                  <div style="display: flex; gap: 8px;">
                    <div style="flex: 1;">
                      <input 
                        type="number" 
                        bind:value={caesiumWidth} 
                        placeholder="Max Width (px)"
                        style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.8rem;" 
                      />
                    </div>
                    <div style="flex: 1;">
                      <input 
                        type="number" 
                        bind:value={caesiumHeight} 
                        placeholder="Max Height (px)"
                        style="width: 100%; padding: 6px 8px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.8rem;" 
                      />
                    </div>
                  </div>
                </div>

                <!-- EXIF Checkbox -->
                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: #ccc; margin-bottom: 12px; cursor: pointer;">
                  <input type="checkbox" bind:checked={caesiumKeepExif} style="accent-color: #3b82f6;" />
                  <span>Preserve EXIF metadata & camera information</span>
                </label>

                <!-- Remember & Recycle Controls -->
                <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1);">
                  <label style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: #aaa; cursor: pointer;">
                    <input type="checkbox" bind:checked={caesiumSaveAsDefault} style="accent-color: #3b82f6;" />
                    <span>Remember parameters for other folders</span>
                  </label>

                  <button 
                    type="button" 
                    class="btn" 
                    style="padding: 2px 8px; font-size: 0.72rem; background: transparent; border: 1px solid var(--glass-border); color: #888; display: inline-flex; align-items: center; gap: 4px;"
                    onclick={applyRememberedDefaultsForNew}
                  >
                    <RotateCcw size={11} /> Reset to Remembered
                  </button>
                </div>
              </div>
            {/if}
          </div>

          <button 
            class="btn" 
            style="width: 100%; background: var(--text-color); color: var(--bg-color);" 
            onclick={handleEnableGDriveSync} 
            disabled={isEnablingGDrive}
          >
            {isEnablingGDrive ? 'Setting up Google Drive Sync...' : 'Enable Google Drive Sync'}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</Modal>

<Modal bind:show={showGDriveQrModal} id="folder-gdrive-qr" title="Scan Google Drive Link">
  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 0; text-align: center;">
    {#if isGeneratingGDriveQr}
      <div style="width: 220px; height: 220px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 0.875rem;">
        Generating QR Code...
      </div>
    {:else if gdriveQrDataUrl}
      <div style="background: white; padding: 12px; margin-bottom: 16px; border: 1px solid var(--glass-border);">
        <img src={gdriveQrDataUrl} alt="QR Code" style="width: 220px; height: 220px; display: block;" />
      </div>
    {/if}
    
    <div style="width: 100%; max-width: 340px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); padding: 8px 12px; margin-bottom: 20px; word-break: break-all; font-size: 0.85rem; color: #aaa; max-height: 60px; overflow-y: auto; font-family: monospace;">
      {gdriveSyncInfo?.sync?.gdrive_link || ''}
    </div>

    <div style="display: flex; gap: 8px; width: 100%; max-width: 340px; justify-content: flex-end;">
      <button 
        type="button" 
        class="btn" 
        style="flex: 1; padding: 8px 14px; font-size: 0.875rem; background: transparent; color: white; border: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: center; gap: 6px;"
        onclick={async () => {
          if (gdriveSyncInfo?.sync?.gdrive_link) {
            await copyToClipboard(gdriveSyncInfo.sync.gdrive_link);
            toast.success('Link copied to clipboard!');
          }
        }}
      >
        <Copy size={16} /> Copy Link
      </button>

      <a 
        href={gdriveSyncInfo?.sync?.gdrive_link} 
        target="_blank" 
        rel="noopener noreferrer" 
        class="btn" 
        style="flex: 1; padding: 8px 14px; font-size: 0.875rem; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 6px;"
      >
        <ExternalLink size={16} /> Open Link
      </a>
    </div>
  </div>
</Modal>

<Modal bind:show={showRevokeConfirm} id="folder-revoke-confirm" title="Revoke Share Link">
  <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5;">Are you sure you want to revoke this share link? Anyone using it will instantly lose access.</p>
  <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem;">
    <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => { showRevokeConfirm = false; revokeTargetToken = ''; }}>Cancel</button>
    <button class="btn" style="background: #ef4444; color: white; border: none;" onclick={confirmRevokeShare}>Revoke</button>
  </div>
</Modal>

<Modal bind:show={showUnlinkGDriveModal} id="folder-unlink-gdrive-confirm" title="Unlink Google Drive Sync">
  <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5;">Are you sure you want to unlink Google Drive sync? Existing files and the folder will remain safe in your Google Drive.</p>
  <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem;">
    <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => { showUnlinkGDriveModal = false; }}>Cancel</button>
    <button class="btn" style="background: #eab308; color: black; border: none; font-weight: 600;" onclick={confirmUnlinkGDriveSync}>Unlink</button>
  </div>
</Modal>

<Modal bind:show={showDeleteGDriveModal} id="folder-delete-gdrive-confirm" title="Permanently Delete Google Drive Folder">
  <p style="color: #ccc; margin-bottom: 16px; line-height: 1.5; display: flex; align-items: center; gap: 8px;">
    <AlertCircle size={18} color="#f87171" style="flex-shrink: 0;" />
    <strong style="color: #f87171;">This action is permanent and cannot be undone.</strong>
  </p>
  <p style="color: #a1a1aa; margin-bottom: 24px; line-height: 1.5; font-size: 0.9rem;">
    This will delete the folder and <strong style="color: #fff;">all photos</strong> inside it on your Google Drive. Your local photos on this server will <strong style="color: #10b981;">not</strong> be touched.
  </p>
  <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem;">
    <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => { showDeleteGDriveModal = false; }} disabled={isDeletingGDrive}>Cancel</button>
    <button class="btn" style="background: #ef4444; color: white; border: none; font-weight: 600;" onclick={confirmDeleteGDriveFolder} disabled={isDeletingGDrive}>
      {isDeletingGDrive ? 'Deleting...' : 'Delete Permanently'}
    </button>
  </div>
</Modal>

<style>
  /* Staging / FastUp Live Sync Disclaimer Banner */
  .staging-disclaimer-banner {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 20px;
    margin: 0 0 24px 0;
    background: linear-gradient(135deg, rgba(88, 28, 135, 0.25) 0%, rgba(24, 24, 27, 0.75) 100%);
    border: 1px solid rgba(168, 85, 247, 0.4);
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 0 16px rgba(168, 85, 247, 0.15);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    animation: fadeInNotice 0.3s ease-out;
  }
  @keyframes fadeInNotice {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .disclaimer-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    background: rgba(168, 85, 247, 0.2);
    border-radius: 10px;
    flex-shrink: 0;
  }
  .disclaimer-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }
  .disclaimer-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #f3e8ff;
    letter-spacing: -0.01em;
  }
  .disclaimer-text {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.45;
    color: #d1d5db;
  }
  .disclaimer-refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(168, 85, 247, 0.18);
    border: 1px solid rgba(168, 85, 247, 0.45);
    color: #f3e8ff;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .disclaimer-refresh-btn:hover:not(:disabled) {
    background: rgba(168, 85, 247, 0.32);
    border-color: rgba(168, 85, 247, 0.65);
    transform: translateY(-1px);
    color: #ffffff;
  }
  .disclaimer-refresh-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .spinning {
    animation: spin 1s linear infinite;
  }
  @media (max-width: 640px) {
    .staging-disclaimer-banner {
      flex-wrap: wrap;
    }
    .disclaimer-refresh-btn {
      width: 100%;
      justify-content: center;
      margin-top: 4px;
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes fadeInOnly {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .header-wrapper {
    position: relative;
    margin: -24px -24px 0 -24px;
    min-height: 120px;
    z-index: 0;
  }
  
  .header-wrapper.has-cover {
    min-height: 40vh;
  }
  
  .header-gradient {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,1) 100%);
    z-index: 1;
  }
  
  .sticky-header {
    position: sticky;
    top: -25px;
    z-index: 50;
    margin: 0 -24px 24px -24px;
    padding: 24px 24px;
    border-bottom: 1px solid transparent;
  }

  .header-content {
    position: relative;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    width: 100%;
  }
  
  .header-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .header-left h2 {
    animation: fadeIn 0.4s ease both;
  }

  .header-left .subheading,
  .header-left .folder-description {
    animation: fadeInOnly 0.4s ease both;
  }

  .header-text-container {
    overflow: hidden;
  }
  
  .folder-title-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }

  .mobile-count {
    display: none;
  }

  .desktop-count {
    display: flex;
  }

  .header-content h2 {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: var(--text-color);
    background: transparent;
    font-weight: 700;
    font-size: 2.5rem;
    margin-bottom: 0;
    text-shadow: 0 2px 10px rgba(0,0,0,0.5);
  }
  
  .subheading {
    color: #a1a1aa;
    font-size: 1rem;
    margin-bottom: 4px;
    font-family: 'Instrument Sans', sans-serif;
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
  }
  
  .subheading a {
    color: #a1a1aa;
    text-decoration: none;
    transition: color 0.2s;
  }
  
  .subheading a:hover {
    color: var(--text-color);
    text-decoration: underline;
  }
  
  .subheading .separator {
    margin: 0 4px;
    opacity: 0.5;
  }
  
  .header-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
  }
  
  .toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .dropdown-container {
    position: relative;
  }
  
  .icon-btn {
    background: transparent;
    border: none;
    color: #a1a1aa;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .icon-btn:hover {
    background: rgba(255,255,255,0.1);
    color: white;
  }
  
  .dropdown-menu {
    position: absolute;
    top: 44px;
    right: 0;
    background: #000;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 8px;
    min-width: 140px;
    overflow: hidden;
    z-index: 100;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  }
  
  .dropdown-menu button {
    width: 100%;
    text-align: left;
    padding: 12px 16px;
    background: none;
    border: none;
    color: #ccc;
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.2s, color 0.2s;
    white-space: nowrap;
  }
  
  .dropdown-menu button:hover {
    background: rgba(255,255,255,0.1);
    color: white;
  }
  
  .dropdown-menu button.active {
    background: rgba(255,255,255,0.15);
    color: white;
    font-weight: 500;
  }

  .dropdown-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.12);
    margin: 4px 0;
  }

  .dropdown-menu button.toggle-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .count {
    color: #a1a1aa;
    font-size: 0.875rem;
    text-shadow: 0 1px 4px rgba(0,0,0,0.8);
  }

  .dir-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    padding-bottom: 24px;
  }

  .dir-grid.folder-mode-small-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 6px;
  }

  .dir-grid.folder-mode-medium-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
  }

  .dir-grid.folder-mode-large-grid {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 14px;
  }

  .dir-grid.folder-mode-small-grid .dir-cover,
  .dir-grid.folder-mode-medium-grid .dir-cover,
  .dir-grid.folder-mode-large-grid .dir-cover {
    border-radius: 0;
  }

  .dir-grid.folder-mode-small-grid .dir-info,
  .dir-grid.folder-mode-medium-grid .dir-info,
  .dir-grid.folder-mode-large-grid .dir-info {
    padding: 8px 2px;
    align-items: flex-start;
  }

  .dir-grid.folder-mode-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-bottom: 24px;
  }

  .dir-grid.folder-mode-list .dir-card {
    display: block;
    text-decoration: none;
    color: var(--text-color);
  }

  .dir-grid.folder-mode-list .dir-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
  }

  .dir-grid.folder-mode-list .dir-label {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
    color: #d4d4d8;
  }

  @media (hover: hover) and (pointer: fine) {
    .dir-grid.folder-mode-list .dir-card:not(:hover) .dir-info {
      background: transparent;
    }

    .dir-grid.folder-mode-list .dir-card:nth-child(odd) .dir-info {
      background: rgba(255, 255, 255, 0.03);
    }

    .dir-grid.folder-mode-list .dir-card:hover .dir-info {
      background: rgba(255, 255, 255, 0.08);
    }
  }

  .dir-grid.list-view {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .dir-grid.list-view .dir-card {
    flex-direction: row;
    align-items: center;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 8px;
    width: 250px;
    gap: 12px;
    border: 1px solid var(--glass-border);
  }

  .dir-grid.list-view .dir-cover {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
  }

  .dir-grid.list-view .dir-info {
    padding: 0;
    padding-right: 8px;
    flex: 1;
    min-width: 0;
  }

  .dir-grid.list-view .dir-name {
    font-size: 1rem;
    margin: 0;
  }

  .dir-card {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: var(--text-color);
    background: transparent;
    transition: filter 0.2s ease, background-color 0.2s ease;
    position: relative;
    animation: fadeIn 0.35s ease both;
    cursor: pointer;
  }

  @media (hover: hover) and (pointer: fine) {
    .dir-card:hover {
      filter: brightness(1.2);
    }
  }

  .dir-cover {
    width: 100%;
    aspect-ratio: 1;
    position: relative;
    z-index: 0;
    background: #111;
  }

  .dir-placeholder {
    width: 100%;
    height: 100%;
    background: #111;
  }

  .dir-info {
    padding: 12px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .dir-name {
    font-family: 'Cabinet Grotesk', sans-serif;
    font-weight: 700;
    font-size: 1rem;
    line-height: 1.3;
    word-break: break-word;
    flex: 1;
  }

  .folder-mode-small-grid .dir-name {
    font-size: 0.8rem;
    padding-top: 3px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .folder-mode-medium-grid .dir-name,
  .folder-mode-large-grid .dir-name {
    padding-top: 3px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .dir-actions {
    margin-left: 12px;
    flex-shrink: 0;
  }

  .dir-actions-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 72px;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 5;
    background: linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 100%);
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 8px;
  }

  @media (hover: hover) and (pointer: fine) {
    .dir-card:hover .dir-actions-overlay {
      opacity: 1;
    }
  }

  @media (hover: none) {
    .dir-actions-overlay {
      opacity: 1;
      background: linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%);
    }
  }

  .overlay-btn {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 6;
  }

  .overlay-btn:hover {
    color: #e4e4e7;
  }

  .grid {
    padding-bottom: 64px;
  }
  
  .grid.small-fit, .grid.large-fit {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
  }
  
  .grid.small-square {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0;
  }
  
  .grid.large-square {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 0;
  }

  /* Trick to prevent the last row from stretching to the edges if there's only 1 or 2 photos in flex view */
  .grid.small-fit::after, .grid.large-fit::after {
    content: "";
    flex-grow: 999999999;
  }

  /* Compact Media List */
  .compact-media-list {
    margin-bottom: 48px;
    background: rgba(20, 20, 25, 0.4);
    border: 1px solid var(--glass-border);
    border-radius: 10px;
    overflow: hidden;
  }

  .compact-list-header {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid var(--glass-border);
    padding: 0 16px;
    height: 38px;
  }

  .compact-th {
    background: none;
    border: none;
    color: #a1a1aa;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: inherit;
    cursor: default;
    user-select: none;
  }

  button.compact-th {
    cursor: pointer;
    transition: color 0.15s ease;
  }

  button.compact-th:hover {
    color: #f4f4f5;
  }

  .sort-indicator {
    font-size: 0.85rem;
    color: #3b82f6;
    line-height: 1;
  }

  .compact-list-body {
    display: flex;
    flex-direction: column;
  }

  .compact-row {
    display: flex;
    align-items: center;
    padding: 0 16px;
    height: 40px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: var(--text-color, #f4f4f5);
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .compact-row:last-child {
    border-bottom: none;
  }

  .compact-row:nth-child(even) {
    background: rgba(255, 255, 255, 0.015);
  }

  .compact-row:hover,
  .compact-row:focus-visible {
    background: rgba(255, 255, 255, 0.07);
    outline: none;
  }

  .compact-media-list .col-name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding-right: 12px;
  }

  .compact-media-list .file-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #60a5fa;
    flex-shrink: 0;
  }

  .compact-media-list .file-icon.video {
    color: #c084fc;
  }

  .compact-media-list .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 450;
  }

  .compact-media-list .col-date {
    width: 140px;
    flex-shrink: 0;
    color: #a1a1aa;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .compact-media-list .col-res {
    width: 130px;
    flex-shrink: 0;
    color: #a1a1aa;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .compact-media-list .col-size {
    width: 80px;
    flex-shrink: 0;
    color: #a1a1aa;
    font-size: 0.8rem;
    text-align: right;
    white-space: nowrap;
    justify-content: flex-end;
  }

  .compact-media-list .col-actions {
    width: 44px;
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
  }

  .compact-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: #a1a1aa;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
  }

  .compact-action-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  @media (max-width: 768px) {
    .compact-media-list .col-res {
      display: none;
    }
    .compact-media-list .col-date {
      width: 110px;
    }
  }

  @media (max-width: 520px) {
    .compact-media-list .col-date {
      display: none;
    }
    .compact-media-list {
      margin-left: -12px;
      margin-right: -12px;
      border-radius: 0;
      border-left: none;
      border-right: none;
    }
  }
  @media (max-width: 768px) {
    .sticky-header {
      padding: calc(24px - (14px * var(--scroll-prog))) 24px;
      margin-bottom: calc(24px - (14px * var(--scroll-prog)));
    }
    .dir-grid.list-view .dir-card {
      width: 100%;
    }
    .grid {
      margin: 0 -24px;
    }
    .header-content {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    .header-content.frozen-mobile {
      flex-direction: row;
      align-items: center;
    }
    .header-content.frozen-mobile .header-left {
      display: none !important;
    }
    .header-content.frozen-mobile .header-right {
      width: auto;
      flex: 1;
      justify-content: flex-start;
    }
    .header-content.frozen-mobile .count {
      display: none !important;
    }
    .header-right {
      flex-direction: row;
      justify-content: flex-end;
      align-items: center;
      width: 100%;
    }
    .desktop-count {
      display: none !important;
    }
    .mobile-count {
      display: inline-flex;
      align-items: baseline;
      gap: 4px;
      font-size: 0.85rem;
      color: #a1a1aa;
      white-space: nowrap;
    }
    .grid.small-square {
      grid-template-columns: repeat(3, 1fr);
    }
    .header-text-container {
      max-height: calc((1 - var(--scroll-prog)) * 120px + 4px);
      opacity: calc(1 - var(--scroll-prog));
      overflow: hidden;
    }
    .toolbar {
      gap: 3px;
    }
    .toolbar .icon-btn {
      width: 30px;
      height: 30px;
      border-radius: 6px;
    }
    .toolbar .icon-btn :global(svg) {
      width: 16px;
      height: 16px;
    }
    .toolbar .dropdown-menu {
      top: 36px;
      right: auto;
      left: 0;
    }
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 24px;
    text-align: center;
    min-height: 400px;
  }
  .folder-search-bar {
    width: 100%;
    margin-top: 14px;
    z-index: 10;
  }
  .search-input-wrapper {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    padding: 0 12px;
    height: 42px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    transition: border-color 0.2s, background 0.2s;
  }
  .search-input-wrapper:focus-within {
    border-color: rgba(255, 255, 255, 0.4);
    background: rgba(255, 255, 255, 0.12);
  }
  :global(.search-spinner) {
    animation: spin 1s linear infinite;
    color: #93c5fd;
    margin-right: 10px;
    flex-shrink: 0;
  }
  :global(.search-icon) {
    color: #a1a1aa;
    margin-right: 10px;
    flex-shrink: 0;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .folder-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-color, white);
    font-size: 0.95rem;
    font-family: inherit;
    min-width: 0;
  }
  .folder-search-input::placeholder {
    color: #888;
  }
  .search-close-btn {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }
  .search-close-btn:hover {
    color: white;
    background: rgba(255, 255, 255, 0.1);
  }
  .search-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 24px;
    text-align: center;
    min-height: 280px;
  }
  .compact-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    text-align: center;
    width: 100%;
  }
  .empty-title {
    font-size: 1.15rem;
    font-weight: 500;
    color: var(--text-color, white);
    margin-bottom: 6px;
  }
  .empty-subtitle {
    font-size: 0.875rem;
    color: #a1a1aa;
    margin-bottom: 16px;
  }
  @media (min-width: 769px) {
    .mobile-only-back {
      display: none !important;
    }
  }

  .curation-icon-btn.active {
    color: #facc15;
    background: rgba(234, 179, 8, 0.18);
    border-color: rgba(234, 179, 8, 0.4);
  }

  .favorites-icon-btn.active {
    color: #f43f5e;
    background: rgba(244, 63, 94, 0.18);
    border-color: rgba(244, 63, 94, 0.4);
  }

  .empty-favorites-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    text-align: center;
    color: #a1a1aa;
    width: 100%;
  }

  .empty-favorites-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(244, 63, 94, 0.12);
    color: #f43f5e;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  }

  .compact-action-btn.is-fav {
    color: #f43f5e;
  }
</style>
