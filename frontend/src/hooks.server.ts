import type { Handle } from '@sveltejs/kit';

const BACKEND_URL = process.env.BACKEND_PROXY_URL || 'http://localhost:3000';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api')) {
    const targetUrl = new URL(event.url.pathname + event.url.search, BACKEND_URL);

    const headers = new Headers();
    for (const name of ['content-type', 'authorization', 'cookie', 'x-admin-password', 'user-agent', 'referer']) {
      const value = event.request.headers.get(name);
      if (value) headers.set(name, value);
    }
    
    // Always forward client IP. event.getClientAddress() relies on adapter-node config (e.g. X-Forwarded-For)
    // If we're behind Cloudflare or a reverse proxy, we should also manually pass existing x-forwarded-for if present
    const forwardedFor = event.request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      headers.set('x-forwarded-for', forwardedFor);
    } else {
      try {
        headers.set('x-forwarded-for', event.getClientAddress());
      } catch (e) {
        // Ignored if getClientAddress throws
      }
    }

    const response = await fetch(targetUrl.toString(), {
      method: event.request.method,
      headers,
      body: event.request.method === 'GET' || event.request.method === 'HEAD'
        ? undefined
        : await event.request.arrayBuffer()
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseHeaders.delete('transfer-encoding');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  }

  return resolve(event);
};
