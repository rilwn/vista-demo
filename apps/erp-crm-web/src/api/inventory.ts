import type {
  ConfigureStockSettingsRequest,
  CreateStockReservationRequest,
  CreateWarehouseRequest,
  IssueStockRequest,
  OpenStocktakeRequest,
  ReceiveStockRequest,
  ReturnStockRequest,
  ReplenishmentStatus,
  SerialTraceability,
  StockBalance,
  StockIssue,
  StockReceipt,
  StockReturn,
  StockReservation,
  StockSettings,
  Stocktake,
  RecordStocktakeCountRequest,
  StockTransfer,
  TransferStockRequest,
  Warehouse,
} from '@vista/contracts';

import { apiRequest } from './client';

export function listWarehouses(token: string): Promise<Warehouse[]> {
  return apiRequest<Warehouse[]>('/warehouse/warehouses', { token });
}

export function createWarehouse(
  token: string,
  idempotencyKey: string,
  input: CreateWarehouseRequest,
): Promise<Warehouse> {
  return command('/warehouse/warehouses', token, idempotencyKey, input);
}

export function listStockBalances(token: string): Promise<StockBalance[]> {
  return apiRequest<StockBalance[]>('/warehouse/stock-balances', { token });
}

export function listReplenishment(token: string): Promise<ReplenishmentStatus[]> {
  return apiRequest<ReplenishmentStatus[]>('/warehouse/replenishment', { token });
}

export function configureStockSettings(
  token: string,
  idempotencyKey: string,
  input: ConfigureStockSettingsRequest,
): Promise<StockSettings> {
  return command('/warehouse/stock-settings', token, idempotencyKey, input);
}

export function receiveStock(
  token: string,
  idempotencyKey: string,
  input: ReceiveStockRequest,
): Promise<StockReceipt> {
  return command('/warehouse/stock-receipts', token, idempotencyKey, input);
}

export function issueStock(
  token: string,
  idempotencyKey: string,
  input: IssueStockRequest,
): Promise<StockIssue> {
  return command('/warehouse/stock-issues', token, idempotencyKey, input);
}

export function returnStock(
  token: string,
  idempotencyKey: string,
  input: ReturnStockRequest,
): Promise<StockReturn> {
  return command('/warehouse/stock-returns', token, idempotencyKey, input);
}

export function transferStock(
  token: string,
  idempotencyKey: string,
  input: TransferStockRequest,
): Promise<StockTransfer> {
  return command('/warehouse/stock-transfers', token, idempotencyKey, input);
}

export function openStocktake(
  token: string,
  idempotencyKey: string,
  input: OpenStocktakeRequest,
): Promise<Stocktake> {
  return command('/warehouse/stocktakes', token, idempotencyKey, input);
}

export function recordStocktakeCount(
  token: string,
  idempotencyKey: string,
  stocktakeId: string,
  input: RecordStocktakeCountRequest,
): Promise<Stocktake> {
  return command(
    `/warehouse/stocktakes/${encodeURIComponent(stocktakeId)}/counts`,
    token,
    idempotencyKey,
    input,
  );
}

export function completeStocktake(
  token: string,
  idempotencyKey: string,
  stocktakeId: string,
): Promise<Stocktake> {
  return command(
    `/warehouse/stocktakes/${encodeURIComponent(stocktakeId)}/complete`,
    token,
    idempotencyKey,
    {},
  );
}

export function createStockReservation(
  token: string,
  idempotencyKey: string,
  input: CreateStockReservationRequest,
): Promise<StockReservation> {
  return command('/warehouse/stock-reservations', token, idempotencyKey, input);
}

export function releaseStockReservation(
  token: string,
  idempotencyKey: string,
  reservationId: string,
): Promise<StockReservation> {
  return command(
    `/warehouse/stock-reservations/${encodeURIComponent(reservationId)}/release`,
    token,
    idempotencyKey,
    {},
  );
}

export function getSerialTraceability(token: string, serialNumber: string) {
  return apiRequest<SerialTraceability>(
    `/warehouse/serial-traceability/${encodeURIComponent(serialNumber)}`,
    { token },
  );
}

function command<T, TInput>(
  path: string,
  token: string,
  idempotencyKey: string,
  input: TInput,
): Promise<T> {
  return apiRequest<T>(path, {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
    token,
  });
}
