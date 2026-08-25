import { Button, InlineAlert } from '@vista/ui';
import type {
  CreateFinanceReportExportRequest,
  FinanceAgingKind,
  FinanceAgingReport,
  FinanceAgingReportItem,
  FinanceReportDefinition,
  FinanceReportDefinitionKey,
  FinanceReportExport,
  FinanceTurnoverKind,
  FinanceTurnoverReport,
  ReportExportFormat,
} from '@vista/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createFinanceReportExport,
  downloadFinanceReportExport,
  getFinanceAgingReport,
  getFinanceReportDefinitions,
  getFinanceTurnoverReport,
  listFinanceReportExports,
  retryFinanceReportExport,
} from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { FinanceTabs } from './FinanceBankPage';

type ReportView = 'aging' | 'turnover';

export function FinanceReportsPage() {
  const { session } = useAuth();
  const token = session?.sessionToken ?? '';
  const [view, setView] = useState<ReportView>('aging');
  const [agingKind, setAgingKind] = useState<FinanceAgingKind>('receivable');
  const [turnoverKind, setTurnoverKind] = useState<FinanceTurnoverKind>('customer');
  const initialDates = useMemo(() => reportDates(), []);
  const [dateFrom, setDateFrom] = useState(initialDates.dateFrom);
  const [dateTo, setDateTo] = useState(initialDates.dateTo);
  const [exportOpen, setExportOpen] = useState(false);
  const currentDefinition: FinanceReportDefinitionKey =
    view === 'aging'
      ? agingKind === 'receivable'
        ? 'finance.receivables-aging'
        : 'finance.supplier-payables-aging'
      : turnoverKind === 'customer'
        ? 'finance.customer-turnover'
        : 'finance.supplier-turnover';

  return (
    <div className="page-stack finance-report-workspace">
      <header className="page-header finance-report-header">
        <div>
          <p className="page-eyebrow">ERP · Finance</p>
          <h1>Balances &amp; turnover</h1>
          <p>Review current customer and supplier exposure, then compare document turnover.</p>
        </div>
        <Button onClick={() => setExportOpen(true)}>
          <Icon name="chart" size={16} /> Export report
        </Button>
      </header>

      <FinanceTabs />

      <InlineAlert tone="info">
        These reports support day-to-day balance checks in BGN. Official sales and purchase
        journals, VAT reports, and accounting files will be added after their formats are approved.
      </InlineAlert>

      <div aria-label="Finance report" className="finance-report-switch" role="tablist">
        <button
          aria-selected={view === 'aging'}
          className={view === 'aging' ? 'is-active' : undefined}
          onClick={() => setView('aging')}
          role="tab"
          type="button"
        >
          Aging &amp; balances
        </button>
        <button
          aria-selected={view === 'turnover'}
          className={view === 'turnover' ? 'is-active' : undefined}
          onClick={() => setView('turnover')}
          role="tab"
          type="button"
        >
          Turnover by partner
        </button>
      </div>

      {view === 'aging' ? (
        <AgingView kind={agingKind} onKindChange={setAgingKind} token={token} />
      ) : (
        <TurnoverView
          dateFrom={dateFrom}
          dateTo={dateTo}
          kind={turnoverKind}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onKindChange={setTurnoverKind}
          token={token}
        />
      )}

      {exportOpen ? (
        <ReportExportPanel
          dateFrom={dateFrom}
          dateTo={dateTo}
          defaultDefinition={currentDefinition}
          onBack={() => setExportOpen(false)}
          token={token}
        />
      ) : null}
    </div>
  );
}

function ReportExportPanel({
  dateFrom: initialDateFrom,
  dateTo: initialDateTo,
  defaultDefinition,
  onBack,
  token,
}: {
  dateFrom: string;
  dateTo: string;
  defaultDefinition: FinanceReportDefinitionKey;
  onBack: () => void;
  token: string;
}) {
  const [definitions, setDefinitions] = useState<FinanceReportDefinition[]>([]);
  const [exports, setExports] = useState<FinanceReportExport[]>([]);
  const [definitionKey, setDefinitionKey] = useState<FinanceReportDefinitionKey>(defaultDefinition);
  const [format, setFormat] = useState<ReportExportFormat>('xlsx');
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const definition = definitions.find((item) => item.key === definitionKey);

  const load = useCallback(async () => {
    const [available, recent] = await Promise.all([
      getFinanceReportDefinitions(token),
      listFinanceReportExports(token),
    ]);
    setDefinitions(available);
    setExports(recent.items);
  }, [token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load()
      .catch((caught) => {
        if (active) setError(errorMessage(caught, 'Reports could not be loaded.'));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    if (!exports.some((item) => item.status === 'queued' || item.status === 'processing')) return;
    const timer = window.setInterval(() => {
      void listFinanceReportExports(token)
        .then((page) => setExports(page.items))
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [exports, token]);

  async function createExport() {
    if (!definition) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const input: CreateFinanceReportExportRequest = {
        definitionKey,
        format,
        ...(definition.requiresDateRange ? { dateFrom, dateTo } : {}),
      };
      await createFinanceReportExport(token, crypto.randomUUID(), input);
      const recent = await listFinanceReportExports(token);
      setExports(recent.items);
      setMessage('Your report is being prepared. It will appear below when it is ready.');
    } catch (caught) {
      setError(errorMessage(caught, 'The report could not be prepared.'));
    } finally {
      setBusy(false);
    }
  }

  async function download(report: FinanceReportExport) {
    setDownloadingId(report.id);
    setError(null);
    try {
      const blob = await downloadFinanceReportExport(token, report);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = report.fileName ?? `${report.name}.${report.format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(errorMessage(caught, 'The report could not be downloaded.'));
    } finally {
      setDownloadingId(null);
    }
  }

  async function retry(report: FinanceReportExport) {
    setBusy(true);
    setError(null);
    try {
      await retryFinanceReportExport(token, report.id);
      const recent = await listFinanceReportExports(token);
      setExports(recent.items);
      setMessage('We are preparing the report again.');
    } catch (caught) {
      setError(errorMessage(caught, 'The report could not be started again.'));
    } finally {
      setBusy(false);
    }
  }

  const validDates =
    !definition?.requiresDateRange || (!!dateFrom && !!dateTo && dateFrom <= dateTo);

  return (
    <div className="security-drawer-layer">
      <button
        aria-label="Back to Finance reports"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label="Export report"
        aria-modal="true"
        className="security-drawer report-export-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header">
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
            <h2>Export report</h2>
            <p>Choose the report and file type. You can leave this panel while it is prepared.</p>
          </div>
        </header>
        <div className="security-drawer-body report-export-drawer-body">
          {loading ? <ReportState title="Loading reports" /> : null}
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          {message ? <InlineAlert tone="success">{message}</InlineAlert> : null}

          {!loading ? (
            <section className="report-export-form" aria-label="Report options">
              <div className="report-export-field">
                <label htmlFor="finance-report-export-definition">Report</label>
                <select
                  id="finance-report-export-definition"
                  onChange={(event) =>
                    setDefinitionKey(event.target.value as FinanceReportDefinitionKey)
                  }
                  value={definitionKey}
                >
                  {definitions.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <small>{definition?.description}</small>
              </div>

              <fieldset>
                <legend>File type</legend>
                <div className="report-export-format-grid">
                  {(definition?.formats ?? ['xlsx', 'csv', 'pdf']).map((item) => (
                    <label className={format === item ? 'is-selected' : undefined} key={item}>
                      <input
                        checked={format === item}
                        name="report-format"
                        onChange={() => setFormat(item)}
                        type="radio"
                        value={item}
                      />
                      <strong>{formatLabel(item)}</strong>
                      <small>{formatDescription(item)}</small>
                    </label>
                  ))}
                </div>
              </fieldset>

              {definition?.requiresDateRange ? (
                <div className="report-export-dates">
                  <label>
                    <span>From</span>
                    <input
                      onChange={(event) => setDateFrom(event.target.value)}
                      type="date"
                      value={dateFrom}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      onChange={(event) => setDateTo(event.target.value)}
                      type="date"
                      value={dateTo}
                    />
                  </label>
                </div>
              ) : (
                <p className="report-export-as-of">
                  <Icon name="check" size={15} /> Uses today’s open balances
                </p>
              )}
            </section>
          ) : null}

          <section className="report-export-history" aria-label="Recent exports">
            <header>
              <div>
                <h3>Recent exports</h3>
                <p>Only reports requested from your account are shown.</p>
              </div>
              <button disabled={loading} onClick={() => void load()} type="button">
                Refresh
              </button>
            </header>
            {!loading && !exports.length ? (
              <div className="report-export-empty">
                <Icon name="chart" size={20} />
                <strong>No exports yet</strong>
                <span>Your completed reports will stay available here.</span>
              </div>
            ) : null}
            <div className="report-export-list">
              {exports.map((report) => (
                <article key={report.id}>
                  <div className={`report-export-file-mark is-${report.format}`}>
                    {report.format.toUpperCase()}
                  </div>
                  <div>
                    <strong>{report.name}</strong>
                    <span>
                      {formatExportDate(report.createdAt)}
                      {report.rowCount === undefined ? '' : ` · ${report.rowCount} records`}
                      {report.sizeBytes === undefined
                        ? ''
                        : ` · ${formatFileSize(report.sizeBytes)}`}
                    </span>
                  </div>
                  <ExportStatus status={report.status} />
                  {report.status === 'completed' ? (
                    <Button
                      busy={downloadingId === report.id}
                      onClick={() => void download(report)}
                      variant="secondary"
                    >
                      Download
                    </Button>
                  ) : report.status === 'failed' ? (
                    <Button disabled={busy} onClick={() => void retry(report)} variant="secondary">
                      Try again
                    </Button>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <div className="security-drawer-actions report-export-actions">
            <Button
              busy={busy}
              disabled={loading || !definition || !validDates}
              onClick={() => void createExport()}
            >
              Prepare export
            </Button>
            <Button disabled={busy} onClick={onBack} variant="secondary">
              Close
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ExportStatus({ status }: { status: FinanceReportExport['status'] }) {
  const labels: Record<FinanceReportExport['status'], string> = {
    completed: 'Ready',
    failed: 'Needs attention',
    processing: 'Preparing',
    queued: 'Preparing',
  };
  return <span className={`report-export-status is-${status}`}>{labels[status]}</span>;
}

function formatLabel(format: ReportExportFormat): string {
  return { csv: 'CSV', pdf: 'PDF', xlsx: 'Excel' }[format];
}

function formatDescription(format: ReportExportFormat): string {
  return {
    csv: 'For data exchange',
    pdf: 'For sharing or printing',
    xlsx: 'For working in a spreadsheet',
  }[format];
}

function formatExportDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatFileSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function AgingView({
  kind,
  onKindChange,
  token,
}: {
  kind: FinanceAgingKind;
  onKindChange: (kind: FinanceAgingKind) => void;
  token: string;
}) {
  const [page, setPage] = useState(1);
  const data = useAging(token, kind, page);

  useEffect(() => setPage(1), [kind]);

  return (
    <section aria-label="Aging and balances" className="finance-report-body">
      <div className="finance-report-toolbar">
        <div>
          <span>Register</span>
          <strong>{kind === 'receivable' ? 'Customer receivables' : 'Supplier payables'}</strong>
        </div>
        <div aria-label="Balance register" className="finance-report-toggle">
          <button
            className={kind === 'receivable' ? 'is-active' : undefined}
            onClick={() => onKindChange('receivable')}
            type="button"
          >
            Receivables
          </button>
          <button
            className={kind === 'payable' ? 'is-active' : undefined}
            onClick={() => onKindChange('payable')}
            type="button"
          >
            Payables
          </button>
        </div>
      </div>

      {data.loading ? <ReportState title="Loading balances" /> : null}
      {data.error ? <ReportError message={data.error} onRetry={data.reload} /> : null}
      {data.report ? (
        <>
          <p className="finance-report-caption">
            Current balances as of {formatDate(data.report.asOf)}
          </p>
          <AgingSummary report={data.report} />
          <AgingRegister report={data.report} />
          <ReportPagination
            page={data.report.page}
            totalPages={data.report.totalPages}
            onPage={setPage}
          />
        </>
      ) : null}
    </section>
  );
}

function AgingSummary({ report }: { report: FinanceAgingReport }) {
  const metrics = [
    ['Total open', report.totals.total],
    ['Not due', report.totals.current],
    ['0–30 days', report.totals.days0To30],
    ['31–60 days', report.totals.days31To60],
    ['61–90 days', report.totals.days61To90],
    ['Over 90 days', report.totals.over90],
  ];
  return (
    <div aria-label="Aging totals" className="finance-aging-summary">
      {metrics.map(([label, value], index) => (
        <div className={index === 0 ? 'is-total' : undefined} key={label}>
          <span>{label}</span>
          <strong>{formatMoney(value ?? '0')}</strong>
        </div>
      ))}
    </div>
  );
}

function AgingRegister({ report }: { report: FinanceAgingReport }) {
  if (!report.items.length)
    return (
      <ReportState title={`No open ${report.kind === 'receivable' ? 'receivables' : 'payables'}`} />
    );
  return (
    <div className="finance-report-register">
      <div aria-hidden="true" className="finance-report-register-head">
        <span>Document</span>
        <span>Partner</span>
        <span>Due</span>
        <span>Aging</span>
        <span>Outstanding</span>
      </div>
      {report.items.map((item) => (
        <article className="finance-report-register-row" key={item.id}>
          <div className="finance-report-document">
            <span>{report.kind === 'receivable' ? 'AR' : 'AP'}</span>
            <div>
              <strong>{item.number}</strong>
              <small>Source {item.sourceNumber}</small>
            </div>
          </div>
          <div className="finance-report-partner">
            <strong>{item.partnerName}</strong>
            <small>Original {formatMoney(item.originalBgnTotal)}</small>
          </div>
          <div className="finance-report-due">
            <strong>{formatDate(item.dueDate)}</strong>
            <small>{item.daysOverdue ? `${item.daysOverdue} days overdue` : 'Not overdue'}</small>
          </div>
          <AgingBadge item={item} />
          <strong className="finance-report-amount">{formatMoney(item.outstandingBgnTotal)}</strong>
        </article>
      ))}
    </div>
  );
}

function AgingBadge({ item }: { item: FinanceAgingReportItem }) {
  const labels: Record<FinanceAgingReportItem['bucket'], string> = {
    current: 'Not due',
    days_0_30: '0–30 days',
    days_31_60: '31–60 days',
    days_61_90: '61–90 days',
    over_90: 'Over 90 days',
  };
  return <span className={`finance-aging-badge is-${item.bucket}`}>{labels[item.bucket]}</span>;
}

function TurnoverView({
  dateFrom,
  dateTo,
  kind,
  onDateFromChange,
  onDateToChange,
  onKindChange,
  token,
}: {
  dateFrom: string;
  dateTo: string;
  kind: FinanceTurnoverKind;
  onDateFromChange: (date: string) => void;
  onDateToChange: (date: string) => void;
  onKindChange: (kind: FinanceTurnoverKind) => void;
  token: string;
}) {
  const [filters, setFilters] = useState({ dateFrom, dateTo, kind });
  const [page, setPage] = useState(1);
  const data = useTurnover(token, filters.kind, filters.dateFrom, filters.dateTo, page);

  function apply() {
    setPage(1);
    setFilters({ dateFrom, dateTo, kind });
  }

  return (
    <section aria-label="Turnover by partner" className="finance-report-body">
      <div className="finance-report-toolbar is-filter">
        <div className="finance-report-toggle">
          <button
            className={kind === 'customer' ? 'is-active' : undefined}
            onClick={() => onKindChange('customer')}
            type="button"
          >
            Customers
          </button>
          <button
            className={kind === 'supplier' ? 'is-active' : undefined}
            onClick={() => onKindChange('supplier')}
            type="button"
          >
            Suppliers
          </button>
        </div>
        <label>
          <span>From</span>
          <input
            onChange={(event) => onDateFromChange(event.target.value)}
            type="date"
            value={dateFrom}
          />
        </label>
        <label>
          <span>To</span>
          <input
            onChange={(event) => onDateToChange(event.target.value)}
            type="date"
            value={dateTo}
          />
        </label>
        <Button
          disabled={!dateFrom || !dateTo || dateFrom > dateTo}
          onClick={apply}
          variant="secondary"
        >
          <Icon name="search" size={16} /> Apply
        </Button>
      </div>

      {data.loading ? <ReportState title="Loading turnover" /> : null}
      {data.error ? <ReportError message={data.error} onRetry={data.reload} /> : null}
      {data.report ? (
        <>
          <p className="finance-report-caption">
            Documents dated {formatDate(data.report.dateFrom)}–{formatDate(data.report.dateTo)}.
            Allocated and outstanding values are the current balances of those documents.
          </p>
          <div aria-label="Turnover totals" className="finance-turnover-summary">
            <ReportMetric label="Documents" value={String(data.report.totals.documentCount)} />
            <ReportMetric
              label="Gross turnover"
              value={formatMoney(data.report.totals.grossBgnTotal)}
            />
            <ReportMetric
              label="Currently allocated"
              value={formatMoney(data.report.totals.allocatedBgnTotal)}
            />
            <ReportMetric
              label="Current balance"
              value={formatMoney(data.report.totals.outstandingBgnTotal)}
            />
          </div>
          <TurnoverRegister report={data.report} />
          <ReportPagination
            page={data.report.page}
            totalPages={data.report.totalPages}
            onPage={setPage}
          />
        </>
      ) : null}
    </section>
  );
}

function TurnoverRegister({ report }: { report: FinanceTurnoverReport }) {
  if (!report.items.length) return <ReportState title="No documents in this period" />;
  return (
    <div className="finance-report-register">
      <div aria-hidden="true" className="finance-turnover-register-head">
        <span>Partner</span>
        <span>Documents</span>
        <span>Gross turnover</span>
        <span>Currently allocated</span>
        <span>Current balance</span>
      </div>
      {report.items.map((item) => (
        <article className="finance-turnover-register-row" key={item.partnerId}>
          <div className="finance-report-partner">
            <strong>{item.partnerName}</strong>
            <small>{report.kind === 'customer' ? 'Customer account' : 'Supplier account'}</small>
          </div>
          <strong>{item.documentCount}</strong>
          <strong>{formatMoney(item.grossBgnTotal)}</strong>
          <span>{formatMoney(item.allocatedBgnTotal)}</span>
          <strong className="finance-report-amount">{formatMoney(item.outstandingBgnTotal)}</strong>
        </article>
      ))}
    </div>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportPagination({
  onPage,
  page,
  totalPages,
}: {
  onPage: (page: number) => void;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  return (
    <footer className="finance-report-pagination">
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)} variant="quiet">
        Previous
      </Button>
      <span>
        Page {page} of {totalPages}
      </span>
      <Button disabled={page >= totalPages} onClick={() => onPage(page + 1)} variant="quiet">
        Next
      </Button>
    </footer>
  );
}

function ReportState({ title }: { title: string }) {
  return (
    <div className="finance-report-state">
      <Icon name="chart" size={22} />
      <strong>{title}</strong>
    </div>
  );
}

function ReportError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <InlineAlert tone="error">
      <div className="finance-report-error">
        <span>{message}</span>
        <button onClick={onRetry} type="button">
          Try again
        </button>
      </div>
    </InlineAlert>
  );
}

function useAging(token: string, kind: FinanceAgingKind, page: number) {
  const [report, setReport] = useState<FinanceAgingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getFinanceAgingReport(token, kind, page)
      .then((value) => active && setReport(value))
      .catch((caught) => {
        if (active) setError(errorMessage(caught, 'The balance register could not be loaded.'));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [kind, page, revision, token]);
  return { error, loading, reload, report };
}

function useTurnover(
  token: string,
  kind: FinanceTurnoverKind,
  dateFrom: string,
  dateTo: string,
  page: number,
) {
  const [report, setReport] = useState<FinanceTurnoverReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getFinanceTurnoverReport(token, kind, dateFrom, dateTo, page)
      .then((value) => active && setReport(value))
      .catch((caught) => {
        if (active) setError(errorMessage(caught, 'The turnover report could not be loaded.'));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [dateFrom, dateTo, kind, page, revision, token]);
  return { error, loading, reload, report };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function reportDates(): { dateFrom: string; dateTo: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Sofia',
    year: 'numeric',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const dateTo = `${value('year')}-${value('month')}-${value('day')}`;
  return { dateFrom: `${dateTo.slice(0, 8)}01`, dateTo };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeZone: 'Europe/Sofia',
  }).format(new Date(`${value}T12:00:00+03:00`));
}

function formatMoney(value: string): string {
  const amount = Number(value);
  return new Intl.NumberFormat(undefined, { currency: 'BGN', style: 'currency' }).format(
    Number.isFinite(amount) ? amount : 0,
  );
}
