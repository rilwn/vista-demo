import type {
  CreatePartnerRequest,
  PartnerKind,
  PartnerPage,
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
