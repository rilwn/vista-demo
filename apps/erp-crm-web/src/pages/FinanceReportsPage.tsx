import { useExportHistory, ExportHistoryControls } from './useExportHistory';
import { Button, InlineAlert, Toast } from '@vista/ui';
import { DashboardCards } from '@vista/ui';
import { apiV1BaseUrl } from '../api/client';
import type {
  CreateFinanceReportExportRequest,
  FinanceAgingKind,
  FinanceAgingReport,
  FinanceAgingReportItem,
  FinanceJournalKind,
  FinanceJournalReport,
  FinanceReportDefinition,
  FinanceReportDefinitionKey,
  FinanceReportExport,
  FinanceTurnoverKind,
  FinanceTurnoverReport,
  FinanceVatReviewReport,
  ReportExportFormat,
  SavedFinanceReport,
} from '@vista/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listSavedFinanceReports, saveFinanceReport } from '../api/report-workspace';
import './report-workspace.css';

import { ApiClientError } from '../api/client';
import {
  createFinanceReportExport,
  downloadFinanceReportExport,
  getFinanceAgingReport,
  getFinanceJournalReport,
  getFinanceReportDefinitions,
  getFinanceTurnoverReport,
  getFinanceVatReview,
  listFinanceReportExports,
  retryFinanceReportExport,
} from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';
import { FinanceTabs } from './FinanceBankPage';

type ReportView = 'aging' | 'turnover' | 'journals' | 'vat';

export function FinanceReportsPage() {
  const { session } = useAuth();
  const token = session?.sessionToken ?? '';
  const [view, setView] = useState<ReportView>('aging');
  const [agingKind, setAgingKind] = useState<FinanceAgingKind>('receivable');
  const [turnoverKind, setTurnoverKind] = useState<FinanceTurnoverKind>('customer');
  const [journalKind, setJournalKind] = useState<FinanceJournalKind>('sales');
  const initialDates = useMemo(() => reportDates(), []);
  const [dateFrom, setDateFrom] = useState(initialDates.dateFrom);
  const [dateTo, setDateTo] = useState(initialDates.dateTo);
  const [exportOpen, setExportOpen] = useState(false);
  const currentDefinition: FinanceReportDefinitionKey =
    view === 'aging'
      ? agingKind === 'receivable'
        ? 'finance.receivables-aging'
        : 'finance.supplier-payables-aging'
      : view === 'turnover'
        ? turnoverKind === 'customer'
          ? 'finance.customer-turnover'
          : 'finance.supplier-turnover'
        : view === 'journals'
          ? journalKind === 'sales'
            ? 'finance.sales-journal'
            : 'finance.purchase-journal'
          : 'finance.vat-review';

  return (
    <div className="page-stack finance-report-workspace">
      <header className="page-header finance-report-header">
        <div>
          <p className="page-eyebrow">ERP · Finance</p>
          <h1>Finance reports</h1>
          <p>Review balances, turnover, document journals, and recorded VAT in one workspace.</p>
        </div>
        <Button onClick={() => setExportOpen(true)}>
          <Icon name="chart" size={16} /> Export report
        </Button>
      </header>

      <FinanceTabs />

      <InlineAlert tone="info">
        These are review reports, not official accounting or VAT filing documents. Sales values
        include prepared documents.
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
        <button
          aria-selected={view === 'journals'}
          className={view === 'journals' ? 'is-active' : undefined}
          onClick={() => setView('journals')}
          role="tab"
          type="button"
        >
          Document journals
        </button>
        <button
          aria-selected={view === 'vat'}
          className={view === 'vat' ? 'is-active' : undefined}
          onClick={() => setView('vat')}
          role="tab"
          type="button"
        >
          VAT review
        </button>
      </div>

      {view === 'aging' ? (
        <AgingView kind={agingKind} onKindChange={setAgingKind} token={token} />
      ) : view === 'turnover' ? (
        <TurnoverView
          dateFrom={dateFrom}
          dateTo={dateTo}
          kind={turnoverKind}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onKindChange={setTurnoverKind}
          token={token}
        />
      ) : view === 'journals' ? (
        <JournalView
          dateFrom={dateFrom}
          dateTo={dateTo}
          kind={journalKind}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onKindChange={setJournalKind}
          token={token}
        />
      ) : (
        <VatReviewView
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
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
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('erp.finance', 'create');
  const [savedReports, setSavedReports] = useState<SavedFinanceReport[]>([]);
  const [savedPage, setSavedPage] = useState(1);
  const [savedPages, setSavedPages] = useState(0);
  const [reportName, setReportName] = useState('');
  const [columns, setColumns] = useState<string[] | undefined>();
  const saveRequest = useRef<{ body: string; id: string } | null>(null);
  const exportRequest = useRef<{ body: string; id: string } | null>(null);
  const history = useExportHistory(token, listFinanceReportExports);
  const exports = history.items;
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
    const [available, saved] = await Promise.all([
      getFinanceReportDefinitions(token),
      listSavedFinanceReports(token, savedPage),
    ]);
    setDefinitions(available);
    setSavedReports(saved.items);
    setSavedPages(saved.totalPages);
  }, [token, savedPage]);

  function chooseSaved(report: SavedFinanceReport) {
    setDefinitionKey(report.definitionKey);
    setColumns(report.columns);
    setFormat(report.format);
    setReportName(report.name);
    if (report.dateFrom) setDateFrom(report.dateFrom);
    if (report.dateTo) setDateTo(report.dateTo);
    setError(null);
  }

  async function saveView() {
    if (!definition || !reportName.trim()) return;
    setBusy(true);
    setError(null);
    const configuration = {
      name: reportName.trim(),
      definitionKey,
      format,
      ...(columns ? { columns } : {}),
      ...(definition.requiresDateRange ? { dateFrom, dateTo } : {}),
    };
    const body = JSON.stringify(configuration);
    if (saveRequest.current?.body !== body) saveRequest.current = { body, id: crypto.randomUUID() };
    try {
      const created = await saveFinanceReport(token, {
        ...configuration,
        id: saveRequest.current.id,
      });
      setSavedReports((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      setMessage('Report saved. You can open it again from My saved reports.');
      setSavedPage(1);
      const saved = await listSavedFinanceReports(token).catch(() => null);
      if (saved) {
        setSavedReports(saved.items);
        setSavedPages(saved.totalPages);
      }
    } catch (caught) {
      setError(errorMessage(caught, 'The report could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

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

  async function createExport() {
    if (!definition) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const input: CreateFinanceReportExportRequest = {
        ...(columns ? { columns } : {}),
        definitionKey,
        format,
        ...(definition.requiresDateRange ? { dateFrom, dateTo } : {}),
      };
      const body = JSON.stringify(input);
      if (exportRequest.current?.body !== body)
        exportRequest.current = { body, id: crypto.randomUUID() };
      await createFinanceReportExport(token, exportRequest.current.id, input);
      exportRequest.current = null;
      history.refresh(true);
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
      history.refresh();
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
          {message ? (
            <Toast onDismiss={() => setMessage(null)} tone="success">
              {message}
            </Toast>
          ) : null}

          {!loading ? (
            <section className="report-export-form" aria-label="Report options">
              <div className="report-export-field">
                <label htmlFor="saved-finance-report">My saved reports</label>
                <select
                  id="saved-finance-report"
                  value=""
                  disabled={busy}
                  onChange={(event) => {
                    const report = savedReports.find((item) => item.id === event.target.value);
                    if (report) chooseSaved(report);
                  }}
                >
                  <option value="">
                    {savedReports.length ? 'Open a saved report' : 'No saved reports yet'}
                  </option>
                  {savedReports.map((report) => (
                    <option key={report.id} value={report.id}>
                      {report.name}
                    </option>
                  ))}
                </select>
                {savedPages > 1 ? (
                  <div className="report-view-paging">
                    <Button
                      variant="secondary"
                      disabled={busy || savedPage <= 1}
                      onClick={() => setSavedPage((page) => page - 1)}
                    >
                      Previous
                    </Button>
                    <span>
                      Page {savedPage} of {savedPages}
                    </span>
                    <Button
                      variant="secondary"
                      disabled={busy || savedPage >= savedPages}
                      onClick={() => setSavedPage((page) => page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="report-export-field">
                <label htmlFor="finance-report-export-definition">Report</label>
                <select
                  id="finance-report-export-definition"
                  disabled={busy}
                  onChange={(event) => {
                    setDefinitionKey(event.target.value as FinanceReportDefinitionKey);
                    setColumns(undefined);
                    setReportName('');
                  }}
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

              {definition?.columns?.length ? (
                <fieldset className="report-view-fields" disabled={busy}>
                  <legend>Fields to include</legend>
                  <div className="report-view-field-grid">
                    {definition.columns.map((column) => (
                      <label key={column.key}>
                        <input
                          type="checkbox"
                          checked={!columns || columns.includes(column.key)}
                          onChange={(event) => {
                            const selected = new Set(
                              columns ?? definition.columns?.map((item) => item.key),
                            );
                            if (event.target.checked) selected.add(column.key);
                            else selected.delete(column.key);
                            setColumns(
                              definition.columns
                                ?.filter((item) => selected.has(item.key))
                                .map((item) => item.key),
                            );
                          }}
                        />
                        <span>{column.label}</span>
                      </label>
                    ))}
                  </div>
                  {columns?.length === 0 ? <small>Choose at least one field.</small> : null}
                </fieldset>
              ) : null}

              <fieldset disabled={busy}>
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
                      disabled={busy}
                      onChange={(event) => setDateFrom(event.target.value)}
                      type="date"
                      value={dateFrom}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      disabled={busy}
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
              {canCreate ? (
                <div className="report-view-save">
                  <label htmlFor="report-view-name">Save these options</label>
                  <input
                    id="report-view-name"
                    value={reportName}
                    maxLength={100}
                    placeholder="e.g. September supplier balances"
                    disabled={busy}
                    onChange={(event) => setReportName(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy || !reportName.trim() || !validDates || columns?.length === 0}
                    onClick={() => void saveView()}
                  >
                    Save as new report
                  </Button>
                  <small>Saved to your account. Saving different options creates a new copy.</small>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="report-export-history" aria-label="Recent exports">
            <header>
              <div>
                <h3>Recent exports</h3>
                <p>Only reports requested from your account are shown.</p>
              </div>
              <button
                disabled={history.loading || busy}
                onClick={() => history.refresh()}
                type="button"
              >
                Refresh
              </button>
            </header>
            {!history.loading && !history.error && !exports.length ? (
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
                  ) : report.status === 'failed' && canCreate ? (
                    <Button disabled={busy} onClick={() => void retry(report)} variant="secondary">
                      Try again
                    </Button>
                  ) : null}
                </article>
              ))}
            </div>
            <ExportHistoryControls history={history} />
          </section>
        </div>
        <footer className="security-drawer-actions report-export-actions">
          <Button
            busy={busy}
            disabled={loading || !definition || !validDates || columns?.length === 0 || !canCreate}
            onClick={() => void createExport()}
          >
            Prepare export
          </Button>
          <Button disabled={busy} onClick={onBack} variant="secondary">
            Close
          </Button>
        </footer>
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
  const { session } = useAuth();
  const metrics = [
    ['Total open', report.totals.total],
    ['Not due', report.totals.current],
    ['0–30 days', report.totals.days0To30],
    ['31–60 days', report.totals.days31To60],
    ['61–90 days', report.totals.days61To90],
    ['Over 90 days', report.totals.over90],
  ];
  return (
    <DashboardCards
      scope="finance"
      token={session?.sessionToken ?? ''}
      apiBaseUrl={apiV1BaseUrl}
      labels={metrics.map(([label]) => label ?? '')}
      className="finance-aging-summary"
    >
      {metrics.map(([label, value], index) => (
        <div className={index === 0 ? 'is-total' : undefined} key={label}>
          <span>{label}</span>
          <strong>{formatMoney(value ?? '0')}</strong>
        </div>
      ))}
    </DashboardCards>
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

function JournalView({
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
  kind: FinanceJournalKind;
  onDateFromChange: (date: string) => void;
  onDateToChange: (date: string) => void;
  onKindChange: (kind: FinanceJournalKind) => void;
  token: string;
}) {
  const [filters, setFilters] = useState({ dateFrom, dateTo, kind });
  const [page, setPage] = useState(1);
  const data = useJournal(token, filters.kind, filters.dateFrom, filters.dateTo, page);
  const incompleteNumbers =
    data.report?.items.filter((item) => !item.taxBreakdownComplete).map((item) => item.number) ??
    [];

  function apply() {
    setPage(1);
    setFilters({ dateFrom, dateTo, kind });
  }

  return (
    <section aria-label="Document journals" className="finance-report-body">
      <div className="finance-report-toolbar is-filter">
        <div className="finance-report-toggle">
          <button
            className={kind === 'sales' ? 'is-active' : undefined}
            onClick={() => onKindChange('sales')}
            type="button"
          >
            Sales
          </button>
          <button
            className={kind === 'purchase' ? 'is-active' : undefined}
            onClick={() => onKindChange('purchase')}
            type="button"
          >
            Purchases
          </button>
        </div>
        <ReportDateField label="From" onChange={onDateFromChange} value={dateFrom} />
        <ReportDateField label="To" onChange={onDateToChange} value={dateTo} />
        <Button
          disabled={!dateFrom || !dateTo || dateFrom > dateTo}
          onClick={apply}
          variant="secondary"
        >
          <Icon name="search" size={16} /> Apply
        </Button>
      </div>

      {data.loading ? <ReportState title="Loading journal" /> : null}
      {data.error ? <ReportError message={data.error} onRetry={data.reload} /> : null}
      {data.report ? (
        <>
          <p className="finance-report-caption">
            {kind === 'sales' ? 'Customer' : 'Supplier'} documents dated{' '}
            {formatDate(data.report.dateFrom)}–{formatDate(data.report.dateTo)}. Values are shown in
            BGN from the rate recorded on each document.
          </p>
          {data.report.totals.incompleteTaxDocuments ? (
            <InlineAlert title="Earlier invoice excluded from VAT totals" tone="warning">
              <p>
                {incompleteNumbers.length ? (
                  <>
                    <strong>{incompleteNumbers.join(', ')}</strong>{' '}
                  </>
                ) : null}
                {data.report.totals.incompleteTaxDocuments === 1 ? 'was' : 'were'} recorded without
                VAT details. The document remains in the journal, but its tax is not included in the
                totals.
              </p>
              <Link
                className="finance-report-alert-link"
                to="/modules/erp.procurement/supplier-invoices"
              >
                Open supplier invoices <Icon name="arrow" size={14} />
              </Link>
            </InlineAlert>
          ) : null}
          <div aria-label="Journal totals" className="finance-turnover-summary">
            <ReportMetric label="Documents" value={String(data.report.totals.documentCount)} />
            <ReportMetric label="Net value" value={formatMoney(data.report.totals.netBgnTotal)} />
            <ReportMetric
              label="Recorded VAT"
              value={formatMoney(data.report.totals.vatBgnTotal)}
            />
            <ReportMetric
              label="Gross value"
              value={formatMoney(data.report.totals.grossBgnTotal)}
            />
          </div>
          <JournalRegister report={data.report} />
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

function JournalRegister({ report }: { report: FinanceJournalReport }) {
  if (!report.items.length) return <ReportState title="No documents in this period" />;
  return (
    <div className="finance-report-register">
      <div aria-hidden="true" className="finance-journal-register-head">
        <span>Document</span>
        <span>Partner</span>
        <span>Date &amp; currency</span>
        <span>Net</span>
        <span>VAT</span>
        <span>Gross</span>
      </div>
      {report.items.map((item) => (
        <article className="finance-journal-register-row" key={item.id}>
          <div className="finance-report-document">
            <span>{journalDocumentMark(item.documentType)}</span>
            <div>
              <strong>{item.number}</strong>
              <small>
                {journalDocumentLabel(item.documentType)} · {journalStatusLabel(item.status)}
              </small>
            </div>
          </div>
          <div className="finance-report-partner">
            <strong>{item.partnerName}</strong>
            <small>
              {item.partnerVatNumber ? `VAT ${item.partnerVatNumber}` : 'No VAT number'}
            </small>
          </div>
          <div className="finance-report-due">
            <strong>{formatDate(item.taxEventDate ?? item.documentDate)}</strong>
            <small>
              {item.currencyCode}
              {item.exchangeRate ? ` · rate ${item.exchangeRate}` : ''}
            </small>
          </div>
          <strong>{formatMoney(item.netBgnTotal)}</strong>
          <span className={!item.taxBreakdownComplete ? 'finance-tax-missing' : undefined}>
            {item.taxBreakdownComplete ? formatMoney(item.vatBgnTotal) : 'Needs review'}
          </span>
          <strong className="finance-report-amount">{formatMoney(item.grossBgnTotal)}</strong>
        </article>
      ))}
    </div>
  );
}

function VatReviewView({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  token,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (date: string) => void;
  onDateToChange: (date: string) => void;
  token: string;
}) {
  const [filters, setFilters] = useState({ dateFrom, dateTo });
  const data = useVatReview(token, filters.dateFrom, filters.dateTo);

  return (
    <section aria-label="VAT review" className="finance-report-body">
      <div className="finance-report-toolbar is-filter">
        <div className="finance-report-toolbar-title">
          <span>Recorded tax</span>
          <strong>Output and input VAT</strong>
        </div>
        <ReportDateField label="From" onChange={onDateFromChange} value={dateFrom} />
        <ReportDateField label="To" onChange={onDateToChange} value={dateTo} />
        <Button
          disabled={!dateFrom || !dateTo || dateFrom > dateTo}
          onClick={() => setFilters({ dateFrom, dateTo })}
          variant="secondary"
        >
          <Icon name="search" size={16} /> Apply
        </Button>
      </div>

      {data.loading ? <ReportState title="Loading VAT review" /> : null}
      {data.error ? <ReportError message={data.error} onRetry={data.reload} /> : null}
      {data.report ? <VatReviewContent report={data.report} /> : null}
    </section>
  );
}

function VatReviewContent({ report }: { report: FinanceVatReviewReport }) {
  const output = report.items.filter((item) => item.direction === 'output');
  const input = report.items.filter((item) => item.direction === 'input');
  return (
    <>
      <p className="finance-report-caption">
        Tax events from {formatDate(report.dateFrom)}–{formatDate(report.dateTo)}. Input VAT is
        shown as recorded; final deductibility is not decided here.
      </p>
      {report.incompletePurchaseDocuments ? (
        <InlineAlert title="Earlier invoice excluded from input VAT" tone="warning">
          <p>
            <strong>{report.incompletePurchaseDocumentNumbers.join(', ')}</strong>{' '}
            {report.incompletePurchaseDocuments === 1 ? 'was' : 'were'} recorded without VAT
            details. The {report.incompletePurchaseDocuments === 1 ? 'invoice is' : 'invoices are'}
            visible in the purchase journal but excluded from the input VAT total.
          </p>
          <Link
            className="finance-report-alert-link"
            to="/modules/erp.procurement/supplier-invoices"
          >
            Open supplier invoices <Icon name="arrow" size={14} />
          </Link>
        </InlineAlert>
      ) : null}
      <div aria-label="VAT totals" className="finance-turnover-summary finance-vat-summary">
        <ReportMetric label="Output VAT" value={formatMoney(report.recordedOutputVatBgn)} />
        <ReportMetric label="Recorded input VAT" value={formatMoney(report.recordedInputVatBgn)} />
        <ReportMetric
          label="Recorded difference"
          value={formatMoney(report.recordedDifferenceBgn)}
        />
        <ReportMetric
          label="Purchases to review"
          value={String(report.incompletePurchaseDocuments)}
        />
      </div>
      <div className="finance-vat-groups">
        <VatGroup items={output} title="Output VAT from sales" />
        <VatGroup items={input} title="Recorded input VAT from purchases" />
      </div>
    </>
  );
}

function VatGroup({ items, title }: { items: FinanceVatReviewReport['items']; title: string }) {
  return (
    <section className="finance-vat-group">
      <header>
        <h3>{title}</h3>
        <span>{items.reduce((total, item) => total + item.documentCount, 0)} documents</span>
      </header>
      {!items.length ? (
        <div className="finance-vat-empty">No recorded VAT in this period.</div>
      ) : (
        <div className="finance-vat-table">
          <div aria-hidden="true" className="finance-vat-table-head">
            <span>Treatment</span>
            <span>Rate</span>
            <span>Documents</span>
            <span>Taxable value</span>
            <span>VAT</span>
          </div>
          {items.map((item) => (
            <div
              className="finance-vat-table-row"
              key={`${item.direction}-${item.vatTreatment}-${item.vatRate}`}
            >
              <strong>{vatTreatmentLabel(item.vatTreatment)}</strong>
              <span>{formatRate(item.vatRate)}</span>
              <span>{item.documentCount}</span>
              <span>{formatMoney(item.netBgnTotal)}</span>
              <strong>{formatMoney(item.vatBgnTotal)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportDateField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (date: string) => void;
  value: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input onChange={(event) => onChange(event.target.value)} type="date" value={value} />
    </label>
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

function useJournal(
  token: string,
  kind: FinanceJournalKind,
  dateFrom: string,
  dateTo: string,
  page: number,
) {
  const [report, setReport] = useState<FinanceJournalReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getFinanceJournalReport(token, kind, dateFrom, dateTo, page)
      .then((value) => active && setReport(value))
      .catch((caught) => {
        if (active) setError(errorMessage(caught, 'The journal could not be loaded.'));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [dateFrom, dateTo, kind, page, revision, token]);
  return { error, loading, reload, report };
}

function useVatReview(token: string, dateFrom: string, dateTo: string) {
  const [report, setReport] = useState<FinanceVatReviewReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getFinanceVatReview(token, dateFrom, dateTo)
      .then((value) => active && setReport(value))
      .catch((caught) => {
        if (active) setError(errorMessage(caught, 'The VAT review could not be loaded.'));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [dateFrom, dateTo, revision, token]);
  return { error, loading, reload, report };
}

function journalDocumentMark(type: FinanceJournalReport['items'][number]['documentType']): string {
  return {
    credit_note: 'CN',
    debit_note: 'DN',
    invoice: 'INV',
    proforma: 'PRO',
    supplier_invoice: 'SUP',
  }[type];
}

function journalDocumentLabel(type: FinanceJournalReport['items'][number]['documentType']): string {
  return {
    credit_note: 'Credit note',
    debit_note: 'Debit note',
    invoice: 'Invoice',
    proforma: 'Proforma',
    supplier_invoice: 'Supplier invoice',
  }[type];
}

function journalStatusLabel(status: FinanceJournalReport['items'][number]['status']): string {
  return { cancelled: 'Cancelled', draft: 'Draft', recorded: 'Recorded' }[status];
}

function vatTreatmentLabel(
  treatment: FinanceVatReviewReport['items'][number]['vatTreatment'],
): string {
  return {
    exempt: 'Exempt',
    ica: 'Intra-community acquisition',
    reduced_9: 'Reduced rate',
    standard_20: 'Standard rate',
    zero: 'Zero rate',
  }[treatment];
}

function formatRate(value: string): string {
  const rate = Number(value);
  return Number.isFinite(rate)
    ? `${rate.toLocaleString(undefined, { maximumFractionDigits: 4 })}%`
    : value;
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
