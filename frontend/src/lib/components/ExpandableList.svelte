<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';

  interface Props {
    items: any[];
    limit?: number;
    children: Snippet<[any[]]>;
  }

  let { items = [], limit = 10, children }: Props = $props();
  let expanded = $state(false);

  const visible = $derived(items.length > limit && !expanded ? items.slice(0, limit) : items);
</script>

{#if items.length > 0}
  {@render children(visible)}
  {#if items.length > limit}
    <div class="expand-footer">
      <button class="expand-btn" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
        {expanded ? 'Show less' : `View all (${items.length})`}
        <ChevronDown size={14} class={expanded ? 'rotated' : ''} />
      </button>
    </div>
  {/if}
{/if}

<style>
  .expand-footer { margin-top: 1rem; display: flex; justify-content: center; }
  .expand-btn {
    display: inline-flex; align-items: center; gap: 0.4rem;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: #a1a1aa;
    font-family: inherit; font-size: 0.8rem; padding: 0.4rem 0.9rem; border-radius: 999px; cursor: pointer;
    transition: background 0.2s, color 0.2s;
  }
  .expand-btn:hover { background: rgba(255,255,255,0.12); color: #e4e4e7; }
  .expand-btn :global(svg) { transition: transform 0.2s; }
  .expand-btn :global(svg.rotated) { transform: rotate(180deg); }
</style>
