import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { financialDocumentMessages as copy } from '../i18n/legacyMessages';

export function DocumentDrawer({
  busy,
  backLabel = copy.back,
  className = '',
  children,
  onBack,
  subtitle,
  title,
}: {
  busy: boolean;
  backLabel?: string;
  className?: string;
  children: ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-layer">
      <button
        aria-label={backLabel}
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className={`security-drawer is-wide financial-document-drawer ${className}`}
        role="dialog"
      >
        <header className="panel-drawer-header financial-document-drawer-header">
          <button
            aria-label={backLabel}
            className="panel-back-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="arrow" size={17} />
            {backLabel === copy.back ? 'Back' : backLabel}
          </button>
          <button
            aria-label={copy.close}
            className="panel-close-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="close" />
          </button>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}
