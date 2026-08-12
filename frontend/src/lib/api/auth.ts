import { API_BASE } from './media';

export async function login(email: string, password: string, turnstileToken: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, 'cf-turnstile-response': turnstileToken }),
    credentials: 'include' // Important for saving the HttpOnly cookie
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Login failed');
  }

  return await res.json();
}

export async function logout() {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include'
  });
}

export class BackendError extends Error {
  constructor(public statusCode: number | null, message: string) {
    super(message);
    this.name = 'BackendError';
  }
}

export async function getAuthUser() {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: 'include'
    });
  } catch (err: any) {
    // Network failure — backend is unreachable (crashed, not started, etc.)
    throw new BackendError(null, 'Cannot reach the server. Is the backend running?');
  }

  if (res.status === 401) {
    // Expected: user is simply not logged in
    return null;
  }

  if (!res.ok) {
    // Unexpected non-401 error — backend is up but something is wrong
    const body = await res.json().catch(() => ({}));
    throw new BackendError(res.status, body.error || `Server error (${res.status})`);
  }

  const data = await res.json();
  return data.user;
}

export async function updatePreferences(preferences: Record<string, any>) {
  const res = await fetch(`${API_BASE}/api/auth/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to update preferences');
  return await res.json();
}
