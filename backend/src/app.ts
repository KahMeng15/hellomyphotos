import Fastify from 'fastify';
import { scannerRoutes } from './modules/scanner/scanner.routes';
import { mediaRoutes } from './modules/media/media.routes';
import { mlRoutes } from './modules/ml/ml.routes';
import { sharesRoutes } from './modules/shares/shares.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { queueRoutes } from './modules/admin/queue.routes';
import { timelineRoutes } from './modules/timeline/timeline.routes';
import { watermarkRoutes } from './modules/admin/watermark.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { stagingRoutes } from './modules/staging/staging.routes';
import { fastupRoutes } from './modules/admin/fastup.routes';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import './queue';

import { logger } from './utils/logger';
import { getDbStatus } from './config/db';

export const app = Fastify({
  logger: true,
  trustProxy: true
});

app.addHook('onRequest', async (request) => {
  if (request.url === '/api/log') return;
  (request as any).startTime = performance.now();
  logger.info(`${request.method} ${request.url}`, { ip: request.ip });
});

app.addHook('onResponse', async (request, reply) => {
  if (request.url === '/api/log') return;
  const start = (request as any).startTime;
  if (typeof start !== 'number') return;
  const durationMs = (performance.now() - start).toFixed(2);
  logger.info(`[RESPONSE] ${request.method} ${request.url} -> ${reply.statusCode} (${durationMs}ms)`, {
    ip: request.ip,
    statusCode: reply.statusCode,
    durationMs: parseFloat(durationMs)
  });
});

// HTTP Security Headers
app.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('X-XSS-Protection', '0');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
});

// Enable CORS with strict origin validation to prevent arbitrary cross-origin credential theft
const appDomain = process.env.APP_DOMAIN ? process.env.APP_DOMAIN.replace(/\/+$/, '') : null;
app.register(cors, {
  origin: (origin, cb) => {
    // Allow non-browser requests or same-origin server-to-server requests
    if (!origin) return cb(null, true);

    if (appDomain) {
      if (origin === appDomain || origin === `${appDomain}:80` || origin === `${appDomain}:443`) {
        return cb(null, true);
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      // In development, allow localhost/127.0.0.1 on any port
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
    }

    return cb(null, false);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-password', 'x-api-key', 'x-staging-key', 'x-photographer-token', 'x-session-id', 'x-forwarded-proto'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
});

const COOKIE_SECRET = process.env.COOKIE_SECRET || (
  process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('FATAL: A secure COOKIE_SECRET environment variable must be configured in production.'); })()
    : 'super_secret_cookie_key'
);

app.register(cookie, {
  secret: COOKIE_SECRET,
});

app.register(multipart, {
  limits: {
    fileSize: 150 * 1024 * 1024, // 150MB per file to handle high-resolution RAW & video
    files: 20
  }
});

import { DEVICE_COOKIE_NAME, getClientDeviceId } from './utils/getDeviceId';

// Assign or persist unique device identifier for telemetry and visitor analytics
app.addHook('onRequest', async (request, reply) => {
  getClientDeviceId(request, reply);
});

import { AnalyticsService } from './modules/analytics/analytics.service';

// Global Rate Limiting to protect sensitive routes and resolve CodeQL missing-rate-limiting alerts
app.register(rateLimit, {
  max: process.env.DISABLE_RATE_LIMIT === 'true'
    ? 1_000_000
    : parseInt(process.env.RATE_LIMIT_MAX || '1000', 10),
  timeWindow: '1 minute',
  allowList: ['127.0.0.1', '::1'],
  errorResponseBuilder: (request, context) => {
    AnalyticsService.logVisit({
      actionType: 'blocked_rate_limit',
      ip: request.ip,
      userAgent: request.headers['user-agent'] as string | undefined,
      referrer: request.headers.referer as string | undefined,
      path: request.url,
      metadata: { max: context.max, after: context.after }
    });
    return {
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded, retry in ${context.after}`
    };
  }
});

import { zipRoutes } from './modules/media/zip.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';

// Register Routes
app.register(authRoutes, { prefix: '/api/auth' });
app.register(scannerRoutes);
app.register(mediaRoutes);
app.register(zipRoutes);
app.register(mlRoutes);
app.register(sharesRoutes);
app.register(adminRoutes);
app.register(queueRoutes);
app.register(timelineRoutes);
app.register(watermarkRoutes);
app.register(analyticsRoutes);
app.register(stagingRoutes);
app.register(fastupRoutes);

// Frontend log ingest (used by frontendLogger utility)
app.post('/api/log', async (request, reply) => {
  const { level, message, route } = request.body as any;
  if (!message) return reply.status(400).send({ error: 'message required' });
  const lvl = (level || 'info').toLowerCase();
  const msg = `[Frontend${route ? ' ' + route : ''}] ${message}`;
  if (lvl === 'warn') logger.warn(msg);
  else if (lvl === 'error') logger.error(msg);
  else logger.info(msg);
  return reply.send({ ok: true });
});

// Public Turnstile config. The frontend fetches the sitekey at runtime instead of
// having it baked into the image at build time.
app.get('/api/turnstile/sitekey', async () => {
  return { sitekey: process.env.TURNSTILE_SITEKEY || '' };
});

// Health check
app.get('/health', async () => {
  return { status: 'ok' };
});

// DB bootstrap status: lists tables so schema initialization can be verified
// without needing psql access to the database host (it may live in another stack).
app.get('/api/db/status', async () => {
  return getDbStatus();
});
