const m = require('mongoose');
(async () => {
  await m.connect('mongodb://127.0.0.1:27017/resell');
  const P = m.model('Product', new m.Schema({}, { strict: false }), 'products');
  const d = await P.findOne({ title: 'milton water bottle' }).lean();
  console.log('embedding len:', (d.embedding || []).length);
  console.log('fraudScore:', d.fraudScore, '| fraudReasons:', JSON.stringify(d.fraudReasons));
  console.log('suggestedPrice:', d.suggestedPrice, '| priceRange:', JSON.stringify(d.priceRange));
  console.log('images[0] keys:', Object.keys(d.images[0] || {}).join(','));
  console.log('images[0].colorHistogram len:', ((d.images[0] || {}).colorHistogram || []).length);
  console.log('images[0].cnnFeatures len:', ((d.images[0] || {}).cnnFeatures || []).length);
  console.log('aiAnalysis:', JSON.stringify(d.aiAnalysis, (k, v) => (Array.isArray(v) && v.length > 20 ? `[array:${v.length}]` : v), 1).slice(0, 3000));
  await m.disconnect();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
