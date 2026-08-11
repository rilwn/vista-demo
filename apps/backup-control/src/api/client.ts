import { createVistaApiClientV1, resolveVistaBrowserApiBaseUrl } from '@vista/contracts';

const configuredApiBaseUrl: unknown = import.meta.env.VITE_API_BASE_URL;
const apiBaseUrl = resolveVistaBrowserApiBaseUrl(configuredApiBaseUrl, globalThis.location.origin);

export const backupApiClient = createVistaApiClientV1({ baseUrl: apiBaseUrl });
