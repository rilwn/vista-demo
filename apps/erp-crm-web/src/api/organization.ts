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

import { apiRequest } from './client';

export function getOrganizationTopology(token: string): Promise<OrganizationTopology> {
  return apiRequest<OrganizationTopology>('/organization/topology', { token });
}

export function listOrganizationMembers(token: string): Promise<OrganizationMember[]> {
  return apiRequest<OrganizationMember[]>('/organization/members', { token });
}

export function createLegalBusinessEntity(
  token: string,
  key: string,
  input: CreateLegalBusinessEntityRequest,
): Promise<LegalBusinessEntity> {
  return command('/organization/legal-entities', token, key, input);
}

export function createBusinessBranch(
  token: string,
  entityId: string,
  key: string,
  input: CreateBusinessBranchRequest,
): Promise<BusinessBranch> {
  return command(`/organization/legal-entities/${entityId}/branches`, token, key, input);
}

export function createBusinessLocation(
  token: string,
  branchId: string,
  key: string,
  input: CreateBusinessLocationRequest,
): Promise<BusinessLocation> {
  return command(`/organization/branches/${branchId}/locations`, token, key, input);
}

export function createBusinessOperator(
  token: string,
  locationId: string,
  key: string,
  input: CreateBusinessOperatorRequest,
): Promise<BusinessOperator> {
  return command(`/organization/locations/${locationId}/operators`, token, key, input);
}

export function createCashRegister(
  token: string,
  locationId: string,
  key: string,
  input: CreateCashRegisterRequest,
): Promise<CashRegister> {
  return command(`/organization/locations/${locationId}/registers`, token, key, input);
}

function command<T>(path: string, token: string, key: string, input: object): Promise<T> {
  return apiRequest<T>(path, {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': key },
    method: 'POST',
    token,
  });
}
