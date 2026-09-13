const request = require('supertest');
const mongoose = require('mongoose');
const { app, server } = require('../server');
const User = require('../models/User');

// Helper: extract access_token from set-cookie header
const extractToken = (res) => {
  const setCookie = res.headers['set-cookie'] || [];
  const accessCookie = setCookie.find((c) => c.startsWith('access_token='));
  return accessCookie ? accessCookie.split(';')[0].split('=')[1] : null;
};

describe('Auth Routes', () => {
  let authToken;

  afterAll(async () => {
    await server.close();
  });

  afterEach(async () => {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  const getAuthToken = async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123',
      });
    return extractToken(res);
  };

  beforeEach(async () => {
    authToken = await getAuthToken();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user and set cookies', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'newuser@example.com',
          password: 'password123',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.user).toMatchObject({
        name: 'Test User',
        email: 'newuser@example.com',
        role: 'buyer',
      });
      // Token should be in httpOnly cookie, not in response body
      expect(res.body.token).toBeUndefined();
      const token = extractToken(res);
      expect(token).toBeDefined();
    });

    it('should reject duplicate email', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User 2',
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(400);
    });

    it('should reject invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'invalid-email',
          password: 'password123',
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('email');
    });

    it('should reject short password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: 'test2@example.com',
          password: '123',
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('password');
    });

    it('should reject missing name', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test3@example.com',
          password: 'password123',
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('should register seller role', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Seller User',
          email: 'seller@example.com',
          password: 'password123',
          role: 'seller',
        })
        .expect(201);

      expect(res.body.user.role).toBe('seller');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials and set httpOnly cookies', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user).toMatchObject({ email: 'test@example.com' });
      // Token must NOT be in the response body
      expect(res.body.token).toBeUndefined();
      // Token must be in httpOnly cookie
      const token = extractToken(res);
      expect(token).toBeDefined();
      // Verify cookie flags
      const setCookie = res.headers['set-cookie'] || [];
      const accessCookie = setCookie.find((c) => c.startsWith('access_token='));
      expect(accessCookie).toContain('HttpOnly');
      authToken = token;
    });

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        })
        .expect(401);

      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
        })
        .expect(401);

      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject missing credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user with valid token cookie', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `access_token=${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user).toMatchObject({ email: 'test@example.com' });
    });

    it('should also work with Bearer header', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should reject request without token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    it('should reject invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', 'access_token=invalid-token')
        .expect(401);

      expect(res.body.code).toBe('TOKEN_INVALID');
    });
  });

  describe('PUT /api/auth/profile', () => {
    it('should update user profile', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Cookie', `access_token=${authToken}`)
        .send({
          name: 'Updated Name',
          bio: 'New bio',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user.name).toBe('Updated Name');
      expect(res.body.user.bio).toBe('New bio');
    });

    it('should reject too long name', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Cookie', `access_token=${authToken}`)
        .send({
          name: 'a'.repeat(61),
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/auth/password', () => {
    it('should change password with valid current password', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .set('Cookie', `access_token=${authToken}`)
        .send({
          currentPassword: 'password123',
          newPassword: 'newpassword123',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should reject wrong current password', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .set('Cookie', `access_token=${authToken}`)
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'newpassword123',
        })
        .expect(401);

      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject short new password', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .set('Cookie', `access_token=${authToken}`)
        .send({
          currentPassword: 'password123',
          newPassword: '123',
        })
        .expect(400);

      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });
});