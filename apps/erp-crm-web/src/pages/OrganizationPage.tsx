import { Button, InlineAlert, TextField } from '@vista/ui';
import type { BusinessLocation, OrganizationMember, OrganizationTopology } from '@vista/contracts';
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
} from '../api/organization';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';

type CreateKind = 'branch' | 'entity' | 'location' | 'operator' | 'register';

const emptyTopology: OrganizationTopology = {
  branches: [],
  cashRegisters: [],
  legalEntities: [],
  locations: [],
  operators: [],
};

export function OrganizationPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const [topology, setTopology] = useState(emptyTopology);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [composer, setComposer] = useState<CreateKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
          <h1>Business structure could not be loaded</h1>
          <p>Check your connection and try again.</p>
          <Button onClick={reload} variant="secondary">
            Try again
          </Button>
        </section>
      </main>
    );

  const canCreate = hasPermission('platform.organization', 'create');
  return (
    <main className="page-stack organization-page">
      <header className="page-header organization-header">
        <div className="organization-heading-mark">
          <Icon name="organization" size={24} />
        </div>
        <div>
          <p className="page-eyebrow">Administration</p>
          <h1>Business structure</h1>
          <p>
            Set up legal entities, branches, business locations, cash registers, operators, and
            warehouse responsibility across Vista Service.
          </p>
        </div>
        <span className="organization-policy-note">Flexible business structure</span>
      </header>

      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
      <TopologySummary topology={topology} />

      {canCreate ? (
        <section className="organization-actions" aria-label="Business structure actions">
          <ActionButton active={composer === 'entity'} onClick={() => setComposer('entity')}>
            Legal entity
          </ActionButton>
          <ActionButton
            active={composer === 'branch'}
            disabled={!topology.legalEntities.length}
            onClick={() => setComposer('branch')}
          >
            Branch
          </ActionButton>
          <ActionButton
            active={composer === 'location'}
            disabled={!topology.branches.length}
            onClick={() => setComposer('location')}
          >
            Location
          </ActionButton>
          <ActionButton
            active={composer === 'operator'}
            disabled={!topology.locations.length || !members.length}
            onClick={() => setComposer('operator')}
          >
            Operator
          </ActionButton>
          <ActionButton
            active={composer === 'register'}
            disabled={!topology.locations.length}
            onClick={() => setComposer('register')}
          >
            Cash register
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

      {topology.legalEntities.length ? (
        <TopologyDirectory topology={topology} />
      ) : (
        <section className="content-panel organization-empty">
          <span className="organization-empty-mark">01</span>
          <div>
            <p className="page-eyebrow">Get started</p>
            <h2>No business structure configured</h2>
            <p>
              Add the legal entity first. Branches, operating locations, registers, operators, and
              warehouse ownership remain unavailable until their parent exists.
            </p>
          </div>
          {canCreate ? (
            <Button onClick={() => setComposer('entity')}>Add legal entity</Button>
          ) : null}
        </section>
      )}
    </main>
  );
}

function TopologySummary({ topology }: { topology: OrganizationTopology }) {
  const items = [
    ['Legal entities', topology.legalEntities.length],
    ['Branches', topology.branches.length],
    ['Locations', topology.locations.length],
    ['Cash registers', topology.cashRegisters.length],
    ['Operators', topology.operators.length],
  ] as const;
  return (
    <section className="organization-summary" aria-label="Structure summary">
      {items.map(([label, value]) => (
        <article key={label}>
          <strong>{value.toLocaleString('en-GB')}</strong>
          <span>{label}</span>
        </article>
      ))}
    </section>
  );
}

function TopologyDirectory({ topology }: { topology: OrganizationTopology }) {
  return (
    <section className="organization-directory" aria-label="Configured business structure">
      {topology.legalEntities.map((entity) => {
        const branches = topology.branches.filter((branch) => branch.legalEntityId === entity.id);
        return (
          <article className="organization-entity" key={entity.id}>
            <header>
              <span className="organization-code">{entity.code}</span>
              <div>
                <h2>{entity.name}</h2>
                <p>
                  {[entity.uic ? `UIC ${entity.uic}` : null, entity.vatNumber]
                    .filter(Boolean)
                    .join(' · ') || 'Registration identifiers not supplied'}
                </p>
              </div>
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
                        <strong>{branch.name}</strong>
                        <small>
                          {locations.length} {locations.length === 1 ? 'location' : 'locations'}
                        </small>
                      </div>
                      {locations.length ? (
                        <div className="organization-locations">
                          {locations.map((location) => (
                            <LocationCard
                              key={location.id}
                              location={location}
                              topology={topology}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="organization-nested-empty">No operating locations yet.</p>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <p className="organization-nested-empty">No branches yet.</p>
            )}
          </article>
        );
      })}
    </section>
  );
}

function LocationCard({
  location,
  topology,
}: {
  location: BusinessLocation;
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
      <div className="organization-location-title">
        <span>{location.code}</span>
        <div>
          <strong>{location.name}</strong>
          <small>{location.locationType}</small>
        </div>
      </div>
      <address>
        {location.addressLine1}
        {location.addressLine2 ? `, ${location.addressLine2}` : ''}
        <br />
        {[location.postalCode, location.city, location.countryCode].filter(Boolean).join(' · ')}
      </address>
      <div className="organization-location-resources">
        <span>{registers.length} registers</span>
        <span>{operators.length} operators</span>
      </div>
      {registers.length ? (
        <div className="organization-registers">
          {registers.map((register) => (
            <span key={register.id}>
              <strong>{register.code}</strong>
              {register.name} · {register.operatorIds.length} assigned
            </span>
          ))}
        </div>
      ) : null}
      {operators.length ? (
        <div className="organization-operator-list">
          {operators.map((operator) => (
            <span key={operator.id} title={operator.email}>
              {operator.code} · {operator.displayName}
            </span>
          ))}
        </div>
      ) : null}
    </article>
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
  const attempt = useStableAttempt();
  const locationId = fields['locationId'] ?? topology.locations[0]?.id ?? '';
  const eligibleOperators = topology.operators.filter(
    (operator) => operator.businessLocationId === locationId,
  );

  function set(name: string, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
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
      onCreated(`${result} was added to the shared business structure.`);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The structure record could not be created.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="content-panel organization-composer" onSubmit={(event) => void submit(event)}>
      <header className="panel-drawer-header">
        <button
          aria-label="Back to business structure"
          className="panel-back-button"
          onClick={onCancel}
          type="button"
        >
          <Icon name="arrow" size={17} />
          Back
        </button>
        <button
          aria-label="Close structure form"
          className="panel-close-button"
          onClick={onCancel}
          type="button"
        >
          <Icon name="close" />
        </button>
        <div>
          <p className="page-eyebrow">Business structure</p>
          <h2>{composerTitle(kind)}</h2>
        </div>
      </header>
      <div className="organization-form-grid">
        {kind === 'branch' ? (
          <SelectControl
            id="structure-entity"
            label="Legal entity"
            onChange={(value) => set('entityId', value)}
            options={topology.legalEntities.map((item) => [item.id, `${item.code} · ${item.name}`])}
            value={fields['entityId'] ?? topology.legalEntities[0]?.id ?? ''}
          />
        ) : null}
        {kind === 'location' ? (
          <SelectControl
            id="structure-branch"
            label="Parent branch"
            onChange={(value) => set('branchId', value)}
            options={topology.branches.map((item) => [item.id, `${item.code} · ${item.name}`])}
            value={fields['branchId'] ?? topology.branches[0]?.id ?? ''}
          />
        ) : null}
        {kind === 'operator' || kind === 'register' ? (
          <SelectControl
            id="structure-location"
            label="Business location"
            onChange={(value) => {
              set('locationId', value);
              setSelectedOperators([]);
            }}
            options={topology.locations.map((item) => [item.id, `${item.code} · ${item.name}`])}
            value={locationId}
          />
        ) : null}
        {kind === 'operator' ? (
          <SelectControl
            id="structure-member"
            label="Employee account"
            onChange={(value) => set('accountId', value)}
            options={members.map((item) => [item.accountId, `${item.displayName} · ${item.email}`])}
            value={fields['accountId'] ?? members[0]?.accountId ?? ''}
          />
        ) : null}
        <TextField
          id="structure-code"
          label={kind === 'operator' ? 'Operator code' : `${noun(kind)} code`}
          maxLength={30}
          onChange={(event) => set('code', event.target.value)}
          required
          value={fields['code'] ?? ''}
        />
        {kind !== 'operator' ? (
          <TextField
            id="structure-name"
            label={`${noun(kind)} name`}
            maxLength={255}
            onChange={(event) => set('name', event.target.value)}
            required
            value={fields['name'] ?? ''}
          />
        ) : null}
        {kind === 'entity' ? (
          <>
            <TextField
              id="structure-uic"
              label="UIC (optional)"
              maxLength={30}
              onChange={(event) => set('uic', event.target.value)}
              value={fields['uic'] ?? ''}
            />
            <TextField
              id="structure-vat"
              label="VAT number (optional)"
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
              label="Location type"
              maxLength={100}
              onChange={(event) => set('locationType', event.target.value)}
              placeholder="e.g. Service and retail center"
              required
              value={fields['locationType'] ?? ''}
            />
            <TextField
              id="structure-address"
              label="Address line 1"
              maxLength={255}
              onChange={(event) => set('addressLine1', event.target.value)}
              required
              value={fields['addressLine1'] ?? ''}
            />
            <TextField
              id="structure-city"
              label="City"
              maxLength={150}
              onChange={(event) => set('city', event.target.value)}
              required
              value={fields['city'] ?? ''}
            />
            <TextField
              id="structure-postal"
              label="Postal code (optional)"
              maxLength={30}
              onChange={(event) => set('postalCode', event.target.value)}
              value={fields['postalCode'] ?? ''}
            />
            <TextField
              id="structure-country"
              label="Country code"
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
          <legend>Operators allowed at this register</legend>
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
          Cancel
        </Button>
        <Button busy={saving} busyLabel="Saving…" type="submit">
          Add {noun(kind).toLowerCase()}
        </Button>
      </footer>
    </form>
  );
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
    const entityId = fields['entityId'] ?? topology.legalEntities[0]?.id ?? '';
    const input = { code, name };
    return (await createBusinessBranch(token, entityId, attempt({ entityId, ...input }), input))
      .name;
  }
  if (kind === 'location') {
    const branchId = fields['branchId'] ?? topology.branches[0]?.id ?? '';
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
  const locationId = fields['locationId'] ?? topology.locations[0]?.id ?? '';
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
    <main className="page-stack organization-page" aria-label="Loading business structure">
      <div className="organization-loading-header" />
      <div className="organization-loading-summary" />
      <div className="organization-loading-body" />
    </main>
  );
}

function composerTitle(kind: CreateKind) {
  return {
    branch: 'Add a branch',
    entity: 'Add a legal business entity',
    location: 'Add an operating location',
    operator: 'Assign an operator',
    register: 'Add a cash register',
  }[kind];
}

function noun(kind: CreateKind) {
  return {
    branch: 'Branch',
    entity: 'Legal entity',
    location: 'Location',
    operator: 'Operator',
    register: 'Cash register',
  }[kind];
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
