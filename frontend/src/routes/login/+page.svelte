<script lang="ts">
  import { goto } from '$app/navigation';
  import { login } from '$lib/api/auth';
  import { ShieldAlert, LogIn, Lock } from '@lucide/svelte';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      const res = await login(email, password);
      // Store user info if needed, but cookie handles auth
      goto('/'); // Redirect to dashboard
    } catch (err: any) {
      error = err.message || 'Invalid credentials';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Login - HelloMyPhotos</title>
</svelte:head>

<div class="login-container">
  <div class="ambient-glow"></div>
  
  <div class="login-card">
    <div class="logo">
      <Lock size={48} strokeWidth={1.5} color="rgba(255,255,255,0.9)" />
    </div>
    
    <h1>Welcome Back</h1>
    <p class="subtitle">Enter your credentials to access your secure vault.</p>

    {#if error}
      <div class="error-banner">
        <ShieldAlert size={20} />
        <span>{error}</span>
      </div>
    {/if}

    <form onsubmit={handleSubmit}>
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

      <button type="submit" class="submit-btn" disabled={loading || !email || !password}>
        {#if loading}
          <div class="spinner"></div>
        {:else}
          <LogIn size={20} />
          Sign In
        {/if}
      </button>
    </form>
  </div>
</div>

<style>
  :global(body) {
    background-color: #050505;
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .login-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
  }

  .ambient-glow {
    position: absolute;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.15) 50%, rgba(0, 0, 0, 0) 70%);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    filter: blur(60px);
    z-index: 0;
    animation: pulse 8s ease-in-out infinite alternate;
  }

  @keyframes pulse {
    0% { transform: translate(-50%, -50%) scale(1); opacity: 0.8; }
    100% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
  }

  .login-card {
    position: relative;
    z-index: 1;
    background: rgba(25, 25, 25, 0.6);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 3rem 2.5rem;
    border-radius: 24px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    align-items: center;
    box-sizing: border-box;
  }

  .logo {
    width: 80px;
    height: 80px;
    background: linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(168,85,247,0.2) 100%);
    border-radius: 20px;
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 1.5rem;
    border: 1px solid rgba(255,255,255,0.05);
    box-shadow: inset 0 0 20px rgba(255,255,255,0.05);
  }

  h1 {
    margin: 0 0 0.5rem 0;
    font-size: 1.75rem;
    font-weight: 600;
    color: #fff;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: #a1a1aa;
    font-size: 0.95rem;
    margin: 0 0 2rem 0;
    text-align: center;
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
  }

  input {
    background: rgba(0, 0, 0, 0.3);
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
    background: rgba(0, 0, 0, 0.5);
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
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.5rem;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(168, 85, 247, 0.3);
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
</style>
