import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateCrmReportExportDto } from '../jobs/crm-report-exports.dto.js';
import { CrmAnalyticsQueryDto } from './crm-analytics.dto.js';

describe('CRM analytics DTOs', () => {
  it('accepts a complete reporting window and controlled export request', async () => {
    const query = plainToInstance(CrmAnalyticsQueryDto, {
      dateFrom: '2026-01-01',
      dateTo: '2026-09-02',
    });
    const report = plainToInstance(CreateCrmReportExportDto, {
      dateFrom: '2026-01-01',
      dateTo: '2026-09-02',
      definitionKey: 'crm.customer-value',
      format: 'xlsx',
    });

    await expect(Promise.all([validate(query), validate(report)])).resolves.toEqual([[], []]);
  });

  it('rejects malformed dates, unknown reports, and unsupported file types', async () => {
    const query = plainToInstance(CrmAnalyticsQueryDto, {
      dateFrom: 'not-a-date',
      dateTo: '2026-02-30',
    });
    const report = plainToInstance(CreateCrmReportExportDto, {
      dateFrom: 'not-a-date',
      dateTo: '',
      definitionKey: 'crm.arbitrary-sql',
      format: 'docx',
    });

    expect((await validate(query)).map((error) => error.property)).toEqual(['dateFrom', 'dateTo']);
    expect((await validate(report)).map((error) => error.property)).toEqual(
      expect.arrayContaining(['dateFrom', 'dateTo', 'definitionKey', 'format']),
    );
  });
});
