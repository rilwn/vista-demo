import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from 'react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

export { SearchableSelects } from './searchable-selects';

export interface AppShellProps extends PropsWithChildren {
  eyebrow: string;
  status?: ReactNode;
  subtitle: string;
  title: string;
}

export function AppShell({ children, eyebrow, status, subtitle, title }: AppShellProps) {
  return (
    <div className="vista-shell">
      <header className="vista-header">
        <div>
          <p className="vista-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="vista-subtitle">{subtitle}</p>
        </div>
        {status ? <div className="vista-header-status">{status}</div> : null}
      </header>
      <main className="vista-main">{children}</main>
    </div>
  );
}

export interface StatusCardProps {
  description: string;
  label: string;
  tone?: 'neutral' | 'positive' | 'warning';
  value: string;
}

export function StatusCard({ description, label, tone = 'neutral', value }: StatusCardProps) {
  return (
    <section className={`vista-card vista-card--${tone}`} aria-label={label}>
      <p className="vista-card-label">{label}</p>
      <p className="vista-card-value">{value}</p>
      <p className="vista-card-description">{description}</p>
    </section>
  );
}

export interface VistaMarkProps {
  compact?: boolean;
  product?: string;
}

export function VistaMark({ compact = false, product = 'Vista Service' }: VistaMarkProps) {
  return (
    <div className="vista-mark" aria-label={compact ? product : undefined}>
      <span className="vista-mark-symbol" aria-hidden="true">
        <svg
          fill="none"
          shapeRendering="geometricPrecision"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.35"
          viewBox="0 0 32 32"
        >
          <path d="M6.5 8.5 14 23.25 25.5 7" />
          <path d="m12.5 8.5 5.25 10.25L25.5 7" />
          <circle cx="25.5" cy="7" r="1.7" />
        </svg>
      </span>
      {compact ? null : (
        <span className="vista-mark-copy">
          <strong>{product}</strong>
          <small>Vista workspace</small>
        </span>
      )}
    </div>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
  busyLabel?: string;
  fullWidth?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
}

export function Button({
  busy = false,
  busyLabel = 'Please wait',
  children,
  className = '',
  disabled,
  fullWidth = false,
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  const classes = [
    'vista-button',
    `vista-button--${variant}`,
    fullWidth ? 'vista-button--full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button {...props} className={classes} disabled={disabled || busy} type={type} aria-busy={busy}>
      {busy ? <span className="vista-spinner" aria-hidden="true" /> : null}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  hint?: string;
  label: string;
  trailingAction?: ReactNode;
}

export function TextField({
  className = '',
  error,
  hint,
  id,
  label,
  trailingAction,
  ...props
}: TextFieldProps) {
  if (!id) {
    throw new Error('TextField requires an id');
  }

  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const classes = [
    'vista-field-input',
    trailingAction ? 'vista-field-input--action' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`vista-field${error ? ' vista-field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="vista-field-control">
        <input
          {...props}
          id={id}
          className={classes}
          aria-describedby={descriptionId}
          aria-invalid={Boolean(error)}
        />
        {trailingAction ? <div className="vista-field-action">{trailingAction}</div> : null}
      </div>
      {error ? (
        <p className="vista-field-message" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="vista-field-message" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InlineAlertProps extends PropsWithChildren {
  title?: string;
  tone?: 'error' | 'info' | 'success' | 'warning';
}

export function InlineAlert({ children, title, tone = 'info' }: InlineAlertProps) {
  return (
    <div
      className={`vista-alert vista-alert--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className="vista-alert-marker" aria-hidden="true" />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export interface ToastProps extends PropsWithChildren {
  durationMs?: number;
  onDismiss?: () => void;
  title?: string;
  tone?: 'error' | 'info' | 'success' | 'warning';
}

/** A short-lived message for completed actions and other page-level feedback. */
export function Toast({
  children,
  durationMs = 5200,
  onDismiss,
  title,
  tone = 'info',
}: ToastProps) {
  const [visible, setVisible] = useState(true);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    setVisible(true);
    if (durationMs <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setVisible(false);
      onDismissRef.current?.();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [children, durationMs]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  return (
    <aside
      aria-atomic="true"
      className={`vista-toast vista-toast--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className="vista-toast-icon" aria-hidden="true">
        <ToastIcon tone={tone} />
      </span>
      <div className="vista-toast-copy">
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
      <button aria-label="Dismiss message" onClick={dismiss} type="button">
        <svg
          aria-hidden="true"
          fill="none"
          shapeRendering="geometricPrecision"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
          viewBox="0 0 20 20"
        >
          <path d="m5.5 5.5 9 9m0-9-9 9" />
        </svg>
      </button>
      {durationMs > 0 ? (
        <span
          className="vista-toast-timer"
          style={{ animationDuration: `${durationMs}ms` }}
          aria-hidden="true"
        />
      ) : null}
    </aside>
  );
}

function ToastIcon({ tone }: { tone: NonNullable<ToastProps['tone']> }) {
  if (tone === 'success') {
    return (
      <svg
        fill="none"
        shapeRendering="geometricPrecision"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
      >
        <path d="m6.5 12 3.4 3.5L17.8 8" />
      </svg>
    );
  }
  if (tone === 'error') {
    return (
      <svg
        fill="none"
        shapeRendering="geometricPrecision"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
      >
        <path d="M12 8v5m0 3.1v.1" />
        <circle cx="12" cy="12" r="8.5" />
      </svg>
    );
  }
  if (tone === 'warning') {
    return (
      <svg
        fill="none"
        shapeRendering="geometricPrecision"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
      >
        <path d="M12 8v5m0 3.1v.1M4.6 18.5 12 5l7.4 13.5z" />
      </svg>
    );
  }
  return (
    <svg
      fill="none"
      shapeRendering="geometricPrecision"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      <path d="M12 10.5v6m0-9.2v.2" />
      <circle cx="12" cy="12" r="8.5" />
    </svg>
  );
}

export interface BrowserSignInInput {
  email: string;
  password: string;
  totpCode?: string;
}

export interface AuthenticationFormProps {
  applicationName: string;
  eyebrow: string;
  errorMessage: (error: unknown) => string;
  onAuthenticate: (input: BrowserSignInInput) => Promise<void>;
  subtitle: string;
  supportText: string;
  variant?: 'operations' | 'pos' | 'recovery';
}

/** A restrained, shared sign-in surface for each separately hosted Vista app. */
export function AuthenticationForm({
  applicationName,
  eyebrow,
  errorMessage,
  onAuthenticate,
  subtitle,
  supportText,
  variant = 'operations',
}: AuthenticationFormProps) {
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials');
  const [totpCode, setTotpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const credentialTitle =
    variant === 'pos'
      ? 'Open the counter'
      : variant === 'recovery'
        ? 'Open recovery centre'
        : 'Open your workspace';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onAuthenticate({ email, password, ...(step === 'totp' ? { totpCode } : {}) });
    } catch (caught) {
      if (errorCode(caught) === 'TWO_FACTOR_REQUIRED' && step === 'credentials') {
        setStep('totp');
        setTotpCode('');
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`vista-auth-page vista-auth-page--${variant}`}>
      <section className="vista-auth-context" aria-label={applicationName}>
        <VistaMark product="Vista Service" />
      </section>
      <section className="vista-auth-panel">
        <div className="vista-auth-panel-inner">
          <header className="vista-auth-card-context">
            <span className="vista-auth-product-icon" aria-hidden="true">
              <AuthProductIcon variant={variant} />
            </span>
            <span>
              <small>{eyebrow}</small>
              <strong>{applicationName}</strong>
            </span>
            {step === 'totp' ? <em>Step 2</em> : null}
          </header>
          <h2>{step === 'credentials' ? credentialTitle : 'Confirm your sign-in'}</h2>
          <p>
            {step === 'credentials'
              ? subtitle
              : 'Enter the current six-digit code from your authenticator app.'}
          </p>
          <form className="vista-auth-form" onSubmit={(event) => void submit(event)}>
            {error ? (
              <InlineAlert tone="error">
                <p>{error}</p>
              </InlineAlert>
            ) : null}
            {step === 'credentials' ? (
              <>
                <TextField
                  autoComplete="username"
                  autoFocus
                  id="work-email"
                  label="Work email"
                  maxLength={320}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
                <TextField
                  autoComplete="current-password"
                  id="work-password"
                  label="Password"
                  maxLength={128}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  trailingAction={
                    <button
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((current) => !current)}
                      type="button"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  }
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
              </>
            ) : (
              <>
                <div className="vista-auth-account">
                  <span aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
                  <strong>{email}</strong>
                </div>
                <TextField
                  autoComplete="one-time-code"
                  autoFocus
                  id="authentication-code"
                  inputMode="numeric"
                  label="Authentication code"
                  maxLength={6}
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
              busyLabel={step === 'credentials' ? 'Signing in' : 'Verifying'}
              fullWidth
              type="submit"
            >
              {step === 'credentials' ? 'Sign in' : 'Verify and continue'}
            </Button>
            {step === 'totp' ? (
              <Button
                disabled={busy}
                fullWidth
                onClick={() => {
                  setError('');
                  setStep('credentials');
                  setTotpCode('');
                }}
                variant="quiet"
              >
                Use a different account
              </Button>
            ) : null}
          </form>
          <small className="vista-auth-support">{supportText}</small>
        </div>
      </section>
    </main>
  );
}

function AuthProductIcon({
  variant,
}: {
  variant: NonNullable<AuthenticationFormProps['variant']>;
}) {
  return (
    <svg
      fill="none"
      shapeRendering="geometricPrecision"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 32 32"
    >
      {variant === 'pos' ? (
        <>
          <path d="M6.5 8.5h19v15h-19zM6.5 13h19" />
          <path d="M10.5 18h5m5 0h1" />
        </>
      ) : variant === 'recovery' ? (
        <>
          <path d="M16 4.5 25 8v7.3c0 5.7-3.8 9.7-9 12.2-5.2-2.5-9-6.5-9-12.2V8z" />
          <path d="m11.5 16 3 3 6.2-7" />
        </>
      ) : (
        <>
          <path d="M6 7h20v18H6zM6 12h20" />
          <path d="M11 17h4m-4 4h9" />
        </>
      )}
    </svg>
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}
