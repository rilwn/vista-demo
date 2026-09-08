import type {
  FinanceReportDefinition,
  FinanceReportDefinitionKey,
  ServiceReportDefinitionKey,
  CrmReportDefinitionKey,
  PosReportDefinitionKey,
  ErpReportDefinitionKey,
  FinanceReportExport,
  ReportExportFormat,
} from './index.js';
export const reportingScopes = [
  'finance',
  'procurement',
  'warehouse',
  'sales',
  'logistics',
  'service',
  'crm',
  'pos',
] as const;
export type ReportingScope = (typeof reportingScopes)[number];
export type ReportingDefinitionKey =
  | FinanceReportDefinitionKey
  | ServiceReportDefinitionKey
  | CrmReportDefinitionKey
  | PosReportDefinitionKey
  | ErpReportDefinitionKey;
export interface LibraryDefinition extends Omit<FinanceReportDefinition, 'key'> {
  key: ReportingDefinitionKey;
  scope: ReportingScope;
  canCreate: boolean;
}
export interface LibraryView {
  id: string;
  name: string;
  scope: ReportingScope;
  canCreate: boolean;
  configuration: {
    definitionKey: ReportingDefinitionKey;
    format: ReportExportFormat;
    columns?: string[];
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    businessLocationId?: string;
    cashRegisterId?: string;
    operatorId?: string;
    shiftId?: string;
  };
}
export interface LibraryViewPage {
  items: LibraryView[];
  page: number;
  total: number;
  totalPages: number;
}
export interface LibraryExport extends Omit<FinanceReportExport, 'definitionKey'> {
  definitionKey: ReportingDefinitionKey;
}
export const reportCadences = ['daily', 'weekly', 'monthly'] as const;
export const reportPeriods = [
  'saved_dates',
  'previous_day',
  'previous_7_days',
  'previous_month',
  'current',
] as const;
export interface ReportScheduleInput {
  id: string;
  viewId: string;
  scope: ReportingScope;
  name: string;
  cadence: (typeof reportCadences)[number];
  period: (typeof reportPeriods)[number];
  firstRunLocal: string;
}
export interface ReportSchedule extends ReportScheduleInput {
  enabled: boolean;
  version: number;
  nextRunAt: string;
  timezone: string;
  errorCode?: string;
}
export interface ReportSchedulePage {
  items: ReportSchedule[];
  page: number;
  total: number;
  totalPages: number;
}
export interface ReportRun {
  id: string;
  scheduledFor: string;
  export: LibraryExport;
}
export interface ReportRunPage {
  items: ReportRun[];
  page: number;
  total: number;
  totalPages: number;
}
export const dashboardCardKeys = {
  service: ['requests', 'open', 'completed', 'time', 'value'],
  crm: ['retention', 'average', 'frequency', 'value', 'revenue'],
  pos: ['revenue', 'sales', 'returns', 'average'],
  finance: ['total', 'current', 'days0To30', 'days31To60', 'days61To90', 'over90'],
} as const;
export type ReportDashboardScope = keyof typeof dashboardCardKeys;
export interface ReportDashboardPreferences {
  hiddenCards: string[];
  version: number;
}
