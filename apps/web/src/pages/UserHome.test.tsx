import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UserHome from './UserHome';
import { I18nProvider } from '../i18n';

function renderHome() {
  return render(
    <I18nProvider>
      <UserHome />
    </I18nProvider>,
  );
}

const originalGeolocation = navigator.geolocation;
const originalMediaDevices = navigator.mediaDevices;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: undefined,
  });
});

afterEach(() => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: originalGeolocation,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: originalMediaDevices,
  });
});

describe('UserHome', () => {
  it('shows the report call to action', () => {
    renderHome();

    expect(
      screen.getByRole('heading', { name: /bin overflowing/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /report overflowing bin/i }),
    ).toBeEnabled();
  });

  it('switches between English and Hindi', () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: /switch language/i }));

    expect(
      screen.getByRole('heading', { name: /कूड़ेदान भर गया है/i }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');

    fireEvent.click(screen.getByText('English'));

    expect(
      screen.getByRole('heading', { name: /bin overflowing/i }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('explains how to enable the camera when it is unavailable', async () => {
    renderHome();
    fireEvent.click(
      screen.getByRole('button', { name: /report overflowing bin/i }),
    );

    expect(await screen.findByText(/camera is needed/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /report overflowing bin/i }),
    ).toBeDisabled();
  });
});
