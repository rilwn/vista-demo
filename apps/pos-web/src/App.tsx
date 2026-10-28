import { useBrowserSession } from '@vista/auth/browser-session';
import type {
  AuthenticationContextResponse,
  DirectorySignInOptions,
  LoginRequest,
  LoginResponse,
} from '@vista/contracts';
import { AuthenticationForm, Button, SearchableSelects, VistaMark } from '@vista/ui';
import { useCallback, useEffect, useState } from 'react';

import {
  ApiClientError,
  authenticate,
  exchangeDirectoryLogin,
  getCurrentAccount,
  getDirectorySignInOptions,
  revokeSession,
  startDirectoryLogin,
} from './api/auth';
import { PosTerminal } from './PosTerminal';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { useLocalization } from './i18n/LocalizationProvider';

export function App() {
  return (
    <>
      <SearchableSelects />
      <Application />
    </>
  );
}

function Application() {
  const { locale } = useLocalization();
  const [directoryOptions, setDirectoryOptions] = useState<DirectorySignInOptions>();
  const authentication = useBrowserSession<
    LoginRequest,
    LoginResponse,
    AuthenticationContextResponse
  >({
    authenticate,
    getCurrentAccount,
    isContextValid: isAuthenticationContext,
    allowOfflineRestore: isNetworkUnavailable,
    revokeSession,
    storageKey: 'vista.pos.session.v1',
  });
  useEffect(() => {
    void getDirectorySignInOptions()
      .then(setDirectoryOptions)
      .catch(() => undefined);
  }, []);
  const beginDirectoryLogin = useCallback(async () => {
    const result = await startDirectoryLogin({ app: 'pos' });
    globalThis.location.assign(result.authorizationUrl);
  }, []);
  const finishDirectoryLogin = useCallback(
    async (ticket: string, totpCode?: string) => {
      const response = await exchangeDirectoryLogin({ ticket, ...(totpCode ? { totpCode } : {}) });
      await authentication.accept(response);
    },
    [authentication.accept],
  );
  const session = authentication.session;

  if (authentication.status === 'checking')
    return <ApplicationLoading label="Restoring POS access" />;
  if (authentication.status === 'anonymous') {
    return (
      <>
        <LanguageSwitcher floating />
        <AuthenticationForm
          applicationName="Vista POS"
          eyebrow={locale === 'bg' ? 'Касов терминал' : 'Cashier terminal'}
          errorMessage={(error) => signInError(error, locale)}
          directoryOptions={directoryOptions}
          onStartDirectoryLogin={beginDirectoryLogin}
          onExchangeDirectoryLogin={finishDirectoryLogin}
          locale={locale}
          onAuthenticate={authentication.login}
          subtitle={
            locale === 'bg'
              ? 'Влезте с назначения си касиерски профил.'
              : 'Use your assigned cashier account.'
          }
          supportText={
            locale === 'bg'
              ? 'Нуждаете се от помощ? Свържете се с администратор на Vista Service.'
              : 'Need help? Contact your Vista Service administrator.'
          }
          variant="pos"
        />
      </>
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
      canCreateReports={session.context.permissions.some(
        (permission) =>
          (permission.module === '*' || permission.module === 'pos') &&
          (permission.action === '*' || permission.action === 'create'),
      )}
      accountId={session.context.accountId}
      employeeName={session.context.displayName}
      onSignOut={authentication.logout}
      token={session.sessionToken}
    />
  );
}

function ApplicationLoading({ label }: { label: string }) {
  return (
    <main className="application-state" aria-live="polite">
      <VistaMark compact product="Vista POS" />
      <strong>{label}</strong>
      <p>Getting your counter ready.</p>
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
      <VistaMark compact product={applicationName} />
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

function isNetworkUnavailable(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 0;
}

function signInError(error: unknown, locale: 'bg' | 'en' = 'en'): string {
  const messages =
    locale === 'bg'
      ? {
          unavailable: 'Услугата не е достъпна. Проверете връзката си и опитайте отново.',
          enrollment:
            'Администраторският профил трябва първо да настрои приложение за удостоверяване.',
          expired: 'Паролата е изтекла. Свържете се с администратор на Vista Service.',
          rate: 'Твърде много опити. Изчакайте и опитайте отново.',
          directory: 'Служебният вход не е достъпен. Опитайте отново след малко.',
          failed:
            'Служебният вход не може да бъде потвърден. Опитайте отново или се свържете с администратор.',
          credentials: 'Имейлът, паролата или кодът за удостоверяване са неправилни.',
        }
      : {
          unavailable: 'The service is unavailable. Check your connection and try again.',
          enrollment:
            'This administrative account must enroll an authenticator before it can sign in.',
          expired: 'This password has expired. Contact a Vista Service administrator.',
          rate: 'Too many attempts. Wait a moment and try again.',
          directory: 'Organization sign-in is unavailable. Try again shortly.',
          failed:
            'Organization sign-in could not be verified. Start again or contact your administrator.',
          credentials: 'The email, password, or authentication code is incorrect.',
        };
  if (!(error instanceof ApiClientError)) return messages.unavailable;
  if (error.code === 'TWO_FACTOR_ENROLLMENT_REQUIRED') return messages.enrollment;
  if (error.code === 'PASSWORD_EXPIRED') return messages.expired;
  if (error.code === 'RATE_LIMITED') return messages.rate;
  if (error.code === 'DIRECTORY_UNAVAILABLE') return messages.directory;
  if (error.code === 'DIRECTORY_SIGN_IN_FAILED') return messages.failed;
  return messages.credentials;
}
