# ReSell

> **Smart Pricing, Fraud Detection, and Sustainable Resale**

ReSell is an **AI-powered peer-to-peer marketplace** for buying and selling pre-owned products. It combines a modern React storefront with a Node.js/Express backend, real-time chat, and on-device/heuristics-based AI services to help sellers price fairly, buyers trust listings, and the platform catch duplicates and fraud — extending product lifecycles and promoting sustainable resale.

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![Cloudinary](https://img.shields.io/badge/Cloudinary-Image%20Storage-3448C5?logo=cloudinary&logoColor=white)](https://cloudinary.com/)
[![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-4-FF6F00?logo=tensorflow&logoColor=white)](https://www.tensorflow.org/js)
[![License](https://img.shields.io/badge/License-Unlicensed-lightgrey)](#license)

---

## Table of Contents

- [Project Overview](#project-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Installation & Setup](#installation--setup)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [ML Models & Implementation](#ml-models--implementation)
- [Security](#security)
- [Database](#database)
- [Future Enhancements](#future-enhancements)
- [Contributing](#contributing)
- [License](#license)
- [Contact & Support](#contact--support)

---

## Project Overview

ReSell enables anyone to list second-hand products with images, descriptions, categories, pricing, and location, then discover and purchase through search, filtering, favorites, offers, and checkout. Sellers manage listings and orders; buyers browse the marketplace, chat with sellers, and pay via Stripe. An admin surface moderates users, products, and reports.

The platform's differentiator is **embedded AI/ML** (price recommendation, image classification, perceptual-hash duplicate detection, fraud/risk scoring, seller trust scoring, and computer-vision condition/damage analysis) and **real-time** messaging via Socket.io — all integrated directly into the listing and buying flow without requiring a separate Python ML service by default (optional `ML_SERVICE_URL` can delegate to an external service).

---

## Features

### Core Marketplace

- **Authentication** — Register, login, logout, refresh, profile update, password change, JWT with httpOnly cookies (`access_token` + `refresh_token`) and token blacklisting. Roles: `buyer`, `seller`, `admin` (`backend/src/middleware/auth.js:6`, `backend/src/utils/jwt.js:26`).
- **Product listings** — Create/update/delete, mark as sold, upload up to 8 images (10 MB each, `memoryStorage` + `sharp` + Cloudinary transformation `1200×1200`, `backend/src/middleware/upload.js:1`, `backend/src/config/cloudinary.js:42`), title/description/brand/model/specifications/condition (`new`/`like-new`/`good`/`fair`/`poor`)/years used/currency/location.
- **Search & discovery** — Full-text index on `title`/`description`/`brand`/`model` (`backend/src/models/Product.js:114`), filtering by category, price range, city, condition, brand, status; sorting and pagination (`GET /api/products`, `backend/src/routes/productRoutes.js:25`).
- **Categories** — CRUD (admin), slug-based lookup, stats (`backend/src/routes/categoryRoutes.js:17`).
- **Favorites / wishlist** — Add/remove/list/check (`backend/src/routes/favoriteRoutes.js:12`).
- **Offers** — Create/list/mine/received/accept/reject/counter (`backend/src/routes/offerRoutes.js:18`).
- **Orders & checkout** — Stripe Checkout Sessions + webhook (`POST /api/checkout/session`, `POST /api/checkout/webhook` with `express.raw`, `backend/src/server.js:68`), order lifecycle: mine/selling/ship/deliver/cancel (`backend/src/routes/orderRoutes.js:15`).
- **User profiles & reviews** — Seller profile, trust score, reviews (`backend/src/routes/sellerRoutes.js:12`).
- **Reports** — Listing/user reports for moderation (`backend/src/routes/reportRoutes.js:14`).
- **Notifications** — List/unread/mark-read/mark-all-read (`backend/src/routes/notificationRoutes.js:8`).
- **Multi-currency** — Live exchange rates with scheduled refresh (`GET /api/exchange-rates/rates`, `POST /api/exchange-rates/convert`, `backend/src/services/exchangeRates.js`, auto-started in `backend/src/server.js:154`).
- **Similar products** — Related listing suggestions (`GET /api/products/:id/similar`, `backend/src/services/similarProducts.js`).
- **Admin** — Dashboard stats/analytics, user management, product moderation (`backend/src/routes/adminRoutes.js:20`).

### Real-Time

Implemented in `backend/src/sockets/index.js:7` and `frontend/src/contexts/SocketContext.jsx`:

- **Socket.io authentication** — via `auth.token`, query `token`, or `access_token` httpOnly cookie; `verifyToken` + `User` lookup.
- **Presence** — `user:status` broadcast on connect/disconnect, `lastSeen` persisted.
- **Conversations** — Auto-join `user:{id}` and `conversation:{id}` rooms; `conversation:join` / `conversation:leave` events.
- **Messaging** — `chat:send` (conversation + text/attachments) with participant check, persisted to `Message`, room broadcast; REST fallback at `POST /api/chat/messages` (`backend/src/routes/chatRoutes.js:23`).
- **Read receipts & typing** — `conversation:read`, `typing:start`/`typing:stop` patterns (see `backend/src/sockets/index.js:80`).
- **Notifications over socket** — order/offer events pushed to `user:{id}` rooms.

### AI / ML

Services live in `backend/src/services/` and are invoked during product creation/update and via dedicated endpoints:

| Feature | What it does | How it works | Where | Benefit |
|---|---|---|---|---|
| **Price recommendation** | Suggests fair resale price, range, confidence, and explanatory factors | **Heuristic multi-factor engine** — condition factor (`new` 0.95 → `poor` 0.25), category annual depreciation (e.g. Fashion 30%, Electronics 18%), brand premium (e.g. Apple 1.1×), years-used decay, comparable listings, original price, CV condition/damage scores (`backend/src/services/priceRecommendation.js:26`) | `priceRecommendation.js`, `priceSweep.js`, `workers/priceAnalyzer.js`, `GET /api/products/suggest-price` | Prevents over/under-pricing, builds buyer trust |
| **Image classification** | Maps product photos to ReSell category taxonomy | **MobileNet (TensorFlow.js)** via `@tensorflow/tfjs` + `@tensorflow-models/mobilenet` with `sharp` tensor decoding; keyword fallback when confidence is low (`backend/src/services/imageClassifier.js:1`) | `imageClassifier.js`, `cvAdapter.js`, stored in `Product.aiAnalysis.classification` | Auto-categorizes listings, catches miscategorized items |
| **Duplicate detection** | Flags re-used or near-identical images | **64-bit perceptual hash (pHash)** via 32×32 grayscale → 2D DCT → 8×8 low-frequency median threshold (`backend/src/services/imageHash.js:1`); Hamming distance ≤ 12 = duplicate (validated margin: zero false positives at ≥30) | `imageHash.js`, checked in `fraudDetection.js:24`, persisted as `aiAnalysis.imageHashes` | Prevents spam/reposts and stolen-image listings |
| **Fraud / risk detection** | Scores each listing 0–100 (`low`/`medium`/`high`) | Combines duplicate-image hits (+35), suspicious pricing vs comparables, repeated descriptions, complaint history, new-account + high-value listing, seller trust signals (`backend/src/services/fraudDetection.js:26`) | `fraudDetection.js`, persisted as `aiAnalysis.riskAssessment` | Surfaces risky listings for moderation before buyers are harmed |
| **Seller trust score** | 0–100 seller reputation | Weighted: account age (0–15), sales/activity (0–20), avg rating (0–25), response time (0–15), complaint-free ratio (0–15), listing quality (0–10) (`backend/src/services/trustScore.js:1`) | `trustScore.js`, `GET /api/sellers/:id/trust` | Helps buyers choose reliable sellers |
| **Computer vision (quality/damage)** | Condition & damage assessment from images | `sharp` pixel analysis: brightness/contrast/sharpness, heuristic scratch/damage detection; pluggable `ML_SERVICE_URL` for external model (`backend/src/services/computerVision.js:1`) | `computerVision.js`, feeds `aiAnalysis.conditionScore`/`damageScore` | Objective condition evidence, refines pricing |

Background enrichment runs via **BullMQ + Redis** (`backend/src/queues/index.js`) and workers (`backend/src/workers/imageProcessor.js`, `backend/src/workers/priceAnalyzer.js`).

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18, React Router 6, Vite 5 | SPA UI & routing & bundling |
| **Styling** | Tailwind CSS 3, PostCSS, Autoprefixer | Utility-first styling |
| **Animation** | Framer Motion 10 | Page transitions, micro-interactions |
| **Icons** | lucide-react, react-icons | Iconography |
| **State / Data** | Axios 1, React Context (Auth, Socket, Currency) | HTTP & global state |
| **Realtime (client)** | socket.io-client 4 | WebSocket messaging |
| **Backend runtime** | Node.js ≥18 (`backend/package.json:49`) | Server runtime |
| **API** | Express 4 | REST API |
| **Database** | MongoDB + Mongoose 7 | Persistence & ODM |
| **Realtime (server)** | Socket.io 4 | Presence, chat, notifications |
| **Queue** | BullMQ 5 + ioredis 5 + Redis | Background jobs (image processing, price sweep) |
| **Image pipeline** | sharp 0.32, multer 2 (memoryStorage), Cloudinary 1.41 | Upload, transform, CDN storage |
| **Auth** | jsonwebtoken 9, bcryptjs 2, cookie-parser 1 | JWT (httpOnly cookies), hashing |
| **Validation** | express-validator 7 | Request validation |
| **Security** | helmet 7, cors 2, express-rate-limit 7, express-mongo-sanitize 2, compression 1, morgan 1 | Hardening & observability |
| **Payments** | stripe 17 | Checkout Sessions & webhooks |
| **ML** | @tensorflow/tfjs 4, @tensorflow-models/mobilenet 2, sharp, crypto (Node built-in) | Image classification, pHash, CV heuristics |
| **HTTP (server)** | axios 1 | Exchange-rate fetch, optional ML service |
| **Testing (backend)** | Jest 29, Supertest 6, mongodb-memory-server 9, socket.io-client 4 | API & socket tests (20 suites) |
| **Testing (frontend)** | Vitest 1, Testing Library (react/jest-dom/user-event), jsdom 24 | Component tests |
| **Tooling** | nodemon 3, Vite plugin-react, ESLint (via Vite) | Dev experience |

> **Note on ML libraries:** this repository does **not** use Python ML libraries (no `requirements.txt`, no `scikit-learn`/`PyTorch`/etc.). All ML runs in Node.js via TensorFlow.js + heuristics. If you need a Python service, set `ML_SERVICE_URL` and implement it externally — `backend/src/services/cvAdapter.js` will delegate.

---

## Architecture

```text
                    ┌─────────────────────┐
                    │   React 18 + Vite    │
                    │  Tailwind + Motion   │
                    │  (port 3000 dev)     │
                    └────────┬────────────┘
                             │  REST (/api) + Socket.io
                             │  proxy: /api, /socket.io → :5000
                             ▼
                    ┌─────────────────────┐
                    │  Node.js + Express   │
                    │  (port 5000)         │
                    │  Helmet/CORS/Rate    │
                    │  Limit/Sanitize      │
                    └──┬───┬───┬───┬──────┘
                       │   │   │   │
              ┌────────┘   │   │   └────────┐
              ▼            ▼   ▼            ▼
         MongoDB      Cloudinary  BullMQ/Redis   Stripe
         Mongoose     (images)   (workers)     (checkout)
              │            │       │  │
              │            │   ┌───┘  └────┐
              │            │   ▼           ▼
              │            │ imageProcessor  priceAnalyzer
              │            │ sharp+upload  priceRecommendation
              └────────────┴───┴────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
        TF.js MobileNet    pHash (DCT) + CV
        imageClassifier    imageHash / computerVision
              │                 │
              └────────┬────────┘
                       ▼
                 fraudDetection
                 trustScore
                 → Product.aiAnalysis
```

**Request flow:**

1. User interacts with React app (`frontend/src/pages/*`, `frontend/src/components/*`). `frontend/src/services/api.js` and `services.js` call `VITE_API_URL`; `SocketContext.jsx` connects to `VITE_SOCKET_URL`.
2. Vite dev server (`frontend/vite.config.js:12`, port `3000`) proxies `/api` and `/socket.io` to `http://127.0.0.1:5000` so cookies/CORS work locally.
3. Express (`backend/src/server.js:28`) applies `helmet` (CSP, HSTS, etc.), `compression`, `cors({ credentials: true, origin: CLIENT_URL })`, `express.json({ limit: '10mb' })`, `cookieParser`, `mongoSanitize`, `morgan` (dev), and per-route rate limiters.
4. MongoDB stores all domain data via Mongoose models (`backend/src/models/*`).
5. Cloudinary stores images after `sharp` transform (`backend/src/config/cloudinary.js:42` → `1200×1200`, `auto:good`, `auto` format).
6. Socket.io (`backend/src/sockets/index.js:7`) authenticates via Bearer or cookie JWT and drives presence/chat/notifications.
7. BullMQ queues decouple heavy work: `imageProcessor` handles Cloudinary uploads + CV/hashing; `priceAnalyzer` refines `priceRecommendation` as comparables arrive.
8. Stripe handles payments: `POST /api/checkout/session` creates a Checkout Session; `POST /api/checkout/webhook` (raw body, `backend/src/server.js:68`) confirms orders.

---

## Project Structure

> Generated from the actual repository. `node_modules`, `dist`, and OS files omitted.

```text
ReSell/
├── backend/
│   ├── Dockerfile
│   ├── jest.global.setup.js        # starts mongodb-memory-server for tests
│   ├── jest.global.teardown.js
│   ├── jest.setup.js
│   ├── package.json                # scripts: start/dev/seed/test/worker/worker:price
│   ├── .env.example
│   ├── .env                        # local (gitignored)
│   ├── scripts/
│   │   ├── portGuard.js
│   │   └── restartBackend.js
│   └── src/
│       ├── server.js               # Express app + Socket.io + rate limiters + graceful shutdown
│       ├── config/
│       │   ├── db.js               # mongoose.connect(MONGODB_URI)
│       │   ├── cloudinary.js       # uploadToCloudinary / deleteFromCloudinary
│       │   └── validateEnv.js      # required/optional env validation
│       ├── controllers/            # 13 controllers
│       │   ├── adminController.js
│       │   ├── authController.js
│       │   ├── categoryController.js
│       │   ├── chatController.js
│       │   ├── checkoutController.js
│       │   ├── exchangeController.js
│       │   ├── favoriteController.js
│       │   ├── notificationController.js
│       │   ├── offerController.js
│       │   ├── orderController.js
│       │   ├── productController.js
│       │   ├── reportController.js
│       │   └── sellerController.js
│       ├── middleware/
│       │   ├── auth.js             # protect / authorize / optionalAuth
│       │   ├── audit.js
│       │   ├── rateLimiters.js     # productCreateLimiter, chatLimiter
│       │   ├── upload.js           # multer memoryStorage, 8 files × 10MB, image/* only
│       │   └── validate.js         # express-validator chains
│       ├── models/                 # 12 Mongoose schemas
│       │   ├── User.js
│       │   ├── Product.js          # includes aiAnalysis subdocument
│       │   ├── Category.js
│       │   ├── Conversation.js
│       │   ├── Message.js
│       │   ├── Favorite.js
│       │   ├── Offer.js
│       │   ├── Sale.js
│       │   ├── Order.js            # (orderController)
│       │   ├── Review.js
│       │   ├── Report.js
│       │   ├── Notification.js
│       │   └── AuditLog.js
│       ├── routes/                 # 13 route modules → /api/*
│       │   ├── authRoutes.js
│       │   ├── productRoutes.js
│       │   ├── categoryRoutes.js
│       │   ├── favoriteRoutes.js
│       │   ├── chatRoutes.js
│       │   ├── reportRoutes.js
│       │   ├── sellerRoutes.js
│       │   ├── adminRoutes.js
│       │   ├── exchangeRoutes.js
│       │   ├── offerRoutes.js
│       │   ├── notificationRoutes.js
│       │   ├── orderRoutes.js
│       │   └── checkoutRoutes.js
│       ├── services/               # 13 services
│       │   ├── priceRecommendation.js
│       │   ├── imageClassifier.js  # TF.js MobileNet
│       │   ├── imageHash.js        # 64-bit pHash (DCT)
│       │   ├── fraudDetection.js
│       │   ├── trustScore.js
│       │   ├── computerVision.js
│       │   ├── cvAdapter.js        # delegates to ML_SERVICE_URL if set
│       │   ├── similarProducts.js
│       │   ├── priceSweep.js
│       │   ├── exchangeRates.js
│       │   ├── stripeService.js
│       │   ├── chatService.js
│       │   └── notificationService.js
│       ├── queues/
│       │   └── index.js            # BullMQ queue + registerSweepJob
│       ├── workers/
│       │   ├── imageProcessor.js
│       │   └── priceAnalyzer.js
│       ├── sockets/
│       │   └── index.js            # Socket.io auth + rooms + chat events
│       ├── scripts/
│       │   ├── seedDemo.js
│       │   └── validate-duplicate-threshold.js
│       ├── utils/
│       │   ├── jwt.js              # generateToken/verifyToken/setTokenCookies
│       │   ├── tokenBlacklist.js
│       │   ├── errorHandler.js
│       │   ├── AppError.js
│       │   ├── slug.js
│       │   ├── mongoId.js
│       │   ├── seed.js
│       │   └── generateFixtures.js
│       └── __tests__/              # 20 test suites
│           ├── auth.test.js
│           ├── products.test.js
│           ├── chat.test.js
│           ├── socket.test.js
│           └── ...
│
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── index.html
│   ├── vite.config.js              # dev port 3000, proxy /api → :5000
│   ├── vitest.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── package.json                # scripts: dev/build/preview/test
│   ├── .env.example
│   ├── .env
│   ├── public/
│   │   ├── favicon.svg
│   │   └── health.json
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                 # React Router routes
│       ├── components/
│       │   ├── layout/             # Navbar, Footer, Hero, PageTransition
│       │   ├── product/            # ProductCard, ImageGallery, SellForm, SellerInfo, AIAnalysisPanel
│       │   ├── checkout/           # DeliveryAddressForm
│       │   ├── admin/              # AdminLayout
│       │   └── ui/                 # Loader, Skeleton, TrustBadge, Price, CurrencySelector, etc.
│       ├── pages/                  # 23 pages: Home, Marketplace, ProductDetail, SellProduct, EditProduct,
│       │   │                       # Login, Register, Profile, SellerProfile, Chat, Checkout, Orders,
│       │   │                       # Favorites, MyProducts, Admin* (Dashboard/Analytics/Products/Users/Reports/Categories)
│       ├── contexts/
│       │   ├── AuthContext.jsx
│       │   ├── SocketContext.jsx
│       │   └── CurrencyContext.jsx
│       ├── services/
│       │   ├── api.js              # axios instance (VITE_API_URL, withCredentials)
│       │   └── services.js
│       ├── hooks/
│       │   ├── useFormatPrice.js
│       │   └── useLocationDetector.js
│       ├── utils/
│       │   ├── currency.js
│       │   ├── format.js
│       │   └── geolocation.js
│       ├── styles/
│       │   └── index.css
│       └── test/
│           ├── setup.js
│           ├── test-utils.jsx
│           └── __tests__/smoke.test.jsx
│
├── .gitignore
└── README.md
```

---

## Installation & Setup

### Prerequisites

| Requirement | Version / Notes | How to verify |
|---|---|---|
| **Node.js** | `≥18.0.0` (`backend/package.json:49` engines) | `node -v` |
| **npm** | ships with Node 18 | `npm -v` |
| **MongoDB** | 5+ (local or Atlas) — `MONGODB_URI` required | `mongosh --version` |
| **Redis** | 6+ (only if using BullMQ workers) — `REDIS_URL` defaults to `redis://localhost:6379` | `redis-cli ping` |
| **Cloudinary account** | Free tier works — get creds at https://cloudinary.com/console | — |
| **Stripe account** | Required in production; optional in dev (checkout disabled if missing) | — |
| **Git** | any recent | `git --version` |

No Python runtime or `requirements.txt` is required — ML runs in Node.js.

### Clone

```bash
git clone <repository-url>
cd ReSell
```

> Replace `<repository-url>` with the actual remote (e.g. `https://github.com/<org>/ReSell.git`). Do not invent a URL if you don't know it — use the URL from which you cloned.

### Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend (from repo root)
cd ../frontend
npm install
```

---

## Environment Variables

Copy the examples and fill in real values. **Never commit real secrets.**

### Backend (`backend/.env`)

Create `backend/.env` from `backend/.env.example`:

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/resell
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-please
JWT_EXPIRE=7d
CLIENT_URL=http://localhost:3000

# Cloudinary (https://cloudinary.com/console)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Optional ML service (external Python service; omit to use built-in Node ML)
ML_SERVICE_URL=http://localhost:8000

# Redis (BullMQ queues — defaults to localhost if omitted)
REDIS_URL=redis://localhost:6379

# Stripe (required in production; optional in dev)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Admin seeding
ADMIN_EMAIL=admin@resell.com
ADMIN_PASSWORD=Admin@123456
```

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | **Yes** | MongoDB connection string (`backend/src/config/validateEnv.js:2`) |
| `JWT_SECRET` | **Yes** | HMAC secret for signing JWTs |
| `JWT_EXPIRE` | No | Access token TTL (default `7d`; `jwt.js:7` falls back to `1h` if unset) |
| `PORT` | No | Backend port (default `5000`) |
| `NODE_ENV` | No | `development`/`production`/`test` (default `development`) |
| `CLIENT_URL` | **Production yes** | Frontend origin for CORS & Socket.io (`backend/src/server.js:33`); dev warns if missing but still runs |
| `CLOUDINARY_CLOUD_NAME` | For uploads | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | For uploads | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | For uploads | Cloudinary API secret |
| `ML_SERVICE_URL` | No | If set, `cvAdapter.js` delegates CV to this external service |
| `REDIS_URL` | No | Redis URL for BullMQ (default `redis://localhost:6379`) |
| `STRIPE_SECRET_KEY` | **Production yes** | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | **Production yes** | Stripe webhook signing secret |
| `STRIPE_PUBLISHABLE_KEY` | No | Exposed to frontend for Stripe.js (not used server-side) |
| `ADMIN_EMAIL` | No | Seeded admin email (`ADMIN_EMAIL` in `seed.js`) |
| `ADMIN_PASSWORD` | No | Seeded admin password |

> `validateEnv()` (`backend/src/config/validateEnv.js:19`) exits the process if `MONGODB_URI`/`JWT_SECRET` are missing, and in `production` also requires `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`CLIENT_URL`.

### Frontend (`frontend/.env`)

Create `frontend/.env` from `frontend/.env.example`:

```env
VITE_API_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
```

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes | Backend REST base URL used by `src/services/api.js` |
| `VITE_SOCKET_URL` | Yes | Socket.io server URL used by `src/contexts/SocketContext.jsx` |

In **dev**, Vite also proxies `/api` and `/socket.io` to `127.0.0.1:5000` (`frontend/vite.config.js:16`), so these can both point at `http://localhost:5000`.

---

## Running the Application

### Backend

```bash
cd backend
npm run dev      # portGuard + nodemon src/server.js  → http://localhost:5000
# or
npm start        # node src/server.js (production)
```

Health check: `GET http://localhost:5000/health` → `{ status: "ok", timestamp }` (`backend/src/server.js:104`).

### Frontend

```bash
cd frontend
npm run dev      # vite  → http://localhost:3000  (proxies /api → :5000)
npm run build    # vite build → frontend/dist
npm run preview  # preview production build
```

### Background Workers (optional but recommended)

Image uploads and price refinement require workers. Run each in its own terminal:

```bash
cd backend
npm run worker        # node src/workers/imageProcessor.js
npm run worker:price  # node src/workers/priceAnalyzer.js
```

Without workers, products can be created but Cloudinary uploads and AI enrichment will not complete. `registerSweepJob()` is also started automatically by the server (`backend/src/server.js:171`).

### Seed Demo Data (optional)

```bash
cd backend
npm run seed     # node src/utils/seed.js  (creates admin + sample categories/products)
```

### URLs (defaults)

| Service | URL |
|---|---|
| Frontend (Vite dev) | http://localhost:3000 |
| Backend API | http://localhost:5000 |
| Backend health | http://localhost:5000/health |
| API base | http://localhost:5000/api |
| Socket.io | http://localhost:5000 (same origin) |
| Optional ML service | http://localhost:8000 (only if `ML_SERVICE_URL` set) |

---

## Usage

### 1. Create an Account

1. Open `http://localhost:3000` → **Register**.
2. Enter name, email, password (≥6 chars), optional role (`buyer`/`seller`) and location.
3. Submit — you are logged in via httpOnly cookies + Bearer token and redirected to the marketplace.
4. Existing users: **Login** with email/password. Use **Profile** to update bio/phone/avatar/location or change password.

### 2. List a Product

1. Click **Sell** (requires login).
2. Fill title, description, category, price, optional original price, brand/model, condition, years used, specifications, and location (city/state/country).
3. Upload 1–8 images (image/*, ≤10 MB each). Images are validated by `multer` (`backend/src/middleware/upload.js:6`) and optionally via `POST /api/products/upload-images`.
4. Submit — `POST /api/products` validates with `createProductValidation` (`backend/src/middleware/validate.js:28`), enforces `productCreateLimiter` (20/hour, `backend/src/middleware/rateLimiters.js:6`), and queues AI analysis:
   - `imageHash` → `aiAnalysis.imageHashes`
   - `computerVision` → `conditionScore`/`damageScore`
   - `imageClassifier` → `classification.predictedCategory`
   - `fraudDetection` → `riskAssessment`
   - `priceRecommendation` → `priceRecommendation` (refined by `priceAnalyzer` worker)
5. View your listings at **My Products** (`GET /api/products/mine`).

### 3. Search & Browse

- **Marketplace** page (`GET /api/products`) supports query params validated by `productQueryValidation`:
  - `q` — full-text search (title/description/brand/model)
  - `category` — Category ObjectId
  - `minPrice` / `maxPrice`
  - `city`, `condition`, `brand`
  - `sort` (e.g. `price`, `-createdAt`), `page`, `limit`
- Filter chips, price slider, and category nav update the query string.
- Click a card → **Product Detail** (`GET /api/products/:id`, increments `views`) shows gallery, `AIAnalysisPanel` (risk badge, condition, price suggestion), seller info, similar products (`GET /api/products/:id/similar`), and favorite toggle.
- **Price suggestion** — `GET /api/products/suggest-price?category=&brand=&model=&condition=&yearsUsed=&originalPrice=` returns `{ recommendedPrice, minPrice, maxPrice, confidence, explanation, factors }` without creating a listing.

### 4. Messaging

- On a product, click **Chat with Seller** → `POST /api/chat/conversations` (`recipientId` + optional `productId`) creates or returns a conversation.
- **Chat** page lists conversations (`GET /api/chat/conversations`) and messages (`GET /api/chat/conversations/:id/messages`).
- Send via REST (`POST /api/chat/messages`, rate-limited 60/min) or over Socket.io (`chat:send` event). Real-time delivery, typing indicators, and read receipts are handled by `SocketContext.jsx`.
- Mark read: `POST /api/chat/conversations/:id/read`.

### 5. Buying

- **Favorites** — heart icon toggles `POST /api/favorites/:productId` / `DELETE`.
- **Offers** — make an offer on a product (`POST /api/offers`), seller sees it under **Received Offers**, can accept/reject/counter.
- **Checkout** — **Checkout** page collects delivery address, then `POST /api/checkout/session` creates a Stripe Checkout Session (requires `STRIPE_SECRET_KEY`). Redirect to Stripe, then back to **Order Success** / **Order Cancelled**. Webhook at `POST /api/checkout/webhook` finalizes the order.
- **Orders** — **Orders** (buyer) and **Selling** (seller) list orders; seller can ship/deliver; buyer can cancel (`PATCH /api/orders/:id/ship|deliver`, `POST /api/orders/:id/cancel`).

### 6. Admin

Login as `admin` role → **Admin** nav appears:
- **Dashboard** (`GET /api/admin/stats`) — counts, recent activity.
- **Analytics** (`GET /api/admin/analytics`) — trends.
- **Users** — list/update/delete (`GET/PUT/DELETE /api/admin/users`).
- **Products** — moderate (`PUT /api/admin/products/:id` → `active`/`rejected`/`removed`).
- **Reports** — review user reports (`GET /api/reports`, `PUT /api/reports/:id`).

---

## API Documentation

Base URL: `http://localhost:5000` · Prefix: `/api` · Health: `GET /health` (no auth).

Auth: `Authorization: Bearer <jwt>` **or** httpOnly cookie `access_token` (`backend/src/middleware/auth.js:9`). `optionalAuth` allows anonymous browsing but enriches responses when a token is present. Admin routes additionally require `authorize('admin')`.

Global rate limiting: `500 req / 15 min` on `/api` (`backend/src/server.js:89`). Auth endpoints: `20 / 15 min`. Product creation: `20 / hour`. Chat messages: `60 / min`.

### Authentication — `/api/auth` (`backend/src/routes/authRoutes.js:20`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Register (name, email, password, role, location) |
| POST | `/api/auth/login` | No | Login (email, password) → sets cookies + returns tokens |
| POST | `/api/auth/logout` | Yes | Logout (blacklists jti, clears cookies) |
| POST | `/api/auth/refresh` | No (refresh cookie) | Refresh access token |
| GET | `/api/auth/me` | Yes | Current user profile |
| PUT | `/api/auth/profile` | Yes | Update name/bio/phone/location/avatar |
| PUT | `/api/auth/password` | Yes | Change password (currentPassword, newPassword) |

**Example — Register**

```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "Ava Smith",
  "email": "ava@example.com",
  "password": "s3curePass!",
  "role": "seller",
  "location": "Berlin, Germany"
}
```

```json
{
  "success": true,
  "data": {
    "user": { "_id": "...", "name": "Ava Smith", "email": "ava@example.com", "role": "seller" },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

### Products — `/api/products` (`backend/src/routes/productRoutes.js:25`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/products` | Optional | List/search/filter/sort/paginate products |
| GET | `/api/products/suggest-price` | Optional | Price recommendation (query: category, brand, model, condition, yearsUsed, originalPrice) |
| GET | `/api/products/brands` | No | Distinct brands |
| GET | `/api/products/mine` | Yes | Current user's listings |
| GET | `/api/products/:id` | Optional | Product detail (increments views) |
| GET | `/api/products/:id/similar` | Optional | Similar products |
| POST | `/api/products/upload-images` | Yes | Upload 1–8 images (multipart `images`) → Cloudinary URLs + hashes |
| POST | `/api/products` | Yes | Create listing (20/hour limit) |
| PUT | `/api/products/:id` | Yes (owner) | Update listing |
| DELETE | `/api/products/:id` | Yes (owner) | Delete listing |
| PATCH | `/api/products/:id/sold` | Yes (owner) | Mark as sold |

**Example — Create listing**

```http
POST /api/products
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "iPhone 13 — 128GB, Good Condition",
  "description": "Lightly used, battery 88%, no scratches on screen.",
  "price": 420,
  "originalPrice": 799,
  "category": "65f...",
  "brand": "Apple",
  "model": "iPhone 13",
  "condition": "good",
  "yearsUsed": 1,
  "specifications": [{ "key": "Storage", "value": "128GB" }],
  "location": { "city": "Berlin", "country": "Germany" },
  "images": [{ "url": "https://res.cloudinary.com/.../img.jpg", "publicId": "resell/abc123" }]
}
```

### Categories — `/api/categories` (`backend/src/routes/categoryRoutes.js:17`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/categories` | No | List categories |
| GET | `/api/categories/stats` | No | Category stats (counts) |
| GET | `/api/categories/:slug` | No | Category by slug |
| POST | `/api/categories` | Admin | Create category |
| PUT | `/api/categories/:id` | Admin | Update category |
| DELETE | `/api/categories/:id` | Admin | Delete category |

### Favorites — `/api/favorites` (`backend/src/routes/favoriteRoutes.js:12`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/favorites` | Yes | List favorites |
| GET | `/api/favorites/:productId/check` | Optional | Check if favorited |
| POST | `/api/favorites/:productId` | Yes | Add favorite |
| DELETE | `/api/favorites/:productId` | Yes | Remove favorite |

### Chat — `/api/chat` (`backend/src/routes/chatRoutes.js:20`) + Socket.io

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/chat/conversations` | Yes | Get or create conversation (recipientId, productId) |
| GET | `/api/chat/conversations` | Yes | List conversations |
| GET | `/api/chat/conversations/:id/messages` | Yes | List messages (paginated) |
| POST | `/api/chat/messages` | Yes (60/min) | Send message (conversationId, content, attachments) |
| POST | `/api/chat/conversations/:id/read` | Yes | Mark conversation as read |

**Socket.io events** (`backend/src/sockets/index.js:7`):

| Event | Direction | Payload | Description |
|---|---|---|---|
| `user:status` | Server → all | `{ userId, online }` | Presence |
| `conversation:join` | Client → server | `conversationId` | Join room |
| `conversation:leave` | Client → server | `conversationId` | Leave room |
| `chat:send` | Client → server | `{ conversationId, text, attachments }` | Send message |
| `chat:message` | Server → room | `Message` | New message broadcast |
| `conversation:read` | Client → server | `conversationId` | Read receipt |
| `typing:start` / `typing:stop` | Both | `{ conversationId, userId }` | Typing indicators |

### Offers — `/api/offers` (`backend/src/routes/offerRoutes.js:18`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/offers` | Yes | Create offer |
| GET | `/api/offers` | Admin | List all offers |
| GET | `/api/offers/mine` | Yes | Offers made by me |
| GET | `/api/offers/received` | Yes | Offers on my products |
| PUT | `/api/offers/:id` | Yes | Update offer |
| POST | `/api/offers/:id/accept` | Yes | Accept offer |
| POST | `/api/offers/:id/reject` | Yes | Reject offer |
| POST | `/api/offers/:id/counter` | Yes | Counter-offer |

### Orders — `/api/orders` (`backend/src/routes/orderRoutes.js:15`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/orders/mine` | Yes | Orders where I am buyer |
| GET | `/api/orders/selling` | Yes | Orders where I am seller |
| GET | `/api/orders/:id` | Yes | Order detail |
| PATCH | `/api/orders/:id/ship` | Yes (seller) | Mark shipped |
| PATCH | `/api/orders/:id/deliver` | Yes (seller) | Mark delivered |
| POST | `/api/orders/:id/cancel` | Yes | Cancel order |

### Checkout — `/api/checkout` (`backend/src/routes/checkoutRoutes.js:9`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/checkout/session` | Yes | Create Stripe Checkout Session |
| POST | `/api/checkout/webhook` | No (Stripe sig) | Stripe webhook (raw body) |

### Sellers — `/api/sellers` (`backend/src/routes/sellerRoutes.js:12`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/sellers/:id` | No | Seller public profile |
| GET | `/api/sellers/:id/trust` | No | Trust score (0–100 + breakdown) |
| POST | `/api/sellers/:id/reviews` | Yes | Add review |
| GET | `/api/sellers/:id/similar` | Optional | Similar products by seller |

### Other

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/exchange-rates/rates` | No | Current exchange rates |
| POST | `/api/exchange-rates/convert` | No | Convert amount between currencies |
| GET | `/api/notifications` | Yes | List notifications |
| GET | `/api/notifications/unread` | Yes | Unread count |
| PATCH | `/api/notifications/:id/read` | Yes | Mark one as read |
| PATCH | `/api/notifications/read-all` | Yes | Mark all as read |
| POST | `/api/reports` | Yes | Create report |
| GET | `/api/reports` | Admin | List reports |
| PUT | `/api/reports/:id` | Admin | Update report status |
| GET | `/api/admin/stats` | Admin | Dashboard stats |
| GET | `/api/admin/analytics` | Admin | Analytics |
| GET | `/api/admin/users` | Admin | List users |
| PUT | `/api/admin/users/:id` | Admin | Update user |
| DELETE | `/api/admin/users/:id` | Admin | Delete user |
| GET | `/api/admin/products` | Admin | List all products |
| PUT | `/api/admin/products/:id` | Admin | Moderate product |

---

## ML Models & Implementation

All ML runs **in-process (Node.js)**. No Python service is required; an external service is only used if `ML_SERVICE_URL` is set.

### Price Recommendation — `backend/src/services/priceRecommendation.js:1`

**Purpose:** Help sellers set a fair, competitive resale price that reflects condition, age, brand, and market comparables.

**Model:** Deterministic **heuristic engine** (not a trained regressor). Transparent, explainable, no training data required; refined asynchronously as more comparables appear (`priceSweep.js`, `priceAnalyzer` worker).

**Inputs:** `category`, `brand`, `model`, `specifications`, `originalPrice`, `yearsUsed`, `condition` (`new`/`like-new`/`good`/`fair`/`poor`), CV `conditionScore`/`damageScore`, comparable active listings.

**Outputs:** `recommendedPrice`, `minPrice`, `maxPrice`, `confidence` (0–1), `explanation`, `factors[]`, `source: 'heuristic' | 'ml-model'`.

**Key constants** (`priceRecommendation.js:26`):
- `CONDITION_FACTOR`: new 0.95, like-new 0.82, good 0.65, fair 0.45, poor 0.25
- `ANNUAL_DEPRECIATION` by category: Fashion 30%, Books 25%, Mobile Phones 22%, Electronics 18%, etc.
- `BRAND_PREMIUM`: Apple 1.10, Nike 1.05, Sony/Canon 1.03, etc.

**Pipeline:**

```text
Product inputs + comparables
        ↓
Condition factor × Depreciation(years, category) × Brand premium
        ↓
Comparable median clamp (min/max)
        ↓
CV adjustment (conditionScore/damageScore)
        ↓
recommendedPrice + confidence + explanation
```

Exposed via `GET /api/products/suggest-price` and persisted to `Product.aiAnalysis.priceRecommendation`.

### Image Classification — `backend/src/services/imageClassifier.js:1`

**Purpose:** Automatically map product photos to ReSell's category taxonomy and flag miscategorized listings.

**Model:** **MobileNet** (`@tensorflow-models/mobilenet` 2.1 + `@tensorflow/tfjs` 4) — ImageNet-pretrained, ~1000 classes. `sharp` decodes buffers to tensors. Falls back to keyword heuristics when TF.js is unavailable or confidence is low.

**Mapping:** `IMAGENET_TO_CATEGORY` substring map (e.g. `cellular telephone` → `Electronics`, `handbag` → `Fashion`, `sofa` → `Home & Garden` — ~80+ mappings, `imageClassifier.js:36`).

**Pipeline:**

```text
Image buffer → sharp → tensor → MobileNet.predict()
        ↓
Top-k ImageNet labels + confidences
        ↓
IMAGENET_TO_CATEGORY lookup → predictedCategory
        ↓
Persist to aiAnalysis.classification { predictedCategory, confidence }
```

### Duplicate Detection — `backend/src/services/imageHash.js:1`

**Purpose:** Catch re-uploaded, cropped, or recompressed copies of existing listing images.

**Model:** **64-bit perceptual hash (pHash) via 2D DCT** — resize to 32×32 grayscale → 2D DCT → top-left 8×8 low frequencies → median threshold → 64-bit hash (`imageHash.js:6`). Hamming distance comparison (`hammingDistance`).

**Thresholds** (`imageHash.js:18`, `fraudDetection.js:24`):
- `0–8` — very likely duplicate
- `9–12` — possibly similar (flagged; `HASH_SIMILARITY_THRESHOLD = 12`)
- `≥13` — different images (validated: same-category different products ≥30, margin 18)

Uses `crypto` for hash encoding; `sharp` for resize/grayscale.

**Pipeline:**

```text
Image → 32×32 grayscale → 2D DCT → 8×8 block → median → 64-bit hash
        ↓
Compare against up to 500 recent candidates in same category
        ↓
Hamming distance ≤ 12 → duplicateMatch { productId, similarity }
        ↓
Fraud risk +35 and moderation flag
```

CLI validator: `node backend/src/scripts/validate-duplicate-threshold.js`.

### Fraud / Risk Detection — `backend/src/services/fraudDetection.js:1`

**Purpose:** Surface suspicious listings before buyers transact.

**Model:** **Rule-based risk scorer** (0–100 → `low`/`medium`/`high`), not a trained classifier. Rules are auditable and tuned against real photo fixtures.

**Signals & weights:**
- Duplicate image (Hamming ≤12) — +35
- Suspicious pricing (far below comparable median)
- Repeated descriptions (near-identical text)
- Complaint/report history (`Report` collection)
- New account + high-value listing
- Seller trust signals (low trust → higher risk)

Persisted to `Product.aiAnalysis.riskAssessment { riskScore, riskLevel, factors[], assessedAt }` and `isFlagged`/`flagReason`.

### Seller Trust Score — `backend/src/services/trustScore.js:1`

**Purpose:** Quantify seller reliability for buyers.

**Model:** Weighted sum 0–100, level `unknown`/`low`/`medium`/`high`/`trusted`.

| Component | Max | Source |
|---|---|---|
| Account age | 15 | `User.createdAt` |
| Sales / activity | 20 | `Sale` + `Product` counts |
| Average rating | 25 | `Review` avg |
| Response time | 15 | `User.averageResponseMinutes` |
| Complaint-free ratio | 15 | `Report` count vs sales |
| Listing quality | 10 | `Product` completeness & CV scores |

Served at `GET /api/sellers/:id/trust`.

### Computer Vision (Quality & Damage) — `backend/src/services/computerVision.js:1`

**Purpose:** Provide objective condition evidence from photos.

**Model:** Heuristic pixel analysis via `sharp` (brightness, contrast, sharpness, edge/damage heuristics) + pluggable external model via `ML_SERVICE_URL` (`cvAdapter.js`). Gracefully degrades if `sharp` is unavailable.

**Outputs:** `aiAnalysis.conditionScore` (0–100), `damageScore` (0–100), `damageDescription`, `width`/`height`/`format`/`brightness`/`contrast`/`sharpness`. Feeds price recommendation and fraud detection.

---

## Security

Implemented in `backend/src/server.js:41` and middleware:

- **JWT** — `jsonwebtoken` with `jti` (per-token UUID), httpOnly cookies (`access_token` 1h, `refresh_token` 7d, `SameSite=Lax` or `None` + `Secure` in prod, `backend/src/utils/jwt.js:26`), token blacklisting on logout (`tokenBlacklist.js`), `protect` checks `isActive` and `suspendedUntil` (`middleware/auth.js:31`).
- **Password hashing** — `bcryptjs` salt 12 (`User.js:54`), `select: false` on password field, `comparePassword` method.
- **Authorization** — `authorize(...roles)` role guard; admin-only routes for categories/users/products/reports.
- **Validation** — `express-validator` chains for every write endpoint (`middleware/validate.js:8`); `handleValidation` returns `400 VALIDATION_ERROR`.
- **Helmet** — CSP, HSTS, `crossOriginResourcePolicy`, `referrerPolicy`, `permissionsPolicy` (`server.js:41`).
- **CORS** — `origin: CLIENT_URL`, `credentials: true` for both Express and Socket.io.
- **Rate limiting** — `express-rate-limit` globally (`500/15m`) plus stricter per-route: auth `20/15m`, products `20/h`, chat `60/m` (`server.js:89`, `rateLimiters.js:6`).
- **NoSQL injection** — `express-mongo-sanitize` (`server.js:81`).
- **Upload safety** — `multer` memory-only, `image/*` filter, 10 MB / 8 files cap (`middleware/upload.js:12`), Cloudinary transform + `resource_type: 'image'`.
- **Audit logging** — `middleware/audit.js` + `AuditLog` model.
- **Graceful shutdown** — `unhandledRejection`/`uncaughtException` handlers + `SIGTERM`/`SIGINT` close server + Mongoose (`server.js:192`).
- **Stripe webhook** — raw body verification via `STRIPE_WEBHOOK_SECRET`.

---

## Database

**MongoDB via Mongoose** (`backend/src/config/db.js:3` → `mongoose.connect(MONGODB_URI)`).

| Collection | Model file | Purpose | Key fields |
|---|---|---|---|
| **users** | `User.js` | Accounts | `name`, `email` (unique, indexed), `password` (hashed), `role` (buyer/seller/admin), `avatar`, `bio`, `phone`, `location`, `isActive`, `isVerified`, `lastSeen`, `averageResponseMinutes`, `complaints`, `suspendedUntil` |
| **products** | `Product.js` | Listings | `title`, `description`, `price`, `originalPrice`, `currencyCode`, `category` (ref), `brand`, `model`, `condition`, `yearsUsed`, `specifications[]`, `location{city,state,country}`, `images[]{url,publicId,isPrimary}`, `seller` (ref User), `status` (active/sold/pending/rejected/removed), `isFlagged`, `views`, `favoritesCount`, `aiAnalysis{...}` |
| **categories** | `Category.js` | Taxonomy | `name`, `slug` (unique), `description`, `icon`, `image`, `parent` (self-ref), `isActive` |
| **conversations** | `Conversation.js` | Chat threads | `participants[]` (User refs), `product` (ref), `lastMessage` (ref), `unreadCounts` |
| **messages** | `Message.js` | Chat messages | `conversation` (ref), `sender` (ref), `content`, `attachments[]`, `type`, `readBy[]{user, readAt}` |
| **favorites** | `Favorite.js` | Wishlists | `user` (ref), `product` (ref), unique compound index |
| **offers** | `Offer.js` | Price offers | `product` (ref), `buyer`/`seller` (refs), `amount`, `status` (pending/accepted/rejected/countered), `message` |
| **sales / orders** | `Sale.js` / `Order` | Transactions | `product`, `buyer`, `seller`, `amount`, `status`, Stripe `sessionId`/`paymentIntent` |
| **reviews** | `Review.js` | Ratings | `seller` (ref), `reviewer` (ref), `rating` (1–5), `comment`, `product` (ref) |
| **reports** | `Report.js` | Moderation | `reporter` (ref), `target` (Product/User), `reason`, `description`, `status` |
| **notifications** | `Notification.js` | In-app alerts | `user` (ref), `type`, `title`, `message`, `relatedId`, `isRead` |
| **auditlogs** | `AuditLog.js` | Admin audit trail | `user`, `action`, `target`, `metadata`, `timestamp` |

**Indexes:** text index on `Product.title/description/brand/model`; compound indexes on `status+createdAt`, `category+status`, `price`, `location.city`, `seller+status`, `aiAnalysis.riskAssessment.riskScore`; unique on `User.email`, `Favorite(user,product)`.

**Relationships:**

```text
User ──┬── Product (seller)
       ├── Conversation (participants)
       ├── Message (sender)
       ├── Favorite ── Product
       ├── Offer (buyer/seller) ── Product
       ├── Sale/Order (buyer/seller) ── Product
       ├── Review (reviewer → seller)
       ├── Report (reporter)
       └── Notification

Product ──┬── Category
          ├── User (seller)
          ├── Cloudinary images
          └── aiAnalysis (classification, hashes, price, risk)
```

---

## Future Enhancements

> Planned / proposed — not yet implemented.

- **Personalized recommendations** — collaborative filtering / embeddings for "Recommended for you".
- **Stronger fraud ML** — supervised classifier trained on labeled reports + image/text features.
- **Improved image CV** — fine-tuned detector (e.g. YOLO/DETR) for product type + defect segmentation.
- **Full-text search upgrade** — Atlas Search / Meilisearch with typo tolerance and faceting.
- **Order tracking & shipping** — carrier integration, tracking numbers, delivery ETA.
- **Push notifications** — Web Push / FCM for messages, offers, order updates.
- **Seller analytics** — views → favorites → offers → sales funnel, price history charts.
- **Wishlist sharing & social** — shareable collections, follow sellers.
- **Mobile app** — React Native / PWA with offline support.
- **CI/CD & observability** — GitHub Actions, Docker Compose prod, Sentry/metrics, automated E2E tests.
- **i18n & accessibility** — multi-language, ARIA, keyboard navigation audits.

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/your-feature`.
3. Make changes and add tests (`backend`: `npm test`, `frontend`: `npm test`).
4. Ensure lint/build pass: `cd frontend && npm run build`.
5. Commit with clear messages.
6. Push and open a Pull Request describing the change, testing, and screenshots if UI-related.

**Standards:**
- Keep PRs focused and small.
- Add/extend tests for new routes/services.
- Do not commit `.env` files or secrets.
- Follow existing code style (Express middleware pattern, Mongoose schemas, React hooks + Context).

---

## License

No license file is currently present in the repository (`LICENSE` not found; no `license` field in `backend/package.json` or `frontend/package.json`). All rights are reserved by default. If you are the owner, add a `LICENSE` file (e.g. MIT) and set the `license` field in `package.json` to make the project reusable.

---

## Contact & Support

No author/contact metadata is currently published in the repository (no `LICENSE` author, no `package.json` author field, no `CODEOWNERS`). Update this section with your details:

```text
Author: <your name>
GitHub: https://github.com/<username>
Repository: <repository-url>
Issues: <repository-url>/issues
```

For bugs or feature requests, please open an issue in the repository.

