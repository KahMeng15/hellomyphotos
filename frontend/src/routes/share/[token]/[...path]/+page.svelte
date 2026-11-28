<script lang="ts">
import { slide } from 'svelte/transition';

  import BlurhashImage from '$lib/components/BlurhashImage.svelte';
  import CoverImage from '$lib/components/CoverImage.svelte';
  import Lightbox from '$lib/components/Lightbox.svelte';
  import ZipDownloadModal from '$lib/components/ZipDownloadModal.svelte';
  import { getThumbnailUrl, getPreviewUrl, getStreamUrl, setFolderCover, getFolderZipUrl, setFolderDescription, toggleFavorite } from '$lib/api/media';
  import { toast } from '$lib/stores/toast';
  import { computeCoverObjectPosition } from '$lib/utils/cover';
  import { getSortDate, getRawDate } from '$lib/utils/date';
  import { createShare, getActiveShares, revokeShare, submitAccessRequest, searchShareContent, unlockShare, type ShareData } from '$lib/api/shares';
  import { getNearestExpiryDuration } from '$lib/utils/shareUtils';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import { ChevronLeft, ArrowDownUp, LayoutGrid, Download, Share2, Settings, X, ChevronDown, Check, Copy, Trash2, Clock, Folder, AlertCircle, List, Image as ImageIcon, Film, Search, Loader2, Radio, RefreshCw, Sparkles, Layers, Heart, Lock, Eye, EyeOff, LogOut } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';
  import { getTurnstileSitekey } from '$lib/api/turnstile';
  import { API_BASE } from '$lib/api/media';
  import { tracker } from '$lib/utils/analyticsTracker';
  
  let { data }: { data: PageData } = $props();

  let isStagedFolder = $derived(Boolean((data as any).isStagedFolder || data.files?.some((f: any) => f.is_staged)));
  let stagingNotice = $derived((data as any).stagingNotice || (isStagedFolder ? {
    enabled: true,
    title: 'Realtime Photo Sync in Progress',
    message: 'Note that the photos in this app are being synced in realtime and are not filtered or edited yet. Please return during a later time for the final images. Any enquiries about these photos, you may contact the photographer.'
  } : null));

  let isRefreshingPhotos = $state(false);

  async function handleRefreshPhotos() {
    if (isRefreshingPhotos) return;
    isRefreshingPhotos = true;
    try {
      await invalidateAll();
    } finally {
      setTimeout(() => {
        isRefreshingPhotos = false;
      }, 600);
    }
  }
  
  let verifyingTurnstile = $state(false);
  let turnstileError = $state('');

  let widgetContainer: HTMLElement;
  let turnstileWidgetId: string | null = null;
  
  type SortMode = 'newest' | 'oldest' | 'a-z' | 'z-a';
  type ViewMode = 'small-fit' | 'large-fit' | 'small-square' | 'large-square' | 'compact-list';
  type FolderViewMode = 'small-grid' | 'medium-grid' | 'large-grid' | 'list';

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
  }

  let hasSyncedPreferences = $state(false);
  let sortMode: SortMode = $state(loadPref<SortMode>('shareSortMode', (data as any).defaultShareSortMode || 'oldest'));
  let viewMode: ViewMode = $state(loadPref<ViewMode>('shareViewMode', (data as any).defaultShareViewMode || 'small-fit'));
  let folderViewMode: FolderViewMode = $state(loadPref<FolderViewMode>('shareFolderViewMode', (data as any).defaultShareFolderViewMode || 'small-grid'));
  let showFileNames = $state(loadPref<boolean>('showFileNames', false));

  let showZipProgressModal = $state(false);
  let zipTargetFolderPath = $state('');
  let zipTargetFolderName = $state('');

  function startFolderZipDownload(folderPath: string, folderName?: string) {
    zipTargetFolderPath = folderPath;
    zipTargetFolderName = folderName || (folderPath ? folderPath.split('/').pop() : 'Photos') || 'Photos';
    showZipProgressModal = true;
  }

  let showRequestForm = $state(false);
  let reqName = $state('');
  let reqEmail = $state('');
  let reqNote = $state('');
  let reqSubmitting = $state(false);
  let reqSuccess = $state(false);
  let reqError = $state('');
  let requestWidgetContainer = $state<HTMLElement | undefined>();
  let requestTurnstileWidgetId: string | null = null;
  let reqTurnstileToken = $state('');

  function renderRequestTurnstile() {
    if (typeof window === 'undefined') return;
    if ((window as any).turnstile && requestWidgetContainer && !requestTurnstileWidgetId && sitekey) {
      requestTurnstileWidgetId = (window as any).turnstile.render(requestWidgetContainer, {
        sitekey,
        theme: 'dark',
        action: 'access-request',
        callback: (token: string) => {
          reqTurnstileToken = token;
          reqError = '';
        },
        'expired-callback': () => {
          reqTurnstileToken = '';
        },
        'error-callback': () => {
          reqTurnstileToken = '';
        }
      });
    }
  }

  $effect(() => {
    if (showRequestForm && requestWidgetContainer && !requestTurnstileWidgetId && sitekey) {
      setTimeout(renderRequestTurnstile, 50);
    }
  });

  async function handleSubmitAccessRequest() {
    if (sitekey && !reqTurnstileToken) {
      reqError = 'Please complete the security check.';
      return;
    }

    try {
      reqSubmitting = true;
      reqError = '';
      await submitAccessRequest(data.token || '', {
        name: reqName.trim() || undefined,
        email: reqEmail.trim() || undefined,
        note: reqNote.trim() || undefined,
        'cf-turnstile-response': reqTurnstileToken || undefined
      });
      reqSuccess = true;
    } catch (err: any) {
      console.error(err);
      reqError = err.message || 'Failed to submit access request';
      if (requestTurnstileWidgetId && (window as any).turnstile) {
        (window as any).turnstile.reset(requestTurnstileWidgetId);
        reqTurnstileToken = '';
      }
    } finally {
      reqSubmitting = false;
    }
  }

  // Password Unlock Gate State
  let passwordInput = $state('');
  let showPassword = $state(false);
  let passwordError = $state((data as any).lockoutMessage || '');
  let isLockedOut = $state(Boolean((data as any).isLockedOut));
  let unlocking = $state(false);
  let passwordTurnstileToken = $state('');
  let passwordWidgetContainer = $state<HTMLElement | undefined>();
  let passwordTurnstileWidgetId: string | null = null;

  function renderPasswordTurnstile() {
    if (typeof window === 'undefined') return;
    if ((window as any).turnstile && passwordWidgetContainer && !passwordTurnstileWidgetId && sitekey) {
      passwordTurnstileWidgetId = (window as any).turnstile.render(passwordWidgetContainer, {
        sitekey,
        theme: 'dark',
        action: 'share-password',
        callback: (token: string) => {
          passwordTurnstileToken = token;
          passwordError = '';
        },
        'expired-callback': () => {
          passwordTurnstileToken = '';
        },
        'error-callback': () => {
          passwordTurnstileToken = '';
        }
      });
    }
  }

  $effect(() => {
    if (data.passwordRequired && passwordWidgetContainer && !passwordTurnstileWidgetId && sitekey) {
      setTimeout(renderPasswordTurnstile, 50);
    }
  });

  async function handleUnlockShare(e?: Event) {
    if (e) e.preventDefault();
    if (!passwordInput.trim()) {
      passwordError = 'Please enter the password.';
      return;
    }
    if (sitekey && !passwordTurnstileToken) {
      passwordError = 'Please complete the security check.';
      return;
    }

    try {
      unlocking = true;
      passwordError = '';
      const res = await unlockShare(data.token || '', passwordInput, passwordTurnstileToken);
      if (res.success) {
        await invalidateAll();
      }
    } catch (err: any) {
      passwordError = err.message || 'Incorrect password. Please try again.';
      if (err.message && err.message.toLowerCase().includes('too many failed attempts')) {
        isLockedOut = true;
      }
      if (passwordTurnstileWidgetId && (window as any).turnstile) {
        (window as any).turnstile.reset(passwordTurnstileWidgetId);
        passwordTurnstileToken = '';
      }
    } finally {
      unlocking = false;
    }
  }

  async function handleExitShare(e?: MouseEvent) {
    if (e) e.preventDefault();
    const shareToken = data.token || (data.share as any)?.share_token;
    if (shareToken) {
      try {
        await fetch(`${API_BASE}/api/shares/${shareToken}/exit`, {
          method: 'POST',
          credentials: 'include'
        });
      } catch (err) {
        console.error('Failed to exit share:', err);
      }
      window.location.href = `/share/${shareToken}`;
      window.location.reload();
    }
  }

  let expiryText = $derived.by(() => {
    if (!data.share?.expires_at) return null;
    const dur = getNearestExpiryDuration(data.share.expires_at);
    if (!dur || dur === 'Expired') return null;
    return dur.toLowerCase();
  });

  let windowWidth = $state(typeof window !== 'undefined' ? window.innerWidth : 1024);

  $effect(() => {
    if (hasSyncedPreferences) {
      savePref('shareSortMode', sortMode);
    }
  });
  $effect(() => {
    if (hasSyncedPreferences) {
      savePref('shareViewMode', viewMode);
    }
  });
  $effect(() => {
    if (hasSyncedPreferences) {
      savePref('shareFolderViewMode', folderViewMode);
    }
  });
  $effect(() => {
    if (hasSyncedPreferences) {
      savePref('shareStagingViewMode', stagingViewMode);
    }
  });
  $effect(() => {
    if (hasSyncedPreferences) {
      savePref('showFileNames', showFileNames);
    }
  });
  $effect(() => {
    const current = data.folderPath || data.share?.folder_path || '';
    if (current) tracker.recordFolder(current);
  });

  function selectSortMode(mode: SortMode) {
    if (sortMode !== mode) {
      sortMode = mode;
      tracker.recordSortChange(mode);
    }
    showSortMenu = false;
  }

  function selectViewMode(mode: ViewMode) {
    if (viewMode !== mode) {
      viewMode = mode;
      tracker.recordViewChange(mode);
    }
    showViewMenu = false;
  }

  function selectFolderViewMode(mode: FolderViewMode) {
    if (folderViewMode !== mode) {
      folderViewMode = mode;
      tracker.recordFolderViewChange(mode);
    }
    showFolderViewMenu = false;
  }

  function toggleFileNames() {
    showFileNames = !showFileNames;
    showViewMenu = false;
    showFolderViewMenu = false;
  }

  let showSortMenu = $state(false);
  let showViewMenu = $state(false);
  let activeFolderMenu = $state<string | null>(null);
  let showFolderViewMenu = $state(false);

  // Search state
  let isSearchOpen = $state(false);
  let searchQuery = $state('');
  let isSearching = $state(false);
  let isSearchLoading = $state(false);
  let searchFiles: any[] = $state([]);
  let searchDirectories: any[] = $state([]);
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
      let subpath = '';
      if (data.folderPath && data.baseFolderPath && data.folderPath.startsWith(data.baseFolderPath + '/')) {
        subpath = data.folderPath.slice(data.baseFolderPath.length + 1);
      }
      const token = data.token || (page.params.token as string);
      const res = await searchShareContent(token, subpath, trimmed, fetch, searchAbortController.signal);
      searchFiles = res.files || [];
      searchDirectories = res.directories || [];
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to search share:', err);
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

  let previousSharePath = $state(data.folderPath);
  $effect(() => {
    if (data.folderPath !== previousSharePath) {
      previousSharePath = data.folderPath;
      closeSearch();
    }
  });

  let personName = $derived(data.person ? (data.person.name || 'Unnamed Person') : null);

  let displayedDirectories = $derived(!personName ? (isSearching ? searchDirectories : (data.directories || [])) : []);
  let displayedFiles = $derived(isSearching ? searchFiles : (data.files || []));

  let stagingViewMode = $state<'curated' | 'all'>(loadPref<'curated' | 'all'>('shareStagingViewMode', (data.share as any)?.default_staging_view || 'all'));
  let hasQueryFavorites = $derived(
    page.url.searchParams.get('favorites') === 'true' ||
    page.url.searchParams.get('favorites') === '1' ||
    page.url.searchParams.get('view') === 'favorites'
  );
  let showOnlyFavorites = $state(false);
  let canFavorite = $derived(Boolean((data.share as any)?.allow_favorites));
  let canFilterFavorites = $derived(Boolean((data.share as any)?.allow_filter_favorites));
  let hasFavoritesInFolder = $derived((displayedFiles || []).some((f: any) => f.is_favorite));

  $effect(() => {
    if (hasQueryFavorites && canFilterFavorites) {
      showOnlyFavorites = true;
    }
  });

  let curatedFiles = $derived(
    stagingViewMode === 'curated'
      ? displayedFiles.filter((f: any) => f.is_hero || !f.burst_group_id)
      : displayedFiles
  );

  let favoriteFilteredFiles = $derived(
    showOnlyFavorites
      ? curatedFiles.filter((f: any) => f.is_favorite)
      : curatedFiles
  );

  let isFolderOnly = $derived(!personName && displayedFiles.length === 0 && displayedDirectories.length > 0);

  let sortedDirectories = $derived(displayedDirectories.slice().sort((a: any, b: any) => {
    if (sortMode === 'a-z') return a.name.localeCompare(b.name);
    if (sortMode === 'z-a') return b.name.localeCompare(a.name);
    return 0;
  }));

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
    if (!canFavorite) return;
    const targetState = !file.is_favorite;
    handleFavoriteUpdated(file.id, targetState);
    try {
      const res = await toggleFavorite(file.id, targetState, data.token);
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

  function getShareDirHref(dir: any) {
    if (dir.path_from_share !== undefined) {
      return dir.path_from_share ? `/share/${page.params.token}/${encodePath(dir.path_from_share)}` : `/share/${page.params.token}`;
    }
    const current = data.folderPath ? `${data.folderPath}/${dir.name}` : dir.name;
    const rel = (data.baseFolderPath && current.startsWith(data.baseFolderPath + '/')) 
      ? current.slice(data.baseFolderPath.length + 1) 
      : (current === data.baseFolderPath ? '' : current);
    return rel ? `/share/${page.params.token}/${encodePath(rel)}` : `/share/${page.params.token}`;
  }
  
  let selectedMediaIndex: number | null = $state(null);

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

  function encodePath(p: string) {
    return p.split('/').map(s => encodeURIComponent(s)).join('/');
  }

  function folderUrl() {
    const fp = data.folderPath || '';
    const base = `/share/${page.params.token}`;
    if (!fp) return base;
    const basePath = data.baseFolderPath || '';
    // The backend expects the sub-path relative to the share's base folder, so strip
    // the base prefix from the absolute folder path before building the URL.
    if (basePath && fp === basePath) return base;
    if (basePath && fp.startsWith(basePath + '/')) {
      return `${base}/${encodePath(fp.slice(basePath.length + 1))}`;
    }
    return `${base}/${encodePath(fp)}`;
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
        img.src = getPreviewUrl(nextFile.id, false, data.token, 'lightbox');
      }
      if (prevFile && !prevFile.mime_type.startsWith('video/')) {
        const img = new Image();
        img.src = getPreviewUrl(prevFile.id, false, data.token, 'lightbox');
      }
    }
  });

  let scrollProgress = $state(0);
  let headerWrapper: HTMLElement | undefined = $state();
  let pollInterval: ReturnType<typeof setInterval>;
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

  let sitekey = $state('');

  if (typeof window !== 'undefined') {
    (window as any).onTurnstileSuccess = async (token: string) => {
      verifyingTurnstile = true;
      turnstileError = '';
      try {
        const res = await fetch(`${API_BASE}/api/shares/${data.token}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 'cf-turnstile-response': token })
        });
        if (res.ok) {
          invalidateAll();
        } else {
          turnstileError = 'Security verification failed. Please try again.';
          if (turnstileWidgetId && (window as any).turnstile) (window as any).turnstile.reset(turnstileWidgetId);
        }
      } catch (e) {
        turnstileError = 'Network error during verification.';
        if (turnstileWidgetId && (window as any).turnstile) (window as any).turnstile.reset(turnstileWidgetId);
      } finally {
        verifyingTurnstile = false;
      }
    };

    (window as any).onTurnstileLoad = () => {
      if ((window as any).turnstile && widgetContainer && !turnstileWidgetId && sitekey) {
        turnstileWidgetId = (window as any).turnstile.render(widgetContainer, {
          sitekey,
          theme: 'dark',
          action: 'share-gate',
          execution: 'execute',
          appearance: 'execute',
          callback: (window as any).onTurnstileSuccess
        });
        (window as any).turnstile.execute(turnstileWidgetId);
      }
      renderRequestTurnstile();
      renderPasswordTurnstile();
    };
  }

  function isTyping(e: Event): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function cycleShareViewMode() {
    if (isFolderOnly) {
      const modes: FolderViewMode[] = ['small-grid', 'medium-grid', 'large-grid', 'list'];
      const idx = modes.indexOf(folderViewMode);
      selectFolderViewMode(modes[(idx + 1) % modes.length]);
    } else {
      const modes: ViewMode[] = ['small-fit', 'large-fit', 'small-square', 'large-square', 'compact-list'];
      const idx = modes.indexOf(viewMode);
      selectViewMode(modes[(idx + 1) % modes.length]);
    }
    showViewMenu = false;
    showFolderViewMenu = false;
  }

  function cycleShareSortMode() {
    const modes: SortMode[] = ['newest', 'oldest', 'a-z', 'z-a'];
    const idx = modes.indexOf(sortMode);
    selectSortMode(modes[(idx + 1) % modes.length]);
    showSortMenu = false;
  }

  function navigateToParentShare() {
    if (!data.folderPath) return;
    const parts = data.folderPath.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.join('/');
    window.location.href = parent ? `/share/${data.token}/${encodePath(parent)}` : `/share/${data.token}`;
  }

  function handleShareKeydown(e: KeyboardEvent) {
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
      cycleShareViewMode();
      return;
    }

    if ((e.key === 's' || e.key === 'S') && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      cycleShareSortMode();
      return;
    }

    if ((e.key === 'D' || (e.shiftKey && (e.key === 'd' || e.key === 'D'))) && data.share?.allow_download_folder && !personName) {
      e.preventDefault();
      tracker.recordFeature('download_folder');
      startFolderZipDownload(data.share.folder_path, data.share.folder_name);
      return;
    }

    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
      if (data.folderPath) {
        e.preventDefault();
        navigateToParentShare();
        return;
      }
    }
  }

  onMount(() => {
    getTurnstileSitekey().then(k => {
      sitekey = k;
      if ((window as any).turnstile) {
        (window as any).onTurnstileLoad();
      }
    });

    sortMode = loadPref<SortMode>('shareSortMode', (data as any).defaultShareSortMode || 'oldest');
    viewMode = loadPref<ViewMode>('shareViewMode', (data as any).defaultShareViewMode || 'small-fit');
    folderViewMode = loadPref<FolderViewMode>('shareFolderViewMode', (data as any).defaultShareFolderViewMode || 'small-grid');
    stagingViewMode = loadPref<'curated' | 'all'>('shareStagingViewMode', (data.share as any)?.default_staging_view || 'all');
    showFileNames = loadPref<boolean>('showFileNames', false);
    hasSyncedPreferences = true;

    tracker.init({
      shareToken: data.token,
      folderPath: data.folderPath || data.share?.folder_path || '',
      sortMode,
      viewMode
    });

    let pollCount = 0;
    const MAX_POLLS = 10;
    pollInterval = setInterval(() => {
      pollCount++;
      if (pollCount > MAX_POLLS) {
        clearInterval(pollInterval);
        return;
      }
      if (data.error || !data.files) return;
      const stillProcessing = data.files.some((f: any) => !f.blurhash);
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
    window.addEventListener('keydown', handleShareKeydown);

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', updateWidth);
      window.removeEventListener('keydown', handleShareKeydown);
    };
  });

  onDestroy(() => {
    if (turnstileWidgetId && (window as any).turnstile) {
      (window as any).turnstile.remove(turnstileWidgetId);
    }
    if (requestTurnstileWidgetId && (window as any).turnstile) {
      (window as any).turnstile.remove(requestTurnstileWidgetId);
    }
    if (passwordTurnstileWidgetId && (window as any).turnstile) {
      (window as any).turnstile.remove(passwordTurnstileWidgetId);
    }
    if (pollInterval) clearInterval(pollInterval);
    if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
    if (typeof document !== 'undefined') {
      const mainContent = document.querySelector('.main-content');
      if (mainContent) {
        mainContent.removeEventListener('scroll', handleScroll);
      }
    }
  });

  let fallbackCoverId = $derived(
    data.personCoverMediaId ||
    data.folderCoverId || 
    (data.files.length > 0 ? data.files[0].id : null) || 
    (data.directories && data.directories.length > 0 ? (data.directories.find((d: any) => d.cover_id)?.cover_id || null) : null)
  );

  let effectiveCoverBoundingBox = $derived.by(() => {
    if (fallbackCoverId === data.personCoverMediaId) return data.personCoverBoundingBox;
    if (fallbackCoverId === data.folderCoverId) return data.folderCoverBoundingBox;
    const file = data.files.find((f: any) => f.id === fallbackCoverId);
    if (file) return file.bounding_box || null;
    const dir = data.directories?.find((d: any) => d.cover_id === fallbackCoverId);
    if (dir) return dir.cover_bounding_box || null;
    return null;
  });

  let effectiveCoverImgWidth = $derived.by(() => {
    if (fallbackCoverId === data.personCoverMediaId) return data.personCoverImgWidth;
    if (fallbackCoverId === data.folderCoverId) return data.folderCoverImgWidth;
    const file = data.files.find((f: any) => f.id === fallbackCoverId);
    if (file) {
      const w = file.img_width || file.exif_json?.width || file.exif_json?.ImageWidth || file.exif_json?.ExifImageWidth;
      return w ? Number(w) : null;
    }
    const dir = data.directories?.find((d: any) => d.cover_id === fallbackCoverId);
    if (dir) return dir.cover_img_width || null;
    return null;
  });

  let effectiveCoverImgHeight = $derived.by(() => {
    if (fallbackCoverId === data.personCoverMediaId) return data.personCoverImgHeight;
    if (fallbackCoverId === data.folderCoverId) return data.folderCoverImgHeight;
    const file = data.files.find((f: any) => f.id === fallbackCoverId);
    if (file) {
      const h = file.img_height || file.exif_json?.height || file.exif_json?.ImageHeight || file.exif_json?.ExifImageHeight;
      return h ? Number(h) : null;
    }
    const dir = data.directories?.find((d: any) => d.cover_id === fallbackCoverId);
    if (dir) return dir.cover_img_height || null;
    return null;
  });

  let coverObjectPosition = $derived(computeCoverObjectPosition(effectiveCoverBoundingBox, effectiveCoverImgWidth, effectiveCoverImgHeight));

  // Determine single media file if viewing single photo/video share
  let singleSelectedMedia = $derived.by(() => {
    if (data.share?.media_id) {
      return data.files?.find((f: any) => f.id === data.share.media_id) || data.files?.[0] || null;
    }
    if (data.selectedFile) {
      return data.files?.find((f: any) => f.file_name === data.selectedFile) || null;
    }
    return null;
  });

  // Effective preview image media ID
  let metaCoverMediaId = $derived(
    singleSelectedMedia?.id ||
    fallbackCoverId ||
    null
  );

  // Title calculation: Album / Folder / Person name or single photo name
  let metaTitle = $derived.by(() => {
    if (data.turnstileRequired) return 'Security Check';
    if (data.expired) return data.isDisabled ? 'Share Disabled' : 'Share Expired';
    if (data.error) return 'Shared Gallery';
    if (singleSelectedMedia) return singleSelectedMedia.file_name;
    if (personName) return personName;
    const folderName = data.folderPath ? data.folderPath.split('/').pop() : '';
    return folderName ? folderName : 'Shared Album';
  });

  // Subtitle / Description calculation
  let metaDescription = $derived.by(() => {
    return 'hellomyphotos';
  });

  // Canonical absolute preview image URL
  let metaImageUrl = $derived.by(() => {
    let baseUrl = data.origin || (typeof window !== 'undefined' ? window.location.origin : '');
    if (baseUrl.startsWith('http://') && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    
    if (data.share && data.share.folder_path) {
      let ogPath = `/api/shares/${data.token}/og`;
      if (data.folderPath && data.folderPath !== data.baseFolderPath) {
        let diff = data.folderPath.substring(data.baseFolderPath.length);
        if (diff.startsWith('/')) diff = diff.substring(1);
        if (diff.length > 0) {
          ogPath += `?path=${encodeURIComponent(diff)}`;
        }
      }
      return baseUrl ? `${baseUrl}${ogPath}` : ogPath;
    }
    
    if (!metaCoverMediaId) return null;
    const previewPath = getPreviewUrl(metaCoverMediaId, false, data.token);
    if (previewPath.startsWith('http')) return previewPath.replace('http://', 'https://');
    return baseUrl ? `${baseUrl}${previewPath.startsWith('/') ? '' : '/'}${previewPath}` : previewPath;
  });

  let metaPageUrl = $derived.by(() => {
    let baseUrl = data.origin || (typeof window !== 'undefined' ? window.location.origin : '');
    if (baseUrl.startsWith('http://') && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    const currentPath = page.url.pathname;
    return baseUrl ? `${baseUrl}${currentPath}` : currentPath;
  });

  let watermarkVersion = $derived(
    data.share?.watermark_updated_at 
      ? new Date(data.share.watermark_updated_at).getTime()
      : (data.share?.watermark_template_id || (data.share?.watermark_enabled ? '1' : ''))
  );
  let watermarkParam = $derived(watermarkVersion ? `&wv=${watermarkVersion}` : '');
</script>

<svelte:head>
  <title>{metaTitle}</title>
  <meta name="description" content={metaDescription} />

  <!-- Open Graph / WhatsApp / Facebook -->
  <meta property="og:type" content={singleSelectedMedia?.mime_type?.startsWith('video/') ? 'video.other' : 'website'} />
  <meta property="og:site_name" content="hellomyphotos" />
  <meta property="og:title" content={metaTitle} />
  <meta property="og:description" content={metaDescription} />
  {#if metaPageUrl}
    <meta property="og:url" content={metaPageUrl} />
  {/if}
  {#if metaImageUrl}
    <meta property="og:image" content={metaImageUrl} />
    <meta property="og:image:secure_url" content={metaImageUrl} />
    <meta property="og:image:alt" content={metaTitle} />
    <meta property="og:image:type" content={data.share && data.share.folder_path ? "image/png" : "image/webp"} />
    <meta property="og:image:width" content={data.share && data.share.folder_path ? "1080" : "1200"} />
    <meta property="og:image:height" content={data.share && data.share.folder_path ? "1080" : "630"} />
  {/if}

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={metaTitle} />
  <meta name="twitter:description" content={metaDescription} />
  {#if metaImageUrl}
    <meta name="twitter:image" content={metaImageUrl} />
  {/if}

  {#if data.turnstileRequired || data.expired || data.passwordRequired}
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" async defer></script>
  {/if}
</svelte:head>

{#if data.passwordRequired}
  <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; min-height: 100vh; padding: 2rem;">
    <div style="max-width: 520px; width: 100%; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 12px; padding: 32px 24px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); text-align: left;">
      <h2 style="font-size: 2rem; font-weight: 600; margin-bottom: 12px; color: #fff; text-align: left;">
        Password Protected
      </h2>
      <p style="color: #a1a1aa; font-size: 1rem; margin-bottom: 24px; line-height: 1.5; text-align: left;">
        This shared album is protected by a password. Please enter the password below to access and view the photos.
      </p>

      <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: left;">
        <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; margin-bottom: 4px;">Folder Name</div>
        <div style="color: #f4f4f5; font-weight: 500; font-size: 1.1rem;">{data.folderName || 'Shared Album'}</div>
      </div>

      <form onsubmit={handleUnlockShare} style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
        {#if passwordError}
          <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 10px; color: #f87171; font-size: 0.875rem; display: flex; align-items: center; gap: 8px;">
            <AlertCircle size={16} style="flex-shrink: 0;" />
            <span>{passwordError}</span>
          </div>
        {/if}

        <div>
          <label for="sharePasswordInput" style="display: block; font-size: 0.8rem; color: #a1a1aa; margin-bottom: 6px;">
            Password
          </label>
          <div style="position: relative; display: flex; align-items: center;">
            <input
              id="sharePasswordInput"
              type={showPassword ? 'text' : 'password'}
              bind:value={passwordInput}
              placeholder="Enter album password..."
              autofocus
              disabled={unlocking || isLockedOut}
              style="width: 100%; padding: 10px 42px 10px 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); border-radius: 6px; color: white; font-size: 0.95rem; font-family: inherit; outline: none;"
            />
            <button
              type="button"
              class="icon-btn"
              style="position: absolute; right: 10px; background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 4px;"
              onclick={() => showPassword = !showPassword}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {#if showPassword}
                <EyeOff size={18} />
              {:else}
                <Eye size={18} />
              {/if}
            </button>
          </div>
        </div>

        {#if sitekey}
          <div style="display: flex; justify-content: center; min-height: 65px; margin: 4px 0;">
            <div bind:this={passwordWidgetContainer}></div>
          </div>
        {/if}

        <button
          type="submit"
          class="btn"
          disabled={unlocking || isLockedOut || (sitekey ? !passwordTurnstileToken : false) || !passwordInput.trim()}
          style="width: 100%; padding: 12px 20px; font-size: 1rem; background: var(--text-color); color: var(--bg-color); font-weight: 500; border-radius: 6px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 8px;"
        >
          {#if unlocking}
            <Loader2 size={18} class="spin" />
            <span>Unlocking...</span>
          {:else}
            <Lock size={18} />
            <span>Unlock Gallery</span>
          {/if}
        </button>
      </form>
    </div>
  </div>
{:else if data.turnstileRequired}
  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: #fff;">
    <div bind:this={widgetContainer}></div>
    {#if turnstileError}
      <p style="color: #ff5555; margin-top: 1rem;">{turnstileError}</p>
    {/if}
  </div>
{:else if data.expired}
  <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; min-height: 100vh; padding: 2rem;">
    <div style="max-width: 520px; width: 100%; background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); border-radius: 12px; padding: 32px 24px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); text-align: left;">
      <h2 style="font-size: 2rem; font-weight: 600; margin-bottom: 12px; color: #fff; text-align: left;">
        {data.isLockdown ? 'Lockdown Mode Active' : data.isDisabled ? 'Share Link Disabled' : 'The link is expired'}
      </h2>
      <p style="color: #a1a1aa; font-size: 1rem; margin-bottom: 24px; line-height: 1.5; text-align: left;">
        {data.isLockdown
          ? 'All share links are temporarily disabled due to system lockdown mode initiated by the administrator.'
          : data.isDisabled 
          ? 'This share link is temporarily disabled. You can request the administrator to reactivate it.' 
          : 'This share link has reached its expiration date and is no longer accessible.'}
      </p>

      <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border); border-radius: 8px; padding: 16px; margin-bottom: 24px; text-align: left;">
        <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; margin-bottom: 4px;">Folder Name</div>
        <div style="color: #f4f4f5; font-weight: 500; font-size: 1.1rem; margin-bottom: 12px;">{data.folderName || 'Shared Album'}</div>
        <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; margin-bottom: 4px;">Folder Path</div>
        <div style="font-family: monospace; color: #a1a1aa; font-size: 0.875rem; word-break: break-all;">{data.folderPath || '/'}</div>
      </div>

      {#if reqSuccess}
        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 16px; color: #34d399; font-size: 0.95rem;">
          Your access request has been sent.
        </div>
      {:else if showRequestForm}
        <form onsubmit={(e) => { e.preventDefault(); handleSubmitAccessRequest(); }} style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
          {#if reqError}
            <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 10px; color: #f87171; font-size: 0.875rem;">
              {reqError}
            </div>
          {/if}
          <div>
            <label for="req-name" style="display: block; font-size: 0.8rem; color: #a1a1aa; margin-bottom: 6px;">Your Name (Optional)</label>
            <input id="req-name" type="text" bind:value={reqName} placeholder="Jane Doe" style="width: 100%; padding: 10px 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); border-radius: 6px; color: white;" />
          </div>
          <div>
            <label for="req-email" style="display: block; font-size: 0.8rem; color: #a1a1aa; margin-bottom: 6px;">Your Email (Optional)</label>
            <input id="req-email" type="email" bind:value={reqEmail} placeholder="jane@example.com" style="width: 100%; padding: 10px 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); border-radius: 6px; color: white;" />
          </div>
          <div>
            <label for="req-note" style="display: block; font-size: 0.8rem; color: #a1a1aa; margin-bottom: 6px;">Note / Reason (Optional)</label>
            <textarea id="req-note" bind:value={reqNote} placeholder="Please grant me access to these photos..." rows={3} style="width: 100%; padding: 10px 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); border-radius: 6px; color: white; resize: vertical; font-family: inherit;"></textarea>
          </div>
          {#if sitekey}
            <div style="margin: 4px 0;">
              <div bind:this={requestWidgetContainer} style="min-height: 65px;"></div>
            </div>
          {/if}
          <div style="display: flex; gap: 10px; margin-top: 8px;">
            <button type="button" class="btn" onclick={() => showRequestForm = false} style="flex: 1; background: transparent; border: 1px solid var(--glass-border); color: #ccc;">
              Cancel
            </button>
            <button type="submit" class="btn" disabled={reqSubmitting || (sitekey ? !reqTurnstileToken : false)} style="flex: 2; background: var(--text-color); color: var(--bg-color);">
              {reqSubmitting ? 'Sending Request...' : 'Send Request'}
            </button>
          </div>
        </form>
      {:else}
        <button class="btn" onclick={() => showRequestForm = true} style="width: 100%; padding: 12px 20px; font-size: 1rem; background: var(--text-color); color: var(--bg-color); font-weight: 500;">
          Request Access
        </button>
      {/if}
    </div>
  </div>
{:else if data.error}
  <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; min-height: 100vh; padding: 2rem;">
    <h2 style="font-size: 2.5rem; margin-bottom: 16px; color: #fff;">Invalid or expired link</h2>
    <p style="color: #94a3b8; font-size: 1.125rem; margin-bottom: 32px; max-width: 500px;">The folder you are looking for does not exist, has expired, or the link is incorrect.</p>
    <a href="/" class="btn" style="text-decoration: none; font-size: 1.125rem; padding: 12px 24px; display: inline-block;">
      Return to Homepage
    </a>
  </div>
{:else}
<div class="header-wrapper {fallbackCoverId ? 'has-cover' : ''}" bind:this={headerWrapper}>
  {#if !personName && data.folderPath && data.folderPath !== data.baseFolderPath}
    {@const parts = data.folderPath.split('/')}
    {@const parentPath = parts.slice(0, -1).join('/')}
    {@const isParentBase = parentPath === data.baseFolderPath}
    {@const targetUrl = isParentBase ? `/share/${page.params.token}` : `/share/${page.params.token}/${parentPath.substring(data.baseFolderPath.length + 1)}`}
    <a href={targetUrl} 
       style="position: absolute; top: 24px; left: 24px; z-index: 20; color: rgba(255,255,255,0.4); text-decoration: none; display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; transition: color 0.2s, transform 0.2s;"
       onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }}
       onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}
       title="Go to parent folder">
      <ChevronLeft size={32} strokeWidth={2.5} />
    </a>
  {/if}
  {#if fallbackCoverId}
    <CoverImage src={`${getPreviewUrl(fallbackCoverId, false, data.token)}${watermarkParam}`} objectPosition={coverObjectPosition} />
    <div class="header-gradient"></div>
  {/if}
</div>

<div class="sticky-header" style="
  --scroll-prog: {scrollProgress};
  background: linear-gradient(to bottom, rgba(0,0,0,calc(0.9 * {scrollProgress})) 0%, rgba(0,0,0,calc(0.6 * {scrollProgress})) 100%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom-color: rgba(255,255,255,calc(0.05 * {scrollProgress}));
">
  <div class="header-content" class:frozen-mobile={scrollProgress === 1}>
    <div class="header-left">
      <div style="display: flex; flex-direction: row; align-items: center;">
      <div class="header-text-container" style="--scroll-prog: {scrollProgress};">
        {#key personName || data.folderPath}
          {#if personName}
            <div class="subheading">Person</div>
            <h2>{personName}</h2>
          {:else}
            {#if data.folderPath && data.folderPath.includes('/')}
              <div class="subheading breadcrumbs">
                {#each data.folderPath.split('/').slice(0, -1) as part, index}
                  {@const currentPath = data.folderPath.split('/').slice(0, index + 1).join('/')}
                  {#if index > 0}<span class="separator"> &gt; </span>{/if}
                  {#if currentPath === data.baseFolderPath}
                    <a href="/share/{page.params.token}">{part}</a>
                  {:else if currentPath.startsWith(data.baseFolderPath + '/')}
                    <a href="/share/{page.params.token}/{currentPath.substring(data.baseFolderPath.length + 1)}">{part}</a>
                  {:else}
                    <span class="breadcrumb unclickable" style="color: #888; cursor: default;">{part}</span>
                  {/if}
                {/each}
              </div>
            {/if}
            <h2>{data.folderPath ? data.folderPath.split('/').pop() : 'Home'}</h2>
            {#if data.folderDescription}
              <p class="folder-desc">{data.folderDescription}</p>
            {/if}
          {/if}
        {/key}
      </div>
      </div>
    </div>
    
    <div class="header-right">
      <div class="toolbar">
        {#if !personName && data.folderPath && data.folderPath !== data.baseFolderPath}
          {@const parts = data.folderPath.split('/')}
          {@const parentPath = parts.slice(0, -1).join('/')}
          {@const isParentBase = parentPath === data.baseFolderPath}
          {@const targetUrl = isParentBase ? `/share/${page.params.token}` : `/share/${page.params.token}/${parentPath.substring(data.baseFolderPath.length + 1)}`}
          <a href={targetUrl} 
             class="icon-btn mobile-only-back" 
             style="opacity: {scrollProgress === 1 ? 1 : 0}; width: {scrollProgress === 1 ? '30px' : '0'}; padding: {scrollProgress === 1 ? '4px' : '0'}; margin-right: {scrollProgress === 1 ? '0' : '-8px'}; overflow: hidden; transition: width 0.2s, opacity 0.2s, margin 0.2s, padding 0.2s; pointer-events: {scrollProgress === 1 ? 'auto' : 'none'}; display: flex; align-items: center; justify-content: center; box-sizing: border-box;" 
             title="Go to parent folder (Backspace)">
            <ChevronLeft size={20} />
          </a>
        {/if}
        {#if isStagedFolder}
          <button class="icon-btn" onclick={handleRefreshPhotos} disabled={isRefreshingPhotos} title="Refresh live sync photos">
            <RefreshCw size={18} class={isRefreshingPhotos ? 'spinning' : ''} />
          </button>
        {/if}
        <button class="icon-btn" class:active={isSearchOpen} onclick={toggleSearch} title="Search (/ or ⌘K)">
          <Search size={18} />
        </button>
        <div class="dropdown-container" use:clickOutside={() => showSortMenu = false}>
          <button class="icon-btn" onclick={() => { showSortMenu = !showSortMenu; showViewMenu = false; }} title="Sort (S)">
            <ArrowDownUp size={18} />
          </button>
          {#if showSortMenu}
            <div class="dropdown-menu">
              <button class:active={sortMode === 'newest'} onclick={() => selectSortMode('newest')}>Newest to Oldest</button>
              <button class:active={sortMode === 'oldest'} onclick={() => selectSortMode('oldest')}>Oldest to Newest</button>
              <button class:active={sortMode === 'a-z'} onclick={() => selectSortMode('a-z')}>A to Z</button>
              <button class:active={sortMode === 'z-a'} onclick={() => selectSortMode('z-a')}>Z to A</button>
            </div>
          {/if}
        </div>
        
        {#if (data.share as any)?.allow_view_mode_toggle !== false && displayedFiles.length > 0}
          <button 
            type="button" 
            class="icon-btn curation-icon-btn" 
            class:active={stagingViewMode === 'curated'} 
            onclick={() => stagingViewMode = stagingViewMode === 'curated' ? 'all' : 'curated'} 
            title={stagingViewMode === 'curated' ? 'Curated view: showing best picks (click for all)' : 'Curate: show best picks only'}
            aria-label="Toggle curated view"
          >
            <Layers size={18} />
          </button>
        {/if}

        {#if canFilterFavorites && displayedFiles.length > 0}
          <button 
            type="button" 
            class="icon-btn favorites-icon-btn" 
            class:active={showOnlyFavorites} 
            onclick={() => showOnlyFavorites = !showOnlyFavorites} 
            title={showOnlyFavorites ? 'Favorites view: showing favorited photos only (click for all)' : 'Favorites: show favorites only'}
            aria-label="Toggle favorites only"
          >
            <Heart size={18} fill={showOnlyFavorites ? '#ef4444' : 'none'} color={showOnlyFavorites ? '#ef4444' : 'currentColor'} />
          </button>
        {/if}

        {#if isFolderOnly}
          <div class="dropdown-container" use:clickOutside={() => showFolderViewMenu = false}>
            <button class="icon-btn" onclick={() => { showFolderViewMenu = !showFolderViewMenu; showSortMenu = false; showViewMenu = false; }} title="View (V)">
              {#if folderViewMode === 'list'}
                <List size={18} />
              {:else}
                <LayoutGrid size={18} />
              {/if}
            </button>
            {#if showFolderViewMenu}
              <div class="dropdown-menu">
                <button class:active={folderViewMode === 'small-grid'} onclick={() => selectFolderViewMode('small-grid')}>Small Grid</button>
                <button class:active={folderViewMode === 'medium-grid'} onclick={() => selectFolderViewMode('medium-grid')}>Medium Grid</button>
                <button class:active={folderViewMode === 'large-grid'} onclick={() => selectFolderViewMode('large-grid')}>Large Grid</button>
                <button class:active={folderViewMode === 'list'} onclick={() => selectFolderViewMode('list')}>List</button>
                <div class="dropdown-divider"></div>
                <button class="toggle-item" class:active={showFileNames} onclick={toggleFileNames}>
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
            <button class="icon-btn" onclick={() => { showViewMenu = !showViewMenu; showSortMenu = false; showFolderViewMenu = false; }} title="View (V)">
              {#if viewMode === 'compact-list'}
                <List size={18} />
              {:else}
                <LayoutGrid size={18} />
              {/if}
            </button>
            {#if showViewMenu}
              <div class="dropdown-menu">
                <button class:active={viewMode === 'small-fit'} onclick={() => selectViewMode('small-fit')}>Small Fit Size</button>
                <button class:active={viewMode === 'large-fit'} onclick={() => selectViewMode('large-fit')}>Large Fit Size</button>
                <button class:active={viewMode === 'small-square'} onclick={() => selectViewMode('small-square')}>Small Square Grid</button>
                <button class:active={viewMode === 'large-square'} onclick={() => selectViewMode('large-square')}>Large Square Grid</button>
                <button class:active={viewMode === 'compact-list'} onclick={() => selectViewMode('compact-list')}>Compact List</button>
                <div class="dropdown-divider"></div>
                <button class="toggle-item" class:active={showFileNames} onclick={toggleFileNames}>
                  <span>Show File Names</span>
                  {#if showFileNames}
                    <Check size={16} />
                  {/if}
                </button>
              </div>
            {/if}
          </div>
        {/if}
        
        {#if !personName && data.share.allow_download_folder}
          <button class="icon-btn" title="Download ZIP (Shift+D)" onclick={() => { tracker.recordFeature('download_folder'); startFolderZipDownload(data.share.folder_path, data.share.folder_name); }}>
            <Download size={18} />
          </button>
        {/if}

        {#if (data.share as any)?.has_password || (data.share as any)?.password_hash}
          <a
            href="/api/shares/{data.token || (data.share as any)?.share_token}/exit"
            data-sveltekit-reload
            class="icon-btn"
            title="Lock & Exit Album"
            aria-label="Lock and exit album"
            onclick={handleExitShare}
          >
            <LogOut size={18} />
          </a>
        {/if}

        
      </div>
      
      <span class="count" style="display: flex; flex-wrap: wrap; justify-content: flex-end; column-gap: 4px;">
        {#if isSearching && isSearchLoading}
          <span style="white-space: nowrap; color: #a1a1aa;">Searching...</span>
        {:else if !personName && displayedDirectories.length > 0}
          <span style="white-space: nowrap;">{displayedDirectories.length} {displayedDirectories.length === 1 ? 'folder' : 'folders'}</span>
          {#if displayedFiles.length > 0}
            <span style="white-space: nowrap;">& {displayedFiles.length} {displayedFiles.length === 1 ? 'item' : 'items'}</span>
          {/if}
        {:else}
          <span style="white-space: nowrap;">{displayedFiles.length} {displayedFiles.length === 1 ? 'item' : 'items'}</span>
        {/if}
        {#if expiryText}
          <span style="white-space: nowrap;">• Share expires in {expiryText}</span>
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
          placeholder={personName ? `Search in ${personName}'s photos...` : (data.folderPath ? `Search in ${data.folderPath.split('/').pop()} and subfolders...` : "Search all photos and folders...")}
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
      onclick={handleRefreshPhotos}
      disabled={isRefreshingPhotos}
      title="Refresh photos from live sync"
    >
      <RefreshCw size={15} class={isRefreshingPhotos ? 'spinning' : ''} />
      <span>Refresh</span>
    </button>
  </div>
{/if}

{#key data.folderPath}
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
      <a href={getShareDirHref(dir)} class="dir-card" style="animation-delay: {i * 40}ms">
        <div class="dir-cover">
          {#if dir.cover_id}
            <BlurhashImage 
              hash={dir.blurhash || ''} 
              src={`${getThumbnailUrl(dir.cover_id, data.token)}${dir.blurhash ? (getThumbnailUrl(dir.cover_id, data.token).includes('?') ? '&' : '?') + 'cb=' + encodeURIComponent(dir.blurhash) : ''}${watermarkParam}`} 
              alt={dir.name}
              objectFit="cover"
              square={true}
            />
          {:else}
            <div class="dir-placeholder"></div>
          {/if}
        </div>
        <div class="dir-info" style="position: relative; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; flex: 1; overflow: hidden;">
          <span class="dir-name" style="width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{dir.name}</span>
          {#if dir.relative_path && dir.relative_path !== dir.name}
            <span class="dir-path" style="font-size: 0.75rem; color: #888; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;" title={dir.relative_path}>{dir.relative_path}</span>
          {/if}
        </div>
      </a>
    {/each}
  </div>
{/if}
{/key}

{#if !isSearching && (!data.directories || data.directories.length === 0) && (!data.files || data.files.length === 0)}
  <div class="empty-state">
    <h3 style="color: var(--text-color); margin-bottom: 8px;">This folder is empty</h3>
    <p style="color: #a1a1aa; max-width: 400px; margin: 0 auto;">There are no files or subfolders shared here yet.</p>
  </div>
{/if}

{#key data.folderPath}
{#if viewMode === 'compact-list' && (sortedFiles.length > 0 || isSearching)}
  <div class="compact-media-list">
    <div class="compact-list-header">
      <button 
        type="button" 
        class="compact-th col-name" 
        onclick={() => selectSortMode(sortMode === 'a-z' ? 'z-a' : 'a-z')}
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
        onclick={() => selectSortMode(sortMode === 'newest' ? 'oldest' : 'newest')}
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
      {#if data.share.allow_download_images}
        <div class="compact-th col-actions"></div>
      {/if}
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
        {#each sortedFiles as file, i (file.id)}
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
          {#if data.share.allow_download_images || canFavorite}
            <div class="col-actions" onclick={(e) => e.stopPropagation()}>
              {#if canFavorite}
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
              {/if}
              {#if data.share.allow_download_images}
                <a 
                  href={`${getStreamUrl(file.id, data.token)}${getStreamUrl(file.id, data.token).includes('?') ? '&' : '?'}download=1`} 
                  download={file.file_name} 
                  class="compact-action-btn" 
                  title="Download"
                  aria-label="Download"
                >
                  <Download size={15} />
                </a>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
      {/if}
    </div>
  </div>
{:else}
  <div class="grid {viewMode}">
    {#each sortedFiles as file, i}
      <BlurhashImage 
        hash={file.blurhash || ''} 
        src={`${getThumbnailUrl(file.id, data.token)}${file.blurhash ? (getThumbnailUrl(file.id, data.token).includes('?') ? '&' : '?') + 'cb=' + encodeURIComponent(file.blurhash) : ''}${watermarkParam}`} 
        alt={file.file_name} 
        fileName={isSearching && file.relative_path ? file.relative_path : file.file_name}
        showFileName={showFileNames || isSearching}
        isVideo={file.mime_type.startsWith('video/')}
        onclick={() => openLightbox(i)}
        objectFit={viewMode.includes('square') ? 'cover' : 'contain'}
        square={viewMode.includes('square')}
        initialAspectRatio={getAspectRatio(file)}
        targetHeight={viewMode.includes('small') ? (windowWidth <= 768 ? 100 : 150) : viewMode.includes('large') ? (windowWidth <= 768 ? 200 : 350) : 250}
        priority={i < 8}
        burstCount={stagingViewMode === 'curated' ? file.burst_count : undefined}
        isFavorite={file.is_favorite ?? false}
        canFavorite={canFavorite}
        ontogglefavorite={() => handleToggleThumbnailFavorite(file)}
      />
    {/each}
  </div>
{/if}
{/key}

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

{#if selectedMediaIndex !== null && sortedFiles[selectedMediaIndex]}
  <Lightbox 
    folderCoverId={data.folderCoverId} 
    media={sortedFiles[selectedMediaIndex]} 
    allowDownload={data.share.allow_download_images} 
    isSharedView={true} 
    token={page.params.token} 
    watermarkVersion={watermarkVersion} 
    baseFolderPath={data.baseFolderPath} 
    showHiddenAlternates={(data.share as any)?.show_hidden_alternates ?? true}
    allowHeroSelection={(data.share as any)?.allow_hero_selection ?? false}
    canFavorite={canFavorite}
    onfavoriteupdated={handleFavoriteUpdated}
    onheroupdated={handleHeroUpdated}
    onclose={closeLightbox} 
    onnext={nextMedia} 
    onprev={prevMedia} 
  />
{/if}

<ZipDownloadModal 
  bind:show={showZipProgressModal} 
  folderPath={zipTargetFolderPath} 
  folderName={zipTargetFolderName} 
  shareToken={data.token} 
  autoStart={true}
/>
{/if}

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
    background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.3) 65%, rgba(0,0,0,0.95) 100%);
    pointer-events: none;
    z-index: 1;
  }
  
  .sticky-header {
    position: sticky;
    top: -25px; /* Offset main-content padding */
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
  .header-left .folder-desc {
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
    border-radius: 6px;
    flex-shrink: 0;
  }

  .dir-grid.list-view .dir-info {
    padding: 0;
    padding-right: 8px;
  }

  .dir-grid.list-view .dir-name {
    font-size: 1rem;
    margin: 0;
  }

  .dir-grid.folder-mode-small-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  }
  .dir-grid.folder-mode-medium-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }
  .dir-grid.folder-mode-large-grid {
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }
  .dir-grid.folder-mode-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dir-grid.folder-mode-list .dir-card {
    flex-direction: row;
    align-items: center;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 8px;
    gap: 12px;
    border: 1px solid var(--glass-border);
  }
  .dir-grid.folder-mode-list .dir-cover {
    width: 48px;
    height: 48px;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .dir-grid.folder-mode-list .dir-info {
    padding: 0;
    padding-right: 8px;
  }
  .dir-grid.folder-mode-list .dir-name {
    font-size: 1rem;
    margin: 0;
  }

  .dir-card {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: var(--text-color);
    background: transparent;
    overflow: hidden;
    transition: filter 0.2s ease;
    animation: fadeIn 0.35s ease both;
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
    overflow: hidden;
    background: #111;
  }

  .dir-placeholder {
    width: 100%;
    height: 100%;
    background: #111;
  }

  .dir-info {
    padding: 12px 0;
  }

  .dir-name {
    font-family: 'Cabinet Grotesk', sans-serif;
    font-weight: 700;
    font-size: 1.125rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      flex-wrap: nowrap;
    }
    .count {
      text-align: right;
      white-space: nowrap;
      margin-left: auto;
      font-size: 0.8rem;
      padding-left: 6px;
      flex-shrink: 0;
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
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 1;
      min-width: 0;
      flex-wrap: nowrap;
    }
    .toolbar .icon-btn {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      flex-shrink: 0;
    }
    .toolbar .icon-btn :global(svg) {
      width: 15px;
      height: 15px;
    }
    .toolbar .dropdown-menu {
      top: 34px;
      right: auto;
      left: 0;
    }
    .staging-disclaimer-banner {
      margin: 0 0 24px 0;
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

  /* Live FastUp Staging Disclaimer Banner */
  .staging-disclaimer-banner {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 0 0 20px 0;
    padding: 14px 18px;
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.1) 0%, rgba(59, 130, 246, 0.06) 100%);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 12px;
    backdrop-filter: blur(12px);
  }
  .disclaimer-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    background: rgba(168, 85, 247, 0.15);
    border-radius: 8px;
    flex-shrink: 0;
  }
  .disclaimer-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .disclaimer-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #f3e8ff;
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
    padding: 7px 14px;
    margin-left: auto;
    background: rgba(168, 85, 247, 0.2);
    border: 1px solid rgba(168, 85, 247, 0.45);
    border-radius: 8px;
    color: #f3e8ff;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    align-self: center;
    transition: all 0.2s ease;
  }
  .disclaimer-refresh-btn:hover {
    background: rgba(168, 85, 247, 0.35);
    border-color: rgba(168, 85, 247, 0.7);
    color: white;
  }
  .disclaimer-refresh-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  @media (max-width: 640px) {
    .staging-disclaimer-banner {
      flex-wrap: wrap;
    }
    .disclaimer-refresh-btn {
      margin-left: 0;
      margin-top: 8px;
      width: 100%;
      justify-content: center;
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
