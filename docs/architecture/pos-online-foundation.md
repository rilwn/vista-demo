# Online POS foundation

The first operational POS slice uses the ERP-owned catalog, warehouse stock,
pricing, customers, locations, registers, operators, serials, and batches. The
POS does not keep a competing master-data store.

## Completed flow

1. An assigned operator opens one register shift with a counted cash balance.
2. The terminal searches products by name, product code, or barcode and returns
   current available stock and applicable price-list or promotion pricing.
3. Checkout validates quantity, VAT, cash tender, customer/location, and the
   required serial or batch selection.
4. One database transaction records the sale, lines, payment, inventory
   movements, serial ownership, customer equipment and warranty data, audit
   event, and integration outbox event.
5. A stable client transaction ID and idempotency key make a repeated request
   return the original sale rather than post it twice.
6. The shift closes with expected cash, counted cash, and the resulting
   difference.

Money is calculated with fixed-precision integer arithmetic in the service.
Stock rows and numbering sequences are locked while posting. A serial number
cannot be sold unless it is available in the shift warehouse.

## Fiscal boundary

Local development uses an explicit receipt simulator so the complete business
transaction can be tested without physical devices. The simulator is rejected
when the API runs in production. Certified Bulgarian Ordinance H-18 issuance,
PIN-pad handling, receipt printing, and hardware recovery require the approved
POS-001 devices and protocols before implementation or acceptance.
