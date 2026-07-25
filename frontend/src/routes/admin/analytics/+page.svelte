<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { BarChart3, Image as ImageIcon, Video, Eye, Link as LinkIcon } from '@lucide/svelte';

  let data = $state<any>(null);
  let loading = $state(true);

  async function loadAnalytics() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/analytics`, { credentials: 'include' });
      if (res.ok) {
        data = await res.json();
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadAnalytics();
  });

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
</script>

<div class="admin-container">
  <div class="header">
    <div>
      <h2>Global Analytics</h2>
      <p>System-wide media statistics, view counts, and popular shares.</p>
    </div>
  </div>

  {#if loading}
    <div class="spinner"></div>
  {:else if data}
    <!-- KPI Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="icon-wrap bg-blue"><ImageIcon size={24} /></div>
        <div class="stat-info">
          <h4>Total Photos</h4>
          <div class="val">{data.stats.photos.count.toLocaleString()}</div>
          <div class="sub">Using {formatBytes(data.stats.photos.size)}</div>
        </div>
      </div>
      
      <div class="stat-card">
        <div class="icon-wrap bg-purple"><Video size={24} /></div>
        <div class="stat-info">
          <h4>Total Videos</h4>
          <div class="val">{data.stats.videos.count.toLocaleString()}</div>
          <div class="sub">Using {formatBytes(data.stats.videos.size)}</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="icon-wrap bg-emerald"><Eye size={24} /></div>
        <div class="stat-info">
          <h4>Total Media Views</h4>
          <div class="val">{data.stats.visits.toLocaleString()}</div>
          <div class="sub">Across all users & public shares</div>
        </div>
      </div>
    </div>

    <div class="tables-grid">
      <!-- Top Shared Links -->
      <div class="card">
        <h3><LinkIcon size={18} /> Most Visited Shared Links</h3>
        {#if data.topShares.length === 0}
          <p class="muted">No shared links created yet.</p>
        {:else}
          <table>
            <thead><tr><th>Folder Path</th><th>Views</th></tr></thead>
            <tbody>
              {#each data.topShares as share}
                <tr>
                  <td>{share.folder_path}</td>
                  <td class="text-right"><strong>{share.views}</strong></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Top Media Files -->
      <div class="card">
        <h3><BarChart3 size={18} /> Most Viewed Media</h3>
        {#if data.topMedia.length === 0}
          <p class="muted">No media views recorded yet.</p>
        {:else}
          <table>
            <thead><tr><th>File Name</th><th>Folder</th><th>Views</th></tr></thead>
            <tbody>
              {#each data.topMedia as media}
                <tr>
                  <td class="truncate" title={media.file_name}>{media.file_name}</td>
                  <td class="muted">{media.folder_path}</td>
                  <td class="text-right"><strong>{media.views}</strong></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .admin-container { width: 100%; color: #f4f4f5; }
  .header { margin-bottom: 2rem; }
  h2 { font-size: 2rem; margin: 0 0 0.5rem 0; }
  p { color: #a1a1aa; margin: 0; }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  .stat-card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 1.5rem;
    display: flex;
    align-items: center;
    gap: 1.25rem;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  }
  .icon-wrap { width: 56px; height: 56px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
  .bg-blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
  .bg-purple { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
  .bg-emerald { background: rgba(16, 185, 129, 0.15); color: #34d399; }
  
  .stat-info h4 { margin: 0 0 0.25rem 0; color: #a1a1aa; font-weight: 500; font-size: 0.9rem; }
  .val { font-size: 2rem; font-weight: 700; line-height: 1; margin-bottom: 0.25rem; }
  .sub { font-size: 0.8rem; color: #71717a; }

  .tables-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }

  .card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 1.5rem;
  }
  .card h3 { margin: 0 0 1.5rem 0; display: flex; align-items: center; gap: 0.5rem; font-size: 1.1rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { text-align: left; padding: 0.75rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); color: #a1a1aa; font-weight: 500; }
  td { padding: 0.75rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .text-right { text-align: right; }
  .muted { color: #71717a; font-size: 0.85rem; }
  .truncate { max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; }

  .spinner {
    border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #a855f7;
    border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 4rem auto;
  }
  @keyframes spin { 100% { transform: rotate(360deg); } }
</style>
