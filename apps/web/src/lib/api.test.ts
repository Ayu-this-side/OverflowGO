import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  ServiceUnavailableError,
  getReportStatus,
  submitReport,
} from './api';

const photo = new Blob(['photo-bytes'], { type: 'image/jpeg' });

const input = {
  photo,
  lat: 18.5204,
  lng: 73.8567,
  note: 'Bin has been full for days',
  deviceId: 'device-1',
  clientReportId: 'client-report-1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitReport', () => {
  it('posts the compressed photo and metadata as multipart form data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          status: 'accepted',
          reportId: 'report-1',
          ticketId: 'ticket-1',
          merged: false,
          message: 'ok',
        },
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitReport(input);

    expect(result).toMatchObject({
      status: 'accepted',
      reportId: 'report-1',
      ticketId: 'ticket-1',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/reports');
    expect(init.method).toBe('POST');

    const form = init.body as FormData;
    expect(form.get('lat')).toBe('18.5204');
    expect(form.get('lng')).toBe('73.8567');
    expect(form.get('deviceId')).toBe('device-1');
    expect(form.get('clientReportId')).toBe('client-report-1');
    expect(form.get('note')).toBe('Bin has been full for days');
    expect(form.get('photo')).toBeInstanceOf(Blob);
  });

  it('omits an empty note', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'rejected' }, 200));
    vi.stubGlobal('fetch', fetchMock);

    await submitReport({ ...input, note: null });

    const form = fetchMock.mock.calls[0]![1].body as FormData;
    expect(form.get('note')).toBeNull();
  });

  it('throws ServiceUnavailableError on 503 so the caller can queue it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'ai_unavailable', message: 'AI is down' }, 503),
      ),
    );

    await expect(submitReport(input)).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });

  it('throws ApiError with the server message on 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'validation_error', message: 'lat: bad' }, 400),
      ),
    );

    await expect(submitReport(input)).rejects.toMatchObject({
      status: 400,
      message: 'lat: bad',
    });
    await expect(submitReport(input)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getReportStatus', () => {
  it('loads the ticket status for a report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'report-1',
        status: 'accepted',
        reason: null,
        ticketId: 'ticket-1',
        ticketStatus: 'assigned',
        createdAt: '2026-11-09T10:00:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await getReportStatus('report-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/reports/report-1');
    expect(status.ticketStatus).toBe('assigned');
  });

  it('throws ApiError when the report is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'not_found', message: 'Report not found' }, 404),
      ),
    );

    await expect(getReportStatus('missing')).rejects.toMatchObject({
      status: 404,
    });
  });
});
