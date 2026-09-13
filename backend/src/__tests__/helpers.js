const request = require('supertest');
const User = require('../models/User');

// Creates a user and returns { user, token, cookies }
// Token is extracted from the set-cookie header (httpOnly cookie flow).
const createUser = async (overrides = {}) => {
  const defaults = {
    name: 'Test User',
    email: `test${Date.now()}${Math.random().toString(36).slice(2)}@example.com`,
    password: 'password123',
    role: 'buyer',
  };
  const user = await User.create({ ...defaults, ...overrides });
  const res = await request(require('../server').app)
    .post('/api/auth/login')
    .send({ email: user.email, password: defaults.password });

  // Extract token from the access_token httpOnly cookie
  const setCookie = res.headers['set-cookie'] || [];
  const accessCookie = setCookie.find((c) => c.startsWith('access_token='));
  const token = accessCookie ? accessCookie.split(';')[0].split('=')[1] : null;

  return { user, token, cookies: setCookie };
};

// Helper to test any protected route for auth/authorization/validation
const testProtectedRoute = ({
  method, path, body, validToken, role = 'buyer',
}) => {
  describe('Auth/Authorization guard', () => {
    it('rejects without token (401)', async () => {
      const res = await request(require('../server').app)
        [method](path)
        .send(body || {});
      expect(res.status).toBe(401);
    });

    it('rejects with invalid token (401)', async () => {
      const res = await request(require('../server').app)
        [method](path)
        .set('Cookie', 'access_token=invalid')
        .send(body || {});
      expect(res.status).toBe(401);
    });

    if (role !== 'any') {
      it('rejects wrong role (403)', async () => {
        const wrongRoleUser = await createUser({
          role: role === 'admin' ? 'buyer' : 'admin',
          email: `wrongrole${Date.now()}@example.com`,
        });
        const res = await request(require('../server').app)
          [method](path)
          .set('Cookie', `access_token=${wrongRoleUser.token}`)
          .send(body || {});
        expect(res.status).toBe(403);
      });
    }
  });
};

module.exports = { createUser, testProtectedRoute };
