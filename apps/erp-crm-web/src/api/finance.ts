import type {
  CancelFinanceCustomerDocumentRequest,
  CreateFinanceCustomerDocumentRequest,
  CreateFinanceBankStatementRequest,
  CreateFinancePaymentRequest,
  FinanceBankMatchCandidate,
  FinanceBankStatement,
  FinanceBankStatementPage,
  FinanceCustomerDocument,
  FinancialDocument,
  FinancialDocumentPage,
  FinancialDocumentReferenceData,
  FinanceReferenceData,
  FinanceSummary,
  MatchFinanceBankTransactionRequest,
  CancelFinancialDocumentRequest,
  CreateFinancialDocumentRequest,
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

export function getFinancialDocumentReferenceData(
  token: string,
): Promise<FinancialDocumentReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/financial-documents/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listFinancialDocuments(token: string): Promise<FinancialDocumentPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/financial-documents', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createFinancialDocument(
  token: string,
  key: string,
  input: CreateFinancialDocumentRequest,
): Promise<FinancialDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/financial-documents', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function cancelFinancialDocument(
  token: string,
  id: string,
  key: string,
  input: CancelFinancialDocumentRequest,
): Promise<FinancialDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/financial-documents/{id}/cancel', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function listFinanceBankStatements(token: string): Promise<FinanceBankStatementPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/bank-statements', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function getFinanceBankStatement(token: string, id: string): Promise<FinanceBankStatement> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/bank-statements/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function createFinanceBankStatement(
  token: string,
  key: string,
  input: CreateFinanceBankStatementRequest,
): Promise<FinanceBankStatement> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/bank-statements', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function getFinanceBankMatchCandidates(
  token: string,
  id: string,
): Promise<FinanceBankMatchCandidate[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/bank-transactions/{id}/match-candidates', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function matchFinanceBankTransaction(
  token: string,
  id: string,
  key: string,
  input: MatchFinanceBankTransactionRequest,
): Promise<FinanceBankStatement> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/bank-transactions/{id}/match', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}
