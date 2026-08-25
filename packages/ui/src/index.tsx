import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from 'react';
import { type FormEvent, useState } from 'react';

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
        <span>V</span>
        <span>S</span>
      </span>
      {compact ? null : (
        <span className="vista-mark-copy">
          <strong>{product}</strong>
          <small>Business systems</small>
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
}

/** A restrained, shared sign-in surface for each separately hosted Vista app. */
export function AuthenticationForm({
  applicationName,
  eyebrow,
  errorMessage,
  onAuthenticate,
  subtitle,
  supportText,
}: AuthenticationFormProps) {
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials');
  const [totpCode, setTotpCode] = useState('');

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
    <main className="vista-auth-page">
      <section className="vista-auth-context" aria-label={applicationName}>
        <VistaMark product={applicationName} />
        <div>
          <p className="vista-auth-eyebrow">{eyebrow}</p>
          <h1>{applicationName}</h1>
          <p>{subtitle}</p>
        </div>
        <small>Individual employee access · Permission-controlled workspace</small>
      </section>
      <section className="vista-auth-panel">
        <div className="vista-auth-panel-inner">
          <p className="vista-eyebrow">
            {step === 'credentials' ? 'Employee access' : 'Step 2 of 2'}
          </p>
          <h2>{step === 'credentials' ? 'Sign in to continue' : 'Verify it is you'}</h2>
          <p>
            {step === 'credentials'
              ? 'Use the individual account assigned to you.'
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
                  type="password"
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

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}
