import type {
  ConfigureStockSettingsRequest,
  CreateStockReservationRequest,
  CreateWarehouseRequest,
  IssueStockRequest,
  OpenStocktakeRequest,
  ReceiveStockRequest,
  RecordStocktakeCountRequest,
  ReplenishmentStatus,
  ReturnStockRequest,
  SerialTraceability,
  StockBalance,
  StockIssue,
  StockReceipt,
  StockReservation,
  StockReturn,
  StockSettings,
  Stocktake,
  StockTransfer,
  TransferStockRequest,
  Warehouse,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function listWarehouses(token: string): Promise<Warehouse[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/warehouse/warehouses', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createWarehouse(
  token: string,
  idempotencyKey: string,
  input: CreateWarehouseRequest,
): Promise<Warehouse> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/warehouses', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function listStockBalances(token: string): Promise<StockBalance[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/warehouse/stock-balances', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listReplenishment(token: string): Promise<ReplenishmentStatus[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/warehouse/replenishment', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function configureStockSettings(
  token: string,
  idempotencyKey: string,
  input: ConfigureStockSettingsRequest,
): Promise<StockSettings> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stock-settings', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function receiveStock(
  token: string,
  idempotencyKey: string,
  input: ReceiveStockRequest,
): Promise<StockReceipt> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stock-receipts', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function issueStock(
  token: string,
  idempotencyKey: string,
  input: IssueStockRequest,
): Promise<StockIssue> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stock-issues', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function returnStock(
  token: string,
  idempotencyKey: string,
  input: ReturnStockRequest,
): Promise<StockReturn> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stock-returns', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function transferStock(
  token: string,
  idempotencyKey: string,
  input: TransferStockRequest,
): Promise<StockTransfer> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stock-transfers', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function openStocktake(
  token: string,
  idempotencyKey: string,
  input: OpenStocktakeRequest,
): Promise<Stocktake> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stocktakes', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function recordStocktakeCount(
  token: string,
  idempotencyKey: string,
  stocktakeId: string,
  input: RecordStocktakeCountRequest,
): Promise<Stocktake> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stocktakes/{id}/counts', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: stocktakeId },
      },
    }),
  );
}

export function completeStocktake(
  token: string,
  idempotencyKey: string,
  stocktakeId: string,
): Promise<Stocktake> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stocktakes/{id}/complete', {
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: stocktakeId },
      },
    }),
  );
}

export function createStockReservation(
  token: string,
  idempotencyKey: string,
  input: CreateStockReservationRequest,
): Promise<StockReservation> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stock-reservations', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function releaseStockReservation(
  token: string,
  idempotencyKey: string,
  reservationId: string,
): Promise<StockReservation> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/warehouse/stock-reservations/{id}/release', {
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: reservationId },
      },
    }),
  );
}

export function getSerialTraceability(
  token: string,
  serialNumber: string,
): Promise<SerialTraceability> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/warehouse/serial-traceability/{serialNumber}', {
      headers: authorizationHeaders(token),
      params: { path: { serialNumber } },
    }),
  );
}
