import type {
  BusinessBranch,
  BusinessLocation,
  BusinessOperator,
  CashRegister,
  CreateBusinessBranchRequest,
  CreateBusinessLocationRequest,
  CreateBusinessOperatorRequest,
  CreateCashRegisterRequest,
  CreateLegalBusinessEntityRequest,
  LegalBusinessEntity,
  OrganizationMember,
  OrganizationTopology,
  RecordVersionRequest,
  UpdateBusinessBranchRequest,
  UpdateBusinessLocationRequest,
  UpdateBusinessOperatorRequest,
  UpdateCashRegisterRequest,
  UpdateLegalBusinessEntityRequest,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getOrganizationTopology(token: string): Promise<OrganizationTopology> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/organization/topology', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listOrganizationMembers(token: string): Promise<OrganizationMember[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/organization/members', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createLegalBusinessEntity(
  token: string,
  key: string,
  input: CreateLegalBusinessEntityRequest,
): Promise<LegalBusinessEntity> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/organization/legal-entities', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function createBusinessBranch(
  token: string,
  entityId: string,
  key: string,
  input: CreateBusinessBranchRequest,
): Promise<BusinessBranch> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/organization/legal-entities/{entityId}/branches', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { entityId },
      },
    }),
  );
}

export function createBusinessLocation(
  token: string,
  branchId: string,
  key: string,
  input: CreateBusinessLocationRequest,
): Promise<BusinessLocation> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/organization/branches/{branchId}/locations', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { branchId },
      },
    }),
  );
}

export function createBusinessOperator(
  token: string,
  locationId: string,
  key: string,
  input: CreateBusinessOperatorRequest,
): Promise<BusinessOperator> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/organization/locations/{locationId}/operators', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { locationId },
      },
    }),
  );
}

export function createCashRegister(
  token: string,
  locationId: string,
  key: string,
  input: CreateCashRegisterRequest,
): Promise<CashRegister> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/organization/locations/{locationId}/registers', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { locationId },
      },
    }),
  );
}

export function updateLegalBusinessEntity(
  token: string,
  id: string,
  key: string,
  input: UpdateLegalBusinessEntityRequest,
): Promise<LegalBusinessEntity> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/organization/legal-entities/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function updateBusinessBranch(
  token: string,
  id: string,
  key: string,
  input: UpdateBusinessBranchRequest,
): Promise<BusinessBranch> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/organization/branches/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function updateBusinessLocation(
  token: string,
  id: string,
  key: string,
  input: UpdateBusinessLocationRequest,
): Promise<BusinessLocation> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/organization/locations/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function updateBusinessOperator(
  token: string,
  id: string,
  key: string,
  input: UpdateBusinessOperatorRequest,
): Promise<BusinessOperator> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/organization/operators/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export function updateCashRegister(
  token: string,
  id: string,
  key: string,
  input: UpdateCashRegisterRequest,
): Promise<CashRegister> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/organization/cash-registers/{id}', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header, path: { id } },
    }),
  );
}

export type OrganizationRecordKind = 'branch' | 'entity' | 'location' | 'operator' | 'register';

export function setOrganizationRecordActive(
  token: string,
  kind: OrganizationRecordKind,
  id: string,
  active: boolean,
  key: string,
  input: RecordVersionRequest,
): Promise<
  LegalBusinessEntity | BusinessBranch | BusinessLocation | BusinessOperator | CashRegister
> {
  const action = active ? 'reactivate' : 'deactivate';
  const path = {
    branch: {
      deactivate: '/api/v1/organization/branches/{id}/deactivate',
      reactivate: '/api/v1/organization/branches/{id}/reactivate',
    },
    entity: {
      deactivate: '/api/v1/organization/legal-entities/{id}/deactivate',
      reactivate: '/api/v1/organization/legal-entities/{id}/reactivate',
    },
    location: {
      deactivate: '/api/v1/organization/locations/{id}/deactivate',
      reactivate: '/api/v1/organization/locations/{id}/reactivate',
    },
    operator: {
      deactivate: '/api/v1/organization/operators/{id}/deactivate',
      reactivate: '/api/v1/organization/operators/{id}/reactivate',
    },
    register: {
      deactivate: '/api/v1/organization/cash-registers/{id}/deactivate',
      reactivate: '/api/v1/organization/cash-registers/{id}/reactivate',
    },
  }[kind][action] as
    | '/api/v1/organization/branches/{id}/deactivate'
    | '/api/v1/organization/branches/{id}/reactivate'
    | '/api/v1/organization/legal-entities/{id}/deactivate'
    | '/api/v1/organization/legal-entities/{id}/reactivate'
    | '/api/v1/organization/locations/{id}/deactivate'
    | '/api/v1/organization/locations/{id}/reactivate'
    | '/api/v1/organization/operators/{id}/deactivate'
    | '/api/v1/organization/operators/{id}/reactivate'
    | '/api/v1/organization/cash-registers/{id}/deactivate'
    | '/api/v1/organization/cash-registers/{id}/reactivate';
  return unwrapApiResponse(
    apiClient.POST(path, {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { id },
      },
    }),
  );
}
