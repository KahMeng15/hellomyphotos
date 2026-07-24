<script lang="ts">
  import '../app.css';
</script>

<svelte:head>
  <title>HelloMyPhotos</title>
</svelte:head>

<div class="app-layout">
  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="/" style="text-decoration: none;">
        <h1>HelloMyPhotos</h1>
      </a>
    </div>
    
    <nav class="sidebar-nav">
      <a href="/">Photos</a>
      <a href="/faces">Faces</a>
      <a href="/timeline">Timeline</a>
      <a href="/settings">Settings</a>
      <a href="/admin">Admin</a>
    </nav>
  </aside>

  <main class="main-content">
    <slot />
  </main>
</div>

<style>
  .app-layout {
    display: flex;
    min-height: 100vh;
    width: 100vw;
    overflow: hidden;
  }
  
  .main-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    height: 100vh;
  }
  
  .sidebar {
    width: 250px;
    height: 100vh;
    border-right: 1px solid var(--glass-border);
    background: var(--bg-color);
    display: flex;
    flex-direction: column;
    padding: 24px;
    flex-shrink: 0;
  }
  
  .sidebar-header {
    margin-bottom: 48px;
  }
  
  .sidebar-header h1 {
    font-size: 1.25rem;
    color: var(--text-color);
  }
  
  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  
  .sidebar-nav a {
    color: var(--text-color);
    text-decoration: none;
    font-size: 1rem;
    font-weight: 400;
    font-family: 'Instrument Sans', sans-serif;
    transition: opacity 0.2s;
  }
  
  .sidebar-nav a:hover {
    opacity: 0.7;
  }
</style>
