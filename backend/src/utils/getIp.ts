import type { FastifyRequest } from 'fastify';

export function getClientIp(request: FastifyRequest): string {
  const cf = request.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) {
    let clean = cf.trim();
    if (clean.startsWith('::ffff:')) clean = clean.substring(7);
    return clean;
  }

  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    let clean = realIp.trim();
    if (clean.startsWith('::ffff:')) clean = clean.substring(7);
    return clean;
  }

  const xff = request.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0].trim();
    if (first) {
      let clean = first;
      if (clean.startsWith('::ffff:')) clean = clean.substring(7);
      return clean;
    }
  }

  let fallback = request.ip || request.socket?.remoteAddress || 'unknown';
  if (fallback.startsWith('::ffff:')) {
    fallback = fallback.substring(7);
  }
  return fallback;
}
