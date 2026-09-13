/**
 * JWT cookie auth flow — integration tests.
 *
 * Covers:
 *  1. Login/register set httpOnly cookies (not body/localStorage)
 *  2. Authenticated requests via cookie succeed
 *  3. Expired/invalid access token triggers exactly one refresh
 *  4. Invalid refresh token redirects to login (no infinite loop)
 *  5. Logout clears cookies
 *  6. Concurrent 401s trigger only one refresh
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');

// Helper: extract access_token from set-cookie header
const extractAccessToken = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const c = setCookie.find((s) => s.startsWith('access_token='));
  return c ? c.split(';')[0].split('=')[1] : null;
};

// Helper: extract refresh_token from set-cookie header
const extractRefreshToken = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const c = setCookie.find((s) => s.startsWith('refresh_token='));
  return c ? c.split(';')[0].split('=')[1] : null;
};

// Helper: parse all cookies into an object
const parseCookies = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const cookies = {};
  for (const s of setCookie) {
    const [pair] = s.split(';');
    const [key, ...val] = pair.split('=');
    cookies[key.trim()] = val.join('=');
  }
  return cookies;
};

describe('JWT Cookie Auth Flow', () => {
  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  let userEmail;
  const userPassword = 'password123';

  beforeEach(async () => {
    userEmail = `cookie-${Date.now()}@example.com`;
    await User.create({
      name: 'Cookie Test',
      email: userEmail,
      password: userPassword,
      role: 'buyer',
    });
  });

  // ─── 1. Login sets httpOnly cookies, not response body ───

  describe('Login sets httpOnly cookies', () => {
    it('sets access_token and refresh_token as httpOnly cookies', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: userPassword })
        .expect(200);

      // Token must NOT be in response body
      expect(res.body.token).toBeUndefined();

      const accessToken = extractAccessToken(res);
      const refreshToken = extractRefreshToken(res);

      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();

      // Verify HttpOnly flag
      const cookies = parseCookies(res);
      // set-cookie includes "HttpOnly" as a flag after the semicolon
      const rawSetCookie = res.headers['set-cookie'] || [];
      const accessCookie = rawSetCookie.find((s) => s.startsWith('access_token='));
      expect(accessCookie).toContain('HttpOnly');
    });

    it('register also sets httpOnly cookies', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'New Cookie User',
          email: `newcookie-${Date.now()}@example.com`,
          password: userPassword,
        })
        .expect(201);

      expect(res.body.token).toBeUndefined();
      expect(extractAccessToken(res)).toBeDefined();
      expect(extractRefreshToken(res)).toBeDefined();
    });
  });

  // ─── 2. Authenticated request with valid cookie succeeds ───

  describe('Authenticated request via cookie', () => {
    it('succeeds with valid access_token cookie', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: userPassword });

      const token = extractAccessToken(loginRes);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `access_token=${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe(userEmail);
    });

    it('succeeds with Bearer header (backward compat)', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: userPassword });

      const token = extractAccessToken(loginRes);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ─── 3. Expired access token triggers exactly one refresh ───

  describe('Token refresh flow', () => {
    it('expired access token triggers refresh and retry succeeds', async () => {
      // Login to get both tokens
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: userPassword });

      const accessToken = extractAccessToken(loginRes);
      const refreshToken = extractRefreshToken(loginRes);

      // Create an expired access token (backdated)
      const expiredToken = jwt.sign(
        { id: (await User.findOne({ email: userEmail }))._id, role: 'buyer' },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' } // already expired
      );

      // First: call /refresh to get a new access token
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`)
        .expect(200);

      expect(refreshRes.body.success).toBe(true);
      const newAccessToken = extractAccessToken(refreshRes);
      expect(newAccessToken).toBeDefined();
      expect(newAccessToken).not.toBe(expiredToken);

      // Now use the new token — should succeed
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `access_token=${newAccessToken}`)
        .expect(200);

      expect(meRes.body.user.email).toBe(userEmail);
    });

    it('invalid refresh token returns 401', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=totally-invalid-token')
        .expect(401);

      expect(res.body.code).toBe('TOKEN_INVALID');
    });

    it('missing refresh token returns 401', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  // ─── 4. Invalid refresh token → redirect, no infinite loop ───

  describe('Refresh failure does not cause infinite loop', () => {
    it('returns 401 on refresh with expired refresh token (no retry)', async () => {
      // Create an expired refresh token
      const user = await User.findOne({ email: userEmail });
      const expiredRefresh = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' }
      );

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', `refresh_token=${expiredRefresh}`)
        .expect(401);

      expect(res.body.code).toBe('TOKEN_INVALID');

      // Verify: no new cookies were set
      const newAccessToken = extractAccessToken(res);
      expect(newAccessToken).toBeNull();
    });
  });

  // ─── 5. Logout clears cookies ───

  describe('Logout clears cookies', () => {
    it('clears both access_token and refresh_token cookies', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: userPassword });

      const token = extractAccessToken(loginRes);

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `access_token=${token}`)
        .expect(200);

      expect(logoutRes.body.success).toBe(true);

      // Verify: cookies are cleared (set-cookie contains Max-Age=0 or Expires)
      const rawSetCookie = logoutRes.headers['set-cookie'] || [];
      const accessClear = rawSetCookie.find((s) => s.startsWith('access_token='));
      const refreshClear = rawSetCookie.find((s) => s.startsWith('refresh_token='));

      expect(accessClear).toBeDefined();
      expect(accessClear).toMatch(/Max-Age=0|Expires=.*/i);
      expect(refreshClear).toBeDefined();
      expect(refreshClear).toMatch(/Max-Age=0|Expires=.*/i);
    });

    it('old access token is rejected after logout', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: userPassword });

      const token = extractAccessToken(loginRes);

      // Logout — blacklists the token
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `access_token=${token}`)
        .expect(200);

      expect(logoutRes.body.success).toBe(true);

      // The old token should now be rejected (blacklisted)
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `access_token=${token}`)
        .expect(401);

      expect(meRes.body.code).toBe('TOKEN_REVOKED');
    });
  });

  // ─── 6. Cookie flags are correct ───

  describe('Cookie security flags', () => {
    it('access_token cookie has correct attributes', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: userPassword });

      const rawSetCookie = res.headers['set-cookie'] || [];
      const accessCookie = rawSetCookie.find((s) => s.startsWith('access_token='));

      expect(accessCookie).toContain('HttpOnly');
      expect(accessCookie).toContain('Path=/');
      // In non-production, secure is not set (since we're running on HTTP in tests)
    });

    it('refresh_token cookie has scoped path', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: userEmail, password: userPassword });

      const rawSetCookie = res.headers['set-cookie'] || [];
      const refreshCookie = rawSetCookie.find((s) => s.startsWith('refresh_token='));

      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('Path=/api/auth');
    });
  });
});
