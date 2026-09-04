import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateFinanceBankStatementLineRequest,
  CreateFinanceBankStatementRequest,
  FinanceBankMatchCandidate,
  FinanceBankStatement,
  FinanceBankStatementSummary,
  FinanceBankTransaction,
  FinanceSupplierBankMatchCandidate,
  FinanceSupplierReferenceData,
} from '@vista/contracts';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createFinanceBankStatement,
  getFinanceBankMatchCandidates,
  getFinanceBankStatement,
  getFinanceSupplierBankMatchCandidates,
  getFinanceSupplierReferenceData,
  listFinanceBankStatements,
  matchFinanceBankTransaction,
  matchFinanceSupplierBankTransaction,
} from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';

interface DraftLine extends CreateFinanceBankStatementLineRequest {
  key: string;
}

export function FinanceBankPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useBankStatements(token);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FinanceBankStatement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function preview(item: FinanceBankStatementSummary) {
    try {
      setSelected(await getFinanceBankStatement(token, item.id));
    } catch {
      setNotice('The statement could not be opened. Refresh the register and try again.');
    }
  }

  if (data.loading) return <BankState title="Loading bank reconciliation" />;
  if (data.error)
    return (
      <BankState title="Bank reconciliation could not be loaded">
        <Button onClick={data.reload} variant="secondary">
          Try again
        </Button>
      </BankState>
    );

  const statements = data.items;
  const incoming = statements.reduce((total, item) => total + Number(item.incomingTotal), 0);
  const unmatched = statements.reduce(
    (total, item) => total + item.unmatchedIncomingCount + item.unmatchedOutgoingCount,
    0,
  );
  const matched = statements.reduce(
    (total, item) => total + item.matchedIncomingCount + item.matchedOutgoingCount,
    0,
  );

  return (
    <div className="page-stack bank-workspace">
      <header className="page-header bank-workspace-header">
        <div>
          <p className="page-eyebrow">ERP · Finance</p>
          <h1>Bank reconciliation</h1>
          <p>Enter BGN statements, review incoming transfers, and connect them to collections.</p>
        </div>
        {hasPermission('erp.finance', 'create') ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={17} /> New statement
          </Button>
        ) : null}
      </header>

      <FinanceTabs />

      <InlineAlert tone="info">
        Manual BGN statement entry is available. Bank-specific file import remains disabled until
        the client selects the required statement formats.
      </InlineAlert>

      <section aria-label="Bank reconciliation summary" className="bank-summary">
        <BankMetric label="Statements" value={String(data.totalItems)} />
        <BankMetric label="Incoming shown" value={formatMoney(String(incoming))} />
        <BankMetric label="Matched transactions" value={String(matched)} />
        <BankMetric
          label="Needs review"
          {...(unmatched ? { tone: 'warning' as const } : {})}
          value={String(unmatched)}
        />
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

      {statements.length ? (
        <section aria-label="Bank statement register" className="bank-register">
          <div className="bank-register-head" aria-hidden="true">
            <span>Statement</span>
            <span>Activity</span>
            <span>Closing balance</span>
            <span>Status</span>
            <span />
          </div>
          {statements.map((statement) => (
            <article className="bank-register-row" key={statement.id}>
              <div className="bank-statement-identity">
                <span>BS</span>
                <div>
                  <strong>{statement.number}</strong>
                  <span>{statement.bankName}</span>
                  <small>
                    {statement.statementReference} · {formatDate(statement.statementDate)}
                  </small>
                </div>
              </div>
              <div className="bank-register-activity">
                <strong>{statement.transactionCount} transactions</strong>
                <span>{formatMoney(statement.incomingTotal)} incoming</span>
              </div>
              <div className="bank-register-balance">
                <strong>{formatMoney(statement.closingBalance)}</strong>
                <span>{maskIban(statement.accountIban)}</span>
              </div>
              <BankStatus statement={statement} />
              <Button onClick={() => void preview(statement)} variant="quiet">
                Preview
              </Button>
            </article>
          ))}
        </section>
      ) : (
        <BankState title="No bank statements yet">
          <p>Add the first statement manually when bank activity is ready for reconciliation.</p>
        </BankState>
      )}

      {creating ? (
        <CreateBankStatementDrawer
          onBack={() => setCreating(false)}
          onSaved={(statement) => {
            const unmatchedCount =
              statement.unmatchedIncomingCount + statement.unmatchedOutgoingCount;
            setCreating(false);
            setSelected(statement);
            setNotice(
              unmatchedCount
                ? `${statement.number} was added with ${unmatchedCount} ${unmatchedCount === 1 ? 'transaction' : 'transactions'} requiring review.`
                : `${statement.number} was added and its transactions were matched.`,
            );
            data.reload();
          }}
          token={token}
        />
      ) : null}
      {selected ? (
        <BankStatementDrawer
          canEdit={hasPermission('erp.finance', 'edit')}
          onBack={() => setSelected(null)}
          onSaved={(statement) => {
            setSelected(statement);
            setNotice('The bank transaction was matched and the connected balance was updated.');
            data.reload();
          }}
          statement={selected}
          token={token}
        />
      ) : null}
    </div>
  );
}

export function FinanceTabs() {
  return (
    <nav aria-label="Finance sections" className="finance-tabs">
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.finance/invoices"
      >
        Financial documents
      </Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.finance/payments"
      >
        Collections &amp; payments
      </Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.finance/customer-accounts"
      >
        Customer accounts
      </Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.finance/payables"
      >
        Supplier payables
      </Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.finance/cash"
      >
        Cash operations
      </Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.finance/cash-bank"
      >
        Bank reconciliation
      </Link>
      <Link
        className={({ isActive }) => (isActive ? 'is-active' : undefined)}
        end
        to="/modules/erp.finance/registers"
      >
        Balances &amp; turnover
      </Link>
    </nav>
  );
}

function CreateBankStatementDrawer({
  onBack,
  onSaved,
  token,
}: {
  onBack: () => void;
  onSaved: (statement: FinanceBankStatement) => void;
  token: string;
}) {
  const [accountIban, setAccountIban] = useState('');
  const [bankName, setBankName] = useState('');
  const [statementReference, setStatementReference] = useState('');
  const [statementDate, setStatementDate] = useState(today());
  const [openingBalance, setOpeningBalance] = useState('0');
  const [closingBalance, setClosingBalance] = useState('0');
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calculatedClosing = useMemo(
    () => lines.reduce((total, line) => total + signedAmount(line), Number(openingBalance || 0)),
    [lines, openingBalance],
  );

  function updateLine(key: string, update: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...update } : line)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: CreateFinanceBankStatementRequest = {
        accountIban,
        bankName,
        closingBalance,
        currencyCode: 'BGN',
        lines: lines.map((line) => ({
          amount: line.amount,
          ...(line.counterpartyIban ? { counterpartyIban: line.counterpartyIban } : {}),
          counterpartyName: line.counterpartyName,
          direction: line.direction,
          paymentReference: line.paymentReference,
          transactionDate: line.transactionDate,
          valueDate: line.valueDate,
        })),
        openingBalance,
        statementDate,
        statementReference,
      };
      onSaved(await createFinanceBankStatement(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(apiMessage(caught, 'The bank statement could not be added.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BankDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Balanced BGN statement entry"
      title="New bank statement"
    >
      <form className="bank-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="bank-form-section">
          <header>
            <span>1</span>
            <div>
              <h3>Statement context</h3>
              <p>Use the reference printed by the bank.</p>
            </div>
          </header>
          <div className="bank-form-grid">
            <BankField label="Bank name">
              <input
                maxLength={160}
                onChange={(event) => setBankName(event.target.value)}
                required
                value={bankName}
              />
            </BankField>
            <BankField label="Statement reference">
              <input
                maxLength={120}
                onChange={(event) => setStatementReference(event.target.value)}
                required
                value={statementReference}
              />
            </BankField>
            <BankField label="Company account IBAN" wide>
              <input
                maxLength={34}
                onChange={(event) => setAccountIban(event.target.value)}
                required
                value={accountIban}
              />
            </BankField>
            <BankField label="Statement date">
              <input
                onChange={(event) => setStatementDate(event.target.value)}
                required
                type="date"
                value={statementDate}
              />
            </BankField>
            <BankField label="Currency">
              <input disabled value="BGN" />
            </BankField>
            <BankField label="Opening balance">
              <input
                onChange={(event) => setOpeningBalance(event.target.value)}
                required
                step="0.0001"
                type="number"
                value={openingBalance}
              />
            </BankField>
            <BankField label="Closing balance">
              <input
                onChange={(event) => setClosingBalance(event.target.value)}
                required
                step="0.0001"
                type="number"
                value={closingBalance}
              />
            </BankField>
          </div>
          <div
            className={
              Math.abs(calculatedClosing - Number(closingBalance || 0)) < 0.00005
                ? 'bank-balance-check is-balanced'
                : 'bank-balance-check'
            }
          >
            <span>Calculated closing balance</span>
            <strong>{formatMoney(calculatedClosing.toFixed(4))}</strong>
            <button onClick={() => setClosingBalance(calculatedClosing.toFixed(4))} type="button">
              Use calculated balance
            </button>
          </div>
        </section>

        <section className="bank-form-section">
          <header className="bank-lines-header">
            <span>2</span>
            <div>
              <h3>Transactions</h3>
              <p>
                Incoming references are checked against receivables; outgoing lines enter supplier
                review.
              </p>
            </div>
            <Button
              onClick={() => setLines((current) => [...current, newLine()])}
              type="button"
              variant="secondary"
            >
              <Icon name="plus" size={15} /> Add line
            </Button>
          </header>
          <div className="bank-line-list">
            {lines.map((line, index) => (
              <article className="bank-line-card" key={line.key}>
                <header>
                  <div className="bank-line-heading">
                    <strong>Transaction {index + 1}</strong>
                    <span>
                      {line.paymentReference
                        ? `Reference: ${line.paymentReference}`
                        : 'Enter this bank line separately'}
                    </span>
                  </div>
                  {lines.length > 1 ? (
                    <button
                      aria-label={`Remove transaction ${index + 1}`}
                      onClick={() =>
                        setLines((current) => current.filter(({ key }) => key !== line.key))
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  ) : null}
                </header>
                <div className="bank-form-grid">
                  <BankField label="Direction">
                    <select
                      aria-label={`Transaction ${index + 1} direction`}
                      onChange={(event) =>
                        updateLine(line.key, {
                          direction: event.target.value as DraftLine['direction'],
                        })
                      }
                      value={line.direction}
                    >
                      <option value="incoming">Incoming</option>
                      <option value="outgoing">Outgoing</option>
                    </select>
                  </BankField>
                  <BankField label="Amount">
                    <input
                      aria-label={`Transaction ${index + 1} amount`}
                      min="0.0001"
                      onChange={(event) => updateLine(line.key, { amount: event.target.value })}
                      required
                      step="0.0001"
                      type="number"
                      value={line.amount}
                    />
                  </BankField>
                  <BankField label="Transaction date">
                    <input
                      aria-label={`Transaction ${index + 1} transaction date`}
                      onChange={(event) =>
                        updateLine(line.key, { transactionDate: event.target.value })
                      }
                      required
                      type="date"
                      value={line.transactionDate}
                    />
                  </BankField>
                  <BankField label="Value date">
                    <input
                      aria-label={`Transaction ${index + 1} value date`}
                      onChange={(event) => updateLine(line.key, { valueDate: event.target.value })}
                      required
                      type="date"
                      value={line.valueDate}
                    />
                  </BankField>
                  <BankField label="Counterparty" wide>
                    <input
                      aria-label={`Transaction ${index + 1} counterparty`}
                      maxLength={255}
                      onChange={(event) =>
                        updateLine(line.key, { counterpartyName: event.target.value })
                      }
                      required
                      value={line.counterpartyName}
                    />
                  </BankField>
                  <BankField label="Counterparty IBAN (optional)" wide>
                    <input
                      aria-label={`Transaction ${index + 1} counterparty IBAN`}
                      maxLength={34}
                      onChange={(event) =>
                        updateLine(line.key, { counterpartyIban: event.target.value })
                      }
                      value={line.counterpartyIban ?? ''}
                    />
                  </BankField>
                  <BankField label="Payment reference" wide>
                    <textarea
                      aria-label={`Transaction ${index + 1} payment reference`}
                      maxLength={500}
                      onChange={(event) =>
                        updateLine(line.key, { paymentReference: event.target.value })
                      }
                      required
                      rows={2}
                      value={line.paymentReference}
                    />
                  </BankField>
                </div>
              </article>
            ))}
          </div>
        </section>
        <div className="bank-drawer-actions">
          <Button busy={busy} type="submit">
            Add statement
          </Button>
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
    </BankDrawer>
  );
}

function BankStatementDrawer({
  canEdit,
  onBack,
  onSaved,
  statement,
  token,
}: {
  canEdit: boolean;
  onBack: () => void;
  onSaved: (statement: FinanceBankStatement) => void;
  statement: FinanceBankStatement;
  token: string;
}) {
  const [matching, setMatching] = useState<FinanceBankTransaction | null>(null);
  const finishMatching = (next: FinanceBankStatement) => {
    setMatching(null);
    onSaved(next);
  };
  if (matching)
    return matching.direction === 'incoming' ? (
      <BankMatchDrawer
        onBack={() => setMatching(null)}
        onSaved={finishMatching}
        token={token}
        transaction={matching}
      />
    ) : (
      <SupplierBankMatchDrawer
        onBack={() => setMatching(null)}
        onSaved={finishMatching}
        statementId={statement.id}
        token={token}
        transaction={matching}
      />
    );
  return (
    <BankDrawer
      busy={false}
      onBack={onBack}
      subtitle={`${statement.bankName} · ${formatDate(statement.statementDate)}`}
      title={statement.number}
    >
      <div className="bank-preview">
        <section className="bank-preview-hero">
          <div>
            <BankStatus statement={statement} />
            <h3>{formatMoney(statement.closingBalance)}</h3>
            <p>
              {statement.statementReference} · {maskIban(statement.accountIban)}
            </p>
          </div>
          <dl>
            <div>
              <dt>Opening</dt>
              <dd>{formatMoney(statement.openingBalance)}</dd>
            </div>
            <div>
              <dt>Incoming</dt>
              <dd>{formatMoney(statement.incomingTotal)}</dd>
            </div>
            <div>
              <dt>Outgoing</dt>
              <dd>{formatMoney(statement.outgoingTotal)}</dd>
            </div>
          </dl>
        </section>
        <section className="bank-preview-section">
          <header>
            <div>
              <h3>Transactions</h3>
              <p>Matched transfers have generated payment and allocation records.</p>
            </div>
            <span>{statement.transactionCount}</span>
          </header>
          <div className="bank-transaction-list">
            {statement.transactions.map((transaction) => (
              <article className="bank-transaction-card" key={transaction.id}>
                <div className={`bank-direction is-${transaction.direction}`}>
                  {transaction.direction === 'incoming' ? '+' : '−'}
                </div>
                <div className="bank-transaction-main">
                  <strong>{transaction.counterpartyName}</strong>
                  <span>{transaction.paymentReference}</span>
                  <small>
                    {formatDate(transaction.valueDate)} · Line {transaction.lineNumber}
                  </small>
                  {transaction.match ? (
                    <p>
                      Matched to <strong>{transaction.match.documentNumber}</strong> ·{' '}
                      {transaction.match.paymentNumber} ·{' '}
                      {transaction.match.method === 'automatic_reference'
                        ? 'Reference matched automatically'
                        : 'Matched manually'}
                    </p>
                  ) : null}
                  {transaction.supplierMatch ? (
                    <p>
                      Matched to{' '}
                      <strong>
                        {transaction.supplierMatch.supplierPayableNumber ?? 'supplier advance'}
                      </strong>{' '}
                      · {transaction.supplierMatch.paymentNumber} · Matched manually
                    </p>
                  ) : null}
                </div>
                <div className="bank-transaction-value">
                  <strong>
                    {transaction.direction === 'incoming' ? '+' : '−'}
                    {formatMoney(transaction.amount)}
                  </strong>
                  <span
                    className={
                      transaction.matchStatus === 'matched' ? 'is-matched' : 'is-unmatched'
                    }
                  >
                    {transaction.matchStatus === 'matched' ? 'Matched' : 'Needs review'}
                  </span>
                  {canEdit && transaction.matchStatus === 'unmatched' ? (
                    <Button onClick={() => setMatching(transaction)} variant="quiet">
                      Review match
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </BankDrawer>
  );
}

function BankMatchDrawer({
  onBack,
  onSaved,
  token,
  transaction,
}: {
  onBack: () => void;
  onSaved: (statement: FinanceBankStatement) => void;
  token: string;
  transaction: FinanceBankTransaction;
}) {
  const [candidates, setCandidates] = useState<FinanceBankMatchCandidate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getFinanceBankMatchCandidates(token, transaction.id)
      .then((items) => {
        if (active) {
          setCandidates(items);
          setSelectedId(items[0]?.customerDocumentId ?? '');
        }
      })
      .catch((caught) => {
        if (active) setError(apiMessage(caught, 'Match suggestions could not be loaded.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, transaction.id]);
  async function match() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await matchFinanceBankTransaction(token, transaction.id, crypto.randomUUID(), {
          customerDocumentId: selectedId,
          expectedVersion: transaction.version,
        }),
      );
    } catch (caught) {
      setError(apiMessage(caught, 'The bank transfer could not be matched.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BankDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${transaction.counterpartyName} · ${formatMoney(transaction.amount)}`}
      title="Review transfer match"
    >
      <div className="bank-match-review">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="bank-match-source">
          <span>Payment reference</span>
          <strong>{transaction.paymentReference}</strong>
          <dl>
            <div>
              <dt>Amount</dt>
              <dd>{formatMoney(transaction.amount)}</dd>
            </div>
            <div>
              <dt>Value date</dt>
              <dd>{formatDate(transaction.valueDate)}</dd>
            </div>
          </dl>
        </section>
        <section className="bank-match-candidates">
          <header>
            <h3>Possible collection records</h3>
            <p>
              Reference, customer, and amount are used only to rank suggestions. You confirm the
              allocation.
            </p>
          </header>
          {loading ? (
            <p>Loading suggestions…</p>
          ) : candidates.length ? (
            candidates.map((candidate) => (
              <label
                className={selectedId === candidate.customerDocumentId ? 'is-selected' : undefined}
                key={candidate.customerDocumentId}
              >
                <input
                  checked={selectedId === candidate.customerDocumentId}
                  name="candidate"
                  onChange={() => setSelectedId(candidate.customerDocumentId)}
                  type="radio"
                />
                <div>
                  <strong>{candidate.documentNumber}</strong>
                  <span>
                    {candidate.customerName} · From {candidate.sourceInvoiceNumber}
                  </span>
                  <small>
                    Due {formatDate(candidate.dueDate)} · {formatMoney(candidate.outstandingTotal)}{' '}
                    outstanding
                  </small>
                </div>
                <span>
                  {candidate.referenceMatched
                    ? 'Reference match'
                    : candidate.score > 0
                      ? `${candidate.score}% match`
                      : 'Manual review'}
                </span>
              </label>
            ))
          ) : (
            <InlineAlert tone="warning">
              No open collection can accept this amount. Check the payment reference or create the
              collection record first.
            </InlineAlert>
          )}
        </section>
        <div className="bank-drawer-actions">
          <Button busy={busy} disabled={!selectedId} onClick={() => void match()}>
            Confirm match
          </Button>
          <Button disabled={busy} onClick={onBack} variant="secondary">
            Back
          </Button>
        </div>
      </div>
    </BankDrawer>
  );
}

function SupplierBankMatchDrawer({
  onBack,
  onSaved,
  statementId,
  token,
  transaction,
}: {
  onBack: () => void;
  onSaved: (statement: FinanceBankStatement) => void;
  statementId: string;
  token: string;
  transaction: FinanceBankTransaction;
}) {
  const [candidates, setCandidates] = useState<FinanceSupplierBankMatchCandidate[]>([]);
  const [references, setReferences] = useState<FinanceSupplierReferenceData>({
    businessDate: '',
    openReceivables: [],
    supplierInvoices: [],
    suppliers: [],
  });
  const [mode, setMode] = useState<'advance' | 'payable'>('payable');
  const [selectedPayableId, setSelectedPayableId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      getFinanceSupplierBankMatchCandidates(token, transaction.id),
      getFinanceSupplierReferenceData(token),
    ])
      .then(([items, nextReferences]) => {
        if (!active) return;
        setCandidates(items);
        setReferences(nextReferences);
        setSelectedPayableId(items[0]?.supplierPayableId ?? '');
        setSupplierId(items[0]?.supplierPartnerId ?? nextReferences.suppliers[0]?.id ?? '');
        if (!items.length) setMode('advance');
      })
      .catch((caught) => {
        if (active) setError(apiMessage(caught, 'Supplier match suggestions could not be loaded.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, transaction.id]);

  async function match() {
    if ((mode === 'payable' && !selectedPayableId) || (mode === 'advance' && !supplierId)) return;
    setBusy(true);
    setError(null);
    try {
      await matchFinanceSupplierBankTransaction(token, transaction.id, crypto.randomUUID(), {
        expectedVersion: transaction.version,
        mode,
        ...(mode === 'payable'
          ? { supplierPayableId: selectedPayableId }
          : { supplierPartnerId: supplierId }),
      });
      onSaved(await getFinanceBankStatement(token, statementId));
    } catch (caught) {
      setError(apiMessage(caught, 'The outgoing bank transfer could not be matched.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BankDrawer
      busy={busy}
      onBack={onBack}
      subtitle={`${transaction.counterpartyName} · ${formatMoney(transaction.amount)}`}
      title="Review supplier transfer"
    >
      <div className="bank-match-review supplier-bank-match-review">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="bank-match-source">
          <span>Payment reference</span>
          <strong>{transaction.paymentReference}</strong>
          <dl>
            <div>
              <dt>Outgoing amount</dt>
              <dd>{formatMoney(transaction.amount)}</dd>
            </div>
            <div>
              <dt>Value date</dt>
              <dd>{formatDate(transaction.valueDate)}</dd>
            </div>
          </dl>
        </section>
        <div aria-label="Supplier match type" className="bank-match-mode">
          <button
            className={mode === 'payable' ? 'is-active' : undefined}
            disabled={!candidates.length}
            onClick={() => setMode('payable')}
            type="button"
          >
            Match a payable
          </button>
          <button
            className={mode === 'advance' ? 'is-active' : undefined}
            onClick={() => setMode('advance')}
            type="button"
          >
            Keep as advance
          </button>
        </div>
        {loading ? (
          <p>Loading supplier balances…</p>
        ) : mode === 'payable' ? (
          <section className="bank-match-candidates">
            <header>
              <h3>Possible supplier payables</h3>
              <p>
                Reference, supplier, and amount rank the suggestions. You confirm the allocation.
              </p>
            </header>
            {candidates.map((candidate) => (
              <label
                className={
                  selectedPayableId === candidate.supplierPayableId ? 'is-selected' : undefined
                }
                key={candidate.supplierPayableId}
              >
                <input
                  checked={selectedPayableId === candidate.supplierPayableId}
                  name="supplier-candidate"
                  onChange={() => {
                    setSelectedPayableId(candidate.supplierPayableId);
                    setSupplierId(candidate.supplierPartnerId);
                  }}
                  type="radio"
                />
                <div>
                  <strong>{candidate.payableNumber}</strong>
                  <span>
                    {candidate.supplierName} · Invoice {candidate.sourceSupplierInvoiceNumber}
                  </span>
                  <small>
                    Due {formatDate(candidate.dueDate)} · {formatMoney(candidate.outstandingTotal)}{' '}
                    outstanding
                  </small>
                </div>
                <span>
                  {candidate.referenceMatched
                    ? 'Reference match'
                    : candidate.score > 0
                      ? `${candidate.score}% match`
                      : 'Manual review'}
                </span>
              </label>
            ))}
          </section>
        ) : (
          <section className="supplier-bank-advance-choice">
            <header>
              <h3>Supplier advance</h3>
              <p>
                The complete transfer remains available until it is deliberately applied to a
                payable.
              </p>
            </header>
            <label>
              <span>Supplier</span>
              <select onChange={(event) => setSupplierId(event.target.value)} value={supplierId}>
                {references.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}
        <div className="bank-drawer-actions">
          <Button
            busy={busy}
            disabled={loading || (mode === 'payable' ? !selectedPayableId : !supplierId)}
            onClick={() => void match()}
          >
            {mode === 'payable' ? 'Confirm supplier match' : 'Record supplier advance'}
          </Button>
          <Button disabled={busy} onClick={onBack} variant="secondary">
            Back
          </Button>
        </div>
      </div>
    </BankDrawer>
  );
}

function BankDrawer({
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
        aria-label="Back to bank reconciliation"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide bank-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header bank-drawer-header">
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
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function BankField({
  children,
  label,
  wide,
}: {
  children: ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'bank-field is-wide' : 'bank-field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function BankMetric({ label, tone, value }: { label: string; tone?: 'warning'; value: string }) {
  return (
    <div className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function BankStatus({
  statement,
}: {
  statement: Pick<FinanceBankStatementSummary, 'status' | 'unmatchedIncomingCount'>;
}) {
  return (
    <span className={`bank-status is-${statement.status}`}>
      {statement.status === 'reconciled'
        ? 'Reconciled'
        : `${statement.unmatchedIncomingCount} to review`}
    </span>
  );
}
function BankState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <section className="empty-state">
      <span className="empty-state-icon">
        <Icon name="finance" size={22} />
      </span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function useBankStatements(token: string) {
  const [items, setItems] = useState<FinanceBankStatementSummary[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const page = await listFinanceBankStatements(token);
      setItems(page.items);
      setTotalItems(page.totalItems);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  return { error, items, loading, reload: () => void load(), totalItems };
}

function newLine(): DraftLine {
  const date = today();
  return {
    amount: '',
    counterpartyName: '',
    direction: 'incoming',
    key: crypto.randomUUID(),
    paymentReference: '',
    transactionDate: date,
    valueDate: date,
  };
}
function signedAmount(line: DraftLine) {
  const amount = Number(line.amount || 0);
  return line.direction === 'incoming' ? amount : -amount;
}
function apiMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiClientError)) return fallback;
  return error.details[0]?.message ?? error.message;
}
function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
    new Date(`${value}T12:00:00Z`),
  );
}
function formatMoney(value: string) {
  return new Intl.NumberFormat('en-GB', { currency: 'BGN', style: 'currency' }).format(
    Number(value),
  );
}
function maskIban(value: string) {
  return value.length > 8 ? `${value.slice(0, 4)} ···· ${value.slice(-4)}` : value;
}
