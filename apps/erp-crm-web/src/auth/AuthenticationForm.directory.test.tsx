import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationForm } from '@vista/ui';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

const baseProps = {
  applicationName: 'Vista POS',
  eyebrow: 'Cashier terminal',
  errorMessage: () => 'Sign-in failed',
  onAuthenticate: vi.fn().mockResolvedValue(undefined),
  subtitle: 'Use your assigned cashier account.',
  supportText: 'Contact your Vista Service administrator.',
  variant: 'pos' as const,
};

describe('shared directory sign-in form', () => {
  it('starts the configured organization sign-in flow and exchanges its return ticket', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const exchange = vi.fn().mockResolvedValue(undefined);

    render(
      <AuthenticationForm
        {...baseProps}
        directoryOptions={{ enabled: true, emergencyAccessAvailable: false, method: 'oidc' }}
        onStartDirectoryLogin={start}
        onExchangeDirectoryLogin={exchange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with your organization account' }));
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(exchange).not.toHaveBeenCalled();
  });

  it('exchanges a one-time return ticket without exposing it in the page URL', async () => {
    const ticket = 'a'.repeat(43);
    const exchange = vi.fn().mockResolvedValue(undefined);
    window.history.replaceState({}, '', `/#directory_ticket=${ticket}`);

    render(
      <AuthenticationForm
        {...baseProps}
        directoryOptions={{ enabled: true, emergencyAccessAvailable: false, method: 'oidc' }}
        onExchangeDirectoryLogin={exchange}
      />,
    );

    await waitFor(() => expect(exchange).toHaveBeenCalledWith(ticket));
    expect(window.location.hash).toBe('');
  });

  it('requires a reason when using allow-listed emergency local access', async () => {
    const authenticate = vi.fn().mockResolvedValue(undefined);

    render(
      <AuthenticationForm
        {...baseProps}
        directoryOptions={{ enabled: true, emergencyAccessAvailable: true, method: 'oidc' }}
        onAuthenticate={authenticate}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Emergency access' }));
    fireEvent.change(screen.getByLabelText('Work email'), {
      target: { value: 'local.admin@vista.local' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'known-local-password' },
    });
    fireEvent.change(screen.getByLabelText('Reason for emergency access'), {
      target: { value: 'Organization identity service outage' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(authenticate).toHaveBeenCalledWith({
        email: 'local.admin@vista.local',
        password: 'known-local-password',
        emergencyAccessReason: 'Organization identity service outage',
      }),
    );
  });
});
