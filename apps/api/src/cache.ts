import IORedis from "ioredis";
import { env } from "./config";

const redis = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true
});

let ready = false;
redis.connect().then(() => {
  ready = true;
}).catch(() => {
  ready = false;
});
redis.on("error", () => {
  ready = false;
});
redis.on("ready", () => {
  ready = true;
});

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!ready) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSec: number) {
  if (!ready) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  } catch {
    /* fail open */
  }
}

export async function cacheDel(...keys: string[]) {
  if (!ready || !keys.length) return;
  try {
    await redis.del(...keys);
  } catch {
    /* fail open */
  }
}

export function automationsCacheKey(workspaceId: string) {
  return `ws:${workspaceId}:automations`;
}

export function meCacheKey(userId: string) {
  return `me:${userId}`;
}

export const APPS_CACHE_KEY = "catalog:apps:v3";
