import type { FastifyRequest } from 'fastify';

/**
 * Returns the client IP address using Fastify's proxy-aware `request.ip`.
 * Fastify validates upstream proxy headers against its `trustProxy` setting,
 * preventing arbitrary header injection (e.g. spoofed X-Forwarded-For or CF-Connecting-IP).
 */
export function getClientIp(request: FastifyRequest): string {
  const cf = request.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) {
    let ip = cf.trim();
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    return ip;
  }

  const xff = request.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    let ip = xff.split(',')[0].trim();
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    if (ip) return ip;
  }

  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    let ip = realIp.trim();
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    return ip;
  }

  let ip = request.ip || request.socket?.remoteAddress || 'unknown';
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  return ip;
}
