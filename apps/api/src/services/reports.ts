import type { PoolClient } from 'pg';
import type {
  AiPrediction,
  AiTrigger,
  AppConfig,
  ReportResponse,
  ReportResult,
  ReportStatusResponse,
  TicketStatus,
} from '@overflowgo/shared';
import { query, withTransaction } from '../db/pool';
import { ApiError } from '../errors';
import type { AiClient } from './ai';
import { emitRouteChanged } from './route-events';
import { deleteReportPhoto, preparePhoto, saveReportPhoto } from './storage';

export const REJECT_NO_GARBAGE =
  "We couldn't find an overflowing bin or garbage in this photo. Please retake it.";
export const REJECT_NOTHING_VISIBLE =
  "We couldn't see a bin or garbage in this photo. Please move closer and retake.";

const MESSAGE_ACCEPTED = 'Report received. A driver will be assigned.';
const MESSAGE_MERGED =
  'Another report for this bin already exists. We added yours to it.';
const MESSAGE_DUPLICATE_PHOTO =
  'This photo was already submitted recently. It is attached to the existing report.';

interface ExistingReportRow {
  id: string;
  result: ReportResult;
  ticket_id: string | null;
  reject_reason: string | null;
}

export interface SubmitReportInput {
  photo: Buffer;
  lat: number;
  lng: number;
  note?: string | null;
  deviceId: string;
  clientReportId?: string | null;
}

export interface ReportService {
  submit(input: SubmitReportInput): Promise<ReportResponse>;
  getStatus(reportId: string): Promise<ReportStatusResponse | null>;
}

export interface ReportServiceDependencies {
  config: AppConfig;
  ai: AiClient;
  dispatch?: {
    dispatchTicket(ticketId: string): Promise<void>;
  };
}

interface InsertReportInput {
  ticketId: string | null;
  photoPath: string | null;
  note: string | null;
  lat: number;
  lng: number;
  deviceId: string;
  prediction: AiPrediction;
  trigger: AiTrigger | null;
  result: ReportResult;
  rejectReason: string | null;
  clientReportId: string | null;
  photoHash: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

function mapExistingReport(row: ExistingReportRow): ReportResponse {
  if (row.result === 'rejected') {
    return {
      status: 'rejected',
      reportId: row.id,
      reason: row.reject_reason ?? REJECT_NO_GARBAGE,
    };
  }
  if (!row.ticket_id) {
    throw new Error(`Report ${row.id} is ${row.result} but has no ticket`);
  }
  const merged = row.result === 'merged';
  return {
    status: merged ? 'merged' : 'accepted',
    reportId: row.id,
    ticketId: row.ticket_id,
    merged,
    message: merged ? MESSAGE_MERGED : MESSAGE_ACCEPTED,
  };
}

async function findByClientReportId(
  clientReportId: string,
): Promise<ExistingReportRow | null> {
  const result = await query<ExistingReportRow>(
    `SELECT id, result, ticket_id, reject_reason
       FROM reports
      WHERE client_report_id = $1
      LIMIT 1`,
    [clientReportId],
  );
  return result.rows[0] ?? null;
}

async function findDuplicatePhoto(
  photoHash: string,
): Promise<{ ticket_id: string; locality_id: string } | null> {
  const result = await query<{ ticket_id: string; locality_id: string }>(
    `SELECT r.ticket_id, t.locality_id
       FROM reports r
       JOIN tickets t ON t.id = r.ticket_id
      WHERE r.photo_hash = $1
        AND r.result <> 'rejected'
        AND r.ticket_id IS NOT NULL
        AND r.created_at > now() - interval '24 hours'
      ORDER BY r.created_at DESC
      LIMIT 1`,
    [photoHash],
  );
  return result.rows[0] ?? null;
}

async function nearestLocalityId(
  client: PoolClient,
  lat: number,
  lng: number,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM localities
      ORDER BY ST_Distance(
                 center,
                 ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
               ) ASC
      LIMIT 1`,
    [lng, lat],
  );
  return result.rows[0]?.id ?? null;
}

async function findMergeTarget(
  client: PoolClient,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<{ id: string; locality_id: string } | null> {
  const result = await client.query<{ id: string; locality_id: string }>(
    `SELECT id, locality_id
       FROM tickets
      WHERE status IN ('open', 'offered')
        AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              $3
            )
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE`,
    [lng, lat, radiusMeters],
  );
  return result.rows[0] ?? null;
}

async function findDriverForDevice(
  client: PoolClient,
  deviceId: string,
): Promise<string | null> {
  const result = await client.query<{ driver_id: string }>(
    `SELECT driver_id
       FROM driver_devices
      WHERE device_id = $1
      LIMIT 1`,
    [deviceId],
  );
  return result.rows[0]?.driver_id ?? null;
}

async function findNearbyDrivers(
  client: PoolClient,
  lat: number,
  lng: number,
  staleAfterSeconds: number,
  radiusMeters: number,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM drivers
      WHERE is_online = true
        AND van_full = false
        AND last_ping_at > now() - make_interval(secs => $3)
        AND ST_DWithin(
              last_location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
              $4
            )`,
    [lng, lat, staleAfterSeconds, radiusMeters],
  );
  return result.rows.map((row) => row.id);
}

async function createTicket(
  client: PoolClient,
  input: {
    localityId: string;
    lat: number;
    lng: number;
    rewardEligible: boolean;
    flagReason: string | null;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tickets (
       locality_id, location, status, report_count, first_reported_at,
       reward_eligible, flag_reason
     )
     VALUES (
       $1,
       ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
       'open',
       1,
       now(),
       $4,
       $5
     )
     RETURNING id`,
    [input.localityId, input.lng, input.lat, input.rewardEligible, input.flagReason],
  );
  return result.rows[0]!.id;
}

async function insertReport(
  client: PoolClient,
  input: InsertReportInput,
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO reports (
       ticket_id, photo_path, note, location, device_id,
       ai_overflow_conf, ai_garbage_conf, ai_bin_conf, ai_trigger,
       result, reject_reason, client_report_id, photo_hash
     )
     VALUES (
       $1, $2, $3,
       ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
       $6, $7, $8, $9, $10, $11, $12, $13, $14
     )
     RETURNING id`,
    [
      input.ticketId,
      input.photoPath,
      input.note,
      input.lng,
      input.lat,
      input.deviceId,
      input.prediction.overflow_conf,
      input.prediction.garbage_conf,
      input.prediction.bin_conf,
      input.trigger,
      input.result,
      input.rejectReason,
      input.clientReportId,
      input.photoHash,
    ],
  );
  return result.rows[0]!;
}

async function insertReportSafely(
  input: InsertReportInput,
): Promise<ExistingReportRow | { id: string }> {
  const inserted = await withTransaction((client) => insertReport(client, input));
  return inserted;
}

async function existingAfterCollision(
  clientReportId: string | null,
): Promise<ExistingReportRow | null> {
  if (!clientReportId) return null;
  return findByClientReportId(clientReportId);
}

export function createReportService({
  config,
  ai,
  dispatch,
}: ReportServiceDependencies): ReportService {
  return {
    async submit(input) {
      if (input.clientReportId) {
        const existing = await findByClientReportId(input.clientReportId);
        if (existing) return mapExistingReport(existing);
      }

      const prepared = await preparePhoto(input.photo);
      const prediction = await ai.predict(prepared.buffer, 'image/jpeg');

      const overflowConf = prediction.overflow_conf ?? 0;
      const garbageConf = prediction.garbage_conf ?? 0;
      const binConf = prediction.bin_conf ?? 0;

      const overflowHit = overflowConf >= config.aiOverflowThreshold;
      const garbageHit = garbageConf >= config.aiGarbageThreshold;
      const binHit = binConf >= config.aiBinThreshold;

      if (!overflowHit && !garbageHit && !binHit) {
        const nothingVisible =
          overflowConf === 0 && garbageConf === 0 && binConf === 0;
        const reason = nothingVisible ? REJECT_NOTHING_VISIBLE : REJECT_NO_GARBAGE;

        try {
          const inserted = await insertReportSafely({
            ticketId: null,
            photoPath: null,
            note: input.note ?? null,
            lat: input.lat,
            lng: input.lng,
            deviceId: input.deviceId,
            prediction,
            trigger: null,
            result: 'rejected',
            rejectReason: reason,
            clientReportId: input.clientReportId ?? null,
            photoHash: prepared.hash,
          });
          return { status: 'rejected', reportId: inserted.id, reason };
        } catch (error) {
          if (isUniqueViolation(error)) {
            const existing = await existingAfterCollision(
              input.clientReportId ?? null,
            );
            if (existing) return mapExistingReport(existing);
          }
          throw error;
        }
      }

      const trigger: AiTrigger =
        overflowHit && garbageHit
          ? 'both'
          : overflowHit
            ? 'overflow'
            : garbageHit
              ? 'garbage'
              : 'garbage_bin';

      const duplicate = await findDuplicatePhoto(prepared.hash);
      if (duplicate) {
        try {
          const inserted = await insertReportSafely({
            ticketId: duplicate.ticket_id,
            photoPath: null,
            note: input.note ?? null,
            lat: input.lat,
            lng: input.lng,
            deviceId: input.deviceId,
            prediction,
            trigger,
            result: 'merged',
            rejectReason: null,
            clientReportId: input.clientReportId ?? null,
            photoHash: prepared.hash,
          });
          emitRouteChanged(duplicate.locality_id);
          return {
            status: 'merged',
            reportId: inserted.id,
            ticketId: duplicate.ticket_id,
            merged: true,
            message: MESSAGE_DUPLICATE_PHOTO,
          };
        } catch (error) {
          if (isUniqueViolation(error)) {
            const existing = await existingAfterCollision(
              input.clientReportId ?? null,
            );
            if (existing) return mapExistingReport(existing);
          }
          throw error;
        }
      }

      const photoPath = await saveReportPhoto(prepared.buffer);

      try {
        const result = await withTransaction(async (client) => {
          // Serialise simultaneous reports for the same ~1 m cell so two
          // requests cannot both create a ticket for the same bin.
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            [`${input.lat.toFixed(5)}:${input.lng.toFixed(5)}`],
          );

          const localityId = await nearestLocalityId(client, input.lat, input.lng);
          if (!localityId) {
            throw new ApiError(
              503,
              'Reporting is not available in this area yet.',
              'no_locality',
            );
          }

          const mergeTarget = await findMergeTarget(
            client,
            input.lat,
            input.lng,
            config.duplicateMergeRadiusMeters,
          );

          if (mergeTarget) {
            await client.query(
              'UPDATE tickets SET report_count = report_count + 1 WHERE id = $1',
              [mergeTarget.id],
            );
            const inserted = await insertReport(client, {
              ticketId: mergeTarget.id,
              photoPath,
              note: input.note ?? null,
              lat: input.lat,
              lng: input.lng,
              deviceId: input.deviceId,
              prediction,
              trigger,
              result: 'merged',
              rejectReason: null,
              clientReportId: input.clientReportId ?? null,
              photoHash: prepared.hash,
            });
            return {
              status: 'merged' as const,
              ticketId: mergeTarget.id,
              localityId: mergeTarget.locality_id,
              reportId: inserted.id,
            };
          }

          const reportingDriverId = await findDriverForDevice(
            client,
            input.deviceId,
          );
          const nearbyDrivers = await findNearbyDrivers(
            client,
            input.lat,
            input.lng,
            config.driverStaleAfterSeconds,
            config.driverProximityNoRewardMeters,
          );

          const ticketId = await createTicket(client, {
            localityId,
            lat: input.lat,
            lng: input.lng,
            rewardEligible: reportingDriverId === null,
            flagReason: reportingDriverId === null ? null : 'driver_device',
          });

          for (const driverId of nearbyDrivers) {
            await client.query(
              `INSERT INTO ticket_reward_exclusions (ticket_id, driver_id, reason)
               VALUES ($1, $2, 'driver_nearby')
               ON CONFLICT DO NOTHING`,
              [ticketId, driverId],
            );
          }

          const inserted = await insertReport(client, {
            ticketId,
            photoPath,
            note: input.note ?? null,
            lat: input.lat,
            lng: input.lng,
            deviceId: input.deviceId,
            prediction,
            trigger,
            result: 'accepted',
            rejectReason: null,
            clientReportId: input.clientReportId ?? null,
            photoHash: prepared.hash,
          });

          return {
            status: 'accepted' as const,
            ticketId,
            localityId,
            reportId: inserted.id,
          };
        });

        emitRouteChanged(result.localityId);

        if (result.status === 'merged') {
          return {
            status: 'merged',
            reportId: result.reportId,
            ticketId: result.ticketId,
            merged: true,
            message: MESSAGE_MERGED,
          };
        }

        if (dispatch) {
          try {
            await dispatch.dispatchTicket(result.ticketId);
          } catch (error) {
            // The ticket still exists and stays open on the next route even if
            // the live pop-up fan-out fails.
            console.error('[dispatch] offer fan-out failed:', error);
          }
        }

        return {
          status: 'accepted',
          reportId: result.reportId,
          ticketId: result.ticketId,
          merged: false,
          message: MESSAGE_ACCEPTED,
        };
      } catch (error) {
        await deleteReportPhoto(photoPath).catch(() => undefined);
        if (isUniqueViolation(error)) {
          const existing = await existingAfterCollision(
            input.clientReportId ?? null,
          );
          if (existing) return mapExistingReport(existing);
        }
        throw error;
      }
    },

    async getStatus(reportId) {
      const result = await query<{
        id: string;
        result: ReportResult;
        reject_reason: string | null;
        ticket_id: string | null;
        created_at: Date;
        ticket_status: TicketStatus | null;
      }>(
        `SELECT r.id,
                r.result,
                r.reject_reason,
                r.ticket_id,
                r.created_at,
                t.status AS ticket_status
           FROM reports r
           LEFT JOIN tickets t ON t.id = r.ticket_id
          WHERE r.id = $1`,
        [reportId],
      );

      const row = result.rows[0];
      if (!row) return null;

      return {
        id: row.id,
        status: row.result,
        reason: row.reject_reason,
        ticketId: row.ticket_id,
        ticketStatus: row.ticket_status,
        createdAt: row.created_at.toISOString(),
      };
    },
  };
}
