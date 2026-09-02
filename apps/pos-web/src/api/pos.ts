import type {
  CreatePosCashSaleRequest,
  ClosePosShiftRequest,
  OpenPosShiftRequest,
  PosCatalogPage,
  PosCustomerOption,
  PosSale,
  PosSalePage,
  PosShift,
  PosTerminalContext,
} from '@vista/contracts';

import { authorizationHeaders, posApiClient, unwrapApiResponse } from './client';

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

export function completePosSale(
  token: string,
  input: CreatePosCashSaleRequest,
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

export function getPosSales(token: string): Promise<PosSalePage> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/pos/sales', {
      headers: authorizationHeaders(token),
      params: { query: { page: 1, pageSize: 50 } },
    }),
  );
}
