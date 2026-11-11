import type {
  DriverRoute,
  DriverRouteStop,
  DriverRouteTicket,
  TicketStatus,
} from '@overflowgo/shared';
import { query } from '../db/pool';

interface StopRow {
  stop_id: string;
  locality_id: string;
  locality_name: string;
  position: number;
  lat: string;
  lng: string;
}

interface TicketRow {
  id: string;
  locality_id: string;
  status: TicketStatus;
  report_count: number;
  first_reported_at: Date;
  lat: string;
  lng: string;
  note: string | null;
  photo_path: string | null;
}

function ticketSummary(row: TicketRow): DriverRouteTicket {
  return {
    ticketId: row.id,
    status: row.status,
    reportCount: row.report_count,
    firstReportedAt: row.first_reported_at.toISOString(),
    lat: Number(row.lat),
    lng: Number(row.lng),
    note: row.note,
    photoUrl: row.photo_path
      ? `/api/photos/${encodeURIComponent(row.photo_path)}`
      : null,
  };
}

/**
 * Route order from 09_DISPATCH_AND_ROUTING.md section 5:
 * localities with non-completed tickets first, oldest report first, then the
 * driver's regular stops in their original order.
 */
export async function computeDriverRoute(driverId: string): Promise<DriverRoute> {
  const [stopsResult, ticketsResult] = await Promise.all([
    query<StopRow>(
      `SELECT rs.id AS stop_id,
              l.id AS locality_id,
              l.name AS locality_name,
              rs.position,
              ST_Y(l.center::geometry) AS lat,
              ST_X(l.center::geometry) AS lng
         FROM route_stops rs
         JOIN localities l ON l.id = rs.locality_id
        WHERE rs.driver_id = $1
        ORDER BY rs.position ASC`,
      [driverId],
    ),
    query<TicketRow>(
      `SELECT t.id,
              t.locality_id,
              t.status,
              t.report_count,
              t.first_reported_at,
              ST_Y(t.location::geometry) AS lat,
              ST_X(t.location::geometry) AS lng,
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
        WHERE t.status <> 'completed'
          AND t.locality_id IN (
            SELECT locality_id FROM route_stops WHERE driver_id = $1
          )
        ORDER BY t.first_reported_at ASC`,
      [driverId],
    ),
  ]);

  const ticketsByLocality = new Map<string, TicketRow[]>();
  for (const ticket of ticketsResult.rows) {
    const list = ticketsByLocality.get(ticket.locality_id) ?? [];
    list.push(ticket);
    ticketsByLocality.set(ticket.locality_id, list);
  }

  const stops: DriverRouteStop[] = stopsResult.rows.map((row) => {
    const tickets = ticketsByLocality.get(row.locality_id) ?? [];
    const firstTicket = tickets[0];
    return {
      stopId: row.stop_id,
      localityId: row.locality_id,
      localityName: row.locality_name,
      hasTicket: tickets.length > 0,
      ticketIds: tickets.map((ticket) => ticket.id),
      firstReportedAt: firstTicket?.first_reported_at.toISOString() ?? null,
      reportCount: tickets.reduce((sum, ticket) => sum + ticket.report_count, 0),
      current: false,
      lat: Number(row.lat),
      lng: Number(row.lng),
      tickets: tickets.map(ticketSummary),
    };
  });

  const priority = stops
    .filter((stop) => stop.hasTicket)
    .sort((a, b) => {
      const aTime = a.firstReportedAt ?? '';
      const bTime = b.firstReportedAt ?? '';
      return aTime.localeCompare(bTime);
    });
  const rest = stops.filter((stop) => !stop.hasTicket);

  return { stops: [...priority, ...rest] };
}

export async function driverCoversLocality(
  driverId: string,
  localityId: string,
): Promise<boolean> {
  const result = await query(
    `SELECT 1
       FROM route_stops
      WHERE driver_id = $1 AND locality_id = $2
      LIMIT 1`,
    [driverId, localityId],
  );
  return (result.rowCount ?? 0) > 0;
}
