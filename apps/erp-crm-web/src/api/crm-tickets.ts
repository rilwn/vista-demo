import type {
  CreateCrmTicketFromServiceRequestRequest,
  CreateCrmTicketRequest,
  CreateServiceRequestFromCrmTicketRequest,
  CrmTicket,
  CrmTicketPage,
  CrmTicketPriority,
  CrmTicketReferenceData,
  CrmTicketStatus,
  RecordCrmTicketResponseRequest,
  TransitionCrmTicketRequest,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getCrmTicketReferenceData(token: string): Promise<CrmTicketReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/crm/tickets/reference-data', {
      headers: authorizationHeaders(token),
    }),
  ) as unknown as Promise<CrmTicketReferenceData>;
}

export function listCrmTickets(
  token: string,
  input: {
    page?: number;
    pageSize?: number;
    priority?: CrmTicketPriority;
    search?: string;
    status?: CrmTicketStatus;
  } = {},
): Promise<CrmTicketPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/crm/tickets', {
      headers: authorizationHeaders(token),
      params: { query: input },
    }),
  );
}

export function getCrmTicket(token: string, id: string): Promise<CrmTicket> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/crm/tickets/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function createCrmTicket(
  token: string,
  key: string,
  input: CreateCrmTicketRequest,
): Promise<CrmTicket> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/crm/tickets', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function recordCrmTicketResponse(
  token: string,
  id: string,
  key: string,
  input: RecordCrmTicketResponseRequest,
): Promise<CrmTicket> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/crm/tickets/{id}/respond', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function transitionCrmTicket(
  token: string,
  id: string,
  key: string,
  input: TransitionCrmTicketRequest,
): Promise<CrmTicket> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/crm/tickets/{id}/transition', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function createServiceRequestFromCrmTicket(
  token: string,
  id: string,
  key: string,
  input: CreateServiceRequestFromCrmTicketRequest,
): Promise<CrmTicket> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/crm/tickets/{id}/service-request', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function createCrmTicketFromServiceRequest(
  token: string,
  serviceRequestId: string,
  key: string,
  input: CreateCrmTicketFromServiceRequestRequest,
): Promise<CrmTicket> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/crm/tickets/from-service-request/{serviceRequestId}', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { serviceRequestId },
      },
    }),
  );
}
