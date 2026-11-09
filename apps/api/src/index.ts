import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { loadConfig } from './config';
import { createApp } from './app';
import { attachSocket } from './socket';

const config = loadConfig();
const port = Number(process.env.PORT ?? 4000);

const app = createApp({ config });
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: config.corsOrigins,
    credentials: true,
  },
});

attachSocket(io);

httpServer.listen(port, () => {
  console.log(`[api] OverflowGo API listening on http://localhost:${port}`);
  console.log(`[api] Health check: http://localhost:${port}/api/health`);
});

function shutdown(signal: string): void {
  console.log(`[api] ${signal} received, shutting down`);
  io.close();
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
