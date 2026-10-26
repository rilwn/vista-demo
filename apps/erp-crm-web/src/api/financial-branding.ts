import type { FinancialBrandingSettings, SaveFinancialBrandingRequest } from '@vista/contracts';
import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';
export function getFinancialBranding(
  token: string,
  id: string,
): Promise<FinancialBrandingSettings> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/document-branding/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}
export function saveFinancialBranding(
  token: string,
  id: string,
  body: SaveFinancialBrandingRequest,
  key: string,
): Promise<FinancialBrandingSettings> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/finance/document-branding/{id}', {
      headers: authorizationHeaders(token),
      params: { path: { id }, header: idempotencyParameters(key).header },
      body,
    }),
  );
}
