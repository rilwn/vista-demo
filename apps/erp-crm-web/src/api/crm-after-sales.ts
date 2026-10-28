import type {
  ApiErrorResponse,
  CreateCrmReferralRequest,
  CreateCrmWarrantyCoverageOfferRequest,
  CreateWarrantyClaimRequest,
  CrmAfterSalesOverview,
  CrmCustomerSurvey,
  CrmPublicSurvey,
  CrmReferral,
  CrmWarrantyCard,
  CrmWarrantyCoverageOffer,
  CrmWarrantyCardReconciliationResult,
  RecordCrmSurveyResponseRequest,
  SendCrmCustomerSurveyRequest,
  TransitionWarrantyClaimRequest,
  TransitionCrmWarrantyCoverageOfferRequest,
  UpdateCrmWarrantyOfferRequest,
  WarrantyClaim,
} from '@vista/contracts';

import { ApiClientError, apiV1BaseUrl, authorizationHeaders } from './client';

export function getCrmAfterSalesOverview(token: string): Promise<CrmAfterSalesOverview> {
  return request<CrmAfterSalesOverview>(`${apiV1BaseUrl}/crm/after-sales`, token);
}

export function reconcileCrmWarrantyCards(
  token: string,
  key: string,
): Promise<CrmWarrantyCardReconciliationResult> {
  return command(`${apiV1BaseUrl}/crm/after-sales/warranty-cards/reconcile`, token, key, {});
}

export function updateCrmWarrantyOffer(
  token: string,
  id: string,
  key: string,
  input: UpdateCrmWarrantyOfferRequest,
): Promise<CrmWarrantyCard> {
  return command(`${apiV1BaseUrl}/crm/after-sales/warranty-cards/${id}/offer`, token, key, input);
}

export function createCrmWarrantyCoverageOffer(
  token: string,
  warrantyCardId: string,
  key: string,
  input: CreateCrmWarrantyCoverageOfferRequest,
): Promise<CrmWarrantyCoverageOffer> {
  return command(
    `${apiV1BaseUrl}/crm/after-sales/warranty-cards/${warrantyCardId}/coverage-offers`,
    token,
    key,
    input,
  );
}

export function transitionCrmWarrantyCoverageOffer(
  token: string,
  id: string,
  key: string,
  input: TransitionCrmWarrantyCoverageOfferRequest,
): Promise<CrmWarrantyCoverageOffer> {
  return command(`${apiV1BaseUrl}/crm/after-sales/coverage-offers/${id}/status`, token, key, input);
}

export function createCrmWarrantyClaim(
  token: string,
  key: string,
  input: CreateWarrantyClaimRequest,
): Promise<WarrantyClaim> {
  return command(`${apiV1BaseUrl}/crm/after-sales/warranty-claims`, token, key, input);
}

export function transitionCrmWarrantyClaim(
  token: string,
  id: string,
  key: string,
  input: TransitionWarrantyClaimRequest,
): Promise<WarrantyClaim> {
  return command(
    `${apiV1BaseUrl}/crm/after-sales/warranty-claims/${id}/transition`,
    token,
    key,
    input,
  );
}

export function sendCrmSurvey(
  token: string,
  key: string,
  input: SendCrmCustomerSurveyRequest,
): Promise<CrmCustomerSurvey> {
  return command(`${apiV1BaseUrl}/crm/after-sales/surveys`, token, key, input);
}

export function recordCrmSurveyResponse(
  token: string,
  id: string,
  key: string,
  input: RecordCrmSurveyResponseRequest,
): Promise<CrmCustomerSurvey> {
  return command(`${apiV1BaseUrl}/crm/after-sales/surveys/${id}/response`, token, key, input);
}

export function getPublicCrmSurvey(token: string): Promise<CrmPublicSurvey> {
  return publicRequest<CrmPublicSurvey>(
    `${apiV1BaseUrl}/crm/public-surveys/${encodeURIComponent(token)}`,
  );
}

export function submitPublicCrmSurvey(
  token: string,
  input: RecordCrmSurveyResponseRequest,
): Promise<CrmPublicSurvey> {
  return publicRequest<CrmPublicSurvey>(
    `${apiV1BaseUrl}/crm/public-surveys/${encodeURIComponent(token)}/response`,
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
}

export function createCrmReferral(
  token: string,
  key: string,
  input: CreateCrmReferralRequest,
): Promise<CrmReferral> {
  return command(`${apiV1BaseUrl}/crm/after-sales/referrals`, token, key, input);
}

function command<T>(url: string, token: string, key: string, body: object): Promise<T> {
  return request<T>(url, token, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    method: 'POST',
  });
}

async function request<T>(url: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = options.headers ? Object.fromEntries(new Headers(options.headers).entries()) : {};
  const response = await fetch(url, {
    ...options,
    headers: authorizationHeaders(token, headers),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
    throw new ApiClientError(
      body?.error.message ?? 'The customer-care request failed.',
      body?.error.code ?? 'CRM_AFTER_SALES_REQUEST_FAILED',
      response.status,
      body?.error.correlationId,
      body?.error.details,
    );
  }
  return (await response.json()) as T;
}

async function publicRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, credentials: 'omit' });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
    throw new ApiClientError(
      body?.error.message ?? 'The survey could not be opened.',
      body?.error.code ?? 'CRM_PUBLIC_SURVEY_REQUEST_FAILED',
      response.status,
      body?.error.correlationId,
      body?.error.details,
    );
  }
  return (await response.json()) as T;
}
