import { Button, InlineAlert } from '@vista/ui';
import type { BackgroundJobTelemetry } from '@vista/contracts';
import { useEffect, useState } from 'react';
import { apiV1BaseUrl, authorizationHeaders } from '../api/client';
import { jobMonitorMessages as copy } from '../messages';
import './job-monitor.css';

export function JobMonitor({ token }: { token: string }) {
  const [data, setData] = useState<BackgroundJobTelemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let active = true;
    setLoading(true);
    setFailed(false);
    setData(null);
    void fetch(`${apiV1BaseUrl}/platform/jobs/metrics`, {
      headers: authorizationHeaders(token),
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw Error('Unavailable');
        return (await response.json()) as BackgroundJobTelemetry;
      })
      .then((value) => {
        if (
          !['waiting', 'active', 'delayed', 'completed', 'failed'].every(
            (key) =>
              Number.isSafeInteger(value[key as keyof BackgroundJobTelemetry]) &&
              Number(value[key as keyof BackgroundJobTelemetry]) >= 0,
          ) ||
          typeof value.paused !== 'boolean' ||
          !Number.isFinite(Date.parse(value.timestamp))
        )
          throw Error('Invalid response');
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [token, revision]);
  return (
    <section
      className="content-panel job-monitor"
      aria-labelledby="job-monitor-title"
      aria-busy={loading}
    >
      <header>
        <div>
          <h2 id="job-monitor-title">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <Button
          disabled={loading}
          variant="secondary"
          onClick={() => setRevision((value) => value + 1)}
        >
          {copy.refresh}
        </Button>
      </header>
      {loading ? (
        <p role="status">{copy.loading}</p>
      ) : failed ? (
        <InlineAlert tone="error">{copy.unavailable}</InlineAlert>
      ) : data ? (
        <>
          <p className="job-monitor-status">
            {data.paused ? copy.paused : copy.accepting}
            <span>
              {copy.updated} {new Date(data.timestamp).toLocaleString()}
            </span>
          </p>
          {data.failed > 0 ? <InlineAlert tone="warning">{copy.failureHint}</InlineAlert> : null}
          <dl>
            {(['waiting', 'active', 'delayed', 'completed', 'failed'] as const).map((state) => (
              <div key={state}>
                <dt>{copy.states[state]}</dt>
                <dd>{data[state].toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <small>{copy.retained}</small>
        </>
      ) : null}
    </section>
  );
}
