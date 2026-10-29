import { type FormEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './admin-drawer.css';

/** A viewport-owned panel with one scroll region and actions outside it. */
export function AdminDrawer({
  ariaLabel,
  backLabel,
  backText,
  busy = false,
  children,
  className = '',
  closeLabel,
  eyebrow,
  footer,
  onClose,
  onSubmit,
  subtitle,
  title,
  wide = false,
}: {
  ariaLabel?: string | undefined;
  backLabel: string;
  backText: string;
  busy?: boolean;
  children: ReactNode;
  className?: string;
  closeLabel: string;
  eyebrow?: string;
  footer?: ReactNode;
  onClose: () => void;
  onSubmit?: ((event: FormEvent<HTMLFormElement>) => void) | undefined;
  subtitle?: string | undefined;
  title: string;
  wide?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const focusFormField = useRef(Boolean(onSubmit));
  const headingId = useId();
  useEffect(() => {
    const trigger = document.activeElement;
    const root = document.getElementById('root');
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    (
      (focusFormField.current
        ? panel.current?.querySelector<HTMLElement>(
            'input:not([type="hidden"]):not([type="checkbox"]):not(:disabled), textarea:not(:disabled)',
          )
        : null) ?? panel.current?.querySelector<HTMLElement>('.panel-back-button')
    )?.focus();
    return () => {
      if (root) root.inert = wasInert;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  const content = (
    <>
      <header className="admin-drawer-header">
        <div className="admin-drawer-navigation">
          <button
            className="panel-back-button"
            aria-label={backLabel}
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} />
            {backText}
          </button>
          <button
            className="panel-close-button"
            aria-label={closeLabel}
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h2 id={headingId}>{title}</h2>
        {subtitle ? <p className="admin-drawer-subtitle">{subtitle}</p> : null}
      </header>
      <div className="admin-drawer-body">{children}</div>
      {footer ? <footer className="admin-drawer-footer">{footer}</footer> : null}
    </>
  );

  return createPortal(
    <div className="security-drawer-layer admin-drawer-layer">
      <button
        className="security-drawer-scrim"
        aria-label={closeLabel}
        disabled={busy}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <aside
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : headingId}
        aria-modal="true"
        className={`admin-drawer${wide ? ' is-wide' : ''} ${className}`}
        ref={panel}
        role="dialog"
        onKeyDown={(event) => {
          if (event.defaultPrevented) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onClose();
          }
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
            ),
          ).filter(
            (element) =>
              element.tabIndex >= 0 &&
              !element.hidden &&
              element.getAttribute('aria-hidden') !== 'true' &&
              !element.closest('[hidden]'),
          );
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {onSubmit ? (
          <form className="admin-drawer-layout" onSubmit={onSubmit}>
            {content}
          </form>
        ) : (
          <div className="admin-drawer-layout">{content}</div>
        )}
      </aside>
    </div>,
    document.body,
  );
}
