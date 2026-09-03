import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateFinanceSupplierAdvanceRequest,
  CreateFinanceSupplierOffsetRequest,
  CreateFinanceSupplierPaymentRequest,
  FinanceSupplierOffset,
  FinanceSupplierPayable,
  FinanceSupplierPayment,
  FinanceSupplierReferenceData,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  allocateFinanceSupplierAdvance,
  createFinanceSupplierAdvance,
  createFinanceSupplierOffset,
  createFinanceSupplierPayable,
  getFinanceSupplierPayable,
  getFinanceSupplierReferenceData,
  listFinanceSupplierAdvances,
  listFinanceSupplierOffsets,
  listFinanceSupplierPayables,
  recordFinanceSupplierPayment,
} from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';
import { FinanceTabs } from './FinanceBankPage';

const emptyReferences: FinanceSupplierReferenceData = {
  businessDate: '',
  openReceivables: [],
  supplierInvoices: [],
  suppliers: [],
};

export function FinancePayablesPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useSupplierFinance(token);
  const [view, setView] = useState<'advances' | 'payables'>('payables');
  const [createMode, setCreateMode] = useState<'advance' | 'offset' | 'payable' | null>(null);
  const [selectedPayable, setSelectedPayable] = useState<FinanceSupplierPayable | null>(null);
  const [selectedAdvance, setSelectedAdvance] = useState<FinanceSupplierPayment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canCreate = hasPermission('erp.finance', 'create');
  const canEdit = hasPermission('erp.finance', 'edit');

  const summary = useMemo(() => {
    const open = data.payables.filter((item) => item.outstandingTotal !== '0.0000');
    return {
      advances: sum(data.advances.map((item) => item.availableTotal)),
      overdue: sum(
        open
          .filter((item) => item.paymentStatus === 'overdue')
          .map((item) => item.outstandingTotal),
      ),
      outstanding: sum(open.map((item) => item.outstandingTotal)),
      suppliers: new Set(open.map((item) => item.supplierPartnerId)).size,
    };
  }, [data.advances, data.payables]);

  async function previewPayable(id: string) {
    try {
      setSelectedPayable(await getFinanceSupplierPayable(token, id));
    } catch (caught) {
      setNotice(errorText(caught, 'The supplier payable could not be opened.'));
    }
  }

  if (data.loading) return <SupplierFinanceState title="Loading supplier balances" />;
  if (data.error)
    return (
      <SupplierFinanceState title="Supplier balances could not be loaded">
        <Button onClick={() => void data.reload()} variant="secondary">
          Try again
        </Button>
      </SupplierFinanceState>
    );

  return (
    <div className="page-stack supplier-finance-workspace">
      <header className="page-header supplier-finance-header">
        <div>
          <p className="page-eyebrow">ERP · Finance</p>
          <h1>Supplier payables</h1>
          <p>Review supplier balances, connect payments, and keep advances visible until used.</p>
        </div>
        {canCreate ? (
          <div className="supplier-finance-header-actions">
            <Button onClick={() => setCreateMode('advance')} variant="secondary">
              <Icon name="plus" size={17} /> New advance
            </Button>
            <Button onClick={() => setCreateMode('payable')}>
              <Icon name="plus" size={17} /> Add supplier invoice
            </Button>
          </div>
        ) : null}
      </header>

      <FinanceTabs />

      <InlineAlert tone="info">
        This subledger uses BGN supplier-invoice evidence. Legal posting, deductible VAT, and
        foreign-currency conversion remain controlled by the approved accounting configuration. Cash
        disbursements must still be issued through Cash operations; direct voucher allocation is not
        enabled here.
      </InlineAlert>

      <section aria-label="Supplier balance summary" className="supplier-finance-summary">
        <SupplierMetric label="Outstanding" value={money(summary.outstanding)} />
        <SupplierMetric label="Overdue" tone="warning" value={money(summary.overdue)} />
        <SupplierMetric label="Available advances" value={money(summary.advances)} />
        <SupplierMetric label="Open suppliers" value={String(summary.suppliers)} />
      </section>

      {notice ? (
        <Toast
          durationMs={notice.includes('could not') ? 7000 : 5200}
          onDismiss={() => setNotice(null)}
          tone={notice.includes('could not') ? 'error' : 'success'}
        >
          {notice}
        </Toast>
      ) : null}

      <div aria-label="Supplier finance views" className="supplier-finance-view-switch">
        <button
          className={view === 'payables' ? 'is-active' : undefined}
          onClick={() => setView('payables')}
          type="button"
        >
          Payable register <span>{data.payables.length}</span>
        </button>
        <button
          className={view === 'advances' ? 'is-active' : undefined}
          onClick={() => setView('advances')}
          type="button"
        >
          Advances &amp; offsets <span>{data.advances.length + data.offsets.length}</span>
        </button>
      </div>

      {view === 'payables' ? (
        <PayableRegister
          onPreview={(item) => void previewPayable(item.id)}
          payables={data.payables}
        />
      ) : (
        <AdvanceOffsetRegister
          advances={data.advances}
          offsets={data.offsets}
          onAdvance={setSelectedAdvance}
        />
      )}

      {createMode === 'payable' ? (
        <CreatePayableDrawer
          onBack={() => setCreateMode(null)}
          onSaved={(payable) => {
            setCreateMode(null);
            setSelectedPayable(payable);
            setNotice(`${payable.number} was added to supplier payables.`);
            void data.reload();
          }}
          references={data.references}
          token={token}
        />
      ) : null}
      {createMode === 'advance' ? (
        <CreateAdvanceDrawer
          onBack={() => setCreateMode(null)}
          onSaved={(advance) => {
            setCreateMode(null);
            setSelectedAdvance(advance);
            setView('advances');
            setNotice(`${advance.number} was recorded as an available supplier advance.`);
            void data.reload();
          }}
          references={data.references}
          token={token}
        />
      ) : null}
      {createMode === 'offset' ? (
        <CreateOffsetDrawer
          onBack={() => setCreateMode(null)}
          onSaved={(offset) => {
            setCreateMode(null);
            setNotice(`${offset.number} settled both partner balances.`);
            setView('advances');
            void data.reload();
          }}
          payables={data.payables}
          references={data.references}
          token={token}
        />
      ) : null}
      {selectedPayable ? (
        <PayableDrawer
          canCreate={canCreate}
          onBack={() => setSelectedPayable(null)}
          onOffset={() => {
            setSelectedPayable(null);
            setCreateMode('offset');
          }}
          onSaved={(payable, message) => {
            setSelectedPayable(payable);
            setNotice(message);
            void data.reload();
          }}
          payable={selectedPayable}
          references={data.references}
          token={token}
        />
      ) : null}
      {selectedAdvance ? (
        <AdvanceDrawer
          canEdit={canEdit}
          onBack={() => setSelectedAdvance(null)}
          onSaved={(advance) => {
            setSelectedAdvance(advance);
            setNotice(`${advance.number} was allocated.`);
            void data.reload();
          }}
          payables={data.payables}
          payment={selectedAdvance}
          token={token}
        />
      ) : null}
    </div>
  );
}

function SupplierMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: 'warning';
  value: string;
}) {
  return (
    <div className={tone ? 'is-warning' : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PayableRegister({
  onPreview,
  payables,
}: {
  onPreview: (item: FinanceSupplierPayable) => void;
  payables: FinanceSupplierPayable[];
}) {
  if (!payables.length)
    return (
      <SupplierFinanceState title="No supplier payables yet">
        <p>Record a supplier invoice in Procurement, then add it to this register.</p>
        <Link
          className="vista-button vista-button--secondary"
          to="/modules/erp.procurement/supplier-invoices"
        >
          Open supplier invoices
        </Link>
      </SupplierFinanceState>
    );
  return (
    <section aria-label="Supplier payable register" className="supplier-finance-register">
      <div aria-hidden="true" className="supplier-finance-register-head">
        <span>Payable</span>
        <span>Due</span>
        <span>Balance</span>
        <span>Status</span>
        <span />
      </div>
      {payables.map((item) => (
        <article className="supplier-finance-register-row" key={item.id}>
          <div className="supplier-finance-identity">
            <span>SP</span>
            <div>
              <strong>{item.number}</strong>
              <span>{item.supplierName}</span>
              <small>Supplier invoice {item.sourceSupplierInvoiceNumber}</small>
            </div>
          </div>
          <div className="supplier-finance-date">
            <strong>{formatDate(item.dueDate)}</strong>
            <span>{dueText(item)}</span>
          </div>
          <div className="supplier-finance-value">
            <strong>{money(item.outstandingTotal)}</strong>
            <span>of {money(item.total)}</span>
          </div>
          <PayableStatus status={item.paymentStatus} />
          <Button onClick={() => onPreview(item)} variant="quiet">
            Preview
          </Button>
        </article>
      ))}
    </section>
  );
}

function AdvanceOffsetRegister({
  advances,
  offsets,
  onAdvance,
}: {
  advances: FinanceSupplierPayment[];
  offsets: FinanceSupplierOffset[];
  onAdvance: (item: FinanceSupplierPayment) => void;
}) {
  if (!advances.length && !offsets.length)
    return (
      <SupplierFinanceState title="No supplier advances or offsets yet">
        <p>Unused supplier funds and bilateral compensation records will remain visible here.</p>
      </SupplierFinanceState>
    );
  return (
    <div className="supplier-finance-ledgers">
      <section aria-label="Supplier advance register" className="supplier-finance-ledger-card">
        <header>
          <div>
            <p>Available funds</p>
            <h2>Supplier advances</h2>
          </div>
          <strong>{money(sum(advances.map((item) => item.availableTotal)))}</strong>
        </header>
        {advances.length ? (
          <div className="supplier-finance-compact-list">
            {advances.map((item) => (
              <button key={item.id} onClick={() => onAdvance(item)} type="button">
                <span>
                  <strong>{item.number}</strong>
                  <small>
                    {item.supplierName} · {formatDate(item.paymentDate)}
                  </small>
                </span>
                <span>
                  <strong>{money(item.availableTotal)}</strong>
                  <small>of {money(item.amount)} available</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="supplier-finance-card-empty">No advances recorded.</p>
        )}
      </section>
      <section aria-label="Supplier offset register" className="supplier-finance-ledger-card">
        <header>
          <div>
            <p>Compensation</p>
            <h2>Receivable offsets</h2>
          </div>
          <strong>{offsets.length}</strong>
        </header>
        {offsets.length ? (
          <div className="supplier-finance-offset-list">
            {offsets.map((item) => (
              <article key={item.id}>
                <span className="supplier-finance-offset-mark">
                  <Icon name="check" size={16} />
                </span>
                <div>
                  <strong>{item.number}</strong>
                  <span>{item.partnerName}</span>
                  <small>
                    {item.customerDocumentNumber} ↔ {item.supplierPayableNumber}
                  </small>
                </div>
                <strong>{money(item.amount)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p className="supplier-finance-card-empty">No offsets recorded.</p>
        )}
      </section>
    </div>
  );
}

function CreatePayableDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (item: FinanceSupplierPayable) => void;
  references: FinanceSupplierReferenceData;
  token: string;
}) {
  const [invoiceId, setInvoiceId] = useState(references.supplierInvoices[0]?.id ?? '');
  const invoice = references.supplierInvoices.find((item) => item.id === invoiceId);
  const [dueDate, setDueDate] = useState(invoice?.suggestedDueDate ?? references.businessDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeInvoice(id: string) {
    setInvoiceId(id);
    const next = references.supplierInvoices.find((item) => item.id === id);
    if (next) setDueDate(next.suggestedDueDate);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!invoiceId) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await createFinanceSupplierPayable(token, crypto.randomUUID(), {
          dueDate,
          supplierInvoiceId: invoiceId,
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'The supplier invoice could not be added.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SupplierDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Supplier payables"
      title="Add supplier invoice"
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {!references.supplierInvoices.length ? (
        <div className="supplier-finance-drawer-empty">
          <Icon name="finance" size={24} />
          <h3>No supplier invoices are ready</h3>
          <p>Record a BGN supplier invoice in Procurement before adding a payable.</p>
          <Link
            className="vista-button vista-button--secondary"
            to="/modules/erp.procurement/supplier-invoices"
          >
            Open supplier invoices
          </Link>
        </div>
      ) : (
        <form className="supplier-finance-form" onSubmit={(event) => void submit(event)}>
          <section className="supplier-finance-form-section">
            <header>
              <span>1</span>
              <div>
                <h3>Source invoice</h3>
                <p>Choose supplier evidence that has not entered Finance yet.</p>
              </div>
            </header>
            <label>
              <span>Supplier invoice</span>
              <select onChange={(event) => changeInvoice(event.target.value)} value={invoiceId}>
                {references.supplierInvoices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.invoiceNumber} · {item.supplierName} · {money(item.total)}
                  </option>
                ))}
              </select>
            </label>
            {invoice ? (
              <div className="supplier-finance-source-card">
                <span>Supplier</span>
                <strong>{invoice.supplierName}</strong>
                <small>
                  {formatDate(invoice.invoiceDate)} · {invoice.currencyCode} ·{' '}
                  {invoice.paymentTermsDays === undefined
                    ? 'No saved payment term'
                    : `${invoice.paymentTermsDays} day terms`}
                </small>
              </div>
            ) : null}
          </section>
          <section className="supplier-finance-form-section">
            <header>
              <span>2</span>
              <div>
                <h3>Payment due date</h3>
                <p>The saved supplier terms provide the initial suggestion.</p>
              </div>
            </header>
            <label>
              <span>Due date</span>
              <input
                min={invoice?.invoiceDate}
                onChange={(event) => setDueDate(event.target.value)}
                required
                type="date"
                value={dueDate}
              />
            </label>
          </section>
          <div className="finance-drawer-actions">
            <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
              Cancel
            </Button>
            <Button disabled={busy || !invoiceId} type="submit">
              {busy ? 'Adding…' : 'Add payable'}
            </Button>
          </div>
        </form>
      )}
    </SupplierDrawer>
  );
}

function PayableDrawer({
  canCreate,
  onBack,
  onOffset,
  onSaved,
  payable,
  references,
  token,
}: {
  canCreate: boolean;
  onBack: () => void;
  onOffset: () => void;
  onSaved: (item: FinanceSupplierPayable, message: string) => void;
  payable: FinanceSupplierPayable;
  references: FinanceSupplierReferenceData;
  token: string;
}) {
  const [recording, setRecording] = useState(false);
  const [amount, setAmount] = useState(payable.outstandingTotal);
  const [paymentDate, setPaymentDate] = useState(references.businessDate);
  const [paymentMethod, setPaymentMethod] =
    useState<CreateFinanceSupplierPaymentRequest['paymentMethod']>('bank_transfer');
  const [paymentReference, setPaymentReference] = useState(payable.sourceSupplierInvoiceNumber);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canOffset = references.openReceivables.some(
    (item) => item.customerPartnerId === payable.supplierPartnerId,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await recordFinanceSupplierPayment(token, payable.id, crypto.randomUUID(), {
        amount,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        paymentDate,
        paymentMethod,
        ...(paymentReference.trim() ? { paymentReference: paymentReference.trim() } : {}),
      });
      setRecording(false);
      onSaved(updated, `Payment applied to ${updated.number}.`);
    } catch (caught) {
      setError(errorText(caught, 'The supplier payment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SupplierDrawer
      busy={busy}
      onBack={onBack}
      subtitle={payable.supplierName}
      title={payable.number}
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="supplier-payable-hero">
        <div>
          <PayableStatus status={payable.paymentStatus} />
          <h3>{money(payable.outstandingTotal)}</h3>
          <p>remaining from {money(payable.total)}</p>
        </div>
        <span className="supplier-payable-hero-mark">SP</span>
      </div>
      <dl className="supplier-finance-detail-grid">
        <div>
          <dt>Supplier invoice</dt>
          <dd>{payable.sourceSupplierInvoiceNumber}</dd>
        </div>
        <div>
          <dt>Invoice date</dt>
          <dd>{formatDate(payable.documentDate)}</dd>
        </div>
        <div>
          <dt>Due date</dt>
          <dd>{formatDate(payable.dueDate)}</dd>
        </div>
        <div>
          <dt>Currency snapshot</dt>
          <dd>
            {payable.currencyCode} · rate {payable.exchangeRate}
          </dd>
        </div>
      </dl>

      {recording ? (
        <form className="supplier-finance-form is-compact" onSubmit={(event) => void submit(event)}>
          <section className="supplier-finance-form-section">
            <header>
              <span>1</span>
              <div>
                <h3>Supplier payment</h3>
                <p>Record only the amount applied to this payable.</p>
              </div>
            </header>
            <div className="supplier-finance-form-grid">
              <label>
                <span>Amount</span>
                <input
                  max={payable.outstandingTotal}
                  min="0.0001"
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  step="0.0001"
                  type="number"
                  value={amount}
                />
                <small>Maximum {money(payable.outstandingTotal)}</small>
              </label>
              <label>
                <span>Payment date</span>
                <input
                  onChange={(event) => setPaymentDate(event.target.value)}
                  required
                  type="date"
                  value={paymentDate}
                />
              </label>
              <label>
                <span>Payment method</span>
                <select
                  onChange={(event) =>
                    setPaymentMethod(
                      event.target.value as CreateFinanceSupplierPaymentRequest['paymentMethod'],
                    )
                  }
                  value={paymentMethod}
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="pos_terminal">POS terminal</option>
                  <option value="card">Card</option>
                </select>
              </label>
              <label>
                <span>Reference (optional)</span>
                <input
                  onChange={(event) => setPaymentReference(event.target.value)}
                  value={paymentReference}
                />
              </label>
            </div>
            <label>
              <span>Notes (optional)</span>
              <textarea onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
            </label>
          </section>
          <div className="finance-drawer-actions">
            <Button
              disabled={busy}
              onClick={() => setRecording(false)}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <section className="supplier-finance-history">
            <header>
              <div>
                <p>Payment trail</p>
                <h3>
                  {payable.payments.length ? 'Applied supplier payments' : 'No payments applied'}
                </h3>
              </div>
              <strong>{money(payable.allocatedTotal)}</strong>
            </header>
            {payable.payments.map((payment) => (
              <article key={payment.id}>
                <span className={`supplier-payment-kind is-${payment.kind}`}>
                  {payment.kind === 'advance' ? 'AD' : payment.kind === 'offset' ? 'OF' : 'PM'}
                </span>
                <div>
                  <strong>{payment.number}</strong>
                  <span>{paymentMethodLabel(payment.paymentMethod)}</span>
                  <small>{formatDate(payment.paymentDate)}</small>
                </div>
                <strong>
                  {money(
                    payment.allocations.find(
                      (allocation) => allocation.supplierPayableId === payable.id,
                    )?.amount ?? '0',
                  )}
                </strong>
              </article>
            ))}
          </section>
          {canCreate && payable.outstandingTotal !== '0.0000' ? (
            <div className="finance-drawer-actions">
              {canOffset ? (
                <Button onClick={onOffset} variant="secondary">
                  Create offset
                </Button>
              ) : null}
              <Button onClick={() => setRecording(true)}>Record payment</Button>
            </div>
          ) : null}
        </>
      )}
    </SupplierDrawer>
  );
}

function CreateAdvanceDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (item: FinanceSupplierPayment) => void;
  references: FinanceSupplierReferenceData;
  token: string;
}) {
  const [supplierId, setSupplierId] = useState(references.suppliers[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(references.businessDate);
  const [paymentMethod, setPaymentMethod] =
    useState<CreateFinanceSupplierAdvanceRequest['paymentMethod']>('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await createFinanceSupplierAdvance(token, crypto.randomUUID(), {
          amount,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          paymentDate,
          paymentMethod,
          ...(paymentReference.trim() ? { paymentReference: paymentReference.trim() } : {}),
          supplierPartnerId: supplierId,
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'The supplier advance could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SupplierDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Available supplier funds"
      title="New supplier advance"
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <form className="supplier-finance-form" onSubmit={(event) => void submit(event)}>
        <section className="supplier-finance-form-section">
          <header>
            <span>1</span>
            <div>
              <h3>Supplier and value</h3>
              <p>The amount remains unallocated until it is applied to a payable.</p>
            </div>
          </header>
          <label>
            <span>Supplier</span>
            <select
              onChange={(event) => setSupplierId(event.target.value)}
              required
              value={supplierId}
            >
              {references.suppliers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="supplier-finance-form-grid">
            <label>
              <span>Amount</span>
              <input
                min="0.0001"
                onChange={(event) => setAmount(event.target.value)}
                required
                step="0.0001"
                type="number"
                value={amount}
              />
            </label>
            <label>
              <span>Payment date</span>
              <input
                onChange={(event) => setPaymentDate(event.target.value)}
                required
                type="date"
                value={paymentDate}
              />
            </label>
            <label>
              <span>Payment method</span>
              <select
                onChange={(event) =>
                  setPaymentMethod(
                    event.target.value as CreateFinanceSupplierAdvanceRequest['paymentMethod'],
                  )
                }
                value={paymentMethod}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="pos_terminal">POS terminal</option>
                <option value="card">Card</option>
              </select>
            </label>
            <label>
              <span>Reference (optional)</span>
              <input
                onChange={(event) => setPaymentReference(event.target.value)}
                value={paymentReference}
              />
            </label>
          </div>
          <label>
            <span>Notes (optional)</span>
            <textarea onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
          </label>
        </section>
        <div className="finance-drawer-actions">
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={busy || !supplierId} type="submit">
            {busy ? 'Recording…' : 'Record advance'}
          </Button>
        </div>
      </form>
    </SupplierDrawer>
  );
}

function AdvanceDrawer({
  canEdit,
  onBack,
  onSaved,
  payables,
  payment,
  token,
}: {
  canEdit: boolean;
  onBack: () => void;
  onSaved: (item: FinanceSupplierPayment) => void;
  payables: FinanceSupplierPayable[];
  payment: FinanceSupplierPayment;
  token: string;
}) {
  const eligible = payables.filter(
    (item) =>
      item.supplierPartnerId === payment.supplierPartnerId && item.outstandingTotal !== '0.0000',
  );
  const [allocating, setAllocating] = useState(false);
  const [payableId, setPayableId] = useState(eligible[0]?.id ?? '');
  const selected = eligible.find((item) => item.id === payableId);
  const [amount, setAmount] = useState(
    selected ? minimum(payment.availableTotal, selected.outstandingTotal) : payment.availableTotal,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changePayable(id: string) {
    setPayableId(id);
    const next = eligible.find((item) => item.id === id);
    if (next) setAmount(minimum(payment.availableTotal, next.outstandingTotal));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await allocateFinanceSupplierAdvance(token, payment.id, crypto.randomUUID(), {
          amount,
          expectedAdvanceVersion: payment.version,
          expectedPayableVersion: selected.version,
          supplierPayableId: selected.id,
        }),
      );
      setAllocating(false);
    } catch (caught) {
      setError(errorText(caught, 'The advance could not be allocated.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SupplierDrawer
      busy={busy}
      onBack={onBack}
      subtitle={payment.supplierName}
      title={payment.number}
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="supplier-advance-hero">
        <span>Available balance</span>
        <strong>{money(payment.availableTotal)}</strong>
        <small>{money(payment.allocatedTotal)} already allocated</small>
      </div>
      <dl className="supplier-finance-detail-grid">
        <div>
          <dt>Original amount</dt>
          <dd>{money(payment.amount)}</dd>
        </div>
        <div>
          <dt>Payment date</dt>
          <dd>{formatDate(payment.paymentDate)}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{paymentMethodLabel(payment.paymentMethod)}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{payment.paymentReference ?? 'Not supplied'}</dd>
        </div>
      </dl>
      {payment.allocations.length ? (
        <section className="supplier-finance-history">
          <header>
            <div>
              <p>Allocation trail</p>
              <h3>Payables covered by this advance</h3>
            </div>
          </header>
          {payment.allocations.map((allocation) => (
            <article key={allocation.id}>
              <span className="supplier-payment-kind is-advance">AD</span>
              <div>
                <strong>{allocation.payableNumber}</strong>
                <small>{formatDateTime(allocation.allocatedAt)}</small>
              </div>
              <strong>{money(allocation.amount)}</strong>
            </article>
          ))}
        </section>
      ) : null}
      {allocating ? (
        <form className="supplier-finance-form is-compact" onSubmit={(event) => void submit(event)}>
          <section className="supplier-finance-form-section">
            <header>
              <span>1</span>
              <div>
                <h3>Apply advance</h3>
                <p>Only open payables for {payment.supplierName} are available.</p>
              </div>
            </header>
            {eligible.length ? (
              <>
                <label>
                  <span>Supplier payable</span>
                  <select onChange={(event) => changePayable(event.target.value)} value={payableId}>
                    {eligible.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.number} · {item.sourceSupplierInvoiceNumber} ·{' '}
                        {money(item.outstandingTotal)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Amount to apply</span>
                  <input
                    max={
                      selected
                        ? minimum(payment.availableTotal, selected.outstandingTotal)
                        : undefined
                    }
                    min="0.0001"
                    onChange={(event) => setAmount(event.target.value)}
                    required
                    step="0.0001"
                    type="number"
                    value={amount}
                  />
                </label>
              </>
            ) : (
              <InlineAlert tone="info">There is no open payable for this supplier.</InlineAlert>
            )}
          </section>
          <div className="finance-drawer-actions">
            <Button
              disabled={busy}
              onClick={() => setAllocating(false)}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button disabled={busy || !selected} type="submit">
              {busy ? 'Applying…' : 'Apply advance'}
            </Button>
          </div>
        </form>
      ) : canEdit && payment.availableTotal !== '0.0000' ? (
        <div className="finance-drawer-actions">
          <Button disabled={!eligible.length} onClick={() => setAllocating(true)}>
            Apply to payable
          </Button>
        </div>
      ) : null}
    </SupplierDrawer>
  );
}

function CreateOffsetDrawer({
  onBack,
  onSaved,
  payables,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (item: FinanceSupplierOffset) => void;
  payables: FinanceSupplierPayable[];
  references: FinanceSupplierReferenceData;
  token: string;
}) {
  const eligible = payables.filter(
    (payable) =>
      payable.outstandingTotal !== '0.0000' &&
      references.openReceivables.some(
        (receivable) => receivable.customerPartnerId === payable.supplierPartnerId,
      ),
  );
  const [payableId, setPayableId] = useState(eligible[0]?.id ?? '');
  const payable = eligible.find((item) => item.id === payableId);
  const receivables = references.openReceivables.filter(
    (item) => item.customerPartnerId === payable?.supplierPartnerId,
  );
  const [receivableId, setReceivableId] = useState(receivables[0]?.id ?? '');
  const receivable = receivables.find((item) => item.id === receivableId);
  const [amount, setAmount] = useState(
    payable && receivable ? minimum(payable.outstandingTotal, receivable.outstandingTotal) : '',
  );
  const [offsetDate, setOffsetDate] = useState(references.businessDate);
  const [reason, setReason] = useState('Mutual balance compensation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changePayable(id: string) {
    setPayableId(id);
    const nextPayable = eligible.find((item) => item.id === id);
    const nextReceivable = references.openReceivables.find(
      (item) => item.customerPartnerId === nextPayable?.supplierPartnerId,
    );
    setReceivableId(nextReceivable?.id ?? '');
    if (nextPayable && nextReceivable)
      setAmount(minimum(nextPayable.outstandingTotal, nextReceivable.outstandingTotal));
  }

  function changeReceivable(id: string) {
    setReceivableId(id);
    const next = receivables.find((item) => item.id === id);
    if (payable && next) setAmount(minimum(payable.outstandingTotal, next.outstandingTotal));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!payable || !receivable) return;
    const input: CreateFinanceSupplierOffsetRequest = {
      amount,
      customerDocumentId: receivable.id,
      expectedCustomerDocumentVersion: receivable.version,
      expectedSupplierPayableVersion: payable.version,
      offsetDate,
      reason,
      supplierPayableId: payable.id,
    };
    setBusy(true);
    setError(null);
    try {
      onSaved(await createFinanceSupplierOffset(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The compensation offset could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SupplierDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Receivable ↔ payable"
      title="New compensation offset"
    >
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {!eligible.length ? (
        <div className="supplier-finance-drawer-empty">
          <Icon name="finance" size={24} />
          <h3>No bilateral balances are ready</h3>
          <p>
            An offset requires the same partner to have both an open customer receivable and
            supplier payable.
          </p>
        </div>
      ) : (
        <form className="supplier-finance-form" onSubmit={(event) => void submit(event)}>
          <section className="supplier-finance-form-section">
            <header>
              <span>1</span>
              <div>
                <h3>Balances to compensate</h3>
                <p>Both records must belong to the same legal counterparty.</p>
              </div>
            </header>
            <label>
              <span>Supplier payable</span>
              <select onChange={(event) => changePayable(event.target.value)} value={payableId}>
                {eligible.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.number} · {item.supplierName} · {money(item.outstandingTotal)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Customer receivable</span>
              <select
                onChange={(event) => changeReceivable(event.target.value)}
                value={receivableId}
              >
                {receivables.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.number} · {item.sourceInvoiceNumber} · {money(item.outstandingTotal)}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="supplier-finance-form-section">
            <header>
              <span>2</span>
              <div>
                <h3>Compensation record</h3>
                <p>The amount reduces both balances in the same transaction.</p>
              </div>
            </header>
            <div className="supplier-finance-form-grid">
              <label>
                <span>Offset amount</span>
                <input
                  max={
                    payable && receivable
                      ? minimum(payable.outstandingTotal, receivable.outstandingTotal)
                      : undefined
                  }
                  min="0.0001"
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  step="0.0001"
                  type="number"
                  value={amount}
                />
              </label>
              <label>
                <span>Offset date</span>
                <input
                  onChange={(event) => setOffsetDate(event.target.value)}
                  required
                  type="date"
                  value={offsetDate}
                />
              </label>
            </div>
            <label>
              <span>Reason</span>
              <textarea
                onChange={(event) => setReason(event.target.value)}
                required
                rows={3}
                value={reason}
              />
            </label>
          </section>
          <div className="finance-drawer-actions">
            <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
              Cancel
            </Button>
            <Button disabled={busy || !payable || !receivable} type="submit">
              {busy ? 'Creating…' : 'Create offset'}
            </Button>
          </div>
        </form>
      )}
    </SupplierDrawer>
  );
}

function SupplierDrawer({
  busy,
  children,
  onBack,
  subtitle,
  title,
}: {
  busy: boolean;
  children: ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-backdrop" role="presentation">
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide supplier-finance-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header supplier-finance-drawer-header">
          <button
            aria-label="Back to supplier payables"
            className="panel-back-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="arrow" size={17} /> Back
          </button>
          <button
            aria-label="Close panel"
            className="panel-close-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="close" size={18} />
          </button>
          <div>
            <p>{subtitle}</p>
            <h2>{title}</h2>
          </div>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function SupplierFinanceState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <section className="supplier-finance-state">
      <span>
        <Icon name="finance" size={23} />
      </span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

function PayableStatus({ status }: { status: FinanceSupplierPayable['paymentStatus'] }) {
  return <span className={`finance-status is-${status}`}>{statusLabel(status)}</span>;
}

function useSupplierFinance(token: string) {
  const [references, setReferences] = useState(emptyReferences);
  const [payables, setPayables] = useState<FinanceSupplierPayable[]>([]);
  const [advances, setAdvances] = useState<FinanceSupplierPayment[]>([]);
  const [offsets, setOffsets] = useState<FinanceSupplierOffset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([
      getFinanceSupplierReferenceData(token),
      listFinanceSupplierPayables(token),
      listFinanceSupplierAdvances(token),
      listFinanceSupplierOffsets(token),
    ])
      .then(([nextReferences, payablePage, advancePage, offsetPage]) => {
        if (!active) return;
        setReferences(nextReferences);
        setPayables(payablePage.items);
        setAdvances(advancePage.items);
        setOffsets(offsetPage.items);
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

  return { advances, error, loading, offsets, payables, references, reload };
}

function money(value: string) {
  return new Intl.NumberFormat(undefined, {
    currency: 'BGN',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(Number(value));
}

function sum(values: string[]) {
  return values.reduce((total, value) => total + Number(value), 0).toFixed(4);
}

function minimum(left: string, right: string) {
  return Math.min(Number(left), Number(right)).toFixed(4);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeZone: 'Europe/Sofia',
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(new Date(value));
}

function dueText(item: FinanceSupplierPayable) {
  if (item.paymentStatus === 'paid') return 'Settled';
  if (item.paymentStatus === 'overdue') return 'Past due';
  return 'Scheduled';
}

function statusLabel(status: FinanceSupplierPayable['paymentStatus']) {
  return {
    overdue: 'Overdue',
    paid: 'Paid',
    partially_paid: 'Partially paid',
    unpaid: 'Unpaid',
  }[status];
}

function paymentMethodLabel(method: FinanceSupplierPayment['paymentMethod']) {
  return {
    bank_transfer: 'Bank transfer',
    card: 'Card',
    cash: 'Cash',
    offset: 'Compensation / offset',
    pos_terminal: 'POS terminal',
  }[method];
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) return error.message;
  return fallback;
}
