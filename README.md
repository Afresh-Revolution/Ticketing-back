# Gatewave Backend

Express + PostgreSQL (pg driver) backend with raw SQL schema and modular structure.

## Folder structure

```
src/
├── modules/
│   ├── auth/                 # Signup / Signin
│   ├── landing/              # Landing page (hero, trending, etc.)
│   ├── community/            # Event ticket community
│   ├── booking/              # Before & after booking
│   ├── user/                 # User site
│   └── event/                # Core event system
├── shared/
│   ├── middleware/
│   ├── utils/
│   └── config/               # db.js (pg pool), env.js
├── app.js
└── server.js

db/
├── schema.sql                # PostgreSQL DDL (tables, indexes, triggers)
├── run-schema.js             # Apply schema via Node (npm run db:schema)
└── seed.js                   # Seed default hero section (npm run db:seed)
```

## Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
2. Install dependencies: `npm install`
3. Apply the database schema: `npm run db:schema`
4. (Optional) Seed default data: `npm run db:seed`
5. Start the server: `npm run dev` or `npm start`

## Scripts

- `npm run dev` – start with watch mode
- `npm start` – start server
- `npm run db:schema` – create/update tables from `db/schema.sql` (uses `DATABASE_URL`)
- `npm run db:seed` – seed default hero section if none exists

## API base

- Base URL: `http://localhost:3000/api`
- Health: `GET /health`
- Auth: `POST /api/auth/signup`, `POST /api/auth/signin`
- Events: `GET/POST /api/events`, `GET/PATCH/DELETE /api/events/:id`
- Booking: `POST /api/booking/tickets`, `GET /api/booking/before/ticketSelection?eventId=...`
- User (auth required): `GET /api/user/profile`, `GET /api/user/tickets`
