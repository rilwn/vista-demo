import { Button, InlineAlert } from '@vista/ui';
import type {
  CreateFinanceCashVoucherRequest,
  FinanceCashDailyReport,
  FinanceCashReferenceData,
  FinanceCashVoucher,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  cancelFinanceCashVoucher,
  createFinanceCashVoucher,
  getFinanceCashDailyReport,
  getFinanceCashReferenceData,
  getFinanceCashVoucher,
  listFinanceCashVouchers,
} from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';
import { FinanceTabs } from './FinanceBankPage';

const emptyReferences: FinanceCashReferenceData = {
  businessDate: '',
  cashRegisters: [],
  openCollections: [],
  partners: [],
};

export function FinanceCashPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useCashData(token);
  const [view, setView] = useState<'vouchers' | 'report'>('vouchers');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FinanceCashVoucher | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reportRegisterId, setReportRegisterId] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [report, setReport] = useState<FinanceCashDailyReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (!data.references.cashRegisters.length) return;
    setReportRegisterId((current) => current || data.references.cashRegisters[0]!.id);
    setReportDate((current) => current || data.references.businessDate);
  }, [data.references]);

  const loadReport = useCallback(async () => {
    if (!reportRegisterId || !reportDate) return;
    setReportLoading(true);
    setReportError(null);
    try {
      setReport(await getFinanceCashDailyReport(token, reportRegisterId, reportDate));
    } catch (error) {
      setReportError(message(error, 'The daily cash report could not be loaded.'));
    } finally {
      setReportLoading(false);
    }
  }, [reportDate, reportRegisterId, token]);

  useEffect(() => {
    void loadReport();
  }, [loadReport, data.revision]);

  async function preview(id: string) {
    try {
      setSelected(await getFinanceCashVoucher(token, id));
    } catch (error) {
      setNotice(message(error, 'The cash voucher could not be opened.'));
    }
  }

  if (data.loading) return <CashState title="Loading cash operations" />;
  if (data.error)
    return (
      <CashState title="Cash operations could not be loaded">
        <Button onClick={() => void data.reload()} variant="secondary">
          Try again
        </Button>
      </CashState>
    );

  return (
    <div className="page-stack cash-workspace">
      <header className="page-header cash-workspace-header">
        <div>
          <p className="page-eyebrow">ERP · Finance</p>
          <h1>Cash operations</h1>
          <p>Issue cash receipt and payment vouchers and review each register's daily movement.</p>
        </div>
        {hasPermission('erp.finance', 'create') && data.references.cashRegisters.length ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={17} /> New cash voucher
          </Button>
        ) : null}
      </header>

      <FinanceTabs />

      {notice ? (
        <InlineAlert tone={notice.includes('could not') ? 'error' : 'success'}>
          <div className="cash-notice">
            <span>{notice}</span>
            <button aria-label="Dismiss message" onClick={() => setNotice(null)} type="button">
              Close
            </button>
          </div>
        </InlineAlert>
      ) : null}

      {!data.references.cashRegisters.length ? (
        <section className="cash-setup-state">
          <span className="cash-state-icon">
            <Icon name="finance" size={22} />
          </span>
          <div>
            <h2>Set up a cash register and operator</h2>
            <p>
              Cash vouchers require an active cash register with at least one assigned operator.
            </p>
          </div>
          {hasPermission('platform.organization', 'create') ? (
            <Link className="vista-button vista-button--secondary" to="/organization">
              Open business structure
            </Link>
          ) : null}
        </section>
      ) : (
        <>
          <div aria-label="Cash operation views" className="cash-view-switch">
            <button
              className={view === 'vouchers' ? 'is-active' : undefined}
              onClick={() => setView('vouchers')}
              type="button"
            >
              Voucher register
            </button>
            <button
              className={view === 'report' ? 'is-active' : undefined}
              onClick={() => setView('report')}
              type="button"
            >
              Daily cash report
            </button>
          </div>

          {view === 'vouchers' ? (
            <CashVoucherRegister
              onPreview={(voucher) => void preview(voucher.id)}
              vouchers={data.vouchers}
            />
          ) : (
            <CashDailyReportView
              date={reportDate}
              error={reportError}
              loading={reportLoading}
              onDateChange={setReportDate}
              onRegisterChange={setReportRegisterId}
              references={data.references}
              registerId={reportRegisterId}
              report={report}
            />
          )}
        </>
      )}

      {creating ? (
        <CreateCashVoucherDrawer
          onBack={() => setCreating(false)}
          onSaved={(voucher) => {
            setCreating(false);
            setSelected(voucher);
            setNotice(`${voucher.number} was issued.`);
            void data.reload();
          }}
          references={data.references}
          token={token}
        />
      ) : null}

      {selected ? (
        <CashVoucherDrawer
          canCancel={hasPermission('erp.finance', 'edit')}
          onBack={() => setSelected(null)}
          onSaved={(voucher) => {
            setSelected(voucher);
            setNotice(`${voucher.number} was cancelled.`);
            void data.reload();
          }}
          token={token}
          voucher={selected}
        />
      ) : null}
    </div>
  );
}

function CashVoucherRegister({
  onPreview,
  vouchers,
}: {
  onPreview: (voucher: FinanceCashVoucher) => void;
  vouchers: FinanceCashVoucher[];
}) {
  if (!vouchers.length)
    return (
      <section className="cash-empty-state">
        <span className="cash-state-icon">
          <Icon name="finance" size={22} />
        </span>
        <div>
          <h2>No cash vouchers yet</h2>
          <p>Issue the first receipt or payment voucher to begin the register.</p>
        </div>
      </section>
    );
  return (
    <section aria-label="Cash voucher register" className="cash-register">
      <div aria-hidden="true" className="cash-register-head">
        <span>Voucher</span>
        <span>Counterparty</span>
        <span>Register &amp; operator</span>
        <span>Amount</span>
        <span />
      </div>
      {vouchers.map((voucher) => (
        <article className="cash-register-row" key={voucher.id}>
          <div className="cash-voucher-identity">
            <span className={`is-${voucher.direction}`}>
              {voucher.direction === 'receipt' ? '+' : '−'}
            </span>
            <div>
              <strong>{voucher.number}</strong>
              <span>{voucher.direction === 'receipt' ? 'Cash receipt' : 'Cash payment'}</span>
              <small>{formatDate(voucher.voucherDate)}</small>
            </div>
          </div>
          <div className="cash-register-detail">
            <strong>{voucher.counterpartyName}</strong>
            <span>{voucher.purpose}</span>
            {voucher.collectionNumber ? <small>Collection {voucher.collectionNumber}</small> : null}
          </div>
          <div className="cash-register-detail">
            <strong>{voucher.cashRegisterName}</strong>
            <span>{voucher.operatorName}</span>
            <small>{voucher.businessLocationName}</small>
          </div>
          <div className="cash-register-amount">
            <strong className={`is-${voucher.direction}`}>
              {voucher.direction === 'receipt' ? '+' : '−'}
              {formatMoney(voucher.amount)}
            </strong>
            <span className={`cash-status is-${voucher.status}`}>
              {voucher.status === 'issued' ? 'Issued' : 'Cancelled'}
            </span>
          </div>
          <Button onClick={() => onPreview(voucher)} variant="quiet">
            Preview
          </Button>
        </article>
      ))}
    </section>
  );
}

function CashDailyReportView({
  date,
  error,
  loading,
  onDateChange,
  onRegisterChange,
  references,
  registerId,
  report,
}: {
  date: string;
  error: string | null;
  loading: boolean;
  onDateChange: (value: string) => void;
  onRegisterChange: (value: string) => void;
  references: FinanceCashReferenceData;
  registerId: string;
  report: FinanceCashDailyReport | null;
}) {
  return (
    <div className="cash-report-workspace">
      <section className="cash-report-controls">
        <label>
          <span>Cash register</span>
          <select onChange={(event) => onRegisterChange(event.target.value)} value={registerId}>
            {references.cashRegisters.map((register) => (
              <option key={register.id} value={register.id}>
                {register.name} · {register.businessLocationName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Report date</span>
          <input
            max={references.businessDate}
            onChange={(event) => onDateChange(event.target.value)}
            type="date"
            value={date}
          />
        </label>
        <p>Cancelled vouchers remain visible but are excluded from cash totals.</p>
      </section>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {loading ? (
        <CashState title="Preparing daily cash report" />
      ) : report ? (
        <>
          <section aria-label="Daily cash totals" className="cash-report-summary">
            <CashMetric label="Opening balance" value={formatMoney(report.openingBalance)} />
            <CashMetric
              label={`${report.receiptCount} receipt${report.receiptCount === 1 ? '' : 's'}`}
              tone="positive"
              value={formatMoney(report.receiptTotal)}
            />
            <CashMetric
              label={`${report.paymentCount} payment${report.paymentCount === 1 ? '' : 's'}`}
              tone="negative"
              value={formatMoney(report.paymentTotal)}
            />
            <CashMetric label="Closing balance" value={formatMoney(report.closingBalance)} />
          </section>
          <section className="cash-report-sheet">
            <header>
              <div>
                <p>Daily cash report</p>
                <h2>{report.cashRegisterName}</h2>
                <span>
                  {report.cashRegisterCode} · {formatDate(report.reportDate)}
                </span>
              </div>
              <small>Prepared {formatDateTime(report.generatedAt)}</small>
            </header>
            {report.vouchers.length ? (
              <div className="cash-report-lines">
                {report.vouchers.map((voucher) => (
                  <div
                    className={voucher.status === 'cancelled' ? 'is-cancelled' : undefined}
                    key={voucher.id}
                  >
                    <span>{voucher.number}</span>
                    <div>
                      <strong>{voucher.counterpartyName}</strong>
                      <small>{voucher.purpose}</small>
                    </div>
                    <span>{voucher.operatorName}</span>
                    <strong>
                      {voucher.direction === 'receipt' ? '+' : '−'}
                      {formatMoney(voucher.amount)}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="cash-report-empty">No cash movement was recorded for this date.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function CreateCashVoucherDrawer({
  onBack,
  onSaved,
  references,
  token,
}: {
  onBack: () => void;
  onSaved: (voucher: FinanceCashVoucher) => void;
  references: FinanceCashReferenceData;
  token: string;
}) {
  const firstRegister = references.cashRegisters[0]!;
  const [direction, setDirection] = useState<'receipt' | 'payment'>('receipt');
  const [cashRegisterId, setCashRegisterId] = useState(firstRegister.id);
  const register =
    references.cashRegisters.find((item) => item.id === cashRegisterId) ?? firstRegister;
  const [operatorId, setOperatorId] = useState(register.operators[0]?.id ?? '');
  const [voucherDate, setVoucherDate] = useState(references.businessDate);
  const [customerDocumentId, setCustomerDocumentId] = useState('');
  const collection = references.openCollections.find((item) => item.id === customerDocumentId);
  const [counterpartyPartnerId, setCounterpartyPartnerId] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeRegister(id: string) {
    setCashRegisterId(id);
    const selected = references.cashRegisters.find((item) => item.id === id);
    setOperatorId(selected?.operators[0]?.id ?? '');
  }

  function changeDirection(next: 'receipt' | 'payment') {
    setDirection(next);
    if (next === 'payment') setCustomerDocumentId('');
  }

  function changeCollection(id: string) {
    setCustomerDocumentId(id);
    const selected = references.openCollections.find((item) => item.id === id);
    if (selected) {
      setCounterpartyPartnerId(selected.customerPartnerId);
      setCounterpartyName('');
      setAmount(selected.outstandingTotal);
      setPaymentReference(`Cash payment for ${selected.number}`);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const input: CreateFinanceCashVoucherRequest = {
      amount,
      cashRegisterId,
      ...(counterpartyName.trim() ? { counterpartyName: counterpartyName.trim() } : {}),
      ...(counterpartyPartnerId ? { counterpartyPartnerId } : {}),
      ...(customerDocumentId ? { customerDocumentId } : {}),
      direction,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      operatorId,
      ...(paymentReference.trim() ? { paymentReference: paymentReference.trim() } : {}),
      purpose,
      voucherDate,
    };
    try {
      onSaved(await createFinanceCashVoucher(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(message(caught, 'The cash voucher could not be issued.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CashDrawer busy={busy} onBack={onBack} subtitle="Cash operations" title="New cash voucher">
      <form className="cash-voucher-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <fieldset className="cash-direction-choice">
          <legend>Voucher type</legend>
          <label className={direction === 'receipt' ? 'is-selected' : undefined}>
            <input
              checked={direction === 'receipt'}
              name="direction"
              onChange={() => changeDirection('receipt')}
              type="radio"
            />
            <span>+</span>
            <div>
              <strong>Cash receipt</strong>
              <small>Money received into the register</small>
            </div>
          </label>
          <label className={direction === 'payment' ? 'is-selected' : undefined}>
            <input
              checked={direction === 'payment'}
              name="direction"
              onChange={() => changeDirection('payment')}
              type="radio"
            />
            <span>−</span>
            <div>
              <strong>Cash payment</strong>
              <small>Money paid out of the register</small>
            </div>
          </label>
        </fieldset>

        <section className="cash-form-section">
          <header>
            <span>1</span>
            <div>
              <h3>Register and operator</h3>
              <p>The voucher number follows this operating scope.</p>
            </div>
          </header>
          <div className="cash-form-grid">
            <label>
              <span>Cash register</span>
              <select
                onChange={(event) => changeRegister(event.target.value)}
                value={cashRegisterId}
              >
                {references.cashRegisters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.businessLocationName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Operator</span>
              <select
                onChange={(event) => setOperatorId(event.target.value)}
                required
                value={operatorId}
              >
                {register.operators.map((operator) => (
                  <option key={operator.id} value={operator.id}>
                    {operator.name} · {operator.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Voucher date</span>
              <input
                max={references.businessDate}
                onChange={(event) => setVoucherDate(event.target.value)}
                required
                type="date"
                value={voucherDate}
              />
            </label>
            <label>
              <span>Currency</span>
              <input disabled value="BGN" />
            </label>
          </div>
        </section>

        <section className="cash-form-section">
          <header>
            <span>2</span>
            <div>
              <h3>Counterparty and amount</h3>
              <p>Link a receipt to a collection or record the cash movement independently.</p>
            </div>
          </header>
          <div className="cash-form-grid">
            {direction === 'receipt' ? (
              <label className="is-wide">
                <span>Customer collection (optional)</span>
                <select
                  onChange={(event) => changeCollection(event.target.value)}
                  value={customerDocumentId}
                >
                  <option value="">Independent cash receipt</option>
                  {references.openCollections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.number} · {item.customerName} · {formatMoney(item.outstandingTotal)}{' '}
                      remaining
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="is-wide">
              <span>Known partner (optional)</span>
              <select
                disabled={Boolean(collection)}
                onChange={(event) => {
                  setCounterpartyPartnerId(event.target.value);
                  if (event.target.value) setCounterpartyName('');
                }}
                value={collection?.customerPartnerId ?? counterpartyPartnerId}
              >
                <option value="">Enter another counterparty</option>
                {references.partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name} · {partner.roles.join(' / ')}
                  </option>
                ))}
              </select>
            </label>
            {!counterpartyPartnerId && !collection ? (
              <label className="is-wide">
                <span>Counterparty name</span>
                <input
                  maxLength={255}
                  onChange={(event) => setCounterpartyName(event.target.value)}
                  placeholder="Person or organization"
                  required
                  value={counterpartyName}
                />
              </label>
            ) : null}
            <label>
              <span>Amount</span>
              <input
                inputMode="decimal"
                min="0.0001"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                required
                step="0.0001"
                value={amount}
              />
              {collection ? (
                <small>Maximum {formatMoney(collection.outstandingTotal)}</small>
              ) : null}
            </label>
            <label className="is-wide">
              <span>Reason</span>
              <input
                maxLength={500}
                onChange={(event) => setPurpose(event.target.value)}
                placeholder={direction === 'receipt' ? 'Customer cash payment' : 'Office expense'}
                required
                value={purpose}
              />
            </label>
          </div>
        </section>

        <section className="cash-form-section">
          <header>
            <span>3</span>
            <div>
              <h3>Supporting detail</h3>
              <p>Use the reference and notes to make later review easier.</p>
            </div>
          </header>
          <div className="cash-form-grid">
            <label className="is-wide">
              <span>Payment reference (optional)</span>
              <input
                maxLength={255}
                onChange={(event) => setPaymentReference(event.target.value)}
                value={paymentReference}
              />
            </label>
            <label className="is-wide">
              <span>Notes (optional)</span>
              <textarea
                maxLength={2000}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                value={notes}
              />
            </label>
          </div>
        </section>

        <div className="cash-drawer-actions">
          <Button busy={busy} type="submit">
            Issue voucher
          </Button>
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
    </CashDrawer>
  );
}

function CashVoucherDrawer({
  canCancel,
  onBack,
  onSaved,
  token,
  voucher,
}: {
  canCancel: boolean;
  onBack: () => void;
  onSaved: (voucher: FinanceCashVoucher) => void;
  token: string;
  voucher: FinanceCashVoucher;
}) {
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await cancelFinanceCashVoucher(token, voucher.id, crypto.randomUUID(), {
          cancellationReason: reason,
          expectedVersion: voucher.version,
        }),
      );
      setShowCancel(false);
    } catch (caught) {
      setError(message(caught, 'The cash voucher could not be cancelled.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <CashDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${voucher.direction === 'receipt' ? 'Cash receipt' : 'Cash payment'} · ${formatDate(voucher.voucherDate)}`}
      title={voucher.number}
    >
      <div className="cash-voucher-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className={`cash-preview-hero is-${voucher.direction}`}>
          <div>
            <span className={`cash-status is-${voucher.status}`}>
              {voucher.status === 'issued' ? 'Issued' : 'Cancelled'}
            </span>
            <h2>
              {voucher.direction === 'receipt' ? '+' : '−'}
              {formatMoney(voucher.amount)}
            </h2>
            <p>{voucher.counterpartyName}</p>
          </div>
          <span>{voucher.direction === 'receipt' ? 'Receipt' : 'Payment'}</span>
        </section>
        <section className="cash-preview-section">
          <header>
            <h3>Voucher detail</h3>
          </header>
          <dl className="cash-preview-grid">
            <div>
              <dt>Reason</dt>
              <dd>{voucher.purpose}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{formatDate(voucher.voucherDate)}</dd>
            </div>
            <div>
              <dt>Cash register</dt>
              <dd>{voucher.cashRegisterName}</dd>
            </div>
            <div>
              <dt>Operator</dt>
              <dd>{voucher.operatorName}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{voucher.businessLocationName}</dd>
            </div>
            <div>
              <dt>Issued by</dt>
              <dd>{voucher.issuedByName}</dd>
            </div>
          </dl>
        </section>
        {voucher.collectionNumber || voucher.paymentNumber || voucher.paymentReference ? (
          <section className="cash-preview-section">
            <header>
              <h3>Linked records</h3>
            </header>
            <dl className="cash-preview-grid">
              {voucher.collectionNumber ? (
                <div>
                  <dt>Customer collection</dt>
                  <dd>{voucher.collectionNumber}</dd>
                </div>
              ) : null}
              {voucher.paymentNumber ? (
                <div>
                  <dt>Payment record</dt>
                  <dd>{voucher.paymentNumber}</dd>
                </div>
              ) : null}
              {voucher.paymentReference ? (
                <div>
                  <dt>Payment reference</dt>
                  <dd>{voucher.paymentReference}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}
        {voucher.notes ? (
          <section className="cash-preview-note">
            <span>Notes</span>
            <p>{voucher.notes}</p>
          </section>
        ) : null}
        {voucher.status === 'cancelled' ? (
          <InlineAlert tone="warning">
            Cancelled {voucher.cancelledAt ? formatDateTime(voucher.cancelledAt) : ''} ·{' '}
            {voucher.cancellationReason}
          </InlineAlert>
        ) : null}
        {voucher.customerDocumentId ? (
          <InlineAlert tone="info">
            This receipt updated a customer collection and cannot be cancelled without a payment
            reversal.
          </InlineAlert>
        ) : null}
        {showCancel ? (
          <section className="cash-cancel-form">
            <label>
              <span>Cancellation reason</span>
              <textarea
                autoFocus
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                value={reason}
              />
            </label>
            <div>
              <Button
                busy={busy}
                disabled={!reason.trim()}
                onClick={() => void cancel()}
                variant="danger"
              >
                Confirm cancellation
              </Button>
              <Button disabled={busy} onClick={() => setShowCancel(false)} variant="secondary">
                Keep voucher
              </Button>
            </div>
          </section>
        ) : null}
        {canCancel && voucher.status === 'issued' && !voucher.customerDocumentId && !showCancel ? (
          <div className="cash-drawer-actions">
            <Button onClick={() => setShowCancel(true)} variant="danger">
              Cancel voucher
            </Button>
          </div>
        ) : null}
      </div>
    </CashDrawer>
  );
}

function CashDrawer({
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
    <div className="security-drawer-layer">
      <button
        aria-label="Back to cash operations"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-labelledby="cash-drawer-title"
        aria-modal="true"
        className="security-drawer is-wide cash-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header cash-drawer-header">
          <button
            aria-label="Back"
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
            <h2 id="cash-drawer-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
        </header>
        <div className="security-drawer-body cash-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function CashMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: 'negative' | 'positive';
  value: string;
}) {
  return (
    <div className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CashState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <section className="cash-state">
      <span className="cash-state-icon">
        <Icon name="finance" size={22} />
      </span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function useCashData(token: string) {
  const [references, setReferences] = useState(emptyReferences);
  const [vouchers, setVouchers] = useState<FinanceCashVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [nextReferences, page] = await Promise.all([
        getFinanceCashReferenceData(token),
        listFinanceCashVouchers(token),
      ]);
      setReferences(nextReferences);
      setVouchers(page.items);
      setRevision((current) => current + 1);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return useMemo(
    () => ({ error, loading, references, reload, revision, vouchers }),
    [error, loading, references, reload, revision, vouchers],
  );
}

function message(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? (error.details[0]?.message ?? error.message) : fallback;
}

function formatMoney(value: string) {
  return new Intl.NumberFormat('en-GB', { currency: 'BGN', style: 'currency' }).format(
    Number(value),
  );
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
