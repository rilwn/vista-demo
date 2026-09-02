import { Button, InlineAlert } from '@vista/ui';
import type {
  CreateCrmReportExportRequest,
  CrmAnalyticsDefinition,
  CrmAnalyticsOverview,
  CrmAnalyticsPipelineStage,
  CrmAnalyticsRevenueDimension,
  CrmReportDefinition,
  CrmReportDefinitionKey,
  CrmReportExport,
  ReportExportFormat,
} from '@vista/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createCrmReportExport,
  downloadCrmReportExport,
  getCrmAnalyticsOverview,
  getCrmReportDefinitions,
  listCrmReportExports,
  retryCrmReportExport,
} from '../api/crm-analytics';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { CrmTabs } from './CrmTicketsPage';

type Period = { dateFrom: string; dateTo: string };
type PeriodPreset = '30-days' | '90-days' | 'year';

const revenueDimensions: CrmAnalyticsRevenueDimension[] = [
  'product',
  'service',
  'customer',
  'region',
  'employee',
];

export function CrmAnalyticsPage() {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const initialPeriod = useMemo(() => presetPeriod('90-days'), []);
  const [dateFrom, setDateFrom] = useState(initialPeriod.dateFrom);
  const [dateTo, setDateTo] = useState(initialPeriod.dateTo);
  const [period, setPeriod] = useState(initialPeriod);
  const [activePreset, setActivePreset] = useState<PeriodPreset | null>('90-days');
  const [report, setReport] = useState<CrmAnalyticsOverview | null>(null);
  const [dimension, setDimension] = useState<CrmAnalyticsRevenueDimension>('product');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getCrmAnalyticsOverview(token, period.dateFrom, period.dateTo));
    } catch (caught) {
      setError(errorMessage(caught, 'CRM analytics could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [period, token]);

  useEffect(() => void load(), [load]);

  function applyPreset(preset: PeriodPreset) {
    const next = presetPeriod(preset);
    setDateFrom(next.dateFrom);
    setDateTo(next.dateTo);
    setPeriod(next);
    setActivePreset(preset);
  }

  return (
    <div className="page-stack crm-analytics-workspace">
      <header className="page-header crm-analytics-header">
        <div>
          <p className="page-eyebrow">CRM · Performance</p>
          <h1>Customer analytics</h1>
          <p>Review customer value, sales progress, team activity, and recorded revenue.</p>
        </div>
        {hasPermission('crm', 'create') ? (
          <Button onClick={() => setExportOpen(true)}>
            <Icon name="chart" size={16} /> Export report
          </Button>
        ) : null}
      </header>

      <CrmTabs />

      <section aria-label="Reporting period" className="crm-analytics-toolbar">
        <div className="crm-analytics-presets" role="group" aria-label="Quick reporting periods">
          <button
            aria-pressed={activePreset === '30-days'}
            className={activePreset === '30-days' ? 'is-active' : undefined}
            onClick={() => applyPreset('30-days')}
            type="button"
          >
            30 days
          </button>
          <button
            aria-pressed={activePreset === '90-days'}
            className={activePreset === '90-days' ? 'is-active' : undefined}
            onClick={() => applyPreset('90-days')}
            type="button"
          >
            90 days
          </button>
          <button
            aria-pressed={activePreset === 'year'}
            className={activePreset === 'year' ? 'is-active' : undefined}
            onClick={() => applyPreset('year')}
            type="button"
          >
            This year
          </button>
        </div>
        <div className="crm-analytics-date-fields">
          <label>
            <span>From</span>
            <input
              max={dateTo}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setActivePreset(null);
              }}
              type="date"
              value={dateFrom}
            />
          </label>
          <label>
            <span>To</span>
            <input
              min={dateFrom}
              onChange={(event) => {
                setDateTo(event.target.value);
                setActivePreset(null);
              }}
              type="date"
              value={dateTo}
            />
          </label>
          <Button
            disabled={loading || !dateFrom || !dateTo || dateFrom > dateTo}
            onClick={() => setPeriod({ dateFrom, dateTo })}
            variant="secondary"
          >
            Apply
          </Button>
        </div>
      </section>

      {error ? (
        <InlineAlert tone="error">
          <div className="crm-analytics-alert">
            <span>{error}</span>
            <button onClick={() => void load()} type="button">
              Try again
            </button>
          </div>
        </InlineAlert>
      ) : null}

      {loading ? <AnalyticsState title="Loading customer analytics" /> : null}
      {!loading && report ? (
        <AnalyticsContent dimension={dimension} onDimensionChange={setDimension} report={report} />
      ) : null}

      {exportOpen ? (
        <CrmReportExportPanel
          dateFrom={period.dateFrom}
          dateTo={period.dateTo}
          onBack={() => setExportOpen(false)}
          token={token}
        />
      ) : null}
    </div>
  );
}

function AnalyticsContent({
  dimension,
  onDimensionChange,
  report,
}: {
  dimension: CrmAnalyticsRevenueDimension;
  onDimensionChange: (value: CrmAnalyticsRevenueDimension) => void;
  report: CrmAnalyticsOverview;
}) {
  const revenue = report.revenue.filter((item) => item.dimension === dimension);
  return (
    <>
      <section aria-label="Customer summary" className="crm-analytics-kpis">
        <AnalyticsMetric
          comparison={comparison(
            report.customerMetrics.retentionPercent,
            report.previousCustomerMetrics.retentionPercent,
            'points',
          )}
          label="Customer retention"
          value={`${formatDecimal(report.customerMetrics.retentionPercent)}%`}
        />
        <AnalyticsMetric
          comparison={comparison(
            report.customerMetrics.averageTransactionValueBgn,
            report.previousCustomerMetrics.averageTransactionValueBgn,
          )}
          label="Average transaction"
          value={money(report.customerMetrics.averageTransactionValueBgn)}
        />
        <AnalyticsMetric
          comparison={comparison(
            report.customerMetrics.purchaseFrequency,
            report.previousCustomerMetrics.purchaseFrequency,
          )}
          label="Purchases per customer"
          value={formatDecimal(report.customerMetrics.purchaseFrequency)}
        />
        <AnalyticsMetric
          comparison={comparison(
            report.customerMetrics.observedLifetimeValueBgn,
            report.previousCustomerMetrics.observedLifetimeValueBgn,
          )}
          label="Observed customer value"
          value={money(report.customerMetrics.observedLifetimeValueBgn)}
        />
        <AnalyticsMetric
          label="Recorded net revenue"
          supporting={`${report.customerMetrics.activeCustomers} active customers`}
          value={money(report.totalNetRevenueBgn)}
        />
      </section>

      <div className="crm-analytics-primary-grid">
        <section className="crm-analytics-card crm-pipeline-analysis">
          <header>
            <div>
              <span>Sales progress</span>
              <h2>Pipeline conversion</h2>
              <p>Opportunities created in the selected period.</p>
            </div>
            <div className="crm-pipeline-totals">
              <strong>{report.pipeline.createdOpportunities}</strong>
              <span>opportunities</span>
            </div>
          </header>
          <div className="crm-pipeline-summary">
            <div>
              <span>Open pipeline</span>
              <strong>{money(report.pipeline.openPipelineValueBgn)}</strong>
            </div>
            <div>
              <span>Won</span>
              <strong>{report.pipeline.wonCount}</strong>
            </div>
            <div>
              <span>Win rate</span>
              <strong>{formatDecimal(report.pipeline.winRatePercent)}%</strong>
            </div>
          </div>
          <div className="crm-pipeline-stage-list">
            {report.pipeline.stages.map((stage) => (
              <div key={stage.stage}>
                <div>
                  <strong>{pipelineStageLabel(stage.stage)}</strong>
                  <span>
                    {stage.enteredCount} entered · {stage.currentCount} currently here
                  </span>
                </div>
                <div aria-hidden="true" className={`is-${stage.stage}`}>
                  <i
                    style={{
                      width: barWidth(stage.enteredCount, report.pipeline.createdOpportunities),
                    }}
                  />
                </div>
                <span>
                  {stage.conversionFromPreviousPercent === undefined
                    ? 'Starting stage'
                    : `${formatDecimal(stage.conversionFromPreviousPercent)}% from previous`}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="crm-analytics-card crm-preferences-analysis">
          <header>
            <div>
              <span>Buying patterns</span>
              <h2>Preferred products &amp; services</h2>
              <p>Ranked from recorded financial-document activity.</p>
            </div>
          </header>
          {report.preferences.length ? (
            <div className="crm-preference-list">
              {report.preferences.map((item, index) => (
                <article key={`${item.kind}:${item.label}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>
                      {item.kind === 'product' ? 'Product' : 'Service'} · {item.documentCount}{' '}
                      {item.documentCount === 1 ? 'document' : 'documents'}
                    </small>
                  </div>
                  <strong>{money(item.netRevenueBgn)}</strong>
                </article>
              ))}
            </div>
          ) : (
            <CompactEmpty text="No recorded product or Service activity in this period." />
          )}
        </section>
      </div>

      <section className="crm-analytics-card crm-revenue-analysis">
        <header>
          <div>
            <span>Recorded revenue</span>
            <h2>Revenue breakdown</h2>
            <p>
              Invoices and debit notes less credit notes, excluding VAT and using each document’s
              BGN snapshot.
            </p>
          </div>
          <div aria-label="Revenue grouping" className="crm-revenue-tabs" role="tablist">
            {revenueDimensions.map((item) => (
              <button
                aria-selected={dimension === item}
                className={dimension === item ? 'is-active' : undefined}
                key={item}
                onClick={() => onDimensionChange(item)}
                role="tab"
                type="button"
              >
                {revenueDimensionLabel(item)}
              </button>
            ))}
          </div>
        </header>
        {revenue.length ? (
          <div className="crm-revenue-list" role="table" aria-label="Revenue breakdown">
            <div className="crm-revenue-row is-head" role="row">
              <span role="columnheader">Name</span>
              <span role="columnheader">Documents</span>
              <span role="columnheader">Share</span>
              <span role="columnheader">Net value</span>
            </div>
            {revenue.map((item) => (
              <div className="crm-revenue-row" key={`${item.dimension}:${item.key}`} role="row">
                <div role="cell">
                  <strong>{item.label}</strong>
                  <div aria-hidden="true">
                    <i style={{ width: `${Math.max(2, Number(item.sharePercent))}%` }} />
                  </div>
                </div>
                <span data-label="Documents" role="cell">
                  {item.documentCount}
                </span>
                <span data-label="Share" role="cell">
                  {formatDecimal(item.sharePercent)}%
                </span>
                <strong data-label="Net value" role="cell">
                  {money(item.netRevenueBgn)}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <CompactEmpty
            text={`No ${revenueDimensionLabel(dimension).toLowerCase()} revenue is recorded for this period.`}
          />
        )}
      </section>

      <section className="crm-analytics-card crm-employee-analysis">
        <header>
          <div>
            <span>Team activity</span>
            <h2>Completed work by employee</h2>
            <p>Completed Service requests, resolved tickets, and shipped Sales orders.</p>
          </div>
        </header>
        {report.employees.length ? (
          <div className="crm-employee-table" role="table" aria-label="Employee performance">
            <div className="crm-employee-row is-head" role="row">
              <span role="columnheader">Employee</span>
              <span role="columnheader">Service</span>
              <span role="columnheader">Tickets</span>
              <span role="columnheader">Sales</span>
              <span role="columnheader">Total</span>
            </div>
            {report.employees.map((employee) => (
              <div className="crm-employee-row" key={employee.displayName} role="row">
                <strong role="cell">{employee.displayName}</strong>
                <span data-label="Service" role="cell">
                  {employee.requestsProcessed}
                </span>
                <span data-label="Tickets" role="cell">
                  {employee.ticketsResolved}
                </span>
                <span data-label="Sales" role="cell">
                  {employee.salesCompleted}
                </span>
                <strong data-label="Total" role="cell">
                  {employee.totalCompleted}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <CompactEmpty text="No completed team activity is recorded in this period." />
        )}
      </section>

      <CalculationNotes definitions={report.definitions} report={report} />
    </>
  );
}

function AnalyticsMetric({
  comparison: change,
  label,
  supporting,
  value,
}: {
  comparison?: { label: string; tone: 'down' | 'neutral' | 'up' };
  label: string;
  supporting?: string;
  value: string;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      {change ? (
        <small className={`is-${change.tone}`}>{change.label}</small>
      ) : (
        <small>{supporting}</small>
      )}
    </article>
  );
}

function CalculationNotes({
  definitions,
  report,
}: {
  definitions: CrmAnalyticsDefinition[];
  report: CrmAnalyticsOverview;
}) {
  return (
    <details className="crm-calculation-notes">
      <summary>
        <span>
          <strong>How these numbers are calculated</strong>
          <small>
            Comparison period: {shortDate(report.previousDateFrom)} –{' '}
            {shortDate(report.previousDateTo)}
          </small>
        </span>
        <Icon name="chevron" size={16} />
      </summary>
      <div>
        {definitions.map((definition) => (
          <article key={definition.key}>
            <h3>{definition.label}</h3>
            <p>{definition.formula}</p>
            <dl>
              <div>
                <dt>Date window</dt>
                <dd>{definition.dateWindow}</dd>
              </div>
              <div>
                <dt>Included records</dt>
                <dd>{definition.statusFilters.join(' ')}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </details>
  );
}

function CrmReportExportPanel({
  dateFrom: initialDateFrom,
  dateTo: initialDateTo,
  onBack,
  token,
}: {
  dateFrom: string;
  dateTo: string;
  onBack: () => void;
  token: string;
}) {
  const [definitions, setDefinitions] = useState<CrmReportDefinition[]>([]);
  const [exports, setExports] = useState<CrmReportExport[]>([]);
  const [definitionKey, setDefinitionKey] = useState<CrmReportDefinitionKey>('crm.customer-value');
  const [format, setFormat] = useState<ReportExportFormat>('xlsx');
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const definition = definitions.find((item) => item.key === definitionKey);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const load = useCallback(async () => {
    const [available, recent] = await Promise.all([
      getCrmReportDefinitions(token),
      listCrmReportExports(token),
    ]);
    setDefinitions(available);
    setExports(recent.items);
  }, [token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load()
      .catch((caught) => active && setError(errorMessage(caught, 'Reports could not be loaded.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    if (!exports.some((item) => item.status === 'queued' || item.status === 'processing')) return;
    const timer = window.setInterval(
      () =>
        void listCrmReportExports(token)
          .then((page) => setExports(page.items))
          .catch(() => undefined),
      2_000,
    );
    return () => window.clearInterval(timer);
  }, [exports, token]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    panel.querySelector<HTMLElement>('.panel-back-button')?.focus();
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        onBack();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener('keydown', handleKeyboard);
    return () => {
      panel.removeEventListener('keydown', handleKeyboard);
      previous?.focus();
    };
  }, [onBack]);

  async function prepare() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const input: CreateCrmReportExportRequest = { dateFrom, dateTo, definitionKey, format };
      await createCrmReportExport(token, crypto.randomUUID(), input);
      setExports((await listCrmReportExports(token)).items);
      setMessage('Your report is being prepared. It will appear below when it is ready.');
    } catch (caught) {
      setError(errorMessage(caught, 'The report could not be prepared.'));
    } finally {
      setBusy(false);
    }
  }

  async function download(report: CrmReportExport) {
    setDownloadingId(report.id);
    setError(null);
    try {
      const blob = await downloadCrmReportExport(token, report);
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

  async function retry(report: CrmReportExport) {
    setBusy(true);
    setError(null);
    try {
      await retryCrmReportExport(token, report.id);
      setExports((await listCrmReportExports(token)).items);
      setMessage('We are preparing the report again.');
    } catch (caught) {
      setError(errorMessage(caught, 'The report could not be started again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="security-drawer-layer">
      <button
        aria-label="Back to CRM analytics"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-labelledby="crm-export-title"
        aria-modal="true"
        className="security-drawer report-export-drawer"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
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
            <h2 id="crm-export-title">Export CRM report</h2>
            <p>Choose the analysis and file type. You can continue working while it is prepared.</p>
          </div>
        </header>
        <div className="security-drawer-body report-export-drawer-body">
          {loading ? <AnalyticsState title="Loading reports" /> : null}
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          {message ? <InlineAlert tone="success">{message}</InlineAlert> : null}
          {!loading ? (
            <section aria-label="Report options" className="report-export-form">
              <div className="report-export-field">
                <label htmlFor="crm-report-export-definition">Report</label>
                <select
                  id="crm-report-export-definition"
                  onChange={(event) =>
                    setDefinitionKey(event.target.value as CrmReportDefinitionKey)
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
                        name="crm-report-format"
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
              <div className="report-export-dates">
                <label>
                  <span>From</span>
                  <input
                    max={dateTo}
                    onChange={(event) => setDateFrom(event.target.value)}
                    type="date"
                    value={dateFrom}
                  />
                </label>
                <label>
                  <span>To</span>
                  <input
                    min={dateFrom}
                    onChange={(event) => setDateTo(event.target.value)}
                    type="date"
                    value={dateTo}
                  />
                </label>
              </div>
            </section>
          ) : null}
          <section aria-label="Recent exports" className="report-export-history">
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
              disabled={loading || !definition || !dateFrom || !dateTo || dateFrom > dateTo}
              onClick={() => void prepare()}
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

function ExportStatus({ status }: { status: CrmReportExport['status'] }) {
  return (
    <span className={`report-export-status is-${status}`}>
      {
        {
          completed: 'Ready',
          failed: 'Needs attention',
          processing: 'Preparing',
          queued: 'Preparing',
        }[status]
      }
    </span>
  );
}

function AnalyticsState({ title }: { title: string }) {
  return (
    <div aria-live="polite" className="crm-analytics-state">
      <span className="loading-spinner" />
      <strong>{title}</strong>
    </div>
  );
}

function CompactEmpty({ text }: { text: string }) {
  return (
    <div className="crm-analytics-empty">
      <Icon name="chart" size={20} />
      <span>{text}</span>
    </div>
  );
}

function comparison(
  current: string,
  previous: string,
  unit: 'percent' | 'points' = 'percent',
): { label: string; tone: 'down' | 'neutral' | 'up' } {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return { label: 'No comparison', tone: 'neutral' };
  }
  const delta =
    unit === 'points'
      ? currentValue - previousValue
      : previousValue === 0
        ? currentValue === 0
          ? 0
          : 100
        : ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  if (Math.abs(delta) < 0.005) return { label: 'No change from prior period', tone: 'neutral' };
  const suffix = unit === 'points' ? 'points' : '%';
  return {
    label: `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)} ${suffix} vs prior period`,
    tone: delta > 0 ? 'up' : 'down',
  };
}

function presetPeriod(preset: '30-days' | '90-days' | 'year'): Period {
  const today = new Date();
  const from = new Date(today);
  if (preset === 'year') from.setMonth(0, 1);
  else from.setDate(today.getDate() - (preset === '30-days' ? 29 : 89));
  return { dateFrom: localDate(from), dateTo: localDate(today) };
}

function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function money(value: string): string {
  return new Intl.NumberFormat(undefined, { currency: 'BGN', style: 'currency' }).format(
    Number(value),
  );
}

function formatDecimal(value: string): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(`${value}T00:00:00`),
  );
}

function barWidth(value: number, total: number): string {
  return `${total ? Math.max(3, Math.min(100, Math.round((value / total) * 100))) : 0}%`;
}

function pipelineStageLabel(value: CrmAnalyticsPipelineStage): string {
  return {
    lost: 'Lost',
    negotiation: 'Negotiation',
    new: 'New',
    qualified: 'Qualified',
    quotation_sent: 'Quotation sent',
    won: 'Won',
  }[value];
}

function revenueDimensionLabel(value: CrmAnalyticsRevenueDimension): string {
  return {
    customer: 'Customer',
    employee: 'Employee',
    product: 'Product',
    region: 'Region',
    service: 'Service',
  }[value];
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
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function formatFileSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export const crmAnalyticsTestHelpers = {
  comparison,
  presetPeriod,
};
