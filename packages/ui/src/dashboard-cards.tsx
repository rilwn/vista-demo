import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  dashboardCardKeys,
  type ReportDashboardScope,
  type ReportDashboardPreferences,
} from '@vista/contracts';
import { Button } from './index.js';
const copy = {
  customize: 'Customize cards',
  save: 'Save layout',
  show: 'Show all',
  saved: 'Your layout is saved.',
  error: 'Your layout could not be loaded. Try again.',
  saveError: 'Your layout could not be saved. Reload it before trying again.',
  retry: 'Reload layout',
  loading: 'Loading preferences…',
  hint: 'Choose the cards to show. This changes only your account.',
  empty: 'All summary cards are hidden. Open Customize cards to show them.',
};
export function DashboardCards(props: {
  scope: ReportDashboardScope;
  token: string;
  apiBaseUrl: string;
  labels: string[];
  className: string;
  children: ReactNode;
}) {
  return <DashboardCardsContent key={`${props.scope}:${props.token}`} {...props} />;
}
function DashboardCardsContent({
  scope,
  token,
  apiBaseUrl,
  labels,
  className,
  children,
}: Parameters<typeof DashboardCards>[0]) {
  const [stored, setStored] = useState<ReportDashboardPreferences>({ hiddenCards: [], version: 0 });
  const [draft, setDraft] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reload, setReload] = useState(0);
  const pending = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.resolve()
      .then(() =>
        fetch(`${apiBaseUrl}/reporting/dashboards/${scope}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      )
      .then(async (r) => {
        if (!r.ok) throw Error();
        const value = (await r.json()) as ReportDashboardPreferences;
        if (!Array.isArray(value.hiddenCards) || !Number.isInteger(value.version)) throw Error();
        if (live) {
          setStored(value);
          setDraft(value.hiddenCards);
          setError('');
        }
      })
      .catch(() => {
        if (live) setError(copy.error);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [scope, token, apiBaseUrl, reload]);
  async function save() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    try {
      const r = await fetch(`${apiBaseUrl}/reporting/dashboards/${scope}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hiddenCards: draft, version: stored.version }),
      });
      if (!r.ok) throw Error();
      const value = (await r.json()) as ReportDashboardPreferences;
      if (!Array.isArray(value.hiddenCards) || !Number.isInteger(value.version)) throw Error();
      if (active.current) {
        setStored(value);
        setNotice(copy.saved);
        setError('');
      }
    } catch {
      if (active.current) setError(copy.saveError);
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  const keys = dashboardCardKeys[scope],
    cards = Children.toArray(children);
  return (
    <div className="vista-dashboard-cards">
      <details>
        <summary>{copy.customize}</summary>
        <div className="vista-dashboard-options">
          <p>{copy.hint}</p>
          {loading ? <p role="status">{copy.loading}</p> : null}
          <fieldset disabled={loading || busy || Boolean(error)}>
            {keys.map((key, index) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={!draft.includes(key)}
                  onChange={(e) => {
                    setNotice('');
                    setDraft(e.target.checked ? draft.filter((k) => k !== key) : [...draft, key]);
                  }}
                />
                <span>{labels[index]}</span>
              </label>
            ))}
          </fieldset>
          <div className="vista-dashboard-actions">
            <Button disabled={loading || Boolean(error)} busy={busy} onClick={() => void save()}>
              {copy.save}
            </Button>
            <Button
              variant="secondary"
              disabled={loading || busy || Boolean(error)}
              onClick={() => setDraft([])}
            >
              {copy.show}
            </Button>
          </div>
          {error ? (
            <p role="alert">
              {error}{' '}
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => setReload((n) => n + 1)}
              >
                {copy.retry}
              </button>
            </p>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
        </div>
      </details>
      <div className={className}>
        {cards.filter((_c, i) => !stored.hiddenCards.includes(keys[i] ?? ''))}
      </div>
      {keys.every((k) => stored.hiddenCards.includes(k)) ? (
        <p className="vista-dashboard-empty">{copy.empty}</p>
      ) : null}
    </div>
  );
}
