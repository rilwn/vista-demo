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
  permissions: ApiPermission[];
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
