import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BackupDrTest, BackupExecutionRun, BackupRestoreRequest } from '@vista/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as backupApi from './api/backup';
import { BackupDrTests } from './BackupDrTests';
import { LocalizationProvider } from './i18n/LocalizationProvider';

const originalWindowUrl = window.URL;

vi.mock('./api/backup', () => ({
  loadBackupDrTests: vi.fn(),
  loadBackupRestoreRequests: vi.fn(),
  loadBackupRuns: vi.fn(),
  planBackupDrTest: vi.fn(),
  recordBackupDrTest: vi.fn(),
  requestBackupRestore: vi.fn(),
  downloadBackupDrTestProtocol: vi.fn(),
  uploadBackupDrTestProtocol: vi.fn(),
}));

const run: BackupExecutionRun = {
  artifactAvailable: true,
  attemptCount: 1,
  backupType: 'database_snapshot',
  compressionAlgorithm: 'postgres_custom',
  id: '7a2ec5d0-6b01-49c7-ae11-2137281df13c',
  independentCopyStatus: 'not_configured',
  policyCode: 'VISTA-DB-HOURLY',
  policyName: 'Vista database hourly recovery',
  restoreAvailable: true,
  scheduledFor: '2026-10-27T10:00:00.000Z',
  sourceType: 'database',
  startedAt: '2026-10-27T10:00:03.000Z',
  status: 'verified',
  verificationAttemptCount: 1,
  verificationStatus: 'verified',
  verifiedAt: '2026-10-27T10:01:00.000Z',
};

const testRecord: BackupDrTest = {
  backupRunId: run.id,
  backupScheduledFor: run.scheduledFor,
  createdAt: '2026-10-27T12:00:00.000Z',
  createdByName: 'Backup Administrator',
  id: '6c663c5d-f722-49a3-a9d0-30348884f3d0',
  plannedFor: '2026-10-28T10:00:00.000Z',
  policyCode: run.policyCode,
  policyName: run.policyName,
  rpoTargetMinutes: 60,
  rtoTargetMinutes: 240,
  scope: 'Restore the Vista database and verify key customer records.',
  status: 'planned',
  testCode: 'DRT-2026-6C663C5D',
};

const restore: BackupRestoreRequest = {
  attemptCount: 1,
  completedAt: '2026-10-28T11:00:00.000Z',
  createdAt: '2026-10-28T10:00:00.000Z',
  id: 'dd94e9fa-4013-4bad-9bb3-0b14b3475961',
  policyCode: run.policyCode,
  policyName: run.policyName,
  reason: `DR test ${testRecord.testCode}: Perform the planned isolated recovery exercise.`,
  requestedBy: 'f80031ba-a506-4e5d-9a9a-f6bdacb8c08a',
  requestedByName: 'Backup Administrator',
  runId: run.id,
  scheduledFor: run.scheduledFor,
  sourceType: 'database',
  status: 'completed',
};

const recordedTest: BackupDrTest = {
  ...testRecord,
  actualRpoMinutes: 20,
  actualRtoMinutes: 90,
  completedAt: '2026-10-28T12:00:00.000Z',
  evidenceFileId: '68878d2b-87b7-4d57-b6b0-9b12f794c0a1',
  outcome: 'passed',
  protocolSignedAt: '2026-10-28T11:50:00.000Z',
  protocolSignedBy: 'Mila Backup',
  restoreRequestId: restore.id,
  rpoMet: true,
  rtoMet: true,
  resultSummary: 'Database and selected customer records were restored and checked.',
  status: 'recorded',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'URL', { configurable: true, value: originalWindowUrl });
});

describe('disaster-recovery test register', () => {
  beforeEach(() => {
    vi.mocked(backupApi.loadBackupDrTests).mockResolvedValue({ items: [testRecord], total: 1 });
    vi.mocked(backupApi.loadBackupRuns).mockResolvedValue({
      items: [run],
      page: 1,
      pageSize: 50,
      restoreAvailable: true,
      total: 1,
    });
    vi.mocked(backupApi.loadBackupRestoreRequests).mockResolvedValue({
      items: [restore],
      total: 1,
    });
    vi.mocked(backupApi.planBackupDrTest).mockResolvedValue(testRecord);
    vi.mocked(backupApi.recordBackupDrTest).mockResolvedValue({
      ...testRecord,
      actualRpoMinutes: 20,
      actualRtoMinutes: 90,
      completedAt: '2026-10-28T12:00:00.000Z',
      evidenceFileId: '68878d2b-87b7-4d57-b6b0-9b12f794c0a1',
      outcome: 'passed',
      protocolSignedAt: '2026-10-28T11:50:00.000Z',
      protocolSignedBy: 'Mila Backup',
      restoreRequestId: restore.id,
      rpoMet: true,
      rtoMet: true,
      resultSummary: 'Database and selected customer records were restored and checked.',
      status: 'recorded',
    });
    vi.mocked(backupApi.uploadBackupDrTestProtocol).mockResolvedValue({
      id: '68878d2b-87b7-4d57-b6b0-9b12f794c0a1',
      status: 'available',
    });
    vi.mocked(backupApi.downloadBackupDrTestProtocol).mockResolvedValue(
      new Blob(['signed protocol'], { type: 'application/pdf' }),
    );
    vi.stubGlobal('crypto', { randomUUID: () => 'test-idempotency-key' });
  });

  it('plans a test from a verified database restore point', async () => {
    const onPlanOpenChange = vi.fn();
    render(
      <LocalizationProvider>
        <BackupDrTests
          canCreate
          onPlanOpenChange={onPlanOpenChange}
          planOpen
          sessionToken="session"
        />
      </LocalizationProvider>,
    );

    fireEvent.change(await screen.findByLabelText('Verified database restore point *'), {
      target: { value: run.id },
    });
    fireEvent.change(screen.getByLabelText(/Test scope/), {
      target: { value: 'Restore the Vista database and verify key customer records.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Plan test' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Disaster-recovery test planned. Request its isolated restore when ready.',
    );
    expect(backupApi.planBackupDrTest).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({
        runId: run.id,
        scope: 'Restore the Vista database and verify key customer records.',
      }),
      'test-idempotency-key',
    );
    expect(onPlanOpenChange).toHaveBeenCalledWith(false);
  });

  it('records measured recovery results only with the attached signed protocol', async () => {
    vi.mocked(backupApi.loadBackupDrTests).mockResolvedValueOnce({
      items: [testRecord],
      total: 1,
    });
    vi.mocked(backupApi.loadBackupDrTests).mockResolvedValue({ items: [recordedTest], total: 1 });
    const createObjectURLSpy = vi.fn(() => 'blob:dr-test-protocol');
    const urlStub = Object.assign(class extends URL {}, {
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('URL', urlStub);
    Object.defineProperty(window, 'URL', { configurable: true, value: urlStub });
    const anchorClick = vi
      .spyOn(window.HTMLElement.prototype, 'click')
      .mockImplementation(() => {});
    render(
      <LocalizationProvider>
        <BackupDrTests
          canCreate
          onPlanOpenChange={vi.fn()}
          planOpen={false}
          sessionToken="session"
        />
      </LocalizationProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Record test result' }));
    fireEvent.change(screen.getByLabelText('Result summary *'), {
      target: { value: 'Database and selected customer records were restored and checked.' },
    });
    fireEvent.change(screen.getByLabelText('Signed by *'), { target: { value: 'Mila Backup' } });
    fireEvent.change(screen.getByLabelText(/Signed protocol PDF/), {
      target: {
        files: [
          new File(['signed test evidence'], 'restore-test.pdf', { type: 'application/pdf' }),
        ],
      },
    });
    fireEvent.submit(screen.getByRole('dialog'));

    expect((await screen.findByRole('status')).textContent).toContain(
      'The test result and signed protocol were recorded.',
    );
    expect(backupApi.uploadBackupDrTestProtocol).toHaveBeenCalledWith(
      'session',
      testRecord.id,
      expect.objectContaining({ name: 'restore-test.pdf', type: 'application/pdf' }),
      'test-idempotency-key',
    );
    expect(backupApi.recordBackupDrTest).toHaveBeenCalledWith(
      'session',
      testRecord.id,
      expect.objectContaining({
        actualRpoMinutes: 60,
        actualRtoMinutes: 240,
        evidenceFileId: '68878d2b-87b7-4d57-b6b0-9b12f794c0a1',
        protocolSignedBy: 'Mila Backup',
        restoreRequestId: restore.id,
      }),
      'test-idempotency-key',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Download signed protocol' }));
    expect(backupApi.downloadBackupDrTestProtocol).toHaveBeenCalledWith(
      'session',
      recordedTest.evidenceFileId,
    );
    await waitFor(() => {
      expect(anchorClick).toHaveBeenCalledOnce();
      expect(createObjectURLSpy).toHaveBeenCalledOnce();
    });
  });
});
