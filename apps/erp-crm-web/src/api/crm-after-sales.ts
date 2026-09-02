import type {
  ApiErrorResponse,
  CreateCrmReferralRequest,
  CreateWarrantyClaimRequest,
  CrmAfterSalesOverview,
  CrmCustomerSurvey,
  CrmReferral,
  CrmWarrantyCard,
  RecordCrmSurveyResponseRequest,
  SendCrmCustomerSurveyRequest,
  TransitionWarrantyClaimRequest,
  UpdateCrmWarrantyOfferRequest,
  WarrantyClaim,
} from '@vista/contracts';

import { ApiClientError, apiV1BaseUrl, authorizationHeaders } from './client';

export function getCrmAfterSalesOverview(token: string): Promise<CrmAfterSalesOverview> {
  return request<CrmAfterSalesOverview>(`${apiV1BaseUrl}/crm/after-sales`, token);
}

export function updateCrmWarrantyOffer(
  token: string,
  id: string,
  key: string,
  input: UpdateCrmWarrantyOfferRequest,
): Promise<CrmWarrantyCard> {
  return command(`${apiV1BaseUrl}/crm/after-sales/warranty-cards/${id}/offer`, token, key, input);
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
