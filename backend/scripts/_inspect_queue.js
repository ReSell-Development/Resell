const mongoose = require('mongoose');
(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27017/resell');
  const P = m_model();
  function m_model() { return mongoose.model('Product', new mongoose.Schema({}, { strict: false }), 'products'); }
  const docs = await P.find({ title: { $regex: /milton/i } }).select('title').lean();
  const ids = docs.map((d) => d._id.toString());
  console.log('milton ids:', ids);

  delete require.cache[require.resolve('../src/queues')];
  const queues = require('../src/queues');
  try {
    await queues.whenConnected;
  } catch (e) {
    console.log('REDIS PROBE FAIL', e.message);
    process.exit(1);
  }
  const q = queues.imageProcessingQueue;
  console.log('waiting:', await q.getWaitingCount(), '| active:', await q.getActiveCount(),
    '| completed:', await q.getCompletedCount(), '| failed:', await q.getFailedCount(),
    '| delayed:', await q.getDelayedCount());
  const failed = await q.getFailed(0, 5);
  for (const j of failed) {
    console.log('FAILED job', j.id, 'productId:', j.data && j.data.productId, '| reason:', j.failedReason);
  }
  const waiting = await q.getWaiting(0, 20);
  const ours = waiting.filter((j) => j.data && ids.includes(String(j.data.productId)));
  console.log('waiting jobs for milton listings:', ours.map((j) => j.id + ':' + j.data.productId));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
