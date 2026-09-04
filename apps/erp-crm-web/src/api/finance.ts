import type {
  ApiErrorResponse,
  CancelFinanceCustomerDocumentRequest,
  CancelFinanceCashVoucherRequest,
  CreateFinanceCustomerDocumentRequest,
  CreateCustomerAdvanceRequest,
  CreateFinanceBankStatementRequest,
  CreateFinanceCashVoucherRequest,
  CreateFinancePaymentRequest,
  FinanceBankMatchCandidate,
  FinanceBankStatement,
  FinanceBankStatementPage,
  FinanceCashDailyReport,
  FinanceCashReferenceData,
  FinanceCashVoucher,
  FinanceCashVoucherPage,
  FinanceCustomerDocument,
  CustomerAdvance,
  CustomerPaymentAccount,
  CustomerPaymentAccountReferenceData,
  UpsertCustomerPaymentTermsRequest,
  FinancialDocument,
  FinancialDocumentPage,
  FinancialDocumentReferenceData,
  FinanceReferenceData,
  FinanceAgingKind,
  FinanceAgingReport,
  FinanceJournalKind,
  FinanceJournalReport,
  FinanceSummary,
  FinanceTurnoverKind,
  FinanceTurnoverReport,
  FinanceVatReviewReport,
  CreateFinanceReportExportRequest,
  FinanceReportDefinition,
  FinanceReportExport,
  FinanceReportExportPage,
  AllocateFinanceSupplierAdvanceRequest,
  CreateFinanceSupplierAdvanceRequest,
  CreateFinanceSupplierOffsetRequest,
  CreateFinanceSupplierPayableRequest,
  CreateFinanceSupplierPaymentRequest,
  FinanceSupplierAdvancePage,
  FinanceSupplierBankMatchCandidate,
  FinanceSupplierOffset,
  FinanceSupplierOffsetPage,
  FinanceSupplierPayable,
  FinanceSupplierPayablePage,
  FinanceSupplierPayment,
  FinanceSupplierReferenceData,
  MatchFinanceSupplierBankTransactionRequest,
  MatchFinanceBankTransactionRequest,
  CancelFinancialDocumentRequest,
  CreateFinancialDocumentRequest,
} from '@vista/contracts';

import {
  ApiClientError,
  apiV1BaseUrl,
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getCustomerPaymentAccountReferenceData(
  token: string,
): Promise<CustomerPaymentAccountReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/customer-accounts/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listCustomerPaymentAccounts(token: string): Promise<CustomerPaymentAccount[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/customer-accounts', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function updateCustomerPaymentTerms(
  token: string,
  customerPartnerId: string,
  key: string,
  input: UpsertCustomerPaymentTermsRequest,
): Promise<CustomerPaymentAccount> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/finance/customer-accounts/{customerPartnerId}/terms', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { customerPartnerId },
      },
    }),
  );
}

export function createCustomerAdvance(
  token: string,
  key: string,
  input: CreateCustomerAdvanceRequest,
): Promise<CustomerAdvance> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/customer-accounts/advances', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

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

export function getFinanceAgingReport(
  token: string,
  kind: FinanceAgingKind,
  page = 1,
): Promise<FinanceAgingReport> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/reports/aging', {
      headers: authorizationHeaders(token),
      params: { query: { kind, page, pageSize: 50 } },
    }),
  );
}

export function getFinanceTurnoverReport(
  token: string,
  kind: FinanceTurnoverKind,
  dateFrom: string,
  dateTo: string,
  page = 1,
): Promise<FinanceTurnoverReport> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/reports/turnover', {
      headers: authorizationHeaders(token),
      params: { query: { dateFrom, dateTo, kind, page, pageSize: 50 } },
    }),
  );
}

export function getFinanceJournalReport(
  token: string,
  kind: FinanceJournalKind,
  dateFrom: string,
  dateTo: string,
  page = 1,
): Promise<FinanceJournalReport> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/reports/journal', {
      headers: authorizationHeaders(token),
      params: { query: { dateFrom, dateTo, kind, page, pageSize: 50 } },
    }),
  );
}

export function getFinanceVatReview(
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<FinanceVatReviewReport> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/reports/vat-review', {
      headers: authorizationHeaders(token),
      params: { query: { dateFrom, dateTo } },
    }),
  );
}

export function getFinanceReportDefinitions(token: string): Promise<FinanceReportDefinition[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/report-exports/definitions', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listFinanceReportExports(
  token: string,
  page = 1,
): Promise<FinanceReportExportPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/report-exports', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize: 20 } },
    }),
  );
}

export function createFinanceReportExport(
  token: string,
  key: string,
  input: CreateFinanceReportExportRequest,
): Promise<FinanceReportExport> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/report-exports', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function retryFinanceReportExport(token: string, id: string): Promise<FinanceReportExport> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/report-exports/{id}/retry', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export async function downloadFinanceReportExport(
  token: string,
  report: FinanceReportExport,
): Promise<Blob> {
  const response = await fetch(`${apiV1BaseUrl}/finance/report-exports/${report.id}/content`, {
    headers: authorizationHeaders(token),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
    throw new ApiClientError(
      body?.error.message ?? 'The report could not be downloaded.',
      body?.error.code ?? 'REPORT_DOWNLOAD_FAILED',
      response.status,
      body?.error.correlationId,
      body?.error.details,
    );
  }
  return response.blob();
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

export function getFinancialDocument(token: string, id: string): Promise<FinancialDocument> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/financial-documents/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
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

export function getFinanceCashReferenceData(token: string): Promise<FinanceCashReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/cash/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listFinanceCashVouchers(token: string): Promise<FinanceCashVoucherPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/cash/vouchers', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function getFinanceCashVoucher(token: string, id: string): Promise<FinanceCashVoucher> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/cash/vouchers/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function getFinanceCashDailyReport(
  token: string,
  cashRegisterId: string,
  date: string,
): Promise<FinanceCashDailyReport> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/cash/daily-report', {
      headers: authorizationHeaders(token),
      params: { query: { cashRegisterId, date } },
    }),
  );
}

export function createFinanceCashVoucher(
  token: string,
  key: string,
  input: CreateFinanceCashVoucherRequest,
): Promise<FinanceCashVoucher> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/cash/vouchers', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function cancelFinanceCashVoucher(
  token: string,
  id: string,
  key: string,
  input: CancelFinanceCashVoucherRequest,
): Promise<FinanceCashVoucher> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/cash/vouchers/{id}/cancel', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function getFinanceSupplierReferenceData(
  token: string,
): Promise<FinanceSupplierReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/supplier-reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listFinanceSupplierPayables(token: string): Promise<FinanceSupplierPayablePage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/supplier-payables', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function getFinanceSupplierPayable(
  token: string,
  id: string,
): Promise<FinanceSupplierPayable> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/supplier-payables/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function createFinanceSupplierPayable(
  token: string,
  key: string,
  input: CreateFinanceSupplierPayableRequest,
): Promise<FinanceSupplierPayable> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/supplier-payables', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function recordFinanceSupplierPayment(
  token: string,
  id: string,
  key: string,
  input: CreateFinanceSupplierPaymentRequest,
): Promise<FinanceSupplierPayable> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/supplier-payables/{id}/payments', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function listFinanceSupplierAdvances(token: string): Promise<FinanceSupplierAdvancePage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/supplier-advances', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createFinanceSupplierAdvance(
  token: string,
  key: string,
  input: CreateFinanceSupplierAdvanceRequest,
): Promise<FinanceSupplierPayment> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/supplier-advances', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function allocateFinanceSupplierAdvance(
  token: string,
  id: string,
  key: string,
  input: AllocateFinanceSupplierAdvanceRequest,
): Promise<FinanceSupplierPayment> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/supplier-advances/{id}/allocations', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function listFinanceSupplierOffsets(token: string): Promise<FinanceSupplierOffsetPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/supplier-offsets', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createFinanceSupplierOffset(
  token: string,
  key: string,
  input: CreateFinanceSupplierOffsetRequest,
): Promise<FinanceSupplierOffset> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/supplier-offsets', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function getFinanceSupplierBankMatchCandidates(
  token: string,
  id: string,
): Promise<FinanceSupplierBankMatchCandidate[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/bank-transactions/{id}/supplier-match-candidates', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function matchFinanceSupplierBankTransaction(
  token: string,
  id: string,
  key: string,
  input: MatchFinanceSupplierBankTransactionRequest,
): Promise<FinanceSupplierPayment> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/bank-transactions/{id}/supplier-match', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}
