import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { fixtureId } from '../database/development-fixtures.js';
import { CreateFinancialDocumentDto } from './financial-documents.dto.js';

describe('CreateFinancialDocumentDto', () => {
  it('accepts stable PostgreSQL UUID references returned by development fixtures', async () => {
    const input = plainToInstance(CreateFinancialDocumentDto, {
      businessLocationId: fixtureId('organization:location'),
      cashRegisterId: fixtureId('organization:cash-register'),
      currencyCode: 'BGN',
      customerPartnerId: fixtureId('partner:alfa'),
      documentType: 'invoice',
      dueDate: '2026-09-02',
      exchangeRate: '1.00000000',
      issueDate: '2026-08-19',
      legalEntityId: fixtureId('organization:entity'),
      notes: 'Prepared from the completed Sales flow.',
      operatorId: fixtureId('organization:operator:manager'),
      rateDate: '2026-08-19',
      rateSource: 'BGN base currency',
      sourceSalesInvoiceId: fixtureId('sales-invoice:completed'),
      taxEventDate: '2026-08-19',
    });

    expect(await validate(input)).toEqual([]);
  });

  it('still rejects malformed document references', async () => {
    const input = plainToInstance(CreateFinancialDocumentDto, {
      businessLocationId: 'not-a-uuid',
      currencyCode: 'BGN',
      customerPartnerId: fixtureId('partner:alfa'),
      documentType: 'invoice',
      exchangeRate: '1.00000000',
      issueDate: '2026-08-19',
      legalEntityId: fixtureId('organization:entity'),
      rateDate: '2026-08-19',
      rateSource: 'BGN base currency',
      taxEventDate: '2026-08-19',
    });

    const errors = await validate(input);
    expect(errors.some(({ property }) => property === 'businessLocationId')).toBe(true);
  });
});
