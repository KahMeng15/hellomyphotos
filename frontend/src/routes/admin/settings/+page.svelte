<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import { ChevronLeft, Settings, Cpu, HardDrive, ShieldCheck, Save, Clock, Eye, Cloud, Trash2, CheckCircle, AlertTriangle } from '@lucide/svelte';
  import { toast } from '$lib/stores/toast';
  import { listGoogleAccounts, disconnectGoogleAccount, getGoogleAuthUrl, type GoogleAccount } from '$lib/api/gdrive';
  import { page } from '$app/state';

  let settings = $state<any>({
    mlConfidenceThreshold: 0.6,
    throttleAuthGlobal: 0,
    throttlePublicGlobal: 0,
    throttleAuth: 0,
    throttlePublic: 0,
    rateLimitApi: 100
  });

  let loading = $state(true);
  let saving = $state(false);

  // Google Drive state
  let googleAccounts = $state<GoogleAccount[]>([]);
  let loadingGDrive = $state(false);
  let disconnectingId = $state<string | null>(null);

  async function loadGDriveAccounts() {
    loadingGDrive = true;
    try {
      googleAccounts = await listGoogleAccounts();
    } catch (e: any) {
      console.warn('Could not load Google accounts:', e.message);
    } finally {
      loadingGDrive = false;
    }
  }

  async function handleConnectGoogle() {
    try {
      const authUrl = await getGoogleAuthUrl();
      window.location.href = authUrl;
    } catch (e: any) {
      toast.error(e.message || 'Failed to initiate Google OAuth. Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.');
    }
  }

  async function handleDisconnectGoogle(acc: GoogleAccount) {
    if (!confirm(`Are you sure you want to disconnect Google Account "${acc.email}"?`)) return;
    disconnectingId = acc.id;
    try {
      await disconnectGoogleAccount(acc.id);
      googleAccounts = googleAccounts.filter(a => a.id !== acc.id);
      toast.success(`Disconnected ${acc.email}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to disconnect account');
    } finally {
      disconnectingId = null;
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        settings = data;
      }
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadSettings();
    loadGDriveAccounts();

    // Check query params for OAuth result
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('connected')) {
      toast.success(`Google Account connected: ${searchParams.get('connected')}`);
      history.replaceState({}, '', window.location.pathname);
    } else if (searchParams.get('error')) {
      toast.error(`Google connection failed: ${searchParams.get('error')}`);
      history.replaceState({}, '', window.location.pathname);
    }
  });

  async function saveSettings() {
    saving = true;
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          throttleAuthGlobal: Number(settings.throttleAuthGlobal),
          throttlePublicGlobal: Number(settings.throttlePublicGlobal),
          throttleAuth: Number(settings.throttleAuth),
          throttlePublic: Number(settings.throttlePublic),
          rateLimitApi: Number(settings.rateLimitApi),
          authMaxLoginTries: Number(settings.authMaxLoginTries),
          authTimeoutMinutes: Number(settings.authTimeoutMinutes),
          authDoubleTimeout: Boolean(settings.authDoubleTimeout),
          defaultViewMode: settings.defaultViewMode,
          defaultSortMode: settings.defaultSortMode,
          defaultFolderViewMode: settings.defaultFolderViewMode,
          defaultShareViewMode: settings.defaultShareViewMode,
          defaultShareSortMode: settings.defaultShareSortMode,
          defaultShareFolderViewMode: settings.defaultShareFolderViewMode
        })
      });
      if (res.ok) {
        toast.success('Settings saved successfully!');
      } else {
      }
    } finally {
      saving = false;
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
        <h2>Global Settings</h2>
      <p>Configure hardware constraints, ML thresholds, and bandwidth throttling.</p>
    </div>
    </div>
    <button class="btn primary" onclick={saveSettings} disabled={saving}>
      {#if saving}
        Saving...
      {:else}
        <Save size={18} /> Save Changes
      {/if}
    </button>
  </div>

  {#if loading}
    <div class="spinner"></div>
  {:else}
    <div class="settings-grid">
      <!-- Bandwidth Throttling -->
      <div class="card">
        <div class="card-header">
          <HardDrive size={20} class="text-emerald" />
          <h3>Bandwidth & Server Limits</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>Global Server Limit (Authenticated Users)</label>
            <p class="help">Hard cap for the combined outbound bandwidth across all logged-in users. (0 = Unlimited)</p>
            <input type="number" bind:value={settings.throttleAuthGlobal} step="1" min="0" />
            <div class="preset-btns">
              <button class="btn sm secondary" onclick={() => settings.throttleAuthGlobal = 0}>Unlimited</button>
              <button class="btn sm secondary" onclick={() => settings.throttleAuthGlobal = 100}>100 Mbps</button>
              <button class="btn sm secondary" onclick={() => settings.throttleAuthGlobal = 500}>500 Mbps</button>
            </div>
          </div>
          
          <div class="form-group">
            <label>Per-User Bandwidth Limit (Authenticated)</label>
            <p class="help">Cap for logged-in users downloading content. (0 = Unlimited)</p>
            <input type="number" bind:value={settings.throttleAuth} step="1" min="0" />
          </div>

          <div style="height: 1px; background: rgba(255,255,255,0.1); margin: 24px 0;"></div>

          <div class="form-group">
            <label>Global Server Limit (Public Links)</label>
            <p class="help">Hard cap for the combined outbound bandwidth across all anonymous users to protect network capacity. (0 = Unlimited)</p>
            <input type="number" bind:value={settings.throttlePublicGlobal} step="1" min="0" />
            <div class="preset-btns">
              <button class="btn sm secondary" onclick={() => settings.throttlePublicGlobal = 0}>Unlimited</button>
              <button class="btn sm secondary" onclick={() => settings.throttlePublicGlobal = 50}>50 Mbps</button>
              <button class="btn sm secondary" onclick={() => settings.throttlePublicGlobal = 100}>100 Mbps</button>
            </div>
          </div>
          
          <div class="form-group">
            <label>Per-User Bandwidth Limit (Public Links)</label>
            <p class="help">Cap for anonymous users using share links. (0 = Unlimited)</p>
            <input type="number" bind:value={settings.throttlePublic} step="1" min="0" />
            <div class="preset-btns">
              <button class="btn sm secondary" onclick={() => settings.throttlePublic = 5}>5 Mbps</button>
              <button class="btn sm secondary" onclick={() => settings.throttlePublic = 15}>15 Mbps</button>
            </div>
          </div>
          
          <div class="form-group">
            <label>API Rate Limiting (Requests / minute)</label>
            <p class="help">Limit max API requests from a single IP to prevent scraping and abuse. (0 = Unlimited)</p>
            <input type="number" bind:value={settings.rateLimitApi} min="0" step="10" />
            <div class="preset-btns">
              <button class="btn sm secondary" onclick={() => settings.rateLimitApi = 60}>60 / min</button>
              <button class="btn sm secondary" onclick={() => settings.rateLimitApi = 300}>300 / min</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Auth Security -->
      <div class="card">
        <div class="card-header">
          <ShieldCheck size={20} class="text-purple" />
          <h3>Authentication Security</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>Max Login Tries Before Timeout</label>
            <p class="help">Number of failed login attempts allowed before the IP is temporarily blocked.</p>
            <input type="number" bind:value={settings.authMaxLoginTries} step="1" min="1" />
          </div>
          
          <div class="form-group">
            <label>Timeout Duration (Minutes)</label>
            <p class="help">How long the IP address is blocked after exceeding max tries.</p>
            <input type="number" bind:value={settings.authTimeoutMinutes} step="1" min="1" />
          </div>
          
          <div class="form-group" style="display: flex; align-items: center; gap: 12px; margin-top: 0.5rem;">
            <input type="checkbox" bind:checked={settings.authDoubleTimeout} id="authDoubleTimeout" style="width: auto; margin: 0; cursor: pointer;" />
            <div style="display: flex; flex-direction: column;">
              <label for="authDoubleTimeout" style="margin: 0; cursor: pointer;">Double Timeout Duration Automatically</label>
              <p class="help" style="margin: 0;">Industry standard: each subsequent block doubles the timeout duration for repeat offenders.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Default View & Sort -->
      <div class="card">
        <div class="card-header">
          <Eye size={20} class="text-blue" />
          <h3>Default View & Sort</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>Folder View — Image Default</label>
            <p class="help">Default image layout when browsing folders with photos.</p>
            <select bind:value={settings.defaultViewMode}>
              <option value="small-fit">Small Fit</option>
              <option value="large-fit">Large Fit</option>
              <option value="small-square">Small Square</option>
              <option value="large-square">Large Square</option>
            </select>
          </div>
          <div class="form-group">
            <label>Folder View — Sort Order</label>
            <p class="help">Default sort order for files in folders.</p>
            <select bind:value={settings.defaultSortMode}>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="a-z">A–Z</option>
              <option value="z-a">Z–A</option>
            </select>
          </div>
          <div class="form-group">
            <label>Folder View — Folders Only Layout</label>
            <p class="help">Default layout when browsing a folder that contains only sub-folders.</p>
            <select bind:value={settings.defaultFolderViewMode}>
              <option value="small-grid">Small Grid</option>
              <option value="medium-grid">Medium Grid</option>
              <option value="large-grid">Large Grid</option>
              <option value="list">List</option>
            </select>
          </div>
          <hr class="card-divider">
          <div class="form-group">
            <label>Share View — Image Default</label>
            <p class="help">Default image layout on shared links.</p>
            <select bind:value={settings.defaultShareViewMode}>
              <option value="small-fit">Small Fit</option>
              <option value="large-fit">Large Fit</option>
              <option value="small-square">Small Square</option>
              <option value="large-square">Large Square</option>
            </select>
          </div>
          <div class="form-group">
            <label>Share View — Sort Order</label>
            <p class="help">Default sort order for files on shared links.</p>
            <select bind:value={settings.defaultShareSortMode}>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="a-z">A–Z</option>
              <option value="z-a">Z–A</option>
            </select>
          </div>
          <div class="form-group">
            <label>Share View — Folders Only Layout</label>
            <p class="help">Default layout when a shared link contains only sub-folders.</p>
            <select bind:value={settings.defaultShareFolderViewMode}>
              <option value="small-grid">Small Grid</option>
              <option value="medium-grid">Medium Grid</option>
              <option value="large-grid">Large Grid</option>
              <option value="list">List</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Google Drive Cloud Sync -->
      <div class="card">
        <div class="card-header" style="justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <Cloud size={20} class="text-blue" />
            <h3>Google Drive Accounts</h3>
          </div>
          <button class="btn sm" onclick={handleConnectGoogle}>
            <Cloud size={16} /> Connect Account
          </button>
        </div>
        <div class="card-body">
          <p class="help">
            Link Google account(s) to enable live event JPEG sync and shareable Drive links from any folder or FastUp session.
          </p>

          {#if loadingGDrive}
            <div style="padding: 1rem; text-align: center; color: #71717a;">Loading accounts...</div>
          {:else if googleAccounts.length === 0}
            <div style="padding: 2rem; border: 1px dashed rgba(255,255,255,0.15); border-radius: 8px; text-align: center;">
              <p style="color: #a1a1aa; margin-bottom: 1rem;">No Google accounts connected yet.</p>
              <button class="btn secondary sm" onclick={handleConnectGoogle}>
                Connect First Account
              </button>
            </div>
          {:else}
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
              {#each googleAccounts as acc}
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.85rem 1rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;">
                  <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: rgba(66,133,244,0.15); display: flex; align-items: center; justify-content: center; color: #60a5fa; font-weight: bold; font-size: 0.85rem;">
                      G
                    </div>
                    <div>
                      <div style="font-weight: 600; color: #f4f4f5; display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem;">
                        {acc.email}
                        <span style="font-size: 0.7rem; background: rgba(16,185,129,0.15); color: #10b981; padding: 1px 5px; border-radius: 4px; font-weight: normal;">Connected</span>
                      </div>
                      {#if acc.label && acc.label !== acc.email}
                        <div style="font-size: 0.75rem; color: #a1a1aa;">{acc.label}</div>
                      {/if}
                    </div>
                  </div>
                  <button 
                    class="btn sm secondary" 
                    style="color: #ef4444; border-color: rgba(239,68,68,0.2); padding: 0.3rem 0.6rem;"
                    onclick={() => handleDisconnectGoogle(acc)}
                    disabled={disconnectingId === acc.id}
                  >
                    <Trash2 size={14} />
                    {disconnectingId === acc.id ? '...' : 'Disconnect'}
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .admin-container { width: 100%; color: #f4f4f5; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 2rem; }
  h2 { font-size: 2rem; margin: 0 0 0.5rem 0; }
  p { color: #a1a1aa; margin: 0; }

  .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }

  .card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
  }
  .card-header {
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .card-header h3 { margin: 0; font-size: 1.2rem; }
  .text-blue { color: #3b82f6; }
  .text-purple { color: #a855f7; }
  .text-emerald { color: #10b981; }

  .card-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }

  .form-group label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.95rem; }
  .help { color: #71717a; font-size: 0.8rem; margin: 0 0 0.5rem 0; }
  
  input[type="number"] {
    width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
    padding: 0.75rem; border-radius: 6px; color: white; font-family: inherit;
  }
  input[type="number"]:focus { outline: none; border-color: #a855f7; }

  select {
    width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
    padding: 0.75rem; border-radius: 6px; color: white; font-family: inherit;
    appearance: auto;
  }
  select:focus { outline: none; border-color: #a855f7; }
  select option { background: #1a1a2e; color: white; }

  .card-divider { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 0.5rem 0; }

  .slider-group { display: flex; align-items: center; gap: 1rem; }
  input[type="range"] { flex: 1; cursor: pointer; accent-color: #a855f7; }
  .slider-val { background: rgba(168,85,247,0.2); color: #d8b4fe; padding: 0.25rem 0.5rem; border-radius: 4px; font-family: monospace; font-size: 0.9rem; }

  .preset-btns { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  
  .btn {
    display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem;
    border-radius: 8px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;
  }
  .btn.primary { background: linear-gradient(135deg, #6366f1, #a855f7); color: white; }
  .btn.secondary { background: rgba(255,255,255,0.1); color: white; }
  .btn.sm { padding: 0.4rem 0.75rem; font-size: 0.8rem; }
  .btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .spinner {
    border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #a855f7;
    border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 4rem auto;
  }
  @keyframes spin { 100% { transform: rotate(360deg); } }

  @media (max-width: 900px) {
    h2 { font-size: 1.5rem; }
    .header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .settings-grid { grid-template-columns: 1fr; }
    .preset-btns { flex-wrap: wrap; }
    .card-body { padding: 1.25rem; }
  }
</style>
