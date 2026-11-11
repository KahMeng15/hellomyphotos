import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AnalyticsService } from './analytics.service';
import { getClientIp } from '../../utils/getIp';

export async function analyticsRoutes(fastify: FastifyInstance) {
  // Support text/plain payloads from navigator.sendBeacon
  fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
    try {
      const json = JSON.parse(body as string);
      done(null, json);
    } catch {
      done(null, body);
    }
  });

  fastify.post('/api/analytics/telemetry', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      let body = request.body as any;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Invalid payload' });
      }

      const {
        mediaId,
        shareToken,
        deviceId,
        folderPath,
        actionType = 'telemetry',
        pageLoadMs,
        sessionDurationS,
        photoViewMs,
        sortMode,
        viewMode,
        featuresUsed,
        downloadTimeMs,
        networkType,
        screenRes,
        scrollDepthPct,
        foldersVisited,
        cacheBytesSaved,
        cacheHits,
        cacheMisses,
        metadata
      } = body;

      const resolvedDeviceId = deviceId || (request as any).deviceId || (request.cookies as any)?.['hmp_device_id'] || null;

      await AnalyticsService.logVisit({
        mediaId: mediaId || null,
        shareToken: shareToken || null,
        deviceId: resolvedDeviceId,
        folderPath: folderPath || null,
        actionType: String(actionType).slice(0, 30),
        ip: getClientIp(request),
        userAgent: request.headers['user-agent'] as string | undefined,
        referrer: request.headers.referer as string | undefined,
        path: (request.headers.referer as string | undefined) || request.url,
        pageLoadMs,
        sessionDurationS,
        photoViewMs,
        sortMode,
        viewMode,
        featuresUsed,
        downloadTimeMs,
        networkType,
        screenRes,
        scrollDepthPct,
        foldersVisited,
        cacheBytesSaved,
        cacheHits,
        cacheMisses,
        metadata
      });

      return reply.send({ ok: true });
    } catch (err: any) {
      request.log.warn({ err }, 'Failed to record analytics telemetry');
      return reply.send({ ok: false });
    }
  });
}
