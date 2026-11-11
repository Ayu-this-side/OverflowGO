import type {
  AppConfig,
  OfferPayload,
  TicketStatus,
} from '@overflowgo/shared';
import { query, withTransaction } from '../db/pool';
import { ApiError } from '../errors';
import {
  emitOfferClosed,
  emitOfferNew,
  emitTicketReleased,
} from './dispatch-events';
import { emitRouteChanged } from './route-events';

interface TicketRow {
  id: string;
  status: TicketStatus;
  locality_id: string;
  locality_name: string;
  offer_round: number;
  reward_eligible: boolean;
  note: string | null;
  photo_path: string | null;
}

interface EligibleDriverRow {
  id: string;
  distance_m: string;
}

interface OfferRow {
  id: string;
  ticket_id: string;
  driver_id: string;
  response: string | null;
  expires_at: Date;
  status: TicketStatus;
  locality_id: string;
}

export type OfferAnswer = 'accept' | 'reject';

export interface RespondResult {
  assigned: boolean;
  ticketId: string;
  reason?: 'taken' | 'expired' | 'rejected';
  slaDeadline?: string;
}

export interface DispatchOptions {
  expanded?: boolean;
  excludeDriverIds?: string[];
}

export interface DispatchService {
  dispatchTicket(ticketId: string, options?: DispatchOptions): Promise<void>;
  respond(
    driverId: string,
    offerId: string,
    answer: OfferAnswer,
  ): Promise<RespondResult>;
  tick(): Promise<void>;
}

function offerReward(
  ticket: TicketRow,
  driverId: string,
  excludedDriverIds: Set<string>,
  config: AppConfig,
): number {
  if (!ticket.reward_eligible) return 0;
  if (excludedDriverIds.has(driverId)) return 0;
  return config.rewardPerExtraJob;
}

async function loadTicket(ticketId: string): Promise<TicketRow | null> {
  const result = await query<TicketRow>(
    `SELECT t.id,
            t.status,
            t.locality_id,
            l.name AS locality_name,
            t.offer_round,
            t.reward_eligible,
            (
              SELECT r.note
                FROM reports r
               WHERE r.ticket_id = t.id AND r.note IS NOT NULL
               ORDER BY r.created_at DESC
               LIMIT 1
            ) AS note,
            (
              SELECT r.photo_path
                FROM reports r
               WHERE r.ticket_id = t.id AND r.photo_path IS NOT NULL
               ORDER BY r.created_at DESC
               LIMIT 1
            ) AS photo_path
       FROM tickets t
       JOIN localities l ON l.id = t.locality_id
      WHERE t.id = $1`,
    [ticketId],
  );
  return result.rows[0] ?? null;
}

async function excludedDrivers(ticketId: string): Promise<Set<string>> {
  const result = await query<{ driver_id: string }>(
    'SELECT driver_id FROM ticket_reward_exclusions WHERE ticket_id = $1',
    [ticketId],
  );
  return new Set(result.rows.map((row) => row.driver_id));
}

export function createDispatchService({
  config,
}: {
  config: AppConfig;
}): DispatchService {
  async function eligibleDrivers(
    ticketId: string,
    radiusMeters: number,
    excludeDriverIds: string[],
  ): Promise<EligibleDriverRow[]> {
    const result = await query<EligibleDriverRow>(
      `SELECT d.id,
              ST_Distance(d.last_location, t.location) AS distance_m
         FROM tickets t
         JOIN drivers d
           ON d.is_online = true
          AND d.van_full = false
        WHERE t.id = $1
          AND d.last_location IS NOT NULL
          AND d.last_ping_at > now() - make_interval(secs => $2)
          AND ST_DWithin(d.last_location, t.location, $3)
          AND NOT (d.id = ANY($4::uuid[]))
          -- A locality already on the driver's fixed route is handled
          -- naturally, so it earns no extra-job pop-up.
          AND NOT EXISTS (
            SELECT 1
              FROM route_stops rs
             WHERE rs.driver_id = d.id
               AND rs.locality_id = t.locality_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM offers o
             WHERE o.ticket_id = t.id AND o.driver_id = d.id
          )
        ORDER BY distance_m ASC`,
      [ticketId, config.driverStaleAfterSeconds, radiusMeters, excludeDriverIds],
    );
    return result.rows;
  }

  async function dispatchTicket(
    ticketId: string,
    { expanded = false, excludeDriverIds = [] }: DispatchOptions = {},
  ): Promise<void> {
    const ticket = await loadTicket(ticketId);
    if (!ticket || (ticket.status !== 'open' && ticket.status !== 'offered')) {
      return;
    }

    const radiusMeters =
      (expanded ? config.geofenceExpandedRadiusKm : config.geofenceRadiusKm) *
      1000;
    const drivers = await eligibleDrivers(
      ticketId,
      radiusMeters,
      excludeDriverIds,
    );

    if (!drivers.length) {
      if (!expanded) {
        // Empty initial round: try the wider geofence once immediately.
        await dispatchTicket(ticketId, {
          expanded: true,
          excludeDriverIds,
        });
        return;
      }
      await query(
        `UPDATE tickets
            SET status = 'open', offer_round = 2
          WHERE id = $1 AND status = 'offered'`,
        [ticketId],
      );
      emitRouteChanged(ticket.locality_id);
      return;
    }

    const excluded = await excludedDrivers(ticketId);
    const expiresAt = new Date(
      Date.now() + config.offerTimeoutSeconds * 1000,
    );

    const created: Array<{ driverId: string; payload: OfferPayload }> = [];
    for (const driver of drivers) {
      const inserted = await query<{ id: string; expires_at: Date }>(
        `INSERT INTO offers (ticket_id, driver_id, expires_at, distance_meters)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (ticket_id, driver_id) DO NOTHING
         RETURNING id, expires_at`,
        [ticketId, driver.id, expiresAt, Number(driver.distance_m)],
      );
      const offer = inserted.rows[0];
      if (!offer) continue;

      created.push({
        driverId: driver.id,
        payload: {
          offerId: offer.id,
          ticketId,
          localityName: ticket.locality_name,
          photoUrl: ticket.photo_path
            ? `/api/photos/${encodeURIComponent(ticket.photo_path)}`
            : null,
          note: ticket.note,
          distanceMeters: Math.round(Number(driver.distance_m)),
          reward: offerReward(ticket, driver.id, excluded, config),
          expiresAt: offer.expires_at.toISOString(),
        },
      });
    }

    if (!created.length) {
      if (expanded) {
        await query(
          `UPDATE tickets
              SET status = 'open', offer_round = 2
            WHERE id = $1 AND status = 'offered'`,
          [ticketId],
        );
      }
      return;
    }

    await query(
      `UPDATE tickets
          SET status = 'offered', offer_round = $2
        WHERE id = $1 AND status IN ('open', 'offered')`,
      [ticketId, expanded ? 2 : 1],
    );
    emitRouteChanged(ticket.locality_id);

    for (const offer of created) {
      emitOfferNew(offer.driverId, offer.payload);
    }
  }

  async function expireOffersForTicket(ticketId: string): Promise<void> {
    const expired = await query<{ id: string; driver_id: string }>(
      `UPDATE offers
          SET response = 'expired', responded_at = now()
        WHERE ticket_id = $1
          AND response IS NULL
          AND expires_at <= now()
        RETURNING id, driver_id`,
      [ticketId],
    );
    for (const offer of expired.rows) {
      emitOfferClosed(offer.driver_id, offer.id, 'expired');
    }
  }

  async function finalizeRound(ticketId: string): Promise<void> {
    await expireOffersForTicket(ticketId);

    const ticketResult = await query<{
      status: TicketStatus;
      offer_round: number;
      locality_id: string;
    }>(
      `SELECT status, offer_round, locality_id
         FROM tickets
        WHERE id = $1`,
      [ticketId],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket || ticket.status !== 'offered') return;

    const pending = await query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM offers
        WHERE ticket_id = $1 AND response IS NULL`,
      [ticketId],
    );
    if (Number(pending.rows[0]?.count ?? 0) > 0) return;

    if (ticket.offer_round < 2) {
      await dispatchTicket(ticketId, { expanded: true });
      return;
    }

    await query(
      `UPDATE tickets
          SET status = 'open'
        WHERE id = $1 AND status = 'offered'`,
      [ticketId],
    );
    emitRouteChanged(ticket.locality_id);
  }

  async function respond(
    driverId: string,
    offerId: string,
    answer: OfferAnswer,
  ): Promise<RespondResult> {
    const offerResult = await query<OfferRow>(
      `SELECT o.id,
              o.ticket_id,
              o.driver_id,
              o.response,
              o.expires_at,
              t.status,
              t.locality_id
         FROM offers o
         JOIN tickets t ON t.id = o.ticket_id
        WHERE o.id = $1 AND o.driver_id = $2`,
      [offerId, driverId],
    );
    const offer = offerResult.rows[0];
    if (!offer) {
      throw new ApiError(404, 'Offer not found', 'offer_not_found');
    }

    if (answer === 'reject') {
      if (!offer.response) {
        await query(
          `UPDATE offers
              SET response = 'rejected', responded_at = now()
            WHERE id = $1 AND response IS NULL`,
          [offerId],
        );
      }
      await finalizeRound(offer.ticket_id);
      return { assigned: false, ticketId: offer.ticket_id, reason: 'rejected' };
    }

    if (offer.response === 'accepted') {
      return { assigned: true, ticketId: offer.ticket_id };
    }
    if (offer.response) {
      return { assigned: false, ticketId: offer.ticket_id, reason: 'taken' };
    }
    if (offer.expires_at.getTime() <= Date.now()) {
      await expireOffersForTicket(offer.ticket_id);
      await finalizeRound(offer.ticket_id);
      return { assigned: false, ticketId: offer.ticket_id, reason: 'expired' };
    }

    const result = await withTransaction(async (client) => {
      const assigned = await client.query<{ sla_deadline: Date }>(
        `UPDATE tickets
            SET status = 'assigned',
                assigned_driver_id = $2,
                assigned_at = now(),
                sla_deadline = now() + make_interval(mins => $3)
          WHERE id = $1
            AND status IN ('open', 'offered')
          RETURNING sla_deadline`,
        [offer.ticket_id, driverId, config.taskSlaMinutes],
      );
      const row = assigned.rows[0];
      if (!row) {
        await client.query(
          `UPDATE offers
              SET response = 'taken_by_other', responded_at = now()
            WHERE id = $1 AND response IS NULL`,
          [offerId],
        );
        return null;
      }

      await client.query(
        `UPDATE offers
            SET response = 'accepted', responded_at = now()
          WHERE id = $1`,
        [offerId],
      );

      const losers = await client.query<{ id: string; driver_id: string }>(
        `UPDATE offers
            SET response = 'taken_by_other', responded_at = now()
          WHERE ticket_id = $1
            AND id <> $2
            AND response IS NULL
          RETURNING id, driver_id`,
        [offer.ticket_id, offerId],
      );

      return { slaDeadline: row.sla_deadline, losers: losers.rows };
    });

    if (!result) {
      return { assigned: false, ticketId: offer.ticket_id, reason: 'taken' };
    }

    for (const loser of result.losers) {
      emitOfferClosed(loser.driver_id, loser.id, 'taken');
    }
    emitRouteChanged(offer.locality_id);

    return {
      assigned: true,
      ticketId: offer.ticket_id,
      slaDeadline: result.slaDeadline.toISOString(),
    };
  }

  async function tick(): Promise<void> {
    const expired = await query<{ id: string; ticket_id: string; driver_id: string }>(
      `UPDATE offers
          SET response = 'expired', responded_at = now()
        WHERE response IS NULL AND expires_at <= now()
        RETURNING id, ticket_id, driver_id`,
    );

    const touchedTickets = new Set<string>();
    for (const offer of expired.rows) {
      emitOfferClosed(offer.driver_id, offer.id, 'expired');
      touchedTickets.add(offer.ticket_id);
    }
    for (const ticketId of touchedTickets) {
      await finalizeRound(ticketId);
    }

    const released = await query<{
      id: string;
      assigned_driver_id: string;
      locality_id: string;
    }>(
      `WITH missed AS (
         SELECT id, assigned_driver_id, locality_id
           FROM tickets
          WHERE status = 'assigned'
            AND sla_deadline IS NOT NULL
            AND sla_deadline < now()
          FOR UPDATE
       ), updated AS (
         UPDATE tickets t
            SET status = 'open',
                assigned_driver_id = NULL,
                assigned_at = NULL,
                sla_deadline = NULL
           FROM missed m
          WHERE t.id = m.id
          RETURNING t.id, m.assigned_driver_id, m.locality_id
       )
       SELECT id, assigned_driver_id, locality_id FROM updated`,
    );

    for (const ticket of released.rows) {
      await query(
        `UPDATE drivers
            SET acceptance_score = GREATEST(0, acceptance_score - $2)
          WHERE id = $1`,
        [ticket.assigned_driver_id, config.acceptanceScorePenalty],
      );

      emitTicketReleased(ticket.assigned_driver_id, ticket.id);
      emitRouteChanged(ticket.locality_id);

      // Re-offer the released ticket to fresh drivers, never the one who
      // missed the SLA.
      await query('DELETE FROM offers WHERE ticket_id = $1', [ticket.id]);
      await query('UPDATE tickets SET offer_round = 0 WHERE id = $1', [
        ticket.id,
      ]);
      await dispatchTicket(ticket.id, {
        excludeDriverIds: [ticket.assigned_driver_id],
      });
    }
  }

  return { dispatchTicket, respond, tick };
}
