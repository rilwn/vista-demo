import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PosReportDefinition,
  PosReportFilters,
  ReportExportFormat,
  SavedPosReport,
} from '@vista/contracts';
import { listSavedPosReports, savePosReport } from './api/pos';
import { savedReportText as text } from './pos-saved-reports.messages';
import './pos-saved-reports.css';

export function PosSavedReports({
  token,
  definition,
  filters,
  columns,
  onColumns,
  onRestore,
  onExport,
  canCreate,
  exporting,
  onNotice,
}: {
  token: string;
  definition: PosReportDefinition;
  filters: PosReportFilters;
  columns: string[] | undefined;
  onColumns: (columns: string[] | undefined) => void;
  onRestore: (report: SavedPosReport) => void;
  onExport: (format: ReportExportFormat) => void;
  canCreate: boolean;
  exporting: boolean;
  onNotice: (notice: { kind: 'error' | 'success'; text: string }) => void;
}) {
  const [reports, setReports] = useState<SavedPosReport[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<ReportExportFormat>('xlsx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ body: string; id: string } | undefined>(undefined);
  const saving = useRef(false);
  const load = useCallback(async () => {
    const result = await listSavedPosReports(token, page);
    setReports(result.items);
    setPages(result.totalPages);
    setError('');
  }, [token, page]);
  useEffect(() => {
    void load().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : text.unavailable),
    );
  }, [load]);
  async function save() {
    if (saving.current || !canCreate || !name.trim() || columns?.length === 0) return;
    saving.current = true;
    setBusy(true);
    const configuration = {
      ...filters,
      definitionKey: definition.key,
      name: name.trim(),
      format,
      ...(columns ? { columns } : {}),
    };
    const body = JSON.stringify(configuration);
    if (request.current?.body !== body) request.current = { body, id: crypto.randomUUID() };
    try {
      const created = await savePosReport(token, { ...configuration, id: request.current.id });
      setReports((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      setPage(1);
      const saved = await listSavedPosReports(token).catch(() => undefined);
      if (saved) {
        setReports(saved.items);
        setPages(saved.totalPages);
      }
      onNotice({ kind: 'success', text: text.success });
    } catch (caught) {
      onNotice({
        kind: 'error',
        text: caught instanceof Error ? caught.message : text.unavailable,
      });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="pos-saved-reports">
      <summary>{text.title}</summary>
      <div className="pos-saved-report-body">
        <label>
          <span>{text.saved}</span>
          <select
            value=""
            disabled={busy || exporting}
            onChange={(event) => {
              const report = reports.find((item) => item.id === event.target.value);
              if (report) {
                onRestore(report);
                setName(report.name);
                setFormat(report.format);
              }
            }}
          >
            <option value="">{reports.length ? text.open : text.empty}</option>
            {reports.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <div role="alert">
            {error}
            <button
              type="button"
              onClick={() => void load().catch((caught: unknown) => setError(String(caught)))}
            >
              Try again
            </button>
          </div>
        ) : null}
        {pages > 1 ? (
          <div className="pos-saved-paging">
            <button disabled={page <= 1 || busy || exporting} onClick={() => setPage(page - 1)}>
              {text.previous}
            </button>
            <span>
              {page} / {pages}
            </span>
            <button disabled={page >= pages || busy || exporting} onClick={() => setPage(page + 1)}>
              {text.next}
            </button>
          </div>
        ) : null}
        <fieldset disabled={busy || exporting}>
          <legend>{text.fields}</legend>
          <div className="pos-saved-columns">
            {definition.columns?.map((column) => (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={!columns || columns.includes(column.key)}
                  onChange={(event) => {
                    const chosen = new Set(columns ?? definition.columns?.map((item) => item.key));
                    if (event.target.checked) chosen.add(column.key);
                    else chosen.delete(column.key);
                    onColumns(
                      definition.columns
                        ?.filter((item) => chosen.has(item.key))
                        .map((item) => item.key),
                    );
                  }}
                />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {columns?.length === 0 ? <small role="status">{text.invalid}</small> : null}
        <small>{text.hint}</small>
        {canCreate ? (
          <div className="pos-saved-actions">
            <label>
              <span>{text.name}</span>
              <input
                maxLength={100}
                value={name}
                disabled={busy || exporting}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <span>{text.format}</span>
              <select
                value={format}
                disabled={busy || exporting}
                onChange={(event) => setFormat(event.target.value as ReportExportFormat)}
              >
                {definition.formats.map((value) => (
                  <option key={value} value={value}>
                    {value === 'xlsx' ? 'Excel' : value.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || exporting || !name.trim() || columns?.length === 0}
              onClick={() => void save()}
            >
              {text.save}
            </button>
            <button
              className="pos-primary-button"
              disabled={busy || exporting || columns?.length === 0}
              onClick={() => onExport(format)}
            >
              {text.export}
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
