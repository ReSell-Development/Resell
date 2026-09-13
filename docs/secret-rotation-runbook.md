# Secret Rotation Runbook — ReSell Marketplace

**Last updated:** 2026-09-13  
**Status:** All secrets in `.env` are flagged as compromised and MUST be rotated before staging deployment.

---

## 1. JWT Signing Secret (`JWT_SECRET`)

### Risk
All existing access and refresh tokens are signed with the compromised secret. An attacker with the secret can forge valid tokens for any user.

### How to Generate
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
This produces a 128-char hex string (512 bits of entropy).

### Order of Operations (Zero-Downtime)

**Phase 1 — Dual-Secret Support (deploy first)**
1. Generate new `JWT_SECRET_NEW` value.
2. Add `JWT_SECRET_NEW` to environment variables (all environments: production, staging, CI/CD).
3. Update `jwt.js` to accept BOTH secrets during verification:

```js
// In verifyToken(), try new secret first, fall back to old
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET_NEW);
  } catch {
    return jwt.verify(token, process.env.JWT_SECRET); // old secret
  }
};
```

4. **Deploy** this change. All existing tokens continue working (verified against old secret). New tokens are signed with new secret.

**Phase 2 — Wait for Token Expiry (1-7 days)**
5. Access tokens expire in 1 hour (`JWT_EXPIRE=1h`). Wait at least 1 hour for all active access tokens to expire.
6. Refresh tokens expire in 7 days. Wait 7 days (or force-logout all users if acceptable).
7. Monitor error rates — if `TOKEN_INVALID` errors spike before expected, something is wrong.

**Phase 3 — Remove Old Secret**
8. Remove `JWT_SECRET` from environment, set `JWT_SECRET = <same as JWT_SECRET_NEW>` or just remove the fallback.
9. Deploy the single-secret version.
10. Confirm old secret is dead: attempt `jwt.verify(oldToken, oldSecret)` — should throw.

### Where Else the Old Value Might Be
- `.env` files on all developer machines
- CI/CD pipeline secrets (GitHub Actions, Vercel, etc.)
- Docker Compose files or docker-compose.yml
- Any hardcoded values in test files (check `jest.setup.js`, `jest.global.setup.js`)
- AWS SSM / Secrets Manager / Vault if used

### Confirmation
```bash
# After Phase 3, verify old secret is rejected:
node -e "
  const jwt = require('jsonwebtoken');
  const oldToken = jwt.sign({id:'test'}, 'OLD_SECRET');
  try { jwt.verify(oldToken, 'OLD_SECRET'); console.log('FAIL: old secret still works'); }
  catch { console.log('PASS: old secret rejected'); }
"
```

---

## 2. Cloudinary API Key/Secret

### Risk
An attacker with the Cloudinary credentials can upload/delete/modify images, potentially replacing product photos with malicious content or deleting all images.

### How to Generate
1. Log in to https://console.cloudinary.com
2. Go to **Settings → API Keys**
3. Click **Generate new API key** — note the new API Key and API Secret
4. Optionally: set upload restrictions (allowed formats, max file size, folder restrictions)

### Order of Operations
1. Generate new API key/secret in Cloudinary dashboard.
2. **Keep the old key active** — don't delete it yet (existing image URLs still reference Cloudinary).
3. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` with new values to production env.
4. Deploy new backend.
5. Verify new uploads work: create a test product with an image, confirm it uploads.
6. Verify image deletion works: delete the test product, confirm image is removed from Cloudinary.
7. **Only after verification**: Revoke the old API key in Cloudinary dashboard.
8. Old image URLs (using `publicId`) will continue working — Cloudinary serves by publicId, not by API key.

### Where Else the Old Value Might Be
- `.env` files on all developer machines
- CI/CD pipeline secrets
- Any backup scripts that upload to Cloudinary
- Monitoring/alerting tools that check Cloudinary usage

### Confirmation
```bash
# After revoking old key, attempt an upload with old credentials:
curl -X POST "https://api.cloudinary.com/v1_1/YOUR_CLOUD/image/upload" \
  -F "file=@test.jpg" \
  -F "api_key=OLD_API_KEY" \
  -F "timestamp=$(date +%s)" \
  -F "signature=INVALID"
# Should return 401 Unauthorized
```

---

## 3. Admin Account Password

### Risk
The seed script (`src/utils/seed.js:405`) hardcodes `admin@resell.com / Admin@123456`. If this is the real admin password, an attacker can take over the platform.

### How to Generate
Use a password manager to generate a 24+ character password with mixed case, numbers, and symbols.

### Order of Operations
1. **Before rotating the password**: create a second admin account as a backup:
   ```bash
   node -e "
     require('dotenv').config();
     const mongoose = require('mongoose');
     const User = require('./src/models/User');
     (async () => {
       await mongoose.connect(process.env.MONGODB_URI);
       await User.create({ name: 'Backup Admin', email: 'backup-admin@resell.com', password: 'GENERATED_PASSWORD_HERE', role: 'admin' });
       console.log('Backup admin created');
       process.exit(0);
     })();
   "
   ```
2. Log in as current admin (if still possible) or use the backup admin.
3. Change the admin password via the profile update endpoint or directly in MongoDB:
   ```bash
   node -e "
     require('dotenv').config();
     const mongoose = require('mongoose');
     const User = require('./src/models/User');
     (async () => {
       await mongoose.connect(process.env.MONGODB_URI);
       const admin = await User.findOne({ email: 'admin@resell.com' }).select('+password');
       admin.password = 'NEW_SECURE_PASSWORD';
       await admin.save();
       console.log('Admin password updated');
       process.exit(0);
     })();
   "
   ```
4. Update the seed script to NOT hardcode the password (use env var or generate randomly):
   ```js
   // In seed.js, replace hardcoded password with:
   const adminPassword = process.env.ADMIN_PASSWORD || require('crypto').randomBytes(18).toString('base64');
   ```
5. Update all environments' `.env` with the new admin password if needed.
6. Delete the backup admin account if no longer needed.

### Where Else the Old Value Might Be
- `seed.js` (line 405 — hardcoded `Admin@123456`)
- `.env` files (if `ADMIN_PASSWORD` is set)
- README or documentation files
- Database seed scripts in CI/CD

### Confirmation
```bash
# Attempt login with old password — should fail:
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@resell.com","password":"Admin@123456"}'
# Should return 401 INVALID_CREDENTIALS
```

---

## Post-Rotation Checklist

- [ ] All developer `.env` files updated
- [ ] CI/CD pipeline secrets updated
- [ ] Production environment variables updated
- [ ] Staging environment variables updated
- [ ] Backup admin account deleted
- [ ] Seed script no longer hardcodes passwords
- [ ] Old Cloudinary API key revoked
- [ ] Old JWT secret removed from all environments
- [ ] Monitoring alerts reviewed (no false positives from rotation)
- [ ] All team members notified of new credentials
