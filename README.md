# ReSell

AI-powered peer-to-peer marketplace for buying and selling second-hand items. Features real-time chat, fraud detection, seller trust scoring, and multi-currency support.

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, Vite, Tailwind CSS, Framer Motion |
| **Backend** | Node.js, Express, MongoDB, Mongoose |
| **Real-time** | Socket.io |
| **Queue** | BullMQ, Redis |
| **Image Processing** | Sharp, Cloudinary |
| **Testing** | Jest, Supertest |
| **Deployment** | Docker, Docker Compose, Nginx |

## Getting Started

### Local Development

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start backend (port 5000)
cd backend && npm run dev

# Start frontend (port 5173)
cd frontend && npm run dev

# Start background workers (each in a separate terminal)
cd backend && npm run worker        # image processing
cd backend && npm run worker:price  # price re-analysis
```

**Note:** The `worker` and `worker:price` processes must be running for image processing and price recommendation to work. Without them, products can be created but images won't be uploaded to Cloudinary and prices won't be refined.

### Docker Deployment

```bash
cp .env.docker.example .env.docker
docker-compose --env-file .env.docker up -d
```

- Frontend: http://localhost
- Backend API: http://localhost:5000
- Health check: http://localhost:5000/health

## Environment Variables

Copy `.env.docker.example` to `.env.docker` and fill in:

| Variable | Description |
|---|---|
| `JWT_SECRET` | JWT signing secret |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `ADMIN_EMAIL` | Admin account email |
| `ADMIN_PASSWORD` | Admin account password |

## Features

- JWT authentication with role-based access (user, seller, admin)
- Product CRUD with image upload (up to 8 images)
- AI-powered item analysis (condition scoring, damage detection)
- Fraud detection (duplicate images, suspicious pricing)
- Seller trust scoring
- Real-time chat via Socket.io
- Multi-currency support with geolocation detection
- Admin dashboard (user/product/report management, analytics)
- Background image processing via BullMQ workers
- Premium UX (custom cursor, particle effects, 3D cards, scroll animations)

## Testing

```bash
cd backend && npm test
```

## Project Structure

```
Resell/
├── backend/          # Express API server
│   └── src/
│       ├── controllers/   (9 controllers)
│       ├── models/        (10 Mongoose schemas)
│       ├── routes/        (9 route modules)
│       ├── services/      (7 AI/ML services)
│       ├── middleware/     (auth, upload, validate)
│       ├── workers/       (image processing)
│       └── __tests__/     (4 test files)
├── frontend/         # React SPA
│   └── src/
│       ├── components/    (27 components)
│       ├── pages/         (19 pages)
│       ├── contexts/      (Auth, Socket, Currency)
│       ├── services/      (API layer)
│       └── utils/         (currency, formatting)
├── docker-compose.yml
└── .env.docker.example
```
