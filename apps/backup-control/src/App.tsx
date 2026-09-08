import { useBrowserSession } from '@vista/auth/browser-session';
import type { AuthenticationContextResponse, LoginRequest, LoginResponse } from '@vista/contracts';
import { AuthenticationForm, Button, SearchableSelects, VistaMark } from '@vista/ui';
import { useActiveItemVisibility } from '@vista/ui/navigation';
import { useState } from 'react';

import { ApiClientError, authenticate, getCurrentAccount, revokeSession } from './api/auth';
import { messages } from './messages';

type BackupScreen =
  'approvals' | 'audit' | 'dr-tests' | 'jobs' | 'overview' | 'policies' | 'sources';

const screens: Record<
  BackupScreen,
  { action: string; description: string; label: string; title: string }
> = {
  approvals: {
    title: 'Restore requests & approvals',
    label: 'Restores & approvals',
    action: 'Request restore',
    description:
      'Request file, database, server, or full-system restores and track their approvals.',
  },
  audit: {
    title: 'Alerts & audit',
    label: 'Alerts & audit',
    action: 'Configure notification',
    description:
      'Review backup and restore activity, failures, missed backups, and security alerts.',
  },
  'dr-tests': {
    title: 'Disaster recovery tests',
    label: 'DR tests',
    action: 'Plan DR test',
    description:
      'Plan test restores, compare results with RPO and RTO targets, and record follow-up actions.',
  },
  jobs: {
    title: 'Jobs & restore points',
    label: 'Jobs & restore points',
    action: 'Run verification',
    description:
      'Monitor scheduled backup execution, snapshots, copies, retention, verification, and errors.',
  },
  overview: {
    title: 'Backup operations',
    label: 'Overview',
    action: 'Review readiness',
    description:
      'Review protected systems, backup schedules, restore readiness, and items that need attention.',
  },
  policies: {
    title: 'Policies & schedules',
    label: 'Policies & schedules',
    action: 'Create policy',
    description:
      'Define approved full, incremental, differential, snapshot, image, retention, encryption, and storage policies.',
  },
  sources: {
    title: 'Sources & data inventory',
    label: 'Sources & inventory',
    action: 'Add source',
    description:
      'Inventory approved servers, workstations, devices, databases, files, email, cloud services, and their data classification.',
  },
};

const screenOrder: BackupScreen[] = [
  'overview',
  'jobs',
  'sources',
  'policies',
  'approvals',
  'dr-tests',
  'audit',
];

export function App() {
  return (
    <>
      <SearchableSelects />
      <Application />
    </>
  );
}

function Application() {
  const authentication = useBrowserSession<
    LoginRequest,
    LoginResponse,
    AuthenticationContextResponse
  >({
    authenticate,
    getCurrentAccount,
    isContextValid: isAuthenticationContext,
    revokeSession,
    storageKey: 'vista.backup-control.session.v1',
  });
  const session = authentication.session;

  if (authentication.status === 'checking') {
    return <ApplicationLoading label="Restoring backup access" />;
  }
  if (authentication.status === 'anonymous') {
    return (
      <AuthenticationForm
        applicationName="Vista Recovery"
        eyebrow="Backup and recovery"
        errorMessage={signInError}
        onAuthenticate={authentication.login}
        subtitle="Use your assigned recovery account."
        supportText="Need help? Contact your Vista Service administrator."
        variant="recovery"
      />
    );
  }
  if (!session) {
    return <ApplicationLoading label="Preparing backup access" />;
  }
  if (!hasBackupAccess(session.context)) {
    return <AccessUnavailable onSignOut={authentication.logout} />;
  }
  return (
    <BackupConsole employeeName={session.context.displayName} onSignOut={authentication.logout} />
  );
}

function BackupConsole({
  employeeName,
  onSignOut,
}: {
  employeeName: string;
  onSignOut: () => Promise<void>;
}) {
  const [screen, setScreen] = useState<BackupScreen>('overview');
  const active = screens[screen];
  const navigation = useActiveItemVisibility<HTMLElement>(screen);

  return (
    <div className="backup-console">
      <aside className="backup-sidebar">
        <div className="backup-brand">
          <span>
            <BackupIcon name="brand" />
          </span>
          <div>
            <strong>Vista Recovery</strong>
            <small>Backup & recovery</small>
          </div>
        </div>
        <div className="backup-posture">
          <span className="backup-risk-dot" />
          <div>
            <small>System status</small>
            <strong>{messages.status}</strong>
          </div>
        </div>
        <nav aria-label="Backup control navigation" ref={navigation}>
          {screenOrder.map((item) => (
            <button
              aria-current={screen === item ? 'page' : undefined}
              className={screen === item ? 'is-active' : undefined}
              key={item}
              onClick={() => {
                setScreen(item);
              }}
              type="button"
            >
              <span className="backup-menu-icon" aria-hidden="true">
                <BackupIcon name={screenIcon(item)} />
              </span>
              {screens[item].label}
            </button>
          ))}
        </nav>
        <p className="backup-sidebar-note">
          Critical changes and destructive restores require approval from a second authorised
          person.
        </p>
      </aside>
      <main className="backup-main">
        <header className="backup-topbar">
          <label className="backup-area-picker">
            <span>{messages.chooseArea}</span>
            <select
              aria-label={messages.chooseArea}
              value={screen}
              onChange={(event) => setScreen(event.target.value as BackupScreen)}
            >
              {screenOrder.map((item) => (
                <option key={item} value={item}>
                  {screens[item].label}
                </option>
              ))}
            </select>
          </label>
          <div className="backup-topbar-actions">
            <span>
              <i className="backup-risk-dot" /> Setup incomplete
            </span>
            <span className="backup-signed-in">{employeeName}</span>
            <Button className="backup-sign-out" onClick={() => void onSignOut()} variant="quiet">
              Sign out
            </Button>
          </div>
        </header>
        <section className="backup-page-heading">
          <div>
            <h1>{active.title}</h1>
            <span>{active.description}</span>
          </div>
          <button disabled title="Unavailable" type="button">
            {active.action}
          </button>
        </section>
        <section className="backup-readiness-strip" aria-label="Readiness state">
          <article>
            <span>Source inventory</span>
            <strong>Not set up</strong>
            <small>Add the systems and devices that need protection</small>
          </article>
          <article>
            <span>Backup policy</span>
            <strong>Not approved</strong>
            <small>Schedules, retention, RPO, and RTO are not set</small>
          </article>
          <article>
            <span>Restore test</span>
            <strong>Not completed</strong>
            <small>No disaster-recovery test has been recorded</small>
          </article>
        </section>
        <section className="backup-list-shell">
          <div className="backup-list-controls">
            <label>
              <span>Search</span>
              <input disabled placeholder={`Search ${active.title.toLowerCase()}`} />
            </label>
            <button disabled type="button">
              All states
            </button>
            <button disabled type="button">
              Review period
            </button>
          </div>
          <div className="backup-table-head">
            <span>Reference</span>
            <span>Protected source / scope</span>
            <span>Status</span>
            <span>Owner</span>
            <span>Updated</span>
          </div>
          <div className="backup-empty">
            <div>
              <b>
                <BackupIcon name={screenIcon(screen)} />
              </b>
              <h2>No records yet</h2>
              <p>Records for this area will appear here.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ApplicationLoading({ label }: { label: string }) {
  return (
    <main className="backup-application-state" aria-live="polite">
      <VistaMark compact product="Vista Recovery" />
      <strong>{label}</strong>
      <p>Getting your recovery workspace ready.</p>
    </main>
  );
}

function AccessUnavailable({ onSignOut }: { onSignOut: () => Promise<void> }) {
  return (
    <main className="backup-application-state backup-application-state--restricted">
      <VistaMark compact product="Vista Recovery" />
      <p>Vista Recovery</p>
      <h1>Backup access is not assigned</h1>
      <p>Use an account with backup access, then sign in again.</p>
      <Button onClick={() => void onSignOut()} variant="secondary">
        Sign out
      </Button>
    </main>
  );
}

function hasBackupAccess(context: AuthenticationContextResponse | undefined): boolean {
  return (
    context?.permissions.some(
      (permission) =>
        (permission.module === '*' || permission.module === 'backup') &&
        (permission.action === '*' || permission.action === 'view'),
    ) ?? false
  );
}

function isAuthenticationContext(value: unknown): value is AuthenticationContextResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return typeof context['accountId'] === 'string' && Array.isArray(context['permissions']);
}

function signInError(error: unknown): string {
  if (!(error instanceof ApiClientError))
    return 'The service is unavailable. Check your connection and try again.';
  if (error.code === 'TWO_FACTOR_ENROLLMENT_REQUIRED') {
    return 'This administrative account must enroll an authenticator before it can sign in.';
  }
  if (error.code === 'PASSWORD_EXPIRED') {
    return 'This password has expired. Contact a Vista Service administrator.';
  }
  if (error.code === 'RATE_LIMITED') return 'Too many attempts. Wait a moment and try again.';
  return 'The email, password, or authentication code is incorrect.';
}

type BackupIconName =
  'approvals' | 'audit' | 'brand' | 'dr-tests' | 'jobs' | 'overview' | 'policies' | 'sources';

function screenIcon(screen: BackupScreen): BackupIconName {
  return screen;
}

function BackupIcon({ name }: { name: BackupIconName }) {
  return (
    <svg
      aria-hidden="true"
      className="backup-icon"
      fill="none"
      focusable="false"
      shapeRendering="geometricPrecision"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      {backupIconPaths[name]}
    </svg>
  );
}

const backupIconPaths: Record<BackupIconName, React.ReactNode> = {
  approvals: <path d="M5 4h14v16H5zM8 9h8m-8 4h5m-5 4h3M15 16l2 2 4-5" />,
  audit: <path d="M12 3a8 8 0 1 0 8 8M12 7v5l3 2M17 3v4h4" />,
  brand: <path d="M4.5 6.5 10.5 19 19.5 5m-10 1.5 4 8.5 6-10" />,
  'dr-tests': <path d="M4 19h16M6 16V8l6-4 6 4v8M9 12h6M12 9v6" />,
  jobs: <path d="M5 5h14v14H5zM8 9h8m-8 4h5m-5 4h8" />,
  overview: <path d="M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-3H4zm10-13h6V4h-6z" />,
  policies: <path d="M6 3h9l3 3v15H6zM14 3v4h4M9 11h6m-6 4h6" />,
  sources: <path d="M4 5h16v6H4zm0 8h16v6H4zM7 8h.01M7 16h.01" />,
};
