const m = require('mongoose');
(async () => {
  await m.connect('mongodb://127.0.0.1:27017/resell');
  const P = m.model('Product', new m.Schema({}, { strict: false }), 'products');
  const total = await P.countDocuments();
  console.log('TOTAL PRODUCTS:', total);
  const docs = await P.find({ title: { $regex: /bottle|flask|milton|thermo/i } })
    .select('title seller status createdAt aiAnalysis images embedding fraudScore fraudReasons isFlagged')
    .lean();
  console.log('BOTTLE MATCHES:', docs.length);
  for (const d of docs) {
    const ai = d.aiAnalysis || {};
    console.log('---');
    console.log('title:', d.title);
    console.log('status:', d.status, '| flagged:', d.isFlagged, '| created:', d.createdAt);
    console.log('aiAnalysis keys:', ai && typeof ai === 'object' ? Object.keys(ai).join(',') : ai);
    console.log('detectedObjects:', Array.isArray(ai.detectedObjects) ? ai.detectedObjects.length : ai.detectedObjects);
    console.log('embedding:', Array.isArray(d.embedding) ? d.embedding.length : d.embedding);
    console.log('risk:', ai.riskAssessment ? JSON.stringify({ s: ai.riskAssessment.riskScore, l: ai.riskAssessment.riskLevel, f: ai.riskAssessment.factors }) : 'NONE');
    console.log('images:', (d.images || []).map((i) => i.url));
  }
  await m.disconnect();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
