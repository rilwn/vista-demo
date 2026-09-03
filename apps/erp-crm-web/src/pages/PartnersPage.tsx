import { Button, InlineAlert, TextField, Toast } from '@vista/ui';
import type {
  CreatePartnerAddressRequest,
  CreatePartnerBankAccountRequest,
  CreatePartnerContactRequest,
  CreatePartnerRequest,
  PartnerKind,
  PartnerPage,
  PartnerProfile,
  PartnerRole,
  PartnerSummary,
  UpdatePartnerRequest,
} from '@vista/contracts';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  createPartner,
  createPartnerAddress,
  createPartnerBankAccount,
  createPartnerContact,
  getPartnerProfile,
  listPartners,
  setPartnerActive,
  updatePartner,
} from '../api/partners';
import { ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { messages } from '../messages';
import { CustomerAssetsPanel } from './CustomerAssetsPanel';
import { CustomerOperationalOverviewPanel } from './CustomerOperationalOverviewPanel';
import { PartnerDocumentsPanel } from './PartnerDocumentsPanel';

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
        <Toast onDismiss={() => setSuccess('')} tone="success">
          {success}
        </Toast>
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
        <PartnerDetailDrawer
          canDelete={hasPermission('crm', 'delete')}
          canEdit={hasPermission('crm', 'edit')}
          onClose={() => setSelected(null)}
          onMaintained={(maintained) => {
            setSelected(maintained);
            setSuccess(`${maintained.displayName} was updated.`);
            setRefresh((value) => value + 1);
          }}
          partner={selected}
          token={token}
        />
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
  canDelete,
  canEdit,
  onClose,
  onMaintained,
  partner,
  token,
}: {
  canDelete: boolean;
  canEdit: boolean;
  onClose: () => void;
  onMaintained: (partner: PartnerSummary) => void;
  partner: PartnerSummary;
  token: string | undefined;
}) {
  useDrawerEscape(onClose);
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [adding, setAdding] = useState<'address' | 'bank' | 'contact' | null>(null);
  const [customerOverviewOpen, setCustomerOverviewOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const statusAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setProfileLoading(true);
    setProfileError(false);
    void getPartnerProfile(token, partner.id)
      .then((result) => {
        if (active) setProfile(result);
      })
      .catch(() => {
        if (active) setProfileError(true);
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [partner.id, refresh, token]);

  const current = profile?.partner ?? partner;
  const details = useMemo(
    () => [
      [messages.partners.type, kindLabel(current.kind)],
      [messages.partners.uic, current.uic ?? '—'],
      [messages.partners.vatNumber, current.vatNumber ?? '—'],
      [messages.partners.companyRepresentative, current.companyRepresentative ?? '—'],
      [messages.partners.updated, formatDate(current.updatedAt)],
    ],
    [current],
  );
  async function changeStatus() {
    if (!token) return;
    const payload = { active: !current.active, expectedVersion: current.version, id: current.id };
    const fingerprint = JSON.stringify(payload);
    if (statusAttempt.current?.fingerprint !== fingerprint)
      statusAttempt.current = { fingerprint, key: crypto.randomUUID() };
    setStatusBusy(true);
    setStatusError(null);
    try {
      const maintained = await setPartnerActive(
        token,
        current.id,
        !current.active,
        statusAttempt.current.key,
        { expectedVersion: current.version },
      );
      setProfile((value) => (value ? { ...value, partner: maintained } : value));
      onMaintained(maintained);
    } catch (caught) {
      setStatusError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The partner status could not be changed.',
      );
    } finally {
      setStatusBusy(false);
    }
  }
  if (documentsOpen && token) {
    return (
      <Drawer
        backLabel={messages.partners.documents.back}
        className="partner-documents-drawer"
        onBack={() => setDocumentsOpen(false)}
        onClose={onClose}
        title={messages.partners.documents.title}
      >
        <PartnerDocumentsPanel canEdit={canEdit} partnerId={current.id} token={token} />
      </Drawer>
    );
  }
  if (customerOverviewOpen && token) {
    return (
      <Drawer
        backLabel="Back to partner"
        className="customer-overview-drawer"
        onBack={() => setCustomerOverviewOpen(false)}
        onClose={onClose}
        title="Customer overview"
      >
        <CustomerOperationalOverviewPanel partnerId={current.id} token={token} />
      </Drawer>
    );
  }
  return (
    <Drawer
      className="partner-detail-drawer"
      onClose={onClose}
      title={messages.partners.detailsTitle}
    >
      <div className="partner-detail-identity">
        <span className="partner-monogram" aria-hidden="true">
          {monogram(current.displayName)}
        </span>
        <div className="partner-detail-identity-copy">
          <p className="page-eyebrow">{messages.partners.detailsEyebrow}</p>
          <h2>{current.displayName}</h2>
          <div className="partner-role-list">
            {current.roles.map((role) => (
              <span className={`partner-role partner-role--${role}`} key={role}>
                {roleLabel(role)}
              </span>
            ))}
          </div>
        </div>
        <span
          className={`partner-detail-status${current.active ? '' : ' is-inactive'}`}
          role="status"
        >
          {current.active ? messages.partners.active : 'Inactive'}
        </span>
      </div>
      <section className="partner-detail-summary" aria-labelledby="partner-registration-heading">
        <div className="partner-detail-section-heading">
          <h3 id="partner-registration-heading">Registration details</h3>
          <p>Identity and tax information used across ERP and CRM records.</p>
        </div>
        <dl className="partner-detail-list">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="partner-maintenance-actions">
        {token && current.roles.includes('customer') ? (
          <Button onClick={() => setCustomerOverviewOpen(true)}>Customer overview</Button>
        ) : null}
        {token ? (
          <Button onClick={() => setDocumentsOpen(true)} variant="secondary">
            {messages.partners.documents.open}
          </Button>
        ) : null}
        {canEdit ? (
          <Button onClick={() => setEditing((value) => !value)} variant="secondary">
            {editing ? 'Close editing' : 'Edit partner'}
          </Button>
        ) : null}
        {(current.active ? canDelete : canEdit) ? (
          <Button busy={statusBusy} onClick={() => void changeStatus()} variant="quiet">
            {current.active ? 'Deactivate partner' : 'Reactivate partner'}
          </Button>
        ) : null}
      </div>
      {statusError ? <InlineAlert tone="error">{statusError}</InlineAlert> : null}
      {editing && token ? (
        <PartnerMaintenanceForm
          onCancel={() => setEditing(false)}
          onSaved={(maintained) => {
            setEditing(false);
            setProfile((value) => (value ? { ...value, partner: maintained } : value));
            onMaintained(maintained);
          }}
          partner={current}
          token={token}
        />
      ) : null}
      <section className="partner-profile" aria-label={messages.partners.profileTitle}>
        <div className="partner-profile-heading">
          <div>
            <p className="page-eyebrow">{messages.partners.profileEyebrow}</p>
            <h3>{messages.partners.profileTitle}</h3>
          </div>
        </div>
        {profileLoading ? <ProfileSkeleton /> : null}
        {profileError ? (
          <InlineAlert tone="error">
            <div className="partners-inline-message">
              <span>{messages.partners.profileError}</span>
              <button onClick={() => setRefresh((value) => value + 1)} type="button">
                {messages.partners.retry}
              </button>
            </div>
          </InlineAlert>
        ) : null}
        {!profileLoading && !profileError && profile ? (
          <div className="partner-profile-sections">
            <ProfileSection
              {...(canEdit ? { action: () => setAdding('address') } : {})}
              actionLabel={messages.partners.addAddress}
              empty={messages.partners.noAddresses}
              hasRecords={profile.addresses.length > 0}
              title={messages.partners.addresses}
            >
              {profile.addresses.map((address) => (
                <article className="partner-profile-item" key={address.id}>
                  <strong>{addressTypeLabel(address.type)}</strong>
                  <span>
                    {[address.addressLine1, address.addressLine2].filter(Boolean).join(', ')}
                  </span>
                  <small>
                    {[address.postalCode, address.city, address.countryCode]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </article>
              ))}
            </ProfileSection>
            <ProfileSection
              {...(canEdit ? { action: () => setAdding('contact') } : {})}
              actionLabel={messages.partners.addContact}
              empty={messages.partners.noContacts}
              hasRecords={profile.contacts.length > 0}
              title={messages.partners.contacts}
            >
              {profile.contacts.map((contact) => (
                <article className="partner-profile-item" key={contact.id}>
                  <strong>{contact.displayName}</strong>
                  <span>{[contact.jobTitle, contact.contactRole].filter(Boolean).join(' · ')}</span>
                  <small>{[contact.telephone, contact.email].filter(Boolean).join(' · ')}</small>
                </article>
              ))}
            </ProfileSection>
            <ProfileSection
              {...(canEdit ? { action: () => setAdding('bank') } : {})}
              actionLabel={messages.partners.addBankAccount}
              empty={messages.partners.noBankAccounts}
              hasRecords={profile.bankAccounts.length > 0}
              title={messages.partners.bankAccounts}
            >
              {profile.bankAccounts.map((bankAccount) => (
                <article className="partner-profile-item" key={bankAccount.id}>
                  <strong>{bankAccount.iban}</strong>
                  <span>{bankAccount.bankName ?? '—'}</span>
                  <small>
                    {[bankAccount.currencyCode, bankAccount.bic].filter(Boolean).join(' · ')}
                  </small>
                </article>
              ))}
            </ProfileSection>
          </div>
        ) : null}
      </section>
      {current.roles.includes('customer') && profile && token ? (
        <CustomerAssetsPanel
          canDelete={canDelete}
          canEdit={canEdit}
          contacts={profile.contacts}
          partnerId={current.id}
          token={token}
        />
      ) : null}
      <div className="partner-record-reference">
        <span>{messages.partners.reference}</span>
        <code>{current.id}</code>
      </div>
      {adding && token ? (
        <ProfileRecordForm
          kind={adding}
          onClose={() => setAdding(null)}
          onCreated={() => {
            setAdding(null);
            setRefresh((value) => value + 1);
          }}
          partnerId={partner.id}
          token={token}
        />
      ) : null}
    </Drawer>
  );
}

function PartnerMaintenanceForm({
  onCancel,
  onSaved,
  partner,
  token,
}: {
  onCancel: () => void;
  onSaved: (partner: PartnerSummary) => void;
  partner: PartnerSummary;
  token: string;
}) {
  const [draft, setDraft] = useState<PartnerDraft>({
    companyRepresentative: partner.companyRepresentative ?? '',
    displayName: partner.displayName,
    kind: partner.kind,
    roles: partner.roles,
    uic: partner.uic ?? '',
    vatNumber: partner.vatNumber ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  function change<K extends keyof PartnerDraft>(field: K, value: PartnerDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: UpdatePartnerRequest = {
      displayName: draft.displayName.trim(),
      expectedVersion: partner.version,
      kind: draft.kind,
      roles: [...draft.roles].sort(),
      ...(draft.companyRepresentative.trim()
        ? { companyRepresentative: draft.companyRepresentative.trim() }
        : {}),
      ...(draft.uic.trim() ? { uic: draft.uic.trim() } : {}),
      ...(draft.vatNumber.trim() ? { vatNumber: draft.vatNumber.trim() } : {}),
    };
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    setSaving(true);
    setError(null);
    try {
      onSaved(await updatePartner(token, partner.id, attempt.current.key, input));
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'The partner could not be updated.',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="partner-form partner-maintenance-form"
      onSubmit={(event) => void submit(event)}
    >
      <div className="partner-form-row">
        <TextField
          id="maintain-partner-name"
          label="Partner name"
          maxLength={255}
          onChange={(event) => change('displayName', event.target.value)}
          required
          value={draft.displayName}
        />
        <label className="customer-asset-select" htmlFor="maintain-partner-kind">
          <span>Partner type</span>
          <select
            id="maintain-partner-kind"
            onChange={(event) => change('kind', event.target.value as PartnerKind)}
            value={draft.kind}
          >
            <option value="legal_entity">Legal entity</option>
            <option value="individual">Individual</option>
          </select>
        </label>
      </div>
      <div className="partner-form-row">
        <TextField
          id="maintain-partner-uic"
          label="UIC"
          maxLength={50}
          onChange={(event) => change('uic', event.target.value)}
          value={draft.uic}
        />
        <TextField
          id="maintain-partner-vat"
          label="VAT number"
          maxLength={50}
          onChange={(event) => change('vatNumber', event.target.value)}
          value={draft.vatNumber}
        />
      </div>
      <TextField
        id="maintain-partner-representative"
        label="Company representative"
        maxLength={255}
        onChange={(event) => change('companyRepresentative', event.target.value)}
        value={draft.companyRepresentative}
      />
      <fieldset className="partner-role-fieldset">
        <legend>Roles</legend>
        <div>
          {(['customer', 'supplier', 'partner'] as const).map((role) => (
            <label key={role}>
              <input
                checked={draft.roles.includes(role)}
                onChange={() =>
                  change(
                    'roles',
                    draft.roles.includes(role)
                      ? draft.roles.filter((item) => item !== role)
                      : [...draft.roles, role],
                  )
                }
                type="checkbox"
              />
              <span>{roleLabel(role)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="drawer-actions">
        <Button onClick={onCancel} variant="quiet">
          Cancel
        </Button>
        <Button
          busy={saving}
          disabled={!draft.displayName.trim() || draft.roles.length === 0}
          type="submit"
        >
          Save partner changes
        </Button>
      </div>
    </form>
  );
}

function ProfileSection({
  action,
  actionLabel,
  children,
  empty,
  hasRecords,
  title,
}: {
  action?: () => void;
  actionLabel: string;
  children: React.ReactNode;
  empty: string;
  hasRecords: boolean;
  title: string;
}) {
  return (
    <section className="partner-profile-section">
      <div className="partner-profile-section-heading">
        <h4>{title}</h4>
        {action ? (
          <Button className="partner-profile-add" onClick={action} variant="quiet">
            <Icon name="plus" size={14} />
            {actionLabel}
          </Button>
        ) : null}
      </div>
      {hasRecords ? <div className="partner-profile-list">{children}</div> : <p>{empty}</p>}
    </section>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-label={messages.states.loading} className="partner-profile-skeleton" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

type ProfileRecordKind = 'address' | 'bank' | 'contact';

interface ProfileFormField {
  autoFocus?: boolean;
  label: string;
  maxLength?: number;
  name: string;
  options?: ReadonlyArray<readonly [string, string]>;
  required?: boolean;
  type?: 'email' | 'text';
  wide?: boolean;
}

interface ProfileFormContent {
  fields: ProfileFormField[];
  submit: string;
  title: string;
}

function ProfileRecordForm({
  kind,
  onClose,
  onCreated,
  partnerId,
  token,
}: {
  kind: ProfileRecordKind;
  onClose: () => void;
  onCreated: () => void;
  partnerId: string;
  token: string;
}) {
  const [error, setError] = useState<ApiClientError | null>(null);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({
    countryCode: 'BG',
    currencyCode: 'BGN',
    type: 'registered',
  });
  const lastAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const content = profileFormContent(kind);

  function update(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = profileInput(kind, values);
    const fingerprint = JSON.stringify(input);
    const attempt =
      lastAttempt.current?.fingerprint === fingerprint
        ? lastAttempt.current
        : { fingerprint, key: crypto.randomUUID() };
    lastAttempt.current = attempt;
    setSaving(true);
    setError(null);
    try {
      if (kind === 'address') {
        await createPartnerAddress(
          token,
          partnerId,
          attempt.key,
          input as CreatePartnerAddressRequest,
        );
      } else if (kind === 'contact') {
        await createPartnerContact(
          token,
          partnerId,
          attempt.key,
          input as CreatePartnerContactRequest,
        );
      } else {
        await createPartnerBankAccount(
          token,
          partnerId,
          attempt.key,
          input as CreatePartnerBankAccountRequest,
        );
      }
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(messages.partners.profileSaveError, 'UNKNOWN', 0),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label={content.title} className="partner-profile-form-shell">
      <div className="partner-profile-section-heading">
        <h4>{content.title}</h4>
        <button
          aria-label={messages.partners.close}
          className="profile-form-close"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <form className="partner-profile-form" onSubmit={(event) => void submit(event)}>
        {content.fields.map((field) => (
          <label className={field.wide ? 'is-wide' : ''} key={field.name}>
            <span>{field.label}</span>
            {field.options ? (
              <select
                name={field.name}
                onChange={(event) => update(field.name, event.target.value)}
                value={values[field.name] ?? ''}
              >
                {field.options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                autoFocus={field.autoFocus}
                maxLength={field.maxLength}
                name={field.name}
                onChange={(event) => update(field.name, event.target.value)}
                required={field.required}
                type={field.type ?? 'text'}
                value={values[field.name] ?? ''}
              />
            )}
          </label>
        ))}
        {error ? (
          <InlineAlert title={messages.partners.profileSaveError} tone="error">
            <p>{error.message}</p>
          </InlineAlert>
        ) : null}
        <div className="drawer-actions">
          <Button disabled={saving} onClick={onClose} variant="quiet">
            {messages.partners.close}
          </Button>
          <Button busy={saving} busyLabel={messages.partners.savingProfile} type="submit">
            {content.submit}
          </Button>
        </div>
      </form>
    </section>
  );
}

function profileFormContent(kind: ProfileRecordKind): ProfileFormContent {
  if (kind === 'address') {
    return {
      fields: [
        { label: messages.partners.addressType, name: 'type', options: addressTypeOptions },
        {
          autoFocus: true,
          label: messages.partners.addressLine1,
          maxLength: 255,
          name: 'addressLine1',
          required: true,
          wide: true,
        },
        { label: messages.partners.addressLine2, maxLength: 255, name: 'addressLine2', wide: true },
        { label: messages.partners.postalCode, maxLength: 30, name: 'postalCode' },
        { label: messages.partners.city, maxLength: 150, name: 'city', required: true },
        { label: messages.partners.countryCode, maxLength: 2, name: 'countryCode', required: true },
      ],
      submit: messages.partners.saveAddress,
      title: messages.partners.addAddress,
    };
  }
  if (kind === 'contact') {
    return {
      fields: [
        {
          autoFocus: true,
          label: messages.partners.contactName,
          maxLength: 255,
          name: 'displayName',
          required: true,
          wide: true,
        },
        { label: messages.partners.jobTitle, maxLength: 150, name: 'jobTitle' },
        { label: messages.partners.contactRole, maxLength: 100, name: 'contactRole' },
        { label: messages.partners.telephone, maxLength: 100, name: 'telephone' },
        { label: messages.partners.email, maxLength: 320, name: 'email', type: 'email' },
      ],
      submit: messages.partners.saveContact,
      title: messages.partners.addContact,
    };
  }
  return {
    fields: [
      {
        autoFocus: true,
        label: messages.partners.iban,
        maxLength: 64,
        name: 'iban',
        required: true,
        wide: true,
      },
      { label: messages.partners.bankName, maxLength: 255, name: 'bankName' },
      { label: messages.partners.bic, maxLength: 11, name: 'bic' },
      { label: messages.partners.currencyCode, maxLength: 3, name: 'currencyCode', required: true },
    ],
    submit: messages.partners.saveBankAccount,
    title: messages.partners.addBankAccount,
  };
}

function profileInput(kind: ProfileRecordKind, values: Record<string, string>) {
  const withOptional = (name: string) => (values[name]?.trim() ? { [name]: values[name] } : {});
  if (kind === 'address') {
    return {
      addressLine1: values['addressLine1'] ?? '',
      city: values['city'] ?? '',
      countryCode: values['countryCode'] ?? 'BG',
      type: (values['type'] ?? 'registered') as CreatePartnerAddressRequest['type'],
      ...withOptional('addressLine2'),
      ...withOptional('postalCode'),
    };
  }
  if (kind === 'contact') {
    return {
      displayName: values['displayName'] ?? '',
      ...withOptional('contactRole'),
      ...withOptional('email'),
      ...withOptional('jobTitle'),
      ...withOptional('telephone'),
    };
  }
  return {
    currencyCode: values['currencyCode'] ?? 'BGN',
    iban: values['iban'] ?? '',
    ...withOptional('bankName'),
    ...withOptional('bic'),
  };
}

const addressTypeOptions = [
  ['registered', messages.partners.addressTypeRegistered],
  ['billing', messages.partners.addressTypeBilling],
  ['delivery', messages.partners.addressTypeDelivery],
  ['other', messages.partners.addressTypeOther],
] as const;

function addressTypeLabel(type: CreatePartnerAddressRequest['type']): string {
  return Object.fromEntries(addressTypeOptions)[type] ?? type;
}

function Drawer({
  backLabel = 'Back',
  children,
  className,
  onBack,
  onClose,
  title,
}: {
  backLabel?: string;
  children: React.ReactNode;
  className?: string;
  onBack?: () => void;
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
      <aside
        aria-label={title}
        aria-modal="true"
        className={['record-drawer', className].filter(Boolean).join(' ')}
        role="dialog"
      >
        <div className="record-drawer-navigation">
          <button
            aria-label={backLabel}
            className="panel-back-button"
            onClick={onBack ?? onClose}
            type="button"
          >
            <Icon name="arrow" size={17} />
            {backLabel}
          </button>
          <button
            aria-label={messages.partners.close}
            className="drawer-close panel-close-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
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
