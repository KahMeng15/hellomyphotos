import { app } from './app';
// Ensure worker is imported so it starts processing
import './queue/scannerQueue';
import './queue/mediaQueue';
import './queue/mlQueue';
// Ensure cron starts
import './cron/periodicScanner';
import './cron/analyticsCron';

const PORT = parseInt(process.env.PORT || '3000', 10);

const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
