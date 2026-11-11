<script lang="ts">
  import ExpandableList from '$lib/components/ExpandableList.svelte';
  import HoverThumb from '$lib/components/HoverThumb.svelte';
  import {
    Gauge,
    Clock,
    Eye,
    Download,
    Wifi,
    Monitor,
    Folder,
    Layers,
    Sparkles,
    SlidersHorizontal,
    Compass,
    ZoomIn,
    Info,
    FileText,
    ArrowDownUp,
    Share2,
    CheckCircle2,
    Zap
  } from '@lucide/svelte';

  interface Props {
    technical: any;
  }

  let { technical }: Props = $props();

  function formatMs(ms: number | null | undefined): string {
    if (!ms || ms <= 0) return '—';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }

  function formatDuration(sec: number | null | undefined): string {
    if (!sec || sec <= 0) return '—';
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  function formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  const featureLabels: Record<string, { label: string; icon: any }> = {
    zoom: { label: 'Zoom & Pan Image', icon: ZoomIn },
    download: { label: 'Single Photo Download', icon: Download },
    download_folder: { label: 'Folder ZIP Download', icon: Folder },
    information: { label: 'Info Drawer Opened', icon: Info },
    advanced_exif: { label: 'Advanced EXIF Inspected', icon: FileText },
    sort_change: { label: 'Sort Order Changed', icon: ArrowDownUp },
    view_mode_change: { label: 'View Mode Switched', icon: Layers },
    folder_view_mode_change: { label: 'Folder Grid Switched', icon: SlidersHorizontal },
    copy_link: { label: 'Link Copied', icon: Share2 },
    slideshow: { label: 'Slideshow Started', icon: Sparkles },
    fullscreen: { label: 'Fullscreen Toggled', icon: Monitor }
  };

  function getFeatureMeta(name: string) {
    return featureLabels[name] || { label: name.replace(/_/g, ' '), icon: Sparkles };
  }

  function barWidth(count: number, max: number) {
    if (!max || max <= 0) return 0;
    return Math.min(100, Math.max(4, Math.round((count / max) * 100)));
  }

  const maxFeatureCount = $derived(
    Math.max(1, ...(technical?.featuresUsed || []).map((f: any) => f.count || 0))
  );

  const maxSessionDist = $derived(
    Math.max(1, ...(technical?.sessionTime?.distribution || []).map((d: any) => d.count || 0))
  );

  const maxPageLoadDist = $derived(
    Math.max(1, ...(technical?.pageLoad?.distribution || []).map((d: any) => d.count || 0))
  );

  const maxPhotoDwellDist = $derived(
    Math.max(1, ...(technical?.photoDwell?.distribution || []).map((d: any) => d.count || 0))
  );

  const maxScrollDepthDist = $derived(
    Math.max(1, ...(technical?.scrollDepth?.distribution || []).map((d: any) => d.count || 0))
  );

  const maxSortCount = $derived(
    Math.max(1, ...(technical?.sortModes || []).map((s: any) => s.count || 0))
  );

  const maxViewCount = $derived(
    Math.max(1, ...(technical?.viewModes || []).map((v: any) => v.count || 0))
  );

  function folderHref(path: string): string {
    return path ? `/folder/${path}` : '/';
  }

  function fileHref(folder: string, name: string): string {
    return folder ? `/folder/${folder}?file=${encodeURIComponent(name)}` : `/?file=${encodeURIComponent(name)}`;
  }
</script>

{#if !technical}
  <p class="muted">No technical telemetry recorded yet.</p>
{:else}
  <!-- Technical KPI row -->
  <div class="tech-kpis">
    <div class="stat-card">
      <div class="icon-wrap bg-purple"><Gauge size={22} /></div>
      <div class="stat-info">
        <h4>Avg Page Load Time</h4>
        <div class="val">{formatMs(technical.pageLoad?.avgMs)}</div>
        <div class="sub">p95: {formatMs(technical.pageLoad?.p95Ms)} · {technical.pageLoad?.samples || 0} samples</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="icon-wrap bg-blue"><Clock size={22} /></div>
      <div class="stat-info">
        <h4>Avg Session Time</h4>
        <div class="val">{formatDuration(technical.sessionTime?.avgSeconds)}</div>
        <div class="sub">Longest session: {formatDuration(technical.sessionTime?.maxSeconds)}</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="icon-wrap bg-emerald"><Eye size={22} /></div>
      <div class="stat-info">
        <h4>Avg Photo View Dwell</h4>
        <div class="val">{formatMs(technical.photoDwell?.avgMs)}</div>
        <div class="sub">Max dwell: {formatMs(technical.photoDwell?.maxMs)}</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="icon-wrap bg-amber"><Compass size={22} /></div>
      <div class="stat-info">
        <h4>Avg Gallery Scroll Depth</h4>
        <div class="val">{technical.avgScrollDepth ? `${technical.avgScrollDepth}%` : '—'}</div>
        <div class="sub">Avg download: {formatMs(technical.downloads?.avgDownloadMs)}</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="icon-wrap bg-cyan"><Zap size={22} /></div>
      <div class="stat-info">
        <h4>Browser Cache Hit Ratio</h4>
        <div class="val">{technical.cacheEfficiency ? `${technical.cacheEfficiency.hitRatio}%` : '—'}</div>
        <div class="sub">{formatBytes(technical.cacheEfficiency?.bytesSaved || 0)} bandwidth saved</div>
      </div>
    </div>
  </div>

  <!-- Performance & Dwell Time Distributions -->
  <div class="charts-grid">
    <div class="card">
      <h3><Gauge size={18} /> Page Load Time Distribution <span class="hint">speed</span></h3>
      {#if !technical.pageLoad?.distribution || technical.pageLoad.distribution.length === 0}
        <p class="muted">No page load telemetry recorded yet.</p>
      {:else}
        {#each technical.pageLoad.distribution as dist}
          <div class="bar-row">
            <div class="bar-label">
              <span>{dist.name}</span>
              <span class="muted">{dist.count.toLocaleString()} loads</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill purple" style="width: {barWidth(dist.count, maxPageLoadDist)}%"></div>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="card">
      <h3><Clock size={18} /> Session Length Distribution <span class="hint">dwell</span></h3>
      {#if !technical.sessionTime?.distribution || technical.sessionTime.distribution.length === 0}
        <p class="muted">No session duration data yet.</p>
      {:else}
        {#each technical.sessionTime.distribution as dist}
          <div class="bar-row">
            <div class="bar-label">
              <span>{dist.name}</span>
              <span class="muted">{dist.count.toLocaleString()} sessions</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill blue" style="width: {barWidth(dist.count, maxSessionDist)}%"></div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Photo Dwell & Scroll Depth Distributions -->
  <div class="charts-grid">
    <div class="card">
      <h3><Eye size={18} /> Photo View Dwell Distribution <span class="hint">dwell time</span></h3>
      {#if !technical.photoDwell?.distribution || technical.photoDwell.distribution.length === 0}
        <p class="muted">No photo dwell telemetry recorded yet.</p>
      {:else}
        {#each technical.photoDwell.distribution as dist}
          <div class="bar-row">
            <div class="bar-label">
              <span>{dist.name}</span>
              <span class="muted">{dist.count.toLocaleString()} views</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill emerald" style="width: {barWidth(dist.count, maxPhotoDwellDist)}%"></div>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="card">
      <h3><Compass size={18} /> Gallery Scroll Depth Distribution <span class="hint">scroll reach</span></h3>
      {#if !technical.scrollDepth?.distribution || technical.scrollDepth.distribution.length === 0}
        <p class="muted">No scroll depth telemetry recorded yet.</p>
      {:else}
        {#each technical.scrollDepth.distribution as dist}
          <div class="bar-row">
            <div class="bar-label">
              <span>{dist.name}</span>
              <span class="muted">{dist.count.toLocaleString()} visits</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill amber" style="width: {barWidth(dist.count, maxScrollDepthDist)}%"></div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Features & Interactions -->
  <div class="charts-grid">
    <div class="card">
      <h3><Sparkles size={18} /> Features & Interactions Used</h3>
      {#if !technical.featuresUsed || technical.featuresUsed.length === 0}
        <p class="muted">No feature interactions recorded yet.</p>
      {:else}
        <ExpandableList items={technical.featuresUsed} limit={8}>
          {#snippet children(rows)}
            {#each rows as row}
              {@const meta = getFeatureMeta(row.name)}
              {@const Icon = meta.icon}
              <div class="bar-row">
                <div class="bar-label">
                  <span class="feature-name"><Icon size={15} /> {meta.label}</span>
                  <span class="muted">{row.count.toLocaleString()}</span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill rose" style="width: {barWidth(row.count, maxFeatureCount)}%"></div>
                </div>
              </div>
            {/each}
          {/snippet}
        </ExpandableList>
      {/if}
    </div>

    <!-- UI Preferences (Sort & View Modes) in a combined card -->
    <div class="card">
      <h3><Layers size={18} /> View & Sort Mode Preferences</h3>
      {#if (!technical.sortModes || technical.sortModes.length === 0) && (!technical.viewModes || technical.viewModes.length === 0)}
        <p class="muted">No preference events recorded yet.</p>
      {:else}
        <div style="margin-bottom: 1.25rem;">
          <div class="sub-label"><ArrowDownUp size={14} /> Sort Modes</div>
          {#each (technical.sortModes || []) as row}
            <div class="bar-row">
              <div class="bar-label">
                <span class="capitalize">{row.name}</span>
                <span class="muted">{row.count.toLocaleString()}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill emerald" style="width: {barWidth(row.count, maxSortCount)}%"></div>
              </div>
            </div>
          {/each}
        </div>

        <div>
          <div class="sub-label"><Layers size={14} /> View Modes</div>
          {#each (technical.viewModes || []) as row}
            <div class="bar-row">
              <div class="bar-label">
                <span class="capitalize">{row.name.replace(/-/g, ' ')}</span>
                <span class="muted">{row.count.toLocaleString()}</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill cyan" style="width: {barWidth(row.count, maxViewCount)}%"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Top Photos by Dwell Time & Folders Visited -->
  <div class="tables-grid">
    <div class="card">
      <h3><Eye size={18} /> Most Engaged Photos <span class="hint">dwell time</span></h3>
      {#if !technical.photoDwell?.topMedia || technical.photoDwell.topMedia.length === 0}
        <p class="muted">No photo dwell time recorded yet.</p>
      {:else}
        <ExpandableList items={technical.photoDwell.topMedia} limit={8}>
          {#snippet children(rows)}
            <table>
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Folder</th>
                  <th class="text-right">Avg Dwell</th>
                  <th class="text-right">Total Dwell</th>
                </tr>
              </thead>
              <tbody>
                {#each rows as media}
                  <tr>
                    <td class="truncate" title={media.file_name}>
                      <HoverThumb id={media.id}>
                        <a href={fileHref(media.folder_path, media.file_name)} target="_blank" rel="noreferrer" class="link-cell">
                          {media.file_name}
                        </a>
                      </HoverThumb>
                    </td>
                    <td class="muted truncate" title={media.folder_path}>
                      <a href={folderHref(media.folder_path)} target="_blank" rel="noreferrer" class="link-cell">
                        {media.folder_path || '/'}
                      </a>
                    </td>
                    <td class="text-right"><strong>{media.avg_dwell_s}s</strong></td>
                    <td class="text-right text-muted">{formatDuration(media.total_dwell_s)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/snippet}
        </ExpandableList>
      {/if}
    </div>

    <div class="card">
      <h3><Folder size={18} /> Folders Visited in Sessions</h3>
      {#if !technical.foldersVisited || technical.foldersVisited.length === 0}
        <p class="muted">No folder session paths recorded yet.</p>
      {:else}
        <ExpandableList items={technical.foldersVisited} limit={8}>
          {#snippet children(rows)}
            <table>
              <thead>
                <tr>
                  <th>Folder Path</th>
                  <th class="text-right">Visits</th>
                </tr>
              </thead>
              <tbody>
                {#each rows as item}
                  <tr>
                    <td class="truncate" title={item.folder}>
                      <a href={folderHref(item.folder)} target="_blank" rel="noreferrer" class="link-cell">
                        {item.folder || '/'}
                      </a>
                    </td>
                    <td class="text-right"><strong>{item.count.toLocaleString()}</strong></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/snippet}
        </ExpandableList>
      {/if}
    </div>
  </div>

  <!-- Network & Displays context -->
  <div class="charts-grid">
    <div class="card">
      <h3><Wifi size={18} /> Network Connection Types</h3>
      {#if !technical.networkBreakdown || technical.networkBreakdown.length === 0}
        <p class="muted">No network telemetry yet.</p>
      {:else}
        {#each technical.networkBreakdown as row}
          <div class="bar-row">
            <div class="bar-label">
              <span class="capitalize">{row.name}</span>
              <span class="muted">{row.count.toLocaleString()}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill purple" style="width: {barWidth(row.count, technical.networkBreakdown[0]?.count || 1)}%"></div>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="card">
      <h3><Monitor size={18} /> Screen Displays & Resolutions</h3>
      {#if !technical.screenResolutions || technical.screenResolutions.length === 0}
        <p class="muted">No display telemetry yet.</p>
      {:else}
        {#each technical.screenResolutions as row}
          <div class="bar-row">
            <div class="bar-label">
              <span class="font-mono">{row.name}</span>
              <span class="muted">{row.count.toLocaleString()}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill blue" style="width: {barWidth(row.count, technical.screenResolutions[0]?.count || 1)}%"></div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .tech-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .stat-card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 1.25rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .icon-wrap {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .bg-purple { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
  .bg-blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
  .bg-emerald { background: rgba(16, 185, 129, 0.15); color: #34d399; }
  .bg-amber { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
  .bg-cyan { background: rgba(6, 182, 212, 0.15); color: #22d3ee; }

  .stat-info h4 { margin: 0; font-size: 0.8rem; color: #a1a1aa; font-weight: 500; }
  .stat-info .val { font-size: 1.4rem; font-weight: 700; color: #f4f4f5; margin: 0.2rem 0; }
  .stat-info .sub { font-size: 0.75rem; color: #71717a; }

  .card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 1.5rem;
  }
  .card h3 {
    margin: 0 0 1.25rem 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.05rem;
  }

  .charts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .tables-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .bar-row { margin-bottom: 0.85rem; }
  .bar-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; font-size: 0.85rem; }
  .feature-name { display: inline-flex; align-items: center; gap: 0.4rem; }
  .bar-track { height: 8px; background: rgba(255, 255, 255, 0.06); border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
  .bar-fill.purple { background: linear-gradient(90deg, #7c3aed, #c084fc); }
  .bar-fill.blue { background: linear-gradient(90deg, #2563eb, #60a5fa); }
  .bar-fill.emerald { background: linear-gradient(90deg, #059669, #34d399); }
  .bar-fill.cyan { background: linear-gradient(90deg, #0891b2, #22d3ee); }
  .bar-fill.amber { background: linear-gradient(90deg, #d97706, #fbbf24); }
  .bar-fill.rose { background: linear-gradient(90deg, #e11d48, #fb7185); }

  .sub-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: #cbd5e1;
    margin-bottom: 0.5rem;
  }

  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; padding: 0.6rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); color: #a1a1aa; font-weight: 500; }
  td { padding: 0.6rem 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .text-right { text-align: right; }
  .text-muted { color: #71717a; }
  .muted { color: #71717a; font-size: 0.85rem; }
  .truncate { max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .link-cell { color: #93c5fd; text-decoration: none; }
  .link-cell:hover { text-decoration: underline; }
  .capitalize { text-transform: capitalize; }
  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; }
  .hint { font-size: 0.75rem; color: #71717a; font-weight: 400; background: rgba(255,255,255,0.06); padding: 0.15rem 0.5rem; border-radius: 999px; margin-left: 0.5rem; }

  @media (max-width: 900px) {
    .tables-grid { grid-template-columns: 1fr; }
    .tables-grid .card { overflow-x: auto; }
  }
</style>
