import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreatePosReportExportDto } from './pos-report-exports.dto.js';

describe('POS report export validation', () => {
  it('accepts period and shift report requests', async () => {
    expect(
      await validate(
        plainToInstance(CreatePosReportExportDto, {
          dateFrom: '2026-09-01',
          dateTo: '2026-09-03',
          definitionKey: 'pos.product-sales',
          format: 'xlsx',
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(CreatePosReportExportDto, {
          definitionKey: 'pos.x-report',
          format: 'pdf',
          shiftId: '11111111-1111-4111-8111-111111111111',
        }),
      ),
    ).toHaveLength(0);
  });

  it('rejects unsupported reports, file types, and malformed filters', async () => {
    const input = plainToInstance(CreatePosReportExportDto, {
      businessLocationId: 'not-a-uuid',
      dateFrom: 'not-a-date',
      definitionKey: 'pos.secret-report',
      format: 'docx',
    });
    expect(await validate(input)).toHaveLength(4);
  });
});
