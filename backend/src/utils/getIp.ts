import type { FastifyRequest } from 'fastify';

/**
 * Returns the client IP address using Fastify's proxy-aware `request.ip`.
 * Fastify validates upstream proxy headers against its `trustProxy` setting,
 * preventing arbitrary header injection (e.g. spoofed X-Forwarded-For or CF-Connecting-IP).
 */
export function getClientIp(request: FastifyRequest): string {
  let ip = request.ip || request.socket?.remoteAddress || 'unknown';
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  return ip;
}
