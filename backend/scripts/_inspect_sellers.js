const m = require('mongoose');
(async () => {
  await m.connect('mongodb://127.0.0.1:27017/resell');
  const P = m.model('Product', new m.Schema({}, { strict: false }), 'products');
  const U = m.model('User', new m.Schema({}, { strict: false }), 'users');
  const docs = await P.find({ title: { $regex: /milton/i } }).select('title seller status').lean();
  for (const d of docs) {
    const u = await U.findById(d.seller).select('name email').lean();
    console.log(d.title, '| seller:', u && (u.name + ' <' + u.email + '>'), '| status:', d.status);
  }
  await m.disconnect();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
