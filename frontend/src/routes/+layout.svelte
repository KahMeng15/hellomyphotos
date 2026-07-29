<script lang="ts">
  import '../app.css';
  import { slide, fly } from 'svelte/transition';
  import { onMount } from 'svelte';
  import { page, navigating } from '$app/stores';
  import { goto, afterNavigate } from '$app/navigation';
  import { logout } from '$lib/api/auth';
  import { currentUser, loadAuthUser } from '$lib/stores/auth';
  import { LogOut } from '@lucide/svelte';
  import { frontendLogger } from '$lib/utils/frontendLogger';

  let prevRoute = $state('');
  afterNavigate((nav) => {
    if (nav.to?.url.pathname !== prevRoute) {
      prevRoute = nav.to?.url.pathname || '';
      frontendLogger.info(`Navigated to ${prevRoute}`, prevRoute);
    }
  });
  import Toast from '$lib/components/Toast.svelte';
  
  let isSidebarOpen = $state(!$page.url.pathname.startsWith('/share/') && $page.url.pathname !== '/login');
  let isAuthChecking = $state(true);
  let searchQuery = $state('');

  $effect(() => {
    if ($page.url.pathname.startsWith('/share/') || $page.url.pathname === '/login') {
      isSidebarOpen = false;
    }
  });

  let canGoForward = $state(false);
  let canGoBack = $state(true);

  onMount(() => {
    window.addEventListener('error', (e) => {
      frontendLogger.error(`Uncaught error: ${e.message}`, $page.url.pathname);
    });
    window.addEventListener('unhandledrejection', (e) => {
      frontendLogger.error(`Unhandled rejection: ${e.reason}`, $page.url.pathname);
    });

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
    try {
      const user = await loadAuthUser();
      if (!user && !$page.url.pathname.startsWith('/share/') && $page.url.pathname !== '/login') {
        goto('/login');
      }
    } catch (err) {
      if (!$page.url.pathname.startsWith('/share/') && $page.url.pathname !== '/login') {
        goto('/login');
      }
    }
    isAuthChecking = false;
  });

  // Scroll position restoration for back/forward navigation
  const scrollPositions = new Map<string, number>();
  let isPopState = false;
  let prevScrollPath = $state('');

  onMount(() => {
    const el = document.querySelector('.main-content');
    if (el) {
      el.addEventListener('scroll', () => {
        const key = $page.url.pathname;
        scrollPositions.set(key, el.scrollTop);
        try { sessionStorage.setItem(`scroll:${key}`, String(el.scrollTop)); } catch {}
      }, { passive: true });
    }
    window.addEventListener('popstate', () => {
      isPopState = true;
    });
    prevScrollPath = $page.url.pathname;
  });

  $effect.pre(() => {
    const path = $page.url.pathname;
    if (prevScrollPath && path !== prevScrollPath) {
      const el = document.querySelector('.main-content');
      if (el) {
        scrollPositions.set(prevScrollPath, el.scrollTop);
        try { sessionStorage.setItem(`scroll:${prevScrollPath}`, String(el.scrollTop)); } catch {}
      }
    }
  });

  $effect(() => {
    const path = $page.url.pathname;
    if (prevScrollPath && path !== prevScrollPath) {
      if (isPopState) {
        let saved = scrollPositions.get(path);
        if (saved === undefined) {
          try { const v = sessionStorage.getItem(`scroll:${path}`); saved = v !== null ? Number(v) : undefined; } catch {}
        }
        if (saved !== undefined) {
          requestAnimationFrame(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = saved;
          });
        }
      } else {
        requestAnimationFrame(() => {
          const el = document.querySelector('.main-content');
          if (el) el.scrollTop = 0;
        });
      }
      isPopState = false;
    }
    prevScrollPath = path;
  });

  async function handleLogout() {
    currentUser.set(null);
    await logout();
    goto('/login');
  }

  function goBack() {
    window.history.back();
  }

  function goForward() {
    window.history.forward();
  }

  function handleSearch(e: KeyboardEvent) {
    if (e.key === 'Enter' && searchQuery.trim()) {
      goto(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
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
      </div>
      
      {#if $currentUser}
        <div class="search-container">
          <input 
            type="text" 
            placeholder="Smart Search..." 
            bind:value={searchQuery}
            onkeydown={handleSearch}
            class="search-input"
          />
        </div>
      {/if}

      <nav class="sidebar-nav">
        {#if $currentUser}
          <a href="/folder">Photos</a>
          <a href="/people">People</a>
          <a href="/timeline">Timeline</a>
          <a href="/settings">Settings</a>
          {#if $currentUser?.role === 'admin' || $currentUser?.role === 'super_admin'}
            <a href="/admin">Admin</a>
          {/if}
        {:else}
          <a href="/login">Login</a>
        {/if}
      </nav>

      <div class="sidebar-footer">
        <button class="icon-btn hide-sidebar-btn" onclick={() => isSidebarOpen = false} title="Hide sidebar" style="margin-bottom: 1rem; width: 100%; display: flex; justify-content: flex-end; border: none; background: transparent; cursor: pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #a1a1aa;"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>
        </button>

        {#if $currentUser}
          <div class="user-info">
            <span class="user-name" title={$currentUser.name}>{$currentUser.name || 'Unknown'}</span>
            <button class="icon-btn logout-btn" onclick={handleLogout} title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        {/if}
      </div>
    </aside>
  {/if}

  <main class="main-content {$page.url.pathname === '/login' ? 'no-padding' : ''}">
    {#if $navigating}
      <div class="nav-loading-bar"></div>
    {/if}
    {#if $navigating && $navigating.to?.route.id?.startsWith('/folder')}
      <div class="nav-skeleton">
        <div class="nav-skeleton-header"></div>
        <div class="nav-skeleton-grid">
          {#each Array(24) as _}
            <div class="nav-skeleton-item"><div class="nav-skeleton-shimmer"></div></div>
          {/each}
        </div>
      </div>
    {/if}
    {#if isAuthChecking && !$page.url.pathname.startsWith('/share/') && $page.url.pathname !== '/login'}
      <div class="loading-overlay">
        <div class="spinner"></div>
      </div>
    {:else}
      <div class="slot-wrapper">
        <slot />
      </div>
    {/if}
    {#if $page.url.pathname !== '/login' && !$page.url.pathname.startsWith('/admin')}
      {#key $page.url.pathname}
        <footer class="app-footer {$page.url.pathname.startsWith('/folder') || $page.url.pathname.startsWith('/share') ? 'animate-footer' : ''}">
          <p>
            {#if $page.url.pathname.startsWith('/share/')}
              Shared with hellomyphotos, a webapp by <a href="https://kahmeng15.github.io" target="_blank" rel="noopener noreferrer">kahmeng</a>
            {:else}
              Hosted with hellomyphotos, a webapp by <a href="https://kahmeng15.github.io" target="_blank" rel="noopener noreferrer">kahmeng</a>
            {/if}
          </p>
          <p>Learn more about this app at <a href="https://kahmeng15.github.io/hellomyphotos" target="_blank" rel="noopener noreferrer">kahmeng15.github.io/hellomyphotos</a></p>
          <p>Got any feedback? Please submit <a href="https://kahmeng15.github.io/feedback" target="_blank" rel="noopener noreferrer">here</a>.</p>
        </footer>
      {/key}
    {/if}
  </main>

  {#if !isSidebarOpen && $page.url.pathname !== '/login'}
    <button class="floating-reopen-btn" transition:fly={{ x: -20, duration: 300, delay: 150 }} onclick={() => isSidebarOpen = true} title="Open sidebar">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 17 5-5-5-5"/><path d="m6 17 5-5-5-5"/></svg>
    </button>
  {/if}

  <Toast />
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
    position: relative;
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
  
  .search-container {
    margin-bottom: 24px;
  }
  
  .search-input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid var(--glass-border);
    color: #e4e4e7;
    font-size: 0.9rem;
    box-sizing: border-box;
  }
  
  .search-input:focus {
    outline: none;
    border-color: var(--accent-color);
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
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(255,255,255,0.1);
  }

  .user-name {
    font-size: 0.85rem;
    font-weight: 500;
    color: #e4e4e7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .logout-btn {
    color: #a1a1aa;
    padding: 0.4rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .logout-btn:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
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
    left: 2rem;
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

  @keyframes fadeInFooter {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 0.7; transform: translateY(0); }
  }

  .app-footer.animate-footer {
    animation: fadeInFooter 0.4s ease both;
    animation-delay: 0.2s;
  }

  .nav-loading-bar {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 2px;
    background: linear-gradient(90deg, transparent 0%, var(--accent-color, #6366f1) 50%, transparent 100%);
    animation: navBarSlide 1s ease infinite;
    z-index: 200;
  }

  @keyframes navBarSlide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  .nav-skeleton {
    position: absolute;
    inset: 0;
    z-index: 100;
    background: var(--bg-color, #000);
    padding: 24px;
  }

  .nav-skeleton-header {
    height: 40vh;
    margin: -24px -24px 0 -24px;
    background: #111;
  }

  .nav-skeleton-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    padding-top: 96px;
  }

  .nav-skeleton-item {
    flex: 1 0 200px;
    height: 200px;
    background: #0a0a0a;
    position: relative;
    overflow: hidden;
  }

  .nav-skeleton-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.04) 50%, transparent 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
