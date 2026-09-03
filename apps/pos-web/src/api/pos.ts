import type {
  ApiErrorResponse,
  CreatePosDiscountAuthorizationRequest,
  CreatePosReportExportRequest,
  CreatePosReturnRequest,
  CreatePosSaleRequest,
  EnrolPosLoyaltyRequest,
  ClosePosShiftRequest,
  OpenPosShiftRequest,
  PosBasketPricing,
  PosCatalogPage,
  PosCustomerOption,
  PosDiscountAuthorization,
  PosLoyaltyAccount,
  PosLoyaltyLedger,
  PosQuickAccess,
  PosReportDefinition,
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

export function getPosReportExports(token: string): Promise<PosReportExportPage> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/report-exports', {
      headers: authorizationHeaders(token),
      params: { query: { page: 1, pageSize: 20 } },
    }),
  );
}

export function createPosReportExport(
  token: string,
  input: CreatePosReportExportRequest,
): Promise<PosReportExport> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/pos/report-exports', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
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
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
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
