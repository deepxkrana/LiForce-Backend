# LiForce Backend

Express + Prisma API and WebSocket server for the LiForce platform.

The frontend is a separate repository: **LiForce2** (sibling folder `LiForce2`).

## Prerequisites

- Node.js 18+
- PostgreSQL 15+ with a database named `liforce`

## Setup

```bash
npm install
cp .env.example .env
# Edit DATABASE_URL and JWT_SECRET in .env

npm run prisma:push
npm run prisma:seed
npm run dev
```

The server listens on `PORT` (default `4000`). Health check: `GET /health`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with nodemon |
| `npm run build` | Compile TypeScript and generate Prisma client |
| `npm start` | Run compiled `dist/index.js` |
| `npm run prisma:push` | Push schema to database |
| `npm run prisma:seed` | Seed sample data |

## Environment

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing auth tokens |
| `PORT` | HTTP port (default `4000`) |
