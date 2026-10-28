import type { BackupArtifactDeletionRequest, BackupPolicyApprovalRequest } from '@vista/contracts';
import { useEffect, useState } from 'react';

import { ApiClientError } from './api/client';
import {
  decideBackupArtifactDeletion,
  decideBackupPolicyApproval,
  loadBackupArtifactDeletionRequests,
  loadBackupPolicyApprovals,
} from './api/backup';
import { bg } from './i18n/catalog';
import { useLocalization } from './i18n/LocalizationProvider';

export function BackupApprovals({
  canApprove,
  currentAccountId,
  sessionToken,
}: {
  canApprove: boolean;
  currentAccountId: string;
  sessionToken: string;
}) {
  const { locale } = useLocalization();
  const translate = (value: string) => (locale === 'bg' ? bg(value) : value);
  const [requests, setRequests] = useState<BackupPolicyApprovalRequest[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<BackupArtifactDeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const [page, deletionPage] = await Promise.all([
        loadBackupPolicyApprovals(sessionToken),
        loadBackupArtifactDeletionRequests(sessionToken),
      ]);
      setRequests(page.items);
      setDeletionRequests(deletionPage.items);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The approval requests could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function decideDeletion(
    request: BackupArtifactDeletionRequest,
    decision: 'approve' | 'reject',
  ) {
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      await decideBackupArtifactDeletion(
        sessionToken,
        request.id,
        { decision },
        crypto.randomUUID(),
      );
      setNotice(
        decision === 'approve'
          ? 'Restore-point removal approved. The backup worker will remove the copy and retain its audit history.'
          : 'Restore-point removal declined. The copy remains available.',
      );
      await reload();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The restore-point removal decision could not be saved.',
      );
    } finally {
      setBusyId('');
    }
  }

  useEffect(() => {
    void reload();
  }, [sessionToken]);

  async function decide(request: BackupPolicyApprovalRequest, decision: 'approve' | 'reject') {
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      await decideBackupPolicyApproval(sessionToken, request.id, { decision }, crypto.randomUUID());
      setNotice(
        request.action === 'disable_job'
          ? decision === 'approve'
            ? 'The backup schedule was paused. New scheduled runs will not start.'
            : 'The pause request was declined. The backup schedule remains active.'
          : request.action === 'reduce_retention'
            ? decision === 'approve'
              ? 'Lower retention approved. Eligible older copies may be removed during the next retention run; run history remains.'
              : 'Retention reduction declined. Current limits and stored copies remain unchanged.'
            : decision === 'approve'
              ? 'Policy approved. Activate the schedule in Policies & schedules before it runs.'
              : 'Policy declined and returned to draft.',
      );
      await reload();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The approval decision could not be saved.',
      );
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="backup-records backup-approvals" aria-live="polite">
      <div className="backup-record-toolbar">
        <div>
          <strong>{translate('Approval requests')}</strong>
          <span>
            {requests.length + deletionRequests.length} {translate('awaiting review')}
          </span>
        </div>
        <button className="backup-record-edit" onClick={() => void reload()} type="button">
          {translate('Refresh')}
        </button>
      </div>
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
      ) : requests.length || deletionRequests.length ? (
        <div className="backup-record-grid">
          {requests.map((request) => (
            <article className="backup-record-card" key={request.id}>
              <div className="backup-record-card-heading">
                <span className="backup-record-type">
                  {translate(
                    request.action === 'disable_job'
                      ? 'Pause backup schedule'
                      : request.action === 'reduce_retention'
                        ? 'Retention reduction'
                        : 'Policy change',
                  )}
                </span>
                <span className="backup-policy-state backup-policy-state--pending">
                  {translate('Awaiting review')}
                </span>
              </div>
              <strong>{request.policyName}</strong>
              <small>
                {request.policyCode} · {translate('Requested by')} {request.requestedByName}
              </small>
              <p className="backup-approval-justification">{request.justification}</p>
              {request.action === 'reduce_retention' && (
                <p className="backup-policy-hint">
                  {translate('Retention')}: {request.previousDailyCopies} {translate('daily')} ·{' '}
                  {request.previousMonthlyCopies} {translate('monthly')} →{' '}
                  {request.proposedDailyCopies} {translate('daily')} ·{' '}
                  {request.proposedMonthlyCopies} {translate('monthly')}
                </p>
              )}
              <small>
                {translate('Request expires')}{' '}
                {new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Europe/Sofia',
                }).format(new Date(request.expiresAt))}
              </small>
              {canApprove && request.requestedBy !== currentAccountId ? (
                <div className="backup-approval-actions">
                  <button
                    className="backup-approval-reject"
                    disabled={busyId === request.id}
                    onClick={() => void decide(request, 'reject')}
                    type="button"
                  >
                    {translate('Decline')}
                  </button>
                  <button
                    className="backup-approval-approve"
                    disabled={busyId === request.id}
                    onClick={() => void decide(request, 'approve')}
                    type="button"
                  >
                    {busyId === request.id ? translate('Saving') : translate('Approve')}
                  </button>
                </div>
              ) : (
                <p className="backup-security-note">
                  {translate(
                    request.requestedBy === currentAccountId
                      ? 'You cannot approve a request you submitted.'
                      : 'You can review requests, but your account cannot approve them.',
                  )}
                </p>
              )}
            </article>
          ))}
          {deletionRequests.map((request) => (
            <article className="backup-record-card" key={request.id}>
              <div className="backup-record-card-heading">
                <span className="backup-record-type">{translate('Restore-point removal')}</span>
                <span className="backup-policy-state backup-policy-state--pending">
                  {translate('Awaiting review')}
                </span>
              </div>
              <strong>{request.policyName}</strong>
              <small>
                {request.policyCode} · {translate('Restore point')} ·{' '}
                {new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Europe/Sofia',
                }).format(new Date(request.scheduledFor))}
              </small>
              <p className="backup-approval-justification">{request.reason}</p>
              <small>
                {translate('Requested by')} {request.requestedByName} ·{' '}
                {translate('Request expires')}{' '}
                {new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Europe/Sofia',
                }).format(new Date(request.expiresAt))}
              </small>
              <p className="backup-security-note">
                {translate(
                  'Approving permanently removes this encrypted copy. The restore point run history and approval record remain.',
                )}
              </p>
              {canApprove && request.requestedBy !== currentAccountId ? (
                <div className="backup-approval-actions">
                  <button
                    className="backup-approval-reject"
                    disabled={busyId === request.id}
                    onClick={() => void decideDeletion(request, 'reject')}
                    type="button"
                  >
                    {translate('Decline')}
                  </button>
                  <button
                    className="backup-approval-approve"
                    disabled={busyId === request.id}
                    onClick={() => void decideDeletion(request, 'approve')}
                    type="button"
                  >
                    {busyId === request.id ? translate('Saving') : translate('Approve removal')}
                  </button>
                </div>
              ) : (
                <p className="backup-security-note">
                  {translate(
                    request.requestedBy === currentAccountId
                      ? 'You cannot approve a request you submitted.'
                      : 'You can review requests, but your account cannot approve them.',
                  )}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="backup-record-placeholder">
          <h2>{translate('No approvals waiting')}</h2>
          <p>{translate('New critical requests will appear here for an independent review.')}</p>
        </div>
      )}
    </section>
  );
}
