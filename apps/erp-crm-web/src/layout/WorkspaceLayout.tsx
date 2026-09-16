import { type PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react';
import { Help } from '@vista/ui';

import { useAuth } from '../auth/AuthProvider';
import { GlobalNavigationSearch } from '../components/GlobalNavigationSearch';
import { Icon } from '../components/Icon';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { NotificationCenter } from '../components/NotificationCenter';
import { localizeModule, moduleLabel, navigationGroupLabel } from '../i18n/navigation';
import { useLocalization } from '../i18n/LocalizationProvider';
import { allModuleItems, navigationGroups } from '../navigation';
import { messages } from '../messages';
import { Link, useRouter } from '../routing/Router';

export function WorkspaceLayout({ children }: PropsWithChildren) {
  const { hasPermission, logout, session } = useAuth();
  const { t } = useLocalization();
  const { location } = useRouter();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => setNavigationOpen(false), [location.pathname]);

  const visibleGroups = useMemo(
    () =>
      navigationGroups
        .map((group) => ({
          ...group,
          label: navigationGroupLabel(group.label, t),
          modules: group.modules
            .filter((module) => hasPermission(module.key))
            .map((module) => localizeModule(module, t)),
        }))
        .filter((group) => group.modules.length > 0),
    [hasPermission, t],
  );

  if (!session) return null;

  const pageParent = nestedPageParent(location.pathname);
  const initials = getInitials(session.context.displayName);

  async function signOut() {
    setSigningOut(true);
    await logout();
  }

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">
        {t('navigation.skip')}
      </a>
      <button
        aria-label={t('navigation.close')}
        className={`navigation-scrim${navigationOpen ? ' is-open' : ''}`}
        onClick={() => setNavigationOpen(false)}
        type="button"
      />
      <aside className={`workspace-sidebar${navigationOpen ? ' is-open' : ''}`}>
        <div className="sidebar-brand">
          <Link
            aria-label={`${messages.product.name} overview`}
            className="sidebar-brand-link"
            to="/"
          >
            <span className="sidebar-brand-icon" aria-hidden="true">
              <Icon name="brand" size={25} />
            </span>
            <span className="sidebar-brand-copy">
              <strong>{messages.product.name}</strong>
              <small>{t('product.workspace')}</small>
            </span>
          </Link>
          <button
            aria-label={t('navigation.close')}
            className="sidebar-close"
            onClick={() => setNavigationOpen(false)}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <nav aria-label={t('navigation.primary')} className="sidebar-navigation">
          <NavigationSection label={t('navigation.workspace')}>
            <SidebarLink end icon="home" label={t('navigation.overview')} to="/" />
          </NavigationSection>
          {visibleGroups.map((group) => (
            <NavigationSection key={group.label} label={group.label}>
              {group.modules.map((module) => (
                <SidebarLink
                  aliases={sidebarAliases(module.key)}
                  icon={module.icon}
                  key={`${module.key}:${module.path}`}
                  label={module.label}
                  to={module.path}
                />
              ))}
            </NavigationSection>
          ))}
        </nav>

        <div className="sidebar-footer">
          <Link className="sidebar-profile-card" to="/access">
            <span className="account-avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="account-copy">
              <strong>{session.context.displayName}</strong>
              <small>{t('account.security')}</small>
            </span>
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </aside>

      <div className="workspace-frame">
        <header className="workspace-topbar">
          <button
            aria-expanded={navigationOpen}
            aria-label={t('navigation.open')}
            className="mobile-menu"
            onClick={() => setNavigationOpen(true)}
            type="button"
          >
            <Icon name="menu" />
          </button>
          <GlobalNavigationSearch />
          <div className="topbar-actions">
            <Help
              app="operations"
              modules={session.context.permissions
                .filter((item) => item.action === 'view')
                .map((item) => item.module)}
            />
            <LanguageSwitcher />
            <NotificationCenter />
            <AccountMenu
              administrative={session.context.isAdministrative}
              displayName={session.context.displayName}
              email={session.context.email}
              hasPermission={hasPermission}
              initials={initials}
              onLogout={() => void signOut()}
              signingOut={signingOut}
            />
          </div>
        </header>
        <main className="workspace-content" id="workspace-content" tabIndex={-1}>
          {pageParent ? (
            <nav aria-label="Page navigation" className="workspace-page-navigation">
              <Link
                aria-label={t('navigation.backTo', {
                  area: moduleLabel(pageParent.key, t),
                })}
                className="workspace-back-link"
                to={pageParent.to}
              >
                <Icon name="arrow" size={16} />
                <span>{t('navigation.backTo', { area: moduleLabel(pageParent.key, t) })}</span>
              </Link>
            </nav>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

function AccountMenu({
  administrative,
  displayName,
  email,
  hasPermission,
  initials,
  onLogout,
  signingOut,
}: {
  administrative: boolean;
  displayName: string;
  email: string;
  hasPermission: (module: string, action?: string) => boolean;
  initials: string;
  onLogout: () => void;
  signingOut: boolean;
}) {
  const { location } = useRouter();
  const { t } = useLocalization();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open]);

  return (
    <div className="topbar-account-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('account.openMenu')}
        className="topbar-account-trigger"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <span className="account-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="topbar-account-copy">
          <strong>{displayName}</strong>
          <small>{administrative ? t('account.administrative') : t('account.standard')}</small>
        </span>
        <Icon name="chevron" size={16} />
      </button>

      {open ? (
        <div aria-label={t('account.menu')} className="account-menu-popover" role="menu">
          <header>
            <span className="account-avatar" aria-hidden="true">
              {initials}
            </span>
            <div>
              <strong>{displayName}</strong>
              <small>{email}</small>
            </div>
          </header>
          <nav aria-label={t('account.destinations')}>
            <AccountMenuLink icon="profile" label={t('account.myAccess')} to="/access" />
            <AccountMenuLink icon="home" label={t('navigation.overview')} to="/" />
            {hasPermission('platform') ? (
              <AccountMenuLink icon="shield" label={t('account.securityAdmin')} to="/security" />
            ) : null}
            {hasPermission('platform.organization') ? (
              <AccountMenuLink
                icon="organization"
                label={t('account.organizationSettings')}
                to="/organization"
              />
            ) : null}
            {hasPermission('platform') ? (
              <AccountMenuLink
                icon="activity"
                label={t('account.systemActivity')}
                to="/operations"
              />
            ) : null}
          </nav>
          <footer>
            <button
              disabled={signingOut}
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              role="menuitem"
              type="button"
            >
              <Icon name="logout" size={17} />
              <span>{signingOut ? t('account.signingOut') : t('account.signOut')}</span>
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

function AccountMenuLink({
  icon,
  label,
  to,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  to: string;
}) {
  return (
    <Link role="menuitem" to={to}>
      <Icon name={icon} size={17} />
      <span>{label}</span>
      <Icon name="arrow" size={15} />
    </Link>
  );
}

function nestedPageParent(pathname: string): { key: string; to: string } | null {
  const moduleMatch = /^\/modules\/([^/]+)\/[^/]+$/u.exec(pathname);
  if (moduleMatch?.[1]) {
    const module = allModuleItems.find((item) => item.key === moduleMatch[1]);
    if (module) return { key: module.key, to: module.path };
  }

  const moduleKey =
    pathname === '/partners'
      ? 'crm'
      : pathname === '/catalog' || pathname === '/catalog/categories'
        ? 'erp.warehouse'
        : null;
  if (moduleKey) {
    const module = allModuleItems.find((item) => item.key === moduleKey);
    if (module) return { key: module.key, to: module.path };
  }

  return pathname === '/access' ? { key: 'overview', to: '/' } : null;
}

function NavigationSection({ children, label }: PropsWithChildren<{ label: string }>) {
  return (
    <section className="navigation-section">
      <p>{label}</p>
      <div>{children}</div>
    </section>
  );
}

function SidebarLink({
  aliases = [],
  end = false,
  icon,
  label,
  to,
}: {
  aliases?: string[];
  end?: boolean;
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  to: string;
}) {
  const { location } = useRouter();
  const aliasActive = aliases.some(
    (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
  );
  return (
    <Link
      className={({ isActive }) => (isActive || aliasActive ? 'is-active' : undefined)}
      end={end}
      to={to}
    >
      <span className="sidebar-menu-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span>{label}</span>
    </Link>
  );
}

function sidebarAliases(module: string): string[] {
  if (module === 'crm') return ['/partners'];
  if (module === 'erp.warehouse') return ['/catalog'];
  return [];
}

function getInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
