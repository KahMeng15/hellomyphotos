<script lang="ts">
  import { onMount } from 'svelte';
  import { decode } from 'blurhash';

  let { hash, src, alt = '' }: { hash: string, src: string, alt?: string } = $props();
  
  let canvas: HTMLCanvasElement | undefined = $state();
  let imgLoaded = $state(false);
  let observer: IntersectionObserver;
  let visible = $state(false);
  let container: HTMLDivElement | undefined = $state();

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

<div bind:this={container} class="image-container">
  <canvas bind:this={canvas} width="32" height="32" class:loaded={imgLoaded}></canvas>
  {#if visible}
    <img {src} {alt} loading="lazy" onload={() => imgLoaded = true} class:loaded={imgLoaded} />
  {/if}
</div>

<style>
  .image-container {
    position: relative;
    height: 100%;
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
    height: 100%;
    width: 100%;
    object-fit: cover;
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
