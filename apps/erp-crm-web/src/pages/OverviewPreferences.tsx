import { useEffect, useRef, useState } from 'react';
import {
  overviewMetricKeys,
  type OperationsOverview,
  type OverviewMetricKey,
  type OverviewPreferences as Preferences,
} from '@vista/contracts';
import { Button, InlineAlert } from '@vista/ui';
import { saveOverviewPreferences } from '../api/report-workspace';
import { ApiClientError } from '../api/client';
import { overviewMessages as copy } from './operations-overview.messages';

export function OverviewPreferences({
  token,
  data,
  onSaved,
}: {
  token: string;
  data: OperationsOverview;
  onSaved: (preferences: Preferences) => void;
}) {
  const saved = data.preferences ?? { hiddenCards: [], version: 0 };
  const [hidden, setHidden] = useState<OverviewMetricKey[]>(saved.hiddenCards);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const labels = {
    recordedRevenueBgn: copy.revenue,
    activeServiceRequests: copy.service,
    expiringWarranties: copy.warranties,
    overdueReceivablesBgn: copy.overdue,
  };
  async function save() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setSuccess(false);
    try {
      const result = await saveOverviewPreferences(token, {
        hiddenCards: hidden,
        version: saved.version,
      });
      if (mounted.current) {
        onSaved(result);
        setSuccess(true);
      }
    } catch (error) {
      setError(
        error instanceof ApiClientError && error.status === 409
          ? copy.preferencesConflict
          : copy.preferencesError,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="overview-preferences">
      <summary>{copy.customize}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <legend>{copy.chooseCards}</legend>
          <div className="overview-card-options">
            {overviewMetricKeys
              .filter((key) => data[key] !== undefined)
              .map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(key)}
                    onChange={(event) => {
                      setSuccess(false);
                      setHidden(
                        event.target.checked
                          ? hidden.filter((value) => value !== key)
                          : [...hidden, key],
                      );
                    }}
                  />
                  <span>{labels[key]}</span>
                </label>
              ))}
          </div>
        </fieldset>
        <div className="overview-preference-actions">
          <Button type="submit" busy={busy} busyLabel={copy.saving}>
            {copy.saveCards}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setHidden([]);
              setSuccess(false);
            }}
          >
            {copy.showAll}
          </Button>
          <small>{copy.preferencesHint}</small>
        </div>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {success ? <p role="status">{copy.preferencesSaved}</p> : null}
      </form>
    </details>
  );
}
