import { cleanup, render, screen } from '@testing-library/react';
import type { BackupDrTest, BackupPolicy, BackupProtectedSource } from '@vista/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as backupApi from './api/backup';
import { BackupOverviewReadiness } from './BackupOverviewReadiness';
import { LocalizationProvider } from './i18n/LocalizationProvider';

vi.mock('./api/backup', () => ({
  loadBackupDrTests: vi.fn(),
  loadBackupPolicies: vi.fn(),
  loadBackupSources: vi.fn(),
}));

const source: BackupProtectedSource = {
  createdAt: '2026-10-27T12:00:00.000Z',
  credentialCustody: '',
  dataClassification: 'critical',
  dependencies: '',
  encryptedAtSource: false,
  id: 'bc8555fa-f52b-4c4b-b846-98f96792e22c',
  location: 'Coolify PostgreSQL',
  name: 'Vista database',
  restorePrerequisites: '',
  sourceCode: 'VISTA-DB',
  sourceType: 'database',
  status: 'active',
  updatedAt: '2026-10-27T12:00:00.000Z',
  version: 1,
};

const policy: BackupPolicy = {
  backupType: 'database_snapshot',
  compressionEnabled: true,
  createdAt: '2026-10-27T12:00:00.000Z',
  encryptionRequired: true,
  frequency: 'hourly',
  id: 'c8d6d1c4-fef2-45f1-9cf8-1936bb397e61',
  name: 'Vista database hourly recovery',
  policyCode: 'VISTA-DB-HOURLY',
  retentionDailyCopies: 35,
  retentionMonthlyCopies: 12,
  rpoMinutes: 60,
  rtoMinutes: 240,
  sources: [{ id: source.id, name: source.name, sourceCode: source.sourceCode }],
  status: 'active',
  updatedAt: '2026-10-27T12:00:00.000Z',
  verificationRequired: true,
  version: 1,
};

const drTest: BackupDrTest = {
  actualRpoMinutes: 25,
  actualRtoMinutes: 90,
  backupRunId: '7a2ec5d0-6b01-49c7-ae11-2137281df13c',
  backupScheduledFor: '2026-10-27T10:00:00.000Z',
  completedAt: '2026-10-28T12:00:00.000Z',
  createdAt: '2026-10-27T12:00:00.000Z',
  createdByName: 'Backup Administrator',
  id: '6c663c5d-f722-49a3-a9d0-30348884f3d0',
  outcome: 'passed',
  plannedFor: '2026-10-28T10:00:00.000Z',
  policyCode: policy.policyCode,
  policyName: policy.name,
  protocolSignedAt: '2026-10-28T11:50:00.000Z',
  protocolSignedBy: 'Mila Backup',
  rpoMet: true,
  rpoTargetMinutes: 60,
  rtoMet: true,
  rtoTargetMinutes: 240,
  scope: 'Restore the Vista database and verify customer records.',
  status: 'recorded',
  testCode: 'DRT-2026-6C663C5D',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Recovery overview readiness', () => {
  beforeEach(() => {
    vi.mocked(backupApi.loadBackupSources).mockResolvedValue({
      items: [source],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    vi.mocked(backupApi.loadBackupPolicies).mockResolvedValue({
      items: [policy],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    vi.mocked(backupApi.loadBackupDrTests).mockResolvedValue({ items: [drTest], total: 1 });
  });

  it('shows actual source, policy, and latest signed recovery-test state', async () => {
    render(
      <LocalizationProvider>
        <BackupOverviewReadiness sessionToken="session" />
      </LocalizationProvider>,
    );

    expect(await screen.findByText('1 protected source')).toBeTruthy();
    expect(screen.getByText('1 policy')).toBeTruthy();
    expect(screen.getByText('Passed · 28 Oct 2026')).toBeTruthy();
    expect(screen.getByText('Measured RPO 25 minutes · Measured RTO 90 minutes')).toBeTruthy();
  });

  it('does not claim that sources, policies, or a signed restore test exist when registers are empty', async () => {
    vi.mocked(backupApi.loadBackupSources).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
    vi.mocked(backupApi.loadBackupPolicies).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
    });
    vi.mocked(backupApi.loadBackupDrTests).mockResolvedValue({ items: [], total: 0 });
    render(
      <LocalizationProvider>
        <BackupOverviewReadiness sessionToken="session" />
      </LocalizationProvider>,
    );

    expect(await screen.findByText('No protected sources registered')).toBeTruthy();
    expect(screen.getByText('No backup policies configured')).toBeTruthy();
    expect(screen.getByText('No signed restore test recorded')).toBeTruthy();
  });
});
