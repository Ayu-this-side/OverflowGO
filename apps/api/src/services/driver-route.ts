import type {
  AppConfig,
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
  locality_name: string;
  status: TicketStatus;
  report_count: number;
  first_reported_at: Date;
  assigned_driver_id: string | null;
  sla_deadline: Date | null;
  lat: string;
  lng: string;
  locality_lat: string;
  locality_lng: string;
  note: string | null;
  photo_path: string | null;
}

function ticketSummary(
  row: TicketRow,
  driverId: string,
): DriverRouteTicket {
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
    assigned:
      row.status === 'assigned' && row.assigned_driver_id === driverId,
    slaDeadline: row.sla_deadline?.toISOString() ?? null,
  };
}

function priorityTime(stop: DriverRouteStop): string {
  return stop.firstReportedAt ?? '';
}

/**
 * Route order from 09_DISPATCH_AND_ROUTING.md section 5:
 * localities with non-completed tickets first, oldest report first, then the
 * driver's regular stops in their original order. Accepted extra jobs whose
 * locality is not on the regular route get a synthetic stop. A full van adds
 * the dump-yard step at the front until it is emptied.
 */
export async function computeDriverRoute(
  driverId: string,
  config: AppConfig,
): Promise<DriverRoute> {
  const [stopsResult, ticketsResult, driverResult] = await Promise.all([
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
              l.name AS locality_name,
              t.status,
              t.report_count,
              t.first_reported_at,
              t.assigned_driver_id,
              t.sla_deadline,
              ST_Y(t.location::geometry) AS lat,
              ST_X(t.location::geometry) AS lng,
              ST_Y(l.center::geometry) AS locality_lat,
              ST_X(l.center::geometry) AS locality_lng,
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
        WHERE t.status <> 'completed'
          AND (
            t.assigned_driver_id = $1
            OR (
              t.assigned_driver_id IS NULL
              AND t.locality_id IN (
                SELECT locality_id FROM route_stops WHERE driver_id = $1
              )
            )
          )
        ORDER BY t.first_reported_at ASC`,
      [driverId],
    ),
    query<{ van_full: boolean }>(
      'SELECT van_full FROM drivers WHERE id = $1',
      [driverId],
    ),
  ]);

  const stops: DriverRouteStop[] = stopsResult.rows.map((row) => ({
    stopId: row.stop_id,
    localityId: row.locality_id,
    localityName: row.locality_name,
    hasTicket: false,
    ticketIds: [],
    firstReportedAt: null,
    reportCount: 0,
    current: false,
    lat: Number(row.lat),
    lng: Number(row.lng),
    tickets: [],
  }));

  const stopsByLocality = new Map(
    stops.map((stop) => [stop.localityId, stop]),
  );

  for (const ticket of ticketsResult.rows) {
    let stop = stopsByLocality.get(ticket.locality_id);
    if (!stop) {
      // An accepted extra job outside the driver's regular route.
      stop = {
        stopId: null,
        localityId: ticket.locality_id,
        localityName: ticket.locality_name,
        hasTicket: false,
        ticketIds: [],
        firstReportedAt: null,
        reportCount: 0,
        current: false,
        lat: Number(ticket.locality_lat),
        lng: Number(ticket.locality_lng),
        tickets: [],
      };
      stopsByLocality.set(ticket.locality_id, stop);
      stops.push(stop);
    }

    const summary = ticketSummary(ticket, driverId);
    stop.tickets.push(summary);
    stop.hasTicket = true;
    stop.ticketIds.push(ticket.id);
    stop.reportCount += ticket.report_count;
    if (
      !stop.firstReportedAt ||
      summary.firstReportedAt < stop.firstReportedAt
    ) {
      stop.firstReportedAt = summary.firstReportedAt;
    }
  }

  const priority = stops
    .filter((stop) => stop.hasTicket)
    .sort((a, b) => priorityTime(a).localeCompare(priorityTime(b)));
  const rest = stops.filter((stop) => !stop.hasTicket);
  const ordered = [...priority, ...rest];

  if (driverResult.rows[0]?.van_full) {
    ordered.unshift({
      stopId: null,
      localityId: 'dump-yard',
      localityName: config.dumpYard.name,
      hasTicket: false,
      ticketIds: [],
      firstReportedAt: null,
      reportCount: 0,
      current: false,
      lat: config.dumpYard.lat,
      lng: config.dumpYard.lng,
      tickets: [],
      isDumpYard: true,
    });
  }

  return { stops: ordered };
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
