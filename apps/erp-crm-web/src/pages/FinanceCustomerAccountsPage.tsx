import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateCustomerAdvanceRequest,
  CustomerAdvancePaymentMethod,
  CustomerPaymentAccount,
  CustomerPaymentAccountReferenceData,
  UpsertCustomerPaymentTermsRequest,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createCustomerAdvance,
  getCustomerPaymentAccountReferenceData,
  listCustomerPaymentAccounts,
  updateCustomerPaymentTerms,
} from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { FinanceTabs } from './FinanceBankPage';

type Panel =
  | { account: CustomerPaymentAccount; mode: 'preview' }
  | { account?: CustomerPaymentAccount; customerPartnerId?: string; mode: 'advance' }
  | { account?: CustomerPaymentAccount; customerPartnerId?: string; mode: 'terms' };

const emptyReferences: CustomerPaymentAccountReferenceData = { customers: [] };

export function FinanceCustomerAccountsPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useCustomerAccounts(token);
  const [panel, setPanel] = useState<Panel>();
  const [notice, setNotice] = useState('');
  const canCreate = hasPermission('erp.finance', 'create');
  const canEdit = hasPermission('erp.finance', 'edit');

  if (data.loading) return <AccountsState title="Loading customer accounts" />;
  if (data.error)
    return (
      <AccountsState title="Customer accounts could not be loaded">
        <Button onClick={data.reload} variant="secondary">
          Try again
        </Button>
      </AccountsState>
    );

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
            <Button onClick={() => setPanel({ mode: 'terms' })} variant="secondary">
              Set payment terms
            </Button>
          ) : null}
          {canCreate ? (
            <Button onClick={() => setPanel({ mode: 'advance' })}>
              <Icon name="plus" size={16} /> Record advance
            </Button>
          ) : null}
        </div>
      </header>

      <FinanceTabs />

      {notice ? (
        <Toast onDismiss={() => setNotice('')} tone="success">
          {notice}
        </Toast>
      ) : null}

      <section aria-label="Customer payment summary" className="customer-account-summary">
        <Metric label="Managed customers" value={String(data.accounts.length)} />
        <Metric label="Advance available" value={money(advanceBalance)} />
        <Metric label="On-account balance" value={money(outstanding)} />
        <Metric label="Credit available" value={money(availableCredit)} />
      </section>

      {data.accounts.length ? (
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
              <Button onClick={() => setPanel({ account, mode: 'preview' })} variant="quiet">
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
          canCreate={canCreate}
          canEdit={canEdit}
          onAdvance={() => setPanel({ account: panel.account, mode: 'advance' })}
          onBack={() => setPanel(undefined)}
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
  canCreate,
  canEdit,
  onAdvance,
  onBack,
  onTerms,
}: {
  account: CustomerPaymentAccount;
  canCreate: boolean;
  canEdit: boolean;
  onAdvance: () => void;
  onBack: () => void;
  onTerms: () => void;
}) {
  return (
    <AccountDrawer
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
                <dd>{money(account.terms.creditLimitBgn)}</dd>
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
              <p>Sales and linked returns remain together.</p>
            </div>
            <span>{account.entries.length}</span>
          </header>
          {account.entries.length ? (
            <div className="customer-account-entry-list">
              {account.entries.map((entry) => (
                <article key={entry.id}>
                  <span className={entry.entryType === 'charge' ? 'is-charge' : 'is-credit'}>
                    {entry.entryType === 'charge' ? 'Sale' : 'Return'}
                  </span>
                  <div>
                    <strong>{entry.returnNumber ?? entry.saleNumber}</strong>
                    <small>
                      {entry.entryType === 'charge'
                        ? `Due ${date(entry.dueOn)}`
                        : `Linked to ${entry.saleNumber}`}
                    </small>
                  </div>
                  <strong>
                    {entry.entryType === 'charge' ? '' : '−'}
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
  const [creditLimit, setCreditLimit] = useState(account?.terms?.creditLimitBgn ?? '2000.00');
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
    setCreditLimit(selectedAccount?.terms?.creditLimitBgn ?? '2000.00');
    setDays(String(selectedAccount?.terms?.paymentTermsDays ?? 14));
    setValidFrom(selectedAccount?.terms?.validFrom ?? today());
    setValidTo(selectedAccount?.terms?.validTo ?? '');
    setStatus(selectedAccount?.terms?.status ?? 'active');
  }, [account, selectedAccount]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input: UpsertCustomerPaymentTermsRequest = {
        creditLimitBgn: Number(creditLimit).toFixed(4),
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
            <Field label="Credit limit (BGN)">
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
    setBusy(true);
    setError('');
    try {
      const input: CreateCustomerAdvanceRequest = {
        amount: Number(amount).toFixed(4),
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
            <Field label="Amount (BGN)">
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
  busy = false,
  children,
  onBack,
  subtitle,
  title,
}: {
  busy?: boolean;
  children: ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label="Back to customer accounts"
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
            aria-label="Back to customer accounts"
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
    () => ({ accounts, error, loading, references, reload }),
    [accounts, error, loading, references, reload],
  );
}

function money(value: string) {
  return new Intl.NumberFormat('en-GB', { currency: 'BGN', style: 'currency' }).format(
    Number(value),
  );
}
function sum(values: string[]) {
  return values.reduce((total, value) => total + Number(value), 0).toFixed(4);
}
function date(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
    new Date(`${value}T00:00:00Z`),
  );
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
