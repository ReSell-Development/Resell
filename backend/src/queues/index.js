const net = require('net');
const { URL } = require('url');

const isTest = process.env.NODE_ENV === 'test';

// No-op stubs used when Redis is unavailable or in test mode.
const noop = async () => {};
const noopQueue = { add: noop, on: noop };

/**
 * Checks if a TCP port is accepting connections without creating any
 * ioredis / BullMQ objects, so there is zero risk of unhandled rejections.
 */
function canReachRedis(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
    socket.connect(port, host);
  });
}

if (isTest) {
  // In tests we never need real queues or Redis — export no-ops so
  // require('../queues') works without connecting to Redis.
  module.exports = {
    connection: null,
    imageProcessingQueue: noopQueue,
    priceAnalysisQueue: noopQueue,
    registerSweepJob: noop,
  };
} else {
  // Exported values — start as no-ops; replaced below if Redis is reachable.
  const queueExports = {
    connection: null,
    imageProcessingQueue: noopQueue,
    priceAnalysisQueue: noopQueue,
    registerSweepJob: noop,
  };

  // Probe Redis with a raw TCP connect so ioredis/BullMQ are never created
  // unless Redis is actually available. This prevents BullMQ's internal
  // checkConnection() from firing unhandled rejections when Redis is offline.
  (async () => {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const parsed = new URL(redisUrl);
      const host = parsed.hostname || '127.0.0.1';
      const port = parseInt(parsed.port || '6379', 10);

      const reachable = await canReachRedis(host, port);

      if (!reachable) {
        console.warn('[Queue] Redis unavailable — queues disabled. Background jobs will not run.');
        return;
      }

      // Redis is up — now it is safe to create ioredis / BullMQ objects.
      const { Queue } = require('bullmq');
      const { createClient } = require('ioredis');

      const connection = createClient(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false,
      });

      connection.on('error', (err) =>
        console.warn(`[Queue] Redis connection error: ${err.message}`)
      );

      const makeQueue = (name) =>
        new Queue(name, {
          connection,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        });

      const imageProcessingQueue = makeQueue('image-processing');
      const priceAnalysisQueue = makeQueue('price-analysis');

      imageProcessingQueue.on('error', (err) =>
        console.warn(`[Queue] image-processing error: ${err.message}`)
      );
      priceAnalysisQueue.on('error', (err) =>
        console.warn(`[Queue] price-analysis error: ${err.message}`)
      );

      queueExports.connection = connection;
      queueExports.imageProcessingQueue = imageProcessingQueue;
      queueExports.priceAnalysisQueue = priceAnalysisQueue;

      // Register the sweep as a repeatable job (every 10 minutes).
      const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
      queueExports.registerSweepJob = async function registerSweepJob() {
        try {
          await priceAnalysisQueue.add(
            'price-refinement-sweep',
            {},
            {
              repeat: { every: SWEEP_INTERVAL_MS },
              removeOnComplete: 100,
              removeOnFail: 50,
            }
          );
          console.log('[Queue] Registered price-refinement-sweep repeatable job (every 10m)');
        } catch (err) {
          // Redis not available at startup — sweep will be registered when Redis comes online
          console.warn(`[Queue] Could not register sweep job: ${err.message}`);
        }
      };

      console.log('[Queue] Redis connected — queues ready');
    } catch (err) {
      // Catch-all so nothing here can ever reach the process-level handler.
      console.warn(`[Queue] Unexpected error during queue setup: ${err.message}`);
    }
  })();

  module.exports = queueExports;
}
