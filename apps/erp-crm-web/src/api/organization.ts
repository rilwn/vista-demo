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
