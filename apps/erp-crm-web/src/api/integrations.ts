import type {
  IntegrationEventDetail,
  IntegrationEventPage,
  IntegrationEventStatus,
  IntegrationEventTelemetry,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getIntegrationTelemetry(token: string): Promise<IntegrationEventTelemetry> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/platform/integrations/metrics', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listIntegrationEvents(
  token: string,
  status?: IntegrationEventStatus,
): Promise<IntegrationEventPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/platform/integrations/events', {
      headers: authorizationHeaders(token),
      params: { query: { page: 1, pageSize: 50, ...(status ? { status } : {}) } },
    }),
  );
}

export function getIntegrationEvent(token: string, id: string): Promise<IntegrationEventDetail> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/platform/integrations/events/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function replayIntegrationEvent(
  token: string,
  key: string,
  event: IntegrationEventDetail,
): Promise<IntegrationEventDetail> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/platform/integrations/events/{id}/replay', {
      body: { expectedReplayCount: event.replayCount },
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { id: event.id },
      },
    }),
  );
}
