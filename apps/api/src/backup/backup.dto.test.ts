import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  PlanBackupDrTestDto,
  RecordBackupDrTestDto,
  RequestBackupRetentionReductionDto,
} from './backup.dto.js';

describe('backup disaster-recovery test DTOs', () => {
  it('accepts a test plan with a verified restore-point reference and scope', async () => {
    const input = plainToInstance(PlanBackupDrTestDto, {
      plannedFor: '2026-11-01T10:00:00.000Z',
      runId: '7a2ec5d0-6b01-49c7-ae11-2137281df13c',
      scope: 'Restore the Vista database and verify important customer records.',
    });

    await expect(validate(input)).resolves.toEqual([]);
  });

  it('rejects a malformed restore point, date and underspecified scope', async () => {
    const input = plainToInstance(PlanBackupDrTestDto, {
      plannedFor: 'not-a-date',
      runId: 'not-a-uuid',
      scope: 'short',
    });

    expect((await validate(input)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['plannedFor', 'runId', 'scope']),
    );
  });

  it('validates the measured result and signed protocol reference', async () => {
    const input = plainToInstance(RecordBackupDrTestDto, {
      actualRpoMinutes: '20',
      actualRtoMinutes: '90',
      evidenceFileId: '68878d2b-87b7-4d57-b6b0-9b12f794c0a1',
      protocolSignedAt: '2026-10-28T12:00:00.000Z',
      protocolSignedBy: 'Mila Backup',
      restoreRequestId: 'dd94e9fa-4013-4bad-9bb3-0b14b3475961',
      resultSummary: 'Database and customer records were restored and checked.',
    });

    await expect(validate(input)).resolves.toEqual([]);
    expect(input.actualRpoMinutes).toBe(20);
    expect(input.actualRtoMinutes).toBe(90);
  });

  it('rejects negative times and missing completion evidence identifiers', async () => {
    const input = plainToInstance(RecordBackupDrTestDto, {
      actualRpoMinutes: '-1',
      actualRtoMinutes: '90',
      evidenceFileId: 'not-a-uuid',
      protocolSignedAt: 'not-a-date',
      protocolSignedBy: '',
      restoreRequestId: 'not-a-uuid',
      resultSummary: 'ok',
    });

    expect((await validate(input)).map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'actualRpoMinutes',
        'evidenceFileId',
        'protocolSignedAt',
        'protocolSignedBy',
        'restoreRequestId',
        'resultSummary',
      ]),
    );
  });

  it('accepts whole-number retention reductions within supported limits', async () => {
    const input = plainToInstance(RequestBackupRetentionReductionDto, {
      expectedVersion: '4',
      justification: 'Reduce retained copies after reviewing recovery needs.',
      retentionDailyCopies: '30',
      retentionMonthlyCopies: '10',
    });

    await expect(validate(input)).resolves.toEqual([]);
    expect(input.retentionDailyCopies).toBe(30);
    expect(input.retentionMonthlyCopies).toBe(10);
  });

  it('rejects fractional, zero, and out-of-range retention counts', async () => {
    const input = plainToInstance(RequestBackupRetentionReductionDto, {
      expectedVersion: 4,
      justification: 'Reduce retained copies after reviewing recovery needs.',
      retentionDailyCopies: 0,
      retentionMonthlyCopies: 120.5,
    });

    expect((await validate(input)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['retentionDailyCopies', 'retentionMonthlyCopies']),
    );
  });
});
