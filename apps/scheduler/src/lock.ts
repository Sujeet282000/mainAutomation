import { randomUUID } from "node:crypto";

export interface RedisLockClient {
  set(key: string, value: string, mode: "PX", ttlMs: number, condition: "NX"): Promise<"OK" | null>;
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
}

const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const RENEW_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export class RedisLease {
  constructor(
    private readonly client: RedisLockClient,
    private readonly key: string,
    private readonly ttlMs: number,
  ) {}

  async run<T>(work: (token: string) => Promise<T>): Promise<T | null> {
    const token = randomUUID();
    const acquired = await this.client.set(this.key, token, "PX", this.ttlMs, "NX");
    if (acquired !== "OK") return null;

    const heartbeatMs = Math.max(1_000, Math.floor(this.ttlMs / 3));
    const heartbeat = setInterval(() => {
      void this.client.eval(RENEW_SCRIPT, 1, this.key, token).catch(() => undefined);
    }, heartbeatMs);

    try {
      return await work(token);
    } finally {
      clearInterval(heartbeat);
      await this.client.eval(RELEASE_SCRIPT, 1, this.key, token).catch(() => 0);
    }
  }
}

export { RELEASE_SCRIPT, RENEW_SCRIPT };
