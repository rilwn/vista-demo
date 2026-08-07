import type { IconName } from '../components/Icon';

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
  finance(
    'invoices',
    'Invoices',
    'Issue and manage sales invoices, proformas, credit notes, debit notes, VAT treatment, and document links.',
    'New invoice',
    [
      {
        title: 'Document workspace',
        items: [
          'Draft and issue states',
          'Original and correction document links',
          'Branch, location, register, and operator numbering',
        ],
      },
      {
        title: 'Compliance detail',
        items: [
          'VAT 20%, 9%, 0%, exempt, and intra-community treatment',
          'Currency rate evidence in BGN',
          'PDF, signature, and email delivery',
        ],
      },
    ],
  ),
  finance(
    'payments',
    'Payments & allocations',
    'Track partial payments, balances, advances, offsets, and matching against invoices.',
    'Record payment',
    [
      {
        title: 'Allocation desk',
        items: [
          'Cash, bank transfer, POS terminal, card, and compensation methods',
          'Partial allocation and remaining balance',
          'Payment reference matching',
        ],
      },
      {
        title: 'Collections',
        items: [
          'Unpaid, partially paid, paid, overdue, and cancelled statuses',
          'Upcoming and overdue notifications',
          'Auditable manual matching exceptions',
        ],
      },
    ],
  ),
  finance(
    'cash-bank',
    'Cash & bank',
    'Operate cash vouchers, daily cash reporting, imported bank statements, and manual entries.',
    'Add bank entry',
    [
      {
        title: 'Cash control',
        items: [
          'Cash receipt and payment vouchers',
          'Daily cash report',
          'Register and operator context',
        ],
      },
      {
        title: 'Bank reconciliation',
        items: [
          'Bulgarian bank statement import',
          'Manual statement entry',
          'Matching queue and exception review',
        ],
      },
    ],
  ),
  finance(
    'registers',
    'Registers & VAT',
    'Review receivables, payables, turnover, journals, VAT positions, and accounting exports.',
    'Create export',
    [
      {
        title: 'Registers',
        items: [
          'Customer and supplier balances',
          '0–30, 31–60, 61–90, and over-90 aging',
          'Sales and purchase journals',
        ],
      },
      {
        title: 'Reporting output',
        items: [
          'Collected and deductible VAT by period',
          'Structured accounting formats',
          'Reproducible filters and rate evidence',
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
        title: 'Receiving handoff',
        items: [
          'Partial and full receipt readiness',
          'Warehouse receipt generation',
          'Supplier invoice linkage',
        ],
      },
    ],
  ),
  procurement(
    'goods-receipts',
    'Goods receipts',
    'Receive delivered goods into the selected warehouse with traceability and cost evidence.',
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
        title: 'Quality & evidence',
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
          'Affected goods and evidence',
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

  warehouse(
    'catalog',
    'Products & units',
    'Configure products, units, barcodes, and category-controlled tracking policy.',
    'Add product',
    [
      {
        title: 'Master data',
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
        title: 'Operational controls',
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
          'Actor, time, and warehouse evidence',
          'Serial/batch identity',
          'Immutable audit history',
        ],
      },
    ],
  ),
  warehouse(
    'stocktakes',
    'Stocktakes',
    'Run counted inventory sessions, record variances, and submit controlled adjustments.',
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
          'Product, service, and serial reservation context',
        ],
      },
      {
        title: 'Conversion',
        items: ['Confirmed-order handoff', 'Acceptance evidence', 'Controlled revision history'],
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
        title: 'Order workspace',
        items: [
          'Confirmed order lifecycle',
          'Product, service, and exact serial allocation',
          'Customer and delivery location',
        ],
      },
      { title: 'Fulfilment', items: ['Reservation status', 'Shipment handoff', 'Invoice linkage'] },
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
        items: ['Shipment status', 'Warehouse release', 'Delivery and courier handoff'],
      },
      {
        title: 'Equipment acceptance',
        items: ['Serialised equipment', 'Handover certificate', 'Customer acceptance evidence'],
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
    'Manage customer-location service contracts and recurring invoice readiness.',
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
          'Recurring invoice schedule',
          'Upcoming service visit generation',
          'Contract SLA context',
        ],
      },
    ],
  ),

  service(
    'requests',
    'Service requests',
    'Capture requests from telephone, email, portal, on-site visit, and linked CRM tickets.',
    'New service request',
    [
      {
        title: 'Intake',
        items: [
          'Customer, location, device, serial, and problem description',
          'Warranty, out-of-warranty, and subscription service type',
          'Stable correlation with CRM ticket',
        ],
      },
      {
        title: 'Routing',
        items: [
          'Priority and scheduling need',
          'Technician assignment',
          'SLA and notification context',
        ],
      },
    ],
  ),
  service(
    'work-orders',
    'Work orders',
    'Execute service work with time, parts, photos, signatures, and billing evidence.',
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
          'Payment document handoff',
        ],
      },
    ],
  ),
  service(
    'schedule',
    'Technician schedule',
    'Plan technician workload and service appointments in a responsive calendar view.',
    'Schedule visit',
    [
      {
        title: 'Calendar',
        items: ['Assigned jobs', 'Workload visibility', 'Route-aware appointment planning'],
      },
      {
        title: 'Technician view',
        items: [
          'Mobile-friendly assigned work',
          'Completed work history',
          'Offline-safe future API boundary',
        ],
      },
    ],
  ),
  service(
    'devices',
    'Equipment history',
    'Follow each device and serial through sale, service, repair, parts, and assigned technician.',
    'Find equipment',
    [
      {
        title: 'Serial timeline',
        items: ['Supplier and delivery date', 'Customer sale', 'Service visits and repairs'],
      },
      {
        title: 'Lifecycle',
        items: ['Parts used', 'Technician and service dates', 'Current device status'],
      },
    ],
  ),
  service(
    'warranties',
    'Warranties & inspections',
    'Monitor warranty cards, claims, expiry, and required fiscal-device or scale inspections.',
    'Create warranty claim',
    [
      {
        title: 'Warranty',
        items: [
          'Warranty card per device serial',
          'Remaining period and claim count',
          'Received → review → approved/rejected → closed',
        ],
      },
      {
        title: 'Inspection',
        items: ['Periodic inspection calendar', 'Reminders', 'Service-plan visit generation'],
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
    'Create and track Econt and Speedy shipments through vendor-neutral adapters.',
    'Create shipment',
    [
      {
        title: 'Carrier workspace',
        items: [
          'Econt shipment creation and tracking',
          'Speedy shipment creation and tracking',
          'Adapter failure and retry status',
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
          'Courier return context',
        ],
      },
      {
        title: 'Service handoff',
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
        items: ['Technician and delivery stops', 'Calendar context', 'Capacity and workload'],
      },
      {
        title: 'Execution',
        items: [
          'Arrival and completion evidence',
          'Delay/exception communication',
          'Service and delivery links',
        ],
      },
    ],
  ),

  crm(
    'locations-equipment',
    'Locations & equipment',
    'Maintain customer locations, responsible contacts, and installed equipment context.',
    'Add customer location',
    [
      {
        title: 'Customer locations',
        items: [
          'Store, fuel station, retail outlet, and other locations',
          'Address and responsible contact',
          'Contract and SLA context',
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
          'Drag-and-drop with backend validation',
          'Audited stage movement',
        ],
      },
    ],
  ),
  crm(
    'tickets',
    'Tickets & SLA',
    'Manage service tickets, customer/contract SLA timers, escalation, and two-way service correlation.',
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
          'Stable correlation and loop prevention',
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
          'Warranty claim evidence',
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
        title: 'Operational KPIs',
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
          'Access-controlled dashboard configuration',
        ],
      },
    ],
  ),
  reports(
    'report-library',
    'Report library',
    'Browse controlled standard and configurable reports for every module.',
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
  return workflowPages.filter((pageDefinition) => pageDefinition.module === module);
}

export function findWorkflowPage(pathname: string): WorkflowPageDefinition | undefined {
  return workflowPages.find((pageDefinition) => workflowPath(pageDefinition) === pathname);
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
