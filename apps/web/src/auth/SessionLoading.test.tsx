import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionLoading } from './SessionLoading';

describe('SessionLoading', () => {
  it('offers Quick exit while the session is restored', () => {
    render(<SessionLoading />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(screen.getByRole('button', { name: 'Quick exit: leave CareLayer now' })).toBeTruthy();
  });
});
