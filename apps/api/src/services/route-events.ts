import { EventEmitter } from 'node:events';

/**
 * In-process route change bus. The report and completion services announce
 * changes; the socket layer listens and pushes fresh routes to online drivers.
 * Kept as an EventEmitter so tests do not need a running Socket.IO server.
 */
export const routeEvents = new EventEmitter();

export function emitRouteChanged(localityId: string | null): void {
  routeEvents.emit('changed', localityId);
}
