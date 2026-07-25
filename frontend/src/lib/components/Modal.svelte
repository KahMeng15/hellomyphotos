<script lang="ts">
  import { pushModal, popModal } from '$lib/stores/modalStack';
  import { X } from '@lucide/svelte';

  let {
    id,
    show = $bindable(false),
    title = '',
    closable = true,
    children,
  }: {
    id: string;
    show: boolean;
    title?: string;
    closable?: boolean;
    children: import('svelte').Snippet;
  } = $props();

  let visible = $state(false);

  function activate() {
    if (show) visible = true;
  }

  function deactivate() {
    visible = false;
  }

  $effect(() => {
    if (show) {
      pushModal(id, activate, deactivate);
      return () => {
        popModal(id);
      };
    } else {
      visible = false;
    }
  });

  function close() {
    show = false;
  }
</script>

{#if visible}
  <div class="modal-backdrop" onclick={close} role="button" tabindex="0" onkeydown={(e) => e.key === 'Escape' && close()}>
    <div class="modal glass-panel" onclick={(e) => e.stopPropagation()} role="document" tabindex="0" onkeydown={(e) => {}}>
      <div class="modal-header">
        <h3>{title}</h3>
        {#if closable}
          <button class="modal-close-btn" onclick={close}><X size={20} /></button>
        {/if}
      </div>
      <div class="modal-body">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-close-btn {
    background: none;
    border: none;
    color: #a1a1aa;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .modal-close-btn:hover {
    color: white;
    background: rgba(255,255,255,0.1);
  }
</style>
