import type {
  ApiErrorResponse,
  AssignServiceWorkOrderRequest,
  CancelServiceRequest,
  CompleteServiceWorkOrderRequest,
  CompleteServiceInspectionRequest,
  CreateServiceInspectionPlanRequest,
  CreateServiceRequest,
  CreateWarrantyClaimRequest,
  CreateServiceReportExportRequest,
  ServiceReportDefinition,
  ServiceReportExport,
  ServiceReportExportPage,
  ServiceReportOverview,
  ServiceCareOverview,
  ServiceInspectionPlan,
  ServiceEquipmentHistory,
  ServiceReferenceData,
  ServiceRequest,
  ServiceRequestPage,
  ServiceSchedule,
  ServiceTechnicianSchedulePolicy,
  ServiceWorkOrder,
  ServiceWorkOrderPage,
  ServiceWorkOrderPhoto,
  StartServiceWorkOrderRequest,
  TransitionWarrantyClaimRequest,
  UpdateServiceTechnicianSchedulePolicyRequest,
  WarrantyClaim,
} from '@vista/contracts';

import {
  ApiClientError,
  apiClient,
  apiV1BaseUrl,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getServiceReferenceData(token: string): Promise<ServiceReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/reference-data', { headers: authorizationHeaders(token) }),
  );
}

export function getServiceCareOverview(token: string): Promise<ServiceCareOverview> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/care', { headers: authorizationHeaders(token) }),
  );
}

export function getServiceReportOverview(
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<ServiceReportOverview> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/reports/overview', {
      headers: authorizationHeaders(token),
      params: { query: { dateFrom, dateTo } },
    }),
  );
}

export function getServiceReportDefinitions(token: string): Promise<ServiceReportDefinition[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/report-exports/definitions', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listServiceReportExports(
  token: string,
  page = 1,
  pageSize = 20,
): Promise<ServiceReportExportPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/report-exports', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize } },
    }),
  );
}

export function createServiceReportExport(
  token: string,
  key: string,
  input: CreateServiceReportExportRequest,
): Promise<ServiceReportExport> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/report-exports', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function retryServiceReportExport(token: string, id: string): Promise<ServiceReportExport> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/report-exports/{id}/retry', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export async function downloadServiceReportExport(
  token: string,
  report: ServiceReportExport,
): Promise<Blob> {
  const response = await fetch(`${apiV1BaseUrl}/service/report-exports/${report.id}/content`, {
    headers: authorizationHeaders(token),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
    throw new ApiClientError(
      body?.error.message ?? 'The report could not be downloaded.',
      body?.error.code ?? 'REPORT_DOWNLOAD_FAILED',
      response.status,
      body?.error.correlationId,
      body?.error.details,
    );
  }
  return response.blob();
}

export function createWarrantyClaim(
  token: string,
  key: string,
  input: CreateWarrantyClaimRequest,
): Promise<WarrantyClaim> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/warranty-claims', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function transitionWarrantyClaim(
  token: string,
  id: string,
  key: string,
  input: TransitionWarrantyClaimRequest,
): Promise<WarrantyClaim> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/warranty-claims/{id}/transition', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function createServiceInspectionPlan(
  token: string,
  key: string,
  input: CreateServiceInspectionPlanRequest,
): Promise<ServiceInspectionPlan> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/inspection-plans', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function completeServiceInspection(
  token: string,
  id: string,
  key: string,
  input: CompleteServiceInspectionRequest,
): Promise<ServiceInspectionPlan> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/inspection-plans/{id}/complete', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function getServiceSchedule(
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<ServiceSchedule> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/schedule', {
      headers: authorizationHeaders(token),
      params: { query: { dateFrom, dateTo } },
    }),
  );
}

export function updateServiceTechnicianSchedulePolicy(
  token: string,
  technicianAccountId: string,
  key: string,
  input: UpdateServiceTechnicianSchedulePolicyRequest,
): Promise<ServiceTechnicianSchedulePolicy> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/service/technicians/{id}/schedule-policy', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { id: technicianAccountId },
      },
    }),
  );
}

export function listServiceRequests(
  token: string,
  page = 1,
  pageSize = 25,
): Promise<ServiceRequestPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/requests', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize } },
    }),
  );
}

export function getServiceRequest(token: string, id: string): Promise<ServiceRequest> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/requests/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function listServiceWorkOrders(
  token: string,
  page = 1,
  pageSize = 25,
): Promise<ServiceWorkOrderPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/work-orders', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize } },
    }),
  );
}

export function listMyServiceWork(
  token: string,
  page = 1,
  pageSize = 25,
): Promise<ServiceWorkOrderPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/work-orders/my', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize } },
    }),
  );
}

export function getServiceWorkOrder(token: string, id: string): Promise<ServiceWorkOrder> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/work-orders/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function getServiceEquipmentHistory(
  token: string,
  id: string,
): Promise<ServiceEquipmentHistory> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/equipment/{id}/history', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export function createServiceRequest(
  token: string,
  key: string,
  input: CreateServiceRequest,
): Promise<ServiceRequest> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/requests', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function assignServiceWorkOrder(
  token: string,
  id: string,
  key: string,
  input: AssignServiceWorkOrderRequest,
): Promise<ServiceRequest> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/requests/{id}/assign', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function cancelServiceRequest(
  token: string,
  id: string,
  key: string,
  input: CancelServiceRequest,
): Promise<ServiceRequest> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/requests/{id}/cancel', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function startServiceWorkOrder(
  token: string,
  id: string,
  key: string,
  input: StartServiceWorkOrderRequest,
): Promise<ServiceWorkOrder> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/work-orders/{id}/start', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function completeServiceWorkOrder(
  token: string,
  id: string,
  key: string,
  input: CompleteServiceWorkOrderRequest,
): Promise<ServiceWorkOrder> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/work-orders/{id}/complete', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export async function uploadServicePhoto(
  token: string,
  id: string,
  key: string,
  photo: File,
): Promise<ServiceWorkOrderPhoto> {
  const form = new FormData();
  form.append('photo', photo);
  try {
    const response = await fetch(`${apiV1BaseUrl}/service/work-orders/${id}/photos`, {
      body: form,
      headers: authorizationHeaders(token, { 'Idempotency-Key': key }),
      method: 'POST',
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) return body as ServiceWorkOrderPhoto;
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object' &&
      'code' in body.error &&
      'message' in body.error
    ) {
      const error = body.error as { code: string; correlationId?: string; message: string };
      throw new ApiClientError(error.message, error.code, response.status, error.correlationId);
    }
    throw new ApiClientError('The photo could not be uploaded.', 'REQUEST_FAILED', response.status);
  } catch (caught) {
    if (caught instanceof ApiClientError) throw caught;
    throw new ApiClientError('The service is unavailable.', 'UNAVAILABLE', 0);
  }
}

export async function fetchServicePhoto(
  token: string,
  workOrderId: string,
  photoId: string,
): Promise<Blob> {
  return fetchServiceEvidence(token, `/service/work-orders/${workOrderId}/photos/${photoId}`);
}

export async function fetchServiceSignature(token: string, workOrderId: string): Promise<Blob> {
  return fetchServiceEvidence(token, `/service/work-orders/${workOrderId}/signature`);
}

async function fetchServiceEvidence(token: string, path: string): Promise<Blob> {
  try {
    const response = await fetch(`${apiV1BaseUrl}${path}`, {
      headers: authorizationHeaders(token),
      method: 'GET',
    });
    if (response.ok) return response.blob();
    const body: unknown = await response.json().catch(() => undefined);
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object' &&
      'code' in body.error &&
      'message' in body.error
    ) {
      const error = body.error as { code: string; correlationId?: string; message: string };
      throw new ApiClientError(error.message, error.code, response.status, error.correlationId);
    }
    throw new ApiClientError(
      'The service evidence could not be loaded.',
      'REQUEST_FAILED',
      response.status,
    );
  } catch (caught) {
    if (caught instanceof ApiClientError) throw caught;
    throw new ApiClientError('The service is unavailable.', 'UNAVAILABLE', 0);
  }
}
