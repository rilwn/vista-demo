import type {
  PosReportDefinition,
  PosReportDefinitionKey,
  PosReportExport,
  PosReportFilters,
  PosReportOverview,
  PosReportReferenceData,
  PosPaymentMethod,
  PosShiftReportRow,
  ReportExportFormat,
  SavedPosReport,
} from '@vista/contracts';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PosSavedReports } from './PosSavedReports';
import { savedReportText } from './pos-saved-reports.messages';

import {
  createPosReportExport,
  downloadPosReportExport,
  getPosReportDefinitions,
  getPosReportExports,
  getPosReportOverview,
  getPosReportReferenceData,
  retryPosReportExport,
} from './api/pos';

type Notice = { kind: 'error' | 'info' | 'success'; text: string };
type ReportView =
  'cashiers' | 'categories' | 'comparison' | 'locations' | 'payments' | 'products' | 'shifts';

const reportViews: Array<{ key: ReportView; label: string }> = [
  { key: 'shifts', label: 'Shifts' },
  { key: 'cashiers', label: 'Cashiers' },
  { key: 'products', label: 'Products' },
  { key: 'categories', label: 'Categories' },
  { key: 'payments', label: 'Payments' },
  { key: 'locations', label: 'Locations' },
  { key: 'comparison', label: 'Compare locations' },
];

const definitionForView: Record<ReportView, PosReportDefinitionKey> = {
  cashiers: 'pos.cashier-performance',
  categories: 'pos.category-sales',
  comparison: 'pos.location-comparison',
  locations: 'pos.location-sales',
  payments: 'pos.payment-methods',
  products: 'pos.product-sales',
  shifts: 'pos.shift-register',
};

export function PosReports({
  canCreate = false,
  onNotice,
  token,
}: {
  canCreate?: boolean;
  onNotice: (notice: Notice) => void;
  token: string;
}) {
  const initialFilters = useMemo(defaultFilters, []);
  const [applied, setApplied] = useState<PosReportFilters>(initialFilters);
  const [definitions, setDefinitions] = useState<PosReportDefinition[]>([]);
  const [draft, setDraft] = useState<PosReportFilters>(initialFilters);
  const [error, setError] = useState<string>();
  const [exporting, setExporting] = useState<string>();
  const [exports, setExports] = useState<PosReportExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<PosReportOverview>();
  const [references, setReferences] = useState<PosReportReferenceData>();
  const [selectedShift, setSelectedShift] = useState<PosShiftReportRow>();
  const [view, setView] = useState<ReportView>('shifts');
  const [columns, setColumns] = useState<string[] | undefined>();
  const exportRequest = useRef<{ body: string; id: string } | undefined>(undefined);
  const exportBusy = useRef(false);

  function restoreSaved(report: SavedPosReport) {
    const nextView = reportViews.find(
      (item) => definitionForView[item.key] === report.definitionKey,
    );
    if (
      !nextView ||
      !report.dateFrom ||
      !report.dateTo ||
      !definitions.some((item) => item.key === report.definitionKey)
    ) {
      onNotice({ kind: 'error', text: savedReportText.unavailable });
      return;
    }
    const filters: PosReportFilters = {
      dateFrom: report.dateFrom,
      dateTo: report.dateTo,
      ...(report.businessLocationId ? { businessLocationId: report.businessLocationId } : {}),
      ...(report.cashRegisterId ? { cashRegisterId: report.cashRegisterId } : {}),
      ...(report.operatorId ? { operatorId: report.operatorId } : {}),
    };
    setView(nextView.key);
    setColumns(report.columns);
    setDraft(filters);
    setApplied(filters);
    onNotice({ kind: 'success', text: savedReportText.restored });
  }

  const loadExports = useCallback(async () => {
    const page = await getPosReportExports(token);
    setExports(page.items);
    return page.items;
  }, [token]);

  const loadReport = useCallback(
    async (filters: PosReportFilters) => {
      setLoading(true);
      setError(undefined);
      try {
        const [nextOverview, nextReferences, nextDefinitions, nextExports] = await Promise.all([
          getPosReportOverview(token, filters),
          getPosReportReferenceData(token),
          getPosReportDefinitions(token),
          getPosReportExports(token),
        ]);
        setOverview(nextOverview);
        setReferences(nextReferences);
        setDefinitions(nextDefinitions);
        setExports(nextExports.items);
      } catch (caught) {
        setError(messageFor(caught));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void loadReport(applied);
  }, [applied, loadReport]);

  useEffect(() => {
    if (!exports.some((item) => item.status === 'queued' || item.status === 'processing')) return;
    const timer = window.setInterval(() => void loadExports().catch(() => undefined), 1800);
    return () => window.clearInterval(timer);
  }, [exports, loadExports]);

  const registers = (references?.registers ?? []).filter(
    (item) => !draft.businessLocationId || item.businessLocationId === draft.businessLocationId,
  );
  const operators = (references?.operators ?? []).filter(
    (item) => !draft.businessLocationId || item.businessLocationId === draft.businessLocationId,
  );

  async function requestExport(
    definitionKey: PosReportDefinitionKey,
    format: ReportExportFormat,
    shiftId?: string,
  ) {
    if (!canCreate || exportBusy.current || (!shiftId && columns?.length === 0)) return;
    exportBusy.current = true;
    const key = `${definitionKey}:${format}:${shiftId ?? 'period'}`;
    setExporting(key);
    try {
      const input = {
        definitionKey,
        format,
        ...(shiftId
          ? { shiftId }
          : {
              ...applied,
              ...(columns ? { columns } : {}),
            }),
      };
      const body = JSON.stringify(input);
      if (exportRequest.current?.body !== body)
        exportRequest.current = { body, id: crypto.randomUUID() };
      await createPosReportExport(token, input, exportRequest.current.id);
      await loadExports();
      onNotice({ kind: 'success', text: 'Report preparation started. It will be ready shortly.' });
    } catch (caught) {
      onNotice({ kind: 'error', text: messageFor(caught) });
    } finally {
      exportBusy.current = false;
      setExporting(undefined);
    }
  }

  async function download(report: PosReportExport) {
    try {
      const blob = await downloadPosReportExport(token, report);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = report.fileName ?? `${report.name}.${report.format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      onNotice({ kind: 'error', text: messageFor(caught) });
    }
  }

  async function retry(report: PosReportExport) {
    try {
      await retryPosReportExport(token, report.id);
      await loadExports();
      onNotice({ kind: 'success', text: 'The report is being prepared again.' });
    } catch (caught) {
      onNotice({ kind: 'error', text: messageFor(caught) });
    }
  }

  const definition = definitions.find((item) => item.key === definitionForView[view]);

  return (
    <div className="pos-reports-page">
      <header className="pos-page-heading pos-reports-heading">
        <div>
          <p>Point of sale</p>
          <h1>Reports</h1>
          <span>Review takings, returns, cash, products, and counter performance.</span>
        </div>
        <div className="pos-export-buttons" aria-label="Export current report">
          {(['pdf', 'xlsx', 'csv'] as const).map((format) => (
            <button
              disabled={
                !canCreate ||
                !overview ||
                loading ||
                exporting !== undefined ||
                columns?.length === 0
              }
              key={format}
              onClick={() => void requestExport(definitionForView[view], format)}
              type="button"
            >
              {exporting === `${definitionForView[view]}:${format}:period`
                ? 'Preparing…'
                : format.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <section className="pos-report-filters" aria-label="Report filters">
        <label>
          <span>From</span>
          <input
            onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })}
            type="date"
            value={draft.dateFrom}
          />
        </label>
        <label>
          <span>To</span>
          <input
            onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })}
            type="date"
            value={draft.dateTo}
          />
        </label>
        <label>
          <span>Location</span>
          <select
            onChange={(event) =>
              setDraft(
                withOptionalFilter(draft, 'businessLocationId', event.target.value, [
                  'cashRegisterId',
                  'operatorId',
                ]),
              )
            }
            value={draft.businessLocationId ?? ''}
          >
            <option value="">All locations</option>
            {references?.locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Register</span>
          <select
            onChange={(event) =>
              setDraft(withOptionalFilter(draft, 'cashRegisterId', event.target.value))
            }
            value={draft.cashRegisterId ?? ''}
          >
            <option value="">All registers</option>
            {registers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Cashier</span>
          <select
            onChange={(event) =>
              setDraft(withOptionalFilter(draft, 'operatorId', event.target.value))
            }
            value={draft.operatorId ?? ''}
          >
            <option value="">All cashiers</option>
            {operators.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.code}
              </option>
            ))}
          </select>
        </label>
        <button
          className="pos-primary-button"
          disabled={!draft.dateFrom || !draft.dateTo || draft.dateFrom > draft.dateTo}
          onClick={() => setApplied({ ...draft })}
          type="button"
        >
          Apply
        </button>
      </section>

      {definition ? (
        <PosSavedReports
          token={token}
          definition={definition}
          filters={applied}
          columns={columns}
          onColumns={setColumns}
          onRestore={restoreSaved}
          onExport={(format) => void requestExport(definition.key, format)}
          canCreate={canCreate}
          exporting={loading || exporting !== undefined}
          onNotice={onNotice}
        />
      ) : null}

      {error ? (
        <section className="pos-report-error">
          <strong>Reports are unavailable</strong>
          <p>{error}</p>
          <button onClick={() => void loadReport(applied)} type="button">
            Try again
          </button>
        </section>
      ) : loading || !overview ? (
        <div className="pos-page-loading" role="status">
          Preparing report…
        </div>
      ) : (
        <>
          <section className="pos-report-kpis" aria-label="Report summary">
            <ReportKpi label="Net revenue" value={money(overview.totals.netRevenueBgn)} />
            <ReportKpi label="Completed sales" value={String(overview.totals.saleCount)} />
            <ReportKpi label="Returns" value={money(overview.totals.grossReturnsBgn)} />
            <ReportKpi label="Average sale" value={money(overview.totals.averageSaleBgn)} />
          </section>

          <section className="pos-report-card">
            <div className="pos-report-card-head">
              <div>
                <strong>
                  {definition?.name ?? reportViews.find((item) => item.key === view)?.label}
                </strong>
                <span>{definition?.description}</span>
              </div>
              <small>
                {applied.dateFrom} – {applied.dateTo}
              </small>
            </div>
            <div className="pos-report-tabs" role="tablist" aria-label="POS report views">
              {reportViews.map((item) => (
                <button
                  aria-selected={view === item.key}
                  className={view === item.key ? 'is-active' : undefined}
                  key={item.key}
                  onClick={() => {
                    setView(item.key);
                    setColumns(undefined);
                  }}
                  role="tab"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <ReportTable overview={overview} onShift={setSelectedShift} view={view} />
          </section>
        </>
      )}

      <RecentExports
        canRetry={canCreate}
        exports={exports}
        onDownload={(report) => void download(report)}
        onRefresh={() =>
          void loadExports().catch((caught: unknown) =>
            onNotice({ kind: 'error', text: messageFor(caught) }),
          )
        }
        onRetry={(report) => {
          if (canCreate) void retry(report);
        }}
      />

      {selectedShift ? (
        <ShiftReportDialog
          exporting={canCreate ? exporting : 'unavailable'}
          onClose={() => setSelectedShift(undefined)}
          onExport={(format) =>
            void requestExport(
              selectedShift.status === 'open' ? 'pos.x-report' : 'pos.z-report',
              format,
              selectedShift.id,
            )
          }
          shift={selectedShift}
        />
      ) : null}
    </div>
  );
}

function ReportKpi({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ReportTable({
  onShift,
  overview,
  view,
}: {
  onShift: (shift: PosShiftReportRow) => void;
  overview: PosReportOverview;
  view: ReportView;
}) {
  if (view === 'shifts')
    return (
      <Table
        columns={['Shift', 'Register', 'Cashier', 'Sales', 'Returns', 'Net revenue', 'Status', '']}
        empty="No cashier shifts opened in this period."
        rows={overview.shifts.map((row) => [
          <div className="pos-report-primary" key="shift">
            <strong>{row.shiftNumber}</strong>
            <small>{dateTime(row.openedAt)}</small>
          </div>,
          <span key="register">{row.cashRegisterName}</span>,
          <span key="cashier">{row.operatorName}</span>,
          <span key="sales">{row.saleCount}</span>,
          <span key="returns">{row.returnCount}</span>,
          <strong key="revenue">{money(row.netRevenueBgn)}</strong>,
          <span className={`pos-report-status is-${row.status}`} key="status">
            {row.status === 'open' ? 'Open' : 'Closed'}
          </span>,
          <button
            className="pos-table-action"
            key="action"
            onClick={() => onShift(row)}
            type="button"
          >
            {row.status === 'open' ? 'View X report' : 'View Z report'}
          </button>,
        ])}
      />
    );
  if (view === 'cashiers')
    return (
      <Table
        columns={['Cashier', 'Sales', 'Returns', 'Sales total', 'Returned', 'Net revenue']}
        empty="No cashier activity in this period."
        rows={overview.cashiers.map((row) => [
          <div className="pos-report-primary" key="cashier">
            <strong>{row.name}</strong>
            <small>{row.operatorCode}</small>
          </div>,
          <span key="sales">{row.saleCount}</span>,
          <span key="returns">{row.returnCount}</span>,
          <span key="gross">{money(row.grossSalesBgn)}</span>,
          <span key="returned">{money(row.grossReturnsBgn)}</span>,
          <strong key="net">{money(row.netRevenueBgn)}</strong>,
        ])}
      />
    );
  if (view === 'products')
    return (
      <Table
        columns={['Product', 'Category', 'Sold', 'Returned', 'Net revenue']}
        empty="No products sold in this period."
        rows={overview.products.map((row) => [
          <div className="pos-report-primary" key="product">
            <strong>{row.productName}</strong>
            <small>{row.productCode}</small>
          </div>,
          <span key="category">{row.categoryName}</span>,
          <span key="sold">{quantity(row.quantitySold)}</span>,
          <span key="returned">{quantity(row.quantityReturned)}</span>,
          <strong key="net">{money(row.netRevenueBgn)}</strong>,
        ])}
      />
    );
  if (view === 'categories')
    return (
      <Table
        columns={['Category', 'Sold', 'Returned', 'Sales total', 'Returned', 'Net revenue']}
        empty="No category activity in this period."
        rows={overview.categories.map((row) => [
          <strong key="category">{row.categoryName}</strong>,
          <span key="sold">{quantity(row.quantitySold)}</span>,
          <span key="quantity-returned">{quantity(row.quantityReturned)}</span>,
          <span key="gross">{money(row.grossSalesBgn)}</span>,
          <span key="returned">{money(row.grossReturnsBgn)}</span>,
          <strong key="net">{money(row.netRevenueBgn)}</strong>,
        ])}
      />
    );
  if (view === 'payments')
    return (
      <Table
        columns={['Payment method', 'Collected', 'Refunded', 'Net']}
        empty="No payments recorded in this period."
        rows={overview.payments.map((row) => [
          <strong key="method">{paymentMethodLabel(row.method)}</strong>,
          <span key="collected">{money(row.collectedBgn)}</span>,
          <span key="refunded">{money(row.refundedBgn)}</span>,
          <strong key="net">{money(row.netBgn)}</strong>,
        ])}
      />
    );
  if (view === 'locations')
    return (
      <Table
        columns={['Location', 'Sales', 'Returns', 'Sales total', 'Returned', 'Net revenue']}
        empty="No location activity in this period."
        rows={overview.locations.map((row) => [
          <strong key="location">{row.locationName}</strong>,
          <span key="sales">{row.saleCount}</span>,
          <span key="returns">{row.returnCount}</span>,
          <span key="gross">{money(row.grossSalesBgn)}</span>,
          <span key="returned">{money(row.grossReturnsBgn)}</span>,
          <strong key="net">{money(row.netRevenueBgn)}</strong>,
        ])}
      />
    );
  return (
    <Table
      columns={['Location', 'Transactions', 'Average sale', 'Net revenue', 'Revenue share']}
      empty="Two or more locations with sales will appear here for comparison."
      rows={overview.locations.map((row) => [
        <strong key="location">{row.locationName}</strong>,
        <span key="transactions">{row.saleCount + row.returnCount}</span>,
        <span key="average">{money(row.averageSaleBgn)}</span>,
        <strong key="net">{money(row.netRevenueBgn)}</strong>,
        <span key="share">{row.revenueSharePercent.toFixed(2)}%</span>,
      ])}
    />
  );
}

function paymentMethodLabel(method: PosPaymentMethod) {
  if (method === 'cash') return 'Cash';
  if (method === 'card') return 'Bank card';
  if (method === 'advance') return 'Customer advance';
  return 'On account';
}

function Table({
  columns,
  empty,
  rows,
}: {
  columns: string[];
  empty: string;
  rows: ReactNode[][];
}) {
  if (!rows.length) return <p className="pos-report-empty">{empty}</p>;
  return (
    <div className="pos-report-table-wrap">
      <table className="pos-report-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShiftReportDialog({
  exporting,
  onClose,
  onExport,
  shift,
}: {
  exporting: string | undefined;
  onClose: () => void;
  onExport: (format: ReportExportFormat) => void;
  shift: PosShiftReportRow;
}) {
  const reportKey = shift.status === 'open' ? 'pos.x-report' : 'pos.z-report';
  const title = shift.status === 'open' ? 'X report' : 'Z report';
  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="shift-report-title"
        aria-modal="true"
        className="pos-dialog pos-shift-report-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>{shift.shiftNumber}</p>
            <h2 id="shift-report-title">{title}</h2>
          </div>
          <button aria-label="Close shift report" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <div className="pos-dialog-body">
          {shift.fiscalMode === 'simulator' ? (
            <div className="pos-simulator-label">
              Test receipt mode
              <small>Preview from the test register. No certified H-18 report was issued.</small>
            </div>
          ) : null}
          <dl className="pos-shift-report-summary">
            <ReportValue label="Location" value={shift.locationName} />
            <ReportValue label="Register" value={shift.cashRegisterName} />
            <ReportValue label="Cashier" value={`${shift.operatorName} · ${shift.operatorCode}`} />
            <ReportValue label="Opened" value={dateTime(shift.openedAt)} />
            {shift.closedAt ? (
              <ReportValue label="Closed" value={dateTime(shift.closedAt)} />
            ) : null}
            <ReportValue
              label="Sales"
              value={`${shift.saleCount} · ${money(shift.grossSalesBgn)}`}
            />
            <ReportValue
              label="Returns"
              value={`${shift.returnCount} · ${money(shift.grossReturnsBgn)}`}
            />
            <ReportValue label="Net revenue" value={money(shift.netRevenueBgn)} />
          </dl>
          <section className="pos-cash-reconciliation">
            <h3>Cash reconciliation</h3>
            <div>
              <span>Opening cash</span>
              <strong>{money(shift.openingCashBgn)}</strong>
            </div>
            <div>
              <span>Cash sales</span>
              <strong>{money(shift.cashSalesBgn)}</strong>
            </div>
            <div>
              <span>Cash refunds</span>
              <strong>− {money(shift.cashRefundsBgn)}</strong>
            </div>
            <div className="is-total">
              <span>Expected cash</span>
              <strong>{money(shift.expectedCashBgn)}</strong>
            </div>
            {shift.closingCashBgn ? (
              <div>
                <span>Counted cash</span>
                <strong>{money(shift.closingCashBgn)}</strong>
              </div>
            ) : null}
            {shift.differenceBgn ? (
              <div>
                <span>Difference</span>
                <strong>{money(shift.differenceBgn)}</strong>
              </div>
            ) : null}
          </section>
        </div>
        <footer className="pos-shift-report-footer">
          <button className="pos-secondary-button" onClick={onClose} type="button">
            Back
          </button>
          <div>
            {(['pdf', 'xlsx', 'csv'] as const).map((format) => (
              <button
                className={format === 'pdf' ? 'pos-primary-button' : 'pos-secondary-button'}
                disabled={exporting !== undefined}
                key={format}
                onClick={() => onExport(format)}
                type="button"
              >
                {exporting === `${reportKey}:${format}:${shift.id}`
                  ? 'Preparing…'
                  : format.toUpperCase()}
              </button>
            ))}
          </div>
        </footer>
      </section>
    </div>
  );
}

function ReportValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RecentExports({
  canRetry,
  exports,
  onDownload,
  onRefresh,
  onRetry,
}: {
  canRetry: boolean;
  exports: PosReportExport[];
  onDownload: (report: PosReportExport) => void;
  onRefresh: () => void;
  onRetry: (report: PosReportExport) => void;
}) {
  return (
    <section className="pos-recent-exports">
      <header>
        <div>
          <strong>Recent exports</strong>
          <span>Only reports requested from this account are shown.</span>
        </div>
        <button onClick={onRefresh} type="button">
          Refresh
        </button>
      </header>
      {exports.length ? (
        <div className="pos-export-list">
          {exports.slice(0, 6).map((report) => (
            <article key={report.id}>
              <span className="pos-export-format">{report.format.toUpperCase()}</span>
              <div>
                <strong>{report.name}</strong>
                <small>
                  {dateTime(report.createdAt)}
                  {report.rowCount === undefined ? '' : ` · ${report.rowCount} rows`}
                </small>
              </div>
              <span className={`pos-export-state is-${report.status}`}>
                {exportStatus(report.status)}
              </span>
              {report.status === 'completed' ? (
                <button onClick={() => onDownload(report)} type="button">
                  Download
                </button>
              ) : null}
              {report.status === 'failed' && canRetry ? (
                <button onClick={() => onRetry(report)} type="button">
                  Try again
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="pos-report-empty">Your prepared files will appear here.</p>
      )}
    </section>
  );
}

function withOptionalFilter<K extends 'businessLocationId' | 'cashRegisterId' | 'operatorId'>(
  filters: PosReportFilters,
  key: K,
  value: string,
  clear: Array<'cashRegisterId' | 'operatorId'> = [],
): PosReportFilters {
  const next = { ...filters };
  delete next[key];
  for (const cleared of clear) delete next[cleared];
  if (value) next[key] = value;
  return next;
}

function defaultFilters(): PosReportFilters {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  return { dateFrom: localDate(from), dateTo: localDate(now) };
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function money(value: string | number): string {
  return `${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} BGN`;
}

function quantity(value: string): string {
  return Number(value).toLocaleString('en-GB', { maximumFractionDigits: 4 });
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function exportStatus(status: PosReportExport['status']): string {
  if (status === 'completed') return 'Ready';
  if (status === 'failed') return 'Needs attention';
  if (status === 'processing') return 'Preparing';
  return 'Waiting';
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
