import { Button, InlineAlert, TextField, Toast } from '@vista/ui';
import type {
  BusinessBranch,
  BusinessLocation,
  BusinessOperator,
  CashRegister,
  LegalBusinessEntity,
  OrganizationMember,
  OrganizationTopology,
} from '@vista/contracts';
import { businessIdentifierIssues } from '@vista/domain';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createBusinessBranch,
  createBusinessLocation,
  createBusinessOperator,
  createCashRegister,
  createLegalBusinessEntity,
  getOrganizationTopology,
  listOrganizationMembers,
  setOrganizationRecordActive,
  updateBusinessBranch,
  updateBusinessLocation,
  updateBusinessOperator,
  updateCashRegister,
  updateLegalBusinessEntity,
} from '../api/organization';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { organizationText as text } from '../i18n/organizationMessages';
import { businessIdentifierIssueMessage } from '../i18n/businessIdentifierMessages';
import { formatOperationsNumber, useLocalization } from '../i18n/LocalizationProvider';

type CreateKind = 'branch' | 'entity' | 'location' | 'operator' | 'register';
type EditableRecord =
  BusinessBranch | BusinessLocation | BusinessOperator | CashRegister | LegalBusinessEntity;
type EditTarget = { id: string; kind: CreateKind };

const emptyTopology: OrganizationTopology = {
  branches: [],
  cashRegisters: [],
  legalEntities: [],
  locations: [],
  operators: [],
};

export function OrganizationPage() {
  useLocalization();
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const [topology, setTopology] = useState(emptyTopology);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [composer, setComposer] = useState<CreateKind | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    void Promise.all([getOrganizationTopology(token), listOrganizationMembers(token)])
      .then(([nextTopology, nextMembers]) => {
        if (!active) return;
        setTopology(nextTopology);
        setMembers(nextMembers);
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

  if (loading) return <OrganizationLoading />;
  if (loadError)
    return (
      <main className="page-stack organization-page">
        <section className="content-panel organization-state">
          <Icon name="organization" size={26} />
          <h1>{text.loadTitle}</h1>
          <p>{text.connection}</p>
          <Button onClick={reload} variant="secondary">
            {text.retry}
          </Button>
        </section>
      </main>
    );

  const canCreate = hasPermission('platform.organization', 'create');
  const canEdit = hasPermission('platform.organization', 'edit');
  const canDeactivate = hasPermission('platform.organization', 'delete');
  return (
    <main className="page-stack organization-page">
      <header className="page-header organization-header">
        <div className="admin-page-heading">
          <span className="admin-page-heading-mark" aria-hidden="true">
            <Icon name="organization" size={20} />
          </span>
          <div>
            <p className="page-eyebrow">{text.administration}</p>
            <h1>{text.title}</h1>
            <p>{text.subtitle}</p>
          </div>
        </div>
      </header>

      {notice ? (
        <Toast onDismiss={() => setNotice(null)} tone="success">
          {notice}
        </Toast>
      ) : null}
      {actionError ? (
        <Toast onDismiss={() => setActionError(null)} tone="error">
          {actionError}
        </Toast>
      ) : null}
      <TopologySummary topology={topology} />

      {canCreate ? (
        <section className="organization-actions" aria-label={text.actions}>
          <ActionButton active={composer === 'entity'} onClick={() => setComposer('entity')}>
            {text.legalEntity}
          </ActionButton>
          <ActionButton
            active={composer === 'branch'}
            disabled={!topology.legalEntities.some((item) => item.active)}
            onClick={() => setComposer('branch')}
          >
            {text.branch}
          </ActionButton>
          <ActionButton
            active={composer === 'location'}
            disabled={!topology.branches.some((item) => item.active)}
            onClick={() => setComposer('location')}
          >
            {text.location}
          </ActionButton>
          <ActionButton
            active={composer === 'operator'}
            disabled={!topology.locations.some((item) => item.active) || !members.length}
            onClick={() => setComposer('operator')}
          >
            {text.operator}
          </ActionButton>
          <ActionButton
            active={composer === 'register'}
            disabled={!topology.locations.some((item) => item.active)}
            onClick={() => setComposer('register')}
          >
            {text.register}
          </ActionButton>
        </section>
      ) : null}

      {composer ? (
        <TopologyComposer
          kind={composer}
          members={members}
          onCancel={() => setComposer(null)}
          onCreated={(message) => {
            setNotice(message);
            setComposer(null);
            reload();
          }}
          token={token}
          topology={topology}
        />
      ) : null}

      {editTarget ? (
        <TopologyEditor
          key={`${editTarget.kind}:${editTarget.id}`}
          record={findRecord(topology, editTarget)}
          target={editTarget}
          topology={topology}
          token={token}
          onCancel={() => setEditTarget(null)}
          onSaved={(message) => {
            setNotice(message);
            setActionError(null);
            setEditTarget(null);
            reload();
          }}
        />
      ) : null}

      {topology.legalEntities.length ? (
        <TopologyDirectory
          canDeactivate={canDeactivate}
          canEdit={canEdit}
          onEdit={(kind, id) => {
            setComposer(null);
            setEditTarget({ kind, id });
          }}
          onToggle={(kind, id, active, version) =>
            void toggleRecordActive(
              kind,
              id,
              active,
              version,
              token,
              () => {
                setNotice(active ? text.reactivated : text.deactivated);
                setActionError(null);
                reload();
              },
              (error) => {
                setActionError(error);
              },
            )
          }
          topology={topology}
        />
      ) : (
        <section className="content-panel organization-empty">
          <span className="organization-empty-mark">01</span>
          <div>
            <p className="page-eyebrow">{text.getStarted}</p>
            <h2>{text.emptyTitle}</h2>
            <p>{text.emptyHint}</p>
          </div>
          {canCreate ? (
            <Button onClick={() => setComposer('entity')}>{text.addEntity}</Button>
          ) : null}
        </section>
      )}
    </main>
  );
}

function TopologySummary({ topology }: { topology: OrganizationTopology }) {
  const items = [
    [text.legalEntities, topology.legalEntities.length],
    [text.branches, topology.branches.length],
    [text.locations, topology.locations.length],
    [text.registers, topology.cashRegisters.length],
    [text.operators, topology.operators.length],
  ] as const;
  return (
    <section className="organization-summary" aria-label={text.summary}>
      {items.map(([label, value]) => (
        <article key={label}>
          <strong>{formatOperationsNumber(value)}</strong>
          <span>{label}</span>
        </article>
      ))}
    </section>
  );
}

function TopologyDirectory({
  canDeactivate,
  canEdit,
  onEdit,
  onToggle,
  topology,
}: {
  canDeactivate: boolean;
  canEdit: boolean;
  onEdit: (kind: CreateKind, id: string) => void;
  onToggle: (kind: CreateKind, id: string, active: boolean, version: number) => void;
  topology: OrganizationTopology;
}) {
  return (
    <section className="organization-directory" aria-label={text.configured}>
      {topology.legalEntities.map((entity) => {
        const branches = topology.branches.filter((branch) => branch.legalEntityId === entity.id);
        return (
          <article className="organization-entity" key={entity.id}>
            <header>
              <span className="organization-code">{entity.code}</span>
              <div>
                <h2>
                  {entity.name} {!entity.active ? <StatusChip active={false} /> : null}
                </h2>
                <p>
                  {[entity.uic ? `UIC ${entity.uic}` : null, entity.vatNumber]
                    .filter(Boolean)
                    .join(' · ') || text.identifiersMissing}
                </p>
              </div>
              {canEdit || canDeactivate ? (
                <RecordActions
                  active={entity.active}
                  canDeactivate={canDeactivate}
                  canEdit={canEdit}
                  onEdit={() => onEdit('entity', entity.id)}
                  onToggle={() => onToggle('entity', entity.id, entity.active, entity.version)}
                />
              ) : null}
            </header>
            {branches.length ? (
              <div className="organization-branches">
                {branches.map((branch) => {
                  const locations = topology.locations.filter(
                    (location) => location.branchId === branch.id,
                  );
                  return (
                    <section key={branch.id}>
                      <div className="organization-branch-heading">
                        <span>{branch.code}</span>
                        <strong>
                          {branch.name} {!branch.active ? <StatusChip active={false} /> : null}
                        </strong>
                        <small>{text.locationCount(locations.length)}</small>
                        {canEdit || canDeactivate ? (
                          <RecordActions
                            active={branch.active}
                            canDeactivate={canDeactivate}
                            canEdit={canEdit}
                            onEdit={() => onEdit('branch', branch.id)}
                            onToggle={() =>
                              onToggle('branch', branch.id, branch.active, branch.version)
                            }
                          />
                        ) : null}
                      </div>
                      {locations.length ? (
                        <div className="organization-locations">
                          {locations.map((location) => (
                            <LocationCard
                              canDeactivate={canDeactivate}
                              canEdit={canEdit}
                              key={location.id}
                              location={location}
                              onEdit={() => onEdit('location', location.id)}
                              onRecordEdit={onEdit}
                              onRecordToggle={onToggle}
                              onToggle={() =>
                                onToggle('location', location.id, location.active, location.version)
                              }
                              topology={topology}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="organization-nested-empty">{text.noLocations}</p>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <p className="organization-nested-empty">{text.noBranches}</p>
            )}
          </article>
        );
      })}
    </section>
  );
}

function LocationCard({
  canDeactivate,
  canEdit,
  location,
  onEdit,
  onRecordEdit,
  onRecordToggle,
  onToggle,
  topology,
}: {
  canDeactivate: boolean;
  canEdit: boolean;
  location: BusinessLocation;
  onEdit: () => void;
  onRecordEdit: (kind: CreateKind, id: string) => void;
  onRecordToggle: (kind: CreateKind, id: string, active: boolean, version: number) => void;
  onToggle: () => void;
  topology: OrganizationTopology;
}) {
  const operators = topology.operators.filter(
    (operator) => operator.businessLocationId === location.id,
  );
  const registers = topology.cashRegisters.filter(
    (register) => register.businessLocationId === location.id,
  );
  return (
    <article className="organization-location-card">
      <div className="organization-location-heading">
        <div className="organization-location-title">
          <span>{location.code}</span>
          <div>
            <strong>
              {location.name} {!location.active ? <StatusChip active={false} /> : null}
            </strong>
            <small>{location.locationType}</small>
          </div>
        </div>
        {canEdit || canDeactivate ? (
          <RecordActions
            active={location.active}
            canDeactivate={canDeactivate}
            canEdit={canEdit}
            onEdit={onEdit}
            onToggle={onToggle}
          />
        ) : null}
      </div>
      <address>
        {location.addressLine1}
        {location.addressLine2 ? `, ${location.addressLine2}` : ''}
        <br />
        {[location.postalCode, location.city, location.countryCode].filter(Boolean).join(' · ')}
      </address>
      <div className="organization-location-resources">
        <span>{text.registerCount(registers.length)}</span>
        <span>{text.operatorCount(operators.length)}</span>
      </div>
      {registers.length ? (
        <div className="organization-registers">
          {registers.map((register) => (
            <span className="organization-record-row" key={register.id}>
              <strong>{register.code}</strong>
              <span>
                {register.name} · {text.assignedCount(register.operatorIds.length)}{' '}
                {!register.active ? <StatusChip active={false} /> : null}
              </span>
              {canEdit || canDeactivate ? (
                <RecordActions
                  active={register.active}
                  canDeactivate={canDeactivate}
                  canEdit={canEdit}
                  onEdit={() => onRecordEdit('register', register.id)}
                  onToggle={() =>
                    onRecordToggle('register', register.id, register.active, register.version)
                  }
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
      {operators.length ? (
        <div className="organization-operator-list">
          {operators.map((operator) => (
            <span className="organization-record-row" key={operator.id} title={operator.email}>
              <span>
                {operator.code} · {operator.displayName}{' '}
                {!operator.active ? <StatusChip active={false} /> : null}
              </span>
              {canEdit || canDeactivate ? (
                <RecordActions
                  active={operator.active}
                  canDeactivate={canDeactivate}
                  canEdit={canEdit}
                  onEdit={() => onRecordEdit('operator', operator.id)}
                  onToggle={() =>
                    onRecordToggle('operator', operator.id, operator.active, operator.version)
                  }
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function StatusChip({ active }: { active: boolean }) {
  return (
    <span className={`organization-status-chip${active ? ' is-active' : ''}`}>
      {active ? text.active : text.inactive}
    </span>
  );
}

function RecordActions({
  active,
  canDeactivate,
  canEdit,
  onEdit,
  onToggle,
}: {
  active: boolean;
  canDeactivate: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="organization-record-actions">
      {canEdit ? (
        <button onClick={onEdit} type="button">
          {text.edit}
        </button>
      ) : null}
      {active && canDeactivate ? (
        <button className="is-danger" onClick={onToggle} type="button">
          {text.deactivate}
        </button>
      ) : null}
      {!active && canEdit ? (
        <button className="is-restore" onClick={onToggle} type="button">
          {text.reactivate}
        </button>
      ) : null}
    </div>
  );
}

function ActionButton({
  active,
  children,
  disabled,
  onClick,
}: {
  active: boolean;
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? 'is-active' : undefined}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon name="plus" size={16} />
      {children}
    </button>
  );
}

function TopologyComposer({
  kind,
  members,
  onCancel,
  onCreated,
  token,
  topology,
}: {
  kind: CreateKind;
  members: OrganizationMember[];
  onCancel: () => void;
  onCreated: (message: string) => void;
  token: string;
  topology: OrganizationTopology;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [selectedOperators, setSelectedOperators] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIdentifierErrors, setShowIdentifierErrors] = useState(false);
  const attempt = useStableAttempt();
  const activeLocations = topology.locations.filter((item) => item.active);
  const activeBranches = topology.branches.filter((item) => item.active);
  const activeEntities = topology.legalEntities.filter((item) => item.active);
  const locationId = fields['locationId'] ?? activeLocations[0]?.id ?? '';
  const eligibleOperators = topology.operators.filter(
    (operator) => operator.active && operator.businessLocationId === locationId,
  );
  const identifierIssues =
    kind === 'entity'
      ? businessIdentifierIssues({
          ...(fields['uic'] ? { uic: fields['uic'] } : {}),
          ...(fields['vatNumber'] ? { vatNumber: fields['vatNumber'] } : {}),
        })
      : [];
  const uicIssue = identifierIssues.find((issue) => issue.field === 'uic');
  const vatIssue = identifierIssues.find((issue) => issue.field === 'vatNumber');

  function set(name: string, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (identifierIssues.length) {
      setShowIdentifierErrors(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const effectiveFields = {
        ...fields,
        ...(kind === 'operator' && !fields['accountId'] && members[0]
          ? { accountId: members[0].accountId }
          : {}),
      };
      const result = await create(
        kind,
        effectiveFields,
        selectedOperators,
        topology,
        token,
        attempt,
      );
      onCreated(text.added(result));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : text.createError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="content-panel organization-composer" onSubmit={(event) => void submit(event)}>
      <header className="panel-drawer-header">
        <button
          aria-label={text.backLabel}
          className="panel-back-button"
          onClick={onCancel}
          type="button"
        >
          <Icon name="arrow" size={17} />
          {text.back}
        </button>
        <button
          aria-label={text.close}
          className="panel-close-button"
          onClick={onCancel}
          type="button"
        >
          <Icon name="close" />
        </button>
        <div>
          <p className="page-eyebrow">{text.title}</p>
          <h2>{composerTitle(kind)}</h2>
        </div>
      </header>
      <div className="organization-form-grid">
        {kind === 'branch' ? (
          <SelectControl
            id="structure-entity"
            label={text.legalEntity}
            onChange={(value) => set('entityId', value)}
            options={activeEntities.map((item) => [item.id, `${item.code} · ${item.name}`])}
            value={fields['entityId'] ?? activeEntities[0]?.id ?? ''}
          />
        ) : null}
        {kind === 'location' ? (
          <SelectControl
            id="structure-branch"
            label={text.parentBranch}
            onChange={(value) => set('branchId', value)}
            options={activeBranches.map((item) => [item.id, `${item.code} · ${item.name}`])}
            value={fields['branchId'] ?? activeBranches[0]?.id ?? ''}
          />
        ) : null}
        {kind === 'operator' || kind === 'register' ? (
          <SelectControl
            id="structure-location"
            label={text.businessLocation}
            onChange={(value) => {
              set('locationId', value);
              setSelectedOperators([]);
            }}
            options={activeLocations.map((item) => [item.id, `${item.code} · ${item.name}`])}
            value={locationId}
          />
        ) : null}
        {kind === 'operator' ? (
          <SelectControl
            id="structure-member"
            label={text.employeeAccount}
            onChange={(value) => set('accountId', value)}
            options={members.map((item) => [item.accountId, `${item.displayName} · ${item.email}`])}
            value={fields['accountId'] ?? members[0]?.accountId ?? ''}
          />
        ) : null}
        <TextField
          id="structure-code"
          label={text.code(noun(kind))}
          maxLength={30}
          onChange={(event) => set('code', event.target.value)}
          required
          value={fields['code'] ?? ''}
        />
        {kind !== 'operator' ? (
          <TextField
            id="structure-name"
            label={text.name(noun(kind))}
            maxLength={255}
            onChange={(event) => set('name', event.target.value)}
            required
            value={fields['name'] ?? ''}
          />
        ) : null}
        {kind === 'entity' ? (
          <>
            <TextField
              {...(showIdentifierErrors && uicIssue
                ? { error: businessIdentifierIssueMessage(uicIssue) }
                : {})}
              id="structure-uic"
              label={text.uic}
              maxLength={30}
              onChange={(event) => set('uic', event.target.value)}
              value={fields['uic'] ?? ''}
            />
            <TextField
              {...(showIdentifierErrors && vatIssue
                ? { error: businessIdentifierIssueMessage(vatIssue) }
                : {})}
              id="structure-vat"
              label={text.vat}
              maxLength={30}
              onChange={(event) => set('vatNumber', event.target.value)}
              value={fields['vatNumber'] ?? ''}
            />
          </>
        ) : null}
        {kind === 'location' ? (
          <>
            <TextField
              id="structure-location-type"
              label={text.locationType}
              maxLength={100}
              onChange={(event) => set('locationType', event.target.value)}
              placeholder={text.locationPlaceholder}
              required
              value={fields['locationType'] ?? ''}
            />
            <TextField
              id="structure-address"
              label={text.address}
              maxLength={255}
              onChange={(event) => set('addressLine1', event.target.value)}
              required
              value={fields['addressLine1'] ?? ''}
            />
            <TextField
              id="structure-city"
              label={text.city}
              maxLength={150}
              onChange={(event) => set('city', event.target.value)}
              required
              value={fields['city'] ?? ''}
            />
            <TextField
              id="structure-postal"
              label={text.postalCode}
              maxLength={30}
              onChange={(event) => set('postalCode', event.target.value)}
              value={fields['postalCode'] ?? ''}
            />
            <TextField
              id="structure-country"
              label={text.countryCode}
              maxLength={2}
              onChange={(event) => set('countryCode', event.target.value)}
              required
              value={fields['countryCode'] ?? 'BG'}
            />
          </>
        ) : null}
      </div>
      {kind === 'register' && eligibleOperators.length ? (
        <fieldset className="organization-operator-picker">
          <legend>{text.allowedOperators}</legend>
          {eligibleOperators.map((operator) => (
            <label key={operator.id}>
              <input
                checked={selectedOperators.includes(operator.id)}
                onChange={(event) =>
                  setSelectedOperators((current) =>
                    event.target.checked
                      ? [...current, operator.id]
                      : current.filter((id) => id !== operator.id),
                  )
                }
                type="checkbox"
              />
              <span>
                <strong>{operator.displayName}</strong>
                <small>{operator.code}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <footer>
        <Button onClick={onCancel} type="button" variant="secondary">
          {text.cancel}
        </Button>
        <Button busy={saving} busyLabel={text.saving} type="submit">
          {text.add(noun(kind))}
        </Button>
      </footer>
    </form>
  );
}

function TopologyEditor({
  onCancel,
  onSaved,
  record,
  target,
  token,
  topology,
}: {
  onCancel: () => void;
  onSaved: (message: string) => void;
  record: EditableRecord | undefined;
  target: EditTarget;
  token: string;
  topology: OrganizationTopology;
}) {
  const currentRecord = record;
  const [fields, setFields] = useState<Record<string, string>>(() =>
    currentRecord ? editorFields(target.kind, currentRecord) : {},
  );
  const [selectedOperators, setSelectedOperators] = useState<string[]>(() =>
    target.kind === 'register' && currentRecord ? (currentRecord as CashRegister).operatorIds : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIdentifierErrors, setShowIdentifierErrors] = useState(false);
  const attempt = useStableAttempt();
  const eligibleOperators = topology.operators.filter(
    (operator) =>
      operator.active &&
      operator.businessLocationId ===
        (currentRecord as BusinessOperator | CashRegister | undefined)?.businessLocationId,
  );
  const identifierIssues =
    target.kind === 'entity'
      ? businessIdentifierIssues({
          ...(fields['uic'] ? { uic: fields['uic'] } : {}),
          ...(fields['vatNumber'] ? { vatNumber: fields['vatNumber'] } : {}),
        })
      : [];
  const uicIssue = identifierIssues.find((issue) => issue.field === 'uic');
  const vatIssue = identifierIssues.find((issue) => issue.field === 'vatNumber');

  if (!currentRecord)
    return (
      <section className="content-panel organization-composer">
        <InlineAlert tone="error">{text.recordMissing}</InlineAlert>
        <footer>
          <Button onClick={onCancel} variant="secondary">
            {text.back}
          </Button>
        </footer>
      </section>
    );

  function set(name: string, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!currentRecord) return;
    if (identifierIssues.length) {
      setShowIdentifierErrors(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const label = await saveRecordEdit(
        target.kind,
        currentRecord,
        fields,
        selectedOperators,
        token,
        attempt,
      );
      onSaved(text.updated(label));
    } catch (caught) {
      setError(organizationError(caught, text.updateError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="content-panel organization-composer organization-editor"
      onSubmit={(event) => void submit(event)}
    >
      <header className="panel-drawer-header">
        <button
          aria-label={text.backLabel}
          className="panel-back-button"
          onClick={onCancel}
          type="button"
        >
          <Icon name="arrow" size={17} />
          {text.back}
        </button>
        <button
          aria-label={text.close}
          className="panel-close-button"
          onClick={onCancel}
          type="button"
        >
          <Icon name="close" />
        </button>
        <div>
          <p className="page-eyebrow">{text.title}</p>
          <h2>{text.editTitle(noun(target.kind))}</h2>
        </div>
      </header>
      {target.kind !== 'entity' ? (
        <p className="organization-editor-hint">
          {target.kind === 'operator' ? text.operatorAccountLocked : text.hierarchyLocked}
        </p>
      ) : null}
      <div className="organization-form-grid">
        <TextField
          id="structure-edit-code"
          label={text.code(noun(target.kind))}
          maxLength={30}
          onChange={(event) => set('code', event.target.value)}
          required
          value={fields['code'] ?? ''}
        />
        {target.kind !== 'operator' ? (
          <TextField
            id="structure-edit-name"
            label={text.name(noun(target.kind))}
            maxLength={target.kind === 'register' ? 120 : 255}
            onChange={(event) => set('name', event.target.value)}
            required
            value={fields['name'] ?? ''}
          />
        ) : null}
        {target.kind === 'entity' ? (
          <>
            <TextField
              {...(showIdentifierErrors && uicIssue
                ? { error: businessIdentifierIssueMessage(uicIssue) }
                : {})}
              id="structure-edit-uic"
              label={text.uic}
              maxLength={30}
              onChange={(event) => set('uic', event.target.value)}
              value={fields['uic'] ?? ''}
            />
            <TextField
              {...(showIdentifierErrors && vatIssue
                ? { error: businessIdentifierIssueMessage(vatIssue) }
                : {})}
              id="structure-edit-vat"
              label={text.vat}
              maxLength={30}
              onChange={(event) => set('vatNumber', event.target.value)}
              value={fields['vatNumber'] ?? ''}
            />
          </>
        ) : null}
        {target.kind === 'location' ? (
          <>
            <TextField
              id="structure-edit-location-type"
              label={text.locationType}
              maxLength={100}
              onChange={(event) => set('locationType', event.target.value)}
              required
              value={fields['locationType'] ?? ''}
            />
            <TextField
              id="structure-edit-address"
              label={text.address}
              maxLength={255}
              onChange={(event) => set('addressLine1', event.target.value)}
              required
              value={fields['addressLine1'] ?? ''}
            />
            <TextField
              id="structure-edit-address-2"
              label={text.addressLine2}
              maxLength={255}
              onChange={(event) => set('addressLine2', event.target.value)}
              value={fields['addressLine2'] ?? ''}
            />
            <TextField
              id="structure-edit-city"
              label={text.city}
              maxLength={150}
              onChange={(event) => set('city', event.target.value)}
              required
              value={fields['city'] ?? ''}
            />
            <TextField
              id="structure-edit-postal"
              label={text.postalCode}
              maxLength={30}
              onChange={(event) => set('postalCode', event.target.value)}
              value={fields['postalCode'] ?? ''}
            />
            <TextField
              id="structure-edit-country"
              label={text.countryCode}
              maxLength={2}
              onChange={(event) => set('countryCode', event.target.value)}
              required
              value={fields['countryCode'] ?? 'BG'}
            />
          </>
        ) : null}
      </div>
      {target.kind === 'operator' ? (
        <div className="organization-editor-readonly">
          <span>{text.employeeAccount}</span>
          <strong>{(currentRecord as BusinessOperator).displayName}</strong>
          <small>{(currentRecord as BusinessOperator).email}</small>
        </div>
      ) : null}
      {target.kind === 'register' ? (
        <fieldset className="organization-operator-picker">
          <legend>{text.allowedOperators}</legend>
          {eligibleOperators.length ? (
            eligibleOperators.map((operator) => (
              <label key={operator.id}>
                <input
                  checked={selectedOperators.includes(operator.id)}
                  onChange={(event) =>
                    setSelectedOperators((current) =>
                      event.target.checked
                        ? [...current, operator.id]
                        : current.filter((id) => id !== operator.id),
                    )
                  }
                  type="checkbox"
                />
                <span>
                  <strong>{operator.displayName}</strong>
                  <small>{operator.code}</small>
                </span>
              </label>
            ))
          ) : (
            <p className="organization-nested-empty">{text.noOperators}</p>
          )}
        </fieldset>
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <footer>
        <Button onClick={onCancel} type="button" variant="secondary">
          {text.cancel}
        </Button>
        <Button busy={saving} busyLabel={text.saving} type="submit">
          {text.saveChanges}
        </Button>
      </footer>
    </form>
  );
}

function findRecord(
  topology: OrganizationTopology,
  target: EditTarget,
): EditableRecord | undefined {
  switch (target.kind) {
    case 'entity':
      return topology.legalEntities.find((item) => item.id === target.id);
    case 'branch':
      return topology.branches.find((item) => item.id === target.id);
    case 'location':
      return topology.locations.find((item) => item.id === target.id);
    case 'operator':
      return topology.operators.find((item) => item.id === target.id);
    case 'register':
      return topology.cashRegisters.find((item) => item.id === target.id);
  }
}

function editorFields(kind: CreateKind, record: EditableRecord): Record<string, string> {
  if (kind === 'entity') {
    const entity = record as LegalBusinessEntity;
    return {
      code: entity.code,
      name: entity.name,
      uic: entity.uic ?? '',
      vatNumber: entity.vatNumber ?? '',
    };
  }
  if (kind === 'branch') {
    const branch = record as BusinessBranch;
    return { code: branch.code, name: branch.name };
  }
  if (kind === 'location') {
    const location = record as BusinessLocation;
    return {
      addressLine1: location.addressLine1,
      addressLine2: location.addressLine2 ?? '',
      city: location.city,
      code: location.code,
      countryCode: location.countryCode,
      locationType: location.locationType,
      name: location.name,
      postalCode: location.postalCode ?? '',
    };
  }
  if (kind === 'operator') return { code: (record as BusinessOperator).code };
  const register = record as CashRegister;
  return { code: register.code, name: register.name };
}

async function saveRecordEdit(
  kind: CreateKind,
  record: EditableRecord,
  fields: Record<string, string>,
  operatorIds: string[],
  token: string,
  attempt: (input: unknown) => string,
): Promise<string> {
  const expectedVersion = record.version;
  const code = fields['code']?.trim() ?? '';
  const name = fields['name']?.trim() ?? '';
  if (kind === 'entity') {
    const input = {
      code,
      expectedVersion,
      name,
      ...(fields['uic']?.trim() ? { uic: fields['uic'].trim() } : {}),
      ...(fields['vatNumber']?.trim() ? { vatNumber: fields['vatNumber'].trim() } : {}),
    };
    return (await updateLegalBusinessEntity(token, record.id, attempt(input), input)).name;
  }
  if (kind === 'branch') {
    const input = { code, expectedVersion, name };
    return (await updateBusinessBranch(token, record.id, attempt(input), input)).name;
  }
  if (kind === 'location') {
    const input = {
      addressLine1: fields['addressLine1']?.trim() ?? '',
      ...(fields['addressLine2']?.trim() ? { addressLine2: fields['addressLine2'].trim() } : {}),
      city: fields['city']?.trim() ?? '',
      code,
      countryCode: fields['countryCode']?.trim() || 'BG',
      expectedVersion,
      locationType: fields['locationType']?.trim() ?? '',
      name,
      ...(fields['postalCode']?.trim() ? { postalCode: fields['postalCode'].trim() } : {}),
    };
    return (await updateBusinessLocation(token, record.id, attempt(input), input)).name;
  }
  if (kind === 'operator') {
    const input = { code, expectedVersion };
    return (await updateBusinessOperator(token, record.id, attempt(input), input)).displayName;
  }
  const input = { code, expectedVersion, name, operatorIds };
  return (await updateCashRegister(token, record.id, attempt(input), input)).name;
}

async function toggleRecordActive(
  kind: CreateKind,
  id: string,
  currentlyActive: boolean,
  version: number,
  token: string,
  onSuccess: () => void,
  onError: (message: string) => void,
): Promise<void> {
  const active = !currentlyActive;
  if (!active && !window.confirm(text.confirmDeactivate(noun(kind)))) return;
  try {
    await setOrganizationRecordActive(token, kind, id, active, crypto.randomUUID(), {
      expectedVersion: version,
    });
    onSuccess();
  } catch (caught) {
    onError(organizationError(caught, text.statusError));
  }
}

function organizationError(caught: unknown, fallback: string): string {
  if (!(caught instanceof ApiClientError)) return fallback;
  const codeMessages: Record<string, string> = {
    BRANCH_HAS_ACTIVE_LOCATIONS: text.branchHasLocations,
    BUSINESS_LOCATION_HAS_ACTIVE_RECORDS: text.locationHasChildren,
    CASH_REGISTER_HAS_OPEN_SHIFT: text.registerHasShift,
    LEGAL_ENTITY_DUPLICATE: text.identifiersConflict,
    LEGAL_ENTITY_HAS_ACTIVE_BRANCHES: text.entityHasBranches,
    OPERATOR_HAS_ACTIVE_ASSIGNMENTS: text.operatorHasAssignments,
    ORGANIZATION_VERSION_CONFLICT: text.versionConflict,
  };
  return codeMessages[caught.code] ?? caught.message;
}

async function create(
  kind: CreateKind,
  fields: Record<string, string>,
  operatorIds: string[],
  topology: OrganizationTopology,
  token: string,
  attempt: (input: unknown) => string,
): Promise<string> {
  const code = fields['code']?.trim() ?? '';
  const name = fields['name']?.trim() ?? '';
  if (kind === 'entity') {
    const input = {
      code,
      name,
      ...(fields['uic']?.trim() ? { uic: fields['uic'].trim() } : {}),
      ...(fields['vatNumber']?.trim() ? { vatNumber: fields['vatNumber'].trim() } : {}),
    };
    return (await createLegalBusinessEntity(token, attempt(input), input)).name;
  }
  if (kind === 'branch') {
    const entityId =
      fields['entityId'] ?? topology.legalEntities.find((item) => item.active)?.id ?? '';
    const input = { code, name };
    return (await createBusinessBranch(token, entityId, attempt({ entityId, ...input }), input))
      .name;
  }
  if (kind === 'location') {
    const branchId = fields['branchId'] ?? topology.branches.find((item) => item.active)?.id ?? '';
    const input = {
      addressLine1: fields['addressLine1']?.trim() ?? '',
      city: fields['city']?.trim() ?? '',
      code,
      countryCode: fields['countryCode']?.trim() || 'BG',
      locationType: fields['locationType']?.trim() ?? '',
      name,
      ...(fields['postalCode']?.trim() ? { postalCode: fields['postalCode'].trim() } : {}),
    };
    return (await createBusinessLocation(token, branchId, attempt({ branchId, ...input }), input))
      .name;
  }
  const locationId =
    fields['locationId'] ?? topology.locations.find((item) => item.active)?.id ?? '';
  if (kind === 'operator') {
    const accountId = fields['accountId'] ?? '';
    const input = { accountId, code };
    return (
      await createBusinessOperator(token, locationId, attempt({ locationId, ...input }), input)
    ).displayName;
  }
  const input = { code, name, operatorIds };
  return (await createCashRegister(token, locationId, attempt({ locationId, ...input }), input))
    .name;
}

function SelectControl({
  id,
  label,
  onChange,
  options,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <label className="organization-select" htmlFor={id}>
      <span>{label}</span>
      <select id={id} onChange={(event) => onChange(event.target.value)} required value={value}>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function OrganizationLoading() {
  return (
    <main className="page-stack organization-page" aria-label={text.loading}>
      <div className="organization-loading-header" />
      <div className="organization-loading-summary" />
      <div className="organization-loading-body" />
    </main>
  );
}

function composerTitle(kind: CreateKind) {
  return text.composer[kind];
}

function noun(kind: CreateKind) {
  return text.nouns[kind];
}

function useStableAttempt() {
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  return (input: unknown) => {
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    return attempt.current.key;
  };
}
