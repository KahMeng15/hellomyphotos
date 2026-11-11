<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import ExpandableList from '$lib/components/ExpandableList.svelte';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import HoverThumb from '$lib/components/HoverThumb.svelte';
  import LineChart from '$lib/components/LineChart.svelte';
  import PeakHoursHeatmap from '$lib/components/PeakHoursHeatmap.svelte';
  import TechnicalAnalytics from '$lib/components/TechnicalAnalytics.svelte';
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
    Shield,
    Lock,
    UserX,
    FileQuestion,
    TrendingUp,
    Layers,
    ArrowDownToLine,
    Zap
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
  const cacheSavedDetails = $derived((data?.cacheSavedByDay || []).map((d: any) => ({ label: d.day, value: `${formatBytes(d.bytes)} (${(d.hits ?? 0).toLocaleString()} hits)` })));
  const downloadsDetails = $derived((data?.downloadsByDay || []).map((d: any) => ({ label: d.day, value: d.count.toLocaleString() })));
  const cacheDetails = $derived((data?.cacheBreakdown || []).map((c: any) => ({ label: c.name, value: formatBytes(c.bytes) })));
  const dbDetails = $derived((data?.dbTableSizes || []).map((d: any) => ({ label: d.name, value: formatBytes(d.bytes) })));

  // --- Line/area chart data with multi-metric & granularity support ---
  type MetricKey = 'visits' | 'views' | 'unique' | 'bandwidth' | 'bandwidthSaved' | 'downloads' | 'all';
  type Granularity = 'hour' | 'day' | 'month' | 'lifetime';

  let selectedMetric = $state<MetricKey>('visits');
  let chartRange = $state<Granularity>('day');

  function scrollToChart(metric: MetricKey) {
    selectedMetric = metric;
    const el = document.getElementById('analytics-timelines');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  const rangeHint = $derived.by(() => {
    if (chartRange === 'hour') return 'Last 48 Hours';
    if (chartRange === 'day') return 'Last 30 Days';
    if (chartRange === 'month') return 'Last 24 Months';
    return 'Lifetime (All Time)';
  });

  function extractSeries(metricGroup: any, range: Granularity, valKey: 'count' | 'bytes' = 'count') {
    if (!metricGroup) return [];
    const list = metricGroup[range] || [];
    return list.map((r: any) => ({ day: r.day, v: r[valKey] ?? r.count ?? r.bytes ?? 0 }));
  }

  const visitsRows = $derived.by(() => {
    if (!data) return [];
    if (data.timelines?.visits) return extractSeries(data.timelines.visits, chartRange, 'count');
    if (data.timelines) {
      if (chartRange === 'hour') return (data.timelines.hourly || []).map((r: any) => ({ day: r.day, v: r.count }));
      if (chartRange === 'day') return (data.timelines.daily || []).map((r: any) => ({ day: r.day, v: r.count }));
      if (chartRange === 'month') return (data.timelines.monthly || []).map((r: any) => ({ day: r.day, v: r.count }));
      if (chartRange === 'lifetime') return (data.timelines.lifetime || []).map((r: any) => ({ day: r.day, v: r.count }));
    }
    return (data.timeline || []).map((d: any) => ({ day: d.day, v: d.count }));
  });

  const viewsRows = $derived.by(() => {
    if (!data) return [];
    if (data.timelines?.mediaViews) return extractSeries(data.timelines.mediaViews, chartRange, 'count');
    return (data.viewsByDay || []).map((d: any) => ({ day: d.day, v: d.count }));
  });

  const uniqueRows = $derived.by(() => {
    if (!data) return [];
    if (data.timelines?.uniqueVisitors) return extractSeries(data.timelines.uniqueVisitors, chartRange, 'count');
    return [];
  });

  const bandwidthRows = $derived.by(() => {
    if (!data) return [];
    if (data.timelines?.bandwidth) return extractSeries(data.timelines.bandwidth, chartRange, 'bytes');
    if (data.bandwidthTimelines) {
      if (chartRange === 'hour') return (data.bandwidthTimelines.hourly || []).map((r: any) => ({ day: r.day, v: r.bytes }));
      if (chartRange === 'day') return (data.bandwidthTimelines.daily || []).map((r: any) => ({ day: r.day, v: r.bytes }));
      if (chartRange === 'month') return (data.bandwidthTimelines.monthly || []).map((r: any) => ({ day: r.day, v: r.bytes }));
      if (chartRange === 'lifetime') return (data.bandwidthTimelines.lifetime || []).map((r: any) => ({ day: r.day, v: r.bytes }));
    }
    return (data.bandwidthByDay || []).map((d: any) => ({ day: d.day, v: d.bytes }));
  });

  const bandwidthSavedRows = $derived.by(() => {
    if (!data) return [];
    if (data.timelines?.bandwidthSaved) return extractSeries(data.timelines.bandwidthSaved, chartRange, 'bytes');
    return (data.cacheSavedByDay || []).map((d: any) => ({ day: d.day, v: d.bytes }));
  });

  const downloadsRows = $derived.by(() => {
    if (!data) return [];
    if (data.timelines?.downloads) return extractSeries(data.timelines.downloads, chartRange, 'count');
    return (data.downloadsByDay || []).map((d: any) => ({ day: d.day, v: d.count }));
  });

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
      <KpiCard icon={Eye} color="bg-emerald" title="Total Media Views" value={data.stats.visits.toLocaleString()} subtitle={scope === 'shares' ? 'Shared-link access only' : 'Across all users & public shares'} details={viewsDetails} onclick={() => scrollToChart('views')} />
    </div>

    <!-- Visitor & Storage KPI Stats -->
    <div class="stats-grid">
      <KpiCard icon={Users} color="bg-cyan" title="Total Visitors" value={data.stats.visitors.total.toLocaleString()} subtitle="Page loads & media access events" details={visitorDetails} onclick={() => scrollToChart('visits')} />
      <KpiCard icon={Globe} color="bg-orange" title="Unique Visitors" value={data.stats.visitors.unique.toLocaleString()} subtitle="Distinct devices & browsers" details={uniqueDetails} onclick={() => scrollToChart('unique')} />
      <KpiCard icon={Download} color="bg-red" title="Bandwidth Served" value={formatBytes(data.stats.bandwidth)} subtitle="Total bytes served to clients" details={bandwidthDetails} onclick={() => scrollToChart('bandwidth')} />
      <KpiCard icon={Zap} color="bg-emerald" title="Bandwidth Saved (Cache)" value={formatBytes(data.stats.cacheSaved?.bytes || 0)} subtitle={`${data.stats.cacheSaved?.hitRatio ?? 0}% browser cache hit ratio`} details={cacheSavedDetails} onclick={() => scrollToChart('bandwidthSaved')} />
      <KpiCard icon={Download} color="bg-orange" title="Total Downloads" value={data.stats.downloads.toLocaleString()} subtitle="File & folder (zip) downloads" details={downloadsDetails} onclick={() => scrollToChart('downloads')} />
      <KpiCard icon={HardDrive} color="bg-amber" title="Cache Size" value={formatBytes(data.stats.cache.size)} subtitle="Thumbnails, previews & transcodes" details={cacheDetails} />
      <KpiCard icon={Database} color="bg-slate" title="Database Size" value={formatBytes(data.stats.db.size)} subtitle="PostgreSQL on-disk usage" details={dbDetails} />
    </div>

    <!-- Analytics Timelines & Trends -->
    <div id="analytics-timelines" class="card" style="margin-bottom: 1.5rem; scroll-margin-top: 2rem;">
      <div class="card-head-row">
        <div class="timeline-title-wrap">
          <h3><TrendingUp size={18} /> Analytics Timelines & Trends <span class="hint">{rangeHint}</span></h3>
          <p class="timeline-sub">Dedicated timeline graphs for total visitors, media views, unique devices, bandwidth, and file downloads.</p>
        </div>
        <div class="segmented" role="group" aria-label="Time granularity">
          <button class:active={chartRange === 'hour'} onclick={() => chartRange = 'hour'}>Hour</button>
          <button class:active={chartRange === 'day'} onclick={() => chartRange = 'day'}>Day</button>
          <button class:active={chartRange === 'month'} onclick={() => chartRange = 'month'}>Month</button>
          <button class:active={chartRange === 'lifetime'} onclick={() => chartRange = 'lifetime'}>Lifetime</button>
        </div>
      </div>

      <!-- Metric Switcher Tabs -->
      <div class="metric-tabs" role="tablist" aria-label="Timeline metric switcher">
        <button
          class="metric-tab"
          class:active={selectedMetric === 'visits'}
          onclick={() => selectedMetric = 'visits'}
          role="tab"
          aria-selected={selectedMetric === 'visits'}
        >
          <Users size={15} /> Total Visitors
        </button>
        <button
          class="metric-tab"
          class:active={selectedMetric === 'views'}
          onclick={() => selectedMetric = 'views'}
          role="tab"
          aria-selected={selectedMetric === 'views'}
        >
          <Eye size={15} /> Media Views
        </button>
        <button
          class="metric-tab"
          class:active={selectedMetric === 'unique'}
          onclick={() => selectedMetric = 'unique'}
          role="tab"
          aria-selected={selectedMetric === 'unique'}
        >
          <Globe size={15} /> Unique Visitors
        </button>
        <button
          class="metric-tab"
          class:active={selectedMetric === 'bandwidth'}
          onclick={() => selectedMetric = 'bandwidth'}
          role="tab"
          aria-selected={selectedMetric === 'bandwidth'}
        >
          <Download size={15} /> Bandwidth Served
        </button>
        <button
          class="metric-tab"
          class:active={selectedMetric === 'bandwidthSaved'}
          onclick={() => selectedMetric = 'bandwidthSaved'}
          role="tab"
          aria-selected={selectedMetric === 'bandwidthSaved'}
        >
          <Zap size={15} /> Bandwidth Saved (Cache)
        </button>
        <button
          class="metric-tab"
          class:active={selectedMetric === 'downloads'}
          onclick={() => selectedMetric = 'downloads'}
          role="tab"
          aria-selected={selectedMetric === 'downloads'}
        >
          <ArrowDownToLine size={15} /> Total Downloads
        </button>
        <button
          class="metric-tab show-all-tab"
          class:active={selectedMetric === 'all'}
          onclick={() => selectedMetric = 'all'}
          role="tab"
          aria-selected={selectedMetric === 'all'}
        >
          <Layers size={15} /> Show All
        </button>
      </div>

      <!-- Charts display -->
      <div class="timeline-charts-container">
        {#if selectedMetric === 'visits' || selectedMetric === 'all'}
          <div class="chart-block" class:chart-block-stacked={selectedMetric === 'all'}>
            <div class="chart-subhead">
              <span class="chart-subhead-title"><Users size={16} class="text-purple" /> Access Visits</span>
              <span class="muted">{rangeHint}</span>
            </div>
            <LineChart data={visitsRows} stroke="#a855f7" fillId="visitsFill" unit="visits total" />
          </div>
        {/if}

        {#if selectedMetric === 'views' || selectedMetric === 'all'}
          <div class="chart-block" class:chart-block-stacked={selectedMetric === 'all'}>
            <div class="chart-subhead">
              <span class="chart-subhead-title"><Eye size={16} class="text-emerald" /> Media Views</span>
              <span class="muted">{rangeHint}</span>
            </div>
            <LineChart data={viewsRows} stroke="#10b981" fillId="viewsFill" unit="views total" />
          </div>
        {/if}

        {#if selectedMetric === 'unique' || selectedMetric === 'all'}
          <div class="chart-block" class:chart-block-stacked={selectedMetric === 'all'}>
            <div class="chart-subhead">
              <span class="chart-subhead-title"><Globe size={16} class="text-cyan" /> Unique Visitors (Devices)</span>
              <span class="muted">{rangeHint}</span>
            </div>
            <LineChart data={uniqueRows} stroke="#06b6d4" fillId="uniqueFill" unit="unique devices" />
          </div>
        {/if}

        {#if selectedMetric === 'bandwidth' || selectedMetric === 'all'}
          <div class="chart-block" class:chart-block-stacked={selectedMetric === 'all'}>
            <div class="chart-subhead">
              <span class="chart-subhead-title"><Download size={16} class="text-amber" /> Bandwidth Served</span>
              <span class="muted">{rangeHint}</span>
            </div>
            <LineChart data={bandwidthRows} stroke="#f59e0b" fillId="bwFill" unit="served" formatTotal={formatBytes} />
          </div>
        {/if}

        {#if selectedMetric === 'bandwidthSaved' || selectedMetric === 'all'}
          <div class="chart-block" class:chart-block-stacked={selectedMetric === 'all'}>
            <div class="chart-subhead">
              <span class="chart-subhead-title"><Zap size={16} class="text-emerald" /> Bandwidth Saved from Local Cache</span>
              <span class="muted">{rangeHint}</span>
            </div>
            <LineChart data={bandwidthSavedRows} stroke="#10b981" fillId="bwSavedFill" unit="saved" formatTotal={formatBytes} />
          </div>
        {/if}

        {#if selectedMetric === 'downloads' || selectedMetric === 'all'}
          <div class="chart-block" class:chart-block-stacked={selectedMetric === 'all'}>
            <div class="chart-subhead">
              <span class="chart-subhead-title"><ArrowDownToLine size={16} class="text-rose" /> Total Downloads (Single + Folder ZIP)</span>
              <span class="muted">{rangeHint}</span>
            </div>
            <LineChart data={downloadsRows} stroke="#f43f5e" fillId="downloadsFill" unit="downloads total" />
          </div>
        {/if}
      </div>
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


    <!-- Technical & Performance Analytics -->
    <div class="section-title">
      <h3>Technical & Performance Analytics</h3>
      <p class="section-desc">Client load speeds, visitor engagement dwell time, feature interactions, and device environment.</p>
    </div>
    <TechnicalAnalytics technical={data.technical} />

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
        <h3><ShieldAlert size={18} /> Blocked & Security Events</h3>
        <div class="blocked-total">
          <div class="val">{data.blockedAttempts.total.toLocaleString()}</div>
          <div class="sub">
            blocked requests (vs {data.blockedAttempts.successfulTotal?.toLocaleString() || 0} successful)
          </div>
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
          <p class="muted">No blocked access attempts recorded in the last 7 days.</p>
        {/if}

        <div class="blocked-breakdown">
          <div class="breakdown-row">
            <span class="breakdown-label"><Shield size={14} style="color: #a855f7;" /> Turnstile Challenges</span>
            <span class="breakdown-count">{data.blockedAttempts.breakdown?.turnstile?.toLocaleString() || 0}</span>
          </div>
          <div class="breakdown-row">
            <span class="breakdown-label"><Clock size={14} style="color: #f59e0b;" /> Rate Limiting (429)</span>
            <span class="breakdown-count">{data.blockedAttempts.breakdown?.rateLimit?.toLocaleString() || 0}</span>
          </div>
          <div class="breakdown-row">
            <span class="breakdown-label"><Lock size={14} style="color: #ef4444;" /> Unauthorized / Expired</span>
            <span class="breakdown-count">{data.blockedAttempts.breakdown?.unauthorized?.toLocaleString() || 0}</span>
          </div>
          <div class="breakdown-row">
            <span class="breakdown-label"><UserX size={14} style="color: #f43f5e;" /> Login Lockout</span>
            <span class="breakdown-count">{data.blockedAttempts.breakdown?.loginLockout?.toLocaleString() || 0}</span>
          </div>
          <div class="breakdown-row">
            <span class="breakdown-label"><FileQuestion size={14} style="color: #94a3b8;" /> 404 Not Found</span>
            <span class="breakdown-count">{data.blockedAttempts.breakdown?.notFound?.toLocaleString() || 0}</span>
          </div>
        </div>
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
  .card-head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  .card-head-row h3 { margin: 0; }
  .timeline-title-wrap { display: flex; flex-direction: column; gap: 0.25rem; }
  .timeline-title-wrap h3 { margin: 0; }
  .timeline-sub { font-size: 0.8rem; color: #71717a; margin: 0; }

  .metric-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .metric-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #a1a1aa;
    padding: 0.4rem 0.85rem;
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .metric-tab:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #f4f4f5;
  }
  .metric-tab.active {
    background: rgba(168, 85, 247, 0.2);
    border-color: rgba(168, 85, 247, 0.5);
    color: #f4f4f5;
  }
  .metric-tab.show-all-tab.active {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(59, 130, 246, 0.5);
  }
  .timeline-charts-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .chart-block {
    display: flex;
    flex-direction: column;
  }
  .chart-block-stacked {
    padding-top: 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }
  .chart-block-stacked:first-child {
    padding-top: 0;
    border-top: none;
  }
  .chart-subhead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .chart-subhead-title {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: #e4e4e7;
  }
  :global(.text-purple) { color: #c084fc; }
  :global(.text-emerald) { color: #34d399; }
  :global(.text-cyan) { color: #22d3ee; }
  :global(.text-amber) { color: #fbbf24; }
  :global(.text-rose) { color: #fb7185; }
  .section-title { margin: 2rem 0 1rem 0; }
  .section-title h3 { margin: 0 0 0.25rem 0; font-size: 1.3rem; color: #f4f4f5; }
  .section-desc { margin: 0; color: #a1a1aa; font-size: 0.85rem; }

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

  /* Line chart & heatmap styling is owned by LineChart.svelte / PeakHoursHeatmap.svelte */

  /* Blocked attempts */
  .blocked-total { margin-bottom: 1rem; }
  .blocked-bars { display: flex; align-items: flex-end; gap: 4px; height: 90px; margin-bottom: 0.35rem; }
  .blocked-col { flex: 1; display: flex; align-items: flex-end; justify-content: center; }
  .blocked-bar { width: 70%; background: linear-gradient(180deg, #f87171, #7f1d1d); border-radius: 3px 3px 0 0; min-height: 6px; }

  .blocked-breakdown {
    margin-top: 1rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .breakdown-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
  }
  .breakdown-label {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: rgba(255, 255, 255, 0.7);
  }
  .breakdown-count {
    font-family: monospace;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.95);
  }

  .spinner {
    border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #a855f7;
    border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 4rem auto;
  }
  @keyframes spin { 100% { transform: rotate(360deg); } }

  @media (max-width: 900px) {
    h2 { font-size: 1.5rem; }
    .tables-grid { grid-template-columns: 1fr; }
    .tables-grid .card { overflow-x: auto; }
    .stats-grid { gap: 1rem; }
    .card { padding: 1rem; }
    .card h3 { font-size: 1rem; }
  }
</style>
