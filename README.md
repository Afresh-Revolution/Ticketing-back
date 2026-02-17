# Gatewave Backend

Express + Prisma + PostgreSQL (Supabase) backend with modular structure.

## Folder structure

```
src/
├── modules/
│   ├── auth/                 # Signup / Signin
│   │   ├── auth.controller.js
│   │   ├── auth.service.js
│   │   ├── auth.routes.js
│   │   └── auth.model.js
│   │
│   ├── landing/               # Landing page
│   │   ├── hero/
│   │   ├── everyone/
│   │   ├── whyChooseUs/
│   │   ├── trending/
│   │   ├── join/
│   │   ├── footer/
│   │   └── landing.routes.js
│   │
│   ├── community/            # Event ticket community
│   │   ├── gatewave/
│   │   ├── categories/
│   │   ├── upcomingEvents/
│   │   ├── footer/
│   │   └── community.routes.js
│   │
│   ├── booking/              # Before & after booking
│   │   ├── beforeBooking/
│   │   │   ├── image/
│   │   │   ├── art/
│   │   │   └── ticketSelection/
│   │   ├── afterBooking/
│   │   │   ├── bookedPay/
│   │   │   └── payed/
│   │   └── booking.routes.js
│   │
│   ├── user/                 # User site
│   │   ├── userPage/
│   │   ├── footer/
│   │   └── user.routes.js
│   │
│   └── event/                # Core event system
│       ├── event.controller.js
│       ├── event.routes.js
│       └── event.model.js
│
├── shared/
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   └── errorHandler.js
│   ├── utils/
│   │   └── generateTicket.js
│   └── config/
│       ├── db.js
│       └── env.js
│
├── app.js
└── server.js

prisma/
├── schema.prisma
└── migrations/
```

## Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `DIRECT_URL`, and `JWT_SECRET`.
2. Install dependencies: `npm install`
3. Generate Prisma client: `npm run db:generate`
4. Run migrations: `npm run db:migrate`

## Scripts

- `npm run dev` – start with watch mode
- `npm start` – start server
- `npm run db:generate` – generate Prisma client
- `npm run db:migrate` – run migrations
- `npm run db:studio` – open Prisma Studio

## API base

- Base URL: `http://localhost:3000/api`
- Health: `GET /health`
- Auth: `POST /api/auth/signup`, `POST /api/auth/signin`
- Events: `GET/POST /api/events`, `GET/PATCH/DELETE /api/events/:id`
- Booking: `POST /api/booking/tickets`, `GET /api/booking/before/ticketSelection?eventId=...`
- User (auth required): `GET /api/user/profile`, `GET /api/user/tickets`
