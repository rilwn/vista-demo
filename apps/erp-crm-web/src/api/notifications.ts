import type { NotificationMessage, NotificationPage } from '@vista/contracts';

import { apiRequest } from './client';

export function listNotifications(token: string): Promise<NotificationPage> {
  return apiRequest<NotificationPage>('/notifications?page=1&pageSize=20', { token });
}

export function markNotificationRead(token: string, id: string): Promise<NotificationMessage> {
  return apiRequest<NotificationMessage>(`/notifications/${id}/read`, {
    method: 'POST',
    token,
  });
}
