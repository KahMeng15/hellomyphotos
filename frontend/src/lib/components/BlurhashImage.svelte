<script lang="ts">
  import { onMount } from 'svelte';
  import { decode } from 'blurhash';

  let { hash, src, alt = '', isVideo = false, onclick }: { hash: string, src: string, alt?: string, isVideo?: boolean, onclick?: (e: MouseEvent) => void } = $props();
  
  let canvas: HTMLCanvasElement | undefined = $state();
  let imgLoaded = $state(false);
  let observer: IntersectionObserver;
  let visible = $state(false);
  let container: HTMLDivElement | undefined = $state();
  
  let aspectRatio = $state(1.5);
  const targetHeight = 250; 

  
  function handleLoad(e: Event) {
    const img = e.target as HTMLImageElement;
    if (img.naturalWidth && img.naturalHeight) {
      aspectRatio = img.naturalWidth / img.naturalHeight;
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

<div class="grid-item" style="flex-grow: {aspectRatio}; flex-basis: {targetHeight * aspectRatio}px;" {onclick}>
  <div bind:this={container} class="image-container">
    <canvas bind:this={canvas} width="32" height="32" class:loaded={imgLoaded}></canvas>
    {#if visible}
      <img {src} {alt} loading="lazy" onload={handleLoad} class:loaded={imgLoaded} />
    {/if}
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
    border-radius: 0;
    overflow: hidden;
    cursor: pointer;
    position: relative;
    box-shadow: none;
    transition: filter 0.2s ease;
    display: block;
    height: 100%;
  }

  .grid-item:hover {
    filter: brightness(1.1);
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
    height: auto;
    width: 100%;
    object-fit: contain;
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
