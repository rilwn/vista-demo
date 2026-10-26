import { Button, Toast } from '@vista/ui';
import type {
  FinancialDocumentReferenceData,
  RecurringInvoiceContract,
  RecurringInvoicePage,
  RecurringInvoicePeriod,
  RecurringInvoiceProfileInput,
  VatTreatment,
} from '@vista/contracts';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ApiClientError } from '../api/client';
import { getFinancialDocumentReferenceData } from '../api/finance';
import {
  getRecurringInvoice,
  listRecurringInvoices,
  runRecurringInvoice,
  saveRecurringInvoice,
} from '../api/recurring-invoices';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import {
  formatOperationsCurrency,
  formatOperationsDate,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { useRouter } from '../routing/Router';
import { FinanceTabs } from './FinanceBankPage';
import { DocumentDrawer } from './FinancialDocumentDrawer';
import {
  recurringInvoiceMessages,
  type RecurringInvoiceMessages,
} from './recurring-invoice.messages';

export function RecurringInvoicesPage() {
  const { locale } = useLocalization();
  const copy = recurringInvoiceMessages(locale);
  const { session, hasPermission } = useAuth();
  const token = session?.sessionToken ?? '';
  const [data, setData] = useState<RecurringInvoicePage>();
  const [references, setReferences] = useState<FinancialDocumentReferenceData>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [revision, refresh] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RecurringInvoiceContract>();
  const changed = useCallback((record: RecurringInvoiceContract) => {
    setSelected(record);
    refresh((value) => value + 1);
  }, []);
  const canManage = hasPermission('erp.finance', 'create') && hasPermission('erp.finance', 'edit');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    void Promise.all([
      listRecurringInvoices(token, page, query),
      getFinancialDocumentReferenceData(token),
    ])
      .then(([result, refs]) => {
        if (active) {
          setData(result);
          setReferences(refs);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, page, query, revision]);
  return (
    <div className="page-stack recurring-invoices-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">ERP · {copy.finance}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
      </header>
      <FinanceTabs />
      <section className="recurring-register" aria-label={copy.title} aria-busy={loading}>
        <form
          className="recurring-register-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setQuery(search.trim());
            refresh((value) => value + 1);
          }}
        >
          <label>
            <Icon name="search" size={17} />
            <input
              aria-label={copy.search}
              placeholder={copy.search}
              maxLength={120}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Button variant="secondary" type="submit">
            {copy.apply}
          </Button>
        </form>
        {failed ? (
          <div className="recurring-empty" role="alert">
            <p>{copy.loadError}</p>
            <Button variant="secondary" onClick={() => refresh((value) => value + 1)}>
              {copy.retry}
            </Button>
          </div>
        ) : loading ? (
          <p className="recurring-empty" role="status">
            {copy.loading}
          </p>
        ) : !data?.items.length ? (
          <div className="recurring-empty">
            <strong>{copy.empty}</strong>
            <p>{copy.emptyHint}</p>
          </div>
        ) : (
          <>
            <div className="recurring-table-scroll">
              <table className="recurring-table">
                <thead>
                  <tr>
                    <th>{copy.contract}</th>
                    <th>{copy.charge}</th>
                    <th>{copy.nextDate}</th>
                    <th>{copy.setup}</th>
                    <th>
                      <span className="visually-hidden">{copy.preview}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((contract) => (
                    <tr key={contract.id}>
                      <td>
                        <strong>{contract.number}</strong>
                        <span>{contract.customerName}</span>
                        <small>{contract.customerLocationName}</small>
                      </td>
                      <td>
                        {formatOperationsCurrency(contract.billingAmount, contract.currencyCode)}
                      </td>
                      <td>{date(contract.nextBillingDate)}</td>
                      <td>
                        <span className={`recurring-status ${ready(contract) ? 'is-enabled' : ''}`}>
                          {statusLabel(contract, copy)}
                        </span>
                      </td>
                      <td>
                        <Button variant="secondary" onClick={() => setSelected(contract)}>
                          {copy.preview}
                          <Icon name="chevron" size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="recurring-pagination">
              <span>
                {copy.page} {data.page} {copy.of} {data.totalPages}
              </span>
              <div>
                <Button variant="quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {copy.previous}
                </Button>
                <Button
                  variant="quiet"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  {copy.next}
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>
      {selected && references ? (
        <RecurringDrawer
          key={selected.id}
          contract={selected}
          references={references}
          token={token}
          copy={copy}
          canManage={canManage}
          onBack={() => setSelected(undefined)}
          onChanged={changed}
        />
      ) : null}
    </div>
  );
}

function RecurringDrawer({
  contract,
  references,
  token,
  copy,
  canManage,
  onBack,
  onChanged,
}: {
  contract: RecurringInvoiceContract;
  references: FinancialDocumentReferenceData;
  token: string;
  copy: RecurringInvoiceMessages;
  canManage: boolean;
  onBack: () => void;
  onChanged: (record: RecurringInvoiceContract) => void;
}) {
  const { navigate } = useRouter();
  const [editing, setEditing] = useState(!contract.profile && canManage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const runKey = useRef<string | undefined>(undefined);
  // Refresh before editing so a background run cannot leave stale billing history in the panel.
  const reload = useCallback(
    async () => onChanged(await getRecurringInvoice(token, contract.id)),
    [onChanged, token, contract.id],
  );
  useEffect(() => {
    if (editing || busy || !ready(contract)) return;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: references.businessTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const waiting = contract.periods.some(
      (period) =>
        period.status === 'waiting' &&
        period.billingDate >= contract.profile!.firstBillingDate &&
        period.billingDate <= today,
    );
    if (!waiting) return;
    let active = true;
    const timer = setTimeout(() => {
      void getRecurringInvoice(token, contract.id)
        .then((record) => {
          if (active) onChanged(record);
        })
        .catch(() => {
          if (active) setError(copy.loadError);
        });
    }, 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [contract, token, editing, busy, onChanged, copy.loadError, references.businessTimezone]);
  async function run() {
    setBusy(true);
    setError('');
    setNotice('');
    runKey.current ??= crypto.randomUUID();
    try {
      const result = await runRecurringInvoice(token, contract.id, runKey.current);
      runKey.current = undefined;
      await reload();
      setNotice(
        result.issuedCount + result.retryCount + result.reviewCount ? copy.processed : copy.noDue,
      );
    } catch (cause) {
      setError(errorText(cause, copy, copy.runError));
    } finally {
      setBusy(false);
    }
  }
  const profile = contract.profile;
  const scope = references.scopes.find((item) => item.locationId === profile?.businessLocationId);
  return (
    <DocumentDrawer
      busy={busy}
      className="recurring-invoice-drawer"
      backLabel={copy.back}
      onBack={onBack}
      title={editing ? copy.settings : contract.number}
      subtitle={`${contract.customerName} · ${contract.customerLocationName}`}
    >
      {notice ? (
        <Toast tone="success" onDismiss={() => setNotice('')}>
          {notice}
        </Toast>
      ) : null}
      {editing ? (
        <SettingsForm
          contract={contract}
          references={references}
          token={token}
          copy={copy}
          busy={busy}
          setBusy={setBusy}
          onBack={() => (contract.profile ? setEditing(false) : onBack())}
          onSaved={(record) => {
            onChanged(record);
            setEditing(false);
            setNotice(copy.saved);
          }}
        />
      ) : (
        <div className="financial-document-preview recurring-preview">
          <div className="recurring-drawer-scroll">
            {error ? (
              <p className="recurring-warning" role="alert">
                {error}
              </p>
            ) : null}
            <section className="financial-document-preview-section recurring-summary">
              <div>
                <span>{copy.charge}</span>
                <strong>
                  {formatOperationsCurrency(contract.billingAmount, contract.currencyCode)}
                </strong>
              </div>
              <span className={`recurring-status ${ready(contract) ? 'is-enabled' : ''}`}>
                {statusLabel(contract, copy)}
              </span>
            </section>
            {!contract.active ||
            (profile?.enabled && profile.contractVersion !== contract.contractVersion) ? (
              <p className="recurring-warning">{!contract.active ? copy.inactive : copy.changed}</p>
            ) : null}
            <section className="financial-document-preview-section recurring-settings">
              <header>
                <h3>{copy.settings}</h3>
                {canManage ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setError('');
                      setEditing(true);
                    }}
                  >
                    {profile ? copy.edit : copy.configure}
                  </Button>
                ) : null}
              </header>
              {profile ? (
                <dl>
                  <div>
                    <dt>{copy.scope}</dt>
                    <dd>
                      {scope ? `${scope.legalEntityName} · ${scope.locationName}` : copy.none}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.firstDate}</dt>
                    <dd>{date(profile.firstBillingDate)}</dd>
                  </div>
                  <div>
                    <dt>{copy.terms}</dt>
                    <dd>{profile.paymentTermsDays}</dd>
                  </div>
                  <div>
                    <dt>{copy.vat}</dt>
                    <dd>
                      {copy[profile.vatTreatment]}
                      {profile.vatRate ? ` · ${profile.vatRate}%` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.approvedBy}</dt>
                    <dd>{profile.approvedByName}</dd>
                  </div>
                </dl>
              ) : (
                <p>{copy.disabled}</p>
              )}
              <p>{copy.enabledHelp}</p>
              <p>{copy.approver}</p>
            </section>
            <section className="financial-document-preview-section recurring-periods">
              <header>
                <h3>{copy.periodTitle}</h3>
              </header>
              <p>{copy.periodHelp}</p>
              {!contract.periods.length ? (
                <p>{copy.noPeriods}</p>
              ) : (
                <ul>
                  {contract.periods.map((period) => (
                    <li key={period.id}>
                      <div className="recurring-period-heading">
                        <div>
                          <strong>
                            {date(period.servicePeriodStart)} – {date(period.servicePeriodEnd)}
                          </strong>
                          <small>
                            {copy.billingDate}: {date(period.billingDate)}
                          </small>
                        </div>
                        <span
                          className={`recurring-status ${period.status === 'issued' ? 'is-enabled' : period.status === 'needs_review' || period.status === 'manual_review' ? 'is-review' : ''}`}
                        >
                          {period.status === 'retry' ? copy.retryStatus : copy[period.status]}
                        </span>
                      </div>
                      <div className="recurring-period-amount">
                        <span>
                          {formatOperationsCurrency(period.amount, period.currencyCode)} ·{' '}
                          {copy.charge}
                        </span>
                        {period.document ? (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              navigate('/modules/erp.finance/invoices', {
                                state: { financialDocumentId: period.document!.id },
                              })
                            }
                          >
                            {copy.open} · {period.document.number}
                          </Button>
                        ) : canManage && period.status === 'needs_review' ? (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              navigate('/modules/erp.finance/invoices', {
                                state: { subscriptionDraftId: period.id },
                              })
                            }
                          >
                            {copy.manual}
                          </Button>
                        ) : null}
                      </div>
                      {period.status !== 'issued' && period.status !== 'waiting' ? (
                        <p className="recurring-period-note">{periodMessage(period, copy)}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <div className="financial-document-form-actions">
            <Button variant="secondary" disabled={busy} onClick={onBack}>
              {copy.back}
            </Button>
            {canManage && ready(contract) ? (
              <Button disabled={busy} onClick={() => void run()}>
                {busy ? copy.running : copy.run}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </DocumentDrawer>
  );
}

function SettingsForm({
  contract,
  references,
  token,
  copy,
  busy,
  setBusy,
  onBack,
  onSaved,
}: {
  contract: RecurringInvoiceContract;
  references: FinancialDocumentReferenceData;
  token: string;
  copy: RecurringInvoiceMessages;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onBack: () => void;
  onSaved: (record: RecurringInvoiceContract) => void;
}) {
  const initialScope =
    references.scopes.find((item) => item.locationId === contract.profile?.businessLocationId) ??
    references.scopes[0];
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: references.businessTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [form, setForm] = useState<RecurringInvoiceProfileInput>(() => ({
    enabled: contract.active && (contract.profile?.enabled ?? true),
    legalEntityId: initialScope?.legalEntityId ?? '',
    businessLocationId: initialScope?.locationId ?? '',
    firstBillingDate:
      contract.profile?.firstBillingDate ??
      (contract.nextBillingDate > today ? contract.nextBillingDate : today),
    paymentTermsDays: contract.profile?.paymentTermsDays ?? 14,
    vatTreatment: contract.profile?.vatTreatment ?? 'standard_20',
    contractVersion: contract.contractVersion,
    ...(contract.profile ? { expectedVersion: contract.profile.version } : {}),
    ...(contract.profile?.cashRegisterId
      ? { cashRegisterId: contract.profile.cashRegisterId }
      : {}),
    ...(contract.profile?.operatorId ? { operatorId: contract.profile.operatorId } : {}),
    ...(contract.profile?.vatRate ? { vatRate: contract.profile.vatRate } : {}),
  }));
  const scope = references.scopes.find((item) => item.locationId === form.businessLocationId);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState('');
  const key = useRef<{ payload: string; value: string } | undefined>(undefined);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (form.enabled && !approved)) return;
    const payload = JSON.stringify(form);
    if (key.current?.payload !== payload) key.current = { payload, value: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      onSaved(await saveRecurringInvoice(token, contract.id, form, key.current.value));
    } catch (cause) {
      setError(errorText(cause, copy, copy.saveError));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="financial-document-form recurring-settings-form"
      onSubmit={(event) => void submit(event)}
    >
      <div className="recurring-drawer-scroll">
        {error ? (
          <p className="recurring-warning" role="alert">
            {error}
          </p>
        ) : null}
        <section className="financial-document-form-section">
          <header>
            <span>1</span>
            <h3>{copy.invoiceDetails}</h3>
          </header>
          <div className="recurring-charge-line">
            <span>{copy.charge}</span>
            <strong>
              {formatOperationsCurrency(contract.billingAmount, contract.currencyCode)}
            </strong>
          </div>
          <div className="financial-document-form-grid">
            <Field label={copy.scope} wide>
              <select
                required
                aria-label={copy.scope}
                value={form.businessLocationId}
                onChange={(event) => {
                  const next = references.scopes.find(
                    (item) => item.locationId === event.target.value,
                  );
                  setForm((current) => {
                    const result = {
                      ...current,
                      businessLocationId: next?.locationId ?? '',
                      legalEntityId: next?.legalEntityId ?? '',
                    };
                    delete result.cashRegisterId;
                    delete result.operatorId;
                    return result;
                  });
                }}
              >
                <option value="">{copy.chooseScope}</option>
                {references.scopes.map((item) => (
                  <option key={item.locationId} value={item.locationId}>
                    {item.legalEntityName} · {item.locationName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={copy.register}>
              <select
                aria-label={copy.register}
                value={form.cashRegisterId ?? ''}
                onChange={(event) =>
                  setForm((current) => {
                    const result = { ...current };
                    if (event.target.value) result.cashRegisterId = event.target.value;
                    else delete result.cashRegisterId;
                    return result;
                  })
                }
              >
                <option value="">{copy.none}</option>
                {scope?.cashRegisters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={copy.operator}>
              <select
                aria-label={copy.operator}
                value={form.operatorId ?? ''}
                onChange={(event) =>
                  setForm((current) => {
                    const result = { ...current };
                    if (event.target.value) result.operatorId = event.target.value;
                    else delete result.operatorId;
                    return result;
                  })
                }
              >
                <option value="">{copy.none}</option>
                {scope?.operators.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={copy.firstDate}>
              <input
                type="date"
                required
                min={contract.profile?.firstBillingDate ?? today}
                value={form.firstBillingDate}
                onChange={(event) => setForm({ ...form, firstBillingDate: event.target.value })}
              />
              <small>{copy.firstDateHint}</small>
            </Field>
            <Field label={copy.terms}>
              <input
                type="number"
                required
                min={0}
                max={3650}
                step={1}
                value={form.paymentTermsDays}
                onChange={(event) =>
                  setForm({ ...form, paymentTermsDays: event.target.valueAsNumber })
                }
              />
            </Field>
            <Field label={copy.vat}>
              <select
                aria-label={copy.vat}
                value={form.vatTreatment}
                onChange={(event) =>
                  setForm((current) => {
                    const result = { ...current, vatTreatment: event.target.value as VatTreatment };
                    if (result.vatTreatment === 'ica') result.vatRate = '20';
                    else delete result.vatRate;
                    return result;
                  })
                }
              >
                {(['standard_20', 'reduced_9', 'zero', 'exempt', 'ica'] as const).map((vat) => (
                  <option key={vat} value={vat}>
                    {copy[vat]}
                  </option>
                ))}
              </select>
            </Field>
            {form.vatTreatment === 'ica' ? (
              <Field label={copy.rate}>
                <input
                  type="number"
                  required
                  min={0}
                  max={100}
                  step="0.0001"
                  value={form.vatRate ?? ''}
                  onChange={(event) => setForm({ ...form, vatRate: event.target.value })}
                />
              </Field>
            ) : null}
          </div>
        </section>
        <section className="financial-document-form-section">
          <header>
            <span>2</span>
            <h3>{copy.setup}</h3>
          </header>
          <label className="recurring-checkbox">
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={!contract.active}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            <span>{copy.enable}</span>
          </label>
          <p>{copy.manualHelp}</p>
          <p>{copy.approver}</p>
          {form.enabled ? (
            <label className="recurring-checkbox">
              <input
                type="checkbox"
                required
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />
              <span>{copy.approval}</span>
            </label>
          ) : null}
        </section>
      </div>
      <div className="financial-document-form-actions">
        <Button disabled={busy} variant="secondary" onClick={onBack}>
          {copy.back}
        </Button>
        <Button type="submit" disabled={busy || !scope || (form.enabled && !approved)}>
          {busy ? copy.saving : copy.save}
        </Button>
      </div>
    </form>
  );
}

function Field({ children, label, wide }: { children: ReactNode; label: string; wide?: boolean }) {
  const id = useId();
  return (
    <label className={`financial-document-field${wide ? ' is-wide' : ''}`}>
      <span id={id}>{label}</span>
      {children}
    </label>
  );
}
function ready(contract: RecurringInvoiceContract) {
  return (
    contract.active &&
    contract.profile?.enabled &&
    contract.profile.contractVersion === contract.contractVersion
  );
}
function statusLabel(contract: RecurringInvoiceContract, copy: RecurringInvoiceMessages) {
  return !contract.active
    ? copy.inactive
    : contract.profile?.enabled
      ? contract.profile.contractVersion === contract.contractVersion
        ? copy.enabled
        : copy.review
      : copy.disabled;
}
function date(value: string) {
  return formatOperationsDate(new Date(`${value}T12:00:00Z`), {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
function periodMessage(period: RecurringInvoicePeriod, copy: RecurringInvoiceMessages) {
  if (period.status === 'manual_review' || period.errorCode === 'FINANCE_RECURRING_MANUAL_DRAFT')
    return copy.manualDraft;
  if (period.errorCode === 'RECURRING_ACCESS_CHANGED') return copy.accessChanged;
  if (period.errorCode === 'RECURRING_CONTRACT_CHANGED') return copy.changed;
  if (period.errorCode === 'RECURRING_BILLING_CHANGED') return copy.sourceChanged;
  return copy.failure;
}
function errorText(cause: unknown, copy: RecurringInvoiceMessages, fallback: string) {
  if (!(cause instanceof ApiClientError)) return fallback;
  if (cause.status === 403) return copy.permissionError;
  return (
    (
      {
        RECURRING_VERSION_CONFLICT: copy.conflict,
        RECURRING_START_DATE_INVALID: copy.dateError,
        RECURRING_CONTRACT_UNAVAILABLE: copy.unavailable,
        RECURRING_VAT_RATE_REQUIRED: copy.rateError,
      } as Record<string, string>
    )[cause.code] ?? fallback
  );
}
