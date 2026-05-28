import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRouter from './routes/auth';
import donorsRouter from './routes/donors';
import bloodbanksRouter from './routes/bloodbanks';
import emergenciesRouter from './routes/emergencies';
import aiRouter from './routes/ai';
import donationsRouter from './routes/donations';
import campsRouter from './routes/camps';
import statsRouter from './routes/stats';
import { initWebSocket } from './services/websocket';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Trust the Render reverse proxy to fix rate limit IP issues
app.set('trust proxy', 1);

// Middleware configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173', // Must match frontend origin precisely for cookies
  credentials: true, // Required for HttpOnly cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));
app.use(cookieParser());
app.use(express.json());

// Register API routes
app.use('/auth', authRouter);
app.use(donorsRouter);
app.use(bloodbanksRouter);
app.use(emergenciesRouter);
app.use(aiRouter);
app.use(donationsRouter);
app.use(campsRouter);
app.use(statsRouter);

// Base Health Check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'Unified LiForce Backend' 
  });
});

// Setup unified HTTP and WebSockets Server
const httpServer = createServer(app);
initWebSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`🚀 Unified LiForce Backend listening on port ${PORT}`);
  console.log(`📡 WebSocket server initialized and integrated.`);
});
