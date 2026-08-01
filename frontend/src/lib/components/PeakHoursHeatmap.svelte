<script lang="ts">
  interface Props {
    hours: { hour: number; count: number }[];
  }

  let { hours }: Props = $props();

  const cells = $derived(buildCells(hours));

  function buildCells(rows: { hour: number; count: number }[]) {
    const map: Record<number, number> = {};
    for (const h of rows) map[h.hour] = h.count;
    const max = Math.max(1, ...Object.values(map));
    const out = [];
    for (let h = 0; h < 24; h++) {
      out.push({ hour: h, count: map[h] || 0, intensity: map[h] ? 0.2 + (map[h] / max) * 0.8 : 0 });
    }
    return out;
  }
</script>

{#if hours.length === 0}
  <p class="muted">No visitor data yet.</p>
{:else}
  <div class="heatmap" role="img" aria-label="Visit intensity by hour of day">
    {#each cells as cell}
      <div class="heat-cell" title="{cell.hour}:00 – {cell.count.toLocaleString()} visits" style="--intensity: {cell.intensity}">
        <span class="heat-label">{cell.hour}</span>
      </div>
    {/each}
  </div>
  <div class="heat-legend"><span>0</span><span>Fewer</span><span>More</span></div>
{/if}

<style>
  .heatmap { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; }
  .heat-cell {
    aspect-ratio: 1; border-radius: 4px; position: relative;
    background: rgba(168, 85, 247, calc(0.06 + (var(--intensity) * 0.9)));
  }
  .heat-label { display: none; }
  .heat-cell:hover .heat-label { display: block; position: absolute; top: -2px; left: 50%; transform: translate(-50%, -100%); background: rgba(0,0,0,0.85); color: #fff; font-size: 0.6rem; padding: 2px 4px; border-radius: 4px; white-space: nowrap; z-index: 5; }
  .heat-legend { display: flex; justify-content: flex-end; gap: 0.75rem; font-size: 0.7rem; color: #71717a; margin-top: 0.5rem; }
  .muted { color: #71717a; font-size: 0.85rem; }
</style>
