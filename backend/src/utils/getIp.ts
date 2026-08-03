import type { FastifyRequest } from 'fastify';

export function getClientIp(request: FastifyRequest): string {
  const xff = request.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return request.ip || request.socket?.remoteAddress || 'unknown';
}