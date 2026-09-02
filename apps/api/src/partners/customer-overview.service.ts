import { Inject, Injectable } from '@nestjs/common';
import type {
  CustomerFinancialDocumentSummary,
  CustomerOperationalOverview,
  CustomerPaymentSummary,
  CustomerPurchaseHistoryEntry,
  CustomerPurchaseLine,
  CustomerReceivableSummary,
  FinancePaymentMethod,
  FinancePaymentStatus,
} from '@vista/contracts';

import { DatabaseService } from '../database/database.service.js';
import { CustomerAssetsService } from './customer-assets.service.js';
import { PartnersService } from './partners.service.js';

interface OverviewCountRow {
  financial_documents: string;
  last_purchase_at: Date | string | null;
  open_receivables: string;
  outstanding_bgn: string;
  payments: string;
  purchases: string;
}

interface FinancialDocumentRow {
  bgn_gross_total: string;
  currency_code: string;
  document_type: CustomerFinancialDocumentSummary['documentType'];
  draft_number: string;
  due_date: string | null;
  gross_total: string;
  id: string;
  issue_date: string;
  official_number: string | null;
  source_sales_invoice_id: string | null;
  status: CustomerFinancialDocumentSummary['status'];
}

interface ReceivableRow {
  allocated_total: string;
  bgn_total: string;
  currency_code: string;
  document_date: string;
  due_date: string;
  id: string;
  document_number: string;
  outstanding_total: string;
  payment_status: FinancePaymentStatus;
  source_sales_invoice_id: string;
  total: string;
}

interface PaymentRow {
  amount: string;
  currency_code: string;
  id: string;
  payment_date: string;
  payment_method: FinancePaymentMethod;
  payment_number: string;
  payment_reference: string | null;
  recorded_at: Date | string;
}

interface PurchaseRow {
  currency_code: string;
  id: string;
  number: string;
  recorded_at: Date | string;
  source: CustomerPurchaseHistoryEntry['source'];
  source_shipment_id: string | null;
  total: string;
}

interface PurchaseLineRow {
  purchase_id: string;
  line_total: string;
  product_id: string;
  product_name: string;
  quantity: string;
  unit_price: string;
}

@Injectable()
export class CustomerOverviewService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PartnersService) private readonly partners: PartnersService,
    @Inject(CustomerAssetsService) private readonly assets: CustomerAssetsService,
  ) {}

  async get(partnerId: string, limit: number): Promise<CustomerOperationalOverview> {
    const pool = this.database.getPool();
    const [profile, locations, counts, financialDocuments, receivables, payments, purchases] =
      await Promise.all([
        this.partners.getProfile(partnerId),
        this.assets.list(partnerId),
        pool.query<OverviewCountRow>(overviewCountsSql, [partnerId]),
        pool.query<FinancialDocumentRow>(financialDocumentsSql, [partnerId, limit]),
        pool.query<ReceivableRow>(receivablesSql, [partnerId, limit]),
        pool.query<PaymentRow>(paymentsSql, [partnerId, limit]),
        pool.query<PurchaseRow>(purchasesSql, [partnerId, limit]),
      ]);

    const purchaseIds = purchases.rows.map((purchase) => purchase.id);
    const purchaseLines =
      purchaseIds.length === 0
        ? []
        : (await pool.query<PurchaseLineRow>(purchaseLinesSql, [purchaseIds])).rows;
    const linesByPurchase = new Map<string, CustomerPurchaseLine[]>();
    for (const row of purchaseLines) {
      const current = linesByPurchase.get(row.purchase_id) ?? [];
      current.push({
        lineTotal: row.line_total,
        productId: row.product_id,
        productName: row.product_name,
        quantity: row.quantity,
        unitPrice: row.unit_price,
      });
      linesByPurchase.set(row.purchase_id, current);
    }

    const count = required(counts.rows[0], 'Customer overview totals query failed');
    return {
      financialDocuments: financialDocuments.rows.map(mapFinancialDocument),
      locations,
      payments: payments.rows.map(mapPayment),
      profile,
      purchases: purchases.rows.map((row) => mapPurchase(row, linesByPurchase.get(row.id) ?? [])),
      receivables: receivables.rows.map(mapReceivable),
      summary: {
        activeEquipment: locations.reduce(
          (total, location) =>
            total + location.equipment.filter((equipment) => equipment.active).length,
          0,
        ),
        activeLocations: locations.filter((location) => location.location.active).length,
        financialDocuments: Number(count.financial_documents),
        ...(count.last_purchase_at ? { lastPurchaseAt: asIso(count.last_purchase_at) } : {}),
        openReceivables: Number(count.open_receivables),
        outstandingBgn: count.outstanding_bgn,
        payments: Number(count.payments),
        purchases: Number(count.purchases),
      },
    };
  }
}

const overviewCountsSql = `
  SELECT
    (SELECT count(*)::text
       FROM finance.financial_documents document
      WHERE document.customer_partner_id = $1)
      AS financial_documents,
    ((SELECT count(*) FROM sales.invoices invoice
       WHERE invoice.customer_partner_id = $1)
      + (SELECT count(*) FROM pos.sales sale
         WHERE sale.customer_partner_id = $1 AND sale.status = 'completed'))::text AS purchases,
    (SELECT max(purchase.recorded_at) FROM (
       SELECT invoice.recorded_at FROM sales.invoices invoice
        WHERE invoice.customer_partner_id = $1
       UNION ALL
       SELECT sale.completed_at FROM pos.sales sale
        WHERE sale.customer_partner_id = $1 AND sale.status = 'completed'
     ) purchase) AS last_purchase_at,
    (SELECT count(*)::text
       FROM finance.customer_documents document
      WHERE document.customer_partner_id = $1
        AND document.review_state = 'pending_finance_review'
        AND document.outstanding_total > 0) AS open_receivables,
    (SELECT coalesce(sum(document.outstanding_total), 0)::text
       FROM finance.customer_documents document
      WHERE document.customer_partner_id = $1
        AND document.review_state = 'pending_finance_review') AS outstanding_bgn,
    (SELECT count(*)::text
       FROM finance.payments payment
      WHERE payment.customer_partner_id = $1) AS payments`;

const financialDocumentsSql = `
  SELECT document.id, document.draft_number, document.official_number,
    document.document_type, document.status, document.issue_date::text,
    document.due_date::text, document.currency_code, document.gross_total::text,
    document.bgn_gross_total::text, document.source_sales_invoice_id
  FROM finance.financial_documents document
  WHERE document.customer_partner_id = $1
  ORDER BY document.issue_date DESC, document.created_at DESC, document.id DESC
  LIMIT $2`;

const receivablesSql = `
  SELECT document.id, document.document_number, document.source_sales_invoice_id,
    document.document_date::text, document.due_date::text, document.currency_code,
    document.total::text, document.allocated_total::text, document.outstanding_total::text,
    document.bgn_total::text, document.payment_status
  FROM finance.customer_documents document
  WHERE document.customer_partner_id = $1
  ORDER BY document.due_date DESC, document.created_at DESC, document.id DESC
  LIMIT $2`;

const paymentsSql = `
  SELECT payment.id, payment.payment_number, payment.payment_date::text,
    payment.payment_method, payment.currency_code, payment.amount::text,
    payment.payment_reference, payment.recorded_at
  FROM finance.payments payment
  WHERE payment.customer_partner_id = $1
  ORDER BY payment.payment_date DESC, payment.recorded_at DESC, payment.id DESC
  LIMIT $2`;

const purchasesSql = `
  SELECT purchase.id, purchase.number, purchase.source_shipment_id,
    purchase.currency_code, purchase.total, purchase.recorded_at, purchase.source
  FROM (
    SELECT invoice.id, invoice.invoice_number AS number,
      invoice.shipment_id AS source_shipment_id, invoice.currency_code,
      invoice.total::text AS total, invoice.recorded_at, 'erp_sales'::text AS source
    FROM sales.invoices invoice
    WHERE invoice.customer_partner_id = $1
    UNION ALL
    SELECT sale.id, sale.sale_number AS number, NULL::uuid AS source_shipment_id,
      sale.currency_code, sale.gross_total::text AS total,
      sale.completed_at AS recorded_at, 'pos'::text AS source
    FROM pos.sales sale
    WHERE sale.customer_partner_id = $1 AND sale.status = 'completed'
  ) purchase
  ORDER BY purchase.recorded_at DESC, purchase.id DESC
  LIMIT $2`;

const purchaseLinesSql = `
  SELECT purchase_line.purchase_id, purchase_line.product_id,
    purchase_line.product_name, purchase_line.quantity,
    purchase_line.unit_price, purchase_line.line_total
  FROM (
    SELECT line.invoice_id AS purchase_id, line.product_id,
      product.name AS product_name, line.quantity::text AS quantity,
      line.unit_price::text AS unit_price, line.line_total::text AS line_total,
      line.id
    FROM sales.invoice_lines line
    JOIN master_data.products product ON product.id = line.product_id
    WHERE line.invoice_id = ANY($1::uuid[])
    UNION ALL
    SELECT line.sale_id AS purchase_id, line.product_id, line.product_name,
      line.quantity::text, line.unit_price::text, line.gross_total::text, line.id
    FROM pos.sale_lines line
    WHERE line.sale_id = ANY($1::uuid[])
  ) purchase_line
  ORDER BY purchase_line.purchase_id, purchase_line.product_name, purchase_line.id`;

function mapFinancialDocument(row: FinancialDocumentRow): CustomerFinancialDocumentSummary {
  return {
    bgnGrossTotal: row.bgn_gross_total,
    currencyCode: row.currency_code,
    documentType: row.document_type,
    draftNumber: row.draft_number,
    ...(row.due_date ? { dueDate: row.due_date } : {}),
    grossTotal: row.gross_total,
    id: row.id,
    issueDate: row.issue_date,
    ...(row.official_number ? { officialNumber: row.official_number } : {}),
    ...(row.source_sales_invoice_id ? { sourceSalesInvoiceId: row.source_sales_invoice_id } : {}),
    status: row.status,
  };
}

function mapReceivable(row: ReceivableRow): CustomerReceivableSummary {
  return {
    allocatedTotal: row.allocated_total,
    bgnTotal: row.bgn_total,
    currencyCode: row.currency_code,
    documentDate: row.document_date,
    dueDate: row.due_date,
    id: row.id,
    number: row.document_number,
    outstandingTotal: row.outstanding_total,
    paymentStatus: row.payment_status,
    sourceSalesInvoiceId: row.source_sales_invoice_id,
    total: row.total,
  };
}

function mapPayment(row: PaymentRow): CustomerPaymentSummary {
  return {
    amount: row.amount,
    currencyCode: row.currency_code,
    id: row.id,
    number: row.payment_number,
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method,
    ...(row.payment_reference ? { paymentReference: row.payment_reference } : {}),
    recordedAt: asIso(row.recorded_at),
  };
}

function mapPurchase(
  row: PurchaseRow,
  lines: CustomerPurchaseLine[],
): CustomerPurchaseHistoryEntry {
  return {
    currencyCode: row.currency_code,
    id: row.id,
    lines,
    number: row.number,
    recordedAt: asIso(row.recorded_at),
    source: row.source,
    ...(row.source_shipment_id ? { sourceShipmentId: row.source_shipment_id } : {}),
    total: row.total,
  };
}

function asIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
