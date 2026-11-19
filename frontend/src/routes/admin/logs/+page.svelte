<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { ChevronLeft, Terminal, Server, Globe, KeyRound, Settings, Cpu, Search, X, ArrowUp, Clock } from '@lucide/svelte';

  let logs = $state<string[]>([]);
  let archives = $state<string[]>([]);
  let currentArchive = $state('');
  let loading = $state(true);
  let error = $state('');
  let searchQuery = $state('');
  let showTime = $state(true);

  let terminalBodyEl: HTMLDivElement | null = $state(null);
  let isScrolledDown = $state(false);

  const categories = [
    { id: 'all', label: 'All', icon: Terminal },
    { id: 'api', label: 'API', icon: Globe },
    { id: 'task', label: 'Tasks', icon: Cpu },
    { id: 'frontend', label: 'Frontend', icon: Server },
    { id: 'auth', label: 'Auth', icon: KeyRound },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'server', label: 'Server', icon: Terminal },
  ];

  let activeCategories = $state<string[]>(['all']);

  function toggleCategory(id: string) {
    if (id === 'all') {
      activeCategories = ['all'];
      return;
    }
    let next = activeCategories.filter(c => c !== 'all');
    if (next.includes(id)) {
      next = next.filter(c => c !== id);
      if (next.length === 0) next = ['all'];
    } else {
      next.push(id);
    }
    activeCategories = next;
  }

  function matchCategory(line: string): string {
    if (/Task (completed|failed):/.test(line)) return 'task';
    if (/^\[Frontend/.test(line)) return 'frontend';
    if (/User logged in|Failed login|logout/i.test(line)) return 'auth';
    if (/Settings updated/.test(line)) return 'settings';
    if (/Server (starting|started)/.test(line)) return 'server';
    if (/ (GET|POST|PUT|DELETE) \/api\//.test(line)) return 'api';
    return 'api';
  }

  function highlightLine(line: string): string {
    let html = line
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(
      /(\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\])/,
      '<span class="timestamp">$1</span>'
    );
    html = html.replace(
      /\[(INFO|WARN|ERROR|SECURITY)\]/,
      (_m, lvl) => `<span class="level ${lvl.toLowerCase()}">[${lvl}]</span>`
    );
    html = html.replace(
      /\{"userId":"([^"]+)"\}/,
      (_m, uid) => `<span class="user">(user: ${uid})</span>`
    );

    const q = searchQuery.trim();
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(<[^>]*>)|(${escaped})`, 'gi');
      html = html.replace(re, (_m, tag, textMatch) => tag ? tag : `<mark class="search-match">${textMatch}</mark>`);
    }

    return html;
  }

  async function fetchLogs(archive?: string) {
    loading = true;
    error = '';
    try {
      const params = archive ? `?archive=${encodeURIComponent(archive)}` : '';
      const res = await fetch(`${API_BASE}/api/admin/logs${params}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        logs = data.logs || [];
        archives = data.archives || [];
        currentArchive = archive || '';
      } else {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        error = err.error || 'Failed to fetch logs';
      }
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function onTerminalScroll() {
    if (terminalBodyEl) {
      isScrolledDown = terminalBodyEl.scrollTop > 100;
    }
  }

  function scrollToLatest() {
    if (terminalBodyEl) {
      terminalBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function goToLatestLog() {
    if (currentArchive !== '') {
      await fetchLogs('');
    }
    scrollToLatest();
  }

  onMount(() => {
    fetchLogs();
  });

  let filteredLogs = $derived(
    (activeCategories.includes('all')
      ? logs
      : logs.filter(l => activeCategories.includes(matchCategory(l)))
    ).filter(l => !searchQuery.trim() || l.toLowerCase().includes(searchQuery.trim().toLowerCase()))
  );
</script>

<div class="admin-container">
  <div class="header">
    <div class="header-title-group">
      <a
        href="/admin"
        title="Back to Admin Dashboard"
        class="back-btn"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>System Logs & Auditing</h2>
        <p>Live event streaming and historical action records.</p>
      </div>
    </div>
  </div>

  <div class="selection-bar">
    <div class="bar-left">
      <div class="category-filters">
        {#each categories as cat}
          <button
            type="button"
            class="cat-btn"
            class:active={activeCategories.includes(cat.id)}
            onclick={() => toggleCategory(cat.id)}
          >
            <cat.icon size={14} strokeWidth={2.5} />
            <span>{cat.label}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="bar-right">
      <div class="search-box">
        <Search size={15} class="search-icon" />
        <input
          type="text"
          placeholder="Search logs..."
          bind:value={searchQuery}
          class="search-input"
        />
        {#if searchQuery}
          <button
            type="button"
            class="clear-btn"
            onclick={() => (searchQuery = '')}
            title="Clear search"
          >
            <X size={14} />
          </button>
        {/if}
      </div>

      <button
        type="button"
        class="toggle-btn"
        class:active={showTime}
        onclick={() => (showTime = !showTime)}
        title={showTime ? "Hide timestamps" : "Show timestamps"}
      >
        <Clock size={14} strokeWidth={2.5} />
        <span>Time</span>
      </button>

      <button
        type="button"
        class="toggle-latest-btn"
        class:active={!currentArchive}
        onclick={goToLatestLog}
        title={currentArchive ? "Go to latest log" : "Scroll to latest log entry"}
      >
        <ArrowUp size={14} strokeWidth={2.5} />
        <span>Latest Log</span>
      </button>

      {#if archives.length > 0}
        <select
          class="filter-dropdown"
          bind:value={currentArchive}
          onchange={(e) => fetchLogs((e.target as HTMLSelectElement).value)}
        >
          <option value="">latest.log</option>
          {#each archives as arch}
            <option value={arch}>{arch}</option>
          {/each}
        </select>
      {/if}

      {#if searchQuery.trim() || !activeCategories.includes('all')}
        <span class="count-badge">{filteredLogs.length} / {logs.length}</span>
      {/if}
    </div>
  </div>

  <div class="terminal-window">
    <div
      class="terminal-body"
      class:hide-timestamps={!showTime}
      bind:this={terminalBodyEl}
      onscroll={onTerminalScroll}
    >
      {#if loading}
        <div class="line muted">Loading logs...</div>
      {:else if error}
        <div class="line muted" style="color: #ef4444;">Error: {error}</div>
      {:else if filteredLogs.length === 0}
        <div class="line muted">
          {#if searchQuery.trim()}
            No logs match search "{searchQuery.trim()}".
          {:else}
            No logs match the current filter.
          {/if}
        </div>
      {:else}
        {#each filteredLogs as line}
          <div class="line">{@html highlightLine(line)}</div>
        {/each}
      {/if}
    </div>

    {#if isScrolledDown}
      <button
        type="button"
        class="floating-latest-btn"
        onclick={scrollToLatest}
        title="Scroll to latest log"
      >
        <ArrowUp size={14} strokeWidth={2.5} />
        <span>Go to latest</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .admin-container {
    width: 100%;
    color: #f4f4f5;
    display: flex;
    flex-direction: column;
    height: calc(100dvh - 48px);
    box-sizing: border-box;
  }

  .header {
    display: flex;
    align-items: center;
    margin-bottom: 1rem;
    flex-shrink: 0;
  }

  .header-title-group {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    line-height: 0;
    color: rgba(255, 255, 255, 0.4);
    text-decoration: none;
    transition: color 0.2s, transform 0.2s;
  }
  .back-btn:hover {
    color: white;
    transform: scale(1.1);
  }

  h2 {
    font-size: 2rem;
    margin: 0 0 0.25rem 0;
  }
  p {
    color: #a1a1aa;
    margin: 0;
  }

  .selection-bar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    background: rgba(24, 24, 27, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    backdrop-filter: blur(8px);
    flex-shrink: 0;
  }

  .bar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .category-filters {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .cat-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.5);
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 5px;
    transition: all 0.15s;
  }
  .cat-btn:hover {
    border-color: rgba(255, 255, 255, 0.25);
    color: white;
  }
  .cat-btn.active {
    background: rgba(168, 85, 247, 0.15);
    border-color: #a855f7;
    color: #c084fc;
  }

  .bar-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .search-box {
    position: relative;
    display: flex;
    align-items: center;
  }

  :global(.search-icon) {
    position: absolute;
    left: 0.65rem;
    color: #71717a;
    pointer-events: none;
  }

  .search-input {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: white;
    padding: 0.4rem 1.85rem 0.4rem 2.1rem;
    border-radius: 6px;
    font-size: 0.82rem;
    width: 260px;
    transition: all 0.2s ease;
  }
  .search-input:focus {
    outline: none;
    border-color: #a855f7;
    background: rgba(255, 255, 255, 0.08);
    width: 320px;
  }

  .clear-btn {
    position: absolute;
    right: 0.45rem;
    background: transparent;
    border: none;
    color: #71717a;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }
  .clear-btn:hover {
    color: white;
  }

  .toggle-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .toggle-btn:hover {
    border-color: rgba(255, 255, 255, 0.25);
    color: white;
  }
  .toggle-btn.active {
    background: rgba(168, 85, 247, 0.15);
    border-color: #a855f7;
    color: #c084fc;
  }

  .toggle-latest-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .toggle-latest-btn:hover {
    border-color: rgba(255, 255, 255, 0.25);
    color: white;
  }
  .toggle-latest-btn.active {
    background: rgba(16, 185, 129, 0.12);
    border-color: rgba(16, 185, 129, 0.4);
    color: #34d399;
  }

  .filter-dropdown {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: white;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .filter-dropdown:focus {
    outline: none;
    border-color: #a855f7;
  }

  .count-badge {
    font-size: 0.75rem;
    color: #a1a1aa;
    background: rgba(255, 255, 255, 0.05);
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    white-space: nowrap;
  }

  .terminal-window {
    position: relative;
    background: #09090b;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .terminal-body {
    padding: 1.25rem;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    font-family: 'Fira Code', 'Courier New', Courier, monospace;
    font-size: 0.85rem;
    line-height: 1.6;
  }

  :global(.hide-timestamps .timestamp) {
    display: none !important;
  }

  .floating-latest-btn {
    position: absolute;
    bottom: 1.25rem;
    right: 1.5rem;
    background: #18181b;
    border: 1px solid rgba(168, 85, 247, 0.5);
    color: #c084fc;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    padding: 0.45rem 0.85rem;
    border-radius: 20px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s ease;
    z-index: 10;
  }
  .floating-latest-btn:hover {
    background: #27272a;
    border-color: #a855f7;
    transform: translateY(-2px);
  }

  .line {
    padding: 0.25rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.02);
    word-break: break-all;
  }
  .line:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  :global(.timestamp) {
    color: #52525b;
    margin-right: 0.5rem;
  }
  :global(.level) {
    font-weight: bold;
    margin-right: 0.5rem;
  }
  :global(.level.info) {
    color: #3b82f6;
  }
  :global(.level.warn) {
    color: #f59e0b;
  }
  :global(.level.error) {
    color: #ef4444;
  }
  :global(.level.security) {
    color: #a855f7;
  }
  :global(.user) {
    color: #10b981;
    margin-right: 0.5rem;
  }
  :global(.search-match) {
    background: rgba(234, 179, 8, 0.3);
    color: #fef08a;
    padding: 0.05rem 0.2rem;
    border-radius: 3px;
    font-weight: 600;
  }

  .muted {
    color: #71717a;
    font-style: italic;
  }

  @media (max-width: 900px) {
    h2 {
      font-size: 1.5rem;
    }
    .selection-bar {
      flex-direction: column;
      align-items: stretch;
    }
    .bar-right {
      justify-content: flex-start;
    }
    .search-input {
      width: 100%;
    }
    .search-box {
      flex: 1;
    }
  }
</style>
