import type { ReportResponse, ReportStatusResponse } from '@overflowgo/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ServiceUnavailableError extends Error {
  constructor(message = 'The service is temporarily unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

export interface SubmitReportInput {
  photo: Blob;
  lat: number;
  lng: number;
  note: string | null;
  deviceId: string;
  clientReportId: string;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageFrom(body: unknown): string | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof (body as { message?: unknown }).message === 'string'
  ) {
    return (body as { message: string }).message;
  }
  return undefined;
}

export async function submitReport(
  input: SubmitReportInput,
): Promise<ReportResponse> {
  const form = new FormData();
  form.append('photo', input.photo, 'report.jpg');
  form.append('lat', String(input.lat));
  form.append('lng', String(input.lng));
  form.append('deviceId', input.deviceId);
  form.append('clientReportId', input.clientReportId);
  if (input.note) {
    form.append('note', input.note);
  }

  const response = await fetch('/api/reports', {
    method: 'POST',
    body: form,
  });

  const body = await readJson(response);

  if (response.status === 503) {
    throw new ServiceUnavailableError(
      messageFrom(body) ??
        'The image check is temporarily unavailable. Please try again.',
    );
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFrom(body) ?? `Report failed with HTTP ${response.status}`,
    );
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('status' in body) ||
    typeof (body as { status?: unknown }).status !== 'string'
  ) {
    throw new ApiError(502, 'The server returned an unexpected response');
  }

  return body as ReportResponse;
}

export async function getReportStatus(
  reportId: string,
): Promise<ReportStatusResponse> {
  const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}`);
  const body = await readJson(response);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFrom(body) ?? `Status check failed with HTTP ${response.status}`,
    );
  }

  return body as ReportStatusResponse;
}
