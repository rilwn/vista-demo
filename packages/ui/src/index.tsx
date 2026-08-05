import type { PropsWithChildren, ReactNode } from 'react';

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
