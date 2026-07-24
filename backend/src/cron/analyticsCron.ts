import { AnalyticsService } from '../modules/analytics/analytics.service';

// Flush analytics to Postgres every 30 seconds
const flushInterval = 30000;

setInterval(async () => {
  await AnalyticsService.flushToPostgres();
}, flushInterval);
