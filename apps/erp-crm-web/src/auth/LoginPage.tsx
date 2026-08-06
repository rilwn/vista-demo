import { Button, InlineAlert, TextField, VistaMark } from '@vista/ui';
import { type FormEvent, useState } from 'react';

import { ApiClientError } from '../api/auth';
import { Icon } from '../components/Icon';
import { messages } from '../messages';
import { Navigate, useRouter } from '../routing/Router';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const { login, status } = useAuth();
  const { location, navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);

  if (status === 'checking') {
    return (
      <main className="full-page-loader" aria-live="polite">
        <span className="loader-mark" aria-hidden="true">
          VS
        </span>
        <strong>{messages.states.loading}</strong>
        <p>{messages.states.loadingDetail}</p>
      </main>
    );
  }
  if (status === 'authenticated') {
    return <Navigate replace to={returnPath(location.state)} />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password, ...(step === 'totp' ? { totpCode } : {}) });
      navigate(returnPath(location.state), { replace: true });
    } catch (caught) {
      const apiError =
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(messages.errors.default, 'REQUEST_FAILED', 0);
      if (apiError.code === 'TWO_FACTOR_REQUIRED' && step === 'credentials') {
        setStep('totp');
        setTotpCode('');
      } else {
        setError(apiError);
      }
    } finally {
      setBusy(false);
    }
  }

  function returnToCredentials() {
    setStep('credentials');
    setTotpCode('');
    setError(null);
  }

  const copy =
    step === 'credentials'
      ? {
          eyebrow: messages.auth.credentialsEyebrow,
          subtitle: messages.auth.credentialsSubtitle,
          title: messages.auth.credentialsTitle,
        }
      : {
          eyebrow: messages.auth.totpEyebrow,
          subtitle: messages.auth.totpSubtitle,
          title: messages.auth.totpTitle,
        };

  return (
    <main className="login-page">
      <section className="login-context" aria-label={messages.product.name}>
        <VistaMark product={messages.product.name} />
        <div className="login-context-copy">
          <p className="login-context-eyebrow">{messages.authContext.eyebrow}</p>
          <h1>{messages.authContext.title}</h1>
          <p>{messages.authContext.subtitle}</p>
          <ul>
            {messages.authContext.modules.map((module) => (
              <li key={module}>
                <span aria-hidden="true" />
                {module}
              </li>
            ))}
          </ul>
        </div>
        <p className="login-context-security">
          <Icon name="shield" size={17} />
          {messages.auth.securityNote}
        </p>
      </section>

      <section className="login-form-pane">
        <div className="login-mobile-brand">
          <VistaMark product={messages.product.name} />
        </div>
        <div className="login-form-wrap">
          <div className="login-step" aria-hidden="true">
            <span className="is-complete" />
            <span className={step === 'totp' ? 'is-complete' : ''} />
          </div>
          <p className="page-eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
          <p className="login-form-subtitle">{copy.subtitle}</p>

          <form className="login-form" onSubmit={(event) => void submit(event)}>
            {error ? (
              <InlineAlert title={messages.auth.errorTitle} tone="error">
                <p>{errorMessage(error.code)}</p>
                {error.correlationId ? (
                  <small>
                    {messages.auth.errorReference}: {error.correlationId.slice(0, 12)}
                  </small>
                ) : null}
              </InlineAlert>
            ) : null}

            {step === 'credentials' ? (
              <>
                <TextField
                  autoComplete="username"
                  autoFocus
                  hint={messages.auth.emailHint}
                  id="email"
                  label={messages.auth.emailLabel}
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
                  label={messages.auth.passwordLabel}
                  maxLength={128}
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  trailingAction={
                    <button
                      aria-label={
                        showPassword ? messages.auth.hidePassword : messages.auth.showPassword
                      }
                      onClick={() => setShowPassword((visible) => !visible)}
                      type="button"
                    >
                      {showPassword ? messages.auth.hidePassword : messages.auth.showPassword}
                    </button>
                  }
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
              </>
            ) : (
              <>
                <div className="login-account-summary">
                  <span>{email.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{email}</strong>
                    <small>{messages.auth.credentialsVerified}</small>
                  </div>
                </div>
                <TextField
                  autoComplete="one-time-code"
                  autoFocus
                  hint={messages.auth.totpHint}
                  id="totp-code"
                  inputMode="numeric"
                  label={messages.auth.totpLabel}
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

            <Button
              busy={busy}
              busyLabel={step === 'credentials' ? messages.auth.signingIn : messages.auth.verifying}
              fullWidth
              type="submit"
            >
              {step === 'credentials' ? messages.auth.signIn : messages.auth.verify}
            </Button>
            {step === 'totp' ? (
              <Button fullWidth onClick={returnToCredentials} variant="quiet">
                {messages.auth.back}
              </Button>
            ) : null}
          </form>

          <p className="login-support">{messages.auth.support}</p>
        </div>
      </section>
    </main>
  );
}

function errorMessage(code: string): string {
  return messages.errors[code as keyof typeof messages.errors] ?? messages.errors.default;
}

function returnPath(state: unknown): string {
  if (
    state &&
    typeof state === 'object' &&
    'from' in state &&
    typeof state.from === 'string' &&
    state.from.startsWith('/') &&
    !state.from.startsWith('//')
  ) {
    return state.from;
  }
  return '/';
}
