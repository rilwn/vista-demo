import { Button, InlineAlert, TextField, Toast } from '@vista/ui';
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
  UpdateSecurityRoleRequest,
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
  updateSecurityRole,
  verifyAuditIntegrity,
} from '../api/security-administration';
import { ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { securityText as text } from '../i18n/securityMessages';

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
  const [selectedRole, setSelectedRole] = useState<SecurityRole | null>(null);
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
          <h1>{text.loadTitle}</h1>
          <p>{text.connection}</p>
          <Button onClick={reload} variant="secondary">
            {text.retry}
          </Button>
        </section>
      </div>
    );

  return (
    <div className="page-stack security-admin-page">
      <header className="page-header security-admin-header">
        <div className="admin-page-heading">
          <span className="admin-page-heading-mark" aria-hidden="true">
            <Icon name="shield" size={20} />
          </span>
          <div>
            <p className="page-eyebrow">{text.administration}</p>
            <h1>{text.title}</h1>
            <p>{text.subtitle}</p>
          </div>
        </div>
        <span className={`integrity-pill${integrity?.valid ? ' is-valid' : ' is-warning'}`}>
          {integrity?.valid ? text.logChecked : text.logReview}
        </span>
      </header>

      {notice ? (
        <Toast onDismiss={() => setNotice('')} tone="success">
          {notice}
        </Toast>
      ) : null}

      <section className="content-panel security-admin-workspace">
        <div className="security-admin-toolbar">
          <div
            aria-label={text.views}
            className="security-admin-tabs"
            ref={securityTabs}
            role="tablist"
          >
            {(
              [
                ['accounts', `${text.employees} · ${accounts.length}`],
                ['roles', `${text.roles} · ${roles.length}`],
                ['sessions', `${text.sessions} · ${activeSessions}`],
                ['audit', text.activity],
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
              <Icon name="plus" size={16} /> {text.addEmployee}
            </Button>
          ) : null}
          {canCreate && view === 'roles' ? (
            <Button onClick={() => setComposer('role')}>
              <Icon name="plus" size={16} /> {text.addRole}
            </Button>
          ) : null}
        </div>

        <div aria-labelledby={`security-tab-${view}`} id={`security-panel-${view}`} role="tabpanel">
          {view === 'accounts' ? (
            <AccountsView accounts={accounts} canApprove={canApprove} onSelect={setSelected} />
          ) : null}
          {view === 'roles' ? (
            <RolesView canApprove={canApprove} onSelect={setSelectedRole} roles={roles} />
          ) : null}
          {view === 'sessions' ? (
            <SessionsView
              canApprove={canApprove}
              currentSessionId={session?.context.sessionId ?? ''}
              onRevoked={() => {
                setNotice(text.sessionRevoked);
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
            setNotice(text.accountCreated);
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
            setNotice(text.roleCreated);
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
            setNotice(text.accessUpdated);
            reload();
          }}
          roles={roles}
          token={token}
        />
      ) : null}
      {selectedRole ? (
        <RoleEditorDrawer
          administrativeSession={Boolean(
            session?.context.isAdministrative && session.context.twoFactorVerified,
          )}
          onClose={() => setSelectedRole(null)}
          onUpdated={() => {
            setSelectedRole(null);
            setNotice(text.roleUpdated);
            reload();
          }}
          role={selectedRole}
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
  const [page, setPage] = useState(1);
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
  const pageSize = 8;
  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [query]);
  useEffect(() => setPage((value) => Math.min(value, totalPages)), [totalPages]);

  return (
    <div className="security-admin-directory">
      <div className="security-admin-filter">
        <div>
          <Icon name="search" size={16} />
          <label className="visually-hidden" htmlFor="security-account-search">
            {text.findEmployee}
          </label>
          <input
            id="security-account-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text.searchEmployees}
            value={query}
          />
        </div>
        <span>
          {filtered.length}{' '}
          {filtered.length === 1 ? text.employee : text.employees.toLocaleLowerCase()}
        </span>
      </div>
      {filtered.length ? (
        <>
          <div className="table-scroll">
            <table className="security-admin-table">
              <thead>
                <tr>
                  <th>{text.employee}</th>
                  <th>{text.status}</th>
                  <th>{text.access}</th>
                  <th>{text.twoFactor}</th>
                  <th>{text.sessions}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((account) => (
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
                        ? account.roles.map((role) => friendlyRoleText(role.name)).join(', ')
                        : text.noRole}
                    </td>
                    <td data-label="Two-factor">
                      {account.twoFactorEnrolled ? text.setUp : text.notSetUp}
                    </td>
                    <td data-label="Sessions">{account.activeSessionCount}</td>
                    <td className="security-account-row-action">
                      {canApprove ? (
                        <Button onClick={() => onSelect(account)} variant="quiet">
                          {text.manage}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SecurityPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      ) : (
        <SecurityEmpty title={text.noEmployees} detail={text.employeeHint} />
      )}
    </div>
  );
}

function RolesView({
  canApprove,
  onSelect,
  roles,
}: {
  canApprove: boolean;
  onSelect: (role: SecurityRole) => void;
  roles: SecurityRole[];
}) {
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const totalPages = Math.max(Math.ceil(roles.length / pageSize), 1);
  const visible = roles.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage((value) => Math.min(value, totalPages)), [totalPages]);

  if (!roles.length)
    return (
      <SecurityEmpty
        title={text.noRoles}
        detail="Add a role to define what employees can view and change."
      />
    );
  return (
    <div className="security-role-list">
      <div className="security-role-list-heading">
        <div>
          <span>{text.roleDirectory}</span>
          <p>{text.roleDirectoryHint}</p>
        </div>
        <strong>
          {roles.length} {text.roles.toLocaleLowerCase()}
        </strong>
      </div>
      {visible.map((role) => (
        <article key={role.id}>
          <span className="security-role-mark" aria-hidden="true">
            <Icon name={role.isAdministrative ? 'shield' : 'customers'} size={18} />
          </span>
          <div className="security-role-copy">
            <div>
              <h3>{friendlyRoleText(role.name)}</h3>
              {role.isAdministrative ? (
                <span className="security-role-admin">{text.administrator}</span>
              ) : null}
            </div>
            <p>{friendlyRoleDescription(role)}</p>
            <small>
              {role.permissions.length}{' '}
              {role.permissions.length === 1 ? text.permission : text.permissions}
            </small>
          </div>
          <footer>
            {canApprove ? (
              <Button onClick={() => onSelect(role)} variant="quiet">
                {text.editAccess}
              </Button>
            ) : null}
          </footer>
        </article>
      ))}
      <SecurityPagination page={page} totalPages={totalPages} onPageChange={setPage} />
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
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const totalPages = Math.max(Math.ceil(sessions.length / pageSize), 1);
  const visible = sessions.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage((value) => Math.min(value, totalPages)), [totalPages]);

  async function revoke(id: string) {
    setBusyId(id);
    setError('');
    try {
      await revokeSecuritySession(token, id);
      onRevoked();
    } catch {
      setError(text.sessionRevoked);
    } finally {
      setBusyId('');
    }
  }
  return (
    <div className="security-session-list">
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {sessions.length ? (
        visible.map((item) => {
          const active = !item.revokedAt && new Date(item.expiresAt).getTime() > Date.now();
          return (
            <article key={item.id}>
              <span className={`security-session-mark${active ? ' is-active' : ''}`} />
              <div>
                <strong>
                  {item.displayName}
                  {item.id === currentSessionId ? ` · ${text.currentSession}` : ''}
                </strong>
                <span>{item.email}</span>
                <small>
                  {item.userAgent ?? text.browserMissing} · {item.ipAddress ?? text.addressMissing}
                </small>
              </div>
              <div>
                <span>{active ? text.active : item.revokedAt ? text.revoked : text.expired}</span>
                <small>
                  {text.lastSeen} {formatDate(item.lastSeenAt)}
                </small>
              </div>
              {canApprove && active ? (
                <Button
                  busy={busyId === item.id}
                  onClick={() => void revoke(item.id)}
                  variant="danger"
                >
                  {text.revoke}
                </Button>
              ) : null}
            </article>
          );
        })
      ) : (
        <SecurityEmpty title={text.noSignIns} detail={text.signInsHint} />
      )}
      {sessions.length ? (
        <SecurityPagination page={page} totalPages={totalPages} onPageChange={setPage} />
      ) : null}
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
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const totalPages = Math.max(Math.ceil(events.length / pageSize), 1);
  const visible = events.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage((value) => Math.min(value, totalPages)), [totalPages]);

  return (
    <div className="security-audit-view">
      <div className={`security-integrity-card${integrity?.valid ? ' is-valid' : ' is-warning'}`}>
        <Icon name="shield" size={22} />
        <div>
          <strong>{integrity?.valid ? text.logChecked : text.logReview}</strong>
          <span>{text.checkedEntries(integrity?.checkedEvents ?? 0)}</span>
        </div>
      </div>
      {events.length ? (
        <div className="security-audit-timeline">
          {visible.map((event) => (
            <article key={event.id}>
              <span className="security-audit-node" />
              <div>
                <strong>{humanAction(event.action)}</strong>
                <span>
                  {event.actorDisplayName ?? text.system} · {formatDate(event.occurredAt)}
                </span>
                <small>
                  {humanTarget(event.targetType)}
                  {event.targetId ? ` · ${event.targetId.slice(0, 8).toUpperCase()}` : ''}
                </small>
              </div>
            </article>
          ))}
          <SecurityPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      ) : (
        <SecurityEmpty title={text.noActivity} detail={text.activityHint} />
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
      title={text.addEmployee}
      subtitle="Create the employee account now; assign access afterward."
      onClose={onClose}
    >
      <form className="security-admin-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <TextField
          id="security-employee-name"
          label={text.employee}
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
            {text.cancel}
          </Button>
          <Button busy={busy} busyLabel={text.createAccount} type="submit">
            {text.addEmployee}
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
      title={text.addRole}
      subtitle="Choose what employees with this role can do."
      onClose={onClose}
      wide
    >
      <form className="security-admin-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <div className="security-form-pair">
          <TextField
            id="security-role-name"
            label={text.roleName}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
            value={draft.name}
          />
          <TextField
            hint="Use lowercase letters, numbers, dots, dashes, or underscores."
            id="security-role-code"
            label={text.roleCode}
            onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase() })}
            pattern="[a-z][a-z0-9._-]{2,99}"
            required
            value={draft.code}
          />
        </div>
        <TextField
          id="security-role-description"
          label={text.description}
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
            <strong>{text.adminRole}</strong>
            <small>{text.adminRoleHint}</small>
          </span>
        </label>
        <PermissionMatrix selected={selected} onToggle={toggle} />
        <div className="security-drawer-actions">
          <Button onClick={onClose} variant="quiet">
            {text.cancel}
          </Button>
          <Button busy={busy} busyLabel={text.createRole} type="submit">
            {text.addRole}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function RoleEditorDrawer({
  administrativeSession,
  onClose,
  onUpdated,
  role,
  token,
}: {
  administrativeSession: boolean;
  onClose: () => void;
  onUpdated: () => void;
  role: SecurityRole;
  token: string;
}) {
  const [draft, setDraft] = useState<Omit<UpdateSecurityRoleRequest, 'expectedVersion'>>({
    description: role.description ?? '',
    name: role.name,
    permissions: [],
  });
  const [selected, setSelected] = useState(() =>
    role.permissions
      .filter(
        (permission) =>
          modules.includes(permission.module as (typeof modules)[number]) &&
          actions.includes(permission.action as (typeof actions)[number]),
      )
      .map((permission) => `${permission.module}:${permission.action}`),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const editAllowed = !role.isAdministrative || administrativeSession;

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
    const input: Omit<UpdateSecurityRoleRequest, 'expectedVersion'> = {
      ...draft,
      permissions: modules.flatMap((module) =>
        actions
          .filter((action) => selected.includes(`${module}:${action}`))
          .map((action) => ({ action, module }) satisfies ApiPermission),
      ),
    };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await updateSecurityRole(token, attempt.current.key, role, input);
      attempt.current = null;
      onUpdated();
    } catch (failure) {
      setError(apiMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      title={`Edit ${friendlyRoleText(role.name)}`}
      subtitle="Update the role name, description, and available access."
      onClose={onClose}
      wide
    >
      <form
        className="security-admin-form security-role-editor"
        onSubmit={(event) => void submit(event)}
      >
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {role.isAdministrative ? (
          <section className="security-role-protection">
            <Icon name="shield" size={18} />
            <span>
              <strong>Administrative role</strong>
              <small>
                Changing this role requires a two-factor verified administrator session.
              </small>
            </span>
          </section>
        ) : null}
        {!editAllowed ? (
          <InlineAlert tone="warning">
            Set up and verify your authenticator before changing this administrative role.
          </InlineAlert>
        ) : null}
        <TextField
          id="security-role-edit-name"
          label={text.roleName}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          required
          value={draft.name}
        />
        <TextField
          id="security-role-edit-description"
          label={text.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          value={draft.description ?? ''}
        />
        <PermissionMatrix disabled={!editAllowed} selected={selected} onToggle={toggle} />
        <div className="security-drawer-actions">
          <Button onClick={onClose} variant="quiet">
            {text.cancel}
          </Button>
          <Button busy={busy} disabled={!editAllowed} busyLabel={text.saveRole} type="submit">
            {text.saveAccess}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function PermissionMatrix({
  disabled = false,
  onToggle,
  selected,
}: {
  disabled?: boolean;
  onToggle: (module: string, action: string) => void;
  selected: string[];
}) {
  return (
    <fieldset className="security-permission-matrix" disabled={disabled}>
      <legend>{text.permissionsTitle}</legend>
      <p>{text.permissionsHint}</p>
      <div className="security-permission-head">
        <span>{text.module}</span>
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
                  onChange={() => onToggle(module, action)}
                  type="checkbox"
                />
                <span>{permissionActionLabel(action)}</span>
              </label>
            );
          })}
        </div>
      ))}
    </fieldset>
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
    <Drawer
      ariaLabel={account.displayName}
      title={`Manage ${account.displayName}`}
      subtitle={account.email}
      onClose={onClose}
    >
      <section className="security-account-detail">
        <span className="security-account-avatar" aria-hidden="true">
          {account.displayName
            .split(/\s+/u)
            .slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase())
            .join('')}
        </span>
        <div>
          <strong>{account.displayName}</strong>
          <span>{account.employeeNumber}</span>
        </div>
        <StatusLabel status={account.status} />
      </section>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <section className="security-account-section">
        <div className="security-account-section-heading">
          <div>
            <span>{text.signInProtection}</span>
            <p>{text.factorHint}</p>
          </div>
          <Icon name="key" size={18} />
        </div>
        <div className="security-account-factor">
          <span className={account.twoFactorEnrolled ? 'is-ready' : ''} aria-hidden="true" />
          <div>
            <strong>{account.twoFactorEnrolled ? text.factorSet : text.factorMissing}</strong>
            <small>{text.factorRequired}</small>
          </div>
        </div>
        {canIssueRecovery && account.status !== 'disabled' ? (
          <div className="security-account-recovery">
            <div>
              <strong>{text.recover}</strong>
              <span>{text.recoverHint}</span>
            </div>
            <Button onClick={() => onIssueRecovery(account)} variant="secondary">
              {text.issueCode}
            </Button>
          </div>
        ) : null}
      </section>
      <fieldset className="security-role-assignment" disabled={!canApprove}>
        <legend>{text.assignedRoles}</legend>
        <p>{text.assignedRolesHint}</p>
        {roles.length ? (
          <div className="security-role-choices">
            {roles.map((role) => (
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
                  <strong>{friendlyRoleText(role.name)}</strong>
                  <small>
                    {role.isAdministrative
                      ? text.administrator
                      : `${role.permissions.length} ${text.permissions}`}
                  </small>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p>{text.noRoles}</p>
        )}
      </fieldset>
      <div className="security-drawer-actions">
        <Button onClick={onClose} variant="quiet">
          {text.close}
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
            {text.saveRoles}
          </Button>
        ) : null}
      </div>
      {canApprove ? (
        <section className="security-account-status-actions">
          <div>
            <strong>{text.accountStatus}</strong>
            <span>{text.accountStatusHint}</span>
          </div>
          {account.status === 'disabled' ? (
            <Button
              busy={busy === 'active'}
              onClick={() => void changeStatus('active')}
              variant="secondary"
            >
              {text.reactivate}
            </Button>
          ) : (
            <Button
              busy={busy === 'disabled'}
              disabled={account.accountId === currentAccountId}
              onClick={() => void changeStatus('disabled')}
              variant="danger"
            >
              {text.disable}
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
  const attempt = useRef<{ reason: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedReason = reason.trim();
    if (attempt.current?.reason !== normalizedReason)
      attempt.current = { reason: normalizedReason, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      setHandoff(
        await issueAccountRecoveryHandoff(token, attempt.current.key, account, {
          expectedVersion: account.version,
          reason: normalizedReason,
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
  ariaLabel,
  children,
  onClose,
  subtitle,
  title,
  wide = false,
}: {
  ariaLabel?: string;
  children: React.ReactNode;
  onClose: () => void;
  subtitle?: string;
  title: string;
  wide?: boolean;
}) {
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label={text.closePanel}
        className="security-drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={ariaLabel ?? title}
        aria-modal="true"
        className={`security-drawer${wide ? ' is-wide' : ''}`}
        role="dialog"
      >
        <header className="panel-drawer-header">
          <button
            aria-label={text.backSecurity}
            className="panel-back-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} />
            {text.back}
          </button>
          <button
            aria-label={text.closePanel}
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
      {status === 'active' ? text.active : status === 'disabled' ? text.disable : 'Locked'}
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
function SecurityPagination({
  onPageChange,
  page,
  totalPages,
}: {
  onPageChange: (page: number) => void;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={text.registerPages} className="security-admin-pagination">
      <Button disabled={page === 1} onClick={() => onPageChange(page - 1)} variant="quiet">
        {text.previous}
      </Button>
      <span>{text.page(page, totalPages)}</span>
      <Button disabled={page === totalPages} onClick={() => onPageChange(page + 1)} variant="quiet">
        {text.next}
      </Button>
    </nav>
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
function friendlyRoleText(value: string): string {
  return value
    .replace(/^Development fixture:\s*/iu, '')
    .replace(/^Vista Demo\s+/iu, '')
    .replace(/^Vista bootstrap\s+/iu, '');
}
function friendlyRoleDescription(role: SecurityRole): string {
  if (/development fixture role/iu.test(role.description ?? '')) {
    return role.isAdministrative
      ? 'Administrative permissions for platform management.'
      : 'Standard permissions for assigned daily work.';
  }
  return role.description ? friendlyRoleText(role.description) : 'No description';
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
