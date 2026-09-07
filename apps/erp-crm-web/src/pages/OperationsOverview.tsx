import { useEffect, useState } from 'react';
import { Button, InlineAlert } from '@vista/ui';
import type { OperationsOverview as OverviewData } from '@vista/contracts';
import { getOperationsOverview } from '../api/report-workspace';
import { Link } from '../routing/Router';
import './report-workspace.css';

export function OperationsOverview({
  token,
  warrantyPath,
}: {
  token: string;
  warrantyPath: string;
}) {
  const [dates, setDates] = useState(() => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Sofia',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today, warrantyDays: 30 };
  });
  const [query, setQuery] = useState(dates);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setData(null);
    void getOperationsOverview(token, query.dateFrom, query.dateTo, query.warrantyDays)
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, query, refresh]);
  const valid = dates.dateFrom && dates.dateTo && dates.dateFrom <= dates.dateTo;
  return (
    <section aria-label="Business overview" className="page-stack">
      <form
        className="content-panel operations-filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            setQuery({ ...dates });
            setRefresh((value) => value + 1);
          }
        }}
      >
        <label htmlFor="overview-revenue-from">
          Revenue from
          <input
            id="overview-revenue-from"
            type="date"
            required
            value={dates.dateFrom}
            onChange={(event) => setDates({ ...dates, dateFrom: event.target.value })}
          />
        </label>
        <label htmlFor="overview-revenue-to">
          Revenue to
          <input
            id="overview-revenue-to"
            type="date"
            required
            min={dates.dateFrom}
            value={dates.dateTo}
            onChange={(event) => setDates({ ...dates, dateTo: event.target.value })}
          />
        </label>
        <label htmlFor="overview-warranty-days">
          Warranties ending within
          <select
            id="overview-warranty-days"
            value={dates.warrantyDays}
            onChange={(event) => setDates({ ...dates, warrantyDays: Number(event.target.value) })}
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <Button type="submit" disabled={!valid} busy={loading}>
          Apply
        </Button>
      </form>
      {loading ? <p role="status">Loading business overview…</p> : null}
      {error ? (
        <InlineAlert tone="error">
          The overview could not be loaded. Select Apply to try again.
        </InlineAlert>
      ) : null}
      {data ? (
        <div className="operations-metrics">
          {data.recordedRevenueBgn !== undefined ? (
            <Metric
              title="Recorded revenue"
              value={money(data.recordedRevenueBgn)}
              to="/modules/erp.finance/registers"
              link="Review Finance reports"
            >
              {data.dateFrom} – {data.dateTo}. Prepared invoices and correction notes, before VAT.
              Not posted accounting revenue.
            </Metric>
          ) : null}
          {data.activeServiceRequests !== undefined ? (
            <Metric
              title="Active Service requests"
              value={String(data.activeServiceRequests)}
              to="/modules/erp.service/requests"
              link="Open Service requests"
            >
              New, scheduled and in-progress requests as of {data.asOf}.
            </Metric>
          ) : null}
          {data.expiringWarranties !== undefined ? (
            <Metric
              title="Warranties ending soon"
              value={String(data.expiringWarranties)}
              to={warrantyPath}
              link="Review warranties"
            >
              Active equipment with coverage ending within {data.warrantyDays} days of {data.asOf}.
            </Metric>
          ) : null}
          {data.overdueReceivablesBgn !== undefined ? (
            <Metric
              title="Overdue receivables"
              value={money(data.overdueReceivablesBgn)}
              to="/modules/erp.finance/payments"
              link="Open collections"
            >
              Unpaid balances past their due date as of {data.asOf}, using each document’s saved
              exchange rate.
            </Metric>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Metric({
  title,
  value,
  children,
  to,
  link,
}: {
  title: string;
  value: string;
  children: React.ReactNode;
  to: string;
  link: string;
}) {
  return (
    <article className="content-panel operations-metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{children}</small>
      <Link to={to}>{link}</Link>
    </article>
  );
}

function money(value: string): string {
  // Only display formatting uses Number; all monetary calculations stay in PostgreSQL numeric.
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'BGN' }).format(
    Number(value),
  );
}
