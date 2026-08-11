import type { NotificationMessage, NotificationPage } from '@vista/contracts';

import { apiClient, authorizationHeaders, unwrapApiResponse } from './client';

export function listNotifications(token: string): Promise<NotificationPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/notifications', {
      headers: authorizationHeaders(token),
      params: { query: { page: 1, pageSize: 20 } },
    }),
  );
}

export function markNotificationRead(token: string, id: string): Promise<NotificationMessage> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/notifications/{id}/read', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}
