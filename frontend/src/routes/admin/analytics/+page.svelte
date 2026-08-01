<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import ExpandableList from '$lib/components/ExpandableList.svelte';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import HoverThumb from '$lib/components/HoverThumb.svelte';
  import {
    ChevronLeft,
    BarChart3,
    Image as ImageIcon,
    Video,
    Eye,
    Link as LinkIcon,
    Users,
    Globe,
    HardDrive,
    Database,
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
    Shield
  } from '@lucide/svelte';

  let data = $state<any>(null);
  let loading = $state(true);
  let scope = $state<'all' | 'shares'>('all');
  let settings = $state({ analyticsFilterBots: false, analyticsFilterSpam: false });

  async function loadAnalytics() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/analytics${scope === 'shares' ? '?scope=shares' : ''}`, { credentials: 'include' });
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
  const cacheDetails = $derived((data?.cacheBreakdown || []).map((c: any) => ({ label: c.name, value: formatBytes(c.bytes) })));
  const dbDetails = $derived((data?.dbTableSizes || []).map((d: any) => ({ label: d.name, value: formatBytes(d.bytes) })));

  // --- Generic line/area chart builder (visits & bandwidth) ---
  const CHART_W = 720;
  const CHART_H = 200;
  const PAD = 8;

  function computeSeries(rows: { day: string; v: number }[]) {
    if (rows.length === 0) return { points: '', area: '', labels: [], total: 0 };
    const max = Math.max(...rows.map(r => r.v), 1);
    const n = rows.length;
    const x = (i: number) => PAD + (i * (CHART_W - PAD * 2)) / Math.max(1, n - 1);
    const y = (v: number) => CHART_H - PAD - (v / max) * (CHART_H - PAD * 2);
    const pts = rows.map((r, i) => `${x(i)},${y(r.v)}`).join(' ');
    const area = `${PAD},${CHART_H - PAD} ${pts} ${CHART_W - PAD},${CHART_H - PAD}`;
    const step = Math.ceil(n / 6);
    const labels = rows
      .map((r, i) => ({ i, label: r.day.slice(5) }))
      .filter((_, i) => i % step === 0 || i === n - 1)
      .map(({ i, label }) => ({ x: x(i), label }));
    return { points: pts, area, labels, total: rows.reduce((s, r) => s + r.v, 0) };
  }

  let timelinePoints = $derived(computeSeries((data?.timeline || []).map((d: any) => ({ day: d.day, v: d.count }))));
  let bandwidthPoints = $derived(computeSeries((data?.bandwidthByDay || []).map((d: any) => ({ day: d.day, v: d.bytes }))));

  // --- Peak hours heatmap (0-23) ---
  function computePeakCells() {
    const map: Record<number, number> = {};
    for (const h of data?.peakHours || []) map[h.hour] = h.count;
    const max = Math.max(1, ...Object.values(map));
    const cells = [];
    for (let h = 0; h < 24; h++) {
      cells.push({ hour: h, count: map[h] || 0, intensity: map[h] ? 0.2 + (map[h] / max) * 0.8 : 0 });
    }
    return cells;
  }

  let peakCells = $derived(computePeakCells());

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
      <a href="/admin" title="Back to Admin Dashboard" style="display: flex; align-items: center; justify-content: center; padding: 0; margin: 0; line-height: 0; color: rgba(255,255,255,0.4); text-decoration: none; transition: color 0.2s, transform 0.2s;" onmouseover={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }} onmouseout={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}>
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>Global Analytics</h2>
        <p>System-wide media statistics, visitor insights, and shared-link traffic.</p>
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
      <span class="scope-hint">{scope === 'shares' ? 'Showing shared-link traffic only' : 'Showing global traffic'}</span>
      <div class="filter-spacer"></div>
      <div class="switch-row">
        <span>Exclude bots & crawlers from visitor charts</span>
        <span class="toggle" class:toggle-on={settings.analyticsFilterBots} role="switch" aria-checked={settings.analyticsFilterBots} aria-label="Exclude bots and crawlers" tabindex="0" onclick={() => toggleFilter('analyticsFilterBots', !settings.analyticsFilterBots)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFilter('analyticsFilterBots', !settings.analyticsFilterBots); } }}>
          <span class="knob"></span>
        </span>
      </div>
      <div class="switch-row">
        <span>Hide known referrer-spam traffic</span>
        <span class="toggle" class:toggle-on={settings.analyticsFilterSpam} role="switch" aria-checked={settings.analyticsFilterSpam} aria-label="Hide referrer spam traffic" tabindex="0" onclick={() => toggleFilter('analyticsFilterSpam', !settings.analyticsFilterSpam)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFilter('analyticsFilterSpam', !settings.analyticsFilterSpam); } }}>
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

    <!-- Visitor & Storage KPI Stats -->
    <div class="stats-grid">
      <KpiCard icon={Users} color="bg-cyan" title="Total Visitors" value={data.stats.visitors.total.toLocaleString()} subtitle="Page loads & media access events" details={visitorDetails} />
      <KpiCard icon={Globe} color="bg-orange" title="Unique Visitors" value={data.stats.visitors.unique.toLocaleString()} subtitle="Distinct IP addresses" details={uniqueDetails} />
      <KpiCard icon={Download} color="bg-red" title="Bandwidth Served" value={formatBytes(data.stats.bandwidth)} subtitle="Total bytes served to clients" details={bandwidthDetails} />
      <KpiCard icon={Download} color="bg-orange" title="Total Downloads" value={data.stats.downloads.toLocaleString()} subtitle="File & folder (zip) downloads" details={downloadsDetails} />
      <KpiCard icon={HardDrive} color="bg-amber" title="Cache Size" value={formatBytes(data.stats.cache.size)} subtitle="Thumbnails, previews & transcodes" details={cacheDetails} />
      <KpiCard icon={Database} color="bg-slate" title="Database Size" value={formatBytes(data.stats.db.size)} subtitle="PostgreSQL on-disk usage" details={dbDetails} />
    </div>

    <!-- Access Timeline -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <h3><Activity size={18} /> Access Timeline <span class="hint">Last 30 days</span></h3>
      {#if data.timeline.length === 0}
        <p class="muted">No visits recorded yet in the last 30 days.</p>
      {:else}
        <div class="chart-head">
          <span class="muted">{data.timeline[0].day}</span>
          <span><strong>{timelinePoints.total.toLocaleString()}</strong> visits total</span>
          <span class="muted">{data.timeline[data.timeline.length - 1].day}</span>
        </div>
        <svg viewBox="0 0 {CHART_W} {CHART_H}" preserveAspectRatio="none" class="line-chart" role="img" aria-label="Visits per day over the last 30 days">
          <defs>
            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#a855f7" stop-opacity="0.35" />
              <stop offset="100%" stop-color="#a855f7" stop-opacity="0.02" />
            </linearGradient>
          </defs>
          <polygon points={timelinePoints.area} fill="url(#areaFill)" />
          <polyline points={timelinePoints.points} fill="none" stroke="#a855f7" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </svg>
        <div class="chart-labels">
          {#each timelinePoints.labels as l}
            <span>{l.label}</span>
          {/each}
        </div>
      {/if}
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
        {#if data.peakHours.length === 0}
          <p class="muted">No visitor data yet.</p>
        {:else}
          <div class="heatmap" role="img" aria-label="Visit intensity by hour of day">
            {#each peakCells as cell}
              <div class="heat-cell" title="{cell.hour}:00 – {cell.count.toLocaleString()} visits" style="--intensity: {cell.intensity}">
                <span class="heat-label">{cell.hour}</span>
              </div>
            {/each}
          </div>
          <div class="heat-legend"><span>0</span><span>Fewer</span><span>More</span></div>
        {/if}
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
      {#if data.bandwidthByDay.length === 0}
        <p class="muted">No bandwidth data recorded yet.</p>
      {:else}
        <div class="chart-head">
          <span class="muted">{data.bandwidthByDay[0].day}</span>
          <span><strong>{formatBytes(bandwidthPoints.total)}</strong> served</span>
          <span class="muted">{data.bandwidthByDay[data.bandwidthByDay.length - 1].day}</span>
        </div>
        <svg viewBox="0 0 {CHART_W} {CHART_H}" preserveAspectRatio="none" class="line-chart" role="img" aria-label="Bandwidth served per day over the last 30 days">
          <defs>
            <linearGradient id="bwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#34d399" stop-opacity="0.35" />
              <stop offset="100%" stop-color="#34d399" stop-opacity="0.02" />
            </linearGradient>
          </defs>
          <polygon points={bandwidthPoints.area} fill="url(#bwFill)" />
          <polyline points={bandwidthPoints.points} fill="none" stroke="#34d399" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        </svg>
        <div class="chart-labels">
          {#each bandwidthPoints.labels as l}
            <span>{l.label}</span>
          {/each}
        </div>
      {/if}
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
        <p class="muted">No active shares expiring within the next 7 days.</p>
      {:else}
        <ExpandableList items={data.expiringShares} limit={10}>
          {#snippet children(rows)}
            <table>
              <thead><tr><th>Folder Path</th><th>Created By</th><th>Expires</th><th>Status</th></tr></thead>
              <tbody>
                  {#each rows as share}
                    <tr>
                      <td class="truncate" title={share.folder_path}>{#if share.folder_path}<a href={folderHref(share.folder_path)} target="_blank" rel="noreferrer" class="link-cell">{share.folder_path}</a>{:else if share.media_id}(single media){:else}<span class="muted">/</span>{/if}</td>
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

  /* Line chart */
  .chart-head { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom: 0.5rem; color: #a1a1aa; }
  .line-chart { width: 100%; height: 200px; display: block; }
  .chart-labels { display: flex; justify-content: space-between; font-size: 0.7rem; color: #71717a; margin-top: 0.35rem; }

  /* Heatmap */
  .heatmap { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; }
  .heat-cell {
    aspect-ratio: 1; border-radius: 4px; position: relative;
    background: rgba(168, 85, 247, calc(0.06 + (var(--intensity) * 0.9)));
  }
  .heat-label { display: none; }
  .heat-cell:hover .heat-label { display: block; position: absolute; top: -2px; left: 50%; transform: translate(-50%, -100%); background: rgba(0,0,0,0.85); color: #fff; font-size: 0.6rem; padding: 2px 4px; border-radius: 4px; white-space: nowrap; z-index: 5; }
  .heat-legend { display: flex; justify-content: flex-end; gap: 0.75rem; font-size: 0.7rem; color: #71717a; margin-top: 0.5rem; }

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
