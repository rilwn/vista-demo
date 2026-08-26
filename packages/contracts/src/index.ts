export const API_VERSION = 'v1' as const;

export {
  API_V1_PATH_PREFIX,
  createVistaApiClientV1,
  normalizeVistaApiBaseUrl,
  resolveVistaBrowserApiBaseUrl,
  type VistaApiClientV1,
} from './client.js';
export type {
  components as ApiComponentsV1,
  operations as ApiOperationsV1,
  paths as ApiPathsV1,
} from './generated/v1.js';

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

export type ApiPermissionAction = 'approve' | 'create' | 'delete' | 'edit' | 'view';
export type ApiPermissionModule =
  | 'backup'
  | 'crm'
  | 'erp.finance'
  | 'erp.logistics'
  | 'erp.procurement'
  | 'erp.sales'
  | 'erp.service'
  | 'erp.warehouse'
  | 'platform'
  | 'platform.organization'
  | 'pos'
  | 'reports';

export interface ApiPermission {
  action: '*' | ApiPermissionAction;
  module: '*' | ApiPermissionModule;
}

export interface RolePermission {
  action: ApiPermissionAction;
  module: ApiPermissionModule;
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

export type NotificationChannel = 'in_system' | 'email' | 'sms';

export interface NotificationMessage {
  channel: NotificationChannel;
  createdAt: string;
  deliveredAt: string;
  id: string;
  payload: Record<string, unknown>;
  readAt?: string;
  templateKey: string;
  templateVersion: number;
}

export interface NotificationPage {
  items: NotificationMessage[];
  unreadCount: number;
}

export const managedFileParentTypes = ['partner', 'warranty_claim'] as const;
export type ManagedFileParentType = (typeof managedFileParentTypes)[number];
export type ManagedFileStatus = 'available' | 'deleted' | 'quarantined' | 'rejected';

export interface ManagedFile {
  byteSize: number;
  checksumSha256: string;
  createdAt: string;
  id: string;
  inspectionMethod?: string;
  isCurrent: boolean;
  issuerAccountId: string;
  mediaType: string;
  originalName: string;
  parentId: string;
  parentType: ManagedFileParentType;
  scannedAt?: string;
  status: ManagedFileStatus;
  version: number;
  versionCount: number;
  versionGroupId: string;
}

export interface ManagedFilePage {
  items: ManagedFile[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type BackgroundJobState =
  | 'active'
  | 'completed'
  | 'delayed'
  | 'failed'
  | 'prioritized'
  | 'unknown'
  | 'waiting'
  | 'waiting-children';

/**
 * A deliberately payload-free operations view of a background job. Job payloads
 * may contain business or personal data and are never exposed by this API.
 */
export interface BackgroundJobSummary {
  attemptsMade: number;
  createdAt: string;
  failedAt?: string;
  finishedAt?: string;
  id: string;
  name: string;
  processedAt?: string;
  state: BackgroundJobState;
}

export interface BackgroundJobTelemetry {
  active: number;
  completed: number;
  delayed: number;
  failed: number;
  paused: boolean;
  timestamp: string;
  waiting: number;
}

export type IntegrationEventStatus =
  'completed' | 'dead_letter' | 'pending' | 'published' | 'publishing';

export type IntegrationDeliveryStatus =
  'completed' | 'dead_letter' | 'failed' | 'pending' | 'processing';

export interface IntegrationEventSummary {
  aggregateId: string;
  aggregateType: string;
  attemptCount: number;
  availableAt: string;
  completedAt?: string;
  correlationId: string;
  deadLetteredAt?: string;
  eventType: string;
  id: string;
  lastErrorCode?: string;
  occurredAt: string;
  publicationAttemptCount: number;
  publishedAt?: string;
  replayCount: number;
  sequenceNumber: string;
  status: IntegrationEventStatus;
}

export interface IntegrationDeliverySummary {
  attemptCount: number;
  completedAt?: string;
  consumer: string;
  cycleAttemptCount: number;
  deadLetteredAt?: string;
  failedAt?: string;
  lastErrorCode?: string;
  replayCount: number;
  status: IntegrationDeliveryStatus;
}

export interface IntegrationEventDetail extends IntegrationEventSummary {
  deliveries: IntegrationDeliverySummary[];
}

export interface IntegrationEventPage {
  items: IntegrationEventSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface IntegrationEventTelemetry {
  completed: number;
  deadLetter: number;
  failedDeliveries: number;
  oldestPendingAt?: string;
  pending: number;
  published: number;
  publishing: number;
  timestamp: string;
}

export interface ReplayIntegrationEventRequest {
  expectedReplayCount: number;
}

export type SecurityAccountStatus = 'active' | 'disabled' | 'locked';

export interface SecurityRoleBrief {
  code: string;
  id: string;
  isAdministrative: boolean;
  name: string;
}

export interface SecurityAccount {
  accountId: string;
  activeSessionCount: number;
  createdAt: string;
  displayName: string;
  email: string;
  employeeId: string;
  employeeNumber: string;
  roles: SecurityRoleBrief[];
  status: SecurityAccountStatus;
  twoFactorEnrolled: boolean;
  updatedAt: string;
  version: number;
}

export interface SecurityAccountPage {
  items: SecurityAccount[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CreateSecurityAccountRequest {
  displayName: string;
  email: string;
  employeeNumber: string;
  initialPassword: string;
}

export interface SecurityRole {
  code: string;
  description?: string;
  id: string;
  isAdministrative: boolean;
  isSystemRole: boolean;
  name: string;
  permissions: ApiPermission[];
  version: number;
}

export interface CreateSecurityRoleRequest {
  code: string;
  description?: string;
  isAdministrative: boolean;
  name: string;
  permissions: RolePermission[];
}

export interface ReplaceAccountRolesRequest {
  expectedVersion: number;
  roleIds: string[];
}

export interface ChangeAccountStatusRequest {
  expectedVersion: number;
}

export interface SecuritySession {
  accountId: string;
  createdAt: string;
  displayName: string;
  email: string;
  expiresAt: string;
  id: string;
  ipAddress?: string;
  lastSeenAt: string;
  revokedAt?: string;
  twoFactorVerified: boolean;
  userAgent?: string;
}

export interface AuditEventRecord {
  action: string;
  actorAccountId?: string;
  actorDisplayName?: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  correlationId: string;
  eventHash: string;
  id: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
  previousEventHash?: string;
  sourceIp?: string;
  targetId?: string;
  targetType: string;
  userAgent?: string;
}

export interface AuditEventPage {
  items: AuditEventRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuditIntegrityResult {
  brokenEventId?: string;
  checkedEvents: number;
  headHash?: string;
  valid: boolean;
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

export interface PasswordPolicyResponse {
  expirationDays: number;
  historyCount: number;
  minimumLength: number;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  requireUppercase: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  changedAt: string;
  expiresAt?: string;
  revokedOtherSessionCount: number;
}

export interface TotpEnrollmentStatus {
  enrolled: boolean;
  enrolledAt?: string;
}

export interface StartTotpEnrollmentRequest {
  currentPassword: string;
}

export interface StartTotpEnrollmentResponse {
  enrollmentId: string;
  expiresAt: string;
  manualEntryKey: string;
  provisioningUri: string;
}

export interface VerifyTotpEnrollmentRequest {
  code: string;
}

export interface VerifyTotpEnrollmentResponse extends TotpEnrollmentStatus {
  revokedOtherSessionCount: number;
}

export interface DisableTotpRequest {
  code: string;
  currentPassword: string;
}

export interface DisableTotpResponse extends TotpEnrollmentStatus {
  revokedOtherSessionCount: number;
}

export interface IssueAccountRecoveryHandoffRequest {
  expectedVersion: number;
  reason: string;
}

export interface AccountRecoveryHandoff {
  email: string;
  expiresAt: string;
  recoveryCode: string;
}

export interface CompleteAccountRecoveryRequest {
  email: string;
  newPassword: string;
  recoveryCode: string;
}

export interface CompleteAccountRecoveryResponse {
  expiresAt?: string;
  requiresTotpEnrollment: boolean;
}

export interface StartAccountRecoveryTotpRequest {
  email: string;
  recoveryCode: string;
}

export interface StartAccountRecoveryTotpResponse {
  enrollmentId: string;
  expiresAt: string;
  manualEntryKey: string;
  provisioningUri: string;
}

export interface VerifyAccountRecoveryTotpRequest {
  code: string;
  email: string;
  recoveryCode: string;
}

export type VerifyAccountRecoveryTotpResponse = TotpEnrollmentStatus;

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
export interface UpdatePartnerRequest extends CreatePartnerRequest {
  expectedVersion: number;
}
export interface RecordVersionRequest {
  expectedVersion: number;
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

export interface CreateCustomerLocationRequest {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  countryCode?: string;
  locationType: string;
  name: string;
  postalCode?: string;
  responsibleContactId?: string;
}
export interface UpdateCustomerLocationRequest extends CreateCustomerLocationRequest {
  expectedVersion: number;
}

export interface CustomerLocation {
  active: boolean;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  countryCode: string;
  id: string;
  locationType: string;
  name: string;
  partnerId: string;
  postalCode?: string;
  responsibleContact?: PartnerContact;
  version: number;
}

export const customerEquipmentStatuses = ['active', 'under_repair', 'retired'] as const;
export type CustomerEquipmentStatus = (typeof customerEquipmentStatuses)[number];

export interface CreateCustomerEquipmentRequest {
  deviceName: string;
  productId?: string;
  purchaseDate: string;
  serialNumber: string;
  status?: CustomerEquipmentStatus;
  warrantyEndsOn?: string;
  warrantyStartsOn?: string;
}
export interface UpdateCustomerEquipmentRequest {
  deviceName: string;
  expectedVersion: number;
  purchaseDate: string;
  status: CustomerEquipmentStatus;
  warrantyEndsOn?: string;
  warrantyStartsOn: string;
}

export interface CustomerEquipment {
  active: boolean;
  customerLocationId: string;
  deviceName: string;
  id: string;
  productId?: string;
  purchaseDate: string;
  serialNumber: string;
  serializedItemId?: string;
  status: CustomerEquipmentStatus;
  version: number;
  warrantyEndsOn?: string;
  warrantyStartsOn: string;
}

export interface CustomerLocationProfile {
  equipment: CustomerEquipment[];
  location: CustomerLocation;
}

export interface LegalBusinessEntity {
  active: boolean;
  code: string;
  id: string;
  name: string;
  uic?: string;
  vatNumber?: string;
  version: number;
}

export interface CreateLegalBusinessEntityRequest {
  code: string;
  name: string;
  uic?: string;
  vatNumber?: string;
}

export interface BusinessBranch {
  active: boolean;
  code: string;
  id: string;
  legalEntityId: string;
  name: string;
  version: number;
}

export interface CreateBusinessBranchRequest {
  code: string;
  name: string;
}

export interface BusinessLocation {
  active: boolean;
  addressLine1: string;
  addressLine2?: string;
  branchId: string;
  city: string;
  code: string;
  countryCode: string;
  id: string;
  locationType: string;
  name: string;
  postalCode?: string;
  version: number;
}

export interface CreateBusinessLocationRequest {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  code: string;
  countryCode?: string;
  locationType: string;
  name: string;
  postalCode?: string;
}

export interface OrganizationMember {
  accountId: string;
  displayName: string;
  email: string;
}

export interface BusinessOperator extends OrganizationMember {
  active: boolean;
  businessLocationId: string;
  code: string;
  id: string;
  version: number;
}

export interface CreateBusinessOperatorRequest {
  accountId: string;
  code: string;
}

export interface CashRegister {
  active: boolean;
  businessLocationId: string;
  code: string;
  id: string;
  name: string;
  operatorIds: string[];
  version: number;
}

export interface CreateCashRegisterRequest {
  code: string;
  name: string;
  operatorIds?: string[];
}

export interface OrganizationTopology {
  branches: BusinessBranch[];
  cashRegisters: CashRegister[];
  legalEntities: LegalBusinessEntity[];
  locations: BusinessLocation[];
  operators: BusinessOperator[];
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

export const purchaseOrderStatuses = ['open', 'partially_received', 'received'] as const;
export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];

export interface CreatePurchaseOrderLineRequest {
  expectedDeliveryDate: string;
  productId: string;
  quantity: string;
  unitPrice: string;
}

export interface CreatePurchaseOrderRequest {
  currencyCode: string;
  lines: CreatePurchaseOrderLineRequest[];
  supplierPartnerId: string;
  warehouseId: string;
}

export interface PurchaseOrderLine {
  deliveredQuantity: string;
  expectedDeliveryDate: string;
  id: string;
  invoicedQuantity: string;
  orderedQuantity: string;
  productId: string;
  productName: string;
  unitPrice: string;
}

export interface GoodsReceiptLine {
  batchId?: string;
  id: string;
  orderLineId: string;
  productId: string;
  quantity: string;
  serialItemIds: string[];
  stockMovementId: string;
  totalCostBgn: string;
  unitCostBgn: string;
}

export interface GoodsReceipt {
  id: string;
  lines: GoodsReceiptLine[];
  purchaseOrderId: string;
  receivedAt: string;
  supplierDeliveryReference?: string;
  warehouseId: string;
}

export interface PurchaseOrder {
  createdAt: string;
  currencyCode: string;
  id: string;
  lines: PurchaseOrderLine[];
  receipts: GoodsReceipt[];
  supplierInvoices: SupplierInvoice[];
  status: PurchaseOrderStatus;
  supplierName: string;
  supplierPartnerId: string;
  updatedAt: string;
  version: number;
  warehouseId: string;
  warehouseName: string;
}

export interface PurchaseOrderPage {
  items: PurchaseOrder[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProcurementReferenceData {
  products: Array<{
    id: string;
    name: string;
    productCode: string;
    requiresExpiry: boolean;
    trackingMode: ProductTrackingMode;
  }>;
  suppliers: Array<{ id: string; name: string }>;
  warehouses: Array<{ id: string; name: string }>;
}

export interface ReceivePurchaseOrderLineRequest {
  batchNumber?: string;
  expiresAt?: string;
  orderLineId: string;
  quantity: string;
  serialNumbers?: string[];
  unitCostBgn?: string;
}

export interface ReceivePurchaseOrderRequest {
  lines: ReceivePurchaseOrderLineRequest[];
  supplierDeliveryReference?: string;
}

export interface SupplierCommercialProfile {
  deliveryTerms?: string;
  paymentTermsDays?: number;
  supplierName: string;
  supplierPartnerId: string;
  updatedAt?: string;
  version: number;
}

export interface UpdateSupplierCommercialProfileRequest {
  deliveryTerms?: string;
  expectedVersion: number;
  paymentTermsDays?: number;
}

export interface SupplierEvaluation {
  evaluatedAt: string;
  evaluatedByAccountId: string;
  id: string;
  notes?: string;
  score: number;
  supplierPartnerId: string;
}

export interface CreateSupplierEvaluationRequest {
  notes?: string;
  score: number;
}

export interface ProcurementSupplierRecord {
  contacts: Array<{ email?: string; name: string; role?: string; telephone?: string }>;
  evaluations: SupplierEvaluation[];
  profile: SupplierCommercialProfile;
}

export interface CreateSupplierInvoiceLineRequest {
  orderLineId: string;
  quantity: string;
  unitPrice: string;
  vatRate?: string;
  vatTreatment: VatTreatment;
}

export interface CreateSupplierInvoiceRequest {
  invoiceDate: string;
  invoiceNumber: string;
  lines: CreateSupplierInvoiceLineRequest[];
  purchaseOrderId: string;
}

export interface SupplierInvoiceLine {
  grossTotal: string;
  id: string;
  lineTotal: string;
  netTotal: string;
  orderLineId: string;
  productId: string;
  productName: string;
  quantity: string;
  taxBreakdownRecorded: boolean;
  unitPrice: string;
  vatAmount?: string;
  vatRate?: string;
  vatTreatment?: VatTreatment;
}

export interface SupplierInvoice {
  currencyCode: string;
  id: string;
  invoiceDate: string;
  invoiceNumber: string;
  lines: SupplierInvoiceLine[];
  netTotal: string;
  purchaseOrderId: string;
  recordedAt: string;
  supplierName: string;
  supplierPartnerId: string;
  taxBreakdownComplete: boolean;
  total: string;
  vatTotal: string;
}

export const supplierClaimTypes = ['damaged', 'non_conforming'] as const;
export type SupplierClaimType = (typeof supplierClaimTypes)[number];
export const supplierClaimStatuses = ['open', 'submitted', 'resolved', 'closed'] as const;
export type SupplierClaimStatus = (typeof supplierClaimStatuses)[number];

export interface CreateSupplierClaimRequest {
  description: string;
  goodsReceiptLineId: string;
  quantity: string;
  type: SupplierClaimType;
}

export interface UpdateSupplierClaimStatusRequest {
  expectedVersion: number;
  note?: string;
  status: SupplierClaimStatus;
}

export interface SupplierClaimStatusEvent {
  changedAt: string;
  changedByAccountId: string;
  fromStatus?: SupplierClaimStatus;
  id: string;
  note?: string;
  toStatus: SupplierClaimStatus;
}

export interface SupplierClaim {
  createdAt: string;
  description: string;
  goodsReceiptId: string;
  goodsReceiptLineId: string;
  id: string;
  productId: string;
  productName: string;
  purchaseOrderId: string;
  quantity: string;
  status: SupplierClaimStatus;
  statusHistory: SupplierClaimStatusEvent[];
  supplierName: string;
  supplierPartnerId: string;
  type: SupplierClaimType;
  updatedAt: string;
  version: number;
}

export const vatTreatments = ['standard_20', 'reduced_9', 'zero', 'exempt', 'ica'] as const;
export type VatTreatment = (typeof vatTreatments)[number];

export interface SalesReferenceData {
  batches: Array<{
    batchNumber: string;
    productId: string;
    quantity: string;
    warehouseId: string;
  }>;
  customers: Array<{ id: string; name: string }>;
  products: Array<{
    id: string;
    name: string;
    productCode: string;
    trackingMode: 'batch' | 'none' | 'serial';
  }>;
  serials: Array<{
    productId: string;
    serialNumber: string;
    warehouseId: string;
  }>;
  warehouses: Array<{ id: string; name: string }>;
}

export interface CreateSalesQuotationLineRequest {
  discountPercent: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  vatTreatment: VatTreatment;
}

export interface CreateSalesQuotationRequest {
  currencyCode: string;
  customerPartnerId: string;
  lines: CreateSalesQuotationLineRequest[];
  overallDiscountPercent: string;
  validUntil: string;
  warehouseId: string;
}

export interface SalesQuotationLine extends CreateSalesQuotationLineRequest {
  id: string;
  lineTotal: string;
  productName: string;
  trackingMode: 'batch' | 'none' | 'serial';
}

export interface ConfirmSalesQuotationLineRequest {
  quotationLineId: string;
  serialNumbers?: string[];
}

export interface ConfirmSalesQuotationRequest {
  lines: ConfirmSalesQuotationLineRequest[];
}

export interface CreateSalesShipmentLineRequest {
  batchNumber?: string;
  orderLineId: string;
}

export interface CreateSalesShipmentRequest {
  lines: CreateSalesShipmentLineRequest[];
}

export interface SalesOrderLine {
  id: string;
  productId: string;
  productName: string;
  quantity: string;
  reservationId: string;
  reservedSerialNumbers: string[];
  trackingMode: 'batch' | 'none' | 'serial';
}

export interface SalesOrder {
  confirmedAt: string;
  id: string;
  lines: SalesOrderLine[];
  number: string;
  status: 'confirmed' | 'invoiced' | 'shipped';
}

export interface SalesShipmentLine {
  batchNumber?: string;
  id: string;
  orderLineId: string;
  productId: string;
  productName: string;
  quantity: string;
  serialNumbers: string[];
  stockMovementId: string;
}

export interface SalesShipment {
  id: string;
  lines: SalesShipmentLine[];
  number: string;
  shippedAt: string;
}

export interface SalesHandoverCertificateLine {
  id: string;
  productId: string;
  productName: string;
  quantity: string;
  serialNumbers: string[];
}

export interface SalesHandoverCertificate {
  acceptanceNotes?: string;
  acceptedAt?: string;
  acceptedByName?: string;
  id: string;
  lines: SalesHandoverCertificateLine[];
  number: string;
  preparedAt: string;
  status: 'accepted' | 'prepared';
  version: number;
}

export interface AcceptSalesHandoverRequest {
  acceptedByName: string;
  acceptanceNotes?: string;
  expectedVersion: number;
}

export interface SalesInvoiceLine {
  id: string;
  lineTotal: string;
  productId: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  vatTreatment: VatTreatment;
}

export interface SalesInvoice {
  currencyCode: string;
  customerName: string;
  customerPartnerId: string;
  id: string;
  lines: SalesInvoiceLine[];
  number: string;
  recordedAt: string;
  status: 'draft';
  subtotal: string;
  total: string;
  vatTotal: string;
}

export interface SalesWorkflow {
  createdAt: string;
  currencyCode: string;
  customerName: string;
  customerPartnerId: string;
  id: string;
  handover?: SalesHandoverCertificate;
  invoice?: SalesInvoice;
  lines: SalesQuotationLine[];
  number: string;
  order?: SalesOrder;
  overallDiscountPercent: string;
  shipment?: SalesShipment;
  status: 'confirmed' | 'draft' | 'invoiced' | 'shipped';
  subtotal: string;
  total: string;
  validUntil: string;
  vatTotal: string;
  warehouseId: string;
  warehouseName: string;
}

export const financePaymentMethods = [
  'cash',
  'bank_transfer',
  'pos_terminal',
  'card',
  'offset',
] as const;
export type FinancePaymentMethod = (typeof financePaymentMethods)[number];

export type FinancePaymentStatus = 'cancelled' | 'overdue' | 'paid' | 'partially_paid' | 'unpaid';

export interface FinanceInvoiceDraftReference {
  currencyCode: string;
  customerName: string;
  customerPartnerId: string;
  id: string;
  number: string;
  recordedAt: string;
  total: string;
}

export interface FinanceReferenceData {
  invoiceDrafts: FinanceInvoiceDraftReference[];
}

export interface CreateFinanceCustomerDocumentRequest {
  dueDate: string;
  salesInvoiceId: string;
}

export interface CreateFinancePaymentRequest {
  amount: string;
  notes?: string;
  paymentDate: string;
  paymentMethod: FinancePaymentMethod;
  paymentReference?: string;
}

export interface CancelFinanceCustomerDocumentRequest {
  cancellationReason: string;
  expectedVersion: number;
}

export interface FinancePayment {
  amount: string;
  allocatedAt: string;
  id: string;
  notes?: string;
  number: string;
  paymentDate: string;
  paymentMethod: FinancePaymentMethod;
  paymentReference?: string;
  recordedAt: string;
}

export interface FinancePaymentStatusHistoryEntry {
  changedAt: string;
  changedByName?: string;
  id: string;
  nextStatus: FinancePaymentStatus;
  previousStatus?: FinancePaymentStatus;
  reason: string;
}

export interface FinanceCustomerDocument {
  allocatedTotal: string;
  bgnTotal: string;
  createdAt: string;
  currencyCode: string;
  customerName: string;
  customerPartnerId: string;
  documentDate: string;
  dueDate: string;
  exchangeRate: string;
  id: string;
  number: string;
  outstandingTotal: string;
  paymentStatus: FinancePaymentStatus;
  payments: FinancePayment[];
  rateDate: string;
  rateSource: string;
  reviewState: 'cancelled' | 'pending_finance_review';
  sourceInvoiceNumber: string;
  sourceSalesInvoiceId: string;
  statusHistory: FinancePaymentStatusHistoryEntry[];
  total: string;
  version: number;
}

export interface FinanceSummary {
  activeDocuments: number;
  overdueOutstanding: string;
  paidDocuments: number;
  totalOutstanding: string;
}

export const financeAgingKinds = ['receivable', 'payable'] as const;
export type FinanceAgingKind = (typeof financeAgingKinds)[number];
export const financeAgingBuckets = [
  'current',
  'days_0_30',
  'days_31_60',
  'days_61_90',
  'over_90',
] as const;
export type FinanceAgingBucket = (typeof financeAgingBuckets)[number];

export interface FinanceAgingReportItem {
  bucket: FinanceAgingBucket;
  daysOverdue: number;
  documentDate: string;
  dueDate: string;
  id: string;
  number: string;
  originalBgnTotal: string;
  outstandingBgnTotal: string;
  partnerId: string;
  partnerName: string;
  paymentStatus: Exclude<FinancePaymentStatus, 'cancelled'>;
  sourceNumber: string;
}

export interface FinanceAgingTotals {
  current: string;
  days0To30: string;
  days31To60: string;
  days61To90: string;
  over90: string;
  total: string;
}

export interface FinanceAgingReport {
  asOf: string;
  items: FinanceAgingReportItem[];
  kind: FinanceAgingKind;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  totals: FinanceAgingTotals;
}

export const financeTurnoverKinds = ['customer', 'supplier'] as const;
export type FinanceTurnoverKind = (typeof financeTurnoverKinds)[number];

export interface FinanceTurnoverReportItem {
  allocatedBgnTotal: string;
  documentCount: number;
  grossBgnTotal: string;
  outstandingBgnTotal: string;
  partnerId: string;
  partnerName: string;
}

export interface FinanceTurnoverTotals {
  allocatedBgnTotal: string;
  documentCount: number;
  grossBgnTotal: string;
  outstandingBgnTotal: string;
}

export interface FinanceTurnoverReport {
  dateFrom: string;
  dateTo: string;
  items: FinanceTurnoverReportItem[];
  kind: FinanceTurnoverKind;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  totals: FinanceTurnoverTotals;
}

export const financeJournalKinds = ['sales', 'purchase'] as const;
export type FinanceJournalKind = (typeof financeJournalKinds)[number];

export interface FinanceJournalReportItem {
  currencyCode: string;
  documentDate: string;
  documentType: FinancialDocumentType | 'supplier_invoice';
  exchangeRate?: string;
  grossBgnTotal: string;
  id: string;
  netBgnTotal: string;
  number: string;
  partnerName: string;
  partnerVatNumber?: string;
  sourceNumber?: string;
  status: 'cancelled' | 'draft' | 'recorded';
  taxBreakdownComplete: boolean;
  taxEventDate?: string;
  vatBgnTotal: string;
}

export interface FinanceJournalTotals {
  documentCount: number;
  grossBgnTotal: string;
  incompleteTaxDocuments: number;
  netBgnTotal: string;
  vatBgnTotal: string;
}

export interface FinanceJournalReport {
  dateFrom: string;
  dateTo: string;
  items: FinanceJournalReportItem[];
  kind: FinanceJournalKind;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  totals: FinanceJournalTotals;
}

export type FinanceVatDirection = 'input' | 'output';

export interface FinanceVatReviewItem {
  direction: FinanceVatDirection;
  documentCount: number;
  netBgnTotal: string;
  vatBgnTotal: string;
  vatRate: string;
  vatTreatment: VatTreatment;
}

export interface FinanceVatReviewReport {
  dateFrom: string;
  dateTo: string;
  incompletePurchaseDocumentNumbers: string[];
  incompletePurchaseDocuments: number;
  items: FinanceVatReviewItem[];
  recordedDifferenceBgn: string;
  recordedInputVatBgn: string;
  recordedOutputVatBgn: string;
}

export const logisticsDeliveryMethods = ['company_transport', 'econt', 'speedy'] as const;
export type LogisticsDeliveryMethod = (typeof logisticsDeliveryMethods)[number];
export const logisticsDeliveryStatuses = [
  'planned',
  'in_transit',
  'delivered',
  'exception',
  'cancelled',
] as const;
export type LogisticsDeliveryStatus = (typeof logisticsDeliveryStatuses)[number];

export interface LogisticsShipmentLineReference {
  id: string;
  originalIssueMovementId: string;
  productId: string;
  productName: string;
  quantity: string;
  serialNumbers: string[];
  trackingMode: ProductTrackingMode;
}

export interface LogisticsShipmentReference {
  customerId: string;
  customerName: string;
  handoverCertificateId: string;
  handoverStatus: 'prepared' | 'accepted';
  handoverVersion: number;
  id: string;
  lines: LogisticsShipmentLineReference[];
  number: string;
  shippedAt: string;
}

export interface LogisticsLocationReference {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  countryCode: string;
  customerId: string;
  id: string;
  name: string;
  postalCode?: string;
}

export interface LogisticsWarehouseReference {
  id: string;
  name: string;
  type: string;
}

export interface LogisticsEquipmentReference {
  customerId: string;
  customerLocationId: string;
  deviceName: string;
  id: string;
  serialNumber: string;
  warrantyEndsOn?: string;
}

export interface LogisticsAssigneeReference {
  accountId: string;
  displayName: string;
  email: string;
}

export interface LogisticsServiceStopReference {
  addressLine: string;
  assignedAccountId: string;
  assignedTo: string;
  city: string;
  customerName: string;
  id: string;
  label: string;
  scheduledEnd: string;
  scheduledStart: string;
}

export interface LogisticsCourierConnection {
  connected: boolean;
  provider: 'econt' | 'speedy';
}

export interface LogisticsReferenceData {
  assignees: LogisticsAssigneeReference[];
  businessTimezone: string;
  courierConnections: LogisticsCourierConnection[];
  equipment: LogisticsEquipmentReference[];
  locations: LogisticsLocationReference[];
  serviceStops: LogisticsServiceStopReference[];
  shipments: LogisticsShipmentReference[];
  warehouses: LogisticsWarehouseReference[];
}

export interface LogisticsDeliveryHistoryEntry {
  changedAt: string;
  changedBy: string;
  nextStatus: LogisticsDeliveryStatus;
  note?: string;
  previousStatus?: LogisticsDeliveryStatus;
}

export interface LogisticsDelivery {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  countryCode: string;
  createdAt: string;
  customerId: string;
  customerLocationId: string;
  customerLocationName: string;
  customerName: string;
  deliveredAt?: string;
  deliveryMethod: LogisticsDeliveryMethod;
  exceptionReason?: string;
  handoverCertificateId: string;
  handoverStatus: 'prepared' | 'accepted';
  history: LogisticsDeliveryHistoryEntry[];
  id: string;
  instructions?: string;
  number: string;
  postalCode?: string;
  proofNotes?: string;
  recipientName?: string;
  scheduledEnd: string;
  scheduledStart: string;
  shipmentId: string;
  shipmentNumber: string;
  status: LogisticsDeliveryStatus;
  version: number;
}

export interface LogisticsDeliveryPage {
  items: LogisticsDelivery[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CreateLogisticsDeliveryRequest {
  customerLocationId: string;
  deliveryMethod: LogisticsDeliveryMethod;
  instructions?: string;
  scheduledEnd: string;
  scheduledStart: string;
  shipmentId: string;
}

export interface UpdateLogisticsDeliveryStatusRequest {
  expectedVersion: number;
  note?: string;
}

export interface CompleteLogisticsDeliveryRequest {
  deliveredAt: string;
  expectedVersion: number;
  proofNotes?: string;
  recipientName: string;
}

export interface ReportLogisticsDeliveryExceptionRequest {
  expectedVersion: number;
  reason: string;
}

export const logisticsReturnTransportMethods = [
  'company_transport',
  'customer_dropoff',
  'econt',
  'speedy',
] as const;
export type LogisticsReturnTransportMethod = (typeof logisticsReturnTransportMethods)[number];
export const logisticsReturnStatuses = ['registered', 'received', 'cancelled'] as const;
export type LogisticsReturnStatus = (typeof logisticsReturnStatuses)[number];
export const logisticsReturnDispositions = ['restock', 'service'] as const;
export type LogisticsReturnDisposition = (typeof logisticsReturnDispositions)[number];

export interface CreateLogisticsReturnLineRequest {
  customerEquipmentId?: string;
  destinationWarehouseId: string;
  disposition: LogisticsReturnDisposition;
  quantity: string;
  serialNumbers?: string[];
  serviceType?: 'warranty' | 'out_of_warranty';
  shipmentLineId: string;
}

export interface CreateLogisticsReturnRequest {
  customerLocationId: string;
  lines: CreateLogisticsReturnLineRequest[];
  originalShipmentId: string;
  reason: string;
  scheduledPickupAt?: string;
  transportMethod: LogisticsReturnTransportMethod;
}

export interface ReceiveLogisticsReturnRequest {
  expectedVersion: number;
}

export interface LogisticsReturnLine {
  customerEquipmentId?: string;
  customerEquipmentName?: string;
  destinationWarehouseId: string;
  destinationWarehouseName: string;
  disposition: LogisticsReturnDisposition;
  id: string;
  inventoryReturnMovementId?: string;
  productId: string;
  productName: string;
  quantity: string;
  serialNumbers: string[];
  serviceRequestId?: string;
  serviceRequestNumber?: string;
  serviceType?: 'warranty' | 'out_of_warranty';
  shipmentLineId: string;
}

export interface LogisticsReturn {
  createdAt: string;
  customerId: string;
  customerLocationId: string;
  customerLocationName: string;
  customerName: string;
  id: string;
  lines: LogisticsReturnLine[];
  number: string;
  originalShipmentId: string;
  originalShipmentNumber: string;
  reason: string;
  receivedAt?: string;
  scheduledPickupAt?: string;
  status: LogisticsReturnStatus;
  transportMethod: LogisticsReturnTransportMethod;
  version: number;
}

export interface LogisticsReturnPage {
  items: LogisticsReturn[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const logisticsRouteStatuses = ['planned', 'in_progress', 'completed', 'cancelled'] as const;
export type LogisticsRouteStatus = (typeof logisticsRouteStatuses)[number];

export interface CreateLogisticsRouteStopRequest {
  deliveryId?: string;
  plannedArrival: string;
  plannedDurationMinutes: number;
  serviceWorkOrderId?: string;
  stopType: 'delivery' | 'service';
}

export interface CreateLogisticsRouteRequest {
  assignedAccountId: string;
  notes?: string;
  routeDate: string;
  stops: CreateLogisticsRouteStopRequest[];
  title: string;
}

export interface LogisticsRouteStop {
  addressLine: string;
  city: string;
  deliveryId?: string;
  id: string;
  label: string;
  plannedArrival: string;
  plannedDurationMinutes: number;
  position: number;
  serviceWorkOrderId?: string;
  stopType: 'delivery' | 'service';
}

export interface LogisticsRoutePlan {
  assignedAccountId: string;
  assignedTo: string;
  createdAt: string;
  id: string;
  notes?: string;
  number: string;
  routeDate: string;
  status: LogisticsRouteStatus;
  stops: LogisticsRouteStop[];
  title: string;
  version: number;
}

export interface LogisticsRoutePlanPage {
  items: LogisticsRoutePlan[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const reportExportFormats = ['csv', 'xlsx', 'pdf'] as const;
export type ReportExportFormat = (typeof reportExportFormats)[number];
export const reportExportStatuses = ['queued', 'processing', 'completed', 'failed'] as const;
export type ReportExportStatus = (typeof reportExportStatuses)[number];
export const financeReportDefinitionKeys = [
  'finance.receivables-aging',
  'finance.supplier-payables-aging',
  'finance.customer-turnover',
  'finance.supplier-turnover',
  'finance.sales-journal',
  'finance.purchase-journal',
  'finance.vat-review',
] as const;
export type FinanceReportDefinitionKey = (typeof financeReportDefinitionKeys)[number];

export interface FinanceReportDefinition {
  description: string;
  formats: ReportExportFormat[];
  key: FinanceReportDefinitionKey;
  name: string;
  requiresDateRange: boolean;
}

export interface CreateFinanceReportExportRequest {
  dateFrom?: string;
  dateTo?: string;
  definitionKey: FinanceReportDefinitionKey;
  format: ReportExportFormat;
}

export interface FinanceReportExport {
  attemptCount: number;
  completedAt?: string;
  createdAt: string;
  definitionKey: FinanceReportDefinitionKey;
  errorCode?: string;
  fileName?: string;
  format: ReportExportFormat;
  id: string;
  name: string;
  rowCount?: number;
  sizeBytes?: number;
  status: ReportExportStatus;
}

export interface FinanceReportExportPage {
  items: FinanceReportExport[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const serviceReportDefinitionKeys = [
  'service.request-register',
  'service.technician-performance',
  'service.cost-summary',
] as const;
export type ServiceReportDefinitionKey = (typeof serviceReportDefinitionKeys)[number];

export interface ServiceReportDefinition {
  description: string;
  formats: ReportExportFormat[];
  key: ServiceReportDefinitionKey;
  name: string;
  requiresDateRange: true;
}

export interface CreateServiceReportExportRequest {
  dateFrom: string;
  dateTo: string;
  definitionKey: ServiceReportDefinitionKey;
  format: ReportExportFormat;
}

export interface ServiceReportExport {
  attemptCount: number;
  completedAt?: string;
  createdAt: string;
  definitionKey: ServiceReportDefinitionKey;
  errorCode?: string;
  fileName?: string;
  format: ReportExportFormat;
  id: string;
  name: string;
  rowCount?: number;
  sizeBytes?: number;
  status: ReportExportStatus;
}

export interface ServiceReportExportPage {
  items: ServiceReportExport[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ServiceReportStatusTotal {
  count: number;
  status: ServiceRequestStatus;
}

export interface ServiceReportTypeTotal {
  completedCount: number;
  requestCount: number;
  serviceType: ServiceType;
  totalCostBgn: string;
}

export interface ServiceTechnicianPerformance {
  assignedCount: number;
  completedCount: number;
  displayName: string;
  laborMinutes: number;
  totalCostBgn: string;
}

export interface ServiceReportOverview {
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  statusTotals: ServiceReportStatusTotal[];
  technicians: ServiceTechnicianPerformance[];
  totals: {
    cancelledRequests: number;
    completedRequests: number;
    laborMinutes: number;
    openRequests: number;
    totalCostBgn: string;
    totalRequests: number;
  };
  typeTotals: ServiceReportTypeTotal[];
}

export type FinanceSupplierPayableStatus = 'overdue' | 'paid' | 'partially_paid' | 'unpaid';
export type FinanceSupplierPaymentKind = 'advance' | 'offset' | 'payment';

export interface FinanceSupplierInvoiceReference {
  currencyCode: string;
  id: string;
  invoiceDate: string;
  invoiceNumber: string;
  paymentTermsDays?: number;
  suggestedDueDate: string;
  supplierName: string;
  supplierPartnerId: string;
  total: string;
}

export interface FinanceSupplierReference {
  id: string;
  name: string;
}

export interface FinanceOffsetReceivableReference {
  customerName: string;
  customerPartnerId: string;
  dueDate: string;
  id: string;
  number: string;
  outstandingTotal: string;
  sourceInvoiceNumber: string;
  version: number;
}

export interface FinanceSupplierReferenceData {
  businessDate: string;
  openReceivables: FinanceOffsetReceivableReference[];
  supplierInvoices: FinanceSupplierInvoiceReference[];
  suppliers: FinanceSupplierReference[];
}

export interface CreateFinanceSupplierPayableRequest {
  dueDate: string;
  supplierInvoiceId: string;
}

export interface CreateFinanceSupplierPaymentRequest {
  amount: string;
  notes?: string;
  paymentDate: string;
  paymentMethod: Exclude<FinancePaymentMethod, 'offset'>;
  paymentReference?: string;
}

export interface CreateFinanceSupplierAdvanceRequest extends CreateFinanceSupplierPaymentRequest {
  supplierPartnerId: string;
}

export interface AllocateFinanceSupplierAdvanceRequest {
  amount: string;
  expectedAdvanceVersion: number;
  expectedPayableVersion: number;
  supplierPayableId: string;
}

export interface CreateFinanceSupplierOffsetRequest {
  amount: string;
  customerDocumentId: string;
  expectedCustomerDocumentVersion: number;
  expectedSupplierPayableVersion: number;
  offsetDate: string;
  reason: string;
  supplierPayableId: string;
}

export interface FinanceSupplierPaymentAllocation {
  allocatedAt: string;
  amount: string;
  id: string;
  payableNumber: string;
  supplierPayableId: string;
}

export interface FinanceSupplierPayment {
  allocatedTotal: string;
  allocations: FinanceSupplierPaymentAllocation[];
  amount: string;
  availableTotal: string;
  id: string;
  kind: FinanceSupplierPaymentKind;
  notes?: string;
  number: string;
  paymentDate: string;
  paymentMethod: FinancePaymentMethod;
  paymentReference?: string;
  recordedAt: string;
  sourceBankTransactionId?: string;
  supplierName: string;
  supplierPartnerId: string;
  version: number;
}

export interface FinanceSupplierPayable {
  allocatedTotal: string;
  bgnTotal: string;
  createdAt: string;
  currencyCode: string;
  documentDate: string;
  dueDate: string;
  exchangeRate: string;
  id: string;
  number: string;
  outstandingTotal: string;
  paymentStatus: FinanceSupplierPayableStatus;
  payments: FinanceSupplierPayment[];
  rateDate: string;
  rateSource: string;
  sourceSupplierInvoiceId: string;
  sourceSupplierInvoiceNumber: string;
  supplierName: string;
  supplierPartnerId: string;
  total: string;
  version: number;
}

export interface FinanceSupplierPayablePage {
  items: FinanceSupplierPayable[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface FinanceSupplierAdvancePage {
  items: FinanceSupplierPayment[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface FinanceSupplierOffset {
  amount: string;
  createdAt: string;
  customerDocumentId: string;
  customerDocumentNumber: string;
  id: string;
  number: string;
  offsetDate: string;
  partnerId: string;
  partnerName: string;
  reason: string;
  supplierPayableId: string;
  supplierPayableNumber: string;
}

export interface FinanceSupplierOffsetPage {
  items: FinanceSupplierOffset[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface FinanceSupplierBankMatchCandidate {
  dueDate: string;
  outstandingTotal: string;
  payableNumber: string;
  referenceMatched: boolean;
  score: number;
  sourceSupplierInvoiceNumber: string;
  supplierName: string;
  supplierPartnerId: string;
  supplierPayableId: string;
}

export interface MatchFinanceSupplierBankTransactionRequest {
  expectedVersion: number;
  mode: 'advance' | 'payable';
  supplierPartnerId?: string;
  supplierPayableId?: string;
}

export const financeBankTransactionDirections = ['incoming', 'outgoing'] as const;
export type FinanceBankTransactionDirection = (typeof financeBankTransactionDirections)[number];
export type FinanceBankTransactionMatchStatus = 'matched' | 'unmatched';

export interface CreateFinanceBankStatementLineRequest {
  amount: string;
  counterpartyIban?: string;
  counterpartyName: string;
  direction: FinanceBankTransactionDirection;
  paymentReference: string;
  transactionDate: string;
  valueDate: string;
}

export interface CreateFinanceBankStatementRequest {
  accountIban: string;
  bankName: string;
  closingBalance: string;
  currencyCode: string;
  lines: CreateFinanceBankStatementLineRequest[];
  openingBalance: string;
  statementDate: string;
  statementReference: string;
}

export interface MatchFinanceBankTransactionRequest {
  customerDocumentId: string;
  expectedVersion: number;
}

export interface FinanceBankTransactionMatch {
  customerDocumentId: string;
  customerName: string;
  documentNumber: string;
  matchedAt: string;
  method: 'automatic_reference' | 'manual';
  paymentNumber: string;
}

export interface FinanceSupplierBankTransactionMatch {
  kind: 'advance' | 'payment';
  matchedAt: string;
  method: 'automatic_reference' | 'manual';
  paymentNumber: string;
  supplierName: string;
  supplierPartnerId: string;
  supplierPayableId?: string;
  supplierPayableNumber?: string;
}

export interface FinanceBankTransaction {
  amount: string;
  counterpartyIban?: string;
  counterpartyName: string;
  direction: FinanceBankTransactionDirection;
  id: string;
  lineNumber: number;
  match?: FinanceBankTransactionMatch;
  supplierMatch?: FinanceSupplierBankTransactionMatch;
  matchStatus: FinanceBankTransactionMatchStatus;
  paymentReference: string;
  transactionDate: string;
  valueDate: string;
  version: number;
}

export interface FinanceBankStatementSummary {
  accountIban: string;
  bankName: string;
  closingBalance: string;
  createdAt: string;
  currencyCode: string;
  id: string;
  incomingTotal: string;
  matchedIncomingCount: number;
  matchedOutgoingCount: number;
  number: string;
  openingBalance: string;
  outgoingTotal: string;
  statementDate: string;
  statementReference: string;
  status: 'open' | 'reconciled';
  transactionCount: number;
  unmatchedIncomingCount: number;
  unmatchedOutgoingCount: number;
  version: number;
}

export interface FinanceBankStatement extends FinanceBankStatementSummary {
  transactions: FinanceBankTransaction[];
}

export interface FinanceBankStatementPage {
  items: FinanceBankStatementSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface FinanceBankMatchCandidate {
  customerDocumentId: string;
  customerName: string;
  documentNumber: string;
  dueDate: string;
  outstandingTotal: string;
  referenceMatched: boolean;
  score: number;
  sourceInvoiceNumber: string;
}

export const financeCashVoucherDirections = ['receipt', 'payment'] as const;
export type FinanceCashVoucherDirection = (typeof financeCashVoucherDirections)[number];
export const financeCashVoucherStatuses = ['issued', 'cancelled'] as const;
export type FinanceCashVoucherStatus = (typeof financeCashVoucherStatuses)[number];

export interface FinanceCashOperatorReference {
  code: string;
  id: string;
  name: string;
}

export interface FinanceCashRegisterReference {
  branchName: string;
  businessLocationId: string;
  businessLocationName: string;
  code: string;
  id: string;
  name: string;
  operators: FinanceCashOperatorReference[];
}

export interface FinanceCashPartnerReference {
  id: string;
  name: string;
  roles: Array<'customer' | 'supplier'>;
}

export interface FinanceCashCollectionReference {
  customerName: string;
  customerPartnerId: string;
  dueDate: string;
  id: string;
  number: string;
  outstandingTotal: string;
  sourceInvoiceNumber: string;
}

export interface FinanceCashReferenceData {
  businessDate: string;
  cashRegisters: FinanceCashRegisterReference[];
  openCollections: FinanceCashCollectionReference[];
  partners: FinanceCashPartnerReference[];
}

export interface CreateFinanceCashVoucherRequest {
  amount: string;
  cashRegisterId: string;
  counterpartyName?: string;
  counterpartyPartnerId?: string;
  customerDocumentId?: string;
  direction: FinanceCashVoucherDirection;
  notes?: string;
  operatorId: string;
  paymentReference?: string;
  purpose: string;
  voucherDate: string;
}

export interface CancelFinanceCashVoucherRequest {
  cancellationReason: string;
  expectedVersion: number;
}

export interface FinanceCashVoucher {
  amount: string;
  branchName: string;
  businessLocationId: string;
  businessLocationName: string;
  cancelledAt?: string;
  cancellationReason?: string;
  cashRegisterCode: string;
  cashRegisterId: string;
  cashRegisterName: string;
  collectionNumber?: string;
  counterpartyName: string;
  counterpartyPartnerId?: string;
  createdAt: string;
  currencyCode: string;
  customerDocumentId?: string;
  direction: FinanceCashVoucherDirection;
  id: string;
  issuedByName: string;
  notes?: string;
  number: string;
  operatorCode: string;
  operatorId: string;
  operatorName: string;
  paymentNumber?: string;
  paymentReference?: string;
  purpose: string;
  status: FinanceCashVoucherStatus;
  version: number;
  voucherDate: string;
}

export interface FinanceCashVoucherPage {
  items: FinanceCashVoucher[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface FinanceCashDailyReport {
  cashRegisterCode: string;
  cashRegisterId: string;
  cashRegisterName: string;
  closingBalance: string;
  generatedAt: string;
  openingBalance: string;
  paymentCount: number;
  paymentTotal: string;
  receiptCount: number;
  receiptTotal: string;
  reportDate: string;
  vouchers: FinanceCashVoucher[];
}

export const financialDocumentTypes = ['invoice', 'proforma', 'credit_note', 'debit_note'] as const;
export type FinancialDocumentType = (typeof financialDocumentTypes)[number];

export const financialDocumentStatuses = ['draft', 'cancelled'] as const;
export type FinancialDocumentStatus = (typeof financialDocumentStatuses)[number];

export interface FinancialDocumentPartySnapshot {
  address: string;
  name: string;
  uic?: string;
  vatNumber?: string;
}

export interface FinancialDocumentScopeReference {
  branchId: string;
  branchName: string;
  cashRegisters: Array<{ id: string; name: string }>;
  legalEntityId: string;
  legalEntityName: string;
  locationId: string;
  locationName: string;
  operators: Array<{ id: string; name: string }>;
}

export interface FinancialDocumentCustomerReference {
  id: string;
  name: string;
  uic?: string;
  vatNumber?: string;
}

export interface FinancialDocumentProductReference {
  code: string;
  id: string;
  name: string;
  unitCode: string;
  unitName: string;
}

export interface FinancialDocumentSalesDraftLineReference {
  description: string;
  discountPercent: string;
  productId: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  vatTreatment: VatTreatment;
}

export interface FinancialDocumentSalesDraftReference {
  currencyCode: string;
  customerName: string;
  customerPartnerId: string;
  id: string;
  linkedDocumentTypes: FinancialDocumentType[];
  lines: FinancialDocumentSalesDraftLineReference[];
  number: string;
  total: string;
}

export interface FinancialDocumentServiceDraftLineReference {
  description: string;
  discountPercent: string;
  productId?: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  vatTreatment: VatTreatment;
}

export interface FinancialDocumentServiceDraftReference {
  currencyCode: 'BGN';
  customerName: string;
  customerPartnerId: string;
  id: string;
  linkedDocumentTypes: FinancialDocumentType[];
  lines: FinancialDocumentServiceDraftLineReference[];
  number: string;
  total: string;
}

export interface FinancialDocumentCorrectionReference {
  currencyCode: string;
  customerName: string;
  customerPartnerId: string;
  id: string;
  number: string;
  type: 'invoice';
}

export interface FinancialDocumentReferenceData {
  businessTimezone: string;
  correctionDocuments: FinancialDocumentCorrectionReference[];
  customers: FinancialDocumentCustomerReference[];
  products: FinancialDocumentProductReference[];
  salesDrafts: FinancialDocumentSalesDraftReference[];
  serviceDrafts: FinancialDocumentServiceDraftReference[];
  scopes: FinancialDocumentScopeReference[];
}

export interface CreateFinancialDocumentLineRequest {
  description: string;
  discountPercent: string;
  productId?: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  vatRate?: string;
  vatTreatment: VatTreatment;
}

export interface CreateFinancialDocumentRequest {
  businessLocationId: string;
  cashRegisterId?: string;
  correctionOfDocumentId?: string;
  correctionReason?: string;
  currencyCode: string;
  customerPartnerId: string;
  documentType: FinancialDocumentType;
  dueDate?: string;
  exchangeRate: string;
  issueDate: string;
  legalEntityId: string;
  lines?: CreateFinancialDocumentLineRequest[];
  notes?: string;
  operatorId?: string;
  rateDate: string;
  rateSource: string;
  sourceSalesInvoiceId?: string;
  sourceServiceWorkOrderId?: string;
  taxEventDate: string;
}

export interface CancelFinancialDocumentRequest {
  cancellationReason: string;
  expectedVersion: number;
}

export interface FinancialDocumentLine {
  description: string;
  discountPercent: string;
  grossTotal: string;
  id: string;
  lineNumber: number;
  netTotal: string;
  productId?: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  vatAmount: string;
  vatRate: string;
  vatTreatment: VatTreatment;
}

export interface FinancialDocumentVatSummary {
  netTotal: string;
  vatAmount: string;
  vatRate: string;
  vatTreatment: VatTreatment;
}

export interface FinancialDocument {
  bgnGrossTotal: string;
  bgnNetTotal: string;
  bgnVatTotal: string;
  branchName: string;
  businessLocationId: string;
  businessLocationName: string;
  cancellationReason?: string;
  cashRegisterName?: string;
  correctionOf?: FinancialDocumentCorrectionReference;
  correctionReason?: string;
  createdAt: string;
  currencyCode: string;
  customerPartnerId: string;
  customerSnapshot: FinancialDocumentPartySnapshot;
  documentType: FinancialDocumentType;
  dueDate?: string;
  exchangeRate: string;
  grossTotal: string;
  id: string;
  issueDate: string;
  issuerSnapshot: FinancialDocumentPartySnapshot;
  legalEntityId: string;
  lines: FinancialDocumentLine[];
  netTotal: string;
  notes?: string;
  number: string;
  officialNumber?: string;
  operatorName?: string;
  rateDate: string;
  rateSource: string;
  sourceSalesInvoiceId?: string;
  sourceSalesInvoiceNumber?: string;
  sourceServiceWorkOrderId?: string;
  sourceServiceWorkOrderNumber?: string;
  status: FinancialDocumentStatus;
  taxEventDate: string;
  vatSummary: FinancialDocumentVatSummary[];
  vatTotal: string;
  version: number;
}

export interface FinancialDocumentPage {
  items: FinancialDocument[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export const manualServiceRequestChannels = [
  'telephone',
  'email',
  'customer_portal',
  'on_site',
] as const;
export type ManualServiceRequestChannel = (typeof manualServiceRequestChannels)[number];

export const serviceRequestChannels = [...manualServiceRequestChannels, 'service_plan'] as const;
export type ServiceRequestChannel = (typeof serviceRequestChannels)[number];

export const serviceTypes = ['warranty', 'out_of_warranty', 'subscription'] as const;
export type ServiceType = (typeof serviceTypes)[number];

export const servicePriorities = ['low', 'normal', 'high', 'critical'] as const;
export type ServicePriority = (typeof servicePriorities)[number];

export type ServiceRequestStatus = 'new' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export type ServiceWorkOrderStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface ServiceCustomerReference {
  id: string;
  name: string;
}

export interface ServiceLocationReference {
  customerPartnerId: string;
  id: string;
  name: string;
}

export interface ServiceEquipmentReference {
  active: boolean;
  customerLocationId: string;
  customerPartnerId: string;
  deviceName: string;
  id: string;
  serialNumber: string;
  status: 'active' | 'under_repair' | 'retired';
  warrantyEndsOn?: string;
}

export interface ServiceTechnicianReference {
  accountId: string;
  displayName: string;
  email: string;
  warehouseId: string;
  warehouseName: string;
}

export interface ServicePartReference {
  availableQuantity: string;
  productCode: string;
  productId: string;
  productName: string;
  trackingMode: ProductTrackingMode;
  warehouseId: string;
}

export interface ServiceSubscriptionReference {
  customerEquipmentIds: string[];
  customerLocationId: string;
  customerPartnerId: string;
  id: string;
  number: string;
}

export interface ServiceReferenceData {
  businessTimezone: string;
  customers: ServiceCustomerReference[];
  equipment: ServiceEquipmentReference[];
  locations: ServiceLocationReference[];
  parts: ServicePartReference[];
  subscriptions: ServiceSubscriptionReference[];
  technicians: ServiceTechnicianReference[];
}

export interface CreateServiceRequest {
  customerEquipmentId: string;
  customerLocationId: string;
  customerPartnerId: string;
  priority: ServicePriority;
  problemDescription: string;
  sourceChannel: ManualServiceRequestChannel;
  subscriptionContractId?: string;
  serviceType: ServiceType;
}

export const crmTicketChannels = [
  'telephone',
  'email',
  'customer_portal',
  'on_site',
  'chat',
] as const;
export type CrmTicketChannel = (typeof crmTicketChannels)[number];

export const crmTicketPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export type CrmTicketPriority = (typeof crmTicketPriorities)[number];

export const crmTicketStatuses = [
  'new',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
  'cancelled',
] as const;
export type CrmTicketStatus = (typeof crmTicketStatuses)[number];

export type CrmSlaTimerState = 'on_track' | 'at_risk' | 'breached' | 'met';

export interface CrmTicketCategory {
  code: string;
  id: string;
  name: string;
}

export interface CrmSlaPolicyReference {
  customerPartnerId?: string;
  id: string;
  name: string;
  priority?: CrmTicketPriority;
  responseMinutes: number;
  resolutionMinutes: number;
  serviceSubscriptionContractId?: string;
}

export interface CrmTicketAssigneeReference {
  displayName: string;
  id: string;
}

export interface CrmTicketReferenceData {
  assignees: CrmTicketAssigneeReference[];
  businessTimezone: string;
  categories: CrmTicketCategory[];
  customers: ServiceCustomerReference[];
  equipment: ServiceEquipmentReference[];
  locations: ServiceLocationReference[];
  slaPolicies: CrmSlaPolicyReference[];
  subscriptions: ServiceSubscriptionReference[];
}

export interface CrmTicketHistoryEntry {
  changedAt: string;
  changedByName?: string;
  id: string;
  note?: string;
  status: CrmTicketStatus;
  type: 'created' | 'response' | 'status_change' | 'service_link';
}

export interface CrmTicketServiceLink {
  correlationId: string;
  serviceRequestId: string;
  serviceRequestNumber: string;
}

export interface CrmTicket {
  assignedTo?: CrmTicketAssigneeReference;
  category: CrmTicketCategory;
  channel: CrmTicketChannel;
  createdAt: string;
  customerEquipmentId?: string;
  customerLocationId?: string;
  customerName: string;
  customerPartnerId: string;
  description: string;
  equipmentName?: string;
  history: CrmTicketHistoryEntry[];
  id: string;
  locationName?: string;
  number: string;
  priority: CrmTicketPriority;
  respondedAt?: string;
  responseDueAt: string;
  responseState: CrmSlaTimerState;
  resolutionDueAt: string;
  resolutionState: CrmSlaTimerState;
  resolvedAt?: string;
  serviceLink?: CrmTicketServiceLink;
  serviceSubscriptionContractId?: string;
  slaPolicy: CrmSlaPolicyReference;
  status: CrmTicketStatus;
  subject: string;
  updatedAt: string;
  version: number;
}

export interface CrmTicketPage {
  items: CrmTicket[];
  page: number;
  pageSize: number;
  summary: {
    atRisk: number;
    breached: number;
    open: number;
    unassigned: number;
  };
  total: number;
  totalPages: number;
}

export interface CreateCrmTicketRequest {
  assignedToAccountId?: string;
  categoryId: string;
  channel: CrmTicketChannel;
  customerEquipmentId?: string;
  customerLocationId?: string;
  customerPartnerId: string;
  description: string;
  priority: CrmTicketPriority;
  serviceSubscriptionContractId?: string;
  slaPolicyId: string;
  subject: string;
}

export interface RecordCrmTicketResponseRequest {
  expectedVersion: number;
  note: string;
}

export interface TransitionCrmTicketRequest {
  expectedVersion: number;
  note: string;
  status: CrmTicketStatus;
}

export interface CreateServiceRequestFromCrmTicketRequest {
  expectedVersion: number;
  serviceType: ServiceType;
  subscriptionContractId?: string;
}

export interface CreateCrmTicketFromServiceRequestRequest {
  assignedToAccountId?: string;
  categoryId: string;
  priority: CrmTicketPriority;
  slaPolicyId: string;
}

export interface AssignServiceWorkOrderRequest {
  expectedVersion: number;
  scheduledEnd: string;
  scheduledStart: string;
  technicianAccountId: string;
  technicianWarehouseId: string;
}

export interface ServiceTechnicianScheduleWindow {
  capacityMinutes: number;
  endsAt: string;
  maxVisits: number;
  startsAt: string;
  weekday: number;
}

export interface ServiceTechnicianSchedulePolicy {
  configured: boolean;
  technicianAccountId: string;
  version: number;
  windows: ServiceTechnicianScheduleWindow[];
}

export interface UpdateServiceTechnicianSchedulePolicyRequest {
  expectedVersion: number;
  windows: ServiceTechnicianScheduleWindow[];
}

export interface ServiceScheduleAppointment {
  customerLocationName: string;
  customerName: string;
  deviceName: string;
  priority: ServicePriority;
  requestNumber: string;
  scheduledEnd: string;
  scheduledStart: string;
  status: ServiceWorkOrderStatus;
  workOrderId: string;
  workOrderNumber: string;
}

export interface ServiceScheduleDay {
  bookedMinutes: number;
  capacityMinutes?: number;
  date: string;
  endsAt?: string;
  maxVisits?: number;
  remainingMinutes?: number;
  startsAt?: string;
  visits: ServiceScheduleAppointment[];
}

export interface ServiceTechnicianWorkload {
  bookedMinutes: number;
  capacityMinutes?: number;
  days: ServiceScheduleDay[];
  policy: ServiceTechnicianSchedulePolicy;
  remainingMinutes?: number;
  technician: ServiceTechnicianReference;
  visitCount: number;
}

export interface ServiceSchedule {
  businessTimezone: string;
  dateFrom: string;
  dateTo: string;
  technicians: ServiceTechnicianWorkload[];
}

export interface StartServiceWorkOrderRequest {
  expectedVersion: number;
}

export interface ServiceWorkTimeEntryInput {
  minutes: number;
  note?: string;
  workDate: string;
}

export interface ServicePartUsageInput {
  batchNumber?: string;
  productId: string;
  quantity: string;
  serialNumbers?: string[];
}

export interface CompleteServiceWorkOrderRequest {
  completionNotes: string;
  expectedVersion: number;
  laborCostBgn: string;
  parts: ServicePartUsageInput[];
  signatureImageDataUrl: string;
  signerName: string;
  timeEntries: ServiceWorkTimeEntryInput[];
  transportCostBgn: string;
}

export interface CancelServiceRequest {
  cancellationReason: string;
  expectedVersion: number;
}

export interface ServiceRequest {
  assignedTechnician?: ServiceTechnicianReference;
  completedAt?: string;
  createdAt: string;
  customerEquipmentId: string;
  customerLocationId: string;
  customerLocationName: string;
  customerName: string;
  customerPartnerId: string;
  deviceName: string;
  id: string;
  number: string;
  plannedVisitDate?: string;
  priority: ServicePriority;
  problemDescription: string;
  scheduledEnd?: string;
  scheduledStart?: string;
  serialNumber: string;
  serviceType: ServiceType;
  sourceChannel: ServiceRequestChannel;
  status: ServiceRequestStatus;
  subscriptionContractId?: string;
  updatedAt: string;
  version: number;
  workOrderId?: string;
  workOrderNumber?: string;
}

export interface ServiceRequestPage {
  items: ServiceRequest[];
  page: number;
  pageSize: number;
  summary: {
    completed: number;
    inProgress: number;
    new: number;
    scheduled: number;
  };
  total: number;
  totalPages: number;
}

export interface ServiceWorkOrderTimeEntry {
  id: string;
  minutes: number;
  note?: string;
  recordedAt: string;
  workDate: string;
}

export interface ServiceWorkOrderPartUsage {
  batchNumber?: string;
  id: string;
  productId: string;
  productName: string;
  quantity: string;
  serialNumbers: string[];
  stockIssueId: string;
  totalCostBgn: string;
  unitCostBgn: string;
  warehouseId: string;
  warehouseName: string;
}

export interface ServiceWorkOrderPhoto {
  capturedAt: string;
  fileName: string;
  id: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
}

export interface ServiceWorkOrderSignature {
  signedAt: string;
  signerName: string;
}

export interface ServiceWorkOrderHistoryEntry {
  changedAt: string;
  changedByName?: string;
  id: string;
  nextStatus: ServiceWorkOrderStatus;
  previousStatus?: ServiceWorkOrderStatus;
  reason: string;
}

export interface ServiceWorkOrder {
  assignedTechnician?: ServiceTechnicianReference;
  completedAt?: string;
  completionNotes?: string;
  createdAt: string;
  customerEquipmentId: string;
  customerLocationId: string;
  customerLocationName: string;
  customerName: string;
  customerPartnerId: string;
  deviceName: string;
  financialDocumentId?: string;
  financialDocumentNumber?: string;
  history: ServiceWorkOrderHistoryEntry[];
  id: string;
  laborCostBgn: string;
  laborMinutes: number;
  number: string;
  parts: ServiceWorkOrderPartUsage[];
  partsCostBgn: string;
  photos: ServiceWorkOrderPhoto[];
  priority: ServicePriority;
  problemDescription: string;
  requestId: string;
  requestNumber: string;
  scheduledEnd?: string;
  scheduledStart?: string;
  serialNumber: string;
  serviceType: ServiceType;
  signature?: ServiceWorkOrderSignature;
  startedAt?: string;
  status: ServiceWorkOrderStatus;
  subscriptionContractId?: string;
  timeEntries: ServiceWorkOrderTimeEntry[];
  totalCostBgn: string;
  transportCostBgn: string;
  updatedAt: string;
  version: number;
}

export interface ServiceWorkOrderPage {
  items: ServiceWorkOrder[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ServiceEquipmentHistoryEvent {
  completedAt?: string;
  description: string;
  id: string;
  occurredAt: string;
  parts: ServiceWorkOrderPartUsage[];
  serviceType: ServiceType;
  status: ServiceWorkOrderStatus;
  technicianName?: string;
  workOrderNumber: string;
}

export interface ServiceEquipmentHistory {
  deviceName: string;
  equipmentId: string;
  events: ServiceEquipmentHistoryEvent[];
  serialNumber: string;
  warrantyEndsOn?: string;
}

export const warrantyClaimStatuses = [
  'received',
  'under_review',
  'approved',
  'rejected',
  'closed',
] as const;
export type WarrantyClaimStatus = (typeof warrantyClaimStatuses)[number];

export const serviceInspectionTypes = ['technical', 'metrological'] as const;
export type ServiceInspectionType = (typeof serviceInspectionTypes)[number];

export interface ServiceWarrantySummary {
  activeClaimCount: number;
  claimCount: number;
  customerLocationName: string;
  customerName: string;
  deviceName: string;
  equipmentId: string;
  remainingDays?: number;
  serialNumber: string;
  status: 'active' | 'expired' | 'not_recorded';
  warrantyEndsOn?: string;
}

export interface WarrantyClaimHistoryEntry {
  changedAt: string;
  changedByName?: string;
  id: string;
  nextStatus: WarrantyClaimStatus;
  note?: string;
  previousStatus?: WarrantyClaimStatus;
}

export interface WarrantyClaim {
  attachments: ManagedFile[];
  customerEquipmentId: string;
  customerLocationId: string;
  customerLocationName: string;
  customerName: string;
  customerPartnerId: string;
  decisionNote?: string;
  description: string;
  deviceName: string;
  history: WarrantyClaimHistoryEntry[];
  id: string;
  number: string;
  receivedAt: string;
  serialNumber: string;
  serviceRequestId?: string;
  status: WarrantyClaimStatus;
  updatedAt: string;
  version: number;
}

export interface CreateWarrantyClaimRequest {
  customerEquipmentId: string;
  customerLocationId: string;
  customerPartnerId: string;
  description: string;
  serviceRequestId?: string;
}

export interface TransitionWarrantyClaimRequest {
  expectedVersion: number;
  nextStatus: WarrantyClaimStatus;
  note?: string;
}

export interface ServiceInspectionRecord {
  completedOn: string;
  dueDate: string;
  id: string;
  notes: string;
  outcome: 'passed' | 'attention_required';
}

export interface ServiceInspectionPlan {
  active: boolean;
  customerLocationName: string;
  customerName: string;
  deviceName: string;
  equipmentId: string;
  id: string;
  inspectionType: ServiceInspectionType;
  intervalMonths: number;
  lastCompletedOn?: string;
  nextDueDate: string;
  records: ServiceInspectionRecord[];
  reminderLeadDays: number;
  serialNumber: string;
  version: number;
}

export interface CreateServiceInspectionPlanRequest {
  customerEquipmentId: string;
  inspectionType: ServiceInspectionType;
  intervalMonths: number;
  nextDueDate: string;
  reminderLeadDays: number;
}

export interface CompleteServiceInspectionRequest {
  completedOn: string;
  expectedVersion: number;
  notes: string;
  outcome: 'passed' | 'attention_required';
}

export interface ServiceCareOverview {
  businessTimezone: string;
  claims: WarrantyClaim[];
  inspections: ServiceInspectionPlan[];
  warranties: ServiceWarrantySummary[];
}

export interface GenerateServicePlanVisitsResult {
  asOf: string;
  generatedCount: number;
  requestIds: string[];
}

export interface SalesSubscriptionReferenceData {
  customers: Array<{ id: string; name: string }>;
  equipment: Array<{
    customerLocationId: string;
    deviceName: string;
    id: string;
    serialNumber: string;
  }>;
  locations: Array<{
    customerPartnerId: string;
    id: string;
    name: string;
  }>;
}

export interface CreateServiceSubscriptionRequest {
  billingAmount: string;
  billingFrequencyMonths: number;
  currencyCode: string;
  customerLocationId: string;
  customerPartnerId: string;
  equipmentIds: string[];
  includedServices: string[];
  nextInvoiceDate: string;
  validFrom: string;
  validTo?: string;
  visitFrequencyMonths: number;
}

export interface UpdateServiceSubscriptionRequest extends CreateServiceSubscriptionRequest {
  active: boolean;
  expectedVersion: number;
}

export interface SubscriptionInvoiceDraft {
  amount: string;
  billingDate: string;
  currencyCode: string;
  generatedAt: string;
  id: string;
  number: string;
  servicePeriodEnd: string;
  servicePeriodStart: string;
  status: 'draft';
}

export interface ServiceSubscriptionContract {
  active: boolean;
  billingAmount: string;
  billingFrequencyMonths: number;
  createdAt: string;
  currencyCode: string;
  customerLocationId: string;
  customerLocationName: string;
  customerName: string;
  customerPartnerId: string;
  equipment: Array<{
    deviceName: string;
    id: string;
    serialNumber: string;
  }>;
  id: string;
  includedServices: string[];
  invoiceDrafts: SubscriptionInvoiceDraft[];
  nextInvoiceDate: string;
  number: string;
  updatedAt: string;
  validFrom: string;
  validTo?: string;
  version: number;
  visitFrequencyMonths: number;
}

export interface GenerateSubscriptionInvoiceDraftsResult {
  asOf: string;
  draftIds: string[];
  generatedCount: number;
}

export const priceListScopes = ['all_customers', 'customer_group', 'customer'] as const;
export type PriceListScope = (typeof priceListScopes)[number];

export interface SalesPricingCustomerOption {
  id: string;
  name: string;
}

export interface CustomerPriceGroup {
  active: boolean;
  code: string;
  createdAt: string;
  customerPartnerIds: string[];
  id: string;
  name: string;
  updatedAt: string;
  version: number;
}

export interface CreateCustomerPriceGroupRequest {
  code: string;
  customerPartnerIds: string[];
  name: string;
}

export interface UpdateCustomerPriceGroupRequest {
  active: boolean;
  customerPartnerIds: string[];
  name: string;
  version: number;
}

export interface PromotionalCampaign {
  active: boolean;
  code: string;
  createdAt: string;
  id: string;
  name: string;
  updatedAt: string;
  validFrom: string;
  validTo: string;
  version: number;
}

export interface CreatePromotionalCampaignRequest {
  code: string;
  name: string;
  validFrom: string;
  validTo: string;
}

export interface UpdatePromotionalCampaignRequest {
  active: boolean;
  name: string;
  validFrom: string;
  validTo: string;
  version: number;
}

export interface PriceListLine {
  id: string;
  productCode: string;
  productId: string;
  productName: string;
  unitPrice: string;
}

export interface CreatePriceListLineRequest {
  productId: string;
  unitPrice: string;
}

export interface PriceList {
  active: boolean;
  campaign?: SalesPricingCustomerOption;
  code: string;
  createdAt: string;
  currencyCode: string;
  customer?: SalesPricingCustomerOption;
  customerGroup?: SalesPricingCustomerOption;
  id: string;
  lines: PriceListLine[];
  name: string;
  priority: number;
  scope: PriceListScope;
  updatedAt: string;
  validFrom: string;
  validTo: string;
  version: number;
}

export interface CreatePriceListRequest {
  campaignId?: string;
  code: string;
  currencyCode: string;
  customerGroupId?: string;
  customerPartnerId?: string;
  lines: CreatePriceListLineRequest[];
  name: string;
  priority: number;
  scope: PriceListScope;
  validFrom: string;
  validTo: string;
}

export interface UpdatePriceListRequest {
  active: boolean;
  campaignId?: string;
  code: string;
  currencyCode: string;
  customerGroupId?: string;
  customerPartnerId?: string;
  lines: CreatePriceListLineRequest[];
  name: string;
  priority: number;
  scope: PriceListScope;
  validFrom: string;
  validTo: string;
  version: number;
}

export interface SalesPricingReferenceData {
  campaigns: PromotionalCampaign[];
  customerGroups: CustomerPriceGroup[];
  customers: SalesPricingCustomerOption[];
  products: Array<SalesPricingCustomerOption & { productCode: string }>;
}

export interface SalesResolvedPrice {
  asOf: string;
  currencyCode: string;
  matched: boolean;
  priceListCode?: string;
  priceListId?: string;
  priceListName?: string;
  priority?: number;
  productId: string;
  unitPrice?: string;
}

export const warehouseTypes = ['standard', 'technician'] as const;
export type WarehouseType = (typeof warehouseTypes)[number];

export interface Warehouse {
  active: boolean;
  businessLocationId?: string;
  code: string;
  id: string;
  name: string;
  technicianOperatorId?: string;
  type: WarehouseType;
  version: number;
}

export interface CreateWarehouseRequest {
  businessLocationId?: string;
  code: string;
  name: string;
  technicianOperatorId?: string;
  type?: WarehouseType;
}

export interface StockBalance {
  availableQuantity: string;
  averageUnitCostBgn: string;
  inventoryValueBgn: string;
  productId: string;
  quantity: string;
  reservedQuantity: string;
  warehouseId: string;
}

export interface ReceiveStockRequest {
  batchNumber?: string;
  expiresAt?: string;
  productId: string;
  quantity: string;
  referenceId: string;
  serialNumbers?: string[];
  supplierPartnerId?: string;
  unitCostBgn?: string;
  warehouseId: string;
}

export interface StockReceipt {
  batchId?: string;
  id: string;
  productId: string;
  quantity: string;
  serialItemIds: string[];
  totalCostBgn: string;
  unitCostBgn: string;
  warehouseId: string;
}

export const stockIssueReasons = ['sale', 'repair', 'writeoff'] as const;
export type StockIssueReason = (typeof stockIssueReasons)[number];

export interface IssueStockRequest {
  batchNumber?: string;
  customerPartnerId?: string;
  productId: string;
  quantity: string;
  reason: StockIssueReason;
  referenceId: string;
  reservationId?: string;
  serialNumbers?: string[];
  technicianAccountId?: string;
  warehouseId: string;
}

export interface StockIssue {
  batchId?: string;
  id: string;
  productId: string;
  quantity: string;
  reason: StockIssueReason;
  reservationId?: string;
  serialItemIds: string[];
  totalCostBgn: string;
  unitCostBgn: string;
  warehouseId: string;
}

export const stockReturnDispositions = ['restock', 'service'] as const;
export type StockReturnDisposition = (typeof stockReturnDispositions)[number];

export interface ReturnStockRequest {
  destinationWarehouseId: string;
  disposition: StockReturnDisposition;
  originalIssueId: string;
  quantity: string;
  referenceId: string;
  serialNumbers?: string[];
}

export interface StockReturn {
  batchId?: string;
  destinationWarehouseId: string;
  disposition: StockReturnDisposition;
  id: string;
  originalIssueId: string;
  productId: string;
  quantity: string;
  serialItemIds: string[];
  totalCostBgn: string;
  unitCostBgn: string;
}

export interface TransferStockRequest {
  batchNumber?: string;
  fromWarehouseId: string;
  productId: string;
  quantity: string;
  referenceId: string;
  serialNumbers?: string[];
  toWarehouseId: string;
}

export interface StockTransfer {
  batchId?: string;
  fromMovementId: string;
  fromWarehouseId: string;
  id: string;
  productId: string;
  quantity: string;
  serialItemIds: string[];
  toMovementId: string;
  toWarehouseId: string;
  totalCostBgn: string;
  unitCostBgn: string;
}

export type StocktakeStatus = 'open' | 'completed' | 'cancelled';
export interface Stocktake {
  id: string;
  referenceId: string;
  status: StocktakeStatus;
  warehouseId: string;
}
export interface OpenStocktakeRequest {
  referenceId: string;
  warehouseId: string;
}
export interface RecordStocktakeCountRequest {
  batches?: StocktakeBatchCount[];
  countedQuantity: string;
  productId: string;
  serialNumbers?: string[];
}
export interface StocktakeBatchCount {
  batchNumber: string;
  countedQuantity: string;
  expiresAt?: string;
}

export const stockReservationReferenceTypes = [
  'sales_order',
  'quotation',
  'service_request',
] as const;
export type StockReservationReferenceType = (typeof stockReservationReferenceTypes)[number];
export type StockReservationStatus = 'active' | 'released' | 'consumed';
export interface CreateStockReservationRequest {
  productId: string;
  quantity: string;
  referenceId: string;
  referenceType: StockReservationReferenceType;
  serialNumbers?: string[];
  warehouseId: string;
}
export interface StockReservation {
  id: string;
  initialQuantity: string;
  productId: string;
  referenceId: string;
  referenceType: StockReservationReferenceType;
  remainingQuantity: string;
  serialItemIds: string[];
  status: StockReservationStatus;
  warehouseId: string;
}

export interface ConfigureStockSettingsRequest {
  alertRecipientAccountIds?: string[];
  minimumQuantity: string;
  productId: string;
  targetQuantity: string;
  warehouseId: string;
}
export interface StockSettings extends ConfigureStockSettingsRequest {
  alertRecipientAccountIds: string[];
  version: number;
}
export interface ReplenishmentStatus {
  availableQuantity: string;
  lowStock: boolean;
  minimumQuantity: string;
  physicalQuantity: string;
  productId: string;
  recommendedQuantity: string;
  reservedQuantity: string;
  targetQuantity: string;
  warehouseId: string;
}

export type SerialTraceEventType = 'receipt' | 'transfer' | 'issue' | 'return' | 'stocktake';
export interface SerialTraceParty {
  displayName: string;
  id: string;
}
export interface SerialTraceEvent {
  actor: SerialTraceParty;
  customer?: SerialTraceParty;
  eventType: SerialTraceEventType;
  fromWarehouse?: SerialTraceParty;
  movementId: string;
  occurredAt: string;
  referenceId: string;
  referenceType: string;
  supplier?: SerialTraceParty;
  technician?: SerialTraceParty;
  toWarehouse?: SerialTraceParty;
  unitCostBgn: string;
  warehouse: SerialTraceParty;
}
export interface SerialTraceability {
  currentWarehouse: SerialTraceParty;
  events: SerialTraceEvent[];
  product: SerialTraceParty;
  serialItemId: string;
  serialNumber: string;
  status: 'available' | 'issued' | 'missing';
}
