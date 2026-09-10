import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, InlineAlert } from '@vista/ui';
import type {
  LibraryDefinition,
  LibraryView,
  LibraryViewPage,
  LibraryExport,
  ReportSchedule,
  ReportSchedulePage,
  ReportScheduleInput,
  ReportRunPage,
  ReportingScope,
} from '@vista/contracts';
import { useAuth } from '../auth/AuthProvider';
import { Link } from '../routing/Router';
import { Icon } from '../components/Icon';
import { reportingHubApi as api, downloadLibraryExport } from '../api/reporting-hub';
import { hubCopy as copy } from './reporting-hub.messages';
import { OperationsOverview } from './OperationsOverview';
import './reporting-hub.css';
const paths: Record<ReportingScope, string> = {
  finance: '/modules/erp.finance/registers',
  procurement: '/modules/erp.procurement/reports',
  warehouse: '/modules/erp.warehouse/reports',
  sales: '/modules/erp.sales/reports',
  logistics: '/modules/erp.logistics/reports',
  service: '/modules/erp.service/reports',
  crm: '/modules/crm/analytics',
  pos: '/modules/pos',
};
export type ReportingHubView = 'report-library' | 'scheduled-exports' | 'dashboards';
export function ReportingHubPage({ view }: { view: ReportingHubView }) {
  const { session, hasPermission } = useAuth();
  return (
    <ReportingHub
      key={`${view}:${session?.sessionToken}`}
      view={view}
      token={session?.sessionToken ?? ''}
      showOverview={
        hasPermission('erp.finance') ||
        hasPermission('crm') ||
        hasPermission('erp.service', 'approve')
      }
    />
  );
}
export function ReportingHub({
  view,
  token,
  showOverview = false,
}: {
  view: ReportingHubView;
  token: string;
  showOverview?: boolean;
}) {
  const [definitions, setDefinitions] = useState<LibraryDefinition[]>([]),
    [timezone, setTimezone] = useState(''),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([api.definitions(token), api.context(token)])
      .then(([d, c]) => {
        if (active) {
          setDefinitions(d);
          setTimezone(c.timezone);
        }
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
  }, [token, reload]);
  return (
    <div className="page-stack reporting-hub">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{copy.title}</p>
          <h1>
            {view === 'report-library'
              ? copy.library
              : view === 'scheduled-exports'
                ? copy.schedules
                : copy.dashboards}
          </h1>
          <p>{copy.description}</p>
        </div>
      </header>
      <nav className="workflow-tabs" aria-label={copy.title}>
        {(['report-library', 'scheduled-exports', 'dashboards'] as const).map((key) => (
          <Link
            key={key}
            className={view === key ? 'is-active' : ''}
            aria-current={view === key ? 'page' : undefined}
            to={`/modules/reports/${key}`}
          >
            {key === 'report-library'
              ? copy.library
              : key === 'scheduled-exports'
                ? copy.schedules
                : copy.dashboards}
          </Link>
        ))}
      </nav>
      {loading ? (
        <p role="status">{copy.loading}</p>
      ) : error ? (
        <InlineAlert tone="error">
          {copy.error}
          <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
            {copy.retry}
          </Button>
        </InlineAlert>
      ) : view === 'report-library' ? (
        <Library token={token} definitions={definitions} timezone={timezone} />
      ) : view === 'scheduled-exports' ? (
        <Schedules token={token} definitions={definitions} timezone={timezone} />
      ) : (
        <>
          <section className="content-panel hub-dashboard-links">
            <h2>{copy.dashboards}</h2>
            <p>{copy.dashboardHint}</p>
            {(['finance', 'service', 'crm', 'pos'] as const)
              .filter((scope) => definitions.some((d) => d.scope === scope))
              .map((scope) => (
                <ReportLink key={scope} scope={scope}>
                  {copy.scopes[scope]}
                </ReportLink>
              ))}
          </section>
          {showOverview ? (
            <OperationsOverview
              token={token}
              warrantyPath={
                definitions.some((d) => d.scope === 'crm')
                  ? '/modules/crm/customer-care'
                  : '/modules/erp.service/care'
              }
            />
          ) : null}
        </>
      )}
    </div>
  );
}
function Library({
  token,
  definitions,
  timezone,
}: {
  token: string;
  definitions: LibraryDefinition[];
  timezone: string;
}) {
  const [page, setPage] = useState(1),
    [data, setData] = useState<LibraryViewPage>(),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0),
    [selected, setSelected] = useState<LibraryView>(),
    [search, setSearch] = useState('');
  useEffect(() => {
    let active = true;
    setError(false);
    setData(undefined);
    void api
      .views(token, page)
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [page, token, reload]);
  const visible = definitions.filter((d) =>
    `${d.name} ${copy.scopes[d.scope]}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <section className="content-panel hub-card">
        <header>
          <div>
            <h2>{copy.saved}</h2>
          </div>
          <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
            {copy.refresh}
          </Button>
        </header>
        {error ? (
          <InlineAlert tone="error">{copy.error}</InlineAlert>
        ) : !data ? (
          <p role="status">{copy.loading}</p>
        ) : !data.items.length ? (
          <p className="hub-empty">{copy.empty}</p>
        ) : (
          <ul className="hub-list">
            {data.items.map((item) => (
              <li key={`${item.scope}:${item.id}`}>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {copy.scopes[item.scope]} ·{' '}
                    {definitions.find((d) => d.key === item.configuration.definitionKey)?.name} ·{' '}
                    {copy.formats[item.configuration.format]}
                  </small>
                </div>
                <Button variant="secondary" onClick={() => setSelected(item)}>
                  {copy.view}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {data ? <Pagination page={page} total={data.totalPages} onPage={setPage} /> : null}
      </section>
      <section className="content-panel hub-card">
        <header>
          <h2>{copy.standard}</h2>
          <label className="hub-search">
            <span>{copy.search}</span>
            <input value={search} maxLength={120} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </header>
        <ul className="hub-list">
          {[...new Set(visible.map((d) => d.scope))].map((scope) => (
            <li key={scope}>
              <span className="hub-symbol">
                <Icon name="chart" size={18} />
              </span>
              <div>
                <strong>{copy.scopes[scope]}</strong>
                <small>
                  {visible
                    .filter((d) => d.scope === scope)
                    .map((d) => d.name)
                    .join(' · ')}
                </small>
              </div>
              <ReportLink scope={scope}>Open reports</ReportLink>
            </li>
          ))}
        </ul>
        {!visible.length ? <p>{copy.noMatch}</p> : null}
      </section>
      {selected ? (
        <SavedViewDialog
          key={`${selected.scope}:${selected.id}`}
          token={token}
          view={selected}
          definition={definitions.find((d) => d.key === selected.configuration.definitionKey)}
          timezone={timezone}
          close={() => setSelected(undefined)}
        />
      ) : null}
    </>
  );
}
function SavedViewDialog({
  view,
  definition,
  token,
  timezone,
  close,
}: {
  view: LibraryView;
  definition: LibraryDefinition | undefined;
  token: string;
  timezone: string;
  close: () => void;
}) {
  const [schedule, setSchedule] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [created, setCreated] = useState(false),
    [output, setOutput] = useState<LibraryExport>();
  const [name, setName] = useState(view.name),
    [cadence, setCadence] = useState<ReportScheduleInput['cadence']>('daily'),
    [period, setPeriod] = useState<ReportScheduleInput['period']>(
      definition?.requiresDateRange ? 'previous_day' : 'current',
    ),
    [first, setFirst] = useState(() => localDateTime(new Date(Date.now() + 120_000), timezone));
  const saveKey = useRef<{ body: string; id: string } | undefined>(undefined),
    exportKey = useRef(crypto.randomUUID()),
    guard = useRef(false);
  useEffect(() => {
    if (!output || !['queued', 'processing'].includes(output.status)) return;
    let active = true;
    const timer = setInterval(() => {
      void api
        .exportStatus(token, view.scope, output.id)
        .then((d) => {
          if (active) {
            setOutput(d);
            setError(false);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [output, token, view.scope]);
  async function act(kind: 'export' | 'schedule' | 'download' | 'retry') {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(false);
    try {
      if (kind === 'schedule') {
        const body = JSON.stringify({
          viewId: view.id,
          scope: view.scope,
          name: name.trim(),
          cadence,
          period,
          firstRunLocal: first,
        });
        if (saveKey.current?.body !== body) saveKey.current = { body, id: crypto.randomUUID() };
        await api.schedule(token, {
          id: saveKey.current.id,
          viewId: view.id,
          scope: view.scope,
          name: name.trim(),
          cadence,
          period,
          firstRunLocal: first,
        });
        setCreated(true);
      } else if (kind === 'export') {
        setOutput(await api.exportView(token, view.scope, view.id, exportKey.current));
      } else if (kind === 'retry' && output) {
        setOutput(await api.retry(token, view.scope, output.id));
      } else if (output) await downloadLibraryExport(token, view.scope, output);
    } catch {
      setError(true);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const footer = (
    <>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => (schedule && !created ? setSchedule(false) : close())}
      >
        {copy.close}
      </Button>
      {view.canCreate && !created ? (
        schedule ? (
          <Button
            key="create-schedule"
            form="hub-schedule-form"
            type="submit"
            disabled={!name.trim() || !first}
            busy={busy}
            busyLabel={copy.creating}
          >
            {copy.create}
          </Button>
        ) : (
          <Button
            key="open-schedule"
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              setSchedule(true);
            }}
          >
            {copy.schedule}
          </Button>
        )
      ) : null}
    </>
  );
  return (
    <HubDialog
      title={schedule ? copy.schedule : view.name}
      close={close}
      busy={busy}
      footer={footer}
    >
      {error ? <InlineAlert tone="error">{copy.actionError}</InlineAlert> : null}
      {created ? (
        <>
          <p role="status">{copy.created}</p>
          <Link to="/modules/reports/scheduled-exports">{copy.schedules}</Link>
        </>
      ) : schedule ? (
        <form
          id="hub-schedule-form"
          className="hub-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act('schedule');
          }}
        >
          <label>
            {copy.name}
            <input
              required
              maxLength={100}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {copy.cadence}
            <select
              value={cadence}
              disabled={busy}
              onChange={(e) => setCadence(e.target.value as typeof cadence)}
            >
              {Object.entries(copy.cadences).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.period}
            <select
              value={period}
              disabled={busy}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
            >
              {(definition?.requiresDateRange
                ? (['saved_dates', 'previous_day', 'previous_7_days', 'previous_month'] as const)
                : (['current'] as const)
              ).map((key) => (
                <option key={key} value={key}>
                  {copy.periods[key]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.first}
            <input
              type="datetime-local"
              required
              value={first}
              disabled={busy}
              onChange={(e) => setFirst(e.target.value)}
            />
          </label>
          <p>{copy.timezone(timezone)}</p>
          <p>{copy.timeHint}</p>
          <p>{copy.delivery}</p>
        </form>
      ) : (
        <>
          <dl className="hub-details">
            <div>
              <dt>{copy.module}</dt>
              <dd>{copy.scopes[view.scope]}</dd>
            </div>
            <div>
              <dt>{copy.standard}</dt>
              <dd>{definition?.name}</dd>
            </div>
            <div>
              <dt>{copy.dates}</dt>
              <dd>
                {view.configuration.dateFrom
                  ? `${view.configuration.dateFrom} · ${view.configuration.dateTo}`
                  : copy.current}
              </dd>
            </div>
            <div>
              <dt>{copy.fields}</dt>
              <dd>
                {view.configuration.columns
                  ?.map((key) => definition?.columns?.find((c) => c.key === key)?.label ?? key)
                  .join(', ') || copy.noFields}
              </dd>
            </div>
          </dl>
          {view.canCreate ? (
            <Button disabled={busy} onClick={() => void act('export')}>
              {copy.export} · {copy.formats[view.configuration.format]}
            </Button>
          ) : null}
          {output ? (
            <div className="hub-export-result">
              <span role="status">{copy.statuses[output.status]}</span>
              {output.status === 'completed' ? (
                <Button disabled={busy} variant="secondary" onClick={() => void act('download')}>
                  {copy.download}
                </Button>
              ) : output.status === 'failed' && view.canCreate ? (
                <Button disabled={busy} variant="secondary" onClick={() => void act('retry')}>
                  {copy.retry}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </HubDialog>
  );
}
function Schedules({
  token,
  definitions,
  timezone,
}: {
  token: string;
  definitions: LibraryDefinition[];
  timezone: string;
}) {
  const [page, setPage] = useState(1),
    [data, setData] = useState<ReportSchedulePage>(),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0),
    [selected, setSelected] = useState<ReportSchedule>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setError(false);
    void api
      .schedules(token, page)
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [token, page, reload]);
  async function toggle(s: ReportSchedule) {
    if (busy) return;
    setBusy(true);
    try {
      await api.state(token, s.id, !s.enabled, s.version);
      setReload((n) => n + 1);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-panel hub-card">
      <header>
        <div>
          <h2>{copy.schedules}</h2>
          <p>{copy.timezone(timezone)}</p>
        </div>
        <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
          {copy.refresh}
        </Button>
      </header>
      <p>{copy.delivery}</p>
      {error ? <InlineAlert tone="error">{copy.actionError}</InlineAlert> : null}
      {!data ? (
        error ? null : (
          <p role="status">{copy.loading}</p>
        )
      ) : !data.items.length ? (
        <p className="hub-empty">{copy.noSchedules}</p>
      ) : (
        <ul className="hub-list">
          {data.items.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.name}</strong>
                <small>
                  {copy.scopes[s.scope]} · {copy.cadences[s.cadence]} · {copy.periods[s.period]}
                </small>
                <small>
                  {copy.nextRun}: {dateTime(s.nextRunAt, s.timezone)}
                </small>
              </div>
              <span className={`hub-state ${s.enabled ? 'is-active' : ''}`}>
                {s.errorCode ? copy.blocked : s.enabled ? copy.active : copy.paused}
              </span>
              <div className="hub-row-actions">
                <Button variant="secondary" onClick={() => setSelected(s)}>
                  {copy.history}
                </Button>
                {definitions.some((d) => d.scope === s.scope && d.canCreate) ? (
                  <Button variant="secondary" disabled={busy} onClick={() => void toggle(s)}>
                    {s.enabled ? copy.pause : copy.resume}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="hub-hint">{copy.resumeHint}</p>
      {data ? <Pagination page={page} total={data.totalPages} onPage={setPage} /> : null}
      {selected ? (
        <RunHistory
          key={selected.id}
          token={token}
          schedule={selected}
          canCreate={definitions.some((d) => d.scope === selected.scope && d.canCreate)}
          close={() => setSelected(undefined)}
        />
      ) : null}
    </section>
  );
}
function RunHistory({
  schedule,
  token,
  canCreate,
  close,
}: {
  schedule: ReportSchedule;
  token: string;
  canCreate: boolean;
  close: () => void;
}) {
  const [data, setData] = useState<ReportRunPage>(),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setError(false);
    void api
      .runs(token, schedule.id, page)
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [token, schedule.id, page, reload]);
  useEffect(() => {
    const timer = setTimeout(() => setReload((n) => n + 1), 5000);
    return () => clearTimeout(timer);
  }, [reload]);
  async function action(output: LibraryExport, retry = false) {
    if (busy) return;
    setBusy(true);
    try {
      if (retry) {
        await api.retry(token, schedule.scope, output.id);
        setReload((n) => n + 1);
      } else await downloadLibraryExport(token, schedule.scope, output);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <HubDialog
      title={schedule.name}
      close={close}
      busy={busy}
      footer={
        <Button variant="secondary" onClick={close}>
          {copy.close}
        </Button>
      }
    >
      <div className="hub-run-heading">
        <h3>{copy.history}</h3>
        <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
          {copy.refresh}
        </Button>
      </div>
      {error ? <InlineAlert tone="error">{copy.actionError}</InlineAlert> : null}
      {!data ? (
        error ? null : (
          <p role="status">{copy.loading}</p>
        )
      ) : !data.items.length ? (
        <p>{copy.noRuns}</p>
      ) : (
        <ul className="hub-list">
          {data.items.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{dateTime(r.scheduledFor, schedule.timezone)}</strong>
                <small>
                  {copy.formats[r.export.format]} · {copy.statuses[r.export.status]}
                </small>
              </div>
              {r.export.status === 'completed' ? (
                <Button disabled={busy} variant="secondary" onClick={() => void action(r.export)}>
                  {copy.download}
                </Button>
              ) : r.export.status === 'failed' && canCreate ? (
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() => void action(r.export, true)}
                >
                  {copy.retry}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data ? <Pagination page={page} total={data.totalPages} onPage={setPage} /> : null}
    </HubDialog>
  );
}
function HubDialog({
  title,
  close,
  busy,
  children,
  footer,
}: {
  title: string;
  close: () => void;
  busy: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousGutter = root.style.scrollbarGutter;
    root.style.overflow = 'hidden';
    root.style.scrollbarGutter = 'auto';
    element?.showModal?.();
    return () => {
      element?.close?.();
      root.style.overflow = previousOverflow;
      root.style.scrollbarGutter = previousGutter;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="hub-dialog"
      aria-labelledby="hub-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2 id="hub-dialog-title">{title}</h2>
        <button type="button" aria-label={copy.close} disabled={busy} onClick={close}>
          <Icon name="close" />
        </button>
      </header>
      <div className="hub-dialog-body">{children}</div>
      <footer>{footer}</footer>
    </dialog>
  );
}
function Pagination({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (n: number) => void;
}) {
  return total > 1 ? (
    <nav className="hub-pagination" aria-label={copy.page(page, total)}>
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {copy.previous}
      </Button>
      <span>{copy.page(page, total)}</span>
      <Button variant="secondary" disabled={page >= total} onClick={() => onPage(page + 1)}>
        {copy.next}
      </Button>
    </nav>
  ) : null;
}
function ReportLink({ scope, children }: { scope: ReportingScope; children: ReactNode }) {
  if (scope !== 'pos')
    return (
      <Link className="hub-open" to={paths[scope]}>
        {children}
        <Icon name="arrow" size={15} />
      </Link>
    );
  const configured = import.meta.env['VITE_POS_APP_URL'] as string | undefined;
  const address =
    configured ||
    (import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:5174`
      : undefined);
  if (address) {
    try {
      const url = new URL(address);
      if (['http:', 'https:'].includes(url.protocol)) {
        url.pathname = '/reports';
        url.search = '';
        url.hash = '';
        return (
          <a className="hub-open" href={url.toString()}>
            {children}
            <Icon name="arrow" size={15} />
          </a>
        );
      }
    } catch {
      /* No link to an invalid deployment address. */
    }
  }
  return <span className="hub-hint">Open Reports in Vista POS.</span>;
}
function dateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
function localDateTime(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const get = (key: string) => parts.find((p) => p.type === key)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
