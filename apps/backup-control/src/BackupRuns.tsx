import type { BackupExecutionRun, BackupFileRestoreOptions } from '@vista/contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { ApiClientError } from './api/client';
import {
  loadBackupFileRestoreOptions,
  loadBackupRuns,
  requestBackupArtifactDeletion,
  requestBackupRestore,
} from './api/backup';
import { bg } from './i18n/catalog';
import { useLocalization } from './i18n/LocalizationProvider';

export function BackupRuns({
  canRequestDeletion,
  canRequestRestore,
  sessionToken,
}: {
  canRequestDeletion: boolean;
  canRequestRestore: boolean;
  sessionToken: string;
}) {
  const { locale } = useLocalization();
  const [items, setItems] = useState<BackupExecutionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [restoreAvailable, setRestoreAvailable] = useState(false);
  const [restoreRun, setRestoreRun] = useState<BackupExecutionRun>();
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreFileSearch, setRestoreFileSearch] = useState('');
  const [restoreFileOptions, setRestoreFileOptions] = useState<BackupFileRestoreOptions['items']>(
    [],
  );
  const [restoreFileCount, setRestoreFileCount] = useState(0);
  const [restoreScope, setRestoreScope] = useState<'complete' | 'file' | ''>('');
  const [restoreObjectKey, setRestoreObjectKey] = useState('');
  const [restoreFilesLoading, setRestoreFilesLoading] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [deletionRun, setDeletionRun] = useState<BackupExecutionRun>();
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionBusy, setDeletionBusy] = useState(false);
  const translate = (value: string) => (locale === 'bg' ? bg(value) : value);

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const page = await loadBackupRuns(sessionToken);
      setItems(page.items);
      setRestoreAvailable(page.restoreAvailable);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Backup activity could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [sessionToken]);

  useEffect(() => {
    const search = restoreFileSearch.trim();
    if (!restoreRun || restoreRun.sourceType === 'database' || search.length < 2) {
      setRestoreFileOptions([]);
      setRestoreFileCount(0);
      setRestoreFilesLoading(false);
      return;
    }
    let current = true;
    const timeout = window.setTimeout(() => {
      setRestoreFilesLoading(true);
      setError('');
      void loadBackupFileRestoreOptions(sessionToken, restoreRun.id, search)
        .then((result) => {
          if (!current) return;
          setRestoreFileOptions(result.items);
          setRestoreFileCount(result.total);
          setRestoreObjectKey((selected) =>
            result.items.some((item) => item.key === selected) ? selected : '',
          );
        })
        .catch((caught: unknown) => {
          if (current) {
            setError(
              caught instanceof ApiClientError
                ? caught.message
                : 'Items in this restore point could not be loaded.',
            );
          }
        })
        .finally(() => {
          if (current) setRestoreFilesLoading(false);
        });
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [restoreFileSearch, restoreRun, sessionToken]);

  function openRestore(run: BackupExecutionRun) {
    setRestoreRun(run);
    setRestoreReason('');
    setRestoreFileSearch('');
    setRestoreFileOptions([]);
    setRestoreFileCount(0);
    setRestoreScope('');
    setRestoreObjectKey('');
    setError('');
    setNotice('');
  }

  async function submitRestore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!restoreRun) return;
    if (restoreRun.sourceType !== 'database' && !restoreScope) {
      setError(
        restoreRun.sourceType === 'email'
          ? 'Choose whether to restore the email archive or one message.'
          : 'Choose whether to restore the complete file store or one file.',
      );
      return;
    }
    if (restoreRun.sourceType !== 'database' && restoreScope === 'file' && !restoreObjectKey) {
      setError(
        restoreRun.sourceType === 'email'
          ? 'Search for and select one email message to restore.'
          : 'Search for and select one file to restore.',
      );
      return;
    }
    setRestoreBusy(true);
    setError('');
    setNotice('');
    try {
      await requestBackupRestore(
        sessionToken,
        restoreRun.id,
        {
          reason: restoreReason.trim(),
          ...(restoreRun.sourceType !== 'database' && restoreObjectKey
            ? { objectKey: restoreObjectKey }
            : {}),
        },
        crypto.randomUUID(),
      );
      setNotice('Restore request sent for independent approval.');
      setRestoreRun(undefined);
      setRestoreReason('');
      setRestoreObjectKey('');
      setRestoreFileSearch('');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The restore request could not be sent.',
      );
    } finally {
      setRestoreBusy(false);
    }
  }

  function openDeletion(run: BackupExecutionRun) {
    setDeletionRun(run);
    setDeletionReason('');
    setError('');
    setNotice('');
  }

  async function submitDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deletionRun) return;
    setDeletionBusy(true);
    setError('');
    setNotice('');
    try {
      await requestBackupArtifactDeletion(
        sessionToken,
        deletionRun.id,
        { reason: deletionReason.trim() },
        crypto.randomUUID(),
      );
      setNotice(
        'Restore-point removal sent for independent approval. The copy remains available until approved.',
      );
      setDeletionRun(undefined);
      setDeletionReason('');
      await reload();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The restore-point removal request could not be sent.',
      );
    } finally {
      setDeletionBusy(false);
    }
  }

  return (
    <>
      <section className="backup-records" aria-live="polite">
        <div className="backup-record-toolbar">
          <div>
            <strong>{translate('Backup activity')}</strong>
            <span>
              {items.length} {translate(items.length === 1 ? 'run' : 'runs')}
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
          <p className="backup-record-error" role="alert">
            {translate(error)}
          </p>
        )}
        {notice && (
          <p className="backup-inline-success" role="status">
            {translate(notice)} {translate('Open Restores & approvals to follow its status.')}
          </p>
        )}
        {canRequestRestore && !restoreAvailable && !loading && (
          <p className="backup-security-note">
            {translate(
              'Restore requests are disabled until the backup encryption key and the matching isolated restore target are configured.',
            )}
          </p>
        )}
        {loading ? (
          <div className="backup-record-placeholder">
            <p>{translate('Loading backup activity')}</p>
          </div>
        ) : items.length ? (
          <div className="backup-record-grid">
            {items.map((run) => (
              <RunCard
                canRequestDeletion={canRequestDeletion}
                canRequestRestore={canRequestRestore}
                key={run.id}
                locale={locale}
                onRequestDeletion={openDeletion}
                onRequestRestore={openRestore}
                run={run}
                translate={translate}
              />
            ))}
          </div>
        ) : (
          <div className="backup-record-placeholder">
            <h2>{translate('No backup runs yet')}</h2>
            <p>
              {translate(
                'Activate an approved schedule for a supported source to create the first restore point.',
              )}
            </p>
          </div>
        )}
      </section>
      {restoreRun && (
        <div className="backup-drawer-overlay" onClick={() => setRestoreRun(undefined)}>
          <form
            aria-labelledby="backup-restore-request-title"
            aria-modal="true"
            className="backup-editor backup-restore-request-editor"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => void submitRestore(event)}
            role="dialog"
          >
            <header className="backup-editor-header">
              <button
                className="backup-editor-back"
                onClick={() => setRestoreRun(undefined)}
                type="button"
              >
                ← {translate('Back')}
              </button>
              <h2 id="backup-restore-request-title">
                {translate(
                  restoreRun.sourceType !== 'database'
                    ? restoreRun.sourceType === 'email'
                      ? 'Request email recovery'
                      : restoreRun.sourceType === 'object_storage'
                        ? 'Request file-store restore'
                        : 'Request shared-folder restore'
                    : 'Request database restore',
                )}
              </h2>
              <p>
                {restoreRun.policyName} · {formatDate(restoreRun.scheduledFor, locale)}
              </p>
            </header>
            <div className="backup-editor-body">
              <section className="backup-form-section">
                <strong>
                  {translate(
                    restoreRun.sourceType !== 'database'
                      ? 'Restore to an isolated storage location'
                      : 'Restore to a separate database',
                  )}
                </strong>
                <p>
                  {translate(
                    restoreRun.sourceType === 'object_storage'
                      ? 'Choose the complete file-store snapshot or one file. The copy is written to a new isolated storage location and never replaces live files. A second authorised person must approve it.'
                      : restoreRun.sourceType === 'email'
                        ? 'Choose the complete email archive or one message. Messages are restored as .eml files to isolated storage; this does not add them back to the live mailbox. A second authorised person must approve the request.'
                        : restoreRun.sourceType !== 'database'
                          ? 'Choose the complete shared-folder snapshot or one file. Files are copied to a new isolated storage location; the original folder is not changed. A second authorised person must approve it.'
                          : 'This request will restore a verified copy into an isolated database. It will not overwrite the live Vista system. A second authorised person must approve it.',
                  )}
                </p>
                {restoreRun.sourceType !== 'database' && (
                  <>
                    <label className="backup-form-field" htmlFor="backup-restore-scope">
                      {translate('Restore scope *')}
                      <select
                        id="backup-restore-scope"
                        onChange={(event) => {
                          const scope = event.target.value as 'complete' | 'file' | '';
                          setRestoreScope(scope);
                          setRestoreObjectKey('');
                          setRestoreFileSearch('');
                        }}
                        required
                        value={restoreScope}
                      >
                        <option value="">{translate('Choose what to restore')}</option>
                        <option value="complete">
                          {translate(
                            restoreRun.sourceType === 'object_storage'
                              ? 'Complete file-store snapshot'
                              : restoreRun.sourceType === 'email'
                                ? 'Complete email archive'
                                : 'Complete shared-folder snapshot',
                          )}
                        </option>
                        <option value="file">
                          {translate(
                            restoreRun.sourceType === 'email' ? 'One email message' : 'One file',
                          )}
                        </option>
                      </select>
                      <small>
                        {translate('Both choices restore only to a new isolated storage location.')}
                      </small>
                    </label>
                    {restoreScope === 'file' && (
                      <>
                        <label className="backup-form-field" htmlFor="backup-restore-file-search">
                          {translate(
                            restoreRun.sourceType === 'email'
                              ? 'Search messages in restore point'
                              : 'Search files in restore point',
                          )}
                          <input
                            autoComplete="off"
                            id="backup-restore-file-search"
                            maxLength={200}
                            onChange={(event) => {
                              setRestoreFileSearch(event.target.value);
                              setRestoreObjectKey('');
                            }}
                            placeholder={translate(
                              restoreRun.sourceType === 'email'
                                ? 'Enter at least two characters from mailbox, sender, subject or message path'
                                : 'Enter at least two characters from the file name or folder',
                            )}
                            type="search"
                            value={restoreFileSearch}
                          />
                          <small>
                            {translate('Search checks the verified restore point before approval.')}
                          </small>
                        </label>
                        <label className="backup-form-field" htmlFor="backup-restore-file-choice">
                          {translate(
                            restoreRun.sourceType === 'email'
                              ? 'Email message to restore *'
                              : 'File to restore *',
                          )}
                          <select
                            id="backup-restore-file-choice"
                            onChange={(event) => setRestoreObjectKey(event.target.value)}
                            required
                            value={restoreObjectKey}
                          >
                            <option value="">{translate('Select a file')}</option>
                            {restoreFileOptions.map((file) => (
                              <option key={file.key} value={file.key}>
                                {file.label ?? file.key} · {formatBytes(file.sizeBytes, translate)}
                              </option>
                            ))}
                          </select>
                          {restoreFilesLoading && (
                            <small role="status">{translate('Searching files')}</small>
                          )}
                          {!restoreFilesLoading &&
                            restoreFileSearch.trim().length >= 2 &&
                            restoreFileCount === 0 && (
                              <small>
                                {translate(
                                  restoreRun.sourceType === 'email'
                                    ? 'No matching messages in this restore point.'
                                    : 'No matching files in this restore point.',
                                )}
                              </small>
                            )}
                          {restoreFileCount > restoreFileOptions.length && (
                            <small>
                              {translate(
                                'More matches exist. Add more characters to narrow the search.',
                              )}
                            </small>
                          )}
                        </label>
                      </>
                    )}
                  </>
                )}
                <label className="backup-form-field" htmlFor="backup-restore-reason">
                  {translate('Reason for restore *')}
                  <textarea
                    aria-label={translate('Reason for restore *')}
                    autoFocus
                    id="backup-restore-reason"
                    maxLength={1000}
                    minLength={10}
                    onChange={(event) => setRestoreReason(event.target.value)}
                    required
                    value={restoreReason}
                  />
                  <small>{translate('Enter at least 10 characters.')}</small>
                </label>
              </section>
            </div>
            <footer className="backup-editor-footer">
              <button
                className="backup-editor-cancel"
                onClick={() => setRestoreRun(undefined)}
                type="button"
              >
                {translate('Cancel')}
              </button>
              <button className="backup-editor-save" disabled={restoreBusy} type="submit">
                {translate(restoreBusy ? 'Sending' : 'Send restore request')}
              </button>
            </footer>
          </form>
        </div>
      )}
      {deletionRun && (
        <div className="backup-drawer-overlay" onClick={() => setDeletionRun(undefined)}>
          <form
            aria-labelledby="backup-artifact-deletion-title"
            aria-modal="true"
            className="backup-editor backup-restore-request-editor"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => void submitDeletion(event)}
            role="dialog"
          >
            <header className="backup-editor-header">
              <button
                className="backup-editor-back"
                onClick={() => setDeletionRun(undefined)}
                type="button"
              >
                ← {translate('Back')}
              </button>
              <h2 id="backup-artifact-deletion-title">
                {translate('Request restore-point removal')}
              </h2>
              <p>
                {deletionRun.policyName} · {formatDate(deletionRun.scheduledFor, locale)}
              </p>
            </header>
            <div className="backup-editor-body">
              <section className="backup-form-section">
                <strong>{translate('This permanently removes the encrypted backup copy.')}</strong>
                <p>
                  {translate(
                    'A different authorised person must approve. Until then the restore point remains available. After removal, the run and approval history stay in the register, but this copy cannot be restored.',
                  )}
                </p>
                <label className="backup-form-field" htmlFor="backup-artifact-deletion-reason">
                  {translate('Reason for removal *')}
                  <textarea
                    autoFocus
                    id="backup-artifact-deletion-reason"
                    maxLength={1000}
                    minLength={10}
                    onChange={(event) => setDeletionReason(event.target.value)}
                    required
                    value={deletionReason}
                  />
                  <small>{translate('Enter at least 10 characters.')}</small>
                </label>
              </section>
            </div>
            <footer className="backup-editor-footer">
              <button
                className="backup-editor-cancel"
                onClick={() => setDeletionRun(undefined)}
                type="button"
              >
                {translate('Cancel')}
              </button>
              <button className="backup-editor-save" disabled={deletionBusy} type="submit">
                {translate(deletionBusy ? 'Sending' : 'Send removal request')}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}

function RunCard({
  locale,
  run,
  translate,
  canRequestRestore,
  canRequestDeletion,
  onRequestRestore,
  onRequestDeletion,
}: {
  canRequestDeletion: boolean;
  canRequestRestore: boolean;
  locale: 'en' | 'bg';
  onRequestDeletion: (run: BackupExecutionRun) => void;
  onRequestRestore: (run: BackupExecutionRun) => void;
  run: BackupExecutionRun;
  translate: (value: string) => string;
}) {
  const deletionInProgress = ['pending_approval', 'approved', 'running'].includes(
    run.artifactDeletionStatus ?? '',
  );
  return (
    <article className="backup-record-card">
      <div className="backup-record-card-heading">
        <span className="backup-record-type">{translate(run.backupType)}</span>
        <span className={`backup-policy-state backup-policy-state--${run.status}`}>
          {translate(run.status)}
        </span>
      </div>
      <strong>{run.policyName}</strong>
      <small>
        {run.policyCode} · {translate('Scheduled')} {formatDate(run.scheduledFor, locale)}
      </small>
      <small>{translate(run.sourceType)}</small>
      <dl className="backup-run-details">
        <div>
          <dt>{translate('Verification')}</dt>
          <dd>{translate(run.verificationStatus)}</dd>
        </div>
        <div>
          <dt>{translate('Independent copy')}</dt>
          <dd>
            {translate(run.independentCopyStatus)}
            {run.independentCopyTargetCode ? <small>{run.independentCopyTargetCode}</small> : null}
          </dd>
        </div>
        <div>
          <dt>{translate('Artifact size')}</dt>
          <dd>{run.artifactSizeBytes ? formatBytes(run.artifactSizeBytes, translate) : '—'}</dd>
        </div>
        <div>
          <dt>{translate('Compression')}</dt>
          <dd>
            {translate(
              run.compressionAlgorithm === 'gzip'
                ? 'Gzip compression'
                : run.compressionAlgorithm === 'postgres_custom'
                  ? 'PostgreSQL archive compression'
                  : 'No compression',
            )}
          </dd>
        </div>
        <div>
          <dt>{translate('Original data size')}</dt>
          <dd>
            {run.uncompressedSizeBytes ? formatBytes(run.uncompressedSizeBytes, translate) : '—'}
          </dd>
        </div>
        <div>
          <dt>{translate('Attempts')}</dt>
          <dd>{run.attemptCount}</dd>
        </div>
        <div>
          <dt>{translate('Verified')}</dt>
          <dd>{run.verifiedAt ? formatDate(run.verifiedAt, locale) : '—'}</dd>
        </div>
      </dl>
      {run.status === 'verified' && !run.artifactAvailable && (
        <p className="backup-policy-hint">
          {translate(
            run.artifactDeletedReason === 'approved_restore_point_deletion'
              ? 'The copy was removed after independent approval. Its run history remains available.'
              : 'The stored copy expired under the approved retention schedule. Its history remains available.',
          )}
        </p>
      )}
      {run.artifactDeletionStatus && (
        <p className="backup-policy-hint" role="status">
          {translate(artifactDeletionStatusCopy(run.artifactDeletionStatus))}
        </p>
      )}
      {run.status === 'failed' && (
        <p className="backup-policy-hint">
          {translate('The backup could not be completed. Contact your backup administrator.')}
        </p>
      )}
      {run.independentCopyStatus === 'failed' && (
        <p className="backup-policy-hint" role="alert">
          {translate(
            'The separate backup copy could not be verified. Check storage configuration.',
          )}
        </p>
      )}
      {run.artifactAvailable &&
        run.status === 'verified' &&
        run.verificationStatus === 'verified' && (
          <div className="backup-run-actions">
            {canRequestRestore && run.restoreAvailable && !deletionInProgress && (
              <button
                className="backup-record-edit"
                onClick={() => onRequestRestore(run)}
                type="button"
              >
                {translate('Request restore')}
              </button>
            )}
            {canRequestDeletion && !deletionInProgress && (
              <button
                className="backup-record-remove"
                onClick={() => onRequestDeletion(run)}
                type="button"
              >
                {translate('Request removal')}
              </button>
            )}
          </div>
        )}
    </article>
  );
}

function artifactDeletionStatusCopy(
  status: NonNullable<BackupExecutionRun['artifactDeletionStatus']>,
): string {
  if (status === 'pending_approval') {
    return 'Awaiting separate approval. The restore point is still available.';
  }
  if (status === 'approved') {
    return 'Removal approved. The encrypted copy will be removed shortly.';
  }
  if (status === 'running') return 'The approved restore-point removal is in progress.';
  if (status === 'completed') {
    return 'The encrypted copy was removed. Its run and approval history remain available.';
  }
  if (status === 'rejected') {
    return 'The removal request was declined. The restore point remains available.';
  }
  if (status === 'expired') {
    return 'The removal request expired. The restore point remains available.';
  }
  return 'The removal did not finish. Check the restore-point status before sending another request.';
}

function formatDate(value: string, locale: 'en' | 'bg'): string {
  return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatBytes(value: string, translate: (value: string) => string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} ${translate('bytes')}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`;
}
