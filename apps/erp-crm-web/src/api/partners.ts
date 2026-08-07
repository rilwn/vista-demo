import type {
  CreatePartnerAddressRequest,
  CreatePartnerBankAccountRequest,
  CreatePartnerContactRequest,
  CreatePartnerRequest,
  PartnerAddress,
  PartnerBankAccount,
  PartnerContact,
  PartnerKind,
  PartnerPage,
  PartnerProfile,
  PartnerRole,
  PartnerSummary,
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
