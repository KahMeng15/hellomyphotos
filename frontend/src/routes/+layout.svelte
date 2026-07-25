<script lang="ts">
  import '../app.css';
  import { slide, fly } from 'svelte/transition';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getAuthUser, logout } from '$lib/api/auth';
  
  let isSidebarOpen = $state(!$page.url.pathname.startsWith('/share/') && $page.url.pathname !== '/login');
  let currentUser = $state<any>(null);
  let isAuthChecking = $state(true);

  $effect(() => {
    if ($page.url.pathname.startsWith('/share/') || $page.url.pathname === '/login') {
      isSidebarOpen = false;
    }
  });

  let canGoForward = $state(false);
  let canGoBack = $state(true);

  onMount(() => {
    const checkHistory = () => {
      if ('navigation' in window) {
        canGoForward = (window as any).navigation.canGoForward;
        canGoBack = (window as any).navigation.canGoBack;
      } else {
        canGoBack = (window as any).history.length > 1;
        canGoForward = true; // Fallback for browsers without Navigation API
      }
    };
    
    checkHistory();
    
    if ('navigation' in window) {
      (window as any).navigation.addEventListener('currententrychange', checkHistory);
      return () => {
        (window as any).navigation.removeEventListener('currententrychange', checkHistory);
      };
    } else {
      (window as any).addEventListener('popstate', checkHistory);
      return () => {
        (window as any).removeEventListener('popstate', checkHistory);
      };
    }
  });

  onMount(async () => {
    // Check auth
    if (!$page.url.pathname.startsWith('/share/') && $page.url.pathname !== '/login') {
      try {
        const user = await getAuthUser();
        if (!user) {
          goto('/login');
        } else {
          currentUser = user;
        }
      } catch (err) {
        goto('/login');
      }
    }
    isAuthChecking = false;
  });

  async function handleLogout() {
    await logout();
    goto('/login');
  }

  function goBack() {
    window.history.back();
  }

  function goForward() {
    window.history.forward();
  }
</script>

<svelte:head>
  <title>HelloMyPhotos</title>
</svelte:head>

<div class="app-layout">
  {#if isSidebarOpen}
    <aside class="sidebar" transition:slide={{ axis: 'x', duration: 300 }}>
      <div class="sidebar-header">
        <a href="/" style="text-decoration: none;">
          <h1>HelloMyPhotos</h1>
        </a>
        <div class="nav-actions">
          <button class="icon-btn" onclick={goBack} title="Go back" disabled={!canGoBack}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button class="icon-btn" onclick={goForward} title="Go forward" disabled={!canGoForward}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
      </div>
      
      <nav class="sidebar-nav">
        <a href="/folder">Photos</a>
        <a href="/faces">Faces</a>
        <a href="/timeline">Timeline</a>
        <a href="/settings">Settings</a>
        {#if currentUser?.role === 'admin'}
          <a href="/admin">Admin</a>
        {/if}
      </nav>

      <div class="sidebar-footer">
        {#if currentUser}
          <div class="user-info">
            <span class="user-email">{currentUser.email}</span>
            <button class="logout-btn" onclick={handleLogout}>Logout</button>
          </div>
        {/if}
        <button class="icon-btn hide-sidebar-btn" onclick={() => isSidebarOpen = false} title="Hide sidebar">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>
        </button>
      </div>
    </aside>
  {/if}

  <main class="main-content {$page.url.pathname === '/login' ? 'no-padding' : ''}">
    {#if isAuthChecking && !$page.url.pathname.startsWith('/share/') && $page.url.pathname !== '/login'}
      <div class="loading-overlay">
        <div class="spinner"></div>
      </div>
    {:else}
      <div class="slot-wrapper">
        <slot />
      </div>
    {/if}
    {#if $page.url.pathname !== '/login'}
      <footer class="app-footer">
        <p>Shared with hellomyphotos, a webapp by <a href="https://kahmeng15.github.io" target="_blank" rel="noopener noreferrer">kahmeng</a></p>
        <p>Learn more about this app at <a href="https://kahmeng15.github.io/hellomyphotos" target="_blank" rel="noopener noreferrer">kahmeng15.github.io/hellomyphotos</a></p>
      </footer>
    {/if}
  </main>

  {#if !isSidebarOpen && $page.url.pathname !== '/login' && !$page.url.pathname.startsWith('/share/')}
    <button class="floating-reopen-btn" transition:fly={{ x: -20, duration: 300, delay: 150 }} onclick={() => isSidebarOpen = true} title="Open sidebar">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 17 5-5-5-5"/><path d="m6 17 5-5-5-5"/></svg>
    </button>
  {/if}
</div>

<style>
  .app-layout {
    display: flex;
    min-height: 100vh;
    width: 100vw;
    overflow: hidden;
    position: relative;
  }
  
  .main-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }

  .main-content.no-padding {
    padding: 0;
  }

  .slot-wrapper {
    flex: 1 0 auto;
    width: 100%;
    display: flex;
    flex-direction: column;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .sidebar-header h1 {
    font-size: 1.25rem;
    color: var(--text-color);
    margin: 0;
  }
  
  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  
  .sidebar-nav a {
    color: var(--text-color);
    text-decoration: none;
    font-size: 0.95rem;
    font-weight: 500;
  }
  
  .user-info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .user-email {
    font-size: 0.8rem;
    color: #a1a1aa;
    word-break: break-all;
  }

  .logout-btn {
    background: rgba(255,255,255,0.1);
    border: none;
    color: #fff;
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .logout-btn:hover {
    background: rgba(239, 68, 68, 0.4);
  }

  .sidebar-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
  }

  .nav-actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--text-color);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s, opacity 0.2s;
  }

  .icon-btn:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .floating-reopen-btn {
    position: absolute;
    bottom: 2rem;
    right: 2rem;
    background: var(--bg-color);
    border: 1px solid var(--glass-border);
    color: var(--text-color);
    border-radius: 50%;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 100;
    transition: transform 0.2s, background-color 0.2s;
  }

  .floating-reopen-btn:hover {
    transform: scale(1.05);
    background-color: rgba(255, 255, 255, 0.05);
  }

  .app-footer {
    margin-top: auto;
    padding-top: 64px;
    padding-bottom: 24px;
    text-align: center;
    color: var(--text-color);
    opacity: 0.7;
    font-size: 0.875rem;
  }

  .app-footer p {
    margin: 4px 0;
  }

  .app-footer a {
    color: var(--text-color);
    text-decoration: underline;
    font-weight: 500;
    transition: opacity 0.2s;
  }

  .app-footer a:hover {
    opacity: 0.7;
  }
</style>
