import type {
  AcceptSalesHandoverRequest,
  CancelSalesQuotationRequest,
  ConfirmSalesQuotationRequest,
  CreateSalesQuotationRequest,
  CreateSalesShipmentRequest,
  SalesReferenceData,
  SalesWorkflow,
  UpdateSalesQuotationRequest,
} from '@vista/contracts';

import { apiV1BaseUrl, ApiClientError } from './client';
import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getSalesReferenceData(token: string): Promise<SalesReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/sales/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listSalesWorkflows(token: string): Promise<SalesWorkflow[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/sales/workflows', { headers: authorizationHeaders(token) }),
  );
}

export function createSalesQuotation(
  token: string,
  key: string,
  input: CreateSalesQuotationRequest,
): Promise<SalesWorkflow> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/quotations', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function updateSalesQuotation(
  token: string,
  id: string,
  key: string,
  input: UpdateSalesQuotationRequest,
): Promise<SalesWorkflow> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/sales/quotations/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function cancelSalesQuotation(
  token: string,
  id: string,
  key: string,
  input: CancelSalesQuotationRequest,
): Promise<SalesWorkflow> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/quotations/{id}/cancel', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export async function downloadSalesQuotationPdf(token: string, id: string): Promise<Blob> {
  const response = await fetch(`${apiV1BaseUrl}/sales/quotations/${id}/pdf`, {
    headers: authorizationHeaders(token),
  });
  if (!response.ok) {
    throw new ApiClientError(
      'The quotation PDF could not be downloaded.',
      'SALES_QUOTATION_PDF_DOWNLOAD_FAILED',
      response.status,
    );
  }
  return response.blob();
}

export function confirmSalesQuotation(
  token: string,
  id: string,
  key: string,
  input: ConfirmSalesQuotationRequest,
): Promise<SalesWorkflow> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/quotations/{id}/confirm', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function createSalesShipment(
  token: string,
  id: string,
  key: string,
  input: CreateSalesShipmentRequest,
): Promise<SalesWorkflow> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/orders/{id}/shipments', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function createSalesInvoiceDraft(
  token: string,
  id: string,
  key: string,
): Promise<SalesWorkflow> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/orders/{id}/invoice-draft', {
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function acceptSalesHandover(
  token: string,
  id: string,
  key: string,
  input: AcceptSalesHandoverRequest,
): Promise<SalesWorkflow> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/sales/handover-certificates/{id}/accept', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}
