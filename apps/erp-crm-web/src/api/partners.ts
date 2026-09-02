import type {
  CreateCustomerEquipmentRequest,
  CreateCustomerLocationRequest,
  CreatePartnerAddressRequest,
  CreatePartnerBankAccountRequest,
  CreatePartnerContactRequest,
  CreatePartnerRequest,
  CustomerOperationalOverview,
  CustomerEquipment,
  CustomerLocation,
  CustomerLocationProfile,
  PartnerAddress,
  PartnerBankAccount,
  PartnerContact,
  PartnerKind,
  PartnerPage,
  PartnerProfile,
  PartnerRole,
  PartnerSummary,
  RecordVersionRequest,
  UpdateCustomerEquipmentRequest,
  UpdateCustomerLocationRequest,
  UpdatePartnerRequest,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export interface PartnerListQuery {
  direction?: 'asc' | 'desc';
  kind?: PartnerKind;
  page?: number;
  pageSize?: number;
  role?: PartnerRole;
  search?: string;
  sortBy?: 'createdAt' | 'displayName' | 'updatedAt';
}

export function listPartners(token: string, query: PartnerListQuery): Promise<PartnerPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/master-data/partners', {
      headers: authorizationHeaders(token),
      params: { query },
    }),
  );
}

export function createPartner(
  token: string,
  idempotencyKey: string,
  input: CreatePartnerRequest,
): Promise<PartnerSummary> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/master-data/partners', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(idempotencyKey).header },
    }),
  );
}

export function updatePartner(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: UpdatePartnerRequest,
): Promise<PartnerSummary> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/master-data/partners/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: partnerId },
      },
    }),
  );
}

export function setPartnerActive(
  token: string,
  partnerId: string,
  active: boolean,
  idempotencyKey: string,
  input: RecordVersionRequest,
): Promise<PartnerSummary> {
  const options = {
    body: input,
    headers: authorizationHeaders(token),
    params: {
      header: idempotencyParameters(idempotencyKey).header,
      path: { id: partnerId },
    },
  };
  return active
    ? unwrapApiResponse(apiClient.POST('/api/v1/master-data/partners/{id}/reactivate', options))
    : unwrapApiResponse(apiClient.POST('/api/v1/master-data/partners/{id}/deactivate', options));
}

export function getPartnerProfile(token: string, partnerId: string): Promise<PartnerProfile> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/master-data/partners/{id}/profile', {
      headers: authorizationHeaders(token),
      params: { path: { id: partnerId } },
    }),
  );
}

export function getCustomerOperationalOverview(
  token: string,
  partnerId: string,
  limit = 10,
): Promise<CustomerOperationalOverview> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/master-data/partners/{id}/customer-overview', {
      headers: authorizationHeaders(token),
      params: { path: { id: partnerId }, query: { limit } },
    }),
  );
}

export function createPartnerAddress(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: CreatePartnerAddressRequest,
): Promise<PartnerAddress> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/master-data/partners/{id}/addresses', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: partnerId },
      },
    }),
  );
}

export function createPartnerContact(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: CreatePartnerContactRequest,
): Promise<PartnerContact> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/master-data/partners/{id}/contacts', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: partnerId },
      },
    }),
  );
}

export function createPartnerBankAccount(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: CreatePartnerBankAccountRequest,
): Promise<PartnerBankAccount> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/master-data/partners/{id}/bank-accounts', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { id: partnerId },
      },
    }),
  );
}

export function listCustomerLocations(
  token: string,
  partnerId: string,
): Promise<CustomerLocationProfile[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/master-data/partners/{partnerId}/locations', {
      headers: authorizationHeaders(token),
      params: { path: { partnerId } },
    }),
  );
}

export function createCustomerLocation(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: CreateCustomerLocationRequest,
): Promise<CustomerLocation> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/master-data/partners/{partnerId}/locations', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { partnerId },
      },
    }),
  );
}

export function createCustomerEquipment(
  token: string,
  partnerId: string,
  locationId: string,
  idempotencyKey: string,
  input: CreateCustomerEquipmentRequest,
): Promise<CustomerEquipment> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/master-data/partners/{partnerId}/locations/{locationId}/equipment', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { locationId, partnerId },
      },
    }),
  );
}

export function updateCustomerLocation(
  token: string,
  partnerId: string,
  locationId: string,
  idempotencyKey: string,
  input: UpdateCustomerLocationRequest,
): Promise<CustomerLocation> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/master-data/partners/{partnerId}/locations/{locationId}', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(idempotencyKey).header,
        path: { locationId, partnerId },
      },
    }),
  );
}

export function setCustomerLocationActive(
  token: string,
  partnerId: string,
  locationId: string,
  active: boolean,
  idempotencyKey: string,
  input: RecordVersionRequest,
): Promise<CustomerLocation> {
  const options = {
    body: input,
    headers: authorizationHeaders(token),
    params: {
      header: idempotencyParameters(idempotencyKey).header,
      path: { locationId, partnerId },
    },
  };
  return active
    ? unwrapApiResponse(
        apiClient.POST(
          '/api/v1/master-data/partners/{partnerId}/locations/{locationId}/reactivate',
          options,
        ),
      )
    : unwrapApiResponse(
        apiClient.POST(
          '/api/v1/master-data/partners/{partnerId}/locations/{locationId}/deactivate',
          options,
        ),
      );
}

export function updateCustomerEquipment(
  token: string,
  partnerId: string,
  locationId: string,
  equipmentId: string,
  idempotencyKey: string,
  input: UpdateCustomerEquipmentRequest,
): Promise<CustomerEquipment> {
  return unwrapApiResponse(
    apiClient.PUT(
      '/api/v1/master-data/partners/{partnerId}/locations/{locationId}/equipment/{equipmentId}',
      {
        body: input,
        headers: authorizationHeaders(token),
        params: {
          header: idempotencyParameters(idempotencyKey).header,
          path: { equipmentId, locationId, partnerId },
        },
      },
    ),
  );
}

export function setCustomerEquipmentActive(
  token: string,
  partnerId: string,
  locationId: string,
  equipmentId: string,
  active: boolean,
  idempotencyKey: string,
  input: RecordVersionRequest,
): Promise<CustomerEquipment> {
  const options = {
    body: input,
    headers: authorizationHeaders(token),
    params: {
      header: idempotencyParameters(idempotencyKey).header,
      path: { equipmentId, locationId, partnerId },
    },
  };
  return active
    ? unwrapApiResponse(
        apiClient.POST(
          '/api/v1/master-data/partners/{partnerId}/locations/{locationId}/equipment/{equipmentId}/reactivate',
          options,
        ),
      )
    : unwrapApiResponse(
        apiClient.POST(
          '/api/v1/master-data/partners/{partnerId}/locations/{locationId}/equipment/{equipmentId}/deactivate',
          options,
        ),
      );
}
