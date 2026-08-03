<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { ChevronRight, ShieldAlert, Shield } from '@lucide/svelte';

  let expiringShares = $state<any[]>([]);

  async function loadExpiringShares() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/expiring-shares`, { credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        expiringShares = d.shares || [];
      }
    } catch {}
  }

  function isExpired(iso: string) {
    return new Date(iso).getTime() < Date.now();
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  onMount(() => {
    loadExpiringShares();
  });
</script>

<div class="admin-container">
  <div class="header">
    <h2>Admin Dashboard</h2>
    <p>Manage system configurations, user access, and background pipelines.</p>
  </div>

  {#if expiringShares.length > 0}
    <div class="card link-card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(245, 158, 11, 0.08)); border-color: rgba(239, 68, 68, 0.3);">
      <a href="/admin/shares" style="text-decoration: none; color: inherit;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h3 style="margin: 0 0 0.5rem 0; color: #f4f4f5; display: flex; align-items: center; gap: 0.5rem;">
              <ShieldAlert size={18} color="#f87171" />
              Share Expiration Alerts
            </h3>
            <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem;">
              {#each expiringShares.slice(0, 4) as share}
                <span style="display: inline-block; margin-right: 1.25rem;">
                  <Shield size={12} style="vertical-align: middle; margin-right: 4px;" color={isExpired(share.expires_at) ? '#f87171' : '#fbbf24'} />
                  <span>{share.folder_path || '(single media)'}</span>
                  {#if isExpired(share.expires_at)}
                    <span class="badge" style="color:#f87171;">expired {formatDate(share.expires_at)}</span>
                  {:else}
                    <span class="badge" style="color:#fbbf24;">expires {formatDate(share.expires_at)}</span>
                  {/if}
                </span>
              {/each}
              {#if expiringShares.length > 4}
                <span class="muted" style="color:#71717a;">+{expiringShares.length - 4} more</span>
              {/if}
            </p>
          </div>
          <ChevronRight color="#a1a1aa" size={24} />
        </div>
      </a>
    </div>
  {/if}

  <a href="/admin/users" class="card link-card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1)); border-color: rgba(168, 85, 247, 0.3);">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="margin: 0 0 0.5rem 0; color: #f4f4f5;">User Management</h3>
        <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem;">Create, edit, and delete user accounts. Assign roles and configure folder scopes.</p>
      </div>
      <ChevronRight color="#a1a1aa" size={24} />
    </div>
  </a>

  <a href="/admin/queues" class="card link-card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1)); border-color: rgba(16, 185, 129, 0.3);">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="margin: 0 0 0.5rem 0; color: #f4f4f5;">Processing & Queues</h3>
        <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem;">Live progress bars for Scanner, Thumbnail generation, and ML pipelines.</p>
      </div>
      <ChevronRight color="#a1a1aa" size={24} />
    </div>
  </a>

  <a href="/admin/settings" class="card link-card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(239, 68, 68, 0.1)); border-color: rgba(245, 158, 11, 0.3);">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="margin: 0 0 0.5rem 0; color: #f4f4f5;">Global Settings</h3>
        <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem;">Network and bandwidth rate-limits for authenticated users and public shares.</p>
      </div>
      <ChevronRight color="#a1a1aa" size={24} />
    </div>
  </a>

  <a href="/admin/watermark" class="card link-card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(45, 212, 191, 0.1)); border-color: rgba(14, 165, 233, 0.3);">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="margin: 0 0 0.5rem 0; color: #f4f4f5;">Watermarking</h3>
        <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem;">Configure global image watermark templates and enforcement rules.</p>
      </div>
      <ChevronRight color="#a1a1aa" size={24} />
    </div>
  </a>

  <a href="/admin/faces" class="card link-card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(168, 85, 247, 0.1), rgba(217, 70, 239, 0.1)); border-color: rgba(168, 85, 247, 0.3);">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="margin: 0 0 0.5rem 0; color: #f4f4f5;">Face Management</h3>
        <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem;">Merge detected people and manage ML identity clusters.</p>
      </div>
      <ChevronRight color="#a1a1aa" size={24} />
    </div>
  </a>

  <a href="/admin/logs" class="card link-card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(236, 72, 153, 0.1)); border-color: rgba(139, 92, 246, 0.3);">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="margin: 0 0 0.5rem 0; color: #f4f4f5;">System Logs</h3>
        <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem;">View live backend events, public access audit trails, and errors.</p>
      </div>
      <ChevronRight color="#a1a1aa" size={24} />
    </div>
  </a>

  <a href="/admin/analytics" class="card link-card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.1)); border-color: rgba(59, 130, 246, 0.3);">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="margin: 0 0 0.5rem 0; color: #f4f4f5;">Global Analytics</h3>
        <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem;">Total system metrics, popular media, and shared link traffic.</p>
      </div>
      <ChevronRight color="#a1a1aa" size={24} />
    </div>
  </a>

  <a href="/admin/shares" class="card link-card" style="margin-bottom: 1.5rem; background: linear-gradient(135deg, rgba(236, 72, 153, 0.1), rgba(244, 114, 182, 0.1)); border-color: rgba(236, 72, 153, 0.3);">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="margin: 0 0 0.5rem 0; color: #f4f4f5;">Global Shares Management</h3>
        <p style="margin: 0; color: #a1a1aa; font-size: 0.9rem;">View, edit, disable, and delete shares generated globally across the app.</p>
      </div>
      <ChevronRight color="#a1a1aa" size={24} />
    </div>
  </a>
</div>

<style>
  .admin-container {
    width: 100%;
    color: #f4f4f5;
  }

  .header { margin-bottom: 2rem; }
  h2 { font-size: 2rem; margin: 0 0 0.5rem 0; }
  p { color: #a1a1aa; margin: 0; }

  .card {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    padding: 24px;
    border-radius: 12px;
    margin-bottom: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  
  .link-card {
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
  }
  .link-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 0.875rem;
    color: #cbd5e1;
  }

  input[type="text"], input[type="number"] {
    background: rgba(0,0,0,0.2);
    border: 1px solid var(--glass-border);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-family: inherit;
  }

  .success-box {
    margin-top: 16px;
    padding: 12px;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.2);
    border-radius: 6px;
    color: #34d399;
  }
  
  .success-box a {
    color: #6ee7b7;
  }
  
  .card h3 {
    margin: 0 0 0.5rem 0;
    color: #f4f4f5;
  }
  
  .card p {
    margin: 0;
    color: #a1a1aa;
    font-size: 0.95rem;
    line-height: 1.4;
  }

  @media (max-width: 900px) {
    h2 { font-size: 1.5rem; }
    .card { padding: 20px; }
    .header { margin-bottom: 1.5rem; }
  }
</style>
