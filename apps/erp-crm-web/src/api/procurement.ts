import type {
  CreatePurchaseOrderRequest,
  CreateSupplierClaimRequest,
  CreateSupplierEvaluationRequest,
  CreateSupplierInvoiceRequest,
  GoodsReceipt,
  ProcurementReferenceData,
  ProcurementSupplierRecord,
  PurchaseOrder,
  PurchaseOrderPage,
  PurchaseOrderStatus,
  ReceivePurchaseOrderRequest,
  SupplierClaim,
  SupplierCommercialProfile,
  SupplierEvaluation,
  SupplierInvoice,
  UpdateSupplierClaimStatusRequest,
  UpdateSupplierCommercialProfileRequest,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getProcurementReferenceData(token: string): Promise<ProcurementReferenceData> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/procurement/reference-data', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listPurchaseOrders(
  token: string,
  query: { page?: number; pageSize?: number; status?: PurchaseOrderStatus } = {},
): Promise<PurchaseOrderPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/procurement/purchase-orders', {
      headers: authorizationHeaders(token),
      params: { query },
    }),
  );
}

export function createPurchaseOrder(
  token: string,
  idempotencyKey: string,
  input: CreatePurchaseOrderRequest,
): Promise<PurchaseOrder> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/procurement/purchase-orders', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function receivePurchaseOrder(
  token: string,
  purchaseOrderId: string,
  idempotencyKey: string,
  input: ReceivePurchaseOrderRequest,
): Promise<GoodsReceipt> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/procurement/purchase-orders/{id}/receipts', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: purchaseOrderId },
      },
    }),
  );
}

export function listProcurementSuppliers(token: string): Promise<ProcurementSupplierRecord[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/procurement/suppliers', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function updateSupplierCommercialProfile(
  token: string,
  supplierId: string,
  idempotencyKey: string,
  input: UpdateSupplierCommercialProfileRequest,
): Promise<SupplierCommercialProfile> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/procurement/suppliers/{id}/commercial-profile', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: supplierId },
      },
    }),
  );
}

export function createSupplierEvaluation(
  token: string,
  supplierId: string,
  idempotencyKey: string,
  input: CreateSupplierEvaluationRequest,
): Promise<SupplierEvaluation> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/procurement/suppliers/{id}/evaluations', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: supplierId },
      },
    }),
  );
}

export function listSupplierInvoices(token: string): Promise<SupplierInvoice[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/procurement/supplier-invoices', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createSupplierInvoice(
  token: string,
  idempotencyKey: string,
  input: CreateSupplierInvoiceRequest,
): Promise<SupplierInvoice> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/procurement/supplier-invoices', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function listSupplierClaims(token: string): Promise<SupplierClaim[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/procurement/supplier-claims', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createSupplierClaim(
  token: string,
  idempotencyKey: string,
  input: CreateSupplierClaimRequest,
): Promise<SupplierClaim> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/procurement/supplier-claims', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function updateSupplierClaimStatus(
  token: string,
  claimId: string,
  idempotencyKey: string,
  input: UpdateSupplierClaimStatusRequest,
): Promise<SupplierClaim> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/procurement/supplier-claims/{id}/status', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: claimId },
      },
    }),
  );
}
