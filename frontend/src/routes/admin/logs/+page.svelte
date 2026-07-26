<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { ChevronLeft, Terminal, ShieldAlert, Info, AlertTriangle, AlertCircle } from '@lucide/svelte';

  let logs = $state<any[]>([]);
  let loading = $state(true);
  let filterLevel = $state('all');

  async function fetchLogs() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/logs`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        logs = data.logs || [];
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    fetchLogs();
  });

  function getLevelIcon(level: string) {
    switch (level.toLowerCase()) {
      case 'error': return AlertCircle;
      case 'warn': return AlertTriangle;
      case 'security': return ShieldAlert;
      default: return Info;
    }
  }
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
    
    <select class="filter-dropdown" bind:value={filterLevel}>
      <option value="all">All Levels</option>
      <option value="info">Info</option>
      <option value="warn">Warning</option>
      <option value="error">Error</option>
      <option value="security">Security Audit</option>
    </select>
  </div>

  <div class="terminal-window">
    <div class="terminal-header">
      <div class="dots"><span></span><span></span><span></span></div>
      <div class="title"><Terminal size={14} /> stdout/postgres</div>
    </div>
    <div class="terminal-body">
      {#if loading}
        <div class="line muted">Loading logs from database...</div>
      {:else if logs.length === 0}
        <div class="line muted">No system logs recorded yet.</div>
      {:else}
        {#each logs.filter(l => filterLevel === 'all' || l.level.toLowerCase() === filterLevel) as log}
          <div class="line">
            <span class="timestamp">[{new Date(log.created_at).toLocaleString()}]</span>
            <span class="level {log.level.toLowerCase()}">{log.level.toUpperCase()}</span>
            {#if log.user_email}
              <span class="user">({log.user_email})</span>
            {/if}
            {#if log.ip_address}
              <span class="ip">[{log.ip_address}]</span>
            {/if}
            <span class="message">{log.message}</span>
          </div>
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
  
  .timestamp { color: #52525b; margin-right: 0.5rem; }
  .level { font-weight: bold; margin-right: 0.5rem; }
  .level.info { color: #3b82f6; }
  .level.warn { color: #f59e0b; }
  .level.error { color: #ef4444; }
  .level.security { color: #a855f7; }
  .user { color: #10b981; margin-right: 0.5rem; }
  .ip { color: #8b5cf6; margin-right: 0.5rem; }
  .message { color: #e4e4e7; }
  
  .muted { color: #71717a; font-style: italic; }
</style>
