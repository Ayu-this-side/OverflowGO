import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DriverRealtimeProvider } from './driver-realtime';
import { saveDriverSession } from './driver-session';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (success: PositionCallback) =>
        success({
          coords: {
            latitude: 18.5204,
            longitude: 73.8567,
            accuracy: 10,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        }),
    },
  });
  saveDriverSession({
    token: 'test-token',
    heartbeatSeconds: 20,
    driver: {
      id: 'driver-1',
      name: 'Ravi Kumar',
      email: 'ravi@overflowgo.local',
      phone: '',
      vehicleNo: 'MH-12-AB-1234',
      isOnline: true,
      vanFull: false,
      acceptanceScore: 100,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DriverRealtimeProvider', () => {
  it('keeps sending the location heartbeat outside the dashboard', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/driver/route']}>
        <DriverRealtimeProvider>
          <p>Route</p>
        </DriverRealtimeProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/driver/location',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
