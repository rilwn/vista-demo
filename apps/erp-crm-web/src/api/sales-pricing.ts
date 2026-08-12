import type {
  CreateCustomerPriceGroupRequest,
  CreatePriceListRequest,
  CreatePromotionalCampaignRequest,
  CustomerPriceGroup,
  PriceList,
  PromotionalCampaign,
  SalesPricingReferenceData,
  SalesResolvedPrice,
  UpdateCustomerPriceGroupRequest,
  UpdatePriceListRequest,
  UpdatePromotionalCampaignRequest,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getSalesPricingReferenceData(token: string): Promise<SalesPricingReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/sales/pricing/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listPriceLists(token: string): Promise<PriceList[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/sales/price-lists', { headers: authorizationHeaders(token) }),
  );
}

export function createPriceList(
  token: string,
  key: string,
  input: CreatePriceListRequest,
): Promise<PriceList> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/price-lists', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function updatePriceList(
  token: string,
  id: string,
  key: string,
  input: UpdatePriceListRequest,
): Promise<PriceList> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/sales/price-lists/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function createCustomerPriceGroup(
  token: string,
  key: string,
  input: CreateCustomerPriceGroupRequest,
): Promise<CustomerPriceGroup> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/customer-groups', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function updateCustomerPriceGroup(
  token: string,
  id: string,
  key: string,
  input: UpdateCustomerPriceGroupRequest,
): Promise<CustomerPriceGroup> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/sales/customer-groups/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function createPromotionalCampaign(
  token: string,
  key: string,
  input: CreatePromotionalCampaignRequest,
): Promise<PromotionalCampaign> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/promotional-campaigns', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function updatePromotionalCampaign(
  token: string,
  id: string,
  key: string,
  input: UpdatePromotionalCampaignRequest,
): Promise<PromotionalCampaign> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/sales/promotional-campaigns/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function resolveSalesPrice(
  token: string,
  input: { asOf: string; currencyCode: string; customerPartnerId: string; productId: string },
): Promise<SalesResolvedPrice> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/sales/prices/resolve', {
      headers: authorizationHeaders(token),
      params: { query: input },
    }),
  );
}
