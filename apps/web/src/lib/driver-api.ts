import type {
  CompleteTicketResponse,
  DriverLoginResponse,
  DriverProfile,
  DriverRoute,
  DriverSessionResponse,
  Wallet,
} from '@overflowgo/shared';

export class DriverApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'DriverApiError';
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFrom(response: Response, body: unknown): DriverApiError {
  const record =
    typeof body === 'object' && body !== null
      ? (body as { message?: unknown; error?: unknown })
      : {};
  const message =
    typeof record.message === 'string'
      ? record.message
      : `Request failed with HTTP ${response.status}`;
  const code = typeof record.error === 'string' ? record.error : undefined;
  return new DriverApiError(response.status, message, code);
}

async function jsonRequest<T>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await readJson(response);
  if (!response.ok) throw errorFrom(response, body);
  return body as T;
}

export function driverLogin(
  email: string,
  password: string,
  deviceId: string,
): Promise<DriverLoginResponse> {
  return jsonRequest('/api/driver/login', {
    method: 'POST',
    body: { email, password, deviceId },
  });
}

export function getDriverSession(
  token: string,
): Promise<DriverSessionResponse> {
  return jsonRequest('/api/driver/me', { token });
}

export function setDriverOnline(
  token: string,
  online: boolean,
  location?: { lat: number; lng: number },
): Promise<{ driver: DriverProfile }> {
  return jsonRequest('/api/driver/online', {
    method: 'POST',
    token,
    body: { online, ...location },
  });
}

export function sendDriverLocation(
  token: string,
  lat: number,
  lng: number,
): Promise<{ ok: boolean }> {
  return jsonRequest('/api/driver/location', {
    method: 'POST',
    token,
    body: { lat, lng },
  });
}

export function getDriverRoute(token: string): Promise<DriverRoute> {
  return jsonRequest('/api/driver/route', { token });
}

export interface RespondOfferResult {
  assigned: boolean;
  ticketId: string;
  reason?: 'taken' | 'expired' | 'rejected';
  slaDeadline?: string;
}

export function respondToOffer(
  token: string,
  offerId: string,
  response: 'accept' | 'reject',
): Promise<RespondOfferResult> {
  return jsonRequest(`/api/driver/offers/${encodeURIComponent(offerId)}/respond`, {
    method: 'POST',
    token,
    body: { response },
  });
}

export function getDriverWallet(token: string): Promise<Wallet> {
  return jsonRequest('/api/driver/wallet', { token });
}

export function setVanFull(
  token: string,
  full: boolean,
): Promise<{ driver: DriverProfile }> {
  return jsonRequest(
    full ? '/api/driver/van-full' : '/api/driver/van-emptied',
    { method: 'POST', token },
  );
}

export async function completeDriverTicket(
  token: string,
  ticketId: string,
  photo: Blob,
  lat: number,
  lng: number,
): Promise<CompleteTicketResponse> {
  const form = new FormData();
  form.append('photo', photo, 'after.jpg');
  form.append('lat', String(lat));
  form.append('lng', String(lng));

  const response = await fetch(
    `/api/driver/tickets/${encodeURIComponent(ticketId)}/complete`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const body = await readJson(response);
  if (!response.ok) throw errorFrom(response, body);
  return body as CompleteTicketResponse;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof DriverApiError && error.status === 401;
}
