import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * The worker owns its Redis connection. It must not import the API's queue
 * implementation because the API is the control plane and the worker is the
 * execution plane.
 */
export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
