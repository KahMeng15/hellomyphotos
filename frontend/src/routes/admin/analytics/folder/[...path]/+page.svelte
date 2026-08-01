<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { API_BASE } from '$lib/api/media';
  import ExpandableList from '$lib/components/ExpandableList.svelte';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import HoverThumb from '$lib/components/HoverThumb.svelte';
  import LineChart from '$lib/components/LineChart.svelte';
  import PeakHoursHeatmap from '$lib/components/PeakHoursHeatmap.svelte';
  import {
    ChevronLeft,
    BarChart3,
    Image as ImageIcon,
    Video,
    Eye,
    Link as LinkIcon,
    Users,
    Globe,
    MonitorSmartphone,
    Activity,
    Monitor,
    Smartphone,
    Tablet,
    Bot,
    Fingerprint,
    Clock,
    Download,
    Folder,
    ShieldAlert,
    Repeat,
    ArrowLeftRight,
    Settings2,
    Shield,
    FolderOpen
  } from '@lucide/svelte';

  const folderPath = $derived($page.params.path || '');

  let data = $state<any>(null);
  let loading = $state(true);
  let scope = $state<'all' | 'shares'>('all');
  let includeDesc = $state(true);
  let shareToken = $state('');
  let settings = $state({ analyticsFilterBots: false, analyticsFilterSpam: false });

  async function loadAnalytics() {
    loading = true;
    try {
      const params = new URLSearchParams({ path: folderPath, includeDescendants: includeDesc ? '1' : '0', scope });
      if (scope === 'shares' && shareToken) params.set('shareToken', shareToken);
      const res = await fetch(`${API_BASE}/api/admin/analytics/folder?${params}`, { credentials: 'include' });
      if (res.ok) {
        data = await res.json();
        if (data.filters) {
          settings.analyticsFilterBots = !!data.filters.filterBots;
          settings.analyticsFilterSpam = !!data.filters.filterSpam;
        }
      }
    } finally {
      loading = false;
    }
  }

  function setScope(next: 'all' | 'shares') {
    if (scope === next) return;
    scope = next;
    if (next === 'all') shareToken = '';
    loadAnalytics();
  }

  function setIncludeDesc(v: boolean) {
    if (includeDesc === v) return;
    includeDesc = v;
    loadAnalytics();
  }

  function onShareChange(e: Event) {
    shareToken = (e.currentTarget as HTMLSelectElement).value;
    loadAnalytics();
  }

  async function toggleFilter(key: 'analyticsFilterBots' | 'analyticsFilterSpam', value: boolean) {
    settings[key] = value;
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
        credentials: 'include'
      });
      if (res.ok) await loadAnalytics();
    } catch {}
  }

  onMount(() => {
    loadAnalytics();
  });

  function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDate(iso: string) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function isExpired(iso: string) {
    return new Date(iso).getTime() < Date.now();
  }

  function maxCount(rows: { count: number }[]) {
    return Math.max(1, ...(rows || []).map(r => r.count));
  }

  function barWidth(row: { count: number }, rows: { count: number }[]) {
    return Math.max(2, Math.round((row.count / maxCount(rows)) * 100));
  }

  function capitalize(s: string) {
    if (!s) return 'Unknown';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // --- Link helpers (open folders & media in the app) ---
  function encodePath(p: string) {
    return (p || '').split('/').map(s => encodeURIComponent(s)).join('/');
  }
  function folderHref(fp: string) {
    const e = encodePath(fp);
    return e ? `/folder/${e}` : '/folder';
  }
  function fileHref(fp: string, fn: string) {
    return `${folderHref(fp)}/${encodeURIComponent(fn)}`;
  }

  // --- KPI expansion detail lists ---
  const photoDetails = $derived((data?.folderBreakdown || []).map((f: any) => ({ label: f.folder_path || '/', value: f.photos.toLocaleString(), href: folderHref(f.folder_path) })));
  const videoDetails = $derived((data?.folderBreakdown || []).filter((f: any) => f.videos > 0).map((f: any) => ({ label: f.folder_path || '/', value: f.videos.toLocaleString(), href: folderHref(f.folder_path) })));
  const viewsDetails = $derived((data?.viewsByDay || []).map((d: any) => ({ label: d.day, value: d.count.toLocaleString() })));
  const visitorDetails = $derived((data?.timeline || []).map((d: any) => ({ label: d.day, value: d.count.toLocaleString() })));
  const uniqueDetails = $derived((data?.topIPs || []).map((i: any) => ({ label: i.ip, value: i.visits.toLocaleString() })));
  const bandwidthDetails = $derived((data?.bandwidthByDay || []).map((d: any) => ({ label: d.day, value: formatBytes(d.bytes) })));
  const downloadsDetails = $derived((data?.downloadsByDay || []).map((d: any) => ({ label: d.day, value: d.count.toLocaleString() })));

  // --- Line/area chart data (visits & bandwidth) ---
  const timelineRows = $derived((data?.timeline || []).map((d: any) => ({ day: d.day, v: d.count })));
  const bandwidthRows = $derived((data?.bandwidthByDay || []).map((d: any) => ({ day: d.day, v: d.bytes })));

  const deviceIcons: Record<string, any> = {
    mobile: Smartphone,
    tablet: Tablet,
    desktop: Monitor,
    bot: Bot,
    unknown: MonitorSmartphone
  };
</script>

<div class="admin-container">
  <div class="header">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a href="/admin/analytics" title="Back to Global Analytics" style="display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; color: rgba(255,255,255,0.4); text-decoration: none; transition: color 0.2s, transform 0.2s;">
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>Folder Analytics</h2>
        <p class="folder-line">
          <a href={folderHref(folderPath)} target="_blank" rel="noreferrer" class="link-cell"><FolderOpen size={15} /> {folderPath || '/'}</a>
          {#if includeDesc}<span class="hint">including subfolders</span>{/if}
        </p>
      </div>
    </div>
  </div>

  {#if loading}
    <div class="spinner"></div>
  {:else if data}
    <!-- Analytics filters -->
    <div class="filter-bar card">
      <span class="filter-title"><Settings2 size={16} /> Data Filters</span>
      <div class="segmented" role="group" aria-label="Statistics scope">
        <button class:active={scope === 'all'} onclick={() => setScope('all')} title="All traffic including logged-in users">Global</button>
        <button class:active={scope === 'shares'} onclick={() => setScope('shares')} title="Only shared-link traffic">Share Links</button>
      </div>
      {#if scope === 'shares' && data.availableShares.length > 0}
        <select class="share-picker" value={shareToken} onchange={onShareChange} aria-label="Choose a specific shared link">
          <option value="">All shared links</option>
          {#each data.availableShares as s}
            <option value={s.share_token}>{s.label}</option>
          {/each}
        </select>
      {/if}
      <div class="switch-row">
        <span>Include subfolders</span>
        <span class="toggle" class:toggle-on={includeDesc} role="switch" aria-checked={includeDesc} aria-label="Include subfolders" tabindex="0" onclick={() => setIncludeDesc(!includeDesc)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIncludeDesc(!includeDesc); } }}>
          <span class="knob"></span>
        </span>
      </div>
      <span class="scope-hint">{scope === 'shares' ? (shareToken ? 'Showing one shared link' : 'Showing shared-link traffic only') : 'Showing all traffic'}</span>
      <div class="filter-spacer"></div>
      <div class="switch-row">
        <span>Exclude bots & crawlers from visitor charts</span>
        <span class="toggle" class:toggle-on={settings.analyticsFilterBots} role="switch" aria-checked={settings.analyticsFilterBots} aria-label="Exclude bots and crawlers" tabindex="0" onclick={() => toggleFilter('analyticsFilterBots', !settings.analyticsFilterBots)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFilter('analyticsFilterBots', !settings.analyticsFilterBots); } }}>
          <span class="knob"></span>
        </span>
      </div>
      <div class="switch-row">
        <span>Hide referrer spam</span>
        <span class="toggle" class:toggle-on={settings.analyticsFilterSpam} role="switch" aria-checked={settings.analyticsFilterSpam} aria-label="Hide referrer spam" tabindex="0" onclick={() => toggleFilter('analyticsFilterSpam', !settings.analyticsFilterSpam)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFilter('analyticsFilterSpam', !settings.analyticsFilterSpam); } }}>
          <span class="knob"></span>
        </span>
      </div>
    </div>

    <!-- Media KPI Stats -->
    <div class="stats-grid">
      <KpiCard icon={ImageIcon} color="bg-blue" title="Total Photos" value={data.stats.photos.count.toLocaleString()} subtitle={`Using ${formatBytes(data.stats.photos.size)}`} details={photoDetails} />
      <KpiCard icon={Video} color="bg-purple" title="Total Videos" value={data.stats.videos.count.toLocaleString()} subtitle={`Using ${formatBytes(data.stats.videos.size)}`} details={videoDetails} />
      <KpiCard icon={Eye} color="bg-emerald" title="Total Media Views" value={data.stats.visits.toLocaleString()} subtitle={scope === 'shares' ? 'Shared-link access only' : 'Across all users & public shares'} details={viewsDetails} />
    </div>

    <!-- Visitor & Download KPI Stats -->
    <div class="stats-grid">
      <KpiCard icon={Users} color="bg-cyan" title="Total Visitors" value={data.stats.visitors.total.toLocaleString()} subtitle="Page loads & media access events" details={visitorDetails} />
      <KpiCard icon={Globe} color="bg-orange" title="Unique Visitors" value={data.stats.visitors.unique.toLocaleString()} subtitle="Distinct IP addresses" details={uniqueDetails} />
      <KpiCard icon={Download} color="bg-red" title="Bandwidth Served" value={formatBytes(data.stats.bandwidth)} subtitle="Total bytes served to clients" details={bandwidthDetails} />
      <KpiCard icon={Download} color="bg-amber" title="Total Downloads" value={data.stats.downloads.toLocaleString()} subtitle="File & folder (zip) downloads" details={downloadsDetails} />
    </div>

    <!-- Access Timeline -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3><Activity size={18} /> Access Timeline <span class="hint">Last 30 days</span></h3>
      <LineChart data={timelineRows} stroke="#a855f7" fillId="fAreaFill" unit="visits total" />
    </div>

    <!-- Distribution charts -->
    <div class="charts-grid">
      <div class="card">
        <h3><BarChart3 size={18} /> Operating Systems</h3>
        {#if data.osBreakdown.length === 0}
          <p class="muted">No visitor data yet.</p>
        {:else}
          <ExpandableList items={data.osBreakdown} limit={10}>
            {#snippet children(rows)}
              {#each rows as row}
                <div class="bar-row">
                  <div class="bar-label">
                    <span>{row.name}</span>
                    <span class="muted">{row.count.toLocaleString()}</span>
                  </div>
                  <div class="bar-track"><div class="bar-fill purple" style="width: {barWidth(row, data.osBreakdown)}%"></div></div>
                </div>
              {/each}
            {/snippet}
          </ExpandableList>
        {/if}
      </div>

      <div class="card">
        <h3><Globe size={18} /> Browsers</h3>
        {#if data.browserBreakdown.length === 0}
          <p class="muted">No visitor data yet.</p>
        {:else}
          <ExpandableList items={data.browserBreakdown} limit={10}>
            {#snippet children(rows)}
              {#each rows as row}
                <div class="bar-row">
                  <div class="bar-label">
                    <span>{row.name}</span>
                    <span class="muted">{row.count.toLocaleString()}</span>
                  </div>
                  <div class="bar-track"><div class="bar-fill blue" style="width: {barWidth(row, data.browserBreakdown)}%"></div></div>
                </div>
              {/each}
            {/snippet}
          </ExpandableList>
        {/if}
      </div>

      <div class="card">
        <h3><MonitorSmartphone size={18} /> Device Types</h3>
        {#if data.deviceBreakdown.length === 0}
          <p class="muted">No visitor data yet.</p>
        {:else}
          <ExpandableList items={data.deviceBreakdown} limit={10}>
            {#snippet children(rows)}
              {#each rows as row}
                {@const Icon = deviceIcons[row.name] || MonitorSmartphone}
                <div class="bar-row">
                  <div class="bar-label">
                    <span class="device-name"><Icon size={16} /> {capitalize(row.name)}</span>
                    <span class="muted">{row.count.toLocaleString()}</span>
                  </div>
                  <div class="bar-track"><div class="bar-fill emerald" style="width: {barWidth(row, data.deviceBreakdown)}%"></div></div>
                </div>
              {/each}
            {/snippet}
          </ExpandableList>
        {/if}
      </div>
    </div>

    <!-- Peak hours + referrers -->
    <div class="charts-grid">
      <div class="card">
        <h3><Clock size={18} /> Peak Access Hours</h3>
        <PeakHoursHeatmap hours={data.peakHours} />
      </div>

      <div class="card">
        <h3><Globe size={18} /> Top Referrers</h3>
        {#if data.topReferrers.length === 0}
          <p class="muted">No referrer data yet.</p>
        {:else}
          <ExpandableList items={data.topReferrers} limit={10}>
            {#snippet children(rows)}
              {#each rows as row}
                <div class="bar-row">
                  <div class="bar-label">
                    <span class="truncate" title={row.name}>{row.name}</span>
                    <span class="muted">{row.count.toLocaleString()}</span>
                  </div>
                  <div class="bar-track"><div class="bar-fill cyan" style="width: {Math.round((row.count / Math.max(1, data.topReferrers[0].count)) * 100)}%"></div></div>
                </div>
              {/each}
            {/snippet}
          </ExpandableList>
        {/if}
      </div>
    </div>

    <!-- Bandwidth by day -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3><Download size={18} /> Bandwidth by Day <span class="hint">Last 30 days</span></h3>
      <LineChart data={bandwidthRows} stroke="#34d399" fillId="fBwFill" unit="served" formatTotal={formatBytes} />
    </div>

    <div class="tables-grid">
      <!-- Top Shared Links -->
      <div class="card">
        <h3><LinkIcon size={18} /> Most Visited Shared Links</h3>
        {#if data.topShares.length === 0}
          <p class="muted">No shared links created yet.</p>
        {:else}
          <ExpandableList items={data.topShares} limit={10}>
            {#snippet children(rows)}
              <table>
                <thead><tr><th>Folder Path</th><th>Views</th></tr></thead>
                <tbody>
                  {#each rows as share}
                    <tr>
                      <td class="truncate" title={share.folder_path}><a href={folderHref(share.folder_path)} target="_blank" rel="noreferrer" class="link-cell">{share.folder_path}</a></td>
                      <td class="text-right"><strong>{share.views}</strong></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/snippet}
          </ExpandableList>
        {/if}
      </div>

      <!-- Top Media Files (shared links only) -->
      <div class="card">
        <h3><BarChart3 size={18} /> Most Viewed Media <span class="hint">shared links only</span></h3>
        {#if data.topMedia.length === 0}
          <p class="muted">No shared-link media views recorded yet.</p>
        {:else}
          <ExpandableList items={data.topMedia} limit={10}>
            {#snippet children(rows)}
              <table>
                <thead><tr><th>File Name</th><th>Folder</th><th>Views</th></tr></thead>
                <tbody>
                  {#each rows as media}
                    <tr>
                      <td class="truncate" title={media.file_name}><HoverThumb id={media.id}><a href={fileHref(media.folder_path, media.file_name)} target="_blank" rel="noreferrer" class="link-cell">{media.file_name}</a></HoverThumb></td>
                      <td class="muted"><a href={folderHref(media.folder_path)} target="_blank" rel="noreferrer" class="link-cell">{media.folder_path}</a></td>
                      <td class="text-right"><strong>{media.views}</strong></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/snippet}
          </ExpandableList>
        {/if}
      </div>
    </div>

    <!-- Popular folders + share conversion -->
    <div class="tables-grid">
      <div class="card">
        <h3><Folder size={18} /> Popular Media Folders</h3>
        {#if data.popularFolders.length === 0}
          <p class="muted">No media views recorded yet.</p>
        {:else}
          <ExpandableList items={data.popularFolders} limit={10}>
            {#snippet children(rows)}
              <table>
                <thead><tr><th>Folder</th><th>Views</th></tr></thead>
                <tbody>
                  {#each rows as row}
                    <tr>
                      <td class="truncate folder" title={row.folder_path}><a href={folderHref(row.folder_path)} target="_blank" rel="noreferrer" class="link-cell">{row.folder_path || '/'}</a></td>
                      <td class="text-right"><strong>{row.views}</strong></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/snippet}
          </ExpandableList>
        {/if}
      </div>

      <div class="card">
        <h3><ArrowLeftRight size={18} /> Share Link Conversion</h3>
        {#if data.shareConversion.length === 0}
          <p class="muted">No shared-link visits recorded yet.</p>
        {:else}
          <ExpandableList items={data.shareConversion} limit={10}>
            {#snippet children(rows)}
              <table>
                <thead><tr><th>Share</th><th>Unique</th><th>Visits</th><th>Media Views</th></tr></thead>
                <tbody>
                  {#each rows as row}
                    <tr>
                      <td class="truncate" title={row.label}>{row.label}</td>
                      <td class="text-right"><strong>{row.unique_visitors}</strong></td>
                      <td class="text-right">{row.visits}</td>
                      <td class="text-right">{row.media_views}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/snippet}
          </ExpandableList>
        {/if}
      </div>
    </div>

    <!-- Bandwidth by media & share -->
    <div class="tables-grid">
      <div class="card">
        <h3><Download size={18} /> Top Bandwidth Media</h3>
        {#if data.topBandwidthMedia.length === 0}
          <p class="muted">No bandwidth data yet.</p>
        {:else}
          <ExpandableList items={data.topBandwidthMedia} limit={10}>
            {#snippet children(rows)}
              <table>
                <thead><tr><th>File</th><th>Folder</th><th>Bytes</th><th>Views</th></tr></thead>
                <tbody>
                  {#each rows as row}
                    <tr>
                      <td class="truncate" title={row.file_name}><HoverThumb id={row.id}><a href={fileHref(row.folder_path, row.file_name)} target="_blank" rel="noreferrer" class="link-cell">{row.file_name}</a></HoverThumb></td>
                      <td class="muted"><a href={folderHref(row.folder_path)} target="_blank" rel="noreferrer" class="link-cell">{row.folder_path}</a></td>
                      <td class="text-right"><strong>{formatBytes(row.bytes)}</strong></td>
                      <td class="text-right muted">{row.views}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/snippet}
          </ExpandableList>
        {/if}
      </div>

      <div class="card">
        <h3><Repeat size={18} /> Top Bandwidth Shares</h3>
        {#if data.topBandwidthShares.length === 0}
          <p class="muted">No bandwidth data yet.</p>
        {:else}
          <ExpandableList items={data.topBandwidthShares} limit={10}>
            {#snippet children(rows)}
              <table>
                <thead><tr><th>Share</th><th>Bytes</th><th>Views</th></tr></thead>
                <tbody>
                  {#each rows as row}
                    <tr>
                      <td class="truncate" title={row.label}>{row.label}</td>
                      <td class="text-right"><strong>{formatBytes(row.bytes)}</strong></td>
                      <td class="text-right muted">{row.views}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/snippet}
          </ExpandableList>
        {/if}
      </div>
    </div>

    <!-- Download stats -->
    <div class="tables-grid">
      <div class="card">
        <h3><Download size={18} /> Top File Downloads</h3>
        {#if data.topFileDownloads.length === 0}
          <p class="muted">No file downloads recorded yet.</p>
        {:else}
          <ExpandableList items={data.topFileDownloads} limit={10}>
            {#snippet children(rows)}
              <table>
                <thead><tr><th>File</th><th>Folder</th><th>Downloads</th></tr></thead>
                <tbody>
                  {#each rows as row}
                    <tr>
                      <td class="truncate" title={row.file_name}><HoverThumb id={row.id}><a href={fileHref(row.folder_path, row.file_name)} target="_blank" rel="noreferrer" class="link-cell">{row.file_name}</a></HoverThumb></td>
                      <td class="muted"><a href={folderHref(row.folder_path)} target="_blank" rel="noreferrer" class="link-cell">{row.folder_path}</a></td>
                      <td class="text-right"><strong>{row.downloads}</strong></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/snippet}
          </ExpandableList>
        {/if}
      </div>

      <div class="card">
        <h3><Folder size={18} /> Top Folder Downloads</h3>
        {#if data.topFolderDownloads.length === 0}
          <p class="muted">No folder (zip) downloads recorded yet.</p>
        {:else}
          <ExpandableList items={data.topFolderDownloads} limit={10}>
            {#snippet children(rows)}
              <table>
                <thead><tr><th>Folder</th><th>Downloads</th></tr></thead>
                <tbody>
                  {#each rows as row}
                    <tr>
                      <td class="truncate" title={row.folder_path}><a href={folderHref(row.folder_path)} target="_blank" rel="noreferrer" class="link-cell">{row.folder_path || '/'}</a></td>
                      <td class="text-right"><strong>{row.downloads}</strong></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/snippet}
          </ExpandableList>
        {/if}
      </div>
    </div>

    <!-- Top IPs + blocked attempts -->
    <div class="tables-grid">
      <div class="card">
        <h3><Fingerprint size={18} /> Top IP Addresses</h3>
        {#if data.topIPs.length === 0}
          <p class="muted">No visitor data yet.</p>
        {:else}
          <ExpandableList items={data.topIPs} limit={10}>
            {#snippet children(rows)}
              <table>
                <thead><tr><th>IP Address</th><th>Visits</th></tr></thead>
                <tbody>
                  {#each rows as row}
                    <tr>
                      <td><code class="ip">{row.ip}</code></td>
                      <td class="text-right"><strong>{row.visits}</strong></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/snippet}
          </ExpandableList>
        {/if}
      </div>

      <div class="card">
        <h3><ShieldAlert size={18} /> Blocked / Not-Found Access</h3>
        <div class="blocked-total">
          <div class="val">{data.blockedAttempts.total.toLocaleString()}</div>
          <div class="sub">attempts recorded (all-time)</div>
        </div>
        {#if data.blockedAttempts.recent.length > 0}
          <div class="blocked-bars">
            {#each data.blockedAttempts.recent as row}
              <div class="blocked-col" title="{row.day}: {row.count} attempts">
                <div class="blocked-bar" style="height: {Math.max(6, Math.round((row.count / maxCount(data.blockedAttempts.recent)) * 80))}px"></div>
              </div>
            {/each}
          </div>
          <div class="muted">Last {data.blockedAttempts.recent.length} days</div>
        {:else}
          <p class="muted">No blocked access attempts recorded.</p>
        {/if}
      </div>
    </div>

    <!-- Expiring shares -->
    <div class="card" style="margin-top: 1.5rem;">
      <h3><Shield size={18} /> Expiring & Expired Shares <span class="hint">next 7 days</span></h3>
      {#if data.expiringShares.length === 0}
        <p class="muted">No active shares for this folder expiring within the next 7 days.</p>
      {:else}
        <ExpandableList items={data.expiringShares} limit={10}>
          {#snippet children(rows)}
            <table>
              <thead><tr><th>Folder Path</th><th>Created By</th><th>Expires</th><th>Status</th></tr></thead>
              <tbody>
                {#each rows as share}
                  <tr>
                    <td class="truncate" title={share.folder_path}>{#if share.folder_path}<a href={folderHref(share.folder_path)} target="_blank" rel="noreferrer" class="link-cell">{share.folder_path}</a>{:else}<span class="muted">/</span>{/if}</td>
                    <td class="muted">{share.creator_email || 'Unknown'}</td>
                    <td>{formatDate(share.expires_at)}</td>
                    <td>{#if isExpired(share.expires_at)}<span class="badge badge-red">Expired</span>{:else}<span class="badge badge-amber">Expiring soon</span>{/if}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/snippet}
        </ExpandableList>
      {/if}
    </div>
  {/if}
</div>

<style>
  .admin-container { width: 100%; color: #f4f4f5; }
  .header { margin-bottom: 2rem; }
  h2 { font-size: 2rem; margin: 0 0 0.5rem 0; }
  p { color: #a1a1aa; margin: 0; }
  .folder-line { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .folder-line .link-cell { display: inline-flex; align-items: center; gap: 0.35rem; }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  .card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 1.5rem;
  }
  .card h3 { margin: 0 0 1.5rem 0; display: flex; align-items: center; gap: 0.5rem; font-size: 1.1rem; }
  .hint { font-size: 0.75rem; color: #71717a; font-weight: 400; background: rgba(255,255,255,0.06); padding: 0.15rem 0.5rem; border-radius: 999px; }

  .tables-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { text-align: left; padding: 0.75rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); color: #a1a1aa; font-weight: 500; }
  td { padding: 0.75rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .text-right { text-align: right; }
  .muted { color: #71717a; font-size: 0.85rem; }
  .truncate { max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; }
  .folder { max-width: 220px; }
  .ip { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; background: rgba(255,255,255,0.05); padding: 0.15rem 0.4rem; border-radius: 6px; }
  .link-cell { color: #93c5fd; text-decoration: none; }
  .link-cell:hover { text-decoration: underline; }

  .badge { font-size: 0.72rem; padding: 0.2rem 0.55rem; border-radius: 999px; font-weight: 500; }
  .badge-red { background: rgba(239, 68, 68, 0.15); color: #f87171; }
  .badge-amber { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }

  /* Filter bar */
  .filter-bar { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; margin-bottom: 2rem; }
  .filter-title { display: inline-flex; align-items: center; gap: 0.5rem; font-weight: 600; color: #cbd5e1; }
  .filter-spacer { flex: 1; }
  .scope-hint { font-size: 0.8rem; color: #71717a; }
  .segmented {
    display: inline-flex; background: rgba(255,255,255,0.06); border-radius: 999px; padding: 3px; gap: 2px;
  }
  .segmented button {
    border: none; background: transparent; color: #a1a1aa; font-family: inherit; font-size: 0.8rem;
    padding: 0.35rem 0.9rem; border-radius: 999px; cursor: pointer; transition: background 0.2s, color 0.2s;
  }
  .segmented button:hover { color: #e4e4e7; }
  .segmented button.active { background: rgba(168, 85, 247, 0.55); color: #fff; font-weight: 600; }

  .share-picker {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #e4e4e7;
    font-family: inherit; font-size: 0.8rem; padding: 0.35rem 0.6rem; border-radius: 8px; max-width: 260px;
  }
  .share-picker option { background: #18181b; color: #e4e4e7; }

  .switch-row { display: inline-flex; align-items: center; gap: 0.75rem; font-size: 0.85rem; color: #a1a1aa; cursor: pointer; }
  .toggle {
    width: 40px; height: 22px; border-radius: 999px; background: rgba(255,255,255,0.12);
    position: relative; display: inline-block; transition: background 0.2s; flex-shrink: 0;
  }
  .toggle .knob {
    position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
    background: #a1a1aa; transition: transform 0.2s, background 0.2s;
  }
  .toggle.toggle-on { background: rgba(168, 85, 247, 0.6); }
  .toggle.toggle-on .knob { transform: translateX(18px); background: #fff; }

  /* Bar charts */
  .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem; }
  .bar-row { margin-bottom: 1rem; }
  .bar-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; font-size: 0.85rem; }
  .device-name { display: inline-flex; align-items: center; gap: 0.4rem; }
  .bar-track { height: 8px; background: rgba(255,255,255,0.06); border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
  .bar-fill.purple { background: linear-gradient(90deg, #7c3aed, #c084fc); }
  .bar-fill.blue { background: linear-gradient(90deg, #2563eb, #60a5fa); }
  .bar-fill.emerald { background: linear-gradient(90deg, #059669, #34d399); }
  .bar-fill.cyan { background: linear-gradient(90deg, #0891b2, #22d3ee); }

  /* Blocked attempts */
  .blocked-total { margin-bottom: 1rem; }
  .blocked-bars { display: flex; align-items: flex-end; gap: 4px; height: 90px; margin-bottom: 0.35rem; }
  .blocked-col { flex: 1; display: flex; align-items: flex-end; justify-content: center; }
  .blocked-bar { width: 70%; background: linear-gradient(180deg, #f87171, #7f1d1d); border-radius: 3px 3px 0 0; min-height: 6px; }

  .spinner {
    border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #a855f7;
    border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 4rem auto;
  }
  @keyframes spin { 100% { transform: rotate(360deg); } }
</style>
