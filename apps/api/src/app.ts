import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { AppConfig } from '@overflowgo/shared';
import { ApiError } from './errors';
import { createDriverRouter } from './routes/driver';
import { createReportsRouter } from './routes/reports';
import { createAiClient, type AiClient } from './services/ai';

export interface AppDependencies {
  config: AppConfig;
  /** Injectable for tests; production builds the HTTP client from env. */
  ai?: AiClient;
}

export function createApp({ config, ai }: AppDependencies): express.Express {
  const app = express();
  const aiClient = ai ?? createAiClient();

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

  app.use('/api', createReportsRouter({ config, ai: aiClient }));
  app.use('/api', createDriverRouter({ config, ai: aiClient }));

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;

    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: error.code ?? 'api_error',
        message: error.message,
      });
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: 'file_too_large',
          message: 'Photo must be 5 MB or smaller',
        });
        return;
      }
      res.status(400).json({
        error: 'upload_error',
        message: error.message,
      });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api] unhandled error:', error);
    res.status(500).json({
      error: 'internal_error',
      message: process.env.NODE_ENV === 'production' ? undefined : message,
    });
  });

  return app;
}
