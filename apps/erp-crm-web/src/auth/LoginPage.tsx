import { Button, InlineAlert, TextField, VistaMark } from '@vista/ui';
import type { DirectorySignInOptions } from '@vista/contracts';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  ApiClientError,
  exchangeDirectoryLogin,
  getDirectorySignInOptions,
  startDirectoryLogin,
} from '../api/auth';
import { Icon } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { TechnicalIdentifier } from '../components/TechnicalIdentifier';
import { useLocalization } from '../i18n/LocalizationProvider';
import { messages } from '../messages';
import { Link, Navigate, useRouter } from '../routing/Router';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const { accept, login, status } = useAuth();
  const { t } = useLocalization();
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<'credentials' | 'totp' | 'directory-totp'>('credentials');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [directoryOptions, setDirectoryOptions] = useState<DirectorySignInOptions>();
  const [directoryTicket, setDirectoryTicket] = useState('');
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState('');
  const processedTicket = useRef('');

  useEffect(() => {
    void getDirectorySignInOptions()
      .then(setDirectoryOptions)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const ticket = new URLSearchParams(globalThis.location.hash.replace(/^#/u, '')).get(
      'directory_ticket',
    );
    if (!ticket || processedTicket.current === ticket) return;
    processedTicket.current = ticket;
    globalThis.history.replaceState(
      null,
      '',
      `${globalThis.location.pathname}${globalThis.location.search}`,
    );
    setDirectoryTicket(ticket);
    setStep('directory-totp');
    setBusy(true);
    setError(null);
    void exchangeDirectoryLogin({ ticket })
      .then(accept)
      .then(() => navigate('/', { replace: true }))
      .catch((caught: unknown) => {
        const apiError =
          caught instanceof ApiClientError
            ? caught
            : new ApiClientError(messages.errors.default, 'REQUEST_FAILED', 0);
        if (apiError.code === 'TWO_FACTOR_REQUIRED') setTotpCode('');
        else setError(apiError);
      })
      .finally(() => setBusy(false));
  }, [accept, navigate]);

  if (status === 'checking') {
    return (
      <main className="full-page-loader" aria-live="polite">
        <span className="loader-mark" aria-hidden="true">
          <Icon name="brand" size={24} />
        </span>
        <strong>{t('login.loading')}</strong>
        <p>{t('login.loadingDetail')}</p>
      </main>
    );
  }
  if (status === 'authenticated') {
    return <Navigate replace to="/" />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'directory-totp') {
        if (!directoryTicket) throw new Error('The organization sign-in has expired. Start again.');
        await accept(await exchangeDirectoryLogin({ ticket: directoryTicket, totpCode }));
        setDirectoryTicket('');
      } else {
        await login({
          email,
          password,
          ...(step === 'totp' ? { totpCode } : {}),
          ...(emergencyMode ? { emergencyAccessReason: emergencyReason } : {}),
        });
      }
      // A login can follow a stale browser-history entry from another employee.
      // Always begin a newly authenticated session at the permission-safe overview;
      // navigation then exposes only what this account may open.
      navigate('/', { replace: true });
    } catch (caught) {
      const apiError =
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(messages.errors.default, 'REQUEST_FAILED', 0);
      if (apiError.code === 'TWO_FACTOR_REQUIRED' && step === 'credentials') {
        setStep('totp');
        setTotpCode('');
      } else if (apiError.code === 'TWO_FACTOR_REQUIRED' && step === 'directory-totp') {
        setTotpCode('');
        setError(null);
      } else {
        setError(apiError);
      }
    } finally {
      setBusy(false);
    }
  }

  function returnToCredentials() {
    if (step === 'directory-totp') setDirectoryTicket('');
    setStep('credentials');
    setTotpCode('');
    setError(null);
  }

  const copy =
    step === 'credentials'
      ? {
          eyebrow: t('login.employeeAccess'),
          subtitle: t('login.subtitle'),
          title: t('login.openWorkspace'),
        }
      : {
          eyebrow: t('login.stepTwo'),
          subtitle:
            step === 'directory-totp'
              ? t('login.directoryVerifySubtitle')
              : t('login.verifySubtitle'),
          title: t('login.verifyTitle'),
        };

  return (
    <main className="login-page">
      <div className="login-language-control">
        <LanguageSwitcher placement="login" />
      </div>
      <section className="login-context" aria-label={messages.product.name}>
        <VistaMark product="Vista Service" />
      </section>

      <section className="login-form-pane">
        <div className="login-form-wrap">
          <header className="login-card-context">
            <span className="login-product-icon" aria-hidden="true">
              <Icon name="organization" size={25} />
            </span>
            <span>
              <small>{t('product.suite')}</small>
              <strong>{messages.product.name}</strong>
            </span>
            {step !== 'credentials' ? <em>{copy.eyebrow}</em> : null}
          </header>
          <h2>{copy.title}</h2>
          <p className="login-form-subtitle">{copy.subtitle}</p>

          <form className="login-form" onSubmit={(event) => void submit(event)}>
            {error ? (
              <InlineAlert title={t('login.failed')} tone="error">
                <p>{errorMessage(error.code, t)}</p>
                {error.correlationId ? (
                  <small>
                    {t('login.reference')}{' '}
                    <TechnicalIdentifier kind="signInRequest" value={error.correlationId} />
                  </small>
                ) : null}
              </InlineAlert>
            ) : null}

            {step === 'credentials' ? (
              <>
                {(directoryOptions?.method === 'oidc' || directoryOptions?.method === 'saml') &&
                !emergencyMode ? (
                  <div className="login-directory-option">
                    <p>{t('login.directoryHelp')}</p>
                    <Button
                      busy={busy}
                      busyLabel={t('login.signingIn')}
                      fullWidth
                      onClick={() => {
                        setBusy(true);
                        setError(null);
                        void startDirectoryLogin({ app: 'operations' })
                          .then(({ authorizationUrl }) =>
                            globalThis.location.assign(authorizationUrl),
                          )
                          .catch((caught: unknown) =>
                            setError(
                              caught instanceof ApiClientError
                                ? caught
                                : new ApiClientError(messages.errors.default, 'REQUEST_FAILED', 0),
                            ),
                          )
                          .finally(() => setBusy(false));
                      }}
                      type="button"
                      variant="secondary"
                    >
                      {t('login.directoryContinue')}
                    </Button>
                  </div>
                ) : null}
                {directoryOptions?.emergencyAccessAvailable ? (
                  <label className="login-emergency-option">
                    <input
                      checked={emergencyMode}
                      onChange={(event) => setEmergencyMode(event.target.checked)}
                      type="checkbox"
                    />
                    <span>{t('login.emergencyAccess')}</span>
                  </label>
                ) : null}
                {!directoryOptions?.enabled ||
                directoryOptions.method === 'ldap' ||
                emergencyMode ? (
                  <>
                    <TextField
                      autoComplete="username"
                      autoFocus
                      id="email"
                      label={t('login.workEmail')}
                      maxLength={320}
                      name="email"
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder={messages.auth.emailPlaceholder}
                      required
                      type="email"
                      value={email}
                    />
                    <TextField
                      autoComplete="current-password"
                      id="password"
                      label={t('login.password')}
                      maxLength={128}
                      name="password"
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      trailingAction={
                        <button
                          aria-label={showPassword ? t('login.hide') : t('login.show')}
                          onClick={() => setShowPassword((visible) => !visible)}
                          type="button"
                        >
                          {showPassword ? t('login.hide') : t('login.show')}
                        </button>
                      }
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                    />
                    {emergencyMode ? (
                      <TextField
                        autoComplete="off"
                        id="emergency-access-reason"
                        label={t('login.emergencyReason')}
                        maxLength={500}
                        minLength={8}
                        onChange={(event) => setEmergencyReason(event.target.value)}
                        required
                        value={emergencyReason}
                        hint={t('login.emergencyReasonHint')}
                      />
                    ) : null}
                  </>
                ) : null}
              </>
            ) : (
              <>
                <div className="login-account-summary">
                  <span>{email.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{email}</strong>
                    <small>
                      {step === 'directory-totp'
                        ? t('login.directoryVerified')
                        : t('login.credentialsVerified')}
                    </small>
                  </div>
                </div>
                <TextField
                  autoComplete="one-time-code"
                  autoFocus
                  hint={t('login.codeHint')}
                  id="totp-code"
                  inputMode="numeric"
                  label={t('login.code')}
                  maxLength={6}
                  name="totpCode"
                  onChange={(event) =>
                    setTotpCode(event.target.value.replace(/\D/gu, '').slice(0, 6))
                  }
                  pattern="[0-9]{6}"
                  required
                  value={totpCode}
                />
              </>
            )}

            {step !== 'credentials' ||
            !directoryOptions?.enabled ||
            directoryOptions.method === 'ldap' ||
            emergencyMode ? (
              <Button
                busy={busy}
                busyLabel={step === 'credentials' ? t('login.signingIn') : t('login.verifying')}
                fullWidth
                type="submit"
              >
                {step === 'credentials' ? t('login.signIn') : t('login.verify')}
              </Button>
            ) : null}
            {step !== 'credentials' ? (
              <Button fullWidth onClick={returnToCredentials} variant="quiet">
                {t('login.back')}
              </Button>
            ) : null}
          </form>

          <p className="login-support">
            {t('login.needHelp')} <Link to="/recover">{t('login.recovery')}</Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function errorMessage(code: string, t: ReturnType<typeof useLocalization>['t']): string {
  const keys = {
    ACCOUNT_TEMPORARILY_LOCKED: 'login.error.locked',
    AUTHENTICATION_FAILED: 'login.error.authentication',
    DIRECTORY_SIGN_IN_FAILED: 'login.error.directory',
    DIRECTORY_SIGN_IN_UNAVAILABLE: 'login.error.directoryUnavailable',
    DIRECTORY_UNAVAILABLE: 'login.error.directoryUnavailable',
    PASSWORD_EXPIRED: 'login.error.expired',
    RATE_LIMITED: 'login.error.rate',
    TWO_FACTOR_ENROLLMENT_REQUIRED: 'login.error.enrollment',
    UNAVAILABLE: 'login.error.unavailable',
  } as const;
  return t(keys[code as keyof typeof keys] ?? 'login.error.default');
}
