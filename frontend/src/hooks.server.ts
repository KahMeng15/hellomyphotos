import type { Handle } from '@sveltejs/kit/hooks';

const BACKEND_URL = process.env.BACKEND_PROXY_URL || 'http://localhost:3000';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api')) {
    const targetUrl = new URL(event.url.pathname + event.url.search, BACKEND_URL);

    const headers = new Headers();
    for (const name of [
      'content-type',
      'authorization',
      'cookie',
      'x-admin-password',
      'x-api-key',
      'x-staging-key',
      'x-photographer-token',
      'x-session-id',
      'x-forwarded-proto',
      'user-agent',
      'referer',
      'range',
      'cf-connecting-ip',
      'x-real-ip',
      'x-device-ip',
      'x-client-ip',
      'x-client-local-ip'
    ]) {
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
    const hasEncoding = responseHeaders.has('content-encoding');
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('transfer-encoding');

    // Only strip content-length if the payload was compressed (e.g. gzip/br)
    // because fetch() automatically decompresses the stream, altering its byte length.
    // For uncompressed streams (like ZIP files and media), preserving content-length allows
    // browsers to display an accurate progress bar and total file size ("X MB of Y MB").
    if (hasEncoding) {
      responseHeaders.delete('content-length');
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  }

  return resolve(event);
};
