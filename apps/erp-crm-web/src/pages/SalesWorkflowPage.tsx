import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateSalesQuotationRequest,
  SalesReferenceData,
  SalesWorkflow,
  VatTreatment,
} from '@vista/contracts';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  acceptSalesHandover,
  confirmSalesQuotation,
  createSalesInvoiceDraft,
  createSalesQuotation,
  createSalesShipment,
  getSalesReferenceData,
  listSalesWorkflows,
} from '../api/sales';
import { resolveSalesPrice } from '../api/sales-pricing';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';
import { erpReportMessages } from './erp-report.messages';

export function SalesWorkflowPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useSalesData(token);
  const [preview, setPreview] = useState<SalesWorkflow | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canCreate = hasPermission('erp.sales', 'create');
  const canEdit = hasPermission('erp.sales', 'edit');

  if (data.loading) return <SalesState title="Loading sales records" />;
  if (data.error)
    return (
      <SalesState title="Sales records could not be loaded">
        <Button onClick={data.reload} variant="secondary">
          Try again
        </Button>
      </SalesState>
    );

  return (
    <div className="page-stack sales-workspace">
      <header className="page-header sales-workspace-header">
        <div>
          <p className="page-eyebrow">ERP · Sales</p>
          <h1>Sales workflow</h1>
          <p>
            Create quotations, confirm orders, record shipments, and prepare invoices in one flow.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={17} /> New quotation
          </Button>
        ) : null}
      </header>

      <Link className="sales-report-link" to="/modules/erp.sales/reports">
        <Icon name="chart" size={16} />
        {erpReportMessages.title}
      </Link>
      <WorkflowSummary workflows={data.workflows} />
      {notice ? (
        <Toast onDismiss={() => setNotice(null)} tone="success">
          {notice}
        </Toast>
      ) : null}
      <SalesRegister onPreview={setPreview} workflows={data.workflows} />

      {creating ? (
        <QuotationDrawer
          onBack={() => setCreating(false)}
          onSaved={(workflow) => {
            setCreating(false);
            setNotice(`${workflow.number} was created.`);
            data.reload();
          }}
          references={data.references}
          token={token}
        />
      ) : null}
      {preview ? (
        <WorkflowDrawer
          canCreate={canCreate}
          canEdit={canEdit}
          onBack={() => setPreview(null)}
          onSaved={(workflow, message) => {
            setPreview(workflow);
            setNotice(message);
            data.reload();
          }}
          references={data.references}
          token={token}
          workflow={preview}
        />
      ) : null}
    </div>
  );
}

function WorkflowSummary({ workflows }: { workflows: SalesWorkflow[] }) {
  const stages = [
    ['Draft quotations', workflows.filter((item) => item.status === 'draft').length],
    ['Confirmed orders', workflows.filter((item) => item.status === 'confirmed').length],
    ['Ready to invoice', workflows.filter((item) => item.status === 'shipped').length],
    ['Invoice drafts', workflows.filter((item) => item.status === 'invoiced').length],
  ];
  return (
    <section aria-label="Sales workflow summary" className="sales-stage-summary">
      {stages.map(([label, count], index) => (
        <div key={label}>
          <span>{index + 1}</span>
          <p>{label}</p>
          <strong>{count}</strong>
        </div>
      ))}
    </section>
  );
}

function SalesRegister({
  onPreview,
  workflows,
}: {
  onPreview: (workflow: SalesWorkflow) => void;
  workflows: SalesWorkflow[];
}) {
  if (!workflows.length)
    return (
      <SalesState title="No quotations yet">
        <p>Create the first quotation to begin the sales workflow.</p>
      </SalesState>
    );
  return (
    <section aria-label="Sales workflow register" className="sales-register">
      {workflows.map((workflow) => (
        <article className="sales-register-row" key={workflow.id}>
          <div className="sales-register-identity">
            <span className="sales-document-mark">Q</span>
            <div>
              <strong>{workflow.number}</strong>
              <span>{workflow.customerName}</span>
            </div>
          </div>
          <div>
            <strong>{formatMoney(workflow.total, workflow.currencyCode)}</strong>
            <span>Valid until {formatDate(workflow.validUntil)}</span>
          </div>
          <WorkflowProgress status={workflow.status} />
          <Button onClick={() => onPreview(workflow)} variant="quiet">
            Preview
          </Button>
        </article>
      ))}
    </section>
  );
}

function WorkflowProgress({ status }: { status: SalesWorkflow['status'] }) {
  const current = ['draft', 'confirmed', 'shipped', 'invoiced'].indexOf(status);
  return (
    <div aria-label={`Current stage: ${statusLabel(status)}`} className="sales-progress">
      {['Quotation', 'Order', 'Shipment', 'Invoice'].map((label, index) => (
        <span className={index <= current ? 'is-complete' : ''} key={label} title={label} />
      ))}
      <small>{statusLabel(status)}</small>
    </div>
  );
}

interface QuotationLineDraft {
  discountPercent: string;
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  vatTreatment: VatTreatment;
}

function QuotationDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (workflow: SalesWorkflow) => void;
  references: SalesReferenceData;
  token: string;
}) {
  const [customerPartnerId, setCustomerPartnerId] = useState(references.customers[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(references.warehouses[0]?.id ?? '');
  const [validUntil, setValidUntil] = useState(futureDate(14));
  const [currencyCode, setCurrencyCode] = useState('BGN');
  const [overallDiscountPercent, setOverallDiscountPercent] = useState('0');
  const [lines, setLines] = useState<QuotationLineDraft[]>([quotationLine()]);
  const [busy, setBusy] = useState(false);
  const [priceBusyLineId, setPriceBusyLineId] = useState<string | null>(null);
  const [priceNotices, setPriceNotices] = useState<
    Record<string, { matched: boolean; text: string }>
  >({});
  const [error, setError] = useState<string | null>(null);

  async function applyCustomerPrice(line: QuotationLineDraft) {
    setPriceBusyLineId(line.id);
    setPriceNotices((current) => {
      const next = { ...current };
      delete next[line.id];
      return next;
    });
    try {
      const price = await resolveSalesPrice(token, {
        asOf: new Date().toISOString().slice(0, 10),
        currencyCode,
        customerPartnerId,
        productId: line.productId,
      });
      if (!price.matched || !price.unitPrice) {
        setPriceNotices((current) => ({
          ...current,
          [line.id]: {
            matched: false,
            text: `No active ${currencyCode} price list matches this customer and product.`,
          },
        }));
        return;
      }
      const appliedUnitPrice = price.unitPrice;
      updateLine(setLines, line.id, { unitPrice: appliedUnitPrice });
      setPriceNotices((current) => ({
        ...current,
        [line.id]: {
          matched: true,
          text: `${price.priceListName ?? 'Customer price'} applied · ${formatMoney(appliedUnitPrice, price.currencyCode)}`,
        },
      }));
    } catch (caught) {
      setPriceNotices((current) => ({
        ...current,
        [line.id]: {
          matched: false,
          text: errorText(caught, 'The customer price could not be checked.'),
        },
      }));
    } finally {
      setPriceBusyLineId(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateSalesQuotationRequest = {
      currencyCode,
      customerPartnerId,
      lines: lines.map(({ discountPercent, productId, quantity, unitPrice, vatTreatment }) => ({
        discountPercent,
        productId,
        quantity,
        unitPrice,
        vatTreatment,
      })),
      overallDiscountPercent,
      validUntil,
      warehouseId,
    };
    setBusy(true);
    setError(null);
    try {
      onSaved(await createSalesQuotation(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The quotation could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  const missingReferences =
    !references.customers.length || !references.products.length || !references.warehouses.length;
  return (
    <SalesDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Customer offer and commercial terms"
      title="New quotation"
    >
      <form className="sales-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {missingReferences ? (
          <InlineAlert tone="warning">
            Add an active customer, product, and warehouse before creating a quotation.
          </InlineAlert>
        ) : null}
        <section className="sales-form-section">
          <header>
            <span>1</span>
            <div>
              <h3>Customer and fulfilment</h3>
              <p>Select who is buying and where stock will be reserved.</p>
            </div>
          </header>
          <div className="sales-form-grid">
            <SalesField label="Customer">
              <select
                required
                value={customerPartnerId}
                onChange={(event) => {
                  setCustomerPartnerId(event.target.value);
                  setPriceNotices({});
                }}
              >
                {references.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </SalesField>
            <SalesField label="Warehouse">
              <select
                required
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                {references.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </SalesField>
            <SalesField label="Valid until">
              <input
                required
                type="date"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
              />
            </SalesField>
            <SalesField label="Currency">
              <input
                maxLength={3}
                required
                value={currencyCode}
                onChange={(event) => {
                  setCurrencyCode(event.target.value.toUpperCase());
                  setPriceNotices({});
                }}
              />
            </SalesField>
          </div>
        </section>
        <section className="sales-form-section">
          <header>
            <span>2</span>
            <div>
              <h3>Products and pricing</h3>
              <p>Add one line per product. Prices remain editable until confirmation.</p>
            </div>
          </header>
          <div className="sales-line-list">
            {lines.map((line, index) => (
              <article className="sales-line-editor" key={line.id}>
                <header>
                  <strong>Line {index + 1}</strong>
                  {lines.length > 1 ? (
                    <button
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() =>
                        setLines((current) => current.filter((item) => item.id !== line.id))
                      }
                      type="button"
                    >
                      <Icon name="close" size={15} />
                    </button>
                  ) : null}
                </header>
                <SalesField label="Product">
                  <select
                    required
                    value={line.productId}
                    onChange={(event) => {
                      updateLine(setLines, line.id, { productId: event.target.value });
                      setPriceNotices((current) => {
                        const next = { ...current };
                        delete next[line.id];
                        return next;
                      });
                    }}
                  >
                    <option value="">Choose product</option>
                    {references.products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · {product.productCode}
                      </option>
                    ))}
                  </select>
                </SalesField>
                <div className="sales-form-grid is-three">
                  <SalesField label="Quantity">
                    <input
                      inputMode="decimal"
                      pattern="\d+(\.\d{1,4})?"
                      required
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(setLines, line.id, { quantity: event.target.value })
                      }
                    />
                  </SalesField>
                  <SalesField label={`Unit price (${currencyCode})`}>
                    <input
                      inputMode="decimal"
                      pattern="\d+(\.\d{1,4})?"
                      required
                      value={line.unitPrice}
                      onChange={(event) =>
                        updateLine(setLines, line.id, { unitPrice: event.target.value })
                      }
                    />
                  </SalesField>
                  <SalesField label="Line discount %">
                    <input
                      inputMode="decimal"
                      pattern="\d+(\.\d{1,4})?"
                      required
                      value={line.discountPercent}
                      onChange={(event) =>
                        updateLine(setLines, line.id, { discountPercent: event.target.value })
                      }
                    />
                  </SalesField>
                </div>
                <SalesField label="VAT treatment">
                  <select
                    value={line.vatTreatment}
                    onChange={(event) =>
                      updateLine(setLines, line.id, {
                        vatTreatment: event.target.value as VatTreatment,
                      })
                    }
                  >
                    <option value="standard_20">20% VAT</option>
                    <option value="reduced_9">9% VAT</option>
                    <option value="zero">0% VAT</option>
                    <option value="exempt">Exempt</option>
                    <option value="ica">Intra-community acquisition</option>
                  </select>
                </SalesField>
                <div className="sales-price-assist">
                  <button
                    disabled={
                      priceBusyLineId === line.id ||
                      !customerPartnerId ||
                      !line.productId ||
                      !/^[A-Z]{3}$/u.test(currencyCode)
                    }
                    onClick={() => void applyCustomerPrice(line)}
                    type="button"
                  >
                    <Icon name="search" size={15} />
                    {priceBusyLineId === line.id ? 'Checking price' : 'Use customer price'}
                  </button>
                  {priceNotices[line.id] ? (
                    <small
                      aria-live="polite"
                      className={priceNotices[line.id]?.matched ? 'is-applied' : ''}
                    >
                      {priceNotices[line.id]?.text}
                    </small>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <Button
            onClick={() => setLines((current) => [...current, quotationLine()])}
            type="button"
            variant="secondary"
          >
            <Icon name="plus" size={15} /> Add product line
          </Button>
        </section>
        <section className="sales-form-section is-compact">
          <header>
            <span>3</span>
            <div>
              <h3>Overall discount</h3>
              <p>Applied after line-level discounts.</p>
            </div>
          </header>
          <SalesField label="Overall discount %">
            <input
              inputMode="decimal"
              pattern="\d+(\.\d{1,4})?"
              required
              value={overallDiscountPercent}
              onChange={(event) => setOverallDiscountPercent(event.target.value)}
            />
          </SalesField>
        </section>
        <div className="sales-drawer-actions">
          <Button disabled={busy} onClick={onBack} type="button" variant="quiet">
            Back
          </Button>
          <Button
            disabled={busy || missingReferences || lines.some((line) => !line.productId)}
            type="submit"
          >
            {busy ? 'Creating quotation' : 'Create quotation'}
          </Button>
        </div>
      </form>
    </SalesDrawer>
  );
}

function WorkflowDrawer({
  canCreate,
  canEdit,
  onBack,
  onSaved,
  references,
  token,
  workflow,
}: {
  canCreate: boolean;
  canEdit: boolean;
  onBack: () => void;
  onSaved: (workflow: SalesWorkflow, message: string) => void;
  references: SalesReferenceData;
  token: string;
  workflow: SalesWorkflow;
}) {
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [serialSearches, setSerialSearches] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedByName, setAcceptedByName] = useState('');
  const [acceptanceNotes, setAcceptanceNotes] = useState('');
  const [customerLocationId, setCustomerLocationId] = useState('');
  const serialLines = workflow.lines.filter((line) => line.trackingMode === 'serial');
  const serialSelectionComplete = serialLines.every(
    (line) => (serials[line.id]?.length ?? 0) === Number(line.quantity),
  );

  function toggleSerial(lineId: string, serialNumber: string, requiredCount: number) {
    setSerials((current) => {
      const selected = current[lineId] ?? [];
      if (selected.includes(serialNumber))
        return {
          ...current,
          [lineId]: selected.filter((item) => item !== serialNumber),
        };
      if (selected.length >= requiredCount) return current;
      return { ...current, [lineId]: [...selected, serialNumber] };
    });
  }

  async function act(action: () => Promise<SalesWorkflow>, message: string) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await action(), message);
    } catch (caught) {
      setError(errorText(caught, 'The sales workflow could not be updated.'));
    } finally {
      setBusy(false);
    }
  }
  const confirm = () =>
    act(
      () =>
        confirmSalesQuotation(token, workflow.id, crypto.randomUUID(), {
          lines: workflow.lines.map((line) => ({
            quotationLineId: line.id,
            ...(line.trackingMode === 'serial' ? { serialNumbers: serials[line.id] ?? [] } : {}),
          })),
        }),
      'Quotation confirmed and stock reserved.',
    );
  const ship = () =>
    workflow.order &&
    act(
      () =>
        createSalesShipment(token, workflow.order!.id, crypto.randomUUID(), {
          lines: workflow.order!.lines.map((line) => ({
            orderLineId: line.id,
            ...(line.trackingMode === 'batch' ? { batchNumber: batches[line.id] ?? '' } : {}),
          })),
        }),
      'Shipment completed and reserved stock issued.',
    );
  const invoice = () =>
    workflow.order &&
    act(
      () => createSalesInvoiceDraft(token, workflow.order!.id, crypto.randomUUID()),
      'Invoice draft prepared from the shipment.',
    );
  const acceptHandover = () =>
    workflow.handover &&
    act(
      () =>
        acceptSalesHandover(token, workflow.handover!.id, crypto.randomUUID(), {
          acceptedByName,
          ...(acceptanceNotes.trim() ? { acceptanceNotes } : {}),
          customerLocationId,
          expectedVersion: workflow.handover!.version,
        }),
      'Customer acceptance recorded on the handover certificate.',
    );

  return (
    <SalesDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${workflow.customerName} · ${formatMoney(workflow.total, workflow.currencyCode)}`}
      title={workflow.number}
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <WorkflowTimeline workflow={workflow} />
      <section className="sales-preview-section">
        <header>
          <div>
            <h3>Quotation</h3>
            <p>
              Valid until {formatDate(workflow.validUntil)} · {workflow.warehouseName}
            </p>
          </div>
          <span>{statusLabel(workflow.status)}</span>
        </header>
        <div className="sales-preview-lines">
          {workflow.lines.map((line) => (
            <div key={line.id}>
              <div>
                <strong>{line.productName}</strong>
                <span>
                  {line.quantity} × {formatMoney(line.unitPrice, workflow.currencyCode)}
                </span>
              </div>
              <strong>{formatMoney(line.lineTotal, workflow.currencyCode)}</strong>
            </div>
          ))}
        </div>
        <dl className="sales-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatMoney(workflow.subtotal, workflow.currencyCode)}</dd>
          </div>
          <div>
            <dt>VAT</dt>
            <dd>{formatMoney(workflow.vatTotal, workflow.currencyCode)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatMoney(workflow.total, workflow.currencyCode)}</dd>
          </div>
        </dl>
      </section>
      {workflow.status === 'draft' && canCreate ? (
        <section className="sales-next-action sales-confirm-order">
          <header>
            <div>
              <h3>Confirm order</h3>
              <p>
                Confirmation reserves stock. Serialised items require an exact serial selection.
              </p>
            </div>
          </header>
          {workflow.lines
            .filter((line) => line.trackingMode === 'serial')
            .map((line) => {
              const availableSerials = references.serials
                .filter(
                  (item) =>
                    item.productId === line.productId && item.warehouseId === workflow.warehouseId,
                )
                .map((item) => item.serialNumber);
              return (
                <SerialNumberPicker
                  availableSerials={availableSerials}
                  busy={busy}
                  key={line.id}
                  lineId={line.id}
                  onSearchChange={(value) =>
                    setSerialSearches((current) => ({ ...current, [line.id]: value }))
                  }
                  onToggle={(serialNumber) =>
                    toggleSerial(line.id, serialNumber, Number(line.quantity))
                  }
                  productName={line.productName}
                  requiredCount={Number(line.quantity)}
                  searchQuery={serialSearches[line.id] ?? ''}
                  selected={serials[line.id] ?? []}
                  warehouseName={workflow.warehouseName}
                />
              );
            })}
          <Button disabled={busy || !serialSelectionComplete} onClick={() => void confirm()}>
            Confirm order and reserve stock
          </Button>
        </section>
      ) : null}
      {workflow.status === 'confirmed' && workflow.order && canCreate ? (
        <section className="sales-next-action">
          <header>
            <div>
              <h3>Create shipment</h3>
              <p>Shipping consumes the order reservations and deducts stock.</p>
            </div>
          </header>
          {workflow.order.lines
            .filter((line) => line.trackingMode === 'batch')
            .map((line) => (
              <SalesField key={line.id} label={`${line.productName} batch`}>
                <select
                  value={batches[line.id] ?? ''}
                  onChange={(event) =>
                    setBatches((current) => ({ ...current, [line.id]: event.target.value }))
                  }
                >
                  <option value="">Choose batch</option>
                  {references.batches
                    .filter(
                      (item) =>
                        item.productId === line.productId &&
                        item.warehouseId === workflow.warehouseId,
                    )
                    .map((item) => (
                      <option key={item.batchNumber} value={item.batchNumber}>
                        {item.batchNumber} · {item.quantity} available
                      </option>
                    ))}
                </select>
              </SalesField>
            ))}
          <Button disabled={busy} onClick={() => void ship()}>
            Complete shipment
          </Button>
        </section>
      ) : null}
      {workflow.status === 'shipped' && workflow.order && canCreate ? (
        <section className="sales-next-action">
          <header>
            <div>
              <h3>Prepare invoice</h3>
              <p>
                Prepare the invoice draft from the completed shipment. Final review and issuance
                remain in Finance.
              </p>
            </div>
          </header>
          <Button disabled={busy} onClick={() => void invoice()}>
            Prepare invoice draft
          </Button>
        </section>
      ) : null}
      {workflow.handover ? (
        <section className="sales-preview-section sales-handover-card">
          <header>
            <div>
              <h3>{workflow.handover.number}</h3>
              <p>Equipment handover certificate</p>
            </div>
            <span>
              {workflow.handover.status === 'accepted' ? 'Accepted' : 'Awaiting acceptance'}
            </span>
          </header>
          <div className="sales-preview-lines">
            {workflow.handover.lines.map((line) => (
              <div key={line.id}>
                <div>
                  <strong>{line.productName}</strong>
                  <span>
                    Quantity {line.quantity}
                    {line.serialNumbers.length ? ` · Serial ${line.serialNumbers.join(', ')}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {workflow.handover.status === 'accepted' ? (
            <div className="sales-handover-accepted">
              <Icon name="check" size={16} />
              <div>
                <strong>Accepted by {workflow.handover.acceptedByName}</strong>
                <span>
                  {workflow.handover.acceptedAt ? formatDateTime(workflow.handover.acceptedAt) : ''}
                </span>
                {workflow.handover.customerLocationName ? (
                  <p>Received at {workflow.handover.customerLocationName}</p>
                ) : null}
                {workflow.handover.acceptanceNotes ? (
                  <p>{workflow.handover.acceptanceNotes}</p>
                ) : null}
              </div>
            </div>
          ) : canEdit ? (
            <div className="sales-handover-form">
              <SalesField label="Receiving location">
                <select
                  onChange={(event) => setCustomerLocationId(event.target.value)}
                  value={customerLocationId}
                >
                  <option value="">Choose customer location</option>
                  {references.customerLocations
                    .filter((location) => location.customerPartnerId === workflow.customerPartnerId)
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                </select>
                <small>Sold serial numbers will be registered to this location.</small>
              </SalesField>
              <SalesField label="Customer representative">
                <input
                  maxLength={255}
                  onChange={(event) => setAcceptedByName(event.target.value)}
                  placeholder="Full name"
                  value={acceptedByName}
                />
              </SalesField>
              <SalesField label="Acceptance note (optional)">
                <textarea
                  maxLength={2000}
                  onChange={(event) => setAcceptanceNotes(event.target.value)}
                  rows={3}
                  value={acceptanceNotes}
                />
              </SalesField>
              <Button
                disabled={busy || !acceptedByName.trim() || !customerLocationId}
                onClick={() => void acceptHandover()}
              >
                Record customer acceptance
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {workflow.invoice ? (
        <section className="sales-preview-section">
          <header>
            <div>
              <h3>{workflow.invoice.number}</h3>
              <p>Draft prepared {formatDateTime(workflow.invoice.recordedAt)}</p>
            </div>
            <span>Invoice draft</span>
          </header>
          <p className="sales-boundary-note">Ready for final review and issuance in Finance.</p>
        </section>
      ) : null}
    </SalesDrawer>
  );
}

function WorkflowTimeline({ workflow }: { workflow: SalesWorkflow }) {
  const items = [
    ['Quotation', workflow.number, workflow.createdAt, true],
    [
      'Confirmed order',
      workflow.order?.number,
      workflow.order?.confirmedAt,
      Boolean(workflow.order),
    ],
    [
      'Shipment',
      workflow.shipment?.number,
      workflow.shipment?.shippedAt,
      Boolean(workflow.shipment),
    ],
    [
      'Handover',
      workflow.handover?.number,
      workflow.handover?.acceptedAt ?? workflow.handover?.preparedAt,
      Boolean(workflow.handover),
    ],
    [
      'Invoice draft',
      workflow.invoice?.number,
      workflow.invoice?.recordedAt,
      Boolean(workflow.invoice),
    ],
  ] as const;
  return (
    <ol className="sales-timeline">
      {items.map(([label, number, date, complete]) => (
        <li className={complete ? 'is-complete' : ''} key={label}>
          <span>{complete ? <Icon name="check" size={14} /> : null}</span>
          <div>
            <strong>{label}</strong>
            <p>{number ?? 'Pending'}</p>
            {date ? <small>{formatDateTime(date)}</small> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function SalesDrawer({
  busy,
  children,
  onBack,
  subtitle,
  title,
}: {
  busy: boolean;
  children: React.ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label="Back to sales list"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide sales-drawer"
        role="dialog"
      >
        <header className="sales-drawer-header">
          <button
            aria-label="Back to sales list"
            className="sales-back-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="arrow" size={17} /> Back
          </button>
          <button
            aria-label="Close preview"
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

function SalesField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="sales-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function SerialNumberPicker({
  availableSerials,
  busy,
  lineId,
  onSearchChange,
  onToggle,
  productName,
  requiredCount,
  searchQuery,
  selected,
  warehouseName,
}: {
  availableSerials: string[];
  busy: boolean;
  lineId: string;
  onSearchChange: (value: string) => void;
  onToggle: (serialNumber: string) => void;
  productName: string;
  requiredCount: number;
  searchQuery: string;
  selected: string[];
  warehouseName: string;
}) {
  const query = searchQuery.trim().toLocaleLowerCase();
  const visibleSerials = availableSerials.filter((serialNumber) =>
    serialNumber.toLocaleLowerCase().includes(query),
  );
  const selectionComplete = selected.length === requiredCount;
  const remaining = Math.max(0, requiredCount - selected.length);
  const statusId = `sales-serial-status-${lineId}`;

  return (
    <fieldset aria-describedby={statusId} className="sales-serial-picker">
      <legend className="sr-only">{productName} serial numbers</legend>
      <header className="sales-serial-picker-header">
        <div>
          <strong>{productName}</strong>
          <span>
            Choose {requiredCount} {requiredCount === 1 ? 'device' : 'devices'} from {warehouseName}
            .
          </span>
        </div>
        <span className={`sales-serial-count ${selectionComplete ? 'is-complete' : ''}`}>
          {selectionComplete ? <Icon name="check" size={13} /> : null}
          {selected.length} of {requiredCount} selected
        </span>
      </header>

      <label className="sales-serial-search">
        <span className="sr-only">Search {productName} serial numbers</span>
        <Icon name="search" size={16} />
        <input
          autoComplete="off"
          disabled={busy || availableSerials.length === 0}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by serial number"
          type="search"
          value={searchQuery}
        />
      </label>

      {visibleSerials.length ? (
        <div
          aria-label={`Available ${productName} serial numbers`}
          className="sales-serial-options"
        >
          {visibleSerials.map((serialNumber) => {
            const isSelected = selected.includes(serialNumber);
            const unavailableUntilChanged = selectionComplete && !isSelected;
            return (
              <button
                aria-label={serialNumber}
                aria-pressed={isSelected}
                className={isSelected ? 'is-selected' : undefined}
                disabled={busy || unavailableUntilChanged}
                key={serialNumber}
                onClick={() => onToggle(serialNumber)}
                type="button"
              >
                <span className="sales-serial-check" aria-hidden="true">
                  {isSelected ? <Icon name="check" size={13} /> : null}
                </span>
                <span className="sales-serial-number">{serialNumber}</span>
                <small>{isSelected ? 'Selected' : 'Available'}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="sales-serial-empty">
          <Icon name="search" size={18} />
          <p>
            {availableSerials.length
              ? `No serial numbers match “${searchQuery.trim()}”.`
              : `No serialised stock is available in ${warehouseName}.`}
          </p>
        </div>
      )}

      <p
        className={`sales-serial-status ${selectionComplete ? 'is-complete' : ''}`}
        id={statusId}
        aria-live="polite"
      >
        {selectionComplete ? (
          <>
            <Icon name="check" size={14} /> Selection complete. Deselect a device to choose another.
          </>
        ) : (
          `Choose ${remaining} more ${remaining === 1 ? 'serial number' : 'serial numbers'} to continue.`
        )}
      </p>
    </fieldset>
  );
}
function SalesState({ children, title }: { children?: React.ReactNode; title: string }) {
  return (
    <section className="procurement-state">
      <Icon name="sales" size={24} />
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function useSalesData(token: string) {
  const [workflows, setWorkflows] = useState<SalesWorkflow[]>([]);
  const [references, setReferences] = useState<SalesReferenceData>({
    batches: [],
    customers: [],
    customerLocations: [],
    products: [],
    serials: [],
    warehouses: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([listSalesWorkflows(token), getSalesReferenceData(token)])
      .then(([items, options]) => {
        if (active) {
          setWorkflows(items);
          setReferences(options);
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
  return { error, loading, references, reload, workflows };
}

function quotationLine(): QuotationLineDraft {
  return {
    discountPercent: '0',
    id: crypto.randomUUID(),
    productId: '',
    quantity: '1',
    unitPrice: '0',
    vatTreatment: 'standard_20',
  };
}
function updateLine(
  setLines: React.Dispatch<React.SetStateAction<QuotationLineDraft[]>>,
  id: string,
  patch: Partial<QuotationLineDraft>,
) {
  setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
}
function statusLabel(status: SalesWorkflow['status']) {
  return {
    draft: 'Quotation',
    confirmed: 'Confirmed order',
    shipped: 'Shipped',
    invoiced: 'Invoice draft',
  }[status];
}
function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
function formatMoney(value: string, currency: string) {
  return new Intl.NumberFormat('en-GB', { currency, style: 'currency' }).format(Number(value));
}
function errorText(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? (error.details[0]?.message ?? error.message) : fallback;
}
