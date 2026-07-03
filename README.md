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

## 🌍 Deployment (Koyeb + Supabase)

Render's free tier has strict limits and blocks ports. For a completely free and robust production environment, deploy the Database to Supabase and the API to Koyeb.

### 1. Database (Supabase)
1. Go to [Supabase.com](https://supabase.com) and create a free project.
2. Go to Project Settings -> Database.
3. Copy the **Transaction** connection string. This is your `DATABASE_URL`.
4. Copy the **Session** connection string. This is your `DIRECT_URL`.

### 2. Backend API (Koyeb)
1. Go to [Koyeb.com](https://www.koyeb.com) and create a free account.
2. Click **Deploy App** and select GitHub. Connect this `LiForce2-backend` repository.
3. In the builder settings, set the **Build Command**:
   ```bash
   npm install && npx prisma generate && npx prisma db push && npm run build
   ```
4. Set the **Run Command**: `npm start`
5. Under Environment Variables, add:
   - `DATABASE_URL` (Supabase Transaction string)
   - `DIRECT_URL` (Supabase Session string)
   - `JWT_SECRET` (e.g., your secret password)
   - `GEMINI_API_KEY` (Your Google AI key)
   - `FRONTEND_URL` (Your live Vercel URL, e.g. `https://liforcebloodbank.vercel.app`)
6. Choose the **Free Eco** instance and click Deploy!
