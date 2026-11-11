import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { loadConfig } from './config';
import { createApp } from './app';
import type { DispatchService } from './services/dispatch';
import { isPushEnabled } from './services/push';
import { createRetentionService } from './services/retention';
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

attachSocket(io, { config });

const dispatch = app.locals.dispatch as DispatchService;
const dispatchTimer = setInterval(() => {
  dispatch.tick().catch((error: unknown) => {
    console.error('[dispatch] tick failed:', error);
  });
}, 5_000);
dispatchTimer.unref();

const retention = createRetentionService({ config });
async function runRetention(): Promise<void> {
  try {
    const result = await retention.run();
    if (
      result.reportPhotos ||
      result.completionPhotos ||
      result.trainingSamples
    ) {
      console.log(
        `[retention] deleted ${result.reportPhotos} report photo(s), ` +
          `${result.completionPhotos} completion photo(s), ` +
          `${result.trainingSamples} training sample(s)`,
      );
    }
  } catch (error) {
    console.error('[retention] run failed:', error);
  }
}

const retentionStartup = setTimeout(() => void runRetention(), 10_000);
retentionStartup.unref();
const retentionTimer = setInterval(
  () => void runRetention(),
  6 * 60 * 60 * 1000,
);
retentionTimer.unref();

console.log(
  `[push] Web Push ${isPushEnabled() ? 'enabled' : 'disabled (set VAPID keys to enable)'}`,
);

httpServer.listen(port, () => {
  console.log(`[api] OverflowGo API listening on http://localhost:${port}`);
  console.log(`[api] Health check: http://localhost:${port}/api/health`);
});

function shutdown(signal: string): void {
  console.log(`[api] ${signal} received, shutting down`);
  clearInterval(dispatchTimer);
  clearInterval(retentionTimer);
  clearTimeout(retentionStartup);
  io.close();
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
