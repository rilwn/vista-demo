import { Button, InlineAlert, TextField } from '@vista/ui';
import { useActiveItemVisibility } from '@vista/ui/navigation';
import type {
  AccountRecoveryHandoff,
  ApiPermission,
  AuditEventRecord,
  AuditIntegrityResult,
  CreateSecurityAccountRequest,
  CreateSecurityRoleRequest,
  SecurityAccount,
  SecurityRole,
  SecuritySession,
} from '@vista/contracts';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  changeSecurityAccountStatus,
  createSecurityAccount,
  createSecurityRole,
  issueAccountRecoveryHandoff,
  listAuditEvents,
  listSecurityAccounts,
  listSecurityRoles,
  listSecuritySessions,
  replaceSecurityAccountRoles,
  revokeSecuritySession,
  verifyAuditIntegrity,
} from '../api/security-administration';
import { ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';

type SecurityView = 'accounts' | 'audit' | 'roles' | 'sessions';
type Composer = 'account' | 'role' | null;

const actions = ['view', 'create', 'edit', 'delete', 'approve'] as const;
const modules = [
  'platform',
  'platform.organization',
  'erp.finance',
  'erp.procurement',
  'erp.warehouse',
  'erp.sales',
  'erp.service',
  'erp.logistics',
  'reports',
  'crm',
  'pos',
  'backup',
] as const;

export function SecurityAdministrationPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const [accounts, setAccounts] = useState<SecurityAccount[]>([]);
  const [roles, setRoles] = useState<SecurityRole[]>([]);
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [integrity, setIntegrity] = useState<AuditIntegrityResult | null>(null);
  const [view, setView] = useState<SecurityView>('accounts');
  const [composer, setComposer] = useState<Composer>(null);
  const [selected, setSelected] = useState<SecurityAccount | null>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<SecurityAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const securityTabs = useActiveItemVisibility<HTMLDivElement>(view);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    void Promise.all([
      listSecurityAccounts(token),
      listSecurityRoles(token),
      listSecuritySessions(token),
      listAuditEvents(token),
      verifyAuditIntegrity(token),
    ])
      .then(([accountPage, nextRoles, nextSessions, auditPage, nextIntegrity]) => {
        if (!active) return;
        setAccounts(accountPage.items);
        setRoles(nextRoles);
        setSessions(nextSessions);
        setEvents(auditPage.items);
        setIntegrity(nextIntegrity);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, token]);

  const activeSessions = sessions.filter(
    (item) => !item.revokedAt && new Date(item.expiresAt).getTime() > Date.now(),
  ).length;
  const canCreate = hasPermission('platform', 'create');
  const canApprove = hasPermission('platform', 'approve');
  const canIssueRecovery = Boolean(
    canApprove && session?.context.isAdministrative && session.context.twoFactorVerified,
  );

  if (loading) return <SecurityLoading />;
  if (loadError)
    return (
      <div className="page-stack security-admin-page">
        <section className="content-panel security-admin-state">
          <Icon name="shield" size={28} />
          <h1>Security settings could not be loaded</h1>
          <p>Check your connection and try again.</p>
          <Button onClick={reload} variant="secondary">
            Try again
          </Button>
        </section>
      </div>
    );

  return (
    <div className="page-stack security-admin-page">
      <header className="page-header security-admin-header">
        <div>
          <p className="page-eyebrow">Administration</p>
          <h1>Security</h1>
          <p>Manage employee access, roles, active sign-ins, and activity history.</p>
        </div>
        <span className={`integrity-pill${integrity?.valid ? ' is-valid' : ' is-warning'}`}>
          {integrity?.valid ? 'Activity log checked' : 'Activity log needs review'}
        </span>
      </header>

      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}

      <section className="content-panel security-admin-workspace">
        <div className="security-admin-toolbar">
          <div
            aria-label="Security views"
            className="security-admin-tabs"
            ref={securityTabs}
            role="tablist"
          >
            {(
              [
                ['accounts', `Employees · ${accounts.length}`],
                ['roles', `Roles · ${roles.length}`],
                ['sessions', `Sessions · ${activeSessions}`],
                ['audit', 'Activity log'],
              ] as const
            ).map(([key, label]) => (
              <button
                aria-controls={`security-panel-${key}`}
                aria-current={view === key ? 'page' : undefined}
                aria-selected={view === key}
                className={view === key ? 'is-active' : ''}
                id={`security-tab-${key}`}
                key={key}
                onClick={() => setView(key)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {canCreate && view === 'accounts' ? (
            <Button onClick={() => setComposer('account')}>
              <Icon name="plus" size={16} /> Add employee
            </Button>
          ) : null}
          {canCreate && view === 'roles' ? (
            <Button onClick={() => setComposer('role')}>
              <Icon name="plus" size={16} /> Add role
            </Button>
          ) : null}
        </div>

        <div aria-labelledby={`security-tab-${view}`} id={`security-panel-${view}`} role="tabpanel">
          {view === 'accounts' ? (
            <AccountsView accounts={accounts} canApprove={canApprove} onSelect={setSelected} />
          ) : null}
          {view === 'roles' ? <RolesView roles={roles} /> : null}
          {view === 'sessions' ? (
            <SessionsView
              canApprove={canApprove}
              currentSessionId={session?.context.sessionId ?? ''}
              onRevoked={() => {
                setNotice('The selected login session was revoked.');
                reload();
              }}
              sessions={sessions}
              token={token}
            />
          ) : null}
          {view === 'audit' ? <AuditView events={events} integrity={integrity} /> : null}
        </div>
      </section>

      {composer === 'account' ? (
        <AccountComposer
          onClose={() => setComposer(null)}
          onCreated={() => {
            setComposer(null);
            setNotice('Employee account created. You can now assign a role.');
            reload();
          }}
          token={token}
        />
      ) : null}
      {composer === 'role' ? (
        <RoleComposer
          administrativeSession={Boolean(
            session?.context.isAdministrative && session.context.twoFactorVerified,
          )}
          onClose={() => setComposer(null)}
          onCreated={() => {
            setComposer(null);
            setNotice('Role created.');
            reload();
          }}
          token={token}
        />
      ) : null}
      {selected ? (
        <AccountAccessDrawer
          account={selected}
          canApprove={canApprove}
          canIssueRecovery={canIssueRecovery}
          currentAccountId={session?.context.accountId ?? ''}
          onClose={() => setSelected(null)}
          onIssueRecovery={(account) => {
            setSelected(null);
            setRecoveryTarget(account);
          }}
          onUpdated={() => {
            setSelected(null);
            setNotice('Employee access updated.');
            reload();
          }}
          roles={roles}
          token={token}
        />
      ) : null}
      {recoveryTarget ? (
        <RecoveryHandoffDrawer
          account={recoveryTarget}
          onClose={() => setRecoveryTarget(null)}
          token={token}
        />
      ) : null}
    </div>
  );
}

function AccountsView({
  accounts,
  canApprove,
  onSelect,
}: {
  accounts: SecurityAccount[];
  canApprove: boolean;
  onSelect: (account: SecurityAccount) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? accounts.filter((account) =>
          [account.displayName, account.email, account.employeeNumber].some((value) =>
            value.toLowerCase().includes(needle),
          ),
        )
      : accounts;
  }, [accounts, query]);
  return (
    <div className="security-admin-directory">
      <div className="security-admin-filter">
        <div>
          <Icon name="search" size={16} />
          <label className="visually-hidden" htmlFor="security-account-search">
            Find an employee
          </label>
          <input
            id="security-account-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search employees"
            value={query}
          />
        </div>
        <span>
          {filtered.length} {filtered.length === 1 ? 'employee' : 'employees'}
        </span>
      </div>
      {filtered.length ? (
        <div className="table-scroll">
          <table className="security-admin-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Status</th>
                <th>Access</th>
                <th>Two-factor</th>
                <th>Sessions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((account) => (
                <tr key={account.accountId}>
                  <td data-label="Employee">
                    <strong>{account.displayName}</strong>
                    <span>
                      {account.email} · {account.employeeNumber}
                    </span>
                  </td>
                  <td data-label="Status">
                    <StatusLabel status={account.status} />
                  </td>
                  <td data-label="Access">
                    {account.roles.length
                      ? account.roles.map((role) => role.name).join(', ')
                      : 'No role'}
                  </td>
                  <td data-label="Two-factor">
                    {account.twoFactorEnrolled ? 'Set up' : 'Not set up'}
                  </td>
                  <td data-label="Sessions">{account.activeSessionCount}</td>
                  <td className="security-account-row-action">
                    {canApprove ? (
                      <Button onClick={() => onSelect(account)} variant="quiet">
                        Manage
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <SecurityEmpty
          title="No employees found"
          detail="Try a different name, email, or employee number."
        />
      )}
    </div>
  );
}

function RolesView({ roles }: { roles: SecurityRole[] }) {
  if (!roles.length)
    return (
      <SecurityEmpty
        title="No roles yet"
        detail="Add a role to define what employees can view and change."
      />
    );
  return (
    <div className="security-role-list">
      {roles.map((role) => (
        <article key={role.id}>
          <div className="security-role-copy">
            <div>
              <h3>{role.name}</h3>
              {role.isAdministrative ? (
                <span className="security-role-admin">Administrator</span>
              ) : null}
            </div>
            <p>{role.description ?? 'No description'}</p>
          </div>
          <footer>
            <strong>{role.permissions.length}</strong>
            <span>{role.permissions.length === 1 ? 'permission' : 'permissions'}</span>
            <small>{role.code}</small>
          </footer>
        </article>
      ))}
    </div>
  );
}

function SessionsView({
  canApprove,
  currentSessionId,
  onRevoked,
  sessions,
  token,
}: {
  canApprove: boolean;
  currentSessionId: string;
  onRevoked: () => void;
  sessions: SecuritySession[];
  token: string;
}) {
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  async function revoke(id: string) {
    setBusyId(id);
    setError('');
    try {
      await revokeSecuritySession(token, id);
      onRevoked();
    } catch {
      setError('The session could not be revoked. Reload and try again.');
    } finally {
      setBusyId('');
    }
  }
  return (
    <div className="security-session-list">
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {sessions.length ? (
        sessions.map((item) => {
          const active = !item.revokedAt && new Date(item.expiresAt).getTime() > Date.now();
          return (
            <article key={item.id}>
              <span className={`security-session-mark${active ? ' is-active' : ''}`} />
              <div>
                <strong>
                  {item.displayName}
                  {item.id === currentSessionId ? ' · Current session' : ''}
                </strong>
                <span>{item.email}</span>
                <small>
                  {item.userAgent ?? 'Browser not recorded'} ·{' '}
                  {item.ipAddress ?? 'Address not recorded'}
                </small>
              </div>
              <div>
                <span>{active ? 'Active' : item.revokedAt ? 'Revoked' : 'Expired'}</span>
                <small>Last seen {formatDate(item.lastSeenAt)}</small>
              </div>
              {canApprove && active ? (
                <Button
                  busy={busyId === item.id}
                  onClick={() => void revoke(item.id)}
                  variant="danger"
                >
                  Revoke
                </Button>
              ) : null}
            </article>
          );
        })
      ) : (
        <SecurityEmpty title="No sign-ins recorded" detail="Employee sign-ins will appear here." />
      )}
    </div>
  );
}

function AuditView({
  events,
  integrity,
}: {
  events: AuditEventRecord[];
  integrity: AuditIntegrityResult | null;
}) {
  return (
    <div className="security-audit-view">
      <div className={`security-integrity-card${integrity?.valid ? ' is-valid' : ' is-warning'}`}>
        <Icon name="shield" size={22} />
        <div>
          <strong>{integrity?.valid ? 'Activity log checked' : 'Activity log needs review'}</strong>
          <span>{integrity?.checkedEvents ?? 0} entries checked</span>
        </div>
      </div>
      {events.length ? (
        <div className="security-audit-timeline">
          {events.map((event) => (
            <article key={event.id}>
              <span className="security-audit-node" />
              <div>
                <strong>{humanAction(event.action)}</strong>
                <span>
                  {event.actorDisplayName ?? 'System'} · {formatDate(event.occurredAt)}
                </span>
                <small>
                  {humanTarget(event.targetType)}
                  {event.targetId ? ` · ${event.targetId.slice(0, 8).toUpperCase()}` : ''}
                </small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <SecurityEmpty
          title="No activity yet"
          detail="Account and access changes will appear here."
        />
      )}
    </div>
  );
}

function AccountComposer({
  onClose,
  onCreated,
  token,
}: {
  onClose: () => void;
  onCreated: () => void;
  token: string;
}) {
  const [draft, setDraft] = useState<CreateSecurityAccountRequest>({
    displayName: '',
    email: '',
    employeeNumber: '',
    initialPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const fingerprint = JSON.stringify(draft);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await createSecurityAccount(token, attempt.current.key, draft);
      attempt.current = null;
      onCreated();
    } catch (failure) {
      setError(apiMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Add employee"
      subtitle="Create the employee account now; assign access afterward."
      onClose={onClose}
    >
      <form className="security-admin-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <TextField
          id="security-employee-name"
          label="Display name"
          onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          required
          value={draft.displayName}
        />
        <TextField
          id="security-employee-number"
          label="Employee number"
          onChange={(e) => setDraft({ ...draft, employeeNumber: e.target.value })}
          required
          value={draft.employeeNumber}
        />
        <TextField
          id="security-employee-email"
          label="Work email"
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          required
          type="email"
          value={draft.email}
        />
        <TextField
          hint="Use a temporary password that meets your company password rules."
          id="security-employee-password"
          label="Initial password"
          onChange={(e) => setDraft({ ...draft, initialPassword: e.target.value })}
          required
          type="password"
          value={draft.initialPassword}
        />
        <div className="security-drawer-actions">
          <Button onClick={onClose} variant="quiet">
            Cancel
          </Button>
          <Button busy={busy} busyLabel="Creating account">
            Add employee
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function RoleComposer({
  administrativeSession,
  onClose,
  onCreated,
  token,
}: {
  administrativeSession: boolean;
  onClose: () => void;
  onCreated: () => void;
  token: string;
}) {
  const [draft, setDraft] = useState<Omit<CreateSecurityRoleRequest, 'permissions'>>({
    code: '',
    description: '',
    isAdministrative: false,
    name: '',
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  function toggle(module: string, action: string) {
    const key = `${module}:${action}`;
    setSelected((items) =>
      items.includes(key) ? items.filter((item) => item !== key) : [...items, key],
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const permissions = modules.flatMap((module) =>
      actions
        .filter((action) => selected.includes(`${module}:${action}`))
        .map((action) => ({ action, module }) satisfies ApiPermission),
    );
    const input: CreateSecurityRoleRequest = { ...draft, permissions };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await createSecurityRole(token, attempt.current.key, input);
      attempt.current = null;
      onCreated();
    } catch (failure) {
      setError(apiMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Add role"
      subtitle="Choose what employees with this role can do."
      onClose={onClose}
      wide
    >
      <form className="security-admin-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <div className="security-form-pair">
          <TextField
            id="security-role-name"
            label="Role name"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
            value={draft.name}
          />
          <TextField
            hint="Use lowercase letters, numbers, dots, dashes, or underscores."
            id="security-role-code"
            label="Role code"
            onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase() })}
            pattern="[a-z][a-z0-9._-]{2,99}"
            required
            value={draft.code}
          />
        </div>
        <TextField
          id="security-role-description"
          label="Description"
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          value={draft.description ?? ''}
        />
        <label className="security-admin-toggle">
          <input
            checked={draft.isAdministrative}
            disabled={!administrativeSession}
            onChange={(e) => setDraft({ ...draft, isAdministrative: e.target.checked })}
            type="checkbox"
          />
          <span>
            <strong>Administrator role</strong>
            <small>
              Only an administrator signed in with two-factor authentication can select this.
            </small>
          </span>
        </label>
        <fieldset className="security-permission-matrix">
          <legend>Permissions</legend>
          <div className="security-permission-head">
            <span>Module</span>
            {actions.map((action) => (
              <span key={action}>{permissionActionLabel(action)}</span>
            ))}
          </div>
          {modules.map((module) => (
            <div className="security-permission-row" key={module}>
              <strong>{shortModule(module)}</strong>
              {actions.map((action) => {
                const key = `${module}:${action}`;
                return (
                  <label key={key}>
                    <input
                      aria-label={`${shortModule(module)} ${permissionActionLabel(action)}`}
                      checked={selected.includes(key)}
                      onChange={() => toggle(module, action)}
                      type="checkbox"
                    />
                    <span>{permissionActionLabel(action)}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </fieldset>
        <div className="security-drawer-actions">
          <Button onClick={onClose} variant="quiet">
            Cancel
          </Button>
          <Button busy={busy} busyLabel="Creating role">
            Add role
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function AccountAccessDrawer({
  account,
  canApprove,
  canIssueRecovery,
  currentAccountId,
  onClose,
  onIssueRecovery,
  onUpdated,
  roles,
  token,
}: {
  account: SecurityAccount;
  canApprove: boolean;
  canIssueRecovery: boolean;
  currentAccountId: string;
  onClose: () => void;
  onIssueRecovery: (account: SecurityAccount) => void;
  onUpdated: () => void;
  roles: SecurityRole[];
  token: string;
}) {
  const [selected, setSelected] = useState(account.roles.map((role) => role.id));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const attempts = useRef(new Map<string, string>());
  function keyFor(fingerprint: string) {
    const existing = attempts.current.get(fingerprint);
    if (existing) return existing;
    const key = crypto.randomUUID();
    attempts.current.set(fingerprint, key);
    return key;
  }
  async function saveRoles() {
    const fingerprint = `roles:${account.version}:${[...selected].sort().join(',')}`;
    setBusy('roles');
    setError('');
    try {
      await replaceSecurityAccountRoles(token, keyFor(fingerprint), account, selected);
      attempts.current.delete(fingerprint);
      onUpdated();
    } catch (failure) {
      setError(apiMessage(failure));
    } finally {
      setBusy('');
    }
  }
  async function changeStatus(status: 'active' | 'disabled') {
    const fingerprint = `status:${status}:${account.version}`;
    setBusy(status);
    setError('');
    try {
      await changeSecurityAccountStatus(token, keyFor(fingerprint), account, status);
      attempts.current.delete(fingerprint);
      onUpdated();
    } catch (failure) {
      setError(apiMessage(failure));
    } finally {
      setBusy('');
    }
  }
  return (
    <Drawer title={account.displayName} subtitle="Employee access" onClose={onClose}>
      <div className="security-account-detail">
        <span>{account.employeeNumber}</span>
        <strong>{account.email}</strong>
        <StatusLabel status={account.status} />
      </div>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <section className="security-account-factor">
        <Icon name="key" size={19} />
        <div>
          <strong>
            {account.twoFactorEnrolled
              ? 'Two-factor authentication is set up'
              : 'Two-factor authentication is not set up'}
          </strong>
          <span>An administrator role cannot be assigned until this is set up.</span>
        </div>
      </section>
      {canIssueRecovery && account.status !== 'disabled' ? (
        <section className="security-account-recovery">
          <div>
            <strong>Account recovery</strong>
            <span>
              Issue a short-lived, single-use recovery code after verifying this employee’s
              identity.
            </span>
          </div>
          <Button onClick={() => onIssueRecovery(account)} variant="secondary">
            Issue recovery handoff
          </Button>
        </section>
      ) : null}
      <fieldset className="security-role-assignment" disabled={!canApprove}>
        <legend>Assigned roles</legend>
        {roles.length ? (
          roles.map((role) => (
            <label key={role.id}>
              <input
                checked={selected.includes(role.id)}
                onChange={() =>
                  setSelected((items) =>
                    items.includes(role.id)
                      ? items.filter((id) => id !== role.id)
                      : [...items, role.id],
                  )
                }
                type="checkbox"
              />
              <span>
                <strong>{role.name}</strong>
                <small>
                  {role.code}
                  {role.isAdministrative ? ' · Administrative' : ''}
                </small>
              </span>
            </label>
          ))
        ) : (
          <p>No roles are available yet.</p>
        )}
      </fieldset>
      <div className="security-drawer-actions">
        <Button onClick={onClose} variant="quiet">
          Close
        </Button>
        {canApprove ? (
          <Button
            busy={busy === 'roles'}
            disabled={sameSet(
              selected,
              account.roles.map((role) => role.id),
            )}
            onClick={() => void saveRoles()}
          >
            Save roles
          </Button>
        ) : null}
      </div>
      {canApprove ? (
        <section className="security-account-status-actions">
          <div>
            <strong>Account status</strong>
            <span>
              Disabling this account signs the employee out on every device. Their history is kept.
            </span>
          </div>
          {account.status === 'disabled' ? (
            <Button
              busy={busy === 'active'}
              onClick={() => void changeStatus('active')}
              variant="secondary"
            >
              Reactivate
            </Button>
          ) : (
            <Button
              busy={busy === 'disabled'}
              disabled={account.accountId === currentAccountId}
              onClick={() => void changeStatus('disabled')}
              variant="danger"
            >
              Disable account
            </Button>
          )}
        </section>
      ) : null}
    </Drawer>
  );
}

function RecoveryHandoffDrawer({
  account,
  onClose,
  token,
}: {
  account: SecurityAccount;
  onClose: () => void;
  token: string;
}) {
  const [reason, setReason] = useState('Identity verified in person.');
  const [handoff, setHandoff] = useState<AccountRecoveryHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setHandoff(
        await issueAccountRecoveryHandoff(token, crypto.randomUUID(), account, {
          expectedVersion: account.version,
          reason: reason.trim(),
        }),
      );
    } catch (failure) {
      setError(apiMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      onClose={onClose}
      subtitle={handoff ? 'Share this code through an approved channel.' : 'Verify identity first.'}
      title={handoff ? 'Recovery handoff issued' : `Recover ${account.displayName}'s access`}
    >
      {handoff ? (
        <section className="security-recovery-issued" aria-live="polite">
          <InlineAlert title="Show this code once" tone="warning">
            The code is valid until {formatDate(handoff.expiresAt)}. It will not be shown again
            after this panel is closed.
          </InlineAlert>
          <div className="security-recovery-recipient">
            <span>Employee</span>
            <strong>{handoff.email}</strong>
          </div>
          <div className="security-recovery-code">
            <span>One-time recovery code</span>
            <code>{handoff.recoveryCode}</code>
          </div>
          <div className="security-drawer-actions">
            <Button onClick={onClose}>Close handoff</Button>
          </div>
        </section>
      ) : (
        <form
          className="security-admin-form security-recovery-form"
          onSubmit={(event) => void issue(event)}
        >
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <div className="security-recovery-recipient">
            <span>Employee</span>
            <strong>{account.email}</strong>
          </div>
          <div className="vista-field">
            <label htmlFor="recovery-handoff-reason">Identity verification note</label>
            <div className="vista-field-control">
              <textarea
                className="vista-field-input security-recovery-note"
                id="recovery-handoff-reason"
                maxLength={1000}
                minLength={8}
                onChange={(event) => setReason(event.target.value)}
                required
                rows={4}
                value={reason}
              />
            </div>
            <p className="vista-field-message">
              Record how the employee’s identity was verified. Do not enter a password or recovery
              code here.
            </p>
          </div>
          <div className="security-drawer-actions">
            <Button disabled={busy} onClick={onClose} variant="quiet">
              Cancel
            </Button>
            <Button busy={busy} busyLabel="Issuing code" type="submit">
              Issue recovery code
            </Button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

function Drawer({
  children,
  onClose,
  subtitle,
  title,
  wide = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  subtitle?: string;
  title: string;
  wide?: boolean;
}) {
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label="Close panel"
        className="security-drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className={`security-drawer${wide ? ' is-wide' : ''}`}
        role="dialog"
      >
        <header className="panel-drawer-header">
          <button
            aria-label="Back to security"
            className="panel-back-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} />
            Back
          </button>
          <button
            aria-label="Close panel"
            className="panel-close-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function StatusLabel({ status }: { status: SecurityAccount['status'] }) {
  return (
    <span className={`security-status security-status--${status}`}>
      {status === 'active' ? 'Active' : status === 'disabled' ? 'Disabled' : 'Locked'}
    </span>
  );
}
function SecurityEmpty({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="security-admin-empty">
      <Icon name="shield" size={25} />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
function SecurityLoading() {
  return (
    <div className="page-stack security-admin-page">
      <div className="security-admin-skeleton">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="security-admin-skeleton is-large">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
function shortModule(module: string): string {
  return (
    (
      {
        platform: 'Platform',
        'platform.organization': 'Business structure',
        'erp.finance': 'Finance',
        'erp.procurement': 'Procurement',
        'erp.warehouse': 'Warehouse',
        'erp.sales': 'Sales',
        'erp.service': 'Service',
        'erp.logistics': 'Logistics',
        reports: 'Reports',
        crm: 'CRM',
        pos: 'POS',
        backup: 'Backup & DR',
      } as Record<string, string>
    )[module] ?? module
  );
}
function humanAction(action: string): string {
  return (
    (
      {
        'auth.account_sessions.revoked': 'All employee sessions revoked',
        'auth.login.failed': 'Sign-in failed',
        'auth.login.succeeded': 'Signed in',
        'auth.password.change_rejected': 'Password change declined',
        'auth.password.changed': 'Password changed',
        'auth.recovery.completed': 'Account recovery completed',
        'auth.recovery.factor_enrolled': 'Recovery authenticator enrolled',
        'auth.recovery.factor_enrollment_started': 'Recovery authenticator setup started',
        'auth.recovery.handoff_issued': 'Recovery handoff issued',
        'auth.session.revoked': 'Signed out',
        'auth.session.revoked_by_administrator': 'Session revoked by administrator',
        'iam.account_roles.replaced': 'Employee roles changed',
        'iam.role.created': 'Role created',
        'identity.account.created': 'Employee account created',
        'identity.account.disabled': 'Employee account disabled',
        'identity.account.reactivated': 'Employee account reactivated',
      } as Record<string, string>
    )[action] ?? titleCase(action.replaceAll('.', ' ').replaceAll('_', ' '))
  );
}
function humanTarget(target: string): string {
  return (
    (
      {
        login_session: 'Login session',
        role: 'Role',
        user_account: 'Employee account',
      } as Record<string, string>
    )[target] ?? titleCase(target.replaceAll('.', ' ').replaceAll('_', ' '))
  );
}
function permissionActionLabel(action: (typeof actions)[number]): string {
  return titleCase(action);
}
function titleCase(value: string): string {
  return value.replace(/\b\w/gu, (character) => character.toUpperCase());
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(new Date(value));
}
function sameSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}
function apiMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'TWO_FACTOR_ENROLLMENT_REQUIRED')
      return 'Enroll a second factor before assigning administrative access.';
    if (error.code === 'RECORD_VERSION_CONFLICT')
      return 'This account changed. Close the panel, reload, and try again.';
    if (error.details[0]?.message) return error.details[0].message;
    return error.message;
  }
  return 'The security change could not be completed. Try again.';
}
