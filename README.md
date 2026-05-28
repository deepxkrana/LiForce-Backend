# 🩸 LiForce Backend API

> **"Every drop counts."**

This is the central API, database interface, and WebSocket server for the LiForce blood donation platform. 

The frontend client is located in a separate repository: **LiForce2** (sibling folder `LiForce2`).

## ✨ Key Capabilities

- **PostgreSQL Database:** Powered by Prisma ORM for robust and type-safe database queries.
- **Geospatial Matching:** Calculates Haversine distances to match emergency SOS requests with nearby donors and blood banks.
- **Secure Authentication:** Utilizes HTTP-Only cookies and JWT for robust user and blood bank authentication.
- **Smart AI Integration:** Connects directly with the **Gemini 2.5 Flash API** to power the empathetic platform assistant.
- **Real-Time WebSockets:** (Configured) Ready to handle real-time notifications for live SOS broadcasts.

## 🛠️ Tech Stack

- Node.js & Express.js
- Prisma ORM & PostgreSQL
- JSON Web Tokens (JWT) & bcryptjs
- Gemini API (via `@google/genai` or native fetch)

## 🚀 Prerequisites

Before you begin, ensure you have:
- Node.js (v18 or higher)
- PostgreSQL (v15 or higher) running locally or hosted (e.g., Render/Supabase)

## 💻 Local Setup

1. **Clone the repository:**
   ```bash
   git clone <your-backend-repo-url>
   cd LiForce2-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and configure your `DATABASE_URL`, `JWT_SECRET`, and `GEMINI_API_KEY`.

4. **Initialize Database:**
   Push the schema to your database and optionally seed it with mock data:
   ```bash
   npm run prisma:push
   npm run prisma:seed
   ```

5. **Start the Server:**
   ```bash
   npm run dev
   ```
   The API will listen on `PORT` (default `4000`). Test it via `GET http://localhost:4000/health`.

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with nodemon |
| `npm run build` | Compile TypeScript and generate Prisma client |
| `npm start` | Run compiled `dist/index.js` in production |
| `npm run prisma:push` | Push schema changes to the database |
| `npm run prisma:seed` | Seed the database with mock donors, banks, and camps |

## 🌍 Deployment (Render)

1. Create a **Web Service** on Render and link this repository.
2. Under Environment, select `Node`.
3. Set the Build Command:
   ```bash
   npm install && npx prisma generate && npx prisma db push && npm run build
   ```
4. Set the Start Command: `npm start`
5. Set your Environment Variables: `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, and importantly, `FRONTEND_URL` (pointing to your Vercel URL to allow secure CORS).
