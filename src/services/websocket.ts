import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

let io: Server | null = null;

export const initWebSocket = (server: HttpServer): Server => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Authentication Middleware: Extends handshake context
  io.use((socket: Socket, next) => {
    const userId = socket.handshake.query.userId as string;
    if (userId) {
      socket.data.userId = userId;
      next();
    } else {
      console.warn('🔌 Connection rejected: No userId provided in handshake query');
      next(new Error('Authentication error: Missing userId'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId;
    console.log(`🔌 WebSocket Connected: Client ${socket.id} (User ID: ${userId})`);

    // Join a private targeted room
    socket.join(`user_${userId}`);

    // Join general emergency broadcast channel
    socket.join('emergency_alerts');

    socket.on('disconnect', () => {
      console.log(`🔌 WebSocket Disconnected: Client ${socket.id}`);
    });
  });

  return io;
};

export const getWebSocketIO = (): Server => {
  if (!io) {
    throw new Error('❌ WebSocket Server has not been initialized yet!');
  }
  return io;
};

/**
 * Sends a real-time SOS notification to a list of matched donors.
 * Falls back to broadcasting to all connected users if the matched array is empty.
 */
export const notifyMatchedDonors = (matchedDonors: any[], emergencyData: any) => {
  try {
    const socketServer = getWebSocketIO();
    if (matchedDonors && matchedDonors.length > 0) {
      matchedDonors.forEach((donor) => {
        socketServer.to(`user_${donor.id}`).emit('emergency_sos', emergencyData);
      });
      console.log(`📢 Real-time alert dispatched to ${matchedDonors.length} matched donors via WebSockets.`);
    } else {
      const globalRoom = socketServer.to('emergency_alerts');
      if (emergencyData.requesterId) {
        globalRoom.except(`user_${emergencyData.requesterId}`).emit('emergency_sos', emergencyData);
      } else {
        globalRoom.emit('emergency_sos', emergencyData);
      }
      console.log('📢 General SOS broadcast emitted to all connected clients.');
    }
  } catch (error) {
    console.error('⚠️ Failed to dispatch real-time WebSocket SOS alert:', error);
  }
};

/**
 * Sends a real-time event when someone responds to an emergency request.
 */
export const notifyEmergencyResponse = (requesterId: string, responseData: any) => {
  try {
    const socketServer = getWebSocketIO();
    socketServer.to(`user_${requesterId}`).emit('emergency_response_received', responseData);
    console.log(`📢 Real-time emergency response dispatched to requester user_${requesterId}.`);
  } catch (error) {
    console.error('⚠️ Failed to dispatch real-time WebSocket response alert:', error);
  }
};

