<script lang="ts">
  import { slide } from 'svelte/transition';
  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import CoverImage from '$lib/components/CoverImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import { getSortDate, getRawDate } from '$lib/utils/date';
  import Modal from '$lib/components/Modal.svelte';
  import ZipDownloadModal from '$lib/components/ZipDownloadModal.svelte';
  import { 
    getThumbnailUrl, 
    getPreviewUrl, 
    getStreamUrl, 
    searchPersonMedia, 
    mergePersons, 
    getFaceThumbnailUrl, 
    API_BASE,
    type MediaFile 
  } from '$lib/api/media';
  import { computeCoverObjectPosition } from '$lib/utils/cover';
  import { createPersonShare, getActivePersonShares, revokeShare, updateShare, getWatermarkTemplatesForShare, type ShareData, type WatermarkTemplateOption } from '$lib/api/shares';
  import { formatShareDate, isShareExpired, getNearestExpiryDuration } from '$lib/utils/shareUtils';
  import type { PageData } from './$types';
  import { onMount, onDestroy } from 'svelte';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { 
    ArrowDownUp, 
    ChevronLeft, 
    LayoutGrid, 
    Share2, 
    Check, 
    Copy, 
    Trash2, 
    Clock, 
    User, 
    Folder, 
    Power, 
    Pencil, 
    Download, 
    Search, 
    X, 
    Loader2, 
    Merge, 
    List, 
    Image as ImageIcon, 
    Film, 
    AlertCircle,
    Lock,
    Key,
    Eye,
    EyeOff,
    Sparkles,
    Tag
  } from '@lucide/svelte';
  import { generateNaturalPassword } from '$lib/utils/passwordGenerator';
  import { clickOutside } from '$lib/actions/clickOutside';
  import { toast } from '$lib/stores/toast';
  import { currentUser } from '$lib/stores/auth';
  import { updatePreferences } from '$lib/api/auth';
  import { goto } from '$app/navigation';

  let { data }: { data: PageData } = $props();

  let selectedMediaIndex: number | null = $state(null);
  let isEditingName = $state(false);
  let personName = $state(data.personName || '');
  let editNameValue = $state(data.personName || '');
  let isSaving = $state(false);

  $effect(() => {
    if (data.personName !== undefined) {
      personName = data.personName;
      if (!isEditingName) {
        editNameValue = data.personName;
      }
    }
  });

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

  function getAspectRatio(file: any): number | undefined {
    if (file.img_width && file.img_height && file.img_width > 0 && file.img_height > 0) {
      return file.img_width / file.img_height;
    }
    const exif = file.exif_json;
    if (exif) {
      let w = exif.ExifImageWidth || exif.ImageWidth;
      let h = exif.ExifImageHeight || exif.ImageHeight;
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

  let hasSyncedPreferences = $state(false);

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

  let sortMode: SortMode = $state('oldest');
  let viewMode: ViewMode = $state('small-fit');
  let showFileNames = $state(false);
  
  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);

  $effect(() => {
    if ($currentUser && !hasSyncedPreferences) {
      hasSyncedPreferences = true;
      if ($currentUser.preferences.personSortMode) sortMode = $currentUser.preferences.personSortMode as SortMode;
      if ($currentUser.preferences.personViewMode) viewMode = $currentUser.preferences.personViewMode as ViewMode;
      if ($currentUser.preferences.showFileNames !== undefined) showFileNames = !!$currentUser.preferences.showFileNames;
    }
  });

  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('personSortMode', sortMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('personViewMode', viewMode); });
  $effect(() => { if (hasSyncedPreferences || !$currentUser) savePref('showFileNames', showFileNames); });

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);
  let showShareModal = $state(false);
  let showDownloadModal = $state(false);

  function openDownloadModal() {
    showDownloadModal = true;
  }

  // Merge modal state
  let showMergeModal = $state(false);
  let mergeSearchQuery = $state('');
  let availablePeople = $state<any[]>([]);
  let isLoadingPeople = $state(false);
  let selectedMergePerson = $state<any | null>(null);
  let mergeNameChoice = $state<'current' | 'target' | 'custom'>('current');
  let mergeCustomName = $state('');
  let isMerging = $state(false);

  let filteredPeople = $derived(
    availablePeople.filter((p: any) => {
      const pId = p.person_id || p.id;
      if (pId === data.id) return false;
      if (!mergeSearchQuery.trim()) return true;
      const q = mergeSearchQuery.trim().toLowerCase();
      const pName = (p.name || '').toLowerCase();
      return pName.includes(q);
    })
  );

  async function openMergeModal() {
    showMergeModal = true;
    selectedMergePerson = null;
    mergeSearchQuery = '';
    mergeNameChoice = 'current';
    mergeCustomName = '';
    isLoadingPeople = true;

    try {
      const res = await fetch(`${API_BASE}/api/faces?limit=200`, { credentials: 'include' });
      if (res.ok) {
        const peopleList = await res.json();
        availablePeople = (peopleList || []).filter((p: any) => (p.person_id || p.id) !== data.id);
      }
    } catch (err) {
      console.error('Failed to load people for merge:', err);
      toast.error('Failed to load people list');
    } finally {
      isLoadingPeople = false;
    }
  }

  function selectPersonForMerge(person: any) {
    selectedMergePerson = person;
    if (!personName && person.name) {
      mergeNameChoice = 'target';
    } else {
      mergeNameChoice = 'current';
    }
  }

  async function handleConfirmMerge() {
    if (!selectedMergePerson || isMerging) return;
    isMerging = true;

    try {
      let chosenName: string | undefined;
      if (mergeNameChoice === 'current') {
        chosenName = personName || undefined;
      } else if (mergeNameChoice === 'target') {
        chosenName = selectedMergePerson.name || undefined;
      } else if (mergeNameChoice === 'custom') {
        chosenName = mergeCustomName.trim() || undefined;
      }

      const targetPersonId = data.id;
      const sourcePersonIds = [selectedMergePerson.person_id || selectedMergePerson.id];

      const res = await mergePersons(targetPersonId, sourcePersonIds, chosenName);
      toast.success(`Successfully merged with ${selectedMergePerson.name || 'person'}!`);
      showMergeModal = false;

      if (res.name !== undefined) {
        personName = res.name;
        editNameValue = res.name;
        data.personName = res.name;
      }

      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (err: any) {
      console.error('Failed to merge persons:', err);
      toast.error(err.message || 'Failed to merge persons');
    } finally {
      isMerging = false;
    }
  }

  // Search state
  let isSearchOpen = $state(false);
  let searchQuery = $state('');
  let isSearching = $state(false);
  let isSearchLoading = $state(false);
  let searchFiles = $state<MediaFile[]>([]);
  let searchInputEl: HTMLInputElement | undefined = $state();
  let searchDebounceTimer: any = null;
  let searchAbortController: AbortController | null = null;

  async function executeSearch(queryText: string) {
    const trimmed = queryText.trim();
    if (!trimmed) {
      isSearching = false;
      isSearchLoading = false;
      searchFiles = [];
      return;
    }

    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();

    isSearchLoading = true;
    isSearching = true;

    // Instant local filter first
    const qLower = trimmed.toLowerCase();
    searchFiles = (data.files || []).filter((f: MediaFile) => 
      f.file_name.toLowerCase().includes(qLower) || 
      (f.folder_path && f.folder_path.toLowerCase().includes(qLower))
    );

    try {
      const res = await searchPersonMedia(data.id, trimmed, fetch, searchAbortController.signal);
      searchFiles = res || [];
      visibleCount = 50;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to search person media:', err);
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
      return;
    }
    const qLower = searchQuery.trim().toLowerCase();
    searchFiles = (data.files || []).filter((f: MediaFile) => 
      f.file_name.toLowerCase().includes(qLower) || 
      (f.folder_path && f.folder_path.toLowerCase().includes(qLower))
    );
    isSearching = true;
    visibleCount = 50;

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
    visibleCount = 50;
    searchInputEl?.focus();
  }

  function closeSearch() {
    isSearchOpen = false;
    clearSearch();
  }
  let shareAllowDownloadImages = $state(true);
  let shareAllowDownloadFolder = $state(true);
  let shareAllowFavorites = $state(false);
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
  let shareLinksSubTab: 'active' | 'expired' = $state('active');

  let activeShares: ShareData[] = $state([]);
  let activeSharesList = $derived(activeShares.filter(s => !isShareExpired(s.expires_at)));
  let expiredSharesList = $derived(activeShares.filter(s => isShareExpired(s.expires_at)));

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

  let isCreatingShare = $state(false);
  let newlyCreatedShareToken = $state<string | null>(null);
  let copiedToken = $state<string | null>(null);

  $effect(() => {
    if (showShareModal) {
      loadActiveShares();
      newlyCreatedShareToken = null;
      extendingToken = null;
      editingShareToken = null;
    }
  });

  async function loadActiveShares() {
    try {
      const [shares, wData] = await Promise.all([
        getActivePersonShares(data.id),
        getWatermarkTemplatesForShare().catch(() => ({ templates: [], globalEnforced: false, globalTemplateId: null }))
      ]);
      activeShares = shares;
      watermarkTemplates = wData.templates || [];
      shareGlobalEnforced = Boolean(wData.globalEnforced);
      const gTpl = watermarkTemplates.find(t => t.id === wData.globalTemplateId);
      shareGlobalTemplateName = gTpl?.name || 'Default';
      if (shareGlobalEnforced && wData.globalTemplateId) {
        shareWatermarkTemplateId = wData.globalTemplateId;
      }
    } catch (e) { console.error(e); }
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
      const token = await createPersonShare(
        data.id,
        shareAllowDownloadImages,
        shareAllowDownloadFolder,
        isWatermarked,
        expiresAt,
        shareWatermarkTemplateId || null,
        shareAllowFavorites,
        sharePassword.trim() || null,
        shareLabel.trim() || null
      );
      toast.success('Share link created successfully!');
      newlyCreatedShareToken = token;
      sharePassword = '';
      shareLabel = '';
      await loadActiveShares();
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
      await loadActiveShares();
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
      await loadActiveShares();
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
        isActive: editIsActive,
        password: editSharePassword.trim() || undefined,
        removePassword: editRemovePassword || undefined,
        label: editShareLabel.trim() || null,
        createdAt: editCreatedAtDateTime ? new Date(editCreatedAtDateTime).toISOString() : undefined
      });

      toast.success('Share link parameters updated!');
      editingShareToken = null;
      await loadActiveShares();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to update share parameters');
    } finally {
      isSavingShareEdit = false;
    }
  }

  async function handleRevokeShare(token: string) {
    revokeTargetToken = token;
    showRevokeConfirm = true;
  }

  async function confirmRevokeShare() {
    try {
      await revokeShare(revokeTargetToken);
      await loadActiveShares();
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
    }
  }

  let displayedFiles = $derived(isSearching ? searchFiles : (data.files || []));

  let sortedFiles = $derived([...displayedFiles].sort((a, b) => {
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

  let localCoverOverride: string | null = $state(null);
  let localCoverBoundingBox: any = $state(null);
  let localCoverImgWidth: number | null = $state(null);
  let localCoverImgHeight: number | null = $state(null);
  let coverRefreshKey = $state(0);
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

  let fallbackCoverId = $derived(localCoverOverride || data.coverMediaId || (data.files.length > 0 ? data.files[0].id : null));
  let effectiveCoverBoundingBox = $derived(localCoverOverride ? localCoverBoundingBox : data.coverBoundingBox);
  let effectiveCoverImgWidth = $derived(localCoverOverride ? localCoverImgWidth : data.coverImgWidth);
  let effectiveCoverImgHeight = $derived(localCoverOverride ? localCoverImgHeight : data.coverImgHeight);

  let coverObjectPosition = $derived(computeCoverObjectPosition(effectiveCoverBoundingBox, effectiveCoverImgWidth, effectiveCoverImgHeight));



  function personUrl() {
    return `/people/${data.id}`;
  }

  function mediaUrl(index: number) {
    const file = sortedFiles[index];
    if (!file) return personUrl();
    return `${personUrl()}/${file.id}`;
  }

  let syncUrlTimer: ReturnType<typeof setTimeout> | null = null;
  function syncUrl(index: number | null, immediate = false) {
    if (syncUrlTimer) {
      clearTimeout(syncUrlTimer);
      syncUrlTimer = null;
    }
    const update = () => {
      const url = index !== null ? mediaUrl(index) : personUrl();
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

  async function handleSetCover(mediaId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/faces/${data.id}/cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mediaId })
      });
      if (!res.ok) throw new Error('Failed to set cover');
      localCoverOverride = mediaId;
      coverRefreshKey++;

      // Refresh cover dimensions and bounding box for updated positioning
      try {
        const coverRes = await fetch(`${API_BASE}/api/faces/${data.id}/cover`, { credentials: 'include' });
        if (coverRes.ok) {
          const coverData = await coverRes.json();
          localCoverBoundingBox = coverData.boundingBox || null;
          localCoverImgWidth = coverData.imgWidth || null;
          localCoverImgHeight = coverData.imgHeight || null;
        }
      } catch {}

      showAppAlert('Cover Updated', 'Person cover image has been updated.');
    } catch (e) {
      console.error(e);
      showAppAlert('Error', 'Failed to set cover image.');
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
    if (data.selectedMediaId && sortedFiles.length > 0) {
      const idx = sortedFiles.findIndex(f => f.id === data.selectedMediaId);
      if (idx >= 0) {
        selectedMediaIndex = idx;
        autoOpened = true;
      }
    }
  });

  async function saveName() {
    const trimmed = editNameValue.trim();
    if (!trimmed || trimmed === personName) {
      isEditingName = false;
      return;
    }
    isSaving = true;
    try {
      const res = await fetch(`${API_BASE}/api/faces/${data.id}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
        credentials: 'include'
      });
      if (res.ok) {
        personName = trimmed;
        editNameValue = trimmed;
        data.personName = trimmed;
        isEditingName = false;
      } else {
        toast.error('Failed to update name');
      }
    } catch (e) {
      console.error(e);
      toast.error('Error saving name');
    } finally {
      isSaving = false;
    }
  }

  let scrollProgress = $state(0);
  let headerWrapper: HTMLElement | undefined = $state();

  function handleScroll(e: Event) {
    if (!headerWrapper) return;
    const target = e.target as HTMLElement;
    const threshold = headerWrapper.offsetHeight - 25;
    if (threshold > 0) {
      scrollProgress = Math.min(1, Math.max(0, target.scrollTop / threshold));
    }
  }

  function isTyping(e: Event): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function cyclePersonViewMode() {
    const modes: ViewMode[] = ['small-fit', 'large-fit', 'small-square', 'large-square', 'compact-list'];
    const idx = modes.indexOf(viewMode);
    viewMode = modes[(idx + 1) % modes.length];
    showViewMenu = false;
  }

  function cyclePersonSortMode() {
    const modes: SortMode[] = ['newest', 'oldest', 'a-z', 'z-a'];
    const idx = modes.indexOf(sortMode);
    sortMode = modes[(idx + 1) % modes.length];
    showSortMenu = false;
  }

  function handlePersonDetailKeydown(e: KeyboardEvent) {
    if (selectedMediaIndex !== null) return;
    if (isTyping(e)) {
      if (e.key === 'Escape') {
        if (isSearchOpen) closeSearch();
        else (e.target as HTMLElement).blur();
      }
      return;
    }

    if (e.key === 'Escape') {
      if (showSortMenu || showViewMenu) {
        showSortMenu = false;
        showViewMenu = false;
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
      cyclePersonViewMode();
      return;
    }

    if ((e.key === 's' || e.key === 'S') && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      cyclePersonSortMode();
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

    if ((e.key === 'm' || e.key === 'M') && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      openMergeModal();
      return;
    }

    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      window.location.href = '/people';
      return;
    }
  }

  onMount(() => {
    sortMode = loadPref<SortMode>('personSortMode', 'newest');
    viewMode = loadPref<ViewMode>('personViewMode', 'small-fit');
    showFileNames = loadPref<boolean>('showFileNames', false);

    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.addEventListener('scroll', handleScroll);
    }
    windowWidth = window.innerWidth;
    const updateWidth = () => windowWidth = window.innerWidth;
    window.addEventListener('resize', updateWidth);
    window.addEventListener('keydown', handlePersonDetailKeydown);
    return () => {
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', updateWidth);
      window.removeEventListener('keydown', handlePersonDetailKeydown);
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
  <a href="/people"
     style="position: absolute; top: 24px; left: 24px; z-index: 20; color: rgba(255,255,255,0.4); text-decoration: none; display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; transition: color 0.2s, transform 0.2s;"
     onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }}
     onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}
     title="Back to all people">
    <ChevronLeft size={32} strokeWidth={2.5} />
  </a>
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
">
  <div class="header-content" class:frozen-mobile={scrollProgress === 1}>
    <div class="header-left">
      <div style="display: flex; flex-direction: row; align-items: center;">
      <div class="header-text-container">
          {#if isEditingName}
            <div class="edit-row">
              <input
                type="text"
                bind:value={editNameValue}
                class="name-input"
                placeholder="Add a name"
                onkeydown={(e) => e.key === 'Enter' && saveName()}
                disabled={isSaving}
                autofocus
              />
              <button class="btn primary" onclick={saveName} disabled={isSaving}>Save</button>
              <button class="btn" onclick={() => { isEditingName = false; editNameValue = personName; }}>Cancel</button>
            </div>
          {:else}
            <h2>
              <span 
                class="person-name {personName ? '' : 'placeholder'}" 
                onclick={() => isEditingName = true}
                title={personName ? 'Click to rename' : 'Add name'}
              >
                {personName || 'Add name...'}
              </span>
              <button class="icon-btn" onclick={() => isEditingName = true} title="Rename">
                <Pencil size={15} />
              </button>
            </h2>
          {/if}
      </div>
      </div>
    </div>

    <div class="header-right">
      <div class="toolbar">
        <a href="/people" 
           class="icon-btn mobile-only-back" 
           style="opacity: {scrollProgress === 1 ? 1 : 0}; width: {scrollProgress === 1 ? '36px' : '0'}; padding: {scrollProgress === 1 ? '8px' : '0'}; margin-right: {scrollProgress === 1 ? '0' : '-8px'}; overflow: hidden; transition: width 0.2s, opacity 0.2s, margin 0.2s, padding 0.2s; pointer-events: {scrollProgress === 1 ? 'auto' : 'none'}; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" 
           title="Back to all people (Backspace)">
          <ChevronLeft size={24} />
        </a>
        <button class="icon-btn" class:active={isSearchOpen} onclick={toggleSearch} title="Search (/ or ⌘K)">
          <Search size={18} />
        </button>
        <div class="dropdown-container" use:clickOutside={() => showSortMenu = false}>
          <button class="icon-btn" onclick={() => { showSortMenu = !showSortMenu; showViewMenu = false; }} title="Sort (S)">
            <ArrowDownUp size={18} />
          </button>
          {#if showSortMenu}
            <div class="dropdown-menu">
              <button class:active={sortMode === 'newest'} onclick={() => { sortMode = 'newest'; showSortMenu = false; }}>Newest to Oldest</button>
              <button class:active={sortMode === 'oldest'} onclick={() => { sortMode = 'oldest'; showSortMenu = false; }}>Oldest to Newest</button>
              <button class:active={sortMode === 'a-z'} onclick={() => { sortMode = 'a-z'; showSortMenu = false; }}>A to Z</button>
              <button class:active={sortMode === 'z-a'} onclick={() => { sortMode = 'z-a'; showSortMenu = false; }}>Z to A</button>
            </div>
          {/if}
        </div>

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

        <button class="icon-btn" onclick={openDownloadModal} title="Download Photos (Shift+D)">
          <Download size={18} />
        </button>
        <button class="icon-btn" onclick={openMergeModal} title="Merge with another person (M)">
          <Merge size={18} />
        </button>
        <button class="icon-btn" onclick={() => showShareModal = true} title="Share (Shift+S)">
          <Share2 size={18} />
        </button>
      </div>

      <span class="count" style="display: flex; flex-wrap: wrap; justify-content: flex-end; column-gap: 4px;">
        {#if isSearching && isSearchLoading}
          <span style="white-space: nowrap; color: #a1a1aa;">Searching...</span>
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
          placeholder={personName ? `Search photos of ${personName}...` : "Search photos of this person..."}
          bind:value={searchQuery}
          oninput={handleSearchInput}
          onkeydown={handleSearchKeydown}
          class="folder-search-input"
        />
        {#if searchQuery}
          <button class="search-clear-btn" onclick={clearSearch} title="Clear search">
            <X size={16} />
          </button>
        {/if}
        <button class="search-close-btn" onclick={closeSearch} title="Close search">
          <X size={18} />
        </button>
      </div>
    </div>
  {/if}
</div>

{#if isSearching && !isSearchLoading && sortedFiles.length === 0 && viewMode !== 'compact-list'}
  <div class="search-empty-state">
    <p class="empty-title">No photos found matching "{searchQuery}"</p>
    <p class="empty-subtitle">Check the spelling or try searching for a different filename</p>
    <button class="btn" onclick={clearSearch} style="margin-top: 14px; background: rgba(255,255,255,0.08); border: 1px solid var(--glass-border); color: white;">
      Clear Search
    </button>
  </div>
{/if}

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
          <p class="empty-title">No photos found matching "{searchQuery}"</p>
          <p class="empty-subtitle">Check the spelling or try searching for a different filename</p>
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
              {#if file.folder_path}
                <span class="file-path" style="font-size: 0.75rem; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={file.folder_path}>{file.folder_path}</span>
              {/if}
            </div>
          </div>
          <div class="col-date">{formatFileDate(file)}</div>
          <div class="col-res">{getFileDimensions(file)}</div>
          <div class="col-size">{formatBytes(file.size_bytes)}</div>
          <div class="col-actions" onclick={(e) => e.stopPropagation()}>
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
    {#each visibleFiles as file, i (file.id)}
      <BlurhashImage
        hash={file.blurhash || ''}
        src={`${getThumbnailUrl(file.id)}${file.blurhash ? '?cb=' + encodeURIComponent(file.blurhash) : ''}`}
        alt={file.file_name}
        fileName={file.file_name}
        showFileName={showFileNames || isSearching}
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
{/if}

{#if visibleCount < sortedFiles.length}
  <div use:infiniteScroll style="height: 20px; width: 100%;"></div>
{/if}

{#if selectedMediaIndex !== null && sortedFiles[selectedMediaIndex]}
  <Lightbox 
    media={sortedFiles[selectedMediaIndex]}
    onclose={closeLightbox}
    onnext={nextMedia}
    onprev={prevMedia}
    onsetcover={handleSetCover}
  />
{/if}

<Modal bind:show={showShareModal} id="person-share" title="Share Person">
  <p style="color: #888; margin-bottom: 16px; font-size: 0.875rem;">
    Creates a share link that only shows photos of <strong>{personName || 'this person'}</strong>.
  </p>

  {#if newlyCreatedShareToken}
    <div style="background: rgba(0,255,100,0.1); border: 1px solid rgba(0,255,100,0.3); padding: 16px; border-radius: 8px; margin-bottom: 24px;">
      <p style="color: #4ade80; margin-bottom: 8px; font-weight: 500;">Share link created successfully!</p>
      <div style="display: flex; gap: 8px;">
        <input type="text" readonly value="{(import.meta.env.PUBLIC_APP_DOMAIN as string) || (typeof window !== 'undefined' ? window.location.origin : '')}/share/{newlyCreatedShareToken}" style="flex: 1; padding: 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px;" />
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

  <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--glass-border);">
    <h4 style="margin-bottom: 16px; font-weight: 500;">Create New Share Link</h4>
    
    <div class="form-group" style="margin-bottom: 16px;">
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
          <input type="number" bind:value={shareExpiryValue} min="1" style="width: 80px; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit;" />
          <select bind:value={shareExpiryUnit} style="flex: 1; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-family: inherit;">
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
      <input type="checkbox" id="personShareAllowDlImg" bind:checked={shareAllowDownloadImages} style="width: 18px; height: 18px;" />
      <label for="personShareAllowDlImg" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow downloading individual images</label>
    </div>

    <div class="form-group" style="margin-bottom: 8px; display: flex; align-items: center; gap: 12px;">
      <input type="checkbox" id="personShareAllowDlFolder" bind:checked={shareAllowDownloadFolder} style="width: 18px; height: 18px;" />
      <label for="personShareAllowDlFolder" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow downloading the entire folder (ZIP)</label>
    </div>

    <div class="form-group" style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px;">
      <input type="checkbox" id="personShareAllowFavs" bind:checked={shareAllowFavorites} style="width: 18px; height: 18px;" />
      <label for="personShareAllowFavs" style="font-size: 0.875rem; color: #ccc; cursor: pointer;">Allow visitors to favorite photos and filter favorites</label>
    </div>

    <!-- Label for Internal Reference -->
    <div class="form-group" style="margin-bottom: 16px;">
      <label for="personShareLabelInput" style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 0.875rem; color: #ccc;">
        <Tag size={14} color="#c084fc" />
        <span>Label (Internal Reference, Optional)</span>
      </label>
      <input
        id="personShareLabelInput"
        type="text"
        bind:value={shareLabel}
        placeholder="e.g. Client Link, Social Preview, Family"
        style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); color: white; border-radius: 4px; font-size: 0.875rem;"
      />
    </div>

    <!-- Password Protection (Optional) -->
    <div class="form-group" style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label for="personSharePwdInput" style="font-size: 0.875rem; color: #ccc; display: flex; align-items: center; gap: 6px;">
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
          id="personSharePwdInput"
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

    <div class="form-group" style="margin-bottom: 22px;">
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
        <p style="color: #666; font-size: 0.875rem;">No active links for this person's gallery.</p>
      {:else}
        <div style="display: flex; flex-direction: column; gap: 12px; max-height: 250px; overflow-y: auto;">
          {#each activeSharesList as share}
            <div style="background: rgba(255,255,255,0.05); border: 1px solid var(--glass-border); padding: 12px; border-radius: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span style="font-family: monospace; color: #e4e4e7; font-weight: 500;">...{share.share_token.substring(0, 8)}</span>
                    {#if share.label}
                      <span style="background: rgba(147, 51, 234, 0.2); color: #d8b4fe; border: 1px solid rgba(147, 51, 234, 0.35); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;" title="Internal reference label">
                        <Tag size={10} />
                        {share.label}
                      </span>
                    {/if}
                    {#if share.is_active === false}
                      <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">
                        Disabled
                      </span>
                    {:else}
                      <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">
                        Active
                      </span>
                    {/if}
                    {#if share.has_password}
                      <span style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;">
                        <Lock size={10} />
                        Password
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
                      {#if share.allow_favorites}
                        <span style="color: #f43f5e; font-weight: 500;">· Favs</span>
                      {/if}
                      {#if share.has_password}
                        <span style="color: #fbbf24; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;">
                          · <Lock size={10} /> Password Protected
                        </span>
                      {/if}
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
                    <label for="editPersonLabel-{share.share_token}" style="display: flex; align-items: center; gap: 5px; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">
                      <Tag size={12} color="#c084fc" />
                      <span>Label (Internal Reference)</span>
                    </label>
                    <input
                      id="editPersonLabel-{share.share_token}"
                      type="text"
                      bind:value={editShareLabel}
                      placeholder="e.g. Client Link, Social Preview, Family"
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
                      <input type="checkbox" id="editPersonDlImg-{share.share_token}" bind:checked={editAllowDownloadImages} style="width: 15px; height: 15px;" />
                      <label for="editPersonDlImg-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow downloading individual images</label>
                    </div>

                    <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                      <input type="checkbox" id="editPersonDlFolder-{share.share_token}" bind:checked={editAllowDownloadFolder} style="width: 15px; height: 15px;" />
                      <label for="editPersonDlFolder-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow downloading entire gallery (ZIP)</label>
                    </div>

                    <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                      <input type="checkbox" id="editPersonFav-{share.share_token}" bind:checked={editAllowFavorites} style="width: 15px; height: 15px;" />
                      <label for="editPersonFav-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow visitors to favorite photos</label>
                    </div>

                    <div style="display: flex; align-items: center; gap: 8px;">
                      <input type="checkbox" id="editPersonActive-{share.share_token}" bind:checked={editIsActive} style="width: 15px; height: 15px;" />
                      <label for="editPersonActive-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Link is active (enabled)</label>
                    </div>
                  </div>

                  <!-- Password Section in Edit Person Share -->
                  <div style="margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                      <label for="editPersonPwd-{share.share_token}" style="display: flex; align-items: center; gap: 5px; font-size: 0.75rem; color: #aaa;">
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
                        id="editPersonPwd-{share.share_token}"
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
                          id="removePersonPwd-{share.share_token}"
                          bind:checked={editRemovePassword}
                          style="width: 14px; height: 14px;"
                          onchange={() => { if (editRemovePassword) editSharePassword = ''; }}
                        />
                        <label for="removePersonPwd-{share.share_token}" style="font-size: 0.75rem; color: #f87171; cursor: pointer;">
                          Remove password protection
                        </label>
                      </div>
                    {/if}
                  </div>

                  <!-- Creation Date Section -->
                  <div style="margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px;">
                    <label for="editPersonCreatedAt-{share.share_token}" style="display: flex; align-items: center; gap: 5px; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">
                      <Clock size={12} color="#60a5fa" />
                      <span>Creation Date</span>
                    </label>
                    <input
                      id="editPersonCreatedAt-{share.share_token}"
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
        <p style="color: #666; font-size: 0.875rem;">No expired links for this person's gallery.</p>
      {:else}
        <div style="display: flex; flex-direction: column; gap: 12px; max-height: 250px; overflow-y: auto;">
          {#each expiredSharesList as share}
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(239, 68, 68, 0.2); padding: 12px; border-radius: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <div>
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span style="font-family: monospace; color: #a1a1aa; font-weight: 500;">...{share.share_token.substring(0, 8)}</span>
                    {#if share.label}
                      <span style="background: rgba(147, 51, 234, 0.2); color: #d8b4fe; border: 1px solid rgba(147, 51, 234, 0.35); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;" title="Internal reference label">
                        <Tag size={10} />
                        {share.label}
                      </span>
                    {/if}
                    <span style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500;">
                      Expired
                    </span>
                    {#if share.has_password}
                      <span style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;">
                        <Lock size={10} />
                        Password
                      </span>
                    {/if}
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
                    {#if share.has_password}
                      <span style="color: #fbbf24; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;">
                        · <Lock size={10} /> Password Protected
                      </span>
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
                    <label for="editPersonLabel-{share.share_token}" style="display: flex; align-items: center; gap: 5px; margin-bottom: 6px; font-size: 0.75rem; color: #aaa;">
                      <Tag size={12} color="#c084fc" />
                      <span>Label (Internal Reference)</span>
                    </label>
                    <input
                      id="editPersonLabel-{share.share_token}"
                      type="text"
                      bind:value={editShareLabel}
                      placeholder="e.g. Client Link, Social Preview, Family"
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
                      <input type="checkbox" id="editPersonExpDlImg-{share.share_token}" bind:checked={editAllowDownloadImages} style="width: 15px; height: 15px;" />
                      <label for="editPersonExpDlImg-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow downloading individual images</label>
                    </div>

                    <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                      <input type="checkbox" id="editPersonExpDlFolder-{share.share_token}" bind:checked={editAllowDownloadFolder} style="width: 15px; height: 15px;" />
                      <label for="editPersonExpDlFolder-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow downloading entire gallery (ZIP)</label>
                    </div>

                    <div style="margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                      <input type="checkbox" id="editPersonExpFav-{share.share_token}" bind:checked={editAllowFavorites} style="width: 15px; height: 15px;" />
                      <label for="editPersonExpFav-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Allow visitors to favorite photos</label>
                    </div>

                    <div style="display: flex; align-items: center; gap: 8px;">
                      <input type="checkbox" id="editPersonExpActive-{share.share_token}" bind:checked={editIsActive} style="width: 15px; height: 15px;" />
                      <label for="editPersonExpActive-{share.share_token}" style="font-size: 0.78rem; color: #ccc; cursor: pointer;">Link is active (reactivate link)</label>
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
</Modal>



<Modal bind:show={showRevokeConfirm} id="person-revoke-confirm" title="Revoke Share Link">
  <p style="color: #ccc; margin-bottom: 24px; line-height: 1.5;">Are you sure you want to revoke this share link? Anyone using it will instantly lose access.</p>
  <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem;">
    <button class="btn" style="background: transparent; border: 1px solid var(--glass-border); color: #ccc;" onclick={() => { showRevokeConfirm = false; revokeTargetToken = ''; }}>Cancel</button>
    <button class="btn" style="background: #ef4444; color: white; border: none;" onclick={confirmRevokeShare}>Revoke</button>
  </div>
</Modal>

<ZipDownloadModal 
  bind:show={showDownloadModal} 
  personId={data.id} 
  folderName={personName || 'Person'} 
/>

<Modal bind:show={showMergeModal} id="person-merge" title="Merge Person">
  <div class="merge-modal-content">
    <!-- Current Person Header Card -->
    <div class="merge-person-card">
      <div class="merge-avatar">
        <img 
          src={getFaceThumbnailUrl(data.id)} 
          alt={personName || 'Current Person'} 
          onerror={(e) => { 
            const el = e.currentTarget as HTMLElement;
            el.style.display = 'none';
            if (el.nextElementSibling) (el.nextElementSibling as HTMLElement).style.display = 'flex';
          }} 
        />
        <div class="avatar-fallback" style="display: none;"><User size={22} /></div>
      </div>
      <div class="merge-info">
        <span class="merge-badge">Current Person</span>
        <h4 class="merge-name">{personName || 'Unnamed Person'}</h4>
        <span class="merge-count">{data.files.length} {data.files.length === 1 ? 'photo' : 'photos'}</span>
      </div>
    </div>

    <!-- Step 1: Select person to merge with -->
    <div class="merge-section">
      <label for="merge-search-input" class="merge-section-title">Select Person to Merge With</label>
      <div class="merge-search-box">
        <Search size={16} class="merge-search-icon" />
        <input 
          id="merge-search-input"
          type="text" 
          bind:value={mergeSearchQuery} 
          placeholder="Filter people by name..." 
          class="merge-search-input"
        />
        {#if mergeSearchQuery}
          <button type="button" class="merge-search-clear" onclick={() => mergeSearchQuery = ''}>
            <X size={14} />
          </button>
        {/if}
      </div>

      {#if isLoadingPeople}
        <div class="merge-status-box">
          <Loader2 size={18} class="spinner" />
          <span>Loading people...</span>
        </div>
      {:else if filteredPeople.length === 0}
        <div class="merge-status-box">
          <span>{mergeSearchQuery ? `No people found matching "${mergeSearchQuery}"` : 'No other people available to merge.'}</span>
        </div>
      {:else}
        <div class="merge-candidates-list">
          {#each filteredPeople as person (person.person_id || person.id)}
            {@const pId = person.person_id || person.id}
            {@const isSelected = selectedMergePerson && (selectedMergePerson.person_id || selectedMergePerson.id) === pId}
            <button 
              type="button" 
              class="merge-candidate-item" 
              class:selected={isSelected}
              onclick={() => selectPersonForMerge(person)}
            >
              <div class="merge-avatar small">
                <img 
                  src={getFaceThumbnailUrl(pId)} 
                  alt={person.name || 'Person'} 
                  onerror={(e) => { 
                    const el = e.currentTarget as HTMLElement;
                    el.style.display = 'none';
                    if (el.nextElementSibling) (el.nextElementSibling as HTMLElement).style.display = 'flex';
                  }} 
                />
                <div class="avatar-fallback" style="display: none;"><User size={16} /></div>
              </div>
              <div class="candidate-text">
                <span class="candidate-name">{person.name || 'Unnamed Person'}</span>
                <span class="candidate-count">{person.face_count || 0} {person.face_count === 1 ? 'photo' : 'photos'}</span>
              </div>
              {#if isSelected}
                <div class="candidate-check">
                  <Check size={16} />
                </div>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Step 2: Name Selection (when a candidate is chosen) -->
    {#if selectedMergePerson}
      <div class="merge-section resulting-section">
        <span class="merge-section-title">Resulting Person Name</span>
        <p class="merge-section-desc">Choose which name to keep for the merged identity:</p>
        
        <div class="merge-name-options">
          <label class="merge-radio-label" class:active={mergeNameChoice === 'current'}>
            <input type="radio" bind:group={mergeNameChoice} value="current" />
            <span>Keep current name: <strong>{personName || 'Unnamed Person'}</strong></span>
          </label>

          <label class="merge-radio-label" class:active={mergeNameChoice === 'target'}>
            <input type="radio" bind:group={mergeNameChoice} value="target" />
            <span>Keep other person's name: <strong>{selectedMergePerson.name || 'Unnamed Person'}</strong></span>
          </label>

          <label class="merge-radio-label" class:active={mergeNameChoice === 'custom'}>
            <input type="radio" bind:group={mergeNameChoice} value="custom" />
            <span>Type a new custom name</span>
          </label>

          {#if mergeNameChoice === 'custom'}
            <input 
              type="text" 
              bind:value={mergeCustomName} 
              placeholder="Enter new person name..." 
              class="name-input custom-name-input" 
              autofocus
            />
          {/if}
        </div>

        <div class="merge-warning-box">
          <AlertCircle size={18} class="warning-icon" />
          <p class="warning-text">
            All photos ({data.files.length} from current person, {selectedMergePerson.face_count || 0} from selected person) will be combined under the chosen profile. This action cannot be undone.
          </p>
        </div>
      </div>
    {/if}

    <div class="modal-actions">
      <button type="button" class="btn secondary" onclick={() => showMergeModal = false} disabled={isMerging}>
        Cancel
      </button>
      <button 
        type="button" 
        class="btn primary" 
        onclick={handleConfirmMerge} 
        disabled={!selectedMergePerson || isMerging || (mergeNameChoice === 'custom' && !mergeCustomName.trim())}
      >
        {#if isMerging}
          <Loader2 size={16} class="spinner" />
          <span>Merging...</span>
        {:else}
          <Merge size={16} />
          <span>Merge Persons</span>
        {/if}
      </button>
    </div>
  </div>
</Modal>

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
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
    background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.3) 65%, rgba(0,0,0,0.95) 100%);
    pointer-events: none;
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
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--text-color);
    background: transparent;
    font-weight: 700;
    font-size: 2.5rem;
    margin-bottom: 0;
    text-shadow: 0 2px 10px rgba(0,0,0,0.5);
  }

  .header-text-container {
    overflow: hidden;
  }

  .person-name {
    font-family: 'Cabinet Grotesk', sans-serif;
    font-weight: 700;
    color: var(--text-color, #ffffff);
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .person-name:hover {
    opacity: 0.85;
  }

  .person-name.placeholder {
    color: rgba(255,255,255,0.35);
    font-style: italic;
    font-weight: 400;
  }

  .person-name.placeholder:hover {
    color: rgba(255,255,255,0.6);
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
    min-width: 180px;
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

  .grid.small-fit::after, .grid.large-fit::after {
    content: "";
    flex-grow: 999999999;
  }

  .edit-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .name-input {
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255,255,255,0.15);
    color: #f1f5f9;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 1.2rem;
    font-weight: 500;
    text-shadow: 0 1px 4px rgba(0,0,0,0.5);
    min-width: 250px;
  }
  .name-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  .btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.875rem;
    background: rgba(255, 255, 255, 0.1);
    color: #e4e4e7;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .btn:hover {
    background: rgba(255, 255, 255, 0.18);
    color: white;
  }
  .btn.primary {
    background: var(--text-color);
    color: var(--bg-color);
  }
  .btn.primary:hover {
    background: #e4e4e7;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .dropdown-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 4px 0;
  }
  .dropdown-menu button.toggle-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* Search bar styles */
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
  .search-clear-btn {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    margin-right: 4px;
  }
  .search-clear-btn:hover {
    color: white;
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
  .search-empty-state, .compact-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 24px;
    text-align: center;
    min-height: 280px;
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
    cursor: pointer;
    transition: background 0.15s ease;
    user-select: none;
  }
  .compact-row:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .compact-row:last-child {
    border-bottom: none;
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

  /* Merge Modal styles */
  .merge-modal-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .merge-person-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
  }
  .merge-avatar {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.08);
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .merge-avatar.small {
    width: 36px;
    height: 36px;
  }
  .merge-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .avatar-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
  }
  .merge-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .merge-badge {
    font-size: 0.7rem;
    color: #60a5fa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }
  .merge-name {
    margin: 2px 0 0 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .merge-count {
    font-size: 0.8rem;
    color: #a1a1aa;
  }
  .merge-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .merge-section-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #f1f5f9;
  }
  .merge-section-desc {
    margin: 0;
    font-size: 0.8rem;
    color: #a1a1aa;
  }
  .merge-search-box {
    display: flex;
    align-items: center;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid var(--glass-border);
    border-radius: 6px;
    padding: 0 10px;
    height: 36px;
  }
  :global(.merge-search-icon) {
    color: #888;
    margin-right: 8px;
    flex-shrink: 0;
  }
  .merge-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: white;
    font-size: 0.85rem;
    font-family: inherit;
  }
  .merge-search-clear {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 2px;
    display: flex;
  }
  .merge-status-box {
    padding: 16px;
    text-align: center;
    color: #a1a1aa;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .merge-candidates-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .merge-candidate-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
    color: white;
    width: 100%;
  }
  .merge-candidate-item:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
  }
  .merge-candidate-item.selected {
    background: rgba(59, 130, 246, 0.15);
    border-color: #3b82f6;
  }
  .candidate-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .candidate-name {
    font-size: 0.875rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .candidate-count {
    font-size: 0.75rem;
    color: #a1a1aa;
  }
  .candidate-check {
    color: #3b82f6;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .resulting-section {
    border-top: 1px solid var(--glass-border);
    padding-top: 14px;
  }
  .merge-name-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }
  .merge-radio-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: #d1d5db;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 6px;
    transition: background 0.15s;
  }
  .merge-radio-label:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .merge-radio-label.active {
    color: white;
  }
  .custom-name-input {
    margin-top: 4px;
    font-size: 0.95rem;
    padding: 8px 12px;
    width: 100%;
    box-sizing: border-box;
  }
  .merge-warning-box {
    margin-top: 8px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.25);
    border-radius: 6px;
  }
  :global(.warning-icon) {
    color: #f59e0b;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .warning-text {
    margin: 0;
    font-size: 0.8rem;
    color: #fcd34d;
    line-height: 1.4;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 12px;
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
    .toolbar .dropdown-menu {
      right: auto;
      left: 0;
    }
  }
  @media (min-width: 769px) {
    .mobile-only-back {
      display: none !important;
    }
  }
</style>
