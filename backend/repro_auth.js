'use strict';
// TEMP reproduction script — Task A. Not committed. Deleted after diagnosis.
const http = require('http');
const mongoose = require('mongoose');

const BASE = process.env.REPRO_BASE || 'http://localhost:5000/api';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/resell';

function req(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          const setc = res.headers['set-cookie'];
          const cookieStr = Array.isArray(setc) ? setc.map((c) => c.split(';')[0]).join('; ') : '';
          resolve({ status: res.statusCode, cookie: cookieStr, rawSetCookie: setc, body: buf });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const show = (label, r) => {
  console.log(`\n===== ${label} =====`);
  console.log('status:', r.status);
  try {
    console.log('body:', JSON.stringify(JSON.parse(r.body), null, 2));
  } catch {
    console.log('body(raw):', r.body);
  }
};

(async () => {
  const email = `repro_${Date.now()}_${Math.floor(Math.random() * 1e4)}@example.com`;
  const password = 'Password123!';
  console.log('Repro target:', BASE);
  console.log('MONGODB_URI:', MONGODB_URI);
  console.log('Email:', email);

  // Which DB does the server think it writes to? Ask via a raw connection mirror.
  await mongoose.connect(MONGODB_URI);
  console.log('Repro DB host/db:', mongoose.connection.host, '/', mongoose.connection.name);

  const usersCol = mongoose.connection.collection('users');

  console.log('\n===== REGISTER =====');
  const reg = await req('POST', '/auth/register', { body: { name: 'Repro User', email, password } });
  show('REGISTER', reg);

  console.log('\n===== DB CHECK (after register) =====');
  const lower = email.toLowerCase();
  const docExact = await usersCol.findOne({ email: lower });
  const anyVariant = await usersCol.findOne({ email: { $options: 'i', $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` } });
  console.log('doc exists (lowercased)?', !!docExact, docExact ? `_id=${docExact._id} hasPwd=${!!docExact.password}` : '');
  console.log('doc exists (any case)?', !!anyVariant);
  console.log('total users in this DB:', await usersCol.countDocuments());

  console.log('\n===== LOGIN =====');
  const log = await req('POST', '/auth/login', { body: { email, password } });
  show('LOGIN', log);

  console.log('\n===== GET /auth/me (login cookie) =====');
  const me = await req('GET', '/auth/me', { cookie: log.cookie });
  show('GET /auth/me', me);

  // Full task sequence: register -> logout -> login -> /me
  console.log('\n========== FULL SEQUENCE: register -> logout -> login -> me ==========');
  const email2 = `repro2_${Date.now()}@example.com`;
  const r2 = await req('POST', '/auth/register', { body: { name: 'Repro Two', email: email2, password } });
  show('REGISTER (seq)', r2);
  console.log('\n--- LOGOUT (uses register cookies) ---');
  const lo = await req('POST', '/auth/logout', { cookie: r2.cookie });
  show('LOGOUT', lo);
  console.log('\n--- /me AFTER logout with old cookie (should 401) ---');
  const meAfter = await req('GET', '/auth/me', { cookie: r2.cookie });
  show('/me after logout', meAfter);
  console.log('\n--- LOGIN again (seq) ---');
  const log2 = await req('POST', '/auth/login', { body: { email: email2, password } });
  show('LOGIN (seq)', log2);
  console.log('\n--- /me with fresh login cookie (should 200) ---');
  const me2 = await req('GET', '/auth/me', { cookie: log2.cookie });
  show('/me (seq)', me2);
  const doc2 = await usersCol.findOne({ email: email2.toLowerCase() });
  console.log('seq user persisted in DB?', !!doc2);

  console.log('\n===== EDGE: duplicate email (should 400, not 500) =====');
  const dup = await req('POST', '/auth/register', { body: { name: 'Dup', email, password } });
  show('DUPLICATE EMAIL', dup);

  console.log('\n===== EDGE: weak password (should 400) =====');
  const weak = await req('POST', '/auth/register', { body: { name: 'Weak', email: `weak_${Date.now()}@example.com`, password: '123' } });
  show('WEAK PASSWORD', weak);

  console.log('\n===== EDGE: wrong password login (should 401) =====');
  const wrong = await req('POST', '/auth/login', { body: { email, password: 'WrongPass999!' } });
  show('WRONG PASSWORD', wrong);


  console.log('\n===== LOGIN case-variant (upper) =====');
  const logUpper = await req('POST', '/auth/login', { body: { email: email.toUpperCase(), password } });
  show('LOGIN upper', logUpper);

  console.log('\n===== users.getIndexes() =====');
  try {
    const idx = await usersCol.indexes();
    console.log(JSON.stringify(idx, null, 2));
  } catch (e) {
    console.log('indexes error:', e.message);
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error('REPRO ERROR:', e);
  process.exit(1);
});
