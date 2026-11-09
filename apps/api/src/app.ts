import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AppConfig } from '@overflowgo/shared';

export interface AppDependencies {
  config: AppConfig;
}

export function createApp({ config }: AppDependencies): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'overflowgo-api',
      version: '0.1.0',
      time: new Date().toISOString(),
    });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Avoid leaking internals in production; log for now.
    console.error('[api] unhandled error:', error);
    res.status(500).json({
      error: 'internal_error',
      message: process.env.NODE_ENV === 'production' ? undefined : message,
    });
  });

  return app;
}
