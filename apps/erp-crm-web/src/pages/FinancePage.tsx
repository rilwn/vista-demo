import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateFinanceCustomerDocumentRequest,
  CreateFinancePaymentRequest,
  FinanceCustomerDocument,
  FinancePayment,
  FinancePaymentMethod,
  FinanceReferenceData,
  FinanceSummary,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  cancelFinanceDocument,
  createFinanceDocument,
  getFinanceReferenceData,
  getFinanceSummary,
  listFinanceDocuments,
  recordFinancePayment,
  reverseFinancePayment,
} from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { financialDocumentMessages as copy } from '../i18n/legacyMessages';
import {
  formatOperationsCurrency,
  formatOperationsDate,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { Link, useRouter } from '../routing/Router';
import { FinanceTabs } from './FinanceBankPage';
import { collectionCorrectionsMessages } from './collection-corrections.messages';
import { FinancialDocumentsPage } from './FinancialDocumentsPage';

export type FinanceView = 'invoices' | 'payments';

const emptyReferences: FinanceReferenceData = { invoiceDrafts: [] };
const emptySummary: FinanceSummary = {
  activeDocuments: 0,
  overdueOutstanding: '0.0000',
  paidDocuments: 0,
  totalOutstanding: '0.0000',
};

export function FinancePage({ view }: { view: FinanceView }) {
  return view === 'invoices' ? <FinancialDocumentsPage /> : <FinanceCollectionsPage view={view} />;
}

function FinanceCollectionsPage({ view }: { view: FinanceView }) {
  useLocalization();
  const { location, navigate } = useRouter();
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useFinanceData(token);
  const [selected, setSelected] = useState<FinanceCustomerDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canCreate = hasPermission('erp.finance', 'create');
  const canEdit = hasPermission('erp.finance', 'edit');
  const canApprove = hasPermission('erp.finance', 'approve');
  const canPrepareSales = hasPermission('erp.sales', 'create');
  const canViewSales = hasPermission('erp.sales');
  const routeState =
    location.state && typeof location.state === 'object'
      ? (location.state as { financeCollectionDocumentId?: unknown; paymentId?: unknown })
      : undefined;
  const requestedPaymentId =
    typeof routeState?.paymentId === 'string' ? routeState.paymentId : undefined;
  const requestedCollectionDocumentId =
    typeof routeState?.financeCollectionDocumentId === 'string'
      ? routeState.financeCollectionDocumentId
      : undefined;
  const pageTitle = view === 'invoices' ? 'Invoices' : 'Collections & payments';
  const pageDescription =
    view === 'invoices'
      ? 'Review sales invoice drafts, follow balances, and keep each customer collection record together.'
      : 'Review every customer collection, then record and follow its payment allocations.';

  useEffect(() => {
    if ((!requestedPaymentId && !requestedCollectionDocumentId) || data.loading || data.error)
      return;
    navigate(location.pathname, { replace: true });
    const document = requestedCollectionDocumentId
      ? data.documents.find((item) => item.id === requestedCollectionDocumentId)
      : data.documents.find((item) =>
          item.payments.some((payment) => payment.id === requestedPaymentId),
        );
    if (document) setSelected(document);
    else
      setNotice(
        requestedCollectionDocumentId
          ? 'The collection record could not be found in the customer register.'
          : 'The linked payment could not be found in the customer collection register.',
      );
  }, [
    data.documents,
    data.error,
    data.loading,
    location.pathname,
    navigate,
    requestedCollectionDocumentId,
    requestedPaymentId,
  ]);

  if (data.loading) return <FinanceState title="Loading finance records" />;
  if (data.error)
    return (
      <FinanceState title="Finance records could not be loaded">
        <Button onClick={data.reload} variant="secondary">
          Try again
        </Button>
      </FinanceState>
    );

  return (
    <div className="page-stack finance-workspace">
      <header className="page-header finance-workspace-header">
        <div>
          <p className="page-eyebrow">ERP · Finance</p>
          <h1>{pageTitle}</h1>
          <p>{pageDescription}</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={17} /> Add to collections
          </Button>
        ) : null}
      </header>

      <FinanceTabs />

      <FinanceSummaryCards summary={data.summary} />
      {notice ? (
        <Toast onDismiss={() => setNotice(null)} tone="success">
          {notice}
        </Toast>
      ) : null}
      <FinanceRegister documents={data.documents} onPreview={setSelected} />

      {creating ? (
        <FinanceDocumentDrawer
          canPrepareSales={canPrepareSales}
          onBack={() => setCreating(false)}
          onSaved={(document) => {
            setCreating(false);
            setNotice(`${document.number} was added to collections.`);
            data.reload();
            setSelected(document);
          }}
          references={data.references}
          token={token}
        />
      ) : null}
      {selected ? (
        <FinancePreviewDrawer
          canApprove={canApprove}
          canCreate={canCreate}
          canEdit={canEdit}
          document={selected}
          {...(canViewSales && selected.sourceSalesInvoiceId
            ? {
                onOpenSalesSource: () =>
                  navigate('/modules/erp.sales/shipments', {
                    state: {
                      returnTo: location.pathname,
                      sourceSalesInvoiceId: selected.sourceSalesInvoiceId,
                    },
                  }),
              }
            : {})}
          onBack={() => setSelected(null)}
          onSaved={(document, message) => {
            setSelected(document);
            setNotice(message);
            data.reload();
          }}
          token={token}
        />
      ) : null}
    </div>
  );
}

function FinanceSummaryCards({ summary }: { summary: FinanceSummary }) {
  return (
    <section aria-label="Finance summary" className="finance-summary">
      <FinanceMetric label="Open records" value={summary.activeDocuments.toString()} />
      <FinanceMetric label="Outstanding" value={formatMoney(summary.totalOutstanding)} />
      <FinanceMetric
        label="Overdue"
        tone="warning"
        value={formatMoney(summary.overdueOutstanding)}
      />
      <FinanceMetric label="Settled" value={summary.paidDocuments.toString()} />
    </section>
  );
}

function FinanceMetric({ label, tone, value }: { label: string; tone?: 'warning'; value: string }) {
  return (
    <div className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FinanceRegister({
  documents,
  onPreview,
}: {
  documents: FinanceCustomerDocument[];
  onPreview: (document: FinanceCustomerDocument) => void;
}) {
  const { locale } = useLocalization();
  const correctionCopy = collectionCorrectionsMessages(locale);
  if (!documents.length)
    return (
      <FinanceState title="No collection records yet">
        <p>
          Issue an invoice or proforma in Financial documents to add its balance here automatically.
        </p>
        <Link to="/modules/erp.finance/invoices">Financial documents</Link>
      </FinanceState>
    );

  return (
    <section aria-label="Customer collection register" className="finance-register">
      <div className="finance-register-head" role="row">
        <span>Collection record</span>
        <span>Due date</span>
        <span>Outstanding</span>
        <span>Status</span>
        <span aria-hidden="true" />
      </div>
      {documents.map((document) => (
        <article className="finance-register-row" key={document.id}>
          <div className="finance-record-identity">
            <span className="finance-document-mark">CL</span>
            <div>
              <strong>{document.number}</strong>
              <span>{document.customerName}</span>
              <small>From {document.sourceInvoiceNumber}</small>
            </div>
          </div>
          <div className="finance-register-date">
            <strong>{formatDate(document.dueDate)}</strong>
            <span>{dueLabel(document)}</span>
          </div>
          <div className="finance-register-value">
            <strong>{formatMoney(document.outstandingTotal, document.currencyCode)}</strong>
            <span>
              of {formatMoney(document.adjustedTotal ?? document.total, document.currencyCode)} ·{' '}
              {document.payments.length} {document.payments.length === 1 ? 'payment' : 'payments'}
            </span>
            {Number(document.overpaidTotal ?? '0') > 0 ? (
              <small className="finance-customer-credit">
                {correctionCopy.customerCredit}:{' '}
                {formatMoney(document.overpaidTotal!, document.currencyCode)}
              </small>
            ) : null}
          </div>
          <PaymentStatus status={document.paymentStatus} />
          <Button onClick={() => onPreview(document)} variant="quiet">
            Preview
          </Button>
        </article>
      ))}
    </section>
  );
}

function PaymentStatus({ status }: { status: FinanceCustomerDocument['paymentStatus'] }) {
  return <span className={`finance-status is-${status}`}>{paymentStatusLabel(status)}</span>;
}

function FinanceDocumentDrawer({
  canPrepareSales,
  onBack,
  onSaved,
  references,
  token,
}: {
  canPrepareSales: boolean;
  onBack: () => void;
  onSaved: (document: FinanceCustomerDocument) => void;
  references: FinanceReferenceData;
  token: string;
}) {
  useLocalization();
  const [salesInvoiceId, setSalesInvoiceId] = useState(references.invoiceDrafts[0]?.id ?? '');
  const [dueDate, setDueDate] = useState(daysFromToday(14));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = references.invoiceDrafts.find((invoice) => invoice.id === salesInvoiceId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateFinanceCustomerDocumentRequest = { dueDate, salesInvoiceId };
      onSaved(await createFinanceDocument(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The collection record could not be added.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FinanceDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Choose a prepared sales invoice draft"
      title="Add to collections"
    >
      <form className="finance-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {!references.invoiceDrafts.length ? (
          <InlineAlert tone="warning">
            <div className="finance-prerequisite">
              <div>
                <strong>{copy.noSalesDraftWaiting}</strong>
                <span>{copy.collectionAutomaticHint}</span>
              </div>
              <Link to="/modules/erp.finance/invoices">
                {copy.title} <Icon name="arrow" size={15} />
              </Link>
              {canPrepareSales ? (
                <Link to="/modules/erp.sales/quotations">
                  Prepare Sales invoice draft <Icon name="arrow" size={15} />
                </Link>
              ) : null}
            </div>
          </InlineAlert>
        ) : (
          <>
            <section className="finance-form-section">
              <header>
                <span>1</span>
                <div>
                  <h3>Sales invoice draft</h3>
                  <p>Each sales draft can be added only once.</p>
                </div>
              </header>
              <FinanceField label="Invoice draft">
                <select
                  onChange={(event) => setSalesInvoiceId(event.target.value)}
                  required
                  value={salesInvoiceId}
                >
                  {references.invoiceDrafts.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.number} · {invoice.customerName} ·{' '}
                      {formatMoney(invoice.total, invoice.currencyCode)}
                    </option>
                  ))}
                </select>
              </FinanceField>
              {selected ? (
                <div className="finance-source-card">
                  <span>Customer</span>
                  <strong>{selected.customerName}</strong>
                  <span>Collection amount</span>
                  <strong>{formatMoney(selected.total, selected.currencyCode)}</strong>
                </div>
              ) : null}
            </section>
            <section className="finance-form-section">
              <header>
                <span>2</span>
                <div>
                  <h3>Payment due date</h3>
                  <p>
                    Overdue status is applied automatically after this date if a balance remains.
                  </p>
                </div>
              </header>
              <FinanceField label="Due date">
                <input
                  onChange={(event) => setDueDate(event.target.value)}
                  required
                  type="date"
                  value={dueDate}
                />
              </FinanceField>
            </section>
          </>
        )}
        <div className="finance-drawer-actions">
          <Button busy={busy} disabled={!salesInvoiceId} type="submit">
            Add record
          </Button>
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
    </FinanceDrawer>
  );
}

function FinancePreviewDrawer({
  canApprove,
  canCreate,
  canEdit,
  document,
  onOpenSalesSource,
  onBack,
  onSaved,
  token,
}: {
  canApprove: boolean;
  canCreate: boolean;
  canEdit: boolean;
  document: FinanceCustomerDocument;
  onOpenSalesSource?: () => void;
  onBack: () => void;
  onSaved: (document: FinanceCustomerDocument, message: string) => void;
  token: string;
}) {
  const { locale } = useLocalization();
  const correctionCopy = collectionCorrectionsMessages(locale);
  const { navigate } = useRouter();
  const [mode, setMode] = useState<'details' | 'payment' | 'cancel' | 'reverse'>('details');
  const [paymentToReverse, setPaymentToReverse] = useState<FinancePayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canRecordPayment =
    canCreate &&
    document.reviewState === 'pending_finance_review' &&
    document.paymentStatus !== 'paid';
  const canCancel =
    canEdit &&
    document.financialDocument?.status !== 'issued' &&
    document.reviewState === 'pending_finance_review' &&
    document.payments.length === 0;

  if (mode === 'reverse' && paymentToReverse)
    return (
      <FinancePaymentReversalDrawer
        document={document}
        onBack={() => {
          setError(null);
          setPaymentToReverse(null);
          setMode('details');
        }}
        onSaved={(updated, payment) => {
          setPaymentToReverse(null);
          setMode('details');
          onSaved(
            updated,
            `${payment.number} was reversed. Reversal ${payment.reversal?.number ?? ''}.`.trim(),
          );
        }}
        payment={paymentToReverse}
        token={token}
      />
    );

  if (mode === 'payment')
    return (
      <FinancePaymentDrawer
        document={document}
        onBack={() => {
          setError(null);
          setMode('details');
        }}
        onSaved={(updated) => {
          setMode('details');
          onSaved(updated, `${updated.number} was updated with the payment.`);
        }}
        token={token}
      />
    );

  async function cancel() {
    const reason = cancellationReason.trim();
    if (!reason) {
      setError('Enter a reason before cancelling this record.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await cancelFinanceDocument(token, document.id, crypto.randomUUID(), {
        cancellationReason: reason,
        expectedVersion: document.version,
      });
      onSaved(updated, `${updated.number} was cancelled.`);
      setMode('details');
    } catch (caught) {
      setError(errorText(caught, 'The collection record could not be cancelled.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FinanceDrawer
      busy={busy}
      onBack={onBack}
      subtitle={document.customerName}
      title={document.number}
    >
      <div className="finance-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="finance-preview-hero">
          <div>
            <PaymentStatus status={document.paymentStatus} />
            <h3>{formatMoney(document.outstandingTotal, document.currencyCode)} remaining</h3>
            <p>
              Due {formatDate(document.dueDate)} · {dueLabel(document)}
            </p>
          </div>
          {canRecordPayment ? (
            <Button onClick={() => setMode('payment')}>
              <Icon name="plus" size={16} /> Record payment
            </Button>
          ) : null}
        </section>

        <section className="finance-preview-section">
          <header>
            <div>
              <h3>Balance</h3>
              <p>{copy.collectionCurrency(document.currencyCode)}</p>
            </div>
          </header>
          <dl className="finance-balance-grid">
            <div>
              <dt>{document.corrections?.length ? correctionCopy.original : 'Total'}</dt>
              <dd>{formatMoney(document.total, document.currencyCode)}</dd>
            </div>
            <div>
              <dt>Allocated</dt>
              <dd>{formatMoney(document.allocatedTotal, document.currencyCode)}</dd>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>{formatMoney(document.outstandingTotal, document.currencyCode)}</dd>
            </div>
          </dl>
          {document.corrections?.length ? (
            <dl className="finance-balance-grid finance-correction-totals">
              <div>
                <dt>{correctionCopy.credits}</dt>
                <dd>{formatMoney(document.creditTotal ?? '0', document.currencyCode)}</dd>
              </div>
              <div>
                <dt>{correctionCopy.debits}</dt>
                <dd>{formatMoney(document.debitTotal ?? '0', document.currencyCode)}</dd>
              </div>
              <div>
                <dt>{correctionCopy.adjusted}</dt>
                <dd>
                  {formatMoney(document.adjustedTotal ?? document.total, document.currencyCode)}
                </dd>
              </div>
            </dl>
          ) : null}
          {Number(document.overpaidTotal ?? '0') > 0 ? (
            <InlineAlert tone="warning">
              <strong>
                {correctionCopy.customerCredit}:{' '}
                {formatMoney(document.overpaidTotal!, document.currencyCode)}
              </strong>
              <p>{correctionCopy.overpaidHelp}</p>
            </InlineAlert>
          ) : null}
        </section>

        {document.corrections?.length ? (
          <section className="finance-preview-section">
            <header>
              <h3>{correctionCopy.corrections}</h3>
            </header>
            <div className="finance-correction-list">
              {document.corrections.map((note) => (
                <article key={note.id}>
                  <div>
                    <strong>{note.number}</strong>
                    <small>
                      {note.documentType === 'credit_note'
                        ? correctionCopy.creditNote
                        : correctionCopy.debitNote}{' '}
                      · {formatDate(note.documentDate)}
                    </small>
                    <p>{note.reason}</p>
                  </div>
                  <strong>
                    {note.documentType === 'credit_note' ? '−' : '+'}
                    {formatMoney(note.amount, document.currencyCode)}
                  </strong>
                  <Button
                    variant="quiet"
                    onClick={() =>
                      navigate('/modules/erp.finance/invoices', {
                        state: { financialDocumentId: note.documentId },
                      })
                    }
                  >
                    {correctionCopy.openNote}
                  </Button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="finance-preview-section">
          <header>
            <div>
              <h3>Source</h3>
              <p>
                {document.financialDocument
                  ? copy.collectionSource
                  : 'The collection record is linked to the prepared sales invoice draft.'}
              </p>
            </div>
          </header>
          <div className="finance-source-row">
            <span className="finance-document-mark">{document.financialDocument ? 'FI' : 'S'}</span>
            <div>
              <strong>{document.sourceInvoiceNumber}</strong>
              <span>Added to collections {formatDate(document.documentDate)}</span>
            </div>
            <strong>{formatMoney(document.total, document.currencyCode)}</strong>
          </div>
          {document.financialDocument ? (
            <Button
              className="finance-source-open"
              variant="quiet"
              onClick={() =>
                navigate('/modules/erp.finance/invoices', {
                  state: { financialDocumentId: document.financialDocument!.id },
                })
              }
            >
              {copy.openFinancialDocument}
            </Button>
          ) : null}
          {onOpenSalesSource ? (
            <Button className="finance-source-open" onClick={onOpenSalesSource} variant="quiet">
              Open in Sales
            </Button>
          ) : null}
        </section>

        <section className="finance-preview-section">
          <header>
            <div>
              <h3>Payments</h3>
              <p>Every entry is allocated to this record.</p>
            </div>
            <span>{document.payments.length}</span>
          </header>
          {document.payments.length ? (
            <div className="finance-payment-list">
              {document.payments.map((payment) => (
                <div key={payment.id}>
                  <div>
                    <strong>{payment.number}</strong>
                    <span>
                      {paymentMethodLabel(payment.paymentMethod)} ·{' '}
                      {formatDate(payment.paymentDate)}
                    </span>
                    {payment.paymentReference ? (
                      <small>Ref. {payment.paymentReference}</small>
                    ) : null}
                    {payment.sourceCustomerAdvanceNumber ? (
                      <small>Advance from {payment.sourceCustomerAdvanceNumber}</small>
                    ) : null}
                    {payment.reversal ? (
                      <small>
                        Reversed by {payment.reversal.number} on{' '}
                        {formatDate(payment.reversal.reversedOn)}
                      </small>
                    ) : null}
                    {payment.reversal ? <small>{payment.reversal.reason}</small> : null}
                  </div>
                  <strong>{formatMoney(payment.amount, document.currencyCode)}</strong>
                  {canApprove && !payment.reversal ? (
                    <Button
                      onClick={() => {
                        setPaymentToReverse(payment);
                        setMode('reverse');
                      }}
                      variant="quiet"
                    >
                      Reverse payment
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="finance-empty-inline">No payments have been recorded.</p>
          )}
        </section>

        <section className="finance-preview-section">
          <header>
            <div>
              <h3>Record history</h3>
              <p>Status changes are preserved with the record.</p>
            </div>
          </header>
          <ol className="finance-history">
            {document.statusHistory.map((entry) => (
              <li key={entry.id}>
                <span />
                <div>
                  <strong>{paymentStatusLabel(entry.nextStatus)}</strong>
                  <p>
                    {entry.reason === 'financial_correction_issued'
                      ? correctionCopy.history
                      : entry.reason === 'correction_migration'
                        ? correctionCopy.migratedHistory
                        : historyLabel(entry.reason)}
                  </p>
                  <small>
                    {formatDateTime(entry.changedAt)}
                    {entry.changedByName ? ` · ${entry.changedByName}` : ''}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {canCancel ? (
          <section className="finance-cancel-section">
            {mode === 'cancel' ? (
              <>
                <h3>Cancel this collection record?</h3>
                <p>
                  This keeps the record and its history but prevents future payments against it.
                </p>
                <FinanceField label="Reason for cancellation">
                  <textarea
                    autoFocus
                    maxLength={1000}
                    onChange={(event) => setCancellationReason(event.target.value)}
                    rows={3}
                    value={cancellationReason}
                  />
                </FinanceField>
                <div className="finance-confirm-actions">
                  <Button busy={busy} onClick={() => void cancel()} variant="danger">
                    Confirm cancellation
                  </Button>
                  <Button disabled={busy} onClick={() => setMode('details')} variant="secondary">
                    Keep record
                  </Button>
                </div>
              </>
            ) : (
              <Button onClick={() => setMode('cancel')} variant="quiet">
                Cancel record
              </Button>
            )}
          </section>
        ) : null}
      </div>
    </FinanceDrawer>
  );
}

function FinancePaymentDrawer({
  document,
  onBack,
  onSaved,
  token,
}: {
  document: FinanceCustomerDocument;
  onBack: () => void;
  onSaved: (document: FinanceCustomerDocument) => void;
  token: string;
}) {
  useLocalization();
  const [amount, setAmount] = useState(document.outstandingTotal);
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState<FinancePaymentMethod>('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateFinancePaymentRequest = {
        amount,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        paymentDate,
        paymentMethod,
        ...(paymentReference.trim() ? { paymentReference: paymentReference.trim() } : {}),
      };
      onSaved(await recordFinancePayment(token, document.id, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The payment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FinanceDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${document.number} · ${formatMoney(document.outstandingTotal, document.currencyCode)} remaining`}
      title="Record payment"
    >
      <form className="finance-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="finance-form-section">
          <header>
            <span>1</span>
            <div>
              <h3>Payment details</h3>
              <p>The amount cannot be more than the remaining balance.</p>
            </div>
          </header>
          <div className="finance-form-grid">
            <FinanceField label={copy.paymentAmount(document.currencyCode)}>
              <input
                max={document.outstandingTotal}
                min="0.0001"
                onChange={(event) => setAmount(event.target.value)}
                required
                step="0.0001"
                type="number"
                value={amount}
              />
            </FinanceField>
            <FinanceField label="Payment date">
              <input
                onChange={(event) => setPaymentDate(event.target.value)}
                required
                type="date"
                value={paymentDate}
              />
            </FinanceField>
            <FinanceField label="Method">
              <select
                onChange={(event) => setPaymentMethod(event.target.value as FinancePaymentMethod)}
                value={paymentMethod}
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {paymentMethodLabel(method)}
                  </option>
                ))}
              </select>
            </FinanceField>
            <FinanceField label="Reference (optional)">
              <input
                maxLength={255}
                onChange={(event) => setPaymentReference(event.target.value)}
                value={paymentReference}
              />
            </FinanceField>
          </div>
        </section>
        <section className="finance-form-section">
          <header>
            <span>2</span>
            <div>
              <h3>Note</h3>
              <p>Add a note if needed.</p>
            </div>
          </header>
          <FinanceField label="Payment note (optional)">
            <textarea
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              value={notes}
            />
          </FinanceField>
        </section>
        <div className="finance-drawer-actions">
          <Button busy={busy} type="submit">
            Record payment
          </Button>
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Back
          </Button>
        </div>
      </form>
    </FinanceDrawer>
  );
}

function FinancePaymentReversalDrawer({
  document,
  onBack,
  onSaved,
  payment,
  token,
}: {
  document: FinanceCustomerDocument;
  onBack: () => void;
  onSaved: (document: FinanceCustomerDocument, payment: FinancePayment) => void;
  payment: FinancePayment;
  token: string;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10) {
      setError('Enter a clear reason with at least 10 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await reverseFinancePayment(
        token,
        document.id,
        payment.id,
        crypto.randomUUID(),
        { expectedDocumentVersion: document.version, reason: normalizedReason },
      );
      const reversed = updated.payments.find((item) => item.id === payment.id);
      if (!reversed?.reversal) throw new Error('The payment reversal was not returned.');
      onSaved(updated, reversed);
    } catch (caught) {
      setError(errorText(caught, 'The payment could not be reversed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FinanceDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${payment.number} · ${formatMoney(payment.amount, document.currencyCode)}`}
      title="Reverse payment"
    >
      <form className="finance-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <InlineAlert tone="warning">
          This records a linked correction. The original payment and its allocation remain in the
          history. The outstanding balance will increase by the payment amount.
        </InlineAlert>
        <section className="finance-form-section">
          <header>
            <span>1</span>
            <div>
              <h3>Confirm the correction</h3>
              <p>
                {document.number} · {payment.number} ·{' '}
                {formatMoney(payment.amount, document.currencyCode)}
              </p>
            </div>
          </header>
          <FinanceField label="Reason for reversal">
            <textarea
              autoFocus
              maxLength={1000}
              minLength={10}
              onChange={(event) => setReason(event.target.value)}
              required
              rows={4}
              value={reason}
            />
          </FinanceField>
        </section>
        <div className="finance-drawer-actions">
          <Button busy={busy} type="submit" variant="danger">
            Reverse payment
          </Button>
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Back
          </Button>
        </div>
      </form>
    </FinanceDrawer>
  );
}

function FinanceDrawer({
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
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label="Back to finance list"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide finance-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header finance-drawer-header">
          <button
            aria-label="Back to finance list"
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

function FinanceField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="finance-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function FinanceState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <section className="finance-state">
      <Icon name="finance" size={24} />
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function useFinanceData(token: string) {
  const [documents, setDocuments] = useState<FinanceCustomerDocument[]>([]);
  const [references, setReferences] = useState<FinanceReferenceData>(emptyReferences);
  const [summary, setSummary] = useState<FinanceSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([
      listFinanceDocuments(token),
      getFinanceReferenceData(token),
      getFinanceSummary(token),
    ])
      .then(([nextDocuments, nextReferences, nextSummary]) => {
        if (!active) return;
        setDocuments(nextDocuments);
        setReferences(nextReferences);
        setSummary(nextSummary);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [revision, token]);

  return useMemo(
    () => ({ documents, error, loading, references, reload, summary }),
    [documents, error, loading, references, reload, summary],
  );
}

const paymentMethods: FinancePaymentMethod[] = [
  'cash',
  'bank_transfer',
  'pos_terminal',
  'card',
  'offset',
];

function paymentMethodLabel(method: FinancePaymentMethod) {
  return {
    bank_transfer: 'Bank transfer',
    card: 'Card payment',
    cash: 'Cash',
    offset: 'Compensation / offset',
    pos_terminal: 'POS terminal',
  }[method];
}

function paymentStatusLabel(status: FinanceCustomerDocument['paymentStatus']) {
  return {
    cancelled: 'Cancelled',
    overdue: 'Overdue',
    paid: 'Paid',
    partially_paid: 'Partially paid',
    unpaid: 'Unpaid',
  }[status];
}

function historyLabel(reason: string) {
  return (
    {
      document_cancelled: 'Collection record cancelled',
      document_imported: 'Added from a sales invoice draft',
      financial_document_issued: 'Added from an issued financial document',
      payment_recorded: 'Payment allocated',
      scheduled_due_date_check: 'Due date passed with a remaining balance',
    }[reason] ?? 'Status updated'
  );
}

function dueLabel(document: FinanceCustomerDocument) {
  if (document.paymentStatus === 'paid') return 'Settled';
  if (document.paymentStatus === 'cancelled') return 'Cancelled';
  if (document.paymentStatus === 'overdue') return 'Past due';
  return 'Payment due';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromToday(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return formatOperationsDate(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium' });
}

function formatDateTime(value: string) {
  return formatOperationsDate(new Date(value), { dateStyle: 'medium', timeStyle: 'short' });
}

function formatMoney(value: string, currencyCode = 'EUR') {
  return formatOperationsCurrency(value, currencyCode);
}

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}
