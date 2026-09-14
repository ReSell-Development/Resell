# Changelog

## QA Audit Commits

The following two commits contain all work from the full QA audit of the ReSell marketplace.

### Commit `b114a49` — P0-10: 64-bit DCT pHash + threshold

Isolated commit for the perceptual hashing upgrade.

- Upgraded `backend/src/services/imageHash.js` from 16-bit average hash to 64-bit DCT pHash
- Added `HASH_SIMILARITY_THRESHOLD = 12` to `backend/src/services/fraudDetection.js`
- Updated `backend/src/__tests__/duplicate-detection.test.js` boundary tests for new threshold

### Commit `389700b` — Complete P0 fixes, P1 backlog, and test infrastructure

Single commit bundling all remaining audit work (89 files, 8482 insertions). Contents:

#### P0 Fixes (Critical)

| ID | Fix | Files |
|----|-----|-------|
| P0-1 | Remove console.log leaking password hash | `controllers/authController.js` |
| P0-2 | Fix duplicate chat messages — socket-only send | `controllers/chatController.js` |
| P0-3 | Process error handlers + graceful shutdown | `server.js` |
| P0-4 | Remove CORS `*` fallback, require CLIENT_URL in production | `server.js` |
| P0-5 | Fix ReDoS in location/brand filters + minPrice=0 falsy bug | `controllers/productController.js` |
| P0-6 | Fix `$text` + `$meta` sort conflict | `controllers/productController.js` |
| P0-7 | Eliminate double Cloudinary upload + remove broken undici import | `controllers/productController.js`, `services/imageProcessor.js` |
| P0-8 | CSP/security headers via helmet (referrerPolicy, permissionsPolicy) | `server.js` |
| P0-9 | JWT migrated to httpOnly cookies with refresh tokens | `controllers/authController.js`, `utils/jwt.js`, `middleware/auth.js`, `server.js` |

#### P1 Items (Backlog)

| ID | Fix | Files |
|----|-----|-------|
| P1-1 | Server-side token blacklist on logout (JTI-based) | `utils/tokenBlacklist.js`, `controllers/authController.js`, `middleware/auth.js` |
| P1-2 | Per-endpoint rate limiting | `middleware/rateLimiters.js`, `server.js` |
| P1-3 | Security headers enhancement | `server.js` |
| P1-4 | Phone format validation | `middleware/validate.js` |
| P1-5 | Seed script random admin password | `utils/seed.js` |

#### Infrastructure

- `cookie-parser` installed and wired into `server.js`
- `config/validateEnv.js` for production config validation
- `docker-compose.yml` for staging deployment
- `docs/secret-rotation-runbook.md` for secret rotation procedures
- `utils/generateFixtures.js` for duplicate detection threshold validation
- `src/scripts/validate-duplicate-threshold.js` standalone pairwise validation
- `duplicate-fixture-report.json` — real-photo hash report (Pexels photographs)
- Test infrastructure: 13 test suites, 172+ tests via Jest + mongodb-memory-server + supertest + socket.io-client
