import type {
  CreateProductRequest,
  CreateUnitRequest,
  ProductSummary,
  Unit,
} from '@vista/contracts';

import { apiRequest } from './client';

export function listUnits(token: string): Promise<Unit[]> {
  return apiRequest<Unit[]>('/master-data/catalog/units', { token });
}

export function createUnit(
  token: string,
  idempotencyKey: string,
  input: CreateUnitRequest,
): Promise<Unit> {
  return apiRequest<Unit>('/master-data/catalog/units', {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
    token,
  });
}

export function listProducts(token: string): Promise<ProductSummary[]> {
  return apiRequest<ProductSummary[]>('/master-data/catalog/products', { token });
}

export function createProduct(
  token: string,
  idempotencyKey: string,
  input: CreateProductRequest,
): Promise<ProductSummary> {
  return apiRequest<ProductSummary>('/master-data/catalog/products', {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
    token,
  });
}
