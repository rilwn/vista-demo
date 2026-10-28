import type {
  ApiErrorResponse,
  ConfirmPosFiscalSaleCancellationRequest,
  ConfirmPosFiscalDailyReportRequest,
  CreatePosDiscountAuthorizationRequest,
  CreatePosReportExportRequest,
  CreatePosReturnRequest,
  CreatePosSaleRequest,
  CreatePosFiscalDailyReportRequest,
  FailPosFiscalDailyReportRequest,
  ConfirmPosFiscalSaleReceiptRequest,
  ConfirmPosFiscalReturnRequest,
  EnrolPosLoyaltyRequest,
  FinancialDocument,
  ClosePosShiftRequest,
  OpenPosShiftRequest,
  PosBasketPricing,
  PosCatalogPage,
  PosCustomerOption,
  PosCustomerPaymentOptions,
  PosDiscountAuthorization,
  PosDatecsUnpLease,
  PosOfflineSyncEventResponse,
  PosFiscalSalePreparation,
  PosFiscalReturnPreparation,
  PosFiscalDailyReport,
  PosFiscalDailyReportActiveResponse,
  PosLoyaltyAccount,
  PosLoyaltyLedger,
  PosQuickAccess,
  PosReportDefinition,
  SavedPosReport,
  PosReportExport,
  PosReportExportPage,
  PosReportFilters,
  PosReportOverview,
  PosReportReferenceData,
  PosReturn,
  PosReturnPage,
  PosSale,
  PosSalePage,
  PosShift,
  PosTerminalContext,
  PricePosBasketRequest,
  PreparePosFiscalSaleRequest,
  ReservePosDatecsUnpLeaseRequest,
  ReportPosOfflineSyncEventRequest,
  PreparePosFiscalReturnRequest,
  ResolvePosFiscalReturnRequest,
  UpdatePosQuickAccessRequest,
} from '@vista/contracts';

import {
  ApiClientError,
  apiV1BaseUrl,
  authorizationHeaders,
  posApiClient,
  unwrapApiResponse,
} from './client';

export function getPosTerminalContext(token: string): Promise<PosTerminalContext> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/terminal-context', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function openPosShift(
  token: string,
  input: OpenPosShiftRequest,
  idempotencyKey: string,
): Promise<PosShift> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/shifts', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function closePosShift(
  token: string,
  id: string,
  input: ClosePosShiftRequest,
  idempotencyKey: string,
): Promise<PosShift> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/shifts/{id}/close', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: { 'Idempotency-Key': idempotencyKey },
        path: { id },
      },
    }),
  );
}

export function getPosCatalog(
  token: string,
  input: {
    customerPartnerId?: string;
    search?: string;
    shiftId: string;
  },
): Promise<PosCatalogPage> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/catalog', {
      headers: authorizationHeaders(token),
      params: {
        query: {
          page: 1,
          pageSize: 100,
          ...(input.customerPartnerId ? { customerPartnerId: input.customerPartnerId } : {}),
          ...(input.search ? { search: input.search } : {}),
          shiftId: input.shiftId,
        },
      },
    }),
  );
}

export function getPosCustomers(token: string, search?: string): Promise<PosCustomerOption[]> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/customers', {
      headers: authorizationHeaders(token),
      params: { query: search ? { search } : {} },
    }),
  );
}

export function getPosCustomerPaymentOptions(
  token: string,
  customerPartnerId: string,
): Promise<PosCustomerPaymentOptions> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/customers/{customerPartnerId}/payment-options', {
      headers: authorizationHeaders(token),
      params: { path: { customerPartnerId } },
    }),
  );
}

export function getPosQuickAccess(
  token: string,
  input: { customerPartnerId?: string; shiftId: string },
): Promise<PosQuickAccess> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/quick-access', {
      headers: authorizationHeaders(token),
      params: {
        query: {
          ...(input.customerPartnerId ? { customerPartnerId: input.customerPartnerId } : {}),
          shiftId: input.shiftId,
        },
      },
    }),
  );
}

export function updatePosQuickAccess(
  token: string,
  input: UpdatePosQuickAccessRequest,
): Promise<PosQuickAccess> {
  return unwrapApiResponse(
    posApiClient.PUT('/api/v1/pos/quick-access', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    }),
  );
}

export function pricePosBasket(
  token: string,
  input: PricePosBasketRequest,
): Promise<PosBasketPricing> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/baskets/price', {
      body: input,
      headers: authorizationHeaders(token),
    }),
  );
}

export function authorizePosDiscount(
  token: string,
  input: CreatePosDiscountAuthorizationRequest,
): Promise<PosDiscountAuthorization> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/discount-authorizations', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    }),
  );
}

export function enrolPosLoyalty(
  token: string,
  input: EnrolPosLoyaltyRequest,
): Promise<PosLoyaltyAccount> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/loyalty/accounts', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    }),
  );
}

export function getPosLoyaltyLedger(
  token: string,
  customerPartnerId: string,
): Promise<PosLoyaltyLedger> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/loyalty/customers/{customerPartnerId}', {
      headers: authorizationHeaders(token),
      params: { path: { customerPartnerId } },
    }),
  );
}

export function getPosReportReferenceData(token: string): Promise<PosReportReferenceData> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/reports/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function getPosReportOverview(
  token: string,
  filters: PosReportFilters,
): Promise<PosReportOverview> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/reports/overview', {
      headers: authorizationHeaders(token),
      params: { query: filters },
    }),
  );
}

export function getPosReportDefinitions(token: string): Promise<PosReportDefinition[]> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/report-exports/definitions', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function getPosReportExports(
  token: string,
  page = 1,
  pageSize = 20,
): Promise<PosReportExportPage> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/report-exports', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize } },
    }),
  );
}

export function createPosReportExport(
  token: string,
  input: CreatePosReportExportRequest,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<PosReportExport> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/report-exports', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function listSavedPosReports(token: string, page = 1) {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/saved-reports', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize: 20 } },
    }),
  );
}

export function savePosReport(token: string, input: SavedPosReport): Promise<SavedPosReport> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/saved-reports', {
      headers: authorizationHeaders(token),
      body: input,
    }),
  );
}

export function retryPosReportExport(token: string, id: string): Promise<PosReportExport> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/report-exports/{id}/retry', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export async function downloadPosReportExport(
  token: string,
  report: PosReportExport,
): Promise<Blob> {
  const response = await fetch(`${apiV1BaseUrl}/pos/report-exports/${report.id}/content`, {
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

export function completePosSale(
  token: string,
  input: CreatePosSaleRequest,
  idempotencyKey: string,
): Promise<PosSale> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/sales', {
      body: input,
      signal: AbortSignal.timeout(30000),
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function preparePosFiscalSale(
  token: string,
  input: PreparePosFiscalSaleRequest,
  idempotencyKey: string,
): Promise<PosFiscalSalePreparation> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-sales/preparations', {
      body: input,
      signal: AbortSignal.timeout(30000),
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function reservePosDatecsUnpLease(
  token: string,
  input: ReservePosDatecsUnpLeaseRequest,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<PosDatecsUnpLease> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-sales/unp-leases', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function reportPosOfflineSyncEvent(
  token: string,
  input: ReportPosOfflineSyncEventRequest,
): Promise<PosOfflineSyncEventResponse> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/offline-sync-events', {
      body: input,
      headers: authorizationHeaders(token),
    }),
  );
}

export function getActivePosFiscalSalePreparation(
  token: string,
  shiftId: string,
): Promise<PosFiscalSalePreparation | null> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/fiscal-sales/preparations/active', {
      headers: authorizationHeaders(token),
      params: { query: { shiftId } },
    }),
  );
}

export function preparePosFiscalDailyReport(
  token: string,
  input: CreatePosFiscalDailyReportRequest,
): Promise<PosFiscalDailyReport> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-daily-reports', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
    }),
  );
}

export function getActivePosFiscalDailyReport(
  token: string,
  shiftId: string,
): Promise<PosFiscalDailyReportActiveResponse> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/fiscal-daily-reports/active', {
      headers: authorizationHeaders(token),
      params: { query: { shiftId } },
    }),
  );
}

export function markPosFiscalDailyReportPrinting(
  token: string,
  reportId: string,
): Promise<PosFiscalDailyReport> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-daily-reports/{id}/printing', {
      headers: authorizationHeaders(token),
      params: {
        header: { 'Idempotency-Key': crypto.randomUUID() },
        path: { id: reportId },
      },
    }),
  );
}

export function markPosFiscalDailyReportUnknown(
  token: string,
  reportId: string,
): Promise<PosFiscalDailyReport> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-daily-reports/{id}/outcome-unknown', {
      headers: authorizationHeaders(token),
      params: {
        header: { 'Idempotency-Key': crypto.randomUUID() },
        path: { id: reportId },
      },
    }),
  );
}

export function confirmPosFiscalDailyReport(
  token: string,
  reportId: string,
  input: ConfirmPosFiscalDailyReportRequest,
): Promise<PosFiscalDailyReport> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-daily-reports/{id}/confirm', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: { 'Idempotency-Key': crypto.randomUUID() },
        path: { id: reportId },
      },
    }),
  );
}

export function rejectPosFiscalDailyReport(
  token: string,
  reportId: string,
  input: FailPosFiscalDailyReportRequest,
): Promise<PosFiscalDailyReport> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-daily-reports/{id}/reject', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: { 'Idempotency-Key': crypto.randomUUID() },
        path: { id: reportId },
      },
    }),
  );
}

export function markPosFiscalSalePrinting(
  token: string,
  preparationId: string,
  idempotencyKey: string,
): Promise<PosFiscalSalePreparation> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-sales/preparations/{id}/printing', {
      params: { path: { id: preparationId }, header: { 'Idempotency-Key': idempotencyKey } },
      headers: authorizationHeaders(token),
    }),
  );
}

export function markPosFiscalSaleOutcomeUnknown(
  token: string,
  preparationId: string,
  commandCode: number,
  idempotencyKey: string,
): Promise<PosFiscalSalePreparation> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-sales/preparations/{id}/outcome-unknown', {
      body: { commandCode },
      params: { path: { id: preparationId }, header: { 'Idempotency-Key': idempotencyKey } },
      headers: authorizationHeaders(token),
    }),
  );
}

export function cancelPosFiscalSalePreparation(
  token: string,
  preparationId: string,
  input: ConfirmPosFiscalSaleCancellationRequest,
  idempotencyKey: string,
): Promise<PosFiscalSalePreparation> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-sales/preparations/{id}/cancel', {
      body: input,
      params: { path: { id: preparationId }, header: { 'Idempotency-Key': idempotencyKey } },
      headers: authorizationHeaders(token),
    }),
  );
}

export function confirmPosFiscalSaleReceipt(
  token: string,
  preparationId: string,
  input: ConfirmPosFiscalSaleReceiptRequest,
  idempotencyKey: string,
): Promise<PosSale> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-sales/preparations/{id}/receipt', {
      body: input,
      signal: AbortSignal.timeout(30000),
      params: { path: { id: preparationId }, header: { 'Idempotency-Key': idempotencyKey } },
      headers: authorizationHeaders(token),
    }),
  );
}

export function finalizeConfirmedPosFiscalSale(
  token: string,
  preparationId: string,
): Promise<PosSale> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-sales/preparations/{id}/finalize', {
      params: { path: { id: preparationId } },
      signal: AbortSignal.timeout(30000),
      headers: authorizationHeaders(token),
    }),
  );
}

export function createPosReturn(
  token: string,
  input: CreatePosReturnRequest,
  idempotencyKey: string,
): Promise<PosReturn> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/returns', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function preparePosFiscalReturn(
  token: string,
  input: PreparePosFiscalReturnRequest,
  idempotencyKey: string,
): Promise<PosFiscalReturnPreparation> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-returns/preparations', {
      body: input,
      signal: AbortSignal.timeout(30000),
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function getActivePosFiscalReturnPreparation(
  token: string,
  shiftId: string,
): Promise<PosFiscalReturnPreparation | null> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/fiscal-returns/preparations/active', {
      headers: authorizationHeaders(token),
      params: { query: { shiftId } },
    }),
  );
}

export function markPosFiscalReturnPrinting(
  token: string,
  preparationId: string,
  idempotencyKey = crypto.randomUUID(),
): Promise<PosFiscalReturnPreparation> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-returns/preparations/{id}/printing', {
      headers: authorizationHeaders(token),
      params: { path: { id: preparationId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function markPosFiscalReturnUnknown(
  token: string,
  preparationId: string,
  idempotencyKey = crypto.randomUUID(),
): Promise<PosFiscalReturnPreparation> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-returns/preparations/{id}/outcome-unknown', {
      headers: authorizationHeaders(token),
      params: { path: { id: preparationId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function resolvePosFiscalReturn(
  token: string,
  preparationId: string,
  evidence: ResolvePosFiscalReturnRequest['evidence'],
  idempotencyKey = crypto.randomUUID(),
): Promise<PosFiscalReturnPreparation> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-returns/preparations/{id}/resolve', {
      body: { evidence },
      headers: authorizationHeaders(token),
      params: { path: { id: preparationId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function confirmPosFiscalReturn(
  token: string,
  preparationId: string,
  input: ConfirmPosFiscalReturnRequest,
  idempotencyKey = crypto.randomUUID(),
): Promise<PosReturn> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/fiscal-returns/preparations/{id}/confirm', {
      body: input,
      signal: AbortSignal.timeout(30000),
      headers: authorizationHeaders(token),
      params: { path: { id: preparationId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function getPosReturns(token: string): Promise<PosReturnPage> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/returns', {
      headers: authorizationHeaders(token),
      params: { query: { page: 1, pageSize: 50 } },
    }),
  );
}

export function getPosSales(token: string): Promise<PosSalePage> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/sales', {
      headers: authorizationHeaders(token),
      params: { query: { page: 1, pageSize: 50 } },
    }),
  );
}

export function getPosSale(token: string, saleId: string): Promise<PosSale> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/sales/{saleId}', {
      headers: authorizationHeaders(token),
      params: { path: { saleId } },
    }),
  );
}

export async function findPosCheckout(
  token: string,
  transactionId: string,
): Promise<PosSale | undefined> {
  const response = await fetch(
    `${apiV1BaseUrl}/pos/sales/by-transaction/${encodeURIComponent(transactionId)}`,
    {
      headers: authorizationHeaders(token),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (response.ok) return (await response.json()) as PosSale;
  const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
  if (response.status === 404 && body?.error.code === 'POS_SALE_NOT_FOUND') return undefined;
  throw new ApiClientError(
    body?.error.message ?? 'Unable to check this sale. Reconnect and try again.',
    body?.error.code ?? 'UNAVAILABLE',
    response.status,
  );
}

export function createPosInvoiceDraft(
  token: string,
  saleId: string,
  idempotencyKey: string,
): Promise<FinancialDocument> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/sales/{id}/invoice-draft', {
      headers: authorizationHeaders(token),
      params: {
        header: { 'Idempotency-Key': idempotencyKey },
        path: { id: saleId },
      },
    }),
  );
}

export async function downloadPosWarrantyCard(
  token: string,
  saleId: string,
  cardId: string,
): Promise<Blob> {
  const response = await fetch(
    `${apiV1BaseUrl}/pos/sales/${encodeURIComponent(saleId)}/warranty-cards/${encodeURIComponent(cardId)}/pdf`,
    { headers: authorizationHeaders(token) },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
    throw new ApiClientError(
      body?.error.message ?? 'The warranty card could not be downloaded.',
      body?.error.code ?? 'POS_WARRANTY_CARD_DOWNLOAD_FAILED',
      response.status,
      body?.error.correlationId,
      body?.error.details,
    );
  }
  return response.blob();
}
