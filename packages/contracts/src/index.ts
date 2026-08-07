export const API_VERSION = 'v1' as const;

export type ApiVersion = typeof API_VERSION;

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    correlationId: string;
    details?: ApiErrorDetail[];
    message: string;
    timestamp: string;
  };
}

export interface HealthCheck {
  detail?: string;
  latencyMs?: number;
  status: 'up' | 'down';
}

export interface HealthResponse {
  checks: Record<string, HealthCheck>;
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
}

export interface ApiPermission {
  action: string;
  module: string;
}

export interface AuthenticationAccountSummary {
  displayName: string;
  email: string;
  id: string;
  isAdministrative: boolean;
}

export interface AuthenticationContextResponse {
  accountId: string;
  displayName: string;
  email: string;
  employeeId: string;
  isAdministrative: boolean;
  permissions: ApiPermission[];
  sessionId: string;
  twoFactorVerified: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  totpCode?: string;
}

export interface LoginResponse {
  account: AuthenticationAccountSummary;
  expiresAt: string;
  sessionToken: string;
}

export const partnerKinds = ['legal_entity', 'individual'] as const;
export type PartnerKind = (typeof partnerKinds)[number];

export const partnerRoles = ['customer', 'supplier', 'partner'] as const;
export type PartnerRole = (typeof partnerRoles)[number];

export interface PartnerSummary {
  active: boolean;
  companyRepresentative?: string;
  createdAt: string;
  displayName: string;
  id: string;
  kind: PartnerKind;
  roles: PartnerRole[];
  uic?: string;
  updatedAt: string;
  vatNumber?: string;
  version: number;
}

export interface PartnerPage {
  items: PartnerSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CreatePartnerRequest {
  companyRepresentative?: string;
  displayName: string;
  kind: PartnerKind;
  roles: PartnerRole[];
  uic?: string;
  vatNumber?: string;
}

export interface PartnerDuplicateCandidate {
  displayName: string;
  id: string;
  kind: PartnerKind;
  matchedBy: Array<'name' | 'uic'>;
  roles: PartnerRole[];
  uic?: string;
}

export interface PartnerDuplicateResponse {
  candidates: PartnerDuplicateCandidate[];
}

export const partnerAddressTypes = ['registered', 'billing', 'delivery', 'other'] as const;
export type PartnerAddressType = (typeof partnerAddressTypes)[number];

export interface PartnerAddress {
  active: boolean;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  countryCode: string;
  id: string;
  postalCode?: string;
  type: PartnerAddressType;
}

export interface CreatePartnerAddressRequest {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  countryCode?: string;
  postalCode?: string;
  type: PartnerAddressType;
}

export interface PartnerContact {
  active: boolean;
  contactRole?: string;
  displayName: string;
  email?: string;
  id: string;
  jobTitle?: string;
  telephone?: string;
}

export interface CreatePartnerContactRequest {
  contactRole?: string;
  displayName: string;
  email?: string;
  jobTitle?: string;
  telephone?: string;
}

export interface PartnerBankAccount {
  active: boolean;
  bankName?: string;
  bic?: string;
  currencyCode: string;
  iban: string;
  id: string;
}

export interface CreatePartnerBankAccountRequest {
  bankName?: string;
  bic?: string;
  currencyCode?: string;
  iban: string;
}

export interface PartnerProfile {
  addresses: PartnerAddress[];
  bankAccounts: PartnerBankAccount[];
  contacts: PartnerContact[];
  partner: PartnerSummary;
}

export interface ProductCategory {
  active: boolean;
  createdAt: string;
  id: string;
  name: string;
  parentId?: string;
  requiresExpiry: boolean;
  trackingMode: ProductTrackingMode;
  updatedAt: string;
  version: number;
}

export const productTrackingModes = ['none', 'serial', 'batch'] as const;
export type ProductTrackingMode = (typeof productTrackingModes)[number];

export interface CreateProductCategoryRequest {
  name: string;
  parentId?: string;
  requiresExpiry?: boolean;
  trackingMode?: ProductTrackingMode;
}

export const barcodeTypes = ['ean13', 'ean8', 'upca', 'code128', 'other'] as const;
export type BarcodeType = (typeof barcodeTypes)[number];

export interface ProductBarcode {
  active: boolean;
  barcode: string;
  barcodeType: BarcodeType;
  id: string;
}

export interface ProductSummary {
  active: boolean;
  barcodes: ProductBarcode[];
  categoryId: string;
  createdAt: string;
  id: string;
  name: string;
  productCode: string;
  unitId: string;
  updatedAt: string;
  version: number;
  trackingMode: ProductTrackingMode;
}

export interface Unit {
  active: boolean;
  code: string;
  id: string;
  name: string;
  version: number;
}

export interface CreateUnitRequest {
  code: string;
  name: string;
}

export interface CreateProductRequest {
  barcodes?: Array<{ barcode: string; barcodeType?: BarcodeType }>;
  categoryId: string;
  name: string;
  productCode: string;
  unitId: string;
}

export const warehouseTypes = ['standard', 'technician'] as const;
export type WarehouseType = (typeof warehouseTypes)[number];

export interface Warehouse {
  active: boolean;
  code: string;
  id: string;
  name: string;
  type: WarehouseType;
  version: number;
}

export interface CreateWarehouseRequest {
  code: string;
  name: string;
  type?: WarehouseType;
}

export interface StockBalance {
  productId: string;
  quantity: string;
  warehouseId: string;
}

export interface ReceiveStockRequest {
  batchNumber?: string;
  expiresAt?: string;
  productId: string;
  quantity: string;
  referenceId: string;
  serialNumbers?: string[];
  warehouseId: string;
}

export interface StockReceipt {
  batchId?: string;
  id: string;
  productId: string;
  quantity: string;
  serialItemIds: string[];
  warehouseId: string;
}
