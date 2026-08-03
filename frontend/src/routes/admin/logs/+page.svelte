<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { ChevronLeft, Terminal, Server, Globe, KeyRound, Settings, Cpu } from '@lucide/svelte';

  let logs = $state<string[]>([]);
  let archives = $state<string[]>([]);
  let currentArchive = $state('');
  let loading = $state(true);
  let error = $state('');

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

  onMount(() => {
    fetchLogs();
  });

  let filteredLogs = $derived(
    activeCategories.includes('all')
      ? logs
      : logs.filter(l => activeCategories.includes(matchCategory(l)))
  );
</script>

<div class="admin-container">
  <div class="header">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a href="/admin" title="Back to Admin Dashboard" style="display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; color: rgba(255,255,255,0.4); text-decoration: none; transition: color 0.2s, transform 0.2s;" onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }} onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}>
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>System Logs & Auditing</h2>
        <p>Live event streaming and historical action records.</p>
      </div>
    </div>
    
    <div style="display: flex; gap: 8px; align-items: center;">
      <div class="category-filters">
        {#each categories as cat}
          <button
            class="cat-btn"
            class:active={activeCategories.includes(cat.id)}
            onclick={() => toggleCategory(cat.id)}
          >
            <cat.icon size={14} strokeWidth={2.5} />
            {cat.label}
          </button>
        {/each}
      </div>
      {#if archives.length > 0}
        <select class="filter-dropdown" bind:value={currentArchive} onchange={(e) => fetchLogs((e.target as HTMLSelectElement).value)}>
          <option value="">latest.log</option>
          {#each archives as arch}
            <option value={arch}>{arch}</option>
          {/each}
        </select>
      {/if}
    </div>
  </div>

  <div class="terminal-window">
    <div class="terminal-header">
      <div class="dots"><span></span><span></span><span></span></div>
      <div class="title"><Terminal size={14} /> {currentArchive || 'latest.log'}</div>
    </div>
    <div class="terminal-body">
      {#if loading}
        <div class="line muted">Loading logs...</div>
      {:else if error}
        <div class="line muted" style="color: #ef4444;">Error: {error}</div>
      {:else if filteredLogs.length === 0}
        <div class="line muted">No logs match the current filter.</div>
      {:else}
        {#each filteredLogs as line}
          <div class="line">{@html highlightLine(line)}</div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .admin-container { width: 100%; color: #f4f4f5; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 2rem;
  }

  h2 { font-size: 2rem; margin: 0 0 0.5rem 0; }
  p { color: #a1a1aa; margin: 0; }

  .category-filters {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .cat-btn {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.5);
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 5px;
    transition: all 0.15s;
  }
  .cat-btn:hover { border-color: rgba(255,255,255,0.25); color: white; }
  .cat-btn.active {
    background: rgba(168,85,247,0.15);
    border-color: #a855f7;
    color: #c084fc;
  }
  .filter-dropdown {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 6px;
  }
  .filter-dropdown:focus { outline: none; border-color: #a855f7; }

  .terminal-window {
    background: #09090b;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0,0,0,0.5);
  }
  .terminal-header {
    background: #18181b;
    padding: 0.75rem 1rem;
    display: flex;
    align-items: center;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    position: relative;
  }
  .dots { display: flex; gap: 6px; }
  .dots span { width: 12px; height: 12px; border-radius: 50%; }
  .dots span:nth-child(1) { background: #ef4444; }
  .dots span:nth-child(2) { background: #f59e0b; }
  .dots span:nth-child(3) { background: #10b981; }
  .title {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.8rem;
    color: #a1a1aa;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: monospace;
  }

  .terminal-body {
    padding: 1rem;
    height: 600px;
    overflow-y: auto;
    font-family: 'Fira Code', 'Courier New', Courier, monospace;
    font-size: 0.85rem;
    line-height: 1.6;
  }

  .line {
    padding: 0.25rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.02);
    word-break: break-all;
  }
  .line:hover { background: rgba(255,255,255,0.02); }
  
  :global(.timestamp) { color: #52525b; margin-right: 0.5rem; }
  :global(.level) { font-weight: bold; margin-right: 0.5rem; }
  :global(.level.info) { color: #3b82f6; }
  :global(.level.warn) { color: #f59e0b; }
  :global(.level.error) { color: #ef4444; }
  :global(.level.security) { color: #a855f7; }
  :global(.user) { color: #10b981; margin-right: 0.5rem; }
  
  .muted { color: #71717a; font-style: italic; }

  @media (max-width: 900px) {
    h2 { font-size: 1.5rem; }
    .header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .header > div:last-child {
      flex-wrap: wrap;
      width: 100%;
    }
    .terminal-body { height: 60dvh; }
  }
</style>
