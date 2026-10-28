import type { BackupDatabaseRecoveryTable, BackupRestoreRequest } from '@vista/contracts';
import { useEffect, useState, type ChangeEvent } from 'react';

import { ApiClientError } from './api/client';
import {
  decideBackupRestore,
  downloadBackupRestoreFile,
  loadBackupDatabaseRecoveryTables,
  loadBackupRestoreRequests,
  recoverBackupDatabaseRecord,
} from './api/backup';
import { bg } from './i18n/catalog';
import { useLocalization } from './i18n/LocalizationProvider';

export function BackupRestores({
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
  const [requests, setRequests] = useState<BackupRestoreRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});
  const [databaseTables, setDatabaseTables] = useState<
    Record<string, BackupDatabaseRecoveryTable[]>
  >({});
  const [recordRecoveryId, setRecordRecoveryId] = useState('');
  const [selectedTable, setSelectedTable] = useState<Record<string, string>>({});
  const [recordKeys, setRecordKeys] = useState<Record<string, Record<string, string>>>({});

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const page = await loadBackupRestoreRequests(sessionToken);
      setRequests(page.items);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Restore requests could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [sessionToken]);

  async function decide(request: BackupRestoreRequest, decision: 'approve' | 'reject') {
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      const comment = comments[request.id]?.trim();
      await decideBackupRestore(
        sessionToken,
        request.id,
        {
          decision,
          ...(comment ? { comment } : {}),
        },
        crypto.randomUUID(),
      );
      setNotice(
        decision === 'approve'
          ? 'Restore approved. The isolated restore will start automatically.'
          : 'Restore request declined.',
      );
      await reload();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The restore decision could not be saved.',
      );
    } finally {
      setBusyId('');
    }
  }

  async function downloadRestoredFile(request: BackupRestoreRequest) {
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      const content = await downloadBackupRestoreFile(sessionToken, request.id);
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = request.restoreObjectKey?.split('/').at(-1) || 'recovered-file';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setNotice('The recovered file download has started.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The recovered file could not be downloaded.',
      );
    } finally {
      setBusyId('');
    }
  }

  async function openDatabaseRecordRecovery(request: BackupRestoreRequest) {
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      const page = await loadBackupDatabaseRecoveryTables(sessionToken, request.id);
      setDatabaseTables((current) => ({ ...current, [request.id]: page.items }));
      setSelectedTable((current) => ({
        ...current,
        [request.id]: page.items[0]?.name ?? '',
      }));
      setRecordRecoveryId(request.id);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The recovered database could not be inspected.',
      );
    } finally {
      setBusyId('');
    }
  }

  async function exportDatabaseRecord(request: BackupRestoreRequest) {
    const tableName = selectedTable[request.id] ?? '';
    const primaryKeyColumns = databaseTables[request.id]?.find(
      (table) => table.name === tableName,
    )?.primaryKeyColumns;
    if (!tableName || !primaryKeyColumns?.length) return;
    const primaryKey = Object.fromEntries(
      primaryKeyColumns.map((column) => [column, recordKeys[request.id]?.[column] ?? '']),
    );
    if (Object.values(primaryKey).some((value) => !value.trim())) {
      setError('Enter every primary-key value to select one record.');
      return;
    }
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      const recovered = await recoverBackupDatabaseRecord(sessionToken, request.id, {
        primaryKey,
        tableName,
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(recovered, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `${tableName.replaceAll(/[^A-Za-z0-9_-]/gu, '-')}-record.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setNotice('The recovered database record download has started.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The database record could not be recovered.',
      );
    } finally {
      setBusyId('');
    }
  }

  function changeComment(id: string, event: ChangeEvent<HTMLTextAreaElement>) {
    setComments((current) => ({ ...current, [id]: event.target.value }));
  }

  return (
    <section aria-live="polite" className="backup-records backup-restore-requests">
      <div className="backup-record-toolbar">
        <div>
          <strong>{translate('Restore requests')}</strong>
          <span>
            {requests.length} {translate(requests.length === 1 ? 'request' : 'requests')}
          </span>
        </div>
        <button
          className="backup-record-edit"
          disabled={loading}
          onClick={() => void reload()}
          type="button"
        >
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
      <p className="backup-security-note">
        {translate(
          'A restore is written to a separate target. It never replaces the live database or live files.',
        )}
      </p>
      {loading ? (
        <div className="backup-record-placeholder" role="status">
          {translate('Loading records')}
        </div>
      ) : requests.length ? (
        <div className="backup-record-grid">
          {requests.map((request) => {
            const isOwnRequest = request.requestedBy === currentAccountId;
            const canDecide = canApprove && !isOwnRequest && request.status === 'pending_approval';
            return (
              <article className="backup-record-card" key={request.id}>
                <div className="backup-record-card-heading">
                  <span className="backup-record-type">{translate('Restore request')}</span>
                  <span className={`backup-policy-state backup-policy-state--${request.status}`}>
                    {translateRestoreStatus(request.status, translate)}
                  </span>
                </div>
                <strong>{request.policyName}</strong>
                <small>{translate(request.sourceType)}</small>
                <small>
                  {request.policyCode} · {translate('Restore point')}{' '}
                  {formatDate(request.scheduledFor, locale)}
                </small>
                <p className="backup-approval-justification">{request.reason}</p>
                {request.sourceType !== 'database' && (
                  <p className="backup-policy-hint">
                    {request.restoreObjectKey ? (
                      <>
                        {translate('File selected for recovery')}:{' '}
                        <code>{request.restoreObjectKey}</code>
                      </>
                    ) : (
                      translate(
                        request.sourceType === 'object_storage'
                          ? 'Complete file-store snapshot'
                          : 'Complete shared-folder snapshot',
                      )
                    )}
                  </p>
                )}
                <dl>
                  <div>
                    <dt>{translate('Requested by')}</dt>
                    <dd>{request.requestedByName}</dd>
                  </div>
                  <div>
                    <dt>{translate('Approved by')}</dt>
                    <dd>{request.approvedByName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{translate('Attempts')}</dt>
                    <dd>{request.attemptCount}</dd>
                  </div>
                  <div>
                    <dt>{translate('Completed')}</dt>
                    <dd>{request.completedAt ? formatDate(request.completedAt, locale) : '—'}</dd>
                  </div>
                </dl>
                {request.status === 'completed' && request.targetDatabaseName && (
                  <>
                    <p className="backup-policy-hint">
                      {translate('Restored database')}: <code>{request.targetDatabaseName}</code>
                    </p>
                    <div className="backup-database-record-recovery">
                      {recordRecoveryId === request.id ? (
                        <>
                          <label className="backup-form-field">
                            {translate('Database table')}
                            <select
                              onChange={(event) =>
                                setSelectedTable((current) => ({
                                  ...current,
                                  [request.id]: event.target.value,
                                }))
                              }
                              value={selectedTable[request.id] ?? ''}
                            >
                              <option value="">{translate('Select a table')}</option>
                              {(databaseTables[request.id] ?? []).map((table) => (
                                <option key={table.name} value={table.name}>
                                  {table.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {(databaseTables[request.id] ?? [])
                            .find((table) => table.name === selectedTable[request.id])
                            ?.primaryKeyColumns.map((column) => (
                              <label
                                className="backup-form-field"
                                htmlFor={`record-key-${request.id}-${column}`}
                                key={column}
                              >
                                {translate('Primary-key value')}: <code>{column}</code>
                                <input
                                  id={`record-key-${request.id}-${column}`}
                                  maxLength={2048}
                                  onChange={(event) =>
                                    setRecordKeys((current) => ({
                                      ...current,
                                      [request.id]: {
                                        ...current[request.id],
                                        [column]: event.target.value,
                                      },
                                    }))
                                  }
                                  value={recordKeys[request.id]?.[column] ?? ''}
                                />
                              </label>
                            ))}
                          <div className="backup-approval-actions">
                            <button
                              className="backup-record-edit"
                              disabled={busyId === request.id}
                              onClick={() => void exportDatabaseRecord(request)}
                              type="button"
                            >
                              {translate(
                                busyId === request.id ? 'Preparing download' : 'Download record',
                              )}
                            </button>
                            <button
                              className="backup-record-edit"
                              onClick={() => setRecordRecoveryId('')}
                              type="button"
                            >
                              {translate('Close')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          className="backup-record-edit"
                          disabled={busyId === request.id}
                          onClick={() => void openDatabaseRecordRecovery(request)}
                          type="button"
                        >
                          {translate(
                            busyId === request.id
                              ? 'Loading tables'
                              : 'Recover one database record',
                          )}
                        </button>
                      )}
                    </div>
                  </>
                )}
                {request.status === 'completed' &&
                  request.targetStorageBucket &&
                  request.targetStoragePrefix && (
                    <p className="backup-policy-hint">
                      {translate('Restored file-store copy')}:{' '}
                      <code>
                        {request.targetStorageBucket}/{request.targetStoragePrefix}
                      </code>
                    </p>
                  )}
                {request.status === 'completed' &&
                  request.restoreObjectKey &&
                  request.targetStoragePrefix && (
                    <button
                      className="backup-record-edit"
                      disabled={busyId === request.id}
                      onClick={() => void downloadRestoredFile(request)}
                      type="button"
                    >
                      {translate(
                        busyId === request.id ? 'Preparing download' : 'Download recovered file',
                      )}
                    </button>
                  )}
                {request.status === 'failed' && request.errorCode && (
                  <p className="backup-inline-error">
                    {translate(
                      'The restore did not finish. Check the backup service logs or contact your administrator.',
                    )}
                  </p>
                )}
                {request.status === 'pending_approval' &&
                  (canDecide ? (
                    <>
                      <label
                        className="backup-form-field"
                        htmlFor={`restore-comment-${request.id}`}
                      >
                        {translate('Decision note (optional)')}
                        <textarea
                          id={`restore-comment-${request.id}`}
                          maxLength={500}
                          onChange={(event) => changeComment(request.id, event)}
                          value={comments[request.id] ?? ''}
                        />
                      </label>
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
                          {translate(busyId === request.id ? 'Saving' : 'Approve restore')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="backup-security-note">
                      {translate(
                        isOwnRequest
                          ? 'You cannot approve a restore request you submitted.'
                          : 'Your account can view restore requests but cannot approve them.',
                      )}
                    </p>
                  ))}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="backup-record-placeholder">
          <h2>{translate('No restore requests yet')}</h2>
          <p>
            {translate(
              'Choose Request restore from a verified restore point in Jobs & restore points.',
            )}
          </p>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string, locale: 'en' | 'bg'): string {
  return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(new Date(value));
}

function translateRestoreStatus(
  status: BackupRestoreRequest['status'],
  translate: (value: string) => string,
): string {
  return status === 'approved' ? translate('Restore status: approved') : translate(status);
}
