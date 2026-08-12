import { Button, InlineAlert } from '@vista/ui';
import { useActiveItemVisibility } from '@vista/ui/navigation';
import type {
  CreateSupplierClaimRequest,
  CreateSupplierInvoiceRequest,
  ProcurementSupplierRecord,
  PurchaseOrder,
  SupplierClaim,
  SupplierClaimStatus,
  SupplierInvoice,
} from '@vista/contracts';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createSupplierClaim,
  createSupplierEvaluation,
  createSupplierInvoice,
  listProcurementSuppliers,
  listPurchaseOrders,
  listSupplierClaims,
  listSupplierInvoices,
  updateSupplierClaimStatus,
  updateSupplierCommercialProfile,
} from '../api/procurement';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';

export type SupplierProcurementView = 'supplier-claims' | 'supplier-invoices' | 'suppliers';

export function SupplierProcurementPage({ view }: { view: SupplierProcurementView }) {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useSupplierProcurementData(token);
  const [supplierPreview, setSupplierPreview] = useState<ProcurementSupplierRecord | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<SupplierInvoice | null>(null);
  const [claimPreview, setClaimPreview] = useState<SupplierClaim | null>(null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [creatingClaim, setCreatingClaim] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canCreate = hasPermission('erp.procurement', 'create');
  const canEdit = hasPermission('erp.procurement', 'edit');

  if (data.loading) return <ProcurementLoading />;
  if (data.error)
    return (
      <EmptyState title="Procurement records could not be loaded">
        <Button onClick={data.reload} variant="secondary">
          Try again
        </Button>
      </EmptyState>
    );

  return (
    <div className="page-stack procurement-page">
      <header className="page-header procurement-header">
        <div>
          <p className="page-eyebrow">ERP · Procurement</p>
          <h1>{viewTitle(view)}</h1>
          <p>{viewDescription(view)}</p>
        </div>
        {view === 'supplier-invoices' && canCreate ? (
          <Button onClick={() => setCreatingInvoice(true)}>
            <Icon name="plus" size={17} /> Record supplier invoice
          </Button>
        ) : null}
        {view === 'supplier-claims' && canCreate ? (
          <Button onClick={() => setCreatingClaim(true)}>
            <Icon name="plus" size={17} /> New supplier claim
          </Button>
        ) : null}
      </header>

      <ProcurementWorkspace
        countLabel={`${viewRecordCount(view, data)} ${viewRecordLabel(view, data)}`}
        description={viewRegisterDescription(view)}
        notice={notice}
        title={viewRegisterTitle(view)}
        view={view}
      >
        {view === 'suppliers' ? (
          <SupplierList suppliers={data.suppliers} onPreview={setSupplierPreview} />
        ) : view === 'supplier-invoices' ? (
          <InvoiceList
            invoices={data.invoices}
            onPreview={setInvoicePreview}
            orders={data.orders}
          />
        ) : (
          <ClaimList claims={data.claims} onPreview={setClaimPreview} />
        )}
      </ProcurementWorkspace>

      {supplierPreview ? (
        <SupplierPreviewDrawer
          canEdit={canEdit}
          onBack={() => setSupplierPreview(null)}
          onSaved={() => {
            setSupplierPreview(null);
            setNotice('Supplier record updated.');
            data.reload();
          }}
          supplier={supplierPreview}
          token={token}
        />
      ) : null}
      {invoicePreview ? (
        <InvoicePreviewDrawer
          invoice={invoicePreview}
          onBack={() => setInvoicePreview(null)}
          {...(data.orders.find((order) => order.id === invoicePreview.purchaseOrderId)
            ? {
                order: data.orders.find(
                  (order) => order.id === invoicePreview.purchaseOrderId,
                ) as PurchaseOrder,
              }
            : {})}
        />
      ) : null}
      {claimPreview ? (
        <ClaimPreviewDrawer
          canEdit={canEdit}
          claim={claimPreview}
          onBack={() => setClaimPreview(null)}
          onSaved={() => {
            setClaimPreview(null);
            setNotice('Claim status updated.');
            data.reload();
          }}
          token={token}
        />
      ) : null}
      {creatingInvoice ? (
        <SupplierInvoiceDrawer
          onBack={() => setCreatingInvoice(false)}
          onSaved={() => {
            setCreatingInvoice(false);
            setNotice('Supplier invoice recorded and comparison updated.');
            data.reload();
          }}
          orders={data.orders}
          token={token}
        />
      ) : null}
      {creatingClaim ? (
        <SupplierClaimDrawer
          onBack={() => setCreatingClaim(false)}
          onSaved={() => {
            setCreatingClaim(false);
            setNotice('Supplier claim opened.');
            data.reload();
          }}
          orders={data.orders}
          token={token}
        />
      ) : null}
    </div>
  );
}

export type ProcurementTabView = SupplierProcurementView | 'goods-receipts' | 'purchase-orders';

export function ProcurementWorkspace({
  children,
  countLabel,
  description,
  notice,
  title,
  view,
}: {
  children: React.ReactNode;
  countLabel: string;
  description: string;
  notice?: string | null;
  title: string;
  view: ProcurementTabView;
}) {
  return (
    <div className="procurement-tab-shell">
      <ProcurementTabs view={view} />
      <section aria-label={`${viewTitle(view)} workspace`} className="procurement-tab-surface">
        <header className="procurement-tab-summary">
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <span>{countLabel}</span>
        </header>
        {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
        <div className="procurement-tab-body">{children}</div>
      </section>
    </div>
  );
}

export function ProcurementTabs({ view }: { view: ProcurementTabView }) {
  const tabList = useActiveItemVisibility<HTMLElement>(view);
  const tabs: Array<[typeof view, string, string]> = [
    ['purchase-orders', 'Purchase orders', '/modules/erp.procurement/purchase-orders'],
    ['goods-receipts', 'Goods receipts', '/modules/erp.procurement/goods-receipts'],
    ['suppliers', 'Suppliers', '/modules/erp.procurement/suppliers'],
    ['supplier-invoices', 'Supplier invoices', '/modules/erp.procurement/supplier-invoices'],
    ['supplier-claims', 'Supplier claims', '/modules/erp.procurement/supplier-claims'],
  ];
  return (
    <nav aria-label="Procurement workflow" className="workflow-tabs procurement-tabs" ref={tabList}>
      {tabs.map(([key, label, path]) => (
        <Link aria-current={view === key ? 'page' : undefined} key={key} to={path}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

function SupplierList({
  onPreview,
  suppliers,
}: {
  onPreview: (supplier: ProcurementSupplierRecord) => void;
  suppliers: ProcurementSupplierRecord[];
}) {
  if (!suppliers.length)
    return (
      <EmptyState title="No suppliers available">
        <p>Add a partner with the supplier role before configuring procurement terms.</p>
      </EmptyState>
    );
  return (
    <section aria-label="Supplier register" className="procurement-record-grid">
      {suppliers.map((supplier) => {
        const latest = supplier.evaluations[0];
        return (
          <article
            className="procurement-record-card supplier-register-card"
            key={supplier.profile.supplierPartnerId}
          >
            <header>
              <span aria-hidden="true" className="procurement-record-icon">
                {contactInitials(supplier.profile.supplierName)}
              </span>
              <div>
                <h2>{supplier.profile.supplierName}</h2>
                <p>{supplier.contacts.length} active contacts</p>
              </div>
              {latest ? <span className="supplier-score">{latest.score}/5</span> : null}
            </header>
            <dl className="procurement-record-facts">
              <div>
                <dt>Payment terms</dt>
                <dd>
                  {supplier.profile.paymentTermsDays === undefined
                    ? 'Not set'
                    : `${supplier.profile.paymentTermsDays} days`}
                </dd>
              </div>
              <div>
                <dt>Delivery terms</dt>
                <dd>{supplier.profile.deliveryTerms ?? 'Not set'}</dd>
              </div>
              <div>
                <dt>Evaluations</dt>
                <dd>{supplier.evaluations.length}</dd>
              </div>
            </dl>
            <footer>
              <Button onClick={() => onPreview(supplier)} variant="secondary">
                Preview supplier
              </Button>
            </footer>
          </article>
        );
      })}
    </section>
  );
}

function InvoiceList({
  invoices,
  onPreview,
  orders,
}: {
  invoices: SupplierInvoice[];
  onPreview: (invoice: SupplierInvoice) => void;
  orders: PurchaseOrder[];
}) {
  if (!invoices.length)
    return (
      <EmptyState title="No supplier invoices recorded">
        <p>Record an invoice against a purchase order to begin three-way comparison.</p>
      </EmptyState>
    );
  return (
    <section aria-label="Supplier invoices" className="procurement-record-list">
      <header aria-hidden="true" className="procurement-ledger-head">
        <span>Invoice and supplier</span>
        <span>Total and date</span>
        <span>Comparison</span>
        <span>Action</span>
      </header>
      {invoices.map((invoice) => {
        const order = orders.find((item) => item.id === invoice.purchaseOrderId);
        const matchState = !order
          ? 'unavailable'
          : order.lines.some((line) => line.invoicedQuantity !== line.deliveredQuantity)
            ? 'variance'
            : 'matched';
        return (
          <article className="procurement-ledger-row is-invoice" key={invoice.id}>
            <div className="procurement-ledger-primary">
              <strong>{invoice.invoiceNumber}</strong>
              <span>{invoice.supplierName}</span>
            </div>
            <div className="procurement-ledger-value">
              <strong>{formatMoney(invoice.total, invoice.currencyCode)}</strong>
              <span>{formatDate(invoice.invoiceDate)}</span>
            </div>
            <span className={`procurement-match is-${matchState}`}>
              {matchState === 'variance'
                ? 'Review variance'
                : matchState === 'matched'
                  ? 'Matched'
                  : 'Not compared'}
            </span>
            <Button onClick={() => onPreview(invoice)} variant="secondary">
              Preview
            </Button>
          </article>
        );
      })}
    </section>
  );
}

function ClaimList({
  claims,
  onPreview,
}: {
  claims: SupplierClaim[];
  onPreview: (claim: SupplierClaim) => void;
}) {
  if (!claims.length)
    return (
      <EmptyState title="No supplier claims">
        <p>Damaged or non-conforming deliveries will be tracked here.</p>
      </EmptyState>
    );
  return (
    <section aria-label="Supplier claims" className="procurement-record-list">
      <header aria-hidden="true" className="procurement-ledger-head">
        <span>Product and supplier</span>
        <span>Quantity and issue</span>
        <span>Status</span>
        <span>Action</span>
      </header>
      {claims.map((claim) => (
        <article className="procurement-ledger-row is-claim" key={claim.id}>
          <div className="procurement-ledger-primary">
            <strong>{claim.productName}</strong>
            <span>{claim.supplierName}</span>
          </div>
          <div className="procurement-ledger-value">
            <strong>{claim.quantity}</strong>
            <span>{claim.type === 'damaged' ? 'Damaged' : 'Non-conforming'}</span>
          </div>
          <span className={`procurement-status is-${claim.status}`}>
            {claimStatusLabel(claim.status)}
          </span>
          <Button onClick={() => onPreview(claim)} variant="secondary">
            Preview
          </Button>
        </article>
      ))}
    </section>
  );
}

function SupplierPreviewDrawer({
  canEdit,
  onBack,
  onSaved,
  supplier,
  token,
}: {
  canEdit: boolean;
  onBack: () => void;
  onSaved: () => void;
  supplier: ProcurementSupplierRecord;
  token: string;
}) {
  const [paymentTermsDays, setPaymentTermsDays] = useState(
    supplier.profile.paymentTermsDays?.toString() ?? '',
  );
  const [deliveryTerms, setDeliveryTerms] = useState(supplier.profile.deliveryTerms ?? '');
  const [score, setScore] = useState('');
  const [notes, setNotes] = useState('');
  const [addingEvaluation, setAddingEvaluation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveTerms() {
    setBusy(true);
    setError(null);
    try {
      await updateSupplierCommercialProfile(
        token,
        supplier.profile.supplierPartnerId,
        crypto.randomUUID(),
        {
          ...(deliveryTerms.trim() ? { deliveryTerms: deliveryTerms.trim() } : {}),
          expectedVersion: supplier.profile.version,
          ...(paymentTermsDays ? { paymentTermsDays: Number(paymentTermsDays) } : {}),
        },
      );
      onSaved();
    } catch (caught) {
      setError(errorText(caught, 'Supplier terms could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function addEvaluation() {
    if (!score) return;
    setBusy(true);
    setError(null);
    try {
      await createSupplierEvaluation(
        token,
        supplier.profile.supplierPartnerId,
        crypto.randomUUID(),
        { ...(notes.trim() ? { notes: notes.trim() } : {}), score: Number(score) },
      );
      onSaved();
    } catch (caught) {
      setError(errorText(caught, 'The evaluation could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RecordDrawer
      busy={busy}
      className="supplier-record-drawer"
      onBack={onBack}
      subtitle="Terms, contacts, and evaluation history"
      title={supplier.profile.supplierName}
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <section className="procurement-preview-section supplier-terms-section">
        <header className="procurement-section-heading">
          <div>
            <h3>Commercial terms</h3>
            <p>Defaults used when preparing new purchase documents.</p>
          </div>
        </header>
        <form
          className="supplier-terms-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveTerms();
          }}
        >
          <div className="supplier-terms-fields">
            <label className="procurement-field">
              <span>Payment terms</span>
              <div className="supplier-number-field">
                <input
                  aria-label="Payment terms in days"
                  disabled={!canEdit}
                  max={3650}
                  min={0}
                  onChange={(event) => setPaymentTermsDays(event.target.value)}
                  type="number"
                  value={paymentTermsDays}
                />
                <span>days</span>
              </div>
            </label>
            <label className="procurement-field supplier-delivery-field">
              <span>Delivery terms</span>
              <input
                disabled={!canEdit}
                maxLength={500}
                onChange={(event) => setDeliveryTerms(event.target.value)}
                value={deliveryTerms}
              />
            </label>
          </div>
          {canEdit ? (
            <footer className="supplier-form-actions">
              <Button busy={busy} busyLabel="Saving" type="submit" variant="secondary">
                Save terms
              </Button>
            </footer>
          ) : null}
        </form>
      </section>
      <section className="procurement-preview-section">
        <header className="procurement-section-heading">
          <div>
            <h3>Contacts</h3>
            <p>Active contacts from the shared partner record.</p>
          </div>
          <span>{supplier.contacts.length}</span>
        </header>
        {supplier.contacts.length ? (
          supplier.contacts.map((contact) => (
            <div
              className="supplier-contact-row"
              key={`${contact.name}-${contact.email ?? contact.telephone ?? ''}`}
            >
              <span aria-hidden="true" className="supplier-contact-avatar">
                {contactInitials(contact.name)}
              </span>
              <div>
                <strong>{contact.name}</strong>
                <span>{contact.role ?? 'Contact'}</span>
              </div>
              <span className="supplier-contact-detail">
                {contact.email ?? contact.telephone ?? 'No contact detail'}
              </span>
            </div>
          ))
        ) : (
          <p className="muted-copy">No active contacts are registered for this supplier.</p>
        )}
      </section>
      <section className="procurement-preview-section supplier-evaluation-section">
        <header className="procurement-section-heading">
          <div>
            <h3>Evaluation history</h3>
            <p>Previous assessments remain visible for comparison.</p>
          </div>
          {canEdit && !addingEvaluation ? (
            <Button
              className="supplier-add-evaluation"
              onClick={() => setAddingEvaluation(true)}
              variant="secondary"
            >
              <Icon name="plus" size={15} /> Add evaluation
            </Button>
          ) : null}
        </header>
        {supplier.evaluations.length ? (
          <div className="supplier-evaluation-list">
            {supplier.evaluations.map((evaluation) => (
              <div className="supplier-evaluation-row" key={evaluation.id}>
                <strong>{evaluation.score}/5</strong>
                <div className="supplier-evaluation-copy">
                  <span>{evaluation.notes ?? 'No notes'}</span>
                  <small>{formatDateTime(evaluation.evaluatedAt)}</small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="procurement-quiet-state">No evaluations have been recorded.</p>
        )}
        {canEdit && addingEvaluation ? (
          <form
            className="supplier-evaluation-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addEvaluation();
            }}
          >
            <div className="supplier-evaluation-form-heading">
              <strong>New supplier evaluation</strong>
              <span>Score the overall supplier relationship.</span>
            </div>
            <div className="supplier-evaluation-fields">
              <label className="procurement-field">
                <span>Overall score</span>
                <select onChange={(event) => setScore(event.target.value)} value={score}>
                  <option value="">Choose score</option>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value} / 5
                    </option>
                  ))}
                </select>
              </label>
              <label className="procurement-field">
                <span>Evaluation notes</span>
                <textarea
                  maxLength={1000}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  value={notes}
                />
              </label>
            </div>
            <footer className="supplier-form-actions">
              <Button
                disabled={busy}
                onClick={() => {
                  setAddingEvaluation(false);
                  setScore('');
                  setNotes('');
                }}
                variant="quiet"
              >
                Cancel
              </Button>
              <Button busy={busy} disabled={!score} type="submit">
                Record evaluation
              </Button>
            </footer>
          </form>
        ) : null}
      </section>
    </RecordDrawer>
  );
}

interface InvoiceLineDraft {
  include: boolean;
  orderLineId: string;
  quantity: string;
  unitPrice: string;
}

function SupplierInvoiceDrawer({
  onBack,
  onSaved,
  orders,
  token,
}: {
  onBack: () => void;
  onSaved: () => void;
  orders: PurchaseOrder[];
  token: string;
}) {
  const [purchaseOrderId, setPurchaseOrderId] = useState(orders[0]?.id ?? '');
  const order = orders.find((item) => item.id === purchaseOrderId);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [lines, setLines] = useState<InvoiceLineDraft[]>(() => invoiceDrafts(orders[0]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectOrder(id: string) {
    setPurchaseOrderId(id);
    setLines(invoiceDrafts(orders.find((item) => item.id === id)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const included = lines.filter((line) => line.include);
    if (!order || !included.length) {
      setError('Choose a purchase order and at least one invoice line.');
      return;
    }
    const input: CreateSupplierInvoiceRequest = {
      invoiceDate,
      invoiceNumber: invoiceNumber.trim(),
      lines: included.map(({ orderLineId, quantity, unitPrice }) => ({
        orderLineId,
        quantity,
        unitPrice,
      })),
      purchaseOrderId: order.id,
    };
    setBusy(true);
    setError(null);
    try {
      await createSupplierInvoice(token, crypto.randomUUID(), input);
      onSaved();
    } catch (caught) {
      setError(errorText(caught, 'The supplier invoice could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RecordDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Link the supplier invoice to ordered and delivered quantities"
      title="Record supplier invoice"
    >
      <form className="procurement-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {!orders.length ? (
          <InlineAlert tone="warning">
            Create a purchase order before recording an invoice.
          </InlineAlert>
        ) : null}
        <label className="procurement-field">
          <span>Purchase order</span>
          <select
            onChange={(event) => selectOrder(event.target.value)}
            required
            value={purchaseOrderId}
          >
            {orders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.supplierName} · {shortIdentity(item.id)}
              </option>
            ))}
          </select>
        </label>
        <div className="procurement-form-grid">
          <label className="procurement-field">
            <span>Supplier invoice number</span>
            <input
              maxLength={120}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              required
              value={invoiceNumber}
            />
          </label>
          <label className="procurement-field">
            <span>Invoice date</span>
            <input
              onChange={(event) => setInvoiceDate(event.target.value)}
              required
              type="date"
              value={invoiceDate}
            />
          </label>
        </div>
        <section className="procurement-invoice-lines">
          <header>
            <strong>Invoice lines</strong>
            <span>Compare before recording</span>
          </header>
          {order?.lines.map((line) => {
            const draft = lines.find((item) => item.orderLineId === line.id);
            if (!draft) return null;
            return (
              <fieldset key={line.id}>
                <legend>
                  <label className="procurement-check-label">
                    <input
                      checked={draft.include}
                      onChange={(event) =>
                        updateInvoiceDraft(setLines, line.id, { include: event.target.checked })
                      }
                      type="checkbox"
                    />{' '}
                    {line.productName}
                  </label>
                </legend>
                <div className="procurement-comparison-strip">
                  <span>
                    Ordered <strong>{line.orderedQuantity}</strong>
                  </span>
                  <span>
                    Delivered <strong>{line.deliveredQuantity}</strong>
                  </span>
                  <span>
                    Already invoiced <strong>{line.invoicedQuantity}</strong>
                  </span>
                </div>
                <div className="procurement-form-grid">
                  <label className="procurement-field">
                    <span>Invoice quantity</span>
                    <input
                      disabled={!draft.include}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateInvoiceDraft(setLines, line.id, { quantity: event.target.value })
                      }
                      pattern="\d+(\.\d{1,4})?"
                      required={draft.include}
                      value={draft.quantity}
                    />
                  </label>
                  <label className="procurement-field">
                    <span>Unit price ({order.currencyCode})</span>
                    <input
                      disabled={!draft.include}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateInvoiceDraft(setLines, line.id, { unitPrice: event.target.value })
                      }
                      pattern="\d+(\.\d{1,4})?"
                      required={draft.include}
                      value={draft.unitPrice}
                    />
                  </label>
                </div>
              </fieldset>
            );
          })}
        </section>
        <div className="security-drawer-actions">
          <Button disabled={busy} onClick={onBack} type="button" variant="quiet">
            Back
          </Button>
          <Button disabled={busy || !orders.length} type="submit">
            {busy ? 'Recording invoice' : 'Record invoice'}
          </Button>
        </div>
      </form>
    </RecordDrawer>
  );
}

function InvoicePreviewDrawer({
  invoice,
  onBack,
  order,
}: {
  invoice: SupplierInvoice;
  onBack: () => void;
  order?: PurchaseOrder;
}) {
  return (
    <RecordDrawer
      busy={false}
      onBack={onBack}
      subtitle={`${invoice.supplierName} · ${formatDate(invoice.invoiceDate)}`}
      title={`Invoice ${invoice.invoiceNumber}`}
    >
      <section className="procurement-preview-summary">
        <div>
          <span>Total</span>
          <strong>{formatMoney(invoice.total, invoice.currencyCode)}</strong>
        </div>
        <div>
          <span>Purchase order</span>
          <strong>{shortIdentity(invoice.purchaseOrderId)}</strong>
        </div>
      </section>
      <section className="procurement-preview-section">
        <h3>Three-way comparison</h3>
        {invoice.lines.map((line) => {
          const orderLine = order?.lines.find((item) => item.id === line.orderLineId);
          const matched = orderLine?.deliveredQuantity === orderLine?.invoicedQuantity;
          return (
            <article className="procurement-comparison-card" key={line.id}>
              <header>
                <strong>{line.productName}</strong>
                <span className={`procurement-match ${matched ? 'is-matched' : 'has-variance'}`}>
                  {matched ? 'Matched' : 'Review variance'}
                </span>
              </header>
              <div>
                <span>
                  Ordered <strong>{orderLine?.orderedQuantity ?? '—'}</strong>
                </span>
                <span>
                  Delivered <strong>{orderLine?.deliveredQuantity ?? '—'}</strong>
                </span>
                <span>
                  Invoiced <strong>{orderLine?.invoicedQuantity ?? line.quantity}</strong>
                </span>
              </div>
              <small>
                {formatMoney(line.unitPrice, invoice.currencyCode)} per unit ·{' '}
                {formatMoney(line.lineTotal, invoice.currencyCode)}
              </small>
            </article>
          );
        })}
      </section>
    </RecordDrawer>
  );
}

interface ReceiptOption {
  goodsReceiptLineId: string;
  label: string;
}

function SupplierClaimDrawer({
  onBack,
  onSaved,
  orders,
  token,
}: {
  onBack: () => void;
  onSaved: () => void;
  orders: PurchaseOrder[];
  token: string;
}) {
  const options = useMemo(() => receiptOptions(orders), [orders]);
  const [goodsReceiptLineId, setGoodsReceiptLineId] = useState(
    options[0]?.goodsReceiptLineId ?? '',
  );
  const [quantity, setQuantity] = useState('1');
  const [type, setType] = useState<CreateSupplierClaimRequest['type']>('damaged');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goodsReceiptLineId) return;
    setBusy(true);
    setError(null);
    try {
      await createSupplierClaim(token, crypto.randomUUID(), {
        description: description.trim(),
        goodsReceiptLineId,
        quantity,
        type,
      });
      onSaved();
    } catch (caught) {
      setError(errorText(caught, 'The supplier claim could not be opened.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RecordDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Link the issue to the exact received product"
      title="New supplier claim"
    >
      <form className="procurement-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {!options.length ? (
          <InlineAlert tone="warning">Receive goods before opening a supplier claim.</InlineAlert>
        ) : null}
        <label className="procurement-field">
          <span>Received product</span>
          <select
            onChange={(event) => setGoodsReceiptLineId(event.target.value)}
            required
            value={goodsReceiptLineId}
          >
            {options.map((option) => (
              <option key={option.goodsReceiptLineId} value={option.goodsReceiptLineId}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="procurement-form-grid">
          <label className="procurement-field">
            <span>Issue type</span>
            <select
              onChange={(event) =>
                setType(event.target.value as CreateSupplierClaimRequest['type'])
              }
              value={type}
            >
              <option value="damaged">Damaged</option>
              <option value="non_conforming">Non-conforming</option>
            </select>
          </label>
          <label className="procurement-field">
            <span>Affected quantity</span>
            <input
              inputMode="decimal"
              onChange={(event) => setQuantity(event.target.value)}
              pattern="\d+(\.\d{1,4})?"
              required
              value={quantity}
            />
          </label>
        </div>
        <label className="procurement-field">
          <span>Description</span>
          <textarea
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            required
            rows={5}
            value={description}
          />
        </label>
        <div className="security-drawer-actions">
          <Button disabled={busy} onClick={onBack} type="button" variant="quiet">
            Back
          </Button>
          <Button disabled={busy || !options.length} type="submit">
            {busy ? 'Opening claim' : 'Open claim'}
          </Button>
        </div>
      </form>
    </RecordDrawer>
  );
}

function ClaimPreviewDrawer({
  canEdit,
  claim,
  onBack,
  onSaved,
  token,
}: {
  canEdit: boolean;
  claim: SupplierClaim;
  onBack: () => void;
  onSaved: () => void;
  token: string;
}) {
  const nextStatus = nextClaimStatus(claim.status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function advance() {
    if (!nextStatus) return;
    setBusy(true);
    setError(null);
    try {
      await updateSupplierClaimStatus(token, claim.id, crypto.randomUUID(), {
        expectedVersion: claim.version,
        ...(note.trim() ? { note: note.trim() } : {}),
        status: nextStatus,
      });
      onSaved();
    } catch (caught) {
      setError(errorText(caught, 'The claim status could not be updated.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <RecordDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${claim.supplierName} · ${claim.productName}`}
      title="Supplier claim"
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <section className="procurement-preview-summary">
        <div>
          <span>Status</span>
          <strong>{claimStatusLabel(claim.status)}</strong>
        </div>
        <div>
          <span>Affected quantity</span>
          <strong>{claim.quantity}</strong>
        </div>
        <div>
          <span>Issue</span>
          <strong>{claim.type === 'damaged' ? 'Damaged' : 'Non-conforming'}</strong>
        </div>
      </section>
      <section className="procurement-preview-section">
        <h3>Description</h3>
        <p>{claim.description}</p>
      </section>
      <section className="procurement-preview-section">
        <h3>Status history</h3>
        <ol className="procurement-status-timeline">
          {claim.statusHistory.map((event) => (
            <li key={event.id}>
              <span />
              <div>
                <strong>{claimStatusLabel(event.toStatus)}</strong>
                <p>{event.note ?? 'Status recorded'}</p>
                <small>{formatDateTime(event.changedAt)}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {canEdit && nextStatus ? (
        <section className="procurement-preview-section procurement-claim-update">
          <label className="procurement-field">
            <span>Update note</span>
            <textarea
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              value={note}
            />
          </label>
          <div className="procurement-section-actions">
            <Button disabled={busy} onClick={() => void advance()}>
              {claimAdvanceLabel(nextStatus)}
            </Button>
          </div>
        </section>
      ) : null}
    </RecordDrawer>
  );
}

function RecordDrawer({
  busy,
  children,
  className = '',
  onBack,
  subtitle,
  title,
}: {
  busy: boolean;
  children: React.ReactNode;
  className?: string;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label="Back to procurement list"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className={`security-drawer is-wide procurement-drawer procurement-record-drawer ${className}`.trim()}
        role="dialog"
      >
        <header className="procurement-drawer-header">
          <button
            aria-label="Back to procurement list"
            className="procurement-back-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="arrow" size={17} /> Back
          </button>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button
            aria-label="Close preview"
            className="procurement-close-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function useSupplierProcurementData(token: string) {
  const [suppliers, setSuppliers] = useState<ProcurementSupplierRecord[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [claims, setClaims] = useState<SupplierClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([
      listProcurementSuppliers(token),
      listPurchaseOrders(token, { page: 1, pageSize: 100 }),
      listSupplierInvoices(token),
      listSupplierClaims(token),
    ])
      .then(([supplierItems, orderPage, invoiceItems, claimItems]) => {
        if (!active) return;
        setSuppliers(supplierItems);
        setOrders(orderPage.items);
        setInvoices(invoiceItems);
        setClaims(claimItems);
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
  return { claims, error, invoices, loading, orders, reload, suppliers };
}

function ProcurementLoading() {
  return (
    <div aria-live="polite" className="procurement-loading">
      <span className="loader-mark" />
      <p>Loading procurement records</p>
    </div>
  );
}

function EmptyState({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="procurement-empty">
      <div className="procurement-empty-icon">
        <Icon name="procurement" />
      </div>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function viewTitle(view: ProcurementTabView) {
  return view === 'suppliers'
    ? 'Suppliers'
    : view === 'supplier-invoices'
      ? 'Supplier invoices'
      : view === 'supplier-claims'
        ? 'Supplier claims'
        : view === 'purchase-orders'
          ? 'Purchase orders'
          : 'Goods receipts';
}

function viewDescription(view: SupplierProcurementView) {
  return view === 'suppliers'
    ? 'Keep commercial terms, contacts, and evaluation history together.'
    : view === 'supplier-invoices'
      ? 'Compare what was ordered, delivered, and invoiced before finance posting.'
      : 'Track damaged and non-conforming deliveries from opening through closure.';
}

function viewRegisterTitle(view: SupplierProcurementView) {
  return view === 'suppliers'
    ? 'Supplier register'
    : view === 'supplier-invoices'
      ? 'Invoice register'
      : 'Claims register';
}

function viewRegisterDescription(view: SupplierProcurementView) {
  return view === 'suppliers'
    ? 'Commercial profiles and current supplier relationships.'
    : view === 'supplier-invoices'
      ? 'Invoices linked to purchase orders and delivered quantities.'
      : 'Open and completed issues raised against supplier deliveries.';
}

function viewRecordCount(
  view: SupplierProcurementView,
  data: Pick<ReturnType<typeof useSupplierProcurementData>, 'claims' | 'invoices' | 'suppliers'>,
) {
  return view === 'suppliers'
    ? data.suppliers.length
    : view === 'supplier-invoices'
      ? data.invoices.length
      : data.claims.length;
}

function viewRecordLabel(
  view: SupplierProcurementView,
  data: Pick<ReturnType<typeof useSupplierProcurementData>, 'claims' | 'invoices' | 'suppliers'>,
) {
  const count = viewRecordCount(view, data);
  if (view === 'suppliers') return count === 1 ? 'supplier' : 'suppliers';
  if (view === 'supplier-invoices') return count === 1 ? 'invoice' : 'invoices';
  return count === 1 ? 'claim' : 'claims';
}

function contactInitials(name: string) {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function invoiceDrafts(order?: PurchaseOrder): InvoiceLineDraft[] {
  return (
    order?.lines.map((line) => ({
      include: true,
      orderLineId: line.id,
      quantity: subtract(line.orderedQuantity, line.invoicedQuantity),
      unitPrice: line.unitPrice,
    })) ?? []
  );
}

function updateInvoiceDraft(
  setter: React.Dispatch<React.SetStateAction<InvoiceLineDraft[]>>,
  id: string,
  patch: Partial<InvoiceLineDraft>,
) {
  setter((current) =>
    current.map((line) => (line.orderLineId === id ? { ...line, ...patch } : line)),
  );
}

function receiptOptions(orders: PurchaseOrder[]): ReceiptOption[] {
  return orders.flatMap((order) =>
    order.receipts.flatMap((receipt) =>
      receipt.lines.map((line) => ({
        goodsReceiptLineId: line.id,
        label: `${order.supplierName} · ${order.lines.find((item) => item.id === line.orderLineId)?.productName ?? 'Product'} · received ${line.quantity}`,
      })),
    ),
  );
}

function nextClaimStatus(status: SupplierClaimStatus): SupplierClaimStatus | undefined {
  const transitions: Partial<Record<SupplierClaimStatus, SupplierClaimStatus>> = {
    open: 'submitted',
    submitted: 'resolved',
    resolved: 'closed',
  };
  return transitions[status];
}

function claimStatusLabel(status: SupplierClaimStatus) {
  return { closed: 'Closed', open: 'Open', resolved: 'Resolved', submitted: 'Submitted' }[status];
}

function claimAdvanceLabel(status: SupplierClaimStatus) {
  return status === 'submitted'
    ? 'Submit to supplier'
    : status === 'resolved'
      ? 'Mark resolved'
      : 'Close claim';
}

function shortIdentity(value: string) {
  return value.slice(0, 8).toUpperCase();
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
function formatMoney(value: string, currency: string) {
  return new Intl.NumberFormat('en-GB', { currency, style: 'currency' }).format(Number(value));
}
function subtract(left: string, right: string) {
  return Math.max(0, Number(left) - Number(right)).toFixed(4);
}
function errorText(caught: unknown, fallback: string) {
  return caught instanceof ApiClientError ? caught.message : fallback;
}
