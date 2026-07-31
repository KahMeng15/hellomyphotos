<script lang="ts">
  import { currentUser } from '$lib/stores/auth';
</script>

<div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
  <h2 style="font-size: 2.5rem; margin-bottom: 16px;">Welcome to hellomyphotos</h2>
  <p style="color: #94a3b8; font-size: 1.125rem; margin-bottom: 8px;">Your directory-first high-performance gallery.</p>
  <p style="color: #71717a; font-size: 0.95rem; margin-bottom: 4px;">A webapp by <a href="https://kahmeng15.github.io" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">kahmeng</a></p>
  <p style="color: #71717a; font-size: 0.95rem; margin-bottom: 32px;">
    Learn more about this app at <a href="https://kahmeng15.github.io/hellomyphotos" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">kahmeng15.github.io/hellomyphotos</a>
  </p>
  
  {#if $currentUser}
    <a href="/folder" class="btn" style="text-decoration: none; font-size: 1.125rem; padding: 12px 24px; display: inline-block;">
      Browse Gallery
    </a>
  {:else}
    <a href="/login" class="btn" style="text-decoration: none; font-size: 1.125rem; padding: 12px 24px; display: inline-block;">
      Login
    </a>
  {/if}
</div>
