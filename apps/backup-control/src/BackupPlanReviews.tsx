import type { BackupPlanReview, BackupPlanReviewPage } from '@vista/contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { ApiClientError } from './api/client';
import { loadBackupPlanReviews, recordBackupPlanReview } from './api/backup';
import { bg } from './i18n/catalog';
import { useLocalization } from './i18n/LocalizationProvider';

export function BackupPlanReviews({
  canApprove,
  sessionToken,
}: {
  canApprove: boolean;
  sessionToken: string;
}) {
  const { locale } = useLocalization();
  const translate = (value: string) => (locale === 'bg' ? bg(value) : value);
  const [page, setPage] = useState<BackupPlanReviewPage>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [outcome, setOutcome] = useState<BackupPlanReview['outcome']>('approved');
  const [summary, setSummary] = useState('');
  const [correctiveActions, setCorrectiveActions] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    try {
      setPage(await loadBackupPlanReviews(sessionToken));
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The backup plan review could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [sessionToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await recordBackupPlanReview(
        sessionToken,
        {
          outcome,
          summary: summary.trim(),
          ...(outcome === 'changes_required'
            ? { correctiveActions: correctiveActions.trim() }
            : {}),
        },
        crypto.randomUUID(),
      );
      setNotice(
        'Backup plan review recorded. The signed record is now available in the review history.',
      );
      setOpen(false);
      setSummary('');
      setCorrectiveActions('');
      setOutcome('approved');
      await reload();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The backup plan review could not be recorded.',
      );
    } finally {
      setBusy(false);
    }
  }

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
      dateStyle: 'medium',
      timeZone: 'Europe/Sofia',
    }).format(new Date(value));
  const latest = page?.items[0];
  const snapshot = page?.currentPlanSnapshot;

  return (
    <section className="backup-records backup-plan-reviews" aria-live="polite">
      <div className="backup-record-toolbar">
        <div>
          <strong>{translate('Current backup plan')}</strong>
          <span>
            {snapshot?.protectedSources.length ?? 0} {translate('protected sources')} ·{' '}
            {snapshot?.policies.length ?? 0} {translate('backup policies')}
          </span>
        </div>
        <div className="backup-plan-review-toolbar-actions">
          <span
            className={`backup-plan-review-status ${page?.reviewRequired ? 'is-due' : 'is-current'}`}
          >
            {translate(page?.reviewRequired ? 'Review needed' : 'Review current')}
          </span>
          <button className="backup-record-edit" onClick={() => void reload()} type="button">
            {translate('Refresh')}
          </button>
          {canApprove && (
            <button
              className="backup-approval-approve"
              onClick={() => setOpen((value) => !value)}
              type="button"
            >
              {translate(open ? 'Close review' : 'Record review')}
            </button>
          )}
        </div>
      </div>
      <p className="backup-plan-review-explainer">
        {translate(
          'Review the listed sources and policies against the approved Information Backup Plan. Recording the review saves an immutable snapshot and your sign-off.',
        )}
      </p>
      {snapshot && (
        <div className="backup-plan-review-storage">
          <span>{translate('Storage target')}</span>
          <strong>{snapshot.storageTarget}</strong>
        </div>
      )}

      {error && (
        <p className="backup-inline-error" role="alert">
          {translate(error)}
        </p>
      )}
      {notice && (
        <p className="backup-inline-success" role="status">
          {translate(notice)}
        </p>
      )}
      {loading ? (
        <div className="backup-record-placeholder" role="status">
          {translate('Loading records')}
        </div>
      ) : (
        <>
          {page?.reviewRequired && (
            <div className="backup-plan-review-alert">
              <strong>{translate('A review is required')}</strong>
              <span>
                {translate(
                  !latest
                    ? 'No annual backup-plan review has been recorded.'
                    : latest.outcome === 'changes_required'
                      ? 'The last review requires follow-up actions.'
                      : latest.snapshotSha256 !== page.currentSnapshotSha256
                        ? 'The protected inventory or policies have changed since the last review.'
                        : 'The annual review date has arrived.',
                )}
              </span>
            </div>
          )}

          {canApprove && open && (
            <form className="backup-plan-review-form" onSubmit={(event) => void submit(event)}>
              <h2>{translate('Record annual review')}</h2>
              <p>
                {translate(
                  'Confirm that you reviewed the current list below and the approved backup plan. The saved record cannot be edited or removed.',
                )}
              </p>
              <label className="backup-form-field">
                <span>{translate('Review outcome')}</span>
                <select
                  onChange={(event) =>
                    setOutcome(event.target.value as BackupPlanReview['outcome'])
                  }
                  value={outcome}
                >
                  <option value="approved">{translate('Reviewed; plan is current')}</option>
                  <option value="changes_required">
                    {translate('Changes or actions are required')}
                  </option>
                </select>
              </label>
              <label className="backup-form-field">
                <span>{translate('Review summary')}</span>
                <textarea
                  maxLength={2000}
                  minLength={10}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder={translate('Summarise what was checked and the decision.')}
                  required
                  value={summary}
                />
              </label>
              {outcome === 'changes_required' && (
                <label className="backup-form-field">
                  <span>{translate('Corrective actions')}</span>
                  <textarea
                    maxLength={4000}
                    minLength={10}
                    onChange={(event) => setCorrectiveActions(event.target.value)}
                    placeholder={translate('List the action and responsible follow-up.')}
                    required
                    value={correctiveActions}
                  />
                </label>
              )}
              <div className="backup-plan-review-form-actions">
                <button className="backup-record-edit" onClick={() => setOpen(false)} type="button">
                  {translate('Cancel')}
                </button>
                <button className="backup-approval-approve" disabled={busy} type="submit">
                  {translate(busy ? 'Saving' : 'Save signed review')}
                </button>
              </div>
            </form>
          )}
          {!canApprove && page?.reviewRequired && (
            <p className="backup-security-note">
              {translate(
                'Your account can view reviews but cannot record the management sign-off.',
              )}
            </p>
          )}

          <details className="backup-plan-review-inventory" open>
            <summary>{translate('Protected sources and policies in this review')}</summary>
            <div className="backup-plan-review-tables">
              <section>
                <h2>{translate('Protected sources')}</h2>
                {snapshot?.protectedSources.length ? (
                  <ul>
                    {snapshot.protectedSources.map((source) => (
                      <li key={source.sourceCode}>
                        <span>
                          <strong>{source.name}</strong>
                          <small>
                            {source.sourceCode} · {translate(source.sourceType)} ·{' '}
                            {translate(source.classification)}
                          </small>
                          {(source.ownerName || source.stewardName) && (
                            <small>
                              {source.ownerName && `${translate('Owner')}: ${source.ownerName}`}
                              {source.ownerName && source.stewardName ? ' · ' : ''}
                              {source.stewardName &&
                                `${translate('Data steward')}: ${source.stewardName}`}
                            </small>
                          )}
                        </span>
                        <span>
                          <strong>{source.location}</strong>
                          <small>{translate(source.status)}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="backup-record-placeholder">
                    {translate('No protected sources are registered.')}
                  </p>
                )}
              </section>
              <section>
                <h2>{translate('Backup policies')}</h2>
                {snapshot?.policies.length ? (
                  <ul>
                    {snapshot.policies.map((policy) => (
                      <li key={policy.policyCode}>
                        <span>
                          <strong>{policy.policyCode}</strong>
                          <small>
                            {translate(policy.backupType)} · {translate(policy.frequency)} ·{' '}
                            {translate(policy.status)}
                          </small>
                        </span>
                        <span>
                          <strong>
                            RPO {policy.rpoMinutes}m · RTO {policy.rtoMinutes}m
                          </strong>
                          <small>
                            {policy.sourceCodes.length} {translate('sources covered')} ·{' '}
                            {translate('Retention')}: {policy.retentionDailyCopies}/
                            {policy.retentionMonthlyCopies}
                          </small>
                          <small>
                            {translate('Encryption required')}:{' '}
                            {translate(policy.encryptionRequired ? 'Yes' : 'No')} ·{' '}
                            {translate('Verification required')}:{' '}
                            {translate(policy.verificationRequired ? 'Yes' : 'No')}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="backup-record-placeholder">
                    {translate('No backup policies are registered.')}
                  </p>
                )}
              </section>
            </div>
          </details>

          <section className="backup-plan-review-history">
            <h2>{translate('Review history')}</h2>
            {page?.items.length ? (
              <div className="backup-record-grid">
                {page.items.map((review) => (
                  <article className="backup-record-card" key={review.id}>
                    <div className="backup-record-card-heading">
                      <span className="backup-record-type">{review.reviewCode}</span>
                      <span
                        className={`backup-policy-state ${review.outcome === 'approved' ? 'backup-policy-state--approved' : 'backup-policy-state--pending'}`}
                      >
                        {translate(
                          review.outcome === 'approved' ? 'Plan approved' : 'Actions required',
                        )}
                      </span>
                    </div>
                    <strong>
                      {translate('Reviewed by')} {review.reviewedByName}
                    </strong>
                    <small>
                      {date(review.reviewedAt)} · {translate('Next review due')}{' '}
                      {date(review.nextReviewDueAt)}
                    </small>
                    <p className="backup-approval-justification">{review.summary}</p>
                    {review.correctiveActions && (
                      <p className="backup-plan-review-actions">
                        <strong>{translate('Corrective actions')}:</strong>{' '}
                        {review.correctiveActions}
                      </p>
                    )}
                    <small>
                      {review.protectedSourceCount} {translate('protected sources')} ·{' '}
                      {review.policyCount} {translate('backup policies')}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <div className="backup-record-placeholder">
                <h3>{translate('No backup plan review recorded')}</h3>
                <p>
                  {translate(
                    'Review the current inventory and record the first management sign-off.',
                  )}
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
