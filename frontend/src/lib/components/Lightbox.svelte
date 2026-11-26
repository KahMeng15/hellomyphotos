<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import type { MediaFile } from '$lib/api/media';
  import { getPreviewUrl, getStreamUrl, getThumbnailUrl, fetchMediaFaces, repairMedia, getMediaQueueStatus, fetchAlternates, setHeroPhoto, togglePhotoVisibility, toggleFavorite, API_BASE } from '$lib/api/media';
  import { createShare } from '$lib/api/shares';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import BlurhashImage from './BlurhashImage.svelte';
  import Modal from './Modal.svelte';
  import { toast } from '$lib/stores/toast';
  import { Download, Share2, Info, MoreHorizontal, X, ChevronLeft, ChevronRight, Check, ZoomIn, ZoomOut, Clock, Layers, Eye, EyeOff, Cloud, ExternalLink, Copy, QrCode, Heart } from '@lucide/svelte';
  import { clickOutside } from '$lib/actions/clickOutside';
  import { formatDate, getRawDate } from '$lib/utils/date';
  import { tracker } from '$lib/utils/analyticsTracker';
  import { getMediaGDriveLink } from '$lib/api/gdrive';
  import { currentUser } from '$lib/stores/auth';
  import QRCode from 'qrcode';

  let { 
    media, 
    allowDownload = true, 
    isSharedView = false, 
    token,
    watermarkVersion,
    baseFolderPath, folderCoverId,
    showHiddenAlternates = true,
    allowHeroSelection = false,
    canFavorite = true,
    onclose,
    onnext,
    onprev,
    onsetcover,
    onheroupdated,
    onfavoriteupdated
  }: { 
    media: MediaFile, 
    allowDownload?: boolean, 
    isSharedView?: boolean, 
    token?: string,
    watermarkVersion?: string | number,
    baseFolderPath?: string,
    folderCoverId?: string | null,
    showHiddenAlternates?: boolean,
    allowHeroSelection?: boolean,
    canFavorite?: boolean,
    onclose?: () => void,
    onnext?: () => void,
    onprev?: () => void,
    onsetcover?: (id: string) => void,
    onheroupdated?: (heroId: string, isVisible?: boolean) => void,
    onfavoriteupdated?: (id: string, isFavorite: boolean) => void
  } = $props();

  let activeMedia = $state(media);
  $effect(() => {
    activeMedia = media;
  });

  let alternates = $state<MediaFile[]>([]);
  let loadingAlternates = $state(false);
  let showAlternatesSidebar = $state(false);
  let isBurstStackMode = $state(false);

  $effect(() => {
    const targetId = media.id;
    if (showHiddenAlternates && (media.burst_group_id || (media.burst_count && media.burst_count > 1))) {
      loadingAlternates = true;
      fetchAlternates(targetId, token)
        .then((res) => {
          alternates = res;
        })
        .catch(() => {
          alternates = [];
        })
        .finally(() => {
          loadingAlternates = false;
        });
    } else {
      alternates = [];
      showAlternatesSidebar = false;
      isBurstStackMode = false;
    }
  });

  function openBurstSidebar() {
    showInfo = false;
    showAlternatesSidebar = true;
    isBurstStackMode = true;
  }

  function closeBurstSidebar() {
    showAlternatesSidebar = false;
    isBurstStackMode = false;
  }

  function toggleBurstSidebar() {
    if (showAlternatesSidebar) {
      closeBurstSidebar();
    } else {
      openBurstSidebar();
    }
  }

  async function handlePromoteHero(id: string) {
    try {
      await setHeroPhoto(id, token);
      alternates = alternates.map(a => ({
        ...a,
        is_hero: a.id === id
      }));
      if (activeMedia.id === id) {
        activeMedia = { ...activeMedia, is_hero: true };
      }
      toast.success('Set as primary hero photo');
      onheroupdated?.(id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to set hero photo');
    }
  }

  async function handleToggleVisibility(id: string, currentIsHero: boolean) {
    const targetState = !currentIsHero;
    try {
      const res = await togglePhotoVisibility(id, targetState, token);
      const newStatus = res.is_hero;
      alternates = alternates.map(a => a.id === id ? { ...a, is_hero: newStatus } : a);
      if (activeMedia.id === id) {
        activeMedia = { ...activeMedia, is_hero: newStatus };
      }
      toast.success(newStatus ? 'Photo shown in curated view' : 'Photo hidden from curated view');
      onheroupdated?.(id, newStatus);
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle photo visibility');
    }
  }

  function switchActiveMedia(alt: MediaFile) {
    activeMedia = alt;
  }

  let isTogglingFavorite = $state(false);
  async function handleToggleFavorite() {
    if (isTogglingFavorite || !canFavorite) return;
    isTogglingFavorite = true;
    const targetState = !activeMedia.is_favorite;
    try {
      const res = await toggleFavorite(activeMedia.id, targetState, token);
      const newFav = res.is_favorite;
      activeMedia = { ...activeMedia, is_favorite: newFav };
      alternates = alternates.map(a => a.id === activeMedia.id ? { ...a, is_favorite: newFav } : a);
      toast.success(newFav ? 'Added to favorites' : 'Removed from favorites');
      onfavoriteupdated?.(activeMedia.id, newFav);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update favorite status');
    } finally {
      isTogglingFavorite = false;
    }
  }

  const rawDate = $derived(getRawDate(media));
  const mediaW = $derived(media.img_width || media.exif_json?.ExifImageWidth || media.exif_json?.ImageWidth || media.exif_json?.width || 0);
  const mediaH = $derived(media.img_height || media.exif_json?.ExifImageHeight || media.exif_json?.ImageHeight || media.exif_json?.height || 0);
  const mediaMP = $derived(mediaW && mediaH ? Math.round((mediaW * mediaH) / 1000000) : 0);

  const exifIso = $derived(media.exif_json?.iso || media.exif_json?.ISO || media.exif_json?.Iso);
  const exifMake = $derived(media.exif_json?.make || media.exif_json?.Make);
  const exifModel = $derived(media.exif_json?.model || media.exif_json?.Model);
  const exifLens = $derived(media.exif_json?.lensModel || media.exif_json?.LensModel);
  const exifFocal = $derived(media.exif_json?.focalLength || media.exif_json?.FocalLength);
  const exifAperture = $derived(media.exif_json?.fNumber || media.exif_json?.FNumber || media.exif_json?.aperture || media.exif_json?.ApertureValue);
  const exifShutter = $derived(media.exif_json?.exposureTime || media.exif_json?.ExposureTime);


  const pathSegments = $derived(media.folder_path ? media.folder_path.split('/').filter(Boolean) : []);

  function pathUrl(segments: string[]): string {
    if (isSharedView && token) {
      const fullPath = segments.join('/');
      if (baseFolderPath && fullPath.startsWith(baseFolderPath)) {
        const rest = fullPath.substring(baseFolderPath.length).replace(/^\//, '');
        return `/share/${token}${rest ? '/' + rest : ''}`;
      }
      return '';
    }
    return `/folder/${segments.join('/')}`;
  }
  
  function close() {
    stopHold();
    tracker.endPhotoDwell();
    if (onclose) onclose();
  }

  let showInfo = $state(false);
  let showAdvanced = $state(false);
  let showLightboxNoticeDetails = $state(false);
  let rawExif = $state<any>(null);
  let loadingExif = $state(false);

  $effect(() => {
    if (media.id) {
      tracker.startPhotoDwell(media.id);
      rawExif = null;
      showAdvanced = false;
      showLightboxNoticeDetails = false;
    }
    return () => {
      tracker.endPhotoDwell();
    };
  });

  async function loadAdvancedExif() {
    if (rawExif) return;
    loadingExif = true;
    try {
      const qs = (isSharedView && token) ? `?shareToken=${token}` : "";
      const res = await fetch(`${API_BASE}/api/media/${media.id}/exif${qs}`);
      if (res.ok) {
        rawExif = await res.json();
      }
    } catch (e) {
      console.error(e);
    } finally {
      loadingExif = false;
    }
  }

  let showMenu = $state(false);

  // --- Idle management ---

  let isIdle = $state(false);
  let lastActivity = Date.now();

  function onActivity() {
    lastActivity = Date.now();
    isIdle = false;
  }

  let lastNavTime = 0;
  const NAV_THROTTLE_MS = 100;

  function handleNext() {
    onActivity();
    const now = Date.now();
    if (now - lastNavTime < NAV_THROTTLE_MS) return;
    lastNavTime = now;
    if (isBurstStackMode && alternates.length > 1) {
      const curIndex = alternates.findIndex(a => a.id === activeMedia.id);
      const nextIndex = curIndex >= 0 ? (curIndex + 1) % alternates.length : 0;
      switchActiveMedia(alternates[nextIndex]);
      return;
    }
    if (onnext) onnext();
  }

  function handlePrev() {
    onActivity();
    const now = Date.now();
    if (now - lastNavTime < NAV_THROTTLE_MS) return;
    lastNavTime = now;
    if (isBurstStackMode && alternates.length > 1) {
      const curIndex = alternates.findIndex(a => a.id === activeMedia.id);
      const prevIndex = curIndex >= 0 ? (curIndex - 1 + alternates.length) % alternates.length : alternates.length - 1;
      switchActiveMedia(alternates[prevIndex]);
      return;
    }
    if (onprev) onprev();
  }

  let holdTimeout: ReturnType<typeof setTimeout> | null = null;
  let holdInterval: ReturnType<typeof setInterval> | null = null;

  function startHold(action: () => void) {
    stopHold();
    action();
    holdTimeout = setTimeout(() => {
      holdInterval = setInterval(() => {
        action();
      }, 150);
    }, 350);
  }

  function stopHold() {
    if (holdTimeout) {
      clearTimeout(holdTimeout);
      holdTimeout = null;
    }
    if (holdInterval) {
      clearInterval(holdInterval);
      holdInterval = null;
    }
  }

  function isTyping(e: Event): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function setZoom(target: number) {
    const clamped = Math.min(5, Math.max(1, target));
    currentZoom = clamped;
    if (pzInstance) {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      pzInstance.zoomAbs(centerX, centerY, clamped);
      if (clamped === 1) {
        pzInstance.moveTo(0, 0);
      }
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    onActivity();
    if (e.key === 'Escape') {
      if (showAlternatesSidebar) {
        closeBurstSidebar();
        return;
      }
      close();
      return;
    }

    if (isTyping(e)) return;

    if (e.key === 'ArrowRight') {
      if (e.repeat) {
        const now = Date.now();
        if (now - lastNavTime < 150) return;
      }
      handleNext();
      return;
    } else if (e.key === 'ArrowLeft') {
      if (e.repeat) {
        const now = Date.now();
        if (now - lastNavTime < 150) return;
      }
      handlePrev();
      return;
    }

    // Download: 'd' or 'D'
    if ((e.key === 'd' || e.key === 'D') && allowDownload && downloadUrl) {
      e.preventDefault();
      download();
      return;
    }

    // Share: 's' or 'S'
    if ((e.key === 's' || e.key === 'S') && !isSharedView) {
      e.preventDefault();
      showShareMenu = !showShareMenu;
      showGDriveMenu = false;
      showMenu = false;
      return;
    }

    // Info panel toggle: 'i' or 'I'
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      toggleInfo();
      return;
    }

    // Favorite: 'f' or 'F'
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (canFavorite) {
        handleToggleFavorite();
      }
      return;
    }

    // Cover image: 'c' or 'C'
    if ((e.key === 'c' || e.key === 'C') && !isSharedView && onsetcover) {
      e.preventDefault();
      makeCoverImage();
      return;
    }

    // Zoom shortcuts: '+' / '-' / '0' / 'z'
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setZoom(currentZoom + 0.5);
      return;
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setZoom(currentZoom - 0.5);
      return;
    }
    if (e.key === '0') {
      e.preventDefault();
      setZoom(1);
      return;
    }
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      if (currentZoom > 1.05) setZoom(1);
      else setZoom(2.5);
      return;
    }

    // Video play/pause
    if (e.key === ' ' || e.code === 'Space') {
      const videoEl = document.querySelector('.lightbox video') as HTMLVideoElement | null;
      if (videoEl) {
        e.preventDefault();
        if (videoEl.paused) videoEl.play();
        else videoEl.pause();
        return;
      }
    }
  }
  
  // --- Swipe management ---
  
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;

  function handleTouchStart(e: TouchEvent) {
    onActivity();
    if (currentZoom > 1.05) return;
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
  }

  function handleTouchEnd(e: TouchEvent) {
    onActivity();
    if (currentZoom > 1.05) return;
    touchEndX = e.changedTouches[0].clientX;
    touchEndY = e.changedTouches[0].clientY;
    handleSwipe();
  }

  function handleSwipe() {
    const swipeThreshold = 50; // minimum distance in pixels
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    // Determine if it's mostly horizontal or vertical
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      // Horizontal swipe
      if (deltaX > swipeThreshold) {
        handlePrev();
      } else if (deltaX < -swipeThreshold) {
        handleNext();
      }
    } else {
      // Vertical swipe
      // Swipe up means negative deltaY
      if (deltaY < -swipeThreshold) {
        close();
      }
    }
  }

  // --- Info / faces ---

  let faces: {person_id: string, bounding_box: any, name?: string}[] = $state([]);
  let loadingFaces = $state(false);

  function toggleInfo() {
    showInfo = !showInfo;
    if (showInfo) {
      showAlternatesSidebar = false;
      tracker.recordFeature('information');
    }
  }

  $effect(() => {
    if (!isSharedView && showInfo && media.id) {
      loadingFaces = true;
      fetchMediaFaces(media.id).then(res => {
        faces = res;
        loadingFaces = false;
      }).catch(err => {
        console.error(err);
        loadingFaces = false;
      });
    }
  });

  let queueStatus = $state<{ status: string, position?: number } | null>(null);

  async function checkQueue() {
    if (!media?.id || media.is_transcoded) return;
    try {
      const status = await getMediaQueueStatus(media.id, token);
      queueStatus = status;
      if (status.status === 'completed') {
        media.is_transcoded = true; // Triggers UI re-render
      }
    } catch (err) {
      console.error('Queue check failed:', err);
    }
  }

  $effect(() => {
    let interval: any;
    if (media?.mime_type.startsWith('video/') && media.is_transcoded === false) {
      checkQueue();
      interval = setInterval(checkQueue, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  });

  let isRepairing = $state(false);

  async function handleVideoError(e: Event) {
    const video = e.target as HTMLVideoElement;
    if (video.error && (video.error.code === 3 || video.error.code === 4)) {
      if (isRepairing) return;
      isRepairing = true;
      try {
        toast.info('Video playback error detected. Checking for corruption...');
        const res = await repairMedia(media.id, token);
        if (res.message === 'Repair initiated') {
          toast.success('Corrupted video detected! It has been queued for reprocessing.');
          media.is_transcoded = false;
        } else {
          toast.warning(res.message || 'Video check completed.');
        }
      } catch (err) {
        console.error('Repair failed:', err);
      } finally {
        isRepairing = false;
      }
    }
  }

  // --- Zoom logic ---
  let scale = $state(1);
  let isZoomed = $derived(scale > 1);

  let panzoomModulePromise: Promise<any> | null = null;
  function getPanzoom() {
    if (!panzoomModulePromise) {
      panzoomModulePromise = import('panzoom').then(m => m.default || m);
    }
    return panzoomModulePromise;
  }

  let pzInstance: any = null;
  let currentZoom = $state(1);
  let showZoomSlider = $state(false);

  function initPanzoom(node: HTMLElement) {
    if (media.mime_type.startsWith('video/')) return;
    
    let isDestroyed = false;
    let localPz: any = null;

    getPanzoom().then((panzoom) => {
      if (isDestroyed || !node.isConnected) return;

      localPz = panzoom(node, {
        maxZoom: 5,
        minZoom: 1,
        bounds: false,
        smoothScroll: false,
      });
      pzInstance = localPz;

      localPz.on('transform', () => {
        if (isDestroyed || !localPz) return;
        const transform = localPz.getTransform();
        currentZoom = transform.scale;
        if (currentZoom > 1.05) {
          showZoomSlider = true;
        } else {
          showZoomSlider = false;
        }
      });
    }).catch(err => {
      console.error('Panzoom init error:', err);
    });

    return {
      destroy() {
        isDestroyed = true;
        if (localPz) {
          localPz.dispose();
          localPz = null;
        }
        if (pzInstance === localPz) {
          pzInstance = null;
        }
      }
    };
  }

  function toggleZoomIcon() {
    tracker.recordFeature('zoom');
    if (pzInstance) {
      const el = document.querySelector('.media-element') as HTMLElement;
      if (el) {
        el.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        setTimeout(() => {
          if (el) el.style.transition = 'none';
        }, 300);
      }

      if (showZoomSlider || currentZoom > 1.05) {
        pzInstance.zoomAbs(window.innerWidth / 2, window.innerHeight / 2, 1);
        pzInstance.moveTo(0, 0);
        showZoomSlider = false;
      } else {
        pzInstance.zoomAbs(window.innerWidth / 2, window.innerHeight / 2, 2);
        showZoomSlider = true;
      }
    }
  }

  function handleZoomSlider(e: Event) {
    tracker.recordFeature('zoom');
    const targetZoom = parseFloat((e.target as HTMLInputElement).value);
    if (pzInstance) {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      pzInstance.zoomAbs(centerX, centerY, targetZoom);
      if (targetZoom === 1) {
        pzInstance.moveTo(0, 0);
      }
    }
  }

  // --- Download, share, cover ---

  const downloadUrl = $derived.by(() => {
    if (!media?.id) return '';
    const base = getStreamUrl(media.id, token);
    const separator = base.includes('?') ? '&' : '?';
    return base + separator + 'download=1';
  });

  function download() {
    if (downloadUrl) {
      window.location.href = downloadUrl;
    }
  }

  let isSharing = $state(false);
  let justShared = $state(false);
  let showShareMenu = $state(false);
  let sharedUrl = $state<string | null>(null);

  // Common QR Code Modal State
  let showQrModal = $state(false);
  let qrModalTitle = $state('QR Code');
  let qrModalLink = $state('');
  let qrDataUrl = $state<string | null>(null);
  let isGeneratingQr = $state(false);

  async function openQrModal(title: string, link: string) {
    qrModalTitle = title;
    qrModalLink = link;
    showQrModal = true;
    showShareMenu = false;
    showGDriveMenu = false;
    showMenu = false;
    isGeneratingQr = true;
    try {
      qrDataUrl = await QRCode.toDataURL(link, {
        width: 320,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
    } catch (err: any) {
      toast.error('Failed to generate QR code: ' + (err?.message || 'unknown error'));
      qrDataUrl = null;
    } finally {
      isGeneratingQr = false;
    }
  }

  async function getOrCreateShareUrl(): Promise<string> {
    if (sharedUrl) return sharedUrl;
    isSharing = true;
    try {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      const shareToken = await createShare(media.folder_path, media.id, allowDownload, false, false, date.toISOString());
      const domain = (import.meta.env.PUBLIC_APP_DOMAIN as string) || window.location.origin;
      const url = `${domain}/share/${shareToken}`;
      sharedUrl = url;
      return url;
    } finally {
      isSharing = false;
    }
  }

  async function handleCopyShareLink() {
    showShareMenu = false;
    try {
      const url = await getOrCreateShareUrl();
      await copyToClipboard(url);
      justShared = true;
      toast.success('Share link copied to clipboard!');
      setTimeout(() => justShared = false, 2500);
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to create share link');
    }
  }

  async function handleViewShareLink() {
    showShareMenu = false;
    try {
      const url = await getOrCreateShareUrl();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to generate share link');
    }
  }

  async function handleShowShareQr() {
    showShareMenu = false;
    try {
      const url = await getOrCreateShareUrl();
      await openQrModal('Scan Share Link', url);
    } catch (e: any) {
      console.error(e);
      toast.error('Failed to generate share link');
    }
  }

  async function makeCoverImage() {
    showMenu = false;
    if (onsetcover) onsetcover(media.id);
  }

  // Google Drive Link State & Fetching
  let gdriveLink = $state<string | null>(null);
  let isGDriveSynced = $state(false);
  let loadingGDriveLink = $state(false);
  let gdriveCopied = $state(false);
  let showGDriveMenu = $state(false);

  async function checkGDriveLink(targetMediaId: string) {
    if (isSharedView) return;
    loadingGDriveLink = true;
    try {
      const res = await getMediaGDriveLink(targetMediaId);
      if (res.synced && res.link) {
        gdriveLink = res.link;
        isGDriveSynced = true;
      } else {
        gdriveLink = null;
        isGDriveSynced = false;
      }
    } catch {
      gdriveLink = null;
      isGDriveSynced = false;
    } finally {
      loadingGDriveLink = false;
    }
  }

  async function copyGDriveLink() {
    if (!gdriveLink) return;
    showGDriveMenu = false;
    try {
      await copyToClipboard(gdriveLink);
      gdriveCopied = true;
      toast.success('Google Drive link copied to clipboard!');
      setTimeout(() => {
        gdriveCopied = false;
      }, 2500);
    } catch (e: any) {
      toast.error('Failed to copy link: ' + (e?.message || 'unknown error'));
    }
  }

  function handleViewGDriveLink() {
    if (!gdriveLink) return;
    showGDriveMenu = false;
    window.open(gdriveLink, '_blank', 'noopener,noreferrer');
  }

  function handleShowGDriveQr() {
    if (!gdriveLink) return;
    showGDriveMenu = false;
    openQrModal('Scan Google Drive Link', gdriveLink);
  }

  // Reset zoom & pan when navigating between media items
  $effect(() => {
    if (activeMedia.id) {
      currentZoom = 1;
      showZoomSlider = false;
      gdriveLink = null;
      isGDriveSynced = false;
      sharedUrl = null;
      showShareMenu = false;
      showGDriveMenu = false;
      checkGDriveLink(activeMedia.id);
      if (pzInstance) {
        pzInstance.zoomAbs(window.innerWidth / 2, window.innerHeight / 2, 1);
        pzInstance.moveTo(0, 0);
      }
    }
  });

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    lastActivity = Date.now();
    isIdle = false;
    const interval = setInterval(() => {
      if (!showInfo && Date.now() - lastActivity > 4000) {
        isIdle = true;
      }
    }, 300);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      clearInterval(interval);
    };
  });

  onDestroy(() => {
    stopHold();
    if (pzInstance) {
      pzInstance.dispose();
      pzInstance = null;
    }
  });
</script>

<div class="lightbox" style="opacity: 1;" onmousemove={onActivity} onmousedown={onActivity} ontouchstart={onActivity} onclick={(e) => { const t = e.target as HTMLElement; if (t.classList.contains('lightbox') || t.classList.contains('layout-wrapper') || t.classList.contains('main-area') || t.classList.contains('content')) close(); }}>
  <div class="layout-wrapper">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="main-area" ontouchstart={handleTouchStart} ontouchend={handleTouchEnd}>
      <div class="top-bar" style:opacity={isIdle ? 0 : 1} style:pointer-events={isIdle ? 'none' : 'auto'}>
        {#if allowDownload}
          <a href={downloadUrl} download={media.file_name} class="icon-btn" title="Download (D)" onclick={() => tracker.recordFeature('download')}>
            <Download size={20} strokeWidth={2} />
          </a>
        {/if}
        {#if !isSharedView}
          <div style="position: relative;" use:clickOutside={() => showShareMenu = false}>
            <button 
              class="icon-btn {justShared ? 'success' : ''} {showShareMenu ? 'active' : ''}" 
              onclick={() => { showShareMenu = !showShareMenu; showGDriveMenu = false; showMenu = false; }} 
              title="Share (S)"
            >
              {#if justShared}
                <Check size={20} strokeWidth={2} />
              {:else}
                <Share2 size={20} strokeWidth={2} />
              {/if}
            </button>
            {#if showShareMenu}
              <div class="dropdown-menu">
                <button onclick={handleViewShareLink}>
                  <ExternalLink size={15} style="margin-right: 8px; vertical-align: middle;" /> View Link
                </button>
                <button onclick={handleCopyShareLink}>
                  <Copy size={15} style="margin-right: 8px; vertical-align: middle;" /> Copy Link
                </button>
                <button onclick={handleShowShareQr}>
                  <QrCode size={15} style="margin-right: 8px; vertical-align: middle;" /> Show QR Code
                </button>
              </div>
            {/if}
          </div>
        {/if}
        {#if !media.mime_type.startsWith('video/')}
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="icon-btn {showZoomSlider ? 'active' : ''}" onclick={toggleZoomIcon} title="Zoom (+ / - / 0 / Z)">
              <ZoomIn size={20} strokeWidth={2} />
            </button>
            {#if showZoomSlider}
              <div transition:fade={{ duration: 150 }} style="background: rgba(0,0,0,0.5); padding: 8px 12px; border-radius: 22px; display: flex; align-items: center; gap: 8px;">
                <input type="range" min="1" max="5" step="0.1" bind:value={currentZoom} oninput={handleZoomSlider} style="width: 100px; accent-color: white;" />
                <span style="color: white; font-size: 0.75rem; min-width: 3ch; text-align: right;">{currentZoom.toFixed(1)}x</span>
              </div>
            {/if}
          </div>
        {/if}
        {#if showHiddenAlternates && alternates.length > 1}
          <button 
            type="button" 
            class="icon-btn burst-icon-btn" 
            class:active={showAlternatesSidebar} 
            onclick={toggleBurstSidebar} 
            title="Burst stack: {alternates.length} photos"
            aria-label="View burst sequence photos"
          >
            <Layers size={20} strokeWidth={2} />
            <span class="burst-icon-count">{alternates.length}</span>
          </button>
        {/if}
        <button class="icon-btn {showInfo ? 'active' : ''}" onclick={toggleInfo} title="Info (I)">
          <Info size={20} strokeWidth={2} />
        </button>
        {#if canFavorite}
          <button 
            type="button"
            class="icon-btn favorite-btn" 
            class:is-favorite={activeMedia.is_favorite} 
            onclick={handleToggleFavorite} 
            title={activeMedia.is_favorite ? "Favorited (F)" : "Favorite (F)"}
            aria-label="Toggle favorite"
          >
            <Heart size={20} strokeWidth={2} fill={activeMedia.is_favorite ? '#ef4444' : 'none'} color={activeMedia.is_favorite ? '#ef4444' : 'currentColor'} />
          </button>
        {/if}
        {#if !isSharedView && isGDriveSynced && gdriveLink}
          <div style="position: relative;" use:clickOutside={() => showGDriveMenu = false}>
            <button 
              class="icon-btn {gdriveCopied ? 'success' : ''} {showGDriveMenu ? 'active' : ''}" 
              onclick={() => { showGDriveMenu = !showGDriveMenu; showShareMenu = false; showMenu = false; }} 
              title={gdriveCopied ? 'Copied Google Drive Link!' : 'Google Drive Link'}
            >
              {#if gdriveCopied}
                <Check size={20} strokeWidth={2} />
              {:else}
                <Cloud size={20} strokeWidth={2} />
              {/if}
            </button>
            {#if showGDriveMenu}
              <div class="dropdown-menu">
                <button onclick={handleViewGDriveLink}>
                  <ExternalLink size={15} style="margin-right: 8px; vertical-align: middle;" /> View on Drive
                </button>
                <button onclick={copyGDriveLink}>
                  <Copy size={15} style="margin-right: 8px; vertical-align: middle;" /> Copy Link
                </button>
                <button onclick={handleShowGDriveQr}>
                  <QrCode size={15} style="margin-right: 8px; vertical-align: middle;" /> Show QR Code
                </button>
              </div>
            {/if}
          </div>
        {/if}
        {#if !isSharedView}
          <div style="position: relative;" use:clickOutside={() => showMenu = false}>
            <button class="icon-btn" onclick={() => { showMenu = !showMenu; showShareMenu = false; showGDriveMenu = false; }} title="More (C to set cover)">
              <MoreHorizontal size={20} strokeWidth={2} />
            </button>
            {#if showMenu}
              <div class="dropdown-menu">
                <button onclick={makeCoverImage}>Set as Cover Image (C)</button>
              </div>
            {/if}
          </div>
        {/if}
        <button class="icon-btn close-btn" onclick={close} title="Close (Esc)">
          <X size={24} strokeWidth={2} />
        </button>
      </div>

      <button 
        class="nav-btn prev-btn" 
        style:opacity={isIdle ? 0 : 1} 
        onclick={handlePrev}
        onpointerdown={(e) => { if (e.button === 0) startHold(handlePrev); }}
        onpointerup={stopHold}
        onpointerleave={stopHold}
        onpointercancel={stopHold}
        title="Previous (←)"
        aria-label="Previous image"
      >
        <ChevronLeft size={32} strokeWidth={2} />
      </button>
      
      <div class="content">
        {#if activeMedia.mime_type.startsWith('video/')}
          {#key activeMedia.id}
            {#if activeMedia.is_transcoded === false}
              <div class="processing-video-container">
                <img src={getPreviewUrl(activeMedia.id, false, token, 'lightbox')} alt={activeMedia.file_name} class="media-element" draggable="false" decoding="async" style="opacity: 0.3" />
                <div class="processing-overlay">
                  <Clock size={48} strokeWidth={2} />
                  <div class="processing-text">
                    <p>This video is being processed.</p>
                    {#if queueStatus?.status === 'processing'}
                      <p style="font-size: 0.85rem; color: #cbd5e1; margin-top: 4px;">Status: Currently Encoding...</p>
                    {:else if queueStatus?.status === 'queued'}
                      <p style="font-size: 0.85rem; color: #cbd5e1; margin-top: 4px;">Queue position: {queueStatus.position}</p>
                    {:else if queueStatus?.status === 'completed'}
                      <p style="font-size: 0.85rem; color: #10b981; margin-top: 4px;">Ready!</p>
                    {:else}
                      <p style="font-size: 0.85rem; color: #cbd5e1; margin-top: 4px;">Checking status...</p>
                    {/if}
                  </div>
                </div>
              </div>
            {:else}
              <video 
                controls 
                autoplay 
                playsinline 
                class="media-element" 
                src={getStreamUrl(activeMedia.id, token)}
                onerror={handleVideoError}
              >
                Your browser does not support the video tag.
              </video>
            {/if}
          {/key}
        {:else}
          {#key activeMedia.id}
            <img 
              src={`${getPreviewUrl(activeMedia.id, false, token, 'lightbox')}${watermarkVersion ? '&wv=' + watermarkVersion : ''}`} 
              alt={activeMedia.file_name} 
              class="media-element" 
              draggable="false" 
              decoding="async"
              use:initPanzoom 
            />
          {/key}
        {/if}
      </div>
      
      <button 
        class="nav-btn next-btn" 
        style:opacity={isIdle ? 0 : 1} 
        onclick={handleNext}
        onpointerdown={(e) => { if (e.button === 0) startHold(handleNext); }}
        onpointerup={stopHold}
        onpointerleave={stopHold}
        onpointercancel={stopHold}
        title="Next (→)"
        aria-label="Next image"
      >
        <ChevronRight size={32} strokeWidth={2} />
      </button>

      {#if isBurstStackMode && alternates.length > 1}
        <div class="lightbox-burst-badge-container" style:opacity={isIdle ? 0 : 1} style:pointer-events={isIdle ? 'none' : 'auto'}>
          <button 
            type="button" 
            class="burst-status-badge"
            onclick={closeBurstSidebar}
            title="Burst stack navigation active (Next/Prev stay within this burst). Click to exit."
          >
            <Layers size={13} />
            <span>Burst Stack Mode ({alternates.findIndex(a => a.id === activeMedia.id) + 1} of {alternates.length})</span>
            <span class="exit-hint">Exit (Esc)</span>
          </button>
        </div>
      {/if}

      {#if media.is_staged}
        <div class="lightbox-staging-notice" style:opacity={isIdle ? 0 : 1} style:pointer-events={isIdle ? 'none' : 'auto'}>
          <button 
            type="button" 
            class="minimized-notice-pill" 
            onclick={(e) => { e.stopPropagation(); showLightboxNoticeDetails = !showLightboxNoticeDetails; }}
            title="Click to view staging disclaimer"
          >
            <span class="pill-tag">Live Staging Preview</span>
            <span class="pill-subtext">• Photos are unedited & subject to change</span>
            <span class="pill-info-icon"><Info size={13} /></span>
          </button>

          {#if showLightboxNoticeDetails}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div class="notice-details-popover" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
              <div class="popover-header">
                <strong>Realtime Staging Preview</strong>
                <button type="button" class="popover-close-btn" onclick={() => showLightboxNoticeDetails = false} title="Close disclaimer">
                  <X size={14} />
                </button>
              </div>
              <p>This photo was synced in realtime via FastUp and has not been filtered or edited yet. It is subject to change. Please return during a later time for final photos.</p>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if showInfo}
      <div class="sidebar" transition:slide={{ axis: 'x', duration: 300 }}>
        <div class="sidebar-inner">
          <h3>Info</h3>
          <div class="info-section">
            <h4>DETAILS</h4>
            <div class="details-grid">
              <div class="detail-block">
                
                <div class="detail-header">{isNaN(rawDate.getTime()) || rawDate.getTime() === 0 ? 'Unknown Date' : rawDate.toLocaleDateString(typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                <div class="detail-subheader">{isNaN(rawDate.getTime()) || rawDate.getTime() === 0 ? '-' : rawDate.toLocaleDateString(typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined, { weekday: 'long' }) + ', ' + rawDate.toLocaleTimeString(typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
              </div>
              <div class="detail-block">
                <div class="detail-header">{media.file_name}</div>
                <div class="detail-subheader">
                  
                  
                  
                  {mediaMP > 0 ? `${mediaMP} MP ` : ''}{mediaW > 0 && mediaH > 0 ? `${mediaW}x${mediaH} ` : ''}{(media.size_bytes / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>
              {#if exifMake || exifModel || exifIso || exifShutter}
              <div class="detail-block">
                <div class="detail-header">{exifMake || ''} {exifModel || 'Unknown Camera'}</div>
                <div class="detail-subheader">
                  {exifShutter ? (typeof exifShutter === "number" && exifShutter < 1 ? `1/${Math.round(1/exifShutter)}s ` : `${exifShutter}s `) : ''}{exifIso ? `ISO ${exifIso}` : ''}
                </div>
              </div>
              {/if}
              {#if exifLens || exifAperture || exifFocal}
              <div class="detail-block">
                <div class="detail-header">{exifLens || 'Unknown Lens'}</div>
                <div class="detail-subheader">
                  {exifAperture ? `f/${exifAperture} ` : ''}{exifFocal ? `${exifFocal}mm` : ''}
                </div>
              </div>
              {/if}
            </div>
          </div>
          {#if media.folder_path}
          {@const sourceUrl = pathUrl(pathSegments)}
          <div class="info-section">
            <h4>SOURCE</h4>
            <div class="album-info">
              {#if sourceUrl}
                <a href={sourceUrl} class="album-cover" onclick={close}>
                  <BlurhashImage hash={''} src={getThumbnailUrl(folderCoverId || media.folder_cover_id || media.id, token)} objectFit="cover" square={true} />
                </a>
              {:else}
                <div class="album-cover">
                  <BlurhashImage hash={''} src={getThumbnailUrl(folderCoverId || media.folder_cover_id || media.id, token)} objectFit="cover" square={true} />
                </div>
              {/if}
              <div class="album-details">
                {#if pathSegments.length > 1}
                  <div class="breadcrumb-path">
                    {#each pathSegments.slice(0, -1) as segment, i}
                      {#if i > 0}<span class="breadcrumb-sep"> &gt; </span>{/if}
                      {@const url = pathUrl(pathSegments.slice(0, i + 1))}
                      {#if url}
                        <a href={url} onclick={close}>{segment}</a>
                      {:else}
                        <span style="color: #888; cursor: default;">{segment}</span>
                      {/if}
                    {/each}
                  </div>
                {/if}
                {#if sourceUrl}
                  <a href={sourceUrl} class="album-name" onclick={close}>{pathSegments.at(-1)}</a>
                {:else}
                  <span class="album-name" style="cursor: default;">{pathSegments.at(-1)}</span>
                {/if}
              </div>
            </div>
          </div>
          {/if}
          {#if !isSharedView && isGDriveSynced && gdriveLink}
          <div class="info-section">
            <h4>GOOGLE DRIVE</h4>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                  <Cloud size={16} color="#60a5fa" style="flex-shrink: 0;" />
                  <span style="font-size: 0.85rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Synced to Drive</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                  <button 
                    type="button" 
                    class="btn-sm" 
                    style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 0.75rem; background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid rgba(59,130,246,0.4); border-radius: 4px; cursor: pointer;"
                    onclick={copyGDriveLink}
                    title="Copy Google Drive direct link"
                  >
                    {#if gdriveCopied}
                      <Check size={12} /> Copied
                    {:else}
                      <Copy size={12} /> Copy Link
                    {/if}
                  </button>
                  <button 
                    type="button" 
                    class="btn-sm" 
                    style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 0.75rem; background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; cursor: pointer;"
                    onclick={handleShowGDriveQr}
                    title="Show Google Drive QR code"
                  >
                    <QrCode size={12} /> QR
                  </button>
                  <a 
                    href={gdriveLink} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    class="btn-sm" 
                    style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 0.75rem; background: rgba(255,255,255,0.1); color: #f8fafc; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; text-decoration: none;"
                    title="Open in Google Drive"
                  >
                    <ExternalLink size={12} /> Open
                  </a>
                </div>
              </div>
            </div>
          </div>
          {/if}
          {#if !isSharedView}
          <div class="info-section">
            <h4>PEOPLE</h4>
            {#if loadingFaces}
              <p style="color: #888;">Loading faces...</p>
            {:else if faces.length > 0}
              <div class="face-list">
                {#each faces as face}
                  {#if face.person_id}
                    <a href={`/people/${face.person_id}`} class="face-item" onclick={close}>
                      <span class="face-avatar">
                        <BlurhashImage 
                          hash={''}
                          src={getThumbnailUrl(media.id)} 
                          faceBox={face.bounding_box}
                          objectFit="cover" 
                          square={true} 
                        />
                      </span>
                      <span class="face-item-name">{face.name || 'Add name...'}</span>
                    </a>
                  {:else}
                    <div class="face-item" style="cursor: default;">
                      <span class="face-avatar">
                        <BlurhashImage 
                          hash={''}
                          src={getThumbnailUrl(media.id)} 
                          faceBox={face.bounding_box}
                          objectFit="cover" 
                          square={true} 
                        />
                      </span>
                      <span class="face-item-name">Unknown</span>
                    </div>
                  {/if}
                {/each}
              </div>
            {:else}
              <p style="color: #888;">No faces detected.</p>
            {/if}
          </div>
          {/if}
        
          <div class="info-section">
            <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; margin-bottom: 8px;" onclick={() => { showAdvanced = !showAdvanced; tracker.recordFeature('advanced_exif'); if (showAdvanced) loadAdvancedExif(); }}>
              <h4 style="margin: 0;">ADVANCED EXIF</h4>
              <span style="font-size: 0.75rem; color: #888;">{showAdvanced ? 'Hide' : 'Show'}</span>
            </div>
            {#if showAdvanced}
              <div class="advanced-exif">
                {#if loadingExif}
                  <p style="color: #888; font-size: 0.8rem;">Loading...</p>
                {:else if rawExif}
                  {@const advDate = rawExif?.DateTimeOriginal || rawExif?.CreateDate}
                  {@const dAdv = advDate ? new Date(advDate) : null}
                  {@const sTime = rawExif?.ExposureTime || rawExif?.exposureTime}
                  
                  <div class="exif-row"><span class="exif-key">Date</span> <span class="exif-val">{dAdv ? dAdv.toLocaleDateString('en-GB') : ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Time</span> <span class="exif-val">{dAdv ? dAdv.toLocaleTimeString('en-US') : ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Latitude</span> <span class="exif-val">{rawExif?.GPSLatitude || rawExif?.latitude || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Longitude</span> <span class="exif-val">{rawExif?.GPSLongitude || rawExif?.longitude || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Model</span> <span class="exif-val">{rawExif?.Model || rawExif?.model || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Serial #</span> <span class="exif-val">{rawExif?.SerialNumber || rawExif?.BodySerialNumber || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Firmware</span> <span class="exif-val">{rawExif?.Software || rawExif?.software || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Frame #</span> <span class="exif-val">{rawExif?.FileNumber || rawExif?.ImageNumber || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Lens (mm)</span> <span class="exif-val">{rawExif?.FocalLength || rawExif?.focalLength || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">ISO</span> <span class="exif-val">{rawExif?.ISO || rawExif?.iso || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Aperture</span> <span class="exif-val">{rawExif?.FNumber || rawExif?.ApertureValue || rawExif?.aperture || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Shutter</span> <span class="exif-val">{sTime ? (typeof sTime === 'number' && sTime < 1 ? `1/${Math.round(1/sTime)}` : sTime) : ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Exp. Comp.</span> <span class="exif-val">{rawExif?.ExposureCompensation !== undefined ? rawExif.ExposureCompensation : ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Flash Comp.</span> <span class="exif-val">{rawExif?.FlashCompensation !== undefined ? rawExif.FlashCompensation : ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Program</span> <span class="exif-val">{rawExif?.ExposureProgram || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Focus Mode</span> <span class="exif-val">{rawExif?.FocusMode || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">White Bal.</span> <span class="exif-val">{rawExif?.WhiteBalance || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">ICC Profile</span> <span class="exif-val">{rawExif?.ProfileName || rawExif?.ColorSpace || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Contrast</span> <span class="exif-val">{rawExif?.Contrast || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Sharpening</span> <span class="exif-val">{rawExif?.Sharpness || ''}</span></div>
                  <div class="exif-row"><span class="exif-key">Quality</span> <span class="exif-val">{rawExif?.Quality || ''}</span></div>

                  <div class="exif-row" style="margin-top: 12px; color: #e2e8f0; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;"><strong>All Raw Data</strong></div>
                  {#each Object.entries(rawExif || {}) as [key, val]}
                    {#if typeof val !== 'object' && key !== 'MakerNote'}
                      <div class="exif-row">
                        <span class="exif-key">{key}</span>
                        <span class="exif-val">{String(val)}</span>
                      </div>
                    {/if}
                  {/each}
                {:else}
                  <p style="color: #888; font-size: 0.8rem;">No EXIF data available.</p>
                {/if}
              </div>
            {/if}
          </div>

          {#if alternates.length > 1}
            <div class="info-section">
              <h4>BURST SEQUENCE ({alternates.length} PHOTOS)</h4>
              <p style="font-size: 0.8rem; color: #a1a1aa; margin-bottom: 8px;">
                {alternates.length} shots taken in this burst group.
              </p>
              <button 
                type="button" 
                class="btn" 
                style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.2); color: #f1f5f9; font-size: 0.8rem; padding: 6px 12px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;"
                onclick={openBurstSidebar}
              >
                <Layers size={14} />
                <span>View Burst Stack ({alternates.length})</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if showAlternatesSidebar}
      <div class="sidebar burst-sidebar" transition:slide={{ axis: 'x', duration: 300 }}>
        <div class="sidebar-inner">
          <div class="burst-sidebar-header">
            <div>
              <h3>Burst Stack</h3>
              <span class="burst-sidebar-subtitle">{alternates.length} photos in sequence</span>
            </div>
            <button type="button" class="burst-close-btn" onclick={closeBurstSidebar} title="Close Stack View (Esc)">
              <X size={18} />
            </button>
          </div>

          <div class="burst-stack-list">
            {#each alternates as alt, idx}
              <div 
                class="burst-stack-card" 
                class:is-active={alt.id === activeMedia.id}
                class:is-hero={alt.is_hero}
              >
                <button 
                  type="button" 
                  class="burst-stack-thumb-btn"
                  onclick={() => switchActiveMedia(alt)}
                  title="View {alt.file_name}"
                >
                  <img src={getThumbnailUrl(alt.id, token)} alt={alt.file_name} loading="lazy" />
                  <span class="burst-stack-index">#{idx + 1}</span>
                </button>

                <div class="burst-stack-details">
                  <div class="burst-stack-title-row">
                    <span class="burst-stack-filename" title={alt.file_name}>{alt.file_name}</span>
                  </div>

                  <div class="burst-stack-actions-row">
                    <button 
                      type="button" 
                      class="visibility-toggle-btn {alt.is_hero ? 'is-shown' : 'is-hidden'}"
                      onclick={() => handleToggleVisibility(alt.id, !!alt.is_hero)}
                      title={alt.is_hero ? 'Shown in curated view (click to hide)' : 'Hidden in curated view (click to show)'}
                    >
                      {#if alt.is_hero}
                        <Eye size={13} />
                        <span>Curated</span>
                      {:else}
                        <EyeOff size={13} />
                        <span>Hidden</span>
                      {/if}
                    </button>

                    {#if allowHeroSelection && !alt.is_hero}
                      <button 
                        type="button" 
                        class="btn-sm btn-hero" 
                        onclick={() => handlePromoteHero(alt.id)}
                        title="Set as Best Pick"
                      >
                        Set Best
                      </button>
                    {/if}

                    {#if allowDownload}
                      <a 
                        href={`${getStreamUrl(alt.id, token)}${token ? '&' : '?'}download=1`} 
                        download={alt.file_name} 
                        class="btn-sm btn-download" 
                        title="Download"
                      >
                        <Download size={13} />
                      </a>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<Modal bind:show={showQrModal} id="lightbox-qr-code" title={qrModalTitle}>
  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 0; text-align: center;">
    {#if isGeneratingQr}
      <div style="width: 220px; height: 220px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 0.875rem;">
        Generating QR Code...
      </div>
    {:else if qrDataUrl}
      <div style="background: white; padding: 12px; margin-bottom: 16px; border: 1px solid var(--glass-border);">
        <img src={qrDataUrl} alt="QR Code" style="width: 220px; height: 220px; display: block;" />
      </div>
    {/if}
    
    <div style="width: 100%; max-width: 340px; background: rgba(0,0,0,0.5); border: 1px solid var(--glass-border); padding: 8px 12px; margin-bottom: 20px; word-break: break-all; font-size: 0.85rem; color: #aaa; max-height: 60px; overflow-y: auto; font-family: monospace;">
      {qrModalLink}
    </div>

    <div style="display: flex; gap: 8px; width: 100%; max-width: 340px; justify-content: flex-end;">
      <button 
        type="button" 
        class="btn" 
        style="flex: 1; padding: 8px 14px; font-size: 0.875rem; background: transparent; color: white; border: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: center; gap: 6px;"
        onclick={async () => {
          if (qrModalLink) {
            await copyToClipboard(qrModalLink);
            toast.success('Link copied to clipboard!');
          }
        }}
      >
        <Copy size={16} /> Copy Link
      </button>

      <a 
        href={qrModalLink} 
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

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes fadeInOnly {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .lightbox {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100dvh;
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
    animation: fadeInOnly 0.15s ease both;
  }

  .top-bar {
    position: absolute;
    top: 0;
    right: 0;
    padding: 16px;
    display: flex;
    gap: 12px;
    z-index: 1010;
    transition: opacity 0.4s ease;
  }

  .icon-btn {
    background: rgba(0, 0, 0, 0.5);
    border: none;
    color: white;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background 0.2s;
    text-decoration: none;
  }
  
  .icon-btn:hover, .icon-btn.active {
    background: rgba(255, 255, 255, 0.2);
    color: white;
  }

  .icon-btn.success {
    color: #4ade80;
    background: rgba(74, 222, 128, 0.1);
  }

  .close-btn {
    font-size: 1.5rem;
  }

  .dropdown-menu {
    position: absolute;
    top: 50px;
    right: 0;
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    overflow: hidden;
    min-width: 180px;
  }

  .dropdown-menu button, .dropdown-menu .dropdown-link {
    width: 100%;
    padding: 12px 16px;
    background: none;
    border: none;
    color: white;
    text-align: left;
    cursor: pointer;
    display: block;
    text-decoration: none;
    box-sizing: border-box;
    font-size: 0.9rem;
  }

  .dropdown-menu button:hover, .dropdown-menu .dropdown-link:hover {
    background: rgba(255,255,255,0.1);
  }

  .layout-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    align-items: stretch;
  }

  .main-area {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }

  .nav-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0,0,0,0.5);
    color: white;
    border: none;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    z-index: 1005;
    transition: opacity 0.4s ease, background 0.2s ease;
  }

  .nav-btn:hover {
    background: rgba(255,255,255,0.2);
  }

  .prev-btn {
    left: 24px;
  }

  .next-btn {
    right: 24px;
  }

  .sidebar {
    width: 350px;
    flex-shrink: 0;
    height: 100%;
    background: #000000;
    border-left: 1px solid rgba(255,255,255,0.1);
    padding: 24px;
    overflow-y: auto;
    overflow-x: hidden;
    z-index: 1000;
  }

  .sidebar-inner {
    width: 100%;
  }

  .sidebar h3 {
    margin-bottom: 24px;
    font-size: 1.5rem;
  }

  .info-section {
    margin-bottom: 24px;
  }

  .info-section h4 {
    color: #94a3b8;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }

  .details-grid {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .detail-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .detail-header {
    font-size: 0.875rem;
    font-weight: 500;
    color: #e2e8f0;
  }

  .detail-subheader {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .info-section p {
    font-size: 0.875rem;
    margin-bottom: 4px;
    color: #e2e8f0;
  }

  .album-info {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .album-cover {
    width: 80px;
    height: 80px;
    border-radius: 0;
    overflow: hidden;
    flex-shrink: 0;
    background: rgba(255,255,255,0.05);
    transition: filter 0.2s ease;
  }
  
  .album-cover:hover {
    filter: brightness(1.2);
  }

  .album-name {
    color: inherit;
    text-decoration: none;
    font-weight: 500;
    display: block;
    font-size: 0.875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .album-name:hover {
    text-decoration: underline;
  }

  .album-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .breadcrumb-path {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    font-size: 0.75rem;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .breadcrumb-path a {
    color: #64748b;
    text-decoration: none;
    transition: color 0.2s;
  }

  .breadcrumb-path a:hover {
    color: #94a3b8;
  }

  .breadcrumb-sep {
    color: #475569;
    margin: 0 2px;
  }

  .face-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .face-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    text-decoration: none;
    color: inherit;
    width: 80px;
  }

  .face-avatar {
    width: 80px;
    height: 80px;
    border-radius: 0;
    overflow: hidden;
    display: block;
    background: rgba(255,255,255,0.05);
    transition: filter 0.2s ease;
  }

  .face-item:hover .face-avatar {
    filter: brightness(1.2);
  }

  .face-item-name {
    font-size: 0.75rem;
    color: #e2e8f0;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .content {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    animation: fadeIn 0.4s ease both;
    touch-action: none;
  }

  .processing-video-container {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
  }

  .processing-overlay {
    position: absolute;
    color: rgba(255, 255, 255, 0.9);
    background: rgba(0, 0, 0, 0.6);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    pointer-events: none;
    gap: 12px;
    text-align: center;
  }

  .processing-text p {
    margin: 0;
    font-size: 1rem;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.9);
  }

  .media-element {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 0;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }

  @media (max-width: 768px) {
    .sidebar {
      position: absolute;
      top: 0;
      right: 0;
      width: 100%;
      max-width: 320px;
      height: 100%;
      z-index: 1000;
      box-shadow: -10px 0 30px rgba(0,0,0,0.7);
    }
  }

  .advanced-exif {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .exif-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    gap: 8px;
  }
  .exif-key {
    color: #94a3b8;
    flex-shrink: 0;
    max-width: 70%;
    word-break: break-word;
  }
  .exif-val {
    color: #e2e8f0;
    text-align: right;
    word-break: break-all;
  }

  /* Minimized Live Staging Notice */
  .lightbox-staging-notice {
    position: absolute;
    bottom: 24px;
    left: 24px;
    z-index: 1005;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    transition: opacity 0.4s ease;
  }
  .minimized-notice-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(168, 85, 247, 0.4);
    border-radius: 9999px;
    color: #e2e8f0;
    font-size: 0.78rem;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    transition: all 0.2s ease;
  }
  .minimized-notice-pill:hover {
    background: rgba(15, 23, 42, 0.9);
    border-color: rgba(168, 85, 247, 0.7);
    transform: translateY(-1px);
  }
  .pill-tag {
    font-weight: 600;
    color: #d8b4fe;
  }
  .pill-subtext {
    color: #94a3b8;
    font-size: 0.75rem;
  }
  .pill-info-icon {
    display: inline-flex;
    align-items: center;
    color: #c084fc;
    margin-left: 2px;
  }
  .notice-details-popover {
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(168, 85, 247, 0.35);
    border-radius: 12px;
    padding: 14px 16px;
    max-width: 340px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    animation: fadeInSlide 0.2s ease-out;
  }
  .popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    color: #f3e8ff;
    font-size: 0.85rem;
  }
  .popover-close-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: color 0.15s;
  }
  .popover-close-btn:hover {
    color: white;
  }
  .notice-details-popover p {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.45;
    color: #cbd5e1;
  }
  @keyframes fadeInSlide {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (max-width: 640px) {
    .lightbox-staging-notice {
      bottom: 16px;
      left: 16px;
      right: 16px;
    }
    .pill-subtext {
      display: none;
    }
  }

  /* Burst Stack Sidebar Styles */
  .burst-icon-btn {
    position: relative;
    color: #f1f5f9;
  }
  .burst-icon-btn.active {
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
  }
  .favorite-btn.is-favorite {
    color: #ef4444;
  }
  .favorite-btn.is-favorite:hover {
    color: #f87171;
  }
  .burst-icon-count {
    position: absolute;
    bottom: 2px;
    right: 2px;
    font-size: 0.6rem;
    font-weight: 700;
    line-height: 1;
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: #f1f5f9;
    padding: 1px 3px;
    border-radius: 4px;
    pointer-events: none;
  }

  .lightbox-burst-badge-container {
    position: absolute;
    bottom: 28px;
    left: 24px;
    z-index: 1005;
    pointer-events: auto;
    transition: opacity 0.2s ease;
  }
  .burst-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(15, 23, 42, 0.9);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(56, 189, 248, 0.6);
    border-radius: 9999px;
    padding: 6px 14px;
    color: #f1f5f9;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    transition: all 0.2s ease;
  }
  .burst-status-badge:hover {
    background: rgba(15, 23, 42, 0.98);
    border-color: #38bdf8;
    transform: translateY(-1px);
  }
  .burst-status-badge .exit-hint {
    background: rgba(255, 255, 255, 0.15);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.65rem;
    color: #cbd5e1;
  }

  .burst-sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .burst-sidebar-header h3 {
    margin: 0;
    font-size: 1.25rem;
    color: #f8fafc;
  }
  .burst-sidebar-subtitle {
    font-size: 0.75rem;
    color: #94a3b8;
  }
  .burst-close-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s;
  }
  .burst-close-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  .burst-nav-mode-indicator {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(56, 189, 248, 0.1);
    border: 1px solid rgba(56, 189, 248, 0.3);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 16px;
    font-size: 0.75rem;
    color: #7dd3fc;
  }
  .exit-nav-pill {
    background: rgba(56, 189, 248, 0.2);
    border: 1px solid rgba(56, 189, 248, 0.4);
    color: #e0f2fe;
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .exit-nav-pill:hover {
    background: rgba(56, 189, 248, 0.35);
  }

  .burst-stack-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 40px;
  }

  .burst-stack-card {
    display: flex;
    gap: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 8px;
    transition: all 0.15s;
  }
  .burst-stack-card.is-active {
    border-color: #38bdf8;
    background: rgba(56, 189, 248, 0.08);
  }
  .burst-stack-card.is-hero {
    border-left: 3px solid #38bdf8;
  }

  .burst-stack-thumb-btn {
    position: relative;
    width: 68px;
    height: 68px;
    flex-shrink: 0;
    border-radius: 6px;
    overflow: hidden;
    background: #000;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .burst-stack-thumb-btn img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.2s;
  }
  .burst-stack-thumb-btn:hover img {
    transform: scale(1.08);
  }
  .burst-stack-index {
    position: absolute;
    bottom: 2px;
    left: 2px;
    background: rgba(0, 0, 0, 0.75);
    color: #cbd5e1;
    font-size: 0.6rem;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .card-active-pill {
    position: absolute;
    top: 2px;
    right: 2px;
    background: #38bdf8;
    color: #000;
    font-size: 0.55rem;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
  }

  .burst-stack-details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .burst-stack-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .burst-stack-filename {
    font-size: 0.75rem;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }

  .burst-stack-actions-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }

  .visibility-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    border: none;
  }
  .visibility-toggle-btn.is-shown {
    background: rgba(34, 197, 94, 0.18);
    border: 1px solid rgba(34, 197, 94, 0.4);
    color: #4ade80;
  }
  .visibility-toggle-btn.is-shown:hover {
    background: rgba(34, 197, 94, 0.3);
  }
  .visibility-toggle-btn.is-hidden {
    background: rgba(148, 163, 184, 0.12);
    border: 1px solid rgba(148, 163, 184, 0.25);
    color: #94a3b8;
  }
  .visibility-toggle-btn.is-hidden:hover {
    background: rgba(148, 163, 184, 0.22);
    color: #cbd5e1;
  }

  .btn-hero {
    background: rgba(56, 189, 248, 0.12);
    border: 1px solid rgba(56, 189, 248, 0.35);
    color: #7dd3fc;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-hero:hover {
    background: rgba(56, 189, 248, 0.25);
  }

  .btn-download {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: white;
    padding: 3px 6px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-download:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  @media (max-width: 640px) {
    .lightbox-burst-badge-container {
      bottom: 60px;
      left: 16px;
      right: 16px;
    }
  }

</style>
