import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from 'react';

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
