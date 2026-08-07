import { VistaMark } from '@vista/ui';
import { type PropsWithChildren, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { allModuleItems, navigationGroups } from '../navigation';
import { messages } from '../messages';
import { Link, useRouter } from '../routing/Router';

export function WorkspaceLayout({ children }: PropsWithChildren) {
  const { hasPermission, logout, session } = useAuth();
  const { location } = useRouter();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => setNavigationOpen(false), [location.pathname]);

  const visibleGroups = useMemo(
    () =>
      navigationGroups
        .map((group) => ({
          ...group,
          modules: group.modules.filter((module) => hasPermission(module.key)),
        }))
        .filter((group) => group.modules.length > 0),
    [hasPermission],
  );

  if (!session) return null;

  const currentTitle =
    location.pathname === '/access'
      ? messages.navigation.access
      : (allModuleItems.find(
          (item) =>
            location.pathname === item.path ||
            (item.path.startsWith('/modules/') && location.pathname.startsWith(`${item.path}/`)),
        )?.label ?? messages.navigation.overview);
  const initials = getInitials(session.context.displayName);

  async function signOut() {
    setSigningOut(true);
    await logout();
  }

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-content">
        {messages.navigation.skip}
      </a>
      <button
        aria-label={messages.navigation.close}
        className={`navigation-scrim${navigationOpen ? ' is-open' : ''}`}
        onClick={() => setNavigationOpen(false)}
        type="button"
      />
      <aside className={`workspace-sidebar${navigationOpen ? ' is-open' : ''}`}>
        <div className="sidebar-brand">
          <VistaMark product={messages.product.name} />
          <button
            aria-label={messages.navigation.close}
            className="sidebar-close"
            onClick={() => setNavigationOpen(false)}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>

        <nav aria-label={messages.navigation.primaryLabel} className="sidebar-navigation">
          <NavigationSection label={messages.navigation.workspace}>
            <SidebarLink icon="home" label={messages.navigation.overview} to="/" />
          </NavigationSection>
          {visibleGroups.map((group) => (
            <NavigationSection key={group.label} label={group.label}>
              {group.modules.map((module) => (
                <SidebarLink
                  icon={module.icon}
                  key={module.key}
                  label={module.label}
                  to={module.path}
                />
              ))}
            </NavigationSection>
          ))}
        </nav>

        <div className="sidebar-account">
          <Link className="account-link" to="/access">
            <span className="account-avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="account-copy">
              <strong>{session.context.displayName}</strong>
              <small>
                {session.context.isAdministrative
                  ? messages.home.adminAccess
                  : messages.home.standardAccess}
              </small>
            </span>
          </Link>
          <button
            aria-label={messages.navigation.signOut}
            className="account-logout"
            disabled={signingOut}
            onClick={() => void signOut()}
            type="button"
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>

      <div className="workspace-frame">
        <header className="workspace-topbar">
          <button
            aria-expanded={navigationOpen}
            aria-label={messages.navigation.menu}
            className="mobile-menu"
            onClick={() => setNavigationOpen(true)}
            type="button"
          >
            <Icon name="menu" />
          </button>
          <div className="topbar-context">
            <span>{messages.product.suite}</span>
            <strong>{currentTitle}</strong>
          </div>
          <div className="topbar-actions">
            <span className="topbar-session-state">
              <Icon name="shield" size={15} />
              Secure session
            </span>
            <Link aria-label="Open my access" className="topbar-account" to="/access">
              <span className="account-avatar" aria-hidden="true">
                {initials}
              </span>
              <span>{session.context.displayName}</span>
            </Link>
          </div>
        </header>
        <main className="workspace-content" id="workspace-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
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
  icon,
  label,
  to,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  to: string;
}) {
  return (
    <Link className={({ isActive }) => (isActive ? 'is-active' : undefined)} end to={to}>
      <Icon name={icon} />
      <span>{label}</span>
    </Link>
  );
}

function getInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
