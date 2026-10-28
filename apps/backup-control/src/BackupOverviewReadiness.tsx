import type { BackupDrTest } from '@vista/contracts';
import { useEffect, useState } from 'react';

import { ApiClientError } from './api/client';
import { loadBackupDrTests, loadBackupPolicies, loadBackupSources } from './api/backup';
import { bg } from './i18n/catalog';
import { useLocalization } from './i18n/LocalizationProvider';

type Readiness = {
  latestTest?: BackupDrTest;
  policyCount: number;
  sourceCount: number;
};

export function BackupOverviewReadiness({ sessionToken }: { sessionToken: string }) {
  const { locale } = useLocalization();
  const translate = (value: string) => (locale === 'bg' ? bg(value) : value);
  const [readiness, setReadiness] = useState<Readiness>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void Promise.all([
      loadBackupSources(sessionToken),
      loadBackupPolicies(sessionToken),
      loadBackupDrTests(sessionToken),
    ])
      .then(([sources, policies, tests]) => {
        if (cancelled) return;
        const latestTest = tests.items
          .filter((test) => test.status === 'recorded')
          .sort((left, right) =>
            (right.completedAt ?? '').localeCompare(left.completedAt ?? ''),
          )[0];
        setReadiness({
          ...(latestTest ? { latestTest } : {}),
          policyCount: policies.total,
          sourceCount: sources.total,
        });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(
          caught instanceof ApiClientError
            ? caught.message
            : 'Backup readiness could not be loaded.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  const latestTest = readiness?.latestTest;
  return (
    <section aria-label={translate('Backup readiness')} className="backup-readiness-strip">
      <article>
        <span>{translate('Source inventory')}</span>
        <strong>
          {loading
            ? translate('Loading records')
            : error
              ? translate('Status unavailable')
              : readiness?.sourceCount
                ? `${readiness.sourceCount} ${translate(
                    readiness.sourceCount === 1 ? 'protected source' : 'protected sources',
                  )}`
                : translate('No protected sources registered')}
        </strong>
        <small>{translate('Protected systems and devices')}</small>
      </article>
      <article>
        <span>{translate('Backup policy')}</span>
        <strong>
          {loading
            ? translate('Loading records')
            : error
              ? translate('Status unavailable')
              : readiness?.policyCount
                ? `${readiness.policyCount} ${translate(
                    readiness.policyCount === 1 ? 'policy' : 'policies',
                  )}`
                : translate('No backup policies configured')}
        </strong>
        <small>{translate('Schedules, retention, RPO, and RTO')}</small>
      </article>
      <article>
        <span>{translate('Restore test')}</span>
        <strong>
          {loading
            ? translate('Loading records')
            : error
              ? translate('Status unavailable')
              : latestTest
                ? `${translate(latestTest.outcome === 'passed' ? 'Passed' : 'Failed')} · ${formatDate(latestTest.completedAt ?? '', locale)}`
                : translate('No signed restore test recorded')}
        </strong>
        <small>
          {error
            ? translate(error)
            : latestTest
              ? `${translate('Measured RPO')} ${latestTest.actualRpoMinutes ?? 0} ${translate('minutes')} · ${translate('Measured RTO')} ${latestTest.actualRtoMinutes ?? 0} ${translate('minutes')}`
              : translate(
                  'Record the measured recovery time and signed protocol after a restore test',
                )}
        </small>
      </article>
    </section>
  );
}

function formatDate(value: string, locale: 'en' | 'bg'): string {
  return value
    ? new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
        dateStyle: 'medium',
        timeZone: 'Europe/Sofia',
      }).format(new Date(value))
    : '—';
}
