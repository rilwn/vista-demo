import type {
  CancelFinanceCustomerDocumentRequest,
  CreateFinanceCustomerDocumentRequest,
  CreateFinancePaymentRequest,
  FinanceCustomerDocument,
  FinanceReferenceData,
  FinanceSummary,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getFinanceReferenceData(token: string): Promise<FinanceReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/reference-data', { headers: authorizationHeaders(token) }),
  );
}

export function listFinanceDocuments(token: string): Promise<FinanceCustomerDocument[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/documents', { headers: authorizationHeaders(token) }),
  );
}

export function getFinanceSummary(token: string): Promise<FinanceSummary> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/summary', { headers: authorizationHeaders(token) }),
  );
}

export function createFinanceDocument(
  token: string,
  key: string,
  input: CreateFinanceCustomerDocumentRequest,
): Promise<FinanceCustomerDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/documents', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function recordFinancePayment(
  token: string,
  id: string,
  key: string,
  input: CreateFinancePaymentRequest,
): Promise<FinanceCustomerDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/documents/{id}/payments', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function cancelFinanceDocument(
  token: string,
  id: string,
  key: string,
  input: CancelFinanceCustomerDocumentRequest,
): Promise<FinanceCustomerDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/documents/{id}/cancel', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}
