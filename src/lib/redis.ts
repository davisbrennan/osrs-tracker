import Redis from 'ioredis';

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

// lazyConnect matters: without it ioredis dials Redis during `next build`,
// which fails the build on any machine that isn’t running the full stack.
export const redis =
  global.__redis ??
  new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });

redis.on('error', (err) => {
  console.error('[redis]', err.message);
});

if (process.env.NODE_ENV !== 'production') global.__redis = redis;
