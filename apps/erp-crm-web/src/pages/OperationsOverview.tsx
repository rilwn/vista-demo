import { useEffect, useState } from 'react';
import { Button, InlineAlert } from '@vista/ui';
import { overviewMetricKeys, type OperationsOverview as OverviewData } from '@vista/contracts';
import { getOperationsOverview } from '../api/report-workspace';
import { Link } from '../routing/Router';
import { Icon, type IconName } from '../components/Icon';
import { overviewMessages as copy } from './operations-overview.messages';
import './report-workspace.css';
import { OverviewPreferences } from './OverviewPreferences';

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
  const hasVisibleCards =
    data &&
    overviewMetricKeys.some(
      (key) => data[key] !== undefined && !data.preferences?.hiddenCards.includes(key),
    );
  return (
    <section aria-label={copy.label} className="operations-overview">
      <form
        className="operations-filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            setQuery({ ...dates });
            setRefresh((value) => value + 1);
          }
        }}
      >
        <div className="operations-filter-field">
          <label htmlFor="overview-revenue-from">{copy.from}</label>
          <div className="operations-filter-control">
            <input
              id="overview-revenue-from"
              type="date"
              required
              value={dates.dateFrom}
              onChange={(event) => setDates({ ...dates, dateFrom: event.target.value })}
            />
          </div>
        </div>
        <div className="operations-filter-field">
          <label htmlFor="overview-revenue-to">{copy.to}</label>
          <div className="operations-filter-control">
            <input
              id="overview-revenue-to"
              type="date"
              required
              min={dates.dateFrom}
              value={dates.dateTo}
              onChange={(event) => setDates({ ...dates, dateTo: event.target.value })}
            />
          </div>
        </div>
        <div className="operations-filter-field operations-filter-warranty">
          <label htmlFor="overview-warranty-days">{copy.warrantiesWithin}</label>
          <div className="operations-filter-control">
            <select
              id="overview-warranty-days"
              value={dates.warrantyDays}
              onChange={(event) => setDates({ ...dates, warrantyDays: Number(event.target.value) })}
            >
              {[30, 60, 90].map((days) => (
                <option key={days} value={days}>
                  {copy.days(days)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button
          className="operations-filter-apply"
          type="submit"
          disabled={!valid}
          busy={loading}
          busyLabel={copy.updating}
        >
          {copy.apply}
        </Button>
      </form>
      {loading ? <p role="status">{copy.loading}</p> : null}
      {error ? <InlineAlert tone="error">{copy.error}</InlineAlert> : null}
      {data ? (
        <OverviewPreferences
          key={`${token}:${refresh}:${JSON.stringify(query)}`}
          token={token}
          data={data}
          onSaved={(preferences) =>
            setData((current) => (current ? { ...current, preferences } : current))
          }
        />
      ) : null}
      {data && !hasVisibleCards ? <p>{copy.hidden}</p> : null}
      {data ? (
        <div className="operations-metrics">
          {data.recordedRevenueBgn !== undefined &&
          !data.preferences?.hiddenCards.includes('recordedRevenueBgn') ? (
            <Metric
              title={copy.revenue}
              icon="chart"
              value={money(data.recordedRevenueBgn)}
              to="/modules/erp.finance/registers"
              link={copy.financeLink}
            >
              {dateRange(data.dateFrom, data.dateTo)}
            </Metric>
          ) : null}
          {data.activeServiceRequests !== undefined &&
          !data.preferences?.hiddenCards.includes('activeServiceRequests') ? (
            <Metric
              title={copy.service}
              icon="service"
              value={String(data.activeServiceRequests)}
              to="/modules/erp.service/requests"
              link={copy.serviceLink}
            >
              {copy.asOf(displayDate(data.asOf))}
            </Metric>
          ) : null}
          {data.expiringWarranties !== undefined &&
          !data.preferences?.hiddenCards.includes('expiringWarranties') ? (
            <Metric
              title={copy.warranties}
              icon="shield"
              value={String(data.expiringWarranties)}
              to={warrantyPath}
              link={copy.warrantiesLink}
            >
              {copy.nextDays(data.warrantyDays)}
            </Metric>
          ) : null}
          {data.overdueReceivablesBgn !== undefined &&
          !data.preferences?.hiddenCards.includes('overdueReceivablesBgn') ? (
            <Metric
              title={copy.overdue}
              icon="finance"
              value={money(data.overdueReceivablesBgn)}
              to="/modules/erp.finance/payments"
              link={copy.collectionsLink}
            >
              {copy.asOf(displayDate(data.asOf))}
            </Metric>
          ) : null}
        </div>
      ) : null}
      {data && hasVisibleCards ? (
        <div className="operations-context">
          {data.recordedRevenueBgn !== undefined &&
          !data.preferences?.hiddenCards.includes('recordedRevenueBgn') ? (
            <p>{copy.revenueNote}</p>
          ) : null}
          <details className="operations-calculations">
            <summary>
              {copy.details}
              <Icon name="chevron" size={14} />
            </summary>
            <dl>
              {data.recordedRevenueBgn !== undefined &&
              !data.preferences?.hiddenCards.includes('recordedRevenueBgn') ? (
                <div>
                  <dt>{copy.revenue}</dt>
                  <dd>{copy.revenueDetails}</dd>
                </div>
              ) : null}
              {data.activeServiceRequests !== undefined &&
              !data.preferences?.hiddenCards.includes('activeServiceRequests') ? (
                <div>
                  <dt>{copy.service}</dt>
                  <dd>{copy.serviceDetails}</dd>
                </div>
              ) : null}
              {data.expiringWarranties !== undefined &&
              !data.preferences?.hiddenCards.includes('expiringWarranties') ? (
                <div>
                  <dt>{copy.warranties}</dt>
                  <dd>
                    {copy.warrantyDetails} {copy.asOf(displayDate(data.asOf))}.
                  </dd>
                </div>
              ) : null}
              {data.overdueReceivablesBgn !== undefined &&
              !data.preferences?.hiddenCards.includes('overdueReceivablesBgn') ? (
                <div>
                  <dt>{copy.overdue}</dt>
                  <dd>{copy.overdueDetails}</dd>
                </div>
              ) : null}
            </dl>
          </details>
        </div>
      ) : null}
    </section>
  );
}

function Metric({
  title,
  icon,
  value,
  children,
  to,
  link,
}: {
  title: string;
  icon: IconName;
  value: string;
  children: React.ReactNode;
  to: string;
  link: string;
}) {
  return (
    <article className="operations-metric">
      <header className="operations-metric-heading">
        <h2>{title}</h2>
        <span className="operations-metric-icon">
          <Icon name={icon} size={17} />
        </span>
      </header>
      <strong className="operations-metric-value">{value}</strong>
      <p className="operations-metric-period">{children}</p>
      <Link className="operations-metric-link" to={to}>
        <span>{link}</span>
        <Icon name="arrow" size={15} />
      </Link>
    </article>
  );
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function dateRange(from: string, to: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatRange(new Date(`${from}T12:00:00Z`), new Date(`${to}T12:00:00Z`));
}

function money(value: string): string {
  // Only display formatting uses Number; all monetary calculations stay in PostgreSQL numeric.
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'BGN' }).format(
    Number(value),
  );
}
