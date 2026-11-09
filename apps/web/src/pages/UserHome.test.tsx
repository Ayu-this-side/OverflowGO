import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserHome from '../pages/UserHome';

describe('UserHome', () => {
  it('shows the report call to action', () => {
    render(<UserHome />);
    expect(
      screen.getByRole('heading', { name: /bin overflowing/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /report overflowing bin/i }),
    ).toBeDisabled();
  });
});
