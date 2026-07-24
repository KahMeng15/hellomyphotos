<script lang="ts">
  import { onMount } from 'svelte';
  import { decode } from 'blurhash';

  let { hash, src, alt = '', isVideo = false, objectFit = 'contain', faceBox, square = false, onclick }: { hash: string, src: string, alt?: string, isVideo?: boolean, objectFit?: 'contain' | 'cover', faceBox?: {x1: number, y1: number, x2: number, y2: number}, square?: boolean, onclick?: (e: MouseEvent) => void } = $props();
  
  let canvas: HTMLCanvasElement | undefined = $state();
  let imgLoaded = $state(false);
  let observer: IntersectionObserver;
  let visible = $state(false);
  let container: HTMLDivElement | undefined = $state();
  
  let aspectRatio = $state(1.5);
  const targetHeight = 250;
  
  let objectPosition = $state('center');
  let transformScale = $state(1);

  
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

  onMount(() => {
    // Render blurhash
    if (hash && canvas) {
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

    // Lazy load image using Intersection Observer
    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        visible = true;
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    
    if (container) {
      observer.observe(container);
    }

    return () => {
      if (observer) observer.disconnect();
    };
  });
</script>

<div class="grid-item" style="{square ? 'aspect-ratio: 1; flex-grow: 1; flex-basis: auto;' : `flex-grow: ${aspectRatio}; flex-basis: ${targetHeight * aspectRatio}px;`}" {onclick}>
  <div bind:this={container} class="image-container" style="height: {objectFit === 'cover' ? '100%' : 'auto'};">
    <div class="zoom-wrapper">
      <canvas bind:this={canvas} width="32" height="32" class:loaded={imgLoaded}></canvas>
      {#if visible}
        <img {src} {alt} loading="lazy" onload={handleLoad} class:loaded={imgLoaded} style="object-fit: {objectFit}; height: {objectFit === 'cover' ? '100%' : 'auto'}; object-position: {objectPosition}; {faceBox ? `transform: scale(${transformScale});` : ''}" />
      {/if}
    </div>
  </div>
  {#if isVideo}
    <div class="video-indicator">
      <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
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
    z-index: 2;
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
