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
import './queue/scannerQueue';
import './queue/mediaQueue';
import './queue/mlQueue';

export const app = Fastify({
  logger: true
});

// Enable CORS for frontend client-side requests
app.register(cors, {
  origin: true, // Reflect request origin
  credentials: true
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

// Health check
app.get('/health', async () => {
  return { status: 'ok' };
});
