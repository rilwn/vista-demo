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
}

export interface CreateSupplierInvoiceRequest {
  invoiceDate: string;
  invoiceNumber: string;
  lines: CreateSupplierInvoiceLineRequest[];
  purchaseOrderId: string;
}

export interface SupplierInvoiceLine {
  id: string;
  lineTotal: string;
  orderLineId: string;
  productId: string;
  productName: string;
  quantity: string;
  unitPrice: string;
}

export interface SupplierInvoice {
  currencyCode: string;
  id: string;
  invoiceDate: string;
  invoiceNumber: string;
  lines: SupplierInvoiceLine[];
  purchaseOrderId: string;
  recordedAt: string;
  supplierName: string;
  supplierPartnerId: string;
  total: string;
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
