import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '@overflowgo/shared';
import { ApiError } from '../errors';
import { currentDriverId, requireDriver } from '../middleware/driver-auth';
import { uploadPhoto } from '../middleware/upload';
import type { AiClient } from '../services/ai';
import { createCompletionService } from '../services/completions';
import type { DispatchService } from '../services/dispatch';
import { computeDriverRoute } from '../services/driver-route';
import { createDriverService } from '../services/drivers';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LoginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
  deviceId: z.string().trim().min(1).max(128),
});

const OnlineSchema = z
  .object({
    online: z.boolean(),
    lat: z.coerce.number().gte(-90).lte(90).optional(),
    lng: z.coerce.number().gte(-180).lte(180).optional(),
  })
  .refine(
    (value) =>
      !value.online ||
      (value.lat !== undefined && value.lng !== undefined),
    { message: 'lat and lng are required when going online', path: ['lat'] },
  );

const LocationSchema = z.object({
  lat: z.coerce.number().gte(-90).lte(90),
  lng: z.coerce.number().gte(-180).lte(180),
});

const CompleteBodySchema = z.object({
  lat: z.coerce.number().gte(-90).lte(90),
  lng: z.coerce.number().gte(-180).lte(180),
});

const RespondSchema = z.object({
  response: z.enum(['accept', 'reject']),
});

function validationMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}

export interface DriverRouterDependencies {
  config: AppConfig;
  ai: AiClient;
  dispatch: DispatchService;
}

export function createDriverRouter({
  config,
  ai,
  dispatch,
}: DriverRouterDependencies): Router {
  const drivers = createDriverService({ config, dispatch });
  const completions = createCompletionService({ config, ai });
  const router = Router();

  router.post('/driver/login', async (req, res, next) => {
    try {
      const parsed = LoginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, validationMessage(parsed.error), 'validation_error');
      }
      const result = await drivers.login(
        parsed.data.email,
        parsed.data.password,
        parsed.data.deviceId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/driver/me', requireDriver, async (req, res, next) => {
    try {
      const driver = await drivers.getProfile(currentDriverId(req));
      if (!driver) {
        throw new ApiError(404, 'Driver not found', 'not_found');
      }
      res.json({ driver, heartbeatSeconds: config.driverHeartbeatSeconds });
    } catch (error) {
      next(error);
    }
  });

  router.post('/driver/online', requireDriver, async (req, res, next) => {
    try {
      const parsed = OnlineSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, validationMessage(parsed.error), 'validation_error');
      }
      const driver = await drivers.setOnline(
        currentDriverId(req),
        parsed.data.online,
        parsed.data.lat !== undefined && parsed.data.lng !== undefined
          ? { lat: parsed.data.lat, lng: parsed.data.lng }
          : undefined,
      );
      res.json({ driver });
    } catch (error) {
      next(error);
    }
  });

  router.post('/driver/location', requireDriver, async (req, res, next) => {
    try {
      const parsed = LocationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, validationMessage(parsed.error), 'validation_error');
      }
      const found = await drivers.heartbeat(
        currentDriverId(req),
        parsed.data.lat,
        parsed.data.lng,
      );
      if (!found) {
        throw new ApiError(404, 'Driver not found', 'not_found');
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/driver/route', requireDriver, async (req, res, next) => {
    try {
      res.json(await computeDriverRoute(currentDriverId(req), config));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/driver/offers/:offerId/respond',
    requireDriver,
    async (req, res, next) => {
      try {
        const { offerId } = req.params;
        if (!offerId || !UUID_PATTERN.test(offerId)) {
          throw new ApiError(404, 'Offer not found', 'offer_not_found');
        }
        const parsed = RespondSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ApiError(400, validationMessage(parsed.error), 'validation_error');
        }
        const result = await dispatch.respond(
          currentDriverId(req),
          offerId,
          parsed.data.response,
        );
        if (!result.assigned && result.reason !== 'rejected') {
          res.status(409).json(result);
          return;
        }
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post('/driver/van-full', requireDriver, async (req, res, next) => {
    try {
      const driver = await drivers.setVanFull(currentDriverId(req), true);
      res.json({ driver });
    } catch (error) {
      next(error);
    }
  });

  router.post('/driver/van-emptied', requireDriver, async (req, res, next) => {
    try {
      const driver = await drivers.setVanFull(currentDriverId(req), false);
      res.json({ driver });
    } catch (error) {
      next(error);
    }
  });

  router.get('/driver/wallet', requireDriver, async (req, res, next) => {
    try {
      res.json(await drivers.wallet(currentDriverId(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/driver/tickets/:ticketId/complete',
    requireDriver,
    uploadPhoto,
    async (req, res, next) => {
      try {
        const { ticketId } = req.params;
        if (!ticketId || !UUID_PATTERN.test(ticketId)) {
          throw new ApiError(404, 'Ticket not found', 'not_found');
        }
        if (!req.file) {
          throw new ApiError(400, 'An after photo is required', 'missing_photo');
        }
        const parsed = CompleteBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ApiError(400, validationMessage(parsed.error), 'validation_error');
        }

        const result = await completions.complete({
          driverId: currentDriverId(req),
          ticketId,
          photo: req.file.buffer,
          lat: parsed.data.lat,
          lng: parsed.data.lng,
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
