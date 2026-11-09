import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '@overflowgo/shared';
import { ApiError } from '../errors';
import { uploadPhoto } from '../middleware/upload';
import type { AiClient } from '../services/ai';
import { createReportService } from '../services/reports';
import { isValidPhotoFilename, reportPhotoPath } from '../services/storage';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ReportBodySchema = z.object({
  lat: z.coerce.number().gte(-90).lte(90),
  lng: z.coerce.number().gte(-180).lte(180),
  deviceId: z.string().trim().min(1).max(128),
  note: z.string().trim().max(500).optional(),
  clientReportId: z.string().trim().min(1).max(128).optional(),
  clientCapturedAt: z.string().max(64).optional(),
});

export interface ReportsRouterDependencies {
  config: AppConfig;
  ai: AiClient;
}

function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}

export function createReportsRouter({
  config,
  ai,
}: ReportsRouterDependencies): Router {
  const service = createReportService({ config, ai });
  const router = Router();

  router.post('/reports', uploadPhoto, async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw new ApiError(400, 'A photo is required', 'missing_photo');
      }

      const parsed = ReportBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, validationMessage(parsed.error), 'validation_error');
      }

      const note = parsed.data.note?.trim();
      const result = await service.submit({
        photo: file.buffer,
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        note: note ? note : null,
        deviceId: parsed.data.deviceId,
        clientReportId: parsed.data.clientReportId ?? null,
      });

      res.status(result.status === 'rejected' ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/reports/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_PATTERN.test(id)) {
        throw new ApiError(404, 'Report not found', 'not_found');
      }

      const status = await service.getStatus(id);
      if (!status) {
        throw new ApiError(404, 'Report not found', 'not_found');
      }
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  router.get('/photos/:filename', (req, res, next) => {
    const { filename } = req.params;
    if (!isValidPhotoFilename(filename)) {
      next(new ApiError(404, 'Photo not found', 'not_found'));
      return;
    }

    let absolutePath: string;
    try {
      absolutePath = reportPhotoPath(filename);
    } catch {
      next(new ApiError(404, 'Photo not found', 'not_found'));
      return;
    }

    res.sendFile(
      absolutePath,
      {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Type': 'image/jpeg',
        },
      },
      (error) => {
        if (!error || res.headersSent) return;
        next(new ApiError(404, 'Photo not found', 'not_found'));
      },
    );
  });

  return router;
}
