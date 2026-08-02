import Fastify from 'fastify';
import { scannerRoutes } from './modules/scanner/scanner.routes';
import { mediaRoutes } from './modules/media/media.routes';
import { mlRoutes } from './modules/ml/ml.routes';
import { sharesRoutes } from './modules/shares/shares.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import { queueRoutes } from './modules/admin/queue.routes';
import { timelineRoutes } from './modules/timeline/timeline.routes';
import { authRoutes } from './modules/auth/auth.routes';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import './queue';

import { logger } from './utils/logger';
import { getDbStatus } from './config/db';

export const app = Fastify({
  logger: true
});

app.addHook('onRequest', async (request) => {
  if (request.url === '/api/log') return;
  logger.info(`${request.method} ${request.url}`, { ip: request.ip });
});

// Enable CORS for frontend client-side requests
const allowedOrigin = process.env.APP_DOMAIN || true;
app.register(cors, {
  origin: allowedOrigin,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-password'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
});

app.register(cookie, {
  secret: process.env.COOKIE_SECRET || 'super_secret_cookie_key',
});

import { zipRoutes } from './modules/media/zip.routes';

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
