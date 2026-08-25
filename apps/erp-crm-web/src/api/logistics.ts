import type {
  CompleteLogisticsDeliveryRequest,
  CreateLogisticsDeliveryRequest,
  CreateLogisticsReturnRequest,
  CreateLogisticsRouteRequest,
  LogisticsDelivery,
  LogisticsDeliveryPage,
  LogisticsReferenceData,
  LogisticsReturn,
  LogisticsReturnPage,
  LogisticsRoutePlan,
  LogisticsRoutePlanPage,
  ReceiveLogisticsReturnRequest,
  ReportLogisticsDeliveryExceptionRequest,
  UpdateLogisticsDeliveryStatusRequest,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getLogisticsReferenceData(token: string): Promise<LogisticsReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/logistics/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listLogisticsDeliveries(token: string): Promise<LogisticsDeliveryPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/logistics/deliveries', {
      headers: authorizationHeaders(token),
      params: { query: { page: 1, pageSize: 50 } },
    }),
  );
}

export function getLogisticsDelivery(token: string, id: string): Promise<LogisticsDelivery> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/logistics/deliveries/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function createLogisticsDelivery(
  token: string,
  key: string,
  input: CreateLogisticsDeliveryRequest,
): Promise<LogisticsDelivery> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/logistics/deliveries', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function dispatchLogisticsDelivery(
  token: string,
  id: string,
  key: string,
  input: UpdateLogisticsDeliveryStatusRequest,
): Promise<LogisticsDelivery> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/logistics/deliveries/{id}/dispatch', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function completeLogisticsDelivery(
  token: string,
  id: string,
  key: string,
  input: CompleteLogisticsDeliveryRequest,
): Promise<LogisticsDelivery> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/logistics/deliveries/{id}/complete', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function reportLogisticsDeliveryException(
  token: string,
  id: string,
  key: string,
  input: ReportLogisticsDeliveryExceptionRequest,
): Promise<LogisticsDelivery> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/logistics/deliveries/{id}/exception', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function cancelLogisticsDelivery(
  token: string,
  id: string,
  key: string,
  input: UpdateLogisticsDeliveryStatusRequest,
): Promise<LogisticsDelivery> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/logistics/deliveries/{id}/cancel', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function listLogisticsReturns(token: string): Promise<LogisticsReturnPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/logistics/returns', {
      headers: authorizationHeaders(token),
      params: { query: { page: 1, pageSize: 50 } },
    }),
  );
}

export function getLogisticsReturn(token: string, id: string): Promise<LogisticsReturn> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/logistics/returns/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function createLogisticsReturn(
  token: string,
  key: string,
  input: CreateLogisticsReturnRequest,
): Promise<LogisticsReturn> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/logistics/returns', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function receiveLogisticsReturn(
  token: string,
  id: string,
  key: string,
  input: ReceiveLogisticsReturnRequest,
): Promise<LogisticsReturn> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/logistics/returns/{id}/receive', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function listLogisticsRoutes(
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<LogisticsRoutePlanPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/logistics/routes', {
      headers: authorizationHeaders(token),
      params: { query: { dateFrom, dateTo, page: 1, pageSize: 50 } },
    }),
  );
}

export function getLogisticsRoute(token: string, id: string): Promise<LogisticsRoutePlan> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/logistics/routes/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function createLogisticsRoute(
  token: string,
  key: string,
  input: CreateLogisticsRouteRequest,
): Promise<LogisticsRoutePlan> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/logistics/routes', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}
