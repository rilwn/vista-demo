import type {
  RecurringInvoiceContract,
  RecurringInvoicePage,
  RecurringInvoiceProcessResult,
  RecurringInvoiceProfileInput,
} from '@vista/contracts';
import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function listRecurringInvoices(
  token: string,
  page: number,
  search: string,
): Promise<RecurringInvoicePage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/recurring-invoices', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize: 20, search } },
    }),
  );
}
export function getRecurringInvoice(token: string, id: string): Promise<RecurringInvoiceContract> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/recurring-invoices/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}
export function saveRecurringInvoice(
  token: string,
  id: string,
  body: RecurringInvoiceProfileInput,
  key: string,
): Promise<RecurringInvoiceContract> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/finance/recurring-invoices/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id }, header: idempotencyParameters(key).header },
      body,
    }),
  );
}
export function runRecurringInvoice(
  token: string,
  id: string,
  key: string,
): Promise<RecurringInvoiceProcessResult> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/recurring-invoices/{id}/run', {
      headers: authorizationHeaders(token),
      params: { path: { id }, header: idempotencyParameters(key).header },
    }),
  );
}
