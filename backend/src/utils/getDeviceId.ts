import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

export const DEVICE_COOKIE_NAME = 'hmp_device_id';

export function getClientDeviceId(request: FastifyRequest, reply?: FastifyReply): string {
  // 1. From request attached property (hook)
  if ((request as any).deviceId) {
    return (request as any).deviceId;
  }

  // 2. From cookie
  const fromCookie = (request.cookies as any)?.[DEVICE_COOKIE_NAME];
  if (fromCookie && typeof fromCookie === 'string' && fromCookie.length >= 8 && fromCookie.length <= 64) {
    (request as any).deviceId = fromCookie;
    return fromCookie;
  }

  // 3. From header
  const fromHeader = (request.headers['x-device-id'] as string) || (request.headers['device-id'] as string);
  if (fromHeader && fromHeader.length >= 8 && fromHeader.length <= 64) {
    (request as any).deviceId = fromHeader;
    return fromHeader;
  }

  // 4. From body (e.g. telemetry beacons)
  if (request.body && typeof request.body === 'object') {
    const fromBody = (request.body as any).deviceId;
    if (fromBody && typeof fromBody === 'string' && fromBody.length >= 8 && fromBody.length <= 64) {
      (request as any).deviceId = fromBody;
      return fromBody;
    }
  }

  // 5. Generate a new persistent UUID
  const newId = crypto.randomUUID();
  (request as any).deviceId = newId;

  if (reply && !reply.sent) {
    try {
      reply.setCookie(DEVICE_COOKIE_NAME, newId, {
        path: '/',
        maxAge: 63072000, // 2 years
        httpOnly: false,
        sameSite: 'lax',
      });
    } catch {}
  }

  return newId;
}
