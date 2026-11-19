<script lang="ts">
  interface Props {
    data: { day: string; v: number }[];
    stroke: string;
    fillId: string;
    unit?: string;
    formatTotal?: (v: number) => string;
  }

  let { data, stroke, fillId, unit = 'total', formatTotal }: Props = $props();

  let containerWidth = $state(720);
  const chartWidth = $derived(Math.max(containerWidth || 720, 320));
  const CHART_H = 210;
  const PAD_LEFT = 52;
  const PAD_RIGHT = 16;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 24;

  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function formatDateShort(d: string): string {
    if (!d) return '';
    // "YYYY-MM-DD HH:mm" (Hourly)
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(d)) {
      const [datePart, timePart] = d.split(' ');
      const parts = datePart.split('-');
      const m = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return `${day} ${MONTHS_SHORT[m] || parts[1]}`;
    }
    // "YYYY-MM-DD" (Daily)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const parts = d.split('-');
      const m = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return `${day} ${MONTHS_SHORT[m] || parts[1]}`;
    }
    // "YYYY-MM" (Monthly)
    if (/^\d{4}-\d{2}$/.test(d)) {
      const parts = d.split('-');
      const m = parseInt(parts[1], 10) - 1;
      return `${MONTHS_SHORT[m] || parts[1]} ${parts[0]}`;
    }
    return d;
  }

  function formatDateFull(d: string): string {
    if (!d) return '';
    // "YYYY-MM-DD HH:mm" (Hourly)
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(d)) {
      const [datePart, timePart] = d.split(' ');
      const parts = datePart.split('-');
      const m = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return `${day} ${MONTHS_SHORT[m] || parts[1]} ${parts[0]}, ${timePart}`;
    }
    // "YYYY-MM-DD" (Daily)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const parts = d.split('-');
      const m = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return `${day} ${MONTHS_SHORT[m] || parts[1]} ${parts[0]}`;
    }
    // "YYYY-MM" (Monthly)
    if (/^\d{4}-\d{2}$/.test(d)) {
      const parts = d.split('-');
      const m = parseInt(parts[1], 10) - 1;
      return `${MONTHS_FULL[m] || parts[1]} ${parts[0]}`;
    }
    return d;
  }

  function formatAxisLabel(d: string): string {
    if (!d) return '';
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(d)) {
      return d.split(' ')[1];
    }
    return formatDateShort(d);
  }

  function formatYVal(v: number): string {
    if (v === 0) return '0';
    if (formatTotal) return formatTotal(v);
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return v.toLocaleString();
  }

  const series = $derived(buildSeries(data, chartWidth));

  function buildSeries(rows: { day: string; v: number }[], width: number) {
    if (rows.length === 0) return { points: '', area: '', labels: [], pointsData: [], yTicks: [], total: 0 };
    const maxVal = Math.max(...rows.map(r => r.v), 0);
    const max = maxVal === 0 ? 10 : maxVal;
    const n = rows.length;
    const plotW = width - PAD_LEFT - PAD_RIGHT;
    const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;

    const x = (i: number) => PAD_LEFT + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
    const y = (v: number) => PAD_TOP + plotH - (v / max) * plotH;

    const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.v).toFixed(1)}`).join(' ');
    const firstX = x(0).toFixed(1);
    const lastX = x(n - 1).toFixed(1);
    const bottomY = (PAD_TOP + plotH).toFixed(1);
    const area = `${firstX},${bottomY} ${pts} ${lastX},${bottomY}`;

    // X-axis labels
    const maxLabels = Math.max(2, Math.floor(plotW / 85));
    const step = Math.max(1, Math.ceil(n / maxLabels));
    const labels: { x: number; label: string }[] = [];
    for (let i = 0; i < n; i += step) {
      labels.push({ x: x(i), label: formatAxisLabel(rows[i].day) });
    }
    if (n > 1) {
      const lastLabel = { x: x(n - 1), label: formatAxisLabel(rows[n - 1].day) };
      const prevX = labels[labels.length - 1]?.x ?? -999;
      if (lastLabel.x - prevX > 45) {
        labels.push(lastLabel);
      } else if (labels.length > 1) {
        labels[labels.length - 1] = lastLabel;
      }
    }

    const pointsData = rows.map((r, i) => ({ x: x(i), y: y(r.v), val: r.v, day: r.day }));

    const yTicks = maxVal === 0
      ? [{ val: 0, y: PAD_TOP + plotH }]
      : [
          { val: maxVal, y: PAD_TOP },
          { val: Math.round(maxVal * 0.66), y: PAD_TOP + plotH * 0.34 },
          { val: Math.round(maxVal * 0.33), y: PAD_TOP + plotH * 0.67 },
          { val: 0, y: PAD_TOP + plotH }
        ];

    return {
      points: pts,
      area,
      labels,
      pointsData,
      yTicks,
      total: rows.reduce((s, r) => s + r.v, 0)
    };
  }

  let hoveredIndex = $state<number | null>(null);

  const hoveredPoint = $derived(
    hoveredIndex !== null && series.pointsData[hoveredIndex]
      ? series.pointsData[hoveredIndex]
      : null
  );

  const tooltipPos = $derived.by(() => {
    if (!hoveredPoint) return { left: 0, top: 0 };
    const isRightSide = hoveredPoint.x > chartWidth - 140;
    const left = isRightSide ? hoveredPoint.x - 130 : hoveredPoint.x + 15;
    const top = Math.max(10, Math.min(CHART_H - 60, hoveredPoint.y - 25));
    return { left, top };
  });

  function handlePointerMove(e: PointerEvent) {
    if (series.pointsData.length === 0) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * chartWidth;

    let closestIdx = 0;
    let minDiff = Infinity;
    series.pointsData.forEach((p, idx) => {
      const diff = Math.abs(p.x - relX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    hoveredIndex = closestIdx;
  }

  function handlePointerLeave() {
    hoveredIndex = null;
  }
</script>

{#if data.length === 0}
  <p class="muted">No data recorded yet.</p>
{:else}
  <div class="chart-wrapper" bind:clientWidth={containerWidth}>
    <div class="chart-head">
      <span class="muted">{formatDateShort(data[0].day)}</span>
      <span class="chart-head-center">
        {#if hoveredPoint}
          <span class="muted">{formatDateShort(hoveredPoint.day)}:</span>
          <strong style="color: {stroke}; margin-left: 4px;">{formatTotal ? formatTotal(hoveredPoint.val) : hoveredPoint.val.toLocaleString()}</strong> {unit}
        {:else}
          <span><strong>{formatTotal ? formatTotal(series.total) : series.total.toLocaleString()}</strong> {unit}</span>
        {/if}
      </span>
      <span class="muted">{formatDateShort(data[data.length - 1].day)}</span>
    </div>

    <svg
      viewBox="0 0 {chartWidth} {CHART_H}"
      class="line-chart"
      role="img"
      aria-label="Trend chart"
      onpointermove={handlePointerMove}
      onpointerleave={handlePointerLeave}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={stroke} stop-opacity="0.32" />
          <stop offset="100%" stop-color={stroke} stop-opacity="0.02" />
        </linearGradient>
      </defs>

      <!-- Horizontal grid lines & Y-axis labels -->
      {#each series.yTicks as tick}
        <line
          x1={PAD_LEFT}
          x2={chartWidth - PAD_RIGHT}
          y1={tick.y}
          y2={tick.y}
          stroke="rgba(255, 255, 255, 0.08)"
          stroke-dasharray="3 3"
        />
        <text
          x={PAD_LEFT - 8}
          y={tick.y + 3.5}
          text-anchor="end"
          fill="#71717a"
          font-size="10"
          font-family="system-ui, -apple-system, sans-serif"
        >
          {formatYVal(tick.val)}
        </text>
      {/each}

      <!-- Chart area fill and line -->
      <polygon points={series.area} fill="url(#{fillId})" />
      <polyline
        points={series.points}
        fill="none"
        stroke={stroke}
        stroke-width="2.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />

      <!-- Subtle data points -->
      {#each series.pointsData as p, i}
        <circle
          cx={p.x}
          cy={p.y}
          r={series.pointsData.length > 50 ? 2 : 3.5}
          fill={stroke}
          opacity={hoveredIndex === i ? 0 : 0.6}
        />
      {/each}

      <!-- Active hover highlight -->
      {#if hoveredPoint}
        <line
          x1={hoveredPoint.x}
          x2={hoveredPoint.x}
          y1={PAD_TOP}
          y2={PAD_TOP + (CHART_H - PAD_TOP - PAD_BOTTOM)}
          stroke="rgba(255, 255, 255, 0.22)"
          stroke-width="1.5"
          stroke-dasharray="3 3"
        />
        <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="8" fill={stroke} />
        <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="12" fill="none" stroke={stroke} stroke-width="2" opacity="0.4" />
        <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="3.5" fill="#ffffff" />
      {/if}
    </svg>

    <!-- Floating tooltip -->
    {#if hoveredPoint}
      <div
        class="chart-tooltip"
        style="left: {tooltipPos.left}px; top: {tooltipPos.top}px;"
      >
        <div class="tooltip-date">{formatDateFull(hoveredPoint.day)}</div>
        <div class="tooltip-val" style="color: {stroke}">
          {formatTotal ? formatTotal(hoveredPoint.val) : hoveredPoint.val.toLocaleString()}
          <span class="tooltip-unit">{unit}</span>
        </div>
      </div>
    {/if}

    <!-- X-axis labels aligned with data points -->
    <div class="chart-labels">
      {#each series.labels as l}
        <span class="x-label" style="left: {l.x}px;">{l.label}</span>
      {/each}
    </div>
  </div>
{/if}

<style>
  .chart-wrapper {
    position: relative;
    width: 100%;
    user-select: none;
  }
  .chart-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
    color: #a1a1aa;
    min-height: 1.4rem;
  }
  .chart-head-center {
    font-size: 0.85rem;
  }
  .line-chart {
    width: 100%;
    height: 210px;
    display: block;
    overflow: visible;
    cursor: crosshair;
  }
  .chart-labels {
    position: relative;
    width: 100%;
    height: 1.4rem;
    margin-top: 0.35rem;
  }
  .x-label {
    position: absolute;
    transform: translateX(-50%);
    font-size: 0.72rem;
    color: #71717a;
    white-space: nowrap;
  }
  .chart-tooltip {
    position: absolute;
    pointer-events: none;
    background: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 0.75rem;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
    z-index: 20;
    white-space: nowrap;
  }
  .tooltip-date {
    color: #a1a1aa;
    font-size: 0.7rem;
    margin-bottom: 2px;
  }
  .tooltip-val {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .tooltip-unit {
    font-size: 0.7rem;
    font-weight: normal;
    color: #94a3b8;
    margin-left: 3px;
  }
  .muted {
    color: #71717a;
    font-size: 0.85rem;
  }
</style>
