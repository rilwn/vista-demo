import { useBrowserSession } from '@vista/auth/browser-session';
import type { AuthenticationContextResponse, LoginRequest, LoginResponse } from '@vista/contracts';
import { AuthenticationForm, Button, SearchableSelects } from '@vista/ui';

import { ApiClientError, authenticate, getCurrentAccount, revokeSession } from './api/auth';
import { PosTerminal } from './PosTerminal';

export function App() {
  return (
    <>
      <SearchableSelects />
      <Application />
    </>
  );
}

function Application() {
  const authentication = useBrowserSession<
    LoginRequest,
    LoginResponse,
    AuthenticationContextResponse
  >({
    authenticate,
    getCurrentAccount,
    isContextValid: isAuthenticationContext,
    revokeSession,
    storageKey: 'vista.pos.session.v1',
  });
  const session = authentication.session;

  if (authentication.status === 'checking')
    return <ApplicationLoading label="Restoring POS access" />;
  if (authentication.status === 'anonymous') {
    return (
      <AuthenticationForm
        applicationName="Vista POS"
        eyebrow="Cashier terminal"
        errorMessage={signInError}
        onAuthenticate={authentication.login}
        subtitle="Secure cashier access for the Vista Service point of sale."
        supportText="Contact a Vista Service administrator if you cannot sign in."
      />
    );
  }
  if (!session) return <ApplicationLoading label="Preparing POS access" />;
  if (!hasModuleAccess(session.context, 'pos')) {
    return (
      <AccessUnavailable
        applicationName="Vista POS"
        onSignOut={authentication.logout}
        title="POS access is not assigned"
      />
    );
  }
  return (
    <PosTerminal
      employeeName={session.context.displayName}
      onSignOut={authentication.logout}
      token={session.sessionToken}
    />
  );
}

function ApplicationLoading({ label }: { label: string }) {
  return (
    <main className="application-state" aria-live="polite">
      <span aria-hidden="true">VS</span>
      <strong>{label}</strong>
      <p>Checking the current browser session.</p>
    </main>
  );
}

function AccessUnavailable({
  applicationName,
  onSignOut,
  title,
}: {
  applicationName: string;
  onSignOut: () => Promise<void>;
  title: string;
}) {
  return (
    <main className="application-state application-state--restricted">
      <span aria-hidden="true">VS</span>
      <p>{applicationName}</p>
      <h1>{title}</h1>
      <p>Use an account with the required application access, then sign in again.</p>
      <Button onClick={() => void onSignOut()} variant="secondary">
        Sign out
      </Button>
    </main>
  );
}

function hasModuleAccess(
  context: AuthenticationContextResponse | undefined,
  module: 'backup' | 'pos',
): boolean {
  return (
    context?.permissions.some(
      (permission) =>
        (permission.module === '*' || permission.module === module) &&
        (permission.action === '*' || permission.action === 'view'),
    ) ?? false
  );
}

function isAuthenticationContext(value: unknown): value is AuthenticationContextResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return typeof context['accountId'] === 'string' && Array.isArray(context['permissions']);
}

function signInError(error: unknown): string {
  if (!(error instanceof ApiClientError))
    return 'The service is unavailable. Check your connection and try again.';
  if (error.code === 'TWO_FACTOR_ENROLLMENT_REQUIRED')
    return 'This administrative account must enroll an authenticator before it can sign in.';
  if (error.code === 'PASSWORD_EXPIRED')
    return 'This password has expired. Contact a Vista Service administrator.';
  if (error.code === 'RATE_LIMITED') return 'Too many attempts. Wait a moment and try again.';
  return 'The email, password, or authentication code is incorrect.';
}
