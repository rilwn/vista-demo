import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateServiceReportExportRequest,
  ReportExportFormat,
  ServiceReportDefinition,
  ServiceReportDefinitionKey,
  ServiceReportExport,
  ServiceReportOverview,
  ServiceRequestStatus,
  ServiceType,
} from '@vista/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createServiceReportExport,
  downloadServiceReportExport,
  getServiceReportDefinitions,
  getServiceReportOverview,
  listServiceReportExports,
  retryServiceReportExport,
} from '../api/service';
import { Icon } from '../components/Icon';

export function ServiceReportsView({ canExport, token }: { canExport: boolean; token: string }) {
  const initialPeriod = useMemo(reportPeriod, []);
  const [dateFrom, setDateFrom] = useState(initialPeriod.dateFrom);
  const [dateTo, setDateTo] = useState(initialPeriod.dateTo);
  const [appliedPeriod, setAppliedPeriod] = useState(initialPeriod);
  const [overview, setOverview] = useState<ServiceReportOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(
        await getServiceReportOverview(token, appliedPeriod.dateFrom, appliedPeriod.dateTo),
      );
    } catch (caught) {
      setError(errorMessage(caught, 'The Service report could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [appliedPeriod, token]);

  useEffect(() => void load(), [load]);

  return (
    <section aria-label="Service reports" className="service-reports-workspace">
      <div className="service-report-toolbar">
        <div>
          <span>Reporting period</span>
          <strong>Service activity and cost</strong>
        </div>
        <div className="service-report-date-fields">
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
            <input onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
          </label>
          <Button
            disabled={!dateFrom || !dateTo || dateFrom > dateTo || loading}
            onClick={() => setAppliedPeriod({ dateFrom, dateTo })}
            variant="secondary"
          >
            Apply
          </Button>
        </div>
        {canExport ? (
          <Button onClick={() => setExportOpen(true)}>
            <Icon name="chart" size={16} /> Export report
          </Button>
        ) : null}
      </div>

      {error ? (
        <InlineAlert tone="error">
          <div className="service-report-error">
            <span>{error}</span>
            <button onClick={() => void load()} type="button">
              Try again
            </button>
          </div>
        </InlineAlert>
      ) : null}

      {loading ? <ServiceReportState title="Loading Service reports" /> : null}
      {!loading && overview ? <ServiceReportContent report={overview} /> : null}

      {exportOpen ? (
        <ServiceReportExportPanel
          dateFrom={appliedPeriod.dateFrom}
          dateTo={appliedPeriod.dateTo}
          onBack={() => setExportOpen(false)}
          token={token}
        />
      ) : null}
    </section>
  );
}

function ServiceReportContent({ report }: { report: ServiceReportOverview }) {
  return (
    <>
      <div aria-label="Service summary" className="service-report-summary">
        <ReportMetric label="Requests" value={report.totals.totalRequests.toLocaleString()} />
        <ReportMetric
          label="Open"
          tone="warning"
          value={report.totals.openRequests.toLocaleString()}
        />
        <ReportMetric label="Completed" value={report.totals.completedRequests.toLocaleString()} />
        <ReportMetric label="Recorded time" value={durationLabel(report.totals.laborMinutes)} />
        <ReportMetric label="Service value" value={money(report.totals.totalCostBgn)} />
      </div>

      <div className="service-report-grid">
        <section className="service-report-card">
          <header>
            <div>
              <span>Progress</span>
              <h2>Requests by status</h2>
            </div>
            <strong>{report.totals.totalRequests}</strong>
          </header>
          <div className="service-report-breakdown">
            {report.statusTotals.length ? (
              report.statusTotals.map((item) => (
                <div key={item.status}>
                  <span>{statusLabel(item.status)}</span>
                  <div aria-hidden="true">
                    <i style={{ width: percentage(item.count, report.totals.totalRequests) }} />
                  </div>
                  <strong>{item.count}</strong>
                </div>
              ))
            ) : (
              <p>No Service requests were recorded in this period.</p>
            )}
          </div>
        </section>

        <section className="service-report-card">
          <header>
            <div>
              <span>Work mix</span>
              <h2>Requests by service type</h2>
            </div>
          </header>
          <div className="service-report-type-list">
            {report.typeTotals.length ? (
              report.typeTotals.map((item) => (
                <article key={item.serviceType}>
                  <div>
                    <strong>{serviceTypeLabel(item.serviceType)}</strong>
                    <span>{item.completedCount} completed</span>
                  </div>
                  <div>
                    <strong>{item.requestCount}</strong>
                    <span>{money(item.totalCostBgn)}</span>
                  </div>
                </article>
              ))
            ) : (
              <p>No Service requests were recorded in this period.</p>
            )}
          </div>
        </section>
      </div>

      <section className="service-technician-report">
        <header>
          <div>
            <span>Team workload</span>
            <h2>Technician performance</h2>
            <p>Assigned and completed visits, recorded work time, and Service value.</p>
          </div>
          <span>{report.technicians.length} technicians</span>
        </header>
        {report.technicians.length ? (
          <div
            className="service-technician-table"
            role="table"
            aria-label="Technician performance"
          >
            <div className="service-technician-row is-head" role="row">
              <span role="columnheader">Technician</span>
              <span role="columnheader">Assigned</span>
              <span role="columnheader">Completed</span>
              <span role="columnheader">Time</span>
              <span role="columnheader">Value</span>
            </div>
            {report.technicians.map((item) => (
              <div className="service-technician-row" key={item.displayName} role="row">
                <strong role="cell">{item.displayName}</strong>
                <span data-label="Assigned" role="cell">
                  {item.assignedCount}
                </span>
                <span data-label="Completed" role="cell">
                  {item.completedCount}
                </span>
                <span data-label="Time" role="cell">
                  {durationLabel(item.laborMinutes)}
                </span>
                <span data-label="Value" role="cell">
                  {money(item.totalCostBgn)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="service-report-empty">
            <Icon name="customers" size={20} />
            <strong>No assigned work in this period</strong>
            <span>Choose a wider period or schedule a Service visit.</span>
          </div>
        )}
      </section>
    </>
  );
}

function ReportMetric({ label, tone, value }: { label: string; tone?: 'warning'; value: string }) {
  return (
    <div className={tone ? `is-${tone}` : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ServiceReportExportPanel({
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
  const [definitions, setDefinitions] = useState<ServiceReportDefinition[]>([]);
  const [exports, setExports] = useState<ServiceReportExport[]>([]);
  const [definitionKey, setDefinitionKey] = useState<ServiceReportDefinitionKey>(
    'service.request-register',
  );
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
      getServiceReportDefinitions(token),
      listServiceReportExports(token),
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
        void listServiceReportExports(token)
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
      if (!items.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
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

  async function createExport() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const input: CreateServiceReportExportRequest = { dateFrom, dateTo, definitionKey, format };
      await createServiceReportExport(token, crypto.randomUUID(), input);
      setExports((await listServiceReportExports(token)).items);
      setMessage('Your report is being prepared and will appear below when it is ready.');
    } catch (caught) {
      setError(errorMessage(caught, 'The report could not be prepared.'));
    } finally {
      setBusy(false);
    }
  }

  async function download(report: ServiceReportExport) {
    setDownloadingId(report.id);
    setError(null);
    try {
      const blob = await downloadServiceReportExport(token, report);
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

  async function retry(report: ServiceReportExport) {
    setBusy(true);
    setError(null);
    try {
      await retryServiceReportExport(token, report.id);
      setExports((await listServiceReportExports(token)).items);
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
        aria-label="Back to Service reports"
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-labelledby="service-export-title"
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
            <h2 id="service-export-title">Export Service report</h2>
            <p>
              Choose a report, period, and file type. You can continue working while it is prepared.
            </p>
          </div>
        </header>
        <div className="security-drawer-body report-export-drawer-body">
          {loading ? <ServiceReportState title="Loading reports" /> : null}
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          {message ? (
            <Toast onDismiss={() => setMessage(null)} tone="success">
              {message}
            </Toast>
          ) : null}
          {!loading ? (
            <section aria-label="Report options" className="report-export-form">
              <div className="report-export-field">
                <label htmlFor="service-report-export-definition">Report</label>
                <select
                  id="service-report-export-definition"
                  onChange={(event) =>
                    setDefinitionKey(event.target.value as ServiceReportDefinitionKey)
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
                        name="service-report-format"
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

function ExportStatus({ status }: { status: ServiceReportExport['status'] }) {
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

function ServiceReportState({ title }: { title: string }) {
  return (
    <div aria-live="polite" className="service-report-empty">
      <span className="loading-spinner" />
      <strong>{title}</strong>
    </div>
  );
}
function reportPeriod() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return { dateFrom: localDate(first), dateTo: localDate(today) };
}
function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function statusLabel(value: ServiceRequestStatus) {
  return {
    new: 'New',
    scheduled: 'Scheduled',
    in_progress: 'In progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }[value];
}
function serviceTypeLabel(value: ServiceType) {
  return {
    warranty: 'Warranty',
    out_of_warranty: 'Out of warranty',
    subscription: 'Service subscription',
  }[value];
}
function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
function money(value: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'BGN' }).format(
    Number(value),
  );
}
function percentage(value: number, total: number) {
  return `${total ? Math.max(4, Math.round((value / total) * 100)) : 0}%`;
}
function formatLabel(format: ReportExportFormat) {
  return { csv: 'CSV', pdf: 'PDF', xlsx: 'Excel' }[format];
}
function formatDescription(format: ReportExportFormat) {
  return {
    csv: 'For data exchange',
    pdf: 'For sharing or printing',
    xlsx: 'For working in a spreadsheet',
  }[format];
}
function formatExportDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
function formatFileSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}
