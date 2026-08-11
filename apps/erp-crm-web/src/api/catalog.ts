import type {
  CreateProductRequest,
  CreateUnitRequest,
  ProductSummary,
  Unit,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function listUnits(token: string): Promise<Unit[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/master-data/catalog/units', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createUnit(
  token: string,
  idempotencyKey: string,
  input: CreateUnitRequest,
): Promise<Unit> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/master-data/catalog/units', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function listProducts(token: string): Promise<ProductSummary[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/master-data/catalog/products', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createProduct(
  token: string,
  idempotencyKey: string,
  input: CreateProductRequest,
): Promise<ProductSummary> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/master-data/catalog/products', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}
