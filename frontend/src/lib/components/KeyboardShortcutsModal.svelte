<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import { Keyboard } from '@lucide/svelte';

  let {
    show = $bindable(false)
  }: {
    show: boolean;
  } = $props();

  const shortcuts = [
    {
      category: 'Gallery & Folders',
      items: [
        { keys: ['/', '⌘K'], desc: 'Open / Focus search' },
        { keys: ['V'], desc: 'Cycle view mode (Grid / Fit / List)' },
        { keys: ['S'], desc: 'Cycle sort order' },
        { keys: ['Shift', 'D'], desc: 'Download folder as ZIP' },
        { keys: ['Shift', 'S'], desc: 'Share folder' },
        { keys: ['Backspace'], desc: 'Navigate to parent folder' },
        { keys: ['['], desc: 'Toggle sidebar' },
      ]
    },
    {
      category: 'Lightbox (Media Viewer)',
      items: [
        { keys: ['←', '→'], desc: 'Previous / Next image' },
        { keys: ['Esc'], desc: 'Close lightbox' },
        { keys: ['D'], desc: 'Download photo / video' },
        { keys: ['S'], desc: 'Share photo / video' },
        { keys: ['I'], desc: 'Toggle metadata & EXIF panel' },
        { keys: ['+', '-'], desc: 'Zoom in / out' },
        { keys: ['0'], desc: 'Reset zoom to 1x' },
        { keys: ['Z'], desc: 'Toggle zoom (1x / 2.5x)' },
        { keys: ['F'], desc: 'Toggle fullscreen' },
        { keys: ['C'], desc: 'Set as folder cover photo' },
        { keys: ['Space'], desc: 'Play / Pause video' },
      ]
    },
    {
      category: 'General & Navigation',
      items: [
        { keys: ['?'], desc: 'Open this shortcuts guide' },
        { keys: ['Esc'], desc: 'Close any open modal or menu' },
        { keys: ['Tab', 'Enter'], desc: 'Navigate and activate buttons' },
      ]
    }
  ];
</script>

<Modal id="keyboard-shortcuts-modal" bind:show title="Keyboard Shortcuts">
  <div class="shortcuts-container">
    {#each shortcuts as section}
      <div class="shortcut-section">
        <h4 class="section-title">{section.category}</h4>
        <div class="shortcut-list">
          {#each section.items as item}
            <div class="shortcut-row">
              <span class="shortcut-desc">{item.desc}</span>
              <div class="shortcut-keys">
                {#each item.keys as k, i}
                  {#if i > 0 && item.keys.length > 1 && !['←', '→', '+', '-'].includes(k)}
                    <span class="key-or">or</span>
                  {/if}
                  <kbd class="key-badge">{k}</kbd>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</Modal>

<style>
  .shortcuts-container {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-height: 70vh;
    overflow-y: auto;
    padding-right: 0.25rem;
  }

  .shortcut-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .section-title {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #a1a1aa;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 0.35rem;
  }

  .shortcut-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0;
    font-size: 0.9rem;
    color: #e4e4e7;
  }

  .shortcut-desc {
    color: #d4d4d8;
  }

  .shortcut-keys {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .key-or {
    font-size: 0.75rem;
    color: #71717a;
  }

  .key-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    font-weight: 600;
    color: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
</style>
