<script lang="ts">
  interface Props {
    data: { day: string; v: number }[];
    stroke: string;
    fillId: string;
    unit?: string;
    formatTotal?: (v: number) => string;
  }

  let { data, stroke, fillId, unit = 'total', formatTotal }: Props = $props();

  const CHART_W = 720;
  const CHART_H = 200;
  const PAD = 8;

  const series = $derived(buildSeries(data));

  function buildSeries(rows: { day: string; v: number }[]) {
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
</script>

{#if data.length === 0}
  <p class="muted">No data recorded yet.</p>
{:else}
  <div class="chart-head">
    <span class="muted">{data[0].day}</span>
    <span><strong>{formatTotal ? formatTotal(series.total) : series.total.toLocaleString()}</strong> {unit}</span>
    <span class="muted">{data[data.length - 1].day}</span>
  </div>
  <svg viewBox="0 0 {CHART_W} {CHART_H}" preserveAspectRatio="none" class="line-chart" role="img" aria-label="Trend over the last 30 days">
    <defs>
      <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={stroke} stop-opacity="0.35" />
        <stop offset="100%" stop-color={stroke} stop-opacity="0.02" />
      </linearGradient>
    </defs>
    <polygon points={series.area} fill="url(#{fillId})" />
    <polyline points={series.points} fill="none" stroke={stroke} stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
  <div class="chart-labels">
    {#each series.labels as l}
      <span>{l.label}</span>
    {/each}
  </div>
{/if}

<style>
  .chart-head { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom: 0.5rem; color: #a1a1aa; }
  .line-chart { width: 100%; height: 200px; display: block; }
  .chart-labels { display: flex; justify-content: space-between; font-size: 0.7rem; color: #71717a; margin-top: 0.35rem; }
  .muted { color: #71717a; font-size: 0.85rem; }
</style>
