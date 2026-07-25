import { API_BASE } from './media';

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
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

export async function getAuthUser() {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    credentials: 'include'
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  return data.user;
}
