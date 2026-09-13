const { Queue } = require('bullmq');
const { createClient } = require('ioredis');

const isTest = process.env.NODE_ENV === 'test';

if (isTest) {
  // In tests we never need real queues or Redis — export no-ops so
  // require('../queues') works without connecting to Redis.
  const noop = async () => {};
  module.exports = {
    connection: null,
    imageProcessingQueue: { add: noop },
    priceAnalysisQueue: { add: noop },
    registerSweepJob: noop,
  };
} else {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  const connection = createClient(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  const imageProcessingQueue = new Queue('image-processing', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  });

  const priceAnalysisQueue = new Queue('price-analysis', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  });

  // Register the sweep as a repeatable job (every 10 minutes).
  // This is idempotent — calling it again when the job already exists is a no-op.
  const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

  async function registerSweepJob() {
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
  }

  module.exports = {
    connection,
    imageProcessingQueue,
    priceAnalysisQueue,
    registerSweepJob,
  };
}
