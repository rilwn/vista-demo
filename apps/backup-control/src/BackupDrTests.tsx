import type { BackupDrTest, BackupExecutionRun, BackupRestoreRequest } from '@vista/contracts';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiClientError } from './api/client';
import {
  loadBackupDrTests,
  loadBackupRestoreRequests,
  loadBackupRuns,
  downloadBackupDrTestProtocol,
  planBackupDrTest,
  recordBackupDrTest,
  requestBackupRestore,
  uploadBackupDrTestProtocol,
} from './api/backup';
import { bg } from './i18n/catalog';
import { useLocalization } from './i18n/LocalizationProvider';

type ResultForm = {
  actualRpoMinutes: string;
  actualRtoMinutes: string;
  correctiveActions: string;
  nonConformities: string;
  protocolSignedAt: string;
  protocolSignedBy: string;
  resultSummary: string;
  restoreRequestId: string;
};

const emptyResult: ResultForm = {
  actualRpoMinutes: '',
  actualRtoMinutes: '',
  correctiveActions: '',
  nonConformities: '',
  protocolSignedAt: localDateTime(new Date()),
  protocolSignedBy: '',
  resultSummary: '',
  restoreRequestId: '',
};

export function BackupDrTests({
  canCreate,
  onPlanOpenChange,
  planOpen,
  sessionToken,
}: {
  canCreate: boolean;
  onPlanOpenChange: (open: boolean) => void;
  planOpen: boolean;
  sessionToken: string;
}) {
  const { locale } = useLocalization();
  const translate = (value: string) => (locale === 'bg' ? bg(value) : value);
  const [tests, setTests] = useState<BackupDrTest[]>([]);
  const [runs, setRuns] = useState<BackupExecutionRun[]>([]);
  const [restores, setRestores] = useState<BackupRestoreRequest[]>([]);
  const [restoreAvailable, setRestoreAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [runId, setRunId] = useState('');
  const [plannedFor, setPlannedFor] = useState(() =>
    localDateTime(new Date(Date.now() + 86_400_000)),
  );
  const [scope, setScope] = useState(
    'Restore the Vista database to an isolated target and verify key records.',
  );
  const [resultTest, setResultTest] = useState<BackupDrTest>();
  const [resultForm, setResultForm] = useState<ResultForm>(emptyResult);
  const [protocol, setProtocol] = useState<File>();
  const [downloadingId, setDownloadingId] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const [testPage, runPage, restorePage] = await Promise.all([
        loadBackupDrTests(sessionToken),
        loadBackupRuns(sessionToken),
        loadBackupRestoreRequests(sessionToken),
      ]);
      setTests(testPage.items);
      setRuns(runPage.items);
      setRestoreAvailable(runPage.restoreAvailable);
      setRestores(restorePage.items);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'Disaster-recovery tests could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [sessionToken]);

  const restorableRuns = useMemo(
    () =>
      runs.filter(
        (run) =>
          run.artifactAvailable &&
          run.status === 'verified' &&
          run.verificationStatus === 'verified' &&
          (run.backupType === 'database_snapshot' || run.backupType === 'full'),
      ),
    [runs],
  );

  async function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await planBackupDrTest(
        sessionToken,
        { plannedFor: new Date(plannedFor).toISOString(), runId, scope: scope.trim() },
        crypto.randomUUID(),
      );
      setNotice('Disaster-recovery test planned. Request its isolated restore when ready.');
      onPlanOpenChange(false);
      await reload();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'The test plan could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestTestRestore(test: BackupDrTest) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await requestBackupRestore(
        sessionToken,
        test.backupRunId,
        { reason: `DR test ${test.testCode}: Perform the planned isolated recovery exercise.` },
        crypto.randomUUID(),
      );
      setNotice(
        'The isolated restore request is waiting for approval by another authorised person.',
      );
      await reload();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The restore request could not be sent.',
      );
    } finally {
      setBusy(false);
    }
  }

  function openResult(test: BackupDrTest, eligibleRestores: BackupRestoreRequest[]) {
    setResultTest(test);
    setResultForm({
      ...emptyResult,
      actualRpoMinutes: String(test.rpoTargetMinutes),
      actualRtoMinutes: String(test.rtoTargetMinutes),
      protocolSignedAt: localDateTime(new Date()),
      restoreRequestId: eligibleRestores[0]?.id ?? '',
    });
    setProtocol(undefined);
    setError('');
  }

  async function submitResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resultTest || !protocol) return;
    const restore = restores.find((item) => item.id === resultForm.restoreRequestId);
    if (!restore) return;
    const actualRpoMinutes = Number(resultForm.actualRpoMinutes);
    const actualRtoMinutes = Number(resultForm.actualRtoMinutes);
    if (!Number.isSafeInteger(actualRpoMinutes) || !Number.isSafeInteger(actualRtoMinutes)) {
      setError('Enter whole-number recovery times in minutes.');
      return;
    }
    const failed =
      restore.status === 'failed' ||
      actualRpoMinutes > resultTest.rpoTargetMinutes ||
      actualRtoMinutes > resultTest.rtoTargetMinutes;
    if (failed && resultForm.correctiveActions.trim().length < 10) {
      setError('Record at least 10 characters describing the corrective action for a failed test.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const uploaded = await uploadBackupDrTestProtocol(
        sessionToken,
        resultTest.id,
        protocol,
        crypto.randomUUID(),
      );
      if (uploaded.status !== 'available') {
        throw new Error(
          'The signed PDF is not available yet. Wait for its security check, then try again.',
        );
      }
      await recordBackupDrTest(
        sessionToken,
        resultTest.id,
        {
          actualRpoMinutes,
          actualRtoMinutes,
          evidenceFileId: uploaded.id,
          protocolSignedAt: new Date(resultForm.protocolSignedAt).toISOString(),
          protocolSignedBy: resultForm.protocolSignedBy.trim(),
          restoreRequestId: resultForm.restoreRequestId,
          resultSummary: resultForm.resultSummary.trim(),
          ...(resultForm.nonConformities.trim()
            ? { nonConformities: resultForm.nonConformities.trim() }
            : {}),
          ...(resultForm.correctiveActions.trim()
            ? { correctiveActions: resultForm.correctiveActions.trim() }
            : {}),
        },
        crypto.randomUUID(),
      );
      setNotice('The test result and signed protocol were recorded.');
      setResultTest(undefined);
      setProtocol(undefined);
      await reload();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'The test result could not be recorded.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadProtocol(test: BackupDrTest) {
    if (!test.evidenceFileId) return;
    setDownloadingId(test.id);
    setError('');
    try {
      const content = await downloadBackupDrTestProtocol(sessionToken, test.evidenceFileId);
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${test.testCode}-signed-protocol.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
      }, 0);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'The signed test protocol could not be downloaded.',
      );
    } finally {
      setDownloadingId('');
    }
  }

  return (
    <>
      <section aria-live="polite" className="backup-records backup-dr-tests">
        <div className="backup-record-toolbar">
          <div>
            <strong>{translate('Disaster-recovery test register')}</strong>
            <span>
              {tests.length} {translate(tests.length === 1 ? 'test' : 'tests')}
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
        {!restoreAvailable && !loading && (
          <p className="backup-security-note">
            {translate(
              'Test restores need a separately configured isolated database target. They never overwrite the live Vista database.',
            )}
          </p>
        )}
        {loading ? (
          <div className="backup-record-placeholder" role="status">
            {translate('Loading records')}
          </div>
        ) : tests.length ? (
          <div className="backup-record-grid">
            {tests.map((test) => {
              const marker = `DR test ${test.testCode}:`;
              const linkedRestores = restores
                .filter(
                  (request) =>
                    request.runId === test.backupRunId && request.reason.startsWith(marker),
                )
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
              const activeRestore = linkedRestores.find((request) =>
                ['pending_approval', 'approved', 'running'].includes(request.status),
              );
              const otherActiveRestore = restores.find(
                (request) =>
                  request.runId === test.backupRunId &&
                  !request.reason.startsWith(marker) &&
                  ['pending_approval', 'approved', 'running'].includes(request.status),
              );
              const finishedRestores = linkedRestores.filter((request) =>
                ['completed', 'failed'].includes(request.status),
              );
              const canRetry = !activeRestore && !otherActiveRestore && !finishedRestores.length;
              return (
                <article className="backup-record-card backup-dr-test-card" key={test.id}>
                  <div className="backup-record-card-heading">
                    <span className="backup-record-type">{translate(test.testCode)}</span>
                    <span
                      className={`backup-policy-state backup-policy-state--${test.outcome ?? test.status}`}
                    >
                      {translate(testStatusLabel(test.outcome ?? test.status))}
                    </span>
                  </div>
                  <strong>{test.policyName}</strong>
                  <small>
                    {test.policyCode} · {translate('Restore point')}{' '}
                    {formatDate(test.backupScheduledFor, locale)}
                  </small>
                  <p className="backup-dr-test-scope">{test.scope}</p>
                  <dl>
                    <div>
                      <dt>{translate('Planned for')}</dt>
                      <dd>{formatDate(test.plannedFor, locale)}</dd>
                    </div>
                    <div>
                      <dt>{translate('RPO target')}</dt>
                      <dd>{formatMinutes(test.rpoTargetMinutes, translate)}</dd>
                    </div>
                    <div>
                      <dt>{translate('RTO target')}</dt>
                      <dd>{formatMinutes(test.rtoTargetMinutes, translate)}</dd>
                    </div>
                    {test.status === 'recorded' && (
                      <>
                        <div>
                          <dt>{translate('Measured RPO')}</dt>
                          <dd>
                            {formatMinutes(test.actualRpoMinutes ?? 0, translate)} ·{' '}
                            {translate(test.rpoMet ? 'Met' : 'Not met')}
                          </dd>
                        </div>
                        <div>
                          <dt>{translate('Measured RTO')}</dt>
                          <dd>
                            {formatMinutes(test.actualRtoMinutes ?? 0, translate)} ·{' '}
                            {translate(test.rtoMet ? 'Met' : 'Not met')}
                          </dd>
                        </div>
                        <div>
                          <dt>{translate('Protocol signed by')}</dt>
                          <dd>{test.protocolSignedBy}</dd>
                        </div>
                        <div>
                          <dt>{translate('Protocol date')}</dt>
                          <dd>
                            {test.protocolSignedAt
                              ? formatDate(test.protocolSignedAt, locale)
                              : '—'}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  {test.resultSummary && (
                    <p className="backup-dr-test-scope">{test.resultSummary}</p>
                  )}
                  {test.status === 'recorded' && test.evidenceFileId && (
                    <button
                      className="backup-record-edit"
                      disabled={downloadingId === test.id}
                      onClick={() => void downloadProtocol(test)}
                      type="button"
                    >
                      {translate(
                        downloadingId === test.id ? 'Downloading' : 'Download signed protocol',
                      )}
                    </button>
                  )}
                  {test.nonConformities && (
                    <p className="backup-policy-hint">
                      <strong>{translate('Non-conformities')}:</strong> {test.nonConformities}
                    </p>
                  )}
                  {test.correctiveActions && (
                    <p className="backup-policy-hint">
                      <strong>{translate('Corrective actions')}:</strong> {test.correctiveActions}
                    </p>
                  )}
                  {test.status === 'planned' && (
                    <div className="backup-dr-test-workflow">
                      {activeRestore ? (
                        <p className="backup-security-note">
                          {translate('Isolated restore')} ·{' '}
                          {translateRestoreStatus(activeRestore.status, translate)}
                        </p>
                      ) : otherActiveRestore ? (
                        <p className="backup-security-note">
                          {translate(
                            'Another restore request for this backup is open. Finish or decline it before requesting the test restore.',
                          )}
                        </p>
                      ) : finishedRestores.length ? (
                        <button
                          className="backup-record-edit backup-record-edit--primary"
                          disabled={!canCreate}
                          onClick={() => openResult(test, finishedRestores)}
                          type="button"
                        >
                          {translate('Record test result')}
                        </button>
                      ) : canRetry ? (
                        <button
                          className="backup-record-edit backup-record-edit--primary"
                          disabled={!canCreate || !restoreAvailable || busy}
                          onClick={() => void requestTestRestore(test)}
                          type="button"
                        >
                          {translate('Request isolated test restore')}
                        </button>
                      ) : null}
                      {linkedRestores.some((request) =>
                        ['rejected', 'expired'].includes(request.status),
                      ) &&
                        !activeRestore &&
                        !finishedRestores.length && (
                          <p className="backup-security-note">
                            {translate(
                              'The restore request was not approved. You can request another isolated test restore.',
                            )}
                          </p>
                        )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="backup-record-placeholder">
            <h2>{translate('No disaster-recovery tests yet')}</h2>
            <p>
              {translate(
                'Plan a restore exercise from a verified database restore point. Record the measured RPO and RTO with the signed protocol after the isolated restore finishes.',
              )}
            </p>
          </div>
        )}
      </section>

      {planOpen && (
        <div className="backup-drawer-overlay" onClick={() => onPlanOpenChange(false)}>
          <form
            aria-labelledby="backup-dr-plan-title"
            aria-modal="true"
            className="backup-editor"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => void submitPlan(event)}
            role="dialog"
          >
            <header className="backup-editor-header">
              <button
                className="backup-editor-back"
                onClick={() => onPlanOpenChange(false)}
                type="button"
              >
                ← {translate('Back')}
              </button>
              <h2 id="backup-dr-plan-title">{translate('Plan disaster-recovery test')}</h2>
              <p>
                {translate(
                  'Choose a verified backup, set the test date, and describe what the restore exercise must prove.',
                )}
              </p>
            </header>
            <div className="backup-editor-body">
              <section className="backup-form-section">
                {!restoreAvailable && (
                  <p className="backup-security-note">
                    {translate(
                      'Test restores need a separately configured isolated database target. They never overwrite the live Vista database.',
                    )}
                  </p>
                )}
                <label className="backup-form-field" htmlFor="backup-dr-run">
                  {translate('Verified database restore point *')}
                  <select
                    id="backup-dr-run"
                    onChange={(event) => setRunId(event.target.value)}
                    required
                    value={runId}
                  >
                    <option value="">{translate('Choose a verified restore point')}</option>
                    {restorableRuns.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.policyCode} · {run.policyName} · {formatDate(run.scheduledFor, locale)}
                      </option>
                    ))}
                  </select>
                  {!restorableRuns.length && (
                    <small>
                      {translate('No verified, available database restore point is ready.')}
                    </small>
                  )}
                </label>
                <label className="backup-form-field" htmlFor="backup-dr-planned-for">
                  {translate('Planned date and time *')}
                  <input
                    id="backup-dr-planned-for"
                    onChange={(event) => setPlannedFor(event.target.value)}
                    min={localDateTime(new Date())}
                    required
                    type="datetime-local"
                    value={plannedFor}
                  />
                </label>
                <label className="backup-form-field" htmlFor="backup-dr-scope">
                  {translate('Test scope *')}
                  <textarea
                    id="backup-dr-scope"
                    maxLength={2000}
                    minLength={10}
                    onChange={(event) => setScope(event.target.value)}
                    required
                    value={scope}
                  />
                  <small>
                    {translate('Describe the system and records to verify after restoration.')}
                  </small>
                </label>
              </section>
            </div>
            <footer className="backup-editor-footer">
              <button
                className="backup-editor-cancel"
                onClick={() => onPlanOpenChange(false)}
                type="button"
              >
                {translate('Cancel')}
              </button>
              <button
                className="backup-editor-save"
                disabled={!canCreate || busy || !restoreAvailable || !restorableRuns.length}
                type="submit"
              >
                {translate(busy ? 'Saving' : 'Plan test')}
              </button>
            </footer>
          </form>
        </div>
      )}

      {resultTest && (
        <div className="backup-drawer-overlay" onClick={() => !busy && setResultTest(undefined)}>
          <form
            aria-labelledby="backup-dr-result-title"
            aria-modal="true"
            className="backup-editor"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => void submitResult(event)}
            role="dialog"
          >
            <header className="backup-editor-header">
              <button
                className="backup-editor-back"
                disabled={busy}
                onClick={() => setResultTest(undefined)}
                type="button"
              >
                ← {translate('Back')}
              </button>
              <h2 id="backup-dr-result-title">{translate('Record disaster-recovery result')}</h2>
              <p>
                {resultTest.testCode} · {resultTest.policyName}
              </p>
            </header>
            <div className="backup-editor-body">
              <section className="backup-form-section">
                <p>
                  {translate(
                    'The result is classified automatically against the policy targets. Attach the signed protocol PDF to complete the record.',
                  )}
                </p>
                <label className="backup-form-field" htmlFor="backup-dr-restore-request">
                  {translate('Finished isolated restore *')}
                  <select
                    id="backup-dr-restore-request"
                    onChange={(event) =>
                      setResultForm((form) => ({ ...form, restoreRequestId: event.target.value }))
                    }
                    required
                    value={resultForm.restoreRequestId}
                  >
                    {restores
                      .filter(
                        (request) =>
                          request.runId === resultTest.backupRunId &&
                          request.reason.startsWith(`DR test ${resultTest.testCode}:`) &&
                          ['completed', 'failed'].includes(request.status),
                      )
                      .map((request) => (
                        <option key={request.id} value={request.id}>
                          {translateRestoreStatus(request.status, translate)} ·{' '}
                          {formatDate(request.completedAt ?? request.createdAt, locale)}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="backup-form-grid">
                  <label className="backup-form-field" htmlFor="backup-dr-rpo">
                    {translate('Measured RPO (minutes) *')}
                    <input
                      id="backup-dr-rpo"
                      min="0"
                      onChange={(event) =>
                        setResultForm((form) => ({ ...form, actualRpoMinutes: event.target.value }))
                      }
                      required
                      type="number"
                      value={resultForm.actualRpoMinutes}
                    />
                  </label>
                  <label className="backup-form-field" htmlFor="backup-dr-rto">
                    {translate('Measured RTO (minutes) *')}
                    <input
                      id="backup-dr-rto"
                      min="0"
                      onChange={(event) =>
                        setResultForm((form) => ({ ...form, actualRtoMinutes: event.target.value }))
                      }
                      required
                      type="number"
                      value={resultForm.actualRtoMinutes}
                    />
                  </label>
                </div>
                <label className="backup-form-field" htmlFor="backup-dr-summary">
                  {translate('Result summary *')}
                  <textarea
                    id="backup-dr-summary"
                    maxLength={4000}
                    minLength={10}
                    onChange={(event) =>
                      setResultForm((form) => ({ ...form, resultSummary: event.target.value }))
                    }
                    required
                    value={resultForm.resultSummary}
                  />
                </label>
                <label className="backup-form-field" htmlFor="backup-dr-nonconformities">
                  {translate('Non-conformities (optional)')}
                  <textarea
                    id="backup-dr-nonconformities"
                    maxLength={4000}
                    onChange={(event) =>
                      setResultForm((form) => ({ ...form, nonConformities: event.target.value }))
                    }
                    value={resultForm.nonConformities}
                  />
                </label>
                <label className="backup-form-field" htmlFor="backup-dr-corrective">
                  {translate('Corrective actions (required if failed)')}
                  <textarea
                    id="backup-dr-corrective"
                    maxLength={4000}
                    onChange={(event) =>
                      setResultForm((form) => ({ ...form, correctiveActions: event.target.value }))
                    }
                    value={resultForm.correctiveActions}
                  />
                </label>
              </section>
              <section className="backup-form-section">
                <strong>{translate('Signed test protocol')}</strong>
                <div className="backup-form-grid">
                  <label className="backup-form-field" htmlFor="backup-dr-signed-by">
                    {translate('Signed by *')}
                    <input
                      id="backup-dr-signed-by"
                      maxLength={180}
                      minLength={2}
                      onChange={(event) =>
                        setResultForm((form) => ({ ...form, protocolSignedBy: event.target.value }))
                      }
                      required
                      value={resultForm.protocolSignedBy}
                    />
                  </label>
                  <label className="backup-form-field" htmlFor="backup-dr-signed-at">
                    {translate('Signature date and time *')}
                    <input
                      id="backup-dr-signed-at"
                      onChange={(event) =>
                        setResultForm((form) => ({ ...form, protocolSignedAt: event.target.value }))
                      }
                      required
                      type="datetime-local"
                      value={resultForm.protocolSignedAt}
                    />
                  </label>
                </div>
                <label className="backup-form-field" htmlFor="backup-dr-protocol">
                  {translate('Signed protocol PDF *')}
                  <input
                    accept="application/pdf,.pdf"
                    id="backup-dr-protocol"
                    onChange={(event) => setProtocol(event.target.files?.[0])}
                    required
                    type="file"
                  />
                  <small>{translate('Upload the signed restore-test protocol as a PDF.')}</small>
                </label>
              </section>
            </div>
            <footer className="backup-editor-footer">
              <button
                className="backup-editor-cancel"
                disabled={busy}
                onClick={() => setResultTest(undefined)}
                type="button"
              >
                {translate('Cancel')}
              </button>
              <button
                className="backup-editor-save"
                disabled={!canCreate || busy || !protocol}
                type="submit"
              >
                {translate(busy ? 'Saving' : 'Save test result')}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}

function formatDate(value: string, locale: 'en' | 'bg'): string {
  return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(new Date(value));
}

function formatMinutes(minutes: number, translate: (value: string) => string): string {
  return `${minutes} ${translate(minutes === 1 ? 'minute' : 'minutes')}`;
}

function testStatusLabel(
  status: NonNullable<BackupDrTest['outcome']> | BackupDrTest['status'],
): string {
  return status === 'passed'
    ? 'Passed'
    : status === 'failed'
      ? 'Failed'
      : status === 'planned'
        ? 'Planned'
        : 'Recorded';
}

function localDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function translateRestoreStatus(
  status: BackupRestoreRequest['status'],
  translate: (value: string) => string,
): string {
  if (status === 'pending_approval') return translate('Awaiting approval');
  return translate(status);
}
