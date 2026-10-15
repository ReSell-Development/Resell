/**
 * Refresh-token restart persistence — integration test.
 *
 * Proves the fix for "login sessions are lost when the backend restarts":
 *   1. A backend restart wipes all in-memory state (the JWT blacklist) but
 *      MongoDB keeps every issued RefreshToken row. JWT_SECRET is stable
 *      (required by validateEnv, never randomly regenerated per boot).
 *   2. Therefore a refresh token issued BEFORE the restart is still accepted
 *      AFTER it — the user stays logged in across `npm run dev` restarts.
 *   3. A refresh token revoked by logout BEFORE the restart stays rejected
 *      after it — revocation is DB-persisted, not in-memory.
 *
 * A real restart is simulated by wiping the in-memory blacklist (the only
 * in-memory auth store); the mongodb-memory-server instance persists across
 * the test, exactly like a real MongoDB survives a nodemon restart.
 */

const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { resetBlacklist } = require('../utils/tokenBlacklist');

// Extract a named token from the httpOnly set-cookie header.
const extractCookie = (res, name) => {
  const setCookie = res.headers['set-cookie'] || [];
  const cookie = setCookie.find((c) => c.startsWith(`${name}=`));
  return cookie ? cookie.split(';')[0].split('=')[1] : null;
};

describe('Refresh token survives a backend restart', () => {
  let user;
  const password = 'password123';

  beforeEach(async () => {
    const email = `restart-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    user = await User.create({ name: 'Restart Test', email, password, role: 'buyer' });
  });

  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
    resetBlacklist();
  });

  const login = () =>
    request(app).post('/api/auth/login').send({ email: user.email, password });

  it('accepts a pre-restart refresh token after in-memory state is lost', async () => {
    // 1. Login — issues an access + refresh token pair and persists a DB row.
    const loginRes = await login().expect(200);
    const refreshToken = extractCookie(loginRes, 'refresh_token');
    expect(refreshToken).toBeDefined();
    expect(await RefreshToken.countDocuments({ user: user._id })).toBe(1);

    // 2. Simulate a fresh backend process: all in-memory state is gone.
    //    (The JWT blacklist is the only in-memory auth store.)
    resetBlacklist();

    // 3. Refresh using ONLY the httpOnly cookie + the persisted DB record.
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${refreshToken}`)
      .expect(200);

    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.user.email).toBe(user.email);
    const newAccessToken = extractCookie(refreshRes, 'access_token');
    expect(newAccessToken).toBeDefined();

    // The freshly minted access token authenticates a protected route.
    await request(app)
      .get('/api/auth/me')
      .set('Cookie', `access_token=${newAccessToken}`)
      .expect(200);

    // Single-use rotation: the presented (pre-restart) token is now revoked
    // in the DB, so replaying it fails.
    const replayRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${refreshToken}`)
      .expect(401);
    expect(replayRes.body.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('keeps a logout revocation in effect after in-memory state is lost', async () => {
    const loginRes = await login().expect(200);
    const accessToken = extractCookie(loginRes, 'access_token');
    const refreshToken = extractCookie(loginRes, 'refresh_token');

    // Logout — must durably revoke the DB refresh row. The browser sends
    // BOTH cookies to /api/auth/logout (path '/'), so the server sees the
    // refresh token to revoke.
    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `access_token=${accessToken}; refresh_token=${refreshToken}`)
      .expect(200);

    // Simulate the restart BEFORE checking. Logout also populated the
    // in-memory blacklist; wiping it proves the survival comes from the DB
    // revocation, not from in-memory state.
    resetBlacklist();

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${refreshToken}`)
      .expect(401);
    expect(refreshRes.body.code).toBe('REFRESH_TOKEN_INVALID');
  });
});
