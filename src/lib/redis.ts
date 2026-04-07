import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL?.trim();

type AppRedisClient = ReturnType<typeof createClient>;

let redisClient: AppRedisClient | null = null;
let connectPromise: Promise<AppRedisClient | null> | null = null;
let hasLoggedMissingRedisUrl = false;

function createRedisConnection(): AppRedisClient | null {
  if (!REDIS_URL) {
    if (!hasLoggedMissingRedisUrl) {
      console.warn('[Redis] REDIS_URL is not set. Redis features are disabled.');
      hasLoggedMissingRedisUrl = true;
    }
    return null;
  }

  const client = createClient({ url: REDIS_URL });

  client.on('error', (error) => {
    console.error('[Redis] Client error:', error);
  });

  return client;
}

export async function getRedisClient(): Promise<AppRedisClient | null> {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (!redisClient) {
    redisClient = createRedisConnection();
    if (!redisClient) {
      return null;
    }
  }

  if (!connectPromise) {
    connectPromise = redisClient
      .connect()
      .then(() => redisClient)
      .catch((error) => {
        console.error('[Redis] Connection failed:', error);
        connectPromise = null;
        return null;
      });
  }

  return connectPromise;
}


