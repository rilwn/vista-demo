import type {
  FinanceReportDefinition,
  FinanceReportExport,
  FinanceReportExportPage,
  ReportExportFormat,
} from './index.js';
export const erpReportScopes = ['procurement', 'warehouse', 'sales', 'logistics'] as const;
export type ErpReportScope = (typeof erpReportScopes)[number];
export const erpReportDefinitionKeys = [
  'procurement.order-comparison',
  'procurement.supplier-claims',
  'warehouse.stock-balances',
  'warehouse.movements',
  'warehouse.replenishment',
  'sales.quotation-register',
  'sales.shipment-register',
  'logistics.deliveries',
  'logistics.returns',
  'logistics.routes',
] as const;
export type ErpReportDefinitionKey = (typeof erpReportDefinitionKeys)[number];
export interface ErpReportDefinition extends Omit<FinanceReportDefinition, 'key'> {
  key: ErpReportDefinitionKey;
}
export interface ErpReportRequest {
  definitionKey: ErpReportDefinitionKey;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  columns?: string[];
  format: ReportExportFormat;
}
export interface SavedErpReport extends ErpReportRequest {
  id: string;
  name: string;
}
export interface ErpReportExport extends Omit<FinanceReportExport, 'definitionKey'> {
  definitionKey: ErpReportDefinitionKey;
}
export interface ErpReportExportPage extends Omit<FinanceReportExportPage, 'items'> {
  items: ErpReportExport[];
}
export interface ErpReportPreview {
  columns: NonNullable<ErpReportDefinition['columns']>;
  rows: Record<string, string | number>[];
  page: number;
  total: number;
  totalPages: number;
  generatedAt: string;
}
