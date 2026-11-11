import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DriverRoute } from '@overflowgo/shared';
import DriverRoutePage from './DriverRoute';
import { saveDriverSession } from '../lib/driver-session';

const route: DriverRoute = {
  stops: [
    {
      stopId: 'stop-b',
      localityId: 'locality-b',
      localityName: 'Area B',
      hasTicket: true,
      ticketIds: ['ticket-1'],
      firstReportedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      reportCount: 3,
      current: false,
      lat: 18.5204,
      lng: 73.8567,
      tickets: [
        {
          ticketId: 'ticket-1',
          status: 'open',
          reportCount: 3,
          firstReportedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          lat: 18.5204,
          lng: 73.8567,
          note: 'Near the school gate',
          photoUrl: null,
          assigned: false,
          slaDeadline: null,
        },
      ],
    },
    {
      stopId: 'stop-a',
      localityId: 'locality-a',
      localityName: 'Area A',
      hasTicket: false,
      ticketIds: [],
      firstReportedAt: null,
      reportCount: 0,
      current: false,
      lat: 18.516,
      lng: 73.841,
      tickets: [],
    },
  ],
};

vi.mock('../lib/driver-api', () => ({
  DriverApiError: class DriverApiError extends Error {},
  getDriverRoute: vi.fn(async () => route),
  isUnauthorized: () => false,
}));

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/driver/route']}>
      <Routes>
        <Route path="/driver/route" element={<DriverRoutePage />} />
        <Route path="/driver" element={<p>Driver sign in</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
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

describe('DriverRoute', () => {
  it('lists ticket stops first and shows report details', async () => {
    renderRoute();

    expect(await screen.findByText('Area B')).toBeInTheDocument();

    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('Area B');
    expect(first).toHaveTextContent(/overflow reported/i);
    expect(first).toHaveTextContent(/3 reports/i);
    expect(second).toHaveTextContent('Area A');
    expect(second).toHaveTextContent(/regular stop/i);
  });

  it('redirects to sign-in without a session', async () => {
    localStorage.clear();
    renderRoute();

    expect(await screen.findByText('Driver sign in')).toBeInTheDocument();
  });
});
