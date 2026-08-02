<script lang="ts">
  import { goto } from '$app/navigation';
  import { login } from '$lib/api/auth';
  import { currentUser } from '$lib/stores/auth';
  import { ShieldAlert } from '@lucide/svelte';
  import { getTurnstileSitekey } from '$lib/api/turnstile';
  import { onMount, onDestroy } from 'svelte';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  let widgetContainer: HTMLElement;
  let turnstileWidgetId: string | null = null;

  onMount(async () => {
    const sitekey = await getTurnstileSitekey();
    (window as any).onTurnstileLoad = () => {
      if ((window as any).turnstile && widgetContainer && !turnstileWidgetId && sitekey) {
        turnstileWidgetId = (window as any).turnstile.render(widgetContainer, {
          sitekey,
          theme: 'dark',
          action: 'turnstile-spin-v2',
        });
      }
    };

    if ((window as any).turnstile) {
      (window as any).onTurnstileLoad();
    }
  });

  onDestroy(() => {
    if (turnstileWidgetId && (window as any).turnstile) {
      (window as any).turnstile.remove(turnstileWidgetId);
    }
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);
    const token = fd.get('cf-turnstile-response')?.toString() || '';
    
    if (!token) {
      error = 'Please complete the security check.';
      return;
    }
    
    loading = true;

    try {
      const res = await login(email, password, token);
      currentUser.set(res.user);
      try { localStorage.setItem('sidebarOpen', 'true'); } catch {}
      goto('/');
    } catch (err: any) {
      error = err.message || 'Invalid credentials';
      // @ts-ignore
      if (window.turnstile) {
        // @ts-ignore
        setTimeout(() => window.turnstile.reset(), 0);
      }
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Login - hellomyphotos</title>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" async defer></script>
</svelte:head>

<div class="login-container">
  <div class="hero-pane">
    <div class="ambient-glow"></div>
  </div>
  
  <div class="form-pane">
    <div class="login-card">
      <h1>hellomyphotos</h1>
      <p class="subtitle">Hello! Log in to explore your photo collection.</p>

      {#if error}
        <div class="error-banner">
          <ShieldAlert size={20} />
          <span>{error}</span>
        </div>
      {/if}

      <form onsubmit={handleSubmit} id="cf-form">
        <div class="input-group">
          <label for="email">Email Address</label>
          <input 
            type="email" 
            id="email" 
            bind:value={email} 
            placeholder="admin@example.com" 
            required 
            autocomplete="username"
          />
        </div>
        
        <div class="input-group">
          <label for="password">Password</label>
          <input 
            type="password" 
            id="password" 
            bind:value={password} 
            placeholder="••••••••" 
            required 
            autocomplete="current-password"
          />
        </div>
        <button type="submit" class="submit-btn" disabled={loading}>
          {#if loading}
            <div class="spinner"></div>
          {:else}
            Login
          {/if}
        </button>

        <div bind:this={widgetContainer} style="margin-top: 1.5rem; display: flex; justify-content: center;"></div>

        <a href="/" class="back-btn">
          Back to Homepage
        </a>
      </form>
    </div>
  </div>
</div>

<style>
  :global(body) {
    background-color: #050505;
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .login-container {
    height: 100%;
    display: flex;
    flex-direction: row;
    width: 100%;
    overflow: hidden;
  }

  /* Left Side: Colorful Gradient */
  .hero-pane {
    flex: 1;
    position: relative;
    background: linear-gradient(-45deg, #ee7752, #e73c7e, #8b5cf6, #3b82f6);
    background-size: 400% 400%;
    animation: gradientShift 15s ease infinite;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @keyframes gradientShift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  .ambient-glow {
    position: absolute;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle at center, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 60%);
    filter: blur(80px);
    animation: pulseGlow 8s ease-in-out infinite alternate;
    mix-blend-mode: overlay;
  }

  @keyframes pulseGlow {
    0% { transform: scale(1) translate(-5%, -5%); opacity: 0.5; }
    100% { transform: scale(1.2) translate(5%, 5%); opacity: 1; }
  }

  /* Right Side: Login Form */
  .form-pane {
    flex: 1;
    background-color: #050505;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .login-card {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    box-sizing: border-box;
  }

  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 2rem;
    font-weight: 600;
    color: #fff;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: #a1a1aa;
    font-size: 1rem;
    margin: 0 0 2.5rem 0;
    text-align: left;
    line-height: 1.5;
  }

  form {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    font-size: 0.85rem;
    font-weight: 500;
    color: #d4d4d8;
    margin-left: 0.25rem;
    text-align: left;
  }

  input {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0.875rem 1rem;
    border-radius: 12px;
    color: #fff;
    font-size: 1rem;
    outline: none;
    transition: all 0.2s ease;
    font-family: inherit;
  }

  input:focus {
    border-color: rgba(168, 85, 247, 0.5);
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.1);
  }

  input::placeholder {
    color: #52525b;
  }

  .submit-btn {
    margin-top: 1rem;
    background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
    color: white;
    border: none;
    padding: 1rem;
    border-radius: 12px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3);
    width: 100%;
    box-sizing: border-box;
  }

  .submit-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(168, 85, 247, 0.4);
  }

  .submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .back-btn {
    display: inline-block;
    width: 100%;
    margin-top: 1rem;
    text-align: center;
    color: #a1a1aa;
    text-decoration: none;
    font-size: 0.95rem;
    transition: color 0.2s ease;
  }
  
  .back-btn:hover {
    color: #f4f4f5;
  }

  .error-banner {
    width: 100%;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    font-size: 0.9rem;
    box-sizing: border-box;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 3px solid rgba(255,255,255,0.3);
    border-radius: 50%;
    border-top-color: #fff;
    animation: spin 1s ease-in-out infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Responsive Design */
  @media (max-width: 768px) {
    .login-container {
      flex-direction: column;
    }
    .hero-pane {
      flex: 0 0 200px;
    }
    .form-pane {
      flex: 1;
    }
  }
</style>
