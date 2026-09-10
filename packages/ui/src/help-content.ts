export type HelpApp = 'operations' | 'pos' | 'recovery';
export interface HelpTopic {
  id: string;
  title: string;
  module?: string;
  steps: string[];
  note?: string;
}

export const helpText = {
  open: 'Help',
  title: 'How can we help?',
  close: 'Close help',
  search: 'Search help',
  placeholder: 'Try payments, stock or sign-in',
  empty: 'No matching guide. Try a different word.',
  back: 'Back to work',
  intro: 'Short guides for this workspace. Available actions depend on your account.',
};

const common: HelpTopic[] = [
  {
    id: 'access',
    title: 'Sign-in and account access',
    steps: [
      'Sign in with your assigned work email and password. If asked, enter the current six-digit code from your authenticator.',
      'If sign-in is temporarily limited, wait before trying again. If access is missing, ask your administrator to review your role.',
      'Never share your password or authenticator code. Sign out when you finish on a shared device.',
    ],
  },
  {
    id: 'errors',
    title: 'When an action cannot be completed',
    steps: [
      'Read the message beside the field and choose a value from the available suggestions.',
      'Keep the current form open after a connection failure. Use its retry action and check the existing record before creating another.',
      'If the problem continues, share the action, record number and error reference with your administrator, without passwords or customer attachments.',
    ],
  },
];

const operations: HelpTopic[] = [
  {
    id: 'stock',
    title: 'Products, stock and serial numbers',
    module: 'erp.warehouse',
    steps: [
      'Choose Warehouse from the sidebar. Review stock for the exact product and warehouse before reserving or selling.',
      'Use a goods receipt or an authorised inventory receipt to add stock. Enter the source reference and any required serial or batch details.',
      'If stock is unavailable, check existing reservations. Do not create another quotation to bypass a reservation.',
    ],
  },
  {
    id: 'procurement',
    title: 'Purchase and receive goods',
    module: 'erp.procurement',
    steps: [
      'Choose Procurement → Purchase orders → Create purchase order. Select the supplier, warehouse and products, then save.',
      'Open the order and choose Receive delivery. Enter only quantities received and the required serial or batch details.',
      'Open Supplier invoices to record the supplier invoice. Compare ordered, delivered and invoiced quantities; record the VAT breakdown before reviewing purchase VAT totals.',
    ],
  },
  {
    id: 'sales',
    title: 'From quotation to collection',
    module: 'erp.sales',
    steps: [
      'Choose Sales → Quotations → New quotation. Select the customer, warehouse, dates and products, then save.',
      'Open Preview, select available serial numbers where required, and confirm the order. Complete the shipment and handover, then prepare its invoice draft.',
      'A Finance user can add the prepared draft to Collections & payments, set its due date and record partial or full payments.',
    ],
    note: 'A prepared draft is not an officially issued invoice.',
  },
  {
    id: 'finance',
    title: 'Payments and financial documents',
    module: 'erp.finance',
    steps: [
      'Choose Finance → Collections & payments. Add a prepared Sales invoice draft to collections, or open an existing collection to record payment.',
      'Use the remaining balance shown on the record. Review advances and offsets separately instead of recording the same money twice.',
      'Choose Financial documents to prepare and preview a linked draft. Open Finance reports for operational journals, VAT review and balances.',
    ],
    note: 'If no draft is available, ask Sales to finish the shipment and prepare its invoice draft. Check existing collections before adding another.',
  },
  {
    id: 'service',
    title: 'Schedule and complete a Service visit',
    module: 'erp.service',
    steps: [
      'Dispatchers choose Service → Service requests to create a request for the customer, location and device, then assign an available technician.',
      'Technicians choose Service → Work orders, open their assigned job and select Start work. Record time, used parts and any photos.',
      'Complete the work with the customer signature. Review the retained evidence and costs; an authorised colleague can prepare the linked Finance draft.',
    ],
    note: 'An appointment must fit the technician’s availability. Parts are taken from the assigned technician warehouse.',
  },
  {
    id: 'crm',
    title: 'Customer follow-up and tickets',
    module: 'crm',
    steps: [
      'Choose Customers & CRM. Use Timeline for interactions and tasks, or Leads & pipeline to qualify and convert a lead.',
      'Open Tickets to record an issue, response and status. Use Create Service request when a technician is needed; reopen the existing link instead of creating a duplicate.',
      'Use Customer care for warranty claims, feedback and referrals. Claims keep their evidence and status history with the device.',
    ],
  },
  {
    id: 'logistics',
    title: 'Deliveries and routes',
    module: 'erp.logistics',
    steps: [
      'Choose Logistics → Deliveries to plan a delivery linked to a shipment.',
      'Use Routes to combine deliveries and Service visits. Keep each Service stop at its scheduled time and duration.',
      'Use returns and reverse logistics for a linked returned device. Courier booking remains unavailable until the provider is configured.',
    ],
  },
  {
    id: 'reports',
    title: 'Reports and attachments',
    steps: [
      'Open the report area of a module you can access. Choose dates and filters, then select Apply before exporting.',
      'Choose Export report and a file type. Download the completed file from Recent exports; use Refresh or the offered retry action if needed.',
      'Open a record’s attachments to upload, replace or download a file. Replacement keeps earlier versions. Export and upload actions require the appropriate permission.',
    ],
  },
];
const pos: HelpTopic[] = [
  {
    id: 'sell',
    title: 'Open a shift and make a sale',
    steps: [
      'Choose Shifts → Open shift. Select the assigned register and enter the actual opening cash.',
      'Choose Sell. Scan or search for a product, set quantities and select the customer when required. Serial-tracked products require an available serial number.',
      'Review offers and totals, choose the payment method and complete the sale. Open Sale history to review its documents.',
    ],
    note: 'Test receipt mode does not issue a certified fiscal receipt. Hardware and official issuance must be approved before live use.',
  },
  {
    id: 'payments',
    title: 'Discounts, rewards and split payments',
    steps: [
      'Select the customer before reviewing corporate prices or rewards. Automatic offers appear in the sale totals.',
      'Request authorised approval for a manual discount. Choose the permitted reward points to use.',
      'For a split payment, enter each amount and ensure the methods cover the total. Use an advance or on-account payment only when available for that customer.',
    ],
  },
  {
    id: 'returns',
    title: 'Return goods and close the shift',
    steps: [
      'Choose Returns and find the original sale. Select eligible items, their condition and the return reason.',
      'Review the refund and stock destination before confirming. Repairable devices follow the Service return path.',
      'Choose Shifts, open the current shift, review totals and enter counted cash before closing. Use Reports to download the period or shift results.',
    ],
  },
  {
    id: 'checkout',
    title: 'Recover an interrupted checkout',
    steps: [
      'If the connection fails during checkout, keep the saved checkout. Do not start another sale for the same purchase.',
      'When connected, choose Recovery, open the checkout and use its status check or retry action.',
      'Confirm the resulting sale in Sale history before taking payment again.',
    ],
    note: 'Checkout recovery is not full offline selling. Do not clear browser storage while a checkout is unresolved.',
  },
];
const recovery: HelpTopic[] = [
  {
    id: 'setup',
    title: 'What is available in Vista Recovery',
    steps: [
      'Sign in with an assigned Backup role and verify your authenticator. A password-only sign-in cannot open the console.',
      'Use the navigation to review the planned areas for sources, policies, jobs, restores, audit and recovery tests.',
      'Ask the infrastructure owner to confirm backup sources, storage and tape hardware, retention, recovery targets and responsible approvers.',
    ],
    note: 'The console is not yet an operational backup service. It does not create restore points or restore data. Do not rely on it to protect live information.',
  },
];

export function helpTopics(app: HelpApp, modules: readonly string[] = []): HelpTopic[] {
  const topics = app === 'operations' ? operations : app === 'pos' ? pos : recovery;
  return [...topics.filter((topic) => !topic.module || modules.includes(topic.module)), ...common];
}
