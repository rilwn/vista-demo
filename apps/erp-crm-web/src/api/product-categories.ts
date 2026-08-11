import type { CreateProductCategoryRequest, ProductCategory } from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function listProductCategories(token: string): Promise<ProductCategory[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/master-data/product-categories', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createProductCategory(
  token: string,
  idempotencyKey: string,
  input: CreateProductCategoryRequest,
): Promise<ProductCategory> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/master-data/product-categories', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}
