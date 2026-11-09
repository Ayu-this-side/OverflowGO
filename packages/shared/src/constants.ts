/**
 * Cross-cutting constants shared by the API and the web app.
 * Tunable numbers belong in config/app.config.json, not here.
 */

export const TICKET_STATUSES = ['open', 'offered', 'assigned', 'completed'] as const;

export const REPORT_RESULTS = ['accepted', 'rejected', 'merged'] as const;

export const OFFER_RESPONSES = [
  'accepted',
  'rejected',
  'ignored',
  'expired',
  'taken_by_other',
] as const;

export const SERVER_EVENTS = {
  offerNew: 'offer:new',
  offerClosed: 'offer:closed',
  routeUpdated: 'route:updated',
  ticketReleased: 'ticket:released',
} as const;

export const CLIENT_EVENTS = {
  locationUpdate: 'location:update',
} as const;

export const API_ROUTES = {
  health: '/api/health',
  reports: '/api/reports',
  driverLogin: '/api/driver/login',
  driverOnline: '/api/driver/online',
  driverLocation: '/api/driver/location',
  driverRoute: '/api/driver/route',
  driverWallet: '/api/driver/wallet',
  driverVanFull: '/api/driver/van-full',
  driverVanEmptied: '/api/driver/van-emptied',
} as const;
