import type { ErpReportDefinition } from '@vista/contracts';

// Start with a readable working view. Every field remains available in Customize view.
const defaults: Partial<Record<ErpReportDefinition['key'], string[]>> = {
  'procurement.order-comparison': [
    'supplier',
    'product',
    'ordered',
    'received',
    'invoiced',
    'status',
    'order',
  ],
  'procurement.supplier-claims': ['supplier', 'product', 'quantity', 'type', 'status', 'reference'],
  'warehouse.stock-balances': [
    'warehouse',
    'product',
    'unit',
    'physical',
    'reserved',
    'available',
    'value',
  ],
  'warehouse.movements': ['date', 'warehouse', 'product', 'type', 'quantity', 'unit', 'reference'],
  'warehouse.replenishment': [
    'warehouse',
    'product',
    'unit',
    'available',
    'minimum',
    'recommended',
    'low',
  ],
  'sales.quotation-register': ['quotation', 'customer', 'valid', 'status', 'total', 'currency'],
  'logistics.deliveries': ['delivery', 'customer', 'city', 'method', 'date', 'status'],
  'logistics.returns': ['return', 'customer', 'product', 'quantity', 'disposition', 'status'],
};
export function defaultReportColumns(report: ErpReportDefinition) {
  const available = report.columns?.map((column) => column.key) ?? [];
  const preferred = defaults[report.key];
  return preferred?.every((key) => available.includes(key)) ? preferred : available;
}

export const isReportUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Format decimal strings without converting financial values to floating point.
export function reportDecimal(value: string, money: boolean) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const fraction = (match[3] ?? '').replace(/0+$/, '').padEnd(money ? 2 : 0, '0');
  const whole = match[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${match[1]}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function reportDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Europe/Sofia',
      }).format(date);
}
