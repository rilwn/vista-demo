import type { IconName } from '../components/Icon';
import { getOperationsLocale } from '../i18n/LocalizationProvider';
import { erpReportMessages } from './erp-report.messages';

export interface WorkflowSection {
  items: string[];
  title: string;
}

export interface WorkflowPageDefinition {
  action: string;
  columns: string[];
  description: string;
  eyebrow: string;
  icon: IconName;
  module: string;
  sections: WorkflowSection[];
  slug: string;
  title: string;
}

const finance = (
  slug: string,
  title: string,
  description: string,
  action: string,
  sections: WorkflowSection[],
) => page('erp.finance', 'finance', slug, title, description, action, sections);
const procurement = (
  slug: string,
  title: string,
  description: string,
  action: string,
  sections: WorkflowSection[],
) => page('erp.procurement', 'procurement', slug, title, description, action, sections);
const warehouse = (
  slug: string,
  title: string,
  description: string,
  action: string,
  sections: WorkflowSection[],
) => page('erp.warehouse', 'warehouse', slug, title, description, action, sections);
const sales = (
  slug: string,
  title: string,
  description: string,
  action: string,
  sections: WorkflowSection[],
) => page('erp.sales', 'sales', slug, title, description, action, sections);
const service = (
  slug: string,
  title: string,
  description: string,
  action: string,
  sections: WorkflowSection[],
) => page('erp.service', 'service', slug, title, description, action, sections);
const logistics = (
  slug: string,
  title: string,
  description: string,
  action: string,
  sections: WorkflowSection[],
) => page('erp.logistics', 'logistics', slug, title, description, action, sections);
const crm = (
  slug: string,
  title: string,
  description: string,
  action: string,
  sections: WorkflowSection[],
) => page('crm', 'customers', slug, title, description, action, sections);
const reports = (
  slug: string,
  title: string,
  description: string,
  action: string,
  sections: WorkflowSection[],
) => page('reports', 'chart', slug, title, description, action, sections);

export const workflowPages: WorkflowPageDefinition[] = [
  ...(['procurement', 'warehouse', 'sales', 'logistics'] as const).map((scope) =>
    page(
      `erp.${scope}`,
      'chart',
      'reports',
      erpReportMessages.title,
      erpReportMessages.description,
      erpReportMessages.export,
      [],
    ),
  ),
  finance(
    'invoices',
    'Financial documents',
    'Prepare structured invoice, proforma, credit-note, and debit-note drafts without assigning an official number.',
    'New financial document',
    [
      {
        title: 'Controlled drafts',
        items: [
          'Sales-draft or manual preparation',
          'Original invoice and correction links',
          'Protected document numbering for each issuing location',
        ],
      },
      {
        title: 'Review detail',
        items: [
          'VAT 20%, 9%, 0%, exempt, and intra-community treatment',
          'Fixed currency-rate and converted BGN snapshot',
          'Issuer and customer snapshot',
        ],
      },
    ],
  ),
  finance(
    'payments',
    'Collections & payments',
    'Track partial payments, balances, and allocations against collection records.',
    'Record payment',
    [
      {
        title: 'Allocation desk',
        items: [
          'Cash, bank transfer, POS terminal, card, and compensation methods',
          'Partial allocation and remaining balance',
          'Linked payment evidence',
        ],
      },
      {
        title: 'Collections',
        items: [
          'Unpaid, partially paid, paid, overdue, and cancelled statuses',
          'Scheduled overdue detection',
          'Auditable status history',
        ],
      },
    ],
  ),
  finance(
    'customer-accounts',
    'Customer payment accounts',
    'Manage approved POS credit terms, received advances, and outstanding customer balances.',
    'Record advance',
    [
      {
        title: 'POS payment terms',
        items: [
          'Dated on-account eligibility',
          'Credit limit and payment due period',
          'Available balance checked at checkout',
        ],
      },
      {
        title: 'Customer advances',
        items: [
          'Received advance register',
          'Unused balance visible at the counter',
          'Linked sale and return trail',
        ],
      },
    ],
  ),
  finance(
    'payables',
    'Supplier payables',
    'Track supplier balances, payments, advances, and compensation offsets.',
    'Add supplier invoice',
    [
      {
        title: 'Supplier subledger',
        items: [
          'Supplier invoice and due-date register',
          'Partial payments and remaining balance',
          'Outgoing bank-transfer matching',
        ],
      },
      {
        title: 'Balance control',
        items: [
          'Explicit unallocated advances',
          'Advance allocation trail',
          'Atomic receivable and payable offsets',
        ],
      },
    ],
  ),
  finance(
    'cash',
    'Cash operations',
    'Issue cash receipt and payment vouchers and review daily register movement.',
    'New cash voucher',
    [
      {
        title: 'Cash vouchers',
        items: [
          'Receipt and payment voucher register',
          'Location, cash register, and operator numbering',
          'Customer collection allocation for cash receipts',
        ],
      },
      {
        title: 'Daily review',
        items: [
          'Opening and closing cash position',
          'Receipt and payment totals',
          'Cancelled voucher visibility',
        ],
      },
    ],
  ),
  finance(
    'cash-bank',
    'Bank reconciliation',
    'Enter balanced BGN bank statements and reconcile incoming transfers with customer collections.',
    'New statement',
    [
      {
        title: 'Statement control',
        items: [
          'Manual BGN statement entry',
          'Opening and closing balance validation',
          'Immutable bank transaction lines',
        ],
      },
      {
        title: 'Bank reconciliation',
        items: [
          'Exact-reference automatic matching',
          'Ranked manual match review',
          'Payment and allocation creation',
        ],
      },
    ],
  ),
  finance(
    'registers',
    'Finance reports',
    'Review balances, partner turnover, document journals, and VAT.',
    'Review reports',
    [
      {
        title: 'Balance control',
        items: [
          'Current customer and supplier balances',
          '0–30, 31–60, 61–90, and over-90 aging',
          'Outstanding document detail',
        ],
      },
      {
        title: 'Turnover review',
        items: [
          'Customer turnover by selected period',
          'Supplier turnover by selected period',
          'Gross, allocated, and outstanding BGN values',
        ],
      },
    ],
  ),

  procurement(
    'purchase-orders',
    'Purchase orders',
    'Plan supplier purchases with line quantities, expected dates, and delivery terms.',
    'New purchase order',
    [
      {
        title: 'Order desk',
        items: [
          'Supplier, terms, quantities, and expected delivery',
          'Approval-ready document state',
          'Ordered, delivered, and invoiced comparison',
        ],
      },
      {
        title: 'Receiving and warehouse',
        items: [
          'Partial and full receipt status',
          'Warehouse receipt generation',
          'Supplier invoice linkage',
        ],
      },
    ],
  ),
  procurement(
    'goods-receipts',
    'Goods receipts',
    'Receive delivered goods into the selected warehouse with serial, batch, expiry, and cost details.',
    'New goods receipt',
    [
      {
        title: 'Receiving',
        items: [
          'Purchase-order reconciliation',
          'Serial, batch, and expiry capture where required',
          'Transactional warehouse receipt',
        ],
      },
      {
        title: 'Quality checks',
        items: [
          'Non-conformance capture',
          'Supplier and delivery references',
          'Auditable receiving history',
        ],
      },
    ],
  ),
  procurement(
    'supplier-claims',
    'Supplier claims',
    'Track damaged or non-conforming delivery claims through a clear status history.',
    'New supplier claim',
    [
      {
        title: 'Claim file',
        items: [
          'Affected goods and attachments',
          'Supplier communication',
          'Status and resolution chronology',
        ],
      },
      {
        title: 'Linked records',
        items: ['Goods receipt', 'Purchase order', 'Supplier invoice and corrective movement'],
      },
    ],
  ),
  procurement(
    'suppliers',
    'Suppliers',
    'Review supplier contacts, payment and delivery terms, and evaluation history.',
    'Open supplier register',
    [
      {
        title: 'Commercial record',
        items: ['Canonical supplier contacts', 'Payment and delivery terms', 'Versioned updates'],
      },
      {
        title: 'Performance',
        items: ['Historical 1–5 evaluations', 'Evaluation notes', 'Auditable chronology'],
      },
    ],
  ),
  procurement(
    'supplier-invoices',
    'Supplier invoices',
    'Record supplier invoices and compare ordered, delivered, and invoiced quantities.',
    'Record supplier invoice',
    [
      {
        title: 'Invoice matching',
        items: [
          'Supplier-scoped invoice reference',
          'Purchase-order line linkage',
          'Recorded quantity and price',
        ],
      },
      {
        title: 'Three-way control',
        items: ['Ordered quantity', 'Delivered quantity', 'Invoiced quantity and variance'],
      },
    ],
  ),

  warehouse(
    'catalog',
    'Products & units',
    'Configure products, units, barcodes, and category tracking rules.',
    'Add product',
    [
      {
        title: 'Product setup',
        items: ['Products and product codes', 'Configurable units', '1D/2D barcode records'],
      },
      {
        title: 'Tracking policy',
        items: [
          'Serialised fiscal devices, scales, and fuel modules',
          'Batch consumables and spare parts',
          'Expiry dates where applicable',
        ],
      },
    ],
  ),
  warehouse(
    'warehouses',
    'Warehouses',
    'Manage central, service, and technician warehouses without a fixed limit.',
    'Add warehouse',
    [
      {
        title: 'Warehouse setup',
        items: [
          'Business location and ownership',
          'Technician/mobile warehouse designation',
          'Minimum stock thresholds',
        ],
      },
      {
        title: 'Warehouse controls',
        items: [
          'Stock responsibility',
          'Transfer eligibility',
          'Low-stock alerts and purchase recommendations',
        ],
      },
    ],
  ),
  warehouse(
    'stock',
    'Stock overview',
    'Review available, reserved, and in-transit stock by warehouse, product, and tracking identity.',
    'Stock enquiry',
    [
      {
        title: 'Availability',
        items: [
          'On-hand, reserved, and available quantities',
          'Warehouse and technician views',
          'Minimum stock threshold status',
        ],
      },
      {
        title: 'Valuation',
        items: [
          'Weighted-average cost',
          'Optional FIFO policy',
          'No negative or double-counted inventory',
        ],
      },
    ],
  ),
  warehouse(
    'movements',
    'Stock movements',
    'Create and audit goods receipts, issues, write-offs, transfers, and adjustments.',
    'New movement',
    [
      {
        title: 'Movement desk',
        items: [
          'Receipt, issue, transfer, repair use, and write-off',
          'Source document link',
          'Transactional posting preview',
        ],
      },
      {
        title: 'Traceability',
        items: [
          'User, time, and warehouse history',
          'Serial/batch identity',
          'Permanent activity history',
        ],
      },
    ],
  ),
  warehouse(
    'stocktakes',
    'Stocktakes',
    'Run stock counts, record variances, and submit adjustments for approval.',
    'Start stocktake',
    [
      {
        title: 'Count session',
        items: ['Warehouse scope', 'Count sheets and scan-ready workflow', 'Variance review'],
      },
      {
        title: 'Approval',
        items: ['Adjustment proposal', 'Authorised approval', 'Auditable final posting'],
      },
    ],
  ),
  warehouse(
    'reservations',
    'Reservations & serial trace',
    'Reserve quantities and exact serials for orders, quotations, and service work.',
    'New reservation',
    [
      {
        title: 'Commitment view',
        items: [
          'Sales, quotation, and service request source',
          'Quantity and exact serial reservation',
          'Expiry and release controls',
        ],
      },
      {
        title: 'Lifecycle',
        items: [
          'Supplier and delivery provenance',
          'Customer sale and repair history',
          'Technician custody',
        ],
      },
    ],
  ),

  sales(
    'quotations',
    'Quotations',
    'Prepare time-bounded quotations with line and overall discounts.',
    'New quotation',
    [
      {
        title: 'Offer builder',
        items: [
          'Validity period',
          'Line-item and overall discounts',
          'Product, service, and serial reservation details',
        ],
      },
      {
        title: 'Conversion',
        items: ['Confirmed order details', 'Customer acceptance', 'Revision history'],
      },
    ],
  ),
  sales(
    'orders',
    'Sales orders',
    'Confirm customer orders and coordinate reservation, shipment, and invoicing.',
    'New sales order',
    [
      {
        title: 'Order details',
        items: [
          'Confirmed order lifecycle',
          'Product, service, and exact serial allocation',
          'Customer and delivery location',
        ],
      },
      {
        title: 'Fulfilment',
        items: ['Reservation status', 'Shipment preparation', 'Invoice linkage'],
      },
    ],
  ),
  sales(
    'shipments',
    'Shipments & handover',
    'Coordinate shipment preparation and equipment handover/acceptance certificates.',
    'Prepare shipment',
    [
      {
        title: 'Fulfilment',
        items: ['Shipment status', 'Warehouse release', 'Delivery and courier connection'],
      },
      {
        title: 'Equipment acceptance',
        items: ['Serialised equipment', 'Handover certificate', 'Customer acceptance'],
      },
    ],
  ),
  sales(
    'price-lists',
    'Prices & promotions',
    'Maintain customer, customer-group, individual, time-bound, and promotional pricing.',
    'New price rule',
    [
      {
        title: 'Pricing rules',
        items: [
          'Customer group and individual price lists',
          'Time periods',
          'Promotional campaigns',
        ],
      },
      {
        title: 'Control',
        items: ['Price precedence', 'Effective-date preview', 'Posted-document price preservation'],
      },
    ],
  ),
  sales(
    'subscriptions',
    'Service subscriptions',
    'Manage customer-location service contracts and recurring invoicing.',
    'New contract',
    [
      {
        title: 'Contract detail',
        items: [
          'Customer location and devices',
          'Visit frequency and included services',
          'Pricing',
        ],
      },
      {
        title: 'Automation',
        items: [
          'Recurring invoice draft schedule',
          'Contract period and billing cycle',
          'Covered equipment and included services',
        ],
      },
    ],
  ),

  service(
    'requests',
    'Service requests',
    'Capture and dispatch service requests from telephone, email, customer portal, or on-site visits.',
    'New service request',
    [
      {
        title: 'Intake',
        items: [
          'Customer, location, device, serial, and problem description',
          'Warranty, out-of-warranty, and subscription service type',
          'Source and priority recorded with the request',
        ],
      },
      {
        title: 'Routing',
        items: [
          'Technician assignment and rescheduling',
          'Mapped technician warehouse',
          'Recorded cancellation reason where needed',
        ],
      },
    ],
  ),
  service(
    'work-orders',
    'Work orders',
    'Complete service work with time, parts, photographs, signatures, and recorded costs.',
    'New work order',
    [
      {
        title: 'Field work',
        items: [
          'Assigned technician',
          'Working time and consumed spare parts',
          'Photo upload and customer signature capture',
        ],
      },
      {
        title: 'Completion',
        items: [
          'Technician warehouse deduction',
          'Labor, parts, and transport cost calculation',
          'Completed work and evidence retained together',
        ],
      },
    ],
  ),
  service(
    'schedule',
    'Technician schedule',
    'Review assigned visits and technician appointments in one responsive schedule.',
    'Schedule visit',
    [
      {
        title: 'Schedule',
        items: ['Assigned jobs', 'Scheduled service times', 'Technician grouping by day'],
      },
      {
        title: 'Technician view',
        items: [
          'Mobile-friendly assigned work',
          'Personal assigned-work view',
          'Completed work visibility',
        ],
      },
    ],
  ),
  service(
    'devices',
    'Equipment history',
    'Review recorded service visits, repairs, assigned technicians, and parts by serial number.',
    'Find equipment',
    [
      {
        title: 'Service timeline',
        items: ['Service visits and repairs', 'Completed work details', 'Assigned technician'],
      },
      {
        title: 'Lifecycle',
        items: ['Parts used', 'Technician and service dates', 'Current device status'],
      },
    ],
  ),
  service(
    'care',
    'Warranty & inspections',
    'Monitor warranty coverage, handle claims, and keep required device inspections on schedule.',
    'Open register',
    [
      {
        title: 'Warranty care',
        items: [
          'Remaining warranty period',
          'Claim status and supporting files',
          'Decision history',
        ],
      },
      {
        title: 'Inspection planning',
        items: [
          'Technical and metrological plans',
          'Upcoming reminders',
          'Completed inspection history',
        ],
      },
    ],
  ),
  service(
    'reports',
    'Service reports',
    'Review request volume, completion, technician workload, recorded time, and Service value.',
    'Review reports',
    [
      {
        title: 'Operations',
        items: ['Request status', 'Service type mix', 'Technician workload'],
      },
      {
        title: 'Downloads',
        items: ['Service request register', 'Technician performance', 'Service cost summary'],
      },
    ],
  ),
  logistics(
    'deliveries',
    'Deliveries',
    'Coordinate company transport and courier deliveries from shipment to proof of handover.',
    'Plan delivery',
    [
      {
        title: 'Delivery board',
        items: [
          'Company transport or courier',
          'Customer delivery location',
          'Shipment and handover link',
        ],
      },
      {
        title: 'Visibility',
        items: ['Status timeline', 'Delivery exception', 'Customer notification'],
      },
    ],
  ),
  logistics(
    'couriers',
    'Courier shipments',
    'Create and track Econt and Speedy shipments from one place.',
    'Create shipment',
    [
      {
        title: 'Courier details',
        items: [
          'Econt shipment creation and tracking',
          'Speedy shipment creation and tracking',
          'Connection errors and retry status',
        ],
      },
      {
        title: 'Reconciliation',
        items: [
          'Shipment reference',
          'Delivery status',
          'Linked sales or reverse-logistics record',
        ],
      },
    ],
  ),
  logistics(
    'returns',
    'Returns & reverse logistics',
    'Manage returned and repairable devices, including service-request creation where applicable.',
    'Register return',
    [
      {
        title: 'Return intake',
        items: [
          'Original document link',
          'Repairable vs restock disposition',
          'Courier return details',
        ],
      },
      {
        title: 'Service request',
        items: [
          'Automatic applicable service request',
          'Service warehouse transfer',
          'Traceable reverse-logistics record',
        ],
      },
    ],
  ),
  logistics(
    'routes',
    'Routes',
    'Plan calendar-based technician routes and delivery runs.',
    'Plan route',
    [
      {
        title: 'Route canvas',
        items: ['Technician and delivery stops', 'Calendar schedule', 'Capacity and workload'],
      },
      {
        title: 'Execution',
        items: [
          'Arrival and completion history',
          'Delay/exception communication',
          'Service and delivery links',
        ],
      },
    ],
  ),

  crm(
    'locations-equipment',
    'Locations & equipment',
    'Maintain customer locations, responsible contacts, and installed equipment.',
    'Add customer location',
    [
      {
        title: 'Customer locations',
        items: [
          'Store, fuel station, retail outlet, and other locations',
          'Address and responsible contact',
          'Contract and SLA terms',
        ],
      },
      {
        title: 'Equipment register',
        items: [
          'Device, serial, purchase date, warranty, and status',
          'Active, under repair, and retired status',
          'ERP service linkage',
        ],
      },
    ],
  ),
  crm(
    'timeline',
    'Interactions, tasks & reminders',
    'Maintain a unified chronological customer and location timeline.',
    'Log interaction',
    [
      {
        title: 'Communication history',
        items: [
          'Incoming/outgoing calls, email, visits, chat',
          'Reports, quotations, and photographs',
          'Chronological customer timeline',
        ],
      },
      {
        title: 'Work management',
        items: ['Assigned tasks', 'Due dates and priorities', 'Reminder delivery'],
      },
    ],
  ),
  crm(
    'leads',
    'Leads & opportunities',
    'Qualify leads, convert them, and manage opportunities through a visual pipeline.',
    'New lead',
    [
      {
        title: 'Qualification',
        items: [
          'Telephone, referral, website, and trade exhibition sources',
          'Customer or opportunity conversion',
          'Estimated revenue and probability',
        ],
      },
      {
        title: 'Pipeline',
        items: [
          'New, qualified, quotation sent, negotiation, won, and lost',
          'Drag-and-drop with stage validation',
          'Audited stage movement',
        ],
      },
    ],
  ),
  crm(
    'tickets',
    'Tickets & SLA',
    'Manage service tickets, customer or contract SLA timers, escalations, and linked service requests.',
    'New ticket',
    [
      {
        title: 'Ticket desk',
        items: [
          'Automatic ticket number, channel, priority, and category',
          'Customer/contract SLA policy',
          'Response and resolution timers',
        ],
      },
      {
        title: 'Service link',
        items: [
          'Create ERP service request',
          'Receive ERP service request',
          'Linked requests without duplicates',
        ],
      },
    ],
  ),
  crm(
    'customer-care',
    'Warranty, feedback & referrals',
    'Track warranty claims, customer satisfaction, NPS, and referrals after delivery or service.',
    'Send survey',
    [
      {
        title: 'After-sales',
        items: [
          'Warranty claim attachments',
          'Device and serial history',
          'Extended-warranty/service-subscription offer',
        ],
      },
      {
        title: 'Feedback',
        items: ['Post-service/delivery surveys', 'NPS trend', 'Referral prospect link'],
      },
    ],
  ),
  crm(
    'analytics',
    'CRM analytics',
    'Explore customer behavior, pipeline conversion, employee performance, and revenue dimensions.',
    'Create analysis',
    [
      {
        title: 'Customer intelligence',
        items: [
          'Frequency, average transaction value, retention, churn, and CLV',
          'Preferred products/services',
          'Documented calculation windows',
        ],
      },
      {
        title: 'Performance',
        items: [
          'Pipeline conversion',
          'Requests/tickets/sales by employee',
          'Revenue by product, service, customer, and region',
        ],
      },
    ],
  ),

  reports(
    'dashboards',
    'Dashboards',
    'Configure role-appropriate KPI views with clear filters, sources, and calculation windows.',
    'Configure dashboard',
    [
      {
        title: 'Key figures',
        items: [
          'Revenue',
          'Active service requests',
          'Warranties nearing expiry',
          'Overdue receivables',
        ],
      },
      {
        title: 'Reproducibility',
        items: [
          'Date range and status filters',
          'Data-source disclosure',
          'Dashboard settings by user access',
        ],
      },
    ],
  ),
  reports(
    'report-library',
    'Report library',
    'Browse standard and configurable reports for every module.',
    'New report definition',
    [
      {
        title: 'Report definitions',
        items: ['Configurable filters', 'No arbitrary end-user SQL', 'Access control'],
      },
      {
        title: 'Exports',
        items: ['Excel, CSV, and PDF', 'Async execution for large files', 'Download history'],
      },
    ],
  ),
  reports(
    'scheduled-exports',
    'Scheduled exports',
    'Review scheduled report generation, deliveries, retries, and downloadable output.',
    'Schedule export',
    [
      { title: 'Schedule', items: ['Delivery recipients', 'Filter snapshot', 'Execution history'] },
      {
        title: 'Reliability',
        items: ['Queued processing', 'Retry state', 'Download-ready notification'],
      },
    ],
  ),
];

export function pagesForModule(module: string): WorkflowPageDefinition[] {
  return workflowPages
    .filter((pageDefinition) => pageDefinition.module === module)
    .map(localizeWorkflowPage);
}

export function findWorkflowPage(pathname: string): WorkflowPageDefinition | undefined {
  const pageDefinition = workflowPages.find((item) => workflowPath(item) === pathname);
  return pageDefinition ? localizeWorkflowPage(pageDefinition) : undefined;
}

export function localizeWorkflowPage(
  pageDefinition: WorkflowPageDefinition,
): WorkflowPageDefinition {
  if (getOperationsLocale() !== 'bg') return pageDefinition;
  const translated = bulgarianWorkflowMeta[`${pageDefinition.module}/${pageDefinition.slug}`];
  return {
    ...pageDefinition,
    ...(translated ?? {}),
    columns: ['Референция', 'Състояние', 'Клиент / източник', 'Отговорник', 'Актуализирано'],
    eyebrow: bulgarianModuleName(pageDefinition.module),
  };
}

export function workflowPath(
  pageDefinition: Pick<WorkflowPageDefinition, 'module' | 'slug'>,
): string {
  return `/modules/${pageDefinition.module}/${pageDefinition.slug}`;
}

function page(
  module: string,
  icon: IconName,
  slug: string,
  title: string,
  description: string,
  action: string,
  sections: WorkflowSection[],
): WorkflowPageDefinition {
  return {
    action,
    columns: ['Reference', 'Status', 'Customer / source', 'Owner', 'Updated'],
    description,
    eyebrow: module.replace('.', ' · ').toUpperCase(),
    icon,
    module,
    sections,
    slug,
    title,
  };
}

type WorkflowMeta = Pick<WorkflowPageDefinition, 'action' | 'description' | 'title'>;

const bulgarianWorkflowMeta: Record<string, WorkflowMeta> = {
  'erp.finance/invoices': {
    title: 'Финансови документи',
    description: 'Подготвяйте фактури, проформи, кредитни и дебитни известия.',
    action: 'Нов финансов документ',
  },
  'erp.finance/payments': {
    title: 'Вземания и плащания',
    description: 'Проследявайте частични плащания, остатъци и разпределения по вземания.',
    action: 'Регистриране на плащане',
  },
  'erp.finance/customer-accounts': {
    title: 'Клиентски платежни сметки',
    description: 'Управлявайте кредитни условия, аванси и неплатени клиентски салда.',
    action: 'Регистриране на аванс',
  },
  'erp.finance/payables': {
    title: 'Задължения към доставчици',
    description: 'Проследявайте задължения, плащания, аванси и прихващания.',
    action: 'Добавяне на фактура от доставчик',
  },
  'erp.finance/cash': {
    title: 'Касови операции',
    description: 'Издавайте приходни и разходни касови ордери и преглеждайте дневния регистър.',
    action: 'Нов касов ордер',
  },
  'erp.finance/cash-bank': {
    title: 'Банково съгласуване',
    description: 'Въвеждайте банкови извлечения и съпоставяйте преводи с клиентски вземания.',
    action: 'Ново извлечение',
  },
  'erp.finance/registers': {
    title: 'Финансови справки',
    description: 'Преглеждайте салда, обороти, дневници на документи и ДДС.',
    action: 'Преглед на справките',
  },
  'erp.procurement/purchase-orders': {
    title: 'Поръчки за покупка',
    description: 'Планирайте покупки с количества, очаквани дати и условия за доставка.',
    action: 'Нова поръчка за покупка',
  },
  'erp.procurement/goods-receipts': {
    title: 'Складови приемания',
    description: 'Приемайте доставки със серийни номера, партиди, срокове и стойности.',
    action: 'Ново складово приемане',
  },
  'erp.procurement/supplier-claims': {
    title: 'Рекламации към доставчици',
    description: 'Проследявайте рекламации за повредени или несъответстващи доставки.',
    action: 'Нова рекламация',
  },
  'erp.procurement/suppliers': {
    title: 'Доставчици',
    description: 'Преглеждайте контакти, условия за плащане и доставка и оценки.',
    action: 'Отваряне на регистъра',
  },
  'erp.procurement/supplier-invoices': {
    title: 'Фактури от доставчици',
    description:
      'Регистрирайте фактури и сравнявайте поръчани, доставени и фактурирани количества.',
    action: 'Регистриране на фактура',
  },
  'erp.warehouse/catalog': {
    title: 'Продукти и мерни единици',
    description: 'Настройвайте продукти, мерни единици, баркодове и правила за проследяване.',
    action: 'Добавяне на продукт',
  },
  'erp.warehouse/warehouses': {
    title: 'Складове',
    description: 'Управлявайте централни, сервизни и мобилни складове без фиксиран лимит.',
    action: 'Добавяне на склад',
  },
  'erp.warehouse/stock': {
    title: 'Преглед на наличностите',
    description: 'Преглеждайте налични, резервирани и транзитни количества по склад и продукт.',
    action: 'Проверка на наличност',
  },
  'erp.warehouse/movements': {
    title: 'Складови движения',
    description: 'Създавайте и проверявайте приемания, изписвания, трансфери и корекции.',
    action: 'Ново движение',
  },
  'erp.warehouse/stocktakes': {
    title: 'Инвентаризации',
    description: 'Провеждайте преброявания, записвайте разлики и подавайте корекции.',
    action: 'Нова инвентаризация',
  },
  'erp.warehouse/reservations': {
    title: 'Резервации и серийно проследяване',
    description: 'Резервирайте количества и серийни номера за поръчки, оферти и сервиз.',
    action: 'Нова резервация',
  },
  'erp.sales/quotations': {
    title: 'Оферти',
    description: 'Подготвяйте оферти със срок на валидност и отстъпки.',
    action: 'Нова оферта',
  },
  'erp.sales/orders': {
    title: 'Поръчки за продажба',
    description: 'Потвърждавайте поръчки и координирайте резервация, експедиция и фактуриране.',
    action: 'Нова поръчка',
  },
  'erp.sales/shipments': {
    title: 'Експедиции и предаване',
    description: 'Координирайте подготовката и приемо-предавателните протоколи.',
    action: 'Подготовка на експедиция',
  },
  'erp.sales/price-lists': {
    title: 'Цени и промоции',
    description: 'Управлявайте клиентски, групови, индивидуални и промоционални цени.',
    action: 'Ново ценово правило',
  },
  'erp.sales/subscriptions': {
    title: 'Сервизни абонаменти',
    description: 'Управлявайте договори за сервиз по клиентски обекти и периодично фактуриране.',
    action: 'Нов договор',
  },
  'erp.service/requests': {
    title: 'Сервизни заявки',
    description: 'Регистрирайте и разпределяйте заявки от телефон, имейл, портал или посещение.',
    action: 'Нова сервизна заявка',
  },
  'erp.service/work-orders': {
    title: 'Работни поръчки',
    description: 'Отчитайте време, части, снимки, подписи и разходи по сервизната работа.',
    action: 'Нова работна поръчка',
  },
  'erp.service/schedule': {
    title: 'График на техниците',
    description: 'Преглеждайте назначените посещения и графика на техниците.',
    action: 'Планиране на посещение',
  },
  'erp.service/devices': {
    title: 'История на оборудването',
    description: 'Преглеждайте посещения, ремонти, техници и части по сериен номер.',
    action: 'Търсене на оборудване',
  },
  'erp.service/care': {
    title: 'Гаранции и проверки',
    description: 'Следете гаранции, рекламации и задължителни проверки на устройствата.',
    action: 'Отваряне на регистъра',
  },
  'erp.service/reports': {
    title: 'Сервизни справки',
    description: 'Преглеждайте обем, завършена работа, натоварване, време и стойност.',
    action: 'Преглед на справките',
  },
  'erp.logistics/deliveries': {
    title: 'Доставки',
    description: 'Координирайте фирмен транспорт и куриерски доставки до предаването.',
    action: 'Планиране на доставка',
  },
  'erp.logistics/couriers': {
    title: 'Куриерски пратки',
    description: 'Създавайте и проследявайте пратки на Econt и Speedy.',
    action: 'Създаване на пратка',
  },
  'erp.logistics/returns': {
    title: 'Връщания и обратна логистика',
    description: 'Управлявайте върнати и ремонтируеми устройства и свързаните заявки.',
    action: 'Регистриране на връщане',
  },
  'erp.logistics/routes': {
    title: 'Маршрути',
    description: 'Планирайте маршрути на техници и курсове за доставка по календар.',
    action: 'Планиране на маршрут',
  },
  'crm/locations-equipment': {
    title: 'Обекти и оборудване',
    description: 'Поддържайте клиентски обекти, отговорни лица и инсталирано оборудване.',
    action: 'Добавяне на клиентски обект',
  },
  'crm/timeline': {
    title: 'Контакти, задачи и напомняния',
    description: 'Поддържайте обща хронологична история по клиент и обект.',
    action: 'Регистриране на контакт',
  },
  'crm/leads': {
    title: 'Потенциални клиенти и възможности',
    description: 'Квалифицирайте потенциални клиенти и управлявайте възможностите.',
    action: 'Нов потенциален клиент',
  },
  'crm/tickets': {
    title: 'Заявки и SLA',
    description: 'Управлявайте клиентски заявки, срокове, ескалации и връзки със сервиза.',
    action: 'Нова заявка',
  },
  'crm/customer-care': {
    title: 'Гаранции, обратна връзка и препоръки',
    description: 'Проследявайте гаранционни рекламации, удовлетвореност, NPS и препоръки.',
    action: 'Изпращане на анкета',
  },
  'crm/analytics': {
    title: 'CRM анализи',
    description: 'Анализирайте клиентско поведение, фуния, служители и приходи.',
    action: 'Създаване на анализ',
  },
  'reports/dashboards': {
    title: 'Табла',
    description: 'Настройвайте KPI изгледи с ясни филтри, източници и периоди.',
    action: 'Настройване на табло',
  },
  'reports/report-library': {
    title: 'Библиотека със справки',
    description: 'Преглеждайте стандартни и конфигурируеми справки за всеки модул.',
    action: 'Нова дефиниция на справка',
  },
  'reports/scheduled-exports': {
    title: 'Планирани експорти',
    description: 'Преглеждайте планирани справки, доставки, повторни опити и файлове.',
    action: 'Планиране на експорт',
  },
  'erp.procurement/reports': reportMeta('Снабдяване'),
  'erp.warehouse/reports': reportMeta('Склад'),
  'erp.sales/reports': reportMeta('Продажби'),
  'erp.logistics/reports': reportMeta('Логистика'),
};

function reportMeta(area: string): WorkflowMeta {
  return {
    title: 'Справки',
    description: `Преглеждайте и експортирайте справки за ${area.toLocaleLowerCase('bg-BG')}.`,
    action: 'Експортиране',
  };
}

function bulgarianModuleName(module: string): string {
  const [group, area] = module.split('.');
  const names: Record<string, string> = {
    crm: 'CRM',
    finance: 'ФИНАНСИ',
    logistics: 'ЛОГИСТИКА',
    procurement: 'СНАБДЯВАНЕ',
    reports: 'СПРАВКИ',
    sales: 'ПРОДАЖБИ',
    service: 'СЕРВИЗ',
    warehouse: 'СКЛАД',
  };
  return area
    ? `${group?.toUpperCase()} · ${names[area] ?? area.toUpperCase()}`
    : (names[group ?? ''] ?? module);
}
