import { useEffect, useRef, useState } from 'react';
import type {
  ErpReportDefinition,
  ErpReportRequest,
  ErpReportScope,
  SavedErpReport,
  ErpReportPreview,
  ReportExportFormat,
} from '@vista/contracts';
import { Button, InlineAlert } from '@vista/ui';
import { useActiveItemVisibility } from '@vista/ui/navigation';
import { useAuth } from '../auth/AuthProvider';
import { Link } from '../routing/Router';
import { Icon } from '../components/Icon';
import { erpReportsApi as api, downloadErpReport } from '../api/erp-reports';
import { erpReportMessages as copy } from './erp-report.messages';
import { pagesForModule, workflowPath } from './workflow-pages';
import {
  defaultReportColumns,
  isReportUuid,
  reportDate,
  reportDecimal,
} from './erp-report-display';
import './erp-reports.css';

export function ErpReportsPage({ scope }: { scope: ErpReportScope }) {
  const { session, hasPermission } = useAuth();
  return (
    <ReportsWorkspace
      key={`${scope}:${session?.sessionToken ?? ''}`}
      token={session?.sessionToken ?? ''}
      scope={scope}
      canCreate={hasPermission(`erp.${scope}`, 'create')}
    />
  );
}
export function ReportsWorkspace({
  scope,
  token,
  canCreate,
}: {
  scope: ErpReportScope;
  token: string;
  canCreate: boolean;
}) {
  const tabList = useActiveItemVisibility<HTMLElement>(scope);
  const [definitions, setDefinitions] = useState<ErpReportDefinition[]>([]);
  const [definition, setDefinition] = useState<ErpReportDefinition>();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [draft, setDraft] = useState({
    dateFrom: today.slice(0, 4) + '-01-01',
    dateTo: today,
    search: '',
  });
  const [applied, setApplied] = useState<Omit<ErpReportRequest, 'format' | 'columns'>>();
  const [columns, setColumns] = useState<string[]>([]);
  const [format, setFormat] = useState<ReportExportFormat>('xlsx');
  const [name, setName] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ErpReportPreview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [definitionsReload, setDefinitionsReload] = useState(0);
  const initialDates = useRef(draft);
  const [savedPage, setSavedPage] = useState(1);
  const [selectedSavedId, setSelectedSavedId] = useState('');
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof api.saved>>>();
  const [savedError, setSavedError] = useState(false);
  const [savedReload, setSavedReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const mounted = useRef(true);
  const saveKey = useRef<{ body: string; id: string } | undefined>(undefined);
  const exportKey = useRef<{ body: string; id: string } | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState(false);
  const [exportReload, setExportReload] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void api
      .definitions(token, scope)
      .then((result) => {
        if (!active) return;
        setDefinitions(result);
        const first = result[0];
        if (first) {
          setDefinition(first);
          setColumns(defaultReportColumns(first));
          setApplied({
            definitionKey: first.key,
            ...(first.requiresDateRange
              ? { dateFrom: initialDates.current.dateFrom, dateTo: initialDates.current.dateTo }
              : {}),
          });
        } else setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [token, scope, definitionsReload]);
  useEffect(() => {
    if (!applied) return;
    let active = true;
    setLoading(true);
    setError(false);
    setData(undefined);
    void api
      .preview(token, scope, applied, page)
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
  }, [token, scope, applied, page, reload]);
  useEffect(() => {
    let active = true;
    setSavedError(false);
    void api
      .saved(token, scope, savedPage)
      .then((result) => {
        if (active) setSaved(result);
      })
      .catch(() => {
        if (active) setSavedError(true);
      });
    return () => {
      active = false;
    };
  }, [token, scope, savedPage, savedReload]);
  const valid =
    !definition?.requiresDateRange ||
    Boolean(draft.dateFrom && draft.dateTo && draft.dateFrom <= draft.dateTo);
  function selectReport(key: string) {
    const next = definitions.find((d) => d.key === key);
    if (!next) return;
    setDefinition(next);
    setSelectedSavedId('');
    setName('');
    setColumns(defaultReportColumns(next));
    setPage(1);
    setNotice('');
    setActionError(false);
    setApplied({
      definitionKey: next.key,
      ...(next.requiresDateRange ? { dateFrom: draft.dateFrom, dateTo: draft.dateTo } : {}),
      ...(draft.search.trim() ? { search: draft.search.trim() } : {}),
    });
  }
  function restore(report: SavedErpReport) {
    const next = definitions.find((d) => d.key === report.definitionKey);
    if (!next) return;
    setDefinition(next);
    setSelectedSavedId(report.id);
    setDraft({
      dateFrom: report.dateFrom ?? draft.dateFrom,
      dateTo: report.dateTo ?? draft.dateTo,
      search: report.search ?? '',
    });
    setColumns(report.columns ?? next.columns?.map((c) => c.key) ?? []);
    setFormat(report.format);
    setName(report.name);
    setPage(1);
    setNotice('');
    setActionError(false);
    setApplied({
      definitionKey: report.definitionKey,
      ...(report.dateFrom ? { dateFrom: report.dateFrom } : {}),
      ...(report.dateTo ? { dateTo: report.dateTo } : {}),
      ...(report.search ? { search: report.search } : {}),
    });
  }
  async function command(kind: 'save' | 'export') {
    if (!applied || !columns.length || guard.current || !canCreate) return;
    guard.current = true;
    setBusy(true);
    setActionError(false);
    setNotice('');
    const input = { ...applied, columns, format };
    const body = JSON.stringify(kind === 'save' ? { ...input, name: name.trim() } : input);
    const ref = kind === 'save' ? saveKey : exportKey;
    if (ref.current?.body !== body) ref.current = { body, id: crypto.randomUUID() };
    try {
      if (kind === 'save')
        await api.save(token, scope, { ...input, name: name.trim(), id: ref.current.id });
      else await api.create(token, scope, input, ref.current.id);
      if (!mounted.current) return;
      if (kind === 'save') {
        setSelectedSavedId(ref.current.id);
        setSavedPage(1);
        setSavedReload((n) => n + 1);
      } else setExportReload((n) => n + 1);
      setNotice(kind === 'save' ? copy.savedOk : copy.exportOk);
      // A confirmed export can be requested again later; failures retain the original key.
      if (kind === 'export') exportKey.current = undefined;
    } catch {
      if (mounted.current) setActionError(true);
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="page-stack erp-reports">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">{copy.scopes[scope]}</p>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
      </header>
      <nav className="workflow-tabs" aria-label={copy.scopes[scope]} ref={tabList}>
        {[...pagesForModule(`erp.${scope}`)]
          .sort((a, b) => {
            if (scope === 'procurement') {
              const order = [
                'purchase-orders',
                'goods-receipts',
                'suppliers',
                'supplier-invoices',
                'supplier-claims',
                'reports',
              ];
              return order.indexOf(a.slug) - order.indexOf(b.slug);
            }
            return Number(a.slug === 'reports') - Number(b.slug === 'reports');
          })
          .map((item) => (
            <Link
              key={item.slug}
              to={workflowPath(item)}
              aria-current={item.slug === 'reports' ? 'page' : undefined}
              className={item.slug === 'reports' ? 'is-active' : ''}
            >
              {item.title}
            </Link>
          ))}
      </nav>
      <section className="content-panel erp-report-workspace" aria-label={copy.report}>
        <section className="erp-report-controls">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!definition || !valid) return;
              setPage(1);
              setApplied({
                definitionKey: definition.key,
                ...(definition.requiresDateRange
                  ? { dateFrom: draft.dateFrom, dateTo: draft.dateTo }
                  : {}),
                ...(draft.search.trim() ? { search: draft.search.trim() } : {}),
              });
              setReload((n) => n + 1);
            }}
          >
            <div className="erp-report-filter">
              <label htmlFor="erp-report-definition">{copy.report}</label>
              <select
                id="erp-report-definition"
                value={definition?.key ?? ''}
                onChange={(e) => selectReport(e.target.value)}
                disabled={busy || !definitions.length}
              >
                {definitions.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            {definition?.requiresDateRange ? (
              <>
                <div className="erp-report-filter">
                  <label htmlFor="erp-report-from">{copy.from}</label>
                  <input
                    id="erp-report-from"
                    type="date"
                    value={draft.dateFrom}
                    required
                    disabled={busy}
                    onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })}
                  />
                </div>
                <div className="erp-report-filter">
                  <label htmlFor="erp-report-to">{copy.to}</label>
                  <input
                    id="erp-report-to"
                    type="date"
                    min={draft.dateFrom}
                    value={draft.dateTo}
                    required
                    disabled={busy}
                    onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })}
                  />
                </div>
              </>
            ) : null}
            <div className="erp-report-filter">
              <label htmlFor="erp-report-search">{copy.search}</label>
              <input
                id="erp-report-search"
                maxLength={120}
                value={draft.search}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, search: e.target.value })}
              />
            </div>
            <Button
              type="submit"
              busy={loading}
              busyLabel={copy.updating}
              disabled={!valid || busy || !definition}
            >
              {copy.apply}
            </Button>
          </form>
          {!valid ? <p role="alert">{copy.dateError}</p> : null}
        </section>
        {definition ? (
          <details className="erp-report-options">
            <summary>
              <Icon name="menu" size={15} />
              {copy.options}
              <span>{copy.columns(columns.length)}</span>
              <Icon name="chevron" size={15} />
            </summary>
            <div className="erp-report-options-body">
              <div className="erp-report-filter">
                <label htmlFor="erp-report-saved">{copy.saved}</label>
                <select
                  id="erp-report-saved"
                  value={saved?.items.some((r) => r.id === selectedSavedId) ? selectedSavedId : ''}
                  disabled={busy}
                  onChange={(e) => {
                    const report = saved?.items.find((r) => r.id === e.target.value);
                    if (report) restore(report);
                  }}
                >
                  <option value="">{copy.chooseSaved}</option>
                  {saved?.items.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              {savedError ? (
                <InlineAlert tone="error">
                  {copy.savedError}
                  <Button variant="secondary" onClick={() => setSavedReload((n) => n + 1)}>
                    {copy.retry}
                  </Button>
                </InlineAlert>
              ) : null}
              {(saved?.totalPages ?? 0) > 1 ? (
                <div className="erp-report-actions">
                  <Button
                    variant="secondary"
                    disabled={savedPage <= 1 || busy}
                    onClick={() => setSavedPage((n) => n - 1)}
                  >
                    {copy.savedPrevious}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={savedPage >= (saved?.totalPages ?? 1) || busy}
                    onClick={() => setSavedPage((n) => n + 1)}
                  >
                    {copy.savedNext}
                  </Button>
                </div>
              ) : null}
              <fieldset disabled={busy}>
                <legend>{copy.fields}</legend>
                <div className="erp-report-fields">
                  {definition.columns?.map((c) => (
                    <label key={c.key}>
                      <input
                        type="checkbox"
                        checked={columns.includes(c.key)}
                        onChange={(e) =>
                          setColumns(
                            e.target.checked
                              ? [...columns, c.key]
                              : columns.filter((k) => k !== c.key),
                          )
                        }
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {canCreate ? (
                <>
                  <div className="erp-report-options-row">
                    <div className="erp-report-filter">
                      <label htmlFor="erp-report-name">{copy.name}</label>
                      <input
                        id="erp-report-name"
                        value={name}
                        maxLength={100}
                        disabled={busy}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <Button
                      disabled={busy || loading || !columns.length || !name.trim()}
                      onClick={() => void command('save')}
                    >
                      {copy.save}
                    </Button>
                  </div>
                  <small>{copy.hint}</small>
                </>
              ) : null}
            </div>
          </details>
        ) : null}
        <div className="erp-report-result-heading">
          <div>
            <h2>{data ? copy.count(data.total) : copy.report}</h2>
            {applied ? (
              <p>
                {applied.dateFrom && applied.dateTo
                  ? `${reportDate(applied.dateFrom)} · ${reportDate(applied.dateTo)}`
                  : copy.current}
                {applied.search ? ` · “${applied.search}”` : ''}
              </p>
            ) : null}
          </div>
          {canCreate && definition ? (
            <div className="erp-report-export-actions">
              <div className="erp-report-filter">
                <label className="erp-report-sr-only" htmlFor="erp-report-format">
                  {copy.format}
                </label>
                <select
                  id="erp-report-format"
                  value={format}
                  disabled={busy}
                  onChange={(e) => setFormat(e.target.value as ReportExportFormat)}
                >
                  {(['xlsx', 'csv', 'pdf'] as const).map((f) => (
                    <option key={f} value={f}>
                      {copy.formats[f]}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                disabled={busy || loading || !columns.length}
                onClick={() => void command('export')}
              >
                {copy.export}
              </Button>
            </div>
          ) : null}
        </div>
        {notice ? (
          <p className="erp-report-notice" role="status">
            {notice}
          </p>
        ) : null}
        {definition && !columns.length ? (
          <p className="erp-report-notice" role="alert">
            {copy.fieldError}
          </p>
        ) : null}
        {actionError ? <InlineAlert tone="error">{copy.actionError}</InlineAlert> : null}
        {loading ? (
          <p className="erp-report-empty" role="status">
            {copy.loading}
          </p>
        ) : error ? (
          <InlineAlert tone="error">
            {copy.error}
            <Button
              variant="secondary"
              onClick={() =>
                definition ? setReload((n) => n + 1) : setDefinitionsReload((n) => n + 1)
              }
            >
              {copy.retry}
            </Button>
          </InlineAlert>
        ) : data ? (
          <div className="erp-report-results">
            {!data.rows.length ? (
              <div className="erp-report-empty">
                <Icon name="search" size={24} />
                <strong>{copy.empty}</strong>
                <span>{copy.emptyHint}</span>
              </div>
            ) : columns.length ? (
              <div
                className="erp-report-table-scroll"
                tabIndex={0}
                role="region"
                aria-label={definition?.name}
              >
                <table>
                  <thead>
                    <tr>
                      {columns.map((key) => (
                        <th
                          scope="col"
                          data-type={data.columns.find((c) => c.key === key)?.type}
                          key={key}
                        >
                          {data.columns.find((c) => c.key === key)?.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, i) => (
                      <tr key={i}>
                        {columns.map((key) => (
                          <td key={key} data-type={data.columns.find((c) => c.key === key)?.type}>
                            <ReportCell
                              key={`${key}:${row[key]}`}
                              value={String(row[key] ?? '')}
                              column={data.columns.find((c) => c.key === key)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {data.totalPages > 1 ? (
              <div className="erp-report-actions erp-report-pagination">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  {copy.previous}
                </Button>
                <span>{copy.page(page, data.totalPages)}</span>
                <Button
                  variant="secondary"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((n) => n + 1)}
                >
                  {copy.next}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {definition ? (
          <details className="erp-report-about">
            <summary>{copy.reportDetails}</summary>
            <p>{definition.description}</p>
          </details>
        ) : null}
      </section>
      <RecentErpExports token={token} scope={scope} canCreate={canCreate} refresh={exportReload} />
    </div>
  );
}
function ReportCell({
  value,
  column,
}: {
  value: string;
  column: ErpReportPreview['columns'][number] | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  if (!value)
    return (
      <span className="erp-report-missing" aria-label={copy.missing}>
        ·
      </span>
    );
  if (isReportUuid(value))
    return (
      <div className="erp-report-reference">
        <button
          type="button"
          title={value}
          aria-label={copy.copyReference(column?.label ?? copy.reference)}
          onClick={() => {
            setFailed(false);
            void Promise.resolve()
              .then(() => navigator.clipboard.writeText(value))
              .then(() => setCopied(true))
              .catch(() => setFailed(true));
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={15} />
          <span>{copy.reference}</span>
        </button>
        {copied ? <span role="status">{copy.copied}</span> : null}
        {failed ? (
          <span role="alert">
            {copy.copyFailed}
            <code>{value}</code>
          </span>
        ) : null}
      </div>
    );
  if (column?.type === 'date') return <time dateTime={value}>{reportDate(value)}</time>;
  if (column?.type === 'number' || column?.type === 'money')
    return (
      <span className="erp-report-number">
        {reportDecimal(
          value,
          column.type === 'money' || ['price', 'total', 'cost', 'value'].includes(column.key),
        )}
      </span>
    );
  if (column?.key === 'status')
    return <span className="erp-report-status">{value.replaceAll('_', ' ')}</span>;
  return <span className="erp-report-text">{value}</span>;
}
function RecentErpExports({
  token,
  scope,
  canCreate,
  refresh,
}: {
  token: string;
  scope: ErpReportScope;
  canCreate: boolean;
  refresh: number;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.exports>>>();
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPage(1), [refresh]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void api
      .exports(token, scope, page)
      .then((d) => {
        if (active) setData(d);
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
  }, [token, scope, page, reload, refresh]);
  useEffect(() => {
    if (!data?.items.some((r) => r.status === 'queued' || r.status === 'processing')) return;
    const timer = window.setTimeout(() => setReload((n) => n + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [data, reload]);
  async function action(id: string, download: boolean) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const item = data?.items.find((r) => r.id === id);
      if (!item) return;
      if (download) {
        const blob = await downloadErpReport(token, scope, item);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.fileName ?? 'report';
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        await api.retry(token, scope, id);
        setReload((n) => n + 1);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-panel erp-report-recent">
      <div className="erp-report-result-heading">
        <div>
          <h2>{copy.recent}</h2>
          <p>{copy.owner}</p>
        </div>
        <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
          {copy.refresh}
        </Button>
      </div>
      {error ? <InlineAlert tone="error">{copy.exportsError}</InlineAlert> : null}
      {loading && !data ? (
        <p role="status">{copy.loading}</p>
      ) : !data?.items.length ? (
        error ? null : (
          <p>{copy.noExports}</p>
        )
      ) : (
        <ul>
          {data.items.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <small>
                  {copy.formats[r.format]} ·{' '}
                  {new Date(r.createdAt).toLocaleString('en-GB', { timeZone: 'Europe/Sofia' })}
                </small>
              </div>
              <span className={`erp-report-status is-${r.status}`}>{copy.statuses[r.status]}</span>
              {r.status === 'completed' ? (
                <Button variant="secondary" disabled={busy} onClick={() => void action(r.id, true)}>
                  {copy.download}
                </Button>
              ) : r.status === 'failed' && canCreate ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void action(r.id, false)}
                >
                  {copy.retry}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {(data?.totalPages ?? 0) > 1 ? (
        <div className="erp-report-actions">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>
            {copy.previous}
          </Button>
          <span>{copy.page(page, data?.totalPages ?? 0)}</span>
          <Button
            variant="secondary"
            disabled={page >= (data?.totalPages ?? 1)}
            onClick={() => setPage((n) => n + 1)}
          >
            {copy.next}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
