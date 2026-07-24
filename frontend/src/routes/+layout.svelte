<script lang="ts">
  import '../app.css';
  import { lowBandwidthMode } from '$lib/stores/settings';
</script>

<svelte:head>
  <title>HelloMyPhotos</title>
</svelte:head>

<header class="nav-header glass-panel">
  <div style="display: flex; gap: 24px; align-items: center;">
    <a href="/" style="text-decoration: none;">
      <h1>HelloMyPhotos</h1>
    </a>
    <a href="/faces" style="color: var(--text-color); text-decoration: none; font-weight: 500;">
      Faces
    </a>
    <a href="/admin" style="color: var(--text-color); text-decoration: none; font-weight: 500;">
      Admin
    </a>
  </div>
  
  <div style="display: flex; align-items: center; gap: 12px;">
    <label style="font-size: 0.875rem; display: flex; align-items: center; gap: 8px; cursor: pointer;">
      <input type="checkbox" bind:checked={$lowBandwidthMode} />
      Low Bandwidth Mode
    </label>
  </div>
</header>

<main style="padding: 0 24px;">
  <slot />
</main>
