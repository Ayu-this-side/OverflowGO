import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DriverHome from './DriverHome';

const driver = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Ravi Kumar',
  email: 'ravi@overflowgo.local',
  phone: '9876543210',
  vehicleNo: 'MH-12-AB-1234',
  isOnline: false,
  vanFull: false,
  acceptanceScore: 100,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function renderHome() {
  return render(
    <MemoryRouter>
      <DriverHome />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DriverHome', () => {
  it('shows the driver sign-in form', () => {
    renderHome();

    expect(
      screen.getByRole('heading', { name: /driver sign in/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('signs in and shows duty controls and the route link', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/driver/login')) {
        return jsonResponse({ token: 'test-token', driver, heartbeatSeconds: 20 });
      }
      if (url.endsWith('/api/driver/me')) {
        return jsonResponse({ driver, heartbeatSeconds: 20 });
      }
      if (url.endsWith('/api/driver/wallet')) {
        return jsonResponse({
          balance: 40,
          todayEarned: 20,
          todayCompletedJobs: 2,
          items: [],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHome();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'ravi@overflowgo.local' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'driver123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(
      await screen.findByRole('heading', { name: 'Ravi Kumar' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /go online/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /my route/i })).toHaveAttribute(
      'href',
      '/driver/route',
    );
    expect(await screen.findByText('₹40')).toBeInTheDocument();
    expect(screen.getByText('₹20')).toBeInTheDocument();
    expect(screen.getByText(/jobs today/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/driver/login',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows the login error returned by the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ message: 'Invalid email or password' }, 401),
      ),
    );

    renderHome();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'ravi@overflowgo.local' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent(/invalid email or password/i);
  });
});
