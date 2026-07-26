<script module lang="ts">
  let loadQueue: (() => void)[] = [];
  let isProcessingQueue = false;

  function processQueue() {
    if (loadQueue.length === 0) {
      isProcessingQueue = false;
      return;
    }
    isProcessingQueue = true;
    
    // Process up to 4 images at a time (approx 1 row) to create a cascading effect
    const batch = loadQueue.splice(0, 4);
    batch.forEach(fn => fn());
    
    // Wait slightly before loading the next row
    setTimeout(processQueue, 100);
  }

  function enqueueLoad(fn: () => void) {
    loadQueue.push(fn);
    if (!isProcessingQueue) {
      processQueue();
    }
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { decode } from 'blurhash';
  import { Play } from '@lucide/svelte';

  let { hash, src, alt = '', isVideo = false, objectFit = 'contain', faceBox, square = false, targetHeight = 250, priority = false, onclick, initialAspectRatio }: { hash: string, src: string, alt?: string, isVideo?: boolean, objectFit?: 'contain' | 'cover', faceBox?: {x1: number, y1: number, x2: number, y2: number}, square?: boolean, targetHeight?: number, priority?: boolean, onclick?: (e: MouseEvent) => void, initialAspectRatio?: number } = $props();
  
  let canvas: HTMLCanvasElement | undefined = $state();
  let imgLoaded = $state(false);
  let observer: IntersectionObserver;
  let visible = $state(priority); // If priority, it is visible immediately during SSR
  let container: HTMLDivElement | undefined = $state();
  
  let aspectRatio = $state(initialAspectRatio ?? 1.5);
  
  let objectPosition = $state('center');
  let transformScale = $state(1);

  // Randomize the start of the shimmer animation so they don't all pulse in sync
  let randomDelay = Math.random() * 1.5;

  
  function handleLoad(e: Event) {
    const img = e.target as HTMLImageElement;
    if (img.naturalWidth && img.naturalHeight) {
      aspectRatio = img.naturalWidth / img.naturalHeight;
      if (faceBox) {
        const cx = (faceBox.x1 + faceBox.x2) / 2;
        const cy = (faceBox.y1 + faceBox.y2) / 2;
        const px = Math.max(0, Math.min(100, (cx / img.naturalWidth) * 100));
        const py = Math.max(0, Math.min(100, (cy / img.naturalHeight) * 100));
        objectPosition = `${px}% ${py}%`;

        // Calculate dynamic zoom to make the face fill ~40% of the container (reduced by 50%)
        const faceWidth = faceBox.x2 - faceBox.x1;
        const faceHeight = faceBox.y2 - faceBox.y1;
        const maxFaceDim = Math.max(faceWidth, faceHeight, 1);
        const minImgDim = Math.min(img.naturalWidth, img.naturalHeight);
        
        // Clamp scale between 1 and 15 to avoid extreme zooming artifacts on tiny faces
        transformScale = Math.max(1, Math.min(15, (minImgDim / maxFaceDim) * 0.4));
      }
    }
    imgLoaded = true;
  }

  $effect(() => {
    // Decode blurhash only when visible
    if (visible && hash && canvas) {
      try {
        const pixels = decode(hash, 32, 32);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const imageData = ctx.createImageData(32, 32);
          imageData.data.set(pixels);
          ctx.putImageData(imageData, 0, 0);
        }
      } catch (err) {
        console.error('Blurhash decode failed', err);
      }
    }
  });

  onMount(() => {

    // Lazy load image using Intersection Observer ONLY if it's not a priority image
    if (!priority) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          enqueueLoad(() => {
            visible = true;
          });
          observer.disconnect();
        }
      }, { rootMargin: '100px' });
      
      if (container) {
        observer.observe(container);
      }
    }

    return () => {
      if (observer) observer.disconnect();
    };
  });
</script>

<div class="grid-item {square ? 'is-square' : ''}" style="{!square ? `flex-grow: ${aspectRatio}; flex-basis: ${targetHeight * aspectRatio}px;` : ''}" {onclick}>
  <div bind:this={container} class="image-container" style="height: {objectFit === 'cover' ? '100%' : 'auto'}; aspect-ratio: {aspectRatio};">
    <div class="zoom-wrapper skeleton" style="animation-delay: -{randomDelay}s;">
      {#if visible}
        <canvas bind:this={canvas} width="32" height="32" class:loaded={imgLoaded}></canvas>
        <img {src} {alt} onload={handleLoad} fetchpriority={priority ? "high" : "auto"} loading={priority ? "eager" : "lazy"} class:loaded={imgLoaded} style="object-fit: {objectFit}; height: {objectFit === 'cover' ? '100%' : 'auto'}; object-position: {objectPosition}; {faceBox ? `transform: scale(${transformScale});` : ''}" />
      {/if}
    </div>
  </div>
  {#if isVideo}
    <div class="video-indicator">
      <Play size={16} fill="white" />
    </div>
  {/if}
</div>

<style>
  .grid-item {
    cursor: pointer;
    overflow: hidden;
    position: relative;
    border-radius: 0;
    /* transition: transform ... was here */
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
    border-radius: 0;
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
    background: #111;
    border-radius: 0;
    line-height: 0;
  }

  .zoom-wrapper {
    width: 100%;
    height: 100%;
    transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  .skeleton {
    background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
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
