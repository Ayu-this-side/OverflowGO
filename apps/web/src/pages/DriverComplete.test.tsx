import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DriverRoute } from '@overflowgo/shared';
import DriverComplete from './DriverComplete';
import { saveDriverSession } from '../lib/driver-session';

const route: DriverRoute = {
  stops: [
    {
      stopId: 'stop-1',
      localityId: 'locality-1',
      localityName: 'Area G',
      hasTicket: true,
      ticketIds: ['ticket-1'],
      firstReportedAt: new Date().toISOString(),
      reportCount: 1,
      current: true,
      lat: 18.5204,
      lng: 73.8567,
      tickets: [
        {
          ticketId: 'ticket-1',
          status: 'open',
          reportCount: 1,
          firstReportedAt: new Date().toISOString(),
          lat: 18.5204,
          lng: 73.8567,
          note: null,
          photoUrl: null,
          assigned: false,
          slaDeadline: null,
        },
      ],
    },
  ],
};

vi.mock('../lib/driver-api', () => ({
  DriverApiError: class DriverApiError extends Error {},
  completeDriverTicket: vi.fn(),
  getDriverRoute: vi.fn(async () => route),
  isUnauthorized: () => false,
}));

vi.mock('../components/CameraCapture', () => ({
  default: ({
    onError,
    onCancel,
  }: {
    onError: (reason: 'denied' | 'unsupported' | 'frame') => void;
    onCancel: () => void;
  }) => (
    <div>
      <p>Camera preview</p>
      <button type="button" onClick={() => onError('denied')}>
        Simulate camera error
      </button>
      <button type="button" onClick={onCancel}>
        Cancel camera
      </button>
    </div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/driver/tickets/ticket-1/complete']}>
      <Routes>
        <Route
          path="/driver/tickets/:ticketId/complete"
          element={<DriverComplete />}
        />
        <Route path="/driver" element={<p>Driver sign in</p>} />
        <Route path="/driver/route" element={<p>Driver route</p>} />
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
      name: 'Meera Joshi',
      email: 'meera@overflowgo.local',
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
  vi.clearAllMocks();
});

describe('DriverComplete', () => {
  it('opens the camera when Take after photo is clicked', async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Take after photo' }),
    );

    expect(await screen.findByText('Camera preview')).toBeInTheDocument();
  });

  it('shows a camera error instead of silently returning to the job', async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Take after photo' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Simulate camera error' }),
    );

    expect(await screen.findByText('Camera not available')).toBeInTheDocument();
    expect(
      screen.getByText(/Camera access was blocked/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Camera preview')).toBeInTheDocument();
  });

  it('returns to the job from a camera error', async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Take after photo' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Simulate camera error' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Back to job' }));

    expect(
      await screen.findByRole('button', { name: 'Take after photo' }),
    ).toBeInTheDocument();
  });
});
