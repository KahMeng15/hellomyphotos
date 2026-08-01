

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
  
  let objectPosition = $state('50% 50%');
  let transformString: string | undefined = $state();

  // Randomize the start of the shimmer animation so they don't all pulse in sync
  let randomDelay = Math.random() * 1.5;

  
  function handleLoad(e: Event) {
    const img = e.target as HTMLImageElement;
    if (img.naturalWidth && img.naturalHeight) {
      aspectRatio = img.naturalWidth / img.naturalHeight;
      if (faceBox) {
        const cx = (faceBox.x1 + faceBox.x2) / 2;
        const cy = (faceBox.y1 + faceBox.y2) / 2;
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        const relX = cx / imgW;
        const relY = cy / imgH;
        const faceW = faceBox.x2 - faceBox.x1;
        const faceH = faceBox.y2 - faceBox.y1;
        const maxFaceDim = Math.max(faceW, faceH, 1);
        const minDim = Math.min(imgW, imgH);

        const N = Math.max(1, Math.min(15, 0.4 * minDim / maxFaceDim));

        const tx = -(relX - 0.5) * imgW / minDim * 100;
        const ty = -(relY - 0.5) * imgH / minDim * 100;

        objectPosition = '50% 50%';
        transformString = `scale(${N}) translate(${tx}%, ${ty}%)`;
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
          visible = true;
          observer.disconnect();
        }
      }, { rootMargin: '800px' });
      
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
  <div bind:this={container} class="image-container" style="height: {objectFit === 'cover' ? '100%' : 'auto'}; aspect-ratio: {objectFit === 'cover' ? (square ? 1 : aspectRatio) : aspectRatio};">
    <div class="zoom-wrapper skeleton" style="animation-delay: -{randomDelay}s;">
      {#if visible}
        <canvas bind:this={canvas} width="32" height="32" class:loaded={imgLoaded}></canvas>
        <img {src} {alt} onload={handleLoad} fetchpriority={priority ? "high" : "auto"} loading={priority ? "eager" : "lazy"} class:loaded={imgLoaded} style="object-fit: {objectFit}; height: {objectFit === 'cover' ? '100%' : 'auto'}; object-position: {objectPosition}; {faceBox && transformString ? `transform: ${transformString};` : ''}" />
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
