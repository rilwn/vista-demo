import { describe, expect, it, vi } from 'vitest';

import { CustomerOverviewService } from './customer-overview.service.js';

const partnerId = 'b535ef98-6390-4980-b440-ea41f6cb94c4';
const invoiceId = '4d858c55-2579-4ed0-b0bd-91152013c987';

describe('CustomerOverviewService', () => {
  it('combines canonical partner, equipment, sales, document, and payment records', async () => {
    const profile = {
      addresses: [],
      bankAccounts: [],
      contacts: [],
      partner: {
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        displayName: 'Alfa Market Demo Ltd.',
        id: partnerId,
        kind: 'legal_entity' as const,
        roles: ['customer' as const],
        updatedAt: '2026-09-02T08:00:00.000Z',
        version: 1,
      },
    };
    const locations = [
      {
        equipment: [
          {
            active: true,
            customerLocationId: '3991eb4c-5257-4982-ae65-7c5cd2f81977',
            deviceName: 'Demo Fiscal Register X1',
            id: 'a84fc2ec-1fdd-41f8-820e-c41bf570086b',
            purchaseDate: '2026-08-01',
            serialNumber: 'DEMO-FR-01',
            status: 'active' as const,
            version: 1,
            warrantyStartsOn: '2026-08-01',
          },
        ],
        location: {
          active: true,
          addressLine1: '1 Demo Street',
          city: 'Vratsa',
          countryCode: 'BG',
          id: '3991eb4c-5257-4982-ae65-7c5cd2f81977',
          locationType: 'Store',
          name: 'Central Store',
          partnerId,
          version: 1,
        },
      },
    ];
    const query = vi.fn((sql: string, parameters: unknown[]) => {
      if (sql.includes('FROM sales.invoice_lines')) {
        expect(parameters).toEqual([[invoiceId]]);
        return Promise.resolve({
          rows: [
            {
              purchase_id: invoiceId,
              line_total: '50.0000',
              product_id: '37cfc92b-9a78-4340-a30f-487ca375bb72',
              product_name: 'Demo 12 V Power Adapter',
              quantity: '1.0000',
              unit_price: '50.0000',
            },
          ],
        });
      }
      expect(parameters[0]).toBe(partnerId);
      if (sql.includes('AS financial_documents')) {
        return Promise.resolve({
          rows: [
            {
              financial_documents: '1',
              last_purchase_at: '2026-08-25T12:00:00.000Z',
              open_receivables: '1',
              outstanding_bgn: '40.0000',
              payments: '1',
              purchases: '1',
            },
          ],
        });
      }
      if (sql.includes('FROM finance.financial_documents')) {
        expect(parameters[1]).toBe(12);
        return Promise.resolve({
          rows: [
            {
              bgn_gross_total: '60.0000',
              currency_code: 'BGN',
              document_type: 'invoice',
              draft_number: 'DINV-2026-000001',
              due_date: '2026-09-08',
              gross_total: '60.0000',
              id: 'cbd78dca-c987-4fa2-a64d-a1dd83ba5c79',
              issue_date: '2026-08-25',
              official_number: null,
              source_sales_invoice_id: invoiceId,
              status: 'draft',
            },
          ],
        });
      }
      if (sql.includes('FROM finance.customer_documents')) {
        return Promise.resolve({
          rows: [
            {
              allocated_total: '20.0000',
              bgn_total: '60.0000',
              currency_code: 'BGN',
              document_date: '2026-08-25',
              document_number: 'FIN-REV-2026-000001',
              due_date: '2026-09-08',
              id: '7ea2517a-1168-468f-9851-e74b8d884aa4',
              outstanding_total: '40.0000',
              payment_status: 'partially_paid',
              source_sales_invoice_id: invoiceId,
              total: '60.0000',
            },
          ],
        });
      }
      if (sql.includes('FROM finance.payments')) {
        return Promise.resolve({
          rows: [
            {
              amount: '20.0000',
              currency_code: 'BGN',
              id: 'c3603397-2627-47a4-a104-fb8a14ca2b2d',
              payment_date: '2026-08-26',
              payment_method: 'bank_transfer',
              payment_number: 'PAY-2026-000001',
              payment_reference: 'FIN-REV-2026-000001',
              recorded_at: '2026-08-26T09:00:00.000Z',
            },
          ],
        });
      }
      if (sql.includes('FROM sales.invoices invoice')) {
        return Promise.resolve({
          rows: [
            {
              currency_code: 'BGN',
              id: invoiceId,
              number: 'DEV-INV-DRAFT-0001',
              recorded_at: '2026-08-25T12:00:00.000Z',
              source: 'erp_sales',
              source_shipment_id: '6ee1d759-5832-48f1-8743-d412624221b4',
              total: '60.0000',
            },
          ],
        });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = new CustomerOverviewService(
      { getPool: () => ({ query }) } as never,
      { getProfile: vi.fn().mockResolvedValue(profile) } as never,
      { list: vi.fn().mockResolvedValue(locations) } as never,
    );

    const result = await service.get(partnerId, 12);

    expect(result.profile).toEqual(profile);
    expect(result.summary).toEqual({
      activeEquipment: 1,
      activeLocations: 1,
      financialDocuments: 1,
      lastPurchaseAt: '2026-08-25T12:00:00.000Z',
      openReceivables: 1,
      outstandingBgn: '40.0000',
      payments: 1,
      purchases: 1,
    });
    expect(result.purchases[0]).toMatchObject({
      lines: [{ productName: 'Demo 12 V Power Adapter' }],
      number: 'DEV-INV-DRAFT-0001',
      source: 'erp_sales',
    });
    expect(result.financialDocuments[0]).not.toHaveProperty('officialNumber');
    expect(result.receivables[0]).toMatchObject({
      number: 'FIN-REV-2026-000001',
      paymentStatus: 'partially_paid',
    });
    expect(result.payments[0]).toMatchObject({
      number: 'PAY-2026-000001',
      paymentReference: 'FIN-REV-2026-000001',
    });
  });

  it('does not run a line query when the customer has no purchase history', async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes('AS financial_documents')) {
        return Promise.resolve({
          rows: [
            {
              financial_documents: '0',
              last_purchase_at: null,
              open_receivables: '0',
              outstanding_bgn: '0',
              payments: '0',
              purchases: '0',
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = new CustomerOverviewService(
      { getPool: () => ({ query }) } as never,
      { getProfile: vi.fn().mockResolvedValue({}) } as never,
      { list: vi.fn().mockResolvedValue([]) } as never,
    );

    const result = await service.get(partnerId, 10);

    expect(result.purchases).toEqual([]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('sales.invoice_lines'))).toBe(
      false,
    );
  });
});
