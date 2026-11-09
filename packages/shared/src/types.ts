/**
 * Shared domain types for the API, web app and tooling.
 * These mirror the database schema in OverflowGo_MD_Docs/04_DATABASE_SCHEMA.md.
 */

export type TicketStatus = 'open' | 'offered' | 'assigned' | 'completed';

export type ReportResult = 'accepted' | 'rejected' | 'merged';

export type OfferResponse =
  | 'accepted'
  | 'rejected'
  | 'ignored'
  | 'expired'
  | 'taken_by_other';

export type AiTrigger = 'overflow' | 'garbage' | 'both';

export type TicketFlagReason = 'driver_device' | 'driver_nearby';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface AppConfig {
  geofenceRadiusKm: number;
  geofenceExpandedRadiusKm: number;
  offerTimeoutSeconds: number;
  taskSlaMinutes: number;
  duplicateMergeRadiusMeters: number;
  driverProximityNoRewardMeters: number;
  driverHeartbeatSeconds: number;
  driverStaleAfterSeconds: number;
  afterPhotoMaxDistanceMeters: number;
  aiOverflowThreshold: number;
  aiGarbageThreshold: number;
  aiVerifyMaxOverflowConf: number;
  aiVerifyMaxGarbageConf: number;
  rewardPerExtraJob: number;
  rewardDailyCapPerDriver: number;
  photoRetentionDaysAfterClose: number;
  skipOfferIfRouteDueWithinMinutes: number;
  timezone: string;
  acceptanceScorePenalty: number;
  dumpYard: {
    name: string;
    lat: number;
    lng: number;
  };
  corsOrigins: string[];
}

export interface AiDetection {
  class: string;
  conf: number;
  box: [number, number, number, number];
}

export interface AiPrediction {
  overflow_conf: number;
  bin_conf: number;
  garbage_conf: number;
  detections: AiDetection[];
}

interface DriverBase {
  id: string;
  name: string;
  email: string;
  phone: string;
  vehicleNo: string;
}

export interface DriverProfile extends DriverBase {
  isOnline: boolean;
  vanFull: boolean;
  acceptanceScore: number;
}

export interface DriverRouteStop {
  stopId: string | null;
  localityId: string;
  localityName: string;
  hasTicket: boolean;
  ticketIds: string[];
  firstReportedAt: string | null;
  reportCount: number;
  current: boolean;
}

export interface DriverRoute {
  stops: DriverRouteStop[];
}

export interface WalletItem {
  ticketId: string;
  amount: number;
  createdAt: string;
}

export interface Wallet {
  balance: number;
  todayEarned: number;
  items: WalletItem[];
}

export interface ReportAcceptedResponse {
  status: 'accepted' | 'merged';
  ticketId: string;
  merged: boolean;
  message: string;
}

export interface ReportRejectedResponse {
  status: 'rejected';
  reason: string;
}

export type ReportResponse = ReportAcceptedResponse | ReportRejectedResponse;

export interface OfferPayload {
  offerId: string;
  ticketId: string;
  photoUrl: string | null;
  note: string | null;
  distanceMeters: number;
  reward: number;
  expiresAt: string;
}

export interface OfferClosedPayload {
  offerId: string;
  reason: 'taken' | 'expired';
}

export interface TicketReleasedPayload {
  ticketId: string;
}
