import type {
  ApiErrorResponse,
  CancelFinanceCustomerDocumentRequest,
  AllocateCustomerAdvanceRequest,
  ApplyCustomerAdvanceToPosSaleRequest,
  CancelFinanceCashVoucherRequest,
  CreateFinanceCustomerDocumentRequest,
  CreateCustomerAdvanceRequest,
  CreatePosAccountPaymentRequest,
  ReversePosAccountPaymentRequest,
  CreatePosAccountRefundRequest,
  CreateFinanceBankStatementRequest,
  CreateFinanceCashVoucherRequest,
  CreateFinancePaymentRequest,
  ReverseFinancePaymentRequest,
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
  CustomerPaymentStatusPage,
  CustomerPaymentStatusQuery,
  UpsertCustomerPaymentTermsRequest,
  FinancialDocument,
  FinancialDocumentPage,
  FinancialDocumentReferenceData,
  FinanceExchangeRate,
  SalesResolvedPrice,
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
  IssueFinancialDocumentRequest,
  QueuedEmailReceipt,
  SendDocumentEmailRequest,
} from '@vista/contracts';

import {
  ApiClientError,
  apiV1BaseUrl,
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function resolveFinancialDocumentPrice(
  token: string,
  input: { asOf: string; currencyCode: string; customerPartnerId: string; productId: string },
): Promise<SalesResolvedPrice> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/financial-documents/prices/resolve', {
      headers: authorizationHeaders(token),
      params: { query: input },
    }),
  );
}

export function preparePosReturnCreditNote(
  token: string,
  returnId: string,
  key: string,
): Promise<FinancialDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/financial-documents/from-pos-return/{returnId}', {
      headers: authorizationHeaders(token),
      params: { path: { returnId }, header: idempotencyParameters(key).header },
    }),
  );
}
export function recordPosAccountRefund(
  token: string,
  customerPartnerId: string,
  saleId: string,
  returnId: string,
  key: string,
  input: CreatePosAccountRefundRequest,
): Promise<CustomerPaymentAccount> {
  return unwrapApiResponse(
    apiClient.POST(
      '/api/v1/finance/customer-accounts/{customerPartnerId}/pos-sales/{saleId}/returns/{returnId}/refunds',
      {
        body: input,
        headers: authorizationHeaders(token),
        params: {
          path: { customerPartnerId, saleId, returnId },
          header: idempotencyParameters(key).header,
        },
      },
    ),
  );
}

export function collectPosAccountPayment(
  token: string,
  customerPartnerId: string,
  saleId: string,
  key: string,
  input: CreatePosAccountPaymentRequest,
): Promise<CustomerPaymentAccount> {
  return unwrapApiResponse(
    apiClient.POST(
      '/api/v1/finance/customer-accounts/{customerPartnerId}/pos-sales/{saleId}/payments',
      {
        body: input,
        headers: authorizationHeaders(token),
        params: { path: { customerPartnerId, saleId }, header: idempotencyParameters(key).header },
      },
    ),
  );
}
export function reversePosAccountPayment(
  token: string,
  customerPartnerId: string,
  saleId: string,
  paymentId: string,
  key: string,
  input: ReversePosAccountPaymentRequest,
): Promise<CustomerPaymentAccount> {
  return unwrapApiResponse(
    apiClient.POST(
      '/api/v1/finance/customer-accounts/{customerPartnerId}/pos-sales/{saleId}/payments/{paymentId}/reverse',
      {
        body: input,
        headers: authorizationHeaders(token),
        params: {
          path: { customerPartnerId, saleId, paymentId },
          header: idempotencyParameters(key).header,
        },
      },
    ),
  );
}

export function getCustomerPaymentAccountReferenceData(
  token: string,
): Promise<CustomerPaymentAccountReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/customer-accounts/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function getCustomerPaymentAccount(
  token: string,
  customerPartnerId: string,
): Promise<CustomerPaymentAccount> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/customer-accounts/{customerPartnerId}', {
      headers: authorizationHeaders(token),
      params: { path: { customerPartnerId } },
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

export function listCustomerPaymentStatus(
  token: string,
  query: CustomerPaymentStatusQuery = {},
): Promise<CustomerPaymentStatusPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/customer-accounts/payment-status', {
      headers: authorizationHeaders(token),
      params: {
        query: {
          ...(query.page !== undefined ? { page: query.page } : {}),
          ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
          ...(query.search ? { search: query.search } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
      },
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

export function searchFinanceDocuments(
  token: string,
  search: string,
): Promise<FinanceCustomerDocument[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/documents/search', {
      headers: authorizationHeaders(token),
      params: { query: { search } },
    }),
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
  pageSize = 20,
): Promise<FinanceReportExportPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/report-exports', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize } },
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

export function reverseFinancePayment(
  token: string,
  documentId: string,
  paymentId: string,
  key: string,
  input: ReverseFinancePaymentRequest,
): Promise<FinanceCustomerDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/documents/{id}/payments/{paymentId}/reverse', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { id: documentId, paymentId },
      },
    }),
  );
}

export function allocateCustomerAdvance(
  token: string,
  documentId: string,
  key: string,
  input: AllocateCustomerAdvanceRequest,
): Promise<FinanceCustomerDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/documents/{id}/advance-allocations', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id: documentId } },
    }),
  );
}

export function applyCustomerAdvanceToPosSale(
  token: string,
  customerPartnerId: string,
  saleId: string,
  key: string,
  input: ApplyCustomerAdvanceToPosSaleRequest,
): Promise<CustomerPaymentAccount> {
  return unwrapApiResponse(
    apiClient.POST(
      '/api/v1/finance/customer-accounts/{customerPartnerId}/pos-sales/{saleId}/advance-allocations',
      {
        body: input,
        headers: authorizationHeaders(token),
        params: {
          header: idempotencyParameters(key).header,
          path: { customerPartnerId, saleId },
        },
      },
    ),
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

export function getFinancialDocumentExchangeRate(
  token: string,
  query: { currencyCode: string; rateDate: string },
): Promise<FinanceExchangeRate> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/financial-documents/exchange-rate', {
      headers: authorizationHeaders(token),
      params: { query },
    }),
  );
}

export function listFinancialDocuments(
  token: string,
  query: { page?: number; pageSize?: number; search?: string } = {},
): Promise<FinancialDocumentPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/financial-documents', {
      headers: authorizationHeaders(token),
      params: { query },
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

export async function downloadFinancialDocumentPdf(token: string, id: string): Promise<Blob> {
  const response = await fetch(`${apiV1BaseUrl}/finance/financial-documents/${id}/pdf`, {
    headers: authorizationHeaders(token),
  });
  if (!response.ok)
    throw new ApiClientError(
      'The financial document PDF could not be downloaded.',
      'FINANCE_DOCUMENT_PDF_DOWNLOAD_FAILED',
      response.status,
    );
  return response.blob();
}

export async function sendFinancialDocumentEmail(
  token: string,
  id: string,
  key: string,
  input: SendDocumentEmailRequest,
): Promise<QueuedEmailReceipt> {
  const response = await fetch(`${apiV1BaseUrl}/finance/financial-documents/${id}/email`, {
    body: JSON.stringify(input),
    headers: {
      ...authorizationHeaders(token),
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    method: 'POST',
  });
  if (!response.ok)
    throw new ApiClientError(
      'The financial document email could not be queued.',
      'FINANCE_DOCUMENT_EMAIL_FAILED',
      response.status,
    );
  return response.json() as Promise<QueuedEmailReceipt>;
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

export function collectFinancialDocument(
  token: string,
  id: string,
  key: string,
  input: IssueFinancialDocumentRequest,
): Promise<FinancialDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/financial-documents/{id}/collection', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function issueFinancialDocument(
  token: string,
  id: string,
  key: string,
  input: IssueFinancialDocumentRequest,
): Promise<FinancialDocument> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/financial-documents/{id}/issue', {
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
