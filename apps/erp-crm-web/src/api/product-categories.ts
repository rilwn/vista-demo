import type { CreateProductCategoryRequest, ProductCategory } from '@vista/contracts';

import { apiRequest } from './client';

export function listProductCategories(token: string): Promise<ProductCategory[]> {
  return apiRequest<ProductCategory[]>('/master-data/product-categories', { token });
}

export function createProductCategory(
  token: string,
  idempotencyKey: string,
  input: CreateProductCategoryRequest,
): Promise<ProductCategory> {
  return apiRequest<ProductCategory>('/master-data/product-categories', {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
    token,
  });
}
