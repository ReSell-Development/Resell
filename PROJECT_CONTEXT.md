# PROJECT_CONTEXT.md — ReSell Marketplace

> Auto-generated reference document. Last updated: 2026-09-09.
> Covers backend (Node/Express/MongoDB) + frontend (React/Vite/Tailwind).

---

## 1. Project Overview

ReSell is an AI-powered peer-to-peer marketplace for buying and selling second-hand items. Sellers list products with photos; the system automatically runs computer vision analysis (condition scoring, damage detection, classification), generates price recommendations, detects fraud risk, and computes seller trust scores. Buyers browse, filter, favorite, make offers, and chat with sellers in real time. An admin dashboard provides user/product/report management and analytics.

### Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | >= 18 |
| HTTP Framework | Express | ^4.18.2 |
| Database | MongoDB (via Mongoose) | ^7.6.0 |
| Real-time | Socket.io | ^4.7.2 |
| Queue/Worker | BullMQ + ioredis | ^5.0.0 / ^5.3.2 |
| Image Storage | Cloudinary | ^1.41.0 |
| Image Processing | sharp | ^0.32.6 |
| Auth | jsonwebtoken + bcryptjs | ^9.0.2 / ^2.4.3 |
| Validation | express-validator | ^7.0.1 |
| Frontend Framework | React | ^18.2.0 |
| Routing | react-router-dom | ^6.26.0 |
| Build Tool | Vite | ^5.0.0 |
| CSS | Tailwind CSS | ^3.3.5 |
| Animation | framer-motion | ^10.16.0 |
| Backend Testing | Jest + Supertest + mongodb-memory-server | ^29.7.0 / ^6.3.3 / ^9.1.0 |
| Frontend Testing | Vitest + React Testing Library + jsdom | ^1.6.0 / ^14.2.0 / ^24.0.0 |

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React/Vite)                 │
│  Pages: Home, Marketplace, ProductDetail, Chat, Admin…  │
│  Pages: Checkout, OrderSuccess, OrderCancelled, Orders  │
│  Contexts: Auth, Socket, Currency                        │
│  Services: axios → /api/*                                │
│  Socket.io client ←→ real-time events                    │
└──────────┬──────────────────────┬───────────────────────┘
           │ REST (port 80→5000)  │ WebSocket
           ▼                      ▼
┌─────────────────────────────────────────────────────────┐
│              Backend (Express + Socket.io)               │
│  Routes → Controllers → Models (Mongoose)                │
│  Middleware: auth(JWT), validate, upload(multer)         │
│  Services: CV adapter, fraud, trust, price, exchange,    │
│            chat, notification, priceSweep, stripeService │
│  Socket handlers: chat:send, chat:read, typing           │
└────┬─────────────┬──────────────────────┬───────────────┘
     │             │                      │
     ▼             ▼                      ▼
┌─────────┐ ┌───────────┐  ┌──────────────────────────┐
│ MongoDB │ │   Redis   │  │      Cloudinary CDN       │
│  (13)   │ │  (7-alpine│  │  (image upload/delete)    │
└─────────┘ └─────┬─────┘  └──────────────────────────┘
                  │
     ┌────────────┴────────────┐
     │  BullMQ Workers (procs) │
     │  imageProcessor (conc=2)│
     │  priceAnalyzer  (conc=2)│
     │  + price-refinement-    │
     │    sweep (repeatable)   │
     └─────────────────────────┘
     ┌─────────────────────────┐
     │   Stripe (external)     │
     │   Checkout Sessions     │
     │   Webhooks → /webhook   │
     └─────────────────────────┘
```

---

## 2. Backend Inventory

### 2.1 Mongoose Models (12 total)

**User** (`users`)
| Field | Type | Notes |
|---|---|---|
| name | String | required, max 60 |
| email | String | required, unique, lowercase |
| password | String | required, minlength 6, select:false |
| role | String | enum: buyer/seller/admin, default: buyer |
| avatar | {url, publicId} | |
| bio | String | max 500 |
| phone, location | String | |
| isActive | Boolean | default: true |
| isVerified | Boolean | default: false |
| lastSeen | Date | |
| averageResponseMinutes | Number | default: 60 |
| complaints | Number | default: 0 |
| suspendedUntil | Date | |
Indexes: `email`, `role`, `createdAt`. Methods: `comparePassword()`, `toJSON()`. Hook: pre-save password hash.

**Product** (`products`)
| Field | Type | Notes |
|---|---|---|
| title | String | required, max 120 |
| description | String | required, max 4000 |
| price | Number | required, min 0 |
| originalPrice | Number | default: 0 |
| currencyCode | String | default: USD, 3-char |
| category | ObjectId → Category | required |
| brand, model | String | |
| condition | String | enum: new/like-new/good/fair/poor |
| yearsUsed | Number | min 0 |
| specifications | [{key, value}] | |
| location | {city, state, country} | |
| images | [{url, publicId, isPrimary}] | |
| seller | ObjectId → User | required |
| status | String | enum: active/sold/pending/rejected/removed |
| isFlagged, flagReason | | |
| views, favoritesCount | Number | |
| aiAnalysis | Object | Nested: classification, conditionScore, damageScore, damageDescription, imageHashes[], duplicateMatch, priceRecommendation (with refinedAt, refinementAttempts), riskAssessment, lastAnalyzedAt |
Indexes: text(title+description+brand+model), `status+createdAt`, `category+status`, `price`, `location.city`, `seller+status`, `riskAssessment.riskScore`.

**Category** (`categories`)
| Field | Type | Notes |
|---|---|---|
| name | String | required, unique |
| slug | String | required, unique, lowercase |
| description, icon, image | String | |
| parent | ObjectId → Category | self-ref, hierarchical |
| isActive | Boolean | |

**Conversation** (`conversations`)
| Field | Type | Notes |
|---|---|---|
| participants | [ObjectId → User] | required |
| product | ObjectId → Product | default: null |
| lastMessage | ObjectId → Message | |
| lastMessageAt | Date | default: Date.now |
| unreadCounts | Map<userId, Number> | Keys canonicalized via `toKey()` |
Indexes: `participants`, `lastMessageAt`, compound unique `participants+product`.

**Message** (`messages`)
| Field | Type | Notes |
|---|---|---|
| conversation | ObjectId → Conversation | required |
| sender | ObjectId → User | required |
| content | String | required, max 2000 |
| attachments | [{url, publicId, type}] | type: image |
| readBy | [{user, readAt}] | |
| status | String | enum: sent/delivered/read |
| type | String | enum: text/image/system |
Indexes: `conversation+createdAt`.

**Notification** (`notifications`)
| Field | Type | Notes |
|---|---|---|
| recipient | ObjectId → User | required, indexed |
| type | String | enum: message/offer/report_update/admin_action |
| payload | Object | {conversationId, offerId, productId, reportId, senderId} — all ObjectId, default null |
| read | Boolean | default: false, indexed |
| timestamps | Date | createdAt, updatedAt |
Indexes: `recipient+read+createdAt` (compound). Created by `notificationService.notify()`.

**Offer** (`offers`)
| Field | Type | Notes |
|---|---|---|
| product | ObjectId → Product | required |
| buyer | ObjectId → User | required |
| seller | ObjectId → User | required |
| amount | Number | required, min 1 |
| currencyCode | String | default: USD, uppercase |
| message | String | default: '', max 500 |
| status | String | enum: pending/accepted/rejected/countered/withdrawn/expired |
| parentOffer | ObjectId → Offer | default: null (links counter-offers) |
| expiresAt | Date | default: now + 7 days |
| history | [{status, actor, at, note}] | Audit trail |
| timestamps | Date | createdAt, updatedAt |
Indexes: `buyer+createdAt`, `seller+createdAt`, `product+status`. State machine enforced via `VALID_TRANSITIONS` map and `canTransition()` method.

**Favorite** (`favorites`) — `user+product` unique compound. **Review** (`reviews`) — `seller+buyer` unique compound, rating 1-5. **Report** (`reports`) — polymorphic `target` via `refPath: targetType` (product/user), status: pending/reviewing/resolved/dismissed.

**Sale** (`sales`) — Order state machine with full Stripe integration.
| Field | Type | Notes |
|---|---|---|
| product | ObjectId → Product | required, indexed |
| seller | ObjectId → User | required, indexed |
| buyer | ObjectId → User | required, indexed |
| salePrice | Number | required, min 1 |
| platformFee | Number | default 0, 5% of salePrice |
| netAmount | Number | required |
| currencyCode | String | default USD |
| status | String | enum: pending_payment/paid/shipped/delivered/completed/payment_failed/cancelled/refunded/disputed |
| stripeSessionId | String | sparse unique index |
| stripePaymentIntentId | String | |
| stripeRefundId | String | |
| paymentStatus | String | enum: unpaid/paid/refunded/failed |
| shippingAddress | addressSchema | embedded: fullName, phone, line1, line2, city, state, postalCode, country, location(GeoJSON) |
| trackingNumber | String | |
| shippedAt, deliveredAt, completedAt | Date | |
| history | [{status, actor, at, note}] | Audit trail |
Indexes: `stripeSessionId` (sparse unique), `buyer+createdAt`, `seller+createdAt`, `status`. Methods: `canTransition(newStatus)`, `transition(newStatus, actorId, note)`. State machine enforced via `VALID_TRANSITIONS` map.

**AuditLog** (`auditlogs`) — actor/action/targetType/target/metadata(ipAddress, userAgent).

### 2.2 Routes (11 route files)

| Mount | Method | Path | Auth | Purpose |
|---|---|---|---|---|
| `/api/auth` | POST | `/register` | PUBLIC | Create account |
| | POST | `/login` | PUBLIC | Authenticate, return JWT |
| | POST | `/logout` | USER | Client-side token discard |
| | GET | `/me` | USER | Get current user |
| | PUT | `/profile` | USER | Update profile fields |
| | PUT | `/password` | USER | Change password |
| `/api/products` | GET | `/` | optionalAuth | List/filter/search products |
| | GET | `/brands` | PUBLIC | Distinct brand list |
| | GET | `/mine` | USER | Current user's products |
| | GET | `/:id` | optionalAuth | Single product |
| | GET | `/:id/similar` | optionalAuth | Similar products |
| | POST | `/upload-images` | USER | Upload to Cloudinary |
| | POST | `/` | USER | Create product (seller only) |
| | PUT | `/:id` | USER | Update product |
| | DELETE | `/:id` | USER | Delete product |
| | PATCH | `/:id/sold` | USER | Mark as sold |
| `/api/categories` | GET | `/` | PUBLIC | List categories |
| | GET | `/stats` | PUBLIC | Category stats |
| | GET | `/:slug` | PUBLIC | Single category |
| | POST | `/` | ADMIN | Create category |
| | PUT | `/:id` | ADMIN | Update category |
| | DELETE | `/:id` | ADMIN | Delete category |
| `/api/favorites` | GET | `/` | USER | User's favorites |
| | GET | `/:productId/check` | optionalAuth | Check if favorited |
| | POST | `/:productId` | USER | Add favorite |
| | DELETE | `/:productId` | USER | Remove favorite |
| `/api/chat` | POST | `/conversations` | USER | Create/get conversation |
| | GET | `/conversations` | USER | List user's conversations |
| | GET | `/conversations/:id/messages` | USER | Paginated messages |
| | POST | `/messages` | USER | Send message |
| | POST | `/conversations/:id/read` | USER | Mark as read |
| `/api/sellers` | GET | `/:id` | PUBLIC | Seller profile |
| | GET | `/:id/trust` | PUBLIC | Trust score |
| | POST | `/:id/reviews` | USER | Add review |
| | GET | `/:id/similar` | optionalAuth | Seller's similar products |
| `/api/reports` | POST | `/` | USER | Create report |
| | GET | `/` | ADMIN | List reports |
| | PUT | `/:id` | ADMIN | Update report |
| `/api/admin` | GET | `/stats` | ADMIN | Dashboard stats |
| | GET | `/analytics` | ADMIN | Analytics data |
| | GET | `/users` | ADMIN | List users |
| | PUT | `/users/:id` | ADMIN | Update user |
| | DELETE | `/users/:id` | ADMIN | Delete user |
| | GET | `/products` | ADMIN | List products |
| | PUT | `/products/:id` | ADMIN | Moderate product |
| `/api/exchange-rates` | GET | `/rates` | PUBLIC | Current exchange rates |
| | POST | `/convert` | PUBLIC | Currency conversion |
| `/api/offers` | POST | `/` | USER | Create offer |
| | GET | `/` | ADMIN | List all offers |
| | GET | `/mine` | USER | Buyer's offers |
| | GET | `/received` | USER | Seller's received offers |
| | PUT | `/:id` | USER | Update offer status |
| | POST | `/:id/accept` | USER | Accept offer (seller) |
| | POST | `/:id/reject` | USER | Reject offer (seller) |
| | POST | `/:id/counter` | USER | Counter-offer |
| `/api/notifications` | GET | `/` | USER | List notifications (paginated) |
| | GET | `/unread` | USER | Get unread count |
| | PATCH | `/:id/read` | USER | Mark one as read |
| | PATCH | `/read-all` | USER | Mark all as read |
| `/api/checkout` | POST | `/webhook` | Stripe sig | Stripe webhook (raw body, mounted before express.json) |
| | POST | `/session` | USER | Create Stripe checkout session |
| `/api/orders` | GET | `/mine` | USER | Buyer's orders |
| | GET | `/selling` | USER | Seller's sales |
| | GET | `/:id` | USER | Single order (participant/admin only) |
| | PATCH | `/:id/ship` | USER | Ship order (seller only) |
| | PATCH | `/:id/deliver` | USER | Confirm delivery (buyer only) |
| | POST | `/:id/cancel` | USER | Cancel order (refund if paid) |

Rate limiters: 500 req/15min on `/api`, 20 req/15min on auth endpoints.

### 2.3 Controllers (13 files)

- **authController** — register, login, logout, getMe, updateProfile, changePassword
- **productController** — getProducts (with filter/sort/pagination), getBrands, getMyProducts, getProduct, getSimilarProducts, uploadImages, createProduct, updateProduct, deleteProduct, markAsSold
- **chatController** — getOrCreateConversation, getConversations, getMessages, sendMessage, markRead. Uses `toKey()` for all `unreadCounts` Map keys. Sends notifications via `notificationService.notify()` on new messages.
- **adminController** — getDashboardStats, getAnalytics, getAllUsers, updateUser, deleteUser, getAllProducts, moderateProduct
- **categoryController** — getCategories, getCategoryStats, getCategory, createCategory, updateCategory, deleteCategory
- **favoriteController** — getFavorites, checkFavorite, addFavorite, removeFavorite
- **sellerController** — getSellerProfile, getSellerTrust, addReview, getSimilarProducts
- **reportController** — createReport, getReports, updateReport
- **exchangeController** — getExchangeRates, convertCurrency
- **offerController** — createOffer, listOffers, getMyOffers, getReceivedOffers, updateOffer, acceptOffer, rejectOffer, counterOffer. State machine enforced via `Offer.canTransition()`.
- **notificationController** — getMyNotifications, getUnread, markAsRead, markAllAsRead
- **checkoutController** — createCheckoutSession (atomic product lock via `findOneAndUpdate` precondition, rollback on failure), handleWebhook (Stripe signature verification, event dispatch)
- **orderController** — getMyOrders, getMySales, getOrder (participant/admin scoped), shipOrder (seller), deliverOrder (buyer), cancelOrder (pending→cancelled or paid→refunded via Stripe)

### 2.4 Services (11 files)

| Service | Purpose | External API? | Key Algorithm |
|---|---|---|---|
| `cvAdapter.js` | Adapter pattern for CV providers. Factory `createCVProvider()` returns `LocalHeuristicProvider` (default) or `RemoteMLProvider` (when `ML_SERVICE_URL` set). | No | Delegates to `computerVision.js` or remote stub |
| `computerVision.js` | Image quality, condition scoring, damage detection, product classification | No (all local) | Sobel-like edge detection, block-based brightness/contrast, keyword bag-of-words |
| `fraudDetection.js` | Risk scoring for listings | No | 7-signal weighted scoring (duplicates, pricing, account age, complaints) |
| `trustScore.js` | Seller reputation 0-100 | No | 6-component weighted: account age, sales, rating, response time, complaints, listing quality |
| `priceRecommendation.js` | Price estimation with explanations | No | Exponential depreciation, IQR outlier removal, condition/damage adjustments, market blending |
| `similarProducts.js` | Product recommendations | No | Multi-factor scoring: category, brand, price proximity, condition, Jaccard title similarity |
| `imageHash.js` | Perceptual image hashing | No | Block average hash (32x32→16-bit), Hamming distance comparison |
| `exchangeRates.js` | Multi-currency conversion | Yes: open.er-api.com, exchangerate.host | Multi-provider failover, 1-hour TTL cache, 20 supported currencies |
| `chatService.js` | Socket broadcast helpers | No | Broadcast to user rooms, read receipt relay |
| `notificationService.js` | In-app notification creation and querying | No | Central `notify()`, `getNotifications()`, `getUnreadCount()`, `markRead()`, `markAllRead()` |
| `stripeService.js` | Stripe Checkout Sessions, webhooks, refunds | Yes: Stripe API | `createCheckoutSession()` (session + Sale), `handleCheckoutCompleted()` (idempotent: checks `sale.status !== 'pending_payment'`), `handleSessionExpired()`, `handlePaymentFailed()`, `createRefund()`, `calculateFee()` (5% platform fee) |

**CV Adapter Detail (`cvAdapter.js`):**
- `LocalHeuristicProvider` — wraps `computerVision.js` functions directly. Used by default.
- `RemoteMLProvider` — stub that logs a warning when `ML_SERVICE_URL` is configured but the service isn't running. Falls back to `LocalHeuristicProvider` for all methods. Ready for real implementation when an ML service is available.
- Factory: `createCVProvider()` checks `process.env.ML_SERVICE_URL` and returns the appropriate provider.

### 2.5 Middleware (4 files)

- **auth.js** — `protect` (JWT verify, check isActive/suspended), `authorize(...roles)`, `optionalAuth` (silent attach)
- **validate.js** — 21 express-validator chains covering all endpoints (including `createOfferValidation`, `counterOfferValidation`, `createCheckoutSessionValidation`)
- **upload.js** — multer memoryStorage, image MIME only, 10MB/file, 8 files max
- **audit.js** — `audit(action)` factory, creates AuditLog on requests (body truncated to 500 chars)

### 2.6 BullMQ Workers/Queues

**Queues** (`queues/index.js`):
- `image-processing` — 3 retries, exponential backoff 2s, removeOnComplete: 100, removeOnFail: 50
- `price-analysis` — same config as above. Also hosts the `price-refinement-sweep` repeatable job (every 10 minutes).

**Worker: `imageProcessor.js`** (concurrency: 2, run via `npm run worker`)
Pipeline per job: fetch/upload images → Cloudinary → perceptual hash → parallel CV analysis (condition, damage, classification via `cvAdapter`) → initial price recommendation (inline) → fraud detection → update product document → enqueue delayed `price-analysis` job (30s).

**Worker: `priceAnalyzer.js`** (concurrency: 2, run via `npm run worker:price`)
Handles two job types:
- `refine-price` (default) — single-product price refinement via `price-analysis` queue
- `price-refinement-sweep` — scheduled sweep that finds stale products (generatedAt >5min old, no refinedAt, refinementAttempts <5) and re-enqueues `refine-price` jobs for them. Registered as a repeatable job at server startup via `registerSweepJob()`.

**Sweep service** (`services/priceSweep.js`):
- `sweepStalePrices({ enqueue })` — queries stale products, increments `refinementAttempts`, calls `enqueue(productId)` for each. Caps at 50 per sweep. Logs results.
- `MAX_REFINEMENT_ATTEMPTS = 5` — after 5 failed attempts, product is flagged for manual review instead of retried.

**Note:** Workers run as separate processes (not imported by `server.js`). Each must be started independently via `npm run worker` and `npm run worker:price` (local dev) or via Docker Compose services `worker` and `worker-price` (production). The sweep job is registered by `server.js` at startup.

### 2.7 Socket.io Events

| Event | Direction | Payload | Behavior |
|---|---|---|---|
| `connection` | in | — | Join `user:{userId}` room, update lastSeen, broadcast `user:status`, auto-join conversation rooms |
| `conversation:join` | in | `conversationId` | Join `conversation:{id}` room |
| `conversation:leave` | in | `conversationId` | Leave room |
| `chat:send` | in | `{conversationId, text, attachments}` | Persist message, update unread counts (via `toKey()`), emit `chat:message` + `conversation:update` to participants, `chat:message:sent` ack to sender |
| `chat:read` | in | `{conversationId}` | Mark messages read, reset unread count (via `toKey()`), emit `conversation:read` to others, `chat:read:ack` to self |
| `typing:start` | in | `{conversationId, recipientId}` | Broadcast to conversation room + recipient user room |
| `typing:stop` | in | `{conversationId, recipientId}` | Same |
| `chat:message` | out | Message object | New message for recipient |
| `conversation:update` | out | `{conversationId}` | Trigger list refresh |
| `conversation:read` | out | `{conversationId, readerId, readCount}` | Read receipt |
| `chat:message:sent` | out | `{conversationId, messageId, status}` | Delivery confirmation |
| `chat:read:ack` | out | `{conversationId, readCount}` | Read confirmation |
| `user:status` | out | `{userId, online, lastSeen}` | Presence broadcast |
| `chat:error` | out | `{message}` | Error notification |

### 2.8 Utility Modules

| Module | Purpose |
|---|---|
| `utils/mongoId.js` | `toKey(id)` — canonical ID-to-string for Map keys. Handles null, string, ObjectId, and any object with `.toString()`. |
| `utils/AppError.js` | Custom error class with `statusCode` and `code` fields |
| `utils/errorHandler.js` | Express error middleware, AppError → JSON response |
| `utils/jwt.js` | `generateToken()`, `verifyToken()` |
| `utils/slug.js` | URL-safe slug generation |
| `utils/seed.js` | Database seeder for categories + admin user |
| `config/db.js` | Mongoose connection |
| `config/cloudinary.js` | Cloudinary config, `uploadToCloudinary()`, `deleteFromCloudinary()` |
| `config/validateEnv.js` | Startup validation — fail-fast if `MONGODB_URI` or `JWT_SECRET` missing, set defaults for optional vars |

---

## 3. Frontend Inventory

### 3.1 Pages (22 files)

| Page | Route | Auth | Purpose |
|---|---|---|---|
| Home | `/` | No | Hero, categories, trending products, features, CTA |
| Login | `/login` | No | Email/password form |
| Register | `/register` | No | Name/email/password/role/location form |
| Marketplace | `/marketplace` | No | Product grid with search, filters, sort, pagination |
| ProductDetail | `/product/:id` | No | Full product view, AI analysis, seller info, chat/offers |
| SellerProfile | `/seller/:id` | No | Seller stats, trust breakdown, listings, reviews |
| SellProduct | `/sell` | Yes | 4-step wizard: photos → details → AI analysis → review |
| EditProduct | `/edit/:id` | Yes | Pre-filled edit form |
| Favorites | `/favorites` | Yes | Saved products grid |
| MyProducts | `/my-products` | Yes | User's listings with actions |
| Profile | `/profile` | Yes | Profile editor + password change |
| Chat | `/chat`, `/chat/:id` | Yes | Two-pane: conversation list + message thread, unread badges, read receipts, online status |
| Checkout | `/checkout/:id` | Yes | Address form → review → Stripe redirect |
| OrderSuccess | `/order-success` | Yes | Payment confirmed, polling for webhook |
| OrderCancelled | `/order-cancelled` | Yes | Payment cancelled page |
| Orders | `/orders` | Yes | Buyer order list with status badges |
| AdminDashboard | `/admin/dashboard` | Admin | Stats cards, recent/flagged listings |
| AdminUsers | `/admin/users` | Admin | User table with role/status management |
| AdminProducts | `/admin/products` | Admin | Product table with moderation |
| AdminReports | `/admin/reports` | Admin | Report cards with status workflow |
| AdminAnalytics | `/admin/analytics` | Admin | Charts: signups, listings, categories, sellers |
| AdminCategories | `/admin/categories` | Admin | Category CRUD |
| NotFound | `*` | No | 404 page |

### 3.2 Components

**Layout** — `Navbar` (floating glass header, nav pill animation, user menu, Messages unread badge, Bell notification icon with dropdown + mark-all-read), `Footer`, `Hero` (floating product cards with parallax), `PageTransition` (5 transition variants)

**Product** — `ProductCard` (tilt card, favorite heart, condition badge), `SellForm` (dynamic specs), `SellerInfo` (trust badge, message button), `ImageGallery` (main + thumbnails), `AIAnalysisPanel` (condition/damage bars, price recommendation, risk assessment)

**Admin** — `AdminLayout` (sidebar + content area)

**Checkout** — `DeliveryAddressForm` (location auto-detect)

**UI (16 components)** — `AntigravityBackground` (canvas particles), `CurrencySelector` (20 currencies), `CustomCursor` + `CursorGlow`, `MagneticButton` (mouse-following), `ScrollReveal`/`RevealOnScroll` (IntersectionObserver), `TiltCard`/`FloatingCard`/`MagneticCard`, `Particles`/`FloatingShapes`, `Price` (multi-currency), `PriceTag`, `TrustBadge`, `Loader`, `Skeleton`/`ProductCardSkeleton`/`SkeletonGrid`, `EmptyState`, `ErrorState`, `LocationDetectButton`

### 3.3 Contexts (3 files)

- **AuthContext** — `user`, `loading`, `login()`, `register()`, `logout()`, `updateUser()`, `refresh()`. Persists token in localStorage.
- **SocketContext** — `socket`, `connected`, `totalUnread`, `unreadNotifications`, `setUnreadNotifications`, `onlineUsers`, `on()`, `off()`, `emit()`, `joinConversation()`, `leaveConversation()`, `emitTyping()`, `emitStopTyping()`, `setUnread()`, `incrementUnread()`, `clearUnread()`. Fetches unread notification count on connect.
- **CurrencyContext** — `currency`, `base`, `rates`, `supported`, `setCurrency()`, `refreshRates()`. Persists in localStorage. Auto-detects from user location.

### 3.4 API Services (2 files)

**`services/api.js`** — Axios instance with `VITE_API_URL` base, Bearer token interceptor, 401 redirect.

**`services/services.js`** — 12 service objects:
- `authService` (6 endpoints), `productService` (10), `categoryService` (6), `favoriteService` (4), `chatService` (5), `reportService` (3), `sellerService` (4), `offerService` (8), `adminService` (7), `notificationService` (4), `checkoutService` (1), `orderService` (6)

### 3.5 Currency/Geolocation

`utils/currency.js` — 20 supported currencies, country→currency mapping, locale detection, `convertPrice()` via USD base. `utils/geolocation.js` — Nominatim reverse geocoding, browser geolocation API. `hooks/useLocationDetector.js` — hook wrapping detect with error handling.

---

## 4. Environment & Config

### 4.1 Environment Variables

| Variable | Backend | Frontend | Notes |
|---|---|---|---|
| `MONGODB_URI` | config/db.js, seed.js | — | **Required.** Validated at startup. |
| `JWT_SECRET` | jwt.js | — | **Required.** Validated at startup. |
| `JWT_EXPIRE` | jwt.js | — | Default: 7d |
| `PORT` | server.js | — | Default: 5000 |
| `NODE_ENV` | server.js, errorHandler | — | Default: development |
| `CLIENT_URL` | server.js (CORS) | — | Default: * |
| `REDIS_URL` | queues/index.js, validateEnv.js | — | Default: redis://localhost:6379 |
| `STRIPE_SECRET_KEY` | stripeService.js | — | **Required in production.** Validated at startup. |
| `STRIPE_WEBHOOK_SECRET` | checkoutController.js | — | **Required in production.** Validated at startup. |
| `STRIPE_PUBLISHABLE_KEY` | — | — | Frontend Stripe.js (not used server-side) |
| `CLOUDINARY_CLOUD_NAME` | config/cloudinary.js | — | |
| `CLOUDINARY_API_KEY` | config/cloudinary.js | — | |
| `CLOUDINARY_API_SECRET` | config/cloudinary.js | — | |
| `ML_SERVICE_URL` | cvAdapter.js | — | Optional. When set, `RemoteMLProvider` is used (currently falls back to heuristic). |
| `ADMIN_EMAIL` | seed.js | — | For database seeding |
| `ADMIN_PASSWORD` | seed.js | — | For database seeding |
| `VITE_API_URL` | — | services/api.js | Default: http://localhost:5000 |
| `VITE_SOCKET_URL` | — | SocketContext.jsx | Default: http://localhost:5000 |

### 4.2 Startup Validation (`config/validateEnv.js`)

Called at server boot (before `connectDB()`). Behavior:
- **Fail-fast** (process.exit(1)) if `MONGODB_URI` or `JWT_SECRET` is missing.
- **Fail-fast in production** if `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` is missing.
- **Warn in development** if Stripe vars are not set (checkout unavailable).
- **Set defaults** for optional vars: `PORT=5000`, `NODE_ENV=development`, `JWT_EXPIRE=7d`, `CLIENT_URL=*`, `REDIS_URL=redis://localhost:6379`.
- Logs `[Config] Environment validated successfully` on pass.

### 4.3 Docker/Nginx Setup

**Services:** mongodb (mongo:7), redis (redis:7-alpine), backend (node:20-alpine), worker (imageProcessor.js), worker-price (priceAnalyzer.js), frontend (multi-stage: node build → nginx:alpine serve). Optional ml-service (commented out).

**Ports:** Backend → 5000, Frontend → 80 (nginx).

**Nginx:** SPA fallback (`try_files`), reverse proxy `/api` → backend:5000, WebSocket proxy `/socket.io` → backend:5000, gzip enabled.

**Stripe webhook note:** The `/api/checkout/webhook` route must receive the raw request body (not JSON-parsed) for Stripe signature verification. In `server.js`, checkoutRoutes is mounted **before** `express.json()` so the webhook endpoint gets the raw buffer. The session-creation route (`/api/checkout/session`) uses the standard JSON parser since it doesn't need signature verification.

---

## 5. Feature Status Matrix

| Feature | Status | Key Files | Notes |
|---|---|---|---|
| JWT Auth (register/login/roles) | ✅ Yes | authController, authRoutes, auth.js middleware, AuthContext | No email verification, no password reset |
| Product CRUD | ✅ Yes | productController, productRoutes, SellForm, Marketplace | No image reordering, no draft saving |
| AI Item Analysis (CV) | ✅ Yes | cvAdapter.js, computerVision.js, imageProcessor.js, AIAnalysisPanel | Adapter pattern: heuristic by default, ML stub ready |
| Fraud Detection | ✅ Yes | fraudDetection.js, imageProcessor.js | No auto-blocking, no admin notifications |
| Seller Trust Scoring | ✅ Yes | trustScore.js, TrustBadge, SellerInfo | No historical trend, no badges |
| Price Recommendation | ✅ Yes | priceRecommendation.js, priceAnalyzer.js | **Two-pass design (intentional):** Pass 1 — immediate synchronous heuristic estimate during image processing (`imageProcessor.js:80-91`), writes `generatedAt`. Pass 2 — async refined estimate via `price-analysis` queue ~30s later (`priceAnalyzer.js`), writes `generatedAt` + `refinedAt`. The refined pass uses fuller sold-comparable data. `refinedAt` presence on a listing proves the async pass ran. |
| Similar Products | ✅ Partial | similarProducts.js | Basic scoring, no collaborative filtering |
| Image Hashing (duplicate detection) | ✅ Yes | imageHash.js, fraudDetection.js | Block-average hash only (not DCT) |
| Real-time Chat | ✅ Yes | chatController, sockets/index.js, Chat.jsx, SocketContext | No file upload in chat UI, no message deletion/editing |
| Multi-currency | ✅ Yes | exchangeRates.js, CurrencyContext, currency.js | 1-hour cache, 20 currencies |
| Admin Dashboard | ✅ Yes | adminController, AdminLayout, 6 admin pages | No export/report generation |
| Background Processing | ✅ Yes | BullMQ queues, imageProcessor + priceAnalyzer workers, priceSweep service | Docker Compose: `worker` + `worker-price` services. Sweep retry via repeatable job. |
| Offers/Negotiation | ✅ Yes | models/Offer.js, controllers/offerController.js, routes/offerRoutes.js | State machine with history, counter-offers |
| Notifications | ✅ Yes | models/Notification.js, services/notificationService.js, controllers/notificationController.js, notificationRoutes.js | In-app only — wired into chat. No push (FCM/APNs) yet. |
| Checkout/Payment | ✅ Yes | checkoutController, orderController, checkoutRoutes, orderRoutes, stripeService, Checkout.jsx, Orders.jsx | Stripe Checkout Sessions, webhook verification, order state machine, product locking, 5% platform fee |
| Search (full-text) | ✅ Yes | Product text index, marketplace search | No autocomplete, no search analytics |
| Reports/Flagging | ✅ Yes | reportController, reportRoutes, AdminReports | No auto-actions on high-complaint sellers |
| User Profile/Settings | ✅ Yes | Profile.jsx, authController | No email/notification preferences |
| Premium UX | ✅ Yes | 16 UI components, framer-motion throughout | No i18n, no PWA support |

---

## 6. Test Coverage

### Backend Tests (15 test files, ~125+ test cases)

| File | Tests | Coverage |
|---|---|---|
| `auth.test.js` | 18 | Register, login, me, profile, password — validation, auth, error cases |
| `products.test.js` | 16 | CRUD, filtering, ownership, admin override, similar products |
| `favorites.test.js` | 8 | Add, remove, check, duplicate prevention, auth |
| `fraud.test.js` | 4 | Duplicate images, suspicious pricing, new account flagging |
| `chat.test.js` | 16 | Conversation CRUD, message send, read marking, access control |
| `services.test.js` | ~15 | exchangeRates.convert, imageHash.hammingDistance/similarity, priceRecommendation (4 cases), trustScore (2 cases), fraudDetection (3 cases), computerVision (2 cases) |
| `admin.test.js` | ~5 | Admin stats, user management, product moderation |
| `categories.test.js` | ~5 | Category CRUD, auth guards, validation |
| `sellers.test.js` | ~4 | Seller profile, trust score, reviews |
| `reports.test.js` | ~4 | Report creation, listing, auth, validation |
| `unreadCounts.test.js` | 2 | Conversation create + message send + unread key consistency (string vs ObjectId) |
| `priceSweep.test.js` | 5 | Stale product re-enqueue, fresh product skip, already-refined skip, max-attempts flag, empty sweep |
| `checkout.test.js` | 6 | Auth guard, session creation, product lock (pending status), 409 for sold product, self-purchase rejection, webhook idempotency (double `checkout.session.completed` → only one `sold`) |
| `orders.test.js` | 14 | Buyer orders, seller sales, single order access control, ship (seller), deliver (buyer), cancel pending→cancelled (releases product), cancel paid→refunded (Stripe refund), invalid transition rejection, Sale model state machine (canTransition valid + invalid) |
| `helpers.js` | — | Shared: `createUser()`, `testProtectedRoute()` |

**Test infrastructure:** `jest.global.setup.js` starts `mongodb-memory-server` and sets `MONGODB_URI`. `jest.global.teardown.js` stops it. `jest.setup.js` provides per-file `beforeAll/afterEach/afterAll` with collection cleanup. Tests run via `npm test` (jest --runInBand --detectOpenHandles --forceExit).

### Frontend Tests (1 test file)

| File | Tests | Coverage |
|---|---|---|
| `smoke.test.jsx` | 4 | Home, Marketplace, Chat, ProductDetail render without crashing |

**Test infrastructure:** `vitest.config.js` configures jsdom environment + `@testing-library/jest-dom`. `test/setup.js` imports jest-dom matchers. `test/test-utils.jsx` provides `renderWithProviders()` with mocked Auth/Socket/Currency contexts. Tests run via `npm test` (vitest run).

### Paths with NO Tests

- Exchange rates / currency conversion (service + controller)
- Socket.io handler integration tests
- BullMQ worker tests (imageProcessor, priceAnalyzer)
- Audit middleware
- Upload middleware
- Offer controller (create, accept, reject, counter)
- Notification controller
- Frontend component tests beyond smoke tests

---

## 7. Known Issues / Technical Debt

### Resolved (during 10-item fix pass)

These issues were identified, fixed, and verified as part of the recent work:

1. **`unreadCounts` key inconsistency** — All Map keys now go through `toKey()` in `utils/mongoId.js`. Verified across chatController.js, sockets/index.js, and Conversation model. Test added (`unreadCounts.test.js`).

2. **Hollow `offerService` on frontend** — `services.js` defined 8 offer endpoints but no backend existed. Full offer system implemented: `Offer` model with state machine, `offerController` (8 handlers), `offerRoutes`, validation chains.

3. **Dead `price-analysis` queue** — Queue was defined but had no worker or enqueue call. `priceAnalyzer.js` worker created; `imageProcessor.js` now enqueues delayed reprice jobs. Workers run as separate processes via `npm run worker:price`. Docker Compose now has separate `worker` and `worker-price` services. `refinedAt` field added to distinguish async pass from initial estimate.

4. **`ML_SERVICE_URL` ambiguity** — `computerVision.js` previously had undefined behavior when `ML_SERVICE_URL` was set. CV adapter pattern implemented (`cvAdapter.js`) with `LocalHeuristicProvider` and `RemoteMLProvider` stub.

5. **Missing `REDIS_URL` in `.env.example`** — Added.

6. **No startup env validation** — `validateEnv.js` added; fail-fast on missing required vars.

7. **Missing `notificationRoutes` import in `server.js`** — `notificationRoutes` was used but never `require()`'d. Fixed.

8. **Dead imports in `test-utils.jsx`** — Imported non-existent named exports from AuthContext/SocketContext/CurrencyContext. Removed.

9. **`vi.mock` inside `it()` in `smoke.test.jsx`** — Hoisted mock broke `BrowserRouter`. Moved to file-level.

10. **Non-recoverable price-analysis enqueue failure** — `priceSweep.js` service + `price-refinement-sweep` repeatable job added. Stale products (generatedAt >5min old, no refinedAt) are re-enqueued every 10 minutes with a 5-attempt cap. `refinementAttempts` field added to Product schema.

### Remaining Debt

- **No email verification or password reset** — Auth is JWT-only with no recovery flow.
- **No push notifications** — In-app only; no FCM/APNs integration.
- **No message deletion/editing** in chat.
- **No image reordering** in product listings.
- **No draft saving** for product listings.
- **Price-analysis enqueue failure — auto-recovered with retry cap** — If Redis is down when `imageProcessor.js` tries to enqueue a `price-analysis` job, the error is logged. A `price-refinement-sweep` repeatable job runs every 10 minutes, finds products where `generatedAt` is >5 min old and `refinedAt` is null, and re-enqueues them. Each retry increments `refinementAttempts`; after 5 attempts the product is flagged for manual review instead of being retried indefinitely. The "permanently stuck" case now requires 5 consecutive sweep failures, not a single Redis blip.
- **No index on `Conversation.unreadCounts`** — Map queries rely on application-level filtering.
- **No seller order management page (Sales.jsx)** — `Orders.jsx` shows buyer orders; seller has no dedicated view to manage sales, update tracking, or mark shipped. `orderService` exists in frontend but `Sales.jsx` page not yet created.

---

## 8. Suggested Next Steps

1. **[Feature] Create `Sales.jsx` seller order management page** — `orderService.mySales()` exists in frontend; build the seller-facing page to list sales, update tracking numbers, and mark orders as shipped.
   - Files: new `frontend/src/pages/Sales.jsx`, update `App.jsx` routes, update `Navbar.jsx` links

2. **[Test] Verify webhook idempotency live with Stripe CLI** — The mock-based test confirms the guard logic, but a live test with `stripe listen --forward-to` would confirm end-to-end webhook processing, signature verification, and concurrent delivery handling.
   - Files: manual test via `stripe trigger checkout.session.completed`

3. **[Feature] Wire Offer Notifications into Chat** — When an offer is accepted/rejected/countered, generate a notification and optionally a system message in the related chat thread.
   - Files: update `controllers/offerController.js`, integrate `notificationService.js`

4. **[Feature] Add Offer Expiry Cron** — Auto-expire offers past their `expiresAt` date. Use a scheduled BullMQ job or cron library.
   - Files: new `services/offerExpiry.js` or update `queues/index.js`

5. **[Feature] Integrate Push Notifications (FCM/APNs)** — Extend the notification system with push delivery for offline users.
   - Files: new `services/pushService.js`, integrate with `notificationService.js`

6. **[Test] Add Socket.io Integration Tests** — Write integration tests for real-time chat, typing indicators, and notification delivery.
   - Files: new `__tests__/sockets.test.js`

7. **[Test] Add Offer Controller Tests** — Test create, accept, reject, counter, state machine transitions, and authorization.
   - Files: new `__tests__/offers.test.js`

8. **[Refactor] Implement Real `RemoteMLProvider`** — The adapter is ready; implement the actual HTTP calls to a model serving endpoint when available.
   - File: `services/cvAdapter.js`

9. **[Test] Expand Frontend Tests** — Add component tests for critical flows: product creation wizard, offer creation, notification dropdown, chat message send.
   - Files: expand `frontend/src/test/__tests__/`
