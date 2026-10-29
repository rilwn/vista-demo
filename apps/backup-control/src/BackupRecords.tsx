import type {
  BackupPolicy,
  BackupProtectedSource,
  BackupReferenceData,
  BackupSourceType,
  CreateBackupPolicyRequest,
  CreateBackupProtectedSourceRequest,
} from '@vista/contracts';
import { useEffect, useState } from 'react';

import { ApiClientError } from './api/client';
import {
  activateBackupPolicy,
  loadBackupPolicies,
  loadBackupReferenceData,
  loadBackupSources,
  requestBackupPolicyApproval,
  requestBackupPolicyPause,
  requestBackupPolicyRetentionReduction,
  resumeBackupPolicy,
  saveBackupPolicy,
  saveBackupSource,
} from './api/backup';
import { bg } from './i18n/catalog';
import { useLocalization } from './i18n/LocalizationProvider';

type Screen = 'sources' | 'policies';

interface BackupRecordsProps {
  canEdit: boolean;
  editorOpen: boolean;
  onEditorOpenChange: (open: boolean) => void;
  onRecordEdit: (record: BackupPolicy | BackupProtectedSource | undefined) => void;
  recordToEdit?: BackupPolicy | BackupProtectedSource;
  screen: Screen;
  sessionToken: string;
}

interface SourceForm {
  annualGrowthPercent: string;
  credentialCustody: string;
  dataClassification: BackupProtectedSource['dataClassification'];
  dataStewardEmployeeId: string;
  dependencies: string;
  encryptedAtSource: boolean;
  estimatedSizeGib: string;
  location: string;
  name: string;
  ownerEmployeeId: string;
  restorePrerequisites: string;
  sourceCode: string;
  sourceType: BackupSourceType;
}

interface PolicyForm {
  backupType: BackupPolicy['backupType'];
  compressionEnabled: boolean;
  dayOfMonth: string;
  dayOfWeek: string;
  frequency: BackupPolicy['frequency'];
  name: string;
  policyCode: string;
  retentionDailyCopies: string;
  retentionMonthlyCopies: string;
  rpoMinutes: string;
  rtoMinutes: string;
  runTimeLocal: string;
  sourceIds: string[];
}

const sourceTypes: BackupSourceType[] = [
  'database',
  'object_storage',
  'server',
  'workstation',
  'file_share',
  'file',
  'email',
  'mobile_device',
  'cloud_service',
  'other',
];

const emptySource: SourceForm = {
  annualGrowthPercent: '',
  credentialCustody: '',
  dataClassification: 'critical',
  dataStewardEmployeeId: '',
  dependencies: '',
  encryptedAtSource: false,
  estimatedSizeGib: '',
  location: '',
  name: '',
  ownerEmployeeId: '',
  restorePrerequisites: '',
  sourceCode: '',
  sourceType: 'database',
};

const emptyPolicy: PolicyForm = {
  backupType: 'database_snapshot',
  compressionEnabled: true,
  dayOfMonth: '',
  dayOfWeek: '',
  frequency: 'hourly',
  name: '',
  policyCode: '',
  retentionDailyCopies: '35',
  retentionMonthlyCopies: '12',
  rpoMinutes: '60',
  rtoMinutes: '240',
  runTimeLocal: '',
  sourceIds: [],
};

export function BackupRecords({
  canEdit,
  editorOpen,
  onEditorOpenChange,
  onRecordEdit,
  recordToEdit,
  screen,
  sessionToken,
}: BackupRecordsProps) {
  const { locale } = useLocalization();
  const [sources, setSources] = useState<BackupProtectedSource[]>([]);
  const [policies, setPolicies] = useState<BackupPolicy[]>([]);
  const [referenceData, setReferenceData] = useState<BackupReferenceData>({ employees: [] });
  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySource);
  const [policyForm, setPolicyForm] = useState<PolicyForm>(emptyPolicy);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [approvalPolicy, setApprovalPolicy] = useState<BackupPolicy>();
  const [approvalAction, setApprovalAction] = useState<
    'disable_job' | 'modify_policy' | 'reduce_retention'
  >('modify_policy');
  const [approvalJustification, setApprovalJustification] = useState('');
  const [proposedDailyCopies, setProposedDailyCopies] = useState('');
  const [proposedMonthlyCopies, setProposedMonthlyCopies] = useState('');
  const translate = (value: string) => (locale === 'bg' ? bg(value) : value);

  const retentionDailyValue = Number(proposedDailyCopies);
  const retentionMonthlyValue = Number(proposedMonthlyCopies);
  const validRetentionReduction = Boolean(
    approvalPolicy &&
    Number.isInteger(retentionDailyValue) &&
    Number.isInteger(retentionMonthlyValue) &&
    retentionDailyValue >= 1 &&
    retentionDailyValue <= approvalPolicy.retentionDailyCopies &&
    retentionMonthlyValue >= 1 &&
    retentionMonthlyValue <= approvalPolicy.retentionMonthlyCopies &&
    (retentionDailyValue < approvalPolicy.retentionDailyCopies ||
      retentionMonthlyValue < approvalPolicy.retentionMonthlyCopies),
  );

  function requestLowerRetention(policy: BackupPolicy) {
    setApprovalPolicy(policy);
    setApprovalAction('reduce_retention');
    setApprovalJustification('');
    setProposedDailyCopies(String(policy.retentionDailyCopies));
    setProposedMonthlyCopies(String(policy.retentionMonthlyCopies));
    setError('');
  }

  async function reload() {
    setLoading(true);
    setError('');
    try {
      if (screen === 'sources') {
        const [sourcePage, references] = await Promise.all([
          loadBackupSources(sessionToken),
          loadBackupReferenceData(sessionToken),
        ]);
        setSources(sourcePage.items);
        setReferenceData(references);
      } else {
        const [policyPage, sourcePage] = await Promise.all([
          loadBackupPolicies(sessionToken),
          loadBackupSources(sessionToken),
        ]);
        setPolicies(policyPage.items);
        setSources(sourcePage.items);
      }
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'The records could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [screen, sessionToken]);

  useEffect(() => {
    if (!editorOpen) {
      setSourceForm(emptySource);
      setPolicyForm(emptyPolicy);
      return;
    }
    if (screen === 'sources' && recordToEdit && 'sourceCode' in recordToEdit) {
      setSourceForm(sourceToForm(recordToEdit));
    } else if (screen === 'policies' && recordToEdit && 'policyCode' in recordToEdit) {
      setPolicyForm(policyToForm(recordToEdit));
    } else {
      setSourceForm(emptySource);
      setPolicyForm(emptyPolicy);
    }
  }, [editorOpen, recordToEdit, screen]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (screen === 'sources') {
        const payload: CreateBackupProtectedSourceRequest = {
          dataClassification: sourceForm.dataClassification,
          encryptedAtSource: sourceForm.encryptedAtSource,
          location: sourceForm.location,
          name: sourceForm.name,
          sourceCode: sourceForm.sourceCode,
          sourceType: sourceForm.sourceType,
          ...(sourceForm.annualGrowthPercent
            ? { annualGrowthPercent: sourceForm.annualGrowthPercent }
            : {}),
          ...(sourceForm.credentialCustody
            ? { credentialCustody: sourceForm.credentialCustody }
            : {}),
          ...(sourceForm.dataStewardEmployeeId
            ? { dataStewardEmployeeId: sourceForm.dataStewardEmployeeId }
            : {}),
          ...(sourceForm.dependencies ? { dependencies: sourceForm.dependencies } : {}),
          ...(sourceForm.estimatedSizeGib ? { estimatedSizeGib: sourceForm.estimatedSizeGib } : {}),
          ...(sourceForm.ownerEmployeeId ? { ownerEmployeeId: sourceForm.ownerEmployeeId } : {}),
          ...(sourceForm.restorePrerequisites
            ? { restorePrerequisites: sourceForm.restorePrerequisites }
            : {}),
        };
        const saved = await saveBackupSource(
          sessionToken,
          recordToEdit && 'sourceCode' in recordToEdit
            ? { ...payload, expectedVersion: recordToEdit.version }
            : payload,
          crypto.randomUUID(),
          recordToEdit && 'sourceCode' in recordToEdit ? recordToEdit.id : undefined,
        );
        setSources((current) => upsert(current, saved));
        setNotice(recordToEdit ? 'Source updated.' : 'Source added.');
      } else {
        const payload: CreateBackupPolicyRequest = {
          backupType: policyForm.backupType,
          compressionEnabled: policyForm.compressionEnabled,
          frequency: policyForm.frequency,
          name: policyForm.name,
          policyCode: policyForm.policyCode,
          retentionDailyCopies: Number(policyForm.retentionDailyCopies),
          retentionMonthlyCopies: Number(policyForm.retentionMonthlyCopies),
          rpoMinutes: Number(policyForm.rpoMinutes),
          rtoMinutes: Number(policyForm.rtoMinutes),
          sourceIds: policyForm.sourceIds,
          ...(policyForm.runTimeLocal ? { runTimeLocal: policyForm.runTimeLocal } : {}),
          ...(policyForm.frequency === 'weekly' && policyForm.dayOfWeek !== ''
            ? { dayOfWeek: Number(policyForm.dayOfWeek) }
            : {}),
          ...(policyForm.frequency === 'monthly' && policyForm.dayOfMonth !== ''
            ? { dayOfMonth: Number(policyForm.dayOfMonth) }
            : {}),
        };
        const saved = await saveBackupPolicy(
          sessionToken,
          recordToEdit && 'policyCode' in recordToEdit
            ? { ...payload, expectedVersion: recordToEdit.version }
            : payload,
          crypto.randomUUID(),
          recordToEdit && 'policyCode' in recordToEdit ? recordToEdit.id : undefined,
        );
        setPolicies((current) => upsert(current, saved));
        setNotice(recordToEdit ? 'Draft policy updated.' : 'Draft policy created.');
      }
      onEditorOpenChange(false);
      onRecordEdit(undefined);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'The record could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitApproval(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!approvalPolicy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const baseRequest = {
        expectedVersion: approvalPolicy.version,
        justification: approvalJustification,
      };
      const updated =
        approvalAction === 'disable_job'
          ? await requestBackupPolicyPause(
              sessionToken,
              approvalPolicy.id,
              baseRequest,
              crypto.randomUUID(),
            )
          : approvalAction === 'reduce_retention'
            ? await requestBackupPolicyRetentionReduction(
                sessionToken,
                approvalPolicy.id,
                {
                  ...baseRequest,
                  retentionDailyCopies: retentionDailyValue,
                  retentionMonthlyCopies: retentionMonthlyValue,
                },
                crypto.randomUUID(),
              )
            : await requestBackupPolicyApproval(
                sessionToken,
                approvalPolicy.id,
                baseRequest,
                crypto.randomUUID(),
              );
      setPolicies((current) => upsert(current, updated));
      setNotice(
        approvalAction === 'disable_job'
          ? 'Pause request submitted. The schedule remains active until a different authorised person approves it.'
          : approvalAction === 'reduce_retention'
            ? 'Retention reduction requested. Current retention stays in effect until a different authorised person approves it.'
            : 'Policy approval requested. A different authorised person must review it.',
      );
      setApprovalPolicy(undefined);
      setApprovalJustification('');
      setProposedDailyCopies('');
      setProposedMonthlyCopies('');
      setApprovalAction('modify_policy');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The approval request could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function activatePolicy(policy: BackupPolicy) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await activateBackupPolicy(
        sessionToken,
        policy.id,
        { expectedVersion: policy.version },
        crypto.randomUUID(),
      );
      setPolicies((current) => upsert(current, updated));
      setNotice('The approved backup schedule is active.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'The schedule could not be activated.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function resumePolicy(policy: BackupPolicy) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await resumeBackupPolicy(
        sessionToken,
        policy.id,
        { expectedVersion: policy.version },
        crypto.randomUUID(),
      );
      setPolicies((current) => upsert(current, updated));
      setNotice('The backup schedule has resumed.');
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'The schedule could not be resumed.',
      );
    } finally {
      setBusy(false);
    }
  }

  function closeApproval() {
    setApprovalPolicy(undefined);
    setApprovalJustification('');
    setProposedDailyCopies('');
    setProposedMonthlyCopies('');
    setApprovalAction('modify_policy');
  }

  function closeEditor() {
    onEditorOpenChange(false);
    onRecordEdit(undefined);
  }

  return (
    <>
      <section
        className={`backup-records${screen === 'policies' ? ' backup-policy-records' : ''}`}
        aria-live="polite"
      >
        <div className="backup-record-toolbar">
          <div>
            <strong>
              {screen === 'sources' ? translate('Protected sources') : translate('Backup policies')}
            </strong>
            <span>
              {screen === 'sources' ? sources.length : policies.length} {translate('records')}
            </span>
          </div>
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
        ) : screen === 'sources' ? (
          sources.length ? (
            <div className="backup-record-grid">
              {sources.map((source) => (
                <article className="backup-record-card" key={source.id}>
                  <div className="backup-record-card-heading">
                    <span className="backup-record-type">{translate(source.sourceType)}</span>
                    <span
                      className={`backup-classification backup-classification--${source.dataClassification}`}
                    >
                      {translate(source.dataClassification)}
                    </span>
                  </div>
                  <strong>{source.name}</strong>
                  <small>
                    {source.sourceCode} · {source.location}
                  </small>
                  <dl>
                    <div>
                      <dt>{translate('Owner')}</dt>
                      <dd>{source.ownerName ?? translate('Not assigned')}</dd>
                    </div>
                    <div>
                      <dt>{translate('At-source encryption')}</dt>
                      <dd>
                        {source.encryptedAtSource ? translate('Enabled') : translate('Not enabled')}
                      </dd>
                    </div>
                  </dl>
                  {canEdit && (
                    <button
                      className="backup-record-edit"
                      onClick={() => {
                        onRecordEdit(source);
                        onEditorOpenChange(true);
                      }}
                      type="button"
                    >
                      {translate('Edit')}
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="backup-record-placeholder">
              <h2>{translate('No protected sources yet')}</h2>
              <p>
                {translate(
                  'Add the Vista database and object storage first, then add other confirmed systems.',
                )}
              </p>
            </div>
          )
        ) : policies.length ? (
          <div className="backup-record-grid">
            {policies.map((policy) => (
              <article className="backup-record-card" key={policy.id}>
                <div className="backup-record-card-heading">
                  <span className="backup-record-type">{translate(policy.backupType)}</span>
                  <span className={`backup-policy-state backup-policy-state--${policy.status}`}>
                    {translate(policy.status)}
                  </span>
                </div>
                <strong>{policy.name}</strong>
                <small>
                  {policy.policyCode} · {translate(policy.frequency)} · {policy.rpoMinutes} /{' '}
                  {policy.rtoMinutes} min RPO/RTO
                </small>
                <div className="backup-policy-sources">
                  {policy.sources.map((source) => (
                    <span key={source.id}>{source.name}</span>
                  ))}
                </div>
                <p>
                  {translate('Retention')}: {policy.retentionDailyCopies} {translate('daily')} ·{' '}
                  {policy.retentionMonthlyCopies} {translate('monthly')}
                </p>
                {canEdit && policy.status === 'draft' && (
                  <div className="backup-record-actions">
                    <button
                      className="backup-record-edit"
                      onClick={() => {
                        onRecordEdit(policy);
                        onEditorOpenChange(true);
                      }}
                      type="button"
                    >
                      {translate('Edit draft')}
                    </button>
                    <button
                      className="backup-record-edit backup-record-edit--primary"
                      onClick={() => {
                        setApprovalPolicy(policy);
                        setApprovalAction('modify_policy');
                        setApprovalJustification('');
                        setError('');
                      }}
                      type="button"
                    >
                      {translate('Request approval')}
                    </button>
                  </div>
                )}
                {policy.status === 'pending_approval' && (
                  <p className="backup-policy-hint">
                    {translate('Waiting for second-person review.')}
                  </p>
                )}
                {policy.status === 'approved' && (
                  <div className="backup-record-actions">
                    <p className="backup-policy-hint">
                      {translate('Approved. Activate the schedule to begin database backups.')}
                    </p>
                    {canEdit && (
                      <button
                        className="backup-record-edit backup-record-edit--primary"
                        disabled={busy}
                        onClick={() => void activatePolicy(policy)}
                        type="button"
                      >
                        {translate('Activate schedule')}
                      </button>
                    )}
                  </div>
                )}
                {policy.status === 'active' && (
                  <>
                    <p className="backup-policy-hint">
                      {translate(
                        policy.pauseRequestPending
                          ? 'Pause request awaiting review. Scheduled backups continue until approval.'
                          : 'Schedule active. The first backup runs at its next scheduled time.',
                      )}
                    </p>
                    {policy.retentionReductionRequestPending && (
                      <p className="backup-policy-hint">
                        {translate(
                          'Retention reduction awaiting review. The current limits stay in effect until approval.',
                        )}
                      </p>
                    )}
                    {canEdit && (
                      <div className="backup-record-actions">
                        {!policy.pauseRequestPending && (
                          <button
                            className="backup-record-edit"
                            disabled={busy}
                            onClick={() => {
                              setApprovalPolicy(policy);
                              setApprovalAction('disable_job');
                              setApprovalJustification('');
                              setError('');
                            }}
                            type="button"
                          >
                            {translate('Request pause')}
                          </button>
                        )}
                        {!policy.retentionReductionRequestPending && (
                          <button
                            className="backup-record-edit"
                            disabled={busy}
                            onClick={() => requestLowerRetention(policy)}
                            type="button"
                          >
                            {translate('Request lower retention')}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
                {policy.status === 'paused' && (
                  <>
                    <p className="backup-policy-hint">
                      {translate('Schedule paused. No new backup runs will be started.')}
                    </p>
                    {policy.retentionReductionRequestPending && (
                      <p className="backup-policy-hint">
                        {translate(
                          'Retention reduction awaiting review. The current limits stay in effect until approval.',
                        )}
                      </p>
                    )}
                    {canEdit && (
                      <div className="backup-record-actions">
                        <button
                          className="backup-record-edit backup-record-edit--primary"
                          disabled={busy}
                          onClick={() => void resumePolicy(policy)}
                          type="button"
                        >
                          {translate('Resume schedule')}
                        </button>
                        {!policy.retentionReductionRequestPending && (
                          <button
                            className="backup-record-edit"
                            disabled={busy}
                            onClick={() => requestLowerRetention(policy)}
                            type="button"
                          >
                            {translate('Request lower retention')}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="backup-record-placeholder">
            <h2>{translate('No backup policies yet')}</h2>
            <p>
              {translate(
                'Create a draft schedule for each protection frequency. Drafts do not run until they are approved and activated.',
              )}
            </p>
          </div>
        )}
      </section>

      {editorOpen && (
        <div
          className="backup-drawer-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <form
            aria-label={
              screen === 'sources' ? translate('Protected source') : translate('Backup policy')
            }
            aria-modal="true"
            className={`backup-editor${screen === 'policies' ? ' backup-policy-editor' : ''}`}
            onSubmit={(event) => void save(event)}
            role="dialog"
          >
            <header className="backup-editor-header">
              <button className="backup-editor-back" onClick={closeEditor} type="button">
                ← {translate('Back')}
              </button>
              <button
                aria-label={translate('Close')}
                className="backup-editor-close"
                onClick={closeEditor}
                type="button"
              >
                ×
              </button>
              <h2>
                {screen === 'sources'
                  ? recordToEdit
                    ? translate('Edit protected source')
                    : translate('Add protected source')
                  : recordToEdit
                    ? translate('Edit draft policy')
                    : translate('Create draft policy')}
              </h2>
              <p>
                {screen === 'sources'
                  ? translate(
                      'Record what must be protected and where it is maintained. Do not enter passwords or access keys.',
                    )
                  : translate(
                      'Drafts use encrypted storage and verification. Approval is required before a policy can run.',
                    )}
              </p>
            </header>
            <div className="backup-editor-body">
              {screen === 'sources' ? (
                <SourceEditor
                  employees={referenceData.employees}
                  form={sourceForm}
                  onChange={setSourceForm}
                  translate={translate}
                />
              ) : (
                <PolicyEditor
                  form={policyForm}
                  onChange={setPolicyForm}
                  sources={sources}
                  translate={translate}
                />
              )}
              {error && (
                <p className="backup-inline-error" role="alert">
                  {translate(error)}
                </p>
              )}
            </div>
            <footer className="backup-editor-footer">
              <button className="backup-editor-cancel" onClick={closeEditor} type="button">
                {translate('Back')}
              </button>
              <button className="backup-editor-save" disabled={busy} type="submit">
                {busy
                  ? translate('Saving')
                  : translate(
                      recordToEdit
                        ? 'Save changes'
                        : screen === 'sources'
                          ? 'Add source'
                          : 'Save as draft',
                    )}
              </button>
            </footer>
          </form>
        </div>
      )}

      {approvalPolicy && (
        <div
          className="backup-drawer-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeApproval();
          }}
        >
          <form
            aria-label={translate(
              approvalAction === 'disable_job'
                ? 'Request schedule pause'
                : approvalAction === 'reduce_retention'
                  ? 'Request lower retention'
                  : 'Request policy approval',
            )}
            aria-modal="true"
            className="backup-editor backup-approval-editor"
            onSubmit={(event) => void submitApproval(event)}
            role="dialog"
          >
            <header className="backup-editor-header">
              <button className="backup-editor-back" onClick={closeApproval} type="button">
                ← {translate('Back')}
              </button>
              <button
                aria-label={translate('Close')}
                className="backup-editor-close"
                onClick={closeApproval}
                type="button"
              >
                ×
              </button>
              <h2>
                {translate(
                  approvalAction === 'disable_job'
                    ? 'Request schedule pause'
                    : approvalAction === 'reduce_retention'
                      ? 'Request lower retention'
                      : 'Request policy approval',
                )}
              </h2>
              <p>
                {approvalPolicy.policyCode} · {approvalPolicy.name}
              </p>
            </header>
            <div className="backup-editor-body">
              <fieldset className="backup-form-section">
                <legend>{translate('Review details')}</legend>
                <p className="backup-policy-hint">
                  {translate(
                    approvalAction === 'disable_job'
                      ? 'A different authorised person must approve this pause. Scheduled backups continue until approval; an in-progress run is not interrupted.'
                      : approvalAction === 'reduce_retention'
                        ? 'A different authorised person must approve a lower retention limit. Existing limits stay in effect until approval; run history remains available.'
                        : 'A different authorised person must review this request. Approval does not start backup execution.',
                  )}
                </p>
                {approvalAction === 'reduce_retention' && approvalPolicy && (
                  <>
                    <p className="backup-policy-hint">
                      {translate('Current retention')}: {approvalPolicy.retentionDailyCopies}{' '}
                      {translate('daily')} · {approvalPolicy.retentionMonthlyCopies}{' '}
                      {translate('monthly')}
                    </p>
                    <div className="backup-form-grid">
                      <Field label={translate('New daily copies')} required>
                        <input
                          max={approvalPolicy.retentionDailyCopies}
                          min={1}
                          onChange={(event) => setProposedDailyCopies(event.target.value)}
                          required
                          type="number"
                          value={proposedDailyCopies}
                        />
                      </Field>
                      <Field label={translate('New monthly copies')} required>
                        <input
                          max={approvalPolicy.retentionMonthlyCopies}
                          min={1}
                          onChange={(event) => setProposedMonthlyCopies(event.target.value)}
                          required
                          type="number"
                          value={proposedMonthlyCopies}
                        />
                      </Field>
                    </div>
                    <p className="backup-security-note">
                      {translate(
                        'Only older copies outside the approved limits can be removed. Their run history and audit evidence remain.',
                      )}
                    </p>
                  </>
                )}
                <Field
                  label={translate(
                    approvalAction === 'disable_job'
                      ? 'Reason for pausing'
                      : approvalAction === 'reduce_retention'
                        ? 'Reason for reducing retention'
                        : 'Reason for approval',
                  )}
                  required
                >
                  <textarea
                    maxLength={1000}
                    minLength={10}
                    onChange={(event) => setApprovalJustification(event.target.value)}
                    required
                    value={approvalJustification}
                  />
                </Field>
              </fieldset>
              {error && (
                <p className="backup-inline-error" role="alert">
                  {translate(error)}
                </p>
              )}
            </div>
            <footer className="backup-editor-footer">
              <button className="backup-editor-cancel" onClick={closeApproval} type="button">
                {translate('Back')}
              </button>
              <button
                className="backup-editor-save"
                disabled={
                  busy ||
                  approvalJustification.trim().length < 10 ||
                  (approvalAction === 'reduce_retention' && !validRetentionReduction)
                }
                type="submit"
              >
                {busy ? translate('Saving') : translate('Send for approval')}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}

function SourceEditor({
  employees,
  form,
  onChange,
  translate,
}: {
  employees: BackupReferenceData['employees'];
  form: SourceForm;
  onChange: (form: SourceForm) => void;
  translate: (value: string) => string;
}) {
  const set = <K extends keyof SourceForm>(key: K, value: SourceForm[K]) =>
    onChange({ ...form, [key]: value });
  const usesMountedPath = [
    'file',
    'file_share',
    'server',
    'workstation',
    'mobile_device',
    'other',
  ].includes(form.sourceType);
  const usesWebDav = form.sourceType === 'cloud_service';
  return (
    <>
      <fieldset className="backup-form-section">
        <legend>{translate('Source details')}</legend>
        <div className="backup-form-grid">
          <Field label="Source code" required>
            <input
              maxLength={80}
              onChange={(event) => set('sourceCode', event.target.value)}
              pattern="[A-Za-z0-9._-]+"
              required
              value={form.sourceCode}
            />
          </Field>
          <Field label="Name" required>
            <input
              maxLength={180}
              onChange={(event) => set('name', event.target.value)}
              required
              value={form.name}
            />
          </Field>
          <Field label="Source type" required>
            <select
              onChange={(event) => set('sourceType', event.target.value as BackupSourceType)}
              value={form.sourceType}
            >
              {sourceTypes.map((item) => (
                <option key={item} value={item}>
                  {translate(item)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data classification" required>
            <select
              onChange={(event) =>
                set('dataClassification', event.target.value as SourceForm['dataClassification'])
              }
              value={form.dataClassification}
            >
              {(['critical', 'important', 'standard'] as const).map((item) => (
                <option key={item} value={item}>
                  {translate(item)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={
              usesMountedPath
                ? 'Path under mounted read-only root'
                : form.sourceType === 'email'
                  ? 'IMAP server address'
                  : usesWebDav
                    ? 'Folder under WebDAV endpoint'
                    : 'Location / system'
            }
            required
          >
            <input
              aria-describedby={
                usesMountedPath
                  ? 'backup-source-location-help'
                  : form.sourceType === 'object_storage'
                    ? 'backup-source-object-storage-help'
                    : form.sourceType === 'email'
                      ? 'backup-source-email-help'
                      : usesWebDav
                        ? 'backup-source-webdav-help'
                        : undefined
              }
              aria-label={translate(
                usesMountedPath
                  ? 'Path under mounted read-only root'
                  : form.sourceType === 'email'
                    ? 'IMAP server address'
                    : usesWebDav
                      ? 'Folder under WebDAV endpoint'
                      : 'Location / system',
              )}
              maxLength={255}
              onChange={(event) => set('location', event.target.value)}
              placeholder={
                usesMountedPath
                  ? translate('e.g. finance or . for the whole root')
                  : form.sourceType === 'email'
                    ? translate('e.g. imaps://mail.example.com:993')
                    : usesWebDav
                      ? translate('e.g. Shared/Reports')
                      : undefined
              }
              required
              value={form.location}
            />
            {usesMountedPath && (
              <small id="backup-source-location-help">
                {translate(
                  'This path is relative to BACKUP_FILE_SOURCE_ROOT. Mount the source or its exported snapshot read-only in the API container. Live device and server snapshots must be created by the source system before this backup runs.',
                )}
              </small>
            )}
            {form.sourceType === 'object_storage' && (
              <small id="backup-source-object-storage-help">
                {translate(
                  "For Vista's own file bucket, the default source code is VISTA-FILES-01. For another S3-compatible bucket, enter its exact bucket name and map this source code to read-only credentials in the API deployment secrets.",
                )}
              </small>
            )}
            {form.sourceType === 'email' && (
              <small id="backup-source-email-help">
                {translate(
                  'Use the configured IMAP address. Mailbox names and credentials are kept in deployment secrets; choose only mailboxes approved for backup.',
                )}
              </small>
            )}
            {usesWebDav && (
              <small id="backup-source-webdav-help">
                {translate(
                  'Enter a folder beneath the configured WebDAV endpoint. Keep the endpoint and read-only credentials in deployment secrets; HTTPS is required outside local testing.',
                )}
              </small>
            )}
          </Field>
          <Field label="Estimated size (GiB)">
            <input
              inputMode="decimal"
              onChange={(event) => set('estimatedSizeGib', event.target.value)}
              pattern="\d{1,10}(\.\d{1,2})?"
              value={form.estimatedSizeGib}
            />
          </Field>
          <Field label="Annual growth (%)">
            <input
              inputMode="decimal"
              onChange={(event) => set('annualGrowthPercent', event.target.value)}
              pattern="\d{1,10}(\.\d{1,2})?"
              value={form.annualGrowthPercent}
            />
          </Field>
          <Field label="Owner">
            <select
              onChange={(event) => set('ownerEmployeeId', event.target.value)}
              value={form.ownerEmployeeId}
            >
              <option value="">{translate('Not assigned')}</option>
              {employees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data steward">
            <select
              onChange={(event) => set('dataStewardEmployeeId', event.target.value)}
              value={form.dataStewardEmployeeId}
            >
              <option value="">{translate('Not assigned')}</option>
              {employees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
      <fieldset className="backup-form-section">
        <legend>{translate('Recovery notes')}</legend>
        <Field label="Dependencies">
          <textarea
            maxLength={2000}
            onChange={(event) => set('dependencies', event.target.value)}
            value={form.dependencies}
          />
        </Field>
        <Field label="Restore prerequisites">
          <textarea
            maxLength={2000}
            onChange={(event) => set('restorePrerequisites', event.target.value)}
            value={form.restorePrerequisites}
          />
        </Field>
        <Field label="Credential vault / custody reference">
          <input
            maxLength={1000}
            onChange={(event) => set('credentialCustody', event.target.value)}
            value={form.credentialCustody}
          />
          <small>
            {translate(
              'Record only the approved vault or custodian reference. Never enter credentials here.',
            )}
          </small>
        </Field>
        <label className="backup-check-row">
          <input
            checked={form.encryptedAtSource}
            onChange={(event) => set('encryptedAtSource', event.target.checked)}
            type="checkbox"
          />
          {translate('Data is encrypted at its source')}
        </label>
      </fieldset>
    </>
  );
}

function PolicyEditor({
  form,
  onChange,
  sources,
  translate,
}: {
  form: PolicyForm;
  onChange: (form: PolicyForm) => void;
  sources: BackupProtectedSource[];
  translate: (value: string) => string;
}) {
  const set = <K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) =>
    onChange({ ...form, [key]: value });
  const selected = new Set(form.sourceIds);
  return (
    <>
      <fieldset className="backup-form-section">
        <legend>{translate('Schedule and targets')}</legend>
        <div className="backup-form-grid">
          <Field label="Policy code" required>
            <input
              maxLength={80}
              onChange={(event) => set('policyCode', event.target.value)}
              pattern="[A-Za-z0-9._-]+"
              required
              value={form.policyCode}
            />
          </Field>
          <Field label="Policy name" required>
            <input
              maxLength={180}
              onChange={(event) => set('name', event.target.value)}
              required
              value={form.name}
            />
          </Field>
          <Field label="Backup type">
            <select
              onChange={(event) =>
                set('backupType', event.target.value as BackupPolicy['backupType'])
              }
              value={form.backupType}
            >
              {(
                [
                  'database_snapshot',
                  'full',
                  'incremental',
                  'differential',
                  'system_image',
                ] as const
              ).map((item) => (
                <option key={item} value={item}>
                  {translate(item)}
                </option>
              ))}
            </select>
            {form.backupType === 'system_image' && (
              <small>
                {translate(
                  'Use a server, workstation, or mounted snapshot folder containing an exported disk image. Recovery creates an isolated image copy; writing it to replacement hardware is a separate recovery procedure.',
                )}
              </small>
            )}
          </Field>
          <Field label="Frequency">
            <select
              onChange={(event) =>
                set('frequency', event.target.value as BackupPolicy['frequency'])
              }
              value={form.frequency}
            >
              {(['hourly', 'daily', 'weekly', 'monthly'] as const).map((item) => (
                <option key={item} value={item}>
                  {translate(item)}
                </option>
              ))}
            </select>
          </Field>
          {form.frequency !== 'hourly' && (
            <Field label="Run time (Europe/Sofia)">
              <input
                onChange={(event) => set('runTimeLocal', event.target.value)}
                required
                type="time"
                value={form.runTimeLocal}
              />
            </Field>
          )}
          {form.frequency === 'weekly' && (
            <Field label="Day of week">
              <select
                onChange={(event) => set('dayOfWeek', event.target.value)}
                required
                value={form.dayOfWeek}
              >
                <option value="">{translate('Choose a day')}</option>
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                  (day, index) => (
                    <option key={day} value={index}>
                      {translate(day)}
                    </option>
                  ),
                )}
              </select>
            </Field>
          )}
          {form.frequency === 'monthly' && (
            <Field label="Day of month">
              <input
                max="28"
                min="1"
                onChange={(event) => set('dayOfMonth', event.target.value)}
                required
                type="number"
                value={form.dayOfMonth}
              />
            </Field>
          )}
          <Field label="RPO (minutes)">
            <input
              min="1"
              onChange={(event) => set('rpoMinutes', event.target.value)}
              required
              type="number"
              value={form.rpoMinutes}
            />
          </Field>
          <Field label="RTO (minutes)">
            <input
              min="1"
              onChange={(event) => set('rtoMinutes', event.target.value)}
              required
              type="number"
              value={form.rtoMinutes}
            />
          </Field>
          <Field label="Daily restore copies">
            <input
              min="1"
              onChange={(event) => set('retentionDailyCopies', event.target.value)}
              required
              type="number"
              value={form.retentionDailyCopies}
            />
          </Field>
          <Field label="Monthly restore copies">
            <input
              min="1"
              onChange={(event) => set('retentionMonthlyCopies', event.target.value)}
              required
              type="number"
              value={form.retentionMonthlyCopies}
            />
          </Field>
        </div>
        <label className="backup-check-row">
          <input
            checked={form.compressionEnabled}
            onChange={(event) => set('compressionEnabled', event.target.checked)}
            type="checkbox"
          />
          {translate('Compress backup copies')}
        </label>
        <p className="backup-security-note">
          {translate(
            'Encryption and verification are always required. This draft cannot run until separately approved.',
          )}
        </p>
      </fieldset>
      <fieldset className="backup-form-section">
        <legend>{translate('Protected sources')}</legend>
        {sources.length === 0 ? (
          <p>{translate('Add a protected source before creating a policy.')}</p>
        ) : (
          <div className="backup-source-check-list">
            {sources
              .filter((source) => source.status === 'active')
              .map((source) => (
                <label className="backup-source-check" key={source.id}>
                  <input
                    checked={selected.has(source.id)}
                    onChange={(event) =>
                      set(
                        'sourceIds',
                        event.target.checked
                          ? [...form.sourceIds, source.id]
                          : form.sourceIds.filter((id) => id !== source.id),
                      )
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{source.name}</strong>
                    <small>
                      {source.sourceCode} · {translate(source.dataClassification)}
                    </small>
                  </span>
                </label>
              ))}
          </div>
        )}
      </fieldset>
    </>
  );
}

function Field({
  children,
  label,
  required = false,
}: {
  children: React.ReactNode;
  label: string;
  required?: boolean;
}) {
  const { locale } = useLocalization();
  return (
    <label className="backup-form-field">
      <span>
        {locale === 'bg' ? bg(label) : label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}

function sourceToForm(source: BackupProtectedSource): SourceForm {
  return {
    annualGrowthPercent: source.annualGrowthPercent ?? '',
    credentialCustody: source.credentialCustody,
    dataClassification: source.dataClassification,
    dataStewardEmployeeId: source.dataStewardEmployeeId ?? '',
    dependencies: source.dependencies,
    encryptedAtSource: source.encryptedAtSource,
    estimatedSizeGib: source.estimatedSizeGib ?? '',
    location: source.location,
    name: source.name,
    ownerEmployeeId: source.ownerEmployeeId ?? '',
    restorePrerequisites: source.restorePrerequisites,
    sourceCode: source.sourceCode,
    sourceType: source.sourceType,
  };
}

function policyToForm(policy: BackupPolicy): PolicyForm {
  return {
    backupType: policy.backupType,
    compressionEnabled: policy.compressionEnabled,
    dayOfMonth: policy.dayOfMonth?.toString() ?? '',
    dayOfWeek: policy.dayOfWeek?.toString() ?? '',
    frequency: policy.frequency,
    name: policy.name,
    policyCode: policy.policyCode,
    retentionDailyCopies: policy.retentionDailyCopies.toString(),
    retentionMonthlyCopies: policy.retentionMonthlyCopies.toString(),
    rpoMinutes: policy.rpoMinutes.toString(),
    rtoMinutes: policy.rtoMinutes.toString(),
    runTimeLocal: policy.runTimeLocal ?? '',
    sourceIds: policy.sources.map((source) => source.id),
  };
}

function upsert<T extends { id: string }>(records: T[], item: T): T[] {
  const index = records.findIndex((record) => record.id === item.id);
  return index < 0
    ? [item, ...records]
    : records.map((record) => (record.id === item.id ? item : record));
}
