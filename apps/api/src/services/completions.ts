import type {
  AppConfig,
  CompleteTicketResponse,
  TicketStatus,
} from '@overflowgo/shared';
import { withTransaction, query } from '../db/pool';
import { ApiError } from '../errors';
import type { AiClient } from './ai';
import { driverCoversLocality } from './driver-route';
import { emitDriverRouteChanged, emitRouteChanged } from './route-events';
import {
  deleteCompletionPhoto,
  preparePhoto,
  saveCompletionPhoto,
} from './storage';

const REASON_NO_BIN =
  "We couldn't clearly see a bin in this photo. Step back so the cleaned bin is visible and retake.";
const REASON_STILL_DIRTY =
  'Overflow or garbage is still visible. Please clean the spot and retake the photo.';
const REASON_REPORT_PHOTO =
  'This photo matches the citizen report photo. Take a new photo of the cleaned spot.';
const REASON_REUSED_PHOTO =
  'This photo was already used to complete another job. Take a new photo of this spot.';

type ReusedPhotoSource = 'report' | 'completion';

/**
 * Spot a photo that is being reused instead of a fresh after photo:
 * - the same image as the citizen's report for this ticket, or
 * - an after photo this driver already used on another verified job.
 * The comparison is a 64-bit difference hash, so a recompressed or resized copy
 * still matches while a genuinely different photo does not.
 */
async function findReusedPhoto(
  driverId: string,
  ticketId: string,
  photoHash: string,
  maxDistance: number,
  lookbackDays: number,
): Promise<ReusedPhotoSource | null> {
  const result = await query<{ source: ReusedPhotoSource }>(
    `SELECT source
       FROM (
         SELECT 'report'::text AS source, r.created_at
           FROM reports r
          WHERE r.ticket_id = $1
            AND r.result <> 'rejected'
            AND r.photo_hash IS NOT NULL
            AND length(r.photo_hash) = 16
            AND length($3) = 16
            AND bit_count(
                  ('x' || r.photo_hash)::bit(64) # ('x' || $3)::bit(64)
                ) <= $4
         UNION ALL
         SELECT 'completion'::text AS source, c.created_at
           FROM completions c
          WHERE c.driver_id = $2
            AND c.ticket_id <> $1
            AND c.verified = true
            AND c.photo_hash IS NOT NULL
            AND length(c.photo_hash) = 16
            AND length($3) = 16
            AND c.created_at > now() - ($5 * interval '1 day')
            AND bit_count(
                  ('x' || c.photo_hash)::bit(64) # ('x' || $3)::bit(64)
                ) <= $4
       ) AS matches
      ORDER BY created_at DESC
      LIMIT 1`,
    [ticketId, driverId, photoHash, maxDistance, lookbackDays],
  );
  return result.rows[0]?.source ?? null;
}

interface TicketRow {
  id: string;
  locality_id: string;
  status: TicketStatus;
  assigned_driver_id: string | null;
  reward_eligible: boolean;
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
                reward_eligible,
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

      const binVisible = binConf >= config.aiVerifyMinBinConf;
      const visuallyClean =
        overflowConf < config.aiVerifyMaxOverflowConf &&
        garbageConf < config.aiVerifyMaxGarbageConf;

      // Only spend the hash lookup when the photo could otherwise be verified.
      const reused =
        binVisible && visuallyClean
          ? await findReusedPhoto(
              driverId,
              ticketId,
              prepared.hash,
              config.afterPhotoReuseHashMaxDistance,
              config.afterPhotoReuseLookbackDays,
            )
          : null;

      const verified = binVisible && visuallyClean && reused === null;

      const previous = await query<{ after_photo_path: string | null }>(
        'SELECT after_photo_path FROM completions WHERE ticket_id = $1',
        [ticketId],
      );
      const previousPath = previous.rows[0]?.after_photo_path ?? null;

      let afterPhotoPath: string | null = null;
      if (verified) {
        afterPhotoPath = await saveCompletionPhoto(prepared.buffer);
      }

      let reward = 0;
      let rewardSkippedReason:
        | 'not_reward_eligible'
        | 'daily_cap'
        | 'route_stop'
        | undefined;

      try {
        const outcome = await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO completions (
               ticket_id, driver_id, after_photo_path, photo_hash, location,
               ai_overflow_conf, ai_garbage_conf, ai_bin_conf, verified
             )
             VALUES (
               $1, $2, $3, $10,
               ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
               $6, $7, $8, $9
             )
             ON CONFLICT (ticket_id) DO UPDATE
               SET driver_id = EXCLUDED.driver_id,
                   after_photo_path = EXCLUDED.after_photo_path,
                   photo_hash = EXCLUDED.photo_hash,
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
              prepared.hash,
            ],
          );

          if (!verified) {
            return { reward: 0, reason: undefined };
          }

          await client.query(
            `UPDATE tickets
                SET status = 'completed',
                    completed_at = now(),
                    assigned_driver_id = COALESCE(assigned_driver_id, $2)
              WHERE id = $1`,
            [ticketId, driverId],
          );

          const acceptedOffer = await client.query(
            `SELECT 1
               FROM offers
              WHERE ticket_id = $1 AND driver_id = $2 AND response = 'accepted'
              LIMIT 1`,
            [ticketId, driverId],
          );
          if ((acceptedOffer.rowCount ?? 0) === 0) {
            return { reward: 0, reason: 'route_stop' as const };
          }

          if (!ticket.reward_eligible) {
            return { reward: 0, reason: 'not_reward_eligible' as const };
          }

          const excluded = await client.query(
            `SELECT 1
               FROM ticket_reward_exclusions
              WHERE ticket_id = $1 AND driver_id = $2
              LIMIT 1`,
            [ticketId, driverId],
          );
          if ((excluded.rowCount ?? 0) > 0) {
            return { reward: 0, reason: 'not_reward_eligible' as const };
          }

          const spent = await client.query<{ total: string }>(
            `SELECT COALESCE(SUM(amount), 0)::text AS total
               FROM reward_ledger
              WHERE driver_id = $1
                AND created_at >= (date_trunc('day', now() AT TIME ZONE $2)) AT TIME ZONE $2`,
            [driverId, config.timezone],
          );
          const alreadyEarned = Number(spent.rows[0]?.total ?? 0);
          if (
            alreadyEarned + config.rewardPerExtraJob >
            config.rewardDailyCapPerDriver
          ) {
            return { reward: 0, reason: 'daily_cap' as const };
          }

          const credited = await client.query<{ amount: string }>(
            `INSERT INTO reward_ledger (driver_id, ticket_id, amount)
             VALUES ($1, $2, $3)
             ON CONFLICT (ticket_id) DO NOTHING
             RETURNING amount::text AS amount`,
            [driverId, ticketId, config.rewardPerExtraJob],
          );
          return {
            reward: Number(credited.rows[0]?.amount ?? 0),
            reason: undefined,
          };
        });

        reward = outcome.reward;
        rewardSkippedReason = outcome.reason;
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
        const reason = !binVisible
          ? REASON_NO_BIN
          : !visuallyClean
            ? REASON_STILL_DIRTY
            : reused === 'report'
              ? REASON_REPORT_PHOTO
              : REASON_REUSED_PHOTO;
        return {
          verified: false,
          reason,
          ticketStatus: ticket.status,
        };
      }

      emitRouteChanged(ticket.locality_id);
      // Also refresh the completing driver directly; they may be the only one
      // affected and must not keep seeing the finished ticket.
      emitDriverRouteChanged(driverId);
      return {
        verified: true,
        ticketStatus: 'completed',
        reward,
        ...(rewardSkippedReason ? { rewardSkippedReason } : {}),
      };
    },
  };
}
