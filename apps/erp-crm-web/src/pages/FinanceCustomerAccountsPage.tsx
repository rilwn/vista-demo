import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateCustomerAdvanceRequest,
  ApplyCustomerAdvanceToPosSaleRequest,
  CustomerAdvancePaymentMethod,
  CustomerOpenReceivable,
  CustomerPaymentAccount,
  CustomerPaymentAccountReferenceData,
  UpsertCustomerPaymentTermsRequest,
  PosAccountReceivable,
  PosAccountPayment,
  PosAccountReturnCredit,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  allocateCustomerAdvance,
  applyCustomerAdvanceToPosSale,
  createCustomerAdvance,
  getCustomerPaymentAccount,
  getCustomerPaymentAccountReferenceData,
  listCustomerPaymentAccounts,
  updateCustomerPaymentTerms,
} from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import {
  formatOperationsDate,
  formatOperationsMinorCurrency,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { FinanceTabs } from './FinanceBankPage';
import { useRouter } from '../routing/Router';
import { PosAccountBalances, PosAccountPaymentPanel } from './PosAccountBalances';
import { PosAccountRefundPanel } from './PosAccountRefundPanel';
import { FinancePaymentStatusRegister } from './FinancePaymentStatusRegister';
import { posAccountMessages } from './pos-account.messages';

type Panel =
  | {
      account: CustomerPaymentAccount;
      mode: 'pos-refund';
      sale: PosAccountReceivable;
      credit: PosAccountReturnCredit;
    }
  | { account: CustomerPaymentAccount; mode: 'allocate'; receivable: CustomerOpenReceivable }
  | { account: CustomerPaymentAccount; mode: 'preview' }
  | {
      account: CustomerPaymentAccount;
      mode: 'pos-payment';
      sale: PosAccountReceivable;
      payment?: PosAccountPayment;
    }
  | { account: CustomerPaymentAccount; mode: 'pos-advance'; sale: PosAccountReceivable }
  | { account?: CustomerPaymentAccount; customerPartnerId?: string; mode: 'advance' }
  | { account?: CustomerPaymentAccount; customerPartnerId?: string; mode: 'terms' };

const emptyReferences: CustomerPaymentAccountReferenceData = { customers: [] };

export function FinanceCustomerAccountsPage() {
  const { locale } = useLocalization();
  const copy = posAccountMessages(locale);
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useCustomerAccounts(token);
  const [panel, setPanel] = useState<Panel>();
  const [notice, setNotice] = useState('');
  const [returnDocumentId, setReturnDocumentId] = useState<string>();
  const canCreate = hasPermission('erp.finance', 'create');
  const canEdit = hasPermission('erp.finance', 'edit');
  const { location, navigate } = useRouter();
  useEffect(() => {
    if (data.loading || !location.state || typeof location.state !== 'object') return;
    const id = (location.state as { customerPartnerId?: unknown }).customerPartnerId;
    const returnId = (location.state as { returnToFinancialDocumentId?: unknown })
      .returnToFinancialDocumentId;
    setReturnDocumentId(typeof returnId === 'string' ? returnId : undefined);
    const account =
      typeof id === 'string'
        ? data.accounts.find((item) => item.customerPartnerId === id)
        : undefined;
    if (account) setPanel({ account, mode: 'preview' });
    navigate(location.pathname, { replace: true, state: null });
  }, [data.loading, data.accounts, location.state, location.pathname, navigate]);

  const advanceBalance = sum(data.accounts.map((account) => account.advanceBalance));
  const outstanding = sum(data.accounts.map((account) => account.outstandingBalance));
  const availableCredit = sum(data.accounts.map((account) => account.availableCredit));

  function saved(message: string) {
    setNotice(message);
    setPanel(undefined);
    data.reload();
  }

  return (
    <div className="page-stack customer-accounts-page">
      <header className="page-header customer-accounts-header">
        <div>
          <p className="page-eyebrow">ERP · Finance</p>
          <h1>Customer payment accounts</h1>
          <p>Manage approved credit terms, received advances, and POS account balances.</p>
        </div>
        <div className="customer-accounts-header-actions">
          {canEdit ? (
            <Button
              disabled={data.loading || data.error}
              onClick={() => setPanel({ mode: 'terms' })}
              variant="secondary"
            >
              Set payment terms
            </Button>
          ) : null}
          {canCreate ? (
            <Button
              disabled={data.loading || data.error}
              onClick={() => setPanel({ mode: 'advance' })}
            >
              <Icon name="plus" size={16} /> Record advance
            </Button>
          ) : null}
        </div>
      </header>

      <FinanceTabs />

      {notice && !panel ? (
        <Toast onDismiss={() => setNotice('')} tone="success">
          {notice}
        </Toast>
      ) : null}

      <section aria-label="Customer payment summary" className="customer-account-summary">
        <Metric
          label="Managed customers"
          value={data.loading ? '…' : String(data.accounts.length)}
        />
        <Metric label="Advance available" value={data.loading ? '…' : money(advanceBalance)} />
        <Metric label="On-account balance" value={data.loading ? '…' : money(outstanding)} />
        <Metric label="Credit available" value={data.loading ? '…' : money(availableCredit)} />
      </section>

      <FinancePaymentStatusRegister
        onOpenAccount={(customerPartnerId) => {
          const account = data.accounts.find(
            (item) => item.customerPartnerId === customerPartnerId,
          );
          if (account) {
            setPanel({ account, mode: 'preview' });
            return;
          }
          void getCustomerPaymentAccount(token, customerPartnerId)
            .then((nextAccount) => setPanel({ account: nextAccount, mode: 'preview' }))
            .catch(() => setNotice('Customer account could not be opened. Refresh and try again.'));
        }}
        token={token}
      />

      {data.loading ? (
        <AccountsState title="Loading customer accounts" />
      ) : data.error ? (
        <AccountsState title="Customer accounts could not be loaded">
          <Button onClick={data.reload} variant="secondary">
            Try again
          </Button>
        </AccountsState>
      ) : data.accounts.length ? (
        <section aria-label="Customer payment accounts" className="customer-account-register">
          <div className="customer-account-register-head" aria-hidden="true">
            <span>Customer</span>
            <span>Advance available</span>
            <span>On-account balance</span>
            <span>Credit available</span>
            <span />
          </div>
          {data.accounts.map((account) => (
            <article className="customer-account-row" key={account.customerPartnerId}>
              <div className="customer-account-identity">
                <span>{initials(account.customerName)}</span>
                <div>
                  <strong>{account.customerName}</strong>
                  <small>{account.uic ? `UIC ${account.uic}` : 'Customer account'}</small>
                </div>
              </div>
              <AccountValue label="Advance" value={money(account.advanceBalance)} />
              <AccountValue label="Balance" value={money(account.outstandingBalance)} />
              <AccountValue label="Available credit" value={money(account.availableCredit)} />
              <Button
                onClick={() => {
                  setReturnDocumentId(undefined);
                  setPanel({ account, mode: 'preview' });
                }}
                variant="quiet"
              >
                Preview
              </Button>
            </article>
          ))}
        </section>
      ) : (
        <AccountsState title="No customer payment accounts yet">
          <p>Set customer payment terms or record a received advance to begin.</p>
        </AccountsState>
      )}

      {panel?.mode === 'preview' ? (
        <AccountPreview
          account={panel.account}
          backLabel={returnDocumentId ? 'Back to invoice' : 'Back to customer accounts'}
          canCreate={canCreate}
          canEdit={canEdit}
          canApprove={hasPermission('erp.finance', 'approve')}
          onCollect={(sale) => setPanel({ account: panel.account, mode: 'pos-payment', sale })}
          onAllocatePosAdvance={(sale) =>
            setPanel({ account: panel.account, mode: 'pos-advance', sale })
          }
          onReverse={(sale, payment) =>
            setPanel({ account: panel.account, mode: 'pos-payment', sale, payment })
          }
          onRefund={(sale, credit) =>
            setPanel({ account: panel.account, mode: 'pos-refund', sale, credit })
          }
          onAllocate={(receivable) =>
            setPanel({ account: panel.account, mode: 'allocate', receivable })
          }
          onAdvance={() => setPanel({ account: panel.account, mode: 'advance' })}
          onBack={() =>
            returnDocumentId
              ? navigate('/modules/erp.finance/invoices', {
                  state: { financialDocumentId: returnDocumentId },
                })
              : setPanel(undefined)
          }
          onTerms={() => setPanel({ account: panel.account, mode: 'terms' })}
        />
      ) : panel?.mode === 'advance' ? (
        <AdvancePanel
          {...(panel.account ? { account: panel.account } : {})}
          {...(panel.customerPartnerId ? { customerPartnerId: panel.customerPartnerId } : {})}
          onBack={() =>
            setPanel(panel.account ? { account: panel.account, mode: 'preview' } : undefined)
          }
          onSaved={(advance) => saved(`${advance.number} was recorded.`)}
          references={data.references}
          token={token}
        />
      ) : panel?.mode === 'allocate' ? (
        <AllocateAdvancePanel
          account={panel.account}
          onBack={() => setPanel({ account: panel.account, mode: 'preview' })}
          onSaved={(advanceNumber) =>
            saved(`${advanceNumber} was allocated to ${panel.receivable.number}.`)
          }
          receivable={panel.receivable}
          token={token}
        />
      ) : panel?.mode === 'pos-refund' ? (
        <PosAccountRefundPanel
          account={panel.account}
          sale={panel.sale}
          credit={panel.credit}
          token={token}
          timezone={data.references.businessTimezone ?? 'Europe/Sofia'}
          onBack={() => setPanel({ account: panel.account, mode: 'preview' })}
          onSaved={(account, notice) => {
            data.replace(account);
            setPanel({ account, mode: 'preview' });
            setNotice(notice);
          }}
        />
      ) : panel?.mode === 'pos-payment' ? (
        <PosAccountPaymentPanel
          businessTimezone={data.references.businessTimezone ?? 'Europe/Sofia'}
          account={panel.account}
          sale={panel.sale}
          {...(panel.payment ? { payment: panel.payment } : {})}
          token={token}
          onBack={() => setPanel({ account: panel.account, mode: 'preview' })}
          onSaved={(account, notice) => {
            data.replace(account);
            setPanel({ account, mode: 'preview' });
            setNotice(notice);
          }}
        />
      ) : panel?.mode === 'pos-advance' ? (
        <AllocatePosAdvancePanel
          account={panel.account}
          sale={panel.sale}
          token={token}
          onBack={() => setPanel({ account: panel.account, mode: 'preview' })}
          onSaved={(account, number) => {
            data.replace(account);
            setPanel({ account, mode: 'preview' });
            setNotice(`${number}: ${copy.advanceApplied}`);
          }}
        />
      ) : panel?.mode === 'terms' ? (
        <TermsPanel
          accounts={data.accounts}
          {...(panel.account ? { account: panel.account } : {})}
          {...(panel.customerPartnerId ? { customerPartnerId: panel.customerPartnerId } : {})}
          onBack={() =>
            setPanel(panel.account ? { account: panel.account, mode: 'preview' } : undefined)
          }
          onSaved={(account) => saved(`Payment terms for ${account.customerName} were saved.`)}
          references={data.references}
          token={token}
        />
      ) : null}
    </div>
  );
}

function AccountPreview({
  account,
  backLabel,
  canCreate,
  canEdit,
  canApprove,
  onCollect,
  onAllocatePosAdvance,
  onReverse,
  onRefund,
  onAllocate,
  onAdvance,
  onBack,
  onTerms,
}: {
  account: CustomerPaymentAccount;
  backLabel: string;
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  onCollect: (sale: PosAccountReceivable) => void;
  onAllocatePosAdvance: (sale: PosAccountReceivable) => void;
  onReverse: (sale: PosAccountReceivable, payment: PosAccountPayment) => void;
  onRefund: (sale: PosAccountReceivable, credit: PosAccountReturnCredit) => void;
  onAllocate: (receivable: CustomerOpenReceivable) => void;
  onAdvance: () => void;
  onBack: () => void;
  onTerms: () => void;
}) {
  return (
    <AccountDrawer
      backLabel={backLabel}
      onBack={onBack}
      subtitle={account.uic ? `UIC ${account.uic}` : 'Customer'}
      title={account.customerName}
    >
      <div className="customer-account-preview">
        <section className="customer-account-hero">
          <div>
            <span>Current POS account balance</span>
            <strong>{money(account.outstandingBalance)}</strong>
            <small>{money(account.availableCredit)} credit still available</small>
          </div>
          <div className="customer-account-hero-actions">
            {canEdit ? (
              <Button onClick={onTerms} variant="secondary">
                Edit terms
              </Button>
            ) : null}
            {canCreate ? <Button onClick={onAdvance}>Record advance</Button> : null}
          </div>
        </section>

        <PosAccountBalances
          records={account.posReceivables ?? []}
          canCollect={canCreate}
          canReverse={canApprove}
          onCollect={onCollect}
          {...(account.advances.some((advance) => decimalUnits(advance.availableAmount) > 0n)
            ? { onAllocateAdvance: onAllocatePosAdvance }
            : {})}
          onReverse={onReverse}
          customerId={account.customerPartnerId}
          onRefund={onRefund}
        />
        <section className="customer-account-section">
          <header>
            <div>
              <h3>Open receivables</h3>
              <p>Apply an available advance to reduce an outstanding balance.</p>
            </div>
            <strong>{account.openReceivables.length}</strong>
          </header>
          {account.openReceivables.length ? (
            <div className="customer-open-receivable-list">
              {account.openReceivables.map((receivable) => (
                <article key={receivable.id}>
                  <div>
                    <strong>{receivable.number}</strong>
                    <small>
                      {receivable.sourceInvoiceNumber} · Due {date(receivable.dueDate)}
                    </small>
                  </div>
                  <div>
                    <span>Outstanding</span>
                    <strong>{money(receivable.outstandingTotal)}</strong>
                  </div>
                  {canCreate && account.advances.length ? (
                    <Button
                      className="customer-open-receivable-apply"
                      onClick={() => onAllocate(receivable)}
                      variant="secondary"
                    >
                      Apply advance
                    </Button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="customer-account-empty">No open receivables are available.</p>
          )}
        </section>

        <section className="customer-account-section">
          <header>
            <div>
              <h3>Payment terms</h3>
              <p>These dated terms control POS on-account eligibility.</p>
            </div>
            <Status active={account.terms?.status === 'active' && account.terms.onAccountEnabled} />
          </header>
          {account.terms ? (
            <dl className="customer-account-detail-grid">
              <div>
                <dt>Credit limit</dt>
                <dd>{money(account.terms.creditLimitEur)}</dd>
              </div>
              <div>
                <dt>Payment due</dt>
                <dd>{account.terms.paymentTermsDays} days after sale</dd>
              </div>
              <div>
                <dt>Valid from</dt>
                <dd>{date(account.terms.validFrom)}</dd>
              </div>
              <div>
                <dt>Valid to</dt>
                <dd>{account.terms.validTo ? date(account.terms.validTo) : 'No end date'}</dd>
              </div>
            </dl>
          ) : (
            <p className="customer-account-empty">No on-account terms have been set.</p>
          )}
        </section>

        <section className="customer-account-section">
          <header>
            <div>
              <h3>Available advances</h3>
              <p>Only unused amounts appear at checkout.</p>
            </div>
            <strong>{money(account.advanceBalance)}</strong>
          </header>
          {account.advances.length ? (
            <div className="customer-advance-list">
              {account.advances.map((advance) => (
                <article key={advance.id}>
                  <div>
                    <strong>{advance.number}</strong>
                    <small>
                      {date(advance.receivedOn)} · {methodLabel(advance.paymentMethod)}
                    </small>
                  </div>
                  <div>
                    <span>Available</span>
                    <strong>{money(advance.availableAmount)}</strong>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="customer-account-empty">No unused advance is available.</p>
          )}
        </section>

        <section className="customer-account-section">
          <header>
            <div>
              <h3>POS account activity</h3>
              <p>Sales, payments and returns stay together.</p>
            </div>
            <span>{account.entries.length}</span>
          </header>
          {account.entries.length ? (
            <div className="customer-account-entry-list">
              {account.entries.map((entry) => (
                <article key={entry.id}>
                  <span
                    className={
                      entry.entryType === 'charge' || entry.entryType === 'payment_reversal'
                        ? 'is-charge'
                        : 'is-credit'
                    }
                  >
                    {entry.entryType === 'charge'
                      ? 'Sale'
                      : entry.entryType === 'payment'
                        ? 'Payment'
                        : entry.entryType === 'payment_reversal'
                          ? 'Payment reversal'
                          : 'Return'}
                  </span>
                  <div>
                    <strong>{entry.paymentNumber ?? entry.returnNumber ?? entry.saleNumber}</strong>
                    <small>
                      {entry.entryType === 'charge'
                        ? `Due ${date(entry.dueOn)}`
                        : `Linked to ${entry.saleNumber}`}
                    </small>
                  </div>
                  <strong>
                    {entry.entryType === 'charge' || entry.entryType === 'payment_reversal'
                      ? ''
                      : '−'}
                    {money(entry.amount)}
                  </strong>
                </article>
              ))}
            </div>
          ) : (
            <p className="customer-account-empty">No POS account activity has been recorded.</p>
          )}
        </section>
      </div>
    </AccountDrawer>
  );
}

function AllocatePosAdvancePanel({
  account,
  onBack,
  onSaved,
  sale,
  token,
}: {
  account: CustomerPaymentAccount;
  onBack: () => void;
  onSaved: (account: CustomerPaymentAccount, advanceNumber: string) => void;
  sale: PosAccountReceivable;
  token: string;
}) {
  const { locale } = useLocalization();
  const copy = posAccountMessages(locale);
  const availableAdvances = account.advances.filter(
    (item) => decimalUnits(item.availableAmount) > 0n,
  );
  const [advanceId, setAdvanceId] = useState(availableAdvances[0]?.id ?? '');
  const selectedAdvance = availableAdvances.find((item) => item.id === advanceId);
  const [amount, setAmount] = useState(
    selectedAdvance ? smallerAmount(selectedAdvance.availableAmount, sale.outstandingTotal) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedAdvance) return;
    const normalized = fixedDecimal(amount);
    if (!normalized || decimalUnits(normalized) <= 0n) {
      setError(copy.invalidAdvanceAmount);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const input: ApplyCustomerAdvanceToPosSaleRequest = {
        amount: normalized,
        customerAdvanceId: selectedAdvance.id,
        expectedOutstanding: sale.outstandingTotal,
      };
      const result = await applyCustomerAdvanceToPosSale(
        token,
        account.customerPartnerId,
        sale.saleId,
        crypto.randomUUID(),
        input,
      );
      onSaved(result, selectedAdvance.number);
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? translatePosAdvanceError(cause, copy)
          : copy.advanceApplyError,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AccountDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${account.customerName} · ${sale.saleNumber}`}
      title={copy.applyAdvanceTitle}
    >
      <form className="customer-account-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="customer-account-form-card">
          <header>
            <span>1</span>
            <div>
              <h3>{copy.chooseAdvance}</h3>
              <p>{copy.advanceHelp}</p>
            </div>
          </header>
          <Field label={copy.customerAdvance}>
            <select
              onChange={(event) => {
                const next = availableAdvances.find((item) => item.id === event.target.value);
                setAdvanceId(event.target.value);
                if (next) setAmount(smallerAmount(next.availableAmount, sale.outstandingTotal));
              }}
              required
              value={advanceId}
            >
              {availableAdvances.length === 0 ? (
                <option disabled value="">
                  {copy.advanceNotAvailable}
                </option>
              ) : null}
              {availableAdvances.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.number} · {date(item.receivedOn)} · {money(item.availableAmount)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={copy.amountToApply}>
            <input
              max={
                selectedAdvance
                  ? smallerAmount(selectedAdvance.availableAmount, sale.outstandingTotal)
                  : undefined
              }
              min="0.0001"
              onChange={(event) => setAmount(event.target.value)}
              required
              step="0.0001"
              type="number"
              value={amount}
            />
          </Field>
          <dl className="customer-account-detail-grid">
            <div>
              <dt>{copy.posBalance}</dt>
              <dd>{money(sale.outstandingTotal)}</dd>
            </div>
            <div>
              <dt>{copy.advanceAvailable}</dt>
              <dd>{money(selectedAdvance?.availableAmount ?? '0')}</dd>
            </div>
          </dl>
        </section>
        <div className="finance-drawer-actions">
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            {copy.back}
          </Button>
          <Button busy={busy} disabled={!selectedAdvance} type="submit">
            {copy.applyAdvance}
          </Button>
        </div>
      </form>
    </AccountDrawer>
  );
}

function AllocateAdvancePanel({
  account,
  onBack,
  onSaved,
  receivable,
  token,
}: {
  account: CustomerPaymentAccount;
  onBack: () => void;
  onSaved: (advanceNumber: string) => void;
  receivable: CustomerOpenReceivable;
  token: string;
}) {
  const [advanceId, setAdvanceId] = useState(account.advances[0]?.id ?? '');
  const [amount, setAmount] = useState(
    account.advances[0]
      ? smallerAmount(account.advances[0].availableAmount, receivable.outstandingTotal)
      : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const advance = account.advances.find((item) => item.id === advanceId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!advance) return;
    const normalizedAmount = fixedDecimal(amount);
    if (!normalizedAmount || decimalUnits(normalizedAmount) <= 0n) {
      setError('Enter a valid amount greater than zero, with up to four decimal places.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await allocateCustomerAdvance(token, receivable.id, crypto.randomUUID(), {
        amount: normalizedAmount,
        customerAdvanceId: advance.id,
      });
      onSaved(advance.number);
    } catch (caught) {
      setError(errorText(caught, 'The advance could not be applied. Refresh and try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${receivable.number} · ${receivable.sourceInvoiceNumber}`}
      title="Apply customer advance"
    >
      <form className="customer-account-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="customer-account-form-card">
          <header>
            <span>1</span>
            <div>
              <h3>Choose the advance and amount</h3>
              <p>
                The payment keeps its original date and method, and remains linked to the advance.
              </p>
            </div>
          </header>
          <Field label="Customer advance">
            <select
              onChange={(event) => {
                const selected = account.advances.find((item) => item.id === event.target.value);
                setAdvanceId(event.target.value);
                if (selected)
                  setAmount(smallerAmount(selected.availableAmount, receivable.outstandingTotal));
              }}
              required
              value={advanceId}
            >
              {account.advances.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.number} · {money(item.availableAmount)} available
                </option>
              ))}
            </select>
          </Field>
          <Field label="Open receivable">
            <input
              readOnly
              value={`${receivable.number} · ${money(receivable.outstandingTotal)} outstanding`}
            />
          </Field>
          <Field label="Amount to apply (EUR)">
            <input
              max={
                advance
                  ? smallerAmount(advance.availableAmount, receivable.outstandingTotal)
                  : undefined
              }
              min="0.0001"
              onChange={(event) => setAmount(event.target.value)}
              required
              step="0.0001"
              type="number"
              value={amount}
            />
          </Field>
        </section>
        <Actions busy={busy} onBack={onBack} primary="Apply advance" />
      </form>
    </AccountDrawer>
  );
}

function TermsPanel({
  account,
  accounts,
  customerPartnerId,
  onBack,
  onSaved,
  references,
  token,
}: {
  account?: CustomerPaymentAccount;
  accounts: CustomerPaymentAccount[];
  customerPartnerId?: string;
  onBack: () => void;
  onSaved: (account: CustomerPaymentAccount) => void;
  references: CustomerPaymentAccountReferenceData;
  token: string;
}) {
  const initialCustomerId =
    account?.customerPartnerId ?? customerPartnerId ?? references.customers[0]?.id ?? '';
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [enabled, setEnabled] = useState(account?.terms?.onAccountEnabled ?? true);
  const [creditLimit, setCreditLimit] = useState(account?.terms?.creditLimitEur ?? '2000.00');
  const [days, setDays] = useState(String(account?.terms?.paymentTermsDays ?? 14));
  const [validFrom, setValidFrom] = useState(account?.terms?.validFrom ?? today());
  const [validTo, setValidTo] = useState(account?.terms?.validTo ?? '');
  const [status, setStatus] = useState<'active' | 'suspended'>(account?.terms?.status ?? 'active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedAccount = accounts.find((item) => item.customerPartnerId === customerId);

  useEffect(() => {
    if (account) return;
    setEnabled(selectedAccount?.terms?.onAccountEnabled ?? true);
    setCreditLimit(selectedAccount?.terms?.creditLimitEur ?? '2000.00');
    setDays(String(selectedAccount?.terms?.paymentTermsDays ?? 14));
    setValidFrom(selectedAccount?.terms?.validFrom ?? today());
    setValidTo(selectedAccount?.terms?.validTo ?? '');
    setStatus(selectedAccount?.terms?.status ?? 'active');
  }, [account, selectedAccount]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedCreditLimit = fixedDecimal(creditLimit);
    if (!normalizedCreditLimit) {
      setError('Enter a valid credit limit with up to four decimal places.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const input: UpsertCustomerPaymentTermsRequest = {
        creditLimitEur: normalizedCreditLimit,
        ...(selectedAccount?.terms ? { expectedVersion: selectedAccount.terms.version } : {}),
        onAccountEnabled: enabled,
        paymentTermsDays: Number(days),
        status,
        validFrom,
        ...(validTo ? { validTo } : {}),
      };
      onSaved(await updateCustomerPaymentTerms(token, customerId, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The payment terms could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Approved POS customer-account rules"
      title="Set payment terms"
    >
      <form className="customer-account-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="customer-account-form-card">
          <header>
            <span>1</span>
            <div>
              <h3>Customer</h3>
              <p>Terms are kept against the shared ERP customer record.</p>
            </div>
          </header>
          <Field label="Customer">
            <select
              disabled={Boolean(account)}
              onChange={(event) => setCustomerId(event.target.value)}
              required
              value={customerId}
            >
              {references.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {customer.uic ? ` · ${customer.uic}` : ''}
                </option>
              ))}
            </select>
          </Field>
        </section>
        <section className="customer-account-form-card">
          <header>
            <span>2</span>
            <div>
              <h3>Credit terms</h3>
              <p>The POS checks the dated limit again when the sale is completed.</p>
            </div>
          </header>
          <label className="customer-account-switch">
            <input
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Allow on-account payment</strong>
              <small>
                Cashiers can leave an approved remaining balance on the customer account.
              </small>
            </span>
          </label>
          <div className="customer-account-form-grid">
            <Field label="Credit limit (EUR)">
              <input
                disabled={!enabled}
                min={enabled ? '0.0001' : '0'}
                onChange={(event) => setCreditLimit(event.target.value)}
                required
                step="0.0001"
                type="number"
                value={creditLimit}
              />
            </Field>
            <Field label="Payment due after">
              <div className="customer-account-input-suffix">
                <input
                  max="365"
                  min="0"
                  onChange={(event) => setDays(event.target.value)}
                  required
                  type="number"
                  value={days}
                />
                <span>days</span>
              </div>
            </Field>
            <Field label="Valid from">
              <input
                onChange={(event) => setValidFrom(event.target.value)}
                required
                type="date"
                value={validFrom}
              />
            </Field>
            <Field label="Valid to (optional)">
              <input
                min={validFrom}
                onChange={(event) => setValidTo(event.target.value)}
                type="date"
                value={validTo}
              />
            </Field>
            <Field label="Status">
              <select
                onChange={(event) => setStatus(event.target.value as typeof status)}
                value={status}
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </Field>
          </div>
        </section>
        <Actions busy={busy} onBack={onBack} primary="Save payment terms" />
      </form>
    </AccountDrawer>
  );
}

function AdvancePanel({
  account,
  customerPartnerId,
  onBack,
  onSaved,
  references,
  token,
}: {
  account?: CustomerPaymentAccount;
  customerPartnerId?: string;
  onBack: () => void;
  onSaved: (advance: Awaited<ReturnType<typeof createCustomerAdvance>>) => void;
  references: CustomerPaymentAccountReferenceData;
  token: string;
}) {
  const [customerId, setCustomerId] = useState(
    account?.customerPartnerId ?? customerPartnerId ?? references.customers[0]?.id ?? '',
  );
  const [amount, setAmount] = useState('100.00');
  const [receivedOn, setReceivedOn] = useState(today());
  const [method, setMethod] = useState<CustomerAdvancePaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedAmount = fixedDecimal(amount);
    if (!normalizedAmount || decimalUnits(normalizedAmount) <= 0n) {
      setError('Enter a valid amount greater than zero, with up to four decimal places.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const input: CreateCustomerAdvanceRequest = {
        amount: normalizedAmount,
        customerPartnerId: customerId,
        paymentMethod: method,
        ...(reference.trim() ? { paymentReference: reference.trim() } : {}),
        receivedOn,
      };
      onSaved(await createCustomerAdvance(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, 'The advance could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Money received before a POS sale"
      title="Record customer advance"
    >
      <form className="customer-account-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="customer-account-form-card">
          <header>
            <span>1</span>
            <div>
              <h3>Received payment</h3>
              <p>The full amount becomes available to the selected customer at checkout.</p>
            </div>
          </header>
          <div className="customer-account-form-grid">
            <Field label="Customer">
              <select
                disabled={Boolean(account)}
                onChange={(event) => setCustomerId(event.target.value)}
                required
                value={customerId}
              >
                {references.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.uic ? ` · ${customer.uic}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount (EUR)">
              <input
                min="0.0001"
                onChange={(event) => setAmount(event.target.value)}
                required
                step="0.0001"
                type="number"
                value={amount}
              />
            </Field>
            <Field label="Date received">
              <input
                onChange={(event) => setReceivedOn(event.target.value)}
                required
                type="date"
                value={receivedOn}
              />
            </Field>
            <Field label="Method">
              <select
                onChange={(event) => setMethod(event.target.value as CustomerAdvancePaymentMethod)}
                value={method}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="pos_terminal">POS terminal</option>
                <option value="card">Card payment</option>
              </select>
            </Field>
            <Field label="Payment reference (optional)">
              <input
                maxLength={255}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Bank or receipt reference"
                value={reference}
              />
            </Field>
          </div>
        </section>
        <Actions busy={busy} onBack={onBack} primary="Record advance" />
      </form>
    </AccountDrawer>
  );
}

function AccountDrawer({
  backLabel = 'Back to customer accounts',
  busy = false,
  children,
  onBack,
  subtitle,
  title,
}: {
  backLabel?: string;
  busy?: boolean;
  children: ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label={backLabel}
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide customer-account-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header">
          <button
            aria-label={backLabel}
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

function Actions({
  busy,
  onBack,
  primary,
}: {
  busy: boolean;
  onBack: () => void;
  primary: string;
}) {
  return (
    <div className="customer-account-actions">
      <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
        Back
      </Button>
      <Button busy={busy} type="submit">
        {primary}
      </Button>
    </div>
  );
}
function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="customer-account-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function AccountValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="customer-account-value">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
function Status({ active }: { active: boolean }) {
  return (
    <span className={`customer-account-status ${active ? 'is-active' : ''}`}>
      {active ? 'Available at POS' : 'Not available'}
    </span>
  );
}
function AccountsState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <section className="finance-state">
      <Icon name="finance" size={24} />
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function useCustomerAccounts(token: string) {
  const [accounts, setAccounts] = useState<CustomerPaymentAccount[]>([]);
  const [references, setReferences] = useState(emptyReferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const replace = useCallback(
    (account: CustomerPaymentAccount) =>
      setAccounts((current) =>
        current.map((row) => (row.customerPartnerId === account.customerPartnerId ? account : row)),
      ),
    [],
  );
  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([
      listCustomerPaymentAccounts(token),
      getCustomerPaymentAccountReferenceData(token),
    ])
      .then(([nextAccounts, nextReferences]) => {
        if (active) {
          setAccounts(nextAccounts);
          setReferences(nextReferences);
        }
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [revision, token]);
  return useMemo(
    () => ({ accounts, error, loading, references, reload, replace }),
    [accounts, error, loading, references, reload, replace],
  );
}

function money(value: string) {
  const units = decimalUnits(value);
  const negative = units < 0n;
  const absoluteUnits = negative ? -units : units;
  const cents = (absoluteUnits + 50n) / 100n;
  return formatOperationsMinorCurrency(negative ? -cents : cents, 'EUR');
}
function sum(values: string[]) {
  return decimalText(values.reduce((total, value) => total + decimalUnits(value), 0n));
}
function date(value: string) {
  return formatOperationsDate(new Date(`${value}T00:00:00Z`), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
}
function smallerAmount(left: string, right: string) {
  const leftUnits = decimalUnits(left);
  const rightUnits = decimalUnits(right);
  return decimalText(leftUnits < rightUnits ? leftUnits : rightUnits);
}
function fixedDecimal(value: string) {
  const normalized = value.trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d{0,4}))?$/u.exec(normalized);
  if (!match) return null;
  const whole = (match[1] ?? '0').replace(/^0+(?=\d)/u, '');
  const fraction = (match[2] ?? '').padEnd(4, '0');
  return `${whole}.${fraction}`;
}
function decimalUnits(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/u.exec(value.trim().replace(',', '.'));
  if (!match) return 0n;
  const whole = BigInt(match[2] ?? '0');
  const fraction = BigInt((match[3] ?? '').padEnd(4, '0'));
  const units = whole * 10_000n + fraction;
  return match[1] === '-' ? -units : units;
}
function decimalText(units: bigint) {
  const negative = units < 0n;
  const absoluteUnits = negative ? -units : units;
  const whole = absoluteUnits / 10_000n;
  const fraction = String(absoluteUnits % 10_000n).padStart(4, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function initials(value: string) {
  return value
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
function methodLabel(method: CustomerAdvancePaymentMethod) {
  return {
    bank_transfer: 'Bank transfer',
    card: 'Card payment',
    cash: 'Cash',
    pos_terminal: 'POS terminal',
  }[method];
}
function errorText(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}
function translatePosAdvanceError(
  error: ApiClientError,
  copy: ReturnType<typeof posAccountMessages>,
) {
  if (error.code === 'FINANCE_ADVANCE_NOT_AVAILABLE') return copy.advanceNotAvailable;
  if (error.code === 'FINANCE_ADVANCE_ALLOCATION_EXCEEDS_BALANCE') return copy.advanceChanged;
  if (error.code === 'POS_ACCOUNT_PAYMENT_EXCEEDS_BALANCE') return copy.exceeded;
  return copy.advanceApplyError;
}
