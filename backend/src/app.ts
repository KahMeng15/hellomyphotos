import Fastify from 'fastify';
import { scannerRoutes } from './modules/scanner/scanner.routes';
import { mediaRoutes } from './modules/media/media.routes';
import { mlRoutes } from './modules/ml/ml.routes';
import { sharesRoutes } from './modules/shares/shares.routes';
import { adminRoutes } from './modules/admin/admin.routes';
import cors from '@fastify/cors';
import './queue/scannerQueue';
import './queue/mediaQueue';
import './queue/mlQueue';

export const app = Fastify({
  logger: true
});

// Enable CORS for frontend client-side requests
app.register(cors, {
  origin: '*' // Allow all origins for local dev
});

// Register Routes
app.register(scannerRoutes);
app.register(mediaRoutes);
app.register(mlRoutes);
app.register(sharesRoutes);
app.register(adminRoutes);

// Health check
app.get('/health', async () => {
  return { status: 'ok' };
});
