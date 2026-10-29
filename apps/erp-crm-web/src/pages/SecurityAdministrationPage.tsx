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
import { TechnicalIdentifier } from '../components/TechnicalIdentifier';
import { AdminDrawer } from '../components/AdminDrawer';
import {
  formatOperationsDate,
  getOperationsLocale,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { securityText as text } from '../i18n/securityMessages';
import './security-panels.css';

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
  useLocalization();
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
  const [notice, setNotice] = useState<
    'sessionRevoked' | 'accountCreated' | 'roleCreated' | 'accessUpdated' | 'roleUpdated' | ''
  >('');
  const loadedForToken = useRef('');
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const securityTabs = useActiveItemVisibility<HTMLDivElement>(view);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(loadedForToken.current !== token);
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
        loadedForToken.current = token;
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
          {text[notice]}
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
                ['sessions', text.activeSessionCount(activeSessions)],
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
                setNotice('sessionRevoked');
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
            setNotice('accountCreated');
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
            setNotice('roleCreated');
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
            setNotice('accessUpdated');
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
            setNotice('roleUpdated');
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
                    <td data-label={text.employee}>
                      <strong>{account.displayName}</strong>
                      <span>
                        {account.email} · {account.employeeNumber}
                      </span>
                    </td>
                    <td data-label={text.status}>
                      <StatusLabel status={account.status} />
                    </td>
                    <td data-label={text.access}>
                      {account.roles.length
                        ? account.roles.map((role) => friendlyRoleText(role.name)).join(', ')
                        : text.noRole}
                    </td>
                    <td data-label={text.twoFactor}>
                      {account.twoFactorEnrolled ? text.setUp : text.notSetUp}
                    </td>
                    <td data-label={text.sessions}>{account.activeSessionCount}</td>
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
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const filtered = roles.filter((role) =>
    [friendlyRoleText(role.name), friendlyRoleDescription(role)].some((value) =>
      value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ),
  );
  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [query]);
  useEffect(() => setPage((value) => Math.min(value, totalPages)), [totalPages]);

  if (!roles.length) return <SecurityEmpty title={text.noRoles} detail={text.noRolesHint} />;
  return (
    <div className="security-role-list">
      <div className="security-role-list-heading">
        <div>
          <span>{text.roleDirectory}</span>
          <p>{text.roleDirectoryHint}</p>
          {!canApprove ? (
            <p className="security-role-read-only-hint">{text.rolePageAccessRequired}</p>
          ) : null}
        </div>
        <strong>
          {roles.length} {text.roles.toLocaleLowerCase()}
        </strong>
      </div>
      <div className="security-role-directory-search">
        <TextField
          id="security-role-directory-search"
          label={text.findRole}
          placeholder={text.searchRoles}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {!visible.length ? (
        <SecurityEmpty title={text.noMatchingRoles} detail={text.roleSearchHint} />
      ) : null}
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
      setError(text.sessionRevokeError);
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
                  {event.action === 'auth.login.failed'
                    ? text.signInAttemptFor(event.targetDisplayName ?? text.unrecognizedAccount)
                    : (event.actorDisplayName ?? text.system)}{' '}
                  · {formatDate(event.occurredAt)}
                </span>
                <small className="security-audit-target">
                  {humanTarget(event.targetType)}
                  {event.targetId ? (
                    <TechnicalIdentifier kind="targetRecord" value={event.targetId} />
                  ) : null}
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
      subtitle={text.createAccountHint}
      onClose={onClose}
      busy={busy}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button disabled={busy} onClick={onClose} variant="secondary">
            {text.cancel}
          </Button>
          <Button busy={busy} busyLabel={text.createAccount} type="submit">
            {text.addEmployee}
          </Button>
        </>
      }
    >
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
        label={text.employeeNumber}
        onChange={(e) => setDraft({ ...draft, employeeNumber: e.target.value })}
        required
        value={draft.employeeNumber}
      />
      <TextField
        id="security-employee-email"
        label={text.workEmail}
        onChange={(e) => setDraft({ ...draft, email: e.target.value })}
        required
        type="email"
        value={draft.email}
      />
      <TextField
        hint={text.temporaryPasswordHint}
        id="security-employee-password"
        label={text.initialPassword}
        showPasswordLabel={text.showPassword}
        hidePasswordLabel={text.hidePassword}
        onChange={(e) => setDraft({ ...draft, initialPassword: e.target.value })}
        required
        type="password"
        value={draft.initialPassword}
      />
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
      subtitle={text.createRoleHint}
      onClose={onClose}
      busy={busy}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button disabled={busy} onClick={onClose} variant="secondary">
            {text.cancel}
          </Button>
          <Button busy={busy} busyLabel={text.createRole} type="submit">
            {text.addRole}
          </Button>
        </>
      }
      wide
    >
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
          hint={text.roleCodeHint}
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
          disabled={!administrativeSession || busy}
          onChange={(e) => setDraft({ ...draft, isAdministrative: e.target.checked })}
          type="checkbox"
        />
        <span>
          <strong>{text.adminRole}</strong>
          <small>{text.adminRoleHint}</small>
        </span>
      </label>
      <PermissionMatrix disabled={busy} selected={selected} onToggle={toggle} />
      <PermissionDependencyNotice selected={selected} />
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
      title={text.editRoleTitle(friendlyRoleText(role.name))}
      subtitle={text.editRoleHint}
      onClose={onClose}
      busy={busy}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <Button disabled={busy} onClick={onClose} variant="secondary">
            {text.cancel}
          </Button>
          <Button busy={busy} disabled={!editAllowed} busyLabel={text.saveRole} type="submit">
            {text.saveAccess}
          </Button>
        </>
      }
      wide
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {role.isAdministrative ? (
        <section className="security-role-protection">
          <Icon name="shield" size={18} />
          <span>
            <strong>{text.administrativeRole}</strong>
            <small>{text.administrativeRoleHint}</small>
          </span>
        </section>
      ) : null}
      {!editAllowed ? (
        <InlineAlert tone="warning">{text.administrativeRoleRequired}</InlineAlert>
      ) : null}
      <TextField
        id="security-role-edit-name"
        disabled={!editAllowed || busy}
        label={text.roleName}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        required
        value={draft.name}
      />
      <TextField
        id="security-role-edit-description"
        disabled={!editAllowed || busy}
        label={text.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        value={draft.description ?? ''}
      />
      <PermissionMatrix disabled={!editAllowed || busy} selected={selected} onToggle={toggle} />
      <PermissionDependencyNotice selected={selected} />
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
  const [query, setQuery] = useState('');
  const visibleModules = modules.filter((module) =>
    shortModule(module).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <fieldset className="security-permission-matrix" disabled={disabled}>
      <legend>{text.permissionsTitle}</legend>
      <p>{text.permissionsHint}</p>
      <div className="security-choice-toolbar">
        <TextField
          id="security-permission-search"
          label={text.findModule}
          type="search"
          placeholder={text.searchModules}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="security-selection-count" role="status">
          {text.selectedPermissionCount(selected.length)}
        </span>
      </div>
      <div className="security-permission-list">
        <div className="security-permission-head">
          <span>{text.module}</span>
          {actions.map((action) => (
            <span key={action}>{permissionActionLabel(action)}</span>
          ))}
        </div>
        {visibleModules.map((module) => (
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
        {!visibleModules.length ? (
          <p className="security-filter-empty">{text.noMatchingModules}</p>
        ) : null}
      </div>
    </fieldset>
  );
}

function PermissionDependencyNotice({ selected }: { selected: string[] }) {
  const missingView = modules.filter(
    (module) =>
      selected.some((permission) => permission.startsWith(`${module}:`)) &&
      !selected.includes(`${module}:view`),
  );
  if (!missingView.length) return null;
  const moduleList = formatModuleList(missingView.map(shortModule));
  return <InlineAlert tone="warning">{text.permissionWithoutView(moduleList)}</InlineAlert>;
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
  const [roleQuery, setRoleQuery] = useState('');
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
      title={text.employeeAccess}
      subtitle={account.email}
      onClose={onClose}
      busy={Boolean(busy)}
      footer={
        <>
          <Button disabled={Boolean(busy)} onClick={onClose} variant="secondary">
            {text.close}
          </Button>
          {canApprove ? (
            <Button
              busy={busy === 'roles'}
              disabled={
                Boolean(busy) ||
                sameSet(
                  selected,
                  account.roles.map((role) => role.id),
                )
              }
              onClick={() => void saveRoles()}
            >
              {text.saveRoles}
            </Button>
          ) : null}
        </>
      }
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
            <Button
              disabled={Boolean(busy)}
              onClick={() => onIssueRecovery(account)}
              variant="secondary"
            >
              {text.issueCode}
            </Button>
          </div>
        ) : null}
      </section>
      <fieldset className="security-role-assignment" disabled={!canApprove || Boolean(busy)}>
        <legend>{text.assignedRoles}</legend>
        <p>{text.assignedRolesHint}</p>
        <div className="security-choice-toolbar">
          <TextField
            id="security-assignment-search"
            label={text.findRole}
            type="search"
            placeholder={text.searchRoles}
            value={roleQuery}
            onChange={(event) => setRoleQuery(event.target.value)}
          />
          <span className="security-selection-count" role="status">
            {text.selectedRoleCount(selected.length)}
          </span>
        </div>
        {roles.length ? (
          <div className="security-role-choices">
            {roles
              .filter((role) =>
                friendlyRoleText(role.name)
                  .toLocaleLowerCase()
                  .includes(roleQuery.trim().toLocaleLowerCase()),
              )
              .map((role) => (
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
        {roles.length &&
        !roles.some((role) =>
          friendlyRoleText(role.name)
            .toLocaleLowerCase()
            .includes(roleQuery.trim().toLocaleLowerCase()),
        ) ? (
          <p className="security-filter-empty">{text.noMatchingRoles}</p>
        ) : null}
      </fieldset>
      {canApprove ? (
        <section className="security-account-status-actions">
          <div>
            <strong>{text.accountStatus}</strong>
            <span>{text.accountStatusHint}</span>
          </div>
          {account.status === 'disabled' ? (
            <Button
              busy={busy === 'active'}
              disabled={Boolean(busy)}
              onClick={() => void changeStatus('active')}
              variant="secondary"
            >
              {text.reactivate}
            </Button>
          ) : (
            <Button
              busy={busy === 'disabled'}
              disabled={Boolean(busy) || account.accountId === currentAccountId}
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
  const [reason, setReason] = useState(text.identityVerified);
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
      busy={busy}
      subtitle={handoff ? text.shareRecoveryCode : text.verifyIdentityFirst}
      title={handoff ? text.recoveryIssuedTitle : text.recoveryTitle(account.displayName)}
      onSubmit={handoff ? undefined : (event) => void issue(event)}
      footer={
        handoff ? (
          <Button onClick={onClose}>{text.closeHandoff}</Button>
        ) : (
          <>
            <Button disabled={busy} onClick={onClose} variant="secondary">
              {text.cancel}
            </Button>
            <Button busy={busy} busyLabel={text.issuingCode} type="submit">
              {text.issueRecoveryCode}
            </Button>
          </>
        )
      }
    >
      {handoff ? (
        <section className="security-recovery-issued" aria-live="polite">
          <InlineAlert title={text.recoveryCodeOnce} tone="warning">
            {text.recoveryExpiry(formatDate(handoff.expiresAt))}
          </InlineAlert>
          <div className="security-recovery-recipient">
            <span>{text.employee}</span>
            <strong>{handoff.email}</strong>
          </div>
          <div className="security-recovery-code">
            <span>{text.oneTimeCode}</span>
            <code>{handoff.recoveryCode}</code>
          </div>
        </section>
      ) : (
        <>
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <div className="security-recovery-recipient">
            <span>{text.employee}</span>
            <strong>{account.email}</strong>
          </div>
          <div className="vista-field">
            <label htmlFor="recovery-handoff-reason">{text.recoveryNote}</label>
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
            <p className="vista-field-message">{text.recoveryNoteHint}</p>
          </div>
        </>
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
  busy = false,
  footer,
  onSubmit,
}: {
  ariaLabel?: string;
  children: React.ReactNode;
  onClose: () => void;
  subtitle?: string;
  title: string;
  wide?: boolean;
  busy?: boolean;
  footer?: React.ReactNode;
  onSubmit?: ((event: FormEvent<HTMLFormElement>) => void) | undefined;
}) {
  return (
    <AdminDrawer
      ariaLabel={ariaLabel}
      title={title}
      subtitle={subtitle}
      eyebrow={text.title}
      backLabel={text.backSecurity}
      backText={text.back}
      closeLabel={text.closePanel}
      className="security-panel"
      busy={busy}
      onClose={onClose}
      footer={footer}
      onSubmit={onSubmit}
      wide={wide}
    >
      {children}
    </AdminDrawer>
  );
}

function StatusLabel({ status }: { status: SecurityAccount['status'] }) {
  return (
    <span className={`security-status security-status--${status}`}>
      {status === 'active' ? text.active : status === 'disabled' ? text.disabled : text.locked}
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
  return text.moduleName(module);
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
  return text.actionName(action);
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
  if (role.code.startsWith('dev-fixture-')) {
    const fixtureKey = role.code.slice('dev-fixture-'.length);
    const localized = text.fixtureRoleDescription(fixtureKey);
    if (role.version === 1 && localized) return localized;
  }
  if (/development fixture role/iu.test(role.description ?? ''))
    return summarizeRolePermissions(role.permissions);
  return role.description ? friendlyRoleText(role.description) : text.noDescription;
}
function summarizeRolePermissions(permissions: SecurityRole['permissions']): string {
  const grouped = new Map<string, Set<string>>();
  for (const permission of permissions) {
    const moduleActions = grouped.get(permission.module) ?? new Set<string>();
    moduleActions.add(permission.action);
    grouped.set(permission.module, moduleActions);
  }
  const manageable: string[] = [];
  const viewOnly: string[] = [];
  const limited: string[] = [];
  for (const [module, moduleActions] of grouped) {
    if (moduleActions.has('view')) {
      (moduleActions.size > 1 ? manageable : viewOnly).push(shortModule(module));
    } else {
      limited.push(shortModule(module));
    }
  }
  const descriptions = [
    manageable.length ? text.roleManageSummary(formatModuleList(manageable)) : '',
    viewOnly.length ? text.roleViewSummary(formatModuleList(viewOnly)) : '',
    limited.length ? text.roleLimitedSummary(formatModuleList(limited)) : '',
  ].filter(Boolean);
  return descriptions.join(' ') || text.roleNoPermissions;
}
function formatModuleList(values: string[]): string {
  return new Intl.ListFormat(getOperationsLocale() === 'bg' ? 'bg' : 'en', {
    style: 'long',
    type: 'conjunction',
  }).format(values);
}
function formatDate(value: string): string {
  return formatOperationsDate(new Date(value), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  });
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
