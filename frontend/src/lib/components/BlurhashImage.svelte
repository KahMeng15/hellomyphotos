

<script module lang="ts">
  import { decode } from 'blurhash';

  const blurhashPixelCache = new Map<string, Uint8ClampedArray>();
  let sharedObserver: IntersectionObserver | null = null;
  const observerCallbacks = new Map<Element, () => void>();

  function observeElement(el: Element, cb: () => void) {
    if (typeof window === 'undefined') return () => {};
    if (!sharedObserver) {
      sharedObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const callback = observerCallbacks.get(entry.target);
            if (callback) {
              callback();
              sharedObserver?.unobserve(entry.target);
              observerCallbacks.delete(entry.target);
            }
          }
        }
      }, { rootMargin: '300px' });
    }
    observerCallbacks.set(el, cb);
    sharedObserver.observe(el);

    return () => {
      observerCallbacks.delete(el);
      sharedObserver?.unobserve(el);
    };
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Play, Layers } from '@lucide/svelte';

  let { 
    hash, 
    src, 
    fallbackSrc, 
    alt = '', 
    fileName = '',
    showFileName = false,
    isVideo = false, 
    objectFit = 'contain', 
    faceBox, 
    origWidth, 
    origHeight, 
    square = false, 
    targetHeight = 250, 
    priority = false, 
    onclick, 
    initialAspectRatio,
    isStaged = false,
    burstCount = 0
  }: { 
    hash: string, 
    src: string, 
    fallbackSrc?: string, 
    alt?: string, 
    fileName?: string,
    showFileName?: boolean,
    isVideo?: boolean, 
    objectFit?: 'contain' | 'cover', 
    faceBox?: {x1?: number, y1?: number, x2?: number, y2?: number, x?: number, y?: number, w?: number, h?: number}, 
    origWidth?: number, 
    origHeight?: number, 
    square?: boolean, 
    targetHeight?: number, 
    priority?: boolean, 
    onclick?: (e: MouseEvent) => void, 
    initialAspectRatio?: number,
    isStaged?: boolean,
    burstCount?: number
  } = $props();
  
  let canvas: HTMLCanvasElement | undefined = $state();
  let imgLoaded = $state(false);
  // `visible`: card is scrolled into view — decode blurhash and start loading the image.
  let visible = $state(priority); // If priority, is visible immediately during SSR
  let container: HTMLDivElement | undefined = $state();
  
  let aspectRatio = $state(initialAspectRatio ?? 1.5);
  
  let objectPosition = $state('50% 50%');
  let transformString: string | undefined = $state();

  // Randomize the start of the shimmer animation so they don't all pulse in sync
  let randomDelay = Math.random() * 1.5;

  let retryCount = $state(0);
  const MAX_RETRIES = 10;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;

  function handleLoad(e: Event) {
    const img = e.target as HTMLImageElement;
    if (img.naturalWidth && img.naturalHeight) {
      aspectRatio = img.naturalWidth / img.naturalHeight;
      if (faceBox && (isUsingFallback || !fallbackSrc)) {
        const box = faceBox as any;
        const x1 = box.x1 ?? box.x ?? 0;
        const y1 = box.y1 ?? box.y ?? 0;
        const x2 = box.x2 ?? (x1 + (box.w || 0));
        const y2 = box.y2 ?? (y1 + (box.h || 0));

        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const faceW = Math.max(1, x2 - x1);
        const faceH = Math.max(1, y2 - y1);

        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        const minDim = Math.min(imgW, imgH);

        const origW = origWidth || imgW;
        const origH = origHeight || imgH;

        const relX = cx / origW;
        const relY = cy / origH;
        const relFaceW = faceW / origW;
        const relFaceH = faceH / origH;
        const maxFaceRel = Math.max(relFaceW, relFaceH, 0.01);

        const N = Math.max(1, Math.min(15, 0.4 / maxFaceRel));

        const tx = -(relX - 0.5) * (imgW / minDim) * 100;
        const ty = -(relY - 0.5) * (imgH / minDim) * 100;

        objectPosition = '50% 50%';
        transformString = `scale(${N}) translate(${tx}%, ${ty}%)`;
      }
    }
    imgLoaded = true;
    // Clear any pending retry
    if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = null; }
  }

  function handleError() {
    if (fallbackSrc && !isUsingFallback) {
      isUsingFallback = true;
      retrySrc = fallbackSrc;
      return;
    }
    // Retry for all thumbnails (images or videos) that may still be processing
    if (retryCount < MAX_RETRIES) {
      retryTimeout = setTimeout(() => {
        retryCount += 1;
        // Append/update a retry counter as cache-buster so the browser re-fetches
        const baseUrl = src.split('?')[0];
        const params = new URLSearchParams(src.includes('?') ? src.split('?')[1] : '');
        params.set('_r', String(retryCount));
        // Trigger Svelte reactivity by creating a new string — caller's `src` is a prop,
        // so we track a local override instead.
        retrySrc = `${baseUrl}?${params.toString()}`;
      }, 5000);
    }
  }

  let retrySrc = $state('');
  let isUsingFallback = $state(false);
  let effectiveSrc = $derived(retrySrc || src);

  $effect(() => {
    // Decode blurhash only when visible and not yet loaded
    if (visible && hash && canvas && !imgLoaded) {
      try {
        let pixels = blurhashPixelCache.get(hash);
        if (!pixels) {
          pixels = decode(hash, 16, 16);
          if (blurhashPixelCache.size > 500) {
            const firstKey = blurhashPixelCache.keys().next().value;
            if (firstKey) blurhashPixelCache.delete(firstKey);
          }
          blurhashPixelCache.set(hash, pixels);
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imageData = ctx.createImageData(16, 16);
          imageData.data.set(pixels);
          ctx.putImageData(imageData, 0, 0);
        }
      } catch (err) {
        console.error('Blurhash decode failed', err);
      }
    }
  });

  onMount(() => {
    let unobserve: (() => void) | undefined;
    if (!priority && container) {
      unobserve = observeElement(container, () => {
        visible = true;
      });
    }

    return () => {
      if (unobserve) unobserve();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  });
</script>

<div class="grid-item {square ? 'is-square' : ''}" style="{!square ? `flex-grow: ${aspectRatio}; flex-basis: ${targetHeight * aspectRatio}px;` : ''}" {onclick}>
  <div bind:this={container} class="image-container" style="height: {objectFit === 'cover' ? '100%' : 'auto'}; aspect-ratio: {objectFit === 'cover' ? (square ? 1 : aspectRatio) : aspectRatio};">
    <div class="zoom-wrapper {visible ? '' : 'skeleton'}" style="animation-delay: -{randomDelay}s;">
      {#if visible}
        {#if !imgLoaded}
          <canvas bind:this={canvas} width="16" height="16" style="{faceBox && transformString ? `transform: ${transformString};` : ''}"></canvas>
        {/if}
        <img src={effectiveSrc} {alt} onload={handleLoad} onerror={handleError} fetchpriority={priority ? "high" : "auto"} loading={priority ? "eager" : "lazy"} class:loaded={imgLoaded} style="object-fit: {objectFit}; height: {objectFit === 'cover' ? '100%' : 'auto'}; object-position: {objectPosition}; {faceBox && transformString ? `transform: ${transformString};` : ''}" />
      {/if}
    </div>
  </div>
  {#if isVideo}
    <div class="video-indicator">
      <Play size={16} fill="white" />
    </div>
  {/if}
  {#if burstCount && burstCount > 1}
    <div class="burst-indicator" title="{burstCount} shots in burst stack">
      <Layers size={11} strokeWidth={2.5} />
      <span>{burstCount}</span>
    </div>
  {/if}
  {#if showFileName && (fileName || alt)}
    <div class="file-name {isVideo ? 'with-video' : ''}" title={fileName || alt}>
      <span>{fileName || alt}</span>
    </div>
  {/if}
</div>

<style>
  .burst-indicator {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 5;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #f1f5f9;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 12px;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .grid-item {
    cursor: pointer;
    overflow: hidden;
    position: relative;
    border-radius: 0;
    content-visibility: auto;
    contain-intrinsic-size: 200px 200px;
  }
  
  .grid-item:hover .zoom-wrapper {
    transform: scale(1.05);
  }

  .video-indicator {
    position: absolute;
    bottom: 8px;
    right: 8px;
    background: rgba(0,0,0,0.6);
    border-radius: 50%;
    width: 32px;
    height: 32px;
    display: flex;
    justify-content: center;
    align-items: center;
    color: white;
  }

  .file-name {
    position: absolute;
    bottom: 8px;
    left: 8px;
    max-width: calc(100% - 16px);
    pointer-events: none;
    z-index: 2;
  }

  .file-name.with-video {
    max-width: calc(100% - 48px);
  }

  .file-name span {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.25;
    color: #ffffff;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
    padding: 3px 6px;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    border-radius: 4px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  }

  .grid-item.is-square {
    aspect-ratio: 1;
    width: 100%;
  }

  .image-container {
    position: relative;
    width: 100%;
    display: block;
    overflow: hidden;
    background: #1a1a2e;
    border-radius: 0;
    line-height: 0;
  }

  .zoom-wrapper {
    width: 100%;
    height: 100%;
    transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  .skeleton {
    background: linear-gradient(90deg, rgba(255,255,255,0.08) 25%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.08) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
  
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    filter: blur(10px);
    transform: scale(1.1);
    transition: opacity 0.5s ease;
  }
  
  canvas.loaded {
    opacity: 0;
  }

  img {
    width: 100%;
    opacity: 0;
    transition: opacity 0.3s ease-in;
    border-radius: 0;
    display: block;
    position: relative;
    z-index: 1;
  }

  img.loaded {
    opacity: 1;
  }
</style>
