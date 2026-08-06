import { Button, InlineAlert, TextField } from '@vista/ui';
import type {
  CreatePartnerRequest,
  PartnerKind,
  PartnerPage,
  PartnerRole,
  PartnerSummary,
} from '@vista/contracts';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { createPartner, listPartners } from '../api/partners';
import { ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { messages } from '../messages';

type OptionalKind = '' | PartnerKind;
type OptionalRole = '' | PartnerRole;

interface PartnerDraft {
  companyRepresentative: string;
  displayName: string;
  kind: PartnerKind;
  roles: PartnerRole[];
  uic: string;
  vatNumber: string;
}

const emptyDraft: PartnerDraft = {
  companyRepresentative: '',
  displayName: '',
  kind: 'legal_entity',
  roles: ['customer'],
  uic: '',
  vatNumber: '',
};

export function PartnersPage() {
  const { hasPermission, session } = useAuth();
  const [data, setData] = useState<PartnerPage | null>(null);
  const [error, setError] = useState(false);
  const [kind, setKind] = useState<OptionalKind>('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [role, setRole] = useState<OptionalRole>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PartnerSummary | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [success, setSuccess] = useState('');

  const token = session?.sessionToken;
  useEffect(() => {
    if (!token) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      void listPartners(token, {
        direction: 'asc',
        ...(kind ? { kind } : {}),
        page,
        pageSize: 25,
        ...(role ? { role } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        sortBy: 'displayName',
      })
        .then((result) => {
          if (active) setData(result);
        })
        .catch(() => {
          if (active) setError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [kind, page, refresh, role, search, token]);

  const canCreate = hasPermission('crm', 'create');
  const hasFilters = Boolean(kind || role || search.trim());

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function created(partner: PartnerSummary) {
    setShowCreate(false);
    setSelected(partner);
    setSuccess(messages.partners.created);
    setRefresh((value) => value + 1);
  }

  return (
    <div className="page-stack partners-page">
      <header className="page-header partners-header">
        <div>
          <p className="page-eyebrow">{messages.partners.eyebrow}</p>
          <h1>{messages.partners.title}</h1>
          <p>{messages.partners.subtitle}</p>
        </div>
        {canCreate ? (
          <Button className="partners-create-button" onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={17} />
            {messages.partners.create}
          </Button>
        ) : null}
      </header>

      {success ? (
        <InlineAlert tone="success">
          <div className="partners-inline-message">
            <span>{success}</span>
            <button onClick={() => setSuccess('')} type="button">
              {messages.partners.close}
            </button>
          </div>
        </InlineAlert>
      ) : null}

      <section className="partner-registry" aria-labelledby="partner-registry-heading">
        <div className="partner-toolbar">
          <div className="partner-search">
            <Icon name="search" size={18} />
            <label className="sr-only" htmlFor="partner-search">
              {messages.partners.search}
            </label>
            <input
              autoComplete="off"
              id="partner-search"
              onChange={(event) => changeSearch(event.target.value)}
              placeholder={messages.partners.searchPlaceholder}
              type="search"
              value={search}
            />
          </div>
          <FilterSelect
            id="partner-role-filter"
            label={messages.partners.filterRole}
            onChange={(value) => {
              setRole(value as OptionalRole);
              setPage(1);
            }}
            options={[
              ['', messages.partners.allRoles],
              ['customer', messages.partners.roleCustomer],
              ['supplier', messages.partners.roleSupplier],
              ['partner', messages.partners.rolePartner],
            ]}
            value={role}
          />
          <FilterSelect
            id="partner-kind-filter"
            label={messages.partners.filterKind}
            onChange={(value) => {
              setKind(value as OptionalKind);
              setPage(1);
            }}
            options={[
              ['', messages.partners.allKinds],
              ['legal_entity', messages.partners.legalEntity],
              ['individual', messages.partners.individual],
            ]}
            value={kind}
          />
        </div>

        <div className="registry-meta">
          <h2 id="partner-registry-heading">{messages.partners.title}</h2>
          <span aria-live="polite">
            {data && !loading ? messages.partners.results(data.total) : '\u00a0'}
          </span>
        </div>

        {loading && !data ? <RegistrySkeleton /> : null}
        {error ? (
          <RegistryState title={messages.partners.listError}>
            <Button onClick={() => setRefresh((value) => value + 1)} variant="secondary">
              {messages.partners.retry}
            </Button>
          </RegistryState>
        ) : null}
        {!error && data && data.items.length === 0 ? (
          <RegistryState title={messages.partners.emptyTitle}>
            <p>{messages.partners.emptyDescription}</p>
            {!hasFilters && canCreate ? (
              <Button onClick={() => setShowCreate(true)} variant="secondary">
                <Icon name="plus" size={16} />
                {messages.partners.emptyAction}
              </Button>
            ) : null}
          </RegistryState>
        ) : null}
        {!error && data && data.items.length > 0 ? (
          <>
            <PartnerTable items={data.items} onSelect={setSelected} />
            <nav aria-label="Partner pagination" className="registry-pagination">
              <Button
                disabled={data.page <= 1 || loading}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                variant="quiet"
              >
                {messages.partners.previous}
              </Button>
              <span>{messages.partners.pageOf(data.page, data.totalPages)}</span>
              <Button
                disabled={data.page >= data.totalPages || loading}
                onClick={() => setPage((value) => value + 1)}
                variant="quiet"
              >
                {messages.partners.next}
              </Button>
            </nav>
          </>
        ) : null}
      </section>

      {showCreate && token ? (
        <CreatePartnerDrawer
          onClose={() => setShowCreate(false)}
          onCreated={created}
          token={token}
        />
      ) : null}
      {selected ? (
        <PartnerDetailDrawer onClose={() => setSelected(null)} partner={selected} />
      ) : null}
    </div>
  );
}

function PartnerTable({
  items,
  onSelect,
}: {
  items: PartnerSummary[];
  onSelect: (partner: PartnerSummary) => void;
}) {
  return (
    <div className="partner-table-wrap">
      <table className="partner-table">
        <thead>
          <tr>
            <th>{messages.partners.name}</th>
            <th>{messages.partners.roles}</th>
            <th>{messages.partners.type}</th>
            <th>{messages.partners.uic}</th>
            <th>{messages.partners.updated}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((partner) => (
            <tr key={partner.id}>
              <td data-label={messages.partners.name}>
                <button
                  className="partner-name-button"
                  onClick={() => onSelect(partner)}
                  type="button"
                >
                  <span className="partner-monogram" aria-hidden="true">
                    {monogram(partner.displayName)}
                  </span>
                  <span>
                    <strong>{partner.displayName}</strong>
                    <small>{partner.vatNumber ?? partner.id.slice(0, 8)}</small>
                  </span>
                </button>
              </td>
              <td data-label={messages.partners.roles}>
                <div className="partner-role-list">
                  {partner.roles.map((role) => (
                    <span className={`partner-role partner-role--${role}`} key={role}>
                      {roleLabel(role)}
                    </span>
                  ))}
                </div>
              </td>
              <td data-label={messages.partners.type}>{kindLabel(partner.kind)}</td>
              <td data-label={messages.partners.uic} className="partner-identifier">
                {partner.uic ?? '—'}
              </td>
              <td data-label={messages.partners.updated}>{formatDate(partner.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreatePartnerDrawer({
  onClose,
  onCreated,
  token,
}: {
  onClose: () => void;
  onCreated: (partner: PartnerSummary) => void;
  token: string;
}) {
  const [draft, setDraft] = useState<PartnerDraft>(emptyDraft);
  const [duplicate, setDuplicate] = useState<ApiClientError | null>(null);
  const [nameError, setNameError] = useState('');
  const [roleError, setRoleError] = useState('');
  const [saveError, setSaveError] = useState<ApiClientError | null>(null);
  const [saving, setSaving] = useState(false);
  const lastAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  useDrawerEscape(onClose);

  function update<K extends keyof PartnerDraft>(key: K, value: PartnerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDuplicate(null);
    setSaveError(null);
  }

  function toggleRole(role: PartnerRole) {
    const roles = draft.roles.includes(role)
      ? draft.roles.filter((item) => item !== role)
      : [...draft.roles, role];
    update('roles', roles);
    setRoleError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = draft.displayName.trim();
    setNameError(displayName ? '' : `${messages.partners.name} is required.`);
    setRoleError(draft.roles.length > 0 ? '' : 'Choose at least one role.');
    if (!displayName || draft.roles.length === 0) return;

    const input: CreatePartnerRequest = {
      displayName,
      kind: draft.kind,
      roles: [...draft.roles].sort(),
      ...(draft.kind === 'legal_entity' && draft.companyRepresentative.trim()
        ? { companyRepresentative: draft.companyRepresentative.trim() }
        : {}),
      ...(draft.kind === 'legal_entity' && draft.uic.trim() ? { uic: draft.uic.trim() } : {}),
      ...(draft.kind === 'legal_entity' && draft.vatNumber.trim()
        ? { vatNumber: draft.vatNumber.trim() }
        : {}),
    };
    const fingerprint = JSON.stringify(input);
    const attempt =
      lastAttempt.current?.fingerprint === fingerprint
        ? lastAttempt.current
        : { fingerprint, key: crypto.randomUUID() };
    lastAttempt.current = attempt;
    setSaving(true);
    setDuplicate(null);
    setSaveError(null);
    try {
      onCreated(await createPartner(token, attempt.key, input));
    } catch (caught) {
      const apiError =
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(messages.partners.saveError, 'UNKNOWN', 0);
      if (apiError.code === 'PARTNER_DUPLICATE_CANDIDATE') setDuplicate(apiError);
      else setSaveError(apiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer onClose={onClose} title={messages.partners.createTitle}>
      <div className="drawer-heading">
        <p className="page-eyebrow">{messages.partners.createEyebrow}</p>
        <h2>{messages.partners.createTitle}</h2>
        <p>{messages.partners.createDescription}</p>
      </div>
      <form className="partner-form" onSubmit={(event) => void submit(event)}>
        <fieldset className="partner-type-fieldset">
          <legend>{messages.partners.type}</legend>
          <div className="partner-segmented-control">
            {(['legal_entity', 'individual'] as const).map((value) => (
              <label className={draft.kind === value ? 'is-selected' : ''} key={value}>
                <input
                  checked={draft.kind === value}
                  name="partner-kind"
                  onChange={() => update('kind', value)}
                  type="radio"
                  value={value}
                />
                {kindLabel(value)}
              </label>
            ))}
          </div>
        </fieldset>

        <TextField
          autoFocus
          error={nameError}
          hint={messages.partners.nameHint}
          id="partner-name"
          label={messages.partners.name}
          maxLength={255}
          onChange={(event) => {
            update('displayName', event.target.value);
            setNameError('');
          }}
          required
          value={draft.displayName}
        />

        {draft.kind === 'legal_entity' ? (
          <>
            <div className="partner-form-row">
              <TextField
                id="partner-uic"
                label={messages.partners.uic}
                maxLength={50}
                onChange={(event) => update('uic', event.target.value)}
                value={draft.uic}
              />
              <TextField
                id="partner-vat-number"
                label={messages.partners.vatNumber}
                maxLength={50}
                onChange={(event) => update('vatNumber', event.target.value)}
                value={draft.vatNumber}
              />
            </div>
            <TextField
              id="partner-company-representative"
              label={messages.partners.companyRepresentative}
              maxLength={255}
              onChange={(event) => update('companyRepresentative', event.target.value)}
              value={draft.companyRepresentative}
            />
          </>
        ) : null}

        <fieldset className="partner-role-fieldset">
          <legend>{messages.partners.roles}</legend>
          <div>
            {(['customer', 'supplier', 'partner'] as const).map((value) => (
              <label key={value}>
                <input
                  checked={draft.roles.includes(value)}
                  onChange={() => toggleRole(value)}
                  type="checkbox"
                />
                <span>{roleLabel(value)}</span>
              </label>
            ))}
          </div>
          {roleError ? <p className="partner-field-error">{roleError}</p> : null}
        </fieldset>

        {duplicate ? (
          <InlineAlert title={messages.partners.duplicateTitle} tone="warning">
            <p>{messages.partners.duplicateDescription}</p>
            {duplicate.details.length > 0 ? (
              <ul className="duplicate-candidates">
                {duplicate.details.map((detail) => (
                  <li key={`${detail.field ?? 'partner'}:${detail.message}`}>{detail.message}</li>
                ))}
              </ul>
            ) : null}
          </InlineAlert>
        ) : null}
        {saveError ? (
          <InlineAlert title={messages.partners.saveError} tone="error">
            <p>{saveError.message}</p>
            {saveError.correlationId ? (
              <small>
                {messages.partners.reference}: {saveError.correlationId.slice(0, 12)}
              </small>
            ) : null}
          </InlineAlert>
        ) : null}

        <div className="drawer-actions">
          <Button disabled={saving} onClick={onClose} variant="quiet">
            {messages.partners.close}
          </Button>
          <Button busy={saving} busyLabel={messages.partners.saving} type="submit">
            {messages.partners.save}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function PartnerDetailDrawer({
  onClose,
  partner,
}: {
  onClose: () => void;
  partner: PartnerSummary;
}) {
  useDrawerEscape(onClose);
  const details = useMemo(
    () => [
      [messages.partners.type, kindLabel(partner.kind)],
      [messages.partners.status, partner.active ? messages.partners.active : '—'],
      [messages.partners.uic, partner.uic ?? '—'],
      [messages.partners.vatNumber, partner.vatNumber ?? '—'],
      [messages.partners.companyRepresentative, partner.companyRepresentative ?? '—'],
      [messages.partners.updated, formatDate(partner.updatedAt)],
    ],
    [partner],
  );
  return (
    <Drawer onClose={onClose} title={messages.partners.detailsTitle}>
      <div className="partner-detail-identity">
        <span className="partner-monogram" aria-hidden="true">
          {monogram(partner.displayName)}
        </span>
        <div>
          <p className="page-eyebrow">{messages.partners.detailsEyebrow}</p>
          <h2>{partner.displayName}</h2>
          <div className="partner-role-list">
            {partner.roles.map((role) => (
              <span className={`partner-role partner-role--${role}`} key={role}>
                {roleLabel(role)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <dl className="partner-detail-list">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="partner-record-reference">
        <span>{messages.partners.reference}</span>
        <code>{partner.id}</code>
      </div>
    </Drawer>
  );
}

function Drawer({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="drawer-layer">
      <button
        aria-label={messages.partners.close}
        className="drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <aside aria-label={title} aria-modal="true" className="record-drawer" role="dialog">
        <button
          aria-label={messages.partners.close}
          className="drawer-close"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" />
        </button>
        {children}
      </aside>
    </div>
  );
}

function FilterSelect({
  id,
  label,
  onChange,
  options,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<readonly [string, string]>;
  value: string;
}) {
  return (
    <div className="partner-filter">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select id={id} onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function RegistryState({ children, title }: { children?: React.ReactNode; title: string }) {
  return (
    <div className="registry-state">
      <span className="registry-state-mark" aria-hidden="true">
        <Icon name="customers" size={22} />
      </span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function RegistrySkeleton() {
  return (
    <div aria-label={messages.states.loading} className="registry-skeleton" role="status">
      {[0, 1, 2, 3, 4].map((item) => (
        <span key={item} />
      ))}
    </div>
  );
}

function useDrawerEscape(onClose: () => void) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [onClose]);
}

function kindLabel(kind: PartnerKind): string {
  return kind === 'legal_entity' ? messages.partners.legalEntity : messages.partners.individual;
}

function roleLabel(role: PartnerRole): string {
  return {
    customer: messages.partners.roleCustomer,
    partner: messages.partners.rolePartner,
    supplier: messages.partners.roleSupplier,
  }[role];
}

function monogram(name: string): string {
  return name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
