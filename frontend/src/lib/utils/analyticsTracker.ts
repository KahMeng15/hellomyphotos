import { API_BASE } from '$lib/api/media';

export interface TrackerInitOptions {
  shareToken?: string;
  folderPath?: string;
  sortMode?: string;
  viewMode?: string;
}

export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem('hmp_device_id');
    if (!id && typeof document !== 'undefined') {
      const match = document.cookie.match(/(?:^|;\s*)hmp_device_id=([^;]+)/);
      if (match) id = decodeURIComponent(match[1]);
    }
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'dev_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    }
    localStorage.setItem('hmp_device_id', id);
    if (typeof document !== 'undefined') {
      document.cookie = `hmp_device_id=${encodeURIComponent(id)}; path=/; max-age=63072000; SameSite=Lax`;
    }
    return id;
  } catch {
    return '';
  }
}

class AnalyticsTracker {
  private shareToken: string | null = null;
  private currentFolderPath: string | null = null;
  private sortMode: string | null = null;
  private viewMode: string | null = null;
  private sessionStartTime: number = Date.now();
  private foldersVisited: Set<string> = new Set();
  private currentPhotoId: string | null = null;
  private currentPhotoStartTime: number = 0;
  private maxScrollDepth: number = 0;
  private isInitialized: boolean = false;
  private heartbeatTimer: any = null;
  private scrollListenerAttached: boolean = false;
  private lastResourceIndex: number = 0;
  private cacheCheckTimer: any = null;

  init(options: TrackerInitOptions = {}) {
    if (typeof window === 'undefined') return;

    this.shareToken = options.shareToken || this.shareToken;
    this.currentFolderPath = options.folderPath || this.currentFolderPath;
    if (options.sortMode) this.sortMode = options.sortMode;
    if (options.viewMode) this.viewMode = options.viewMode;

    const isFirstInit = !this.isInitialized;

    if (options.folderPath) {
      if (!this.foldersVisited.has(options.folderPath)) {
        this.foldersVisited.add(options.folderPath);
        // Only emit folder_visit if tracker is already running (subsequent route nav)
        if (!isFirstInit) {
          this.sendBeacon({
            actionType: 'folder_visit',
            shareToken: this.shareToken,
            folderPath: options.folderPath,
            foldersVisited: [options.folderPath]
          });
        }
      }
    }

    if (isFirstInit) {
      this.isInitialized = true;
      this.sessionStartTime = Date.now();

      // Track scroll depth
      this.updateScrollDepth();
      if (!this.scrollListenerAttached) {
        window.addEventListener('scroll', this.handleScroll, { passive: true });
        this.scrollListenerAttached = true;
      }

      // Flush telemetry when page becomes hidden or unloads
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flushSessionEnd();
        }
      });
      window.addEventListener('beforeunload', () => {
        this.flushSessionEnd();
      });

      // Send initial page load telemetry once window load completes
      if (document.readyState === 'complete') {
        setTimeout(() => this.flushInitialLoad(), 1000);
      } else {
        window.addEventListener('load', () => {
          setTimeout(() => this.flushInitialLoad(), 1000);
        });
      }

      // Periodic heartbeat every 45s (reports session duration & scroll without duplicating features)
      this.heartbeatTimer = setInterval(() => {
        this.flushHeartbeat();
      }, 45000);
    }
  }

  private handleScroll = () => {
    this.updateScrollDepth();
    this.scheduleCacheCheck();
  };

  private updateScrollDepth() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const doc = document.documentElement;
    const scrollHeight = Math.max(doc.scrollHeight, document.body.scrollHeight) - window.innerHeight;
    if (scrollHeight <= 0) {
      this.maxScrollDepth = 100;
      return;
    }
    const scrolled = window.scrollY || doc.scrollTop || 0;
    const pct = Math.min(100, Math.max(0, Math.round(((scrolled + window.innerHeight * 0.5) / doc.scrollHeight) * 100)));
    if (pct > this.maxScrollDepth) {
      this.maxScrollDepth = pct;
    }
  }

  recordFeature(feature: string) {
    if (!feature) return;
    this.sendBeacon({
      actionType: 'feature_interaction',
      shareToken: this.shareToken,
      folderPath: this.currentFolderPath,
      featuresUsed: [feature]
    });
  }

  recordFolder(path: string) {
    if (!path) return;
    // Flush any pending cache savings for the previous folder before switching
    this.checkAndFlushCacheSavings();
    const isNew = !this.foldersVisited.has(path);
    this.currentFolderPath = path;
    if (isNew) {
      this.foldersVisited.add(path);
      if (this.isInitialized) {
        this.sendBeacon({
          actionType: 'folder_visit',
          shareToken: this.shareToken,
          folderPath: path,
          foldersVisited: [path]
        });
      }
    }
  }

  recordSortChange(mode: string) {
    this.sortMode = mode;
    this.recordFeature('sort_change');
    this.sendBeacon({
      actionType: 'sort_change',
      shareToken: this.shareToken,
      folderPath: this.currentFolderPath,
      sortMode: mode
    });
  }

  recordViewChange(mode: string) {
    this.viewMode = mode;
    this.recordFeature('view_mode_change');
    this.sendBeacon({
      actionType: 'view_mode_change',
      shareToken: this.shareToken,
      folderPath: this.currentFolderPath,
      viewMode: mode
    });
  }

  recordFolderViewChange(mode: string) {
    this.recordFeature('folder_view_mode_change');
  }

  startPhotoDwell(mediaId: string) {
    this.endPhotoDwell();
    this.currentPhotoId = mediaId;
    this.currentPhotoStartTime = Date.now();
  }

  endPhotoDwell() {
    if (this.currentPhotoId && this.currentPhotoStartTime > 0) {
      const dwellMs = Date.now() - this.currentPhotoStartTime;
      const mediaId = this.currentPhotoId;
      this.currentPhotoId = null;
      this.currentPhotoStartTime = 0;

      // Only record dwell times >= 300ms (filter out rapid flipping)
      if (dwellMs >= 300) {
        this.sendBeacon({
          actionType: 'photo_dwell',
          mediaId,
          photoViewMs: dwellMs,
          shareToken: this.shareToken,
          folderPath: this.currentFolderPath
        });
      }
      this.scheduleCacheCheck();
    }
  }

  recordDownloadDuration(durationMs: number) {
    if (durationMs > 0) {
      this.sendBeacon({
        actionType: 'download_perf',
        downloadTimeMs: durationMs,
        shareToken: this.shareToken,
        folderPath: this.currentFolderPath
      });
    }
  }

  private getPageLoadMs(): number | null {
    if (typeof window === 'undefined' || !window.performance) return null;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      if (nav.loadEventEnd > 0) return Math.round(nav.loadEventEnd - nav.startTime);
      if (nav.domContentLoadedEventEnd > 0) return Math.round(nav.domContentLoadedEventEnd - nav.startTime);
      if (nav.responseEnd > 0) return Math.round(nav.responseEnd - nav.startTime);
    }
    const t = (performance as any).timing;
    if (t) {
      if (t.loadEventEnd > 0 && t.navigationStart > 0) return Math.round(t.loadEventEnd - t.navigationStart);
      if (t.domContentLoadedEventEnd > 0 && t.navigationStart > 0) return Math.round(t.domContentLoadedEventEnd - t.navigationStart);
    }
    return null;
  }

  private getNetworkType(): string {
    if (typeof navigator === 'undefined') return 'unknown';
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    return conn?.effectiveType || conn?.type || 'unknown';
  }

  private getScreenRes(): string {
    if (typeof window === 'undefined') return 'unknown';
    const dpr = Math.round((window.devicePixelRatio || 1) * 10) / 10;
    const w = window.screen?.width || window.innerWidth;
    const h = window.screen?.height || window.innerHeight;
    return `${w}x${h}@${dpr}x`;
  }

  private collectCacheStats(): { bytesSaved: number; hits: number; misses: number } {
    if (typeof window === 'undefined' || !window.performance || !performance.getEntriesByType) {
      return { bytesSaved: 0, hits: 0, misses: 0 };
    }
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    if (!entries || entries.length === 0) {
      return { bytesSaved: 0, hits: 0, misses: 0 };
    }
    if (entries.length < this.lastResourceIndex) {
      this.lastResourceIndex = 0;
    }

    let bytesSaved = 0;
    let hits = 0;
    let misses = 0;

    for (let i = this.lastResourceIndex; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;

      const name = entry.name || '';
      const isMedia = name.includes('/api/media') ||
                      name.includes('/api/shares') ||
                      name.includes('/cache/') ||
                      /\.(jpe?g|png|webp|heic|gif|avif|mp4|webm|mov)(\?.*)?$/i.test(name) ||
                      entry.initiatorType === 'img' ||
                      entry.initiatorType === 'video' ||
                      entry.initiatorType === 'image';

      if (!isMedia) continue;

      const transfer = typeof entry.transferSize === 'number' ? entry.transferSize : 0;
      const decoded = typeof entry.decodedBodySize === 'number' && entry.decodedBodySize > 0
        ? entry.decodedBodySize
        : (typeof entry.encodedBodySize === 'number' ? entry.encodedBodySize : 0);

      if (transfer === 0 && decoded > 0) {
        bytesSaved += decoded;
        hits++;
      } else if (transfer > 0 && decoded > 2000 && transfer < 1000) {
        // 304 Not Modified: transferred headers only, body read from local cache
        bytesSaved += Math.max(0, decoded - transfer);
        hits++;
      } else if (transfer === 0 && decoded === 0) {
        // Memory cache where browser hides response body size
        const est = name.includes('thumb') ? 45000 : 150000;
        bytesSaved += est;
        hits++;
      } else if (transfer > 0) {
        misses++;
      }
    }

    this.lastResourceIndex = entries.length;
    return { bytesSaved, hits, misses };
  }

  private checkAndFlushCacheSavings() {
    const cache = this.collectCacheStats();
    if (cache.bytesSaved > 0 || cache.hits > 0 || cache.misses > 0) {
      this.sendBeacon({
        actionType: 'cache_telemetry',
        shareToken: this.shareToken,
        folderPath: this.currentFolderPath,
        cacheBytesSaved: cache.bytesSaved,
        cacheHits: cache.hits,
        cacheMisses: cache.misses
      });
    }
  }

  private scheduleCacheCheck() {
    if (this.cacheCheckTimer) clearTimeout(this.cacheCheckTimer);
    this.cacheCheckTimer = setTimeout(() => {
      this.checkAndFlushCacheSavings();
    }, 3000);
  }

  private flushInitialLoad() {
    const pageLoadMs = this.getPageLoadMs();
    const cache = this.collectCacheStats();
    this.sendBeacon({
      actionType: 'page_load',
      pageLoadMs: pageLoadMs && pageLoadMs > 0 ? pageLoadMs : null,
      shareToken: this.shareToken,
      folderPath: this.currentFolderPath,
      sortMode: this.sortMode,
      viewMode: this.viewMode,
      networkType: this.getNetworkType(),
      screenRes: this.getScreenRes(),
      cacheBytesSaved: cache.bytesSaved > 0 ? cache.bytesSaved : null,
      cacheHits: cache.hits > 0 ? cache.hits : null,
      cacheMisses: cache.misses > 0 ? cache.misses : null
    });
  }

  private flushHeartbeat() {
    this.updateScrollDepth();
    const sessionDurationS = Math.round((Date.now() - this.sessionStartTime) / 1000);
    const cache = this.collectCacheStats();
    this.sendBeacon({
      actionType: 'telemetry_heartbeat',
      shareToken: this.shareToken,
      folderPath: this.currentFolderPath,
      sessionDurationS,
      scrollDepthPct: this.maxScrollDepth,
      networkType: this.getNetworkType(),
      screenRes: this.getScreenRes(),
      cacheBytesSaved: cache.bytesSaved > 0 ? cache.bytesSaved : null,
      cacheHits: cache.hits > 0 ? cache.hits : null,
      cacheMisses: cache.misses > 0 ? cache.misses : null
    });
  }

  private flushSessionEnd() {
    if (this.currentPhotoId) {
      this.endPhotoDwell();
    }
    this.updateScrollDepth();
    const sessionDurationS = Math.round((Date.now() - this.sessionStartTime) / 1000);
    const cache = this.collectCacheStats();
    this.sendBeacon({
      actionType: 'session_end',
      shareToken: this.shareToken,
      folderPath: this.currentFolderPath,
      sessionDurationS,
      scrollDepthPct: this.maxScrollDepth,
      cacheBytesSaved: cache.bytesSaved > 0 ? cache.bytesSaved : null,
      cacheHits: cache.hits > 0 ? cache.hits : null,
      cacheMisses: cache.misses > 0 ? cache.misses : null
    });
  }

  flush(isUnloading: boolean = false) {
    if (isUnloading) {
      this.flushSessionEnd();
    } else {
      this.flushHeartbeat();
    }
  }

  private sendBeacon(data: Record<string, any>) {
    if (typeof window === 'undefined') return;

    const payload = {
      deviceId: getDeviceId(),
      ...data
    };
    const endpoint = `${API_BASE}/api/analytics/telemetry`;
    const body = JSON.stringify(payload);

    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        const queued = navigator.sendBeacon(endpoint, blob);
        if (queued) return;
      }
    } catch {}

    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'include'
      }).catch(() => {});
    } catch {}
  }
}

export const tracker = new AnalyticsTracker();
