import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redis = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null,
});
