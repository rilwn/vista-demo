import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateServiceSubscriptionRequest,
  SalesSubscriptionReferenceData,
  ServiceSubscriptionContract,
} from '@vista/contracts';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createServiceSubscription,
  getSalesSubscriptionReferenceData,
  listServiceSubscriptions,
  updateServiceSubscription,
} from '../api/sales-subscriptions';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';

const emptyReferences: SalesSubscriptionReferenceData = {
  customers: [],
  equipment: [],
  locations: [],
};

interface SubscriptionFormState extends CreateServiceSubscriptionRequest {
  active: boolean;
}

export function SalesSubscriptionsPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useSubscriptions(token);
  const [selected, setSelected] = useState<ServiceSubscriptionContract | null>(null);
  const [editing, setEditing] = useState<ServiceSubscriptionContract | 'new' | null>(null);
  const [notice, setNotice] = useState('');
  const canCreate = hasPermission('erp.sales', 'create');
  const canEdit = hasPermission('erp.sales', 'edit');

  if (data.loading) return <SubscriptionState title="Loading service subscriptions" />;
  if (data.error)
    return (
      <SubscriptionState title="Service subscriptions could not be loaded">
        <Button onClick={data.reload} variant="secondary">
          Try again
        </Button>
      </SubscriptionState>
    );

  const active = data.contracts.filter((contract) => contract.active).length;
  const draftCount = data.contracts.reduce(
    (total, contract) => total + contract.invoiceDrafts.length,
    0,
  );
  const nextDue = [...data.contracts]
    .filter((contract) => contract.active)
    .sort((left, right) => left.nextInvoiceDate.localeCompare(right.nextInvoiceDate))[0];

  return (
    <div className="page-stack subscription-page">
      <header className="page-header subscription-page-header">
        <div>
          <p className="page-eyebrow">ERP · Sales</p>
          <h1>Service subscriptions</h1>
          <p>
            Keep customer locations, covered devices, service coverage frequency, and recurring
            billing in one contract record.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setEditing('new')}>
            <Icon name="plus" size={17} /> New contract
          </Button>
        ) : null}
      </header>

      <section aria-label="Service subscription summary" className="subscription-summary">
        <SubscriptionMetric label="Active contracts" value={active.toString()} />
        <SubscriptionMetric label="Billing drafts" value={draftCount.toString()} />
        <SubscriptionMetric
          label="Next billing date"
          value={nextDue ? formatDate(nextDue.nextInvoiceDate) : 'No date set'}
        />
      </section>

      {notice ? (
        <Toast onDismiss={() => setNotice('')} tone="success">
          {notice}
        </Toast>
      ) : null}

      <SubscriptionRegister contracts={data.contracts} onPreview={setSelected} />

      {selected ? (
        <SubscriptionPreview
          canEdit={canEdit}
          contract={selected}
          onBack={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
        />
      ) : null}
      {editing ? (
        <SubscriptionEditor
          {...(editing === 'new' ? {} : { contract: editing })}
          onBack={() => setEditing(null)}
          onSaved={(contract) => {
            setEditing(null);
            setNotice(
              editing === 'new'
                ? `${contract.number} was created.`
                : `${contract.number} was saved.`,
            );
            data.reload();
          }}
          references={data.references}
          token={token}
        />
      ) : null}
    </div>
  );
}

function SubscriptionRegister({
  contracts,
  onPreview,
}: {
  contracts: ServiceSubscriptionContract[];
  onPreview: (contract: ServiceSubscriptionContract) => void;
}) {
  if (!contracts.length)
    return (
      <SubscriptionState title="No service contracts yet">
        <p>
          Create a contract after the customer location and its installed equipment are recorded.
        </p>
      </SubscriptionState>
    );
  return (
    <section aria-label="Service subscription register" className="subscription-register">
      <div className="subscription-register-head" role="row">
        <span>Contract</span>
        <span>Coverage</span>
        <span>Billing</span>
        <span>Status</span>
        <span aria-hidden="true" />
      </div>
      {contracts.map((contract) => (
        <article className="subscription-register-row" key={contract.id}>
          <div className="subscription-identity">
            <span className="sales-document-mark">SC</span>
            <div>
              <strong>{contract.number}</strong>
              <span>{contract.customerName}</span>
              <small>{contract.customerLocationName}</small>
            </div>
          </div>
          <div>
            <strong>{contract.equipment.length} device(s)</strong>
            <span>Coverage every {frequencyLabel(contract.visitFrequencyMonths)}</span>
          </div>
          <div>
            <strong>{formatMoney(contract.billingAmount, contract.currencyCode)}</strong>
            <span>Next {formatDate(contract.nextInvoiceDate)}</span>
          </div>
          <span className={`record-status ${contract.active ? 'is-active' : 'is-inactive'}`}>
            {contract.active ? 'Active' : 'Inactive'}
          </span>
          <Button onClick={() => onPreview(contract)} variant="quiet">
            Preview
          </Button>
        </article>
      ))}
    </section>
  );
}

function SubscriptionPreview({
  canEdit,
  contract,
  onBack,
  onEdit,
}: {
  canEdit: boolean;
  contract: ServiceSubscriptionContract;
  onBack: () => void;
  onEdit: () => void;
}) {
  return (
    <SubscriptionDrawer onBack={onBack} subtitle={contract.customerName} title={contract.number}>
      <div className="subscription-preview-hero">
        <div>
          <span className={`record-status ${contract.active ? 'is-active' : 'is-inactive'}`}>
            {contract.active ? 'Active' : 'Inactive'}
          </span>
          <h3>{contract.customerLocationName}</h3>
          <p>
            {formatDate(contract.validFrom)} –{' '}
            {contract.validTo ? formatDate(contract.validTo) : 'Ongoing'}
          </p>
        </div>
        {canEdit ? (
          <Button onClick={onEdit} variant="secondary">
            Edit contract
          </Button>
        ) : null}
      </div>

      <section className="sales-preview-section">
        <header>
          <div>
            <h3>Covered equipment</h3>
            <p>Devices registered at this customer location.</p>
          </div>
          <span>{contract.equipment.length}</span>
        </header>
        <div className="subscription-equipment-list">
          {contract.equipment.map((equipment) => (
            <div key={equipment.id}>
              <span className="subscription-device-icon">
                <Icon name="sales" size={16} />
              </span>
              <div>
                <strong>{equipment.deviceName}</strong>
                <span>Serial {equipment.serialNumber}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sales-preview-section">
        <header>
          <div>
            <h3>Included services</h3>
            <p>Work covered by the recurring price.</p>
          </div>
          <span>Every {frequencyLabel(contract.visitFrequencyMonths)}</span>
        </header>
        <ul className="subscription-service-list">
          {contract.includedServices.map((service) => (
            <li key={service}>
              <Icon name="check" size={14} /> {service}
            </li>
          ))}
        </ul>
      </section>

      <section className="sales-preview-section subscription-billing-card">
        <header>
          <div>
            <h3>Recurring billing</h3>
            <p>Drafts are prepared automatically for review in Finance.</p>
          </div>
          <strong>{formatMoney(contract.billingAmount, contract.currencyCode)}</strong>
        </header>
        <dl className="subscription-detail-grid">
          <div>
            <dt>Billing cycle</dt>
            <dd>Every {frequencyLabel(contract.billingFrequencyMonths)}</dd>
          </div>
          <div>
            <dt>Next invoice date</dt>
            <dd>{formatDate(contract.nextInvoiceDate)}</dd>
          </div>
        </dl>
        {contract.invoiceDrafts.length ? (
          <div className="subscription-draft-list">
            {contract.invoiceDrafts.map((draft) => (
              <div key={draft.id}>
                <div>
                  <strong>{draft.number}</strong>
                  <span>
                    Service period {formatDate(draft.servicePeriodStart)} –{' '}
                    {formatDate(draft.servicePeriodEnd)}
                  </span>
                </div>
                <strong>{formatMoney(draft.amount, draft.currencyCode)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="sales-boundary-note">No billing drafts have been prepared yet.</p>
        )}
      </section>
    </SubscriptionDrawer>
  );
}

function SubscriptionEditor({
  contract,
  onBack,
  onSaved,
  references,
  token,
}: {
  contract?: ServiceSubscriptionContract;
  onBack: () => void;
  onSaved: (contract: ServiceSubscriptionContract) => void;
  references: SalesSubscriptionReferenceData;
  token: string;
}) {
  const [form, setForm] = useState<SubscriptionFormState>(() => formFor(contract, references));
  const [servicesText, setServicesText] = useState(
    contract?.includedServices.join('\n') ?? 'Preventive maintenance\nRemote support',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locations = references.locations.filter(
    (location) => location.customerPartnerId === form.customerPartnerId,
  );
  const equipment = references.equipment.filter(
    (item) => item.customerLocationId === form.customerLocationId,
  );

  function chooseCustomer(customerPartnerId: string) {
    const customerLocations = references.locations.filter(
      (location) => location.customerPartnerId === customerPartnerId,
    );
    const customerLocationId = customerLocations[0]?.id ?? '';
    setForm((current) => ({
      ...current,
      customerLocationId,
      customerPartnerId,
      equipmentIds: references.equipment
        .filter((item) => item.customerLocationId === customerLocationId)
        .slice(0, 1)
        .map((item) => item.id),
    }));
  }

  function chooseLocation(customerLocationId: string) {
    setForm((current) => ({
      ...current,
      customerLocationId,
      equipmentIds: references.equipment
        .filter((item) => item.customerLocationId === customerLocationId)
        .slice(0, 1)
        .map((item) => item.id),
    }));
  }

  function toggleEquipment(id: string) {
    setForm((current) => ({
      ...current,
      equipmentIds: current.equipmentIds.includes(id)
        ? current.equipmentIds.filter((item) => item !== id)
        : [...current.equipmentIds, id],
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const includedServices = servicesText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      const input = { ...form, includedServices };
      if (contract) {
        onSaved(
          await updateServiceSubscription(token, contract.id, crypto.randomUUID(), {
            ...input,
            expectedVersion: contract.version,
          }),
        );
      } else {
        const createInput: CreateServiceSubscriptionRequest = {
          billingAmount: input.billingAmount,
          billingFrequencyMonths: input.billingFrequencyMonths,
          currencyCode: input.currencyCode,
          customerLocationId: input.customerLocationId,
          customerPartnerId: input.customerPartnerId,
          equipmentIds: input.equipmentIds,
          includedServices: input.includedServices,
          nextInvoiceDate: input.nextInvoiceDate,
          validFrom: input.validFrom,
          ...(input.validTo ? { validTo: input.validTo } : {}),
          visitFrequencyMonths: input.visitFrequencyMonths,
        };
        onSaved(await createServiceSubscription(token, crypto.randomUUID(), createInput));
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SubscriptionDrawer
      busy={busy}
      onBack={onBack}
      subtitle={contract ? contract.customerName : 'Define contract coverage and recurring billing'}
      title={contract ? `Edit ${contract.number}` : 'New service contract'}
    >
      <form className="subscription-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="sales-form-section">
          <header>
            <span>1</span>
            <div>
              <h3>Customer location</h3>
              <p>Choose the customer site where the covered equipment is installed.</p>
            </div>
          </header>
          <div className="sales-form-grid">
            <SubscriptionField label="Customer">
              <select
                onChange={(event) => chooseCustomer(event.target.value)}
                required
                value={form.customerPartnerId}
              >
                <option value="">Choose customer</option>
                {references.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </SubscriptionField>
            <SubscriptionField label="Service location">
              <select
                onChange={(event) => chooseLocation(event.target.value)}
                required
                value={form.customerLocationId}
              >
                <option value="">Choose location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </SubscriptionField>
          </div>
        </section>

        <section className="sales-form-section">
          <header>
            <span>2</span>
            <div>
              <h3>Covered equipment</h3>
              <p>Select one or more active devices registered at this location.</p>
            </div>
          </header>
          {equipment.length ? (
            <div className="subscription-equipment-picker">
              {equipment.map((item) => (
                <label key={item.id}>
                  <input
                    checked={form.equipmentIds.includes(item.id)}
                    onChange={() => toggleEquipment(item.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{item.deviceName}</strong>
                    <small>Serial {item.serialNumber}</small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <InlineAlert tone="info">
              Add equipment to this customer location in Customers &amp; CRM before creating the
              contract.
            </InlineAlert>
          )}
        </section>

        <section className="sales-form-section">
          <header>
            <span>3</span>
            <div>
              <h3>Service coverage</h3>
              <p>List each included service on its own line and record the coverage frequency.</p>
            </div>
          </header>
          <SubscriptionField label="Included services">
            <textarea
              maxLength={2500}
              onChange={(event) => setServicesText(event.target.value)}
              required
              rows={4}
              value={servicesText}
            />
          </SubscriptionField>
          <div className="sales-form-grid">
            <SubscriptionField label="Coverage frequency">
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    visitFrequencyMonths: Number(event.target.value),
                  }))
                }
                value={form.visitFrequencyMonths}
              >
                {frequencyOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SubscriptionField>
            <SubscriptionField label="Contract status">
              <select
                disabled={!contract}
                onChange={(event) =>
                  setForm((current) => ({ ...current, active: event.target.value === 'active' }))
                }
                value={form.active ? 'active' : 'inactive'}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </SubscriptionField>
          </div>
        </section>

        <section className="sales-form-section">
          <header>
            <span>4</span>
            <div>
              <h3>Period and billing</h3>
              <p>Set the contract period, recurring amount, and first billing date.</p>
            </div>
          </header>
          <div className="sales-form-grid is-three">
            <SubscriptionField label="Starts on">
              <input
                onChange={(event) =>
                  setForm((current) => ({ ...current, validFrom: event.target.value }))
                }
                required
                type="date"
                value={form.validFrom}
              />
            </SubscriptionField>
            <SubscriptionField label="Ends on">
              <input
                min={form.validFrom}
                onChange={(event) =>
                  setForm((current) => {
                    if (event.target.value) return { ...current, validTo: event.target.value };
                    const withoutValidTo = { ...current };
                    delete withoutValidTo.validTo;
                    return withoutValidTo;
                  })
                }
                type="date"
                value={form.validTo ?? ''}
              />
            </SubscriptionField>
            <SubscriptionField label="Next invoice date">
              <input
                min={form.validFrom}
                onChange={(event) =>
                  setForm((current) => ({ ...current, nextInvoiceDate: event.target.value }))
                }
                required
                type="date"
                value={form.nextInvoiceDate}
              />
            </SubscriptionField>
          </div>
          <div className="sales-form-grid is-three">
            <SubscriptionField label="Recurring amount">
              <input
                min="0"
                onChange={(event) =>
                  setForm((current) => ({ ...current, billingAmount: event.target.value }))
                }
                required
                step="0.0001"
                type="number"
                value={form.billingAmount}
              />
            </SubscriptionField>
            <SubscriptionField label="Currency">
              <input
                maxLength={3}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    currencyCode: event.target.value.toUpperCase(),
                  }))
                }
                required
                value={form.currencyCode}
              />
            </SubscriptionField>
            <SubscriptionField label="Billing frequency">
              <select
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    billingFrequencyMonths: Number(event.target.value),
                  }))
                }
                value={form.billingFrequencyMonths}
              >
                {frequencyOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SubscriptionField>
          </div>
        </section>

        <div className="sales-drawer-actions">
          <Button disabled={busy || !form.equipmentIds.length} type="submit">
            {busy ? 'Saving…' : contract ? 'Save contract' : 'Create contract'}
          </Button>
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
    </SubscriptionDrawer>
  );
}

function SubscriptionDrawer({
  busy = false,
  children,
  onBack,
  subtitle,
  title,
}: {
  busy?: boolean;
  children: React.ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label="Back to service subscriptions"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide sales-drawer subscription-drawer"
        role="dialog"
      >
        <header className="sales-drawer-header">
          <button
            aria-label="Back to service subscriptions"
            className="sales-back-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="arrow" size={17} /> Back
          </button>
          <button
            aria-label="Close panel"
            className="sales-close-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="close" />
          </button>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function SubscriptionField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="sales-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SubscriptionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SubscriptionState({ children, title }: { children?: React.ReactNode; title: string }) {
  return (
    <section className="procurement-state">
      <Icon name="sales" size={24} />
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function useSubscriptions(token: string) {
  const [contracts, setContracts] = useState<ServiceSubscriptionContract[]>([]);
  const [references, setReferences] = useState(emptyReferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([getSalesSubscriptionReferenceData(token), listServiceSubscriptions(token)])
      .then(([nextReferences, nextContracts]) => {
        if (!active) return;
        setReferences(nextReferences);
        setContracts(nextContracts);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [revision, token]);
  return useMemo(
    () => ({ contracts, error, loading, references, reload }),
    [contracts, error, loading, references, reload],
  );
}

function formFor(
  contract: ServiceSubscriptionContract | undefined,
  references: SalesSubscriptionReferenceData,
): SubscriptionFormState {
  if (contract)
    return {
      active: contract.active,
      billingAmount: contract.billingAmount,
      billingFrequencyMonths: contract.billingFrequencyMonths,
      currencyCode: contract.currencyCode,
      customerLocationId: contract.customerLocationId,
      customerPartnerId: contract.customerPartnerId,
      equipmentIds: contract.equipment.map((item) => item.id),
      includedServices: contract.includedServices,
      nextInvoiceDate: contract.nextInvoiceDate,
      validFrom: contract.validFrom,
      ...(contract.validTo ? { validTo: contract.validTo } : {}),
      visitFrequencyMonths: contract.visitFrequencyMonths,
    };
  const customerPartnerId = references.customers[0]?.id ?? '';
  const customerLocationId = references.locations.find(
    (location) => location.customerPartnerId === customerPartnerId,
  )?.id;
  return {
    active: true,
    billingAmount: '0.00',
    billingFrequencyMonths: 1,
    currencyCode: 'BGN',
    customerLocationId: customerLocationId ?? '',
    customerPartnerId,
    equipmentIds: references.equipment
      .filter((item) => item.customerLocationId === customerLocationId)
      .slice(0, 1)
      .map((item) => item.id),
    includedServices: [],
    nextInvoiceDate: today(),
    validFrom: today(),
    visitFrequencyMonths: 3,
  };
}

function frequencyOptions() {
  return [
    { label: 'Every month', value: 1 },
    { label: 'Every 2 months', value: 2 },
    { label: 'Every 3 months', value: 3 },
    { label: 'Every 6 months', value: 6 },
    { label: 'Every year', value: 12 },
  ];
}

function frequencyLabel(months: number) {
  if (months === 1) return 'month';
  if (months === 12) return 'year';
  return `${months} months`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
    new Date(`${value.slice(0, 10)}T12:00:00Z`),
  );
}

function formatMoney(value: string, currency: string) {
  return new Intl.NumberFormat('en-GB', { currency, style: 'currency' }).format(Number(value));
}

function errorText(error: unknown) {
  return error instanceof ApiClientError
    ? error.message
    : 'The service subscription could not be saved. Check the details and try again.';
}
