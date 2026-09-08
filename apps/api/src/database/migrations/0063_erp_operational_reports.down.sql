-- Referenced export definitions are protected by the export-job foreign key.
DELETE FROM reporting.report_definitions WHERE definition_key IN ('procurement.order-comparison','procurement.supplier-claims','warehouse.stock-balances','warehouse.movements','warehouse.replenishment','sales.quotation-register','sales.shipment-register','logistics.deliveries','logistics.returns','logistics.routes');
DROP TABLE reporting.saved_erp_reports;
