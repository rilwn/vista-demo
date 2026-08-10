import type {
  CreatePartnerAddressRequest,
  CreatePartnerBankAccountRequest,
  CreatePartnerContactRequest,
  CreatePartnerRequest,
  CreateCustomerEquipmentRequest,
  CreateCustomerLocationRequest,
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

import { apiRequest } from './client';

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
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') parameters.set(key, String(value));
  }
  return apiRequest<PartnerPage>(`/master-data/partners?${parameters.toString()}`, { token });
}

export function createPartner(
  token: string,
  idempotencyKey: string,
  input: CreatePartnerRequest,
): Promise<PartnerSummary> {
  return apiRequest<PartnerSummary>('/master-data/partners', {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
    token,
  });
}

export function updatePartner(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: UpdatePartnerRequest,
): Promise<PartnerSummary> {
  return partnerCommand(token, partnerId, '', 'PUT', idempotencyKey, input);
}

export function setPartnerActive(
  token: string,
  partnerId: string,
  active: boolean,
  idempotencyKey: string,
  input: RecordVersionRequest,
): Promise<PartnerSummary> {
  return partnerCommand(
    token,
    partnerId,
    active ? 'reactivate' : 'deactivate',
    'POST',
    idempotencyKey,
    input,
  );
}

export function getPartnerProfile(token: string, partnerId: string): Promise<PartnerProfile> {
  return apiRequest<PartnerProfile>(`/master-data/partners/${partnerId}/profile`, { token });
}

export function createPartnerAddress(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: CreatePartnerAddressRequest,
): Promise<PartnerAddress> {
  return createPartnerProfileRecord<PartnerAddress>(
    token,
    partnerId,
    'addresses',
    idempotencyKey,
    input,
  );
}

export function createPartnerContact(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: CreatePartnerContactRequest,
): Promise<PartnerContact> {
  return createPartnerProfileRecord<PartnerContact>(
    token,
    partnerId,
    'contacts',
    idempotencyKey,
    input,
  );
}

export function createPartnerBankAccount(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: CreatePartnerBankAccountRequest,
): Promise<PartnerBankAccount> {
  return createPartnerProfileRecord<PartnerBankAccount>(
    token,
    partnerId,
    'bank-accounts',
    idempotencyKey,
    input,
  );
}

export function listCustomerLocations(
  token: string,
  partnerId: string,
): Promise<CustomerLocationProfile[]> {
  return apiRequest<CustomerLocationProfile[]>(`/master-data/partners/${partnerId}/locations`, {
    token,
  });
}

export function createCustomerLocation(
  token: string,
  partnerId: string,
  idempotencyKey: string,
  input: CreateCustomerLocationRequest,
): Promise<CustomerLocation> {
  return apiRequest<CustomerLocation>(`/master-data/partners/${partnerId}/locations`, {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
    token,
  });
}

export function createCustomerEquipment(
  token: string,
  partnerId: string,
  locationId: string,
  idempotencyKey: string,
  input: CreateCustomerEquipmentRequest,
): Promise<CustomerEquipment> {
  return apiRequest<CustomerEquipment>(
    `/master-data/partners/${partnerId}/locations/${locationId}/equipment`,
    {
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': idempotencyKey },
      method: 'POST',
      token,
    },
  );
}

export function updateCustomerLocation(
  token: string,
  partnerId: string,
  locationId: string,
  idempotencyKey: string,
  input: UpdateCustomerLocationRequest,
): Promise<CustomerLocation> {
  return assetCommand(token, partnerId, locationId, '', 'PUT', idempotencyKey, input);
}

export function setCustomerLocationActive(
  token: string,
  partnerId: string,
  locationId: string,
  active: boolean,
  idempotencyKey: string,
  input: RecordVersionRequest,
): Promise<CustomerLocation> {
  return assetCommand(
    token,
    partnerId,
    locationId,
    active ? 'reactivate' : 'deactivate',
    'POST',
    idempotencyKey,
    input,
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
  return assetCommand(
    token,
    partnerId,
    locationId,
    `equipment/${equipmentId}`,
    'PUT',
    idempotencyKey,
    input,
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
  return assetCommand(
    token,
    partnerId,
    locationId,
    `equipment/${equipmentId}/${active ? 'reactivate' : 'deactivate'}`,
    'POST',
    idempotencyKey,
    input,
  );
}

function partnerCommand<T>(
  token: string,
  partnerId: string,
  suffix: string,
  method: 'POST' | 'PUT',
  idempotencyKey: string,
  input: object,
): Promise<T> {
  return apiRequest<T>(`/master-data/partners/${partnerId}${suffix ? `/${suffix}` : ''}`, {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
    method,
    token,
  });
}

function assetCommand<T>(
  token: string,
  partnerId: string,
  locationId: string,
  suffix: string,
  method: 'POST' | 'PUT',
  idempotencyKey: string,
  input: object,
): Promise<T> {
  return apiRequest<T>(
    `/master-data/partners/${partnerId}/locations/${locationId}${suffix ? `/${suffix}` : ''}`,
    {
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': idempotencyKey },
      method,
      token,
    },
  );
}

function createPartnerProfileRecord<T>(
  token: string,
  partnerId: string,
  resource: 'addresses' | 'bank-accounts' | 'contacts',
  idempotencyKey: string,
  input:
    CreatePartnerAddressRequest | CreatePartnerBankAccountRequest | CreatePartnerContactRequest,
): Promise<T> {
  return apiRequest<T>(`/master-data/partners/${partnerId}/${resource}`, {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
    token,
  });
}
