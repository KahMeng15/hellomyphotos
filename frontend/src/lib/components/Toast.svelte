<script lang="ts">
  import { toast } from '$lib/stores/toast';
  import { fly, fade } from 'svelte/transition';
  import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from '@lucide/svelte';

  const icons = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
    warning: AlertTriangle
  };
</script>

<div class="toast-container">
  {#each $toast as t (t.id)}
    {@const Icon = icons[t.type]}
    <div 
      class="toast {t.type}" 
      in:fly={{ y: 20, duration: 300 }} 
      out:fade={{ duration: 200 }}
    >
      <div class="icon">
        <Icon size={20} />
      </div>
      <div class="message">{t.message}</div>
      <button class="close-btn" onclick={() => toast.remove(t.id)}>
        <X size={16} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 9999;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #f8fafc;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3);
    min-width: 320px;
    max-width: 450px;
    pointer-events: auto;
  }

  .toast.success { border-left: 4px solid #10b981; }
  .toast.error { border-left: 4px solid #ef4444; }
  .toast.warning { border-left: 4px solid #f59e0b; }
  .toast.info { border-left: 4px solid #3b82f6; }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  
  .toast.success .icon { color: #10b981; }
  .toast.error .icon { color: #ef4444; }
  .toast.warning .icon { color: #f59e0b; }
  .toast.info .icon { color: #3b82f6; }

  .message {
    flex: 1;
    font-size: 0.95rem;
    line-height: 1.4;
    font-weight: 500;
  }

  .close-btn {
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
</style>
