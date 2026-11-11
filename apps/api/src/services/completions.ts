import type {
  AppConfig,
  CompleteTicketResponse,
  TicketStatus,
} from '@overflowgo/shared';
import { withTransaction, query } from '../db/pool';
import { ApiError } from '../errors';
import type { AiClient } from './ai';
import { driverCoversLocality } from './driver-route';
import { emitRouteChanged } from './route-events';
import {
  deleteCompletionPhoto,
  preparePhoto,
  saveCompletionPhoto,
} from './storage';

const REASON_NO_BIN =
  "We couldn't see a bin in this photo. Step back so the bin is visible and retake.";
const REASON_STILL_DIRTY =
  'Overflow or garbage is still visible. Please clean the spot and retake the photo.';

interface TicketRow {
  id: string;
  locality_id: string;
  status: TicketStatus;
  assigned_driver_id: string | null;
  distance_m: string;
}

export interface CompleteInput {
  driverId: string;
  ticketId: string;
  photo: Buffer;
  lat: number;
  lng: number;
}

export interface CompletionService {
  complete(input: CompleteInput): Promise<CompleteTicketResponse>;
}

export function createCompletionService({
  config,
  ai,
}: {
  config: AppConfig;
  ai: AiClient;
}): CompletionService {
  return {
    async complete({ driverId, ticketId, photo, lat, lng }) {
      const ticketResult = await query<TicketRow>(
        `SELECT id,
                locality_id,
                status,
                assigned_driver_id,
                ST_Distance(
                  location,
                  ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
                ) AS distance_m
           FROM tickets
          WHERE id = $1`,
        [ticketId, lng, lat],
      );
      const ticket = ticketResult.rows[0];
      if (!ticket) {
        throw new ApiError(404, 'Ticket not found', 'not_found');
      }
      if (ticket.status === 'completed') {
        throw new ApiError(409, 'This ticket is already completed', 'already_completed');
      }
      if (
        ticket.assigned_driver_id &&
        ticket.assigned_driver_id !== driverId
      ) {
        throw new ApiError(403, 'This ticket belongs to another driver', 'not_your_ticket');
      }
      if (
        !ticket.assigned_driver_id &&
        !(await driverCoversLocality(driverId, ticket.locality_id))
      ) {
        throw new ApiError(403, 'This ticket is not on your route', 'not_your_ticket');
      }

      if (Number(ticket.distance_m) > config.afterPhotoMaxDistanceMeters) {
        throw new ApiError(
          422,
          `Move within ${config.afterPhotoMaxDistanceMeters} m of the bin and retake the photo.`,
          'too_far',
        );
      }

      const prepared = await preparePhoto(photo);
      const prediction = await ai.predict(prepared.buffer, 'image/jpeg');
      const overflowConf = prediction.overflow_conf ?? 0;
      const garbageConf = prediction.garbage_conf ?? 0;
      const binConf = prediction.bin_conf ?? 0;

      const verified =
        binConf > 0 &&
        overflowConf < config.aiVerifyMaxOverflowConf &&
        garbageConf < config.aiVerifyMaxGarbageConf;

      const previous = await query<{ after_photo_path: string | null }>(
        'SELECT after_photo_path FROM completions WHERE ticket_id = $1',
        [ticketId],
      );
      const previousPath = previous.rows[0]?.after_photo_path ?? null;

      let afterPhotoPath: string | null = null;
      if (verified) {
        afterPhotoPath = await saveCompletionPhoto(prepared.buffer);
      }

      try {
        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO completions (
               ticket_id, driver_id, after_photo_path, location,
               ai_overflow_conf, ai_garbage_conf, ai_bin_conf, verified
             )
             VALUES (
               $1, $2, $3,
               ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
               $6, $7, $8, $9
             )
             ON CONFLICT (ticket_id) DO UPDATE
               SET driver_id = EXCLUDED.driver_id,
                   after_photo_path = EXCLUDED.after_photo_path,
                   location = EXCLUDED.location,
                   ai_overflow_conf = EXCLUDED.ai_overflow_conf,
                   ai_garbage_conf = EXCLUDED.ai_garbage_conf,
                   ai_bin_conf = EXCLUDED.ai_bin_conf,
                   verified = EXCLUDED.verified,
                   created_at = now()`,
            [
              ticketId,
              driverId,
              afterPhotoPath,
              lng,
              lat,
              overflowConf,
              garbageConf,
              binConf,
              verified,
            ],
          );

          if (verified) {
            await client.query(
              `UPDATE tickets
                  SET status = 'completed',
                      completed_at = now(),
                      assigned_driver_id = COALESCE(assigned_driver_id, $2)
                WHERE id = $1`,
              [ticketId, driverId],
            );
          }
        });
      } catch (error) {
        if (afterPhotoPath) {
          await deleteCompletionPhoto(afterPhotoPath).catch(() => undefined);
        }
        throw error;
      }

      if (previousPath && previousPath !== afterPhotoPath) {
        await deleteCompletionPhoto(previousPath).catch(() => undefined);
      }

      if (!verified) {
        return {
          verified: false,
          reason: binConf <= 0 ? REASON_NO_BIN : REASON_STILL_DIRTY,
          ticketStatus: ticket.status,
        };
      }

      emitRouteChanged(ticket.locality_id);
      return { verified: true, ticketStatus: 'completed' };
    },
  };
}
