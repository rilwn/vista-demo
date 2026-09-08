import type { ErpReportDefinition, ErpReportDefinitionKey } from '@vista/contracts';
import { ApiErrorException } from '../common/api-error.exception.js';
const specifications = [
  {
    key: 'procurement.order-comparison',
    name: 'Purchase order comparison',
    description:
      'One row per ordered product. Compare ordered, received and invoiced quantities. Dates use order creation.',
    date: 'o.created_at',
    from: 'procurement.purchase_order_lines l JOIN procurement.purchase_orders o ON o.id=l.purchase_order_id JOIN master_data.partners p ON p.id=o.supplier_partner_id JOIN master_data.products product ON product.id=l.product_id JOIN master_data.units unit ON unit.id=product.unit_id JOIN master_data.warehouses w ON w.id=o.warehouse_id',
    id: 'l.id',
    columns: [
      ['order', 'Order reference', 'text', 'o.id::text'],
      ['supplier', 'Supplier', 'text', 'p.display_name'],
      ['warehouse', 'Warehouse', 'text', 'w.name'],
      ['product', 'Product', 'text', 'product.name'],
      ['code', 'Product code', 'text', 'product.product_code'],
      ['unit', 'Unit', 'text', 'unit.code'],
      ['ordered', 'Ordered', 'number', 'l.ordered_quantity::text'],
      ['received', 'Received', 'number', 'l.delivered_quantity::text'],
      ['invoiced', 'Invoiced', 'number', 'l.invoiced_quantity::text'],
      [
        'remaining',
        'Awaiting delivery',
        'number',
        '(l.ordered_quantity-l.delivered_quantity)::text',
      ],
      ['expected', 'Expected delivery', 'date', 'l.expected_delivery_date::text'],
      ['price', 'Unit price', 'number', 'l.unit_price::text'],
      ['currency', 'Currency', 'text', 'o.currency_code'],
      ['status', 'Status', 'text', "replace(initcap(o.status),'_',' ')"],
    ],
  },
  {
    key: 'procurement.supplier-claims',
    name: 'Supplier claims',
    description:
      'Recorded supplier claims with quantity, type and current status. Dates use claim creation.',
    date: 'c.created_at',
    from: 'procurement.supplier_claims c JOIN master_data.partners p ON p.id=c.supplier_partner_id JOIN procurement.goods_receipt_lines r ON r.id=c.goods_receipt_line_id JOIN procurement.purchase_order_lines l ON l.id=r.purchase_order_line_id JOIN master_data.products product ON product.id=l.product_id',
    id: 'c.id',
    columns: [
      ['reference', 'Claim reference', 'text', 'c.id::text'],
      ['supplier', 'Supplier', 'text', 'p.display_name'],
      ['product', 'Product', 'text', 'product.name'],
      ['quantity', 'Quantity', 'number', 'c.quantity::text'],
      ['type', 'Claim type', 'text', "replace(initcap(c.claim_type),'_',' ')"],
      ['status', 'Status', 'text', "replace(initcap(c.status),'_',' ')"],
      ['description', 'Description', 'text', 'c.description'],
    ],
  },
  {
    key: 'warehouse.stock-balances',
    name: 'Stock and valuation',
    description:
      'Current recorded stock by warehouse and product, including active reservations and weighted-average BGN value. This is not a historical stock snapshot.',
    from: "inventory.stock_balances b JOIN master_data.products p ON p.id=b.product_id JOIN master_data.units u ON u.id=p.unit_id JOIN master_data.warehouses w ON w.id=b.warehouse_id LEFT JOIN (SELECT warehouse_id,product_id,sum(remaining_quantity) quantity FROM inventory.stock_reservations WHERE status='active' GROUP BY warehouse_id,product_id) r ON r.warehouse_id=b.warehouse_id AND r.product_id=b.product_id",
    id: 'b.warehouse_id::text||b.product_id::text',
    columns: [
      ['warehouse', 'Warehouse', 'text', 'w.name'],
      ['code', 'Product code', 'text', 'p.product_code'],
      ['product', 'Product', 'text', 'p.name'],
      ['unit', 'Unit', 'text', 'u.code'],
      ['physical', 'On hand', 'number', 'b.quantity::text'],
      ['reserved', 'Reserved', 'number', 'coalesce(r.quantity,0)::text'],
      ['available', 'Available', 'number', '(b.quantity-coalesce(r.quantity,0))::text'],
      ['cost', 'Average unit cost (BGN)', 'money', 'b.average_unit_cost_bgn::text'],
      ['value', 'Stock value (BGN)', 'money', 'round(b.quantity*b.average_unit_cost_bgn,4)::text'],
    ],
  },
  {
    key: 'warehouse.movements',
    name: 'Stock movements',
    description:
      'Traceable inventory transactions by posting date. Quantities are recorded movement amounts; the movement type identifies the direction.',
    date: 'm.occurred_at',
    from: 'inventory.stock_movements m JOIN master_data.products p ON p.id=m.product_id JOIN master_data.units u ON u.id=p.unit_id JOIN master_data.warehouses w ON w.id=m.warehouse_id JOIN identity.user_accounts a ON a.id=m.actor_account_id JOIN identity.employees employee ON employee.id=a.employee_id',
    id: 'm.id',
    columns: [
      ['date', 'Posting date', 'date', '(m.occurred_at AT TIME ZONE $3)::date::text'],
      ['warehouse', 'Warehouse', 'text', 'w.name'],
      ['product', 'Product', 'text', 'p.name'],
      ['unit', 'Unit', 'text', 'u.code'],
      ['type', 'Movement type', 'text', "replace(initcap(m.movement_type),'_',' ')"],
      ['quantity', 'Quantity', 'number', 'm.quantity::text'],
      ['reference', 'Source reference', 'text', 'm.reference_id'],
      ['cost', 'Unit cost (BGN)', 'money', 'm.unit_cost_bgn::text'],
      ['operator', 'Recorded by', 'text', 'employee.display_name'],
    ],
  },
  {
    key: 'warehouse.replenishment',
    name: 'Replenishment',
    description:
      'Current minimum-stock settings and purchase recommendations. Includes configured stock policies only; recommended quantity is target less available, never below zero.',
    from: 'inventory.stock_replenishment_status s JOIN master_data.products p ON p.id=s.product_id JOIN master_data.units u ON u.id=p.unit_id JOIN master_data.warehouses w ON w.id=s.warehouse_id',
    id: 's.warehouse_id::text||s.product_id::text',
    columns: [
      ['warehouse', 'Warehouse', 'text', 'w.name'],
      ['product', 'Product', 'text', 'p.name'],
      ['unit', 'Unit', 'text', 'u.code'],
      ['available', 'Available', 'number', 's.available_quantity::text'],
      ['minimum', 'Minimum', 'number', 's.minimum_quantity::text'],
      ['target', 'Target', 'number', 's.target_quantity::text'],
      ['recommended', 'Recommended quantity', 'number', 's.recommended_quantity::text'],
      ['low', 'Low stock', 'text', "CASE WHEN s.low_stock THEN 'Yes' ELSE 'No' END"],
    ],
  },
  {
    key: 'sales.quotation-register',
    name: 'Quotations and orders',
    description:
      'One row per quotation with its confirmed order and current stage. Totals remain in the original currency, including VAT. Dates use quotation creation.',
    date: 'q.created_at',
    from: 'sales.quotations q JOIN master_data.partners p ON p.id=q.customer_partner_id JOIN master_data.warehouses w ON w.id=q.warehouse_id LEFT JOIN sales.orders o ON o.quotation_id=q.id',
    id: 'q.id',
    columns: [
      ['quotation', 'Quotation', 'text', 'q.quotation_number'],
      ['order', 'Order', 'text', "coalesce(o.order_number,'')"],
      ['customer', 'Customer', 'text', 'p.display_name'],
      ['warehouse', 'Warehouse', 'text', 'w.name'],
      ['valid', 'Valid until', 'date', 'q.valid_until::text'],
      ['status', 'Status', 'text', "replace(initcap(q.status),'_',' ')"],
      ['total', 'Total including VAT', 'number', 'q.total::text'],
      ['currency', 'Currency', 'text', 'q.currency_code'],
    ],
  },
  {
    key: 'sales.shipment-register',
    name: 'Shipments',
    description:
      'Completed shipments with their sales order and prepared invoice draft. Dates use shipment completion. Invoice drafts are not official invoices.',
    date: 's.shipped_at',
    from: 'sales.shipments s JOIN sales.orders o ON o.id=s.order_id JOIN master_data.partners p ON p.id=o.customer_partner_id JOIN master_data.warehouses w ON w.id=o.warehouse_id LEFT JOIN sales.invoices i ON i.shipment_id=s.id',
    id: 's.id',
    columns: [
      ['shipment', 'Shipment', 'text', 's.shipment_number'],
      ['order', 'Order', 'text', 'o.order_number'],
      ['customer', 'Customer', 'text', 'p.display_name'],
      ['warehouse', 'Warehouse', 'text', 'w.name'],
      ['date', 'Shipped on', 'date', '(s.shipped_at AT TIME ZONE $3)::date::text'],
      ['invoice', 'Prepared invoice draft', 'text', "coalesce(i.invoice_number,'')"],
    ],
  },
  {
    key: 'logistics.deliveries',
    name: 'Deliveries',
    description:
      'Planned and completed deliveries by scheduled start date. Includes cancellations and exceptions; courier records do not imply a live carrier booking.',
    date: 'd.scheduled_start',
    from: 'logistics.deliveries d JOIN master_data.partners p ON p.id=d.customer_partner_id JOIN sales.shipments s ON s.id=d.shipment_id',
    id: 'd.id',
    columns: [
      ['delivery', 'Delivery', 'text', 'd.delivery_number'],
      ['shipment', 'Shipment', 'text', 's.shipment_number'],
      ['customer', 'Customer', 'text', 'p.display_name'],
      ['city', 'City', 'text', 'd.city'],
      ['method', 'Transport', 'text', "replace(initcap(d.delivery_method),'_',' ')"],
      ['date', 'Scheduled date', 'date', '(d.scheduled_start AT TIME ZONE $3)::date::text'],
      ['status', 'Status', 'text', "replace(initcap(d.status),'_',' ')"],
      ['exception', 'Exception', 'text', "coalesce(d.exception_reason,'')"],
    ],
  },
  {
    key: 'logistics.returns',
    name: 'Returns and repairs',
    description:
      'One row per returned product, linked to its shipment, receiving warehouse and Service request where applicable. Dates use return registration.',
    date: 'r.created_at',
    from: 'logistics.reverse_return_lines l JOIN logistics.reverse_returns r ON r.id=l.reverse_return_id JOIN master_data.partners p ON p.id=r.customer_partner_id JOIN master_data.products product ON product.id=l.product_id JOIN master_data.warehouses w ON w.id=l.destination_warehouse_id JOIN sales.shipments s ON s.id=r.original_shipment_id',
    id: 'l.id',
    columns: [
      ['return', 'Return', 'text', 'r.return_number'],
      ['shipment', 'Original shipment', 'text', 's.shipment_number'],
      ['customer', 'Customer', 'text', 'p.display_name'],
      ['product', 'Product', 'text', 'product.name'],
      ['quantity', 'Quantity', 'number', 'l.quantity::text'],
      ['warehouse', 'Destination warehouse', 'text', 'w.name'],
      ['disposition', 'Disposition', 'text', 'initcap(l.disposition)'],
      ['status', 'Status', 'text', 'initcap(r.status)'],
      ['service', 'Service request reference', 'text', "coalesce(l.service_request_id::text,'')"],
    ],
  },
  {
    key: 'logistics.routes',
    name: 'Route plans',
    description:
      'Route schedules, assigned employees and stop counts by route date. Cancelled plans remain visible.',
    date: 'r.route_date',
    dateOnly: true,
    from: 'logistics.route_plans r JOIN identity.user_accounts a ON a.id=r.assigned_account_id JOIN identity.employees employee ON employee.id=a.employee_id',
    id: 'r.id',
    columns: [
      ['route', 'Route', 'text', 'r.route_number'],
      ['title', 'Title', 'text', 'r.title'],
      ['date', 'Route date', 'date', 'r.route_date::text'],
      ['employee', 'Assigned to', 'text', 'employee.display_name'],
      ['status', 'Status', 'text', "replace(initcap(r.status),'_',' ')"],
      [
        'stops',
        'Stops',
        'number',
        '(SELECT count(*)::text FROM logistics.route_stops s WHERE s.route_plan_id=r.id)',
      ],
    ],
  },
] as const;
export function erpReportSpec(key: string) {
  const spec = specifications.find((item) => item.key === key);
  if (!spec) throw new ApiErrorException('REPORT_NOT_FOUND', 'This report is not available.', 404);
  return spec;
}
export function erpReportColumns(key: ErpReportDefinitionKey) {
  return erpReportSpec(key).columns.map(([key, label, type]) => ({ key, label, type }));
}
export function erpReportDefinitions(): ErpReportDefinition[] {
  return specifications.map((spec) => ({
    key: spec.key,
    name: spec.name,
    description: spec.description,
    columns: erpReportColumns(spec.key),
    formats: ['csv', 'xlsx', 'pdf'],
    requiresDateRange: 'date' in spec,
  }));
}
export function erpReportSql(key: ErpReportDefinitionKey): string {
  const spec = erpReportSpec(key);
  const date =
    'date' in spec
      ? 'dateOnly' in spec
        ? spec.date
        : `(${spec.date} AT TIME ZONE $3)`
      : undefined;
  return `WITH parameters AS (SELECT $1::date AS from_date, $2::date AS to_date, $3::text AS zone, $4::text AS search),
    source AS (SELECT ${spec.id}::text AS "_id", ${spec.columns.map(([key, , , expression]) => `${expression} AS "${key}"`).join(', ')}
      FROM ${spec.from} ${date ? `WHERE ${date}::date BETWEEN $1::date AND $2::date` : ''})
    SELECT source.* FROM source, parameters WHERE parameters.search IS NULL OR EXISTS (
      SELECT 1 FROM jsonb_each_text(to_jsonb(source)-'_id') field WHERE strpos(lower(field.value),lower(parameters.search)) > 0)`;
}
