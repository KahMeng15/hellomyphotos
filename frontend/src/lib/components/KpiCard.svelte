<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';

  interface Props {
    icon: any;
    color: string;
    title: string;
    value: string;
    subtitle: string;
    details?: { label: string; value: string; href?: string }[];
  }

  let { icon: Icon, color, title, value, subtitle, details = [] }: Props = $props();
  let expanded = $state(false);
</script>

<div class="kpi-wrap">
  <div class="stat-card">
    <div class="icon-wrap {color}"><Icon size={24} /></div>
    <div class="stat-info">
      <h4>{title}</h4>
      <div class="val">{value}</div>
      <div class="sub">{subtitle}</div>
    </div>
    {#if details.length > 0}
      <button class="kpi-expand" onclick={() => (expanded = !expanded)} aria-expanded={expanded} aria-label={`Expand ${title}`} title={expanded ? 'Collapse' : 'View full list'}>
        <ChevronDown size={16} class={expanded ? 'rotated' : ''} />
      </button>
    {/if}
  </div>
  {#if expanded}
    <div class="kpi-detail card">
      <div class="kpi-detail-scroll">
        <table>
          <tbody>
            {#each details as d}
              <tr>
                <td class="kpi-label" title={d.label}>{#if d.href}<a href={d.href} target="_blank" rel="noreferrer" class="kpi-link">{d.label}</a>{:else}{d.label}{/if}</td>
                <td class="text-right"><strong>{d.value}</strong></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

<style>
  .kpi-wrap { display: contents; }

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
  .icon-wrap { width: 56px; height: 56px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .bg-blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
  .bg-purple { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
  .bg-emerald { background: rgba(16, 185, 129, 0.15); color: #34d399; }
  .bg-cyan { background: rgba(6, 182, 212, 0.15); color: #22d3ee; }
  .bg-orange { background: rgba(249, 115, 22, 0.15); color: #fb923c; }
  .bg-amber { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
  .bg-slate { background: rgba(100, 116, 139, 0.15); color: #94a3b8; }
  .bg-red { background: rgba(239, 68, 68, 0.15); color: #f87171; }

  .stat-info { flex: 1; min-width: 0; }
  .stat-info h4 { margin: 0 0 0.25rem 0; color: #a1a1aa; font-weight: 500; font-size: 0.9rem; }
  .val { font-size: 2rem; font-weight: 700; line-height: 1; margin-bottom: 0.25rem; }
  .sub { font-size: 0.8rem; color: #71717a; }

  .kpi-expand {
    flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.06); color: #a1a1aa; display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: background 0.2s, color 0.2s;
  }
  .kpi-expand:hover { background: rgba(255,255,255,0.12); color: #e4e4e7; }
  .kpi-expand :global(svg) { transition: transform 0.2s; }
  .kpi-expand :global(svg.rotated) { transform: rotate(180deg); }

  .kpi-detail {
    grid-column: 1 / -1;
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 1.25rem;
  }
  .kpi-detail-scroll { max-height: 340px; overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  td { padding: 0.5rem 0.35rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .kpi-label { max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #a1a1aa; }
  .kpi-link { color: #93c5fd; text-decoration: none; }
  .kpi-link:hover { text-decoration: underline; }
  .text-right { text-align: right; }
</style>
