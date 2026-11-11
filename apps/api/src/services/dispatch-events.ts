import { EventEmitter } from 'node:events';
import type { OfferPayload } from '@overflowgo/shared';

/**
 * In-process dispatch bus. Dispatch writes offers and releases; the socket
 * layer listens and pushes them to the affected driver rooms. Keeping this as
 * an EventEmitter lets the API tests exercise dispatch without a live socket.
 */
export const dispatchEvents = new EventEmitter();

export interface OfferNewEvent {
  driverId: string;
  offer: OfferPayload;
}

export interface OfferClosedEvent {
  driverId: string;
  offerId: string;
  reason: 'taken' | 'expired';
}

export interface TicketReleasedEvent {
  driverId: string;
  ticketId: string;
}

export function emitOfferNew(driverId: string, offer: OfferPayload): void {
  dispatchEvents.emit('offer:new', { driverId, offer } satisfies OfferNewEvent);
}

export function emitOfferClosed(
  driverId: string,
  offerId: string,
  reason: 'taken' | 'expired',
): void {
  dispatchEvents.emit('offer:closed', {
    driverId,
    offerId,
    reason,
  } satisfies OfferClosedEvent);
}

export function emitTicketReleased(driverId: string, ticketId: string): void {
  dispatchEvents.emit('ticket:released', {
    driverId,
    ticketId,
  } satisfies TicketReleasedEvent);
}
