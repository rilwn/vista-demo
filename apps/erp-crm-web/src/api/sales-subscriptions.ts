import type {
  CreateServiceSubscriptionRequest,
  SalesSubscriptionReferenceData,
  ServiceSubscriptionContract,
  UpdateServiceSubscriptionRequest,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getSalesSubscriptionReferenceData(
  token: string,
): Promise<SalesSubscriptionReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/sales/subscriptions/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listServiceSubscriptions(token: string): Promise<ServiceSubscriptionContract[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/sales/subscriptions', { headers: authorizationHeaders(token) }),
  );
}

export function createServiceSubscription(
  token: string,
  key: string,
  input: CreateServiceSubscriptionRequest,
): Promise<ServiceSubscriptionContract> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/subscriptions', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function updateServiceSubscription(
  token: string,
  id: string,
  key: string,
  input: UpdateServiceSubscriptionRequest,
): Promise<ServiceSubscriptionContract> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/sales/subscriptions/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}
