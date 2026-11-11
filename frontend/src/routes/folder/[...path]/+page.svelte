<script lang="ts">
import { replaceState } from '$app/navigation';

  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import CoverImage from '$lib/components/CoverImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getThumbnailUrl, getPreviewUrl, setFolderCover, getFolderZipUrl, setFolderDescription, rescanFolder, rescanFolderML, regenerateImages, regenerateVideos } from '$lib/api/media';
  import { computeCoverObjectPosition } from '$lib/utils/cover';
  import { getSortDate } from '$lib/utils/date';
  import { createShare, getActiveShares, revokeShare, updateShare, getAccessRequests, respondAccessRequest, type ShareData, type AccessRequest } from '$lib/api/shares';
  import { formatShareDate, isShareExpired, getNearestExpiryDuration } from '$lib/utils/shareUtils';
  import { invalidateAll, goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { env } from '$env/dynamic/public';
  import type { PageData } from './$types';
  import Modal from '$lib/components/Modal.svelte';
  import { currentUser } from '$lib/stores/auth';
  import { updatePreferences } from '$lib/api/auth';
  import { ChevronLeft, ArrowDownUp, LayoutGrid, Download, Share2, Settings, Check, Copy, Trash2, Clock, MoreVertical, Folder, User, BarChart3, Power, Calendar, Mail, RefreshCw, AlertCircle, Pencil } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';
  
  let { data }: { data: PageData } = $props();
  
  // Settings Modal State
  let folderDescInput = $state('');
  let isSavingSettings = $state(false);

  // Share Modal State
  let shareAllowDownloadImages = $state(true);
  let shareAllowDownloadFolder = $state(true);
  let shareExpiryMode: 'duration' | 'date' | 'never' = $state('duration');
  let shareExpiryValue = $state(7);
  let shareExpiryUnit = $state('days');
  let shareExpiryDateTime = $state('');

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
  let editIsActive = $state(true);
  let isSavingShareEdit = $state(false);

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

  // Initialize input state when data changes
  let previousPath = $state(data.folderPath);
  let hasShownHostError = $state(false);
  $effect(() => {
    folderDescInput = data.folderDescription || '';
    if (data.folderPath !== previousPath) {
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
      const [shares, requests] = await Promise.all([
        getActiveShares(folder),
        getAccessRequests(folder).catch(() => [])
      ]);
      allShares = shares;
      accessRequests = requests;
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
      
      const token = await createShare(data.folderPath || '', null, shareAllowDownloadImages, shareAllowDownloadFolder, false, expiresAt);
      toast.success('Share link created successfully!');
      newlyCreatedShareToken = token;
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
    editIsActive = share.is_active !== false;

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
        isActive: editIsActive
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
    const domain = env.PUBLIC_APP_DOMAIN || window.location.origin;
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
  
  type SortMode = 'newest' | 'oldest' | 'a-z' | 'z-a';
  type ViewMode = 'small-fit' | 'large-fit' | 'small-square' | 'large-square';

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

  function savePref(key: string, val: any) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(val));
    }
    if ($currentUser) {
      if (!$currentUser.preferences) $currentUser.preferences = {};
      if ($currentUser.preferences[key] !== val) {
        $currentUser.preferences[key] = val;
        updatePreferences($currentUser.preferences).catch(err => {
          console.error('Failed to save preference to DB:', err);
        });
      }
    }
  }

  type FolderViewMode = 'small-grid' | 'medium-grid' | 'large-grid' | 'list';
  let sortMode: SortMode = $state(data.defaultSortMode || 'oldest');
  let viewMode: ViewMode = $state(data.defaultViewMode || 'small-fit');
  let folderViewMode: FolderViewMode = $state(data.defaultFolderViewMode || 'small-grid');

  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);

  let hasSyncedPreferences = $state(false);
  $effect(() => {
    if ($currentUser && $currentUser.preferences && !hasSyncedPreferences) {
      hasSyncedPreferences = true;
      if ($currentUser.preferences.folderSortMode) sortMode = $currentUser.preferences.folderSortMode as SortMode;
      if ($currentUser.preferences.folderViewMode) viewMode = $currentUser.preferences.folderViewMode as ViewMode;
      if ($currentUser.preferences.folderFolderViewMode) folderViewMode = $currentUser.preferences.folderFolderViewMode as FolderViewMode;
    }
  });

  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderSortMode', sortMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderViewMode', viewMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('folderFolderViewMode', folderViewMode); });

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);

  let showFolderViewMenu = $state(false);

  function getAspectRatio(file: { exif_json?: any }): number | undefined {
    const exif = file.exif_json;
    if (exif) {
      const w = exif.ExifImageWidth || exif.ImageWidth;
      const h = exif.ExifImageHeight || exif.ImageHeight;
      if (w && h && w > 0 && h > 0) return w / h;
    }
    return undefined;
  }

  let isFolderOnly = $derived(data.files.length === 0 && data.directories.length > 0);

  let sortedDirectories = $derived([...data.directories].sort((a, b) => {
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

  let sortedFiles = $derived([...data.files].sort((a, b) => {
    if (sortMode === 'newest') return getSortDate(b) - getSortDate(a);
    if (sortMode === 'oldest') return getSortDate(a) - getSortDate(b);
    if (sortMode === 'a-z') return a.file_name.localeCompare(b.file_name);
    if (sortMode === 'z-a') return b.file_name.localeCompare(a.file_name);
    return 0;
  }));

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

  function syncUrl(index: number | null) {
    const url = index !== null ? mediaUrl(index) : folderUrl();
    replaceState(url, history.state);
  }

  function openLightbox(index: number) {
    selectedMediaIndex = index;
    syncUrl(index);
  }
  
  function closeLightbox() {
    selectedMediaIndex = null;
    syncUrl(null);
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

  function handleScroll(e: Event) {
    if (!headerWrapper) return;
    const target = e.target as HTMLElement;
    // Sticking occurs when scrolled past the wrapper's height minus the 25px top offset
    const threshold = headerWrapper.offsetHeight - 25;
    if (threshold > 0) {
      scrollProgress = Math.min(1, Math.max(0, target.scrollTop / threshold));
    }
  }

  onMount(() => {
    sortMode = loadPref<SortMode>('folderSortMode', data.defaultSortMode || 'newest');
    viewMode = loadPref<ViewMode>('folderViewMode', data.defaultViewMode || 'small-fit');
    folderViewMode = loadPref<FolderViewMode>('folderFolderViewMode', data.defaultFolderViewMode || 'small-grid');

    if (data.isProcessing) {
      toast.info('This folder is still being processed. Some items might be missing or slow to load. Feel free to come back later!', 8000);
    }

    pollInterval = setInterval(() => {
      // Poll if any file lacks a blurhash (still processing) or if the scanner is active
      const stillProcessing = data.files.some(f => !f.blurhash) || data.scanning;
      if (stillProcessing) {
        invalidateAll();
      }
    }, 2000);

    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.addEventListener('scroll', handleScroll);
    }

    windowWidth = window.innerWidth;
    const updateWidth = () => windowWidth = window.innerWidth;
    window.addEventListener('resize', updateWidth);

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', updateWidth);
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
  backdrop-filter: blur(calc(16px * {scrollProgress}));
  -webkit-backdrop-filter: blur(calc(16px * {scrollProgress}));
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
          <h2>{data.folderPath ? data.folderPath.split('/').pop() : 'Home'}</h2>
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
             style="opacity: {scrollProgress === 1 ? 1 : 0}; width: {scrollProgress === 1 ? '36px' : '0'}; padding: {scrollProgress === 1 ? '8px' : '0'}; margin-right: {scrollProgress === 1 ? '0' : '-8px'}; overflow: hidden; transition: width 0.2s, opacity 0.2s, margin 0.2s, padding 0.2s; pointer-events: {scrollProgress === 1 ? 'auto' : 'none'}; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" 
             title="Go back">
            <ChevronLeft size={24} />
          </a>
        {/if}
        {#if $currentUser?.role === 'admin' || $currentUser?.role === 'super_admin'}
          <a href="/admin/analytics/folder/{encodePath(data.folderPath || '')}?from={encodePath(data.folderPath || '')}" class="icon-btn" title="Folder Analytics" style="display: inline-flex; align-items: center; justify-content: center;">
            <BarChart3 size={18} />
          </a>
        {/if}
        <div class="dropdown-container" use:clickOutside={() => showSortMenu = false}>
          <button class="icon-btn" onclick={() => { showSortMenu = !showSortMenu; showViewMenu = false; showFolderViewMenu = false; }} title="Sort">
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
        
        {#if isFolderOnly}
          <div class="dropdown-container" use:clickOutside={() => showFolderViewMenu = false}>
            <button class="icon-btn" onclick={() => { showFolderViewMenu = !showFolderViewMenu; showSortMenu = false; }} title="View">
              <LayoutGrid size={18} />
            </button>
            {#if showFolderViewMenu}
              <div class="dropdown-menu">
                <button class:active={folderViewMode === 'small-grid'} onclick={() => { folderViewMode = 'small-grid'; showFolderViewMenu = false; }}>Small Grid</button>
                <button class:active={folderViewMode === 'medium-grid'} onclick={() => { folderViewMode = 'medium-grid'; showFolderViewMenu = false; }}>Medium Grid</button>
                <button class:active={folderViewMode === 'large-grid'} onclick={() => { folderViewMode = 'large-grid'; showFolderViewMenu = false; }}>Large Grid</button>
                <button class:active={folderViewMode === 'list'} onclick={() => { folderViewMode = 'list'; showFolderViewMenu = false; }}>List</button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="dropdown-container" use:clickOutside={() => showViewMenu = false}>
            <button class="icon-btn" onclick={() => { showViewMenu = !showViewMenu; showSortMenu = false; }} title="View">
              <LayoutGrid size={18} />
            </button>
            {#if showViewMenu}
              <div class="dropdown-menu">
                <button class:active={viewMode === 'small-fit'} onclick={() => { viewMode = 'small-fit'; showViewMenu = false; }}>Small Fit Size</button>
                <button class:active={viewMode === 'large-fit'} onclick={() => { viewMode = 'large-fit'; showViewMenu = false; }}>Large Fit Size</button>
                <button class:active={viewMode === 'small-square'} onclick={() => { viewMode = 'small-square'; showViewMenu = false; }}>Small Square Grid</button>
                <button class:active={viewMode === 'large-square'} onclick={() => { viewMode = 'large-square'; showViewMenu = false; }}>Large Square Grid</button>
              </div>
            {/if}
          </div>
        {/if}
        
        <button class="icon-btn" onclick={() => showDownloadModal = true} title="Download">
          <Download size={18} />
        </button>
        <button class="icon-btn" onclick={() => showShareModal = true} title="Share">
          <Share2 size={18} />
        </button>
        <button class="icon-btn" onclick={() => showSettingsModal = true} title="Settings">
          <Settings size={18} />
        </button>
      </div>
      
      <span class="count" style="display: flex; flex-wrap: wrap; justify-content: flex-end; column-gap: 4px;">
        {#if data.directories.length > 0}
          <span style="white-space: nowrap;">{data.directories.length} {data.directories.length === 1 ? 'folder' : 'folders'}</span>
          {#if data.files.length > 0}
            <span style="white-space: nowrap;">& {data.files.length} {data.files.length === 1 ? 'item' : 'items'}</span>
          {/if}
        {:else}
          <span style="white-space: nowrap;">{data.files.length} {data.files.length === 1 ? 'item' : 'items'}</span>
        {/if}
      </span>
    </div>
  </div>
</div>

{#key data.folderPath}
{#if data.directories.length > 0}
  <div class="dir-grid {isFolderOnly ? 'folder-mode-' + folderViewMode : (data.files.length > 0 ? 'list-view' : '')}">
    {#each sortedDirectories as dir, i}
      <a 
        class="dir-card" 
        style="animation-delay: {i * 40}ms; z-index: {activeFolderMenu === dir.name ? 50 : 'auto'};" 
        href="/folder/{data.folderPath ? data.folderPath + '/' + dir.name : dir.name}"
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
              <span class="dir-name">{dir.name}</span>
            </div>
            <div class="dir-actions" use:clickOutside={() => { if (activeFolderMenu === dir.name) activeFolderMenu = null; }}>
              <button class="icon-btn" onclick={(e) => toggleFolderMenu(dir.name, e)} title="Options">
                <MoreVertical size={16} />
              </button>
              {#if activeFolderMenu === dir.name}
                <div class="dropdown-menu" style="position: absolute; right: 0; top: 100%; z-index: 100; margin-top: 4px;" onclick={(e) => e.stopPropagation()}>
                  <button onclick={() => { activeFolderMenu = null; window.open(getFolderZipUrl(data.folderPath ? data.folderPath + '/' + dir.name : dir.name), '_blank'); }}>Download ZIP</button>
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
                    <button onclick={() => { activeFolderMenu = null; window.open(getFolderZipUrl(data.folderPath ? data.folderPath + '/' + dir.name : dir.name), '_blank'); }}>Download ZIP</button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          <div class="dir-info">
            <span class="dir-name">{dir.name}</span>
            {#if !isFolderOnly}
              <div class="dir-actions" use:clickOutside={() => { if (activeFolderMenu === dir.name) activeFolderMenu = null; }}>
                <button class="icon-btn" onclick={(e) => toggleFolderMenu(dir.name, e)} title="Options">
                  <MoreVertical size={16} />
                </button>
                {#if activeFolderMenu === dir.name}
                  <div class="dropdown-menu" style="position: absolute; right: 0; top: 100%; z-index: 100; margin-top: 4px;" onclick={(e) => e.stopPropagation()}>
                    <button onclick={(e) => { e.preventDefault(); e.stopPropagation(); handleSetDirCoverAsParentCover(dir); }}>Set as cover</button>
                    <button onclick={() => { activeFolderMenu = null; window.open(getFolderZipUrl(data.folderPath ? data.folderPath + '/' + dir.name : dir.name), '_blank'); }}>Download ZIP</button>
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

{#if data.directories.length === 0 && data.files.length === 0}
  <div class="empty-state">
    <h3 style="color: var(--text-color); margin-bottom: 8px;">This folder is empty</h3>
    <p style="color: #a1a1aa; max-width: 400px; margin: 0 auto;">There are no files or subfolders here yet.</p>
  </div>
{/if}

{#key data.folderPath}
<div class="grid {viewMode}">
  {#each visibleFiles as file, i}
    <BlurhashImage 
      hash={file.blurhash || ''} 
      src={`${getThumbnailUrl(file.id)}${file.blurhash ? '?cb=' + encodeURIComponent(file.blurhash) : ''}`} 
      alt={file.file_name} 
      isVideo={file.mime_type.startsWith('video/')}
      onclick={() => openLightbox(i)}
      objectFit={viewMode.includes('square') ? 'cover' : 'contain'}
      square={viewMode.includes('square')}
      targetHeight={viewMode.includes('small') ? (windowWidth <= 768 ? 100 : 150) : viewMode.includes('large') ? (windowWidth <= 768 ? 200 : 350) : 250}
      priority={i < 8}
      initialAspectRatio={getAspectRatio(file)}
    />
  {/each}
</div>
{#if visibleCount < sortedFiles.length}
  <div use:infiniteScroll style="height: 20px; width: 100%;"></div>
{/if}
{/key}

{#if selectedMediaIndex !== null && sortedFiles[selectedMediaIndex]}
  <Lightbox folderCoverId={data.folderCoverId} 
    media={sortedFiles[selectedMediaIndex]} 
    onclose={closeLightbox}
    onnext={nextMedia}
    onprev={prevMedia}
    onsetcover={handleSetCover}
  />
{/if}

<Modal bind:show={showDownloadModal} id="download-folder" title="Download Folder">
  <a href={getFolderZipUrl(data.folderPath || '')} target="_blank" class="btn" style="display: block; text-align: center; text-decoration: none; width: 100%; margin-bottom: 12px; background: var(--text-color); color: var(--bg-color);" onclick={() => showDownloadModal = false}>Download All in One Zip</a>
  <button class="btn" style="width: 100%; background: var(--glass-bg); border: 1px solid var(--glass-border); color: white;">Download as Multi-part Zips (Coming Soon)</button>
</Modal>

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
            <input type="text" readonly value="{env.PUBLIC_APP_DOMAIN || window.location.origin}/share/{newlyCreatedShareToken}" style="flex: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;" />
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

        <div class="form-group" style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;">
          <input type="checkbox" id="allowDlsFolder" bind:checked={shareAllowDownloadFolder} style="width: 18px; height: 18px;" />
          <label for="allowDlsFolder" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow downloading the entire folder (ZIP)</label>
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
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <span style="font-family: monospace; color: #e4e4e7; font-weight: 500;">...{share.share_token.substring(0, 8)}</span>
                        {#if share.is_active === false}
                          <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">
                            Disabled
                          </span>
                        {:else}
                          <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">
                            Active
                          </span>
                        {/if}
                      </div>

                      <div style="font-size: 0.8rem; color: #e4e4e7; margin-bottom: 2px;">
                        {#if share.expires_at}
                          <span style="color: #60a5fa; font-weight: 500;">Expiring in {getNearestExpiryDuration(share.expires_at)}</span>
                        {:else}
                          <span style="color: #a1a1aa;">Never expires</span>
                        {/if}
                      </div>

                      <div style="font-size: 0.72rem; color: #888; display: flex; gap: 10px; flex-wrap: wrap;">
                        {#if share.expires_at}
                          <span style="display: flex; align-items: center; gap: 4px;">
                            <Clock size={11} />
                            {formatShareDate(share.expires_at)}
                          </span>
                        {/if}
                        <span style="display: flex; align-items: center; gap: 4px;">
                          <User size={11} />
                          {share.created_by_name || 'Unknown'}
                        </span>
                        <span>
                          {#if share.allow_download_images && share.allow_download_folder}
                            Full DLs
                          {:else if share.allow_download_images}
                            Images DL Only
                          {:else if share.allow_download_folder}
                            Folder DL Only
                          {:else}
                            View Only
                          {/if}
                        </span>
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

                        <div style="display: flex; align-items: center; gap: 8px;">
                          <input type="checkbox" id="editActive-{share.share_token}" bind:checked={editIsActive} style="width: 15px; height: 15px;" />
                          <label for="editActive-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Link is active (enabled)</label>
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
                    <div>
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <span style="font-family: monospace; color: #a1a1aa; font-weight: 500;">...{share.share_token.substring(0, 8)}</span>
                        <span style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">
                          Expired
                        </span>
                      </div>
                      <div style="font-size: 0.75rem; color: #888; display: flex; gap: 10px; flex-wrap: wrap;">
                        <span style="display: flex; align-items: center; gap: 4px; color: #f87171;">
                          <Clock size={11} />
                          Expired on {formatShareDate(share.expires_at)}
                        </span>
                        <span style="display: flex; align-items: center; gap: 4px;">
                          <User size={11} />
                          {share.created_by_name || 'Unknown'}
                        </span>
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
    
    <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #ff9999; width: 100%; justify-content: flex-start;" onclick={handleRegenerateImages} disabled={isRegeneratingImages}>
      {isRegeneratingImages ? 'Queuing...' : 'Regenerate All Image Thumbnails'}
    </button>
    
    <button class="btn" style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); color: #ff9999; width: 100%; justify-content: flex-start;" onclick={handleRegenerateVideos} disabled={isRegeneratingVideos}>
      {isRegeneratingVideos ? 'Queuing...' : 'Regenerate Video Transcodes & Thumbnails'}
    </button>
  </div>
</Modal>

<Modal bind:show={showRevokeConfirm} id="folder-revoke-confirm" title="Revoke Share Link">
  <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5;">Are you sure you want to revoke this share link? Anyone using it will instantly lose access.</p>
  <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem;">
    <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => { showRevokeConfirm = false; revokeTargetToken = ''; }}>Cancel</button>
    <button class="btn" style="background: #ef4444; color: white; border: none;" onclick={confirmRevokeShare}>Revoke</button>
  </div>
</Modal>

<style>
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
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }
    .count {
      text-align: right;
    }
    .grid.small-square {
      grid-template-columns: repeat(3, 1fr);
    }
    .header-text-container {
      max-height: calc((1 - var(--scroll-prog)) * 120px + 4px);
      opacity: calc(1 - var(--scroll-prog));
      overflow: hidden;
    }
    .toolbar .dropdown-menu {
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
  @media (min-width: 769px) {
    .mobile-only-back {
      display: none !important;
    }
  }
</style>
