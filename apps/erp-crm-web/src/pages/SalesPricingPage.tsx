import { Button, InlineAlert } from '@vista/ui';
import { useActiveItemVisibility } from '@vista/ui/navigation';
import type {
  CreatePriceListLineRequest,
  CustomerPriceGroup,
  PriceList,
  PriceListScope,
  PromotionalCampaign,
  SalesPricingReferenceData,
  SalesResolvedPrice,
} from '@vista/contracts';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import {
  createCustomerPriceGroup,
  createPriceList,
  createPromotionalCampaign,
  getSalesPricingReferenceData,
  listPriceLists,
  resolveSalesPrice,
  updateCustomerPriceGroup,
  updatePriceList,
  updatePromotionalCampaign,
} from '../api/sales-pricing';
import { ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { salesPricingMessages as copy } from '../messages';

type PricingTab = 'price-lists' | 'groups' | 'campaigns';
type PricingDrawer =
  | { mode: 'create'; type: PricingTab }
  | { mode: 'edit'; record: CustomerPriceGroup; type: 'groups' }
  | { mode: 'edit'; record: PriceList; type: 'price-lists' }
  | { mode: 'edit'; record: PromotionalCampaign; type: 'campaigns' };

const emptyReferences: SalesPricingReferenceData = {
  campaigns: [],
  customerGroups: [],
  customers: [],
  products: [],
};

export function SalesPricingPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const [tab, setTab] = useState<PricingTab>('price-lists');
  const [drawer, setDrawer] = useState<PricingDrawer | null>(null);
  const [notice, setNotice] = useState('');
  const data = usePricingData(token);
  const tabs = useActiveItemVisibility<HTMLDivElement>(tab);
  const canCreate = hasPermission('erp.sales', 'create');
  const canEdit = hasPermission('erp.sales', 'edit');

  if (data.loading) return <PricingState title={copy.loading} />;
  if (data.error)
    return (
      <PricingState title={copy.error}>
        <Button onClick={data.reload} variant="secondary">
          {copy.retry}
        </Button>
      </PricingState>
    );

  const labels: Record<PricingTab, string> = {
    campaigns: copy.campaigns,
    groups: copy.customerGroups,
    'price-lists': copy.priceLists,
  };

  return (
    <div className="page-stack pricing-page">
      <header className="page-header pricing-page-header">
        <div>
          <p className="page-eyebrow">ERP · Sales</p>
          <h1>{copy.pricing}</h1>
          <p>{copy.pricingSubtitle}</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setDrawer({ mode: 'create', type: tab })}>
            <Icon name="plus" size={17} />
            {tab === 'price-lists'
              ? copy.addPriceList
              : tab === 'groups'
                ? copy.addCustomerGroup
                : copy.addCampaign}
          </Button>
        ) : null}
      </header>

      <section aria-label="Pricing summary" className="pricing-summary">
        <PricingMetric label={copy.priceLists} value={data.priceLists.length} />
        <PricingMetric label={copy.customerGroups} value={data.references.customerGroups.length} />
        <PricingMetric label={copy.campaigns} value={data.references.campaigns.length} />
      </section>

      {notice ? (
        <InlineAlert tone="success">
          <div className="partners-inline-message">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} type="button">
              {copy.close}
            </button>
          </div>
        </InlineAlert>
      ) : null}

      <section className="pricing-workbench">
        <div aria-label="Pricing areas" className="pricing-tabs" ref={tabs} role="tablist">
          {(['price-lists', 'groups', 'campaigns'] as const).map((item) => (
            <button
              aria-current={tab === item ? 'page' : undefined}
              aria-selected={tab === item}
              className={tab === item ? 'is-active' : undefined}
              key={item}
              onClick={() => setTab(item)}
              role="tab"
              type="button"
            >
              {labels[item]}
            </button>
          ))}
        </div>

        {tab === 'price-lists' ? (
          <PriceListRegister
            canEdit={canEdit}
            onEdit={(record) => setDrawer({ mode: 'edit', record, type: 'price-lists' })}
            priceLists={data.priceLists}
            references={data.references}
            token={token}
          />
        ) : tab === 'groups' ? (
          <GroupRegister
            canEdit={canEdit}
            groups={data.references.customerGroups}
            onEdit={(record) => setDrawer({ mode: 'edit', record, type: 'groups' })}
            references={data.references}
          />
        ) : (
          <CampaignRegister
            campaigns={data.references.campaigns}
            canEdit={canEdit}
            onEdit={(record) => setDrawer({ mode: 'edit', record, type: 'campaigns' })}
          />
        )}
      </section>

      {drawer ? (
        <PricingDrawerPanel onClose={() => setDrawer(null)} title={drawerTitle(drawer)}>
          {drawer.type === 'price-lists' ? (
            <PriceListForm
              onClose={() => setDrawer(null)}
              onSaved={() => saved(setDrawer, setNotice, data.reload)}
              {...(drawer.mode === 'edit' ? { record: drawer.record } : {})}
              references={data.references}
              token={token}
            />
          ) : drawer.type === 'groups' ? (
            <CustomerGroupForm
              onClose={() => setDrawer(null)}
              onSaved={() => saved(setDrawer, setNotice, data.reload)}
              {...(drawer.mode === 'edit' ? { record: drawer.record } : {})}
              references={data.references}
              token={token}
            />
          ) : (
            <CampaignForm
              onClose={() => setDrawer(null)}
              onSaved={() => saved(setDrawer, setNotice, data.reload)}
              {...(drawer.mode === 'edit' ? { record: drawer.record } : {})}
              token={token}
            />
          )}
        </PricingDrawerPanel>
      ) : null}
    </div>
  );
}

function PriceListRegister({
  canEdit,
  onEdit,
  priceLists,
  references,
  token,
}: {
  canEdit: boolean;
  onEdit: (record: PriceList) => void;
  priceLists: PriceList[];
  references: SalesPricingReferenceData;
  token: string;
}) {
  return (
    <div className="pricing-register-layout">
      <section aria-label={copy.priceLists} className="pricing-record-list">
        {priceLists.length ? (
          priceLists.map((record) => (
            <article className={!record.active ? 'is-inactive' : undefined} key={record.id}>
              <div className="pricing-record-identity">
                <span>{record.code.slice(0, 2)}</span>
                <div>
                  <strong>{record.name}</strong>
                  <small>{record.code}</small>
                </div>
              </div>
              <div className="pricing-record-scope">
                <strong>{scopeLabel(record)}</strong>
                <small>
                  {formatDate(record.validFrom)} – {formatDate(record.validTo)}
                </small>
              </div>
              <div className="pricing-record-value">
                <strong>{record.lines.length}</strong>
                <small>{record.lines.length === 1 ? 'product price' : 'product prices'}</small>
              </div>
              <span className={`pricing-status ${record.active ? 'is-active' : ''}`}>
                {record.active ? copy.active : copy.deactivate}
              </span>
              {canEdit ? (
                <Button onClick={() => onEdit(record)} variant="quiet">
                  Edit
                </Button>
              ) : null}
            </article>
          ))
        ) : (
          <PricingState compact title={copy.emptyPriceLists} />
        )}
      </section>
      <PriceResolver references={references} token={token} />
    </div>
  );
}

function GroupRegister({
  canEdit,
  groups,
  onEdit,
  references,
}: {
  canEdit: boolean;
  groups: CustomerPriceGroup[];
  onEdit: (record: CustomerPriceGroup) => void;
  references: SalesPricingReferenceData;
}) {
  const customerById = new Map(
    references.customers.map((customer) => [customer.id, customer.name]),
  );
  return (
    <section aria-label={copy.customerGroups} className="pricing-card-grid">
      {groups.length ? (
        groups.map((group) => (
          <article className={!group.active ? 'is-inactive' : undefined} key={group.id}>
            <header>
              <span className="pricing-card-mark">
                <Icon name="customers" size={18} />
              </span>
              <span className={`pricing-status ${group.active ? 'is-active' : ''}`}>
                {group.active ? copy.active : copy.deactivate}
              </span>
            </header>
            <h3>{group.name}</h3>
            <p>{group.code}</p>
            <div className="pricing-member-preview">
              <strong>
                {group.customerPartnerIds.length}{' '}
                {group.customerPartnerIds.length === 1 ? 'customer' : 'customers'}
              </strong>
              <span>
                {group.customerPartnerIds
                  .slice(0, 2)
                  .map((id) => customerById.get(id))
                  .filter(Boolean)
                  .join(', ') || 'No customers assigned'}
              </span>
            </div>
            {canEdit ? (
              <Button onClick={() => onEdit(group)} variant="secondary">
                Edit group
              </Button>
            ) : null}
          </article>
        ))
      ) : (
        <PricingState compact title={copy.emptyGroups} />
      )}
    </section>
  );
}

function CampaignRegister({
  campaigns,
  canEdit,
  onEdit,
}: {
  campaigns: PromotionalCampaign[];
  canEdit: boolean;
  onEdit: (record: PromotionalCampaign) => void;
}) {
  const today = dateValue(new Date());
  return (
    <section aria-label={copy.campaigns} className="pricing-card-grid">
      {campaigns.length ? (
        campaigns.map((campaign) => {
          const current =
            campaign.active && campaign.validFrom <= today && campaign.validTo >= today;
          return (
            <article className={!campaign.active ? 'is-inactive' : undefined} key={campaign.id}>
              <header>
                <span className="pricing-card-mark">
                  <Icon name="sales" size={18} />
                </span>
                <span className={`pricing-status ${current ? 'is-active' : ''}`}>
                  {!campaign.active ? copy.deactivate : current ? 'Running' : 'Scheduled'}
                </span>
              </header>
              <h3>{campaign.name}</h3>
              <p>{campaign.code}</p>
              <div className="pricing-member-preview">
                <strong>{copy.period}</strong>
                <span>
                  {formatDate(campaign.validFrom)} – {formatDate(campaign.validTo)}
                </span>
              </div>
              {canEdit ? (
                <Button onClick={() => onEdit(campaign)} variant="secondary">
                  Edit campaign
                </Button>
              ) : null}
            </article>
          );
        })
      ) : (
        <PricingState compact title={copy.emptyCampaigns} />
      )}
    </section>
  );
}

function PriceResolver({
  references,
  token,
}: {
  references: SalesPricingReferenceData;
  token: string;
}) {
  const [customerPartnerId, setCustomerPartnerId] = useState(references.customers[0]?.id ?? '');
  const [productId, setProductId] = useState(references.products[0]?.id ?? '');
  const [asOf, setAsOf] = useState(dateValue(new Date()));
  const [currencyCode, setCurrencyCode] = useState('BGN');
  const [result, setResult] = useState<SalesResolvedPrice | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(
        await resolveSalesPrice(token, { asOf, currencyCode, customerPartnerId, productId }),
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="price-resolver" onSubmit={(event) => void submit(event)}>
      <header>
        <span className="pricing-card-mark">
          <Icon name="search" size={18} />
        </span>
        <div>
          <h2>{copy.checkPrice}</h2>
          <p>{copy.checkPriceDescription}</p>
        </div>
      </header>
      <PricingSelect
        label={copy.customer}
        onChange={setCustomerPartnerId}
        options={references.customers.map((item) => ({ label: item.name, value: item.id }))}
        value={customerPartnerId}
      />
      <PricingSelect
        label={copy.product}
        onChange={setProductId}
        options={references.products.map((item) => ({
          label: `${item.name} · ${item.productCode}`,
          value: item.id,
        }))}
        value={productId}
      />
      <PricingField label={copy.startDate}>
        <input onChange={(event) => setAsOf(event.target.value)} type="date" value={asOf} />
      </PricingField>
      <PricingField label={copy.currency}>
        <input
          maxLength={3}
          onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
          pattern="[A-Za-z]{3}"
          required
          value={currencyCode}
        />
      </PricingField>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {result ? (
        result.matched ? (
          <div className="resolved-price">
            <span>{copy.resolvedBy}</span>
            <strong>{formatMoney(result.unitPrice ?? '0', result.currencyCode)}</strong>
            <small>
              {result.priceListName} · {result.priceListCode}
            </small>
          </div>
        ) : (
          <InlineAlert tone="info">{copy.noMatch}</InlineAlert>
        )
      ) : null}
      <Button
        busy={busy}
        disabled={!customerPartnerId || !productId || !asOf || !/^[A-Z]{3}$/u.test(currencyCode)}
        type="submit"
      >
        {copy.checkPrice}
      </Button>
    </form>
  );
}

function PriceListForm({
  onClose,
  onSaved,
  record,
  references,
  token,
}: {
  onClose: () => void;
  onSaved: () => void;
  record?: PriceList;
  references: SalesPricingReferenceData;
  token: string;
}) {
  const [code, setCode] = useState(record?.code ?? '');
  const [name, setName] = useState(record?.name ?? '');
  const [scope, setScope] = useState<PriceListScope>(record?.scope ?? 'all_customers');
  const [customerGroupId, setCustomerGroupId] = useState(record?.customerGroup?.id ?? '');
  const [customerPartnerId, setCustomerPartnerId] = useState(record?.customer?.id ?? '');
  const [campaignId, setCampaignId] = useState(record?.campaign?.id ?? '');
  const [currencyCode, setCurrencyCode] = useState(record?.currencyCode ?? 'BGN');
  const [validFrom, setValidFrom] = useState(record?.validFrom ?? dateValue(new Date()));
  const [validTo, setValidTo] = useState(record?.validTo ?? futureDate(365));
  const [priority, setPriority] = useState(String(record?.priority ?? 0));
  const [active, setActive] = useState(record?.active ?? true);
  const [lines, setLines] = useState<Array<CreatePriceListLineRequest & { key: string }>>(
    record?.lines.map((line) => ({
      key: line.id,
      productId: line.productId,
      unitPrice: line.unitPrice,
    })) ?? [newPriceLine(references)],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      ...(campaignId ? { campaignId } : {}),
      code,
      currencyCode,
      ...(scope === 'customer_group' ? { customerGroupId } : {}),
      ...(scope === 'customer' ? { customerPartnerId } : {}),
      lines: lines.map(({ productId, unitPrice }) => ({ productId, unitPrice })),
      name,
      priority: Number(priority),
      scope,
      validFrom,
      validTo,
    };
    setBusy(true);
    setError('');
    try {
      if (record)
        await updatePriceList(token, record.id, crypto.randomUUID(), {
          ...input,
          active,
          version: record.version,
        });
      else await createPriceList(token, crypto.randomUUID(), input);
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pricing-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.priceListDescription}</p>
      <div className="pricing-form-grid">
        <PricingField label={copy.code}>
          <input
            autoFocus
            maxLength={40}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            required
            value={code}
          />
        </PricingField>
        <PricingField label={copy.name}>
          <input
            maxLength={150}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </PricingField>
        <PricingField label={copy.scope}>
          <select
            onChange={(event) => {
              setScope(event.target.value as PriceListScope);
              setCustomerGroupId('');
              setCustomerPartnerId('');
            }}
            value={scope}
          >
            <option value="all_customers">{copy.generalScope}</option>
            <option value="customer_group">{copy.scopeGroup}</option>
            <option value="customer">{copy.individualScope}</option>
          </select>
        </PricingField>
        {scope === 'customer_group' ? (
          <PricingSelect
            label={copy.customerGroup}
            onChange={setCustomerGroupId}
            options={references.customerGroups
              .filter((item) => item.active || item.id === customerGroupId)
              .map((item) => ({ label: item.name, value: item.id }))}
            required
            value={customerGroupId}
          />
        ) : null}
        {scope === 'customer' ? (
          <PricingSelect
            label={copy.customer}
            onChange={setCustomerPartnerId}
            options={references.customers.map((item) => ({ label: item.name, value: item.id }))}
            required
            value={customerPartnerId}
          />
        ) : null}
        <PricingSelect
          label={copy.campaign}
          onChange={setCampaignId}
          options={[
            { label: copy.noCampaign, value: '' },
            ...references.campaigns.map((item) => ({ label: item.name, value: item.id })),
          ]}
          value={campaignId}
        />
        <PricingField label={copy.currency}>
          <input
            maxLength={3}
            onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
            required
            value={currencyCode}
          />
        </PricingField>
        <PricingField label={copy.priority} hint={copy.priorityHint}>
          <input
            max="1000"
            min="-1000"
            onChange={(event) => setPriority(event.target.value)}
            required
            type="number"
            value={priority}
          />
        </PricingField>
        <PricingField label={copy.startDate}>
          <input
            onChange={(event) => setValidFrom(event.target.value)}
            required
            type="date"
            value={validFrom}
          />
        </PricingField>
        <PricingField label={copy.endDate}>
          <input
            onChange={(event) => setValidTo(event.target.value)}
            required
            type="date"
            value={validTo}
          />
        </PricingField>
      </div>

      <section className="pricing-line-editor">
        <header>
          <div>
            <h3>{copy.product}</h3>
            <p>Enter the future unit price for each product.</p>
          </div>
          <Button
            onClick={() => setLines((current) => [...current, newPriceLine(references)])}
            type="button"
            variant="secondary"
          >
            <Icon name="plus" size={15} /> {copy.addLine}
          </Button>
        </header>
        {lines.map((line, index) => (
          <div className="pricing-line-row" key={line.key}>
            <PricingSelect
              label={`${copy.product} ${index + 1}`}
              onChange={(value) => updatePriceLine(setLines, line.key, { productId: value })}
              options={references.products.map((item) => ({
                label: `${item.name} · ${item.productCode}`,
                value: item.id,
              }))}
              required
              value={line.productId}
            />
            <PricingField label={`${copy.linePrice} ${index + 1}`}>
              <input
                inputMode="decimal"
                onChange={(event) =>
                  updatePriceLine(setLines, line.key, { unitPrice: event.target.value })
                }
                pattern="\d+(\.\d{1,4})?"
                required
                value={line.unitPrice}
              />
            </PricingField>
            {lines.length > 1 ? (
              <button
                aria-label={`${copy.removeLine} ${index + 1}`}
                className="pricing-remove-line"
                onClick={() =>
                  setLines((current) => current.filter((item) => item.key !== line.key))
                }
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            ) : null}
          </div>
        ))}
      </section>
      {record ? <ActiveControl active={active} onChange={setActive} /> : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <DrawerActions
        busy={busy}
        onClose={onClose}
        submit={record ? copy.savePriceList : copy.createPriceList}
      />
    </form>
  );
}

function CustomerGroupForm({
  onClose,
  onSaved,
  record,
  references,
  token,
}: {
  onClose: () => void;
  onSaved: () => void;
  record?: CustomerPriceGroup;
  references: SalesPricingReferenceData;
  token: string;
}) {
  const [code, setCode] = useState(record?.code ?? '');
  const [name, setName] = useState(record?.name ?? '');
  const [customerIds, setCustomerIds] = useState(record?.customerPartnerIds ?? []);
  const [active, setActive] = useState(record?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (record)
        await updateCustomerPriceGroup(token, record.id, crypto.randomUUID(), {
          active,
          customerPartnerIds: customerIds,
          name,
          version: record.version,
        });
      else
        await createCustomerPriceGroup(token, crypto.randomUUID(), {
          code,
          customerPartnerIds: customerIds,
          name,
        });
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pricing-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.customerGroupDescription}</p>
      <div className="pricing-form-grid">
        <PricingField label={copy.code}>
          <input
            autoFocus
            disabled={Boolean(record)}
            maxLength={40}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            required
            value={code}
          />
        </PricingField>
        <PricingField label={copy.customerGroupName}>
          <input
            maxLength={150}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </PricingField>
      </div>
      <fieldset className="pricing-customer-picker">
        <legend>{copy.customers}</legend>
        {references.customers.length ? (
          references.customers.map((customer) => (
            <label key={customer.id}>
              <input
                checked={customerIds.includes(customer.id)}
                onChange={() =>
                  setCustomerIds((current) =>
                    current.includes(customer.id)
                      ? current.filter((id) => id !== customer.id)
                      : [...current, customer.id],
                  )
                }
                type="checkbox"
              />
              <span>{customer.name}</span>
            </label>
          ))
        ) : (
          <p>No active customers are available.</p>
        )}
      </fieldset>
      {record ? <ActiveControl active={active} onChange={setActive} /> : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <DrawerActions
        busy={busy}
        onClose={onClose}
        submit={record ? copy.saveCustomerGroup : copy.createCustomerGroup}
      />
    </form>
  );
}

function CampaignForm({
  onClose,
  onSaved,
  record,
  token,
}: {
  onClose: () => void;
  onSaved: () => void;
  record?: PromotionalCampaign;
  token: string;
}) {
  const [code, setCode] = useState(record?.code ?? '');
  const [name, setName] = useState(record?.name ?? '');
  const [validFrom, setValidFrom] = useState(record?.validFrom ?? dateValue(new Date()));
  const [validTo, setValidTo] = useState(record?.validTo ?? futureDate(30));
  const [active, setActive] = useState(record?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (record)
        await updatePromotionalCampaign(token, record.id, crypto.randomUUID(), {
          active,
          name,
          validFrom,
          validTo,
          version: record.version,
        });
      else
        await createPromotionalCampaign(token, crypto.randomUUID(), {
          code,
          name,
          validFrom,
          validTo,
        });
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pricing-form" onSubmit={(event) => void submit(event)}>
      <p>{copy.campaignDescription}</p>
      <div className="pricing-form-grid">
        <PricingField label={copy.code}>
          <input
            autoFocus
            disabled={Boolean(record)}
            maxLength={40}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            required
            value={code}
          />
        </PricingField>
        <PricingField label={copy.campaignName}>
          <input
            maxLength={150}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </PricingField>
        <PricingField label={copy.startDate}>
          <input
            onChange={(event) => setValidFrom(event.target.value)}
            required
            type="date"
            value={validFrom}
          />
        </PricingField>
        <PricingField label={copy.endDate}>
          <input
            onChange={(event) => setValidTo(event.target.value)}
            required
            type="date"
            value={validTo}
          />
        </PricingField>
      </div>
      {record ? <ActiveControl active={active} onChange={setActive} /> : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <DrawerActions
        busy={busy}
        onClose={onClose}
        submit={record ? copy.saveCampaign : copy.createCampaign}
      />
    </form>
  );
}

function PricingDrawerPanel({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label={copy.close}
        className="security-drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide pricing-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header">
          <button
            aria-label={`Back to ${copy.pricing}`}
            className="panel-back-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} /> {copy.back}
          </button>
          <button
            aria-label={copy.close}
            className="panel-close-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
          <div>
            <p className="page-eyebrow">ERP · Sales</p>
            <h2>{title}</h2>
          </div>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function PricingMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PricingField({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <label className="pricing-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function PricingSelect({
  label,
  onChange,
  options,
  required = false,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  required?: boolean;
  value: string;
}) {
  return (
    <PricingField label={label}>
      <select onChange={(event) => onChange(event.target.value)} required={required} value={value}>
        {required && !value ? <option value="">Choose</option> : null}
        {options.map((option) => (
          <option key={option.value || 'empty'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </PricingField>
  );
}

function ActiveControl({
  active,
  onChange,
}: {
  active: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="pricing-active-control">
      <input
        checked={active}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        <strong>{copy.active}</strong>
        <small>Inactive records remain in history but do not apply to future prices.</small>
      </span>
    </label>
  );
}

function DrawerActions({
  busy,
  onClose,
  submit,
}: {
  busy: boolean;
  onClose: () => void;
  submit: string;
}) {
  return (
    <div className="drawer-actions">
      <Button disabled={busy} onClick={onClose} type="button" variant="quiet">
        {copy.close}
      </Button>
      <Button busy={busy} type="submit">
        {submit}
      </Button>
    </div>
  );
}

function PricingState({
  children,
  compact = false,
  title,
}: {
  children?: React.ReactNode;
  compact?: boolean;
  title: string;
}) {
  return (
    <section className={`procurement-state${compact ? ' is-compact' : ''}`}>
      <Icon name="sales" size={24} />
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function usePricingData(token: string) {
  const [references, setReferences] = useState(emptyReferences);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([getSalesPricingReferenceData(token), listPriceLists(token)])
      .then(([nextReferences, nextPriceLists]) => {
        if (active) {
          setReferences(nextReferences);
          setPriceLists(nextPriceLists);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, token]);
  return { error, loading, priceLists, references, reload };
}

function saved(
  setDrawer: React.Dispatch<React.SetStateAction<PricingDrawer | null>>,
  setNotice: React.Dispatch<React.SetStateAction<string>>,
  reload: () => void,
) {
  setDrawer(null);
  setNotice(copy.updated);
  reload();
}

function drawerTitle(drawer: PricingDrawer): string {
  if (drawer.type === 'price-lists')
    return drawer.mode === 'create' ? copy.createPriceList : copy.savePriceList;
  if (drawer.type === 'groups')
    return drawer.mode === 'create' ? copy.createCustomerGroup : copy.saveCustomerGroup;
  return drawer.mode === 'create' ? copy.createCampaign : copy.saveCampaign;
}

function scopeLabel(record: PriceList) {
  if (record.scope === 'customer') return record.customer?.name ?? copy.individualScope;
  if (record.scope === 'customer_group') return record.customerGroup?.name ?? copy.scopeGroup;
  return copy.allCustomers;
}

function newPriceLine(references: SalesPricingReferenceData) {
  return { key: crypto.randomUUID(), productId: references.products[0]?.id ?? '', unitPrice: '0' };
}

function updatePriceLine(
  setLines: React.Dispatch<
    React.SetStateAction<Array<CreatePriceListLineRequest & { key: string }>>
  >,
  key: string,
  patch: Partial<CreatePriceListLineRequest>,
) {
  setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
}

function dateValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return dateValue(date);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function formatMoney(value: string, currency: string) {
  return new Intl.NumberFormat('en-GB', { currency, style: 'currency' }).format(Number(value));
}

function errorText(error: unknown) {
  return error instanceof ApiClientError ? error.message : 'The pricing record could not be saved.';
}
